/**
 * #646: one pinned match played to its end by two local policies through the boundary's
 * `localStep` (restricted input, cycle guard, decision resolved and played) — the loop the
 * strength measurement in `arena-policy-main.mts` (`npm test`) and `scripts/arena-policy-eval.mts`
 * (`npm run arena:policy-eval`) share. Nothing is invented: a match that does not finish within
 * `maxMoves`, or stops on an interruption, is reported unfinished rather than scored. The loop itself
 * is `playSeatDuel` (`scripts/lib/arena-seat-duel.ts`), shared with the SPRT gate's seat players.
 */
import type { PlayerId } from "../../src/lib/arena/types";
import type { ReplayBundleRecord } from "../../src/lib/arena/replay-core";
import type { PinnedMatch } from "../../src/lib/arena/browser";
import type { Policy } from "../../src/lib/arena/policy/contract";
import { localMemory } from "../../src/lib/arena/policy/main";
import { policyRng } from "../../src/lib/arena/policy/rng";
import { playSeatDuel, policyStep, type DuelResult } from "../lib/arena-seat-duel";

export type { DuelResult } from "../lib/arena-seat-duel";

export interface DuelInput {
  bundle: ReplayBundleRecord;
  interpreterRevision: string;
  /** The game's seed (the engine's shuffles). */
  gameSeed: number;
  /** The policies' own RNG seeds derive from this; never the game's. */
  policySeed: number;
  /** The seat `test` plays; `baseline` plays the other. */
  testSeat: PlayerId;
  test: Policy;
  baseline: Policy;
  maxMoves: number;
  /** Called before every decision with the match, the seat asked and the move count. */
  observe?: (match: PinnedMatch, seat: PlayerId, revision: number) => void;
}

/** Two policies, each through `localStep`, with seat p1's RNG `policyRng(2·policySeed + 1)` and p2's `+ 2`. The loop is `playSeatDuel`. */
export async function playDuel(input: DuelInput): Promise<DuelResult> {
  return playSeatDuel({
    bundle: input.bundle,
    interpreterRevision: input.interpreterRevision,
    gameSeed: input.gameSeed,
    memory: { p1: localMemory(policyRng(input.policySeed * 2 + 1)), p2: localMemory(policyRng(input.policySeed * 2 + 2)) },
    testSeat: input.testSeat,
    test: policyStep(input.test),
    baseline: policyStep(input.baseline),
    maxMoves: input.maxMoves,
    observe: input.observe,
  });
}

export interface DuelSummary {
  games: number;
  finished: number;
  wins: number;
  losses: number;
  draws: number;
  unfinished: number;
  damageDealt: number;
  damageTaken: number;
  guards: { test: number; baseline: number };
  bySeat: Record<PlayerId, { games: number; wins: number; losses: number }>;
}

export function summarise(results: { seat: PlayerId; r: DuelResult }[]): DuelSummary {
  const s: DuelSummary = { games: 0, finished: 0, wins: 0, losses: 0, draws: 0, unfinished: 0, damageDealt: 0, damageTaken: 0, guards: { test: 0, baseline: 0 }, bySeat: { p1: { games: 0, wins: 0, losses: 0 }, p2: { games: 0, wins: 0, losses: 0 } } };
  for (const { seat, r } of results) {
    s.games++;
    s.bySeat[seat].games++;
    if (r.over) s.finished++; else s.unfinished++;
    if (r.winner === "test") { s.wins++; s.bySeat[seat].wins++; }
    if (r.winner === "baseline") { s.losses++; s.bySeat[seat].losses++; }
    if (r.winner === "draw") s.draws++;
    s.damageDealt += r.damageDealt;
    s.damageTaken += r.damageTaken;
    s.guards.test += r.guards.test;
    s.guards.baseline += r.guards.baseline;
  }
  return s;
}

/** A two-sided 95 % Wilson interval for `wins` of `n`, as [low, high]. */
export function wilson(wins: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96;
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - r) / d, (c + r) / d];
}

export const quantile = (xs: number[], q: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
};
