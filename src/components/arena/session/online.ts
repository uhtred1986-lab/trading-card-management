"use client";

/**
 * The online implementation of `ArenaSession` (#648): the server actions, the
 * long poll on `/api/v1/games/:id` (revision/beat cursors, backoff, lifecycle,
 * `liveGamePolling.ts`) and the router refresh a stale rejection triggers.
 *
 * This is the only module of the arena board that imports `@/app/arena/actions`.
 * Behaviour is exactly what `ArenaStage` did inline before the seam: the same
 * calls with the same arguments, the same polling cadence.
 */
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { abandon, act, advanceGame, chooseSkin, chooseStaging, flagThisTurn, previewGameplanAction, reportBug, rematch } from "@/app/arena/actions";
import { startLiveGamePolling } from "../stage/liveGamePolling";
import { capabilitiesOf, type ArenaSession } from "./contract";

export function createOnlineSession(gameId: number, refresh: () => void, options: { abandon?: boolean } = {}): ArenaSession {
  const methods = {
    advance: () => advanceGame(gameId),
    abandon: options.abandon === false ? undefined : (basedOn: number, requestId: string) => abandon(gameId, basedOn, requestId),
    rematch: () => rematch(gameId),
    flag: (note: string | null) => flagThisTurn(gameId, note),
    preview: (actions: Parameters<typeof previewGameplanAction>[1], basedOn: number) => previewGameplanAction(gameId, actions, basedOn),
    chooseSkin: (skin: Parameters<typeof chooseSkin>[1]) => chooseSkin(gameId, skin),
    chooseStaging: (staging: Parameters<typeof chooseStaging>[1]) => chooseStaging(gameId, staging),
    reportBug: (note: string, cardId: string | null) => reportBug(gameId, note, cardId),
  };
  return {
    gameId,
    capabilities: capabilitiesOf(methods),
    act: (action, basedOn, requestId) => act(gameId, action, basedOn, requestId),
    watch: (options) => startLiveGamePolling({ gameId, ...options }),
    refresh,
    ...methods,
  };
}

/** One online session per game for the life of the page; `router.refresh` is stable. */
export function useOnlineSession(gameId: number, options: { abandon?: boolean } = {}): ArenaSession {
  const canAbandon = options.abandon !== false;
  const router = useRouter();
  return useMemo(() => createOnlineSession(gameId, () => router.refresh(), { abandon: canAbandon }), [gameId, router, canAbandon]);
}
