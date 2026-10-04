/**
 * OpenRouter (#520): many vendors' models behind one key and one
 * OpenAI-compatible API. Plain `fetch`, no SDK. Field names are the ones in
 * OpenRouter's documentation (listed in the PR for #520): `POST
 * /chat/completions` with `messages`, `response_format` (`json_schema`),
 * `reasoning`, `max_tokens`, `cache_control` on content parts;
 * `usage.prompt_tokens_details.{cached_tokens,cache_write_tokens}`; errors as
 * `{ error: { code, message } }`, which can also arrive inside a 200.
 *
 * Capabilities are per model, read from `GET /models`: image input from
 * `architecture.input_modalities`, structured output / reasoning / tools from
 * `supported_parameters`. A model that does not list a feature is never sent it.
 */
import { z } from "zod";
import { aiError, AiError, type AiErrorKind } from "../errors";
import { rememberModelPrices } from "../models";
import type { AiProvider, AiRequest, AiResult, Availability, Capabilities, ModelInfo, Part, SystemBlock } from "../types";

const ID = "openrouter";
const LABEL = "OpenRouter";
const BASE_URL = "https://openrouter.ai/api/v1";
const MODELS_TTL_MS = 60 * 60 * 1000;
const AVAILABLE_TTL_MS = 5 * 60 * 1000;

export function openRouterKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY?.trim() || undefined;
}

/** What one model can take, read from its entry in the models list. */
export interface ModelCaps {
  vision: boolean;
  structured: boolean;
  reasoning: boolean;
  tools: boolean;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
  supported_parameters?: unknown;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** USD per token ("0.000003", a string) → USD per million tokens. Unknown or negative (a router with no fixed price) → undefined. */
export function perMTok(perToken: unknown): number | undefined {
  const n = typeof perToken === "string" || typeof perToken === "number" ? Number(perToken) : NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Number((n * 1_000_000).toPrecision(10));
}

/** One model of the list as the picker wants it, with the capabilities the adapter keeps. */
export function parseModel(raw: RawModel): { info: ModelInfo; caps: ModelCaps } | undefined {
  if (typeof raw.id !== "string" || !raw.id) return undefined;
  // Anything that does not produce text is not a chat model.
  const out = strings(raw.architecture?.output_modalities);
  if (out.length && !out.includes("text")) return undefined;
  const params = strings(raw.supported_parameters);
  const caps: ModelCaps = {
    vision: strings(raw.architecture?.input_modalities).includes("image"),
    structured: params.includes("structured_outputs"),
    reasoning: params.includes("reasoning"),
    tools: params.includes("tools"),
  };
  const inPrice = perMTok(raw.pricing?.prompt);
  const outPrice = perMTok(raw.pricing?.completion);
  const info: ModelInfo = {
    id: raw.id,
    label: typeof raw.name === "string" && raw.name ? raw.name : raw.id,
    ...(typeof raw.context_length === "number" ? { contextLength: raw.context_length } : {}),
    // The pickers prefer structured output, so `json` here means the model lists `structured_outputs`.
    capabilities: { vision: caps.vision, json: caps.structured, tools: caps.tools },
    ...(inPrice !== undefined && outPrice !== undefined ? { usdPerMTok: { in: inPrice, out: outPrice } } : {}),
  };
  return { info, caps };
}

/** `cache_control` is documented for Anthropic's models; other families get no hint. */
const takesCacheControl = (model: string): boolean => model.startsWith("anthropic/");

type OrPart = { type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl?: "1h" } } | { type: "image_url"; image_url: { url: string } };

