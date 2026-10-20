import { emptyFilter, parseFilter, type CardFilter } from "../text/filters";
import type { Cond, Ref, ScriptArea, Selector } from "../vm/script";
import { compileAction, joints } from "./prices";
import { colorCountSelector, filterFor, parseTarget } from "./targets";

/**
 * A price, or the head of one, read as the one or more conditions it states.
 *
 * Cut at every joint first and read the pieces: the patterns below all end in
 * a greedy tail, so "your Leader Card is red, you have 2 or more energy" read
 * whole is one condition about a leader that is "red, you have 2 or more
 * energy" — and the second requirement is gone. The whole is only read when
 * the pieces do not, which is what keeps "a red and blue card" together.
 */
export function allConditions(printed: string): { cond: Cond; subject?: Ref }[] | null {
  const head = foldBothQualifier(printed);
  // #966: "… and―A, or B, or C" is the first half AND one of A, B or C.
  if (hasDashConjunction(head)) {
    const dashed = dashConjunction(head);
    return dashed ? dashed.map((cond) => ({ cond })) : null;
  }
  const parts = joints(head);
  if (parts.length) {
    const conds: { cond: Cond; subject?: Ref }[] = [];
    let from = 0;
    let leader = "";
    for (const j of [...parts, { at: head.length, len: 0 }]) {
      const piece = head
        .slice(from, j.at)
        .replace(/[\s,]+$/, "")
        .trim();
      // #961: "if your Leader is blue, **has <Gotenks> in its character name**,
      // and …" lists several properties of the same Leader; the later pieces
      // arrive without a subject. Carry the Leader of the piece before.
      const own = /^(?:(?:if|when|while)\s+)?(your|your opponent's) leader\b/i.exec(piece);
      const continued = leader && /^has .+ in its (?:special traits?|card name|character names?)$/i.test(piece);
      const got = (continued ? parseConditionClause(`${leader} leader ${piece}`, true) : null) ?? parseConditionClause(piece, true);
      if (own) leader = own[1].toLowerCase();
      else if (!continued) leader = "";
      if (!got) {
        conds.length = 0;
        break;
      }
      conds.push(got);
      from = j.at + j.len;
    }
    if (conds.length) return conds;
  }
  // The pieces did not read, so the whole is tried after all: plenty of single
  // conditions carry an "and" or a comma of their own — "you and your opponent
  // have a total of 8 or less life", "at least 1 <Recoome>, <Jeice>, <Burter>,
  // and <Guldo> card in play" — and cutting those up loses 291 skills to save
  // the few the `charged` guard already refuses.
  // #926: the same guard at the comma. "Your Leader is a green <Zamasu> card,
  // you draw 1 card" (BT26-084) read whole is one Leader description with the
  // draw swallowed by its greedy tail — a price charged in part, which is a
  // free draw. A piece after the first that reads as an action is the price's
  // action half, so the whole is no condition at all.
  if (parts.some((j, i) => readsAsAction(head.slice(j.at + j.len, parts[i + 1]?.at ?? head.length).replace(/[\s,]+$/, "").trim()))) return null;
  const whole = parseConditionClause(head, true);
  return whole ? [whole] : null;
}

/**
 * True when a piece of price text reads as an *action* the player takes to pay
 * (4-3-3) rather than something that has to be true (9-1-3).
 *
 * Asked one level deep only: a probe runs the whole compiler, which asks
 * questions about conditions of its own, and a probe inside a probe would be
 * answering one nobody asked.
 */
let probing = false;
/**
 * "your deck or hand", "your hand, energy, or Drop Area": the areas a combo
 * card is said to come from, as the names the engine keeps (`comboFrom`). Only
 * the player's own areas, each named once; anything else is not read.
 */
const COMBO_SOURCE_AREAS: Record<string, ScriptArea> = {
  hand: "hand", deck: "deck", drop: "drop", "drop area": "drop", warp: "warp", life: "life", "life area": "life",
  energy: "energy", "energy area": "energy", "battle area": "battle", "z-energy": "zEnergy", "z-energy area": "zEnergy",
};
function comboSourceAreas(said: string): ScriptArea[] | null {
  const parts = said.trim().split(/\s*,\s*(?:and\/or |or |and )?|\s+(?:and\/or|or)\s+/).filter(Boolean);
  const out: ScriptArea[] = [];
  for (const part of parts) {
    const area = COMBO_SOURCE_AREAS[part.replace(/^your\s+/, "").trim()];
    if (!area || out.includes(area)) return null;
    out.push(area);
  }
  return out.length ? out : null;
}

function readsAsAction(said: string): boolean {
  if (probing || !said) return false;
  probing = true;
  try {
    return (
      compileAction(said, {
        kind: "activate:main",
        index: 0,
        tags: [],
        keyword: null,
        cost: "",
        effect: said,
        raw: said,
        oncePerTurn: false,
        limit: null,
        bond: null,
        sparking: null,
        burst: null,
        spiritBoost: null,
        markerCost: null,
        energyCost: {},
        energyEither: [],
      }) !== null
    );
  } finally {
    probing = false;
  }
}

const COLOR_WORD = "(?:red|blue|green|yellow|black|colorless)";
/** One whole card name or character name in the text: `{Card Name}` or `<Character>`. */
const NAMED_CARD = "(?:<[^>]+>|\\{[^}]+\\})";
const COLOR_NAMES_PATTERN = "(?:an?\\s+)?(?:red|blue|green|yellow|black|colorless)";
const AREA_NAMES_PATTERN = "(?:(?:your|your opponent's|the|an?)\\s+)?(?:hand|deck|drop|warp|life|battle|unison|energy|leader|combo|play|z-deck|z-energy|zdeck|zenergy)(?: area)?";

function filterIsBlank(f: CardFilter): boolean {
  return JSON.stringify(f) === JSON.stringify(emptyFilter());
}

/**
 * "…is a green <King Piccolo> or <Piccolo Jr.> card with an original power of
 * 15000" (BT18-082, BT18-085, P-704 …): the colour in front of the first name and
 * the measure after the noun belong to **both** names - one description with two
 * names that either will do (the rule `parseFilter` already has for "<A> or <B>
 * card"). Cut at the "or" the colour stayed on the first name and the power on the
 * second, a Leader of the wrong colour or power passing for either. Only when every
 * part but the last is a bare name (optionally behind a colour), the last starts with
 * a name and no later part brings a colour of its own, and the qualifier is really
 * shared - a colour in front, or a measure after the noun; "<A> or <B> card" alone
 * keeps its two-alternative reading.
 */
function namesShareQualifiers(parts: string[]): boolean {
  const mask = (p: string) => p.trim().toLowerCase().replace(/<[^>]*>|≪[^≫]*≫|\{[^}]*\}/g, "N");
  const masked = parts.map(mask);
  const colour = `(?:${COLOR_WORD}|mono-?${COLOR_WORD}|multi-?colou?r)`;
  const bare = new RegExp(`^(?:an?\\s+)?(?:${colour}\\s+)?N$`);
  const last = masked[masked.length - 1];
  if (!masked.slice(0, -1).every((p) => bare.test(p))) return false;
  if (!/^N\b/.test(last) || new RegExp(`\\b${colour}\\b`).test(last.replace(/\bcolou?rless\b/, ""))) return false;
  const colourInFront = new RegExp(`^(?:an?\\s+)?${colour}\\s`).test(masked[0]);
  const measureAfter = /\bcards?\s+(?:with|that|whose)\b/.test(last);
  return colourInFront || measureAfter;
}

/** An "or" alternative of a Leader description that names nothing (#990): the part was not read. */
const hasBlankPart = (parts: string[]): boolean => parts.some((p) => filterIsBlank(parseFilter(p)));

export function splitDisjunction(text: string, opts: { measured?: boolean } = {}): string[] {
  const regex = /(?:,\s+)?\bor\b/gi;
  let match: RegExpExecArray | null;
  const splitIndices: { start: number; end: number }[] = [];

  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(0, match.index).trim();
    const after = text.slice(match.index + match[0].length).trim();

    // "10000 power or less" (#990) is as much one bound as "10000 or less": the
    // number is followed by what it measures, so the digit test alone cut
    // "≪X≫-only card with 10000 power or less" in two and left "less" as an
    // alternative of its own, a filter that matches every Leader. No condition
    // starts with "more"/"less"/"fewer", so the "or" before one ends a
    // comparison. Asked for by the Leader descriptions only (`measured`), so
    // no other clause's reading moves with it.
    if ((opts.measured ? /\d+(?:\s+[a-z-]+){0,2}\s*$/i : /\d+\s*$/i).test(before) && /^(?:more|less|fewer)\b/i.test(after)) {
      continue;
    }
    // "and/or" is one word: it joins the areas of a single description ("in
    // your energy, Z-Energy, Battle Area, and/or Drop", #915), not two
    // conditions. Cut at its "or" the description lost its last area.
    if (/and\/$/i.test(before)) {
      continue;
    }
    if (new RegExp(COLOR_NAMES_PATTERN + "$", "i").test(before) && new RegExp("^" + COLOR_NAMES_PATTERN, "i").test(after)) {
      continue;
    }
    if (new RegExp(AREA_NAMES_PATTERN + "$", "i").test(before) && new RegExp("^" + AREA_NAMES_PATTERN, "i").test(after)) {
      continue;
    }
    splitIndices.push({ start: match.index, end: match.index + match[0].length });
  }

  if (splitIndices.length === 0) return [text];

  const parts: string[] = [];
  let lastIndex = 0;
  for (const idx of splitIndices) {
    parts.push(text.slice(lastIndex, idx.start).trim());
    lastIndex = idx.end;
  }
  parts.push(text.slice(lastIndex).trim());
  return parts.filter((p) => p.length > 0);
}

