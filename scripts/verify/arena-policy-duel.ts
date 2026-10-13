/**
 * #646: one pinned match played to its end by two local policies through the boundary's
 * `localStep` (restricted input, cycle guard, decision resolved and played) — the loop the
 * strength measurement in `arena-policy-main.mts` (`npm test`) and `scripts/arena-policy-eval.mts`
 * (`npm run arena:policy-eval`) share. Nothing is invented: a match that does not finish within
 * `maxMoves`, or stops on an interruption, is reported unfinished rather than scored.
 */
import type { PlayerId } from "../../src/lib/arena/types";
import type { ReplayBundleRecord } from "../../src/lib/arena/replay-core";
import { createPinnedMatch, type PinnedMatch } from "../../src/lib/arena/browser";
import { localStep } from "../../src/lib/arena/policy/boundary";
import type { Policy } from "../../src/lib/arena/policy/contract";
import { localMemory, type LocalMemory } from "../../src/lib/arena/policy/main";
import { policyRng } from "../../src/lib/arena/policy/rng";

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

export interface DuelResult {
  over: boolean;
  /** "test", "baseline" or "draw" when over; null otherwise. */
  winner: "test" | "baseline" | "draw" | null;
  reason: string | null;
  moves: number;
  turn: number;
  /** Life the test seat's opponent lost (cards out of the Life Area since the deal), and the test seat. */
  damageDealt: number;
  damageTaken: number;
  /** Decisions the cycle guard took over, by seat role. */
  guards: { test: number; baseline: number };
  /** Why the match stopped short, when it did. */
  stopped: string | null;
  /**
   * What kind of stop (#651): "illegal" is a decision the engine or the contract refused (must be zero),
   * "interrupted" a window no handler reads or a guard with no exit (counted apart from results),
   * "notAsked" a seat with nothing to decide, "limit" the move cap, "noSeat" no seat asked.
   */
  stopKind: "illegal" | "interrupted" | "notAsked" | "limit" | "noSeat" | null;
  /** Wall time per `localStep`, ms. */
  stepMs: number[];
  /** Per `localStep`: the window it answered ("main", "chooseCards", ...) and whose policy it was. */
  steps: { ms: number; window: string; role: "test" | "baseline" }[];
  /** FNV-1a (hex) over every decision played, in order: seat, decision id and the engine events it caused. Equal hashes mean equal games. */
  trace: string;
}

const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

export async function playDuel(input: DuelInput): Promise<DuelResult> {
  let { match } = await createPinnedMatch({ bundle: input.bundle, seed: input.gameSeed, interpreterRevision: input.interpreterRevision });
  const memory: Record<PlayerId, LocalMemory> = { p1: localMemory(policyRng(input.policySeed * 2 + 1)), p2: localMemory(policyRng(input.policySeed * 2 + 2)) };
  const guards = { test: 0, baseline: 0 };
  const stepMs: number[] = [];
  const steps: DuelResult["steps"] = [];
  let hash = 0x811c9dc5;
  const mix = (text: string) => { for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0; };
  let stopped: string | null = null;
  let stopKind: DuelResult["stopKind"] = null;
  let lifeDealt: Record<PlayerId, number> | null = null;
  let n = 0;
  for (; n < input.maxMoves && match.state.phase !== "over"; n++) {
    const seat = (match.state.prompt as { player?: PlayerId }).player;
    if (!seat) { stopped = `no seat is asked (${match.state.prompt.kind})`; stopKind = "noSeat"; break; }
    if (!lifeDealt && match.state.sides.p1.zones.life?.length && match.state.sides.p2.zones.life?.length) lifeDealt = { p1: match.state.sides.p1.zones.life.length, p2: match.state.sides.p2.zones.life.length };
    input.observe?.(match, seat, n);
    const role = seat === input.testSeat ? "test" : "baseline";
    const window = match.state.prompt.kind;
    const t0 = performance.now();
    const step = localStep(match, seat, n, memory[seat], role === "test" ? input.test : input.baseline);
    const ms = performance.now() - t0;
    stepMs.push(ms);
    steps.push({ ms, window, role });
    memory[seat] = step.memory;
    if (!step.ok) { stopped = `${seat}: ${step.reason}: ${step.detail}`; stopKind = step.reason === "interrupted" ? "interrupted" : step.reason === "notAsked" ? "notAsked" : "illegal"; break; }
    mix(`${seat}:${step.id}:${JSON.stringify(step.events)};`);
    if (step.guard) guards[role]++;
    match = step.match;
  }
  const over = match.state.phase === "over";
  const last = [...(match.beats?.list ?? [])].reverse().find((b) => b.t === "over") as { winner: PlayerId | null; reason: string } | undefined;
  const winnerSeat = over ? (last?.winner ?? null) : null;
  const lifeNow = (p: PlayerId) => match.state.sides[p].zones.life?.length ?? 0;
  const dealt = lifeDealt ?? { p1: lifeNow("p1"), p2: lifeNow("p2") };
  return {
    over,
    winner: !over ? null : winnerSeat === null ? "draw" : winnerSeat === input.testSeat ? "test" : "baseline",
    reason: over ? (last?.reason ?? null) : null,
    moves: n,
    turn: match.state.turn,
    damageDealt: Math.max(0, dealt[other(input.testSeat)] - lifeNow(other(input.testSeat))),
    damageTaken: Math.max(0, dealt[input.testSeat] - lifeNow(input.testSeat)),
    guards,
    stopped: over ? null : (stopped ?? `not over after ${input.maxMoves} moves`),
    stopKind: over ? null : (stopKind ?? "limit"),
    stepMs,
    steps,
    trace: hash.toString(16).padStart(8, "0"),
  };
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
