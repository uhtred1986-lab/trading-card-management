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
 * billed=true. Runs that stored `cost_micros` (OpenRouter) are priced by it; all others by the formula above.
 * Billed and notional (subscription) cost are totalled apart, per provider.
 */
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const { sql } = await import("drizzle-orm");
const { db } = await import("../src/db/index.ts");
const { rows } = await import("../src/db/rows.ts");
const { rowUsd } = await import("../src/lib/ai/spend.ts");

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
  stored_micros: number;
  legacy_input: number;
  legacy_output: number;
  legacy_cache_read: number;
  legacy_cache_write: number;
};
const result = rows<Row>(
  await db.execute(sql`
    select provider, billed, kind, model,
      count(*)::int as runs,
      coalesce(sum(input_tokens), 0)::bigint::float8 as input,
      coalesce(sum(output_tokens), 0)::bigint::float8 as output,
      coalesce(sum(cache_read_tokens), 0)::bigint::float8 as cache_read,
      coalesce(sum(cache_creation_tokens), 0)::bigint::float8 as cache_write,
      count(cache_read_tokens)::int as with_cache_data,
      coalesce(sum(cost_micros), 0)::bigint::float8 as stored_micros,
      coalesce(sum(input_tokens) filter (where cost_micros is null), 0)::bigint::float8 as legacy_input,
      coalesce(sum(output_tokens) filter (where cost_micros is null), 0)::bigint::float8 as legacy_output,
      coalesce(sum(cache_read_tokens) filter (where cost_micros is null), 0)::bigint::float8 as legacy_cache_read,
      coalesce(sum(cache_creation_tokens) filter (where cost_micros is null), 0)::bigint::float8 as legacy_cache_write
    from ai_runs
    where created_at >= now() - make_interval(days => ${days})
    group by provider, billed, kind, model
  `),
);

// A run's stored cost (OpenRouter, #520) is used as it is; a run without one is priced from its tokens (`src/lib/ai/spend.ts`).
const usd = rowUsd;
const n = (x: number) => Math.round(x).toLocaleString("en-US");

const sorted = [...result].sort((a, b) => usd(b) - usd(a));
console.log(`ai_runs, last ${days} day${days === 1 ? "" : "s"}\n`);
console.log(["provider".padEnd(14), "billed".padEnd(6), "kind".padEnd(16), "model".padEnd(18), "runs".padStart(6), "input".padStart(11), "output".padStart(10), "cache read".padStart(12), "cache write".padStart(12), "hit %".padStart(6), "USD".padStart(9)].join(" "));
let total = 0;
const perProvider = new Map<string, { billed: number; notional: number }>();
for (const r of sorted) {
  const cost = usd(r);
  total += cost;
  const p = perProvider.get(r.provider) ?? { billed: 0, notional: 0 };
  if (r.billed) p.billed += cost;
  else p.notional += cost;
  perProvider.set(r.provider, p);
  const prompt = r.input + r.cache_read + r.cache_write;
  const hit = r.with_cache_data > 0 && prompt > 0 ? `${Math.round((r.cache_read / prompt) * 100)}` : "-";
  const cached = r.with_cache_data > 0;
  console.log(
    [r.provider.padEnd(14), (r.billed ? "yes" : "no").padEnd(6), r.kind.padEnd(16), r.model.padEnd(18), n(r.runs).padStart(6), n(r.input).padStart(11), n(r.output).padStart(10), (cached ? n(r.cache_read) : "-").padStart(12), (cached ? n(r.cache_write) : "-").padStart(12), hit.padStart(6), cost.toFixed(2).padStart(9)].join(" "),
  );
}
console.log(`\ntotal ${total.toFixed(2)} USD across ${n(sorted.reduce((s, r) => s + r.runs, 0))} runs`);
for (const [provider, p] of perProvider) console.log(`  ${provider}: billed ${p.billed.toFixed(2)} USD, notional ${p.notional.toFixed(2)} USD (list price of calls a subscription paid for)`);
console.log("hit % = cache read / (input + cache read + cache write); \"-\" when no run in the group recorded cache figures.");
process.exit(0);
