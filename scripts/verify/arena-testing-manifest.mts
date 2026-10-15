/** Strict and privacy-preserving contract checks for imported Arena runs. */
import assert from "node:assert/strict";
import { parseEvaluationManifestJson, validateEvaluationManifest, type EvaluationManifest } from "../../src/lib/arena/testing/run-manifest.ts";

const sha = "a".repeat(64);
const uuid = "1ba9c1f1-89e2-4a4d-8bd3-2f813f0749de";
const base = {
  version: 1,
  requestId: uuid,
  runner: { id: "arena-scenario", version: "1", gitCommit: "b".repeat(40), dirtyTreeSha256: null },
  protocol: { id: "scenario-v1", revision: "c".repeat(40) },
  fixtures: [{ key: "fixture-a", sourceId: "641", runtimeRevision: "d".repeat(40), bundleSha256: sha,
    rulesSha256: sha, catalogSha256: null, programsSha256: sha, p1DeckSha256: null, p2DeckSha256: null,
    p1RecipeId: null, p2RecipeId: null }],
  policies: [],
  source: "scenario",
  results: [{ key: "setup-p1", kind: "scenario_case", fixtureKey: "fixture-a", sourceScenarioId: "setup",
    portalScenarioId: null, seed: 641, seat: "p1", outcome: "pass", steps: 12, differenceCount: 0,
    browserAgreement: true, evidenceSha256: sha }],
};

function valid(value: unknown): EvaluationManifest {
  const result = validateEvaluationManifest(value);
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  return result.value;
}
function invalid(value: unknown, because: string) {
  const result = validateEvaluationManifest(value);
  assert.equal(result.ok, false, because);
}
const clone = <T,>(value: T): T => structuredClone(value);

const acceptedScenario = valid(base);
assert.equal(acceptedScenario.source, "scenario");
assert.equal(acceptedScenario.fixtures[0].runtimeRevision, "d".repeat(40));

const unpinned = clone(base) as Record<string, unknown>;
((unpinned.fixtures as Record<string, unknown>[])[0]).runtimeRevision = null;
valid(unpinned);
const dirty = clone(base) as Record<string, unknown>;
(dirty.runner as Record<string, unknown>).dirtyTreeSha256 = sha;
valid(dirty);

const decision = clone(base) as Record<string, unknown>;
decision.source = "decision_cases";
(decision.runner as Record<string, unknown>).id = "arena-policy-strategy";
(decision.protocol as Record<string, unknown>).id = "strategy-protocol";
decision.policies = [{ key: "local", version: "search-v2", sha256: sha }, { key: "uniform", version: "1", sha256: sha }];
decision.results = [{ key: "ai01-seed1", kind: "decision_case", fixtureKey: "fixture-a", sourceScenarioId: "ai-01-lethal",
  portalScenarioId: "ai-01", policyKey: "local", seed: 18, seat: "p1",
  initialPolicyRng: { p1: { mode: "seeded", v: 1, seed: 17, n: 0 }, p2: { mode: "deterministic", v: null, seed: null, n: null } },
  assertion: "acceptable_action", outcome: "pass", horizonSteps: 6, evidenceSha256: sha }];
valid(decision);

const game = clone(decision) as Record<string, unknown>;
game.source = "policy_eval";
(game.runner as Record<string, unknown>).id = "arena-policy-eval";
game.seedSet = "dev";
game.results = [{ key: "game-1", kind: "policy_game", fixtureKey: "fixture-a", candidatePolicyKey: "local", baselinePolicyKey: "uniform",
  seedIndex: 0, seed: 641000, candidateSeat: "p1",
  initialPolicyRng: { p1: { mode: "seeded", v: 1, seed: 7920, n: 0 }, p2: { mode: "seeded", v: 1, seed: 7921, n: 0 } },
  outcome: "win", winner: "p1", moves: 30, turn: 8, damageDealt: 50, damageTaken: 20, guardTrips: 0,
  stopKind: null, reportedCostMicros: null, evidenceSha256: sha }];
