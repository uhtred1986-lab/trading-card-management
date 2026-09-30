import { notFound } from "next/navigation";
import { db } from "@/db";
import { ReviewScreen, type ReviewScreenData } from "@/components/arena/ReviewScreen";
import { isVersus, seatOf } from "@/lib/arena/games";
import { loadReview } from "@/lib/arena/review-load";
import { gamesWithFlags } from "@/lib/arena/review-store";
import { currentUser, isArenaAdmin } from "@/lib/auth";
import { fixtureData } from "./fixture";

export const dynamic = "force-dynamic";

const int = (v: string | string[] | undefined): number | undefined => {
  const raw = Array.isArray(v) ? v[0] : v;
  if (!raw) return raw === "0" ? 0 : undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

/**
 * Admin match review (issue #351): the turns an admin flagged from the board's
 * drawer, with the board as it stood at the start of each and, for every move,
 * what was legal, what was picked and why. Left: games with flags. Centre: a
 * turn scrubber, the board, the turn's moves. Right: the selected move.
 *
 * Everyone but an admin finds nothing here, before a single row is read.
 * `?fixture=1` (dev only, still admin-gated) draws made-up sample data with no
 * database behind it, the way `/arena/preview` does for the board.
 */
export default async function ArenaReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await isArenaAdmin())) notFound();
  const q = await searchParams;
  const all = q.all === "1";
  const turn = int(q.turn);
  const beat = int(q.beat);

  if (q.fixture === "1" && process.env.NODE_ENV !== "production") {
    return <ReviewScreen data={fixtureData({ turn, beat, all })} />;
  }

  const user = await currentUser();
  // A 1 v 1 is its two seats' business even for an admin (as on the debug page).
  const games = (await gamesWithFlags(db, !all)).filter((g) => !isVersus(g.mode) || seatOf(g, user));
  const wanted = int(q.game);
  const game = games.find((g) => g.id === wanted) ?? games[0] ?? null;
  const loaded = game ? await loadReview(db, game.id, turn) : null;
  const data: ReviewScreenData = {
    games,
    showAll: all,
    game,
    flags: loaded?.flags ?? [],
    review: loaded?.review ?? null,
    why: loaded?.why ?? null,
    decisions: loaded?.decisions ?? [],
    drifted: loaded?.drifted ?? false,
    beat: beat ?? null,
    fixture: false,
  };
  return <ReviewScreen data={data} />;
}
