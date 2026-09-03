"use client";

import { useRef, useState, useTransition } from "react";
import { setLotOwnerAction } from "@/app/collection/actions";

const NEW = "__new";

/**
 * Who this particular card belongs to, changeable in place on the card page.
 * The list is whoever already owns something, plus you; "someone else…" opens
 * a field for a name that isn't in the list yet.
 */
export function LotOwnerPicker({ lotId, owner, known }: { lotId: number; owner: string | null; known: string[] }) {
  const [value, setValue] = useState(owner);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const field = useRef<HTMLInputElement>(null);

  const options = [...new Set([...known, ...(value ? [value] : [])])].sort((a, b) => a.localeCompare(b));

  const save = (next: string | null) => {
    const previous = value;
    setValue(next);
    setAdding(false);
    setDraft("");
    start(async () => {
      const r = await setLotOwnerAction(lotId, next);
      if (!r.ok) setValue(previous);
    });
  };

  if (adding) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={field}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save(draft.trim() || null);
            }
            if (e.key === "Escape") setAdding(false);
          }}
          onBlur={() => (draft.trim() ? save(draft.trim()) : setAdding(false))}
          placeholder="owner name"
          className="w-24 rounded border border-space-600 bg-space-900 px-1 py-0.5 text-[10px] text-space-100"
        />
      </span>
    );
  }

  return (
    <select
      value={value ?? ""}
      disabled={pending}
      title="Who this copy belongs to"
      onChange={(e) => {
        if (e.target.value === NEW) {
          setAdding(true);
          return;
        }
        save(e.target.value || null);
      }}
      className={`rounded border border-transparent bg-space-800 px-1 py-0.5 text-[10px] hover:border-space-600 disabled:opacity-50 ${
        value ? "text-space-300" : "text-space-500"
      }`}
    >
      <option value="">no owner</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      <option value={NEW}>someone else…</option>
    </select>
  );
}
