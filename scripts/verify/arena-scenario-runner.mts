/**
 * #642: the focused scenario runner (`scripts/arena-scenario.mts`), checked cheaply and without a
 * database or a browser (the browser half is `arena-scenario.mts --browser`, run by hand).
 *
 *   1. The scenario module and its worker reach nothing but the browser-safe graph.
 *   2. The three real scenarios (setup, battle, pending-choice) pass, each independently — run in
 *      reverse order and alone they give the same evidence — and twice over they give identical
 *      records (determinism). Their evidence carries the seed, revisions and every hash.
 *   3. A seed override is honoured and recorded; a changed game gives different hashes.
 *   4. The CLI: all scenarios exit 0 with one JSON record each plus a summary; the deliberately
 *      wrong `mismatch-demo` exits 1 with a bounded diagnostic; a wrong interpreter revision, an
 *      unknown scenario and an unknown flag fail non-zero; `--list` lists them.
 *   5. Expectations bite: a scenario with one expectation changed fails in-process too.
 *
 * Run from the repo root: npx tsx scripts/verify/arena-scenario-runner.mts   (part of `npm test`)
 */
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkImportGraph, diskRead } from "../lib/import-graph.ts";
import { fixtureBundle, FIXTURE_REVISION } from "./arena-browser-fixture.ts";
import { MAX_DIFFS, SCENARIOS, runScenario, runScenarios, scenarioIds, type Evidence } from "./arena-scenarios.ts";

const ROOT = process.cwd();

// 1. Portable graph.
for (const entry of ["scripts/verify/arena-scenarios.ts", "scripts/verify/arena-scenario-worker.ts"]) {
  const graph = checkImportGraph(path.join(ROOT, entry), ROOT, diskRead);
  assert.deepEqual(graph.violations, [], `${entry} reaches no forbidden import`);
  assert.ok(graph.files.includes("src/lib/arena/browser.ts"), `${entry} runs on browser.ts`);
}

// 2. The real scenarios.
const bundle = await fixtureBundle();
const input = { bundle, interpreterRevision: FIXTURE_REVISION };
const real = scenarioIds();
assert.deepEqual(real, ["setup", "battle", "pending-choice"], "the named scenarios (the demo is not among them)");
const first = await runScenarios(real, input);
for (const e of first) assert.ok(e.pass, `${e.scenario} passes: ${JSON.stringify(e.diffs)}`);
const second = await runScenarios(real, { bundle: JSON.parse(JSON.stringify(bundle)), interpreterRevision: FIXTURE_REVISION });
assert.deepEqual(second, first, "two runs give identical evidence");
const reversed = await runScenarios([...real].reverse(), input);
assert.deepEqual([...reversed].reverse(), first, "scenarios are independent of order");
for (const e of first) {
  assert.equal(await runScenario(e.scenario, input).then((x) => JSON.stringify(x)), JSON.stringify(e), `${e.scenario} alone equals ${e.scenario} in the batch`);
  assert.equal(e.engine, "rules");
  assert.equal(e.interpreterRevision, FIXTURE_REVISION);
  assert.equal(e.bundleHash, bundle.hash);
  assert.equal(e.rulesetHash, bundle.rulesetHash);
  assert.equal(e.checked, e.steps, `${e.scenario} checked every step`);
  for (const h of [e.bundleHash, ...Object.values(e.hashes)]) assert.match(h, /^[0-9a-f]{64}$/);
}
assert.equal(new Set(first.map((e) => e.hashes.state)).size, first.length, "different scenarios end in different states");
const byId = Object.fromEntries(first.map((e) => [e.scenario, e]));
assert.equal(byId.setup.final.phase, "charge");
assert.equal(byId.battle.final.prompt, "main");
assert.ok(byId["pending-choice"].moves > byId.battle.moves, "the pending-choice scenario plays further than the battle one");

