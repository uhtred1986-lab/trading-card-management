import { requireSignedInPage } from "@/lib/auth";
import { PokemonPhotoAdd } from "@/components/pokemon/PokemonPhotoAdd";
import { deckFromParam, pokemonDeckChoices } from "@/lib/pokemon/add-decks";

export const dynamic = "force-dynamic";

export const metadata = { title: "Foto machen" };

export default async function PokemonPhotoPage({ searchParams }: { searchParams: Promise<{ deck?: string | string[] }> }) {
  await requireSignedInPage();
  const [decks, query] = await Promise.all([pokemonDeckChoices(), searchParams]);
  return <PokemonPhotoAdd decks={decks} initialDeck={deckFromParam(query.deck, decks)} />;
}
