/**
 * What the Pokémon pages read from the local database (never from TCGdex, so they work when it is
 * down): the collection, the wishes and the viewer's decks. Every read takes the looker's scope
 * (`currentScope()`): a player sees their own lots and decks only, an SL everyone's.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardPrints, cardSets, cards, deckCards, decks, ownedCards, wantList } from "@/db/schema";
import { cardPhotoIds } from "@/lib/collection/photos";
import { deckScope, lotScope, type OwnerScope } from "@/lib/collection/scope";
import { allocationForCards } from "@/lib/decks/reservations";
import { lowImage, type PokemonTile } from "./client";
import { wishReasons } from "./deck-logic";
import { pokemonDetails } from "./types";

export interface CollectionEntry extends PokemonTile {
  /** Whose copies: a player's own owner name, an SL sees every player's. */
  owner: string | null;
  quantity: number;
  /** Languages of the copies: "DE" and/or "EN". */
  languages: string[];
  /** Copies of this card in the owner's decks, built or not. */
  inDecks: number;
  /** Cardmarket trend of the copies, in integer EUR cents (copies without a price count nothing). */
  valueCents: number;
  /** The newest lot's id: "newest first". */
  newest: number;
  hasPhoto: boolean;
}

export interface CollectionView {
  entries: CollectionEntry[];
  copies: number;
  valueCents: number;
  /** Owner names among the entries (an SL labels them; a player has one). */
  owners: (string | null)[];
}

/** The lots of Pokémon cards the looker may see, grouped by card and owner. */
export async function pokemonCollection(db: Db, scope: OwnerScope, prefer: string | null): Promise<CollectionView> {
  const lots = await db
    .select({
      owner: ownedCards.owner,
      cardId: ownedCards.cardId,
      printId: ownedCards.printId,
      language: ownedCards.language,
      n: sql<number>`count(*)::int`,
      newest: sql<number>`max(${ownedCards.id})::int`,
      marketCents: cardPrints.marketCents,
      name: cards.name,
      imageUrl: cards.imageUrl,
      details: cards.details,
      setName: cardSets.name,
    })
    .from(ownedCards)
    .innerJoin(cardPrints, eq(cardPrints.id, ownedCards.printId))
    .innerJoin(cards, eq(cards.id, ownedCards.cardId))
    .innerJoin(cardSets, eq(cardSets.code, cards.setCode))
    .where(and(eq(cards.game, "pokemon"), isNull(ownedCards.archivedAt), lotScope(scope)))
    .groupBy(ownedCards.owner, ownedCards.cardId, ownedCards.printId, ownedCards.language, cardPrints.id, cards.id, cardSets.code);

  const inDeckRows = await db
    .select({ cardId: deckCards.cardId, owner: decks.owner, n: sql<number>`sum(${deckCards.quantity})::int` })
    .from(deckCards)
    .innerJoin(decks, eq(decks.id, deckCards.deckId))
    .where(and(eq(decks.game, "pokemon"), deckScope(scope)))
    .groupBy(deckCards.cardId, decks.owner);
  const inDecks = new Map(inDeckRows.map((r) => [`${r.owner ?? ""}\u0000${r.cardId}`, Number(r.n)]));

  const photos = await cardPhotoIds(db, scope, { printIds: [...new Set(lots.map((l) => l.printId))], prefer });

  const byKey = new Map<string, CollectionEntry>();
  for (const l of lots) {
    const key = `${l.owner ?? ""}\u0000${l.cardId}`;
    let e = byKey.get(key);
    if (!e) {
      const d = pokemonDetails(l.details);
      const tcgdexId = d.tcgdexId ?? l.cardId.replace(/^PKM-/, "");
      e = {
        id: l.cardId,
        tcgdexId,
        name: l.name,
        altName: d.names?.en && d.names.en !== l.name ? d.names.en : d.names?.de && d.names.de !== l.name ? d.names.de : null,
        setName: l.setName,
        localId: d.localId ?? "",
        setTotal: d.setTotal ?? null,
        imageLow: lowImage(l.imageUrl),
        imageHigh: l.imageUrl,
        photoId: null,
        priceCents: l.marketCents,
        owner: l.owner,
        quantity: 0,
        languages: [],
        inDecks: inDecks.get(key) ?? 0,
        valueCents: 0,
        newest: 0,
        hasPhoto: false,
      };
      byKey.set(key, e);
    }
    e.quantity += l.n;
    e.valueCents += l.n * (l.marketCents ?? 0);
    e.newest = Math.max(e.newest, l.newest);
    if (!e.languages.includes(l.language)) e.languages.push(l.language);
    const photo = photos.byPrint.get(l.printId);
    if (photo && !e.photoId) {
      e.photoId = photo;
      e.hasPhoto = true;
    }
  }

  const entries = [...byKey.values()].sort((a, b) => (a.owner ?? "").localeCompare(b.owner ?? "") || b.newest - a.newest);
  return {
    entries,
    copies: entries.reduce((n, e) => n + e.quantity, 0),
    valueCents: entries.reduce((n, e) => n + e.valueCents, 0),
    owners: [...new Set(entries.map((e) => e.owner))],
  };
}

