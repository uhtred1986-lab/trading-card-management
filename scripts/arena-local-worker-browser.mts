#!/usr/bin/env node
/**
 * #652: the local match worker in a real browser — the protocol's two scripted runs played against
 * the real module Web Worker (`src/lib/arena/local/worker-entry.ts`) by the real page client
 * (`src/components/arena/session/local.ts`), and the latency of it against the #643 budgets.
 *
 *   npm run arena:local-worker-browser -- [--json] [--total-timeout S]
 *
 * It starts headless Chrome through `scripts/lib/cdp.mts`, serves the repo's TypeScript as native ES
 * modules (`scripts/lib/module-server.mts`), and in a page:
 *
 *   run a   a fresh Worker plays the scripted match (`arena-local-worker-driver.ts`, run "a"): every
 *           refusal (stale, duplicate, conflicting, foreign session/actor, malformed, other version,
 *           hidden or stale aliases) and every forged worker message the client must ignore. Every
 *           message the Worker sends must be byte-identical (per-message SHA-256 of canonical JSON) to
 *           what the host sends the same script in Node over the in-process channel — so
 *           `arena-local-worker.mts`'s leak and permutation audit of those messages holds for the
 *           browser's too.
 *   run b   a second page, HTTP cache disabled, cold Worker: the same match in batches of 1, each AI
 *           turn cancelled after its first batch (and one at once), disposed mid-advance and resumed
 *           from the journal on the same Worker. Its final board must equal run a's.
 *
 * Latency is measured on the page: Worker creation to `ready` (cold), `start` to its result, every
 * human move's round trip, AI time per decision (an advance's round trip over the decisions it
 * committed), main-thread long tasks while the match plays (the observer proved alive by a 140 ms
 * busy loop) and the snapshot sizes. The #643 ceilings (`scripts/lib/worker-budgets.ts`,
 * `desktop-1x`) gate what they name; a missing measurement fails. Needs Chrome, no database, no
 * network. Not part of `npm test`. Exit 0 within budget, 1 a check or budget failed, 2 usage/no Chrome.
 */
import { Browser, findChrome } from "./lib/cdp.mts";
import { serveRepoModules } from "./lib/module-server.mts";
import { BUDGETS } from "./lib/worker-budgets.ts";
import { stagedPack } from "./verify/arena-local-worker-fixture.mts";
import { inProcessChannel } from "./verify/arena-local-worker-channel.ts";
import { runScripted } from "./verify/arena-local-worker-driver.ts";
import { replayHash } from "../src/lib/arena/replay-core.ts";

function usage(message: string): never {
  console.error(`arena:local-worker-browser: ${message}`);
  console.error("Usage: npm run arena:local-worker-browser -- [--json] [--total-timeout S]");
  process.exit(2);
}
const argv = process.argv.slice(2);
for (const a of argv) if (a.startsWith("--") && a !== "--json" && a !== "--total-timeout") usage(`unknown flag ${a}`);
const timeoutAt = argv.indexOf("--total-timeout");
const TOTAL_MS = (timeoutAt >= 0 ? Number(argv[timeoutAt + 1]) : 600) * 1000;
if (!Number.isFinite(TOTAL_MS) || TOTAL_MS <= 0) usage("--total-timeout must be a positive number of seconds");
const JSON_OUT = argv.includes("--json");
try { findChrome(); } catch (error) { console.error(`arena:local-worker-browser: ${(error as Error).message}`); process.exit(2); }

