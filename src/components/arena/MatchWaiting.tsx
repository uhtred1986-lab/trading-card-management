"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { matchGameId } from "@/app/arena/actions";

/**
 * Ask, every couple of seconds, whether the other player has joined yet.
 *
 * A plain interval rather than the board's long-poll: this waits on a person
 * choosing a deck, which can take a minute or ten, and holding a function open
 * for all of it would buy nothing. The board's own poll is for the seconds
 * inside a turn, where latency is the whole point.
 */
export function MatchWaiting({ matchId }: { matchId: number }) {
  const router = useRouter();
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const r = await matchGameId(matchId);
        if (stopped) return;
        if (r.gameId) {
          router.replace(`/arena/${r.gameId}`);
          return;
        }
        if (r.status === "cancelled") setGone(true);
      } catch {
        // Offline, or the tab was backgrounded mid-flight. Ask again.
      }
    };
    const timer = setInterval(tick, 2500);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [matchId, router]);

  if (gone) return <p className="text-sm text-space-400">This match was called off.</p>;

  return (
    <p className="flex items-center justify-center gap-2 text-sm text-space-400" role="status">
      <span className="arena-pulse h-2.5 w-2.5 animate-pulse rounded-full bg-ki-400" aria-hidden />
      Waiting…
    </p>
  );
}
