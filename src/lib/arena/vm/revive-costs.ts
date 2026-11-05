/** 22-34-3: optional original-colour hand payment precedes the live Auto price. */
import type { EngineContext, GameEvent, Skill } from "../types";
import type { GameDefinition, KeywordDef } from "../rulesets";
import { automaticPriceHost, canFinishAutomaticPrice, chargeAutomaticPayment, finishAutomaticCost, prepareAutomaticCost } from "./auto-costs";
import { activationTaxes, type TaxGate } from "./activate";
import { vmHost } from "./host";
import { NotYet } from "./errors";
import type { Cond } from "./script";
import { IllegalAction } from "./common";
import { log } from "./events";
import { revivePrograms } from "./keyword-do";
import { stepScript, type Op, type Script, type ScriptFrame } from "./script";
import type { VmState } from "./state";

export interface ReviveSource { version: 1; card: string; cardId: string; epoch: number }
const SOURCE = "§reviveSource";
const CONTRACT = "§reviveSourceContract";
/** A pending Auto may activate after its source leaves, but its native effect
 * must not negate/play a fresh occurrence (3-1-4; 22-34-4). */
export function requireReviveFrame(state: VmState, frame: ScriptFrame): void {
  if (frame.viaKeyword !== "Revive") return;
  let source: ReviveSource | undefined;
  try { source = JSON.parse(frame.vars[CONTRACT]?.[0] ?? "null") as ReviveSource; } catch { /* rebuild below */ }
  if (!source || source.version !== 1 || source.card !== frame.card || typeof source.cardId !== "string" || state.cards[frame.card]?.cardId !== source.cardId || !Number.isSafeInteger(source.epoch) || source.epoch < 0 || frame.vars[SOURCE]?.length !== 1 || frame.vars[SOURCE][0] !== source.card || frame.vars[`${SOURCE}@epoch`]?.length !== 1 || frame.vars[`${SOURCE}@epoch`][0] !== `${source.card}@${source.epoch}`) throw new NotYet("rebuild saved Revive source/effect occurrence", "R467");
  if (state.cards[frame.card]?.owner !== frame.master || frame.autoCost?.taxGate && !frame.autoCost.reviveTax || frame.autoCost?.reviveTax && !frame.autoCost.taxGate) throw new NotYet("rebuild saved Revive owner/tax contract", "R467");
  const saved = frame.reviveCost?.source ?? frame.autoCost?.reviveSource;
  if (saved && (saved.version !== source.version || saved.card !== source.card || saved.cardId !== source.cardId || saved.epoch !== source.epoch)) throw new NotYet("rebuild inconsistent Revive payment source", "R467");
  if (frame.reviveCost && !frame.reviveCost.source || frame.autoCost && !frame.autoCost.reviveSource) throw new NotYet("rebuild unbound Revive payment", "R467");
}
function boundRevivePayment(ops: Op[]): Op[] {
  const condition = (cond: Cond): Cond => {
    if (cond.kind === "all" || cond.kind === "any") return { ...cond, conds: cond.conds.map(condition) };
    if (cond.kind === "count" && cond.sel.special === "self") return { ...cond, sel: { ...cond.sel, special: undefined, fromVar: SOURCE } };
    return cond;
  };
  return ops.map(op => op.op === "if" ? { ...op, cond: condition(op.cond), then: boundRevivePayment(op.then), ...(op.else ? { else: boundRevivePayment(op.else) } : {}) } : op);
}

export interface ReviveCost {
  skill: Skill;
  source: ReviveSource;
  script: Script;
  effect: Op[];
  variable: string;
  paid: string[];
  payers: { card: string; epoch: number }[];
  taxGate?: Omit<TaxGate, "guards">;
}

function reviveCostFrame(game: GameDefinition, state: VmState, frame: ScriptFrame, keyword: KeywordDef, skill: Skill, script: Script, taxGate: Omit<TaxGate, "guards"> | null = null): ScriptFrame {
  const program = revivePrograms(game, keyword, skill);
  const source: ReviveSource = { version: 1, card: frame.card, cardId: state.cards[frame.card].cardId, epoch: state.cards[frame.card].zoneEpoch ?? 0 };
  const sel = { fromVar: SOURCE, side: "you" as const, area: "drop" as const };
  const effect: Op[] = [{ op: "if", cond: { kind: "count", sel, atLeast: 1 }, then: program.effect.map(op => op.op === "play" ? { ...op, target: { sel } } : op) }];
  return { ...frame, vars: { ...frame.vars, [SOURCE]: [source.card], [`${SOURCE}@epoch`]: [`${source.card}@${source.epoch}`], [CONTRACT]: [JSON.stringify(source)] }, ops: boundRevivePayment(program.payment), reviveCost: { skill, source, script, effect, variable: program.variable, paid: [], payers: [], ...(taxGate ? { taxGate } : {}) } };
}

