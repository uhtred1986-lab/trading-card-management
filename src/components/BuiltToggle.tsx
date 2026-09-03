"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { setBuilt } from "@/app/decks/actions";
import type { BuildConflict, Reserver } from "@/lib/decks/reservations";
import type { FilingResult } from "@/lib/decks/filing";

/**
 * Mark a deck built (reserve its cards) or virtual (release them). Building is
 * blocked outright when the collection can't cover it, and the exact shortfall
 * is listed so it doubles as a shopping list. `reservers` names which other
 * built decks hold the copies counted in `reservedElsewhere`, so a shortfall
 * caused by another deck can be solved by breaking that deck up instead of
 * buying.
 */
export function BuiltToggle({
  deckId,
  isBuilt,
  initialConflicts,
  reservers,
}: {
  deckId: number;
  isBuilt: boolean;
  initialConflicts: BuildConflict[];
  reservers: Record<string, Reserver[]>;
}) {
  const [pending, start] = useTransition();
  const [conflicts, setConflicts] = useState<BuildConflict[]>(initialConflicts);
  const [filing, setFiling] = useState<FilingResult | null>(null);
  const blocked = !isBuilt && conflicts.length > 0;

  const toggle = () =>
    start(async () => {
      const r = await setBuilt(deckId, !isBuilt);
      setConflicts(r.ok ? [] : r.conflicts);
      setFiling(r.ok ? r.filing : null);
    });

  return (
    <div className="space-y-2">
      <button
        onClick={toggle}
        disabled={pending || blocked}
        className={`tap rounded-md px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
          isBuilt ? "border border-space-600 text-space-100 hover:bg-space-800" : "bg-ki-500 text-space-950 hover:bg-ki-400"
        }`}
      >
        {pending ? "…" : isBuilt ? "Un-build (release cards)" : blocked ? "Can't build — missing cards" : "Mark as built"}
      </button>
      {filing?.filed ? (
        <p className="text-xs text-gain">
          Filed {filing.filed} {filing.filed === 1 ? "copy" : "copies"} in {filing.locationName ?? "the deck’s location"}.
        </p>
      ) : null}
      {blocked ? (
        <div className="rounded-xl border border-loss/40 bg-loss/5 p-2 text-xs">
          <div className="mb-1 flex items-center gap-2 font-semibold text-loss">
            You don&apos;t own enough copies of:
            <Link href={`/cart?deck=${deckId}`} className="ml-auto rounded border border-space-600 px-2 py-0.5 text-[11px] font-medium text-space-100 hover:bg-space-800">
              Buy missing cards →
            </Link>
          </div>
          <ul className="space-y-0.5">
            {conflicts.map((c) => {
              const holders = reservers[c.cardId] ?? [];
              return (
                <li key={c.cardId} className="flex flex-wrap items-baseline gap-x-2 text-space-200">
                  <Link href={`/cards/${encodeURIComponent(c.cardId)}`} className="font-medium text-space-50 hover:text-ki-300">
                    {c.name}
                  </Link>
                  <span className="font-mono text-space-400">{c.cardId}</span>
                  <span className="ml-auto">
                    need {c.needed} · own {c.owned}
                    {c.reservedElsewhere ? ` · ${c.reservedElsewhere} used elsewhere` : ""} · <span className="font-semibold text-loss">short {c.short}</span>
                  </span>
                  {holders.length ? (
                    <span className="w-full text-[11px] text-space-300">
                      Used by{" "}
                      {holders.map((h, i) => (
                        <span key={h.id}>
                          {i > 0 ? ", " : ""}
                          <Link href={`/decks/${h.id}`} className="underline hover:text-ki-300">
                            {h.name}
                          </Link>{" "}
                          ({h.quantity})
                        </span>
                      ))}
                      &nbsp;— buy more, or break one of those up to free copies.
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
