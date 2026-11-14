"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { buildDeckWithClaudeAction } from "@/app/decks/claude-actions";
import { buildDeckAction, searchLeadersAction, type LeaderChoice } from "@/app/leaders/actions";
import { GAME_INFO, parseGame, type Game } from "@/lib/catalog/games";
import { NEW_DECK_WITH_CLAUDE_LABELS_EN, type NewDeckWithClaudeLabels } from "@/lib/ai/games/labels";
import { CardImage } from "./CardImage";

/** A card a deck is built around, for a game without Leaders. */
export interface SeedCard {
  id: string;
  name: string;
  imageUrl?: string | null;
}

const DEFAULT_GAMES: readonly Game[] = ["dbs", "fusion"];

/**
 * Start a deck from a leader: search for one, and Claude drafts fifty cards
 * around it. Any leader in the catalog is offered, not only owned ones — the
 * deck you are building *towards* is exactly the case where you don't have it
 * yet, and the draft says which cards you'd need to buy.
 *
 * The draft takes a couple of minutes, so the button says so rather than
 * looking hung.
 *
 * Game-neutral. `games` are the games it offers (default: both Dragon Ball games, as always; a single
 * game fixes it). A game without a Leader (Pokémon) gets a wish box, a format and an optional seed card
 * instead of the Leader search: pass `seed`, or `renderSeedPicker` from a client parent (a function
 * cannot be passed from a server page). `labels` is the screen's language (English by default,
 * `NEW_DECK_WITH_CLAUDE_LABELS_DE` from `@/lib/ai/games/labels-de`), `deckHref` where the new deck
 * opens (`{id}` is the deck id).
 */
