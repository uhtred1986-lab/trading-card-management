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
import { keywordOf, skillsOf } from "./cards";
import type { Amount, Cond, Op, Ref, Script, ScriptArea, Selector, Side } from "./script";
import type { CardDef, DelayScope, DelayTiming, ForbiddenAction, KeywordSkill, Skill } from "./types";

// ── clause splitting ───────────────────────────────────────────────────────

/** Split on commas, semicolons, full stops and "then"/"and", ignoring anything inside brackets. */
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
      } else if (text.startsWith(" and ", i) && !text.startsWith(" and [", i)) {
        // "gains [Double Strike] and [Barrier]" is one clause, not two.
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
  [/\bin your energy\b|\benergy area\b|\bof your energy\b|\byour energy\b|\b(?:your opponent's|their) energy\b/, "energy"],
  [/\bfrom your hand\b|\bin your hand\b|\btheir hand\b|\byour hand\b/, "hand"],
  [/\bfrom your deck\b|\bin your deck\b|\byour deck\b/, "deck"],
  [/\bin your life\b|\bfrom your life\b|\byour life\b|\blife area\b/, "life"],
  [/\bwarp\b/, "warp"],
  [/\bcombo area\b/, "combo"],
  [/\bunison area\b|\bunison cards?\b/, "unison"],
  [/\bz-deck\b/, "zDeck"],
  [/\bz-energy\b/, "zEnergy"],
  [/\bunder this card\b/, "under"],
  [/\bleader cards?\b|\byour leader\b/, "leader"],
  [/\bbattle area\b|\bbattle cards?\b/, "battle"],
  // 20-1-6: an unqualified "cards" means the Leader Area and the Battle Area.
  [/\b(?:your|their|opponent's) (?:[a-z-]+ )*cards\b/, "play"],
];

/** "up to 2 of your opponent's Battle Cards in Rest Mode" → a selector. */
export function parseTarget(phrase: string): Selector | null {
  const t = phrase.toLowerCase();
  if (/\bthis card\b/.test(t) && !/\bother\b/.test(t)) return { special: "self" };
  if (/\bthe attack(?:ing)? card\b/.test(t)) return { special: "attacker" };
  if (/\bthe guard card\b/.test(t)) return { special: "guard" };

  let side: Side = "you";
  if (/\byour opponent'?s?\b|\btheir\b|\bthe opponent'?s\b/.test(t)) side = "opponent";
  if (/\ball players\b|\beach player\b|\bboth players\b/.test(t)) side = "both";

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

  const mode = /\bin rest mode\b/.test(t) ? "rest" : /\bin active mode\b/.test(t) ? "active" : undefined;
  const filter = filterFor(phrase, area);
  return { side, area: area ?? undefined, filter, count, upTo, mode, fromVar };
}

/** Only keep a filter when the phrase actually narrows the cards. */
function filterFor(phrase: string, area: ScriptArea | null): CardFilter | undefined {
  const f = parseFilter(phrase);
  const narrows =
    f.characters.length > 0 ||
    f.notCharacters.length > 0 ||
    f.traits.length > 0 ||
    f.notTraits.length > 0 ||
    f.names.length > 0 ||
    f.costMin != null ||
    f.costMax != null ||
    f.powerMin != null ||
    f.powerMax != null ||
    f.monoColor ||
    (f.colors.length > 0 && area !== "energy");
  if (!narrows) return undefined;
  // In an area that only holds one kind of card, the type word is noise.
  if (area === "battle" && f.type === "BATTLE") f.type = null;
  if (area === "leader" && f.type === "LEADER") f.type = null;
  return f;
}

// ── clause patterns ────────────────────────────────────────────────────────

interface Ctx {
  /** The variable the last `choose` bound. */
  last: string | null;
  /**
   * What "it"/"them" points at. Card text carries the subject from clause to
   * clause — "Switch this card to Active Mode and it gets +5000 power" means
   * this card — so the last target of any clause counts, not only a choice.
   */
  lastTarget: Ref | null;
  n: number;
  /** The skill text with its explanatory notes still in place. A token's stats are printed there. */
  raw: string;
}

/** "A marker", "an energy" — the article is the number one. */
const countWord = (w: string) => (/^\d+$/.test(w) ? Number(w) : 1);

/** Words that point back at whatever the previous clause acted on. */
const IT = /\b(?:it|its|them|they|their|that card|those cards|the chosen cards?)\b/;

function refFor(clause: string, c: Ctx): Ref | null {
  if (/\bthis card\b/i.test(clause)) return { sel: { special: "self" } };
  if (IT.test(clause.toLowerCase())) {
    if (c.lastTarget) return c.lastTarget;
    if (c.last) return { var: c.last };
    return null;
  }
  const sel = parseTarget(clause);
  if (sel) return { sel };
  return null;
}

function durationOf(clause: string): "battle" | "turn" | "game" | "opponentTurn" | "nextTurn" {
  const t = clause.toLowerCase();
  if (/for the (?:duration of the )?battle|during this battle/.test(t)) return "battle";
  if (/for the (?:duration of the )?game|during the game|in any area|in all areas/.test(t)) return "game";
  if (/until (?:the start of )?your opponent's next turn/.test(t)) return "opponentTurn";
  // Everything that has to survive the opponent's whole turn and end as yours
  // begins: the rest-lock wordings, which are the same duration said four ways.
  if (/until the end of your opponent's(?: next)? turn|until the (?:start|beginning) of your next turn|during your opponent's next charge phase|during your opponent's next turn/.test(t)) return "nextTurn";
  return "turn";
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
function parseConditionClause(clause: string, allowBare = false): { cond: Cond; subject?: Ref } | null {
  const trimmed = clause.toLowerCase().trim();
  // "During your turn" is a condition too, and reads as one everywhere else in
  // the text. The delay phrases ("during your opponent's *next* turn") are
  // matched before this is reached, so they are not caught here.
  const t = trimmed.replace(/^(?:if|when|while|during)\s+/, "");
  // "if your Leader Card is yellow and your life is at 4 or less" splits on the
  // "and", so the second half arrives without a condition word in front of it.
  // It only counts as a condition when it continues one (9-1-3).
  if (t === trimmed && !allowBare) return null;
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

  const counted = parseCountCondition(t);
  if (counted) return { cond: counted };
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
function connective(clause: string): "skip" | "ifDone" | null {
  const t = clause.toLowerCase().replace(/[.,]$/, "").trim();
  if (/^(?:if you do|if so|if you did)$/.test(t)) return "ifDone";
  if (/^(?:additionally|then|so|and|also|after that|in addition)$/.test(t)) return "skip";
  // Reminders that restate a rule the engine already applies.
  if (/^flip (?:this card|it) (?:over|onto its back)$/.test(t)) return "skip";
  if (/^(?:you can't activate|this skill can only be activated|this card can't be played)/.test(t)) return "skip";
  // "You can activate this card's [Counter] skill from your hand" is where a
  // [Counter] skill is activated from anyway (4-3), so the sentence adds
  // nothing. The forms that *change* the cost are not this, and are left alone.
  if (/^you (?:can|may) activate this card's \[counter\][a-z: ]*skill from your hand$/.test(t)) return "skip";
  if (/^when you activate this card's \[counter\][a-z: ]*skill$/.test(t)) return "skip";
  return null;
}

/** Try to read one clause. Returns null when the wording is not understood. */
function compileClause(clause: string, c: Ctx): Op[] | null {
  const t = clause
    .toLowerCase()
    .trim()
    .replace(/^(?:you may|you can|the player may)\s+/, "");
  let m: RegExpExecArray | null;

  // Draw (5-1). "You may draw" is treated as taken: declining never helps.
  if ((m = /^draw (\d+) cards?$/.exec(t))) return [{ op: "draw", n: Number(m[1]) }];
  if ((m = /^your opponent draws (\d+) cards?$/.exec(t))) return [{ op: "draw", n: Number(m[1]), side: "opponent" }];

  // Discard (20-7).
  if ((m = /^your opponent discards (\d+) cards?(?: from their hand)?$/.exec(t))) return [{ op: "discard", n: Number(m[1]), side: "opponent" }];
  if ((m = /^discard (\d+) cards?(?: from your hand)?$/.exec(t))) return [{ op: "discard", n: Number(m[1]) }];
  if ((m = /^your opponent chooses (\d+) cards? (?:in|from) their hand$/.exec(t))) return [{ op: "discard", n: Number(m[1]), side: "opponent" }];
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
  if ((m = /^place (?:up to )?(\d+) cards? from the top of your deck in (?:your |its owner's |the )?drop(?: area)?$/.exec(t))) return [{ op: "mill", n: Number(m[1]) }];
  if (/^add the top card of your deck to your life$/.test(t)) return [{ op: "addLife", n: 1 }];
  if ((m = /^add cards from your life to your hand until you have (\d+) life(?: left)?$/.exec(t))) return [{ op: "lifeDownTo", n: Number(m[1]) }];
  if (/^place the (?:remaining|rest of the) cards at the bottom of your deck(?: in any order)?$/.test(t))
    return [{ op: "moveTo", target: { sel: { fromVar: "looked" } }, to: "deck", position: "bottom" }];
  // "The rest" is whatever is left of the cards just looked at.
  if (/^place the rest in (?:your |the )?drop(?: area)?$/.test(t)) return [{ op: "moveTo", target: { sel: { fromVar: "looked" } }, to: "drop", reveal: true }];
  if (/^shuffle your deck(?: if you looked through it| afterwards?)?$/.test(t)) return [{ op: "shuffle" }];
  if ((m = /^look at (?:up to )?(\d+) cards? from the top of your deck$/.exec(t))) return [{ op: "look", n: Number(m[1]), as: "looked" }];

  // Cost reduction on a [Permanent] skill (9-1-3-3, 20-21).
  if ((m = /^reduce the energy cost of (.+?) (?:in your hand |in your z-deck )?by (\d+)$/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "costReduction", target: ref, amount: Number(m[2]) }] : null;
  }

  // Energy markers (5-14).
  if ((m = /^place (\d+) energy markers? in your energy(?: area)?$/.exec(t))) return [{ op: "energyMarker", n: Number(m[1]) }];

  // Power and combo power (9-9). Cards say both "gets" and "gains".
  if ((m = /^(.*?) (?:gets?|gains?) ([+-]\d+) combo power\b/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "comboPower", target: ref, amount: Number(m[2]), until: durationOf(t) }] : null;
  }
  // "It loses -5000 power" and "it loses 5000 power" both mean the same thing;
  // the sign on the card is decoration, the verb is what counts.
  if ((m = /^(.*?) loses ([+-]?\d+) power\b/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "power", target: ref, amount: -Math.abs(Number(m[2])), until: durationOf(t) }] : null;
  }
  if ((m = /^(.*?) (?:gets?|gains?) ([+-]\d+) power\b/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "power", target: ref, amount: Number(m[2]), until: durationOf(t) }] : null;
  }

  // Granting keyword skills (20-18); one clause can grant several.
  if ((m = /^(.*?) gains? ((?:\[[^\]]+\][\s,]*(?:and\s+)?)+)/.exec(t))) {
    const ref = refFor(m[1], c);
    const kws = [...m[2].matchAll(/\[([^\]]+)\]/g)].map((x) => keywordOf(x[1]));
    if (!ref || !kws.length || kws.some((k) => !k)) return null;
    const until = durationOf(t);
    return kws.map((k) => ({ op: "grant", target: ref, keyword: k!, until }) as Op);
  }
  // A trailing fragment of such a list, left over from splitting on "and".
  if ((m = /^((?:\[[^\]]+\][\s,]*(?:and\s+)?)+)(?:for the|$)/.exec(t)) && c.lastTarget) {
    const kws = [...m[1].matchAll(/\[([^\]]+)\]/g)].map((x) => keywordOf(x[1]));
    if (kws.length && kws.every((k) => k)) {
      const until = durationOf(t);
      return kws.map((k) => ({ op: "grant", target: c.lastTarget!, keyword: k!, until }) as Op);
    }
  }

  // Negation (9-1).
  if (/^negate the attack$/.test(t)) return [{ op: "negateAttack" }];
  if ((m = /^negate (.*?)(?:'s)? skills\b/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "negateSkills", target: ref, until: durationOf(t) }] : null;
  }

  // Prohibitions (20-14). 0-2-5: they beat instructions, so the engine checks
  // them last; here we only have to say precisely what is forbidden to whom.
  if (/\bcan'?t\b|\bcannot\b/.test(t)) {
    const forbid = compileProhibition(t, c);
    if (forbid) return forbid;
  }

  // Mode switches (1-10).
  if ((m = /^switch (.*?) to (active|rest) mode$/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "switchMode", target: ref, mode: m[2] as "active" | "rest" }] : null;
  }

  // KO (5-12).
  if ((m = /^ko (.+)$/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "ko", target: ref }] : null;
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

  // Area moves (3-1).
  const MOVES: [RegExp, ScriptArea, { position?: "top" | "bottom"; mode?: "active" | "rest"; reveal?: boolean }][] = [
    [/^place (.+?) (?:in|into) (?:its owner'?s?|their|your|the) drop(?: area)?$/, "drop", { reveal: true }],
    [/^place (.+?) at the bottom of (?:its owner'?s?|their|your) deck$/, "deck", { position: "bottom" }],
    [/^place (.+?) on top of (?:its owner'?s?|their|your) deck$/, "deck", { position: "top" }],
    [/^return (.+?) to (?:its|their) owner'?s? hand$/, "hand", {}],
    [/^return (.+?) to (?:your|their) hand$/, "hand", {}],
    [/^add (.+?) to your hand$/, "hand", {}],
    [/^send (.+?) to (?:your|their|its owner'?s?) warp$/, "warp", {}],
    [/^(?:add|place) (.+?) (?:to|in) your energy in rest mode$/, "energy", { mode: "rest", reveal: true }],
    [/^(?:add|place) (.+?) (?:to|in) your energy(?: area)?$/, "energy", { reveal: true }],
    [/^add (.+?) to your life$/, "life", {}],
    [/^remove (.+?) from the game(?: instead)?$/, "removed", {}],
  ];
  for (const [re, to, opts] of MOVES) {
    if ((m = re.exec(t))) {
      const ref = refFor(m[1], c);
      return ref ? [{ op: "moveTo", target: ref, to, ...opts }] : null;
    }
  }

  // Playing a card by a skill (5-5-3).
  if ((m = /^play (.+)$/.exec(t))) {
    if (/token/.test(t)) return compileToken(clause, c);
    const ref = refFor(m[1], c);
    if (!ref) return null;
    if ("sel" in ref) {
      // "play up to 1 X from your hand" is a choice followed by the play.
      const v = `p${c.n++}`;
      return [
        { op: "choose", sel: ref.sel, as: v, reason: clause },
        { op: "play", target: { var: v } },
      ];
    }
    return [{ op: "play", target: ref }];
  }

  // Choosing (5-2). Late, because many clauses open with "choose" plus an action.
  if (/^choose /.test(t)) {
    const sel = parseTarget(clause);
    if (!sel) return null;
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
  const m = /^(.*?)\s+(?:can'?t|cannot)\s+(.*)$/.exec(t);
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
  const m = /choose one\s*(?:[-–—―?:]{1,2})?\s*/i.exec(text);
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
  const c: Ctx = { last: null, lastTarget: null, n: 0, raw: skill.effect };
  const modal = splitModal(text);
  const clauses = splitClauses(modal ? modal.head : text);
  // An [Auto] skill restates its own trigger ("When this card attacks, draw 1
  // card"); by the time the effect resolves the trigger has already fired, so
  // that clause is dropped. A leading "if …" is a condition, not a trigger, and
  // stays — it must compile or the skill goes to the referee.
  if (skill.kind === "auto" && (clauses.length > 1 || modal) && /^(?:when|at the (?:end|beginning|start))\b/i.test(clauses[0] ?? "")) {
    const trigger = clauses.shift()!;
    // The dropped trigger is still what the sentence is about: "When this card
    // is sent to the Warp …, add **it** to your hand" means this card. Without
    // this, the first "it" of an [Auto] has nothing to point at and the whole
    // skill goes to the referee.
    if (/\bthis card\b/i.test(trigger)) c.lastTarget = { sel: { special: "self" } };
  }

  const ops = compileClauseList(clauses, c, unsupported);
  if (modal) {
    // Each option is compiled on its own, carrying what the head established
    // ("If your Leader is a <Baby> card, it gets +10000 power, then choose
    // one— ・…" — "it" still means the leader inside the options).
    const modes = modal.options.map((option) => ({ label: option, ops: compileClauseList(splitClauses(option), { ...c }, unsupported) }));
    if (modes.some((mode) => mode.ops.length)) ops.push({ op: "chooseMode", modes });
  }
  return { ops, unsupported };
}

/** The clause loop, shared by a skill's body and by each modal option. */
function compileClauseList(clauses: string[], c: Ctx, unsupported: string[]): Op[] {
  // "if you do" (20-16) makes the rest conditional on the previous choice, and
  // a run of conditions all have to hold, so a group carries a list of them.
  type Group = { conds: Cond[]; ops: Op[]; delay?: { at: DelayTiming; scope: DelayScope; label: string } };
  const groups: Group[] = [{ conds: [], ops: [] }];
  const push = (ops: Op[]) => groups[groups.length - 1].ops.push(...ops);
  for (const clause of clauses) {
    const conn = connective(clause);
    if (conn === "skip") continue;
    if (conn === "ifDone") {
      groups.push({ conds: c.last ? [{ kind: "chose", var: c.last }] : [], ops: [] });
      continue;
    }
    // "ignoring [Barrier]" lifts 22-16 for the choice just made (22-16, 20-4).
    if (/^ignoring \[barrier\]$/i.test(clause.trim())) {
      const lastChoose = [...groups.flatMap((g) => g.ops)].reverse().find((o) => o.op === "choose");
      if (lastChoose && lastChoose.op === "choose") lastChoose.sel.ignoreBarrier = true;
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
        for (const o of got) {
          if (o.op === "choose") {
            c.last = o.as;
            c.lastTarget = { var: o.as };
          } else if ("target" in o && o.target) c.lastTarget = o.target;
        }
        push([{ op: "delay", at: trailing.at, scope: trailing.scope, ops: got, label: trailing.label }]);
        continue;
      }
      unsupported.push(clause);
      continue;
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
    const got = compileClause(clause, c);
    if (!got) {
      unsupported.push(clause);
      continue;
    }
    for (const o of got) {
      if (o.op === "choose") {
        c.last = o.as;
        c.lastTarget = { var: o.as };
      } else if ("target" in o && o.target) c.lastTarget = o.target;
    }
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
};

function describeSelector(sel: Selector): string {
  if (sel.special) return { self: "this card", attacker: "the attacking card", guard: "the guard card", subject: "that card", leader: "your leader", opponentLeader: "the opposing leader" }[sel.special];
  const who = sel.side === "opponent" ? "opponent's " : sel.side === "both" ? "each player's " : "your ";
  const n = sel.count === 99 ? "all" : sel.upTo ? `up to ${sel.count}` : `${sel.count}`;
  const where = sel.fromVar ? "of the cards looked at" : `in ${who}${sel.area}`;
  return `${n} ${where}`;
}

function describeRef(ref: Ref): string {
  return "var" in ref ? "the chosen cards" : describeSelector(ref.sel);
}

function describeAmount(a: Amount): string {
  return typeof a === "number" ? `${a}` : "var" in a ? "that many" : "one per matching card";
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
      case "ko":
        parts.push(`KO ${describeRef(op.target)}`);
        break;
      case "moveTo":
        parts.push(`move ${describeRef(op.target)} to ${op.to}`);
        break;
      case "play":
        parts.push(`play ${describeRef(op.target)}`);
        break;
      case "switchMode":
        parts.push(`switch ${describeRef(op.target)} to ${op.mode} mode`);
        break;
      case "power":
        parts.push(`${describeRef(op.target)} ${(op.amount as number) >= 0 ? "+" : ""}${op.amount} power for the ${op.until}`);
        break;
      case "comboPower":
        parts.push(`${describeRef(op.target)} ${(op.amount as number) >= 0 ? "+" : ""}${op.amount} combo power for the ${op.until}`);
        break;
      case "grant":
        parts.push(`${describeRef(op.target)} gains [${(op.keyword as KeywordSkill).name}] for the ${op.until}`);
        break;
      case "negateSkills":
        parts.push(`negate the skills of ${describeRef(op.target)} for the ${op.until}`);
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
        parts.push(`${describeRef(op.target)} costs ${op.amount} less`);
        break;
      case "negateAttack":
        parts.push("negate the attack");
        break;
      case "if":
        parts.push(`if a condition holds: ${describeScript(op.then)}`);
        break;
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
