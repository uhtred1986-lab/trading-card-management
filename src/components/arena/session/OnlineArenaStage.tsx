"use client";

import type { ComponentProps } from "react";
import { ArenaStage } from "../stage/ArenaStage";
import { useOnlineSession } from "./online";

type StageProps = ComponentProps<typeof ArenaStage>;

/**
 * The game page's board: `ArenaStage` over the online session (#648). A server
 * component cannot hand a client component a session object (it holds
 * functions), so this wrapper builds it on the client from the game id.
 */
export function OnlineArenaStage({ gameId, canAbandon = true, ...props }: Omit<StageProps, "session"> & { gameId: number; canAbandon?: boolean }) {
  const session = useOnlineSession(gameId, { abandon: canAbandon });
  return <ArenaStage session={session} {...props} />;
}
