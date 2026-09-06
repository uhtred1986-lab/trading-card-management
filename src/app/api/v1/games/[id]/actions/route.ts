import { db } from "@/db";
import { chooseSchema, fail, ok, readJson } from "@/lib/arena/api";
import { IllegalAction } from "@/lib/arena/engine";
import { loadGame } from "@/lib/arena/games";
import { applyAction, snapshotOfGame } from "@/lib/arena/session";

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
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail("bad_request", "game id must be a number");

  const parsed = chooseSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("bad_request", "expected { index, basedOn? }");
  const { index, basedOn } = parsed.data;

  const game = await loadGame(db, id);
  if (!game) return fail("not_found", `no game ${id}`);
  if (game.status !== "playing") return fail("game_over", "this game is over");

  // The game moved on since the client drew that board, so `index` now points
  // at a different move. Refuse rather than guess: the client re-reads and the
  // player taps again, which is the only honest answer to a stale tap.
  if (basedOn != null && (game.beats?.seq ?? 0) !== basedOn) {
    return fail("stale", "the board has moved on — read it again");
  }

  const chosen = game.legal[index];
  if (!chosen) return fail("illegal_action", `there is no move ${index}; the board offers ${game.legal.length}`);

  try {
    return ok(await applyAction(db, id, chosen.action));
  } catch (err) {
    if (err instanceof IllegalAction) return fail("illegal_action", err.message);
    throw err;
  }
}

/** The board, so a client can re-read it after a `stale` refusal. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail("bad_request", "game id must be a number");
  const game = await loadGame(db, id);
  if (!game) return fail("not_found", `no game ${id}`);
  const snapshot = await snapshotOfGame(db, game);
  return ok({ legal: snapshot.legal, basedOn: snapshot.beats?.seq ?? 0 });
}
