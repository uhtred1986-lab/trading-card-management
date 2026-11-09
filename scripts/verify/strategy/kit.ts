/**
 * The strategy benchmark kit (`docs/arena-strategy-validation.md`, AI-01 … AI-12; owner's request of
 * 9 Nov 2026 to build the missing benchmarks).
 *
 * A benchmark case is a position, a candidate seat, an objective over a declared horizon, and a
 * declared opponent. Its answer key is **not** any policy's preference: `solve` plays every legal line
 * of the candidate seat through the real rules engine (the opponent answering by its declared
 * policy) and calls a first move *acceptable* when some continuation from it reaches the objective.
 * A candidate (the heuristic, Normal, Hard) passes when its first move is acceptable **and** its own
 * whole line reaches the objective.
 *
 * Cards are synthetic: a numeric/keyword card, or one whose skill text is read by the real compiler
 * (`rulesFromCompiler`, refused unless it compiles completely). No text is invented for a real card.
 */
import type { CardDef, PlayerId } from "../../../src/lib/arena/types";
import { rulesFromCompiler } from "../../../src/lib/arena/draft";
import { DBS_FILES } from "../../../src/lib/arena/rulesets/dbs";
import { makeReplayBundle, type ReplayBundleRecord } from "../../../src/lib/arena/replay-core";
import { applyMove, createPinnedMatch, legalMoves, type PinnedMatch } from "../../../src/lib/arena/browser";
import { applyDecision, policyTurn } from "../../../src/lib/arena/policy/boundary";
import { answerFor, PICK_ID, type Decision, type Policy, type PolicyAnswer } from "../../../src/lib/arena/policy/contract";
import { guardedDecide, localMemory, type LocalMemory } from "../../../src/lib/arena/policy/main";
import { policyRng } from "../../../src/lib/arena/policy/rng";
import { stage, type Layout } from "../arena-policy-main-fixture";

export const BENCH_REVISION = "a120000000000000000000000000000000000012";
export const BENCH_SEED = 1212;

export type Benchmark = "ai-01" | "ai-02" | "ai-03" | "ai-04" | "ai-05" | "ai-06" | "ai-07" | "ai-08" | "ai-09" | "ai-10" | "ai-11" | "ai-12";

/** A synthetic card. `skill` is read by the real compiler and must compile completely. */
export function synthetic(id: string, power: number, extra: Partial<CardDef> = {}): CardDef {
  return { id, name: id, type: "BATTLE", colors: ["Red"], energyCost: 1, zEnergyCost: null, power, comboCost: 0, comboPower: 5000, skill: null, characters: [id], traits: [], ...extra };
}

export const LEADER = synthetic("B-L10", 10000, { type: "LEADER", energyCost: null, comboCost: null, comboPower: null });
/** Filler for the decks (keyword-free 10,000 Battle Card). */
export const FILLER = synthetic("B-F", 10000);

/** One bundle for every card the cases use; both decks are filler around a synthetic Leader. */
export async function benchBundle(cards: CardDef[]): Promise<ReplayBundleRecord & { decks: Record<PlayerId, { name: string; leader: string; main: string[] }> }> {
  const all = [LEADER, FILLER, ...cards.filter((c) => c.id !== LEADER.id && c.id !== FILLER.id)];
  const ids = new Set<string>();
  for (const c of all) {
    if (ids.has(c.id)) throw new Error(`two synthetic cards are called ${c.id}`);
    ids.add(c.id);
  }
  const defs = Object.fromEntries(all.map((c) => [c.id, c]));
  const compiled = rulesFromCompiler(defs);
  const scripts = Object.fromEntries(all.map((c) => [c.id, compiled[c.id]]));
  const incomplete = all.filter((c) => !scripts[c.id]?.complete).map((c) => `${c.id}: ${c.skill}`);
  if (incomplete.length) throw new Error(`synthetic cards the compiler does not read completely:\n  ${incomplete.join("\n  ")}`);
  const base = await makeReplayBundle({ defs, scripts, art: Object.fromEntries(all.map((c) => [c.id, { front: `/art/${c.id}.png`, back: null }])), rulesetFiles: DBS_FILES, runtime: BENCH_REVISION });
  const main = Array.from({ length: 50 }, () => FILLER.id);
  return { ...base, decks: { p1: { name: "Bench p1", leader: LEADER.id, main }, p2: { name: "Bench p2", leader: LEADER.id, main } } } as never;
}

