"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { buildDeckAction, searchLeadersAction, type LeaderChoice } from "@/app/leaders/actions";
import { GAME_INFO, parseGame, type Game } from "@/lib/catalog/games";
import { CardImage } from "./CardImage";

/**
 * Start a deck from a leader: search for one, and Claude drafts fifty cards
 * around it. Any leader in the catalog is offered, not only owned ones — the
 * deck you are building *towards* is exactly the case where you don't have it
 * yet, and the draft says which cards you'd need to buy.
 *
 * The draft takes a couple of minutes, so the button says so rather than
 * looking hung.
 */
export function NewDeckWithClaude({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [game, setGame] = useState<Game | undefined>();
  const [color, setColor] = useState("");
  const sequence = useRef(0);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LeaderChoice[]>([]);
  const [picked, setPicked] = useState<LeaderChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [drafting, startDraft] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); sequence.current++; }, []);

  const search = (next: string, nextGame: Game | null | undefined = game, nextColor = color) => {
    const request = ++sequence.current;
    setError(null);
    setHits([]);
    setQ(next);
    setPicked(null);
    if (timer.current) clearTimeout(timer.current);
    if (next.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(() => startSearch(async () => {
      try { const result = await searchLeadersAction(next, nextGame ?? undefined, nextColor); if (request === sequence.current) setHits(result); }
      catch { if (request === sequence.current) setError("Could not search leaders. Try again."); }
    }), 200);
  };

  const draft = () => {
    if (!picked) return;
    startDraft(async () => {
      setError(null);
      const r = await buildDeckAction(picked.id);
      if (r.ok) router.push(`/decks/${r.deckId}`);
      else setError(r.error);
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={!enabled}
        title={enabled ? "Pick a leader and Claude drafts a deck around it" : "Set ANTHROPIC_API_KEY"}
        className="tap rounded-md border border-ki-500/60 px-3 py-1.5 text-sm font-semibold text-ki-300 hover:bg-ki-500/10 disabled:opacity-50"
      >
        ✦ Deck from a leader
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-ki-500/40 bg-ki-500/5 p-3 sm:w-96">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-space-50">Deck from a leader</span>
        <button onClick={() => setOpen(false)} className="rounded px-1 text-xs text-space-400 hover:text-space-100">
          close
        </button>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="min-w-0 text-xs text-space-300">Game<select value={game ?? ""} onChange={(e) => {const g=parseGame(e.target.value);setGame(g);search(q,g ?? null,color);}} className="tap w-full rounded-md border border-space-600 bg-space-900 px-2 text-sm"><option value="">Both games</option><option value="dbs">Masters</option><option value="fusion">Fusion World</option></select></label>
        <label className="min-w-0 text-xs text-space-300">Colour<select value={color} onChange={(e) => {setColor(e.target.value);search(q,game,e.target.value);}} className="tap w-full rounded-md border border-space-600 bg-space-900 px-2 text-sm"><option value="">Any colour</option>{["Red","Blue","Green","Yellow","Black","White","Colorless"].map((c) => <option key={c}>{c}</option>)}</select></label>
      </div>
      <input
        aria-label="Search leaders for a new deck"
        autoFocus
        value={q}
        onChange={(e) => search(e.target.value)}
        placeholder="Leader name or number, e.g. Bardock"
        className="tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100"
      />

      {picked ? (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-space-900/70 p-2">
          <div className="w-10 shrink-0">
            <CardImage src={picked.imageUrl} alt={picked.name} sizes="40px" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block break-words text-sm font-medium text-space-50">{picked.name}</span>
            <span className="text-[11px] text-space-400">
              {/* The leader decides the game, so the draft's rules follow from this pick. */}
              {picked.id} · {GAME_INFO[picked.game].short} · {picked.colors.join("/")} · {picked.owned ? `you own ${picked.owned}` : "not in your collection"}
            </span>
            <Link href={`/cards/${encodeURIComponent(picked.id)}`} className="tap block text-sm text-ki-300">Read leader abilities</Link>
          </div>
        </div>
      ) : (
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {searching ? <li className="px-1 py-2 text-xs text-space-400">Searching…</li> : null}
          {!searching && q.trim().length >= 2 && hits.length === 0 ? <li className="px-1 py-2 text-xs text-space-400">No leader matches that.</li> : null}
          {hits.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => setPicked(l)} className="tap flex w-full items-center gap-2 rounded-md p-1 text-left hover:bg-space-800">
                <div className="w-8 shrink-0">
                  <CardImage src={l.imageUrl} alt={l.name} sizes="32px" />
                </div>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm text-space-100">{l.name}</span>
                  <span className="text-[11px] text-space-400">
                    {l.id} · {l.colors.join("/")}
                    {l.game !== "dbs" ? ` · ${GAME_INFO[l.game].short}` : ""}
                    {l.owned ? ` · own ${l.owned}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button onClick={draft} disabled={!picked || drafting} className="tap mt-2 w-full rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50">
        {drafting ? "Drafting… (a minute or two)" : picked ? "Draft a deck with Claude" : "Pick a leader first"}
      </button>
      <p className="mt-1 text-[11px] text-space-400">
        Creates a <span className="text-space-300">virtual</span> deck, preferring cards you own and listing anything you&apos;d need to buy.
      </p>
      {error ? <p className="mt-1 text-xs text-loss">{error}</p> : null}
    </div>
  );
}