/**
 * #961: the description after "your Leader is" runs to the end of the text, and
 * `parseFilter` takes what it knows from it and ignores the rest. "…is blue or
 * yellow **and 3 or more blue and/or yellow cards are in your Combo Area**"
 * (BT19-145) and "…is blue, has <Gotenks> in its character name, **and you
 * send 1 blue card … to your Warp**" (P-441) both came back as a Leader
 * colour, the second requirement or the whole price quietly gone — a card
 * offered more cheaply than printed. A Leader description names colours,
 * traits and names; a verb, a second subject or a count after a joint is
 * another clause, and the whole is then no Leader condition at all.
 */
function leaderTailHoldsAClause(tail: string): boolean {
  // "…is green **or is** a black <Announcer> card" (P-525, P-526) and "…is green
  // **or has** <GT> in its character name" (BT31-049) restate the Leader
  // description for the next alternative: the verb belongs to the disjunction
  // (`splitDisjunction` cuts at the "or"), it is not a clause of its own. A verb
  // that follows a comma or "and" still is one, so those stay refused.
  const bare = tail.replace(/<[^>]*>|≪[^≫]*≫|\{[^}]*\}/g, "x").replace(/\bor\s+(?:is|has)\b/g, "or");
  return /\b(?:is|are|has|have|had|you|your|there|send|place|choose|discard|return|put|switch|remove|draw|add|play|activate)\b/.test(bare) || /(?:,|\band\b|\bor\b)\s+(?:at least\s+)?\d/.test(bare);
}

/**
 * Set when `parseCountCondition` refused a count on purpose (#915). A compound
 * ("if your Leader is green or yellow **and you have a total of 2 or more
 * green and/or yellow cards in your Combo Area**") must then be refused whole:
 * cut at its "and", the Leader half read on alone and the count vanished.
 */
let countRefused = false;
const refuseCount = (): null => {
  countRefused = true;
  return null;
};

/**
 * #966: the dash Bandai prints inside a sentence, however the feed spelled it:
 * an em dash, a horizontal bar, an en dash, a doubled hyphen, or the "?" a
 * mis-decoded dash left behind.
 */
const DASH = "(?:[—―–]|--|\\?)";

const COLOUR_QUALIFIER = "(?:mono-)?(?:red|blue|green|yellow|black|white)";
const CARD_NAME = "(?:<[^>]+>|≪[^≫]+≫|\\{[^}]+\\})";
const BOTH_QUALIFIER = new RegExp(
  `\\b(is|are)\\s+(an?\\s+)?(${CARD_NAME}(?:(?:\\s*,\\s*(?:or\\s+)?|\\s+or\\s+)${CARD_NAME})*)\\s+(cards?)\\s*${DASH}\\s*(?:both|all)\\s+(${COLOUR_QUALIFIER})\\s*${DASH}\\s*(?:((?:and|or)\\b|[,:.])|($)|(?=\\S))`,
  "gi",
);

/**
 * #966: "if your Leader is a <Majin Buu> or <Evil Wizard Babidi> card**—both
 * yellow—**and you have 4 or more energy" (BT20-091, -096, -097, -106 to -109,
 * SD22-05, SD22-06, P-492 …). The dashes carry one colour that holds for
 * *every* name in the list, so the colour moves in front of the list and the
 * sentence reads as the ordinary Leader description it is: "is a yellow
 * <Majin Buu> or <Evil Wizard Babidi> card and …". Only a bare colour (or
 * mono-colour) qualifies; a qualifier that says more ("both red and with
 * [EX-Evolve]") is not touched, so its line stays unread rather than losing the
 * extra requirement.
 */
export function foldBothQualifier(text: string): string {
  return text
    .replace(BOTH_QUALIFIER, (_whole, verb: string, article: string | undefined, names: string, noun: string, colour: string, token: string | undefined, end: string | undefined) => {
      // The colour goes in front of *each* name: the alternatives are cut apart
      // at their "or" later, and a colour written once would qualify only the
      // first of them — a Leader of any colour named <Vegeta> would qualify.
      const each = names.replace(new RegExp(CARD_NAME, "g"), (name) => `${colour.toLowerCase()} ${name}`);
      // What follows the closing dash: "and", "or" or punctuation is kept; the
      // end of the text needs nothing; anything else ("—both yellow—you have 2
      // or more energy", BT20-103) was a list item and gets its comma back.
      const after = token !== undefined ? (/^[,:.]/.test(token) ? token : ` ${token}`) : end !== undefined ? "" : ", ";
      return `${verb} ${article ?? "a "}${each} ${noun}${after}`;
    })
    .replace(/,?\s+and if\s+/gi, " and ")
    .replace(/\s+or if\s+/gi, " or ");
}

/**
 * #966: "if your Leader is red **and―**your Leader is a Z-Leader, or you have 2
 * or more Z-Energy, or you have a Z-Battle Card in play" (BT19-028 and the other
 * combo-draw cards of BT19, BT20 and BT27, P-482). The dash after "and" opens a
 * list of alternatives that, as a whole, is the second requirement: the Leader
 * colour *and* (a Z-Leader, *or* 2 Z-Energy, *or* a Z-Battle Card). Read without
 * the dash, the "or"s bind to the whole sentence and the colour becomes one more
 * alternative — a card that draws for any Z-Energy owner whatever their Leader.
 */
function splitDashConjunction(text: string): { left: string; right: string } | null {
  const m = new RegExp(`^(.+?)[\\s,]+and\\s*${DASH}\\s*(.*)$`, "i").exec(text.trim());
  return m ? { left: m[1].trim(), right: m[2].trim() } : null;
}

const hasDashConjunction = (text: string): boolean => splitDashConjunction(text) !== null;

