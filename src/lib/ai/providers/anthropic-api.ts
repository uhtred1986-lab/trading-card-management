/**
 * The Anthropic API (pay per token, `ANTHROPIC_API_KEY`). The only file that
 * knows how a neutral `AiRequest` becomes an Anthropic request: structured
 * output, cache hints, effort and adaptive thinking only where the model has
 * them, usage with the cache tokens, and the SDK's errors as `AiError`s.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { aiError, AiError } from "../errors";
import { ANTHROPIC_MODELS, ANTHROPIC_TIERS, modelsOf } from "../models";
import type { AiProvider, AiRequest, AiResult, Availability, Capabilities, ModelInfo, Part, SystemBlock } from "../types";

const ID = "anthropic-api";
const LABEL = "Anthropic";

/**
 * `ANTHROPIC_API_KEY` as everywhere else, or `APP_ANTHROPIC_API_KEY` where
 * the first name is taken: Claude Code on the web reserves it for the session's
 * own authentication and refuses to store it as an environment variable, so a
 * sandbox that runs the arena scripts needs a second name for the same key.
 */
export function anthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || process.env.APP_ANTHROPIC_API_KEY || undefined;
}

let cached: Anthropic | null = null;

/** The shared SDK client. Only for the feature modules not yet moved onto `generateJson` (#513, #514). */
export function legacyAnthropicClient(): Anthropic {
  const apiKey = anthropicKey();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set — AI features are disabled.");
  return (cached ??= new Anthropic({ apiKey }));
}

function systemOf(blocks: SystemBlock[]): string | Anthropic.TextBlockParam[] | undefined {
  if (blocks.length === 0) return undefined;
  // One block with no cache hint goes as the plain string it always was.
  if (blocks.length === 1 && (blocks[0].cache ?? "none") === "none") return blocks[0].text;
  return blocks.map((b) => ({
    type: "text" as const,
    text: b.text,
    ...(b.cache === "short" ? { cache_control: { type: "ephemeral" as const } } : b.cache === "long" ? { cache_control: { type: "ephemeral" as const, ttl: "1h" as const } } : {}),
  }));
}

function partOf(p: Part): Anthropic.ContentBlockParam {
  if (p.type === "text") return { type: "text", text: p.text };
  return { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.base64 } };
}

function messageOf(m: AiRequest["messages"][number]): Anthropic.MessageParam {
  // A single text part is the plain string content it always was.
  if (m.parts.length === 1 && m.parts[0].type === "text") return { role: m.role, content: m.parts[0].text };
  return { role: m.role, content: m.parts.map(partOf) };
}

function modelFor(req: AiRequest): string {
  if (req.model) return req.model;
  if (req.tier) return ANTHROPIC_TIERS[req.tier];
  throw new AiError("unsupported", "An AI request needs a tier or a model.", { provider: ID });
}

/** The Anthropic request for `req`. Exported so a check can show what is sent without sending it. */
export function buildAnthropicParams(req: AiRequest): Anthropic.MessageCreateParamsNonStreaming {
  const model = modelFor(req);
  const caps = ANTHROPIC_MODELS[model];
  const effort = caps?.effort ? req.effort : undefined;
  const format = req.output?.kind === "json" ? zodOutputFormat(req.output.schema as Parameters<typeof zodOutputFormat>[0]) : undefined;
  const system = systemOf(req.system);
  return {
    model,
    max_tokens: req.maxTokens,
    ...(caps?.adaptiveThinking && req.thinking === "adaptive" ? { thinking: { type: "adaptive" as const } } : {}),
    ...(effort || format ? { output_config: { ...(effort ? { effort } : {}), ...(format ? { format } : {}) } } : {}),
    ...(system !== undefined ? { system } : {}),
    messages: req.messages.map(messageOf),
  };
}

function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return aiError("timeout", LABEL, { provider: ID, detail: "The request was cancelled.", cause: err });
  if (err instanceof Anthropic.APIConnectionTimeoutError) return aiError("timeout", LABEL, { provider: ID, cause: err });
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return aiError("auth", LABEL, { provider: ID, status: err.status, cause: err });
  if (err instanceof Anthropic.RateLimitError) return aiError("rate_limit", LABEL, { provider: ID, status: err.status, cause: err });
  if (err instanceof Anthropic.APIError) {
    // An account with no credit left answers 400, not 429.
    if (/credit balance|usage limit/i.test(err.message)) return aiError("usage_limit", LABEL, { provider: ID, status: err.status, detail: err.message, cause: err });
    return aiError("provider", LABEL, { provider: ID, status: err.status, detail: err.message, cause: err });
  }
  return aiError("provider", LABEL, { provider: ID, detail: err instanceof Error ? err.message : String(err), cause: err });
}

export interface AnthropicApiOptions {
  /** Defaults to the shared client built from the key in the environment. */
  client?: Anthropic;
  /** A recorded transport for the contract suite: builds the client around this `fetch`. */
  fetch?: typeof fetch;
  apiKey?: string;
}

export function createAnthropicApiProvider(opts: AnthropicApiOptions = {}): AiProvider {
  // A client built around a recorded transport lives as long as the provider.
  let own: Anthropic | null = null;
  const get = (): Anthropic => {
    if (opts.client) return opts.client;
    if (opts.fetch) return (own ??= new Anthropic({ apiKey: opts.apiKey ?? "sk-test-not-a-real-key", fetch: opts.fetch, maxRetries: 0 }));
    return legacyAnthropicClient();
  };

  return {
    id: ID,
    label: "Anthropic API",
    capabilities(): Capabilities {
      return { vision: true, json: true, streaming: false, cacheHints: true, batch: false };
    },
    async available(): Promise<Availability> {
      if (opts.fetch || opts.client || anthropicKey()) return { ok: true };
      return { ok: false, reason: "ANTHROPIC_API_KEY is not set — AI features are disabled." };
    },
    async listModels(): Promise<ModelInfo[]> {
      // From models.ts. No context length: the repo does not record one, and a number made up here would be shown as fact.
      return modelsOf(ID).map((m) => ({ id: m.id, label: m.label, capabilities: { vision: m.vision, json: true, tools: true }, usdPerMTok: { in: m.usdPerMTok.input, out: m.usdPerMTok.output } }));
    },
    async generate(req: AiRequest): Promise<AiResult> {
      if (!opts.client && !opts.fetch && !anthropicKey()) throw aiError("unavailable", LABEL, { provider: ID, detail: "ANTHROPIC_API_KEY is not set — AI features are disabled." });
      const params = buildAnthropicParams(req);
      const started = Date.now();
      let res: Anthropic.Message;
      try {
        // `create`, not `parse`: the request body is the same, but a malformed
        // answer comes back as text for core's one retry rather than as a throw.
        res = await get().messages.create(params, req.signal ? { signal: req.signal } : undefined);
      } catch (err) {
        throw toAiError(err);
      }
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return {
        text,
        stop: res.stop_reason === "refusal" ? "refusal" : res.stop_reason === "max_tokens" ? "max_tokens" : "end",
        usage: {
          input: res.usage.input_tokens,
          output: res.usage.output_tokens,
          cacheRead: res.usage.cache_read_input_tokens ?? 0,
          cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
        },
        provider: ID,
        model: params.model,
        billed: true,
        latencyMs: Date.now() - started,
      };
    },
  };
}
