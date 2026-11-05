import {taxPayerProblem, type TaxPayers} from "./tax-payers";
import { sameCounterUnderDeclaration, sameCounterUnderSource, validCounterUnderOrigin, type CounterUnderSource } from "./counter-under";
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
  area: "energy" | "removed" | "under";
  under?: CounterUnderSource;
  skillIndex: number;
  paymentVersion: 1;
  key: string;
  payers: TaxPayers;
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
      (route?.energyOrigin || route?.dropOrigin || route?.underOrigin);
    return sameSource && (gate && (gate.from === "energy" || gate.from === "drop" || gate.from === "under") || guardedRoute)
      ? [{ gate, index }] : [];
  });
  if (!owners.length) {
    if (frame.counterNonhandTax) rebuildScope("rebuild the saved non-hand Counter tax owner");
    return true;
  }
  if (owners.length !== 1) rebuildScope("rebuild the ambiguous non-hand Counter tax owner");
  const { gate, index } = owners[0];
  if (!gate?.counter || gate.card !== frame.card || gate.player !== frame.master ||
    (gate.from !== "energy" && gate.from !== "drop" && gate.from !== "under")) rebuildScope("rebuild the saved non-hand Counter tax gate");
  const parent = state.programs[index + 1];
  const area = gate.from === "under" ? "under" : gate.from === "energy" ? "energy" : "removed";
  const epoch = gate.from === "under" ? gate.counterUnderSource?.sourceEpoch : gate.from === "energy" ? gate.counterEnergyEpoch : gate.counterDropPaidEpoch;
  const stamp = frame.counterNonhandTax;
  if (gate.guards !== 1 || !parent?.counterCost || parent.card !== frame.card || parent.master !== frame.master ||
    !Number.isSafeInteger(epoch) || epoch! < 0 || !stamp || stamp.version !== 1 ||
    stamp.card !== frame.card || stamp.cardId !== state.cards[frame.card]?.cardId || stamp.area !== area ||
    stamp.epoch !== epoch || stamp.skillIndex !== parent.skillIndex ||
    (gate.from === "under" ? parent.counterCost.underOrigin?.source.sourceEpoch : gate.from === "energy" ? parent.counterCost.energyOrigin?.sourceEpoch : parent.counterCost.dropOrigin?.paidEpoch) !== epoch ||
    (gate.from === "under" ? !validCounterUnderOrigin(ctx, state, parent) || !sameCounterUnderDeclaration(stamp.under, gate.counterUnderSource) || !sameCounterUnderDeclaration(stamp.under, parent.counterCost.underOrigin?.source) : gate.from === "energy" ? !validCounterEnergyOrigin(ctx, state, parent) : !validCounterDropOrigin(ctx, state, parent))) {
    rebuildScope("rebuild the saved non-hand Counter tax payment source");
  }
  if (stamp.paymentVersion !== 1 || typeof stamp.key !== "string" || !stamp.key ||
    gate.counterTaxPending?.version !== 1 || gate.counterTaxPending.key !== stamp.key ||
    gate.paid.includes(stamp.key) || !stamp.payers || typeof stamp.payers !== "object" || Array.isArray(stamp.payers)) {
    rebuildScope("rebuild the strict nonhand Counter tax payment");
  }
  const payerProblem = taxPayerProblem(state, frame.vars, stamp.payers);
  if (payerProblem === "malformed" || payerProblem === "missing") rebuildScope("rebuild the saved nonhand Counter tax payer occurrences");
  if (payerProblem === "stale") frame.priceUnpaid = "the original selected tax payer left before payment";
  const now = findCard(state, frame.card);
  if (area === "under" ? sameCounterUnderSource(state, frame.card, stamp.under!) : now?.owner === frame.master && now.zone === area && (state.cards[frame.card]?.zoneEpoch ?? 0) === epoch) return true;
  // This Counter has not activated. Preserve previous payments, remove only its
  // remaining tax work/gate and guarded activation, then resume the enclosing action.
  state.programs.splice(index, 1 + gate.guards);
  state.lastChoice = null;
  state.lastMode = null;
  log(ev, { type: "note", text: "[Counter] activation failed: the original non-hand source left before its tax payment" });
  return false;
}
