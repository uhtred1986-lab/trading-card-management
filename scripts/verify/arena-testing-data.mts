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
import { ensureTestingCatalog, getTestingDashboard, recordTestingMatch, setDeckTesting, updateTestingDeck, updateTestingScenario, serverTestingStats } from "../../src/lib/arena/testing/store.ts";
import { TESTING_DECK_CATALOG, TESTING_SCENARIO_CATALOG } from "../../src/lib/arena/testing/catalog.ts";
import { aggregateMatches, type StatsMatch } from "../../src/lib/arena/testing/stats.ts";
import { getDeck, listDecks } from "../../src/lib/decks/queries.ts";
import type { RecordTestingMatchInput } from "../../src/lib/arena/testing/types.ts";

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
  console.log("arena-testing-data: additive migrations; 64 planned recipes/55 scenarios; durable reload/CAS; manual idempotency/validation; mirror/filter/matchup/cost denominators; interrupted and mixed/unknown server-model provenance; testing flag default verified");
} finally { await client.close(); fs.rmSync(directory, { recursive: true, force: true }); }
