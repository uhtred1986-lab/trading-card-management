"use client";
import Image from "next/image";
import type { Action } from "@/lib/arena/types";
import type { GameplanPreview, PlanMove } from "@/lib/arena/gameplan-types";

export function GamePlanPanel({ planChoices, planFirst, plan, planError, planPending, onPlanFirst, onPlanSecond, onPlanRetry, onPlanClear }: {
  planChoices: PlanMove[];
  planFirst: Action | null;
  plan: GameplanPreview | null;
  planError: string | null;
  planPending: boolean;
  onPlanFirst: (move: PlanMove) => void;
  onPlanSecond: (move: PlanMove) => void;
  onPlanRetry: () => void;
  onPlanClear: () => void;
}) {
 return (
          <div data-gameplan className="mt-2 rounded-xl border border-space-500 bg-space-900/90 p-3 text-sm text-space-50" aria-label="Game plan preview">
            <p className="font-semibold">Try moves without playing</p>
            <p className="mt-1 text-xs text-space-200">Choose up to two Main Phase moves to check their energy costs. This preview does not play cards or change your game.</p>
            <label className="mt-3 block text-xs font-semibold" htmlFor="gameplan-first">First move</label>
            <select id="gameplan-first" className="tap mt-1 min-h-11 w-full rounded-lg border border-space-500 bg-space-800 px-2 text-sm" value={planFirst ? planChoices.findIndex((move) => JSON.stringify(move.action) === JSON.stringify(planFirst)) : -1} onChange={(event) => { const move = planChoices[Number(event.target.value)]; if (move) onPlanFirst(move); }}>
              <option value={-1}>Choose a move</option>
              {planChoices.map((move, i) => <option key={i} value={i}>{move.label}</option>)}
            </select>
            {planPending && <p role="status" className="mt-2">Checking the plan…</p>}
            {planError && <p role="alert" className="mt-2 text-loss">{planError}</p>}
            {planError && !planPending && <button type="button" data-plan-retry onClick={onPlanRetry} className="tap mt-2 min-h-11 rounded-lg border border-space-500 px-3 py-2">Retry preview</button>}
            {plan?.steps.map((step, index) => <div key={index} className="mt-3 rounded-lg border border-space-600 bg-space-800/70 p-2" data-plan-step={index}>
              <p className="font-semibold">{index === 0 ? "Before" : `After ${index}`} · {step.label}</p>
              <p className="mt-1">Ready energy {step.budget.ready}/{step.budget.total} · markers {step.budget.markers}</p>
              <p className="text-xs text-space-200">{step.budget.colors.length ? step.budget.colors.map((color) => `${color.color} ${color.ready}/${color.total}`).join(" · ") : "No coloured energy"}{step.budget.source === "printed" ? " · printed colours" : " · payment colours"}</p>
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`${index === 0 ? "Before" : `After ${index}`} energy cards`}>
                {step.budget.energy.map((energy) => <div key={energy.id} className={`w-10 ${energy.ready ? "" : "opacity-50"}`} title={`${energy.name} · ${energy.paymentColors.join("/")} · ${energy.ready ? "ready" : "rested"}`}>
                  {energy.imageUrl ? <Image src={energy.imageUrl} alt={energy.name} width={40} height={56} unoptimized className="h-14 w-10 rounded object-cover" /> : <span className="flex h-14 items-center rounded border border-space-500 text-[9px]">{energy.name}</span>}
                </div>)}
              </div>
            </div>)}
            {plan && plan.next.length > 0 && <>
              <label className="mt-3 block text-xs font-semibold" htmlFor="gameplan-second">Second move</label>
              <select id="gameplan-second" defaultValue={-1} className="tap mt-1 min-h-11 w-full rounded-lg border border-space-500 bg-space-800 px-2 text-sm" onChange={(event) => { const move = plan?.next[Number(event.target.value)]; if (move) onPlanSecond(move); }}>
                <option value={-1}>Choose a second move</option>
                {plan.next.map((move, i) => <option key={i} value={i}>{move.label}</option>)}
              </select>
            </>}
            {plan?.stopped && <p role="status" className="mt-3 text-sm">{plan.stopped}</p>}
            {planFirst && <button type="button" data-plan-clear onClick={onPlanClear} className="tap mt-3 min-h-11 rounded-lg border border-space-500 px-3 py-2">Clear preview</button>}
          </div>
 );
}
