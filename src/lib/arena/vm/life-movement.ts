/** One 20-14 gate for every Life-to-hand move, whether payment, skill or damage. */
import type { EngineContext, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { forbids } from "./program";

export function lifeToHandForbidden(ctx: EngineContext, game: GameDefinition, state: VmState, owner: PlayerId, from: string | null, to: string): boolean {
  return from === "life" && to === "hand" && forbids(ctx, game, state, "addLifeToHand", { player: owner });
}
