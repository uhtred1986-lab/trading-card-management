#!/usr/bin/env node
/**
 * #651: the complete local policy in a real browser — per-decision latency in a module Web Worker, and
 * the proof that it plays the same games there as in Node.
 *
 *   npm run arena:policy-browser -- [--seeds N] [--throttle R] [--max-moves N] [--total-timeout S] [--audit] [--json]
 *
 * It starts headless Chrome through `scripts/lib/cdp.mts`, serves the repo's TypeScript as native ES
 * modules (`scripts/lib/module-server.mts`) and plays, per fixture of `scripts/verify/arena-policy-fixtures.mts`
 * (or, with `--audit`, the four matchups of the audited SD15/SD5 decks of #649) and `--seeds` dev seeds (default 2) from both seats, the local policy against `uniformPolicy` — the same
 * games `arena:policy-eval` plays (`arena-policy-browser-jobs.ts` is the same `playDuel` loop) — in
 *
 *   worker       a module Web Worker, unthrottled: what a player's phone-free desktop session would see
 *   main-Nx      the page's main thread under `Emulation.setCPUThrottlingRate` N (default 4): a SIMULATED
 *                slow phone, not a physical device; Chrome refuses that throttle on a worker session, so
 *                the throttled run is on the main thread (as `arena:worker-bench` does for the engine)
 *
 * and the same jobs once more in Node. The records must agree: winner, move count and trace hash are the
 * same in all three, or the browser plays a different game (exit 1). Latency is the wall time of one
 * `localStep` (observation, policy, move applied), local policy's decisions only. Needs Chrome, no
 * database, no network; not part of `npm test`.
 */
import { Browser, findChrome } from "./lib/cdp.mts";
import { serveRepoModules } from "./lib/module-server.mts";
import { loadAuditFixtures, loadFixtures } from "./verify/arena-policy-fixtures.mts";
import { gameSeed, SEED_SETS } from "./verify/arena-policy-seeds.ts";
import { quantile } from "./verify/arena-policy-duel.ts";
import { runJobs, type Job, type JobResult } from "./verify/arena-policy-browser-jobs.ts";

function usage(message: string): never {
  console.error(`arena:policy-browser: ${message}`);
  console.error("Usage: npm run arena:policy-browser -- [--seeds N] [--throttle R] [--max-moves N] [--total-timeout S] [--audit] [--json]");
  process.exit(2);
}
const argv = process.argv.slice(2);
const valued = new Set(["--seeds", "--throttle", "--max-moves", "--total-timeout"]);
const flags = new Set(["--json", "--audit"]);
for (const a of argv) if (a.startsWith("--") && !valued.has(a) && !flags.has(a)) usage(`unknown flag ${a}`);
const int = (name: string, fallback: number): number => {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) usage(`${name} must be a non-negative integer`);
  return n;
};
const SEEDS = int("--seeds", 2);
const THROTTLE = int("--throttle", 4);
const MAX_MOVES = int("--max-moves", 3000);
const TOTAL_MS = int("--total-timeout", 900) * 1000;
const JSON_OUT = argv.includes("--json");
if (SEEDS < 1) usage("--seeds must be at least 1");

try { findChrome(); } catch (error) { console.error(`arena:policy-browser: ${(error as Error).message}`); process.exit(2); }

const fixtures = argv.includes("--audit") ? await loadAuditFixtures() : await loadFixtures();
const jobs: Job[] = fixtures.flatMap((f) =>
  Array.from({ length: SEEDS * 2 }, (_, g): Job => ({ fixture: f.name, bundle: f.bundle, revision: f.revision, gameSeed: gameSeed(SEED_SETS.dev, f.seed, Math.floor(g / 2)), policySeed: 7919 + g, testSeat: g % 2 === 0 ? "p1" : "p2" })),
);

const PAGE = `<!doctype html><meta charset="utf-8"><title>arena policy browser</title>
<script type="module">
  globalThis.__jobs = null;
  globalThis.__worker = () => new Promise((resolve, reject) => {
    const w = new Worker("/scripts/verify/arena-policy-worker.ts", { type: "module" });
    w.onerror = (e) => { e.preventDefault && e.preventDefault(); reject(new Error(String((e && (e.message || e.filename)) || "worker failed to load"))); };
    w.onmessage = (e) => {
      if (e.data && e.data.ready) w.postMessage({ jobs: globalThis.__jobs, maxMoves: globalThis.__maxMoves });
      else { w.terminate(); e.data.ok ? resolve(e.data.results) : reject(new Error(e.data.error)); }
    };
  });
  globalThis.__thread = () => import("/scripts/verify/arena-policy-browser-jobs.ts").then((m) => m.runJobs(globalThis.__jobs, globalThis.__maxMoves));
</script>`;

const server = await serveRepoModules(process.cwd(), PAGE);
const browser = await Browser.launch();
const watchdog = setTimeout(async () => {
  console.error(`FAIL arena:policy-browser: overall timeout of ${TOTAL_MS / 1000} s exceeded; stopping Chrome`);
  await browser.close();
  server.close();
  process.exit(1);
}, TOTAL_MS);

