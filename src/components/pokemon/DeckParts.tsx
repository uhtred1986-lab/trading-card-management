"use client";

import { useState } from "react";
import { PK } from "@/lib/pokemon/copy";

/** A small card picture (a deck row, the new-deck screen). A card with no picture, or one that does not load, shows its name. */
export function MiniArt({ src, name, label }: { src: string | null; name: string; label?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = src && failed !== src ? src : null;
  return (
    <div className="pk-mini">
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={show} alt={label ?? name} loading="lazy" decoding="async" width={245} height={342} onError={() => setFailed(show)} />
      ) : (
        <div className="pk-noimg" role="img" aria-label={`${PK.common.noImage}: ${name}`}>
          {name}
        </div>
      )}
    </div>
  );
}

/** Legal / Unfertig / Nicht legal. Colour and word: the word carries the meaning. */
export function StatusPill({ status }: { status: "legal" | "incomplete" | "illegal" }) {
  return (
    <span className="pk-pillstate" data-state={status} aria-label={PK.decks.statusAria(PK.decks.status[status])}>
      {PK.decks.status[status]}
    </span>
  );
}
