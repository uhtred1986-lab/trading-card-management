/** No-game #899 preparation, exact payload, schedule and durable-attempt proof. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { prepareDefense, defenseSchedule, shardJobs, saveDefenseJournal, validateDefenseJournal, recoverDefenseInflight, reserveDefenseCampaign, summarizeDefense, classifyDefense, validateDefenseProtocol } from "../lib/arena-defense-evaluation";
import { defenseFixtures, byteHash } from "../lib/arena-defense-fixtures";
import { frozenBaselinePin } from "../lib/arena-defense-baseline";
import { evidenceHash } from "../lib/policy-evaluation-manifest";
import type { DefenseProtocol, DefenseJournal, DefenseFreeze, DefenseRecord } from "../lib/arena-defense-contract";
import type { DuelResult } from "./arena-policy-duel";
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const directory = mkdtempSync(resolve(tmpdir(), "defense899-nogame-"));
const protocol: DefenseProtocol = { format: "arena-defense-protocol-v1", id: "defense899-nogame-proof", runtimeRevision: "2da6ef08e2d33204cb9ef7ba6e403629f0c61759",
  corpora: [
    { key: "starters", path: "docs/arena-backlog/evidence/907/typed-use-validity-2026-10-19/starter-compiler-pack.json", sha256: "592b9d6da5ebf25ed81ea6ec2d5b70dc28db8c77f42b9791733215c93fce0a80", mode: "compiler", decks: ["A", "B"], seedBase: 40899000 },
    { key: "bt6", path: "docs/arena-backlog/evidence/907/typed-use-validity-2026-10-19/actual-stored-pair-pack.json", sha256: "45cbd903986cd483c9d100c73c46073b2290fd67bbb71e26f1132a07f273b69f", mode: "stored", decks: ["bt6-gogeta-br-fusion", "bt6-paragus-broly-recovery"], seedBase: 40899400 },
  ], deals: 20, maxMoves: 3000, policySeedBase: 89940000, privacyEvery: 100, baseline: frozenBaselinePin(),
  gate: { pairs: 160, decisivePairs: 20, pairWinCiLowGreaterThan: .5, perFixturePairCiUpperAtLeast: .5, completionRate: 1, illegal: 0, privacyFailures: 0, guardTrips: 0 } };
const protocolFile = resolve(directory, "protocol.json"); writeFileSync(protocolFile, JSON.stringify(protocol));
let syntheticCampaign: string | null = null;
try {
  const { freeze, fixtures } = await prepareDefense(protocolFile);
  assert.equal(freeze.jobs.length, 320); assert.equal(freeze.fixtures.length, 8);
  assert.ok(!JSON.stringify(freeze).includes('"path"'), "public freeze omits pack paths");
  for (let i = 0; i < freeze.jobs.length; i += 2) {
    const [a, b] = freeze.jobs.slice(i, i + 2); assert.equal(a.seed, b.seed); assert.equal(a.candidateSeat, "p1"); assert.equal(b.candidateSeat, "p2");
    assert.deepEqual(a.initialPolicyRng, b.initialPolicyRng, "physical-seat RNG stays fixed across candidate assignment");
  }
  for (const count of [3, 4]) {
    const partition = Array.from({ length: count }, (_, index) => shardJobs(freeze.jobs, { index, count }));
    const shards = partition.flat();
    assert.equal(shards.length, 320); assert.equal(new Set(shards.map(j => j.index)).size, 320);
    if (count === 4) assert.ok(partition.every(jobs => jobs.length === 80));
  }
  const collision = copy(protocol); collision.corpora[1].seedBase = collision.corpora[0].seedBase;
  const collisionFixtures = fixtures.map(f => f.corpus === "bt6" ? { ...f, seedBase: collision.corpora[0].seedBase } : f);
  assert.throws(() => defenseSchedule(collision, collisionFixtures), /seed collision/);
  const invalid = copy(protocol); invalid.gate.guardTrips = 1 as 0; assert.throws(() => validateDefenseProtocol(invalid));
  const corrupt = copy(protocol); corrupt.corpora[0].sha256 = "0".repeat(64); await assert.rejects(defenseFixtures(corrupt), /bytes changed/);
  const oldPack = JSON.parse(readFileSync(protocol.corpora[0].path, "utf8")); oldPack.decks[0].admitted = false;
  const packPath = resolve(directory, "not-admitted.json"); writeFileSync(packPath, JSON.stringify(oldPack));
  const denied = copy(protocol); denied.corpora[0].path = packPath; denied.corpora[0].sha256 = byteHash(readFileSync(packPath)); await assert.rejects(defenseFixtures(denied), /not admitted/);
  // Only synthetic journal bodies are written below. No engine match is created.
  const synthetic: DefenseFreeze = { ...freeze, sha256: evidenceHash({ proof: "synthetic-no-games", nonce: randomUUID() }) };
  syntheticCampaign = resolve(tmpdir(), `arena-defense-campaign-${synthetic.sha256}`);
  const runner: DefenseJournal["runner"] = { id: "arena-policy-eval", version: "synthetic-no-games", gitCommit: protocol.runtimeRevision, dirtyTreeSha256: null };
  const checkpoint = resolve(directory, "journal.json");
  const campaignId = await reserveDefenseCampaign(synthetic, runner, { index: 0, count: 3 }, checkpoint);
  assert.equal(await reserveDefenseCampaign(synthetic, runner, { index: 1, count: 3 }, resolve(directory, "journal1.json")), campaignId, "shards share stable campaign identity");
  await assert.rejects(reserveDefenseCampaign(synthetic, runner, { index: 0, count: 3 }, checkpoint), /checkpoint is missing/);
  writeFileSync(checkpoint, "{}");
  assert.equal(await reserveDefenseCampaign(synthetic, runner, { index: 0, count: 3 }, checkpoint), campaignId, "same-path resume is idempotent");
  await assert.rejects(reserveDefenseCampaign(synthetic, runner, { index: 0, count: 3 }, resolve(directory, "overlap.json")), /overlapping consumption/);
  await assert.rejects(reserveDefenseCampaign(synthetic, runner, { index: 0, count: 2 }, resolve(directory, "other-count.json")), /shard-count conflict/);
  const assigned = shardJobs(freeze.jobs, { index: 0, count: 3 });
  const body: Omit<DefenseJournal, "sha256"> = { format: "arena-defense-journal-v1", requestId: campaignId, freezeSha256: synthetic.sha256, runner, shard: { index: 0, count: 3 }, records: [], inflight: { job: assigned[0], startedAt: new Date().toISOString() } };
  const begun = saveDefenseJournal(checkpoint, body, synthetic);
  const recovered = saveDefenseJournal(checkpoint, recoverDefenseInflight(JSON.parse(readFileSync(checkpoint, "utf8"))), synthetic);
  assert.equal(begun.records.length, 0); assert.equal(recovered.records.length, 1);
  assert.equal(recovered.records[0].classification, "crashed"); assert.equal(recovered.records[0].result, null); assert.equal(recovered.records[0].checks, null);
  assert.equal(shardJobs(freeze.jobs, recovered.shard).slice(recovered.records.length)[0].index, assigned[1].index, "consumed crashed seed is never replayed");
  const duplicate = copy(recovered); duplicate.records.push(duplicate.records[0]); const { sha256: _old, ...dupBody } = duplicate; void _old; duplicate.sha256 = evidenceHash(dupBody);
  assert.throws(() => validateDefenseJournal(duplicate, synthetic), /schedule prefix/);
  const summary = summarizeDefense(recovered.records, freeze);
  assert.equal(summary.crashed, 1); assert.equal(summary.unknownPrivacyChecksAttempts, 1); assert.equal(summary.unknownGuardMetricsAttempts, 1); assert.equal(summary.pairs.incomplete, 160); assert.equal(summary.observedStatisticalGate, false);
  const result: DuelResult = { over: true, winner: "draw", reason: null, moves: 1, turn: 1, damageDealt: 0, damageTaken: 0, guards: { test: 0, baseline: 0 }, stopped: null, stopKind: null, stepMs: [], steps: [], trace: "00000000" };
  assert.equal(classifyDefense(result), "draw"); assert.equal(classifyDefense({ ...result, over: false, winner: null, stopKind: "interrupted", stopped: "fixture" }), "interrupted");
  const forged: DefenseRecord = { ...recovered.records[0], job: { ...freeze.jobs[0], index: 999 } };
  assert.throws(() => summarizeDefense([forged, forged], freeze), /duplicate/);
  console.log("defense-evaluator-899: exact8fixtures/320jobs, fixed-seatRNG, admission/hash refusal, disjointshards, campaign overlap refusal, durableBEGIN recovery and truthful unknown metrics PASS; NO GAMES PLAYED");
} finally { rmSync(directory, { recursive: true, force: true }); if (syntheticCampaign) rmSync(syntheticCampaign, { recursive: true, force: true }); }
