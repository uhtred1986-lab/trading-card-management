/**
 * What the Pokémon deck screens read and write in the local database (lane G, docs/pokemon/design.md §6).
 * Like `collection.ts`, every function takes the `db` (or a transaction) so the data effects run on
 * PGlite in `scripts/verify/pokemon-decks.mts`; the Server Functions in `src/app/pokemon/decks/actions.ts`
 * are thin guards over them (who is asking, which deck is theirs).
 *
 * Reservations are computed, never stored (`reservations.ts`); a deck's "owned" is its owner's copies,
 * exactly as a built deck reserves them.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cards, deckCards, decks, wantList } from "@/db/schema";
import type { Viewer } from "@/lib/auth";
import { deckRules } from "@/lib/catalog/games";
import { addCardsToDeck } from "@/lib/decks/add";
import { pokemonFormatOf } from "@/lib/decks/pokemonLegality";
import { listDecks } from "@/lib/decks/queries";
import { allocationForCards } from "@/lib/decks/reservations";
import { addWant } from "@/lib/decks/swaps";
import type { OwnerScope } from "@/lib/collection/scope";
import { lowImage } from "./client";
import { missingCopies, wishesToAdd } from "./deck-logic";
import { parseDeckListPokemon, resolveDeckList, type DeckListResolution, type DeckListSearch, type SetIdForCode } from "./decklist";
import { ensurePokemonCard } from "./store";
import type { PokemonCardRecord, PokemonSetInfo } from "./tcgdex";
import { pokemonDetails } from "./types";

const STAGE_RANK: Record<string, number> = { Basic: 0, Stage1: 1, Stage2: 2 };

// ── The list ─────────────────────────────────────────────────────────────────

export interface PokemonDeckListEntry {
  id: number;
  name: string;
  format: string;
  isBuilt: boolean;
  owner: string | null;
  /** Cards in the main deck. */
  count: number;
  status: "legal" | "incomplete" | "illegal";
  /** The picture on the row: the deck's most played Pokémon, highest stage first. Null for an empty deck. */
  cover: { name: string; image: string | null } | null;
}

/** The Pokémon decks the looker may see (`currentScope()`), built ones first. */
export async function pokemonDeckList(db: Db, scope: OwnerScope): Promise<PokemonDeckListEntry[]> {
  const list = await listDecks(db, { game: "pokemon", viewer: scope });
  if (list.length === 0) return [];
  const lines = await db
    .select({ deckId: deckCards.deckId, quantity: deckCards.quantity, name: cards.name, cardType: cards.cardType, imageUrl: cards.imageUrl, details: cards.details })
    .from(deckCards)
    .innerJoin(cards, eq(cards.id, deckCards.cardId))
    .where(inArray(deckCards.deckId, list.map((d) => d.id)));
  const cover = new Map<number, { name: string; image: string | null; rank: number[] }>();
  for (const l of lines) {
    if (l.cardType !== "POKEMON" || !l.imageUrl) continue;
    const stage = pokemonDetails(l.details).stage;
    const rank = [l.quantity, stage ? (STAGE_RANK[stage] ?? 3) : 0];
    const best = cover.get(l.deckId);
    if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && rank[1] > best.rank[1])) cover.set(l.deckId, { name: l.name, image: lowImage(l.imageUrl), rank });
  }
  return list.map((d) => ({
    id: d.id,
    name: d.name,
    format: pokemonFormatOf(d.format),
    isBuilt: d.isBuilt,
    owner: d.owner,
    count: d.legality.mainCount,
    status: d.legality.status,
    cover: cover.has(d.id) ? { name: cover.get(d.id)!.name, image: cover.get(d.id)!.image } : null,
  }));
}

// ── Create ───────────────────────────────────────────────────────────────────

/** An empty Pokémon deck of the viewer's, in `format` (Standard when it is not one the game has). Stamps `decks.owner`. */
export async function createPokemonDeck(db: Db, viewer: Viewer, input: { name: string; format?: string | null }): Promise<{ id: number; name: string }> {
  const formats = deckRules("pokemon").formats;
  const format = input.format && formats.includes(input.format) ? input.format : formats[0];
  const name = String(input.name ?? "").trim().slice(0, 120) || "Neues Deck";
  const [row] = await db.insert(decks).values({ name, game: "pokemon", format, owner: viewer.owner }).returning({ id: decks.id, name: decks.name });
  return row;
}

// ── Wishes for the missing copies ────────────────────────────────────────────

