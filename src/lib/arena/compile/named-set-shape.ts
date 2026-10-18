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

/** "choose LIST from SRC and place them under this card" and "place LIST from SRC under this card". */
const SHAPES = [
  { verb: "choose", re: /^choose (up to 1 .+?) from ((?:your|their) .+?) and place them under this card$/i },
  { verb: "place", re: /^place (up to 1 .+?) from ((?:your|their) .+?) under this card$/i },
] as const;

export interface NamedSetWords {
  verb: "choose" | "place";
  source: string;
  colour: string | null;
  /** Each slot as "up to 1 [colour] <Name> card". */
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
    let colour: string | null = null;
    // "…and 1 <Bollarator> card―all red―": one colour for every slot.
    const aside = new RegExp(`\\s*${DASH}\\s*(?:all|both)\\s+(${COLOUR})\\s*${DASH}\\s*$`, "i").exec(list);
    if (aside) {
      colour = aside[1].toLowerCase();
      list = list.slice(0, aside.index);
    }
    if (DASH_ANYWHERE.test(list)) return null;
    const raw = listItems(list);
    if (raw.length < 2 || raw.some((x) => !new RegExp(`^(?:1 )?${NAME} cards?$`, "i").test(x))) return null;
    // Only the first slot says "up to 1"; every item is one named card.
    const slots = raw.map((x) => `up to 1 ${colour ? `${colour} ` : ""}${x.replace(/^1 /, "")}`);
    // The same name twice would be one slot twice over.
    if (new Set(raw.map((x) => x.toLowerCase().replace(/^1 /, ""))).size !== raw.length) return null;
    return { verb: shape.verb, source: m[2].trim(), colour, slots };
  }
  return null;
}

const DASH_ANYWHERE = /[―—–]|--/;

/** Where in a skill's text a clause of this shape lies, for `splitClauses` to leave whole. */
export function namedSetSpans(text: string): [number, number][] {
  const out: [number, number][] = [];
  const start = new RegExp(`\\b(?:choose|place) up to 1 ${NAME}`, "gi");
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