export function NewDeckWithClaude({
  enabled,
  games = DEFAULT_GAMES,
  labels = NEW_DECK_WITH_CLAUDE_LABELS_EN,
  seed,
  renderSeedPicker,
  deckHref = "/decks/{id}",
}: {
  enabled: boolean;
  games?: readonly Game[];
  labels?: NewDeckWithClaudeLabels;
  seed?: SeedCard | null;
  renderSeedPicker?: (onPick: (card: SeedCard) => void) => ReactNode;
  deckHref?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // One game fixes it; two or more are a choice (undefined: all of them).
  const [game, setGame] = useState<Game | undefined>(games.length === 1 ? games[0] : undefined);
  const wishMode = !GAME_INFO[games[0]].deck.leader;
  const formats = GAME_INFO[games[0]].deck.formats;
  const [format, setFormat] = useState<string>(formats[0] ?? "");
  const [wish, setWish] = useState("");
  const [seedPicked, setSeedPicked] = useState<SeedCard | null>(seed ?? null);
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
      catch { if (request === sequence.current) setError(labels.searchError); }
    }), 200);
  };

  const draft = () => {
    if (!picked) return;
    startDraft(async () => {
      setError(null);
      const r = await buildDeckAction(picked.id);
      if (r.ok) router.push(deckHref.replace("{id}", String(r.deckId)));
      else setError(r.error);
    });
  };

  const buildWithWish = () => {
    if (!seedPicked && !wish.trim()) {
      setError(labels.wishNeeded);
      return;
    }
    startDraft(async () => {
      setError(null);
      const r = await buildDeckWithClaudeAction(games[0], { seedCardId: seedPicked?.id ?? null, wish: wish.trim() || null, format: format || null });
      if (r.ok) router.push(deckHref.replace("{id}", String(r.deckId)));
      else setError(r.error);
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={!enabled}
        title={enabled ? labels.openTitle : labels.disabledTitle}
        className="tap rounded-md border border-ki-500/60 px-3 py-1.5 text-sm font-semibold text-ki-300 hover:bg-ki-500/10 disabled:opacity-50"
      >
        {labels.open}
      </button>
    );
  }

  const footnote = (
    <p className="mt-1 text-[11px] text-space-400">
      {labels.footnotePre}
      <span className="text-space-300">{labels.footnoteEmph}</span>
      {labels.footnotePost}
    </p>
  );

  return (
    <div className="w-full rounded-xl border border-ki-500/40 bg-ki-500/5 p-3 sm:w-96">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-space-50">{labels.heading}</span>
        <button onClick={() => setOpen(false)} className="rounded px-1 text-xs text-space-400 hover:text-space-100">
          {labels.close}
        </button>
      </div>

      {wishMode ? (
        <>
          {formats.length > 1 ? (
            <label className="mb-2 block min-w-0 text-xs text-space-300">
              {labels.formatLabel}
              <select value={format} onChange={(e) => setFormat(e.target.value)} className="tap w-full rounded-md border border-space-600 bg-space-900 px-2 text-sm">
                {formats.map((f) => (
                  <option key={f} value={f}>
                    {labels.formatNames[f] ?? f}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block text-xs text-space-300">
            {labels.wishLabel}
            <textarea value={wish} onChange={(e) => setWish(e.target.value)} rows={2} maxLength={500} placeholder={labels.wishPlaceholder} className="tap mt-1 w-full rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100" />
          </label>
          <div className="mt-2 text-xs text-space-300">
            {labels.seedLabel}:{" "}
            {seedPicked ? (
              <span className="text-space-100">
                {seedPicked.name}{" "}
                {seed ? null : (
                  <button type="button" onClick={() => setSeedPicked(null)} className="rounded px-1 text-xs text-space-400 hover:text-space-100">
                    {labels.seedChange}
                  </button>
                )}
              </span>
            ) : (
              <span className="text-space-400">{labels.seedNone}</span>
            )}
            {!seedPicked && renderSeedPicker ? <div className="mt-1">{renderSeedPicker(setSeedPicked)}</div> : null}
          </div>
          <button onClick={buildWithWish} disabled={drafting} className="tap mt-2 w-full rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50">
            {drafting ? labels.drafting : labels.build}
          </button>
          {footnote}
          {error ? <p className="mt-1 text-xs text-loss">{error}</p> : null}
        </>
      ) : (
        <>
          <div className="mb-2 grid grid-cols-2 gap-2">
            {games.length > 1 ? <label className="min-w-0 text-xs text-space-300">{labels.game}<select value={game ?? ""} onChange={(e) => {const g=parseGame(e.target.value);setGame(g);search(q,g ?? null,color);}} className="tap w-full rounded-md border border-space-600 bg-space-900 px-2 text-sm"><option value="">{labels.bothGames}</option>{games.map((g) => <option key={g} value={g}>{labels.gameNames[g] ?? GAME_INFO[g].short}</option>)}</select></label> : null}
            <label className={`min-w-0 text-xs text-space-300${games.length > 1 ? "" : " col-span-2"}`}>{labels.colour}<select value={color} onChange={(e) => {setColor(e.target.value);search(q,game,e.target.value);}} className="tap w-full rounded-md border border-space-600 bg-space-900 px-2 text-sm"><option value="">{labels.anyColour}</option>{["Red","Blue","Green","Yellow","Black","White","Colorless"].map((c) => <option key={c}>{c}</option>)}</select></label>
          </div>
          <input
            aria-label={labels.searchAria}
            autoFocus
            value={q}
            onChange={(e) => search(e.target.value)}
            placeholder={labels.searchPlaceholder}
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
                  {picked.id} · {GAME_INFO[picked.game].short} · {picked.colors.join("/")} · {picked.owned ? labels.youOwn.replace("{n}", String(picked.owned)) : labels.notOwned}
                </span>
                <Link href={`/cards/${encodeURIComponent(picked.id)}`} className="tap block text-sm text-ki-300">{labels.readAbilities}</Link>
              </div>
            </div>
          ) : (
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {searching ? <li className="px-1 py-2 text-xs text-space-400">{labels.searching}</li> : null}
              {!searching && q.trim().length >= 2 && hits.length === 0 ? <li className="px-1 py-2 text-xs text-space-400">{labels.noMatch}</li> : null}
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
                        {l.owned ? ` · ${labels.own.replace("{n}", String(l.owned))}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button onClick={draft} disabled={!picked || drafting} className="tap mt-2 w-full rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50">
            {drafting ? labels.drafting : picked ? labels.draft : labels.pickFirst}
          </button>
          {footnote}
          {error ? <p className="mt-1 text-xs text-loss">{error}</p> : null}
        </>
      )}
    </div>
  );
}
