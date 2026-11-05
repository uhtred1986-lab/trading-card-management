/** R457: the Field skill follows Extra activation staging (12-2), then
 * places the authorized occurrence as its effect (22-3-2). */
import type { Action, CardOccurrence, EngineContext, GameEvent, PlayerId, Requirement } from "../types";
import { activationAlt, activationMoment, boundFor, resolveActivation, type ActivationLine } from "./activate";
import type { GameDefinition } from "../rulesets";
import { automaticPriceHost, AutoPaymentFailed, canFinishAutomaticPrice } from "./auto-costs";
import { dropEffectsOn, skillNegated, skillsNegated, type VmAltCost } from "./effects";
import { moved } from "./flow";
import { replacementChoices } from "./replace";
import { fieldRuleHost } from "./field-rules";
import { completedMovement } from "./movement-result";
import { vmHost } from "./host";
import { forbiddenBy, spendProhibitionUse, taxesOn } from "./program";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { cardPrice, captureActivationEnergyUses, consumeActivationEnergyUses, chargeCost, freePrice, payAltCost, planCost, priceFor, spendSkillCostUses, type CapturedEnergyCouponUses, type Price, type VmPayment } from "./costs";
import { IllegalAction } from "./common";
import { NotYet } from "./errors";
import { stepScript, type Op, type ScriptFrame } from "./script";
import type { VmState } from "./state";
import { captureTaxPayers, markTaxPayerPaid, taxPayerProblem, taxPayerProgramProblem, type TaxPayers } from "./tax-payers";
import { requireSkillPayment } from "./skill-payment";
import { usesLeft } from "./limits";
import { fire, log } from "./events";
import { findCard, hostOf } from "./zones";

export interface FieldSource {
  version: 1;
  card: string;
  cardId: string;
  epoch: number;
  area: string;
  owner: PlayerId;
  holder: PlayerId;
  master: PlayerId;
}
interface FieldResourceChoice {
  price: Price;
  payment: VmPayment;
  label: string;
  payers: CardOccurrence[];
}
export interface FieldCost {
  version: 1;
  line: ActivationLine;
  source: FieldSource;
  originalArea: string;
  waived: boolean;
  stage: "cardResources" | "stageSource" | "skillResources" | "skillAction" | "taxes" | "activate";
  alt?: VmAltCost;
  moment: ReturnType<typeof activationMoment>;
  requestedEnergy?: CardOccurrence[];
  choices?: FieldResourceChoice[];
  coupons?: CapturedEnergyCouponUses;
  paidTaxes: string[];
  tax?: { identity: string; ops: Op[]; accepted: boolean; payers: TaxPayers };
}
export const isFieldPayment = (line: Pick<ActivationLine, "keyword">): boolean => line?.keyword?.name === "Field";

export function captureFieldSource(ctx: EngineContext, state: VmState, master: PlayerId, card: string): FieldSource {
  const inst = state.cards[card], at = findCard(state, card);
  if (!inst || !at || hostOf(state, card) || ctx.defs[inst.cardId]?.type !== "EXTRA") throw new IllegalAction("the Field source is not in an area");
  return { version: 1, card, cardId: inst.cardId, epoch: inst.zoneEpoch ?? 0, area: at.zone, owner: inst.owner, holder: at.owner, master };
}
export function fieldSourceProblem(state: VmState, source: FieldSource | undefined, card: string, master: PlayerId): string | null {
  if (!source || source.version !== 1 || source.card !== card || source.master !== master || !["p1", "p2"].includes(source.owner) || !["p1", "p2"].includes(source.master)
    || !["p1", "p2"].includes(source.holder) || typeof source.cardId !== "string" || typeof source.area !== "string" || !source.area || !Number.isSafeInteger(source.epoch) || source.epoch < 0)
    throw new NotYet("rebuild the missing or malformed Field source occurrence", "R457");
  const inst = state.cards[card], at = findCard(state, card);
  return !inst || inst.cardId !== source.cardId || inst.owner !== source.owner || (inst.zoneEpoch ?? 0) !== source.epoch || at?.zone !== source.area || at.owner !== source.holder || hostOf(state, card)
    ? "the Field source left its authorized occurrence" : null;
}
export function retainFieldSelection(state: VmState, cost: FieldCost, action: Action): void {
  if ("pay" in action && action.pay !== undefined) {
    if (!Array.isArray(action.pay) || new Set(action.pay).size !== action.pay.length || action.pay.some(id => typeof id !== "string" || !state.cards[id])) throw new IllegalAction("invalid Field energy selection");
    cost.requestedEnergy = action.pay.map(card => ({ card, epoch: state.cards[card].zoneEpoch ?? 0 }));
  }
  if ("payPools" in action && action.payPools !== undefined) throw new IllegalAction("Field has no declared choice pool");
}

