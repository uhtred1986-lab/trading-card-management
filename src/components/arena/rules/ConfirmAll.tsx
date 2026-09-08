"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { confirmAllAction, undoConfirmAction } from "@/app/arena/actions";
import type { RuleFilter } from "@/lib/arena/rules-store";

/**
 * "Confirm all drafts in view", and the way back.
 *
 * It confirms what the *filter* matches, not the page you can see — a page is
 * 200 rows and a wording can be 400 — so the count is said before and after,
 * and a press over `ASK_ABOVE` rows is confirmed once first. Undo is offered
 * for as long as the batch is on the feedback row, so it survives a reload;
 * a row edited since is left alone and reported.
 */
const ASK_ABOVE = 500;

export function ConfirmAll({ filter, drafts, label = "Confirm all drafts in view", batches }: { filter: RuleFilter; drafts: number; label?: string; batches: { id: number; note: string; n: number }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  const run = (fn: () => Promise<{ error: string | null; said: string }>) => {
    setError(null);
    setSaid(null);
    setAsked(false);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        setSaid(r.said);
        router.refresh();
      }
    });
  };

  const confirm = () =>
    run(async () => {
      const r = await confirmAllAction(filter);
      return { error: r.error, said: r.confirmed ? `${r.confirmed} confirmed.` : "nothing to confirm." };
    });

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      {drafts > 0 &&
        (asked ? (
          <>
            <span className="text-ki-300">Confirm {drafts} drafts at once?</span>
            <button type="button" disabled={pending} className="tap rounded-lg bg-ki-500 px-2.5 py-1 font-semibold text-space-950 disabled:opacity-50" onClick={confirm}>
              Yes, confirm {drafts}
            </button>
            <button type="button" className="tap text-space-400" onClick={() => setAsked(false)}>
              cancel
            </button>
          </>
        ) : (
          <button type="button" disabled={pending} className="tap rounded-lg border border-space-600 px-2.5 py-1 font-semibold text-space-100 hover:border-space-300 disabled:opacity-50" onClick={() => (drafts > ASK_ABOVE ? setAsked(true) : confirm())}>
            {label} ({drafts})
          </button>
        ))}
      {batches.map((b) => (
        <button
          key={b.id}
          type="button"
          disabled={pending}
          className="tap rounded-lg border border-dashed border-space-600 px-2.5 py-1 text-space-300 hover:text-ki-300 disabled:opacity-50"
          title={b.note}
          onClick={() =>
            run(async () => {
              const r = await undoConfirmAction(b.id);
              return { error: r.error, said: `${r.reverted} back to draft${r.kept ? `, ${r.kept} left as they were changed since` : ""}.` };
            })
          }
        >
          undo {b.n}
        </button>
      ))}
      {pending && <span className="text-space-400">working…</span>}
      {said && !pending && <span className="text-gain">{said}</span>}
      {error && <span className="text-loss">{error}</span>}
    </div>
  );
}
