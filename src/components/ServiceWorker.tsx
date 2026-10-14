"use client";

import { useEffect } from "react";
import { SHELL_MANIFEST_PATH, SHELL_VERSION_PATTERN, isPreparedDevice } from "@/lib/arena/local/shell";

/**
 * Registers `public/sw.js`: the card-art cache and the offline shell (#659, `src/lib/arena/local/shell.ts`).
 *
 * The shell is for devices PREPARED for offline play (#660, `isPreparedDevice`: the mark the
 * preparation flow sets and "remove everything" clears). An unprepared device registers the worker
 * with no version — card art only, no ~3 MB shell download on every deploy — and leaves a worker it
 * already has alone. A prepared device downloads each deploy's shell and keeps it current.
 *
 * On a prepared device the worker is registered as `/sw.js?v=<version>`, the version of this build's shell list
 * (`/arena/offline/shell.json`), so a new build is a new worker — which installs beside the old one
 * and waits until every window of the app is closed (it never `skipWaiting`s). With no network the
 * list cannot be read and the registration already on the device is left exactly as it is.
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
    // was, just without the caches.
    void (async () => {
      if (!isPreparedDevice()) {
        if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register("/sw.js");
        return;
      }
      let version: string | null = null;
      try {
        const res = await fetch(SHELL_MANIFEST_PATH, { cache: "no-store", credentials: "omit" });
        const body = res.ok ? ((await res.json()) as { version?: unknown }) : null;
        if (typeof body?.version === "string" && SHELL_VERSION_PATTERN.test(body.version)) version = body.version;
      } catch {
        // Offline: keep whatever worker this device already has.
      }
      if (version) await navigator.serviceWorker.register(`/sw.js?v=${version}`);
      else if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register("/sw.js");
    })().catch(() => {});
  }, []);

  return null;
}
