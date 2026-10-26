/**
 * #907: "choose up to 1 <Koitsukai> card, 1 <Panchia> card, and 1 <Bollarator>
 * card―all red―from your hand, Battle Area, and/or Drop and place them under
 * this card" (BT20-007), "place up to 1 <Paparoni> card, 1 <Koitsukai> card, 1
 * <Panchia> card, and 1 <Bollarator> card―all red―from your Battle Area and/or
 * Drop under this card" (BT20-006).
 *
 * One `choose` per name, each "up to 1" red card of that name from the place
 * the text lists, and each a card of its own (`notIn`, as #970's sends: a
 * catalog card may carry more than one of the names). Then every card chosen
 * goes under this card. Until 18 Oct 2026 BT20-007 read as one in-play card
 * of the first name, one of the second and *every* red Bollarator, wherever
 * it was; BT20-006 was unread.
 *
 * **Labelled best guess.** "Up to 1" is printed once, before the list. The
 * manual (5-2-4 on "up to") and the card Q&A say nothing about how it carries
 * across a list, and the same words without it ("send 1 <Koitsukai> card, 1
 * <Panchia> card, and 1 <Bollarator> card", BT20-002b) ask for all three, so
 * the "up to" is read to apply to each name: you may take fewer than three
 * (the alternative, up to one card in all, would make the other two names
 * pointless). The dashes' "all red" is the colour of every card (a price that
 * the BT20 Universe 3 cards print the same way).
 */
import type { Op, Selector } from "../vm/script";
import { namedSetWords } from "./named-set-shape";
import type { Ctx } from "./shared";
import { parseTarget } from "./targets";

/**
 * The ops of one such clause, or `undefined` when the clause is not this shape
 * at all (the caller goes on), or `null` when it is but a slot cannot be read.
 */
export function compileNamedSet(clause: string, c: Ctx): Op[] | null | undefined {
  const words = namedSetWords(clause);
  if (!words) return undefined;
  const selectors: Selector[] = [];
  for (const slot of words.slots) {
    const sel = parseTarget(`${slot} from ${words.source}`);
    if (!sel || sel.special || sel.fromVar || sel.take != null || sel.filter?.unreadable || sel.count !== 1 || !!sel.upTo === words.required || (!sel.area && !sel.areas?.length)) return null;
    selectors.push(sel);
  }
  const first = selectors[0];
  const same = (a: Selector) => a.side === first.side && JSON.stringify(a.areas ?? a.area) === JSON.stringify(first.areas ?? first.area);
  if (!selectors.every(same)) return null;
  const vars = selectors.map(() => `c${c.n++}`);
  // #930: "1 each of <A> and <B>" is a required card per name. Each is chosen
  // and placed under this card before the next is asked, so the next one can
  // never be the same physical card (it has left the source), and a price made
  // of it is proven slot by slot on the strict price host (`notIn` links
  // choices across slots, which a keyword move's price may not carry).
  if (words.required) {
    return selectors.flatMap((sel, i): Op[] => [
      { op: "choose", sel, as: vars[i], reason: `${words.slots[i]} from ${words.source}, ${words.dest === "hand" ? "to add to your hand" : "to place under this card"}` },
      { op: "moveTo", target: { var: vars[i] }, to: words.dest as "hand" | "under" },
    ]);
  }
  const purpose = words.dest === "hand" ? "to add to your hand" : words.dest === "battle" ? `to play${words.rest ? " in Rest Mode" : ""}` : words.dest === "warp" ? "to send to the Warp" : "to place under this card";
  const chooses: Op[] = selectors.map((sel, i) => ({
    op: "choose",
    sel: { ...sel, ...(i ? { notIn: vars.slice(0, i) } : {}) },
    as: vars[i],
    reason: `${words.slots[i]} from ${words.source}, ${purpose}`,
  }));
  // #930, EX25-11: "play up to 1 each of <Kale> and <Caulifla> cards … in Rest Mode from your
  // Drop" — each chosen card is played (5-5), in Rest Mode when the words say so.
  const moves: Op[] = words.dest === "battle"
    ? vars.map((v) => ({ op: "play", target: { var: v }, ...(words.rest ? { mode: "rest" as const } : {}), ...(words.negated ? { negated: words.negated } : {}) }))
    : vars.map((v) => ({ op: "moveTo", target: { var: v }, to: words.dest as "hand" | "under" | "warp" }));
  return [...chooses, ...moves];
}
