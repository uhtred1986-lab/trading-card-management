import { db } from "@/db";
import { currentScope, requireSignedInPage } from "@/lib/auth";
import { wishedAmong } from "@/lib/pokemon/collection";
import { pokemonCollection, pokemonDecks } from "@/lib/pokemon/views";
import { CollectionScreen } from "@/components/pokemon/CollectionScreen";

export const dynamic = "force-dynamic";

/** Sammlung: the viewer's Pokémon cards from the local database (an SL sees every player's). Works when TCGdex is down. */
export default async function PokemonCollectionPage() {
  const viewer = await requireSignedInPage();
  const scope = await currentScope();
  const [view, decks] = await Promise.all([pokemonCollection(db, scope, viewer.owner), pokemonDecks(db, scope)]);
  const wishedIds = await wishedAmong(db, viewer, [...new Set(view.entries.map((e) => e.id))]);
  return <CollectionScreen entries={view.entries} copies={view.copies} valueCents={view.valueCents} decks={decks} wishedIds={wishedIds} showOwners={viewer.kind === "sl" && view.owners.length > 1} />;
}
