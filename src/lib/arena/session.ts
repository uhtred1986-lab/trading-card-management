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
import { applyToGame, loadGame, type LoadedGame, type MutationIdentity } from "./games";
import { advance, aiPlayerOf } from "./ai/run";
import { longPollStepMs } from "./poll-schedule";
import { buildSnapshot, viewerFor, withSnapshotReading, type Snapshot } from "./snapshot";
import { conceal, hiddenAliases, resolveAliased, type Resolved } from "./conceal";
import type { GameDefinition } from "./rulesets/types";
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
  const images = await artForGame(db, game);
  // The spread reads `game.legal`'s lazy getter. Keep that read, the rejected
  // menu, ability availability and board view in one immutable read session.
  return withSnapshotReading(game, () => buildSnapshot({ ...game, revision: game.version, ai: aiPlayerOf(game), viewer, images }));
}

/**
 * What a client sent back — a whole `Action`, or a plan of them — with the
 * card aliases its board named hidden cards by (`conceal.ts`) turned back into
 * instance ids, for the viewer that board was drawn for. Read against the
 * game as loaded, so the caller must already have refused a `basedOn` that is
 * not `game.version`: an alias means a position on one revision only.
 */
export function resolveForViewer<T>(game: LoadedGame, value: T, seat: PlayerId | null): Resolved<T> {
  const viewer = viewerFor({ ai: aiPlayerOf(game), state: game.state, viewer: seat });
  const pinned = (game.ctx as { rulesetDefinition?: GameDefinition }).rulesetDefinition;
  return resolveAliased(value, game.state, viewer, pinned);
}

/** The other way: anything built from the game for this viewer, its hidden cards named by alias. */
export function concealForViewer<T>(game: LoadedGame, value: T, seat: PlayerId | null): T {
  const viewer = viewerFor({ ai: aiPlayerOf(game), state: game.state, viewer: seat });
  const pinned = (game.ctx as { rulesetDefinition?: GameDefinition }).rulesetDefinition;
  return conceal(value, hiddenAliases(game.state, viewer, pinned));
}

/** The board as it stands. Null when there is no such game. */
export async function snapshotOf(db: Db, gameId: number, viewer: PlayerId | null = null): Promise<Snapshot | null> {
  const game = await loadGame(db, gameId);
  return game ? snapshotOfGame(db, game, viewer) : null;
}

/**
 * Apply one move and return the board it produced — **without** waiting for
 * Claude. The opponent's turn is `advanceSession`, on its own request, so a
 * client can start animating your own move immediately.
 */
export async function applyAction(
  db: Db,
  gameId: number,
  action: Action,
  viewer: PlayerId | null = null,
  loaded?: LoadedGame,
  mutation?: { expectedRevision: number; identity: MutationIdentity },
): Promise<Snapshot> {
  // `clearBeats`: your move starts a new story (`clearBeatsForTurn`), emptied
  // in the same write as the move. `loaded` is the game the caller has just
  // read to check the move against; the write is guarded by its version.
  const game = await applyToGame(db, gameId, action, undefined, {
    game: loaded,
    clearBeats: true,
    expectedRevision: mutation?.expectedRevision,
    request: mutation?.identity,
  });
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

export type RevisionWaitResult =
  | { kind: "changed"; revision: number }
  | { kind: "unchanged"; revision: number }
  | { kind: "missing" };

/**
 * Long-poll authoritative state/status mutations, including writes with no
 * beat. `unchanged` is returned only after observing the requested revision
 * still current at timeout; `changed` also covers a cursor ahead of the row,
 * which the caller must answer with the current full snapshot.
 */
export async function waitForRevisionResult(db: Db, gameId: number, sinceRevision: number, timeoutMs = 25_000): Promise<RevisionWaitResult> {
  const started = Date.now();
  for (;;) {
    const [row] = await db.select({ revision: arenaGames.version }).from(arenaGames).where(eq(arenaGames.id, gameId)).limit(1);
    if (!row) return { kind: "missing" };
    // A cursor behind or ahead of the row needs an authoritative full read.
    // In particular, never tell a client holding a future cursor that the
    // server is unchanged: its local state must be reconciled to this row.
    if (row.revision !== sinceRevision) return { kind: "changed", revision: row.revision };
    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) return { kind: "unchanged", revision: row.revision };
    await new Promise((resolve) => setTimeout(resolve, Math.min(longPollStepMs(elapsed), timeoutMs - elapsed)));
  }
}

/** Backward-compatible boolean form retained for existing wait callers. */
export async function waitForRevision(db: Db, gameId: number, sinceRevision: number, timeoutMs = 25_000): Promise<boolean> {
  const result = await waitForRevisionResult(db, gameId, sinceRevision, timeoutMs);
  return result.kind === "changed" && result.revision > sinceRevision;
}
