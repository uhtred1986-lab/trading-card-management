"use client";

import Image from "next/image";
import { useState } from "react";
import type { Action, LegalAction, PlayerId } from "@/lib/arena/types";
import type { AttackPreview, BoardView, CardView } from "@/lib/arena/view";
import type { PublicOutcome } from "@/lib/arena/outcome";
import type { Snapshot } from "@/lib/arena/snapshot";
import { energySummary, stakesSummary } from "./stakes-model";
import { untilWords } from "@/lib/arena/effects";
import { Sheet, isGhostAction, shortLabel } from "../shared";
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
  playSelection = null,
  pickSelection = null,
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
  /** Main Phase: the hand card open in the browse preview and each legal way to play it. */
  playSelection?: { card: import("@/lib/arena/view").CardView; options: { action: Action; label: string; cost: number | null }[]; ready: number } | null;
  /** A card-choice question answered from the hand: the card open in the browse preview and the engine's `choose` for it. */
  pickSelection?: { card: import("@/lib/arena/view").CardView; action: Action; question: string } | null;
  onNext: () => void;
  attacksRemaining?: number;
  defendOptions?: { card: CardView; action: Action | null; label: string; detail: string | null; cost: string | null; reason: string | null; impact: string | null }[];
}) {
  // This board lets a card be dragged (rd-03), so the hint says so; the
  // engine's own hint is the classic board's and stays as written.
  /** Below lg the decision's detail (window, stakes, assumptions) is one tap away (#783); from lg it is always shown. */
  const [detailOpen, setDetailOpen] = useState(false);
  const boardHint = view.prompt.kind === "main" ? "drag a glowing card to play; tap a ready card to attack." : view.prompt.hint;
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
  const ownsTurn = view.turnPlayer === view.you.player;
  const defending = !!view.battle && !ownsTurn;
  const responseQuestion = defending ? view.prompt.kind === "counter" ? "Cancel the attack with a Counter card?" : view.prompt.kind === "blocker" ? "Let a [Blocker] take the hit instead?" : view.prompt.kind === "combo" ? "Add combo power to your defender?" : null : null;
  /** The defence window has its own one-sentence brief below, so the bar does not say it twice. */
  const defenceBrief = defending && ["counter", "blocker", "combo"].includes(view.prompt.kind) && !playing && !bad && !!view.battle;
  const line: React.ReactNode = playing ? (
    `${playingMine ? "Your move" : `${view.them.name} is playing`} · ${playingIndex + 1} of ${playingTotal}${playingMine && pace === "step" ? " · tap Next" : ""}`
  ) : overOutcome ? (
    `${overOutcome.kind === "interrupted" ? "Game interrupted" : overOutcome.kind === "abandoned" ? "Game abandoned" : overOutcome.kind === "draw" ? "A draw" : `${overOutcome.winner === yourPlayer ? view.you.name : view.them.name} wins`}${overOutcome.reason ? ` — ${overOutcome.reason}` : ""}`
  ) : view.over ? (
    `${view.over.winner ? `${view.over.winner === yourPlayer ? view.you.name : view.them.name} wins` : "A draw"}${view.over.reason ? ` — ${view.over.reason}` : ""}`
  ) : error ? (
    error
  ) : waitingOnServer ? (
    `${view.them.name} is thinking…`
  ) : (refusalText ?? (isTargeting ? (
    attackConfirmation ? `Review the attack: ${attackConfirmation.attacker.name} → ${attackConfirmation.target.name}.` : "Choose what to attack — tap a glowing target, or Pass to cancel."
  ) : chargeLine ? (
    <>
      <span className="[@media(pointer:fine)]:hidden">Choose a card, then Charge it or Pass below.</span>
      <span className="hidden [@media(pointer:fine)]:inline">Charge phase — double-click a hand card to charge it (+1 energy), or drag one onto the board.</span>
    </>
  ) : yourTurn && playable && moves > 0 && phaseLevel ? (
    `${moves} ${moves === 1 ? "move" : "moves"} available${boardHint ? ` — ${boardHint}` : ""}`
  ) : (
    responseQuestion ?? ask
  )));
  // Ordinary Main phase needs a turn control, not a permanent instruction bar.
  // Actual decisions, errors and step playback retain the full panel below.
  // Automatic presentation needs no bottom narration bar. Manual step mode
  // still needs its Next control; the board keeps Fast-forward available.
  if (playing && pace !== "step" && !error) return null;
  const quietMain = view.prompt.kind === "main" && !view.over && !overOutcome && !playing && !bad && !isTargeting && !searching && !onRetry;
  if (quietMain) return <div className="flex flex-wrap items-center justify-end gap-2 px-3 py-2" data-arena-quiet-controls>
    {playSelection && (
      <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-ki-500/60 bg-space-900/95 p-2" data-play-confirm>
        <p className="min-w-0 flex-1 text-sm font-bold text-space-50">Play {playSelection.card.name}?{playSelection.options[0].cost != null && <span className="block text-xs font-normal text-space-200">Costs {playSelection.options[0].cost} energy · {playSelection.ready} ready</span>}</p>
        {playSelection.options.map((option, n) => (
          <button key={n} type="button" disabled={busy} onClick={() => onSend(option.action)} className="arena-btn tap min-h-11 rounded-xl bg-ki-500 px-4 text-sm font-bold text-space-950 disabled:opacity-50" data-play-action>{playSelection.options.length > 1 ? option.label : "Play it"}</button>
        ))}
      </div>
    )}
    <button type="button" className="arena-iconbtn tap flex h-11 w-11 items-center justify-center rounded-full border border-space-600 text-space-100" aria-label="Open player guidance" aria-haspopup="dialog" onClick={() => setDetailOpen(true)}>?</button>
    {(busy || waitingOnServer) && <span role="status" className="mr-auto text-xs text-space-200">{waitingOnServer ? `${view.them.name} is thinking…` : "Sending move…"}</span>}
    {inlineBare.map(({ i, l }) => <button key={i} type="button" disabled={busy || waitingOnServer} onClick={() => onSend(l.action)} className="arena-btn tap min-h-11 rounded-xl border border-space-600 bg-space-800 px-4 text-sm font-semibold text-space-50 disabled:opacity-50">{l.action.type === "endMain" ? "End turn" : shortLabel(l.label)}</button>)}
    {detailOpen && <Sheet title="Player guidance" onClose={() => setDetailOpen(false)}>
      <p className="text-sm text-space-100">{line}</p>
      <p className="text-sm text-space-200">Tap a ready card, then its target to attack. Hold a card to read its rules and choose other skills. Tap a hand card to review its play cost.</p>
      <p className="text-sm text-space-200">{attacksRemaining} {attacksRemaining === 1 ? "card can" : "cards can"} still attack.</p>
      {battleDetails}
    </Sheet>}
  </div>;
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
        <p className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-[0.12em] text-space-300 lg:hidden" data-turn-phase>{phaseWord} phase · {ownsTurn ? "Your turn" : `${view.them.name}’s turn`}</p>
      ) : (
        <p className={`min-w-0 flex-1 text-sm font-semibold leading-snug lg:text-[17px] ${bad ? "text-loss" : "text-space-50"} ${inlineBare.length > 1 ? "max-lg:basis-[calc(100%-3.25rem)]" : ""}`}>
          {!playing && !view.over && !overOutcome && <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-space-300 lg:hidden" data-turn-phase>{phaseWord} phase · {ownsTurn ? "Your turn" : `${view.them.name}’s turn`}</span>}
          <span className={phaseLevel && !bad ? undefined : "line-clamp-3"}>{defenceBrief ? null : line}</span>
        </p>
      )}

      {attackConfirmation && !playing && (
        <div className="flex w-full flex-wrap gap-2" data-attack-confirm>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={onConfirmAttack} className="arena-btn tap min-h-11 rounded-xl bg-ki-500 px-4 text-sm font-bold text-space-950 disabled:opacity-50">Confirm attack</button>
            <button type="button" data-pass-action disabled={busy} onClick={onCancelTargeting} className="arena-btn tap min-h-11 rounded-xl border border-space-600 bg-space-800 px-4 text-left text-sm font-semibold text-space-100 disabled:opacity-50"><span className="block">Pass</span><span className="block text-xs font-normal">Cancel the attack</span></button>
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
          <span className="block">Pass<span className="block text-xs font-normal">Cancel the attack</span></span>
        </button>
      )}
      {!playing && onRetry && (
        <button type="button" data-arena-advance-retry disabled={busy} onClick={onRetry} className="arena-btn tap h-12 shrink-0 rounded-xl border border-space-600 bg-space-800 px-4 text-base text-space-50 hover:border-ki-500/60 disabled:opacity-50">
          Retry
        </button>
      )}
      {searching && !searchOpen && (
        <button type="button" onClick={onReopenSearch} className="arena-btn tap h-12 shrink-0 rounded-xl bg-ki-500 px-4 text-base text-space-950 hover:bg-ki-400">
          Choose from {choicesCount}
        </button>
      )}
      {defending && ["counter", "blocker", "combo"].includes(view.prompt.kind) && !playing && (
        <div className="w-full" data-defend-step={view.prompt.kind}>
          <DefenceBrief view={view} kind={view.prompt.kind as "counter" | "blocker" | "combo"} />
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
              : l.action.type === "block" && l.action.card == null ? "No block"
                : l.action.type === "pass" && view.prompt.kind === "combo" ? view.battle?.stakes ? view.battle.stakes.hit ? "Take the hit" : "Keep it as is" : "Done adding power"
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
      {pickSelection && view.prompt.kind === "chooseCards" && (
        <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-ki-500/60 bg-space-900/95 p-2" data-pick-confirm>
          <p className="min-w-0 flex-1 text-sm font-bold text-space-50">{pickSelection.card.name}<span className="block text-xs font-normal text-space-200">{pickSelection.question}</span></p>
          <button type="button" disabled={busy} onClick={() => onSend(pickSelection.action)} className="arena-btn tap min-h-11 rounded-xl bg-ki-500 px-4 text-sm font-bold text-space-950 disabled:opacity-50" data-pick-action>Choose it</button>
        </div>
      )}
      {chargeSelection && view.prompt.kind === "charge" && (
        <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-ki-500/60 bg-space-900/95 p-2" data-charge-confirm>
          <p className="min-w-0 flex-1 text-sm font-bold text-space-50">Charge {chargeSelection.card.name}?<span className="block text-xs font-normal text-space-200">{chargeSelection.ready} → {chargeSelection.ready + 1} ready energy · {chargeSelection.total + 1} total</span></p>
          <button type="button" disabled={busy} onClick={() => onSend(chargeSelection.action)} className="arena-btn tap min-h-11 rounded-xl bg-ki-500 px-4 text-sm font-bold text-space-950 disabled:opacity-50">Charge it</button>
          {chargeSelection.passAction && <button type="button" data-pass-action disabled={busy} onClick={() => onSend(chargeSelection.passAction!)} className="arena-btn tap min-h-11 rounded-xl border border-space-600 bg-space-800 px-3 text-left text-sm text-space-100 disabled:opacity-50"><span className="block">Pass</span><span className="block text-xs font-normal">Don’t charge</span></button>}
        </div>
      )}
    </section>
  );
}

