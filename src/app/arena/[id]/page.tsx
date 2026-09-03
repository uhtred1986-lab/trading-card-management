import Link from "next/link";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { cards as cardsTable } from "@/db/schema";
import { ArenaBoard } from "@/components/arena/ArenaBoard";
import { loadGame } from "@/lib/arena/games";
import { boardView, tappable, viewerOf } from "@/lib/arena/view";
import { abandon } from "../actions";

export const dynamic = "force-dynamic";

export default async function ArenaGamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();
  const game = await loadGame(db, id);
  if (!game) notFound();

  // Card art, keyed by catalog id; tokens have none.
  const ids = [...new Set(Object.values(game.state.cards).map((c) => c.cardId))].filter((x) => !x.startsWith("TOKEN:"));
  const rows = ids.length ? await db.select({ id: cardsTable.id, imageUrl: cardsTable.imageUrl }).from(cardsTable).where(inArray(cardsTable.id, ids)) : [];
  const images: Record<string, string | null> = {};
  for (const r of rows) images[r.id] = r.imageUrl;

  const viewer = viewerOf(game.state);
  const view = boardView(game.ctx, game.state, viewer, images);
  const taps = tappable(game.legal);
  const playable = game.status === "playing";

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <Link href="/arena" className="text-xs text-space-300 hover:text-ki-300">
          ← Arena
        </Link>
        <span className="text-xs text-space-500">
          {game.p1Name} vs {game.p2Name}
        </span>
        {playable && (
          <form action={abandon.bind(null, id)} className="ml-auto">
            <button className="tap text-xs text-space-400 hover:text-loss">give up</button>
          </form>
        )}
      </div>

      <ArenaBoard gameId={id} view={view} legal={game.legal} taps={taps} log={game.log} playable={playable} />
    </div>
  );
}
