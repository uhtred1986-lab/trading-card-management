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
import { keywordOf, orbsIn, skillsOf } from "./cards";
import type { Amount, Cond, Duration, Op, Ref, Script, ScriptArea, Selector, Side } from "./script";
import type { CardDef, DelayScope, DelayTiming, ForbiddenAction, KeywordSkill, Skill, SkillKindPrefix } from "./types";

// ── clause splitting ───────────────────────────────────────────────────────

/** Split on commas, semicolons, full stops and "then"/"and", ignoring anything inside brackets. */
/** After an " and ": nothing but a name, so the "and" joins names rather than clauses. */
const NAME_AFTER_AND = /^(?:<[^>]+>|≪[^≫]+≫|\{[^}]+\})(?:\s*(?:,|\.|$|cards?\b|battle cards?\b|and\b|or\b|in\b|with\b))/i;

/**
 * After an " and ": the second of two areas one phrase names — "all cards in
 * your opponent's Battle Cards and Unisons" (20-1-6). Split, the second half
 * is a bare area word, and the first half quietly narrows to one area.
 */
const AREA_AFTER_AND = /^(?:unisons?|unison cards?|unison areas?)\b/i;

/**
 * After an " and ": a second measure of the same card description, as in "with
 * an energy cost of 3 and 5000 power" (20-12 searches print both orders).
 * Only counted when the clause so far opened a description with "with", which
 * is the word that turns the rest of the phrase into a filter.
 */
const MEASURE_AFTER_AND = /^(?:an? energy cost of \d+|\d+ power)(?: or (?:less|more))?\b/i;

