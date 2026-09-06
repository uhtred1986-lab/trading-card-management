"use client";

import { PACES, setPacePref, usePace, type Pace } from "@/lib/arena/pace";

const LABEL: Record<Pace, string> = { slow: "pace: slow", normal: "pace: normal", step: "pace: step" };
const TITLE: Record<Pace, string> = {
  slow: "Every beat gets time to be read",
  normal: "The board's own tempo",
  step: "Tap Next to advance one beat at a time",
};

/** Slow, normal or step, cycling on tap, remembered with buzz and sound. */
export function PaceToggle() {
  const pace = usePace();
  const next = PACES[(PACES.indexOf(pace) + 1) % PACES.length];
  return (
    <button type="button" onClick={() => setPacePref(next)} className="tap whitespace-nowrap uppercase tracking-widest text-space-600 hover:text-ki-400" title={TITLE[pace]}>
      {LABEL[pace]}
    </button>
  );
}
