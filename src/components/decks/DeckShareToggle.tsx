"use client";

import { useState, useTransition } from "react";
import { setDeckShareableAction } from "@/app/decks/actions";

/** "A friend I invite may play this deck" — saved on the tap, not with the form. */
export function DeckShareToggle({ deckId, shareable }: { deckId: number; shareable: boolean }) {
  const [on, setOn] = useState(shareable);
  const [pending, start] = useTransition();
  return (
    <label className="flex min-h-11 items-start gap-2 text-xs text-space-300">
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const next = e.currentTarget.checked;
          setOn(next);
          start(async () => {
            await setDeckShareableAction(deckId, next).catch(() => setOn(!next));
          });
        }}
        className="mt-0.5 h-4 w-4 accent-ki-500"
        data-deck-shareable
      />
      <span>
        Friends I invite can play this deck
        <span className="block text-space-400">Only in a 1 v 1 you host; they can&apos;t see or change the list.</span>
      </span>
    </label>
  );
}