/** A game run to `seat`'s turn-3+ Main Phase with nothing played: the blank board positions are staged on. */
export async function opening(bundle: ReplayBundleRecord, seat: PlayerId): Promise<PinnedMatch> {
  let { match } = await createPinnedMatch({ bundle, seed: BENCH_SEED, interpreterRevision: BENCH_REVISION });
  for (let n = 0; n < 300; n++) {
    const s = match.state;
    if (s.turn >= 3 && s.prompt.kind === "main" && (s.prompt as { player?: PlayerId }).player === seat) return match;
    const legal = legalMoves(match).map((l) => l.action);
    const want = [
      (a: (typeof legal)[number]) => a.type === "chooseFirst" && a.first === seat,
      (a: (typeof legal)[number]) => a.type === "mulligan" && !a.redraw,
      (a: (typeof legal)[number]) => a.type === "charge" && a.card !== null,
      (a: (typeof legal)[number]) => a.type === "endMain" || a.type === "pass",
    ];
    const action = want.map((w) => legal.find(w)).find((a) => a) ?? legal[0];
    match = applyMove(match, action).match;
  }
  throw new Error(`the bench game did not reach ${seat}'s Main Phase`);
}

export interface Side extends Layout {
  /** Cards in the Drop, by card id. */
  drop?: string[];
  /** The Leader's card id (default the synthetic 10,000 Leader). */
  leader?: string;
  /** Identities of the Life cards, from the top (default filler). */
  lifeCards?: string[];
}

/** Stage both sides on `base` (whose prompt is the acting seat's Main Phase). */
export function position(base: PinnedMatch, sides: Partial<Record<PlayerId, Side>>): PinnedMatch {
  const match = stage(base, sides);
  const state = match.state;
  for (const [p, side] of Object.entries(sides) as [PlayerId, Side][]) {
    const zones = state.sides[p].zones as Record<string, string[]>;
    if (side.drop) {
      const drop = zones.drop ?? (zones.drop = []);
      while (drop.length) zones.deck.push(drop.pop()!);
      for (const cardId of side.drop) {
        const id = zones.deck.shift();
        if (!id) throw new Error(`position: ${p}'s deck ran out filling the Drop`);
        Object.assign(state.cards[id], { cardId, mode: null, faceUp: true, hidden: false, markers: 0, under: [] });
        drop.push(id);
      }
    }
    if (side.leader) state.cards[zones.leader[0]].cardId = side.leader;
    zones.life.forEach((id, i) => { state.cards[id].cardId = side.lifeCards?.[i] ?? FILLER.id; });
  }
  return match;
}

export type Horizon = { kind: "turn" } | { kind: "turns"; n: number } | { kind: "battles"; n: number };

export interface BenchCase {
  benchmark: Benchmark;
  key: string;
  /** success: an objective some line reaches; adverse: a boundary the obvious move fails; decline: the right answer spends nothing. */
  variant: "success" | "adverse" | "decline";
  /** One sentence: the situation and what a good player does. */
  note: string;
  seat: PlayerId;
  match: PinnedMatch;
  /** Judged where the horizon ends (and, if wanted, against the starting position). */
  objective: (end: PinnedMatch, start: PinnedMatch) => boolean;
  horizon: Horizon;
  /** The declared opponent: how the other seat answers in every line, the oracle's and the candidate's. */
  opponent: Policy;
  /** Oracle bounds (defaults: 4,000 nodes, 80 decisions deep). */
  limits?: { nodes?: number; depth?: number };
}

