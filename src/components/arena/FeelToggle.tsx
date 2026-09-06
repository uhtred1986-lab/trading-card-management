"use client";

import { useSyncExternalStore } from "react";
import { feel, feelPrefs, serverFeelPrefs, setFeelPrefs, subscribeFeel, type FeelPrefs } from "@/lib/arena/feel";

/**
 * Buzz and sound, on or off, from the board itself.
 *
 * The preference lives in `localStorage`, which the server cannot read, so it
 * is read through `useSyncExternalStore` with the defaults as the server's
 * answer: the first client render matches the markup the server sent, and the
 * real setting arrives immediately after without a hydration mismatch.
 */
export function FeelToggle() {
  const prefs = useSyncExternalStore(subscribeFeel, feelPrefs, serverFeelPrefs);

  const toggle = (key: keyof FeelPrefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setFeelPrefs(next);
    // Answer with the thing that was just switched on, so it is obvious what
    // it does. The audio context also needs a user gesture to start, and this
    // tap is one.
    if (next[key]) feel("tap");
  };

  const style = (on: boolean) => `tap uppercase tracking-widest ${on ? "text-ki-300" : "text-space-600"} hover:text-ki-400`;

  return (
    <>
      <button type="button" onClick={() => toggle("haptics")} aria-pressed={prefs.haptics} className={style(prefs.haptics)} title="Vibration">
        buzz
      </button>
      <button type="button" onClick={() => toggle("sound")} aria-pressed={prefs.sound} className={style(prefs.sound)} title="Sound">
        sound
      </button>
    </>
  );
}
