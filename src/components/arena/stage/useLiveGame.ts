"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { reconcileSnapshot, type Snapshot } from "@/lib/arena/snapshot";
import { startLiveGamePolling, type LiveConnection } from "./liveGamePolling";

export type LiveGameState = {
  snapshot: Snapshot;
  connection: LiveConnection;
  retry(): void;
};

export function useLiveGame(gameId: number, fromServer: Snapshot, active: boolean): LiveGameState {
  const [live, setLive] = useState(fromServer);
  const [connection, setConnection] = useState<LiveConnection>("connected");
  const latest = useRef(fromServer);
  const poller = useRef<ReturnType<typeof startLiveGamePolling> | null>(null);

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
    const sameGame = latest.current.game.id === gameId;
    poller.current = startLiveGamePolling({
      gameId,
      revision: sameGame ? Math.max(startRevision, latest.current.game.revision) : startRevision,
      beat: sameGame ? Math.max(startSeq, latest.current.beats?.seq ?? 0) : startSeq,
      onConnection: setConnection,
      onSnapshot(next) {
        const current = latest.current;
        const newest = reconcileSnapshot(current, next);
        if (newest !== current) {
          latest.current = newest;
          setLive(newest);
        } else if (next.game.id === current.game.id && next.game.revision === current.game.revision && (next.beats?.seq ?? 0) > (current.beats?.seq ?? 0)) {
          // Animation sequences may advance independently of the row revision.
          const beatUpdate = { ...current, beats: next.beats };
          latest.current = beatUpdate;
          setLive(beatUpdate);
        }
      },
    });
    return () => {
      poller.current?.stop();
      poller.current = null;
    };
  }, [active, gameId, startRevision, startSeq]);

  const retry = useCallback(() => poller.current?.retry(), []);
  return { snapshot: live, connection: active ? connection : "connected", retry };
}
