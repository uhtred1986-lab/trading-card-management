/**
 * The subscription adapter (`providers/anthropic-agent-sdk.ts`, #517) against a
 * stubbed SDK `query()`: no network, no token, no `claude` process. Part of `npm test`.
 *
 * It repeats the assertions of the contract suite (`ai-contract.ts`) that apply
 * — text, image, JSON valid / retry / bad_output / cut off, refusal, error
 * kinds, usage, billed — and adds what is specific to the plan: the options
 * handed to the SDK, the child environment, timeout and abort, usage limits,
 * ignored cache hints, availability, and the token-expiry warning.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { z } from "zod";
import { generate, generateJson } from "../../src/lib/ai/core";
import { AiError, describeAiError, type AiErrorKind } from "../../src/lib/ai/errors";
import { forgetAvailability } from "../../src/lib/ai/router";
import { registerProvider, resetProviders } from "../../src/lib/ai/providers";
import { buildChildEnv, createAnthropicAgentSdkProvider, tokenExpiry, AGENT_SDK_ID, type Options, type SDKMessage, type SDKUserMessage } from "../../src/lib/ai/providers/anthropic-agent-sdk";
import type { AiRequest } from "../../src/lib/ai/types";

interface Step {
  text?: string;
  json?: unknown;
  stop?: string | null;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  /** Messages to emit instead of a normal assistant + result pair. */
  raw?: Record<string, unknown>[];
  /** Throw from the iterator. */
  throws?: Error;
  /** Result is_error. */
  isError?: { result: string; status?: number | null };
  assistantError?: string;
  hang?: boolean;
}

interface Call {
  prompt: unknown;
  options: Options;
  closed: boolean;
}

const TOKEN = "sk-ant-oat01-test-token";

function stub(script: Step[]) {
  const calls: Call[] = [];
  const query = (params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) => {
    const call: Call = { prompt: params.prompt, options: params.options ?? {}, closed: false };
    calls.push(call);
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    async function* gen(): AsyncGenerator<SDKMessage> {
      if (step.hang) {
        await new Promise<void>((_, reject) => call.options.abortController?.signal.addEventListener("abort", () => reject(new Error("aborted by controller"))));
      }
      if (step.throws) throw step.throws;
      for (const m of step.raw ?? []) yield m as unknown as SDKMessage;
      const text = step.text ?? (step.json !== undefined ? JSON.stringify(step.json) : "");
      if (!step.raw) {
        yield { type: "assistant", message: { content: [{ type: "text", text }] }, ...(step.assistantError ? { error: step.assistantError } : {}) } as unknown as SDKMessage;
        const u = step.usage ?? {};
        const model = String(call.options.model);
        yield {
          type: "result",
          subtype: "success",
          is_error: !!step.isError,
          api_error_status: step.isError?.status ?? null,
          result: step.isError ? step.isError.result : text,
          stop_reason: step.stop ?? "end_turn",
          usage: { input_tokens: 0, output_tokens: 0 },
          modelUsage: { [model]: { inputTokens: u.input ?? 0, outputTokens: u.output ?? 0, cacheReadInputTokens: u.cacheRead ?? 0, cacheCreationInputTokens: u.cacheWrite ?? 0 } },
        } as unknown as SDKMessage;
      }
    }
    const it = gen();
    return Object.assign(it, {
      close() {
        call.closed = true;
      },
    });
  };
  return { query: query as never, calls };
}

const Answer = z.object({ move: z.number(), say: z.string().nullable() });
const text = (t: string) => [{ type: "text" as const, text: t }];
const ask = (over: Partial<AiRequest> = {}): AiRequest => ({ task: "cart_explain", tier: "fast", system: [{ text: "sys" }], messages: [{ role: "user", parts: text("hi") }], maxTokens: 100, provider: AGENT_SDK_ID, ...over });

function play(script: Step[], extra: { timeoutMs?: number; env?: Record<string, string | undefined>; log?: (m: string) => void } = {}) {
  const s = stub(script);
  const provider = createAnthropicAgentSdkProvider({ query: s.query, env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN, PATH: "/usr/bin", HOME: "/home/x", ...extra.env }, timeoutMs: extra.timeoutMs, log: extra.log ?? (() => {}) });
  forgetAvailability();
  registerProvider(provider);
  return { ...s, provider };
}

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

