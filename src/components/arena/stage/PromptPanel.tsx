"use client";

import Image from "next/image";
import { useState } from "react";
import type { GameplanPreview, PlanMove } from "@/lib/arena/gameplan-types";
import type { Action, LegalAction, PlayerId } from "@/lib/arena/types";
import type { AttackPreview, BoardView, CardView } from "@/lib/arena/view";
import type { PublicOutcome } from "@/lib/arena/outcome";
import type { Snapshot } from "@/lib/arena/snapshot";
import { energySummary, stakesSummary } from "./stakes-model";
import { untilWords } from "@/lib/arena/effects";
import { isGhostAction, shortLabel } from "../shared";
import phoneStyles from "./phone-board.module.css";

export function PromptPanel({
  view,
  decision,
  handDecision = false,
  overOutcome,
  playable,
  yourTurn,
  waitingOnServer,
  busy,
  playing,
  refusalText,
  error,
  onRetry,
  pace,
  playingMine,
  playingIndex,
  moves,
  playingTotal,
  yourPlayer,
  isTargeting,
  onCancelTargeting,
  attackConfirmation,
  onConfirmAttack,
  searching,
  searchOpen,
  choicesCount,
  onReopenSearch,
  inlineBare,
  primaryBare,
  onSend,
  chargeSelection = null,
  planEnabled,
  planOpen,
  onPlanToggle,
  planChoices,
  planFirst,
  plan,
  planError,
  planPending,
  onPlanFirst,
  onPlanSecond,
  onPlanRetry,
  onPlanClear,
  onNext,
  attacksRemaining = 0,
  defendOptions = [],
}: {
  view: BoardView;
  decision?: Snapshot["decision"];
  handDecision?: boolean;
  overOutcome: PublicOutcome | null;
  playable: boolean;
  yourTurn: boolean;
  waitingOnServer: boolean;
  busy: boolean;
  playing: boolean;
  refusalText: string | null;
  error: string | null;
  onRetry?: () => void;
  pace: "slow" | "normal" | "step";
  playingMine: boolean;
  playingIndex: number;
  /** How many things you could do now; the turn pill says whose turn it is, this says what is open. */
  moves: number;
  playingTotal: number;
  yourPlayer: PlayerId;
  isTargeting: boolean;
  onCancelTargeting: () => void;
  attackConfirmation?: { attacker: CardView; target: CardView; attackerRole: string; targetRole: string; preview?: AttackPreview; result: string | null } | null;
  onConfirmAttack?: () => void;
  searching: boolean;
  searchOpen: boolean;
  choicesCount: number;
  onReopenSearch: () => void;
  inlineBare: { i: number; l: LegalAction }[];
  primaryBare: number;
  onSend: (action: Action) => void;
  chargeSelection?: { card: import("@/lib/arena/view").CardView; action: Action; passAction: Action | null; ready: number; total: number } | null;
  planEnabled: boolean;
  planOpen: boolean;
  onPlanToggle: () => void;
  planChoices: PlanMove[];
  planFirst: Action | null;
  plan: GameplanPreview | null;
  planError: string | null;
  planPending: boolean;
  onPlanFirst: (move: PlanMove) => void;
  onPlanSecond: (move: PlanMove) => void;
  onPlanRetry: () => void;
  onPlanClear: () => void;
  onNext: () => void;
  attacksRemaining?: number;
  defendOptions?: { card: CardView; action: Action | null; label: string; detail: string | null; cost: string | null; reason: string | null; impact: string | null }[];
}) {
  // This board lets a card be dragged (rd-03), so the hint says so; the
  // engine's own hint is the classic board's and stays as written.
  /** Below lg the decision's detail (window, stakes, assumptions) is one tap away (#783); from lg it is always shown. */
  const [detailOpen, setDetailOpen] = useState(false);
  const boardHint = view.prompt.kind === "main" ? "drag a glowing card up to play it, or tap a ready card to attack." : view.prompt.hint;
  // The Charge phase names its gesture (rd-04): a tap on a finger, a double-click on a mouse.
  const chargeLine = view.prompt.kind === "charge" && yourTurn && playable && moves > 0;
  // One line, never a heading over a sentence (`docs/arena-redesign/` frame
  // 01): the turn pill and the phase chips already say "Your Main Phase", so
  // the phase-level prompts (Main, Charge) say only what is open and how. Any
  // other prompt is a real question — a combo, a block, a choice — and says it.
  const phaseLevel = view.prompt.kind === "main" || view.prompt.kind === "charge";
  const q = view.prompt.question;
  const ask = view.prompt.hint ? `${q}${/[.?!…]$/.test(q) ? " " : " — "}${view.prompt.hint}` : q;
  const bad = !!(refusalText || error) && !view.over && !playing;
  const publicBlockers = [view.you, view.them].flatMap((side) => side.battle.filter((card) => card.keywords.includes("Blocker")).map((card) => `${side.name}: ${card.name} (${card.mode === "active" ? "ready" : "rested"})`));
  const publicRules = [view.you, view.them].flatMap((side) => [
    ...(side.rules ?? []).map((rule) => ({ name: side.name, rule })),
    ...[side.leader, side.unison, ...side.battle].flatMap((card) => (card?.effects ?? []).filter((rule) => rule.kind === "forbid" || rule.kind === "negate" || rule.kind === "keyword").map((rule) => ({ name: card!.name, rule }))),
  ]);
  const battleDetails = view.battle ? <details data-battle-assumptions className={handDecision ? "min-w-0 flex-1" : undefined}>
            <summary className="tap min-h-11 cursor-pointer py-2 underline underline-offset-2">Assumptions / public rules{publicBlockers.length + publicRules.length > 0 ? ` (${publicBlockers.length + publicRules.length})` : ""}</summary>
            <div className="max-h-[20dvh] overflow-y-auto pr-1">
            {view.battle.stakes && <p>{view.battle.stakes.assumption}</p>}
            {view.prompt.passConsequence && <p>{view.prompt.passConsequence}</p>}
            {publicBlockers.length > 0 && <p>Blocker cards: {publicBlockers.join(" · ")}. Readiness alone does not guarantee a legal block in this window.</p>}
            {publicRules.map(({ name, rule }, i) => <p key={i}>{name}: {rule.label} · {untilWords(rule.until, { master: rule.by, viewer: view.you.player, them: view.them.name, sourceName: rule.sourceName })}</p>)}
            </div>
          </details> : null;
  const phaseRaw = view.phase.replace(/([a-z])([A-Z])/g, "$1 $2");
  const phaseWord = `${phaseRaw.slice(0, 1).toUpperCase()}${phaseRaw.slice(1)}`;
  const line: React.ReactNode = playing ? (
    `${playingMine ? "Your move" : `${view.them.name} is playing`} · ${playingIndex + 1} of ${playingTotal}${pace === "step" ? " · tap Next" : ""}`
  ) : overOutcome ? (
    `${overOutcome.kind === "interrupted" ? "Game interrupted" : overOutcome.kind === "abandoned" ? "Game abandoned" : overOutcome.kind === "draw" ? "A draw" : `${overOutcome.winner === yourPlayer ? view.you.name : view.them.name} wins`}${overOutcome.reason ? ` — ${overOutcome.reason}` : ""}`
  ) : view.over ? (
    `${view.over.winner ? `${view.over.winner === yourPlayer ? view.you.name : view.them.name} wins` : "A draw"}${view.over.reason ? ` — ${view.over.reason}` : ""}`
  ) : error ? (
    error
  ) : waitingOnServer ? (
    `${view.them.name} is thinking…`
  ) : (refusalText ?? (isTargeting ? (
    attackConfirmation ? `Review the attack: ${attackConfirmation.attacker.name} → ${attackConfirmation.target.name}.` : "Choose what to attack — tap a glowing card, or Cancel. Only a Leader or rested Battle Card can be attacked."
  ) : chargeLine ? (
    <>
      <span className="[@media(pointer:fine)]:hidden">Choose a card, then Charge it or Pass below.</span>
      <span className="hidden [@media(pointer:fine)]:inline">Charge phase — double-click a hand card to charge it (+1 energy), or drag one onto the board.</span>
    </>
  ) : yourTurn && playable && moves > 0 && phaseLevel ? (
    `${moves} ${moves === 1 ? "move" : "moves"} available${boardHint ? ` — ${boardHint}` : ""}`
  ) : (
    ask
  )));
  return (
    <section className={`arena-bar flex min-h-[72px] flex-wrap items-center gap-2.5 px-3 pb-3 pt-2.5 sm:px-4 lg:min-h-20 lg:px-[22px]`} aria-live="polite" data-prompt-kind={view.prompt.kind}>
      {!playing && !view.over && !overOutcome && (
        <div className={`w-full space-y-1 text-xs leading-snug text-space-100 ${detailOpen ? "" : "max-lg:hidden"}`} data-decision-summary id="arena-decision-detail">
          <p className="font-semibold">{(decision?.actor ?? view.prompt.player) === view.you.player ? "You" : (decision?.actor ?? view.prompt.player) === view.them.player ? view.them.name : "Referee"} · {(decision?.window ?? view.prompt.kind).replace(/([a-z])([A-Z])/g, "$1 $2")}{view.battle ? ` · ${view.battle.step} step` : ` · ${view.phase}`}</p>
          <div className={phoneStyles.decisionDetails}>
          {view.battle && <p data-battle-stakes>Attack {view.battle.attackPower.toLocaleString("en")} · Defense {view.battle.guardPower.toLocaleString("en")} — {view.battle.stakes ? "If nothing else changes: " : ""}{stakesSummary(view.battle)}</p>}
          {view.prompt.passConsequence && <p data-pass-consequence>{view.prompt.passConsequence.split(".")[0]}.</p>}
          {battleDetails}
          </div>
        </div>
      )}
      {!playing && !view.over && !overOutcome && (
        <button
          type="button"
          className="arena-iconbtn tap -my-1 -ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full lg:hidden"
          aria-expanded={detailOpen}
          aria-controls="arena-decision-detail"
          aria-label={detailOpen ? "Hide the details of this decision" : "Show the details of this decision: the step, the stakes and the public rules"}
          data-decision-toggle
          onClick={() => setDetailOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6M12 7.5v.01" />
          </svg>
        </button>
      )}
      {(waitingOnServer || busy) && !view.over && <span className="arena-pulse h-3.5 w-3.5 shrink-0 animate-pulse rounded-full bg-ki-400" aria-hidden />}
      {handDecision && !playing && !bad && !isTargeting ? (
        <p className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-[0.12em] text-space-300 lg:hidden" data-turn-phase>{phaseWord} phase · {yourTurn ? "Your turn" : `${view.them.name}’s turn`}</p>
      ) : (
        <p className={`min-w-0 flex-1 text-sm font-semibold leading-snug lg:text-[17px] ${bad ? "text-loss" : "text-space-50"} ${inlineBare.length > 1 ? "max-lg:basis-[calc(100%-3.25rem)]" : ""}`}>
          {!playing && !view.over && !overOutcome && <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-space-300 lg:hidden" data-turn-phase>{phaseWord} phase · {yourTurn ? "Your turn" : `${view.them.name}’s turn`}</span>}
          <span className="line-clamp-3">{line}</span>
        </p>
      )}

      {attackConfirmation && !playing && (
        <div className="w-full rounded-xl border border-ki-500/60 bg-space-900/95 p-2.5 text-xs text-space-100" data-attack-confirm>
          <p className="font-bold"><span className="text-ki-300">ATTACKER</span> {attackConfirmation.attacker.name} <span className="text-space-400">→</span> <span className="text-gain">TARGET</span> {attackConfirmation.target.name}</p>
          <p className="mt-0.5 text-space-200">{attackConfirmation.attackerRole} · {attackConfirmation.targetRole}</p>
          {attackConfirmation.preview?.state === "known" && attackConfirmation.preview.battle ? <>
            <p className="mt-1 font-mono font-bold tabular-nums">{attackConfirmation.attacker.name} {attackConfirmation.preview.battle.attackPower.toLocaleString("en")} vs {attackConfirmation.target.name} {attackConfirmation.preview.battle.guardPower.toLocaleString("en")}</p>
            <p className="mt-0.5 leading-snug" data-attack-stakes>{attackConfirmation.result ?? stakesSummary(attackConfirmation.preview.battle)}</p>
          </> : <p className="mt-1 leading-snug text-dbs-yellow">{attackConfirmation.preview?.reason ?? "The result cannot be previewed before this attack."}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={onConfirmAttack} className="arena-btn tap min-h-11 rounded-xl bg-ki-500 px-4 text-sm font-bold text-space-950 disabled:opacity-50">Confirm attack</button>
            <button type="button" disabled={busy} onClick={onCancelTargeting} className="arena-btn tap min-h-11 rounded-xl border border-space-600 bg-space-800 px-4 text-sm font-semibold text-space-100 disabled:opacity-50">Cancel attack</button>
          </div>
        </div>
      )}
      {playing && playingMine && pace === "step" && (
        <button type="button" onClick={onNext} className="arena-btn tap h-12 shrink-0 rounded-xl bg-ki-500 px-4 text-base text-space-950 hover:bg-ki-400">
          Next ▸
        </button>
      )}
      {!playing && isTargeting && !attackConfirmation && (
        <button type="button" onClick={onCancelTargeting} className="arena-btn tap h-12 shrink-0 rounded-xl border border-space-600 bg-space-800 px-4 text-base text-space-100">
          Cancel
        </button>
      )}
      {!playing && onRetry && (
        <button type="button" data-arena-advance-retry disabled={busy} onClick={onRetry} className="arena-btn tap h-12 shrink-0 rounded-xl border border-space-600 bg-space-800 px-4 text-base text-space-50 hover:border-ki-500/60 disabled:opacity-50">
          Retry
        </button>
      )}
      {planEnabled && planChoices.length > 0 && (
        <div className="w-full" data-gameplan>
          <button type="button" aria-expanded={planOpen} onClick={onPlanToggle} className="tap min-h-11 rounded-lg border border-space-500 bg-space-800 px-3 py-2 text-sm text-space-50">
            {planOpen ? "Hide game plan" : "Preview game plan"}
          </button>
          {planOpen && <div className="mt-2 rounded-xl border border-space-500 bg-space-900/90 p-3 text-sm text-space-50" aria-label="Game plan preview">
            <p className="font-semibold">Game plan · up to two Main Phase moves</p>
            <p className="mt-1 text-xs text-space-200">Hypothetical only. No move is committed.</p>
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
            <button type="button" data-plan-clear onClick={onPlanClear} className="tap mt-3 min-h-11 rounded-lg border border-space-500 px-3 py-2">Clear plan</button>
          </div>}
        </div>
      )}
      {searching && !searchOpen && (
        <button type="button" onClick={onReopenSearch} className="arena-btn tap h-12 shrink-0 rounded-xl bg-ki-500 px-4 text-base text-space-950 hover:bg-ki-400">
          Choose from {choicesCount}
        </button>
      )}
      {["counter", "blocker", "combo"].includes(view.prompt.kind) && !playing && (
        <div className="w-full" data-defend-step={view.prompt.kind}>
          <p className="mb-1 flex flex-wrap items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-space-300" aria-label="Counter, Block, Combo response steps">
            <span className={view.prompt.kind === "counter" ? "text-ki-300" : ""}>① Counter</span><span>›</span>
            <span className={view.prompt.kind === "blocker" ? "text-ki-300" : ""}>② Block</span><span>›</span>
            <span className={view.prompt.kind === "combo" ? "text-ki-300" : ""}>③ Combo</span>
          </p>
          {defendOptions.length > 0 && <div className="max-h-[24dvh] space-y-1.5 overflow-y-auto" aria-label={view.prompt.kind === "counter" ? "Counter options" : "Blocker options"}>
            {defendOptions.map((option, i) => (
              <div key={`${option.card.id}:${i}`} className={`rounded-xl border ${option.reason ? "border-loss/50 bg-loss/5" : "border-space-600 bg-space-900/90"} p-2`} data-defend-card={option.card.id}>
                {option.action ? <button type="button" disabled={busy} onClick={() => onSend(option.action!)} className="tap flex min-h-11 w-full items-center gap-2 text-left" data-defend-action>
                  {option.card.imageUrl && <Image src={option.card.imageUrl} alt="" width={32} height={44} unoptimized className="h-11 w-8 shrink-0 rounded object-cover" />}
                  <span className="min-w-0 flex-1 text-xs font-bold text-space-50">{option.label}</span>
                  {option.cost && <span className="shrink-0 rounded border border-space-600 px-2 py-0.5 text-[10px] text-ki-300">{option.cost}</span>}
                </button> : <p className="text-xs font-semibold text-space-100">{option.label}</p>}
                {option.detail && <p className="mt-1 text-[11px] leading-snug text-space-200">{option.detail}</p>}
                {option.reason && <p className="mt-1 text-[11px] leading-snug text-loss">{option.reason}</p>}
                {option.impact && <p className="mt-1 text-[11px] leading-snug text-space-100">{option.impact}</p>}
              </div>
            ))}
          </div>}
        </div>
      )}
      {inlineBare.map(({ i, l }, index) => {
        const ghost = isGhostAction(l.action) || (primaryBare >= 0 && index !== primaryBare);
        const pass = isGhostAction(l.action);
        const passTitle = l.action.type === "endMain" ? "End turn" : pass ? "Pass" : null;
        const passDetail = l.action.type === "endMain"
          ? attacksRemaining > 0 ? `${attacksRemaining} ${attacksRemaining === 1 ? "attacker" : "attackers"} can still attack` : "No attackers left"
          : l.action.type === "charge" && l.action.card == null ? "Don’t charge"
            : l.action.type === "counter" && l.action.card == null ? "Don’t counter"
              : l.action.type === "block" && l.action.card == null ? "Take the hit"
                : l.action.type === "optionalCost" && !l.action.pay ? "Don’t pay the optional cost"
                  : view.prompt.passConsequence ?? "Pass this decision";
        return (
          <button
            key={i}
            type="button"
            disabled={busy}
            data-pass-action={isGhostAction(l.action) ? "" : undefined}
            data-payment-option={l.action.type === "payCost" ? l.action.option : undefined}
            onClick={() => onSend(l.action)}
            className={`arena-btn tap min-h-12 max-w-full shrink-0 rounded-xl px-4 py-2 text-base disabled:opacity-50 sm:px-5 ${ghost ? "border border-space-600 bg-space-800 text-space-50" : "bg-ki-500 text-space-950 hover:bg-ki-400"}`}
          >
            {passTitle ? <span className="block text-left"><b className="block">{passTitle}</b><span className="block text-xs font-normal opacity-80">{passDetail}</span></span> : <>
              <span className="sm:hidden">{shortLabel(l.label)}</span>
              <span className="hidden sm:inline">{l.label}</span>
            </>}
            {l.action.type === "payCost" && (() => {
              const option = l.action.type === "payCost" ? l.action.option : -1;
              const payment = view.prompt.payments?.find((p) => p.option === option);
              return <span className="block text-xs font-normal" data-payment-preview>{payment ? `Remaining ready/total: ${energySummary(view.you, payment.energyRest)} · markers ${Math.max(0, view.you.energyMarkers - payment.markers)}` : "Remaining colours unavailable until payment is known."}</span>;
            })()}
          </button>
        );
      })}
      {chargeSelection && view.prompt.kind === "charge" && (
        <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-ki-500/60 bg-space-900/95 p-2" data-charge-confirm>
          <p className="min-w-0 flex-1 text-sm font-bold text-space-50">Charge {chargeSelection.card.name}?<span className="block text-xs font-normal text-space-200">{chargeSelection.ready} → {chargeSelection.ready + 1} ready energy · {chargeSelection.total + 1} total</span></p>
          <button type="button" disabled={busy} onClick={() => onSend(chargeSelection.action)} className="arena-btn tap min-h-11 rounded-xl bg-ki-500 px-4 text-sm font-bold text-space-950 disabled:opacity-50">Charge it</button>
          {chargeSelection.passAction && <button type="button" disabled={busy} onClick={() => onSend(chargeSelection.passAction!)} className="arena-btn tap min-h-11 rounded-xl border border-space-600 bg-space-800 px-3 text-sm text-space-100 disabled:opacity-50">Pass · don’t charge</button>}
        </div>
      )}
    </section>
  );
}
