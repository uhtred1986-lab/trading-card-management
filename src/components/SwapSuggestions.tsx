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
 * One side of a swap: the card, how many copies move, and its cost/power with
 * the power difference against the other side spelled out — the comparison is
 * the whole point, and reading it off two card pages is no comparison at all.
 */
function SwapSide({
  cardId,
  name,
  imageUrl,
  quantity,
  cost,
  power,
  other,
  label,
}: {
  cardId: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  cost: string | null;
  power: number | null;
  /** The opposite side's power, for the delta. */
  other: number | null;
  label: "out" | "in";
}) {
  const delta = power != null && other != null ? power - other : null;
  return (
    <div className={`flex min-w-0 gap-1.5 rounded-md p-1 ${label === "out" ? "bg-space-900/60" : "bg-ki-500/10"}`}>
      <div className="w-8 shrink-0">
        <CardImage src={imageUrl} alt={name} sizes="32px" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1">
          <span className={`shrink-0 text-[11px] font-bold ${label === "out" ? "text-loss" : "text-gain"}`}>
            {label === "out" ? "−" : "+"}
            {quantity}
          </span>
          <Link href={`/cards/${encodeURIComponent(cardId)}`} className="truncate text-xs font-medium text-space-50 hover:text-ki-300" title={`${name} (${cardId})`}>
            {name}
          </Link>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-[10px] tabular-nums text-space-400">
          <span>{cost ? `${cost} energy` : "no cost"}</span>
          <span className="text-space-200">{power != null ? power.toLocaleString() : "—"}</span>
          {label === "in" && delta ? <span className={delta > 0 ? "text-gain" : "text-loss"}>{delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()}</span> : null}
        </div>
      </div>
    </div>
  );
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
          <div className="flex flex-wrap items-center gap-1.5 pb-2 text-[11px]">
            <span className={`rounded px-1 text-[10px] font-bold uppercase ${PRIORITY[s.priority] ?? PRIORITY.medium}`}>{s.priority}</span>
            {s.outIsBanned ? <span className="rounded bg-dbs-red px-1 text-[10px] font-bold uppercase text-white">banned — must go</span> : null}
            <span className="font-semibold text-space-100">
              Take out {s.outQuantity}, put in {s.inQuantity}
            </span>
            {s.outQuantity !== s.inQuantity ? (
              <span className="text-dbs-yellow">
                deck size {s.inQuantity > s.outQuantity ? "+" : ""}
                {s.inQuantity - s.outQuantity}
              </span>
            ) : null}
          </div>

          {/* Both cards side by side: the trade is a stat comparison first. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
            <SwapSide
              cardId={s.outCardId}
              name={s.outName}
              imageUrl={s.outImageUrl}
              quantity={s.outQuantity}
              cost={s.outEnergyCost}
              power={s.outPower}
              other={s.inPower}
              label="out"
            />
            <span aria-hidden className="text-sm text-space-500">
              →
            </span>
            <SwapSide
              cardId={s.inCardId}
              name={s.inName}
              imageUrl={s.inImageUrl}
              quantity={s.inQuantity}
              cost={s.inEnergyCost}
              power={s.inPower}
              other={s.outPower}
              label="in"
            />
          </div>

          <p className="mt-1.5 text-xs text-space-200">{s.rationale}</p>
          <p className="mt-0.5 text-[11px] text-space-400">
            {canSwap ? (
              <span className="text-gain">you own {s.inAvailable} free — enough for all {s.inQuantity}</span>
            ) : s.inOwned > 0 ? (
              <span className="text-dbs-yellow">
                own {s.inOwned}, {s.inAvailable} free of the {s.inQuantity} needed — the rest are in built decks
              </span>
            ) : (
              <span className="text-space-400">not in your collection — you&apos;d need {s.inQuantity}</span>
            )}
            {s.context ? <> · asked for: “{s.context}”</> : null} · expires in {daysLeft(s.expiresAt)} day{daysLeft(s.expiresAt) === 1 ? "" : "s"}
          </p>

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
