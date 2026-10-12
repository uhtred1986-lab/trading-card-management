/** Concurrent, stale, and repeated Arena usage accounting against PGlite. */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import type { Db } from "../../src/db/index.ts";
import { arenaAiUsage, arenaGames } from "../../src/db/schema.ts";
import { accountArenaUsage } from "../../src/lib/arena/ai/run.ts";
import { abandonGame, applyToGame, loadGame, mutationFingerprint, StaleGame } from "../../src/lib/arena/games.ts";

export async function verifyArenaAiUsage(db: Db): Promise<void> {
  const [game] = await db
    .insert(arenaGames)
    .values({ p1Name: "Accounting P1", p2Name: "Accounting P2", seed: 567, state: { phase: "main" } })
    .returning({ id: arenaGames.id });

  const a = { gameId: game.id, callId: "mock-call-a", revision: 0 };
  const b = { gameId: game.id, callId: "mock-call-b", revision: 0 };
  const paid = { model: "mock-priced-model", provider: "openrouter", billed: true, input: 100, output: 20, cached: 10, cacheWrite: 5, costMicros: 17 };
  const subscription = { model: "claude-haiku-4-5", provider: "anthropic-agent-sdk", billed: false, input: 60, output: 8, cached: 0, cacheWrite: 12, costMicros: 3 };

  // Two independent provider calls overlap at the same starting revision.
  await Promise.all([accountArenaUsage(db, a, paid), accountArenaUsage(db, b, subscription)]);
  let [row] = await db.select().from(arenaGames).where(eq(arenaGames.id, game.id));
  assert.deepEqual(
    [row.aiCalls, row.aiInputTokens, row.aiOutputTokens, row.aiCachedTokens, row.aiCostMicros],
    [2, 160, 28, 10, 20],
    "overlapping provider calls accumulate each usage/cost delta once, including an unbilled subscription result",
  );

  const receipts = await db.select().from(arenaAiUsage).where(eq(arenaAiUsage.gameId, game.id));
  assert.equal(receipts.length, 2);
  assert.deepEqual(
    receipts.map(({ callId, revision, provider, billed, cacheCreationTokens }) => ({ callId, revision, provider, billed, cacheCreationTokens })).sort((x, y) => x.callId.localeCompare(y.callId)),
    [
      { callId: "mock-call-a", revision: 0, provider: "openrouter", billed: true, cacheCreationTokens: 5 },
      { callId: "mock-call-b", revision: 0, provider: "anthropic-agent-sdk", billed: false, cacheCreationTokens: 12 },
    ],
    "each receipt retains its physical call identity, originating revision, provider, billing flag and cache-write tokens",
  );

  // Concurrent retries of the persistence step reuse their identity and exact payload.
  await Promise.all([accountArenaUsage(db, a, paid), accountArenaUsage(db, a, paid)]);
  [row] = await db.select().from(arenaGames).where(eq(arenaGames.id, game.id));
  assert.deepEqual([row.aiCalls, row.aiInputTokens, row.aiOutputTokens, row.aiCostMicros], [2, 160, 28, 20], "an exact accounting retry is idempotent");
  await assert.rejects(accountArenaUsage(db, a, { ...paid, output: 21 }), /reused with different accounting data/, "the same identity with changed usage fails rather than hiding a distinct result");
  [row] = await db.select().from(arenaGames).where(eq(arenaGames.id, game.id));
  assert.deepEqual([row.aiCalls, row.aiInputTokens, row.aiOutputTokens, row.aiCostMicros], [2, 160, 28, 20], "a conflicting identity leaves totals unchanged");
  assert.equal((await db.select().from(arenaAiUsage).where(eq(arenaAiUsage.gameId, game.id))).length, 2, "a conflicting identity does not create another usage row");

  // A newer game write can beat this model response. Accounting does not use
  // the gameplay version predicate and remains durable for its old revision.
  const stale = { gameId: game.id, callId: "mock-stale-call", revision: 0 };
  const staleWrite = await db
    .update(arenaGames)
    .set({ version: 1, state: { phase: "advanced-by-another-request" } })
    .where(eq(arenaGames.id, game.id))
    .returning({ id: arenaGames.id });
  assert.equal(staleWrite.length, 1);
  await accountArenaUsage(db, stale, { ...paid, model: "mock-stale-model", input: 7, output: 3, cached: 2, cacheWrite: 0, costMicros: 4 });
  [row] = await db.select().from(arenaGames).where(eq(arenaGames.id, game.id));
  assert.equal(row.version, 1, "the late AI result does not roll back or advance the game board");
  assert.deepEqual([row.aiCalls, row.aiInputTokens, row.aiOutputTokens, row.aiCachedTokens, row.aiCostMicros], [3, 167, 31, 12, 24], "the rejected stale move's actual provider usage is still included");

  // A state CAS or abandonment status write changes only gameplay columns;
  // it cannot replace the counters or remove their independent receipts.
  await db.update(arenaGames).set({ status: "abandoned", version: 2, actionReceipts: [{ actor: "test", requestId: "abandon", fingerprint: "f", revision: 2 }] }).where(eq(arenaGames.id, game.id));
  [row] = await db.select().from(arenaGames).where(eq(arenaGames.id, game.id));
  assert.deepEqual([row.status, row.version, row.aiCalls, row.aiInputTokens, row.aiOutputTokens, row.aiCachedTokens, row.aiCostMicros], ["abandoned", 2, 3, 167, 31, 12, 24], "an abandonment write retains concurrent AI totals");
  assert.equal((await db.select().from(arenaAiUsage).where(eq(arenaAiUsage.gameId, game.id))).length, 3, "the usage ledger survives gameplay writes independently of action receipts");

  await db.delete(arenaGames).where(eq(arenaGames.id, game.id));
  console.log("verify-db: concurrent Arena AI usage, stale decisions and idempotent receipts ok");
}

