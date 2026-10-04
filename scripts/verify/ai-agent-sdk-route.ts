/**
 * The Claude plan on Vercel (#518): the one route that carries the binary, and the caller that forwards to
 * it. No network, no token, no `claude` process: the SDK's `query()` is a stub and `fetch` is a function
 * that hands the request straight to the route handler. Part of `npm test`.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { generate, generateJson } from "../../src/lib/ai/core";
import { AiError, type AiErrorKind } from "../../src/lib/ai/errors";
import { forgetAvailability } from "../../src/lib/ai/router";
import { registerProvider, resetProviders } from "../../src/lib/ai/providers";
import { AGENT_SDK_ID, createAnthropicAgentSdkProvider, type Options, type SDKMessage } from "../../src/lib/ai/providers/anthropic-agent-sdk";
import { FORWARD_TIMEOUT_MS, ROUTE_MAX_DURATION_S, ROUTE_PATH, SECRET_HEADER, secretMatches, selfUrl, serveAgentSdk } from "../../src/lib/ai/providers/agent-sdk-remote";
import type { AiRequest } from "../../src/lib/ai/types";
import { config as proxyConfig } from "../../src/proxy";

const TOKEN = "sk-ant-oat01-test-token";
const SECRET = "s3cret-value";
const ROUTE_ENV = { CLAUDE_CODE_OAUTH_TOKEN: TOKEN, AI_AGENT_SDK: "1", AI_AGENT_SDK_SECRET: SECRET, PATH: "/usr/bin", HOME: "/home/x" };

interface Step {
  text?: string;
  isError?: { result: string; status?: number | null };
  throws?: Error;
}

/** A stubbed `query()` that counts its calls. */
function stubQuery(steps: Step[]) {
  const calls: { options: Options; prompt: unknown }[] = [];
  const query = (params: { prompt: unknown; options?: Options }) => {
    const options = params.options ?? {};
    calls.push({ options, prompt: params.prompt });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    async function* gen(): AsyncGenerator<SDKMessage> {
      if (step.throws) throw step.throws;
      const text = step.text ?? "";
      yield { type: "assistant", message: { content: [{ type: "text", text }] } } as unknown as SDKMessage;
      yield {
        type: "result",
        subtype: "success",
        is_error: !!step.isError,
        api_error_status: step.isError?.status ?? null,
        result: step.isError ? step.isError.result : text,
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0 },
        modelUsage: { [String(options.model)]: { inputTokens: 7, outputTokens: 9, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
      } as unknown as SDKMessage;
    }
    return Object.assign(gen(), { close() {} });
  };
  return { query: query as never, calls };
}

/** The route as a server would run it: the in-process adapter on the stubbed query. */
function route(steps: Step[], env: Record<string, string | undefined> = ROUTE_ENV) {
  const q = stubQuery(steps);
  const provider = createAnthropicAgentSdkProvider({ query: q.query, env, remote: false, log: () => {} });
  return { ...q, handler: (req: Request) => serveAgentSdk(req, { env, provider }) };
}

const post = (body: unknown, headers: Record<string, string> = { [SECRET_HEADER]: SECRET }) =>
  new Request("https://app.example" + ROUTE_PATH, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

const wireBody = (over: Record<string, unknown> = {}) => ({
  request: { task: "cart_explain", model: "claude-haiku-4-5", system: [{ text: "sys" }], messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }], maxTokens: 100, ...over },
});

const CALLER_ENV = { AI_AGENT_SDK: "1", AI_AGENT_SDK_SECRET: SECRET, CLAUDE_CODE_OAUTH_TOKEN: TOKEN, VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "cards.example.com", VERCEL_URL: "cards-abc.vercel.app" };

interface Seen {
  url: string;
  headers: Headers;
  body: { request: Record<string, unknown> };
}

/** A `fetch` that records the call and answers with the route handler (or whatever `answer` says). */
function wire(handler: (req: Request) => Promise<Response>, answer?: (req: Request) => Promise<Response> | Response) {
  const seen: Seen[] = [];
  const fetchStub = (async (url: string, init: RequestInit) => {
    const req = new Request(url, init);
    seen.push({ url, headers: req.headers, body: JSON.parse(String(init.body)) });
    return answer ? answer(req) : handler(req);
  }) as unknown as typeof fetch;
  return { seen, fetchStub };
}

