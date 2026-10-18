/**
 * #1015: the words of "**your opponent chooses** <their cards> **and places /
 * sends them** <somewhere>", without reading any card.
 *
 * "Your opponent chooses 2 cards in their hand and places them at the bottom of
 * their deck in any order" (BT10-045), "…chooses 1 card in their hand and sends
 * it to their Warp" (BT10-134, BT7-114 …), "…chooses 2 cards in their hand and 2
 * of their Battle Cards, ignoring [Barrier], and sends them to their owners'
 * Warps" (BT14-129, BT10-154, BT18-133), "…chooses 1 of their Battle Cards and 1
 * of their energy and places them at the bottom of their owners' decks"
 * (BT11-049): one act of one player, said as a choice and a move. Cut at its
 * "and"s, the choice of cards in the hand became a *discard* (to the Drop,
 * whatever the card said), the other half of the list was chosen by the wrong
 * player or not moved at all, and the move itself was left unread.
 * `splitClauses` has to know where such a sentence lies so it does not cut the
 * list; `effects.ts` (`compileOpponentChoice`) reads the slots. Kept apart for
 * the reason `disjoint-shape.ts` is: reading a slot needs `targets.ts`, which
 * needs `clauses.ts`.
 */

/** One counted piece of the list: "2 cards in their hand", "1 of their Battle Cards with …", "up to 1 of their energy". */
const ITEM = String.raw`(?:up to )?\d+ (?:cards? (?:in|from) their [a-z -]+?|of their [^,]+?)`;

const SHAPE = new RegExp(
  String.raw`^(?:your opponent|they) chooses? (${ITEM}(?: and ${ITEM})*)(,? ignoring \[barrier\])?,? and (places?|sends?|puts?) (it|them) (.+?)$`,
  "i",
);

export interface OpponentChoiceWords {
  /** Each slot as "[up to ]N cards in their <area>" or "[up to ]N of their <description>". */
  items: string[];
  ignoresBarrier: boolean;
  /** What follows "them": "at the bottom of their deck in any order", "to their owners' Warps". */
  dest: string;
}

/** The words of a clause of this shape, or `null`. */
export function opponentChoiceWords(clause: string): OpponentChoiceWords | null {
  const m = SHAPE.exec(clause.trim().replace(/[.]$/, ""));
  if (!m) return null;
  const items = m[1].split(/ and (?=(?:up to )?\d+ )/i).map((x) => x.trim());
  // "it" is one card and "them" at least two (or a list of more than one slot):
  // "chooses 2 cards … and places it" is some other sentence.
  const one = items.length === 1 && /^(?:up to )?1 /i.test(items[0]);
  if (one !== (m[4].toLowerCase() === "it")) return null;
  return { items, ignoresBarrier: !!m[2], dest: m[5].trim() };
}

/** Where in a skill's text a sentence of this shape lies, for `splitClauses` to leave whole. */
export function opponentChoiceSpans(text: string): [number, number][] {
  const out: [number, number][] = [];
  const start = /\b(?:your opponent|they) chooses? (?:up to )?\d+ /gi;
  for (let m = start.exec(text); m; m = start.exec(text)) {
    for (let end = m.index + 1; end <= text.length; end++) {
      const stops = end === text.length || ".;".includes(text[end]) || text.startsWith(", and ", end) || text.startsWith(", then ", end) || text.startsWith(" then ", end);
      if (!stops || !opponentChoiceWords(text.slice(m.index, end))) continue;
      out.push([m.index, end]);
      start.lastIndex = end;
      break;
    }
  }
  return out;
}