const PAGE = `<!doctype html><meta charset="utf-8"><title>arena local worker</title>
<script type="module">
  import { runScripted } from "/scripts/verify/arena-local-worker-driver.ts";
  import { replayHash } from "/src/lib/arena/replay-core.ts";
  globalThis.__longtasks = [];
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) globalThis.__longtasks.push({ start: e.startTime, ms: e.duration }); }).observe({ type: "longtask" });
  } catch { globalThis.__longtasks = null; }
  globalThis.__run = async (kind) => {
    const t0 = performance.now();
    const worker = new Worker("/src/lib/arena/local/worker-entry.ts", { type: "module" });
    const messages = [], arrivals = [], errors = [];
    let injecting = false, readyMs = null;
    const sent = new Map();
    const rtt = {};
    const post = worker.postMessage.bind(worker);
    worker.postMessage = (m) => { if (m && typeof m.requestId === "string") sent.set(m.requestId, { t: performance.now(), type: m.type }); post(m); };
    worker.addEventListener("message", (e) => {
      if (injecting) return;
      const d = e.data;
      if (readyMs === null && d && d.type === "ready") readyMs = performance.now() - t0;
      messages.push(d);
      const s = d && typeof d.requestId === "string" ? sent.get(d.requestId) : null;
      if (s && (d.type === "result" || d.type === "error")) {
        const key = s.type + (d.ok ? "" : ":" + d.code);
        (rtt[key] ??= []).push(performance.now() - s.t);
        sent.delete(d.requestId);
      }
    });
    worker.addEventListener("error", (e) => errors.push(String(e.message || "worker error")));
    const inject = (data) => { injecting = true; try { worker.dispatchEvent(new MessageEvent("message", { data })); } finally { injecting = false; } };
    const runStart = performance.now();
    const run = await runScripted(kind, worker, inject, globalThis.__pack, { clock: () => performance.now() });
    const runEnd = performance.now();
    await new Promise((r) => setTimeout(r, 50));
    worker.terminate();
    const busy = performance.now(); while (performance.now() - busy < 140) {}
    await new Promise((r) => setTimeout(r, 100));
    const tasks = globalThis.__longtasks;
    const sizes = messages.filter((m) => m && m.snapshot).map((m) => JSON.stringify(m.snapshot).length);
    return {
      readyMs, rtt, errors,
      aiMsPerDecision: run.aiMsPerDecision,
      hashes: await Promise.all(messages.map((m) => replayHash(m))),
      final: await replayHash(run.final),
      humanMoves: run.humanMoves, aiDecisions: run.aiDecisions, advances: run.advances, cancelsHonoured: run.cancelsHonoured, disposed: run.disposed,
      checks: run.checks.length, status: run.final.game.status, revision: run.final.game.revision,
      snapshotBytes: sizes,
      longTasks: tasks === null ? null : tasks.filter((t) => t.start >= runStart && t.start < runEnd).map((t) => t.ms),
      observerWorks: tasks === null ? 0 : tasks.filter((t) => t.start >= runEnd && t.ms >= 100).length,
    };
  };
</script>`;

const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.max(0, Math.ceil(q * s.length) - 1)] : NaN; };
const dist = (xs: number[]) => ({ n: xs.length, p50: quantile(xs, 0.5), p95: quantile(xs, 0.95), max: xs.length ? Math.max(...xs) : NaN });
const limit = (metric: string) => {
  const b = BUDGETS.find((x) => x.metric === metric && (!x.config || x.config === "desktop-1x"));
  if (!b) throw new Error(`no #643 budget named ${metric}`);
  return b;
};

interface PageRun {
  readyMs: number | null; rtt: Record<string, number[]>; errors: string[]; aiMsPerDecision: number[]; hashes: string[]; final: string;
  humanMoves: number; aiDecisions: number; advances: number; cancelsHonoured: number; disposed: boolean; checks: number; status: string; revision: number;
  snapshotBytes: number[]; longTasks: number[] | null; observerWorks: number;
}

const report: Record<string, unknown> = {};
const failures: string[] = [];
const fail = (s: string) => failures.push(s);

const pack = await stagedPack();
// The Node reference: run "a" over the in-process channel, every message the host posts.
const reference = inProcessChannel();
const nodeA = await runScripted("a", reference.port, reference.inject, pack);
const nodeHashes = await Promise.all(reference.posted.map((m) => replayHash(m)));
const nodeFinal = await replayHash(nodeA.final);

const server = await serveRepoModules(process.cwd(), PAGE);
const browser = await Browser.launch();
const watchdog = setTimeout(async () => {
  console.error(`FAIL arena:local-worker-browser: overall timeout of ${TOTAL_MS / 1000} s exceeded; stopping Chrome`);
  await browser.close();
  server.close();
  process.exit(1);
}, TOTAL_MS);