/** Use the real saved-game CAS and abandonment path while provider accounting races both writes. */
export async function verifyArenaUsageGameplayWrites(db: Db, gameId: number): Promise<void> {
  const decidedOn = await loadGame(db, gameId);
  assert.ok(decidedOn && decidedOn.legal.length > 0, "the shared valid game fixture has a legal action");
  const action = decidedOn!.legal[0].action;
  await applyToGame(db, gameId, action, undefined, { game: decidedOn! });

  const staleAttribution = { gameId, callId: "mock-stale-decision", revision: decidedOn!.version };
  const staleSpend = { model: "mock-stale-model", provider: "openrouter", billed: true, input: 19, output: 4, cached: 2, cacheWrite: 1, costMicros: 6 };
  const [accounted, rejected] = await Promise.allSettled([
    accountArenaUsage(db, staleAttribution, staleSpend),
    applyToGame(db, gameId, action, undefined, { game: decidedOn! }),
  ]);
  assert.equal(accounted.status, "fulfilled", "the paid answer is recorded even when its board revision lost the CAS");
  assert.equal(rejected.status, "rejected");
  assert.ok(rejected.status === "rejected" && rejected.reason instanceof StaleGame, "the stale AI action is rejected by the real applyToGame version guard");

  const afterStale = await loadGame(db, gameId);
  assert.ok(afterStale);
  const rowAfterStale = await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, gameId) });
  assert.equal(rowAfterStale?.actions && (rowAfterStale.actions as unknown[]).length, (decidedOn!.actions.length + 1), "only the winning action reached game history");
  assert.equal(rowAfterStale?.aiCalls, 1, "the rejected paid decision remains accounted");
  assert.equal(rowAfterStale?.aiInputTokens, staleSpend.input);
  assert.equal((await db.select().from(arenaAiUsage).where(eq(arenaAiUsage.gameId, gameId)))[0]?.revision, decidedOn!.version, "the stale call is attributed to the revision it actually saw");

  const beforeAbandon = await loadGame(db, gameId);
  assert.ok(beforeAbandon);
  const abandonSpend = { ...staleSpend, model: "mock-abandon-race-model", input: 23, output: 5, cached: 1, costMicros: 7 };
  const abandonRequest = {
    actor: null,
    requestId: "mock-accounting-abandon",
    fingerprint: mutationFingerprint({ basedOn: beforeAbandon!.version, type: "abandon" }),
  };
  const [accountedDuringAbandon, abandoned] = await Promise.all([
    accountArenaUsage(db, { gameId, callId: "mock-abandon-race", revision: beforeAbandon!.version }, abandonSpend),
    abandonGame(db, gameId, beforeAbandon!.version, abandonRequest),
  ]);
  assert.equal(accountedDuringAbandon, 7);
  assert.equal(abandoned.status, "abandoned");
  const final = await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, gameId) });
  assert.deepEqual([final?.status, final?.aiCalls, final?.aiInputTokens, final?.aiOutputTokens, final?.aiCachedTokens, final?.aiCostMicros], ["abandoned", 2, 42, 9, 3, 13], "an overlapping abandonment preserves both cumulative usage and call receipts");
  assert.equal((final?.actionReceipts as unknown[]).length, 1, "usage receipts remain separate from user action receipts");
  assert.equal((await db.select().from(arenaAiUsage).where(eq(arenaAiUsage.gameId, gameId))).length, 2, "both paid calls remain attributable after abandonment");
  console.log("verify-db: real Arena stale-CAS and abandonment writes preserve concurrent usage");
}
