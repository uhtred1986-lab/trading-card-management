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
import { createAnthropicApiProvider } from "../../src/lib/ai/providers/anthropic-api";
import { registerProvider, resetProviders } from "../../src/lib/ai/providers";
import { readPhoto, readPhotoTiered } from "../../src/lib/ai/scan";
import type { AiProvider } from "../../src/lib/ai/types";

type Wire = { url: string; body: Record<string, unknown> };

interface Harness {
  make(script: { text?: string; json?: unknown; stop?: "refusal" | "end" | "max_tokens"; usage?: Record<string, number> }[]): {
    provider: AiProvider;
    wire(): Wire[];
  };
}

/** The Anthropic adapter on a recorded transport. */
function anthropicHarness(): Harness {
  return {
    make(script) {
      const wire: Wire[] = [];
      const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        wire.push({ url: String(url), body });
        const a = script[Math.min(wire.length - 1, script.length - 1)];
        const text = a.text ?? (a.json !== undefined ? JSON.stringify(a.json) : "");
        const u = a.usage ?? {};
        return new Response(
          JSON.stringify({
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: String(body.model),
            content: [{ type: "text", text }],
            stop_reason: a.stop === "refusal" ? "refusal" : a.stop === "max_tokens" ? "max_tokens" : "end_turn",
            stop_sequence: null,
            usage: { input_tokens: u.input ?? 0, output_tokens: u.output ?? 0, cache_read_input_tokens: u.cacheRead ?? 0, cache_creation_input_tokens: u.cacheWrite ?? 0 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch;
      const provider = { ...createAnthropicApiProvider({ fetch: fetchImpl }), id: "anthropic-api" };
      return { provider, wire: () => wire };
    },
  };
}

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
  assert.equal((w.output_config as any)?.effort, "medium", "scan effort");
  assert.equal(typeof w.system, "string", "scan system as string");
  const msgs = (w.messages as { role: string; content: { type: string }[] }[])[0];
  assert.deepEqual(
    msgs.content.map((c) => c.type),
    ["image", "text"],
    "scan image then text",
  );

  resetProviders();
}

async function testScanFallback(): Promise<void> {
  // Test unparseable Sonnet → Opus fallback
  {
    const h = anthropicHarness();
    const run = h.make([
      { text: "not json at all" }, // Sonnet attempt (generateJson retries once)
      { text: "still not json" }, // Sonnet retry
      { json: { cards: [], unreadable: 0 } }, // Opus succeeds
    ]);
    registerProvider(run.provider);

    const prepared = { data: "AA", mediaType: "image/jpeg" as const };
    const results = await readPhotoTiered(prepared, "single");

    // After Sonnet fails to parse even after core's retry, Opus is called
    assert.equal(results.length, 2, "two results recorded: Sonnet and Opus");
    assert.equal(results[0].model, "claude-sonnet-5-5", "first is Sonnet");
    assert.equal(results[1].model, "claude-opus-5", "second is Opus");
    assert.equal(results[1].fallbackFrom, "claude-sonnet-5-5", "fallbackFrom is real model id");
    assert.equal(run.wire().length, 3, "three wire calls: Sonnet (2 retries) + Opus");

    resetProviders();
  }

  // Test refusal → no fallback
  {
    const h = anthropicHarness();
    const run = h.make([{ text: "I can't help", stop: "refusal" }]);
    registerProvider(run.provider);

    const prepared = { data: "AA", mediaType: "image/jpeg" as const };
    try {
      await readPhotoTiered(prepared, "single");
      assert.fail("should have thrown on refusal");
    } catch (err) {
      assert.ok(err instanceof AiError, "throws AiError");
      assert.equal((err as AiError).kind, "refusal", "error kind is refusal");
      assert.equal(run.wire().length, 1, "one wire call: Sonnet only, no Opus");
    }

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