/** Only the currently printed Field action-price family, without general
 * keyword action admission. All other native resource slots must be empty. */
export function fieldAction(line: ActivationLine): Op[] {
  const ops = line.script?.price?.ops ?? [];
  if (!ops.length) return [];
  if (ops.length === 1 && ops[0].op === "draw" && ops[0].n === 1 && (!ops[0].side || ops[0].side === "you")) return ops;
  throw new NotYet("pay this Field action-price shape", "R457");
}

export function createFieldCost(ctx: EngineContext, game: GameDefinition, state: VmState, master: PlayerId, line: ActivationLine, waived = false, alt?: VmAltCost): FieldCost {
  if (!isFieldPayment(line) || line.skill.keyword?.name !== "Field" || !line.script?.price) throw new NotYet("rebuild this Field declaration and stored price", "R457");
  requireSkillPayment(line.script.price);
  fieldAction(line);
  const source = captureFieldSource(ctx, state, master, line.card);
  return { version: 1, line: structuredClone(line), source, originalArea: source.area, waived, stage: "cardResources", paidTaxes: [], moment: activationMoment(ctx, game, state, master, line), ...(alt ? { alt: structuredClone(alt) } : {}) };
}
function fieldPrice(ctx: EngineContext, game: GameDefinition, state: VmState, cost: FieldCost, cardEnergy: boolean): Price {
  const bound = boundFor(ctx, game, state, cost.source.master, cost.line, false);
  const skill = priceFor(ctx, game, state, game.actions.activate, cost.source.card, bound);
  if (skill.markers || skill.markersOff.some(p => p.n) || skill.life || skill.rest || skill.pooled.some(p => p.n)) throw new NotYet("pay supplementary native resources on Field", "R457");
  if (!cardEnergy) return skill;
  const card = cardPrice(ctx, game, state, cost.source.card, cost.line.skill);
  return { ...freePrice(), energy: card.total, orbs: card.orbs, payers: skill.payers };
}
function fieldPlans(ctx: EngineContext, game: GameDefinition, state: VmState, cost: FieldCost, cardEnergy: boolean): FieldResourceChoice[] {
  const requested = cardEnergy ? cost.requestedEnergy : undefined;
  if (requested?.some(item => (state.cards[item.card]?.zoneEpoch ?? 0) !== item.epoch)) return [];
  const price = fieldPrice(ctx, game, state, cost, cardEnergy);
  const plan = planCost(ctx, game, state, cost.source.master, price, cost.source.card, requested?.map(item => item.card));
  if (!plan.ok) return [];
  const plans = requested || !plan.asks || plan.options.length < 2 ? [plan] : plan.options.map(option => planCost(ctx, game, state, cost.source.master, price, cost.source.card, option.rest));
  return plans.flatMap(option => option.ok ? [{ price, payment: option.payment, label: option.describe, payers: option.payment.rest.map(card => ({ card, epoch: state.cards[card].zoneEpoch ?? 0 })) }] : []);
}
/** Source staging is a rule move. Capture the successful Drop occurrence only;
 * clearing hand effects must precede all arrival watchers (3-1-4). */
