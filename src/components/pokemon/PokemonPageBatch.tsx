"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  completePokemonBatchAction,
  discardPokemonBatchAction,
  getPokemonBatchAction,
  setPokemonBatchDeckAction,
  updatePokemonScanItemAction,
} from "@/app/pokemon/add/batch-actions";
import { INPUT_COPY, failureText } from "@/lib/pokemon/copy-input";
import { gridCells, variantFromFinish } from "@/lib/pokemon/scan-match";
import { itemState, type PokemonBatchItem, type PokemonBatchOffer, type PokemonBatchPhoto, type PokemonBatchState, type PokemonCompleteResult, type PokemonItemPatch } from "@/lib/pokemon/scan-batch-types";
import { pokemonImage, type PokemonHit, type PokemonVariant } from "@/lib/pokemon/types";
import { downscaleImage } from "@/lib/scan/downscale";
import { DeckSelect, loadCardDetail, primaryButton, secondaryButton, variantOptions, type DeckChoice } from "./AddParts";
import { CellEditor, badge, type Cell } from "./PhotoCell";

const C = INPUT_COPY.photo;
const B = INPUT_COPY.batch;

type VariantOptions = { value: PokemonVariant; label: string }[];
const NORMAL_ONLY: VariantOptions = [{ value: "normal", label: "Normal" }];

/** "Du hast noch eine angefangene Seite: n Karten", with continue and discard. `href` links to the page; `onContinue` switches on the page itself. */
export function BatchOfferCard({ offer, href, onContinue, onDiscarded }: { offer: PokemonBatchOffer; href?: string; onContinue?: () => void; onDiscarded?: () => void }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discard = async () => {
    setBusy(true);
    setError(null);
    try {
      await discardPokemonBatchAction(offer.id);
      onDiscarded?.();
      router.refresh();
    } catch (e) {
      setError(failureText(e, INPUT_COPY.voice.saveFailed));
      setBusy(false);
    }
  };
  return (
    <section aria-label={B.offer(offer.cards)} className="space-y-3 rounded-2xl border border-ki-500/50 bg-ki-500/10 p-4">
      <p className="text-base font-semibold text-space-50">{offer.cards > 0 ? B.offer(offer.cards) : B.offerPhotoOnly}</p>
      {error ? (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      ) : null}
      {asking ? (
        <div className="space-y-2">
          <p className="text-sm text-space-200">{B.discardAsk}</p>
          <div className="flex gap-2">
            <button type="button" onClick={discard} disabled={busy} className={`${secondaryButton} flex-1 border-loss/60 text-loss`}>
              {B.discardYes}
            </button>
            <button type="button" onClick={() => setAsking(false)} className={`${secondaryButton} flex-1`}>
              {B.discardNo}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          {href ? (
            <Link href={href} className={`${primaryButton} flex-1`}>
              {B.resume}
            </Link>
          ) : (
            <button type="button" onClick={onContinue} className={`${primaryButton} flex-1`}>
              {B.resume}
            </button>
          )}
          <button type="button" onClick={() => setAsking(true)} className={secondaryButton}>
            {B.discard}
          </button>
        </div>
      )}
    </section>
  );
}

/** What a cell is called in words, for the label of its button. */
function cellLabel(i: PokemonBatchItem): string {
  const s = itemState(i);
  return s === "saved" ? B.stateSaved : s === "check" ? C.cellOpen : s === "confirmed" ? C.cellConfirmed : C.cellSkipped;
}

/**
 * "Ganze Seite": a kept binder page. The photo is stored on the server before it is read, every
 * edit is saved as it is made, and the same page opens on any device of the same owner (the phone
 * takes the photo, the PC finishes it). Several photos can join one page. "Speichern" writes the
 * confirmed cards through the normal Pokémon add path and closes the page. Nothing is written by a read.
 */
