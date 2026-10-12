/** 22-30-3: Aegis pays its hand cards before determining any additional cost. */
import type { Area, EngineContext, GameEvent, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import { activationMoment, boundFor, keywordActivationMoments, resolveActivation, scopedPayersSpent, type ActivationLine } from "./activate";
import { automaticPriceHost } from "./auto-costs";
import { chargeCost, chargesOf, planCost, priceFor, type Price, type VmPayment } from "./costs";
import { fire, log } from "./events";
import { IllegalAction } from "./common";
import { aegisPrograms, keywordAfterProgram } from "./keyword-do";
import { NotYet, RulesetBroken } from "./errors";
import { stepScript, type Op, type ScriptFrame } from "./script";
import type { VmState } from "./state";
import { inPlayZones } from "./zones";

export interface AegisCost {
  line: ActivationLine;
  costs: string[];
  effect: Op[];
  stage: "colors" | "additional";
  choices?: { price: Price; payment: VmPayment; label: string }[];
}

/** Declaring Aegis has not activated it: limits and events remain unspent. */
export function queueAegisCost(game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, costs: string[], x?: number): void {
  if (!line.keyword) throw new RulesetBroken(game.id, "Aegis activation has no keyword declaration");
  const program = aegisPrograms(game, line.keyword, line.skill);
  state.programs.unshift({
    ops: program.payment, ip: 0, vars: {}, card: line.card, master: player, skillIndex: line.skillIndex,
    ...(x !== undefined ? { x } : {}),
    aegisCost: { line, costs, effect: [...program.effect, ...(line.script?.ops ?? []), ...keywordAfterProgram(game, line.keyword, line.skill)], stage: "colors" },
  });
}

/** The same interpreter pays the declared hand cards, using the existing
 * strict cost host without changing Auto behavior. Stale card picks are
 * refused before a card can be moved out of the wrong area. */
function colorPayment(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const host = automaticPriceHost(ctx, game, state, ev);
  return stepScript({
    ...host,
    resolveSelector: (f, sel) => {
      const ids = host.resolveSelector(f, sel);
      const op = f.ops[f.ip];
      if (op?.op === "choose" && op.sel === sel && f.awaiting === op.as && state.lastChoice?.some((id) => !ids.includes(id))) throw new IllegalAction("that Aegis color payment is no longer available");
      return ids;
    },
    move: (id, to, owner, opts) => {
      if (host.areaOf(id) !== "hand") throw new IllegalAction("an Aegis color payment must still be in hand");
      return host.move(id, to, owner, opts);
    },
  }, frame);
}

function samePayment(a: VmPayment, b: VmPayment): boolean {
  const ids = (x: string[], y: string[]) => x.length === y.length && x.every((id, i) => id === y[i]);
  return a.energyMarkers === b.energyMarkers && a.markers === b.markers && a.restsSelf === b.restsSelf
    && ids(a.rest, b.rest) && ids(a.life, b.life)
    && a.pooled.length === b.pooled.length && a.pooled.every((p, i) => p.cost === b.pooled[i].cost && ids(p.cards, b.pooled[i].cards))
    && a.markersOff.length === b.markersOff.length && a.markersOff.every((p, i) => {
      const q = b.markersOff[i];
      return p.cost === q.cost && p.side === q.side && p.area === q.area && p.n === q.n && p.by === q.by;
    });
}

/** A failure after hand payment keeps the performed cost (5-8-4), never
 * activates the skill or executes its energy-standing effect. */
function fail(ev: GameEvent[]): "done" {
  log(ev, { type: "note", text: "Aegis activation failed: its additional skill cost could not be paid" });
  return "done";
}

export function stepAegisCost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const cost = frame.aegisCost!;
  if (cost.line.script?.price?.ops?.length) throw new NotYet("pay an additional Aegis action price after its color cost", "#595");
  if (cost.stage === "colors") {
    const paid = colorPayment(ctx, game, state, ev, frame);
    if (paid === "wait") return "wait";
    cost.stage = "additional";
    const line = cost.line;
    const condition = line.script?.price?.condition;
    if (condition && !automaticPriceHost(ctx, game, state, []).condHolds(frame, condition)) return fail(ev);
    const bound = boundFor(ctx, game, state, frame.master, line, false);
    if (frame.x !== undefined) {
      const energy = bound.energy ?? { total: 0, orbs: {}, either: [] };
      bound.energy = { ...energy, total: (energy.total ?? 0) + frame.x };
    }
    const def = { ...game.actions.activate, cost: cost.costs };
    const price = priceFor(ctx, game, state, def, frame.card, bound);
    const plan = planCost(ctx, game, state, frame.master, price, frame.card);
    if (!plan.ok) return fail(ev);
    const plans = plan.asks && plan.options.length > 1 ? plan.options.map((option) => planCost(ctx, game, state, frame.master, price, frame.card, option.rest)) : [plan];
    cost.choices = plans.flatMap((choice) => choice.ok ? [{ price, payment: choice.payment, label: choice.describe }] : []);
  }
  const choices = cost.choices ?? [];
  if (!choices.length) return fail(ev);
  if (choices.length > 1 && frame.awaiting !== "aegisAdditional") {
    frame.awaiting = "aegisAdditional";
    state.programs.unshift(frame);
    state.prompt = { kind: "chooseMode", player: frame.master, reason: "Pay the additional Aegis skill cost", options: choices.map((choice) => choice.label) };
    return "wait";
  }
  const index = choices.length > 1 ? state.lastMode : 0;
  const choice = index === null ? undefined : choices[index];
  if (!choice) throw new IllegalAction("no such additional Aegis payment");
  const current = planCost(ctx, game, state, frame.master, choice.price, frame.card, choice.payment.rest);
  if (!current.ok || !samePayment(current.payment, choice.payment)) throw new IllegalAction("that additional Aegis payment is no longer available");
  state.lastMode = null;
  delete frame.awaiting;
  const host = automaticPriceHost(ctx, game, state, ev);
  const checkReplacement = (id: string, to: string) => {
    const choices = inPlayZones(game).includes(host.areaOf(id) ?? "") && !inPlayZones(game).includes(to) && !game.zones[to]?.host ? host.replacementsFor(id, "cost", { requestedTo: to as Area }) : [];
    if (choices.length > 1 || choices.some((r) => r.optional)) throw new NotYet("choose a replacement of an additional Aegis pooled cost", "#595");
  };
  // Known question boundaries stop before any additional resource is charged.
  const charges = chargesOf(game);
  for (const name of cost.costs) {
    const charge = charges[name];
    const to = (charge?.does as { to?: string } | null)?.to;
    if (!to) continue;
    const cards = charge.consumes === "life" ? choice.payment.life : choice.payment.pooled.find((p) => p.cost === name)?.cards ?? [];
    for (const id of cards) checkReplacement(id, to);
  }
  const spent = scopedPayersSpent(ctx, game, state, frame.master, cost.line);
  const rested = new Set<string>();
  try {
    chargeCost(ctx, game, state, ev, frame.master, choice.payment, frame.card, cost.costs, (id, to, opts) => {
      checkReplacement(id, to);
      host.move(id, to as Area, frame.master, opts);
    }, (id) => { rested.add(id); });
  } finally {
    // 5-8-4 retains a performed resource payment even if a later movement
    // fails. Consume only grants whose payer actually changed Active→Rest.
    spent(choice.payment.rest.filter((id) => rested.has(id)));
  }
  // Finish exactly once. The effect frame contains the color choice's bound
  // names but no payment cursor, so later effect prompts cannot charge again.
  const moment = activationMoment(ctx, game, state, frame.master, cost.line);
  const keywordMoments = keywordActivationMoments(state, frame.master, cost.line);
  resolveActivation(ctx, game, state, ev, frame.master, cost.line, frame.x, undefined, { ops: cost.effect, vars: frame.vars });
  fire(ctx, game, state, moment);
  for (const event of keywordMoments) fire(ctx, game, state, event);
  return "done";
}
