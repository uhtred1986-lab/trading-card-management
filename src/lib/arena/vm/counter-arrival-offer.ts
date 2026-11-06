/** Original-action affordability for R435's voluntary incoming-card substitute. */
import type { EngineContext } from "../types";
import type { GameDefinition } from "../rulesets";
import type { ScriptFrame } from "./script";
import type { VmState } from "./state";
import { vmHost } from "./host";
import { completedMovement } from "./movement-result";
import { canFinishAutomaticPrice } from "./auto-costs";

export function canReplaceCounterArrival(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame): boolean {
  const arrival = frame.arrivalDecision?.arrival;
  if (!arrival || state.resolving?.card !== arrival.card || state.resolving.landed || state.resolving.replaced ||
    !state.cards[arrival.card] || (state.cards[arrival.card].zoneEpoch ?? 0) !== arrival.epoch) return false;
  const name = "§arrivalIncoming";
  return canFinishAutomaticPrice(ctx, game, state, {
    card: frame.card, master: frame.master, skillKind: "counter", counterPlay: true, ip: 0,
    arrivalDecision: structuredClone(frame.arrivalDecision),
    vars: { [name]: [arrival.card], [`${name}@epoch`]: [`${arrival.card}@${arrival.epoch}`] },
    ops: [{ op: "moveTo", target: { var: name }, to: "drop", completedAs: name }],
  }, {
    symmetry: false,
    hostForProof: (projected, effect) => vmHost(ctx, game, projected, [], effect),
    complete: (_projected, effect) => completedMovement(effect, name),
  });
}
