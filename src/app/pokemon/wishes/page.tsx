import { db } from "@/db";
import { currentScope, requireSignedInPage } from "@/lib/auth";
import { pokemonDecks, pokemonWishes } from "@/lib/pokemon/views";
import { WishesScreen } from "@/components/pokemon/WishesScreen";

export const dynamic = "force-dynamic";

/** Wünsche: the viewer's own wished Pokémon cards with prices. The admin's buying side is /cart. */
export default async function PokemonWishesPage() {
  const viewer = await requireSignedInPage();
  const scope = await currentScope();
  const [wishes, decks] = await Promise.all([pokemonWishes(db, scope, viewer.owner), pokemonDecks(db, scope)]);
  return <WishesScreen entries={wishes.entries} decks={decks} />;
}
