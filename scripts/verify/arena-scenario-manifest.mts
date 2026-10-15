import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluationRunnerPin } from "../lib/evaluation-provenance.ts";
import { scenarioManifest } from "../lib/scenario-manifest.ts";
import { fixtureBundle, FIXTURE_REVISION } from "./arena-browser-fixture.ts";
import { runScenario } from "./arena-scenarios.ts";
import { validateEvaluationManifest } from "../../src/lib/arena/testing/run-manifest.ts";

const dir = mkdtempSync(join(tmpdir(), "arena-manifest-"));
try {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  writeFileSync(join(dir, ".gitignore"), ".env\n");
  writeFileSync(join(dir, "runner.ts"), "original");
  git("add", ".");
  git("-c", "user.name=Evidence Test", "-c", "user.email=evidence@example.invalid", "commit", "-qm", "fixture");
  const clean = evaluationRunnerPin("arena-scenario", "1", dir);
  assert.match(clean.gitCommit, /^[a-f0-9]{40}$/);
  assert.equal(clean.dirtyTreeSha256, null);
  writeFileSync(join(dir, ".env"), "DO_NOT_EXPORT_THIS_SECRET");
  assert.deepEqual(evaluationRunnerPin("arena-scenario", "1", dir), clean, "ignored credentials are excluded");
  writeFileSync(join(dir, "runner.ts"), "changed");
  const changed = evaluationRunnerPin("arena-scenario", "1", dir);
  assert.match(changed.dirtyTreeSha256!, /^[a-f0-9]{64}$/);
  git("add", "runner.ts");
  assert.deepEqual(evaluationRunnerPin("arena-scenario", "1", dir), changed, "staging does not hide changed source");
  writeFileSync(join(dir, "new-fixture.ts"), "untracked input");
  assert.notEqual(evaluationRunnerPin("arena-scenario", "1", dir).dirtyTreeSha256, changed.dirtyTreeSha256, "untracked source is pinned too");

  const bundle = await fixtureBundle();
  const evidence = await runScenario("setup", { bundle, interpreterRevision: FIXTURE_REVISION });
  const base = { bundle, interpreterRevision: FIXTURE_REVISION, runner: clean,
    protocolRevision: "reviewed-fixture-v1", attempts: [{ id: "setup", seed: evidence.seed, evidence }], browser: null };
  const pass = await scenarioManifest(base);
  assert.equal(pass.results[0].outcome, "pass");
  assert.equal(pass.results[0].steps, evidence.checked);
  assert.equal(pass.results[0].portalScenarioId, null, "synthetic cases never infer a portal coverage mapping");
  assert.equal(pass.fixtures[0].bundleSha256, bundle.hash);
  assert.match(pass.fixtures[0].p1DeckSha256!, /^[a-f0-9]{64}$/);
  assert.equal(validateEvaluationManifest(pass).ok, true);
  const failed = await scenarioManifest({ ...base, browser: { agreement: new Map([["setup", { agrees: false, differs: ["hashes"] }]]) } });
  assert.equal(failed.results[0].outcome, "fail");
  assert.equal(failed.results[0].browserAgreement, false);
  const browserError = await scenarioManifest({ ...base, browser: { agreement: new Map(), error: "private browser path" } });
  assert.equal(browserError.results[0].outcome, "error");
  const interrupted = await scenarioManifest({ ...base, interpreterRevision: null,
    attempts: [{ id: "setup", seed: 5, error: "PRIVATE_STATE /private/location prompt=secret" }] });
  assert.equal(interrupted.fixtures[0].runtimeRevision, null, "unpinned input stays explicit");
  assert.equal(interrupted.results[0].outcome, "error");
  assert.equal(interrupted.results[0].steps, 0);
  for (const value of [pass, failed, browserError, interrupted]) {
    const text = JSON.stringify(value);
    for (const privateText of ["PRIVATE_STATE", "/private/location", "prompt=secret", "private browser path", "DO_NOT_EXPORT_THIS_SECRET", '"payload"', '"diffs"', '"decks"']) assert.ok(!text.includes(privateText));
  }

  const out = join(dir, "evidence.json");
  const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/arena-scenario.mts", ...args, "--manifest-out", out], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATABASE_URL: "" }, timeout: 180_000,
  });
  const good = cli("setup");
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).results[0].outcome, "pass");
  const wrong = cli("mismatch-demo");
  assert.equal(wrong.status, 1, wrong.stderr);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).results[0].outcome, "fail");
  const revision = cli("setup", "--revision", "ffffffffffffffffffffffffffffffffffffffff");
  assert.equal(revision.status, 1, revision.stderr);
  const exportedError = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(exportedError.results.length, 1, "a failed attempt remains in the denominator");
  assert.equal(exportedError.results[0].outcome, "error");
  assert.equal(validateEvaluationManifest(exportedError).ok, true);
  console.log("scenario manifests: source pins, private projection, pass/fail/error and CLI evidence export pass");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
