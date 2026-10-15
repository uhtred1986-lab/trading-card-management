import Link from "next/link";
import { db } from "@/db";
import { breakdown, movers, summarise, valuedLots } from "@/lib/collection/queries";
import { cachedPriceSource } from "@/lib/cache/reads";
import { lastSyncRuns } from "@/lib/sync";
import { GAME_INFO, gameOr } from "@/lib/catalog/games";
import { formatCents, formatPct } from "@/lib/money";
import { CardImage } from "@/components/CardImage";
import { requireSignedInPage, currentScope } from "@/lib/auth";
import { PageHeader, Panel, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireSignedInPage();
  // Valued once (the heavy price join) and handed to movers and breakdown.
  // Prices from the cache (held until the next price sync); the lots themselves are read fresh.
  const [valued, sync] = await Promise.all([valuedLots(db, { prices: cachedPriceSource, scope: await currentScope() }), lastSyncRuns(db)]);
  const { lots, usdEur } = valued;
  const [mv, bd] = await Promise.all([movers(db, 7, 8, valued, cachedPriceSource), breakdown(db, {}, valued)]);
  const s = summarise(lots, usdEur);
  const gain = s.valueEurCents - s.spentEurCents;
  const catalogRun = sync.latest.get("catalog");
  const pricesRun = sync.latest.get("prices");

  if (s.lots === 0) {
    return (
      <div className="ds-page space-y-4">
        <PageHeader title="Your collection starts here" eyebrow="Collection" description="Track your cards, values, and decks in one place." />
        <EmptyState title="Your collection is empty" action={<div className="ds-actions mt-4">
          <Link href="/add" className="tap rounded-md bg-ki-500 px-4 py-2 font-semibold text-space-950 hover:bg-ki-400">
            Add cards
          </Link>
          <Link href="/cards" className="tap rounded-md border border-space-600 px-4 py-2 text-space-100 hover:bg-space-800">
            Browse catalog
          </Link>
          </div>}>
          Add cards by scanning them, typing them in, or straight from any card page.
        </EmptyState>
        {!catalogRun ? (
          <p className="text-sm text-loss">
            The card catalog hasn&apos;t been imported yet — go to{" "}
            <Link className="underline" href="/settings">
              Settings
            </Link>
            .
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ds-page space-y-6">
      <PageHeader title="Collection" eyebrow="Your cards" description="A live view of what you own, what it is worth, and how its value is moving." actions={<div className="ds-actions"><Link href="/collection" className="ds-button-secondary">View collection</Link><Link href="/arena" className="ds-button">Play in the Arena</Link></div>}>
        <p className="text-xs text-space-400">
          Prices {pricesRun?.finishedAt ? `as of ${pricesRun.finishedAt.toISOString().slice(0, 10)}` : "not synced"}
          {usdEur ? ` · 1 USD = ${usdEur.toFixed(4)} EUR` : ""}
        </p>
      </PageHeader>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Current value" value={formatCents(s.valueEurCents)} hint={`${s.copiesWithValue}/${s.copies} copies priced`} />
        <Tile label="Total spent" value={formatCents(s.spentEurCents)} hint={`${s.copiesWithCost}/${s.copies} copies with a cost`} />
        <Tile label="Gain / loss" value={formatCents(gain)} tone={gain > 0 ? "gain" : gain < 0 ? "loss" : undefined} hint={s.spentEurCents ? formatPct(gain / s.spentEurCents) : "—"} />
        <Tile label="Cards" value={`${s.copies}`} hint={`${s.uniqueCards} unique · ${s.lots} lots`} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-space-300">Biggest movers · {mv.days} days</h2>
        {mv.rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-space-700 p-4 text-sm text-space-300">
            Movers need at least two price snapshots a few days apart. The daily price sync builds this up automatically.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {mv.rows.map((m) => {
              const conv = (usd: number) => (usdEur ? formatCents(Math.round(usd * usdEur)) : formatCents(usd, "USD"));
              return (
                <li key={m.cardId}>
                  <Link href={`/cards/${encodeURIComponent(m.cardId)}`} className="flex gap-2 rounded-xl border border-space-700/70 bg-space-900/60 p-2 hover:border-ki-500/50">
                    <div className="w-14 shrink-0">
                      <CardImage src={m.imageUrl} alt={m.name} sizes="56px" />
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="truncate font-medium text-space-50">{m.name}</div>
                      <div className="font-mono text-xs text-space-300">
                        {m.cardId} · ×{m.qty}
                      </div>
                      <div className={`mt-1 font-semibold ${m.deltaUsd > 0 ? "text-gain" : "text-loss"}`}>
                        {formatPct(m.pct)}{" "}
                        <span className="text-xs font-normal text-space-300">
                          {conv(m.thenUsd)} → {conv(m.nowUsd)}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Only worth the space once the collection actually spans both games. */}
      {bd.byGame.length > 1 ? (
        <Panel>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-space-300">By game</h2>
          <Table
            rows={bd.byGame.map((r) => ({
              key: r.code,
              label: GAME_INFO[gameOr(r.code)].label,
              copies: r.copies,
              value: r.valueEur,
              href: `/collection?game=${r.code}`,
            }))}
          />
        </Panel>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-space-300">By set</h2>
          <Table rows={bd.bySet.map((r) => ({ key: r.code, label: r.name, sub: r.code, copies: r.copies, value: r.valueEur, href: `/collection?set=${r.code}` }))} />
        </Panel>
        <Panel>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-space-300">By rarity</h2>
          <Table rows={bd.byRarity.map((r) => ({ key: r.code, label: r.code, copies: r.copies, value: r.valueEur }))} />
        </Panel>
      </div>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "gain" | "loss" }) {
  return (
    <div className="rounded-xl border border-space-700/70 bg-space-900/60 p-3">
      <div className="text-xs uppercase tracking-wider text-space-300">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-space-50"}`}>{value}</div>
      {hint ? <div className="text-xs text-space-400">{hint}</div> : null}
    </div>
  );
}

function Table({ rows }: { rows: { key: string; label: string; sub?: string; copies: number; value: number; href?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="divide-y divide-space-800 rounded-xl border border-space-700/70 text-sm">
      {rows.map((r) => (
        <li key={r.key} className="relative px-3 py-2">
          <div className="absolute inset-y-0 left-0 bg-ki-500/10" style={{ width: `${(r.value / max) * 100}%` }} aria-hidden />
          <div className="relative flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-space-100">
              {r.href ? (
                <Link href={r.href} className="hover:text-ki-300">
                  {r.label}
                </Link>
              ) : (
                r.label
              )}
              {r.sub ? <span className="ml-1 font-mono text-xs text-space-400">{r.sub}</span> : null}
            </span>
            <span className="text-xs text-space-300">×{r.copies}</span>
            <span className="w-24 text-right tabular-nums text-space-50">{formatCents(r.value)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
