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
import type { Zone } from "./queries";

export interface DeckOption {
  id: number;
  name: string;
  isBuilt: boolean;
}

export async function deckOptions(db: Db): Promise<DeckOption[]> {
  return db.select({ id: decks.id, name: decks.name, isBuilt: decks.isBuilt }).from(decks).orderBy(decks.name);
}

export function zoneForType(cardType: string): Zone {
  if (cardType === "LEADER") return "leader";
  if (cardType.startsWith("Z-")) return "z";
  return "main";
}

/** Works inside a transaction too — pass the `tx` as `db`. */
export async function addCardsToDeck(db: Db, deckId: number, entries: { cardId: string; quantity: number }[]): Promise<{ added: number }> {
  const totals = new Map<string, number>();
  for (const e of entries) totals.set(e.cardId, (totals.get(e.cardId) ?? 0) + Math.max(0, Math.floor(e.quantity)));
  const ids = [...totals.keys()].filter((id) => totals.get(id)! > 0);
  if (ids.length === 0) return { added: 0 };

  const meta = await db.select({ id: cards.id, cardType: cards.cardType }).from(cards).where(inArray(cards.id, ids));
  let added = 0;
  for (const m of meta) {
    const zone = zoneForType(m.cardType);
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