function stageField(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], cost: FieldCost): boolean {
  if (fieldSourceProblem(state, cost.source, cost.source.card, cost.source.master)) return false;
  if (cost.source.area !== "hand") return true;
  let completed = false;
  if (replacementChoices(ctx, game, state, cost.source.card, "rule", { requestedTo: "drop" }).some(choice => !choice.optional)) return false;
  moved(ctx, game, state, ev, cost.source.card, "drop", { replaced: null, owner: cost.source.owner, reason: "rule", reveal: true,
    beforeTriggers: () => dropEffectsOn(state, ev, cost.source.card), onResult: result => { completed = result.completed; } });
  if (!completed) return false;
  cost.source = captureFieldSource(ctx, state, cost.source.master, cost.source.card);
  return cost.source.area === "drop";
}
function fieldTaxes(ctx: EngineContext, game: GameDefinition, state: VmState, cost: FieldCost) {
  return taxesOn(ctx, game, state, "activateSkill", { player: cost.source.master, card: cost.source.card, skillKind: cost.line.kind, from: cost.originalArea, keyword: "Field", withIdentity: true });
}
function fieldFrame(cost: FieldCost, ops: Op[] = []): ScriptFrame {
  return { card: cost.source.card, master: cost.source.master, skillIndex: cost.line.skillIndex, ops, ip: 0, vars: {} };
}
function conditionHolds(ctx: EngineContext, game: GameDefinition, state: VmState, cost: FieldCost): boolean {
  const condition = cost.line.script?.price?.condition;
  return !condition || vmHost(ctx, game, state, []).condHolds(fieldFrame(cost), condition);
}
function taxesFinish(ctx: EngineContext, game: GameDefinition, state: VmState, cost: FieldCost, paid: string[]): boolean {
  const next = fieldTaxes(ctx, game, state, cost).find(tax => !paid.includes(tax.identity!));
  if (!next) return !state.outcome;
  return canFinishAutomaticPrice(ctx, game, state, fieldFrame(cost, next.ops), { symmetry: false, complete: board => taxesFinish(ctx, game, board, cost, [...paid, next.identity!]) });
}
function afterSkillResources(ctx: EngineContext, game: GameDefinition, state: VmState, cost: FieldCost): boolean {
  return canFinishAutomaticPrice(ctx, game, state, fieldFrame(cost, cost.waived ? [] : fieldAction(cost.line)), { symmetry: false, complete: board => taxesFinish(ctx, game, board, cost, []) });
}
function afterStaging(ctx: EngineContext, game: GameDefinition, state: VmState, cost: FieldCost): boolean {
  if (!conditionHolds(ctx, game, state, cost)) return false;
  if (cost.waived) return afterSkillResources(ctx, game, state, cost);
  return fieldPlans(ctx, game, state, cost, false).some(choice => {
    const board = structuredClone(state);
    chargeCost(ctx, game, board, [], cost.source.master, choice.payment, cost.source.card, game.actions.activate.cost ?? []);
    return afterSkillResources(ctx, game, board, cost);
  });
}
function afterCardResources(ctx: EngineContext, game: GameDefinition, state: VmState, cost: FieldCost): boolean {
  const board = structuredClone(state), staged = structuredClone(cost);
  return stageField(ctx, game, board, [], staged) && afterStaging(ctx, game, board, staged);
}
export function fieldPaymentRefusals(ctx: EngineContext, game: GameDefinition, state: VmState, master: PlayerId, line: ActivationLine, waived = false, alt?: VmAltCost, action?: Action): Requirement[] {
  const cost = createFieldCost(ctx, game, state, master, line, waived, alt);
  if (action) retainFieldSelection(state, cost, action);
  let payable = false;
  try {
    if (waived || cost.source.area !== "hand") payable = afterCardResources(ctx, game, state, cost);
    else if (alt) {
      const live = activationAlt(ctx, game, state, game.actions.activate, master, line)?.alt;
      if (canonical(live) === canonical(alt)) {
        const board = structuredClone(state); payAltCost(ctx, game, board, [], master, alt);
        payable = afterCardResources(ctx, game, board, cost);
      }
    } else payable = fieldPlans(ctx, game, state, cost, true).some(choice => {
      const board = structuredClone(state); chargeCost(ctx, game, board, [], master, choice.payment, line.card, game.actions.activate.cost ?? []);
      return afterCardResources(ctx, game, board, cost);
    });
  } catch (error) { if (!(error instanceof AutoPaymentFailed) && !(error instanceof IllegalAction && !(error instanceof NotYet))) throw error; }
  return payable ? [] : [{ kind: "other", detail: "the complete Field activation cost cannot be paid" }];
}
export function queueFieldCost(ctx: EngineContext, game: GameDefinition, state: VmState, master: PlayerId, line: ActivationLine, waived = false, alt?: VmAltCost, action?: Action): void {
  const cost = createFieldCost(ctx, game, state, master, line, waived, alt);
  if (action) retainFieldSelection(state, cost, action);
  if (!waived) cost.coupons = captureActivationEnergyUses(ctx, game, state, line.card, line.skill);
  state.programs.unshift({ ...fieldFrame(cost), fieldCost: cost });
}

