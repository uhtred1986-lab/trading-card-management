/**
 * One paired deal of the SPRT gate: the same engine seed, decks and per-seat policy RNG, played twice,
 * the candidate in p1 and then in p2. Shared by the runner's worker processes and its in-process mode
 * (`--workers 0`), so a deal's outcome is the same whichever process plays it.
 *
 * Integrity: every game must finish. An illegal answer, an interruption, a seat with nothing to decide,
 * the move cap, an exception, a hidden-twin privacy failure or a cycle-guard takeover of the candidate is
 * an integrity failure, recorded with the game and never dropped; the run cannot pass with one. An
 * unfinished game scores 0 for the candidate.
 */
import type { PlayerId } from "../../src/lib/arena/types";
import { policyTurn } from "../../src/lib/arena/policy/boundary";
import { stableJson } from "../../src/lib/arena/policy/contract";
import { localMemory, type LocalMemory } from "../../src/lib/arena/policy/main";
import { policyRng } from "../../src/lib/arena/policy/rng";
import type { Fixture } from "../verify/arena-policy-fixtures.mts";
import { permutedFor } from "../verify/arena-policy-permute";
import { playSeatDuel, type DuelResult, type SeatStep, type StepContext } from "./arena-seat-duel";
import { playerFactory } from "./arena-sprt-players";

export interface DealSpec {
  /** Position in the run's deal order. */
  deal: number;
  fixture: string;
  engineSeed: number;
  /** p1's policy RNG is policyRng(2·policySeed + 1), p2's policyRng(2·policySeed + 2), in both games. */
  policySeed: number;
  candidate: string;
  baseline: string;
}

export interface DealOptions {
  maxMoves: number;
  /** Check every Kth decision of the candidate on a hidden-state twin; 0 turns the check off. */
  privacyEvery: number;
}

export interface GameOutcome {
  candidateSeat: PlayerId;
  winner: "candidate" | "baseline" | "draw" | null;
  /** The candidate's points: 1, 1/2 for a draw, 0 for a loss or an unfinished game. */
  points: number;
  stopKind: DuelResult["stopKind"] | "error";
  stopped: string | null;
  moves: number;
  turn: number;
  guards: { candidate: number; baseline: number };
  /** Twin checks run, twins whose state really differed, failures and the first few of them. */
  privacy: { checks: number; nontrivial: number; failures: number; examples: string[] };
  /** Everything that makes this game count against the run's validity. */
  integrity: string[];
  /** FNV-1a over the decisions and events: equal hashes, equal games. */
  trace: string;
  /** Wall time of the game in its process, ms (not deterministic). */
  ms: number;
}

export interface PairOutcome extends DealSpec {
  games: [GameOutcome, GameOutcome];
  /** The candidate's points over the two games: 0, 0.5, 1, 1.5 or 2. */
  points: number;
}

const firstDifference = (a: SeatStep, b: SeatStep): string | null => {
  if (a.ok !== b.ok) return a.ok ? "the decision plays on the real position but not on the twin" : "the decision plays on the twin but not on the real position";
  if (!a.ok && !b.ok) return a.reason === b.reason ? null : `refused differently (${a.reason} vs ${b.reason})`;
  if (a.ok && b.ok) {
    if (a.id !== b.id) return `decision ${a.id} vs ${b.id} on the twin`;
    if (a.guard !== b.guard) return `cycle guard ${String(a.guard)} vs ${String(b.guard)} on the twin`;
    if (stableJson(a.answer?.cards ?? null) !== stableJson(b.answer?.cards ?? null)) return "picked cards differ on the twin";
  }
  if (stableJson(a.memory) !== stableJson(b.memory)) return "memory differs on the twin";
  return null;
};

async function playGame(spec: DealSpec, fixture: Fixture, candidateSeat: PlayerId, options: DealOptions): Promise<GameOutcome> {
  const memory: Record<PlayerId, LocalMemory> = { p1: localMemory(policyRng(spec.policySeed * 2 + 1)), p2: localMemory(policyRng(spec.policySeed * 2 + 2)) };
  const privacy = { checks: 0, nontrivial: 0, failures: 0, examples: [] as string[] };
  let candidateDecisions = 0;
  const afterStep = ({ match, seat, revision, role, memory: before, step, player }: StepContext) => {
    if (role !== "test" || options.privacyEvery <= 0 || candidateDecisions++ % options.privacyEvery) return;
    privacy.checks++;
    const fail = (what: string) => {
      privacy.failures++;
      if (privacy.examples.length < 3) privacy.examples.push(`r${revision} ${match.state.prompt.kind}: ${what}`);
    };
    try {
      const twin = permutedFor(match, seat, spec.engineSeed * 7 + revision);
      if (stableJson(twin.state) !== stableJson(match.state)) privacy.nontrivial++;
      if (stableJson(policyTurn(twin, seat, revision).input) !== stableJson(policyTurn(match, seat, revision).input)) return fail("the restricted observation differs on the twin");
      const difference = firstDifference(step, player(twin, seat, revision, before));
      if (difference) fail(difference);
    } catch (error) {
      fail(`the twin check threw: ${String(error).slice(0, 200)}`);
    }
  };
  const t0 = performance.now();
  let result: DuelResult | null = null;
  let error: string | null = null;
  try {
    result = await playSeatDuel({
      bundle: fixture.bundle, interpreterRevision: fixture.revision, gameSeed: spec.engineSeed, memory, testSeat: candidateSeat,
      test: playerFactory(spec.candidate)(), baseline: playerFactory(spec.baseline)(), maxMoves: options.maxMoves, afterStep,
    });
  } catch (thrown) {
    error = String(thrown instanceof Error ? (thrown.stack ?? thrown.message) : thrown).slice(0, 400);
  }
  const ms = performance.now() - t0;
  const winner = !result ? null : result.winner === "test" ? "candidate" : result.winner;
  const integrity: string[] = [];
  if (error) integrity.push(`error: ${error}`);
  if (result?.stopKind) integrity.push(`${result.stopKind}: ${result.stopped}`);
  if (result?.guards.test) integrity.push(`the cycle guard took over ${result.guards.test} candidate decision(s)`);
  if (privacy.failures) integrity.push(`hidden-twin privacy: ${privacy.failures} failure(s), e.g. ${privacy.examples.join("; ")}`);
  return {
    candidateSeat,
    winner,
    points: winner === "candidate" ? 1 : winner === "draw" ? 0.5 : 0,
    stopKind: error ? "error" : (result?.stopKind ?? null),
    stopped: error ?? result?.stopped ?? null,
    moves: result?.moves ?? 0,
    turn: result?.turn ?? 0,
    guards: { candidate: result?.guards.test ?? 0, baseline: result?.guards.baseline ?? 0 },
    privacy,
    integrity,
    trace: result?.trace ?? "00000000",
    ms,
  };
}

/** Both games of a deal: the candidate in p1, then in p2. */
export async function playDeal(spec: DealSpec, fixture: Fixture, options: DealOptions): Promise<PairOutcome> {
  if (fixture.name !== spec.fixture) throw new Error(`deal ${spec.deal} is on ${spec.fixture}, not ${fixture.name}`);
  const first = await playGame(spec, fixture, "p1", options);
  const second = await playGame(spec, fixture, "p2", options);
  return { ...spec, games: [first, second], points: first.points + second.points };
}
