/**
 * The one place a `Snapshot` is built from a saved game.
 *
 * Both clients come through here: the web board's server actions call these
 * functions directly, and `/api/v1` is a thin set of route handlers over the
 * same four. That is where the contract is actually enforced — at the function
 * boundary, not the HTTP one — so no endpoint can quietly grow a rule and the
 * two clients cannot drift apart.
 *
 * The pure half is `snapshot.ts`; this half is the database and Claude.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaGames, cards as cardsTable } from "@/db/schema";
import type { Action } from "./engine";
import { applyToGame, clearBeats, loadGame, type LoadedGame } from "./games";
import { advance, aiPlayerOf } from "./ai/run";
import { buildSnapshot, type Snapshot } from "./snapshot";
import type { CardArt } from "./view";

/** Card art for everything a state mentions. Tokens have none. */
export async function artForGame(db: Db, game: LoadedGame): Promise<Record<string, CardArt>> {
  const ids = [...new Set(Object.values(game.state.cards).map((c) => c.cardId))].filter((x) => !x.startsWith("TOKEN:"));
  if (!ids.length) return {};
  const rows = await db
    .select({ id: cardsTable.id, imageUrl: cardsTable.imageUrl, backImageUrl: cardsTable.backImageUrl })
    .from(cardsTable)
    .where(inArray(cardsTable.id, ids));
  const images: Record<string, CardArt> = {};
  for (const r of rows) images[r.id] = { front: r.imageUrl, back: r.backImageUrl };
  return images;
}

/**
 * For a caller that already holds the game — the board page also wants the
 * damage figures and the post-game review, which are not the board.
 */
export async function snapshotOfGame(db: Db, game: LoadedGame): Promise<Snapshot> {
  return buildSnapshot({ ...game, ai: aiPlayerOf(game), images: await artForGame(db, game) });
}

/** The board as it stands. Null when there is no such game. */
export async function snapshotOf(db: Db, gameId: number): Promise<Snapshot | null> {
  const game = await loadGame(db, gameId);
  return game ? snapshotOfGame(db, game) : null;
}

/**
 * Apply one move and return the board it produced — **without** waiting for
 * Claude. The opponent's turn is `advanceSession`, on its own request, so a
 * client can start animating your own move immediately.
 */
export async function applyAction(db: Db, gameId: number, action: Action): Promise<Snapshot> {
  await clearBeats(db, gameId);
  const game = await applyToGame(db, gameId, action);
  return snapshotOfGame(db, game);
}

/** Take every decision that is not yours — Claude's moves, and any ruling. */
export async function advanceSession(db: Db, gameId: number): Promise<{ snapshot: Snapshot | null; error: string | null }> {
  const ran = await advance(db, gameId);
  return { snapshot: await snapshotOf(db, gameId), error: ran.error };
}

/**
 * Long-poll: return as soon as the queue has climbed past `sinceBeat`, or null
 * once `timeoutMs` has passed with nothing new.
 *
 * `advance` writes each `applyToGame` to the row as it goes, so polling the row
 * is how Claude's charge, plays and attack arrive *as they are decided* rather
 * than as one jump at the end of a minute of thinking.
 */
export async function waitForBeats(db: Db, gameId: number, sinceBeat: number, timeoutMs = 25_000): Promise<Snapshot | null> {
  const deadline = Date.now() + timeoutMs;
  const interval = 400;
  for (;;) {
    const [row] = await db.select({ beats: arenaGames.beats }).from(arenaGames).where(eq(arenaGames.id, gameId)).limit(1);
    if (!row) return null;
    const seq = (row.beats as { seq?: number } | null)?.seq ?? 0;
    if (seq > sinceBeat) return snapshotOf(db, gameId);
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, Math.min(interval, Math.max(0, deadline - Date.now()))));
  }
}
