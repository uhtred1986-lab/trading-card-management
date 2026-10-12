/** Auto payment planning and its stored checkpoint continuation (#549). */
import type { EngineContext, GameEvent, Skill } from "../types";
import type { GameDefinition } from "../rulesets";
import { selectedCount, stepScript, type Op, type Script, type ScriptFrame } from "./script";
import type { ScriptHost } from "./script-host";
import { vmHost } from "./host";
import { boundFor, scopedPayersSpent } from "./activate";
import { IllegalAction, sideOf } from "./common";
import { NotYet, RulesetBroken } from "./errors";
import { activeEnergy, cardColors, chargeCost, payersFor, planCost, priceFor, spendSkillCostUses, type Price, type VmPayment } from "./costs";
import { log } from "./events";
import type { VmState } from "./state";

/** 9-6-4: all costs are optional to pay; a condition alone is compulsory. */
export interface AutomaticCost {
  skill: Skill;
  effect: Op[];
  costs: string[];
  choices: { price: Price; payment: VmPayment; label: string; x?: number }[];
  stage: "offer" | "action";
}

/** A supported action-price must complete every instruction (5-8-2-2). */
export function automaticPriceHost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[]): ScriptHost {
  const host = vmHost(ctx, game, state, ev);
  const unpaid = () => { throw new IllegalAction("the Auto skill cost cannot be paid in its entirety"); };
  return {
    ...host,
    forbids: (what, opts) => {
      if (host.forbids(what, opts)) unpaid();
      return false;
    },
    resolveSelector: (f, sel) => {
      let found = host.resolveSelector(f, sel);
      const op = f.ops[f.ip];
      if (op?.op === "choose" && op.sel === sel) {
        const following = f.ops.slice(f.ip + 1).find((o) => (o.op === "switchMode" || o.op === "hidden") && "var" in o.target && o.target.var === op.as);
        if (following?.op === "switchMode") found = found.filter((id) => host.modeOf(id) !== following.mode);
        if (following?.op === "hidden") found = found.filter((id) => host.isHidden(id) !== following.hidden);
        const picked = f.awaiting === op.as ? f.vars[op.as] ?? [] : [];
        const all = [...new Set([...found, ...picked])];
        if (!sel.upTo && op.atMost === undefined && selectedCount(sel, all, host.nameOf) < (sel.count ?? 1)) unpaid();
      }
      return found;
    },
    resolveRef: (f, ref) => {
      const found = host.resolveRef(f, ref);
      const op = f.ops[f.ip];
      if ("var" in ref) {
        const chosen = f.ops.slice(0, f.ip).findLast((o) => o.op === "choose" && o.as === ref.var);
        if (chosen?.op === "choose" && !chosen.sel.upTo && chosen.atMost === undefined && selectedCount(chosen.sel, f.vars[ref.var] ?? [], host.nameOf) < (chosen.sel.count ?? 1)) unpaid();
      }
      if (["moveTo", "switchMode", "hidden", "removeMarker"].includes(op?.op) && !found.length && !("var" in ref && f.vars[ref.var]?.length === 0)) unpaid();
      return found;
    },
    amount: (f, amount) => {
      const n = host.amount(f, amount);
      const op = f.ops[f.ip];
      if (op?.op === "mill" && sideOf(f.master, op.side).some((p) => host.zone(p, "deck").length < n)) unpaid();
      return n;
    },
    move: (id, to, owner, opts) => {
      if (host.areaOf(id) === to) unpaid();
      const actual = host.move(id, to, owner, { ...opts, reason: "cost" });
      if (actual !== to || host.areaOf(id) !== to) unpaid();
      return actual;
    },
    setMode: (id, mode, by) => {
      if (host.modeOf(id) === mode || !host.setMode(id, mode, by)) unpaid();
      return true;
    },
    setHidden: (id, hidden, by) => {
      if (host.isHidden(id) === hidden) unpaid();
      host.setHidden(id, hidden, by);
      if (host.isHidden(id) !== hidden) unpaid();
    },
    changeMarkers: (id, delta) => {
      if (delta < 0 && host.markersOf(id) < -delta) unpaid();
      return host.changeMarkers(id, delta);
    },
  };
}

/** Preflight on an isolated board, including earlier instructions and all
 * source/event/X bindings. No cost, trigger or prompt escapes this simulation.
 * Choices are single-card interpreter answers, so every branch is replayable. */
