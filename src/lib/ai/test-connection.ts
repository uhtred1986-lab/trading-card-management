/**
 * "Test connection" on /settings (#516): one tiny prompt to one provider, to
 * show which provider and model answered and how long it took. A real,
 * billed call on a paid provider, so only the owner's click ever reaches it —
 * no check calls it with a real provider, and it writes no `ai_runs` row (it
 * is not a feature result and there is nothing to re-show).
 */
import { describeAiError } from "./errors";
import { forgetAvailability } from "./router";
import { TIERS } from "./models";
import type { AiSettings } from "./settings";
import type { AiProvider } from "./types";

export type ConnectionTest = { ok: true; provider: string; model: string; latencyMs: number; reply: string } | { ok: false; provider: string; error: string };

export async function testConnection(provider: AiProvider, settings: AiSettings): Promise<ConnectionTest> {
  const model = settings.tiers[provider.id]?.fast ?? TIERS[provider.id]?.fast;
  try {
    const res = await provider.generate({
      task: "cart_explain",
      ...(model ? { model } : { tier: "fast" as const }),
      system: [{ text: "You answer connection tests." }],
      messages: [{ role: "user", parts: [{ type: "text", text: "Reply with the single word: ok" }] }],
      maxTokens: 16,
    });
    forgetAvailability(provider.id);
    return { ok: true, provider: res.provider, model: res.model, latencyMs: res.latencyMs, reply: res.text.trim().slice(0, 40) };
  } catch (err) {
    forgetAvailability(provider.id);
    return { ok: false, provider: provider.id, error: describeAiError(err) };
  }
}
