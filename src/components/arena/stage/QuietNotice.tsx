"use client";

import { useEffect, useEffectEvent } from "react";
import type { PlayerId } from "@/lib/arena/types";
import { useArenaAdmin } from "../admin-context";
import { quietSentence, quietShort, type QuietSkill } from "./quiet-skills";

/** How long the chip stays: a glance for a player, long enough to read the sentence for an SL. */
const PLAYER_MS = 1500;
const ADMIN_MS = 4000;

/**
 * A resolved skill with no effect is information, not a game choice, so it is a
 * chip and nothing more: small, fading, never a button, never a modal scrim or
 * stolen focus. A player sees "Guldo · No effect" for a moment; the engine's
 * full explanation (the sentence and the printed effect) is for SLs only.
 * Acknowledging (on timeout, or by tapping the SL's sentence) submits no game
 * action and holds nothing for a player.
 */
export function QuietNotice({ quiet, viewer, them, onOk }: { quiet: QuietSkill; viewer: PlayerId; them: string; onOk: () => void }) {
  const admin = useArenaAdmin();
  const ms = admin ? ADMIN_MS : PLAYER_MS;
  const dismiss = useEffectEvent(onOk);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(), ms);
    return () => clearTimeout(timer);
  }, [quiet.n, ms]);
  const yours = quiet.owner === viewer;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[3.75rem] z-40 flex justify-center px-2 sm:top-16">
      <div
        role="status"
        data-arena-notice={yours ? "yours" : "theirs"}
        style={{ "--chip-ms": `${ms}ms` } as React.CSSProperties}
        className={`arena-notice arena-chip max-w-full rounded-2xl px-3 py-1.5 ${admin ? "pointer-events-auto" : ""}`}
        onClick={admin ? onOk : undefined}
      >
        <p id="arena-notice-title" className="truncate text-xs font-bold text-space-50">
          {quietShort(quiet)}
        </p>
        {admin && (
          <p id="arena-notice-text" className="mt-0.5 text-[11px] leading-snug text-space-300">
            {quietSentence(quiet, viewer, them)} {quiet.effect}
          </p>
        )}
      </div>
    </div>
  );
}
