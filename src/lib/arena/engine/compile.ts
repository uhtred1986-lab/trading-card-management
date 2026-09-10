/**
 * Card text → effect program, deterministically and for free.
 *
 * The printed skills use a small, repetitive vocabulary ("Draw 1 card",
 * "choose up to 1 of your opponent's Battle Cards, KO it", "this card gets
 * +5000 power for the turn"). This reads that vocabulary. A clause it does not
 * recognise is reported in `unsupported`, and the engine then hands the whole
 * skill to the referee rather than running half of it — a half-resolved skill
 * is worse than an honest "Claude decides this one".
 */
import { parseFilter, type CardFilter } from "./filters";
import { keywordOf, orbsIn, skillsOf, trailingTrigger, withoutTrailingTrigger } from "./cards";
import type { Amount, CardScripts, Cond, Duration, Op, Ref, Script, ScriptArea, Selector, Side, SkillPrice } from "./script";
import type { CardDef, Color, DelayScope, DelayTiming, KeywordSkill, Skill, SkillKindPrefix } from "./types";

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
const TWO_NAMED_CARDS = new RegExp(`${NAMED_QTY_CARD.source}\\s+and\\s+${NAMED_QTY_CARD.source}`, "i");

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

// ── target phrases ─────────────────────────────────────────────────────────

