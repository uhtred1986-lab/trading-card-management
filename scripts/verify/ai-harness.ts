/**
 * The Anthropic adapter on a recorded transport: every request's wire body is
 * kept, and each script entry is answered in Anthropic's wire format (or as an
 * HTTP error). Shared by `ai-features.ts` and `verify-ai-features-db.mts`.
 */
import { createAnthropicApiProvider } from "../../src/lib/ai/providers/anthropic-api";
import type { AiProvider } from "../../src/lib/ai/types";

export type Wire = { url: string; body: Record<string, unknown> };

interface Harness {
  make(script: { text?: string; json?: unknown; stop?: "refusal" | "end" | "max_tokens"; usage?: Record<string, number>; status?: number }[]): {
    provider: AiProvider;
    wire(): Wire[];
  };
}

/** The Anthropic adapter on a recorded transport. */
export function anthropicHarness(): Harness {
  return {
    make(script) {
      const wire: Wire[] = [];
      const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        wire.push({ url: String(url), body });
        const a = script[Math.min(wire.length - 1, script.length - 1)];
        if (a.status) {
          const type = a.status === 401 ? "authentication_error" : a.status === 429 ? "rate_limit_error" : "api_error";
          return new Response(JSON.stringify({ type: "error", error: { type, message: "stubbed" } }), { status: a.status, headers: { "content-type": "application/json" } });
        }
        const text = a.text ?? (a.json !== undefined ? JSON.stringify(a.json) : "");
        const u = a.usage ?? {};
        return new Response(
          JSON.stringify({
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: String(body.model),
            content: [{ type: "text", text }],
            stop_reason: a.stop === "refusal" ? "refusal" : a.stop === "max_tokens" ? "max_tokens" : "end_turn",
            stop_sequence: null,
            usage: { input_tokens: u.input ?? 0, output_tokens: u.output ?? 0, cache_read_input_tokens: u.cacheRead ?? 0, cache_creation_input_tokens: u.cacheWrite ?? 0 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch;
      const provider = { ...createAnthropicApiProvider({ fetch: fetchImpl }), id: "anthropic-api" };
      return { provider, wire: () => wire };
    },
  };
}

