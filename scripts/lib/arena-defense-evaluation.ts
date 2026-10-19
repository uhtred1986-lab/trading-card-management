/** #899 exact historical comparator runner. All execution is opt-in behind a committed freeze. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { canonicalJson } from "../../src/lib/arena/replay-core";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { policyRng } from "../../src/lib/arena/policy/rng";
import { policyTurn, applyDecision } from "../../src/lib/arena/policy/boundary";
import type { Policy } from "../../src/lib/arena/policy/contract";
import type { PolicyEvalManifest } from "../../src/lib/arena/testing/run-manifest";
import { playDuel, wilson, quantile, type DuelResult } from "../verify/arena-policy-duel";
import { permutedFor } from "../verify/arena-policy-permute";
import { externalCheckpointPath, syncCheckpointDirectory } from "./arena-search-checkpoint";
import { evaluationRunnerPin } from "./evaluation-provenance";
import { assertManifest, evidenceHash, policyPin, writeEvidenceFile } from "./policy-evaluation-manifest";
import { beforeDefensePolicy, frozenBaselinePin, assertFrozenBaseline } from "./arena-defense-baseline";
import { byteHash, defenseFixtures, type DefenseFixture } from "./arena-defense-fixtures";
import type { DefenseProtocol, DefenseJob, DefenseFreeze, DefenseJournal, DefenseRecord, DefenseChecks } from "./arena-defense-contract";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const sha = /^[a-f0-9]{64}$/;
const int = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const same = (a: unknown, b: unknown, why: string) => assert.equal(canonicalJson(a), canonicalJson(b), why);
export function validateDefenseProtocol(value: unknown): DefenseProtocol {
  const p = value as DefenseProtocol;
  assert.ok(p && p.format === "arena-defense-protocol-v1" && /^[a-z0-9-]+$/.test(p.id), "unsupported defense protocol");
  assert.match(p.runtimeRevision, /^[a-f0-9]{40}$/); assert.equal(p.deals, 20); assert.equal(p.maxMoves, 3000);
  assert.ok(int(p.policySeedBase) && p.policySeedBase < 2_000_000_000);
  assert.ok(int(p.privacyEvery) && p.privacyEvery > 0 && p.privacyEvery <= 100);
  assert.ok(Array.isArray(p.corpora) && p.corpora.length === 2);
  assert.equal(new Set(p.corpora.map(c => c.key)).size, 2);
  for (const c of p.corpora) {
    assert.match(c.key, /^[a-z0-9-]+$/); assert.ok(typeof c.path === "string" && c.path.length); assert.match(c.sha256, sha);
    assert.ok(c.mode === "compiler" || c.mode === "stored"); assert.ok(Array.isArray(c.decks) && c.decks.length === 2 && c.decks.every(d => typeof d === "string" && d.length));
    assert.notEqual(c.decks[0], c.decks[1]); assert.ok(int(c.seedBase) && c.seedBase < 4_000_000_000);
  }
  assert.ok(p.corpora.some(c => c.mode === "stored") && p.corpora.some(c => c.mode === "compiler"));
  same(p.gate, { pairs: 160, decisivePairs: 20, pairWinCiLowGreaterThan: 0.5, perFixturePairCiUpperAtLeast: 0.5, completionRate: 1, illegal: 0, privacyFailures: 0, guardTrips: 0 }, "undeclared defense gate");
  same(p.baseline, frozenBaselinePin(), "exact historical baseline pin mismatch");
  return p;
}
/** Engine source is fixed separately from the documentation-only freeze commit. */
export function defenseSourcePin(runtime: string): string {
  assert.equal(git("diff", runtime, "--", "src"), "", "declared interpreter source differs from current engine");
  const files = git("ls-files", "--cached", "--others", "--exclude-standard", "--", "scripts", "src", "package.json", "package-lock.json", "tsconfig*.json", "next.config.*").trim().split("\n").filter(Boolean).sort();
  return evidenceHash(files.map(path => ({ path, sha256: byteHash(readFileSync(path)) })));
}
export function defenseSchedule(protocol: DefenseProtocol, fixtures: DefenseFixture[]): DefenseJob[] {
  const jobs: DefenseJob[] = [];
  const deals = new Set<number>();
  for (const [fi, f] of fixtures.entries()) for (let k = 0; k < protocol.deals; k++) {
    const seed = f.seedBase + f.fixtureIndex * 100 + k;
    assert.ok(!deals.has(seed), "holdout engine seed collision"); deals.add(seed);
    const policySeed = protocol.policySeedBase + fi * 100 + k;
    for (const candidateSeat of ["p1", "p2"] as const) jobs.push({ index: jobs.length, key: `${f.key}-${k}-${candidateSeat}`, fixture: f.key, corpus: f.corpus, p1: f.p1, p2: f.p2, k, candidateSeat, seed, policySeed,
      initialPolicyRng: { p1: policyRng(policySeed * 2 + 1), p2: policyRng(policySeed * 2 + 2) } });
  }
  assert.equal(jobs.length, 320); assert.equal(deals.size, 160); return jobs;
}
export async function prepareDefense(protocolPath: string): Promise<{ freeze: DefenseFreeze; fixtures: DefenseFixture[]; protocol: DefenseProtocol }> {
  const bytes = readFileSync(protocolPath), protocol = validateDefenseProtocol(JSON.parse(bytes.toString()));
  assertFrozenBaseline();
  const sourceSha256 = defenseSourcePin(protocol.runtimeRevision);
  const fixtures = await defenseFixtures(protocol);
  const { corpora, ...publicProtocol } = protocol;
  const body = { format: "arena-defense-freeze-v1" as const, protocolSha256: byteHash(bytes), sourceSha256, nodeVersion: process.version,
    fixtures: fixtures.map(f => f.pin), policies: [policyPin("current-typed-heuristic"), frozenBaselinePin()], jobs: defenseSchedule(protocol, fixtures),
    protocol: { ...publicProtocol, corpora: corpora.map(({ path: _path, ...pin }) => { void _path; return pin; }) } };
  same(defenseSourcePin(protocol.runtimeRevision), sourceSha256, "source changed during preparation");
  return { freeze: { ...body, sha256: evidenceHash(body) }, fixtures, protocol };
}
export function classifyDefense(result: DuelResult | null): DefenseRecord["classification"] {
  if (!result) return "crashed";
  if (result.stopKind === "illegal") return "illegal";
  if (result.stopKind === "interrupted") return "interrupted";
  if (result.stopKind === "limit") return "limited";
  if (result.over && result.stopKind === null && result.winner === "draw") return "draw";
  if (result.over && result.stopKind === null && (result.winner === "test" || result.winner === "baseline")) return "completed";
  return "other";
}
const emptyChecks = (): DefenseChecks => ({ sampled: 0, nontrivial: 0, failures: 0, candidateSamples: 0, baselineSamples: 0, candidateNontrivial: 0, baselineNontrivial: 0, purityFailures: 0 });
export const shardJobs = (jobs: DefenseJob[], shard: { index: number; count: number }) => jobs.filter(j => j.index % shard.count === shard.index);
export function validateDefenseJournal(journal: DefenseJournal, freeze: DefenseFreeze): void {
  const { sha256, ...body } = journal; assert.equal(evidenceHash(body), sha256, "journal digest mismatch");
  assert.equal(journal.format, "arena-defense-journal-v1"); assert.equal(journal.freezeSha256, freeze.sha256);
  assert.ok(int(journal.shard?.index) && int(journal.shard.count) && journal.shard.count > 0 && journal.shard.count <= 16 && journal.shard.index < journal.shard.count);
  const scheduled = shardJobs(freeze.jobs, journal.shard);
  assert.ok(Array.isArray(journal.records) && journal.records.length <= scheduled.length);
  assert.match(journal.requestId, /^[a-f0-9-]{36}$/);
  for (const [i, record] of journal.records.entries()) {
    same(record.job, scheduled[i], "journal is not an exact unique consumed schedule prefix");
    assert.equal(classifyDefense(record.result), record.classification, "inconsistent attempt classification");
    if (record.result === null) assert.ok(record.classification === "crashed" && typeof record.errorSha256 === "string" && sha.test(record.errorSha256));
    else {
      assert.equal(record.errorSha256, null);
      const r = record.result;
      assert.ok([r.moves, r.turn, r.damageDealt, r.damageTaken, r.guards?.test, r.guards?.baseline].every(int));
      assert.ok(typeof r.over === "boolean" && [null, "test", "baseline", "draw"].includes(r.winner));
      assert.ok([null, "illegal", "interrupted", "notAsked", "limit", "noSeat"].includes(r.stopKind));
      assert.ok(r.over ? r.winner !== null && r.stopKind === null && r.stopped === null : r.winner === null && r.stopKind !== null);
      assert.ok(Array.isArray(r.steps) && Array.isArray(r.stepMs) && r.stepMs.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)); assert.match(r.trace, /^[a-f0-9]{8}$/);
    }
    if (record.checks) {
      const c = record.checks; assert.ok(Object.values(c).every(int));
      assert.equal(c.sampled, c.candidateSamples + c.baselineSamples); assert.equal(c.nontrivial, c.candidateNontrivial + c.baselineNontrivial); assert.ok(c.nontrivial <= c.sampled && c.failures <= c.sampled && c.purityFailures <= c.failures);
    } else assert.equal(record.result, null, "missing checks only allowed for a begun attempt without durable completion");
  }
  if (journal.inflight) { same(journal.inflight.job, scheduled[journal.records.length], "inflight marker does not name next scheduled job"); assert.ok(Number.isFinite(Date.parse(journal.inflight.startedAt))); }
}
/** Atomic per-attempt journal, reusing the existing checkpoint path and directory fsync guards. */
export function saveDefenseJournal(path: string, body: Omit<DefenseJournal, "sha256">, freeze: DefenseFreeze): DefenseJournal {
  const value = { ...body, sha256: evidenceHash(body) }; validateDefenseJournal(value, freeze);
  const target = externalCheckpointPath(path), temporary = `${target}.tmp-${randomUUID()}`;
  let fd: number | null = null;
  try { fd = openSync(temporary, "wx", 0o600); writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); closeSync(fd); fd = null; renameSync(temporary, target); syncCheckpointDirectory(target); }
  finally { if (fd !== null) closeSync(fd); if (existsSync(temporary)) unlinkSync(temporary); }
  return value;
}
/** A begun attempt is consumed even if the process died before its result was saved. */
export function recoverDefenseInflight(journal: DefenseJournal): Omit<DefenseJournal, "sha256"> {
  const { sha256: _digest, ...body } = journal; void _digest;
  return !body.inflight ? body : { ...body, records: [...body.records, { job: body.inflight.job, classification: "crashed", result: null,
    errorSha256: evidenceHash("Begun attempt has no durable completion; seed consumed, never replayed."), checks: null }], inflight: null };
}
function gameCounts(records: DefenseRecord[]) {
  const counts = { attempted: records.length, completed: 0, draws: 0, wins: 0, losses: 0, illegal: 0, interrupted: 0, limited: 0, crashed: 0, other: 0, privacyFailures: 0, guardTrips: 0, unknownPrivacyChecksAttempts: 0, unknownGuardMetricsAttempts: 0, candidateSamples: 0, baselineSamples: 0, nontrivial: 0, candidateNontrivial: 0, baselineNontrivial: 0, purityFailures: 0 };
  for (const row of records) {
    if (row.classification === "completed" || row.classification === "draw") counts.completed++;
    if (row.classification === "draw") counts.draws++;
    if (["illegal", "interrupted", "limited", "crashed", "other"].includes(row.classification)) counts[row.classification as "illegal"]++;
    if (row.result?.winner === "test") counts.wins++; if (row.result?.winner === "baseline") counts.losses++;
    counts.privacyFailures += row.checks?.failures ?? 0;
    if (row.checks === null) counts.unknownPrivacyChecksAttempts++;
    if (row.result === null) counts.unknownGuardMetricsAttempts++;
    counts.candidateSamples += row.checks?.candidateSamples ?? 0; counts.baselineSamples += row.checks?.baselineSamples ?? 0;
    counts.nontrivial += row.checks?.nontrivial ?? 0; counts.candidateNontrivial += row.checks?.candidateNontrivial ?? 0;
    counts.baselineNontrivial += row.checks?.baselineNontrivial ?? 0; counts.purityFailures += row.checks?.purityFailures ?? 0;
    counts.guardTrips += (row.result?.guards.test ?? 0) + (row.result?.guards.baseline ?? 0);
  }
  return { ...counts, decided: counts.wins + counts.losses, winCi95: wilson(counts.wins, counts.wins + counts.losses), completionCi95: wilson(counts.completed, counts.attempted) };
}
function pairsOf(records: DefenseRecord[], jobs: DefenseJob[]) {
  const pairs = { planned: jobs.length / 2, wonBoth: 0, lostBoth: 0, split: 0, draw: 0, incomplete: 0 };
  for (const first of jobs.filter(j => j.candidateSeat === "p1")) {
    const pair = records.filter(r => r.job.fixture === first.fixture && r.job.k === first.k);
    if (pair.length !== 2 || pair.some(r => r.classification !== "completed" && r.classification !== "draw")) pairs.incomplete++;
    else if (pair.some(r => r.result?.winner === "draw")) pairs.draw++;
    else if (pair.every(r => r.result?.winner === "test")) pairs.wonBoth++;
    else if (pair.every(r => r.result?.winner === "baseline")) pairs.lostBoth++;
    else pairs.split++;
  }
  const decisive = pairs.wonBoth + pairs.lostBoth;
  return { ...pairs, decisive, insufficientPower: decisive < 20, winCi95: wilson(pairs.wonBoth, decisive) };
}
export function summarizeDefense(records: DefenseRecord[], freeze: DefenseFreeze) {
  assert.equal(new Set(records.map(r => r.job.index)).size, records.length, "duplicate consumed attempts");
  const total = gameCounts(records), pairs = pairsOf(records, freeze.jobs);
  const fixtures = freeze.fixtures.map(f => ({ key: f.key, ...gameCounts(records.filter(r => r.job.fixture === f.key)), pairs: pairsOf(records.filter(r => r.job.fixture === f.key), freeze.jobs.filter(j => j.fixture === f.key)) }));
  const recipes = [...new Set(freeze.jobs.flatMap(j => [j.p1, j.p2]))];
  const archetypes = recipes.map(recipe => ({ recipe, ...gameCounts(records.filter(r => (r.job.candidateSeat === "p1" ? r.job.p1 : r.job.p2) === recipe)),
    matchupPairsInvolvingRecipe: pairsOf(records.filter(r => r.job.p1 === recipe || r.job.p2 === recipe), freeze.jobs.filter(j => j.p1 === recipe || j.p2 === recipe)),
    inference: "Game-wise interval is descriptive. Paired interval covers matchups involving this recipe, not an isolated deck causal effect." }));
  const seats = (["p1", "p2"] as const).map(seat => ({ seat, ...gameCounts(records.filter(r => r.job.candidateSeat === seat)) }));
  const nodeStepMs = records.flatMap(r => r.result?.steps.map(s => s.ms) ?? []);
  const gate = records.length === 320 && total.completed === 320 && !total.illegal && !total.privacyFailures && !total.crashed && !total.guardTrips && total.candidateNontrivial > 0 && total.baselineNontrivial > 0 && pairs.decisive >= freeze.protocol.gate.decisivePairs
    && pairs.winCi95[0] > .5 && fixtures.every(f => f.pairs.winCi95[1] >= .5);
  return { plannedGames: 320, plannedPairs: 160, ...total, pairs, fixtures, archetypes, seats,
    nodeWholeStepMs: { n: nodeStepMs.length, p95: quantile(nodeStepMs, .95), max: nodeStepMs.length ? nodeStepMs.reduce((a, b) => Math.max(a, b), 0) : null },
    observedStatisticalGate: gate, workerEvidence: "required separately; no Node measurement establishes Worker latency/memory gates", difficultyEnabled: false, promotion: false,
    limits: "Paired game observations are dependent. Game-wise Wilson intervals are descriptive; paired decisive intervals are the strength criterion. Life-depletion fields include skill costs and are not formal damage-event counts." };
}
function manifestOf(records: DefenseRecord[], freeze: DefenseFreeze, runner: DefenseJournal["runner"], requestId: string): PolicyEvalManifest {
  assert.ok(records.every(r => r.result !== null), "cannot invent import metrics for crashed attempts; retain private report/journal");
  const manifest: PolicyEvalManifest = { version: 1, source: "policy_eval", requestId, runner: { ...runner, id: "arena-policy-eval" }, seedSet: "holdout",
    protocol: { id: freeze.protocol.id, revision: freeze.sha256 }, fixtures: freeze.fixtures, policies: freeze.policies,
    results: records.map(row => { const r = row.result!, j = row.job; const other = j.candidateSeat === "p1" ? "p2" : "p1";
      return { key: j.key, kind: "policy_game", fixtureKey: j.fixture, candidatePolicyKey: freeze.policies[0].key, baselinePolicyKey: freeze.policies[1].key,
        seedIndex: j.k, seed: j.seed, candidateSeat: j.candidateSeat, initialPolicyRng: { p1: { mode: "seeded", ...j.initialPolicyRng.p1 }, p2: { mode: "seeded", ...j.initialPolicyRng.p2 } },
        outcome: r.winner === "test" ? "win" : r.winner === "baseline" ? "loss" : r.winner === "draw" ? "draw" : r.stopKind === "illegal" ? "illegal" : r.stopKind === "limit" ? "limit" : "interrupted",
        winner: r.winner === "test" ? j.candidateSeat : r.winner === "baseline" ? other : null, moves: r.moves, turn: r.turn, damageDealt: r.damageDealt, damageTaken: r.damageTaken,
        guardTrips: r.guards.test + r.guards.baseline, stopKind: r.stopKind, reportedCostMicros: 0, evidenceSha256: evidenceHash(row) };
    }) };
  assertManifest(manifest); return manifest;
}

