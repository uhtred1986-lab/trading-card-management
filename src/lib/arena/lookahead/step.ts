/**
 * The lookahead opponent: one local decision, like `policy/boundary.ts`'s
 * `localStep`, but the important Main-Phase choices are played forward in the
 * real rules engine before one is taken.
 *
 * For a Main-Phase decision with more than one sensible option it:
 *
 *   1. shortlists the heuristic's own choice, the next best options by the
 *      heuristic's own scores (`mainRanking`), and ending the turn;
 *   2. builds a few plausible worlds — every card the seat cannot see given a
 *      sampled identity (`determinize.ts`; with the other decklist on Hard,
 *      without it on Normal);
 *   3. in each world plays every shortlisted option and then the rest of the
 *      turn with the heuristic for both seats, through the real engine — so
 *      counters, blockers, triggered skills, combos and Life-to-hand all happen
 *      as the rules say, not as a model of them guesses;
 *   4. scores where each line ends (`evaluate.ts`, from the seat's own view)
 *      and takes the option with the best average, keeping the heuristic's
 *      choice unless another is better by `margin`.
 *
 * Every other decision (the battle's windows, card choices, payments, the
 * shortcuts) is the heuristic's, unchanged. The search is bounded by a
 * deterministic count of simulated engine decisions (`maxSteps`), so the same
 * position and policy seed always give the same answer in Node and in a
 * browser worker; a host may also pass `stop` (a deadline, a cancellation),
 * which returns the heuristic's own answer. A world the engine refuses, or a
 * budget spent mid-world, is dropped; with no complete world the heuristic's
 * answer is played. The answer is always a decision of the real, current menu.
 *
 * What it may know is what `determinize.ts` lets a world depend on; the
 * hidden-twin proof in `scripts/verify/arena-lookahead.mts` checks that two
 * matches the seat cannot tell apart get the same answer.
 *
 * Browser-safe: `browser.ts`, the policy layer and `policy/boundary.ts` only.
 */
import type { PlayerId } from "../types";
import type { PinnedMatch } from "../browser";
import { applyDecision, policyTurn, type LocalStep } from "../policy/boundary";
import { answerFor, type Policy, type PolicyAnswer, type PolicyInput } from "../policy/contract";
import { localPolicy } from "../policy/combat";
import { guardedDecide, localMemory, mainRanking, type LocalMemory } from "../policy/main";
import { nextInt, policyRng, type PolicyRng } from "../policy/rng";
import type { PolicyObservation } from "../policy/observation";
import { determinize, type Knowledge } from "./determinize";
import { evaluate, EVAL_WEIGHTS, FITTED_VALUE, winProbability, type EvalWeights, type FittedValue } from "./evaluate";

/** 2 (8 Nov 2026): lines are scored by the fitted win probability (`FITTED_VALUE`); 1 used the hand-set value. */
export const LOOKAHEAD_VERSION = 2;

export type Horizon = "turn" | "decision" | "reply";

export interface LookaheadOptions {
  knowledge: Knowledge;
  /** Main-Phase options played forward besides ending the turn (the heuristic's choice first). */
  candidates: number;
  /** Plausible worlds each option is played in. */
  worlds: number;
  /** Simulated engine decisions per searched decision, every world and option together. */
  maxSteps: number;
  /** Simulated decisions in one line before it is scored where it stands. */
  lineSteps: number;
  /** Take another option over the heuristic's only when its average is better by this much. */
  margin: number;
  /**
   * Where a line is scored: "reply" plays the rest of the seat's turn and the
   * other seat's whole reply turn (every option scored as the seat's next turn
   * begins, so a card left exposed or a weak defence is actually punished);
   * "turn" plays only the rest of the seat's turn (scored as the other seat's
   * turn begins); "decision" stops when the
   * seat is next at its own Main-Phase choice, or the turn has passed — the
   * option's own consequences (a battle, a skill), several times cheaper.
   */
  horizon: Horizon;
  weights?: EvalWeights;
  /**
   * How a line's end is scored: "fitted" is the win probability (in percent) learned from the
   * heuristic's own games (`FITTED_VALUE`, `scripts/arena-lookahead-fit.mts`); "handset" is the first
   * hand-weighted sum (`EVAL_WEIGHTS`), which gate 1 measured. `margin` is in the value's own units.
   */
  value?: "fitted" | "handset";
  fitted?: FittedValue;
  /** Host stop (deadline, cancellation, memory pressure): when it says stop, the heuristic answers. */
  stop?: () => boolean;
}