valid(game);
const freeKnown = clone(game) as Record<string, unknown>;
((freeKnown.results as Record<string, unknown>[])[0]).reportedCostMicros = 0;
valid(freeKnown);

const wrongRequestType = clone(base) as Record<string, unknown>;
wrongRequestType.requestId = [uuid];
invalid(wrongRequestType, "request IDs cannot pass through String coercion");
const badBundleType = clone(base) as Record<string, unknown>;
((badBundleType.fixtures as Record<string, unknown>[])[0]).bundleSha256 = [sha];
invalid(badBundleType, "hashes must be strings, not coercible values");
const privatePath = clone(base) as Record<string, unknown>;
((privatePath.fixtures as Record<string, unknown>[])[0]).sourceId = "/private/snapshot.json";
invalid(privatePath, "fixture IDs cannot smuggle local paths into history");
const shortCommit = clone(base) as Record<string, unknown>;
(shortCommit.runner as Record<string, unknown>).gitCommit = "b".repeat(12);
invalid(shortCommit, "source commit must identify a full commit hash");
const unknownRootField = { ...base, snapshot: { private: true } };
invalid(unknownRootField, "unknown root fields, including private state, are rejected");
const unknownResultField = clone(base) as Record<string, unknown>;
((unknownResultField.results as Record<string, unknown>[])[0]).trace = "private trace";
invalid(unknownResultField, "result rows reject trace and arbitrary fields");
const wrongVersion = { ...base, version: 2 };
invalid(wrongVersion, "unknown schema versions are rejected");
const badFixtureRef = clone(base) as Record<string, unknown>;
((badFixtureRef.results as Record<string, unknown>[])[0]).fixtureKey = "missing";
invalid(badFixtureRef, "results must refer to a pinned fixture");
const duplicateResult = clone(base) as Record<string, unknown>;
duplicateResult.results = [...(base.results), { ...base.results[0] }];
invalid(duplicateResult, "result keys are unique per run");
const passingDiff = clone(base) as Record<string, unknown>;
((passingDiff.results as Record<string, unknown>[])[0]).differenceCount = 1;
invalid(passingDiff, "a passing scenario cannot report expectation differences");
const passingBrowserMismatch = clone(base) as Record<string, unknown>;
((passingBrowserMismatch.results as Record<string, unknown>[])[0]).browserAgreement = false;
invalid(passingBrowserMismatch, "a passing scenario cannot disagree with the browser run");

const lossWithoutWinner = clone(game) as Record<string, unknown>;
((lossWithoutWinner.results as Record<string, unknown>[])[0]).outcome = "loss";
((lossWithoutWinner.results as Record<string, unknown>[])[0]).winner = null;
invalid(lossWithoutWinner, "losses require the opponent seat as winner");
const lossWrongWinner = clone(game) as Record<string, unknown>;
((lossWrongWinner.results as Record<string, unknown>[])[0]).outcome = "loss";
invalid(lossWrongWinner, "candidate losses cannot name the candidate seat as winner");
const limitedNoStop = clone(game) as Record<string, unknown>;
((limitedNoStop.results as Record<string, unknown>[])[0]).outcome = "limit";
invalid(limitedNoStop, "limit outcomes require a matching stop category");
const completedWithStop = clone(game) as Record<string, unknown>;
((completedWithStop.results as Record<string, unknown>[])[0]).stopKind = "interrupted";
invalid(completedWithStop, "completed games cannot also carry a stop category");
const badRng = clone(decision) as Record<string, unknown>;
((((badRng.results as Record<string, unknown>[])[0]).initialPolicyRng as Record<string, Record<string, unknown>>).p1).n = -1;
invalid(badRng, "RNG draw count is nonnegative");

assert.equal(parseEvaluationManifestJson(JSON.stringify(base)).ok, true);
assert.equal(parseEvaluationManifestJson("not json").ok, false);
assert.equal(parseEvaluationManifestJson(" ".repeat(2 * 1024 * 1024 + 1)).ok, false, "oversize uploads fail before parsing");

console.log("arena-testing-manifest: strict scenario, decision and evaluation contracts; idempotency facts, revision pins, RNG, cost null/zero and private-field rejection passed");
