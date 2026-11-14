import { requireSignedInPage } from "@/lib/auth";
import { AddHub } from "@/components/pokemon/AddHub";
import { deckFromParam, pokemonDeckChoices } from "@/lib/pokemon/add-decks";

export const dynamic = "force-dynamic";

export const metadata = { title: "Karten hinzufügen" };

export default async function PokemonAddPage({ searchParams }: { searchParams: Promise<{ deck?: string | string[] }> }) {
  await requireSignedInPage();
  const [decks, query] = await Promise.all([pokemonDeckChoices(), searchParams]);
  return <AddHub decks={decks} initialDeck={deckFromParam(query.deck, decks)} />;
}
