"use client";

import { useState, useTransition } from "react";
import { setDeckCard } from "@/app/decks/actions";
import type { Zone } from "@/lib/decks/queries";
import type { BuildConflict } from "@/lib/decks/reservations";

/** +/- stepper for one deck row. On a built deck, going over the collection is refused inline. */
export function DeckCardControls({ deckId, cardId, zone, quantity, max }: { deckId: number; cardId: string; zone: Zone; quantity: number; max: number }) {
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
        <span className="w-6 text-center font-semibold tabular-nums text-space-50">{quantity}</span>
        <button className={btn} onClick={() => set(quantity + 1)} disabled={pending || quantity >= max} aria-label="Add one">
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
