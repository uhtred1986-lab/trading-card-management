"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { completeBatchAction, createBatchAction, deleteBatchAction, setBatchDeckAction, setBatchOwnerAction, updateScanItemAction } from "@/app/add/scan/actions";
import { printsForCardAction } from "@/app/collection/actions";
import type { ScanCandidate, ScanDetection } from "@/lib/ai/scan";
import { REVIEW_THRESHOLD, type Box } from "@/lib/ai/scan-match";
import { CONDITIONS } from "@/lib/collection/queries";
import type { DeckOption } from "@/lib/decks/add";
import type { ItemPatch, ScanItemRow, ScanMode, ScanPhotoMeta } from "@/lib/scan/batches";
import { downscaleImage } from "@/lib/scan/downscale";
import { CardImage } from "./CardImage";
import { CardSearchInput, type CardHit } from "./CardSearchInput";
import { DeckPicker } from "./DeckPicker";
import { OwnerPicker } from "./OwnerPicker";

interface Photo {
  /** Server photo id, or a negative temporary key until the upload returns. */
  key: number;
  file?: File;
  /** Server photo URL, or an object URL of the local file while uploading. */
  url: string;
  width: number;
  height: number;
  status: "queued" | "reading" | "done" | "error";
  error?: string;
  found?: number;
  unreadable?: number;
}

interface Row {
  /** Server item id. */
  key: number;
  photoKey: number;
  detection: ScanDetection;
  chosen: ScanCandidate | null;
  /** Linked by hand via the search box rather than by the scanner. */
  manual: boolean;
  /** Search box open on a matched row ("change"). */
  searching: boolean;
  printId: string | null;
  quantity: number;
  condition: string;
  finish: string;
  include: boolean;
}

let tempKey = -1;
const PARALLEL = 3;
const photoUrl = (id: number) => `/api/scan/photo/${id}`;

const needsReview = (r: Row) => !r.chosen || (!r.manual && r.detection.matchConfidence < REVIEW_THRESHOLD);

function fromItem(i: ScanItemRow): Row {
  return {
    key: i.id,
    photoKey: i.photoId,
    detection: i.detection,
    chosen: i.chosen,
    manual: i.manual,
    searching: false,
    printId: i.printId,
    quantity: i.quantity,
    condition: i.condition,
    finish: i.finish,
    include: i.include,
  };
}

function fromPhoto(p: ScanPhotoMeta): Photo {
  return { key: p.id, url: photoUrl(p.id), width: p.width, height: p.height, status: p.status, error: p.error ?? undefined, found: p.found ?? undefined, unreadable: p.unreadable ?? undefined };
}

/**
 * Photos → identify (one request per photo, up to three in flight) → review →
 * confirm. Everything is persisted in a scan batch as it happens — the photo
 * (downscaled, exactly what Claude saw), the detections and every review
 * edit — so a batch started on the phone can be finished on the PC. Photos
 * are deleted when the batch is confirmed or discarded.
 */
