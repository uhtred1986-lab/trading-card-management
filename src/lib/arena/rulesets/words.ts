/**
 * The one word list.
 *
 * The language, the workbench's chip editor and the referee's prompt each used
 * to carry their own copy of the closed lists a rule is checked against —
 * three imports of the same constants in `engine/script-schema.ts`, and a
 * fourth of `TRIGGERS` in `gaps.ts`. Once a game is a set of declarations
 * there must be one: the areas are the zones `zones.rules` declares, and a
 * word deleted there has to disappear from all three readers at once or the
 * definition is not the definition of anything (#137).
 *
 * `words()` is that source. It is a **function and not a constant** because
 * the loader is built on `lang/` and `lang/` now reads this: a constant
 * evaluated at module load would be read while that cycle is still being
 * initialised. Nothing here is slow enough for it to matter — the ruleset is
 * parsed once and kept.
 *
 * Client-safe, like the rest of `rulesets/`: the `.rules` text arrives as a
 * generated constant, so the browser takes the same path as the server.
 *
 * `SPECIAL_TARGETS` is the one list with no `Vocabulary` field at all, and no
 * `DEFINE` kind that could declare one; it stays the engine's.
 */
import { loadDbs } from "./dbs";
import type { Vocabulary } from "./types";

/** The lists the parser and the chip editor read from the definition. Narrower than `Vocabulary` on purpose: these are the four a game really declares. */
export type Words = Pick<Vocabulary, "areas" | "durations" | "sides" | "keywordNames">;

let cached: Vocabulary | null = null;

/**
 * The game's own words. A ruleset that does not load is a broken build rather
 * than a state to render around — `scripts/verify/rulesets.ts` asserts it
 * loads on every run — so this says so instead of handing back an empty list
 * that would refuse every rule in the catalog with no clue why.
 */
export function words(): Vocabulary {
  if (cached) return cached;
  const loaded = loadDbs();
  if (!loaded.ok) throw new Error(`the DBS ruleset does not load, so the language has no words: ${JSON.stringify(loaded.errors[0])}`);
  cached = loaded.vocabulary;
  return cached;
}

/**
 * The options the chip editor offers for a field whose type is a closed list.
 * The editor calls this rather than mapping a constant of its own, which is
 * what makes "the word is gone from the definition" and "the word is gone from
 * the editor" one fact and not two.
 */
export function optionsFor(type: "side" | "area" | "duration" | "keyword", v: Words = words()): string[] {
  if (type === "side") return v.sides;
  if (type === "area") return v.areas;
  if (type === "duration") return v.durations;
  return v.keywordNames;
}

/**
 * The moments a record's WHEN may name — what `validateRule` checks a rule's
 * triggers against.
 *
 * Not simply the game's triggers: `triggers.rules` declares the five counter
 * windows beside the fifty-three moments, because a [Counter] answers to a
 * *window* rather than to a card's own moment (4-3, 9-7), and they are the
 * only names in that file a WHEN never says (#136's suite is where that claim
 * is asserted, both directions, against the engine's `Trigger` union). The
 * `counter:` prefix is how the file spells the difference, and no `Trigger`
 * carries a colon — so this is a reading of the declarations, not a second
 * list, and `scripts/verify/rulesets.ts` fails the moment the two diverge.
 */
export function whenMoments(v: Pick<Vocabulary, "triggers"> = words()): string[] {
  return v.triggers.filter((t) => !t.startsWith("counter:"));
}
