/**
 * #651: the duels `scripts/arena-policy-browser.mts` plays in a real browser — the complete local
 * policy (`localPolicy()`) against `uniformPolicy`, the same loop as the Node evaluation
 * (`arena-policy-duel.ts`), run on pinned bundles posted in as JSON. Browser-safe: it imports only the
 * engine-neutral cores and the policy, nothing from `node:`.
 */
import { playDuel } from "./arena-policy-duel";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { uniformPolicy } from "../../src/lib/arena/policy/contract";
import type { ReplayBundleRecord } from "../../src/lib/arena/replay-core";
import type { PlayerId } from "../../src/lib/arena/types";

export interface Job {
  fixture: string;
  bundle: ReplayBundleRecord;
  revision: string;
  gameSeed: number;
  policySeed: number;
  testSeat: PlayerId;
}

export interface JobResult {
  fixture: string;
  gameSeed: number;
  testSeat: PlayerId;
  over: boolean;
  winner: string | null;
  moves: number;
  turn: number;
  stopKind: string | null;
  trace: string;
  guards: number;
  steps: { ms: number; window: string }[];
}

export async function runJobs(jobs: Job[], maxMoves: number): Promise<JobResult[]> {
  const local = localPolicy();
  const out: JobResult[] = [];
  for (const j of jobs) {
    const r = await playDuel({ bundle: j.bundle, interpreterRevision: j.revision, gameSeed: j.gameSeed, policySeed: j.policySeed, testSeat: j.testSeat, test: local, baseline: uniformPolicy, maxMoves });
    out.push({
      fixture: j.fixture, gameSeed: j.gameSeed, testSeat: j.testSeat, over: r.over, winner: r.winner, moves: r.moves, turn: r.turn, stopKind: r.stopKind, trace: r.trace, guards: r.guards.test,
      steps: r.steps.filter((s) => s.role === "test").map((s) => ({ ms: s.ms, window: s.window })),
    });
  }
  return out;
}