function resourceFinishes(ctx: EngineContext, game: GameDefinition, state: VmState, cost: FieldCost, choice: FieldResourceChoice, cardEnergy: boolean): boolean {
  const board = structuredClone(state);
  chargeCost(ctx, game, board, [], cost.source.master, choice.payment, cost.source.card, game.actions.activate.cost ?? []);
  return cardEnergy ? afterCardResources(ctx, game, board, cost) : afterSkillResources(ctx, game, board, cost);
}
function payFieldResources(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame, cost: FieldCost, cardEnergy: boolean): "wait" | "paid" {
  cost.choices ??= fieldPlans(ctx, game, state, cost, cardEnergy).filter(choice => resourceFinishes(ctx, game, state, cost, choice, cardEnergy));
  if (!cost.choices.length) throw new AutoPaymentFailed("the remaining Field resources cannot be paid");
  if (cost.choices.length > 1 && frame.awaiting !== "fieldResources") {
    frame.awaiting = "fieldResources"; state.programs.unshift(frame);
    state.prompt = { kind: "chooseMode", player: frame.master, reason: cardEnergy ? "Pay the Field card's energy cost" : "Pay the Field skill cost", options: cost.choices.map(choice => choice.label) };
    return "wait";
  }
  const choice = cost.choices[cost.choices.length > 1 ? state.lastMode ?? -1 : 0];
  if (!choice) throw new IllegalAction("choose an offered Field resource payment");
  if (!choice.price || !choice.payment || !Array.isArray(choice.payment.rest)) throw new NotYet("rebuild the saved Field resource payment", "R457");
  if (!Array.isArray(choice.payers) || choice.payers.length !== choice.payment.rest.length || choice.payers.some((payer, i) => !payer || payer.card !== choice.payment.rest[i] || !Number.isSafeInteger(payer.epoch) || payer.epoch < 0 || (state.cards[payer.card]?.zoneEpoch ?? 0) !== payer.epoch)) throw new IllegalAction("a selected Field energy occurrence is no longer available");
  const price = fieldPrice(ctx, game, state, cost, cardEnergy);
  const current = planCost(ctx, game, state, frame.master, price, frame.card, choice.payment.rest);
  if (!current.ok || canonical(price) !== canonical(choice.price) || canonical(current.payment) !== canonical(choice.payment) || !resourceFinishes(ctx, game, state, cost, { ...choice, price, payment: current.payment }, cardEnergy)) throw new IllegalAction("that saved Field payment is no longer available");
  state.lastMode = null; delete frame.awaiting;
  chargeCost(ctx, game, state, ev, frame.master, current.payment, frame.card, game.actions.activate.cost ?? []);
  delete cost.choices;
  return "paid";
}
function stepFieldTaxes(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame, cost: FieldCost): "wait" | "paid" {
  for (;;) {
    const live = fieldTaxes(ctx, game, state, cost);
    if (cost.tax && (!cost.tax.identity || !Array.isArray(cost.tax.ops) || typeof cost.tax.accepted !== "boolean" || !cost.tax.payers)) throw new NotYet("rebuild the saved Field tax phase", "R457");
    const current = cost.tax && live.find(tax => tax.identity === cost.tax!.identity);
    if (current && canonical(current.ops) !== canonical(cost.tax!.ops)) throw new NotYet("rebuild changed Field tax instructions", "R457");
    if (cost.tax && !current) { delete cost.tax; frame.ops = []; frame.ip = 0; frame.vars = {}; delete frame.moveLoop; delete frame.awaiting; state.lastMode = null; state.lastChoice = null; }
    const next = live.find(tax => !cost.paidTaxes.includes(tax.identity!));
    if (!cost.tax && !next) return "paid";
    if (!cost.tax) {
      const problem = taxPayerProgramProblem(next!.ops);
      if (problem) throw new NotYet(problem, "R457");
      cost.tax = { identity: next!.identity!, ops: structuredClone(next!.ops), accepted: false, payers: {} };
      frame.awaiting = "fieldTax"; state.programs.unshift(frame);
      state.prompt = { kind: "chooseMode", player: frame.master, reason: "Pay the additional Field activation cost", options: ["Pay the additional cost", "Do not activate"] };
      return "wait";
    }
    const tax = cost.tax;
    if (!tax.accepted) {
      const answer = state.lastMode;
      if (frame.awaiting !== "fieldTax" || (answer !== 0 && answer !== 1)) throw new IllegalAction("answer the additional Field cost");
      state.lastMode = null; delete frame.awaiting;
      if (answer === 1) throw new AutoPaymentFailed("the additional Field cost was declined");
      tax.accepted = true; frame.ops = structuredClone(tax.ops); frame.ip = 0; frame.vars = {};
    }
    if (!fieldTaxExpansion(tax.ops, frame.ops)) throw new NotYet("rebuild the saved Field tax program", "R457");
    const problem = taxPayerProblem(state, frame.vars, tax.payers);
    if (problem === "malformed" || problem === "missing") throw new NotYet("rebuild the saved Field tax payer occurrences", "R457");
    if (problem === "stale") throw new AutoPaymentFailed("an unpaid Field tax payer left its occurrence");
    const strict = automaticPriceHost(ctx, game, state, ev, frame);
    const result = stepScript({ ...strict,
      resolveRef: (f, ref) => { captureTaxPayers(state, f.vars, tax.payers); return strict.resolveRef(f, ref); },
      move: (card, to, owner, opts) => { const epoch = state.cards[card]?.zoneEpoch ?? 0; const destination = strict.move(card, to, owner, opts); markTaxPayerPaid(tax.payers, card, epoch); return destination; },
    }, frame);
    if (result === "wait") { captureTaxPayers(state, frame.vars, tax.payers); return "wait"; }
    cost.paidTaxes.push(tax.identity); delete cost.tax; frame.ops = []; frame.ip = 0; frame.vars = {}; delete frame.moveLoop;
  }
}

