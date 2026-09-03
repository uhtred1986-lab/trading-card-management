"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { unwantCardAction } from "@/app/decks/ai-actions";
import { CardImage } from "./CardImage";

export interface WantRowView {
  cardId: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  note: string | null;
  deckId: number | null;
}

/** The saved shopping list — cards parked from a swap suggestion, ready to price. */
export function WantList({ rows }: { rows: WantRowView[] }) {
  const [gone, setGone] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const live = rows.filter((r) => !gone.includes(r.cardId));
  if (live.length === 0) return null;

  return (
    <section className="rounded-xl border border-ki-500/30 bg-ki-500/5 p-3">
      <h2 className="mb-2 text-sm font-semibold text-space-50">
        Shopping list <span className="font-normal text-space-400">— {live.reduce((n, r) => n + r.quantity, 0)} cards to buy</span>
      </h2>
      <ul className="space-y-1">
        {live.map((r) => (
          <li key={r.cardId} className="flex items-center gap-2 rounded-lg bg-space-900/60 px-2 py-1 text-sm">
            <div className="w-8 shrink-0">
              <CardImage src={r.imageUrl} alt={r.name} sizes="32px" />
            </div>
            <div className="min-w-0 flex-1">
              <Link href={`/cards/${encodeURIComponent(r.cardId)}`} className="block truncate font-medium text-space-50 hover:text-ki-300">
                {r.quantity}× {r.name}
              </Link>
              <div className="flex flex-wrap gap-2 text-[11px] text-space-400">
                <span className="font-mono">{r.cardId}</span>
                {r.deckId ? (
                  <Link href={`/decks/${r.deckId}`} className="hover:text-ki-300">
                    for a deck
                  </Link>
                ) : null}
                {r.note ? <span className="italic">{r.note}</span> : null}
              </div>
            </div>
            <button
              onClick={() =>
                start(async () => {
                  await unwantCardAction(r.cardId);
                  setGone((g) => [...g, r.cardId]);
                })
              }
              disabled={pending}
              className="tap rounded px-2 py-1 text-xs text-space-400 hover:bg-space-800 hover:text-loss disabled:opacity-40"
              title="Remove from the shopping list"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