/** The right-hand side of a dash conjunction: alternatives, the subject of one carried to a bare next. */
function dashAlternatives(right: string): Cond | null {
  const parts = splitDisjunction(right.toLowerCase());
  const conds: Cond[] = [];
  let subject = "";
  for (const raw of parts) {
    let part = raw.trim();
    // "you have 2 or more Z-Energy **or a Z-Battle Card in play**" (BT20-129).
    if (subject && !/^(?:you|your|there|it'?s|it is|this|all|a player|neither)\b/.test(part)) part = `${subject} ${part}`;
    const got = parseConditionClause(part, true);
    if (!got) return null;
    conds.push(got.cond);
    subject = /^(you have|your opponent has)\b/.exec(part)?.[1] ?? "";
  }
  if (!conds.length) return null;
  return conds.length === 1 ? conds[0] : { kind: "any", conds };
}

/** A dash conjunction read whole: the conditions before the dash, then the alternatives after it as one more. Null when any side does not read. */
function dashConjunction(text: string): Cond[] | null {
  const split = splitDashConjunction(text);
  if (!split) return null;
  const left = allConditions(split.left);
  const right = dashAlternatives(split.right);
  return left && right ? [...left.map((x) => x.cond), right] : null;
}

export function parseConditionClause(clause: string, allowBare = false): { cond: Cond; subject?: Ref } | null {
  // #966: a dash after "and" or a "both <colour>" qualifier (see above), read
  // before anything below cuts the sentence at its "and"s and "or"s.
  const folded = foldBothQualifier(clause);
  if (hasDashConjunction(folded) && (allowBare || /^\s*(?:if|when|while|during)\s/i.test(folded))) {
    const dashed = dashConjunction(folded.replace(/^\s*(?:if|when|while|during)\s+/i, ""));
    return dashed ? { cond: dashed.length === 1 ? dashed[0] : { kind: "all", conds: dashed } } : null;
  }
  clause = folded;
  // "blue **and/or** yellow cards" (BT19-145) is the cards of either colour
  // counted together, which "blue or yellow cards" already says. Only between
  // two colours: the slash splits any other pair into garbage (#961).
  const trimmed = clause
    .toLowerCase()
    .trim()
    .replace(new RegExp(`\\b(${COLOR_WORD})\\s+and/or\\s+(?=${COLOR_WORD}\\b)`, "g"), "$1 or ");
  // "During your turn" is a condition too, and reads as one everywhere else in
  // the text. The delay phrases ("during your opponent's *next* turn") are
  // matched before this is reached, so they are not caught here.
  // "If your have 2 or more ≪Saiyan≫ cards in your Warp" (BT27-015) is a misprint of "you".
  const t = trimmed.replace(/^(?:if|when|while|during)\s+/, "").replace(/^your have /, "you have ");
  // "if your Leader Card is yellow and your life is at 4 or less" splits on the
  // "and", so the second half arrives without a condition word in front of it.
  // It only counts as a condition when it continues one (9-1-3).
  if (t === trimmed && !allowBare) return null;
  // "When you've sent 7 or more cards to your Warp, reduce the energy cost of this card in your hand and Warp by 1" (SD3-04, deck
  // audit 18 Oct 2026): LABELLED BEST GUESS. No manual rule, errata or official Q&A covers it (card FAQ searched 18 Oct 2026); the
  // cards the game puts in the Warp stay there, so "have sent N or more to your Warp" is read as "N or more cards are in your Warp".
  // The one card printing it is the only user; the engine keeps no count of cards ever sent.
  const sentToWarp = /^you(?:'ve| have) sent (\d+) or more cards to your warp$/.exec(t.replace(/’/g, "'"));
  if (sentToWarp) return parseConditionClause(`if there are ${sentToWarp[1]} or more cards in your warp`, true);
  // Only as a whole condition: as one part of an "and" chain (BT20-078's "this card and {X} are in your Warp") a
  // single name would be read without the part the chain split off. A pair of names is whole in itself.
  const shaped = costConditionShape(t, allowBare);
  if (shaped !== undefined) return shaped;
  // #907 round 4: "if there is at least 1 <Son Goten>, <Trunks: Youth>, and <Videl> card in your Drop Area"
  // (BT7-054), "if you have at least 1 <Recoome>, <Jeice>, <Burter>, and <Guldo> card in play" (BT10-076),
  // "if you have 1 or more <Shroom> and <Salsa> card in your Combo Area" (EX23-42): one card of EACH name,
  // as the pair "<A> and <B> are in your Drop Area" already is - not one card that is any of them, which
  // is what the single description below made of it (the cost reduction of BT7-054 came on with any one
  // of the three there). The names are counted one by one and all must hold.
  const eachName = new RegExp(`^(?:there (?:is|are)|you have)\\s+(?:at least\\s+)?(\\d+)\\s*(?:or more\\s+)?((?:${NAMED_CARD},?\\s+)+and\\s+${NAMED_CARD})\\s+cards?\\s+((?:in|among)\\s.+)$`).exec(t);
  if (eachName && !/\b(?:both|each|all)\b/.test(eachName[3])) {
    const names = [...eachName[2].matchAll(new RegExp(NAMED_CARD, "g"))].map((x) => x[0]);
    const conds: Cond[] = [];
    for (const name of names) {
      const one = parseConditionClause(`if there are ${eachName[1]} or more ${name} cards ${eachName[3]}`, true);
      if (!one) return null;
      conds.push(one.cond);
    }
    return { cond: { kind: "all", conds } };
  }
  // "If your Leader is a green <Broly> card **and** you have 2 or more
  // energy" — two conditions in one price. Every pattern below has a greedy
  // tail that would swallow the second and drop it in silence, which is worse
  // than failing: the skill would be offered without its second requirement.
  // A body clause never arrives here compound, because `splitClauses` has
  // already broken it at the "and".
  // "Or" binds loosest (below), so a sentence that joins whole conditions
  // with "or" is cut there first: "your life is at 4 or less, **or** you have
  // 2 or more energy and you have …" (BT31-001) is life, or the rest — never
  // (life or energy) and the rest (#728).
  // #907 round 4: the "and" between two names of one count ("1 or more <A> and <B> cards in your
  // Combo Area", BT19-035b) is the list's own, read whole by the each-name reading above.
  const holdNames = (s: string) => s.replace(new RegExp(`((?:${NAMED_CARD},?\\s+)*${NAMED_CARD}) and (${NAMED_CARD})(?=\\s+cards?\\s+(?:in|among)\\b)`, "gi"), "$1\u0001$2");
  const unhold = (s: string) => s.replaceAll("\u0001", " and ");
  const andParts = holdNames(t).split(/ and /).map(unhold);
  if (andParts.length > 1 && !/,? or (?=you |your |there |it'?s |it is |this card |all )/.test(t)) {
    // "…card, **this card** and {X} are in your Warp" (BT20-078, #907 round 5): the "and" joins this card to the name
    // after it, so cut there the first half ends in a bare "this card" that the Leader description before it swallows
    // whole, and the second half is a single name - the card's own half of the requirement is gone without a word.
    if (andParts.slice(0, -1).some((p) => /(?:^|,)\s*(?:this card|it)$/.test(p.trim()))) return null;
    const conds: Cond[] = [];
    const raw = holdNames(clause.trim()).split(/ and /i).map(unhold);
    let charged = false;
    const parts = andParts;
    for (const [i, part] of parts.entries()) {
      // "You have 2 or more energy **and a yellow Z-Unison with a specified
      // cost of 1 in play**" (BT25-099, BT26-001 and ten more [Awaken]s, #728):
      // the second half shares the first one's "you have". Read bare it is no
      // condition, and the count below then took the whole sentence for one
      // description — 2 or more energy cards that are Z-Unisons. Only a half
      // that opens with an article and names a card is carried, so "you have 2
      // or more energy and you have …" and "… and your Leader …" read as they
      // always did; "and **a combo cost of 1** in your Z-Energy" (BT19-116) and
      // "and **an energy cost of 3**" (P-438) are measures of the card before
      // them, and "and **a player has** a <Son Gohan: SH> card" (BT19-063) has
      // a subject of its own.
      // The half before has to name its own place, or the place printed at the
      // end belongs to both: "1 or more red cards and 1 or more green cards
      // **in your Combo Area**" (BT25-128) is not red cards anywhere in play.
      const before = i > 0 ? parts[i - 1].trim() : "";
      const placed = /\b(?:energy|hand|drop|warp|life|deck|z-energy|area|in play)\b/.test(before.replace(/^(?:you have|your opponent has) /, ""));
      const subject = placed ? /^(you have|your opponent has) /.exec(before) : null;
      const half = part.trim();
      // A count carries the same way: "you have 3 or more energy **and 2 or
      // more skill-less Battle Cards in play**", "your opponent has 8 or more
      // cards in their hand **and 3 or more energy**".
      const namesACard =
        /^(?:an?|\d+ or (?:more|less|fewer)) /.test(half) &&
        !/\b(?:has|have|is|are)\b/.test(half) &&
        /\b(?:cards?|unisons?|z-unisons?|extras?|z-extras?|leaders?|energy)\b|\{[^}]+\}|<[^>]+>|≪[^≫]+≫/.test(half) &&
        !/^an? (?:energy|combo) cost\b|^an? specified cost\b/.test(half);
      const carried = subject && namesACard ? parseConditionClause(`${subject[1]} ${half}`, true) : null;
      countRefused = false;
      const got = carried ?? parseConditionClause(part.trim(), true);
      if (!got && countRefused) return null;
      if (!got) {
        conds.length = 0;
        // A part the compiler reads as something the player *does* is a price
        // to charge, not a claim to check (4-3-3). Falling through to the
        // patterns below would let one of their greedy tails swallow it, and
        // the skill would then be offered without ever paying for it —
        // 914 skills read that way, including BT31-132's "and you remove this
        // card in your Drop from the game". `splitPrice` reads such a price in
        // two; here the clause is simply not a condition.
        // #926: "and **your** draw 3 cards" (BT31-149, a misprinted "you") is
        // that action too — probed without the stray "your", so the price is
        // refused as unread rather than read as its condition alone.
        const piece = (raw[i] ?? part).replace(/[\s,]+$/, "").trim();
        charged = readsAsAction(piece) || readsAsAction(piece.replace(/^your\s+/i, ""));
        break;
      }
      conds.push(got.cond);
    }
    if (conds.length > 1) return { cond: { kind: "all", conds } };
    if (charged) return null;
  }
  // Several conditions joined by "or"; "or" binds loosest.
  // Every part has to read, or the whole condition is a gap.
  const JOIN = /(?=you |your |there |it'?s |it is |this card |all )/;
  const alternatives = t.split(new RegExp(`,? or ${JOIN.source}`));
  if (alternatives.length > 1) {
    const conds = alternatives.map((part) => parseConditionClause(part.trim(), true)?.cond ?? null);
    if (conds.every((x) => x)) return { cond: { kind: "any", conds: conds as Cond[] } };
  }
  let m: RegExpExecArray | null;
  // "If your Leader Card is a <Baby> card, it gets +10000 power" — the leader is
  // both the condition's subject and what "it" then refers to.
  if ((m = /^your leader(?: card)? is (.+)$/.exec(t))) {
    if (leaderTailHoldsAClause(m[1])) return null;
    const parts = splitDisjunction(m[1], { measured: true });
    if (parts.length > 1 && namesShareQualifiers(parts)) {
      return { cond: { kind: "leaderMatches", filter: parseFilter(m[1]) }, subject: { sel: { special: "leader" } } };
    }
    if (parts.length > 1) {
      if (hasBlankPart(parts)) return null;
      const conds = parts.map((part) => ({
        kind: "leaderMatches" as const,
        filter: parseFilter(part),
      }));
      return { cond: { kind: "any", conds }, subject: { sel: { special: "leader" } } };
    }
    const filter = parseFilter(m[1]);
    return { cond: { kind: "leaderMatches", filter }, subject: { sel: { special: "leader" } } };
  }
  // "If your opponent's Leader Card is red or blue" — the same test, other side.
  if ((m = /^your opponent's leader(?: card)? is (.+)$/.exec(t))) {
    if (leaderTailHoldsAClause(m[1])) return null;
    const parts = splitDisjunction(m[1], { measured: true });
    if (parts.length > 1 && namesShareQualifiers(parts)) {
      return { cond: { kind: "leaderMatches", side: "opponent", filter: parseFilter(m[1]) }, subject: { sel: { special: "opponentLeader" } } };
    }
    if (parts.length > 1) {
      if (hasBlankPart(parts)) return null;
      const conds = parts.map((part) => ({
        kind: "leaderMatches" as const,
        side: "opponent" as const,
        filter: parseFilter(part),
      }));
      return { cond: { kind: "any", conds }, subject: { sel: { special: "opponentLeader" } } };
    }
    return { cond: { kind: "leaderMatches", side: "opponent", filter: parseFilter(m[1]) }, subject: { sel: { special: "opponentLeader" } } };
  }
  // Life, both sides and both directions. "Or more" reads the other bound of
  // the same condition, which the engine has always had and the compiler used
  // to leave to the referee.
  // The two life counts against each other, rather than against a number.
  if (/^your life is (?:less than or equal to|at or below|no more than) your opponent's life$/.test(t)) return { cond: { kind: "lifeVsOpponent", atMost: true } };
  if (/^your life is (?:greater than or equal to|at or above|no less than) your opponent's life$/.test(t)) return { cond: { kind: "lifeVsOpponent", atLeast: true } };
  const lifeBound = (n: string, dir: string) => (/less|fewer/.test(dir) ? { atMost: Number(n) } : { atLeast: Number(n) });
  if ((m = /^your life is (?:at )?(\d+) or (less|fewer|more)$/.exec(t))) return { cond: { kind: "life", side: "you", ...lifeBound(m[1], m[2]) } };
  // "If your life is at 1" (BT6-125#40 and five more): exactly that many. LABELLED BEST GUESS - no
  // ruling prints the bare form; "at N" without "or less" is read as the number it says.
  if ((m = /^your life is at (\d+)$/.exec(t))) return { cond: { kind: "life", side: "you", atLeast: Number(m[1]), atMost: Number(m[1]) } };
  if ((m = /^your opponent's life is (?:at )?(\d+) or (less|fewer|more)$/.exec(t))) return { cond: { kind: "life", side: "opponent", ...lifeBound(m[1], m[2]) } };
  // "If you have 2 or less life" — the same sentence with the subject moved.
  if ((m = /^you have (\d+) or (less|fewer|more) life$/.exec(t))) return { cond: { kind: "life", side: "you", ...lifeBound(m[1], m[2]) } };
  if ((m = /^your opponent has (\d+) or (less|fewer|more) life$/.exec(t))) return { cond: { kind: "life", side: "opponent", ...lifeBound(m[1], m[2]) } };
  // Whose turn it is (7-1). The engine has carried this condition since the
  // beginning and the compiler has never once emitted it.
  if (/^(?:it's |it is )?your turn$/.test(t) || /^during your turn$/.test(t)) return { cond: { kind: "isTurnPlayer" } };
  if (/^(?:it's |it is )?your opponent's turn$/.test(t) || /^during your opponent's turn$/.test(t)) return { cond: { kind: "isTurnPlayer", who: "opponent" } };

  // "If the Battle Card being played has an energy cost of 7 or less" — a
  // [Counter: Play] asking about the card it is answering (9-6). The card is
  // not in play yet, so it can only be named, never chosen.
  if ((m = /^the (battle |extra |unison )?card being played (?:has|is) (.+)$/.exec(t))) {
    // The type word is a measure too: "the **Battle** Card being played"
    // (BT29-112) is not an Extra being played, whatever its cost.
    const filter = filterFor(`${m[1] ?? ""}card ${m[2]}`, null);
    if (!filter) return null;
    return { cond: { kind: "count", sel: { special: "resolving", filter }, atLeast: 1 }, subject: { sel: { special: "resolving" } } };
  }

  // "If this card is under a yellow ≪Heroic≫ Battle Card" (23-2): the same
  // question as the target it guards, asked the other way up — the card on top
  // of this one is a yellow ≪Heroic≫ Battle Card. Written the moment `onTop`
  // existed to say it, because these thirteen [Permanent]s print the condition
  // and the grant as one sentence: read the grant alone and the card above
  // gains [Double Strike] whatever it is, which is a wider skill than the one
  // printed. The area a stack stands in is the area of the card on top
  // (23-2-2-2), so "in a Battle Area" narrows nothing and comes off.
  if ((m = /^this card is under (.+?)(?: in (?:a|an|the|your|your opponent's) [a-z- ]*area)?$/.exec(t))) {
    const above = filterFor(m[1], null);
    if (above === null) return null;
    return { cond: { kind: "count", sel: { special: "onTop", filter: above }, atLeast: 1 }, subject: { sel: { special: "onTop", filter: above } } };
  }
  // "This card was used in a combo from your deck or hand" (BT12-071, -072,
  // -074, -075): the area the card left to enter the Combo Area, which the
  // battle keeps (`comboFrom`). Every area named has to be one the engine can
  // say, or the condition is refused whole rather than widened.
  if ((m = /^this card (?:was|is) used in a combo from (.+)$/.exec(t))) {
    const areas = comboSourceAreas(m[1]);
    if (!areas) return null;
    return { cond: { kind: "comboFrom", sel: { special: "self" }, areas }, subject: { sel: { special: "self" } } };
  }
  // A card's own mode as a condition (1-10).
  if ((m = /^this card is in (rest|active) mode$/.exec(t))) {
    return { cond: { kind: "count", sel: { special: "self", mode: m[1] as "rest" | "active" }, atLeast: 1 }, subject: { sel: { special: "self" } } };
  }
  // "If you added a card to your hand", "if you chose to add 1 or more cards
  // to your hand", "if you played a card" — about an earlier step of the same
  // skill (20-16), which the interpreter remembers.
  if (/^you (?:chose to )?add(?:ed)? (?:a card|1 or more cards?|any cards?|cards?) to your hand$/.test(t)) return { cond: { kind: "did", what: "addToHand" } };
  // "If you chose **not** to add any cards to your hand" — the other half of
  // the same question (20-16), and the half that decides whether the rest of
  // the skill happens at all.
  if (/^you (?:chose not to|did ?n'?o?t|didn'?t) add (?:a card|1 or more cards?|any cards?|cards?) to your hand$/.test(t)) {
    return { cond: { kind: "not", cond: { kind: "did", what: "addToHand" } } };
  }
  if (/^you (?:chose to )?play(?:ed)? (?:a|1 or more|any|one or more) (?:battle )?cards?(?: this way)?$/.test(t)) return { cond: { kind: "did", what: "play" } };
  // "If you didn't play a card" (BT12-005, -006, -009, -010, -024, P-314; #907):
  // the other half of the question above — the skill's earlier play did not
  // happen, whether the offer in front of it was declined or the play found no
  // card or was stopped. `did.play` is set false at every attempted play and
  // true only on success (20-16), and is never set by an offer that was not
  // taken, so "not did play" is exactly "no card was played by this skill so far".
  if (/^you (?:did not|didn'?t|do not|don'?t|chose not to) play (?:a|any|1 or more|one or more) (?:battle )?cards?(?: this way)?$/.test(t)) return { cond: { kind: "not", cond: { kind: "did", what: "play" } } };
  if (/^you negated (?:a|your opponent's) leader(?: card)?'s attack(?: with this skill)?$/.test(t)) return { cond: { kind: "did", what: "negateLeaderAttack" } };
  if (/^you negated (?:an|the|that) attack(?: with this skill)?$/.test(t)) return { cond: { kind: "did", what: "negateAttack" } };
  if (/^you ko'?d (?:a|1 or more|any|one or more) (?:battle )?cards?(?: (?:this way|with this skill))?$/.test(t)) return { cond: { kind: "did", what: "ko" } };
  if (/^you (?:drew|draw) (?:a|1 or more|any) cards?(?: with this skill)?$/.test(t)) return { cond: { kind: "did", what: "draw" } };
  if (/^you (?:did not|didn'?t|do not|don'?t) draw (?:a|any) cards?(?: with this skill)?$/.test(t)) return { cond: { kind: "not", cond: { kind: "did", what: "draw" } } };
  // "If your opponent's Leader Card's back is facing up" — awakened (22-2).
  if ((m = /^(your|your opponent's) leader(?: card)?'s back is facing up$/.exec(t))) {
    return { cond: { kind: "leaderFlipped", ...(m[1] === "your" ? {} : { side: "opponent" as const }) } };
  }
  // "If this card's power is 30000 or more".
  if ((m = /^this card'?s power is (\d+) or (more|less)$/.exec(t))) {
    return { cond: { kind: "power", sel: { special: "self" }, ...(m[2] === "more" ? { atLeast: Number(m[1]) } : { atMost: Number(m[1]) }) }, subject: { sel: { special: "self" } } };
  }
  // The same question in the two word orders the sets print beside it: "if
  // **this card has 20000 power or more**" (BT20-090, BT20-107, BT20-108,
  // BT28-003, EX25-31) and "if **your opponent's Leader Card has 10000 or less
  // power**" (BT1-015). The measure moves in front of the noun or behind it,
  // and the verb is "has" rather than "is" — three small differences from the
  // phrase above, and none of them changes what is being asked. Seven skills
  // went unread for them, and an unread condition takes its clause with it:
  // BT28-003 and EX25-31 are [Permanent]s whose whole text is the condition
  // and the grant, so neither read at all.
  //
  // Only the three subjects the grammar can already name. "**Its** power is
  // 20000 or more" (BT3-001) and "**that card** has 25000 power or less"
  // (EX09-01) are the same measure of a card an earlier clause named, and a
  // condition is parsed with no antecedent to resolve them against; "**you or
  // your opponent's** Leader Card has 15000 or more power" (BT3-026) asks
  // about either Leader, which `power` states of one selector at a time. Those
  // five stay unread (ground rule 5).
  if ((m = /^(this card|your leader(?: card)?|your opponent's leader(?: card)?) has (?:(\d+) or (more|less) power|(\d+) power or (more|less))$/.exec(t))) {
    const n = Number(m[2] ?? m[4]);
    const bound = (m[3] ?? m[5]) === "more" ? { atLeast: n } : { atMost: n };
    const sel: Selector = m[1] === "this card" ? { special: "self" } : m[1].startsWith("your opponent") ? { special: "opponentLeader" } : { special: "leader" };
    return { cond: { kind: "power", sel, ...bound }, subject: { sel } };
  }
  // "If your Leader Card has ≪Saiyan≫ in its special trait", "… has {Son Goku}
  // in its card name", "… has <Vegeta> in its character name".
  if ((m = /^your leader(?: card)? has (.+) in its (?:special traits?|card name|character names?)$/.exec(t))) {
    return { cond: { kind: "leaderMatches", filter: parseFilter(m[1]) }, subject: { sel: { special: "leader" } } };
  }
  // "If this card has 3 or more markers on it" (13-2).
  if ((m = /^this card has (\d+) or (more|less|fewer) markers?(?: on it)?$/.exec(t))) {
    return { cond: { kind: "markers", sel: { special: "self" }, ...(m[2] === "more" ? { atLeast: Number(m[1]) } : { atMost: Number(m[1]) }) }, subject: { sel: { special: "self" } } };
  }
  // "If a {Dr.Uiro's Lab} in your Battle Area has 17 or more cards under it"
  // (BT8-045b): the pile under another card, counted. Best guess where two
  // such hosts stand: their piles are added (the card is not Unique-limited
  // in the text, but no deck has been seen with two).
  if ((m = /^(an? .+? in your battle area) has (\d+) or more cards? under (?:it|them)$/.exec(t))) {
    const host = parseTarget(m[1]);
    if (host && !host.special) {
      delete host.count;
      delete host.upTo;
      return { cond: { kind: "count", sel: { side: "you", area: "under", underHost: host }, atLeast: Number(m[2]) }, subject: { sel: host } };
    }
  }
  // "If this card has [Indestructible]" (BT21-005, -006, -007, -023, BT23-008,
  // BT26-054 "[Servant]", P-491; #907): the card has that keyword skill *now* —
  // printed or granted, since a keyword gained is a skill like any other
  // (20-18-1, 22-1) and the filter's keyword test reads the card's skills as
  // they stand. The same count-of-one the other "this card is …" conditions
  // are, with the description a keyword filter. A keyword the filter does not
  // know leaves the filter blank, so the condition would hold for every card:
  // that stays a gap. Only the bracketed keyword itself (not "[Blocker] skill
  // negated" or a list of several), and only for this card.
  if ((m = /^this card has (?:the )?\[([^\]]+)\](?: skill)?$/.exec(t))) {
    const filter = parseFilter(`card with [${m[1]}]`);
    if (filter.unreadable || filter.keywords.length !== 1) return null;
    return { cond: { kind: "count", sel: { special: "self", filter }, atLeast: 1 }, subject: { sel: { special: "self" } } };
  }
  // "If you **only** have blue ≪Power Wish≫ <Son Goku> cards in play in your
  // Battle Area" (EX24-05, BT7-004, P-210; owner's ruling of 17 Oct 2026): every
  // Battle Card you have fits the description, AND there is at least one. An
  // empty Battle Area does not satisfy "only" — that is `every`, which is false
  // with nothing to find (0-2-4-1), not a count of the cards that do not fit
  // (which an empty area would pass). Battle Area only: other places keep their
  // own readings. A description the target reader did not take in leaves the
  // two selectors identical, and the condition would always hold: a gap instead.
  if ((m = /^you only have (.+? cards?) (?:in play )?in your battle area$/.exec(t))) {
    const whole = parseTarget("your cards in play in your battle area");
    const part = parseTarget(`your ${m[1]} in play in your battle area`);
    if (whole && part && !part.filter?.unreadable) {
      for (const sel of [whole, part]) {
        delete sel.count;
        delete sel.upTo;
      }
      if (JSON.stringify(whole) !== JSON.stringify(part)) return { cond: { kind: "every", sel: whole, matching: part }, subject: { sel: whole } };
    }
    return null;
  }
  // "If **all** of your opponent's energy is in Rest Mode" (XD1-01): the whole
  // set against the part of it the description picks out. Read as two
  // selectors so that the description can be a mode as easily as a colour.
  if ((m = /^all of (.+?) (?:is|are) (.+)$/.exec(t))) {
    const whole = parseTarget(m[1]);
    const part = parseTarget(`${m[1]} ${m[2]}`);
    if (whole && part) {
      for (const sel of [whole, part]) {
        delete sel.count;
        delete sel.upTo;
      }
      // A description `parseTarget` did not take in leaves the two selectors
      // identical, and the condition would then always hold. That is worse
      // than a gap, so it stays a gap.
      if (JSON.stringify(whole) !== JSON.stringify(part)) return { cond: { kind: "every", sel: whole, matching: part }, subject: { sel: whole } };
    }
  }
  // "If one of your yellow Battle Cards **is being attacked**" (BT4-085), "if
  // this card is attacking": one end of the battle rather than either (8-1).
  // "One of" is the article, not a count — the condition asks whether any of
  // them is there.
  if ((m = /^(?:if )?(.+?) (is|isn't|is not) (being attacked|attacking)$/.exec(t))) {
    const sel: Selector | null = m[1] === "this card" ? { special: "self" } : parseTarget(m[1].replace(/^(?:one|any) of /, ""));
    if (sel) {
      delete sel.count;
      delete sel.upTo;
      const role = m[3] === "being attacked" ? "guard" : "attacker";
      return { cond: { kind: "inBattle", sel, role, ...(m[2] === "is" ? {} : { not: true }) }, subject: { sel } };
    }
  }
  // "When your <Gogeta: GT> cards attack your opponent's Battle Cards"
  // (BT18-001, active voice): the same end of the battle as "is attacking"
  // just above, said as a verb rather than a participle. 8-1 gives an attack
  // no object but the opponent's cards, so what follows the verb is never
  // itself read — only that the subject is the one attacking is.
  // A modal in front of the verb makes it an instruction, not a moment.
  // "…this card **can** attack a Battle Card in Active Mode" (BT22-133, #1004)
  // is a permission, and "your opponent's Battle Cards **can't** attack
  // Leaders" (BT21-077, #1005) a prohibition; read as "if … attack" and chained
  // behind an "if", either was taken for a second condition and swallowed the
  // clause whole — the rule it printed vanished with no unread clause.
  if (!/\b(?:can'?t|cannot|can|won'?t|will not|may|must|should|would)\s+(?:only\s+)?attacks?\b/.test(t) && (m = /^(.+?) attacks? .+$/.exec(t))) {
    const sel: Selector | null = m[1] === "this card" ? { special: "self" } : parseTarget(m[1]);
    if (sel) {
      delete sel.count;
      delete sel.upTo;
      return { cond: { kind: "inBattle", sel, role: "attacker" }, subject: { sel } };
    }
  }
  // "If this card is in a battle", "if this card isn't in a battle", "if your
  // <Son Goku> card is in a battle" (8-1).
  if ((m = /^(this card|.+?) (is|isn't|is not) in a battle$/.exec(t))) {
    const sel: Selector | null = m[1] === "this card" ? { special: "self" } : parseTarget(m[1]);
    if (sel) {
      delete sel.count;
      delete sel.upTo;
      return { cond: { kind: "inBattle", sel, ...(m[2] === "is" ? {} : { not: true }) }, subject: { sel } };
    }
  }
  // "If your Battle Card in battle is red" (DB1-003, DB1-036, DB1-042, DB1-072, #907 round 5): the colour is said
  // after the position. The battle holds one card of yours (8-1), so it is the question "is your red Battle Card in
  // a battle" just above, asked the other way round.
  // Only "is": no card prints "isn't", and "not in a battle" is not "in a battle, of another colour".
  if ((m = /^your battle card in (?:a |the )?battle is (red|blue|green|yellow|black|white)$/.exec(t))) {
    const sel = parseTarget(`your ${m[1]} Battle Card`);
    if (sel && !sel.special) {
      delete sel.count;
      delete sel.upTo;
      return { cond: { kind: "inBattle", sel }, subject: { sel } };
    }
  }
  // "If you have a blue <Baby> **in a battle**" (BT21-049, BT21-038's <Uub>), #907: the same question as "if your blue
  // <Baby> card is in a battle" just above - one of your cards of that description is in the battle (8-1), not merely
  // somewhere in play. Read as a count it was every such card you have on the table.
  if ((m = /^you have (?:an?|1) (.+?) in (?:a|the) battle$/.exec(t)) && !/\b(?:or|and)\b/.test(m[1].replace(/<[^>]*>|≪[^≫]*≫|\{[^}]*\}/g, "N"))) {
    const sel = parseTarget(`your ${m[1]}`);
    if (sel && !sel.special) {
      delete sel.count;
      delete sel.upTo;
      return { cond: { kind: "inBattle", sel }, subject: { sel } };
    }
  }
  // "If this card participated in a battle during your opponent's turn"
  // (BT3-103): the past tense of the clause above it, and a different
  // question — the card is asked at the end of a battle, when nothing is an
  // attack or guard card any more (8-1-2-2), so what it reads is the card's
  // own memory of the turn. The turn half is one of the conditions the
  // compiler already has, and the two are asked together rather than folded
  // into the memory, which would have to store whose turn it was as well.
  if ((m = /^(this card|.+?) (?:participated|took part) in a battle(?: during (your|your opponent's) turn)?$/.exec(t))) {
    const sel: Selector | null = m[1] === "this card" ? { special: "self" } : parseTarget(m[1]);
    if (sel) {
      delete sel.count;
      delete sel.upTo;
      const was: Cond = { kind: "battled", sel };
      const turn: Cond | null = m[2] ? { kind: "isTurnPlayer", ...(m[2] === "your" ? {} : { who: "opponent" as const }) } : null;
      return { cond: turn ? { kind: "all", conds: [was, turn] } : was, subject: { sel } };
    }
  }
  // "If your Leader's back side is {Name}", "… is a black <Goku> card" (22-2-5).
  if ((m = /^your leader(?: card)?'s back side is (.+)$/.exec(t))) {
    const parts = splitDisjunction(m[1], { measured: true });
    if (parts.length > 1) {
      if (hasBlankPart(parts)) return null;
      const conds = parts.map((part) => ({
        kind: "leaderMatches" as const,
        filter: parseFilter(part),
        back: true,
      }));
      return { cond: { kind: "any", conds }, subject: { sel: { special: "leader" } } };
    }
    return { cond: { kind: "leaderMatches", filter: parseFilter(m[1]), back: true }, subject: { sel: { special: "leader" } } };
  }
  // "If <Son Gohan: Adolescence> is in your Battle Area or Leader Area" (BT2-018, BT2-050,
  // BT2-081, BT3-012, TB1-017, #907): the card is in either of two named areas - a count of at
  // least one in each, either will do. Only the two areas "battle" and "leader", in either order.
  if ((m = /^(.+?) is in your (battle|leader) area or (battle|leader) area$/.exec(t)) && m[2] !== m[3]) {
    const sel = parseTarget(m[1]);
    if (sel && !sel.special) {
      delete sel.count;
      delete sel.upTo;
      const at = (area: "battle" | "leader"): Cond => ({ kind: "count", sel: { ...sel, area, side: sel.side ?? "you" }, atLeast: 1 });
      return { cond: { kind: "any", conds: [at("battle"), at("leader")] }, subject: { sel } };
    }
  }
  // "If {Son Goku, Hero} is in play in your Unison Area", "if your <Vegeta>
  // card is in play", "if a <Bulma> card is in your Combo Area" — the card
  // first, then where it has to be: a count of at least one.
  if ((m = /^(.+?) (is|isn't|is not) in (?:play(?: in your (\w+) area)?|your (\w+) area)$/.exec(t))) {
    const sel = parseTarget(m[1]);
    const areaWord = (m[3] ?? m[4])?.toLowerCase();
    const area = areaWord === "unison" ? "unison" : areaWord === "battle" ? "battle" : areaWord === "combo" ? "combo" : areaWord === "leader" ? "leader" : areaWord ? null : "play";
    if (sel && area) {
      delete sel.count;
      delete sel.upTo;
      const counted: Selector = { ...sel, area, side: sel.side ?? "you" };
      return { cond: m[2] === "is" ? { kind: "count", sel: counted, atLeast: 1 } : { kind: "count", sel: counted, atMost: 0 }, subject: { sel } };
    }
  }
  // "If a multicolored card is in your energy" (BT7-005, BT7-029, BT7-058,
  // BT7-078, #921): the card first, then the Energy Area — which prints as
  // "your energy" as often as "your Energy Area". The card phrase carries the
  // filter ("multicolored" = two colours or more on the card itself), so the
  // reading is the same count of at least one that the other areas get; many
  // such cards are no more than one. `parseCountCondition` reads this word
  // order too, so the area is spelled out for `parseTarget` rather than
  // taught to it.
  if ((m = /^(.+?) (is|isn't|is not|are|aren't|are not) in your energy(?: area)?$/.exec(t)) && !/\b(?:the|that|those|these|this)\b/.test(m[1])) {
    const sel = parseTarget(`${m[1]} in your energy`);
    if (sel && sel.area === "energy" && (sel.side ?? "you") === "you") {
      delete sel.count;
      delete sel.upTo;
      const counted: Selector = { ...sel, area: "energy", side: "you" };
      return { cond: /^(?:is|are)$/.test(m[2]) ? { kind: "count", sel: counted, atLeast: 1 } : { kind: "count", sel: counted, atMost: 0 }, subject: { sel } };
    }
  }
  // "…and **a green <Son Goku: GT> card is in your Warp**" (BT20-065, BT20-066, BT20-069, #907 round 5): the Warp
  // takes the Energy Area's wording just above - the card first, then the place, no "Area" after it.
  if ((m = /^(.+?) (is|isn't|is not|are|aren't|are not) in your warp$/.exec(t)) && !/\b(?:the|that|those|these|this)\b/.test(m[1])) {
    const sel = parseTarget(`${m[1]} in your warp`);
    if (sel && sel.area === "warp" && (sel.side ?? "you") === "you") {
      delete sel.count;
      delete sel.upTo;
      const counted: Selector = { ...sel, area: "warp", side: "you" };
      return { cond: /^(?:is|are)$/.test(m[2]) ? { kind: "count", sel: counted, atLeast: 1 } : { kind: "count", sel: counted, atMost: 0 }, subject: { sel } };
    }
  }
  // "If you don't have a Unison in play", "if you don't have any Battle Cards in play".
  //
  // And the same sentence about the other player: "if **your opponent doesn't
  // have** a Unison Card in play". The positive form is read by
  // `parseCountCondition` for either player, but the negative auxiliary was
  // only ever read for "you" — so BT29-047's "if your Leader is a green
  // <Lucifer> card **and your opponent doesn't have a Unison in play**" lost
  // the second half of its condition and offered the play in exactly the
  // situation the card forbids. BT10-003 and BT15-062b lost theirs too, though
  // those only cost a gap.
  if ((m = /^(?:(you) don'?t|(your opponent) does\s?n'?o?t) have (?:an?|any) (.+?)(?: in play)?$/.exec(t))) {
    const whose = m[1] ? "your" : "your opponent's";
    const what = m[3];
    const sel = parseTarget(`${whose} ${what}`) ?? parseTarget(`${whose} ${what} card`);
    if (sel) {
      delete sel.count;
      delete sel.upTo;
      return { cond: { kind: "count", sel, atMost: 0 } };
    }
  }
  // "…, and **neither you nor your opponent** have a Battle Card in play"
  // (EX24-04): the "don't have" sentence about both players at once — each
  // one's own count of that description is none, and both have to hold
  // (9-1-3), so it is two counts joined, never one count of "both sides".
  if ((m = /^neither you nor your opponent (?:has|have) (?:an?|any) (.+?)(?: in play)?$/.exec(t))) {
    const mine = parseTarget(`your ${m[1]}`) ?? parseTarget(`your ${m[1]} card`);
    const theirs = parseTarget(`your opponent's ${m[1]}`) ?? parseTarget(`your opponent's ${m[1]} card`);
    if (mine && theirs) {
      for (const sel of [mine, theirs]) {
        delete sel.count;
        delete sel.upTo;
      }
      return { cond: { kind: "all", conds: [{ kind: "count", sel: mine, atMost: 0 }, { kind: "count", sel: theirs, atMost: 0 }] } };
    }
  }
  // "If **3 or more blue cards are in your Combo Area**" (BT19-145): the count
  // first and the place last — "there are 3 or more blue cards in your Combo
  // Area" with the verb moved, read by the same code (#961).
  if ((m = /^(\d+ or (?:more|less|fewer)) (.+?) (?:is|are) (in (?:play|your [a-z-]+(?: area)?|your opponent's [a-z-]+(?: area)?))$/.exec(t))) {
    const moved = parseCountCondition(`there are ${m[1]} ${m[2]} ${m[3]}`);
    if (moved) return { cond: moved };
  }
  const counted = parseCountCondition(t);
  if (counted) return { cond: counted };
  // Several conditions joined; "and" binds tightly.
  const both = t.split(new RegExp(`,? and ${JOIN.source}`));
  if (both.length > 1) {
    const conds = both.map((part) => parseConditionClause(part, true)?.cond ?? null);
    return conds.every((x) => x) ? { cond: { kind: "all", conds: conds as Cond[] } } : null;
  }
  return null;
}

/**
 * The condition wordings the cost reducers of the early sets gate on (#907):
 * - "If a ≪Bardock's Crew≫ card is in your Drop Area", "If {A King's Return to
 *   Youth} is in your Drop Area", "if <Son Goten> and <Trunks: Youth> cards are in
 *   play in your Battle Area" - the existence of cards in one place, said with
 *   "is in" rather than "you have" (and "X and Y" is both, each on its own).
 * - "If you or your opponent have a skill-less Battle Card in play", "...have 3
 *   or more cards in their Warp" - either player, each judged on their own.
 * - "If the total number of cards in you and your opponent's Warps is 7 or
 *   more" - one count across both players' cards.
 * - "If there are 6 cards or more in both your Energy Area and your opponent's
 *   Energy Area" - the count for each of the two.
 * `undefined` when the text is none of these; `null` when it is but cannot be read.
 */
function costConditionShape(t: string, bare: boolean): { cond: Cond } | null | undefined {
  let m: RegExpExecArray | null;
  const count = (n: string, dir: string) => (/more/.test(dir) ? { atLeast: Number(n) } : { atMost: Number(n) });
  if (!bare && (m = /^the total number of cards in you and your opponent's (warp|drop area|hand|energy area)s? is (\d+) or (more|less|fewer)$/.exec(t))) {
    const sel = parseTarget(`cards in each player's ${m[1]}`);
    if (!sel || sel.special) return null;
    delete sel.count;
    delete sel.upTo;
    return { cond: { kind: "count", sel: { ...sel, side: "both" }, ...count(m[2], m[3]) } };
  }
  if (!bare && (m = /^you or your opponent have (.+)$/.exec(t))) {
    const own = parseCountCondition(`you have ${m[1].replace(/\bin their\b/g, "in your")}`);
    const theirs = parseCountCondition(`your opponent has ${m[1]}`);
    return own && theirs ? { cond: { kind: "any", conds: [own, theirs] } } : null;
  }
  if (!bare && (m = /^there are (\d+) cards? or (more|less|fewer) in both your (energy area) and your opponent's energy area$/.exec(t))) {
    const mine = parseCountCondition(`there are ${m[1]} or ${m[2]} cards in your ${m[3]}`);
    const theirs = parseCountCondition(`there are ${m[1]} or ${m[2]} cards in your opponent's ${m[3]}`);
    return mine && theirs ? { cond: { kind: "all", conds: [mine, theirs] } } : null;
  }
  // One bracketed name or two joined by "and" (a ≪trait≫, a <character> or a {card name}); anything
  // wider ("a Battle Card with 20000 power or more is in ...", "X or Y cards are in ...") is the
  // ordinary conditions' business and is left to them.
  const NAME = "(?:[{<≪][^}>≫]+[}>≫])(?: cards?)?";
  if ((m = new RegExp(`^(?:an? )?(${NAME}(?: and ${NAME})?) (is|are) in (play in )?(your (?:drop area|warp|hand|energy area|life area|z-deck|battle area|combo area))$`).exec(t))) {
    const two = / and /.test(m[1]);
    if (bare && !two) return undefined;
    // "is in play in your Battle Area" with one name is read by the ordinary rule; the pair is not.
    if (m[3] && !two) return undefined;
    const names = m[1].split(/ and /).map((one, i, all) => (i < all.length - 1 && !/\bcards?$/.test(one) ? `${one} card` : one));
    const conds = names.map((one) => parseCountCondition(`you have ${/s$/.test(one) ? "" : "a "}${one} in ${m![4]}`));
    if (conds.some((x) => !x)) return null;
    return { cond: conds.length === 1 ? conds[0]! : { kind: "all", conds: conds as Cond[] } };
  }
  return undefined;
}

/**
 * "If you have 2 or more Battle Cards in play in Rest Mode", "if there are 5
 * or more cards in your Warp", "if there are no cards in your opponent's
 * Combo Area" — one shape, many areas, and the target phrase after the number
 * is the same grammar every other clause uses.
 */
function unionCount(said: string, who: string | null): Selector | null {
  const place = /\s+(in (?:your|their|your opponent's) [a-z-]+(?: area)?)$/.exec(said)?.[1];
  const halves = said.split(/\s+and\/or\s+/);
  if (!who || !place || halves.length !== 2 || !halves[1].endsWith(place)) return null;
  const sels = [halves[0], halves[1].slice(0, halves[1].length - place.length).trim()].map((half) => parseTarget(`${who} ${half} ${place}`));
  const [a, b] = sels;
  if (!a || !b || !a.filter || !b.filter || a.filter.unreadable || b.filter.unreadable) return null;
  const rest = (s: Selector) => JSON.stringify({ ...s, filter: undefined, count: undefined, upTo: undefined });
  if (a.special || b.special || a.fromVar || b.fromVar || rest(a) !== rest(b) || a.filter.anyOf?.length || b.filter.anyOf?.length) return null;
  // A half the target reader took no measure from would match every card.
  if (filterIsBlank(a.filter) || filterIsBlank(b.filter)) return null;
  const sel: Selector = { ...a, filter: { ...emptyFilter(), anyOf: [a.filter, b.filter] } };
  delete sel.count;
  delete sel.upTo;
  return sel;
}

/**
 * "If your opponent has 4 or more cards in Rest Mode" (SD8-08, owner ruling
 * 20 Oct 2026, #1122): with no "Battle Cards" and no place, every one of that
 * player's cards in Rest Mode counts - the Energy Area included, because paying
 * energy switches it to Rest Mode (5-3-1). When Bandai means only the Battle
 * Area they say "Battle Cards" (BT3-097's Q&A), and that still reads the
 * Battle Area alone; so does a printed place ("in play", "in your Battle Area").
 * `play` leaves the Energy Area out, so the span is spelled out, as the Hidden
 * Mode reading does.
 */
function restAnywhere(sel: Selector, said: string): Selector {
  if (sel.area !== "play" || sel.areas || sel.mode !== "rest" || sel.special || sel.fromVar) return sel;
  if (/\bin play\b|\barea\b|\bbattle cards?\b|\bleader\b|\bunisons?\b|\benergy\b/i.test(said)) return sel;
  return { ...sel, area: "battle", areas: ["leader", "battle", "unison", "energy"] };
}

function parseCountCondition(t: string): Cond | null {
  // "a Battle Card" and a bare plural both mean "at least one"; "no" means none.
  // The sets print the contraction as readily as the long form — "**if
  // there's** a Blue/Yellow multicolor card in your energy" — and only "there
  // is" was read. Seven skills say it, and what it cost was not the condition
  // but the whole skill: BT15-146's combo-cost reduction was simply always on
  // until a refused condition started taking its clause with it, and is now
  // simply refused. Nothing else about those sentences was ever the problem —
  // "blue/yellow multicolor card" reads perfectly well.
  //
  // "You have **only** 3 or less cards other than this card in your hand" is
  // the same kind of miss one word further along: the adverb sits where the
  // number is expected, so no count was read at all and the whole tail became
  // the description — which then failed and left `atLeast: 1`, turning a gate
  // that asks for a nearly empty hand into one that holds almost always
  // (BT2-032, BT2-006).
  // "If your opponent has 11 or more cards **in hand**" (SD7-03): the hand is theirs, as "in their
  // hand" says; the bare "in hand" was read as a description of cards "in play".
  const m = /^(?:you have|your opponent has|there(?: (?:are|is)|'s|'re)) (?:only )?(?:(no)|(?:an?|any) |(\d+) or (more|less|fewer) )?(.+)$/.exec(t.replace(/^(your opponent has .+) in hand$/, "$1 in their hand"));
  if (!m) return null;
  const [, none, num, dir, said] = m;
  // "There are 4 or more **colors among** cards in your energy" (BT16-016,
  // P-393, SD21-01…): the number is of colors, not of cards. Read as "4 or more
  // cards in your energy" it held with four energy of one color. Any other
  // count of colors than "N or more/less" is refused rather than read as cards.
  const colored = colorCountSelector(said);
  if (colored !== undefined) {
    if (!colored || none || !num) return refuseCount();
    return { kind: "count", sel: colored, ...(dir === "more" ? { atLeast: Number(num) } : { atMost: Number(num) }) };
  }
  // "You have **a total of 2 or more** green cards in your Combo Area" (#961):
  // the article took the number and the clause below read "at least 1". With
  // one description the total is the plain count; across three or more places
  // it is still the cross-kind total #915 refuses.
  const totalOf = !none && !num ? /^total of (\d+ or (?:more|less|fewer) .+)$/.exec(said) : null;
  if (totalOf) {
    // A list of places ("in your energy, Z-Energy, Battle Area, and Drop", P-456)
    // is not one count of one area either way.
    if (/(?:,|\band\b)\s*(?:the\s+)?(?:your\s+|their\s+)?(?:energy|z-energy|battle|drop|warp|hand|life|combo|unison|deck)\b/i.test(totalOf[1])) return refuseCount();
    const plain = parseCountCondition(t.replace(/\b(?:an?|any) total of /, ""));
    return plain && plain.kind === "count" && (plain.sel.areas?.length ?? 0) >= 3 ? refuseCount() : plain;
  }
  // "You have 3 or more energy **and you send** 1 red card, 1 blue card, …
  // from your Drop Area to your Warp" (SD16-03, #728): a count's description
  // never has a second subject in it. Read as one, the action became a colour
  // filter on the Drop and the price was neither checked nor charged.
  if (/\band you\b/.test(said)) return null;
  // Three wordings a count cannot state yet are refused rather than read as a
  // plainer count (#915). "Cards with different **character** names" asks for
  // another measure than "different card names" (`differentNames`), and read
  // without it the clause became a bare count (BT18-107). (A total of 7 or
  // more across a list of areas, P-616, is refused below.) And "blue **and/or**
  // yellow cards", "<Pan> cards **and/or** cards with <GT>" in the description
  // (not in the place list after it) is a union of two descriptions: split at the
  // "or" it was either part alone, joined whole its colours were intersected.
  if (/\bdifferent (?!(?:card|character) names\b)/.test(said)) return refuseCount();
  // "You have a total of 2 or more multicolor <Pan> cards **and/or** multicolor
  // cards with <GT> in their character names in your energy" (BT25-131, -132,
  // -134, -135, -136; #907): two descriptions of one count, the place printed
  // once at the end. Cards that fit either description are counted — once each,
  // the way "cards that are A and/or B" reads — so it is one selector whose
  // filter is the either-description (`anyOf`, #537), not two counts added up
  // (a card that fits both would count twice) and not a count of the one
  // description the "or" split would leave. Only the plain shape: exactly two
  // descriptions, one place for both, a number to reach.
  const either = !none && num ? unionCount(said, /^you have/.test(t) ? "your" : /^your opponent has/.test(t) ? "your opponent's" : null) : null;
  if (either) return { kind: "count", sel: either, ...(dir === "more" ? { atLeast: Number(num) } : { atMost: Number(num) }) };
  if (/\band\/or\b/.test(said.replace(/\s+(?:in|among) (?:all cards in )?(?:your|their|your opponent's)\b.*$/, ""))) return refuseCount();
  // Nor a second count: "1 or more red <Son Goku> cards **and 1 or more** red
  // <Vegeta> cards in your Drop" (BT31-001), "1 or more black cards and 1 or
  // more white cards in your Drop" (BT29-085) are two counts, and read as one
  // the two descriptions became either one. Each is read on its own, the
  // place printed at the end shared with a first half that names none.
  const two = /^(.+?) and (\d+ or (?:more|less|fewer)) (.+)$/.exec(said);
  if (two) {
    if (none) return null;
    const lead = /^(you have|your opponent has|there(?: (?:are|is)|'s|'re))/.exec(t)![1];
    const area = /\s(in (?:play|(?:your|their|your opponent's) [a-z- ]+))$/.exec(two[3])?.[1];
    const named = /\b(?:energy|hand|drop|warp|life|deck|z-energy|area|in play)\b/.test(two[1]);
    const first = parseCountCondition(`${lead} ${num ? `${num} or ${dir} ` : ""}${two[1]}${!named && area ? ` ${area}` : ""}`);
    const second = parseCountCondition(`${lead} ${two[2]} ${two[3]}`);
    return first && second ? { kind: "all", conds: [first, second] } : null;
  }
  // "10 or more **total** <Son Goku> or <Vegeta> in your Drop Area" (BT2-001,
  // #539): one count over both names, not either name reaching 10 alone. The
  // filter already reads two names as either, so the "or" is not split.
  const total = /^total\s+/i.test(said);
  const rest = total ? said.replace(/^total\s+/i, "") : said;
  // "If you have **7** [Dragon Ball] cards in your Drop" (BT25-019): a bare
  // number with no "or more" is still the number asked for, at least that
  // many ("you have **0** cards in your hand", P-736: none). Left in the phrase
  // it was read as the size of a choice and then
  // thrown away with the choice, and the condition asked for one card.
  const bare = !none && !num ? /^(\d+) (?!or\b)/.exec(rest) : null;
  // "you have" / "your opponent has" says whose cards, which the phrase after
  // the number usually does not repeat.
  const mine = /^you have/.test(t);
  const theirs = /^your opponent has/.test(t);

  const parts = total ? [rest] : splitDisjunction(rest);
  // "a **black** <Vegito> or <Vegito: Xeno> card in play" (BT31-087), "a red
  // <Gamma 1: SH> or <Gamma 2: SH> card" (BT22-025): one colour word in front of
  // two names, and the "or" cut it off the second. Nothing in the manual
  // (2-2, 2-10) or the Q&A says how an adjective carries across "or"; the three
  // cards that print the shape (also BT21-001b's "red <Son Goku> or <Piccolo>
  // Z-Battle Card") all say it once before a pair of names of one colour and
  // share the noun after them, which is how English reads it, so the colour
  // is kept on every name (a labelled best guess, 18 Oct 2026). A name that
  // brings a colour of its own, or a part that is not a bare name, is left alone.
  const sharedColour = parts.length > 1 ? /^(?:(?:mono-)?(?:red|blue|green|yellow|black|white)\s+)+(?=[<≪{])/i.exec(parts[0])?.[0] : undefined;
  if (sharedColour) for (let i = 1; i < parts.length; i++) if (/^[<≪{]/.test(parts[i])) parts[i] = sharedColour + parts[i];
  if (parts.length > 1) {
    const trailingAreaMatch = /\s+(in (?:play(?: in (?:a|an|the|your|your opponent's) [a-z- ]*area)?|(?:a|an|the|your|your opponent's) [a-z- ]+? area|(?:your|your opponent's) (?:drop|warp|hand|energy|deck|life|combo|battle|unison|z-deck|z-energy)|play))$/i.exec(parts[parts.length - 1]);
    const trailingArea = trailingAreaMatch ? trailingAreaMatch[1] : null;

    const conds: Cond[] = [];
    for (let i = 0; i < parts.length; i++) {
      let part = parts[i];
      if (trailingArea && !/\bin (?:play|your|your opponent's)/i.test(part)) {
        part = `${part} ${trailingArea}`;
      }
      const phrase = mine ? `your ${part}` : theirs ? `your opponent's ${part}` : part;
      const parsed = parseTarget(phrase);
      if (!parsed) return null;
      const sel = restAnywhere(parsed, part);
      delete sel.count;
      delete sel.upTo;
      if (none) conds.push({ kind: "count", sel, atMost: 0 });
      else if (!num) conds.push({ kind: "count", sel, ...(bare && bare[1] === "0" ? { atMost: 0 } : { atLeast: bare ? Number(bare[1]) : 1 }) });
      else conds.push({ kind: "count", sel, ...(dir === "more" ? { atLeast: Number(num) } : { atMost: Number(num) }) });
    }
    return { kind: "any", conds };
  }

  const phrase = mine ? `your ${rest}` : theirs ? `your opponent's ${rest}` : rest;
  const parsed = parseTarget(phrase);
  if (!parsed) return null;
  const sel = restAnywhere(parsed, rest);
  // "A total of 7 or more cards … in your energy, Z-Energy, Battle Area, and/or
  // Drop" (P-616, #915): the article took the number, which would be read as
  // "at least 1" across four areas. Refused, as the issue asks, until a total
  // across kinds has a word of its own.
  if (/^total of \d/.test(said) && (sel.areas?.length ?? 0) >= 3) return refuseCount();
  // "… in your Battle Area **and/or** Combo Area" (BT16-087): the pair of places
  // counted together. A target reads the last place of a pair and drops the
  // first, so the clause is refused unless the places came back as a list (#961).
  if (/\band\/or\b/.test(rest) && (sel.areas?.length ?? 0) < 2) return refuseCount();
  // A count reads the whole area, not one card out of it.
  delete sel.count;
  delete sel.upTo;
  if (none) return { kind: "count", sel, atMost: 0 };
  if (!num) return { kind: "count", sel, ...(bare && bare[1] === "0" ? { atMost: 0 } : { atLeast: bare ? Number(bare[1]) : 1 }) };
  return { kind: "count", sel, ...(dir === "more" ? { atLeast: Number(num) } : { atMost: Number(num) }) };
}