export function queueReviveCost(game: GameDefinition, state: VmState, frame: ScriptFrame, keyword: KeywordDef, skill: Skill, script: Script, taxGate: Omit<TaxGate, "guards"> | null = null): void {
  state.programs.unshift(reviveCostFrame(game, state, frame, keyword, skill, script, taxGate));
}
/** The new activation-tax route proves all ordered costs, not the initial
 * board alone: color cards can supply a Drop tax or compete with a hand tax. */
function afterColorsPayable(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, cost: ReviveCost): boolean {
  const selected = frame.vars[cost.variable] ?? [];
  if (!selected.length || selected.some(id => !frame.reviveCost?.paid.includes(id))) return false;
  if (cost.script.price?.condition && !vmHost(ctx, game, state, []).condHolds(frame, cost.script.price.condition)) return false;
  const effect = { ...frame, ops: cost.effect, ip: 0 };
  const plan = prepareAutomaticCost(ctx, game, state, effect, cost.skill, cost.script);
  const gate = cost.taxGate;
  const taxes = (board: VmState, paid: string[]): boolean => {
    if (!gate) return true;
    const next = activationTaxes(ctx, game, board, gate.player, gate.card, gate.skillKind, gate.from).find(t => !paid.includes(t.key) && !gate.free.includes(t.key));
    return !next || canFinishAutomaticPrice(ctx, game, board, { ...effect, ops: next.ops, ip: 0 }, { symmetry: false, complete: after => taxes(after, [...paid, next.key]) });
  };
  return plan.choices.some(choice => {
    const board = structuredClone(state), paying = { ...effect, ops: cost.script.price?.ops ?? [], ip: 0, ...(choice.x === undefined ? {} : { x: choice.x }) };
    chargeAutomaticPayment(ctx, game, board, [], paying, choice.payment, plan.costs);
    return canFinishAutomaticPrice(ctx, game, board, paying, { symmetry: false, complete: after => taxes(after, gate?.paid ?? []) });
  });
}
function completeColorAnswer(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, answer: string[]): boolean {
  const board = structuredClone(state); board.lastChoice = answer;
  return canFinishAutomaticPrice(ctx, game, board, frame, { symmetry: false, complete: (after, paid) => afterColorsPayable(ctx, game, after, paid, frame.reviveCost!) });
}
function feasibleColorSets(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, candidates: string[]): string[][] {
  const answers: string[][] = [];
  // Revive's verified declaration chooses at most two cards. Enumerating the
  // full sets also covers two mono-color cards; a one-card search cannot.
  for (let i = 0; i < candidates.length; i++) {
    const one = [candidates[i]];
    if (completeColorAnswer(ctx, game, state, frame, one)) answers.push(one);
    for (let j = i + 1; j < candidates.length && !(frame.vars[frame.reviveCost!.variable]?.length); j++) {
      const two = [candidates[i], candidates[j]];
      if (completeColorAnswer(ctx, game, state, frame, two)) answers.push(two);
    }
  }
  return answers;
}
export function reviveCostPayable(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, keyword: KeywordDef, skill: Skill, script: Script, taxGate: Omit<TaxGate, "guards">): boolean {
  const board = structuredClone(state), paying = reviveCostFrame(game, board, frame, keyword, skill, script, taxGate);
  board.programs = []; board.lastChoice = null; board.lastMode = null;
  const result = stepScript(automaticPriceHost(ctx, game, board, []), paying);
  return result === "wait" && board.prompt.kind === "chooseCards" && paying.awaiting === paying.reviveCost!.variable && feasibleColorSets(ctx, game, board, paying, board.prompt.choice.candidates).length > 0;
}

/** Unlike Aegis, an empty or incomplete optional selection spends nothing.
 * Once the covered set is accepted, retain each actual cost on failure. */