async function contract(): Promise<void> {
  // Text, usage summed from modelUsage, billed false.
  {
    play([{ text: "hello there", usage: { input: 11, output: 22, cacheRead: 33, cacheWrite: 44 } }]);
    const r = await generate(ask());
    assert.equal(r.text, "hello there");
    assert.equal(r.stop, "end");
    assert.deepEqual(r.usage, { input: 11, output: 22, cacheRead: 33, cacheWrite: 44 }, "usage incl. cache tokens");
    assert.equal(r.billed, false, "the plan is not billed per token");
    assert.equal(r.provider, AGENT_SDK_ID);
    assert.equal(r.model, "claude-haiku-4-5");
    assert.equal(typeof r.latencyMs, "number");
  }

  // Vision is unproven on the plan, so the router refuses an image request here (no fallback set) without calling the CLI…
  {
    const run = play([{ text: "a card" }]);
    const img = ask({ task: "scan_identify", tier: "standard", messages: [{ role: "user", parts: [{ type: "image", mediaType: "image/jpeg", base64: "AAAA" }, ...text("which card?")] }] });
    await rejects(generate(img), "unsupported");
    assert.equal(run.calls.length, 0, "an image request never reaches the CLI while vision is unproven");
  }
  // …while the adapter itself already sends an image as an image block of one streamed user message, before the text,
  // ready for the day a live scan proves the CLI reads it and vision is switched on.
  {
    const run = play([{ text: "a card" }]);
    const r = await run.provider.generate({ ...ask({ task: "scan_identify", tier: "standard", messages: [{ role: "user", parts: [{ type: "image", mediaType: "image/jpeg", base64: "AAAA" }, ...text("which card?")] }] }), model: "claude-sonnet-5-5" });
    assert.equal(r.text, "a card");
    const prompt = run.calls[0].prompt as AsyncIterable<SDKUserMessage>;
    assert.equal(typeof prompt, "object", "an image request streams a user message");
    const sent: SDKUserMessage[] = [];
    for await (const m of prompt) sent.push(m);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, "user");
    assert.equal(sent[0].message.role, "user");
    const content = sent[0].message.content as { type: string; source?: { type: string; media_type: string; data: string } }[];
    assert.deepEqual(content.map((c) => c.type), ["image", "text"], "image part order");
    assert.deepEqual(content[0].source, { type: "base64", media_type: "image/jpeg", data: "AAAA" });
  }

  // Text only is a plain string prompt.
  {
    const run = play([{ text: "ok" }]);
    await generate(ask());
    assert.equal(run.calls[0].prompt, "hi");
  }

  // JSON valid; the schema reaches the model in the system prompt.
  {
    const run = play([{ json: { move: 2, say: null } }]);
    const r = await generateJson({ ...ask(), schema: Answer });
    assert.deepEqual(r.parsed, { move: 2, say: null });
    const sys = run.calls[0].options.systemPrompt as string;
    assert.match(sys, /^sys\n\n/);
    assert.match(sys, /JSON Schema/);
    assert.match(sys, /"move"/);
    assert.equal(run.calls[0].options.outputFormat, undefined, "native outputFormat is not used");
  }

  // JSON in a fence is still read.
  {
    play([{ text: 'Sure:\n```json\n{"move":1,"say":"ok"}\n```' }]);
    assert.deepEqual((await generateJson({ ...ask(), schema: Answer })).parsed, { move: 1, say: "ok" });
  }

  // Invalid → one retry that shows the rejected answer → valid; usage adds up.
  {
    const run = play([
      { text: '{"move":"two"}', usage: { input: 10, output: 5 } },
      { json: { move: 2, say: null }, usage: { input: 20, output: 7 } },
    ]);
    const r = await generateJson({ ...ask(), schema: Answer });
    assert.deepEqual(r.parsed, { move: 2, say: null });
    assert.deepEqual(r.usage, { input: 30, output: 12, cacheRead: 0, cacheWrite: 0 });
    assert.equal(run.calls.length, 2, "exactly one retry");
    const p = run.calls[1].prompt as string;
    assert.match(p, /\[User\]\nhi\n\[You, earlier in this conversation\]\n\{"move":"two"\}\n\[User\]\nYour answer was rejected/, "the retry shows the model its rejected answer");
  }

  // Invalid twice → bad_output, no third try.
  {
    const run = play([{ text: "not json at all" }]);
    await rejects(generateJson({ ...ask(), schema: Answer }), "bad_output");
    assert.equal(run.calls.length, 2);
  }

  // Cut off: not retried.
  {
    const run = play([{ text: '{"move":', stop: "max_tokens" }]);
    await rejects(generateJson({ ...ask(), schema: Answer }), "bad_output");
    assert.equal(run.calls.length, 1);
  }
  {
    const run = play([{ text: '{"move":', assistantError: "max_output_tokens" }]);
    assert.equal((await generate(ask())).stop, "max_tokens");
    assert.equal(run.calls.length, 1);
  }

  // Refusal.
  {
    play([{ text: "I can't help with that.", stop: "refusal" }]);
    assert.equal((await generate(ask())).stop, "refusal");
    await rejects(generateJson({ ...ask(), schema: Answer }), "refusal");
  }

  // Error kinds.
  {
    play([{ isError: { result: "Invalid API key", status: 401 } }]);
    assert.ok(describeAiError(await rejects(generate(ask()), "auth")).length > 0);
    play([{ assistantError: "authentication_failed", isError: { result: "OAuth token revoked" } }]);
    await rejects(generate(ask()), "auth");
    play([{ isError: { result: "Internal server error", status: 500 } }]);
    await rejects(generate(ask()), "provider");
    play([{ throws: new Error("Claude Code process exited with code 1") }]);
    await rejects(generate(ask()), "provider");
  }
}