export interface Line { match: PinnedMatch; battles: number }

function ended(c: BenchCase, start: PinnedMatch, line: Line): boolean {
  const s = line.match.state;
  if (s.phase === "over") return true;
  if (c.horizon.kind === "turn") return s.turn !== start.state.turn;
  if (c.horizon.kind === "turns") return s.turn >= start.state.turn + c.horizon.n;
  return line.battles >= c.horizon.n && !s.battle;
}

const actorOf = (m: PinnedMatch) => (m.state.prompt as { player?: PlayerId }).player ?? null;
const battlesIn = (events: { type: string }[]) => events.filter((e) => e.type === "powerCompare").length;

/** The opponent's move, by its declared policy (cycle guard included). */
function opponentStep(c: BenchCase, line: Line, revision: number, memory: LocalMemory): { line: Line; memory: LocalMemory } {
  const seat = actorOf(line.match)!;
  const turn = policyTurn(line.match, seat, revision);
  const decided = guardedDecide(c.opponent, turn.input, memory);
  if (!decided.ok) throw new Error(`${c.key}: the declared opponent was interrupted: ${decided.interrupted}`);
  const played = applyDecision(line.match, turn.key, decided.answer);
  if (!played.ok) throw new Error(`${c.key}: the declared opponent's answer was refused: ${played.detail}`);
  return { line: { match: played.match, battles: line.battles + battlesIn(played.events) }, memory: decided.memory };
}

/** Every answer the seat could give here: each menu decision, and each allowed card set of a pick. */
export function answersOf(decisions: { decisions: Decision[] } & Parameters<typeof answerFor>[0]): PolicyAnswer[] {
  const out: PolicyAnswer[] = [];
  for (const d of decisions.decisions) {
    if (d.kind === "menu") { out.push(answerFor(decisions, d.id)); continue; }
    const most = d.remaining === null ? 1 : Math.min(d.remaining, d.candidates.length);
    const sizes = d.upTo ? Array.from({ length: most + 1 }, (_, k) => k) : [most];
    for (const size of sizes) for (const set of subsets(d.candidates, size)) out.push(answerFor(decisions, PICK_ID, set));
  }
  return out;
}

function subsets<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items;
  return [...subsets(rest, k - 1).map((s) => [head, ...s]), ...subsets(rest, k)];
}

const answerKey = (a: PolicyAnswer) => (a.cards ? `${a.id}[${[...a.cards].sort().join(",")}]` : a.id);

export interface Oracle {
  /** First answers (by `answerKey`) from which some line reaches the objective. */
  acceptable: Set<string>;
  /** Every first answer the seat had. */
  options: string[];
  nodes: number;
}

/**
 * The answer key: play every line of the candidate seat (the opponent by its declared policy) to the
 * horizon, and keep the first answers from which some line reaches the objective. Throws when the
 * search would exceed its bounds, so a case too big to solve is never silently judged.
 */
export function solve(c: BenchCase): Oracle {
  const maxNodes = c.limits?.nodes ?? 4000;
  const maxDepth = c.limits?.depth ?? 80;
  let nodes = 0;
  const start = c.match;
  const reach = (line: Line, depth: number, memory: LocalMemory): boolean => {
    if (++nodes > maxNodes) throw new Error(`${c.key}: the oracle needs more than ${maxNodes} nodes; make the position smaller`);
    if (ended(c, start, line)) return c.objective(line.match, start);
    if (depth > maxDepth) throw new Error(`${c.key}: a line is deeper than ${maxDepth} decisions`);
    const actor = actorOf(line.match);
    if (!actor) return c.objective(line.match, start);
    if (actor !== c.seat) {
      const next = opponentStep(c, line, depth, memory);
      return reach(next.line, depth + 1, next.memory);
    }
    const turn = policyTurn(line.match, c.seat, depth);
    for (const answer of answersOf(turn.input.decisions)) {
      const played = applyDecision(line.match, turn.key, answer);
      if (!played.ok) continue;
      if (reach({ match: played.match, battles: line.battles + battlesIn(played.events) }, depth + 1, memory)) return true;
    }
    return false;
  };
  if (actorOf(start) !== c.seat) throw new Error(`${c.key}: the candidate seat must be the one asked`);
  const rootTurn = policyTurn(start, c.seat, 0);
  const options: string[] = [];
  const acceptable = new Set<string>();
  for (const answer of answersOf(rootTurn.input.decisions)) {
    const played = applyDecision(start, rootTurn.key, answer);
    if (!played.ok) continue;
    options.push(answerKey(answer));
    if (reach({ match: played.match, battles: battlesIn(played.events) }, 1, localMemory(policyRng(1)))) acceptable.add(answerKey(answer));
  }
  return { acceptable, options, nodes };
}

