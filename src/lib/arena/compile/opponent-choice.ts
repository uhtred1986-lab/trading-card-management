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
  const dest = DESTS.map(([re, to, opts]) => (re.test(words.dest) ? { to, opts } : null)).find(Boolean);
  if (!dest) return null;
  const selectors: Selector[] = [];
  for (const item of words.items) {
    const m = /^(up to )?(\d+) (?:cards? (?:in|from) their (.+)|of their (.+))$/.exec(item);
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
  if (selectors.length === 1 && only.area === "hand" && !only.upTo && !only.filter && typeof only.count === "number" && (dest.to === "drop" || dest.to === "warp")) {
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
