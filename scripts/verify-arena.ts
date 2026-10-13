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
 * `--engine legacy|rules` (default `legacy`) picks the engine
 * `scripts/verify/harness.ts` stages and plays every game-based suite on —
 * `harness.ts` reads the flag itself and exports the resolved `ENGINE`, which
 * is why importing it here is enough to validate it before any suite runs.
 * `npm test` never passes the flag, so legacy is what it has always run;
 * `npm run test:rules` is this file with `--engine rules`. `vm` and
 * `rulesets` name an engine themselves and ignore `ENGINE`, because proving
 * the switch cannot depend on which side of it happens to be selected.
 *
 * Each suite is imported on its own, and its outcome — not just whether the
 * whole run got that far — is what is reported: a suite the rules engine
 * cannot attempt yet throws either `NotYet` (a call it does not implement) or
 * `EngineMismatch` (the harness's own fixtures are still legacy-shaped), and
 * either is printed as `skipped` with the reason rather than stopping the run;
 * anything else is a real failure, printed and counted. Only a real failure
 * exits non-zero — `npm run test:rules` is meant to be read, not just to pass.
 *
 * `--rules-only` (#459, `npm run test:rules-only`) is the run `npm test` keeps
 * once the legacy engine is gone (#118): every suite on the rules engine, with
 * `verify/legacy-guard.ts` making any call into `src/lib/arena/engine/` a
 * failure of the suite that made it. Nothing is skipped as a whole there — a
 * `NotYet` or an `EngineMismatch` fails the suite too — except the suites
 * `STILL_ON_THE_ORACLE` names, which still compare the rules engine with the
 * legacy one call for call and are listed, not run. Every single case a suite
 * could not assert on the rules engine was named as it ran (`rulesGap`), and
 * the run ends by listing them.
 */
// First, for its side effects: `--rules-only` must pick the engine and guard
// `src/lib/arena/engine/` before anything below loads either.
import { RULES_ONLY } from "./verify/rules-only";
import { LEGACY_CALLS } from "./verify/legacy-guard";
import { EngineMismatch } from "../src/lib/arena/engines";
import { NotYet } from "../src/lib/arena/vm";
import { ENGINE, RULES_GAPS } from "./verify/harness";
// Capture vm.ts's printed input cards before earlier suites stage mutations.
import "./verify/vm-base-corpus-459";

/** Any suite still requiring a live legacy gameplay oracle belongs here. */
const STILL_ON_THE_ORACLE: Record<string, string> = {};

const SUITES = ["outcomes", "text", "setup", "battles", "compiler", "keywords", "hidden", "while-source", "warp", "next-activation", "taxes", "readings", "readings-571", "sd15-readings-728", "limit-copies-741", "hand-combo-572", "combo-entry-672", "grouped-readings-573", "duration-shuffle-574", "activate-tax-677", "free-extra-680", "activate-battle-alt-742", "wordings", "faceup-life-556", "workflow", "contract", "deck-api", "language", "lang", "describe", "rulesets", "static-layers-553", "board-words", "primer", "game-page", "gameplan-570", "probe", "ai-vm", "vm", "rule-processing", "engine-default", "poll-schedule", "narration", "heroic-554", "z-energy-combo-551", "battle-cleanup-609", "aegis-555", "auto-costs-549", "auto-search-549", "secret-auto-549", "priced-secret-auto-549", "ability-snapshot-558", "aegis-cost-order-595", "aegis-printed-price-595", "ko-marker-price-549", "counter-action-price-716", "substitute-unpaid-720", "abilities-now-561", "battle-stakes-562", "original-colors-597", "effective-payment-colours-626", "hidden-mode-projection-626", "public-zone-inspection-563", "revive-cost-order-624", "granted-heroic-602", "villainous-683", "unique-730", "hand-auto-748", "once-per-turn-746"];

// A plain `.ts` file runs as CJS under `tsx`, which does not allow top-level
// `await` — so the loop is a function `npm test`/`npm run test:rules` waits on
// the ordinary way, by waiting for the process to exit, rather than a literal
// top-level `await import(...)`.
async function main(): Promise<void> {
  let passed = 0;
  let skipped = 0;
  let failed = 0;

  for (const suite of SUITES) {
    if (RULES_ONLY && STILL_ON_THE_ORACLE[suite]) {
      console.log(`  not run  ${suite} — ${STILL_ON_THE_ORACLE[suite]}`);
      skipped++;
      continue;
    }
    const calledBefore = LEGACY_CALLS.size;
    try {
      const mod = await import(`./verify/${suite}`);
      // A suite whose checks are async (`chooseMove` is, `ai-vm`'s own) has
      // nothing else to await it: exporting the promise as `default` is what
      // lets its assertions actually run — and fail this suite properly —
      // before the loop moves on, rather than racing `process.exit` below.
      if (mod.default instanceof Promise) await mod.default;
      // A legacy call some `try` swallowed is still a legacy call.
      if (LEGACY_CALLS.size > calledBefore) throw new Error(`called the legacy engine: ${[...LEGACY_CALLS].slice(calledBefore).join(", ")}`);
      console.log(`  ok       ${suite}`);
      passed++;
    } catch (err) {
      if (RULES_ONLY) {
        console.log(`  FAILED   ${suite} — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        failed++;
      } else if (err instanceof NotYet) {
        console.log(`  skipped  ${suite} — the rules engine cannot ${err.step} yet (${err.issue})`);
        skipped++;
      } else if (err instanceof EngineMismatch) {
        console.log(`  skipped  ${suite} — ${err.message}`);
        skipped++;
      } else {
        console.log(`  FAILED   ${suite} — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        failed++;
      }
    }
  }

  if (RULES_GAPS.length) {
    console.log(`\n${RULES_GAPS.length} case(s) not asserted on the rules engine, each a named gap:`);
    for (const gap of RULES_GAPS) console.log(`  - ${gap}`);
  }
  if (RULES_ONLY) console.log(`\nlegacy engine calls: ${LEGACY_CALLS.size ? [...LEGACY_CALLS].join(", ") : "none"}`);
  console.log(`\nverify-arena (${RULES_ONLY ? "rules only" : ENGINE}): ${passed}/${SUITES.length} passed, ${skipped} ${RULES_ONLY ? "not run" : "skipped"}, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
