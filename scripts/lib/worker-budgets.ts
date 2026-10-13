/**
 * #643: the pure half of the browser worker budget check — distributions and budget evaluation, with
 * no browser, no Node builtin and no I/O, so `scripts/verify/arena-worker-budgets.ts` can test it in
 * `npm test` while the measurement itself (`scripts/arena-worker-bench.mts`) needs Chrome.
 *
 * A report is a set of named configurations ("desktop-1x", "phone-sim-4x"), each a flat map from a
 * metric key (`legalMovesMs.p95`) to a number, or `null` when the metric is unsupported in the
 * browser that ran (never `0`: an unsupported metric is not a good one). `timedOut` names a phase
 * that hit its hard timeout; that is a budget failure by itself, never a hang.
 */

export interface Dist {
  n: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

/** Nearest-rank quantile, as `scripts/arena-perf-baseline.mts` reports them. */
export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

export function distribution(values: number[]): Dist | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return { n: v.length, min: round(v[0]), p50: round(quantile(v, 0.5)), p95: round(quantile(v, 0.95)), max: round(v[v.length - 1]), mean: round(v.reduce((a, b) => a + b, 0) / v.length) };
}

/** Flatten `{ name: Dist }` into `name.p50`, `name.p95`, `name.max` ... keys. */
export function flatten(name: string, dist: Dist | null, into: Record<string, number | null>): void {
  for (const stat of ["n", "min", "p50", "p95", "max", "mean"] as const) into[`${name}.${stat}`] = dist ? dist[stat] : null;
}

export interface ConfigReport {
  /** Flat metric map; `null` marks an unsupported metric. */
  metrics: Record<string, number | null>;
  /** The phases that hit their hard timeout (empty when every phase finished). */
  timedOut: string[];
}

export interface Budget {
  /** Metric key, e.g. `roundTripMs.p95`. */
  metric: string;
  /** The configuration it applies to; omitted = every configuration. */
  config?: string;
  /** Exceeding this is a failure (inclusive: equal passes); with `atLeast`, falling below it is. */
  limit: number;
  /** The metric is a floor (a pass flag, a step count), not a ceiling. */
  atLeast?: boolean;
  unit: "ms" | "bytes" | "count";
  /** One line: where the number came from (the doc carries the full derivation). */
  why: string;
}

export interface Violation {
  config: string;
  metric: string;
  kind: "over" | "under" | "timeout" | "missing";
  limit?: number;
  actual?: number | null;
  note: string;
}

/**
 * Check a set of configurations against budgets. A metric that is absent or `null` where a budget
 * names it is `missing` (the check cannot vouch for it), not a pass; a timed-out phase is a
 * violation whatever the numbers say.
 */
export function evaluateBudgets(configs: Record<string, ConfigReport>, budgets: Budget[]): Violation[] {
  const out: Violation[] = [];
  for (const [config, report] of Object.entries(configs)) {
    for (const phase of report.timedOut) out.push({ config, metric: phase, kind: "timeout", note: `phase "${phase}" hit its hard timeout` });
    for (const b of budgets) {
      if (b.config !== undefined && b.config !== config) continue;
      const actual = report.metrics[b.metric];
      if (actual === undefined || actual === null || Number.isNaN(actual)) {
        out.push({ config, metric: b.metric, kind: "missing", limit: b.limit, actual: actual ?? null, note: "not measured" });
      } else if (b.atLeast ? actual < b.limit : actual > b.limit) {
        out.push({ config, metric: b.metric, limit: b.limit, actual, kind: b.atLeast ? "under" : "over", note: `${actual} ${b.unit} ${b.atLeast ? "<" : ">"} budget ${b.limit} ${b.unit}` });
      }
    }
  }
  return out;
}

/**
 * The release budgets (`docs/arena-worker-budgets.md` derives each from the recorded
 * distributions). Timings are milliseconds on a headless Chrome worker; the 4x configuration is a
 * SIMULATED phone (CDP CPU throttling on a desktop), not a physical device.
 */
