/** 22-30-3: Aegis pays its hand cards before determining any additional cost. */
import { other, type Area, type Color, type EngineContext, type GameEvent, type PlayerId } from "../types";
import { emptyFilter } from "../text/filters";
import { aegisAlternatives, type AegisAlt } from "./program";
import type { GameDefinition } from "../rulesets";
import { activationMoment, boundFor, keywordActivationMoments, resolveActivation, scopedPayersSpent, type ActivationLine } from "./activate";
import { automaticPriceHost, canFinishAutomaticPrice, readableAutomaticPrice } from "./auto-costs";
import { chargeCost, chargesOf, planCost, priceFor, type Price, type VmPayment } from "./costs";
import { fire, log } from "./events";
import { IllegalAction } from "./common";
import { aegisPrograms, keywordAfterProgram } from "./keyword-do";
import { RulesetBroken } from "./errors";
import { stepScript, type Op, type ScriptFrame } from "./script";
import type { VmState } from "./state";

export interface AegisCost {
  line: ActivationLine;
  costs: string[];
  effect: Op[];
  stage: "colors" | "additional" | "native" | "action";
  /** How the 22-30-3 hand-colour payment is made; unset until settled (BT22-035, BT22-140). It survives reload with the frame. */
  method?: "hand" | AegisAlt["kind"];
  /** The colours `aegisAltDrop` sends, one card each. */
  altColors?: Color[];
  choices?: { price: Price; payment: VmPayment; label: string }[];
  /** Declared native cost and card within a pooled move; both survive reload. */
  nativeIndex?: number;
  poolIndex?: number;
  payment?: VmPayment;
}

const ALT_FIRST = "aegisAlt:first";
const ALT_SECOND = "aegisAlt:second";

/** The substitute payment of BT22-035 / BT22-140 as a program for the same strict host. */
function altPayment(alt: AegisAlt): Op[] {
  if (alt.kind === "aegisAltOpponentHand") {
    return [
      { op: "choose", sel: { side: "opponent", area: "hand", count: 1, upTo: false }, as: ALT_FIRST, blind: true, reason: "[Aegis]: choose 1 card from your opponent's hand to send to the bottom of their deck" },
      { op: "moveTo", target: { var: ALT_FIRST }, to: "deck", position: "bottom", cause: "cost" },
    ];
  }
  const pick = (color: Color, as: string): Op => ({ op: "choose", sel: { side: "you", area: "drop", filter: { ...emptyFilter(), colors: [color] }, count: 1, upTo: false }, as, reason: `[Aegis]: choose a ${color.toLowerCase()} card from your Drop to send to your Warp` });
  return [
    pick(alt.colors[0], ALT_FIRST), pick(alt.colors[1], ALT_SECOND),
    { op: "moveTo", target: { var: ALT_FIRST }, to: "warp", cause: "cost" },
    { op: "moveTo", target: { var: ALT_SECOND }, to: "warp", cause: "cost" },
  ];
}

const altLabel = (alt: AegisAlt) => alt.kind === "aegisAltOpponentHand"
  ? "Send 1 card from your opponent's hand to the bottom of their deck"
  : `Send 1 ${alt.colors[0].toLowerCase()} card and 1 ${alt.colors[1].toLowerCase()} card from your Drop to your Warp`;

/**
 * 22-30-3, "instead of" (20-1-11): how the hand-colour payment is made. The
 * hand payment stays whenever the hand covers the colours, beside each
 * substitute a [Permanent] offers that the board can pay now; with more than
 * one way the player picks, and only that way is paid. Settled once, before
 * any card moves, and stored on the frame so a reload keeps it.
 */
