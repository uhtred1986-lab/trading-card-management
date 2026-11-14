/**
 * A deck's format (Pokémon: Standard or Expanded). The data effect of `setDeckFormatAction`, kept
 * apart from the Server Function so the database test can run it; the action checks who is asking.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { decks } from "@/db/schema";
import { deckRules } from "@/lib/catalog/games";

export type SetFormatResult = { ok: true; format: string } | { ok: false; error: string };

/** Stores `format` on the deck when its game has that format; anything else changes nothing. */
export async function setDeckFormat(db: Db, deckId: number, format: string): Promise<SetFormatResult> {
  const deck = await db.query.decks.findFirst({ where: eq(decks.id, deckId), columns: { game: true } });
  if (!deck) return { ok: false, error: "Deck not found." };
  const formats = deckRules(deck.game).formats;
  if (!formats.includes(format)) return { ok: false, error: formats.length ? `Unknown format. Choose one of: ${formats.join(", ")}.` : "This game has no formats." };
  await db.update(decks).set({ format, updatedAt: new Date() }).where(eq(decks.id, deckId));
  return { ok: true, format };
}