async function inPage<T>(page: Awaited<ReturnType<Browser["page"]>>, expr: string): Promise<T> {
  const key = `__p${Math.random().toString(36).slice(2)}`;
  await page.eval(`globalThis.${key} = null; (async () => { try { globalThis.${key} = { ok: true, v: await (${expr}) }; } catch (e) { globalThis.${key} = { ok: false, e: String(e && e.stack || e) }; } })(); 0`);
  for (;;) {
    const r = await page.eval<{ ok: boolean; v?: T; e?: string } | null>(`globalThis.${key}`);
    if (r) { if (!r.ok) throw new Error(r.e); return r.v as T; }
    await new Promise((res) => setTimeout(res, 200));
  }
}

let a: PageRun | null = null;
let b: PageRun | null = null;
try {
  const page = await browser.page({ name: "desk", width: 1440, height: 900, mobile: false });
  await page.goto(`${server.origin}/`, 60000);
  report.userAgent = await page.eval<string>("navigator.userAgent");
  await page.eval(`globalThis.__pack = JSON.parse(${JSON.stringify(JSON.stringify(pack))}); 0`);
  a = await inPage<PageRun>(page, `globalThis.__run("a")`);

  // Run b on a fresh page with the HTTP cache off: a cold Worker (the module server's transpile is warm).
  const cold = await browser.page({ name: "cold", width: 1440, height: 900, mobile: false });
  await cold.cdp("Network.enable");
  await cold.cdp("Network.setCacheDisabled", { cacheDisabled: true });
  await cold.goto(`${server.origin}/`, 60000);
  await cold.eval(`globalThis.__pack = JSON.parse(${JSON.stringify(JSON.stringify(pack))}); 0`);
  b = await inPage<PageRun>(cold, `globalThis.__run("b")`);
} catch (error) {
  fail(`browser run failed: ${(error as Error).message}`);
} finally {
  clearTimeout(watchdog);
  await browser.close();
  server.close();
}

if (a && b) {
  // Behaviour.
  const differing = nodeHashes.map((h, i) => (a!.hashes[i] === h ? null : i)).filter((i) => i !== null);
  if (a.hashes.length !== nodeHashes.length || differing.length) fail(`run a: the Worker's ${a.hashes.length} messages differ from Node's ${nodeHashes.length} (first differing index ${differing[0]})`);
  if (a.final !== nodeFinal) fail("run a: the final board differs from Node's");
  if (b.final !== nodeFinal) fail("run b: cancelled, disposed and resumed, the final board differs from run a's");
  if (a.status !== "over" || b.status !== "over") fail(`a match did not end (a ${a.status}, b ${b.status})`);
  if (!b.disposed) fail("run b: the dispose-and-resume step did not run");
  if (b.cancelsHonoured < 1) fail("run b: no cancel dropped a batch");
  if (a.errors.length || b.errors.length) fail(`worker errors: ${[...a.errors, ...b.errors].join("; ")}`);
  if (server.refused.length) fail(`the page asked for modules that are not in the repo: ${server.refused.join(", ")}`);

  // Latency against the #643 budgets.
  const applyMs = [...(a.rtt.apply ?? [])];
  const startMs = [...(a.rtt.start ?? []), ...(b.rtt.start ?? [])];
  const ai = [...a.aiMsPerDecision];
  const tasks = a.longTasks;
  const metrics: Record<string, number | null> = {
    "coldWorkerStartMs.p50": b.readyMs,
    "matchStartMs.p95": startMs.length ? dist(startMs).p95 : null,
    "roundTripMs.p95": applyMs.length ? dist(applyMs).p95 : null,
    "roundTripMs.max": applyMs.length ? dist(applyMs).max : null,
    "decisionMs.max": ai.length ? dist(ai).max : null,
    "longTaskCount": tasks ? tasks.length : null,
    "longTaskMaxMs": tasks ? (tasks.length ? Math.max(...tasks) : 0) : null,
    "longTaskObserverWorks": a.observerWorks,
  };
  // Budgets #643 set on the content of its 8-card fixture (snapshot size, the engine-only decision):
  // reported against the real SD15/SD5 cards, not gated — #643's procedure (step 5) re-derives them
  // from a real card pool, which is that issue's table to change, not this one's.
  const informational: Record<string, number | null> = {
    "snapshotBytes.max": a.snapshotBytes.length ? Math.max(...a.snapshotBytes) : null,
    "snapshotBytes.p50": a.snapshotBytes.length ? dist(a.snapshotBytes).p50 : null,
    "decisionMs.p95": ai.length ? dist(ai).p95 : null,
  };
  report.informational = Object.fromEntries(Object.entries(informational).map(([metric, value]) => { const b = limit(metric); return [metric, { value, fixtureBudget: b.limit, within: value !== null && value <= b.limit }]; }));
  const gated: Record<string, { value: number | null; limit: number; atLeast: boolean; ok: boolean }> = {};
  for (const [metric, value] of Object.entries(metrics)) {
    const budget = limit(metric);
    const ok = value !== null && Number.isFinite(value) && (budget.atLeast ? value >= budget.limit : value <= budget.limit);
    gated[metric] = { value, limit: budget.limit, atLeast: !!budget.atLeast, ok };
    if (!ok) fail(`${metric} = ${value === null ? "not measured" : value.toFixed(1)} against ${budget.atLeast ? "at least" : "at most"} ${budget.limit}`);
  }
  report.budgets = gated;
  // The local step is policy + engine; #643's decisionMs.p95 (30 ms) was set for the engine alone on an 8-card fixture.
  report.aiDecisionMs = dist(ai);
  report.rtt = Object.fromEntries(Object.entries({ ...a.rtt }).map(([k, v]) => [k, dist(v)]));
  report.runs = {
    a: { messages: a.hashes.length, sameAsNode: !differing.length && a.hashes.length === nodeHashes.length, humanMoves: a.humanMoves, aiDecisions: a.aiDecisions, advances: a.advances, checks: a.checks, revision: a.revision, coldReadyMs: a.readyMs },
    b: { messages: b.hashes.length, final: b.final === nodeFinal ? "same as run a" : "DIFFERENT", cancelsHonoured: b.cancelsHonoured, disposed: b.disposed, revision: b.revision, coldReadyMs: b.readyMs },
  };
}
report.failures = failures;

