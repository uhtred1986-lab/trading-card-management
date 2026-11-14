/**
 * Lookups while the model works (the Pokémon card source), on top of the provider contract.
 *
 * The contract (`types.ts`) is single-turn and structured: no provider has a native tool call. So the
 * tool loop lives in the JSON answer: every reply is `{ lookups, answer }`; while the model needs a
 * card it asks for `lookups` and leaves `answer` null, we run them and send the results back as the
 * next user turn, and when it is done it answers (`answer` set, `lookups` empty). Every round is one
 * `generateJson`, so routing, fallback, validation and the one retry apply to it like to any call, and
 * it works on every provider (API, plan, OpenRouter, the fake one of the checks).
 *
 * The result is the last round's `AiResult` with the usage and latency of all rounds summed and
 * `parsed` set to the unwrapped answer, so one `recordRun` bills the whole run. With no tools nothing
 * here runs: callers call `generateJson` with the request untouched (the Dragon Ball games).
 */
import { z, type ZodType } from "zod";
import { AiError } from "./errors";
import { generateJson, type JsonRequest } from "./core";
import type { LookupArgs, LookupTool } from "./games/types";
import type { AiMessage, AiResult, Usage } from "./types";

export interface LookupLog {
  tool: string;
  args: LookupArgs;
  /** What the tool answered, cut for the log. */
  result: string;
}

export interface LookupOptions {
  /** Rounds in which the model may still look things up; the round after is forced to answer. */
  maxRounds?: number;
  /** Lookups run per round. */
  perRound?: number;
  /** Most characters of one lookup's answer sent back. */
  resultCap?: number;
}

const DEFAULTS: Required<LookupOptions> = { maxRounds: 5, perRound: 6, resultCap: 3500 };

const add = (a: Usage, b: Usage): Usage => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite });

/** What the model is told about the tools: how to ask, how to finish. */
export function lookupInstructions(tools: LookupTool[], opts: Required<LookupOptions>): string {
  return [
    "You can look cards up while you work. Every reply of yours is a JSON object with two fields: `lookups` and `answer`.",
    `To look cards up: put up to ${opts.perRound} entries in \`lookups\` and set \`answer\` to null. You get the results back and reply again (at most ${opts.maxRounds} lookup rounds).`,
    "To finish: set `lookups` to an empty list and put your complete answer in `answer`.",
    "A lookup is { tool, name, type, category, id }; set the fields the tool reads and the others to null. Tools:",
    ...tools.map((t) => `- ${t.name}: ${t.description}`),
    "Only use card ids that the player's list or a lookup gave you. Never invent an id.",
  ].join("\n");
}

function envelope<S extends ZodType>(schema: S, tools: LookupTool[]) {
  const names = tools.map((t) => t.name) as [string, ...string[]];
  return z.object({
    lookups: z
      .array(
        z.object({
          tool: z.enum(names),
          name: z.string().nullable(),
          type: z.string().nullable(),
          category: z.string().nullable(),
          id: z.string().nullable(),
        }),
      )
      // Not capped at `perRound` here: a model that asks for one lookup too many would have its whole reply
      // rejected. The loop runs the first `perRound` and says the rest were not run.
      .max(40),
    answer: schema.nullable(),
  });
}

export type LookupResult<T> = AiResult<T> & { lookupLog: LookupLog[]; rounds: number };

export async function generateWithLookups<S extends ZodType>(req: JsonRequest<S>, tools: LookupTool[], options: LookupOptions = {}): Promise<LookupResult<z.infer<S>>> {
  const opts = { ...DEFAULTS, ...options };
  const { schema, system, messages, ...rest } = req;
  const env = envelope(schema, tools);
  const sys = [system[0], { text: lookupInstructions(tools, opts) }, ...system.slice(1)];
  const log: LookupLog[] = [];
  const convo: AiMessage[] = [...messages];
  let usage: Usage | null = null;
  let latencyMs = 0;

  for (let round = 0; round <= opts.maxRounds; round++) {
    const last = round === opts.maxRounds;
    const res = await generateJson({ ...rest, system: sys, messages: [...convo], schema: env });
    usage = usage ? add(usage, res.usage) : res.usage;
    latencyMs += res.latencyMs;
    const out = res.parsed as { lookups: { tool: string; name: string | null; type: string | null; category: string | null; id: string | null }[]; answer: z.infer<S> | null };
    if (out.answer !== null) return { ...res, parsed: out.answer, usage, latencyMs, lookupLog: log, rounds: round };
    if (last || out.lookups.length === 0) {
      // Out of rounds, or it asked for nothing and answered nothing: one forced answer, or give up.
      if (last) throw new AiError("bad_output", "The model kept looking cards up without answering — try again.", { provider: res.provider });
      convo.push({ role: "assistant", parts: [{ type: "text", text: res.text }] }, { role: "user", parts: [{ type: "text", text: "You asked for no lookups and gave no answer. Give your complete answer now in `answer`." }] });
      continue;
    }
    const results: string[] = [];
    const skipped = Math.max(0, out.lookups.length - opts.perRound);
    for (const [i, l] of out.lookups.slice(0, opts.perRound).entries()) {
      const tool = tools.find((t) => t.name === l.tool);
      const args: LookupArgs = { name: l.name, type: l.type, category: l.category, id: l.id };
      const text = tool ? await tool.run(args) : `Unknown tool ${l.tool}.`;
      log.push({ tool: l.tool, args, result: text.slice(0, 400) });
      results.push(`[${i + 1}] ${l.tool}(${JSON.stringify(args)}):\n${text.length > opts.resultCap ? `${text.slice(0, opts.resultCap)}\n…(cut)` : text}`);
    }
    const next = round + 1 === opts.maxRounds ? "That was your last lookup round: give your complete answer now in `answer`." : "Look up more, or give your complete answer in `answer`.";
    convo.push({ role: "assistant", parts: [{ type: "text", text: res.text }] }, { role: "user", parts: [{ type: "text", text: `LOOKUP RESULTS:\n${results.join("\n\n")}\n\n${skipped ? `Only the first ${opts.perRound} lookups of a reply are run; your other ${skipped} were not. ` : ""}${next}` }] });
  }
  throw new AiError("bad_output", "The model did not answer — try again.");
}
