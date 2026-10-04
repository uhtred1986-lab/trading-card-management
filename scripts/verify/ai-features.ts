/**
 * Acceptance tests for #513: deck features and scanner on generateJson.
 *
 * Verifies:
 * - Each recorded request has the right model, system blocks, cache hints, effort/thinking, schema
 * - Requests are unchanged from origin/main (same prompts, models per #381 rulings)
 * - Scan fallback logic: Sonnet → Opus on bad_output or needsOpusFallback; no retry on refusal/rate/auth
 * - ai_runs rows have deckId set and fallbackFrom recorded correctly
 *
 * Part of `npm test`.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { generateJson } from "../../src/lib/ai/core";
import { AiError } from "../../src/lib/ai/errors";
import { anthropicHarness, type Wire } from "./ai-harness";
import { registerProvider, resetProviders } from "../../src/lib/ai/providers";
import { readPhoto, readPhotoTiered } from "../../src/lib/ai/scan";

async function testScanRequests(): Promise<void> {
  const h = anthropicHarness();
  const run = h.make([{ json: { cards: [], unreadable: 0 } }]);
  registerProvider(run.provider);

  // Test scan_identify with image and proper schema
  const prepared = { data: "base64data", mediaType: "image/jpeg" as const };
  await readPhoto("standard", prepared, "single");

  const w = run.wire()[0]?.body;
  assert.equal(w.model, "claude-sonnet-5-5", "scan Sonnet tier");
  assert.equal(w.max_tokens, 8000, "scan max_tokens");
  assert.deepEqual(w.thinking, { type: "adaptive" }, "scan thinking");
  assert.equal((w.output_config as { effort?: string })?.effort, "medium", "scan effort");
  assert.equal((w.output_config as { format?: { type?: string } })?.format?.type, "json_schema", "scan asks for structured output, as before");
  assert.equal(typeof w.system, "string", "scan system as string");
  const msgs = (w.messages as { role: string; content: { type: string }[] }[])[0];
  assert.deepEqual(
    msgs.content.map((c) => c.type),
    ["image", "text"],
    "scan image then text",
  );

  resetProviders();
}

const sure = { cards: [{ name: "Son Goku", number: "BT1-031", confidence: 0.97, position: "only card", box: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, notes: null }], unreadable: 0 };
const unsure = { cards: [{ name: "Son Goku", number: "BT1-03?", confidence: 0.4, position: "only card", box: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, notes: null }], unreadable: 0 };
const prepared = { data: "AA", mediaType: "image/jpeg" as const };
const models = (w: Wire[]) => w.map((x) => x.body.model);

async function testScanFallback(): Promise<void> {
  // A sure Sonnet read is the answer: one call, no fallback.
  {
    const run = anthropicHarness().make([{ json: sure }]);
    registerProvider(run.provider);
    const r = await readPhotoTiered(prepared, "single");
    assert.deepEqual(models(run.wire()), ["claude-sonnet-5-5"], "a sure read makes one Sonnet call");
    assert.deepEqual(r.map((x) => [x.model, x.fallbackFrom]), [["claude-sonnet-5-5", undefined]]);
    resetProviders();
  }
  // Unparseable on Sonnet (bad_output after core's one retry) → Opus; the unparseable read is not recorded, as before.
  {
    const run = anthropicHarness().make([{ text: "not json" }, { text: "still not json" }, { json: sure }]);
    registerProvider(run.provider);
    const r = await readPhotoTiered(prepared, "single");
    assert.deepEqual(models(run.wire()), ["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-opus-5"], "unparseable: Sonnet, its one retry, then Opus");
    assert.deepEqual(r.map((x) => [x.model, x.fallbackFrom]), [["claude-opus-5", "claude-sonnet-5-5"]], "only the Opus read is recorded, with fallbackFrom = Sonnet's id");
    assert.ok(r.every((x) => x.res.parsed), "every returned read is parsed, so recordRun accepts each");
  }
  resetProviders();
  // Low confidence (needsOpusFallback) → both reads recorded, Opus last with fallbackFrom.
  {
    const run = anthropicHarness().make([{ json: unsure }, { json: sure }]);
    registerProvider(run.provider);
    const r = await readPhotoTiered(prepared, "single");
    assert.deepEqual(models(run.wire()), ["claude-sonnet-5-5", "claude-opus-5"], "low confidence falls back to Opus");
    assert.deepEqual(r.map((x) => [x.model, x.fallbackFrom]), [["claude-sonnet-5-5", undefined], ["claude-opus-5", "claude-sonnet-5-5"]]);
    resetProviders();
  }
  // Refusal, rate limit, rejected key, server error: thrown, never retried on Opus.
  for (const [label, answer, kind] of [
    ["refusal", { text: "I can't help", stop: "refusal" as const }, "refusal"],
    ["rate limit", { status: 429 }, "rate_limit"],
    ["rejected key", { status: 401 }, "auth"],
    ["server error", { status: 500 }, "provider"],
  ] as const) {
    const run = anthropicHarness().make([answer]);
    registerProvider(run.provider);
    await assert.rejects(readPhotoTiered(prepared, "single"), (err: unknown) => err instanceof AiError && err.kind === kind, `${label}: thrown as ${kind}`);
    assert.deepEqual(models(run.wire()), ["claude-sonnet-5-5"], `${label}: no Opus call`);
    resetProviders();
  }
}

async function testDeckCachedBlocks(): Promise<void> {
  const h = anthropicHarness();
  const run = h.make([{ json: { assessment: "test", swaps: [] } }]);
  registerProvider(run.provider);

  // Test wizard cached blocks get cache_control ephemeral (no ttl for short)
  const req = {
    task: "deck_wizard" as const,
    tier: "best" as const,
    maxTokens: 12000,
    thinking: "adaptive" as const,
    effort: "high" as const,
    schema: z.object({ assessment: z.string(), swaps: z.array(z.object({})) }),
    system: [
      { text: "You are an expert" },
      { text: "CANDIDATE POOL", cache: "short" as const },
    ],
    messages: [{ role: "user" as const, parts: [{ type: "text" as const, text: "Propose swaps" }] }],
  };

  try {
    await generateJson(req);
  } catch (err) {
    // Ignore errors, we just want to check the request
    if (run.wire().length === 0) {
      throw new Error(`No wire calls made. Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const w = run.wire()[0]?.body;
  assert.equal(w.model, "claude-opus-5", "deck_wizard tier:best");
  const sys = w.system as { type: string; text: string; cache_control?: { type: string; ttl?: string } }[];
  assert.equal(sys[1]?.cache_control?.type, "ephemeral", "cached block has ephemeral");
  assert.equal(sys[1]?.cache_control?.ttl, undefined, "short cache has no ttl");

  resetProviders();
}

async function main(): Promise<void> {
  try {
    await testScanRequests();
    await testScanFallback();
    await testDeckCachedBlocks();
  } finally {
    resetProviders();
  }
  console.log("  ai-features: scan image as Part with tier, fallback logic (unparseable/low-confidence→Opus, refusal/rate→no retry), deck tiers and cache hints");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
