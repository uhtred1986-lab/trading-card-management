import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardPrints, cardSets, cards, deckCards, ownedCards, storageLocations } from "@/db/schema";
import type { Currency } from "@/lib/money";
import { latestUsdEur } from "@/lib/pricing/fx";
import { basePricesAsOf, priceForFinish, pricesForPrints } from "@/lib/pricing/queries";

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export const FINISHES = ["normal", "foil"] as const;
export const LANGUAGES = ["EN", "JP", "DE", "FR", "IT", "ES", "PT", "KR", "ZH"] as const;

/** Owners already used somewhere in the collection, for the card page's picker. */
export async function knownOwners(db: Db): Promise<string[]> {
  const rows = await db.selectDistinct({ owner: ownedCards.owner }).from(ownedCards);
  return rows
    .map((r) => r.owner)
    .filter((o): o is string => !!o)
    .sort((a, b) => a.localeCompare(b));
}

export async function lotsForCard(db: Db, cardId: string) {
  return db
    .select({
      id: ownedCards.id,
      printId: ownedCards.printId,
      printLabel: cardPrints.label,
      condition: ownedCards.condition,
      finish: ownedCards.finish,
      language: ownedCards.language,
      acquiredOn: ownedCards.acquiredOn,
      pricePaidCents: ownedCards.pricePaidCents,
      currency: ownedCards.currency,
      notes: ownedCards.notes,
      owner: ownedCards.owner,
    })
    .from(ownedCards)
    .innerJoin(cardPrints, eq(cardPrints.id, ownedCards.printId))
    .where(eq(ownedCards.cardId, cardId))
    .orderBy(desc(ownedCards.createdAt));
}

export interface ValuedLot {
  id: number;
  cardId: string;
  printId: string;
  finish: string;
  pricePaidCents: number | null;
  currency: string;
  /** Current market value per copy, USD cents (null if unpriced). */
  marketUsdCents: number | null;
  /** Same, converted to EUR at the latest rate. */
  marketEurCents: number | null;
}

/** Every lot, valued. Used by the dashboard and the collection list. */
export async function valuedLots(db: Db): Promise<{ lots: ValuedLot[]; usdEur: number | null }> {
  const [lots, usdEur] = await Promise.all([
    db
      .select({
        id: ownedCards.id,
        cardId: ownedCards.cardId,
        printId: ownedCards.printId,
        finish: ownedCards.finish,
        pricePaidCents: ownedCards.pricePaidCents,
        currency: ownedCards.currency,
      })
      .from(ownedCards),
    latestUsdEur(db),
  ]);
  const prices = await pricesForPrints(db, [...new Set(lots.map((l) => l.printId))]);
  return {
    usdEur,
    lots: lots.map((l) => {
      const usd = priceForFinish(prices.get(l.printId), l.finish);
      return {
        ...l,
        marketUsdCents: usd,
        marketEurCents: usd != null && usdEur != null ? Math.round(usd * usdEur) : null,
      };
    }),
  };
}

export interface CollectionSummary {
  lots: number;
  copies: number;
  /** Copies by finish — the two always add up to `copies`. */
  foilCopies: number;
  normalCopies: number;
  foilValueEurCents: number;
  normalValueEurCents: number;
  uniqueCards: number;
  spentEurCents: number;
  /** Copies that have a price paid (spent covers only these). */
  copiesWithCost: number;
  valueEurCents: number;
  valueUsdCents: number;
  copiesWithValue: number;
  usdEur: number | null;
}

export function summarise(lots: ValuedLot[], usdEur: number | null): CollectionSummary {
  let copies = 0;
  let spent = 0;
  let copiesWithCost = 0;
  let valueEur = 0;
  let valueUsd = 0;
  let copiesWithValue = 0;
  let foilCopies = 0;
  let foilValue = 0;
  let normalValue = 0;
  const unique = new Set<string>();
  for (const l of lots) {
    copies += 1;
    unique.add(l.cardId);
    const lotValue = l.marketEurCents ?? 0;
    if (l.finish === "foil") {
      foilCopies += 1;
      foilValue += lotValue;
    } else {
      normalValue += lotValue;
    }
    if (l.pricePaidCents != null) {
      // Price paid is stored in the lot's currency; convert USD purchases to EUR.
      const eur = l.currency === "USD" && usdEur != null ? Math.round(l.pricePaidCents * usdEur) : l.pricePaidCents;
      spent += eur;
      copiesWithCost += 1;
    }
    if (l.marketUsdCents != null) {
      valueUsd += l.marketUsdCents;
      valueEur += l.marketEurCents ?? 0;
      copiesWithValue += 1;
    }
  }
  return {
    lots: lots.length,
    copies,
    foilCopies,
    normalCopies: copies - foilCopies,
    foilValueEurCents: foilValue,
    normalValueEurCents: normalValue,
    uniqueCards: unique.size,
    spentEurCents: spent,
    copiesWithCost,
    valueEurCents: valueEur,
    valueUsdCents: valueUsd,
    copiesWithValue,
    usdEur,
  };
}

