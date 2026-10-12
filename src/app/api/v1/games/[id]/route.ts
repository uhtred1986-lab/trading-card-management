import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { canOpenGame } from "@/lib/auth/ownership";
import { arenaGames } from "@/db/schema";
import { fail, ok, pollParams, seatFor } from "@/lib/arena/api";
import { isVersus, loadArchivedGame, loadGame, seatOf } from "@/lib/arena/games";
import { snapshotOfGame, waitForBeats, waitForRevisionResult } from "@/lib/arena/session";
import { archivedSnapshotFor } from "@/lib/arena/snapshot";
import { currentUser, routeViewer } from "@/lib/auth";

export const dynamic = "force-dynamic";
/** A long-poll holds the function for its whole wait; `pollParams` caps it at 30 s. */
export const maxDuration = 60;

/**
 * The board.
 *
 * With `?sinceRevision=R&sinceBeat=N&wait=S` this blocks until the authoritative
 * row changes, even if it produced no animation beat. `sinceBeat` still decides
 * whether the returned snapshot carries a new animation queue.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail("bad_request", "game id must be a number");
  // A player opens only their own games; a game they may not open does not exist for them.
  if (!(await canOpenGame(auth.viewer, id))) return fail("not_found", `no game ${id}`);

  const { sinceBeat, sinceRevision, waitMs } = pollParams(new URL(req.url));

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
      let revisionWait: Awaited<ReturnType<typeof waitForRevisionResult>> | null = null;
      if (sinceRevision == null) await waitForBeats(db, id, sinceBeat, waitMs);
      else revisionWait = await waitForRevisionResult(db, id, sinceRevision, waitMs);
      // Authorization and the versus-seat check above apply before this
      // no-body answer. It avoids loading action history, replay rules,
      // catalog art and a viewer-specific Snapshot when the row is unchanged.
      // The next client long-poll rechecks immediately from the same cursors.
      if (revisionWait?.kind === "missing") return fail("not_found", `no game ${id}`);
      if (revisionWait?.kind === "unchanged") {
        return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
      }
      const game = await loadGame(db, id);
      if (!game) return fail("not_found", `no game ${id}`);
      const snapshot = await snapshotOfGame(db, game, seat);
      // A status-only revision must reach the client, but the old animation
      // queue is not a new story. Beat progress stays on its own cursor.
      const hasNewBeats = (snapshot.beats?.seq ?? 0) > sinceBeat;
      return ok(hasNewBeats ? snapshot : { ...snapshot, beats: null });
    }
  }

  // An archived legacy row (issue #335) is checked before `loadGame` — never
  // through it, so `legalActions` is never reached for one. No long-poll
  // either: nothing further is coming for a board that cannot be continued.
  const archived = await loadArchivedGame(db, id);
  if (archived) {
    const seat = await seatFor(archived);
    if (isVersus(archived.mode) && !seat) return fail("not_found", `no game ${id}`);
    const snapshot = archivedSnapshotFor(archived.store, seat, archived.version);
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
