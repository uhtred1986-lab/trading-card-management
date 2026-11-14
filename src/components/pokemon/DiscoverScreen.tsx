"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addPokemonToDeckAction } from "@/app/pokemon/actions";
import { PK } from "@/lib/pokemon/copy";
import { TYPE_CHIPS, tileFromHit, type PokemonTile } from "@/lib/pokemon/client";
import type { PokemonSetInfo } from "@/lib/pokemon/tcgdex";
import type { PokemonHit } from "@/lib/pokemon/types";
import type { PokemonDeckRow } from "@/lib/pokemon/views";
import { PageTop } from "./PageTop";
import { PokemonTileCard, SkeletonGrid } from "./PokemonTileCard";
import { PokemonViewer } from "./PokemonViewer";
import { CloseIcon, MicIcon, SearchIcon } from "./icons";
import { useOnline } from "./useOnline";
import { useWishes } from "./useWishes";

type Category = "" | "POKEMON" | "TRAINER" | "ENERGY";
type Phase = "idle" | "loading" | "more" | "unavailable" | "failed";

const SETS_FIRST = 24;
const CATEGORIES = ["POKEMON", "TRAINER", "ENERGY"] as const;

/** What the grid shows for one search; a result of another search is never shown (the key decides). */
interface Result {
  key: string;
  hits: PokemonTile[];
  done: boolean;
  phase: Phase;
  page: number;
}
const fresh = (key: string): Result => ({ key, hits: [], done: false, phase: "loading", page: 0 });

/** Entdecken opened from a deck (`?deck=`): where "Ins Deck" goes, what is in it now, and her own cards to pick from first. */
export interface DiscoverTarget {
  id: number;
  name: string;
  /** Copies per card id already in the deck. */
  cards: Record<string, number>;
  /** The deck owner's own cards, for "Meine Karten zuerst" before she has typed anything. */
  own: PokemonTile[];
}

