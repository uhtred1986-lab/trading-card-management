/**
 * #516: the router and the settings, with no network and no database.
 *
 * Precedence (provider and model), capability fallback, availability fallback
 * on and off, nothing configured = `anthropic-api` on today's models (read off
 * the wire), the pickers' filters, `listModels` from `models.ts`, the forms
 * refusing what a picker would not offer, the arena slots' defaults, and the
 * settings loader (registered literal, failing, parsing a stored row).
 *
 * Part of `npm test`.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { generateJson } from "../../src/lib/ai/core";
import { ARENA_NEEDS, describeModel, needsOf, pickable, searchModels, TASK_IDS, TASKS } from "../../src/lib/ai/catalog";
import { arenaModel, arenaSlotFor, TOURNAMENT_KEY_PROMPTS } from "../../src/lib/ai/arena-models";
import { FAST_MODEL, MODEL, rememberModelPrices, SONNET_MODEL } from "../../src/lib/ai/models";
import { availabilityOf, AVAILABILITY_TTL_MS, forgetAvailability, resolve } from "../../src/lib/ai/router";
import { createAnthropicApiProvider } from "../../src/lib/ai/providers/anthropic-api";
import { createFakeProvider } from "../../src/lib/ai/providers/fake";
import { registerProvider, resetProviders } from "../../src/lib/ai/providers";
import { getSettings, NO_SETTINGS, rowFromSettings, setSettingsLoader, settingsFromRow, type AiSettings } from "../../src/lib/ai/settings";
import { applyArenaForm, applyProviderForm, applyTasksForm, applyTiersForm, decodeRef, encodeRef, type ModelLists } from "../../src/lib/ai/settings-form";
import { testConnection } from "../../src/lib/ai/test-connection";
import { AiError } from "../../src/lib/ai/errors";
import type { AiProvider, AiRequest, Availability, ModelInfo } from "../../src/lib/ai/types";
import { anthropicHarness } from "./ai-harness";

const settings = (over: Partial<AiSettings> = {}): AiSettings => ({ ...NO_SETTINGS, ...over });
const text = (t: string) => [{ type: "text" as const, text: t }];
const ask = (over: Partial<AiRequest> = {}): AiRequest => ({
  task: "deck_summary",
  tier: "standard",
  system: [{ text: "s" }],
  messages: [{ role: "user", parts: text("hi") }],
  maxTokens: 10,
  ...over,
});
const image = [
  {
    role: "user" as const,
    parts: [
      { type: "image" as const, mediaType: "image/png" as const, base64: "AA" },
      { type: "text" as const, text: "read" },
    ],
  },
];

function fake(id: string, opts: { vision?: boolean; json?: boolean; avail?: Availability; calls?: { n: number } } = {}): AiProvider {
  const p = createFakeProvider({ id, label: id.toUpperCase(), script: [{ json: {} }], capabilities: { vision: opts.vision ?? true, json: opts.json ?? true } });
  return {
    ...p,
    available: async () => {
      if (opts.calls) opts.calls.n++;
      return opts.avail ?? { ok: true };
    },
  };
}

async function rejects(p: Promise<unknown>, kind: string, mention?: string): Promise<void> {
  try {
    await p;
  } catch (err) {
    assert.ok(err instanceof AiError, `expected an AiError, got ${String(err)}`);
    assert.equal(err.kind, kind, `kind: ${err.message}`);
    if (mention) assert.ok(err.message.includes(mention), `message "${err.message}" should mention ${mention}`);
    return;
  }
  assert.fail(`expected ${kind}`);
}

const reset = () => {
  resetProviders();
  forgetAvailability();
  setSettingsLoader(null);
  delete process.env.AI_PROVIDER;
};

async function main(): Promise<void> {
  // A fallback is logged; keep the lines out of the test output and prove they are written.
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (m: unknown) => void warned.push(String(m));
  try {
    reset();

    // ── provider precedence: pin → task → global → env → anthropic-api ─────────
    for (const id of ["pinned", "task", "global", "env"]) registerProvider(fake(id));
    const all = settings({ provider: "global", taskOverrides: { deck_summary: { provider: "task" } } });
    process.env.AI_PROVIDER = "env";
    assert.equal((await resolve(ask({ provider: "pinned" }), all)).provider.id, "pinned");
    assert.equal((await resolve(ask({ provider: "pinned" }), all)).via, "pin");
    assert.equal((await resolve(ask(), all)).provider.id, "task", "a task override beats the global setting");
    assert.equal((await resolve(ask({ task: "cart_explain" }), all)).provider.id, "global", "another task follows the global setting");
    assert.equal((await resolve(ask(), settings())).provider.id, "env", "env AI_PROVIDER when nothing is set");
    registerProvider(anthropicHarness().make([{ json: {} }]).provider);
    delete process.env.AI_PROVIDER;
    assert.equal((await resolve(ask(), settings())).provider.id, "anthropic-api", "else anthropic-api");
    await rejects(resolve(ask({ provider: "nope" }), settings()), "unavailable", "nope");
    reset();

    // ── model precedence: code → task → tier → models.ts ───────────────────────
    {
      registerProvider(anthropicHarness().make([{ json: {} }]).provider);
      const s = settings({
        taskOverrides: { deck_summary: { model: "task-model" } },
        tiers: { "anthropic-api": { standard: "tier-model" } },
      });
      assert.equal((await resolve(ask({ model: "code-model" }), s)).request.model, "code-model", "a model in code wins");
      assert.equal((await resolve(ask(), s)).request.model, "task-model", "then the task's model");
      assert.equal((await resolve(ask({ task: "scan_identify" }), s)).request.model, "tier-model", "then the tier's model");
      assert.equal((await resolve(ask({ task: "scan_identify", tier: "best" }), s)).request.model, MODEL, "then models.ts");
      // A task override naming another provider's model is not used on this one.
      registerProvider(fake("other"));
      const o = settings({ taskOverrides: { deck_summary: { provider: "other", model: "o1" } } });
      const r = await resolve(ask(), o);
      assert.deepEqual([r.provider.id, r.request.model], ["other", "o1"]);
      reset();
    }

    // ── nothing configured: anthropic-api on today's models, read off the wire ──
    {
      const h = anthropicHarness().make([{ json: { ok: true } }]);
      registerProvider(h.provider);
      const Ok = z.object({ ok: z.boolean() });
      for (const [tier, model] of [
        ["fast", FAST_MODEL],
        ["standard", SONNET_MODEL],
        ["best", MODEL],
      ] as const) {
        const res = await generateJson({ ...ask({ tier }), schema: Ok });
        assert.equal(res.provider, "anthropic-api");
        assert.equal(res.model, model, `${tier} runs on ${model}`);
      }
      assert.deepEqual(
        h.wire().map((w) => w.body.model),
        [FAST_MODEL, SONNET_MODEL, MODEL],
        "the wire carries today's models",
      );
      // And with settings loaded but empty, the same.
      setSettingsLoader(async () => NO_SETTINGS);
      const res = await generateJson({ ...ask({ tier: "best" }), schema: Ok });
      assert.equal(res.model, MODEL);
      reset();
    }

    // ── capability: missing → fallback or unsupported, never a downgrade ───────
    {
      registerProvider(fake("text-only", { vision: false }));
      registerProvider(fake("sees"));
      const scan = ask({ task: "scan_identify", messages: image });
      await rejects(resolve(scan, settings({ provider: "text-only" })), "unsupported", "images");
      const fb = await resolve(scan, settings({ provider: "text-only", fallbackProvider: "sees" }));
      assert.deepEqual([fb.provider.id, fb.via], ["sees", "fallback"]);
      // The fallback is no better: still unsupported, and says why.
      registerProvider(fake("blind", { vision: false }));
      await rejects(resolve(scan, settings({ provider: "text-only", fallbackProvider: "blind" })), "unsupported", "fallback");
      // JSON the provider cannot give.
      registerProvider(fake("no-json", { json: false }));
      await rejects(resolve(ask({ output: { kind: "json", schema: z.object({}) } }), settings({ provider: "no-json" })), "unsupported", "structured");
      // A model that cannot read images, on a provider that can.
      rememberModelPrices("sees", [
        { id: "txt", label: "Text only", capabilities: { vision: false, json: true, tools: false }, usdPerMTok: { in: 1, out: 2 } },
        { id: "vis", label: "Seeing", capabilities: { vision: true, json: true, tools: false }, usdPerMTok: { in: 1, out: 2 } },
      ]);
      await rejects(resolve(scan, settings({ provider: "sees", taskOverrides: { scan_identify: { model: "txt" } } })), "unsupported", "Text only");
      registerProvider(fake("backup"));
      const moved = await resolve(scan, settings({ provider: "sees", fallbackProvider: "backup", taskOverrides: { scan_identify: { model: "txt" } } }));
      assert.equal(moved.provider.id, "backup", "a text-only model goes to the fallback");
      assert.equal(moved.request.model, undefined, "and its model id is not carried to another vendor");
      assert.equal((await resolve(scan, settings({ provider: "sees", taskOverrides: { scan_identify: { model: "vis" } } }))).request.model, "vis");
      // A hard pin is never rerouted.
      await rejects(resolve({ ...scan, provider: "text-only" }, settings({ fallbackProvider: "sees" })), "unsupported");
      reset();
    }

    // ── availability: fallback only when switched on; cached ~10 min ───────────
    {
      const calls = { n: 0 };
      registerProvider(fake("down", { avail: { ok: false, reason: "no credentials" }, calls }));
      registerProvider(fake("up"));
      const base = { provider: "down" };
      await rejects(resolve(ask(), settings({ ...base, fallbackProvider: "up", fallbackOnUnavailable: false })), "unavailable", "no credentials");
      await rejects(resolve(ask(), settings(base)), "unavailable", "no credentials");
      const on = await resolve(ask(), settings({ ...base, fallbackProvider: "up", fallbackOnUnavailable: true }));
      assert.deepEqual([on.provider.id, on.via], ["up", "fallback"]);
      assert.equal(calls.n, 1, "available() is asked once, then cached");
      assert.ok(
        warned.some((w) => /DOWN is unavailable.*running on UP/.test(w)),
        "the fallback is logged",
      );
      // The cache expires after ten minutes.
      const p = fake("ttl", { calls });
      const t0 = 1_000_000;
      calls.n = 0;
      await availabilityOf(p, t0);
      await availabilityOf(p, t0 + AVAILABILITY_TTL_MS - 1);
      assert.equal(calls.n, 1);
      await availabilityOf(p, t0 + AVAILABILITY_TTL_MS + 1);
      assert.equal(calls.n, 2, "asked again after the TTL");
      // A provider whose check throws is unavailable, with its message.
      const boom: AiProvider = {
        ...fake("boom"),
        available: async () => {
          throw new Error("socket closed");
        },
      };
      registerProvider(boom);
      await rejects(resolve(ask(), settings({ provider: "boom" })), "unavailable", "socket closed");
      // A pinned request is not rerouted when its provider is down.
      await rejects(resolve(ask({ provider: "down" }), settings({ fallbackProvider: "up", fallbackOnUnavailable: true })), "unavailable");
      reset();
    }

    // ── the Anthropic adapter without a key is unavailable with the old wording ─
    {
      const saved = [process.env.ANTHROPIC_API_KEY, process.env.APP_ANTHROPIC_API_KEY];
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.APP_ANTHROPIC_API_KEY;
      registerProvider(createAnthropicApiProvider());
      await rejects(resolve(ask(), settings()), "unavailable", "ANTHROPIC_API_KEY is not set");
      [process.env.ANTHROPIC_API_KEY, process.env.APP_ANTHROPIC_API_KEY] = saved;
      if (saved[0] === undefined) delete process.env.ANTHROPIC_API_KEY;
      if (saved[1] === undefined) delete process.env.APP_ANTHROPIC_API_KEY;
      reset();
    }

    // ── listModels from models.ts; pickers filter by what the task needs ───────
    {
      const anthropic = await createAnthropicApiProvider({ fetch: (async () => new Response("{}")) as typeof fetch }).listModels();
      assert.deepEqual(anthropic.map((m) => m.id).sort(), [FAST_MODEL, MODEL, SONNET_MODEL].sort());
      const opus = anthropic.find((m) => m.id === MODEL)!;
      assert.deepEqual(opus.usdPerMTok, { in: 5, out: 25 }, "price per MTok from models.ts");
      assert.equal(opus.contextLength, undefined, "no context length is invented");
      assert.ok(
        anthropic.every((m) => m.capabilities.json),
        "every model of the table gives structured output",
      );
      assert.match(describeModel(opus), /\$5 in · \$25 out per M tokens/);

      const mk = (id: string, vision: boolean, json: boolean): ModelInfo => ({ id, label: id, capabilities: { vision, json, tools: false }, usdPerMTok: { in: 1, out: 2 } });
      const lists: ModelLists = { a: [mk("sees", true, true), mk("text", false, true), mk("free-text", true, false)], b: [mk("b-text", false, true)] };
      for (const t of TASK_IDS) {
        const ids = pickable(lists, needsOf(t)).map((m) => `${m.provider}/${m.id}`);
        if (t === "scan_identify") assert.deepEqual(ids, ["a/sees"], "the scan never sees a text-only model");
        else assert.deepEqual(ids, ["a/sees", "a/text", "b/b-text"], `${t} needs structured output only`);
      }
      assert.deepEqual(
        pickable(lists, ARENA_NEEDS).map((m) => m.id),
        ["sees", "text", "b-text"],
        "the arena pickers never offer a model without structured output",
      );
      assert.deepEqual(
        searchModels(pickable(lists, ARENA_NEEDS), "b text").map((m) => m.id),
        ["b-text"],
      );
      assert.equal(Object.keys(TASKS).length, TASK_IDS.length);

      // The forms refuse what a picker would not have offered.
      const s0 = settings();
      assert.throws(() => applyArenaForm(s0, { sparring: "a|free-text" }, lists), /no structured output/);
      assert.throws(() => applyArenaForm(s0, { sparring: "a|invented" }, lists), /no structured output/);
      assert.deepEqual(applyArenaForm(s0, { "tournament.key": "a|text", "tournament.other": "" }, lists).arena, { "tournament.key": { provider: "a", model: "text" } });
      assert.throws(() => applyTasksForm(s0, { scan_identify: { model: "a|text" } }, lists), /cannot run scan_identify/);
      // "b" has no tier table, so a provider-only override needs its three tiers (see the OpenRouter hardening checks).
      const s0b = settings({ tiers: { b: { fast: "b-text", standard: "b-text", best: "b-text" } } });
      assert.deepEqual(applyTasksForm(s0b, { scan_identify: { model: "a|sees" }, cart_explain: { provider: "b" } }, lists).taskOverrides, {
        scan_identify: { provider: "a", model: "sees" },
        cart_explain: { provider: "b" },
      });
      assert.throws(() => applyTiersForm(s0, { "a|best": "text" }, lists), /reads images/);
      assert.deepEqual(applyTiersForm(s0, { "a|fast": "text", "a|best": "sees", "a|standard": "" }, lists).tiers, { a: { fast: "text", best: "sees" } });
      assert.throws(() => applyProviderForm(s0, { provider: "x" }, ["a"]), /no AI provider/);
      assert.throws(() => applyProviderForm(s0, { provider: "a", fallbackProvider: "a" }, ["a"]), /different/);
      assert.equal(applyProviderForm(s0, { provider: "anthropic-api", fallbackOnUnavailable: true }, ["anthropic-api"]).fallbackOnUnavailable, false, "no fallback provider, nothing to switch on");
      assert.deepEqual(decodeRef(encodeRef({ provider: "or", model: "vendor/m:free" })), { provider: "or", model: "vendor/m:free" });
      assert.equal(decodeRef("nonsense"), null);
    }

    // ── the arena slots: today's behaviour with nothing set ────────────────────
    {
      const dflt = (slot: Parameters<typeof arenaModel>[0]) => arenaModel(slot);
      assert.deepEqual(dflt("sparring"), { provider: "anthropic-api", model: FAST_MODEL });
      assert.deepEqual(dflt("tournament.key"), { provider: "anthropic-api", model: MODEL, effort: "medium", thinking: "adaptive" });
      assert.deepEqual(dflt("tournament.other"), { provider: "anthropic-api", model: FAST_MODEL });
      // Every prompt kind, on each tier, as `modelFor` in opponent.ts decides today.
      const kinds = ["main", "counter", "blocker", "combo", "attack", "pay", "choose", "mulligan", "target", "anything-else"];
      for (const k of kinds) {
        const heavy = ["main", "counter", "blocker", "combo"].includes(k);
        assert.equal(arenaModel(arenaSlotFor("sparring", k)).model, FAST_MODEL, `sparring ${k}`);
        assert.equal(arenaModel(arenaSlotFor("tournament", k)).model, heavy ? MODEL : FAST_MODEL, `tournament ${k}`);
        assert.equal(arenaModel(arenaSlotFor("tournament", k)).effort, heavy ? "medium" : undefined, `tournament ${k} effort`);
      }
      assert.deepEqual([...TOURNAMENT_KEY_PROMPTS], ["main", "counter", "blocker", "combo"]);
      const set = settings({ arena: { sparring: { provider: "or", model: "x/y" }, "tournament.key": { provider: "or", model: "x/z" } } });
      assert.deepEqual(arenaModel("sparring", set), { provider: "or", model: "x/y" });
      assert.deepEqual(arenaModel("tournament.key", set), { provider: "or", model: "x/z", effort: "medium", thinking: "adaptive" });
      assert.equal(arenaModel("tournament.other", set).model, FAST_MODEL, "an unset slot keeps its default");
    }

    // ── the settings loader and the stored row ─────────────────────────────────
    {
      assert.equal(await getSettings(), NO_SETTINGS, "no loader = nothing configured");
      let reads = 0;
      setSettingsLoader(async () => (reads++, settings({ provider: "x" })));
      assert.equal((await getSettings()).provider, "x");
      await getSettings();
      assert.equal(reads, 1, "reads are reused for a few seconds");
      setSettingsLoader(async () => {
        throw new Error("db down");
      });
      assert.equal(await getSettings(), NO_SETTINGS, "a failing database means defaults, not a failed model call");
      setSettingsLoader(null);

      const s = settings({
        provider: "or",
        fallbackProvider: "anthropic-api",
        fallbackOnUnavailable: true,
        taskOverrides: { scan_identify: { provider: "anthropic-api", model: SONNET_MODEL } },
        tiers: { or: { fast: "a/b" } },
        arena: { sparring: { provider: "or", model: "a/b" } },
      });
      const row = rowFromSettings(s);
      assert.deepEqual(row.models, { or: { fast: "a/b" }, "arena.sparring": { provider: "or", model: "a/b" } });
      assert.deepEqual(settingsFromRow(row), s, "row ↔ settings round trip");
      assert.equal(settingsFromRow(null), NO_SETTINGS);
      const junk = settingsFromRow({
        provider: "",
        fallbackProvider: null,
        fallbackOnUnavailable: false,
        taskOverrides: [1],
        models: { "arena.sparring": { provider: "x" }, "arena.bogus": { provider: "x", model: "y" }, p: "nope", q: { fast: 3 } },
      });
      assert.deepEqual(junk, NO_SETTINGS, "half a slot, an unknown slot and garbage are all dropped");
    }

    // ── test connection: provider, model, latency; an error is shown, not thrown
    {
      const ok = createFakeProvider({ id: "tc", script: [{ text: "ok", model: "m-1" }] });
      const r = await testConnection(ok, NO_SETTINGS);
      assert.ok(r.ok && r.provider === "tc" && r.model === "m-1" && r.latencyMs >= 0 && r.reply === "ok");
      assert.equal(ok.requests.length, 1, "one tiny prompt");
      assert.ok(ok.requests[0].maxTokens <= 16);
      const bad = createFakeProvider({ id: "tc2", script: [{ error: new AiError("auth", "key rejected") }] });
      const e = await testConnection(bad, NO_SETTINGS);
      assert.deepEqual(e, { ok: false, provider: "tc2", error: "key rejected" });
    }
  } finally {
    console.warn = warn;
    reset();
  }
}

main().then(
  () =>
    console.log(
      "  ai-router: provider and model precedence, capability and availability fallback, nothing configured = anthropic-api on today's models, pickers and forms, arena slot defaults, settings loader",
    ),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
