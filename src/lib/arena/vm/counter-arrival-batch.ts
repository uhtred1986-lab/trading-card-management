/** Serialized original occurrences for a play operation paused by R435.
 * A batch belongs to one parent scope; no later chooser can replace its cards.
 */
export interface CounterArrivalBatch {
  version: 1;
  owner: number;
  cards: { card: string; epoch: number }[];
  cursor: number;
}
type Cards = Readonly<Record<string, { zoneEpoch?: number }>>;

export function captureCounterArrivalBatch(owner: number, ids: readonly string[], cards: Cards): CounterArrivalBatch {
  return { version: 1, owner, cards: ids.map(card => ({ card, epoch: cards[card]?.zoneEpoch ?? 0 })), cursor: 0 };
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
  return null;
}

/** Use only after the serialized batch and its parent ownership are validated. */
export function currentCounterArrival(batch: CounterArrivalBatch, cards: Cards): { card: string; epoch: number; current: boolean } | null {
  const item = batch.cards[batch.cursor];
  return item ? { ...item, current: !!cards[item.card] && (cards[item.card].zoneEpoch ?? 0) === item.epoch } : null;
}
