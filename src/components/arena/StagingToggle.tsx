"use client";

import { useTransition } from "react";
import { chooseStaging } from "@/app/arena/actions";
import { ARENA_STAGINGS, STAGING_LABEL, type ArenaStaging } from "@/lib/arena/staging";

/**
 * How a battle is staged, from the board itself
 * (`docs/arena-battle-staging-spec.md` §3.6).
 *
 * Three ways rather than a toggle, so it sits beside `FeelToggle` as a
 * segmented control: in place, the duel band, or the takeover. A cookie for
 * the same reason the skin is one — the staging decides what the middle of
 * the board looks like the moment a battle opens, so it is read on the server
 * and nothing flashes.
 */
export function StagingToggle({ gameId, staging }: { gameId: number; staging: ArenaStaging }) {
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label="battle staging">
      {ARENA_STAGINGS.map((s) => (
        <button
          key={s}
          type="button"
          disabled={pending || s === staging}
          onClick={() => start(() => chooseStaging(gameId, s))}
          aria-pressed={s === staging}
          className={`tap whitespace-nowrap uppercase tracking-widest disabled:opacity-100 ${s === staging ? "text-ki-300" : "text-space-600 hover:text-ki-400"}`}
          title={`Stage a battle: ${STAGING_LABEL[s]}`}
        >
          {STAGING_LABEL[s]}
        </button>
      ))}
    </span>
  );
}
