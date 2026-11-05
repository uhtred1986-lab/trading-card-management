/** Serialized original occurrences for a play operation paused by R435.
 * A batch belongs to one parent scope; no later chooser can replace its cards.
 */
import type { PlayerId } from "../types";
import type { Op, ScriptFrame } from "./script";
import type { ScriptHost } from "./script-host";
import type { SkillPlayScope } from "./skill-play-scope";
import { canonicalTaxValue } from "./tax-receipt";

export interface CounterArrivalPlay {
  source: string;
  master: PlayerId;
  skillIndex?: number;
  operation: Op;
  options: Parameters<ScriptHost["playThen"]>[1];
}
export interface CounterArrivalBatch {
  version: 1;
  owner: number;
  cards: { card: string; epoch: number }[];
  cursor: number;
  play: CounterArrivalPlay;
}
type Cards = Readonly<Record<string, { zoneEpoch?: number }>>;

export function captureCounterArrivalBatch(owner: number, ids: readonly string[], cards: Cards, play: CounterArrivalPlay): CounterArrivalBatch {
  return { version: 1, owner, cards: ids.map(card => ({ card, epoch: cards[card]?.zoneEpoch ?? 0 })), cursor: 0, play: structuredClone(play) };
}

/** Validate all structural metadata before classifying individual occurrences.
 * A stale later card must not conceal a malformed saved cursor or owner.
 */
export function counterArrivalBatchProblem(value: unknown, owner: number): string | null {
  if (!value || typeof value !== "object") return "missing Counter arrival batch";
  const batch = value as CounterArrivalBatch;
  if (batch.version !== 1 || !Number.isSafeInteger(batch.owner) || batch.owner <= 0 || batch.owner !== owner ||
    !Array.isArray(batch.cards) || !Number.isSafeInteger(batch.cursor) || batch.cursor < 0 || batch.cursor > batch.cards.length) {
    return "malformed Counter arrival batch owner or cursor";
  }
  if (batch.cards.some(item => !item || typeof item.card !== "string" || !item.card || !Number.isSafeInteger(item.epoch) || item.epoch < 0) ||
    new Set(batch.cards.map(item => item.card)).size !== batch.cards.length) {
    return "malformed Counter arrival batch occurrences";
  }
  const play = batch.play;
  if (!play || typeof play.source !== "string" || !play.source || !["p1", "p2"].includes(play.master) ||
    play.skillIndex !== undefined && (!Number.isSafeInteger(play.skillIndex) || play.skillIndex < 0) ||
    !play.operation || play.operation.op !== "play" || play.operation.activating || !play.options || play.options.player !== play.master) {
    return "malformed Counter arrival original play";
  }
  return null;
}

export function counterArrivalBatchFrameProblem(batch: CounterArrivalBatch | undefined, frame: ScriptFrame, owner: SkillPlayScope, options: CounterArrivalPlay["options"]): string | null {
  const problem = counterArrivalBatchProblem(batch, owner.id);
  if (problem || !batch) return problem ?? "missing Counter arrival batch";
  if (!frame || !Array.isArray(frame.ops) || !options || typeof options !== "object") return "malformed Counter arrival resume frame";
  const saved = batch.play, op = saved.operation;
  if (frame.card !== owner.source || frame.master !== owner.master || frame.skillIndex !== owner.skillIndex ||
    saved.source !== owner.source || saved.master !== owner.master || saved.skillIndex !== owner.skillIndex ||
    !Number.isSafeInteger(frame.ip) || frame.ip <= 0 || canonicalTaxValue(frame.ops[frame.ip - 1]) !== canonicalTaxValue(op) ||
    canonicalTaxValue(options) !== canonicalTaxValue(saved.options)) return "changed Counter arrival original play";
  if (op.op !== "play" || op.onto || op.alsoUnder || op.using || op.counterWindow ||
    canonicalTaxValue(options.playPermission) !== canonicalTaxValue({ player: frame.master, source: frame.card, bySkill: true, evolution: false, ...(op.ignoreOwnPermanent ? { ignoreOwnPermanent: true } : {}) }) ||
    options.mode !== op.mode || options.toOwners !== op.toOwners || options.toOpponent !== op.toOpponent ||
    options.onto !== undefined || options.under !== undefined || options.using !== undefined || options.counterWindow !== undefined ||
    canonicalTaxValue(options.negatedKinds) !== canonicalTaxValue(op.negatedKinds) || options.negatedUntil !== op.negatedUntil ||
    options.negated !== undefined && options.negated !== op.negated ||
    typeof op.markers === "number" && options.markers !== op.markers || op.markers === undefined && options.markers !== undefined) {
    return "changed Counter arrival operation options";
  }
  return null;
}

/** Use only after the serialized batch and its parent ownership are validated. */
export function currentCounterArrival(batch: CounterArrivalBatch, cards: Cards): { card: string; epoch: number; current: boolean } | null {
  const item = batch.cards[batch.cursor];
  return item ? { ...item, current: !!cards[item.card] && (cards[item.card].zoneEpoch ?? 0) === item.epoch } : null;
}
