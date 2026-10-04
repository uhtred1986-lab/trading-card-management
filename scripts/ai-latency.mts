/**
 * `npm run ai:latency -- --provider <id> --decisions 10 --yes` — how long one arena decision takes
 * on a provider (#518). It plays a Sparring game on the rules engine, every prompt that is not a
 * free shortcut going through `chooseMove` exactly as a live arena turn does, until N decisions have
 * reached the model, and reports per-call latency (min / median / max, first call apart because it is
 * the cold one) and every error.
 *
 * It makes PAID calls on `anthropic-api` and `openrouter`, and uses plan usage on
 * `anthropic-agent-sdk`, so a real provider needs `--yes`. `--provider fake` answers from a script,
 * costs nothing and needs no flag: it is how `npm test`-style proof that the script itself works is
 * obtained. The owner runs the real thing; an agent session never does.
 *
 *   --provider <id>    anthropic-api | anthropic-agent-sdk | openrouter | fake   (required)
 *   --decisions <n>    model decisions to time (default 10)
 *   --model <id>       the model; defaults to the provider's "fast" tier (required for openrouter)
 *   --yes              confirm that this spends money or plan usage
 *   --delay <ms>       fake only: simulated latency per call (default 5)
 *
 * The position is synthetic (small invented cards, a fixed seed), not a deck from the database: the
 * script never touches Neon. Prompts are the real ones, so the request size is a little under a real
 * game's; read the result as the floor.
 */
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

const { defsFrom } = await import("../src/lib/arena/vm/common.ts");
const { seedFrom } = await import("../src/lib/arena/vm/rng.ts");
const { engineFor } = await import("../src/lib/arena/engines.ts");
const { chooseMove } = await import("../src/lib/arena/ai/opponent.ts");
const { createFakeProvider } = await import("../src/lib/ai/providers/fake.ts");
const { registerProvider, getProvider } = await import("../src/lib/ai/providers/index.ts");
const { NO_SETTINGS, setSettingsLoader } = await import("../src/lib/ai/settings.ts");
const { TIERS } = await import("../src/lib/ai/models.ts");
import type { CardDef, EngineContext, PlayerId } from "../src/lib/arena/types.ts";

/** min / median / max / mean of a list of milliseconds. */
function spread(xs: number[]) {
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return { min: a[0], max: a[a.length - 1], median: a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2, mean: a.reduce((t, x) => t + x, 0) / a.length };
}
function latencyStats(xs: number[]) {
  return { count: xs.length, first: xs[0], ...spread(xs), warm: xs.length > 1 ? spread(xs.slice(1)) : undefined };
}

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

const providerId = flag("provider");
const decisions = Math.max(1, Math.floor(Number(flag("decisions") ?? 10)) || 10);
const delay = Math.max(0, Number(flag("delay") ?? 5) || 0);

if (!providerId) {
  console.error("usage: npm run ai:latency -- --provider <anthropic-api|anthropic-agent-sdk|openrouter|fake> [--decisions 10] [--model <id>] --yes");
  process.exit(2);
}
if (providerId !== "fake" && !has("yes")) {
  console.error(`ai:latency makes ${decisions} real model calls on "${providerId}" (paid on the API providers, plan usage on the subscription).\nRe-run with --yes to confirm. Use --provider fake to try the script for free.`);
  process.exit(2);
}

const card = (id: string, o: Partial<CardDef> = {}): CardDef => ({
  id, name: id, type: "BATTLE", colors: ["Red"], energyCost: 1, zEnergyCost: null, power: 10000, comboCost: 1, comboPower: 5000, skill: null, characters: [], traits: [], ...o,
});
const leader = { type: "LEADER" as const, energyCost: null, comboCost: null, comboPower: null };
const CTX: EngineContext = {
  defs: defsFrom([
    card("L-RED", leader),
    card("L-BLUE", { ...leader, colors: ["Blue"] }),
    card("V1"),
    card("V-BLUE", { colors: ["Blue"] }),
    card("BLOCKER", { colors: ["Blue"], energyCost: 2, skill: "[Blocker]", comboPower: 10000 }),
  ]),
  scripts: {},
};
const deck = (id: string) => Array.from({ length: 50 }, () => id);

