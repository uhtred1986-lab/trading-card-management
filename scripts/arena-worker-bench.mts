#!/usr/bin/env node
/**
 * #643: measure the browser worker's latency, main-thread responsiveness, payload and memory, and
 * check them against the release budgets in `scripts/lib/worker-budgets.ts`.
 *
 *   npm run arena:worker-bench -- [--check] [--runs N] [--cold N] [--configs desktop-1x,phone-sim-4x]
 *                                 [--json report.json] [--phase-timeout S] [--total-timeout S]
 *                                 [--sweep N] [--budget-scale F]
 *
 * It starts headless Chrome through `scripts/lib/cdp.mts`, serves the repo's TypeScript as native ES
 * modules (`scripts/lib/module-server.mts`) and runs `scripts/verify/arena-bench-worker.ts` — the
 * portable rules entry of #641 — in a module Web Worker, on the pinned fixture bundle. Per
 * configuration it measures: cold worker start (fresh page, HTTP cache off), per-decision
 * legalMoves / applyMove / projectSnapshot latency over the 121-step fixture game, the worst-case
 * state (largest legal-move list), the #642 scenarios, the main-thread round trip of one decision
 * (structured clone included), main-thread long tasks and frame intervals while the worker plays,
 * payload bytes, and memory where the browser supports it (unsupported metrics are `null`, never 0).
 *
 * `phone-sim-4x` is a desktop Chrome with `Emulation.setCPUThrottlingRate` 4 and a 390x844 touch
 * viewport: a SIMULATED phone, not a physical device. Chrome refuses that throttle on a worker
 * session, so it slows the page's main thread only; the engine is therefore also run on that
 * throttled main thread (`thread.*` metrics) to see it under a slow CPU. No physical-device
 * measurement is made here.
 *
 * Every phase has a hard timeout and the whole run has a watchdog, so a regression is reported (and
 * `--check` exits 1) rather than hanging. Exit: 0 within budget (or no `--check`), 1 budget exceeded,
 * timed out or a metric the budget names was not measured, 2 usage error or no Chrome.
 *
 * Not part of `npm test` (it needs Chrome); the budget logic is (`scripts/verify/arena-worker-budgets.ts`).
 * Needs no database.
 */
import fs from "node:fs";
import os from "node:os";
import zlib from "node:zlib";
import { Browser, findChrome, type Page, type Viewport } from "./lib/cdp.mts";
import { serveRepoModules } from "./lib/module-server.mts";
import { fixtureBundle, FIXTURE_REVISION, FIXTURE_SEED } from "./verify/arena-browser-fixture.ts";
import { scenarioIds } from "./verify/arena-scenarios.ts";
import { BUDGETS, distribution, evaluateBudgets, flatten, type ConfigReport, type Dist } from "./lib/worker-budgets.ts";

function usage(message: string): never {
  console.error(`arena:worker-bench: ${message}`);
  console.error("Usage: npm run arena:worker-bench -- [--check] [--runs N] [--cold N] [--configs a,b] [--json file] [--phase-timeout S] [--total-timeout S] [--sweep N] [--budget-scale F]");
  process.exit(2);
}

const argv = process.argv.slice(2);
const valued = new Set(["--runs", "--cold", "--sweep", "--configs", "--json", "--phase-timeout", "--total-timeout", "--budget-scale"]);
for (const a of argv) if (a.startsWith("--") && !valued.has(a) && a !== "--check") usage(`unknown flag ${a}`);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) usage(`${name} needs a value`);
  return v;
};
const int = (name: string, fallback: number): number => {
  const text = flag(name);
  if (text === undefined) return fallback;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) usage(`${name} must be a positive integer`);
  return n;
};

