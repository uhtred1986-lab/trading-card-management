"use client";

import { useState, useTransition } from "react";
import { setDeckLocationAction } from "@/app/decks/actions";
import type { StorageLocation } from "@/lib/collection/locations";
import type { FilingResult } from "@/lib/decks/filing";

/**
 * Where the deck is kept. Saves as soon as you pick, and says what that did to
 * the collection — filing a *built* deck moves every card in it to the same
 * place, which is worth seeing confirmed rather than guessing at.
 *
 * Controlled, deliberately: React re-applies `defaultValue` to an uncontrolled
 * select on every re-render, so a pick could be snapped back to the old value
 * before it was ever saved.
 */
export function DeckLocationPicker({
  deckId,
  locationId,
  locations,
  isBuilt,
}: {
  deckId: number;
  locationId: number | null;
  locations: StorageLocation[];
  isBuilt: boolean;
}) {
  const [value, setValue] = useState<number | null>(locationId);
  const [result, setResult] = useState<FilingResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  // An archived place still shows while this deck is filed in it.
  const options = locations.filter((l) => !l.isArchived || l.id === value);

  const save = (next: number | null) => {
    const previous = value;
    setValue(next);
    setResult(null);
    setFailed(false);
    start(async () => {
      try {
        setResult(await setDeckLocationAction(deckId, next));
      } catch {
        setValue(previous);
        setFailed(true);
      }
    });
  };

  return (
    <div className="space-y-1">
      <label className="block text-xs text-space-300">
        Kept in
        <select
          value={value ?? ""}
          disabled={pending}
          onChange={(e) => save(e.target.value ? Number(e.target.value) : null)}
          className="tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100 disabled:opacity-50"
        >
          <option value="">Nowhere in particular</option>
          {options.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.isArchived ? " (archived)" : ""}
            </option>
          ))}
        </select>
      </label>
      {failed ? <p className="text-[11px] text-loss">Couldn&apos;t save that — try again.</p> : null}
      {pending ? <p className="text-[11px] text-space-400">Saving…</p> : null}
      {!pending && result ? (
        <p className="text-[11px] text-gain">
          {result.filed
            ? `Saved — ${result.filed} ${result.filed === 1 ? "copy" : "copies"} moved to ${result.locationName}.`
            : value == null
              ? "Saved."
              : isBuilt
                ? "Saved — every card in the deck was already there."
                : "Saved. Cards move here when you mark the deck built."}
        </p>
      ) : null}
      {!result && !pending && value != null && !isBuilt ? (
        <p className="text-[11px] text-space-400">Cards move here when you mark the deck built.</p>
      ) : null}
    </div>
  );
}
