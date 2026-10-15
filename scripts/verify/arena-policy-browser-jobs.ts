/**
 * #651: the duels `scripts/arena-policy-browser.mts` plays in a real browser — the complete local
 * policy (`localPolicy()`) against `uniformPolicy`, the same loop as the Node evaluation
 * (`arena-policy-duel.ts`), run on pinned bundles posted in as JSON. Browser-safe: it imports only the
 * engine-neutral cores and the policy, nothing from `node:`.
 */
import { playDuel } from "./arena-policy-duel";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { uniformPolicy } from "../../src/lib/arena/policy/contract";
import { searchPolicy } from "../../src/lib/arena/policy/search";
import { searchTelemetry, recordSearchTelemetry, type SearchTelemetry } from "../lib/arena-search-telemetry";
import type { ReplayBundleRecord } from "../../src/lib/arena/replay-core";
import type { PlayerId } from "../../src/lib/arena/types";

export interface Job {
  fixture: string;
  bundle: ReplayBundleRecord;
  revision: string;
  gameSeed: number;
  policySeed: number;
  testSeat: PlayerId;
  /** O5 experiment only: search versus the frozen heuristic, both seats. */
  search?: boolean;
  frontierCache?:boolean;
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
  search?: { statuses: Record<string, number>; maxNodes: number; reservedBytes: number;telemetry:SearchTelemetry };
}

export async function runJobs(jobs: Job[], maxMoves: number): Promise<JobResult[]> {
  const local = localPolicy();
  const out: JobResult[] = [];
  for (const j of jobs) {
    const search = { statuses: {} as Record<string, number>, maxNodes: 0, reservedBytes: 0,telemetry:searchTelemetry() };
    const candidate = j.search ? searchPolicy({frontierCache:j.frontierCache===true}, (r) => {
      search.statuses[r.status] = (search.statuses[r.status] ?? 0) + 1;
      recordSearchTelemetry(search.telemetry,r);
      search.maxNodes = Math.max(search.maxNodes, r.nodes);
      search.reservedBytes = Math.max(search.reservedBytes, r.reservedBytes);
    }) : local;
    const r = await playDuel({ bundle: j.bundle, interpreterRevision: j.revision, gameSeed: j.gameSeed, policySeed: j.policySeed, testSeat: j.testSeat, test: candidate, baseline: j.search ? local : uniformPolicy, maxMoves });
    out.push({
      fixture: j.fixture, gameSeed: j.gameSeed, testSeat: j.testSeat, over: r.over, winner: r.winner, moves: r.moves, turn: r.turn, stopKind: r.stopKind, trace: r.trace, guards: r.guards.test,
      steps: r.steps.filter((s) => s.role === "test").map((s) => ({ ms: s.ms, window: s.window })),
      ...(j.search ? { search } : {}),
    });
  }
  return out;
}
