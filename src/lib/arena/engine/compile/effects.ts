import { keywordOf, orbsIn } from "../cards";
import { parseFilter } from "../filters";
import type { Amount, Cond, Duration, Op, Ref, Selector, Side, ScriptArea } from "../script";
import type { DelayScope, DelayTiming, SkillKindPrefix } from "../types";
import { parseConditionClause } from "./conditions";
import { TWO_NAMED_CARDS } from "./clauses";
import { altCostHow, counterAltCost, orbsToList } from "./prices";
import type { Ctx } from "./shared";
import { countWord } from "./shared";
import { AREA_WORDS, filterFor, parseTarget } from "./targets";

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
  const what = markersOn ? markersOn[1] : counted;
  // "For each marker on **it**" (P-377, P-378, DB3-144): the pronoun the
  // sentence has been using for the card all along. `parseTarget` reads "this
  // card" and not the bare pronoun, and teaching it the pronoun would change
  // every clause that ends in "it"; here the phrase is already known to be
  // what is *counted*, so the reading is safe and stays local.
  const sel = /^(?:it|this card)$/.test(what) ? ({ special: "self" } as Selector) : (parseTarget(what) ?? energyYouHave(what));
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
 * "For each 1 energy you have" (TB1-038, BT1-030 twice): the energy area,
 * counted one card at a time. `parseTarget` reads "cards in your energy" but
 * not this shape, where the noun is the area itself and the "1" is the size of
 * each step rather than a multiplier.
 *
 * Any other number would mean *dividing* the count, which no amount can do, so
 * "for each 2 energy" is left unread rather than read as this.
 */
