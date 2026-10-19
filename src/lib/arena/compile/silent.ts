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
  return !emptyOnPurpose(skill);
}

/**
 * The line reads as nothing **because that is right**: a keyword skill, a
 * bracketed reminder, a deck-building restriction, or no effect text at all.
 * `ruleHealth` (rules-store.ts) calls this too, so "done with an empty program"
 * and "silent blank" can never disagree about the same line.
 */
export function emptyOnPurpose(skill: Skill): boolean {
  if (skill.keyword) return true;
  const text = skill.effect.replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/^[(（].*[)）]\.?$/.test(text)) return true;
  if (/\b(?:include|included)\b.*\bin your deck\b|\bin your deck\b.*\bas you like\b/i.test(text)) return true;
  return false;
}

/**
 * Known gaps found while closing #1005: each is a clause whose reading says
 * nothing at all and is not yet fixed. Shrink this list; never grow it.
 * Shared by `arena:readings --silent` and `arena:corpus` (#897).
 */
export const KNOWN_SILENT = new Set<string>([
  // "When you activate this card, you can't activate {X} for the turn": a
  // reminder `connective()` skips on purpose (the Extra's own once-per-name rule).
  "BT6-051#0", "BT7-024#20", "BT7-048#20", "BT7-073#20", "BT7-098#20", "BT8-063#0", "BT8-087#0",
  // "This card can't be played from any area if/unless …": `connective()` skips the
  // bare "this card can't be played", and with it the condition — a real hole.
  "BT9-078#10", "BT9-079#10", "P-281#10", "BT22-077#0",
  // Wordings no reader takes and none reports: found by this check, not yet fixed.
  "BT13-084#20", "BT14-074#10", "BT18-003#20", "BT20-017#0", "BT20-019#0", "BT25-133#20", "BT4-003#40",
]);
