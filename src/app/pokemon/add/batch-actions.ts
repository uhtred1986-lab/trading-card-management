"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireSignedIn } from "@/lib/auth";
import { assertPokemonDeck } from "@/lib/pokemon/collection";
import {
  completePokemonBatch,
  discardPokemonBatch,
  getPokemonBatch,
  setPokemonBatchDeck,
  updatePokemonItem,
  type PokemonBatchItem,
  type PokemonBatchState,
  type PokemonCompleteResult,
  type PokemonItemPatch,
} from "@/lib/pokemon/scan-batch";

function refresh() {
  revalidatePath("/pokemon");
  revalidatePath("/pokemon/add");
  revalidatePath("/pokemon/add/photo");
}

/** The batch as it is now (another device may have changed it). A batch that is not the viewer's answers "not found". */
export async function getPokemonBatchAction(batchId: number): Promise<PokemonBatchState> {
  const viewer = await requireSignedIn();
  return getPokemonBatch(db, viewer, batchId);
}

/** One edit of one cell: the card picked, confirmed or left out, the variant, language or number. */
export async function updatePokemonScanItemAction(itemId: number, patch: PokemonItemPatch): Promise<PokemonBatchItem> {
  const viewer = await requireSignedIn();
  return updatePokemonItem(db, viewer, itemId, patch);
}

/** The deck the page's cards are also put into (null for none). */
export async function setPokemonBatchDeckAction(batchId: number, deckId: number | null): Promise<void> {
  const viewer = await requireSignedIn();
  if (deckId !== null) await assertPokemonDeck(db, viewer, deckId);
  await setPokemonBatchDeck(db, viewer, batchId, deckId);
}

/** Save the confirmed cards (the Pokémon add path, owner and deck from the batch), then close the page. */
export async function completePokemonBatchAction(batchId: number): Promise<PokemonCompleteResult> {
  const viewer = await requireSignedIn();
  const r = await completePokemonBatch(db, viewer, batchId);
  revalidatePath("/", "layout");
  refresh();
  return r;
}

/** Throw the whole page away. */
export async function discardPokemonBatchAction(batchId: number): Promise<void> {
  const viewer = await requireSignedIn();
  await discardPokemonBatch(db, viewer, batchId);
  refresh();
}
