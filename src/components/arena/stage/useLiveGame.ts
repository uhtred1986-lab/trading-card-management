"use client";

import { useEffect, useRef, useState } from "react";
import { reconcileSnapshot, type Snapshot } from "@/lib/arena/snapshot";

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
 * It does the same job for a 1 v 1, where "the server deciding" is instead the
 * other player deciding: `waiting` reads "opponent" for a person exactly as it
 * does for Claude, so their move arrives here without this hook knowing there
 * is a difference.
 *
 * Nothing depends on it working. If the poll fails the board simply behaves as
 * it did before: one jump when the server action finally returns.
 */
export function useLiveGame(gameId: number, fromServer: Snapshot, active: boolean): Snapshot {
  const [live, setLive] = useState(fromServer);
  const latest = useRef(fromServer);

  useEffect(() => {
    const newest = reconcileSnapshot(latest.current, fromServer);
    if (newest === fromServer) {
      latest.current = newest;
      setLive(newest);
    }
  }, [fromServer]);

  const startRevision = fromServer.game.revision;
  const startSeq = fromServer.beats?.seq ?? 0;

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const sameGame = latest.current.game.id === gameId;
    let sinceRevision = sameGame ? Math.max(startRevision, latest.current.game.revision) : startRevision;
    let sinceBeat = sameGame ? Math.max(startSeq, latest.current.beats?.seq ?? 0) : startSeq;

    // A human opponent can think for minutes, over a phone that changes
    // network on the way. Against Claude a dropped poll cost nothing — the
    // server action was still running and would revalidate on its own — but
    // here nothing else is coming, so a dropped poll is a dead board. Back off
    // and try again instead, and give up only after several failures in a row.
    let failures = 0;
    const backoff = () => new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** failures)));

    const poll = async () => {
      while (!stopped) {
        let next: Snapshot;
        try {
          const res = await fetch(`/api/v1/games/${gameId}?sinceRevision=${sinceRevision}&sinceBeat=${sinceBeat}&wait=15`, { cache: "no-store" });
          // A 404 means this login may not read the game; retrying cannot help.
          if (res.status === 404) return;
          if (!res.ok) throw new Error(String(res.status));
          next = (await res.json()) as Snapshot;
          failures = 0;
        } catch {
          if (++failures > 6) return;
          await backoff();
          continue;
        }
        if (stopped) return;
        const seq = next.beats?.seq ?? 0;
        if (next.game.revision > sinceRevision) {
          sinceRevision = next.game.revision;
          sinceBeat = Math.max(sinceBeat, seq);
          // Server renders and poll responses can arrive out of order. Keep
          // the highest authoritative row revision already observed.
          const newest = reconcileSnapshot(latest.current, next);
          if (newest === next) {
            latest.current = newest;
            setLive(newest);
          }
        }
        if (seq > sinceBeat) sinceBeat = seq;
        if (next.game.status !== "playing") return;
        if (next.game.mode !== "versus" && next.waiting !== "opponent" && next.waiting !== "referee") return;
      }
    };

    void poll();
    return () => {
      stopped = true;
    };
  }, [active, gameId, startRevision, startSeq]);

  return live;
}
