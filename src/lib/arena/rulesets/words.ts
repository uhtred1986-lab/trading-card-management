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
 * ── what still comes from the engine, and why ────────────────────────────────
 *
 * One of the five lists the issue names is not the definition's yet, and it
 * would be a silent regression rather than a swap:
 *
 * - **`triggers`** is a *superset*: `triggers.rules` declares 58 moments, five
 *   of them the counter windows (`counter:play` …), which are a `CounterWindow`
 *   and not a `Trigger` the engine ever fires. Pointing `validateRule` at it
 *   would let a rule carry a WHEN the engine ignores — exactly the failure
 *   that check exists to prevent. #136 is the suite that has to make the two
 *   agree first.
 *
 * `SPECIAL_TARGETS` has no `Vocabulary` field at all, and no `DEFINE` kind
 * that could declare one; it stays the engine's.
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
