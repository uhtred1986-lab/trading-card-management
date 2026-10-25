/**
 * #902: the dated rate sheet of the local-policy versus Claude API campaign (#906), and the money
 * arithmetic the spend ledger (`claude-campaign-ledger.ts`) reserves and settles with.
 *
 * Separate from `src/lib/ai/models.ts` on purpose: the app's table prices `ai:spend` reports, while
 * this sheet gates real money. It fails closed — a model not on the sheet, a sheet without a
 * verification date, or a model whose access is not verified cannot be priced for a paid call.
 *
 * Money is integer micro-dollars (millionths of USD), as in `ai_runs.cost_micros`. A rate of
 * $X per million tokens is X micro-dollars per token; rates are held as integer thousandths of a
 * micro-dollar per token so the sheet's $0.125 and $0.01 rates stay exact, and every total is
 * rounded **up** to whole micro-dollars.
 *
 * Usage categories are `ai_runs`' own (`input_tokens`, `output_tokens`, `cache_read_tokens`,
 * `cache_creation_tokens`). A cache write is always charged at the 1-hour rate (the higher one): the
 * provider reports one cache-write total, not the 5-minute and 1-hour halves, so the conservative
 * reading is the only safe one.
 */
import { createHash } from "node:crypto";

export const RATE_SHEET_VERSION = 1;

