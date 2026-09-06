"use client";

import { useEffect, useState } from "react";

/**
 * True once nothing has happened for a while.
 *
 * The board uses it to answer the question a new player actually has, which is
 * not "what is legal" but "what am I supposed to do now" — after a few seconds
 * of nothing, every card that can be tapped says so. It goes quiet again the
 * moment anything changes, so it never nags.
 *
 * `signal` is whatever counts as activity; a change to it starts the clock over.
 */
export function useIdle(ms: number, signal: unknown): boolean {
  const [seen, setSeen] = useState(signal);
  const [idle, setIdle] = useState(false);

  // Adjusting state during render rather than in an effect: the board must stop
  // nudging in the same paint that the thing it was nudging about changed.
  if (seen !== signal) {
    setSeen(signal);
    setIdle(false);
  }

  useEffect(() => {
    const t = setTimeout(() => setIdle(true), ms);
    return () => clearTimeout(t);
  }, [seen, ms]);

  return idle;
}
