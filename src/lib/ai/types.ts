/**
 * The neutral AI contract (docs/architecture/ai-providers.md). Nothing in this
 * file may name a vendor: feature code speaks these types, and only
 * `providers/*` turns them into a vendor's request.
 */
import type { ZodType } from "zod";
import type { RunKind } from "./client";

/** `anthropic-api` and `anthropic-agent-sdk` today; any string so a vendor adapter needs no edit here. */
export type ProviderId = "anthropic-api" | "anthropic-agent-sdk" | (string & {});
/** fast = Haiku, standard = Sonnet, best = Opus today (#381). */
export type Tier = "fast" | "standard" | "best";
export type TaskId = RunKind;
/** Anthropic: `short` is the default 5 minute cache, `long` the 1 hour TTL the arena uses; other providers ignore it. */
export type CacheHint = "none" | "short" | "long";

export type Part =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string };

export interface AiMessage {
  role: "user" | "assistant";
  parts: Part[];
}

export interface SystemBlock {
  text: string;
  cache?: CacheHint;
}

export type AiOutput = { kind: "text" } | { kind: "json"; schema: ZodType };

export interface AiRequest {
  task: TaskId;
  /** Picks the model through the provider's table. One of `tier` and `model` is required. */
  tier?: Tier;
  /** An explicit model id wins over `tier`. */
  model?: string;
  system: SystemBlock[];
  messages: AiMessage[];
  maxTokens: number;
  /** Dropped, not rejected, where the model has no such control (Haiku). */
  effort?: "low" | "medium" | "high";
  /** Dropped where the model has none. */
  thinking?: "off" | "adaptive";
  output?: AiOutput;
  /** Hard pin to one provider, ahead of every setting. */
  provider?: ProviderId;
  signal?: AbortSignal;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface AiResult<T = unknown> {
  /** The model's text; for a JSON request, the raw JSON it answered with. */
  text: string;
  /** Validated against the request's Zod schema (set by `generateJson`). */
  parsed?: T;
  stop: "end" | "max_tokens" | "refusal";
  usage: Usage;
  provider: ProviderId;
  /** The model id the caller asked for: what the call is recorded and priced under. A vendor that served another id keeps it in {@link servedModel}. */
  model: string;
  /** False when the call ran on a subscription rather than per token. */
  billed: boolean;
  /**
   * What the call cost, in millionths of a US dollar, when the adapter knows it at call time (OpenRouter: the
   * response's own `usage.cost`, else the model's listed prices). Absent for the Anthropic adapters, whose cost
   * stays the list-price formula of `models.ts` (`costMicros`).
   */
  costMicros?: number;
  /** The model id the vendor says it served, when that differs from {@link model}. Informational only. */
  servedModel?: string;
  latencyMs: number;
}

export interface Capabilities {
  vision: boolean;
  json: boolean;
  streaming: boolean;
  cacheHints: boolean;
  batch: boolean;
}

export type Availability = { ok: true } | { ok: false; reason: string };

export interface ModelInfo {
  id: string;
  label: string;
  /** Tokens; absent when the vendor does not say. */
  contextLength?: number;
  capabilities: { vision: boolean; json: boolean; tools: boolean };
  /** US dollars per million tokens; absent when the vendor does not say. */
  usdPerMTok?: { in: number; out: number };
}

export interface AiProvider {
  id: ProviderId;
  label: string;
  capabilities(): Capabilities;
  /** Cheap; the router caches it. */
  available(): Promise<Availability>;
  listModels(): Promise<ModelInfo[]>;
  /**
   * Optional: loads what the provider needs to judge a model's capabilities (OpenRouter's model list), so the
   * router can check the chosen model before it sends. The router ignores a failure here.
   */
  prepare?(): Promise<void>;
  /** One request, one answer. Throws {@link AiError}, never a vendor's error. */
  generate(req: AiRequest): Promise<AiResult>;
}
