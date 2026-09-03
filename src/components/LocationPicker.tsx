"use client";

import { useState, useTransition } from "react";
import { addLocationAction } from "@/app/collection/actions";
import type { StorageLocation } from "@/lib/collection/locations";

const NEW = "__new";

/**
 * "Put these in…" on the add screens — one place for a whole batch, since a
 * box of cards being entered generally came out of, and goes back into, the
 * same box. Naming a new one here saves a trip to settings; unlike the
 * per-copy picker this only chooses, and the choice is applied on save.
 */
export function LocationPicker({
  locations,
  value,
  onChange,
  label = "Put these in",
  compact = false,
}: {
  locations: StorageLocation[];
  value: number | null;
  onChange: (locationId: number | null) => void;
  label?: string;
  compact?: boolean;
}) {
  const [known, setKnown] = useState(locations);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const select = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100";
  const options = known.filter((l) => !l.isArchived || l.id === value);

  const create = (name: string) => {
    setAdding(false);
    setDraft("");
    if (!name.trim()) return;
    start(async () => {
      setError(null);
      const r = await addLocationAction(name);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setKnown((k) => (k.some((l) => l.id === r.id) ? k : [...k, { id: r.id, name: r.name, note: null, isArchived: false, sortKey: 0, cards: 0, decks: 0 }]));
      onChange(r.id);
    });
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : "rounded-xl border border-space-700/70 bg-space-900/50 p-2"}`}>
      <label className="text-xs text-space-300">{label}</label>
      {adding ? (
        <>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                create(draft);
              }
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="box or binder name"
            className={`${select} min-w-0 flex-1`}
          />
          <button type="button" onClick={() => create(draft)} className="tap rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400">
            Add
          </button>
        </>
      ) : (
        <select
          value={value ?? ""}
          disabled={pending}
          onChange={(e) => {
            if (e.target.value === NEW) {
              setDraft("");
              setAdding(true);
              return;
            }
            onChange(e.target.value ? Number(e.target.value) : null);
          }}
          className={`${select} min-w-0 flex-1 disabled:opacity-50`}
        >
          <option value="">no location yet</option>
          {options.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.isArchived ? " (archived)" : ""}
            </option>
          ))}
          <option value={NEW}>somewhere new…</option>
        </select>
      )}
      {error ? <span className="text-[11px] text-loss">{error}</span> : null}
    </div>
  );
}
