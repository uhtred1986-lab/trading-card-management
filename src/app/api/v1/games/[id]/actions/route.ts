import { NextResponse } from "next/server";
import { db } from "@/db";
import { canOpenGame } from "@/lib/auth/ownership";
import { chooseSchema, fail, ok, readJson, retiredGame, seatFor } from "@/lib/arena/api";
import { IllegalAction } from "@/lib/arena/vm/common";
import { GameAlreadyFinished, isVersus, loadGame, mutationFingerprint, replayMutation, RequestIdentityConflict, StaleGame } from "@/lib/arena/games";
import { applyAction, snapshotOfGame } from "@/lib/arena/session";
import { routeViewer } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Take one move, by its index in the `legal` array of the snapshot you hold.
 *
 * This returns as soon as **your** move has been applied. Claude's reply is a
 * separate request (`POST .../advance`), so a client can start animating what
 * it just did instead of waiting out the opponent's whole turn.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail("bad_request", "game id must be a number");
  // A player opens only their own games; a game they may not open does not exist for them.
  if (!(await canOpenGame(auth.viewer, id))) return fail("not_found", `no game ${id}`);

  const body = await readJson(req);
  const parsed = chooseSchema.safeParse(body);
  if (!parsed.success) {
    if (body && typeof body === "object" && "index" in body && (!("basedOn" in body) || !("requestId" in body))) {
      return fail("contract_mismatch", "update the client to send the snapshot revision and a requestId");
    }
    return fail("bad_request", "expected { index, basedOn, requestId }");
  }
  const { index, basedOn, requestId } = parsed.data;

  const game = await loadGame(db, id).catch(retiredGame);
  if (game instanceof NextResponse) return game;
  if (!game) return fail("not_found", `no game ${id}`);
  const seat = await seatFor(game);
  if (isVersus(game.mode) && !seat) return fail("not_found", `no game ${id}`);

  const identity = {
    actor: auth.viewer.login,
    requestId,
    // Index is interpreted against this immutable revision. A retry therefore
    // keeps the same intent even after legal actions have changed.
    fingerprint: mutationFingerprint({ index, basedOn }),
  };
  try {
    const replay = replayMutation(game, identity);
    if (replay) return ok(await snapshotOfGame(db, replay, seat));
  } catch (err) {
    if (err instanceof RequestIdentityConflict) return fail("idempotency_conflict", err.message);
    throw err;
  }

  if (game.status !== "playing") return fail("game_over", "this game is over");

  // The engine judges the move; only this judges the mover. `legal` holds both
  // players' moves whenever the prompt has changed hands, so without it either
  // device could take the other's turn by index.
  const asked = "player" in game.state.prompt ? game.state.prompt.player : null;
  if (seat && asked && asked !== seat) return fail("not_your_turn", "it is not your turn");

  // The game moved on since the client drew that board, so `index` now points
  // at a different move. Refuse rather than guess: the client re-reads and the
  // player taps again, which is the only honest answer to a stale tap.
  if (game.version !== basedOn) {
    return fail("stale", "the board has moved on — read it again");
  }

  const chosen = game.legal[index];
  if (!chosen) return fail("illegal_action", `there is no move ${index}; the board offers ${game.legal.length}`);

  try {
    return ok(await applyAction(db, id, chosen.action, seat, game, { expectedRevision: basedOn, identity }));
  } catch (err) {
    if (err instanceof IllegalAction) return fail("illegal_action", err.message);
    if (err instanceof GameAlreadyFinished) return fail("game_over", err.message);
    if (err instanceof RequestIdentityConflict) return fail("idempotency_conflict", err.message);
    // The row changed between the read above and the write. Same answer as a
    // failed `basedOn`, reached the only other way it can be.
    if (err instanceof StaleGame) return fail("stale", err.message);
    throw err;
  }
}

/** The board, so a client can re-read it after a `stale` refusal. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail("bad_request", "game id must be a number");
  // A player opens only their own games; a game they may not open does not exist for them.
  if (!(await canOpenGame(auth.viewer, id))) return fail("not_found", `no game ${id}`);
  const game = await loadGame(db, id).catch(retiredGame);
  if (game instanceof NextResponse) return game;
  if (!game) return fail("not_found", `no game ${id}`);
  const seat = await seatFor(game);
  if (isVersus(game.mode) && !seat) return fail("not_found", `no game ${id}`);
  const snapshot = await snapshotOfGame(db, game, seat);
  return ok({ legal: snapshot.legal, basedOn: snapshot.game.revision });
}