const AREA_WORDS: [RegExp, ScriptArea][] = [
  // "In your opponent's Drop" was the one possessive this line did not admit —
  // `in your` matched, then `drop` did not follow — so "up to 1 Battle Card in
  // your opponent's Drop" fell through to the Battle Area and chose a card in
  // play instead. Every other area word here already reads the possessive.
  [/\bin (?:your|their|its owner's|an?) (?:own )?drop\b|\bdrop area\b|\bfrom your drop\b|\b(?:your |an? )?opponent'?s drop\b|\btheir drop\b/, "drop"],
  // "Your blue energy", "your opponent's rested energy": the adjectives sit
  // between the possessive and the word, and "energy cost" is not an area.
  // The adjectives between the possessive and the word include the slash of
  // "your **Red/Blue multicolor** energy", which the class did not admit — so
  // six cards that rest a multicolour energy went looking on the table for it.
  [/\benergy area\b|(?<!equal to )\b(?:your opponent's|their|your)(?: [a-z/-]+)* energy\b(?! cost)/, "energy"],
  [/\bfrom your hand\b|\bin your hand\b|\btheir hand\b|\byour hand\b|\byour opponent's hand\b/, "hand"],
  [/\bfrom your deck\b|\bin your deck\b|\byour deck\b|\byour opponent'?s deck\b|\btheir deck\b/, "deck"],
  // "Flip up to 1 card in your opponent's life face up" (BT12-069/070): the
  // possessive is what `parseTarget` reads as the side, so the area word has
  // to admit it or the phrase names no area at all.
  [/\bin your life\b|\bfrom your life\b|\byour life\b|\byour opponent'?s life\b|\btheir life\b|\blife area\b/, "life"],
  [/\bwarp\b/, "warp"],
  [/\bcombo area\b/, "combo"],
  [/\bunison area\b/, "unison"],
  [/\bz-deck\b/, "zDeck"],
  [/\bz-energy\b/, "zEnergy"],
  [/\bunder this card\b/, "under"],
  // Naming both areas is how the text says "on the table" (20-1-6), and it
  // has to be read before either area alone — otherwise "in your Battle Area
  // or Leader Area" becomes a Battle Area holding a Leader, which is nothing.
  [/\b(?:battle|leader) area or (?:battle|leader) area\b/, "play"],
  [/\bleader area\b/, "leader"],
  [/\bbattle area\b/, "battle"],
  // Noun card types when no explicit area preposition was named
  [/\bleader cards?\b|\byour leaders?\b/, "leader"],
  [/\bbattle cards?\b/, "battle"],
  [/\bunison cards?\b|\bunisons\b/, "unison"],
  // 20-1-6: an unqualified "cards" means the Leader Area and the Battle Area.
  [/\b(?:your|their|opponent's) (?:[a-z-]+ )*cards\b/, "play"],
];

/**
 * Area words as the cards print them, for the phrases that name two of them
 * ("from your deck or Drop Area"). Only used for that: the single-area case is
 * `AREA_WORDS` above, which reads far more wordings.
 */
const AREA_NAMED: Record<string, ScriptArea> = {
  hand: "hand",
  deck: "deck",
  drop: "drop",
  "drop area": "drop",
  warp: "warp",
  life: "life",
  energy: "energy",
  "energy area": "energy",
  "battle area": "battle",
  "z-deck": "zDeck",
  "z-energy": "zEnergy",
};
// "In **your opponent's** Battle Area or Drop": the possessive sits where the
// first area word was expected, so the pair went unread and the phrase fell
// through to whichever single area matched first.
const AREA_PAIR_RE = /\b(?:in|from|of|into) (?:your|their)(?: opponent'?s)? ((?:z-)?[a-z]+(?: area)?) or (?:(?:from|in) )?(?:the )?(?:your |their )?(?:opponent'?s )?((?:z-)?[a-z]+(?: area)?)\b/;

/**
 * "…in all of your areas" (3-1-1): every area a player has, rather than one of
 * them. "Removed from the game" is not an area, and the pile under a card is
 * the host's area rather than one of its own, so neither is here.
 */
const ALL_AREAS: ScriptArea[] = ["leader", "battle", "unison", "combo", "energy", "hand", "deck", "drop", "life", "warp", "zDeck", "zEnergy"];
/**
 * The phrase that names them all. Both of its words mislead the rest of
 * `parseTarget`, which is why it is taken off the phrase rather than left for
 * `AREA_WORDS`: "areas" is not an area word, so "each <Son Goku> and <Vegeta>
 * in all of your areas" fell through to the 20-1-6 default of the table and a
 * Leader's colour grant reached nothing in hand, energy or drop; and the "all"
 * in it reads as a count. The possessive is kept, because on BT2-001 it is the
 * only thing in the phrase that says whose cards these are.
 */
const ALL_AREAS_RE = /\bin all (?:of )?(your |their |its owner's )?areas\b/;

/**
 * "…in areas other than your deck, hand, or life" (BT7-125 through BT7-129,
 * one per colour): every area *except* the ones it lists. The list is the one
 * part of the phrase that must not be read as the place to look, and
 * `AREA_WORDS` is first-match-wins, so it read "your deck" — the exact inverse
 * of what the card says, and a mono-colour lock that checked the pile the
 * cards are least likely to be in. `Selector.areas` states a span, so the
 * complement is written out.
 *
 * Only "in", never "from": "when a card is placed in your life face up **from**
 * any area other than your life" (BT12-023) is a trigger saying where the card
 * came from, not a description of cards, and it is not this phrase.
 */
const AREAS_OTHER_THAN_RE = /\bin (?:any |all )?areas? other than ((?:your |their |its owner's |an? owner's |the )?(?:z-)?[a-z]+(?: area)?(?:(?:\s*,\s*or\s+|\s*,\s*|\s+or\s+)(?:your |their |its owner's |an? owner's |the )?(?:z-)?[a-z]+(?: area)?)*)\b/;
/** The "or" of that list is a separator, not the shortest area word there is. */
const AREA_LIST_SEP = /\s*,\s*or\s+|\s*,\s*|\s+or\s+/;

/**
 * "up to 2 of your opponent's Battle Cards in Rest Mode" → a selector.
 *
 * `looked` is the variable a `look` earlier in the same skill bound, for the
 * clauses that pick out of what was just looked at without saying so — see the
 * "add … to your hand" rule in `compileClause`. It is passed only once the
 * caller has established that the phrase names no area of its own, so it can
 * never overrule an area the text actually printed.
 *
 * `pool` is the weaker claim, and the ordinary one: the cards a look or a
 * reveal is holding out, which this phrase draws from **only if it says so**.
 * Until 9 Sep 2026 no caller passed either, so a phrase that did say so was
 * given the literal name `"looked"` — right after a look, and a variable
 * nothing had bound after a reveal, which is a choice with no candidates
 * (BT13-024, BT6-074).
 */
export function parseTarget(phrase: string, looked?: string, pool?: string): Selector | null {
  // "1 <Android 17> card and 1 <Hell Fighter 17> card—both green and with
  // energy costs of 1—from your deck and/or Drop", "choose up to 1 red <Son
  // Goku: Br> card and 1 red <Vegeta: Br> card from your Drop Area and add
  // them to your hand": `andJoinsTwoNamedCards` (in `splitClauses`) keeps a
  // two-named-card search whole instead of cutting it at the "and" and losing
  // one name — but nothing here can yet search for two different names from
  // one shared source. Read as a single filter, "name A or name B" is not the
  // same target as "one of A *and* one of B": it is satisfied, and stops
  // looking, the moment it finds either — a card fewer than the text promises
  // rather than a name lost outright, but still not what the card says
  // (BT20-077, BT20-079, BT24-123, EB1-32, BT19-032, BT6-012, BT7-051, and the
  // "choose … and add/send them" family beside them). Refused whole rather
  // than guessed at (ground rule 5); a two-name search is a primitive of its
  // own, not built.
  if (TWO_NAMED_CARDS.test(phrase)) return null;
  let t = phrase.toLowerCase();
  // Qualifiers this grammar does not read, and cannot afford to drop: they
  // narrow a phrase to a handful of cards by their *history* — which cards
  // this very skill moved — rather than by anything a selector can describe,
  // and every rule below would quietly hand back the whole area instead.
  // "Negate the skills of all cards **sent to Warps by this skill**" (EX21-15,
  // BT13-096) is every card in the Warp, both of them permanent.
  //
  // Refusing is ground rule 5: the clause goes to the referee, which is what
  // the card needs anyway.
  if (/\bby this skill\b|\bsent to\b/.test(t)) return null;
  // "The card on top of this card" (23-2), and the descriptions that name it:
  // "the <Majin Buu> on top of this card", "the Leader on top of this card",
  // "Battle Cards on top of this card". A pile is one card with everything
  // else beneath it, so this names exactly one card and `onTop` is it.
  //
  // Only the phrase that *ends* there is read. Every other use of the words is
  // a destination — "play up to 1 green <Piccolo> card with an energy cost of
  // 4 **on top of this card** from your deck" — where the same reading would
  // point the search at the card above instead of naming where the card goes,
  // and those stay refused with the history phrases above. That is why the
  // guard was written whole in the first place; this is the half of it that
  // has a target to be read into.
  // "The card **above** this card" is the same card in other words (BT20-017,
  // BT20-019, BT20-091, BT20-092), and read as *this card* until 9 Sep 2026 by
  // the same shortcut — BT20-091 gave itself the [Barrier] it grants upward.
  const onTop = /^(?:(?:the|a|an|each|all|any)\s+)?(.*?)\s*(?:on top of|above) this card$/i.exec(phrase.trim());
  if (onTop) {
    // What comes before the words has to be a *description* and nothing more.
    // BT21-032 prints "choose up to 1 of your opponent's Battle Cards with
    // power less than or equal to the card on top of this card, then KO it":
    // the phrase ends in these words while naming an opponent's card measured
    // against the one above, and read whole it KO'd the card on top — your own
    // <Son Goku>. A comparison or a second owner means the words are a measure
    // inside a longer phrase, not the head of it, and the clause goes to the
    // referee (ground rule 5).
    if (/\bthan\b|\bequal to\b|\bopponent|\bof (?:your|their)\b|\bup to \d/.test(onTop[1])) return null;
    const above = filterFor(onTop[1] || "card", null);
    return above === null ? null : { special: "onTop", filter: above };
  }
  if (/\bon top of\b/.test(t)) return null;
  // The pile under a card is an area this grammar can name only when the card
  // is *this* one, which `underHost` below reads. Any other host — "use up to
  // 1 card **from under your <Kefla> Battle Card** in a combo" (EX25-39),
  // "play up to 1 <X> card **from under your Leader Card**" — has no selector
  // to stand for it, and the words naming the host were read as the target
  // instead: `AREA_WORDS` took the "battle" out of "your <Kefla> Battle Card"
  // and the description off the host, so EX25-39 combo'd the <Kefla> itself
  // rather than a card beneath it, and the Leader wordings chose the Leader.
  // Sixty-odd clause shapes say this, all of them refused here rather than
  // read into the wrong card (ground rule 5); naming the pile under a card
  // other than this one is its own primitive and is not built.
  if (/\bunder\b/.test(t) && !/\bunder (?:this card|it)\b/.test(t)) return null;
  // "Each non-Leader card under this card" is about the stack; the "this card"
  // "Each non-Leader card under this card" is about the stack; the "this card"
  // in it names the host, not the target (23-2). Read before the shortcut
  // below, which took the whole phrase for the card on top.
  //
  // The rest of the phrase is then read as usual: "**each** card under this
  // card" and "**up to 1** card from under this card" are the same area and
  // different counts, and hard-coding "all" here played every card in the pile.
  const underHost = /\bunder (?:this card|it)\b/.test(t) && !/^this card\b/.test(t.trim());
  if (underHost) {
    phrase = phrase.replace(/\b(?:from )?under (?:this card|it)\b/gi, " ");
    t = phrase.toLowerCase();
  }
  // "Each <Son Goku> and <Vegeta> **in all of your areas**": the phrase names
  // every area rather than one, and has to come off before anything else reads
  // the words in it. See `ALL_AREAS_RE`.
  const allAreas = ALL_AREAS_RE.test(t);
  if (allAreas) {
    phrase = phrase.replace(new RegExp(ALL_AREAS_RE.source, "gi"), (_full, poss?: string) => ` ${poss ?? ""} `);
    t = phrase.toLowerCase();
  }
  // "…in areas other than your deck, hand, or life": the same, said as a
  // complement. See `AREAS_OTHER_THAN_RE`.
  const otherThan = AREAS_OTHER_THAN_RE.exec(t);
  let otherAreas: ScriptArea[] | null = null;
  if (otherThan) {
    const named = otherThan[1]
      .split(new RegExp(AREA_LIST_SEP.source))
      .map((w) => w.replace(/^(?:your |their |its owner's |an? owner's |the )/, "").trim())
      .filter(Boolean);
    const listed = named.map((w) => AREA_NAMED[w] ?? null);
    // One area word this table does not know and the complement would be too
    // wide — it would name an area the card excludes, which is worse than not
    // reading the phrase at all (ground rule 5).
    if (listed.some((a) => a === null)) return null;
    otherAreas = ALL_AREAS.filter((a) => !listed.includes(a));
    phrase = phrase.replace(new RegExp(AREAS_OTHER_THAN_RE.source, "gi"), " ");
    t = phrase.toLowerCase();
  }
  // "this card's power" inside a phrase is a measure, not the target.
  // "…**except for** this card" is "other than this card" said the other way,
  // and reading it as a mention rather than an exclusion sent the phrase down
  // this shortcut: BT1-086's "place all Rest Mode Battle Cards except for this
  // card in the Drop Area" came back as *self*, so the card dropped itself and
  // left every card it was aimed at standing.
  if (/\bthis card\b(?!'s)/.test(t) && !/\bother\b|\bexcept\b|\bbesides\b/.test(t)) return { special: "self" };
  if (/\bthe attack(?:ing)? card\b/.test(t)) return { special: "attacker" };
  if (/\bthe guard card\b/.test(t)) return { special: "guard" };
  // "Your opponent's Leader", "your Leader Card": a player has exactly one
  // (3-1-2), so this names a card rather than describing a search — and the
  // engine already has both of them as specials.
  //
  // Without this the phrase named no area at all: `AREA_WORDS` reads "leader
  // card**s**" and "**your** leader", and "your opponent's Leader" is neither,
  // so it fell through to the 20-1-6 default of the whole play area and the
  // clause aimed at *any one card the opponent has on the table* — a Battle
  // Card as readily as the Leader. Only the bare phrase is read this way: once
  // it says more ("your opponent's Leader in Rest Mode"), it goes on to the
  // area grammar as before, which reads the extra words.
  if (/^(?:(?:the|that|your|their|an?) )?(?:(?:the |your |an? )?opponent'?s )?leader(?: cards?)?$/.test(t.trim())) {
    return { special: /\bopponent|\btheir\b/.test(t) ? "opponentLeader" : "leader" };
  }
  // "1 Battle Card with an energy cost of 2 or less being played by your
  // opponent" is the card the [Counter: Play] is answering, and there is only
  // ever one of those — reading it as a choice asked for a card in play, which
  // is a different card entirely (9-6).
  if (/\bbeing played\b/.test(t)) {
    const being = filterFor(phrase, null);
    return being === null ? null : { special: "resolving", filter: being };
  }

  // "All **other** Battle Cards", "all other cards in your Battle Area": the
  // adjective rules out the card the skill is on, which is exactly `notSelf`.
  // Read as nothing, a clause that bounced or silenced every Battle Card did
  // it to this one too — and on the two [Permanent]s that print
  // "negate the skills of all other Battle Cards" that is the card negating
  // itself. "Other than this card" is the same thing spelled out and is read
  // below; "each other player" is a player, not a card.
  const otherAdj = /\bother\b/.test(t) && !/\bother than\b/.test(t) && !/\bother player/.test(t);

  let side: Side = "you";
  // The sets write the possessive four ways — "your opponent's", "an
  // opponent's", "the opponent's", and once "ofyour opponent's" (a typo in the
  // catalog itself) — so the word is matched with whatever leads up to it.
  //
  // The oldest sets drop the possessive altogether: "choose up to 1 opponent
  // Battle Card and KO that card" (BT1–BT3, EX01–EX02, P-006). Read as naming
  // no side, all sixteen of those chose *your own* card and KO'd, rested or
  // returned it — the wrong-effect failure ground rule 1 is about, and the
  // opposite of what the card says. Only the attributive form is read that
  // way: a bare "an opponent discards a card" is a player, not a card.
  // "Choose all of **your** Battle Cards with <Son Goku> in **their**
  // character names": the possessive in the tail belongs to the *cards*, not
  // to a player, and reading it as a player handed sixteen skills the
  // opponent's board — BT22-086 giving +5000 power to the cards it was meant
  // to be fighting. The phrase says whose cards these are once, at the front.
  // "…to **their owner's** Drop Area" is the idiom for every card going back to
  // whoever owns it (2-4), and it is printed on 113 skills. Read by the bare
  // "their" below it made the phrase say *opponent*, and worse, it said so
  // about the **source** — the possessive sits in the destination half of the
  // sentence, so "play up to 4 ≪Saiyan≫ cards from **your** Warp into their
  // owner's Drop" went looking in the opponent's Warp (BT27-015, and BT29-095,
  // BT29-108, P-710 the same way). Stripped like the name phrases beside it,
  // because it says nothing about whose cards are being chosen.
  //
  // When no area was matched (20-1-6), `owner` is scanned as a fallback. We strip
  // phrases where "their" refers to card traits, names, or owners rather than
  // the player owning the cards. Destination area phrases no longer need stripping
  // here because `areaPhrase` is structurally scoped to the source area match.
  const owner = t
    .replace(/\bin their (?:character names|card names|special traits)\b/g, " ")
    .replace(/\btheir owners?'?s?\b/g, " ");
  // "Choose **all** Battle Cards" names no owner, and a card that names none
  // is every one of them (the sets say "all other Battle Cards **you
  // control**" when they mean only yours). The default of `you` is right for
  // an unqualified singular — "choose 1 Battle Card" is your own — but wrong
  // for a sweep, and it made a board wipe clear only the caster's own side.
  //
  // Until 9 Sep 2026 this covered only the phrases saying "other", which left
  // nine sweeps reading as the caster's own board. Five of them say otherwise
  // outright: "ignoring [Barrier]" is dead text unless the choice reaches the
  // opponent, 22-16-2 defining the keyword against "the skills of cards
  // mastered by your opponent" (BT7-110, BT6-018, BT8-137, SD22-02), and
  // BT7-037's "then all players who returned cards to their decks shuffle"
  // presupposes both did. The other four carry no such tell and no Bandai Q&A
  // entry, and are the owner's ruling of 9 Sep 2026, recorded on their rows:
  // BT21-023, BT19-096, BT1-086, TB1-015. BT1-086 was the worst reading in the
  // catalog — "place all Rest Mode Battle Cards except for this card in the
  // Drop Area" read as "move this card to drop", so the card dropped itself
  // and nothing else.
  //
  // Anything printing "your", "their", "opponent" or "you control" keeps the
  // side it just read: "all Battle Cards **in your Drop Area**" (BT7-126) and
  // "all Battle Cards **in your energy**" (BT25-145) are the caster's own.
  // "All" counts only where it is the determiner of the cards — "all Battle
  // Cards", not "―all in Rest Mode―". EX25-35 prints "choose all of your
  // opponent's skill-less Battle Cards **and** Battle Cards with 15000 power
  // or less ―all in Rest Mode―", whose second half arrives here as a fragment
  // with the possessive left behind in the first; its "all" governs a
  // preposition, and taking it would sweep both boards for a rest-lock the
  // card aims at one. That clause reads wrongly either way, and the narrower
  // wrong is the one to leave standing (ground rule 5). The phrase still
  // carries the verb that chose the cards, so this cannot anchor to the front.
  const sweep = /\ball\s+(?!in\b|of\b|the following\b)[a-z]/.test(t) || /\bin all battle areas\b/.test(t);
  // A possessive inside the exclusion belongs to the card being ruled *out*,
  // not to the cards being chosen: TB1-015's "all Battle Cards with 25000 or
  // less power other than this card **or your <Caulifla>**" sweeps both boards
  // and spares one of yours, so the "your" in it must not hold the sweep to
  // your own side.
  const chosen = t.replace(
    /\b(?:other than|except for|besides) (?:copies of )?(?:this card|it)?(?:\s*(?:,|and\/or|and|or)\s*)?(?:(?:your |their |its owner's )?(?:<[^>]+>|≪[^≫]+≫|\{[^}]+\})(?:\s*(?:,|and\/or|and|or)\s*)?)*/g,
    " ",
  );

  // "Your opponent's Battle Cards or Unisons" names two areas at once, which
  // is the one such phrase the game prints often enough to be worth reading.
  const bothAreas = /\bbattle cards?\b[^.]*\b(?:or|and)\b[^.]*\bunisons?\b|\bunisons?\b[^.]*\b(?:or|and)\b[^.]*\bbattle cards?\b/.test(t);

  // "…from your deck or Drop Area", "…in your hand or Warp": a second area
  // joined by "or". `AREA_WORDS` is first-match-wins, so the second one was
  // dropped and the search quietly looked in half the places it should. The
  // catalog prints sixteen such pairs in both orders, so they are read from a
  // table of the area words rather than listed one by one.
  const tTarget = t.replace(/\b(?:for each|for every)\b.*$/, "");
  const both = AREA_PAIR_RE.exec(tTarget) ?? AREA_PAIR_RE.exec(t);
  const pair: [ScriptArea, ScriptArea] | null = both && AREA_NAMED[both[1]] && AREA_NAMED[both[2]] && AREA_NAMED[both[1]] !== AREA_NAMED[both[2]] ? [AREA_NAMED[both[1]], AREA_NAMED[both[2]]] : null;

  let area: ScriptArea | null = null;
  let areaMatch: RegExpExecArray | null = null;
  if (!allAreas && !otherAreas) {
    for (const [re, a] of AREA_WORDS) {
      const match = re.exec(tTarget);
      if (match) {
        area = a;
        areaMatch = match;
        break;
      }
    }
    if (!areaMatch) {
      for (const [re, a] of AREA_WORDS) {
        const match = re.exec(t);
        if (match) {
          area = a;
          areaMatch = match;
          break;
        }
      }
    }
  }
  // The owner is part of the phrase naming the selected area, not necessarily
  // the whole clause: destinations, measures and names routinely carry another
  // player's possessive. When an area (or area pair) is matched, the side comes
  // from the phrase up to and including that area. The whole-clause scan is kept
  // ONLY as a fallback when no area was named ("your opponent's cards", 20-1-6).
  const targetMatch = pair ? both : areaMatch;
  const areaPhrase = targetMatch && t.slice(0, targetMatch.index + targetMatch[0].length);
  const areaOwners = areaPhrase?.match(/\b(?:your opponent'?s|an opponent'?s|the opponent'?s|opponent'?s|opponent|your|their)\b/g);
  const areaOwner = areaOwners?.[areaOwners.length - 1];
  if (areaOwner) {
    if (/opponent|\btheir\b/.test(areaOwner)) side = "opponent";
    else if (areaOwner === "your") side = "you";
  } else if (!targetMatch) {
    if (/\bopponent'?s\b|\byour opponent\b|\btheir\b/.test(owner)) side = "opponent";
    else if (/\bopponent (?:rest mode |active mode |skill-less )?(?:battle|unison|extra|leader|z-battle|z-extra)s?\b/.test(t)) side = "opponent";
  }
  if (/\ball players\b|\beach player\b|\bboth players\b/.test(t)) side = "both";
  if ((otherAdj || sweep) && !/\byour\b|\btheir\b|\bopponent\b|\byou control\b/.test(chosen)) side = "both";
  // "among them" / "of those cards" keeps working on what was just looked at.
  //
  // "**From it**" is the same phrase after a reveal, and the nineteen cards
  // that reveal a hand are where it is printed: "your opponent reveals their
  // hand. Choose up to 1 card with an energy cost of 7 or less **from it** and
  // discard it" (BT16-005) named no area at all, so 20-1-6's "an unqualified
  // card is one on the table" took over and the card discarded was **your
  // own**. Only when a pool exists — with nothing held out, "it" is a pronoun
  // for a later clause to answer and there is no area here to read it as.
  const seen = looked ?? pool;
  const namesPool = /\bamong them\b|\bof those cards\b|\bfrom among them\b|\bof them\b/.test(t) || (!!seen && /\bfrom it\b/.test(t));
  const fromVar = namesPool ? (seen ?? "looked") : looked;
  // "Choose 1 of your <Majin Buu>" names no area, but 20-1-6 says an
  // unqualified card is one on the table. Without this the choice fails, and
  // then every later "it" in the same skill has nothing to point at.
  if (!allAreas && !area && !fromVar && filterFor(phrase, null)) area = "play";
  // The pile under a card is the area, and it was named by words that have
  // already been taken off the phrase.
  if (!allAreas && !area && !fromVar && !underHost) return null;

  let count = 1;
  let upTo = false;
  let m: RegExpExecArray | null;
  if ((m = /\bup to (\d+)\b/.exec(t))) {
    count = Number(m[1]);
    upTo = true;
  } else if (/\ball\b|\bevery\b|\beach\b/.test(t)) {
    count = 99;
    // A digit inside a name is part of the name, not a count: ≪Universe 6≫,
    // <Android 17>, {Ultimate Form Gohan 2}. Read as a number, "your ≪Universe
    // 6≫ cards in your hand" became six of them — the silent mis-read ground
    // rule 5 is about, and it sized every selector naming one of those.
  } else if (
    (m = /\b(\d+)\b/.exec(
      t
        .replace(/<[^>]*>|≪[^≫]*≫|\{[^}]*\}/g, " ")
        .replace(/\d+000\b/g, "")
        .replace(/energy cost (?:of )?\d+/g, "")
        .replace(/\bz-\d/g, ""),
    ))
  ) {
    count = Number(m[1]);
  } else if (/\bcards\b|\benergy\b/.test(t)) {
    // A plural with no number means all of them: "your Battle Cards get +5000 power".
    count = 99;
  }

  // "The top card of your deck", "the bottom 2 cards of their deck": a
  // position, not a choice. 20-12 only lets a player pick out of a secret area
  // when the text says to look, so reading these as a choice would hand the
  // whole deck over.
  let take: number | undefined;
  let fromEnd: boolean | undefined;
  const end = /\bthe (top|bottom) (?:(\d+) )?cards?\b/.exec(t);
  if (end) {
    take = end[2] ? Number(end[2]) : 1;
    if (end[1] === "bottom") fromEnd = true;
  }

  // Which mode the cards must be in. The sets say it two ways and only the
  // prepositional one was read: "1 of your opponent's Battle Cards **in Rest
  // Mode**" and "1 of your opponent's **Rest Mode** Battle Cards" are the same
  // card, and seventy skills print the second. Read without it, BT23-109's
  // "choose up to 1 of your opponent's Rest Mode Battle Cards and KO it" was
  // offered every Battle Card the opponent had — a KO aimed at a card that had
  // already attacked, pointed at whatever you liked.
  //
  // The mode words also name a *destination* — "switch this card **to** Rest
  // Mode", "play it **in** Rest Mode" — which is not a description of what to
  // pick. The attributive reading is therefore taken only in front of a noun,
  // where a destination never stands.
  const modeSaid = (which: "rest" | "active"): boolean =>
    new RegExp(`\\bin ${which} mode\\b|\\b${which} mode (?:[a-z-]+ )*cards?\\b`).test(t);
  const mode = modeSaid("rest") ? "rest" : modeSaid("active") ? "active" : undefined;
  // 23-5: "Hidden Mode" is a card's face-down state, not the active/rest
  // orientation `mode` reads — a card is one of Active or Rest *and*
  // separately Hidden or Revealed (`inst.hidden` is its own flag in
  // `CardInstance`, not a third value of `mode`). Same two spellings as
  // above ("1 of your **Hidden Mode** cards", "1 of your energy **in Hidden
  // Mode**"), read only when nothing else narrows the choice: a face-down
  // card has none of its front-side information (23-5-2), so a selector
  // combining Hidden Mode with a colour, character or trait cannot be
  // answered and is refused below rather than quietly widened to "any card"
  // (ground rule 5) — the catalog does not print that combination today, but
  // this is the seam where it would appear.
  const hiddenSaid = /\bin hidden mode\b|\bhidden mode (?:[a-z-]+ )*(?:cards?|energy)\b/.test(t);
  // "Choose all Battle Cards **other than this card**" — the card the phrase
  // rules out. Read as nothing it stayed among the candidates, so a clause
  // that shrank every Battle Card shrank this one too.
  const excluded = /\b(?:other than|except for|besides) (copies of )?this card\b/.exec(t);
  const notSelf = excluded ? (excluded[1] ? "copies" : "card") : otherAdj ? "card" : undefined;
  const filter = filterFor(phrase, area);
  // A description the parser could not read is not a target: the clause fails
  // and the skill goes to the referee, rather than selecting the whole area.
  if (filter === null) return null;
  // A face-down card carries none of the information `filter` would check
  // (23-5-2) — "Hidden Mode" combined with anything else is not a choice this
  // engine can answer, and refusing it beats reading "Hidden Mode" away and
  // offering every card the other measure matches (ground rule 5).
  if (hiddenSaid && filter) return null;
  const hidden = hiddenSaid || undefined;
  if (underHost) return { side: "you", area: "under", filter, count, upTo, mode, hidden, notSelf };
  // No single `area` stands for all of them, and leaving one on would be read
  // as the place the cards must be — so the span is the only thing said.
  if (allAreas) return { side, areas: ALL_AREAS, filter, count, upTo, mode, hidden, notSelf };
  if (otherAreas) return { side, areas: otherAreas, filter, count, upTo, mode, hidden, notSelf };
  if (bothAreas) return { side, area: "battle", areas: ["battle", "unison"], filter, count, upTo, mode, hidden, fromVar, notSelf };
  if (pair) return { side, area: pair[0], areas: pair, filter, count, upTo, mode, hidden, fromVar, notSelf };
  return { side, area: area ?? undefined, filter, count, upTo, mode, hidden, fromVar, take, fromEnd, notSelf };
}

/**
 * What an [Auto]'s trigger clause said about the card it is *about*, when it
 * said more than "a card" (9-6-2).
 *
 * Only the shapes where the subject is unambiguous — the player playing a card
 * and the card being played or attacking. Anything else returns nothing, and a
 * trigger with no filter fires as it always did: an over-fire is bad, but a
 * *wrong* filter would stop a skill that should happen, which is worse.
 */
function subjectFilterOf(trigger: string): CardFilter | undefined {
  const t = trigger
    .toLowerCase()
    .replace(/^\s*when\s+/, "")
    .replace(/[,.]\s*$/, "")
    .trim();
  const phrase =
    /^(?:your opponent|you) plays? (?:an?|1|up to \d+|\d+) (.+?)(?: (?:from|in|to|with|by) .*)?$/.exec(t)?.[1] ??
    // The word "card" stays in the phrase: taking it out of the capture let
    // the lazy group stop at "battle", and "battle" alone narrows nothing.
    /^(?:your|your opponent's) (.+?) is played\b/.exec(t)?.[1] ??
    /^(?:your|your opponent's) (.+?) attacks\b/.exec(t)?.[1] ??
    // "When your blue <Son Goku> card is KO'd" — the same question about the
    // card that just died (21-14).
    /^(?:your|your opponent's|an opponent's|one of your|one of your opponent's) (.+?) (?:is|are) ko'd\b/.exec(t)?.[1] ??
    null;
  // "A Battle Card **or** Unison Card" is two kinds, and `parseFilter` keeps
  // only one of them — which would stop the skill on the other. A filter that
  // is wrong in that direction is worse than no filter at all, so alternatives
  // are refused outright.
  if (!phrase) return undefined;
  // …but "an energy cost of 5 **or** less" is one bound, not two kinds, and
  // `parseFilter` reads it whole.
  if (/ or /.test(phrase.replace(/\b\d+ or (?:less|fewer|more|greater|higher|lower)\b/g, ""))) return undefined;
  // A trigger whose subject description cannot be read is left unfiltered
  // rather than failed: an over-fire is bad, a filter that stops a skill that
  // should happen is worse (ground rule 6).
  return filterFor(phrase, null) ?? undefined;
}

/**
 * "…by **choosing** 1 card and **placing** it in your Drop" → "choose … place
 * …". A price that hangs off "by" is written as a gerund, and every action
 * pattern in the compiler is written in the imperative.
 */
const GERUNDS: Record<string, string> = {
  choosing: "choose",
  placing: "place",
  putting: "put",
  discarding: "discard",
  returning: "return",
  switching: "switch",
  adding: "add",
  sending: "send",
  removing: "remove",
  playing: "play",
  paying: "pay",
  drawing: "draw",
  revealing: "reveal",
};

function imperative(clause: string): string {
  return clause.replace(/^\s*([a-z]+ing)\b/i, (whole, word: string) => GERUNDS[word.toLowerCase()] ?? whole);
}

/**
 * "You can activate this card's [Counter] skill from your hand …" (5-3): the
 * card's own offer of another way to pay for it.
 *
 * The two halves are printed in either order — "…**without paying its energy
 * cost** by discarding 1 blue card" and "…by adding a card from your life to
 * your hand **instead of paying its energy cost**" say the same thing — and the
 * waiver is not the price. Anything the card asks for beyond the two fixed
 * kinds is an *action* price (4-3-3) in the same vocabulary as a printed one,
 * so the same reader compiles it; most of them ask the player to pick a card,
 * which is why the engine charges that one through the flow rather than inline.
 */
/** One entry per orb — `{r: 2}` becomes `["Red", "Red"]` — the shape `altCost`'s `orbs` field takes (5-3). */
function orbsToList(orbs: Partial<Record<Color, number>> & { any?: number }): (Color | "any")[] {
  const out: (Color | "any")[] = [];
  for (const [k, n] of Object.entries(orbs)) for (let i = 0; i < (n ?? 0); i++) out.push(k as Color | "any");
  return out;
}

/**
 * The "…" half of "you can activate […] from your hand …" (5-3): what the
 * card asks for instead of the energy cost. Shared by the self-only reading
 * (`counterAltCost`, below) and the one that grants the same offer to *other*
 * cards for a span (BT11-033) — the price is worded identically either way,
 * only who it is about differs.
 */
function altCostHow(rawHow: string, c: Ctx): Op[] | null {
  // "Their energy costs" (plural) is how the same waiver reads when it is
  // granted to more than one card at once (BT11-033) rather than printed on
  // the one card paying it — "its"/"the" everywhere else.
  const how = rawHow.replace(/^without paying (?:its|the|their) energy costs?,? /, "").replace(/,? instead of (?:paying )?(?:its|the|their) energy costs?$/, "");
  if (/^without paying (?:its|the|their) energy costs?$/.test(how)) return [{ op: "altCost", pay: "none" }];
  let m: RegExpExecArray | null;
  if ((m = /^by adding (a|an|\d+) cards? from your life to your hand$/.exec(how))) {
    return [{ op: "altCost", pay: "life", n: countWord(m[1]) }];
  }
  // "By paying {1}" (BT18-088): a reduced but still-energy price, not a free
  // one — `program` has no op that rests energy as a cost, and reading this
  // as one would have offered the [Counter] for a choice that costs nothing.
  if ((m = /^by paying ((?:\{[a-z0-9]+\})+)$/i.exec(how))) {
    const orbs = orbsToList(orbsIn(m[1]));
    if (orbs.length) return [{ op: "altCost", pay: "energy", orbs }];
  }
  if ((m = /^by (.+)$/.exec(how))) {
    const unread: string[] = [];
    // A fresh variable counter well clear of the effect's own, because the
    // price is a program of its own that runs before the skill.
    const price = compileClauseList(splitClauses(m[1]).map(imperative), { ...c, n: c.n + 50, last: null, lastTarget: null, stale: null, twoNamedCardsRefused: false }, unread);
    if (price.length && !unread.length) return [{ op: "altCost", pay: "program", ops: price }];
  }
  return null;
}

function counterAltCost(sentence: string, c: Ctx): Op[] | null {
  const said = /^activate this card's \[counter[^\]]*\](?: skill)? from your hand (.+?)\.?$/.exec(sentence);
  if (!said) return null;
  return altCostHow(said[1], c);
}

/** Only keep a filter when the phrase actually narrows the cards. */
/**
 * Three answers, and the difference between the last two is the whole point:
 * a `CardFilter` narrows the selection, `undefined` means the description said
 * nothing that narrows it, and **`null` means the description could not be
 * read** — a bracketed word that is neither a keyword nor a skill kind. Only
 * the first two may pass; `null` has to fail the clause, or "mono-blue cards
 * with a [Counter] skill" goes on choosing any mono-blue card (ground rule 5).
 */
function filterFor(phrase: string, area: ScriptArea | null): CardFilter | null | undefined {
  const f = parseFilter(phrase);
  if (f.unreadable) return null;
  // In an area that only holds one kind of card, the type word is noise — and
  // it has to go before the question of whether anything narrows, or "your
  // Battle Cards" would count as narrowed by a word that means nothing there.
  if (area === "battle" && f.type === "BATTLE") f.type = null;
  if (area === "leader" && f.type === "LEADER") f.type = null;
  // "Play" spans both areas, so naming either type narrows nothing there.
  if (area === "play" && (f.type === "BATTLE" || f.type === "LEADER")) f.type = null;
  const narrows =
    f.type != null ||
    f.notType != null ||
    f.multiColor ||
    // "Place up to 1 red <Android 17> card from your deck under a Z-Extra":
    // being a Z-card is the only thing said about the host.
    f.z != null ||
    f.characters.length > 0 ||
    f.notCharacters.length > 0 ||
    f.traits.length > 0 ||
    f.notTraits.length > 0 ||
    f.names.length > 0 ||
    f.costMin != null ||
    f.costMax != null ||
    f.powerMin != null ||
    f.powerMax != null ||
    f.powerRel != null ||
    f.monoColor ||
    // A colour narrows an energy area as much as any other: "your blue energy"
    // is not "your energy".
    f.colors.length > 0 ||
    // A measure that says what a card must *not* be narrows just as much, and
    // leaving these off the list threw the whole filter away — so "2 non-black
    // Battle Cards" chose black ones as happily as any other.
    f.notColors.length > 0 ||
    f.notKeywords.length > 0 ||
    // Every measure has to be on this list, or a description whose *only*
    // measure is that one counts as saying nothing and the filter is thrown
    // away — the same silent widening the measures exist to prevent. These
    // four were each added without being listed here.
    f.keywords.length > 0 ||
    f.skillKind != null ||
    f.noKeywords ||
    f.notNames.length > 0 ||
    f.token ||
    f.notToken ||
    // A name asked for *in part* is a measure like any other, and these four
    // were the next ones added without being listed — so a description whose
    // only measure was one of them threw the whole filter away. "Choose up to
    // 1 of your Battle Cards **with <Son Gohan> in its character name**"
    // (BT19-130) chose any Battle Card you had: the type word is noise in the
    // Battle Area and is struck out above, which left nothing on this list at
    // all. `parseFilter` had read the name the whole time.
    f.charactersIncluding.length > 0 ||
    f.notCharactersIncluding.length > 0 ||
    f.namesIncluding.length > 0 ||
    f.notNamesIncluding.length > 0 ||
    f.faceUp;
  if (!narrows) return undefined;
  return f;
}

// ── clause patterns ────────────────────────────────────────────────────────

interface Ctx {
  /** The variable the last `choose` bound. */
  last: string | null;
  /**
   * Every choice the skill has made so far, in order. "The chosen card" means
   * the last one, but a skill that chooses twice has to name them apart —
   * "place **the chosen opponent Battle Card** under **the chosen <Majin
   * Buu>**" (BT3-052, BT3-054) — and the description is what says which.
   */
  choices: { var: string; sel: Selector }[];
  /**
   * A [Permanent] never *acts*, so its "you can …" is a standing permission
   * rather than an offer to do something now (9-5-1) — and wrapping one in a
   * decision hides it from the static layer entirely.
   */
  permanent: boolean;
  /**
   * The variable the last `look` or `reveal` bound: the cards held out in
   * front of the player, which a following clause may pick *out of* — "look at
   * the top 3 cards of your deck, add 1 of them to your hand", "choose up to
   * 1". Only a look or a reveal makes such a pool.
   */
  lastSeen: string | null;
  /**
   * The last name bound to cards the sentence can point back at with "that
   * card": a look, a reveal, or a mill, whose cards go to the Drop face up.
   *
   * Kept apart from `lastSeen` because the two are not the same claim. A mill
   * gives the sentence something to talk about, but not a pool to draw from —
   * its cards are in the Drop already, and reading "add 1 card to your hand"
   * as taking one of them moves a card the text never offered.
   */
  lastNamed: string | null;
  /** The variable bound by the last "play …" choice — what "the card you played with this skill" means. */
  lastPlayed: string | null;
  /**
   * What "it"/"them" points at. Card text carries the subject from clause to
   * clause — "Switch this card to Active Mode and it gets +5000 power" means
   * this card — so the last target of any clause counts, not only a choice.
   */
  lastTarget: Ref | null;
  /**
   * The antecedent that was standing when a clause in this skill went unread.
   *
   * A refusal is not silent for the clauses after it: the sentence goes on
   * talking about what the refused clause named, and there is nothing bound to
   * it. An [Auto] seeds the antecedent to the card it is on, so "…, and **it**
   * gains [Double Strike]" after an unread play lands on the card printing the
   * skill (P-645). Held by identity, not as a flag: any clause that does bind
   * something new writes a fresh `lastTarget`, and the reference after it is
   * pointing at that rather than at the hole.
   */
  stale: Ref | null;
  /**
   * Set once a refused clause was itself a two-named-card search
   * (`TWO_NAMED_CARDS`, in `parseTarget`) — the one case where a plural
   * pronoun after a stale target must not fall back to it even though the
   * stale target is not `self`. See the `c.stale` check in `refFor` for why
   * this is narrower than generalising that check to every subject.
   */
  twoNamedCardsRefused: boolean;
  /** The op the previous clause produced, for wordings that restate it. */
  lastOp: string | null;
  /**
   * Set by "if this card would leave the Battle Area": the *next* clause says
   * where it goes instead, so it becomes a replacement rather than a move
   * (9-10).
   */
  replacing: { by?: "skill" | "ko" | "skillOrKo"; subject?: string } | null;
  n: number;
  /**
   * A counter of its own for the names a mill binds, so `n` keeps its count.
   *
   * A skill's price and its effect are compiled separately and both start at
   * `c0`, and that collision is load-bearing: `runSkill` merges the price's
   * bindings into the effect's frame by name, which is how "the chosen card"
   * in an effect means the card its cost chose (4-3-3). Spending `n` on a mill
   * would push the effect's own first choice to `c1`, leaving the price's `c0`
   * alive underneath it — and a later reference then moves the card the price
   * already spent.
   */
  mills: number;
  /**
   * And another for the names an optional price binds, and for the same
   * reason: `n` is the counter the price/effect merge leans on, so spending
   * it here would leave the price's own `c0` alive under the effect's first
   * choice.
   */
  costs: number;
  /** The skill text with its explanatory notes still in place. A token's stats are printed there. */
  raw: string;
}

/** "A marker", "an energy" — the article is the number one. */
const countWord = (w: string) => (/^\d+$/.test(w) ? Number(w) : 1);

/**
 * The counts a printed price may be spelled out as. Only as far as the
 * wordings that use them go: a word this does not carry must not quietly
 * become a number.
 */
const WORD_COUNTS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3 };

/**
 * "You may place 1 card from your hand in the Drop Area" — an optional price,
 * matched against the clause as printed rather than against `t`, because `t`
 * has the "you may" that makes it optional taken off it already.
 */
const OPTIONAL_HAND_PRICE = /^(?:you may|you can|the player may) place (\d+|an?|one|two|three) cards? (?:from|in) your hand in(?:to)? (?:your |the )?drop(?: area)?$/i;

/**
 * Words that point back at whatever the previous clause acted on.
 *
 * "Their" is not one of them *inside a phrase*: it is a possessive far more
 * often than a pronoun, so "1 Battle Card from **their** Drop Area" was read
 * as whatever the trigger had last named. A phrase that is nothing but the
 * possessive — "negate **their** skills for the turn", where the noun after it
 * has already been stripped — is the pronoun after all, and `BARE_IT` covers
 * that.
 */
const IT = /\b(?:it|its|them|they|that card|those cards|the chosen cards?)\b/;
const BARE_IT = /^(?:it|its|them|they|their|that card|those cards)$/i;
/** The pronouns that can only mean more than one card — see `refFor`. */
const PLURAL_IT = /^(?:them|they|their|those cards)$/i;

/**
 * A target phrase without its trailing modifier: "1 {Piccolo} from your deck
 * **with its skills negated for the turn**" names the Piccolo, and everything
 * from the "with" onwards describes it rather than pointing anywhere else.
 * Both the pronoun test and the "this card's power" test in `refFor` ask about
 * the head only, and for the same reason.
 */
function headOf(clause: string): string {
  return clause.replace(/\s+(?:with|on top of|beneath)\b.*$/i, "");
}

/**
 * "The chosen opponent Battle Card", "the chosen <Majin Buu>" — which of the
 * choices the skill already made this one means (5-2).
 *
 * The description is matched against what each `choose` actually asked for:
 * whose cards, what type, which characters, traits, names and colours. Every
 * discriminator the phrase carries has to be one the choice asked for, so
 * "opponent" can never come back with your own card. Only a single clear
 * winner is returned — a tie, or a phrase with nothing to tell them apart, is
 * left to the referee, because naming the wrong half of a two-card choice
 * moves the wrong card.
 */
function chosenRef(desc: string, c: Ctx): Ref | null {
  if (!c.choices.length) return null;
  const want = parseFilter(desc);
  const t = desc.toLowerCase();
  const side: Side | null = /\bopponent'?s?\b/.test(t) ? "opponent" : /\byour\b|\byou control\b/.test(t) ? "you" : null;
  const covers = (have: readonly string[], need: readonly string[]) => need.every((n) => have.some((h) => h.toLowerCase() === n.toLowerCase()));

  let best: { name: string; score: number } | null = null;
  let tied = false;
  for (const ch of c.choices) {
    const f = ch.sel.filter;
    if (side && ch.sel.side && ch.sel.side !== side) continue;
    // A type the choice did not state is unknown, not a mismatch: "1 of your
    // opponent's Battle Cards" is read as the Battle Area, which leaves
    // `type` null on a filter that means Battle Cards all the same.
    if (want.type && f?.type && want.type !== f.type) continue;
    if (!covers(f?.characters ?? [], want.characters)) continue;
    if (!covers(f?.traits ?? [], want.traits)) continue;
    if (!covers(f?.names ?? [], want.names)) continue;
    if (!covers(f?.colors ?? [], want.colors)) continue;
    let score = want.characters.length + want.traits.length + want.names.length + want.colors.length;
    if (side && ch.sel.side === side) score++;
    if (want.type && f?.type === want.type) score++;
    // "The chosen card" says nothing that picks one of them out; the plain
    // back-reference is what that means.
    if (!score) continue;
    if (!best || score > best.score) {
      best = { name: ch.var, score };
      tied = false;
    } else if (score === best.score) tied = true;
  }
  return best && !tied ? { var: best.name } : null;
}

function refFor(clause: string, c: Ctx): Ref | null {
  // "Play up to 1 red ≪Universe 7≫ card from **under this card**" — here
  // "this card" says where to look, or where the card goes, not which card is
  // meant. Taken as the target it played this card instead (23-2).
  // "Above this card" is struck out with the rest of them, or the "this card"
  // inside it answers the phrase before `parseTarget` ever sees it: BT20-091
  // and BT20-092 print "the card **above this card** gains [barrier]" and
  // "…can't be KO'd", and both landed on the card underneath.
  const named = clause.replace(/\b(?:from |place )?(?:under|on top of|above|beneath) this card\b/gi, "");
  // Two ways a phrase mentions this card without meaning it, both of which
  // this test used to read as "this card" because it only asked whether the
  // words appeared at all:
  //
  // - "**other than** this card", "other than **copies of** this card" names
  //   the one card the target is not. "Add up to 1 card from your Drop other
  //   than this card to your hand" added this card, and "play up to 1 ≪Demon
  //   Clan≫ card among them other than copies of this card" played this card.
  //   The wording is matched whole rather than by a bare "other", so "you
  //   can't play this card from any area with skills other than [Revive
  //   Blue/Green]" still means this card. "**Except for** this card" is the
  //   same exclusion said the other way, and reading it as a mention rather
  //   than an exclusion is what made BT1-086's "place all Rest Mode Battle
  //   Cards except for this card in the Drop Area" drop the card printing it.
  // - "this card's **power**" in a trailing measure describes some *other*
  //   card: "return 1 of your opponent's Battle Cards with power less than or
  //   equal to this card's power to their hand" returned this card. Only in
  //   the trailing measure, because "**this card's skills** can't be negated"
  //   and "you can activate **this card's** [Activate: Battle]" are about this
  //   one — which is the same head/tail distinction the pronoun test below
  //   makes, for the same reason.
  const mentions = named.replace(/\b(?:other than|except for|besides) (?:copies of )?this card\b/gi, " ");
  if (/\bthis card\b(?!'s)/i.test(mentions) || /\bthis card's\b/i.test(headOf(mentions))) return { sel: { special: "self" } };
  // "…play up to 1 card from under this card, and place this card under the
  // played card": the card this skill just played, if it played one; otherwise
  // the card the trigger was about ("When you play a <Goku> card, …").
  if (/\bthe played card\b|\bthe card (?:that was |you )?played(?: with this skill)?\b/i.test(clause)) {
    if (c.lastPlayed) return { var: c.lastPlayed };
    return c.last ? { var: c.last } : { sel: { special: "subject" } };
  }
  // "Add a marker to the chosen card": the last choice. "**Cards chosen with
  // this card's skill** can't be switched to Active Mode" is the same thing
  // said the long way, and it used to read as this card — so the restriction
  // landed on the card printing it instead of on what it had just chosen.
  if (/\bcards? chosen with this card'?s skill\b/i.test(clause)) return c.last ? { var: c.last } : c.lastTarget;
  // "The chosen …" always points back at a choice already made, so it is
  // answered here or not at all — reading it as a fresh description would turn
  // "the chosen <Majin Buu>" into every <Majin Buu> you have.
  if (/\bthe chosen\b/i.test(clause)) {
    // "Place the chosen opponent Battle Card under the chosen <Majin Buu>":
    // which choice it means, when the phrase says enough to tell.
    const ref = chosenRef(clause, c);
    if (ref) return ref;
    // "Add a marker to the chosen card": nothing to tell them apart, so it is
    // the last choice, as it has always been.
    if (/\bthe chosen cards?\b/i.test(clause)) return c.last ? { var: c.last } : c.lastTarget;
    return null;
  }
  // "Add up to 1 <Son Goku> card among them to your hand" names its own target
  // and only says *where to look* for it. Read before "it"/"them", which would
  // otherwise take the "them" and hand back whatever the last clause acted on.
  if (/\b(?:among them|from among them|of those cards)\b/i.test(clause)) {
    const among = parseTarget(clause, undefined, c.lastSeen ?? undefined);
    if (among) return { sel: among };
  }
  // A pronoun inside a trailing modifier is not pointing at an earlier clause,
  // it is describing the card this phrase already named: "play up to 1
  // {Piccolo} from your deck **with its skills negated for the turn**" is
  // about the Piccolo. Only the head of the phrase can carry an antecedent, so
  // that is what is tested — 66 choices were resolving to this card because
  // the "its" of a trailing "with …" was read as a reference.
  const head = headOf(clause);
  if (IT.test(head.toLowerCase()) || BARE_IT.test(head.trim().replace(/[.,]$/, ""))) {
    // A **plural** pronoun answered by *this card* is a category error, and it
    // is what a failed clause earlier in the sentence leaves behind: an [Auto]
    // seeds the antecedent to the card it is on, so when "choose any number of
    // you and your opponent's Battle Cards and Unison Cards" goes unread, the
    // "those cards" after it lands on the card printing the skill — BT13-106
    // negating itself instead of the whole board. Nothing was lost by the
    // clause that named the cards; something was, and this says so (ground
    // rule 5).
    if (PLURAL_IT.test(head.trim().toLowerCase().replace(/[.,]$/, "")) && !c.last && c.lastTarget && "sel" in c.lastTarget && c.lastTarget.sel.special === "self") return null;
    // The singular half of the same bug, which the plural test cannot reach:
    // "it" after "when this card is played" usually *does* mean this card, so
    // the seeded antecedent is only wrong once a clause between the seeding
    // and the pronoun has gone unread. `c.stale` is that ref, held by
    // identity, so a clause that bound something of its own since clears it —
    // P-645's "it gains [Double Strike]" follows a play the compiler refused
    // and belongs to the card that play would have brought out.
    if (c.stale && c.stale === c.lastTarget && "sel" in c.lastTarget && c.lastTarget.sel.special === "self") return null;
    // The same trap with a *different* stale target: "if your Leader Card is
    // a red ≪Saiyan≫ card, choose 1 <A> card and 1 <B> card from your Drop
    // Area and add **them** to your hand" (BT6-012, and P-095, P-108 beside
    // it) leaves the leader as the last-bound target once the two-named-card
    // choice between them is refused (`parseTarget`'s `TWO_NAMED_CARDS`
    // guard), and "them" then read as *your Leader*, sent to hand — a card
    // the skill never named at all. `c.twoNamedCardsRefused` is set only by
    // that one refusal, so this stays as narrow as the bug it answers rather
    // than widening the check above to every stale target, which silenced far
    // more of the catalog than this family accounts for.
    if (c.twoNamedCardsRefused && c.stale === c.lastTarget) return null;
    if (c.lastTarget) return c.lastTarget;
    if (c.last) return { var: c.last };
    return null;
  }
  const sel = parseTarget(clause);
  if (sel) return { sel };
  return null;
}

/**
 * "This card **and** your Leader get +5000 power", "**it** and this card get
 * -10000 power": one verb, two targets. Keeping the halves in one clause is
 * only half the job — read as a single subject, the power lands on one of them
 * and the other is silently missed, which is worse than the fragment it used
 * to leave behind.
 *
 * Only split when the first half is a bare way of naming a card. "All of your
 * opponent's Battle Cards and Unisons" is one target phrase naming two areas,
 * and must not be cut in half.
 */
const BARE_TARGET = /^(?:this card|it|they|them|that card|those cards|your leader(?: card)?|the chosen cards?)$/i;

function refsFor(phrase: string, c: Ctx): Ref[] | null {
  const parts = phrase
    .split(/\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1 && BARE_TARGET.test(parts[0])) {
    const out: Ref[] = [];
    for (const part of parts) {
      const r = refFor(part, c);
      if (!r) return null;
      out.push(r);
    }
    return out;
  }
  const one = refFor(phrase, c);
  return one ? [one] : null;
}

/**
 * A target with a number in it ("1 card from your Drop", "up to 2 of your
 * opponent's Battle Cards") is a choice before it is anything else: the
 * interpreter resolves a selector to *every* card it matches, so an action
 * handed the selector directly would take them all. Bare plurals ("your
 * opponent's Battle Cards") carry no count and do mean all of them.
 */
function withChoice(ref: Ref, clause: string, c: Ctx, act: (target: Ref) => Op): Op[] {
  if ("sel" in ref && !ref.sel.special && ref.sel.take == null && ref.sel.count != null && ref.sel.count < 99) {
    const v = `c${c.n++}`;
    return [{ op: "choose", sel: ref.sel, as: v, reason: clause }, act({ var: v })];
  }
  return [act(ref)];
}

function durationOf(clause: string): Duration {
  const t = clause.toLowerCase();
  if (/for the (?:duration of (?:the|this) )?battle|during this battle/.test(t)) return "battle";
  if (/for the (?:duration of (?:the|this) )?game|during the game|in any area|in all areas/.test(t)) return "game";
  if (/until (?:the start of )?your opponent's next turn/.test(t)) return "opponentTurn";
  // Your *own* next Charge Phase is one step past "your next turn": the effect
  // has to be there when the Active Step runs (7-2-7).
  if (/during your next charge phase/.test(t)) return "afterNextCharge";
  // Everything that has to survive the opponent's whole turn and end as yours
  // begins: the rest-lock wordings, which are the same duration said four ways.
  if (/until the end of your opponent's(?: next)? turn|until the (?:start|beginning) of your next turn|during your opponent's next charge phase|during your opponent's next turn/.test(t))
    return "nextTurn";
  return "turn";
}

/**
 * "If this card would leave the Battle Area" (9-10). The phrase says nothing
 * about what happens — the clause after it does — so what is returned is only
 * the fact that a replacement follows, and what caused the departure.
 *
 * "By your opponent's skills" is deliberately not read: `move` knows a skill
 * put the card out but not whose, and guessing would let the wrong cards
 * escape.
 */
function parseWouldLeave(clause: string): { by?: "skill" | "ko" | "skillOrKo"; subject?: string } | null {
  const t = clean(clause);
  if (/your opponent'?s? skills?/.test(t)) return null;
  // "Would … the Battle Area" is the hypothetical phrasing; six cards
  // (BT14-153, BT14-154, BT15-153, BT15-154, BT16-107, BT17-148) print the
  // same rule as an accomplished fact — "if/when this card **is** removed
  // from your Battle Area" — one word short of the modal this opener used to
  // require. Read the same way: "is removed from" carries no cause of its
  // own, so it defaults to "skill" exactly as "would be removed from" does.
  const opener = /^(?:if|when)?\s*(.*?) (?:would (leave|be removed from|be sent from)|is (removed from)) (?:your |the |a )?battle area(?: by (?:a|your) skills?)?( or (?:be )?ko'?d)?$/.exec(t);
  if (opener) {
    const verb = opener[2] ?? opener[3];
    // "Removed from a Battle Area by a skill or KO'd" covers both causes;
    // "would leave" covers every cause, so it has no restriction at all.
    const by = verb === "leave" ? undefined : opener[4] ? ("skillOrKo" as const) : ("skill" as const);
    const who = opener[1].trim();
    // "A ≪Slug's Army≫ card with a combo cost of 1 would leave your Battle
    // Area" — the rule is about other cards, so the subject is kept.
    if (/^(?:this card|it)$/.test(who)) return { by };
    return who ? { by, subject: who } : { by };
  }
  // "A ≪Turles Crusher Corps≫ card in your Battle Area would be placed in its
  // owner's Drop Area by one of your skills" (BT12-056(+b), BT15-092(+b),
  // BT15-097) — the ordinary route out (a skill sending it to the Drop) named
  // in full rather than as "leave"/"removed from" the Battle Area. Same
  // event, same default cause.
  const droppedBySkill = /^(?:if|when)?\s*(.*?) in (?:your |the )?battle area would be placed in (?:its owner'?s?|their owners?'?s?|your|their) drop area by (?:a|one of your) skills?$/.exec(t);
  if (droppedBySkill) {
    const who = droppedBySkill[1].trim();
    if (/^(?:this card|it)$/.test(who)) return { by: "skill" };
    return who ? { by: "skill", subject: who } : { by: "skill" };
  }
  // "When this card is placed in a Drop Area from a Combo Area" (P-182) / "…
  // from a Battle Area or Combo Area" (DB2-137/140/151/153) is deliberately
  // NOT read as the same replacement: `move()` (state.ts:857) only checks
  // `replaceLeave` when the card was leaving `leader`/`battle`/`unison`
  // (`wasInPlay`) — leaving the *Combo Area* (`wasCombo`) never reaches that
  // check at all. Reading these as "removed from the Battle Area" would be
  // wrong twice over: for P-182 the compiled rule would never fire (its only
  // path out is the Combo Area), and for the DB2 cards it would fire too
  // often — misapplying the redirect to a Battle-Area departure the printed
  // text does gate on "or Combo Area" for, but that path itself still can't
  // be read. Left unread rather than read wide (ground rule 5).
  // "If this card would be KO'd" replaces the KO and nothing else: a card its
  // owner returns to hand is still returned to hand.
  if (/^(?:if|when)?\s*(?:this card|it) would be ko'?d$/.test(t)) return { by: "ko" };
  return null;
}

/**
 * Timings that push the rest of the sentence into the future (1-7-2-1-1):
 * "At the end of the turn, KO it", "During your opponent's next turn, …".
 * Everything after the phrase becomes a delayed program rather than something
 * that happens now — which, until this existed, the compiler could not say at
 * all, so the whole skill went to the referee.
 */
const DELAY_PATTERNS: [RegExp, DelayTiming, DelayScope][] = [
  [/at (?:the )?end of your next turn/, "turnEnd", "yourNextTurn"],
  [/at (?:the )?end of your opponent's (?:next )?turn/, "turnEnd", "opponentNextTurn"],
  [/at (?:the )?end of (?:this |the |your )?turn/, "turnEnd", "thisTurn"],
  [/at (?:the )?end of (?:this|the) battle/, "battleEnd", "thisTurn"],
  [/at the (?:start|beginning) of your next main phase/, "mainStart", "yourNextTurn"],
  [/at the (?:start|beginning) of your opponent's next main phase/, "mainStart", "opponentNextTurn"],
  [/at the (?:start|beginning) of your opponent's next turn/, "turnStart", "opponentNextTurn"],
  [/at the (?:start|beginning) of your next turn/, "turnStart", "yourNextTurn"],
  [/at the (?:start|beginning) of the next turn/, "turnStart", "nextTurn"],
  [/during your opponent's next turn/, "turnStart", "opponentNextTurn"],
  [/during your next turn/, "turnStart", "yourNextTurn"],
];

const clean = (clause: string) => clause.toLowerCase().trim().replace(/[.]$/, "");

/** Longest match wins: "your next turn" also matches the plainer "your turn". */
function bestDelay(t: string, anchor: (src: string) => RegExp): { at: DelayTiming; scope: DelayScope; m: RegExpExecArray } | null {
  let best: { at: DelayTiming; scope: DelayScope; m: RegExpExecArray } | null = null;
  for (const [re, at, scope] of DELAY_PATTERNS) {
    const m = anchor(re.source).exec(t);
    if (!m) continue;
    if (best && best.m[0].length >= m[0].length) continue;
    best = { at, scope, m };
  }
  return best;
}

function parseDelayClause(clause: string): { at: DelayTiming; scope: DelayScope; label: string; rest: string } | null {
  const t = clean(clause);
  const best = bestDelay(t, (src) => new RegExp(`^${src}`));
  if (!best) return null;
  return { at: best.at, scope: best.scope, label: best.m[0], rest: t.slice(best.m[0].length).replace(/^[\s,:]+/, "") };
}

/**
 * The same timing written at the other end of the clause: "Flip this card over
 * at the end of the turn". "until the end of the turn" is a *duration*, not a
 * timing, so a head ending in a linking word is left alone.
 */
function parseTrailingDelay(clause: string): { at: DelayTiming; scope: DelayScope; label: string; head: string } | null {
  const t = clean(clause);
  const best = bestDelay(t, (src) => new RegExp(`^(.+?)[\\s,]+(?:${src})$`));
  if (!best) return null;
  const head = best.m[1].trim();
  if (!head || /\b(?:until|through|for|by)$/.test(head)) return null;
  return { at: best.at, scope: best.scope, label: best.m[0].slice(head.length).trim(), head };
}

/**
 * Conditions a skill puts in front of its effect ("If your Leader is red, …").
 * Everything after the condition becomes conditional on it (9-1-3).
 */
/**
 * What a skill prints before its colon, with the orbs and any explanatory note
 * taken off — "{r}{r}, if your Leader is a green <Broly> card and you have 2
 * or more energy" leaves the condition alone.
 *
 * `activatable` in `engine.ts` and `compileSkill` both have to read this the
 * same way. They did not: both tested the *raw* cost for a leading "if", which
 * a card that also costs orbs never has, so the condition was neither checked
 * before offering the skill nor applied to the program.
 */
export function costText(cost: string): string {
  return stripNotes(cost)
    .replace(/^(?:\{[^}]*\}|\s|,)+/, "")
    .trim();
}

/**
 * The *action* a price charges: "switch this card to Rest Mode", "choose 1
 * card in your hand and place it in your Drop Area" (4-3-3). It is the same
 * vocabulary as an effect, so it is compiled by the same code — what makes it
 * a cost is only where it is printed. A price that states a condition first
 * has been cut in two by `splitPrice`, and this is the second half; the first
 * is `priceCondition`, and the two are read together, never as alternatives.
 *
 * Whether the engine may actually charge it is a separate question, answered
 * by `canPayCostProgram` in `engine.ts`; a program this returns is not yet a
 * price the player can pay.
 */
export function compileCostProgram(skill: Skill): Script | null {
  return splitPrice(skill).program;
}

const costPrograms = new Map<string, Script | null>();

/**
 * Compile one piece of price text as a program. Memoised on the text and the
 * line's tags, which decide whether a keyword owns the line rather than the
 * compiler.
 */
function compileAction(said: string, skill: Skill): Script | null {
  const key = `${skill.tags.join("|")} ${said}`;
  const hit = costPrograms.get(key);
  if (hit !== undefined) return hit;
  // Compiled as an [Activate] so that a leading "when" is not mistaken for a
  // trigger, and with no cost of its own so nothing wraps it in a condition.
  const read = (text: string) => compileSkill({ ...skill, kind: "activate:main", keyword: null, cost: "", effect: text });
  let sc = read(said);
  // A printed price is written in the second person and every action pattern
  // in the compiler is written in the imperative, so one the compiler cannot
  // read is offered again with its subject taken off. Second and not first,
  // because a handful of prices do say "you" to the compiler — "you can't play
  // copies of this card for the turn" — and those are read as they stand.
  const bare = dropTheSubject(said);
  if ((sc.unsupported.length || !sc.ops.length) && bare !== said) sc = read(bare);
  const out = sc.unsupported.length || !sc.ops.length ? null : sc;
  costPrograms.set(key, out);
  return out;
}

/**
 * "**You** remove this card in your Drop from the game and discard 1 card from
 * your hand" → "remove this card …" (BT31-132): the subject of a printed
 * price, at the front and after each "and"/"then"/"or". Until it came off, no
 * "you place …", "you discard …" or "you choose …" price was readable at all.
 *
 * "You may" stays: that is `may` (20-16), an op of its own, and what follows it
 * is what is optional rather than what is done.
 */
function dropTheSubject(said: string): string {
  return said.replace(/(^|,\s*|\band\s+|\bthen\s+|\bor\s+)you\s+(?!may\b)/gi, "$1");
}

/**
 * True when the price is nothing but orbs (and the reminder text beside them).
 * The slash of "{r}/{u}" is part of the orb notation, not leftover text.
 */
export function costIsOnlyOrbs(cost: string): boolean {
  return (
    stripNotes(cost)
      .replace(/\{[^}]*\}/g, "")
      .replace(/[\s,:/]/g, "").length === 0
  );
}

/**
 * The condition or conditions a price states (9-1-3) — whether or not it also
 * charges an action, which is `compileCostProgram`.
 *
 * Most cards write "If your Leader Card is red"; a dozen print the same claim
 * bare — "Your Leader Card is a green ≪Android≫ card" — with no condition word
 * in front of it. A bare one is only read once the price has failed to be an
 * *action*, because the action is the stronger reading: charging it changes the
 * game, and a condition that merely holds costs nothing, so guessing wrong in
 * that direction would hand the player a free skill.
 */
export function priceCondition(skill: Skill): { cond: Cond; subject?: Ref } | null {
  const conds = splitPrice(skill).conds;
  if (!conds.length) return null;
  if (conds.length === 1) return conds[0];
  // Several conditions in one price all have to hold (9-1-3). None of them is
  // then *the* subject an effect's "it" points back at, so none is offered.
  return { cond: { kind: "all", conds: conds.map((x) => x.cond) } };
}

/**
 * A price says one of three things, and a few hundred cards say two of them at
 * once: "[Activate: Main] If your Leader is a white <Cell> card, and you
 * remove this card in your Drop from the game and discard 1 card from your
 * hand:" (BT31-132) both names a condition the skill needs (9-1-3) and charges
 * an action to use it (4-3-3).
 *
 * The two halves are separated here so the engine can check the one and charge
 * the other. A split is only taken when *both* halves are fully read — the
 * conditions all parse and the rest compiles to a program — because a price
 * read in half is worse than one not read at all: the skill would be offered
 * without its condition, or, far more likely, for free.
 */
interface PriceSplit {
  conds: { cond: Cond; subject?: Ref }[];
  /** The action half, compiled; null when the price only states conditions. */
  program: Script | null;
}

const priceSplits = new Map<string, PriceSplit>();
const NO_PRICE: PriceSplit = { conds: [], program: null };

function splitPrice(skill: Skill): PriceSplit {
  const said = costText(skill.cost);
  if (!said || costIsOnlyOrbs(skill.cost)) return NO_PRICE;
  const key = `${skill.tags.join("|")} ${said}`;
  const hit = priceSplits.get(key);
  if (hit) return hit;
  const out = readPrice(said, skill);
  priceSplits.set(key, out);
  return out;
}

function readPrice(said: string, skill: Skill): PriceSplit {
  // BT15-022's "{r}{1}, if your opponent has 3 or more energy, there's a red
  // [Field] Extra Card with an energy cost of 2 in your Drop Area, and you
  // place this card in its owner's Drop Area" — two conditions and an action
  // ANDed together, the harder chain a prior audit reported as merging into
  // one wrong condition (the "3 or more" bound landing on the second
  // condition's filter, the side flipping to the opponent's, the price action
  // dropped outright). That does not reproduce here: the reversed-joints loop
  // below already tries the *last* joint first, so `allConditions` reads the
  // two leading conditions off the head correctly scoped ("in your Drop",
  // not "opponent's") and `compileAction` reads the trailing "you place this
  // card…" as the program in the same pass. Left as found — investigated for
  // Lane G, 9 Sep 2026 — because the failure the audit named is not here to
  // fix; whatever produced it either predates this loop's current shape or
  // was on a since-corrected catalog entry.
  //
  // A price with no condition word in front of it is charged, not merely
  // checked: the action is the stronger reading, because charging it changes
  // the game and a condition that holds costs nothing. A dozen cards do state
  // the condition bare, and they are read once that reading has failed.
  const cued = /^(?:if|when|while|during)\b/i.test(said);
  const whole = cued ? null : compileAction(said, skill);
  if (whole) return { conds: [], program: whole };
  // "If X, and you do Y": every place the sentence could be cut in two, the
  // longest condition half first, so a price stating two conditions and an
  // action keeps both of them.
  for (const at of joints(said).reverse()) {
    const head = said.slice(0, at.at).replace(/[\s,]+$/, "");
    const tail = said.slice(at.at + at.len).trim();
    if (!head || !tail) continue;
    const conds = allConditions(head);
    if (!conds) continue;
    const program = compileAction(tail, skill);
    if (program) return { conds, program };
  }
  const only = allConditions(said);
  return only ? { conds: only, program: null } : NO_PRICE;
}

/** Every "and"/"," a price could be cut at, outside the bracketed card descriptions. */
function joints(said: string): { at: number; len: number }[] {
  const out: { at: number; len: number }[] = [];
  const closers: Record<string, string> = { "<": ">", "≪": "≫", "{": "}", "(": ")", "[": "]" };
  let close = "";
  for (let i = 0; i < said.length; i++) {
    const ch = said[i];
    if (close) {
      if (ch === close) close = "";
      continue;
    }
    if (closers[ch]) {
      close = closers[ch];
      continue;
    }
    const rest = said.slice(i);
    const m = /^(,\s+and\s+|,\s+|\s+and\s+)/i.exec(rest);
    if (m) {
      out.push({ at: i, len: m[1].length });
      i += m[1].length - 1;
    }
  }
  return out;
}

/**
 * A price, or the head of one, read as the one or more conditions it states.
 *
 * Cut at every joint first and read the pieces: the patterns below all end in
 * a greedy tail, so "your Leader Card is red, you have 2 or more energy" read
 * whole is one condition about a leader that is "red, you have 2 or more
 * energy" — and the second requirement is gone. The whole is only read when
 * the pieces do not, which is what keeps "a red and blue card" together.
 */
function allConditions(head: string): { cond: Cond; subject?: Ref }[] | null {
  const parts = joints(head);
  if (parts.length) {
    const conds: { cond: Cond; subject?: Ref }[] = [];
    let from = 0;
    for (const j of [...parts, { at: head.length, len: 0 }]) {
      const got = parseConditionClause(
        head
          .slice(from, j.at)
          .replace(/[\s,]+$/, "")
          .trim(),
        true,
      );
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

const COLOR_NAMES_PATTERN = "(?:an?\\s+)?(?:red|blue|green|yellow|black|colorless)";
const AREA_NAMES_PATTERN = "(?:(?:your|your opponent's|the|an?)\\s+)?(?:hand|deck|drop|warp|life|battle|unison|energy|leader|combo|play|z-deck|z-energy|zdeck|zenergy)(?: area)?";

export function splitDisjunction(text: string): string[] {
  const regex = /(?:,\s+)?\bor\b/gi;
  let match: RegExpExecArray | null;
  const splitIndices: { start: number; end: number }[] = [];

  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(0, match.index).trim();
    const after = text.slice(match.index + match[0].length).trim();

    if (/\d+\s*$/i.test(before) && /^(?:more|less|fewer)\b/i.test(after)) {
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

export function parseConditionClause(clause: string, allowBare = false): { cond: Cond; subject?: Ref } | null {
  const trimmed = clause.toLowerCase().trim();
  // "During your turn" is a condition too, and reads as one everywhere else in
  // the text. The delay phrases ("during your opponent's *next* turn") are
  // matched before this is reached, so they are not caught here.
  const t = trimmed.replace(/^(?:if|when|while|during)\s+/, "");
  // "if your Leader Card is yellow and your life is at 4 or less" splits on the
  // "and", so the second half arrives without a condition word in front of it.
  // It only counts as a condition when it continues one (9-1-3).
  if (t === trimmed && !allowBare) return null;
  // "If your Leader is a green <Broly> card **and** you have 2 or more
  // energy" — two conditions in one price. Every pattern below has a greedy
  // tail that would swallow the second and drop it in silence, which is worse
  // than failing: the skill would be offered without its second requirement.
  // A body clause never arrives here compound, because `splitClauses` has
  // already broken it at the "and".
  if (/ and /.test(t)) {
    const conds: Cond[] = [];
    const raw = clause.trim().split(/ and /i);
    let charged = false;
    for (const [i, part] of t.split(/ and /).entries()) {
      const got = parseConditionClause(part.trim(), true);
      if (!got) {
        conds.length = 0;
        // A part the compiler reads as something the player *does* is a price
        // to charge, not a claim to check (4-3-3). Falling through to the
        // patterns below would let one of their greedy tails swallow it, and
        // the skill would then be offered without ever paying for it —
        // 914 skills read that way, including BT31-132's "and you remove this
        // card in your Drop from the game". `splitPrice` reads such a price in
        // two; here the clause is simply not a condition.
        charged = readsAsAction((raw[i] ?? part).replace(/[\s,]+$/, "").trim());
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
    const parts = splitDisjunction(m[1]);
    if (parts.length > 1) {
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
    const parts = splitDisjunction(m[1]);
    if (parts.length > 1) {
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
  if ((m = /^the (?:battle |extra |unison )?card being played (?:has|is) (.+)$/.exec(t))) {
    const filter = filterFor(m[1], null);
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
  // "If your Leader Card has ≪Saiyan≫ in its special trait", "… has {Son Goku}
  // in its card name", "… has <Vegeta> in its character name".
  if ((m = /^your leader(?: card)? has (.+) in its (?:special traits?|card name|character names?)$/.exec(t))) {
    return { cond: { kind: "leaderMatches", filter: parseFilter(m[1]) }, subject: { sel: { special: "leader" } } };
  }
  // "If this card has 3 or more markers on it" (13-2).
  if ((m = /^this card has (\d+) or (more|less|fewer) markers?(?: on it)?$/.exec(t))) {
    return { cond: { kind: "markers", sel: { special: "self" }, ...(m[2] === "more" ? { atLeast: Number(m[1]) } : { atMost: Number(m[1]) }) }, subject: { sel: { special: "self" } } };
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
    const parts = splitDisjunction(m[1]);
    if (parts.length > 1) {
      const conds = parts.map((part) => ({
        kind: "leaderMatches" as const,
        filter: parseFilter(part),
        back: true,
      }));
      return { cond: { kind: "any", conds }, subject: { sel: { special: "leader" } } };
    }
    return { cond: { kind: "leaderMatches", filter: parseFilter(m[1]), back: true }, subject: { sel: { special: "leader" } } };
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
 * "If you have 2 or more Battle Cards in play in Rest Mode", "if there are 5
 * or more cards in your Warp", "if there are no cards in your opponent's
 * Combo Area" — one shape, many areas, and the target phrase after the number
 * is the same grammar every other clause uses.
 */
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
  const m = /^(?:you have|your opponent has|there(?: (?:are|is)|'s|'re)) (?:only )?(?:(no)|(?:an?|any) |(\d+) or (more|less|fewer) )?(.+)$/.exec(t);
  if (!m) return null;
  const [, none, num, dir, rest] = m;
  // "you have" / "your opponent has" says whose cards, which the phrase after
  // the number usually does not repeat.
  const mine = /^you have/.test(t);
  const theirs = /^your opponent has/.test(t);

  const parts = splitDisjunction(rest);
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
      const sel = parseTarget(phrase);
      if (!sel) return null;
      delete sel.count;
      delete sel.upTo;
      if (none) conds.push({ kind: "count", sel, atMost: 0 });
      else if (!num) conds.push({ kind: "count", sel, atLeast: 1 });
      else conds.push({ kind: "count", sel, ...(dir === "more" ? { atLeast: Number(num) } : { atMost: Number(num) }) });
    }
    return { kind: "any", conds };
  }

  const phrase = mine ? `your ${rest}` : theirs ? `your opponent's ${rest}` : rest;
  const sel = parseTarget(phrase);
  if (!sel) return null;
  // A count reads the whole area, not one card out of it.
  delete sel.count;
  delete sel.upTo;
  if (none) return { kind: "count", sel, atMost: 0 };
  if (!num) return { kind: "count", sel, atLeast: 1 };
  return { kind: "count", sel, ...(dir === "more" ? { atLeast: Number(num) } : { atMost: Number(num) }) };
}

/**
 * Clauses that carry no effect of their own.
 *
 * "if you do" (20-16) makes everything after it depend on the previous action
 * having happened, which `compileSkill` turns into a condition; the rest are
 * connectives left over from splitting a sentence.
 */
function connective(clause: string): "skip" | "ifDone" | "ifNotDone" | "otherwise" | null {
  const t = clause.toLowerCase().replace(/[.,]$/, "").trim();
  if (/^otherwise$/.test(t)) return "otherwise";
  if (/^(?:if you do|if so|if you did)$/.test(t)) return "ifDone";
  // "…your opponent may choose 1 of their Battle Cards and KO it. **If they
  // don't**, …" — the same hinge as "if you don't", said about whoever the
  // clause before it asked. 29 clauses, and each one failed a whole skill.
  // "…**If they don't KO a card this way**, they instead choose 2 cards in
  // their hand" (EX03-16): the hinge with the action it is about spelled out
  // again. What it names is always the offer just before it, so the words in
  // between say nothing the bare form does not — but only when the sentence
  // ends by pointing back at this skill, so "if you don't have a Unison in
  // play" stays a condition about the board.
  if (/^(?:if (?:you|they) (?:don'?t|do not|didn'?t|did not))(?:\s+[a-z0-9'<>≪≫{}\- ]+?\s+(?:this way|with this skill))?$/.test(t)) return "ifNotDone";
  if (/^if not$/.test(t)) return "ifNotDone";
  if (/^(?:if they do|if they did)$/.test(t)) return "ifDone";
  // 20-12-3: after looking, the cards go back where they were; the order is
  // the player's and changes nothing the engine tracks.
  if (/^(?:put|place) (?:them|the rest|the remaining cards?|it) back(?: on top of (?:your|the|their) deck)?(?: in any order)?$/.test(t)) return "skip";
  if (/^shuffle any (?:secret )?areas? you looked (?:through|at)(?: with this skill)?$/.test(t)) return "skip";
  if (/^(?:additionally|then|so|and|also|after that|in addition)$/.test(t)) return "skip";
  // "Choose **and** activate 1 {Broly's Ring} from your deck" splits into a
  // bare "choose" and the action. The choosing is how that action picks its
  // card, so the fragment says nothing the clause after it does not.
  if (/^choose$/.test(t)) return "skip";
  // Reminders that restate a rule the engine already applies.
  if (/^(?:you can't activate|this skill can only be activated)/.test(t)) return "skip";
  // "This card can't be played" on its own is one of those. The forms that say
  // *how* — "by skills from any area", "from any area except by skills" — are
  // not: nothing else in the engine applies them, and skipping them here was
  // why fifteen cards read cleanly and could still be fetched out of a Drop by
  // any skill that liked the look of them. `compileProhibition` reads those.
  if (/^this card can't be played/.test(t) && !/\bskills?\b/.test(t)) return "skip";
  // "You can activate this card's [Counter] skill from your hand" is where a
  // [Counter] skill is activated from anyway (4-3), so the sentence adds
  // nothing. The forms that *change* the cost are not this, and are left alone.
  if (/^you (?:can|may) activate this card's \[counter\][a-z: ]*skill from your hand$/.test(t)) return "skip";
  // "When this card is played using [Over Realm], activate this skill" — the
  // skill saying that it happens, which it is already doing.
  if (/^activate this skill$/.test(t)) return "skip";
  // The word "skill" is optional in print: BT4-097 says "when you activate
  // this card's [Counter]" and BT5-050 "…[Counter] skill", meaning the same
  // moment — the one this skill is already about.
  if (/^when you activate this card's \[counter[a-z: ]*\](?: skill)?$/.test(t)) return "skip";
  // Deck-building permissions are not rules of play (6-1), like the
  // restrictions their opposite numbers print.
  if (/^you can include as many copies of this card in your deck as you like$/.test(t)) return "skip";
  return null;
}

/**
 * "…for each of your ≪Saiyan≫ cards", "…equal to the number of cards in your
 * Drop Area": a number read off the board rather than printed. The clause in
 * front of it is compiled on its own and its number is then swapped for the
 * count — times the printed number, since "+5000 power for each" is far more
 * common than "1 for each".
 */
function compileForEach(clause: string, c: Ctx): Op[] | null {
  const t = clean(clause);
  // "For each marker on this card, this card gets +5000 power during your
  // turn" (BT27-003/004/005/006, EX19-21): the count leads the sentence,
  // comma-joined, instead of trailing it. `compileClauseList` deliberately
  // keeps that comma from splitting the clause in two (see
  // `PURE_FOREACH_MARKERS_ON_SELF`) only for "on this card", so this is
  // reached with the count and the effect still both in hand; every other
  // leading "for each" phrase in the catalog is still split apart on its own
  // and stays unread, same as before.
  const lead = /^for (?:each|every) (markers?\s+on\s+.+?)\s*,\s*(.+)$/.exec(t);
  const m = lead ? null : /^(.+?)\s+(?:for each|equal to the number of)\s+(.+)$/.exec(t);
  if (!lead && !m) return null;
  const headSrc = lead ? lead[2] : m![1];
  // What is being counted ends at its noun. "…+6000 power for each card in
  // your energy **and [Triple Strike] for the duration of the battle**"
  // carries on about the card, not about what is counted, and taking the whole
  // tail as the counted phrase dropped the keyword and the duration in
  // silence — the power lasted the turn instead of the battle. The leading
  // form has no such tail: the comma already ends the counted phrase.
  const cut = lead ? null : /(?:,?\s+and\s+\[)|(?:\s+for the (?:duration of the |rest of the )?(?:turn|battle|game)\b)|(?:\s+until\s)|(?:\s+during (?:this|your)\b)/i.exec(m![2]);
  const counted = lead ? lead[1] : cut ? m![2].slice(0, cut.index) : m![2];
  const tail = lead ? "" : cut ? m![2].slice(cut.index) : "";
  // "For each marker on X" is a marker total, not a count of matching cards —
  // reading it as `count` asked how many cards are named "this card" (always
  // 1) and printed a flat bonus with no markers in it at all.
  const markersOn = /^markers?\s+on\s+(.+)$/.exec(counted);
  const sel = parseTarget(markersOn ? markersOn[1] : counted);
  if (!sel) return null;
  // A count (or a marker total) reads the whole area, not one card out of it.
  const broad: Selector = { ...sel, count: 99, upTo: false };
  const amountFor = (printed: number): Amount =>
    markersOn ? { markers: broad, ...(printed === 1 ? {} : { times: printed }) } : { count: broad, ...(printed === 1 ? {} : { times: printed }) };
  // "Draw cards equal to the number of …" prints no number at all, because the
  // count is the number. Only the trailing "equal to" form says this; the
  // leading marker form always prints a number to multiply.
  if (!lead && /^draw cards?$/.test(headSrc)) return [{ op: "draw", n: { count: broad } }];
  // The tail goes back on the head, where the patterns that read "and
  // [Keyword]" and the duration can see it.
  const head = compileClause(`${headSrc}${tail}`, c);
  if (!head?.length) return null;
  const [op, ...rest] = head;
  const swapped = swapForEachAmount(op, amountFor);
  return swapped && [swapped, ...rest];
}

/**
 * Swaps a flat printed number for a computed `Amount` inside the single op a
 * "for each" clause's head compiled to — diving through an `if` wrapper
 * ("…during your turn", read as a condition rather than a duration, see the
 * trailing-condition case in `compileClause`) to reach the number underneath,
 * since a [Permanent] as ordinary as "for each marker on this card, this card
 * gets +5000 power during your turn" (BT27-003) compiles that way. Only ever
 * one op deep of one `if`: two conditions or two effects would leave the
 * printed number ambiguous, which is worse than leaving the clause unread.
 */
function swapForEachAmount(op: Op, amountFor: (printed: number) => Amount): Op | null {
  if (op.op === "if" && !op.else && op.then.length === 1) {
    const inner = swapForEachAmount(op.then[0], amountFor);
    return inner && { ...op, then: [inner] };
  }
  if ((op.op === "draw" || op.op === "discard" || op.op === "damage" || op.op === "mill" || op.op === "addLife" || op.op === "energyMarker") && typeof op.n === "number") {
    return { ...op, n: amountFor(op.n) };
  }
  if ((op.op === "power" || op.op === "comboPower") && typeof op.amount === "number") {
    return { ...op, amount: amountFor(op.amount) };
  }
  return null;
}

/**
 * Tails that say *how long* or *where* an effect holds, rather than adding to
 * what it does. `durationOf` reads them off the whole clause, so a pattern
 * matching the action itself can be anchored to the end once they are gone.
 */
// Some sets print "for the duration of turn", without the second article,
// and some print "for the duration of **this** turn" — the same duration
// with the demonstrative the rest of the line already uses.
// "During **that** turn" is the turn the sentence has been talking about,
// which is this one — the same duration said with a different pronoun.
const DURATION_TAIL_SRC =
  "for the (?:duration of (?:the |this )?)?(?:turn|battle|game)|for the rest of (?:the|this) turn|during (?:this|the|that) turn|this turn|until (?:the )?(?:end|start|beginning) of [a-z' ]+";
/**
 * How long, on its own. A pattern that takes a whole *target phrase* off the
 * end of a clause has to cut the duration itself rather than work from
 * `stripQualifiers`, because "in all areas" is part of the target and
 * `TRAILING_QUALIFIER` takes it away: BT9-136's "negate the skills of your
 * opponent's non-Extra Cards **in all areas** until the end of your opponent's
 * next turn" came back as the play area, for the rest of the game.
 */
const DURATION_TAIL = new RegExp(`\\s+(?:${DURATION_TAIL_SRC})$`);
const TRAILING_QUALIFIER = new RegExp(`\\s+(?:${DURATION_TAIL_SRC}|in (?:all|any) areas?)$`);

/**
 * The clause with those tails removed.
 *
 * This exists so the patterns below can end in `$`. Matching a prefix and
 * ignoring the rest is how a clause gets read *wrongly* rather than not at
 * all: "gets +5000 power for each card in your Drop" read as a flat +5000, and
 * "you can play this card from your hand without paying its energy cost" read
 * as an instruction to play it — both looked compiled, and both were wrong.
 * Anchored patterns turn that class of mistake into an honest gap.
 */
function stripQualifiers(t: string): string {
  let out = t;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(TRAILING_QUALIFIER, "");
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

/**
 * "Your opponent chooses 1 card in their hand and **places** it in their Drop
 * Area": splitting on the "and" leaves the second half in the third person,
 * with its subject in the clause before it.
 *
 * Only the verbs that move a card are normalised. Where the card decides what
 * happens — which Drop, whose Warp — the actor does not matter, so nothing is
 * being guessed. "Draws", "chooses" and "plays" are deliberately left alone:
 * those need to know *who*, and getting that wrong is worse than not reading
 * the clause.
 */
const THIRD_PERSON: Record<string, string> = {
  places: "place",
  puts: "put",
  sends: "send",
  returns: "return",
  adds: "add",
  switches: "switch",
  removes: "remove",
  discards: "discard",
  kos: "ko",
  plays: "play",
  draws: "draw",
  reveals: "reveal",
};

/**
 * "Your opponent sends 1 Battle Card from their Drop Area to their Warp"
 * (20-7). The instruction is the same one, carried out by them on their own
 * cards — the possessives in the rest of the sentence already say so — and the
 * only thing that changes is who picks which card.
 *
 * Which is why `OPPONENT_POSSESSIVE` has to hold as well: "your opponent
 * discards 1 card" names no area, so dropping the subject would drop the only
 * thing that said whose hand it came from. Those wordings are read elsewhere,
 * by patterns that keep the subject.
 */
const OPPONENT_DOES = /^your opponent (places|puts|sends|returns|adds|switches|removes)\s+/i;
const OPPONENT_POSSESSIVE = /\btheir\b|\bits owner'?s?\b/i;

/** Try to read one clause. Returns null when the wording is not understood. */
function compileClause(clause: string, c: Ctx): Op[] | null {
  const t = clause
    .toLowerCase()
    .trim()
    .replace(/^(?:you may|you can|the player may)\s+/, "")
    // A trailing "instead" marks a replacement (9-10) and says nothing about
    // the action itself; the clause before it has already recorded that.
    .replace(/\s+instead$/, "")
    // A card-moving verb left in the third person by the split before it.
    // "…and **KOs** it", "…and **plays** it": the verb is left in the third
    // person by the split before it, because the sentence's subject was the
    // opponent. Only the leading word, so "your opponent draws" is untouched.
    .replace(/^(places|puts|sends|returns|adds|switches|removes|discards|kos|plays|draws|reveals)\b/, (v) => THIRD_PERSON[v]);
  let m: RegExpExecArray | null;

  // "Your opponent chooses 1 card in their hand and places it in their Drop
  // Area" says the discard twice: the choosing *is* the discard, and this half
  // is where the cards were already sent. Reading it as a second move made it
  // move the wrong card, because "it" had nothing of its own to point at.
  if (c.lastOp === "discard" && /^(?:(?:place|put) (?:it|them) (?:in|into) (?:their|the|your|its owner's) drop(?: area)?|discard (?:it|them))$/.test(t)) return [];

  // "Add it to your life face up", "place 1 black <Cumber> card from your hand
  // in your Z-Deck face up" (3-9-2-1): the "face up" is not the action, it is
  // how the card arrives. Compiling the move on its own and marking the result
  // gives every moving phrase this for free, and keeps each of those patterns
  // from having to end in two different ways.
  if (/\bface[- ]up$/.test(t) && /^(?:add|place|put|send|return)\b/.test(t)) {
    const moved = compileClause(clause.replace(/\s*face[- ]up\s*$/i, ""), c);
    const last = moved?.[moved.length - 1];
    if (moved && last && last.op === "moveTo") return [...moved.slice(0, -1), { ...last, faceUp: true }];
  }

  // "This card gains +5000 power and [Critical] **during your turn**" (9-9):
  // a tail that says *when* the rest holds, not how long it lasts — so it is a
  // condition rather than a duration, and on a [Permanent] the static layer
  // asks it again every time. `TRAILING_QUALIFIER` deliberately does not strip
  // this one: dropping it would make the card always have [Critical].
  if ((m = /^(.*\S)\s+during (your|your opponent's) turn$/.exec(t))) {
    const inner = compileClause(m[1], c);
    if (inner?.length) {
      return [{ op: "if", cond: { kind: "isTurnPlayer", ...(m[2] === "your" ? {} : { who: "opponent" as const }) }, then: inner }];
    }
  }

  // The same thing said the other way round: the condition printed *after* the
  // effect rather than in front of it. "This card gets +5000 power **when** all
  // of your opponent's energy is in Rest Mode" (XD1-01), "draw 1 card **if**
  // your Leader Card is red". Both halves already read on their own — the
  // condition by `parseConditionClause`, the effect by the patterns below — so
  // the only thing missing was the split. Every condition word was tested at
  // the *start* of a clause, which is why the leading form compiled and this
  // one went to the referee.
  //
  // "If" is a condition wherever it is printed. "When" / "while" / "as long as"
  // are only read this way on a [Permanent], which has no trigger and never
  // resolves, so the static layer asks the condition again every time. On an
  // [Auto] the same word is the skill's *trigger* ("draw 1 card when this card
  // attacks") — a different rule, asked at a different moment — and reading it
  // here would quietly turn one into the other, so those stay a gap.
  if ((m = /^(.*\S)[\s,]+(if|when|while|as long as)\s+(.+)$/.exec(t)) && (m[2] === "if" || c.permanent)) {
    // A colon is a skill's own cost/effect boundary, never punctuation inside a
    // condition. One in the tail means this is not a trailing condition at all
    // but a second skill printed on the same line — EX24-01 carries an
    // "[Activate: Main] …" and a "[Wish] If … : …" with no <br> between them,
    // and without this the "[Wish]" tag was read as the effect and the whole of
    // that second skill as its condition.
    // For the same reason the head has to say something of its own: a bare
    // keyword tag compiles to "gains [Wish]", which is an op, so requiring ops
    // alone does not catch it.
    const head = m[1];
    const tail = m[3];
    if (!tail.includes(":") && /[a-z0-9]/.test(head.replace(/\[[^\]]*\]/g, ""))) {
      const cond = parseConditionClause(`if ${tail}`, true);
      // The head has to be an effect in its own right. When it is not, this was
      // not a trailing condition at all, and the clause stays a gap rather than
      // becoming an `if` around nothing.
      const inner = cond ? compileClause(head, c) : null;
      if (cond && inner?.length) return [{ op: "if", cond: cond.cond, then: inner }];
    }
  }

  // The same clause with "for the turn", "in all areas" and the like taken
  // off, so the patterns for the action itself can end in `$`.
  const q = stripQualifiers(t);

  // A number read off the board has to be seen *first*: the patterns below
  // match on a word boundary rather than the end of the clause, so "gets
  // +5000 power for each card in your Drop" would otherwise read as a flat
  // +5000 and say nothing about having dropped the rest of the sentence.
  if (/\bfor each\b|\bequal to the number of\b/.test(t)) {
    const counted = compileForEach(t, c);
    if (counted) return counted;
    // "For each marker on this card, **it** gets +5000 power" (EX19-21):
    // `compileForEach` refused this one because "it" cannot be resolved, but
    // falling through leaves "for each marker on this card, it" for the
    // patterns below to read as an ordinary subject phrase — and `refFor`'s
    // "this card" test matches *anywhere* in it, so "it" silently became this
    // card instead of staying unresolved. Once the leading count is known to
    // be a marker total glued onto an effect (`PURE_FOREACH_MARKERS_ON_SELF`,
    // reattached above), a failure to compile the effect refuses the whole
    // clause rather than exposing that leftover phrase to anything else.
    if (/^for (?:each|every) markers? on this card\s*,/.test(t)) return null;
  }

  // Draw (5-1). "You may draw" is treated as taken: declining never helps.
  if ((m = /^draw (\d+) cards?$/.exec(t))) return [{ op: "draw", n: Number(m[1]) }];
  // "Have your opponent draw 1 card" leaves the verb uninflected once the
  // leading words are split off, and a few sets print it that way outright.
  if ((m = /^(?:your opponent|they) draws? (\d+) cards?$/.exec(t))) return [{ op: "draw", n: Number(m[1]), side: "opponent" }];
  // "You and your opponent draw 1 card": one sentence about both players, and
  // splitting it at the "and" left "you" behind as a fragment.
  if ((m = /^you and your opponent draws? (\d+) cards?$/.exec(t))) {
    return [
      { op: "draw", n: Number(m[1]) },
      { op: "draw", n: Number(m[1]), side: "opponent" },
    ];
  }

  // Discard (20-7).
  if ((m = /^your opponent discards (\d+) cards?(?: from their hand)?$/.exec(t))) return [{ op: "discard", n: Number(m[1]), side: "opponent" }];
  // "Your opponent sends 1 card from their hand to their Warp" — a discard that ends elsewhere (20-7).
  if ((m = /^your opponent (?:sends|places) (\d+) cards? from their hand (?:to|in|into) (?:their|its owner's) warp$/.exec(t)))
    return [{ op: "discard", n: Number(m[1]), side: "opponent", to: "warp" }];
  if ((m = /^(?:send|place) (\d+) cards? from your hand (?:to|in|into) your warp$/.exec(t))) return [{ op: "discard", n: Number(m[1]), to: "warp" }];
  if ((m = /^discard (\d+) cards?(?: from your hand)?$/.exec(t))) return [{ op: "discard", n: Number(m[1]) }];
  // "Discard this card from your hand" (20-7): the card is named, so nobody
  // chooses — which is what makes it not the `discard` op.
  if (/^discard this card(?: from your hand)?$/.test(t) || /^(?:place|put) this card (?:in|into) (?:your|its owner'?s?|the) drop(?: area)?(?: from your hand)?$/.test(t)) {
    return [{ op: "moveTo", target: { sel: { special: "self" } }, to: "drop", reveal: true }];
  }
  // "Discard 1 mono-green card from your hand", "discard 1 ≪Saiyan≫ or
  // ≪Earthling≫ card from your hand": the owner still chooses (20-7), but only
  // among the cards the text describes, which the `discard` op cannot say. It
  // is the same choose-then-move that op splices for the unqualified case, so
  // this reads the description as a target phrase and lets `withChoice` ask.
  if ((m = /^discard (\d+ .+?)(?: from your hand)?$/.exec(t))) {
    const ref = refFor(`${m[1]} in your hand`, c);
    if (ref) return withChoice(ref, clause, c, (target) => ({ op: "moveTo", target, to: "drop", reveal: true }));
  }
  // "…they choose 1 card in their hand": after "when your opponent combos",
  // "they" is the opponent, and the sentence is the same discard.
  if ((m = /^(?:your opponent|they) chooses? (\d+) cards? (?:in|from) their hand$/.exec(t))) return [{ op: "discard", n: Number(m[1]), side: "opponent" }];
  if (/^make your opponent choose (\d+) cards? from their hand$/.test(t)) return [{ op: "discard", n: 1, side: "opponent" }];
  if (/^discard (?:it|them)$/.test(t) && c.last) return [{ op: "moveTo", target: { var: c.last }, to: "drop", reveal: true }];
  if ((m = /^both players choose (\d+) cards? (?:in|from) their hands?$/.exec(t))) return [{ op: "discard", n: Number(m[1]), side: "both" }];
  // "Both players choose 1 card from their hand and 1 card from their Battle
  // Area, and place those cards in their Drop Areas" (BT1-057): two areas at
  // once, for both players, is more than the `discard` op says (hand only),
  // so each side's pair is spelled out as its own choose-then-move — the same
  // splicing `discard` does for the hand alone.
  if ((m = /^both players choose (\d+) cards? (?:in|from) their hand and (\d+) cards? (?:in|from) their battle area$/.exec(t))) {
    const nHand = Number(m[1]);
    const nBattle = Number(m[2]);
    const ops: Op[] = [];
    for (const side of ["you", "opponent"] as const) {
      const vHand = `c${c.n++}`;
      const vBattle = `c${c.n++}`;
      ops.push(
        { op: "choose", sel: { side, area: "hand", count: nHand }, as: vHand, chooser: side, reason: clause },
        { op: "moveTo", target: { var: vHand }, to: "drop", reveal: true },
        { op: "choose", sel: { side, area: "battle", count: nBattle }, as: vBattle, chooser: side, reason: clause },
        { op: "moveTo", target: { var: vBattle }, to: "drop", reveal: true },
      );
    }
    return ops;
  }
  // The same card's next sentence just restates that the chosen cards go to
  // the Drop — already true the instant they were chosen above. Reading it
  // again would move an already-dropped card back into itself, which is a
  // no-op for state but a false "goes to the Drop" line in the turn's
  // narration, so it is read as nothing left to do rather than run again.
  if (/^place those cards in their drop areas$/.test(t)) return [];
  // "You may place 1 card from your hand in the Drop Area. If you do so, …"
  // (BT1-077, BT1-078, BT3-054): an optional price, with the rest of the skill
  // hanging on whether it was paid. `compileClause` takes "you may" off before
  // anything below reads the clause, so the mandatory rule under this one
  // matched what was left and the offer was rebuilt around the whole discard —
  // and an offer accepted with an empty hand pays nothing while still counting
  // as accepted (20-16), which buys the rest of the skill for free. Said as an
  // "up to" choice instead, declining and having nothing to give are the same
  // answer (5-2-4), and neither of them pays.
  //
  // The move sits inside the condition rather than beside it because the
  // choice is the decision: nothing leaves the hand until it has been made —
  // and a price of 2 cards half-taken is not paid, so the hand keeps both.
  if ((m = OPTIONAL_HAND_PRICE.exec(clause.trim().replace(/[.]$/, "")))) {
    const word = m[1].toLowerCase();
    const n = /^\d+$/.test(word) ? Number(word) : WORD_COUNTS[word];
    const v = c.costs === 0 ? "cost" : `cost${c.costs}`;
    c.costs++;
    return [
      { op: "choose", sel: { side: "you", area: "hand", count: n, upTo: true }, as: v, reason: clause.trim().replace(/[.]$/, "") },
      { op: "if", cond: { kind: "chose", var: v, ...(n > 1 ? { atLeast: n } : {}) }, then: [{ op: "moveTo", target: { var: v }, to: "drop" }] },
    ];
  }
  // Discarding is often printed the long way round, as a move to the Drop.
  // Only the unqualified form: "1 yellow card in your hand" narrows *which*
  // card, and `discard` cannot yet honour that, so it stays unread.
  if ((m = /^place (\d+) cards? (?:from|in) your hand in(?:to)? (?:your |the )?drop(?: area)?$/.exec(t))) return [{ op: "discard", n: Number(m[1]) }];

  // Damage (5-10).
  if ((m = /^deal (\d+) damage to (?:your opponent|your opponent's life|them)$/.exec(t))) return [{ op: "damage", n: Number(m[1]), side: "opponent" }];

  // Deck manipulation.
  if ((m = /^place (?:up to )?(\d+) cards? from the top of (your|your opponent's) deck in (?:your |their |its owner's |the )?drop(?: area)?$/.exec(t)))
    return [{ op: "mill", n: Number(m[1]), ...(m[2] === "your" ? {} : { side: "opponent" as const }), as: `m${c.mills++}` }];
  // "Draw cards until you have 4 cards in your hand".
  if ((m = /^draw cards until you have (\d+) cards? in your hand$/.exec(t))) return [{ op: "draw", n: { handUpTo: Number(m[1]) } }];
  // "Place the top card of your deck in your Drop Area", "your opponent places
  // the top 2 cards of their deck in their Drop Area" — the same move, either side.
  if ((m = /^(your opponent places|place) the top (?:(\d+) )?cards? of (your|their|your opponent's) deck (?:in|into) (?:your|their|its owner's|the) drop(?: area)?$/.exec(t))) {
    // "Their deck" is the opponent's whichever way round the sentence is
    // built, and the subject may have been dropped before this ran.
    const theirs = m[1] !== "place" || m[3] !== "your";
    return [{ op: "mill", n: m[2] ? Number(m[2]) : 1, ...(theirs ? { side: "opponent" as const } : {}), as: `m${c.mills++}` }];
  }
  if (/^add the top card of your deck to your life$/.test(t)) return [{ op: "addLife", n: 1 }];
  // Printed as "add card … to you hand" on some sets; the meaning is the same.
  if ((m = /^add cards? from your life to your? hand until you have (\d+) life(?: left)?$/.exec(t))) return [{ op: "lifeDownTo", n: Number(m[1]) }];
  // "The rest" is whatever is left of the cards just looked at once the choice
  // in between has taken its own — so it is the look's variable minus the
  // choice's, not the whole look (20-11).
  {
    const REST = "the (?:remaining cards|rest of the cards|rest|other cards)";
    const rest: Ref = { var: "looked", ...(c.last ? { minus: c.last } : {}) };
    if ((m = new RegExp(`^(?:place|put|return) ${REST} (?:back )?(?:at|on) the (top|bottom) of (?:your|its owner'?s?|their owners?'?s?|their) decks?(?: in any order)?$`).exec(t)))
      return [{ op: "moveTo", target: rest, to: "deck", position: m[1] as "top" | "bottom" }];
    if (new RegExp(`^(?:place|put) ${REST} (?:in|into) (?:your |the |its owner'?s? |their )?drop(?: area)?$`).test(t)) return [{ op: "moveTo", target: rest, to: "drop", reveal: true }];
  }
  if (/^shuffle your deck(?: if you looked through it| afterwards?)?$/.test(t)) return [{ op: "shuffle" }];
  // 20-12-3: a search of *their* deck is theirs to shuffle afterwards.
  if (/^(?:your opponent|they) shuffles? (?:their|his|her) deck$/.test(t)) return [{ op: "shuffle", side: "opponent" }];
  // Revealing (20-11-2). Unlike looking, both players see the cards, and they
  // stay where they are — the clauses after it act on what was turned up.
  if ((m = /^(?:your opponent reveals|reveal) (?:your|their) hand$/.exec(t))) {
    const side: Side | undefined = /your opponent reveals|their/.test(t) ? "opponent" : undefined;
    return [{ op: "reveal", sel: { side: side ?? "you", area: "hand" }, as: "revealed" }];
  }
  if ((m = /^reveal (.+)$/.exec(t))) {
    const sel = parseTarget(m[1]);
    if (sel) return [{ op: "reveal", sel, as: "revealed" }];
  }
  // "Your opponent reveals the top card of their deck" (20-11-2): the same
  // turning-up, done by them, and the clauses after it act on what came up.
  if ((m = /^(?:your opponent|they) reveals? (.+)$/.exec(t))) {
    const sel = parseTarget(m[1]);
    if (sel && sel.side === "opponent") return [{ op: "reveal", sel, as: "revealed" }];
  }
  // "Look at your opponent's hand" (20-11): a whole area, seen only by you.
  if (/^look at (?:your opponent'?s|their) hand$/.test(t)) return [{ op: "look", n: 99, as: "looked", side: "opponent", area: "hand" }];
  // Looking at a deck (20-11), which the text words half a dozen ways: either
  // end of either deck, and the number before or after the word "top".
  {
    const look = /^look at (?:up to )?(?:the )?(?:(top|bottom) )?(?:(\d+) cards?|(the )?(top|bottom) card)(?: from| of)? (?:the )?(?:(top|bottom) of )?(your opponent's|your|their) deck$/.exec(t);
    if (look) {
      const end = look[1] ?? look[4] ?? look[5];
      const n = look[2] ? Number(look[2]) : 1;
      const side: Side | undefined = /opponent|their/.test(look[6]) ? "opponent" : undefined;
      return [{ op: "look", n, as: "looked", ...(side ? { side } : {}), ...(end === "bottom" ? { from: "bottom" as const } : {}) }];
    }
  }
  // "Look at cards from the top of your deck up to the number of cards in your
  // Battle Area" — how many is read off the board when the skill resolves.
  {
    const look = /^look at cards from the (top|bottom) of (your opponent's|your|their) deck up to the number of (.+)$/.exec(t);
    if (look) {
      const sel = parseTarget(look[3]);
      if (!sel) return null;
      const side: Side | undefined = /opponent|their/.test(look[2]) ? "opponent" : undefined;
      return [{ op: "look", n: { count: { ...sel, count: undefined, upTo: undefined } }, as: "looked", ...(side ? { side } : {}), ...(look[1] === "bottom" ? { from: "bottom" as const } : {}) }];
    }
  }

  // "Look at up to 5 cards from the top of your deck, **add up to 1 white
  // ≪King Kai's Planet≫ card to your hand**, then shuffle your deck"
  // (BT30-116; 191 skills in the catalog are phrased this way). The clause says
  // what to add and never where from: standing after the look is the whole of
  // what says the card comes out of the cards just looked at. The older sets
  // printed "among them", which `parseTarget` reads; without it the
  // description names no area, so 20-1-6's "an unqualified card is one on the
  // table" took over and the search offered the Battle Area instead — the card
  // was never among the candidates, and the look was spent for nothing. Read
  // here, after the look has bound its variable and before the `add … to your
  // hand` move further down that did that.
  //
  // Only when the description names no area of its own: "add up to 1 red card
  // **from your deck** to your hand" is a search of the deck, look or no look,
  // and the same test `parseTarget` uses is what says so.
  {
    const add = c.lastSeen ? /^add (.+?) to your hand$/.exec(t) : null;
    const desc = add?.[1];
    if (desc && !AREA_WORDS.some(([re]) => re.test(desc.toLowerCase()))) {
      // Only a description that names a card of its own. "Add **it** to your
      // hand", "add the chosen card to your hand" and "add this card to your
      // hand" all point back at something the skill has already settled, and
      // `refFor` is what says which — asked here as well, so the two readings
      // cannot drift apart. Read as a fresh description they became a second
      // choice on top of the one the text already made.
      const back = refFor(desc, c);
      // A phrase that is nothing but a number of cards names no card either,
      // so `parseTarget` refuses it on its own and `refFor` hands back
      // nothing; after a look it is still a description, and the plainest one.
      const own = back ? "sel" in back && !back.sel.special : /^(?:up to )?\d+ cards?$/i.test(desc);
      // The look's own "up to 5" belongs to a clause of its own by now, so the
      // count read here can only be the add's.
      const sel = own ? parseTarget(desc, c.lastSeen ?? undefined) : null;
      if (sel && !sel.special) return withChoice({ sel }, clause, c, (target) => ({ op: "moveTo", target, to: "hand" }));
    }
  }

  // Another way to pay for this card's own [Counter] skill (5-3). The bare
  // sentence with no "by …" tail is only a reminder of where a [Counter] is
  // activated from, and `connective` skips it before we get here.
  // The same waiver for playing the card rather than for its [Counter]. This
  // has to be read before the "play …" rule below, which otherwise takes the
  // sentence for an instruction to play the card — a [Permanent] that reads as
  // an instruction is silently ignored, so the player pays after all.
  // Only when the tail is about paying: "play this card from your hand in Rest
  // Mode" is an ordinary play, and swallowing it here left it unread.
  if ((m = /^play this card from (?:your |their )?hand ((?:without|by) .+)$/.exec(t))) {
    const how = m[1];
    if (/^without paying (?:its|the) energy cost$/.test(how)) return [{ op: "altCost", pay: "none", for: "play" }];
    let mm: RegExpExecArray | null;
    if ((mm = /^by adding (a|an|\d+) cards? from your life to your hand(?: instead of paying (?:its|the) energy cost)?$/.exec(how))) {
      return [{ op: "altCost", pay: "life", n: countWord(mm[1]), for: "play" }];
    }
    return null;
  }

  // ("You can" has already been stripped from the front of `t`.)
  //
  // Reached only when the whole-sentence read above failed, which means this
  // clause is a *piece* of the offer rather than all of it. A waiver and a
  // price out of your life are each said in one clause and survive that
  // intact; a price that is a program cannot, because the split is what took
  // the rest of it away — "by choosing 2 other cards in your hand" arrives
  // here with "and discarding them" already gone, and reading it would offer
  // the [Counter] for a choice that costs nothing. Refusing leaves the skill
  // to the referee with its price whole in the text (ground rule 5).
  if (/^activate this card's \[counter[^\]]*\](?: skill)? from your hand /.test(t)) {
    const alt = counterAltCost(t, c);
    return alt?.every((o) => o.op !== "altCost" || o.pay !== "program") ? alt : null;
  }

  const skillKindFromTag = (tag: string): SkillKindPrefix | null => {
    const word = tag.trim().toLowerCase();
    if (word === "counter") return "counter";
    if (word === "activate") return "activate";
    if (word === "auto") return "auto";
    if (word === "permanent") return "permanent";
    return null;
  };

  const skillScope = (raw: string): { target: Ref; skillKind?: SkillKindPrefix } | null => {
    let mSkill: RegExpExecArray | null;
    // "…of [Counter] skills on yellow <Vegito> cards in your hand…"
    if ((mSkill = /^(?:your|their|the)\s+\[([a-z0-9:\- /]+)\] skills? (?:on|of) (.+)$/i.exec(raw))) {
      const kind = skillKindFromTag(mSkill[1]);
      const target = refFor(mSkill[2], c);
      return kind && target && !(c.stale && target === c.stale) ? { target, skillKind: kind } : null;
    }
    // "…of this card's [Counter] skill…"
    if ((mSkill = /^(.+?)'?s \[([a-z0-9:\- /]+)\] skills?$/i.exec(raw))) {
      const kind = skillKindFromTag(mSkill[2]);
      const target = refFor(mSkill[1], c);
      return kind && target && !(c.stale && target === c.stale) ? { target, skillKind: kind } : null;
    }
    // Any other explicit "skill(s)" scope is refused whole rather than guessed.
    if (/\bskills?\b/i.test(raw)) return null;
    const target = refFor(raw, c);
    return target && !(c.stale && target === c.stale) ? { target } : null;
  };

  // Cost reduction on a [Permanent] skill (9-1-3-3, 20-21). The amount is
  // printed either as a number or as the orbs it takes off — "by {r}" is one
  // less, and `playCost` already lowers a specified colour along with the
  // total. "For each …" makes it a number read off the board.
  // Matched on `q`, not `t`: a cost change may carry a duration like anything
  // else ("…by 1 **for the duration of the turn**"), and anchoring to the end
  // of the raw clause meant every one of those went unread.
  //
  // Three more shapes of the same sentence are folded down to this one rather
  // than re-derived: the possessive "this card's"/"that card's"/"its"/
  // "their" cost in place of "the cost of X" (normalised below, so `refFor`
  // sees the same "this card"/"that card"/pronoun text it already reads
  // everywhere else — a trailing area phrase on the possessive, "this card's
  // energy cost **in your hand**", is dropped along with the possessive
  // pronoun itself rather than read, since a self/pronoun reference already
  // finds the one card regardless of area); the passive "the energy cost of X
  // is reduced by N"; and "decrease" as a plain synonym for "reduce". "Cost
  // **on** X" stands beside "cost **of** X" (BT24-139, BT28-148), and the
  // bare "the cost of X" with no "energy"/"combo" word defaults to energy,
  // same as a bare "cost" does everywhere else. A skill/evolve cost is read by
  // the same shape only when its scope can be read whole (selector + duration);
  // an unread scope refuses the clause rather than granting an unscoped discount.
  // A Z-Energy cost **does** spell it that way and is read
  // below: `zEnergyCostOf` is the hook `d.zEnergyCost` never had, and the
  // five call sites that used to read the field raw now go through it
  // (`state.ts`). A **specified** cost also fails this match — it never
  // spells the noun bare either, always with "specified" in front — and is
  // read by its own pair of clauses just below instead, now that the owner
  // has ruled on what it means (BT19-039, 9 Sep 2026): unlike this generic
  // reducer, it changes only which colours are demanded, never the total.
  let qq = q;
  let possessive: RegExpExecArray | null;
  if ((possessive = /^(reduce|increase|decrease) (this card|that card|its|their)'?s? ((?:energy|skill|evolve|combo|z-energy) )?costs?(?: in (?:your|their) (?:hand|z-deck))? by (.+)$/.exec(qq))) {
    const subject = possessive[2] === "its" ? "it" : possessive[2] === "their" ? "them" : possessive[2];
    qq = `${possessive[1]} the ${possessive[3] ?? ""}cost of ${subject} by ${possessive[4]}`;
  }
  let passive: RegExpExecArray | null;
  if ((passive = /^the ((?:energy|skill|evolve|combo|z-energy) )?costs? of (.+?) (?:is|are) (reduced|increased|decreased) by (.+)$/.exec(qq))) {
    const verb = passive[3].slice(0, -1); // "reduced"/"increased"/"decreased" -> the bare verb.
    qq = `${verb} the ${passive[1] ?? ""}cost of ${passive[2]} by ${passive[4]}`;
  }
  qq = qq.replace(/\bactivation costs?\b/g, "skill cost");
  // "Reduce the Z-Energy cost by 1" (BT22-034): the bare, no-subject
  // continuation that "reduce the energy/combo cost by N" stays unread for
  // everywhere else in the catalog (deliberately — the noun alone does not
  // say whose cost it is). "Z-Energy" is unambiguous, so the card the
  // sentence was already about — `c.lastTarget`, set by the clause just
  // before this one — is a safe subject rather than a guess.
  if (
    (m = /^(reduce|increase|decrease) the z-energy costs? by (\d+|(?:\{[rugykbw\d]+\})+)$/.exec(qq)) &&
    c.lastTarget &&
    !(c.stale && c.lastTarget === c.stale)
  ) {
    const sign = m[1] === "increase" ? -1 : 1;
    const orbs = /^\d+$/.test(m[2]) ? null : orbsIn(m[2]);
    const flat = sign * (orbs ? Object.values(orbs).reduce<number>((sum, n) => sum + (n ?? 0), 0) : Number(m[2]));
    return [{ op: "costReduction", target: c.lastTarget, amount: flat, what: "zEnergy" as const, until: durationOf(clause) }];
  }
  // "Reduce/increase the specified cost of X by {u}" (BT19-039, BT19-040,
  // BT15-063, BT20-118, P-673, P-600) and its bare continuation "reduce the
  // specified cost by {y}" (P-733): the noun the general reducer above
  // deliberately does not spell as bare "cost" (see the comment above it, and
  // `glossary.ts`) now has an owner's ruling to read it by — BT19-039, 9 Sep
  // 2026, validated against 13-2-1-3/20-21-2: this relaxes or tightens only
  // which colours are demanded, never the total (the total is what the
  // player chooses for an X cost, or what is printed for a fixed one), so it
  // is kept apart as `what: "specified"` rather than folded into the flat
  // reducer. Always printed as orbs, never a bare number — there is no total
  // for an unqualified count to come off, only colours to name — so a
  // specified-cost sentence with no orb notation stays unread rather than
  // guessing which colour was meant.
  //
  // Three of the nine cards printing this shape stay unread regardless of
  // this pair, for reasons this pair does not touch:
  // - BT27-002's "reduce **its** specified cost by {r}" names a Z-Unison a
  //   "the next time you play a red Z-Unison with an [Empower] skill from
  //   your Z-Deck" clause bound — a per-future-play reference no `delay` here
  //   models (see the "next time you play" note further down); "its" is left
  //   unnormalised into "the specified cost of it" for that reason, not
  //   compiled and then misapplied to the wrong card.
  // - P-733's "reduce the specified cost by {y}" sits inside "when you would
  //   play a Unison with [Empower] from your hand" — a replacement on a
  //   hypothetical future play, which nothing in this compiler models either.
  // - BT22-104's "reduce the specified cost of a {Devilmite Beam} in your
  //   Z-Deck by {y}" would compile through this pair on its own (checked by
  //   hand: `refFor` resolves the named Z-Deck target fine) but never reaches
  //   it — it hangs on "if the revealed card's energy cost is the same as
  //   **the declared number**", a back-reference to an earlier "Declare 1
  //   number" clause this compiler cannot read, and an unread "if" refuses
  //   every clause it governs (see the `if`/`while`/`unless` refusal further
  //   down) rather than compiling the "then" half in a vacuum.
  if ((m = /^(reduce|increase|decrease) the specified costs? (?:of|on) (.+?) by ((?:\{[rugykbw]\})+)$/.exec(qq))) {
    const sign = m[1] === "increase" ? -1 : 1;
    const ref = refFor(m[2], c);
    if (!ref || (c.stale && ref === c.stale)) return null;
    const colors = orbsToList(orbsIn(m[3]));
    if (!colors.length) return null;
    return [{ op: "costReduction", target: ref, amount: sign * colors.length, what: "specified" as const, colors, until: durationOf(clause) }];
  }
  if (
    (m = /^(reduce|increase|decrease) the specified costs? by ((?:\{[rugykbw]\})+)$/.exec(qq)) &&
    c.lastTarget &&
    !(c.stale && c.lastTarget === c.stale)
  ) {
    const sign = m[1] === "increase" ? -1 : 1;
    const colors = orbsToList(orbsIn(m[2]));
    if (!colors.length) return null;
    return [{ op: "costReduction", target: c.lastTarget, amount: sign * colors.length, what: "specified" as const, colors, until: durationOf(clause) }];
  }
  // "Reduce the energy cost and Z-Energy cost of X … by N" (BT22-085,
  // P-476b): one amount named for two costs at once, so it has to become two
  // ops rather than one. `andJoinsTwoCosts` (in `splitClauses`) is what keeps
  // this from being cut in half at its "and" first, with "reduce the energy
  // cost" and "Z-Energy cost of X … by N" left as two clauses, neither of
  // them a sentence.
  if ((m = /^(reduce|increase|decrease) the energy costs? and z-energy costs? (?:of|on) (.+?) by (\d+|(?:\{[rugykbw\d]+\})+)$/.exec(qq))) {
    const sign = m[1] === "increase" ? -1 : 1;
    const ref = refFor(m[2], c);
    if (!ref || (c.stale && ref === c.stale)) return null;
    const orbs = /^\d+$/.test(m[3]) ? null : orbsIn(m[3]);
    const flat = sign * (orbs ? Object.values(orbs).reduce<number>((sum, n) => sum + (n ?? 0), 0) : Number(m[3]));
    const until = durationOf(clause);
    return [
      { op: "costReduction", target: ref, amount: flat, until },
      { op: "costReduction", target: ref, amount: flat, what: "zEnergy" as const, until },
    ];
  }
  if ((m = /^(reduce|increase|decrease) the ((?:energy|skill|evolve|combo|z-energy) )?costs? (?:of|on) (.+?) by (\d+|(?:\{[rugykbw\d]+\})+),?(?: for each (.+))?$/.exec(qq))) {
    // 20-21 works in both directions, and the sets print both: "increase the
    // energy cost of this card in your Battle Area by 2" is the same standing
    // effect with the sign turned round; "decrease" already reads as "reduce".
    const sign = m[1] === "increase" ? -1 : 1;
    const kindWord = m[2];
    const targetText = m[3];
    const amountText = m[4];
    const perText = m[5];
    // The area the phrase names is part of the target, not noise: a reducer
    // for cards "in your hand" that selects cards in play does nothing at all,
    // which is what stripping it here used to produce.
    let ref = refFor(targetText, c);
    const kindWordTrim = kindWord?.trim();
    let skillKind: SkillKindPrefix | undefined;
    if (kindWordTrim === "skill" || kindWordTrim === "evolve") {
      const scope = skillScope(targetText);
      if (!scope) return null;
      ref = scope.target;
      skillKind = scope.skillKind;
    } else if (!ref) return null;
    // A pronoun that resolves to a stale target is a wrong answer, not a
    // right one for the wrong reason — see the `c.stale` note in `refFor`.
    // That guard only covers a seeded self; a *bound choice* going stale is
    // the same failure and reaches here just as often, because "its"/"that
    // card"/"them" is exactly the possessive/passive normalisation above
    // turns into: BT29-018's "…and the next time you play a red <Broly>
    // card from your Z-Deck during this turn, reduce **its** energy cost by
    // 1" would otherwise land the reduction on `c0` — the card chosen and
    // already moved to Z-Energy two clauses earlier — instead of the
    // not-yet-played Broly the unread "next time" clause names.
    if (c.stale && ref === c.stale) return null;
    // "Reduce the energy cost of a {Power Pole}" names no area, and 20-1-6's
    // default — a card on the table — is the one place a cost reduction can
    // never matter. What it is about is the card you are about to play.
    if ("sel" in ref && ref.sel.area === "play" && !/\b(?:hand|deck|drop|energy|warp|life|battle area)\b/i.test(targetText)) {
      ref = { sel: { ...ref.sel, area: "hand", count: 99 } };
    }
    const orbs = /^\d+$/.test(amountText) ? null : orbsIn(amountText);
    const flat: number = sign * (orbs ? Object.values(orbs).reduce<number>((sum, n) => sum + (n ?? 0), 0) : Number(amountText));
    let by: Amount = flat;
    if (perText) {
      const per = parseTarget(perText);
      if (!per) return null;
      by = { count: { ...per, count: undefined, upTo: undefined }, ...(flat === 1 ? {} : { times: flat }) };
    }
    // The duration is read off the printed clause, not the qualifier-stripped
    // one: "…for the duration of the turn" is exactly what `stripQualifiers`
    // takes off. A [Permanent] holds while its card is valid (9-5-1) and
    // `holdForGame` rewrites this to "game"; anywhere else it is what says how
    // long the change is in force.
    const what =
      kindWordTrim === "combo"
        ? ({ what: "combo" as const })
        : kindWordTrim === "z-energy"
          ? ({ what: "zEnergy" as const })
          : kindWordTrim === "skill"
            ? ({ what: "skill" as const })
            : kindWordTrim === "evolve"
              ? ({ what: "evolve" as const })
              : {};
    return [{ op: "costReduction", target: ref, amount: by, ...what, ...(skillKind ? { skillKind } : {}), until: durationOf(clause) }];
  }

  // "X get -N combo cost" (BT22-055, BT22-056, BT23-072): the same standing
  // reducer said the way the sibling rule just below reads "X get -N combo
  // power". The sign on the card is the direction, not decoration — "-1"
  // lowers the cost — the same inversion `costReduction`'s own sign takes for
  // the active "increase" verb above.
  if ((m = /^(.*?) (?:gets?|gains?) ([+-]\d+) combo cost$/.exec(q))) {
    const refs = refsFor(m[1], c);
    // Same stale-pronoun guard as the rule above — see its comment.
    if (refs?.some((r) => c.stale && r === c.stale)) return null;
    const until = durationOf(t);
    return refs ? refs.map((target) => ({ op: "costReduction", target, amount: -Number(m![2]), what: "combo" as const, until }) as Op) : null;
  }

  // 9-1-5: negating one named keyword rather than silencing the card.
  if ((m = /^negate (.+?)'s \[([a-z0-9\- ]+)\](?: skill)?(?: in (?:all|any) areas?)?$/.exec(t))) {
    // A tag that names a *kind* of skill rather than a keyword ("[Auto]") is
    // read further down; failing here would take the whole clause with it.
    const kw = keywordOf(m[2]);
    if (kw) {
      const ref = refFor(m[1], c);
      return ref ? [{ op: "negateKeyword", keyword: kw.name, target: ref }] : null;
    }
    if (!/^(?:auto|activate|counter|permanent)\b/.test(m[2])) return null;
  }
  // The same sentence with the target after the keyword rather than in front
  // of it — "Negate the [Energy-Exhaust] skill **on** your Red/Yellow
  // multicolor ≪God≫ cards in all areas". The possessive form above reads only
  // "negate X's [K]", so this word order went unread on every card that uses
  // it. A tag naming a *kind* of skill falls through to the rule for those,
  // exactly as it does above.
  if ((m = /^negate the \[([a-z0-9\- ]+)\] skills? (?:on|of) (.+)$/.exec(q))) {
    const kw = keywordOf(m[1]);
    if (kw) {
      const ref = refFor(m[2], c);
      return ref ? [{ op: "negateKeyword", keyword: kw.name, target: ref }] : null;
    }
    if (!/^(?:auto|activate|counter|permanent)\b/.test(m[1])) return null;
  }

  // "Only 1 {SS2 Trunks} can be played in your Battle Area" — a prohibition
  // that switches itself on once the card is there, which a [Permanent] can
  // say because the static layer asks again every time.
  // The same rule said three ways: "only 1 {SS2 Trunks} can be played in your
  // Battle Area", "you can only have up to 1 {X} in play in your Battle Area",
  // "only 1 copy of this card can be played in your Battle Area". Thirteen
  // cards print one of the last two, and none of them was read.
  //
  // Order matters twice over: "copies of this card" has to be tried before the
  // general form, which would take "copy of this card" for a description and
  // fail on it; and the "you can only have" wording arrives with its "you can"
  // already stripped off the front of `t`.
  if (
    (m = /^only (\d+) (?:copy|copies) of (this card) can be played in your battle area$/.exec(t)) ??
    (m = /^only have up to (\d+) (.+?) in play in your battle area$/.exec(t)) ??
    (m = /^only (\d+) (.+?) can be played in your battle area$/.exec(t))
  ) {
    // "Copies of this card" is the card's own name, which only the instance
    // knows — `sameNameAsSelf` on the prohibition is how that is said.
    if (m[2] === "this card") {
      return [
        {
          op: "if",
          cond: { kind: "count", sel: { side: "you", area: "battle", filter: parseFilter("") }, atLeast: Number(m[1]) },
          then: [{ op: "forbid", what: "play", side: "you", until: "game", sameNameAsSelf: true }],
        },
      ];
    }
    const filter = filterFor(m[2], null);
    if (!filter) return null;
    return [
      {
        op: "if",
        cond: { kind: "count", sel: { side: "you", area: "battle", filter }, atLeast: Number(m[1]) },
        then: [{ op: "forbid", what: "play", side: "you", until: "game", filter }],
      },
    ];
  }

  // Energy markers (5-14).
  if ((m = /^place (\d+) energy markers? in your energy(?: area)?$/.exec(t))) return [{ op: "energyMarker", n: Number(m[1]) }];

  // "This card gets +10000 power and [Double Strike] for the turn" — one
  // clause doing two things, and by far the commonest such clause in the game.
  // `splitClauses` keeps "and [" together on purpose, so that "gains [A] and
  // [B]" stays whole; the price is that this arrives in one piece, and until
  // it was read here the keyword was dropped without a word.
  // [Alliance] (22-32): "This card gains power equal to the total power of
  // the cards switched to Rest Mode by this skill [and [Double Strike]] for
  // the battle". The engine binds the cards it rested as the cost to `rested`.
  if ((m = /^(.*?) (?:gets?|gains?) power equal to the total power of the cards switched to rest mode by this skill(?:,? and ((?:\[[^\]]+\][\s,]*(?:and\s+)?)+))?$/.exec(q))) {
    const ref = refFor(m[1], c);
    const kws = m[2] ? [...m[2].matchAll(/\[([^\]]+)\]/g)].map((x) => keywordOf(x[1])) : [];
    if (ref && kws.every((k) => k)) {
      const until = durationOf(t);
      return [{ op: "power", target: ref, amount: { sumPower: { var: "rested" } }, until }, ...kws.map((k) => ({ op: "grant", target: ref, keyword: k!, until }) as Op)];
    }
  }

  if ((m = /^(.*?) (?:gets?|gains?) ([+-]\d+) (combo )?power,? and ((?:\[[^\]]+\][\s,]*(?:and\s+)?)+)$/.exec(q))) {
    const refs = refsFor(m[1], c);
    const kws = [...m[4].matchAll(/\[([^\]]+)\]/g)].map((x) => keywordOf(x[1]));
    if (refs && kws.length && kws.every((k) => k)) {
      const until = durationOf(t);
      const amount = Number(m[2]);
      const combo = !!m[3];
      return refs.flatMap((ref) => [
        (combo ? { op: "comboPower", target: ref, amount, until } : { op: "power", target: ref, amount, until }) as Op,
        ...kws.map((k) => ({ op: "grant", target: ref, keyword: k!, until }) as Op),
      ]);
    }
  }

  // Power and combo power (9-9). Cards say both "gets" and "gains". Matched
  // against the clause with its duration taken off, and anchored: a tail this
  // does not recognise has to fail here rather than be quietly discarded.
  if ((m = /^(.*?) (?:gets?|gains?) ([+-]\d+) combo power$/.exec(q))) {
    const refs = refsFor(m[1], c);
    const until = durationOf(t);
    return refs ? refs.map((target) => ({ op: "comboPower", target, amount: Number(m![2]), until }) as Op) : null;
  }
  // "It loses -5000 power" and "it loses 5000 power" both mean the same thing;
  // the sign on the card is decoration, the verb is what counts.
  if ((m = /^(.*?) loses ([+-]?\d+) power$/.exec(q))) {
    const refs = refsFor(m[1], c);
    const until = durationOf(t);
    return refs ? refs.map((target) => ({ op: "power", target, amount: -Math.abs(Number(m![2])), until }) as Op) : null;
  }
  if ((m = /^(.*?) (?:gets?|gains?) ([+-]\d+) power$/.exec(q))) {
    const refs = refsFor(m[1], c);
    const until = durationOf(t);
    return refs ? refs.map((target) => ({ op: "power", target, amount: Number(m![2]), until }) as Op) : null;
  }

  // 20-1: what a card counts as, rather than what it does. "This card gains
  // ≪Saiyan≫ in all areas" makes it a Saiyan to every skill that names one.
  //
  // The list may be followed by the noun it is a list of: BT2-001 Vegito says
  // "gain red, blue, and green **colors**", where every other card of this
  // shape stops at the last colour. Anchored as this rule is, that one word
  // failed the whole match and the Leader's only [Permanent] went unread.
  if (
    (m =
      /^(.*?) (?:gains?|is (?:also )?treated as(?: an?)?) ((?:(?:non-)?(?:\{[^}]+\}|<[^>]+>|≪[^≫]+≫|red|blue|green|yellow|black|white)[\s,]*(?:and\s+|or\s+)?)+)(?:\s*colou?rs?)?(?: in (?:all|any) areas?)?$/.exec(
        t,
      ))
  ) {
    const what = m[2];
    const filter = parseFilter(what);
    const colors = filter.colors;
    // A whole card name is the fourth thing a card can be "also treated as",
    // and the one this rule could not read: eight cards print "this card is
    // also treated as {Planet M-2} in all areas", which is what makes every
    // skill naming that card find this one (20-1).
    if (!filter.traits.length && !filter.characters.length && !colors.length && !filter.names.length) return null;
    if (filter.notTraits.length || filter.notCharacters.length || filter.notNames.length) return null;
    const ref = refFor(m[1] || "this card", c);
    return ref ? [{ op: "gains", target: ref, traits: filter.traits, characters: filter.characters, colors, ...(filter.names.length ? { names: filter.names } : {}) }] : null;
  }

  // Granting keyword skills (20-18); one clause can grant several.
  if ((m = /^(.*?) gains? ((?:\[[^\]]+\][\s,]*(?:and\s+)?)+)$/.exec(q))) {
    const ref = refFor(m[1], c);
    const kws = [...m[2].matchAll(/\[([^\]]+)\]/g)].map((x) => keywordOf(x[1]));
    if (!ref || !kws.length || kws.some((k) => !k)) return null;
    const until = durationOf(t);
    return kws.map((k) => ({ op: "grant", target: ref, keyword: k!, until }) as Op);
  }
  // A trailing fragment of such a list, left over from splitting on "and".
  if ((m = /^((?:\[[^\]]+\][\s,]*(?:and\s+)?)+)$/.exec(q)) && c.lastTarget) {
    const kws = [...m[1].matchAll(/\[([^\]]+)\]/g)].map((x) => keywordOf(x[1]));
    if (kws.length && kws.every((k) => k)) {
      const until = durationOf(t);
      return kws.map((k) => ({ op: "grant", target: c.lastTarget!, keyword: k!, until }) as Op);
    }
  }

  // What a [Counter: Play] does to the card it is answering (9-6). "Instead of
  // being played" is the phrase that negates the play; without it the card is
  // played and only the manner changes.
  {
    const stopped =
      /^(?:it'?s|it is|that card is|the (?:battle |extra |unison )?card being played is) (?:(?:placed|put) (?:in|into|at) (?:its owner'?s?|their owners?'?s?|your|the|their) (?:(drop)(?: area)?|bottom of (?:its owner'?s?|their|your) deck|(warp)s?)|(?:returned) to (?:its owner'?s?|their owners?'?s?|your|their) (hand)s?)(?: instead)?(?: of being played)?$/.exec(
        t,
      );
    if (stopped && /instead of being played|instead$/.test(t)) {
      // 22-13-4-5-1-1 names the hand form specially: a card "returned to its
      // owner's hand instead of being played" does *not* then go to the Drop.
      const to: ScriptArea = stopped[1] ? "drop" : stopped[2] ? "warp" : stopped[3] ? "hand" : "deck";
      return [{ op: "resolvingPlay", instead: to, ...(to === "deck" ? { position: "bottom" as const } : {}) }];
    }
    // "The Battle Card being played is played in Rest Mode" (BT10-105).
    if (/^(?:it'?s|it is|that card is|the (?:battle |extra |unison )?card being played is) played in rest mode$/.test(t)) return [{ op: "resolvingPlay", mode: "rest" }];
    // "It's played with its skills negated for the turn" (BT11-099).
    if (/^(?:it'?s|it is|that card is|the (?:battle |extra |unison )?card being played is) played with (?:its|their) skills negated(?: for the turn)?$/.test(t))
      return [{ op: "resolvingPlay", negated: true }];
  }

  // Negation (9-1).
  if (/^negate (?:the|that|this) attack$/.test(t)) return [{ op: "negateAttack" }];
  // 9-1-5: a skill that switches itself off, for effects meant to happen once.
  // "For the game" is a mark on the instance; the two shorter durations are
  // continuous effects, because they have to come back.
  if (/^negate this skill for the (?:duration of the )?game$/.test(t)) return [{ op: "negateOwnSkill" }];
  if (/^negate this skill for the (?:duration of the )?turn$/.test(t)) return [{ op: "negateOwnSkill", until: "turn" }];
  if (/^negate this skill for the (?:duration of the |rest of the )?battle$/.test(t)) return [{ op: "negateOwnSkill", until: "battle" }];

  // 3-1-6-1: a Battle Card may sit in either player's Battle Area, so taking
  // control of one is a move to your own — mode and markers carried, because
  // the card itself does not change (23-3).
  if (/^gain control of (?:it|them|that card|those cards)$/.test(t) && c.lastTarget) {
    return [{ op: "moveTo", target: c.lastTarget, to: "battle" }];
  }

  // "Negate that card's [Auto] skill for the turn" — one kind, not the card.
  // Read *before* the two below: their subject is `(.*?)`, which would happily
  // swallow the tag and silence every skill the card has.
  if ((m = /^negate (.*?)(?:'s)? \[(auto|activate[^\]]*|counter[^\]]*|permanent)\] skills?$/.exec(q))) {
    const ref = refFor(m[1], c);
    const kind = m[2].split(":")[0].trim() as SkillKindPrefix;
    return ref ? [{ op: "negateSkillsOfKind", target: ref, kind, until: durationOf(t) }] : null;
  }
  // "Negate it for the duration of the turn": a card, so all of its skills (9-1-5).
  if ((m = /^negate (it|them|that card|those cards)$/.exec(q))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "negateSkills", target: ref, until: durationOf(t) }] : null;
  }
  /*
   * "Negate the skills **of** X" — the same clause with the target behind the
   * noun. Written once on 9 Sep 2026 and thrown away the same day: it read
   * three of the cards printing it wrongly, and all three failures were in the
   * target grammar underneath rather than in this line. With those fixed
   * (a Leader as `special`, "other" as `notSelf`, and the qualifiers
   * `parseTarget` now refuses outright) it is back, and the eleven cards read
   * as follows — the list is the sign-off, not decoration:
   *
   * - your opponent's Leader (BT28-149) → the opposing leader;
   * - all other Battle Cards (BT10-153, DB1-066) → both Battle Areas, this
   *   card excluded — a [Permanent] that negated itself before;
   * - those cards (BT13-106, BT23-135) → the choice the same skill just made;
   * - all cards in your opponent's Combo Area (BT20-086), your opponent's
   *   non-Extra Cards in all areas (BT9-136), their Battle Cards with energy
   *   costs of 4 or less (TB1-048) → as printed;
   * - Battle Cards on top of this card (BT23-070) → the card this one is
   *   under (23-2), which is `onTop` since 9 Sep 2026 — before that the phrase
   *   read as *this card*, and the [Permanent] negated itself;
   * - cards sent to Warps by this skill (EX21-15, BT13-096) → **not read**,
   *   and left to the referee: they name cards by their history, which no
   *   selector can describe.
   */
  if ((m = /^negate the skills of (.+)$/.exec(t.replace(DURATION_TAIL, "")))) {
    const ref = refFor(m[1], c);
    // The length of time comes off the tail alone, not off the whole clause:
    // `durationOf` reads "in all areas" as *for the game* (the approximation
    // `gains` rests on), and here those words are the target's scope, so
    // BT9-136's one-turn negation came back permanent.
    const tail = DURATION_TAIL.exec(t)?.[0];
    return ref ? [{ op: "negateSkills", target: ref, until: durationOf(tail ?? t) }] : null;
  }
  if ((m = /^negate (.*?)(?:'s)? skills$/.exec(q))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "negateSkills", target: ref, until: durationOf(t) }] : null;
  }

  // Prohibitions (20-14). 0-2-5: they beat instructions, so the engine checks
  // them last; here we only have to say precisely what is forbidden to whom.
  // Some sets print the same rule as "will not" rather than "can't"
  // ("the chosen card will not switch to Active Mode during your next Charge
  // Phase"); it forbids the action just the same.
  if (/\bcan'?t\b|\bcannot\b|\bwill not\b|\bwon'?t\b/.test(t)) {
    const forbid = compileProhibition(t, c);
    if (forbid) return forbid;
  }

  // 9-1-4: a card no skill may touch, said as "isn't affected by …" rather
  // than as a prohibition, so it does not fall under the "can't" dispatch above.
  if (/\b(?:is not|isn'?t)\s+affected by\b/.test(t)) {
    const immune = compileImmunity(t, c);
    if (immune) return immune;
  }

  // 9-7: answering a counter with a counter. "The [Counter]" is always the one
  // being answered, so nothing has to be named.
  if (/^negate the \[counter[^\]]*\](?: skill)?$/.test(t)) return [{ op: "negateCounter" }];

  // 8-1-1 lifted: "This card can attack Battle Cards in Active Mode", "your
  // red cards can attack your opponent's Battle Cards without [Barrier] in
  // Active Mode". Forty-eight clauses, and the largest wording left in this
  // family. The subject may be missing — the sentence is often the second half
  // of "this card gets +10000 power **and** can attack Battle Cards in Active
  // Mode" — in which case it is about whatever the clause before it named.
  if ((m = /^(.*?)\s*can attack (.+?) (?:that are |that is )?in active mode$/.exec(q))) {
    const who = m[1].trim();
    const ref = who ? refFor(who, c) : (c.lastTarget ?? { sel: { special: "self" as const } });
    if (!ref) return null;
    // What may be attacked. "Your opponent's" says nothing — an attack is
    // always against theirs (8-1) — but "without [Barrier]" narrows it, and a
    // description the parser cannot read must fail rather than permit every
    // active card.
    const what = m[2].replace(/^(?:your opponent'?s|their|the)\s+/i, "");
    const filter = filterFor(what, null);
    if (!filter) return null;
    return [{ op: "permit", what: "attackActive", target: ref, until: durationOf(t), filter }];
  }

  // Mode switches (1-10).
  // A few cards drop the word: "switch 1 of your Chilled Army tokens to rest".
  if ((m = /^switch (.*?) to (active|rest)(?: mode)?$/.exec(t))) {
    const mode = m[2] as "active" | "rest";
    // "Switch this card **and** up to 1 of your energy to Active Mode": one
    // verb, two targets, and `refFor` would collapse them to this card and
    // leave the energy standing. Each target keeps its own choice, because
    // only one of the two carries a number.
    const refs = refsFor(m[1], c);
    if (!refs) return null;
    // "Switch up to 1 of your energy to Active Mode" names a number, so it is
    // a choice first (5-2); without this it switched every card in the area.
    return refs.flatMap((ref) => withChoice(ref, clause, c, (target) => ({ op: "switchMode", target, mode })));
  }
  // "You may flip this card over" on a Leader's [Auto]: the Leader awakens
  // (22-2-4 says how a flip works; this says when). A card without a back
  // side is left as it is.
  if ((m = /^(?:you may )?flip (.+?) (?:over|onto its back)$/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "flip", target: ref }] : null;
  }
  // 3-9-2-1: a Life card turned face up stays in the Life Area and is still
  // taken as damage in its turn, but both players can see it and skills can
  // read it. "Flip up to 1 card in your life face up" names a number, so it is
  // a choice first (5-2); "flip all face-up cards in your life face down" does
  // not, and its own filter is what finds the cards to turn back over.
  if ((m = /^(?:you may )?flip (.+?) face[- ](up|down)$/.exec(t))) {
    const up = m[2] === "up";
    const ref = refFor(m[1], c);
    return ref ? withChoice(ref, clause, c, (target) => ({ op: "faceUp", target, ...(up ? {} : { faceUp: false }) })) : null;
  }
  // 23-5: "switch it to Hidden Mode", "switch it to Revealed Mode".
  if ((m = /^switch (.+?) to (hidden|revealed) mode$/.exec(t))) {
    const ref = refFor(m[1], c);
    const hidden = m[2] === "hidden";
    return ref ? withChoice(ref, clause, c, (target) => ({ op: "hidden", target, hidden })) : null;
  }
  // "Use up to 1 green card with 5000 combo power from your Drop in a combo
  // with its skills negated for the battle", "use this card from your Drop in
  // a combo", "combo with it" (5-7).
  if (
    (m = /^(?:use|combo with) (.+?)(?: from (?:your|their) (drop|warp|hand)(?: area)?)?(?: in a combo)?(?: from (?:your|their) (drop|warp|hand)(?: area)?)?( with (?:its|their) skills negated)?$/.exec(
      q,
    )) &&
    /\bcombo\b/.test(t)
  ) {
    const from = m[2] ?? m[3];
    const ref = refFor(from ? `${m[1]} in your ${from}` : m[1], c);
    const negated = !!m[4];
    return ref ? withChoice(ref, clause, c, (target) => ({ op: "comboFrom", target, ...(negated ? { negated } : {}) })) : null;
  }
  // "Switch the target of the attack to it / to this card" (8-1, as a [Blocker] does).
  if ((m = /^(?:switch|change) the (?:target of (?:the )?attack|attack target) to (.+)$/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? withChoice(ref, clause, c, (target) => ({ op: "redirectAttack", target })) : null;
  }

  // KO (5-12).
  if ((m = /^ko (.+)$/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? withChoice(ref, clause, c, (target) => ({ op: "ko", target })) : null;
  }

  // Markers (5-13, 13-3). "A marker" is one marker.
  if ((m = /^add (a|an|\d+) markers? to (.+)$/.exec(t))) {
    const ref = refFor(m[2], c);
    return ref ? [{ op: "addMarker", target: ref, n: countWord(m[1]) }] : null;
  }
  if ((m = /^remove (a|an|\d+) markers? from (.+)$/.exec(t))) {
    const ref = refFor(m[2], c);
    return ref ? [{ op: "removeMarker", target: ref, n: countWord(m[1]) }] : null;
  }
  // "Pay the cost for [Spirit Boost 2]" (22-43-3), as an alt-cost's own price
  // rather than a skill's own — the marker cost that keyword names is fixed
  // wherever it is spent, off your Unison Card (BT14-019/043/083/109,
  // BT17-109's [Permanent]s all name it this way instead of writing it out).
  if ((m = /^pay the cost for \[spirit boost (\d+)\]$/.exec(t))) {
    return [{ op: "removeMarker", target: { sel: { side: "you", area: "unison" } }, n: Number(m[1]) }];
  }

  // Under another card (23-2). Not an area, so it is not in the table below.
  // Only "under this card" is read: any other host is an antecedent the
  // compiler would have to guess at, and a wrong guess moves the wrong card.
  if ((m = /^(?:place|put) (.+?) (?:face ?up )?under this card$/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "moveTo", target: ref, to: "under" }] : null;
  }
  // The same stack said from the other end: this card ends up underneath.
  if ((m = /^(?:place|put) (.+?) on top of this card$/.exec(t))) {
    const host = refFor(m[1], c);
    return host ? [{ op: "moveTo", target: { sel: { special: "self" } }, to: "under", under: host }] : null;
  }
  // "Place this card under the played card", "place it under the card you
  // played with this skill", "…under your Leader", "…under {Wickedest Clan}":
  // hosts the text names precisely, so no guessing.
  // "Choose 1 {Spaceship, Vessel of Hope} in your Unison Area **and place this
  // card under it**": "it" is the card the clause before just chose, which is
  // the only antecedent it can have — the host is never the card being placed.
  if (
    (m =
      /^(?:place|put) (.+?) (?:face ?up )?under (the chosen [^,.]+|the played card|the card (?:that was |you )?played(?: with this skill)?|your leader(?: card)?|it|them|that card|those cards|\{[^}]+\}(?: in your battle area)?)$/.exec(
        t,
      ))
  ) {
    const host = refFor(m[2], c);
    const ref = refFor(m[1], c);
    return host && ref ? withChoice(ref, clause, c, (target) => ({ op: "moveTo", target, to: "under", under: host })) : null;
  }

  // "Place up to 1 yellow ≪Frieza Clan≫ card from your Drop under {Wickedest
  // Clan} in your Battle Area" (23-2): the card and where it comes from, then
  // the host.
  if ((m = /^place (.+?) from (?:your|their) (drop|warp|hand|deck)(?: area)? under (.+?)(?: in (?:your|the) battle area)?$/.exec(t))) {
    const ref = refFor(`${m[1]} in your ${m[2]}`, c);
    const host = refFor(m[3], c);
    return ref && host ? withChoice(ref, clause, c, (target) => ({ op: "moveTo", target, to: "under", under: host })) : null;
  }
  // "Place up to 2 {Dragon Ball} from your Drop into the Battle Area" — placed,
  // not played (5-5), so nothing that triggers on a play fires.
  if ((m = /^place (.+?) from (?:your|their) (drop|warp|hand)(?: area)? (?:into|in) (?:your|the|their) battle area$/.exec(t))) {
    const ref = refFor(`${m[1]} in your ${m[2]}`, c);
    return ref ? withChoice(ref, clause, c, (target) => ({ op: "moveTo", target, to: "battle" })) : null;
  }
  // "Shuffle them into your deck": into the deck, then the deck is shuffled (3-2-3).
  if ((m = /^shuffle (.+?) (?:into|in) (?:your|their|its owner'?s?|their owners?'?) decks?$/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? [...withChoice(ref, clause, c, (target) => ({ op: "moveTo", target, to: "deck" })), { op: "shuffle" }] : null;
  }

  // Area moves (3-1).
  const MOVES: [RegExp, ScriptArea, { position?: "top" | "bottom"; mode?: "active" | "rest"; reveal?: boolean; owner?: Side }][] = [
    // "their owners' decks", "its owner's hand": several cards go to several
    // owners' areas, which `moveTo` does one card at a time anyway.
    [/^place (.+?) (?:in|into) (?:its owner'?s?|their owners?'?s?|their|your|the) drops?(?: area)?s?$/, "drop", { reveal: true }],
    [/^place (.+?) (?:at|on) the bottom of (?:its owner'?s?|their owners?'?s?|their|your) decks?(?: in any order)?$/, "deck", { position: "bottom" }],
    [/^place (.+?) on top of (?:its owner'?s?|their owners?'?s?|their|your) decks?(?: in any order)?$/, "deck", { position: "top" }],
    [/^return (.+?) to (?:its|their) owners?'?s? hands?$/, "hand", {}],
    [/^return (.+?) to (?:your|their) hands?$/, "hand", {}],
    [/^add (.+?) to your hand$/, "hand", {}],
    [/^send (.+?) to (?:your|their|its owner'?s?|their owners?'?s?|the) warps?$/, "warp", {}],
    // The passive said the same as the active line above — "it's sent to its
    // owner's Warp" (9-10, ten cards) rather than "send it to Warp" — and the
    // subject is always the pronoun a replacement clause already resolved.
    [/^(it)(?:'s| is) sent to (?:its owner'?s?|your|their|the) warps?$/, "warp", {}],
    [/^(it)(?:'s| is) placed at the bottom of (?:its owner'?s?|your|their) decks?$/, "deck", { position: "bottom" }],
    // 3-8: whose energy area matters, and it is not always the card's owner —
    // "place it in your opponent's energy in Rest Mode" hands them a card.
    [/^(?:add|place) (.+?) (?:to|in) your opponent'?s energy(?: area)? in rest mode$/, "energy", { mode: "rest", reveal: true, owner: "opponent" }],
    [/^(?:add|place) (.+?) (?:to|in) your opponent'?s energy(?: area)?$/, "energy", { reveal: true, owner: "opponent" }],
    [/^(?:add|place) (.+?) (?:to|in) your energy(?: area)? in rest mode$/, "energy", { mode: "rest", reveal: true, owner: "you" }],
    [/^(?:add|place) (.+?) (?:to|in) your energy(?: area)?$/, "energy", { reveal: true, owner: "you" }],
    // 3-9: the Life Area takes cards from the hand as well as the deck, and
    // the yellow ≪Frieza's Army≫ cards print it both ways round.
    [/^(?:add|place|put) (.+?) (?:in|into|to) your life(?: area)?$/, "life", {}],
    [/^(?:add|place|send) (.+?) (?:in|into|to) your z-energy$/, "zEnergy", {}],
    [/^remove (.+?) from the game(?: instead)?$/, "removed", {}],
  ];
  for (const [re, to, opts] of MOVES) {
    if ((m = re.exec(t))) {
      const ref = refFor(m[1], c);
      return ref ? withChoice(ref, clause, c, (target) => ({ op: "moveTo", target, to, ...opts })) : null;
    }
  }

  // "Until the start of your next turn, you can activate mono-blue cards
  // with [Counter] skills from your hand by …" (BT11-033): the same offer
  // `counterAltCost` reads for a card's own [Counter], granted instead to
  // *other* cards a filter names, for a stated span. Tried before the
  // ordinary "activate a card" read just below, which would otherwise take
  // the whole selector-plus-price phrase for one long card description — its
  // greedy `(.+?)` reaches straight through "with [Counter] skills from your
  // hand" and swallows the price after it too, so the price's own count
  // ("choosing 2 other cards") was read as the *selector's* count instead,
  // and "activate" as an instruction to play the cards it found. A duration
  // split onto this clause by `PURE_DURATION` above lands at the end, which
  // is where `durationOf` looks for it; without one printed here the shape is
  // not a case this reads, so the clause is left to the referee rather than
  // guessed a duration of "the turn".
  if (/\buntil\b/i.test(clause)) {
    const other = /^activate (.+? with \[counter[^\]]*\] skills?) from your hand /.exec(q);
    if (other) {
      const filter = filterFor(other[1], "hand");
      if (filter === null) return null; // ground rule 5: an unreadable filter must not widen to "any card"
      // The price can run past a comma or "and …ing" that `splitClauses`
      // treats as a clause boundary of its own elsewhere ("…choosing 2 other
      // cards in your hand **and discarding them**") — read here, the tail
      // this clause carries would already have lost that second half, and
      // `altCostHow` would hand back a price that only chose the cards and
      // never spent them. Reading it instead from `c.raw`, the sentence as
      // printed, is what the self-only reading below this one is already
      // spared from having to do, because it runs before any splitting at all.
      const whole = /you (?:can|may) activate .+? with \[counter[^\]]*\] skills? from your hand ([^.]+)\.?/i.exec(c.raw);
      const alt = whole ? altCostHow(whole[1].trim(), c) : null;
      if (!alt) return null;
      const target: Ref = { sel: { side: "you", area: "hand", ...(filter ? { filter } : {}) } };
      return alt.map((o) => (o.op === "altCost" ? { ...o, target, until: durationOf(clause) } : o));
    }
  }

  // "Play up to 1 <Majin Buu> card from your deck on top of this card"
  // (22-13-6-3). The host has to come off the phrase before the target is
  // read: "this card" at the end of it made `parseTarget` take the whole
  // thing for this card, and the skill played the card onto itself.
  if (
    (m =
      /^(?:play|activate) (.+?)(?: in (rest|active) mode)? on top of (this card|it|the played card|the chosen card)(?: in (rest|active) mode)?(?: with (?:its|their) (?:non-keyword )?skills negated(?: for (?:the )?(turn|game|battle))?)?$/.exec(
        t,
      ))
  ) {
    const onto = refFor(m[3], c);
    const ref = refFor(m[1], c);
    const mode = (m[2] ?? m[4]) as "rest" | "active" | undefined;
    // 9-1-5: the sets print "for game" as well as "for the game"; anything
    // shorter than the game is an effect with a duration.
    const negated: "turn" | "game" | undefined = /skills negated/.test(t) ? (m[5] === "game" ? "game" : "turn") : undefined;
    if (!onto || !ref) return null;
    const extra = { onto, ...(mode ? { mode } : {}), ...(negated ? { negated } : {}) } as const;
    if ("sel" in ref) {
      const v = `p${c.n++}`;
      c.lastPlayed = v;
      return [
        { op: "choose", sel: ref.sel, as: v, reason: clause },
        { op: "play", target: { var: v }, ...extra },
      ];
    }
    return [{ op: "play", target: ref, ...extra }];
  }

  // Playing a card by a skill (5-5-3).
  // "Activate" is what the text calls playing an Extra card (12-2), so the two
  // words lead to the same place. A card that says "play … in Rest Mode" is
  // still played from wherever it is; the mode belongs to the play, not to the
  // choice, or the choice would go looking for a card already rested.
  if ((m = /^(?:play|activate) (.+?)(?: in (rest|active) mode)?(?: with (?:its|their) (?:non-keyword )?skills negated(?: for (?:the )?(turn|game|battle))?)?$/.exec(t))) {
    if (/token/.test(t)) return compileToken(clause, c);
    const mode = m[2] as "rest" | "active" | undefined;
    // 9-1-5: "played … with its skills negated", which the sets print with and
    // without the article before "game".
    const negated: "turn" | "game" | undefined = /skills negated/.test(t) ? (m[3] === "game" ? "game" : "turn") : undefined;
    const ref = refFor(m[1], c);
    if (!ref) return null;
    const extra = { ...(mode ? { mode } : {}), ...(negated ? { negated } : {}) } as const;
    if ("sel" in ref) {
      // "play up to 1 X from your hand" is a choice followed by the play.
      const v = `p${c.n++}`;
      c.lastPlayed = v;
      return [
        { op: "choose", sel: ref.sel, as: v, reason: clause },
        { op: "play", target: { var: v }, ...extra },
      ];
    }
    return [{ op: "play", target: ref, ...extra }];
  }

  // 5-2: the skill is yours, but the choice is *theirs* — "your opponent
  // chooses 1 of their Battle Cards" and the clause after it says what happens
  // to what they picked. Twenty-odd clauses, and every one of them is a
  // decision the wrong player would otherwise take: KO'ing their own weakest
  // card is not the same game as you KO'ing their best.
  //
  // The plain hand discard is read above as a `discard`, which splices the
  // same choose with the same chooser; this is every other area.
  if ((m = /^(?:your opponent|they) chooses? (.+)$/.exec(t))) {
    const sel = parseTarget(m[1]);
    if (sel && sel.side === "opponent") {
      if (/\bup to\b/.test(m[1])) sel.upTo = true;
      const v = `c${c.n++}`;
      return [{ op: "choose", sel, as: v, chooser: "opponent", reason: clause }];
    }
    return null;
  }

  // "Look at up to the top 3 cards of your deck, **choose 1**, and add it to
  // your hand" (20-12): the sentence does not repeat what is being chosen
  // among, because the clause before it just said. Without this the middle
  // clause was a fragment and the whole skill went to the referee.
  if ((m = /^choose (up to )?(\d+)$/.exec(t)) && c.lastSeen) {
    const v = `c${c.n++}`;
    return [{ op: "choose", sel: { fromVar: c.lastSeen, count: Number(m[2]), upTo: !!m[1] }, as: v, reason: clause }];
  }

  // Choosing (5-2). Late, because many clauses open with "choose" plus an action.
  if (/^choose /.test(t)) {
    let sel = parseTarget(clause, undefined, c.lastSeen ?? undefined);
    // "When your opponent plays a Battle Card, you may choose **that card**":
    // the trigger already named it, so there is nothing to pick out of an area
    // — the only question is whether to take it.
    if (!sel) {
      const named = refFor(t.replace(/^choose\s+/, ""), c);
      if (named) sel = "sel" in named ? { ...named.sel } : { fromVar: named.var, count: 1 };
    }
    if (!sel) return null;
    // 5-2-4: "you may" is what makes a choice declinable, and the prefix is
    // stripped from `t` before any pattern sees it.
    if (/^(?:you may|you can|the player may)\s+/i.test(clause.trim())) {
      sel.count ??= 1;
      sel.upTo = true;
    }
    // "…with power less than or equal to **the chosen card's** power"
    // (BT19-096): `parseFilter` cannot know which variable that is — only the
    // compiler does, and only right here, before this clause's own choice
    // overwrites `c.last` with a new one. Left unresolved (no prior choice to
    // point at) the filter still measures nothing rather than a card it was
    // never told about; see the field's comment in `filters.ts`.
    if (sel.filter?.powerRel?.of === "chosen" && c.last) sel = { ...sel, filter: { ...sel.filter, powerRel: { ...sel.filter.powerRel, var: c.last } } };
    const v = `c${c.n++}`;
    return [{ op: "choose", sel, as: v, reason: clause }];
  }

  // "Choose 1 of your <Majin Buu> and 1 of your opponent's Battle Cards"
  // splits on the "and", and the second half arrives with the verb left
  // behind. A bare target phrase after a choice is another choice.
  if (c.last && /^(?:up to )?\d+ /.test(t)) {
    const sel = parseTarget(clause, undefined, c.lastSeen ?? undefined);
    if (sel) {
      const v = `c${c.n++}`;
      return [{ op: "choose", sel, as: v, reason: clause }];
    }
  }

  return null;
}

/**
 * "This card isn't affected by your opponent's skills" (9-1-4) and its
 * variants — a card no skill may touch, not merely one that can't be chosen
 * (`forbid: "beChosen"`). The head names *which* cards this is about, the
 * same grammar `compileProhibition` reads; the tail after "affected by"
 * names *whose* skills are blocked, either as a bare player ("your
 * opponent's") or as a description of the source card itself
 * ("non-<Gogeta: GT>", "the skills of red ≪Saiyan≫ cards with 20000 power or
 * less in any of your opponent's areas").
 */
function compileImmunity(t: string, c: Ctx): Op[] | null {
  const m = /^(.*?)\s*(?:is not|isn'?t)\s+affected by\s+(.+)$/.exec(t);
  if (!m) return null;
  const subject = m[1].trim();

  // BT9-119: "until the start of your next Main Phase" lands a phase later
  // than any duration this engine can name exactly — `afterNextCharge`
  // expires a phase early, while the card is still exposed — so the clause
  // is refused rather than landed on a wrong approximation.
  if (/\bnext main phase\b/.test(m[2])) return null;

  const target = subject ? refFor(subject, c) : (c.lastTarget ?? refFor("this card", c));
  if (!target) return null;
  const until = durationOf(t);

  const tail = stripQualifiers(m[2].trim());
  let mm: RegExpExecArray | null;
  let sourceDesc: string | null = null;
  if ((mm = /^the skills of (.+)$/.exec(tail))) sourceDesc = mm[1];
  else if ((mm = /^(.+?) skills$/.exec(tail))) sourceDesc = mm[1];
  if (sourceDesc == null) return null;

  // A bare rule about the side, naming no cards at all — the same shape
  // `forbid` reads with no filter.
  if (/^your opponent'?s?$/.test(sourceDesc)) return [{ op: "immune", until, target, from: "opponent" }];

  // Whose skills, said the long way: a player named in front of the source
  // cards ("opponent's non-Extra cards") or implied by where they are
  // ("… in any of your opponent's areas"). Absent means either side, same
  // convention as `forbid`'s own `side`.
  let rest = sourceDesc;
  let from: Side | undefined;
  if ((mm = /^(?:your\s+)?opponent'?s\s+(.+)$/.exec(rest))) {
    from = "opponent";
    rest = mm[1];
  } else if ((mm = /^(.+?)\s+in (?:any of )?your opponent'?s areas$/.exec(rest))) {
    from = "opponent";
    rest = mm[1];
  }

  // A description the parser cannot read must refuse the clause rather than
  // widen it to every skill — the same rule a `forbid` filter follows.
  const filter = filterFor(rest, null);
  if (filter === null) return null;
  if (!filter && !from) return null;

  return [{ op: "immune", until, target, from, fromFilter: filter || undefined }];
}

/**
 * "Play 2 Cell Jr. tokens" — the stats are printed in the explanatory note
 * that follows, which is stripped from the clause, so they are read from the
 * untouched skill text (19-1-2).
 */
/**
 * "You can't play copies of this card for the turn", "it can't switch to
 * Active Mode until the end of your opponent's turn", "your opponent can't
 * attack with their Leader Card".
 *
 * Two questions decide the shape: who or what the sentence is about — a player
 * ("you", "your opponent") or particular cards — and which action it names.
 * Only actions the engine actually checks are compiled; anything else is left
 * unread, because a prohibition nothing enforces is worse than an honest gap.
 */
function compileProhibition(t: string, c: Ctx): Op[] | null {
  const until = durationOf(t);
  // The subject may be missing: "it gets +10000 power **and** can't attack for
  // the turn" splits at the "and", and the second half arrives with the card
  // it is about in the clause before it. Fifteen clauses.
  const m = /^(.*?)\s*(?:can'?t|cannot|will not|won'?t)\s+(.*)$/.exec(t);
  if (!m) return null;
  const subject = m[1].trim();
  const rest = m[2].trim();

  // Deck-building restrictions are not rules of play (6-1); the engine takes
  // the deck it is given, so the clause is read and does nothing.
  if (/^include\b/.test(rest)) return [];

  const side: Side | null = /^you$/.test(subject) ? "you" : /^your opponent$/.test(subject) ? "opponent" : null;

  // A sentence about a player: what follows names the cards it is about.
  if (side) {
    let mm: RegExpExecArray | null;
    if ((mm = /^play\s+(.*)$/.exec(rest))) {
      const what = mm[1];
      if (/\bcopies of this card\b|\banother copy of this card\b/.test(what)) return [{ op: "forbid", what: "play", side, until, sameNameAsSelf: true }];
      if (/^this card\b/.test(what)) return [{ op: "forbid", what: "play", side, until, target: { sel: { special: "self" } } }];
      const filter = filterFor(what, null);
      const type = /\bunison cards?\b/.test(what) ? "UNISON" : /\bextra cards?\b/.test(what) ? "EXTRA" : /\bbattle cards?\b/.test(what) ? "BATTLE" : null;
      // A description that could not be read must not fall back to the type
      // alone: "you can't play Battle Cards with [X]" would ban every Battle
      // Card, which is a wider rule than the card states.
      if (filter === null) return null;
      if (!filter && !type) return null;
      return [{ op: "forbid", what: "play", side, until, filter: { ...(filter ?? parseFilter("")), ...(type ? { type } : {}) } }];
    }
    if (/^attack\b/.test(rest)) {
      // "attack this card" is about the defender, not the attacker.
      if (/^attack (?:this card|it)\b/.test(rest)) return [{ op: "forbid", what: "beAttacked", until, target: { sel: { special: "self" } } }];
      const withWhat = /\bwith (.*)$/.exec(rest)?.[1];
      const filter = withWhat ? filterFor(withWhat, null) : undefined;
      // Same again: an unread description would forbid every attack rather
      // than the ones the card names.
      if (filter === null) return null;
      const type = withWhat && /\bleader cards?\b/.test(withWhat) ? "LEADER" : withWhat && /\bbattle cards?\b/.test(withWhat) ? "BATTLE" : null;
      return [{ op: "forbid", what: "attack", side, until, filter: filter || type ? { ...(filter ?? parseFilter("")), ...(type ? { type } : {}) } : undefined }];
    }
    if (/^activate\b/.test(rest) && /\[counter/.test(rest)) return [{ op: "forbid", what: "activateCounter", side, until }];
    if (/^activate\b/.test(rest) && /\[blocker/.test(rest)) return [{ op: "forbid", what: "block", side, until }];
    // "You can't place cards in your energy for the turn" (EX22-02): the
    // Charge Phase, which the engine offers as an action of its own (3-8).
    if (/^place cards? (?:in|into) (?:your|their) energy\b/.test(rest)) return [{ op: "forbid", what: "placeEnergy", side, until }];
    return null;
  }

  // A sentence about cards: "this card", "it", "your Battle Cards". With no
  // subject at all it continues the clause before it, and only falls back to
  // this card when nothing was named — which is what the sets mean when they
  // print "this card gets +5000 power and can't attack for the turn".
  const target = subject ? refFor(subject, c) : (c.lastTarget ?? refFor("this card", c));
  if (!target) return null;
  // "can't be KO'd by your opponent's skills" — who is stopped from doing it.
  const bySide: Side | undefined = /\bby your opponent'?s? skills?\b/.test(rest) ? "opponent" : /\bby your skills?\b/.test(rest) ? "you" : undefined;
  // "This card can't be played by skills from any area", "…from any area
  // except by skills" (20-14). Fifteen cards print one of these, and the moment
  // that matters is always a *skill* reaching into the Drop or the deck for
  // them, so which of the two it is decides everything. The forms that carve
  // out an exception — "by skills other than its own", "with non-[Evolve]
  // skills" — are left unread: an exception the engine gets wrong bans a play
  // the card allows, and a gap here only means the card is playable as normal.
  if (/^be played\b/.test(rest) && !/\bother than\b|\bnon-\[|\bexcept its own\b/.test(rest)) {
    // "From any area" is not a duration and `durationOf` does not read it as
    // one: the rule holds for the whole game, which is what makes it a
    // property of the card rather than something a turn wears off.
    if (/\bexcept by (?:card )?skills?\b|\bunless (?:it is |it's )?played by (?:card )?skills?\b/.test(rest)) {
      return [{ op: "forbid", what: "play", until: "game", target, bySkill: false }];
    }
    if (/\b(?:by|with) (?:your |their )?(?:card )?skills?\b/.test(rest)) {
      return [{ op: "forbid", what: "play", until: "game", target, bySkill: true }];
    }
    return null;
  }
  if (/^attack\b/.test(rest)) return [{ op: "forbid", what: "attack", until, target }];
  if (/^be attacked\b/.test(rest)) return [{ op: "forbid", what: "beAttacked", until, target }];
  if (/^block\b/.test(rest)) return [{ op: "forbid", what: "block", until, target }];
  if (/^(?:switch|be switched)\b.*\bactive mode\b/.test(rest)) return [{ op: "forbid", what: "switchToActive", until, target }];
  if (/^be ko'?d\b/.test(rest)) {
    // "by skills" is the narrow rule; a bare "can't be KO'd" covers the battle too.
    const bySkill = /\bby (?:your opponent's |your )?skills?\b/.test(rest);
    return [{ op: "forbid", what: bySkill ? "beKOdBySkill" : "beKOd", until, target, side: bySide }];
  }
  if (/^be chosen\b/.test(rest)) return [{ op: "forbid", what: "beChosen", until, target, side: bySide }];
  // "Can't be removed from a Battle Area by your opponent's skills" (20-14) —
  // a move by a skill, which is not the same as a KO and not the same as a
  // battle. Only the form that names skills as the cause is read: a bare
  // "can't be removed from a Battle Area" would also cover the KO.
  if (/^be removed from (?:a|the|your|their) battle area\b/.test(rest) && /\bby (?:your opponent's |your )?skills?\b/.test(rest)) {
    return [{ op: "forbid", what: "beMovedBySkill", until, target, side: bySide }];
  }
  // "This card's skills can't be negated in any area" (9-1-5). `durationOf`
  // already reads "in any area" as the game.
  if (/^be negated\b/.test(rest) && /\bskills?\b/.test(subject)) {
    const owner = refFor(subject.replace(/'?s skills?\b.*$/, ""), c);
    return owner ? [{ op: "forbid", what: "beNegated", until, target: owner }] : null;
  }
  return null;
}

function compileToken(clause: string, c: Ctx): Op[] | null {
  const m = /play (?:up to )?(\d+) (.+?) tokens?/i.exec(clause);
  if (!m) return null;
  // The reminder text states the token's stats, and they were read as one
  // triad — power, then combo cost, then combo power. A reminder that gives
  // only the power failed the whole match, and the token was then built with a
  // **hard-coded 5000**: a Ghost Token printed at 15000 arrived at 5000, and
  // Chilled's Army, Frieza's Army, Clone and Shadow Tokens printed at 10000 all
  // did the same, across some twenty-five skills. The power is read on its own,
  // and the combo pair after it, so a reminder that stops early costs only what
  // it did not say. The remaining fallbacks are the rules' own defaults, not a
  // guess: a token that never combos has no combo cost to state.
  // Anchored on "Tokens have", not on the first number in the text: the skill
  // above the reminder says things like "this card gets +10000 power for the
  // turn", and a bare power pattern took that instead — which would have given
  // the Demon Realm Soldier Token 10000 when its reminder plainly says 5000.
  const num = (x: string) => Number(x.replace(/,/g, ""));
  //
  // The sets print the reminder two ways and both have to be read, or the one
  // that is missed falls back to the default and loses the printed figure:
  // "(Ghost Tokens **have** 15000 power)" and, inline after the name, "play 1
  // Earthling Token **(1000 power**, 0 combo cost, 0 combo power)".
  const said = /(?:tokens? have|\()\s*([\d,]+) power(?:[^.)]*?([\d,]+) combo cost)?(?:[^.)]*?([\d,]+) combo power)?/i.exec(c.raw);
  const power = said ? [said[0], said[1]] : null;
  const combo = said?.[2] != null && said[3] != null ? [said[0], said[2], said[3]] : null;
  return [
    {
      op: "token",
      name: `${m[2].trim()} Token`,
      power: power ? num(power[1]) : 5000,
      comboCost: combo ? num(combo[1]) : 0,
      comboPower: combo ? num(combo[2]) : 5000,
      colors: [],
      n: Number(m[1]),
    },
  ];
}

// ── skills and cards ───────────────────────────────────────────────────────

/**
 * Compile one skill's effect. Keyword skills are rules rather than text, so
 * they compile to an empty program and the engine applies them directly.
 */
/**
 * Keyword skills whose text after the colon is a *condition* the engine reads
 * for itself, not an effect to compile — "[Evolve] {2}: <Nail>" names the card
 * you evolve from, and `engine.ts` already handles the whole line. Compiling
 * it would report a card as unreadable that the engine plays perfectly well.
 *
 * [Awaken] and [Wish] are deliberately absent: their text after the colon is a
 * real effect, and the engine does need it compiled.
 */
const KEYWORD_HANDLES_THE_LINE = new Set<KeywordSkill["name"]>(["Evolve", "Union", "Over Realm", "Swap", "Overlord", "Z-Awaken", "Z-Stack", "Field", "Attack", "Revenge", "Offering"]);

/**
 * "Choose one— ・A ・B" (20-2). The options are printed on their own lines and
 * `skillLines` has already folded them back onto the line that introduces
 * them, so here they are separated by bullets in one string.
 */
function splitModal(text: string): { head: string; options: string[] } | null {
  // Some sets print the full-width hyphen-minus after "choose one". Left out
  // of this class it is not consumed, and the text before the first bullet
  // becomes an option of its own — a dash, which compiles to nothing.
  const m = /choose one\s*(?:[-–—―－ー?:]{1,2})?\s*/i.exec(text);
  if (!m) return null;
  const options = text
    .slice(m.index + m[0].length)
    .split(/[・･·•‧]\s*/)
    .map((o) => o.trim())
    .filter(Boolean);
  if (options.length < 2) return null;
  return { head: text.slice(0, m.index).trim(), options };
}

export function compileSkill(skill: Skill): Script {
  const sc = compileSkillText(skill);
  // A [Permanent] never resolves, so "for the turn" — the duration every
  // clause gets when it names none — was a lie on every op it emitted. The
  // static layer ignores `until`, so nothing played wrongly; but the stored
  // program, the inspector and the referee's worked examples all said it.
  // The skill holds while its card is where it is valid (9-5-1), and `game`
  // is the nearest thing the language has to that.
  return skill.kind === "permanent" ? { ...sc, ops: holdForGame(sc.ops) } : sc;
}

function holdForGame(ops: Op[]): Op[] {
  return ops.map((o) => {
    if (o.op === "if") return { ...o, then: holdForGame(o.then), ...(o.else ? { else: holdForGame(o.else) } : {}) };
    if (o.op === "chooseMode") return { ...o, modes: o.modes.map((m) => ({ ...m, ops: holdForGame(m.ops) })) };
    if ("until" in o && o.until !== undefined && o.op !== "negateOwnSkill") return { ...o, until: "game" as const };
    return o;
  });
}

function compileSkillText(skill: Skill): Script {
  // [Union-Fusion] and [Union-Potara] print two character names where an
  // effect would go, and the engine reads those itself. [Union-Absorb] is
  // different (22-13-6-1): its line really is "cost : effect", and the effect
  // is what says which card is played onto this one.
  // A line may carry more than one tag — "[Blocker][Evolve]{r}{r}: <Pan>" —
  // and the one that owns the text is not always the one `parseSkills` picked
  // as *the* keyword. Reading the whole line's tags stops the Evolve's target
  // ("<Pan>.") being compiled as if it were an effect.
  const owners = [skill.keyword, ...skill.tags.map(keywordOf)].filter((k): k is KeywordSkill => !!k);
  const keywordOwnsIt = owners.some((k) => KEYWORD_HANDLES_THE_LINE.has(k.name) && !(k.name === "Union" && k.variant === "Absorb"));
  if (keywordOwnsIt) return { ops: [], unsupported: [] };
  // A trigger printed at the end of the sentence rather than at its head
  // (BT3-103) has already happened by the time the effect resolves, exactly
  // like the leading form the clause loop drops below. Left in the text it
  // compiles to a delay instead, and the skill then waits for the *next* end
  // of a battle — one battle too late, every time.
  const trailing = trailingTrigger(skill);
  const text = stripNotes(trailing ? withoutTrailingTrigger(skill.effect, trailing) : skill.effect);
  if (!text) return { ops: [], unsupported: [] };
  const unsupported: string[] = [];
  const c: Ctx = {
    permanent: skill.kind === "permanent",
    last: null,
    choices: [],
    lastSeen: null,
    lastNamed: null,
    mills: 0,
    costs: 0,
    lastPlayed: null,
    lastTarget: null,
    stale: null,
    twoNamedCardsRefused: false,
    lastOp: null,
    replacing: null,
    n: 0,
    raw: skill.effect,
  };
  // A standing permission is one sentence, not a list of actions: "you can
  // activate this card's [Counter] skill from your hand without paying its
  // energy cost **by choosing 1 other black card in your hand and placing it
  // in your Drop Area**". Splitting it first hands the price's second half to
  // the clause list as an orphan, so the whole sentence is read before that.
  //
  // Ten of the eleven cards that print such a price open with a condition of
  // their own — "**If all of your energy is mono-red,** you can activate this
  // card's [Counter] skill from your hand without paying its energy cost by
  // choosing 2 other cards in your hand **and discarding them**" — and this
  // read only stripped "you can". So it never fired for any of them, the
  // sentence went to the clause list after all, and the half of the price
  // after the "and" was orphaned exactly as the comment above says it must not
  // be: the [Counter] was offered for a choice that cost nothing. The
  // condition comes off first and goes back on around the permission, the way
  // the two-sentence form below already does it.
  const said = text.toLowerCase().trim();
  const opener = /^if (.+?),\s*(?=you (?:can|may)\s)/.exec(said);
  const permission = counterAltCost(said.slice(opener?.[0].length ?? 0).replace(/^you (?:can|may)\s+/, ""), c);
  // Only a *program* price needs the opener taken off. A waiver and a price
    // out of your life are each said in one clause, so the clause list reads
    // them and their conditions exactly as it always did — and it reads some
    // of those conditions better than this does. BT19-092's "if your Leader is
    // a green <Gogeta: Br> card **and** at least 1 <Son Goku: Br> card and 1
    // <Vegeta: Br> card are in your Z-Energy" defeats `allConditions`, which
    // falls back to reading the whole as one condition and gets a Leader
    // answering to three names with nothing asked of the Z-Energy — wider than
    // the card, where the clause list was merely narrower.
  if (permission && (!opener || permission.some((o) => o.op === "altCost" && o.pay === "program"))) {
    if (!opener) return { ops: permission, unsupported: [] };
    // Read through `allConditions`, never `parseConditionClause`: these
    // openers state two and three requirements at once — "if your Leader is a
    // yellow <Son Gohan: Youth> card, your life is at 4 or less, **and** you
    // have a yellow ≪Great Ape≫ <Son Gohan: Youth> card in play" — and a
    // single-condition read keeps the first and the last and drops what is
    // between them. Each one is its own `if`, which is what the clause list
    // already made of these sentences before this read existed.
    //
    // A condition that cannot be read must refuse the permission rather than
    // come off in front of it: a price waived on fewer terms than the card
    // states is a wider offer than the card makes (ground rule 5).
    const conds = allConditions(opener[1]);
    if (!conds) return { ops: [], unsupported: [opener[1]] };
    return { ops: conds.reduceRight<Op[]>((then, { cond }) => [{ op: "if", cond, then }], permission), unsupported: [] };
  }
  // The same offer told over two sentences (BT4-070, BT4-097): the price
  // first, as something you may do at the moment the [Counter] is activated,
  // and the waiver second, hanging on "if you do so". Read clause by clause it
  // becomes a choice out of your life and then a *play* of this card, which is
  // not what any of it says — so the pair is matched whole, ahead of the split.
  const overTwo =
    /when you activate this card's \[counter[^\]]*\](?: skill)?,\s*you may (?:choose|add) (a|an|\d+) cards? (?:in|from) your life(?: and add (?:it|them) to your hand)?\.?\s*if you do(?: so)?,\s*you may activate this card's \[counter[^\]]*\](?: skill)? without paying (?:its|the) energy cost/i.exec(
      text,
    );
  if (overTwo) {
    const alt: Op[] = [{ op: "altCost", pay: "life", n: countWord(overTwo[1]) }];
    // "If your Leader Card is ≪Goku's Lineage≫, when you activate…": the
    // permission only stands while the condition does.
    const lead = /^if (.+?),\s*when you activate/i.exec(text);
    const cond = lead ? parseConditionClause(`if ${lead[1]}`, true) : null;
    if (lead && !cond) return { ops: [], unsupported: [lead[1]] };
    return { ops: cond ? [{ op: "if", cond: cond.cond, then: alt }] : alt, unsupported: [] };
  }
  // "Choose 1 {Tree of Might} … and place this card under the chosen card:
  // **Add a marker to the chosen card**" — the effect points back at what the
  // price chose. The price is its own program, and the engine hands its
  // variables on (4-3-3), so the compiler only has to know the name.
  const priceOps = compileCostProgram(skill)?.ops ?? [];
  for (const o of priceOps) {
    if (o.op !== "choose") continue;
    c.last = o.as;
    c.lastTarget = { var: o.as };
  }
  const modal = splitModal(text);
  const clauses = splitClauses(modal ? modal.head : text);
  // [Awaken] and [Wish] check their own condition in the engine before the
  // skill is offered (22-2, 22-20), and the engine flips the Leader after the
  // effects resolve (22-2-4), so "flip this card over" in their text is not an
  // effect. On any other skill it is (a Leader's [Auto] that awakens it).
  const engineChecks = skill.keyword?.name === "Awaken" || skill.keyword?.name === "Wish";
  if (engineChecks) for (let i = clauses.length - 1; i >= 0; i--) if (/^(?:then )?flip (?:this card|it) (?:over|onto its back)[.]?$/i.test(clauses[i].trim())) clauses.splice(i, 1);
  // An [Auto] skill restates its own trigger ("When this card attacks, draw 1
  // card"); by the time the effect resolves the trigger has already fired, so
  // that clause is dropped. A leading "if …" is a condition, not a trigger, and
  // stays — it must compile or the skill goes to the referee.
  let triggerCond: Cond | null = null;
  if (skill.kind === "auto" && (clauses.length > 1 || modal) && /^(?:when|at the (?:end|beginning|start))\b/i.test(clauses[0] ?? "")) {
    const trigger = clauses.shift()!;
    // The dropped trigger is still what the sentence is about: "When this card
    // is sent to the Warp …, add **it** to your hand" means this card. Without
    // this, the first "it" of an [Auto] has nothing to point at and the whole
    // skill goes to the referee.
    if (/\bthis card\b/i.test(trigger)) c.lastTarget = { sel: { special: "self" } };
    // "When your green ≪Turtle School≫ card with an energy cost of 5 or less
    // attacks a Battle Card, **it** gets +10000 power for the turn" — a
    // trigger about some *other* card, which the engine already binds as the
    // trigger's subject. Without this, "it" had nothing to point at.
    else if (/\byour\b|\byour opponent'?s\b/i.test(trigger)) {
      c.lastTarget = { sel: { special: "subject" } };
      // The dropped clause also said *which* card, and dropping it dropped
      // that: "when your opponent plays a **Battle Card**" fired when they
      // played an Extra, and "when your **≪Saiyan≫** card attacks" fired for
      // anything of theirs that attacked. The engine binds the card as the
      // trigger's subject, so what the clause said about it becomes a
      // condition on that subject and the skill stays where it was printed.
      const subject = subjectFilterOf(trigger);
      if (subject) triggerCond = { kind: "count", sel: { special: "subject", filter: subject }, atLeast: 1 };
    }
    // "When this card attacks and KOs an opponent's Battle Card", "when this
    // card is revealed from the top of your deck and placed in your Drop Area"
    // — the trigger splits on its "and", and the second half is still the
    // trigger rather than the first thing the skill does.
    while (clauses.length > 1 && /^(?:kos?|ko's|is ko'?d|deals damage|(?:is )?placed in|(?:is )?revealed|(?:is )?sent to|(?:is )?returned to|(?:is )?switched to)\b/i.test(clauses[0].trim()))
      clauses.shift();
    // "When you play this card and your Leader Card is a ≪Universe 6≫ card,
    // …" — a condition riding on the trigger, split off the same way (9-1-3).
    // A clause with its own "if" is a condition in the ordinary chain; only a
    // bare one rode in on the trigger.
    if (clauses.length > 1 && !/^(?:if|when|while|during)\b/i.test(clauses[0].trim())) {
      const riding = parseConditionClause(clauses[0], true);
      if (riding) {
        triggerCond = riding.cond;
        clauses.shift();
      }
    }
  }

  const unsupportedBeforeHead = unsupported.length;
  let ops = compileClauseList(clauses, c, unsupported);
  // Whether the head itself read clean, before the modal's own options add
  // any refusals of their own — an option's unread clause must not stop the
  // head's condition from being restored below.
  const headReadClean = unsupported.length === unsupportedBeforeHead;
  if (modal) {
    // Each option is compiled on its own, carrying what the head established
    // ("If your Leader is a <Baby> card, it gets +10000 power, then choose
    // one— ・…" — "it" still means the leader inside the options).
    const modes = modal.options.map((option) => ({ label: option, ops: compileClauseList(splitClauses(option), { ...c }, unsupported) }));
    // An option the compiler could not read is an empty branch, and the menu
    // then offers a mode that silently does nothing — the player picks it and
    // the game moves on (P-396). A mode is only a choice if every option on
    // the menu is one, so a single empty branch fails the whole skill and the
    // referee is asked the question the card actually printed.
    if (modes.some((mode) => !mode.ops.length)) {
      // Its own clauses are already in `unsupported` — unless the option was
      // read away to nothing without refusing anything, and then the option
      // itself is what could not be said, or the skill would come back empty
      // and be counted as fully compiled.
      const silent = modal.options.filter((_, i) => !modes[i].ops.length);
      return { ops: [], unsupported: unsupported.length ? unsupported : silent };
    }
    if (modes.some((mode) => mode.ops.length)) ops.push({ op: "chooseMode", modes });
    // "If your Leader Card is a green <Cheelai: Br> card or yellow <Broly:
    // Br> card, choose one— ・…" (EX19-13, TB3-066): the head is nothing but
    // the condition that gates the whole menu, with no effect of its own for
    // it to attach to before the bullets — and `compileClauseList`'s own
    // flush drops a condition group whose body came back empty
    // (`if (!g.ops.length) continue`), exactly the case a bare head leaves
    // behind. `parseConditionClause` already reads the head fine, which is
    // how it was ever split off as the modal's head at all; the read is
    // simply thrown away one step later. Read again here and used to wrap
    // the menu — but only when nothing in the head actually failed, so a
    // head that could not be read in full still refuses instead of
    // silently gaining a condition weaker than what it printed.
    if (ops.length && !ops.some((o) => o.op === "if") && clauses.length && headReadClean) {
      const read = allConditions(clauses.join(" and "));
      if (read) ops = [{ op: "if", cond: read.length > 1 ? { kind: "all", conds: read.map((r) => r.cond) } : read[0].cond, then: ops }];
    }
  }
  // "[Auto] If your Leader Card is red: When you play this card, draw 1 card"
  // — a condition written before the colon is part of the skill's validity
  // (9-1-3), and it lands in `cost`. It wraps the whole program; one the
  // compiler cannot read fails the skill rather than running it unconditionally.
  const priced = costText(skill.cost);
  const priceCond = ops.length && !engineChecks ? priceCondition(skill) : null;
  if (priceCond) return { ops: [{ op: "if", cond: priceCond.cond, then: ops }], unsupported };
  // A condition the compiler cannot read fails the skill. An *action* price is
  // not this: the engine charges that separately, so it leaves the program be.
  if (ops.length && !engineChecks && /^(?:if|when|while|during)\b/i.test(priced)) {
    return { ops: [], unsupported: [skill.cost, ...unsupported] };
  }
  if (ops.length && triggerCond) return { ops: [{ op: "if", cond: triggerCond, then: ops }], unsupported };
  return { ops, unsupported };
}

/**
 * What an op leaves behind for the clauses after it: which cards "it" means,
 * and which name a later "if that card is …" is asking about.
 */
function track(o: Op, c: Ctx): void {
  if (o.op === "choose") {
    c.last = o.as;
    c.choices.push({ var: o.as, sel: o.sel });
    c.lastTarget = { var: o.as };
  } else if (o.op === "reveal") {
    c.lastSeen = o.as;
    c.lastNamed = o.as;
    c.lastTarget = { var: o.as };
  } else if (o.op === "look") {
    c.lastSeen = o.as;
    c.lastNamed = o.as;
  } else if (o.op === "mill" && o.as) {
    // A card placed in the Drop from the top of the deck is turned over on the
    // way, so "if that card is red" means it just as much as a card a reveal
    // turned up. `lastNamed` only: not `lastSeen`, because those cards are in
    // the Drop rather than held out to be picked from, and not `lastTarget`,
    // because the sentence is asking *about* the card — reading "it" in a
    // later clause as the milled card would move a card nothing named.
    c.lastNamed = o.as;
  } else if ("target" in o && o.target) c.lastTarget = o.target;
}

/** A clause that is nothing but a duration, split off from the effect it belongs to. */
const PURE_DURATION =
  /^(?:during this turn|for the (?:duration of the )?(?:turn|battle)|for the rest of the turn|until the end of (?:your|your opponent's|the)(?: next)? turn|until the (?:start|beginning) of your (?:next )?turn|until the (?:start|beginning) of your opponent's next turn)[.,]?$/i;

/**
 * A clause that is nothing but "for each marker on this card", split off from
 * the effect it multiplies (BT27-003/004/005/006, EX19-21). Scoped to "this
 * card" alone, not to a marker phrase in general: the catalog's other three
 * "for each marker on …" cards (BT15-095, BT24-139, BT28-054) reduce a cost
 * rather than a power, which `compileForEach` does not swap an amount into
 * today, so merging their clause the same way would only change which text
 * shows up unread, not whether it reads — left split, as before.
 */
const PURE_FOREACH_MARKERS_ON_SELF = /^for (?:each|every) markers? on this card[.,]?$/i;

/** The clause loop, shared by a skill's body and by each modal option. */
function compileClauseList(clauses: string[], c: Ctx, unsupported: string[]): Op[] {
  // "if you do" (20-16) makes the rest conditional on the previous choice, and
  // a run of conditions all have to hold, so a group carries a list of them.
  type Group = {
    conds: Cond[];
    ops: Op[];
    delay?: { at: DelayTiming; scope: DelayScope; label: string };
    /**
     * Where the next clause is written, when it is not the group's own list:
     * an `if` a clause built for itself that the clauses after it belong
     * inside. `sinkCond` is what that branch asks, for an “otherwise”.
     */
    sink?: Op[];
    sinkCond?: Cond;
  };
  const groups: Group[] = [{ conds: [], ops: [] }];
  /**
   * A clause the compiler cannot read. Everything the sentence said about it
   * is gone with it, so the antecedent standing at that moment is marked: the
   * clauses after it may still be talking about what this one named, and a
   * pronoun that resolves to the seeded self is then pointing at the hole
   * rather than at the card printing the skill.
   */
  const refuse = (text: string) => {
    unsupported.push(text);
    c.stale = c.lastTarget;
    // See `c.twoNamedCardsRefused` and the `refFor` check it feeds: a refused
    // two-named-card search is the one case where a stale target that is not
    // `self` must still block the pronoun after it.
    if (TWO_NAMED_CARDS.test(text)) c.twoNamedCardsRefused = true;
  };
  const push = (ops: Op[]) => {
    const g = groups[groups.length - 1];
    (g.sink ?? g.ops).push(...ops);
  };
  for (let i = 0; i < clauses.length; i++) {
    const clause = clauses[i];
    // "During this turn, your opponent can't…", "…, until the end of your
    // opponent's turn, it can't attack" — a duration split off on its own
    // belongs to the clause after it, where `durationOf` will find it.
    if (PURE_DURATION.test(clause.trim()) && i + 1 < clauses.length) {
      clauses[i + 1] = `${clauses[i + 1].replace(/[.]$/, "")} ${clause.trim()}`;
      continue;
    }
    // "For each marker on this card, this card gets +5000 power during your
    // turn" — the reverse of a duration: the count leads the effect it
    // multiplies rather than trailing it, so it is reattached in front, not
    // behind, and `compileForEach` reads it out of the merged clause.
    if (PURE_FOREACH_MARKERS_ON_SELF.test(clause.trim()) && i + 1 < clauses.length) {
      clauses[i + 1] = `${clause.trim().replace(/[.,]$/, "")}, ${clauses[i + 1]}`;
      continue;
    }
    // "Otherwise, draw 1 card" — the else of the condition just before it,
    // printed without a break. Split so the two halves read as themselves.
    const inlineOtherwise = /^otherwise[\s,]+(.+)$/i.exec(clause.trim());
    if (inlineOtherwise) {
      clauses.splice(i, 1, "otherwise", inlineOtherwise[1]);
      i--;
      continue;
    }
    const conn = connective(clause);
    if (conn === "skip") continue;
    if (conn === "otherwise") {
      // 20-16: the opposite of what the group before it asked. With no
      // condition to be the opposite of there is nothing to say.
      const prev = groups[groups.length - 1];
      if (!prev.conds.length) {
        refuse(clause);
        continue;
      }
      // A branch the group is writing into is part of what was asked.
      const all = prev.sinkCond ? [...prev.conds, prev.sinkCond] : prev.conds;
      const asked: Cond = all.length === 1 ? all[0] : { kind: "all", conds: [...all] };
      groups.push({ conds: [{ kind: "not", cond: asked }], ops: [] });
      continue;
    }
    // 20-16: "if you do" / "if you don't" point at the decision just before
    // them — an offer the player accepted ("you may draw 1 card") or a choice
    // they made. The offer is the commoner of the two and had nothing to read
    // until `may` existed, so "if you don't" was simply a gap.
    const decided: Cond | null = c.lastOp === "may" ? { kind: "did", what: "may" } : c.last ? { kind: "chose", var: c.last } : null;
    if (conn === "ifDone") {
      // "You may place 1 card from your hand in the Drop Area. **If you do so,**
      // draw 1 card": the clause before it already hung its own half of the
      // bargain on that very decision, so this is that branch continuing rather
      // than a second, identical one. What follows is written into that branch
      // rather than into a group of its own, so it keeps the conditions — and
      // the timing — the branch is already standing under.
      const open = groups[groups.length - 1];
      let host = open.sink ?? open.ops;
      let last = host[host.length - 1];
      // "…place 1 card from your hand in the Drop Area **at the end of the
      // battle**. If you do so, switch this card to Active Mode" (BT3-103): a
      // trailing timing phrase put the price inside a delay, and what hangs on
      // it happens there too. Asked out here it would read a name the delayed
      // program has not bound yet, so it never held and the card's second half
      // never happened.
      if (last?.op === "delay") {
        host = last.ops;
        last = host[host.length - 1];
      }
      if (decided?.kind === "chose" && last?.op === "if" && !last.else && last.cond.kind === "chose" && last.cond.var === decided.var) {
        open.sink = last.then;
        open.sinkCond = last.cond;
        continue;
      }
      // Nothing before it made a decision — usually because the clause that
      // would have made one went unread — so what "if you do" asks cannot be
      // stated.
      // Dropping the connective alone does not leave the rest free to happen:
      // it makes them happen unconditionally, which is what EX24-32 was
      // doing, placing cards whether or not the play it hangs on occurred.
      // The rest of the sentence goes with the word that governs it.
      if (!decided) {
        for (const rest of clauses.slice(i)) refuse(rest);
        break;
      }
      groups.push({ conds: [decided], ops: [] });
      continue;
    }
    if (conn === "ifNotDone") {
      // With nothing before it to be the opposite of, this is a gap rather
      // than an always-true condition — and, as above, the clauses hanging on
      // it are not free to happen without it.
      if (!decided) {
        for (const rest of clauses.slice(i)) refuse(rest);
        break;
      }
      groups.push({ conds: [{ kind: "not", cond: decided }], ops: [] });
      continue;
    }
    // "ignoring [Barrier]" lifts 22-16 for the choice just made (22-16, 20-4).
    if (/^ignoring \[barrier\]$/i.test(clause.trim())) {
      const lastChoose = [...groups.flatMap((g) => g.ops)].reverse().find((o) => o.op === "choose");
      if (lastChoose && lastChoose.op === "choose") lastChoose.sel.ignoreBarrier = true;
      continue;
    }
    // 9-10: "If this card would leave the Battle Area" is not a condition —
    // nothing has happened yet. It says the *next* clause replaces the
    // departure, so it is remembered rather than compiled.
    const would = parseWouldLeave(clause);
    if (would) {
      c.replacing = would;
      // "…it goes to the Warp instead" — "it" is the card the phrase named.
      c.lastTarget = { sel: { special: "self" } };
      continue;
    }

    // A timing phrase opens a group too, and everything after it happens then
    // rather than now. A condition already in front of it still applies, and
    // is checked when the skill resolves, not when the delayed part fires.
    const delay = parseDelayClause(clause);
    if (delay) {
      const open = groups[groups.length - 1];
      const inherited = open.ops.length === 0 ? open.conds : [];
      groups.push({ conds: [...inherited], ops: [], delay: { at: delay.at, scope: delay.scope, label: delay.label } });
      // "At the end of the turn KO this card" arrives as one clause when the
      // printed text has no comma; the remainder is the delayed effect itself.
      if (delay.rest) {
        const got = compileClause(delay.rest, c);
        if (got) groups[groups.length - 1].ops.push(...got);
        else refuse(delay.rest);
      }
      continue;
    }

    // "Flip this card over at the end of the turn" — the same thing said the
    // other way round. Only the head is an effect; the tail says when.
    const trailing = parseTrailingDelay(clause);
    if (trailing) {
      if (connective(trailing.head) === "skip") continue;
      const got = compileClause(trailing.head, c);
      if (got) {
        for (const o of got) track(o, c);
        push([{ op: "delay", at: trailing.at, scope: trailing.scope, ops: got, label: trailing.label }]);
        continue;
      }
      refuse(clause);
      continue;
    }

    // "If that card is a Battle Card" — what the reveal or the look just
    // turned up. The name only exists here, so the condition is built with
    // the compiler's own bookkeeping rather than by `parseConditionClause`.
    if (c.lastNamed || c.last) {
      // "If **it's** a Battle Card" is the same sentence contracted, which the
      // reveal wordings print as often as the long form.
      const seen = /^(?:if|when) (?:that card|it|it'?s|the (revealed|chosen) card) (?:is )?(?:an? )?(.+)$/i.exec(clause.trim().replace(/[.,]$/, ""));
      // "The chosen card" is the choice; "that card" is whatever was last
      // turned up, and only falls back to the choice when nothing was.
      const v = seen?.[1]?.toLowerCase() === "chosen" ? c.last : (c.lastNamed ?? c.last);
      // "If that card is **not** a <Son Gohan: Childhood>" (BT21-148).
      // `parseFilter` carries some negations and silently drops others: it
      // reads "non-red" and "other than {King Cold, Imminent Invasion}", but
      // takes "not a <Son Gohan: Childhood>", "not red" and "not a Battle
      // Card" as the plain description with a word in front of it. Dropped,
      // the condition holds for exactly the card the sentence excludes — so
      // what is checked is the filter rather than the wording: a description
      // that negates something must come back with a negative measure on it,
      // or the clause goes to the referee. An unread clause costs tokens; a
      // backwards one loses the game.
      const read = seen ? filterFor(seen[2], null) : undefined;
      const negates = seen ? /\b(?:not|non|other than|except|besides)\b/i.test(seen[2]) : false;
      const carriesNegative = read
        ? read.notColors.length > 0 || read.notCharacters.length > 0 || read.notTraits.length > 0 || read.notNames.length > 0 || read.notKeywords.length > 0 || read.notType != null || read.notToken
        : false;
      const filter = negates && !carriesNegative ? undefined : read;
      if (seen && filter && v) {
        groups.push({ conds: [{ kind: "varMatches", var: v, filter }], ops: [] });
        c.lastTarget = { var: v };
        continue;
      }
    }

    // "If you use this skill to play a Battle Card with [Over Realm]"
    // (BT3-121) — what the play earlier in this same skill turned out to be.
    // Only the card this skill played counts, so it is the play's own variable
    // rather than anything the board holds.
    // Several play patterns name their own variable; "…and play it" is the
    // choice just before it, and that is only the played card when the clause
    // before this one was in fact the play.
    const played = c.lastPlayed ?? (c.lastOp === "play" ? c.last : null);
    if (played) {
      const used = /^(?:if )?you (?:use|used) this skill to play (.+)$/i.exec(clause.trim().replace(/[.,]$/, ""));
      const filter = used ? filterFor(used[1], null) : undefined;
      if (used && filter) {
        groups.push({ conds: [{ kind: "varMatches", var: played, filter }], ops: [] });
        c.lastTarget = { var: played };
        continue;
      }
    }

    // A condition opens a group: everything after it depends on it holding.
    // A second condition with nothing between them joins the same group, so
    // both have to hold rather than the first being quietly dropped.
    const open = groups[groups.length - 1];
    const chaining = open.ops.length === 0 && open.conds.length > 0;
    const cond = parseConditionClause(clause, chaining);
    if (cond) {
      if (chaining) open.conds.push(cond.cond);
      else groups.push({ conds: [cond.cond], ops: [] });
      if (cond.subject) c.lastTarget = cond.subject;
      continue;
    }
    // "Instead" is the word every replacement ends on, and it broke the anchor
    // of every move pattern but one — "send it to the Warp instead" was
    // unreadable while "send it to the Warp" was not. It says nothing the
    // pending `c.replacing` has not already said, so it comes off first.
    // "…**they instead** choose 2 cards in their hand" (EX03-16): the adverb
    // restating that this is the other branch of the "if they don't" before
    // it. A replacement's "instead" is at the *end* of its clause (9-10); one
    // at the front is emphasis only, and it stopped every pattern below from
    // recognising an otherwise ordinary sentence.
    const plain = clause.replace(/^((?:your opponent|they|you)\s+)?instead[,\s]+/i, "$1");
    const said = c.replacing ? plain.replace(/[\s,]+instead[.\s]*$/i, "") : plain;
    // 20-16: "your opponent **may** choose 1 of their Battle Cards and KO it"
    // — the offer is theirs to decline, and the "if they don't" after it reads
    // their answer. `compileClause` strips "you may" so every pattern sees a
    // bare instruction; this strips the other subject and remembers whose
    // decision it was, which is the whole difference between the two.
    const theirOffer = /^(?:your opponent|they) may\s+\S/i.test(said.trim());
    let got = compileClause(theirOffer ? said.trim().replace(/^(?:your opponent|they) may\s+/i, "") : said, c);
    // 20-16: "you may …" is the player's decision. `compileClause` strips the
    // words so that every pattern below sees a bare instruction, which meant
    // 787 compiled skills carried out an optional effect without asking. The
    // clause is read as usual and then wrapped in the offer.
    // "You can only play mono-yellow ≪Saiyan≫ cards" is a prohibition rather
    // than an offer, and is read by `compileProhibition`.
    const offered = /^(?:you may|you can(?! only)|the player may)\s+\S/i.test(said.trim());
    const optional = !c.permanent && offered;
    // Only as a fallback: several patterns read the subject themselves and say
    // it better than this can — "your opponent sends 1 card from their hand to
    // their Warp" is a discard (20-7), chosen by its owner because it is a
    // hand card, not a move of a named one.
    let opponentDoes = false;
    if (!got && OPPONENT_POSSESSIVE.test(said) && OPPONENT_DOES.test(said.trim())) {
      got = compileClause(
        said.trim().replace(OPPONENT_DOES, (_, v: string) => `${THIRD_PERSON[v.toLowerCase()] ?? v.toLowerCase()} `),
        c,
      );
      opponentDoes = !!got;
    }
    // "For each green Unison Card in your Drop, reduce the Z-Energy cost of
    // this card in your Z-Deck by 1. (Up to 2)" (P-464): a per-card count and
    // a stacking cap, and this clause carries neither by the time it reaches
    // here. The count is the clause right before this one — "for each …" has
    // no verb of its own, so it never became anything and is already
    // refused. The cap is gone earlier still: `stripNotes` reads the
    // parenthetical as a reminder (1-5-8) and drops it before `splitClauses`
    // ever runs, and this one is not a reminder. Compiling "reduce … by 1"
    // alone would apply the reduction flatly, unconditionally and without a
    // ceiling — none of which the card says — so it is refused here instead.
    if (i > 0 && /^for (?:each|every)\b/i.test(clauses[i - 1].trim()) && got?.some((o) => o.op === "costReduction" && o.what === "zEnergy")) {
      got = null;
    }
    // The same cap, on the chance it ever survives `stripNotes` as a clause
    // of its own rather than being swallowed by the parenthesis check above —
    // belt and braces, not reached by any card in the catalog today.
    if (got && i + 1 < clauses.length && /^\(up to \d+\)\.?$/i.test(clauses[i + 1].trim()) && got.some((o) => o.op === "costReduction")) {
      got = null;
    }
    if (!got) {
      if (c.replacing) c.replacing = null;
      refuse(clause);
      // A clause that opens with "if" is a condition whether or not this
      // compiler can read it, and everything after it hangs on it. Refused
      // alone, the clauses it governs became a skill that happens *always* —
      // 56 of them: BT2-018 played itself from hand for nothing whether or not
      // <Son Gohan: Adolescence> was anywhere, BT15-075 granted [Blocker] with
      // no [Field] Extra Card in play, and a dozen cost reductions were simply
      // always on. The rest of the sentence goes with the word that governs
      // it, the same as "if you do" above and for the same reason.
      //
      // Reached only once every pattern has refused the clause, so a
      // condition one of them *can* read is unaffected — and only for the
      // conditional openers: "if this card would leave the Battle Area" (9-10)
      // is a replacement, not a condition, and has already been taken above.
      if (/^\s*(?:if|while|as long as|unless)\b/i.test(clause)) {
        for (const rest of clauses.slice(i + 1)) refuse(rest);
        break;
      }
      continue;
    }
    // 9-10: the clause after "if this card would leave the Battle Area" is
    // where it goes instead, so it is a replacement rather than a move.
    if (c.replacing) {
      const only = got.length === 1 ? got[0] : null;
      const { by, subject } = c.replacing;
      c.replacing = null;
      if (only && only.op === "moveTo" && only.to !== "under" && only.to !== "play" && !only.under) {
        // When the rule names other cards, they are the ones it is about —
        // not whatever "it" happened to point at in the second half.
        const filter = subject ? filterFor(subject, "battle") : undefined;
        if (filter === null) {
          refuse(clause);
          continue;
        }
        const target: Ref = subject ? { sel: { side: "you", area: "battle", filter, count: 99 } } : only.target;
        // "…to your energy in Rest Mode instead" — the move said how it
        // arrives as well as where, and the replacement has to carry both.
        push([{ op: "replaceLeave", to: only.to, target, ...(by ? { by } : {}), ...(only.mode ? { mode: only.mode } : {}), ...(offered ? { optional: true } : {}) }]);
        continue;
      }
      // Anything else is a replacement this language cannot say yet, and
      // half of one is worse than none.
      refuse(clause);
      continue;
    }
    // Only who picks changes: the selectors already point at their cards,
    // because the sentence said "their Drop Area".
    if (opponentDoes || theirOffer) for (const o of got) if (o.op === "choose") o.chooser = "opponent";
    for (const o of got) track(o, c);
    // The offer wraps whatever the clause turned out to be. A clause whose
    // first op is *already* a declinable choice asks by itself — "you may
    // choose 1 card in your hand and discard it" is answered by taking no card
    // (5-2-4) — so wrapping it would ask twice.
    const alreadyOptional = got[0]?.op === "choose" && got[0].sel.upTo;
    const offeredClause = optional || theirOffer;
    const said2 =
      offeredClause && got.length && !alreadyOptional
        ? [
            {
              op: "may",
              ops: got,
              ...(theirOffer ? { chooser: "opponent" as const } : {}),
              reason: clause
                .trim()
                .replace(/^(?:you may|you can|the player may|your opponent may|they may)\s+/i, "")
                .replace(/[.]$/, ""),
            } as Op,
          ]
        : got;
    // What "if you do" points at is the *offer*, not the last thing inside it.
    if (said2.length) c.lastOp = said2[said2.length - 1].op;
    push(said2);
  }

  const ops: Op[] = [];
  for (const g of groups) {
    if (!g.ops.length) continue;
    // Nest the conditions outermost-first, so all of them have to hold.
    let body = g.ops;
    if (g.delay) body = [{ op: "delay", at: g.delay.at, scope: g.delay.scope, ops: body, label: g.delay.label }];
    for (const cond of [...g.conds].reverse()) body = [{ op: "if", cond, then: body }];
    ops.push(...body);
  }
  return ops;
}

const cardCache = new WeakMap<CardDef, { front: CardScripts; back: CardScripts }>();

/** `compileCard`, memoised per definition — the same card is compiled once. Off the game path: the engine reads `card_rules`; this serves the drafter, the coverage CLIs and the tests. */
export function compileCardCached(card: CardDef, side: "front" | "back" = "front"): CardScripts {
  let entry = cardCache.get(card);
  if (!entry) {
    entry = { front: compileCard(card, "front"), back: compileCard(card, "back") };
    cardCache.set(card, entry);
  }
  return side === "back" ? entry.back : entry.front;
}

export function compileCard(card: CardDef, side: "front" | "back" = "front"): CardScripts {
  const bySkill: Record<number, Script> = {};
  const unsupported: string[] = [];
  for (const sk of skillsOf(card, side)) {
    const script = compileSkill(sk);
    // The price rides with the program. This is the only place it is read for
    // a context built from card text — `rulesFor` reads the row instead — and
    // it is what keeps `npm test` and the probe playing prices at all now that
    // the engine no longer compiles one mid-game.
    bySkill[sk.index] = { ...script, price: priceFromText(sk) };
    unsupported.push(...script.unsupported);
  }
  return { bySkill, complete: unsupported.length === 0, unsupported };
}

/**
 * The two halves of a price, read together (4-3-3). Module-local on purpose:
 * outside the compiler a price comes off the record, never off the text.
 */
function priceFromText(skill: Skill): SkillPrice {
  return { condition: priceCondition(skill)?.cond ?? null, ops: compileCostProgram(skill)?.ops ?? null };
}
