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

const SUITES = ["paid-drop-5", "paid-drop-contract-5", "paid-drop-preflight-5", "under-master-5", "under-release-5", "paid-removal-native-5", "pile-release-5", "ordinary-activate-native-5", "under-standing-5", "combo-standing-token-5", "combo-standing-face-5", "combo-standing-batch-5", "combo-standing-5", "ordinary-activate-cost-5", "paid-removal-contract-5", "activate-under-5", "standing-negation-mixed-native-5", "standing-negation-mixed-5", "majin-battle-duration-5", "auto-play-cost-5", "standing-negation-admission-contract-5", "standing-negation-admission-5", "conditional-ko-result-preparation-5", "energy-entry-drop-5", "ko-result-provenance-5", "ko-result-contract-5", "conditional-ko-result-5", "energy-admission-5", "flow-placement-cleanup-5", "blind-life-hand-5", "champa-leader-attack-5", "movement-auto-history-5", "conditional-ko-5", "cheelai-modal-5", "delayed-warp-5", "applied-effect-receipt-mechanism-5", "applied-effect-receipt-5", "gohan-target-paired-5", "energy-entry-battle-5", "energy-entry-opponent-5", "energy-arrival-negation-5", "control-guard-5", "control-pair-5", "normalized-battle-attack-5", "kefla-paired-5", "script-placement-cleanup-5", "energy-entry-combo-5", "played-combo-end-5", "energy-entry-origins-5", "watched-combo-origin-5", "energy-entry-charge-5", "played-active-5", "energy-entry-payer-boundary-5", "energy-entry-policy-5", "energy-entry-effect-5", "energy-entry-witness-5", "energy-entry-continuation-5", "energy-entry-mode-5", "energy-entry-preflight-5", "energy-entry-script-5", "energy-entry-native-5", "energy-entry-stack-guard-5", "standing-negation-trigger-boundaries-5", "standing-negation-cost-projections-5", "standing-negation-native-5", "standing-negation-transaction-5", "energy-entry-mode-native-5", "standing-negation-observation-5", "adjacent-skill-boundaries-5", "standing-negation-history-5", "self-keyword-all-areas-5", "resolved-grant-deletion-5", "resolved-grant-deletion-native-5", "launch-drop-combo-contract-5", "launch-drop-combo-5", "counter-choice-tail-5", "outcomes", "text", "setup", "battles", "compiler", "keywords", "hidden", "while-source", "warp", "next-activation", "taxes", "readings", "bounded-life-820", "world-peace-819", "universe3-removal-920", "errata-934", "readings-571", "sd15-readings-728", "limit-copies-741", "hand-combo-572", "combo-entry-672", "grouped-readings-573", "duration-shuffle-574", "activate-tax-677", "free-extra-680", "activate-battle-alt-742", "wordings", "faceup-life-556", "workflow", "contract", "deck-api", "language", "lang", "describe", "rulesets", "static-layers-553", "shenron-trait-910", "board-words", "keyword-rules", "primer", "game-page", "gameplan-570", "probe", "ai-vm", "vm", "rule-processing", "engine-default", "poll-schedule", "narration", "heroic-554", "z-energy-combo-551", "battle-cleanup-609", "qualified-movement-evolve-825", "energy-evolve-913", "z-evolve-917", "attack-target-937", "attack-restrictions-1005", "keyword-param-941", "played-or-removed-940", "played-or-attacks", "played-or-discarded", "keyword-action-costs-926", "non-evolve-play-933", "attack-negation-936", "aegis-555", "auto-costs-549", "bond-auto-549", "bond-payment-544", "bond-conditions-544", "auto-search-549", "secret-auto-549", "priced-secret-auto-549", "ability-snapshot-558", "aegis-cost-order-595", "aegis-printed-price-595", "ko-marker-price-549", "counter-action-price-716", "substitute-unpaid-720", "abilities-now-561", "battle-stakes-562", "original-colors-597", "effective-payment-colours-626", "hidden-mode-projection-626", "public-zone-inspection-563", "revive-cost-order-624", "granted-heroic-602", "villainous-683", "unique-730", "hand-auto-748", "once-per-turn-746", "cost-binding-550", "name-in-skill-text-542", "union-areas-541", "gogeta-warp-924", "counter-chain-552", "u1a-triggers-757", "u1c-effects-757", "u1c-moves-757", "u1c-conditions-757", "u1b-prices-757", "name-includes-758", "aegis-alt-payment-762", "unison-zero-markers-759", "activation-taxes-677", "names-both-768", "arena-542-fuzz-crash", "arena-fuzz-diagnostics", "optional-exact-538", "auto-price-gate-804", "earthling-tokens-919", "multicolor-energy-921", "cell-binding-938-939", "bardocks-crew-915", "counter-energy-916", "price-condition-clauses", "final-strike-bardock-922", "power-wish-910", "shared-price-readers", "disjoint-send-costs", "leader-or-is-price-907", "leader-trait-only-932", "leader-only-power-990", "if-you-do-907", "energy-bound-979-980", "energy-relations-1011", "rest-cause-energy-907", "census-triggers-907", "cost-reductions-907", "census-effects-907", "effect-payment-warp-life-907", "color-count-907", "during-that-turn-907", "union-exact-sets-925", "named-gaps-907", "union-compound-928", "union-counter-929", "anaphora-1015", "union-sources-930", "absorb-placed-name-930", "absorb-under-leader-930", "union-reductions-930", "union-only-play-930", "union-next-time-930", "union-reductions-rest-930", "union-leftovers-930", "played-via-union-930", "union-play-triggers-930", "union-played-other-930", "fusion-drop-bottom-930", "typed-payment-907", "typed-combo-907", "typed-usage-907", "typed-validity-907", "life-lock-907", "counter-cost-907", "fusion-identity-907", "absorb-identity-923", "potara-identity-907", "ex-evolve-907", "barrier-ko-907", "protected-grammar-907", "protected-usage-907", "fusion-materials-907", "union-potara-927", "opponent-choice-1015", "cell-leader-summon-939", "opponent-leftovers-907", "census-round2-907", "census-round3-907", "discard-combo-origin-907", "battle-end-delay-1042", "battle-end-followups-907", "qualified-combo-entry-907", "census-round4-907", "adjacent-names-907", "census-round5-907", "census-round6-907", "place-under-price-1096", "drop-origin-auto-1098", "pile-permanents-1119", "activate-prices-1117", "did-may-1121", "warp-activate-1118", "rest-mode-energy-1122", "printed-cost-filter-1097", "typed-ko-1120", "combo-battle-origin-1137", "awaken-draw-1135", "switch-lock-1138", "evolve-printed-base-1136", "attack-auto-timing-1139", "selector-host-price-1123", "union-counter-records-929", "zextra-on-top", "fixed-host-price-1123", "effects-1163", "spirit-boost-payer-1169", "leader-attacked-1168", "quoted-grants-1166", "granted-absorb-930", "play-order-mono-930", "union-searches-930", "prohibition-catalog", "phrasing-batch-1", "deck-flags-2026-10-26", "phrasing-batch-2", "arena-fusion-world.mts", "prohibition-catalog-2", "prohibition-catalog-3", "phrasing-batch-3", "prohibition-catalog-4", "phrasing-batch-4", "prohibition-catalog-5", "phrasing-batch-5", "phrasing-batch-6", "prohibition-catalog-6", "delayed-replacement-1", "phrasing-batch-7", "search-energy-1", "phrasing-batch-8", "mechanism-3", "phrasing-batch-9", "phrasing-batch-10", "mechanism-4", "errata-official-1", "errata-official-2", "moments-1", "triggerless-autos", "audit-triggers-1", "audit-conditions-1", "audit-selectors-1", "audit-effects-1", "integration-2", "audit-triggers-2", "audit-conditions-2", "audit-selectors-2", "audit-effects-2", "integration-3", "audit-triggers-3", "audit-conditions-3", "audit-selectors-3", "audit-effects-3", "audit-keyword-negation-4", "keyword-negation-instances", "explicit-board-areas-4", "battle-skill-ban-4", "counted-cost-bound-4", "audit-conditions-4", "observational-conditions-5", "support-conditions-5", "awaken-conditions-5", "surge-payment-5", "implicit-absorb-5", "trigger-play-memories-5", "invocation-origins-5", "stored-face-up-5", "combo-pronoun-5", "passive-cost-5", "skill-play-scope-5", "burst-memory-5", "evolve-orbs-5", "mill-price-memory-5", "combo-replacement-support-5", "awaken-named-gates-5", "negation-area-5", "z-awaken-procedure-5", "z-awaken-prices-5", "replacement-auto-5", "z-awaken-charge-5", "replacement-tax-5", "z-awaken-self-pile-5", "movement-result-5", "cost-movement-result-5", "z-energy-choice-5", "under-movement-result-5", "under-stored-5", "composite-completion-5", "z-awaken-cost-order-5", "cross-body-completion-5", "counter-after-scope-5", "qualified-bond-5", "boujack-price-5", "retained-counter-5", "counter-admission-tail-5", "coupon-timing-gap-5", "qualified-spirit-boost-5", "terminal-scopes-5", "counter-short-replacement-5", "scoped-energy-coupons-5", "extra-self-activated-5", "paid-marker-history-5", "counter-alternative-lifecycle-5", "drop-counter-5", "counter-return-replacement-5", "counter-spirit-x-5", "counter-x-protocol-5", "counter-extra-order-5", "ex-evolve-discard-5", "counter-self-binding-contract-5", "counter-self-binding-native-5", "z-stack-energy-5", "energy-counter-contract-5", "energy-counter-native-5", "dark-over-realm-price-5", "dark-over-realm-watcher-5", "under-keyword-power-5", "awaken-drop-price-5", "revive-watcher-5", "under-counter-contract-5", "under-counter-price-5", "under-counter-native-5", "tax-payers-5", "field-rules-5", "field-activation-5", "counter-arrival-contract-5", "counter-arrival-lifecycle-5", "counter-arrival-native-5", "awaken-alternative-5"]






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
