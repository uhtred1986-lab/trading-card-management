/**
 * Keyword-owned lines (owner decision, 18 Oct 2026, from the deck audit #1050): a skill line that is a bare
 * keyword ([Barrier], [Blocker], [Swap 2], [Over Realm], a Union line ...) or a deck-building line ("you can
 * include up to 4 copies ...") compiles to NO program because the ENGINE (or the deck checker) is the rule.
 * Its stored reading is empty on purpose. What the owner can check is the glossary's description of what the
 * engine does with the keyword (`src/lib/arena/glossary.ts`), so that description is the "reading" shown for
 * such a row, and `confirm_rule` may confirm against it.
 *
 * Detected the way the compiler classifies the line (`parseSkills`: kind `keyword` with a keyword the glossary
 * documents; kind `permanent` whose text is a deck-building rule), from the CURRENT catalog text, never from
 * what the row says about itself. A row that is not keyword-owned and reads as nothing is still refused.
 */
import { KEYWORDS, SUPPORT_LABEL, keywordPlays } from "@/lib/arena/glossary";
import { parseSkills } from "@/lib/arena/text/cards";

export interface KeywordOwned {
  /** `keyword` for a keyword line, `deck-building` for a deck-construction line. */
  type: "keyword" | "deck-building";
  tag: string;
  /** What the rule says (glossary `meaning`), or the printed deck-building line. */
  rule: string;
  /** What the engine / the deck checker does with it (glossary `engineRules`). */
  engine: string;
  support: string;
}

/** "You can include up to 4 copies ...", "only include up to 4 cards with [Super Combo] in your deck", "as many copies ... as you like". */
const DECK_BUILDING = /\b(?:can|may)\s+(?:only\s+)?include\b|\binclude\s+(?:up to|as many)\b|\bin your (?:main )?deck\b|\bcopies of\b/i;

const DECK_ENGINE =
  "A deck-building rule, checked by the deck legality check (`src/lib/decks/cardRules.ts`): it labels an illegal deck, it never refuses one. Nothing happens during a game.";

export function keywordOwnedOf(
  card: { skill: string | null; backSkill: string | null },
  side: "front" | "back",
  skillIndex: number,
): KeywordOwned | null {
  const sk = parseSkills(side === "front" ? card.skill : card.backSkill).find((s) => s.index === skillIndex);
  if (!sk) return null;
  if (sk.kind === "keyword" && sk.keyword) {
    const plays = keywordPlays(sk.keyword.name);
    if (!plays) return null;
    const doc = KEYWORDS[sk.keyword.name];
    return { type: "keyword", tag: plays.tag, rule: doc.meaning, engine: plays.engine, support: SUPPORT_LABEL[plays.support] };
  }
  if (sk.kind === "permanent" && DECK_BUILDING.test(sk.effect)) {
    return { type: "deck-building", tag: "[Permanent] deck-building line", rule: sk.effect.trim(), engine: DECK_ENGINE, support: SUPPORT_LABEL.deck };
  }
  return null;
}

/** The glossary's engine paragraphs run long; the reading keeps the first sentences, the packet's `keywordOwned.engine` keeps all of it. */
function brief(text: string, max = 500): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return `${(stop > 120 ? cut.slice(0, stop + 1) : cut).trim()} (full description in keywordOwned.engine)`;
}

/** The one-paragraph reading shown in place of the empty stored one. */
export function keywordReading(k: KeywordOwned): string {
  return k.type === "keyword"
    ? `${k.tag} is a keyword the engine plays itself, so this line has no program. The rule: ${k.rule} What the engine does (${k.support}): ${brief(k.engine)}`
    : `Deck-building line, no program: ${k.rule} What happens (${k.support}): ${k.engine}`;
}
