import { db } from "@/db";
import { currentScope, requireSignedInPage } from "@/lib/auth";
import { pokemonDecks } from "@/lib/pokemon/views";
import { DiscoverScreen } from "@/components/pokemon/DiscoverScreen";

export const dynamic = "force-dynamic";

/** Entdecken: live search at TCGdex (through /api/pokemon/search). The page itself only reads her decks. */
export default async function PokemonDiscoverPage() {
  await requireSignedInPage();
  return <DiscoverScreen decks={await pokemonDecks(db, await currentScope())} />;
}
