/**
 * `npm run ai:smoke -- --provider <id> [--task <kind>] [--yes]` — a paid smoke test: one tiny
 * live call per capability the provider claims. It verifies text, JSON (via a schema), and image
 * input (if `capabilities().vision`). It prints model, latency, usage and billed for each call.
 *
 * Makes PAID calls on `anthropic-api` and `openrouter`, and uses plan usage on
 * `anthropic-agent-sdk`, so a real provider needs `--yes`. `--provider fake` answers from a
 * script, costs nothing and needs no flag: it is how `npm test`-style proof that the script
 * itself works is obtained. The owner runs the real thing; an agent session never does.
 *
 *   --provider <id>    anthropic-api | anthropic-agent-sdk | openrouter | fake   (required)
 *   --task <kind>      specific test (text, json, image, all); default all
 *   --model <id>       the model to call; required where the provider has no tier table (openrouter),
 *                      otherwise the provider's `fast` tier model
 *   --yes              confirm that this spends money or plan usage
 *
 * Every call is standalone; they do not depend on each other. Image is skipped if the
 * provider's `capabilities().vision` is false.
 */
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

const { z } = await import("zod");
const { createFakeProvider } = await import("../src/lib/ai/providers/fake.ts");
const { registerProvider, getProvider } = await import("../src/lib/ai/providers/index.ts");
const { NO_SETTINGS, setSettingsLoader } = await import("../src/lib/ai/settings.ts");
const { generateJson, generate } = await import("../src/lib/ai/core.ts");
import type { AiRequest } from "../src/lib/ai/types.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

const providerId = flag("provider");
const task = flag("task") ?? "all";
const model = flag("model");
const delay = Math.max(0, Number(flag("delay") ?? 0) || 0);

if (!providerId) {
  console.error("usage: npm run ai:smoke -- --provider <anthropic-api|anthropic-agent-sdk|openrouter|fake> [--model <id>] [--task all|text|json|image] [--yes]");
  process.exit(2);
}
if (providerId === "openrouter" && !model) {
  console.error('OpenRouter has no tier table: pass the model to call: --model <id>, any id from its /models list (the /settings picker shows them).');
  process.exit(2);
}
if (providerId !== "fake" && !has("yes")) {
  console.error(`ai:smoke makes real model calls on "${providerId}" (paid on the API providers, plan usage on the subscription).\nRe-run with --yes to confirm. Use --provider fake to try the script for free.`);
  process.exit(2);
}

const tiny = (id: string, o: Partial<AiRequest> = {}): AiRequest => ({
  task: "deck_summary" as const,
  tier: "fast",
  system: [{ text: "You are concise." }],
  messages: [{ role: "user", parts: [{ type: "text", text: id }] }],
  maxTokens: 100,
  provider: providerId as unknown as string,
  ...(model ? { model } : {}),
  ...o,
});

// A tiny 1x1 pixel transparent PNG (36 bytes).
const tinyPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 8, 153, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]).toString("base64");

if (providerId === "fake") {
  registerProvider(
    createFakeProvider({
      id: "fake",
      script: () => ({ json: { move: 0 }, usage: { input: 10, output: 5 } }),
      models: [{ id: "fake-model", label: "Fake", capabilities: { vision: true, json: true, tools: false } }],
    }),
  );
  const real = getProvider("fake")!;
  const generate_orig = real.generate.bind(real);
  real.generate = async (req) => {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return generate_orig(req);
  };
} else {
  const p = getProvider(providerId);
  if (!p) {
    console.error(`Unknown provider "${providerId}".`);
    process.exit(2);
  }
  const av = await p.available();
  if (!av.ok) {
    console.error(`"${providerId}" is not available: ${av.reason}`);
    process.exit(1);
  }
  // Prepare the provider (e.g., fetch OpenRouter's model list) so capabilities are known.
  if (p.prepare) {
    try {
      await p.prepare();
    } catch (err) {
      console.error(`Failed to prepare provider: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }
}

setSettingsLoader(async () => NO_SETTINGS);

const provider = getProvider(providerId)!;
const caps = provider.capabilities();
const tests: Array<{ name: string; run: () => Promise<unknown> }> = [];

// Text test
if (task === "all" || task === "text") {
  tests.push({
    name: "text",
    run: async () => {
      const req = tiny("Say 'hello'.");
      const result = await generate(req);
      console.log(`  text       model=${result.model}  latency=${result.latencyMs}ms  usage in=${result.usage.input} out=${result.usage.output}  billed=${result.billed}`);
    },
  });
}

// JSON test
if (task === "all" || task === "json") {
  tests.push({
    name: "json",
    run: async () => {
      const schema = z.object({ move: z.number() });
      const result = await generateJson({
        ...tiny("Return {\"move\": 0}."),
        schema,
      });
      console.log(`  json       model=${result.model}  latency=${result.latencyMs}ms  usage in=${result.usage.input} out=${result.usage.output}  billed=${result.billed}`);
    },
  });
}

// Image test
if ((task === "all" || task === "image") && caps.vision) {
  tests.push({
    name: "image",
    run: async () => {
      const req = tiny("What is in this image? (if unclear, say 'tiny pixel')", {
        messages: [
          {
            role: "user",
            parts: [
              { type: "text", text: "Describe the image." },
              { type: "image", mediaType: "image/png", base64: tinyPng },
            ],
          },
        ],
      });
      const result = await generate(req);
      console.log(`  image      model=${result.model}  latency=${result.latencyMs}ms  usage in=${result.usage.input} out=${result.usage.output}  billed=${result.billed}`);
    },
  });
}

if (tests.length === 0) {
  console.log(`No tests selected (--task ${task} on provider ${providerId} with vision=${caps.vision})`);
  process.exit(0);
}

console.log(`ai:smoke    provider=${providerId}  tests=${tests.map((t) => t.name).join(",")}${providerId === "fake" ? "  (fake: no real calls)" : ""}`);

const errors: string[] = [];
for (const test of tests) {
  try {
    await test.run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`${test.name}: ${msg}`);
    console.log(`  ${test.name}       ERROR ${msg.slice(0, 200)}`);
  }
}

console.log("");
console.log(`tests ${tests.length}  errors ${errors.length}${errors.length ? ":\n  " + errors.map((e, i) => `${i + 1}. ${e.slice(0, 200)}`).join("\n  ") : ""}`);
process.exit(errors.length ? 1 : 0);
