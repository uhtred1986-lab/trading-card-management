import type { Op, ScriptArea, Selector } from "../vm/script";
import { opponentChoiceWords } from "./opponent-choice-shape";
import type { Ctx } from "./shared";
import { parseTarget } from "./targets";

/**
 * Where "…and places them **<dest>**" puts the cards, and how. Each of these is
 * the clause the move patterns in `compileClause` read for a card already
 * chosen (`MOVES`); here the cards are the opponent's and so are the owners.
 */
const DESTS: [RegExp, ScriptArea, { position?: "top" | "bottom"; reveal?: boolean }][] = [
  [/^(?:in|into|to) (?:their|its owner'?s?|their owners?'?s?|the) drops?(?: area)?s?$/, "drop", { reveal: true }],
  [/^(?:to|in|into) (?:their|its owner'?s?|their owners?'?s?) warps?$/, "warp", {}],
  [/^(?:to|in|into) (?:their|its owner'?s?|their owners?'?s?) z-?energy(?: area)?$/, "zEnergy", {}],
  [/^(?:at|on) the bottom of (?:their|its owner'?s?|their owners?'?s?) decks?(?: in any order)?$/, "deck", { position: "bottom" }],
  [/^on (?:the )?top of (?:their|its owner'?s?|their owners?'?s?) decks?(?: in any order)?$/, "deck", { position: "top" }],
];

/**
 * "Your opponent chooses 2 cards in their hand and places them at the bottom of
 * their deck in any order" (BT10-045), "…and 2 of their Battle Cards, ignoring
 * [Barrier], and sends them to their owners' Warps" (BT14-129): the opponent
 * chooses from **their own** cards (the choice is theirs, as the first branch
 * of BT15-085 already is), each slot its own `choose`, and the cards go where
 * the sentence says. #1015.
 *
 * A lone hand card sent to the Drop or the Warp is the `discard` op, which both
 * engines already know how to ask the opponent for and show; anything else is a
 * choice per slot and a move per choice. The ops of a sentence it does not
 * read in full are `null` (the clause stays unread) and `undefined` when the
 * clause is not this shape at all.
 */
export function compileOpponentChoice(clause: string, c: Ctx, track: (o: Op) => void): Op[] | null | undefined {
  const words = opponentChoiceWords(clause);
  if (!words) return undefined;
  // A count that is a board reading ("a number of cards … equal to …", BT2-046): no `choose` takes it.
  if (words.unread) return null;
  // "…and places them in their Drop Area" is said "discards the rest" with no place at all.
  const dest = DESTS.map(([re, to, opts]) => (re.test(words.rest && !words.dest ? "in their drop area" : words.dest) ? { to, opts } : null)).find(Boolean);
  if (!dest) return null;
  // "…places them in their Drop Area until they have 12 cards in hand" (BT7-105): the excess over
  // 12, which is nothing when the hand is not over it. Only the Drop and the Warp are a discard;
  // "shuffle them into their deck" (BT9-108) would need a count a `choose` cannot take.
  if (words.until !== undefined) {
    if (dest.to !== "drop" && dest.to !== "warp") return null;
    const hand: Selector = { side: "opponent", area: "hand" };
    return [
      {
        op: "if",
        cond: { kind: "count", sel: hand, atLeast: words.until + 1 },
        then: [{ op: "discard", n: { plus: [{ count: hand }, -words.until] }, side: "opponent", ...(dest.to === "warp" ? { to: "warp" as const } : {}) }],
      },
    ];
  }
  // "…chooses 5 cards in their hand and adds the rest to their Z-Energy" (BT20-148), "…chooses 6
  // cards in their hand, discards the rest" (BT12-059): the opponent chooses what they keep, and
  // everything else in the hand goes. Two choices, the second the rest of the hand, one move.
  if (words.rest) {
    const m = /^(\d+) cards? (?:in|from) their hand$/.exec(words.items[0]);
    if (!m) return null;
    const keep = `c${c.n++}`;
    const gone = `c${c.n++}`;
    // The rest is "all" (count 99) and taken without a question; `minCount: 99` keeps it out of the
    // disjoint matching (`plainSlot`), which would otherwise demand 99 cards for it and leave the
    // first choice nothing to offer. A hand of fewer is simply taken whole (5-2-5).
    const choose: Op[] = [
      { op: "choose", sel: { side: "opponent", area: "hand", count: Number(m[1]) }, as: keep, chooser: "opponent", reason: `keep ${words.items[0]}` },
      { op: "choose", sel: { side: "opponent", area: "hand", count: 99, minCount: 99, notIn: [keep] }, as: gone, reason: "the rest of their hand" },
    ];
    for (const o of choose) track(o);
    return [...choose, { op: "moveTo", target: { var: gone }, to: dest.to, ...dest.opts }];
  }
  const selectors: Selector[] = [];
  for (const item of words.items) {
    if (item === "all of the cards in their hand") {
      selectors.push({ side: "opponent", area: "hand", count: 99 });
      continue;
    }
    const m =/^(up to )?(\d+) (?:cards? (?:in|from) their (.+)|of their (.+))$/.exec(item);
    if (!m) return null;
    // Cards of the hand: no description to read, so the selector is the plain one.
    if (m[3] !== undefined && m[3] === "hand") {
      selectors.push({ side: "opponent", area: "hand", count: Number(m[2]), ...(m[1] ? { upTo: true } : {}) });
      continue;
    }
    const said = m[3] !== undefined ? `${m[1] ?? ""}${m[2]} ${Number(m[2]) === 1 ? "card" : "cards"} in your opponent's ${m[3]}` : `${m[1] ?? ""}${m[2]} of your opponent's ${m[4]}`;
    const sel = parseTarget(said);
    // Their own cards, a plain description: a selector that points back at a
    // variable, the printing card, or "the top N" is some other sentence.
    if (!sel || sel.side !== "opponent" || sel.fromVar || sel.special || sel.take != null || sel.filter?.unreadable || (!sel.area && !sel.areas?.length)) return null;
    selectors.push(words.ignoresBarrier && sel.area === "battle" ? { ...sel, ignoreBarrier: true } : sel);
  }
  const only = selectors[0];
  // The long-standing reading of a lone card chosen from the hand.
  if (selectors.length === 1 && only.area === "hand" && !only.upTo && !only.filter && typeof only.count === "number" && only.count < 99 && (dest.to === "drop" || dest.to === "warp")) {
    return [{ op: "discard", n: only.count, side: "opponent", ...(dest.to === "warp" ? { to: "warp" as const } : {}) }];
  }
  const out: Op[] = [];
  for (const [i, sel] of selectors.entries()) {
    const v = `c${c.n++}`;
    const blind = dest.to === "drop" && sel.area === "life";
    const choose: Op = { op: "choose", sel, as: v, chooser: "opponent", reason: words.items[i], ...(blind ? { blind: true as const } : {}) };
    out.push(choose);
    track(choose);
  }
  for (const o of [...out]) {
    if (o.op === "choose") out.push({ op: "moveTo", target: { var: o.as }, to: dest.to, ...dest.opts });
  }
  return out;
}
