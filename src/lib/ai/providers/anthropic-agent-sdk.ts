/**
 * The Claude plan (subscription) through the Claude Agent SDK, run locally
 * (#517, docs/architecture/ai-providers.md). The SDK starts a `claude` CLI
 * subprocess; this adapter turns it into a plain one-turn text model: no tools,
 * our system prompt in place of Claude Code's, no settings/CLAUDE.md/hooks/MCP,
 * an empty working directory, and a child environment built by hand so the
 * API keys can never reach it (the CLI would bill the API instead of the plan).
 *
 * SDK names relied on, checked against `sdk.d.ts` of @anthropic-ai/claude-agent-sdk
 * 0.3.289: `query`, `Options` (`abortController`, `cwd`, `env`, `model`, `effort`,
 * `thinking`, `tools`, `settingSources`, `systemPrompt`, `maxTurns`,
 * `persistSession`, `strictMcpConfig`, `permissionPrompts`), `SDKMessage`,
 * `SDKResultMessage`, `SDKUserMessage`, `SDKAssistantMessageError`, `ModelUsage`.
 *
 * Structured answers: the JSON Schema goes into the system prompt and core
 * validates the text (and retries once); the SDK's native `outputFormat` is not
 * used because its interaction with `maxTurns: 1` cannot be proven without a
 * live call. Image input goes in as image blocks of a streamed user message.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { aiError, AiError } from "../errors";
import { modelEntry, modelsOf, TIERS } from "../models";
import type { AiProvider, AiRequest, AiResult, Availability, Capabilities, ModelInfo, Part, SystemBlock, Usage } from "../types";

type Env = Record<string, string | undefined>;
/** The SDK types the contract checks stub, re-exported so nothing outside `providers/` imports the vendor package. */
export type { Options, SDKMessage, SDKUserMessage };

export const AGENT_SDK_ID = "anthropic-agent-sdk";
const LABEL = "Claude plan";

/** The one-year lifetime of a `claude setup-token` token, and when settings start to warn. */
export const TOKEN_LIFETIME_DAYS = 365;
export const TOKEN_WARN_DAYS = 30;
const DAY_MS = 86_400_000;
/** Below the 300 s default function duration; one process start plus the answer. */
export const DEFAULT_TIMEOUT_MS = 110_000;

/** `CLAUDE_CODE_OAUTH_TOKEN`, or `APP_CLAUDE_CODE_OAUTH_TOKEN` where Claude Code on the web reserves the first name. */
export function agentSdkToken(env: Env = process.env): string | undefined {
  return env.CLAUDE_CODE_OAUTH_TOKEN || env.APP_CLAUDE_CODE_OAUTH_TOKEN || undefined;
}

export interface TokenExpiry {
  expiresOn: string;
  daysLeft: number;
  state: "ok" | "soon" | "expired";
  message?: string;
}

/** `CLAUDE_CODE_OAUTH_TOKEN_CREATED` (YYYY-MM-DD) plus a year; warns for the last 30 days. Null when unset or unreadable. */
export function tokenExpiry(created: string | undefined, now: Date = new Date()): TokenExpiry | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(created?.trim() ?? "");
  if (!m) return null;
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(start)) return null;
  const expires = start + TOKEN_LIFETIME_DAYS * DAY_MS;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysLeft = Math.round((expires - today) / DAY_MS);
  const expiresOn = new Date(expires).toISOString().slice(0, 10);
  if (daysLeft < 0) return { expiresOn, daysLeft, state: "expired", message: `The Claude plan token expired on ${expiresOn}. Run \`claude setup-token\` and update CLAUDE_CODE_OAUTH_TOKEN and CLAUDE_CODE_OAUTH_TOKEN_CREATED.` };
  if (daysLeft <= TOKEN_WARN_DAYS) return { expiresOn, daysLeft, state: "soon", message: `The Claude plan token expires on ${expiresOn} (${daysLeft} day${daysLeft === 1 ? "" : "s"} left). Run \`claude setup-token\` for a new one.` };
  return { expiresOn, daysLeft, state: "ok" };
}

