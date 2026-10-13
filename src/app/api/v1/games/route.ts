import { db } from "@/db";
import { assertOwnDeck } from "@/lib/auth/ownership";
import { fail, newGameSchema, ok, readJson } from "@/lib/arena/api";
import { DEFAULT_ENGINE } from "@/lib/arena/engine-ids";
import { listGames, startGame } from "@/lib/arena/games";
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
  const { p1DeckId, p2DeckId, mode, debug } = parsed.data;
  // A player plays their own decks only; one that isn't theirs does not exist for them.
  try {
    await assertOwnDeck(auth.viewer, p1DeckId);
    await assertOwnDeck(auth.viewer, p2DeckId);
  } catch {
    return fail("not_found", "no such deck");
  }
  try {
    const id = await startGame(db, p1DeckId, p2DeckId, mode, debug);
    // `engine` comes back so a client knows what it got: the rules engine is the only one (#118).
    return ok({ id, engine: DEFAULT_ENGINE });
  } catch (err) {
    // `startGame` refuses a deck with no leader or a Fusion World deck (the
    // arena only plays the original game).
    return fail("bad_request", err instanceof Error ? err.message : "could not start that game");
  }
}
