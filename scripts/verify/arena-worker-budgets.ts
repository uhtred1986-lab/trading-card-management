/**
 * #643: the Node-only half of the browser worker budget check — the budget evaluation logic, the
 * shape of the budget table and the budget document's agreement with it. The measurement itself
 * (`scripts/arena-worker-bench.mts`) needs Chrome and is not part of `npm test`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { BOARD_BUDGETS, BOARD_UNMEASURABLE, BUDGETS, distribution, evaluateBudgets, flatten, quantile, type Budget, type ConfigReport } from "../lib/worker-budgets";

// Nearest-rank quantiles, as `arena-perf-baseline.mts` reports them.
const ten = [5, 1, 9, 3, 7, 2, 8, 4, 10, 6];
const d = distribution(ten)!;
assert.deepEqual({ n: d.n, min: d.min, p50: d.p50, p95: d.p95, max: d.max, mean: d.mean }, { n: 10, min: 1, p50: 5, p95: 10, max: 10, mean: 5.5 }, "nearest-rank p50/p95 of 1..10");
assert.equal(quantile([1, 2, 3, 4], 0.5), 2);
assert.equal(distribution([]), null, "no samples is null, not zero");
assert.equal(distribution([NaN, Infinity]), null, "non-finite samples are dropped");
const flat: Record<string, number | null> = {};
flatten("x", d, flat);
flatten("y", null, flat);
assert.equal(flat["x.p95"], 10);
assert.equal(flat["y.p95"], null, "an unsupported metric flattens to null");

// Evaluation.
const budgets: Budget[] = [
  { metric: "a.p95", limit: 10, unit: "ms", why: "t" },
  { metric: "b", limit: 5, unit: "count", why: "t", atLeast: true },
  { metric: "c", limit: 7, unit: "bytes", why: "t", config: "phone" },
];
const cfg = (metrics: Record<string, number | null>, timedOut: string[] = []): ConfigReport => ({ metrics, timedOut });
assert.deepEqual(evaluateBudgets({ desk: cfg({ "a.p95": 10, b: 5 }) }, budgets), [], "equal to the limit passes (and a config-scoped budget skips other configs)");
const over = evaluateBudgets({ desk: cfg({ "a.p95": 10.01, b: 5 }) }, budgets);
assert.equal(over.length, 1);
assert.equal(over[0].kind, "over");
assert.equal(over[0].config, "desk");
const under = evaluateBudgets({ desk: cfg({ "a.p95": 1, b: 4 }) }, budgets);
assert.deepEqual(under.map((v) => [v.metric, v.kind]), [["b", "under"]], "a floor fails below its limit");
const missing = evaluateBudgets({ desk: cfg({ "a.p95": null, b: 5 }) }, budgets);
assert.deepEqual(missing.map((v) => [v.metric, v.kind]), [["a.p95", "missing"]], "an unsupported metric a budget names is a violation, never a pass");
assert.deepEqual(evaluateBudgets({ desk: cfg({ b: 5 }) }, budgets).map((v) => v.kind), ["missing"], "an absent metric is missing too");
const scoped = evaluateBudgets({ phone: cfg({ "a.p95": 1, b: 5, c: 8 }) }, budgets);
assert.deepEqual(scoped.map((v) => [v.config, v.metric, v.kind]), [["phone", "c", "over"]], "a config-scoped budget applies to its config");
const timeout = evaluateBudgets({ desk: cfg({ "a.p95": 1, b: 5 }, ["bulk"]) }, budgets);
assert.deepEqual(timeout.map((v) => [v.metric, v.kind]), [["bulk", "timeout"]], "a timed-out phase is a violation by itself");
assert.equal(evaluateBudgets({ desk: cfg({ "a.p95": NaN, b: 5 }) }, budgets)[0].kind, "missing", "NaN is not a measurement");

// The shipped table.
assert.ok(BUDGETS.length >= 30, `the budget table is populated (${BUDGETS.length})`);
const seen = new Set<string>();
for (const b of BUDGETS) {
  const key = `${b.config ?? "*"}|${b.metric}`;
  assert.ok(!seen.has(key), `no duplicate budget ${key}`);
  seen.add(key);
  assert.ok(Number.isFinite(b.limit) && b.limit >= 0, `${key}: finite limit`);
  assert.ok(b.why.length > 5, `${key}: says where its number came from`);
}
for (const area of ["decisionMs", "worstApplyMoveMs", "roundTripMs", "longTaskMaxMs", "coldWorkerStartMs", "snapshotBytes", "workerHeapRetainedBytes", "userAgentMemoryBytes"]) {
  assert.ok(BUDGETS.some((b) => b.metric.startsWith(area)), `a budget covers ${area}`);
}
// A report sitting exactly on every limit passes; one nudged past any single limit fails exactly that budget.
const onFor = (config: string): Record<string, number | null> => {
  const on: Record<string, number | null> = {};
  for (const b of BUDGETS) if (b.config === undefined || b.config === config) on[b.metric] = b.limit;
  return on;
};
const on = onFor("desktop-1x");
const configs = { "desktop-1x": cfg(onFor("desktop-1x")), "phone-sim-4x": cfg(onFor("phone-sim-4x")) };
assert.deepEqual(evaluateBudgets(configs, BUDGETS), [], "a report exactly on every budget passes");
for (const b of BUDGETS) {
  if (b.config) continue; // scoped budgets share a metric name across configs; covered above
  const nudged = { ...on, [b.metric]: b.atLeast ? b.limit - 1 : b.limit + 1 };
  const v = evaluateBudgets({ "desktop-1x": cfg(nudged) }, BUDGETS);
  assert.deepEqual(v.map((x) => x.metric), [b.metric], `${b.metric}: only its own budget trips`);
}

// The document names every budget, so the table and the page cannot drift apart unnoticed.
const doc = fs.readFileSync("docs/arena-worker-budgets.md", "utf8");
for (const b of BUDGETS) assert.ok(doc.includes(`\`${b.metric}\``), `docs/arena-worker-budgets.md lists budget \`${b.metric}\``);

// #782: the board budgets (arena:offline-release, the real app on a desktop).
const boardSeen = new Set<string>();
for (const b of BOARD_BUDGETS) {
  assert.ok(!b.config, `${b.metric}: a board budget is not scoped to a configuration`);
  assert.ok(!boardSeen.has(b.metric), `no duplicate board budget ${b.metric}`);
  boardSeen.add(b.metric);
  assert.ok(Number.isFinite(b.limit) && b.limit > 0 && b.why.length > 5, `${b.metric}: a finite limit and where it came from`);
  const o1 = BUDGETS.find((x) => x.metric === b.metric && !x.config);
  assert.ok(o1, `${b.metric}: a board budget re-derives an O1 metric of the same name`);
  assert.equal(b.unit, o1!.unit, `${b.metric}: same unit as O1`);
  // The re-derivation only loosens a budget the board misses; the two long-task ceilings are the owner's, not derived.
  if (b.metric !== "longTaskMaxMs" && b.metric !== "longTaskAtMatchStartMaxMs") {
    assert.ok(b.limit >= o1!.limit, `${b.metric}: the board budget ${b.limit} is not tighter than the O1 ${o1!.limit}`);
  }
}
const ceiling = (m: string) => BOARD_BUDGETS.find((b) => b.metric === m)?.limit;
assert.equal(ceiling("longTaskMaxMs"), 150, "owner, 14 Oct 2026: no long task over 150 ms on the board, never relaxed");
assert.equal(ceiling("longTaskAtMatchStartMaxMs"), 150, "a long task at the match start is held to the same 150 ms");
assert.ok(!BOARD_BUDGETS.some((b) => b.metric === "userAgentMemoryBytes"), "userAgentMemoryBytes is not a board budget: it cannot be measured on the app");
assert.deepEqual(BOARD_UNMEASURABLE.map((u) => u.metric), ["userAgentMemoryBytes"], "the one metric recorded as not measurable");
assert.ok(BOARD_UNMEASURABLE.every((u) => u.why.includes("cross-origin-isolated")), "with its reason");
for (const m of ["roundTripMs.p95", "matchStartMs.p95", "frameIntervalMs.p95", "framesOver50Ms", "longTaskCount", "mainHeapBytes", "workerHeapRetainedBytes", "decisionMs.max"]) {
  assert.ok(boardSeen.has(m), `a board budget covers ${m}`);
}
const boardOn: Record<string, number | null> = Object.fromEntries(BOARD_BUDGETS.map((b) => [b.metric, b.limit]));
assert.deepEqual(evaluateBudgets({ board: cfg(boardOn) }, BOARD_BUDGETS), [], "a board run exactly on every board budget passes");
for (const b of BOARD_BUDGETS) {
  const over1 = evaluateBudgets({ board: cfg({ ...boardOn, [b.metric]: b.limit + 1 }) }, BOARD_BUDGETS);
  assert.deepEqual(over1.map((x) => x.metric), [b.metric], `${b.metric}: a board run over it fails exactly it`);
  const unmeasured = evaluateBudgets({ board: cfg({ ...boardOn, [b.metric]: null }) }, BOARD_BUDGETS);
  assert.deepEqual(unmeasured.map((x) => [x.metric, x.kind]), [[b.metric, "missing"]], `${b.metric}: unmeasured is a failure`);
}
// The page records each board budget with its limit, in its "Board budgets" section.
assert.ok(doc.includes("## Board budgets"), "docs/arena-worker-budgets.md has a Board budgets section");
const boardDoc = doc.slice(doc.indexOf("## Board budgets"));
const shown = (b: Budget) => (b.unit === "bytes" ? `${b.limit / 1_000_000} MB` : b.unit === "ms" ? `${b.limit} ms` : `${b.limit}`);
for (const b of BOARD_BUDGETS) {
  assert.ok(boardDoc.includes(`| \`${b.metric}\` | at most ${shown(b)} |`), `the Board budgets table lists \`${b.metric}\` at most ${shown(b)}`);
}

console.log(`arena-worker-budgets: ${BUDGETS.length} O1 budgets and ${BOARD_BUDGETS.length} board budgets; evaluation logic and document agree`);
