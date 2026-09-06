/**
 * The "unlimited virtual, limited physical" rule.
 *
 * Nothing is stored: for any card, *owned* is the sum of collection lots and
 * *reserved* is the sum of that card across every deck flagged built.
 * Reservations count at the card level — a foil copy still satisfies a deck
 * slot for that card.
 */
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { rows } from "@/db/rows";
import { deckCards, decks, ownedCards } from "@/db/schema";

export interface Allocation {
  owned: number;
  reserved: number;
  available: number;
}

export async function allocationForCards(db: Db, cardIds: string[]): Promise<Map<string, Allocation>> {
  const out = new Map<string, Allocation>();
  if (cardIds.length === 0) return out;

  const [ownedRows, reservedRows] = await Promise.all([
    db
      .select({ cardId: ownedCards.cardId, n: sql<number>`count(*)::int` })
      .from(ownedCards)
      .where(and(inArray(ownedCards.cardId, cardIds), isNull(ownedCards.archivedAt)))
      .groupBy(ownedCards.cardId),
    db
      .select({ cardId: deckCards.cardId, n: sql<number>`coalesce(sum(${deckCards.quantity}), 0)::int` })
      .from(deckCards)
      .innerJoin(decks, eq(decks.id, deckCards.deckId))
      .where(and(inArray(deckCards.cardId, cardIds), eq(decks.isBuilt, true)))
      .groupBy(deckCards.cardId),
  ]);

  const owned = new Map(ownedRows.map((r) => [r.cardId, r.n]));
  const reserved = new Map(reservedRows.map((r) => [r.cardId, r.n]));
  for (const id of cardIds) {
    const o = owned.get(id) ?? 0;
    const r = reserved.get(id) ?? 0;
    out.set(id, { owned: o, reserved: r, available: o - r });
  }
  return out;
}

export interface BuildConflict {
  cardId: string;
  name: string;
  needed: number;
  owned: number;
  reservedElsewhere: number;
  short: number;
}

/**
 * What would go wrong if `deckId` were marked built right now. Empty means it
 * can be built. Reservations from *this* deck are excluded so re-checking an
 * already-built deck is stable.
 */
export async function buildConflicts(db: Db, deckId: number): Promise<BuildConflict[]> {
  const found = rows<{ card_id: string; name: string; needed: number; owned: number; reserved_elsewhere: number }>(
    await db.execute(sql`
    with need as (
      select dc.card_id, sum(dc.quantity)::int as needed
      from deck_cards dc where dc.deck_id = ${deckId}
      group by dc.card_id
    ),
    own as (
      select o.card_id, count(*)::int as owned
      from owned_cards o where o.card_id in (select card_id from need) and o.archived_at is null
      group by o.card_id
    ),
    res as (
      select dc.card_id, sum(dc.quantity)::int as reserved
      from deck_cards dc join decks d on d.id = dc.deck_id
      where d.is_built and d.id <> ${deckId} and dc.card_id in (select card_id from need)
      group by dc.card_id
    )
    select need.card_id, c.name, need.needed,
           coalesce(own.owned, 0) as owned,
           coalesce(res.reserved, 0) as reserved_elsewhere
    from need
    join cards c on c.id = need.card_id
    left join own on own.card_id = need.card_id
    left join res on res.card_id = need.card_id
    where need.needed > coalesce(own.owned, 0) - coalesce(res.reserved, 0)
    order by c.name
  `),
  );

  return found.map((r) => ({
    cardId: r.card_id,
    name: r.name,
    needed: r.needed,
    owned: r.owned,
    reservedElsewhere: r.reserved_elsewhere,
    short: r.needed - (r.owned - r.reserved_elsewhere),
  }));
}

/** Which built decks currently reserve a card (for the card detail page). */
export async function decksReserving(db: Db, cardId: string) {
  return db
    .select({ id: decks.id, name: decks.name, quantity: sql<number>`sum(${deckCards.quantity})::int` })
    .from(deckCards)
    .innerJoin(decks, eq(decks.id, deckCards.deckId))
    .where(and(eq(deckCards.cardId, cardId), eq(decks.isBuilt, true)))
    .groupBy(decks.id, decks.name);
}

export interface Reserver {
  id: number;
  name: string;
  quantity: number;
}

/**
 * Batched `decksReserving`, for showing which decks to consider breaking up
 * instead of buying — the cart's owned/used/missing breakdown. `excludeDeckId`
 * drops the deck you're shopping for, so an already-built deck rechecking its
 * own shortfall doesn't list itself as the reason cards are unavailable.
 */
export async function decksReservingFor(db: Db, cardIds: string[], excludeDeckId?: number): Promise<Map<string, Reserver[]>> {
  const out = new Map<string, Reserver[]>();
  if (cardIds.length === 0) return out;

  const conditions = [inArray(deckCards.cardId, cardIds), eq(decks.isBuilt, true)];
  if (excludeDeckId != null) conditions.push(ne(decks.id, excludeDeckId));

  const found = await db
    .select({ cardId: deckCards.cardId, id: decks.id, name: decks.name, quantity: sql<number>`sum(${deckCards.quantity})::int` })
    .from(deckCards)
    .innerJoin(decks, eq(decks.id, deckCards.deckId))
    .where(and(...conditions))
    .groupBy(deckCards.cardId, decks.id, decks.name);

  for (const r of found) {
    const list = out.get(r.cardId) ?? [];
    list.push({ id: r.id, name: r.name, quantity: r.quantity });
    out.set(r.cardId, list);
  }
  return out;
}