const CHECK = argv.includes("--check");
const RUNS = int("--runs", 20); // fixture games per configuration (bulk)
const COLD = int("--cold", 5); // fresh pages (cold starts, and interactive games) per configuration
const SCALE = flag("--budget-scale") === undefined ? 1 : Number(flag("--budget-scale")); // < 1 tightens every ceiling: proves the gate trips
if (!Number.isFinite(SCALE) || SCALE <= 0) usage("--budget-scale must be a positive number");
const PHASE_MS = int("--phase-timeout", 120) * 1000;
const TOTAL_MS = int("--total-timeout", 900) * 1000;
const MAX_STEPS = 120;
const WORST_REPEATS = 200;
const SWEEP = int("--sweep", 24); // further seeds searched for the largest legal-move list
const THREAD_RUNS = Math.min(RUNS, 5); // main-thread control runs
const THREAD_SWEEP = Math.min(SWEEP, 8);
const GAMES = 3; // interactive games per fresh page

interface Config {
  name: string;
  viewport: Viewport;
  cpuRate: number;
  note: string;
}
const ALL_CONFIGS: Config[] = [
  { name: "desktop-1x", viewport: { name: "desk", width: 1440, height: 900, mobile: false }, cpuRate: 1, note: "this machine, unthrottled, 1440x900" },
  { name: "phone-sim-4x", viewport: { name: "phone", width: 390, height: 844, mobile: true }, cpuRate: 4, note: "SIMULATED phone: 390x844 touch viewport + CDP CPU throttling 4x on this machine; not a physical device" },
  { name: "phone-sim-6x", viewport: { name: "phone", width: 390, height: 844, mobile: true }, cpuRate: 6, note: "SIMULATED low-end phone: CDP CPU throttling 6x; not a physical device" },
];
const wanted = (flag("--configs") ?? "desktop-1x,phone-sim-4x").split(",");
for (const w of wanted) if (!ALL_CONFIGS.some((c) => c.name === w)) usage(`unknown config ${w} (known: ${ALL_CONFIGS.map((c) => c.name).join(", ")})`);
const CONFIGS = ALL_CONFIGS.filter((c) => wanted.includes(c.name));

