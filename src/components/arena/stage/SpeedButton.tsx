"use client";

import { PACES, setPacePref, usePace, type Pace } from "@/lib/arena/pace";

/** What the top bar's speed button says for each pace: the prototype's "1×", and the two either side of it. */
const LABEL: Record<Pace, string> = { slow: "½×", normal: "1×", step: "Step" };
const TITLE: Record<Pace, string> = {
  slow: "Animation speed: slow — every beat gets time to be read",
  normal: "Animation speed: the board's own tempo",
  step: "Animation speed: step — tap Next to advance one beat at a time",
};

/**
 * Skip the story being told: a small chip beside the turn pill, shown only
 * while beats play, never a button in the field. A 44 px target round a small
 * pill, like the speed button.
 */
export function SkipChip({ onSkip }: { onSkip: () => void }) {
  return (
    <button type="button" onClick={onSkip} className="tap flex h-11 shrink-0 items-center justify-center" aria-label="Fast-forward" title="Skip to the end of this turn's moves" data-skip-chip>
      <span className="arena-speed grid place-items-center px-2 text-[11px] leading-none">⏩</span>
    </button>
  );
}

/**
 * The top bar's speed button (`docs/arena-redesign/` frame 01): the same
 * preference as the menu's `PaceToggle`, cycling on tap and remembered.
 */
export function SpeedButton() {
  const pace = usePace();
  const next = PACES[(PACES.indexOf(pace) + 1) % PACES.length];
  return (
    // A 44 px target round a 36 px pill: the target is the finger's, the pill is the look.
    <button type="button" onClick={() => setPacePref(next)} className="tap flex h-11 min-w-11 items-center justify-center" title={TITLE[pace]} aria-label={TITLE[pace]}>
      <span className="arena-speed grid place-items-center px-2.5 leading-none">{LABEL[pace]}</span>
    </button>
  );
}
