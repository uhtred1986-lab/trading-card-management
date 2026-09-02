"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { addLots, type LotInput } from "@/app/collection/actions";
import type { ScanDetection } from "@/lib/ai/scan";
import { CONDITIONS } from "@/lib/collection/queries";
import { CardImage } from "./CardImage";

interface Row {
  detection: ScanDetection;
  chosen: string | null; // card id
  printId: string | null;
  quantity: number;
  condition: string;
  finish: string;
  include: boolean;
}

/**
 * Photo → identify → review → confirm. Phone-first (camera capture) but the
 * same input accepts a file upload on desktop. The photo itself is never
 * stored: on confirm, only catalog references go into the collection.
 */
export function ScanFlow() {
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [unreadable, setUnreadable] = useState(0);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setRows(null);
    setDone(null);
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("mode", mode);
      const res = await fetch("/api/scan", { method: "POST", body: fd });
      const json = (await res.json()) as { detections?: ScanDetection[]; unreadable?: number; error?: string };
      if (!res.ok || !json.detections) throw new Error(json.error ?? `Scan failed (${res.status})`);
      setUnreadable(json.unreadable ?? 0);
      setRows(
        json.detections.map((d) => {
          const best = d.candidates[0] ?? null;
          return {
            detection: d,
            chosen: best?.id ?? null,
            printId: best?.prints[0]?.id ?? null,
            quantity: 1,
            condition: "NM",
            finish: "normal",
            include: !!best,
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const choose = (i: number, cardId: string) => {
    const cand = rows![i].detection.candidates.find((c) => c.id === cardId);
    update(i, { chosen: cardId, printId: cand?.prints[0]?.id ?? null, include: true });
  };

  const confirm = () =>
    start(async () => {
      const inputs: LotInput[] = rows!
        .filter((r) => r.include && r.printId)
        .map((r) => ({ printId: r.printId!, quantity: r.quantity, condition: r.condition, finish: r.finish }));
      const { added } = await addLots(inputs);
      setDone(added);
      setRows(null);
      setPreview(null);
    });

  const select = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1 text-xs text-space-100";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-space-700/70 bg-space-900/50 p-3">
        <div className="flex rounded-md border border-space-600 p-0.5 text-sm">
          {(["single", "batch"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`tap rounded px-3 py-1 ${mode === m ? "bg-ki-500 font-semibold text-space-950" : "text-space-200"}`}>
              {m === "single" ? "One card" : "Several cards"}
            </button>
          ))}
        </div>
        <label className="tap ml-auto cursor-pointer rounded-md bg-ki-500 px-4 py-2 text-sm font-semibold text-space-950 hover:bg-ki-400">
          {busy ? "Identifying…" : "Take photo / upload"}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <p className="w-full text-xs text-space-300">
          {mode === "single" ? "Fill the frame with one card, number readable in the bottom corner." : "Lay cards out flat with no overlap — a binder page works well. Each guess is shown for review before anything is saved."}
        </p>
      </div>

      {error ? <p className="rounded-xl border border-loss/40 bg-loss/5 p-3 text-sm text-loss">{error}</p> : null}
      {done != null ? (
        <p className="rounded-xl border border-gain/40 bg-gain/5 p-3 text-sm text-gain">
          Added {done} card{done === 1 ? "" : "s"} to your collection. <Link href="/collection" className="underline">View collection</Link>
        </p>
      ) : null}

      {preview && (busy || rows) ? (
        <div className="grid gap-4 md:grid-cols-[minmax(200px,320px)_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Your photo (not stored)" className="max-h-80 w-full rounded-xl object-contain md:max-h-none" />
          <div className="space-y-2">
            {busy ? <p className="text-sm text-space-300">Reading the photo…</p> : null}
            {rows ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-space-300">
                    {rows.length} detected{unreadable ? ` · ${unreadable} unreadable` : ""}
                  </span>
                  <button onClick={confirm} disabled={pending || !rows.some((r) => r.include && r.printId)} className="tap rounded-md bg-ki-500 px-4 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50">
                    {pending ? "Saving…" : `Add ${rows.filter((r) => r.include && r.printId).reduce((n, r) => n + r.quantity, 0)} to collection`}
                  </button>
                </div>
                <ul className="space-y-2">
                  {rows.map((r, i) => {
                    const cand = r.detection.candidates.find((c) => c.id === r.chosen) ?? null;
                    return (
                      <li key={i} className={`rounded-xl border p-2 ${r.include && cand ? "border-space-700" : "border-space-800 opacity-70"}`}>
                        <div className="flex gap-2">
                          <div className="w-14 shrink-0">
                            <CardImage src={cand?.imageUrl} alt={cand?.name ?? "?"} sizes="56px" />
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-start gap-2">
                              <input type="checkbox" checked={r.include} disabled={!cand} onChange={(e) => update(i, { include: e.target.checked })} className="mt-1 h-4 w-4" aria-label="Include" />
                              <div className="min-w-0 flex-1">
                                {cand ? (
                                  <>
                                    <div className="truncate text-sm font-medium text-space-50">{cand.name}</div>
                                    <div className="font-mono text-xs text-space-300">{cand.id}</div>
                                  </>
                                ) : (
                                  <div className="text-sm text-loss">No catalog match</div>
                                )}
                                <div className="text-[11px] text-space-400">
                                  Seen: {r.detection.seen.name} {r.detection.seen.number ?? "(no number)"} · {Math.round(r.detection.seen.confidence * 100)}% · {r.detection.seen.position}
                                  {r.detection.seen.notes ? ` · ${r.detection.seen.notes}` : ""}
                                  {r.detection.exact ? "" : " · matched by name"}
                                </div>
                              </div>
                            </div>
                            {r.detection.candidates.length > 1 ? (
                              <select value={r.chosen ?? ""} onChange={(e) => choose(i, e.target.value)} className={`${select} w-full`}>
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
                                  <select value={r.printId ?? ""} onChange={(e) => update(i, { printId: e.target.value })} className={select}>
                                    {cand.prints.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.label}
                                      </option>
                                    ))}
                                  </select>
                                ) : null}
                                <input type="number" min={1} value={r.quantity} onChange={(e) => update(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} className={`${select} w-14`} aria-label="Quantity" />
                                <select value={r.condition} onChange={(e) => update(i, { condition: e.target.value })} className={select}>
                                  {CONDITIONS.map((c) => (
                                    <option key={c}>{c}</option>
                                  ))}
                                </select>
                                <select value={r.finish} onChange={(e) => update(i, { finish: e.target.value })} className={select}>
                                  <option value="normal">Non-foil</option>
                                  <option value="foil">Foil</option>
                                </select>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