/** Per-card aggregation for the collection grid. */
export async function collectionCards(
  db: Db,
  opts: { q?: string; set?: string; finish?: "foil" | "normal"; sort?: "value" | "name" | "number" | "recent" } = {},
) {
  const { lots, usdEur } = await valuedLots(db);
  const byCard = new Map<
    string,
    { qty: number; foilQty: number; normalQty: number; valueEur: number; spentEur: number; unpriced: number; latest: number }
  >();
  for (const l of lots) {
    const agg = byCard.get(l.cardId) ?? { qty: 0, foilQty: 0, normalQty: 0, valueEur: 0, spentEur: 0, unpriced: 0, latest: 0 };
    agg.qty += 1;
    if (l.finish === "foil") agg.foilQty += 1;
    else agg.normalQty += 1;
    if (l.marketEurCents != null) agg.valueEur += l.marketEurCents;
    else agg.unpriced += 1;
    if (l.pricePaidCents != null) agg.spentEur += l.pricePaidCents;
    agg.latest = Math.max(agg.latest, l.id);
    byCard.set(l.cardId, agg);
  }
  const ids = [...byCard.keys()];
  if (ids.length === 0) return { rows: [], usdEur };

  const cardRows = await db
    .select({
      id: cards.id,
      name: cards.name,
      setCode: cards.setCode,
      cardType: cards.cardType,
      colors: cards.colors,
      rarityCode: cards.rarityCode,
      imageUrl: cards.imageUrl,
      isBanned: cards.isBanned,
      isLimited: cards.isLimited,
      searchText: cards.searchText,
      setSort: cardSets.sortKey,
    })
    .from(cards)
    .innerJoin(cardSets, eq(cardSets.code, cards.setCode))
    .where(sql`${cards.id} in ${ids}`)
    .orderBy(asc(cardSets.sortKey), asc(sql`${cards.id} collate "C"`));

  let rows = cardRows.map((c) => ({ card: c, ...byCard.get(c.id)! }));
  if (opts.set) rows = rows.filter((r) => r.card.setCode === opts.set);
  // Filtering by finish keeps the card but both counts stay visible on the tile.
  if (opts.finish === "foil") rows = rows.filter((r) => r.foilQty > 0);
  if (opts.finish === "normal") rows = rows.filter((r) => r.normalQty > 0);
  if (opts.q) {
    const terms = opts.q.toLowerCase().split(/\s+/).filter(Boolean);
    rows = rows.filter((r) => terms.every((t) => r.card.searchText.includes(t)));
  }
  switch (opts.sort) {
    case "value":
      rows.sort((a, b) => b.valueEur - a.valueEur);
      break;
    case "name":
      rows.sort((a, b) => a.card.name.localeCompare(b.card.name));
      break;
    case "recent":
      rows.sort((a, b) => b.latest - a.latest);
      break;
  }
  return { rows, usdEur };
}

export interface CollectionCopy {
  /** `owned_cards.id` — the identity of one physical card. */
  id: number;
  cardId: string;
  name: string;
  setCode: string;
  setName: string;
  cardType: string;
  colors: string[];
  rarityCode: string;
  imageUrl: string | null;
  isBanned: boolean;
  isLimited: boolean;
  printId: string;
  printLabel: string;
  condition: string;
  finish: string;
  language: string;
  owner: string | null;
  acquiredOn: string | null;
  pricePaidCents: number | null;
  currency: Currency;
  /** Market value of this one copy in EUR cents; null when unpriced. */
  marketEurCents: number | null;
  /** Where this copy is kept, if it has been filed. */
  locationId: number | null;
  locationName: string | null;
}

