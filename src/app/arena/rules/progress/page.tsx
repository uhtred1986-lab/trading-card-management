import Link from "next/link";
import { db } from "@/db";
import { PageHeader, Panel } from "@/components/ui";
import { currentScope, requireSlPage } from "@/lib/auth";
import { loadProgress, recordAndReadSnapshots, type CardBucket, type CardProgress, type SnapshotRow } from "@/lib/arena/rules-progress";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rules progress" };

const LABEL: Record<CardBucket, string> = { confirmed: "Confirmed", read: "Read (draft)", unread: "Unread", flagged: "Flagged", missing: "No rules" };
const CHIP: Record<CardBucket, string> = {
  confirmed: "bg-emerald-500/15 text-emerald-300",
  read: "bg-sky-500/15 text-sky-300",
  unread: "bg-amber-500/15 text-amber-300",
  flagged: "bg-rose-500/15 text-rose-300",
  missing: "bg-space-700/60 text-space-300",
};
const ORDER: CardBucket[] = ["confirmed", "read", "unread", "flagged", "missing"];
const RANK: Record<CardBucket, number> = { flagged: 0, unread: 1, missing: 2, read: 3, confirmed: 4 };

function Bar({ d }: { d: { total: number; confirmed: number; read: number; unread: number; flagged: number } }) {
  const w = (n: number) => `${d.total ? (n / d.total) * 100 : 0}%`;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-space-800" role="img" aria-label={`${d.confirmed} of ${d.total} confirmed`}>
      <span className="bg-emerald-500" style={{ width: w(d.confirmed) }} />
      <span className="bg-sky-500" style={{ width: w(d.read) }} />
      <span className="bg-amber-500" style={{ width: w(d.unread) }} />
      <span className="bg-rose-500" style={{ width: w(d.flagged) }} />
    </div>
  );
}

function Sparkline({ points }: { points: SnapshotRow[] }) {
  if (points.length < 2) return <p className="text-sm text-space-300">The trend appears after the second day of snapshots.</p>;
  const w = 240, h = 48;
  const max = Math.max(...points.map((p) => p.totalCards), 1);
  const xy = points.map((p, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - (p.confirmedCards / max) * h).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-60 max-w-full text-emerald-400" role="img" aria-label={`Confirmed cards over ${points.length} days`} preserveAspectRatio="none">
        <polyline points={xy} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="text-sm text-space-300">{points[0].date} to {last.date}: {points[0].confirmedCards} to {last.confirmedCards} confirmed</span>
    </div>
  );
}

export default async function RulesProgressPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSlPage();
  const sp = await searchParams;
  const sort = sp.sort === "status" || sp.sort === "name" ? sp.sort : "appearances";
  const filter = ORDER.find((b) => b === sp.status);
  const progress = await loadProgress(db, await currentScope());
  const history = await recordAndReadSnapshots(db, progress).catch(() => [] as SnapshotRow[]);

  let cards: CardProgress[] = progress.cards;
  if (filter) cards = cards.filter((c) => c.bucket === filter);
  cards = [...cards].sort((a, b) =>
    sort === "name" ? a.name.localeCompare(b.name) : sort === "status" ? RANK[a.bucket] - RANK[b.bucket] || b.appearances - a.appearances : b.appearances - a.appearances || a.cardId.localeCompare(b.cardId));
  const counts = Object.fromEntries(ORDER.map((b) => [b, progress.cards.filter((c) => c.bucket === b).length])) as Record<CardBucket, number>;
  const pct = progress.total ? Math.round((progress.confirmed / progress.total) * 100) : 0;
  const href = (q: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ sort: sort === "appearances" ? undefined : sort, status: filter, ...q })) if (v) p.set(k, v);
    const s = p.toString();
    return `/arena/rules/progress${s ? `?${s}` : ""}`;
  };
  const pill = "tap inline-flex items-center rounded-full px-3 py-1 text-xs";

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Arena rules" title="Rules progress" description="Deck-first: cards in your eligible decks (Dragon Ball Super, not testing; main, Z and leader, both faces) whose every skill is confirmed." />
      <Panel className="space-y-3 p-4">
        <p className="text-2xl font-semibold">{progress.confirmed} of {progress.total} deck cards fully confirmed <span className="text-base font-normal text-space-300">({pct}%)</span></p>
        <Bar d={{ total: progress.total, confirmed: progress.confirmed, read: counts.read, unread: counts.unread + counts.missing, flagged: counts.flagged }} />
        <p className="text-sm text-space-300">
          Skills of these cards: {progress.skills.confirmed} confirmed, {progress.skills.owner} owner-authored, {progress.skills.read} read draft, {progress.skills.unread} unread, {progress.skills.flagged} flagged as suspected misreads. A flagged skill never counts as confirmed.
        </p>
        <Sparkline points={history} />
      </Panel>

      <Panel className="p-4">
        <h2 className="mb-3 text-lg font-semibold">Decks</h2>
        {progress.decks.length === 0 ? <p className="text-sm text-space-300">No eligible decks.</p> : (
          <ul className="divide-y divide-space-700/60">
            {progress.decks.map((d) => (
              <li key={d.deckId} className="space-y-1.5 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <Link href={`/decks/${d.deckId}`} className="font-medium hover:underline">{d.name}</Link>
                  <span className="text-sm text-space-300">{d.confirmed}/{d.total} confirmed · {d.read} read · {d.unread + d.missing} unread · {d.flagged} flagged</span>
                </div>
                <Bar d={{ ...d, unread: d.unread + d.missing }} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold">Cards</h2>
          <nav aria-label="Sort" className="flex flex-wrap gap-1.5">
            {([["appearances", "Deck appearances"], ["status", "Needs work first"], ["name", "Name"]] as const).map(([k, l]) => (
              <Link key={k} href={href({ sort: k === "appearances" ? undefined : k })} aria-current={sort === k ? "true" : undefined} className={`${pill} ${sort === k ? "bg-space-600 text-space-50" : "bg-space-800 text-space-300"}`}>{l}</Link>
            ))}
          </nav>
        </div>
        <nav aria-label="Status" className="mb-3 flex flex-wrap gap-1.5">
          <Link href={href({ status: undefined })} className={`${pill} ${!filter ? "bg-space-600 text-space-50" : "bg-space-800 text-space-300"}`}>All {progress.total}</Link>
          {ORDER.map((b) => <Link key={b} href={href({ status: b })} className={`${pill} ${filter === b ? "ring-1 ring-current" : ""} ${CHIP[b]}`}>{LABEL[b]} {counts[b]}</Link>)}
        </nav>
        <ul className="divide-y divide-space-700/60">
          {cards.map((c) => (
            <li key={c.cardId} className="flex items-center gap-3 py-2">
              <span className="w-10 shrink-0 text-right text-sm tabular-nums text-space-300" title="Eligible decks that run it">{c.appearances}×</span>
              <div className="min-w-0 flex-1">
                {c.ruleId ? <Link href={`/arena/rules?rule=${c.ruleId}`} className="tap flex items-center truncate hover:underline">{c.name}</Link> : <span className="block truncate">{c.name}</span>}
                <span className="text-xs text-space-400">{c.cardId}</span>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${CHIP[c.bucket]}`}>{LABEL[c.bucket]}</span>
            </li>
          ))}
        </ul>
        {cards.length === 0 && <p className="text-sm text-space-300">No cards match.</p>}
      </Panel>
    </div>
  );
}
