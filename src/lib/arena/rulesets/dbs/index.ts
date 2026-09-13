/**
 * The Dragon Ball Super Card Game, as files.
 *
 * `files.ts` beside this one is generated from the `.rules` files in this
 * directory by `npm run arena:rulesets` — see `scripts/arena-rulesets-emit.mts`
 * for why the text is a constant rather than a read. Seven of the ten files are
 * in — `game.rules`, `attributes.rules` and `zones.rules` (#133),
 * `triggers.rules` (#134), `keywords.rules` (#135), `actions.rules` (#144/#145,
 * four moves) and `costs.rules` (#148, six prices) — plus `ops.rules` with its
 * header and no declaration yet (#137). The set resolves: a trigger's
 * `to: battle` names a zone `zones.rules` declares, an action's
 * `prompts: [main]` a question a step asks, and a price's pool an area the
 * zones declare. `words.rules` and `prompts.rules` wait on #131's open
 * question.
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
