import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireSignedInPage } from "@/lib/auth";
import { PokemonPhotoAdd } from "@/components/pokemon/PokemonPhotoAdd";
import { deckFromParam, pokemonDeckChoices } from "@/lib/pokemon/add-decks";
import { PokemonBatchNotFound, getPokemonBatch, pokemonBatchOffer, type PokemonBatchState } from "@/lib/pokemon/scan-batch";

export const dynamic = "force-dynamic";

export const metadata = { title: "Foto machen" };

/**
 * `?batch=<id>` opens one kept page (the viewer's own; an SL may open any, anything else is a 404).
 * Without it the viewer's open page, if any, is offered here and opens on "Weitermachen"
 * (`?mode=page` is that link from the add hub).
 */
export default async function PokemonPhotoPage({ searchParams }: { searchParams: Promise<{ deck?: string | string[]; batch?: string | string[]; mode?: string | string[] }> }) {
  const viewer = await requireSignedInPage();
  const [decks, query] = await Promise.all([pokemonDeckChoices(), searchParams]);
  const asked = Number(Array.isArray(query.batch) ? query.batch[0] : query.batch);
  const byId = Number.isInteger(asked) && asked > 0;
  const wantsPage = byId || (Array.isArray(query.mode) ? query.mode[0] : query.mode) === "page";
  let batch: PokemonBatchState | null = null;
  let offer = await pokemonBatchOffer(db, viewer);
  if (byId) {
    try {
      batch = await getPokemonBatch(db, viewer, asked);
    } catch (e) {
      if (e instanceof PokemonBatchNotFound) notFound();
      throw e;
    }
    // A page that is already saved is not opened again.
    if (batch.batch.status !== "open") notFound();
  } else if (offer) {
    batch = await getPokemonBatch(db, viewer, offer.id);
  }
  if (batch && !offer) offer = { id: batch.batch.id, cards: batch.items.filter((i) => !i.saved).length, photos: batch.photos.length, updatedAt: batch.batch.updatedAt };
  return <PokemonPhotoAdd decks={decks} initialDeck={batch?.batch.deckId ?? deckFromParam(query.deck, decks)} initialMode={wantsPage ? "page" : "single"} offer={offer} initialBatch={batch} />;
}
