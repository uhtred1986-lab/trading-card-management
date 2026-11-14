"use client";

/**
 * The pieces of the photo screens that draw one card of a read: the badge, the typed search for a card
 * the read missed, and the editor (candidates to tap, variant, language, number). Shared by the single
 * card flow (`PokemonPhotoAdd`) and the kept binder page (`PokemonPageBatch`).
 */
import { useState } from "react";
import { INPUT_COPY, failureText } from "@/lib/pokemon/copy-input";
import type { PokemonScanDetection } from "@/lib/pokemon/scan";
import type { PokemonHit, PokemonVariant } from "@/lib/pokemon/types";
import { CandidateTile, ChipRow, Stepper, numberLabel, secondaryButton } from "./AddParts";

const C = INPUT_COPY.photo;

/** One card of a photo as the child handles it: what to save and whether she has said yes. */
export interface Cell {
  det: PokemonScanDetection;
  chosen: PokemonHit | null;
  /** Saved when the page is saved. Exact and likely reads start on; an unsure read starts off until she taps it. */
  include: boolean;
  variant: PokemonVariant;
  variants: { value: PokemonVariant; label: string }[];
  language: "DE" | "EN";
  quantity: number;
  /** Variants are being read for `chosen`. */
  loading: boolean;
}

export function badge(c: PokemonScanDetection["confidence"], chosenByHand: boolean): { text: string; cls: string } {
  if (chosenByHand) return { text: C.exact, cls: "bg-gain/15 text-gain" };
  if (c === "exact") return { text: C.exact, cls: "bg-gain/15 text-gain" };
  if (c === "likely") return { text: C.likely, cls: "bg-ki-500/20 text-ki-300" };
  return { text: c === "none" ? C.none : C.check, cls: "bg-amber-300/15 text-amber-300" };
}

/** A typed search for the card she means, when the read missed it. Hits come from `/api/pokemon/search`. */
function SearchRow({ initialQuery, onPick }: { initialQuery: string; onPick: (hit: PokemonHit) => void }) {
  const [q, setQ] = useState(initialQuery);
  const [hits, setHits] = useState<PokemonHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/pokemon/search?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
      const json = (await res.json()) as { hits?: PokemonHit[]; message?: string };
      if (!res.ok || !json.hits) throw new Error(json.message ?? "Die Kartensuche ist gerade nicht erreichbar.");
      setHits(json.hits.slice(0, 30));
    } catch (error) {
      setErr(failureText(error, "Die Kartensuche ist gerade nicht erreichbar."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <form onSubmit={go} className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={C.searchLabel}
          placeholder={C.searchPlaceholder}
          autoComplete="off"
          enterKeyHint="search"
          className="tap min-w-0 flex-1 rounded-lg border border-space-600 bg-space-900 px-3 py-2 text-base text-space-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-400"
        />
        <button type="submit" disabled={busy} className={secondaryButton}>
          {INPUT_COPY.voice.typedGo}
        </button>
      </form>
      {err ? (
        <p role="alert" className="text-sm text-loss">
          {err}
        </p>
      ) : null}
      {hits ? (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
          {hits.map((h) => (
            <CandidateTile key={h.id} hit={h} onPick={onPick} />
          ))}
          {hits.length === 0 ? <p className="text-sm text-space-300">{INPUT_COPY.voice.nothing}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Everything for one card: candidates to tap, a search, then variant, language and number. */
export function CellEditor({ cell, onPick, onChange }: { cell: Cell; onPick: (hit: PokemonHit) => void; onChange: (patch: Partial<Cell>) => void }) {
  const [searching, setSearching] = useState(false);
  const { det, chosen } = cell;
  const b = badge(det.confidence, !!chosen && chosen.id !== det.best?.id);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${b.cls}`}>{b.text}</span>
        <span className="text-space-300">
          {det.seen.name}
          {det.seen.number ? ` · ${det.seen.number}` : ""}
        </span>
      </div>
      {det.confidence !== "exact" && det.confidence !== "none" && !chosen ? <p className="text-sm text-space-200">{det.reason}</p> : null}
      {det.candidates.length > 0 ? (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-space-300">{C.pickOne}</div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
            {det.candidates.map((h) => (
              <CandidateTile key={h.id} hit={h} selected={chosen?.id === h.id} onPick={onPick} />
            ))}
          </div>
        </div>
      ) : null}
      {searching || det.candidates.length === 0 ? (
        <SearchRow initialQuery={det.seen.number && det.candidates.length === 0 ? det.seen.number : det.seen.name} onPick={(h) => { onPick(h); setSearching(false); }} />
      ) : (
        <button type="button" onClick={() => setSearching(true)} className="tap text-sm text-space-300 underline hover:text-space-50">
          {C.notThis}
        </button>
      )}
      {chosen ? (
        <div className="space-y-4 rounded-xl border border-space-700/70 bg-space-900/50 p-3">
          <div className="text-center">
            <div className="text-lg font-semibold text-space-50">{chosen.name}</div>
            <div className="text-sm text-space-300">
              {chosen.setName} · {numberLabel(chosen)}
            </div>
          </div>
          <ChipRow label={C.variant} value={cell.variant} options={cell.variants} onChange={(v) => onChange({ variant: v })} />
          <ChipRow
            label={C.language}
            value={cell.language}
            options={[
              { value: "DE", label: INPUT_COPY.voice.langDe },
              { value: "EN", label: INPUT_COPY.voice.langEn },
            ]}
            onChange={(l) => onChange({ language: l })}
          />
          <Stepper value={cell.quantity} onChange={(n) => onChange({ quantity: n })} lessLabel={C.less} moreLabel={C.more} />
        </div>
      ) : null}
    </div>
  );
}

