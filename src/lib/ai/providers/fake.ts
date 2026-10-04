/**
 * A scripted provider for `npm test`: it answers from a script, records every
 * request it was given, and never touches a network. Register it with
 * `registerProvider` (under the id of the provider a test wants to replace).
 */
import { AiError } from "../errors";
import type { AiProvider, AiRequest, AiResult, Capabilities, ModelInfo, Usage } from "../types";

export interface FakeAnswer {
  /** What the model said. A JSON request gets this as its raw answer. */
  text?: string;
  /** Shorthand: `JSON.stringify` of this is the text. */
  json?: unknown;
  stop?: AiResult["stop"];
  usage?: Partial<Usage>;
  model?: string;
  billed?: boolean;
  /** Throw this instead of answering. */
  error?: AiError;
}

export interface FakeOptions {
  id?: string;
  label?: string;
  capabilities?: Partial<Capabilities>;
  /** Taken in order; the last one repeats. Or a function of the request. */
  script: FakeAnswer[] | ((req: AiRequest, call: number) => FakeAnswer);
  models?: ModelInfo[];
}

export interface FakeProvider extends AiProvider {
  readonly requests: AiRequest[];
}

export function createFakeProvider(opts: FakeOptions): FakeProvider {
  const requests: AiRequest[] = [];
  const caps: Capabilities = { vision: true, json: true, streaming: false, cacheHints: false, batch: false, ...opts.capabilities };
  return {
    id: opts.id ?? "fake",
    label: opts.label ?? "Fake provider",
    requests,
    capabilities: () => caps,
    available: async () => ({ ok: true }),
    listModels: async () => opts.models ?? [],
    async generate(req) {
      const call = requests.length;
      requests.push(req);
      const answer = typeof opts.script === "function" ? opts.script(req, call) : opts.script[Math.min(call, opts.script.length - 1)];
      if (!answer) throw new Error("the fake provider has no scripted answer");
      if (answer.error) throw answer.error;
      return {
        text: answer.text ?? (answer.json !== undefined ? JSON.stringify(answer.json) : ""),
        stop: answer.stop ?? "end",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...answer.usage },
        provider: opts.id ?? "fake",
        model: answer.model ?? req.model ?? "fake-model",
        billed: answer.billed ?? true,
        latencyMs: 0,
      };
    },
  };
}
