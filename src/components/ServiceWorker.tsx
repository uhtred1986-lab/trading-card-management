"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js`, which caches card art and nothing else.
 *
 * Production only. A service worker in front of a dev server serves yesterday's
 * bundle from cache and turns every change into a puzzle; there is nothing to
 * learn from it locally that the deployed app will not show.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    // Nothing depends on this working — if it fails the app is exactly as it
    // was, just without a card-art cache.
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
