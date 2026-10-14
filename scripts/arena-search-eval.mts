#!/usr/bin/env node
/** O5-03 paired search-versus-frozen-heuristic evaluation. No database/network.
 * npm run arena:search-eval -- --seeds 2 --seed-set holdout --allow-holdout --out FILE
 * Each deal is played in both seats. All unfinished/failed games remain in the
 * report; a negative experiment exits 0, a legality/privacy failure exits 1.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { loadAuditFixtures, loadFixtures } from "./verify/arena-policy-fixtures.mts";
import { playDuel, quantile, wilson, type DuelResult } from "./verify/arena-policy-duel.ts";
import { SEED_SETS, gameSeed, verifySeedSets } from "./verify/arena-policy-seeds.ts";
import { permutedFor } from "./verify/arena-policy-permute.ts";
import { policyTurn, applyDecision } from "../src/lib/arena/policy/boundary.ts";
import { localPolicy, COMBAT_POLICY_VERSION } from "../src/lib/arena/policy/combat.ts";
import { MAIN_POLICY_VERSION } from "../src/lib/arena/policy/main.ts";
import { CHOICE_POLICY_VERSION } from "../src/lib/arena/policy/choices.ts";
import { policyRng } from "../src/lib/arena/policy/rng.ts";
import { searchPolicy, searchDecision, SEARCH_LIMITS, SEARCH_VERSION, type SearchReport } from "../src/lib/arena/policy/search.ts";
import type { PlayerId } from "../src/lib/arena/types.ts";

// Declared before the first O5 holdout run. Browser and memory evidence are
// mandatory external gates; Node latency alone cannot enable a difficulty.
export const STRENGTH_GATE = {
  curatedPairs: 40, decisivePairs: 20, pairWinCiLowGreaterThan: 0.5,
  completionRate: 1, illegal: 0, privacyFailures: 0,
  workerStepP95Ms: 30, workerStepMaxMs: 300, workerRetainedBytes: 16 * 1024 * 1024,
  policyP95Ms: 5, searchReservationBytes: 256 * 1024,
};
const args = process.argv.slice(2);
const valued = new Set(["--seeds", "--seed-set", "--fixtures", "--max-moves", "--out"]);
for (const a of args) if (a.startsWith("--") && !valued.has(a) && !["--allow-holdout", "--synthetic"].includes(a)) throw new Error(`unknown flag ${a}`);
const flag = (name: string, fallback: string) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const seeds = Number(flag("--seeds", "2"));
const maxMoves = Number(flag("--max-moves", "3000"));
const setName = flag("--seed-set", "dev") as keyof typeof SEED_SETS;
const set = SEED_SETS[setName];
if (!set || !Number.isInteger(seeds) || seeds < 1 || seeds > set.size || !Number.isInteger(maxMoves) || maxMoves < 1) throw new Error("invalid seed set, seed count or move cap");
if (set.reserved && !args.includes("--allow-holdout")) throw new Error("O5 holdouts require --allow-holdout; do not tune against the reported holdout seeds");
const fixtures = args.includes("--synthetic") ? await loadFixtures() : await loadAuditFixtures();
const wanted = flag("--fixtures", fixtures.map((f) => f.name).join(",")).split(",");
assert.ok(wanted.every((name) => fixtures.some((f) => f.name === name)), "unknown fixture");
const selected = fixtures.filter((f) => wanted.includes(f.name));
verifySeedSets(selected.map((f) => f.seed));
const baseline = localPolicy();
const records: { fixture: string; k: number; seat: PlayerId; result: DuelResult; policyMs: number[]; search: Record<string, number>; maxNodes: number; maxReservationBytes: number; nodeHeapAfterBytes: number }[] = [];
let privacyChecks = 0;
let nontrivialTwins = 0;
for (const fixture of selected) for (let k = 0; k < seeds; k++) for (const seat of ["p1", "p2"] as const) {
  const timings: number[] = [];
  const statuses: Record<string, number> = {};
  let maxNodes = 0;
  let maxReservationBytes = 0;
  const candidate = searchPolicy({}, (r: SearchReport) => {
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    maxNodes = Math.max(maxNodes, r.nodes);
    maxReservationBytes = Math.max(maxReservationBytes, r.reservedBytes);
  });
  const measured: typeof candidate = (input, rng) => {
    const start = performance.now();
    const answer = candidate(input, rng);
    timings.push(performance.now() - start);
    return answer;
  };
  const result = await playDuel({ bundle: fixture.bundle, interpreterRevision: fixture.revision,
    gameSeed: gameSeed(set, fixture.seed, k), policySeed: 7919 + k * 2 + (seat === "p2" ? 1 : 0),
    testSeat: seat, test: measured, baseline, maxMoves,
    observe: (match, actor, revision) => {
      if (actor !== seat || revision % 20) return;
      const twin = permutedFor(match, actor, revision + 663);
      if (JSON.stringify(match.state) !== JSON.stringify(twin.state)) nontrivialTwins++;
      const turn = policyTurn(match, actor, revision);
      const twinTurn = policyTurn(twin, actor, revision);
      assert.deepEqual(twinTurn.input, turn.input, "restricted observation invariant");
      const r = policyRng(revision + 663);
      const choice = searchDecision(turn.input, r);
      assert.deepEqual(searchDecision(twinTurn.input, r), choice, "sample/answer/node-count invariant");
      assert.ok(applyDecision(twin, twinTurn.key, choice.answer).ok, "answer plays on the twin");
      privacyChecks++;
    },
  });
  records.push({ fixture: fixture.name, k, seat, result, policyMs: timings, search: statuses, maxNodes, maxReservationBytes, nodeHeapAfterBytes: process.memoryUsage().heapUsed });
  console.log(`${fixture.name} ${setName}[${k}] ${seat}: ${result.winner ?? `UNFINISHED ${result.stopKind}: ${result.stopped}`} ${result.moves} moves; searched ${statuses.searched ?? 0}, node fallback ${statuses.nodes ?? 0}`);
}
const dist = (xs: number[]) => ({ n: xs.length, p50: quantile(xs, .5), p95: quantile(xs, .95), max: xs.length ? Math.max(...xs) : null });
const rows = selected.map((f) => {
  const rs = records.filter((r) => r.fixture === f.name);
  const pairs = { wonBoth: 0, split: 0, lostBoth: 0, incomplete: 0 };
  for (let k = 0; k < seeds; k++) {
    const outcomes = rs.filter((r) => r.k === k).map((r) => r.result.winner);
    if (outcomes.some((r) => r === null || r === "draw")) pairs.incomplete++;
    else if (outcomes.every((r) => r === "test")) pairs.wonBoth++;
    else if (outcomes.every((r) => r === "baseline")) pairs.lostBoth++;
    else pairs.split++;
  }
  const bySeat = Object.fromEntries((["p1", "p2"] as const).map((seat) => {
    const s = rs.filter((r) => r.seat === seat);
    const wins = s.filter((r) => r.result.winner === "test").length;
    const losses = s.filter((r) => r.result.winner === "baseline").length;
    const complete = s.filter((r) => r.result.over).length;
    const illegal = s.filter((r) => r.result.stopKind === "illegal").length;
    return [seat, { games: s.length, wins, losses, draws: s.filter((r) => r.result.winner === "draw").length, complete, completionRate: complete / s.length,
      completionCi95: wilson(complete, s.length), illegal, illegalRate: illegal / s.length, illegalCi95: wilson(illegal, s.length), winCi95: wilson(wins, wins + losses) }];
  }));
  return { fixture: f.name, games: rs.length, bySeat, pairs, decisivePairCi95: wilson(pairs.wonBoth, pairs.wonBoth + pairs.lostBoth),
    policyMs: dist(rs.flatMap((r) => r.policyMs)), stepMs: dist(rs.flatMap((r) => r.result.steps.filter((s) => s.role === "test").map((s) => s.ms))),
    maxReservationBytes: Math.max(...rs.map((r) => r.maxReservationBytes)), nodeHeapAfterBytes: dist(rs.map((r) => r.nodeHeapAfterBytes)) };
});
const paired = rows.reduce((s, r) => ({ wonBoth: s.wonBoth + r.pairs.wonBoth, lostBoth: s.lostBoth + r.pairs.lostBoth }), { wonBoth: 0, lostBoth: 0 });
const decisive = paired.wonBoth + paired.lostBoth;
const strengthEligible = !args.includes("--synthetic") && selected.length === 4 && records.length / 2 >= STRENGTH_GATE.curatedPairs
  && decisive >= STRENGTH_GATE.decisivePairs && wilson(paired.wonBoth, decisive)[0] > STRENGTH_GATE.pairWinCiLowGreaterThan
  && records.every((r) => r.result.over && r.result.stopKind !== "illegal");
const report = {
  experiment: "O5 attack sequences", candidateVersion: SEARCH_VERSION, limits: SEARCH_LIMITS,
  candidateSourceSha256: createHash("sha256").update(fs.readFileSync("src/lib/arena/policy/search.ts")).digest("hex"),
  frozenBaseline: { main: MAIN_POLICY_VERSION, combat: COMBAT_POLICY_VERSION, choices: CHOICE_POLICY_VERSION },
  seedSet: setName, seedsPerFixture: seeds, synthetic: args.includes("--synthetic"), gate: STRENGTH_GATE,
  privacyChecks, nontrivialTwins, rows, strengthEligible,
  difficultyEnabled: false, promotion: "Browser budget evidence and the full strength gate must both pass before any UI/save configuration is shipped.",
  memoryMethod: "Node heapUsed immediately after each game includes the engine, bundle and accumulated report; not peak search memory or browser retained heap. Search reservation is a structural estimate.",
  // Complete records preserve failed runs and their exact stop detail.
  records: records.map(({ result, policyMs, ...record }) => ({
    ...record,
    gameSeed: gameSeed(set, selected.find((f) => f.name === record.fixture)!.seed, record.k),
    policySeed: 7919 + record.k * 2 + (record.seat === "p2" ? 1 : 0),
    result: { ...result, stepMs: dist(result.stepMs), steps: Object.fromEntries([...new Set(result.steps.map((s) => `${s.role}/${s.window}`))].sort().map((key) =>
      [key, dist(result.steps.filter((s) => `${s.role}/${s.window}` === key).map((s) => s.ms))])) },
    policyMs: dist(policyMs),
  })),
};
const out = flag("--out", "");
if (out) {
  const { records: gameRecords, ...summary } = report;
  // Keep summary reviewable and one game outcome/trace/timing summary per line.
  // Every failed game remains present; raw individual timing samples are not
  // needed to review strength, legality or a per-window distribution.
  const head = JSON.stringify(summary, null, 2).slice(0, -2);
  fs.writeFileSync(out, `${head},\n  "records": [\n${gameRecords.map((r) => `    ${JSON.stringify(r)}`).join(",\n")}\n  ]\n}\n`);
}
console.log(JSON.stringify({ rows, privacyChecks, nontrivialTwins, strengthEligible, difficultyEnabled: false }, null, 2));
process.exit(records.some((r) => r.result.stopKind === "illegal") ? 1 : 0);
