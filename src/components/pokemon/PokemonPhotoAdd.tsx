"use client";

import { useEffect, useRef, useState } from "react";
import { addPokemonLotAction, setPokemonOwnedAction } from "@/app/pokemon/actions";
import { INPUT_COPY, failureText } from "@/lib/pokemon/copy-input";
import { gridCells, variantFromFinish } from "@/lib/pokemon/scan-match";
import type { PokemonScanDetection } from "@/lib/pokemon/scan";
import { pokemonImage, type PokemonHit, type PokemonVariant } from "@/lib/pokemon/types";
import { downscaleImage } from "@/lib/scan/downscale";
import { CandidateTile, ChipRow, DeckSelect, Stepper, loadCardDetail, numberLabel, primaryButton, secondaryButton, variantOptions, type DeckChoice } from "./AddParts";

const C = INPUT_COPY.photo;

type Mode = "single" | "page";

/** One card of a photo as the child handles it: what to save and whether she has said yes. */
interface Cell {
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

interface Saved {
  key: number;
  tcgdexId: string;
  name: string;
  image: string | null;
  variant: PokemonVariant;
  variantLabel: string;
  language: "DE" | "EN";
  added: number;
  number: string;
}

type Phase = { kind: "idle" } | { kind: "reading"; preview: string } | { kind: "error"; preview: string; message: string } | { kind: "result"; preview: string };

let savedKey = 1;
const countKey = (tcgdexId: string, variant: string, language: string) => `${tcgdexId}|${variant}|${language}`;

function makeCell(det: PokemonScanDetection): Cell {
  return {
    det,
    chosen: det.best,
    include: !!det.best,
    variant: "normal",
    variants: [{ value: "normal", label: "Normal" }],
    language: det.seen.language ?? "DE",
    quantity: 1,
    loading: !!det.best,
  };
}

function badge(c: PokemonScanDetection["confidence"], chosenByHand: boolean): { text: string; cls: string } {
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
function CellEditor({ cell, onPick, onChange }: { cell: Cell; onPick: (hit: PokemonHit) => void; onChange: (patch: Partial<Cell>) => void }) {
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

/**
 * Foto machen (docs/pokemon/design.md §5). One card: photo, result, variant, language and number,
 * save, the camera opens again, as quick capture does. A binder page: one photo of up to nine
 * cards as a 3x3 grid, each cell confirmed, corrected or skipped, one button to save the confirmed
 * ones. Nothing is stored by the scan; a card is written only by the save. A read that is unsure is
 * amber, "Bitte prüfen", and is saved only after a tap on it.
 *
 * The page flow is not kept in the scan-batch tables (they refer to local catalog cards, which a
 * Pokémon card does not have until it is stored); it lives in this screen until saved.
 */
export function PokemonPhotoAdd({ decks, initialDeck }: { decks: DeckChoice[]; initialDeck: number | null }) {
  const [mode, setMode] = useState<Mode>("single");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [cells, setCells] = useState<(Cell | null)[]>([]);
  const [extra, setExtra] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [deckId, setDeckId] = useState<number | null>(initialDeck);
  const [autoNext, setAutoNext] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);
  const counts = useRef(new Map<string, number>());
  const variantsOf = useRef(new Map<string, { value: PokemonVariant; label: string }[]>());
  const ownedOf = useRef(new Map<string, number>());

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const openCamera = () => fileRef.current?.click();

  const setPreview = (url: string | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
  };

  const update = (i: number, patch: Partial<Cell>) => setCells((cs) => cs.map((c, k) => (k === i && c ? { ...c, ...patch } : c)));

  /** Reads a card's variants and the viewer's copies, and presets the variant from the finish the model saw. */
  const loadFor = async (i: number, hit: PokemonHit, det: PokemonScanDetection) => {
    try {
      const d = await loadCardDetail(hit.tcgdexId);
      const options = variantOptions(d.variants);
      variantsOf.current.set(hit.tcgdexId, options);
      for (const l of d.owned) ownedOf.current.set(countKey(hit.tcgdexId, l.variant, l.language), l.quantity);
      const variant = variantFromFinish(det.seen.finish, options.map((o) => o.value));
      setCells((cs) => cs.map((c, k) => (k === i && c && c.chosen?.id === hit.id ? { ...c, variants: options, variant, loading: false } : c)));
    } catch {
      setCells((cs) => cs.map((c, k) => (k === i && c && c.chosen?.id === hit.id ? { ...c, loading: false } : c)));
    }
  };

  const pick = (i: number, hit: PokemonHit) => {
    const cell = cells[i];
    if (!cell) return;
    update(i, { chosen: hit, include: true, loading: true, variants: variantsOf.current.get(hit.tcgdexId) ?? [{ value: "normal", label: "Normal" }] });
    void loadFor(i, hit, cell.det);
  };

  const onFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setError(null);
    setMessage(null);
    const scanMode = mode === "page" ? "batch" : "single";
    const { blob } = await downscaleImage(file);
    const preview = URL.createObjectURL(blob);
    setPreview(preview);
    setPhase({ kind: "reading", preview });
    try {
      const fd = new FormData();
      fd.append("image", blob, "photo.jpg");
      fd.append("mode", scanMode);
      const res = await fetch("/api/pokemon/scan", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as { detections?: PokemonScanDetection[]; error?: string };
      if (res.status === 503) throw new Error(C.unavailable);
      if (!res.ok || !json.detections) throw new Error(json.error ?? C.failed);
      if (json.detections.length === 0) throw new Error(C.nothingRead);
      let next: (Cell | null)[];
      if (scanMode === "batch") {
        const placed = gridCells(json.detections.map((d) => ({ box: d.seen.box, d })));
        next = placed.cells.map((c) => (c ? makeCell(c.d) : null));
        setExtra(placed.extra.length);
      } else {
        next = [makeCell(json.detections[0])];
        setExtra(0);
      }
      setCells(next);
      setOpen(scanMode === "single" ? 0 : null);
      setPhase({ kind: "result", preview });
      next.forEach((c, i) => {
        if (c?.chosen) void loadFor(i, c.chosen, c.det);
      });
    } catch (e) {
      setPhase({ kind: "error", preview, message: failureText(e, C.failed) });
    }
  };

  const reset = () => {
    setPreview(null);
    setPhase({ kind: "idle" });
    setCells([]);
    setOpen(null);
    setExtra(0);
  };

  /** Writes one confirmed card. Returns false (with the message set) when it did not work. */
  const saveCell = async (cell: Cell): Promise<boolean> => {
    if (!cell.chosen) return false;
    const hit = cell.chosen;
    const key = countKey(hit.tcgdexId, cell.variant, cell.language);
    const before = counts.current.get(key) ?? ownedOf.current.get(key) ?? 0;
    try {
      const r = await addPokemonLotAction({ tcgdexId: hit.tcgdexId, variant: cell.variant, language: cell.language, quantity: cell.quantity, deckId });
      counts.current.set(key, before + r.added);
      const label = cell.variants.find((v) => v.value === cell.variant)?.label ?? cell.variant;
      setSaved((s) => [{ key: savedKey++, tcgdexId: hit.tcgdexId, name: hit.name, image: hit.image, variant: cell.variant, variantLabel: label, language: cell.language, added: r.added, number: numberLabel(hit) }, ...s]);
      return true;
    } catch (e) {
      setError(`${hit.name}: ${failureText(e, INPUT_COPY.voice.saveFailed)}`);
      return false;
    }
  };

  const saveSingle = async () => {
    const cell = cells[0];
    if (!cell?.chosen || saving) return;
    // The camera has to open inside the tap.
    if (autoNext) openCamera();
    setSaving(true);
    setError(null);
    if (await saveCell(cell)) reset();
    setSaving(false);
  };

  const savePage = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    let n = 0;
    const done = new Set<number>();
    for (const [i, c] of cells.entries()) {
      if (!c?.include || !c.chosen) continue;
      if (await saveCell(c)) {
        n += c.quantity;
        done.add(i);
      }
    }
    // What was saved leaves the grid; what failed stays, with its message.
    setCells((cs) => cs.map((c, i) => (done.has(i) ? null : c)));
    setMessage(n > 0 ? C.pageDone(n) : null);
    setSaving(false);
  };

  const undo = async (line: Saved) => {
    const key = countKey(line.tcgdexId, line.variant, line.language);
    const known = counts.current.get(key) ?? line.added;
    try {
      const r = await setPokemonOwnedAction({ tcgdexId: line.tcgdexId, variant: line.variant, language: line.language, quantity: Math.max(0, known - line.added) });
      counts.current.set(key, r.quantity);
      setSaved((s) => s.filter((x) => x.key !== line.key));
    } catch (e) {
      setError(failureText(e, INPUT_COPY.voice.saveFailed));
    }
  };

  const ready = cells.filter((c) => c?.include && c.chosen);
  const readyCount = ready.reduce((n, c) => n + (c?.quantity ?? 0), 0);
  const detected = cells.filter(Boolean).length;
  const single = cells[0] ?? null;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-semibold text-space-50">{C.title}</h1>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />

      {phase.kind === "idle" || phase.kind === "error" ? (
        <ChipRow
          label={C.title}
          value={mode}
          options={[
            { value: "single", label: C.single },
            { value: "page", label: C.page },
          ]}
          onChange={setMode}
        />
      ) : null}

      <DeckSelect decks={decks} value={deckId} onChange={setDeckId} label={INPUT_COPY.hub.deck.label} none={INPUT_COPY.hub.deck.none} />

      {error ? (
        <p role="alert" className="rounded-lg border border-loss/40 bg-loss/5 p-3 text-sm text-loss">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-lg border border-gain/40 bg-gain/5 p-3 text-sm text-gain">
          {message}
        </p>
      ) : null}

      {phase.kind === "idle" ? (
        <button
          type="button"
          onClick={openCamera}
          className="tap flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-ki-500/60 bg-ki-500/5 px-4 py-12 text-ki-300 hover:bg-ki-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-300"
        >
          <span className="text-5xl" aria-hidden>
            📷
          </span>
          <span className="text-lg font-semibold">{mode === "page" ? C.takePage : C.takeOne}</span>
          <span className="text-xs text-space-300">{mode === "page" ? C.takePageHint : C.takeOneHint}</span>
        </button>
      ) : null}

      {phase.kind === "reading" ? (
        <div className="space-y-2 rounded-2xl border border-space-700/70 bg-space-900/50 p-3 text-center" role="status">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={phase.preview} alt={C.yourPhoto} className="mx-auto max-h-64 rounded-lg object-contain opacity-70" />
          <p className="text-sm text-space-200 motion-safe:animate-pulse">{mode === "page" ? C.readingPage : C.reading}</p>
        </div>
      ) : null}

      {phase.kind === "error" ? (
        <div className="space-y-2 rounded-2xl border border-loss/40 bg-loss/5 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={phase.preview} alt={C.yourPhoto} className="mx-auto max-h-48 rounded-lg object-contain" />
          <p role="alert" className="text-sm text-loss">
            {phase.message}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={openCamera} className={`${primaryButton} flex-1`}>
              {C.again}
            </button>
            <button type="button" onClick={reset} className={secondaryButton}>
              {C.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {phase.kind === "result" && mode === "single" && single ? (
        <div className="space-y-3 rounded-2xl border border-space-700/70 bg-space-900/50 p-3">
          <div className="flex gap-3">
            <div className="w-24 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={phase.preview} alt={C.yourPhoto} className="card-aspect w-full rounded-lg object-cover" />
            </div>
            <div className="min-w-0 flex-1 text-sm text-space-300">{C.unconfirmedHint}</div>
          </div>
          <CellEditor cell={single} onPick={(h) => pick(0, h)} onChange={(p) => update(0, p)} />
          <div className="flex gap-2">
            <button type="button" onClick={saveSingle} disabled={saving || !single.chosen || single.loading} className={`${primaryButton} flex-1`}>
              {saving ? C.saving : `✓ ${autoNext ? C.save : C.saveOnly}`}
            </button>
            <button type="button" onClick={reset} className={secondaryButton}>
              {C.skip}
            </button>
          </div>
        </div>
      ) : null}

      {phase.kind === "result" && mode === "page" ? (
        <div className="space-y-3">
          <p className="text-sm text-space-200">{C.pageIntro(detected)}</p>
          {extra > 0 ? <p className="text-sm text-space-300">{C.extra(extra)}</p> : null}
          <ul className="grid grid-cols-3 gap-2" aria-label={C.page}>
            {cells.map((c, i) => {
              if (!c) return <li key={i} className="card-aspect rounded-lg border border-dashed border-space-700" aria-hidden />;
              const b = badge(c.det.confidence, !!c.chosen && c.chosen.id !== c.det.best?.id);
              const src = pokemonImage(c.chosen?.image ?? null, "low");
              const state = !c.chosen ? C.cellOpen : c.include ? C.cellConfirmed : C.cellSkipped;
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => setOpen(open === i ? null : i)}
                    aria-expanded={open === i}
                    aria-label={`${c.chosen?.name ?? c.det.seen.name}, ${b.text}, ${state}. ${C.cellTap}`}
                    className={`tap flex w-full flex-col gap-1 rounded-xl border p-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-400 ${open === i ? "border-ki-400" : c.include && c.chosen ? "border-gain/50" : "border-amber-400/50"} ${c.include || !c.chosen ? "" : "opacity-60"}`}
                  >
                    <span className="card-aspect relative block w-full overflow-hidden rounded-lg bg-space-800">
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full items-center justify-center p-1 text-center text-xs text-space-300">{c.det.seen.name}</span>
                      )}
                    </span>
                    <span className={`rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold ${b.cls}`}>{b.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {open !== null && cells[open] ? (
            <div className="space-y-3 rounded-2xl border border-space-700/70 bg-space-900/50 p-3">
              <CellEditor cell={cells[open]!} onPick={(h) => pick(open, h)} onChange={(p) => update(open, p)} />
              <div className="flex gap-2">
                <button type="button" onClick={() => { update(open, { include: true }); setOpen(null); }} disabled={!cells[open]!.chosen} className={`${primaryButton} flex-1`}>
                  {C.include}
                </button>
                <button type="button" onClick={() => { update(open, { include: false }); setOpen(null); }} className={secondaryButton}>
                  {C.exclude}
                </button>
              </div>
            </div>
          ) : null}
          <button type="button" onClick={savePage} disabled={saving || ready.length === 0} className={primaryButton}>
            {saving ? C.saving : ready.length === 0 ? C.saveNone : C.savePage(readyCount)}
          </button>
          <button type="button" onClick={() => { reset(); openCamera(); }} className={`${secondaryButton} w-full`}>
            {C.newPage}
          </button>
        </div>
      ) : null}

      {mode === "single" ? (
        <label className="flex items-center gap-2 text-xs text-space-300">
          <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} className="h-5 w-5" />
          {C.save}
        </label>
      ) : null}

      {saved.length ? (
        <section aria-label={C.savedList}>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-space-300">{C.savedList}</h2>
          <ul className="divide-y divide-space-800 rounded-xl border border-space-700/70">
            {saved.map((s) => {
              const src = pokemonImage(s.image, "low");
              return (
                <li key={s.key} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <span className="card-aspect w-8 shrink-0 overflow-hidden rounded bg-space-800">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt={`${s.name} ${s.number}`} loading="lazy" className="h-full w-full object-cover" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-space-50">{s.name}</span>
                    <span className="block text-xs text-space-400">
                      ×{s.added} · {s.variantLabel} · {s.language} · {s.number}
                    </span>
                  </span>
                  <button type="button" onClick={() => undo(s)} className={secondaryButton}>
                    {C.undo}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