/** The two difficulties the owner asked for (8 Nov 2026): the same search, with and without your decklist. */
export const DIFFICULTIES = {
  normal: { knowledge: "none", candidates: 3, worlds: 2, maxSteps: 200, lineSteps: 60, margin: 1, horizon: "turn", value: "fitted" },
  hard: { knowledge: "deck", candidates: 3, worlds: 2, maxSteps: 200, lineSteps: 60, margin: 1, horizon: "turn", value: "fitted" },
} as const satisfies Record<string, LookaheadOptions>;

export type Difficulty = keyof typeof DIFFICULTIES;
export const DIFFICULTY_NAMES = Object.keys(DIFFICULTIES) as Difficulty[];

const LETHAL = 1000;
const UNSUPPORTED = -1;

export interface SearchReport {
  /** Whether the search ran, and if not, why. */
  status: "searched" | "skipped" | "fallback";
  reason: string;
  candidates: string[];
  /** Mean value per candidate over the complete worlds. */
  means: Record<string, number>;
  worlds: number;
  failedWorlds: number;
  steps: number;
  chosen: string;
  heuristic: string;
}

/** `localStep`'s result, the search report, and — when the policy (not the cycle guard) answered — the answer played. */
export type LookaheadStep = LocalStep & { search: SearchReport | null; answer?: PolicyAnswer };

function observe(match: PinnedMatch, seat: PlayerId, revision: number): PolicyObservation {
  return policyTurn(match, seat, revision).input.observation;
}

class Budget extends Error {}

/**
 * Play `match` on with `base` for both seats until the turn leaves `seat`, the
 * game ends or `limit` decisions are spent. Returns where it stopped and how
 * many decisions it took.
 */
function rollout(match: PinnedMatch, seat: PlayerId, revision: number, limit: number, base: Policy, seed: number, horizon: Horizon): { match: PinnedMatch; steps: number } {
  const memory: Record<PlayerId, LocalMemory> = { p1: localMemory(policyRng(seed * 2 + 1)), p2: localMemory(policyRng(seed * 2 + 2)) };
  let at = match;
  let steps = 0;
  const turn = match.state.turn;
  // "reply": on through the other seat's turn, until the seat's own next turn begins.
  const going = (s: PinnedMatch["state"]) => (horizon === "reply" ? s.turn <= turn + 1 : s.turn === turn && s.turnPlayer === seat);
  while (steps < limit && at.state.phase !== "over" && going(at.state)) {
    const actor = (at.state.prompt as { player?: PlayerId }).player;
    if (!actor) break;
    // "decision": the line ends when the seat is back at its own Main-Phase choice.
    if (horizon === "decision" && actor === seat && at.state.prompt.kind === "main") break;
    const step = guardedStep(at, actor, revision + steps, memory[actor], base);
    if (!step.ok) throw new Error(`line stopped: ${step.reason}`);
    memory[actor] = step.memory;
    at = step.match;
    steps++;
  }
  return { match: at, steps };
}

/** `localStep` without its imports of the session's concerns: input, guarded answer, move. */
function guardedStep(match: PinnedMatch, seat: PlayerId, revision: number, memory: LocalMemory, policy: Policy): LocalStep {
  const turn = policyTurn(match, seat, revision);
  if (turn.input.decisions.unsupported) return { ok: false, reason: "interrupted", detail: turn.input.decisions.unsupported, memory };
  if (turn.input.decisions.actor !== seat || !turn.input.decisions.decisions.length) return { ok: false, reason: "notAsked", detail: "not asked", memory };
  const decided = guardedDecide(policy, turn.input, memory);
  if (!decided.ok) return { ok: false, reason: "interrupted", detail: decided.interrupted, memory: decided.memory };
  const played = applyDecision(match, turn.key, decided.answer);
  if (!played.ok) return { ...played, memory: decided.memory };
  return { ...played, memory: decided.memory, guard: decided.guard };
}

