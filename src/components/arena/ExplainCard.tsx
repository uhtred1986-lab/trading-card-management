"use client";

import { useState, useTransition } from "react";
import { explainCard } from "@/app/arena/actions";

/**
 * You say what the card actually does; Claude turns it into two things — a
 * program saved against the card so it plays correctly from the next game on,
 * and a work item for teaching the compiler the wording so every card that
 * phrases it the same way is fixed for good.
 *
 * The second one is the point. Copy it and hand it to Claude Code.
 */
export function ExplainCard({
  noteId,
  cardName,
  clause,
  explanation,
  meaning,
  brief,
  hasProgram,
}: {
  noteId: number;
  cardName: string;
  clause: string;
  explanation: string | null;
  meaning: string | null;
  brief: string | null;
  hasProgram: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(explanation ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = () => {
    if (!text.trim()) return;
    setError(null);
    start(async () => {
      const r = await explainCard(noteId, text);
      if (r.error) setError(r.error);
      else setOpen(false);
    });
  };

  const copy = async () => {
    if (!brief) return;
    await navigator.clipboard.writeText(`Teach the arena's card-text compiler this wording.\n\n${brief}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="mt-2 space-y-2">
      {meaning && (
        <p className="rounded border-l-2 border-gain bg-space-900 p-2 text-[11px] text-space-200">
          <span className="text-space-400">Read as: </span>
          {meaning}
          {hasProgram && <span className="ml-1 text-gain">· saved, so this card plays correctly now</span>}
        </p>
      )}

      {!open ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setOpen(true)} className="tap rounded-md border border-space-600 px-2.5 py-1 text-[11px] text-space-100 hover:bg-space-800">
            {explanation ? "Explain it differently" : "Tell Claude what this card does"}
          </button>
          {brief && (
            <button type="button" onClick={copy} className="tap rounded-md border border-ki-500/60 px-2.5 py-1 text-[11px] text-ki-300 hover:bg-space-800">
              {copied ? "copied" : "Copy the work item for Claude Code"}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-space-600 bg-space-950/60 p-2">
          <label className="block text-[11px] text-space-300">
            What does <span className="text-space-100">{cardName}</span> actually do here? The part the engine could not read is
            <span className="text-space-100"> “{clause}”</span>. Plain words are fine — say it as you would to another player.
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            autoFocus
            placeholder="e.g. you pick one of your opponent's Battle Cards that costs 3 or less and put it on the bottom of their deck, but only if your leader is red"
            className="w-full rounded-md border border-space-600 bg-space-900 p-2 text-xs text-space-100"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={submit} disabled={pending || !text.trim()} className="tap rounded-md bg-ki-500 px-3 py-1.5 text-[11px] font-semibold text-space-950 disabled:opacity-50">
              {pending ? "Claude is working it out…" : "Turn this into a rule"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="tap text-[11px] text-space-400">
              cancel
            </button>
            {error && <span className="text-[11px] text-loss">{error}</span>}
          </div>
        </div>
      )}

      {brief && (
        <details className="rounded-lg border border-space-700 bg-space-950/60">
          <summary className="cursor-pointer p-2 text-[11px] text-space-300">the work item, in full</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-2 font-mono text-[10px] leading-relaxed text-space-300">{brief}</pre>
        </details>
      )}
    </div>
  );
}
