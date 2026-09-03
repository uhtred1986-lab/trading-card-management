"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { summariseDeckAction, wizardAction } from "@/app/decks/ai-actions";
import type { DeckSummary } from "@/lib/ai/deck";

/** Ready-made asks, so a run doesn't need a sentence typed every time. */
const PRESETS = [
  { label: "Quick suggestion", value: "" },
  { label: "I feel something's missing", value: "Something feels missing — say what role or effect this deck lacks and fill it." },
  { label: "More consistency", value: "Prioritise consistency: searching, draw, and hitting energy on curve." },
  { label: "Faster / more aggressive", value: "Optimise for pressure and speed — win earlier, even at the cost of late-game power." },
  { label: "Survive longer", value: "Optimise for surviving into the late game: removal, blockers and card advantage." },
  { label: "Cheaper to build", value: "Prefer swaps that keep the deck affordable; avoid expensive rares where a common does the job." },
];

/** AI panel on the deck page: summary on request, and the swap wizard. */
export function DeckAI({
  deckId,
  aiSummary,
  aiSummaryAt,
  enabled,
  openSuggestions,
}: {
  deckId: number;
  aiSummary: string | null;
  aiSummaryAt: string | null;
  enabled: boolean;
  openSuggestions: number;
}) {
  const [pending, start] = useTransition();
  const [summary, setSummary] = useState<DeckSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<"any" | "owned">("any");
  const [preset, setPreset] = useState(0);
  const [context, setContext] = useState("");
  const [note, setNote] = useState<string | null>(null);

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
      setNote(null);
      const asked = [PRESETS[preset].value, context.trim()].filter(Boolean).join(" ");
      const r = await wizardAction(deckId, scope, asked || null);
      if (r.ok) setNote(r.count ? `${r.count} suggestion${r.count === 1 ? "" : "s"} — open the ▸ under a card to see them. ${r.assessment}` : `No swaps suggested. ${r.assessment}`);
      else setError(r.error);
    });

  if (!enabled) {
    return <p className="rounded-xl border border-dashed border-space-700 p-3 text-xs text-space-300">Set ANTHROPIC_API_KEY to enable deck analysis.</p>;
  }

  const select = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1 text-xs text-space-100";

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

      <div className="space-y-2 border-t border-space-800 pt-3">
        <h3 className="text-sm font-semibold text-space-50">Improvement wizard</h3>
        <p className="text-xs text-space-400">
          Suggestions are saved and appear under the card they replace, so you only pay for a run once. They expire after 7 days.
          {openSuggestions > 0 ? <span className="text-ki-300"> {openSuggestions} open right now.</span> : null}
        </p>

        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setPreset(i)}
              className={`tap rounded-full px-2 py-0.5 text-[11px] ring-1 ${preset === i ? "bg-ki-500/20 text-ki-200 ring-ki-500/50" : "text-space-300 ring-space-600 hover:bg-space-800"}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={2}
          placeholder="Anything else for Claude? e.g. “I keep losing to yellow aggro” or “I never draw my leader's combo pieces”."
          className="tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-1 text-sm text-space-100"
        />

        <div className="flex flex-wrap items-center gap-2">
          <select value={scope} onChange={(e) => setScope(e.target.value as "any" | "owned")} className={select}>
            <option value="any">Any legal card</option>
            <option value="owned">Only cards I own</option>
          </select>
          <button onClick={runWiz} disabled={pending} className={`${btn} ml-auto bg-ki-500 text-space-950 hover:bg-ki-400`}>
            {pending ? "Thinking…" : "Suggest swaps"}
          </button>
        </div>

        {note ? <p className="text-xs text-space-200">{note}</p> : null}
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