function caller(fetchStub: typeof fetch, extra: { timeoutMs?: number; env?: Record<string, string | undefined> } = {}) {
  const p = createAnthropicAgentSdkProvider({ env: { ...CALLER_ENV, ...extra.env }, remote: true, forward: { fetch: fetchStub, timeoutMs: extra.timeoutMs }, log: () => {} });
  forgetAvailability();
  registerProvider(p);
  return p;
}

const ask = (over: Partial<AiRequest> = {}): AiRequest => ({
  task: "cart_explain",
  tier: "fast",
  system: [{ text: "sys", cache: "long" }],
  messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
  maxTokens: 100,
  provider: AGENT_SDK_ID,
  ...over,
});

async function rejects(p: Promise<unknown>, kind: AiErrorKind): Promise<AiError> {
  try {
    await p;
  } catch (err) {
    assert.ok(err instanceof AiError, `expected an AiError (${kind}), got ${String(err)}`);
    assert.equal(err.kind, kind, `expected ${kind}, got ${err.kind}: ${err.message}`);
    return err;
  }
  assert.fail(`expected an AiError (${kind}), but the call succeeded`);
}

async function guard(): Promise<void> {
  assert.equal(secretMatches("a", "a"), true);
  assert.equal(secretMatches("a", "b"), false);
  assert.equal(secretMatches("", ""), false, "an empty secret never matches");
  assert.equal(secretMatches(null, "x"), false);
  assert.equal(secretMatches("x", undefined), false);
  assert.equal(secretMatches("a-much-longer-value", "a"), false, "different lengths are fine");

  // Good secret: the answer, and the SDK saw the model and system prompt of the wire request.
  {
    const r = route([{ text: "hello" }]);
    const res = await r.handler(post(wireBody()));
    assert.equal(res.status, 200);
    const j = (await res.json()) as { ok: boolean; result: { text: string; provider: string; billed: boolean; usage: { input: number; output: number } } };
    assert.equal(j.ok, true);
    assert.equal(j.result.text, "hello");
    assert.equal(j.result.provider, AGENT_SDK_ID);
    assert.equal(j.result.billed, false);
    assert.deepEqual([j.result.usage.input, j.result.usage.output], [7, 9]);
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].options.model, "claude-haiku-4-5");
    assert.equal(r.calls[0].options.systemPrompt, "sys");
    assert.equal(r.calls[0].prompt, "hi");
  }
  // Missing / wrong / unset secret: 401 and nothing is started.
  for (const [label, headers, env] of [
    ["missing", {}, ROUTE_ENV],
    ["wrong", { [SECRET_HEADER]: "nope" }, ROUTE_ENV],
    ["empty", { [SECRET_HEADER]: "" }, ROUTE_ENV],
    ["unset on the server", { [SECRET_HEADER]: SECRET }, { ...ROUTE_ENV, AI_AGENT_SDK_SECRET: undefined }],
    ["basic auth is no substitute", { authorization: "Basic dTpw" }, ROUTE_ENV],
  ] as const) {
    const r = route([{ text: "x" }], env);
    const res = await r.handler(post(wireBody(), headers));
    assert.equal(res.status, 401, label);
    assert.equal(r.calls.length, 0, `${label}: no query started`);
  }
  // Switched off at run time: refused after the secret check, nothing started.
  {
    const r = route([{ text: "x" }], { ...ROUTE_ENV, AI_AGENT_SDK: undefined });
    assert.equal((await r.handler(post(wireBody()))).status, 503);
    assert.equal(r.calls.length, 0);
  }
  // Malformed bodies: 400, nothing started.
  for (const body of ["not json", {}, { request: {} }, wireBody({ model: "" }), wireBody({ messages: [] }), wireBody({ maxTokens: -1 }), wireBody({ messages: [{ role: "system", parts: [] }] })]) {
    const r = route([{ text: "x" }]);
    assert.equal((await r.handler(post(body))).status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal(r.calls.length, 0);
  }
  // Only POST exists on the route file.
  const src = fs.readFileSync("src/app/api/ai/agent-sdk/route.ts", "utf8");
  assert.match(src, /export async function POST/);
  assert.doesNotMatch(src, /export (async )?function (GET|PUT|PATCH|DELETE)/);
  assert.ok(src.includes(`maxDuration = ${ROUTE_MAX_DURATION_S};`), "the route's literal maxDuration equals ROUTE_MAX_DURATION_S");
  assert.ok(ROUTE_MAX_DURATION_S > 110 && FORWARD_TIMEOUT_MS < ROUTE_MAX_DURATION_S * 1000 && FORWARD_TIMEOUT_MS > 110_000, "adapter 110 s < caller timeout < route maxDuration");
}

