"use client";

import { useState, useSyncExternalStore } from "react";

/**
 * The host's invite link (#369): Share where the browser has the Web Share
 * API (phones), otherwise copy to the clipboard and say so. No token in the
 * URL — the link is only a pointer, and opening it still takes a login.
 */
export function InviteShare({ path, hostName }: { path: string; hostName: string }) {
  // The origin is only known in the browser; the server render shows the path.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const url = origin + path;
  const [note, setNote] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setNote("Link copied");
    } catch {
      setNote("Copy it from the box above");
    }
  };

  const share = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Play me in the arena", text: `${hostName} invites you to a 1 v 1`, url });
        return;
      } catch (err) {
        // Closing the sheet is a choice, not a failure.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    await copy();
  };

  return (
    <div className="space-y-2">
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" className="tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-2 text-xs text-space-200" />
      <button type="button" onClick={() => void share()} className="tap w-full rounded-lg bg-ki-500 px-4 py-2.5 text-sm font-semibold text-space-950">
        Share invite
      </button>
      <p className="min-h-4 text-xs text-ki-300" role="status">
        {note}
      </p>
    </div>
  );
}
