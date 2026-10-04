/**
 * Models, their capabilities and list prices. The owner's model rulings (#381)
 * live here so a provider adapter can read them without importing `client.ts`
 * (which imports the provider registry). Models are listed as a single table per
 * provider; prices include cache read (10% of input) and cache write (125% of
 * input). Tier aliases stay as named constants, and the settings' model picker
 * joins this file in #516.
 *
 * Pricing (#515): Anthropic API list prices (checked 4 Sep 2026). Cache reads
 * are 0.1× the input price; cache writes are 1.25× the input price (the
 * multipliers used in `scripts/ai-spend.mts`). Dynamic model pricing from
 * providers' `listModels()` is cached via `rememberModelPrices()`.
 */
import type { ModelInfo, ProviderId, Tier } from "./types";

/** Opus: the heavy tier. */
export const MODEL = "claude-opus-5";

/**
 * The arena's cheap tier. The owner chose two tiers on 3 Sep 2026: Sparring
 * runs every decision here, Tournament sends the decisions that matter to
 * {@link MODEL}. Haiku 4.5 does not accept `output_config.effort` or adaptive
 * thinking, so the two tiers cannot share one request shape.
 */
export const FAST_MODEL = "claude-haiku-4-5";

/**
 * The middle tier, ruled by the owner on 1 Oct 2026 (#381): deck summary, the
 * arena's post-game review and the first pass of the card scan. Sonnet 5.5
 * takes adaptive thinking and `output_config.effort`, so those calls keep the
 * Opus request shape and only change the model.
 */
export const SONNET_MODEL = "claude-sonnet-5-5";

/** What a model can take in a request, beyond text in and text out. */
export interface ModelCaps {
  effort: boolean;
  adaptiveThinking: boolean;
  vision: boolean;
}

/** One model with its capabilities and list prices per token. */
export interface ModelEntry {
  id: string;
  provider: ProviderId;
  label: string;
  effort: boolean;
  adaptiveThinking: boolean;
  vision: boolean;
  /** US dollars per million tokens: input, output, cache read (0.1× input), cache write (1.25× input). */
  usdPerMTok: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/** Prices a provider reported from `listModels()` for models in no table, keyed `provider:model`. */
const rememberedModelPrices = new Map<string, ModelEntry>();

/** The models the app runs, by provider. Today only anthropic-api; other vendors join in #520. */
const MODELS: Record<string, ModelEntry[]> = {
  "anthropic-api": [
    {
      id: MODEL,
      provider: "anthropic-api",
      label: "Claude Opus 5",
      effort: true,
      adaptiveThinking: true,
      vision: true,
      usdPerMTok: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    },
    {
      id: SONNET_MODEL,
      provider: "anthropic-api",
      label: "Claude Sonnet 5.5",
      effort: true,
      adaptiveThinking: true,
      vision: true,
      usdPerMTok: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    },
    {
      id: FAST_MODEL,
      provider: "anthropic-api",
      label: "Claude Haiku 4.5",
      effort: false,
      adaptiveThinking: false,
      vision: true,
      usdPerMTok: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    },
  ],
};

/** Get all models for a provider (or anthropic-api if not specified). */
export function modelsOf(provider: ProviderId = "anthropic-api"): ModelEntry[] {
  return MODELS[provider] ?? [];
}

/** Get one model by id. Checks the table first, then remembered prices (for vendor-supplied models). */
export function modelEntry(id: string, provider: ProviderId = "anthropic-api"): ModelEntry | undefined {
  return modelsOf(provider).find((m) => m.id === id) ?? rememberedModelPrices.get(`${provider}:${id}`);
}

/** Anthropic list prices, US dollars per million tokens, read off {@link MODELS} (the shape callers had from `arena/ai/run.ts`). */
export const PRICES: Record<string, { input: number; output: number }> = Object.fromEntries(
  modelsOf("anthropic-api").map((m) => [m.id, { input: m.usdPerMTok.input, output: m.usdPerMTok.output }]),
);

/**
 * Millionths of a dollar for one call: input and output at list price, cached
 * reads at a tenth of the input price (cache writes are not counted, as before
 * #515). A model in no table is priced as Opus, as before.
 */
export function costMicros(spend: { model: string; input: number; output: number; cached: number; provider?: ProviderId }): number {
  const p = priceOf(spend.model, spend.provider);
  const dollars = (spend.input * p.input + spend.cached * p.input * 0.1 + spend.output * p.output) / 1_000_000;
  return Math.round(dollars * 1_000_000);
}

/** The Anthropic API's models, read off {@link MODELS}. A model that is not listed is sent no effort and no thinking. */
export const ANTHROPIC_MODELS: Record<string, ModelCaps & { label: string }> = Object.fromEntries(
  modelsOf("anthropic-api").map((m) => [m.id, { label: m.label, effort: m.effort, adaptiveThinking: m.adaptiveThinking, vision: m.vision }]),
);

/** The model for each tier, per provider. Today only the Anthropic API; #516 lets the settings override it. */
export const TIERS: Record<string, Record<Tier, string>> = {
  "anthropic-api": { fast: FAST_MODEL, standard: SONNET_MODEL, best: MODEL },
};

// The same Claude models on the plan (Agent SDK adapter, #517). Prices are the notional API list prices, for `ai:spend`; nothing is billed.
MODELS["anthropic-agent-sdk"] = MODELS["anthropic-api"].map((m) => ({ ...m, provider: "anthropic-agent-sdk", vision: false }));
TIERS["anthropic-agent-sdk"] = { ...TIERS["anthropic-api"] };

/** The Anthropic API's model for each tier. */
export const ANTHROPIC_TIERS: Record<Tier, string> = TIERS["anthropic-api"];

/** Remember model prices from a provider's `listModels()` so priceOf() can use them. Called by provider adapters. */
export function rememberModelPrices(provider: ProviderId, models: ModelInfo[]): void {
  for (const m of models) {
    if (m.usdPerMTok) {
      const key = `${provider}:${m.id}`;
      // Construct a ModelEntry from the ModelInfo. Cache pricing derived from input price.
      const entry: ModelEntry = {
        id: m.id,
        provider,
        label: m.label,
        effort: false, // Unknown; the provider's capabilities() would tell us for real models.
        adaptiveThinking: false,
        vision: m.capabilities?.vision ?? false,
        usdPerMTok: {
          input: m.usdPerMTok.in,
          output: m.usdPerMTok.out,
          cacheRead: m.usdPerMTok.in * 0.1,
          cacheWrite: m.usdPerMTok.in * 1.25,
        },
      };
      rememberedModelPrices.set(key, entry);
    }
  }
}

/** Get the price of a model, checking the table first, then remembered prices, then falling back to Opus. */
export function priceOf(model: string, provider: ProviderId = "anthropic-api"): { input: number; output: number } {
  const entry = modelEntry(model, provider) ?? modelEntry(model, "anthropic-api");
  if (entry) return { input: entry.usdPerMTok.input, output: entry.usdPerMTok.output };
  // Fall back to the default (Opus) as costMicros does.
  return PRICES["claude-opus-5"];
}
