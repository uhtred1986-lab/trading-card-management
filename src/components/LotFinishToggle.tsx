"use client";

import { useState, useTransition } from "react";
import { setLotFinishAction } from "@/app/collection/actions";

/**
 * Per-lot foil tick on the card page. Flips optimistically so it feels
 * instant, and puts itself back if the write fails — the collection totals
 * and the lot's value follow from the server revalidation.
 */
export function LotFinishToggle({ lotId, foil }: { lotId: number; foil: boolean }) {
  const [on, setOn] = useState(foil);
  const [pending, start] = useTransition();

  const toggle = (next: boolean) => {
    setOn(next);
    start(async () => {
      const r = await setLotFinishAction(lotId, next);
      if (!r.ok) setOn(!next);
    });
  };

  return (
    <label
      className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors ${
        on ? "bg-amber-300/15 text-amber-300" : "text-space-300 hover:bg-space-800"
      } ${pending ? "opacity-60" : ""}`}
      title={on ? "Foil — untick to make this lot non-foil" : "Tick to mark this lot foil"}
    >
      <input type="checkbox" checked={on} disabled={pending} onChange={(e) => toggle(e.target.checked)} className="h-3.5 w-3.5 accent-amber-400" />
      {on ? "✦ Foil" : "Non-foil"}
    </label>
  );
}
