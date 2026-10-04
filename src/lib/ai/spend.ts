/**
 * The money arithmetic of `npm run ai:spend`, pure so a check can prove it without a database.
 *
 * A run stores `cost_micros` when its adapter knew the cost at call time (OpenRouter, #520). Those rows are
 * summed as stored. Every other row (Anthropic's, and anything from before the column existed) is priced from
 * its tokens with the formula the script always used: input at list price, cache reads at 0.1x, cache writes
 * at 1.25x, output at list price.
 */
import { priceOf } from "./models";

/** One `group by` row. The `legacy_*` figures sum only the runs with no stored cost; `stored_micros` sums the others. */
export interface SpendRow {
  provider: string;
  model: string;
  stored_micros: number;
  legacy_input: number;
  legacy_output: number;
  legacy_cache_read: number;
  legacy_cache_write: number;
}

/** US dollars for one group of runs. */
export function rowUsd(r: SpendRow, price: (model: string, provider: string) => { input: number; output: number } = priceOf): number {
  const p = price(r.model, r.provider);
  const priced = (r.legacy_input * p.input + r.legacy_cache_read * p.input * 0.1 + r.legacy_cache_write * p.input * 1.25 + r.legacy_output * p.output) / 1_000_000;
  return r.stored_micros / 1_000_000 + priced;
}
