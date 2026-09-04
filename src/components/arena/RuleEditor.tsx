"use client";

import { useState, useTransition } from "react";
import { checkRule, clearRule, saveEmptyRule, saveRule } from "@/app/arena/actions";
import type { RulePreview } from "@/lib/arena/rules";

/**
 * Setting the rule for one skill.
 *
 * You edit the card's line and press Read it. The engine's own compiler
 * answers — the same one that reads every other card — and says back, in plain
 * words, what it will do. Nothing is kept until you say so, and what is kept
 * is what you just read.
 *
 * Writing the wording rather than filling in a form is deliberate: the
 * compiler is already the parser for this language, so there is no second
 * implementation here to drift away from the one the game uses.
 */
export function RuleEditor({
  cardId,
  skillIndex,
  side,
  printed,
  stored,
}: {
  cardId: string;
  skillIndex: number;
  side: "front" | "back";
  printed: string;
  stored: { explanation: string | null; meaning: string | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const [line, setLine] = useState(stored?.explanation ?? printed);
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const read = () =>
    start(async () => {
      setError(null);
      setPreview(await checkRule(line));
    });

  const keep = () =>
    start(async () => {
      const r = await saveRule(cardId, skillIndex, side, line);
      if (r.error) setError(r.error);
      else {
        setOpen(false);
        setPreview(null);
      }
    });

  const keepEmpty = () =>
    start(async () => {
      await saveEmptyRule(cardId, skillIndex, side, line);
      setOpen(false);
      setPreview(null);
    });

  const drop = () =>
    start(async () => {
      await clearRule(cardId, skillIndex, side);
      setOpen(false);
      setPreview(null);
      setLine(printed);
    });

  if (!open) {
    return (
      <div className="mt-1 flex flex-wrap gap-2">
        <button type="button" onClick={() => setOpen(true)} className="tap rounded-md border border-space-600 px-2.5 py-1 text-[11px] text-space-100 hover:bg-space-800">
          {stored ? "Change this rule" : "Set the rule"}
        </button>
        {stored && (
          <button type="button" onClick={drop} disabled={pending} className="tap rounded-md px-2.5 py-1 text-[11px] text-space-400 hover:text-loss disabled:opacity-50">
            back to the compiler&rsquo;s reading
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-space-600 bg-space-950/60 p-2">
      <label className="block text-[11px] text-space-300">
        The card&rsquo;s line. Keep the tags in front — they decide <em>when</em> the skill happens.
        <textarea
          value={line}
          onChange={(e) => {
            setLine(e.target.value);
            setPreview(null);
          }}
          rows={3}
          autoFocus
          className="mt-1 w-full rounded-md border border-space-600 bg-space-900 p-2 font-mono text-[11px] text-space-100"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={read} disabled={pending || !line.trim()} className="tap rounded-md border border-space-600 px-3 py-1.5 text-[11px] text-space-100 disabled:opacity-50">
          {pending ? "reading…" : "Read it"}
        </button>
        {line !== printed && (
          <button type="button" onClick={() => { setLine(printed); setPreview(null); }} className="tap text-[11px] text-space-400">
            back to the printed text
          </button>
        )}
        <button type="button" onClick={() => setOpen(false)} className="tap ml-auto text-[11px] text-space-400">
          cancel
        </button>
      </div>

      {preview && (
        <div className="space-y-2 rounded-md bg-space-900 p-2 text-[11px]">
          <p className="text-space-400">
            Read as a <span className="text-space-100">{preview.kind ?? "—"}</span> skill.
          </p>
          {preview.unsupported.length > 0 ? (
            <p className="text-loss">
              Not understood: {preview.unsupported.join(" | ")}
              <span className="mt-1 block text-space-400">Reword that part, or leave it and let Claude rule on the card at runtime.</span>
            </p>
          ) : preview.ops.length ? (
            <p className="text-gain">
              <span className="text-space-400">The engine will: </span>
              {preview.reads}
            </p>
          ) : (
            <p className="text-space-300">It reads as doing nothing at all.</p>
          )}

          <details>
            <summary className="cursor-pointer text-space-500">the program itself</summary>
            <pre className="mt-1 max-h-56 overflow-auto rounded bg-space-950 p-2 font-mono text-[10px] text-space-300">{JSON.stringify(preview.ops, null, 1)}</pre>
          </details>

          <div className="flex flex-wrap items-center gap-2">
            {preview.unsupported.length === 0 && preview.ops.length > 0 && (
              <button type="button" onClick={keep} disabled={pending} className="tap rounded-md bg-ki-500 px-3 py-1.5 text-[11px] font-semibold text-space-950 disabled:opacity-50">
                Keep this reading
              </button>
            )}
            {preview.unsupported.length === 0 && preview.ops.length === 0 && (
              <button type="button" onClick={keepEmpty} disabled={pending} className="tap rounded-md border border-space-600 px-3 py-1.5 text-[11px] text-space-100 disabled:opacity-50">
                Keep it as doing nothing
              </button>
            )}
            {error && <span className="text-loss">{error}</span>}
          </div>
        </div>
      )}

      {stored?.meaning && !preview && (
        <p className="text-[11px] text-space-400">
          <span className="text-space-500">Kept now: </span>
          {stored.meaning}
        </p>
      )}
    </div>
  );
}
