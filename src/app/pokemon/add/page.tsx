import { db } from "@/db";
import { requireSignedInPage } from "@/lib/auth";
import { AddHub } from "@/components/pokemon/AddHub";
import { deckFromParam, pokemonDeckChoices } from "@/lib/pokemon/add-decks";
import { pokemonBatchOffer } from "@/lib/pokemon/scan-batch";

export const dynamic = "force-dynamic";

export const metadata = { title: "Karten hinzufügen" };

export default async function PokemonAddPage({ searchParams }: { searchParams: Promise<{ deck?: string | string[] }> }) {
  const viewer = await requireSignedInPage();
  const [decks, query, offer] = await Promise.all([pokemonDeckChoices(), searchParams, pokemonBatchOffer(db, viewer)]);
  return <AddHub decks={decks} initialDeck={deckFromParam(query.deck, decks)} offer={offer} />;
}
