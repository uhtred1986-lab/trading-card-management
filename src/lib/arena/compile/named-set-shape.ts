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
  { verb: "choose", dest: "under", required: false, re: /^choose (up to 1 .+?) from ((?:your|their) .+?) and place them under this card$/i },
  { verb: "place", dest: "under", required: false, re: /^place (up to 1 .+?) from ((?:your|their) .+?) under this card$/i },
  { verb: "choose", dest: "under", required: true, re: /^choose (1 .+?) (?:from|in) ((?:your|their) .+?) and place them under this card$/i },
  { verb: "place", dest: "under", required: true, re: /^place (1 .+?) (?:from|in) ((?:your|their) .+?) under this card$/i },
  // #907 round 2: the same pair of names, taken to the hand. "Add up to 1 yellow <Son Goten: GT>
  // card and up to 1 yellow <Trunks: GT> card from your Drop Area to your hand" (BT10-111, BT10-112,
  // P-255, P-256) and "choose up to 1 red <Son Goku: Br> card and 1 red <Vegeta: Br> card from your
  // Drop Area and add them to your hand" (BT6-012, BT6-013, P-095, P-108). The colour sits in front of
  // each name here rather than once in a pair of dashes.
  { verb: "choose", dest: "hand", required: false, re: /^choose (up to 1 .+?) from ((?:your|their) .+?) and add them to your hand$/i },
  { verb: "add", dest: "hand", required: false, re: /^add (up to 1 .+?) from ((?:your|their) .+?) to your hand$/i },
  // #930: "Play up to 1 each of <Kale> and <Caulifla> cards with 9000 power in Rest Mode from your
  // Drop" (EX25-11): one "up to 1" slot per name (`eachOfSlots`), each played. "In Rest Mode" is
  // the mode they are played in, said before or after the place.
  { verb: "play", dest: "battle", required: false, rest: true, re: /^play (up to 1 each of .+?) in rest mode from ((?:your|their) .+?)$/i },
  { verb: "play", dest: "battle", required: false, rest: true, re: /^play (up to 1 each of .+?) from ((?:your|their) .+?) in rest mode$/i },
] as const;

export interface NamedSetWords {
  verb: "choose" | "place" | "add" | "play";
  /** Where every card taken goes: under this card, to the hand, or played to the Battle Area. */
  dest: "under" | "hand" | "battle";
  /** A play "in Rest Mode". */
  rest?: boolean;
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
  const said = clause
    .trim()
    .replace(/[.,]$/, "")
    .replace(/([―—–])(?=\S)/g, "$1 ")
    // #930, EX23-11: "…from among all cards in your deck and Drop to your hand" is a search of
    // those places ("among all cards" names no card of its own, as `saidTheShortWay` reads it),
    // and a plain "and" between two places is one choice across both (the "and/or" pair).
    .replace(/\bfrom among all (?:of )?(?:the )?cards in /i, "from ")
    .replace(new RegExp(`\\bfrom (your|their) (${AREA}) and (?:your |their )?(${AREA})\\b(?!/)`, "i"), "from $1 $2 and/or $3");
  for (const shape of SHAPES) {
    const m = shape.re.exec(said);
    if (!m) continue;
    const rest = "rest" in shape && shape.rest ? { rest: true } : {};
    let list = m[1].replace(/^up to /i, "");
    // "1 each of <A> and <B>": the "each of" says every name is one slot.
    if (shape.required) list = list.replace(/^1 each of /i, "1 ");
    else if (/^1 each of /i.test(list)) {
      const each = eachOfSlots(list);
      if (!each) return null;
      return { verb: shape.verb, dest: shape.dest, ...rest, source: m[2].trim(), colour: each.colour, required: false, slots: each.slots };
    }
    if (shape.verb === "play") return null;
    let colour: string | null = null;
    let measure = "";
    // "…and 1 <Bollarator> card―all red―": one colour for every slot. #930, EX23-11: "1 <Son Goku>
    // card and 1 <Vegeta> card―both blue and with 20000 power―" adds one power or energy-cost
    // measure, said once for both as the colour is.
    const aside = new RegExp(`\\s*${DASH}\\s*(?:all|both)\\s+(${COLOUR})(?:\\s+and\\s+(${MEASURE}))?\\s*${DASH}\\s*$`, "i").exec(list);
    if (aside) {
      colour = aside[1].toLowerCase();
      measure = aside[2] ? ` ${aside[2].toLowerCase()}` : "";
      list = list.slice(0, aside.index);
    }
    if (DASH_ANYWHERE.test(list)) return null;
    // "1 <Android 14> and <Android 15> card" says "card" once, at the end.
    const raw = listItems(list).map((x) => (shape.required && !/\bcards?$/i.test(x) ? `${x} card` : x));
    if (raw.length < 2 || raw.some((x) => !new RegExp(`^(?:up to )?(?:1 )?(?:${COLOUR} )?${NAME} cards?$`, "i").test(x))) return null;
    // Only the first slot says "up to 1"; every item is one named card. A colour in front of an
    // item (BT6-012) is that item's own and wins over the one the dashes give all of them.
    const slots = raw.map((x) => {
      const body = x.replace(/^(?:up to )?(?:1 )?/i, "");
      const own = new RegExp(`^(${COLOUR}) `, "i").exec(body);
      const here = own ? own[1].toLowerCase() : colour;
      return `${shape.required ? "1" : "up to 1"} ${here ? `${here} ` : ""}${own ? body.slice(own[0].length) : body}${measure}`;
    });
    // The same name twice would be one slot twice over.
    if (new Set(slots.map((x) => x.toLowerCase())).size !== slots.length) return null;
    return { verb: shape.verb, dest: shape.dest, source: m[2].trim(), colour, required: shape.required, slots };
  }
  return null;
}

