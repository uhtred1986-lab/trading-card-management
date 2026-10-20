"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { rebuildCardsAction, rebuildDryRunAction } from "@/app/arena/rules/queue-actions";
import type { RebuildPlan } from "@/lib/arena/queue-cards";
import type { Scope } from "@/lib/arena/queue";

/**
 * "N cards need a rebuild before they can play": their stored payment record predates #1066, so
 * the engine refuses the skill. Not a health (it would make every card Incomplete), a step.
 *
 * Dry run reads and counts; Rebuild re-runs the compiler for the compiler's own rows after one
 * more click. Approved and corrected rows are listed and left alone.
 */
export function RebuildBanner({ scope, plan, batch, admin }: { scope: Scope; plan: RebuildPlan; batch: number; admin: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dry, setDry] = useState<RebuildPlan | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  const n = Math.min(plan.rebuildable.length, batch);
  const dryRun = () => {
    setError(null); setSaid(null); setAsked(false);
    start(async () => {
      const r = await rebuildDryRunAction(scope);
      if (r.error) setError(r.error);
      else setDry(r.plan ?? null);
    });
  };
  const rebuild = () => {
    setError(null); setSaid(null); setAsked(false);
    start(async () => {
      const r = await rebuildCardsAction(scope);
      if (r.error) setError(r.error);
      else {
        setSaid(`Rebuilt ${r.rebuilt} card${r.rebuilt === 1 ? "" : "s"}${!r.updated && !r.inserted ? ", but the compiler wrote nothing different" : ""}${r.remaining ? `; ${r.remaining} left, rebuild again` : ""}.`);
        setDry(null);
        router.refresh();
      }
    });
  };

  const p = dry ?? plan;
  const one = (n: number, w: string, many = `${w}s`) => (n === 1 ? w : many);
  const stuck = plan.stuck;
  // Nothing a rebuild can change is left: say so, and point at the cards instead of offering a button that does nothing.
  const onlyStuck = plan.rebuildable.length === 0 && stuck.length > 0;
  const nothingToDo = plan.rebuildable.length === 0;
  return (
    <section aria-label="Rebuild" className="ds-status-warning flex flex-wrap items-center gap-4 rounded-xl p-4 sm:px-5 sm:py-4">
      <div className="min-w-0 flex-1 basis-72">
        {onlyStuck ? (
          <>
            <p className="text-sm font-extrabold sm:text-[15px]">
              {stuck.length} {one(stuck.length, "card")} still {one(stuck.length, "needs", "need")} a rebuild the compiler cannot do yet
            </p>
            <p className="mt-0.5 text-[13px]">
              The compiler writes {stuck.length === 1 ? "this card's" : "these cards'"} rules back exactly as they are, so another rebuild changes nothing. They need a hand edit:{" "}
              {stuck.slice(0, 6).map((id, i) => (
                <span key={id}>
                  {i > 0 && ", "}
                  <Link href={`/arena/rules/card/${encodeURIComponent(id)}`} className="font-bold underline">
                    {id}
                  </Link>
                </span>
              ))}
              {stuck.length > 6 && ` and ${stuck.length - 6} more`}.{" "}
              <Link href={`/arena/rules/card/${encodeURIComponent(stuck[0])}`} className="font-bold underline">
                Open {stuck.length === 1 ? "it" : "them"}
              </Link>
            </p>
          </>
        ) : (
          <p className="text-sm font-extrabold sm:text-[15px]">
            {plan.cards} {one(plan.cards, "card")} {one(plan.cards, "needs", "need")} a rebuild before {one(plan.cards, "it", "they")} can play
          </p>
        )}
        <p className={`mt-0.5 text-[13px] ${onlyStuck ? "" : "hidden sm:block"}`}>
          {!onlyStuck && (
            <>
              Their payment record predates #1066, so the engine refuses {plan.skills} {one(plan.skills, "skill")} until {plan.skills === 1 ? "it is" : "they are"} rebuilt. The compiler rebuilds the {p.compilerDrafts} compiler{" "}
              {one(p.compilerDrafts, "draft")}, with no Claude calls.
            </>
          )}
          {p.protectedRows > 0 && ` Your ${p.protectedRows} approved or corrected ${one(p.protectedRows, "skill")} (${p.protectedCards.length}${p.protectedCards.length >= 60 ? "+" : ""} ${one(p.protectedCards.length, "card")}) ${one(p.protectedRows, "is", "are")} never rewritten by a script.`}
          {p.otherRows > 0 && ` ${p.otherRows} Claude or hand-made ${one(p.otherRows, "draft")} ${one(p.otherRows, "is", "are")} left as ${one(p.otherRows, "it is", "they are")}.`}
          {!onlyStuck && stuck.length > 0 && ` ${stuck.length} more ${one(stuck.length, "card")} the compiler cannot change (${stuck.slice(0, 4).join(", ")}${stuck.length > 4 ? ", …" : ""}) ${one(stuck.length, "needs", "need")} a hand edit.`}
        </p>
        {dry && (
          <p role="status" className="mt-1 text-[13px] font-semibold">
            Dry run, nothing written: {dry.compilerDrafts} compiler {one(dry.compilerDrafts, "draft")} on {dry.rebuildable.length} {one(dry.rebuildable.length, "card")} would be rebuilt; {dry.protectedRows} protected
            {dry.protectedCards.length ? ` (${dry.protectedCards.slice(0, 8).join(", ")}${dry.protectedCards.length > 8 ? ", …" : ""})` : ""}.
          </p>
        )}
        {said && !pending && <p role="status" className="mt-1 text-[13px] font-semibold">{said}</p>}
        {error && <p role="alert" className="mt-1 text-[13px] font-semibold">{error}</p>}
      </div>
      {admin && !nothingToDo && (
        <div className="flex flex-wrap items-center gap-2.5">
          <button type="button" disabled={pending} onClick={dryRun} className="ds-button-secondary tap disabled:opacity-50">
            Dry run
          </button>
          {asked ? (
            <>
              <button type="button" disabled={pending} onClick={rebuild} className="ds-button tap disabled:opacity-50">
                Yes, rebuild {n}
              </button>
              <button type="button" onClick={() => setAsked(false)} className="tap text-sm">
                cancel
              </button>
            </>
          ) : (
            <button type="button" disabled={pending || n === 0} onClick={() => setAsked(true)} className="ds-button tap disabled:opacity-50">
              Rebuild{n ? ` ${n}${plan.rebuildable.length > n ? " of " + plan.rebuildable.length : ""} ${one(n, "card")}` : ""}
            </button>
          )}
          {pending && <span className="text-sm">working…</span>}
        </div>
      )}
    </section>
  );
}
