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

const SUITES = ["outcomes", "text", "setup", "battles", "compiler", "keywords", "hidden", "while-source", "warp", "next-activation", "taxes", "readings", "bounded-life-820", "world-peace-819", "universe3-removal-920", "errata-934", "readings-571", "sd15-readings-728", "limit-copies-741", "hand-combo-572", "combo-entry-672", "grouped-readings-573", "duration-shuffle-574", "activate-tax-677", "free-extra-680", "activate-battle-alt-742", "wordings", "faceup-life-556", "workflow", "contract", "deck-api", "language", "lang", "describe", "rulesets", "static-layers-553", "shenron-trait-910", "board-words", "keyword-rules", "primer", "game-page", "gameplan-570", "probe", "ai-vm", "vm", "rule-processing", "engine-default", "poll-schedule", "narration", "heroic-554", "z-energy-combo-551", "battle-cleanup-609", "qualified-movement-evolve-825", "energy-evolve-913", "z-evolve-917", "attack-target-937", "attack-restrictions-1005", "keyword-param-941", "played-or-removed-940", "played-or-attacks", "played-or-discarded", "keyword-action-costs-926", "non-evolve-play-933", "attack-negation-936", "aegis-555", "auto-costs-549", "bond-auto-549", "auto-search-549", "secret-auto-549", "priced-secret-auto-549", "ability-snapshot-558", "aegis-cost-order-595", "aegis-printed-price-595", "ko-marker-price-549", "counter-action-price-716", "substitute-unpaid-720", "abilities-now-561", "battle-stakes-562", "original-colors-597", "effective-payment-colours-626", "hidden-mode-projection-626", "public-zone-inspection-563", "revive-cost-order-624", "granted-heroic-602", "villainous-683", "unique-730", "hand-auto-748", "once-per-turn-746", "cost-binding-550", "name-in-skill-text-542", "union-areas-541", "gogeta-warp-924", "counter-chain-552", "u1a-triggers-757", "u1c-effects-757", "u1c-moves-757", "u1c-conditions-757", "u1b-prices-757", "name-includes-758", "aegis-alt-payment-762", "unison-zero-markers-759", "activation-taxes-677", "names-both-768", "arena-542-fuzz-crash", "arena-fuzz-diagnostics", "optional-exact-538", "auto-price-gate-804", "earthling-tokens-919", "multicolor-energy-921", "cell-binding-938-939", "bardocks-crew-915", "counter-energy-916", "price-condition-clauses", "final-strike-bardock-922", "power-wish-910", "shared-price-readers", "disjoint-send-costs", "leader-or-is-price-907", "leader-trait-only-932", "leader-only-power-990", "if-you-do-907", "energy-bound-979-980", "energy-relations-1011", "rest-cause-energy-907", "census-triggers-907", "cost-reductions-907", "census-effects-907", "effect-payment-warp-life-907", "color-count-907", "during-that-turn-907", "union-exact-sets-925", "named-gaps-907", "union-compound-928", "union-counter-929", "anaphora-1015", "union-sources-930", "fusion-drop-bottom-930", "typed-payment-907", "typed-combo-907", "typed-usage-907", "typed-validity-907", "life-lock-907", "counter-cost-907", "fusion-identity-907", "absorb-identity-923", "potara-identity-907", "ex-evolve-907", "barrier-ko-907", "protected-grammar-907", "protected-usage-907", "fusion-materials-907", "union-potara-927", "opponent-choice-1015", "cell-leader-summon-939", "opponent-leftovers-907", "census-round2-907", "census-round3-907", "discard-combo-origin-907", "battle-end-delay-1042", "battle-end-followups-907", "qualified-combo-entry-907", "census-round4-907", "adjacent-names-907", "census-round5-907", "census-round6-907", "place-under-price-1096", "drop-origin-auto-1098", "pile-permanents-1119", "activate-prices-1117", "did-may-1121", "printed-cost-filter-1097"]

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
