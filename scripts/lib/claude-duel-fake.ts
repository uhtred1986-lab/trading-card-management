/**
 * #901: the dry run's stand-in for the Claude API — `src/lib/ai/providers/fake.ts` scripted to read
 * the duel prompt the way a model would (only the request text: the legal-move list) and answer
 * deterministically. No network, no key, billed false: a dry run spends $0, while the ledger still
 * reserves and settles the notional cost its usage would have had, so the caps are exercised.
 *
 * `faults` injects the failures the runner must turn into typed outcomes (malformed and illegal
 * answers, refusals, rate errors, timeouts) at chosen call numbers.
 */
import { AiError } from "../../src/lib/ai/errors";
import { createFakeProvider, type FakeAnswer, type FakeProvider } from "../../src/lib/ai/providers/fake";
import type { AiRequest } from "../../src/lib/ai/types";

export type Fault = "malformed" | "out-of-range" | "refusal" | "rate" | "timeout" | "max-tokens" | "wrong-model";

/** A small deterministic generator for the stand-in's choices (not the game's or a policy's RNG). */
function pickIndex(seed: number, call: number, n: number): number {
  let z = (seed * 0x9e3779b1 + call * 0x85ebca6b + 0x632be5ab) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x2c1b3c6d) >>> 0;
  z = Math.imul(z ^ (z >>> 12), 0x297a2d39) >>> 0;
  return ((z ^ (z >>> 15)) >>> 0) % n;
}

const textOf = (req: AiRequest) => req.messages[0]?.parts.map((p) => (p.type === "text" ? p.text : "")).join("") ?? "";

/** The answer a reader of the legal-move list would give: a seeded menu line, and for a card choice the cards it owes. */
export function readMenuAnswer(req: AiRequest, seed: number, call: number): { move: number; cards?: string[] } {
  const text = textOf(req);
  const menu = text.split("LEGAL MOVES:\n")[1]?.split("\n\n")[0] ?? "";
  const lines = menu.split("\n").filter((l) => /^\d+\. /.test(l));
  if (!lines.length) return { move: 0 };
  const move = pickIndex(seed, call, lines.length);
  const line = lines[move];
  if (!line.includes(" CHOOSE CARDS (")) return { move };
  const ids = (line.split(" from: ")[1]?.split(". Answer with")[0] ?? "").split("; ").map((c) => c.split(" ")[0]).filter(Boolean);
  const upTo = line.includes("pick up to ") || line.includes("pick any number");
  const n = Number(/pick (?:up to|exactly) (\d+)/.exec(line)?.[1] ?? "1");
  const want = Math.min(n, ids.length);
  return { move, cards: ids.slice(0, upTo ? Math.min(want, 1) : want) };
}

/** Rough usage for a request, so the ledger settles a realistic notional charge. */
function usageOf(req: AiRequest) {
  const system = req.system.reduce((n, b) => n + b.text.length, 0);
  const rest = req.messages.reduce((n, m) => n + m.parts.reduce((k, p) => k + (p.type === "text" ? p.text.length : 0), 0), 0);
  return { input: Math.ceil(rest / 4), cacheWrite: Math.ceil(system / 4), cacheRead: 0, output: 24 };
}

export function fakeClaude(opts: { seed: number; model: string; faults?: Record<number, Fault> }): FakeProvider {
  return createFakeProvider({
    id: "anthropic-api",
    label: "Fake Claude (dry run)",
    script: (req, call): FakeAnswer => {
      const fault = opts.faults?.[call];
      const usage = usageOf(req);
      const base = { usage, billed: false, model: opts.model };
      switch (fault) {
        case "malformed": return { ...base, text: "I would attack with my leader." };
        case "out-of-range": return { ...base, json: { move: 9999 } };
        case "refusal": return { ...base, text: "", stop: "refusal" };
        case "max-tokens": return { ...base, text: "{\"mo", stop: "max_tokens" };
        case "wrong-model": return { ...base, model: "claude-some-other-model", json: readMenuAnswer(req, opts.seed, call) };
        case "rate": return { error: new AiError("rate_limit", "Anthropic is rate limiting requests (fake)", { provider: "anthropic-api", status: 429 }) };
        case "timeout": return { error: new AiError("timeout", "Anthropic did not answer in time (fake)", { provider: "anthropic-api" }) };
        default: return { ...base, json: readMenuAnswer(req, opts.seed, call) };
      }
    },
  });
}
