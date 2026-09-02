"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { addLot, deleteLot, printsForCardAction } from "@/app/collection/actions";
import type { ScanCandidate, ScanDetection } from "@/lib/ai/scan";
import { REVIEW_THRESHOLD } from "@/lib/ai/scan-match";
import { CONDITIONS } from "@/lib/collection/queries";
import type { DeckOption } from "@/lib/decks/add";
import { downscaleImage } from "@/lib/scan/downscale";
import { CardImage } from "./CardImage";
import { CardSearchInput, type CardHit } from "./CardSearchInput";
import { DeckPicker } from "./DeckPicker";

interface Saved {
  lotId: number;
  cardId: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  printLabel: string;
}

type Phase = { kind: "idle" } | { kind: "reading"; preview: string } | { kind: "error"; message: string; preview: string } | { kind: "confirm"; preview: string; detections: ScanDetection[]; chosenIndex: number };

/**
 * Phone loop: take a photo → identified at once → confirm quantity with big
 * buttons → saved → camera opens again. Nothing is stored until "Save".
 */
export function QuickCapture({ owner, decks }: { owner: string | null; decks: DeckOption[] }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [deckId, setDeckId] = useState<number | null>(null);
  const [deckName, setDeckName] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ScanCandidate | null>(null);
  const [manual, setManual] = useState(false);
  const [searching, setSearching] = useState(false);
  const [printId, setPrintId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState("NM");
  const [finish, setFinish] = useState("normal");
  const [autoNext, setAutoNext] = useState(true);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const openCamera = () => fileRef.current?.click();

  const applyDetection = (d: ScanDetection | undefined) => {
    const best = d?.candidates[0] ?? null;
    setChosen(best);
    setManual(false);
    setSearching(false);
    setPrintId(best?.prints[0]?.id ?? null);
    setQuantity(1);
  };

  const onFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (phase.kind !== "idle" && "preview" in phase) URL.revokeObjectURL(phase.preview);
    const { blob } = await downscaleImage(file);
    const preview = URL.createObjectURL(blob);
    setPhase({ kind: "reading", preview });
    try {
      const fd = new FormData();
      fd.append("image", blob, "photo.jpg");
      const res = await fetch("/api/scan/quick", { method: "POST", body: fd });
      const json = (await res.json()) as { detections?: ScanDetection[]; error?: string };
      if (!res.ok || !json.detections) throw new Error(json.error ?? `Scan failed (${res.status})`);
      if (json.detections.length === 0) throw new Error("No card could be read — try again with the number in focus.");
      applyDetection(json.detections[0]);
      setPhase({ kind: "confirm", preview, detections: json.detections, chosenIndex: 0 });
    } catch (err) {
      setPhase({ kind: "error", preview, message: err instanceof Error ? err.message : String(err) });
    }
  };

  const link = async (hit: CardHit) => {
    const prints = await printsForCardAction(hit.id);
    setChosen({ ...hit, prints });
    setManual(true);
    setSearching(false);
    setPrintId(prints[0]?.id ?? null);
  };

  const save = () => {
    if (!chosen || !printId) return;
    // Opening the camera must happen inside the click handler to count as a user gesture.
    if (autoNext) openCamera();
    const snapshot = { chosen, printId, quantity, condition, finish, deckId };
    start(async () => {
      const { id } = await addLot({ printId: snapshot.printId, quantity: snapshot.quantity, condition: snapshot.condition, finish: snapshot.finish }, snapshot.deckId);
      setSaved((s) => [
        { lotId: id, cardId: snapshot.chosen.id, name: snapshot.chosen.name, imageUrl: snapshot.chosen.imageUrl, quantity: snapshot.quantity, printLabel: snapshot.chosen.prints.find((p) => p.id === snapshot.printId)?.label ?? "" },
        ...s,
      ]);
      if (phase.kind !== "idle" && "preview" in phase) URL.revokeObjectURL(phase.preview);
      setPhase({ kind: "idle" });
      setChosen(null);
    });
  };

  const undo = (lot: Saved) =>
    start(async () => {
      await deleteLot(lot.lotId);
      setSaved((s) => s.filter((x) => x.lotId !== lot.lotId));
    });

  const detection = phase.kind === "confirm" ? phase.detections[phase.chosenIndex] : null;
  const confidence = detection?.matchConfidence ?? 0;
  const big = "tap flex h-14 w-14 items-center justify-center rounded-xl border border-space-600 text-2xl font-semibold text-space-50 hover:bg-space-800 disabled:opacity-40";
  const select = "tap rounded-md border border-space-600 bg-space-900 px-2 py-2 text-sm text-space-100";

  return (
    <div className="mx-auto max-w-md space-y-4">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

      <DeckPicker
        decks={decks}
        value={deckId}
        onChange={(id, deck) => {
          setDeckId(id);
          setDeckName(deck?.name ?? null);
        }}
      />

      {phase.kind === "idle" ? (
        <button onClick={openCamera} className="tap flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-ki-500/60 bg-ki-500/5 px-4 py-12 text-ki-300 hover:bg-ki-500/10">
          <span className="text-5xl" aria-hidden>
            📷
          </span>
          <span className="text-lg font-semibold">Take a photo of one card</span>
          <span className="text-xs text-space-300">Fill the frame; keep the number in the bottom corner sharp.</span>
        </button>
      ) : null}

      {phase.kind === "reading" ? (
        <div className="space-y-2 rounded-2xl border border-space-700/70 bg-space-900/50 p-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={phase.preview} alt="Your photo" className="mx-auto max-h-64 rounded-lg object-contain opacity-70" />
          <p className="animate-pulse text-sm text-space-200">Reading the card…</p>
        </div>
      ) : null}

      {phase.kind === "error" ? (
        <div className="space-y-2 rounded-2xl border border-loss/40 bg-loss/5 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={phase.preview} alt="Your photo" className="mx-auto max-h-48 rounded-lg object-contain" />
          <p className="text-sm text-loss">{phase.message}</p>
          <div className="flex gap-2">
            <button onClick={openCamera} className="tap flex-1 rounded-md bg-ki-500 px-3 py-2 text-sm font-semibold text-space-950 hover:bg-ki-400">
              Try again
            </button>
            <button onClick={() => setPhase({ kind: "idle" })} className="tap rounded-md border border-space-600 px-3 py-2 text-sm text-space-200 hover:bg-space-800">
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {phase.kind === "confirm" && detection ? (
        <div className="space-y-3 rounded-2xl border border-space-700/70 bg-space-900/50 p-3">
          <div className="flex gap-3">
            <div className="w-24 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={phase.preview} alt="Your photo" className="card-aspect w-full rounded-lg object-cover" />
            </div>
            <div className="w-24 shrink-0">
              <CardImage src={chosen?.imageUrl} alt={chosen?.name ?? "?"} sizes="96px" />
            </div>
            <div className="min-w-0 flex-1">
              {chosen && !searching ? (
                <>
                  <div className="font-medium leading-tight text-space-50">{chosen.name}</div>
                  <div className="font-mono text-xs text-space-300">{chosen.id}</div>
                  <div className="mt-1">
                    {manual ? (
                      <span className="rounded-full border border-space-600 px-2 py-0.5 text-[11px] text-space-200">linked by you</span>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${confidence >= REVIEW_THRESHOLD ? "bg-gain/15 text-gain" : confidence >= 0.5 ? "bg-ki-500/20 text-ki-300" : "bg-loss/15 text-loss"}`}>{Math.round(confidence * 100)}% match</span>
                    )}
                  </div>
                  <button onClick={() => setSearching(true)} className="tap mt-1 text-xs text-space-400 underline hover:text-space-50">
                    Not this card?
                  </button>
                </>
              ) : (
                <div className="space-y-1">
                  <div className="text-sm text-space-200">{chosen ? "Pick the right card:" : "No match — search for it:"}</div>
                  <CardSearchInput initialQuery={detection.seen.number ?? detection.seen.name} onPick={link} />
                  {chosen ? (
                    <button onClick={() => setSearching(false)} className="tap text-xs text-space-400 hover:text-space-50">
                      cancel
                    </button>
                  ) : null}
                </div>
              )}
              <div className="mt-1 text-[11px] text-space-400">
                Read: {detection.seen.name} {detection.seen.number ?? "(no number)"}
              </div>
            </div>
          </div>

          {!manual && detection.candidates.length > 1 ? (
            <select
              value={chosen?.id ?? ""}
              onChange={(e) => {
                const c = detection.candidates.find((x) => x.id === e.target.value);
                if (c) {
                  setChosen(c);
                  setPrintId(c.prints[0]?.id ?? null);
                }
              }}
              className={`${select} w-full`}
            >
              {detection.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {c.name}
                </option>
              ))}
            </select>
          ) : null}
          {phase.detections.length > 1 ? (
            <p className="text-xs text-space-400">
              {phase.detections.length} cards seen — using the best match.{" "}
              <button
                onClick={() => {
                  const next = (phase.chosenIndex + 1) % phase.detections.length;
                  applyDetection(phase.detections[next]);
                  setPhase({ ...phase, chosenIndex: next });
                }}
                className="tap underline hover:text-space-50"
              >
                Next one
              </button>
            </p>
          ) : null}

          {chosen ? (
            <>
              <div className="flex items-center justify-center gap-4">
                <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} disabled={quantity <= 1} className={big} aria-label="One fewer">
                  −
                </button>
                <div className="w-20 text-center">
                  <div className="text-4xl font-semibold tabular-nums text-space-50">{quantity}</div>
                  <div className="text-[11px] uppercase tracking-wide text-space-400">cop{quantity === 1 ? "y" : "ies"}</div>
                </div>
                <button onClick={() => setQuantity((q) => Math.min(99, q + 1))} className={big} aria-label="One more">
                  +
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {chosen.prints.length > 1 ? (
                  <select value={printId ?? ""} onChange={(e) => setPrintId(e.target.value)} className={select}>
                    {chosen.prints.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className={`${select} truncate text-space-400`}>{chosen.prints[0]?.label ?? "Standard"}</div>
                )}
                <select value={condition} onChange={(e) => setCondition(e.target.value)} className={select}>
                  {CONDITIONS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <select value={finish} onChange={(e) => setFinish(e.target.value)} className={select}>
                  <option value="normal">Non-foil</option>
                  <option value="foil">Foil</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={save} disabled={pending || !printId} className="tap flex-1 rounded-xl bg-ki-500 px-4 py-3 text-base font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50">
                  {pending ? "Saving…" : `Save ${quantity} & ${autoNext ? "next photo" : "done"}`}
                </button>
                <button
                  onClick={() => {
                    URL.revokeObjectURL(phase.preview);
                    setPhase({ kind: "idle" });
                    setChosen(null);
                  }}
                  className="tap rounded-xl border border-space-600 px-4 py-3 text-sm text-space-300 hover:bg-space-800"
                >
                  Skip
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-xs text-space-300">
        <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} className="h-4 w-4" />
        Open the camera again right after saving
      </label>

      {saved.length ? (
        <section>
          <h2 className="mb-1 flex items-baseline justify-between text-sm font-semibold uppercase tracking-wider text-space-300">
            Added this session
            <span className="text-xs font-normal normal-case">
              {saved.reduce((n, s) => n + s.quantity, 0)} cards{owner ? ` · owner ${owner}` : ""}
              {deckId ? (
                <>
                  {" · → "}
                  <Link href={`/decks/${deckId}`} className="underline hover:text-ki-300">
                    {deckName ?? "deck"}
                  </Link>
                </>
              ) : null}
            </span>
          </h2>
          <ul className="divide-y divide-space-800 rounded-xl border border-space-700/70">
            {saved.map((s) => (
              <li key={s.lotId} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                <div className="w-8 shrink-0">
                  <CardImage src={s.imageUrl} alt={s.name} sizes="32px" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/cards/${encodeURIComponent(s.cardId)}`} className="block truncate font-medium text-space-50 hover:text-ki-300">
                    {s.name}
                  </Link>
                  <div className="text-xs text-space-400">
                    ×{s.quantity} · {s.printLabel} · <span className="font-mono">{s.cardId}</span>
                  </div>
                </div>
                <button onClick={() => undo(s)} disabled={pending} className="tap rounded px-2 py-1 text-xs text-space-400 hover:bg-space-800 hover:text-loss">
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
