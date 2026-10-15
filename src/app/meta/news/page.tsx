import Link from "next/link";
import { GAMES, parseGame } from "@/lib/catalog/games";
import { GameFilter } from "@/components/GameFilter";
import { CardImage } from "@/components/CardImage";
import { OFFICIAL_NEWS_LINKS } from "@/lib/catalog/news";
import { cachedRecentCards } from "@/lib/cache/reads";
import { requireSignedInPage } from "@/lib/auth";
import { EmptyState, FilterBar, PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v || undefined);
const DAYS = 30;

export default async function MetaNewsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireSignedInPage();
  const sp = await searchParams;
  const game = parseGame(one(sp.game));

  const [all, filtered] = await Promise.all([cachedRecentCards({ days: DAYS }), game ? cachedRecentCards({ game, days: DAYS }) : Promise.resolve(null)]);
  const cards = filtered ?? all;
  const gamesPresent = GAMES.filter((g) => all.some((c) => c.game === g));

  const bySet = new Map<string, { setName: string; cards: typeof cards }>();
  for (const c of cards) {
    const bucket = bySet.get(c.setCode) ?? { setName: c.setName, cards: [] };
    bucket.cards.push(c);
    bySet.set(c.setCode, bucket);
  }

  return (
    <div className="ds-page space-y-4">
      <PageHeader title="News" eyebrow="Meta" description={`New to the catalog in the last ${DAYS} days, newest first.`} actions={<Link href="/meta" className="ds-button-secondary">← Leaderboard</Link>} />

      <FilterBar summary={`${cards.length} new card${cards.length === 1 ? "" : "s"}`}><GameFilter path="/meta/news" game={game} available={gamesPresent} /></FilterBar>

      {cards.length === 0 ? (
        <EmptyState title="No recent additions">Nothing new in the last {DAYS} days. Run a catalog sync from Settings when a new set is out.</EmptyState>
      ) : (
        <div className="space-y-4">
          {[...bySet.values()].map((bucket) => (
            <Panel key={bucket.setName}>
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
            </Panel>
          ))}
        </div>
      )}

      <Panel>
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
      </Panel>
    </div>
  );
}
