/**
 * The Dragon Ball Super Card Game, as files.
 *
 * `files.ts` beside this one is generated from the `.rules` files in this
 * directory by `npm run arena:rulesets` — see `scripts/arena-rulesets-emit.mts`
 * for why the text is a constant rather than a read. `game.rules`,
 * `attributes.rules` and `zones.rules` (#133), `triggers.rules` (#134),
 * `keywords.rules`, `words.rules` and `prompts.rules` (#135), `actions.rules`
 * (#144/#145, four moves) and `costs.rules` (#148, six prices) are in, plus
 * `ops.rules` with its header and a growing set of macros (#137, #273–#277)
 * and `battle.rules` (Stage 6). The set resolves: a trigger's `to: battle`
 * names a zone `zones.rules` declares, an action's `prompts: [main]` a
 * question a step asks, and a price's pool an area the zones declare.
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
