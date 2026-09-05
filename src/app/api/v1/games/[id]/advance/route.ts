import { db } from "@/db";
import { fail, ok } from "@/lib/arena/api";
import { advanceSession } from "@/lib/arena/session";

export const dynamic = "force-dynamic";
/** A Tournament turn can take Claude most of a minute, sometimes several. */
export const maxDuration = 300;

/**
 * Let the server take every decision that is not yours — Claude's moves, and
 * any card text that has gone to the referee.
 *
 * Long. A client should fire this and watch `GET .../games/{id}?sinceBeat=…`
 * on another connection rather than sit on the response, because `advance`
 * writes each move to the row as it makes it.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail("bad_request", "game id must be a number");

  const { snapshot, error } = await advanceSession(db, id);
  if (!snapshot) return fail("not_found", `no game ${id}`);
  // An AI failure is not a lost game: the board is still valid and still
  // playable, so it comes back with the error beside it rather than instead.
  return ok({ ...snapshot, aiError: error });
}
