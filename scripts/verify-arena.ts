/**
 * Arena engine checks — pure, no database. Run with `tsx`.
 *
 * Synthetic cards exercise the rules one at a time; the numbers in comments
 * are Rule Manual sections. The checks are in `scripts/verify/`, one file per
 * area, and **this order is the contract**: the files add cards to the shared
 * `DEFS` as they go, so a later file may rely on what an earlier one defined.
 * They were one 7,400-line file until they reached TypeScript's control-flow
 * limit, which silently widened three lambda parameters to `any`.
 *
 * Every suite plays on the rules engine, the only engine since #118:
 * `scripts/verify/harness.ts` stages and plays every game-based suite on it,
 * and `vm` and `rulesets` name it themselves. A suite that throws, a
 * `NotYet` included, fails the run. Every single case a suite could not assert
 * on the rules engine is named as it runs (`rulesGap`), and the run ends by
 * listing them.
 *
 * `--emit` rewrites the contract fixtures (`npm run contract:emit`).
 */
import { RULES_GAPS } from "./verify/harness";
// Capture vm.ts's printed input cards before earlier suites stage mutations.
import "./verify/vm-base-corpus-459";

const SUITES = ["outcomes", "text", "setup", "battles", "compiler", "keywords", "hidden", "while-source", "warp", "next-activation", "taxes", "readings", "readings-571", "sd15-readings-728", "limit-copies-741", "hand-combo-572", "combo-entry-672", "grouped-readings-573", "duration-shuffle-574", "activate-tax-677", "free-extra-680", "activate-battle-alt-742", "wordings", "faceup-life-556", "workflow", "contract", "deck-api", "language", "lang", "describe", "rulesets", "static-layers-553", "board-words", "primer", "game-page", "gameplan-570", "probe", "ai-vm", "vm", "rule-processing", "engine-default", "poll-schedule", "narration", "heroic-554", "z-energy-combo-551", "battle-cleanup-609", "aegis-555", "auto-costs-549", "auto-search-549", "secret-auto-549", "priced-secret-auto-549", "ability-snapshot-558", "aegis-cost-order-595", "aegis-printed-price-595", "ko-marker-price-549", "counter-action-price-716", "substitute-unpaid-720", "abilities-now-561", "battle-stakes-562", "original-colors-597", "effective-payment-colours-626", "hidden-mode-projection-626", "public-zone-inspection-563", "revive-cost-order-624", "granted-heroic-602", "villainous-683", "unique-730", "hand-auto-748", "once-per-turn-746", "cost-binding-550", "name-in-skill-text-542", "union-areas-541", "counter-chain-552", "u1b-prices-757"];

// A plain `.ts` file runs as CJS under `tsx`, which does not allow top-level
// `await` — so the loop is a function `npm test` waits on
// the ordinary way, by waiting for the process to exit, rather than a literal
// top-level `await import(...)`.
async function main(): Promise<void> {
  let passed = 0;
  let failed = 0;

  for (const suite of SUITES) {
    try {
      const mod = await import(`./verify/${suite}`);
      // A suite whose checks are async (`chooseMove` is, `ai-vm`'s own) has
      // nothing else to await it: exporting the promise as `default` is what
      // lets its assertions actually run — and fail this suite properly —
      // before the loop moves on, rather than racing `process.exit` below.
      if (mod.default instanceof Promise) await mod.default;
      console.log(`  ok       ${suite}`);
      passed++;
    } catch (err) {
      console.log(`  FAILED   ${suite} — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      failed++;
    }
  }

  if (RULES_GAPS.length) {
    console.log(`\n${RULES_GAPS.length} case(s) not asserted on the rules engine, each a named gap:`);
    for (const gap of RULES_GAPS) console.log(`  - ${gap}`);
  }
  console.log(`\nverify-arena: ${passed}/${SUITES.length} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
