/**
 * verify-db checks for `recordRun` (#380, #515): the cache token fields of a
 * usage object land in `ai_runs`, and a usage object without them stores nulls;
 * the provider and billed fields are filled from AiResult or default to
 * anthropic-api/true for legacy responses. Checks that costMicros is unchanged
 * for existing models (#515).
 * Kept in its own file so verify-db.mts only gains one line.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { recordRun } from "../src/lib/ai/client.ts";
import { costMicros } from "../src/lib/ai/models.ts";

export async function verifyAiRuns(db: Db): Promise<void> {
  const parsed = { ok: true };

  // Test: AiResult (new contract) with provider and billed
  const aiResult = await recordRun(
    db,
    "deck_builder",
    { test: "ai result" },
    { text: "{}", parsed, stop: "end", usage: { input: 120, output: 40, cacheRead: 9000, cacheWrite: 350 }, provider: "anthropic-api", model: "claude-opus-5", billed: true, latencyMs: 100 },
  );
  const [row] = await db.select().from(schema.aiRuns).where(eq(schema.aiRuns.id, aiResult.id));
  assert.equal(row.kind, "deck_builder");
  assert.equal(row.inputTokens, 120);
  assert.equal(row.outputTokens, 40);
  assert.equal(row.cacheReadTokens, 9000, "recordRun stores usage.cacheRead");
  assert.equal(row.cacheCreationTokens, 350, "recordRun stores usage.cacheWrite");
  assert.equal(row.provider, "anthropic-api", "recordRun stores provider from AiResult");
  assert.equal(row.billed, true, "recordRun stores billed from AiResult");

  // Test: legacy SDK response (old contract) defaults to anthropic-api / true
  const legacy = await recordRun(
    db,
    "arena_clarify",
    { test: "legacy response" },
    { parsed_output: parsed, stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 6, cache_read_input_tokens: null } },
  );
  const [row2] = await db.select().from(schema.aiRuns).where(eq(schema.aiRuns.id, legacy.id));
  assert.equal(row2.cacheReadTokens, null, "a null cache field is stored as null");
  assert.equal(row2.cacheCreationTokens, null, "an absent cache field is stored as null");
  assert.equal(row2.provider, "anthropic-api", "legacy response defaults to anthropic-api provider");
  assert.equal(row2.billed, true, "legacy response defaults to billed=true");

  // Test: costMicros is unchanged for existing models
  const costs: Record<string, number> = {
    "claude-opus-5": costMicros({ model: "claude-opus-5", input: 1_000_000, output: 1_000_000, cached: 0 }),
    "claude-sonnet-5-5": costMicros({ model: "claude-sonnet-5-5", input: 1_000_000, output: 1_000_000, cached: 0 }),
    "claude-haiku-4-5": costMicros({ model: "claude-haiku-4-5", input: 1_000_000, output: 1_000_000, cached: 0 }),
  };
  assert.equal(costs["claude-opus-5"], 30_000_000, "Opus: 5 + 25 = 30 USD");
  assert.equal(costs["claude-sonnet-5-5"], 12_000_000, "Sonnet: 2 + 10 = 12 USD");
  assert.equal(costs["claude-haiku-4-5"], 6_000_000, "Haiku: 1 + 5 = 6 USD");

  // Test: costMicros with cache
  const cached = costMicros({ model: "claude-opus-5", input: 1_000_000, output: 1_000_000, cached: 1_000_000 });
  const expectedCached = Math.round((1_000_000 * 5 + 1_000_000 * 5 * 0.1 + 1_000_000 * 25) / 1_000_000 * 1_000_000);
  assert.equal(cached, expectedCached, "cache read is 10% of input price");

  await db.delete(schema.aiRuns).where(eq(schema.aiRuns.id, aiResult.id));
  await db.delete(schema.aiRuns).where(eq(schema.aiRuns.id, legacy.id));
}