function energyYouHave(counted: string): Selector | null {
  const m = /^(?:(\d+) )?energy (you have|your opponent has)$/.exec(counted);
  if (!m || (m[1] !== undefined && m[1] !== "1")) return null;
  return { side: m[2] === "you have" ? "you" : "opponent", area: "energy" };
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
  // 20-5: "Draw X cards" — the X the price was paid at, read off the frame the
  // activation bound it on. Only when the price charges one: a program that
  // says `X` with nothing to bind it throws where it resolves, and the honest
  // gap it would replace is the better answer (DB3-138's "{u}(X)" is a price
  // notation this compiler does not read).
  if (c.xBound && /^draw x cards?$/.test(t)) return [{ op: "draw", n: { x: true } }];
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
    if ((mSkill = /^(?:(?:your|their|the)\s+)?\[([a-z0-9:\- /]+)\] skills? (?:on|of) (.+)$/i.exec(raw))) {
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
  qq = qq.replace(/\bactivation costs?\b/gi, "skill cost");
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
    return [{ op: "costReduction", target: ref, amount: by, ...what, ...(skillKind ? { skillKind } : {}), ...(orbs ? { colors: orbsToList(orbs) } : {}), until: durationOf(clause) }];
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
  if (/\bcan only\b|\bcan'?t\b|\bcannot\b|\bwill not\b|\bwon'?t\b/.test(t)) {
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
  const q = stripQualifiers(t);
  const counted = /^(you|your opponent'?s?)\s+can only attack one more time(?: with (.*?))?(?:\s+(?:for|during|until)\b.*)?$/.exec(q);
  if (counted) {
    const side: Side = counted[1] === "you" ? "you" : "opponent";
    const withWhat = counted[2];
    const filter = withWhat ? filterFor(withWhat, null) : undefined;
    if (filter === null) return null;
    const type = withWhat && /\bleader cards?\b/.test(withWhat) ? "LEADER" : withWhat && /\bbattle cards?\b/.test(withWhat) ? "BATTLE" : null;
    return [{ op: "forbid", what: "attack", side, until, uses: 1, filter: filter || type ? { ...(filter ?? parseFilter("")), ...(type ? { type } : {}) } : undefined }];
  }
  // The subject may be missing: "it gets +10000 power **and** can't attack for
  // the turn" splits at the "and", and the second half arrives with the card
  // it is about in the clause before it. Fifteen clauses.
  const m = /^(.*?)\s*(?:can'?t|cannot|will not|won'?t)\s+(.*)$/.exec(t);
  if (!m) return null;
  const subject = m[1].trim();
  const rest0 = m[2].trim();
  const unlessTail = /\s+unless\s+(.+)$/.exec(rest0);
  const unlessPlayBySkill = !!unlessTail && /^(?:it is |it's )?played by (?:card )?skills?$/.test(unlessTail[1].trim());
  const unless = !unlessTail || unlessPlayBySkill ? null : parseConditionClause(`if ${unlessTail[1].trim()}`, true);
  if (unlessTail && !unlessPlayBySkill && !unless) return null;
  const rest = unlessTail && !unlessPlayBySkill ? rest0.slice(0, unlessTail.index).trim() : rest0;
  const withUnless = unless ? { unless: unless.cond } : {};

  // Deck-building restrictions are not rules of play (6-1); the engine takes
  // the deck it is given, so the clause is read and does nothing.
  if (/^include\b/.test(rest)) return [];

  const side: Side | null = /^you$/.test(subject) ? "you" : /^your opponent$/.test(subject) ? "opponent" : null;

  // A sentence about a player: what follows names the cards it is about.
  if (side) {
    let mm: RegExpExecArray | null;
    if ((mm = /^play\s+(.*)$/.exec(rest))) {
      const what = mm[1];
      if (/\bcopies of this card\b|\banother copy of this card\b/.test(what)) return [{ op: "forbid", what: "play", side, until, sameNameAsSelf: true, ...withUnless }];
      if (/^this card\b/.test(what)) return [{ op: "forbid", what: "play", side, until, target: { sel: { special: "self" } }, ...withUnless }];
      const filter = filterFor(what, null);
      const type = /\bunison cards?\b/.test(what) ? "UNISON" : /\bextra cards?\b/.test(what) ? "EXTRA" : /\bbattle cards?\b/.test(what) ? "BATTLE" : null;
      // A description that could not be read must not fall back to the type
      // alone: "you can't play Battle Cards with [X]" would ban every Battle
      // Card, which is a wider rule than the card states.
      if (filter === null) return null;
      if (!filter && !type) return null;
      return [{ op: "forbid", what: "play", side, until, filter: { ...(filter ?? parseFilter("")), ...(type ? { type } : {}) }, ...withUnless }];
    }
    if (/^attack\b/.test(rest)) {
      // "attack this card" is about the defender, not the attacker.
      if (/^attack (?:this card|it)\b/.test(rest)) return [{ op: "forbid", what: "beAttacked", until, target: { sel: { special: "self" } }, ...withUnless }];
      const withWhat = /\bwith (.*)$/.exec(rest)?.[1];
      const filter = withWhat ? filterFor(withWhat, null) : undefined;
      // Same again: an unread description would forbid every attack rather
      // than the ones the card names.
      if (filter === null) return null;
      const type = withWhat && /\bleader cards?\b/.test(withWhat) ? "LEADER" : withWhat && /\bbattle cards?\b/.test(withWhat) ? "BATTLE" : null;
      return [{ op: "forbid", what: "attack", side, until, filter: filter || type ? { ...(filter ?? parseFilter("")), ...(type ? { type } : {}) } : undefined, ...withUnless }];
    }
    if (/^activate\b/.test(rest) && /\[counter/.test(rest)) return [{ op: "forbid", what: "activateCounter", side, until, ...withUnless }];
    if (/^activate\b/.test(rest) && /\[blocker/.test(rest)) return [{ op: "forbid", what: "block", side, until, ...withUnless }];
    // "You can't place cards in your energy for the turn" (EX22-02): the
    // Charge Phase, which the engine offers as an action of its own (3-8).
    if (/^place cards? (?:in|into) (?:your|their) energy\b/.test(rest)) return [{ op: "forbid", what: "placeEnergy", side, until, ...withUnless }];
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
      return [{ op: "forbid", what: "play", until: "game", target, bySkill: false, ...withUnless }];
    }
    if (/\b(?:by|with) (?:your |their )?(?:card )?skills?\b/.test(rest)) {
      return [{ op: "forbid", what: "play", until: "game", target, bySkill: true, ...withUnless }];
    }
    return null;
  }
  if (/^attack\b/.test(rest)) return [{ op: "forbid", what: "attack", until, target, ...withUnless }];
  if (/^be attacked\b/.test(rest)) return [{ op: "forbid", what: "beAttacked", until, target, ...withUnless }];
  if (/^block\b/.test(rest)) return [{ op: "forbid", what: "block", until, target, ...withUnless }];
  if (/^(?:switch|be switched)\b.*\bactive mode\b/.test(rest)) return [{ op: "forbid", what: "switchToActive", until, target, ...withUnless }];
  if (/^be ko'?d\b/.test(rest)) {
    // "by skills" is the narrow rule; a bare "can't be KO'd" covers the battle too.
    const bySkill = /\bby (?:your opponent's |your )?skills?\b/.test(rest);
    return [{ op: "forbid", what: bySkill ? "beKOdBySkill" : "beKOd", until, target, side: bySide, ...withUnless }];
  }
  if (/^be chosen\b/.test(rest)) return [{ op: "forbid", what: "beChosen", until, target, side: bySide, ...withUnless }];
  // "Can't be removed from a Battle Area by your opponent's skills" (20-14) —
  // a move by a skill, which is not the same as a KO and not the same as a
  // battle. Only the form that names skills as the cause is read: a bare
  // "can't be removed from a Battle Area" would also cover the KO.
  if (/^be removed from (?:a|the|your|their) battle area\b/.test(rest) && /\bby (?:your opponent's |your )?skills?\b/.test(rest)) {
    return [{ op: "forbid", what: "beMovedBySkill", until, target, side: bySide, ...withUnless }];
  }
  // "This card's skills can't be negated in any area" (9-1-5). `durationOf`
  // already reads "in any area" as the game.
  if (/^be negated\b/.test(rest) && /\bskills?\b/.test(subject)) {
    const owner = refFor(subject.replace(/'?s skills?\b.*$/, ""), c);
    return owner ? [{ op: "forbid", what: "beNegated", until, target: owner, ...withUnless }] : null;
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

/**
 * "Choose one— ・A ・B" (20-2). The options are printed on their own lines and
 * `skillLines` has already folded them back onto the line that introduces
 * them, so here they are separated by bullets in one string.
 */
export function splitModal(text: string): { head: string; options: string[] } | null {
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

export function holdForGame(ops: Op[]): Op[] {
  return ops.map((o) => {
    if (o.op === "if") return { ...o, then: holdForGame(o.then), ...(o.else ? { else: holdForGame(o.else) } : {}) };
    if (o.op === "chooseMode") return { ...o, modes: o.modes.map((m) => ({ ...m, ops: holdForGame(m.ops) })) };
    if ("until" in o && o.until !== undefined && o.op !== "negateOwnSkill") return { ...o, until: "game" as const };
    return o;
  });
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
export function compileClauseList(clauses: string[], c: Ctx, unsupported: string[]): Op[] {
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