export const BUDGETS: Budget[] = (() => {
  const out: Budget[] = [];
  const atMost = (metric: string, limit: number, unit: Budget["unit"], why: string, config?: string) => out.push({ metric, limit, unit, why, ...(config ? { config } : {}) });
  const atLeast = (metric: string, limit: number, unit: Budget["unit"], why: string) => out.push({ metric, limit, unit, why, atLeast: true });
  const W = "worker call p95, >= 2.5x the larger of two recordings";

  // Engine latency inside the worker (the same in both configurations: CDP throttling does not reach a worker).
  atMost("legalMovesMs.p95", 8, "ms", W);
  atMost("applyMoveMs.p95", 15, "ms", W);
  atMost("projectSnapshotMs.p95", 16, "ms", W);
  atMost("decisionMs.p95", 30, "ms", "apply + legal + project, 2.1x the larger recorded p95 (14.4 ms); well under the 100 ms response ceiling");
  atMost("decisionMs.max", 300, "ms", "worst of 2,400 decisions; a shared machine gave 33 ms and 127 ms in two recordings (GC/scheduler stalls), so ~2.4x; the 100 ms response ceiling is held at p95");
  atMost("decisionLateMs.p95", 40, "ms", "steps >= 90 of the 121-step game: a late-game state is no slower");
  atMost("createMatchMs.p95", 200, "ms", "bundle hash validation + createGame; recorded 44 to 88 ms");
  atMost("worstLegalMovesMs.p95", 12, "ms", "largest legal list found (12 moves), re-measured 200 times");
  atMost("worstApplyMoveMs.p95", 25, "ms", "the move taken from the worst state");
  atMost("worstProjectSnapshotMs.p95", 30, "ms", "the snapshot of the worst state");
  atMost("sweepSlowestDecisionMs", 300, "ms", "slowest single decision over a 24-seed sweep; recorded 23 to 94 ms");
  atMost("scenarioMs.p95", 500, "ms", "one #642 scenario end to end, ~3x the throttled-page p95");
  atMost("scenarioMs.max", 1500, "ms", "~4x the recorded max");

  // Start-up.
  atMost("coldWorkerStartMs.p50", 1500, "ms", "typical cold start of the unbundled 76-module graph, cache off; recorded medians 0.57 to 0.80 s (about 2x); a production bundle should beat it");
  atMost("coldWorkerStartMs.max", 6000, "ms", "worst of 5 cold starts (a 5-sample p95 is its max); recorded 0.67 to 3.17 s, one outlier in three recordings");
  atMost("moduleLoadMs.p50", 1500, "ms", "same, as the worker itself reports it; recorded medians 0.54 to 0.77 s");
  atMost("moduleLoadMs.max", 6000, "ms", "same; recorded 0.64 to 3.01 s");
  atMost("matchStartMs.p95", 450, "ms", "bundle sent to the worker + createGame, ~3x the throttled p95");

  // Main-thread responsiveness while the worker plays.
  atMost("roundTripMs.p95", 50, "ms", "one decision, message and clone included; ~3x the larger recorded p95 (17.6 ms, throttled page)");
  atMost("roundTripMs.max", 250, "ms", "~3x the throttled max");
  atMost("frameIntervalMs.p95", 34, "ms", "two 60 Hz frames");
  atMost("framesOver50Ms", 6, "count", "of ~1,300 sampled frames; recorded 2 on the throttled page");
  atMost("longTaskCount", 3, "count", "main-thread tasks >= 50 ms while the worker plays; recorded 0 to 1");
  atMost("longTaskMaxMs", 150, "ms", "3x the 50 ms long-task threshold; recorded 55 to 73 ms");
  atMost("longTaskAtMatchStartMaxMs", 250, "ms", "cloning the pinned bundle to the worker; recorded 73 ms");
  // The control: the same code on the main thread (this is what the worker saves).
  atMost("thread.decisionMs.p95", 20, "ms", "same code on the unthrottled main thread, ~3.5x p95", "desktop-1x");
  atMost("thread.decisionMs.max", 80, "ms", "same, ~4x max", "desktop-1x");
  atMost("thread.decisionMs.p95", 250, "ms", "same code on the 4x-throttled thread (a SIMULATED phone), ~3x p95", "phone-sim-4x");
  atMost("thread.decisionMs.max", 800, "ms", "same, ~3x max", "phone-sim-4x");

  // Payload.
  atMost("snapshotBytes.max", 80_000, "bytes", "one viewer's projected snapshot as JSON; recorded 45.8 KB");
  atMost("snapshotBytes.p50", 60_000, "bytes", "recorded 33.3 KB");
  atMost("bundleBytes", 300_000, "bytes", "the fixture bundle (8 cards, shipped DBS ruleset); recorded 195 KB. A real card pool is larger: re-measure");
  atMost("moduleBytes", 2_600_000, "bytes", "76 transpiled modules, uncompressed; recorded 2.0 MB");
  atMost("moduleGzipBytes", 800_000, "bytes", "the same, gzipped; recorded 606 KB");

  // Memory.
  atMost("workerHeapRetainedBytes", 16_000_000, "bytes", "worker V8 heap after a forced GC; recorded 5.6 MB");
  atMost("workerHeapAfterBulkBytes", 64_000_000, "bytes", "worker V8 heap before GC after 20 games; recorded 7 to 28 MB (garbage not yet collected)");
  atMost("userAgentMemoryBytes", 64_000_000, "bytes", "measureUserAgentSpecificMemory for the whole page and worker; recorded 22 MB");
  atMost("mainHeapBytes", 8_000_000, "bytes", "main-thread V8 heap; recorded 2.0 MB");

  // Floors: the run must have measured what it claims.
  atLeast("gameSteps", 120, "count", "the pinned game plays its full 120 moves (121 states)");
  atLeast("interactiveSteps", 120, "count", "the round-trip game plays its full 120 moves");
  atLeast("longTaskObserverWorks", 1, "count", "a 140 ms busy loop must be reported, or zero long tasks proves nothing");
  atLeast("worstLegalCount", 10, "count", "the worst-case state really is a large legal list (recorded 12)");
  atLeast("sweepMaxLegalCount", 10, "count", "the seed sweep finds large legal lists (recorded 12)");
  for (const id of ["setup", "battle", "pending-choice"]) atLeast(`scenario.${id}.pass`, 1, "count", "the #642 scenario still passes in the worker");
  return out;
})();
