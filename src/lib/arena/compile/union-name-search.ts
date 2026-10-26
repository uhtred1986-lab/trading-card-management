/**
 * #930: a search for the characters the revealed card's [Union-Fusion] needs.
 *
 *  - EX13-14 front#10: "…then choose 1 card in your hand with a [union-fusion]
 *    skill and reveal it: **For each character name required for the revealed
 *    card's [union] skill, add up to 1 card with a matching character name and
 *    energy cost between 3 and 7 from your deck to your hand**, then shuffle
 *    your deck."
 *  - SD19-03 front#20: "…then reveal 1 card with [Union-Fusion] in your hand:
 *    **Add up to 1 Battle Card each from your deck and/or Drop to your hand,
 *    each with a character name that matches the [Union] skill conditions of
 *    the revealed card and an energy cost between 3 and 7**, then shuffle your
 *    deck if you looked through it."
 *
 * EX13-14: one `choose` of up to N cards per required name (`unionNameOf`,
 * bound to what the price revealed, with `eachUnionName`), each card filling a
 * name of its own. SD19-03: one `choose` of up to N per place listed — the
 * deck, then the Drop — each card with one of the required names (the same
 * name may come twice, once from each place). Then every card chosen goes to
 * the hand. The VM reads the names off the revealed card's typed
 * [Union-Fusion] material contract, matched exactly (2-10-1-1).
 *
 * **Owner rulings of 26 Oct 2026 (#930):** "up to 1" applies to each name
 * (EX13-14), so fewer may be taken; SD19-03's "up to 1 Battle Card **each**
 * from your deck and/or Drop" is one card per *place* (up to 1 from the deck
 * and up to 1 from the Drop); "a character name that matches the [Union]
 * skill conditions" asks only the character name, not the colour or other
 * words the revealed card prints beside it (the printed energy cost still
 * applies).
 *
 * Only these two wordings are read, only with "energy cost" measures and only
 * when the skill's price revealed the card; anything else stays unread.
 */
import type { Op } from "../vm/script";
import type { Ctx } from "./shared";
import { parseTarget } from "./targets";
import { unionNameSearchWords } from "./union-name-search-shape";

/**
 * The ops of one such clause, `undefined` when the clause is not this shape (the
 * caller goes on), or `null` when it is but cannot be read here.
 */
export function compileUnionNameSearch(clause: string, c: Ctx): Op[] | null | undefined {
  const w = unionNameSearchWords(clause);
  if (!w) return undefined;
  if (!c.priceRevealed) return null;
  const sel = parseTarget(`up to ${w.n} ${w.noun} with an ${w.measure} from ${w.source}`);
  if (!sel || sel.special || sel.fromVar || sel.take != null || !sel.filter || sel.filter.unreadable || sel.count !== w.n || !sel.upTo || (!sel.area && !sel.areas?.length)) return null;
  if ((sel.filter.characters ?? []).length || (sel.filter.costMin == null && sel.filter.costMax == null)) return null;
  const filter = { ...sel.filter, unionNameOf: c.priceRevealed };
  if (!w.perPlace) {
    const v = `c${c.n++}`;
    return [
      { op: "choose", sel: { ...sel, filter, eachUnionName: true }, as: v, reason: clause.trim() },
      { op: "moveTo", target: { var: v }, to: "hand" },
    ];
  }
  // "…each from your deck and/or Drop": a choice per place, which needs two places.
  const places = sel.areas ?? [];
  if (places.length < 2) return null;
  const { areas: _areas, ...one } = sel;
  void _areas;
  const vars = places.map(() => `c${c.n++}`);
  return [
    ...places.map((area, i): Op => ({ op: "choose", sel: { ...one, area, filter }, as: vars[i], reason: `${clause.trim()} (from your ${area})` })),
    ...vars.map((v): Op => ({ op: "moveTo", target: { var: v }, to: "hand" })),
  ];
}