const DASH_ANYWHERE = /[―—–]|--/;
/** A place a "from your A and B" pair names. */
const AREA = "(?:deck|drop(?: area)?|hand|warp|battle area|(?:z-)?energy(?: area)?|life)";
/** One power or energy-cost measure, as `eachOfSlots` reads it. */
const MEASURE = "with (?:an? )?(?:energy costs? of \\d+(?: or (?:less|more))?|\\d+ (?:or (?:less|more) )?power)";

/**
 * #930: "choose **up to 1 each of blue {Super Saiyan Son Goku} and {Super
 * Saiyan Vegeta} cards with energy costs of 2** from your deck and add them to
 * your hand" (BT5-037): one "up to 1" slot per name. **Labelled best guess**
 * (no manual rule or card FAQ found): the colour before the first name and the
 * measure after the last describe every name, as "cards" in the plural says.
 * Only a colour and an energy-cost or power measure are read; anything else
 * leaves the clause to the readers that refuse it.
 */
function eachOfSlots(list: string): { colour: string | null; slots: string[] } | null {
  const m = new RegExp(`^1 each of (?:(${COLOUR}) )?((?:${NAME},?\\s+)*(?:and\\s+)?${NAME})(?:\\s+cards?)?((?:\\s+with (?:an? )?(?:energy costs? of \\d+(?: or (?:less|more))?|\\d+ (?:or (?:less|more) )?power))?)$`, "i").exec(list.trim());
  if (!m) return null;
  const names = [...m[2].matchAll(new RegExp(NAME, "g"))].map((x) => x[0]);
  if (names.length < 2 || new Set(names.map((x) => x.toLowerCase())).size !== names.length) return null;
  const colour = m[1] ? m[1].toLowerCase() : null;
  return { colour, slots: names.map((n) => `up to 1 ${colour ? `${colour} ` : ""}${n} card${m[3]}`) };
}

/** Where in a skill's text a clause of this shape lies, for `splitClauses` to leave whole. */
export function namedSetSpans(text: string): [number, number][] {
  const out: [number, number][] = [];
  const start = new RegExp(`\\b(?:choose|place|add|play) (?:up to )?1 (?:each of )?(?:${COLOUR} )?${NAME}`, "gi");
  for (let m = start.exec(text); m; m = start.exec(text)) {
    for (let end = m.index + 1; end <= text.length; end++) {
      // #930, EX23-11: "…to your hand, shuffle your deck if you looked through it": a plain comma
      // ends the clause too (only where the words up to it are the whole shape).
      const stops = end === text.length || ".;,".includes(text[end]) || text.startsWith(" then ", end);
      if (!stops || !namedSetWords(text.slice(m.index, end))) continue;
      out.push([m.index, end]);
      start.lastIndex = end;
      break;
    }
  }
  return out;
}

const PLACE = "(?:drop area|warp|hand|energy area|life area|z-deck|battle area|combo area)";
// Only straight after the condition word: "if your Leader Card is a ≪Shenron≫ card and {Oolong's
// Wish} is in your Drop Area" (BT5-014) is a Leader test and a presence test, not a pair of names.
const PAIR_PRESENT = new RegExp(`(?<=\\b(?:if|when|while) )${NAME}(?: cards?)? and ${NAME}(?: cards?)? (?:are|is) in (?:play in )?your ${PLACE}\\b`, "gi");

/**
 * #907: "If <Android 14> and <Android 15> are in your Drop Area" (BT3-056),
 * "if <Kakunsa> and <Rozie> are in play in your Battle Area" (TB1-051b,
 * TB1-056, TB1-058, TB1-059): two named cards that must both be there. The
 * "and" is the condition's own, and `parseConditionClause` already reads the
 * pair (each name a count of at least one, both required), but `splitClauses`
 * cut the sentence at that "and" first, so it never arrived whole. Kept
 * together here, as the named-set gathers are.
 */
export function namedPairPresenceSpans(text: string): [number, number][] {
  // The span starts one character early: `splitClauses` skips what is strictly inside a span, and a
  // name's own "<" must be seen there to open (and its ">" to close) the bracket depth.
  return [...text.matchAll(PAIR_PRESENT)].map((m) => [m.index! - 1, m.index! + m[0].length] as [number, number]);
}