async function forwarding(): Promise<void> {
  // End to end: core -> caller adapter -> fetch -> route -> adapter -> query. JSON is validated by the caller's core.
  {
    const r = route([{ text: JSON.stringify({ move: 3, say: null }) }]);
    const w = wire(r.handler);
    caller(w.fetchStub);
    const Answer = z.object({ move: z.number(), say: z.string().nullable() });
    const res = await generateJson({ ...ask({ system: [{ text: "pick a move", cache: "long" }] }), schema: Answer });
    assert.deepEqual(res.parsed, { move: 3, say: null });
    assert.equal(res.provider, AGENT_SDK_ID);
    assert.equal(res.billed, false);

    assert.equal(w.seen.length, 1);
    assert.equal(w.seen[0].url, "https://cards.example.com" + ROUTE_PATH, "production domain, with a scheme");
    assert.equal(w.seen[0].headers.get(SECRET_HEADER), SECRET);
    assert.equal(w.seen[0].headers.get("content-type"), "application/json");
    const sent = w.seen[0].body.request;
    assert.equal(sent.model, "claude-haiku-4-5", "the caller resolves the tier");
    assert.equal(sent.output, undefined, "no Zod schema on the wire");
    assert.equal(sent.signal, undefined);
    assert.equal((sent.system as { text: string }[]).length, 1);
    assert.match((sent.system as { text: string }[])[0].text, /^pick a move\n\nAnswer with a single JSON value that matches this JSON Schema/, "schema folded into the system prompt");
    assert.deepEqual(Object.keys(sent).sort(), ["maxTokens", "messages", "model", "system", "task"]);
    assert.equal(JSON.stringify(w.seen[0].body).includes(TOKEN), false, "the plan token never travels");
    assert.equal(r.calls.length, 1, "the route ran the query once");
    assert.equal(r.calls[0].options.model, "claude-haiku-4-5");
  }
  // Effort and thinking survive the trip (Sonnet 5.5 honours both).
  {
    const r = route([{ text: "ok" }]);
    const w = wire(r.handler);
    const p = caller(w.fetchStub);
    await p.generate(ask({ tier: "standard", effort: "high", thinking: "adaptive" }));
    assert.equal(w.seen[0].body.request.effort, "high");
    assert.equal(w.seen[0].body.request.thinking, "adaptive");
    assert.deepEqual(r.calls[0].options.thinking, { type: "adaptive" });
  }
  // An AiError raised on the route comes back as the same kind, message and status.
  for (const [step, kind] of [
    [{ isError: { result: "usage limit reached", status: 429 } }, "usage_limit"],
    [{ isError: { result: "bad token", status: 401 } }, "auth"],
    [{ isError: { result: "boom" } }, "provider"],
    [{ throws: new Error("spawn ENOENT") }, "provider"],
  ] as [Step, AiErrorKind][]) {
    const r = route([step]);
    const w = wire(r.handler);
    caller(w.fetchStub);
    const local = createAnthropicAgentSdkProvider({ query: stubQuery([step]).query, env: ROUTE_ENV, remote: false, log: () => {} });
    const direct = await local.generate({ ...ask(), model: "claude-haiku-4-5" }).catch((e) => e as AiError);
    const err = await rejects(generate(ask()), kind);
    assert.equal(err.message, (direct as AiError).message, "same wording as a local run");
    assert.equal(err.status, (direct as AiError).status);
    assert.equal(err.provider, AGENT_SDK_ID);
  }
  // A rejected plan token on the route makes the caller report unavailable until a call succeeds.
  {
    const r = route([{ isError: { result: "bad", status: 401 } }, { text: "ok" }]);
    const w = wire(r.handler);
    const p = caller(w.fetchStub);
    await rejects(p.generate(ask()), "auth");
    assert.equal((await p.available()).ok, false);
    assert.equal((await p.generate(ask())).text, "ok");
    assert.deepEqual(await p.available(), { ok: true });
  }

  // Transport failures become AiErrors.
  const r0 = route([{ text: "x" }]);
  const failing = async (a: (req: Request) => Promise<Response> | Response, kind: AiErrorKind, match?: RegExp) => {
    caller(wire(r0.handler, a).fetchStub);
    const e = await rejects(generate(ask()), kind);
    if (match) assert.match(e.message, match);
    return e;
  };
  await failing(() => Promise.reject(new TypeError("fetch failed")), "unavailable", /could not be reached: fetch failed/);
  await failing(() => new Response("nope", { status: 401 }), "unavailable", /AI_AGENT_SDK_SECRET differs/);
  await failing(() => new Response("{}", { status: 503 }), "unavailable", /switched off/);
  await failing(() => new Response("timeout", { status: 504 }), "timeout");
  await failing(() => new Response("<html>bad gateway</html>", { status: 502 }), "provider", /502/);
  await failing(() => new Response("not json", { status: 200 }), "provider");
  await failing(() => Response.json({ ok: true, result: { nope: 1 } }), "provider", /malformed/);
  await failing(() => Response.json({ ok: false, error: { kind: "made_up", message: "x" } }), "provider");

  // The caller times out under the route's maxDuration, and the fetch is aborted.
  {
    let aborted = false;
    const fetchStub = (async (_u: string, init: RequestInit) => {
      return new Promise<Response>((_res, rej) => (init.signal as AbortSignal).addEventListener("abort", () => ((aborted = true), rej(new DOMException("aborted", "AbortError")))));
    }) as unknown as typeof fetch;
    caller(fetchStub, { timeoutMs: 30 });
    await rejects(generate(ask()), "timeout");
    assert.equal(aborted, true);
    // The caller's own signal cancels too.
    aborted = false;
    caller(fetchStub, { timeoutMs: 60_000 });
    const ctl = new AbortController();
    const pending = generate(ask({ signal: ctl.signal }));
    setTimeout(() => ctl.abort(), 20);
    const e = await rejects(pending, "timeout");
    assert.match(e.message, /cancelled|too long/);
    assert.equal(aborted, true);
  }

  // Missing secret or URL: unavailable, and fetch is never called.
  {
    const w = wire(r0.handler);
    caller(w.fetchStub, { env: { AI_AGENT_SDK_SECRET: undefined } });
    await rejects(generate(ask()), "unavailable");
    caller(w.fetchStub, { env: { VERCEL_URL: undefined, VERCEL_PROJECT_PRODUCTION_URL: undefined } });
    await rejects(generate(ask()), "unavailable");
    assert.equal(w.seen.length, 0);
  }
}

