"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { applySwapAction, dismissSuggestionAction, wantCardAction } from "@/app/decks/ai-actions";
import type { SwapSuggestion } from "@/lib/decks/swaps";
import { CardImage } from "./CardImage";

/** Every word of the panel, so a screen in another language (the Pokémon decks: German) can say it its own way. */
export interface SwapLabels {
  priority: Record<string, string>;
  count: (n: number) => string;
  banned: string;
  takeOut: (out: number, inn: number) => string;
  deckSize: (delta: number) => string;
  cost: (c: string) => string;
  noCost: string;
  ownFree: (free: number, q: number) => string;
  ownSome: (owned: number, free: number, q: number) => string;
  notOwned: (q: number) => string;
  asked: (context: string) => string;
  expires: (days: number) => string;
  quick: string;
  addWant: string;
  onWant: string;
  addWantTitle: string;
  onWantTitle: string;
  dismiss: string;
  prev: string;
  next: string;
  failed: string;
  forCard: (out: string, inn: string) => string;
}

export const SWAP_LABELS_EN: SwapLabels = {
  priority: { high: "high", medium: "medium", low: "low" },
  count: (n) => `${n} swap suggestion${n === 1 ? "" : "s"}`,
  banned: "banned — must go",
  takeOut: (out, inn) => `Take out ${out}, put in ${inn}`,
  deckSize: (d) => `deck size ${d > 0 ? "+" : ""}${d}`,
  cost: (c) => `${c} energy`,
  noCost: "no cost",
  ownFree: (free, q) => `you own ${free} free — enough for all ${q}`,
  ownSome: (owned, free, q) => `own ${owned}, ${free} free of the ${q} needed — the rest are in built decks`,
  notOwned: (q) => `not in your collection — you'd need ${q}`,
  asked: (c) => `asked for: “${c}”`,
  expires: (d) => `expires in ${d} day${d === 1 ? "" : "s"}`,
  quick: "Quick switch",
  addWant: "Add to shopping list",
  onWant: "On shopping list",
  addWantTitle: "Add to the shopping list",
  onWantTitle: "Already on the shopping list",
  dismiss: "Dismiss",
  prev: "Previous suggestion",
  next: "Next suggestion",
  failed: "That didn't work.",
  forCard: (out, inn) => `for ${out} → ${inn}`,
};

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
  labels,
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
  labels: SwapLabels;
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
          <span>{cost ? labels.cost(cost) : labels.noCost}</span>
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
export function SwapSuggestions({ deckId, zone, suggestions, labels = SWAP_LABELS_EN }: { deckId: number; zone: string; suggestions: SwapSuggestion[]; labels?: SwapLabels }) {
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
      else setError(r.error ?? labels.failed);
    });

  const btn = "tap rounded-md px-2 py-1 text-xs font-semibold disabled:opacity-50";

  return (
    <div className="mt-1">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-ki-300 hover:bg-space-800" aria-expanded={open}>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        {labels.count(live.length)}
      </button>

      {open ? (
        <div className="mt-1 rounded-lg border border-ki-500/30 bg-ki-500/5 p-2">
          <div className="flex flex-wrap items-center gap-1.5 pb-2 text-[11px]">
            <span className={`rounded px-1 text-[10px] font-bold uppercase ${PRIORITY[s.priority] ?? PRIORITY.medium}`}>{labels.priority[s.priority] ?? s.priority}</span>
            {s.outIsBanned ? <span className="rounded bg-dbs-red px-1 text-[10px] font-bold uppercase text-white">{labels.banned}</span> : null}
            <span className="font-semibold text-space-100">{labels.takeOut(s.outQuantity, s.inQuantity)}</span>
            {s.outQuantity !== s.inQuantity ? (
              <span className="text-dbs-yellow">{labels.deckSize(s.inQuantity - s.outQuantity)}</span>
            ) : null}
          </div>

          {/* Both cards side by side: the trade is a stat comparison first. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
            <SwapSide cardId={s.outCardId} name={s.outName} imageUrl={s.outImageUrl} quantity={s.outQuantity} cost={s.outEnergyCost} power={s.outPower} other={s.inPower} label="out" labels={labels} />
            <span aria-hidden className="text-sm text-space-500">
              →
            </span>
            <SwapSide cardId={s.inCardId} name={s.inName} imageUrl={s.inImageUrl} quantity={s.inQuantity} cost={s.inEnergyCost} power={s.inPower} other={s.outPower} label="in" labels={labels} />
          </div>

          <p className="mt-1.5 text-xs text-space-200">{s.rationale}</p>
          <p className="mt-0.5 text-[11px] text-space-400">
            {canSwap ? (
              <span className="text-gain">{labels.ownFree(s.inAvailable, s.inQuantity)}</span>
            ) : s.inOwned > 0 ? (
              <span className="text-dbs-yellow">{labels.ownSome(s.inOwned, s.inAvailable, s.inQuantity)}</span>
            ) : (
              <span className="text-space-400">{labels.notOwned(s.inQuantity)}</span>
            )}
            {s.context ? <> · {labels.asked(s.context)}</> : null} · {labels.expires(daysLeft(s.expiresAt))}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {canSwap ? (
              <button
                onClick={() => run(() => applySwapAction(deckId, { id: s.id, outCardId: s.outCardId, outQuantity: s.outQuantity, inCardId: s.inCardId, inQuantity: s.inQuantity, zone }))}
                disabled={pending}
                className={`${btn} bg-ki-500 text-space-950 hover:bg-ki-400`}
              >
                {pending ? "…" : labels.quick}
              </button>
            ) : (
              <button
                onClick={() => run(() => wantCardAction(s.inCardId, Math.max(1, s.inQuantity - s.inAvailable), labels.forCard(s.outCardId, s.inCardId), deckId))}
                disabled={pending || s.wanted}
                className={`${btn} bg-ki-500 text-space-950 hover:bg-ki-400`}
                title={s.wanted ? labels.onWantTitle : labels.addWantTitle}
              >
                {s.wanted ? labels.onWant : labels.addWant}
              </button>
            )}
            <button onClick={() => run(() => dismissSuggestionAction(s.id))} disabled={pending} className={`${btn} border border-space-600 text-space-300 hover:bg-space-800`}>
              {labels.dismiss}
            </button>

            {live.length > 1 ? (
              <span className="ml-auto flex items-center gap-1 text-[11px] text-space-400">
                <button onClick={() => setAt((i) => (i - 1 + live.length) % live.length)} className="rounded px-1.5 py-0.5 hover:bg-space-800" aria-label={labels.prev}>
                  ‹
                </button>
                {Math.min(at, live.length - 1) + 1}/{live.length}
                <button onClick={() => setAt((i) => (i + 1) % live.length)} className="rounded px-1.5 py-0.5 hover:bg-space-800" aria-label={labels.next}>
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