/** Variables the CLI needs to run at all (and to reach the network through a proxy). Everything else, API keys above all, stays behind. */
const PASS_THROUGH = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP",
  "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC", "PATHEXT", "HOMEDRIVE", "HOMEPATH",
  "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE",
];

/**
 * The child process environment. The SDK's `env` replaces the environment
 * entirely, so this is an allow-list: `ANTHROPIC_API_KEY`, `APP_ANTHROPIC_API_KEY`
 * and every other variable are simply not copied.
 */
export function buildChildEnv(token: string, source: Env = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of PASS_THROUGH) if (source[k]) env[k] = source[k] as string;
  env.CLAUDE_CODE_OAUTH_TOKEN = token;
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  return env;
}

type QueryFn = (params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) => Query | AsyncIterable<SDKMessage>;

export interface AgentSdkOptions {
  /** The SDK's `query`. A stub in the contract suite; the real one is loaded on first use. */
  query?: QueryFn;
  /** Where the token comes from; defaults to `process.env`. */
  env?: Env;
  timeoutMs?: number;
  /** Working directory for the child. Defaults to a fresh empty directory under `os.tmpdir()`. */
  cwd?: string;
  log?: (msg: string) => void;
}

async function loadQuery(): Promise<QueryFn> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  return sdk.query as QueryFn;
}

function modelFor(req: AiRequest): string {
  if (req.model) return req.model;
  if (req.tier) return TIERS[AGENT_SDK_ID][req.tier];
  throw new AiError("unsupported", "An AI request needs a tier or a model.", { provider: AGENT_SDK_ID });
}

function jsonInstruction(schema: z.ZodType): string {
  const js = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete js.$schema;
  return `Answer with a single JSON value that matches this JSON Schema, and nothing else — no prose, no code fence.\n${JSON.stringify(js)}`;
}

/** The system prompt: our blocks joined (cache hints do not apply), plus the schema for a JSON request. */
export function systemPromptOf(req: AiRequest): string {
  const parts: string[] = req.system.map((b: SystemBlock) => b.text);
  if (req.output?.kind === "json") parts.push(jsonInstruction(req.output.schema));
  return parts.join("\n\n");
}

type Block = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string } };

const blockOf = (p: Part): Block => (p.type === "text" ? { type: "text", text: p.text } : { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.base64 } });

/**
 * The prompt. One user message goes in as it is; a longer conversation (core's
 * retry carries the rejected answer) is laid out as a transcript, because a
 * query takes one prompt. Text only gives a string; with an image, one streamed
 * user message of content blocks.
 */
export function promptOf(messages: AiRequest["messages"]): string | AsyncIterable<SDKUserMessage> {
  const blocks: Block[] = [];
  if (messages.length === 1 && messages[0].role === "user") blocks.push(...messages[0].parts.map(blockOf));
  else
    for (const m of messages) {
      blocks.push({ type: "text", text: m.role === "user" ? "[User]" : "[You, earlier in this conversation]" }, ...m.parts.map(blockOf));
    }
  if (blocks.every((b) => b.type === "text")) return blocks.map((b) => (b as { text: string }).text).join("\n");
  const message: SDKUserMessage = { type: "user", message: { role: "user", content: blocks }, parent_tool_use_id: null };
  return (async function* () {
    yield message;
  })();
}

const AUTH_ERRORS = new Set(["authentication_failed", "oauth_org_not_allowed", "account_on_hold", "verification_required"]);