async function availability(): Promise<void> {
  const q = stubQuery([{ text: "x" }]);
  const mk = (env: Record<string, string | undefined>) => createAnthropicAgentSdkProvider({ env, remote: true, query: q.query });
  const saved = { v: process.env.VERCEL, f: process.env.AI_AGENT_SDK };
  try {
    process.env.VERCEL = "1";
    process.env.AI_AGENT_SDK = "1";
    assert.deepEqual(await mk(CALLER_ENV).available(), { ok: true });
    const noSecret = await mk({ ...CALLER_ENV, AI_AGENT_SDK_SECRET: undefined }).available();
    assert.equal(noSecret.ok, false);
    assert.match(noSecret.ok ? "" : noSecret.reason, /AI_AGENT_SDK_SECRET/);
    const noToken = await mk({ ...CALLER_ENV, CLAUDE_CODE_OAUTH_TOKEN: undefined }).available();
    assert.equal(noToken.ok, false);
    assert.match(noToken.ok ? "" : noToken.reason, /CLAUDE_CODE_OAUTH_TOKEN/);
    const expired = await mk({ ...CALLER_ENV, CLAUDE_CODE_OAUTH_TOKEN_CREATED: "2020-01-01" }).available();
    assert.equal(expired.ok, false);
    delete process.env.AI_AGENT_SDK;
    assert.equal((await mk(CALLER_ENV).available()).ok, false, "off unless AI_AGENT_SDK=1");
    // The default on Vercel is remote: with VERCEL set and no `remote` option the secret is demanded.
    process.env.AI_AGENT_SDK = "1";
    const dflt = createAnthropicAgentSdkProvider({ env: { ...CALLER_ENV, AI_AGENT_SDK_SECRET: undefined } });
    assert.equal((await dflt.available()).ok, false);
    delete process.env.VERCEL;
    assert.deepEqual(await createAnthropicAgentSdkProvider({ env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN }, query: q.query }).available(), { ok: true }, "locally the secret is not needed");
    assert.equal(q.calls.length, 0, "available() never calls the model");
  } finally {
    if (saved.v === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = saved.v;
    if (saved.f === undefined) delete process.env.AI_AGENT_SDK;
    else process.env.AI_AGENT_SDK = saved.f;
  }

  assert.equal(selfUrl({ AI_AGENT_SDK_URL: "http://localhost:3000/" }), "http://localhost:3000");
  assert.equal(selfUrl({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "cards.example.com", VERCEL_URL: "x.vercel.app" }), "https://cards.example.com");
  assert.equal(selfUrl({ VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "cards.example.com", VERCEL_URL: "x.vercel.app" }), "https://x.vercel.app");
  assert.equal(selfUrl({ VERCEL_PROJECT_PRODUCTION_URL: "cards.example.com" }), "https://cards.example.com");
  assert.equal(selfUrl({}), undefined);
}

