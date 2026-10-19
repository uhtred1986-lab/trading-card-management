/** Direct result projection, without replaying games or reconstructing missing metrics. */
import assert from "node:assert/strict";
import { corpusManifest } from "../lib/corpus-manifest";
import { fixtureBundle, FIXTURE_REVISION } from "./arena-browser-fixture";
import { validateEvaluationManifest } from "../../src/lib/arena/testing/run-manifest";
import type { DuelResult } from "./arena-policy-duel";
const runner = { id: "arena-corpus-freeze" as const, version: "1", gitCommit: "a".repeat(40), dirtyTreeSha256: "b".repeat(64) };
const configuration = { mode: "stored", pairs: 2, maxMoves: 3000, seedBase: 907 };
const collector = corpusManifest(runner, configuration), bundle = await fixtureBundle();
const base: DuelResult = { over: true, winner: "test", reason: "win", moves: 17, turn: 4, damageDealt: 5, damageTaken: 2, guards: { test: 3, baseline: 1 }, stopped: null, stopKind: null, stepMs: [1], steps: [{ ms: 1, window: "main", role: "test" }], trace: "private-local-trace-body" };
for (const [winner, stopKind] of [["test", null], ["baseline", null], ["draw", null], [null, "interrupted"], [null, "limit"], [null, "illegal"]] as const) {
  collector.record({ bundle, runtime: FIXTURE_REVISION, seed: 907, policySeed: 7919, result: { ...base, over: winner !== null, winner, stopKind } });
}
collector.record({ bundle: { ...bundle, decks: { p1: bundle.decks.p2, p2: bundle.decks.p1 } }, runtime: FIXTURE_REVISION, seed: 908, policySeed: 7920, result: { ...base, winner: "baseline" } });
const manifest = collector.finish(); assert.ok(validateEvaluationManifest(manifest).ok);
assert.equal(manifest.runner.id, "arena-corpus-freeze"); assert.equal(manifest.runner.dirtyTreeSha256, runner.dirtyTreeSha256);
assert.equal(manifest.protocol.id, "arena-corpus-stored-v1"); assert.equal(manifest.seedSet, "custom");
assert.deepEqual(manifest.results.map(r => r.outcome), ["win", "loss", "draw", "interrupted", "limit", "illegal", "loss"]);
assert.equal(manifest.fixtures.length, 2); assert.equal(manifest.fixtures[0].p1DeckSha256, manifest.fixtures[1].p2DeckSha256); assert.equal(manifest.fixtures[0].p1RecipeId, null); assert.equal(manifest.fixtures[0].p2RecipeId, null);
for (const r of manifest.results) { assert.equal(r.damageDealt, 5); assert.equal(r.damageTaken, 2); assert.equal(r.guardTrips, 4); assert.equal(r.moves, 17); assert.equal(r.reportedCostMicros, null); assert.equal(r.initialPolicyRng.p2.seed! - r.initialPolicyRng.p1.seed!, 1); }
assert.equal(manifest.results[0].initialPolicyRng.p1.seed, 15839); assert.equal(manifest.results[6].initialPolicyRng.p1.seed, 15841);
assert.ok(!JSON.stringify(manifest).includes("private-local-trace-body")); assert.ok(!("coverage" in manifest));
const crash = corpusManifest(runner, configuration); crash.record({ bundle, runtime: FIXTURE_REVISION, seed: 907, policySeed: 7919, result: null });
assert.throws(() => crash.finish(), /cannot invent metrics/);
assert.equal(validateEvaluationManifest({ ...manifest, runner: { ...runner, id: "unregistered-runner" } }).ok, false);
assert.equal(validateEvaluationManifest({ ...manifest, seedSet: "holdout" }).ok, false, "corpus games do not claim reviewed holdout coverage");
assert.equal(validateEvaluationManifest({ ...manifest, source: "scenario" }).ok, false, "new runner remains restricted to policy-game evidence");
console.log("corpus-manifest-907: truthful runner/fixtures/RNG/metrics/outcomes projected; raw evidence stays local; missing crash metrics refused");
