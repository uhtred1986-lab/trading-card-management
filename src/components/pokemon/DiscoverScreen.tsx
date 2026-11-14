"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PK } from "@/lib/pokemon/copy";
import { TYPE_CHIPS, tileFromHit, type PokemonTile } from "@/lib/pokemon/client";
import type { PokemonSetInfo } from "@/lib/pokemon/tcgdex";
import type { PokemonHit } from "@/lib/pokemon/types";
import type { PokemonDeckRow } from "@/lib/pokemon/views";
import { PageTop } from "./PageTop";
import { PokemonTileCard, SkeletonGrid } from "./PokemonTileCard";
import { PokemonViewer } from "./PokemonViewer";
import { CloseIcon, MicIcon, SearchIcon } from "./icons";
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

/** The live search: search field, chips, newest sets, and a grid with endless scroll. */
export function DiscoverScreen({ decks }: { decks: PokemonDeckRow[] }) {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [category, setCategory] = useState<Category>("");
  const [set, setSet] = useState<{ id: string; name: string } | null>(null);
  const [res, setRes] = useState<Result>(() => ({ key: "", hits: [], done: false, phase: "idle", page: 0 }));
  const [owned, setOwned] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<number | null>(null);
  const { wished, toggle, merge, notice } = useWishes([]);

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

  return (
    <div className="pk-area">
      <PageTop title={PK.discover.title} sub={!set ? sub : undefined} />

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

      {!active ? (
        <NewestSets onPick={(s) => setSet(s)} />
      ) : (
        <>
          {phase === "loading" ? <SkeletonGrid count={8} /> : null}
          {phase === "unavailable" ? (
            <div className="pk-panel pk-empty" role="alert">
              <p>{PK.discover.unavailable}</p>
              <button type="button" className="pk-cta pk-cta-alt pk-cta-inline" onClick={retry}>
                {PK.common.retry}
              </button>
            </div>
          ) : null}
          {phase === "failed" ? (
            <div className="pk-panel pk-empty" role="alert">
              <p>{typeof navigator !== "undefined" && navigator.onLine === false ? PK.common.offline : PK.common.error}</p>
              <button type="button" className="pk-cta pk-cta-alt pk-cta-inline" onClick={retry}>
                {PK.common.retry}
              </button>
            </div>
          ) : null}
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
                {hits.map((t, i) => (
                  <PokemonTileCard key={t.id} tile={t} onOpen={() => setOpen(i)} owned={owned[t.id] ?? 0} wished={wished.has(t.id)} onToggleWish={toggle} />
                ))}
              </div>
              {phase === "more" ? (
                <div style={{ marginTop: 12 }}>
                  <SkeletonGrid count={4} />
                </div>
              ) : null}
              <div ref={sentinel} className="pk-sentinel" />
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

      {open !== null && hits[open] ? (
        <PokemonViewer
          tiles={hits}
          startIndex={open}
          decks={decks}
          wished={wished}
          onToggleWish={toggle}
          onOwnedChange={(id, copies) => setOwned((o) => ({ ...o, [id]: copies }))}
          onClose={() => setOpen(null)}
        />
      ) : null}
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
      {sets === "unavailable" ? (
        <div className="pk-panel pk-empty" role="alert">
          <p>{PK.discover.unavailable}</p>
          <button type="button" className="pk-cta pk-cta-alt pk-cta-inline" onClick={load}>
            {PK.common.retry}
          </button>
        </div>
      ) : null}
      <div className="pk-sets">
        {shown.map((s) => (
          <button key={s.id} type="button" className="pk-set" onClick={() => onPick({ id: s.id, name: s.name })}>
            {s.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${s.logo}.webp`} alt={s.name} loading="lazy" decoding="async" />
            ) : (
              <b className="pk-set-name">{s.name}</b>
            )}
            {s.logo ? <b>{s.official ? `${s.name} · ${s.official}` : s.name}</b> : s.official ? <b>{s.official}</b> : null}
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
