/**
 * #643: the measured work of `scripts/arena-worker-bench.mts`, as a portable module. It runs in the
 * module worker (`arena-bench-worker.ts`) and, for the CPU-throttled configurations, on the page's
 * own throttled main thread (CDP CPU throttling does not reach a dedicated worker, see the doc).
 * It loads the same portable graph as the scenario worker (`browser.ts` -> rules engine, replay
 * core, snapshot core) and times each engine call with `performance.now()` around the call itself,
 * so the numbers are the engine's, not the message channel's. Jobs, chosen by `type`:
 *
 *  - `bulk`: play the pinned 121-step fixture game `runs` times with per-call timings, sweep `sweep`
 *    further seeds for the largest legal-move list, then re-measure that worst-case state many times.
 *  - `scenarios`: run the deterministic #642 scenarios `runs` times and time each whole run.
 *  - `game-init` / `step`: hold one game and answer one decision per message with the projected
 *    snapshot, so the page can time the whole round trip (clone included) and watch its own main thread.
 */
import type { Action, LegalAction } from "../../src/lib/arena/types";
import { applyMove, createPinnedMatch, legalMoves, projectSnapshot, type PinnedMatch } from "../../src/lib/arena/browser";
import type { ReplayBundleRecord } from "../../src/lib/arena/replay-core";
import { runScenario } from "./arena-scenarios";
import { pick } from "./arena-browser-scenario";

export type Request =
  | { type: "bulk"; bundle: ReplayBundleRecord; seed: number; revision: string; runs: number; sweep: number; maxSteps: number; worstRepeats: number }
  | { type: "scenarios"; bundle: ReplayBundleRecord; revision: string; ids: string[]; runs: number }
  | { type: "game-init"; bundle: ReplayBundleRecord; seed: number; revision: string }
  | { type: "step"; n: number };

const now = () => performance.now();
const timed = <T>(fn: () => T): [T, number] => {
  const t = now();
  const value = fn();
  return [value, now() - t];
};

function bytes(value: unknown): number {
  return JSON.stringify(value).length;
}

interface StepInfo {
  n: number;
  /** The legal list the move was chosen from. */
  moves: LegalAction[];
  before: PinnedMatch;
  action: Action;
  applyMs: number;
  legalMs: number;
  projectMs: number;
  snapshot: unknown;
  events: unknown;
  after: LegalAction[];
}

/** Play the fixture policy from `seed`, timing each decision's three engine calls; returns steps played and whether it ended. */
async function playGame(req: Extract<Request, { type: "bulk" }>, seed: number, onStep: (s: StepInfo) => void): Promise<{ steps: number; over: boolean; createMs: number }> {
  const t = now();
  const created = await createPinnedMatch({ bundle: req.bundle, seed, interpreterRevision: req.revision });
  const createMs = now() - t;
  let match = created.match;
  let moves: LegalAction[] = legalMoves(match);
  let n = 0;
  for (; n < req.maxSteps; n++) {
    if (match.state.phase === "over" || !moves.length) break;
    const action = pick(n + 1, moves);
    if (!action) break;
    const before = match;
    const [next, applyMs] = timed(() => applyMove(before, action));
    match = next.match;
    const [after, legalMs] = timed(() => (match.state.phase === "over" ? [] : legalMoves(match)));
    const [snapshot, projectMs] = timed(() => projectSnapshot(match, "p1"));
    onStep({ n: n + 1, moves, before, action, applyMs, legalMs, projectMs, snapshot, events: next.events, after });
    moves = after;
  }
  return { steps: n, over: match.state.phase === "over", createMs };
}