/**
 * One row per physical card, for the collection's list view. The grid
 * aggregates by card id; this deliberately does not, because the things you
 * select and re-own are individual copies, not the card.
 */
export async function collectionCopies(
  db: Db,
  opts: {
    q?: string;
    set?: string;
    finish?: "foil" | "normal";
    location?: number | "none";
    /** Copies of cards that appear in this deck — deck slots name a card, not a copy. */
    deck?: number;
    /** A username, or "none" for copies nobody has claimed. */
    owner?: string;
    sort?: "value" | "name" | "number" | "recent";
  } = {},
): Promise<{ rows: CollectionCopy[]; usdEur: number | null }> {
  const [lots, usdEur] = await Promise.all([
    db
      .select({
        id: ownedCards.id,
        cardId: ownedCards.cardId,
        printId: ownedCards.printId,
        printLabel: cardPrints.label,
        condition: ownedCards.condition,
        finish: ownedCards.finish,
        language: ownedCards.language,
        owner: ownedCards.owner,
        acquiredOn: ownedCards.acquiredOn,
        pricePaidCents: ownedCards.pricePaidCents,
        currency: ownedCards.currency,
        name: cards.name,
        setCode: cards.setCode,
        setName: cardSets.name,
        cardType: cards.cardType,
        colors: cards.colors,
        rarityCode: cards.rarityCode,
        imageUrl: cards.imageUrl,
        isBanned: cards.isBanned,
        isLimited: cards.isLimited,
        searchText: cards.searchText,
        setSort: cardSets.sortKey,
        locationId: ownedCards.locationId,
        locationName: storageLocations.name,
      })
      .from(ownedCards)
      .innerJoin(cardPrints, eq(cardPrints.id, ownedCards.printId))
      .innerJoin(cards, eq(cards.id, ownedCards.cardId))
      .innerJoin(cardSets, eq(cardSets.code, cards.setCode))
      .leftJoin(storageLocations, eq(storageLocations.id, ownedCards.locationId)),
    latestUsdEur(db),
  ]);

  const prices = await pricesForPrints(db, [...new Set(lots.map((l) => l.printId))]);
  let rows = lots.map((l) => {
    const usd = priceForFinish(prices.get(l.printId), l.finish);
    return {
      ...l,
      // Written as EUR|USD by `normalise`; narrowed here so `formatCents` accepts it.
      currency: (l.currency === "USD" ? "USD" : "EUR") as Currency,
      marketEurCents: usd != null && usdEur != null ? Math.round(usd * usdEur) : null,
    };
  });

  if (opts.set) rows = rows.filter((r) => r.setCode === opts.set);
  // Unlike the grid, filtering by finish drops the copies that don't match —
  // in a per-copy list the row *is* the finish.
  if (opts.finish) rows = rows.filter((r) => (opts.finish === "foil" ? r.finish === "foil" : r.finish !== "foil"));
  // "none" is the useful case: the cards you have not filed anywhere yet.
  if (opts.location === "none") rows = rows.filter((r) => r.locationId == null);
  else if (typeof opts.location === "number") rows = rows.filter((r) => r.locationId === opts.location);
  if (opts.owner) rows = opts.owner === "none" ? rows.filter((r) => !r.owner) : rows.filter((r) => r.owner === opts.owner);
  if (opts.deck) {
    // A deck names cards, not copies, so this shows every copy of everything
    // the deck uses — which is what you want when you go to pull it together.
    const inDeck = new Set((await db.selectDistinct({ cardId: deckCards.cardId }).from(deckCards).where(eq(deckCards.deckId, opts.deck))).map((d) => d.cardId));
    rows = rows.filter((r) => inDeck.has(r.cardId));
  }
  if (opts.q) {
    const terms = opts.q.toLowerCase().split(/\s+/).filter(Boolean);
    rows = rows.filter((r) => terms.every((t) => r.searchText.includes(t)));
  }

  const byNumber = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    a.setSort - b.setSort || a.cardId.localeCompare(b.cardId) || a.id - b.id;
  switch (opts.sort) {
    case "value":
      rows.sort((a, b) => (b.marketEurCents ?? 0) - (a.marketEurCents ?? 0) || byNumber(a, b));
      break;
    case "name":
      rows.sort((a, b) => a.name.localeCompare(b.name) || byNumber(a, b));
      break;
    case "number":
      rows.sort(byNumber);
      break;
    default:
      rows.sort((a, b) => b.id - a.id);
  }

  // Projected by hand: this is the boundary to a client component, and
  // `searchText` on every copy would be the biggest thing crossing it.
  return {
    usdEur,
    rows: rows.map((r) => ({
      id: r.id,
      cardId: r.cardId,
      name: r.name,
      setCode: r.setCode,
      setName: r.setName,
      cardType: r.cardType,
      colors: r.colors,
      rarityCode: r.rarityCode,
      imageUrl: r.imageUrl,
      isBanned: r.isBanned,
      isLimited: r.isLimited,
      printId: r.printId,
      printLabel: r.printLabel,
      condition: r.condition,
      finish: r.finish,
      language: r.language,
      owner: r.owner,
      acquiredOn: r.acquiredOn,
      pricePaidCents: r.pricePaidCents,
      currency: r.currency,
      marketEurCents: r.marketEurCents,
      locationId: r.locationId,
      locationName: r.locationName,
    })),
  };
}

