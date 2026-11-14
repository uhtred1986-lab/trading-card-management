"use client";

import { useEffect, useRef, useState } from "react";
import { addPokemonLotAction, setPokemonOwnedAction, undoPokemonDeckAddAction } from "@/app/pokemon/actions";
import { INPUT_COPY, failureText } from "@/lib/pokemon/copy-input";
import { variantFromFinish } from "@/lib/pokemon/scan-match";
import type { PokemonBatchOffer, PokemonBatchState } from "@/lib/pokemon/scan-batch-types";
import type { PokemonScanDetection } from "@/lib/pokemon/scan";
import { pokemonImage, type PokemonHit, type PokemonVariant } from "@/lib/pokemon/types";
import { downscaleImage } from "@/lib/scan/downscale";
import { ChipRow, DeckSelect, loadCardDetail, numberLabel, primaryButton, secondaryButton, variantOptions, type DeckChoice } from "./AddParts";
import { CellEditor, type Cell } from "./PhotoCell";
import { BatchOfferCard, PokemonPageBatch } from "./PokemonPageBatch";

const C = INPUT_COPY.photo;

type Mode = "single" | "page";

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
  /** The deck this line also put copies into, how many, and how many the deck held before: the undo takes back exactly these. */
  deckId: number | null;
  deckAdded: number;
  deckBefore: number;
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

/**
 * Foto machen (docs/pokemon/design.md §5). One card ("Eine Karte"): photo, result, variant, language
 * and number, save, the camera opens again, as quick capture does; nothing is stored by the scan, a
 * card is written only by the save. A binder page ("Ganze Seite") is a kept scan batch
 * (`PokemonPageBatch`): the photo is stored, the page survives leaving the screen and opens on any
 * device of the same owner. An open page is offered here before a new one is started.
 */
