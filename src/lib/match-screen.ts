"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * A match on screen on a route that is not itself full-bleed (#783).
 *
 * `/arena/offline` is one prerendered page for the offline shell's setup *and* its board, so its
 * path cannot say whether a match is showing: the board says so instead, by mounting
 * `useMatchScreen()`, and `AppShell` drops the app's header and tab bar while it is mounted — the same
 * whole-screen board `isFullBleed` gives `/arena/[id]` and `/arena/local`. No router, no cookie: a
 * module-level count the board and the shell share.
 */
let screens = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

function subscribe(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Whether a board has claimed the screen. False on the server, so the first paint matches it. */
export function useMatchOnScreen(): boolean {
  return useSyncExternalStore(subscribe, () => screens > 0, () => false);
}

/** Mounted by a board: the screen is the match's while it is. */
export function useMatchScreen(on = true): void {
  useEffect(() => {
    if (!on) return;
    screens++;
    notify();
    return () => {
      screens--;
      notify();
    };
  }, [on]);
}
