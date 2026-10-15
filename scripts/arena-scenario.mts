#!/usr/bin/env node
/**
 * #642: run named, database-free scenarios on the pinned rules engine and print compact evidence.
 *
 *   npm run arena:scenario -- [scenario ids | all] [--seed N] [--revision SHA] [--bundle file.json]
 *                             [--write-bundle file.json] [--manifest-out file.json] [--browser] [--list]
 *
 * Scenarios (`scripts/verify/arena-scenarios.ts`): `setup`, `battle`, `pending-choice`, and
 * `mismatch-demo` (deliberately wrong; only runs when named). Each plays the engine's own legal
 * moves through `src/lib/arena/browser.ts` and asserts state, events and legal actions.
 *
 * Output on stdout is one JSON object per scenario (scenario id, seed, interpreter revision,
 * bundle / ruleset / catalog / programs hashes, state / events / legal-move / snapshot / action
 * hashes, pass, a bounded `diffs` list) and a final `{"summary":…}` line. Exit 0 when every
 * scenario passes, 1 when any expectation or the Node/browser agreement fails (a short diagnostic
 * goes to stderr), 2 on a usage error. `--browser` additionally runs the same scenarios inside a
 * headless-Chrome module worker, offline, and requires the whole record to equal Node's.
 *
 * The bundle defaults to the fixture of `scripts/verify/arena-browser-fixture.ts` (synthetic
 * cards, the compiler's own rules, the shipped DBS ruleset, revision pinned to its constant);
 * `--bundle` takes a replay bundle with decks, e.g. one written by `--write-bundle`. No database.
 */
import fs from "node:fs";
import { MAX_DIFFS, SCENARIOS, runScenario, runScenarios, scenarioIds, type Evidence } from "./verify/arena-scenarios.ts";
import { fixtureBundle, FIXTURE_REVISION } from "./verify/arena-browser-fixture.ts";
import { canonicalJson, sha256Hex, type ReplayBundleRecord } from "../src/lib/arena/replay-core.ts";
import { evaluationRunnerPin } from "./lib/evaluation-provenance.ts";
import { scenarioManifest, type ScenarioAttempt } from "./lib/scenario-manifest.ts";

function usage(message: string): never {
  console.error(`arena:scenario: ${message}`);
  console.error("Usage: npm run arena:scenario -- [ids|all] [--seed N] [--revision SHA] [--bundle file.json] [--write-bundle file.json] [--manifest-out file.json] [--browser] [--list]");
  process.exit(2);
}

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) usage(`${name} needs a value`);
  return v;
};
const valued = new Set(["--seed", "--revision", "--bundle", "--write-bundle", "--manifest-out"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1] ?? ""));
for (const a of argv) if (a.startsWith("--") && !valued.has(a) && !["--browser", "--list"].includes(a)) usage(`unknown flag ${a}`);

if (argv.includes("--list")) {
  for (const s of SCENARIOS) console.log(JSON.stringify({ id: s.id, seed: s.seed, steps: s.steps.length, demo: s.demo === true, description: s.description }));
  process.exit(0);
}

const known = SCENARIOS.map((s) => s.id);
const ids = positional.length === 0 || positional.includes("all") ? scenarioIds() : positional;
for (const id of ids) if (!known.includes(id)) usage(`unknown scenario "${id}" (known: ${known.join(", ")}, all)`);

const seedText = flag("--seed");
const seed = seedText === undefined ? undefined : Number(seedText);
if (seed !== undefined && !Number.isInteger(seed)) usage("--seed must be an integer");

const bundlePath = flag("--bundle");
const bundle: ReplayBundleRecord = bundlePath ? (JSON.parse(fs.readFileSync(bundlePath, "utf8")) as ReplayBundleRecord) : await fixtureBundle();
const revision = flag("--revision") ?? (bundlePath ? bundle.runtimeRevision : FIXTURE_REVISION);
const out = flag("--write-bundle");
if (out) {
  fs.writeFileSync(out, JSON.stringify(bundle));
  console.error(`arena:scenario: wrote bundle ${bundle.hash} to ${out}`);
}

