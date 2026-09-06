"use client";

import { useEffect, useState } from "react";
import type { Snapshot } from "@/lib/arena/snapshot";

/**
 * Claude's turn, as it is decided rather than after it is over.
 *
 * `act()` applies your move and then runs the whole opponent turn before it
 * returns, which can be most of a minute in Tournament — so the board used to
 * sit on a pulsing dot for all of it and then play the story back at the end.
 *
 * But `advance` commits each of Claude's moves to the row as it makes them,
 * so a *concurrent* reader sees them arrive. That is all this does: while a
 * move is in flight it long-polls `GET /api/v1/games/{id}` — the same endpoint
 * the Android app uses, contract §6 — and hands the board each fresh snapshot,
 * so the beat player starts telling the story while Claude is still deciding
 * the rest of it.
 *
 * Nothing depends on it working. If the poll fails the board simply behaves as
 * it did before: one jump when the server action finally returns.
 */
export function useLiveGame(gameId: number, fromServer: Snapshot, active: boolean): Snapshot {
  // The last snapshot React rendered from the server. Its identity only
  // changes when the server actually re-rendered, which is exactly when its
  // version should win over anything polled.
  const [server, setServer] = useState(fromServer);
  const [live, setLive] = useState(fromServer);

  if (server !== fromServer) {
    setServer(fromServer);
    setLive(fromServer);
  }

  const startSeq = fromServer.beats?.seq ?? 0;

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let since = startSeq;

    const poll = async () => {
      while (!stopped) {
        let next: Snapshot;
        try {
          const res = await fetch(`/api/v1/games/${gameId}?sinceBeat=${since}&wait=15`, { cache: "no-store" });
          if (!res.ok) return;
          next = (await res.json()) as Snapshot;
        } catch {
          // Offline, or the request was cut off. The server action is still
          // running and will revalidate when it finishes.
          return;
        }
        if (stopped) return;
        const seq = next.beats?.seq ?? 0;
        if (seq > since) {
          since = seq;
          setLive(next);
        }
        // Once the game is waiting on you again there is nothing left to watch;
        // the server action's own revalidate delivers the authoritative board.
        if (next.waiting !== "opponent" && next.waiting !== "referee") return;
      }
    };

    void poll();
    return () => {
      stopped = true;
    };
  }, [active, gameId, startSeq]);

  return live;
}