if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
else {
  console.log(String(report.userAgent ?? "(no browser)"));
  const runs = report.runs as Record<string, Record<string, unknown>> | undefined;
  if (runs) {
    console.log(`run a: ${runs.a.messages} worker messages, byte-identical to Node: ${runs.a.sameAsNode}; ${runs.a.humanMoves} human moves, ${runs.a.aiDecisions} AI decisions in ${runs.a.advances} advances, ${runs.a.checks} checks, final revision ${runs.a.revision}`);
    console.log(`run b: ${runs.b.messages} worker messages, final board ${runs.b.final}; ${runs.b.cancelsHonoured} cancels dropped a batch; disposed and resumed: ${runs.b.disposed}`);
    const ai = report.aiDecisionMs as ReturnType<typeof dist>;
    console.log(`AI decision (page-measured, per committed decision): p50 ${ai.p50.toFixed(1)}  p95 ${ai.p95.toFixed(1)}  max ${ai.max.toFixed(1)} ms (n=${ai.n}); #643's engine-only decisionMs.p95 is ${limit("decisionMs.p95").limit} ms (informational)`);
    for (const [k, d] of Object.entries(report.rtt as Record<string, ReturnType<typeof dist>>)) console.log(`  round trip ${k.padEnd(18)} n=${String(d.n).padEnd(4)} p50 ${d.p50.toFixed(1)}  p95 ${d.p95.toFixed(1)}  max ${d.max.toFixed(1)} ms`);
    for (const [k, g] of Object.entries(report.budgets as Record<string, { value: number | null; limit: number; atLeast: boolean; ok: boolean }>)) {
      console.log(`  ${g.ok ? "ok  " : "OVER"} ${k.padEnd(24)} ${g.value === null ? "not measured" : g.value.toFixed(1)} ${g.atLeast ? ">=" : "<="} ${g.limit}`);
    }
    for (const [k, g] of Object.entries(report.informational as Record<string, { value: number | null; fixtureBudget: number; within: boolean }>)) {
      console.log(`  ${g.within ? "info" : "info OVER"} ${k.padEnd(19)} ${g.value === null ? "not measured" : g.value.toFixed(1)} vs the 8-card fixture's ${g.fixtureBudget} (not gated)`);
    }
  }
  for (const f of failures) console.log(`FAIL ${f}`);
  console.log(failures.length ? "FAIL" : "ok");
}
process.exit(failures.length ? 1 : 0);
