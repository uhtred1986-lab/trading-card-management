import { db } from "@/db";
import { assertOwnDeck } from "@/lib/auth/ownership";
import { fail, newGameSchema, ok, readJson } from "@/lib/arena/api";
import { defaultEngine } from "@/lib/arena/engine-setting";
import { engineForMode, listGames, startGame } from "@/lib/arena/games";
import { currentUser, routeViewer } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 20);
  // A 1 v 1 is listed only to the two people in it, same as on the web.
  const owner = auth.viewer.kind === "player" ? auth.viewer.owner : undefined;
  return ok({ games: await listGames(db, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20, await currentUser(), owner) });
}

export async function POST(req: Request) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  const parsed = newGameSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("bad_request", "expected { p1DeckId, p2DeckId, mode?, debug?, engine? }");
  const { p1DeckId, p2DeckId, mode, debug, engine } = parsed.data;
  // Which engine this game is made on, in the two cases the body allows:
  //
  // - `engine` named → that one, and `startGame` refuses it if this mode is not
  //   built on it. A client that asked for an engine is told no, not quietly
  //   given the other one.
  // - `engine` absent → the `arena.engine` setting, which since #166 defaults
  //   to the rules engine, resolved against the mode. A mode the rules engine
  //   is not built for lands on the legacy one and `engineNote` says why, so
  //   the default path never fails for a reason the client did not choose.
  //
  // `engine` comes back either way: a client that left it out still needs to
  // know what it got, since the game keeps it for good.
  const resolved = engine ? { engine, note: null } : engineForMode(await defaultEngine(db), mode);
  // A player plays their own decks only; one that isn't theirs does not exist for them.
  try {
    await assertOwnDeck(auth.viewer, p1DeckId);
    await assertOwnDeck(auth.viewer, p2DeckId);
  } catch {
    return fail("not_found", "no such deck");
  }
  try {
    const id = await startGame(db, p1DeckId, p2DeckId, mode, debug, undefined, resolved.engine);
    return ok({ id, engine: resolved.engine, ...(resolved.note ? { engineNote: resolved.note } : {}) });
  } catch (err) {
    // `startGame` refuses a deck with no leader, a Fusion World deck (the
    // arena only plays the original game), an engine that is not built yet and
    // an engine the client named that this mode is not built on.
    return fail("bad_request", err instanceof Error ? err.message : "could not start that game");
  }
}
