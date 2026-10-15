"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { deckCardQuantity, searchCardsAction, setDeckCard } from "@/app/decks/actions";
import { deckRules, type Game } from "@/lib/catalog/games";
import type { Zone } from "@/lib/decks/queries";
import { CardImage } from "./CardImage";
import { ColorPill } from "./ColorPill";

type Hit = Awaited<ReturnType<typeof searchCardsAction>>[number];

/**
 * Search-and-add panel for the deck page. Leaders go to the leader slot
 * automatically, and the search only ever returns cards from the deck's own
 * game — a Fusion World deck should not be able to find a Masters card by
 * accident.
 */
export function DeckBuilder({ deckId, game }: { deckId: number; game: Game }) {
  const rules = deckRules(game);
  const [cardType, setCardType] = useState("");
  const [color, setColor] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const sequence = useRef(0);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [zone, setZone] = useState<Zone>("main");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Invalidate in-flight responses as soon as the query or filters change.
  const onQuery = (value: string, type = cardType, colour = color) => {
    setQ(value);
    const request = ++sequence.current;
    if (timer.current) clearTimeout(timer.current);
    setHits([]);
    setSearchError(null);
    setSearching(value.trim().length >= 2);
    if (value.trim().length < 2) return;
    timer.current = setTimeout(async () => {
      try {
        const found = await searchCardsAction(value, game, type, colour);
        if (request === sequence.current) setHits(found);
      } catch {
        if (request === sequence.current) setSearchError("Could not search cards. Try again.");
      } finally { if (request === sequence.current) setSearching(false); }
    }, 150);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); sequence.current++; }, []);

  const add = (hit: Hit) =>
    start(async () => {
      const isLeader = hit.cardType === "LEADER";
      const targetZone: Zone = isLeader ? "leader" : /^Z-/.test(hit.cardType) && zone === "main" && rules.zMax > 0 ? "z" : zone;
      const current = targetZone === "leader" ? 0 : await deckCardQuantity(deckId, hit.id, targetZone);
      const r = await setDeckCard(deckId, hit.id, targetZone, current + 1);
      setMsg(r.ok ? `Added ${hit.name} → ${targetZone}` : `Blocked: short ${r.conflicts[0]?.short} × ${r.conflicts[0]?.name}`);
    });

  const select = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100";
  return (
    <div className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
      <p className="mb-2 text-sm font-semibold text-space-100">Add cards or choose a leader</p>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="min-w-0 text-xs text-space-300">Card type<select value={cardType} onChange={(e) => {setCardType(e.target.value);onQuery(q,e.target.value,color);}} className={`${select} w-full`}><option value="">Any type</option>{["LEADER","BATTLE","EXTRA",...(rules.zMax ? ["UNISON","Z-LEADER","Z-BATTLE","Z-EXTRA","Z-UNISON"] : [])].map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="min-w-0 text-xs text-space-300">Colour<select value={color} onChange={(e) => {setColor(e.target.value);onQuery(q,cardType,e.target.value);}} className={`${select} w-full`}><option value="">Any colour</option>{["Red","Blue","Green","Yellow","Black","White","Colorless"].map((c) => <option key={c}>{c}</option>)}</select></label>
      </div>
      <div className="flex gap-2">
        <input aria-label="Search cards to add" value={q} onChange={(e) => onQuery(e.target.value)} placeholder="Search name or number…" className={`${select} min-w-0 flex-1`} autoComplete="off" />
        <select value={zone} onChange={(e) => setZone(e.target.value as Zone)} className={select} aria-label="Add to zone">
          <option value="main">Main</option>
          {rules.zMax > 0 ? <option value="z">Z-Deck</option> : null}
          <option value="side">Side</option>
        </select>
      </div>
      <p className="mt-2 text-xs text-space-400">Choose LEADER to narrow the search. Adding a leader replaces the current leader; other cards go to the chosen zone. Filters apply before the first 15 results.</p>
      {searching && <p role="status" className="text-sm text-space-300">Searching…</p>}
      {searchError && <p role="alert" className="text-sm text-loss">{searchError}</p>}
      {msg ? <p className="mt-1 text-xs text-space-300">{msg}</p> : null}
      <ul className={`mt-2 max-h-[60vh] space-y-1 overflow-y-auto ${pending ? "opacity-60" : ""}`}>
        {hits.map((h) => (
          <li key={h.id}>
            <button type="button" disabled={pending} onClick={() => add(h)} className="tap flex w-full items-center gap-2 rounded-md p-1 text-left hover:bg-space-800">
              <div className="w-9 shrink-0">
                <CardImage src={h.imageUrl} alt={h.name} sizes="36px" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="break-words text-sm font-medium text-space-50">{h.name}</div>
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
        {q.trim().length >= 2 && !searching && !searchError && hits.length === 0 ? <li className="p-2 text-xs text-space-300">No matches.</li> : null}
      </ul>
    </div>
  );
}
