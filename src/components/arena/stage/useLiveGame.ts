"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Snapshot } from "@/lib/arena/snapshot";
import { LiveGameCore, type ArenaSession, type SessionConnection } from "../session/contract";

export type LiveGameState = {
  snapshot: Snapshot;
  connection: SessionConnection;
  retry(): void;
};

/**
 * The board's snapshot, kept current by the session's `watch` (#648). All of
 * the reconcile/stale/cross-game logic is `LiveGameCore`; this is the React
 * binding. `session` must be stable for the life of the game.
 */
export function useLiveGame(session: ArenaSession, fromServer: Snapshot, active: boolean): LiveGameState {
  // Tagged with the session that produced it: a new session is a new game, and
  // what the last one left on screen is not shown for it.
  const [held, setHeld] = useState<{ session: ArenaSession; snapshot: Snapshot }>({ session, snapshot: fromServer });
  const [connection, setConnection] = useState<SessionConnection>("connected");
  // One core per session.
  const core = useMemo(
    () => new LiveGameCore(session, fromServer, { onSnapshot: (snapshot) => setHeld({ session, snapshot }), onConnection: setConnection }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session],
  );

  useEffect(() => {
    core.adopt(fromServer);
  }, [core, fromServer]);

  const startRevision = fromServer.game.revision;
  const startSeq = fromServer.beats?.seq ?? 0;

  useEffect(() => {
    if (!active) return;
    core.start(fromServer);
    return () => core.stop();
    // The watch restarts on the same keys as before the adapter existed: only
    // the revision and beat of the server render, never the whole snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, core, startRevision, startSeq]);

  const retry = useCallback(() => core.retry(), [core]);
  return { snapshot: held.session === session ? held.snapshot : fromServer, connection: active ? connection : "connected", retry };
}
