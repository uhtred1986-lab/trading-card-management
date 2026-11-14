"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireSignedIn } from "@/lib/auth";
import { addPokemonLots, addPokemonToDeck, setPokemonOwned, togglePokemonWish, type PokemonLotInput, type PokemonLotLanguage } from "@/lib/pokemon/collection";
import { pokemonCardId, type PokemonVariant } from "@/lib/pokemon/types";

export interface AddPokemonLotInput {
  tcgdexId: string;
  variant: PokemonVariant;
  language: PokemonLotLanguage;
  quantity: number;
  /** Also put the copies into this (Pokémon) deck. */
  deckId?: number | null;
}

function revalidateCard(tcgdexId: string, deckId?: number | null) {
  revalidatePath("/");
  revalidatePath("/collection");
  revalidatePath("/decks");
  revalidatePath(`/cards/${encodeURIComponent(pokemonCardId(tcgdexId))}`);
  if (deckId) revalidatePath(`/decks/${deckId}`);
}

/**
 * Add copies of a card the viewer holds. The card is written to the catalog first (live read of
 * TCGdex), then one lot per copy, stamped with the viewer's owner; `deckId` adds them to that deck too.
 */
export async function addPokemonLotAction(input: AddPokemonLotInput): Promise<{ cardId: string; printId: string; added: number; deckAdded: number }> {
  const viewer = await requireSignedIn();
  const r = await addPokemonLots(db, viewer, input satisfies PokemonLotInput);
  revalidateCard(input.tcgdexId, input.deckId);
  return { cardId: r.cardId, printId: r.printId, added: r.added, deckAdded: r.deckAdded };
}

/** Set the viewer's count of one variant and language to an exact number (0 archives them all). */
export async function setPokemonOwnedAction(input: { tcgdexId: string; variant: PokemonVariant; language: PokemonLotLanguage; quantity: number }): Promise<{ quantity: number; added: number; removed: number }> {
  const viewer = await requireSignedIn();
  const r = await setPokemonOwned(db, viewer, input);
  revalidateCard(input.tcgdexId);
  return r;
}

/** Heart on or off on the viewer's want list. Returns the new state. */
export async function togglePokemonWishAction(tcgdexId: string): Promise<{ wished: boolean }> {
  const viewer = await requireSignedIn();
  const r = await togglePokemonWish(db, viewer, tcgdexId);
  revalidateCard(tcgdexId);
  revalidatePath("/cart");
  return r;
}

/** Put a card into one of the viewer's Pokémon decks. */
export async function addPokemonToDeckAction(input: { deckId: number; tcgdexId: string; quantity: number }): Promise<{ cardId: string; added: number }> {
  const viewer = await requireSignedIn();
  const r = await addPokemonToDeck(db, viewer, input);
  revalidateCard(input.tcgdexId, input.deckId);
  return r;
}
