/**
 * #907: the words of a "one card of each of these names" gather, without
 * reading any slot.
 *
 * "Choose up to 1 <Koitsukai> card, 1 <Panchia> card, and 1 <Bollarator>
 * card―all red―from your hand, Battle Area, and/or Drop and place them under
 * this card" (BT20-007) and "place up to 1 <Paparoni> card, 1 <Koitsukai>
 * card, 1 <Panchia> card, and 1 <Bollarator> card―all red―from your Battle
 * Area and/or Drop under this card" (BT20-006): a list of named cards with one
 * colour said once, in a pair of dashes, for all of them, and one place they
 * all come from. `splitClauses` has to know where such a clause lies so it
 * does not cut the list at its own commas and "and"s; `named-set.ts` reads the
 * slots. Kept apart for the reason `disjoint-shape.ts` is: reading a slot
 * needs `targets.ts`, which needs `clauses.ts`.
 */

const DASH = "(?:[―—–]|--)";
const NAME = "(?:<[^>]+>|≪[^≫]+≫|\\{[^}]+\\})";
const COLOUR = "(?:red|blue|green|yellow|black|white)";

/**
 * "choose LIST from SRC and place them under this card" and "place LIST from SRC under this card".
 *
 * `required` (#930): the list is not "up to 1" but "1 each of <A> and <B>"
 * (BT3-070 after its 2018-03-02 errata, BT3-020, BT3-022) or "1 <A> and <B>
 * card" / "1 <A> card and 1 <B> card" (EX06-19, BT9-044, BT17-052): every name
 * must be had, one card each, or the clause cannot be done (5-8-2-2 when it is
 * a price). The source may also be introduced by "in" (EX06-19, BT9-044).
 */
const SHAPES = [
  { verb: "choose", required: false, re: /^choose (up to 1 .+?) from ((?:your|their) .+?) and place them under this card$/i },
  { verb: "place", required: false, re: /^place (up to 1 .+?) from ((?:your|their) .+?) under this card$/i },
  { verb: "choose", required: true, re: /^choose (1 .+?) (?:from|in) ((?:your|their) .+?) and place them under this card$/i },
  { verb: "place", required: true, re: /^place (1 .+?) (?:from|in) ((?:your|their) .+?) under this card$/i },
] as const;

export interface NamedSetWords {
  verb: "choose" | "place";
  source: string;
  colour: string | null;
  /** True for "1 each of <A> and <B>": every slot is a card that must be had. */
  required: boolean;
  /** Each slot as "up to 1 [colour] <Name> card" (or "1 [colour] <Name> card" when `required`). */
  slots: string[];
}

/** The list cut at its commas and "and"s, outside the bracketed names. */
function listItems(list: string): string[] {
  return list.split(/\s*,\s*(?:and\s+)?|\s+and\s+/i).map((x) => x.trim()).filter(Boolean);
}

/** The words of a clause of this shape, or `null`. */
export function namedSetWords(clause: string): NamedSetWords | null {
  const said = clause.trim().replace(/[.]$/, "").replace(/([―—–])(?=\S)/g, "$1 ");
  for (const shape of SHAPES) {
    const m = shape.re.exec(said);
    if (!m) continue;
    let list = m[1].replace(/^up to /i, "");
    // "1 each of <A> and <B>": the "each of" says every name is one slot.
    if (shape.required) list = list.replace(/^1 each of /i, "1 ");
    let colour: string | null = null;
    // "…and 1 <Bollarator> card―all red―": one colour for every slot.
    const aside = new RegExp(`\\s*${DASH}\\s*(?:all|both)\\s+(${COLOUR})\\s*${DASH}\\s*$`, "i").exec(list);
    if (aside) {
      colour = aside[1].toLowerCase();
      list = list.slice(0, aside.index);
    }
    if (DASH_ANYWHERE.test(list)) return null;
    // "1 <Android 14> and <Android 15> card" says "card" once, at the end.
    const raw = listItems(list).map((x) => (shape.required && !/\bcards?$/i.test(x) ? `${x} card` : x));
    if (raw.length < 2 || raw.some((x) => !new RegExp(`^(?:1 )?${NAME} cards?$`, "i").test(x))) return null;
    // Only the first slot says "up to 1"; every item is one named card.
    const slots = raw.map((x) => `${shape.required ? "1" : "up to 1"} ${colour ? `${colour} ` : ""}${x.replace(/^1 /, "")}`);
    // The same name twice would be one slot twice over.
    if (new Set(raw.map((x) => x.toLowerCase().replace(/^1 /, ""))).size !== raw.length) return null;
    return { verb: shape.verb, source: m[2].trim(), colour, required: shape.required, slots };
  }
  return null;
}

const DASH_ANYWHERE = /[―—–]|--/;

/** Where in a skill's text a clause of this shape lies, for `splitClauses` to leave whole. */
export function namedSetSpans(text: string): [number, number][] {
  const out: [number, number][] = [];
  const start = new RegExp(`\\b(?:choose|place) (?:up to )?1 (?:each of )?${NAME}`, "gi");
  for (let m = start.exec(text); m; m = start.exec(text)) {
    for (let end = m.index + 1; end <= text.length; end++) {
      const stops = end === text.length || ".;".includes(text[end]) || text.startsWith(", and ", end) || text.startsWith(" then ", end);
      if (!stops || !namedSetWords(text.slice(m.index, end))) continue;
      out.push([m.index, end]);
      start.lastIndex = end;
      break;
    }
  }
  return out;
}
