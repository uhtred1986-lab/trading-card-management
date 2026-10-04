/**
 * #520: the OpenRouter adapter, with no network and no key.
 *
 * The contract suite's cases (text, image, JSON valid / retry / bad_output with
 * and without `structured_outputs`, refusal, error mapping, usage with cached
 * tokens, `billed`) on a recorded transport that answers in OpenRouter's wire
 * format; reasoning and cache hints only where a model allows them; the
 * `GET /models` parsing, prices per MTok and the one-hour cache; `available()`;
 * routing (global, per task, a text-only model); and the arena's legal-move
 * validation on an OpenRouter model. The fixtures are shaped like the documented
 * responses (https://openrouter.ai/docs, see the PR for #520).
 *
 * Part of `npm test`.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { generate, generateJson } from "../../src/lib/ai/core";
import { explainCart } from "../../src/lib/ai/cart";
import { AiError, describeAiError, type AiErrorKind } from "../../src/lib/ai/errors";
import { costMicros, priceOf } from "../../src/lib/ai/models";
import { createOpenRouterProvider, perMTok } from "../../src/lib/ai/providers/openrouter";
import { createFakeProvider } from "../../src/lib/ai/providers/fake";
import { registerProvider, resetProviders } from "../../src/lib/ai/providers";
import { forgetAvailability, resolve } from "../../src/lib/ai/router";
import { NO_SETTINGS, setSettingsLoader, type AiSettings } from "../../src/lib/ai/settings";
import { pickable, needsOf } from "../../src/lib/ai/catalog";
import { chooseMove } from "../../src/lib/arena/ai/opponent";
import { defsFrom } from "../../src/lib/arena/vm/common";
import { engineFor } from "../../src/lib/arena/engines";
import { zoneOf } from "../../src/lib/arena/engine-state";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { AiProvider, AiRequest } from "../../src/lib/ai/types";
import { anthropicHarness } from "./ai-harness";

const KEY = "sk-or-test-not-a-real-key";
const SONNET = "anthropic/claude-sonnet-5.5"; // images, structured_outputs, reasoning, cache_control
const MINI = "openai/gpt-x-mini"; // structured_outputs, no reasoning, no images
const PLAIN = "meta/plain-text"; // text only, no structured_outputs
const SEER = "vendor/seer"; // images, no structured_outputs

/** Shaped like the documented `GET /api/v1/models` response (prices are strings, USD per token). */
const MODELS_FIXTURE = {
  data: [
    {
      id: SONNET,
      canonical_slug: SONNET,
      name: "Anthropic: Claude Sonnet 5.5",
      created: 1760000000,
      context_length: 1000000,
      pricing: { prompt: "0.000002", completion: "0.00001", request: "0", image: "0", input_cache_read: "0.0000002", input_cache_write: "0.0000025" },
      architecture: { modality: "text+image->text", input_modalities: ["text", "image"], output_modalities: ["text"], tokenizer: "Claude" },
      top_provider: { context_length: 1000000, max_completion_tokens: 64000, is_moderated: true },
      supported_parameters: ["max_tokens", "temperature", "reasoning", "include_reasoning", "structured_outputs", "response_format", "tools"],
    },
    {
      id: MINI,
      name: "OpenAI: GPT X mini",
      context_length: 128000,
      pricing: { prompt: "0.00000015", completion: "0.0000006", request: "0", image: "0" },
      architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["max_tokens", "structured_outputs", "response_format"],
    },
    {
      id: PLAIN,
      name: "Meta: Plain text",
      context_length: 8192,
      pricing: { prompt: "0", completion: "0" },
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["max_tokens", "temperature"],
    },
    {
      id: SEER,
      name: "Vendor: Seer",
      context_length: 32000,
      pricing: { prompt: "0.000001", completion: "0.000003" },
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      supported_parameters: ["max_tokens"],
    },
    { id: "openrouter/auto", name: "Auto Router", context_length: 2000000, pricing: { prompt: "-1", completion: "-1" }, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["max_tokens"] },
    { id: "vendor/painter", name: "Painter", context_length: 4000, pricing: { prompt: "0.000001", completion: "0.000001" }, architecture: { input_modalities: ["text"], output_modalities: ["image"] }, supported_parameters: [] },
  ],
};