function settleMethod(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const cost = frame.aegisCost!;
  const host = automaticPriceHost(ctx, game, state, ev);
  const colors = cost.line.skill.keyword?.name === "Aegis" ? cost.line.skill.keyword.colors : [];
  const alts = aegisAlternatives(ctx, game, state, frame);
  const hand = host.condHolds(frame, { kind: "covers", sel: { side: "you", area: "hand" }, colors, original: true });
  const ways: ("hand" | AegisAlt)[] = [...(hand ? ["hand" as const] : []), ...alts];
  if (!alts.length && hand) { cost.method = "hand"; return "done"; }
  if (!ways.length) { cost.method = "hand"; return "done"; }
  let index = 0;
  if (ways.length > 1) {
    if (frame.awaiting !== "aegisMethod") {
      frame.awaiting = "aegisMethod";
      state.programs.unshift(frame);
      state.prompt = { kind: "chooseMode", player: frame.master, reason: "Pay the Aegis skill cost", options: ways.map((w) => (w === "hand" ? "Discard cards from your hand" : altLabel(w))) };
      return "wait";
    }
    if (state.lastMode === null || !ways[state.lastMode]) throw new IllegalAction("no such Aegis payment");
    index = state.lastMode;
    state.lastMode = null;
    delete frame.awaiting;
  }
  const way = ways[index];
  if (way === "hand") { cost.method = "hand"; return "done"; }
  cost.method = way.kind;
  if (way.kind === "aegisAltDrop") cost.altColors = way.colors;
  frame.ops = altPayment(way);
  frame.ip = 0;
  return "done";
}

/** Declaring Aegis has not activated it: limits and events remain unspent. */
export function queueAegisCost(game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, costs: string[], x?: number): void {
  if (!line.keyword) throw new RulesetBroken(game.id, "Aegis activation has no keyword declaration");
  const program = aegisPrograms(game, line.keyword, line.skill);
  state.programs.unshift({
    ops: program.payment, ip: 0, vars: {}, card: line.card, master: player, skillIndex: line.skillIndex, usage: line.skill.usage as import("./usage").UsageRecord, validity: line.skill.validity as import("./validity").ValidityRecord,
    ...(x !== undefined ? { x } : {}),
    aegisCost: { line, costs, effect: [...program.effect, ...(line.script?.ops ?? []), ...keywordAfterProgram(game, line.keyword, line.skill)], stage: "colors" },
  });
}

/** The same interpreter pays the declared hand cards, using the existing
 * strict cost host without changing Auto behavior. Stale card picks are
 * refused before a card can be moved out of the wrong area. */
