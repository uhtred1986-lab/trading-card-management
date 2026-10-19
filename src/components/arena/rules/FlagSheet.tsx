"use client";

import { useState } from "react";
import { WRONG_REASONS, reviewText, type ClauseTag, type ReviewText, type WrongReason } from "@/lib/arena/rule-review";
import type { ReviewItem } from "@/lib/arena/rule-review-store";

/**
 * "Wrong…": which part of the skill reads wrong, what is off, an optional note.
 * It saves the report into the row's one flag (`review_flag`) and leaves the rule
 * itself alone; fixing it is Edit rule. A sheet from the bottom on a phone, a
 * dialog on a computer.
 */
export interface FlagVerdict {
  tag: ClauseTag | "UNREAD";
  path: string | null;
  reason: WrongReason;
  note: string;
}

type Part = { key: string; tag: ClauseTag | "UNREAD"; path: string | null; words: string | null; reads: string | null };

/** Every clause in reading order; the unread ones first when the skill is blank, since they are why. */
function partsOf(t: ReviewText): Part[] {
  const clauses: Part[] = t.clauses.map((c, i) => ({ key: `c${i}`, tag: c.tag, path: c.path, words: c.span ? t.printed.slice(c.span.start, c.span.end) : null, reads: c.reads }));
  const unread: Part[] = t.unread.map((u, i) => ({ key: `u${i}`, tag: "UNREAD", path: null, words: u.text, reads: null }));
  return t.blank ? [...unread, ...clauses] : [...clauses, ...unread];
}

export function FlagSheet({ item, busy, error, onSend, onClose }: { item: ReviewItem; busy: boolean; error: string | null; onSend: (v: FlagVerdict) => void; onClose: () => void }) {
  const parts = partsOf(reviewText(item));
  const [pick, setPick] = useState<string | null>(parts[0]?.key ?? null);
  const [reason, setReason] = useState<WrongReason | null>(null);
  const [note, setNote] = useState("");
  const part = parts.find((p) => p.key === pick) ?? parts[0] ?? { key: "", tag: "DO" as const, path: null, words: null, reads: null };
  return (
    <>
      <div className="fixed inset-0 z-40 bg-space-950/60" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Mark this skill Wrong" className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] max-w-xl flex-col rounded-t-3xl border-t border-space-600 bg-space-900 shadow-2xl sm:inset-y-0 sm:my-auto sm:h-fit sm:rounded-2xl sm:border">
        <div className="flex items-center gap-2 border-b border-space-700 py-2 pl-4 pr-2">
          <div className="min-w-0">
            <b className="block text-lg text-space-50">Mark this skill Wrong</b>
            <small className="block truncate text-[13px] text-space-300">
              {item.name} · {item.cardId}
            </small>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="tap ml-auto flex h-11 w-11 items-center justify-center rounded-xl text-xl text-space-300">
            ×
          </button>
        </div>
        <div className="flex flex-col gap-2.5 overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
          {parts.length > 0 && (
            <>
              <h3 className="text-xs font-extrabold uppercase tracking-[0.14em] text-space-300">Which part</h3>
              <div className="flex flex-col gap-1.5">
                {parts.map((p) => (
                  <button key={p.key} type="button" aria-pressed={part.key === p.key} onClick={() => setPick(p.key)} className={`tap grid min-h-[48px] w-full grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-[15px] font-semibold leading-tight text-space-50 ${part.key === p.key ? "border-loss/60 bg-loss/10" : "border-space-700 bg-space-800/40"}`}>
                    <span className="text-[11px] font-bold tracking-wide text-space-300">{p.tag}</span>
                    <span>
                      {p.words ? `“${p.words}”` : p.reads}
                      <small className="block text-[13px] font-normal text-space-300">the engine reads: {p.tag === "UNREAD" ? "nothing" : p.reads}</small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <h3 className="text-xs font-extrabold uppercase tracking-[0.14em] text-space-300">What is off</h3>
          <div className="flex flex-wrap gap-1.5">
            {WRONG_REASONS.map((r) => (
              <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className={`tap min-h-11 rounded-full border px-3.5 text-[15px] font-bold ${reason === r ? "border-loss/60 bg-loss/15 text-space-50" : "border-space-700 bg-space-800/40 text-space-300"}`}>
                {r[0].toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
          <label htmlFor="flag-note" className="text-xs font-extrabold uppercase tracking-[0.14em] text-space-300">
            Note · optional
          </label>
          <textarea id="flag-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. lasts for the battle, not the whole turn" className="h-20 w-full resize-none rounded-xl border border-space-700 bg-space-800/40 px-3 py-2.5 text-base text-space-50 placeholder:text-space-500" />
          {error && (
            <p role="alert" className="text-sm text-loss">
              {error}
            </p>
          )}
          <button type="button" disabled={busy || !reason} onClick={() => reason && onSend({ tag: part.tag, path: part.path, reason, note })} className="tap min-h-12 rounded-2xl bg-loss text-base font-bold text-space-950 disabled:opacity-50">
            {reason ? "Save the mark" : "Choose what is off"}
          </button>
          <p className="text-center text-[13px] text-space-300">The mark is a report, not a correction: the rule stays as it is until you edit it.</p>
        </div>
      </div>
    </>
  );
}
