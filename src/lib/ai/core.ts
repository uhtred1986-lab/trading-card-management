/**
 * What feature code calls. `generate` runs one request on whichever provider
 * the router picks; `generateJson` adds the Zod schema, validates the answer
 * itself (so a vendor without native structured output works the same) and
 * asks once more, with the validation error, before giving up as `bad_output`.
 */
import { z, type ZodType } from "zod";
import { AiError } from "./errors";
import { resolve } from "./router";
import type { AiMessage, AiRequest, AiResult, Usage } from "./types";

const addUsage = (a: Usage, b: Usage): Usage => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite });

/** One request on the routed provider. A vendor's own error never gets out: it is an `AiError`. */
export async function generate(req: AiRequest): Promise<AiResult> {
  const { provider, request } = await resolve(req);
  try {
    return await provider.generate(request);
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw new AiError("provider", err instanceof Error ? err.message : String(err), { provider: provider.id, cause: err });
  }
}

/** The JSON in a model's text: bare, or inside a ``` fence, or with prose around it. */
export function extractJson(text: string): unknown {
  const t = text.trim();
  const candidates = [t];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) candidates.push(fence[1].trim());
  const start = t.search(/[{[]/);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (start >= 0 && end > start) candidates.push(t.slice(start, end + 1));
  let firstError: unknown;
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch (err) {
      firstError ??= err;
    }
  }
  throw firstError instanceof Error ? firstError : new Error("not JSON");
}

function check<S extends ZodType>(schema: S, text: string): { ok: true; value: z.infer<S> } | { ok: false; why: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (err) {
    return { ok: false, why: `the answer is not valid JSON (${err instanceof Error ? err.message : String(err)})` };
  }
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  const issues = r.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return { ok: false, why: `it does not match the schema:\n${issues.join("\n")}` };
}

export type JsonRequest<S extends ZodType> = Omit<AiRequest, "output"> & { schema: S };

export async function generateJson<S extends ZodType>(req: JsonRequest<S>): Promise<AiResult<z.infer<S>>> {
  const { schema, ...rest } = req;
  const first = await generate({ ...rest, output: { kind: "json", schema } });
  if (first.stop === "refusal") throw new AiError("refusal", "The model declined this request.", { provider: first.provider });
  const a = check(schema, first.text);
  if (a.ok) return { ...first, parsed: a.value };
  // Cut off mid-answer: asking again would hit the same limit.
  if (first.stop === "max_tokens") throw new AiError("bad_output", "The model's answer was cut off — try again.", { provider: first.provider });

  const retryMessages: AiMessage[] = [
    ...rest.messages,
    { role: "assistant", parts: [{ type: "text", text: first.text }] },
    { role: "user", parts: [{ type: "text", text: `Your answer was rejected: ${a.why}\nAnswer again with only the corrected JSON.` }] },
  ];
  const second = await generate({ ...rest, messages: retryMessages, output: { kind: "json", schema } });
  const usage = addUsage(first.usage, second.usage);
  const latencyMs = first.latencyMs + second.latencyMs;
  if (second.stop === "refusal") throw new AiError("refusal", "The model declined this request.", { provider: second.provider });
  const b = check(schema, second.text);
  if (!b.ok) throw new AiError("bad_output", "The model's answer did not match the expected format — try again.", { provider: second.provider });
  return { ...second, parsed: b.value, usage, latencyMs };
}
