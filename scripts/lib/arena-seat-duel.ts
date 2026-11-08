/**
 * One pinned match played to its end by two SEAT PLAYERS: the game loop behind `playDuel`
 * (`scripts/verify/arena-policy-duel.ts`, every policy evaluation and the `npm test` strength checks)
 * and the SPRT strength gate (`scripts/arena-sprt.mts`).
 *
 * A seat player is `localStep`-shaped (`src/lib/arena/policy/boundary.ts`): it gets the pinned match,
 * its seat, the move count and its memory, and returns the move played (or why none was). A `Policy`
 * sees only the restricted input; a seat player gets the match itself because a lookahead player needs
 * it to simulate. What it may *use* of the match is the privacy contract: the SPRT runner calls it again
 * on a hidden-state twin (`permutedFor`) and requires the same decision and the same memory.
 *
 * Nothing is invented: a match that does not finish within `maxMoves`, or stops on an interruption, is
 * reported unfinished rather than scored.
 */
import { resolveOutcome } from "../../src/lib/arena/outcome";
import type { PlayerId } from "../../src/lib/arena/types";
import type { ReplayBundleRecord } from "../../src/lib/arena/replay-core";
import { createPinnedMatch, type PinnedMatch } from "../../src/lib/arena/browser";
import { localStep, type LocalStep } from "../../src/lib/arena/policy/boundary";
import type { Policy, PolicyAnswer } from "../../src/lib/arena/policy/contract";
import type { LocalMemory } from "../../src/lib/arena/policy/main";

/** A `LocalStep`, and the answer behind it when the player knows it (the privacy check compares it). */
export type SeatStep = LocalStep & { answer?: PolicyAnswer };

/**
 * One decision for `seat`. Must be a function of its arguments: everything carried between decisions
 * goes through `memory` (returned advanced in the step), because the privacy check calls it a second
 * time, on a twin, with the same memory.
 */
export type SeatPlayer = (match: PinnedMatch, seat: PlayerId, revision: number, memory: LocalMemory) => SeatStep;

/** A `Policy` as a seat player: exactly `localStep` (restricted input, cycle guard, move played). */
export const policyStep = (policy: Policy): SeatPlayer => (match, seat, revision, memory) => localStep(match, seat, revision, memory, policy);

/** As `policyStep`, and the step also carries the policy's answer (absent when the cycle guard answered). */
export function answeringStep(policy: Policy): SeatPlayer {
  return (match, seat, revision, memory) => {
    let answer: PolicyAnswer | undefined;
    const step = localStep(match, seat, revision, memory, (input, rng) => {
      const out = policy(input, rng);
      answer = out.answer;
      return out;
    });
    return answer && step.ok && !step.guard ? { ...step, answer } : step;
  };
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
  /** Wall time per step, ms. */
  stepMs: number[];
  /** Per step: the window it answered ("main", "chooseCards", ...) and whose player it was. */
  steps: { ms: number; window: string; role: "test" | "baseline" }[];
  /** FNV-1a (hex) over every decision played, in order: seat, decision id and the engine events it caused. Equal hashes mean equal games. */
  trace: string;
}

/** What `afterStep` is shown: the position, the step computed for it (played or not), and who computed it. */
export interface StepContext {
  match: PinnedMatch;
  seat: PlayerId;
  revision: number;
  role: "test" | "baseline";
  /** The memory the step was computed from. */
  memory: LocalMemory;
  step: SeatStep;
  player: SeatPlayer;
}

export interface SeatDuelInput {
  bundle: ReplayBundleRecord;
  interpreterRevision: string;
  /** The game's seed (the engine's shuffles). */
  gameSeed: number;
  /** Each physical seat's starting memory (its policy RNG included); never derived from the game seed. */
  memory: Record<PlayerId, LocalMemory>;
  /** The seat `test` plays; `baseline` plays the other. */
  testSeat: PlayerId;
  test: SeatPlayer;
  baseline: SeatPlayer;
  maxMoves: number;
  /** Called before every decision with the match, the seat asked and the move count. */
  observe?: (match: PinnedMatch, seat: PlayerId, revision: number) => void;
  /** Called after every step is computed, before the match moves on; its time is not in `stepMs`. */
  afterStep?: (context: StepContext) => void;
}

const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

export async function playSeatDuel(input: SeatDuelInput): Promise<DuelResult> {
  let { match } = await createPinnedMatch({ bundle: input.bundle, seed: input.gameSeed, interpreterRevision: input.interpreterRevision });
  const memory: Record<PlayerId, LocalMemory> = { ...input.memory };
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
    const player = role === "test" ? input.test : input.baseline;
    const window = match.state.prompt.kind;
    const t0 = performance.now();
    const step = player(match, seat, n, memory[seat]);
    const ms = performance.now() - t0;
    stepMs.push(ms);
    steps.push({ ms, window, role });
    input.afterStep?.({ match, seat, revision: n, role, memory: memory[seat], step, player });
    memory[seat] = step.memory;
    if (!step.ok) { stopped = `${seat}: ${step.reason}: ${step.detail}`; stopKind = step.reason === "interrupted" ? "interrupted" : step.reason === "notAsked" ? "notAsked" : "illegal"; break; }
    mix(`${seat}:${step.id}:${JSON.stringify(step.events)};`);
    if (step.guard) guards[role]++;
    match = step.match;
  }
  // Referee interruptions also close the engine's phase, but are not results.
  // Keep privateContext on the local state; public corpus receipts need only
  // the safe outcome reason and an explicit interrupted stop classification.
  const outcome = resolveOutcome(match.state);
  const interrupted = outcome?.kind === "interrupted";
  const over = match.state.phase === "over" && !interrupted;
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
    stopped: interrupted ? outcome.reason : over ? null : (stopped ?? `not over after ${input.maxMoves} moves`),
    stopKind: interrupted ? "interrupted" : over ? null : (stopKind ?? "limit"),
    stepMs,
    steps,
    trace: hash.toString(16).padStart(8, "0"),
  };
}
