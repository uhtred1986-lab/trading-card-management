/**
 * Pulls regional results from deckplanet.net (src/lib/meta/deckplanet-results.ts)
 * into meta_events/meta_results/meta_result_cards. Idempotent per (event, deck):
 * a placement already stored is skipped rather than re-fetching its deck page,
 * so a daily run only does work for genuinely new results.
 */
import { eq, inArray, sql } from "drizzle-orm";
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

      // One select for what the event already holds, then one insert for the rest.
      const existing = new Set(
        (await db.select({ d: metaResults.deckSourceId }).from(metaResults).where(eq(metaResults.eventId, ev.id))).map((r) => r.d),
      );
      const fresh = ev.placements.filter((p) => !existing.has(p.deckId) && existing.add(p.deckId));
      if (fresh.length === 0) continue;

      const leaderNumbers = [...new Set(fresh.flatMap((p) => (leaders.get(p.leaderId) ? [leaders.get(p.leaderId)!.cardNumber] : [])))];
      const leaderIds = await resolveCardIds(db, leaderNumbers);
      const inserted = await db
        .insert(metaResults)
        .values(
          fresh.map((p) => {
            const leader = leaders.get(p.leaderId);
            return {
              eventId: ev.id,
              placement: p.placement,
              leaderCardId: (leader && leaderIds.get(leader.cardNumber)) ?? null,
              leaderNumberRaw: leader?.cardNumber ?? p.leaderId,
              deckSourceId: p.deckId,
              sourceUrl: dashboardDeckUrl(game, p.deckId),
            };
          }),
        )
        .onConflictDoNothing()
        .returning({ id: metaResults.id, deckSourceId: metaResults.deckSourceId });
      newResults += inserted.length;

      for (const result of inserted) {
        const deckCards = await fetchDeckCards(game, result.deckSourceId);
        const resolved = await resolveCardIds(db, [...new Set(deckCards.map((c) => c.cardNumber))]);
        for (const dc of deckCards) {
          if (resolved.get(dc.cardNumber)) cardsMatched++;
          else cardsUnmatched++;
        }
        if (deckCards.length > 0) {
          await db
            .insert(metaResultCards)
            .values(deckCards.map((dc) => ({ resultId: result.id, cardId: resolved.get(dc.cardNumber) ?? null, cardNumberRaw: dc.cardNumber, zone: dc.zone, quantity: dc.quantity })))
            .onConflictDoNothing();
        }
      }
    }
  }

  return { events, newResults, cardsMatched, cardsUnmatched };
}
