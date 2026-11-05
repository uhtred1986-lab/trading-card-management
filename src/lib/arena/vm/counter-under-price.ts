/** R466: a payment-only view of the owner's exact Trunks discount. No card changes area. */
import type { EngineContext, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { keywordStatics, skillsNegated, skillNegated, type VmStatic } from "./effects";
import { condHolds, standingKindNegated, staticsNow } from "./program";
import { skillsShowing } from "./triggers";
import { hostOf, findCard } from "./zones";
import { NotYet } from "./errors";
import { cardPrice } from "./costs";
import { isUnderCounterOwnDiscount } from "./counter-under-contract";

/** Conservative boundary: an additional own discount needs its own reviewed policy. */
function containsOwnDiscount(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsOwnDiscount);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.op === "costReduction") return true;
  return Object.values(record).some(containsOwnDiscount);
}

export function underCounterOwnCostProblem(
  ctx: EngineContext, game: GameDefinition, state: VmState, card: string,
): string | null {
  if (skillsNegated(state, card) || standingKindNegated(ctx, game, state, card, "permanent")) return null;
  const showing = skillsShowing(ctx, state, card);
  for (const skill of showing.skills) {
    if (skill.kind !== "permanent" || skillNegated(state, card, skill.index, skill.kind)) continue;
    const script = showing.scripts.bySkill[skill.index];
    if (script && containsOwnDiscount(script.ops) && !isUnderCounterOwnDiscount(script.ops)) {
      return "evaluate an additional under-card own cost reduction as hand-equivalent";
    }
  }
  return null;
}

export function underCounterOwnCostLayers(
  ctx: EngineContext, game: GameDefinition, state: VmState, card: string, master: PlayerId,
): VmStatic[] {
  const host = hostOf(state, card);
  const at = host ? findCard(state, host) : null;
  if (!at || at.zone !== "battle" || at.owner !== master) return [];
  if (skillsNegated(state, card) || standingKindNegated(ctx, game, state, card, "permanent")) return [];
  const showing = skillsShowing(ctx, state, card);
  const bodies = showing.skills.flatMap(skill => {
    const script = showing.scripts.bySkill[skill.index];
    return skill.kind === "permanent" && !skillNegated(state, card, skill.index, skill.kind) &&
      script && !script.unsupported.length && isUnderCounterOwnDiscount(script.ops)
      ? [{ card, master, ops: script.ops }] : [];
  });
  // The exact body admits only self costReduction and conditions. The ordinary
  // collector supplies its existing cost layer; no keyword or power body is read.
  return keywordStatics(ctx, state, bodies,
    () => [card],
    (frame, op) => op.op === "if" && condHolds(ctx, game, state, frame, op.cond),
    (_frame, amount) => typeof amount === "number" ? amount : 0,
  );
}

/** Caller must first establish the exact original under-card permission. */
export function underCounterCardPrice(
  ctx: EngineContext, game: GameDefinition, state: VmState, card: string, master: PlayerId,
): ReturnType<typeof cardPrice> {
  const problem = underCounterOwnCostProblem(ctx, game, state, card);
  if (problem) throw new NotYet(problem, "R466");
  const standing = [...staticsNow(ctx, game, state), ...underCounterOwnCostLayers(ctx, game, state, card, master)];
  return cardPrice(ctx, game, state, card, undefined, standing);
}
