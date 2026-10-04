/**
 * The AI contract suite (`src/lib/ai/`, docs/architecture/ai-providers.md).
 *
 * One set of checks runs against every adapter: text, image, JSON (valid;
 * invalid, one retry, then `bad_output`), refusal, error mapping, usage mapping
 * and `billed`. The harness feeds each adapter the same scripted answers — the
 * fake provider directly, the Anthropic adapter through a recorded transport
 * (a `fetch` that answers in Anthropic's wire format and writes down what it
 * was sent) — so nothing here can reach a network, a key or Neon.
 *
 * Then the Anthropic-only checks: the request each option produces (cache
 * hints, effort and thinking dropped on Haiku), and the cart explainer
 * pilot sending the request it sent before the contract existed
 * (`fixtures/cart-explain-request.json`, recorded from the old code at
 * `5a55bca`).
 *
 * Part of `npm test`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { z } from "zod";
import { generate, generateJson } from "../../src/lib/ai/core";
import { AiError, describeAiError, type AiErrorKind } from "../../src/lib/ai/errors";
import { recordRun } from "../../src/lib/ai/client";
import { explainCart } from "../../src/lib/ai/cart";
import { createAnthropicApiProvider } from "../../src/lib/ai/providers/anthropic-api";
import { createFakeProvider, type FakeAnswer } from "../../src/lib/ai/providers/fake";
import { registerProvider, resetProviders } from "../../src/lib/ai/providers";
import type { AiProvider, AiRequest } from "../../src/lib/ai/types";

type Wire = { url: string; body: Record<string, unknown> };

/** What a check needs of an adapter under test: a provider that plays a script, and the requests it saw. */
interface Harness {
  name: string;
  make(script: FakeAnswer[]): { provider: AiProvider; sent(): AiRequest[]; wire(): Wire[] };
}

const fakeHarness: Harness = {
  name: "fake",
  make(script) {
    const p = createFakeProvider({ id: "under-test", script });
    return { provider: p, sent: () => p.requests, wire: () => [] };
  },
};

