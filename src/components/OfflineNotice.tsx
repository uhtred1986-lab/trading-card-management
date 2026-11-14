"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { isReadableOffline, isPokemonReadable } from "@/lib/offline-pages";

/**
 * The line shown on the pages the service worker keeps for reading (`public/sw.js`, "Offline
 * reading" in docs/architecture/collection-and-decks.md) while the browser reports no network:
 * what is on screen is what this device last saw. German on the Pokémon pages, English elsewhere.
 *
 * It also keeps an action that needs the server from failing silently there: a form submit, or a
 * click on anything marked `data-needs-network`, is stopped and the line says so instead. (Buttons
 * that run a Server Function on click with no form and no mark are not caught here; the Pokémon
 * screens, which have the most of them, say "Kein Internet" themselves when the call fails.)
 */
const subscribe = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

export function OfflineNotice() {
  const pathname = usePathname();
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [refused, setRefused] = useState(false);
  const watching = !online && isReadableOffline(pathname);
  const german = isPokemonReadable(pathname);

  useEffect(() => {
    if (!watching) return;
    const stop = (e: Event) => {
      const el = e.target as Element | null;
      if (e.type === "click" && !el?.closest?.("[data-needs-network]")) return;
      e.preventDefault();
      e.stopPropagation();
      setRefused(true);
    };
    document.addEventListener("submit", stop, true);
    document.addEventListener("click", stop, true);
    return () => {
      document.removeEventListener("submit", stop, true);
      document.removeEventListener("click", stop, true);
    };
  }, [watching]);

  useEffect(() => {
    if (!refused) return;
    const t = window.setTimeout(() => setRefused(false), 4000);
    return () => window.clearTimeout(t);
  }, [refused]);

  if (!watching) return null;
  const text = refused
    ? german
      ? "Kein Internet. Das geht erst wieder mit Verbindung."
      : "You are offline. This needs a connection."
    : german
      ? "Kein Internet. Du siehst den letzten Stand."
      : "You are offline. You are seeing what this device saw last.";
  return (
    <p
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-30 mx-auto w-fit max-w-[calc(100%-1.5rem)] rounded-full border border-amber-400/60 bg-space-950/95 px-4 py-1.5 text-center text-sm text-amber-200 shadow-lg sm:bottom-4"
    >
      {text}
    </p>
  );
}
