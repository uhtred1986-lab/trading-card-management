import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { canOpenGame } from "@/lib/auth/ownership";
import { arenaGames } from "@/db/schema";
import { fail, ok, pollParams, seatFor } from "@/lib/arena/api";
import { isVersus, loadArchivedGame, loadGame, seatOf } from "@/lib/arena/games";
import { snapshotOfGame, waitForBeats } from "@/lib/arena/session";
import { archivedSnapshotFor } from "@/lib/arena/snapshot";
import { currentUser, routeViewer } from "@/lib/auth";

export const dynamic = "force-dynamic";
/** A long-poll holds the function for its whole wait; `pollParams` caps it at 30 s. */
export const maxDuration = 60;

/**
 * The board.
 *
 * With `?sinceBeat=N&wait=S` this blocks until the animation queue has climbed
 * past `N`, or `S` seconds pass with nothing new — which is how a client sees
 * Claude's charge, plays and attack *as they are decided* rather than as one
 * jump at the end of a minute of thinking. Without them it answers at once.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail("bad_request", "game id must be a number");
  // A player opens only their own games; a game they may not open does not exist for them.
  if (!(await canOpenGame(auth.viewer, id))) return fail("not_found", `no game ${id}`);

  const { sinceBeat, waitMs } = pollParams(new URL(req.url));

  // A long-poll decides seat and mode from the few columns that say so, and
  // loads the whole game once, after the wait (issue #377). Loading it first
  // meant a full row, rules and card art for a request that mostly ends in
  // "nothing yet". An archived row falls through to the answer-at-once path.
  if (waitMs > 0) {
    const [head] = await db
      .select({
        mode: arenaGames.mode,
        p1User: arenaGames.p1User,
        p2User: arenaGames.p2User,
        archived: sql<boolean>`${arenaGames.snapshot} is not null`,
      })
      .from(arenaGames)
      .where(eq(arenaGames.id, id))
      .limit(1);
    if (!head) return fail("not_found", `no game ${id}`);
    if (!head.archived) {
      const versus = isVersus(head.mode);
      const seat = versus ? seatOf(head, await currentUser()) : null;
      if (versus && !seat) return fail("not_found", `no game ${id}`);
      const moved = await waitForBeats(db, id, sinceBeat, waitMs);
      const game = await loadGame(db, id);
      if (!game) return fail("not_found", `no game ${id}`);
      const snapshot = await snapshotOfGame(db, game, seat);
      // Nothing new inside the window: answer with the board as it stands and
      // no beats, so the client simply asks again.
      return ok(moved ? snapshot : { ...snapshot, beats: null });
    }
  }

  // An archived legacy row (issue #335) is checked before `loadGame` — never
  // through it, so `legalActions` is never reached for one. No long-poll
  // either: nothing further is coming for a board that cannot be continued.
  const archived = await loadArchivedGame(db, id);
  if (archived) {
    const seat = await seatFor(archived);
    if (isVersus(archived.mode) && !seat) return fail("not_found", `no game ${id}`);
    const snapshot = archivedSnapshotFor(archived.store, seat);
    return snapshot ? ok(snapshot) : fail("not_found", `no game ${id}`);
  }

  // The chair this login sits in. In a 1 v 1 the two devices poll the same
  // game and must be answered differently — same board, two sets of eyes.
  const game = await loadGame(db, id);
  if (!game) return fail("not_found", `no game ${id}`);
  const seat = await seatFor(game);
  if (isVersus(game.mode) && !seat) return fail("not_found", `no game ${id}`);

  return ok(await snapshotOfGame(db, game, seat));
}