export function stepFieldCost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const cost = frame.fieldCost;
  if (!Array.isArray(frame.ops) || !Number.isSafeInteger(frame.ip) || frame.ip < 0 || frame.ip > frame.ops.length || !frame.vars || typeof frame.vars !== "object" || Array.isArray(frame.vars) || !cost || cost.version !== 1 || !cost.line?.skill || !cost.line.script?.price || cost.line.skill.keyword?.name !== "Field" || !isFieldPayment(cost.line) || cost.line.card !== frame.card || cost.line.skillIndex !== frame.skillIndex || cost.line.skill.index !== frame.skillIndex || typeof cost.waived !== "boolean" || !["cardResources", "stageSource", "skillResources", "skillAction", "taxes", "activate"].includes(cost.stage) || !Array.isArray(cost.paidTaxes) || cost.paidTaxes.some(key => typeof key !== "string") || new Set(cost.paidTaxes).size !== cost.paidTaxes.length || typeof cost.originalArea !== "string" || !game.zones[cost.originalArea] || !cost.moment || cost.moment.card !== frame.card || cost.moment.controller !== frame.master || cost.moment.event !== "skillActivated" || cost.moment.args?.from !== cost.originalArea) throw new NotYet("rebuild this saved Field payment declaration", "R457");
  if ((cost.choices !== undefined && (!Array.isArray(cost.choices) || cost.choices.some(choice => !choice || typeof choice.label !== "string" || !choice.price || !choice.payment || !Array.isArray(choice.payers))))
    || (cost.requestedEnergy !== undefined && (!Array.isArray(cost.requestedEnergy) || cost.requestedEnergy.some(payer => !payer || typeof payer.card !== "string" || !Number.isSafeInteger(payer.epoch) || payer.epoch < 0) || new Set(cost.requestedEnergy.map(payer => payer.card)).size !== cost.requestedEnergy.length))) throw new NotYet("rebuild the saved Field resource choices", "R457");
  try {
    const problem = fieldSourceProblem(state, cost.source, frame.card, frame.master);
    if (!game.zones[cost.source.area]) throw new NotYet("rebuild the saved Field source area", "R457");
    if (problem) throw new AutoPaymentFailed(problem);
    if (cost.stage === "cardResources") {
      if (!cost.waived && cost.originalArea === "hand") {
        if (cost.alt) {
          const live = activationAlt(ctx, game, state, game.actions.activate, frame.master, cost.line)?.alt;
          if (canonical(live) !== canonical(cost.alt)) throw new IllegalAction("the selected Field alternative is no longer available");
          payAltCost(ctx, game, state, ev, frame.master, cost.alt);
        } else if (payFieldResources(ctx, game, state, ev, frame, cost, true) === "wait") return "wait";
      }
      cost.stage = "stageSource";
    }
    if (cost.stage === "stageSource") {
      if (cost.source.area === "hand") {
        const key = "§fieldStaging";
        const ops: Op[] = [{ op: "moveTo", target: { var: key }, to: "drop", cause: "rule", completedAs: "§fieldStaged" }];
        if (!frame.ops.length) { frame.ops = ops; frame.ip = 0; frame.vars = { [key]: [frame.card], [`${key}@epoch`]: [`${frame.card}@${cost.source.epoch}`] }; }
        if (canonical(frame.ops) !== canonical(ops) || canonical(frame.vars[key]) !== canonical([frame.card]) || canonical(frame.vars[`${key}@epoch`]) !== canonical([`${frame.card}@${cost.source.epoch}`])) throw new NotYet("rebuild the saved Field staging program", "R457");
        if (stepScript(fieldRuleHost(vmHost(ctx, game, state, ev)), frame) === "wait") return "wait";
        if (!completedMovement(frame, "§fieldStaged", 1, true)) throw new AutoPaymentFailed("the Field did not complete its required Drop staging");
        cost.source = captureFieldSource(ctx, state, frame.master, frame.card);
        if (cost.source.area !== "drop") throw new AutoPaymentFailed("the Field did not enter its owner's Drop");
      }
      frame.ops = []; frame.ip = 0; frame.vars = {}; delete frame.moveLoop;
      cost.stage = "skillResources";
    }
    if (cost.stage === "skillResources") {
      if (!conditionHolds(ctx, game, state, cost)) throw new AutoPaymentFailed("the Field activation condition is no longer met");
      if (!cost.waived && payFieldResources(ctx, game, state, ev, frame, cost, false) === "wait") return "wait";
      cost.stage = "skillAction"; frame.ops = cost.waived ? [] : fieldAction(cost.line); frame.ip = 0;
    }
    if (cost.stage === "skillAction") {
      if (canonical(frame.ops) !== canonical(cost.waived ? [] : fieldAction(cost.line))) throw new NotYet("rebuild the saved Field action price", "R457");
      if (stepScript(automaticPriceHost(ctx, game, state, ev, frame), frame) === "wait") return "wait";
      if (state.outcome) return "done";
      cost.stage = "taxes"; frame.ops = []; frame.ip = 0; frame.vars = {};
    }
    if (cost.stage === "taxes") {
      if (stepFieldTaxes(ctx, game, state, ev, frame, cost) === "wait") return "wait";
      if (state.outcome) return "done";
      cost.stage = "activate";
    }
    const sourceProblem = fieldSourceProblem(state, cost.source, frame.card, frame.master);
    if (sourceProblem || !conditionHolds(ctx, game, state, cost) || usesLeft(state, frame.master, frame.card, cost.line.skill) === 0
      || skillsNegated(state, frame.card) || skillNegated(state, frame.card, cost.line.skillIndex, cost.line.skill.kind)
      || forbiddenBy(ctx, game, state, "activateSkill", { player: frame.master, card: frame.card, skillKind: cost.line.kind, keyword: "Field", from: cost.originalArea }))
      throw new AutoPaymentFailed(sourceProblem ?? "the Field activation is no longer permitted");
    const key = "§fieldSource";
    const vars = { [key]: [frame.card], [`${key}@epoch`]: [`${frame.card}@${cost.source.epoch}`] };
    const ops: Op[] = [{ op: "moveTo", target: { sel: { fromVar: key, area: cost.source.area as import("./script").ScriptArea } }, to: "battle", mode: "active" }, ...(cost.line.script?.ops ?? [])];
    if (cost.coupons) consumeActivationEnergyUses(state, ev, cost.coupons);
    spendProhibitionUse(ctx, game, state, "activateSkill", { player: frame.master, card: frame.card, from: cost.originalArea, skillKind: cost.line.kind, keyword: "Field" });
    resolveActivation(ctx, game, state, ev, frame.master, cost.line, undefined, undefined, { ops, vars }, true);
    if (!cost.waived) spendSkillCostUses(ctx, game, state, ev, frame.card, cost.line.skill);
    fire(ctx, game, state, cost.moment);
    return "done";
  } catch (error) {
    if (!(error instanceof AutoPaymentFailed)) throw error;
    state.lastChoice = null; state.lastMode = null;
    const queued = state.programs.indexOf(frame); if (queued >= 0) state.programs.splice(queued, 1);
    log(ev, { type: "note", text: `Field activation failed: ${error.message}` });
    return "done";
  }
}


