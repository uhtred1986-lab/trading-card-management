/** The condition carried by [Bond X], including its specified-card form. */
import { parseFilter, type CardFilter } from "../text/filters";
import { eitherOrbsIn, orbsIn } from "../text/cards";
import type { EngineContext, PlayerId, Skill } from "../types";
import type { GameDefinition } from "../rulesets";
import { predicateOf } from "./filters";
import { attrsNow } from "./program";
import type { VmState } from "./state";

type BondSelector = { kind: "any" } | { kind: "filter"; filter: CardFilter } | { kind: "unknown" };

/**
 * A Bond line's text before the colon may name the Battle Cards it counts.
 * Only a single, fully bracketed selector is admitted here: the existing text
 * filter parser reads its meaning, and the exact wrapper check proves there is
 * no additional condition text after it. Recognized orb tokens are removed
 * first; the Skill carries their parsed energy price separately.
 */
export function bondSelector(skill: Skill): BondSelector | null {
  if (skill.bond == null) return null;
  const raw = skill.cost.trim();
  // `{g}` and `{2}` are energy prices, not card names. The parser has already
  // put them in energyCost/energyEither; remove only tokens those same parsers
  // recognize before reading a possible specified-card selector.
  const hasOrbs = Object.values(orbsIn(raw)).some((count) => (count ?? 0) > 0) || eitherOrbsIn(raw).length > 0;
  const text = raw
    .replace(/\{(?:[rugykbw]|\d+)\}(?:\/\{[rugykbw]\})?/gi, "")
    .trim();
  if (!text && hasOrbs) return { kind: "any" };
  if (!text) return { kind: "any" };
  if (!/^(?:≪[^≫]+≫|<[^>]+>|\{[^}]+\})$/.test(text)) return { kind: "unknown" };

  const filter = parseFilter(text);
  if (filter.unreadable) return { kind: "unknown" };
  const names = [filter.traits, filter.characters, filter.names].filter((items) => items.length === 1);
  if (names.length !== 1 || names[0]?.length !== 1) return { kind: "unknown" };
  const allowed = new Set(["traits", "characters", "names"]);
  for (const [key, value] of Object.entries(filter)) {
    if (allowed.has(key)) continue;
    if (Array.isArray(value) ? value.length > 0 : value != null && value !== false) return { kind: "unknown" };
  }
  return { kind: "filter", filter };
}

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
): boolean | null {
  const selector = bondSelector(skill);
  if (selector == null) return true;
  if (selector.kind === "unknown") return null;
  const cards = state.sides[player].zones.battle ?? [];
  // The keyword names Battle Cards specifically. An Extra with [Field] can
  // occupy the Battle Area too, but it never satisfies a specified Bond.
  const filter = selector.kind === "any" ? { ...parseFilter(""), type: "BATTLE" as const } : { ...selector.filter, type: "BATTLE" as const };
  const matchesFilter = predicateOf(filter, game);
  const matches = cards.filter((id) => {
      const instance = state.cards[id];
      if (!instance || !ctx.defs[instance.cardId]) return false;
      return matchesFilter(attrsNow(ctx, game, state, id));
    });
  return matches.length >= skill.bond!;
}
