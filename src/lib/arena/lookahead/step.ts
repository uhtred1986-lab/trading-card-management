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
import { answerFor, PICK_ID, type Policy, type PolicyAnswer, type PolicyInput } from "../policy/contract";
import { localPolicy } from "../policy/combat";
import { guardedDecide, localMemory, mainRanking, type LocalMemory } from "../policy/main";
import { nextInt, policyRng, type PolicyRng } from "../policy/rng";
import type { PolicyObservation } from "../policy/observation";
import { determinize, type Knowledge } from "./determinize";
import { evaluate, EVAL_WEIGHTS, FITTED_VALUE, winProbability, type EvalWeights, type FittedValue } from "./evaluate";

/**
 * 6 (9 Nov 2026): card choices, modes, optional prices and payments are searched too (`choices`); a
 * card choice or mode is scored after the other seat's next turn (`choiceHorizon: "reply"`), since what
 * it keeps is often needed only then.
 * 5 (9 Nov 2026): the defensive search is on (a combo, block or counter the heuristic would spend in
 * the other seat's turn is played forward against declining).
 * 4 (9 Nov 2026): a line that wins in every world is always taken, and the margin is 3 points (the
 * SD15 mirror's noisy switches). 3 (8 Nov 2026): attacks the heuristic scores as losing are shortlisted too. 2: lines are scored by
 * the fitted win probability (`FITTED_VALUE`). 1: the hand-set value.
 */
export const LOOKAHEAD_VERSION = 6;

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
  /**
   * Also search the battle's defensive windows: when the heuristic would spend a card (combo, block,
   * counter) in the other seat's turn, play that and declining through the rest of the turn.
   */
  defense?: boolean;
  /** Also search the seat's own attacking combo decisions: the heuristic's choice, passing, the strongest combo card. */
  offense?: boolean;
  /**
   * Also search card choices, modes, optional prices and payments (`chooseCards`, `chooseMode`,
   * `payCost`): the heuristic's answer against up to five other offered answers, "none" included.
   */
  choices?: boolean;
  /**
   * The horizon for card choices and modes (`chooseCards`, `chooseMode`; not payments): "reply" plays
   * the other seat's next turn too, since what a card choice keeps is often only needed then.
   */
  choiceHorizon?: Horizon;
  /** Step budget for a searched choice (default `maxSteps`); a reply line is long. */
  choiceSteps?: number;
  /**
   * The horizon for Main-Phase decisions (default `horizon`): "reply" plays the other seat's next
   * turn too, so a [Blocker] swung away or a counter colour spent is punished where it matters.
   */
  mainHorizon?: Horizon;
  /** Step budget for a searched Main-Phase decision (default `maxSteps`). */
  mainSteps?: number;
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
  normal: { knowledge: "none", candidates: 3, worlds: 2, maxSteps: 200, lineSteps: 60, margin: 3, horizon: "turn", value: "fitted", defense: true, choices: true, choiceHorizon: "reply", choiceSteps: 1200 },
  hard: { knowledge: "deck", candidates: 3, worlds: 2, maxSteps: 200, lineSteps: 60, margin: 3, horizon: "turn", value: "fitted", defense: true, choices: true, choiceHorizon: "reply", choiceSteps: 1200 },
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
function rollout(match: PinnedMatch, seat: PlayerId, revision: number, limit: number, base: Policy, seed: number, horizon: Horizon, root: { turn: number; owner: PlayerId }): { match: PinnedMatch; steps: number } {
  const memory: Record<PlayerId, LocalMemory> = { p1: localMemory(policyRng(seed * 2 + 1)), p2: localMemory(policyRng(seed * 2 + 2)) };
  let at = match;
  let steps = 0;
  const turn = match.state.turn;
  // "reply": on through the other seat's turn, until the seat's own next turn begins.
  // "turn": while the turn the decision was taken in lasts — read off the position before the option
  // was played (an "end the turn" option has already handed it over). For a Main-Phase decision that
  // is the seat's own turn, exactly as v4 had it; for a defensive one, the other seat's.
  const going = (s: PinnedMatch["state"]) => (horizon === "reply" ? s.turn <= turn + 1 : s.turn === root.turn && s.turnPlayer === root.owner);
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

/** The battle's defensive windows the lookahead may search (with `defense`). */
const DEFENSE_WINDOWS = new Set(["combo", "blocker", "counter"]);

/**
 * A defensive decision worth playing forward: the heuristic would spend a card (a combo, a block, a
 * counter) during the other seat's turn. The alternative is declining (pass / no block / no counter);
 * both are played through the rest of that turn. A decline by the heuristic is not searched.
 */
function defenseShortlist(input: PolicyInput, heuristic: string): { ids: string[]; skip: string | null } {
  const o = input.observation;
  if (o.turnPlayer === o.seat) return { ids: [], skip: "own turn's battle" };
  const menu = input.decisions.decisions.filter((d) => d.kind === "menu");
  const chosen = menu.find((d) => d.id === heuristic);
  const declines = (d: (typeof menu)[number]) => d.type === "pass" || ((d.type === "block" || d.type === "counter") && d.action.card === null);
  if (!chosen || declines(chosen)) return { ids: [], skip: "the heuristic declines" };
  const decline = menu.find(declines);
  return decline ? { ids: [heuristic, decline.id], skip: null } : { ids: [], skip: "no decline open" };
}

/**
 * An attacking combo decision (the seat's own turn, its attacker in battle): the heuristic's choice, and
 * the main alternatives it did not take — passing, and the hand's strongest combo card.
 */
function offenseShortlist(input: PolicyInput, heuristic: string): { ids: string[]; skip: string | null } {
  const o = input.observation;
  if (o.turnPlayer !== o.seat) return { ids: [], skip: "the other seat's battle" };
  const menu = input.decisions.decisions.filter((d) => d.kind === "menu");
  const pass = menu.find((d) => d.type === "pass");
  const combos = menu.filter((d) => d.type === "combo");
  if (!combos.length) return { ids: [], skip: "no combo open" };
  const power = (d: (typeof menu)[number]) => {
    const card = o.you.hand?.find((c) => c.id === d.action.card);
    return card?.comboPower ?? 0;
  };
  const strongest = [...combos].sort((a, b) => power(b) - power(a) || (a.id < b.id ? -1 : 1))[0];
  const ids = [heuristic];
  for (const d of [pass, strongest]) if (d && !ids.includes(d.id)) ids.push(d.id);
  return ids.length < 2 ? { ids: [], skip: "nothing else to play forward" } : { ids, skip: null };
}

/** The windows `choices` searches. */
const CHOICE_WINDOWS = new Set(["chooseCards", "chooseMode", "payCost"]);
const CHOICE_ALTERNATIVES = 5;

/** An answer's identity: a menu decision by its id, a pick by its cards. */
export const answerKey = (a: PolicyAnswer) => (a.cards ? `${a.id}[${[...a.cards].sort().join(",")}]` : a.id);

/**
 * A card choice, mode, optional price or payment: the heuristic's answer, then up to
 * `CHOICE_ALTERNATIVES` other menu answers the engine offers (each card, "none", each mode, each
 * payment), in canonical order.
 */
function choiceShortlist(input: PolicyInput, heuristic: PolicyAnswer): { answers: PolicyAnswer[]; skip: string | null } {
  const answers = [heuristic];
  const seen = new Set([answerKey(heuristic)]);
  const menu = input.decisions.decisions.filter((d) => d.kind === "menu").sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const d of menu) {
    if (answers.length > CHOICE_ALTERNATIVES) break;
    const a = answerFor(input.decisions, d.id);
    if (!seen.has(answerKey(a))) { seen.add(answerKey(a)); answers.push(a); }
  }
  return answers.length < 2 ? { answers: [], skip: "one answer" } : { answers, skip: null };
}

