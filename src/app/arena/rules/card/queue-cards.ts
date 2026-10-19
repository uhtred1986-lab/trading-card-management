import type { Db } from "@/db";
import { firedInGame } from "@/lib/arena/fired";
import { parseQueue, type Queue } from "@/lib/arena/queue";
import { deckCardSets } from "@/lib/arena/readiness";
import { cardHealth, ruleHealth, ruleIdsFor, worklistPage, type RuleHealth, type RuleStatus } from "@/lib/arena/rules-store";
import { listDecks } from "@/lib/decks/queries";

/**
 * The queue a card was opened from, as an ordered list of cards: what the card
 * page's ‹ Previous / Next › walk.
 *
 * The page link carries the queue as one `q` parameter, the queue's own query
 * string (`queueParams`). It is read defensively with `parseQueue`: a missing,
 * empty or unreadable `q` means "no queue" and the page hides the walk.
 * `health` is read when the queue has one (the Rules queue by card), `state`
 * (the older rule-level queue) otherwise.
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

const HEALTH_TABS: Record<string, string> = { "text-only": "Text only", incomplete: "Incomplete", unchecked: "Read, not checked", done: "Done" };
const STATE_TABS: Record<string, string> = { open: "Text only", draft: "Read, not checked", confirmed: "Done", corrected: "Done" };
const GROUPS: Record<string, string> = { wording: "same wording", reason: "by reason", set: "by set" };

/** The tab the queue was on, from `health` when the queue has one and from the older `state` when not. */
export function tabOf(qu: Queue): { health: RuleHealth | null; state: RuleStatus | null; label: string } {
  const health = (qu as { health?: unknown }).health;
  if (typeof health === "string" && health in HEALTH_TABS) return { health: health as RuleHealth, state: null, label: HEALTH_TABS[health] };
  if (qu.state) return { health: null, state: qu.state, label: STATE_TABS[qu.state] };
  return { health: null, state: null, label: "All" };
}

export async function walkQueue(db: Db, raw: string | undefined, cardId: string): Promise<QueueWalk | null> {
  if (!raw || raw.length > 600) return null;
  let qu: Queue;
  try {
    qu = parseQueue(Object.fromEntries(new URLSearchParams(raw)));
  } catch {
    return null;
  }
  const tab = tabOf(qu);

  const decks = (await listDecks(db, { game: "dbs" })).filter((d) => d.leader && d.mainCount >= 50);
  const deckCards = await deckCardSets(db, decks.map((d) => d.id));
  const allDeckCards = new Set<string>();
  for (const s of deckCards.values()) for (const id of s) allDeckCards.add(id);
  const scope = qu.scope;
  // An unknown deck is never silently widened: it walks nothing.
  const cardIds = scope.kind === "catalog" || scope.kind === "game" ? undefined : scope.kind === "deck" ? [...(deckCards.get(scope.id) ?? [])] : [...allDeckCards];
  const ruleIds = scope.kind === "game" ? await ruleIdsFor(db, await firedInGame(db, scope.id)) : undefined;

  const page = await worklistPage(db, { cardIds, ruleIds, status: tab.state ?? undefined, q: qu.q || undefined, setCode: qu.set || undefined, source: qu.source || undefined, pattern: qu.pattern || undefined, mechanism: qu.mech || undefined, compilerDiff: qu.reason === "diff" || undefined, costUnknown: qu.reason === "cost" || undefined }, { limit: 100000, offset: 0 });

  const order: string[] = [];
  const names = new Map<string, string>();
  const healths = new Map<string, RuleHealth[]>();
  for (const r of page.rows) {
    if (!names.has(r.cardId)) {
      order.push(r.cardId);
      names.set(r.cardId, r.name);
    }
    healths.set(r.cardId, [...(healths.get(r.cardId) ?? []), ruleHealth(r).health]);
  }
  const walk = tab.health ? order.filter((id) => cardHealth(healths.get(id) ?? []) === tab.health) : order;
  const i = walk.indexOf(cardId);
  if (i < 0) return null;
  const at = (k: number) => (walk[k] ? { cardId: walk[k], name: names.get(walk[k]) ?? walk[k] } : null);
  const group = qu.group !== "none" ? GROUPS[qu.group] : null;
  return { q: raw, label: [tab.label, group].filter(Boolean).join(" · "), index: i + 1, total: walk.length, prev: at(i - 1), next: at(i + 1) };
}
