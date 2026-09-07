import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { ArenaStage } from "@/components/arena/stage/ArenaStage";
import { hasAnthropic } from "@/lib/ai/client";
import { GameOver } from "@/components/arena/GameOver";
import type { GameReview } from "@/lib/arena/ai/review";
import { isVersus, loadGame, modeLabel, seatOf } from "@/lib/arena/games";
import { currentUser } from "@/lib/auth";
import { snapshotOfGame } from "@/lib/arena/session";
import { SKIN_COOKIE, skinFrom } from "@/lib/arena/skin";
import { STAGING_COOKIE, stagingFrom } from "@/lib/arena/staging";
import { SubmitButton } from "@/components/SubmitButton";
import { abandon } from "../actions";

export const dynamic = "force-dynamic";
/** A Tournament turn can take Claude a while to think through. */
export const maxDuration = 300;

export default async function ArenaGamePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ skin?: string; staging?: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();
  const game = await loadGame(db, id);
  if (!game) notFound();

  // A 1 v 1 belongs to its two seats and to nobody else, over as well as
  // playing (owner's decision, 7 Sep 2026). Not found rather than forbidden:
  // there is nothing useful to say to someone who is not in the game, and a
  // 403 would confirm it exists.
  const seat = seatOf(game, await currentUser());
  if (isVersus(game.mode) && !seat) notFound();

  // Everything the board is drawn from — art, view, taps, whose turn it is —
  // comes from the one snapshot builder both clients share, so this page and
  // the Android app can never disagree about what the position is. The seat is
  // what keeps each device in its own chair; every other mode passes null and
  // the viewer is derived exactly as it always was.
  const snap = await snapshotOfGame(db, game, isVersus(game.mode) ? seat : null);
  const playing = snap.game.status === "playing";
  // Which skin. The query wins for one page load (`?skin=anime`), the cookie
  // is the setting; read here so the markup the server sends is already the
  // right colour and nothing flashes.
  const asked = await searchParams;
  const jar = await cookies();
  const skin = skinFrom(asked.skin ?? jar.get(SKIN_COOKIE)?.value);
  // How a battle is staged, the same way: `?staging=takeover` pins one board
  // for one load, which is what a screenshot needs.
  const staging = stagingFrom(asked.staging ?? jar.get(STAGING_COOKIE)?.value);
  const review = game.review ? (JSON.parse(game.review) as GameReview) : null;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href="/arena" className="text-sm text-space-300 hover:text-ki-300">
          ← Arena
        </Link>
        <span className="text-sm font-medium text-space-100 sm:text-base">
          {game.p1Name} <span className="text-space-500">vs</span> {game.p2Name}
        </span>
        {game.p1User && game.p2User && (
          <span className="text-xs text-space-400">
            {game.p1User} v {game.p2User}
          </span>
        )}
        <span className="rounded-full border border-space-700 px-2 py-0.5 text-[11px] uppercase tracking-wider text-space-400">
          {modeLabel(game.mode)}
        </span>
        <Link href={`/arena/${id}/debug`} className="ml-auto text-sm text-space-400 hover:text-ki-300">
          {isVersus(game.mode) ? "what the server decided" : "how Claude played"}
        </Link>
        {playing && (
          <form action={abandon.bind(null, id)}>
            <SubmitButton pendingLabel="Giving up…" className="tap text-sm text-space-400 hover:text-loss">give up</SubmitButton>
          </form>
        )}
      </div>

      {game.status === "over" && (
        <GameOver
          gameId={id}
          winnerName={game.state.winner ? game.state.players[game.state.winner].name : null}
          draw={!game.state.winner}
          reason={game.state.overReason ?? ""}
          turns={game.state.turn}
          damage={{ you: game.state.players[snap.game.you].damageTaken, them: game.state.players[snap.game.you === "p1" ? "p2" : "p1"].damageTaken }}
          spend={game.spend}
          review={review}
          aiEnabled={hasAnthropic()}
        />
      )}

      {/* The whole snapshot, because the board keeps watching the game while
          the server is deciding and replaces it with what it reads. */}
      <ArenaStage gameId={id} snapshot={snap} skin={skin} staging={staging} />
    </div>
  );
}
