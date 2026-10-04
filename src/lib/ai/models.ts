/**
 * The models the app runs, by name and by tier. The ids and the owner's rulings
 * behind them (3 Sep and 1 Oct 2026, #381) live here so a provider adapter can
 * read them without importing `client.ts` (which imports the provider
 * registry). Prices, the per-provider tables and the settings' model picker
 * join this file in #515 and #516.
 */
import type { Tier } from "./types";

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

/** The Anthropic API's models. A model that is not listed is sent no effort and no thinking. */
export const ANTHROPIC_MODELS: Record<string, ModelCaps & { label: string }> = {
  [MODEL]: { label: "Claude Opus 5", effort: true, adaptiveThinking: true, vision: true },
  [SONNET_MODEL]: { label: "Claude Sonnet 5.5", effort: true, adaptiveThinking: true, vision: true },
  [FAST_MODEL]: { label: "Claude Haiku 4.5", effort: false, adaptiveThinking: false, vision: true },
};

/** The Anthropic API's model for each tier. */
export const ANTHROPIC_TIERS: Record<Tier, string> = { fast: FAST_MODEL, standard: SONNET_MODEL, best: MODEL };
