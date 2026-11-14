import { db } from "@/db";
import { currentScope, requireSignedInPage } from "@/lib/auth";
import { hasAnthropic } from "@/lib/ai/client";
import { pokemonDeckList } from "@/lib/pokemon/deck-data";
import { DeckListScreen } from "@/components/pokemon/DeckListScreen";

export const dynamic = "force-dynamic";

export const metadata = { title: "Decks" };

/** Decks: the viewer's Pokémon decks (an SL sees every player's, labelled by owner). */
export default async function PokemonDecksPage() {
  const viewer = await requireSignedInPage();
  const list = await pokemonDeckList(db, await currentScope());
  return <DeckListScreen decks={list} showOwners={viewer.kind === "sl" && new Set(list.map((d) => d.owner)).size > 1} claudeEnabled={hasAnthropic()} />;
}
