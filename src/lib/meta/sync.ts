/**
 * Pulls regional results from deckplanet.net (src/lib/meta/deckplanet-results.ts)
 * into meta_events/meta_results/meta_result_cards. Idempotent per (event, deck):
 * a placement already stored is skipped rather than re-fetching its deck page,
 * so a daily run only does work for genuinely new results.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardPrints, cards, metaEvents, metaResultCards, metaResults } from "@/db/schema";
import { GAMES } from "@/lib/catalog/games";
import { dashboardDeckUrl, dashboardEventUrl, fetchDashboardEvents, fetchDeckCards } from "./deckplanet-results";

export interface MetaSyncSummary {
  events: number;
  newResults: number;
  cardsMatched: number;
  cardsUnmatched: number;
}

/** deckplanet's `card_number` is sometimes a print id ("BT30-025_SPR"); resolve through card_prints first, then a bare cards.id match. */
async function resolveCardIds(db: Db, rawNumbers: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (rawNumbers.length === 0) return map;
  const prints = await db.select({ id: cardPrints.id, cardId: cardPrints.cardId }).from(cardPrints).where(inArray(cardPrints.id, rawNumbers));
  for (const p of prints) map.set(p.id, p.cardId);
  const remaining = rawNumbers.filter((n) => !map.has(n));
  if (remaining.length) {
    const direct = await db.select({ id: cards.id }).from(cards).where(inArray(cards.id, remaining));
    for (const c of direct) map.set(c.id, c.id);
  }
  return map;
}

export async function syncMeta(db: Db): Promise<MetaSyncSummary> {
  let events = 0;
  let newResults = 0;
  let cardsMatched = 0;
  let cardsUnmatched = 0;

  for (const game of GAMES) {
    const { events: dpEvents, leaders } = await fetchDashboardEvents(game);

    for (const ev of dpEvents) {
      await db
        .insert(metaEvents)
        .values({ id: ev.id, game, name: ev.name, occurredOn: ev.date, official: ev.official, sourceUrl: dashboardEventUrl(game, ev.id) })
        .onConflictDoUpdate({
          target: metaEvents.id,
          set: { name: sql`excluded.name`, occurredOn: sql`excluded.occurred_on`, official: sql`excluded.official`, fetchedAt: sql`now()` },
        });
      events++;

      for (const p of ev.placements) {
        const already = await db.query.metaResults.findFirst({
          where: and(eq(metaResults.eventId, ev.id), eq(metaResults.deckSourceId, p.deckId)),
          columns: { id: true },
        });
        if (already) continue;

        const leader = leaders.get(p.leaderId);
        const leaderNumberRaw = leader?.cardNumber ?? p.leaderId;
        const [leaderCardId] = leader ? [...(await resolveCardIds(db, [leader.cardNumber])).values()] : [];

        const [result] = await db
          .insert(metaResults)
          .values({
            eventId: ev.id,
            placement: p.placement,
            leaderCardId: leaderCardId ?? null,
            leaderNumberRaw,
            deckSourceId: p.deckId,
            sourceUrl: dashboardDeckUrl(game, p.deckId),
          })
          .returning({ id: metaResults.id });
        newResults++;

        const deckCards = await fetchDeckCards(game, p.deckId);
        const resolved = await resolveCardIds(db, [...new Set(deckCards.map((c) => c.cardNumber))]);
        for (const dc of deckCards) {
          const cardId = resolved.get(dc.cardNumber) ?? null;
          if (cardId) cardsMatched++;
          else cardsUnmatched++;
          await db
            .insert(metaResultCards)
            .values({ resultId: result.id, cardId, cardNumberRaw: dc.cardNumber, zone: dc.zone, quantity: dc.quantity })
            .onConflictDoNothing();
        }
      }
    }
  }

  return { events, newResults, cardsMatched, cardsUnmatched };
}