interface Step {
  text?: string;
  json?: unknown;
  stop?: "end" | "max_tokens" | "refusal";
  /** `refusal` carries the model's refusal text in `message.refusal`. */
  refusalField?: string;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  status?: number;
  /** A 200 whose body is an error. */
  errorIn200?: { code: number; message: string };
  errorInChoice?: { code: number; message: string };
  throws?: boolean;
}

interface Chat {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface Run {
  provider: AiProvider;
  chat: Chat[];
  hits: { models: number; key: number };
  setNow(ms: number): void;
  failModels(on: boolean): void;
  keyStatus(n: number): void;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The OpenRouter adapter on a recorded transport: `/models` from the fixture, `/key`, and `/chat/completions` from the script. */
function make(script: Step[], opts: { apiKey?: string } = {}): Run {
  const chat: Chat[] = [];
  const hits = { models: 0, key: 0 };
  let clock = 1_000_000;
  let modelsDown = false;
  let keyStatus = 200;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    if (u.endsWith("/models")) {
      hits.models++;
      return modelsDown ? json({ error: { code: 500, message: "down" } }, 500) : json(MODELS_FIXTURE);
    }
    if (u.endsWith("/key")) {
      hits.key++;
      return json(keyStatus === 200 ? { data: {} } : { error: { code: keyStatus, message: "no" } }, keyStatus);
    }
    assert.ok(u.endsWith("/chat/completions"), `unexpected URL ${u}`);
    chat.push({ url: u, headers, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    const a = script[Math.min(chat.length - 1, script.length - 1)];
    if (a.throws) throw new TypeError("fetch failed");
    if (a.status) return json({ error: { code: a.status, message: `stubbed ${a.status}` } }, a.status);
    if (a.errorIn200) return json({ error: a.errorIn200 });
    const text = a.text ?? (a.json !== undefined ? JSON.stringify(a.json) : "");
    const us = a.usage ?? {};
    const finish = a.stop === "refusal" ? "content_filter" : a.stop === "max_tokens" ? "length" : "stop";
    return json({
      id: "gen-test",
      model: JSON.parse(String(init?.body ?? "{}")).model,
      choices: [{ index: 0, finish_reason: finish, ...(a.errorInChoice ? { error: a.errorInChoice } : {}), message: { role: "assistant", content: text, ...(a.refusalField ? { refusal: a.refusalField } : {}) } }],
      usage: {
        prompt_tokens: (us.input ?? 0) + (us.cacheRead ?? 0) + (us.cacheWrite ?? 0),
        completion_tokens: us.output ?? 0,
        total_tokens: (us.input ?? 0) + (us.output ?? 0),
        prompt_tokens_details: { cached_tokens: us.cacheRead ?? 0, cache_write_tokens: us.cacheWrite ?? 0 },
        cost: 0.001,
      },
    });
  }) as typeof fetch;
  // A mutable clock so the one-hour cache can be crossed without waiting.
  const provider = createOpenRouterProvider({ fetch: fetchImpl, apiKey: opts.apiKey ?? KEY, now: () => clock });
  return {
    provider,
    chat,
    hits,
    setNow: (ms) => {
      clock = ms;
    },
    failModels: (on) => {
      modelsDown = on;
    },
    keyStatus: (n) => {
      keyStatus = n;
    },
  };
}

const Answer = z.object({ move: z.number(), say: z.string().nullable() });
const text = (t: string) => [{ type: "text" as const, text: t }];
const ask = (over: Partial<AiRequest> = {}): AiRequest => ({ task: "cart_explain", model: MINI, system: [{ text: "sys" }], messages: [{ role: "user", parts: text("hi") }], maxTokens: 100, provider: "openrouter", ...over });

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

const play = (script: Step[]): Run => {
  const run = make(script);
  registerProvider(run.provider);
  return run;
};
const wireMessages = (c: Chat) => c.body.messages as { role: string; content: unknown }[];

async function contract(): Promise<void> {
  // Text, usage with cached tokens, billed.
  {
    const run = play([{ text: "hello there", usage: { input: 11, output: 22, cacheRead: 33, cacheWrite: 44 } }]);
    const r = await generate(ask());
    assert.equal(r.text, "hello there");
    assert.equal(r.stop, "end");
    assert.deepEqual(r.usage, { input: 11, output: 22, cacheRead: 33, cacheWrite: 44 }, "usage incl. cached tokens");
    assert.equal(r.billed, true);
    assert.equal(r.provider, "openrouter");
    assert.equal(r.model, MINI);
    assert.equal(typeof r.latencyMs, "number");
    const c = run.chat[0];
    assert.ok(c.url.endsWith("/api/v1/chat/completions"), c.url);
    assert.equal(c.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(c.body.model, MINI);
    assert.equal(c.body.max_tokens, 100);
    assert.deepEqual(wireMessages(c), [{ role: "system", content: "sys" }, { role: "user", content: "hi" }], "system blocks become the system message");
    assert.equal(c.body.reasoning, undefined);
    assert.equal(c.body.response_format, undefined);
  }

  // An image goes in as a data URL in an image_url part; a model without image input is refused before anything is sent.
  {
    const run = play([{ text: "a card" }]);
    const msgs = [{ role: "user" as const, parts: [{ type: "image" as const, mediaType: "image/jpeg" as const, base64: "AAAA" }, ...text("which card?")] }];
    const r = await generate(ask({ task: "scan_identify", model: SONNET, messages: msgs }));
    assert.equal(r.text, "a card");
    const content = wireMessages(run.chat[0])[1].content as { type: string; image_url?: { url: string }; text?: string }[];
    assert.deepEqual(content.map((c) => c.type), ["image_url", "text"]);
    assert.equal(content[0].image_url?.url, "data:image/jpeg;base64,AAAA");
    const blind = play([{ text: "x" }]);
    await rejects(generate(ask({ task: "scan_identify", model: PLAIN, messages: msgs })), "unsupported");
    assert.equal(blind.chat.length, 0, "nothing was sent to a text-only model");
  }

  // JSON, with and without native structured output.
  for (const [model, native] of [[MINI, true], [PLAIN, false]] as const) {
    const tag = `${model} (${native ? "structured_outputs" : "JSON in text"})`;
    let run = play([{ json: { move: 2, say: null } }]);
    let r = await generateJson({ ...ask({ model }), schema: Answer });
    assert.deepEqual(r.parsed, { move: 2, say: null }, `${tag}: valid`);
    const body = run.chat[0].body;
    if (native) {
      const rf = body.response_format as { type: string; json_schema: { name: string; strict: boolean; schema: { properties: Record<string, unknown>; $schema?: string } } };
      assert.equal(rf.type, "json_schema");
      assert.equal(rf.json_schema.strict, true);
      assert.ok(rf.json_schema.name);
      assert.deepEqual(Object.keys(rf.json_schema.schema.properties), ["move", "say"]);
      assert.equal(rf.json_schema.schema.$schema, undefined);
      assert.equal(wireMessages(run.chat[0])[0].content, "sys", `${tag}: the system prompt is untouched`);
    } else {
      assert.equal(body.response_format, undefined, `${tag}: no response_format on a model without structured_outputs`);
      assert.match(String(wireMessages(run.chat[0])[0].content), /JSON Schema[\s\S]*"move"/, `${tag}: the schema is in the prompt`);
    }

    // Fenced / padded JSON is read.
    play([{ text: 'Sure:\n```json\n{"move":1,"say":"ok"}\n```' }]);
    r = await generateJson({ ...ask({ model }), schema: Answer });
    assert.deepEqual(r.parsed, { move: 1, say: "ok" }, `${tag}: fenced`);

    // Invalid → one retry showing the rejected answer → valid; both attempts are paid for.
    run = play([{ text: '{"move":"two"}', usage: { input: 10, output: 5 } }, { json: { move: 2, say: null }, usage: { input: 20, output: 7 } }]);
    r = await generateJson({ ...ask({ model }), schema: Answer });
    assert.deepEqual(r.parsed, { move: 2, say: null }, `${tag}: retry`);
    assert.deepEqual(r.usage, { input: 30, output: 12, cacheRead: 0, cacheWrite: 0 });
    assert.equal(run.chat.length, 2);
    assert.deepEqual(wireMessages(run.chat[1]).map((m) => m.role), ["system", "user", "assistant", "user"], `${tag}: the retry carries the rejected answer`);

    // Invalid twice → bad_output, no third try. A cut-off answer is not retried.
    run = play([{ text: "not json at all" }]);
    await rejects(generateJson({ ...ask({ model }), schema: Answer }), "bad_output");
    assert.equal(run.chat.length, 2, `${tag}: one retry, no more`);
    run = play([{ text: '{"move":', stop: "max_tokens" }]);
    await rejects(generateJson({ ...ask({ model }), schema: Answer }), "bad_output");
    assert.equal(run.chat.length, 1, `${tag}: max_tokens is not retried`);
  }

  // Refusal: a content_filter finish, or a refusal on the message.
  {
    play([{ text: "I can't help with that.", stop: "refusal" }]);
    assert.equal((await generate(ask())).stop, "refusal");
    await rejects(generateJson({ ...ask(), schema: Answer }), "refusal");
    play([{ refusalField: "No.", text: "" }]);
    assert.equal((await generate(ask())).stop, "refusal");
    await rejects(generateJson({ ...ask(), schema: Answer }), "refusal");
  }

  // Errors → kinds, with words a person can read.
  for (const [status, kind] of [[401, "auth"], [402, "usage_limit"], [429, "rate_limit"], [500, "provider"], [502, "provider"], [503, "provider"]] as const) {
    play([{ status }]);
    const err = await rejects(generate(ask()), kind);
    assert.equal(err.status, status);
    assert.ok(describeAiError(err).length > 0);
  }
  play([{ status: 402 }]);
  assert.match(describeAiError(await rejects(generate(ask()), "usage_limit")), /OpenRouter usage limit reached/);
  play([{ status: 401 }]);
  assert.equal(describeAiError(await rejects(generate(ask()), "auth")), "OpenRouter API key was rejected.");
  // An error inside a 200, in the body or in the choice, maps by its own code.
  play([{ errorIn200: { code: 429, message: "upstream slow" } }]);
  await rejects(generate(ask()), "rate_limit");
  play([{ errorInChoice: { code: 502, message: "provider dropped" } }]);
  await rejects(generate(ask()), "provider");
  play([{ throws: true }]);
  await rejects(generate(ask()), "provider");
  // No key: unavailable, and nothing sent.
  const keyless = make([{ text: "x" }], { apiKey: "" });
  registerProvider(keyless.provider);
  await rejects(generate(ask()), "unavailable");
  assert.equal(keyless.chat.length, 0);
}

async function options(): Promise<void> {
  const body = async (req: Partial<AiRequest>): Promise<Record<string, unknown>> => {
    const run = play([{ text: "ok" }]);
    await generate(ask(req));
    return run.chat[0].body;
  };

  // reasoning only where the model lists it; effort wins, adaptive thinking alone enables; dropped elsewhere.
  assert.deepEqual((await body({ model: SONNET, effort: "high" })).reasoning, { effort: "high" });
  assert.deepEqual((await body({ model: SONNET, thinking: "adaptive" })).reasoning, { enabled: true });
  assert.equal((await body({ model: SONNET })).reasoning, undefined, "asked for nothing, sent nothing");
  for (const model of [MINI, PLAIN, "unlisted/model"]) assert.equal((await body({ model, effort: "high", thinking: "adaptive" })).reasoning, undefined, `${model}: reasoning dropped`);

  // cache_control only for Anthropic's family; a plain string everywhere else.
  const system = [{ text: "pool", cache: "short" as const }, { text: "language", cache: "long" as const }, { text: "tail" }];
  assert.deepEqual(wireMessages({ url: "", headers: {}, body: await body({ model: SONNET, system }) })[0].content, [
    { type: "text", text: "pool", cache_control: { type: "ephemeral" } },
    { type: "text", text: "language", cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: "tail" },
  ]);
  const other = await body({ model: MINI, system });
  assert.equal(wireMessages({ url: "", headers: {}, body: other })[0].content, "pool\n\nlanguage\n\ntail");
  assert.ok(!JSON.stringify(other).includes("cache_control"), "no cache hint leaves for a non-Anthropic model");
  // An Anthropic model with no hint still gets the plain string.
  assert.equal(wireMessages({ url: "", headers: {}, body: await body({ model: SONNET }) })[0].content, "sys");

  // App attribution: sent only when the app's URL is configured.
  const saved = [process.env.OPENROUTER_APP_URL, process.env.OPENROUTER_APP_TITLE];
  try {
    delete process.env.OPENROUTER_APP_URL;
    let run = play([{ text: "ok" }]);
    await generate(ask());
    assert.equal(run.chat[0].headers["HTTP-Referer"], undefined);
    process.env.OPENROUTER_APP_URL = "https://cards.example";
    run = play([{ text: "ok" }]);
    await generate(ask());
    assert.equal(run.chat[0].headers["HTTP-Referer"], "https://cards.example");
    assert.ok(run.chat[0].headers["X-OpenRouter-Title"]);
  } finally {
    for (const [i, k] of ["OPENROUTER_APP_URL", "OPENROUTER_APP_TITLE"].entries()) {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    }
  }
}

async function models(): Promise<void> {
  assert.equal(perMTok("0.000003"), 3);
  assert.equal(perMTok("0.00000015"), 0.15);
  assert.equal(perMTok("0"), 0);
  assert.equal(perMTok("-1"), undefined);
  assert.equal(perMTok(undefined), undefined);

  const run = make([{ text: "x" }]);
  const list = await run.provider.listModels();
  assert.deepEqual(list.map((m) => m.id), [SONNET, MINI, PLAIN, SEER, "openrouter/auto"], "an image-only model is not a chat model");
  const by = Object.fromEntries(list.map((m) => [m.id, m]));
  assert.deepEqual(by[SONNET], {
    id: SONNET,
    label: "Anthropic: Claude Sonnet 5.5",
    contextLength: 1000000,
    capabilities: { vision: true, json: true, tools: true },
    usdPerMTok: { in: 2, out: 10 },
  });
  assert.deepEqual(by[MINI].usdPerMTok, { in: 0.15, out: 0.6 });
  assert.deepEqual(by[MINI].capabilities, { vision: false, json: true, tools: false });
  assert.deepEqual(by[PLAIN].capabilities, { vision: false, json: false, tools: false });
  assert.deepEqual(by[PLAIN].usdPerMTok, { in: 0, out: 0 });
  assert.deepEqual(by[SEER].capabilities, { vision: true, json: false, tools: false });
  assert.equal(by["openrouter/auto"].usdPerMTok, undefined, "a router with no fixed price has none");

  // The picker (from #516) offers only models that give structured output, and for the scan only those that see.
  const picks = (task: Parameters<typeof needsOf>[0]) => pickable({ openrouter: list }, needsOf(task)).map((m) => m.id);
  assert.deepEqual(picks("cart_explain"), [SONNET, MINI]);
  assert.deepEqual(picks("scan_identify"), [SONNET]);

  // Prices reach priceOf / costMicros through rememberModelPrices.
  assert.deepEqual(priceOf(MINI, "openrouter"), { input: 0.15, output: 0.6 });
  assert.equal(costMicros({ model: MINI, provider: "openrouter", input: 1_000_000, output: 1_000_000, cached: 0 }), 750_000);

  // Cached for an hour; a failing refresh keeps the stale list.
  await run.provider.listModels();
  assert.equal(run.hits.models, 1, "second call is served from the cache");
  run.setNow(1_000_000 + 59 * 60 * 1000);
  await run.provider.listModels();
  assert.equal(run.hits.models, 1, "still fresh at 59 minutes");
  run.setNow(1_000_000 + 61 * 60 * 1000);
  run.failModels(true);
  assert.equal((await run.provider.listModels()).length, 5, "stale list kept when the refresh fails");
  assert.equal(run.hits.models, 2);
  run.failModels(false);
  await run.provider.listModels();
  assert.equal(run.hits.models, 3, "retried after the failure");
  // No list at all: the error says so.
  const down = make([{ text: "x" }]);
  down.failModels(true);
  await rejects(down.provider.listModels(), "provider");

  // available(): needs the key, checks it against /key once, cached.
  const nokey = make([{ text: "x" }], { apiKey: "" });
  assert.deepEqual(await nokey.provider.available(), { ok: false, reason: "OPENROUTER_API_KEY is not set." });
  assert.equal(nokey.hits.key, 0, "no call without a key");
  const ok = make([{ text: "x" }]);
  assert.deepEqual(await ok.provider.available(), { ok: true });
  await ok.provider.available();
  assert.equal(ok.hits.key, 1, "a good answer is cached");
  const bad = make([{ text: "x" }]);
  bad.keyStatus(401);
  const a = await bad.provider.available();
  assert.equal(a.ok, false);
  assert.match(a.ok ? "" : a.reason, /rejected/);
}

const settings = (over: Partial<AiSettings>): AiSettings => ({ ...NO_SETTINGS, ...over });

async function routing(): Promise<void> {
  const reset = () => {
    resetProviders();
    forgetAvailability();
    setSettingsLoader(null);
  };
  reset();
  const or = make([{ json: { recommendation: "Buy from ShopA.", tradeoffs: ["one"], warnings: [] }, usage: { input: 10, output: 20 } }, { json: { move: 0, say: null } }]);
  const claude = anthropicHarness().make([{ json: { move: 1, say: null }, usage: { input: 5, output: 5 } }]);
  registerProvider(or.provider);
  registerProvider(claude.provider);

  // Per task: the cart explainer on OpenRouter, the arena on Claude.
  setSettingsLoader(async () => settings({ taskOverrides: { cart_explain: { provider: "openrouter", model: MINI } } }));
  const plan = { totalCents: 1500, sellers: [{ seller: "ShopA", country: "AT", itemsCents: 1200, shippingCents: 300, lines: [{ quantity: 2, listing: { cardId: "BT1-001", priceCents: 600, condition: "NM" } }] }], missing: [] };
  const rows: unknown[] = [];
  const db = { insert: () => ({ values: (v: unknown) => ({ returning: async () => (rows.push(v), [{ id: 3 }]) }) }) };
  const out = await explainCart(db as never, plan as never, null, "");
  assert.equal(out.runId, 3);
  assert.equal(or.chat.length, 1, "the cart explainer went to OpenRouter");
  assert.equal(or.chat[0].body.model, MINI);
  assert.equal(claude.wire().length, 0, "and not to Claude");
  assert.equal((rows[0] as { model: string }).model, MINI, "ai_runs records the OpenRouter model");
  const move = await generateJson({ task: "arena_move", tier: "fast", system: [{ text: "s" }], messages: [{ role: "user", parts: text("go") }], maxTokens: 50, schema: Answer });
  assert.equal(move.provider, "anthropic-api", "the arena stays on Claude");
  assert.equal(claude.wire().length, 1);
  assert.equal(or.chat.length, 1);

  // Globally: every task on OpenRouter, the model from the tier choice stored for it.
  setSettingsLoader(async () => settings({ provider: "openrouter", tiers: { openrouter: { fast: MINI } } }));
  const g = await generateJson({ task: "deck_summary", tier: "fast", system: [{ text: "s" }], messages: [{ role: "user", parts: text("go") }], maxTokens: 50, schema: Answer });
  assert.deepEqual([g.provider, g.model], ["openrouter", MINI]);

  // A text-only OpenRouter model on the card scan: the fallback, or `unsupported`; never a downgrade.
  const scan: AiRequest = { task: "scan_identify", tier: "standard", system: [{ text: "s" }], maxTokens: 10, messages: [{ role: "user", parts: [{ type: "image", mediaType: "image/png", base64: "AA" }, ...text("read")] }] };
  const textOnly = settings({ provider: "openrouter", taskOverrides: { scan_identify: { model: PLAIN } } });
  const err = await rejects(resolve(scan, textOnly), "unsupported");
  assert.match(err.message, /Meta: Plain text|cannot read images/);
  const before = or.chat.length;
  registerProvider(createFakeProvider({ id: "backup", script: [{ json: {} }] }));
  const moved = await resolve(scan, { ...textOnly, fallbackProvider: "backup" });
  assert.deepEqual([moved.provider.id, moved.via, moved.request.model], ["backup", "fallback", undefined]);
  assert.equal(or.chat.length, before, "nothing was sent to the text-only model");
  // A model that sees is accepted.
  assert.equal((await resolve(scan, settings({ provider: "openrouter", taskOverrides: { scan_identify: { model: SONNET } } }))).provider.id, "openrouter");
  // OpenRouter without a key is unavailable, and falls back only when switched on.
  resetProviders();
  forgetAvailability();
  registerProvider(make([{ text: "x" }], { apiKey: "" }).provider);
  registerProvider(claude.provider);
  await rejects(resolve(ask({ provider: undefined, tier: "fast" }), settings({ provider: "openrouter" })), "unavailable");
  const fb = await resolve(ask({ provider: undefined, model: undefined, tier: "fast" }), settings({ provider: "openrouter", fallbackProvider: "anthropic-api", fallbackOnUnavailable: true }));
  assert.equal(fb.provider.id, "anthropic-api");
  reset();
}

// ── the arena: a bad answer from an OpenRouter model is rejected exactly as from Claude ──
const card = (id: string, o: Partial<CardDef> = {}): CardDef => ({
  id,
  name: id,
  type: "BATTLE",
  colors: ["Red"],
  energyCost: 1,
  zEnergyCost: null,
  power: 10000,
  comboCost: 1,
  comboPower: 5000,
  skill: null,
  characters: [],
  traits: [],
  ...o,
});
const DEFS = defsFrom([
  card("L-RED", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
  card("L-BLUE", { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null }),
  card("V1", {}),
  card("V-BLUE", { colors: ["Blue"] }),
]);
const CTX: EngineContext = { defs: DEFS, scripts: {} };
const fifty = (id: string) => Array.from({ length: 50 }, () => id);

async function arena(): Promise<void> {
  const rules = engineFor("rules");
  let s = rules.createGame(CTX, { seed: 7, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } }).state;
  const ap = (a: Action) => (s = rules.apply(CTX, s, a).state);
  ap({ type: "chooseFirst", player: (s.prompt as { player: PlayerId }).player, first: "p1" });
  ap({ type: "mulligan", player: "p1", redraw: false });
  ap({ type: "mulligan", player: "p2", redraw: false });
  ap({ type: "charge", player: "p1", card: null });
  ap({ type: "endMain", player: "p1" });
  ap({ type: "charge", player: "p2", card: null });
  ap({ type: "endMain", player: "p2" });
  ap({ type: "charge", player: "p1", card: null });
  assert.equal(s.prompt.kind, "main");
  // Two active energy markers from the deck, so the hand's cards can be played.
  for (let n = 0; n < 2; n++) {
    const [id] = zoneOf(s, "p1", "deck").splice(0, 1);
    zoneOf(s, "p1", "energy").push(id);
    (s.cards[id] as { mode: string }).mode = "active";
  }
  const state = s as VmState;
  const legal = rules.legalActions(CTX, state);
  assert.ok(legal.length > 1, `need several legal moves: ${legal.map((l) => l.label).join(" / ")}`);
  const stubDb = () => ({ insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }) }) as unknown as Parameters<typeof chooseMove>[0];
  const FORMAT_ERROR = "The model's answer did not match the expected format — try again.";

