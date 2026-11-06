/** R505: exact flow effect lifetime, shared with isolated subject projections. */
import type { GameEvent } from "../types";
import type { VmState } from "./state";
import type { MoveRecord } from "./zones";
import { areaCarries, captureAppliedEffectMove, effectOccurrence, eligible, settleAppliedEffectMove, type NativeEffectMove, type Receipt } from "./applied-effect-receipt";
import { captureRetainedGrantHistory, carryRetainedGrantHistory, type ResolvedGrantDeletion } from "./resolved-grant-deletion";
import { cleanupPlacement, type PlacementCleanupPolicy } from "./script-placement-cleanup";
import { NotYet } from "./errors";
export interface FlowPlacementCapture {
    effects: NativeEffectMove;
    grants: ResolvedGrantDeletion[];
}
export function captureFlowPlacement(state: VmState, card: string, receipt?: Receipt): FlowPlacementCapture {
    return { effects: captureAppliedEffectMove(state, card, receipt), grants: captureRetainedGrantHistory(state, card) };
}
/** Only unresolved payment entitlement needs a prospective actual route. */
export function needsFlowPaymentPreview(capture: FlowPlacementCapture): boolean {
    return capture.effects.plan?.root.kind === "tax" && capture.effects.plan.effects.length > 0;
}
function policyFor(state: VmState, move: MoveRecord, capture: FlowPlacementCapture): PlacementCleanupPolicy {
    const from = capture.effects.from, to = effectOccurrence(state, move.card);
    const changedArea = from.area !== to.area || from.holder !== to.holder;
    if (areaCarries(from.area, to.area, from.holder === to.holder))
        return { changedArea, retained: "all" };
    const qualifying = ["leader", "battle", "unison", "combo"].includes(move.to);
    const plan = capture.effects.plan;
    const retained = plan ? eligible(plan, to, qualifying ? "sameSkill" : "reset") : [];
    if (qualifying && plan?.root.kind === "tax" && retained.some(id => state.effects.some(effect => effect.id === id && effect.target === move.card))) {
        throw new NotYet("carry a payment-produced effect to a new qualifying area", "R505");
    }
    return { changedArea, retained };
}
/** Caller owns the standing transaction and all movement/arrival events. A
 * projection must supply its own cloned state and capture, with a private sink. */
export function cleanupFlowPlacement(state: VmState, events: GameEvent[], move: MoveRecord, capture: FlowPlacementCapture): void {
    const policy = policyFor(state, move, capture);
    cleanupPlacement(state, events, move, move.from, policy);
    carryRetainedGrantHistory(state, capture.grants);
    settleAppliedEffectMove(state, capture.effects);
}
