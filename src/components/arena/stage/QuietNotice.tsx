"use client";

import { useEffect, useEffectEvent } from "react";
import type { PlayerId } from "@/lib/arena/types";
import { quietSentence, quietTitle, type QuietSkill } from "./quiet-skills";

/**
 * A resolved skill with no effect is information, not a required game choice.
 * Keep it briefly readable without a modal scrim or stolen keyboard focus.
 * Acknowledging (manually or on timeout) submits no game action.
 */
export function QuietNotice({ quiet, viewer, them, onOk }: { quiet: QuietSkill; viewer: PlayerId; them: string; onOk: () => void }) {
  const dismiss = useEffectEvent(onOk);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(), 4000);
    return () => clearTimeout(timer);
  }, [quiet.n]);
  const yours = quiet.owner === viewer;
  return (
    <div className="pointer-events-none fixed left-2 top-24 z-40 max-w-[calc(100vw-1rem)] sm:left-4 sm:top-28">
      <div
        role="status"
        aria-labelledby="arena-notice-title"
        aria-describedby="arena-notice-text"
        data-arena-notice={yours ? "yours" : "theirs"}
        className="arena-notice pointer-events-auto max-h-[50dvh] w-full max-w-sm overflow-y-auto rounded-2xl p-3"
      >
        <p id="arena-notice-title" className="text-[11px] font-bold uppercase tracking-[0.16em] text-space-300">
          {quietTitle(quiet)}
        </p>
        <p id="arena-notice-text" className="mt-1 text-base font-semibold leading-snug text-space-50">
          {quietSentence(quiet, viewer, them)}
        </p>
        <p className="mt-1 text-xs leading-snug text-space-300">{quiet.effect}</p>
        <button
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