/** The live search: search field, chips, newest sets, and a grid with endless scroll. */
export function DiscoverScreen({ decks, target = null }: { decks: PokemonDeckRow[]; target?: DiscoverTarget | null }) {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [category, setCategory] = useState<Category>("");
  const [set, setSet] = useState<{ id: string; name: string } | null>(null);
  const [res, setRes] = useState<Result>(() => ({ key: "", hits: [], done: false, phase: "idle", page: 0 }));
  const [owned, setOwned] = useState<Record<string, number>>({});
  // What the searches said she owns: the order of "Meine Karten zuerst" follows this, so a card marked "Hab ich" does not jump while it is open.
  const [seenOwned, setSeenOwned] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<number | null>(null);
  const { wished, toggle, merge, notice, say } = useWishes([]);
  // For a deck: her own cards come first (a toggle, on by default), and "＋" puts a copy straight into it.
  const [ownFirst, setOwnFirst] = useState(target !== null);
  const [inDeck, setInDeck] = useState<Record<string, number>>(() => target?.cards ?? {});
  const addToTarget = useCallback(
    async (tile: PokemonTile) => {
      if (!target) return;
      setInDeck((m) => ({ ...m, [tile.id]: (m[tile.id] ?? 0) + 1 }));
      try {
        await addPokemonToDeckAction({ deckId: target.id, tcgdexId: tile.tcgdexId, quantity: 1 });
        say(PK.discover.addedTo(target.name));
      } catch {
        setInDeck((m) => ({ ...m, [tile.id]: Math.max(0, (m[tile.id] ?? 1) - 1) }));
        say(typeof navigator !== "undefined" && navigator.onLine === false ? PK.common.offline : PK.common.error);
      }
    },
    [target, say],
  );

  // Typing waits 300 ms; the field itself stays responsive.
  useEffect(() => {
    const t = window.setTimeout(() => setQ(input.trim()), 300);
    return () => window.clearTimeout(t);
  }, [input]);

  const active = q !== "" || type !== "" || category !== "" || set !== null;
  const key = JSON.stringify([q, type, category, set?.id ?? ""]);
  const current = res.key === key ? res : fresh(key);
  const { hits, done, phase } = current;
  const ctl = useRef<AbortController | null>(null);

  const fetchPage = useCallback(
    async (pageNo: number, c: AbortController, append: boolean) => {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (type) p.set("type", type);
      if (category) p.set("category", category);
      if (set) p.set("set", set.id);
      p.set("page", String(pageNo));
      const k = JSON.stringify([q, type, category, set?.id ?? ""]);
      const fail = (phase: Phase) => setRes((prev) => ({ ...(prev.key === k ? prev : fresh(k)), phase }));
      try {
        const r = await fetch(`/api/pokemon/search?${p}`, { signal: c.signal, headers: { accept: "application/json" } });
        if (c.signal.aborted) return;
        if (r.status === 503) return fail("unavailable");
        if (!r.ok) return fail("failed");
        const data = (await r.json()) as { hits: PokemonHit[]; owned: Record<string, number>; wished: string[] };
        if (c.signal.aborted) return;
        const tiles = data.hits.map(tileFromHit);
        setOwned((prev) => ({ ...prev, ...data.owned }));
        setSeenOwned((prev) => ({ ...prev, ...data.owned }));
        merge(data.wished);
        setRes((prev) => {
          const base = prev.key === k ? prev : fresh(k);
          const seen = new Set(base.hits.map((t) => t.id));
          const added = append ? tiles.filter((t) => !seen.has(t.id)) : tiles;
          // A page that brings nothing new is the end of the list.
          return { key: k, hits: append ? base.hits.concat(added) : added, done: tiles.length === 0 || (append && added.length === 0), phase: "idle", page: pageNo };
        });
      } catch (e) {
        if (c.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        fail("failed");
      }
    },
    [q, type, category, set, merge],
  );

  // A new search starts over (the old request is dropped).
  useEffect(() => {
    if (!active) return;
    const c = new AbortController();
    ctl.current = c;
    // After the render, so the effect itself sets nothing.
    queueMicrotask(() => void fetchPage(1, c, false));
    return () => c.abort();
  }, [active, fetchPage]);

  const page = current.page;
  const more = useCallback(() => {
    if (!active || done || phase !== "idle" || hits.length === 0) return;
    const c = new AbortController();
    ctl.current = c;
    setRes((prev) => ({ ...(prev.key === key ? prev : fresh(key)), phase: "more" }));
    void fetchPage(page + 1, c, true);
  }, [active, done, phase, hits.length, fetchPage, page, key]);

  const retry = () => {
    const c = new AbortController();
    ctl.current = c;
    const first = hits.length === 0;
    setRes((prev) => ({ ...(prev.key === key ? prev : fresh(key)), phase: first ? "loading" : "more" }));
    void fetchPage(first ? 1 : page + 1, c, !first);
  };

  // Endless scroll: the sentinel under the grid asks for the next page when it is near.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && more(), { rootMargin: "700px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more]);

  const clearAll = () => {
    setInput("");
    setQ("");
    setType("");
    setCategory("");
    setSet(null);
  };

  const sub = set ? PK.discover.setCards(set.name) : PK.discover.subtitle;
  // "Meine Karten zuerst": the cards she has move to the front (the order inside each part stays); with no search yet, her own cards are the grid.
  const shownHits = useMemo(() => (ownFirst ? [...hits].sort((a, b) => Number((seenOwned[b.id] ?? 0) > 0) - Number((seenOwned[a.id] ?? 0) > 0)) : hits), [ownFirst, hits, seenOwned]);
  const showOwn = !active && ownFirst && target !== null;
  const list = showOwn && target ? target.own : shownHits;
  const addProps = (t: PokemonTile) => (target ? { onAdd: addToTarget, addLabel: PK.discover.addToDeckAria(t.name, target.name), inTarget: inDeck[t.id] ?? 0 } : {});

  return (
    <div className="pk-area">
      <PageTop title={PK.discover.title} sub={!set ? sub : undefined} />

      {target ? (
        <div className="pk-forDeck pk-panel" style={{ padding: "4px 12px" }}>
          <b>{PK.discover.forDeck(target.name)}</b>
          <Link href={`/pokemon/decks/${target.id}`} prefetch={false}>
            ‹ {PK.discover.forDeckBack}
          </Link>
        </div>
      ) : null}

      <div className="pk-search" role="search">
        <SearchIcon />
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={PK.discover.searchPlaceholder}
          aria-label={PK.discover.searchLabel}
        />
        {input ? (
          <button type="button" className="pk-round pk-round-quiet" aria-label={PK.discover.searchClear} onClick={() => setInput("")}>
            <CloseIcon />
          </button>
        ) : null}
        {/* The microphone belongs to the voice entry of the add lane (/pokemon/add); it opens there. */}
        <Link href="/pokemon/add" prefetch={false} className="pk-round" aria-label={PK.discover.voice}>
          <MicIcon />
        </Link>
      </div>

      <div className="pk-chips">
        <button type="button" className="pk-chip" aria-pressed={ownFirst} onClick={() => setOwnFirst((v) => !v)}>
          {PK.discover.ownFirst}
        </button>
      </div>
      <div className="pk-chips" role="group" aria-label={PK.discover.categoryChips}>
        <button type="button" className="pk-chip" aria-pressed={category === ""} onClick={() => setCategory("")}>
          {PK.discover.all}
        </button>
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className="pk-chip" aria-pressed={category === c} onClick={() => setCategory(category === c ? "" : c)}>
            {PK.discover.categories[c]}
          </button>
        ))}
      </div>
      <div className="pk-chips" role="group" aria-label={PK.discover.typeChips}>
        <button type="button" className="pk-chip" aria-pressed={type === ""} onClick={() => setType("")}>
          {PK.discover.all}
        </button>
        {TYPE_CHIPS.map((t) => (
          <button key={t.value} type="button" className="pk-chip" aria-pressed={type === t.value} onClick={() => setType(type === t.value ? "" : t.value)}>
            <i className="pk-dot" style={{ background: t.color }} aria-hidden />
            {t.label}
          </button>
        ))}
      </div>
      {set ? (
        <div className="pk-chips">
          <button type="button" className="pk-chip" onClick={() => setSet(null)}>
            ‹ {PK.discover.setBack}
          </button>
          <span className="pk-pill" style={{ alignSelf: "center" }}>
            {set.name}
          </span>
        </div>
      ) : null}

      {showOwn && target ? (
        <section aria-labelledby="pk-own">
          <div className="pk-lbl" id="pk-own" style={{ color: "var(--ds-ink)" }}>
            {PK.discover.ownCards}
          </div>
          {target.own.length === 0 ? (
            <div className="pk-panel pk-empty" role="status">
              <p>{PK.discover.ownCardsEmpty}</p>
            </div>
          ) : (
            <div className="pk-grid">
              {target.own.map((t, i) => (
                <PokemonTileCard key={t.id} tile={t} onOpen={() => setOpen(i)} owned={owned[t.id] ?? 0} wished={wished.has(t.id)} onToggleWish={toggle} {...addProps(t)} />
              ))}
            </div>
          )}
        </section>
      ) : null}
      {!active && !showOwn ? (
        <NewestSets onPick={(s) => setSet(s)} />
      ) : !active ? null : (
        <>
          {phase === "loading" ? <SkeletonGrid count={8} /> : null}
          {(phase === "unavailable" || phase === "failed") && hits.length === 0 ? <DownPanel failed={phase === "failed"} onRetry={retry} /> : null}
          {phase === "idle" && hits.length === 0 ? (
            <div className="pk-panel pk-empty" role="status">
              <p>{PK.discover.noResult}</p>
              <button type="button" className="pk-cta pk-cta-alt pk-cta-inline" onClick={clearAll}>
                {PK.discover.all}
              </button>
            </div>
          ) : null}
          {hits.length > 0 ? (
            <>
              <div className="pk-grid">
                {shownHits.map((t, i) => (
                  <PokemonTileCard key={t.id} tile={t} onOpen={() => setOpen(i)} owned={owned[t.id] ?? 0} wished={wished.has(t.id)} onToggleWish={toggle} {...addProps(t)} />
                ))}
              </div>
              {phase === "more" ? (
                <div style={{ marginTop: 12 }}>
                  <SkeletonGrid count={4} />
                </div>
              ) : null}
              <div ref={sentinel} className="pk-sentinel" />
              {phase === "unavailable" || phase === "failed" ? <DownPanel failed={phase === "failed"} onRetry={retry} /> : null}
              {phase === "idle" && !done ? (
                <button type="button" className="pk-cta pk-cta-alt pk-cta-inline pk-more" onClick={more}>
                  {PK.common.more}
                </button>
              ) : null}
              {done ? <p className="pk-note" style={{ textAlign: "center" }}>{PK.discover.end}</p> : null}
            </>
          ) : null}
        </>
      )}

      <p role="status" aria-live="polite" className={notice ? "pk-live" : "sr-only"}>
        {notice}
      </p>

      {open !== null && list[open] ? (
        <PokemonViewer
          tiles={list}
          startIndex={open}
          decks={decks}
          wished={wished}
          onToggleWish={toggle}
          onWishKnown={(id) => merge([id])}
          onOwnedChange={(id, copies) => setOwned((o) => ({ ...o, [id]: copies }))}
          targetDeck={target ? { id: target.id, name: target.name } : null}
          onDeckAdded={(id) => setInDeck((m) => ({ ...m, [id]: (m[id] ?? 0) + 1 }))}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

/** The set's logo with its name and size under it; a set without a logo (or one that does not load) shows its name large. */
function SetLogo({ set }: { set: PokemonSetInfo }) {
  const [failed, setFailed] = useState(false);
  if (!set.logo || failed) {
    return (
      <>
        <b className="pk-set-name">{set.name}</b>
        {set.official ? <b>{set.official}</b> : null}
      </>
    );
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${set.logo}.webp`} alt={set.name} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      <b>{set.official ? `${set.name} · ${set.official}` : set.name}</b>
    </>
  );
}

/**
 * The live source did not answer (search page, set tiles): what is wrong in plain words and a button that
 * asks again. With no network it says "Kein Internet" instead of blaming the card search, and it asks
 * again by itself the moment the network is back.
 */
function DownPanel({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  const online = useOnline();
  const retryRef = useRef(onRetry);
  useEffect(() => {
    retryRef.current = onRetry;
  });
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!online) wasOffline.current = true;
    else if (wasOffline.current) {
      wasOffline.current = false;
      retryRef.current();
    }
  }, [online]);
  return (
    <div className="pk-panel pk-empty" role="alert">
      <p>{!online ? PK.common.offline : failed ? PK.common.error : PK.discover.unavailable}</p>
      <button type="button" className="pk-cta pk-cta-alt pk-cta-inline" onClick={onRetry}>
        {PK.common.retry}
      </button>
    </div>
  );
}

/** The empty search: the newest sets as logo tiles, each opening that set's cards. */
function NewestSets({ onPick }: { onPick: (s: { id: string; name: string }) => void }) {
  const [sets, setSets] = useState<PokemonSetInfo[] | "loading" | "unavailable">("loading");
  const [all, setAll] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/pokemon/sets", { headers: { accept: "application/json" } })
      .then(async (r) => (r.ok ? ((await r.json()) as { sets: PokemonSetInfo[] }).sets : Promise.reject(new Error(String(r.status)))))
      .then((list) => alive && setSets(list))
      .catch(() => alive && setSets("unavailable"));
    return () => {
      alive = false;
    };
  }, [attempt]);
  const load = () => {
    setSets("loading");
    setAttempt((n) => n + 1);
  };
  const shown = useMemo(() => (Array.isArray(sets) ? (all ? sets : sets.slice(0, SETS_FIRST)) : []), [sets, all]);

  return (
    <section aria-labelledby="pk-newest">
      <div className="pk-lbl" id="pk-newest" style={{ color: "var(--ds-ink)" }}>
        {PK.discover.newestSets}
      </div>
      {sets === "loading" ? <p className="pk-note" role="status">{PK.discover.setsLoading}</p> : null}
      {sets === "unavailable" ? <DownPanel failed={false} onRetry={load} /> : null}
      <div className="pk-sets">
        {shown.map((s) => (
          <button key={s.id} type="button" className="pk-set" onClick={() => onPick({ id: s.id, name: s.name })}>
            <SetLogo set={s} />
          </button>
        ))}
      </div>
      {Array.isArray(sets) && sets.length > SETS_FIRST && !all ? (
        <button type="button" className="pk-cta pk-cta-alt pk-cta-inline pk-more" onClick={() => setAll(true)}>
          {PK.common.more}
        </button>
      ) : null}
    </section>
  );
}
