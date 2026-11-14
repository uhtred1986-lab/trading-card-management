import { requireSignedInPage } from "@/lib/auth";
import { PokemonVoiceAdd } from "@/components/pokemon/PokemonVoiceAdd";
import { deckFromParam, pokemonDeckChoices } from "@/lib/pokemon/add-decks";

export const dynamic = "force-dynamic";

export const metadata = { title: "Vorlesen" };

export default async function PokemonVoicePage({ searchParams }: { searchParams: Promise<{ deck?: string | string[] }> }) {
  await requireSignedInPage();
  const [decks, query] = await Promise.all([pokemonDeckChoices(), searchParams]);
  return <PokemonVoiceAdd decks={decks} initialDeck={deckFromParam(query.deck, decks)} />;
}
