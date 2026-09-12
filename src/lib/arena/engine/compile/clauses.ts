// ── clause splitting ───────────────────────────────────────────────────────

/** Split on commas, semicolons, full stops and "then"/"and", ignoring anything inside brackets. */
/**
 * After an " and ": nothing but a name, so the "and" joins names rather than
 * clauses.
 *
 * The "non-" is part of the name for this purpose: "you can't play
 * non-<Zamasu> **and** non-<Goku Black> Battle Cards for the game" (BT16-088)
 * split in two, and both halves lost by it — the first became a prohibition on
 * <Zamasu> alone, and the second, which is where "for the game" is printed,
 * read as nothing at all. A negated name is still a name.
 */
const NAME_AFTER_AND = /^(?:non-)?(?:<[^>]+>|≪[^≫]+≫|\{[^}]+\})(?:\s*(?:,|\.|$|cards?\b|battle cards?\b|and\b|or\b|in\b|with\b))/i;

/**
 * After an " and ": the second of two areas one phrase names — "all cards in
 * your opponent's Battle Cards and Unisons" (20-1-6). Split, the second half
 * is a bare area word, and the first half quietly narrows to one area.
 */
const AREA_AFTER_AND = /^(?:unisons?|unison cards?|unison areas?|energy(?: area)?\b)/i;

/**
 * "This card **and** your Leader get +5000 power for the turn" — the "and"
 * joins two *targets* of one verb, not two clauses. Split, the first half is a
 * bare name with nothing to do and the second loses half its subject.
 *
 * The tell is that everything since the clause began is only a way of naming a
 * card: no verb has appeared yet, so the sentence cannot be over.
 */
const TARGET_BEFORE_AND = /(?:^\s*|[,;:]\s+)(?:this card|it|they|them|that card|those cards|your leader(?: card)?|the chosen cards?|you)\s*$/i;

/**
 * After an " and ": a second measure of the same card description, as in "with
 * an energy cost of 3 and 5000 power" (20-12 searches print both orders).
 * Only counted when the clause so far opened a description with "with", which
 * is the word that turns the rest of the phrase into a filter.
 */
const MEASURE_AFTER_AND = /^(?:an? energy cost of \d+|\d+ power|no keyword skills?|no keywords|(?:an?|the) \[[a-z0-9:\- /]+\] skill)(?: or (?:less|more))?\b/i;

/**
 * "Choose all of your opponent's skill-less Battle Cards **and** Battle Cards
 * with 15000 power or less" (EX25-35): the "and" joins a second description of
 * the same choice — one target, two ways to qualify for it — not a new
 * clause. Split here, the second description arrives with the possessive that
 * named its side left behind in the first half, and a rest-lock printed for
 * one side reads as aimed at the other (`compileProhibition`'s subject
 * defaults to "you" when nothing says otherwise). The tell is narrow on
 * purpose: the clause so far is a "choose" naming Battle Cards and stops
 * exactly there, and what follows "and" opens the same way — "Battle Cards",
 * bare or qualified by "with…" — rather than a clause with a verb of its own.
 */
const CHOICE_OPENING = /^choose\b.*\bbattle cards$/i;
const CHOICE_CONTINUES = /^battle cards?\b/i;

function andJoinsChoiceList(text: string, start: number, i: number): boolean {
  return CHOICE_OPENING.test(text.slice(start, i).trim()) && CHOICE_CONTINUES.test(text.slice(i + 5));
}
/**
 * Two *different* named cards, each counted on its own: "1 <Android 17> card
 * and 1 <Hell Fighter 17> card", "1 <Android 14> and 1 <Android 15> card".
 * Matched at both ends of the "and" by `andJoinsTwoNamedCards` below.
 */
const NAMED_QTY_CARD = /(?:up to )?\d+\s+(?:(?:red|blue|green|yellow|black|white|multicolou?r|mono-\w+)\s+)?(?:<[^>]+>|≪[^≫]+≫)(?:\s+cards?)?/i;
const NAMED_QTY_CARD_END = new RegExp(`${NAMED_QTY_CARD.source}\\s*$`, "i");
// No trailing `\b`: the phrase as often as not ends in ">" (a name's closing
// bracket), and `\b` between two non-word characters (">" then a space) never
// matches — which silently failed this the same way for every name with no
// "card" printed after it, e.g. "1 <Son Goku: Xeno> and up to 1 <Vegeta: Xeno>
// card" (BT24-123).
const NAMED_QTY_CARD_START = new RegExp(`^${NAMED_QTY_CARD.source}`, "i");
// The same pair, found anywhere rather than pinned to a split point: a
// "choose"/"play"/"add" verb sits in front of the first name as often as not
// ("choose up to 1 red <Son Goku: Br> card and 1 red <Vegeta: Br> card from
// your Drop Area"), which an anchored `^` would miss. Used by `parseTarget`
// to refuse the shape outright rather than read it as one filter with two
// names, which `filterFor` would otherwise do — a fewer-cards-than-printed
// read (an "or" of the two names, satisfied by either alone) rather than the
// name lost outright, but still not what the card says.
export const TWO_NAMED_CARDS = new RegExp(`${NAMED_QTY_CARD.source}\\s+and\\s+${NAMED_QTY_CARD.source}`, "i");

