/**
 * The Dragon Ball Super Card Game, as files.
 *
 * `files.ts` beside this one is generated from the `.rules` files in this
 * directory by `npm run arena:rulesets` — see `scripts/arena-rulesets-emit.mts`
 * for why the text is a constant rather than a read. The directory is **empty
 * for now**: the nine files are #133–#135, and the loader is built and tested
 * against an empty set so that it exists before its content does.
 */
import { loadRuleset } from "../load";
import type { Loaded } from "../types";
import { FILES } from "./files";

export const DBS_FILES = FILES;

/** The loaded ruleset, read once. Pure, so the cache is only about not re-parsing. */
let cached: Loaded | null = null;
export function loadDbs(): Loaded {
  cached ??= loadRuleset(DBS_FILES, "dbs");
  return cached;
}