export function PokemonPageBatch({ decks, initialDeck, initial }: { decks: DeckChoice[]; initialDeck: number | null; initial: PokemonBatchState | null }) {
  const [state, setState] = useState<PokemonBatchState | null>(initial);
  const [deckId, setDeckId] = useState<number | null>(initial?.batch.deckId ?? initialDeck);
  const [reading, setReading] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [variants, setVariants] = useState<Record<string, VariantOptions>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState<PokemonCompleteResult["failed"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [gone, setGone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useRef(0);
  const loading = useRef(new Set<string>());
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const settingVariant = useRef(new Set<number>());

  const patchLocal = useCallback((id: number, patch: Partial<PokemonBatchItem>) => {
    setState((s) => (s ? { ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) } : s));
  }, []);

  const reload = useCallback(async () => {
    const s = stateRef.current;
    if (!s) return;
    try {
      const fresh = await getPokemonBatchAction(s.batch.id);
      setState(fresh.batch.status === "open" ? fresh : null);
      if (fresh.batch.status !== "open") setGone(true);
    } catch {
      setState(null);
      setGone(true);
    }
  }, []);

  /** A page that was changed on another device shows its current state when this tab comes back to the front. */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && pending.current === 0) void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  /** One edit, saved as it is made: shown at once, written, and the screen reloaded if the write is refused. */
  const edit = useCallback(
    async (id: number, patch: PokemonItemPatch, local: Partial<PokemonBatchItem> = {}) => {
      patchLocal(id, { ...(patch.include !== undefined ? { include: patch.include } : {}), ...(patch.variant ? { variant: patch.variant } : {}), ...(patch.language ? { language: patch.language } : {}), ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}), ...local });
      pending.current++;
      try {
        const saved = await updatePokemonScanItemAction(id, patch);
        // Fields the screen did not change itself (the server sets include and variant when a card is picked).
        patchLocal(id, { include: saved.include, manual: saved.manual, chosen: saved.chosen });
      } catch (e) {
        setError(failureText(e, INPUT_COPY.voice.saveFailed));
        pending.current--;
        await reload();
        return;
      }
      pending.current--;
    },
    [patchLocal, reload],
  );

  /** The variants a chosen card really has; the item's variant is set from what the model saw when it has none yet, or is not one of them. */
  useEffect(() => {
    if (!state) return;
    const ids = new Set(state.items.filter((i) => !i.saved && i.chosen).map((i) => i.chosen!.tcgdexId));
    for (const tcgdexId of ids) {
      if (variants[tcgdexId] || loading.current.has(tcgdexId)) continue;
      loading.current.add(tcgdexId);
      loadCardDetail(tcgdexId)
        .then((d) => setVariants((v) => ({ ...v, [tcgdexId]: variantOptions(d.variants) })))
        .catch(() => setVariants((v) => ({ ...v, [tcgdexId]: NORMAL_ONLY })))
        .finally(() => loading.current.delete(tcgdexId));
    }
    // A cell with no valid variant gets the one the model saw (else Normal); written once the card's variants are known.
    for (const i of state.items) {
      const opts = i.chosen && !i.saved ? variants[i.chosen.tcgdexId] : null;
      if (!opts || settingVariant.current.has(i.id)) continue;
      if (!i.variant || !opts.some((o) => o.value === i.variant)) {
        const v = variantFromFinish(i.variant ?? i.detection.seen.finish, opts.map((o) => o.value));
        settingVariant.current.add(i.id);
        updatePokemonScanItemAction(i.id, { variant: v })
          .then(() => patchLocal(i.id, { variant: v }))
          .catch(() => undefined)
          .finally(() => settingVariant.current.delete(i.id));
      }
    }
  }, [state, variants, patchLocal]);

  const upload = async (file: File | undefined, retryPhoto?: number) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file && !retryPhoto) return;
    setError(null);
    setMessage(null);
    setFailed([]);
    setGone(false);
    let preview: string | null = null;
    try {
      const fd = new FormData();
      if (retryPhoto) fd.append("photoId", String(retryPhoto));
      else if (file) {
        const { blob } = await downscaleImage(file);
        preview = URL.createObjectURL(blob);
        fd.append("image", blob, "photo.jpg");
        if (stateRef.current) fd.append("batchId", String(stateRef.current.batch.id));
      }
      setReading(preview ?? "retry");
      const res = await fetch("/api/pokemon/scan/batch", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as { state?: PokemonBatchState; photoId?: number; error?: string };
      if (res.status === 503) throw new Error(C.unavailable);
      if (res.status === 404) {
        setGone(true);
        setState(null);
        return;
      }
      if (!res.ok || !json.state) throw new Error(json.error ?? C.failed);
      setState(json.state);
      const photo = json.state.photos.find((p) => p.id === json.photoId);
      if (photo?.status === "error") setError(photo.error ?? B.readFailed);
      else if (photo && photo.found === 0) setError(C.nothingRead);
      // A new page starts with the deck chosen on this screen.
      if (deckId !== json.state.batch.deckId && !retryPhoto) await setPokemonBatchDeckAction(json.state.batch.id, deckId).catch(() => undefined);
    } catch (e) {
      setError(failureText(e, C.failed));
    } finally {
      if (preview) URL.revokeObjectURL(preview);
      setReading(null);
    }
  };

  const changeDeck = (id: number | null) => {
    setDeckId(id);
    const s = stateRef.current;
    if (s) setPokemonBatchDeckAction(s.batch.id, id).catch((e) => setError(failureText(e, INPUT_COPY.voice.saveFailed)));
  };

  const pick = (item: PokemonBatchItem, hit: PokemonHit) => {
    setBusyIds((b) => new Set(b).add(item.id));
    // The server sets the cell confirmed and clears the variant; the card's variants are read next.
    void edit(item.id, { chosen: hit }, { chosen: hit, include: true, manual: true, variant: null }).finally(() =>
      setBusyIds((b) => {
        const n = new Set(b);
        n.delete(item.id);
        return n;
      }),
    );
  };

  const complete = async () => {
    const s = state;
    if (!s || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const r = await completePokemonBatchAction(s.batch.id);
      if (r.done) {
        setMessage(`${B.savedN(r.added)}${r.deckAdded > 0 ? ` ${B.savedDeck(r.deckAdded)}` : ""}`);
        setState(null);
        setOpen(null);
      } else {
        setFailed(r.failed);
        setMessage(r.added > 0 ? B.savedN(r.added) : null);
        await reload();
      }
    } catch (e) {
      setError(failureText(e, INPUT_COPY.voice.saveFailed));
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    const s = state;
    if (!s) return;
    try {
      await discardPokemonBatchAction(s.batch.id);
      setState(null);
      setOpen(null);
      setAsking(false);
    } catch (e) {
      setError(failureText(e, INPUT_COPY.voice.saveFailed));
    }
  };

  const items = useMemo(() => state?.items ?? [], [state]);
  const ready = items.filter((i) => !i.saved && i.include && i.chosen);
  const readyCount = ready.reduce((n, i) => n + i.quantity, 0);
  const openItem = open !== null ? (items.find((i) => i.id === open) ?? null) : null;

  const cellOf = (i: PokemonBatchItem): Cell => {
    const opts = (i.chosen && variants[i.chosen.tcgdexId]) || (i.variant ? [{ value: i.variant, label: i.variant === "normal" ? "Normal" : i.variant }] : NORMAL_ONLY);
    return { det: i.detection, chosen: i.chosen, include: i.include, variant: i.variant ?? opts[0].value, variants: opts, language: i.language, quantity: i.quantity, loading: busyIds.has(i.id) || (!!i.chosen && !variants[i.chosen.tcgdexId]) };
  };

  return (
    <div className="mx-auto w-full max-w-md space-y-4 lg:max-w-5xl">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />

      <div className="mx-auto max-w-md space-y-4">
        <DeckSelect decks={decks} value={deckId} onChange={changeDeck} label={INPUT_COPY.hub.deck.label} none={INPUT_COPY.hub.deck.none} />
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
        {failed.length > 0 ? (
          <div role="alert" className="space-y-1 rounded-lg border border-loss/40 bg-loss/5 p-3 text-sm text-loss">
            <p>{B.notSaved}</p>
            <ul className="list-disc pl-5">
              {failed.map((f) => (
                <li key={f.itemId}>
                  {f.name}: {failureText(new Error(f.message), INPUT_COPY.voice.saveFailed)}
                </li>
              ))}
            </ul>
            <p>{B.leftOpen}</p>
          </div>
        ) : null}
        {gone ? (
          <div role="status" className="rounded-lg border border-space-700 bg-space-900/50 p-3 text-sm text-space-200">
            <p className="font-semibold text-space-50">{B.goneTitle}</p>
            <p>{B.gone}</p>
          </div>
        ) : null}
      </div>

      {reading ? (
        <div className="mx-auto max-w-md space-y-2 rounded-2xl border border-space-700/70 bg-space-900/50 p-3 text-center" role="status">
          {reading !== "retry" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={reading} alt={C.yourPhoto} className="mx-auto max-h-64 rounded-lg object-contain opacity-70" />
          ) : null}
          <p className="text-sm text-space-200 motion-safe:animate-pulse">{C.readingPage}</p>
        </div>
      ) : null}

      {!state && !reading ? (
        <div className="mx-auto max-w-md">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="tap flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-ki-500/60 bg-ki-500/5 px-4 py-12 text-ki-300 hover:bg-ki-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-300"
          >
            <span className="text-5xl" aria-hidden>
              📷
            </span>
            <span className="text-lg font-semibold">{C.takePage}</span>
            <span className="text-xs text-space-300">{C.takePageHint}</span>
          </button>
        </div>
      ) : null}

      {state ? (
        <div className="space-y-6">
          <p className="mx-auto max-w-md text-sm text-space-300">{B.kept}</p>
          {state.photos.map((photo, n) => (
            <PhotoSection
              key={photo.id}
              photo={photo}
              n={n + 1}
              items={items.filter((i) => i.photoId === photo.id)}
              open={open}
              onOpen={(id) => setOpen(open === id ? null : id)}
              onRetry={() => void upload(undefined, photo.id)}
              busy={!!reading}
              editor={
                openItem && openItem.photoId === photo.id ? (
                  <div className="space-y-3 rounded-2xl border border-space-700/70 bg-space-900/50 p-3">
                    <CellEditor
                      cell={cellOf(openItem)}
                      onPick={(h) => pick(openItem, h)}
                      onChange={(p) => {
                        const patch: PokemonItemPatch = {};
                        if (p.variant) patch.variant = p.variant;
                        if (p.language) patch.language = p.language;
                        if (p.quantity !== undefined) patch.quantity = p.quantity;
                        if (Object.keys(patch).length) void edit(openItem.id, patch);
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void edit(openItem.id, { include: true });
                          setOpen(null);
                        }}
                        disabled={!openItem.chosen}
                        className={`${primaryButton} flex-1`}
                      >
                        {C.include}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void edit(openItem.id, { include: false });
                          setOpen(null);
                        }}
                        className={secondaryButton}
                      >
                        {C.exclude}
                      </button>
                    </div>
                  </div>
                ) : null
              }
            />
          ))}

          <div className="mx-auto max-w-md space-y-3">
            <button type="button" onClick={() => void complete()} disabled={saving || ready.length === 0} className={primaryButton}>
              {saving ? C.saving : ready.length === 0 ? C.saveNone : C.savePage(readyCount)}
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={!!reading} className={`${secondaryButton} w-full`}>
              {B.addPhoto}
            </button>
            {asking ? (
              <div className="space-y-2 rounded-xl border border-loss/40 p-3">
                <p className="text-sm text-space-200">{B.discardAsk}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void discard()} className={`${secondaryButton} flex-1 border-loss/60 text-loss`}>
                    {B.discardYes}
                  </button>
                  <button type="button" onClick={() => setAsking(false)} className={`${secondaryButton} flex-1`}>
                    {B.discardNo}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setAsking(true)} className={`${secondaryButton} w-full`}>
                {B.discard}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** One photo of the page: on a wide screen the photo stands beside its 3x3 grid, on a phone it sits above. */
function PhotoSection({
  photo,
  n,
  items,
  open,
  onOpen,
  onRetry,
  busy,
  editor,
}: {
  photo: PokemonBatchPhoto;
  n: number;
  items: PokemonBatchItem[];
  open: number | null;
  onOpen: (id: number) => void;
  onRetry: () => void;
  busy: boolean;
  editor: React.ReactNode;
}) {
  const [big, setBig] = useState(false);
  const placed = useMemo(() => gridCells(items.map((i) => ({ box: i.detection.seen.box, i }))), [items]);
  const failedRead = photo.status === "error";
  return (
    <section aria-label={B.photoOf(n)} className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-6">
      <div className="mx-auto w-full max-w-md space-y-2 lg:sticky lg:top-4 lg:max-w-none">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-space-300">{B.photoOf(n)}</h2>
          <span className="text-xs text-space-400">{photo.status === "reading" ? B.readingNow : failedRead ? "" : B.foundN(items.length)}</span>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/scan/photo/${photo.id}`}
          alt={C.yourPhoto}
          width={photo.width || undefined}
          height={photo.height || undefined}
          className={`mx-auto w-auto max-w-full rounded-lg bg-space-800 object-contain ${big ? "max-h-[70vh]" : "max-h-44 lg:max-h-[70vh]"}`}
        />
        <button type="button" onClick={() => setBig(!big)} className="tap text-xs text-space-300 underline hover:text-space-50 lg:hidden">
          {big ? B.closePhoto : B.openPhoto}
        </button>
        {failedRead || photo.status === "reading" ? (
          <button type="button" onClick={onRetry} disabled={busy} className={`${secondaryButton} w-full`}>
            {B.retry}
          </button>
        ) : null}
      </div>
      <div className="mx-auto w-full max-w-md space-y-3 lg:max-w-none">
        {items.length > 0 ? (
          <>
            <p className="text-sm text-space-200">{C.pageIntro(items.length)}</p>
            <ul className="grid grid-cols-3 gap-2" aria-label={C.page}>
              {[...placed.cells, ...placed.extra.map((e) => e)].map((c, k) => {
                if (!c) return <li key={`e${k}`} className="card-aspect rounded-lg border border-dashed border-space-700" aria-hidden />;
                const i = c.i;
                const st = itemState(i);
                const b = badge(i.detection.confidence, !!i.chosen && i.chosen.id !== i.detection.best?.id);
                const src = pokemonImage(i.chosen?.image ?? null, "low");
                return (
                  <li key={i.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpen(i.id)}
                      disabled={st === "saved"}
                      aria-expanded={open === i.id}
                      aria-label={`${i.chosen?.name ?? i.detection.seen.name}, ${b.text}, ${cellLabel(i)}. ${C.cellTap}`}
                      className={`tap flex w-full flex-col gap-1 rounded-xl border p-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-400 ${open === i.id ? "border-ki-400" : st === "confirmed" || st === "saved" ? "border-gain/50" : "border-amber-400/50"} ${st === "skipped" ? "opacity-60" : ""}`}
                    >
                      <span className="card-aspect relative block w-full overflow-hidden rounded-lg bg-space-800">
                        {src ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full items-center justify-center p-1 text-center text-xs text-space-300">{i.detection.seen.name}</span>
                        )}
                        {i.quantity > 1 && st !== "check" ? <span className="absolute right-1 top-1 rounded-full bg-space-950/80 px-1.5 text-xs font-semibold text-space-50">×{i.quantity}</span> : null}
                      </span>
                      <span className={`rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold ${st === "saved" ? "bg-gain/15 text-gain" : b.cls}`}>{st === "saved" ? B.stateSaved : st === "skipped" ? C.cellSkipped : b.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        {editor}
      </div>
    </section>
  );
}
