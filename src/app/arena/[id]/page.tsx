import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { ArenaStage } from "@/components/arena/stage/ArenaStage";
import { hasAnthropic } from "@/lib/ai/client";
import { ArenaBoard } from "@/components/arena/ArenaBoard";
import { GameOver } from "@/components/arena/GameOver";
import type { GameReview } from "@/lib/arena/ai/review";
import { loadGame } from "@/lib/arena/games";
import { snapshotOfGame } from "@/lib/arena/session";
import { SubmitButton } from "@/components/SubmitButton";
import { abandon, chooseBoard } from "../actions";

export const dynamic = "force-dynamic";
/** A Tournament turn can take Claude a while to think through. */
export const maxDuration = 300;

export default async function ArenaGamePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ board?: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();
  const game = await loadGame(db, id);
  if (!game) notFound();

  // Everything the board is drawn from — art, view, taps, whose turn it is —
  // comes from the one snapshot builder both clients share, so this page and
  // the Android app can never disagree about what the position is.
  const snap = await snapshotOfGame(db, game);
  const playing = snap.game.status === "playing";
  const waitingOnServer = snap.waiting === "opponent" || snap.waiting === "referee";
  const review = game.review ? (JSON.parse(game.review) as GameReview) : null;

  // Which board. The query wins for one page load, the cookie is the setting;
  // a cookie rather than a column because it is per-device and needs no
  // migration to try, and no migration to change your mind.
  const asked = (await searchParams).board;
  const cookie = (await cookies()).get("boardStyle")?.value;
  const motion = asked ? asked === "stage" : cookie === "stage";

  return (
    <div className="mx-auto w-full max-w-7xl space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href="/arena" className="text-sm text-space-300 hover:text-ki-300">
          ← Arena
        </Link>
        <span className="text-sm font-medium text-space-100 sm:text-base">
          {game.p1Name} <span className="text-space-500">vs</span> {game.p2Name}
        </span>
        <span className="rounded-full border border-space-700 px-2 py-0.5 text-[11px] uppercase tracking-wider text-space-400">
          {game.mode === "hotseat" ? "hot-seat" : game.mode}
        </span>
        <form action={chooseBoard.bind(null, id, motion ? "classic" : "stage")} className="ml-auto">
          <SubmitButton pendingLabel="Switching…" className="tap text-sm text-space-400 hover:text-ki-300">
            {motion ? "classic board" : "motion board"}
          </SubmitButton>
        </form>
        <Link href={`/arena/${id}/debug`} className="text-sm text-space-400 hover:text-ki-300">
          how Claude played
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
          damage={{ you: game.state.players.p1.damageTaken, them: game.state.players.p2.damageTaken }}
          spend={game.spend}
          review={review}
          aiEnabled={hasAnthropic()}
        />
      )}

      {motion ? (
        <ArenaStage
          gameId={id}
          view={snap.view}
          legal={snap.legal}
          taps={snap.taps}
          log={snap.log}
          spotlight={snap.spotlight}
          beats={snap.beats}
          playable={playing}
          waitingOnServer={waitingOnServer}
        />
      ) : (
        <ArenaBoard
          gameId={id}
          view={snap.view}
          legal={snap.legal}
          taps={snap.taps}
          log={snap.log}
          spotlight={snap.spotlight}
          playable={playing}
          waitingOnServer={waitingOnServer}
        />
      )}
    </div>
  );
}
