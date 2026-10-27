/** One 20-14 gate for every Life-to-hand move, whether payment, skill or damage. */
import type { EngineContext, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { forbids } from "./program";

/**
 * `source` is the card whose skill makes the move, when one does: "You can't
 * add cards from your life to your hand during your turn, **except with this
 * card's skill**" (BT6-054) lets that card's own skill through
 * (`exceptOwnSkills`); damage and a price name none and are refused.
 */
export function lifeToHandForbidden(ctx: EngineContext, game: GameDefinition, state: VmState, owner: PlayerId, from: string | null, to: string, source?: string, card?: string): boolean {
  // `card` (prohibition batch 6): the Life card itself, when the move names
  // one — "you can't add **face-up** cards in your life to your hand"
  // (BT12-086) is about some of them only.
  return from === "life" && to === "hand" && forbids(ctx, game, state, "addLifeToHand", { player: owner, ...(source ? { source } : {}), ...(card ? { card } : {}) });
}