/**
 * Both players named at once as the owners of one set of cards: "you or your
 * opponent's Battle Cards", "your and your opponent's Drop Areas", "you and
 * your opponent's Battle Areas". The sets write the first half both ways —
 * "you" as often as "your" — and join the two with "and", "or" or "and/or"
 * without changing what the phrase means: every card of that description, on
 * either side of the table.
 *
 * The word after the joiner must carry the possessive. "You **and your
 * opponent draw** 1 card" and "you and your opponent have a total of 8 or less
 * life" name two *players* doing something rather than one description of
 * cards belonging to both, and they are read elsewhere.
 *
 * Used twice, for the two halves of the same miss: `parseTarget` reads the
 * side off it (the possessive nearest the area word is the opponent's, which
 * made the phrase name one board), and `splitClauses` declines to cut a clause
 * at an "and" that is inside it.
 */
export const BOTH_SIDES = /\b(?:your|you)\s+(?:and\/or|and|or)\s+your opponent'?s\b/i;

/**
 * A dash the sets use in pairs to hang a description off a target: "play up to
 * 1 <Son Goku: GT> or <Vegeta: GT> card ―both mono-green, with an energy cost
 * of 5 and 20000 power― from your Drop". Everything between the pair belongs
 * to the phrase in front of it, commas and all, and splitting there left the
 * second half as a fragment naming no action at all.
 */
const ASIDE_DASH = /[―—–]|--/y;

export function splitClauses(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  // Only when they come in pairs: a lone dash is ordinary punctuation, and
  // treating it as an opener would swallow the rest of the sentence.
  const dashes = text.match(/[―—–]|--/g)?.length ?? 0;
  let inAside = false;
  const push = (end: number, skip: number) => {
    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end + skip;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    ASIDE_DASH.lastIndex = i;
    if (dashes >= 2 && dashes % 2 === 0 && ASIDE_DASH.test(text)) {
      inAside = !inAside;
      i = ASIDE_DASH.lastIndex - 1;
      continue;
    }
    if (inAside) continue;
    if ("([{<≪".includes(ch)) depth++;
    else if (")]}>≫".includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      // "…by {b}, for each ≪Saiyan≫ card in your Warp" (BT27-123): the comma
      // introduces the multiplier the amount before it needs, not a second
      // clause. Split here and the first half compiles alone — a flat,
      // unconditional reduction with the scope that was meant to divide it
      // sitting next to it as an orphaned, separately unread fragment, which
      // is a wrong number silently applied rather than an honest gap.
      if (
        (ch === "," || ch === ";") &&
        !inNameList(text, i) &&
        !(ch === "," && (inList(text, i) || commaJoinsColours(text, i) || /^,\s*except\b/i.test(text.slice(i)) || /^,\s*for each\b/i.test(text.slice(i))))
      ) {
        push(i, 1);
      } else if (ch === "." && (i + 1 >= text.length || (text[i + 1] === " " && !/^ [a-z]/.test(text.slice(i + 1, i + 3))))) {
        // A full stop inside an abbreviation is not the end of a sentence:
        // "choose up to 2 Cell Jr. tokens and remove them from the game" is
        // one clause, and splitting it left the removal with nothing to remove.
        // A real sentence never carries on in lower case.
        push(i, 1);
      } else if (
        text.startsWith(" and ", i) &&
        !text.startsWith(" and [", i) &&
        !NAME_AFTER_AND.test(text.slice(i + 5)) &&
        !(MEASURE_AFTER_AND.test(text.slice(i + 5)) && /\bwith\b/i.test(text.slice(start, i))) &&
        !(AREA_AFTER_AND.test(text.slice(i + 5)) && /\bbattle cards?\b/i.test(text.slice(start, i))) &&
        !TARGET_BEFORE_AND.test(text.slice(start, i)) &&
        !andEndsAList(text, start, i) &&
        !andJoinsTwoAreas(text, start, i) &&
        !andJoinsChoiceList(text, start, i) &&
        !andJoinsTwoCountedAreas(text, start, i) &&
        !andJoinsTwoNamedCards(text, start, i) &&
        !andJoinsARange(text, start, i) &&
        !andJoinsColours(text, start, i) &&
        !andJoinsTwoSwitched(text, start, i) &&
        !andJoinsTwoCosts(text, start, i) &&
        // "This card gains +5000 power **and** [Critical] during your turn":
        // one subject given two things, and the half after the "and" is a
        // keyword tag with no verb of its own to be read as a clause.
        !(/^ and \[[a-z0-9\- ]+\]/i.test(text.slice(i)) && /\bgains?\b|\bgets?\b/i.test(text.slice(start, i)))
      ) {
        // "gains [Double Strike] and [Barrier]" is one clause, not two; nor is
        // "a Battle Card with both <Son Goku> and <Piccolo>", nor "with an
        // energy cost of 3 and 5000 power".
        push(i, 5);
        i += 4;
      } else if (text.startsWith(" then ", i)) {
        push(i, 6);
        i += 5;
      }
    }
  }
  push(text.length, 0);
  return out
    .map((c) =>
      c
        // "If you do so" is "if you do" with a word on the end. The strip
        // below would take the phrase and leave the "so", which reads as a
        // bare connective — so the condition was thrown away and everything
        // the sentence made conditional happened anyway (20-16).
        .replace(/^(if you (?:do|did))\s+so\b/i, "$1")
        .replace(/^(?:then|and|if you do|if so)\s+/i, "")
        .trim(),
    )
    .filter(Boolean);
}