/** USD per million tokens, as the public pricing table prints them. */
export interface PrintedRates {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export interface RateTier {
  /** The tier applies to a request whose prompt (input + cache read + cache write tokens) is at most this; null = no upper bound. */
  maxPromptTokens: number | null;
  usdPerMTok: PrintedRates;
}

export interface CampaignModelRate {
  model: string;
  label: string;
  /** Ascending by `maxPromptTokens`, the last one unbounded. */
  tiers: RateTier[];
  /**
   * Whether the owner's API key can actually call this model. Only a call (or the free Models API
   * with the owner's key) can say; an agent session has neither, so this stays "pending" until the
   * #903 preflight records it.
   */
  access: "pending" | "verified";
}

export interface RateSheet {
  version: typeof RATE_SHEET_VERSION;
  /** ISO date the rates were read off the source. */
  verifiedOn: string;
  source: string;
  method: string;
  /** Pricing modifiers the campaign does not use, so the base table applies: say so, or the sheet is not exact. */
  assumptions: string[];
  /** True only after the owner compared the sheet with their own Console/invoice pricing. */
  ownerVerified: boolean;
  models: CampaignModelRate[];
}

const tier = (input: number, cacheWrite5m: number, cacheWrite1h: number, cacheRead: number, output: number, maxPromptTokens: number | null = null): RateTier => ({
  maxPromptTokens,
  usdPerMTok: { input, cacheWrite5m, cacheWrite1h, cacheRead, output },
});

/**
 * Read by the agent of #902 on 25 Oct 2026 from Anthropic's public pricing page (the "Model pricing"
 * table, its footnotes and the "Long context pricing" section) and the public models overview (API
 * ids). No paid call and no credential was used. The owner re-checks it against the Console before
 * the first paid call (#903), then sets `ownerVerified` and each model's `access`.
 */
export const CAMPAIGN_RATES: RateSheet = {
  version: RATE_SHEET_VERSION,
  verifiedOn: "2026-10-25",
  source: "https://platform.claude.com/docs/en/about-claude/pricing (redirected from docs.claude.com/en/docs/about-claude/pricing); ids: https://platform.claude.com/docs/en/about-claude/models/overview",
  method: "public pricing page fetched by the #902 agent session; not yet compared with the owner's Console or invoices",
  assumptions: [
    "Claude API first party, global inference (no inference_geo: \"us\", which is 1.1x)",
    "synchronous Messages API: no Batch API discount, no fast mode",
    "no server tools (web search, code execution) and no Managed Agents",
    "cache writes charged at the 1-hour rate whatever their TTL",
  ],
  ownerVerified: false,
  models: [
    // The arena's Sparring model today (`FAST_MODEL` in models.ts).
    { model: "claude-haiku-4-5", label: "Claude Haiku 4.5", access: "pending", tiers: [tier(1, 1.25, 2, 0.1, 5)] },
    // Current Haiku: priced by prompt length, over 100,000 prompt tokens the higher row.
    { model: "claude-haiku-5-5", label: "Claude Haiku 5.5", access: "pending", tiers: [tier(0.1, 0.125, 0.2, 0.01, 0.5, 100_000), tier(0.5, 0.625, 1, 0.05, 2.5)] },
    // `SONNET_MODEL`: cache hits are 0.05x input on this model (models.ts still says 0.1x, the safe side).
    { model: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", access: "pending", tiers: [tier(2, 2.5, 4, 0.1, 10)] },
    // `MODEL`, the Tournament tier's model today.
    { model: "claude-opus-5", label: "Claude Opus 5", access: "pending", tiers: [tier(5, 6.25, 10, 0.5, 25)] },
    { model: "claude-opus-5-5", label: "Claude Opus 5.5", access: "pending", tiers: [tier(4, 5, 8, 0.2, 20)] },
  ],
};

/** The tokens of one call, in `ai_runs`' categories. */
export interface CallUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Integer thousandths of a micro-dollar per token for each printed rate; refuses a rate it cannot hold exactly. */
function exact(rates: PrintedRates): PrintedRates {
  const out = {} as PrintedRates;
  for (const [k, v] of Object.entries(rates) as [keyof PrintedRates, number][]) {
    const milli = Math.round(v * 1000);
    if (!Number.isFinite(v) || v < 0 || Math.abs(milli - v * 1000) > 1e-6) throw new Error(`rate ${k} = ${v} is not a non-negative multiple of $0.001 per MTok`);
    out[k] = milli;
  }
  return out;
}

export function sheetHash(sheet: RateSheet = CAMPAIGN_RATES): string {
  return createHash("sha256").update(JSON.stringify(sheet)).digest("hex");
}

export type RateLookup = { ok: true; rate: CampaignModelRate } | { ok: false; reason: string };

/**
 * The model's rates, or why not. `paid` asks the stricter question a paid call needs: the sheet is
 * dated and owner-verified and the model's access is verified. Unknown prices and models fail closed.
 */
export function rateFor(model: string, opts: { paid: boolean; sheet?: RateSheet }): RateLookup {
  const sheet = opts.sheet ?? CAMPAIGN_RATES;
  if (sheet.version !== RATE_SHEET_VERSION || !/^\d{4}-\d{2}-\d{2}$/.test(sheet.verifiedOn)) return { ok: false, reason: "the rate sheet has no verification date" };
  const rate = sheet.models.find((m) => m.model === model);
  if (!rate) return { ok: false, reason: `${model} is not on the campaign rate sheet (verified ${sheet.verifiedOn}); an unknown price fails closed` };
  if (!rate.tiers.length || rate.tiers[rate.tiers.length - 1].maxPromptTokens !== null) return { ok: false, reason: `${model}'s tiers do not end in an unbounded row` };
  for (const t of rate.tiers) exact(t.usdPerMTok);
  if (opts.paid && !sheet.ownerVerified) return { ok: false, reason: `the rate sheet of ${sheet.verifiedOn} is not owner-verified; paid execution stays disabled` };
  if (opts.paid && rate.access !== "verified") return { ok: false, reason: `access to ${model} with the owner's key is not verified (#903 preflight); paid execution stays disabled` };
  return { ok: true, rate };
}

function tierFor(rate: CampaignModelRate, promptTokens: number): RateTier {
  return rate.tiers.find((t) => t.maxPromptTokens === null || promptTokens <= t.maxPromptTokens)!;
}

/** What a call that reported `usage` costs, rounded up. */
export function chargeMicros(rate: CampaignModelRate, usage: CallUsage): number {
  for (const v of Object.values(usage)) if (!Number.isSafeInteger(v) || v < 0) throw new Error(`usage ${JSON.stringify(usage)} is not a set of token counts`);
  const r = exact(tierFor(rate, usage.input + usage.cacheRead + usage.cacheWrite).usdPerMTok);
  const milli = usage.input * r.input + usage.cacheRead * r.cacheRead + usage.cacheWrite * Math.max(r.cacheWrite1h, r.cacheWrite5m) + usage.output * r.output;
  return Math.ceil(milli / 1000);
}

/**
 * The most one call can cost: every prompt token at the dearest input rate of the tier its bound
 * falls in (a cache write, 1 h), and every output token the request allows (thinking included,
 * since `max_tokens` bounds both).
 */
export function maxChargeMicros(rate: CampaignModelRate, bound: { promptTokens: number; maxOutputTokens: number }): number {
  const r = exact(tierFor(rate, bound.promptTokens).usdPerMTok);
  const dearestIn = Math.max(r.input, r.cacheWrite1h, r.cacheWrite5m, r.cacheRead);
  return Math.ceil((bound.promptTokens * dearestIn + bound.maxOutputTokens * r.output) / 1000);
}

/**
 * An upper bound on a prompt's tokens without a tokenizer: a token covers at least one byte of
 * UTF-8, so the byte count bounds the text, plus a fixed allowance for the message framing and the
 * structured-output schema. Deliberately loose (real prompts are 3–4 bytes a token).
 */
export const PROMPT_FRAMING_TOKENS = 2048;
export function promptTokenBound(texts: string[]): number {
  return texts.reduce((n, t) => n + Buffer.byteLength(t, "utf8"), 0) + PROMPT_FRAMING_TOKENS;
}

export const formatUsd = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;