export function canFinishAutomaticPrice(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame): boolean {
  let budget = 2000;
  const visit = (s: VmState, f: ScriptFrame): boolean => {
    if (--budget < 0) throw new NotYet("plan this Auto action price within the bounded choice search", "#549");
    s.programs = [];
    try {
      const result = stepScript(automaticPriceHost(ctx, game, s, []), f);
      if (result === "done") return true;
      if (s.programs[0] !== f) return false;
      const prompt = s.prompt;
      const answers = prompt.kind === "chooseCards" ? [ ...(prompt.choice.min === 0 ? [[]] : []), ...prompt.choice.candidates.map((id) => [id]) ] : [];
      for (const answer of answers) {
        const next = structuredClone(s);
        next.lastChoice = answer;
        if (visit(next, structuredClone(f))) return true;
      }
      return false;
    } catch (err) {
      if (err instanceof IllegalAction) return false;
      throw err;
    }
  };
  return visit(structuredClone(state), structuredClone({ ...frame, autoCost: undefined }));
}

/** Refuse unimplemented instructions explicitly, rather than calling an
 * unsupported price unaffordable or letting its effect run for free. */
function readableAutomaticPrice(ops: Op[]): void {
  for (const op of ops) {
    if (!["choose", "discard", "mill", "switchMode", "hidden", "moveTo", "removeMarker"].includes(op.op)
      || (op.op === "moveTo" && (op.to === "under" || op.to === "play"))) {
      throw new NotYet(`pay an Auto action price containing ${op.op}`, "#549");
    }
  }
}

/** Capture payment alternatives before asking; the Auto's master and source
 * stay on the frame even when its price moves the source (9-6 / 9-9). */
export function prepareAutomaticCost(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, skill: Skill, script: Script): AutomaticCost {
  const ops = script.price?.ops ?? [];
  readableAutomaticPrice(ops);
  const costs = game.actions.activate?.cost;
  if (!costs) throw new RulesetBroken(game.id, "automatic skill costs need the declared activation prices");
  const line = { card: frame.card, skillIndex: skill.index, skill, kind: skill.kind, script: { ...script, price: script.price ? { ...script.price, payWith: [] } : undefined } };
  const bound = boundFor(ctx, game, state, frame.master, line, false);
  for (const pw of script.price?.payWith ?? []) {
    for (const id of vmHost(ctx, game, state, []).resolveSelector(frame, pw.sel)) {
      (bound.payers ??= []).push({ id, colors: pw.as === "energy" ? cardColors(ctx, game, state, id) : [pw.as] });
    }
  }
  if (bound.unreadable) throw new NotYet("read this Auto's printed skill cost", "#549");
  const choices: AutomaticCost["choices"] = [];
  const x = script.price?.x;
  const min = x?.min ?? 0;
  const capacity = activeEnergy(game, state, frame.master).length + payersFor(ctx, game, state, frame.master, bound.payers).length + Number(state.sides[frame.master].attrs.energyMarkers ?? 0);
  const declaredMax = x?.max;
  if (!Number.isInteger(min) || min < 0 || (declaredMax !== undefined && (!Number.isInteger(declaredMax) || declaredMax < min))) throw new NotYet("read the bounds of this Auto's X cost", "#549");
  // A printed ceiling can be arbitrarily large; one unit of X consumes one
  // available resource, so this cap excludes no payable value.
  const max = x ? Math.min(declaredMax ?? capacity, capacity) : 0;
  for (let n = x ? min : 0; n <= max; n++) {
    const energy = bound.energy ?? { total: 0, orbs: {}, either: [] };
    const price = priceFor(ctx, game, state, game.actions.activate, frame.card, x ? { ...bound, energy: { ...energy, total: (energy.total ?? 0) + n } } : bound);
    const plan = planCost(ctx, game, state, frame.master, price, frame.card);
    if (!plan.ok) continue;
    const payments = plan.asks && plan.options.length > 1 ? plan.options.map((option) => planCost(ctx, game, state, frame.master, price, frame.card, option.rest)) : [plan];
    for (const paymentPlan of payments) {
      if (!paymentPlan.ok) continue;
      const clone = structuredClone(state);
      try {
        chargeAutomaticPayment(ctx, game, clone, [], frame, paymentPlan.payment, costs);
      } catch (err) {
        if (err instanceof IllegalAction) continue;
        throw err;
      }
      const paying = { ...frame, ops, ...(x ? { x: n } : {}) };
      if (!canFinishAutomaticPrice(ctx, game, clone, paying)) continue;
      choices.push({ price, payment: paymentPlan.payment, label: `${x ? `X = ${n}; ` : ""}${paymentPlan.describe || "pay the skill cost"}`, ...(x ? { x: n } : {}) });
    }
  }
  return { skill, effect: frame.ops, costs, choices, stage: "offer" };
}