const STATUS: Partial<Record<AiErrorKind, { status: number; type: string; message: string }>> = {
  auth: { status: 401, type: "authentication_error", message: "invalid x-api-key" },
  rate_limit: { status: 429, type: "rate_limit_error", message: "slow down" },
  usage_limit: { status: 400, type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." },
  provider: { status: 500, type: "api_error", message: "internal error" },
};

/** The Anthropic adapter on a recorded transport that answers each script entry in Anthropic's wire format. */
function anthropicHarness(): Harness {
  return {
    name: "anthropic-api",
    make(script) {
      const wire: Wire[] = [];
      const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        wire.push({ url: String(url), body });
        const a = script[Math.min(wire.length - 1, script.length - 1)];
        if (a.error) {
          const e = STATUS[a.error.kind] ?? { status: 500, type: "api_error", message: a.error.message };
          return new Response(JSON.stringify({ type: "error", error: { type: e.type, message: e.message } }), { status: e.status, headers: { "content-type": "application/json" } });
        }
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
      const provider = createAnthropicApiProvider({ fetch: fetchImpl });
      // The same provider under the id the checks pin, so `route` finds it.
      const pinned: AiProvider = { ...provider, id: "under-test" };
      return { provider: pinned, sent: () => [], wire: () => wire };
    },
  };
}

const Answer = z.object({ move: z.number(), say: z.string().nullable() });
const text = (t: string) => [{ type: "text" as const, text: t }];
const ask = (over: Partial<AiRequest> = {}): AiRequest => ({ task: "cart_explain", tier: "fast", system: [{ text: "sys" }], messages: [{ role: "user", parts: text("hi") }], maxTokens: 100, provider: "under-test", ...over });

async function rejects(p: Promise<unknown>, kind: AiErrorKind): Promise<AiError> {
  try {
    await p;
  } catch (err) {
    assert.ok(err instanceof AiError, `expected an AiError (${kind}), got ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    assert.equal(err.kind, kind, `expected ${kind}, got ${err.kind}: ${err.message}`);
    return err;
  }
  assert.fail(`expected an AiError (${kind}), but the call succeeded`);
}

async function contractSuite(h: Harness): Promise<void> {
  const play = (script: FakeAnswer[]) => {
    const run = h.make(script);
    registerProvider(run.provider);
    return run;
  };
  const tag = (s: string) => `${h.name}: ${s}`;

  // Text, with usage and billed mapped through.
  {
    play([{ text: "hello there", usage: { input: 11, output: 22, cacheRead: 33, cacheWrite: 44 } }]);
    const r = await generate(ask());
    assert.equal(r.text, "hello there", tag("text"));
    assert.equal(r.stop, "end", tag("stop"));
    assert.deepEqual(r.usage, { input: 11, output: 22, cacheRead: 33, cacheWrite: 44 }, tag("usage incl. cache tokens"));
    assert.equal(r.billed, true, tag("billed"));
    assert.equal(typeof r.latencyMs, "number", tag("latency"));
  }

  // An image goes in as an image part.
  {
    const run = play([{ text: "a card" }]);
    const r = await generate(ask({ task: "scan_identify", tier: "standard", messages: [{ role: "user", parts: [{ type: "image", mediaType: "image/jpeg", base64: "AAAA" }, ...text("which card?")] }] }));
    assert.equal(r.text, "a card", tag("image answer"));
    const sent = run.wire()[0]?.body.messages as { content: { type: string }[] }[] | undefined;
    if (sent) assert.deepEqual(sent[0].content.map((c) => c.type), ["image", "text"], tag("image part order on the wire"));
  }

  // JSON, valid: validated by core, `parsed` is the schema's output.
  {
    play([{ json: { move: 2, say: null } }]);
    const r = await generateJson({ ...ask(), schema: Answer });
    assert.deepEqual(r.parsed, { move: 2, say: null }, tag("valid JSON parsed"));
  }

  // JSON in a fence, or with prose around it, is still read.
  {
    play([{ text: 'Sure:\n```json\n{"move":1,"say":"ok"}\n```' }]);
    const r = await generateJson({ ...ask(), schema: Answer });
    assert.deepEqual(r.parsed, { move: 1, say: "ok" }, tag("fenced JSON"));
  }

  // JSON, invalid → one retry that carries the error → valid. Usage adds up.
  {
    const run = play([
      { text: '{"move":"two"}', usage: { input: 10, output: 5 } },
      { json: { move: 2, say: null }, usage: { input: 20, output: 7 } },
    ]);
    const r = await generateJson({ ...ask(), schema: Answer });
    assert.deepEqual(r.parsed, { move: 2, say: null }, tag("retry produced the answer"));
    assert.deepEqual(r.usage, { input: 30, output: 12, cacheRead: 0, cacheWrite: 0 }, tag("both attempts are paid for"));
    const seen = run.sent().length || run.wire().length;
    assert.equal(seen, 2, tag("exactly one retry"));
    const second = run.sent()[1]?.messages ?? (run.wire()[1].body.messages as { role: string; content: unknown }[]).map((m) => ({ role: m.role }));
    assert.deepEqual(second.map((m) => m.role), ["user", "assistant", "user"], tag("the retry shows the model its rejected answer"));
  }

  // JSON, invalid twice → bad_output, and not a third try.
  {
    const run = play([{ text: "not json at all" }]);
    await rejects(generateJson({ ...ask(), schema: Answer }), "bad_output");
    assert.equal(run.sent().length || run.wire().length, 2, tag("one retry, no more"));
  }

  // A cut-off answer is not retried.
  {
    const run = play([{ text: '{"move":', stop: "max_tokens" }]);
    await rejects(generateJson({ ...ask(), schema: Answer }), "bad_output");
    assert.equal(run.sent().length || run.wire().length, 1, tag("max_tokens is not retried"));
  }

  // Refusal.
  {
    play([{ text: "I can't help with that.", stop: "refusal" }]);
    const r = await generate(ask());
    assert.equal(r.stop, "refusal", tag("stop: refusal"));
    await rejects(generateJson({ ...ask(), schema: Answer }), "refusal");
  }

  // Errors, as kinds.
  for (const kind of ["auth", "rate_limit", "usage_limit", "provider"] as const) {
    play([{ error: new AiError(kind, "scripted", { provider: "under-test" }) }]);
    const err = await rejects(generate(ask()), kind);
    assert.ok(describeAiError(err).length > 0, tag(`${kind} has a message`));
  }

  // The recorded exact words a user reads for the three Anthropic errors are the ones the SDK path showed.
  if (h.name === "anthropic-api") {
    play([{ error: new AiError("auth", "x") }]);
    assert.equal(describeAiError(await rejects(generate(ask()), "auth")), "Anthropic API key was rejected.");
    play([{ error: new AiError("rate_limit", "x") }]);
    assert.equal(describeAiError(await rejects(generate(ask()), "rate_limit")), "Rate limited by Anthropic — try again in a moment.");
    play([{ error: new AiError("provider", "x") }]);
    // The SDK's own message follows the status, as it did before the contract.
    assert.match(describeAiError(await rejects(generate(ask()), "provider")), /^Anthropic API error 500: .*internal error/);
  }
}

/** The Anthropic request for each option, read off the recorded transport. */
async function anthropicRequests(): Promise<void> {
  const body = async (req: Partial<AiRequest>, script: FakeAnswer[] = [{ text: "ok" }]): Promise<Record<string, unknown>> => {
    const run = anthropicHarness().make(script);
    registerProvider(run.provider);
    await generate(ask(req));
    return run.wire()[0].body;
  };

  // Haiku has neither effort nor adaptive thinking, so neither is sent — even when asked for.
  let b = await body({ tier: "fast", effort: "high", thinking: "adaptive" });
  assert.equal(b.model, "claude-haiku-4-5");
  assert.equal(b.thinking, undefined, "adaptive thinking dropped on Haiku");
  assert.equal(b.output_config, undefined, "effort dropped on Haiku");

  // Sonnet and Opus take both.
  for (const [tier, model] of [["standard", "claude-sonnet-5-5"], ["best", "claude-opus-5"]] as const) {
    b = await body({ tier, effort: "medium", thinking: "adaptive" });
    assert.equal(b.model, model);
    assert.deepEqual(b.thinking, { type: "adaptive" }, `${model}: adaptive thinking`);
    assert.deepEqual(b.output_config, { effort: "medium" }, `${model}: effort`);
  }
  // An explicit model wins over the tier; asked-for nothing, sent nothing.
  b = await body({ tier: "fast", model: "claude-opus-5" });
  assert.equal(b.model, "claude-opus-5");
  assert.equal(b.thinking, undefined);
  assert.equal(b.output_config, undefined);
  // A model the table does not know is sent no effort and no thinking.
  b = await body({ model: "claude-future-9", tier: undefined, effort: "high", thinking: "adaptive" });
  assert.equal(b.thinking, undefined);
  assert.equal(b.output_config, undefined);
  await rejects(body({ tier: undefined, model: undefined }), "unsupported");

  // Cache hints: none → a plain string; short → ephemeral; long → ephemeral with the 1 h TTL.
  b = await body({ system: [{ text: "plain" }] });
  assert.equal(b.system, "plain");
  b = await body({
    system: [
      { text: "pool", cache: "short" },
      { text: "language", cache: "long" },
      { text: "tail" },
    ],
  });
  assert.deepEqual(b.system, [
    { type: "text", text: "pool", cache_control: { type: "ephemeral" } },
    { type: "text", text: "language", cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: "tail" },
  ]);

  // JSON asks for the schema natively.
  b = await body({ output: { kind: "json", schema: Answer } }, [{ json: { move: 1, say: null } }]);
  const fmt = (b.output_config as { format: { type: string; schema: { properties: Record<string, unknown> } } }).format;
  assert.equal(fmt.type, "json_schema");
  assert.deepEqual(Object.keys(fmt.schema.properties), ["move", "say"]);

  // A provider without vision is not sent an image — it fails as `unsupported`, never a quiet downgrade.
  registerProvider(createFakeProvider({ id: "under-test", capabilities: { vision: false }, script: [{ text: "x" }] }));
  await rejects(generate(ask({ messages: [{ role: "user", parts: [{ type: "image", mediaType: "image/png", base64: "AA" }] }] })), "unsupported");
  registerProvider(createFakeProvider({ id: "under-test", capabilities: { json: false }, script: [{ text: "x" }] }));
  await rejects(generateJson({ ...ask(), schema: Answer }), "unsupported");
  await rejects(generate(ask({ provider: "nobody" })), "unavailable");
}

/** The pilot: the cart explainer sends what it sent before, and `ai_runs` gets the same row. */
async function cartPilot(): Promise<void> {
  const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/cart-explain-request.json", import.meta.url), "utf8")) as { request: unknown; run: unknown };
  const run = anthropicHarness().make([{ json: { recommendation: "Pick the cheapest.", tradeoffs: ["one"], warnings: [] }, usage: { input: 10, output: 20 } }]);
  registerProvider({ ...run.provider, id: "anthropic-api" });
  const plan = { totalCents: 1500, sellers: [{ seller: "ShopA", country: "AT", itemsCents: 1200, shippingCents: 300, lines: [{ quantity: 2, listing: { cardId: "BT1-001", priceCents: 600, condition: "NM" } }] }], missing: [{ cardId: "BT1-002", quantity: 1 }] };
  const rows: unknown[] = [];
  const db = { insert: () => ({ values: (v: unknown) => ({ returning: async () => (rows.push(v), [{ id: 7 }]) }) }) };
  const out = await explainCart(db as never, plan as never, null, "no vacationing sellers");
  assert.equal(out.runId, 7);
  assert.deepEqual(run.wire()[0].body, fixture.request, "the cart explainer's request changed: model, no thinking/effort, schema, prompt and message shape must stay as recorded");
  assert.deepEqual(rows[0], fixture.run, "the cart_explain ai_runs row changed shape");
}

/** `recordRun` still takes the SDK-shaped response the unmoved feature modules hand it. */
async function recordRunShapes(): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  const db = { insert: () => ({ values: (v: Record<string, unknown>) => ({ returning: async () => (rows.push(v), [{ id: rows.length }]) }) }) };
  await recordRun(db as never, "deck_builder", { a: 1 }, { parsed_output: { ok: true }, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: null } });
  assert.equal(rows[0].model, "claude-opus-5");
  assert.equal(rows[0].cacheReadTokens, null);
  await recordRun(db as never, "arena_teach", {}, { text: "{}", parsed: { ok: true }, stop: "end", usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, provider: "anthropic-api", model: "claude-opus-5", billed: true, latencyMs: 1 });
  assert.deepEqual([rows[1].inputTokens, rows[1].outputTokens, rows[1].cacheReadTokens, rows[1].cacheCreationTokens], [1, 2, 3, 4]);
  await assert.rejects(recordRun(db as never, "arena_teach", {}, { text: "", stop: "refusal", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, provider: "x", model: "m", billed: true, latencyMs: 0 }), /declined/);
}

async function main(): Promise<void> {
  try {
    await contractSuite(fakeHarness);
    await contractSuite(anthropicHarness());
    await anthropicRequests();
    await cartPilot();
    await recordRunShapes();
  } finally {
    resetProviders();
  }
  console.log("  ai-contract: text, image, JSON (valid / retry / bad_output), refusal, errors, usage and billed on the fake and on the Anthropic adapter (recorded transport); request shapes; the cart explainer sends its recorded request");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