/** The step the defender is on, as three dots with the current one lit; the words are for screen readers. */
const DEFENCE_STEPS = ["counter", "blocker", "combo"] as const;

/**
 * What you are answering, in one sentence and one comparison (owner, 17 Oct 2026: "no need for a
 * lot of text if the UI is being clear"). The sentence names the attacker and what it is hitting;
 * the two figures are yours against theirs, lit by who is ahead. The engine's step names, the
 * "tied: attacker wins ties" arithmetic and the stakes sentence stay in the decision details above
 * (and for SLs): a player needs "add power or take the hit", not the rulebook.
 */
function DefenceBrief({ view, kind }: { view: BoardView; kind: (typeof DEFENCE_STEPS)[number] }) {
  const b = view.battle;
  if (!b) return null;
  const known = [view.them.leader, view.them.unison, ...view.them.battle, view.you.leader, view.you.unison, ...view.you.battle];
  const nameOf = (id: string) => known.find((c) => c?.id === id)?.name ?? "A card";
  const attacker = nameOf(b.attacker);
  const mine = view.you.leader?.id === b.guard ? "your Leader" : view.you.unison?.id === b.guard ? "your Unison" : nameOf(b.guard);
  const holding = b.guardPower > b.attackPower;
  const s = b.stakes;
  const stakes = !s ? null : !s.hit ? "You hold" : s.target === "leader" ? `−${s.lifeDamage} life` : s.target === "unison" ? "Unison loses markers" : s.koPrevented ? "No KO" : "KO";
  const ask = kind === "counter" ? "play a Counter or let it through" : kind === "blocker" ? "block with a Blocker or let it through" : holding ? "you are ahead" : "add combo power or take the hit";
  const cell = (label: string, power: number, ahead: boolean) => (
    <div className={`min-w-0 flex-1 rounded-xl border px-2 py-1 text-center ${ahead ? "border-ki-400 bg-ki-500/15" : "border-loss/60 bg-loss/10"}`}>
      <span className="block truncate text-[10px] font-bold uppercase tracking-wide text-space-200">{label}</span>
      <b className={`block font-mono text-xl font-black tabular-nums ${ahead ? "text-ki-300" : "text-loss"}`}>{power.toLocaleString("en")}</b>
    </div>
  );
  return (
    <div className="mb-1.5 space-y-1.5">
      <p className="min-w-0 break-words text-sm font-semibold leading-snug text-space-50" data-defence-line>
        {attacker} attacks {mine} — {ask}.
      </p>
      <div className="flex items-center gap-2" data-combo-meter aria-label={`Your ${b.guardPower.toLocaleString("en")} against ${b.attackPower.toLocaleString("en")}`}>
        {cell("You", b.guardPower, holding)}
        <span className="shrink-0 font-mono text-[10px] font-bold tracking-widest text-space-400" aria-hidden>VS</span>
        {cell(view.them.name, b.attackPower, !holding)}
        {stakes && <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-black uppercase ${holding ? "bg-ki-500/20 text-ki-300" : "bg-loss/20 text-loss"}`}>{stakes}</span>}
      </div>
      <p className="flex items-center gap-1" aria-label="Counter, Block, Combo response steps">
        {DEFENCE_STEPS.map((step) => (
          <span key={step} className={`h-1.5 w-6 rounded-full ${step === kind ? "bg-ki-400" : "bg-space-600"}`} title={step === "blocker" ? "block" : step} />
        ))}
        <span className="sr-only">Step: {kind === "blocker" ? "Block" : kind === "counter" ? "Counter" : "Combo"}</span>
      </p>
    </div>
  );
}
