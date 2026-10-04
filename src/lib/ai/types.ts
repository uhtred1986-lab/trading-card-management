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
  model: string;
  /** False when the call ran on a subscription rather than per token. */
  billed: boolean;
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
  /** One request, one answer. Throws {@link AiError}, never a vendor's error. */
  generate(req: AiRequest): Promise<AiResult>;
}
