"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { applySwapAction, dismissSuggestionAction, wantCardAction } from "@/app/decks/ai-actions";
import type { SwapSuggestion } from "@/lib/decks/swaps";
import { CardImage } from "./CardImage";

const PRIORITY: Record<string, string> = {
  high: "bg-ki-500/20 text-ki-300",
  medium: "bg-space-800 text-space-300",
  low: "bg-space-800 text-space-400",
};

function daysLeft(expiresAt: Date | string): number {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400_000));
}

/**
 * Claude's proposed replacements for one card, folded away under it. Several
 * suggestions for the same card are paged through rather than stacked, so a
 * long decklist stays readable.
 */
export function SwapSuggestions({ deckId, zone, suggestions }: { deckId: number; zone: string; suggestions: SwapSuggestion[] }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const [gone, setGone] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const live = suggestions.filter((s) => !gone.includes(s.id));
  if (live.length === 0) return null;
  const s = live[Math.min(at, live.length - 1)];
  const canSwap = s.inAvailable >= s.inQuantity;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) setGone((g) => [...g, s.id]);
      else setError(r.error ?? "That didn't work.");
    });

  const btn = "tap rounded-md px-2 py-1 text-xs font-semibold disabled:opacity-50";

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-ki-300 hover:bg-space-800"
        aria-expanded={open}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        {live.length} swap suggestion{live.length === 1 ? "" : "s"}
      </button>

      {open ? (
        <div className="mt-1 rounded-lg border border-ki-500/30 bg-ki-500/5 p-2">
          <div className="flex gap-2">
            <div className="w-10 shrink-0">
              <CardImage src={s.inImageUrl} alt={s.inName} sizes="40px" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="text-[11px] text-space-400">replace with</span>
                <Link href={`/cards/${encodeURIComponent(s.inCardId)}`} className="truncate text-sm font-medium text-space-50 hover:text-ki-300">
                  {s.inName}
                </Link>
                <span className="font-mono text-[11px] text-space-400">{s.inCardId}</span>
                <span className={`rounded px-1 text-[10px] font-bold uppercase ${PRIORITY[s.priority] ?? PRIORITY.medium}`}>{s.priority}</span>
                {s.outQuantity !== 1 || s.inQuantity !== 1 ? (
                  <span className="text-[11px] text-space-400">
                    −{s.outQuantity} / +{s.inQuantity}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-space-200">{s.rationale}</p>
              <p className="mt-0.5 text-[11px] text-space-400">
                {canSwap ? (
                  <span className="text-gain">you own {s.inAvailable} free</span>
                ) : s.inOwned > 0 ? (
                  <span className="text-dbs-yellow">own {s.inOwned}, but none free — every copy is in a built deck</span>
                ) : (
                  <span className="text-space-400">not in your collection</span>
                )}
                {s.context ? <> · asked for: “{s.context}”</> : null} · expires in {daysLeft(s.expiresAt)} day{daysLeft(s.expiresAt) === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {canSwap ? (
              <button
                onClick={() => run(() => applySwapAction(deckId, { id: s.id, outCardId: s.outCardId, outQuantity: s.outQuantity, inCardId: s.inCardId, inQuantity: s.inQuantity, zone }))}
                disabled={pending}
                className={`${btn} bg-ki-500 text-space-950 hover:bg-ki-400`}
              >
                {pending ? "…" : "Quick switch"}
              </button>
            ) : (
              <button
                onClick={() => run(() => wantCardAction(s.inCardId, Math.max(1, s.inQuantity - s.inAvailable), `for ${s.outCardId} → ${s.inCardId}`, deckId))}
                disabled={pending || s.wanted}
                className={`${btn} bg-ki-500 text-space-950 hover:bg-ki-400`}
                title={s.wanted ? "Already on the shopping list" : "Add to the shopping list"}
              >
                {s.wanted ? "On shopping list" : "Add to shopping list"}
              </button>
            )}
            <button onClick={() => run(() => dismissSuggestionAction(s.id))} disabled={pending} className={`${btn} border border-space-600 text-space-300 hover:bg-space-800`}>
              Dismiss
            </button>

            {live.length > 1 ? (
              <span className="ml-auto flex items-center gap-1 text-[11px] text-space-400">
                <button onClick={() => setAt((i) => (i - 1 + live.length) % live.length)} className="rounded px-1.5 py-0.5 hover:bg-space-800" aria-label="Previous suggestion">
                  ‹
                </button>
                {Math.min(at, live.length - 1) + 1}/{live.length}
                <button onClick={() => setAt((i) => (i + 1) % live.length)} className="rounded px-1.5 py-0.5 hover:bg-space-800" aria-label="Next suggestion">
                  ›
                </button>
              </span>
            ) : null}
          </div>
          {error ? <p className="mt-1 text-[11px] text-loss">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
