"use client";

import { useState, useTransition } from "react";
import { setLotPrintAction } from "@/app/collection/actions";

export interface PrintOption {
  id: string;
  label: string;
  rarity: string;
}

/**
 * Which print this copy actually is, changeable in place.
 *
 * The print is the most easily mistaken field on a lot: the numbers differ only
 * by a suffix, the cards often differ only by their foiling, and you usually
 * find out which one you are holding *after* it is already in the collection.
 * It is also what the copy is valued at, so getting it wrong misprices the
 * shelf quietly.
 *
 * The rarity is in the option text rather than the label alone, because
 * "Special Rare" and "SPR" are how the same thing gets said in different
 * places, and the one you remember is whichever is printed on the card.
 */
export function LotPrintPicker({
  lotId,
  printId,
  prints,
  compact = false,
}: {
  lotId: number;
  printId: string;
  prints: PrintOption[];
  compact?: boolean;
}) {
  const [value, setValue] = useState(printId);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // A card with one print has nothing to choose; show it and stay out of the way.
  if (prints.length < 2) {
    return <span className="text-space-200">{prints[0]?.label ?? printId}</span>;
  }

  const save = (next: string) => {
    if (next === value) return;
    const previous = value;
    setValue(next);
    setError(null);
    start(async () => {
      const r = await setLotPrintAction(lotId, next);
      if (!r.ok) {
        setValue(previous);
        setError(r.error ?? "Could not change the print.");
      }
    });
  };

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={value}
        disabled={pending}
        title={error ?? "Which print this copy is"}
        aria-label="Print"
        onChange={(e) => save(e.target.value)}
        className={`tap rounded border bg-space-800 px-1 py-0.5 text-[11px] text-space-100 hover:border-space-600 disabled:opacity-50 ${
          error ? "border-loss" : "border-transparent"
        } ${compact ? "w-full min-w-0" : ""}`}
      >
        {prints.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label} · {p.rarity}
          </option>
        ))}
      </select>
      {error ? <span className="text-[10px] text-loss">{error}</span> : null}
    </span>
  );
}
