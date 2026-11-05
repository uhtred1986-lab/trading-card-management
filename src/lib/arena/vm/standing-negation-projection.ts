/** R477: explicit, isolated movement ownership for the two existing projections. */
import type { EngineContext, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { findCard, moveCard } from "./zones";
import { dropEffectsOn } from "./effects";
import { beginStandingNegationMutation, finishStandingNegationMutation, validateStandingNegationRead } from "./standing-negation-runtime";
import { NotYet } from "./errors";

export type StandingProjectionMove = { id: string; to: string; owner?: PlayerId; mode?: string; position?: "top" | "bottom" };
/** Does not emit, pend triggers or touch the live match. Caller owns this clone.
 * Keyword prices use host.moveTo cleanup; Combo subject information uses the
 * current flow.moved cleanup. R454's different movement lifetimes are not repaired here.
 */
export function projectStandingNegationMoves(ctx: EngineContext, game: GameDefinition, projected: VmState, moves: StandingProjectionMove[], procedure: "keywordPrice" | "comboSubject"): void {
  validateStandingNegationRead(ctx, projected);
  // These projections intentionally model only existing supported outlays.
  for (const { id, to } of moves) {
    const from = findCard(projected, id)?.zone, card = projected.cards[id];
    const allowed = procedure === "comboSubject" ? from === "combo" && to === "drop" : from === "hand" && to === "drop" || from === "drop" && to === "warp";
    if (!card || !allowed || card.under.length || card.hidden || ctx.defs[card.cardId]?.type === "TOKEN") throw new NotYet("project this movement with standing whole-negation history", "R477");
  }
  const token = beginStandingNegationMutation(ctx, projected);
  for (const { id, to, owner, mode, position } of moves) {
    const from = findCard(projected, id)!.zone;
    const result = moveCard(projected, game, id, to, { owner: owner ?? projected.cards[id].owner, ...(mode ? { mode } : {}), ...(position ? { position } : {}) });
    if (!result.ok || result.move.to !== to) throw new NotYet("project this movement with standing whole-negation history", "R477");
    if (from !== to) {
      if (procedure === "keywordPrice") dropEffectsOn(projected, [], id);
      else projected.effects = projected.effects.filter(effect => effect.target !== id || effect.kind !== "control");
    }
  }
  finishStandingNegationMutation(ctx, projected, token);
}
