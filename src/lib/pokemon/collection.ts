/**
 * What a signed-in person does with a Pokémon card: own copies, wish for it, put it in a deck, and
 * what the viewer needs to show of that. The Server Functions in `src/app/pokemon/actions.ts` are
 * thin guards over these, so the data effects can be tested on PGlite without a request.
 *
 * Every function takes the `db` (or a transaction) and the `Viewer`. "Mine" is always the viewer's
 * own owner name (`viewer.owner`, null while the app runs open), also for an SL: an SL's search and
 * viewer show their own copies, never a player's. A player may touch only their own decks.
 *
 * Each write reads the source first (`loadPokemonCard`), then writes the card (`ensurePokemonCard`)
 * with the lot, deck line or wish in one transaction.
 */
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardPrints, decks, ownedCards, wantList } from "@/db/schema";
import { AccessDenied, type Viewer } from "@/lib/auth";
import { addCardsToDeck } from "@/lib/decks/add";
import { addWant, removeWant } from "@/lib/decks/swaps";
import { MAX_COPIES, copiesOf, expand } from "@/lib/collection/lots";
import { ensurePokemonCard, loadPokemonCard, printFor } from "./store";
import { POKEMON_VARIANTS, pokemonCardId, pokemonPrintId, type PokemonVariant } from "./types";

export type PokemonLotLanguage = "DE" | "EN";

export interface PokemonLotInput {
  tcgdexId: string;
  variant: PokemonVariant;
  language: PokemonLotLanguage;
  quantity: number;
  deckId?: number | null;
}

/** A refusal with a sentence the screen can show as it is. */
export class PokemonInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PokemonInputError";
  }
}

const ownerOf = (viewer: Viewer): string | null => viewer.owner;
const lotsOf = (owner: string | null) => (owner === null ? isNull(ownedCards.owner) : eq(ownedCards.owner, owner));
const wantsOf = (owner: string | null) => (owner === null ? isNull(wantList.owner) : eq(wantList.owner, owner));

function cleanVariant(variant: string): PokemonVariant {
  if (!(POKEMON_VARIANTS as readonly string[]).includes(variant)) throw new PokemonInputError("Unbekannte Variante.");
  return variant as PokemonVariant;
}

function cleanLanguage(language: string): PokemonLotLanguage {
  const l = String(language).toUpperCase();
  if (l !== "DE" && l !== "EN") throw new PokemonInputError("Sprache: DE oder EN.");
  return l;
}

function cleanTcgdexId(tcgdexId: string): string {
  const id = String(tcgdexId ?? "").trim();
  if (!/^[\w.%-]{1,64}$/.test(id)) throw new PokemonInputError("Unbekannte Karte.");
  return id;
}

/** A holo or reverse copy is a foil one; the variant itself lives in the print. */
const finishOf = (variant: PokemonVariant) => (variant === "holo" || variant === "reverse" ? "foil" : "normal");

/** The deck must be a Pokémon deck of the viewer's (an SL's: any). Throws `AccessDenied` or `PokemonInputError`. */
export async function assertPokemonDeck(db: Db, viewer: Viewer, deckId: number): Promise<void> {
  const [deck] = await db.select({ owner: decks.owner, game: decks.game }).from(decks).where(eq(decks.id, deckId)).limit(1);
  if (!deck) throw new PokemonInputError("Dieses Deck gibt es nicht.");
  if (viewer.kind === "player" && deck.owner !== viewer.owner) throw new AccessDenied("That isn't your deck.");
  if (deck.game !== "pokemon") throw new PokemonInputError("Das ist kein Pokémon-Deck.");
}

/**
 * Put `quantity` copies of one print and language into the collection (one `owned_cards` row per
 * copy, stamped with the viewer's owner), and into a deck when `deckId` is given.
 */
export async function addPokemonLots(db: Db, viewer: Viewer, input: PokemonLotInput): Promise<{ cardId: string; printId: string; ids: number[]; added: number; deckAdded: number }> {
  const tcgdexId = cleanTcgdexId(input.tcgdexId);
  const variant = cleanVariant(input.variant);
  const language = cleanLanguage(input.language);
  const deckId = input.deckId ?? null;
  if (deckId !== null) await assertPokemonDeck(db, viewer, deckId);
  const src = await loadPokemonCard(tcgdexId);
  const owner = ownerOf(viewer);
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const card = await ensurePokemonCard(t, tcgdexId, { ...src });
    const print = printFor(card, variant);
    const values = expand({ printId: print.id, cardId: card.cardId, owner, condition: "NM", finish: finishOf(variant), language }, input.quantity);
    const inserted = await t.insert(ownedCards).values(values).returning({ id: ownedCards.id });
    const deckAdded = deckId !== null ? (await addCardsToDeck(t, deckId, [{ cardId: card.cardId, quantity: values.length }])).added : 0;
    return { cardId: card.cardId, printId: print.id, ids: inserted.map((r) => r.id), added: values.length, deckAdded };
  });
}

/**
 * Make the viewer's count of one print and language exactly `quantity` (0 to 99): add copies, or
 * archive the newest ones (the app never deletes a copy, they stay restorable on /collection/archived).
 */
