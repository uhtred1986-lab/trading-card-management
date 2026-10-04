/**
 * The Claude plan on Vercel (#518): the `claude` binary is 246 MB, so only ONE function carries it —
 * `src/app/api/ai/agent-sdk/route.ts`. Every other function that wants the plan forwards its request
 * there over HTTPS (the caller half below) and the route runs the same local adapter in-process
 * (the server half below). No vendor import here: the SDK is only reached through the adapter.
 *
 * Wire: the request is an {@link AiRequest} with what cannot cross JSON removed. The Zod schema is
 * already folded into the system prompt by the caller (`systemPromptOf`) and the output kind is
 * `text`; the caller's core validates the answer exactly as for a local run. The reply is
 * `{ ok: true, result }` or `{ ok: false, error: { kind, message, status?, provider? } }`, both with
 * HTTP 200, so a non-200 is always the platform or the guard and never a model error.
 *
 * Guard: a shared secret in `AI_AGENT_SDK_SECRET`, sent as {@link SECRET_HEADER}. The route is exempt
 * from Basic Auth (src/proxy.ts) because its callers are other functions, not browsers.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { aiError, AiError, type AiErrorKind } from "../errors";
import type { AiProvider, AiRequest, AiResult } from "../types";

type Env = Record<string, string | undefined>;

export const ROUTE_PATH = "/api/ai/agent-sdk";
export const SECRET_HEADER = "x-ai-agent-sdk-secret";
/** The route's `maxDuration` (seconds). Above the adapter's 110 s so the route reports its own timeout. */
export const ROUTE_MAX_DURATION_S = 150;
/** The caller gives up just under the route's `maxDuration`, so a hung function still ends in an AiError. */
export const FORWARD_TIMEOUT_MS = 140_000;
const MAX_BODY_BYTES = 8_000_000;

const KINDS = ["auth", "rate_limit", "usage_limit", "refusal", "bad_output", "unsupported", "unavailable", "timeout", "provider"] as const satisfies readonly AiErrorKind[];

const Part = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image"), mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]), base64: z.string() }),
]);

/** What the route accepts. */
export const WireRequest = z.object({
  task: z.string().min(1),
  model: z.string().min(1),
  system: z.array(z.object({ text: z.string() })),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), parts: z.array(Part) })).min(1),
  maxTokens: z.number().int().positive(),
  effort: z.enum(["low", "medium", "high"]).optional(),
  thinking: z.enum(["off", "adaptive"]).optional(),
});
export type WireRequest = z.infer<typeof WireRequest>;

/** `model` is resolved by the caller (its tier table), and `systemPrompt` is the prompt with the JSON Schema already in it. */
export function toWire(req: AiRequest, model: string, systemPrompt: string): WireRequest {
  return {
    task: req.task,
    model,
    system: [{ text: systemPrompt }],
    messages: req.messages,
    maxTokens: req.maxTokens,
    ...(req.effort ? { effort: req.effort } : {}),
    ...(req.thinking ? { thinking: req.thinking } : {}),
  };
}

export const fromWire = (w: WireRequest): AiRequest => ({ ...w, task: w.task as AiRequest["task"], output: { kind: "text" } });

export interface WireError {
  kind: AiErrorKind;
  message: string;
  status?: number;
  provider?: string;
}
export type WireReply = { ok: true; result: AiResult } | { ok: false; error: WireError };

export const wireError = (e: AiError): WireError => ({ kind: e.kind, message: e.message, ...(e.status !== undefined ? { status: e.status } : {}), ...(e.provider ? { provider: e.provider } : {}) });

function aiErrorOf(w: unknown): AiError {
  const o = (w ?? {}) as Partial<WireError>;
  const kind = (KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as AiErrorKind) : "provider";
  return new AiError(kind, typeof o.message === "string" ? o.message : "The Claude plan route failed.", { provider: typeof o.provider === "string" ? o.provider : undefined, status: typeof o.status === "number" ? o.status : undefined });
}