try {
  findChrome();
} catch (error) {
  console.error(`arena:worker-bench: ${(error as Error).message}`);
  process.exit(2);
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>arena worker bench</title>
<script type="module">
  globalThis.__long = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) globalThis.__long.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true }); globalThis.__longSupported = true; } catch { globalThis.__longSupported = false; }
  globalThis.__frames = [];
  globalThis.__sampling = false;
  let prev;
  const tick = (t) => { if (globalThis.__sampling) { if (prev !== undefined) globalThis.__frames.push(t - prev); prev = t; } else prev = undefined; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  globalThis.__isolated = crossOriginIsolated;
  globalThis.__bundle = null;
  let worker = null;
  let waiting = null;
  globalThis.__start = () => new Promise((resolve, reject) => {
    const t = performance.now();
    worker = new Worker("/scripts/verify/arena-bench-worker.ts", { type: "module" });
    worker.onmessage = (e) => {
      if (e.data && e.data.ready) resolve({ startupMs: performance.now() - t, loadMs: e.data.loadMs, isolated: e.data.isolated });
      else if (waiting) { const w = waiting; waiting = null; w(e.data); }
    };
    worker.onerror = (e) => { e.preventDefault && e.preventDefault(); reject(new Error(String((e && (e.message || e.filename)) || "worker failed to load"))); };
  });
  globalThis.__call = (message) => new Promise((resolve) => { waiting = resolve; worker.postMessage(message); });
  globalThis.__interactive = async (maxSteps, games) => {
    await new Promise((r) => setTimeout(r, 300));
    const rtt = [];
    const inWorker = [];
    globalThis.__frames = [];
    globalThis.__sampling = true;
    const from = performance.now();
    let steps = 0;
    const starts = [];
    const startMs = [];
    for (let g = 0; g < games; g++) {
      const i0 = performance.now();
      const init = await globalThis.__call({ type: "game-init", bundle: globalThis.__bundle.json, seed: globalThis.__bundle.seed, revision: globalThis.__bundle.revision });
      starts.push([i0, performance.now()]);
      startMs.push(performance.now() - i0);
      if (!init.ok) throw new Error(init.error);
      let played = 0;
      for (let n = 1; n <= maxSteps; n++) {
        const t = performance.now();
        const reply = await globalThis.__call({ type: "step", n });
        const took = performance.now() - t;
        if (!reply.ok) throw new Error(reply.error);
        if (reply.result.workerMs === 0 && reply.result.over) break;
        rtt.push(took);
        inWorker.push(reply.result.workerMs);
        played++;
        if (reply.result.over) break;
      }
      steps = Math.max(steps, played);
      // The player reads the board between moves: let the frame loop breathe, as a real session would.
      await new Promise((r) => setTimeout(r, 200));
    }
    const to = performance.now();
    globalThis.__sampling = false;
    await new Promise((r) => setTimeout(r, 120));
    // A long task that overlaps a match start (the bundle is cloned to the worker once per match) is a start cost, not a play cost.
    const inWindow = globalThis.__long.filter(([s]) => s >= from && s <= to + 100);
    const overlapsStart = ([s, d]) => starts.some(([a, b]) => s < b + 5 && s + d > a - 5);
    const long = inWindow.filter((t) => !overlapsStart(t)).map(([, d]) => d);
    const longAtStart = inWindow.filter(overlapsStart).map(([, d]) => d);
    return { rtt, inWorker, steps, windowMs: to - from, frames: globalThis.__frames.slice(), long, longAtStart, startMs };
  };
  globalThis.__thread = (req) => import("/scripts/verify/arena-bench-core.ts").then((m) => m.dispatch(req));
  globalThis.__sanity = async () => {
    const before = globalThis.__long.length;
    // A task of its own (not the DevTools evaluate task that called us), so the observer counts it.
    await new Promise((r) => setTimeout(() => { const end = performance.now() + 140; while (performance.now() < end) { /* hold the main thread */ } r(); }, 20));
    await new Promise((r) => setTimeout(r, 400));
    return { supported: globalThis.__longSupported, seen: globalThis.__long.slice(before).map(([, d]) => d) };
  };
</script>`;

const bundle = await fixtureBundle();
const bundleJson = JSON.stringify(bundle);
const server = await serveRepoModules(process.cwd(), PAGE, { headers: { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" } });
const browser = await Browser.launch();
const t0 = Date.now();

const watchdog = setTimeout(async () => {
  console.error(`FAIL arena:worker-bench: overall timeout of ${TOTAL_MS / 1000} s exceeded; stopping Chrome`);
  await browser.close();
  server.close();
  process.exit(1);
}, TOTAL_MS);

/** Start `expr` (an async JS expression) in the page and poll for its answer; `null` on timeout. */
async function phase<T>(page: Page, expr: string, timeoutMs = PHASE_MS): Promise<{ ok: true; value: T } | { ok: false; timedOut: boolean; error: string }> {
  const key = `__p${Math.random().toString(36).slice(2)}`;
  await page.eval(`globalThis.${key} = null; (async () => { try { globalThis.${key} = { ok: true, v: await (${expr}) }; } catch (e) { globalThis.${key} = { ok: false, e: String(e && e.message || e) }; } })(); 0`);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await page.eval<{ ok: boolean; v?: T; e?: string } | null>(`globalThis.${key}`);
    if (r) return r.ok ? { ok: true, value: r.v as T } : { ok: false, timedOut: false, error: r.e ?? "failed" };
    await new Promise((res) => setTimeout(res, 100));
  }
  return { ok: false, timedOut: true, error: `no answer in ${timeoutMs / 1000} s` };
}

/** The worker's V8 heap through its own DevTools session (auto-attached below): before and after a forced GC. */
async function workerHeap(sessionId: string | null): Promise<{ used: number | null; usedAfterGc: number | null }> {
  if (!sessionId) return { used: null, usedAfterGc: null };
  try {
    const heap = await browser.send<{ usedSize: number }>("Runtime.getHeapUsage", {}, sessionId);
    await browser.send("HeapProfiler.collectGarbage", {}, sessionId);
    const after = await browser.send<{ usedSize: number }>("Runtime.getHeapUsage", {}, sessionId);
    return { used: heap.usedSize, usedAfterGc: after.usedSize };
  } catch {
    return { used: null, usedAfterGc: null };
  }
}

interface Bulk {
  create: number[]; legal: number[]; apply: number[]; project: number[]; decision: number[]; decisionLate: number[];
  firstGame: number[]; sweepSlowest: number; sweepMaxLegal: number;
  snapshotBytes: number[]; eventsBytes: number[]; legalBytes: number[]; legalCounts: number[];
  steps: number; over: boolean;
  worst: { legalCount: number; atStep: number; seed: number; legal: number[]; apply: number[]; project: number[] } | null;
}
interface Interactive { rtt: number[]; inWorker: number[]; steps: number; windowMs: number; frames: number[]; long: number[]; longAtStart: number[]; startMs: number[] }

interface ConfigResult {
  config: Config;
  report: ConfigReport;
  detail: Record<string, unknown>;
}

async function measure(config: Config, moduleBytes: { count: number; raw: number; gzip: number }): Promise<ConfigResult> {
  const metrics: Record<string, number | null> = {};
  const timedOut: string[] = [];
  const detail: Record<string, unknown> = { note: config.note, cpuRate: config.cpuRate, viewport: `${config.viewport.width}x${config.viewport.height}${config.viewport.mobile ? " touch" : ""}` };
  const put = (name: string, d: Dist | null) => flatten(name, d, metrics);
  const startup: number[] = [];
  const load: number[] = [];
  const rtt: number[] = [];
  const inWorker: number[] = [];
  const frames: number[] = [];
  const long: number[] = [];
  const longAtStart: number[] = [];
  const startMs: number[] = [];
  let interactiveSteps = 0;
  let userAgent = "";
  let isolated = false;
  const ingestBulk = (prefix: string, b: Bulk) => {
    const name = (key: string) => `${prefix}${key}`;
    put(name("createMatchMs"), distribution(b.create));
    put(name("legalMovesMs"), distribution(b.legal));
    put(name("applyMoveMs"), distribution(b.apply));
    put(name("projectSnapshotMs"), distribution(b.project));
    put(name("decisionMs"), distribution(b.decision));
    put(name("decisionLateMs"), distribution(b.decisionLate));
    put(name("firstGameDecisionMs"), distribution(b.firstGame));
    metrics[name("sweepSlowestDecisionMs")] = Math.round(b.sweepSlowest * 1000) / 1000;
    metrics[name("sweepMaxLegalCount")] = b.sweepMaxLegal;
    if (!prefix) {
      put("snapshotBytes", distribution(b.snapshotBytes));
      put("eventsBytes", distribution(b.eventsBytes));
      put("legalListBytes", distribution(b.legalBytes));
      put("legalCount", distribution(b.legalCounts));
      metrics["gameSteps"] = b.steps;
      detail.bulkGames = RUNS;
      detail.gameOver = b.over;
    }
    if (b.worst) {
      put(name("worstLegalMovesMs"), distribution(b.worst.legal));
      put(name("worstApplyMoveMs"), distribution(b.worst.apply));
      put(name("worstProjectSnapshotMs"), distribution(b.worst.project));
      metrics[name("worstLegalCount")] = b.worst.legalCount;
      if (!prefix) detail.worstCase = { atStep: b.worst.atStep, seed: b.worst.seed };
    }
  };
  // The worker gets its own DevTools session (auto-attach, paused at start): CPU throttling set on the
  // page does not reach a dedicated worker's thread, so it is set on the worker's session too.
  let workerSession: string | null = null;
  let workerThrottle = config.cpuRate > 1 ? "not attempted" : "n/a (1x)";
  let live = true; // listeners cannot be removed: a finished configuration's must go quiet
  browser.on((method, params) => {
    if (!live || method !== "Target.attachedToTarget" || params?.targetInfo?.type !== "worker" || !String(params.targetInfo.url).includes("arena-bench-worker")) return;
    const sid = String(params.sessionId);
    workerSession = sid;
    void (async () => {
      if (config.cpuRate > 1) {
        try {
          await browser.send("Emulation.setCPUThrottlingRate", { rate: config.cpuRate }, sid);
          workerThrottle = `applied ${config.cpuRate}x on the worker's session`;
        } catch (error) {
          workerThrottle = `REFUSED on the worker's session (${error instanceof Error ? error.message : String(error)})`;
        }
      }
      await browser.send("Runtime.runIfWaitingForDebugger", {}, sid).catch(() => {});
    })();
  });

  for (let rep = 0; rep < COLD; rep++) {
    const label = `${config.name} cold ${rep + 1}/${COLD}`;
    const page = await browser.page(config.viewport);
    workerSession = null;
    try {
      await page.cdp("Network.setCacheDisabled", { cacheDisabled: true });
      if (config.cpuRate > 1) await page.cdp("Emulation.setCPUThrottlingRate", { rate: config.cpuRate });
      await page.cdp("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
      await page.goto(`${server.origin}/`, PHASE_MS);
      userAgent = await page.eval<string>("navigator.userAgent");
      await page.eval(`globalThis.__bundle = { json: JSON.parse(${JSON.stringify(bundleJson)}), seed: ${FIXTURE_SEED}, revision: ${JSON.stringify(FIXTURE_REVISION)} }; 0`);
      const started = await phase<{ startupMs: number; loadMs: number; isolated: boolean }>(page, "globalThis.__start()");
      if (!started.ok) {
        timedOut.push(started.timedOut ? `worker-start (${label})` : `worker-start-failed (${label}): ${started.error}`);
        continue;
      }
      startup.push(started.value.startupMs);
      load.push(started.value.loadMs);
      isolated = started.value.isolated;

      if (rep === 0) {
        // Is the long-task observer alive? A 140 ms busy loop must show up, or the zero below means nothing.
        const sane = await phase<{ supported: boolean; seen: number[] }>(page, "globalThis.__sanity()");
        const observer = sane.ok && sane.value.supported && sane.value.seen.some((d) => d >= 100);
        detail.longTaskObserver = observer ? "supported (a 140 ms main-thread busy loop was reported)" : "UNSUPPORTED or not reporting; long-task metrics are null";
        if (!observer) metrics["longTaskObserverWorks"] = 0;
        else metrics["longTaskObserverWorks"] = 1;

        const base = await workerHeap(workerSession);
        const mainHeap = await page.cdp<{ usedSize: number }>("Runtime.getHeapUsage").catch(() => null);
        metrics["workerHeapBaselineBytes"] = base.used;
        metrics["mainHeapBytes"] = mainHeap?.usedSize ?? null;

        // The engine in the worker (CDP throttling does not reach it; see the doc) ...
        const bulkReq = `{ type: "bulk", bundle: globalThis.__bundle.json, seed: globalThis.__bundle.seed, revision: globalThis.__bundle.revision, runs: ${RUNS}, sweep: ${SWEEP}, maxSteps: ${MAX_STEPS}, worstRepeats: ${WORST_REPEATS} }`;
        const bulk = await phase<{ ok: boolean; result: Bulk; error?: string }>(page, `globalThis.__call(${bulkReq})`);
        if (!bulk.ok || !bulk.value.ok) timedOut.push(bulk.ok ? `bulk-failed: ${bulk.value.error}` : bulk.timedOut ? "bulk" : `bulk-failed: ${bulk.error}`);
        else ingestBulk("", bulk.value.result);
        // ... and the same code on the page's own main thread, which the throttling does reach.
        // (Fewer games: a throttled thread is an order of magnitude slower, and this is the control, not the headline.)
        const longBefore = await page.eval<number>("globalThis.__long.length");
        const threadReq = bulkReq.replace(`runs: ${RUNS}, sweep: ${SWEEP}`, `runs: ${THREAD_RUNS}, sweep: ${THREAD_SWEEP}`).replace(`worstRepeats: ${WORST_REPEATS}`, "worstRepeats: 100");
        const threadBulk = await phase<Bulk>(page, `globalThis.__thread(${threadReq})`);
        await new Promise((r) => setTimeout(r, 400));
        const threadLong = await page.eval<number[]>(`globalThis.__long.slice(${longBefore}).map((x) => x[1])`);
        metrics["thread.longTaskCount"] = metrics.longTaskObserverWorks === 1 ? threadLong.length : null;
        metrics["thread.longTaskMaxMs"] = metrics.longTaskObserverWorks === 1 ? Math.round(Math.max(0, ...threadLong) * 100) / 100 : null;
        if (!threadBulk.ok) timedOut.push(threadBulk.timedOut ? "thread-bulk" : `thread-bulk-failed: ${threadBulk.error}`);
        else ingestBulk("thread.", threadBulk.value);

        const ids = scenarioIds();
        const sc = await phase<{ ok: boolean; result: Record<string, { ms: number[]; pass: boolean; moves: number }>; error?: string }>(page, `globalThis.__call({ type: "scenarios", bundle: globalThis.__bundle.json, revision: globalThis.__bundle.revision, ids: ${JSON.stringify(ids)}, runs: ${RUNS} })`);
        if (!sc.ok || !sc.value.ok) timedOut.push(sc.ok ? `scenarios-failed: ${sc.value.error}` : sc.timedOut ? "scenarios" : `scenarios-failed: ${sc.error}`);
        else {
          let all: number[] = [];
          for (const id of ids) {
            const s = sc.value.result[id];
            put(`scenario.${id}Ms`, distribution(s.ms));
            metrics[`scenario.${id}.pass`] = s.pass ? 1 : 0;
            all = all.concat(s.ms);
          }
          put("scenarioMs", distribution(all));
        }

        const after = await workerHeap(workerSession);
        metrics["workerHeapAfterBulkBytes"] = after.used;
        metrics["workerHeapRetainedBytes"] = after.usedAfterGc;
        const ua = await phase<number | null>(page, `(async () => { if (!globalThis.crossOriginIsolated || typeof performance.measureUserAgentSpecificMemory !== "function") return null; const m = await performance.measureUserAgentSpecificMemory(); return m.bytes; })()`, 30000);
        metrics["userAgentMemoryBytes"] = ua.ok ? ua.value : null;
        detail.userAgentMemory = ua.ok && ua.value !== null ? "measureUserAgentSpecificMemory (cross-origin isolated)" : "UNSUPPORTED here (needs crossOriginIsolated and the API); metric is null";
      }

      const game = await phase<Interactive>(page, `globalThis.__interactive(${MAX_STEPS}, ${GAMES})`);
      if (!game.ok) timedOut.push(game.timedOut ? `interactive (${label})` : `interactive-failed (${label}): ${game.error}`);
      else {
        rtt.push(...game.value.rtt);
        inWorker.push(...game.value.inWorker);
        frames.push(...game.value.frames);
        long.push(...game.value.long);
        longAtStart.push(...game.value.longAtStart);
        startMs.push(...game.value.startMs);
        interactiveSteps = Math.max(interactiveSteps, game.value.steps);
      }
    } catch (error) {
      timedOut.push(`error (${label}): ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await page.close();
    }
  }

  live = false;
  put("coldWorkerStartMs", distribution(startup));
  put("moduleLoadMs", distribution(load));
  put("roundTripMs", distribution(rtt));
  put("roundTripWorkerMs", distribution(inWorker));
  put("frameIntervalMs", distribution(frames));
  const observerWorks = metrics["longTaskObserverWorks"] === 1;
  metrics["longTaskCount"] = observerWorks ? long.length : null;
  metrics["longTaskMaxMs"] = observerWorks ? Math.round(Math.max(0, ...long) * 100) / 100 : null;
  metrics["longTaskTotalMs"] = observerWorks ? Math.round(long.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  metrics["longTaskAtMatchStartMaxMs"] = observerWorks ? Math.round(Math.max(0, ...longAtStart) * 100) / 100 : null;
  put("matchStartMs", distribution(startMs));
  metrics["framesOver50Ms"] = frames.length ? frames.filter((f) => f > 50).length : null;
  metrics["interactiveSteps"] = interactiveSteps;
  metrics["bundleBytes"] = Buffer.byteLength(bundleJson);
  metrics["moduleCount"] = moduleBytes.count;
  metrics["moduleBytes"] = moduleBytes.raw;
  metrics["moduleGzipBytes"] = moduleBytes.gzip;
  detail.workerCpuThrottle = workerThrottle;
  detail.userAgent = userAgent;
  detail.crossOriginIsolated = isolated;
  detail.coldStarts = COLD;
  return { config, report: { metrics, timedOut }, detail };
}

async function moduleSizes(): Promise<{ count: number; raw: number; gzip: number }> {
  let raw = 0;
  let gzip = 0;
  const modules = [...new Set(server.served)]; // a copy: fetching below appends to `served`
  for (const m of modules) {
    const body = Buffer.from(await (await fetch(`${server.origin}${m}`)).arrayBuffer());
    raw += body.length;
    gzip += zlib.gzipSync(body).length;
  }
  return { count: modules.length, raw, gzip };
}

const results: ConfigResult[] = [];
let sizes = { count: 0, raw: 0, gzip: 0 };
try {
  // One throwaway load first: the server transpiles each module once, and that is its cost, not the browser's.
  console.error("arena:worker-bench: warming the module server");
  const warm = await browser.page(CONFIGS[0].viewport);
  await warm.goto(`${server.origin}/`);
  const warmed = await phase(warm, "globalThis.__start()");
  if (!warmed.ok) console.error(`arena:worker-bench: warm-up ${warmed.timedOut ? "timed out" : "failed"}: ${warmed.error}`);
  await warm.close();
  sizes = await moduleSizes();
  for (const config of CONFIGS) {
    console.error(`arena:worker-bench: measuring ${config.name} (${config.note})`);
    results.push(await measure(config, sizes));
  }
} finally {
  clearTimeout(watchdog);
  await browser.close();
  server.close();
}

const configs: Record<string, ConfigReport> = Object.fromEntries(results.map((r) => [r.config.name, r.report]));
const budgets = BUDGETS.map((b) => (b.atLeast || SCALE === 1 ? b : { ...b, limit: b.limit * SCALE }));
const violations = evaluateBudgets(configs, budgets);
const cpus = os.cpus();
const report = {
  benchmark: "arena-worker-bench",
  issue: 643,
  recordedAt: new Date().toISOString(),
  elapsedSeconds: Math.round((Date.now() - t0) / 1000),
  device: { kind: "this development machine (NOT a physical phone)", os: `${os.type()} ${os.release()}`, cpu: cpus[0]?.model ?? "unknown", logicalCores: cpus.length, memoryGb: Math.round(os.totalmem() / 2 ** 30), node: process.version },
  browser: { binary: findChrome(), userAgent: results[0]?.detail.userAgent ?? null },
  fixture: { bundleHash: bundle.hash, seed: FIXTURE_SEED, interpreterRevision: FIXTURE_REVISION, maxSteps: MAX_STEPS, policy: "pick() of arena-browser-scenario.ts", scenarios: scenarioIds() },
  samples: { bulkGamesPerConfig: RUNS, coldStartsPerConfig: COLD, worstCaseRepeats: WORST_REPEATS },
  configs: Object.fromEntries(results.map((r) => [r.config.name, { ...r.detail, timedOut: r.report.timedOut, metrics: r.report.metrics }])),
  budgets: { count: budgets.length, scale: SCALE, violations },
};

const jsonPath = flag("--json");
if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

const f = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? "n/a" : String(Math.round(v * 10 ** digits) / 10 ** digits));
console.log(`arena:worker-bench  ${report.recordedAt}  (${report.elapsedSeconds} s)`);
console.log(`  device   ${report.device.os}; ${report.device.cpu}; ${report.device.logicalCores} cores; ${report.device.memoryGb} GB  [${report.device.kind}]`);
console.log(`  browser  ${report.browser.userAgent}`);
console.log(`  fixture  bundle ${report.fixture.bundleHash} seed ${FIXTURE_SEED}, up to ${MAX_STEPS} steps; ${RUNS} games and ${COLD} cold starts per configuration`);
for (const r of results) {
  const m = r.report.metrics;
  console.log(`\n  [${r.config.name}] ${r.config.note}`);
  const row = (label: string, key: string, unit = "ms") => console.log(`    ${label.padEnd(26)} p50 ${f(m[`${key}.p50`]).padStart(9)}  p95 ${f(m[`${key}.p95`]).padStart(9)}  max ${f(m[`${key}.max`]).padStart(9)} ${unit}  (n=${f(m[`${key}.n`], 0)})`);
  console.log(`    worker CPU throttle        ${String(r.detail.workerCpuThrottle)}; long-task observer: ${String(r.detail.longTaskObserver)}`);
  console.log(`    seed sweep (${SWEEP} seeds)     largest legal list ${f(m.sweepMaxLegalCount, 0)}, slowest single decision ${f(m.sweepSlowestDecisionMs)} ms`);
  row("cold worker start", "coldWorkerStartMs");
  row("match start (main, rtt)", "matchStartMs");
  row("module load (in worker)", "moduleLoadMs");
  row("create match", "createMatchMs");
  row("legalMoves", "legalMovesMs");
  row("applyMove", "applyMoveMs");
  row("projectSnapshot", "projectSnapshotMs");
  row("decision (sum of three)", "decisionMs");
  row("decision, steps >= 90", "decisionLateMs");
  row(`worst state (${f(m.worstLegalCount, 0)} moves)`, "worstLegalMovesMs");
  row("worst: applyMove", "worstApplyMoveMs");
  row("worst: projectSnapshot", "worstProjectSnapshotMs");
  row("same code, main thread", "thread.decisionMs");
  row("  thread: legalMoves", "thread.legalMovesMs");
  row("  thread: worst state", "thread.worstLegalMovesMs");
  row("round trip (main)", "roundTripMs");
  row("frame interval (main)", "frameIntervalMs");
  row("scenarios (each run)", "scenarioMs");
  console.log(`    long tasks during play     ${f(m.longTaskCount, 0)} (max ${f(m.longTaskMaxMs)} ms, total ${f(m.longTaskTotalMs)} ms); frames > 50 ms: ${f(m.framesOver50Ms, 0)}; longest at match start ${f(m.longTaskAtMatchStartMaxMs)} ms`);
  console.log(`    payload                    snapshot p50 ${f(m["snapshotBytes.p50"], 0)} B / max ${f(m["snapshotBytes.max"], 0)} B; bundle ${f(m.bundleBytes, 0)} B; ${f(m.moduleCount, 0)} modules ${f(m.moduleBytes, 0)} B (gzip ${f(m.moduleGzipBytes, 0)} B)`);
  console.log(`    memory                     worker heap ${f(m.workerHeapBaselineBytes, 0)} -> ${f(m.workerHeapAfterBulkBytes, 0)} B (after GC ${f(m.workerHeapRetainedBytes, 0)} B); main heap ${f(m.mainHeapBytes, 0)} B; UA-specific memory ${f(m.userAgentMemoryBytes, 0)} B`);
  if (r.report.timedOut.length) console.log(`    TIMED OUT / FAILED: ${r.report.timedOut.join("; ")}`);
}
console.log(`\n  budgets: ${budgets.length} checked, ${violations.length} violation(s)`);
for (const v of violations) console.log(`    ${v.kind.toUpperCase()} [${v.config}] ${v.metric}: ${v.note}`);
if (jsonPath) console.log(`  full report: ${jsonPath}`);

if (CHECK && violations.length) {
  console.error(`FAIL arena:worker-bench --check: ${violations.length} budget violation(s)`);
  process.exit(1);
}
process.exit(0);