async function inPage<T>(page: Awaited<ReturnType<Browser["page"]>>, expr: string): Promise<T> {
  const key = `__p${Math.random().toString(36).slice(2)}`;
  await page.eval(`globalThis.${key} = null; (async () => { try { globalThis.${key} = { ok: true, v: await (${expr}) }; } catch (e) { globalThis.${key} = { ok: false, e: String(e && e.message || e) }; } })(); 0`);
  for (;;) {
    const r = await page.eval<{ ok: boolean; v?: T; e?: string } | null>(`globalThis.${key}`);
    if (r) { if (!r.ok) throw new Error(r.e); return r.v as T; }
    await new Promise((res) => setTimeout(res, 200));
  }
}

const dist = (ms: number[]) => ({ n: ms.length, p50: quantile(ms, 0.5), p90: quantile(ms, 0.9), p95: quantile(ms, 0.95), p99: quantile(ms, 0.99), max: ms.length ? Math.max(...ms) : 0 });
const summary = (results: JobResult[]) => {
  const all = results.flatMap((r) => r.steps.map((s) => s.ms));
  const windows = [...new Set(results.flatMap((r) => r.steps.map((s) => s.window)))].sort();
  return { all: dist(all), byWindow: Object.fromEntries(windows.map((w) => [w, dist(results.flatMap((r) => r.steps.filter((s) => s.window === w).map((s) => s.ms)))])) };
};
const key = (r: JobResult) => `${r.fixture}/${r.gameSeed}/${r.testSeat}: ${r.over}/${r.winner}/${r.moves}/${r.turn}/${r.stopKind}/${r.trace}/${r.guards}`;

let failed = false;
const report: Record<string, unknown> = {};
try {
  const nodeResults = await runJobs(jobs, MAX_MOVES);
  const page = await browser.page({ name: "desk", width: 1440, height: 900, mobile: false });
  await page.goto(`${server.origin}/`, 60000);
  report.userAgent = await page.eval<string>("navigator.userAgent");
  // Posted as one JSON string: the bundles are plain data.
  await page.eval(`globalThis.__jobs = JSON.parse(${JSON.stringify(JSON.stringify(jobs))}); globalThis.__maxMoves = ${MAX_MOVES}; 0`);
  const workerResults = await inPage<JobResult[]>(page, "globalThis.__worker()");
  let threadResults: JobResult[] | null = null;
  if (THROTTLE > 1) {
    await page.cdp("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    threadResults = await inPage<JobResult[]>(page, "globalThis.__thread()");
    await page.cdp("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
  const want = nodeResults.map(key);
  const same = (got: JobResult[]) => got.length === want.length && got.every((r, i) => key(r) === want[i]);
  const agree = { worker: same(workerResults), thread: threadResults ? same(threadResults) : null };
  report.games = jobs.length;
  report.agreeWithNode = agree;
  report.node = summary(nodeResults);
  report.worker = summary(workerResults);
  if (threadResults) report[`mainThread${THROTTLE}x`] = summary(threadResults);
  report.unfinished = workerResults.filter((r) => !r.over).length;
  report.guardTrips = workerResults.reduce((n, r) => n + r.guards, 0);
  if (!agree.worker || agree.thread === false) {
    failed = true;
    const bad = workerResults.map((r, i) => (key(r) === want[i] ? null : `${key(r)} (browser) vs ${want[i]} (node)`)).filter(Boolean);
    report.differences = bad.slice(0, 5);
  }
  if (report.unfinished || report.guardTrips) failed = true;
  if (server.refused.length) { failed = true; report.refused = server.refused; }
} catch (error) {
  failed = true;
  report.error = (error as Error).message;
} finally {
  clearTimeout(watchdog);
  await browser.close();
  server.close();
}

if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
else {
  const line = (name: string, d: ReturnType<typeof dist>) => `  ${name.padEnd(14)} n=${String(d.n).padEnd(6)} p50 ${d.p50.toFixed(2)}  p90 ${d.p90.toFixed(2)}  p95 ${d.p95.toFixed(2)}  p99 ${d.p99.toFixed(2)}  max ${d.max.toFixed(1)}`;
  console.log(`${report.userAgent ?? "(no browser)"}\n${jobs.length} games (${SEEDS} seeds x 2 seats x ${fixtures.length} fixtures), local policy vs uniform; browser == Node: ${JSON.stringify(report.agreeWithNode)}`);
  for (const name of ["node", "worker", `mainThread${THROTTLE}x`]) {
    const s = report[name] as ReturnType<typeof summary> | undefined;
    if (!s) continue;
    console.log(`${name} (ms per local step):`);
    console.log(line("all", s.all));
    for (const [w, d] of Object.entries(s.byWindow)) console.log(line(w, d));
  }
  if (report.error) console.log(`ERROR ${report.error}`);
  if (report.differences) console.log(`DIFFERENCES\n  ${(report.differences as string[]).join("\n  ")}`);
  console.log(failed ? "FAIL" : "ok");
}
process.exit(failed ? 1 : 0);
