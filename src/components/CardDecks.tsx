"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { addCardToDeckAction, createDeckWithCardAction, removeCardFromDeckAction, type CardDeckResult } from "@/app/decks/actions";
import type { DeckOption } from "@/lib/decks/add";
import type { CardDeckMembership } from "@/lib/decks/queries";

const NEW = "__new";

const ZONE_LABEL: Record<string, string> = { leader: "leader", main: "main", z: "Z-deck", side: "side" };

/**
 * Which decks this card is in, on the card page. Deck slots reference the card
 * rather than one physical copy, so this sits beside the copies table instead
 * of inside it — the same answer would otherwise repeat on every row.
 */
export function CardDecks({ cardId, initial, options }: { cardId: string; initial: CardDeckMembership[]; options: DeckOption[] }) {
  const [decks, setDecks] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  const apply = (fn: () => Promise<CardDeckResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      setDecks(r.decks);
      if (!r.ok) setError(r.error);
    });

  const select = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1 text-xs text-space-100";

  return (
    <div className="mt-3 rounded-xl border border-space-700/70 bg-space-900/40 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-space-300">In decks</span>

        {decks.length === 0 ? <span className="text-xs text-space-400">not in any deck yet</span> : null}

        {decks.map((d) => (
          <span
            key={`${d.id}:${d.zone}`}
            className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-xs ring-1 ${
              d.isBuilt ? "bg-ki-500/15 text-ki-200 ring-ki-500/40" : "bg-space-800 text-space-200 ring-space-600"
            }`}
          >
            <Link href={`/decks/${d.id}`} className="hover:underline">
              {d.name}
            </Link>
            <span className="text-space-400">
              ×{d.quantity}
              {d.zone !== "main" ? ` · ${ZONE_LABEL[d.zone] ?? d.zone}` : ""}
              {d.isBuilt ? " · built" : ""}
            </span>
            <button
              onClick={() => apply(() => removeCardFromDeckAction(cardId, d.id))}
              disabled={pending}
              title={`Remove this card from ${d.name}`}
              className="rounded-full px-1 text-space-400 hover:bg-space-700 hover:text-loss disabled:opacity-40"
            >
              ×
            </button>
          </span>
        ))}

        {creating ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  e.preventDefault();
                  apply(() => createDeckWithCardAction(cardId, name.trim()));
                  setName("");
                  setCreating(false);
                }
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="new deck name"
              className={`${select} w-40`}
            />
            <button
              onClick={() => {
                if (!name.trim()) return;
                apply(() => createDeckWithCardAction(cardId, name.trim()));
                setName("");
                setCreating(false);
              }}
              disabled={pending || !name.trim()}
              className="tap rounded-md bg-ki-500 px-2 py-1 text-xs font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50"
            >
              Create & add
            </button>
          </span>
        ) : (
          <select
            value=""
            disabled={pending}
            onChange={(e) => {
              if (e.target.value === NEW) {
                setCreating(true);
                return;
              }
              const id = Number(e.target.value);
              if (id) apply(() => addCardToDeckAction(cardId, id));
            }}
            className={`${select} ml-auto`}
          >
            <option value="">Add to deck…</option>
            {options.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.isBuilt ? " (built)" : ""}
              </option>
            ))}
            <option value={NEW}>＋ New deck…</option>
          </select>
        )}
      </div>
      {error ? <p className="mt-1 text-xs text-loss">{error}</p> : null}
    </div>
  );
}
