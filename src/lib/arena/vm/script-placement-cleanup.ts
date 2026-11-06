/** R488 post-placement state cleanup shared by the script mover and its projections.
 * The caller owns the standing transaction, stamps, settlement and all triggers.
 */
import type { GameEvent } from "../types";
import type { VmState } from "./state";
import type { MoveRecord } from "./zones";
import { dropEffectsOnExcept, endSourceEffects } from "./effects";

export function clearScriptAutoReveal(state: VmState, card: string): void {
  if (state.publicAutoReveals?.length) state.publicAutoReveals = state.publicAutoReveals.filter(item => item.card !== card);
}

export function cleanupScriptPlacement(state: VmState, events: GameEvent[], move: MoveRecord, from: string | null, carry: boolean): void {
  cleanupPlacement(state, events, move, from, { changedArea: from !== move.to, retained: carry ? "all" : [] });
}

export interface PlacementCleanupPolicy {
  changedArea: boolean;
  retained: "all" | readonly number[];
}

/** Exact effect policy supplied by the mover; no triggers or live projection work. */
export function cleanupPlacement(state: VmState, events: GameEvent[], move: MoveRecord, from: string | null, policy: PlacementCleanupPolicy): void {
  clearScriptAutoReveal(state, move.card);
  for (const released of move.released ?? []) clearScriptAutoReveal(state, released.card);
  if (policy.changedArea && policy.retained !== "all") dropEffectsOnExcept(state, events, move.card, policy.retained);
  // A source's while-in-Battle effects on OTHER cards also end on departure.
  if (from === "battle" && move.to !== "battle") endSourceEffects(state, events, move.card);
  // Preserve the mover's existing actual-Battle-arrival bookkeeping.
  if (move.to === "battle" && from !== "battle") state.cards[move.card].placedThisTurn = true;
}
