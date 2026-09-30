"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { matchGameId } from "@/app/arena/actions";
import { waitingRoomStepMs } from "@/lib/arena/poll-schedule";

/**
 * Ask, every couple of seconds, whether the other player has joined yet.
 *
 * A plain timer rather than the board's long-poll: this waits on a person
 * choosing a deck, which can take a minute or ten, and holding a function open
 * for all of it would buy nothing. The board's own poll is for the seconds
 * inside a turn, where latency is the whole point.
 *
 * Every ask is a database read, so it backs off (2.5 s, then 5 s after 30 s —
 * `waitingRoomStepMs`), stops while the tab is hidden, and asks at once when
 * the tab comes back (issue #377).
 */
export function MatchWaiting({ matchId }: { matchId: number }) {
  const router = useRouter();
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const opened = Date.now();

    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      clear();
      if (stopped || document.hidden) return;
      timer = setTimeout(() => void tick(), waitingRoomStepMs(Date.now() - opened));
    };
    const tick = async () => {
      clear();
      try {
        const r = await matchGameId(matchId);
        if (stopped) return;
        if (r.gameId) {
          stopped = true;
          router.replace(`/arena/${r.gameId}`);
          return;
        }
        if (r.status === "cancelled") setGone(true);
      } catch {
        // Offline, or the tab was backgrounded mid-flight. Ask again.
      }
      schedule();
    };
    const onVisibility = () => {
      if (stopped) return;
      if (document.hidden) clear();
      else void tick();
    };

    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) void tick();
    return () => {
      stopped = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
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
