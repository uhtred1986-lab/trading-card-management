import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { decisionsFor } from "@/lib/arena/ai/debug";
import { loadGame } from "@/lib/arena/games";

export const dynamic = "force-dynamic";

const money = (micros: number) => (micros === 0 ? "—" : micros < 10_000 ? `${(micros / 1_000).toFixed(1)}m¢` : `$${(micros / 1_000_000).toFixed(3)}`);

/**
 * Every decision the server took, in order. This is the page to read after a
 * game to see why Claude played the way it did, what it was shown, and where
 * the time and money went.
 */
export default async function ArenaDebugPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();
  const [game, rows] = await Promise.all([loadGame(db, id), decisionsFor(db, id)]);
  if (!game) notFound();

  const paid = rows.filter((r) => r.costMicros > 0 || r.inputTokens > 0);
  const free = rows.length - paid.length;
  const totalMicros = rows.reduce((n, r) => n + r.costMicros, 0);
  const avgLatency = paid.length ? Math.round(paid.reduce((n, r) => n + (r.latencyMs ?? 0), 0) / paid.length) : 0;
  const cachedShare = (() => {
    const input = paid.reduce((n, r) => n + r.inputTokens, 0);
    const cached = paid.reduce((n, r) => n + r.cachedTokens, 0);
    return input + cached > 0 ? Math.round((cached / (input + cached)) * 100) : 0;
  })();

  const byPrompt = new Map<string, { n: number; micros: number; ms: number }>();
  for (const r of paid) {
    const e = byPrompt.get(r.promptKind) ?? { n: 0, micros: 0, ms: 0 };
    e.n++;
    e.micros += r.costMicros;
    e.ms += r.latencyMs ?? 0;
    byPrompt.set(r.promptKind, e);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <Link href={`/arena/${id}`} className="text-xs text-space-300 hover:text-ki-300">
          ← back to the game
        </Link>
        <h1 className="text-lg font-semibold tracking-tight text-space-50">
          How Claude played · {game.p1Name} vs {game.p2Name}
        </h1>
        <Link href="/arena/backlog" className="ml-auto text-xs text-ki-300 hover:underline">
          card-text backlog →
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-6 text-center text-sm text-space-300">
          Nothing recorded yet. Decisions appear here as the game is played.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="decisions" value={String(rows.length)} />
            <Stat label="taken by rule" value={String(free)} hint="no API call" />
            <Stat label="asked of Claude" value={String(paid.length)} />
            <Stat label="total cost" value={money(totalMicros)} />
            <Stat label="median wait" value={avgLatency ? `${(avgLatency / 1000).toFixed(1)} s` : "—"} />
          </dl>

          <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
            <h2 className="mb-2 text-xs uppercase tracking-widest text-space-400">Where the money went</h2>
            <ul className="space-y-1 text-xs">
              {[...byPrompt.entries()]
                .sort((a, b) => b[1].micros - a[1].micros)
                .map(([kind, e]) => (
                  <li key={kind} className="flex items-baseline gap-2">
                    <span className="w-28 shrink-0 font-medium text-space-100">{kind}</span>
                    <span className="text-space-400">
                      {e.n} call{e.n === 1 ? "" : "s"} · {(e.ms / e.n / 1000).toFixed(1)} s each
                    </span>
                    <span className="ml-auto font-mono text-space-200">{money(e.micros)}</span>
                  </li>
                ))}
            </ul>
            {cachedShare > 0 ? (
              <p className="mt-2 text-[11px] text-space-400">{cachedShare} % of input tokens came from cache, billed at a tenth.</p>
            ) : (
              <p className="mt-2 text-[11px] text-dbs-yellow">
                Nothing was served from cache. On Haiku 4.5 the prompt has to reach 4,096 tokens before anything caches at all; this one does not.
              </p>
            )}
          </section>

          <ol className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-xl border border-space-700/70 bg-space-900/50 p-3 text-xs">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-space-500">#{r.seq}</span>
                  <span className="rounded bg-space-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-space-300">{r.promptKind}</span>
                  <span className="text-space-400">
                    turn {r.turn} · {r.player}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      r.decidedBy === "rule" ? "bg-space-800 text-space-400" : r.decidedBy === "fallback" ? "bg-dbs-yellow/20 text-dbs-yellow" : "bg-ki-500/20 text-ki-300"
                    }`}
                  >
                    {r.decidedBy === "rule" ? "rule, free" : r.decidedBy === "fallback" ? "answer was off the list" : (r.model ?? "claude")}
                  </span>
                  <span className="ml-auto font-mono text-space-400">
                    {money(r.costMicros)}
                    {r.latencyMs ? ` · ${(r.latencyMs / 1000).toFixed(1)} s` : ""}
                    {r.cachedTokens ? ` · ${r.cachedTokens.toLocaleString("en")} cached` : ""}
                  </span>
                </div>

                <p className="mt-1 text-space-100">
                  <span className="text-space-400">chose </span>
                  {r.chosenLabel ?? "—"}
                </p>
                <p className="text-space-400">{r.how}</p>
                {r.say && <p className="mt-0.5 italic text-ki-300">“{r.say}”</p>}

                {Array.isArray(r.menu) && (r.menu as string[]).length > 1 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-space-400">the {(r.menu as string[]).length} moves it could have made</summary>
                    <ol className="mt-1 space-y-0.5 pl-4 text-space-400">
                      {(r.menu as string[]).map((m, i) => (
                        <li key={i} className={i === r.chosenIndex ? "text-ki-300" : ""}>
                          {i}. {m}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}

                {r.promptText && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-space-400">exactly what it was shown</summary>
                    <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-space-950 p-2 font-mono text-[10px] leading-relaxed text-space-300">{r.promptText}</pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-space-700 bg-space-900 p-2 text-center">
      <dd className="font-mono text-lg font-bold text-space-50">{value}</dd>
      <dt className="text-[9px] uppercase tracking-widest text-space-500">{label}</dt>
      {hint && <p className="text-[9px] text-space-600">{hint}</p>}
    </div>
  );
}
