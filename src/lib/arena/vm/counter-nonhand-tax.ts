/** R463: an unactivated non-hand Counter owns its queued activation-tax payment. */
import type { EngineContext, GameEvent } from "../types";
import type { ScriptFrame } from "./script";
import type { VmState } from "./state";
import { validCounterDropOrigin } from "./counter-drop";
import { validCounterEnergyOrigin } from "./counter-energy";
import { rebuildScope } from "./skill-play-scope";
import { findCard } from "./zones";
import { log } from "./events";

export interface CounterNonhandTax {
  version: 1;
  card: string;
  cardId: string;
  epoch: number;
  area: "energy" | "removed";
  skillIndex: number;
}

export function guardCounterNonhandTaxPayment(
  ctx: EngineContext, state: VmState, ev: GameEvent[], frame: ScriptFrame,
): boolean {
  if (frame.taxGate || frame.counterCost) {
    if (frame.counterNonhandTax) rebuildScope("rebuild the conflicting non-hand Counter tax child");
    return true;
  }
  const owners = state.programs.flatMap((parent, index) => {
    const gate = parent.taxGate;
    const guarded = state.programs[index + 1];
    const route = guarded?.counterCost;
    const sameSource = parent.card === frame.card && parent.master === frame.master;
    const guardedRoute = guarded?.card === frame.card && guarded.master === frame.master &&
      (route?.energyOrigin || route?.dropOrigin);
    return sameSource && (gate && (gate.from === "energy" || gate.from === "drop") || guardedRoute)
      ? [{ gate, index }] : [];
  });
  if (!owners.length) {
    if (frame.counterNonhandTax) rebuildScope("rebuild the saved non-hand Counter tax owner");
    return true;
  }
  if (owners.length !== 1) rebuildScope("rebuild the ambiguous non-hand Counter tax owner");
  const { gate, index } = owners[0];
  if (!gate?.counter || gate.card !== frame.card || gate.player !== frame.master ||
    (gate.from !== "energy" && gate.from !== "drop")) rebuildScope("rebuild the saved non-hand Counter tax gate");
  const parent = state.programs[index + 1];
  const area = gate.from === "energy" ? "energy" : "removed";
  const epoch = gate.from === "energy" ? gate.counterEnergyEpoch : gate.counterDropPaidEpoch;
  const stamp = frame.counterNonhandTax;
  if (gate.guards !== 1 || !parent?.counterCost || parent.card !== frame.card || parent.master !== frame.master ||
    !Number.isSafeInteger(epoch) || epoch! < 0 || !stamp || stamp.version !== 1 ||
    stamp.card !== frame.card || stamp.cardId !== state.cards[frame.card]?.cardId || stamp.area !== area ||
    stamp.epoch !== epoch || stamp.skillIndex !== parent.skillIndex ||
    (gate.from === "energy" ? parent.counterCost.energyOrigin?.sourceEpoch : parent.counterCost.dropOrigin?.paidEpoch) !== epoch ||
    (gate.from === "energy" ? !validCounterEnergyOrigin(ctx, state, parent) : !validCounterDropOrigin(ctx, state, parent))) {
    rebuildScope("rebuild the saved non-hand Counter tax payment source");
  }
  const now = findCard(state, frame.card);
  if (now?.owner === frame.master && now.zone === area && (state.cards[frame.card]?.zoneEpoch ?? 0) === epoch) return true;
  // This Counter has not activated. Preserve previous payments, remove only its
  // remaining tax work/gate and guarded activation, then resume the enclosing action.
  state.programs.splice(0, index + 1 + gate.guards);
  state.lastChoice = null;
  state.lastMode = null;
  log(ev, { type: "note", text: "[Counter] activation failed: the original non-hand source left before its tax payment" });
  return false;
}
