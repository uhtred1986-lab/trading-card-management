/**
 * `--rules-only`, read before anything else is imported (#459).
 *
 * `scripts/verify-arena.ts` imports this file first, for its side effects:
 * with the flag, every suite plays on the rules engine (`--engine rules`, which
 * `harness.ts` reads as it loads) and the legacy guard is installed before any
 * module under `src/lib/arena/engine/` can be loaded, so that a call into it is
 * caught wherever it comes from (`legacy-guard.ts`).
 */
import { installLegacyGuard } from "./legacy-guard";

export const RULES_ONLY = process.argv.includes("--rules-only");

if (RULES_ONLY) {
  const at = process.argv.indexOf("--engine");
  if (at >= 0 && process.argv[at + 1] !== "rules") throw new Error("--rules-only plays the rules engine; it cannot be combined with --engine legacy");
  if (at < 0) process.argv.push("--engine", "rules");
  installLegacyGuard();
}
