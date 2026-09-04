import Link from "next/link";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { cards as cardsTable } from "@/db/schema";
import { hasAnthropic } from "@/lib/ai/client";
import { ArenaBoard } from "@/components/arena/ArenaBoard";
import { GameOver } from "@/components/arena/GameOver";
import { aiPlayerOf } from "@/lib/arena/ai/run";
import type { GameReview } from "@/lib/arena/ai/review";
import { loadGame } from "@/lib/arena/games";
import { boardView, tappable, viewerOf, type CardArt } from "@/lib/arena/view";
import { abandon } from "../actions";

export const dynamic = "force-dynamic";
/** A Tournament turn can take Claude a while to think through. */
export const maxDuration = 300;

export default async function ArenaGamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();
  const game = await loadGame(db, id);
  if (!game) notFound();

  // Card art, keyed by catalog id; tokens have none.
  const ids = [...new Set(Object.values(game.state.cards).map((c) => c.cardId))].filter((x) => !x.startsWith("TOKEN:"));
  const rows = ids.length
    ? await db.select({ id: cardsTable.id, imageUrl: cardsTable.imageUrl, backImageUrl: cardsTable.backImageUrl }).from(cardsTable).where(inArray(cardsTable.id, ids))
    : [];
  const images: Record<string, CardArt> = {};
  for (const r of rows) images[r.id] = { front: r.imageUrl, back: r.backImageUrl };

  const ai = aiPlayerOf(game);
  // In a game against Claude the human is always the first player, so the board
  // is drawn from their side even while Claude is deciding.
  const viewer = ai ? "p1" : viewerOf(game.state);
  const view = boardView(game.ctx, game.state, viewer, images);
  const taps = tappable(game.legal);
  const playing = game.status === "playing";
  const prompt = game.state.prompt;
  const waitingOnServer = playing && (prompt.kind === "referee" || (!!ai && "player" in prompt && prompt.player === ai));
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
        <span className="rounded-full border border-space-700 px-2 py-0.5 text-[11px] uppercase tracking-wider text-space-400">
          {game.mode === "hotseat" ? "hot-seat" : game.mode}
        </span>
        <Link href={`/arena/${id}/debug`} className="ml-auto text-sm text-space-400 hover:text-ki-300">
          how Claude played
        </Link>
        {playing && (
          <form action={abandon.bind(null, id)}>
            <button className="tap text-sm text-space-400 hover:text-loss">give up</button>
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

      <ArenaBoard gameId={id} view={view} legal={game.legal} taps={taps} log={game.log} playable={playing} waitingOnServer={waitingOnServer} />
    </div>
  );
}