/** The deck owner's wished copies per card, among `cardIds`. */
export async function wishedCopies(db: Db, owner: string | null, cardIds: string[]): Promise<Record<string, number>> {
  if (cardIds.length === 0) return {};
  const found = await db
    .select({ cardId: wantList.cardId, quantity: wantList.quantity })
    .from(wantList)
    .where(and(inArray(wantList.cardId, cardIds), owner === null ? isNull(wantList.owner) : eq(wantList.owner, owner)));
  return Object.fromEntries(found.map((r) => [r.cardId, r.quantity]));
}

export interface WishMissingResult {
  /** Copies the deck is short of (all cards, or the one card asked for). */
  missing: number;
  /** Copies added to the wishes now (a card already wished for its missing copies adds nothing). */
  added: number;
  /** Cards whose wish grew. */
  cards: number;
}

/**
 * Wish for the copies a deck is short of, for the deck's own owner (the want list has one row per owner
 * and card, `addWant`). A wish already covering the missing copies is left alone, so a second tap adds
 * nothing. `only` limits it to one card (the heart on a row).
 */
export async function wishMissing(db: Db, deckId: number, only?: string): Promise<WishMissingResult> {
  const [deck] = await db.select({ owner: decks.owner }).from(decks).where(eq(decks.id, deckId)).limit(1);
  if (!deck) return { missing: 0, added: 0, cards: 0 };
  const held = await db
    .select({ cardId: deckCards.cardId, quantity: sql<number>`sum(${deckCards.quantity})::int` })
    .from(deckCards)
    .where(eq(deckCards.deckId, deckId))
    .groupBy(deckCards.cardId);
  const alloc = await allocationForCards(db, held.map((h) => h.cardId), deck.owner);
  const { lines } = missingCopies(held.map((h) => ({ cardId: h.cardId, quantity: Number(h.quantity), owned: alloc.get(h.cardId)?.owned ?? 0 })));
  const chosen = only ? lines.filter((l) => l.cardId === only) : lines;
  const wished = await wishedCopies(db, deck.owner, chosen.map((l) => l.cardId));
  const toAdd = wishesToAdd(chosen, wished);
  if (toAdd.length > 0) {
    await db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      for (const w of toAdd) await addWant(t, deck.owner, w.cardId, w.add, null, deckId);
    });
  }
  return { missing: chosen.reduce((n, l) => n + l.missing, 0), added: toAdd.reduce((n, w) => n + w.add, 0), cards: toAdd.length };
}

// ── Pasting a deck list ──────────────────────────────────────────────────────

export interface DeckListSource {
  /** `searchPokemon` in production. */
  search: DeckListSearch;
  /** The source's set id for a printed set code ("OBF" gives "sv03"); without it set codes are ignored and ties are guesses. */
  setIdForCode?: SetIdForCode;
  /** `loadPokemonCard` in production (the live read of one card); a stub in the test. */
  load: (tcgdexId: string) => Promise<{ record: PokemonCardRecord; set: PokemonSetInfo | null }>;
}

export interface ImportResult {
  deckId: number | null;
  /** Cards put in the deck, with copies (the resolved lines). */
  added: number;
  resolution: DeckListResolution;
  /** How many copies the text asked for in all, to compare with `added`. */
  asked: number;
}

/**
 * Read a pasted list, find every line at the source, and put what was found into a new deck. Cards are stored with `ensurePokemonCard`, the deck line with the
 * app's own `addCardsToDeck` (never capped: a fifth copy is flagged on the deck, not refused). Lines that
 * could not be read or found come back in `resolution.unresolved`. Nothing is created when no line was found.
 */
export async function importPokemonDeckList(
  db: Db,
  viewer: Viewer,
  input: { text: string; name?: string | null; format?: string | null },
  source: DeckListSource,
): Promise<ImportResult> {
  const parsed = parseDeckListPokemon(input.text);
  const resolution = await resolveDeckList(parsed, source.search, source.setIdForCode);
  const asked = parsed.total;
  if (resolution.cards.length === 0) return { deckId: null, added: 0, resolution, asked };

  // The network reads first, never inside the transaction.
  const loaded = new Map<string, Awaited<ReturnType<DeckListSource["load"]>>>();
  let next = 0;
  const work = async () => {
    while (next < resolution.cards.length) {
      const c = resolution.cards[next++];
      loaded.set(c.tcgdexId, await source.load(c.tcgdexId));
    }
  };
  await Promise.all(Array.from({ length: 4 }, work));

  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const deckId = (await createPokemonDeck(t, viewer, { name: input.name ?? "", format: input.format })).id;
    const entries: { cardId: string; quantity: number }[] = [];
    for (const c of resolution.cards) {
      const src = loaded.get(c.tcgdexId)!;
      const card = await ensurePokemonCard(t, c.tcgdexId, { ...src });
      entries.push({ cardId: card.cardId, quantity: c.count });
    }
    const { added } = await addCardsToDeck(t, deckId, entries);
    return { deckId, added, resolution, asked };
  });
}
