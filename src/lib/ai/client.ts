/**
 * One Anthropic client for the app. Every call goes through `recordRun` so
 * the result and token usage land in `ai_runs` — results are re-shown from
 * there instead of being re-generated (and re-paid for).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { aiRuns } from "@/db/schema";

export const MODEL = "claude-opus-5";

let cached: Anthropic | null = null;

export function hasAnthropic(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function anthropic(): Anthropic {
  if (!hasAnthropic()) throw new Error("ANTHROPIC_API_KEY is not set — AI features are disabled.");
  return (cached ??= new Anthropic());
}

export type RunKind = "deck_summary" | "deck_wizard" | "set_review" | "scan_identify" | "cart_explain";

export async function recordRun<T>(
  db: Db,
  kind: RunKind,
  input: unknown,
  response: { parsed_output?: T | null; usage: { input_tokens: number; output_tokens: number }; stop_reason: string | null },
  deckId?: number,
): Promise<{ id: number; output: T }> {
  if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
  const output = response.parsed_output;
  if (output == null) throw new Error("The model's answer did not match the expected format — try again.");
  const [row] = await db
    .insert(aiRuns)
    .values({
      kind,
      deckId: deckId ?? null,
      model: MODEL,
      input: input as object,
      output: output as object,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
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