export interface WishEntry extends PokemonTile {
  /** How many copies are wanted (the want list's quantity). */
  wanted: number;
  /** Names of her decks that hold more copies of this card than she owns, oldest deck first (`wishReasons`). Empty when no deck lacks it. */
  lackingDecks: string[];
}

/**
 * The viewer's own wished Pokémon cards. A player's wishes are their owner's; an SL's page shows the
 * SL's own list, the one their hearts write (the admin's view of a player's wishes is in `/cart`).
 */
export async function pokemonWishes(db: Db, scope: OwnerScope, owner: string | null): Promise<{ entries: WishEntry[]; totalCents: number; unpriced: number }> {
  const mine = scope !== undefined ? scope : owner;
  const rows = await db
    .select({
      cardId: wantList.cardId,
      quantity: wantList.quantity,
      createdAt: wantList.createdAt,
      name: cards.name,
      imageUrl: cards.imageUrl,
      details: cards.details,
      setName: cardSets.name,
      marketCents: sql<number | null>`(select p.market_cents from card_prints p where p.card_id = ${wantList.cardId} order by p.is_base desc, p.id limit 1)`,
    })
    .from(wantList)
    .innerJoin(cards, eq(cards.id, wantList.cardId))
    .innerJoin(cardSets, eq(cardSets.code, cards.setCode))
    .where(and(eq(cards.game, "pokemon"), mine === null ? isNull(wantList.owner) : eq(wantList.owner, mine)))
    .orderBy(sql`${wantList.createdAt} desc`, asc(wantList.id));
  // Why: her decks that hold more copies of a wished card than she owns.
  const wishedIds = rows.map((r) => r.cardId);
  const lacking = new Map<string, string[]>();
  if (wishedIds.length > 0) {
    const [needs, alloc] = await Promise.all([
      db
        .select({ deckId: decks.id, deckName: decks.name, cardId: deckCards.cardId, quantity: sql<number>`sum(${deckCards.quantity})::int` })
        .from(deckCards)
        .innerJoin(decks, eq(decks.id, deckCards.deckId))
        .where(and(eq(decks.game, "pokemon"), inArray(deckCards.cardId, wishedIds), mine === null ? isNull(decks.owner) : eq(decks.owner, mine)))
        .groupBy(decks.id, deckCards.cardId),
      allocationForCards(db, wishedIds, mine),
    ]);
    const ownedBy = Object.fromEntries(wishedIds.map((id) => [id, alloc.get(id)?.owned ?? 0]));
    for (const [id, names] of wishReasons(needs.map((n) => ({ ...n, quantity: Number(n.quantity) })), ownedBy)) lacking.set(id, names);
  }
  const entries: WishEntry[] = rows.map((r) => {
    const d = pokemonDetails(r.details);
    return {
      id: r.cardId,
      tcgdexId: d.tcgdexId ?? r.cardId.replace(/^PKM-/, ""),
      name: r.name,
      altName: d.names?.en && d.names.en !== r.name ? d.names.en : d.names?.de && d.names.de !== r.name ? d.names.de : null,
      setName: r.setName,
      localId: d.localId ?? "",
      setTotal: d.setTotal ?? null,
      imageLow: lowImage(r.imageUrl),
      imageHigh: r.imageUrl,
      priceCents: r.marketCents,
      wanted: r.quantity,
      lackingDecks: lacking.get(r.cardId) ?? [],
    };
  });
  return {
    entries,
    totalCents: entries.reduce((n, e) => n + (e.priceCents ?? 0) * e.wanted, 0),
    unpriced: entries.filter((e) => e.priceCents == null).length,
  };
}

export interface PokemonDeckRow {
  id: number;
  name: string;
  /** Cards in the deck, all zones. */
  count: number;
  format: string | null;
}

/** The Pokémon decks the looker may put a card into (a player: their own). */
export async function pokemonDecks(db: Db, scope: OwnerScope): Promise<PokemonDeckRow[]> {
  const rows = await db
    .select({ id: decks.id, name: decks.name, format: decks.format, n: sql<number>`coalesce(sum(${deckCards.quantity}), 0)::int` })
    .from(decks)
    .leftJoin(deckCards, eq(deckCards.deckId, decks.id))
    .where(and(eq(decks.game, "pokemon"), deckScope(scope)))
    .groupBy(decks.id)
    .orderBy(decks.name);
  return rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.n), format: r.format }));
}