/** A candidate: one decision for its seat (the same shape as `localStep`, and it must say what it answered). */
export type Candidate = (match: PinnedMatch, seat: PlayerId, revision: number, memory: LocalMemory) => { ok: true; match: PinnedMatch; events: { type: string }[]; memory: LocalMemory; answer?: PolicyAnswer; id: string } | { ok: false; reason: string; detail: string; memory: LocalMemory };

export interface Result {
  benchmark: Benchmark;
  key: string;
  variant: BenchCase["variant"];
  seat: PlayerId;
  candidate: string;
  outcome: "pass" | "fail" | "interrupted";
  firstAcceptable: boolean;
  objective: boolean;
  first: string | null;
  acceptable: string[];
  options: number;
}

/** Play `candidate` in the case's seat (the opponent by its declared policy) to the horizon. */
export function judge(c: BenchCase, oracle: Oracle, name: string, candidate: Candidate): Result {
  let line: Line = { match: c.match, battles: 0 };
  const memory: Record<PlayerId, LocalMemory> = { p1: localMemory(policyRng(41)), p2: localMemory(policyRng(42)) };
  let first: string | null = null;
  let stop: string | null = null;
  for (let n = 0; n < 400 && !ended(c, c.match, line); n++) {
    const actor = actorOf(line.match);
    if (!actor) break;
    if (actor !== c.seat) {
      const next = opponentStep(c, line, n, memory[actor]);
      line = next.line;
      memory[actor] = next.memory;
      continue;
    }
    const turn = n === 0 ? policyTurn(line.match, c.seat, n) : null;
    const step = candidate(line.match, c.seat, n, memory[c.seat]);
    if (!step.ok) { stop = `${step.reason}: ${step.detail}`; break; }
    if (first === null) {
      // The first answer, as the oracle names it: a pick by its cards, a menu decision by its id.
      first = step.answer ? answerKey(step.answer) : step.id;
      void turn;
    }
    memory[c.seat] = step.memory;
    line = { match: step.match, battles: line.battles + battlesIn(step.events) };
  }
  const objective = c.objective(line.match, c.match);
  const firstAcceptable = first !== null && oracle.acceptable.has(first);
  return {
    benchmark: c.benchmark, key: c.key, variant: c.variant, seat: c.seat, candidate: name,
    outcome: stop ? "interrupted" : firstAcceptable && objective ? "pass" : "fail",
    firstAcceptable, objective, first, acceptable: [...oracle.acceptable], options: oracle.options.length,
  };
}

/** Count the seat's cards in a zone, by card id (or all). */
export function count(m: PinnedMatch, seat: PlayerId, zone: string, cardId?: string): number {
  const ids = (m.state.sides[seat].zones as Record<string, string[]>)[zone] ?? [];
  return cardId ? ids.filter((id) => m.state.cards[id].cardId === cardId).length : ids.length;
}

export const lifeOf = (m: PinnedMatch, seat: PlayerId) => m.state.sides[seat].zones.life.length;
export const winner = (m: PinnedMatch) => (m.state.phase === "over" ? (m.state as { winner?: PlayerId | null }).winner ?? null : null);
export const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