/** Old native Field DO frames could play a fresh hand/Drop occurrence. */
export function requireFieldFrame(frame: ScriptFrame): void {
  if (frame.viaKeyword !== "Field" || frame.fieldCost) return;
  if (!frame.vars || typeof frame.vars !== "object" || Array.isArray(frame.vars)) throw new NotYet("rebuild the saved Field effect source occurrence", "R457");
  const ids = frame.vars["§fieldSource"], epochs = frame.vars["§fieldSource@epoch"];
  const prefix = `${frame.card}@`;
  if (ids?.length !== 1 || ids[0] !== frame.card || epochs?.length !== 1 || typeof epochs[0] !== "string" || !epochs[0].startsWith(prefix) || !/^\d+$/.test(epochs[0].slice(prefix.length)) || !Number.isSafeInteger(Number(epochs[0].slice(prefix.length)))) throw new NotYet("rebuild the saved Field effect source occurrence", "R457");
}


/** The interpreter replaces conditional/mode nodes with their selected branch.
 * Validate that saved executable steps are one such expansion of the tax,
 * retaining every unrelated original instruction in its original position. */
function fieldTaxExpansion(original: Op[], current: Op[]): boolean {
  const sequence = (ops: Op[], start: number): Set<number> => {
    let positions = new Set([start]);
    for (const op of ops) {
      const next = new Set<number>();
      for (const position of positions) {
        if (position < current.length && canonical(op) === canonical(current[position])) next.add(position + 1);
        const branches = op.op === "if" ? [op.then, op.else ?? []] : op.op === "may" ? [op.ops, []] : op.op === "chooseMode" ? op.modes.map(mode => mode.ops) : [];
        for (const branch of branches) for (const end of sequence(branch, position)) next.add(end);
      }
      positions = next;
      if (!positions.size) break;
    }
    return positions;
  };
  return sequence(original, 0).has(current.length);
}
