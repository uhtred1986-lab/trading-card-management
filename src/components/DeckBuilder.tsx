"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { deckCardQuantity, searchCardsAction, setDeckCard } from "@/app/decks/actions";
import type { Zone } from "@/lib/decks/queries";
import { CardImage } from "./CardImage";
import { ColorPill } from "./ColorPill";

type Hit = Awaited<ReturnType<typeof searchCardsAction>>[number];

/** Search-and-add panel for the deck page. Leaders go to the leader slot automatically. */
export function DeckBuilder({ deckId }: { deckId: number }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [zone, setZone] = useState<Zone>("main");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced typeahead, driven from the change handler rather than an effect.
  const onQuery = (value: string) => {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => setHits(await searchCardsAction(value)), 150);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const add = (hit: Hit) =>
    start(async () => {
      const isLeader = /LEADER/.test(hit.cardType);
      const targetZone: Zone = isLeader ? "leader" : /^Z-/.test(hit.cardType) && zone === "main" ? "z" : zone;
      const current = targetZone === "leader" ? 0 : await deckCardQuantity(deckId, hit.id, targetZone);
      const r = await setDeckCard(deckId, hit.id, targetZone, current + 1);
      setMsg(r.ok ? `Added ${hit.name} → ${targetZone}` : `Blocked: short ${r.conflicts[0]?.short} × ${r.conflicts[0]?.name}`);
    });

  const select = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100";
  return (
    <div className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search name or number…"
          className={`${select} min-w-0 flex-1`}
          autoComplete="off"
        />
        <select value={zone} onChange={(e) => setZone(e.target.value as Zone)} className={select} aria-label="Add to zone">
          <option value="main">Main</option>
          <option value="z">Z-Deck</option>
          <option value="side">Side</option>
        </select>
      </div>
      {msg ? <p className="mt-1 text-xs text-space-300">{msg}</p> : null}
      <ul className={`mt-2 max-h-[60vh] space-y-1 overflow-y-auto ${pending ? "opacity-60" : ""}`}>
        {hits.map((h) => (
          <li key={h.id}>
            <button onClick={() => add(h)} className="flex w-full items-center gap-2 rounded-md p-1 text-left hover:bg-space-800">
              <div className="w-9 shrink-0">
                <CardImage src={h.imageUrl} alt={h.name} sizes="36px" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-space-50">{h.name}</div>
                <div className="flex flex-wrap items-center gap-1 text-[11px] text-space-300">
                  <span className="font-mono">{h.id}</span>
                  <span>· {h.cardType}</span>
                  {h.colors.map((c) => (
                    <ColorPill key={c} color={c} small />
                  ))}
                </div>
              </div>
              <span className="text-lg text-ki-400">+</span>
            </button>
          </li>
        ))}
        {q.trim().length >= 2 && hits.length === 0 ? <li className="p-2 text-xs text-space-300">No matches.</li> : null}
      </ul>
    </div>
  );
}
