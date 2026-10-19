"use client";

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
        setSaid(`Rebuilt ${r.rebuilt} card${r.rebuilt === 1 ? "" : "s"}${r.remaining ? `; ${r.remaining} left, rebuild again` : ""}.`);
        setDry(null);
        router.refresh();
      }
    });
  };

  const p = dry ?? plan;
  return (
    <section aria-label="Rebuild" className="ds-status-warning flex flex-wrap items-center gap-4 rounded-xl p-4 sm:px-5 sm:py-4">
      <div className="min-w-0 flex-1 basis-72">
        <p className="text-sm font-extrabold sm:text-[15px]">{plan.cards} card{plan.cards === 1 ? "" : "s"} need a rebuild before they can play</p>
        <p className="mt-0.5 hidden text-[13px] sm:block">
          Their payment record predates #1066, so the engine refuses {plan.skills} skill{plan.skills === 1 ? "" : "s"} until they are rebuilt. The compiler rebuilds the {p.compilerDrafts} compiler
          draft{p.compilerDrafts === 1 ? "" : "s"}, with no Claude calls.
          {p.protectedRows > 0 && ` Your ${p.protectedRows} approved or corrected skill${p.protectedRows === 1 ? "" : "s"} (${p.protectedCards.length}${p.protectedCards.length >= 60 ? "+" : ""} card${p.protectedCards.length === 1 ? "" : "s"}) are never rewritten by a script.`}
          {p.otherRows > 0 && ` ${p.otherRows} Claude or hand-made draft${p.otherRows === 1 ? "" : "s"} are left as they are.`}
        </p>
        {dry && (
          <p role="status" className="mt-1 text-[13px] font-semibold">
            Dry run, nothing written: {dry.compilerDrafts} compiler draft{dry.compilerDrafts === 1 ? "" : "s"} on {dry.rebuildable.length} card{dry.rebuildable.length === 1 ? "" : "s"} would be rebuilt; {dry.protectedRows} protected
            {dry.protectedCards.length ? ` (${dry.protectedCards.slice(0, 8).join(", ")}${dry.protectedCards.length > 8 ? ", …" : ""})` : ""}.
          </p>
        )}
        {said && !pending && <p role="status" className="mt-1 text-[13px] font-semibold">{said}</p>}
        {error && <p role="alert" className="mt-1 text-[13px] font-semibold">{error}</p>}
      </div>
      {admin && (
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
              Rebuild{n ? ` ${n}${plan.rebuildable.length > n ? " of " + plan.rebuildable.length : ""} cards` : ""}
            </button>
          )}
          {pending && <span className="text-sm">working…</span>}
        </div>
      )}
    </section>
  );
}
