/**
 * The Dragon Ball Super Card Game, as files.
 *
 * `files.ts` beside this one is generated from the `.rules` files in this
 * directory by `npm run arena:rulesets` — see `scripts/arena-rulesets-emit.mts`
 * for why the text is a constant rather than a read. Four of the nine files
 * are in — `game.rules`, `attributes.rules` and `zones.rules` (#133), and
 * `triggers.rules` (#134) — and the set resolves: a trigger's `to: battle`
 * names a zone `zones.rules` declares. The rest are #135.
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
