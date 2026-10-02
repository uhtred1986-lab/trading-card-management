/**
 * One Anthropic client for the app. Every call goes through `recordRun` so
 * the result and token usage land in `ai_runs` — results are re-shown from
 * there instead of being re-generated (and re-paid for).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { aiRuns } from "@/db/schema";

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
 * Opus request shape and only change the model. Its list price is in `PRICES`
 * (`src/lib/arena/ai/run.ts`).
 */
export const SONNET_MODEL = "claude-sonnet-5-5";

let cached: Anthropic | null = null;

/**
 * `ANTHROPIC_API_KEY` as everywhere else, or `APP_ANTHROPIC_API_KEY` where
 * the first name is taken: Claude Code on the web reserves it for the session's
 * own authentication and refuses to store it as an environment variable, so a
 * sandbox that runs the arena scripts needs a second name for the same key.
 */
export function anthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || process.env.APP_ANTHROPIC_API_KEY || undefined;
}

export function hasAnthropic(): boolean {
  return !!anthropicKey();
}

export function anthropic(): Anthropic {
  const apiKey = anthropicKey();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set — AI features are disabled.");
  return (cached ??= new Anthropic({ apiKey }));
}

export type RunKind = "deck_summary" | "deck_wizard" | "set_review" | "scan_identify" | "cart_explain" | "deck_builder" | "deck_from_card" | "arena_move" | "arena_referee" | "arena_clarify" | "arena_review" | "arena_teach";

/** The slice of the SDK's `usage` that `ai_runs` keeps; the cache fields are absent or null when a call did not use the cache. */
export type RunUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export async function recordRun<T>(
  db: Db,
  kind: RunKind,
  input: unknown,
  response: { parsed_output?: T | null; usage: RunUsage; stop_reason: string | null },
  deckId?: number,
  model: string = MODEL,
): Promise<{ id: number; output: T }> {
  if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
  const output = response.parsed_output;
  if (output == null) throw new Error("The model's answer did not match the expected format — try again.");
  const [row] = await db
    .insert(aiRuns)
    .values({
      kind,
      deckId: deckId ?? null,
      model,
      input: input as object,
      output: output as object,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? null,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? null,
    })
    .returning({ id: aiRuns.id });
  return { id: row.id, output };
}

/** Friendly message for the UI; keeps SDK error classes out of components. */
export function describeAiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Anthropic API key was rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by Anthropic — try again in a moment.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