const input = { bundle, seed, interpreterRevision: revision ?? null };
const manifestOut = flag("--manifest-out");
const runnerPin = manifestOut ? evaluationRunnerPin("arena-scenario", "1") : null;
const attempts: ScenarioAttempt[] = [];
let evidence: Evidence[];
if (manifestOut) {
  evidence = [];
  // Export mode retains every attempted case, including interpreter failures.
  for (const id of ids) {
    const attempt: ScenarioAttempt = { id, seed: seed ?? SCENARIOS.find((s) => s.id === id)!.seed };
    try {
      attempt.evidence = await runScenario(id, input);
      evidence.push(attempt.evidence);
    } catch (error) {
      attempt.error = error instanceof Error ? error.message : String(error);
      console.error(`arena:scenario: ${attempt.error}`);
    }
    attempts.push(attempt);
  }
} else {
  try {
    evidence = await runScenarios(ids, input);
  } catch (error) {
    console.error(`arena:scenario: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

interface BrowserSide {
  userAgent: string;
  agrees: boolean;
  differs: string[];
}
let browserInfo: { agreement: Map<string, BrowserSide>; error?: string } | null = null;
if (argv.includes("--browser")) browserInfo = await runInBrowser(evidence);

let failed = attempts.filter((a) => a.error !== undefined).length;
for (const e of evidence) {
  const browser = browserInfo?.agreement.get(e.scenario);
  const record = { ...e, runtime: "node", ...(browser ? { browser } : {}) };
  console.log(JSON.stringify(record));
  if (!e.pass) {
    failed++;
    console.error(`FAIL ${e.scenario} (seed ${e.seed}): ${e.diffs.length + e.omitted} difference(s)${e.omitted ? `, first ${MAX_DIFFS} shown` : ""}`);
    for (const d of e.diffs) console.error(`  [${d.step}] ${d.field}: expected ${d.expected}; got ${d.actual}`);
  }
  if (browser && !browser.agrees) {
    failed++;
    console.error(`FAIL ${e.scenario}: browser and Node disagree on ${browser.differs.slice(0, MAX_DIFFS).join(", ")}`);
  }
}
if (browserInfo?.error) {
  failed++;
  console.error(`FAIL browser: ${browserInfo.error}`);
}
if (manifestOut && runnerPin) {
  if (canonicalJson(evaluationRunnerPin("arena-scenario", "1")) !== canonicalJson(runnerPin)) throw new Error("Runner source changed during evaluation; rerun before exporting evidence.");
  const manifest = await scenarioManifest({
    bundle, interpreterRevision: input.interpreterRevision, runner: runnerPin,
    protocolRevision: await sha256Hex(fs.readFileSync("scripts/verify/arena-scenarios.ts", "utf8")),
    attempts, browser: browserInfo,
  });
  fs.writeFileSync(manifestOut, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(manifestOut, 0o600);
  console.error(`arena:scenario: wrote ${manifest.results.length} allowlisted results`);
}
console.log(JSON.stringify({ summary: { scenarios: manifestOut ? attempts.length : evidence.length, passed: evidence.filter((e) => e.pass).length, failed, browser: browserInfo ? !browserInfo.error : null } }));
process.exit(failed ? 1 : 0);

/** Run the same scenarios in a headless-Chrome module worker, offline, and compare whole records. */
async function runInBrowser(node: Evidence[]): Promise<{ agreement: Map<string, BrowserSide>; error?: string }> {
  const { Browser } = await import("./lib/cdp.mts");
  const { serveRepoModules } = await import("./lib/module-server.mts");
  const page = `<!doctype html><meta charset="utf-8"><title>arena scenarios</title>
<script type="module">
  const worker = new Worker("/scripts/verify/arena-scenario-worker.ts", { type: "module" });
  worker.onmessage = (e) => { if (e.data && e.data.ready) globalThis.__ready = e.data.env; else globalThis.__result = e.data; };
  worker.onerror = (e) => { globalThis.__loadError = String((e && (e.message || e.filename)) || "worker failed to load"); e.preventDefault && e.preventDefault(); };
  globalThis.__run = (message) => { globalThis.__result = null; worker.postMessage(JSON.parse(message)); };
</script>`;
  const agreement = new Map<string, BrowserSide>();
  const server = await serveRepoModules(process.cwd(), page);
  let browser: Awaited<ReturnType<typeof Browser.launch>> | null = null;
  try {
    browser = await Browser.launch();
    const tab = await browser.page({ name: "scenario", width: 800, height: 600, mobile: false });
    const wait = async (expr: string, ms: number) => {
      const end = Date.now() + ms;
      while (!(await tab.eval<boolean>(expr)) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
    };
    await tab.goto(`${server.origin}/`);
    await wait("!!globalThis.__ready || !!globalThis.__loadError", 60000);
    const loadError = await tab.eval<string | null>("globalThis.__loadError ?? null");
    if (loadError || !(await tab.eval<boolean>("!!globalThis.__ready"))) return { agreement, error: `the worker did not load: ${loadError ?? "timed out"}${server.refused.length ? ` (refused: ${server.refused.join(", ")})` : ""}` };
    await tab.setOffline(true);
    await tab.eval(`globalThis.__run(${JSON.stringify(JSON.stringify({ ...input, ids }))})`);
    await wait("!!globalThis.__result", 120000);
    const reply = await tab.eval<{ ok: boolean; error?: string; evidence?: Evidence[] } | null>("globalThis.__result ?? null");
    if (!reply?.ok || !reply.evidence) return { agreement, error: `the worker failed: ${reply?.error ?? "no answer"}` };
    const userAgent = await tab.eval<string>("navigator.userAgent");
    for (const n of node) {
      const w = reply.evidence.find((e) => e.scenario === n.scenario);
      const differs = w ? (Object.keys(n) as (keyof Evidence)[]).filter((k) => canonicalJson(n[k]) !== canonicalJson(w[k])).map(String) : ["missing"];
      agreement.set(n.scenario, { userAgent, agrees: differs.length === 0, differs });
    }
    return { agreement };
  } catch (error) {
    return { agreement, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await browser?.close();
    server.close();
  }
}
