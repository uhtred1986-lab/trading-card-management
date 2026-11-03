import { deckBuildingOf, type DeckBuildingReading } from "../../decks/cardRules";
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
 *   given. `deckBuildingOfSkill` reads it (#1146).
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
  const text = skill.effect.replace(/\s+/g, " ").trim();
  // Audit effects 2 review: a keyword's own line is the engine's; a [Permanent], [Auto] or [Activate] that names a
  // keyword beside its tag and prints a sentence of its own is not — "[permanent][evolve] Skills on yellow ≪Demon
  // Realm≫ cards in your hand can also activate at [counter: play] timings" (BT30-067's back) read as nothing.
  if (skill.keyword && (skill.kind === "keyword" || !text || /^[(（].*[)）]\.?$/.test(text))) return true;
  if (!text) return true;
  if (/^[(（].*[)）]\.?$/.test(text)) return true;
  // A deck-building clause read whole, with no game text beside it. A mixed line is not empty:
  // its game half is compiled on its own (`compileSkill`).
  const deck = deckBuildingOfSkill(skill);
  if (isDeckBuildingLine(deck)) return true;
  // A wording the deck-building reader cannot take whole is still not a rule of play, as before
  // (it is listed by `parseDeckBuilding`'s `unread`); a line that has a clause it did read is judged by its rest.
  if (!deck.rules.length && /\b(?:include|included)\b.*\bin your deck\b|\bin your deck\b.*\bas you like\b/i.test(text)) return true;
  return false;
}

/** The deck-building clauses of a skill's effect text, and what is left of it for the engine (#1146). */
export function deckBuildingOfSkill(skill: Pick<Skill, "effect">): DeckBuildingReading {
  return deckBuildingOf(skill.effect);
}

/** Nothing but deck-building clauses ([Dragon Ball]-style keyword limits are the keyword skill's, not this). */
export function isDeckBuildingLine(reading: DeckBuildingReading): boolean {
  return reading.rules.some((r) => r.kind !== "keyword") && !reading.rest && reading.unread.length === 0;
}

/**
 * Known gaps found while closing #1005: each is a clause whose reading says
 * nothing at all and is not yet fixed. Shrink this list; never grow it.
 * Shared by `arena:readings --silent` and `arena:corpus` (#897).
 */
export const KNOWN_SILENT = new Set<string>([
  // ("When you activate this card, you can't activate {X} for the turn" — BT6-051, BT7-024, BT7-048, BT7-073, BT7-098,
  // BT8-063, BT8-087 — is read since audit-effects-1: the Extra's own once-per-name rule, `OWN_ACTIVATION`.)
  // ("This card can't be played from any area if/unless …" — BT9-078, BT9-079,
  // P-281, BT22-077 — is no longer skipped: `compileProhibition` reads the
  // "unless" form, and an "if" form it cannot read is reported unread.)
  // (BT13-084#20, BT14-074#10, BT18-003#20, BT20-017#0, BT20-019#0, BT25-133#20, BT4-003#40 — wordings no reader takes —
  // are reported unread since audit effects 2: `compileSkill` makes a silent blank unread, so none can hide here.)
]);