/**
 * A comma inside a list of names is not a sentence break. "choose 1
 * <Son Goku: GT>, <Trunks: GT>, <Pan>, or <Giru>" is one instruction, and
 * splitting it leaves three fragments that are nothing but a name.
 */
function inNameList(text: string, comma: number): boolean {
  const before = text.slice(0, comma).trimEnd();
  const endsWithName = /[>}≫]$/.test(before);
  // "and/or" introduces the last item of a name list as often as "and" does —
  // "choose up to 2 ≪Saiyan≫, ≪Earthling≫, **and/or** ≪God≫ cards in your
  // opponent's Battle Area" — and it was not stripped, so the comma before it
  // was read as a sentence break. `listItem` already spells it this way.
  const after = text
    .slice(comma + 1)
    .replace(/^\s*(?:and\/or|or|and)\s+/i, "")
    .trimStart();
  return endsWithName && /^[<{≪]/.test(after);
}

/**
 * What the sets actually put in a list: a colour or an area. Deliberately a
 * vocabulary rather than "any short phrase" — protecting a comma that is a
 * real sentence break would merge two instructions into one unreadable clause,
 * which is a worse failure than the fragment this is here to prevent.
 */
const LIST_WORD =
  /^(?:(?:your|their|its owner'?s|the|an? opponent'?s|your opponent'?s)\s+)?(?:red|blue|green|yellow|black|white|multicolou?r|battle area|combo area|leader area|drop area|energy area|unison area|z-energy|z-deck|drop|hand|deck|life|warp|energy|unison)\b/i;

/** A list item, with the "and"/"or"/"and/or" that may introduce the last one. */
function listItem(seg: string): boolean {
  return LIST_WORD.test(seg.trim().replace(/^(?:and\/or|and|or)\s+/i, ""));
}

/**
 * The same trap one step wider: a comma inside a *list of anything* is not a
 * sentence break. "This card is also treated as red, blue, and green", "play
 * up to 1 card from your hand, Drop, or Warp", "cards in your energy,
 * Z-Energy, Battle Area, and/or Drop". Ninety-eight skills were losing a
 * one-word fragment to this, and a fragment fails the whole skill.
 *
 * What tells a list from a sentence is that the items are short and the run
 * ends with "and", "or" or "and/or" before the last one — a real clause after
 * a comma has a verb in it, which is what `LIST_TAIL_VERB` rules out. A
 * two-item list ("from your hand, or your Drop") is allowed only because of
 * that check: without it, "draw 1 card, and draw 1 card" would read as one.
 */
/**
 * The tail of the same list, where the "and" is: "…from your opponent's Battle
 * Area, energy, life, **and** hand". The commas are protected by `inList`, so
 * the run only survives if the final "and" is protected too — otherwise the
 * last item is cut off on its own, which is exactly the fragment this is for.
 */
function andEndsAList(text: string, start: number, i: number): boolean {
  const before = text.slice(start, i).trimEnd();
  // A *comma run* has to be there already. Without that requirement "if your
  // Leader Card is yellow and your life is at 4 or less" reads as a list,
  // because "yellow" and "life" are both list words — two conditions are not a
  // list, and the comma is what tells them apart.
  const run = before.endsWith(",") || /,\s*[^,]{1,24}$/.test(before);
  // The Oxford comma leaves an empty last segment ("…as red, blue, and"), so
  // the item to test is the last one that has anything in it.
  const last =
    before
      .split(/,\s*/)
      .filter((x) => x.trim())
      .pop() ?? "";
  return run && listItem(last) && listItem(text.slice(i + 5, i + 60));
}

/**
 * The two-item version, which the sets write without a comma: "cards in your
 * energy **and** Battle Area", "while in your deck **and** Drop Area". Both
 * sides have to be an area, so "…is yellow and your life is at 4 or less" —
 * where only the second is one — still reads as the two conditions it is.
 */
const AREA_WORD = /\b(?:battle area|combo area|leader area|drop area|energy area|unison area|z-energy|z-deck|drop|hand|deck|life|warp|energy|unison)\s*$/i;

function andJoinsTwoAreas(text: string, start: number, i: number): boolean {
  if (!AREA_WORD.test(text.slice(start, i))) return false;
  const after = text
    .slice(i + 5, i + 60)
    .split(/[,.;]/)[0]
    .trim();
  return AREA_WORD.test((after.match(/^(?:(?:your|their|its owner'?s|the)\s+)?[a-z-]+(?: area)?/i)?.[0] ?? "").trim());
}

/**
 * The version where each side of the "and" is a whole counted target rather
 * than a bare area name: "both players choose 1 card from their hand **and**
 * 1 card from their Battle Area" (BT1-057). `andJoinsTwoAreas` only reads a
 * bare area word up against the "and", so the "1 card from their" in front of
 * "Battle Area" defeated it and the sentence split into a fragment with no
 * verb of its own.
 */
const COUNTED_AREA_TARGET =
  /(?:up to )?\d+ cards? (?:in|from) (?:your|their|its owner'?s) (?:battle area|combo area|leader area|drop area|energy area|unison area|z-energy|z-deck|drop|hand|deck|life|warp|energy|unison)\s*$/i;
const COUNTED_AREA_TARGET_START =
  /^(?:up to )?\d+ cards? (?:in|from) (?:your|their|its owner'?s) (?:battle area|combo area|leader area|drop area|energy area|unison area|z-energy|z-deck|drop|hand|deck|life|warp|energy|unison)\b/i;

function andJoinsTwoCountedAreas(text: string, start: number, i: number): boolean {
  if (!COUNTED_AREA_TARGET.test(text.slice(start, i))) return false;
  const after = text
    .slice(i + 5, i + 90)
    .split(/[,.;]/)[0]
    .trim();
  return COUNTED_AREA_TARGET_START.test(after);
}

/**
 * "Play up to 1 <Android 17> card **and** 1 <Hell Fighter 17> card—both green
 * and with energy costs of 1—from your deck and/or Drop with their skills
 * negated for the turn" (BT20-077, and the same shape on BT20-079, BT24-123,
 * EB1-32, BT19-032 among others): two *different* named cards, each counted
 * on its own, share one trailing aside and one trailing source. Split at this
 * "and" — which nothing above catches, because neither side is a bare name
 * (`NAME_AFTER_AND`), an area, or a range — the first name is left with
 * nothing after it and the second inherits the aside, the source, *and* the
 * "and" itself, which is where the audit found it: the first card read as
 * already on the board and the second's side flipped to the opponent's, both
 * from one clause split in the wrong place.
 *
 * Gated on a source ("from your/their/its owner's deck or Drop") appearing
 * soon after the second name, which is the tell of this "search and play"
 * family — as opposed to "choose 1 <A> card and 1 <B> card in your Drop Area
 * and send them to their owners' Warps", where the target is already named
 * and nothing here needs protecting. `compileClause` still does not know how
 * to search for two different names from one shared source: keeping the
 * clause whole only stops the wrong split, and `refFor` refuses the merged
 * phrase outright rather than guess at it (ground rule 5).
 */
function andJoinsTwoNamedCards(text: string, start: number, i: number): boolean {
  if (!NAMED_QTY_CARD_END.test(text.slice(start, i))) return false;
  const after = text.slice(i + 5);
  if (!NAMED_QTY_CARD_START.test(after)) return false;
  return /^[^.;]{0,120}\bfrom (?:your|their|its owner'?s|the) (?:deck|drop(?: area)?)\b/i.test(after);
}

/**
 * The two-colour list the sets write with a comma and no "and": "reduce the
 * combo cost of blue, yellow ≪Universe 6≫ cards in your hand by 1". `inList`
 * cannot see it, because the run never reaches an "and"/"or" item — the second
 * colour runs straight on into the rest of the phrase.
 */
function commaJoinsColours(text: string, comma: number): boolean {
  return /\b(?:red|blue|green|yellow|black|white)\s*$/i.test(text.slice(0, comma)) && /^,\s*(?:red|blue|green|yellow|black|white)\b/i.test(text.slice(comma));
}

/**
 * The same list written with "and": "reduce the combo cost of blue **and**
 * yellow ≪Universe 6≫ cards in your hand by 1" (XD1-05). Cut there, the halves
 * are "reduce the combo cost of blue" — a verb whose object is a colour — and
 * a bare noun phrase, and neither is a clause.
 */
function andJoinsColours(text: string, start: number, i: number): boolean {
  return /\b(?:red|blue|green|yellow|black|white)\s*$/i.test(text.slice(start, i)) && /^ and (?:red|blue|green|yellow|black|white)\b/i.test(text.slice(i));
}

/**
 * The "and" of a **numeric range**: "with an energy cost between 3 and 7",
 * "with powers between 20000 and 30000", "you can't play Battle Cards with
 * power between 30000 and 35000".
 *
 * Cut, this one does more than leave a fragment. `parseFilter` reads "an
 * energy cost between 3" with the plain `energy cost N` pattern and comes out
 * with *exactly 3* — a bound narrower than anything the card says — while the
 * "7 from your deck to your hand" it left behind fails the whole skill. Twelve
 * clauses, and the wrong half of each was compiling in silence.
 */
function andJoinsARange(text: string, start: number, i: number): boolean {
  return /\bbetween [\d,]+\s*$/i.test(text.slice(start, i)) && /^[\d,]+\b/.test(text.slice(i + 5));
}

/**
 * "Reduce the energy cost **and** Z-Energy cost of X in your Z-Deck by 1"
 * (BT22-085, P-476b): one amount, two costs it comes off, one "of X by N"
 * shared between them. Split at the "and" and neither half is a sentence —
 * "reduce the energy cost" has no amount, and "Z-Energy cost of X … by 1" has
 * no verb — so both went unread. `compileClause` reads the kept-whole clause
 * as two `costReduction` ops.
 */
function andJoinsTwoCosts(text: string, start: number, i: number): boolean {
  return /\b(?:reduce|increase|decrease) the energy costs?\s*$/i.test(text.slice(start, i)) && /^z-energy costs?\b/i.test(text.slice(i + 5));
}

/**
 * "Switch this card **and** up to 1 of your energy to Active Mode" (1-10):
 * one verb and one destination mode shared by two targets, which the sets
 * print on eleven cards. The tell is narrow on purpose — a verb, then a bare
 * way of naming a card, then the "and", and the mode at the end of what
 * follows — because the general "verb A and B" shape is not safe to keep
 * whole: `refFor` collapses it to one target and the other is silently
 * dropped, which is worse than the fragment. Only the wording whose pattern
 * reads both halves (`refsFor`, below) is kept together.
 */
const SWITCH_TARGET_BEFORE_AND = /(?:^\s*|[,;:]\s+)(?:you (?:may|can)\s+)?switch\s+(?:this card|it|them|that card|those cards|your leader(?: card)?)\s*$/i;

function andJoinsTwoSwitched(text: string, start: number, i: number): boolean {
  if (!SWITCH_TARGET_BEFORE_AND.test(text.slice(start, i))) return false;
  return /^[^.;]*\bto (?:active|rest)(?: mode)?\b/i.test(text.slice(i + 5));
}

function inList(text: string, comma: number): boolean {
  let at = comma;
  for (let items = 0; items < 6; items++) {
    const next = text.indexOf(",", at + 1);
    const stop = next === -1 ? text.length : next;
    const seg = text
      .slice(at + 1, stop)
      .trim()
      .replace(/[.;]$/, "");
    if (!seg || !listItem(seg)) return false;
    // The run ends at the item the "and"/"or" introduces; what follows that
    // item is the rest of the sentence and none of this function's business.
    if (/^(?:and\/or|and|or)\s+/i.test(seg)) return true;
    if (next === -1) return false;
    at = next;
  }
  return false;
}

/**
 * Explanatory notes in parentheses are not rules text (1-5-8). Some sets print
 * the full-width brackets, and a note whose closing bracket is missing runs to
 * the end of the line — both used to leave a reminder behind as an
 * "unreadable" clause.
 */
export function stripNotes(text: string): string {
  let out = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "(" || ch === "（") depth++;
    else if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}
