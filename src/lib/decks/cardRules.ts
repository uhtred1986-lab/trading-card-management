/**
 * Deck-building rules that are printed on the cards themselves.
 *
 * Two exist in this game, and both are pooled limits across a keyword rather
 * than the usual per-card 4:
 *
 *   [Dragon Ball]  "You can include as many copies of cards with [Dragon Ball]
 *                   in your deck as you like, as long as the total number
 *                   doesn't exceed 7."
 *   [Super Combo]  "You can only include up to 4 cards with [Super Combo] in
 *                   your deck."
 *
 * The first one also *lifts* the copy limit — six of one Dragon Ball is legal —
 * so without reading it a deck like that gets wrongly flagged.
 *
 * Rules are read from the text of the cards in the deck, so a future keyword
 * works without a code change; the two known ones are also listed as a
 * fallback for a deck whose Dragon Balls happen not to print the reminder.
 */

export interface KeywordDeckRule {
  /** The bracketed keyword, as printed: "Dragon Ball". */
  keyword: string;
  /** Most cards carrying it that a deck may contain, counted across copies. */
  max: number;
  /** True when the rule replaces the per-card copy limit rather than adding to it. */
  unlimitedCopies: boolean;
}

/** "as many copies … as long as the total number doesn't exceed 7" */
const POOLED_UNLIMITED = /include as many copies of cards with \[([^\]]+)\][^.]*?total number does\s?n[o']?t exceed (\d+)/i;
/** "only include up to 4 cards with [Super Combo] in your deck" */
const POOLED_CAPPED = /only include up to (\d+) cards? with \[([^\]]+)\]/i;

/** Known from the catalog; used when no card in the deck spells the rule out. */
export const KNOWN_RULES: KeywordDeckRule[] = [
  { keyword: "Dragon Ball", max: 7, unlimitedCopies: true },
  { keyword: "Super Combo", max: 4, unlimitedCopies: false },
];

export function parseDeckRules(skill: string | null | undefined): KeywordDeckRule[] {
  if (!skill) return [];
  const text = skill.replace(/\[br\]|<br\s*\/?>/gi, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[’‘]/g, "'");
  const found: KeywordDeckRule[] = [];
  const unlimited = POOLED_UNLIMITED.exec(text);
  if (unlimited) found.push({ keyword: titled(unlimited[1]), max: Number(unlimited[2]), unlimitedCopies: true });
  const capped = POOLED_CAPPED.exec(text);
  if (capped) found.push({ keyword: titled(capped[2]), max: Number(capped[1]), unlimitedCopies: false });
  return found;
}

/** Cards print the keyword in mixed case ("[super combo]"); compare on a normal form. */
export function sameKeyword(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function titled(raw: string): string {
  const clean = raw.trim();
  const known = KNOWN_RULES.find((r) => sameKeyword(r.keyword, clean));
  return known ? known.keyword : clean;
}

/**
 * The bracketed tags a card prints at the *head* of one of its text blocks —
 * "[Dragon Ball] (You can include…)", "[Activate: Main][Once per turn] …".
 *
 * This is what distinguishes carrying a keyword from merely naming one. The
 * catalog's own `keywords` column can't be used: it is a scrape of every
 * bracketed token in the text, so "Choose up to 1 [Dragon Ball] card from your
 * deck" lands Bulma (BT5-107) and the Shenron leader (SD7-01) in it too.
 */
export function leadingTags(skill: string | null | undefined): string[] {
  if (!skill) return [];
  const tags: string[] = [];
  for (const block of skill.replace(/<br\s*\/?>/gi, "[br]").split("[br]")) {
    const run = /^\s*((?:\[[^\]]+\]\s*)+)/.exec(block);
    if (!run) continue;
    for (const t of run[1].matchAll(/\[([^\]]+)\]/g)) tags.push(t[1].trim());
  }
  return tags;
}

/** Every rule in play for a set of cards, deduplicated, tightest limit winning. */
export function rulesFor(cards: { skill?: string | null }[]): KeywordDeckRule[] {
  const byKeyword = new Map<string, KeywordDeckRule>();
  for (const c of cards) {
    for (const rule of parseDeckRules(c.skill)) {
      const key = rule.keyword.toLowerCase();
      const seen = byKeyword.get(key);
      if (!seen || rule.max < seen.max) byKeyword.set(key, rule);
    }
  }
  // A deck can hold the keyword without any of its cards restating the rule.
  for (const rule of KNOWN_RULES) {
    const key = rule.keyword.toLowerCase();
    if (byKeyword.has(key)) continue;
    if (cards.some((c) => hasKeyword(c, rule.keyword))) byKeyword.set(key, rule);
  }
  return [...byKeyword.values()];
}

/**
 * Whether a card *carries* the keyword, rather than referring to one. Plenty of
 * cards fetch or count [Dragon Ball] cards without being one themselves.
 */
export function hasKeyword(card: { skill?: string | null }, keyword: string): boolean {
  return leadingTags(card.skill).some((t) => sameKeyword(t, keyword));
}
