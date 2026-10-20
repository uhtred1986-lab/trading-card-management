"use client";

import { useLinkStatus } from "next/link";

/**
 * Inside a queue row's `<Link>`: while that link's page is loading (the card page reads a lot and
 * takes a few seconds), the arrow turns into "Opening…" and a bar runs along the row, so the click
 * visibly did something. Renders the usual arrow the rest of the time.
 */
export function RowOpening() {
  const { pending } = useLinkStatus();
  return (
    <>
      <span className={`text-lg sm:text-[13px] sm:font-bold ${pending ? "text-ki-200" : "text-ki-300"}`} aria-hidden="true">
        {pending ? (
          <span className="animate-pulse">Opening…</span>
        ) : (
          <>
            <span className="sm:hidden">›</span>
            <span className="hidden sm:inline">Open ›</span>
          </>
        )}
      </span>
      {pending && (
        <>
          <span className="pointer-events-none absolute inset-0 bg-ki-500/10" aria-hidden="true" />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-ki-400" aria-hidden="true" />
          <span className="sr-only" role="status">Opening the card…</span>
        </>
      )}
    </>
  );
}
