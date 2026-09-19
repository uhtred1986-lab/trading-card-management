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
 */
import { EngineMismatch } from "../src/lib/arena/engines";
import { NotYet } from "../src/lib/arena/vm";
import { ENGINE } from "./verify/harness";

const SUITES = ["text", "setup", "battles", "compiler", "keywords", "readings", "wordings", "workflow", "contract", "deck-api", "language", "lang", "rulesets", "board-words", "primer", "probe", "vm"];

// A plain `.ts` file runs as CJS under `tsx`, which does not allow top-level
// `await` — so the loop is a function `npm test`/`npm run test:rules` waits on
// the ordinary way, by waiting for the process to exit, rather than a literal
// top-level `await import(...)`.
async function main(): Promise<void> {
  let passed = 0;
  let skipped = 0;
  let failed = 0;

  for (const suite of SUITES) {
    try {
      await import(`./verify/${suite}`);
      console.log(`  ok       ${suite}`);
      passed++;
    } catch (err) {
      if (err instanceof NotYet) {
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

  console.log(`\nverify-arena (${ENGINE}): ${passed}/${SUITES.length} passed, ${skipped} skipped, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
