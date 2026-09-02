"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buildDeckAction } from "@/app/leaders/actions";

/** Asks Claude for a deck around this leader, then opens the new virtual deck. */
export function BuildDeckButton({ leaderId, enabled }: { leaderId: string; enabled: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const build = () =>
    start(async () => {
      setError(null);
      const r = await buildDeckAction(leaderId);
      if (r.ok) router.push(`/decks/${r.deckId}`);
      else setError(r.error);
    });

  return (
    <div className="space-y-1">
      <button
        onClick={build}
        disabled={pending || !enabled}
        title={enabled ? "Claude drafts a 50-card deck, preferring cards you own" : "Set ANTHROPIC_API_KEY"}
        className="tap w-full rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50"
      >
        {pending ? "Drafting… (30–60 s)" : "Build a deck with Claude"}
      </button>
      {error ? <p className="text-xs text-loss">{error}</p> : null}
    </div>
  );
}
