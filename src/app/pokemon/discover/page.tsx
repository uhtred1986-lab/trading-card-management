import { eq } from "drizzle-orm";
import { db } from "@/db";
import { decks as decksTable } from "@/db/schema";
import { currentScope, requireSignedInPage } from "@/lib/auth";
import { deckFromParam, pokemonDeckChoices } from "@/lib/pokemon/add-decks";
import { pokemonCollection, pokemonDecks } from "@/lib/pokemon/views";
import { DiscoverScreen, type DiscoverTarget } from "@/components/pokemon/DiscoverScreen";

export const dynamic = "force-dynamic";

/**
 * Entdecken: live search at TCGdex (through /api/pokemon/search). The page itself only reads her decks.
 * With `?deck=<id>` (a deck of hers) "Ins Deck" goes straight into that deck and her own cards come first.
 */
export default async function PokemonDiscoverPage({ searchParams }: { searchParams: Promise<{ deck?: string | string[] }> }) {
  await requireSignedInPage();
  const scope = await currentScope();
  const [list, choices, query] = await Promise.all([pokemonDecks(db, scope), pokemonDeckChoices(), searchParams]);
  const deckId = deckFromParam(query.deck, choices);
  let target: DiscoverTarget | null = null;
  if (deckId !== null) {
    const [deck] = await db.select({ owner: decksTable.owner, name: decksTable.name }).from(decksTable).where(eq(decksTable.id, deckId)).limit(1);
    if (deck) {
      const [own, inDeck] = await Promise.all([pokemonCollection(db, deck.owner, deck.owner), db.query.deckCards.findMany({ where: (t) => eq(t.deckId, deckId), columns: { cardId: true, quantity: true } })]);
      const cards: Record<string, number> = {};
      for (const r of inDeck) cards[r.cardId] = (cards[r.cardId] ?? 0) + r.quantity;
      target = { id: deckId, name: deck.name, cards, own: own.entries };
    }
  }
  return <DiscoverScreen decks={list} target={target} />;
}
