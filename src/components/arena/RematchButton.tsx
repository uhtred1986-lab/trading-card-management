"use client";

import { useState, useTransition } from "react";
import { rematch } from "@/app/arena/actions";

/**
 * Rematch on a finished row of the Games list (ah-05). The same server action
 * as GameOver's button (#358): on success it redirects and never returns, on a
 * refusal (a deck gone, an open rule) the reason shows under the row.
 */
export function RematchButton({ gameId, versus }: { gameId: number; versus: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await rematch(gameId);
            setError(r.error);
          })
        }
        className="tap min-w-24 rounded-lg border border-ki-500/60 px-3 text-sm font-semibold text-ki-300 hover:bg-ki-500/10 disabled:opacity-60"
      >
        {pending ? (versus ? "Opening…" : "Dealing…") : versus ? "Invite again" : "Rematch"}
      </button>
      {error && <p className="max-w-40 text-right text-xs text-loss">{error}</p>}
    </div>
  );
}
