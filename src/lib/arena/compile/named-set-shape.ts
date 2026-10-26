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
  { verb: "play", dest: "battle", required: false, rest: true, re: /^play (up to 1 each of .+?) in rest mode from ((?:your|their) (?:(?!\bwith\b).)+?)$/i },
  { verb: "play", dest: "battle", required: false, rest: true, re: /^play (up to 1 each of .+?) from ((?:your|their) (?:(?!\bwith\b).)+?) in rest mode$/i },
  // Phrasing batch 3: the same plays with the skills of the cards played negated for a span, and the plays of a pair
  // of names said one by one — "Play up to 1 <Son Goku: Xeno> and up to 1 <Vegeta: Xeno> card—both mono-black and
  // with an energy cost of 4 or less—from your deck in Rest Mode with their skills negated for the game" (BT24-123),
  // "play up to 1 each of <Son Goku> and <Vegeta> cards -- both black and with an energy cost of 1 -- from your Drop
  // in Rest Mode with their skills negated for the turn" (SD23-02), "play up to 1 red <Mai> card and up to 1 red <Shu>
  // card with energy costs of 2 from your deck" (BT10-020).
  { verb: "play", dest: "battle", required: false, rest: true, re: /^play (up to 1 .+?) in rest mode from ((?:your|their) .+?) with (?:their|its) skills negated for the (?:duration of the )?(turn|game)$/i },
  { verb: "play", dest: "battle", required: false, rest: true, re: /^play (up to 1 .+?) from ((?:your|their) .+?) in rest mode with (?:their|its) skills negated for the (?:duration of the )?(turn|game)$/i },
  { verb: "play", dest: "battle", required: false, rest: false, re: /^play (up to 1 .+?) from ((?:your|their) .+?) with (?:their|its) skills negated for the (?:duration of the )?(turn|game)$/i },
  { verb: "play", dest: "battle", required: false, rest: false, re: /^play (up to 1 .+?) from ((?:your|their) (?!.*\b(?:with|in rest mode|in active mode|into|to|on top)\b).+?)$/i },
  // Phrasing batch 3: the pair chosen, then played — "choose up to 1 green <Son Goten> card and 1 green <Trunks: Youth>
  // card with energy costs of 4 from your Drop Area and play them" (BT7-006), "choose up to 1 <Gravy> and 1 <Putine>
  // from your Deck and/or Warp and play them" (EX07-11) — and sent to the Warp: "send up to 1 {Android 20, Vengeful
  // Alliance} and 1 {Dr. Myuu, Vengeful Alliance} from your deck to your Warp" (BT20-054).
  { verb: "play", dest: "battle", required: false, rest: false, re: /^choose (up to 1 .+?) from ((?:your|their) (?:(?!\bwith\b).)+?) and play them$/i },
  { verb: "send", dest: "warp", required: false, re: /^send (up to 1 .+?) from ((?:your|their) .+?) to (?:your|their|its owner'?s?|their owners?'?) warps?$/i },
] as const;

export interface NamedSetWords {
  verb: "choose" | "place" | "add" | "play" | "send";
  /** Where every card taken goes: under this card, to the hand, played to the Battle Area, or (phrasing batch 3) to the Warp. */
  dest: "under" | "hand" | "battle" | "warp";
  /** A play "in Rest Mode". */
  rest?: boolean;
  /** Phrasing batch 3: a play "with their skills negated for the turn/game". */
  negated?: "turn" | "game";
  source: string;
  colour: string | null;
  /** True for "1 each of <A> and <B>": every slot is a card that must be had. */
  required: boolean;
  /** Each slot as "up to 1 [colour] <Name> card" (or "1 [colour] <Name> card" when `required`). */
  slots: string[];
}

