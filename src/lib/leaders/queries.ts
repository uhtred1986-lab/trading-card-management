import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardSets, cards, deckCards, decks, ownedCards } from "@/db/schema";
import { legalityForDecks, type DeckStatus } from "@/lib/decks/legality";

export interface OwnedLeader {
  id: string;
  name: string;
  backName: string | null;
  setCode: string;
  setName: string;
  colors: string[];
  rarityCode: string;
  imageUrl: string | null;
  backImageUrl: string | null;
  owned: number;
  decks: { id: number; name: string; isBuilt: boolean; mainCount: number; status: DeckStatus }[];
}

/** Every LEADER card in the collection, with the decks it leads. */
export async function ownedLeaders(db: Db): Promise<OwnedLeader[]> {
  const rows = await db
    .select({
      id: cards.id,
      name: cards.name,
      backName: cards.backName,
      setCode: cards.setCode,
      setName: cardSets.name,
      colors: cards.colors,
      rarityCode: cards.rarityCode,
      imageUrl: cards.imageUrl,
      backImageUrl: cards.backImageUrl,
      owned: sql<number>`count(*)::int`,
      setSort: cardSets.sortKey,
    })
    .from(ownedCards)
    .innerJoin(cards, eq(cards.id, ownedCards.cardId))
    .innerJoin(cardSets, eq(cardSets.code, cards.setCode))
    .where(eq(cards.cardType, "LEADER"))
    .groupBy(cards.id, cardSets.name, cardSets.sortKey)
    .orderBy(desc(cardSets.sortKey), cards.name);
  if (rows.length === 0) return [];

  const usage = await db
    .select({ leaderId: deckCards.cardId, id: decks.id, name: decks.name, isBuilt: decks.isBuilt })
    .from(deckCards)
    .innerJoin(decks, eq(decks.id, deckCards.deckId))
    .where(and(eq(deckCards.zone, "leader"), sql`${deckCards.cardId} in ${rows.map((r) => r.id)}`))
    .orderBy(desc(decks.isBuilt), decks.name);

  const legalities = await legalityForDecks(db, [...new Set(usage.map((u) => u.id))]);
  const byLeader = new Map<string, OwnedLeader["decks"]>();
  for (const u of usage) {
    const list = byLeader.get(u.leaderId) ?? [];
    const l = legalities.get(u.id);
    list.push({ id: u.id, name: u.name, isBuilt: u.isBuilt, mainCount: l?.mainCount ?? 0, status: l?.status ?? "incomplete" });
    byLeader.set(u.leaderId, list);
  }
  return rows.map((r) => {
    const { setSort, ...rest } = r;
    void setSort;
    return { ...rest, decks: byLeader.get(r.id) ?? [] };
  });
}