/** Constant-time comparison; false when either side is empty. */
export function secretMatches(given: string | null | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const h = (s: string) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(h(given), h(expected));
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export interface ServeDeps {
  env?: Env;
  /** The in-process adapter (`createAnthropicAgentSdkProvider({ remote: false })`). */
  provider: AiProvider;
}

/** The route's whole logic, as a function of a Request so a check can call it without a server. */
export async function serveAgentSdk(request: Request, deps: ServeDeps): Promise<Response> {
  const env = deps.env ?? process.env;
  // Guard first, before the body is read or anything is started. An unset secret refuses everyone.
  if (!secretMatches(request.headers.get(SECRET_HEADER), env.AI_AGENT_SDK_SECRET)) return json({ error: "unauthorized" }, 401);
  if (env.AI_AGENT_SDK !== "1") return json({ error: "The Claude plan is switched off (AI_AGENT_SDK is not 1)." }, 503);

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "request too large" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const parsed = WireRequest.safeParse((body as { request?: unknown } | null)?.request);
  if (!parsed.success) return json({ error: "invalid request", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);

  // The caller going away (a closed connection) aborts the run.
  const req: AiRequest = { ...fromWire(parsed.data), signal: request.signal };
  try {
    const result = await deps.provider.generate(req);
    return json({ ok: true, result } satisfies WireReply);
  } catch (err) {
    const e = err instanceof AiError ? err : aiError("provider", "Claude plan", { detail: err instanceof Error ? err.message : String(err) });
    return json({ ok: false, error: wireError(e) } satisfies WireReply);
  }
}

/** Where the deployment can reach itself. `AI_AGENT_SDK_URL` wins; otherwise the production domain, then the deployment URL. Both Vercel names carry no scheme. */
export function selfUrl(env: Env = process.env): string | undefined {
  const explicit = env.AI_AGENT_SDK_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  // VERCEL_URL sits behind deployment protection; the production domain does not.
  const host = (env.VERCEL_ENV === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL : undefined) || env.VERCEL_URL || env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!host) return undefined;
  return /^https?:\/\//.test(host) ? host.replace(/\/+$/, "") : `https://${host}`;
}

export interface ForwardOptions {
  env?: Env;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** The caller half: one request to the route, the route's answer or its error back as an {@link AiError}. */
export async function forwardToRoute(wire: WireRequest, provider: string, label: string, signal: AbortSignal | undefined, opts: ForwardOptions = {}): Promise<AiResult> {
  const env = opts.env ?? process.env;
  const base = selfUrl(env);
  const secret = env.AI_AGENT_SDK_SECRET;
  if (!secret) throw aiError("unavailable", label, { provider, detail: "AI_AGENT_SDK_SECRET is not set." });
  if (!base) throw aiError("unavailable", label, { provider, detail: "The deployment's own URL is unknown (VERCEL_URL, VERCEL_PROJECT_PRODUCTION_URL or AI_AGENT_SDK_URL)." });

  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, opts.timeoutMs ?? FORWARD_TIMEOUT_MS);
  const onCaller = () => ac.abort();
  if (signal?.aborted) ac.abort();
  else signal?.addEventListener("abort", onCaller, { once: true });

  let res: Response;
  let text: string;
  try {
    res = await (opts.fetch ?? fetch)(base + ROUTE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", [SECRET_HEADER]: secret },
      body: JSON.stringify({ request: wire }),
      signal: ac.signal,
      cache: "no-store",
    });
    text = await res.text();
  } catch (err) {
    if (timedOut) throw aiError("timeout", label, { provider, cause: err });
    if (ac.signal.aborted) throw aiError("timeout", label, { provider, detail: "The request was cancelled.", cause: err });
    throw aiError("unavailable", label, { provider, detail: `The Claude plan route could not be reached: ${err instanceof Error ? err.message : String(err)}`, cause: err });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCaller);
  }

  if (res.status === 401) throw aiError("unavailable", label, { provider, status: 401, detail: "The Claude plan route refused the request — AI_AGENT_SDK_SECRET differs between the functions." });
  if (res.status === 503) throw aiError("unavailable", label, { provider, status: 503, detail: "The Claude plan route is switched off (AI_AGENT_SDK was not 1 at build or run time)." });
  if (res.status === 504) throw aiError("timeout", label, { provider, status: 504 });
  let reply: Partial<WireReply> | undefined;
  try {
    reply = JSON.parse(text);
  } catch {
    // not JSON: handled below
  }
  if (res.status !== 200 || !reply) throw aiError("provider", label, { provider, status: res.status, detail: `The Claude plan route answered ${res.status} without a usable body.` });
  if (reply.ok === false) throw aiErrorOf(reply.error);
  const r = reply.ok === true ? reply.result : undefined;
  if (!r || typeof r.text !== "string" || !r.usage) throw aiError("provider", label, { provider, detail: "The Claude plan route returned a malformed result." });
  return r;
}
