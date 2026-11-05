import {captureTaxPayers, taxPayerProblem, taxPayerProgramProblem, markTaxPayerPaid} from "./tax-payers";
import {NotYet} from "./errors";
/** Strict, ordered activation-tax payment for unactivated nonhand Counters. */
import type { EngineContext, GameEvent } from "../types";
import type { GameDefinition } from "../rulesets";
import type { ScriptFrame } from "./script";
import { stepScript } from "./script";
import type { VmState } from "./state";
import { activationTaxes } from "./activate";
import { automaticPriceHost, AutoPaymentFailed, canFinishAutomaticPrice } from "./auto-costs";
import { guardCounterNonhandTaxPayment } from "./counter-nonhand-tax";
import { sameCounterUnderSource, resetUnderCounterOccurrence } from "./counter-under";
import { resetEnergyCounterOccurrence } from "./counter-energy";
import { moved } from "./flow";
import { rebuildScope } from "./skill-play-scope";
import { log } from "./events";

/** Each subsequent tax sees the board after the preceding original payment. */
export function canFinishCounterTaxes(
  ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame,
  from: string, paid: readonly string[] = [],
): boolean {
  const tax = activationTaxes(ctx, game, state, frame.master, frame.card, frame.counterCost?.skill.kind, from)
    .find(item => !paid.includes(item.key));
  if (!tax) return true;
  const problem = taxPayerProgramProblem(tax.ops);
  if (problem) throw new NotYet(problem, "R471");
  return canFinishAutomaticPrice(ctx, game, state,
    { ops: tax.ops, ip: 0, vars: {}, card: frame.card, master: frame.master },
    { symmetry: false, complete: next => canFinishCounterTaxes(ctx, game, next, frame, from, [...paid, tax.key]) });
}

function taxOwner(state: VmState, frame: ScriptFrame): number {
  const at = state.programs.findIndex(parent => parent.taxGate?.counter &&
    parent.card === frame.card && parent.master === frame.master);
  if (at < 0) rebuildScope("rebuild the saved nonhand Counter tax owner");
  const gate = state.programs[at].taxGate!, parent = state.programs[at + 1];
  if (gate.guards !== 1 || !parent?.counterCost || parent.card !== frame.card ||
    parent.master !== frame.master || parent.skillIndex !== frame.counterNonhandTax?.skillIndex ||
    gate.counterTaxPending?.version !== 1 || gate.counterTaxPending.key !== frame.counterNonhandTax?.key) {
    rebuildScope("rebuild the saved nonhand Counter tax cleanup owner");
  }
  return at;
}

function failTax(ctx: EngineContext, game: GameDefinition, state: VmState, events: GameEvent[], frame: ScriptFrame): "done" {
  const at = taxOwner(state, frame), gate = state.programs[at].taxGate!;
  const parent = state.programs[at + 1], cost = parent.counterCost!;
  // Remove only the proven gate and owner before staging the source. A move
  // can queue replacement work; it must not be spliced by an obsolete index.
  state.programs.splice(at, 1 + gate.guards);
  if (cost.underOrigin && sameCounterUnderSource(state, frame.card, cost.underOrigin.source)) {
    moved(ctx, game, state, events, frame.card, "drop", { owner: state.cards[frame.card].owner,
      reveal: true, beforeTriggers: resetUnderCounterOccurrence(state, events, frame.card) });
  } else if (cost.energyOrigin && state.sides[frame.master].zones.energy.includes(frame.card) &&
    (state.cards[frame.card]?.zoneEpoch ?? 0) === cost.energyOrigin.sourceEpoch) {
    moved(ctx, game, state, events, frame.card, "drop", { owner: frame.master,
      reveal: true, beforeTriggers: resetEnergyCounterOccurrence(state, events, frame.card) });
  }

  state.lastChoice = null;
  state.lastMode = null;
  log(events, {type:"note",text:"[Counter] activation failed: its activation tax was not paid in full"});
  return "done";
}

export function stepCounterNonhandTax(
  ctx: EngineContext, game: GameDefinition, state: VmState, events: GameEvent[], frame: ScriptFrame,
): "done" | "wait" {
  if (!guardCounterNonhandTaxPayment(ctx, state, events, frame)) return "done";
  const stamp = frame.counterNonhandTax!;
  const programProblem = taxPayerProgramProblem(frame.ops);
  if (programProblem) rebuildScope(programProblem);
  const payerProblem = taxPayerProblem(state, frame.vars, stamp.payers);
  if (payerProblem === "malformed" || payerProblem === "missing") rebuildScope("rebuild the saved nonhand Counter tax payer occurrences");
  if (payerProblem === "stale" || frame.priceUnpaid) return failTax(ctx, game, state, events, frame);
  const strict = automaticPriceHost(ctx, game, state, events, frame);
  try {
    const result = stepScript({
      ...strict,
      resolveRef: (f, ref) => { captureTaxPayers(state, f.vars, stamp.payers); return strict.resolveRef(f, ref); },
      move: (card, to, owner, opts) => {
        const epoch = state.cards[card]?.zoneEpoch ?? 0;
        const destination = strict.move(card, to, owner, opts);
        markTaxPayerPaid(stamp.payers, card, epoch);
        return destination;
      },
    }, frame);
    if (result === "wait") { captureTaxPayers(state, frame.vars, stamp.payers); return "wait"; }
  } catch (error) {
    if (error instanceof AutoPaymentFailed) return failTax(ctx, game, state, events, frame);
    throw error;
  }
  const at = taxOwner(state, frame), gate = state.programs[at].taxGate!;
  if (gate.paid.includes(stamp.key)) rebuildScope("rebuild the duplicated nonhand Counter tax payment");
  gate.paid.push(stamp.key);
  delete gate.counterTaxPending;
  return "done";
}
