/** R488 post-placement state cleanup shared by the script mover and its projections.
 * The caller owns the standing transaction, stamps, settlement and all triggers.
 */
import type { GameEvent } from "../types";
import type { VmState } from "./state";
import type { MoveRecord } from "./zones";
import { dropEffectsOn, endSourceEffects } from "./effects";

export function clearScriptAutoReveal(state: VmState, card: string): void {
  if (state.publicAutoReveals?.length) state.publicAutoReveals = state.publicAutoReveals.filter(item => item.card !== card);
}

export function cleanupScriptPlacement(state: VmState, events: GameEvent[], move: MoveRecord, from: string | null, carry: boolean): void {
  clearScriptAutoReveal(state, move.card);
  for (const released of move.released ?? []) clearScriptAutoReveal(state, released.card);
  // RM 3-1-4: only the existing mover's carry decision preserves target effects.
  if (!carry && from !== move.to) dropEffectsOn(state, events, move.card);
  // A source's while-in-Battle effects on OTHER cards also end on departure.
  if (from === "battle" && move.to !== "battle") endSourceEffects(state, events, move.card);
  // Preserve the mover's existing actual-Battle-arrival bookkeeping.
  if (move.to === "battle" && from !== "battle") state.cards[move.card].placedThisTurn = true;
}