function colorPayment(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const host = automaticPriceHost(ctx, game, state, ev);
  const alt = frame.aegisCost?.method !== "hand";
  return stepScript({
    ...host,
    resolveSelector: (f, sel) => {
      let ids = host.resolveSelector(f, sel);
      const op = f.ops[f.ip];
      // BT22-035: two different Drop cards, one of each colour. The first pick
      // keeps a partner for the second; the second leaves the first alone.
      if (alt && op?.op === "choose" && op.sel === sel && op.as === ALT_FIRST) {
        const second = f.ops.find((o) => o.op === "choose" && o.as === ALT_SECOND);
        if (second?.op === "choose") {
          const partners = host.resolveSelector(f, second.sel);
          ids = ids.filter((id) => partners.some((p) => p !== id));
        }
      }
      if (alt && op?.op === "choose" && op.sel === sel && op.as === ALT_SECOND) ids = ids.filter((id) => !(f.vars[ALT_FIRST] ?? []).includes(id));
      if (op?.op === "choose" && op.sel === sel && f.awaiting === op.as && state.lastChoice?.some((id) => !ids.includes(id))) throw new IllegalAction("that Aegis color payment is no longer available");
      return ids;
    },
    move: (id, to, owner, opts) => {
      if (!alt && host.areaOf(id) !== "hand") throw new IllegalAction("an Aegis color payment must still be in hand");
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
  if (cost.stage === "colors") {
    if (!cost.method && settleMethod(ctx, game, state, ev, frame) === "wait") return "wait";
    const paid = colorPayment(ctx, game, state, ev, frame);
    if (paid === "wait") return "wait";
    readableAutomaticPrice(cost.line.script?.price?.ops ?? [], "Aegis", "#595");
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
  const host = automaticPriceHost(ctx, game, state, ev);
  if (cost.stage === "additional") {
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
    const action = cost.line.script?.price?.ops ?? [];
    // On a board without native card departures, the complete action price
    // can be tested after a simulated native fee. A known dead end here is a
    // failed activation after the already-performed color payment; charging
    // the native resources would make no further payment possible.
    if (action.length && !choice.payment.life.length && !choice.payment.pooled.some((p) => p.cards.length)) {
      const clone = structuredClone(state);
      const spent = scopedPayersSpent(ctx, game, clone, frame.master, cost.line);
      chargeCost(ctx, game, clone, [], frame.master, choice.payment, frame.card, cost.costs);
      spent(choice.payment.rest);
      if (!canFinishAutomaticPrice(ctx, game, clone, { ...frame, ops: action, ip: 0, awaiting: undefined })) return fail(ev);
    }
    cost.payment = choice.payment;
    cost.nativeIndex = 0;
    cost.poolIndex = 0;
    cost.stage = "native";
  }
  if (cost.stage === "native") {
    const payment = cost.payment!;
    const charges = chargesOf(game);
    while (cost.nativeIndex! < cost.costs.length) {
      const name = cost.costs[cost.nativeIndex!];
      const charge = charges[name];
      if (!charge) throw new RulesetBroken(game.id, `there is no price called ${JSON.stringify(name)} to charge`);
      const to = (charge.does as { to?: string } | null)?.to;
      const cards = charge.consumes === "life" ? payment.life : charge.consumes === "cards" && charge.from ? payment.pooled.find((p) => p.cost === name)?.cards ?? [] : null;
      if (cards?.length) {
        if (!to) throw new RulesetBroken(game.id, `the price ${name} takes cards but says nowhere to put them`);
        const id = cards[cost.poolIndex!];
        if (id) {
          const from = charge.from ?? { side: "you", area: "life" };
          const side = from.side === "opponent" ? other(frame.master) : frame.master;
          if (host.areaOf(id) !== from.area || !state.sides[side].zones[from.area]?.includes(id)
            || (from.mode !== undefined && state.cards[id]?.mode !== from.mode)) {
            throw new IllegalAction("that additional Aegis pool payment is no longer available");
          }
          // The native pool chose this physical card when the live price was
          // planned. An interpreter move gives its master the normal persisted
          // 9-10 replacement choice and verifies the specified destination.
          const key = "§aegisNativePayment";
          if (!frame.ops.length || frame.ip > 0) {
            frame.vars[key] = [id];
            frame.ops = [{ op: "moveTo", target: { var: key }, to: to as Area, cause: "cost", ...(game.zones[charge.from?.area ?? "life"]?.visibility === "all" ? {} : { reveal: true }) }];
            frame.ip = 0;
          }
          const result = stepScript(host, frame);
          if (result === "wait") return "wait";
          cost.poolIndex!++;
          frame.ops = [];
          frame.ip = 0;
          delete frame.moveLoop;
          continue;
        }
      } else if (cards === null) {
        const spent = scopedPayersSpent(ctx, game, state, frame.master, cost.line);
        const rested: string[] = [];
        try {
          chargeCost(ctx, game, state, ev, frame.master, payment, frame.card, [name], undefined, (id) => rested.push(id));
        } finally {
          // 5-8-4 keeps only grants whose payer actually rested.
          spent(rested);
        }
      }
      cost.nativeIndex!++;
      cost.poolIndex = 0;
    }
    frame.ops = cost.line.script?.price?.ops ?? [];
    frame.ip = 0;
    delete frame.vars["§aegisNativePayment"];
    cost.stage = "action";
  }
  if (cost.stage === "action") {
    if (frame.ops.length) {
      if (!(frame.awaiting === "replaceMove" && state.lastMode !== null) && !canFinishAutomaticPrice(ctx, game, state, frame)) {
        if (frame.awaiting) throw new IllegalAction("that additional Aegis action payment is no longer available");
        return fail(ev);
      }
      const result = stepScript(host, frame);
      if (result === "wait") {
        if (state.prompt.kind === "chooseCards") state.prompt.choice.candidates = state.prompt.choice.candidates.filter((id) => {
          const clone = structuredClone(state);
          clone.lastChoice = [id];
          return canFinishAutomaticPrice(ctx, game, clone, frame);
        });
        return "wait";
      }
    }
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
