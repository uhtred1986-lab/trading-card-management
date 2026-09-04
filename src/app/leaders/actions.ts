"use server";

import { revalidatePath } from "next/cache";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { ownedCards } from "@/db/schema";
import { quickSearch } from "@/lib/catalog/queries";
import { gameOr, type Game } from "@/lib/catalog/games";
import { describeAiError, hasAnthropic } from "@/lib/ai/client";
import { suggestDeck } from "@/lib/ai/deck-builder";

export type BuildDeckResponse = { ok: true; deckId: number; mainCount: number; toBuy: number } | { ok: false; error: string };

export interface LeaderChoice {
  id: string;
  name: string;
  setCode: string;
  /** The draft — and the deck it creates — follows the leader's game. */
  game: Game;
  colors: string[];
  imageUrl: string | null;
  /** Copies in the collection — 0 is fine, the draft just leans on buyable cards. */
  owned: number;
}

/**
 * Leaders matching a search, for starting a deck from the decks page. Any
 * leader in the catalog, not only owned ones: a deck you are about to build
 * towards is exactly the case where you don't have the leader yet. Both games
 * are searched, and picking one settles which rules the draft is built to.
 */
export async function searchLeadersAction(q: string): Promise<LeaderChoice[]> {
  if (q.trim().length < 2) return [];
  const leaders = await quickSearch(db, q, 12, "LEADER");
  if (leaders.length === 0) return [];
  const counts = await db
    .select({ cardId: ownedCards.cardId, n: sql<number>`count(*)::int` })
    .from(ownedCards)
    .where(inArray(ownedCards.cardId, leaders.map((l) => l.id)))
    .groupBy(ownedCards.cardId);
  const owned = new Map(counts.map((c) => [c.cardId, c.n]));
  return leaders.map((l) => ({ id: l.id, name: l.name, setCode: l.setCode, game: gameOr(l.game), colors: l.colors, imageUrl: l.imageUrl, owned: owned.get(l.id) ?? 0 }));
}

export async function buildDeckAction(leaderId: string): Promise<BuildDeckResponse> {
  if (!hasAnthropic()) return { ok: false, error: "ANTHROPIC_API_KEY is not set." };
  try {
    const { deckId, sanitised } = await suggestDeck(db, leaderId);
    revalidatePath("/leaders");
    revalidatePath("/decks");
    return { ok: true, deckId, mainCount: sanitised.mainCount, toBuy: [...sanitised.main, ...sanitised.z].reduce((n, c) => n + c.needToBuy, 0) };
  } catch (err) {
    return { ok: false, error: describeAiError(err) };
  }
}