  resetProviders();
  forgetAvailability();
  // Sparring on an OpenRouter model, set in the arena slot.
  setSettingsLoader(async () => settings({ arena: { sparring: { provider: "openrouter", model: MINI } } }));
  try {
    // A good answer: the move is taken, from OpenRouter, and the spend names the provider.
    let run = play([{ json: { move: 1, say: "Fine." }, usage: { input: 100, output: 5 } }]);
    const good = await chooseMove(stubDb(), CTX, state, legal, "p1", "sparring");
    assert.equal(good.index, 1);
    assert.equal(good.spend?.provider, "openrouter");
    assert.equal(run.chat[0].body.model, MINI, "the slot's model was sent");

    // Out of range (either end): the first move, with the same words as on Claude, after one request.
    for (const bad of [legal.length, -1]) {
      run = play([{ json: { move: bad, say: "Out of range." }, usage: { input: 100, output: 5 } }]);
      const choice = await chooseMove(stubDb(), CTX, state, legal, "p1", "sparring");
      assert.equal(choice.index, 0);
      assert.equal(choice.how, `Claude answered ${bad}, which is not on the list — took the first move`);
      assert.equal(run.chat.length, 1);
    }

    // Not an integer, not a number, not JSON: one retry, then the same message as on Claude.
    for (const [name, step] of [["1.5", { json: { move: 1.5, say: "x" } }], ['"two"', { json: { move: "two", say: "x" } }], ["plain text", { text: "two" }]] as const) {
      run = play([{ ...step, usage: { input: 100, output: 5 } }]);
      await assert.rejects(chooseMove(stubDb(), CTX, state, legal, "p1", "sparring"), (err: unknown) => err instanceof Error && err.message === FORMAT_ERROR, `${name}: expected exactly "${FORMAT_ERROR}"`);
      assert.equal(run.chat.length, 2, `${name}: one retry, no more`);
    }

    // One legal move: decided without a request.
    run = play([{ json: { move: 0, say: "no" } }]);
    const only = await chooseMove(stubDb(), CTX, state, [legal[0]], "p1", "tournament");
    assert.equal(only.how, "only one legal move");
    assert.equal(run.chat.length, 0, "a single legal move never reaches the model");
  } finally {
    setSettingsLoader(null);
    resetProviders();
    forgetAvailability();
  }
}

async function main(): Promise<void> {
  try {
    await contract();
    await options();
    await models();
    await routing();
    await arena();
  } finally {
    resetProviders();
    forgetAvailability();
    setSettingsLoader(null);
  }
  console.log("  ai-openrouter: the contract cases on a recorded OpenRouter transport (text, image, JSON with and without structured_outputs, refusal, errors, cached-token usage, billed); reasoning and cache hints only where a model lists them; the model list, prices per MTok and the 1 h cache; routing per task and globally, a text-only model on the scan; the arena's legal-move validation on an OpenRouter model");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
