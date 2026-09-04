import Link from "next/link";
import { db } from "@/db";
import { GAMES, parseGame } from "@/lib/catalog/games";
import { GameFilter } from "@/components/GameFilter";
import { CardImage } from "@/components/CardImage";
import { OFFICIAL_NEWS_LINKS, recentCards } from "@/lib/catalog/news";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v || undefined);
const DAYS = 30;

export default async function MetaNewsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const game = parseGame(one(sp.game));

  const [all, filtered] = await Promise.all([recentCards(db, { days: DAYS }), game ? recentCards(db, { game, days: DAYS }) : Promise.resolve(null)]);
  const cards = filtered ?? all;
  const gamesPresent = GAMES.filter((g) => all.some((c) => c.game === g));

  const bySet = new Map<string, { setName: string; cards: typeof cards }>();
  for (const c of cards) {
    const bucket = bySet.get(c.setCode) ?? { setName: c.setName, cards: [] };
    bucket.cards.push(c);
    bySet.set(c.setCode, bucket);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-space-50">News</h1>
          <p className="text-sm text-space-300">New to the catalog in the last {DAYS} days, newest first.</p>
        </div>
        <Link href="/meta" className="tap rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-100 hover:bg-space-800">
          ← Leaderboard
        </Link>
      </div>

      <GameFilter path="/meta/news" game={game} available={gamesPresent} />

      {cards.length === 0 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-8 text-center text-sm text-space-300">
          Nothing new in the last {DAYS} days. Run a catalog sync from Settings when a new set is out.
        </p>
      ) : (
        <div className="space-y-4">
          {[...bySet.values()].map((bucket) => (
            <section key={bucket.setName}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-space-300">{bucket.setName}</h2>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
                {bucket.cards.map((c) => (
                  <li key={c.id}>
                    <Link href={`/cards/${encodeURIComponent(c.id)}`} className="block">
                      <CardImage src={c.imageUrl} alt={c.name} sizes="120px" />
                      <div className="mt-1 truncate text-xs text-space-200">{c.name}</div>
                      {c.isLeader ? <span className="rounded bg-ki-500/15 px-1 py-px text-[10px] font-bold uppercase text-ki-300">Leader</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-space-300">Official news</h2>
        <ul className="space-y-1 text-sm">
          {OFFICIAL_NEWS_LINKS.map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noreferrer" className="text-ki-300 hover:underline">
                {l.label} ↗
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