function partOf(p: Part): OrPart {
  if (p.type === "text") return { type: "text", text: p.text };
  return { type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.base64}` } };
}

function systemMessage(blocks: SystemBlock[], model: string, extra: string | undefined): { role: "system"; content: string | OrPart[] } | undefined {
  const all: SystemBlock[] = extra ? [...blocks, { text: extra }] : blocks;
  if (all.length === 0) return undefined;
  const cached = takesCacheControl(model) && all.some((b) => (b.cache ?? "none") !== "none");
  if (!cached) return { role: "system", content: all.map((b) => b.text).join("\n\n") };
  return {
    role: "system",
    content: all.map((b) => ({
      type: "text" as const,
      text: b.text,
      ...(b.cache === "short" ? { cache_control: { type: "ephemeral" as const } } : b.cache === "long" ? { cache_control: { type: "ephemeral" as const, ttl: "1h" as const } } : {}),
    })),
  };
}

function messageOf(m: AiRequest["messages"][number]): { role: string; content: string | OrPart[] } {
  if (m.role === "assistant") return { role: "assistant", content: m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("") };
  if (m.parts.length === 1 && m.parts[0].type === "text") return { role: "user", content: m.parts[0].text };
  return { role: "user", content: m.parts.map(partOf) };
}

/** The JSON Schema of a Zod type, as OpenRouter's `response_format` takes it. */
function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const out = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete out.$schema;
  return out;
}

/** The chat-completions body for `req` on `model` whose capabilities are `caps` (unknown: nothing optional is sent). Exported so a check can show it. */
export function buildOpenRouterBody(req: AiRequest, model: string, caps: ModelCaps | undefined): Record<string, unknown> {
  const schema = req.output?.kind === "json" ? jsonSchemaOf(req.output.schema) : undefined;
  const native = !!schema && !!caps?.structured;
  // Without native structured output the schema goes in the prompt, and core validates (and retries once).
  const hint = schema && !native ? `Answer with only a JSON value that matches this JSON Schema, with no other text:\n${JSON.stringify(schema)}` : undefined;
  const system = systemMessage(req.system, model, hint);
  const reasoning = caps?.reasoning ? (req.effort ? { effort: req.effort } : req.thinking === "adaptive" ? { enabled: true } : undefined) : undefined;
  return {
    model,
    max_tokens: req.maxTokens,
    messages: [...(system ? [system] : []), ...req.messages.map(messageOf)],
    ...(native ? { response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema } } } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}

function kindOfStatus(status: number): AiErrorKind {
  if (status === 401) return "auth";
  if (status === 402) return "usage_limit";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  return "provider";
}

function errorFrom(status: number, body: unknown): AiError {
  const e = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const detail = typeof e?.message === "string" ? e.message : "";
  // An error inside a 200 carries its own code.
  const code = status >= 400 ? status : typeof e?.code === "number" ? e.code : status;
  const kind = kindOfStatus(code);
  if (kind === "usage_limit") return aiError("usage_limit", LABEL, { provider: ID, status: code, detail: detail || "your OpenRouter credits are used up — add credit at openrouter.ai/credits." });
  return aiError(kind, LABEL, { provider: ID, status: code, detail });
}

export interface OpenRouterOptions {
  /** A recorded transport for the contract suite. */
  fetch?: typeof fetch;
  apiKey?: string;
  baseUrl?: string;
  now?: () => number;
}

interface Choice {
  message?: { content?: unknown; refusal?: unknown };
  finish_reason?: string | null;
  error?: unknown;
}
interface Completion {
  model?: unknown;
  error?: unknown;
  choices?: Choice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } };
}

export function createOpenRouterProvider(opts: OpenRouterOptions = {}): AiProvider {
  const fetchImpl: typeof fetch = opts.fetch ?? ((...a) => fetch(...a));
  const base = opts.baseUrl ?? BASE_URL;
  const now = opts.now ?? Date.now;
  const key = () => opts.apiKey ?? openRouterKey();

  let list: { at: number; infos: ModelInfo[]; caps: Map<string, ModelCaps> } | null = null;
  let health: { at: number; result: Availability } | null = null;

  const headers = (withJson: boolean): Record<string, string> => {
    const k = key();
    // App attribution (optional): the title only has effect together with HTTP-Referer.
    const referer = process.env.OPENROUTER_APP_URL?.trim();
    return {
      ...(k ? { Authorization: `Bearer ${k}` } : {}),
      ...(withJson ? { "Content-Type": "application/json" } : {}),
      ...(referer ? { "HTTP-Referer": referer, "X-OpenRouter-Title": process.env.OPENROUTER_APP_TITLE?.trim() || "Trading Card Management" } : {}),
    };
  };

  async function load(): Promise<NonNullable<typeof list>> {
    if (list && now() - list.at < MODELS_TTL_MS) return list;
    try {
      const res = await fetchImpl(`${base}/models`, { headers: headers(false) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: RawModel[] };
      const infos: ModelInfo[] = [];
      const caps = new Map<string, ModelCaps>();
      for (const raw of Array.isArray(body.data) ? body.data : []) {
        const m = parseModel(raw);
        if (!m) continue;
        infos.push(m.info);
        caps.set(m.info.id, m.caps);
      }
      list = { at: now(), infos, caps };
      rememberModelPrices(ID, infos);
      return list;
    } catch (err) {
      // A stale list beats none; with none, the error is the answer.
      if (list) return list;
      throw aiError("provider", LABEL, { provider: ID, detail: `Could not read OpenRouter's model list: ${err instanceof Error ? err.message : String(err)}`, cause: err });
    }
  }

  return {
    id: ID,
    label: LABEL,
    capabilities(): Capabilities {
      // Per model, not per provider: the router asks the chosen model (see `prepare`).
      return { vision: true, json: true, streaming: false, cacheHints: true, batch: false };
    },
    async available(): Promise<Availability> {
      if (!key()) return { ok: false, reason: "OPENROUTER_API_KEY is not set." };
      if (health && health.result.ok && now() - health.at < AVAILABLE_TTL_MS) return health.result;
      let result: Availability;
      try {
        // The model list is public, so it proves nothing about the key; /key answers 401 for a bad one.
        const res = await fetchImpl(`${base}/key`, { headers: headers(false) });
        result = res.ok ? { ok: true } : res.status === 401 ? { ok: false, reason: "OPENROUTER_API_KEY was rejected by OpenRouter." } : { ok: false, reason: `OpenRouter answered ${res.status}.` };
      } catch (err) {
        result = { ok: false, reason: `OpenRouter could not be reached: ${err instanceof Error ? err.message : String(err)}` };
      }
      health = { at: now(), result };
      return result;
    },
    async listModels(): Promise<ModelInfo[]> {
      return (await load()).infos;
    },
    async prepare(): Promise<void> {
      await load();
    },
    async generate(req: AiRequest): Promise<AiResult> {
      if (!key()) throw aiError("unavailable", LABEL, { provider: ID, detail: "OPENROUTER_API_KEY is not set." });
      const model = req.model;
      if (!model) throw new AiError("unsupported", "An OpenRouter request needs a model — choose one in the settings.", { provider: ID });
      let caps: ModelCaps | undefined;
      try {
        caps = (await load()).caps.get(model);
      } catch {
        caps = undefined; // list unreachable: send nothing optional
      }
      const wantsImage = req.messages.some((m) => m.parts.some((p) => p.type === "image"));
      if (wantsImage && caps && !caps.vision) throw aiError("unsupported", LABEL, { provider: ID, detail: `${model} cannot read images.` });

      const started = now();
      let res: Response;
      try {
        res = await fetchImpl(`${base}/chat/completions`, { method: "POST", headers: headers(true), body: JSON.stringify(buildOpenRouterBody(req, model, caps)), signal: req.signal });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw aiError("timeout", LABEL, { provider: ID, detail: "The request was cancelled.", cause: err });
        throw aiError("provider", LABEL, { provider: ID, detail: `OpenRouter could not be reached: ${err instanceof Error ? err.message : String(err)}`, cause: err });
      }
      let body: Completion | null;
      try {
        body = (await res.json()) as Completion;
      } catch {
        body = null;
      }
      if (!res.ok) throw errorFrom(res.status, body);
      // OpenRouter can answer 200 with an error in the body.
      if (body?.error) throw errorFrom(res.status, body);
      const choice = body?.choices?.[0];
      if (!choice) throw aiError("provider", LABEL, { provider: ID, detail: "OpenRouter returned no choices." });
      if (choice.error) throw errorFrom(res.status, { error: choice.error });

      const content = choice.message?.content;
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? "").join("") : "";
      const refusalText = typeof choice.message?.refusal === "string" ? choice.message.refusal : "";
      const refused = refusalText.length > 0 || choice.finish_reason === "content_filter";
      const u = body?.usage ?? {};
      const cacheRead = Number(u.prompt_tokens_details?.cached_tokens ?? 0) || 0;
      const cacheWrite = Number(u.prompt_tokens_details?.cache_write_tokens ?? 0) || 0;
      // `prompt_tokens` is taken to include the cached tokens (the OpenAI convention; the docs do not say). The contract's `input` excludes them.
      const input = Math.max(0, (Number(u.prompt_tokens ?? 0) || 0) - cacheRead - cacheWrite);
      return {
        text: text || refusalText,
        stop: refused ? "refusal" : choice.finish_reason === "length" ? "max_tokens" : "end",
        usage: { input, output: Number(u.completion_tokens ?? 0) || 0, cacheRead, cacheWrite },
        provider: ID,
        model: typeof body?.model === "string" && body.model ? body.model : model,
        billed: true,
        latencyMs: now() - started,
      };
    },
  };
}
