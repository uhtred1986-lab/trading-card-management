/**
 * The app's AI bookkeeping. Calls go through `generate`/`generateJson`
 * (`./core`), and every result lands in `ai_runs` via `recordRun` — results are
 * re-shown from there instead of being re-generated (and re-paid for).
 *
 * `anthropic()` is the shared SDK client for the feature modules that have not
 * moved onto the contract yet (#513, #514); it goes when they have.
 */
import type { Db } from "@/db";
import { aiRuns } from "@/db/schema";
import { MODEL } from "./models";
import { anthropicKey, legacyAnthropicClient } from "./providers/anthropic-api";
import type { AiResult } from "./types";

export { FAST_MODEL, MODEL, SONNET_MODEL } from "./models";
export { describeAiError } from "./errors";
export { anthropicKey };

export function hasAnthropic(): boolean {
  return !!anthropicKey();
}

export const anthropic = legacyAnthropicClient;

export type RunKind = "deck_summary" | "deck_wizard" | "set_review" | "scan_identify" | "cart_explain" | "deck_builder" | "deck_from_card" | "arena_move" | "arena_referee" | "arena_clarify" | "arena_review" | "arena_teach";

/** The slice of the SDK's `usage` that `ai_runs` keeps; the cache fields are absent or null when a call did not use the cache. */
export type RunUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/** What a feature module that still calls the SDK itself hands over. */
type LegacyResponse<T> = { parsed_output?: T | null; usage: RunUsage; stop_reason: string | null };

export async function recordRun<T>(
  db: Db,
  kind: RunKind,
  input: unknown,
  response: AiResult<T> | LegacyResponse<T>,
  deckId?: number,
  model?: string,
): Promise<{ id: number; output: T }> {
  const legacy = "stop_reason" in response;
  const refused = legacy ? response.stop_reason === "refusal" : response.stop === "refusal";
  if (refused) throw new Error("The model declined this request.");
  const output = legacy ? response.parsed_output : response.parsed;
  if (output == null) throw new Error("The model's answer did not match the expected format — try again.");
  const tokens = legacy
    ? {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? null,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? null,
      }
    : { inputTokens: response.usage.input, outputTokens: response.usage.output, cacheReadTokens: response.usage.cacheRead, cacheCreationTokens: response.usage.cacheWrite };
  const [row] = await db
    .insert(aiRuns)
    .values({
      kind,
      deckId: deckId ?? null,
      model: model ?? (legacy ? MODEL : response.model),
      provider: legacy ? "anthropic-api" : response.provider,
      billed: legacy ? true : response.billed,
      costMicros: legacy ? null : (response.costMicros ?? null),
      input: input as object,
      output: output as object,
      ...tokens,
    })
    .returning({ id: aiRuns.id });
  return { id: row.id, output };
}