/** Finish the activation only after the entire action price completed. */
export function finishAutomaticCost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): void {
  const cost = frame.autoCost!;
  const inst = state.cards[frame.card];
  if (inst && (cost.skill.oncePerTurn || cost.skill.limit != null)) inst.usedThisTurn.push(cost.skill.index);
  spendSkillCostUses(state, ev, frame.card, cost.skill);
  log(ev, { type: "skill", card: frame.card, skill: frame.skillIndex ?? cost.skill.index, master: frame.master, text: cost.skill.raw, inBattle: !!state.battle });
  const effect = { ...frame, ops: cost.effect, ip: 0 };
  delete effect.autoCost;
  delete effect.awaiting;
  state.programs.unshift(effect);
}


/** Verify declared resource instructions completed too: Burst/life movement
 * replacements cannot turn a known price into a partial payment (5-8-2-2). */
function chargeAutomaticPayment(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame, payment: VmPayment, costs: string[]): void {
  for (const id of payment.rest) {
    if (state.cards[id]?.mode !== "active") throw new IllegalAction("this Auto payment is no longer payable");
  }
  chargeCost(ctx, game, state, ev, frame.master, payment, frame.card, costs);
  for (const pooled of payment.pooled) {
    const op = game.costs[pooled.cost]?.do[0];
    if (op?.op !== "moveTo") throw new NotYet("verify this Auto's pooled payment", "#549");
    for (const id of pooled.cards) {
      const where = Object.values(state.sides).some((side) => side.zones[op.to]?.includes(id));
      if (!where) throw new IllegalAction("the Auto's pooled skill cost was replaced and cannot be paid");
    }
  }
}

/** JSONB reload may reorder object keys; compare payment values, not encoding. */
function sameAutomaticPayment(a: VmPayment, b: VmPayment): boolean {
  const ids = (x: string[], y: string[]) => x.length === y.length && x.every((id, i) => id === y[i]);
  return a.energyMarkers === b.energyMarkers && a.markers === b.markers && a.restsSelf === b.restsSelf
    && ids(a.rest, b.rest) && ids(a.life, b.life)
    && a.pooled.length === b.pooled.length && a.pooled.every((p, i) => p.cost === b.pooled[i].cost && ids(p.cards, b.pooled[i].cards))
    && a.markersOff.length === b.markersOff.length && a.markersOff.every((p, i) => {
      const q = b.markersOff[i];
      return p.cost === q.cost && p.side === q.side && p.area === q.area && p.n === q.n && p.by === q.by;
    });
}

/** Set the paid cursor before running any action price; reload cannot charge
 * the same energy/marker/Burst/Spirit Boost payment a second time. */
export function beginAutomaticCost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame, choice: AutomaticCost["choices"][number]): void {
  const cost = frame.autoCost!;
  const rechecked = planCost(ctx, game, state, frame.master, choice.price, frame.card, choice.payment.rest);
  if (!rechecked.ok || !sameAutomaticPayment(rechecked.payment, choice.payment)) throw new IllegalAction("this Auto payment is no longer payable");
  const clone = structuredClone(state);
  chargeAutomaticPayment(ctx, game, clone, [], frame, choice.payment, cost.costs);
  if (!canFinishAutomaticPrice(ctx, game, clone, { ...frame, ...(choice.x !== undefined ? { x: choice.x } : {}) })) throw new IllegalAction("this Auto's complete payment is no longer payable");
  const spent = scopedPayersSpent(ctx, game, state, frame.master, { card: frame.card, skillIndex: cost.skill.index, skill: cost.skill, kind: cost.skill.kind, script: undefined });
  cost.stage = "action";
  if (choice.x !== undefined) frame.x = choice.x;
  chargeAutomaticPayment(ctx, game, state, ev, frame, choice.payment, cost.costs);
  spent(choice.payment.rest);
}