// 3. A seed override is recorded and changes the game (or fails with a diagnostic, never silently).
const other = await runScenario("setup", { ...input, seed: 7 });
assert.equal(other.seed, 7);
assert.notEqual(other.hashes.state, byId.setup.hashes.state, "another seed deals another game");

// 5. Expectations bite, and diagnostics are bounded.
const demo = await runScenario("mismatch-demo", input);
assert.equal(demo.pass, false);
assert.ok(demo.diffs.length >= 3 && demo.diffs.length <= MAX_DIFFS, `bounded diagnostics (${demo.diffs.length})`);
assert.ok(demo.diffs.every((d) => d.expected.length <= 100 && d.actual.length <= 100 && d.field && d.step), "every difference names its step and field, with short values");
{
  const live = SCENARIOS.find((s) => s.id === "battle")!;
  const original = live.steps[1].expect.phase;
  live.steps[1].expect.phase = "main"; // the attack opens a battle, not the main step
  try {
    const broken = await runScenario("battle", input);
    assert.equal(broken.pass, false, "a wrong expectation fails the scenario");
    assert.equal(broken.diffs[0].field, "phase");
    assert.equal(broken.checked, 2, "the run stops at the first failing step (the second)");
    assert.ok(broken.checked < broken.steps, "later steps are not run");
  } finally {
    live.steps[1].expect.phase = original;
  }
}

// 4. The CLI, as an agent runs it.
const cli = (...args: string[]) => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/arena-scenario.mts", ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, DATABASE_URL: "" }, timeout: 180000 });
  return { code: r.status, out: r.stdout.trim().split("\n").filter(Boolean), err: r.stderr.trim() };
};
const all = cli();
assert.equal(all.code, 0, `the CLI passes every scenario (stderr: ${all.err})`);
assert.equal(all.out.length, real.length + 1, "one record per scenario and a summary");
const records = all.out.slice(0, -1).map((l) => JSON.parse(l) as Evidence & { runtime: string });
for (const r of records) {
  const { runtime, ...evidence } = r;
  assert.equal(runtime, "node");
  assert.deepEqual(evidence, byId[r.scenario], `the CLI's record for ${r.scenario} equals the in-process one`);
}
assert.deepEqual(JSON.parse(all.out.at(-1)!), { summary: { scenarios: 3, passed: 3, failed: 0, browser: null } });

const one = cli("battle");
assert.equal(one.code, 0);
assert.equal(one.out.length, 2, "a named scenario runs alone");

const bad = cli("mismatch-demo");
assert.equal(bad.code, 1, "a mismatch exits 1");
assert.match(bad.err, /^FAIL mismatch-demo \(seed 641\): \d+ difference\(s\)/);
assert.ok(bad.err.split("\n").length <= MAX_DIFFS + 2, "the diagnostic is short");
assert.equal((JSON.parse(bad.out[0]) as Evidence).pass, false);
assert.equal(JSON.parse(bad.out.at(-1)!).summary.failed, 1);

const revision = cli("setup", "--revision", "abcdef1");
assert.notEqual(revision.code, 0, "a wrong interpreter revision is refused");
assert.match(revision.err, /interpreter|revision/i);
assert.equal(cli("nope").code, 2, "an unknown scenario is a usage error");
assert.equal(cli("--wat").code, 2, "an unknown flag is a usage error");
const listed = cli("--list");
assert.equal(listed.code, 0);
assert.deepEqual(listed.out.map((l) => JSON.parse(l).id), SCENARIOS.map((s) => s.id));

console.log(`arena-scenario-runner: ${real.length} scenarios pass (${first.map((e) => `${e.scenario} ${e.moves} moves`).join(", ")}), deterministic and order-independent; CLI exits 0/1/2 as documented`);
console.log(`  bundle ${bundle.hash}; ${first.map((e) => `${e.scenario} state ${e.hashes.state.slice(0, 12)}`).join("; ")}`);
