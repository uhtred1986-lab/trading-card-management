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
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaGames } from "@/db/schema";
import type { Action, PlayerId } from "./types";
import { applyToGame, loadArchivedGame, loadGame, type LoadedGame } from "./games";
import { advance, aiPlayerOf } from "./ai/run";
import { longPollStepMs } from "./poll-schedule";
import { archivedSnapshotFor, buildSnapshot, type Snapshot } from "./snapshot";
import type { CardArt } from "./view";

/**
 * Card art for everything a state mentions. Tokens have none.
 *
 * Read by `loadGame` in the query that reads the cards' definitions, so this
 * is no second trip; it stays a function, and async, so a caller need not
 * know where the art comes from.
 */
export async function artForGame(_db: Db, game: LoadedGame): Promise<Record<string, CardArt>> {
  return game.art;
}

/**
 * For a caller that already holds the game — the board page also wants the
 * damage figures and the post-game review, which are not the board.
 *
 * `viewer` is whose eyes to draw it for. A 1 v 1 passes the asking login's
 * seat, because the same game is drawn twice and each device must stay in its
 * own chair; everything else leaves it off and `viewerFor` derives one exactly
 * as it always has.
 */
export async function snapshotOfGame(db: Db, game: LoadedGame, viewer: PlayerId | null = null): Promise<Snapshot> {
  return buildSnapshot({ ...game, ai: aiPlayerOf(game), viewer, images: await artForGame(db, game) });
}

/**
 * The board as it stands. Null when there is no such game.
 *
 * Checked archived first, and never through `loadGame` for one: an archived
 * row (issue #335) answers from its stored snapshot alone, chosen by
 * `viewer` exactly as a live 1 v 1 chooses a seat (`null` everywhere else) —
 * `legalActions`/`apply` are never reached for it, because `loadGame` is
 * never called for it.
 */
export async function snapshotOf(db: Db, gameId: number, viewer: PlayerId | null = null): Promise<Snapshot | null> {
  const archived = await loadArchivedGame(db, gameId);
  if (archived) return archivedSnapshotFor(archived.store, viewer);
  const game = await loadGame(db, gameId);
  return game ? snapshotOfGame(db, game, viewer) : null;
}

/**
 * Apply one move and return the board it produced — **without** waiting for
 * Claude. The opponent's turn is `advanceSession`, on its own request, so a
 * client can start animating your own move immediately.
 */
export async function applyAction(db: Db, gameId: number, action: Action, viewer: PlayerId | null = null, loaded?: LoadedGame): Promise<Snapshot> {
  // `clearBeats`: your move starts a new story (`clearBeatsForTurn`), emptied
  // in the same write as the move. `loaded` is the game the caller has just
  // read to check the move against; the write is guarded by its version.
  const game = await applyToGame(db, gameId, action, undefined, { game: loaded, clearBeats: true });
  return snapshotOfGame(db, game, viewer);
}

/** Take every decision that is not yours — Claude's moves, and any ruling. */
export async function advanceSession(db: Db, gameId: number, viewer: PlayerId | null = null): Promise<{ snapshot: Snapshot | null; error: string | null }> {
  const ran = await advance(db, gameId);
  return { snapshot: await snapshotOf(db, gameId, viewer), error: ran.error };
}

/**
 * The sequence number the stored beats have reached, read on its own.
 *
 * `arena_games.beats` is a jsonb object `{ seq, list, art }` (`beats.ts`,
 * `EMPTY_BEATS`), or null before anything has happened; `->>` pulls just the
 * counter out so the poll never ships the (possibly large) `list`/`art`.
 * Null when there is no such row.
 */
async function beatSeq(db: Db, gameId: number): Promise<number | null> {
  const [row] = await db
    .select({ seq: sql<string | null>`${arenaGames.beats}->>'seq'` })
    .from(arenaGames)
    .where(eq(arenaGames.id, gameId))
    .limit(1);
  if (!row) return null;
  const n = Number(row.seq ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Long-poll: resolves true as soon as the queue has climbed past `sinceBeat`,
 * false once `timeoutMs` has passed with nothing new (or the row is gone).
 * The caller loads the game once afterwards, whichever way it ended.
 *
 * `advance` writes each `applyToGame` to the row as it goes, so polling the row
 * is how Claude's charge, plays and attack arrive *as they are decided* rather
 * than as one jump at the end of a minute of thinking. Each look reads only the
 * counter, every 400 ms at first and then backing off (`poll-schedule.ts`,
 * issue #377).
 */
export async function waitForBeats(db: Db, gameId: number, sinceBeat: number, timeoutMs = 25_000): Promise<boolean> {
  const started = Date.now();
  for (;;) {
    const seq = await beatSeq(db, gameId);
    if (seq === null) return false;
    if (seq > sinceBeat) return true;
    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) return false;
    await new Promise((r) => setTimeout(r, Math.min(longPollStepMs(elapsed), timeoutMs - elapsed)));
  }
}
