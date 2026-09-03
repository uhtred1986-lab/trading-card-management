"use client";

import { useState } from "react";

const NEW = "__new";

/**
 * "These cards belong to…" on the add screens, for when you are entering
 * someone else's cards. Defaults to your own owner name, so the common case
 * costs nothing.
 */
export function OwnerPicker({
  owners,
  value,
  onChange,
  label = "Owner",
  compact = false,
}: {
  owners: string[];
  value: string | null;
  onChange: (owner: string | null) => void;
  label?: string;
  compact?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const select = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100";
  const options = [...new Set([...owners, ...(value ? [value] : [])])].sort((a, b) => a.localeCompare(b));

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
                onChange(draft.trim() || null);
                setAdding(false);
              }
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="owner name"
            className={`${select} min-w-0 flex-1`}
          />
          <button
            type="button"
            onClick={() => {
              onChange(draft.trim() || null);
              setAdding(false);
            }}
            className="tap rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400"
          >
            Use
          </button>
        </>
      ) : (
        <select
          value={value ?? ""}
          onChange={(e) => {
            if (e.target.value === NEW) {
              setDraft("");
              setAdding(true);
              return;
            }
            onChange(e.target.value || null);
          }}
          className={`${select} min-w-0 flex-1`}
        >
          <option value="">no owner recorded</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value={NEW}>someone else…</option>
        </select>
      )}
    </div>
  );
}
