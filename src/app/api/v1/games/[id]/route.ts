import { db } from "@/db";
import { fail, ok, pollParams } from "@/lib/arena/api";
import { snapshotOf, waitForBeats } from "@/lib/arena/session";

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
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail("bad_request", "game id must be a number");

  const { sinceBeat, waitMs } = pollParams(new URL(req.url));
  if (waitMs > 0) {
    const changed = await waitForBeats(db, id, sinceBeat, waitMs);
    // Nothing new inside the window: answer with the board as it stands and no
    // beats, so the client simply asks again.
    if (changed) return ok(changed);
    const snapshot = await snapshotOf(db, id);
    return snapshot ? ok({ ...snapshot, beats: null }) : fail("not_found", `no game ${id}`);
  }

  const snapshot = await snapshotOf(db, id);
  return snapshot ? ok(snapshot) : fail("not_found", `no game ${id}`);
}
