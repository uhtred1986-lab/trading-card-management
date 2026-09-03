"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { addCopyAction, assignToDeckAction, copiesForCardAction, removeCopyAction, setCopyFinishAction, type CopyRow } from "@/app/collection/actions";
import type { DeckOption } from "@/lib/decks/add";

/**
 * The ×N badge on a collection tile, opened. Because every physical card is
 * its own row, this can list them individually: tick one as foil, drop one,
 * add one, or send the card to a deck — without leaving the grid.
 */
export function CopiesPopover({
  cardId,
  name,
  ownedQty,
  foilQty,
  decks,
}: {
  cardId: string;
  name: string;
  ownedQty: number;
  foilQty: number;
  decks: DeckOption[];
}) {
  const [open, setOpen] = useState(false);
  const [copies, setCopies] = useState<CopyRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    setNote(null);
    // Copies are fetched on demand — the grid stays light with hundreds of tiles.
    if (next && copies === null) start(async () => setCopies(await copiesForCardAction(cardId)));
  };

  const run = (fn: () => Promise<CopyRow[]>, message?: string) =>
    start(async () => {
      setCopies(await fn());
      if (message) setNote(message);
    });

  const shownFoil = copies ? copies.filter((c) => c.finish === "foil").length : foilQty;
  const shownTotal = copies ? copies.length : ownedQty;

  return (
    <div ref={box} className="relative">
      <button
        onClick={toggle}
        aria-expanded={open}
        title={`${ownedQty} owned${foilQty ? `, ${foilQty} foil` : ""} — click to edit copies`}
        className="flex items-center gap-1 rounded-md bg-ki-500 px-1.5 py-0.5 text-xs font-bold text-space-950 shadow hover:bg-ki-400"
      >
        ×{shownTotal}
        {shownFoil ? <span className="rounded bg-amber-200/90 px-1 text-[10px]">✦{shownFoil}</span> : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-7 z-40 w-64 max-w-[80vw] space-y-2 rounded-xl border border-space-600 bg-space-950 p-2 text-left shadow-xl">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs font-semibold text-space-100">{name}</span>
            <span className="shrink-0 font-mono text-[10px] text-space-400">{cardId}</span>
          </div>

          {copies === null ? (
            <p className="py-2 text-center text-xs text-space-400">Loading copies…</p>
          ) : copies.length === 0 ? (
            <p className="py-1 text-xs text-space-400">No copies left.</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {copies.map((c, i) => (
                <li key={c.id} className="flex items-center gap-1.5 rounded bg-space-900/70 px-1.5 py-1 text-xs">
                  <span className="w-4 shrink-0 font-mono text-[10px] text-space-500">#{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-space-200" title={`${c.printLabel} · ${c.condition} · ${c.language}`}>
                    {c.printLabel} · {c.condition}
                  </span>
                  <label
                    className={`flex cursor-pointer items-center gap-1 rounded px-1 ${c.finish === "foil" ? "text-amber-300" : "text-space-400"}`}
                    title={c.finish === "foil" ? "Foil — untick for non-foil" : "Tick to mark foil"}
                  >
                    <input
                      type="checkbox"
                      checked={c.finish === "foil"}
                      disabled={pending}
                      onChange={(e) => run(() => setCopyFinishAction(c.id, e.target.checked, cardId))}
                      className="h-3 w-3 accent-amber-400"
                    />
                    ✦
                  </label>
                  <button
                    onClick={() => run(() => removeCopyAction(c.id, cardId), "Copy removed.")}
                    disabled={pending}
                    title="Remove this copy"
                    className="rounded px-1 text-space-500 hover:bg-space-800 hover:text-loss disabled:opacity-40"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-1">
            <button
              onClick={() => run(() => addCopyAction(cardId), "Copy added.")}
              disabled={pending}
              className="tap flex-1 rounded-md border border-space-600 px-2 py-1 text-xs text-space-100 hover:bg-space-800 disabled:opacity-40"
            >
              + Add copy
            </button>
            <Link href={`/cards/${encodeURIComponent(cardId)}`} className="tap rounded-md border border-space-600 px-2 py-1 text-xs text-space-300 hover:bg-space-800">
              Details
            </Link>
          </div>

          <select
            value=""
            disabled={pending || decks.length === 0}
            onChange={(e) => {
              const deckId = Number(e.target.value);
              if (!deckId) return;
              const deck = decks.find((d) => d.id === deckId);
              start(async () => {
                await assignToDeckAction(cardId, deckId, 1);
                setNote(`Added to ${deck?.name ?? "deck"}.`);
              });
            }}
            className="tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-1 text-xs text-space-100 disabled:opacity-40"
          >
            <option value="">{decks.length ? "Assign to deck…" : "No decks yet"}</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.isBuilt ? " (built)" : ""}
              </option>
            ))}
          </select>

          {note ? <p className="text-[11px] text-gain">{note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
