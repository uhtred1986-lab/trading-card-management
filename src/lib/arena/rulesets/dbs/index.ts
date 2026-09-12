/**
 * The Dragon Ball Super Card Game, as files.
 *
 * `files.ts` beside this one is generated from the `.rules` files in this
 * directory by `npm run arena:rulesets` — see `scripts/arena-rulesets-emit.mts`
 * for why the text is a constant rather than a read. `triggers.rules` is the
 * first of the nine in (#134); the rest are #133 and #135. Until `zones.rules`
 * lands (#133) the set does **not** resolve on its own: a trigger's
 * `to: battle` names a zone nothing declares yet, and the loader is right to
 * say so.
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
