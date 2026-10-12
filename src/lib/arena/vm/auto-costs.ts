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
import { hasPossibleReplacement, possibleAltPaymentReplacement, staticsNow } from "./program";
import type { VmState } from "./state";
import { skillsShowing } from "./triggers";
import { inPlayZones } from "./zones";

/** 5-8-4: a legal replacement failed an attempted payment. Retain the
 * already performed payment/replacement, then cancel activation. */
export class AutoPaymentFailed extends Error {}

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
    // Paying is a cost, so a replacement limited to an effect or its actor
    // does not answer this departure (5-8-2-2 / causeMatches).
    replacementsFor: (id, _reason, opts) => host.replacementsFor(id, "cost", { ...opts, actor: undefined }),
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
      if (op?.op === "reveal" && op.sel === sel && selectedCount(sel, found, host.nameOf) < (sel.count ?? 1)) unpaid();
      return found;
    },
    resolveRef: (f, ref) => {
      const found = host.resolveRef(f, ref);
      const op = f.ops[f.ip];
      if (op?.op === "moveTo" && op.to === "under" && ref === op.target) {
        const under = op.under ? host.resolveRef(f, op.under) : [f.card];
        if (under.length !== 1 || !state.cards[under[0]]) unpaid();
      }
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
      if (actual !== to || host.areaOf(id) !== to) {
        const replaced = opts?.replaced;
        if (replaced?.deferred && replaced.ops?.length) state.programs.unshift({ ops: replaced.ops, ip: 0, vars: {}, card: replaced.source ?? id, master: replaced.master ?? host.masterOf(id), subject: id, replacing: id, ...(replaced.skillIndex !== undefined ? { skillIndex: replaced.skillIndex } : {}) });
        throw new AutoPaymentFailed("a replacement caused the Auto skill cost payment to fail");
      }
      return actual;
    },
    placeUnder: (id, top) => {
      if (id === top || !state.cards[id] || !state.cards[top] || state.cards[top].under.includes(id) || !host.placeUnder(id, top)
        || !state.cards[top].under.includes(id)) unpaid();
      return true;
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

/** One exact dead end, before expanding a hand choice. The only remaining
 * movement is of cards chosen from the hand to the Drop, so it cannot stand an
 * already-rested source up for the final mandatory self-rest. Keep this narrow:
 * an aliased choice, another destination, a replacement or a nested reference
 * can make the intervening movement affect the source. */
function mayReplacePriceMove(ctx: EngineContext, game: GameDefinition, state: VmState): boolean {
  if (state.effects.length) return true;
  for (const side of Object.values(state.sides)) {
    for (const zone of inPlayZones(game)) {
      for (const id of side.zones[zone] ?? []) {
        const showing = skillsShowing(ctx, state, id);
        for (const skill of showing.skills) {
          if (skill.kind !== "permanent") continue;
          const program = showing.scripts.bySkill[skill.index];
          if (program && hasPossibleReplacement(program.ops)) return true;
        }
      }
    }
  }
  return possibleAltPaymentReplacement(game) || staticsNow(ctx, game, state).some((effect) => effect.kind === "replaceLeave");
}

function cannotRestSourceAfterHandPrice(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame): boolean {
  const [choose, move, rest, ...extra] = frame.ops.slice(frame.ip);
  if (extra.length || choose?.op !== "choose" || move?.op !== "moveTo" || rest?.op !== "switchMode") return false;
  if (rest.mode !== "rest" || Object.keys(rest).some((key) => !["op", "target", "mode"].includes(key))) return false;
  if (!("sel" in rest.target) || rest.target.sel.special !== "self" || Object.keys(rest.target.sel).length !== 1) return false;
  if (Object.keys(choose).some((key) => !["op", "sel", "as", "reason"].includes(key))) return false;
  const sel = choose.sel;
  if (sel.side !== "you" || sel.area !== "hand" || !Number.isInteger(sel.count) || (sel.count ?? 0) < 1
    // Compiler selectors carry undefined defaults for filters and alternate
    // sources. Only a *set* extra field changes what "from hand" can mean.
    || Object.entries(sel).some(([key, value]) => value !== undefined && !["side", "area", "count", "upTo"].includes(key))) return false;
  if (move.to !== "drop" || Object.keys(move).some((key) => !["op", "target", "to", "reveal"].includes(key))
    || !("var" in move.target) || move.target.var !== choose.as || Object.keys(move.target).length !== 1) return false;
  const source = state.cards[frame.card];
  const host = vmHost(ctx, game, state, []);
  if (!source || source.mode !== "rest" || !["battle", "unison", "energy"].includes(host.areaOf(frame.card) ?? "")) return false;
  // resolveSelector includes already-picked cards on a resumed choice. A saved
  // alias to the source must not be mistaken for an ordinary hand candidate.
  const hand = new Set(host.zone(frame.master, "hand"));
  if (hand.has(frame.card) || (frame.vars[choose.as] ?? []).some((id) => !hand.has(id))
    || state.lastChoice?.some((id) => !hand.has(id)) || frame.moveLoop || frame.replacing) return false;
  // A cost-move replacement can run another program, including a mode reset.
  // A [Permanent] whose condition is false now can become active after the
  // first hand departure. Read every in-play source's actual record/copy
  // program, including both conditional branches, before excluding that path.
  // No remaining move puts a new Permanent source in play. A keyword
  // wouldLeave hook only answers departures from held areas, not this hand.
  return !mayReplacePriceMove(ctx, game, state);
}

/** A pure hand payment immediately feeds a later named Drop payment. Count
 * only cards which could actually enter that Drop: already saved picks and at
 * most the slots left in the first choice. This is a necessary condition, not
 * a replacement for replaying the price. A replacement, computed filter,
 * different chooser, or saved card outside the hand falls back to the full
 * interpreter search. Candidate order is only a heuristic; no branch is
 * omitted on that account. */
function directNamedTransfer(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, candidates: string[]): { enough: boolean; favored: Set<string> } | null {
  const [first, move, second, finish, ...extra] = frame.ops.slice(frame.ip);
  if (extra.length || first?.op !== "choose" || move?.op !== "moveTo" || second?.op !== "choose" || finish?.op !== "moveTo") return null;
  const simple = (value: object, allowed: string[]) => Object.entries(value).every(([key, field]) => field === undefined || allowed.includes(key));
  if (!simple(first, ["op", "sel", "as", "reason"]) || !simple(first.sel, ["side", "area", "count", "upTo"])
    || first.sel.side !== "you" || first.sel.area !== "hand" || first.sel.upTo || !Number.isInteger(first.sel.count) || (first.sel.count ?? 0) < 1
    || !simple(move, ["op", "target", "to", "reveal"]) || move.to !== "drop" || !("var" in move.target) || move.target.var !== first.as || !simple(move.target, ["var"])
    || !simple(second, ["op", "sel", "as", "reason"]) || !simple(second.sel, ["side", "area", "filter", "count", "upTo"])
    || second.sel.side !== "you" || second.sel.area !== "drop" || second.sel.upTo || !Number.isInteger(second.sel.count) || (second.sel.count ?? 0) < 1
    || !simple(finish, ["op", "target", "to", "reveal"]) || finish.to !== "warp" || !("var" in finish.target) || finish.target.var !== second.as || !simple(finish.target, ["var"])) return null;
  const filter = second.sel.filter;
  if (!filter?.names?.length || Object.entries(filter).some(([key, value]) => key !== "names" && value !== undefined && value !== null && value !== false && !(Array.isArray(value) && value.length === 0))) return null;
  const hand = new Set(state.sides[frame.master].zones.hand);
  const saved = frame.awaiting === first.as ? frame.vars[first.as] ?? [] : [];
  if (saved.some((id) => !hand.has(id)) || state.lastChoice?.some((id) => !hand.has(id)) || frame.moveLoop || frame.replacing || mayReplacePriceMove(ctx, game, state)) return null;
  // Even a Permanent with no replacement might make a selected card's
  // identity depend on the number of cards still in hand or Drop.
  for (const side of Object.values(state.sides)) for (const zone of inPlayZones(game)) for (const id of side.zones[zone] ?? []) {
    if (skillsShowing(ctx, state, id).skills.some((skill) => skill.kind === "permanent")) return null;
  }
  // Ask the same selector that the later interpreter step will ask. Printed
  // names alone miss case folding, a shown back face and additional names.
  const now = vmHost(ctx, game, state, []);
  const fromDrop = now.resolveSelector(frame, second.sel).length;
  const matchingHand = new Set(now.resolveSelector(frame, { ...second.sel, area: "hand" }));
  const eligible = (id: string): boolean | null => {
    const card = state.cards[id];
    const def = card && ctx.defs[card.cardId];
    // A plain, skill-less front face keeps its printed name through this
    // hand departure. The selector still supplies its own case/alias rules.
    // Faces, added names and own-skill choice restrictions use projection.
    if (card && def && !card.flipped && !card.hidden && !def.back && !def.alsoNames?.length && !def.skill) return matchingHand.has(id);
    const projected = structuredClone(state);
    const host = vmHost(ctx, game, projected, []);
    if (host.replacementsFor(id, "cost", { actor: undefined, requestedTo: "drop" }).length) return null;
    try {
      if (host.move(id, "drop", host.ownerOf(id), { reason: "cost" }) !== "drop" || host.areaOf(id) !== "drop") return null;
    } catch (err) {
      if (err instanceof IllegalAction) return null;
      throw err;
    }
    return host.resolveSelector(frame, second.sel).includes(id);
  };
  const favored = new Set<string>();
  let fromSaved = 0;
  for (const id of new Set([...saved, ...candidates])) {
    const matches = eligible(id);
    if (matches === null) return null;
    if (matches) {
      if (saved.includes(id)) fromSaved++;
      else favored.add(id);
    }
  }
  const remaining = Math.max(0, (first.sel.count ?? 0) - saved.length);
  return { enough: fromDrop + fromSaved + Math.min(remaining, favored.size) >= (second.sel.count ?? 0), favored };
}

/** Preflight on an isolated board, including earlier instructions and all
 * source/event/X bindings. No cost, trigger or prompt escapes this simulation.
 * Choices are single-card interpreter answers, so every branch is replayable. */
export function canFinishAutomaticPrice(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame): boolean {
  // Other price grammars can have order-dependent choices and replacements.
  // Keep an explicit unknown when their search is too large; never equate an
  // unfinished proof with an unaffordable price.
  let budget = 2000;
  const failed = new Set<string>();
  const visit = (s: VmState, f: ScriptFrame): boolean => {
    if (--budget < 0) throw new NotYet("plan this Auto action price within the bounded choice search", "#549");
    if (cannotRestSourceAfterHandPrice(ctx, game, s, f)) return false;
    // The same exact board, stored aliases and answer cursor has the same
    // continuations. This caches only proven failures; chosen order is kept.
    const key = JSON.stringify([s, f]);
    if (failed.has(key)) return false;
    s.programs = [];
    try {
      const result = stepScript(automaticPriceHost(ctx, game, s, []), f);
      if (result === "done") return true;
      if (s.programs[0] !== f) return false;
      const prompt = s.prompt;
      const choices = prompt.kind === "chooseCards" ? [ ...(prompt.choice.min === 0 ? [[]] : []), ...prompt.choice.candidates.map((id) => [id]) ] : [];
      const modes = prompt.kind === "replaceMove" || prompt.kind === "chooseMode" ? prompt.options.map((_, index) => index) : [];
      const transfer = prompt.kind === "chooseCards" ? directNamedTransfer(ctx, game, s, f, prompt.choice.candidates) : null;
      if (transfer && !transfer.enough) return false;
      const ordered = transfer ? choices.sort((a, b) => Number(transfer.favored.has(b[0])) - Number(transfer.favored.has(a[0]))) : choices;
      for (const answer of [...ordered.map((cards) => ({ cards })), ...modes.map((index) => ({ index }))]) {
        const next = structuredClone(s);
        if ("cards" in answer) next.lastChoice = answer.cards;
        else next.lastMode = answer.index;
        if (visit(next, structuredClone(f))) return true;
      }
      failed.add(key);
      return false;
    } catch (err) {
      // NotYet is an IllegalAction too, but an incomplete search cannot
      // establish that the entire price is unaffordable.
      if (err instanceof NotYet) throw err;
      if (err instanceof IllegalAction || err instanceof AutoPaymentFailed) return false;
      throw err;
    }
  };
  return visit(structuredClone(state), structuredClone({ ...frame, autoCost: undefined }));
}

/** Refuse unimplemented instructions explicitly, rather than calling an
 * unsupported price unaffordable or letting its effect run for free. */
export function readableAutomaticPrice(ops: Op[], label = "Auto", owner = "#549"): void {
  const pays = (branch: Op[]): boolean => branch.some((op) => op.op === "moveTo" || op.op === "discard" || op.op === "mill"
    || op.op === "switchMode" || op.op === "hidden" || op.op === "removeMarker" || op.op === "reveal"
    || (op.op === "if" && !!op.else?.length && pays(op.then) && pays(op.else))
    || (op.op === "chooseMode" && op.modes.length > 0 && op.modes.every((mode) => pays(mode.ops))));
  const check = (steps: Op[], nested: boolean): void => {
    for (const [index, op] of steps.entries()) {
      if (op.op === "note" && op.text.startsWith("\u0000probe-path:")) continue;
      if (op.op === "if") {
        if (!op.else?.length || !pays(op.then) || !pays(op.else)) throw new NotYet(`pay ${label} conditional action price with an empty branch`, owner);
        check(op.then, true);
        check(op.else, true);
        continue;
      }
      if (op.op === "chooseMode") {
        if (!op.modes.length || op.modes.some((mode) => !pays(mode.ops))) throw new NotYet(`pay ${label} modal action price with an empty option`, owner);
        for (const mode of op.modes) check(mode.ops, true);
        continue;
      }
      if (op.op === "reveal" && !op.sel.upTo && op.audience !== "you") continue;
      // Shuffling is permitted only after another payable step and at the
      // very end: no later price selector can depend on its random order.
      if (op.op === "shuffle" && !nested && index === steps.length - 1 && !op.inspectedOnly && pays(steps.slice(0, index))) continue;
      if (!["choose", "discard", "mill", "switchMode", "hidden", "moveTo", "removeMarker"].includes(op.op)
        || (op.op === "moveTo" && op.to === "play")) {
        throw new NotYet(`pay ${label} action price containing ${op.op}`, owner);
      }
    }
  };
  check(ops, false);
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
export function finishAutomaticCost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame & { autoRevealEpoch?: number }): void {
  const cost = frame.autoCost!;
  const inst = state.cards[frame.card];
  if (inst && (cost.skill.oncePerTurn || cost.skill.limit != null)) inst.usedThisTurn.push(cost.skill.index);
  spendSkillCostUses(state, ev, frame.card, cost.skill);
  log(ev, { type: "skill", card: frame.card, skill: frame.skillIndex ?? cost.skill.index, master: frame.master, text: cost.skill.raw, inBattle: !!state.battle,
    ...(frame.autoRevealEpoch === undefined ? {} : { reveal: true as const, revealEpoch: frame.autoRevealEpoch }) });
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
