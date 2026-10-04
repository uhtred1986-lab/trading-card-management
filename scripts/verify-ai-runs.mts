/**
 * verify-db checks for `recordRun` (#380, #515): the cache token fields of a
 * usage object land in `ai_runs`, and a usage object without them stores nulls;
 * the provider and billed fields are filled from AiResult or default to
 * anthropic-api/true for legacy responses. Checks that costMicros is byte-identical
 * for existing models over various token mixes, and that dynamic model pricing
 * via rememberModelPrices works (#515).
 * Kept in its own file so verify-db.mts only gains one line.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { recordRun } from "../src/lib/ai/client.ts";
import { ANTHROPIC_MODELS, ANTHROPIC_TIERS, PRICES, costMicros, rememberModelPrices, priceOf, modelEntry } from "../src/lib/ai/models.ts";
import type { ModelInfo } from "../src/lib/ai/types.ts";

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

  // Test: costMicros is byte-identical for existing models over various token mixes
  // Opus: input 5, output 25 per MTok; cache read at 0.1×
  const opusFormula = (input: number, output: number, cached: number): number => {
    return Math.round((input * 5 + cached * 5 * 0.1 + output * 25) / 1_000_000 * 1_000_000);
  };
  assert.equal(costMicros({ model: "claude-opus-5", input: 1_000_000, output: 1_000_000, cached: 0 }), opusFormula(1_000_000, 1_000_000, 0), "Opus 1M+1M+0");
  assert.equal(costMicros({ model: "claude-opus-5", input: 523_456, output: 234_567, cached: 89_012 }), opusFormula(523_456, 234_567, 89_012), "Opus non-round tokens with cache");
  assert.equal(costMicros({ model: "claude-opus-5", input: 1, output: 1, cached: 1 }), opusFormula(1, 1, 1), "Opus tiny inputs");

  // Sonnet: input 2, output 10 per MTok
  const sonnetFormula = (input: number, output: number, cached: number): number => {
    return Math.round((input * 2 + cached * 2 * 0.1 + output * 10) / 1_000_000 * 1_000_000);
  };
  assert.equal(costMicros({ model: "claude-sonnet-5-5", input: 1_000_000, output: 1_000_000, cached: 0 }), sonnetFormula(1_000_000, 1_000_000, 0), "Sonnet 1M+1M+0");
  assert.equal(costMicros({ model: "claude-sonnet-5-5", input: 456_789, output: 111_222, cached: 333_444 }), sonnetFormula(456_789, 111_222, 333_444), "Sonnet non-round tokens with cache");

  // Haiku: input 1, output 5 per MTok
  const haikuFormula = (input: number, output: number, cached: number): number => {
    return Math.round((input * 1 + cached * 1 * 0.1 + output * 5) / 1_000_000 * 1_000_000);
  };
  assert.equal(costMicros({ model: "claude-haiku-4-5", input: 1_000_000, output: 1_000_000, cached: 0 }), haikuFormula(1_000_000, 1_000_000, 0), "Haiku 1M+1M+0");
  assert.equal(costMicros({ model: "claude-haiku-4-5", input: 99_999, output: 88_888, cached: 77_777 }), haikuFormula(99_999, 88_888, 77_777), "Haiku non-round tokens with cache");

  // Unknown model falls back to Opus pricing
  assert.equal(costMicros({ model: "claude-future-9", input: 100_000, output: 50_000, cached: 10_000 }), opusFormula(100_000, 50_000, 10_000), "unknown model falls back to Opus");

  // Test: dynamic model pricing via rememberModelPrices and priceOf
  const openrouterModels: ModelInfo[] = [
    { id: "meta-llama/llama-2-7b", label: "Llama 2 7B", capabilities: { vision: false, json: true, tools: true }, usdPerMTok: { in: 0.001, out: 0.002 } },
    { id: "mistralai/mistral-7b", label: "Mistral 7B", capabilities: { vision: false, json: true, tools: true }, usdPerMTok: { in: 0.0005, out: 0.0015 } },
  ];
  rememberModelPrices("openrouter", openrouterModels);
  assert.deepEqual(priceOf("meta-llama/llama-2-7b", "openrouter"), { input: 0.001, output: 0.002 }, "rememberModelPrices stores model prices");
  assert.deepEqual(priceOf("mistralai/mistral-7b", "openrouter"), { input: 0.0005, output: 0.0015 }, "remembered price is used");
  assert.equal(modelEntry("meta-llama/llama-2-7b", "openrouter")?.vision, false, "remembered model info includes capabilities");

  assert.equal(costMicros({ model: "meta-llama/llama-2-7b", provider: "openrouter", input: 1_000_000, output: 1_000_000, cached: 0 }), 3_000, "costMicros prices a remembered model at its listed price");

  // The derived tables read exactly as the literals they replaced (#512, run.ts before #515).
  assert.deepEqual(PRICES, { "claude-opus-5": { input: 5, output: 25 }, "claude-sonnet-5-5": { input: 2, output: 10 }, "claude-haiku-4-5": { input: 1, output: 5 } }, "PRICES changed");
  assert.deepEqual(ANTHROPIC_MODELS, {
    "claude-opus-5": { label: "Claude Opus 5", effort: true, adaptiveThinking: true, vision: true },
    "claude-sonnet-5-5": { label: "Claude Sonnet 5.5", effort: true, adaptiveThinking: true, vision: true },
    "claude-haiku-4-5": { label: "Claude Haiku 4.5", effort: false, adaptiveThinking: false, vision: true },
  }, "ANTHROPIC_MODELS changed");
  assert.deepEqual(ANTHROPIC_TIERS, { fast: "claude-haiku-4-5", standard: "claude-sonnet-5-5", best: "claude-opus-5" }, "ANTHROPIC_TIERS changed");

  // Test: priceOf falls back to Opus when model not found
  assert.deepEqual(priceOf("unknown-model", "openrouter"), { input: 5, output: 25 }, "priceOf falls back to Opus for unknown model");

  await db.delete(schema.aiRuns).where(eq(schema.aiRuns.id, aiResult.id));
  await db.delete(schema.aiRuns).where(eq(schema.aiRuns.id, legacy.id));
}
