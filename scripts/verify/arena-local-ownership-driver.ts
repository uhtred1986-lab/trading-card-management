/**
 * #654: the match loop the ownership/recovery proofs play through a `LocalMatchSupervisor` —
 * `arena-local-ownership.mts` (Node: in-process workers that can be killed, the store on the fake
 * IndexedDB) and `scripts/arena-local-ownership-browser.mts` (Chrome: two real tabs, real Workers,
 * real IndexedDB and Web Locks). The human's move is `humanPick` of the board and the AI's are the
 * worker's, so every run is #652's scripted game whatever was killed, raced or taken over on the way.
 * Browser-safe: the supervisor, the page client and the protocol only.
 */
import { LocalWorkerSession } from "../../src/components/arena/session/local";
import { LocalMatchSupervisor, type SpawnedWorker, type SupervisorOptions } from "../../src/lib/arena/local/recovery";
import type { OwnershipOptions } from "../../src/lib/arena/local/ownership";
import type { Snapshot } from "../../src/lib/arena/snapshot-core";
import { GAME_ID, LOCAL_REVISION, LoopRefused, humanAsked, humanPick, scriptedStart } from "./arena-local-storage-driver";

export { GAME_ID, LOCAL_REVISION, LoopRefused, aiAsked, humanAsked, humanPick, requestIds } from "./arena-local-storage-driver";

export interface SupLoopOptions {
  nextId: () => string;
  /** AI decisions per advance (default 2). */
  maxDecisions?: number;
  onBoard?: (snapshot: Snapshot) => void | Promise<void>;
  stop?: (sup: LocalMatchSupervisor) => boolean;
  maxSteps?: number;
}

/** Play through the supervisor until the game ends or `stop`; a refusal throws `LoopRefused`. */
export async function supLoop(sup: LocalMatchSupervisor, o: SupLoopOptions): Promise<"over" | "stopped"> {
  for (let step = 0; step < (o.maxSteps ?? 6000); step++) {
    const snap = sup.snapshot!;
    await o.onBoard?.(snap);
    if (snap.game.status === "over") return "over";
    if (o.stop?.(sup)) return "stopped";
    const answer = humanAsked(snap)
      ? await sup.actRaw(humanPick(snap), snap.game.revision, o.nextId())
      : await sup.advanceRaw(o.maxDecisions ?? 2);
    if (!answer.ok) throw new LoopRefused(answer, snap.game.revision);
  }
  throw new Error("the loop did not finish");
}

/** The scripted match, opened through a supervisor (start when `start`, else resume). */
export function openSupervised(pack: unknown, matchId: string, start: boolean, spawn: () => SpawnedWorker, extra: Partial<SupervisorOptions> & { ownership?: OwnershipOptions } = {}): Promise<LocalMatchSupervisor> {
  const clone = JSON.parse(JSON.stringify(pack)) as unknown;
  const input = start
    ? { start: scriptedStart(clone, matchId, { batch: 2 }) }
    : { resume: { matchId, gameId: GAME_ID, pack: clone, interpreterRevision: LOCAL_REVISION, batch: 2 } };
  return LocalMatchSupervisor.open(input, { spawn, sessions: LocalWorkerSession, ...extra });
}

/** Wait (polling) until `predicate` holds; false after `ms`. */
export async function until(predicate: () => boolean, ms = 20000, step = 10): Promise<boolean> {
  const t0 = Date.now();
  while (!predicate()) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, step));
  }
  return true;
}
