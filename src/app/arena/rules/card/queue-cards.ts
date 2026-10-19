import type { Db } from "@/db";
import { currentScope } from "@/lib/auth";
import { HEALTH_TABS, neighbours, queueFromParam } from "@/lib/arena/queue";
import { loadQueue } from "@/lib/arena/queue-cards";

/**
 * The queue a card was opened from, as an ordered list of cards: what the card
 * page's ‹ Previous / Next › walk.
 *
 * The link carries the queue as one `q` parameter, the queue's own query string
 * (`queueParam` in queue.ts). It is read with `queueFromParam` and listed by the
 * Rules queue's own `loadQueue`, so the walk is exactly the rows the queue showed
 * under that tab, in that order. A missing, empty or unreadable `q`, or a card
 * the queue does not list, means "no queue" and the page hides the walk.
 */
export interface QueueWalk {
  /** The queue's own query string, to put back on prev/next links. */
  q: string;
  /** Which tab and group the queue was on, in words. */
  label: string;
  index: number;
  total: number;
  prev: { cardId: string; name: string } | null;
  next: { cardId: string; name: string } | null;
}

const GROUPS: Record<string, string> = { wording: "same wording", reason: "by reason", set: "by set" };

export async function walkQueue(db: Db, raw: string | undefined, cardId: string): Promise<QueueWalk | null> {
  if (!raw || raw.length > 600) return null;
  const qu = queueFromParam(raw);
  const loaded = await loadQueue(db, qu, await currentScope());
  const { ordered, matched, health, group } = loaded;
  const i = ordered.indexOf(cardId);
  if (i < 0) return null;
  const near = neighbours(ordered, cardId);
  const named = (id: string | null) => (id ? { cardId: id, name: matched.find((c) => c.cardId === id)?.name ?? id } : null);
  const label = [HEALTH_TABS.find((t) => t.key === health)?.label, group !== "none" ? GROUPS[group] : null].filter(Boolean).join(" · ");
  return { q: raw, label, index: i + 1, total: ordered.length, prev: named(near.prev), next: named(near.next) };
}
