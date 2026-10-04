"use client";

import { useState } from "react";

export interface ModelOption {
  /** What the form posts: `provider|model`. */
  value: string;
  label: string;
  /** Price and context, shown under the picker for the selected model. */
  detail: string;
}

/**
 * A searchable model picker: a search box narrows the list, the list is a
 * plain `<select>` so the phone gets its native picker. The chosen model's
 * price and context show underneath. Empty value = the default.
 */
export function ModelSelect({ name, options, defaultValue, defaultLabel }: { name: string; options: ModelOption[]; defaultValue: string; defaultLabel: string }) {
  const [q, setQ] = useState("");
  const [value, setValue] = useState(defaultValue);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = options.filter((o) => o.value === value || words.every((w) => o.label.toLowerCase().includes(w) || o.value.toLowerCase().includes(w)));
  const chosen = options.find((o) => o.value === value);
  return (
    <div className="space-y-1">
      {options.length > 6 ? (
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search models…"
          aria-label="Search models"
          className="tap w-full rounded-md border border-space-600 bg-space-800 px-2 py-1 text-xs text-space-100"
        />
      ) : null}
      <select name={name} value={value} onChange={(e) => setValue(e.target.value)} className="tap w-full rounded-md border border-space-600 bg-space-800 px-2 py-1 text-xs text-space-100">
        <option value="">{defaultLabel}</option>
        {shown.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {chosen ? <p className="text-[11px] text-space-300">{chosen.detail}</p> : null}
    </div>
  );
}
