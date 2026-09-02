import { db } from "@/db";
import { lastSyncRuns } from "@/lib/sync";
import { syncCardTraderAction, syncCatalogAction, syncPricesAction } from "./actions";

export const dynamic = "force-dynamic";
/** Sync actions can run for a couple of minutes on Vercel's fluid compute. */
export const maxDuration = 300;

export default async function SettingsPage() {
  const { latest, recent } = await lastSyncRuns(db);
  const catalog = latest.get("catalog");
  const prices = latest.get("prices");
  const fx = latest.get("fx");
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasCardTrader = !!process.env.CARDTRADER_API_TOKEN;
  const cardTraderLive = process.env.CARDTRADER_ENABLED === "true";
  const hasXimilar = !!process.env.XIMILAR_API_KEY;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-space-50">Settings & data sync</h1>

      <section className="grid gap-3 md:grid-cols-2">
        <SyncCard
          title="Card catalog"
          source="deckplanet — every DBS card (legacy + Masters), text, bans, prints, images"
          run={catalog}
          action={syncCatalogAction}
          button="Refresh catalog"
        />
        <SyncCard
          title="Market prices"
          source="TCGplayer via tcgcsv.com (daily) + ECB USD→EUR rate. Also runs automatically at 06:00 UTC."
          run={prices}
          extra={fx?.summary ? `FX ${JSON.stringify(fx.summary)}` : undefined}
          action={syncPricesAction}
          button="Refresh prices"
        />
        <SyncCard
          title="CardTrader catalog"
          source={`Links CardTrader blueprints to your cards (via TCGplayer ids, then card numbers) so EU listings and the cart optimiser work. Read-only. ${cardTraderLive ? "" : "Live calls are disabled — set CARDTRADER_ENABLED=true first."}`}
          run={latest.get("cardtrader")}
          action={syncCardTraderAction}
          button="Sync CardTrader"
          disabled={!cardTraderLive}
        />
      </section>

      <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3 text-sm">
        <h2 className="mb-2 font-semibold text-space-50">Integrations</h2>
        <ul className="space-y-1">
          <Row ok={hasAnthropic} label="Anthropic API" note="deck analysis, improvement wizard, set review, card scanning" />
          <Row
            ok={hasCardTrader}
            label="CardTrader API"
            note={hasCardTrader ? (cardTraderLive ? "token set · live calls enabled" : "token set · live calls disabled (CARDTRADER_ENABLED=false)") : "no token — EU listings and cart optimiser disabled"}
          />
          <Row ok={hasXimilar} label="Ximilar" note={hasXimilar ? "batch photo detection via Ximilar" : "not set — batch scans use Claude vision"} />
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-space-300">Recent sync runs</h2>
        <div className="overflow-x-auto rounded-xl border border-space-700/70">
          <table className="w-full text-sm">
            <thead className="bg-space-900 text-left text-xs uppercase tracking-wide text-space-300">
              <tr>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Summary</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-t border-space-800 align-top">
                  <td className="px-3 py-2">{r.source}</td>
                  <td className={`px-3 py-2 ${r.status === "ok" ? "text-gain" : r.status === "error" ? "text-loss" : "text-ki-300"}`}>{r.status}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-space-300">{r.startedAt.toISOString().replace("T", " ").slice(0, 16)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-space-300">{r.error ?? (r.summary ? JSON.stringify(r.summary) : "")}</td>
                </tr>
              ))}
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-space-300">
                    Nothing synced yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SyncCard({
  title,
  source,
  run,
  extra,
  action,
  button,
  disabled = false,
}: {
  title: string;
  source: string;
  run?: { status: string; finishedAt: Date | null; startedAt: Date; summary: unknown; error: string | null };
  extra?: string;
  action: () => Promise<void>;
  button: string;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-space-50">{title}</h2>
          <p className="text-xs text-space-300">{source}</p>
        </div>
        <form action={action}>
          <button disabled={disabled} className="tap rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50">
            {button}
          </button>
        </form>
      </div>
      <p className="mt-2 text-xs text-space-300">
        {run ? (
          <>
            Last run <span className={run.status === "ok" ? "text-gain" : run.status === "error" ? "text-loss" : "text-ki-300"}>{run.status}</span> at{" "}
            {(run.finishedAt ?? run.startedAt).toISOString().replace("T", " ").slice(0, 16)} UTC
            {run.summary ? <span className="block font-mono">{JSON.stringify(run.summary)}</span> : null}
            {run.error ? <span className="block text-loss">{run.error}</span> : null}
          </>
        ) : (
          "Never run."
        )}
        {extra ? <span className="block font-mono">{extra}</span> : null}
      </p>
    </div>
  );
}

function Row({ ok, label, note }: { ok: boolean; label: string; note: string }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${ok ? "bg-gain" : "bg-space-500"}`} aria-hidden />
      <span className="font-medium text-space-100">{label}</span>
      <span className="text-xs text-space-300">{note}</span>
    </li>
  );
}
