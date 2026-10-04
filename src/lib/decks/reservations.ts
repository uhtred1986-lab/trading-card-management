/**
 * The "unlimited virtual, limited physical" rule.
 *
 * Nothing is stored: for any card, *owned* is the sum of collection lots and
 * *reserved* is the sum of that card across every deck flagged built.
 * Reservations count at the card level — a foil copy still satisfies a deck
 * slot for that card.
 *
 * **A built deck reserves copies from its own owner's lots only** (owner's
 * decision, 4 Oct 2026, when collections became private per player): each
 * owner's cards are their own physical copies, so one player's deck can never
 * block another's. Every query takes an `OwnerScope`
 * (`src/lib/collection/scope.ts`): a name counts that owner's lots and built
 * decks; `undefined` counts everyone's together (an SL's whole view);
 * `buildConflicts` always uses the deck's own owner.
 */
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { rows } from "@/db/rows";
import { deckCards, decks, ownedCards } from "@/db/schema";
import { deckScope, lotScope, type OwnerScope } from "@/lib/collection/scope";

export interface Allocation {
  owned: number;
  reserved: number;
  available: number;
}

export async function allocationForCards(db: Db, cardIds: string[], scope?: OwnerScope): Promise<Map<string, Allocation>> {
  const out = new Map<string, Allocation>();
  if (cardIds.length === 0) return out;

  const [ownedRows, reservedRows] = await Promise.all([
    db
      .select({ cardId: ownedCards.cardId, n: sql<number>`count(*)::int` })
      .from(ownedCards)
      .where(and(inArray(ownedCards.cardId, cardIds), isNull(ownedCards.archivedAt), lotScope(scope)))
      .groupBy(ownedCards.cardId),
    db
      .select({ cardId: deckCards.cardId, n: sql<number>`coalesce(sum(${deckCards.quantity}), 0)::int` })
      .from(deckCards)
      .innerJoin(decks, eq(decks.id, deckCards.deckId))
      .where(and(inArray(deckCards.cardId, cardIds), eq(decks.isBuilt, true), deckScope(scope)))
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
 * already-built deck is stable. Only the deck owner's lots and built decks
 * count (`is not distinct from`, so a deck with no owner counts the lots and
 * decks with none).
 */
export async function buildConflicts(db: Db, deckId: number): Promise<BuildConflict[]> {
  const found = rows<{ card_id: string; name: string; needed: number; owned: number; reserved_elsewhere: number }>(
    await db.execute(sql`
    with me as (select owner from decks where id = ${deckId}),
    need as (
      select dc.card_id, sum(dc.quantity)::int as needed
      from deck_cards dc where dc.deck_id = ${deckId}
      group by dc.card_id
    ),
    own as (
      select o.card_id, count(*)::int as owned
      from owned_cards o where o.card_id in (select card_id from need) and o.archived_at is null
        and o.owner is not distinct from (select owner from me)
      group by o.card_id
    ),
    res as (
      select dc.card_id, sum(dc.quantity)::int as reserved
      from deck_cards dc join decks d on d.id = dc.deck_id
      where d.is_built and d.id <> ${deckId} and dc.card_id in (select card_id from need)
        and d.owner is not distinct from (select owner from me)
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

/** Which built decks currently reserve a card (for the card detail page), within `scope`. */
export async function decksReserving(db: Db, cardId: string, scope?: OwnerScope) {
  return db
    .select({ id: decks.id, name: decks.name, quantity: sql<number>`sum(${deckCards.quantity})::int` })
    .from(deckCards)
    .innerJoin(decks, eq(decks.id, deckCards.deckId))
    .where(and(eq(deckCards.cardId, cardId), eq(decks.isBuilt, true), deckScope(scope)))
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
export async function decksReservingFor(db: Db, cardIds: string[], excludeDeckId?: number, scope?: OwnerScope): Promise<Map<string, Reserver[]>> {
  const out = new Map<string, Reserver[]>();
  if (cardIds.length === 0) return out;

  const conditions = [inArray(deckCards.cardId, cardIds), eq(decks.isBuilt, true)];
  if (excludeDeckId != null) conditions.push(ne(decks.id, excludeDeckId));
  const owned = deckScope(scope);
  if (owned) conditions.push(owned);

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
