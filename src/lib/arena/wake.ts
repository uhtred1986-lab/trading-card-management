"use client";

import { useEffect } from "react";

/**
 * Hold the screen awake while a game is on.
 *
 * A Tournament turn can take Claude most of a minute, during which nobody
 * touches the phone and Android dims and locks it. The lock is dropped the
 * moment the game ends or the board unmounts, and re-taken when the tab comes
 * back — a wake lock is released automatically whenever the page is hidden,
 * so without that the screen stops staying awake after the first glance away.
 *
 * Unsupported everywhere it is unsupported (notably iOS Safari), where this
 * does nothing at all.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let dropped = false;

    const take = async () => {
      try {
        if (dropped || document.visibilityState !== "visible") return;
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // Denied, or the battery is too low for the OS to allow it.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void take();
    };

    void take();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      dropped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
