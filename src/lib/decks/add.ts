/**
 * Add freshly acquired cards to a deck as well as the collection. Leaders take
 * the leader slot, Z- cards go to the Z-deck, everything else to the main deck.
 *
 * Nothing is capped or replaced: adding a fifth copy, or a second leader, is
 * allowed and the deck is flagged illegal afterwards (src/lib/decks/legality.ts).
 * Silently dropping a card the user just scanned would be worse than a flag.
 */
import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cards, deckCards, decks } from "@/db/schema";
import { deckRules, gameOr, type Game } from "@/lib/catalog/games";
import type { Zone } from "./queries";

export interface DeckOption {
  id: number;
  name: string;
  isBuilt: boolean;
  game: Game;
}

export async function deckOptions(db: Db, opts: { game?: Game } = {}): Promise<DeckOption[]> {
  const rows = await db
    .select({ id: decks.id, name: decks.name, isBuilt: decks.isBuilt, game: decks.game })
    .from(decks)
    .where(opts.game ? eq(decks.game, opts.game) : undefined)
    .orderBy(decks.name);
  return rows.map((r) => ({ ...r, game: gameOr(r.game) }));
}

/**
 * Where a card lands when it is added without a zone being chosen. A game with
 * no Z-Deck has nowhere else to put a Z- card, so it goes to the main deck and
 * is flagged there — visible beats vanished.
 */
export function zoneForType(cardType: string, game: Game = "dbs"): Zone {
  if (cardType === "LEADER") return "leader";
  if (cardType.startsWith("Z-") && deckRules(game).zMax > 0) return "z";
  return "main";
}

/** Works inside a transaction too — pass the `tx` as `db`. */
export async function addCardsToDeck(db: Db, deckId: number, entries: { cardId: string; quantity: number }[]): Promise<{ added: number }> {
  const totals = new Map<string, number>();
  for (const e of entries) totals.set(e.cardId, (totals.get(e.cardId) ?? 0) + Math.max(0, Math.floor(e.quantity)));
  const ids = [...totals.keys()].filter((id) => totals.get(id)! > 0);
  if (ids.length === 0) return { added: 0 };

  const deck = await db.query.decks.findFirst({ where: eq(decks.id, deckId), columns: { game: true } });
  const game = gameOr(deck?.game);
  const meta = await db.select({ id: cards.id, cardType: cards.cardType }).from(cards).where(inArray(cards.id, ids));
  let added = 0;
  for (const m of meta) {
    const zone = zoneForType(m.cardType, game);
    const want = totals.get(m.id)!;
    await db
      .insert(deckCards)
      .values({ deckId, cardId: m.id, zone, quantity: want })
      .onConflictDoUpdate({
        target: [deckCards.deckId, deckCards.cardId, deckCards.zone],
        set: { quantity: sql`${deckCards.quantity} + ${want}` },
      });
    added += want;
  }
  await db.update(decks).set({ updatedAt: new Date() }).where(eq(decks.id, deckId));
  return { added };
}
