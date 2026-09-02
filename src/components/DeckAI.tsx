"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { applySwapAction, summariseDeckAction, wizardAction } from "@/app/decks/ai-actions";
import type { DeckSummary, WizardSwap } from "@/lib/ai/deck";
import { CardImage } from "./CardImage";

/** AI panel on the deck page: summary on request, and the swap wizard. */
export function DeckAI({ deckId, aiSummary, aiSummaryAt, enabled }: { deckId: number; aiSummary: string | null; aiSummaryAt: string | null; enabled: boolean }) {
  const [pending, start] = useTransition();
  const [summary, setSummary] = useState<DeckSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<"any" | "owned">("any");
  const [wizard, setWizard] = useState<{ assessment: string; swaps: WizardSwap[] } | null>(null);
  const [decided, setDecided] = useState<Record<number, "accepted" | "rejected" | "error">>({});

  const btn = "tap rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50";

  const summarise = () =>
    start(async () => {
      setError(null);
      const r = await summariseDeckAction(deckId);
      if (r.ok) setSummary(r.summary);
      else setError(r.error);
    });

  const runWiz = () =>
    start(async () => {
      setError(null);
      setDecided({});
      const r = await wizardAction(deckId, scope);
      if (r.ok) setWizard({ assessment: r.assessment, swaps: r.swaps });
      else setError(r.error);
    });

  const accept = (i: number, s: WizardSwap) =>
    start(async () => {
      const r = await applySwapAction(deckId, s);
      setDecided((d) => ({ ...d, [i]: r.ok ? "accepted" : "error" }));
      if (!r.ok) setError(r.error);
    });

  if (!enabled) {
    return <p className="rounded-xl border border-dashed border-space-700 p-3 text-xs text-space-300">Set ANTHROPIC_API_KEY to enable deck analysis.</p>;
  }

  return (
    <div className="space-y-3 rounded-xl border border-space-700/70 bg-space-900/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-space-50">AI analysis</h2>
        <button onClick={summarise} disabled={pending} className={`${btn} ml-auto border border-space-600 text-space-100 hover:bg-space-800`}>
          {pending ? "…" : aiSummary ? "Re-summarise" : "Summarise deck"}
        </button>
      </div>

      {error ? <p className="text-xs text-loss">{error}</p> : null}

      {summary ? (
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-semibold text-ki-300">{summary.archetype}</span> — {summary.gamePlan}
          </p>
          <Pair label="Strong" items={summary.strengths} />
          <Pair label="Weak" items={summary.weaknesses} />
          <Pair label="Good against" items={summary.goodAgainst} />
          <Pair label="Bad against" items={summary.badAgainst} />
          {summary.keyCards.length ? (
            <div className="text-xs">
              <span className="font-semibold text-space-300">Key cards: </span>
              {summary.keyCards.map((k, i) => (
                <span key={k.cardId}>
                  {i ? " · " : ""}
                  <Link href={`/cards/${encodeURIComponent(k.cardId)}`} className="text-space-50 hover:text-ki-300">
                    {k.cardId}
                  </Link>{" "}
                  <span className="text-space-300">{k.why}</span>
                </span>
              ))}
            </div>
          ) : null}
          {summary.legalityNotes.length ? <Pair label="Legality" items={summary.legalityNotes} tone="loss" /> : null}
        </div>
      ) : aiSummary ? (
        <div className="whitespace-pre-line text-sm text-space-200">
          {aiSummary}
          {aiSummaryAt ? <div className="mt-1 text-[11px] text-space-400">Summarised {aiSummaryAt.slice(0, 10)}</div> : null}
        </div>
      ) : (
        <p className="text-xs text-space-300">Get an archetype summary, game plan and matchup notes reasoned from the card text.</p>
      )}

      <div className="border-t border-space-800 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-space-50">Improvement wizard</h3>
          <select value={scope} onChange={(e) => setScope(e.target.value as "any" | "owned")} className="tap rounded-md border border-space-600 bg-space-900 px-2 py-1 text-xs text-space-100">
            <option value="any">Any legal card</option>
            <option value="owned">Only cards I own</option>
          </select>
          <button onClick={runWiz} disabled={pending} className={`${btn} ml-auto bg-ki-500 text-space-950 hover:bg-ki-400`}>
            {pending ? "Thinking…" : "Suggest swaps"}
          </button>
        </div>
        {wizard ? (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-space-200">{wizard.assessment}</p>
            {wizard.swaps.length === 0 ? <p className="text-xs text-space-300">No swaps suggested.</p> : null}
            <ul className="space-y-2">
              {wizard.swaps.map((s, i) => {
                const state = decided[i];
                return (
                  <li key={i} className={`rounded-lg border p-2 ${state === "accepted" ? "border-gain/40 bg-gain/5" : state === "rejected" ? "border-space-800 opacity-50" : "border-space-700"}`}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <SwapCard id={s.outCardId} name={s.outName} img={s.outImageUrl} qty={s.outQuantity} label="out" />
                      <span className="text-lg text-ki-400">→</span>
                      <SwapCard id={s.inCardId} name={s.inName} img={s.inImageUrl} qty={s.inQuantity} label="in" badge={s.inAvailable >= s.inQuantity ? "owned" : s.inOwned > 0 ? `own ${s.inOwned}` : "need to buy"} badgeTone={s.inAvailable >= s.inQuantity ? "gain" : s.inOwned > 0 ? "warn" : "loss"} />
                    </div>
                    <p className="mt-1 text-xs text-space-300">
                      <span className={`mr-1 rounded px-1 text-[10px] font-bold uppercase ${s.priority === "high" ? "bg-ki-500/20 text-ki-300" : "bg-space-800 text-space-300"}`}>{s.priority}</span>
                      {s.rationale}
                    </p>
                    {!state || state === "error" ? (
                      <div className="mt-1 flex gap-2">
                        <button onClick={() => accept(i, s)} disabled={pending} className={`${btn} bg-space-700 text-space-50 hover:bg-space-600`}>
                          Accept
                        </button>
                        <button onClick={() => setDecided((d) => ({ ...d, [i]: "rejected" }))} className={`${btn} border border-space-600 text-space-300 hover:bg-space-800`}>
                          Reject
                        </button>
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-space-300">{state === "accepted" ? "Applied to deck." : "Rejected."}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Pair({ label, items, tone }: { label: string; items: string[]; tone?: "loss" }) {
  if (!items.length) return null;
  return (
    <p className={`text-xs ${tone === "loss" ? "text-loss" : "text-space-200"}`}>
      <span className="font-semibold text-space-300">{label}: </span>
      {items.join(" · ")}
    </p>
  );
}

function SwapCard({ id, name, img, qty, label, badge, badgeTone }: { id: string; name: string; img: string | null; qty: number; label: string; badge?: string; badgeTone?: "gain" | "warn" | "loss" }) {
  return (
    <Link href={`/cards/${encodeURIComponent(id)}`} className="flex min-w-0 items-center gap-2 hover:text-ki-300">
      <div className="w-10 shrink-0">
        <CardImage src={img} alt={name} sizes="40px" />
      </div>
      <div className="min-w-0 text-xs">
        <div className="text-[10px] uppercase text-space-400">
          {label} ×{qty}
        </div>
        <div className="truncate font-medium text-space-50">{name}</div>
        <div className="font-mono text-space-400">{id}</div>
        {badge ? <span className={`rounded px-1 text-[10px] font-semibold ${badgeTone === "gain" ? "bg-gain/15 text-gain" : badgeTone === "warn" ? "bg-dbs-yellow/15 text-yellow-200" : "bg-loss/15 text-loss"}`}>{badge}</span> : null}
      </div>
    </Link>
  );
}
