"use client";

import type { Action, LegalAction, PlayerId } from "@/lib/arena/types";
import type { BoardView } from "@/lib/arena/view";
import { isGhostAction, shortLabel } from "../shared";

export function PromptPanel({
  view,
  playable,
  yourTurn,
  waitingOnServer,
  busy,
  playing,
  refusalText,
  error,
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
  playable: boolean;
  yourTurn: boolean;
  waitingOnServer: boolean;
  busy: boolean;
  playing: boolean;
  refusalText: string | null;
  error: string | null;
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
  const line: React.ReactNode = playing ? (
    `${playingMine ? "Your move" : `${view.them.name} is playing`} · ${playingIndex + 1} of ${playingTotal}${pace === "step" ? " · tap Next" : ""}`
  ) : view.over ? (
    `${view.over.winner ? `${view.over.winner === yourPlayer ? view.you.name : view.them.name} wins` : "A draw"}${view.over.reason ? ` — ${view.over.reason}` : ""}`
  ) : waitingOnServer ? (
    `${view.them.name} is thinking…`
  ) : (error ?? refusalText ?? (isTargeting ? (
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
    <section className={`arena-bar flex min-h-[72px] items-center gap-2.5 px-3 pb-3 pt-2.5 sm:px-4 lg:min-h-20 lg:px-[22px]`} aria-live="polite">
      {(waitingOnServer || busy) && !view.over && <span className="arena-pulse h-3.5 w-3.5 shrink-0 animate-pulse rounded-full bg-ki-400" aria-hidden />}
      <p className={`min-w-0 flex-1 text-sm font-semibold leading-snug lg:text-[17px] ${bad ? "text-loss" : "text-space-50"}`}>
        <span className="line-clamp-3">{line}</span>
      </p>

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
            onClick={() => onSend(l.action)}
            className={`arena-btn tap h-12 shrink-0 rounded-xl px-4 text-base disabled:opacity-50 sm:px-5 ${ghost ? "border border-space-600 bg-space-800 text-space-50" : "bg-ki-500 text-space-950 hover:bg-ki-400"}`}
          >
            <span className="sm:hidden">{shortLabel(l.label)}</span>
            <span className="hidden sm:inline">{l.label}</span>
          </button>
        );
      })}
    </section>
  );
}