export function stepReviveCost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const cost = frame.reviveCost!;
  if (!Array.isArray(cost.payers) || cost.payers.some(p => !p || typeof p.card !== "string" || !Number.isSafeInteger(p.epoch) || p.epoch < 0) || new Set(cost.payers.map(p => p.card)).size !== cost.payers.length || (frame.vars[cost.variable] ?? []).some(id => !cost.payers.some(p => p.card === id))) throw new NotYet("rebuild saved Revive color payer occurrences", "R467");
  for (const payer of cost.payers) if (!cost.paid.includes(payer.card) && (state.cards[payer.card]?.zoneEpoch ?? 0) !== payer.epoch) throw new IllegalAction("that Revive color payer occurrence is no longer available");
  if (cost.taxGate && frame.awaiting === cost.variable && state.lastChoice?.length) {
    const vars = { ...frame.vars, [cost.variable]: [...(frame.vars[cost.variable] ?? []), ...state.lastChoice] };
    const colors = cost.skill.keyword?.name === "Revive" ? cost.skill.keyword.colors : [];
    const covered = vmHost(ctx, game, state, []).condHolds({ ...frame, vars }, { kind: "covers", sel: { fromVar: cost.variable }, colors, original: true });
    if (covered && !completeColorAnswer(ctx, game, state, frame, state.lastChoice)) throw new IllegalAction("that Revive color answer cannot complete all of its costs");
  }
  const host = automaticPriceHost(ctx, game, state, ev, frame);
  const result = stepScript({
    ...host,
    resolveSelector: (f, sel) => {
      const ids = host.resolveSelector(f, sel);
      const op = f.ops[f.ip];
      if (op?.op === "choose" && op.sel === sel && f.awaiting === op.as
        && [...(f.vars[op.as] ?? []), ...(state.lastChoice ?? [])].some((id) => !ids.includes(id))) {
        throw new IllegalAction("that Revive color payment is no longer available");
      }
      if (op?.op === "choose" && op.sel === sel && f.awaiting === cost.variable) {
        for (const id of state.lastChoice ?? []) if (ids.includes(id) && !cost.payers.some(p => p.card === id)) cost.payers.push({ card: id, epoch: state.cards[id].zoneEpoch ?? 0 });
      }
      return ids;
    },
    move: (id, to, owner, opts) => {
      if (host.areaOf(id) !== "hand") throw new IllegalAction("a Revive color payment must still be in hand");
      const actual = host.move(id, to, owner, opts);
      return actual;
    },
  }, frame);
  if (result === "wait") {
    if (cost.taxGate && state.prompt.kind === "chooseCards" && frame.awaiting === cost.variable) {
      const feasible = new Set(feasibleColorSets(ctx, game, state, frame, state.prompt.choice.candidates).flat());
      state.prompt.choice.candidates = state.prompt.choice.candidates.filter(id => feasible.has(id));
    }
    return result;
  }
  const selected = frame.vars[cost.variable] ?? [];
  if (!selected.length || selected.length !== cost.paid.length || selected.some((id) => !cost.paid.includes(id))) return "done";

  // The hand departure may change modifiers, alternative payers or action
  // price targets. Determine all supported additional costs on this board.
  if (cost.script.price?.condition && !host.condHolds(frame, cost.script.price.condition)) {
    log(ev, { type: "note", text: "Revive activation failed: its additional skill cost condition does not hold" });
    return "done";
  }
  const effect = { ...frame, ops: cost.effect, ip: 0 };
  delete effect.reviveCost;
  delete effect.awaiting;
  delete effect.moveLoop;
  const autoCost = prepareAutomaticCost(ctx, game, state, effect, cost.skill, cost.script);
  if (!autoCost.choices.length) {
    log(ev, { type: "note", text: "Revive activation failed: its additional skill cost is unaffordable" });
    return "done";
  }
  autoCost.reviveSource = cost.source;
  if (cost.taxGate) { autoCost.taxGate = cost.taxGate; autoCost.reviveTax = { version: 1, phase: "printed" }; }
  effect.autoCost = autoCost;
  const priced = Object.values(cost.skill.energyCost).some((n) => n > 0) || cost.skill.energyEither.length > 0
    || cost.skill.markerCost != null || cost.skill.burst != null || cost.skill.spiritBoost != null
    || cost.script.price?.ops?.length || cost.script.price?.x;
  if (priced) state.programs.unshift({ ...effect, ops: cost.script.price?.ops ?? [] });
  else finishAutomaticCost(ctx, game, state, ev, effect);
  return "done";
}
