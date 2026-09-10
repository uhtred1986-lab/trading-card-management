"use client";

import type { Action, LegalAction, PlayerId } from "@/lib/arena/engine";
import type { BoardView } from "@/lib/arena/view";
import { isGhostAction, NarrationRibbon, shortLabel, StepChip } from "../shared";

export function PromptPanel({
  view,
  playable,
  yourTurn,
  waitingOnServer,
  busy,
  playing,
  held,
  refusalText,
  error,
  pace,
  playingMine,
  playingIndex,
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
  held: { text: string; n: number; mine: boolean } | null;
  refusalText: string | null;
  error: string | null;
  pace: "slow" | "normal" | "step";
  playingMine: boolean;
  playingIndex: number;
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
  return (
    <section
      className={`rounded-xl border backdrop-blur ${
        yourTurn && playable && !playing ? "arena-prompt-live border-ki-500 bg-space-800/95" : "border-space-600 bg-space-800/95"
      }`}
      aria-live="polite"
    >
      {!playing && held && !view.over && <NarrationRibbon text={held.text} n={held.n} mine={held.mine} live={false} />}
      <div className="flex items-center gap-2 p-2 pl-3 sm:gap-3 sm:p-3 sm:pl-5">
        {(waitingOnServer || busy) && !view.over && <span className="arena-pulse h-3.5 w-3.5 shrink-0 animate-pulse rounded-full bg-ki-400" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-space-50 sm:text-base lg:text-lg">
            {!playing && !view.over && yourTurn && view.prompt.step && (
              <span className="mr-2 align-middle">
                <StepChip step={view.prompt.step} />
              </span>
            )}
            {playing
              ? (held?.text ?? `${view.them.name} is playing…`)
              : view.over
                ? view.over.winner
                  ? `${view.over.winner === yourPlayer ? view.you.name : view.them.name} wins`
                  : "A draw"
                : waitingOnServer
                  ? `${view.them.name} is thinking…`
                  : view.prompt.question}
          </p>
          <p className={`mt-0.5 text-[11px] sm:text-sm ${refusalText && !view.over ? "text-loss" : "text-space-300"}`}>
            <span className="line-clamp-2">
              {view.over
                ? view.over.reason
                : playing
                  ? `${playingMine ? "Your move" : `${view.them.name} is playing`} · ${playingIndex + 1} of ${playingTotal}${pace === "step" ? " · tap Next" : ""}`
                  : (error ?? refusalText ?? view.prompt.hint ?? "")}
            </span>
          </p>
        </div>

        {playing && pace === "step" && (
          <button
            type="button"
            onClick={onNext}
            className="tap shrink-0 rounded-lg bg-ki-500 px-3 py-2 text-sm font-semibold text-space-950 hover:bg-ki-400 sm:rounded-xl sm:px-5 sm:py-2.5"
          >
            Next ▸
          </button>
        )}
        {playing && (
          <button type="button" onClick={onSkip} className="tap shrink-0 rounded-lg border border-space-600 bg-space-700 px-3 py-2 text-sm font-semibold text-space-50 sm:px-5 sm:py-2.5">
            Skip
          </button>
        )}
        {!playing && isTargeting && (
          <button type="button" onClick={onCancelTargeting} className="tap shrink-0 rounded-lg border border-space-600 px-3 py-2 text-sm text-space-100 sm:px-5 sm:py-2.5 sm:text-base">
            Cancel
          </button>
        )}
        {searching && !searchOpen && (
          <button type="button" onClick={onReopenSearch} className="tap shrink-0 rounded-lg bg-ki-500 px-3 py-2 text-sm font-semibold text-space-950 hover:bg-ki-400 sm:rounded-xl sm:px-5 sm:py-2.5 sm:text-base">
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
              className={`tap shrink-0 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 sm:rounded-xl sm:px-5 sm:py-2.5 sm:text-base ${
                ghost ? "border border-space-600 bg-space-700 text-space-50" : "bg-ki-500 text-space-950 hover:bg-ki-400"
              }`}
            >
              <span className="sm:hidden">{shortLabel(l.label)}</span>
              <span className="hidden sm:inline">{l.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