async function bulk(req: Extract<Request, { type: "bulk" }>) {
  const create: number[] = [];
  const legal: number[] = [];
  const apply: number[] = [];
  const project: number[] = [];
  const decision: number[] = [];
  const decisionLate: number[] = [];
  const firstGame: number[] = [];
  const snapshotBytes: number[] = [];
  const eventsBytes: number[] = [];
  const legalBytes: number[] = [];
  const legalCounts: number[] = [];
  let steps = 0;
  let over = false;
  let worst: { match: PinnedMatch; action: Action; count: number; n: number; seed: number } | null = null;

  for (let run = 0; run < req.runs; run++) {
    const r = await playGame(req, req.seed, (s) => {
      if (!worst || s.moves.length > worst.count) worst = { match: s.before, action: s.action, count: s.moves.length, n: s.n, seed: req.seed };
      const total = s.applyMs + s.legalMs + s.projectMs;
      apply.push(s.applyMs);
      legal.push(s.legalMs);
      project.push(s.projectMs);
      decision.push(total);
      if (s.n >= 90) decisionLate.push(total);
      if (run === 0) firstGame.push(total);
      if (run < 3) {
        snapshotBytes.push(bytes(s.snapshot));
        eventsBytes.push(bytes(s.events));
        legalBytes.push(bytes(s.after));
        legalCounts.push(s.after.length);
      }
    });
    create.push(r.createMs);
    steps = Math.max(steps, r.steps);
    over = r.over;
  }

  // Seed sweep: other deals of the same decks, looking for the largest legal list and the slowest single decision.
  let sweepSlowest = 0;
  let sweepMaxLegal = 0;
  for (let k = 1; k <= req.sweep; k++) {
    await playGame(req, req.seed + k, (s) => {
      sweepSlowest = Math.max(sweepSlowest, s.applyMs + s.legalMs + s.projectMs);
      sweepMaxLegal = Math.max(sweepMaxLegal, s.moves.length);
      if (!worst || s.moves.length > worst.count) worst = { match: s.before, action: s.action, count: s.moves.length, n: s.n, seed: req.seed + k };
    });
  }

  // Worst case: re-measure the state with the largest legal-move list, and the move taken from it.
  const worstLegal: number[] = [];
  const worstApply: number[] = [];
  const worstProject: number[] = [];
  const w = worst as { match: PinnedMatch; action: Action; count: number; n: number; seed: number } | null;
  if (w) {
    for (let i = 0; i < req.worstRepeats; i++) {
      worstLegal.push(timed(() => legalMoves(w.match))[1]);
      worstApply.push(timed(() => applyMove(w.match, w.action))[1]);
      worstProject.push(timed(() => projectSnapshot(w.match, "p1"))[1]);
    }
  }
  return {
    create, legal, apply, project, decision, decisionLate, firstGame, snapshotBytes, eventsBytes, legalBytes, legalCounts,
    steps, over, sweepSlowest, sweepMaxLegal,
    worst: w ? { legalCount: w.count, atStep: w.n, seed: w.seed, legal: worstLegal, apply: worstApply, project: worstProject } : null,
  };
}

async function scenarios(req: Extract<Request, { type: "scenarios" }>) {
  const out: Record<string, { ms: number[]; pass: boolean; moves: number }> = {};
  for (const id of req.ids) out[id] = { ms: [], pass: true, moves: 0 };
  for (let run = 0; run < req.runs; run++) {
    for (const id of req.ids) {
      const t = now();
      const evidence = await runScenario(id, { bundle: req.bundle, interpreterRevision: req.revision });
      out[id].ms.push(now() - t);
      out[id].pass = out[id].pass && evidence.pass;
      out[id].moves = evidence.moves;
    }
  }
  return out;
}

let game: { match: PinnedMatch; moves: LegalAction[] } | null = null;

export async function dispatch(req: Request): Promise<unknown> {
  if (req.type === "bulk") return bulk(req);
  if (req.type === "scenarios") return scenarios(req);
  if (req.type === "game-init") {
    const created = await createPinnedMatch({ bundle: req.bundle, seed: req.seed, interpreterRevision: req.revision });
    game = { match: created.match, moves: legalMoves(created.match) };
    return { ok: true, legal: game.moves.length };
  }
  if (!game) throw new Error("step before game-init");
  const { match, moves } = game;
  const action = match.state.phase === "over" ? null : pick(req.n, moves);
  if (!action) return { over: true, workerMs: 0 };
  const t = now();
  const next = applyMove(match, action);
  const after = next.match.state.phase === "over" ? [] : legalMoves(next.match);
  const snapshot = projectSnapshot(next.match, "p1");
  const workerMs = now() - t;
  game = { match: next.match, moves: after };
  return { over: next.match.state.phase === "over" || after.length === 0, workerMs, legal: after.length, snapshot };
}