// Which provider the Sparring slot uses, and with which model.
const model = flag("model") ?? TIERS[providerId]?.fast ?? (providerId === "fake" ? "fake-model" : undefined);
if (!model) {
  console.error(`No default model for "${providerId}" — pass --model <id>.`);
  process.exit(2);
}
if (providerId === "fake") {
  registerProvider(
    createFakeProvider({
      id: "fake",
      script: () => ({ json: { move: 0, say: "Fake." }, usage: { input: 1200, output: 20 } }),
      models: [{ id: model, label: "Fake", capabilities: { vision: false, json: true, tools: false } }],
    }),
  );
  const real = getProvider("fake")!;
  const generate = real.generate.bind(real);
  real.generate = async (req) => {
    await new Promise((r) => setTimeout(r, delay));
    return generate(req);
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
}
setSettingsLoader(async () => ({ ...NO_SETTINGS, arena: { sparring: { provider: providerId, model } } }));

// `recordRun` writes an `ai_runs` row; this script has no database, so the row goes nowhere.
const nullDb = { insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }) } as unknown as Parameters<typeof chooseMove>[0];

const rules = engineFor("rules");
let s = rules.createGame(CTX, { seed: seedFrom("ai-latency"), p1: { name: "You", leader: "L-RED", main: deck("V1") }, p2: { name: "Claude", leader: "L-BLUE", main: deck("V-BLUE") } }).state;

const samples: number[] = [];
const errors: string[] = [];
let consecutiveErrors = 0;
console.log(`ai:latency  provider=${providerId}  model=${model}  decisions=${decisions}${providerId === "fake" ? "  (fake: no real calls)" : ""}`);

for (let step = 0; step < 400 && samples.length + errors.length < decisions; step++) {
  const legal = rules.legalActions(CTX, s);
  if (!legal.length) break;
  const p = (s.prompt as { player: PlayerId }).player;
  const t0 = performance.now();
  let index = 0;
  try {
    const choice = await chooseMove(nullDb, CTX, s, legal, p, "sparring");
    const ms = performance.now() - t0;
    index = choice.index;
    if (choice.spend) {
      samples.push(ms);
      consecutiveErrors = 0;
      console.log(`  #${String(samples.length + errors.length).padStart(2)}  ${Math.round(ms).toString().padStart(6)} ms  prompt=${s.prompt.kind}  moves=${legal.length}  in=${choice.spend.input} out=${choice.spend.output}`);
    }
  } catch (err) {
    const ms = performance.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    consecutiveErrors++;
    console.log(`  #${String(samples.length + errors.length).padStart(2)}  ${Math.round(ms).toString().padStart(6)} ms  ERROR ${msg.slice(0, 160)}`);
    if (consecutiveErrors >= 3) {
      console.log("  three errors in a row — stopping.");
      break;
    }
  }
  s = rules.apply(CTX, s, legal[Math.min(index, legal.length - 1)].action).state;
}

console.log("");
if (samples.length < decisions && errors.length === 0) console.log(`Only ${samples.length} of ${decisions} decisions reached the model before the game ended.`);
if (samples.length) {
  const st = latencyStats(samples);
  console.log(`calls ${st.count}   first (cold) ${Math.round(st.first)} ms   min ${Math.round(st.min)}   median ${Math.round(st.median)}   max ${Math.round(st.max)}   mean ${Math.round(st.mean)}`);
  if (samples.length > 1) console.log(`warm (calls 2..${samples.length})   min ${Math.round(st.warm!.min)}   median ${Math.round(st.warm!.median)}   max ${Math.round(st.warm!.max)}`);
}
console.log(`errors ${errors.length}${errors.length ? ":\n  " + errors.map((e, i) => `${i + 1}. ${e.slice(0, 200)}`).join("\n  ") : ""}`);
process.exit(errors.length && !samples.length ? 1 : 0);
