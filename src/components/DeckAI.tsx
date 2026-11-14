"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { summariseDeckAction, wizardAction } from "@/app/decks/ai-actions";
import type { DeckSummary } from "@/lib/ai/deck";
import { DECK_AI_LABELS_EN, type DeckAiLabels } from "@/lib/ai/games/labels";

/**
 * AI panel on the deck page: summary on request, and the swap wizard. The server side reads the deck's
 * own game; `labels` is the screen's language (English by default; `DECK_AI_LABELS_DE` from
 * `@/lib/ai/games/labels-de` for the Pokémon screens, "Deck analysieren").
 */
export function DeckAI({
  deckId,
  aiSummary,
  aiSummaryAt,
  enabled,
  openSuggestions,
  labels = DECK_AI_LABELS_EN,
}: {
  deckId: number;
  aiSummary: string | null;
  aiSummaryAt: string | null;
  enabled: boolean;
  openSuggestions: number;
  labels?: DeckAiLabels;
}) {
  const PRESETS = labels.presets;
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
      if (r.ok) setNote(r.count ? `${(r.count === 1 ? labels.suggestionOne : labels.suggestionMany).replace("{n}", String(r.count))}${labels.suggestionHint} ${r.assessment}` : `${labels.noSwaps} ${r.assessment}`);
      else setError(r.error);
    });

  if (!enabled) {
    return <p className="rounded-xl border border-dashed border-space-700 p-3 text-xs text-space-300">{labels.disabled}</p>;
  }

  const select = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1 text-xs text-space-100";

  return (
    <div className="space-y-3 rounded-xl border border-space-700/70 bg-space-900/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-space-50">{labels.heading}</h2>
        <button onClick={summarise} disabled={pending} className={`${btn} ml-auto border border-space-600 text-space-100 hover:bg-space-800`}>
          {pending ? "…" : aiSummary ? labels.resummarise : labels.summarise}
        </button>
      </div>

      {error ? <p className="text-xs text-loss">{error}</p> : null}

      {summary ? (
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-semibold text-ki-300">{summary.archetype}</span> — {summary.gamePlan}
          </p>
          <Pair label={labels.strong} items={summary.strengths} />
          <Pair label={labels.weak} items={summary.weaknesses} />
          <Pair label={labels.goodAgainst} items={summary.goodAgainst} />
          <Pair label={labels.badAgainst} items={summary.badAgainst} />
          {summary.keyCards.length ? (
            <div className="text-xs">
              <span className="font-semibold text-space-300">{labels.keyCards}</span>
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
          {summary.legalityNotes.length ? <Pair label={labels.legality} items={summary.legalityNotes} tone="loss" /> : null}
        </div>
      ) : aiSummary ? (
        <div className="whitespace-pre-line text-sm text-space-200">
          {aiSummary}
          {aiSummaryAt ? <div className="mt-1 text-[11px] text-space-400">{labels.summarised} {aiSummaryAt.slice(0, 10)}</div> : null}
        </div>
      ) : (
        <p className="text-xs text-space-300">{labels.summaryHint}</p>
      )}

      <div className="space-y-2 border-t border-space-800 pt-3">
        <h3 className="text-sm font-semibold text-space-50">{labels.wizardHeading}</h3>
        <p className="text-xs text-space-400">
          {labels.wizardHint}
          {openSuggestions > 0 ? <span className="text-ki-300">{labels.openNow.replace("{n}", String(openSuggestions))}</span> : null}
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
          placeholder={labels.contextPlaceholder}
          className="tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-1 text-sm text-space-100"
        />

        <div className="flex flex-wrap items-center gap-2">
          <select value={scope} onChange={(e) => setScope(e.target.value as "any" | "owned")} className={select}>
            <option value="any">{labels.scopeAny}</option>
            <option value="owned">{labels.scopeOwned}</option>
          </select>
          <button onClick={runWiz} disabled={pending} className={`${btn} ml-auto bg-ki-500 text-space-950 hover:bg-ki-400`}>
            {pending ? labels.thinking : labels.suggestSwaps}
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
