import { markerHistoryContract } from "./paid-markers";
/** #920 / R-445: Drop and marker-removal action prices use the strict continuation. */
import type { EngineContext, GameEvent, PlayerId, Requirement } from "../types";
import type { GameDefinition } from "../rulesets";
import { activationMoment, resolveActivation, type ActivationLine } from "./activate";
import { AutoPaymentFailed, automaticPriceHost, canFinishAutomaticPrice, readableAutomaticPrice } from "./auto-costs";
import { IllegalAction } from "./common";
import { captureActivationEnergyUses, consumeActivationEnergyUses, spendSkillCostUses, type PaidResources } from "./costs";
import { NotYet } from "./errors";
import { fire, log } from "./events";
import { stepScript, type ScriptFrame, type Op } from "./script";
import type { VmState } from "./state";
import { findCard } from "./zones";
import { skillsShowing } from "./triggers";
import { paidAdmissionBody, paidAdmissionWitness, paidAdmissionMatches, type PaidAdmission } from "./paid-admission";

export interface DropCost { line: ActivationLine; moment: ReturnType<typeof activationMoment>; sourceEpoch?: number; sourcePaid?: true; admission?: PaidAdmission }

export const hasMarkerActionPrice = (ops: Op[]): boolean => ops.some(op => op.op === "removeMarker" || (op.op === "if" && (hasMarkerActionPrice(op.then) || hasMarkerActionPrice(op.else ?? []))) || (op.op === "may" && hasMarkerActionPrice(op.ops)) || (op.op === "chooseMode" && op.modes.some(mode => hasMarkerActionPrice(mode.ops))));

/** Keyword moves gain no permission; the activation reader already requires explicit persisted Drop scope. */
export function hasDropActionPrice(state: VmState, line: ActivationLine): boolean {
  return !line.keyword && !!line.script?.price?.ops?.length && (findCard(state, line.card)?.zone === "drop" || hasMarkerActionPrice(line.script.price.ops));
}
const frameFor = (ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, x?: number): ScriptFrame => ({
  card: line.card, master: player, skillIndex: line.skillIndex, usage: line.skill.usage as import("./usage").UsageRecord, validity: line.skill.validity as import("./validity").ValidityRecord, ops: line.script!.price!.ops!, ip: 0, vars: {}, ...(x === undefined ? {} : { x }),
  markerHistoryContract: markerHistoryContract(line.script?.ops, line.script?.price),
  activationEnergyPayment: captureActivationEnergyUses(ctx, game, state, line.card, line.skill),
  dropCost: { line, moment: activationMoment(ctx, game, state, player, line), sourceEpoch: state.cards[line.card]?.zoneEpoch ?? 0, ...(hasMarkerActionPrice(line.script?.price?.ops ?? []) ? { admission: paidAdmissionWitness(line.script, paidAdmissionBody(line.script)) } : {}) },
});
function finishes(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, charge: (s: VmState) => void, x?: number): boolean {
  readableAutomaticPrice(line.script!.price!.ops!, "Drop activation", "#920");
  const copy = structuredClone(state); charge(copy);
  return canFinishAutomaticPrice(ctx, game, copy, frameFor(ctx, game, copy, player, line, x));
}
export function dropPriceRefusals(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, charge: (s: VmState) => void, x?: number): Requirement[] {
  if (!hasDropActionPrice(state, line)) return [];
  try { return finishes(ctx, game, state, player, line, charge, x) ? [] : [{ kind: "other", detail: "its strict activation skill cost cannot be paid in full" }]; }
  catch (err) { if (err instanceof NotYet) return [{ kind: "other", detail: err.message }]; throw err; }
}
export function assertDropPricePayable(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, charge: (s: VmState) => void, x?: number): void {
  if (hasDropActionPrice(state, line) && !finishes(ctx, game, state, player, line, charge, x)) throw new IllegalAction("the strict activation skill cost cannot be paid in full");
}
export function queueDropCost(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, x?: number, paid?: PaidResources): void {
  state.programs.unshift({ ...frameFor(ctx, game, state, player, line, x), ...paid });
}
export function stepDropCost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const fail = () => { log(ev, { type: "note", text: "Drop activation failed: its skill cost could not be paid in full" }); return "done" as const; };
  try {
    const saved = frame.dropCost!;
    if (frame.skillIndex === undefined) throw new IllegalAction("rebuild the saved strict activation skill index");
    const current = skillsShowing(ctx, state, frame.card).scripts.bySkill[frame.skillIndex];
    if (hasMarkerActionPrice(current?.price?.ops ?? [])) {
      if (!Number.isSafeInteger(saved.sourceEpoch) || saved.sourceEpoch! < 0) throw new IllegalAction("rebuild the saved strict activation source");
      if (current?.paidAdmission && (!paidAdmissionMatches(saved.admission, current) || !saved.line.script?.paidAdmission || !paidAdmissionMatches(saved.line.script.paidAdmission, current))) throw new IllegalAction("rebuild the saved strict activation admission");
    }
    if (!saved.sourcePaid && hasMarkerActionPrice(saved.line.script?.price?.ops ?? []) && (saved.sourceEpoch === undefined || saved.sourceEpoch !== (state.cards[frame.card]?.zoneEpoch ?? 0))) throw new IllegalAction("rebuild the marker action-price source occurrence");
    if (!(frame.awaiting === "replaceMove" && state.lastMode !== null) && !canFinishAutomaticPrice(ctx, game, state, frame)) {
      if (frame.awaiting) throw new IllegalAction("that choice cannot pay the Drop activation's skill cost");
      return fail();
    }
    const result = stepScript(automaticPriceHost(ctx, game, state, ev), frame);
    if (saved.sourceEpoch !== undefined && saved.sourceEpoch !== (state.cards[frame.card]?.zoneEpoch ?? 0)) saved.sourcePaid = true;
    if (result === "wait") {
      if (state.prompt.kind === "chooseCards") state.prompt.choice.candidates = state.prompt.choice.candidates.filter((id) => {
        const copy = structuredClone(state); copy.lastChoice = [id]; return canFinishAutomaticPrice(ctx, game, copy, frame);
      });
      return "wait";
    }
  } catch (err) { if (err instanceof AutoPaymentFailed) return fail(); throw err; }
  const { line, moment } = frame.dropCost!;
  if (frame.activationEnergyPayment) consumeActivationEnergyUses(state, ev, frame.activationEnergyPayment);
  // The action price was paid here, so resolve once with that price waived.
  // This boundary spends Once/Limit only now and hands cost choices to effects.
  resolveActivation(ctx, game, state, ev, frame.master, line, frame.x, undefined, { ops: hasMarkerActionPrice(line.script?.price?.ops ?? []) ? paidAdmissionBody(line.script) : line.script!.ops, vars: frame.vars, paidCardInfo: frame.paidCardInfo, paidMarkers: frame.paidMarkers }, true);
  spendSkillCostUses(ctx, game, state, ev, frame.card, line.skill);
  fire(ctx, game, state, moment);
  return "done";
}