/** One immutable campaign identity and one path per shard, across all local processes. */
export async function reserveDefenseCampaign(freeze: DefenseFreeze, runner: DefenseJournal["runner"], shard: DefenseJournal["shard"], checkpoint: string): Promise<string> {
  const directory = resolve(tmpdir(), `arena-defense-campaign-${freeze.sha256}`);
  const metadata = resolve(directory, "campaign.json");
  const reservation = { freezeSha256: freeze.sha256, runner, count: shard.count };
  let owner = false;
  try { mkdirSync(directory, { mode: 0o700 }); owner = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  if (owner) {
    const temporary = externalCheckpointPath(resolve(directory, `campaign-${randomUUID()}.tmp`));
    const fd = openSync(temporary, "wx", 0o600); writeFileSync(fd, JSON.stringify({ ...reservation, requestId: randomUUID() })); fsyncSync(fd); closeSync(fd);
    renameSync(temporary, metadata); syncCheckpointDirectory(metadata);
  }
  const readReady = async (path: string) => {
    for (let i = 0; i < 100; i++) {
      try { return JSON.parse(readFileSync(path, "utf8")); } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
        await new Promise(done => setTimeout(done, 25));
      }
    }
    throw new Error("campaign reservation was not published; inspect private registry before retry");
  };
  const campaign = await readReady(metadata);
  same({ freezeSha256: campaign.freezeSha256, runner: campaign.runner, count: campaign.count }, reservation, "campaign source or shard-count conflict");
  assert.match(campaign.requestId, /^[a-f0-9-]{36}$/);
  const slot = externalCheckpointPath(resolve(directory, `shard-${shard.index}.json`));
  const claim = { index: shard.index, checkpoint: externalCheckpointPath(checkpoint) };
  try { const fd = openSync(slot, "wx", 0o600); writeFileSync(fd, JSON.stringify(claim)); fsyncSync(fd); closeSync(fd); syncCheckpointDirectory(slot); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; same(await readReady(slot), claim, "shard already reserved at another checkpoint; overlapping consumption refused"); assert.ok(existsSync(claim.checkpoint), "reserved checkpoint is missing; refuse to replay potentially consumed seeds"); }
  return campaign.requestId;
}