export async function setPokemonOwned(db: Db, viewer: Viewer, input: Omit<PokemonLotInput, "deckId">): Promise<{ quantity: number; added: number; removed: number }> {
  const tcgdexId = cleanTcgdexId(input.tcgdexId);
  const variant = cleanVariant(input.variant);
  const language = cleanLanguage(input.language);
  const target = Math.min(MAX_COPIES, Math.max(0, Math.floor(Number(input.quantity)) || 0));
  const owner = ownerOf(viewer);
  const printId = pokemonPrintId(tcgdexId, variant);
  const mine = and(eq(ownedCards.printId, printId), eq(ownedCards.language, language), lotsOf(owner), isNull(ownedCards.archivedAt));
  const current = await db.select({ id: ownedCards.id }).from(ownedCards).where(mine).orderBy(ownedCards.id);
  if (current.length === target) return { quantity: target, added: 0, removed: 0 };

  if (current.length > target) {
    const drop = current.slice(target).map((r) => r.id);
    const now = new Date();
    await db.update(ownedCards).set({ archivedAt: now, updatedAt: now }).where(inArray(ownedCards.id, drop));
    return { quantity: target, added: 0, removed: drop.length };
  }

  const src = await loadPokemonCard(tcgdexId);
  const need = target - current.length;
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const card = await ensurePokemonCard(t, tcgdexId, { ...src });
    const print = printFor(card, variant);
    await t.insert(ownedCards).values(expand({ printId: print.id, cardId: card.cardId, owner, condition: "NM", finish: finishOf(variant), language }, need));
  });
  return { quantity: target, added: need, removed: 0 };
}

/** Heart on or off for the viewer. Returns the new state. */
export async function togglePokemonWish(db: Db, viewer: Viewer, tcgdexIdRaw: string): Promise<{ wished: boolean }> {
  const tcgdexId = cleanTcgdexId(tcgdexIdRaw);
  const owner = ownerOf(viewer);
  const cardId = pokemonCardId(tcgdexId);
  const [row] = await db.select({ id: wantList.id }).from(wantList).where(and(eq(wantList.cardId, cardId), wantsOf(owner))).limit(1);
  if (row) {
    await removeWant(db, owner, cardId);
    return { wished: false };
  }
  const src = await loadPokemonCard(tcgdexId);
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const card = await ensurePokemonCard(t, tcgdexId, { ...src });
    await addWant(t, owner, card.cardId, 1, null, null);
  });
  return { wished: true };
}

/** Put a card into one of the viewer's Pokémon decks (the app's own `addCardsToDeck`: it adds, never caps). */
export async function addPokemonToDeck(db: Db, viewer: Viewer, input: { deckId: number; tcgdexId: string; quantity: number }): Promise<{ cardId: string; added: number }> {
  const tcgdexId = cleanTcgdexId(input.tcgdexId);
  await assertPokemonDeck(db, viewer, input.deckId);
  const src = await loadPokemonCard(tcgdexId);
  const quantity = copiesOf(input.quantity);
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const card = await ensurePokemonCard(t, tcgdexId, { ...src });
    const { added } = await addCardsToDeck(t, input.deckId, [{ cardId: card.cardId, quantity }]);
    return { cardId: card.cardId, added };
  });
}

// ── What the viewer shows ────────────────────────────────────────────────────

/** The viewer's own number of copies per card id, among `cardIds` (active copies, every print and language). */
export async function ownedCountsFor(db: Db, viewer: Viewer, cardIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (cardIds.length === 0) return out;
  const found = await db
    .select({ cardId: ownedCards.cardId, n: count() })
    .from(ownedCards)
    .where(and(inArray(ownedCards.cardId, cardIds), lotsOf(ownerOf(viewer)), isNull(ownedCards.archivedAt)))
    .groupBy(ownedCards.cardId);
  for (const r of found) out[r.cardId] = Number(r.n);
  return out;
}

/** Which of `cardIds` are on the viewer's own want list. */
export async function wishedAmong(db: Db, viewer: Viewer, cardIds: string[]): Promise<string[]> {
  if (cardIds.length === 0) return [];
  const found = await db.select({ cardId: wantList.cardId }).from(wantList).where(and(inArray(wantList.cardId, cardIds), wantsOf(ownerOf(viewer))));
  return found.map((r) => r.cardId);
}

export interface OwnedLine {
  printId: string;
  variant: PokemonVariant;
  language: PokemonLotLanguage;
  quantity: number;
}

/** The viewer's copies of one card, by variant and language. */
export async function ownedLinesFor(db: Db, viewer: Viewer, cardId: string): Promise<OwnedLine[]> {
  const found = await db
    .select({ printId: ownedCards.printId, suffix: cardPrints.suffix, language: ownedCards.language, n: sql<number>`count(*)::int` })
    .from(ownedCards)
    .innerJoin(cardPrints, eq(cardPrints.id, ownedCards.printId))
    .where(and(eq(ownedCards.cardId, cardId), lotsOf(ownerOf(viewer)), isNull(ownedCards.archivedAt)))
    .groupBy(ownedCards.printId, cardPrints.suffix, ownedCards.language)
    .orderBy(ownedCards.printId, ownedCards.language);
  return found.map((r) => ({ printId: r.printId, variant: (r.suffix || "normal") as PokemonVariant, language: (r.language === "DE" ? "DE" : "EN") as PokemonLotLanguage, quantity: Number(r.n) }));
}