/** `src/proxy.ts` exempts exactly the route from Basic Auth, and nothing new besides what was exempt before. */
function proxyExemption(): void {
  // The first matcher entry is the path list; the second only sends every Server Function POST through the proxy.
  const matcher = (proxyConfig as unknown as { matcher: [string, ...unknown[]] }).matcher[0];
  const re = new RegExp(`^${matcher}$`);
  const protectedPath = (p: string) => re.test(p);
  assert.equal(protectedPath(ROUTE_PATH), false, "the route is exempt");
  for (const p of [ROUTE_PATH + "/", ROUTE_PATH + "/x", ROUTE_PATH + "x", "/api/ai", "/api/ai/other", "/api/ai/agent-sdk-debug", "/api/scan", "/api/v1/games", "/decks", "/settings", "/", "/api/syncx"]) {
    assert.equal(protectedPath(p), true, `${p} stays behind the sign-in`);
  }
  for (const p of ["/api/sync/prices", "/api/sync/meta", "/icons/a.png", "/manifest.webmanifest", "/sw.js", "/favicon.ico", "/_next/static/a.js"]) {
    assert.equal(protectedPath(p), false, `${p} stays exempt`);
  }
}

/** The binary is added to that one route only, and only in a build made with AI_AGENT_SDK=1. */
function tracing(): void {
  // next.config.ts is read at import, so each flag value gets its own process.
  const read = (flag: string | undefined) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (flag === undefined) delete env.AI_AGENT_SDK;
    else env.AI_AGENT_SDK = flag;
    const out = execFileSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), "-e", 'import("./next.config.ts").then((m) => console.log(JSON.stringify(m.default.default ?? m.default)))'], { env, encoding: "utf8" });
    return JSON.parse(out.trim().split("\n").pop() as string) as { outputFileTracingIncludes?: Record<string, string[]>; serverExternalPackages?: string[] };
  };
  const off = read(undefined);
  assert.equal(off.outputFileTracingIncludes, undefined, "a default build carries no binary");
  assert.equal(off.serverExternalPackages, undefined);
  assert.equal(read("true").outputFileTracingIncludes, undefined, "only the exact value 1 switches it on");
  const on = read("1");
  assert.deepEqual(Object.keys(on.outputFileTracingIncludes ?? {}), [ROUTE_PATH], "exactly one route carries the binary");
  assert.deepEqual(on.outputFileTracingIncludes?.[ROUTE_PATH], ["./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**/*"]);
  assert.deepEqual(on.serverExternalPackages, ["@anthropic-ai/claude-agent-sdk"]);
}

async function main(): Promise<void> {
  const vercel = process.env.VERCEL;
  delete process.env.VERCEL;
  try {
    await guard();
    await forwarding();
    await availability();
    proxyExemption();
    tracing();
  } finally {
    resetProviders();
    forgetAvailability();
    if (vercel !== undefined) process.env.VERCEL = vercel;
  }
  console.log("  ai-agent-sdk-route: secret guard (401 / 503 / 400, no query), result and AiError round trip, caller forwarding (URL, header, body shape, timeout, transport errors), availability on Vercel, Basic Auth exemption of exactly this path, binary traced into one route");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
