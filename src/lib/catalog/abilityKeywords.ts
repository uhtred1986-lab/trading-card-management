import { leadingTags } from "@/lib/decks/cardRules";
import { keywordOf } from "@/lib/arena/engine/cards";

/**
 * Keyword-ability tags a card carries on either face — "Blocker", "Critical",
 * "Double Strike" — as opposed to every bracketed token in its text (that's
 * `cards.keywords`, which also catches cards that merely name one) or a skill
 * type like "[Auto]"/"[Activate: Main]" (not a §22 keyword, so `keywordOf`
 * returns null for it and it's dropped here).
 */
export function abilityKeywordsOf(card: { skill?: string | null; backSkill?: string | null }): string[] {
  return [...leadingTags(card.skill), ...leadingTags(card.backSkill)].filter((t) => keywordOf(t) !== null);
}