/** An error the CLI reported, in the kinds the app knows. 429 and billing are the plan's usage limit. */
function classify(detail: string, opts: { error?: string; status?: number | null }): AiError {
  const { error, status } = opts;
  const d = detail.slice(0, 300);
  const o = { provider: AGENT_SDK_ID, status: status ?? undefined };
  if (status === 401 || status === 403 || (error && AUTH_ERRORS.has(error))) return aiError("auth", LABEL, { ...o, detail: d || "The Claude plan token was rejected — run `claude setup-token` again." });
  if (status === 429 || error === "rate_limit" || error === "billing_error" || /usage limit|limit reached|rate.?limit|too many requests|\b429\b/i.test(detail)) {
    return aiError("usage_limit", LABEL, { ...o, detail: d });
  }
  return aiError("provider", LABEL, { ...o, detail: d });
}

type PerModel = Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>;

const sum = (u: PerModel): Usage =>
  Object.values(u).reduce<Usage>(
    (a, m) => ({ input: a.input + m.inputTokens, output: a.output + m.outputTokens, cacheRead: a.cacheRead + m.cacheReadInputTokens, cacheWrite: a.cacheWrite + m.cacheCreationInputTokens }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );

export function createAnthropicAgentSdkProvider(opts: AgentSdkOptions = {}): AiProvider {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((m: string) => console.warn(m));
  let dir: string | undefined = opts.cwd;
  let loggedCache = false;
  let lastAuthFailure: string | undefined;

  const workDir = (): string => (dir ??= fs.mkdtempSync(path.join(os.tmpdir(), "tcm-agent-sdk-")));

  return {
    id: AGENT_SDK_ID,
    label: "Claude plan (Agent SDK)",
    capabilities(): Capabilities {
      // json: core validates the answer itself, and scripts/verify/ai-agent-sdk.ts proves that path end to end.
      // vision stays false until a live scan on the plan proves the CLI reads the image blocks (#517: unproven
      // stays false), so the router sends scan_identify to the fallback provider meanwhile.
      return { vision: false, json: true, streaming: false, cacheHints: false, batch: false };
    },
    async available(): Promise<Availability> {
      if (process.env.VERCEL) return { ok: false, reason: "The Claude plan is not available on Vercel yet (#518); it runs locally." };
      if (!agentSdkToken(env)) return { ok: false, reason: "CLAUDE_CODE_OAUTH_TOKEN is not set — run `claude setup-token` and put the token in .env.local." };
      const exp = tokenExpiry(env.CLAUDE_CODE_OAUTH_TOKEN_CREATED);
      if (exp?.state === "expired") return { ok: false, reason: exp.message ?? "The Claude plan token has expired." };
      if (lastAuthFailure) return { ok: false, reason: lastAuthFailure };
      if (!opts.query) {
        try {
          await loadQuery();
        } catch (err) {
          return { ok: false, reason: `The Claude Agent SDK could not be loaded: ${err instanceof Error ? err.message : String(err)}` };
        }
      }
      return { ok: true };
    },
    async listModels(): Promise<ModelInfo[]> {
      // No prices: on the plan there is no per-token bill to show.
      return modelsOf(AGENT_SDK_ID).map((m) => ({ id: m.id, label: m.label, capabilities: { vision: false, json: true, tools: false } }));
    },
    async generate(req: AiRequest): Promise<AiResult> {
      const token = agentSdkToken(env);
      if (process.env.VERCEL) throw aiError("unavailable", LABEL, { provider: AGENT_SDK_ID, detail: "The Claude plan is not available on Vercel yet (#518)." });
      if (!token) throw aiError("unavailable", LABEL, { provider: AGENT_SDK_ID, detail: "CLAUDE_CODE_OAUTH_TOKEN is not set." });
      if (!loggedCache && req.system.some((b) => b.cache && b.cache !== "none")) {
        loggedCache = true;
        log(`[ai] ${LABEL}: cache hints are ignored (the CLI manages its own prompt cache).`);
      }

      const model = modelFor(req);
      const entry = modelEntry(model, AGENT_SDK_ID);
      const ac = new AbortController();
      const options: Options = {
        model,
        systemPrompt: systemPromptOf(req),
        tools: [],
        maxTurns: 1,
        settingSources: [],
        strictMcpConfig: true,
        persistSession: false,
        permissionPrompts: "none",
        cwd: workDir(),
        env: buildChildEnv(token, env),
        abortController: ac,
        ...(entry?.effort && req.effort ? { effort: req.effort } : {}),
        ...(entry?.adaptiveThinking ? { thinking: req.thinking === "adaptive" ? { type: "adaptive" as const } : { type: "disabled" as const } } : {}),
      };

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const onCaller = () => ac.abort();
      if (req.signal?.aborted) ac.abort();
      else req.signal?.addEventListener("abort", onCaller, { once: true });

      const started = Date.now();
      let q: Query | AsyncIterable<SDKMessage> | undefined;
      let text = "";
      let assistantError: string | undefined;
      let rejected: string | undefined;
      let result: Extract<SDKMessage, { type: "result" }> | undefined;
      try {
        const query = opts.query ?? (await loadQuery());
        q = query({ prompt: promptOf(req.messages), options });
        for await (const msg of q) {
          if (ac.signal.aborted) break;
          if (msg.type === "assistant") {
            if (msg.error) assistantError = msg.error;
            for (const b of msg.message.content) if (b.type === "text") text += b.text;
          } else if (msg.type === "rate_limit_event" && msg.rate_limit_info.status === "rejected") {
            rejected = msg.rate_limit_info.resetsAt ? `resets ${new Date(msg.rate_limit_info.resetsAt * 1000).toISOString()}` : "plan limit reached";
          } else if (msg.type === "result") {
            result = msg;
          }
        }
      } catch (err) {
        if (timedOut) throw aiError("timeout", LABEL, { provider: AGENT_SDK_ID, cause: err });
        if (ac.signal.aborted) throw aiError("timeout", LABEL, { provider: AGENT_SDK_ID, detail: "The request was cancelled.", cause: err });
        if (err instanceof AiError) throw err;
        throw classify(err instanceof Error ? err.message : String(err), {});
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener("abort", onCaller);
        // The process must not outlive the call.
        try {
          (q as Query | undefined)?.close?.();
        } catch {
          // already gone
        }
      }
      if (timedOut) throw aiError("timeout", LABEL, { provider: AGENT_SDK_ID });
      if (ac.signal.aborted) throw aiError("timeout", LABEL, { provider: AGENT_SDK_ID, detail: "The request was cancelled." });

      if (!result) {
        if (rejected) throw aiError("usage_limit", LABEL, { provider: AGENT_SDK_ID, detail: rejected });
        throw classify(assistantError ?? (text || "The Claude CLI ended without an answer."), { error: assistantError });
      }
      if (result.is_error || result.subtype !== "success") {
        const detail = result.subtype === "success" ? result.result : result.errors.join("; ");
        const err = classify(detail || (rejected ?? ""), { error: assistantError, status: result.subtype === "success" ? result.api_error_status : undefined });
        if (rejected && err.kind === "provider") throw aiError("usage_limit", LABEL, { provider: AGENT_SDK_ID, detail: rejected });
        if (err.kind === "auth") lastAuthFailure = err.message;
        throw err;
      }
      lastAuthFailure = undefined;

      const stop: AiResult["stop"] = result.stop_reason === "refusal" ? "refusal" : result.stop_reason === "max_tokens" || assistantError === "max_output_tokens" ? "max_tokens" : "end";
      const usage = Object.keys(result.modelUsage ?? {}).length
        ? sum(result.modelUsage)
        : { input: result.usage?.input_tokens ?? 0, output: result.usage?.output_tokens ?? 0, cacheRead: result.usage?.cache_read_input_tokens ?? 0, cacheWrite: result.usage?.cache_creation_input_tokens ?? 0 };
      return { text: result.result || text, stop, usage, provider: AGENT_SDK_ID, model, billed: false, latencyMs: Date.now() - started };
    },
  };
}
