/** Persistent testing portal, on real generated migrations and PGlite only.
 * Covers CAS, request replay/conflicts, DB constraints, honest seat denominators,
 * model provenance, interrupted legacy outcomes and actual-deck flag migration.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { ensureTestingCatalog, getImportedEvaluationRunDetail, getTestingDashboard, importEvaluationRun, listImportedEvaluationRuns, recordTestingMatch, setDeckTesting, updateTestingDeck, updateTestingScenario, serverTestingStats } from "../../src/lib/arena/testing/store.ts";
import { TESTING_DECK_CATALOG, TESTING_SCENARIO_CATALOG } from "../../src/lib/arena/testing/catalog.ts";
import { aggregateMatches, type StatsMatch } from "../../src/lib/arena/testing/stats.ts";
import { getDeck, listDecks } from "../../src/lib/decks/queries.ts";
import type { RecordTestingMatchInput } from "../../src/lib/arena/testing/types.ts";

const digest = "a".repeat(64);
const runBase = {
  version: 1 as const,
  requestId: "20000000-0000-4000-8000-000000000001",
  runner: { id: "arena-scenario" as const, version: "1", gitCommit: "b".repeat(40), dirtyTreeSha256: null },
  protocol: { id: "scenario-v1", revision: "c".repeat(40) },
  fixtures: [{ key: "fixture-a", sourceId: "fixture-1", runtimeRevision: null, bundleSha256: digest,
    rulesSha256: digest, catalogSha256: null, programsSha256: digest, p1DeckSha256: null, p2DeckSha256: null,
    p1RecipeId: null, p2RecipeId: null }],
  policies: [],
  source: "scenario" as const,
  results: [{ key: "setup", kind: "scenario_case" as const, fixtureKey: "fixture-a", sourceScenarioId: "setup",
    portalScenarioId: "family-01-awaken", seed: 1, seat: "p1" as const, outcome: "pass" as const,
    steps: 10, differenceCount: 0, browserAgreement: true, evidenceSha256: digest }],
};

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "arena-testing-db-"));
let client = new PGlite(directory);
let db = drizzle(client, { schema }) as unknown as Db;
try {
  for (const file of fs.readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()) {
    if (file.startsWith("0052_")) await client.exec("insert into decks(name) values ('Existing normal deck')");
    for (const statement of fs.readFileSync(path.join("drizzle", file), "utf8").split("--> statement-breakpoint")) if (statement.trim()) await client.exec(statement);
  }
  const [normal] = await db.select().from(schema.decks);
  assert.equal(normal.isTesting, false, "migration preserves existing ordinary deck");
  const [fresh] = await db.insert(schema.decks).values({ name: "Fresh normal deck" }).returning();
  assert.equal(fresh.isTesting, false);
  assert.equal(await setDeckTesting(db, fresh.id, true), true);
  assert.equal(await setDeckTesting(db, 99999, true), false);
  assert.equal((await db.select().from(schema.decks).where(eq(schema.decks.id, fresh.id)))[0].isTesting, true);
  assert.equal((await listDecks(db)).find((d) => d.id === fresh.id)!.isTesting, true, "normal deck list projects the flag without globally hiding test decks");
  assert.equal((await getDeck(db, fresh.id))!.isTesting, true);
  await client.exec("begin read only");
  const first = await getTestingDashboard(db);
  await client.exec("commit");
  assert.equal(first.decks.length, 64);
  assert.equal(first.decks.filter((d) => d.firstWave).length, 16);
  assert.equal(first.scenarios.length, 55);
  assert.ok(first.decks.every((d) => d.status === "planned" && d.linkedDeckId === null));
  assert.ok(first.scenarios.every((d) => d.status === "planned"));
  assert.equal(first.recordedStats.matches.games, 0);
  const deck = first.decks[0]; const scenario = first.scenarios[0];
  const imported = await importEvaluationRun(db, runBase);
  assert.ok(imported.ok && !imported.replayed, "first manifest import writes one immutable run");
  const duplicateImport = await importEvaluationRun(db, { ...runBase, results: runBase.results.map((row) => ({ ...row })) });
  assert.ok(duplicateImport.ok && duplicateImport.replayed, "same request ID/content is idempotent despite object key ordering");
  assert.deepEqual(await importEvaluationRun(db, { ...runBase, protocol: { ...runBase.protocol, revision: "d".repeat(40) } }), { ok: false, reason: "idempotency_conflict" });
  assert.equal((await db.select().from(schema.arenaTestingRunResults)).length, 1, "a retry cannot duplicate result rows");
  assert.equal((await getTestingDashboard(db)).scenarios.find((row) => row.id === "family-01-awaken")!.status, "planned", "imported evidence never auto-passes portal progress");
  const gameRun = {
    ...runBase, requestId: "20000000-0000-4000-8000-000000000002", source: "policy_eval" as const,
    runner: { ...runBase.runner, id: "arena-policy-eval" as const }, seedSet: "dev" as const,
    policies: [{ key: "candidate", version: "search-v2-d2", sha256: digest }, { key: "baseline", version: "heuristic-v1", sha256: digest }],
    results: [null, 0].map((reportedCostMicros, index) => ({ key: `game-${index}`, kind: "policy_game" as const, fixtureKey: "fixture-a",
      candidatePolicyKey: "candidate", baselinePolicyKey: "baseline", seedIndex: index, seed: 641 + index, candidateSeat: "p1" as const,
      initialPolicyRng: { p1: { mode: "deterministic" as const, v: null, seed: null, n: null }, p2: { mode: "seeded" as const, v: 1 as const, seed: 642, n: index } },
      outcome: index === 0 ? "win" as const : "draw" as const, winner: index === 0 ? "p1" as const : null, moves: 20, turn: 5,
      damageDealt: 4, damageTaken: 2, guardTrips: 0, stopKind: null, reportedCostMicros, evidenceSha256: digest })),
  };
  const importedGames = await importEvaluationRun(db, gameRun);
  assert.ok(importedGames.ok && !importedGames.replayed);
  if (importedGames.ok) {
    const policyDetail = await getImportedEvaluationRunDetail(db, importedGames.runId);
    assert.equal(policyDetail?.source, "policy_eval");
    assert.equal(policyDetail?.policies[0].version, "search-v2-d2");
    assert.equal(policyDetail?.results[0].kind, "policy_game");
  }
  const importHistory = await listImportedEvaluationRuns(db);
  const gameHistory = importHistory.find((row) => row.requestId === gameRun.requestId)!;
  assert.equal(gameHistory.policyGames, 2);
  assert.equal(gameHistory.pricedPolicyGames, 1, "unknown cost remains distinct from explicitly free");
  assert.equal(gameHistory.reportedCostMicros, 0);
  const savedGameRun = (await db.select().from(schema.arenaTestingRuns).where(eq(schema.arenaTestingRuns.requestId, gameRun.requestId)))[0];
  assert.deepEqual(savedGameRun.manifest.policies.map((policy) => policy.key), ["candidate", "baseline"]);
  const savedGameResults = await db.select().from(schema.arenaTestingRunResults).where(eq(schema.arenaTestingRunResults.runId, savedGameRun.id));
  assert.equal(savedGameResults[0].payload.kind, "policy_game");
  if (savedGameResults[0].payload.kind === "policy_game") {
    assert.equal(savedGameResults[0].payload.initialPolicyRng.p1.mode, "deterministic");
    assert.equal(savedGameResults[0].payload.seed, 641);
    assert.equal(savedGameResults[0].payload.reportedCostMicros, null, "unknown cost is preserved in the immutable result");
  }
  const explicitlyFree = savedGameResults.find((row) => row.resultKey === "game-1")!;
  assert.equal(explicitlyFree.payload.kind === "policy_game" ? explicitlyFree.payload.reportedCostMicros : null, 0, "$0 stays explicitly free in stored results");
  const appendOnlyError = (error: unknown) => error instanceof Error && (error.message.includes("append-only") || error.cause instanceof Error && error.cause.message.includes("append-only"));
  await assert.rejects(() => db.update(schema.arenaTestingRuns).set({ runnerVersion: "changed" }).where(eq(schema.arenaTestingRuns.id, savedGameRun.id)), appendOnlyError);
  await assert.rejects(() => db.delete(schema.arenaTestingRunResults).where(eq(schema.arenaTestingRunResults.id, savedGameResults[0].id)), appendOnlyError);
  const scenarioHistory = importHistory.find((row) => row.requestId === runBase.requestId)!;
  assert.equal(scenarioHistory.unpinnedFixtures, 1, "unavailable runtime revision stays visibly unpinned");
  assert.equal(scenarioHistory.mappedScenarioResults, 1, "catalog mapping is explicit and queryable");
  const bulkRun = { ...runBase, requestId: "20000000-0000-4000-8000-000000000003",
    results: Array.from({ length: 250 }, (_, index) => ({ ...runBase.results[0], key: `setup-${index}`, portalScenarioId: null })) };
  const importedBulk = await importEvaluationRun(db, bulkRun);
  assert.ok(importedBulk.ok);
  const afterBulk = await listImportedEvaluationRuns(db);
  assert.ok(afterBulk.every((row) => row.resultPreviews.length > 0), "each recent run retains a preview when a newer bulk run has many rows");
  assert.equal(afterBulk.find((row) => row.requestId === bulkRun.requestId)!.resultPreviews.length, 5, "large runs are bounded to five preview rows");
  if (importedBulk.ok) {
    const pageTen = await getImportedEvaluationRunDetail(db, importedBulk.runId, { page: 10, outcome: "pass", fixtureKey: "fixture-a" });
    assert.equal(pageTen?.totalMatches, 250);
    assert.equal(pageTen?.page, 10);
    assert.equal(pageTen?.results.length, 25);
    assert.equal(pageTen?.fixtureTotals[0].count, 250, "detail view carries per-fixture outcome counts independently of filters");
    assert.equal(await getImportedEvaluationRunDetail(db, importedBulk.runId, { fixtureKey: "missing" }), null);
  }
  const badScenarioMapping = { ...runBase, requestId: "20000000-0000-4000-8000-000000000004",
    results: runBase.results.map((row) => ({ ...row, portalScenarioId: "not-a-catalog-scenario" })) };
  assert.deepEqual(await importEvaluationRun(db, badScenarioMapping), { ok: false, reason: "invalid", detail: "Manifest references an unknown portal scenario ID." });
  const badRecipeMapping = { ...runBase, requestId: "20000000-0000-4000-8000-000000000005",
    fixtures: runBase.fixtures.map((fixture) => ({ ...fixture, p1RecipeId: "not-a-catalog-recipe" })) };
  assert.deepEqual(await importEvaluationRun(db, badRecipeMapping), { ok: false, reason: "invalid", detail: "Manifest references an unknown portal recipe ID." });
  assert.equal((await db.select().from(schema.arenaTestingRuns)).length, 3, "invalid catalog references create no run or result rows");
  const update = { id: deck.id, expectedVersion: 0, status: "in_progress" as const, note: "First real test", evidence: "", linkedDeckId: fresh.id };
  const outcomes = await Promise.all([updateTestingDeck(db, update), updateTestingDeck(db, { ...update, note: "A stale competing edit" })]);
  assert.equal(outcomes.filter((o) => o.ok).length, 1, "one CAS writer wins");
  assert.equal(outcomes.filter((o) => !o.ok && o.reason === "conflict").length, 1);
  assert.deepEqual(await updateTestingScenario(db, { id: "missing", expectedVersion: 0, status: "planned", note: "", evidence: "" }), { ok: false, reason: "not_found" });
  assert.ok((await updateTestingScenario(db, { id: scenario.id, expectedVersion: 0, status: "failed", note: "Known rule failure", evidence: "fixture:WC-R01" })).ok);
  await assert.rejects(() => updateTestingScenario(db, { id: scenario.id, expectedVersion: 1, status: "passed", note: "", evidence: " " }), /evidence/);
  const p1 = TESTING_DECK_CATALOG[0].id; const p2 = TESTING_DECK_CATALOG[1].id;
  const match: RecordTestingMatchInput = {
    requestId: "10000000-0000-4000-8000-000000000001", p1DeckId: p1, p2DeckId: p2,
    p1: { kind: "local_ai", name: "Frozen heuristic", model: "main1+combat1+choices1" },
    p2: { kind: "opus", name: "Opus", model: "claude-opus-4-6" },
    outcome: "win", winner: "p1", seed: 42, rulesRevision: "fixture-v1", evidence: "replay:actual-1", note: "Manually recorded", reportedCostMicros: null,
  };
  const recorded = await recordTestingMatch(db, match);
  assert.ok(recorded.ok && !recorded.replayed);
  const retry = await recordTestingMatch(db, match);
  assert.ok(retry.ok && retry.replayed);
  if (recorded.ok && retry.ok) assert.equal(retry.value.id, recorded.value.id);
  assert.deepEqual(await recordTestingMatch(db, { ...match, winner: "p2" }), { ok: false, reason: "idempotency_conflict" });
  await assert.rejects(() => recordTestingMatch(db, { ...match, outcome: "draw", winner: "p1" }), /winner/);
  await assert.rejects(() => recordTestingMatch(db, { ...match, winner: null }), /winner/);
  await assert.rejects(() => recordTestingMatch(db, { ...match, reportedCostMicros: -1 }), /cost/);
  await assert.rejects(() => recordTestingMatch(db, { ...match, reportedCostMicros: .5 }), /cost/);
  await assert.rejects(() => recordTestingMatch(db, { ...match, p1: { ...match.p1, kind: "unknown" as never } }), /actor/);
  await assert.rejects(() => recordTestingMatch(db, { ...match, p2: { ...match.p2, model: null } }), /Opus model/);
  await assert.rejects(() => recordTestingMatch(db, { ...match, p2: { ...match.p2, model: "Opus" } }), /Opus model/);
  await assert.rejects(() => recordTestingMatch(db, { ...match, p1DeckId: "not-in-catalog" }), /catalog/);
  await assert.rejects(() => recordTestingMatch(db, { ...match, evidence: "" }), /evidence/);
  for (const [i, outcome] of (["draw", "interrupted", "abandoned", "limit"] as const).entries()) {
    await recordTestingMatch(db, { ...match, requestId: `10000000-0000-4000-8000-${String(i + 2).padStart(12, "0")}`, outcome, winner: null, reportedCostMicros: i === 0 ? 0 : i === 1 ? 125 : null });
  }
  let dashboard = await getTestingDashboard(db);
  assert.equal(dashboard.recordedStats.matches.games, 5);
  assert.equal((await listImportedEvaluationRuns(db)).length, 3, "run receipts survive a database restart");
  assert.equal(dashboard.recordedStats.matches.completed, 2);
  assert.equal(dashboard.recordedStats.matches.draws, 1);
  assert.equal(dashboard.recordedStats.matches.interrupted, 1);
  assert.equal(dashboard.recordedStats.matches.winRate, null, "unique-game row cannot claim a 50% two-seat win rate");
  assert.deepEqual(dashboard.recordedStats.cost, { knownCostMicros: 125, pricedMatches: 2, totalMatches: 5, label: "Recorded cost for 2 of 5 matches; partial evidence, not an invoice." });
  assert.equal(dashboard.recordedStats.byActor.find((a) => a.label.startsWith("Frozen heuristic"))!.wins, 1);
  assert.equal(dashboard.recordedStats.byMatchup.length, 2, "opponents/decks form two oriented matchup rows");
  assert.equal(dashboard.recordedStats.byMatchup[0].uniqueGames, 5);
  const filtered = await getTestingDashboard(db, { actorKind: "opus", model: "claude-opus-4-6", deckId: p2 });
  assert.equal(filtered.recordedStats.byActor.length, 1);
  assert.equal(filtered.recordedStats.byDeck.length, 1);
  assert.equal(filtered.recordedStats.byActor[0].losses, 1);
  assert.equal((await getTestingDashboard(db, { deckId: `recipe:${p2}` })).recordedStats.matches.games, 5);
  assert.equal((await getTestingDashboard(db, { actorKind: "opus", deckId: p1 })).recordedStats.matches.games, 0, "filter fields must match the same seat");
  const mirror: StatsMatch = { id: "mirror", p1DeckId: p1, p2DeckId: p1, p1DeckName: "Same deck", p2DeckName: "Same deck", p1: match.p1, p2: match.p1, outcome: "win", winner: "p1", reportedCostMicros: 7 };
  const mirrored = aggregateMatches([mirror, mirror]);
  assert.equal(mirrored.matches.games, 1); assert.equal(mirrored.byDeck[0].games, 2);
  assert.equal(mirrored.byDeck[0].wins, 1); assert.equal(mirrored.byDeck[0].losses, 1);
  assert.equal(mirrored.byDeck[0].uniqueGames, 1); assert.equal(mirrored.byDeck[0].appearances, 2);
  assert.equal(mirrored.byMatchup.length, 1); assert.equal(mirrored.byMatchup[0].uniqueGames, 1); assert.equal(mirrored.byMatchup[0].appearances, 2);
  assert.equal(mirrored.cost.knownCostMicros, 7, "mirrors/repeated input never double cost");
  // Database constraints also refuse rows bypassing domain validation.
  await assert.rejects(() => db.insert(schema.arenaTestingMatches).values({ ...match, requestId: "constraint", fingerprint: "x", outcome: "win", winner: null }));
  await assert.rejects(() => db.insert(schema.arenaTestingMatches).values({ ...match, requestId: "constraint2", fingerprint: "x", outcome: "draw", winner: "p1" }));

  const server = async (state: unknown, reason: string | null, status = "over", mode = "tournament") => {
    const [g] = await db.insert(schema.arenaGames).values({ p1DeckId: fresh.id, p2DeckId: fresh.id, p1Name: "Server deck", p2Name: "Server deck", p1User: "Pat", mode, status, winner: null, reason, state, seed: 1 }).returning();
    return g;
  };
  const interrupted = await server({ winner: null, overReason: "this engine cannot finish this game: blocker" }, "this engine cannot finish this game: blocker");
  await server({ outcome: { kind: "draw", winner: null, reason: "both decks empty" } }, "both decks empty");
  const opus = await server({ outcome: { kind: "win", winner: "p2", reason: "life" } }, "life");
  const mixed = await server({ outcome: { kind: "win", winner: "p1", reason: "life" } }, "life");
  await server({ outcome: { kind: "win", winner: null, reason: "invalid old row" } }, "invalid old row");
  await server({}, null, "playing", "sparring");
  for (const [game, models] of [[opus, ["claude-opus-4-6"]], [mixed, ["claude-opus-4-6", "claude-sonnet-4-6"]]] as const) for (const [i, model] of models.entries()) {
    await db.insert(schema.arenaDecisions).values({ gameId: game.id, seq: i, turn: 1, phase: "main", promptKind: "main", player: "p2", decidedBy: "claude", how: "actual decision", model });
  }
  // Referee-only Opus calls do not turn a human/opponent into Opus.
  await db.insert(schema.arenaDecisions).values({ gameId: interrupted.id, seq: 1, turn: 1, phase: "main", promptKind: "referee", player: "p2", decidedBy: "claude", kind: "referee", how: "referee", model: "claude-opus-4-6" });
  const existing = await serverTestingStats(db);
  assert.equal(existing.matches.games, 6); assert.equal(existing.matches.completed, 3);
  assert.equal(existing.matches.interrupted, 2); assert.equal(existing.matches.draws, 1); assert.equal(existing.matches.playing, 1);
  assert.equal(existing.byActor.find((a) => a.label.includes("claude-opus-4-6") && !a.label.includes("mixed:"))!.games, 1);
  assert.ok(existing.byActor.some((a) => a.label.includes("mixed:")));
  assert.ok(existing.byActor.some((a) => a.label.endsWith("unknown")));
  assert.equal((await serverTestingStats(db, { actorKind: "opus" })).matches.games, 1, "tournament/referee/mixed/unknown never equate to Opus");

  await client.close();
  client = new PGlite(directory); db = drizzle(client, { schema }) as unknown as Db;
  dashboard = await getTestingDashboard(db);
  await ensureTestingCatalog(db);
  dashboard = await getTestingDashboard(db);
  assert.equal(dashboard.decks.length, 64, "reseed is idempotent after real reload");
  assert.equal(dashboard.decks.find((d) => d.id === deck.id)!.version, 1);
  assert.equal(dashboard.decks.find((d) => d.id === deck.id)!.linkedDeckId, fresh.id);
  assert.equal(dashboard.scenarios.find((s) => s.id === scenario.id)!.status, "failed");
  assert.equal(dashboard.recordedStats.matches.games, 5);
  assert.equal(dashboard.recentMatches.find((m) => m.requestId === match.requestId)!.reportedCostMicros, null);
  assert.equal(dashboard.actualDecks.find((d) => d.id === fresh.id)!.isTesting, true);
  assert.deepEqual(TESTING_SCENARIO_CATALOG.reduce((s, r) => ({ ...s, [r.group]: s[r.group] + 1 }), { family: 0, strategy: 0, white_cell_rule: 0, white_cell_strategy: 0 }), { family: 24, strategy: 12, white_cell_rule: 12, white_cell_strategy: 7 });
  console.log("arena-testing-data: additive migrations; immutable manifest imports/idempotency/reload; no auto-progress; explicit mapping/unpinned revisions/unknown-vs-zero costs; 64 planned recipes/55 scenarios; durable CAS; manual idempotency; mirror/filter/matchup/cost denominators; server-model provenance; testing flag default verified");
} finally { await client.close(); fs.rmSync(directory, { recursive: true, force: true }); }
