/**
 * Reproducible local Arena phase baseline. No live database, provider, or
 * product telemetry: `DATABASE_URL='' npx tsx scripts/arena-perf-baseline.mts`.
 * Run with `--engine rules`; fixture cards and state come from the same
 * EngineAPI test helpers used by the arena verification suite.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { arenaG, CTX, ENGINE, IMPL } from "./verify/harness.ts";
import { buildSnapshot } from "../src/lib/arena/snapshot.ts";
import { IllegalAction } from "../src/lib/arena/vm/common.ts";
import type { Action, LegalAction } from "../src/lib/arena/types.ts";
import { applyToGame, loadGame, startGame } from "../src/lib/arena/games.ts";
import { waitForRevision } from "../src/lib/arena/session.ts";

const WARMUP = 25;
const SAMPLES = 100;
const REFERENCE_BASELINE = "74701713";

function runtimeStamp() {
  const root = path.resolve("src/lib/arena");
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.tsx?$/.test(entry.name)) files.push(full);
    }
  };
  visit(root);
  files.push(path.resolve("src/db/schema.ts"));
  files.sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(path.relative(process.cwd(), file));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  const sourceStatus = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "src/lib/arena", "src/db/schema.ts"], { encoding: "utf8" });
  return {
    measuredHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    runtimeSourcesDirty: sourceStatus.trim().length > 0,
    runtimeSourceFingerprint: hash.digest("hex"),
  };
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50Ms: round(percentile(sorted, 0.5)), p95Ms: round(percentile(sorted, 0.95)) };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function measure(label: string, fixture: string, fn: () => unknown) {
  for (let i = 0; i < WARMUP; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return { fixture, phase: label, warmup: WARMUP, samples: SAMPLES, ...summarize(samples) };
}

function fixture(fixtureName: string, options: Parameters<typeof arenaG>[0], historyLines: number) {
  const state = arenaG(options);
  const legal: LegalAction[] = IMPL.legalActions(CTX, state);
  assert.ok(legal.length > 0, `${fixtureName} is a playable EngineAPI position`);
  const action = legal[0].action;
  const badAction: Action = { type: "endMain", player: "p2" };
  const beforeIllegal = JSON.stringify(state);
  assert.throws(() => IMPL.apply(CTX, state, badAction), IllegalAction, `${fixtureName} refuses a non-legal opponent action`);
  assert.equal(JSON.stringify(state), beforeIllegal, `${fixtureName} rejection leaves the fixture unchanged`);
  const positive = IMPL.apply(CTX, state, action);
  assert.ok(positive.state, `${fixtureName} accepts one action from its own legal menu`);
  assert.notEqual(JSON.stringify(positive.state), beforeIllegal, `${fixtureName} legal action advances the state`);
  const log = Array.from({ length: historyLines }, (_, i) => `turn ${Math.floor(i / 20) + 1} event ${i + 1}`);
  const snapshotInput = {
    id: 1,
    revision: historyLines,
    mode: "hotseat" as const,
    engine: ENGINE,
    status: "playing",
    p1Name: "Synthetic Player One",
    p2Name: "Synthetic Player Two",
    ctx: CTX,
    state,
    legal,
    log,
    beats: null,
    spotlight: null,
    spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
    ai: null,
    viewer: "p1" as const,
    images: {},
  };
  const snapshot = buildSnapshot(snapshotInput);
  const encoded = JSON.stringify(snapshot);
  // The opposing hand must remain masked, and timing output cannot contain it.
  assert.equal(snapshot.view.them.hand, null, `${fixtureName} keeps the other hand hidden`);
  for (const id of (state as { sides?: Record<string, { zones: { hand: string[] } }> }).sides?.p2.zones.hand ?? []) {
    assert.equal(encoded.includes(id), false, `${fixtureName} snapshot does not expose opposing hand instance ids`);
  }
  return { state, legal, action, badAction, snapshotInput, serializedBytes: Buffer.byteLength(encoded) };
}

function metricsFor(name: string, data: ReturnType<typeof fixture>) {
  const { state, legal, action, badAction, snapshotInput, serializedBytes } = data;
  const snapshotValue = buildSnapshot(snapshotInput);
  const serialization = measure("snapshotSerialize", name, () => JSON.stringify(snapshotValue));
  const results = [
    measure("legalActions", name, () => IMPL.legalActions(CTX, state)),
    measure("apply", name, () => IMPL.apply(CTX, state, action)),
    measure("illegalActionRejection", name, () => {
      try {
        IMPL.apply(CTX, state, badAction);
      } catch (error) {
        assert.ok(error instanceof IllegalAction, "illegal action rejection is an engine verdict");
      }
    }),
    measure("rejectedActions", name, () => IMPL.rejectedActions(CTX, state, legal)),
    measure("boardView", name, () => IMPL.boardView(CTX, state, "p1", {})),
    measure("snapshotBuild", name, () => buildSnapshot(snapshotInput)),
    { ...serialization, payloadBytes: serializedBytes },
  ];
  return results;
}

async function migrate(client: PGlite) {
  const dir = path.resolve("drizzle");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) await client.exec(stmt);
  }
}

async function seedGameFixture(db: Db) {
  await db.insert(schema.cardSets).values({ code: "P0PERF", name: "Synthetic Benchmark Set", line: "masters", sortKey: 999 });
  const card = (id: string, name: string, cardType: string, extra: Partial<typeof schema.cards.$inferInsert> = {}) => ({
    id,
    setCode: "P0PERF",
    name,
    cardType,
    rarity: "Common[C]",
    rarityCode: "C",
    searchText: `${id} ${name}`.toLowerCase(),
    colors: ["Red"],
    ...extra,
  });
  await db.insert(schema.cards).values([
    card("P0PERF-001", "Synthetic Leader", "LEADER", { power: 10000 }),
    card("P0PERF-002", "Synthetic Battle", "BATTLE", { power: 10000, energyCost: "1", comboPower: 5000 }),
    card("P0PERF-003", "Synthetic Heavy", "BATTLE", { power: 15000, energyCost: "2", comboPower: 5000 }),
  ]);
  const [deck] = await db.insert(schema.decks).values({ name: "Synthetic Benchmark Deck", game: "dbs" }).returning({ id: schema.decks.id });
  await db.insert(schema.deckCards).values([
    { deckId: deck.id, cardId: "P0PERF-001", zone: "leader", quantity: 1 },
    { deckId: deck.id, cardId: "P0PERF-002", zone: "main", quantity: 25 },
    { deckId: deck.id, cardId: "P0PERF-003", zone: "main", quantity: 25 },
  ]);
  const id = await startGame(db, deck.id, deck.id, "hotseat", false, { p1User: null, p2User: null }, "rules");
  return { id, deckId: deck.id };
}

async function persistenceMetrics(data: ReturnType<typeof fixture>) {
  const client = new PGlite();
  await migrate(client);
  const queryMeter = { count: 0 };
  const db = drizzle(client, { schema, logger: { logQuery() { queryMeter.count++; } } }) as unknown as Db;
  const [row] = await db.insert(schema.arenaGames).values({
    p1Name: "synthetic",
    p2Name: "synthetic",
    seed: 17,
    engine: ENGINE,
    state: data.state,
  }).returning({ id: schema.arenaGames.id });
  const payload = {
    state: data.state,
    actions: Array.from({ length: 250 }, (_, i) => ({ type: "pass", player: i % 2 ? "p1" : "p2" })),
    log: Array.from({ length: 500 }, (_, i) => `turn ${Math.floor(i / 20) + 1} event ${i + 1}`),
  };
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
  const storageQueryCounts: number[] = [];
  const storageSamples: number[] = [];
  for (let i = 0; i < WARMUP + SAMPLES; i++) {
    queryMeter.count = 0;
    const start = performance.now();
    const [ack] = await db.update(schema.arenaGames).set(payload).where(eq(schema.arenaGames.id, row.id)).returning({ id: schema.arenaGames.id });
    const elapsed = performance.now() - start;
    assert.equal(ack.id, row.id, "persisted acknowledgement returns the saved game row");
    if (i >= WARMUP) {
      storageSamples.push(elapsed);
      storageQueryCounts.push(queryMeter.count);
    }
  }
  const shortPollQueryCounts: number[] = [];
  for (let i = 0; i < 3; i++) {
    queryMeter.count = 0;
    await waitForRevision(db, row.id, 0, 50);
    shortPollQueryCounts.push(queryMeter.count);
  }
  const shortPollAverage = shortPollQueryCounts.reduce((sum, n) => sum + n, 0) / shortPollQueryCounts.length;
  assert.ok(shortPollAverage >= 1 && shortPollAverage <= 4, "short-window idle poll stays bounded under scheduler variance");
  const reloaded = await db.query.arenaGames.findFirst({ where: eq(schema.arenaGames.id, row.id) });
  assert.ok(reloaded, "storage-only calibration row reloads");
  assert.deepEqual(reloaded.state, data.state, "reload reads the persisted engine state");

  const appGame = await seedGameFixture(db);
  await db.update(schema.arenaGames).set({ actions: payload.actions, log: payload.log }).where(eq(schema.arenaGames.id, appGame.id));
  const loaded = (await loadGame(db, appGame.id))!;
  assert.ok(loaded, "synthetic practice deck creates a saved rules-engine game");
  const action = loaded.legal[0]!.action;
  const appSamples: number[] = [];
  const appQueryCounts: number[] = [];
  let appAcknowledgement = loaded;
  for (let i = 0; i < WARMUP + SAMPLES; i++) {
    // Restore the same valid base row outside the timer, retaining synthetic
    // history solely to exercise the write payload; it is not replayed.
    await db.update(schema.arenaGames).set({
      state: loaded.state,
      actions: loaded.actions,
      log: loaded.log,
      beats: loaded.beats,
      version: loaded.version,
      status: "playing",
      turn: loaded.state.turn,
    }).where(eq(schema.arenaGames.id, appGame.id));
    queryMeter.count = 0;
    const start = performance.now();
    appAcknowledgement = await applyToGame(db, appGame.id, action, undefined, {
      game: loaded,
      expectedRevision: loaded.version,
    });
    const elapsed = performance.now() - start;
    assert.equal(appAcknowledgement.version, loaded.version + 1, "actual gameplay action is acknowledged at the next CAS revision");
    if (i >= WARMUP) {
      appSamples.push(elapsed);
      appQueryCounts.push(queryMeter.count);
    }
  }
  const reloadedAppGame = await loadGame(db, appGame.id);
  assert.equal(reloadedAppGame?.version, appAcknowledgement.version, "reloading reads the actual applyToGame revision");
  assert.deepEqual(reloadedAppGame?.state, appAcknowledgement.state, "reloading reads the actual applyToGame state");
  assert.equal(reloadedAppGame?.actions.length, 251, "the action appends to, rather than replaces, synthetic history");
  await db.delete(schema.arenaGames).where(eq(schema.arenaGames.id, appGame.id));
  await db.delete(schema.decks).where(eq(schema.decks.id, appGame.deckId));
  await db.delete(schema.cards).where(inArray(schema.cards.id, ["P0PERF-001", "P0PERF-002", "P0PERF-003"]));
  await db.delete(schema.cardSets).where(eq(schema.cardSets.code, "P0PERF"));

  queryMeter.count = 0;
  const longPollStart = performance.now();
  const longPollResult = await waitForRevision(db, row.id, reloaded.version, 15_000);
  const longPollElapsedMs = Math.round(performance.now() - longPollStart);
  const longPollQueries = queryMeter.count;
  assert.equal(longPollResult, false, "the unchanged row remains idle until the long-poll deadline");
  assert.ok(longPollElapsedMs >= 14_500 && longPollElapsedMs <= 17_000, "long-poll timing stays close to its configured 15-second window");
  assert.ok(longPollQueries >= 1 && longPollQueries <= 24, "long-poll query count remains bounded under scheduler variance");
  await client.close();
  return {
    measurements: [
      {
        fixture: "synthetic-250-actions-500-log-lines",
        phase: "storageWriteAcknowledgement",
        warmup: WARMUP,
        samples: SAMPLES,
        ...summarize(storageSamples),
        maxQueriesPerAck: Math.max(...storageQueryCounts),
        payloadBytes,
      },
      {
        fixture: "valid-game-with-synthetic-250-action-500-line-history",
        phase: "applyToGamePersistedAcknowledgement",
        warmup: WARMUP,
        samples: SAMPLES,
        ...summarize(appSamples),
        maxQueriesPerAck: Math.max(...appQueryCounts),
        acknowledgedStateHistoryBytes: Buffer.byteLength(JSON.stringify({
          state: appAcknowledgement.state,
          actions: appAcknowledgement.actions,
          log: appAcknowledgement.log,
        })),
        reloadVerified: true,
      },
      {
        fixture: "unchanged-row-short-window",
        phase: "waitForRevisionIdlePoll",
        timeoutMs: 50,
        repeats: shortPollQueryCounts.length,
        averageQueries: Math.round(shortPollAverage * 100) / 100,
        minQueries: Math.min(...shortPollQueryCounts),
        maxQueries: Math.max(...shortPollQueryCounts),
      },
      {
        fixture: "unchanged-row-standard-window",
        phase: "waitForRevisionIdlePoll",
        timeoutMs: 15_000,
        elapsedMs: longPollElapsedMs,
        queries: longPollQueries,
        changed: longPollResult,
      },
    ],
  };
}

async function main() {
  assert.equal(ENGINE, "rules", "run with --engine rules so the current Arena engine is measured explicitly");
  assert.equal(process.env.DATABASE_URL ?? "", "", "benchmark must not connect to a configured/live database");
  const fixtures: [string, NonNullable<Parameters<typeof arenaG>[0]>, number][] = [
    ["small", { hand: ["V1"], energy: ["V1"], battle: ["V1"], oppBattle: ["V-BLUE"] }, 20],
    ["crowded-aura-12", { hand: ["V1", "V1"], energy: ["V1", "V1"], battle: ["AURA", "AURA", "AURA", "AURA", "AURA", "AURA", "AURA", "AURA", "V1", "V1", "V1", "V1"], oppBattle: ["V-BLUE", "V-BLUE", "V-BLUE", "V-BLUE", "V-BLUE", "V-BLUE"] }, 20],
    ["long-history", { hand: ["V1"], energy: ["V1"], battle: ["AURA", "AURA", "V1", "V1"], oppBattle: ["V-BLUE", "V-BLUE"] }, 1000],
  ];
  const output = [];
  for (const [name, options, history] of fixtures) output.push(...metricsFor(name, fixture(name, options, history)));
  output.push(await persistenceMetrics(fixture("long-history", fixtures[2]![1], fixtures[2]![2])));
  // Mock provider latency is isolated from engine timing and uses a fixed delay.
  const mockAi = [] as number[];
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 20));
    mockAi.push(performance.now() - start);
  }
  output.push({ fixture: "mock-only", phase: "simulatedAiLatency", warmup: 0, samples: mockAi.length, configuredDelayMs: 20, ...summarize(mockAi) });
  console.log(JSON.stringify({ referenceBaseline: REFERENCE_BASELINE, ...runtimeStamp(), engine: ENGINE, cpuLocalOnly: true, metrics: output }, null, 2));
}

main().catch((error) => {
  // Error details can contain SQL/card payloads; emit only the error class and
  // a fixed failure marker so diagnostic output remains safe to attach.
  console.error(JSON.stringify({ benchmark: "arena-perf-baseline", failed: true, errorType: error instanceof Error ? error.name : "UnknownError" }));
  process.exitCode = 1;
});