async function usageLimits(): Promise<void> {
  // 429 on the result.
  play([{ isError: { result: "API Error: 429 rate limited", status: 429 } }]);
  const e = await rejects(generate(ask()), "usage_limit");
  assert.match(describeAiError(e), /usage limit/i);
  // The plan's own wording.
  play([{ isError: { result: "Claude AI usage limit reached|1761000000" } }]);
  await rejects(generate(ask()), "usage_limit");
  // An assistant message flagged rate_limit.
  play([{ assistantError: "rate_limit", isError: { result: "limit" } }]);
  await rejects(generate(ask()), "usage_limit");
  play([{ assistantError: "billing_error", isError: { result: "x" } }]);
  await rejects(generate(ask()), "usage_limit");
  // A rejected rate_limit_event with no result.
  play([{ raw: [{ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1761000000 } }] }]);
  const r = await rejects(generate(ask()), "usage_limit");
  assert.match(r.message, /resets 20/);
  // A thrown 429.
  play([{ throws: new Error("429 Too Many Requests") }]);
  await rejects(generate(ask()), "usage_limit");
  // An "allowed_warning" event does not fail the call.
  play([{ raw: [{ type: "rate_limit_event", rate_limit_info: { status: "allowed_warning" } }, { type: "result", subtype: "success", is_error: false, result: "fine", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 2 }, modelUsage: {} }] }]);
  const ok = await generate(ask());
  assert.equal(ok.text, "fine");
  assert.deepEqual(ok.usage, { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, "falls back to the result's own usage");
}

