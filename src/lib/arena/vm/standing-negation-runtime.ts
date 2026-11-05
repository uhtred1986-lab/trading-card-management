import { requireStandingNegationBounds, standingWholeIntent } from "./standing-negation-bounds";
/** R477 bounded native integration. Catalog admission remains separate. */
import type { ContinuousEffect, EngineContext, GameEvent } from "../types";
import type { VmState } from "./state";
import { parseSkills } from "../text/cards";
import { programsOf } from "./common";
import { NotYet } from "./errors";
import { emptyStandingNegationHistory } from "./standing-negation-history";
import { standingNegationBattleOccurrences } from "./standing-negation-observation";
import { assertStandingNegationSettled, captureStandingNegationMutation, settleStandingNegationMutation, type StandingNegationMutation } from "./standing-negation-transaction";
import { invalidateStandingNegationReadSeal, issueStandingNegationReadSeal, standingNegationReadSealMatches } from "./standing-negation-read";

/** New games only: existing affected saves may never acquire inferred history. */
export function initializeStandingNegation(ctx: EngineContext, state: VmState): void {
  const complete = Object.values(ctx.defs).some(def => (["front", "back"] as const).some(side => parseSkills((side === "back" ? def.back?.skill : def.skill) ?? null).some(skill => {
    if (skill.kind !== "permanent" || skill.effect.trim().toLowerCase() !== "negate the skills of all other battle cards.") return false;
    const script = programsOf(ctx, def, side).bySkill[skill.index];
    return !!script && !script.unsupported.length && script.ops.some(op => op.op === "negateSkills");
  })));
  if (complete) state.standingNegationHistory = emptyStandingNegationHistory();
  validateStandingNegationRead(ctx, state);
}
export function validateStandingNegationRead(ctx: EngineContext, state: VmState): void {
  if (!state.standingNegationHistory) {
    const potential = (["p1", "p2"] as const).some(master => (state.sides[master].zones.battle ?? []).some(id => {
      const card = state.cards[id], def = card && ctx.defs[card.cardId];
      if (!def || card.hidden) return false;
      const side = card.flipped ? "back" : "front";
      return parseSkills((side === "back" ? def.back?.skill : def.skill) ?? null).some(skill => skill.kind === "permanent" &&
        (skill.effect.trim().toLowerCase() === "negate the skills of all other battle cards." || programsOf(ctx, def, side).bySkill[skill.index]?.ops.some(op => op.op === "negateSkills")));
    }));
    if (potential || state.effects.some(effect => effect.kind === "copiedSkills" && (["p1", "p2"] as const).some(p => state.sides[p].zones.battle.includes(effect.target)))) assertStandingNegationSettled(ctx, state);
    return;
  }
  if (standingNegationReadSealMatches(ctx, state)) return;
  assertStandingNegationSettled(ctx, state);
  issueStandingNegationReadSeal(ctx, state);
}
export function beginStandingNegationMutation(ctx: EngineContext, state: VmState, incoming?: string): StandingNegationMutation | undefined {
  requireStandingNegationBounds(ctx, state, incoming);
  if (!state.standingNegationHistory) return undefined;
  const token = captureStandingNegationMutation(ctx, state);
  invalidateStandingNegationReadSeal(state);
  return token;
}
export function finishStandingNegationMutation(ctx: EngineContext, state: VmState, token: StandingNegationMutation | undefined, arrival?: string): void {
  if (!token) return;
  const arrivals = arrival ? standingNegationBattleOccurrences(ctx, state).filter(card => card.card === arrival) : [];
  settleStandingNegationMutation(ctx, state, token, { arrivals });
  issueStandingNegationReadSeal(ctx, state);
}
export function refuseStandingNegationMutation(state: VmState, procedure: string, ctx?: EngineContext, incoming?: string): void {
  const def = incoming && ctx?.defs[state.cards[incoming]?.cardId];
  const arriving = def && ([def.skill, def.back?.skill]).some(text => parseSkills(text ?? null).some(skill => skill.kind === "permanent" && skill.effect.trim().toLowerCase() === "negate the skills of all other battle cards."));
  const present = ctx && (["p1", "p2"] as const).some(p => state.sides[p].zones.battle.some(id => standingWholeIntent(ctx, state, id)));
  if (present || arriving || state.standingNegationHistory?.active.length || state.standingNegationHistory?.suppressed.length) throw new NotYet(`standing whole-negation during ${procedure}`, "R477");
}

/** All effects ending at one timing disappear before the standing graph is observed. */
export function expireStandingNegationBatch(ctx: EngineContext, state: VmState, ev: GameEvent[], expire: (state: VmState, ev: GameEvent[]) => ContinuousEffect[]): ContinuousEffect[] {
  if (!state.standingNegationHistory) return expire(state, ev);
  {
    // Preview only the expiry list: a loan return needs its own reviewed simultaneous movement protocol.
    const ended = expire(structuredClone(state), []);
    if (ended.some(effect => effect.kind === "control")) refuseStandingNegationMutation(state, "control expiry", ctx);
  }
  const token = beginStandingNegationMutation(ctx, state);
  const ended = expire(state, ev);
  finishStandingNegationMutation(ctx, state, token);
  return ended;
}
