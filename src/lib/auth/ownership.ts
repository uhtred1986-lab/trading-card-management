import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { arenaGames, decks, deckSwaps, ownedCards, scanBatches, scanItems, scanPhotos } from "@/db/schema";
import { AccessDenied, type Viewer } from "./index";

/**
 * "Is this yours?" for every Server Function that takes an id from the
 * browser. An SL may touch anything; a player only rows stamped with their own
 * owner name. A refusal throws `AccessDenied` — only a tampered call meets one,
 * because a player's pages never show anyone else's ids.
 */

const isSl = (v: Viewer) => v.kind === "sl";

/** Every lot id must be the player's own (archived ones too: restore and purge take them). */
export async function assertOwnLots(viewer: Viewer, lotIds: number[]): Promise<void> {
  if (isSl(viewer)) return;
  const ids = [...new Set(lotIds)];
  if (ids.length === 0) return;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ownedCards)
    .where(and(inArray(ownedCards.id, ids), eq(ownedCards.owner, viewer.owner)));
  if (Number(row?.n ?? 0) !== ids.length) throw new AccessDenied("Those aren't your cards.");
}

/** The deck must be the player's own. A missing deck is let through: the action's own "not found" answers it. */
export async function assertOwnDeck(viewer: Viewer, deckId: number): Promise<void> {
  if (isSl(viewer)) return;
  const [row] = await db.select({ owner: decks.owner }).from(decks).where(eq(decks.id, deckId)).limit(1);
  if (row && row.owner !== viewer.owner) throw new AccessDenied("That isn't your deck.");
}

/** An optional deck id (add-to-deck on the add screens): checked when given. */
export async function assertOwnDeckIf(viewer: Viewer, deckId: number | null | undefined): Promise<void> {
  if (deckId != null) await assertOwnDeck(viewer, deckId);
}

/** A swap suggestion belongs to its deck. */
export async function assertOwnSuggestion(viewer: Viewer, suggestionId: number): Promise<void> {
  if (isSl(viewer)) return;
  const [row] = await db.select({ deckId: deckSwaps.deckId }).from(deckSwaps).where(eq(deckSwaps.id, suggestionId)).limit(1);
  if (row) await assertOwnDeck(viewer, row.deckId);
}

/** A scan batch must be the player's own. */
export async function assertOwnBatch(viewer: Viewer, batchId: number): Promise<void> {
  if (isSl(viewer)) return;
  const [row] = await db.select({ owner: scanBatches.owner }).from(scanBatches).where(eq(scanBatches.id, batchId)).limit(1);
  if (row && row.owner !== viewer.owner) throw new AccessDenied("That isn't your scan.");
}

/** A scanned item belongs to its batch. */
export async function assertOwnScanItem(viewer: Viewer, itemId: number): Promise<void> {
  if (isSl(viewer)) return;
  const [row] = await db.select({ batchId: scanItems.batchId }).from(scanItems).where(eq(scanItems.id, itemId)).limit(1);
  if (row) await assertOwnBatch(viewer, row.batchId);
}

/** A scan photo belongs to its batch (the photo route). */
export async function ownsScanPhoto(viewer: Viewer, photoId: number): Promise<boolean> {
  if (isSl(viewer)) return true;
  const [row] = await db.select({ owner: scanBatches.owner }).from(scanPhotos).innerJoin(scanBatches, eq(scanBatches.id, scanPhotos.batchId)).where(eq(scanPhotos.id, photoId)).limit(1);
  return !!row && row.owner === viewer.owner;
}

/** The owner name a player's new rows always carry; an SL may name anyone (or keep `fallback`). */
export function ownerFor(viewer: Viewer, requested: string | null | undefined, fallback: string | null): string | null {
  if (viewer.kind === "player") return viewer.owner;
  return requested === undefined ? fallback : requested;
}

/**
 * May this viewer open this arena game at all? An SL may open any. A 1 v 1 is
 * let through here: its two seats are checked by `seatOf` wherever it is read
 * or played. Any other game is one person holding both sides, and belongs to
 * whoever owns its first deck — a player opens only their own. A game that
 * does not exist answers `true`, so the caller's own "not found" stands.
 */
export async function canOpenGame(viewer: Viewer, gameId: number): Promise<boolean> {
  if (isSl(viewer)) return true;
  const [row] = await db.select({ mode: arenaGames.mode, deckOwner: decks.owner }).from(arenaGames).leftJoin(decks, eq(decks.id, arenaGames.p1DeckId)).where(eq(arenaGames.id, gameId)).limit(1);
  if (!row) return true;
  if (row.mode === "versus") return true;
  return row.deckOwner === viewer.owner;
}