/** Value now vs. N days ago for owned cards, base-print Normal price. */
export async function movers(db: Db, days = 7, limit = 8) {
  const { lots, usdEur } = await valuedLots(db);
  const qty = new Map<string, number>();
  for (const l of lots) qty.set(l.cardId, (qty.get(l.cardId) ?? 0) + 1);
  const ids = [...qty.keys()];
  if (ids.length === 0) return { rows: [], usdEur, days };

  const asOf = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const [now, then] = await Promise.all([basePricesAsOf(db, ids, new Date().toISOString().slice(0, 10)), basePricesAsOf(db, ids, asOf)]);
  const rows: { cardId: string; nowUsd: number; thenUsd: number; deltaUsd: number; pct: number; qty: number }[] = [];
  for (const id of ids) {
    const a = then.get(id);
    const b = now.get(id);
    if (a == null || b == null || a === b) continue;
    rows.push({ cardId: id, nowUsd: b, thenUsd: a, deltaUsd: b - a, pct: a ? (b - a) / a : 0, qty: qty.get(id)! });
  }
  rows.sort((x, y) => Math.abs(y.deltaUsd * y.qty) - Math.abs(x.deltaUsd * x.qty));
  const top = rows.slice(0, limit);
  const names = top.length
    ? await db.select({ id: cards.id, name: cards.name, imageUrl: cards.imageUrl }).from(cards).where(sql`${cards.id} in ${top.map((t) => t.cardId)}`)
    : [];
  const nameMap = new Map(names.map((n) => [n.id, n]));
  return { rows: top.map((t) => ({ ...t, ...nameMap.get(t.cardId)! })), usdEur, days };
}

export async function breakdown(db: Db) {
  const { lots, usdEur } = await valuedLots(db);
  const ids = [...new Set(lots.map((l) => l.cardId))];
  if (ids.length === 0) return { bySet: [], byRarity: [], usdEur };
  const meta = await db
    .select({ id: cards.id, setCode: cards.setCode, setName: cardSets.name, rarity: cards.rarityCode, sort: cardSets.sortKey })
    .from(cards)
    .innerJoin(cardSets, eq(cardSets.code, cards.setCode))
    .where(sql`${cards.id} in ${ids}`);
  const m = new Map(meta.map((r) => [r.id, r]));
  const bySet = new Map<string, { code: string; name: string; sort: number; copies: number; valueEur: number }>();
  const byRarity = new Map<string, { code: string; copies: number; valueEur: number }>();
  for (const l of lots) {
    const c = m.get(l.cardId);
    if (!c) continue;
    const v = l.marketEurCents ?? 0;
    const s = bySet.get(c.setCode) ?? { code: c.setCode, name: c.setName, sort: c.sort, copies: 0, valueEur: 0 };
    s.copies += 1;
    s.valueEur += v;
    bySet.set(c.setCode, s);
    const r = byRarity.get(c.rarity) ?? { code: c.rarity, copies: 0, valueEur: 0 };
    r.copies += 1;
    r.valueEur += v;
    byRarity.set(c.rarity, r);
  }
  return {
    bySet: [...bySet.values()].sort((a, b) => b.valueEur - a.valueEur),
    byRarity: [...byRarity.values()].sort((a, b) => b.valueEur - a.valueEur),
    usdEur,
  };
}