export function splitClauses(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  const push = (end: number, skip: number) => {
    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end + skip;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ("([{<≪".includes(ch)) depth++;
    else if (")]}>≫".includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if ((ch === "," || ch === ";") && !inNameList(text, i)) {
        push(i, 1);
      } else if (ch === "." && (i + 1 >= text.length || text[i + 1] === " ")) {
        push(i, 1);
      } else if (
        text.startsWith(" and ", i) &&
        !text.startsWith(" and [", i) &&
        !NAME_AFTER_AND.test(text.slice(i + 5)) &&
        !(MEASURE_AFTER_AND.test(text.slice(i + 5)) && /\bwith\b/i.test(text.slice(start, i))) &&
        !(AREA_AFTER_AND.test(text.slice(i + 5)) && /\bbattle cards?\b/i.test(text.slice(start, i)))
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
  return out.map((c) => c.replace(/^(?:then|and|if you do|if so)\s+/i, "").trim()).filter(Boolean);
}

/**
 * A comma inside a list of names is not a sentence break. "choose 1
 * <Son Goku: GT>, <Trunks: GT>, <Pan>, or <Giru>" is one instruction, and
 * splitting it leaves three fragments that are nothing but a name.
 */
function inNameList(text: string, comma: number): boolean {
  const before = text.slice(0, comma).trimEnd();
  const endsWithName = /[>}≫]$/.test(before);
  const after = text.slice(comma + 1).replace(/^\s*(?:or|and)\s+/i, "").trimStart();
  return endsWithName && /^[<{≪]/.test(after);
}

/**
 * Explanatory notes in parentheses are not rules text (1-5-8). Some sets print
 * the full-width brackets, and a note whose closing bracket is missing runs to
 * the end of the line — both used to leave a reminder behind as an
 * "unreadable" clause.
 */
function stripNotes(text: string): string {
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
  [/\bin (?:your|their|its owner's|an?) (?:own )?drop\b|\bdrop area\b|\bfrom your drop\b/, "drop"],
  // "Your blue energy", "your opponent's rested energy": the adjectives sit
  // between the possessive and the word, and "energy cost" is not an area.
  [/\benergy area\b|\b(?:your opponent's|their|your)(?: [a-z-]+)* energy\b(?! cost)/, "energy"],
  [/\bfrom your hand\b|\bin your hand\b|\btheir hand\b|\byour hand\b|\byour opponent's hand\b/, "hand"],
  [/\bfrom your deck\b|\bin your deck\b|\byour deck\b|\byour opponent'?s deck\b|\btheir deck\b/, "deck"],
  [/\bin your life\b|\bfrom your life\b|\byour life\b|\blife area\b/, "life"],
  [/\bwarp\b/, "warp"],
  [/\bcombo area\b/, "combo"],
  [/\bunison area\b|\bunison cards?\b|\bunisons\b/, "unison"],
  [/\bz-deck\b/, "zDeck"],
  [/\bz-energy\b/, "zEnergy"],
  [/\bunder this card\b/, "under"],
  // Naming both areas is how the text says "on the table" (20-1-6), and it
  // has to be read before either area alone — otherwise "in your Battle Area
  // or Leader Area" becomes a Battle Area holding a Leader, which is nothing.
  [/\b(?:battle|leader) area or (?:battle|leader) area\b/, "play"],
  [/\bleader cards?\b|\byour leaders?\b/, "leader"],
  [/\bbattle area\b|\bbattle cards?\b/, "battle"],
  // 20-1-6: an unqualified "cards" means the Leader Area and the Battle Area.
  [/\b(?:your|their|opponent's) (?:[a-z-]+ )*cards\b/, "play"],
];

/** "up to 2 of your opponent's Battle Cards in Rest Mode" → a selector. */
export function parseTarget(phrase: string): Selector | null {
  const t = phrase.toLowerCase();
  // "Each non-Leader card under this card" is about the stack; the "this card"
  // in it names the host, not the target. Read before the shortcut below,
  // which took the whole phrase for the card on top and counted one (23-2).
  if (/\bunder (?:this card|it)\b/.test(t) && !/^this card\b/.test(t.trim())) {
    return { side: "you", area: "under", filter: filterFor(phrase.replace(/\bunder (?:this card|it)\b/gi, ""), "under"), count: 99, upTo: false };
  }
  // "this card's power" inside a phrase is a measure, not the target.
  if (/\bthis card\b(?!'s)/.test(t) && !/\bother\b/.test(t)) return { special: "self" };
  if (/\bthe attack(?:ing)? card\b/.test(t)) return { special: "attacker" };
  if (/\bthe guard card\b/.test(t)) return { special: "guard" };
  // "1 Battle Card with an energy cost of 2 or less being played by your
  // opponent" is the card the [Counter: Play] is answering, and there is only
  // ever one of those — reading it as a choice asked for a card in play, which
  // is a different card entirely (9-6).
  if (/\bbeing played\b/.test(t)) return { special: "resolving", filter: filterFor(phrase, null) };

  let side: Side = "you";
  if (/\byour opponent'?s?\b|\btheir\b|\bthe opponent'?s\b/.test(t)) side = "opponent";
  if (/\ball players\b|\beach player\b|\bboth players\b/.test(t)) side = "both";

  // "Your opponent's Battle Cards or Unisons" names two areas at once, which
  // is the one such phrase the game prints often enough to be worth reading.
  const bothAreas = /\bbattle cards?\b[^.]*\b(?:or|and)\b[^.]*\bunisons?\b|\bunisons?\b[^.]*\b(?:or|and)\b[^.]*\bbattle cards?\b/.test(t);

  let area: ScriptArea | null = null;
  for (const [re, a] of AREA_WORDS) {
    if (re.test(t)) {
      area = a;
      break;
    }
  }
  // "among them" / "of those cards" keeps working on what was just looked at.
  const fromVar = /\bamong them\b|\bof those cards\b|\bfrom among them\b|\bof them\b/.test(t) ? "looked" : undefined;
  // "Choose 1 of your <Majin Buu>" names no area, but 20-1-6 says an
  // unqualified card is one on the table. Without this the choice fails, and
  // then every later "it" in the same skill has nothing to point at.
  if (!area && !fromVar && filterFor(phrase, null)) area = "play";
  if (!area && !fromVar) return null;

  let count = 1;
  let upTo = false;
  let m: RegExpExecArray | null;
  if ((m = /\bup to (\d+)\b/.exec(t))) {
    count = Number(m[1]);
    upTo = true;
  } else if (/\ball\b|\bevery\b|\beach\b/.test(t)) {
    count = 99;
  } else if ((m = /\b(\d+)\b/.exec(t.replace(/\d+000\b/g, "").replace(/energy cost (?:of )?\d+/g, "").replace(/\bz-\d/g, "")))) {
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

  const mode = /\bin rest mode\b/.test(t) ? "rest" : /\bin active mode\b/.test(t) ? "active" : undefined;
  const filter = filterFor(phrase, area);
  if (bothAreas) return { side, area: "battle", areas: ["battle", "unison"], filter, count, upTo, mode, fromVar };
  return { side, area: area ?? undefined, filter, count, upTo, mode, fromVar, take, fromEnd };
}

/** Only keep a filter when the phrase actually narrows the cards. */
function filterFor(phrase: string, area: ScriptArea | null): CardFilter | undefined {
  const f = parseFilter(phrase);
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
    f.colors.length > 0;
  if (!narrows) return undefined;
  return f;
}

// ── clause patterns ────────────────────────────────────────────────────────

interface Ctx {
  /** The variable the last `choose` bound. */
  last: string | null;
  /** The variable the last `look` or `reveal` bound — what "that card" means. */
  lastSeen: string | null;
  /** The variable bound by the last "play …" choice — what "the card you played with this skill" means. */
  lastPlayed: string | null;
  /**
   * What "it"/"them" points at. Card text carries the subject from clause to
   * clause — "Switch this card to Active Mode and it gets +5000 power" means
   * this card — so the last target of any clause counts, not only a choice.
   */
  lastTarget: Ref | null;
  /** The op the previous clause produced, for wordings that restate it. */
  lastOp: string | null;
  /**
   * Set by "if this card would leave the Battle Area": the *next* clause says
   * where it goes instead, so it becomes a replacement rather than a move
   * (9-10).
   */
  replacing: { by?: "skill" | "ko" | "skillOrKo"; subject?: string } | null;
  n: number;
  /** The skill text with its explanatory notes still in place. A token's stats are printed there. */
  raw: string;
}

/** "A marker", "an energy" — the article is the number one. */
const countWord = (w: string) => (/^\d+$/.test(w) ? Number(w) : 1);

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

function refFor(clause: string, c: Ctx): Ref | null {
  if (/\bthis card\b/i.test(clause)) return { sel: { special: "self" } };
  // "…play up to 1 card from under this card, and place this card under the
  // played card": the card this skill just played, if it played one; otherwise
  // the card the trigger was about ("When you play a <Goku> card, …").
  if (/\bthe played card\b|\bthe card (?:that was |you )?played(?: with this skill)?\b/i.test(clause)) {
    if (c.lastPlayed) return { var: c.lastPlayed };
    return c.last ? { var: c.last } : { sel: { special: "subject" } };
  }
  // "Add a marker to the chosen card": the last choice.
  if (/\bthe chosen cards?\b/i.test(clause)) return c.last ? { var: c.last } : c.lastTarget;
  // "Add up to 1 <Son Goku> card among them to your hand" names its own target
  // and only says *where to look* for it. Read before "it"/"them", which would
  // otherwise take the "them" and hand back whatever the last clause acted on.
  if (/\b(?:among them|from among them|of those cards)\b/i.test(clause)) {
    const among = parseTarget(clause);
    if (among) return { sel: among };
  }
  if (IT.test(clause.toLowerCase()) || BARE_IT.test(clause.trim().replace(/[.,]$/, ""))) {
    if (c.lastTarget) return c.lastTarget;
    if (c.last) return { var: c.last };
    return null;
  }
  const sel = parseTarget(clause);
  if (sel) return { sel };
  return null;
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
  if (/for the (?:duration of the )?battle|during this battle/.test(t)) return "battle";
  if (/for the (?:duration of the )?game|during the game|in any area|in all areas/.test(t)) return "game";
  if (/until (?:the start of )?your opponent's next turn/.test(t)) return "opponentTurn";
  // Your *own* next Charge Phase is one step past "your next turn": the effect
  // has to be there when the Active Step runs (7-2-7).
  if (/during your next charge phase/.test(t)) return "afterNextCharge";
  // Everything that has to survive the opponent's whole turn and end as yours
  // begins: the rest-lock wordings, which are the same duration said four ways.
  if (/until the end of your opponent's(?: next)? turn|until the (?:start|beginning) of your next turn|during your opponent's next charge phase|during your opponent's next turn/.test(t)) return "nextTurn";
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
  const opener = /^(?:if|when)?\s*(.*?) would (leave|be removed from|be sent from) (?:your |the |a )?battle area(?: by (?:a|your) skills?)?( or (?:be )?ko'?d)?$/.exec(t);
  if (opener) {
    // "Removed from a Battle Area by a skill or KO'd" covers both causes;
    // "would leave" covers every cause, so it has no restriction at all.
    const by = opener[2] === "leave" ? undefined : opener[3] ? ("skillOrKo" as const) : ("skill" as const);
    const who = opener[1].trim();
    // "A ≪Slug's Army≫ card with a combo cost of 1 would leave your Battle
    // Area" — the rule is about other cards, so the subject is kept.
    if (/^(?:this card|it)$/.test(who)) return { by };
    return who ? { by, subject: who } : { by };
  }
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

/** True when the price is nothing but orbs (and the reminder text beside them). */
export function costIsOnlyOrbs(cost: string): boolean {
  return (
    stripNotes(cost)
      .replace(/\{[^}]*\}/g, "")
      .replace(/[\s,:]/g, "").length === 0
  );
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
    for (const part of t.split(/ and /)) {
      const got = parseConditionClause(part.trim(), true);
      if (!got) {
        conds.length = 0;
        break;
      }
      conds.push(got.cond);
    }
    if (conds.length > 1) return { cond: { kind: "all", conds } };
  }
  let m: RegExpExecArray | null;
  // "If your Leader Card is a <Baby> card, it gets +10000 power" — the leader is
  // both the condition's subject and what "it" then refers to.
  if ((m = /^your leader(?: card)? is (.+)$/.exec(t))) {
    const filter = parseFilter(m[1]);
    return { cond: { kind: "leaderMatches", filter }, subject: { sel: { special: "leader" } } };
  }
  // "If your opponent's Leader Card is red or blue" — the same test, other side.
  if ((m = /^your opponent's leader(?: card)? is (.+)$/.exec(t))) {
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

  // A card's own mode as a condition (1-10).
  if ((m = /^this card is in (rest|active) mode$/.exec(t))) {
    return { cond: { kind: "count", sel: { special: "self", mode: m[1] as "rest" | "active" }, atLeast: 1 }, subject: { sel: { special: "self" } } };
  }
  // "If you added a card to your hand", "if you chose to add 1 or more cards
  // to your hand", "if you played a card" — about an earlier step of the same
  // skill (20-16), which the interpreter remembers.
  if (/^you (?:chose to )?add(?:ed)? (?:a card|1 or more cards?|any cards?|cards?) to your hand$/.test(t)) return { cond: { kind: "did", what: "addToHand" } };
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
  // "If your Leader's back side is {Name}", "… is a black <Goku> card" (22-2-5).
  if ((m = /^your leader(?: card)?'s back side is (.+)$/.exec(t))) {
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
  if ((m = /^you don'?t have (?:an?|any) (.+?)(?: in play)?$/.exec(t))) {
    const sel = parseTarget(`your ${m[1]}`) ?? parseTarget(`your ${m[1]} card`);
    if (sel) {
      delete sel.count;
      delete sel.upTo;
      return { cond: { kind: "count", sel, atMost: 0 } };
    }
  }
  const counted = parseCountCondition(t);
  if (counted) return { cond: counted };
  // "When your life is at 4 or less, or you have 5 or more energy and a
  // <Goku> card in play" — several conditions joined; "or" binds loosest.
  // Every part has to read, or the whole condition is a gap.
  const JOIN = /(?=you |your |there |it'?s |it is |this card |all |an? )/;
  const alternatives = t.split(new RegExp(`,? or ${JOIN.source}`));
  if (alternatives.length > 1) {
    const conds = alternatives.map((part) => parseConditionClause(part, true)?.cond ?? null);
    return conds.every((x) => x) ? { cond: { kind: "any", conds: conds as Cond[] } } : null;
  }
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
  const m = /^(?:you have|your opponent has|there (?:are|is)) (?:(no)|(?:an?|any) |(\d+) or (more|less|fewer) )?(.+)$/.exec(t);
  if (!m) return null;
  const [, none, num, dir, rest] = m;
  // "you have" / "your opponent has" says whose cards, which the phrase after
  // the number usually does not repeat.
  const mine = /^you have/.test(t);
  const theirs = /^your opponent has/.test(t);
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
  if (/^(?:if you don'?t|if not|if you didn'?t|if you do not)$/.test(t)) return "ifNotDone";
  // 20-12-3: after looking, the cards go back where they were; the order is
  // the player's and changes nothing the engine tracks.
  if (/^(?:put|place) (?:them|the rest|the remaining cards?|it) back(?: on top of (?:your|the|their) deck)?(?: in any order)?$/.test(t)) return "skip";
  if (/^shuffle any (?:secret )?areas? you looked (?:through|at)$/.test(t)) return "skip";
  if (/^(?:additionally|then|so|and|also|after that|in addition)$/.test(t)) return "skip";
  // Reminders that restate a rule the engine already applies.
  if (/^(?:you can't activate|this skill can only be activated|this card can't be played)/.test(t)) return "skip";
  // "You can activate this card's [Counter] skill from your hand" is where a
  // [Counter] skill is activated from anyway (4-3), so the sentence adds
  // nothing. The forms that *change* the cost are not this, and are left alone.
  if (/^you (?:can|may) activate this card's \[counter\][a-z: ]*skill from your hand$/.test(t)) return "skip";
  // "When this card is played using [Over Realm], activate this skill" — the
  // skill saying that it happens, which it is already doing.
  if (/^activate this skill$/.test(t)) return "skip";
  if (/^when you activate this card's \[counter\][a-z: ]*skill$/.test(t)) return "skip";
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
  const m = /^(.+?)\s+(?:for each|equal to the number of)\s+(.+)$/.exec(t);
  if (!m) return null;
  const sel = parseTarget(m[2]);
  if (!sel) return null;
  // A count reads the whole area, not one card out of it.
  const counting: Selector = { ...sel, count: 99, upTo: false };
  // "Draw cards equal to the number of …" prints no number at all, because the
  // count is the number.
  if (/^draw cards?$/.test(m[1])) return [{ op: "draw", n: { count: counting } }];
  const head = compileClause(m[1], c);
  if (!head || head.length !== 1) return null;
  const op = head[0];
  // Only the ops whose whole point is a number, and only when that number was
  // printed — anything else would be a guess about which part varies.
  if ((op.op === "draw" || op.op === "discard" || op.op === "damage" || op.op === "mill" || op.op === "addLife" || op.op === "energyMarker") && typeof op.n === "number") {
    return [{ ...op, n: { count: counting, ...(op.n === 1 ? {} : { times: op.n }) } }];
  }
  if ((op.op === "power" || op.op === "comboPower") && typeof op.amount === "number") {
    return [{ ...op, amount: { count: counting, ...(op.amount === 1 ? {} : { times: op.amount }) } }];
  }
  return null;
}

/**
 * Tails that say *how long* or *where* an effect holds, rather than adding to
 * what it does. `durationOf` reads them off the whole clause, so a pattern
 * matching the action itself can be anchored to the end once they are gone.
 */
const TRAILING_QUALIFIER =
  // Some sets print "for the duration of turn", without the second article.
  /\s+(?:for the (?:duration of (?:the )?)?(?:turn|battle|game)|for the rest of (?:the|this) turn|during (?:this|the) turn|this turn|until (?:the )?(?:end|start|beginning) of [a-z' ]+|in (?:all|any) areas?)$/;

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
    .replace(/^(places|sends|returns|adds|switches|removes|discards)\b/, (v) => THIRD_PERSON[v]);
  let m: RegExpExecArray | null;

  // "Your opponent chooses 1 card in their hand and places it in their Drop
  // Area" says the discard twice: the choosing *is* the discard, and this half
  // is where the cards were already sent. Reading it as a second move made it
  // move the wrong card, because "it" had nothing of its own to point at.
  if (c.lastOp === "discard" && /^(?:(?:place|put) (?:it|them) (?:in|into) (?:their|the|your|its owner's) drop(?: area)?|discard (?:it|them))$/.test(t)) return [];

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
  }

  // Draw (5-1). "You may draw" is treated as taken: declining never helps.
  if ((m = /^draw (\d+) cards?$/.exec(t))) return [{ op: "draw", n: Number(m[1]) }];
  if ((m = /^your opponent draws (\d+) cards?$/.exec(t))) return [{ op: "draw", n: Number(m[1]), side: "opponent" }];

  // Discard (20-7).
  if ((m = /^your opponent discards (\d+) cards?(?: from their hand)?$/.exec(t))) return [{ op: "discard", n: Number(m[1]), side: "opponent" }];
  // "Your opponent sends 1 card from their hand to their Warp" — a discard that ends elsewhere (20-7).
  if ((m = /^your opponent (?:sends|places) (\d+) cards? from their hand (?:to|in|into) (?:their|its owner's) warp$/.exec(t))) return [{ op: "discard", n: Number(m[1]), side: "opponent", to: "warp" }];
  if ((m = /^(?:send|place) (\d+) cards? from your hand (?:to|in|into) your warp$/.exec(t))) return [{ op: "discard", n: Number(m[1]), to: "warp" }];
  if ((m = /^discard (\d+) cards?(?: from your hand)?$/.exec(t))) return [{ op: "discard", n: Number(m[1]) }];
  // "…they choose 1 card in their hand": after "when your opponent combos",
  // "they" is the opponent, and the sentence is the same discard.
  if ((m = /^(?:your opponent|they) chooses? (\d+) cards? (?:in|from) their hand$/.exec(t))) return [{ op: "discard", n: Number(m[1]), side: "opponent" }];
  if (/^make your opponent choose (\d+) cards? from their hand$/.test(t)) return [{ op: "discard", n: 1, side: "opponent" }];
  if (/^discard (?:it|them)$/.test(t) && c.last) return [{ op: "moveTo", target: { var: c.last }, to: "drop", reveal: true }];
  if ((m = /^both players choose (\d+) cards? (?:in|from) their hands?$/.exec(t))) return [{ op: "discard", n: Number(m[1]), side: "both" }];
  // Discarding is often printed the long way round, as a move to the Drop.
  // Only the unqualified form: "1 yellow card in your hand" narrows *which*
  // card, and `discard` cannot yet honour that, so it stays unread.
  if ((m = /^place (\d+) cards? (?:from|in) your hand in(?:to)? (?:your |the )?drop(?: area)?$/.exec(t))) return [{ op: "discard", n: Number(m[1]) }];

  // Damage (5-10).
  if ((m = /^deal (\d+) damage to (?:your opponent|your opponent's life|them)$/.exec(t))) return [{ op: "damage", n: Number(m[1]), side: "opponent" }];

  // Deck manipulation.
  if ((m = /^place (?:up to )?(\d+) cards? from the top of (your|your opponent's) deck in (?:your |their |its owner's |the )?drop(?: area)?$/.exec(t))) return [{ op: "mill", n: Number(m[1]), ...(m[2] === "your" ? {} : { side: "opponent" as const }) }];
  // "Draw cards until you have 4 cards in your hand".
  if ((m = /^draw cards until you have (\d+) cards? in your hand$/.exec(t))) return [{ op: "draw", n: { handUpTo: Number(m[1]) } }];
  // "Place the top card of your deck in your Drop Area", "your opponent places
  // the top 2 cards of their deck in their Drop Area" — the same move, either side.
  if ((m = /^(your opponent places|place) the top (?:(\d+) )?cards? of (your|their|your opponent's) deck (?:in|into) (?:your|their|its owner's|the) drop(?: area)?$/.exec(t))) {
    // "Their deck" is the opponent's whichever way round the sentence is
    // built, and the subject may have been dropped before this ran.
    const theirs = m[1] !== "place" || m[3] !== "your";
    return [{ op: "mill", n: m[2] ? Number(m[2]) : 1, ...(theirs ? { side: "opponent" as const } : {}) }];
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
    if (new RegExp(`^(?:place|put) ${REST} (?:in|into) (?:your |the |its owner'?s? |their )?drop(?: area)?$`).test(t))
      return [{ op: "moveTo", target: rest, to: "drop", reveal: true }];
  }
  if (/^shuffle your deck(?: if you looked through it| afterwards?)?$/.test(t)) return [{ op: "shuffle" }];
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
  if ((m = /^activate this card's \[counter\](?: skill)? from your hand (.+)$/.exec(t))) {
    const how = m[1];
    if (/^without paying its energy cost$/.test(how)) return [{ op: "altCost", pay: "none" }];
    let mm: RegExpExecArray | null;
    if ((mm = /^by adding (a|an|\d+) cards? from your life to your hand(?: instead of paying its energy cost)?$/.exec(how))) {
      return [{ op: "altCost", pay: "life", n: countWord(mm[1]) }];
    }
    return null;
  }

  // Cost reduction on a [Permanent] skill (9-1-3-3, 20-21). The amount is
  // printed either as a number or as the orbs it takes off — "by {r}" is one
  // less, and `playCost` already lowers a specified colour along with the
  // total. "For each …" makes it a number read off the board.
  if ((m = /^reduce the (energy|combo) cost of (.+?) by (\d+|(?:\{[rugyk\d]+\})+)(?: for each (.+))?$/.exec(t))) {
    // The area the phrase names is part of the target, not noise: a reducer
    // for cards "in your hand" that selects cards in play does nothing at all,
    // which is what stripping it here used to produce.
    let ref = refFor(m[2], c);
    if (!ref) return null;
    // "Reduce the energy cost of a {Power Pole}" names no area, and 20-1-6's
    // default — a card on the table — is the one place a cost reduction can
    // never matter. What it is about is the card you are about to play.
    if ("sel" in ref && ref.sel.area === "play" && !/\b(?:hand|deck|drop|energy|warp|life|battle area)\b/i.test(m[2])) {
      ref = { sel: { ...ref.sel, area: "hand", count: 99 } };
    }
    const orbs = /^\d+$/.test(m[3]) ? null : orbsIn(m[3]);
    const flat: number = orbs ? Object.values(orbs).reduce<number>((sum, n) => sum + (n ?? 0), 0) : Number(m[3]);
    let by: Amount = flat;
    if (m[4]) {
      const per = parseTarget(m[4]);
      if (!per) return null;
      by = { count: { ...per, count: undefined, upTo: undefined }, ...(flat === 1 ? {} : { times: flat }) };
    }
    return [{ op: "costReduction", target: ref, amount: by, ...(m[1] === "combo" ? { what: "combo" as const } : {}) }];
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

  // "Only 1 {SS2 Trunks} can be played in your Battle Area" — a prohibition
  // that switches itself on once the card is there, which a [Permanent] can
  // say because the static layer asks again every time.
  if ((m = /^only (\d+) (.+?) can be played in your battle area$/.exec(t))) {
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
    const ref = refFor(m[1], c);
    const kws = [...m[4].matchAll(/\[([^\]]+)\]/g)].map((x) => keywordOf(x[1]));
    if (ref && kws.length && kws.every((k) => k)) {
      const until = durationOf(t);
      const gain: Op = m[3] ? { op: "comboPower", target: ref, amount: Number(m[2]), until } : { op: "power", target: ref, amount: Number(m[2]), until };
      return [gain, ...kws.map((k) => ({ op: "grant", target: ref, keyword: k!, until }) as Op)];
    }
  }

  // Power and combo power (9-9). Cards say both "gets" and "gains". Matched
  // against the clause with its duration taken off, and anchored: a tail this
  // does not recognise has to fail here rather than be quietly discarded.
  if ((m = /^(.*?) (?:gets?|gains?) ([+-]\d+) combo power$/.exec(q))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "comboPower", target: ref, amount: Number(m[2]), until: durationOf(t) }] : null;
  }
  // "It loses -5000 power" and "it loses 5000 power" both mean the same thing;
  // the sign on the card is decoration, the verb is what counts.
  if ((m = /^(.*?) loses ([+-]?\d+) power$/.exec(q))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "power", target: ref, amount: -Math.abs(Number(m[2])), until: durationOf(t) }] : null;
  }
  if ((m = /^(.*?) (?:gets?|gains?) ([+-]\d+) power$/.exec(q))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "power", target: ref, amount: Number(m[2]), until: durationOf(t) }] : null;
  }

  // 20-1: what a card counts as, rather than what it does. "This card gains
  // ≪Saiyan≫ in all areas" makes it a Saiyan to every skill that names one.
  if ((m = /^(.*?) (?:gains?|is (?:also )?treated as(?: an?)?) ((?:(?:non-)?(?:<[^>]+>|≪[^≫]+≫|red|blue|green|yellow|black)[\s,]*(?:and\s+|or\s+)?)+)(?: in (?:all|any) areas?)?$/.exec(t))) {
    const what = m[2];
    const filter = parseFilter(what);
    const colors = filter.colors;
    if (!filter.traits.length && !filter.characters.length && !colors.length) return null;
    if (filter.notTraits.length || filter.notCharacters.length) return null;
    const ref = refFor(m[1] || "this card", c);
    return ref ? [{ op: "gains", target: ref, traits: filter.traits, characters: filter.characters, colors }] : null;
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
    const stopped = /^(?:it'?s|it is|that card is|the (?:battle |extra |unison )?card being played is) (?:placed|put) (?:in|into|at) (?:its owner'?s?|their owners?'?s?|your|the|their) (?:(drop)(?: area)?|bottom of (?:its owner'?s?|their|your) deck|(warp)s?)(?: instead)?(?: of being played)?$/.exec(t);
    if (stopped && /instead of being played|instead$/.test(t)) {
      const to: ScriptArea = stopped[1] ? "drop" : stopped[2] ? "warp" : "deck";
      return [{ op: "resolvingPlay", instead: to, ...(to === "deck" ? { position: "bottom" as const } : {}) }];
    }
    // "The Battle Card being played is played in Rest Mode" (BT10-105).
    if (/^(?:it'?s|it is|that card is|the (?:battle |extra |unison )?card being played is) played in rest mode$/.test(t)) return [{ op: "resolvingPlay", mode: "rest" }];
    // "It's played with its skills negated for the turn" (BT11-099).
    if (/^(?:it'?s|it is|that card is|the (?:battle |extra |unison )?card being played is) played with (?:its|their) skills negated(?: for the turn)?$/.test(t)) return [{ op: "resolvingPlay", negated: true }];
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

  // 9-7: answering a counter with a counter. "The [Counter]" is always the one
  // being answered, so nothing has to be named.
  if (/^negate the \[counter[^\]]*\](?: skill)?$/.test(t)) return [{ op: "negateCounter" }];

  // Mode switches (1-10).
  if ((m = /^switch (.*?) to (active|rest) mode$/.exec(t))) {
    const ref = refFor(m[1], c);
    const mode = m[2] as "active" | "rest";
    // "Switch up to 1 of your energy to Active Mode" names a number, so it is
    // a choice first (5-2); without this it switched every card in the area.
    return ref ? withChoice(ref, clause, c, (target) => ({ op: "switchMode", target, mode })) : null;
  }
  // "You may flip this card over" on a Leader's [Auto]: the Leader awakens
  // (22-2-4 says how a flip works; this says when). A card without a back
  // side is left as it is.
  if ((m = /^(?:you may )?flip (.+?) (?:over|onto its back)$/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "flip", target: ref }] : null;
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
  if ((m = /^(?:use|combo with) (.+?)(?: from (?:your|their) (drop|warp|hand)(?: area)?)?(?: in a combo)?(?: from (?:your|their) (drop|warp|hand)(?: area)?)?( with (?:its|their) skills negated)?$/.exec(q)) && /\bcombo\b/.test(t)) {
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
  if ((m = /^(?:place|put) (.+?) (?:face ?up )?under (the played card|the card (?:that was |you )?played(?: with this skill)?|your leader(?: card)?|\{[^}]+\}(?: in your battle area)?)$/.exec(t))) {
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
    [/^place (.+?) at the bottom of (?:its owner'?s?|their owners?'?s?|their|your) decks?(?: in any order)?$/, "deck", { position: "bottom" }],
    [/^place (.+?) on top of (?:its owner'?s?|their owners?'?s?|their|your) decks?(?: in any order)?$/, "deck", { position: "top" }],
    [/^return (.+?) to (?:its|their) owners?'?s? hands?$/, "hand", {}],
    [/^return (.+?) to (?:your|their) hands?$/, "hand", {}],
    [/^add (.+?) to your hand$/, "hand", {}],
    [/^send (.+?) to (?:your|their|its owner'?s?|their owners?'?s?|the) warps?$/, "warp", {}],
    // 3-8: whose energy area matters, and it is not always the card's owner —
    // "place it in your opponent's energy in Rest Mode" hands them a card.
    [/^(?:add|place) (.+?) (?:to|in) your opponent'?s energy(?: area)? in rest mode$/, "energy", { mode: "rest", reveal: true, owner: "opponent" }],
    [/^(?:add|place) (.+?) (?:to|in) your opponent'?s energy(?: area)?$/, "energy", { reveal: true, owner: "opponent" }],
    [/^(?:add|place) (.+?) (?:to|in) your energy(?: area)? in rest mode$/, "energy", { mode: "rest", reveal: true, owner: "you" }],
    [/^(?:add|place) (.+?) (?:to|in) your energy(?: area)?$/, "energy", { reveal: true, owner: "you" }],
    [/^add (.+?) to your life$/, "life", {}],
    [/^(?:add|place|send) (.+?) (?:in|into|to) your z-energy$/, "zEnergy", {}],
    [/^remove (.+?) from the game(?: instead)?$/, "removed", {}],
  ];
  for (const [re, to, opts] of MOVES) {
    if ((m = re.exec(t))) {
      const ref = refFor(m[1], c);
      return ref ? withChoice(ref, clause, c, (target) => ({ op: "moveTo", target, to, ...opts })) : null;
    }
  }

  // Playing a card by a skill (5-5-3).
  // "Activate" is what the text calls playing an Extra card (12-2), so the two
  // words lead to the same place. A card that says "play … in Rest Mode" is
  // still played from wherever it is; the mode belongs to the play, not to the
  // choice, or the choice would go looking for a card already rested.
  if ((m = /^(?:play|activate) (.+?)(?: in (rest|active) mode)?$/.exec(t))) {
    if (/token/.test(t)) return compileToken(clause, c);
    const mode = m[2] as "rest" | "active" | undefined;
    const ref = refFor(m[1], c);
    if (!ref) return null;
    if ("sel" in ref) {
      // "play up to 1 X from your hand" is a choice followed by the play.
      const v = `p${c.n++}`;
      c.lastPlayed = v;
      return [
        { op: "choose", sel: ref.sel, as: v, reason: clause },
        { op: "play", target: { var: v }, ...(mode ? { mode } : {}) },
      ];
    }
    return [{ op: "play", target: ref, ...(mode ? { mode } : {}) }];
  }

  // Choosing (5-2). Late, because many clauses open with "choose" plus an action.
  if (/^choose /.test(t)) {
    let sel = parseTarget(clause);
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
    const v = `c${c.n++}`;
    return [{ op: "choose", sel, as: v, reason: clause }];
  }

  // "Choose 1 of your <Majin Buu> and 1 of your opponent's Battle Cards"
  // splits on the "and", and the second half arrives with the verb left
  // behind. A bare target phrase after a choice is another choice.
  if (c.last && /^(?:up to )?\d+ /.test(t)) {
    const sel = parseTarget(clause);
    if (sel) {
      const v = `c${c.n++}`;
      return [{ op: "choose", sel, as: v, reason: clause }];
    }
  }

  return null;
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
  const m = /^(.*?)\s+(?:can'?t|cannot|will not|won'?t)\s+(.*)$/.exec(t);
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
      if (!filter && !type) return null;
      return [{ op: "forbid", what: "play", side, until, filter: { ...(filter ?? parseFilter("")), ...(type ? { type } : {}) } }];
    }
    if (/^attack\b/.test(rest)) {
      // "attack this card" is about the defender, not the attacker.
      if (/^attack (?:this card|it)\b/.test(rest)) return [{ op: "forbid", what: "beAttacked", until, target: { sel: { special: "self" } } }];
      const withWhat = /\bwith (.*)$/.exec(rest)?.[1];
      const filter = withWhat ? filterFor(withWhat, null) : undefined;
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

  // A sentence about cards: "this card", "it", "your Battle Cards".
  const target = refFor(subject || "this card", c);
  if (!target) return null;
  // "can't be KO'd by your opponent's skills" — who is stopped from doing it.
  const bySide: Side | undefined = /\bby your opponent'?s? skills?\b/.test(rest) ? "opponent" : /\bby your skills?\b/.test(rest) ? "you" : undefined;
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
  const stats = /([\d,]+) power[^.]*?([\d,]+) combo cost[^.]*?([\d,]+) combo power/i.exec(c.raw);
  const num = (x: string) => Number(x.replace(/,/g, ""));
  return [
    {
      op: "token",
      name: `${m[2].trim()} Token`,
      power: stats ? num(stats[1]) : 5000,
      comboCost: stats ? num(stats[2]) : 0,
      comboPower: stats ? num(stats[3]) : 5000,
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
  if (skill.keyword && KEYWORD_HANDLES_THE_LINE.has(skill.keyword.name)) return { ops: [], unsupported: [] };
  const text = stripNotes(skill.effect);
  if (!text) return { ops: [], unsupported: [] };
  const unsupported: string[] = [];
  const c: Ctx = { last: null, lastSeen: null, lastPlayed: null, lastTarget: null, lastOp: null, replacing: null, n: 0, raw: skill.effect };
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
    else if (/\byour\b|\byour opponent'?s\b/i.test(trigger)) c.lastTarget = { sel: { special: "subject" } };
    // "When this card attacks and KOs an opponent's Battle Card" splits on the
    // "and"; the second half is still the trigger.
    while (clauses.length > 1 && /^(?:kos?|ko's|is ko'?d|deals damage)\b/i.test(clauses[0].trim())) clauses.shift();
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

  const ops = compileClauseList(clauses, c, unsupported);
  if (modal) {
    // Each option is compiled on its own, carrying what the head established
    // ("If your Leader is a <Baby> card, it gets +10000 power, then choose
    // one— ・…" — "it" still means the leader inside the options).
    const modes = modal.options.map((option) => ({ label: option, ops: compileClauseList(splitClauses(option), { ...c }, unsupported) }));
    if (modes.some((mode) => mode.ops.length)) ops.push({ op: "chooseMode", modes });
  }
  // "[Auto] If your Leader Card is red: When you play this card, draw 1 card"
  // — a condition written before the colon is part of the skill's validity
  // (9-1-3), and it lands in `cost`. It wraps the whole program; one the
  // compiler cannot read fails the skill rather than running it unconditionally.
  const priced = costText(skill.cost);
  if (ops.length && !engineChecks && /^(?:if|when|while|during)\b/i.test(priced)) {
    const cond = parseConditionClause(priced);
    if (!cond) return { ops: [], unsupported: [skill.cost, ...unsupported] };
    return { ops: [{ op: "if", cond: cond.cond, then: ops }], unsupported };
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
    c.lastTarget = { var: o.as };
  } else if (o.op === "reveal") {
    c.lastSeen = o.as;
    c.lastTarget = { var: o.as };
  } else if (o.op === "look") {
    c.lastSeen = o.as;
  } else if ("target" in o && o.target) c.lastTarget = o.target;
}

/** A clause that is nothing but a duration, split off from the effect it belongs to. */
const PURE_DURATION = /^(?:during this turn|for the (?:duration of the )?(?:turn|battle)|for the rest of the turn|until the end of (?:your|your opponent's|the)(?: next)? turn|until the (?:start|beginning) of your (?:next )?turn|until the (?:start|beginning) of your opponent's next turn)[.,]?$/i;

/** The clause loop, shared by a skill's body and by each modal option. */
function compileClauseList(clauses: string[], c: Ctx, unsupported: string[]): Op[] {
  // "if you do" (20-16) makes the rest conditional on the previous choice, and
  // a run of conditions all have to hold, so a group carries a list of them.
  type Group = { conds: Cond[]; ops: Op[]; delay?: { at: DelayTiming; scope: DelayScope; label: string } };
  const groups: Group[] = [{ conds: [], ops: [] }];
  const push = (ops: Op[]) => groups[groups.length - 1].ops.push(...ops);
  for (let i = 0; i < clauses.length; i++) {
    const clause = clauses[i];
    // "During this turn, your opponent can't…", "…, until the end of your
    // opponent's turn, it can't attack" — a duration split off on its own
    // belongs to the clause after it, where `durationOf` will find it.
    if (PURE_DURATION.test(clause.trim()) && i + 1 < clauses.length) {
      clauses[i + 1] = `${clauses[i + 1].replace(/[.]$/, "")} ${clause.trim()}`;
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
        unsupported.push(clause);
        continue;
      }
      const asked: Cond = prev.conds.length === 1 ? prev.conds[0] : { kind: "all", conds: [...prev.conds] };
      groups.push({ conds: [{ kind: "not", cond: asked }], ops: [] });
      continue;
    }
    if (conn === "ifDone") {
      groups.push({ conds: c.last ? [{ kind: "chose", var: c.last }] : [], ops: [] });
      continue;
    }
    if (conn === "ifNotDone") {
      // "If you don't" without a choice before it has nothing to be the
      // opposite of; the clause is a gap rather than an always-true condition.
      if (!c.last) {
        unsupported.push(clause);
        continue;
      }
      groups.push({ conds: [{ kind: "not", cond: { kind: "chose", var: c.last } }], ops: [] });
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
        else unsupported.push(delay.rest);
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
      unsupported.push(clause);
      continue;
    }

    // "If that card is a Battle Card" — what the reveal or the look just
    // turned up. The name only exists here, so the condition is built with
    // the compiler's own bookkeeping rather than by `parseConditionClause`.
    if (c.lastSeen || c.last) {
      const seen = /^(?:if|when) (?:that card|the (revealed|chosen) card) is (?:an? )?(.+)$/i.exec(clause.trim().replace(/[.,]$/, ""));
      // "The chosen card" is the choice; "that card" is whatever was last
      // turned up, and only falls back to the choice when nothing was.
      const v = seen?.[1]?.toLowerCase() === "chosen" ? c.last : (c.lastSeen ?? c.last);
      const filter = seen ? filterFor(seen[2], null) : undefined;
      if (seen && filter && v) {
        groups.push({ conds: [{ kind: "varMatches", var: v, filter }], ops: [] });
        c.lastTarget = { var: v };
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
    const said = c.replacing ? clause.replace(/[\s,]+instead[.\s]*$/i, "") : clause;
    let got = compileClause(said, c);
    // Only as a fallback: several patterns read the subject themselves and say
    // it better than this can — "your opponent sends 1 card from their hand to
    // their Warp" is a discard (20-7), chosen by its owner because it is a
    // hand card, not a move of a named one.
    let opponentDoes = false;
    if (!got && OPPONENT_POSSESSIVE.test(said) && OPPONENT_DOES.test(said.trim())) {
      got = compileClause(said.trim().replace(OPPONENT_DOES, (_, v: string) => `${THIRD_PERSON[v.toLowerCase()] ?? v.toLowerCase()} `), c);
      opponentDoes = !!got;
    }
    if (!got) {
      if (c.replacing) c.replacing = null;
      unsupported.push(clause);
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
        const target: Ref = subject ? { sel: { side: "you", area: "battle", filter, count: 99 } } : only.target;
        // "…to your energy in Rest Mode instead" — the move said how it
        // arrives as well as where, and the replacement has to carry both.
        push([{ op: "replaceLeave", to: only.to, target, ...(by ? { by } : {}), ...(only.mode ? { mode: only.mode } : {}) }]);
        continue;
      }
      // Anything else is a replacement this language cannot say yet, and
      // half of one is worse than none.
      unsupported.push(clause);
      continue;
    }
    // Only who picks changes: the selectors already point at their cards,
    // because the sentence said "their Drop Area".
    if (opponentDoes) for (const o of got) if (o.op === "choose") o.chooser = "opponent";
    for (const o of got) track(o, c);
    if (got.length) c.lastOp = got[got.length - 1].op;
    push(got);
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

export interface CardScripts {
  /** Keyed by skill index; only skills with text appear. */
  bySkill: Record<number, Script>;
  /** True when every skill either compiled or is a pure keyword skill. */
  complete: boolean;
  unsupported: string[];
}

const cardCache = new WeakMap<CardDef, { front: CardScripts; back: CardScripts }>();

/** `compileCard`, memoised per definition — the same card is compiled once. */
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
    bySkill[sk.index] = script;
    unsupported.push(...script.unsupported);
  }
  return { bySkill, complete: unsupported.length === 0, unsupported };
}

// ── plain-English rendering, for the card inspector ─────────────────────────

const FORBIDDEN_IN_WORDS: Record<ForbiddenAction, string> = {
  attack: "attack",
  beAttacked: "be attacked",
  block: "block",
  play: "play cards",
  activateSkill: "activate skills",
  activateCounter: "activate [Counter] skills",
  combo: "combo",
  beKOd: "be KO'd",
  beKOdBySkill: "be KO'd by skills",
  beChosen: "be chosen by skills",
  switchToActive: "switch to Active Mode",
  placeEnergy: "place cards in the Energy Area",
  beMovedBySkill: "be removed from a Battle Area by skills",
  beNegated: "have their skills negated",
};

function describeSelector(sel: Selector): string {
  if (sel.special) return { self: "this card", attacker: "the attacking card", guard: "the guard card", subject: "that card", leader: "your leader", opponentLeader: "the opposing leader", resolving: "the card being played" }[sel.special];
  const who = sel.side === "opponent" ? "opponent's " : sel.side === "both" ? "each player's " : "your ";
  const n = sel.count === 99 ? "all" : sel.upTo ? `up to ${sel.count}` : `${sel.count}`;
  const where = sel.fromVar ? "of the cards looked at" : `in ${who}${(sel.areas?.length ? sel.areas.join(" or ") : sel.area)}`;
  return `${n} ${where}`;
}

function describeRef(ref: Ref): string {
  return "var" in ref ? "the chosen cards" : describeSelector(ref.sel);
}

function describeAmount(a: Amount): string {
  if (typeof a === "number") return `${a}`;
  if ("var" in a) return "that many";
  if ("sumPower" in a) return "the total power of the cards rested";
  if ("handUpTo" in a) return `up to ${a.handUpTo} in hand`;
  return `${a.times ?? 1} for each of ${describeEach(a.count)}`;
}

/** The area as a person would name it, for "for each of your Battle Cards". */
const AREA_NOUNS: Partial<Record<ScriptArea, string>> = {
  play: "cards in play",
  battle: "Battle Cards",
  unison: "Unison Cards",
  leader: "Leader",
  drop: "cards in the Drop",
  hand: "cards in hand",
  deck: "cards in the deck",
  life: "life cards",
  energy: "energy",
  warp: "cards in the Warp",
  combo: "combo cards",
  zDeck: "Z-Deck cards",
  zEnergy: "Z-Energy",
  removed: "removed cards",
  under: "cards underneath",
};

function describeEach(sel: Selector): string {
  if (sel.special) return describeSelector(sel);
  const who = sel.side === "opponent" ? "their " : sel.side === "both" ? "" : "your ";
  const mode = sel.mode ? ` in ${sel.mode} mode` : "";
  const nouns = (sel.areas?.length ? sel.areas : [sel.area ?? "play"]).map((a) => AREA_NOUNS[a] ?? "cards");
  return `${who}${nouns.join(" or ")}${mode}`;
}

/**
 * A condition in plain words. The rules page shows this back before you keep a
 * reading, and "if a condition holds" would tell you nothing about whether the
 * engine understood the condition you meant.
 */
function describeCond(c: Cond): string {
  switch (c.kind) {
    case "count": {
      const what = describeSelector({ ...c.sel, count: 99 }).replace(/^all /, "");
      const bound = c.atMost === 0 ? "no" : c.atLeast != null ? `${c.atLeast} or more` : c.atMost != null ? `${c.atMost} or fewer` : "any";
      return `there ${c.atMost === 0 ? "are" : "is"} ${bound} ${what}`;
    }
    case "life": {
      const whose = c.side === "opponent" ? "their" : "your";
      if (c.atMost != null) return `${whose} life is ${c.atMost} or less`;
      if (c.atLeast != null) return `${whose} life is ${c.atLeast} or more`;
      return `${whose} life`;
    }
    case "lifeVsOpponent":
      return c.atLeast ? "your life is at least theirs" : "your life is no more than theirs";
    case "leaderColor":
      return `your leader is ${c.color}`;
    case "leaderMatches": {
      const f = c.filter;
      const bits = [...f.colors, ...f.characters.map((x) => `<${x}>`), ...f.traits.map((x) => `≪${x}≫`)];
      return `${c.side === "opponent" ? "their" : "your"} leader${c.back ? "'s back side" : ""} is ${bits.join(" ") || f.names?.join("/") || "a match"}`;
    }
    case "markers": {
      const bound = c.atLeast != null ? `${c.atLeast} or more` : c.atMost != null ? `${c.atMost} or fewer` : "any";
      return `${describeSelector(c.sel)} has ${bound} markers`;
    }
    case "inBattle":
      return `${describeSelector(c.sel)} is ${c.not ? "not " : ""}in a battle`;
    case "leaderFlipped":
      return `${c.side === "opponent" ? "their" : "your"} leader ${c.flipped === false ? "has not" : "has"} awakened`;
    case "did":
      return c.what === "addToHand" ? "you added a card to your hand" : c.what === "play" ? "you played a card" : c.what === "negateLeaderAttack" ? "you negated a Leader's attack" : c.what === "ko" ? "you KO'd a card" : c.what === "draw" ? "you drew a card" : "you negated the attack";
    case "not":
      return `not (${describeCond(c.cond)})`;
    case "power": {
      const bound = c.atLeast != null ? `${c.atLeast} or more` : c.atMost != null ? `${c.atMost} or less` : "any";
      return `${describeSelector(c.sel)} has ${bound} power`;
    }
    case "any":
      return c.conds.map(describeCond).join(", or ");
    case "all":
      return c.conds.map(describeCond).join(" and ");
    case "chose":
      return "you took that choice";
    case "varMatches":
      return `that card is ${describeSelector({ filter: c.filter })}`;
    case "isTurnPlayer":
      return c.who === "opponent" ? "it is your opponent's turn" : "it is your turn";
  }
}

/** One short line per op, so the inspector can show the engine's own reading. */
export function describeScript(ops: Op[]): string {
  const parts: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case "draw":
        parts.push(`${op.side === "opponent" ? "opponent draws" : "draw"} ${describeAmount(op.n)}`);
        break;
      case "discard":
        parts.push(`${op.side === "opponent" ? "opponent discards" : "discard"} ${describeAmount(op.n)}`);
        break;
      case "damage":
        parts.push(`deal ${describeAmount(op.n)} damage`);
        break;
      case "mill":
        parts.push(`${describeAmount(op.n)} from the top of the deck to the Drop`);
        break;
      case "addLife":
        parts.push(`add ${describeAmount(op.n)} to life`);
        break;
      case "lifeDownTo":
        parts.push(`life down to ${op.n}, the cards going to hand`);
        break;
      case "shuffle":
        parts.push("shuffle");
        break;
      case "energyMarker":
        parts.push(`${describeAmount(op.n)} energy marker`);
        break;
      case "choose":
        parts.push(`choose ${describeSelector(op.sel)}`);
        break;
      case "look":
        parts.push(`look at the top ${describeAmount(op.n)}`);
        break;
      case "reveal":
        parts.push(`reveal ${describeSelector(op.sel)}`);
        break;
      case "hidden":
        parts.push(`switch ${describeRef(op.target)} to ${op.hidden ? "Hidden" : "Revealed"} Mode`);
        break;
      case "redirectAttack":
        parts.push(`switch the target of the attack to ${describeRef(op.target)}`);
        break;
      case "comboFrom":
        parts.push(`use ${describeRef(op.target)} in a combo${op.negated ? " with its skills negated" : ""}`);
        break;
      case "flip":
        parts.push(`flip ${describeRef(op.target)} over`);
        break;
      case "ko":
        parts.push(`KO ${describeRef(op.target)}`);
        break;
      case "moveTo":
        parts.push(`move ${describeRef(op.target)} to ${op.to}`);
        break;
      case "play":
        parts.push(`play ${describeRef(op.target)}${op.mode ? ` in ${op.mode} mode` : ""}`);
        break;
      case "switchMode":
        parts.push(`switch ${describeRef(op.target)} to ${op.mode} mode`);
        break;
      case "power":
      case "comboPower": {
        // A counted amount reads "+5000 power for each …", so the noun has to
        // sit next to the number rather than at the end of the sentence.
        const kind = op.op === "power" ? "power" : "combo power";
        const a = op.amount;
        if (typeof a === "number") parts.push(`${describeRef(op.target)} ${a >= 0 ? "+" : ""}${a} ${kind} for the ${op.until}`);
        else if ("count" in a) parts.push(`${describeRef(op.target)} +${a.times ?? 1} ${kind} for each of ${describeEach(a.count)}, for the ${op.until}`);
        else parts.push(`${describeRef(op.target)} +that many ${kind} for the ${op.until}`);
        break;
      }
      case "grant":
        parts.push(`${describeRef(op.target)} gains [${(op.keyword as KeywordSkill).name}] for the ${op.until}`);
        break;
      case "negateSkills":
        parts.push(`negate the skills of ${describeRef(op.target)} for the ${op.until}`);
        break;
      case "resolvingPlay":
        parts.push(op.instead ? `the card being played is not played and goes to the ${op.instead} instead` : op.mode === "rest" ? "the card being played is played in Rest Mode" : "the card being played is played with its skills negated");
        break;
      case "negateSkillsOfKind":
        parts.push(`negate the [${op.kind === "auto" ? "Auto" : op.kind === "counter" ? "Counter" : op.kind === "permanent" ? "Permanent" : "Activate"}] skills of ${describeRef(op.target)} for the ${op.until}`);
        break;
      case "cannotAttack":
        parts.push(`${describeRef(op.target)} can't attack for the ${op.until}`);
        break;
      case "forbid":
        parts.push(`${op.target ? describeRef(op.target) : op.side === "opponent" ? "your opponent" : "you"} can't ${FORBIDDEN_IN_WORDS[op.what]} for the ${op.until}`);
        break;
      case "addMarker":
        parts.push(`add ${describeAmount(op.n)} marker`);
        break;
      case "removeMarker":
        parts.push(`remove ${describeAmount(op.n)} marker`);
        break;
      case "token":
        parts.push(`play ${describeAmount(op.n)} ${op.name} (${op.power} power)`);
        break;
      case "costReduction":
        parts.push(`${describeRef(op.target)} costs ${describeAmount(op.amount)} less`);
        break;
      case "replaceLeave": {
        const cause = op.by === "ko" ? "be KO'd" : op.by === "skill" ? "be removed from the Battle Area by a skill" : op.by === "skillOrKo" ? "be removed from the Battle Area by a skill or KO'd" : "leave the Battle Area";
        parts.push(`if ${describeRef(op.target ?? { sel: { special: "self" } })} would ${cause}, it goes to the ${op.to}${op.mode === "rest" ? " in Rest Mode" : ""} instead`);
        break;
      }
      case "altCost":
        parts.push(op.pay === "none" ? "its [Counter] may be activated for no energy" : `its [Counter] may be activated by adding ${op.n ?? 1} from your life to your hand`);
        break;
      case "negateAttack":
        parts.push("negate the attack");
        break;
      case "negateCounter":
        parts.push("negate the counter being answered");
        break;
      case "negateOwnSkill":
        parts.push("this skill does not happen again");
        break;
      case "if": {
        const yes = describeScript(op.then);
        const no = op.else?.length ? `, otherwise ${describeScript(op.else)}` : "";
        parts.push(`if ${describeCond(op.cond)}: ${yes || "nothing"}${no}`);
        break;
      }
      case "delay":
        parts.push(`${op.label ?? "later"}: ${describeScript(op.ops)}`);
        break;
      case "chooseMode":
        parts.push(`choose one — ${op.modes.map((mode) => describeScript(mode.ops)).join(" / ")}`);
        break;
      case "note":
        break;
    }
  }
  return parts.join(", ");
}