/** The list cut at its commas and "and"s, outside the bracketed names. */
function listItems(list: string): string[] {
  // Phrasing batch 3: a name's own comma ("{Android 20, Vengeful Alliance}", BT20-054) is not where the list is cut.
  const names: string[] = [];
  const masked = list.replace(/\{[^{}]*\}/g, (m) => `{${names.push(m) - 1}}`);
  return masked.split(/\s*,\s*(?:and\s+)?|\s+and\s+/i).map((x) => x.trim().replace(/\{(\d+)\}/g, (m, i) => names[Number(i)] ?? m)).filter(Boolean);
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
    // Phrasing batch 3: "…with their skills negated for the turn/game", the span the played cards are negated for.
    const negated = shape.verb === "play" && m[3] ? { negated: m[3].toLowerCase() as "turn" | "game" } : {};
    let list = m[1].replace(/^up to /i, "");
    // "…and 1 <Bollarator> card―all red―": one colour for every slot. #930, EX23-11: "1 <Son Goku>
    // card and 1 <Vegeta> card―both blue and with 20000 power―" adds one power or energy-cost
    // measure, said once for both as the colour is. Phrasing batch 3: the colour may be a mono-colour
    // and the rest of the aside a list of what every card has — "both green, with an energy cost of 1,
    // and without [Super Combo]" (P-632), "both blue and skill-less" (BT25-061), "both mono-green,
    // with an energy cost of 5 and 20000 power" (BT31-041b) — the "each of" list's too (SD23-02).
    let colour: string | null = null;
    let measure = "";
    let adjective = "";
    // ("both with energy costs of 1", BT20-079, says no colour at all.)
    const aside = new RegExp(`\\s*${DASH}\\s*(?:all|both)\\s+(?:((?:mono-)?${COLOUR})|(?=with|without|skill-less))((?:,?\\s*(?:and\\s+)?(?:${ASIDE_PART}))*)\\s*,?\\s*${DASH}\\s*$`, "i").exec(list);
    if (aside) {
      colour = aside[1] ? aside[1].toLowerCase() : null;
      const parts = [...aside[2].matchAll(new RegExp(ASIDE_PART, "gi"))].map((x) => x[0].toLowerCase().trim());
      if (!parts.length && !colour) return null;
      adjective = parts.filter((p) => p === "skill-less").map((p) => `${p} `).join("");
      const withs = parts.filter((p) => p !== "skill-less").map((p) => p.replace(/^with energy costs of/, "with an energy cost of"));
      measure = withs.length ? ` ${withs.join(" and ")}` : "";
      list = list.slice(0, aside.index);
    }
    // "1 each of <A> and <B>": the "each of" says every name is one slot.
    if (shape.required) list = list.replace(/^1 each of /i, "1 ");
    else if (/^1 each of /i.test(list)) {
      const each = eachOfSlots(list);
      if (!each) return null;
      if (aside && (each.colour || /\bwith\b/i.test(each.slots[0]))) return null;
      const slots = aside ? each.slots.map((s) => s.replace(/^up to 1 /i, `up to 1 ${colour ? `${colour} ` : ""}${adjective}`).replace(/ card$/i, ` card${measure}`)) : each.slots;
      return { verb: shape.verb, dest: shape.dest, ...rest, ...negated, source: m[2].trim(), colour: colour ?? each.colour, required: false, slots };
    }
    if (DASH_ANYWHERE.test(list)) return null;
    // Phrasing batch 3: a measure printed once after the last name in the plural — "up to 1 red <Mai> card and up to 1
    // red <Shu> card **with energy costs of 2**" (BT10-020, BT10-022, BT10-024) — is every card's, as the dashes' is.
    const plural = !aside ? /\s+(with energy costs of \d+(?: or (?:less|more))?(?: and (?:the )?\[[^\]]+\](?: skill)?)?)$/i.exec(list) : null;
    if (plural) {
      measure = ` ${plural[1].toLowerCase().replace(/energy costs/, "an energy cost")}`;
      list = list.slice(0, plural.index);
    }
    // "1 <Android 14> and <Android 15> card" says "card" once, at the end.
    const items = listItems(list);
    // Phrasing batch 3: "Play up to 1 <Son Goku: GT> and up to 1 <Vegeta: GT> -- both mono-green, … --" (BT31-041b)
    // gives the cards no noun at all; the dashes' aside says what they are.
    // A list of names alone — "up to 1 <Gravy> and 1 <Putine>" (EX07-11) — names one card per name likewise.
    const noun = /\bcards?$/i.test(items[items.length - 1] ?? "") || items.every((x) => new RegExp(`^(?:up to )?(?:1 )?${NAME}$`, "i").test(x)) || (!!aside && items.every((x) => new RegExp(`${NAME}$`).test(x)));
    const raw = items.map((x) => ((shape.required || noun) && !/\bcards?$/i.test(x) ? `${x} card` : x));
    if (raw.length < 2 || raw.some((x) => !new RegExp(`^(?:up to )?(?:1 )?(?:(?:mono-)?${COLOUR} )?${NAME} cards?$`, "i").test(x))) return null;
    // Only the first slot says "up to 1"; every item is one named card. A colour in front of an
    // item (BT6-012) is that item's own and wins over the one the dashes give all of them.
    const slots = raw.map((x) => {
      const body = x.replace(/^(?:up to )?(?:1 )?/i, "").replace(/ cards$/i, " card");
      const own = new RegExp(`^((?:mono-)?${COLOUR}) `, "i").exec(body);
      const here = own ? own[1].toLowerCase() : colour;
      return `${shape.required ? "1" : "up to 1"} ${here ? `${here} ` : ""}${adjective}${own ? body.slice(own[0].length) : body}${measure}`;
    });
    // The same name twice would be one slot twice over.
    if (new Set(slots.map((x) => x.toLowerCase())).size !== slots.length) return null;
    return { verb: shape.verb, dest: shape.dest, ...rest, ...negated, source: m[2].trim(), colour, required: shape.required, slots };
  }
  return null;
}

/** Phrasing batch 3: one thing a "both <colour> …" aside says of every card — a measure, a keyword it lacks, or no skills. */
const ASIDE_PART = "with (?:an? )?(?:(?:original )?energy costs? of \\d+(?: or (?:less|more))?|\\d+ (?:or (?:less|more) )?power)(?: and \\d+ power)?|without \\[[^\\]]+\\]|skill-less";

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
  const start = new RegExp(`\\b(?:choose|place|add|play|send) (?:up to )?1 (?:each of )?(?:${COLOUR} )?${NAME}`, "gi");
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
