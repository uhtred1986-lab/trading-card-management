"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { decks } from "@/db/schema";
import { requireSignedIn } from "@/lib/auth";
import { setBuilt, setDeckCard } from "@/app/decks/actions";
import { builtRefusal } from "@/lib/pokemon/deck-logic";
import { PK } from "@/lib/pokemon/copy";
import { assertPokemonDeck, PokemonInputError } from "@/lib/pokemon/collection";
import { createPokemonDeck, importPokemonDeckList, liveDeckListLoader, wishMissing, type WishMissingResult } from "@/lib/pokemon/deck-data";
import type { UnresolvedLine } from "@/lib/pokemon/decklist";
import { isPokemonSourceError, searchPokemon } from "@/lib/pokemon/tcgdex";
import type { Zone } from "@/lib/decks/queries";

/** The longest list we read: a deck is 60 cards, so a long text is not a deck list. */
const MAX_LIST_CHARS = 12_000;

function refresh(deckId?: number) {
  revalidatePath("/pokemon/decks");
  revalidatePath("/pokemon/wishes");
  revalidatePath("/pokemon");
  revalidatePath("/decks");
  revalidatePath("/collection");
  if (deckId) {
    revalidatePath(`/pokemon/decks/${deckId}`);
    revalidatePath(`/decks/${deckId}`);
  }
}

/** A new empty Pokémon deck of the viewer's (the owner is stamped); the page opens it. */
export async function createPokemonDeckAction(input: { name: string; format?: string | null }): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const viewer = await requireSignedIn();
  try {
    const deck = await createPokemonDeck(db, viewer, input);
    refresh();
    return { ok: true, id: deck.id };
  } catch {
    return { ok: false, error: PK.newDeck.failed };
  }
}

export async function renamePokemonDeckAction(deckId: number, name: string): Promise<{ ok: boolean; name: string }> {
  const viewer = await requireSignedIn();
  await assertPokemonDeck(db, viewer, deckId);
  const clean = String(name ?? "").trim().slice(0, 120);
  if (!clean) return { ok: false, name: "" };
  await db.update(decks).set({ name: clean, updatedAt: new Date() }).where(eq(decks.id, deckId));
  refresh(deckId);
  return { ok: true, name: clean };
}

export async function deletePokemonDeckAction(deckId: number): Promise<{ ok: true }> {
  const viewer = await requireSignedIn();
  await assertPokemonDeck(db, viewer, deckId);
  await db.delete(decks).where(eq(decks.id, deckId));
  refresh(deckId);
  return { ok: true };
}

/**
 * Set how many copies of a card the deck holds (0 removes it). Over the copy limit is flagged by the
 * deck's legality, never refused; only a built deck can be refused, when it would need more copies
 * than the owner has (`setDeckCard`), and then the answer is a German sentence.
 */
export async function setPokemonDeckCardAction(deckId: number, cardId: string, zone: Zone, quantity: number): Promise<{ ok: true } | { ok: false; message: string }> {
  const viewer = await requireSignedIn();
  await assertPokemonDeck(db, viewer, deckId);
  const r = await setDeckCard(deckId, cardId, zone, quantity);
  refresh(deckId);
  return r.ok ? { ok: true } : { ok: false, message: builtRefusal(r.conflicts) };
}

/** "Deck ist gebaut": the one refusal is the over-reserve one, answered as a sentence naming the cards. Unmarking always works. */
export async function setPokemonBuiltAction(deckId: number, built: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  const viewer = await requireSignedIn();
  await assertPokemonDeck(db, viewer, deckId);
  const r = await setBuilt(deckId, built);
  refresh(deckId);
  return r.ok ? { ok: true } : { ok: false, message: builtRefusal(r.conflicts) };
}

/** Wish for the copies the deck is short of (all of them, or `cardId`'s), for the deck's owner. */
export async function wishMissingAction(deckId: number, cardId?: string): Promise<WishMissingResult> {
  const viewer = await requireSignedIn();
  await assertPokemonDeck(db, viewer, deckId);
  const r = await wishMissing(db, deckId, cardId);
  refresh(deckId);
  revalidatePath("/cart");
  return r;
}

export type ImportListResponse =
  | { ok: true; deckId: number; name: string; added: number; asked: number; unresolved: UnresolvedLine[]; guessed: { raw: string; at: number; took: string }[] }
  | { ok: false; error: string; unresolved?: UnresolvedLine[] };

/** Paste a deck list: find every line at the card source and make a new deck from what was found. */
export async function importPokemonDeckListAction(input: { text: string; name?: string | null; format?: string | null }): Promise<ImportListResponse> {
  const viewer = await requireSignedIn();
  const text = String(input.text ?? "");
  if (!text.trim()) return { ok: false, error: PK.importList.empty };
  if (text.length > MAX_LIST_CHARS) return { ok: false, error: PK.importList.failed };
  try {
    const name = String(input.name ?? "").trim().slice(0, 120) || PK.importList.deckNameDefault;
    const r = await importPokemonDeckList(db, viewer, { text, name, format: input.format }, { search: (p) => searchPokemon({ q: p.q, category: p.category }), load: liveDeckListLoader });
    if (r.deckId === null) return { ok: false, error: PK.importList.nothingFound, unresolved: r.resolution.unresolved };
    refresh(r.deckId);
    return { ok: true, deckId: r.deckId, name, added: r.added, asked: r.asked, unresolved: r.resolution.unresolved, guessed: r.resolution.guessed };
  } catch (e) {
    if (isPokemonSourceError(e)) return { ok: false, error: PK.importList.unavailable };
    if (e instanceof PokemonInputError) return { ok: false, error: e.message };
    return { ok: false, error: PK.importList.failed };
  }
}
