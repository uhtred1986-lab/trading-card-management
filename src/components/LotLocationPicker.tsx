"use client";

import { useState, useTransition } from "react";
import { addLocationAction, setLotLocationAction } from "@/app/collection/actions";
import type { StorageLocation } from "@/lib/collection/locations";

const NEW = "__new";

/**
 * Where this particular card is kept, changeable in place. "somewhere new…"
 * names a box on the spot rather than sending you to settings first — you are
 * usually holding the card when you find out it needs one.
 */
export function LotLocationPicker({
  lotId,
  locationId,
  locations,
  compact = false,
}: {
  lotId: number;
  locationId: number | null;
  locations: StorageLocation[];
  compact?: boolean;
}) {
  const [value, setValue] = useState(locationId);
  const [known, setKnown] = useState(locations);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();

  // An archived box still shows while something is filed in it.
  const options = known.filter((l) => !l.isArchived || l.id === value);

  const save = (next: number | null) => {
    const previous = value;
    setValue(next);
    start(async () => {
      const r = await setLotLocationAction(lotId, next);
      if (!r.ok) setValue(previous);
    });
  };

  const create = (name: string) => {
    setAdding(false);
    setDraft("");
    if (!name.trim()) return;
    start(async () => {
      const r = await addLocationAction(name, [lotId]);
      if ("error" in r) return;
      setKnown((k) => (k.some((l) => l.id === r.id) ? k : [...k, { id: r.id, name: r.name, note: null, isArchived: false, sortKey: 0, cards: 0, decks: 0 }]));
      setValue(r.id);
    });
  };

  if (adding) {
    return (
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
        onBlur={() => (draft.trim() ? create(draft) : setAdding(false))}
        placeholder="box or binder name"
        className={`rounded border border-space-600 bg-space-900 px-1 py-0.5 text-[10px] text-space-100 ${compact ? "w-full" : "w-28"}`}
      />
    );
  }

  return (
    <select
      value={value ?? ""}
      disabled={pending}
      title="Where this copy is kept"
      onChange={(e) => {
        if (e.target.value === NEW) {
          setAdding(true);
          return;
        }
        save(e.target.value ? Number(e.target.value) : null);
      }}
      className={`rounded border border-transparent bg-space-800 px-1 py-0.5 text-[10px] hover:border-space-600 disabled:opacity-50 ${
        value ? "text-space-300" : "text-space-500"
      } ${compact ? "w-full min-w-0" : ""}`}
    >
      <option value="">not filed</option>
      {options.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
          {l.isArchived ? " (archived)" : ""}
        </option>
      ))}
      <option value={NEW}>somewhere new…</option>
    </select>
  );
}
