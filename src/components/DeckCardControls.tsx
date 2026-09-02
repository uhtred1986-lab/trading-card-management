"use client";

import { useState, useTransition } from "react";
import { setDeckCard } from "@/app/decks/actions";
import type { Zone } from "@/lib/decks/queries";
import type { BuildConflict } from "@/lib/decks/reservations";

/**
 * +/- stepper for one deck row. Going past the copy limit is allowed — the deck
 * is flagged illegal instead of the button being disabled. Only the built-deck
 * ownership check can refuse a change, and it says why inline.
 */
export function DeckCardControls({ deckId, cardId, zone, quantity, limit }: { deckId: number; cardId: string; zone: Zone; quantity: number; limit: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<BuildConflict[] | null>(null);

  const set = (q: number) =>
    start(async () => {
      const r = await setDeckCard(deckId, cardId, zone, q);
      setError(r.ok ? null : r.conflicts);
    });

  const btn = "tap h-8 w-8 rounded-md border border-space-600 text-space-100 hover:bg-space-800 disabled:opacity-40";
  return (
    <div className="flex flex-col items-end gap-1">
      <div className={`flex items-center gap-1 ${pending ? "opacity-60" : ""}`}>
        <button className={btn} onClick={() => set(quantity - 1)} disabled={pending} aria-label="Remove one">
          −
        </button>
        <span className={`w-6 text-center font-semibold tabular-nums ${quantity > limit ? "text-loss" : "text-space-50"}`} title={quantity > limit ? `Over the ${limit}-copy limit` : undefined}>
          {quantity}
        </span>
        <button className={btn} onClick={() => set(quantity + 1)} disabled={pending || quantity >= 99} aria-label="Add one" title={quantity >= limit ? `Past the ${limit}-copy limit — the deck will be flagged illegal` : undefined}>
          +
        </button>
      </div>
      {error ? (
        <span className="max-w-[12rem] text-right text-[11px] text-loss">
          Built deck: short {error[0]?.short} × {error[0]?.name}
        </span>
      ) : null}
    </div>
  );
}
