/** R510: one compulsory under-this-card play paid before Auto activation.
 * This receipt records an actual original movement, not the interpreter's
 * cumulative did.play flag or a later search of the pending queue. */
import type { PlayerId } from "../types";
import type { Op, Script, ScriptFrame } from "./script";
import { NotYet } from "./errors";
import type { Root } from "./applied-effect-receipt";
import { AREAS, filterProblem, completeFilter } from "./script-schema";
import { immediatePlayProfile } from "./skill-play-scope";
import { skillPriceProblem } from "./skill-payment";

export interface PlayCostCard {
  card: string;
  cardId: string;
  owner: PlayerId;
  epoch: number;
  hiddenCount: number;
  flipped: boolean;
}
export interface AutoPlayCostReceipt {
  version: 1;
  master: PlayerId;
  skillIndex: number;
  source: PlayCostCard;
  paymentRoot: Root;
  /** Complete stored rule envelope, including condition/resource/usage metadata. */
  declaration: Script;
  price: Op[];
  body: Op[];
  playIp: 1;
  alias: string;
  offered: PlayCostCard[];
  phase: "offered" | "paid";
  arrival?: { original: PlayCostCard; card: string; epoch: number; controller: PlayerId };
}
export interface PaidArrivalWitness {
  version: 1;
  payment: Pick<AutoPlayCostReceipt, "master" | "skillIndex" | "source" | "playIp" | "paymentRoot">;
  arrival: { card: string; epoch: number };
  source: { card: string; epoch: number };
  skillIndex: number;
}
export function autoPlayRebuild(): never { throw new NotYet("rebuild this Auto play-cost payment receipt", "R510"); }
const natural = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const side = (p: unknown): p is PlayerId => p === "p1" || p === "p2";
export const keys = (value: object, allowed: string[]): boolean => Object.entries(value).every(([key, v]) => v === undefined || allowed.includes(key));
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const x = Object.entries(a).filter(([, v]) => v !== undefined), y = Object.entries(b).filter(([, v]) => v !== undefined);
  return x.length === y.length && x.every(([key, value]) => Object.prototype.hasOwnProperty.call(b, key) && equal(value, (b as Record<string, unknown>)[key]));
}
function validCard(c: PlayCostCard): boolean {
  return !!c && typeof c.card === "string" && !!c.card && typeof c.cardId === "string" && !!c.cardId && side(c.owner)
    && natural(c.epoch) && natural(c.hiddenCount) && typeof c.flipped === "boolean";
}
export function sameCard(a: PlayCostCard, b: PlayCostCard): boolean {
  return a.card === b.card && a.cardId === b.cardId && a.owner === b.owner && a.epoch === b.epoch
    && a.hiddenCount === b.hiddenCount && a.flipped === b.flipped;
}

/** Deliberately a whole price, never a nested/optional/batched play whitelist. */
export function underOpponentPlayPrice(ops: readonly Op[]): Extract<Op, { op: "choose" }> | null {
  if (!Array.isArray(ops) || ops.length !== 2) return null;
  const [pick, play] = ops;
  if (!pick || !play || pick.op !== "choose" || play.op !== "play" || !pick.sel || typeof pick.sel !== "object"
    || !play.target || typeof play.target !== "object" || typeof pick.as !== "string" || !pick.as.trim()
    || !keys(pick, ["op", "sel", "as", "reason"])
    || !keys(pick.sel, ["side", "area", "filter", "count", "upTo"]) || pick.sel.side !== "you"
    || pick.sel.area !== "under" || pick.sel.count !== 1 || pick.sel.upTo !== false
    || !keys(play, ["op", "target", "toOpponent"]) || play.toOpponent !== true
    || !("var" in play.target) || !keys(play.target, ["var"]) || play.target.var !== pick.as) return null;
  if (!pick.sel.filter || filterProblem(pick.sel.filter) || completeFilter(pick.sel.filter).unreadable) return null;
  return pick;
}

/** Shared record/native admission; board affordability remains a live question. */
export function autoPlayEnvelopeProblem(script: Pick<Script, "kind" | "price" | "ops" | "trigger">): string | null {
  if (skillPriceProblem(script.price)) return "the Auto play cost needs a complete typed price";
  const price = script.price!, payment = price.payment;
  if (script.kind !== "auto" || !Array.isArray(script.trigger) || !script.trigger.length || !underOpponentPlayPrice(price.ops ?? [])) {
    return "the Auto play cost needs one mandatory under-card opponent Battle play";
  }
  const profile = immediatePlayProfile(script.ops);
  if (!keys(price, ["payment", "condition", "ops"]) || Object.values(payment.orbs).some(n => n !== 0)
    || payment.either.length || payment.marker !== null || payment.burst !== null || payment.spiritBoost !== null
    || payment.spiritBoostPayer !== undefined || profile.arrivals || profile.tokens || profile.explicitWindow) {
    return "compound or alternative Auto play costs and additional body play timing are not supported";
  }
  return null;
}

