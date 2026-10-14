"use client";

import { useEffect, useRef } from "react";
import type { PlayerId } from "@/lib/arena/types";
import { quietSentence, quietTitle, type QuietSkill } from "./quiet-skills";

/**
 * "Vegeta's KO: no valid target" (#783), as a stop the player acknowledges.
 *
 * The owner's S21 test: a KO skill with nothing to KO resolved and the board said nothing. A line in
 * the narration pill went by too fast to notice, so this is a small dialog over the board, with one
 * button. OK is focused on arrival, so Enter or Space acknowledges it; Tab stays on it. While it
 * stands the story is paused, a move cannot be sent and the computer's next advance waits
 * (`ArenaStage`). It sends nothing itself: acknowledging is the board's business, not the game's.
 */
export function QuietNotice({ quiet, viewer, them, onOk }: { quiet: QuietSkill; viewer: PlayerId; them: string; onOk: () => void }) {
  const ok = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    ok.current?.focus();
  }, []);
  const yours = quiet.owner === viewer;
  return (
    <div className="arena-notice-scrim fixed inset-0 z-[85] flex items-end justify-center p-3 sm:items-center" data-arena-notice-scrim>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="arena-notice-title"
        aria-describedby="arena-notice-text"
        data-arena-notice={yours ? "yours" : "theirs"}
        className="arena-notice w-full max-w-sm rounded-2xl p-4"
        onKeyDown={(e) => {
          // One control: focus stays on it.
          if (e.key === "Tab") {
            e.preventDefault();
            ok.current?.focus();
          }
        }}
      >
        <p id="arena-notice-title" className="text-[11px] font-bold uppercase tracking-[0.16em] text-space-300">
          {quietTitle(quiet)}
        </p>
        <p id="arena-notice-text" className="mt-1 text-base font-semibold leading-snug text-space-50">
          {quietSentence(quiet, viewer, them)}
        </p>
        <p className="mt-1 text-xs leading-snug text-space-300">{quiet.effect}</p>
        <button
          ref={ok}
          type="button"
          onClick={onOk}
          className="arena-btn tap mt-3 h-12 w-full rounded-xl bg-ki-500 px-4 text-base text-space-950 hover:bg-ki-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-300"
        >
          OK
        </button>
      </div>
    </div>
  );
}
