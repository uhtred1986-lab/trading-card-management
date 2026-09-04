import Link from "next/link";
import { db } from "@/db";
import { GAMES, parseGame } from "@/lib/catalog/games";
import { GameFilter } from "@/components/GameFilter";
import { buyLink, leaderboard, resultCardsFor } from "@/lib/meta/leaderboard";
import { CardImage } from "@/components/CardImage";
import { ColorPill } from "@/components/ColorPill";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v || undefined);
const DAYS = 90;

export default async function MetaPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const game = parseGame(one(sp.game));

  const all = await leaderboard(db, { days: DAYS });
  const gamesPresent = GAMES.filter((g) => all.some((e) => e.game === g));
  const board = game ? all.filter((e) => e.game === game) : all;

  const resultIds = board.flatMap((e) => e.placements.map((p) => p.resultId));
  const cardsByResult = await resultCardsFor(db, resultIds);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-space-50">Leaderboard</h1>
          <p className="text-sm text-space-300">
            Top-cut leaders from official regionals, last {DAYS} days — scraped from{" "}
            <a href="https://www.deckplanet.net" target="_blank" rel="noreferrer" className="text-ki-300 hover:underline">
              deckplanet.net
            </a>
            .
          </p>
        </div>
        <Link href="/meta/news" className="tap rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-100 hover:bg-space-800">
          News →
        </Link>
      </div>

      <GameFilter path="/meta" game={game} available={gamesPresent} />

      {board.length === 0 ? (
        <div className="rounded-xl border border-dashed border-space-700 p-8 text-center text-sm text-space-300">
          <p>No regional results yet.</p>
          <p className="mt-1">
            Go to <Link href="/settings" className="text-ki-300 hover:underline">Settings</Link> and refresh regional results.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {board.map((entry) => (
            <li key={entry.leaderCardId ?? entry.leaderNumberRaw} className="flex gap-3 rounded-xl border border-space-700/70 bg-space-900/60 p-3">
              <div className="w-20 shrink-0">
                <CardImage src={entry.imageUrl} alt={entry.leaderName ?? entry.leaderNumberRaw} sizes="80px" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="min-w-0">
                  {entry.leaderCardId ? (
                    <Link href={`/cards/${encodeURIComponent(entry.leaderCardId)}`} className="block truncate font-medium text-space-50 hover:text-ki-300">
                      {entry.leaderName}
                    </Link>
                  ) : (
                    <span className="block truncate font-medium text-space-50">{entry.leaderName ?? entry.leaderNumberRaw}</span>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-space-300">
                    <span className="font-mono">{entry.leaderNumberRaw}</span>
                    {entry.colors.map((c) => (
                      <ColorPill key={c} color={c} small />
                    ))}
                  </div>
                  <div className="mt-1 text-xs text-space-300">
                    <span className="font-semibold text-space-50">{entry.appearances}</span> top-cut appearance{entry.appearances === 1 ? "" : "s"} ·{" "}
                    <span className="font-semibold text-space-50">{entry.topFour}</span> top-4
                  </div>
                  {!entry.leaderCardId ? <p className="mt-1 text-xs text-loss">Didn&apos;t match the catalog — shown as reported.</p> : null}
                </div>

                <ul className="space-y-1 text-xs">
                  {entry.placements.slice(0, 4).map((p) => {
                    const resultCards = cardsByResult.get(p.resultId) ?? [];
                    const { href, unmatched } = buyLink(resultCards);
                    return (
                      <li key={p.resultId} className="flex items-center gap-1.5">
                        <span className="rounded bg-space-800 px-1.5 py-px text-[10px] font-bold text-space-200">#{p.placement}</span>
                        <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate text-space-100 hover:text-ki-300">
                          {p.eventName}
                        </a>
                        {resultCards.length > 0 ? (
                          <Link href={href} className="ml-auto shrink-0 rounded bg-ki-500/15 px-1.5 py-px font-semibold text-ki-300 hover:bg-ki-500/25">
                            Buy this decklist{unmatched ? ` (${unmatched} unmatched)` : ""}
                          </Link>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
