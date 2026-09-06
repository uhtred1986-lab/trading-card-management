/**
 * Filing a built deck's cards where the deck is kept.
 *
 * A built deck is a physical object sitting somewhere, so the cards in it are
 * in that place too. Reservations are computed rather than stored, though —
 * nothing says *which* of your four copies is the one in the deck — so this
 * picks them, preferring the copies that are least disruptive to move:
 *
 *   1. already there            (nothing to do, and keeps repeat runs stable)
 *   2. not filed anywhere yet
 *   3. filed somewhere that is not another built deck's home
 *   4. anything else
 *
 * The last rank is what stops a second built deck from quietly emptying the
 * first one's box when the two share a card.
 *
 * The sideboard is left alone: it is a scratch zone, not part of the deck you
 * physically carry.
 */
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { deckCards, decks, ownedCards, storageLocations } from "@/db/schema";

export interface FilingResult {
  /** Copies actually moved. Zero when everything was already in place. */
  filed: number;
  /** Distinct cards the deck wanted but has no copy of. */
  missing: number;
  locationName: string | null;
}

const NOT_FILED: FilingResult = { filed: 0, missing: 0, locationName: null };

/**
 * File the copies of a built deck's cards at the deck's location. A deck that
 * is virtual, or has no location, is left alone — this is deliberately a no-op
 * rather than an error, so callers can fire it after any deck edit.
 */
export async function fileDeckAtLocation(db: Db, deckId: number): Promise<FilingResult> {
  const deck = await db.query.decks.findFirst({ where: eq(decks.id, deckId) });
  if (!deck?.isBuilt || deck.locationId == null) return NOT_FILED;
  const target = deck.locationId;

  const need = await db
    .select({ cardId: deckCards.cardId, n: sql<number>`sum(${deckCards.quantity})::int` })
    .from(deckCards)
    .where(and(eq(deckCards.deckId, deckId), ne(deckCards.zone, "side")))
    .groupBy(deckCards.cardId);
  const [place] = await db.select({ name: storageLocations.name }).from(storageLocations).where(eq(storageLocations.id, target));
  const locationName = place?.name ?? null;
  if (need.length === 0) return { filed: 0, missing: 0, locationName };

  const cardIds = need.map((n) => n.cardId);
  const [copies, otherHomes] = await Promise.all([
    db
      .select({ id: ownedCards.id, cardId: ownedCards.cardId, locationId: ownedCards.locationId })
      .from(ownedCards)
      .where(and(inArray(ownedCards.cardId, cardIds), isNull(ownedCards.archivedAt))),
    db
      .selectDistinct({ locationId: decks.locationId })
      .from(decks)
      .where(and(eq(decks.isBuilt, true), ne(decks.id, deckId))),
  ]);

  const claimed = new Set(otherHomes.map((h) => h.locationId).filter((x): x is number => x != null && x !== target));
  const rank = (locationId: number | null) => (locationId === target ? 0 : locationId == null ? 1 : claimed.has(locationId) ? 3 : 2);

  const byCard = new Map<string, typeof copies>();
  for (const c of copies) {
    const list = byCard.get(c.cardId) ?? [];
    list.push(c);
    byCard.set(c.cardId, list);
  }

  const toMove: number[] = [];
  let missing = 0;
  for (const { cardId, n } of need) {
    const list = (byCard.get(cardId) ?? []).slice().sort((a, b) => rank(a.locationId) - rank(b.locationId) || a.id - b.id);
    if (list.length < n) missing += 1;
    for (const copy of list.slice(0, n)) if (copy.locationId !== target) toMove.push(copy.id);
  }

  if (toMove.length > 0) {
    await db.update(ownedCards).set({ locationId: target, updatedAt: new Date() }).where(inArray(ownedCards.id, toMove));
  }
  return { filed: toMove.length, missing, locationName };
}
