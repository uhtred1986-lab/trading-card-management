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
