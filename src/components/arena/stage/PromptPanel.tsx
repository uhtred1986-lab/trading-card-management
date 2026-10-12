"use client";

import type { Action, LegalAction, PlayerId } from "@/lib/arena/types";
import type { BoardView } from "@/lib/arena/view";
import type { PublicOutcome } from "@/lib/arena/outcome";
import type { Snapshot } from "@/lib/arena/snapshot";
import { energySummary, stakesSummary } from "./stakes-model";
import { untilWords } from "@/lib/arena/effects";
import { isGhostAction, shortLabel } from "../shared";

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
  searching,
  searchOpen,
  choicesCount,
  onReopenSearch,
  inlineBare,
  primaryBare,
  onSend,
  onNext,
  onSkip,
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
  searching: boolean;
  searchOpen: boolean;
  choicesCount: number;
  onReopenSearch: () => void;
  inlineBare: { i: number; l: LegalAction }[];
  primaryBare: number;
  onSend: (action: Action) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  // This board lets a card be dragged (rd-03), so the hint says so; the
  // engine's own hint is the classic board's and stays as written.
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
    "Choose what to attack — tap a glowing card, or Cancel."
  ) : chargeLine ? (
    <>
      <span className="[@media(pointer:fine)]:hidden">Charge phase — tap a card to charge it (+1 energy), or drag one onto the board.</span>
      <span className="hidden [@media(pointer:fine)]:inline">Charge phase — double-click a hand card to charge it (+1 energy), or drag one onto the board.</span>
    </>
  ) : yourTurn && playable && moves > 0 && phaseLevel ? (
    `${moves} ${moves === 1 ? "move" : "moves"} available${boardHint ? ` — ${boardHint}` : ""}`
  ) : (
    ask
  )));
  return (
    <section className={`arena-bar flex min-h-[72px] flex-wrap items-center gap-2.5 px-3 pb-3 pt-2.5 sm:px-4 lg:min-h-20 lg:px-[22px]`} aria-live="polite">
      {!playing && !view.over && !overOutcome && (
        <div className="w-full space-y-1 text-xs leading-snug text-space-100" data-decision-summary>
          <p className="font-semibold">{(decision?.actor ?? view.prompt.player) === view.you.player ? "You" : (decision?.actor ?? view.prompt.player) === view.them.player ? view.them.name : "Referee"} · {(decision?.window ?? view.prompt.kind).replace(/([a-z])([A-Z])/g, "$1 $2")}{view.battle ? ` · ${view.battle.step} step` : ` · ${view.phase}`}</p>
          {view.battle && <p data-battle-stakes>Attack {view.battle.attackPower.toLocaleString("en")} · Defense {view.battle.guardPower.toLocaleString("en")} — {view.battle.stakes ? "If nothing else changes: " : ""}{stakesSummary(view.battle)}</p>}
          {view.prompt.passConsequence && <p data-pass-consequence>{view.prompt.passConsequence.split(".")[0]}.</p>}
          {!handDecision && battleDetails}
        </div>
      )}
      {(waitingOnServer || busy) && !view.over && <span className="arena-pulse h-3.5 w-3.5 shrink-0 animate-pulse rounded-full bg-ki-400" aria-hidden />}
      {handDecision && !playing && !bad && !isTargeting ? battleDetails : (
        <p className={`min-w-0 flex-1 text-sm font-semibold leading-snug lg:text-[17px] ${bad ? "text-loss" : "text-space-50"}`}>
          <span className="line-clamp-3">{line}</span>
        </p>
      )}

      {playing && pace === "step" && (
        <button type="button" onClick={onNext} className="arena-btn tap h-12 shrink-0 rounded-xl bg-ki-500 px-4 text-base text-space-950 hover:bg-ki-400">
          Next ▸
        </button>
      )}
      {playing && (
        <button type="button" onClick={onSkip} className="arena-btn tap h-12 shrink-0 rounded-xl border border-space-600 bg-space-700 px-4 text-base text-space-50">
          Skip
        </button>
      )}
      {!playing && isTargeting && (
        <button type="button" onClick={onCancelTargeting} className="arena-btn tap h-12 shrink-0 rounded-xl border border-space-600 bg-space-800 px-4 text-base text-space-100">
          Cancel
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
      {inlineBare.map(({ i, l }, index) => {
        const ghost = isGhostAction(l.action) || (primaryBare >= 0 && index !== primaryBare);
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
            <span className="sm:hidden">{shortLabel(l.label)}</span>
            <span className="hidden sm:inline">{l.label}</span>
            {l.action.type === "payCost" && (() => {
              const option = l.action.type === "payCost" ? l.action.option : -1;
              const payment = view.prompt.payments?.find((p) => p.option === option);
              return <span className="block text-xs font-normal" data-payment-preview>{payment ? `Remaining ready/total: ${energySummary(view.you, payment.energyRest)} · markers ${Math.max(0, view.you.energyMarkers - payment.markers)}` : "Remaining colours unavailable until payment is known."}</span>;
            })()}
          </button>
        );
      })}
    </section>
  );
}
