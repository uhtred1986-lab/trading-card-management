/**
 * #653: the plain match loop both storage proofs play — `arena-local-storage.mts` (Node, the store on
 * a fake IndexedDB) and `scripts/arena-local-storage-browser.mts` (Chrome, a real Worker on the real
 * one). The human's move is `humanPick` of the board, the AI's are the worker's, so every run of
 * the scripted pack and seeds — whatever was saved, reloaded, killed or retried on the way — is the
 * same game as #652's scripted runs. Browser-safe: the page client and the protocol only.
 */
import { LocalWorkerSession, type LocalSessionOptions, type WorkerPort } from "../../src/components/arena/session/local";
import type { ErrorMessage, ResultMessage } from "../../src/lib/arena/local/protocol";
import type { Snapshot } from "../../src/lib/arena/snapshot-core";
import { GAME_ID, LOCAL_REVISION, humanPick, scriptedStart } from "./arena-local-worker-driver";

export { GAME_ID, LOCAL_REVISION, humanPick, requestIds, scriptedStart } from "./arena-local-worker-driver";

export const humanAsked = (s: Snapshot) => s.game.status !== "over" && s.decision?.actor === s.game.you && s.legal.length > 0;
/** The computer is being asked (as far as the human's board shows: not over, and not the human's question). */
export const aiAsked = (s: Snapshot) => s.game.status !== "over" && !humanAsked(s);

/** A refusal met by the loop, with the worker's answer. */
export class LoopRefused extends Error {
  constructor(readonly answer: ErrorMessage | { ok: false; code: string; message: string; reasons?: string[] }, readonly at: number) {
    super(`refused at revision ${at}: ${answer.code} ${answer.message}`);
  }
}

export interface LoopOptions {
  nextId: () => string;
  /** AI decisions per advance (default 2, so a save can fall in the middle of an AI turn). */
  maxDecisions?: number;
  /** Every board the loop sees, before it acts on it. */
  onBoard?: (snapshot: Snapshot) => void | Promise<void>;
  /** Stop before acting on this board. */
  stop?: (session: LocalWorkerSession) => boolean;
  maxSteps?: number;
}

/** Play until the game ends or `stop`; a refusal throws `LoopRefused` and leaves the session as it is. */
export async function playLoop(session: LocalWorkerSession, o: LoopOptions): Promise<"over" | "stopped"> {
  for (let step = 0; step < (o.maxSteps ?? 6000); step++) {
    const snap = session.snapshot!;
    await o.onBoard?.(snap);
    if (snap.game.status === "over") return "over";
    if (session.status === "interrupted") throw new LoopRefused({ ok: false, code: "interrupted", message: session.interruption ?? "" }, snap.game.revision);
    if (o.stop?.(session)) return "stopped";
    if (humanAsked(snap)) {
      const r = await session.act(humanPick(snap), snap.game.revision, o.nextId());
      if (r.error === null) continue;
      const last = session.diagnostics.errors[session.diagnostics.errors.length - 1] ?? r.error;
      const code = last.split(":")[0];
      throw new LoopRefused({ ok: false, code, message: last }, snap.game.revision);
    }
    const answer: ResultMessage | ErrorMessage = await session.advanceRaw(o.maxDecisions ?? 2);
    if (!answer.ok) throw new LoopRefused(answer, snap.game.revision);
  }
  throw new Error("the loop did not finish");
}

/** Start the scripted match under `matchId` (batches of 2). */
export function startLoopMatch(port: WorkerPort, pack: unknown, matchId: string, options: LocalSessionOptions): Promise<LocalWorkerSession> {
  return LocalWorkerSession.start(port, scriptedStart(pack, matchId, { batch: 2 }), options);
}

/** Resume `matchId` from the worker's store. */
export function resumeLoopMatch(port: WorkerPort, pack: unknown, matchId: string, options: LocalSessionOptions): Promise<LocalWorkerSession> {
  return LocalWorkerSession.resume(port, { matchId, gameId: GAME_ID, pack: JSON.parse(JSON.stringify(pack)), interpreterRevision: LOCAL_REVISION, batch: 2 }, options);
}