export function paidArrivalWasActive(pending: import("./triggers").VmPending, state?: import("./state").VmState): boolean {
  const w = pending.paidArrivalWitness;
  if (!w) return false;
  if (w.version !== 1 || !w.payment || !side(w.payment.master) || !natural(w.payment.skillIndex)
    || !validCard(w.payment.source) || w.payment.playIp !== 1 || !w.source || w.source.card !== pending.card
    || typeof w.source.card !== "string" || !w.source.card || !natural(w.source.epoch)
    || !natural(w.skillIndex) || w.skillIndex !== pending.skillIndex || !w.arrival
    || typeof w.arrival.card !== "string" || !w.arrival.card || !natural(w.arrival.epoch)) autoPlayRebuild();
  if (!validPaymentRoot(w.payment.paymentRoot, w.payment)) autoPlayRebuild();
  if (!state) autoPlayRebuild();
  for (const occurrence of [w.arrival, w.source]) {
    const current = state.cards[occurrence.card];
    if (current && (!natural(current.zoneEpoch ?? 0) || (current.zoneEpoch ?? 0) < occurrence.epoch)) autoPlayRebuild();
  }
  return true;
}

function validPaymentRoot(root: Root, r: Pick<AutoPlayCostReceipt, "master" | "skillIndex" | "source">): boolean {
  return !!root && root.kind === "tax" && root.master === r.master && root.skillIndex === r.skillIndex
    && !!root.source && root.source.card === r.source.card && root.source.cardId === r.source.cardId
    && root.source.epoch === r.source.epoch && root.source.hiddenCount === r.source.hiddenCount
    && side(root.source.holder) && (AREAS as readonly string[]).includes(root.source.area);
}

export function requireAutoPlayReceipt(r: AutoPlayCostReceipt | undefined): AutoPlayCostReceipt {
  if (!r || r.version !== 1 || !side(r.master) || !natural(r.skillIndex) || !validCard(r.source)
    || r.playIp !== 1 || typeof r.alias !== "string" || !r.alias || !Array.isArray(r.offered)
    || r.offered.some(c => !validCard(c)) || new Set(r.offered.map(c => c.card)).size !== r.offered.length
    || !["offered", "paid"].includes(r.phase)) autoPlayRebuild();
  if (!validPaymentRoot(r.paymentRoot, r) || !Array.isArray(r.price)
    || underOpponentPlayPrice(r.price)?.as !== r.alias || !Array.isArray(r.body)) autoPlayRebuild();
  if (!r.declaration || r.declaration.kind !== "auto" || !r.declaration.price?.payment?.readable
    || !Array.isArray(r.declaration.unsupported) || r.declaration.unsupported.length
    || !Array.isArray(r.declaration.trigger) || !r.declaration.trigger.length
    || !equal(r.declaration.price.ops, r.price) || !equal(r.declaration.ops, r.body)) autoPlayRebuild();
  if (r.phase === "offered" && r.arrival !== undefined) autoPlayRebuild();
  if (r.phase === "paid") {
    const a = r.arrival;
    if (!a || !validCard(a.original) || a.card !== a.original.card || !natural(a.epoch) || a.epoch <= a.original.epoch
      || a.controller !== (r.master === "p1" ? "p2" : "p1") || !r.offered.some(c => sameCard(c, a.original))) autoPlayRebuild();
  }
  return r;
}

export function requireAutoPlayCost(frame: ScriptFrame): AutoPlayCostReceipt {
  const r = requireAutoPlayReceipt(frame.autoPlayCost);
  if (r.master !== frame.master || r.skillIndex !== frame.skillIndex || r.source.card !== frame.card
    || frame.skillEffectOrigin?.version !== 2 || frame.skillEffectOrigin.kind !== "auto"
    || !equal(r.paymentRoot, frame.appliedPaymentEffects?.root)
    || !equal({ ...r.paymentRoot, kind: "auto" }, frame.appliedEffects?.root)
    || !frame.trigger || !r.declaration.trigger!.includes(frame.trigger)) autoPlayRebuild();
  return r;
}