function shortlist(input: PolicyInput, heuristic: string, opts: LookaheadOptions): { ids: string[]; skip: string | null } {
  if (opts.defense && DEFENSE_WINDOWS.has(input.decisions.window) && input.observation.turnPlayer !== input.observation.seat) return defenseShortlist(input, heuristic);
  if (opts.offense && input.decisions.window === "combo" && input.observation.turnPlayer === input.observation.seat) return offenseShortlist(input, heuristic);
  if (input.decisions.window !== "main") return { ids: [], skip: `window ${input.decisions.window}` };
  const ranking = mainRanking(input);
  if (ranking.length < 2) return { ids: [], skip: "one option" };
  if (ranking[0].score >= LETHAL) return { ids: [], skip: "the heuristic sees lethal" };
  const ids = [heuristic];
  for (const r of ranking) {
    if (ids.length >= opts.candidates) break;
    // An attack is shortlisted even when the heuristic scores it as losing: a combo, a skill or the
    // other side's empty hand can make it win, and only playing it forward can tell (AI-01).
    if (r.id !== heuristic && (r.score > UNSUPPORTED || r.type === "attack") && r.type !== "endMain") ids.push(r.id);
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
  const listed = opts.choices && CHOICE_WINDOWS.has(input.decisions.window)
    ? choiceShortlist(input, heuristic)
    : (() => { const s = shortlist(input, heuristic.id, opts); return { answers: s.ids.map((id) => (id === heuristic.id ? heuristic : answerFor(input.decisions, id))), skip: s.skip }; })();
  if (listed.skip) return { answer: null, rng: r, report: { ...report, reason: listed.skip } };
  const byKey = new Map(listed.answers.map((a) => [answerKey(a), a] as const));
  // Card choices and modes, and Main-Phase decisions, may look further than the rest (payments and the
  // battle's windows stay on `horizon`).
  const w = input.decisions.window;
  const choice = !!opts.choices && (w === "chooseCards" || w === "chooseMode");
  const horizon = choice ? opts.choiceHorizon ?? opts.horizon : w === "main" ? opts.mainHorizon ?? opts.horizon : opts.horizon;
  const budget = choice ? opts.choiceSteps ?? opts.maxSteps : w === "main" ? opts.mainSteps ?? opts.maxSteps : opts.maxSteps;
  const lineCap = horizon === "reply" ? Math.max(opts.lineSteps, 150) : opts.lineSteps;
  const ids = [...byKey.keys()];
  const heuristicKey = answerKey(heuristic);
  report.heuristic = heuristicKey;
  report.chosen = heuristicKey;
  report.candidates = ids;
  const weights = opts.weights ?? EVAL_WEIGHTS;
  const score = (o: PolicyObservation) => (opts.value === "fitted" ? 100 * winProbability(o, opts.fitted ?? FITTED_VALUE) : evaluate(o, weights));
  const totals = new Map<string, number>(ids.map((id) => [id, 0]));
  // Worlds in which the line ended with the seat having won the game.
  const wins = new Map<string, number>(ids.map((id) => [id, 0]));
  let steps = 0;
  let complete = 0;
  let stopped: string | null = null;
  for (const seed of seeds) {
    if (opts.stop?.()) { stopped = "host stop"; break; }
    try {
      const world = determinize(match, seat, opts.knowledge, seed).match;
      const root = policyTurn(world, seat, revision);
      const values: number[] = [];
      const won: boolean[] = [];
      for (const [k, id] of ids.entries()) {
        if (opts.stop?.()) throw new Budget("host stop");
        const a = byKey.get(id)!;
        const open = a.id === PICK_ID
          ? root.input.decisions.decisions.some((d) => d.kind === "pick" && (a.cards ?? []).every((c) => d.candidates.includes(c)))
          : root.input.decisions.decisions.some((d) => d.id === a.id);
        if (!open) throw new Error(`option ${id} is not open in the world`);
        const played = applyDecision(world, root.key, answerFor(root.input.decisions, a.id, a.cards));
        if (!played.ok) throw new Error(`option ${id} refused in the world: ${played.detail}`);
        const remaining = budget - steps - 1;
        if (remaining <= 0) throw new Budget("step budget");
        const line = rollout(played.match, seat, revision + 1, Math.min(lineCap, remaining), base, (seed + k * 7919) >>> 0, horizon, { turn: world.state.turn, owner: world.state.turnPlayer });
        steps += line.steps + 1;
        if (steps > budget) throw new Budget("step budget");
        const end = observe(line.match, seat, revision + 1 + line.steps);
        values.push(score(end));
        won.push(!!end.over && end.over.winner === seat);
      }
      ids.forEach((id, k) => { totals.set(id, totals.get(id)! + values[k]); if (won[k]) wins.set(id, wins.get(id)! + 1); });
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
  // A line that won the game in every world is taken whatever the margin (the heuristic's own first,
  // if it is one): a win probability is squeezed near certainty, so a sure win can sit within `margin`
  // of a merely likely one (AI-01: 100 against 97.9). Otherwise the best average, ties to the earlier
  // option (the heuristic's first), kept only if it beats the heuristic's by `margin`.
  const sure = ids.find((id) => wins.get(id) === complete);
  let top = ids[0];
  for (const id of ids) if (means[id] > means[top]) top = id;
  const best = sure ?? (top !== heuristicKey && means[top] - means[heuristicKey] >= opts.margin ? top : heuristicKey);
  report.status = "searched";
  report.reason = stopped ? `${complete} world(s) before ${stopped}` : `${complete} world(s)`;
  report.chosen = best;
  return { answer: best === heuristicKey ? heuristic : byKey.get(best)!, rng: r, report };
}

/**
 * A saved lookahead decision played again without searching: the recorded
 * answer, and the memory exactly as the lookahead left it (the heuristic is
 * asked for its own RNG, then `worlds` seeds are drawn, as `searchDecision`
 * always does). Pass it to `localStep`: the cycle guard, the refusals and the
 * move are the same code; a recorded id that is not open is refused there.
 */
export function replayPolicy(recordedId: string, opts: Pick<LookaheadOptions, "worlds" | "defense" | "offense" | "choices">, base: Policy = localPolicy(), recordedCards?: string[]): Policy {
  return (input, rng) => {
    const heuristic = base(input, rng);
    const after = worldSeeds(heuristic.rng, opts.worlds).rng;
    // Only a Main-Phase choice (and, with `defense`, a defensive battle choice, always a menu one) is
    // ever the search's; every other window is the heuristic's own answer (a card pick's cards
    // included, which a journal entry does not keep), asked again as before.
    const w = input.decisions.window;
    const searched = w === "main" || (!!opts.defense && DEFENSE_WINDOWS.has(w)) || (!!opts.offense && w === "combo") || (!!opts.choices && CHOICE_WINDOWS.has(w));
    // A searched pick is replayed with the cards the journal kept (the heuristic's own when it kept none).
    if (searched && recordedId === PICK_ID && !recordedCards) return { answer: heuristic.answer, rng: after };
    return { answer: searched ? answerFor(input.decisions, recordedId, recordedCards) : heuristic.answer, rng: after };
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
