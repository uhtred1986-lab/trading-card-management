/** Scope guards for the initial whole-negation writer slice. No derived state. */
import type { EngineContext } from "../types";
import type { VmState } from "./state";
import { parseSkills } from "../text/cards";
import { programsOf } from "./common";
import { NotYet } from "./errors";

export function standingWholeIntent(ctx: EngineContext, state: VmState, id: string): boolean {
  const def = ctx.defs[state.cards[id]?.cardId];
  return !!def && [def.skill, def.back?.skill].some(text => parseSkills(text ?? null).some(skill => skill.kind === "permanent" && skill.effect.trim().toLowerCase() === "negate the skills of all other battle cards."));
}
function regenerates(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(regenerates);
  const object = value as Record<string, unknown>;
  return object.op === "gains" || object.op === "copySkills" || Object.values(object).some(regenerates);
}
/** Incoming cards are checked before placement, including the first negator. */
export function requireStandingNegationBounds(ctx: EngineContext, state: VmState, incoming?: string, affected = false): void {
  const board = (["p1", "p2"] as const).flatMap(p => state.sides[p].zones.battle ?? []);
  if (!affected && !state.standingNegationHistory?.active.length && !state.standingNegationHistory?.suppressed.length && ![...board, ...(incoming ? [incoming] : [])].some(id => standingWholeIntent(ctx, state, id))) return;
  const publicCards = (["p1", "p2"] as const).flatMap(p => Object.entries(state.sides[p].zones).filter(([zone]) => ["leader", "battle", "unison", "energy"].includes(zone)).flatMap(([, ids]) => ids));
  for (const id of new Set([...publicCards, ...(incoming ? [incoming] : [])])) {
    const instance = state.cards[id], def = instance && ctx.defs[instance.cardId];
    if (!def || instance.hidden) continue;
    const side = instance.flipped ? "back" : "front", scripts = programsOf(ctx, def, side);
    for (const skill of parseSkills((side === "back" ? def.back?.skill : def.skill) ?? null)) {
      if (skill.kind === "permanent" && regenerates(scripts.bySkill[skill.index]?.ops)) throw new NotYet("standing skill-grant regeneration during whole-negation", "R477");
    }
  }
}
