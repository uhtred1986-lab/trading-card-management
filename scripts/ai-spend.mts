/**
 * `npm run ai:spend [-- <days>]` — what `ai_runs` says the Claude calls cost
 * over the last N days (default 30), per kind, model, provider, and billed status,
 * showing billed and notional cost apart and cache hit rates. Read-only; needs
 * DATABASE_URL (the owner runs it).
 *
 * Prices are in `src/lib/ai/models.ts`. Anthropic bills cache reads at 0.1×
 * input price and cache writes at 1.25×; the API's `input_tokens` excludes both.
 * Rows from before #380 carry no cache figures (shown as "-" and counted as zero),
 * so their cost is a floor. Rows from before #515 read as "anthropic-api" and
 * billed=true; output groups runs by billed status and provider totals.
 */
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const { sql } = await import("drizzle-orm");
const { db } = await import("../src/db/index.ts");
const { rows } = await import("../src/db/rows.ts");
const { PRICES } = await import("../src/lib/ai/models.ts");

const days = Math.max(1, Number(process.argv[2] ?? 30) || 30);

type Row = {
  provider: string;
  billed: boolean;
  kind: string;
  model: string;
  runs: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  with_cache_data: number;
};
const result = rows<Row>(
  await db.execute(sql`
    select provider, billed, kind, model,
      count(*)::int as runs,
      coalesce(sum(input_tokens), 0)::bigint::float8 as input,
      coalesce(sum(output_tokens), 0)::bigint::float8 as output,
      coalesce(sum(cache_read_tokens), 0)::bigint::float8 as cache_read,
      coalesce(sum(cache_creation_tokens), 0)::bigint::float8 as cache_write,
      count(cache_read_tokens)::int as with_cache_data
    from ai_runs
    where created_at >= now() - make_interval(days => ${days})
    group by provider, billed, kind, model
  `),
);

const usd = (r: Row) => {
  const p = PRICES[r.model] ?? PRICES["claude-opus-5"];
  return (r.input * p.input + r.cache_read * p.input * 0.1 + r.cache_write * p.input * 1.25 + r.output * p.output) / 1_000_000;
};
const n = (x: number) => Math.round(x).toLocaleString("en-US");

const sorted = [...result].sort((a, b) => {
  const cmp = a.provider.localeCompare(b.provider) || (b.billed ? 1 : -1) - (a.billed ? 1 : -1);
  return cmp !== 0 ? cmp : usd(b) - usd(a);
});

console.log(`ai_runs, last ${days} day${days === 1 ? "" : "s"}\n`);
console.log(["provider".padEnd(18), "billed".padEnd(8), "kind".padEnd(16), "model".padEnd(18), "runs".padStart(6), "input".padStart(11), "output".padStart(10), "cache read".padStart(12), "cache write".padStart(12), "hit %".padStart(6), "USD".padStart(9)].join(" "));

let billedTotal = 0;
let notionalTotal = 0;
let currentProvider = "";
let providerBilledTotal = 0;
let providerNotionalTotal = 0;

for (const r of sorted) {
  if (currentProvider && r.provider !== currentProvider) {
    console.log(
      ["".padEnd(18), `${currentProvider} totals`.padEnd(8), "".padEnd(16), "".padEnd(18), "".padStart(6), "".padStart(11), "".padStart(10), "".padStart(12), "".padStart(12), "".padStart(6), (providerBilledTotal + providerNotionalTotal).toFixed(2).padStart(9)].join(" "),
    );
    providerBilledTotal = 0;
    providerNotionalTotal = 0;
  }
  currentProvider = r.provider;

  const cost = usd(r);
  if (r.billed) {
    billedTotal += cost;
    providerBilledTotal += cost;
  } else {
    notionalTotal += cost;
    providerNotionalTotal += cost;
  }

  const prompt = r.input + r.cache_read + r.cache_write;
  const hit = r.with_cache_data > 0 && prompt > 0 ? `${Math.round((r.cache_read / prompt) * 100)}` : "-";
  const cached = r.with_cache_data > 0;
  console.log(
    [
      r.provider.padEnd(18),
      (r.billed ? "yes" : "no").padEnd(8),
      r.kind.padEnd(16),
      r.model.padEnd(18),
      n(r.runs).padStart(6),
      n(r.input).padStart(11),
      n(r.output).padStart(10),
      (cached ? n(r.cache_read) : "-").padStart(12),
      (cached ? n(r.cache_write) : "-").padStart(12),
      hit.padStart(6),
      cost.toFixed(2).padStart(9),
    ].join(" "),
  );
}

if (currentProvider) {
  console.log(
    ["".padEnd(18), `${currentProvider} totals`.padEnd(8), "".padEnd(16), "".padEnd(18), "".padStart(6), "".padStart(11), "".padStart(10), "".padStart(12), "".padStart(12), "".padStart(6), (providerBilledTotal + providerNotionalTotal).toFixed(2).padStart(9)].join(" "),
  );
}

console.log(`\nbilled USD: ${billedTotal.toFixed(2)}`);
console.log(`notional USD: ${notionalTotal.toFixed(2)}`);
console.log(`total: ${(billedTotal + notionalTotal).toFixed(2)} USD across ${n(sorted.reduce((s, r) => s + r.runs, 0))} runs`);
console.log("billed = runs with billed=true; notional = runs with billed=false; hit % = cache read / (input + cache read + cache write); \"-\" when no run in the group recorded cache figures.");
process.exit(0);
