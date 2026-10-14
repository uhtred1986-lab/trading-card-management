#!/usr/bin/env node
/** O5-02 pure policy Worker costs and heap on a two-attack win and a wide
 * real-engine legal-menu stress case. No database, network or page rendering.
 * npx tsx scripts/arena-search-bench.mts > FILE.json
 */
import assert from "node:assert/strict";
import { Browser } from "./lib/cdp.mts";
import { serveRepoModules } from "./lib/module-server.mts";
import { mainFixtureBundle, mainPhaseMatch, stage } from "./verify/arena-policy-main-fixture.ts";
import { policyTurn } from "../src/lib/arena/policy/boundary.ts";
import { localPolicy } from "../src/lib/arena/policy/combat.ts";
import { policyRng } from "../src/lib/arena/policy/rng.ts";
const opening = await mainPhaseMatch(await mainFixtureBundle());
const inputs = Object.fromEntries([2, 5].map((n) => {
  const match = stage(opening, {
    p1: { hand: [], energy: [], battle: Array.from({ length: n }, () => ({ cardId: "M-BIG", mode: "active" as const })), leaderMode: "rest" },
    p2: { hand: ["M-R1", "M-R2", "M-B1", "M-BIG"], energy: [], battle: Array.from({ length: n === 2 ? 1 : 4 }, () => ({ cardId: "M-R2", mode: "rest" as const })), life: 2 },
  });
  return [n === 2 ? "two-attacks" : "wide-menu", policyTurn(match, "p1", 0).input];
}));
const server = await serveRepoModules(process.cwd(), `<!doctype html><script>
globalThis.result = null;
globalThis.run = (inputs) => {
 const w = new Worker('/scripts/verify/arena-search-bench-worker.ts', { type: 'module' });
 globalThis.worker = w;
 w.onerror = (e) => { globalThis.result = {ok:false,error:e.message}; };
 w.onmessage = (e) => { if(e.data.ready) w.postMessage({inputs}); else globalThis.result=e.data; };
};</script>`);
const browser = await Browser.launch();
let sid: string | null = null;
browser.on((method, params) => {
  if (method === "Target.attachedToTarget" && params?.targetInfo?.type === "worker") {
    sid = String(params.sessionId);
    void browser.send("Runtime.runIfWaitingForDebugger", {}, sid);
  }
});
const watchdog = setTimeout(() => { void browser.kill(); server.close(); process.exit(1); }, 60000);
try {
  const page = await browser.page({ name: "search-bench", width: 1440, height: 900, mobile: false });
  await page.cdp("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await page.goto(server.origin);
  await page.eval(`globalThis.run(${JSON.stringify(inputs)}); 0`);
  let result: { ok: boolean; error?: string; cases?: Record<string, { cancellation: string; deadline: string; fallbackId: string; deadlineId: string }> } | null = null;
  while (!result) { await new Promise((r) => setTimeout(r, 100)); result = await page.eval("globalThis.result"); }
  assert.ok(result.ok, result.error);
  for (const [name, value] of Object.entries(result.cases!)) {
    assert.equal(value.cancellation, "cancelled");
    assert.equal(value.deadline, "deadline");
    const fallback = localPolicy()(inputs[name], policyRng(1)).answer.id;
    assert.equal(value.fallbackId, fallback);
    assert.equal(value.deadlineId, fallback);
  }
  assert.ok(sid, "Worker heap must be measurable");
  const used = await browser.send<{ usedSize: number }>("Runtime.getHeapUsage", {}, sid!);
  await browser.send("HeapProfiler.collectGarbage", {}, sid!);
  const retained = await browser.send<{ usedSize: number }>("Runtime.getHeapUsage", {}, sid!);
  console.log(JSON.stringify({ userAgent: await page.eval("navigator.userAgent"), cases: result.cases,
    workerHeap: { usedBytes: used.usedSize, retainedBytes: retained.usedSize }, measured: "pure policy in unthrottled Chrome Worker; no engine/board in the Worker" }, null, 2));
  assert.deepEqual(server.refused, []);
} finally {
  clearTimeout(watchdog);
  await browser.close();
  server.close();
}
