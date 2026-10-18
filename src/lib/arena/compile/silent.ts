import type { Script } from "../vm/script";
import type { Skill } from "../types";

/**
 * Does this skill **read as nothing, and say nothing about it** (#1005)?
 *
 * A skill the compiler cannot read ends in `unsupported`, and the referee
 * queue, the tally and the rule review all count that. A skill whose program is
 * empty *and* whose `unsupported` is empty is the one outcome nothing counts:
 * it plays as blank, in silence. #1005's `[Permanent]` "…can't attack Leaders"
 * family was exactly that — a clause the condition reader swallowed as a
 * second condition left an `if` with nothing under it, which the assembly
 * dropped.
 *
 * Three kinds of line are empty on purpose and are not reported:
 * - a **keyword skill** (`[Blocker]`, `[Evolve]` …): the engine plays it
 *   itself (`KEYWORD_HANDLES_THE_LINE`);
 * - a **reminder** printed in brackets, which `stripNotes` removes (1-5-8);
 * - a **deck-building** restriction (6-1): the engine takes the deck it is
 *   given.
 */
export function readsAsNothingSilently(skill: Skill, script: Script): boolean {
  if (script.ops.length || script.unsupported.length) return false;
  if (skill.keyword) return false;
  const text = skill.effect.replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/^[(（].*[)）]\.?$/.test(text)) return false;
  if (/\b(?:include|included)\b.*\bin your deck\b|\bin your deck\b.*\bas you like\b/i.test(text)) return false;
  return true;
}