function shortlist(input: PolicyInput, heuristic: string, opts: LookaheadOptions): { ids: string[]; skip: string | null } {
  if (input.decisions.window !== "main") return { ids: [], skip: `window ${input.decisions.window}` };
  const ranking = mainRanking(input);
  if (ranking.length < 2) return { ids: [], skip: "one option" };
  if (ranking[0].score >= LETHAL) return { ids: [], skip: "the heuristic sees lethal" };
  const ids = [heuristic];
  for (const r of ranking) {
    if (ids.length >= opts.candidates) break;
    if (r.id !== heuristic && r.score > UNSUPPORTED && r.type !== "endMain") ids.push(r.id);
  }
  const end = ranking.find((r) => r.type === "endMain");
  if (end && !ids.includes(end.id)) ids.push(end.id);
  return ids.length < 2 ? { ids: [], skip: "nothing else worth playing forward" } : { ids, skip: null };
}

/**
 * The world seeds of one decision. Drawn for every decision the lookahead is
 * asked, searched or not, so the policy RNG after a decision depends only on
 * how many decisions there were — which is what lets a saved match be replayed
 * without searching again (`replayPolicy`).
 */
function worldSeeds(rng: PolicyRng, worlds: number): { seeds: number[]; rng: PolicyRng } {
  let r = rng;
  const seeds: number[] = [];
  for (let w = 0; w < worlds; w++) {
    const n = nextInt(r, 0x7fffffff);
    r = n.rng;
    seeds.push(n.value);
  }
  return { seeds, rng: r };
}

/**
 * The search for one decision. Returns the answer to play (null: play the
 * heuristic's) and the policy RNG after it, which is advanced by `worlds`
 * draws whether or not the search ran.
 */
export function searchDecision(match: PinnedMatch, seat: PlayerId, revision: number, input: PolicyInput, heuristic: PolicyAnswer, rng: PolicyRng, opts: LookaheadOptions, base: Policy = localPolicy()): { answer: PolicyAnswer | null; rng: PolicyRng; report: SearchReport } {
  const report: SearchReport = { status: "skipped", reason: "", candidates: [], means: {}, worlds: 0, failedWorlds: 0, steps: 0, chosen: heuristic.id, heuristic: heuristic.id };
  const { seeds, rng: r } = worldSeeds(rng, opts.worlds);
  const { ids, skip } = shortlist(input, heuristic.id, opts);
  if (skip) return { answer: null, rng: r, report: { ...report, reason: skip } };
  report.candidates = ids;
  const weights = opts.weights ?? EVAL_WEIGHTS;
  const score = (o: PolicyObservation) => (opts.value === "fitted" ? 100 * winProbability(o, opts.fitted ?? FITTED_VALUE) : evaluate(o, weights));
  const totals = new Map<string, number>(ids.map((id) => [id, 0]));
  let steps = 0;
  let complete = 0;
  let stopped: string | null = null;
  for (const seed of seeds) {
    if (opts.stop?.()) { stopped = "host stop"; break; }
    try {
      const world = determinize(match, seat, opts.knowledge, seed).match;
      const root = policyTurn(world, seat, revision);
      const values: number[] = [];
      for (const [k, id] of ids.entries()) {
        if (opts.stop?.()) throw new Budget("host stop");
        if (!root.input.decisions.decisions.some((d) => d.id === id)) throw new Error(`option ${id} is not open in the world`);
        const played = applyDecision(world, root.key, answerFor(root.input.decisions, id));
        if (!played.ok) throw new Error(`option ${id} refused in the world: ${played.detail}`);
        const remaining = opts.maxSteps - steps - 1;
        if (remaining <= 0) throw new Budget("step budget");
        const line = rollout(played.match, seat, revision + 1, Math.min(opts.lineSteps, remaining), base, (seed + k * 7919) >>> 0, opts.horizon);
        steps += line.steps + 1;
        if (steps > opts.maxSteps) throw new Budget("step budget");
        values.push(score(observe(line.match, seat, revision + 1 + line.steps)));
      }
      ids.forEach((id, k) => totals.set(id, totals.get(id)! + values[k]));
      complete++;
    } catch (error) {
      if (error instanceof Budget) { stopped = error.message; break; }
      report.failedWorlds++;
    }
  }
  report.steps = steps;
  report.worlds = complete;
  if (!complete) return { answer: null, rng: r, report: { ...report, status: "fallback", reason: stopped ?? "no world could be played" } };
  const means: Record<string, number> = {};
  for (const id of ids) means[id] = totals.get(id)! / complete;
  report.means = means;
  // The best average (ties to the earlier option, the heuristic's first), kept only if it beats the heuristic's by `margin`.
  let top = ids[0];
  for (const id of ids) if (means[id] > means[top]) top = id;
  const best = top !== heuristic.id && means[top] - means[heuristic.id] >= opts.margin ? top : heuristic.id;
  report.status = "searched";
  report.reason = stopped ? `${complete} world(s) before ${stopped}` : `${complete} world(s)`;
  report.chosen = best;
  return { answer: best === heuristic.id ? heuristic : answerFor(input.decisions, best), rng: r, report };
}

