import { db } from "@/db";
import { canOpenGame } from "@/lib/auth/ownership";
import { fail, ok, seatFor } from "@/lib/arena/api";
import { abandonGame, isVersus, loadGame } from "@/lib/arena/games";
import { snapshotOf } from "@/lib/arena/session";
import { routeViewer } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Give up. The game stays readable; it just stops being playable. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail("bad_request", "game id must be a number");
  // A player opens only their own games; a game they may not open does not exist for them.
  if (!(await canOpenGame(auth.viewer, id))) return fail("not_found", `no game ${id}`);
  const game = await loadGame(db, id);
  if (!game) return fail("not_found", `no game ${id}`);
  // Either seat may give up, and it ends the game for both.
  const seat = await seatFor(game);
  if (isVersus(game.mode) && !seat) return fail("not_found", `no game ${id}`);
  await abandonGame(db, id);
  const snapshot = await snapshotOf(db, id, seat);
  return snapshot ? ok(snapshot) : fail("not_found", `no game ${id}`);
}
