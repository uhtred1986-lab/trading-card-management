/**
 * Leader pick rates from stored regional results (src/lib/meta/sync.ts), and
 * the per-placement decklists behind each "buy this decklist" link. Plain
 * grouping and counting — no AI, nothing probabilistic.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { cards, metaEvents, metaResultCards, metaResults } from "@/db/schema";
import type { Game } from "@/lib/catalog/games";

export interface LeaderboardPlacement {
  resultId: number;
  eventName: string;
  eventDate: string | null;
  placement: number;
  sourceUrl: string;
}

export interface LeaderboardEntry {
  game: Game;
  /** Null when the leader's card_number never resolved against the catalog. */
  leaderCardId: string | null;
  leaderNumberRaw: string;
  leaderName: string | null;
  imageUrl: string | null;
  colors: string[];
  rarityCode: string | null;
  /** Total top-cut appearances in the lookback window. */
  appearances: number;
  /** Of those, how many were a top-4 finish. */
  topFour: number;
  placements: LeaderboardPlacement[];
}

/** Ranked by appearances, then top-4 conversion — most-picked, best-performing leaders first. */
export async function leaderboard(db: Db, opts: { game?: Game; days?: number } = {}): Promise<LeaderboardEntry[]> {
  const since = new Date(Date.now() - (opts.days ?? 90) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await db
    .select({
      resultId: metaResults.id,
      placement: metaResults.placement,
      leaderCardId: metaResults.leaderCardId,
      leaderNumberRaw: metaResults.leaderNumberRaw,
      sourceUrl: metaResults.sourceUrl,
      game: metaEvents.game,
      eventName: metaEvents.name,
      eventDate: metaEvents.occurredOn,
      leaderName: cards.name,
      imageUrl: cards.imageUrl,
      colors: cards.colors,
      rarityCode: cards.rarityCode,
    })
    .from(metaResults)
    .innerJoin(metaEvents, eq(metaEvents.id, metaResults.eventId))
    .leftJoin(cards, eq(cards.id, metaResults.leaderCardId))
    .where(and(gte(metaEvents.occurredOn, since), opts.game ? eq(metaEvents.game, opts.game) : undefined))
    .orderBy(desc(metaEvents.occurredOn));

  const byLeader = new Map<string, LeaderboardEntry>();
  for (const r of rows) {
    const key = r.leaderCardId ?? `raw:${r.leaderNumberRaw}`;
    let entry = byLeader.get(key);
    if (!entry) {
      entry = {
        game: r.game as Game,
        leaderCardId: r.leaderCardId,
        leaderNumberRaw: r.leaderNumberRaw,
        leaderName: r.leaderName,
        imageUrl: r.imageUrl,
        colors: r.colors ?? [],
        rarityCode: r.rarityCode,
        appearances: 0,
        topFour: 0,
        placements: [],
      };
      byLeader.set(key, entry);
    }
    entry.appearances++;
    if (r.placement <= 4) entry.topFour++;
    entry.placements.push({ resultId: r.resultId, eventName: r.eventName, eventDate: r.eventDate, placement: r.placement, sourceUrl: r.sourceUrl });
  }

  return [...byLeader.values()].sort((a, b) => b.appearances - a.appearances || b.topFour - a.topFour);
}

export interface ResultCard {
  cardId: string | null;
  cardNumberRaw: string;
  zone: string;
  quantity: number;
}

export async function resultCardsFor(db: Db, resultIds: number[]): Promise<Map<number, ResultCard[]>> {
  const map = new Map<number, ResultCard[]>();
  if (resultIds.length === 0) return map;
  const rows = await db
    .select({
      resultId: metaResultCards.resultId,
      cardId: metaResultCards.cardId,
      cardNumberRaw: metaResultCards.cardNumberRaw,
      zone: metaResultCards.zone,
      quantity: metaResultCards.quantity,
    })
    .from(metaResultCards)
    .where(inArray(metaResultCards.resultId, resultIds));
  for (const r of rows) {
    const list = map.get(r.resultId) ?? [];
    list.push(r);
    map.set(r.resultId, list);
  }
  return map;
}

/** `/cart?cards=...` for every card that resolved; cards that didn't are counted, not dropped. */
export function buyLink(resultCards: ResultCard[]): { href: string; unmatched: number } {
  const matched = resultCards.filter((c) => c.cardId);
  const qs = matched.map((c) => `${encodeURIComponent(c.cardId!)}:${c.quantity}`).join(",");
  return { href: `/cart?cards=${qs}`, unmatched: resultCards.length - matched.length };
}
