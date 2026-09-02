"use client";

import { useState } from "react";
import { createDeckAction } from "@/app/decks/actions";
import type { DeckOption } from "@/lib/decks/add";

/**
 * "Also add to deck" control shared by every add path. "New deck…" creates the
 * deck immediately so the caller only ever deals with a deck id. Renders a
 * hidden `deckId` input so it also works inside a plain <form action>.
 */
export function DeckPicker({
  decks: initialDecks,
  value: controlled,
  onChange: onChangeProp,
  name = "deckId",
  compact = false,
}: {
  decks: DeckOption[];
  /** Omit both `value` and `onChange` to let the picker keep its own state (plain <form> use). */
  value?: number | null;
  onChange?: (deckId: number | null, deck: DeckOption | null) => void;
  name?: string;
  compact?: boolean;
}) {
  const [internal, setInternal] = useState<number | null>(null);
  const value = controlled === undefined ? internal : controlled;
  const onChange = (id: number | null, deck: DeckOption | null) => {
    setInternal(id);
    onChangeProp?.(id, deck);
  };
  const [decks, setDecks] = useState(initialDecks);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const select = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100";

  const create = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const deck = await createDeckAction(trimmed);
      setDecks((d) => [...d, deck].sort((a, b) => a.name.localeCompare(b.name)));
      onChange(deck.id, deck);
      setCreating(false);
      setNewName("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : "rounded-xl border border-space-700/70 bg-space-900/50 p-2"}`}>
      <input type="hidden" name={name} value={value ?? ""} />
      <label className="text-xs text-space-300">Also add to deck</label>
      {creating ? (
        <>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="New deck name"
            className={`${select} min-w-0 flex-1`}
          />
          <button type="button" onClick={create} disabled={busy || !newName.trim()} className="tap rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50">
            {busy ? "…" : "Create"}
          </button>
          <button type="button" onClick={() => setCreating(false)} className="tap rounded-md px-2 py-1.5 text-xs text-space-400 hover:text-space-50">
            cancel
          </button>
        </>
      ) : (
        <select
          value={value ?? ""}
          onChange={(e) => {
            if (e.target.value === "__new") {
              setCreating(true);
              return;
            }
            const id = e.target.value ? Number(e.target.value) : null;
            onChange(id, decks.find((d) => d.id === id) ?? null);
          }}
          className={`${select} min-w-0 flex-1`}
        >
          <option value="">No deck — collection only</option>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.isBuilt ? " (built)" : ""}
            </option>
          ))}
          <option value="__new">＋ New deck…</option>
        </select>
      )}
    </div>
  );
}