function lockJournal(path: string): () => void {
  const lock = externalCheckpointPath(`${path}.lock`);
  if (existsSync(lock)) {
    const previous = JSON.parse(readFileSync(lock, "utf8")) as { pid: number };
    assert.ok(int(previous.pid) && previous.pid > 0, "malformed journal lock; inspect privately");
    let alive = true; try { process.kill(previous.pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ESRCH") alive = false; else throw e; }
    assert.equal(alive, false, "another process owns this journal"); unlinkSync(lock);
  }
  const fd = openSync(lock, "wx", 0o600); writeFileSync(fd, JSON.stringify({ pid: process.pid })); fsyncSync(fd); closeSync(fd);
  return () => { if (existsSync(lock)) unlinkSync(lock); };
}
function readJournal(path: string, freeze: DefenseFreeze): DefenseJournal {
  const journal = JSON.parse(readFileSync(path, "utf8")) as DefenseJournal; validateDefenseJournal(journal, freeze); return journal;
}
function assertCommittedFreeze(path: string): void {
  const top = git("rev-parse", "--show-toplevel").trim();
  const relative = resolve(path).slice(top.length + 1);
  assert.ok(resolve(path).startsWith(`${top}/`), "execution freeze must be committed in this checkout");
  git("ls-files", "--error-unmatch", "--", relative);
  assert.equal(git("diff", "HEAD", "--", relative), "", "freeze is not committed unchanged");
}
/** Every game attempt, including runtime crashes, has a durable BEGIN before any match is created. */
async function executeDefense(prepared: Awaited<ReturnType<typeof prepareDefense>>, checkpoint: string, shard: DefenseJournal["shard"]): Promise<DefenseJournal> {
  const { freeze, fixtures, protocol } = prepared;
  const runner = evaluationRunnerPin("arena-policy-eval", "defense-899-v1");
  assert.equal(runner.dirtyTreeSha256, null, "holdouts require a clean committed checkout");
  const assertSource = () => same(evaluationRunnerPin("arena-policy-eval", "defense-899-v1"), runner, "source changed during holdouts; begun attempt remains consumed");
  const requestId = await reserveDefenseCampaign(freeze, runner, shard, checkpoint);
  const unlock = lockJournal(checkpoint);
  try {
    let journal: DefenseJournal;
    if (existsSync(checkpoint)) {
      journal = readJournal(checkpoint, freeze); assert.equal(journal.requestId, requestId, "resume campaign request mismatch"); same(journal.runner, runner, "resume source/HEAD mismatch"); same(journal.shard, shard, "resume shard mismatch");
      assertSource(); journal = saveDefenseJournal(checkpoint, recoverDefenseInflight(journal), freeze);
    } else {
      assertSource(); journal = saveDefenseJournal(checkpoint, { format: "arena-defense-journal-v1", requestId, freezeSha256: freeze.sha256, runner, shard, records: [], inflight: null }, freeze);
    }
    const candidate = localPolicy(), baseline = beforeDefensePolicy(), assigned = shardJobs(freeze.jobs, shard);
    for (const job of assigned.slice(journal.records.length)) {
      assertSource();
      const { sha256: _old, ...body } = journal; void _old;
      journal = saveDefenseJournal(checkpoint, { ...body, inflight: { job, startedAt: new Date().toISOString() } }, freeze);
      assertSource();
      const fixture = fixtures.find(f => f.key === job.fixture)!;
      const checks = emptyChecks(), seen = { p1: 0, p2: 0 };
      let result: DuelResult | null = null, errorSha256: string | null = null;
      try {
        result = await playDuel({ bundle: fixture.bundle, interpreterRevision: protocol.runtimeRevision, gameSeed: job.seed, policySeed: job.policySeed,
          testSeat: job.candidateSeat, test: candidate, baseline, maxMoves: protocol.maxMoves,
          observe: (match, actor, revision) => {
            if (seen[actor]++ % protocol.privacyEvery) return;
            checks.sampled++; if (actor === job.candidateSeat) checks.candidateSamples++; else checks.baselineSamples++;
            try {
              const twin = permutedFor(match, actor, revision + 899);
              if (canonicalJson(twin.state) !== canonicalJson(match.state)) {
                checks.nontrivial++; if (actor === job.candidateSeat) checks.candidateNontrivial++; else checks.baselineNontrivial++;
              }
              const original = policyTurn(match, actor, revision), maskedTwin = policyTurn(twin, actor, revision);
              same(original.input, maskedTwin.input, "privacy input mismatch");
              const policy: Policy = actor === job.candidateSeat ? candidate : baseline;
              const rng = policyRng(1_899_000 + revision * 2 + (actor === "p2" ? 1 : 0));
              const inputBefore = evidenceHash(original.input), twinBefore = evidenceHash(maskedTwin.input), rngBefore = evidenceHash(rng);
              const answer = policy(original.input, rng), twinAnswer = policy(maskedTwin.input, rng);
              if (evidenceHash(original.input) !== inputBefore || evidenceHash(maskedTwin.input) !== twinBefore || evidenceHash(rng) !== rngBefore) { checks.purityFailures++; throw new Error("policy mutated masked input or supplied RNG"); }
              same(answer, twinAnswer, "privacy answer/RNG mismatch");
              assert.ok(applyDecision(match, original.key, answer.answer).ok, "privacy sample answer does not play");
              assert.ok(applyDecision(twin, maskedTwin.key, twinAnswer.answer).ok, "privacy sample answer does not play on twin");
            } catch (error) { checks.failures++; throw error; }
          } });
      } catch (error) { errorSha256 = evidenceHash(String(error)); }
      assertSource();
      const record: DefenseRecord = { job, classification: classifyDefense(result), result, errorSha256, checks };
      const { sha256: _digest, ...current } = journal; void _digest;
      journal = saveDefenseJournal(checkpoint, { ...current, records: [...journal.records, record], inflight: null }, freeze);
      console.log(`${job.key}: ${record.classification}; ${journal.records.length}/${assigned.length} consumed attempts in shard ${shard.index}/${shard.count}`);
    }
    assertSource(); return journal;
  } finally { unlock(); }
}
function parseShard(value: string): DefenseJournal["shard"] {
  assert.match(value, /^\d+\/\d+$/); const [index, count] = value.split("/").map(Number);
  assert.ok(int(index) && int(count) && count > 0 && count <= 16 && index < count, "--shard is zero-based I/N with 0<=I<N<=16"); return { index, count };
}
function reportOf(records: DefenseRecord[], freeze: DefenseFreeze, runner: DefenseJournal["runner"], requestId: string) {
  for (const r of records) same(r.job, freeze.jobs[r.job.index], "aggregate record is not a frozen job");
  return { format: "arena-defense-report-v1", requestId, runner, freezeSha256: freeze.sha256, protocol: freeze.protocol, summary: summarizeDefense(records, freeze), records };
}
export async function defenseEvaluationMain(args: string[]): Promise<void> {
  const values = new Set(["--defense-protocol", "--freeze", "--checkpoint", "--out", "--manifest-out", "--shard", "--merge"]);
  const switches = new Set(["--prepare", "--check-protocol", "--run"]);
  const parsed = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i]; assert.ok(values.has(key) || switches.has(key), `unknown defense flag ${key}`); assert.ok(!parsed.has(key), `duplicate flag ${key}`);
    if (values.has(key)) { const value = args[++i]; assert.ok(value && !value.startsWith("--"), `${key} needs a value`); parsed.set(key, value); } else parsed.set(key, "true");
  }
  const protocolPath = parsed.get("--defense-protocol"); assert.ok(protocolPath);
  if (parsed.has("--manifest-out")) assert.ok(parsed.has("--merge"), "manifest export is only available in final --merge mode");
  assert.equal(["--prepare", "--check-protocol", "--run", "--merge"].filter(k => parsed.has(k)).length, 1, "choose exactly one defense mode");
  const prepared = await prepareDefense(protocolPath), { freeze } = prepared;
  if (parsed.has("--prepare")) {
    const target = parsed.get("--freeze"); assert.ok(target, "--prepare needs --freeze public-artifact.json");
    assert.ok(target.endsWith(".json"), "freeze output must be JSON");
    const relative = resolve(target).slice(resolve(process.cwd()).length + 1);
    assert.ok(!relative.startsWith("src/") && !relative.startsWith("scripts/") && !["package.json", "package-lock.json", "tsconfig.json"].includes(relative), "freeze cannot overwrite executable source/configuration");
    assert.ok(prepared.protocol.corpora.every(c => resolve(c.path) !== resolve(target)), "freeze cannot overwrite corpus bytes");
    assert.notEqual(resolve(target), resolve(protocolPath), "freeze cannot overwrite protocol");
    writeEvidenceFile(target, `${JSON.stringify(freeze, null, 2)}\n`); console.log(`Prepared ${freeze.jobs.length} jobs, ${freeze.fixtures.length} fixtures; NO GAMES PLAYED. Freeze ${freeze.sha256}`); return;
  }
  if (parsed.has("--check-protocol")) {
    const path = parsed.get("--freeze"); if (path) same(JSON.parse(readFileSync(path, "utf8")), freeze, "freeze/source/protocol mismatch");
    console.log(`Validated ${freeze.jobs.length} fixed jobs; NO GAMES PLAYED. Freeze ${freeze.sha256}`); return;
  }
  const freezePath = parsed.get("--freeze"); assert.ok(freezePath, "execution/aggregation needs --freeze committed-artifact.json");
  assertCommittedFreeze(freezePath); same(JSON.parse(readFileSync(freezePath, "utf8")), freeze, "committed freeze/source/protocol mismatch");
  const source = evaluationRunnerPin("arena-policy-eval", "defense-899-v1"); assert.equal(source.dirtyTreeSha256, null, "require clean committed source before execution/aggregation");
  const output = parsed.get("--out"); assert.ok(output, "--run/--merge needs private --out report");
  const paths = [output, parsed.get("--manifest-out"), parsed.get("--checkpoint")].filter((p): p is string => !!p).map(p => externalCheckpointPath(p));
  assert.equal(new Set(paths).size, paths.length, "checkpoint/report/manifest paths must differ");
  const inputPaths = [protocolPath, freezePath, ...prepared.protocol.corpora.map(c => c.path), ...(parsed.get("--merge")?.split(",") ?? [])].map(p => resolve(p));
  assert.ok(paths.every(p => !inputPaths.includes(p)), "output cannot overwrite input evidence");
  let journals: DefenseJournal[];
  if (parsed.has("--run")) {
    const checkpoint = parsed.get("--checkpoint"); assert.ok(checkpoint, "--run needs private --checkpoint");
    journals = [await executeDefense(prepared, externalCheckpointPath(checkpoint), parseShard(parsed.get("--shard") ?? "0/1"))];
  } else {
    assert.ok(!parsed.has("--checkpoint") && !parsed.has("--shard"));
    const inputs = parsed.get("--merge")!.split(","); assert.equal(new Set(inputs.map(p => resolve(p))).size, inputs.length);
    journals = inputs.map(path => { const j = readJournal(externalCheckpointPath(path), freeze); same(j.runner, source, "aggregate source differs from journal"); assert.equal(j.inflight, null, "unfinished BEGIN must be recovered by its shard before aggregation"); return j; });
    assert.ok(journals.length); const count = journals[0].shard.count;
    assert.equal(journals.length, count, "aggregate requires every shard"); assert.equal(new Set(journals.map(j => j.shard.index)).size, count);
    assert.ok(journals.every(j => j.shard.count === count), "shard counts disagree");
  }
  const records = journals.flatMap(j => j.records).sort((a, b) => a.job.index - b.job.index);
  same(evaluationRunnerPin("arena-policy-eval", "defense-899-v1"), source, "source changed before report output");
  assert.equal(new Set(journals.map(j => j.requestId)).size, 1, "journals belong to different campaigns");
  const requestId = journals[0].requestId;
  const report = reportOf(records, freeze, source, requestId);
  writeEvidenceFile(externalCheckpointPath(output), `${JSON.stringify(report, null, 2)}\n`);
  const manifestPath = parsed.get("--manifest-out");
  if (manifestPath) assert.ok(parsed.has("--merge"), "manifest export is only available in final --merge mode");
  if (manifestPath) {
    assert.equal(records.length, 320, "manifest export requires all 320 consumed attempts");
    const manifest = manifestOf(records, freeze, source, requestId); writeEvidenceFile(externalCheckpointPath(manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  console.log(JSON.stringify(report.summary));
  if (records.some(r => !["completed", "draw"].includes(r.classification) || (r.checks?.failures ?? 0) > 0 || (r.result?.guards.test ?? 0) + (r.result?.guards.baseline ?? 0) > 0)) process.exitCode = 1;
}
