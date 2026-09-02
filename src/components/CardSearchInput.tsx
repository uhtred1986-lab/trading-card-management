"use client";

import { useEffect, useRef, useState } from "react";
import { searchCardsAction } from "@/app/decks/actions";

export type CardHit = Awaited<ReturnType<typeof searchCardsAction>>[number];

/**
 * Catalog typeahead shared by bulk entry and the scan review. Accepts a name
 * or a card number (BT18-020, bt18020…); ↑/↓ + Enter picks, Esc closes.
 * `initialQuery` pre-fills and searches immediately so linking a card the
 * scanner read but could not match is one click away.
 */
export function CardSearchInput({
  onPick,
  autoFocus = false,
  initialQuery = "",
  placeholder = "Name or number, e.g. BT18-020",
  className = "",
}: {
  onPick: (hit: CardHit) => void;
  autoFocus?: boolean;
  initialQuery?: string;
  placeholder?: string;
  className?: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [hits, setHits] = useState<CardHit[]>([]);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (initialQuery.trim().length < 2) return;
    let live = true;
    searchCardsAction(initialQuery).then((h) => {
      if (!live) return;
      setHits(h);
      setOpen(true);
    });
    return () => {
      live = false;
    };
  }, [initialQuery]);

  const onQuery = (v: string) => {
    setQ(v);
    setSel(0);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 2) return setHits([]);
    timer.current = setTimeout(async () => {
      setHits(await searchCardsAction(v));
      setOpen(true);
    }, 120);
  };

  const pick = (h: CardHit) => {
    onPick(h);
    setQ("");
    setHits([]);
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <input
        ref={ref}
        value={q}
        onChange={(e) => onQuery(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setSel((s) => Math.min(hits.length - 1, s + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(0, s - 1));
          } else if (e.key === "Enter" && open && hits[sel]) {
            e.preventDefault();
            pick(hits[sel]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className="tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-1 text-sm text-space-100"
        autoComplete="off"
      />
      {open && hits.length ? (
        <ul className="absolute z-20 mt-1 max-h-64 w-full min-w-[16rem] overflow-y-auto rounded-md border border-space-600 bg-space-950 shadow-lg">
          {hits.map((h, i) => (
            <li key={h.id}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(h);
                }}
                className={`flex w-full items-center gap-2 px-2 py-1 text-left ${i === sel ? "bg-space-800" : "hover:bg-space-900"}`}
              >
                <span className="w-20 shrink-0 font-mono text-xs text-space-300">{h.id}</span>
                <span className="truncate text-sm text-space-50">{h.name}</span>
                <span className="ml-auto text-[10px] text-space-400">{h.rarityCode}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : open && q.trim().length >= 2 && !hits.length ? (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-space-700 bg-space-950 px-2 py-1 text-xs text-space-400">No cards match.</div>
      ) : null}
    </div>
  );
}