export function PokemonPhotoAdd({
  decks,
  initialDeck,
  initialMode = "single",
  offer,
  initialBatch,
  initialClosed = false,
}: {
  decks: DeckChoice[];
  initialDeck: number | null;
  initialMode?: Mode;
  /** The viewer's open page, if any (also given when `initialBatch` is). */
  offer: PokemonBatchOffer | null;
  initialBatch: PokemonBatchState | null;
  /** The page asked for by `?batch=` is already saved or discarded. */
  initialClosed?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [cell, setCell] = useState<Cell | null>(null);
  const [deckId, setDeckId] = useState<number | null>(initialDeck);
  const [autoNext, setAutoNext] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offerGone, setOfferGone] = useState(false);
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

  const update = (patch: Partial<Cell>) => setCell((c) => (c ? { ...c, ...patch } : c));

  /** Reads a card's variants and the viewer's copies, and presets the variant from the finish the model saw. */
  const loadFor = async (hit: PokemonHit, det: PokemonScanDetection) => {
    try {
      const d = await loadCardDetail(hit.tcgdexId);
      const options = variantOptions(d.variants);
      variantsOf.current.set(hit.tcgdexId, options);
      for (const l of d.owned) ownedOf.current.set(countKey(hit.tcgdexId, l.variant, l.language), l.quantity);
      const variant = variantFromFinish(det.seen.finish, options.map((o) => o.value));
      setCell((c) => (c && c.chosen?.id === hit.id ? { ...c, variants: options, variant, loading: false } : c));
    } catch {
      setCell((c) => (c && c.chosen?.id === hit.id ? { ...c, loading: false } : c));
    }
  };

  const pick = (hit: PokemonHit) => {
    if (!cell) return;
    update({ chosen: hit, include: true, loading: true, variants: variantsOf.current.get(hit.tcgdexId) ?? [{ value: "normal", label: "Normal" }] });
    void loadFor(hit, cell.det);
  };

  const onFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setError(null);
    setNotice(null);
    const { blob } = await downscaleImage(file);
    const preview = URL.createObjectURL(blob);
    setPreview(preview);
    setPhase({ kind: "reading", preview });
    try {
      const fd = new FormData();
      fd.append("image", blob, "photo.jpg");
      fd.append("mode", "single");
      const res = await fetch("/api/pokemon/scan", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as { detections?: PokemonScanDetection[]; error?: string };
      if (res.status === 503) throw new Error(C.unavailable);
      if (!res.ok || !json.detections) throw new Error(json.error ?? C.failed);
      if (json.detections.length === 0) throw new Error(C.nothingRead);
      const next = makeCell(json.detections[0]);
      setCell(next);
      setPhase({ kind: "result", preview });
      if (next.chosen) void loadFor(next.chosen, next.det);
    } catch (e) {
      setPhase({ kind: "error", preview, message: failureText(e, C.failed) });
    }
  };

  const reset = () => {
    setPreview(null);
    setPhase({ kind: "idle" });
    setCell(null);
  };

  /** Writes the confirmed card. Returns false (with the message set) when it did not work. */
  const saveCell = async (c: Cell): Promise<boolean> => {
    if (!c.chosen) return false;
    const hit = c.chosen;
    const key = countKey(hit.tcgdexId, c.variant, c.language);
    const before = counts.current.get(key) ?? ownedOf.current.get(key) ?? 0;
    try {
      const r = await addPokemonLotAction({ tcgdexId: hit.tcgdexId, variant: c.variant, language: c.language, quantity: c.quantity, deckId });
      counts.current.set(key, before + r.added);
      const label = c.variants.find((v) => v.value === c.variant)?.label ?? c.variant;
      setSaved((s) => [
        { key: savedKey++, tcgdexId: hit.tcgdexId, name: hit.name, image: hit.image, variant: c.variant, variantLabel: label, language: c.language, added: r.added, number: numberLabel(hit), deckId, deckAdded: r.deckAdded, deckBefore: r.deckBefore },
        ...s,
      ]);
      return true;
    } catch (e) {
      setError(`${hit.name}: ${failureText(e, INPUT_COPY.voice.saveFailed)}`);
      return false;
    }
  };

  const saveSingle = async () => {
    if (!cell?.chosen || saving) return;
    // The camera has to open inside the tap.
    if (autoNext) openCamera();
    setSaving(true);
    setError(null);
    if (await saveCell(cell)) reset();
    setSaving(false);
  };

  /** Takes back one line: the copies, and the deck copies that line added (never below what the deck held before). */
  const undo = async (line: Saved) => {
    const key = countKey(line.tcgdexId, line.variant, line.language);
    const known = counts.current.get(key) ?? line.added;
    try {
      const r = await setPokemonOwnedAction({ tcgdexId: line.tcgdexId, variant: line.variant, language: line.language, quantity: Math.max(0, known - line.added) });
      counts.current.set(key, r.quantity);
      setSaved((s) => s.filter((x) => x.key !== line.key));
      let text: string = INPUT_COPY.voice.undone;
      if (line.deckId !== null && line.deckAdded > 0) {
        try {
          const d = await undoPokemonDeckAddAction({ deckId: line.deckId, tcgdexId: line.tcgdexId, added: line.deckAdded, before: line.deckBefore });
          text = `${text}. ${d.removed > 0 ? INPUT_COPY.voice.deckRemoved(d.removed) : INPUT_COPY.voice.deckUnchanged}`;
        } catch (e) {
          text = `${text}. ${failureText(e, INPUT_COPY.voice.deckUnchanged)}`;
        }
      }
      setNotice(text);
    } catch (e) {
      setError(failureText(e, INPUT_COPY.voice.saveFailed));
    }
  };

  const showOffer = !!offer && !offerGone && mode === "single" && phase.kind === "idle";

  if (mode === "page") {
    return (
      <div className="mx-auto max-w-md space-y-4 lg:max-w-5xl">
        <div className="mx-auto max-w-md">
          <h1 className="text-2xl font-semibold text-space-50">{C.title}</h1>
          <div className="mt-4">
            <ChipRow
              label={C.title}
              value={mode}
              options={[
                { value: "single", label: C.single },
                { value: "page", label: C.page },
              ]}
              onChange={setMode}
            />
          </div>
        </div>
        <PokemonPageBatch decks={decks} initialDeck={initialDeck} initial={offerGone ? null : initialBatch} initialGone={initialClosed} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-semibold text-space-50">{C.title}</h1>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />

      {showOffer && offer ? <BatchOfferCard offer={offer} onContinue={() => setMode("page")} onDiscarded={() => setOfferGone(true)} /> : null}

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
      {notice ? (
        <p role="status" className="rounded-lg border border-gain/40 bg-gain/5 p-3 text-sm text-gain">
          {notice}
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
          <span className="text-lg font-semibold">{C.takeOne}</span>
          <span className="text-xs text-space-300">{C.takeOneHint}</span>
        </button>
      ) : null}

      {phase.kind === "reading" ? (
        <div className="space-y-2 rounded-2xl border border-space-700/70 bg-space-900/50 p-3 text-center" role="status">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={phase.preview} alt={C.yourPhoto} className="mx-auto max-h-64 rounded-lg object-contain opacity-70" />
          <p className="text-sm text-space-200 motion-safe:animate-pulse">{C.reading}</p>
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

      {phase.kind === "result" && cell ? (
        <div className="space-y-3 rounded-2xl border border-space-700/70 bg-space-900/50 p-3">
          <div className="flex gap-3">
            <div className="w-24 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={phase.preview} alt={C.yourPhoto} className="card-aspect w-full rounded-lg object-cover" />
            </div>
            <div className="min-w-0 flex-1 text-sm text-space-300">{C.unconfirmedHint}</div>
          </div>
          <CellEditor cell={cell} onPick={pick} onChange={update} />
          <div className="flex gap-2">
            <button type="button" onClick={saveSingle} disabled={saving || !cell.chosen || cell.loading} className={`${primaryButton} flex-1`}>
              {saving ? C.saving : `✓ ${autoNext ? C.save : C.saveOnly}`}
            </button>
            <button type="button" onClick={reset} className={secondaryButton}>
              {C.skip}
            </button>
          </div>
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-xs text-space-300">
        <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} className="h-5 w-5" />
        {C.save}
      </label>

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
