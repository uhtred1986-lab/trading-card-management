/**
 * #641: the browser-safe rules entry in a real browser worker.
 *
 * Headless Chrome/Chromium loads a page from 127.0.0.1 (a secure context) that starts a module
 * Web Worker on `arena-browser-worker.ts`. The repo's TypeScript is served as native ES modules
 * (`scripts/lib/module-server.mts`: transpiled per file, no bundler, no Node shim), so a module
 * in the graph that needed `node:*`, `fs`, `process` or a package would fail to load. Once the
 * worker reports it has loaded, the page is taken offline and the request log is frozen; the
 * pinned bundle is then handed over in a message, and the worker creates the game, applies the
 * scenario's moves and projects both seats' snapshots (`arena-browser-scenario.ts`).
 *
 * It must agree with the same scenario run in Node on every step (state, events, legal moves,
 * each seat's snapshot) and on the full final record, make no request after loading, and have
 * loaded no legacy-engine or server module.
 *
 * Not part of `npm test` (it needs a browser). Run from the repo root:
 *   npx tsx scripts/verify/arena-browser-engine-browser.mts      (CHROME_PATH=… to pick a binary)
 */
import assert from "node:assert/strict";
import { Browser, findChrome } from "../lib/cdp.mts";
import { serveRepoModules } from "../lib/module-server.mts";
import { fixtureBundle, FIXTURE_REVISION, FIXTURE_SEED } from "./arena-browser-fixture.ts";
import { runBrowserScenario, type ScenarioResult } from "./arena-browser-scenario.ts";

const MAX_STEPS = 120;

const PAGE = `<!doctype html><meta charset="utf-8"><title>rules engine worker</title>
<script type="module">
  const worker = new Worker("/scripts/verify/arena-browser-worker.ts", { type: "module" });
  worker.onmessage = (e) => { if (e.data && e.data.ready) globalThis.__ready = e.data.env; else globalThis.__result = e.data; };
  worker.onerror = (e) => { globalThis.__loadError = String((e && (e.message || e.filename)) || "worker failed to load"); e.preventDefault && e.preventDefault(); };
  globalThis.__run = (json, seed, interpreterRevision, maxSteps) => {
    globalThis.__result = null;
    worker.postMessage({ bundle: JSON.parse(json), seed, interpreterRevision, maxSteps });
  };
  globalThis.__pageEnv = { process: typeof process !== "undefined", secure: isSecureContext };
</script>`;

const bundle = await fixtureBundle();
const node = await runBrowserScenario({ bundle, seed: FIXTURE_SEED, interpreterRevision: FIXTURE_REVISION, maxSteps: MAX_STEPS });

const server = await serveRepoModules(process.cwd(), PAGE);
const browser = await Browser.launch();
const networkAfterReady: string[] = [];
let ready = false;
browser.on((method, params) => {
  if (ready && method === "Network.requestWillBeSent") networkAfterReady.push(String(params?.request?.url ?? "?"));
});
const wait = async (expr: string, ms: number) => {
  const end = Date.now() + ms;
  while (!(await page.eval<boolean>(expr)) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
};
let page: Awaited<ReturnType<Browser["page"]>>;
try {
  page = await browser.page({ name: "desk", width: 800, height: 600, mobile: false });
  await page.goto(`${server.origin}/`);
  await wait("!!globalThis.__ready || !!globalThis.__loadError", 60000);
  assert.equal(await page.eval<string | null>("globalThis.__loadError ?? null"), null, "the worker's module graph loads as native ES modules");
  const workerEnv = await page.eval<Record<string, boolean> | null>("globalThis.__ready ?? null");
  assert.ok(workerEnv, `the worker loaded (refused: ${server.refused.join(", ")})`);
  assert.equal(workerEnv.worker, true, "the code runs in a dedicated worker scope (importScripts, no window/document)");
  assert.equal(workerEnv.process || workerEnv.require || workerEnv.buffer, false, "no Node shim (process, require, Buffer) exists in the worker");
  assert.ok(workerEnv.secure && workerEnv.subtle, "the worker has a secure context with Web Crypto");
  assert.equal(server.refused.length, 0, `the worker asked for nothing outside the module graph (${server.refused.join(", ")})`);
  for (const m of server.served) {
    const rel = m.slice(1);
    assert.ok(!/^src\/(db|app)\/|^src\/lib\/(auth|ai|cache|cardtrader)\//.test(rel), `the browser loaded no server module (${rel})`);
  }

  // Offline from here on, and the server's request log is frozen.
  const loadedRequests = server.requests.length;
  await page.setOffline(true);
  ready = true;
  await page.eval(`globalThis.__run(${JSON.stringify(JSON.stringify(bundle))}, ${FIXTURE_SEED}, ${JSON.stringify(FIXTURE_REVISION)}, ${MAX_STEPS})`);
  await wait("!!globalThis.__result", 180000);
  const reply = await page.eval<{ ok: boolean; error?: string; ms?: number; env: Record<string, boolean>; result?: ScenarioResult } | null>("globalThis.__result ?? null");
  assert.ok(reply, "the worker answered");
  assert.ok(reply.ok, `the scenario ran in the worker: ${reply.error ?? ""}`);
  const web = reply.result!;
  assert.equal(server.requests.length, loadedRequests, `no request reached the server while the game ran (${server.requests.slice(loadedRequests).join(", ")})`);
  assert.deepEqual(networkAfterReady, [], "the browser issued no network request while the game ran");

  // Node and browser agree on everything.
  assert.equal(web.steps.length, node.steps.length, "the same number of steps");
  for (let i = 0; i < node.steps.length; i++) assert.deepEqual(web.steps[i], node.steps[i], `step ${i}: state, events, legal moves and both snapshots agree`);
  assert.equal(web.finalJson, node.finalJson, "the full final record (state, every event, legal moves, both snapshots, moves) is byte-identical");
  assert.equal(web.finalHash, node.finalHash, "the final hashes agree");
  assert.deepEqual(web.checks, node.checks, "the same viewer-safety checks passed in the worker");

  const ua = await page.eval<string>("navigator.userAgent");
  console.log(`arena-browser-engine-browser: ${web.steps.length} steps to turn ${web.turn} (${web.phase}) in a module worker in ${reply.ms} ms, identical to Node`);
  console.log(`  ${ua}`);
  console.log(`  binary ${findChrome()}; ${server.served.length} modules served natively; 0 requests after load (offline)`);
  console.log(`  final ${web.finalHash}; record ${web.finalJson.length} bytes`);
  console.log(`  checks in the worker: ${web.checks.join("; ")}`);
  console.log(`  modules: ${server.served.join(", ")}`);
} finally {
  await browser.close();
  server.close();
}