async function options(): Promise<void> {
  const keep = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, APP_ANTHROPIC_API_KEY: process.env.APP_ANTHROPIC_API_KEY };
  process.env.ANTHROPIC_API_KEY = "sk-ant-api-SHOULD-NOT-REACH-CHILD";
  process.env.APP_ANTHROPIC_API_KEY = "sk-ant-api-ALSO-NOT";
  try {
    const run = play(
      [{ text: "ok" }],
      { env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: TOKEN, DATABASE_URL: "postgres://secret", ANTHROPIC_AUTH_TOKEN: "x", PATH: "/usr/bin:/bin", HOME: "/home/owner" } },
    );
    await generate(ask({ tier: "standard", effort: "medium", thinking: "adaptive", system: [{ text: "one" }, { text: "two" }] }));
    const o = run.calls[0].options;
    // No Claude Code tools, one turn, our prompt, no settings.
    assert.deepEqual(o.tools, []);
    assert.equal(o.maxTurns, 1);
    assert.deepEqual(o.settingSources, []);
    assert.equal(o.systemPrompt, "one\n\ntwo", "our system prompt, as a plain string (replaces the Claude Code default)");
    assert.equal(o.strictMcpConfig, true);
    assert.equal(o.persistSession, false);
    assert.equal(o.model, "claude-sonnet-5-5");
    assert.equal(o.effort, "medium");
    assert.deepEqual(o.thinking, { type: "adaptive" });
    // An empty directory under tmp.
    assert.ok(o.cwd?.startsWith(os.tmpdir()), "cwd under os.tmpdir()");
    assert.deepEqual(fs.readdirSync(o.cwd!), [], "cwd is empty");
    // The environment is built, not inherited.
    const env = o.env as Record<string, string>;
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, TOKEN);
    assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
    assert.equal(env.PATH, "/usr/bin:/bin");
    assert.equal(env.HOME, "/home/owner");
    for (const k of ["ANTHROPIC_API_KEY", "APP_ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "DATABASE_URL"]) assert.equal(env[k], undefined, `${k} must not reach the child`);
    assert.ok(!JSON.stringify(env).includes("SHOULD-NOT-REACH-CHILD"));
    assert.ok(run.calls[0].closed, "the process is closed when the call ends");
  } finally {
    for (const [k, v] of Object.entries(keep)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  // buildChildEnv on its own, and the APP_ token name.
  const e = buildChildEnv("tok", { ANTHROPIC_API_KEY: "a", APP_ANTHROPIC_API_KEY: "b", PATH: "p", HOME: "h", FOO: "bar" });
  assert.deepEqual(e, { PATH: "p", HOME: "h", CLAUDE_CODE_OAUTH_TOKEN: "tok", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
  const viaApp = play([{ text: "ok" }], { env: { CLAUDE_CODE_OAUTH_TOKEN: undefined, APP_CLAUDE_CODE_OAUTH_TOKEN: "app-tok" } });
  await generate(ask());
  assert.equal((viaApp.calls[0].options.env as Record<string, string>).CLAUDE_CODE_OAUTH_TOKEN, "app-tok");

  // Haiku takes neither effort nor thinking; Opus both; an unknown model neither.
  let r = play([{ text: "ok" }]);
  await generate(ask({ tier: "fast", effort: "high", thinking: "adaptive" }));
  assert.equal(r.calls[0].options.effort, undefined);
  assert.equal(r.calls[0].options.thinking, undefined);
  r = play([{ text: "ok" }]);
  await generate(ask({ tier: "best", effort: "high", thinking: "adaptive" }));
  assert.equal(r.calls[0].options.model, "claude-opus-5");
  assert.equal(r.calls[0].options.effort, "high");
  r = play([{ text: "ok" }]);
  await generate(ask({ tier: undefined, model: "claude-future-9", effort: "high", thinking: "adaptive" }));
  assert.equal(r.calls[0].options.effort, undefined);
  assert.equal(r.calls[0].options.thinking, undefined);
  // No thinking asked for on a model that thinks by default: switched off, as on the API adapter.
  r = play([{ text: "ok" }]);
  await generate(ask({ tier: "standard" }));
  assert.deepEqual(r.calls[0].options.thinking, { type: "disabled" });

  // Cache hints are ignored, logged once.
  const logs: string[] = [];
  r = play([{ text: "ok" }], { log: (m) => logs.push(m) });
  await generate(ask({ system: [{ text: "pool", cache: "long" }, { text: "tail", cache: "short" }] }));
  await generate(ask({ system: [{ text: "pool", cache: "long" }] }));
  assert.equal(logs.length, 1, "cache hints logged once");
  assert.match(logs[0], /cache hints are ignored/);
  assert.equal(r.calls[0].options.systemPrompt, "pool\n\ntail");
}

async function timeouts(): Promise<void> {
  const run = play([{ hang: true }], { timeoutMs: 30 });
  const t0 = Date.now();
  await rejects(generate(ask()), "timeout");
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(run.calls[0].options.abortController?.signal.aborted, true, "the controller was aborted");
  assert.ok(run.calls[0].closed, "the process was closed");

  // The caller's own signal aborts too.
  const ctl = new AbortController();
  const run2 = play([{ hang: true }], { timeoutMs: 60_000 });
  const p = generate(ask({ signal: ctl.signal }));
  setTimeout(() => ctl.abort(), 20);
  await rejects(p, "timeout");
  assert.equal(run2.calls[0].options.abortController?.signal.aborted, true);
}

async function availability(): Promise<void> {
  const saved = process.env.VERCEL;
  try {
    delete process.env.VERCEL;
    const mk = (env: Record<string, string | undefined>) => createAnthropicAgentSdkProvider({ query: stub([{ text: "x" }]).query, env });
    assert.deepEqual(await mk({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN }).available(), { ok: true });
    assert.deepEqual(await mk({ APP_CLAUDE_CODE_OAUTH_TOKEN: TOKEN }).available(), { ok: true });
    const none = await mk({}).available();
    assert.equal(none.ok, false);
    assert.match(none.ok ? "" : none.reason, /CLAUDE_CODE_OAUTH_TOKEN/);
    const expired = await mk({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN, CLAUDE_CODE_OAUTH_TOKEN_CREATED: "2020-01-01" }).available();
    assert.equal(expired.ok, false);

    process.env.VERCEL = "1";
    const onVercel = await mk({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN }).available();
    assert.equal(onVercel.ok, false, "unavailable on Vercel until #518");
    assert.match(onVercel.ok ? "" : onVercel.reason, /Vercel/);
    const s = stub([{ text: "x" }]);
    await rejects(createAnthropicAgentSdkProvider({ query: s.query, env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN } }).generate(ask()), "unavailable");
    assert.equal(s.calls.length, 0, "no query is started on Vercel");
  } finally {
    if (saved === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = saved;
  }

  // A rejected token marks the provider unavailable until a call succeeds.
  delete process.env.VERCEL;
  const s = stub([{ isError: { result: "bad", status: 401 } }, { text: "ok" }]);
  const p = createAnthropicAgentSdkProvider({ query: s.query, env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN }, log: () => {} });
  await rejects(p.generate(ask()), "auth");
  assert.equal((await p.available()).ok, false);
  assert.equal((await p.generate(ask())).text, "ok");
  assert.equal((await p.available()).ok, true);

  // Declared capabilities: what the checks above prove.
  assert.deepEqual(p.capabilities(), { vision: false, json: true, streaming: false, cacheHints: false, batch: false }, "vision unproven on the plan, so false");
  const models = await p.listModels();
  assert.deepEqual(models.map((m) => m.id), ["claude-opus-5", "claude-sonnet-5-5", "claude-haiku-4-5"]);
  assert.ok(models.every((m) => m.usdPerMTok === undefined && m.capabilities.json));
}

function expiry(): void {
  const d = (s: string) => new Date(`${s}T12:00:00Z`);
  assert.equal(tokenExpiry(undefined), null);
  assert.equal(tokenExpiry("garbage"), null);
  // Created 2026-01-10 → expires 2027-01-10.
  assert.deepEqual(tokenExpiry("2026-01-10", d("2026-10-04")), { expiresOn: "2027-01-10", daysLeft: 98, state: "ok" });
  const edge = tokenExpiry("2026-01-10", d("2026-12-11"));
  assert.equal(edge?.daysLeft, 30);
  assert.equal(edge?.state, "soon", "30 days left warns");
  assert.match(edge?.message ?? "", /expires on 2027-01-10 \(30 days left\)/);
  assert.equal(tokenExpiry("2026-01-10", d("2026-12-10"))?.state, "ok", "31 days left does not");
  assert.equal(tokenExpiry("2026-01-10", d("2027-01-10"))?.daysLeft, 0);
  assert.equal(tokenExpiry("2026-01-10", d("2027-01-10"))?.state, "soon");
  assert.match(tokenExpiry("2026-01-10", d("2027-01-10"))?.message ?? "", /0 days/);
  assert.equal(tokenExpiry("2026-01-10", d("2027-01-11"))?.state, "expired");
  // A leap year counts as 365 days from the created date, not "one calendar year".
  assert.equal(tokenExpiry("2027-03-01", d("2027-03-01"))?.expiresOn, "2028-02-29");
}

async function main(): Promise<void> {
  const vercel = process.env.VERCEL;
  delete process.env.VERCEL;
  try {
    await contract();
    await usageLimits();
    await options();
    await timeouts();
    await availability();
    expiry();
  } finally {
    resetProviders();
    forgetAvailability();
    if (vercel !== undefined) process.env.VERCEL = vercel;
  }
  console.log("  ai-agent-sdk: contract (text, image, JSON valid / retry / bad_output, refusal, errors, usage, billed false) on a stubbed query(); SDK options; child env; timeout and abort; usage limits; ignored cache hints; availability; token expiry");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
