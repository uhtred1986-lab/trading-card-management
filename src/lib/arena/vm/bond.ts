/** The condition carried by [Bond X], including its specified-card form. */
import { parseFilter } from "../text/filters";
import { bondSelector } from "../text/bond";
import type { EngineContext, PlayerId, Skill } from "../types";
import type { GameDefinition } from "../rulesets";
import { predicateOf } from "./filters";
import { keywordSkillsNegated } from "./effects";
import { attrsNow, standingKeywordsNegated } from "./program";
import type { VmState } from "./state";

export { bondSelector, type BondSelector } from "../text/bond";

/**
 * 22-21-3/3-1: the skill is valid only while its master has enough Battle
 * Cards, and when it names a selector those cards must match it. `null` means
 * the specified selector was not one this parser can prove; callers keep the
 * skill unread rather than silently treating it as valid or free.
 */
export function bondIsValid(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  player: PlayerId,
  skill: Skill,
  source?: string,
  standingSuppressed?: boolean,
  readAttributes: (id: string) => ReturnType<typeof attrsNow> = id => attrsNow(ctx, game, state, id),
): boolean | null {
  const selector = bondSelector(skill);
  if (selector == null) return true;
  // RM 22-1-3: the supplementary requirement is not applied while the
  // source's keyword skills are negated; ordinary printed conditions remain.
  if (source && (keywordSkillsNegated(state, source) || (standingSuppressed ?? standingKeywordsNegated(ctx, game, state, source)))) return true;
  if (selector.kind === "unknown") return null;
  const cards = state.sides[player].zones.battle ?? [];
  // The keyword names Battle Cards specifically. An Extra with [Field] can
  // occupy the Battle Area too, but it never satisfies a specified Bond.
  const filter = selector.kind === "any" ? { ...parseFilter(""), type: "BATTLE" as const } : { ...selector.filter, type: "BATTLE" as const };
  const matchesFilter = predicateOf(filter, game);
  const matches = cards.filter((id) => {
      const instance = state.cards[id];
      if (!instance || !ctx.defs[instance.cardId]) return false;
      return matchesFilter(readAttributes(id));
    });
  return matches.length >= skill.bond!;
}

/**
 * 22-21-3: a printed keyword line carrying [Bond X] — "[Blocker][Bond 3] Red
 * ≪Saiyan≫ cards and/or ≪Bardock's Crew≫ cards." (BT13-006) — is the card's
 * only while the Bond holds, counting the specified Battle Cards when a
 * descriptor is printed (22-21-3-1). A descriptor the reader cannot prove
 * falls back to the plain Battle Card count, the least the keyword always
 * asks; the compiler keeps such a line unread.
 */
export function keywordBondHolds(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  player: PlayerId,
  skill: Skill,
  source?: string,
): boolean {
  if (skill.bond == null) return true;
  // Counting reads each Battle Card's attributes as they stand (`attrsNow`),
  // and those ask the keyword hooks which keywords a card has — this line
  // again. One level, as `readingStatics` allows: inside that count the line
  // stands as printed.
  if (countingKeywordBond) return true;
  countingKeywordBond = true;
  try {
    return bondIsValid(ctx, game, state, player, skill, source) ?? bondIsValid(ctx, game, state, player, { ...skill, cost: "", effect: "" }, source) === true;
  } finally {
    countingKeywordBond = false;
  }
}

let countingKeywordBond = false;
