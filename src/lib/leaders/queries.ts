import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardSets, cards, deckCards, decks, ownedCards } from "@/db/schema";
import { gameOr, type Game } from "@/lib/catalog/games";
import { legalityForDecks, type DeckStatus } from "@/lib/decks/legality";

export interface OwnedLeader {
  id: string;
  name: string;
  backName: string | null;
  setCode: string;
  setName: string;
  game: Game;
  colors: string[];
  rarityCode: string;
  imageUrl: string | null;
  backImageUrl: string | null;
  owned: number;
  decks: { id: number; name: string; isBuilt: boolean; game: Game; mainCount: number; status: DeckStatus }[];
}

/** Every LEADER card in the collection, with the decks it leads. */
export async function ownedLeaders(db: Db, opts: { color?: string; game?: Game } = {}): Promise<OwnedLeader[]> {
  const where = and(
    eq(cards.cardType, "LEADER"),
    isNull(ownedCards.archivedAt),
    ...(opts.color ? [sql`${opts.color} = any(${cards.colors})`] : []),
    ...(opts.game ? [eq(cards.game, opts.game)] : []),
  );
  const rows = await db
    .select({
      id: cards.id,
      name: cards.name,
      backName: cards.backName,
      setCode: cards.setCode,
      setName: cardSets.name,
      game: cards.game,
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
    .where(where)
    .groupBy(cards.id, cardSets.name, cardSets.sortKey)
    .orderBy(desc(cardSets.sortKey), cards.name);
  if (rows.length === 0) return [];

  const usage = await db
    .select({ leaderId: deckCards.cardId, id: decks.id, name: decks.name, isBuilt: decks.isBuilt, game: decks.game })
    .from(deckCards)
    .innerJoin(decks, eq(decks.id, deckCards.deckId))
    .where(and(eq(deckCards.zone, "leader"), sql`${deckCards.cardId} in ${rows.map((r) => r.id)}`))
    .orderBy(desc(decks.isBuilt), decks.name);

  const legalities = await legalityForDecks(db, [...new Set(usage.map((u) => u.id))]);
  const byLeader = new Map<string, OwnedLeader["decks"]>();
  for (const u of usage) {
    const list = byLeader.get(u.leaderId) ?? [];
    const l = legalities.get(u.id);
    list.push({ id: u.id, name: u.name, isBuilt: u.isBuilt, game: gameOr(u.game), mainCount: l?.mainCount ?? 0, status: l?.status ?? "incomplete" });
    byLeader.set(u.leaderId, list);
  }
  return rows.map((r) => {
    const { setSort, ...rest } = r;
    void setSort;
    return { ...rest, game: gameOr(r.game), decks: byLeader.get(r.id) ?? [] };
  });
}