export function ScanFlow({
  batchId: initialBatchId,
  batchName,
  mode: initialMode,
  photos: initialPhotos,
  items: initialItems,
  decks,
  deckId: initialDeckId,
  owner: initialOwner,
  owners,
}: {
  batchId: number | null;
  batchName: string | null;
  mode: ScanMode;
  photos: ScanPhotoMeta[];
  items: ScanItemRow[];
  decks: DeckOption[];
  deckId: number | null;
  owner: string | null;
  owners: string[];
}) {
  const [batchId, setBatchId] = useState<number | null>(initialBatchId);
  const batchRef = useRef<number | null>(initialBatchId);
  const [deckId, setDeckId] = useState<number | null>(initialDeckId);
  const deckRef = useRef<number | null>(initialDeckId);
  const [doneDeck, setDoneDeck] = useState<{ id: number; added: number } | null>(null);
  const [asOwner, setAsOwner] = useState<string | null>(initialOwner);
  const ownerRef = useRef<string | null>(initialOwner);
  const chooseOwner = (o: string | null) => {
    setAsOwner(o);
    ownerRef.current = o;
    if (batchRef.current) void setBatchOwnerAction(batchRef.current, o);
  };
  const chooseDeck = (id: number | null) => {
    setDeckId(id);
    deckRef.current = id;
    if (batchRef.current) void setBatchDeckAction(batchRef.current, id);
  };
  const [mode, setMode] = useState<ScanMode>(initialMode);
  // Read by scan workers that outlive the render they were started in.
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const [photos, setPhotos] = useState<Photo[]>(() => initialPhotos.map(fromPhoto));
  const [rows, setRows] = useState<Row[]>(() => initialItems.map(fromItem));
  const [showPhoto, setShowPhoto] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "review">("all");
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const patchPhoto = (key: number, patch: Partial<Photo>) => setPhotos((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  /** Local update + persist the fields the server keeps. */
  const patchRow = (key: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    const persisted: ItemPatch = {};
    for (const k of ["chosen", "manual", "printId", "quantity", "condition", "finish", "include"] as const) {
      if (k in patch) (persisted as Record<string, unknown>)[k] = patch[k];
    }
    if (Object.keys(persisted).length) void updateScanItemAction(key, persisted);
  };

  const ensureBatch = async (): Promise<number> => {
    if (batchRef.current) return batchRef.current;
    const id = await createBatchAction(modeRef.current, deckRef.current, ownerRef.current);
    batchRef.current = id;
    setBatchId(id);
    window.history.replaceState(null, "", `/add/scan?batch=${id}`);
    return id;
  };

  const scanPhoto = async (p: Photo) => {
    patchPhoto(p.key, { status: "reading", error: undefined });
    setRows((rs) => rs.filter((r) => r.photoKey !== p.key));
    let key = p.key;
    try {
      const id = await ensureBatch();
      const fd = new FormData();
      fd.append("mode", modeRef.current);
      if (key > 0) {
        fd.append("photoId", String(key));
      } else {
        if (!p.file) throw new Error("Photo is no longer available on this device.");
        const { blob, width, height } = await downscaleImage(p.file);
        const url = URL.createObjectURL(blob);
        setPhotos((ps) => ps.map((q) => (q.key === key ? (q.url !== url && URL.revokeObjectURL(q.url), { ...q, url, width, height }) : q)));
        fd.append("image", blob, "photo.jpg");
        fd.append("batchId", String(id));
        fd.append("position", String(photos.length));
      }
      const res = await fetch("/api/scan", { method: "POST", body: fd });
      const json = (await res.json()) as { photoId?: number; width?: number; height?: number; items?: ScanItemRow[]; unreadable?: number; error?: string };
      if (json.photoId && json.photoId !== key) {
        // Swap the temporary key for the server id; from now on the photo is served from the batch.
        const serverKey = json.photoId;
        setPhotos((ps) =>
          ps.map((q) => {
            if (q.key !== key) return q;
            URL.revokeObjectURL(q.url);
            return { ...q, key: serverKey, file: undefined, url: photoUrl(serverKey), width: json.width ?? q.width, height: json.height ?? q.height };
          }),
        );
        key = serverKey;
      }
      if (!res.ok || !json.items) throw new Error(json.error ?? `Scan failed (${res.status})`);
      const fresh = json.items.map(fromItem);
      setRows((rs) => [...rs.filter((r) => r.photoKey !== key), ...fresh]);
      patchPhoto(key, { status: "done", found: fresh.length, unreadable: json.unreadable ?? 0 });
    } catch (err) {
      patchPhoto(key, { status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  };

  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (fileRef.current) fileRef.current.value = "";
    if (files.length === 0) return;
    setDone(null);
    const created: Photo[] = files.map((file) => ({ key: tempKey--, file, url: URL.createObjectURL(file), width: 0, height: 0, status: "queued" }));
    setPhotos((ps) => [...ps, ...created]);
    await ensureBatch();
    const queue = [...created];
    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) await scanPhoto(p);
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
  };

  const link = async (row: Row, hit: CardHit) => {
    const prints = await printsForCardAction(hit.id);
    patchRow(row.key, { chosen: { ...hit, prints }, manual: true, searching: false, printId: prints[0]?.id ?? null, include: true });
  };

  const chooseCandidate = (row: Row, cardId: string) => {
    const cand = row.detection.candidates.find((c) => c.id === cardId);
    if (cand) patchRow(row.key, { chosen: cand, manual: false, printId: cand.prints[0]?.id ?? null, include: true });
  };

  const reset = () => {
    for (const p of photos) if (p.key < 0) URL.revokeObjectURL(p.url);
    setPhotos([]);
    setRows([]);
    setExpanded(null);
    setShowPhoto(null);
    setFilter("all");
    batchRef.current = null;
    setBatchId(null);
    window.history.replaceState(null, "", "/add/scan");
  };

  const confirm = () =>
    start(async () => {
      if (!batchRef.current) return;
      const { added, deckAdded, deckId: targetDeck } = await completeBatchAction(batchRef.current);
      setDone(added);
      setDoneDeck(targetDeck ? { id: targetDeck, added: deckAdded } : null);
      reset();
    });

  const discard = () =>
    start(async () => {
      if (batchRef.current && !window.confirm("Discard this batch and its photos?")) return;
      if (batchRef.current) await deleteBatchAction(batchRef.current);
      reset();
    });

  const busy = photos.some((p) => p.status === "queued" || p.status === "reading");
  const ready = rows.filter((r) => r.include && r.printId);
  const reviewCount = rows.filter(needsReview).length;
  const unmatched = rows.filter((r) => !r.chosen).length;
  const visible = filter === "review" ? rows.filter(needsReview) : rows;
  const shown = photos.find((p) => p.key === showPhoto) ?? null;
  const select = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1 text-xs text-space-100";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-space-700/70 bg-space-900/50 p-3">
        <div className="flex rounded-md border border-space-600 p-0.5 text-sm">
          {(["single", "batch"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`tap rounded px-3 py-1 ${mode === m ? "bg-ki-500 font-semibold text-space-950" : "text-space-200"}`}>
              {m === "single" ? "One card per photo" : "Several per photo"}
            </button>
          ))}
        </div>
        <label className="tap ml-auto cursor-pointer rounded-md bg-ki-500 px-4 py-2 text-sm font-semibold text-space-950 hover:bg-ki-400">
          {photos.length ? "Add photos" : "Take photos / upload"}
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
        </label>
        <p className="w-full text-xs text-space-300">
          Select as many photos as you like — each is read separately. {mode === "single" ? "Fill the frame with one card, number readable in the bottom corner." : "Lay cards out flat with no overlap; a binder page works well."}{" "}
          {batchId ? (
            <>
              Progress is saved in <span className="text-space-100">{batchName ?? `batch #${batchId}`}</span> — open <span className="font-mono text-space-100">/add/scan</span> on another device to continue there. Photos are deleted once you confirm or discard.
            </>
          ) : (
            "Photos and your review are saved as a batch, so you can upload from the phone and finish on the PC."
          )}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <OwnerPicker owners={owners} value={asOwner} onChange={chooseOwner} label="These cards belong to" />
        <DeckPicker decks={decks} value={deckId} onChange={chooseDeck} />
      </div>

      {done != null ? (
        <p className="rounded-xl border border-gain/40 bg-gain/5 p-3 text-sm text-gain">
          Added {done} card{done === 1 ? "" : "s"} to your collection
          {doneDeck ? (
            <>
              {" "}
              and {doneDeck.added} to{" "}
              <Link href={`/decks/${doneDeck.id}`} className="underline">
                the deck
              </Link>
            </>
          ) : null}
          . <Link href="/collection" className="underline">View collection</Link>
        </p>
      ) : null}

      {photos.length ? (
        <div className="space-y-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.map((p, i) => (
              <button
                key={p.key}
                onClick={() => setShowPhoto(showPhoto === p.key ? null : p.key)}
                className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border ${showPhoto === p.key ? "border-ki-500" : p.status === "error" ? "border-loss/60" : "border-space-700"}`}
                title={`Photo ${i + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={`Photo ${i + 1}`} className={`h-full w-full object-cover ${p.status === "done" || p.status === "error" ? "" : "opacity-50"}`} />
                <span className={`absolute inset-x-0 bottom-0 truncate bg-space-950/80 px-1 text-center text-[10px] ${p.status === "error" ? "text-loss" : "text-space-100"}`}>
                  {p.status === "queued" ? "waiting" : p.status === "reading" ? "reading…" : p.status === "error" ? "failed" : `${p.found ?? 0} card${p.found === 1 ? "" : "s"}`}
                </span>
              </button>
            ))}
          </div>
          {shown ? (
            <div className="space-y-1 rounded-xl border border-space-700/70 bg-space-900/50 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shown.url} alt="Your photo" className="max-h-96 w-full rounded-lg object-contain" />
              {shown.status === "error" ? (
                <div className="flex items-center gap-2 text-sm text-loss">
                  <span className="min-w-0 flex-1">{shown.error}</span>
                  <button onClick={() => scanPhoto(shown)} className="tap rounded-md border border-space-600 px-3 py-1 text-xs text-space-100 hover:bg-space-800">
                    Retry
                  </button>
                </div>
              ) : shown.status === "done" && shown.unreadable ? (
                <p className="text-xs text-space-400">{shown.unreadable} card{shown.unreadable === 1 ? "" : "s"} visible but unreadable.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {photos.length ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="flex rounded-md border border-space-600 p-0.5 text-xs">
              <button onClick={() => setFilter("all")} className={`tap rounded px-2 py-1 ${filter === "all" ? "bg-space-700 text-space-50" : "text-space-300"}`}>
                All ({rows.length})
              </button>
              <button onClick={() => setFilter("review")} className={`tap rounded px-2 py-1 ${filter === "review" ? "bg-space-700 text-space-50" : "text-space-300"}`}>
                Needs review ({reviewCount})
              </button>
            </div>
            <span className="text-xs text-space-400">
              {busy ? "Reading photos… " : ""}
              {rows.length - reviewCount} confident · {reviewCount - unmatched} unsure · {unmatched} unmatched
            </span>
            <span className="ml-auto flex gap-2">
              <button onClick={discard} disabled={pending || busy} className="tap rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-300 hover:bg-space-800 hover:text-loss disabled:opacity-50">
                Discard
              </button>
              <button onClick={confirm} disabled={pending || busy || ready.length === 0} className="tap rounded-md bg-ki-500 px-4 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50">
                {pending ? "Saving…" : `Add ${ready.reduce((n, r) => n + r.quantity, 0)} to collection`}
              </button>
            </span>
          </div>

          {rows.length > 0 && visible.length === 0 ? <p className="text-sm text-space-300">Nothing left to review.</p> : null}

          <ul className="space-y-2">
            {photos.map((p, pi) => {
              const mine = visible.filter((r) => r.photoKey === p.key);
              if (mine.length === 0) return null;
              return (
                <li key={p.key} className="space-y-2">
                  {photos.length > 1 ? <div className="text-[11px] uppercase tracking-wide text-space-400">Photo {pi + 1}</div> : null}
                  <ul className="space-y-2">
                    {mine.map((r) => (
                      <ScanRow
                        key={r.key}
                        row={r}
                        photo={p}
                        expanded={expanded === r.key}
                        onToggle={() => setExpanded(expanded === r.key ? null : r.key)}
                        onPatch={(patch) => patchRow(r.key, patch)}
                        onLink={(hit) => link(r, hit)}
                        onCandidate={(id) => chooseCandidate(r, id)}
                        selectClass={select}
                      />
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ScanRow({
  row: r,
  photo,
  expanded,
  onToggle,
  onPatch,
  onLink,
  onCandidate,
  selectClass,
}: {
  row: Row;
  photo: Photo;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<Row>) => void;
  onLink: (hit: CardHit) => void;
  onCandidate: (cardId: string) => void;
  selectClass: string;
}) {
  const [full, setFull] = useState(false);
  const seen = r.detection.seen;
  const cand = r.chosen;
  const linking = !cand || r.searching;
  const tone = !cand ? "border-loss/50" : needsReview(r) ? "border-ki-500/50" : "border-space-700";

  return (
    <li className={`rounded-xl border p-2 ${tone} ${r.include && cand ? "" : "bg-space-900/40"}`}>
      <div className="flex gap-2">
        <button onClick={onToggle} className="flex shrink-0 gap-1" aria-expanded={expanded} title={expanded ? "Hide comparison" : "Compare photo with catalog art"}>
          <PhotoCrop photo={photo} box={seen.box} className="w-14" />
          <div className="w-14">
            <CardImage src={cand?.imageUrl} alt={cand?.name ?? "?"} sizes="56px" />
          </div>
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start gap-2">
            <input type="checkbox" checked={r.include} disabled={!cand} onChange={(e) => onPatch({ include: e.target.checked })} className="mt-1 h-4 w-4 shrink-0" aria-label="Include" />
            <div className="min-w-0 flex-1">
              {linking ? (
                <div className="space-y-1">
                  {!cand ? <div className="text-sm text-loss">No catalog match — link it:</div> : null}
                  <div className="flex items-center gap-1">
                    <CardSearchInput initialQuery={seen.number ?? seen.name} onPick={onLink} className="flex-1" />
                    {cand ? (
                      <button onClick={() => onPatch({ searching: false })} className="tap rounded px-2 text-xs text-space-400 hover:text-space-50">
                        cancel
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex items-baseline gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-space-50">{cand.name}</div>
                    <div className="font-mono text-xs text-space-300">{cand.id}</div>
                  </div>
                  <button onClick={() => onPatch({ searching: true })} className="tap rounded px-2 text-xs text-space-400 hover:text-space-50">
                    change
                  </button>
                </div>
              )}
              <div className="text-[11px] text-space-400">
                Read: {seen.name} {seen.number ?? "(no number)"} · {seen.position}
                {seen.notes ? ` · ${seen.notes}` : ""}
              </div>
            </div>
            <Confidence row={r} />
          </div>
          {!r.manual && r.detection.candidates.length > 1 ? (
            <select value={cand?.id ?? ""} onChange={(e) => onCandidate(e.target.value)} className={`${selectClass} w-full`}>
              {r.detection.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {c.name}
                </option>
              ))}
            </select>
          ) : null}
          {cand ? (
            <div className="flex flex-wrap gap-1">
              {cand.prints.length > 1 ? (
                <select value={r.printId ?? ""} onChange={(e) => onPatch({ printId: e.target.value })} className={selectClass}>
                  {cand.prints.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              ) : null}
              <input type="number" min={1} value={r.quantity} onChange={(e) => onPatch({ quantity: Math.max(1, Number(e.target.value) || 1) })} className={`${selectClass} w-14`} aria-label="Quantity" />
              <select value={r.condition} onChange={(e) => onPatch({ condition: e.target.value })} className={selectClass}>
                {CONDITIONS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <select value={r.finish} onChange={(e) => onPatch({ finish: e.target.value })} className={selectClass}>
                <option value="normal">Non-foil</option>
                <option value="foil">Foil</option>
              </select>
            </div>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="mt-2 grid grid-cols-2 gap-3 border-t border-space-800 pt-2">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-space-400">
              <span>From your photo</span>
              {seen.box ? (
                <button onClick={() => setFull((f) => !f)} className="tap normal-case text-space-300 hover:text-space-50">
                  {full ? "show crop" : "show whole photo"}
                </button>
              ) : null}
            </div>
            <PhotoCrop photo={photo} box={full ? null : seen.box} className="mx-auto w-full max-w-[240px]" />
          </div>
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wide text-space-400">Catalog{cand ? ` · ${cand.id}` : ""}</div>
            <div className="mx-auto w-full max-w-[240px]">
              <CardImage src={cand?.imageUrl} alt={cand?.name ?? "No match yet"} sizes="240px" />
            </div>
          </div>
          <p className="col-span-2 text-xs text-space-300">
            Claude read <span className="text-space-100">{seen.name}</span> {seen.number ? <span className="font-mono text-space-100">{seen.number}</span> : "(no number)"} at {Math.round(seen.confidence * 100)}% read confidence.{" "}
            {r.manual ? "You linked this card by hand." : describeMatch(r)}
          </p>
        </div>
      ) : null}
    </li>
  );
}

function describeMatch(r: Row): string {
  switch (r.detection.matchedBy) {
    case "number":
      return "The number matched a catalog card and the name agrees.";
    case "number-name-differs":
      return `The number matched ${r.detection.candidates[0]?.id ?? "a card"} but its name (${r.detection.candidates[0]?.name ?? "?"}) differs from what was read — a digit may be misread.`;
    case "name":
      return "No catalog card has that number; matched by name only.";
    default:
      return "Nothing in the catalog matched the number or the name.";
  }
}

function Confidence({ row: r }: { row: Row }) {
  if (r.manual) return <span className="shrink-0 rounded-full border border-space-600 px-2 py-0.5 text-[11px] text-space-200">linked</span>;
  if (!r.chosen) return <span className="shrink-0 rounded-full bg-loss/15 px-2 py-0.5 text-[11px] font-semibold text-loss">no match</span>;
  const c = r.detection.matchConfidence;
  const cls = c >= REVIEW_THRESHOLD ? "bg-gain/15 text-gain" : c >= 0.5 ? "bg-ki-500/20 text-ki-300" : "bg-loss/15 text-loss";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`} title={describeMatch(r)}>
      {Math.round(c * 100)}%
    </span>
  );
}

/** The card's region of the photo (or the whole photo when no box was given). */
function PhotoCrop({ photo, box, className = "" }: { photo: Photo; box: Box | null; className?: string }) {
  if (!box) {
    return (
      <div className={`card-aspect flex items-center justify-center overflow-hidden rounded-lg bg-space-900 ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt="Your photo" className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  const aspect = photo.width && photo.height ? (box.w * photo.width) / (box.h * photo.height) : 63 / 88;
  return (
    <div className={`relative overflow-hidden rounded-lg bg-space-900 ${className}`} style={{ aspectRatio: aspect }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt="Card in your photo"
        className="absolute max-w-none"
        style={{ left: `${(-box.x / box.w) * 100}%`, top: `${(-box.y / box.h) * 100}%`, width: `${100 / box.w}%`, height: `${100 / box.h}%` }}
      />
    </div>
  );
}
