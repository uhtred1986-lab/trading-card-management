import { db } from "@/db";
import { fail, newGameSchema, ok, readJson } from "@/lib/arena/api";
import { listGames, startGame } from "@/lib/arena/games";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 20);
  return ok({ games: await listGames(db, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20) });
}

export async function POST(req: Request) {
  const parsed = newGameSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("bad_request", "expected { p1DeckId, p2DeckId, mode?, debug? }");
  const { p1DeckId, p2DeckId, mode, debug } = parsed.data;
  try {
    return ok({ id: await startGame(db, p1DeckId, p2DeckId, mode, debug) });
  } catch (err) {
    // `startGame` refuses a deck with no leader, or a Fusion World deck: the
    // arena's rules engine only plays the original game.
    return fail("bad_request", err instanceof Error ? err.message : "could not start that game");
  }
}
