"use client";

import { useEffect } from "react";
import { ArenaStage } from "@/components/arena/stage/ArenaStage";
import { setPacePref, type Pace } from "@/lib/arena/pace";
import type { Snapshot } from "@/lib/arena/snapshot";
import type { ArenaSkin } from "@/lib/arena/skin";
import type { ArenaStaging } from "@/lib/arena/staging";

/**
 * The real board with its two server actions stubbed. A tap goes nowhere: it
 * is answered with no error and no change, so a screenshot shows the state the
 * fixture describes and the opened sheets, never a server round trip.
 */
const STUB = {
  act: async () => ({ error: null }),
  advance: async () => ({ error: null }),
};

export function PreviewStage({ snapshot, skin, staging, pace, announceTurn }: { snapshot: Snapshot; skin: ArenaSkin; staging: ArenaStaging; pace: Pace | null; announceTurn: boolean }) {
  useEffect(() => {
    if (pace) setPacePref(pace);
  }, [pace]);
  return <ArenaStage gameId={snapshot.game.id} snapshot={snapshot} skin={skin} staging={staging} server={STUB} announceTurn={announceTurn} />;
}