/**
 * A saved lookahead decision played again without searching: the recorded
 * answer, and the memory exactly as the lookahead left it (the heuristic is
 * asked for its own RNG, then `worlds` seeds are drawn, as `searchDecision`
 * always does). Pass it to `localStep`: the cycle guard, the refusals and the
 * move are the same code; a recorded id that is not open is refused there.
 */
export function replayPolicy(recordedId: string, opts: Pick<LookaheadOptions, "worlds">, base: Policy = localPolicy()): Policy {
  return (input, rng) => {
    const heuristic = base(input, rng);
    const after = worldSeeds(heuristic.rng, opts.worlds).rng;
    // Only a Main-Phase choice is ever the search's; every other window is the heuristic's own answer
    // (a card pick's cards included, which a journal entry does not keep), asked again as before.
    return { answer: input.decisions.window === "main" ? answerFor(input.decisions, recordedId) : heuristic.answer, rng: after };
  };
}

/**
 * One local decision for `seat` with the lookahead: `localStep`'s contract
 * (same refusals, same cycle guard, same memory) plus the search report.
 */
export function lookaheadStep(match: PinnedMatch, seat: PlayerId, revision: number, memory: LocalMemory, opts: LookaheadOptions, base: Policy = localPolicy()): LookaheadStep {
  const turn = policyTurn(match, seat, revision);
  if (turn.input.decisions.actor === seat && turn.input.decisions.unsupported) return { ok: false, reason: "interrupted", detail: `unsupported decision: ${turn.input.decisions.unsupported}`, memory, search: null };
  if (turn.input.decisions.actor !== seat || !turn.input.decisions.decisions.length) return { ok: false, reason: "notAsked", detail: `${seat} has no decision to make`, memory, search: null };
  let report: SearchReport | null = null;
  const searching: Policy = (input, rng) => {
    const heuristic = base(input, rng);
    const found = searchDecision(match, seat, revision, input, heuristic.answer, heuristic.rng, opts, base);
    report = found.report;
    return { answer: found.answer ?? heuristic.answer, rng: found.rng };
  };
  const decided = guardedDecide(searching, turn.input, memory);
  if (!decided.ok) return { ok: false, reason: "interrupted", detail: decided.interrupted, memory: decided.memory, search: report };
  const played = applyDecision(match, turn.key, decided.answer);
  if (!played.ok) return { ...played, memory: decided.memory, search: report };
  return { ...played, memory: decided.memory, guard: decided.guard, search: report, ...(decided.guard ? {} : { answer: decided.answer }) };
}
