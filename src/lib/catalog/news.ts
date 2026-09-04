/**
 * "New to the game" — derived entirely from our own catalog sync, via
 * `cards.firstSeenAt` (stamped once, on insert; see src/db/schema.ts and
 * the catalog upsert in deckplanet.ts). No external source needed: a set
 * or leader is "new" the moment `npm run sync:catalog` first sees it.
 */
import { and, desc, gte, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { cardSets, cards } from "@/db/schema";
import type { Game } from "./games";

export interface NewCard {
  id: string;
  name: string;
  cardType: string;
  isLeader: boolean;
  game: Game;
  rarity: string;
  imageUrl: string | null;
  setCode: string;
  setName: string;
  firstSeenAt: Date;
}

export async function recentCards(db: Db, opts: { game?: Game; days?: number } = {}): Promise<NewCard[]> {
  const since = new Date(Date.now() - (opts.days ?? 30) * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: cards.id,
      name: cards.name,
      cardType: cards.cardType,
      game: cards.game,
      rarity: cards.rarity,
      imageUrl: cards.imageUrl,
      setCode: cards.setCode,
      setName: cardSets.name,
      firstSeenAt: cards.firstSeenAt,
    })
    .from(cards)
    .innerJoin(cardSets, eq(cardSets.code, cards.setCode))
    .where(and(gte(cards.firstSeenAt, since), opts.game ? eq(cards.game, opts.game) : undefined))
    .orderBy(desc(cards.firstSeenAt));

  return rows.map((r) => ({ ...r, game: r.game as Game, isLeader: r.cardType === "LEADER" }));
}

/** Static outbound links — no scraping, no iframe (Bandai's own site is very likely to block framing). */
export const OFFICIAL_NEWS_LINKS: { game: Game; label: string; url: string }[] = [
  { game: "dbs", label: "Dragon Ball Super Card Game — official news", url: "https://www.dbs-cardgame.com/us-en/news/" },
  { game: "fusion", label: "Fusion World — official news", url: "https://www.dbs-cardgame.com/fw/en/news/" },
];
