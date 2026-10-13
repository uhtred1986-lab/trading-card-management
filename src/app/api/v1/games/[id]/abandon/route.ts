import { NextResponse } from "next/server";
import { db } from "@/db";
import { canOpenGame } from "@/lib/auth/ownership";
import { abandonSchema, fail, ok, readJson, retiredGame, seatFor } from "@/lib/arena/api";
import { abandonGame, GameAlreadyFinished, isVersus, loadGame, mutationFingerprint, RequestIdentityConflict, StaleGame } from "@/lib/arena/games";
import { snapshotOfGame } from "@/lib/arena/session";
import { routeViewer } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Give up. The game stays readable; it just stops being playable. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail("bad_request", "game id must be a number");
  // A player opens only their own games; a game they may not open does not exist for them.
  if (!(await canOpenGame(auth.viewer, id))) return fail("not_found", `no game ${id}`);
  const game = await loadGame(db, id).catch(retiredGame);
  if (game instanceof NextResponse) return game;
  if (!game) return fail("not_found", `no game ${id}`);
  // Either seat may give up, and it ends the game for both.
  const seat = await seatFor(game);
  if (isVersus(game.mode) && !seat) return fail("not_found", `no game ${id}`);
  const body = abandonSchema.safeParse(await readJson(req));
  if (!body.success) return fail("contract_mismatch", "send { basedOn, requestId } from the current snapshot");
  try {
    const updated = await abandonGame(db, id, body.data.basedOn, {
      actor: auth.viewer.login,
      requestId: body.data.requestId,
      fingerprint: mutationFingerprint({ basedOn: body.data.basedOn, type: "abandon" }),
    });
    return ok(await snapshotOfGame(db, updated, seat));
  } catch (err) {
    if (err instanceof StaleGame) return fail("stale", err.message);
    if (err instanceof GameAlreadyFinished) return fail("game_over", err.message);
    if (err instanceof RequestIdentityConflict) return fail("idempotency_conflict", err.message);
    throw err;
  }
}
