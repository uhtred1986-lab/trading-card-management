import { keywordOf, orbsIn } from "../text/cards";
import { playTaxWording } from "../text/play-tax";
import { emptyFilter, expandSharedCardDescription, parseFilter, type CardFilter } from "../text/filters";
import type { Amount, Cond, Duration, Op, Ref, Selector, Side, ScriptArea } from "../vm/script";
import { taxPowerOnSelf } from "../vm/activation-price-support";
import type { Color, DelayScope, DelayTiming, KeywordSkill, SkillKindPrefix } from "../types";
import { parseConditionClause } from "./conditions";
import { compileDisjointMove } from "./disjoint";
import { compileNamedSet } from "./named-set";
import { compileUnionNameSearch } from "./union-name-search";
import { compileOpponentChoice } from "./opponent-choice";
import { opponentChoiceWords } from "./opponent-choice-shape";
import { TWO_NAMED_CARDS } from "./clauses";
import { altCostHow, counterAltCost, orbsToList } from "./prices";
import type { Ctx } from "./shared";
import { PLACED_UNDER_PLACEHOLDER, SAME_CHARACTER_AS_PLACED, SWITCHED_BY_THIS_SKILL, countWord } from "./shared";
import { AREA_WORDS, EACH_COUNT, countAreasSaidWithAnd, SUMMED_COUNT, SUM_UNREAD, colorCountSelector, filterFor, parseTarget, selfFrom } from "./targets";
import { unreadFilterWords } from "../lang/filter-words";

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

/** BT30-084's filter phrase (2-3-2): a card whose name is written in {} in a skill of the chosen card. */
const NAME_IN_SKILL_TEXT = /\s+whose card name is in the text of an? skill on the chosen card/i;

/**
 * The card a play lands "on top of" (23-2). A choice that an earlier clause put
 * *under* another choice is a passenger in that pile, never a host: "put an
 * Android under the chosen Cell ... play a Cell on top of the (originally)
 * chosen card" (BT31-139) means the Cell, though the Android was chosen after
 * it and is what "the chosen card" or "it" would otherwise find. Followed to
 * the root of the pile. "Originally chosen" is the same card said explicitly:
 * the earliest choice that is not itself a passenger.
 */
function hostOf(phrase: string, c: Ctx): Ref | null {
  let ref: Ref | null;
  if (/\boriginally\b/i.test(phrase)) {
    const first = c.choices.find((ch) => !c.underHost?.[ch.var]);
    ref = first ? { var: first.var } : null;
  } else ref = refFor(phrase, c);
  let guard = 0;
  while (ref && "var" in ref && c.underHost?.[ref.var] && guard++ < 8) ref = { var: c.underHost[ref.var] };
  return ref;
}

/**
 * "Return **the card sent to the Warp by this skill** to its owner's hand"
 * (BT13-024..026), "add the card that was sent to your Warp by this skill"
 * (EX02-03), "return all cards sent to the Warp with this skill" (TB1-008),
 * "play any cards sent to a Warp by this skill" (BT13-135, BT14-141): the cards
 * this skill's own effect sent to a Warp (`Ctx.sentToWarp`), and only while they
 * are still there — a delayed step that finds one gone finds nothing (3-1-4).
 */
const SENT_TO_WARP_BY_THIS_SKILL = /^(?:(?:all (?:of )?|any )?the cards? (?:that (?:was|were) )?|(?:all|any) (?:of the )?cards (?:that were )?)sent to (?:the|a|your|their|its owner'?s|their owners?'?s?) warps? (?:by|with) this skill(?: from (?:your|the) warp)?$/i;

function refFor(clause: string, c: Ctx): Ref | null {
  if (SENT_TO_WARP_BY_THIS_SKILL.test(clause.trim())) return c.sentToWarp ? { sel: { fromVar: c.sentToWarp, area: "warp" } } : null;
  // #907 round 4 (P-440, BT25-099b): "a card with the same name as **the chosen card**" names ANOTHER card by
  // the chosen one's name. The pronoun test below took the "chosen card" for the target and the skill moved
  // (P-440) or played (BT25-099b) the card it had chosen only to compare with. No selector says "the same
  // name as", so it is refused, the same as `parseTarget`'s "as the card you placed".
  if (/\bsame (?:colou?r and )?(?:character )?names? as (?:the chosen cards?|that card|the card you (?:placed|chose))\b/i.test(clause)) return null;
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
  // "The card this card attacked" (BT19-035b, #1005): the pronoun is the
  // subject of a relative clause, and the phrase names the other end of the
  // battle. The mention test below took it for "this card".
  if (/^\s*(?:the |that )?(?:battle |leader |unison )?cards? (?:that )?this card (?:attacked|is attacking|has attacked)\s*$/i.test(mentions)) return { sel: { special: "guard" } };
  if (/^\s*(?:the |that )?(?:battle |leader |unison )?cards? that (?:attacked|is attacking|has attacked) this card\s*$/i.test(mentions)) return { sel: { special: "attacker" } };
  // 9-1-3-2: "play this card from your hand" keeps the area it names (`selfFrom`).
  if (/\bthis card\b(?!'s)/i.test(mentions) || /\bthis card's\b/i.test(headOf(mentions))) return { sel: selfFrom(mentions) };
  // "…play up to 1 card from under this card, and place this card under the
  // played card": the card this skill just played, if it played one; otherwise
  // the card the trigger was about ("When you play a <Goku> card, …").
  // #930, BT26-088: "…play **the revealed card** on top of this card": the
  // one card the skill's reveal bound (and nothing when it revealed none).
  // The whole phrase only; "the revealed card's energy cost" is a measure.
  if (/^\s*the revealed card\s*$/i.test(clause) && c.lastSeen) return { var: c.lastSeen };
  if (/\bthe played card\b|\bthe card (?:that was |you )?played(?: with this skill)?\b/i.test(clause)) {
    if (c.lastPlayed) return { var: c.lastPlayed };
    return c.last ? { var: c.last } : { sel: { special: "subject" } };
  }
  // "The card that was switched to Hidden Mode by this skill": the card the
  // price switched (BT28-121), or nothing to point at when the price chose none.
  if (SWITCHED_BY_THIS_SKILL.test(clause)) {
    const named = c.priceChoice ?? c.switchedHere;
    return named ? { var: named } : null;
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
    // Phrasing batch 3: "Choose 1 other ≪Namekian≫ card in your Battle Area: Place this card under **the chosen
    // Battle Card**" (TB3-058, TB3-059): the card type names nothing the one choice made did not, so with one choice
    // it is that one, as "the chosen card" is.
    if (/\bthe chosen (?:battle|unison|leader) cards?\b/i.test(clause) && c.choices.length <= 1 && c.last) return { var: c.last };
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

/**
 * The card a skill is copied *from* (20-18).
 *
 * `refFor` answers "the chosen card" with the last thing any clause acted on
 * when no choice was made — which is right for an instruction ("…and KO it")
 * and wrong here. BT14-062 prints "Place up to 1 Battle Card … in your
 * opponent's Drop Area under this card. Choose up to 1 of **the chosen
 * card's** keyword skills": the fallback hands back the *move's* selector,
 * still pointing at the opponent's Drop, and the card whose skill is meant has
 * just left it. A copy off the wrong card is worse than a clause left to the
 * referee, so a "chosen" phrase with nothing bound is refused.
 */
function copiedFrom(phrase: string, c: Ctx): Ref | null {
  const ref = refFor(phrase, c);
  if (ref && /\bchosen\b/i.test(phrase) && !("var" in ref)) return null;
  return ref;
}

function refsFor(phrase: string, c: Ctx): Ref[] | null {
  const parts = phrase
    .split(/\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  // "multicolor <Pan> cards **and** multicolor Battle Cards with <GT> in their
  // character names **in all of your areas**" (BT25-098): the area at the end
  // belongs to every description in the list, and each description keeps its
  // own filter. Two selectors, one per description (#907).
  const sharedTail = parts.length > 1 ? /\s+(in all of your areas)$/i.exec(parts[parts.length - 1]) : null;
  if (sharedTail && parts.slice(0, -1).every((p) => /\bcards?$/i.test(p) && !/\b(?:in|from) (?:all of )?(?:your|their)\b/i.test(p))) {
    const out: Ref[] = [];
    for (const part of parts) {
      const r = refFor(/\bin all of your areas$/i.test(part) ? part : `${part} ${sharedTail[1]}`, c);
      if (!r) return null;
      out.push(r);
    }
    return out;
  }
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

/**
 * #1123 (owner ruling 25 Oct 2026, 23-2): "place 1 card from your hand under
 * **a {Spirit Bomb}** in your Battle Area" (BT20-087) names the host by a
 * description, and a counted description is a choice like any other target
 * (`withChoice`): the player picks which matching card the pile grows on. The
 * interpreter takes a selector host only when it matches one card, so the move
 * is handed the chosen card. A host the text names exactly ("this card", "your
 * Leader", a card already chosen) is no description and stays as it is.
 */
function hostChoice(host: Ref, clause: string, c: Ctx): { ops: Op[]; host: Ref } {
  if ("sel" in host && !host.sel.special && host.sel.take == null && host.sel.count != null && host.sel.count < 99) {
    const v = `c${c.n++}`;
    return { ops: [{ op: "choose", sel: host.sel, as: v, reason: clause }], host: { var: v } };
  }
  return { ops: [], host };
}

/**
 * The move of a target under a host, each chosen when the words count it: the
 * card going under first, then its host, in the order the sentence says them.
 */
function placeUnderOps(ref: Ref, named: Ref, clause: string, c: Ctx): Op[] {
  const target = withChoice(ref, clause, c, (t) => ({ op: "moveTo", target: t, to: "under" }));
  const move = target.pop() as Extract<Op, { op: "moveTo" }>;
  const { ops: chooseHost, host } = hostChoice(named, clause, c);
  return [...target, ...chooseHost, { ...move, under: host }];
}

/**
 * Phrasing batch 4 (owner's approval of 26 Oct 2026): "its **non-keyword** skills negated" — the card's [Auto],
 * [Activate] and [Permanent] skills, one `negateSkillsOfKind` each; its keyword skills (22-1-1), [Counter] among them
 * (9-7-1), go on working.
 */
const NON_KEYWORD_KINDS: SkillKindPrefix[] = ["auto", "activate", "permanent"];
function negateNonKeyword(target: Ref, until: Duration): Op[] {
  return NON_KEYWORD_KINDS.map((kind) => ({ op: "negateSkillsOfKind", target, kind, until }));
}
/**
 * Phrasing batch 5 (owner's ruling of 26 Oct 2026 on P-327): "its **keyword** skills negated" — the inverse split:
 * every keyword skill of the card (22-1-1), printed or granted (`negateSkillsOfKind` kind `keyword`), and its
 * [Counter] skills, which are keyword skills too (9-7-1). Its [Auto], [Activate] and [Permanent] skills go on working.
 * It used to read as every skill negated.
 */
function negateKeywordSkills(target: Ref, until: Duration): Op[] {
  return (["keyword", "counter"] as const).map((kind) => ({ op: "negateSkillsOfKind", target, kind, until }));
}
/** Which half of a card's skills a "…(non-)keyword skills negated" names, as the ops that negate it. */
function negateHalf(half: string, target: Ref, until: Duration): Op[] {
  return /^non-/.test(half) ? negateNonKeyword(target, until) : negateKeywordSkills(target, until);
}

function durationOf(clause: string): Duration {
  const t = clause.toLowerCase();
  // "…and it can't activate skills while this card is in a Battle Area"
  // (BT29-041, BT29-042): trailing an [Auto] or [Activate] effect, the effect
  // lasts as long as the card that made it stays in a Battle Area. Only the
  // trailing form: a [Permanent]'s "While this card is in …, …" leads its
  // sentence and is a condition, read as one before any clause gets here.
  if (/\bwhile this card is in (?:a|the|your) battle area\.?$/.test(t)) return "whileSourceInPlay";
  if (/for the (?:duration of (?:the|this) )?battle|during this battle/.test(t)) return "battle";
  // "…for the rest of the game" (P-496, prohibition batch 6) is the game too.
  if (/for the (?:duration of (?:the|this) |rest of the |remainder of the )?game|during the game|in any area|in all areas/.test(t)) return "game";
  if (/until (?:the start of )?your opponent's next turn/.test(t)) return "opponentTurn";
  // "Until the start of your next Main Phase" (BT13-012, #1163): through the
  // opponent's turn and your Charge Phase, ending as your Main Phase begins.
  // Read before the catch-all "for the turn", which ended it a whole turn early.
  if (/until the (?:start|beginning) of your next main phase/.test(t)) return "nextMain";
  // Your *own* next Charge Phase is one step past "your next turn": the effect
  // has to be there when the Active Step runs (7-2-7).
  if (/during your next charge phase/.test(t)) return "afterNextCharge";
  // This phase belongs to the *opponent of the skill's controller*, even if
  // the locked card changes controller before it. It ends after that phase's
  // Active Step or as soon as the phase is skipped (20-13-5).
  if (/during your opponent's next charge phase/.test(t)) return "afterOpponentCharge";
  // Everything that has to survive the opponent's whole turn and end as yours
  // begins: the rest-lock wordings, which are the same duration said four ways.
  // "For the duration of your opponent's next turn" (BT6-023) is the same span
  // as "during your opponent's next turn", read the same way.
  if (/until the end of your opponent's(?: next)? turn|until the (?:start|beginning) of your next turn|during your opponent's next turn|for the duration of your opponent's next turn/.test(t))
    return "nextTurn";
  // "Your opponent can't attack until the end of **their** turn" (BT24-133):
  // the pronoun is the opponent the clause names, so it is the same duration.
  if (/\byour opponent\b/.test(t) && /until the end of their(?: next)? turn/.test(t)) return "nextTurn";
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
/**
 * Ops that are *standing* rather than done: `collectStatics` reads them off a
 * [Permanent] and `exec` does nothing with them. A replacement's substitute is
 * run, not collected, so a program made of these would compile and then be
 * silent — which is the one outcome worse than leaving the clause unread.
 */
const NOT_RUNNABLE = new Set(["replaceLeave", "replace", "gains", "negateKeyword"]);

/**
 * May this program stand in a departure's place (#125)? Only if it really
 * happens when it is run: nothing that merely *stands* — a second replacement,
 * a grant, a negation — because those say what is true rather than what
 * happens, and a departure cannot be replaced by a state of affairs.
 *
 * A question is no longer disqualifying (#107): the two suspendable call sites
 * run the program as a frame on the flow, so it can stop and ask, and
 * `replacementFor` leaves it unapplied at the 46 that cannot wait.
 */
/**
 * "Up to N, one card at a time" (owner's rulings of 20 Oct 2026): `may(step 1)`,
 * then `if did(may): may(step 2)`, … Written flat — each later offer behind its
 * own `if` — because only `may` sets the answer, so a decline ends the chain the
 * same as nesting would, and a chain of five stays inside the validator's depth.
 */
function oneAtATime(steps: Op[][], reason: string): Op[] {
  return steps.flatMap((ops, i): Op[] => {
    const offer: Op = { op: "may", ops, reason };
    return i === 0 ? [offer] : [{ op: "if", cond: { kind: "did", what: "may" }, then: [offer] }];
  });
}

function substitutable(ops: Op[]): boolean {
  return ops.length > 0 && !ops.some((o) => NOT_RUNNABLE.has(o.op));
}

/**
 * An [Auto] that prints its replacement as its "trigger" (BT12-071: "…: When
 * this card would be placed in its owner's Drop Area from a Combo Area, you may
 * play it instead"). Nothing happens at a moment for it to be a trigger of: the
 * clause is the 9-10 `would`, and it has to stay in the program for the
 * replacement that follows it to be read.
 */
export function isComboDropReplacement(clause: string): boolean {
  const from = parseWouldLeave(clause)?.from;
  return from?.length === 1 && from[0] === "combo";
}

function parseWouldLeave(clause: string): { from?: ("battle" | "combo")[]; by?: "skill" | "ko" | "skillOrKo" | "skillOrKoBySkill"; bySide?: "opponent" | "you"; subject?: string } | null {
  const t = clean(clause);
  // "Would … the Battle Area" is the hypothetical phrasing; six cards
  // (BT14-153, BT14-154, BT15-153, BT15-154, BT16-107, BT17-148) print the
  // same rule as an accomplished fact — "if/when this card **is** removed
  // from your Battle Area" — one word short of the modal this opener used to
  // require. Read the same way: "is removed from" carries no cause of its
  // own, so it defaults to "skill" exactly as "would be removed from" does.
  // "By an opponent's skill" is the commonest narrowing of all — 19 cards
  // print it, and until #107 gave `move()` a way to know *whose* skill was
  // moving the card the whole family had to be refused, because a rule read
  // as "by a skill" would have fired on its own controller's too. `bySide`
  // is the difference, and `causeMatches` (`state.ts`) is where it is read.
  const opener =
    /^(?:if|when)?\s*(.*?) (?:would (leave|be removed from|be sent from)|is (removed from)) (?:your |the |a )?battle area( by (?:(a|your|one of your) skills?|(?:an|your|one of your) opponent'?s? skills?))?( or (?:be )?ko'?d)?$/.exec(t);
  if (opener) {
    const verb = opener[2] ?? opener[3];
    // "Removed from a Battle Area by a skill or KO'd" covers both causes;
    // "would leave" covers every cause, so it has no restriction at all.
    // Owner ruling, 26 Oct 2026: a KO by a skill is a removal, so "…removed
    // from the Battle Area **by your opponent's skill**, … instead" answers
    // a skill's KO as well (`skillOrKoBySkill`) — never the battle's.
    // Owner ruling 26 Oct 2026 (A9): a removal with no cause named answers
    // every removal a skill makes and every KO, the battle's included
    // (`skillOrKo`, the reading "…by a skill or KO'd" has).
    const by = verb === "leave" ? undefined : opener[6] ? ("skillOrKo" as const) : opener[4] ? ("skillOrKoBySkill" as const) : ("skillOrKo" as const);
    // The cause was named and it was not one of the player's own skills, so
    // it is the opponent's — the one distinction `by` alone cannot draw.
    // "…by your skill", "…by one of your skills": the card's own controller's.
    const bySide = opener[4] && !opener[5] ? ({ bySide: "opponent" } as const) : opener[5] === "your" || opener[5] === "one of your" ? ({ bySide: "you" } as const) : null;
    const who = opener[1].trim();
    // "…with a combo cost of 1" (BT19-100): a card filter has no combo-cost
    // measure, so the qualifier was dropped without a word and the rule read as
    // being about *every* card of that name. A replacement that applies to more
    // cards than the text names is worse than none; refused until a filter can
    // say it.
    if (/\bcombo cost\b/i.test(who)) return null;
    // "A ≪Slug's Army≫ card with a combo cost of 1 would leave your Battle
    // Area" — the rule is about other cards, so the subject is kept.
    if (/^(?:this card|it)$/.test(who)) return { by, ...bySide };
    return who ? { by, ...bySide, subject: who } : { by, ...bySide };
  }
  // "A ≪Turles Crusher Corps≫ card in your Battle Area would be placed in its
  // owner's Drop Area by one of your skills" (BT12-056(+b), BT15-092(+b),
  // BT15-097) — the ordinary route out (a skill sending it to the Drop) named
  // in full rather than as "leave"/"removed from" the Battle Area.
  // Owner ruling 26 Oct 2026 (A9): a skill's KO places the card in the Drop
  // Area too (5-12-1), so it answers that as well (`skillOrKoBySkill`) —
  // never the battle's KO.
  // "…by one of your skills" is the card's controller's skill (`bySide: you`).
  const droppedBySkill = /^(?:if|when)?\s*(.*?) in (?:your |the )?battle area would be placed in (?:its owner'?s?|their owners?'?s?|your|their) drop area by (a|one of your) skills?$/.exec(t);
  if (droppedBySkill) {
    const who = droppedBySkill[1].trim();
    const mine = droppedBySkill[2] === "one of your" ? ({ bySide: "you" } as const) : null;
    if (/^(?:this card|it)$/.test(who)) return { by: "skillOrKoBySkill", ...mine };
    return who ? { by: "skillOrKoBySkill", ...mine, subject: who } : { by: "skillOrKoBySkill", ...mine };
  }
  // #920: the official DB2 errata names both valid source areas and no
  // cause/destination restriction. Keep these areas on the redirect rather
  // than broadening every existing Battle-Area replacement to Combo.
  if (/^when this card is removed from a battle area or combo area$/.test(t))
    return { from: ["battle", "combo"] };
  // "When this card would be placed in its owner's Drop Area from a Combo Area"
  // (BT12-071, -072, -074, -075): the 8-5-8 departure of a combo card to its
  // owner's Drop, which is the only way a card leaves a Combo Area for the Drop
  // once the battle is over. The redirect names the area it answers to (`from`),
  // as the DB2 errata above does, so it is not offered to a departure from the
  // Battle Area; what the card does instead is the next clause.
  if (/^when this card would be placed in (?:its owner'?s?|your) drop(?: area)? from (?:a|your|the) combo area$/.test(t))
    return { from: ["combo"] };
  // The obsolete Drop-only wording deliberately remains unread. Catalog
  // ingestion corrects the four errata cards before drafting new records.
  // "If this card would be KO'd" replaces the KO and nothing else: a card its
  // owner returns to hand is still returned to hand. The narrower form names
  // whose skill did it, and a KO in battle is then not this moment at all.
  const koed = /^(?:if|when)?\s*(?:this card|it) would be ko'?d( by (?:(a|your|one of your) skills?|(?:an|your|one of your) opponent'?s? skills?))?$/.exec(t);
  if (koed) return { by: "ko", ...(koed[1] && !koed[2] ? ({ bySide: "opponent" } as const) : null) };
  return null;
}

/**
 * BT29-040's 9-10 wording names both the target side and the original
 * destination: "if your opponent's Battle Card would be returned to its
 * owner's hand by a skill on your card". A general leave replacement would
 * also catch a move to Drop/Warp, so keep the requested hand destination on
 * the replacement and the opponent-side selector on its subject.
 */
function parseWouldReturnToHand(clause: string): { subject: string; requestedTo: "hand"; by: "skill"; bySide: "opponent"; subjectSide: "opponent" } | null {
  const t = clean(clause);
  const m = /^(?:if|when)?\s*(.*?) would be returned to (?:its owner'?s|their owner'?s) hand by (?:a|one of your) skills? on (?:your|one of your) cards?$/.exec(t);
  if (!m || !/\byour opponent'?s\b/i.test(m[1])) return null;
  return { subject: m[1].trim(), requestedTo: "hand", by: "skill", bySide: "opponent", subjectSide: "opponent" };
}

/**
 * #272: the same 9-10 opener as `parseWouldLeave`, for a life card's own move
 * rather than a Battle Area departure — "if you would add a card from your
 * life to your hand or place it in your Drop Area" (BT10-031, SD18-01).
 * `to` is absent when both destinations are named, which is every printed
 * instance so far; a card naming only one is read narrowed to it, untested
 * by the catalog today.
 */
function parseWouldMoveFromLife(clause: string): { to?: "hand" | "drop"; lifeSelf?: true } | null {
  const t = clean(clause);
  // "…you would **reveal this card from your life to add it to your hand**,
  // you may place it in your energy in Rest Mode instead" (BT10-036, BT10-040,
  // BT10-047, P-235, P-454, SD18-04): the same 9-10 moment as the "if you would
  // add a card from your life to your hand" above, about **this card** only —
  // the life card that is being taken is the one printing the rule (9-1-3-3 lets
  // a [Permanent] name the area it is valid in; "this card … from your life"
  // does). Damage is the only way a card is revealed from the life to be
  // added to the hand (21-3-2), so the moment is the life card's move to the
  // hand. Both spellings: "to add it" and "and add it".
  if (/^(?:if )?you would reveal this card from your life (?:to|and) add it to your hand$/.test(t)) return { to: "hand", lifeSelf: true };
  if (/^if you would add(?: a| 1)? cards? from your life to your hand or place it in your drop(?: area)?$/.test(t)) return {};
  if (/^if you would add(?: a| 1)? cards? from your life to your hand$/.test(t)) return { to: "hand" };
  if (/^if you would place(?: a| 1)? cards? from your life in your drop(?: area)?$/.test(t)) return { to: "drop" };
  return null;
}

/**
 * 13-5-2's marker loss as a replaceable moment (SD13-02): "if this card would
 * lose a marker from an opponent's attack", "if it would lose a marker from an
 * attack" (BT10-125 — an attack on your Unison is always the opponent's, 8-1-1)
 * and "if a marker would be removed from this card by an opponent's attack".
 * The card is always the permanent's own, so "it" stays `self`.
 */
function parseWouldLoseMarker(clause: string): boolean {
  const t = clean(clause);
  return (
    /^if (?:this card|it) would lose a marker from an (?:opponent's )?attack$/.test(t) ||
    /^if a marker would be removed from this card by an (?:opponent's )?attack$/.test(t)
  );
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
  // "At the end of **that** turn" (BT2-036, BT6-121) names the turn the skill
  // is resolving in, which is this one: the same timing with a pronoun.
  [/at (?:the )?end of (?:this |that |the |your )?turn/, "turnEnd", "thisTurn"],
  [/at (?:the )?end of (?:this|the) battle/, "battleEnd", "thisTurn"],
  // "KO that card **after the battle**" (BT1-015), "switch this card to Active Mode **after the battle**"
  // (BT1-087 and its [Blocker] family): the Battle End Step (8-5-9), the same moment as "at the end of the battle".
  [/after the battle/, "battleEnd", "thisTurn"],
  [/at the (?:start|beginning) of your next main phase/, "mainStart", "yourNextTurn"],
  [/at the (?:start|beginning) of your opponent's next main phase/, "mainStart", "opponentNextTurn"],
  [/at the (?:start|beginning) of your opponent's next turn/, "turnStart", "opponentNextTurn"],
  [/at the (?:start|beginning) of your next turn/, "turnStart", "yourNextTurn"],
  [/at the (?:start|beginning) of the next turn/, "turnStart", "nextTurn"],
  [/during your opponent's next turn/, "turnStart", "opponentNextTurn"],
  [/during your next turn/, "turnStart", "yourNextTurn"],
  // "-10000 power **during the next turn**" (P-414, BT15-061b): the turn that follows this one, which is
  // the opponent's - the same moment "at the start of the next turn" names, not a span from now.
  [/during the next turn/, "turnStart", "nextTurn"],
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
  // The other end of a battle is only there while the battle is: a card named
  // by "the card this card attacked" (BT19-035b, #1005) cannot be looked up
  // when the delay runs at the opponent's next turn, so the sentence stays a
  // duration (`durationOf` reads the same words as "until the end of your
  // opponent's turn") bound to the card now.
  if (/\bthis card (?:attacked|is attacking|has attacked)\b|\battacked this card\b|\bthe (?:guard|attack(?:ing)?) card\b/.test(head)) return null;
  return { at: best.at, scope: best.scope, label: best.m[0].slice(head.length).trim(), head };
}

/**
 * Clauses that carry no effect of their own.
 *
 * "if you do" (20-16) makes everything after it depend on the previous action
 * having happened, which `compileSkill` turns into a condition; the rest are
 * connectives left over from splitting a sentence.
 */
/**
 * "You can't activate the [Activate: Main] skill on copies of this card for
 * the turn", "…skills on copies of this card during your next turn", "…copies
 * of this card from your hand for the turn": the kind of line (absent for
 * every line), and whether the card's own copies in a hand are all it names.
 */
const COPIES_ACTIVATION = /^you can't activate (?:(?:the )?\[(activate: main|activate: battle|activate: main\/battle|auto|counter)\] skills? (?:on|of) |skills (?:on|of) )?copies of this card( from your hand)?(?:\s+(?:for|during|until)\b.*)?$/;

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
  // "…using this skill" (BT13-122, BT16-072) is the same words as "with".
  if (/^shuffle any (?:secret )?areas? you looked (?:through|at)(?: (?:with|using) this skill)?$/.test(t)) return "skip";
  if (/^(?:additionally|then|so|and|also|after that|in addition)$/.test(t)) return "skip";
  // 20-13-1 read straight: skipping a turn or a span of phases already says
  // where play proceeds from, so a trailing clause that only names that
  // destination (BT31-097, BT21-104) restates the `skip` clause before it
  // rather than adding a second effect.
  if (/^begin your opponent's (?:charge|main|end) phase$/.test(t)) return "skip";
  if (/^start your main phase$/.test(t)) return "skip";
  // "Choose **and** activate 1 {Broly's Ring} from your deck" splits into a
  // bare "choose" and the action. The choosing is how that action picks its
  // card, so the fragment says nothing the clause after it does not.
  if (/^choose$/.test(t)) return "skip";
  // Reminders that restate a rule the engine already applies.
  // Not "you can't activate the [Counter: Play] skills of other cards": that
  // is a rule of its own (BT10-008's price, #716), read by `compileProhibition`.
  // Nor "you can't activate Extras" (BT20-024, owner ruling 26 Oct 2026): a
  // ban on activating Extra Cards (12-1-3), which no rule of the game says.
  // Nor "you can't activate the [Activate: Main] skill on copies of this card
  // for the turn" (BT12-031, BT12-035 and some 25 more): a once-per-name rule
  // the card prints for itself, which nothing else in the engine applies.
  // Nor "you can't activate [Z-Awaken] unless …" (BT21-068's back, prohibition
  // batch 6): a ban on a keyword skill with its escape, read by `compileProhibition`.
  if (/^(?:you can't activate|this skill can only be activated)/.test(t) && !/^you can't activate (?:the )?\[counter: [a-z ]+\] skills (?:of|on) other cards\b/.test(t) && !/^you can't activate extra(?:s| cards)(?:\s+(?:for|during|until)\b.*)?$/.test(t) && !COPIES_ACTIVATION.test(t) && !/^you can't activate \[z-awaken\] unless\b/.test(t) && !/^you can't activate (?:non-keyword leader card skills|this skill)\b/.test(t) && !/^you can't activate \[counter\] skills for the turn while\b/.test(t)) return "skip";
  // "This card can't be played" on its own is one of those. The forms that say
  // *how* — "by skills from any area", "from any area except by skills" — are
  // not: nothing else in the engine applies them, and skipping them here was
  // why fifteen cards read cleanly and could still be fetched out of a Drop by
  // any skill that liked the look of them. `compileProhibition` reads those.
  // Nor one with a condition — "…from any area unless {Dormant Legend} is in
  // your Drop Area" (BT9-078, P-281): read by `compileProhibition`.
  if (/^this card can't be played/.test(t) && !/\bskills?\b/.test(t) && !/\bunless\b|\bif\b/.test(t)) return "skip";
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
  // reattaches that comma for “on this card” and for leading own-token
  // counts (BT23-078/080/082/096), so the multiplier and effect arrive together.
  // Other leading count shapes remain unread.
  //
  // "For every 2 ≪Universe 2≫ cards in your Warp" (BT30-084) is the same count
  // in whole steps of 2, rounded down — `Amount`'s `per` (2 Oct 2026). The
  // step size is read off the front of the counted phrase in either form;
  // "for each 1 energy you have" is a step of 1, which is no step at all.
  const lead = /^for (?:each|every) (?:(\d+) )?(markers?\s+on\s+.+?|of your [a-z0-9'’. -]+ tokens?|(?:card )?colou?rs?(?: types?)?\s+(?:among|on|in)\s+.+?)\s*,\s*(.+)$/.exec(t);
  const m = lead ? null : /^(.+?)\s+(for each|for every|equal to the number of)\s+(.+)$/.exec(t);
  if (!lead && !m) return null;
  const headSrc = lead ? lead[3] : m![1];
  // What is being counted ends at its noun. "…+6000 power for each card in
  // your energy **and [Triple Strike] for the duration of the battle**"
  // carries on about the card, not about what is counted, and taking the whole
  // tail as the counted phrase dropped the keyword and the duration in
  // silence — the power lasted the turn instead of the battle. The leading
  // form has no such tail: the comma already ends the counted phrase.
  const cut = lead ? null : /(?:,?\s+and\s+\[)|(?:\s+for the (?:duration of the |rest of the )?(?:turn|battle|game)\b)|(?:\s+until\s)|(?:\s+during (?:this|your)\b)/i.exec(m![3]);
  const countedSrc = lead ? lead[2] : cut ? m![3].slice(0, cut.index) : m![3];
  const tail = lead ? "" : cut ? m![3].slice(cut.index) : "";
  // "Equal to the number of 2 …" says nothing, so only a "for each/every"
  // phrase may lead with its step size.
  const stepped = !lead && m![2] !== "equal to the number of" ? /^(\d+)\s+(.+)$/.exec(countedSrc) : null;
  const counted = stepped ? stepped[2] : countedSrc;
  const step = Number(lead ? (lead[1] ?? 1) : stepped ? stepped[1] : 1);
  if (!Number.isInteger(step) || step < 1) return null;
  const per = step > 1 ? { per: step } : {};
  // "For each marker on X" is a marker total, not a count of matching cards —
  // reading it as `count` asked how many cards are named "this card" (always
  // 1) and printed a flat bonus with no markers in it at all.
  const markersOn = /^markers?\s+on\s+(.+)$/.exec(counted);
  // Phrasing batch 5: "for every **Z-Energy cost of** the Z-Cards in your Leader Area, Battle Area, and Unison Area"
  // (P-658): a Z-Energy cost total (`sumOf`, `zEnergyCost`), not a count of the cards — in single steps only.
  const zCostOf = markersOn ? null : /^z-energy costs? of (?:the )?(.+)$/.exec(counted);
  if (zCostOf && step !== 1) return null;
  const what = markersOn ? markersOn[1] : zCostOf ? zCostOf[1] : counted;
  // "For each marker on **it**" (P-377, P-378, DB3-144): the pronoun the
  // sentence has been using for the card all along. `parseTarget` reads "this
  // card" and not the bare pronoun, and teaching it the pronoun would change
  // every clause that ends in "it"; here the phrase is already known to be
  // what is *counted*, so the reading is safe and stays local.
  // "For each card color in your Energy Area" (EX19-26): the colors, not the
  // cards. Read first, because the noun is one `parseTarget` would not notice.
  const colors = markersOn ? undefined : colorCountSelector(what);
  if (colors === null) return null;
  // The counted phrase has to end in something a count knows: a card, the
  // energy, a token, a marker, or a name. `parseTarget` hands back the area of
  // any phrase it can place, so "color", "energy cost" or "keyword skill" in
  // front of an area read as the number of *cards* there (EX19-26 read "-2000
  // power for each of your energy" for "each card color in your Energy Area").
  if (colors === undefined && !markersOn && !countsCards(what)) return null;
  const sel = colors ?? (/^(?:it|this card)$/.test(what) ? ({ special: "self" } as Selector) : (parseTarget(countAreasSaidWithAnd(what)) ?? energyYouHave(what)));
  if (!sel) return null;
  // A count (or a marker total) reads the whole area, not one card out of it.
  const broad: Selector = { ...sel, ...(lead && sel.filter?.token ? { area: "battle" as const } : {}), count: 99, upTo: false };
  const amountFor = (printed: number): Amount =>
    zCostOf
      ? { sumOf: broad, attr: "zEnergyCost", ...(printed === 1 ? {} : { times: printed }) }
      : markersOn ? { markers: broad, ...per, ...(printed === 1 ? {} : { times: printed }) } : { count: broad, ...per, ...(printed === 1 ? {} : { times: printed }) };
  // "Draw cards equal to the number of …" prints no number at all, because the
  // count is the number. Only the trailing "equal to" form says this; the
  // leading marker form always prints a number to multiply.
  if (!lead && /^draw cards?$/.test(headSrc)) return [{ op: "draw", n: { count: broad, ...per } }];
  // The tail goes back on the head, where the patterns that read "and
  // [Keyword]" and the duration can see it.
  const head = compileClause(`${headSrc}${tail}`, c);
  if (!head?.length) return null;
  const [op, ...rest] = head;
  // Trailing cost counts already have their own reader (including orb colors).
  if (op.op === "costReduction" && !lead) return null;
  const swapped = swapForEachAmount(op, amountFor);
  if (!swapped) return null;
  // The named area is the reducer's scope, not a creation/activation source.
  // selfFrom reads “from”, so preserve “in your hand” explicitly here.
  if (lead && swapped.op === "costReduction" && /\bthis card in your hand by\b/.test(headSrc)) {
    swapped.target = { sel: { special: "self", area: "hand" } };
  }
  return [swapped, ...rest];
}

/**
 * Does the phrase after "for each" count *things*: cards, energy, tokens,
 * markers, or cards by name? Its head — the words before the first preposition
 * or relative clause — must end in one of those nouns. "Color", "energy cost",
 * "keyword skill" and "specified cost" are measures of a card, not cards, and
 * the area after them is where `parseTarget` would stop reading.
 */
function countsCards(counted: string): boolean {
  const head = counted.split(/\s+(?:in|on|among|under|placed|switched|with|you|they|from|that|by|of)\s/)[0].trim();
  if (!head || /^(?:of|it)\b/.test(counted)) return true;
  return /(?:\bcards?|\benergy|\bz-energy|\btokens?|\bextras?|\bunisons?|\bleaders?|\bmarkers?|[≫>])$/.test(head);
}

/**
 * "For each 1 energy you have" (TB1-038, BT1-030 twice): the energy area,
 * counted one card at a time. `parseTarget` reads "cards in your energy" but
 * not this shape, where the noun is the area itself and the "1" is the size of
 * each step rather than a multiplier.
 *
 * Any other number divides the count — "for each 2 energy" is a step of 2,
 * `Amount`'s `per` — and `compileForEach` takes it off the front before this
 * is asked, so a number still here is one nothing read.
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
  if ((op.op === "power" || op.op === "comboPower" || op.op === "costReduction") && typeof op.amount === "number") {
    return { ...op, amount: amountFor(op.amount) };
  }
  // Phrasing batch 5: "for every 5 cards in your Z-Energy, **add 1 of your opponent's life** to its owner's Z-Energy"
  // (BT23-109): an exact choice of a counted number becomes that many per step, owed (`owed`: as many as possible, never
  // fewer by choice). Only an exact count — "up to 1 … for each" would be a bound, and is left as it is.
  if (op.op === "choose" && typeof op.sel.count === "number" && !op.sel.upTo && op.sel.count < 99 && !op.atMost && !op.exactly && !op.sumTo) {
    const { count, ...sel } = op.sel;
    return { ...op, sel, atMost: amountFor(count), owed: true };
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
  "for the (?:duration of (?:the |this )?)?(?:turn|battle|game)|for the rest of (?:the|this) turn|during (?:this|the|that) turn|this turn|until (?:the )?(?:end|start|beginning) of [a-z' ]+|while this card is in (?:a|the|your) battle area";
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
    // "…, then **you choose** up to 1 of your opponent's Battle Cards" (BT10-149, BT18-143, P-279, #907 round 5): the
    // subject is said after a sentence about the opponent, to say it is the master choosing again.
    .replace(/^you (?=choose (?:up to )?(?:\d+|an?|one|all|any number)\b)/, "")
    // A trailing "instead" marks a replacement (9-10) and says nothing about
    // the action itself; the clause before it has already recorded that.
    .replace(/\s+instead$/, "")
    // A card-moving verb left in the third person by the split before it.
    // "…and **KOs** it", "…and **plays** it": the verb is left in the third
    // person by the split before it, because the sentence's subject was the
    // opponent. Only the leading word, so "your opponent draws" is untouched.
    .replace(/^(places|puts|sends|returns|adds|switches|removes|discards|kos|plays|draws|reveals)\b/, (v) => THIRD_PERSON[v])
    // #966: "place 1 card in your Drop Area from your life" (BT13-099) → "place
    // 1 card from your life in your Drop Area", the order the move patterns read.
    .replace(/^place (.+?) in ((?:your|their|its owner'?s) drop(?: area)?) (from (?:your|their) (?:life|hand|energy(?: area)?|battle area|combo area))$/, "place $1 $3 in $2")
    // Phrasing batch 2: "place this card in your energy **from your Drop Area**" (DB3-028, DB3-033, DB3-119) and
    // "add this card to your Z-Energy **from your Drop**" (BT18-029, BT20-054b): the same reorder, into the energy
    // or the Z-Energy, from the Drop or the Warp.
    .replace(/^(place|add) (this card|it) (in|to) ((?:your|its owner'?s) (?:energy|z-energy)(?: area)?) (from your (?:drop|warp)(?: area)?)$/, "$1 $2 $5 $3 $4")
    // Phrasing batch 2, the same reorder for the other destinations a source is printed after:
    // - "place this card at the bottom of its owner's deck **from the Battle Area**" (DB2-174);
    // - "add up to 1 red <General Rilldo> card … **to your hand from your deck**" (P-381, P-377, P-378, BT17-063);
    // - "place this card under your Leader Card **from your hand**" (BT15-040, BT15-041), "place up to 3 ≪Namekian≫
    //   cards under it **from your Drop Area**" (P-397), "…place this card under it **from your Battle Area**" (EX19-08).
    .replace(/^place (.+?) ((?:at|on) (?:the )?(?:top|bottom) of (?:your|its owner'?s) deck) (from the battle area)$/, "place $1 $3 $2")
    .replace(/^add (.+?) to your hand (from your (?:deck|drop(?: area)?|warp))$/, "add $1 $2 to your hand")
    .replace(/^(place|put) (.+?) under (it|your leader(?: card)?|the chosen [a-z' ]+?) (from (?:your|its owner'?s) (?:hand|drop(?: area)?|battle area|warp))$/, "$1 $2 $4 under $3")
    // Phrasing batch 1: "place this card at the bottom of your deck **from your Warp**" (BT16-122, P-288, P-287) →
    // "place this card from your Warp at the bottom of your deck", the order the move patterns read.
    .replace(/^place (.+?) ((?:at|on) (?:the )?(?:top|bottom) of (?:your|its owner'?s) deck) (from (?:your|its owner'?s) (?:warp|drop(?: area)?|hand|battle area|combo area))$/, "place $1 $3 $2")
    // The same, for the Warp: "send this card to your Warp **from your Drop Area**" (BT17-131).
    .replace(/^send (.+?) (to (?:your|their|its owner'?s?) warps?) (from (?:your|their) (?:drop(?: area)?|hand|battle area))$/, "send $1 $3 $2");
  let m: RegExpExecArray | null;

  // Phrasing batch 2: "At the end of your opponent's next turn, **they add** all cards sent to their Warp by this
  // skill **from their Warp to their hand**" (BT11-014, BT11-016): the cards this skill sent, back to their owner's
  // hand — who does the adding changes nothing about where they go.
  if ((m = /^(?:they|your opponent) adds? (.+?) from their warp to their hand$/.exec(t)) && SENT_TO_WARP_BY_THIS_SKILL.test(m[1])) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "moveTo", target: ref, to: "hand" }] : null;
  }
  // Phrasing batch 2: a keyword list with its subject left behind by the "and" that cut it off — "this card gets
  // +5000 power **and gains [Critical] and [Double Strike] for the turn**" (BT31-079, DB1-006): the card the power
  // change just before it named.
  if ((m = /^gains? ((?:\[[^\]]+\][\s,]*(?:and\s+)?)+)$/.exec(stripQualifiers(t))) && c.lastTarget && c.lastOp === "power") {
    const kws = [...m[1].matchAll(/\[([^\]]+)\]/g)].map((x) => keywordOf(x[1]));
    if (kws.length && kws.every((k) => k)) {
      const until = durationOf(t);
      return kws.map((k) => ({ op: "grant", target: c.lastTarget!, keyword: k!, until }) as Op);
    }
  }
  // Phrasing batch 1: "…it gets +20000 power for the battle; if …, **it also gains** [Double Strike]" (BT12-083): the
  // second grant prints no span of its own and is said as more of the same change, so it lasts as the one before it
  // did. Only when that one was a power change or a grant of this same clause list, for the battle or the turn.
  if (/^(?:it|that card|the chosen card) also (?:gains?|gets?) /.test(t) && c.lastUntil && !/\b(?:for|until|during)\b/.test(t))
    return compileClause(`${clause.replace(/\balso\s+/i, "").replace(/[.,;]\s*$/, "")} for the ${c.lastUntil}`, c);
  // Phrasing batch 1: "**an additional** +10000 power" (BT6-103, BT1-085b, SD3-05) is the second change of the same
  // kind a sentence before it already made, and a power change adds to the ones before it anyway (20-2-2): the
  // word says nothing the bare amount does not.
  if (/\b(?:gets?|gains?) an additional [+-]\d+ power\b/.test(t)) return compileClause(clause.replace(/\ban additional ([+-]\d+ power)/i, "$1"), c);
  // "**Your card that's in a battle** gets +10000 power and [Critical] for the battle" (BT22-057, BT22-059, P-540,
  // BT17-057; phrasing batch 1): the one card of yours in the battle (8-1) — the attacking card on your turn, the
  // card being attacked on your opponent's, since only the turn player attacks (8-1-1). Read once with the
  // attacking card named and once with the card being attacked; nothing that chooses a card is read this way.
  // "Switch your card that's in a battle with …" (8-1-7-2) is read below as itself.
  const YOUR_BATTLER = /\byour card (?:that['’]s|that is) in (?:a|the) battle\b/i;
  if (YOUR_BATTLER.test(clause) && !/^switch your card\b/.test(t)) {
    const attacking = compileClause(clause.replace(YOUR_BATTLER, "the attacking card"), c);
    if (!attacking || !attacking.length || attacking.some((o) => o.op === "choose" || o.op === "may" || o.op === "if")) return null;
    const flipRole = (o: Op): Op => JSON.parse(JSON.stringify(o).replaceAll('"special":"attacker"', '"special":"guard"')) as Op;
    if (!JSON.stringify(attacking).includes('"special":"attacker"')) return null;
    return [{ op: "if", cond: { kind: "isTurnPlayer" }, then: attacking, else: attacking.map(flipRole) }];
  }

  // "KO that card after the battle" (BT1-015): "after the battle" is a moment of its
  // own that the delay table has no row for, and read without it the KO would happen
  // at once, during the attack's trigger (and "that card" would be this card). Unread,
  // as it was; the skill goes to the referee.
  if (/^ko\b.*\bafter the battle$/.test(t)) return null;

  // #970: "send 1 <A> card and 1 <B> card from your Drop to your Warp" — one
  // choice per slot, each a card of its own.
  // "You and your opponent compliment each other." (P-514–P-516, P-588–P-592):
  // a table-talk promo with no game effect. No rule, errata or Q&A entry
  // covers it (the text asks for something said between the players). The
  // owner's ruling, recorded with `arena:rule` on all eight records (15 Oct
  // 2026): show a compliment, then acknowledge the instruction. Read as two
  // notes in the game log, in that order — a compliment shown, then the
  // instruction acknowledged — and nothing else moves. A labelled best guess
  // for "show" and "acknowledge"; a button the player presses is not built.
  if (/^you and your opponent compliment each other$/.test(t)) {
    return [
      { op: "note", text: "Compliment: “Good game so far — nice cards!” Each player pays the other a compliment.", shown: true },
      { op: "note", text: "Instruction acknowledged: you and your opponent compliment each other.", shown: true },
    ];
  }
  // #930: "for each character name required for the revealed card's [union] skill, add up to 1 card with a
  // matching character name …" (EX13-14), "add up to 1 Battle Card each … each with a character name that matches
  // the [Union] skill conditions of the revealed card …" (SD19-03).
  const unionSearch = compileUnionNameSearch(t, c);
  if (unionSearch !== undefined) return /^(?:you may|you can|the player may)\s/i.test(clause.trim()) ? null : unionSearch;
  const named = compileNamedSet(t, c);
  if (named !== undefined) return /^(?:you may|you can|the player may)\s/i.test(clause.trim()) ? null : named;
  // #1015: "your opponent chooses 2 cards in their hand and places them at the
  // bottom of their deck" — the opponent's own choice and the move it ends in,
  // one sentence (see `opponent-choice.ts`). Not an offer; "you may" is refused.
  // "…your opponent places 2 cards from the top of their deck in their Drop Area" (BT9-024, BT9-035, BT9-101, BT6-121,
  // BT10-149, #907 round 5): the top of the deck is milled, nobody chooses. Read below as the opponent choosing N cards
  // of their whole deck, it let them pick which went to the Drop - and a "-5000 power" after it landed on the milled cards.
  if ((m = /^your opponent places (\d+) cards? from the top of their deck (?:in|into) their drop(?: area)?$/.exec(t))) {
    return [{ op: "mill", n: Number(m[1]), side: "opponent", as: `m${c.mills++}` }];
  }
  const opponentMove = compileOpponentChoice(t, c, (o) => track(o, c));
  if (opponentMove !== undefined) return /^(?:you may|you can|the player may)\s/i.test(clause.trim()) ? null : opponentMove;
  const disjoint = compileDisjointMove(t, c);
  // An optional one ("you may choose 1 red card and 1 green card in your Drop Area
  // and send them to your Warp", DB2-166) is both or neither: the `may` declines
  // for you when the slots cannot all be had, each with a card of its own
  // (`vm/script.ts`, #907), so the offer is read like any other.
  // Only the "choose … and send them" wording: "you may place 1 <A> card and 1 <B>
  // card from your Warp … and pay {1}" (BT27-007) is an alternative price, not an offer.
  if (disjoint !== undefined) {
    const optional = /^(?:you may|you can|the player may)\s/i.test(clause.trim());
    const offerOfAPair = /^(?:you may|you can|the player may)\s+choose\b/i.test(clause.trim());
    if (optional && !offerOfAPair) return null;
    return disjoint;
  }

  // An omitted subject at this particular conjunction is unambiguously self
  // (#910). Reuse both readers, accepting only an identity gain: no guessing
  // from previous sentences, choices, other subjects or area qualifiers.
  const coordinatedIdentity = /^this card (?:can't|cannot) attack and (gains? .+)$/.exec(t);
  if (coordinatedIdentity) {
    const identity = compileClause(`this card ${coordinatedIdentity[1]}`, c);
    const prohibition = compileClause("this card can't attack", c);
    return identity?.length === 1 && identity[0].op === "gains" && prohibition
      ? [...prohibition, ...identity] : null;
  }

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
  if (/\bfor each\b|\bfor every\b|\bequal to the number of\b/.test(t)) {
    // "Add up to 1 ≪Power Wish≫ card from your deck to your hand **for every
    // 1 specified cost on that card**" (EX24-01b): one card allowed per orb of
    // the specified cost the Unison that left had — read from the movement's
    // captured information, so a later change to it does not count. Only the
    // "up to 1 … for every 1" shape, where the allowance is the orb count
    // itself, and only after a trigger whose subject "that card" is.
    if (
      (m = /^add up to 1 (.+?) from your deck to your hand for every 1 specified costs? on (?:that card|it)$/.exec(t)) &&
      c.lastTarget &&
      "sel" in c.lastTarget &&
      c.lastTarget.sel.special === "subject"
    ) {
      const base = compileClause(`add up to 1 ${m[1]} from your deck to your hand`, c);
      const pick = base?.[0];
      if (!base || base.length !== 2 || pick?.op !== "choose" || pick.sel.area !== "deck") return null;
      return [{ ...pick, sel: { ...pick.sel, count: undefined, upTo: true }, atMost: { attr: { sel: { special: "subject" } }, name: "specifiedCost" } }, base[1]];
    }
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
    if (/^for (?:each|every) (?:\d+ )?markers? on this card\s*,/.test(t) || /^for each of your\b[^,]*\btokens?\b[^,]*,/.test(t) || LEADING_COLOR_COUNT.test(t)) return null;
  }

  // 20-13 (#278). "You skip your Offense Step" / "your opponent skips their
  // Defense Step" name a battle step directly — printed as a [Permanent]'s
  // own standing rule (BT18-019, BT18-001) as often as a one-shot effect, and
  // `collectStatics`/`exec` read the same op two different ways (state.ts,
  // script.ts) depending on which kind of skill it is on.
  if ((m = /^(you|your opponent) skips? (?:your|their) (offense|defense) step$/.exec(t)))
    return [{ op: "skip", what: m[2] as "offense" | "defense", when: "this", ...(m[1] === "your opponent" ? { side: "opponent" as const } : {}) }];
  // "Skip your turn" (BT31-097): every phase of the next turn, refused at
  // once (20-13-1) — "and begin your opponent's Charge Phase" is that same
  // rule said in words and is dropped by `connective`, just above.
  if (t === "skip your turn") return [{ op: "skip", what: "turn" }];
  // "Skip all phases until the Charge Phase in your next turn" (BT21-104):
  // the rest of this turn, the opponent's whole next turn, and this card's
  // controller's own next Charge Phase, landing at that Main Phase — three
  // ordinary skip entries under one name (script.ts) rather than a mechanism
  // of its own. "…, then start your Main Phase" is again the same rule said
  // in words, dropped by `connective`.
  if (t === "skip all phases until the charge phase in your next turn") return [{ op: "skip", what: "span" }];

  // Draw (5-1). "You may draw" is treated as taken: declining never helps.
  // "…, and **you draw** 1 card" (BT8-089b, TB2-033, BT19-022): the same draw with its subject said.
  // "…draw 1 card, and if …, **draw 1 more card**" (BT6-036, #930): the same draw, again.
  if ((m = /^(?:you )?draw (\d+) (?:more )?cards?$/.exec(t))) return [{ op: "draw", n: Number(m[1]) }];
  // 20-5: "Draw X cards" — the X the price was paid at, read off the frame the
  // activation bound it on. Only when the price charges one: a program that
  // says `X` with nothing to bind it throws where it resolves, and the honest
  // gap it would replace is the better answer (DB3-138's "{u}(X)" is a price
  // notation this compiler does not read).
  if (c.xBound && /^draw x cards?$/.test(t)) return [{ op: "draw", n: { x: true } }];
  // Phrasing batch 5: "Choose up to 2 cards in your hand and discard them: When this card is played, **draw cards equal
  // to the number of cards you discarded with this skill**" (DB3-058) — as many as the price's choice discarded — and
  // "…choose up to 2 of your opponent's Battle Cards … and return them to their owners' hands, **then draw that many
  // cards**" (XD1-02) — as many as the choice before it took (20-5). Not "revealed by this skill" (P-749), whose next
  // clause is a count of its own no reader takes.
  if (/^draw cards equal to the number of cards (?:you discarded|(?:that were )?discarded) (?:with|by|using) this skill$/.test(t) && c.priceChoice && c.priceDiscarded) return [{ op: "draw", n: { var: c.priceChoice } }];
  if (/^(?:then )?draw that many cards$/.test(t) && c.last && c.last !== c.priceChoice) return [{ op: "draw", n: { var: c.last } }];
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
  // chooses — which is what makes it not the `discard` op. 9-1-3-2: a discard
  // is out of the hand by definition (20-7), and "… from your hand" says so
  // for a placing, so the selector carries the area the line is used from.
  if (/^discard this card(?: from your hand)?$/.test(t) || /^(?:place|put) this card (?:in|into) (?:your|its owner'?s?|the) drop(?: area)?(?: from your hand)?$/.test(t)) {
    const fromHand = t.startsWith("discard") || t.endsWith("from your hand");
    return [{ op: "moveTo", target: { sel: fromHand ? { special: "self", area: "hand" } : { special: "self" } }, to: "drop", reveal: true }];
  }
  // "Add this card to your hand from your Warp" (BT16-089, EX19-28, EX19-35, #907 round 5): the card is named, so
  // nobody chooses. The area is the one the line is used from (9-1-3-2), which is what keeps the move from finding
  // a copy in another place.
  if ((m = /^add this card to your hand from (?:your|its owner'?s) (warp|drop(?: area)?)$/.exec(t))) {
    return [{ op: "moveTo", target: { sel: { special: "self", area: m[1] === "warp" ? "warp" : "drop" } }, to: "hand" }];
  }
  // "Discard 1 mono-green card from your hand", "discard 1 ≪Saiyan≫ or
  // ≪Earthling≫ card from your hand": the owner still chooses (20-7), but only
  // among the cards the text describes, which the `discard` op cannot say. It
  // is the same choose-then-move that op splices for the unqualified case, so
  // this reads the description as a target phrase and lets `withChoice` ask.
  // "Discard 1 or more yellow ≪Majin≫ cards from your hand" (BT20-090, -107,
  // -108, -109): a floor with no ceiling but the hand. The owner picks at
  // least N and as many more as they like (5-2-4's "up to" has no floor, a
  // plain "N" no slack). The ceiling is the language's 99, "all", and the
  // choice stops when the cards run out.
  if ((m = /^discard (\d+) or more (.+?)(?: from your hand)?$/.exec(t))) {
    const ref = refFor(`1 ${m[2]} in your hand`, c);
    if (!ref || !("sel" in ref) || ref.sel.special || ref.sel.take != null) return null;
    const v = `c${c.n++}`;
    return [{ op: "choose", sel: { ...ref.sel, count: 99, upTo: false, minCount: Number(m[1]) }, as: v, reason: clause }, { op: "moveTo", target: { var: v }, to: "drop", reveal: true }];
  }
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
  // #930, BT29-150: "both players send cards from their hands to their owners'
  // Warps until both hands have 7 cards" — each player gives up the excess of
  // their own hand over N, chosen by that player (20-7), as BT7-105's "until
  // they have 12 cards in hand" does for the opponent alone; a hand of N or
  // fewer sends nothing (0-2-4-2). Each side its own `if`, because the excess
  // differs per hand. Only the Warp, as printed. The turn player acts first
  // (0-2-8; owner's ruling of 26 Oct 2026), whoever controls the skill — it
  // can resolve on the opponent's turn (a Unison removed by their skill) — so
  // the order is chosen by `isTurnPlayer` as the skill resolves.
  if ((m = /^both players send cards from their hands to (?:their owners?'?s?|their) warps? until both hands have (\d+) cards$/.exec(t))) {
    const keep = Number(m[1]);
    const step = (side: "you" | "opponent"): Op => {
      const hand: Selector = { side, area: "hand" };
      return { op: "if", cond: { kind: "count", sel: hand, atLeast: keep + 1 }, then: [{ op: "discard", n: { plus: [{ count: hand }, -keep] }, side, to: "warp" }] };
    };
    return [{ op: "if", cond: { kind: "isTurnPlayer" }, then: [step("you"), step("opponent")], else: [step("opponent"), step("you")] }];
  }
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
  // "Inflict 2 damage to your opponent" (BT1-011, BT1-015, BT2-006, EX03-03) is "deal 2 damage":
  // 1-13 treats the two verbs alike, as the "to your life" line below already does.
  // Phrasing batch 2: "deal 1 damage to **their life**" (P-030, after "an opponent's Battle Card"), "inflict 1
  // damage to **the opponent's life**" (BT2-028), "**it deals** 1 damage to your opponent's life" (BT3-123: the card
  // the sentence is about, dealing it as the skill's), "deal 1 **additional** damage to your opponent" (BT9-104: one
  // more damage of its own, after the damage the moment was about).
  if ((m = /^(?:(?:it|this card) deals|deal|inflict) (\d+) (?:additional )?damage to (?:your opponent|your opponent's life|them|their life|the opponent'?s life|the opponent)$/.exec(t))) return [{ op: "damage", n: Number(m[1]), side: "opponent" }];
  // "you may inflict 2 damage to your life" (EX03-11, P-015): damage to yourself is
  // the same 5-10 damage, taken from your own Life Area into your own hand.
  if ((m = /^(?:deal|inflict) (\d+) damage to (?:your life|you)$/.exec(t))) return [{ op: "damage", n: Number(m[1]), side: "you" }];

  // Deck manipulation.
  if ((m = /^place (up to )?(\d+) cards? from the top of (your|your opponent's) deck in (?:your |their |its owner's |the )?drop(?: area)?$/.exec(t))) {
    // "Place **up to** 2 cards from the top of your deck in the Drop Area"
    // (BT3-119, BT3-120, BT2-001; owner's ruling of 20 Oct 2026, recorded on
    // BT3-120 front 10): an optional choice made one card at a time — you may
    // place 1, then if you did you may place 1 more, up to N (5-2-4) — never a
    // forced mill of exactly N. Each card is its own `mill` of 1, so "that
    // card" after N = 1 is the one placed, and nothing when it was declined.
    if (m[1] && m[3] === "your") {
      const n = Number(m[2]);
      const vars = Array.from({ length: n }, () => `m${c.mills++}`);
      // "If that card is red" after "up to 1" is the one card placed; after
      // "up to 2" no single card is "that card", so nothing is named for it.
      if (n === 1) c.lastNamed = vars[0];
      return oneAtATime(vars.map((v): Op[] => [{ op: "mill", n: 1, as: v }]), "place 1 card from the top of your deck in the Drop Area");
    }
    return [{ op: "mill", n: Number(m[2]), ...(m[3] === "your" ? {} : { side: "opponent" as const }), as: `m${c.mills++}` }];
  }
  // "Send **up to** 3 cards from the top of your deck to your Warp" (BT12-122,
  // BT16-099/103/104, BT18-130/132, BT29-086…093, TB2-015; owner's ruling of
  // 20 Oct 2026, recorded on BT12-122 front 20, and of 26 Oct 2026): the same
  // optional one-card-at-a-time shape as the Drop wording — the top card, then
  // if you did the next one — never a free pick from the whole deck, which is
  // what the generic "choose up to N cards in your deck" made of it.
  if ((m = /^(?:send|place|put) up to (\d+) cards? from the top of your deck (?:to|in|into) (?:your |the |its owner's )?warp$/.exec(t))) {
    const n = Number(m[1]);
    const vars = Array.from({ length: n }, () => `w${c.mills++}`);
    if (n === 1) c.lastNamed = vars[0];
    return oneAtATime(vars.map((v): Op[] => [{ op: "look", n: 1, as: v }, { op: "moveTo", target: { var: v }, to: "warp" }]), "send the top card of your deck to your Warp");
  }
  // Phrasing batch 2: "**draw up to 2 cards**" (TB2-029): an optional draw a card at a time, as "place up to 2 cards
  // from the top of your deck in the Drop Area" is (owner's ruling of 20 Oct 2026) — you may draw 1, then if you did,
  // 1 more.
  if ((m = /^draw up to (\d+) cards?$/.exec(t)) && Number(m[1]) >= 1 && Number(m[1]) <= 5) {
    return oneAtATime(Array.from({ length: Number(m[1]) }, (): Op[] => [{ op: "draw", n: 1 }]), "draw 1 card");
  }
  // Phrasing batch 2: "…otherwise **return the card you looked at** to the bottom of your deck" (BT11-047): the card the
  // look turned up, while it is still where it was looked at (the deck).
  if ((m = /^return the card you looked at to the (top|bottom) of your deck$/.exec(t)) && c.lastSeen) {
    return [{ op: "moveTo", target: { sel: { fromVar: c.lastSeen, area: "deck" } }, to: "deck", position: m[1] as "top" | "bottom" }];
  }
  // Phrasing batch 2: "When your opponent activates a [Counter] skill, **they discard 2 cards from their hand**"
  // (BT20-143, BT18-071): the opponent's discard (20-7), as "your opponent discards …" reads.
  if ((m = /^they discard (\d+) cards? from their hand$/.exec(t))) return compileClause(`your opponent discards ${m[1]} card${m[1] === "1" ? "" : "s"} from their hand`, c);
  // Phrasing batch 2: "When your opponent activates a [Counter: Attack] skill, **they place 1 card from their hand at
  // the bottom of their deck**" (BT17-049): they choose the card, from their own hand (TB3-019's two-clause wording).
  if ((m = /^(?:they|your opponent) places? (\d+) cards? from their hand (?:at|on) the bottom of their deck$/.exec(t))) {
    const v = `c${c.n++}`;
    return [{ op: "choose", sel: { side: "opponent", area: "hand", count: Number(m[1]) }, as: v, chooser: "opponent", reason: clause.trim() }, { op: "moveTo", target: { var: v }, to: "deck", position: "bottom" }];
  }
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
  // Phrasing batch 1: the cards just looked at, put back by the clause right
  // after the look (nothing chosen in between).
  // - "Look at up to 3 cards from the top of your [opponent's] deck and place
  //   them on top of your [their] deck in any order" (BT14-093, BT22-114,
  //   BT22-082, P-319): back where they were, as "put them back on top of
  //   the deck" above (20-12-3); the order is the player's.
  // - "Look at up to 1 card from the top of your opponent's deck, then place it
  //   at the top or bottom of their deck" (BT22-093, P-530), "look at the top
  //   card of your deck, place the card on the top or bottom of your deck"
  //   (EX10-03): one card, its owner's deck, the end the skill's player picks
  //   (the same choice as the remaining cards' "top or bottom" below).
  // - A plural "place them on the top or bottom of your deck in any order" /
  //   "…on the top and/or bottom…" (BT9-037, BT10-080, BT10-081; owner's ruling
  //   of 26 Oct 2026): EACH card goes to the top or the bottom as the player
  //   chooses, in the order the player chooses — `topOrBottomEach`.
  if (c.lastOp === "look" && c.lastSeen) {
    const looked: Ref = { var: c.lastSeen };
    if (/^(?:place|put|return) them (?:back )?on (?:the )?top of (?:your|their|your opponent'?s) deck in any order$/.test(t)) return [{ op: "note", text: "the cards looked at go back on top of the deck, in any order" }];
    if (/^(?:place|put|return) them (?:back )?(?:at|on) (?:the )?top (?:or|and\/or) (?:the )?bottom of (?:your|their|your opponent'?s|its owner'?s) deck(?: in any order)?$/.test(t)) return topOrBottomEach(c.lastSeen, c);
    if (/^(?:place|put|return) (?:it|the card|that card) (?:at|on) (?:the )?top or (?:the )?bottom of (?:your|their|your opponent'?s|its owner'?s) deck$/.test(t))
      return [{
        op: "chooseMode", chooser: "you", reason: "Put the card on the top or the bottom of the deck",
        modes: [
          { label: "Top of the deck", ops: [{ op: "moveTo", target: looked, to: "deck", position: "top" }] },
          { label: "Bottom of the deck", ops: [{ op: "moveTo", target: looked, to: "deck", position: "bottom" }] },
        ],
      }];
  }
  // "Choose 1 card in your hand and place it at the top or bottom of your deck"
  // (BT12-029): the chosen card, the end its player picks.
  if (c.lastOp === "choose" && c.last && /^(?:place|put) (?:it|the chosen card) (?:at|on) (?:the )?top or (?:the )?bottom of your deck$/.test(t)) {
    const chosen: Ref = { var: c.last };
    return [{
      op: "chooseMode", chooser: "you", reason: "Put the card on the top or the bottom of your deck",
      modes: [
        { label: "Top of the deck", ops: [{ op: "moveTo", target: chosen, to: "deck", position: "top" }] },
        { label: "Bottom of the deck", ops: [{ op: "moveTo", target: chosen, to: "deck", position: "bottom" }] },
      ],
    }];
  }
  // "The rest" is whatever is left of the cards just looked at once the choice
  // in between has taken its own — so it is the look's variable minus the
  // choice's, not the whole look (20-11).
  {
    const REST = "(?:the|any) (?:remaining cards?|rest of the cards|rest|other cards)";
    const rest: Ref = { var: "looked", ...(c.last ? { minus: c.last } : {}) };
    if ((m = new RegExp(`^(?:place|put|return) ${REST} (?:back )?(?:at|on) (?:the )?(top|bottom) of (?:your|its owner'?s?|their owners?'?s?|their) decks?(?: in (any|a random) order)?$`).exec(t)))
      // "In a random order" (FS03-13) is drawn from the game's seeded RNG; "in any order" keeps the looked-at order.
      return [{ op: "moveTo", target: rest, to: "deck", position: m[1] as "top" | "bottom", ...(m[2] === "a random" ? { random: true as const } : {}) }];
    // "…on the top or bottom of your deck in any order" / "…on the top and/or
    // bottom": owner's ruling of 26 Oct 2026 (phrasing batch 2) — EACH card goes
    // to the top or the bottom as the player chooses, in the order the player
    // chooses (`topOrBottomEach`). Until then one answer covered the whole
    // remainder (a best guess).
    if (new RegExp(`^(?:place|put|return) ${REST} (?:back )?(?:at|on) (?:the )?(?:top|bottom) (?:or|and/or) (?:the )?(?:top|bottom)(?: of (?:your|its owner'?s?|their owners?'?s?|their) decks?)?(?: in any order)?$`).test(t))
      return topOrBottomEach("looked", c);
    if (new RegExp(`^(?:place|put) ${REST} (?:in|into) (?:your |the |its owner'?s? |their owners?'?s? |their )?drop(?: area)?$`).test(t)) return [{ op: "moveTo", target: rest, to: "drop", reveal: true }];
    // "…then send the rest to their owner's Warp" (BT30-106, 3-10).
    if (new RegExp(`^send ${REST} to (?:your|the|its owner'?s?|their owners?'?s?|their) warps?$`).test(t)) return [{ op: "moveTo", target: rest, to: "warp" }];
  }
  if (/^shuffle your deck(?: if you looked through it| afterwards?)?$/.test(t)) return [{ op: "shuffle" }];
  // Phrasing batch 3: "Add up to 1 {Spirit} from your life to your hand, **then shuffle your life**" (BT30-007): the Life
  // Area shuffled, as a search of it leaves it (the `shuffle` op's own area).
  if (/^shuffle your life(?: area)?$/.test(t)) return [{ op: "shuffle", areas: ["life"] }];
  // Phrasing batch 5 (owner's ruling of 26 Oct 2026 on BT26-015): "…, **then shuffle your Drop**" does nothing — the
  // Drop Area is public and has no order the game keeps (3-6), so there is nothing to shuffle.
  if (/^shuffle your drop(?: area)?$/.test(t)) return [];
  // "Declare a number from 0 to 3" (EX Android card), said in the effect itself.
  if ((m = /^declare (?:1|a|one) numbers?(?: (?:that'?s (\d+) or (?:less|fewer)|from (\d+) to (\d+)))?$/.exec(t))) {
    return [{ op: "declare", min: m[3] ? Number(m[2]) : 0, max: m[3] ? Number(m[3]) : m[1] ? Number(m[1]) : 10 }];
  }
  // "Reveal the top card of your opponent's deck, then **flip the revealed card
  // over and place it at the top of their deck**" (BT22-090 and the Fortuneteller
  // Baba cards): the reveal already left the card where it was, face down again
  // is the state it started in, so there is nothing more to do (20-11-2).
  if (c.lastNamed && c.lastSeen && /^(?:flip the revealed card over|place it (?:at|on) the top of (?:their|your opponent'?s) deck)$/.test(t)) return [{ op: "note", text: "the revealed card goes back on top of the deck" }];
  // "You win the game" (BT16-017, BT16-068, BT8-045b): the skill ends the game.
  // Its condition is read in front of it like any other, so this is the bare sentence.
  if (/^you win the game$/.test(t)) return [{ op: "win" }];
  // "...Then, at the end of the turn, you lose the game" (BT2-069b, #907 round 5): the other player wins. Not in a
  // [Permanent] (BT12-086, "if all of your life is face up, you lose the game"): a [Permanent] never resolves, so an
  // op there would be a rule that reads and never runs - that one stays unread.
  if (!c.permanent && /^you lose the game$/.test(t)) return [{ op: "win", side: "opponent" }];
  // 20-12-3: a search of *their* deck is theirs to shuffle afterwards.
  // Phrasing batch 3: "Your opponent reveals the top card of their deck, **then shuffles their deck**" (DB1-077): the verb
  // the opponent's clause carries on with, its subject left behind the "then".
  if (/^(?:(?:your opponent|they) shuffles? |shuffles )(?:their|his|her) deck$/.test(t)) return [{ op: "shuffle", side: "opponent" }];
  // Revealing (20-11-2). Unlike looking, both players see the cards, and they
  // stay where they are — the clauses after it act on what was turned up.
  // "When your opponent attacks a Leader Card, **they reveal their hand**" (BT13-024): the same reveal, its subject the
  // opponent the sentence is already about (phrasing batch 1); read before, it revealed one card of the hand.
  if ((m = /^(?:your opponent reveals|they reveal|reveal) (?:your|their) hand$/.exec(t))) {
    const side: Side | undefined = /your opponent reveals|their/.test(t) ? "opponent" : undefined;
    return [{ op: "reveal", sel: { side: side ?? "you", area: "hand" }, as: "revealed" }];
  }
  // "…choose 1 card in your hand with a [union-fusion] skill **and reveal it**" (EX13-14, #930): the card just
  // chosen from the hand is shown (20-11-2) and stays there. Only straight after a choice of your own hand cards.
  if (/^reveal (?:it|them)$/.test(t) && c.last) {
    const chosen = c.choices.find((ch) => ch.var === c.last);
    if (chosen && chosen.sel.side === "you" && chosen.sel.area === "hand" && !chosen.sel.areas?.length && !chosen.sel.special && !chosen.sel.fromVar)
      return [{ op: "reveal", sel: { fromVar: c.last }, as: "revealed" }];
  }
  if ((m = /^reveal (.+)$/.exec(t))) {
    // #1208, FS03-13: "look at 5 cards from the top of your deck, **reveal up to 1 <Paragus> or up to 1 Extra** and add it to
    // your hand": after a look a description that names no area of its own is read from the cards looked at (20-12),
    // as the choose, play and add clauses already do. Read bare it was a card in play.
    const lookedAt = c.lastOp === "look" && c.lastSeen && !AREA_WORDS.some(([re]) => re.test(m![1].toLowerCase())) ? parseTarget(m[1], c.lastSeen) : null;
    // The player picks which of them is shown (a choice among the cards looked at), then it is revealed; "the rest" is
    // what that choice leaves of the look.
    if (lookedAt && !lookedAt.special && lookedAt.fromVar === c.lastSeen) {
      const v = `c${c.n++}`;
      return [
        { op: "choose", sel: lookedAt, as: v, reason: clause },
        { op: "reveal", sel: { fromVar: v, ...(lookedAt.upTo ? { upTo: true as const } : {}) }, as: "revealed" },
      ];
    }
    const sel = parseTarget(m[1]);
    if (sel) return [{ op: "reveal", sel, as: "revealed" }];
    // "You may reveal **it**" (9-10, BT10-031/SD18-01): a bare pronoun is not
    // a description `parseTarget` reads, but it is exactly what `refFor`
    // resolves a replacement's subject to (`c.lastTarget`, seeded by the
    // opener that bound this clause into a replacement in the first place).
    const ref = refFor(m[1], c);
    if (ref && "sel" in ref) return [{ op: "reveal", sel: ref.sel, as: "revealed" }];
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
    // "…card―both red and with an energy cost of 4 or less―to your hand": the closing dash
    // of an aside is run up against "to", so the space before it is optional (#907).
    const add = c.lastSeen ? /^add (.+?)\s*to your hand$/.exec(t) : null;
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
  // 20-19: "You can use this card to pay energy costs even when it's in your
  // Battle Area" (BT3-039) — the card is rested where it stands, as one energy
  // of its own colours, and never moves.
  //
  // Only the **unscoped** permission is read here. Five cards in the catalog
  // print something in this family and four of them scope it — to the cards
  // whose cost is being paid ("when paying the energy cost of blue ≪Demon
  // Realm≫ cards in your hand", BT28-031/032), to one play ("when playing this
  // card", BT17-065), or to skill costs and a count per turn (BT28-106, read
  // whole as one sentence by `compile/index.ts`'s `scopedPayWith`). A scope
  // this op cannot carry is a permission wider than the card prints, which is
  // the one thing a reading must never be (ground rule 5), so those stay unread.
  if (/^use this card to pay energy costs?(?: even)?(?: when (?:it's|it is|this card is) in your battle area)?$/.test(t)) {
    return [{ op: "payWith" }];
  }
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
  //
  // #742: the same offer for the card's [Activate: Battle] line. Matched here
  // so that a wording `counterAltCost` cannot read stays unread rather than
  // falling through to the "activate … → play" rule below, which read every
  // one of the eleven as "choose this card, play the chosen cards".
  if (/^activate this card's \[(?:counter[^\]]*|activate: ?battle)\](?: skill)? from your hand /.test(t)) {
    const alt = counterAltCost(t, c);
    return alt?.every((o) => o.op !== "altCost" || o.pay !== "program") ? alt : null;
  }

  // "If …, you can activate this card's [Awaken] (skill) when your life is at 6 or less" (BT3-056,
  // BT6-105 and a few more): a standing permission to use the [Awaken] at a wider moment. It is not
  // an instruction to play the card, which the "activate … → play" reader below made of it (#907).
  // The engine has no widened [Awaken] moment, so it stays unread (ground rule 5).
  if (/^activate this card's \[awaken\]/.test(t)) return null;

  const skillScope = (raw: string): SkillScope | null => {
    // "…of [Counter] skills on yellow <Vegito> cards in your hand…", "…of this
    // card's [Counter] skill…", "[Z-Awaken] skill on {X} in your Z-Deck".
    const scoped = skillScopeOf(raw, c);
    if (scoped) return scoped;
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
  // "Increase this card's energy cost by the declared number for the turn"
  // (BT22-xxx Fortuneteller Baba's Palace cards, EX Android cards), "choose up
  // to 1 of your opponent's … Battle Cards and increase its energy cost by the
  // declared number": the amount is the X a `declare` bound earlier in the
  // program (20-21 reads a raise as a reduction turned round, as above).
  {
    const declaredCost =
      /^(increase|reduce|decrease)s? (this card|that card|its|their|the chosen cards?)'?s? energy costs? by the declared number$/.exec(qq) ??
      /^(this card|that card|its|their)'?s? energy costs? (increases?|reduces?|decreases?) by the declared number$/.exec(qq);
    if (declaredCost) {
      const verb = (declaredCost[1].startsWith("increase") || declaredCost[1].startsWith("reduce") || declaredCost[1].startsWith("decrease") ? declaredCost[1] : declaredCost[2]).replace(/s$/, "");
      const subject = (declaredCost[1].startsWith("increase") || declaredCost[1].startsWith("reduce") || declaredCost[1].startsWith("decrease") ? declaredCost[2] : declaredCost[1]).replace(/^its$/, "it").replace(/^their$/, "them");
      const target = refFor(subject, c);
      if (!target || (c.stale && target === c.stale)) return null;
      return [{ op: "costReduction", target, amount: { x: true, ...(verb === "increase" ? { times: -1 } : {}) }, until: durationOf(clause) }];
    }
  }
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
  // "...by an additional 1" (BT6-018): the second sentence's own reduction, which
  // stacks with the first sentence's (both hold at 10 or more).
  qq = qq.replace(/ by an additional (\d+|(?:\{[rugykbw\d]+\})+)$/i, " by $1");
  // "Reduce the [Z-Awaken] skill cost on {X} in your Z-Deck by {y}" (BT24-079b,
  // BT25-043, P-649, BT31-028): the keyword tag sits inside the noun phrase.
  // Said the other way round it is the shape the reducer below already reads.
  qq = qq.replace(/^(reduce|increase|decrease) the (\[[^\]]+\]) skill costs? (?:of|on) (.+?) by /i, "$1 the skill cost of the $2 skill on $3 by ");
  // BT26-043 prints "the energy cost o this card in your hand": a typo for "of".
  qq = qq.replace(/\bcost o (this card)\b/i, "cost of $1");
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
  // "During this turn, **ignore the specified costs on** ≪Shenron≫ Z-Unisons
  // in your Z-Deck" (EX24-03): the cards are treated as having no specified
  // cost (1-2-3-2) for the span — the same standing change [Warrior of
  // Universe 7] makes (22-19-2), here timed. The description must name its
  // place (a Z-Deck, hand…): a bare one would be every card in play.
  // "Treat ≪Agent of Destruction≫ cards in your hand as if they had no specified
  // cost" (BT6-047, EX13-29, P-434b), "treat this card in your hand as if it had no
  // specified cost" (P-203, P-321, SD16-05, BT12-153), "treat ≪Universe 9≫ cards in
  // all areas as if they have no specified cost" (P-268, TB2-065): 1-2-3-2 - the
  // specified cost is removed and the total is not reduced; the same standing change
  // [Warrior of Universe 7] makes (22-19-2). "In all areas" is the two places a price
  // is asked, the hand and the Z-Deck - the DSL's own reading of that keyword - and
  // the cards are the master's.
  if ((m = /^treat (.+?) as if (?:it|they) (?:has|have|had) no specified costs?(?: in all areas)?$/.exec(qq))) {
    let phrase = m[1].trim();
    const everywhere = /\bin all areas\b/.test(phrase) || /\bin all areas$/.test(qq);
    phrase = phrase.replace(/\s*\bin all areas\b/, "");
    if (/\boriginal\b|\bnon-|\bwith .* as part of\b/.test(phrase)) return null;
    if (/^this card\b/.test(phrase)) {
      const self = refFor(phrase, c);
      if (!self || !("sel" in self) || !self.sel.special) return null;
      return [{ op: "costReduction", target: self, amount: 0, what: "specified" as const, all: true, until: durationOf(clause) }];
    }
    if (!everywhere && !/\bin your (?:hand|z-deck)$/.test(phrase)) return null;
    const noun = /\b(?:cards?|unisons?|extras?|battle cards?)$/.test(phrase.replace(/\s*\bin your (?:hand|z-deck)$/, "")) ? phrase : phrase.replace(/(\s*\bin your (?:hand|z-deck))?$/, " cards$1");
    const place = everywhere ? "" : "";
    void place;
    const ref = refFor(everywhere ? `your ${noun}` : noun, c);
    if (!ref || !("sel" in ref) || ref.sel.special || (c.stale && ref === c.stale)) return null;
    const whole = { ...ref.sel };
    delete whole.count;
    delete whole.upTo;
    if (everywhere) {
      whole.areas = ["hand", "zDeck"];
      delete whole.area;
    }
    return [{ op: "costReduction", target: { sel: whole }, amount: 0, what: "specified" as const, all: true, until: durationOf(clause) }];
  }
  if ((m = /^ignore the specified costs? (?:of|on) (.+? in your [a-z-]+(?: area)?)(?: during this turn)?$/.exec(qq))) {
    const ref = refFor(m[1], c);
    if (!ref || !("sel" in ref) || ref.sel.special || (c.stale && ref === c.stale)) return null;
    // Every card the description covers, never "one of them": a plural noun
    // reads as a count of 1 here, and a choice is not what this says.
    const whole = { ...ref.sel };
    delete whole.count;
    delete whole.upTo;
    return [{ op: "costReduction", target: { sel: whole }, amount: 0, what: "specified" as const, all: true, until: durationOf(clause) }];
  }
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
  if ((m = /^(reduce|increase|decrease) the ((?:energy|skill|evolve|combo|z-energy) )?costs? (?:of|on) (.+?) by (\d+|(?:\{[rugykbw\d]+\})+),?(?: for (?:each|every) (?:(\d+) )?(.+))?$/.exec(qq))) {
    // 20-21 works in both directions, and the sets print both: "increase the
    // energy cost of this card in your Battle Area by 2" is the same standing
    // effect with the sign turned round; "decrease" already reads as "reduce".
    const sign = m[1] === "increase" ? -1 : 1;
    const kindWord = m[2];
    const targetText = m[3];
    const amountText = m[4];
    // "…by 1 for every 2 ≪Saiyan≫ cards" (BT13-076): whole steps of 2.
    const perStepOf = m[5] === undefined ? 1 : Number(m[5]);
    const perText = m[6];
    // The area the phrase names is part of the target, not noise: a reducer
    // for cards "in your hand" that selects cards in play does nothing at all,
    // which is what stripping it here used to produce.
    let ref = refFor(targetText, c);
    const kindWordTrim = kindWord?.trim();
    // "…the combo cost of A cards and B cards in all of your areas by 1": the
    // list is two descriptions with a shared area, one reduction each (#907).
    const listed = kindWordTrim !== "skill" && kindWordTrim !== "evolve" && /\sand\s/.test(targetText) && /\bin all of your areas$/i.test(targetText) ? refsFor(targetText, c) : null;
    let skillKind: SkillKindPrefix | undefined;
    let scopeTag: string | undefined;
    let scopeEvolve = false;
    if (kindWordTrim === "skill" || kindWordTrim === "evolve") {
      const scope = skillScope(targetText);
      if (!scope) return null;
      ref = scope.target;
      skillKind = scope.skillKind;
      scopeTag = scope.tag;
      scopeEvolve = !!scope.evolve;
      // "{X} in your hand" is every copy, not a choice of one (the skill's own price is per line).
      if ("sel" in ref && !ref.sel.special && ref.sel.count !== undefined) ref = { sel: { ...ref.sel, count: 99, upTo: undefined } };
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
    // "…the energy cost of **this card in your hand**" (BT7-005, #921): the
    // possessive normalisation above keeps the area only for the "for each"
    // reducer, so the plain one found the card wherever it was. The printed
    // scope is the hand, which is where a card is bought at (20-21).
    if (!skillKind && "sel" in ref && ref.sel.special === "self" && !ref.sel.area && /\bthis card\b[^,]*\bin your hand\b/i.test(clause)) {
      ref = { sel: { ...ref.sel, area: "hand" } };
    }
    const orbs = /^\d+$/.test(amountText) ? null : orbsIn(amountText);
    const flat: number = sign * (orbs ? Object.values(orbs).reduce<number>((sum, n) => sum + (n ?? 0), 0) : Number(amountText));
    let by: Amount = flat;
    if (perText) {
      const per = parseTarget(countAreasSaidWithAnd(perText));
      if (!per) return null;
      by = { count: { ...per, count: undefined, upTo: undefined }, ...(perStepOf > 1 ? { per: perStepOf } : {}), ...(flat === 1 ? {} : { times: flat }) };
    }
    // The duration is read off the printed clause, not the qualifier-stripped
    // one: "…for the duration of the turn" is exactly what `stripQualifiers`
    // takes off. A [Permanent] holds while its card is valid (9-5-1) and
    // `holdForGame` rewrites this to "game"; anywhere else it is what says how
    // long the change is in force.
    const what =
      scopeEvolve
        ? ({ what: "evolve" as const })
        : kindWordTrim === "combo"
        ? ({ what: "combo" as const })
        : kindWordTrim === "z-energy"
          ? ({ what: "zEnergy" as const })
          : kindWordTrim === "skill"
            ? ({ what: "skill" as const })
            : kindWordTrim === "evolve"
              ? ({ what: "evolve" as const })
              : {};
    return (listed && listed.length > 1 ? listed : [ref]).map((target) => ({ op: "costReduction", target, amount: by, ...what, ...(skillKind ? { skillKind } : {}), ...(scopeTag ? { tag: scopeTag } : {}), ...(orbs ? { colors: orbsToList(orbs) } : {}), until: durationOf(clause) }) as Op);
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
  // Phrasing batch 5: "…and negate **its** [energy-exhaust] skill in all areas" (EX18-05): the possessive pronoun, the
  // card the sentence is about — this card, in a [Permanent] that names no other.
  const itsSelf = !c.lastTarget || ("sel" in c.lastTarget && c.lastTarget.sel.special === "self");
  if ((m = /^negate its \[([a-z0-9\- ]+)\](?: skill)? in (?:all|any) areas?$/.exec(t)) && c.permanent && itsSelf) {
    const kw = keywordOf(m[1]);
    if (kw) return [{ op: "negateKeyword", keyword: kw.name, target: { sel: { special: "self" } } }];
  }
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
      const refs = refsFor(m[2], c);
      return refs ? refs.map((target) => ({ op: "negateKeyword", keyword: kw.name, target }) as Op) : null;
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

  // "[Permanent] You start the game with 6 life" (BT12-002, BT16-046, BT16-047,
  // BT19-100): 6-2-2-1 names exactly this line as a pre-game [Permanent], applied
  // where the Life Area is set up (6-2-1-10) in place of the 8 cards of the rule.
  if (c.permanent && (m = /^you start the game with (\d+) life$/.exec(t)) && Number(m[1]) >= 1) {
    return [{ op: "permit", what: "startLife", n: Number(m[1]), target: { sel: { special: "self" } }, until: "game" }];
  }

  // "[Permanent] You can only place up to 6 energy (in your Energy Area)" (BT3-032,
  // BT9-127, BT19-034 and their back faces): a limit on how many cards the Energy
  // Area holds, counted in cards (energy markers are not energy, 1-14-3). The
  // official card Q&A (BT3-032 Q1, BT19-034 via P-501 Q1) rules that it stops a
  // placement made by the Charge Phase and one made by a skill alike, so it is the
  // `energyCap` prohibition, in force while the Energy Area holds N or more.
  if (c.permanent && (m = /^only place up to (\d+) energy(?: in your energy area)?$/.exec(t)) && Number(m[1]) >= 1) {
    return [{ op: "forbid", what: "energyCap", side: "you", until: "game", unless: { kind: "count", sel: { side: "you", area: "energy" }, atMost: Number(m[1]) - 1 } }];
  }

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

  // "This card gains power equal to the total combo power of the cards
  // discarded by this skill for the turn" (BT20-090, BT20-107, BT20-108,
  // BT20-109): the cards the price discarded (4-3-3, 1-6), their combo powers
  // (1-2-8) added up as the skill resolves. Only when the price's choice is a
  // discard; a price that chose and did something else has no "discarded" cards.
  if ((m = /^(.*?) (?:gets?|gains?) power equal to the total combo power of the cards? (?:that (?:was|were) )?discarded by this skill$/.exec(q)) && c.priceChoice && c.priceDiscarded) {
    const ref = refFor(m[1], c);
    if (ref) return [{ op: "power", target: ref, amount: { sumOf: { fromVar: c.priceChoice }, attr: "comboPower" }, until: durationOf(t) }];
  }

  // 23-5-2-4: "Increase this card's power by the original power on the front
  // of the card that was switched to Hidden Mode by this skill" (BT28-105).
  // The card named is face down by then, and a skill naming a Hidden Mode
  // card reads its front side — the `originalPower` amount does (`measureOf`).
  // Only "this card": BT28-105b's "that card" points at a choice between a
  // Leader and a ≪Universe 7≫ Battle Card the target grammar cannot say.
  // "That card" (BT28-105b) is the choice just made, between a Leader and a
  // Battle Card (the "your Leaders or …" choice above).
  if ((m = /^increase (this card|that card)'?s power by the original power on the front of the card (?:that was )?switched to hidden mode by this skill$/.exec(q)) && c.priceChoice) {
    const target: Ref | null = m[1] === "this card" ? { sel: { special: "self" } } : c.last && c.last !== c.priceChoice ? { var: c.last } : null;
    if (!target) return null;
    return [{ op: "power", target, amount: { attr: { var: c.priceChoice }, name: "originalPower" }, until: durationOf(t) }];
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
  // "Choose all of your opponent's Battle Cards, and **they lose** -10000 power" (BT3-018, BT3-019, P-070b):
  // the plural verb is the same sentence.
  // Not "they **both** lose" (BT4-002b): two separate choices, of which a bare reference names only the last.
  if ((m = /^(.*?) loses? ([+-]?\d+) power$/.exec(q)) && !/\bboth\b/.test(m[1])) {
    const refs = refsFor(m[1], c);
    const until = durationOf(t);
    return refs ? refs.map((target) => ({ op: "power", target, amount: -Math.abs(Number(m![2])), until }) as Op) : null;
  }
  if ((m = /^(.*?) (?:gets?|gains?) ([+-]\d+) power$/.exec(q))) {
    const refs = refsFor(m[1], c);
    const until = durationOf(t);
    return refs ? refs.map((target) => ({ op: "power", target, amount: Number(m![2]), until }) as Op) : null;
  }
  // #907 round 4: "This card gets +10000 power for the battle, **and -10000 power during the next turn**"
  // (P-414, BT15-061b): the "and" leaves a second amount with no subject, for the card the first named.
  if ((m = /^([+-]\d+) power$/.exec(q)) && c.lastTarget && "sel" in c.lastTarget && c.lastTarget.sel.special === "self") {
    return [{ op: "power", target: c.lastTarget, amount: Number(m[1]), until: durationOf(t) }];
  }
  // #907 round 6: "Your Red/Green multicolor <Broly> cards in all areas get -1 combo cost **and -5000 combo power**"
  // (BT22-055b, BT23-072, BT23-072b): the second amount is for the cards the first named, the combo cost
  // reducer just before it.
  if ((m = /^([+-]\d+) combo power$/.exec(q)) && c.lastOp === "costReduction" && c.lastTarget && "sel" in c.lastTarget) {
    return [{ op: "comboPower", target: c.lastTarget, amount: Number(m[1]), until: durationOf(t) }];
  }
  // 2-8: "add +10000 to this card's Combo for the duration of the turn" (BT1-045, BT1-069, BT1-100) is the card's
  // combo power (the number it adds when used in a combo) raised by that much.
  if ((m = /^add ([+-]\d+) to (this card)'?s combo$/.exec(q))) {
    return [{ op: "comboPower", target: { sel: { special: "self" } }, amount: Number(m[1]), until: durationOf(t) }];
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
      /^(.*?) (?:gains?|is (?:also )?treated as(?: an?)?) ((?:(?:non-)?(?:\{[^}]+\}|<[^>]+>|≪[^≫]+≫|red|blue|green|yellow|black|white)[\s,]*(?:and\s+|or\s+)?)+)(?:\s*colou?rs?)?(?: in (all|any) areas?)?$/.exec(
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
    return ref ? [{ op: "gains", target: ref, traits: filter.traits, characters: filter.characters, colors, ...(filter.names.length ? { names: filter.names } : {}), ...(m[3] ? { allAreas: true } : {}) }] : null;
  }

  // Taking on another card's printed skills (20-18). Two wordings, and the
  // whole of both: "This card gains all of the chosen card's keyword skills
  // for the turn" (BT26-139), "Gain all of the chosen card's skills for the
  // duration of the turn" (BT3-049).
  // Phrasing batch 4: "…and this card gains **all skills of the chosen card** until the end of your opponent's turn"
  // (BT31-074, BT31-075, BT31-076, BT31-077) is the same copy with the card after the noun.
  if ((m = /^(.*?)\s*gains? all (?:of the )?(keyword )?skills of (the chosen card|that card|the chosen battle card)$/.exec(q))) {
    const target = refFor(m[1] || "this card", c);
    const from = copiedFrom(m[3], c);
    if (target && from) return [{ op: "copySkills", target, from, which: "all", ...(m[2] ? { only: "keyword" as const } : {}), until: durationOf(t) }];
    return null;
  }
  if ((m = /^(.*?)\s*gains? all of (?:the )?(.+?)'s (keyword )?skills$/.exec(q))) {
    const target = refFor(m[1] || "this card", c);
    // "…all of **the chosen card's** skills": the possessive is stripped by
    // the pattern, so the article goes back on before `refFor` reads it.
    const from = copiedFrom(/^(?:the|that|those|its|their)\b/.test(m[2]) ? m[2] : `the ${m[2]}`, c);
    if (target && from) return [{ op: "copySkills", target, from, which: "all", ...(m[3] ? { only: "keyword" as const } : {}), until: durationOf(t) }];
    return null;
  }
  // The other wording, merged into one clause by `compileClauseList` because
  // neither half means anything alone: "Choose up to 1 keyword skill on a card
  // placed under this card, and this card gains that skill until the end of
  // your opponent's next turn" (BT20-028). The choice is among the *skills* of
  // whatever the phrase finds, which is what `copySkills` asks when it is told
  // neither "all" nor an index.
  if ((m = /^choose (?:up to )?\d+ (?:of (?:the )?(.+?)'s (keyword )?skills?|(keyword )?skills? (?:on|of|from|in) (.+?)), (?:and )?(.*?) gains? that skill$/.exec(q))) {
    const src = m[1] ?? m[4];
    const from = copiedFrom(/^(?:the|that|those|its|their|a|an|\d)\b/.test(src) ? src : `the ${src}`, c);
    const target = refFor(m[5] || "this card", c);
    if (from && target) return [{ op: "copySkills", target, from, ...(m[2] ?? m[3] ? { only: "keyword" as const } : {}), until: durationOf(t) }];
    return null;
  }

  // 9-1-5: "Choose up to 1 keyword skill on 1 of your opponent's Battle Cards
  // and negate that skill for the turn" (BT31-138, BT8-045b, BT6-057), merged
  // into one clause by `compileClauseList` like the copy above. The choice is of
  // a *skill*, so no card is chosen first: every card the phrase finds is
  // offered, and the count printed on the cards ("1 of …") is the skill's, not
  // a choice of cards — kept, it would have made this a choice of a card and
  // negated all of its skills, which is what it used to read as.
  if ((m = /^choose (?:up to )?(?:\d+|a|an|one) (?:of (?:the )?)?keyword skills? (?:on|of) (.+?),? (?:and )?(?:negate (?:it|that skill)|that skill is negated)$/.exec(q))) {
    const ref = refFor(m[1], c);
    if (!ref) return null;
    if ("sel" in ref && !ref.sel.special) {
      const every = { ...ref.sel };
      delete every.count;
      delete every.upTo;
      return [{ op: "negateChosenKeyword", target: { sel: every }, until: durationOf(t) }];
    }
    return [{ op: "negateChosenKeyword", target: ref, until: durationOf(t) }];
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
    // Phrasing batch 4: "…it's **sent to** its owner's Warp instead of being played" (BT8-104, BT10-143, BT11-146) is
    // the same move to the Warp as "placed in" it (3-10).
    const tSent = t.replace(/^(it'?s|it is|that card is|the (?:battle |extra |unison )?card being played is) sent to (its owner'?s?|their owners?'?s?|your|their) (warps?) instead of being played$/, "$1 placed in $2 $3 instead of being played");
    const stopped =
      /^(?:it'?s|it is|that card is|the (?:battle |extra |unison )?card being played is) (?:(?:placed|put) (?:in|into|at) (?:its owner'?s?|their owners?'?s?|your|the|their) (?:(drop)(?: area)?|bottom of (?:its owner'?s?|their|your) deck|(warp)s?)|(?:returned) to (?:its owner'?s?|their owners?'?s?|your|their) (hand)s?)(?: instead)?(?: of being played)?$/.exec(
        tSent,
      );
    // The same said actively: "place it in its owner's Drop **instead of
    // playing it**" (BT29-112) — only a play being resolved is something a
    // card can be placed somewhere instead of playing.
    const placedInstead = /^place (?:it|that card|the (?:battle |extra |unison )?card being played) (?:in|into|at) (?:its owner'?s?|their owners?'?s?|your|the|their) (?:(drop)(?: area)?|bottom of (?:its owner'?s?|their|your) deck|(warp)s?) instead of playing it$/.exec(t);
    if (placedInstead) {
      const to: ScriptArea = placedInstead[1] ? "drop" : placedInstead[2] ? "warp" : "deck";
      return [{ op: "resolvingPlay", instead: to, ...(to === "deck" ? { position: "bottom" as const } : {}) }];
    }
    if (stopped && /instead of being played|instead$/.test(t)) {
      // 22-13-4-5-1-1 names the hand form specially: a card "returned to its
      // owner's hand instead of being played" does *not* then go to the Drop.
      const to: ScriptArea = stopped[1] ? "drop" : stopped[2] ? "warp" : stopped[3] ? "hand" : "deck";
      return [{ op: "resolvingPlay", instead: to, ...(to === "deck" ? { position: "bottom" as const } : {}) }];
    }
    // "The Battle Card being played is played in Rest Mode" (BT10-105).
    // "The Battle Card **played** is played in Rest Mode" (BT1-110) says the same
    // as "being played"; both name the card whose play is resolving (9-6).
    const THE_PLAY = String.raw`(?:it'?s|it is|that card is|the (?:battle |extra |unison )?card (?:being played|played|(?:that )?your opponent is playing) is)`;
    const SKILLS_OFF = String.raw`(?:its|their) skills? negated(?: for the (?:duration of the )?turn)?`;
    if (new RegExp(String.raw`^${THE_PLAY} played in rest mode$`).test(t)) return [{ op: "resolvingPlay", mode: "rest" }];
    // "It's played with its skills negated for the turn" (BT11-099).
    if (new RegExp(String.raw`^${THE_PLAY} played with ${SKILLS_OFF}$`).test(t)) return [{ op: "resolvingPlay", negated: true }];
    // Both said at once: "played in Rest Mode with its skills negated for the
    // turn" (EB1-46, DB2-128).
    if (new RegExp(String.raw`^${THE_PLAY} played in rest mode with ${SKILLS_OFF}$`).test(t)) return [{ op: "resolvingPlay", mode: "rest", negated: true }];
    // "The Battle Card played **has its skill negated** for the duration of the
    // turn" (BT1-107): the play goes ahead and the card arrives negated.
    if (/^(?:it|that card|the (?:battle |extra |unison )?card (?:being )?played) (?:has|have) (?:its|their) skills? negated(?: for the (?:duration of the )?turn)?$/.test(t)) return [{ op: "resolvingPlay", negated: true }];
    // Phrasing batch 3 (owner's ruling of 26 Oct 2026 on BT14-154): "[Counter: Play] Play this card, then … **The played
    // Battle Card has its skills negated for the turn**" — the played card is the opponent's card whose play the counter
    // answers (9-6), not this card, which the skill played itself. Only in a [Counter: Play]: anywhere else "the played
    // card" is a play the skill made.
    if (c.skillKind === "counter:play" && /^the played (?:battle |extra |unison )?card (?:has|have) (?:its|their) skills? negated(?: for the (?:duration of the )?turn)?$/.test(t)) return [{ op: "resolvingPlay", negated: true }];
  }

  // Negation (9-1).
  if (/^negate (?:the|that|this) attack$/.test(t)) return [{ op: "negateAttack" }];
  // Phrasing batch 2: "…negate that attack **and this skill for the duration of the turn**" (BT6-002b, TB1-050b): the
  // "and" left the second thing negated without its verb — this skill, for the turn, as "negate this skill for the turn".
  if (/^this skill for the (?:duration of the )?turn$/.test(t) && c.lastOp === "negateAttack") return [{ op: "negateOwnSkill", until: "turn" }];
  // Phrasing batch 2: "[Counter: Play] **When the Battle Card is played**, choose up to 2 of your opponent's Battle
  // Cards …" (BT9-020): the [Counter: Play]'s own moment said again (9-6), which adds nothing to read.
  if (/^when the (?:battle |unison |extra )?card is played$/.test(t) && c.skillKind === "counter:play") return [];
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
  // Not the bare "the": "Negate **the** [Counter] skill" (BT11-042, BT30-150, P-418, #907 round 5) names no card, it is
  // the [Counter] this one answers (9-7), read further down. It used to be caught here, find no card, and stay unread.
  if ((m = /^negate (.*?)(?:'s)? \[(auto|activate[^\]]*|counter[^\]]*|permanent)\] skills?$/.exec(q)) && m[1] !== "the") {
    const ref = refFor(m[1], c);
    const kind = m[2].split(":")[0].trim() as SkillKindPrefix;
    return ref ? [{ op: "negateSkillsOfKind", target: ref, kind, until: durationOf(t) }] : null;
  }
  // Phrasing batch 4 (owner's approval of 26 Oct 2026): "negate **its non-keyword skills**" (DB3-024), "negate that
  // card's non-keyword skills" (BT21-063), "…and have their non-keyword skills negated for the duration of the turn"
  // (BT8-115) switch off the [Auto], [Activate] and [Permanent] skills and leave the keyword skills — [Blocker],
  // [Barrier], [Double Strike], [Counter] (9-7-1, 22-1-1) — working. They used to read as every skill of the card.
  // (Phrasing batch 5 reads the inverse half, "its **keyword** skills", only where a play says it — `negateHalf`. Not
  // here yet: EB1-07's "…and has its keyword skills negated for the turn" is followed by a "you can't activate …" that
  // `connective` skips as a reminder, and BT31-002b's is a [Permanent], which no standing reader collects.)
  if ((m = /^negate (.*?)(?:'s)? non-keyword skills$/.exec(q)) || (m = /^(?:(it|they|that card|those cards|the chosen cards?) )?(?:has|have) (?:its|their) non-keyword skills negated(?: (?:for|until) .*)?$/.exec(q))) {
    const ref = m[1] ? refFor(m[1], c) : c.lastTarget;
    return ref ? negateNonKeyword(ref, durationOf(t)) : null;
  }
  // #907 round 4: "...it gets +5000 power **and has its skills negated for the turn**" (BT13-117, BT15-057,
  // BT17-109, ...): the "and" cuts the clause, and the half left carries no subject - it is the card the
  // sentence just chose. All of its skills, for the span named (9-1-5); the pronoun reads like the
  // "negate it" below.
  if ((m = /^(?:(it|they|that card|those cards|the chosen cards?) )?(?:has|have) (?:its|their) skills negated(?: (?:for|until) .*)?$/.exec(q)) && (m[1] || c.lastTarget)) {
    const ref = m[1] ? refFor(m[1], c) : c.lastTarget;
    return ref ? [{ op: "negateSkills", target: ref, until: durationOf(t) }] : null;
  }
  // Phrasing batch 2: "…choose up to 2 ≪Frieza Clan≫ … from your hand and play them. **Their skills are negated** for
  // the duration of the game" (BT2-103): the cards the sentence before named. Not "…until the end of your opponent's
  // next turn, its skills are negated and it can't attack" (EX17-04): there the span opens the sentence and closes
  // both halves, which the prohibition after it does not carry.
  if (/^(?:their|its) skills? (?:are|is) negated(?: for .*)?$/.test(t) && c.lastTarget && !("sel" in c.lastTarget && c.lastTarget.sel.special === "self")) {
    return [{ op: "negateSkills", target: c.lastTarget, until: durationOf(t) }];
  }
  // Prohibition batch 6: "…play the Unison Card under this card … with 2
  // markers on it **and its skills negated for the game**" (BT15-129): the
  // "with" of the play reaches past its "and", which cut the sentence there;
  // the card played (the last named) has its skills negated for that span.
  if (/^(?:its|their) skills? negated for the (?:duration of the )?(?:game|turn)$/.test(t) && c.lastTarget && !("sel" in c.lastTarget && c.lastTarget.sel.special === "self") && /\bplay\b[^.]*\bwith \d+ markers? on (?:it|them) and (?:its|their) skills? negated\b/i.test(c.raw)) {
    return [{ op: "negateSkills", target: c.lastTarget, until: durationOf(t) }];
  }
  // Prohibition batch 6: "…choose all of your opponent's Battle Cards …, and
  // **for the duration of the turn their skills are negated**, and they can't
  // be placed in a Combo Area …" (SD10-04): the same, the turn said first.
  if (/^for the (?:duration of the )?turn,? (?:their|its) skills? (?:are|is) negated$/.test(t) && c.lastTarget && !("sel" in c.lastTarget && c.lastTarget.sel.special === "self")) {
    return [{ op: "negateSkills", target: c.lastTarget, until: "turn" }];
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
  // #930: "you can only play Battle Cards by using [Union-Fusion]" arrives
  // here as "only play …" — the leading "you can" is stripped above.
  if (/\bcan only\b|\bcan'?t\b|\bcannot\b|\bwill not\b|\bwon'?t\b|^only play battle cards\b|^only use [a-z ,/]+ card skills to place cards under this card\b/.test(t)) {
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
  // Only the bare "[Counter]" (#907 round 5): "Negate the [Counter: Attack] skill" (EX09-06) names the kind of counter
  // it answers, which `negateCounter` does not ask, so that one stays unread rather than answer a Counter: Play too.
  if (/^negate the \[counter\](?: skill)?$/.test(t)) return [{ op: "negateCounter" }];

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

  // 5-7 lifted: "you can use your mono-red Rest Mode ≪Saiyan≫ cards in
  // combos" (BT18-001), "during this turn, you can use white Rest Mode
  // <Vegeta: GT> cards in combos" (BT29-129). A combo normally takes a card
  // from the hand or an Active Battle Card; this lets the rested ones in.
  if ((m = /^(?:during this turn,? )?(?:you (?:can|may) )?use (?:your )?(.*?)\s*rest mode (.*?)cards? in combos?(?: during this turn| for the turn)?$/.exec(t))) {
    const said = `${m[1]} ${m[2]}card`.trim();
    const filter = filterFor(said, null);
    if (filter === null) return null;
    const until: Duration = /during this turn|for the turn/.test(t) ? "turn" : durationOf(t);
    return [{ op: "permit", what: "comboRest", target: { sel: { special: "self" } }, until, ...(filter ? { filter } : {}) }];
  }

  // 22-15 widened (owner-approved 2 Oct 2026): "[Permanent] This card's [Over
  // Realm] skill can be activated from its owner's Warp under the same
  // conditions as if it were in your hand" (BT31-150). [Over Realm] is used
  // from the hand; this lets the same line be used from the Warp. A
  // [Permanent] only — read while the card is in the Warp.
  if (c.permanent && /^this card'?s \[(?:dark )?over realm\] skill can be activated from (?:its owner'?s|your) warp under the same conditions as (?:if it were|when it is) in (?:your|its owner'?s) hand$/.test(t)) {
    return [{ op: "permit", what: "overRealmFromWarp", target: { sel: { special: "self" } }, until: "game" }];
  }

  // 22-3 widened: "The [Field] skill on this card in your hand can also be
  // activated at [Activate: Battle] timings" (BT29-041, BT29-042). [Field] is
  // an [Activate: Main]; this lets its own line be used at the combo prompt
  // too. A [Permanent] only — read from the hand, where the line is used.
  if (c.permanent && /^the \[field\] skill on this card in your hand can (?:also )?be activated at \[activate: ?battle\] timings?$/.test(t)) {
    return [{ op: "permit", what: "fieldBattle", target: { sel: { special: "self" } }, until: "game" }];
  }

  // 20-9: "gain control of it until the end of the turn", "you gain control of
  // it", "gain control of the played card". Six cards, every one of them
  // pointing back at a card an earlier clause chose or a trigger named, which
  // is why no selector is read here — `refFor` answers the pronoun and the
  // choice has already happened.
  //
  // A duration is only carried when one is *printed*: `durationOf` answers
  // "turn" for a clause that names none, and control that quietly ended at the
  // End Phase would be a different card from one that says nothing about
  // giving the card back (20-9 sets no term of its own).
  if ((m = /^(?:(you|your opponent) )?gains? control of (.+)$/.exec(q))) {
    const phrase = m[2].trim();
    const ref = refFor(phrase, c);
    if (!ref) return null;
    // Two guard rails, both found by diffing the readings rather than the
    // coverage figure — a clause that compiles and points at the wrong card
    // moves no number and is worse than a gap.
    //
    // `refFor` falls back to *this card* for a pronoun with nothing else to
    // resolve against, and a card cannot take control of itself from the
    // player already mastering it: BT21-063's "you gain control of it" comes
    // after "place this card under that card", so the pronoun's antecedent is
    // the card underneath, which is the one thing it cannot mean. Self is
    // accepted only where the print says so — "your opponent gains control of
    // **this card**" (BT19-055, P-277, P-564) and P-413, which plays this card
    // onto an opponent's and then takes the result.
    if ("sel" in ref && ref.sel.special === "self" && !/^this card$/.test(phrase)) return null;
    // The same fallback, the other way: "the played card" means the card the
    // trigger was about, and with nothing playing it falls back to the last
    // *choice* — which on BT19-154 is one of your own Battle Cards, sent to
    // the Warp as the price.
    if (/\bplayed card\b/.test(phrase) && !c.lastPlayed) return null;
    return [{ op: "control", target: ref, ...(m[1] === "your opponent" ? { to: "opponent" as const } : {}), ...(DURATION_TAIL.test(t) ? { until: durationOf(t) } : {}) }];
  }

  // #930, BT26-088: "…reveal 1 mono-green <Vegito> card from your hand and
  // **switch the same number of your green energy as that card's specified
  // cost to Rest Mode**": exactly as many of your Active Mode energy of that
  // colour as the revealed card's specified cost (1-2-3: the coloured part of
  // its cost), counted as the choice is made (`choose`'s `exactly`). "That
  // card" is the card a reveal just bound, and nothing else.
  if ((m = /^switch the same number of your ((?:[a-z]+ )?)energy as that card's specified cost to rest mode$/.exec(t))) {
    if (!c.lastSeen) return null;
    const sel = parseTarget(`1 of your ${m[1]}energy`);
    if (!sel || sel.side !== "you" || sel.area !== "energy" || sel.filter?.unreadable) return null;
    const v = `c${c.n++}`;
    const rest: Selector = { ...sel };
    delete rest.count;
    return [
      { op: "choose", sel: { ...rest, mode: "active" }, exactly: { attr: { var: c.lastSeen }, name: "specifiedCost" }, as: v, reason: clause },
      { op: "switchMode", target: { var: v }, mode: "rest" },
    ];
  }

  // Mode switches (1-10).
  // A few cards drop the word: "switch 1 of your Chilled Army tokens to rest".
  if ((m = /^switch (.*?) to (active|rest)(?: mode)?$/.exec(t))) {
    const mode = m[2] as "active" | "rest";
    // "The same number of <cards> as <a measure>" is a count, never the card
    // the measure is of: read as "that card" it switched the revealed card
    // (BT26-088). Only the form above reads it.
    if (/\bthe same number of\b/.test(m[1])) return null;
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
  // side is left as it is. "Flip this card **to its back side**" (BT29-029)
  // is the same one-way flip, said the long way — read for this card only:
  // the long form about "your Leader" or a card in the life is a separate
  // wording family, left for its own audit.
  // Prohibition batch 6: "flip this card over" turns it whichever side it
  // shows (a Leader's back that prints it, BT12-001, turns back to the front),
  // so the one-way forms say which way (`to`): "to its back (side)", "onto its
  // back", and "to its front" (BT15-091's back).
  if ((m = /^(?:you may )?flip (.+?) over$/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "flip", target: ref }] : null;
  }
  if ((m = /^(?:you may )?flip (.+?) onto its back$/.exec(t)) || (m = /^(?:you may )?flip (this card) to its (back|front)(?: side)?$/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? [{ op: "flip", target: ref, to: m[2] === "front" ? "front" : "back" }] : null;
  }
  // Phrasing batch 1, the Leader family of the same one-way flip (22-2-4):
  // "flip your Leader [Card] to its back side" (BT26-067, EX13-24, EX25-30),
  // "flip 1 of your Leaders to its back side" (P-473), "flip your yellow
  // <Launch> Leader with an original power of 5000 to its back side" (BT31-066,
  // BT31-081), "flip over up to 1 of your blue <Goku Black>-only Leader Cards"
  // (EX19-08). Only Leaders, only to the back: "to its front side" turns an
  // awakened Leader back, which the `flip` op does not do, and stays unread.
  if ((m = /^(?:you may )?flip (?:over )?(your leader(?: card)?|(?:up to )?1 of your (?:.+? )?leader(?: card)?s|your .+? leader(?: card)?(?: with .+)?)(?: to its back(?: side)?)?$/.exec(t)) && (/ to its back(?: side)?$/.test(t) || /^(?:you may )?flip over /.test(t))) {
    // Prohibition batch 6: the Leader family is one-way, to the back, as it
    // always was — "flip over up to 1 of your … Leader Cards" (EX19-08) is an
    // awakening, not a turn back to the front.
    const to = { to: "back" as const };
    if (/^your leader(?: card)?$/.test(m[1])) return [{ op: "flip", target: { sel: { special: "leader" } }, ...to }];
    const sel = parseTarget(m[1].replace(/\bleader( card)?s\b/, "cards").replace(/\bleader( card)?\b/, "card"));
    if (!sel || sel.special || sel.fromVar || sel.filter?.unreadable || (sel.side ?? "you") !== "you") return null;
    const counted = /^(?:up to )?1 of /.test(m[1]);
    const leaders: Selector = { ...sel, side: "you", area: "leader" };
    delete leaders.areas;
    if (!counted) {
      delete leaders.count;
      delete leaders.upTo;
      return [{ op: "flip", target: { sel: leaders }, ...to }];
    }
    return withChoice({ sel: { ...leaders, count: 1 } }, clause, c, (target) => ({ op: "flip", target, ...to }));
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
  // "Your opponent adds 2 cards from their hand to their energy in Hidden
  // Mode" (BT28-136): their choice, out of their own hand (5-2), and the
  // cards arrive face down (1-10-2) — no colour to pay with (23-5-2).
  if ((m = /^your opponent adds (\d+) cards? from their hand to their energy(?: area)?( in hidden mode)?$/.exec(t))) {
    const v = `c${c.n++}`;
    const n = Number(m[1]);
    return [
      { op: "choose", sel: { side: "opponent", area: "hand", count: n }, as: v, chooser: "opponent", reason: clause },
      { op: "moveTo", target: { var: v }, to: "energy" },
      ...(m[2] ? [{ op: "hidden", target: { var: v }, hidden: true } as Op] : []),
    ];
  }
  // "Your opponent adds 1 card from their hand to their Z-Energy" (BT21-039,
  // BT21-058, BT21-059, BT23-067, BT23-068, BT25-128): their choice, out of
  // their own hand (5-2), arriving in their Z-Energy Area. The same shape as
  // the Energy Area line above.
  // After "your opponent draws 1 card **and** adds 1 card from their hand …"
  // (BT21-039) the split leaves the verb without its subject; "their hand" is
  // the opponent's, the only third person these cards ever speak of.
  if ((m = /^(?:your opponent adds|add) (\d+) cards? from their hand to their z-energy$/.exec(t))) {
    const v = `c${c.n++}`;
    return [
      { op: "choose", sel: { side: "opponent", area: "hand", count: Number(m[1]) }, as: v, chooser: "opponent", reason: clause },
      { op: "moveTo", target: { var: v }, to: "zEnergy" },
    ];
  }
  // 23-5: "switch it to Revealed Mode or Hidden Mode" (BT28-150). A card is
  // in exactly one of the two, and switching it to the one it is in does
  // nothing (0-2-4-1), so the only switch the choice can make is to the other
  // one — read as that, for the one chosen card the sentence is about.
  if ((m = /^switch (.+?) to (?:revealed mode or hidden mode|hidden mode or revealed mode)$/.exec(t))) {
    // "Switch up to 1 of your energy to …" (BT30-112) chooses first; the
    // switch then reads the one card chosen, which is all it is ever said of.
    const ref = refFor(m[1], c);
    if (!ref) return null;
    const toggle = (target: Ref): Op =>
      "var" in target
        ? { op: "if", cond: { kind: "count", sel: { fromVar: target.var, hidden: true }, atLeast: 1 }, then: [{ op: "hidden", target, hidden: false }], else: [{ op: "hidden", target, hidden: true }] }
        : { op: "note", text: clause };
    const ops = withChoice(ref, clause, c, toggle);
    const last = ops[ops.length - 1];
    if (last.op !== "if" || ("sel" in ref && (ref.sel.count ?? 99) > 1)) return null;
    return ops;
  }
  // "Switch this card to Revealed Mode with 1 marker on it" (BT31-148):
  // the switch, then the marker (1-11).
  if ((m = /^switch (.+?) to (hidden|revealed) mode with (\d+) markers? on (?:it|them)$/.exec(t))) {
    const ref = refFor(m[1], c);
    const hidden = m[2] === "hidden";
    const n = Number(m[3]);
    if (!ref) return null;
    let switched: Ref = ref;
    const ops = withChoice(ref, clause, c, (target) => {
      switched = target;
      return { op: "hidden", target, hidden };
    });
    return [...ops, { op: "addMarker", target: switched, n }];
  }
  // 23-5: "switch it to Hidden Mode", "switch it to Revealed Mode".
  if ((m = /^switch (.+?) to (hidden|revealed) mode$/.exec(t))) {
    const ref = refFor(m[1], c);
    const hidden = m[2] === "hidden";
    return ref
      ? withChoice(ref, clause, c, (target) => {
          if ("var" in target) c.switchedHere = target.var;
          // "…switch the card that was switched to Hidden Mode by this skill to
          // Revealed Mode" (BT28-121, official Q&A): only while it is still in
          // that Hidden Mode — not after another skill revealed it and it was
          // hidden again.
          return { op: "hidden", target, hidden, ...(!hidden && SWITCHED_BY_THIS_SKILL.test(m![1]) ? { sameHiding: true } : {}) };
        })
      : null;
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
    const negated = !!m[4];
    // "Use this card **under a {Universal Tuffleization Plan} in a Battle Area** in a combo" (BT21-049),
    // "from under a {Destroyed West City} in your Battle Area" (BT23-018, BT23-019, #907): the card is used from
    // the pile under the named card - the same test as "if this card is under {X}" (`onTop`), asked before the combo.
    // "…from under a yellow ≪Great Ape≫ card with an energy cost of 4 **that's in a battle**" (BT24-091, BT24-092): the
    // host is also in the battle (`inBattle` over the card on top). A host described any further is a reading the
    // filter cannot make: refused.
    const under = /^this card(?: in a combo)? (?:from )?under (.+?)(?: in (?:a|your) battle area)?$/.exec(m[1]);
    if (under) {
      if (from) return null;
      const inBattleHost = /\s+(?:that'?s|that is|which is) in a battle$/.exec(under[1]);
      const hostText = inBattleHost ? under[1].slice(0, inBattleHost.index) : under[1];
      const host = /\b(?:that'?s|that is|which is) in a battle\b/.test(hostText) ? null : filterFor(hostText, null);
      if (!host) return null;
      const hostSel: Selector = { special: "onTop", filter: host };
      const cond: Cond = inBattleHost ? { kind: "inBattle", sel: hostSel } : { kind: "count", sel: hostSel, atLeast: 1 };
      return [{ op: "if", cond, then: [{ op: "comboFrom", target: { sel: { special: "self" } }, ...(negated ? { negated } : {}) }] }];
    }
    // "Use this card in a combo **from your Drop**" (BT18-082 and its family): the area is where the card is
    // used from (9-1-3-2), which `selfFrom` reads off "this card from …" - not "this card in your Drop".
    const selfFromArea = /^use this card(?: in a combo)?(?: from (your|its owner's|their|our) (hand|drop(?: area)?|warp|energy(?: area)?|deck))(?: in a combo)?( with (?:its|their) skills negated)?$/.exec(q);
    if (selfFromArea) {
      return [{ op: "comboFrom", target: { sel: selfFrom(`this card from ${selfFromArea[1]} ${selfFromArea[2]}`) }, ...(selfFromArea[3] ? { negated: true } : {}) }];
    }
    let ref = refFor(from ? `${m[1]} in your ${from}` : m[1], c);
    // "Look at up to 5 cards from the top of your deck, **use up to 1 mono-green ≪Demon Clan≫ card in a combo** …"
    // (P-703, #907): after a look, a description that names no area of its own is read from the cards looked at
    // (20-12), as the `play` and `add … to your hand` clauses already do. Read as an unqualified card it was
    // one already in play.
    if (c.lastSeen && !from && ref && "sel" in ref && !ref.sel.special && !ref.sel.fromVar && !AREA_WORDS.some(([re]) => re.test(m![1]))) {
      const sel = parseTarget(m[1], c.lastSeen);
      if (sel && !sel.special) ref = { sel };
    }
    return ref ? withChoice(ref, clause, c, (target) => ({ op: "comboFrom", target, ...(negated ? { negated } : {}) })) : null;
  }
  // "Switch the target of the attack to it / to this card" (8-1, as a [Blocker] does).
  if ((m = /^(?:switch|change) the (?:target of (?:the )?attack|attack target) to (.+)$/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? withChoice(ref, clause, c, (target) => ({ op: "redirectAttack", target })) : null;
  }
  // Phrasing batch 5: "Play this card from your hand in Rest Mode **and switch the attack card to this card**" (BT25-145,
  // BT30-021): this card takes the attacking card's seat in the battle (8-1-7-2) — `swapBattle` on this card, which
  // becomes the attack card in place of the one attacking.
  if (/^switch the attack(?:ing)? card to this card$/.test(t) && c.skillKind?.startsWith("activate")) return [{ op: "swapBattle", target: { sel: { special: "self" } } }];
  // "Switch your card that's in a battle with this card / the chosen card"
  // (8-1-7-2): the named card takes your seat in the battle, attacking or
  // guarding (BT30-098, BT31-085).
  if ((m = /^switch your card (?:that['’]s|that is) in (?:a|the) battle with (.+)$/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? withChoice(ref, clause, c, (target) => ({ op: "swapBattle", target })) : null;
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
  // A counted target is a choice first (`withChoice`): "place **up to 3**
  // cards … from your Drop under this card" (BT29-030) handed the selector
  // straight to the move, which takes every card it matches.
  if ((m = /^(?:place|put) (.+?) (?:face ?up )?under this card$/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? withChoice(ref, clause, c, (target) => ({ op: "moveTo", target, to: "under" })) : null;
  }
  // "Place a Z-Extra / 1 Z-Extra / a {Destroyed West City} from under this card
  // on top of this card" (BT31-005, BT31-004, BT23-007; 23-2, 21-5-2): one card
  // of this card's own pile comes to the top in its place. The card is counted,
  // so it is a choice (`withChoice`): with several matching pile cards the
  // player picks which. Read below as "this card goes under the card", it named
  // a pile card as the host by a selector, which no move can stand on.
  if ((m = /^(?:place|put) ((?:a|an|1|one|up to 1) .+?) from under this card on top of this card$/.exec(t))) {
    const ref = refFor(`${m[1]} from under this card`, c);
    if (!ref || !("sel" in ref) || ref.sel.area !== "under" || ref.sel.count !== 1) return null;
    return withChoice(ref, clause, c, (target) => ({ op: "placeOnTop", target }));
  }
  // The same stack said from the other end: this card ends up underneath.
  if ((m = /^(?:place|put) (.+?) on top of this card$/.exec(t))) {
    const host = refFor(m[1], c);
    // #930, [Union-Absorb] (22-13-6-3): "Choose up to 1 <Cell> from your deck
    // and place it on top of this card" (BT2-085, BT2-086, BT2-027, BT2-109,
    // BT3-020, BT3-022, BT3-048, BT3-050) is the Absorb's own play — the chosen
    // card, which is in the deck, hand, Drop or Warp, is played on top of this
    // one. The stack read below moves *this* card under the chosen one, which
    // only makes sense when the chosen card is in play: under a deck card it
    // moved the absorber nowhere and played nothing.
    if (host && "var" in host) {
      const from = c.choices.find((ch) => ch.var === host.var)?.sel;
      if (from && !from.areas?.length && from.side === "you" && from.area && ["deck", "hand", "drop", "warp"].includes(from.area)) {
        const onto = hostOf("this card", c);
        if (onto) {
          c.lastPlayed = host.var;
          return [{ op: "play", target: host, onto }];
        }
      }
    }
    return host ? [{ op: "moveTo", target: { sel: { special: "self" } }, to: "under", under: host }] : null;
  }
  // "…choose up to 1 of your red Unison Cards with [Rejuvenate] in its skill
  // text and place this card under it **from its owner's Drop Area**"
  // (BT12-007, BT12-037, BT12-067, BT12-107): this card is in the Drop when the
  // end of the battle comes (it was used in a combo), and the words say so, so
  // the move takes it from there. No Unison chosen, no host, and the card stays
  // where it is: the choice is "up to 1".
  if ((m = /^(?:place|put) this card under (it|that card|the chosen [^,.]+) from (?:its owner'?s?|your) drop(?: area)?$/.exec(t))) {
    const host = refFor(m[1], c);
    return host && "var" in host ? [{ op: "moveTo", target: { sel: { special: "self", area: "drop" } }, to: "under", under: host }] : null;
  }
  // "Place this card under the played card", "place it under the card you
  // played with this skill", "…under your Leader", "…under {Wickedest Clan}":
  // hosts the text names precisely, so no guessing.
  // "Choose 1 {Spaceship, Vessel of Hope} in your Unison Area **and place this
  // card under it**": "it" is the card the clause before just chose, which is
  // the only antecedent it can have — the host is never the card being placed.
  // Phrasing batch 3: the host named by a counted description, chosen as #1123's "a {Spirit Bomb}" is (`hostChoice`) —
  // "under **a {Dr.Uiro's Lab} in your Battle Area**" (BT8-058, P-370), "under **a <Majin Buu> card in your Battle
  // Area**" (BT9-085), "under **one of your {Universal Tuffleization Plan} cards**" (BT21-041), "under **1 of your green
  // <Broly: Br> cards**" (BT19-073) — and the Leader named with its description, "under **your <Fin> Leader**" (P-639).
  if (
    (m =
      /^(?:place|put) (.+?) (?:face ?up )?under (the chosen [^,.]+|the played card|the card (?:that was |you )?played(?: with this skill)?|your leader(?: card)?|it|them|that card|those cards|\{[^}]+\}(?: in your battle area)?|(?:an?|1|one) (?:of your )?(?:(?:mono-)?(?:red|blue|green|yellow|black|white) )?(?:<[^<>]+>|\{[^{}]+\}|≪[^≪≫]+≫)(?: (?:battle )?cards?)? in your battle area|(?:1|one) of your (?:(?:mono-)?(?:red|blue|green|yellow|black|white) )?(?:<[^<>]+>|\{[^{}]+\}|≪[^≪≫]+≫) (?:battle )?cards|your (?:(?:mono-)?(?:red|blue|green|yellow|black|white) )?(?:<[^<>]+>|≪[^≪≫]+≫) leader(?: card)?|your (?:(?:mono-)?(?:red|blue|green|yellow|black|white) )?(?:<[^<>]+>|≪[^≪≫]+≫|\{[^{}]+\}) battle card|your \{[^{}]+\})$/.exec(
        t,
      ))
  ) {
    // "Place **up to 1 ≪Frieza's Army≫ card with {Battle With Vegeta} in its
    // card name** under the played card" (BT29-057b) describes a card and
    // names no area to take it from. Read with no area it became a card "you
    // have in play" — a guess, and one that moves the wrong card — so a
    // counted description with no area stays unread.
    // "From the top of your deck", "from under this card", "among them" all
    // say where; "in its card name" does not.
    // Phrasing batch 3: straight after a look, the counted description is among the cards looked at, as "look at up
    // to 5 cards …, **add up to 1** … to your hand" reads — "Look at up to 5 cards from the top of your deck, place up
    // to 1 red <Trunks: Future> card under a {Destroyed West City} in your Battle Area, then shuffle your deck" (P-555,
    // BT23-030, BT21-035b, BT30-107b).
    // Not a list of alternatives ("<Vegeta: GT> with an energy cost of 1 **or 1** mono-blue ≪Brainwashed≫", BT21-041),
    // which one description cannot say.
    const placed = /^(?:up to )?(?:\d+|an?) /.test(m[1]) && !/\b(?:in|from|among)\b/.test(m[1].replace(/\bin (?:its|their) card names?\b/g, "")) && !/\bor (?:up to )?\d/.test(m[1]) && c.lastOp === "look" && c.lastSeen ? `${m[1]} among them` : m[1];
    if (/^(?:up to )?(?:\d+|an?) /.test(placed) && !/\b(?:in|from|among)\b/.test(placed.replace(/\bin (?:its|their) card names?\b/g, ""))) return null;
    // Phrasing batch 3: the host said by its description alone. "Your <Fin> **Leader**" is your Leader, when it is
    // that (`leaderHost`); "your ≪Cell Games≫ Battle Card" (BT26-109) and "your {Majin Buu's Sealed Ball}" (BT2-024,
    // BT2-003b) are one of yours the player picks.
    const leaderHost = /^your (.+?) leader(?: card)?$/.exec(m[2]);
    const hostSaid = leaderHost ? null : m[2].replace(/^your ((?:(?:mono-)?(?:red|blue|green|yellow|black|white) )?(?:<[^<>]+>|≪[^≪≫]+≫|\{[^{}]+\})) battle card$/, "1 of your $1 battle cards").replace(/^your (\{[^{}]+\})$/, "1 of your $1 cards");
    // "…then choose 1 of your red <Android 17> cards and 1 of your red <Android
    // 18> cards: Play up to 1 {…} from your hand or Drop, then place **all of the
    // chosen cards** under that card" (BT23-007): every card the price chose,
    // each its own move under the same host, when the effect has chosen none of
    // its own (a play's choice is the played card, not a chosen one). Read as
    // "the last choice" it was the played card, under itself.
    const chosenNames = c.priceChosen ?? [];
    if (/^all (?:of )?the chosen cards$/.test(m[1]) && chosenNames.length > 1 && !c.choices.some((ch) => /^c\d+$/.test(ch.var))) {
      const host = refFor(m[2], c);
      if (!host || ("var" in host && chosenNames.includes(host.var))) return null;
      return chosenNames.map((v): Op => ({ op: "moveTo", target: { var: v }, to: "under", under: host }));
    }
    let host: Ref | null;
    if (leaderHost) {
      const filter = filterFor(`${leaderHost[1]} card`, null);
      host = filter ? { sel: { side: "you", area: "leader", filter } } : filter === undefined ? { sel: { side: "you", area: "leader" } } : null;
    } else host = refFor(hostSaid ?? m[2], c);
    if (!host) return null;
    // Phrasing batch 3: "place **up to 1 card from the top of your deck** under your {Majin Buu's Sealed Ball}" (BT2-024,
    // BT2-003b): the top card, if the player wants — not a card chosen from anywhere in the deck.
    if (/^up to 1 card from the top of your deck$/.test(placed)) {
      const { ops: chooseHost, host: under } = hostChoice(host, clause, c);
      return [...chooseHost, { op: "may", ops: [{ op: "moveTo", target: { sel: { side: "you", area: "deck", take: 1 } }, to: "under", under }], reason: clause }];
    }
    const ref = refFor(placed, c);
    if (!ref) return null;
    const ops = placeUnderOps(ref, host, clause, c);
    // Remember who the placed card went under (see `Ctx.underHost`); a host
    // chosen here (#1123) is the move's `under`, never a passenger of itself.
    const under = (ops[ops.length - 1] as Extract<Op, { op: "moveTo" }>).under;
    for (const o of ops) if (o.op === "choose" && under && "var" in under && o.as !== under.var) (c.underHost ??= {})[o.as] = under.var;
    return ops;
  }

  // "Place up to 1 yellow ≪Frieza Clan≫ card from your Drop under {Wickedest
  // Clan} in your Battle Area" (23-2): the card and where it comes from, then
  // the host.
  if ((m = /^place (.+?) from (?:your|their) (drop|warp|hand|deck)(?: area)? under (.+?)(?: in (?:your|the) battle area)?$/.exec(t))) {
    const ref = refFor(`${m[1]} in your ${m[2]}`, c);
    const host = refFor(m[3], c);
    return ref && host ? placeUnderOps(ref, host, clause, c) : null;
  }
  // "Place up to 2 {Dragon Ball} from your Drop into the Battle Area" — placed,
  // not played (5-5), so nothing that triggers on a play fires.
  // "Place up to 1 {Scouter} from your Z-Deck in your Battle Area" (BT25-047, BT25-050, BT25-098, BT25-099,
  // BT22-036 to -038, #907 round 6) is the same placement from the Z-Deck: 17-2-1's "place a face-down Z-Extra
  // Card from the Z-Deck into the Battle Area" is what a play does after paying; a skill that says "place"
  // names no price, as its Drop/Warp/hand siblings here name none. A labelled best guess (the manual and the
  // official FAQ give no ruling on a skill's placement from the Z-Deck).
  if ((m = /^place (.+?) from (?:your|their) (drop|warp|hand|z-deck)(?: area)? (?:into|in) (?:your|the|their) battle area$/.exec(t))) {
    const ref = refFor(`${m[1]} in your ${m[2]}`, c);
    return ref ? withChoice(ref, clause, c, (target) => ({ op: "moveTo", target, to: "battle" })) : null;
  }
  // "Shuffle them into your deck": into the deck, then the deck is shuffled (3-2-3).
  if ((m = /^shuffle (.+?) (?:into|in) (?:your|their|its owner'?s?|their owners?'?) decks?$/.exec(t))) {
    const ref = refFor(m[1], c);
    return ref ? [...withChoice(ref, clause, c, (target) => ({ op: "moveTo", target, to: "deck" })), { op: "shuffle" }] : null;
  }

  // 3-12: a card placed in the Z-Deck, face up or not — "place this card from
  // your hand into its owner's Z-Deck face-up" (BT29-147, -148's price),
  // "place up to 1 black <Fu> or <Cumber> card in your Z-Deck face up" after
  // a look (BT22-115), "place that card from your Drop face-up in your
  // Z-Deck" (BT25-077), "place this card face-up in your Z-Deck" (BT26-097).
  // "Face up" is where it lies there, never a description of the card.
  if ((m = /^place (.+?)(?: from (?:your|their) (drop|hand|warp|deck)(?: area)?)?( face[- ]up)? (?:in|into) (?:its owner'?s?|your|their) z-decks?( face[- ]up)?$/.exec(t))) {
    const said = m[1].replace(/\s+face[- ]up$/, "");
    const faceUp = !!(m[3] || m[4] || /\s+face[- ]up$/.test(m[1]));
    const from = m[2];
    const pronoun = BARE_TARGET.test(said) || /^(?:that|this|the chosen) card\b/.test(said);
    let ref: Ref | null;
    if (pronoun) ref = refFor(from && /^this card$/.test(said) ? `this card from your ${from}` : said, c);
    else if (from) ref = refFor(`${said} in your ${from}`, c);
    else if (c.lastSeen) {
      // After "look at …", the card comes from what was looked at (20-12).
      const sel = parseTarget(said, c.lastSeen, c.lastSeen);
      ref = sel ? { sel: { ...sel, fromVar: sel.fromVar ?? c.lastSeen } } : null;
    } else ref = refFor(said, c);
    return ref ? withChoice(ref, clause, c, (target) => ({ op: "moveTo", target, to: "zDeck", ...(faceUp ? { faceUp: true, reveal: true } : {}) })) : null;
  }

  // "Add **this card and 1 non-<Oolong> ≪Power Wish≫ card from your hand** to
  // your Z-Energy" (EX24-08, EX24-13): two cards go, this one and one more the
  // player picks from the hand. The second is "another" card by the sentence's
  // own count — this card is the first — so the choice excludes it
  // (`notSelf`), and it is made before either moves. Only a counted
  // description that names the hand is read; anything vaguer stays unread.
  if ((m = /^add this card(?: in your hand)? and (\d+|an?|one) (.+? from your hand) (?:in|into|to) your z-energy$/.exec(t))) {
    const chosen = refFor(`${/^\d+$/.test(m[1]) ? m[1] : "1"} ${m[2]}`, c);
    if (!chosen || !("sel" in chosen) || chosen.sel.special || chosen.sel.area !== "hand" || chosen.sel.count !== 1 || chosen.sel.upTo) return null;
    const v = `c${c.n++}`;
    return [
      { op: "choose", sel: { ...chosen.sel, notSelf: "card" }, as: v, reason: clause },
      { op: "moveTo", target: { sel: { special: "self", area: "hand" } }, to: "zEnergy" },
      { op: "moveTo", target: { var: v }, to: "zEnergy" },
    ];
  }

  // "You may **send this card and 1 card from your hand to your Warp**" (BT4-036,
  // BT4-037), "send this card and 1 ≪Evil Incarnate≫ card from your Drop to
  // their owner's Warp" (BT31-019): one action moving two cards to one place —
  // this one, and one more the player picks from the named source. As with the
  // Z-Energy pair above, the second card is "another" by the sentence's own count
  // (`notSelf`), and it is chosen first, before either moves, so an empty source
  // leaves the whole action impossible: an offer is not made (20-16-1's
  // `firstStepImpossible` reads the leading choice) and a price cannot be paid.
  // Best guess, labelled: all of it or none of it (the card text gives no
  // partial form, and 5-2-5's partial choice applies to "up to", not to "1 card").
  if (
    (m =
      /^(send|place) this card(?: from your (battle area|drop(?: area)?|hand))? and (\d+|an?|one) (.+? from your (?:hand|drop(?: area)?)) (?:to|in|into) (?:your|its owner'?s?|their owners?'?s?) (warp|drop(?: area)?)s?$/.exec(
        t,
      ))
  ) {
    const dest = m[5] === "warp" ? "warp" : "drop";
    // "send" goes to the Warp and "place" to the Drop Area; any other pairing is a wording this has not seen.
    if ((m[1] === "send") !== (dest === "warp")) return null;
    const chosen = refFor(`${/^\d+$/.test(m[3]) ? m[3] : "1"} ${m[4]}`, c);
    if (!chosen || !("sel" in chosen) || chosen.sel.special || (chosen.sel.area !== "hand" && chosen.sel.area !== "drop") || chosen.sel.side !== "you" || chosen.sel.count !== 1 || chosen.sel.upTo) return null;
    // Where this card lies: as printed, or — best guess, labelled — the area the
    // sentence names for both when it is the Drop Area ("send this card and 1
    // ≪Evil Incarnate≫ card **from your Drop** to their owner's Warp", BT31-019;
    // 9-1-3-2's own example of a line used from the Drop is "send this card from
    // your Drop to your Warp"). A hand source qualifies only the counted card:
    // BT4-036's Auto answers an attack, so this card is in play.
    const own = m[2] ? ({ "battle area": "battle", "drop area": "drop", drop: "drop", hand: "hand" } as const)[m[2] as "battle area" | "drop area" | "drop" | "hand"] : chosen.sel.area === "drop" ? "drop" : null;
    const v = `c${c.n++}`;
    return [
      { op: "choose", sel: { ...chosen.sel, notSelf: "card" }, as: v, reason: clause },
      { op: "moveTo", target: { sel: { special: "self", ...(own ? { area: own } : {}) } }, to: dest, ...(dest === "drop" ? { reveal: true } : {}) },
      { op: "moveTo", target: { var: v }, to: dest, ...(dest === "drop" ? { reveal: true } : {}) },
    ];
  }

  // The same pair with the two places spelled out, one for each card (BT4-038's
  // price, P-201's price): "choose and send both **this card from your Battle
  // Area and a ≪Tapion≫ in your Drop Area** to the Warp", "choose 1 red <Frieza>
  // card … **in your Battle Area and this card in your Drop Area** and send them
  // both to their owners' Warps". Both cards or neither, as above; the counted
  // card is chosen first and is another card than this one.
  if (
    (m =
      /^(?:choose and )?send both this card from your (battle area|drop area|hand) and (\d+|an?|one) (.+? (?:in|from) your (?:hand|drop(?: area)?|battle area)) to (?:your|the|its owner'?s?|their owners?'?s?) warps?$/.exec(t)) ||
    (m =
      /^choose (\d+|an?|one) (.+? in your (?:hand|drop(?: area)?|battle area)) and this card in your (battle area|drop area|hand) and send them both to (?:your|the|its owner'?s?|their owners?'?s?) warps?$/.exec(t))
  ) {
    // The first form names this card's place first, the second last.
    const first = /^(?:choose and )?send both/.test(t);
    const [ownText, count, desc] = first ? [m[1], m[2], m[3]] : [m[3], m[1], m[2]];
    const chosen = refFor(`${/^\d+$/.test(count) ? count : "1"} ${desc}`, c);
    if (!chosen || !("sel" in chosen) || chosen.sel.special || !["hand", "drop", "battle"].includes(chosen.sel.area ?? "") || chosen.sel.side !== "you" || chosen.sel.count !== 1 || chosen.sel.upTo) return null;
    const own = ({ "battle area": "battle", "drop area": "drop", hand: "hand" } as const)[ownText as "battle area" | "drop area" | "hand"];
    const v = `c${c.n++}`;
    return [
      { op: "choose", sel: { ...chosen.sel, notSelf: "card" }, as: v, reason: clause },
      { op: "moveTo", target: { sel: { special: "self", area: own } }, to: "warp" },
      { op: "moveTo", target: { var: v }, to: "warp" },
    ];
  }

  // Paying energy in the middle of an effect: "you may **pay {u}{u}**. If you do,
  // …" (BT12-042, BT13-057, P-459, P-389). 5-5-2-1 and 3-8-2 pay energy by
  // switching that much of it to Rest Mode, and the coloured part of a price
  // (`{u}`) can only be met by energy of that colour (1-2-2-2-1, 20-21). The
  // engine's own payment planner is bound to a declared action and its payCost
  // prompt, which cannot be asked from inside a resolving skill; what it *can*
  // ask here is the program an action price is made of (20-14-1, BT8-051's
  // mid-resolution price: a choice, then a switch), so the payment is that
  // program — the player picks the Active Mode energy that is rested — wrapped
  // in the offer by the caller. A price the player cannot meet (too little
  // active energy of the colour) makes the offer impossible at its first step,
  // so it is not made and "if you do" has nothing to follow (20-16-1).
  // Only the price that is one colour or all generic is read: "{u}{1}" would need
  // the coloured part set aside before the generic one is chosen, which a
  // plain choice cannot promise; refused rather than half-paid. A payment that
  // is not an offer ("pay {1}.", "the player must pay") is a different rule
  // and is left unread.
  if ((m = /^pay ((?:\{[rugykbw\d]+\})+)$/.exec(t)) && /^(?:you may|you can|the player may)\s/i.test(clause.trim())) {
    const orbs = orbsIn(m[1]);
    const kinds = Object.keys(orbs) as (keyof typeof orbs)[];
    if (kinds.length !== 1) return null;
    const kind = kinds[0];
    const n = orbs[kind] ?? 0;
    if (n < 1 || n > 12) return null;
    const v = `c${c.n++}`;
    const sel: Selector = { side: "you", area: "energy", mode: "active", count: n, ...(kind === "any" ? {} : { filter: { ...emptyFilter(), colors: [kind] } }) };
    return [
      { op: "choose", sel, as: v, reason: `pay ${m[1]}` },
      { op: "switchMode", target: { var: v }, mode: "rest" },
    ];
  }

  // "…you add **this card in your hand** to your Z-Energy" (EX24-03): the card
  // is used from the hand (9-1-3-2; the official Q&A for the sister lines says
  // these only work from the hand), so the move names it. Said with "in" and
  // read only here: the general "this card in your hand" reading is untouched.
  if (/^add this card in your hand (?:in|into|to) your z-energy$/.test(t)) {
    return [{ op: "moveTo", target: { sel: { special: "self", area: "hand" } }, to: "zEnergy" }];
  }

  // Area moves (3-1).
  const MOVES: [RegExp, ScriptArea, { position?: "top" | "bottom"; mode?: "active" | "rest"; reveal?: boolean; owner?: Side; faceUp?: boolean }][] = [
    // "their owners' decks", "its owner's hand": several cards go to several
    // owners' areas, which `moveTo` does one card at a time anyway.
    // #966: "Place 1 card from your life **to** the Drop Area" (BT1-065) is the
    // same move as "in", and "place 1 card **in your Drop Area from your life**"
    // (BT13-099) the same one with its source after the destination.
    [/^place (.+?) (?:in|into|to) (?:its owner'?s?|their owners?'?s?|their|your|the) drops?(?: area)?s?$/, "drop", { reveal: true }],
    // "…choose 2 non-black Battle Cards from your opponent's Drop Area and place them at the bottom of **your
    // opponent's** deck in any order" (BT5-045): their owner's deck, named by its owner.
    [/^place (.+?) (?:at|on) the bottom of (?:its owner'?s?|their owners?'?s?|their|your|your opponent'?s) decks?(?: in any order)?$/, "deck", { position: "bottom" }],
    [/^place (.+?) on (?:the )?top of (?:its owner'?s?|their owners?'?s?|their|your) decks?(?: in any order)?$/, "deck", { position: "top" }],
    [/^return (.+?) to (?:its|their) owners?'?s? hands?$/, "hand", {}],
    [/^return (.+?) to (?:your|their) hands?$/, "hand", {}],
    // #907 round 4: "choose up to 1 of your opponent's Battle Cards and **add it to its owner's
    // hand**" (BT22-051, BT22-031b, EX23-10, ...) is "return it to its owner's hand" worded as
    // an add (3-1); the choice before it read, the move did not.
    // "…add all of the cards sent to their owner's Warp by this skill to their owner's hand" (EX24-24, phrasing batch 1).
    [/^add (it|them|this card|that card|those cards|the chosen cards?|(?:all (?:of )?)?the cards? (?:that (?:was|were) )?sent to [a-z' ]+? warps? (?:by|with) this skill) to (?:its|their) owners?'?s? hands?$/, "hand", {}],
    // "...otherwise **return it to the bottom of your deck**" (EB1-54, BT11-062b, BT11-104) is the
    // "place it at the bottom of your deck" move said with another verb. A bare "return it to
    // your opponent's deck" (BT7-017: "then your opponent shuffles") has no place to name.
    [/^return (.+?) to the bottom of (?:its owner'?s?|their owners?'?s?|their|your) decks?(?: in any order)?$/, "deck", { position: "bottom" }],
    [/^return (.+?) to the top of (?:its owner'?s?|their owners?'?s?|their|your) decks?(?: in any order)?$/, "deck", { position: "top" }],
    [/^return (.+?) to (?:its owner'?s?|their owners?'?s?|your opponent'?s|their|your) decks?$/, "deck", {}],
    // "...choose up to 1 of your opponent's Battle Cards and **place it in its owner's energy in
    // Rest Mode**" (DB1-025, DB1-091, P-174): the card lands in its own owner's Energy Area
    // (3-8), which is what a move with no `owner` does.
    [/^(?:add|place) (.+?) (?:to|in) (?:its owner'?s?|their owners?'?s?) energy(?: area)? in rest mode$/, "energy", { mode: "rest", reveal: true }],
    [/^(?:add|place) (.+?) (?:to|in) (?:its owner'?s?|their owners?'?s?) energy(?: area)?$/, "energy", { reveal: true }],
    // #930, BT7-123: "your opponent reveals their hand, and you choose up to 2
    // cards from it and **add them to their energy in Rest Mode**": the chosen
    // cards and "their" Energy Area are the opponent's, so the cards go to
    // their owner's area (3-8). Only a pronoun for the cards ("them", "it"):
    // with a description in front, "their" could name another player.
    [/^(?:add|place) (it|them) (?:to|in) their energy(?: area)? in rest mode$/, "energy", { mode: "rest", reveal: true }],
    [/^add (.+?) to your hand$/, "hand", {}],
    [/^send (.+?) to (?:your|their|its owner'?s?|their owners?'?s?|the) warps?$/, "warp", {}],
    // Phrasing batch 2: "choose 1 {Majin Buu's Sealed Ball} from your deck and **place it in the Battle Area in Active
    // Mode**" (BT2-003, BT2-100): placed, not played (5-5), in the mode it says.
    [/^place (it|them|that card|the chosen cards?) (?:in|into) (?:the|your) battle area in active mode$/, "battle", { mode: "active" }],
    [/^place (it|them|that card|the chosen cards?) (?:in|into) (?:the|your) battle area in rest mode$/, "battle", { mode: "rest" }],
    // Phrasing batch 2: "Add up to 1 Battle Card **in your opponent's Drop to their Z-Energy**" (BT21-034b, P-667).
    [/^add (.+? in your opponent'?s drop(?: area)?) to (?:their|its owner'?s) z-energy$/, "zEnergy", { owner: "opponent" }],
    // Phrasing batch 2: "send up to 1 red or black ≪Saiyan≫ card **from your Warp to its owner's Drop**" (BT27-001b).
    [/^send (.+? from your warp) to (?:its owner'?s?|their owners?'?s?|your) drops?(?: area)?$/, "drop", { reveal: true }],
    // Phrasing batch 2: "Add up to 1 {Vegeta, Warrior Spirit} or {Trunks, Warrior Spirit} **from your Combo Area to its
    // owner's hand**" (BT25-072).
    [/^add (.+? from your combo area) to (?:its owner'?s?|their owners?'?s?|your) hands?$/, "hand", {}],
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
    // "Choose up to 1 of your opponent's Battle Cards and add it to its owner's
    // Z-Energy" (BT21-036, BT21-038, BT21-051, BT21-052, BT21-076, BT21-084): the
    // Z-Energy Area is the owner's, so the card goes where `moveTo` sends a card
    // by default, to its owner's side. "To your opponent's Z-Energy" names that
    // side outright (BT23-067). Only a pronoun is read as the subject: "add the
    // chosen card to your opponent's Z-Energy" (P-504) may point at the price's
    // choice, which the effect's own choice has since replaced as the last one,
    // and a card taken from a Life Area (BT23-103) is chosen unseen (3-9-2) -
    // both stay unread.
    [/^(?:add|place|send) (it|them|this card|that card|those cards) (?:in|into|to) (?:its owner'?s?|their owners?'?s?) z-energy$/, "zEnergy", {}],
    [/^(?:add|place|send) (it|them|this card|that card|those cards) (?:in|into|to) your opponent'?s z-energy$/, "zEnergy", { owner: "opponent" }],    [/^remove (.+?) from the game(?: instead)?$/, "removed", {}],
  ];
  // Phrasing batch 5: "**add 1 of your opponent's life to its owner's Z-Energy**" (BT23-103, BT23-109): a card of their
  // Life Area, chosen unseen (3-9-2: the Life lies face down, so the candidates are offered by position, `blind`), to
  // the Z-Energy Area of its owner — theirs. Exactly that many, or as many as their life has (5-2-5).
  if ((m = /^add (\d+) of your opponent'?s life to (?:its owner'?s?|their owners?'?s?|their|your opponent'?s) z-energy$/.exec(t))) {
    const v = `c${c.n++}`;
    return [
      { op: "choose", sel: { side: "opponent", area: "life", count: Number(m[1]) }, as: v, reason: clause, blind: true },
      { op: "moveTo", target: { var: v }, to: "zEnergy" },
    ];
  }
  // "Add up to 1 green Battle Card from your Drop to your Z-Energy **with its skills negated for the turn**"
  // (BT24-055b, BT26-068, BT30-010 …, phrasing batch 1): the move, then the moved card's skills negated for the
  // turn (9-1-5's wording for a play, said of a card added to the Z-Energy).
  const zNegated = /^(.+ (?:in|into|to) your z-energy) with (?:its|their) skills negated for the turn$/.exec(t);
  for (const [re, to, opts] of MOVES) {
    if ((m = re.exec(zNegated && to === "zEnergy" ? zNegated[1] : t))) {
      // "Add up to 2 [Dragon Ball] cards to your hand" after "look at your deck
      // and life" (BT21-027): a counted description that says nowhere where the
      // cards come from. Read with no area it chose them from the cards you
      // have in play, which is never where a card "added to your hand" is.
      // The "of" in "with a specified cost **of** 2" (BT28-096, #728) is the
      // measure's, not a place, and does not let the clause through.
      if (to === "hand" && /^add /.test(t) && /^(?:up to )?(?:\d+|an?) /.test(m[1]) && !/\b(?:in|from|among|of)\b/.test(m[1].replace(/\bin (?:its|their) card names?\b/g, "").replace(/\bspecified costs? of\b/g, ""))) return null;
      // #966: "place 1 card from your life **and 1 card from your hand** in your
      // Drop Area" names two sources, and one selector reads only the last:
      // the life half of the price vanished. Two counted pieces are refused.
      if (/\b(?:from|in) (?:your|their|its owner'?s?) [a-z ]+? and (?:up to )?(?:\d+|an?) [^,]*\b(?:from|in) /.test(m[1])) return null;
      let ref = refFor(m[1], c);
      // Phrasing batch 4: "Look at up to 5 cards from the top of your deck, **place up to 1 blue ≪Earthling≫ card into
      // its owner's Drop**" (BT30-030, BT26-015): after a look, a description that names no area of its own is one of
      // the cards looked at (20-12), as the `play`, `add … to your hand` and combo clauses already read it — no
      // "among them" needed. Read bare it was a card already in play.
      if ((to === "drop" || to === "warp") && c.lastSeen && ref && "sel" in ref && !ref.sel.special && !ref.sel.fromVar && !AREA_WORDS.some(([re]) => re.test(m![1]))) {
        const sel = parseTarget(m[1], c.lastSeen);
        if (sel && !sel.special) ref = { sel };
      }
      const moved = ref ? withChoice(ref, clause, c, (target) => ({ op: "moveTo", target, to, ...opts })) : null;
      if (zNegated && to === "zEnergy") {
        const move = moved?.find((o) => o.op === "moveTo");
        return move && move.op === "moveTo" ? [...moved!, { op: "negateSkills", target: move.target, until: "turn" }] : null;
      }
      // #916: the opponent's Life lies face down (3-9-2), and placing a card of
      // it in the Drop Area is chosen without reading it, so asking reveals
      // none of the candidates to the chooser: they are offered by position.
      return moved && to === "drop" ? moved.map((o) => (o.op === "choose" && o.sel.side === "opponent" && o.sel.area === "life" && !o.sel.special ? { ...o, blind: true as const } : o)) : moved;
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

  // BT3-096/098 / 22-5-2-3: the selected base evolves into this exact
  // cleanup copy. Retain the base's printed filter for resolution/reload.
  if (/^evolve it into this card$/.test(t) && /^during your turn,\s*at the end of the battle after you combo with this card,/i.test(c.raw)) {
    if (!c.last || !c.lastTarget || !("var" in c.lastTarget)) return null;
    const choice = [...c.choices].reverse().find((op) => op.var === c.last);
    if (!choice || choice.sel.area !== "battle" || choice.sel.side !== "you") return null;
    return [{ op: "play", target: { sel: { special: "self", area: "drop" } },
      onto: { sel: { fromVar: c.last, filter: choice.sel.filter } }, using: "Evolve", counterWindow: true }];
  }

  // #933, P-336: "…and evolve it on top of this card in Active Mode" — an
  // *explicit* evolution a skill instructs (22-5-5-1), whatever the tag on the
  // skill is: the chosen card is played onto the host as an [Evolve] play, which
  // is what lets it past "can't be played … with non-[Evolve] skills" (BT13-024).
  // Only the form that names what is evolved and what it goes on top of is read.
  if ((m = /^evolve (it|that card|the chosen card) on top of (this card|it|the played card|the chosen card)(?: in (rest|active) mode)?$/.exec(t))) {
    const what = refFor(m[1], c);
    const onto = refFor(m[2], c);
    if (!what || !onto || !("var" in what)) return null;
    return [{ op: "play", target: what, onto, ...(m[3] ? { mode: m[3] as "rest" | "active" } : {}), using: "Evolve" }];
  }

  // "…choose 1 <Frost> with [Evolve] among them and evolve this card into it"
  // (BT1-017, EX06-04, P-018, P-065): the same explicit evolution the line
  // above reads, said from the host's side. The card evolved *into* is the one
  // the skill just chose and goes on top of this card (22-5-2-3, 22-5-5:
  // "evolve" is playing the card as an [Evolve] play on top of its base), and
  // no cost is paid unless the text says so (official card Q&A, BT1-017 Q4).
  if ((m = /^evolve this card into (it|that card|the chosen card)$/.exec(t))) {
    const what = refFor(m[1], c);
    const base = refFor("this card", c);
    if (!what || !base || !("var" in what)) return null;
    return [{ op: "play", target: what, onto: base, using: "Evolve" }];
  }

  // "Play up to 1 <Majin Buu> card from your deck on top of this card"
  // (22-13-6-3). The host has to come off the phrase before the target is
  // read: "this card" at the end of it made `parseTarget` take the whole
  // thing for this card, and the skill played the card onto itself.
  //
  // #930, BT17-077: "Play up to 1 green <Piccolo> card with an energy cost of
  // 4 **on top of this card from your deck**" prints the destination before
  // the source. Same meaning, other order: the "from <area>" is moved in
  // front of the destination, and the clause is read as the usual order is.
  // Only a source that starts with a possessive ("from your deck", "from
  // your hand or Drop Area") and only after one of the host phrases below.
  const onTopFirst =
    /^((?:play|activate) .+?) (on top of (?:this card|it|the played card|the (?:originally )?chosen card|that (?:chosen )?card)) (from (?:your|their|its owner's|their owner's) [^,;]+?)((?: in (?:rest|active) mode)?(?: with (?:its|their) (?:(?:non-)?keyword )?skills negated(?: for (?:the )?(?:turn|game|battle)| until the end of your opponent's next turn)?)?)$/.exec(t);
  const tOnTop = onTopFirst && !/\bon top of\b/.test(onTopFirst[3]) ? `${onTopFirst[1]} ${onTopFirst[3]} ${onTopFirst[2]}${onTopFirst[4]}` : t;
  if (
    (m =
      /^(?:play|activate) (.+?)(?: in (rest|active) mode)? on top of (this card|it|the played card|the (?:originally )?chosen card|that (?:chosen )?card)(?: in (rest|active) mode)?(?: with (?:its|their) ((?:non-)?keyword )?skills negated(?: for (?:the )?(turn|game|battle)| until the end of your opponent's next turn)?)?$/.exec(
        tOnTop,
      ))
  ) {
    const onto = hostOf(m[3], c);
    // "…Battle Card **whose card name is in the text of a skill on the chosen
    // card** from your Warp" (BT30-084, #542): the phrase is the filter's
    // `nameInSkillTextOf`, bound to the choice it points at (`c.last`, which the
    // price's choice, #550, left). Struck out of the description first, or
    // "the chosen card" in it would be taken for the target.
    const inText = NAME_IN_SKILL_TEXT.exec(m[1]);
    const ref = refFor(inText ? m[1].replace(NAME_IN_SKILL_TEXT, "") : m[1], c);
    if (inText) {
      // Nothing chosen to look in, or a description that is not a selector: unread (ground rule 5).
      if (!c.last || !ref || !("sel" in ref)) return null;
      ref.sel = { ...ref.sel, filter: { ...emptyFilter(), ...ref.sel.filter, nameInSkillTextOf: c.last } };
    }
    const mode = (m[2] ?? m[4]) as "rest" | "active" | undefined;
    // 9-1-5: the sets print "for game" as well as "for the game"; anything
    // shorter than the game is an effect with a duration. Phrasing batch 4: the **non-keyword** skills alone, as the
    // plain play below reads them (EX21-20, BT21-066).
    // Phrasing batch 5: "…with its **keyword** skills negated", the inverse half (`negateHalf`).
    const half = m[5] && /skills negated/.test(t) ? m[5].trim() : undefined;
    if (!half && / until the end of your opponent's next turn$/.test(tOnTop)) return null;
    const negated: "turn" | "game" | undefined = /skills negated/.test(t) && !half ? (m[6] === "game" ? "game" : "turn") : undefined;
    const thenNegate = (target: Ref): Op[] => (half ? negateHalf(half, target, durationOf(tOnTop.replace(/^.* with (?:its|their) (?:non-)?keyword skills negated/, ""))) : []);
    if (!onto || !ref) return null;
    const extra = { onto, ...(mode ? { mode } : {}), ...(negated ? { negated } : {}) } as const;
    if ("sel" in ref) {
      const v = `p${c.n++}`;
      c.lastPlayed = v;
      return [
        { op: "choose", sel: ref.sel, as: v, reason: clause },
        { op: "play", target: { var: v }, ...extra },
        ...thenNegate({ var: v }),
      ];
    }
    return [{ op: "play", target: ref, ...extra }, ...thenNegate(ref)];
  }

  // Playing a card by a skill (5-5-3).
  // "Activate" is what the text calls playing an Extra card (12-2), so the two
  // words lead to the same place. A card that says "play … in Rest Mode" is
  // still played from wherever it is; the mode belongs to the play, not to the
  // choice, or the choice would go looking for a card already rested.
  // "…play it **with a marker on it**" (P-288), "play up to 1 blue Unison with a
  // specified cost of 2 **and 3 markers on it** from your Drop" (BT28-148, #980):
  // the markers the card arrives with, a modifier of the play (13-2-3) and not a
  // measure of the card chosen. Taken off the phrase first so the description
  // is read without it.
  const arrivesWith: { markers?: number } = {};
  const tp = /^play /.test(t)
    ? t
        // "…with 2 markers on it **and its skills negated** for the game"
        // (BT15-129): the negation is the play's too, said after the markers.
        .replace(/\s+(?:with|and) (a|an|\d+) markers? on (?:it|them)\b( and (?=(?:its|their) (?:non-keyword )?skills negated\b))?/, (_w, n: string, negated?: string) => {
          arrivesWith.markers = /^\d+$/.test(n) ? Number(n) : 1;
          return negated ? " with " : "";
        })
        // Phrasing batch 4: "play 1 <Son Goku> or <Vegeta> card-both blue …-**in Rest Mode from your energy** with its
        // skills negated" (EX25-14) says the mode before the place: the mode is the play's, as after it, and never the
        // cards' the choice looks for (it read as a choice of rested energy, played in Active Mode).
        .replace(/^(play .+?)(\s|--|[-—–―])in (rest|active) mode (from (?:your|their) (?:(?! with ).)+?)((?: with (?:its|their) .*)?)$/, (_w, a: string, gap: string, mode: string, from: string, rest: string) => `${a}${gap.trim() ? `${gap} ` : " "}${from} in ${mode} mode${rest}`)
    : t;
  if ((m = /^(?:play|activate) (.+?)(?: in (rest|active) mode)?(?: with (?:its|their) ((?:non-)?keyword )?skills negated(?: for (?:the )?(turn|game|battle)| until the end of your opponent's next turn)?)?$/.exec(tp))) {
    if (/token/.test(t)) return compileToken(clause, c);
    // "During this turn, you can activate your Leader's [Awaken] **even if your life is at 6 or less**" (P-500,
    // P-508, P-548, P-694, BT1-051, BT7-069, EX06-03, EX25-02, P-208): a permission that lifts the life gate of a
    // keyword, not the play of a card. It read as "you may choose 6 Leader Cards in your Life Area and play them"
    // - or, with "5 or more life", as playing the Leader (#907 round 6). Unread until the gate is a thing the
    // engine can lift for a turn.
    if (/^activate\b/.test(tp) && /\beven (?:if|when)\b/.test(t)) return null;
    // A Leader is never played, so "activate your Leader Card's [Activate: Main]" (P-208, cut at its list commas
    // before the "even when") is not one either.
    if (/^activate (?:your )?leader(?: card)?'s \[/.test(tp)) return null;
    // "…and **activate its [Activate: Main] skill**" (BT5-002, #979) uses a
    // skill of a card; it does not play the card that bears it (12-2-4). The
    // bounded Desire choice before it is read whole above; when what "its"
    // points at was chosen with that energy bound and the pair was not read
    // there (another kind of skill, another area), the clause is left unread
    // rather than read as the play of the card it names. Before the bound was
    // readable the choice itself failed and there was nothing to point at.
    if (/^activate its \[activate[^\]]*\]\s*skills?\b/.test(t) && c.choices.some((ch) => ch.var === c.last && ch.sel.filter?.costAtMostEnergy)) return null;
    // "…and play it **in your opponent's Battle Area**" (BT15-118, BT18-087):
    // the card goes to the other side of the table, and `play` has no word for
    // whose Battle Area it lands in — read without it, the card was played
    // into your own. Left unread (ground rule 5).
    // Prohibition batch 6: "…play the Unison Card under this card **in your
    // opponent's Unison Area**" (BT15-129) is the same gap for a Unison.
    if (/\b(?:in|into) (?:your|their|an|the) opponent'?s (?:battle|unison) areas?\b/.test(m[1])) return null;
    const mode = m[2] as "rest" | "active" | undefined;
    // 9-1-5: "played … with its skills negated", which the sets print with and
    // without the article before "game". Phrasing batch 4: "…with its **non-keyword** skills negated" is the
    // negation of the card's [Auto], [Activate] and [Permanent] skills once it is played (`negateNonKeyword`), and
    // may last "until the end of your opponent's next turn" (EX21-20); the play itself is plain.
    // Phrasing batch 5 (owner's ruling of 26 Oct 2026 on P-327): "…with its **keyword** skills negated" is the inverse
    // half, its keyword skills and [Counter]s (`negateHalf`); it used to read as every skill negated.
    const half = m[3] && /skills negated/.test(t) ? m[3].trim() : undefined;
    if (!half && / until the end of your opponent's next turn$/.test(tp)) return null;
    const negated: "turn" | "game" | undefined = /skills negated/.test(t) && !half ? (m[4] === "game" ? "game" : "turn") : undefined;
    const thenNegate = (target: Ref): Op[] => (half ? negateHalf(half, target, durationOf(t.replace(/^.* with (?:its|their) (?:non-)?keyword skills negated/, ""))) : []);
    let ref = refFor(m[1], c);
    if (!ref) return null;
    // "Look at up to 1 card from the top of your deck, **play up to 1 black
    // ≪Maiden Squadron≫ card**, then send the rest to their owner's Warp"
    // (BT30-106): the play's twin of the `add … to your hand` rule above.
    // Standing after the look is what says the card comes out of the cards
    // looked at; read as an unqualified card it was one already in play.
    // Only a description of its own that names no area — "play this card",
    // "play it" and "play up to 1 X from your hand" are what they say.
    const desc = m[1];
    if (c.lastSeen && "sel" in ref && !ref.sel.special && !ref.sel.fromVar && !AREA_WORDS.some(([re]) => re.test(desc))) {
      const sel = parseTarget(desc, c.lastSeen);
      if (sel && !sel.special) ref = { sel };
    }
    // A card is played *from* somewhere (5-5-3) — never from play. A Unison
    // description that names no place and follows no look ("play up to 1
    // black Unison with a specified cost of 3 **and a marker on it**",
    // BT21-137, whose "from your deck" the "and" cut away) defaulted to the
    // cards already in play, and the skill "played" one of those. Refused for
    // the specified-cost descriptions #728 made readable; the same default on
    // other "play" clauses is older and left as it reads (see the PR).
    if ("sel" in ref && ref.sel.area === "play" && !ref.sel.special && !ref.sel.fromVar && !ref.sel.areas?.length && (ref.sel.filter?.specifiedCostMin != null || ref.sel.filter?.specifiedCostMax != null)) return null;
    // 22-3-3: "activate {Tragedy Overground}" (BT10-052, and the Leader-area
    // "activate up to 1 {…} from your deck" family) names an Extra card by its
    // braces. If it has a [Field] skill that skill is what is activated, not a
    // play (`activating`); a card with none is played as before.
    // Only the bare form "activate [up to N] {Name} [card] [from …]": "activate
    // the [Activate: Main] skill of {Name}", "activate this skill when you play
    // {Name}" and the permissions ("you may activate {Name} from your hand
    // without paying its energy cost") are other things.
    const activating = /^activate\b/.test(tp) && /^(?:(?:up to )?\d+ |an? |the )?\{[^}]+\}(?: cards?)?(?: from (?!.*\bwithout paying\b).+)?$/.test(m[1]);
    const extra = { ...(mode ? { mode } : {}), ...(negated ? { negated } : {}), ...(activating ? { activating: true as const } : {}), ...arrivesWith } as const;
    if ("sel" in ref) {
      // "play up to 1 X from your hand" is a choice followed by the play.
      const v = `p${c.n++}`;
      c.lastPlayed = v;
      return [
        { op: "choose", sel: ref.sel, as: v, reason: clause },
        { op: "play", target: { var: v }, ...extra },
        ...thenNegate({ var: v }),
      ];
    }
    return [{ op: "play", target: ref, ...extra }, ...thenNegate(ref)];
  }

  // 5-2: the skill is yours, but the choice is *theirs* — "your opponent
  // chooses 1 of their Battle Cards" and the clause after it says what happens
  // to what they picked. Twenty-odd clauses, and every one of them is a
  // decision the wrong player would otherwise take: KO'ing their own weakest
  // card is not the same game as you KO'ing their best.
  //
  // The plain hand discard is read above as a `discard`, which splices the
  // same choose with the same chooser; this is every other area.
  // "They choose 1 card in their hand or 1 of their Battle Cards and place it in
  // its owner's Drop Area" (BT15-085, #1015): two places, one pick, and *they*
  // are the opponent whose play set the trigger off, so both the choice of
  // place and the pick are theirs. The "or" used to be swallowed by the first
  // half, leaving "1 Battle Card in your opponent's hand" — a card that does
  // not exist in a hand — chosen by the opponent from a list they could not
  // fill. Both branches bind one name, as for any two-kind choice above.
  if ((m = /^(?:your opponent|they) chooses? (up to )?(\d+) cards? (?:in|from) their hand or (up to )?(\d+) of their (.+)$/.exec(t))) {
    const second = parseTarget(`${m[3] ?? ""}${m[4]} of your opponent's ${m[5]}`);
    if (!second || second.side !== "opponent" || second.fromVar || second.special || second.take != null || second.area === "hand") return null;
    const v = `c${c.n++}`;
    const hand: Selector = { side: "opponent", area: "hand", count: Number(m[2]), upTo: !!m[1] };
    const a: Op = { op: "choose", sel: hand, as: v, chooser: "opponent", reason: clause };
    const b: Op = { op: "choose", sel: second, as: v, chooser: "opponent", reason: clause };
    track(a, c);
    return [{ op: "chooseMode", modes: [{ label: "1 card in their hand", ops: [a] }, { label: `1 of their ${m[5]}`, ops: [b] }], chooser: "opponent", reason: clause }];
  }
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
  // "…place up to 1 {Charging Ultra Buu Buu Volleyball} from your Z-Deck in
  // your Battle Area, **choose up to 1 of the placed cards**, and it can't
  // attack …" (BT25-047, prohibition batch 6): a choice among the cards the
  // clause before just placed — the last choice, which that clause moved.
  if ((m = /^choose (up to )?(\d+) of the placed cards?$/.exec(t)) && c.last) {
    const v = `c${c.n++}`;
    return [{ op: "choose", sel: { fromVar: c.last, count: Number(m[2]), upTo: !!m[1] }, as: v, reason: clause }];
  }

  // "Choose any number of your opponent's Battle Cards up to the number of
  // your Hidden Mode cards" (BT29-139): as many as the player likes, up to a
  // count read off the board when the choice is made (`atMost`).
  if ((m = /^choose any number of (.+?) up to the number of (.+)$/.exec(t))) {
    const sel = parseTarget(m[1], undefined, c.lastSeen ?? undefined);
    const counted = parseTarget(m[2]);
    if (!sel || !counted || sel.special || sel.take != null) return null;
    delete counted.count;
    delete counted.upTo;
    const v = `c${c.n++}`;
    return [{ op: "choose", sel: { ...sel, count: undefined, upTo: true }, as: v, reason: clause, atMost: { count: counted } }];
  }

  // "Choose up to 1 of your Leaders or up to 1 of your white ≪Universe 7≫
  // Battle Cards" (BT28-105b): two kinds, one described and one not, which
  // no single selector says — a filter would land on both or neither. The
  // player picks the kind first (20-2), and both branches bind the same name,
  // so "that card" after it is whichever was chosen.
  //
  // The same for any two kinds, either player's: "up to 1 of your white Battle
  // Cards with an energy cost of 4 or less or up to 1 of your opponent's
  // Battle Cards" (BT29-148). Read as the first half alone, the opponent's
  // card was never on offer.
  if ((m = /^choose up to (\d+) of ((?:your opponent's|your) .+?) or up to (\d+) of ((?:your opponent's|your) .+)$/.exec(t))) {
    const half = (n: string, phrase: string): Selector | null => {
      // EX12-07's "with a specified cost of 2" was refused here while the
      // filter grammar could not carry it; since #728 it is a measure
      // (`specifiedCostMin`), and a specified-cost phrase it cannot read still
      // makes the description unreadable, so `parseTarget` refuses that half.
      // "Your [green] Leaders" (P-691) is the Leader, described or not.
      const leader = /^your (?:(.+?) )?leaders?(?: cards?)?$/.exec(phrase);
      if (leader) {
        const filter = leader[1] ? filterFor(leader[1], "leader") : undefined;
        return filter === null ? null : { side: "you", area: "leader", count: Number(n), upTo: true, ...(filter ? { filter } : {}) };
      }
      const sel = parseTarget(`up to ${n} of ${phrase}`);
      return sel && !sel.fromVar && !sel.special && sel.take == null ? sel : null;
    };
    const first = half(m[1], m[2]);
    const second = half(m[3], m[4]);
    if (!first || !second) return null;
    const printed = /^choose up to \d+ of (.+?) or up to \d+ of (.+)$/i.exec(clause.trim());
    const v = `c${c.n++}`;
    const a: Op = { op: "choose", sel: first, as: v, reason: clause };
    const b: Op = { op: "choose", sel: second, as: v, reason: clause };
    track(a, c);
    const label = (s: string | undefined, fallback: string) => (s ? s.replace(/^your Leaders$/i, "your Leader") : fallback);
    return [{ op: "chooseMode", modes: [{ label: label(printed?.[1], "the first"), ops: [a] }, { label: label(printed?.[2], "the other"), ops: [b] }], reason: clause }];
  }

  // "Choose up to 1 of your opponent's Leader Cards or Battle Cards" (BT3-030),
  // "1 of your Leader Cards or Unison Cards" (SD13-04), "up to 1 of your red
  // Leader Cards or red Battle Cards" (BT3-010), "your Leader Cards or green
  // Unison Cards" (SD13-03): the same two kinds as above said with one count,
  // and until #537 read as the Leader alone. Each half keeps its own words —
  // "green" is the Unison's, not the Leader's — and the player picks the kind.
  if ((m = /^choose (up to )?(\d+) of (your opponent's|your) ((?:[a-z-]+ )*?)leader cards? or ((?:[a-z-]+ )*?(?:battle|unison) cards?)$/.exec(t))) {
    const [, upTo, n, owner, leaderWords, other] = m;
    const desc = leaderWords.trim();
    const filter = desc ? filterFor(desc, "leader") : undefined;
    if (filter === null) return null;
    const side = owner === "your" ? "you" : "opponent";
    const leader: Selector = { side, area: "leader", count: Number(n), upTo: !!upTo, ...(filter ? { filter } : {}) };
    const rest = parseTarget(`${upTo ?? ""}${n} of ${owner} ${other}`);
    if (!rest || rest.fromVar || rest.special || rest.take != null) return null;
    const printed = /^choose (?:up to )?\d+ of (?:your opponent's|your) (.+?) or (.+)$/i.exec(clause.trim());
    const v = `c${c.n++}`;
    const a: Op = { op: "choose", sel: leader, as: v, reason: clause };
    const b: Op = { op: "choose", sel: rest, as: v, reason: clause };
    track(a, c);
    return [{ op: "chooseMode", modes: [{ label: printed?.[1] ?? "a Leader Card", ops: [a] }, { label: printed?.[2] ?? "the other", ops: [b] }], reason: clause }];
  }

  // Choosing (5-2). Late, because many clauses open with "choose" plus an action.
  if (/^choose /.test(t)) {
    let sel = parseTarget(clause, undefined, c.lastSeen ?? undefined);
    // "When your opponent plays a Battle Card, you may choose **that card**":
    // the trigger already named it, so there is nothing to pick out of an area
    // — the only question is whether to take it.
    // Only the bare pronoun: `refFor` takes any phrase with "the chosen" in it for the chosen card, so a description
    // the parser refused ("a card name in the chosen card's skill text", P-269b) came back as a re-choice of the
    // price's card, which was then played (#907 round 6).
    if (!sel && BARE_TARGET.test(t.replace(/^choose\s+/, "").replace(/^(?:up to )?\d+ of /, "").replace(/[.,]$/, ""))) {
      const named = refFor(t.replace(/^choose\s+/, ""), c);
      if (named) sel = "sel" in named ? { ...named.sel } : { fromVar: named.var, count: 1 };
    }
    if (!sel) return null;
    // "Look at up to the top 5 cards of your deck, **choose up to 1 red ≪Ginyu Force≫ card with an energy cost
    // of 2 and play it**. Then place the rest at the bottom of your deck" (TB3-007, TB3-008, TB3-010, #907
    // round 6): after a look, a description that names no area of its own is read from the cards looked at
    // (20-12), as the `play`, `add … to your hand` and combo clauses already do. Read as an unqualified card
    // it was one already in play, and "the rest" then put the card just played back in the deck.
    // Not "choose up to 1 **of your** <Paikuhan> cards" (BT12-027, BT18-147, BT22-114): an owner is a place.
    if (c.lastSeen && !sel.special && !sel.fromVar && sel.take == null && !AREA_WORDS.some(([re]) => re.test(t)) && !/\b(?:your|their|opponent'?s)\b/.test(t)) {
      const looked = parseTarget(clause, c.lastSeen);
      if (looked && !looked.special) sel = looked;
    }
    // 20-16 / #538: "you may choose N" offers a plain multi-card choice as a
    // whole. compileEffect wraps it in `may`; accepting it owes N, declining
    // chooses nothing. Making it up-to moved partial payments before "if you
    // do" checked their count (BT3-109, BT6-062, SD8-03). A one-card choice
    // already expresses exactly-one-or-decline as up to 1. Printed ranges,
    // "up to", "all" and "any number" keep their existing readings.
    if (/^(?:you may|you can|the player may)\s+/i.test(clause.trim())) {
      sel.count ??= 1;
      if (sel.upTo || sel.minCount !== undefined || sel.count < 2 || sel.count >= 99) sel.upTo = true;
    }
    // "…with power less than or equal to **the chosen card's** power"
    // (BT19-096): `parseFilter` cannot know which variable that is — only the
    // compiler does, and only right here, before this clause's own choice
    // overwrites `c.last` with a new one. Left unresolved (no prior choice to
    // point at) the filter still measures nothing rather than a card it was
    // never told about; see the field's comment in `filters.ts`.
    if (sel.filter?.powerRel?.of === "chosen" && c.last) sel = { ...sel, filter: { ...sel.filter, powerRel: { ...sel.filter.powerRel, var: c.last } } };
    // "…with the same character name as the card you placed under this card"
    // (BT4-018, #930): the card the price chose and placed under this one, by
    // the name the price bound it to. No such price, nothing to compare with:
    // unread (ground rule 5).
    if (sel.filter?.sameCharacterAs === PLACED_UNDER_PLACEHOLDER) {
      if (!c.priceChoice || !c.pricePlacedUnder) return null;
      sel = { ...sel, filter: { ...sel.filter, sameCharacterAs: c.priceChoice } };
    }
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

  // BT9-119: "until the start of your next Main Phase" was refused here while
  // no duration named it exactly; it is `nextMain` now (#1163), read by
  // `durationOf` below. The duration is cut off the tail before the tail is
  // read as whose skills are blocked.
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
/** A span printed after an attack's object. Not a bare "for": a name can hold it ("{Krillin, Concerned for a God}"). */
const DURATION_AFTER_OBJECT = /\s+(?:for (?:the|this|that) (?:turn|battle|game|duration)\b|during\b|until\b).*$/;
const DEFENDER_TYPES =["LEADER", "BATTLE", "UNISON"] as const;
const TYPE_WORD = /^(?:(?:your|their|the|an?)\s+)?(?:(leader|battle|unison)(?: cards?)?|(leaders|unisons))$/;
const typeOfWord = (w: string): "LEADER" | "BATTLE" | "UNISON" | null => {
  const m = TYPE_WORD.exec(w.trim());
  const word = m ? (m[1] ?? m[2]) : null;
  return word === "leader" || word === "leaders" ? "LEADER" : word === "battle" ? "BATTLE" : word === "unison" || word === "unisons" ? "UNISON" : null;
};

/**
 * Which cards a rule about **attacks** is about, as a filter on a card that
 * can be the attacker or the defender (#1005). Those are three kinds only — a
 * Leader, a Battle Card, a Unison (8-1-1) — so a list of them ("Leader Cards
 * or Unison Cards", "Battle Cards and Unisons") is the third kind turned
 * round (`notType`), which is exact and needs no union in the filter.
 *
 * `null` means the description cannot be said whole and the clause must stay
 * unread; the rule would otherwise forbid more attacks than the card names.
 */
function attackSideFilter(said: string): CardFilter | null {
  let text = said.trim().replace(DURATION_AFTER_OBJECT, "").replace(/^(?:your opponent'?s|your|their|the|an?)\s+/, "");
  // "cards **other than their Leader**" (BT26-127, #1015): every kind but that
  // one. `filterFor` read the kind it names and dropped the "other than", so the
  // rule was about the Leader alone — the opposite card. A Battle Card or Unison
  // can only be attacked with by being one, so the three kinds make this exact.
  const otherKind = /^cards?\s+other than\s+(?:(?:your|their|the)\s+)?(leader|battle|unison)s?(?:\s+cards?)?$/.exec(text);
  if (otherKind) return { ...parseFilter(""), notType: otherKind[1].toUpperCase() as "LEADER" | "BATTLE" | "UNISON" };
  // "{Krillin, Concerned for a God} card **in a Unison Area**" (BT31-037): the
  // area says the card is a Unison, which is the only card that stands there.
  const inUnisonArea = /\s+in an? unison area$/.test(text);
  if (inUnisonArea) text = text.replace(/\s+in an? unison area$/, "");
  // A name can hold a comma ("{Krillin, Concerned for a God}"): such a
  // description is one filter, never a list of kinds.
  const parts = /[{<≪]/.test(text) ? [text] : text.split(/\s*(?:,\s*|\s+(?:or|and)\s+)\s*/).filter(Boolean);
  const kinds = parts.map(typeOfWord);
  if (parts.length > 1 && kinds.every((k) => k)) {
    const wanted = new Set(kinds as ("LEADER" | "BATTLE" | "UNISON")[]);
    if (wanted.size === 3) return null;
    if (wanted.size === 1) return { ...parseFilter(""), type: [...wanted][0] };
    const left = DEFENDER_TYPES.filter((k) => !wanted.has(k));
    return { ...parseFilter(""), notType: left[0] };
  }
  const filter = filterFor(text, null);
  if (!filter) return null;
  // A word the filter did not take would widen the rule ("…Unisons with
  // exactly 3 colours"): refuse the whole description.
  if (unreadFilterWords(text, filter).length) return null;
  const narrowed = inUnisonArea ? { ...filter, type: "UNISON" as const } : filter;
  const typed = narrowed.type || narrowed.notType || narrowed.names.length || narrowed.traits.length || narrowed.characters.length;
  return typed ? narrowed : null;
}

/** The part of "attack <defender> [with <attackers>]" after the verb, split into who is attacked and who attacks. */
function attackObjects(objectSaid: string): { defender: CardFilter | undefined; attacker: CardFilter | undefined } | null {
  const object = objectSaid.trim().replace(DURATION_AFTER_OBJECT, "");
  const withAt = object.search(/\bwith\b/);
  if (/^with\b/.test(object)) {
    const attacker = attackSideFilter(object.slice(4));
    return attacker ? { defender: undefined, attacker } : null;
  }
  if (withAt > 0) {
    const head = object.slice(0, withAt).trim();
    const tail = object.slice(withAt + 4).trim();
    // "attack your Leader **with Battle Cards**": the tail names who attacks.
    // Anything else after "with" — "your Unisons **with specified costs of
    // 2**" (EX21-11) — describes the defender and stays with it.
    const tailKinds = tail.split(/\s*(?:,\s*|\s+(?:or|and)\s+)\s*/).map(typeOfWord);
    if (tailKinds.length && tailKinds.every((k) => k)) {
      const defender = attackSideFilter(head);
      const attacker = attackSideFilter(tail);
      return defender && attacker ? { defender, attacker } : null;
    }
  }
  const defender = attackSideFilter(object);
  return defender ? { defender, attacker: undefined } : null;
}

/** The verbs a prohibition's action starts with — what makes a list after "can't" a list of actions. */
const PROHIBITED_VERB = /^(?:attack|activate|block|combo|use|be|switch|play|send|place)\b/;

/**
 * "Can't attack **or** activate skills", "can't attack, be placed in your
 * opponent's Combo Area, or activate skills until …": the actions of one
 * prohibition said as a list, cut into one action each with the duration
 * they share. Only a list whose every item starts with a verb is cut — "can't
 * attack Leader Cards **or** Unison Cards" is one action with two defenders —
 * and nothing with an escape clause, whose "unless" belongs to which action
 * the words do not say. "Activate [Counter] or [Blocker] (skills)" (BT4-094,
 * BT14-152) names two kinds of skill after one verb.
 */
function prohibitedActs(rest: string): { parts: string[]; tail: string } | null {
  if (/\bunless\b|\bif\b|\bexcept\b|\bother than\b/.test(rest)) return null;
  const tail = DURATION_AFTER_OBJECT.exec(rest)?.[0] ?? "";
  const body = (tail ? rest.slice(0, rest.length - tail.length) : rest).trim();
  if (/^activate (?:the )?\[counter\] or \[blocker\](?: skills?)?$/.test(body)) return { parts: ["activate [counter] skills", "activate [blocker]"], tail };
  const parts = body.split(/\s*,\s*(?:or\s+)?|\s+or\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2 || !parts.every((p) => PROHIBITED_VERB.test(p))) return null;
  return { parts, tail };
}

/**
 * The cards a combo prohibition is about (5-7): "combo", "combo with Battle
 * Cards in their Battle Area" (P-060), "use a card in a combo" (BT28-013),
 * "use cards from your hand in combos" (BT14-152). Only the area and a
 * description the filter takes whole are read; anything else is `null`.
 */
function comboWords(rest: string): { filter?: CardFilter; fromArea?: "hand" | "battle" } | null {
  const body = rest.replace(DURATION_AFTER_OBJECT, "").replace(/\s+this turn$/, "").trim();
  let m: RegExpExecArray | null;
  let said: string;
  if (body === "combo") said = "";
  else if ((m = /^combo with (.+)$/.exec(body))) said = m[1];
  else if ((m = /^use (.+?) in (?:a )?combos?$/.exec(body))) said = m[1];
  else return null;
  let fromArea: "hand" | "battle" | undefined;
  said = said.replace(/\s+(?:from|in) (?:your|their|the) (hand|battle area)$/, (_, a: string) => {
    fromArea = a === "hand" ? "hand" : "battle";
    return "";
  }).trim();
  if (!said || /^(?:an?|any)?\s*cards?$/.test(said)) return { ...(fromArea ? { fromArea } : {}) };
  if (/^battle cards?$/.test(said)) return { filter: { ...parseFilter(""), type: "BATTLE" }, ...(fromArea ? { fromArea } : {}) };
  const filter = filterFor(said, null);
  if (!filter || unreadFilterWords(said, filter).length) return null;
  return { filter, ...(fromArea ? { fromArea } : {}) };
}

/** "From the Battle Area", "from Battle Areas", "from your hand" after a combo or a play: the area, or null for none said. */
function fromAreaWords(said: string): "hand" | "battle" | null {
  if (/\bfrom (?:the |a |your |their |your opponent'?s |its owner'?s )?battle areas?\b/.test(said)) return "battle";
  if (/\bfrom (?:your|their|their owners?'?s?) hands?\b/.test(said)) return "hand";
  return null;
}

/**
 * "With skills other than [Revive Blue/Green]" (owner ruling 26 Oct 2026):
 * the keyword whose own play a skill-play ban lets through, by the name the
 * VM gives its program (`ScriptFrame.viaKeyword`); null for any other words.
 * Only a keyword that plays cards by its own program is named — one the
 * engine reads as a keyword (`KEYWORD_NAMES`).
 */
function keywordException(said: string): string | null {
  const m = /^(?:with|by|using) (?:card )?skills? other than (?:the )?\[([a-z-]+)(?: [^\]]*)?\](?: skills?)?$/.exec(said.trim());
  return m ? (KEYWORD_NAMES[m[1]] ?? null) : null;
}

function compileProhibition(t: string, c: Ctx): Op[] | null {
  // BT8-044's back (prohibition batch 6, said this way by `taxWordings`):
  // "…can't attack Leader Cards until the start of your next Main Phase **as
  // long as the chosen card is in Rest Mode**" — the ban holds only while the
  // card the skill chose stays in that mode (and in play); the choice is kept
  // with the rule (`Prohibition.unlessVars`).
  {
    const asLong = /^(.*?)\s+as long as the chosen card is in (rest|active) mode$/.exec(t.trim().replace(/[.]$/, ""));
    if (asLong) {
      if (!c.last) return null;
      const inner = compileProhibition(asLong[1], c);
      if (!inner?.length || !inner.every((o) => o.op === "forbid" && !o.unless && !o.unlessPay?.length && !o.target)) return null;
      const held: Cond = { kind: "count", sel: { fromVar: c.last, area: "battle", mode: asLong[2] as "rest" | "active" }, atLeast: 1 };
      return inner.map((o) => ({ ...o, unless: { kind: "not", cond: held } }) as Op);
    }
  }
  // BT20-125 (prohibition batch 6, said this way by `taxWordings`): "you can't
  // activate [Counter] skills for the turn **while your opponent's <Evil
  // Saiyan> or <Cumber> card—both black and with an energy cost of 8—is
  // attacking**" — the ban holds only while one of those cards is the
  // attacking card of the battle (8-1), read in the printing card's chair.
  {
    const whileAttacking = /^(.*?)\s+while (your opponent'?s .+?) is attacking$/.exec(t.trim().replace(/[.]$/, ""));
    if (whileAttacking) {
      const sel = parseTarget(expandSharedCardDescription(whileAttacking[2]));
      if (!sel || sel.special || sel.fromVar || sel.filter?.unreadable || sel.side !== "opponent") return null;
      const inner = compileProhibition(whileAttacking[1], c);
      if (!inner?.length || !inner.every((o) => o.op === "forbid" && !o.unless && !o.unlessPay?.length)) return null;
      const attacker: Selector = { side: sel.side, area: "battle", ...(sel.filter ? { filter: sel.filter } : {}) };
      return inner.map((o) => ({ ...o, unless: { kind: "not", cond: { kind: "inBattle", sel: attacker, role: "attacker" } } }) as Op);
    }
  }
  // "…(with) Battle Cards **with energy costs greater than (or equal to) their
  // current energy** …" (P-219, BT15-043, P-299): a measure of the attacker no
  // filter says — its cost against its controller's Energy Area
  // (`costVsEnergy`). The sentence is read without the words, and only an
  // attack rule takes the measure back; anything else stays unread rather than
  // losing it.
  // "You can only use blue or green card skills to place cards under this
  // card" (BT8-040): a skill's move under this card (`placeUnder`) is
  // refused unless its card is one of those colours — the rule is about the
  // skill's card (`byFilter`), and is on a card with none of them. Colour
  // words only; any other description stays unread.
  const onlyColours = /^(?:(?:you\s+)?can\s+)?only use ((?:red|blue|green|yellow|black)(?:(?:,| or| and\/or)\s+(?:red|blue|green|yellow|black))*) card skills to place cards under this card(?:\s+(?:for|during|until)\b.*)?$/.exec(t.trim().replace(/[.]$/, ""));
  if (onlyColours) {
    const colours = onlyColours[1].split(/,?\s+(?:or|and\/or)\s+|,\s*/).map((w) => (w[0].toUpperCase() + w.slice(1)) as Color);
    return [{ op: "forbid", what: "placeUnder", side: "you", until: durationOf(t), target: { sel: { special: "self" } }, byFilter: { ...parseFilter(""), notColors: colours } }];
  }
  // "When a Battle Card attacks, the player who attacked can't attack with
  // tokens or Battle Cards with energy costs of 7 or less other than the card
  // they attacked with for the duration of the turn" (BT8-089): only the turn
  // player attacks (8-1), so "the player who attacked" is whoever's turn it is
  // (`turnPlayer`); the attackers are the tokens and the cost-7-or-less Battle
  // Cards (`anyOf`), except the attacking card itself (`exceptCards`, read as
  // the rule is put in force). Their Leader is not named, and still attacks.
  {
    const attacked = /^the player who attacked can'?t attack with (tokens or battle cards with energy costs? of (\d+) or less) other than the card they attacked with(?:\s+(?:for|during|until)\b.*)?$/.exec(t.trim().replace(/[.]$/, ""));
    if (attacked) {
      const filter: CardFilter = { ...parseFilter(""), anyOf: [{ ...parseFilter(""), token: true }, { ...parseFilter(""), type: "BATTLE", costMax: Number(attacked[2]) }] };
      return [{ op: "forbid", what: "attack", side: "both", turnPlayer: true, until: durationOf(t), filter, exceptCards: { sel: { special: "attacker" } } }];
    }
  }
  // "Markers on your Unisons can't be removed by your opponent's skills"
  // (P-676): a skill of that player's taking a marker off one of this
  // player's Unison Cards (13-5) — asked of the Unison, with the skill's
  // controller as the player. A marker paid as a cost of the Unison's own
  // skill is its controller's, and not this rule's.
  {
    const markers = /^markers on (your|your opponent'?s) unisons? can'?t be removed by (your opponent'?s|your) skills?$/.exec(t.trim().replace(/[.]$/, ""));
    if (markers) {
      const cardsOf: Side = markers[1] === "your" ? "you" : "opponent";
      const by: Side = markers[2] === "your" ? "you" : "opponent";
      return [{ op: "forbid", what: "removeMarkers", side: by, until: durationOf(t), cardsOf, filter: { ...parseFilter(""), type: "UNISON" } }];
    }
  }
  const measured = /\s+with energy costs? (greater than(?: or equal to)?) (?:your|their) current energy\b/.exec(t);
  if (measured) {
    const inner = compileProhibition(t.slice(0, measured.index) + t.slice(measured.index + measured[0].length), c);
    if (!inner || inner.length !== 1 || inner[0].op !== "forbid" || inner[0].what !== "attack" || inner[0].attackOnly || inner[0].against) return null;
    if (!inner[0].target && !inner[0].filter) return null;
    return [{ ...inner[0], costVsEnergy: measured[1] === "greater than" ? "above" : "atLeast" }];
  }
  // "…choose up to 1 of your opponent's Battle Cards …, and it can't attack
  // until the end of **their** next turn" (BT13-054): the pronoun is the
  // opponent the skill names, as `durationOf` reads it when the same clause
  // says "your opponent".
  // "…until the end of your next turn" on a [Counter: Attack] (BT9-087): it
  // resolves in the opponent's attack, on their turn, so the rule holds
  // through it and through its controller's next turn (`ownTurn`, which ends
  // with the first turn of its controller's after it is made).
  const nextOwn = /\buntil the end of your next turn\b/.test(t) && c.skillKind === "counter:attack";
  const until = nextOwn ? "ownTurn" : /\buntil the end of their(?: next)? turn\b/.test(t) && !/\byour opponent\b/.test(t) && /\byour opponent'?s?\b/i.test(c.raw) ? "nextTurn" : durationOf(t);
  const q = stripQualifiers(t);
  // "Your opponent can only attack **this card**" (DB2-068), "your opponent's
  // Battle Cards can only attack this card" (TB1-035; #1005): every attack of
  // those attackers is forbidden except against this card. Only this card is
  // read — "copies of this card" (P-230) is a name the rule would need to
  // resolve against each defender, and stays unread.
  const onlyThis = /^(your opponent|your opponent'?s [^,]+?)\s+can only attack this card(?:\s+(?:for|during|until)\b.*)?$/.exec(q);
  if (onlyThis) {
    const self: Ref = { sel: { special: "self" } };
    if (onlyThis[1] === "your opponent") return [{ op: "forbid", what: "attack", side: "opponent", until, attackOnly: self }];
    const target = refFor(onlyThis[1], c);
    return target ? [{ op: "forbid", what: "attack", until, target, attackOnly: self }] : null;
  }
  // #930: "You can only play Battle Cards by using [Union-Fusion] for the
  // remainder of the turn" (P-069 back) and "you can only play Battle Cards
  // using [Union-Fusion] skills for the turn" (P-226). A rule about the
  // player: every play of a Battle Card is forbidden — declared, by any other
  // skill, an evolution, another [Union] variant — except a [Union] play of
  // the variant named (owner-agreed narrow reading; the rule manual says
  // nothing more). Only "Battle Cards" bare is read: a narrower description
  // would need its own filter proof.
  const unionOnly = /^(?:you\s+can\s+)?only play battle cards\s+(?:by\s+)?using\s+\[union-(fusion|potara|absorb)\](?:\s+skills?)?(?:\s+(?:for|during|until)\b.*)?$/.exec(q);
  if (unionOnly) {
    const variant = (unionOnly[1][0].toUpperCase() + unionOnly[1].slice(1)) as "Fusion" | "Potara" | "Absorb";
    return [{ op: "forbid", what: "play", side: "you", until, filter: { ...parseFilter(""), type: "BATTLE" }, exceptUnion: [variant] }];
  }
  // #907 round 4: "can only attack **with Battle Cards one more time**" (BT15-119, BT15-140, P-321) puts
  // the "with" in front of the count, and "can only attack **2 more times**" (BT19-092, BT19-099,
  // BT24-005) has a number of its own: the same budget, `uses` of them.
  const counted = /^(you|your opponent'?s?)\s+can only attack(?: with (.+?))?\s+(one|\d+) more times?(?: with (.*?))?(?:\s+(?:for|during|until)\b.*)?$/.exec(q);
  if (counted) {
    const side: Side = counted[1] === "you" ? "you" : "opponent";
    const withWhat = counted[2] ?? counted[4];
    const uses = counted[3] === "one" ? 1 : Number(counted[3]);
    if (!(uses >= 1)) return null;
    const filter = withWhat ? filterFor(withWhat, null) : undefined;
    if (filter === null) return null;
    const type = withWhat && /\bleader cards?\b/.test(withWhat) ? "LEADER" : withWhat && /\bbattle cards?\b/.test(withWhat) ? "BATTLE" : null;
    return [{ op: "forbid", what: "attack", side, until, uses, filter: filter || type ? { ...(filter ?? parseFilter("")), ...(type ? { type } : {}) } : undefined }];
  }
  // The subject may be missing: "it gets +10000 power **and** can't attack for
  // the turn" splits at the "and", and the second half arrives with the card
  // it is about in the clause before it. Fifteen clauses.
  // BT1-031 [Permanent]: "Your opponent cannot activate [counter] against this
  // card's attack and cannot activate [blocker] during this card's attack":
  // while this card is the attack card (8-1), no [Counter] of theirs (any kind
  // — the battle is this attack) and no [Blocker]. The second half arrives
  // without its subject, which is the opponent the sentence named.
  {
    const during = /^(your opponent |the opponent )?(?:can'?t|cannot|may not) activate \[(counter|blocker)\](?: skills?)? (?:against|during) this card'?s attack$/.exec(t);
    if (during && c.permanent && (during[1] || /^your opponent\b/i.test(c.raw.replace(/^\s*\[[^\]]+\]\s*/, "")))) {
      const rule: Op = during[2] === "counter" ? { op: "forbid", what: "activateCounter", side: "opponent", until: "game" } : { op: "forbid", what: "block", side: "opponent", until: "game" };
      return [{ op: "if", cond: { kind: "inBattle", sel: { special: "self" }, role: "attacker" }, then: [rule] }];
    }
  }
  // "…your originally skill-less Battle Cards can't gain skills for the game"
  // (BT22-081, prohibition batch 6): a rule about those cards of that player's,
  // one played later included — no keyword or skill is gained by them.
  {
    const gain = /^(your|your opponent'?s) (.+? cards) can'?t gain skills(?:\s+(?:for|during|until)\b.*)?$/.exec(t.trim().replace(/[.]$/, ""));
    if (gain) {
      const filter = filterFor(gain[2], null);
      if (!filter || unreadFilterWords(gain[2], filter).length) return null;
      const type = /\bbattle cards\b/.test(gain[2]) ? { type: "BATTLE" as const } : /\bunison cards\b/.test(gain[2]) ? { type: "UNISON" as const } : {};
      return [{ op: "forbid", what: "gainSkills", until, cardsOf: gain[1] === "your" ? "you" : "opponent", filter: { ...filter, ...type } }];
    }
  }
  // "The power of your Battle Cards and Unisons can't be reduced by your
  // opponent's skills" (P-668, prohibition batch 6): a negative power change
  // by that player's skills — timed or a [Permanent] — is not applied to
  // those cards; one rule per kind of card.
  {
    const power = /^the power of (your|your opponent'?s) (battle cards|unisons|unison cards|battle cards and unisons|battle cards and unison cards) can'?t be reduced by (your opponent'?s|your) skills$/.exec(t.trim().replace(/[.]$/, ""));
    if (power) {
      const cardsOf: Side = power[1] === "your" ? "you" : "opponent";
      const by: Side = power[3] === "your" ? "you" : "opponent";
      const kinds = [...(/battle cards/.test(power[2]) ? ["BATTLE" as const] : []), ...(/unison/.test(power[2]) ? ["UNISON" as const] : [])];
      return kinds.map((type): Op => ({ op: "forbid", what: "powerReducedBySkill", side: by, until, cardsOf, filter: { ...parseFilter(""), type } }));
    }
  }
  // "Cards in your life can only be flipped face up by skills on mono-yellow
  // cards" (BT12-086, prohibition batch 6): a skill turning one of that
  // player's Life cards face up does not, unless its card is such a card.
  {
    const lifeOnly = /^cards in (your|your opponent'?s) life can only be flipped face up by (?:the )?skills (?:on|of) (.+? cards?)$/.exec(t.trim().replace(/[.]$/, ""));
    if (lifeOnly) {
      const exceptByFilter = filterFor(lifeOnly[2], null);
      if (!exceptByFilter || unreadFilterWords(lifeOnly[2], exceptByFilter).length) return null;
      return [{ op: "forbid", what: "flipLifeFaceUp", until, cardsOf: lifeOnly[1] === "your" ? "you" : "opponent", exceptByFilter }];
    }
  }
  // "…and for the turn, you can't add cards to your energy, **can only play
  // mono-blue <Zamasu> or mono-blue <Goku Black> cards**, …" (P-485,
  // prohibition batch 6): every play but of the cards described; the subject
  // is the "you" of the list it is cut from.
  {
    const only = /^(?:you )?can only play (.+? cards?)(?:\s+(?:for|during|until)\b.*)?$/.exec(t.trim().replace(/[.]$/, ""));
    if (only && !/\b(?:by|using|with|from)\b/.test(only[1])) {
      const exceptFilter = filterFor(only[1], null);
      if (!exceptFilter || unreadFilterWords(only[1], exceptFilter).length) return null;
      return [{ op: "forbid", what: "play", side: "you", until, exceptFilter }];
    }
  }
  const m = /^(.*?)\s*(?:can'?t|cannot|will not|won'?t)\s+(.*)$/.exec(t);
  if (!m) return null;
  let subject = m[1].trim();
  let rest0 = m[2].trim();
  // "Your opponent can't **declare to** attack this card" (BT25-100): an
  // attack is declared (8-1-1), so this is the attack itself.
  rest0 = rest0.replace(/^declare to attack\b/, "attack");
  // "If this card is in Rest Mode, **the opponent** cannot attack <Evil Wizard
  // Babidi>" (BT2-023): the same player as "your opponent".
  if (subject === "the opponent") subject = "your opponent";
  // "It can't attack **or** activate skills" (BT9-071), "…can't attack, be
  // placed in your opponent's Combo Area, or activate skills" (BT9-087): one
  // prohibition per action, each read as if printed alone with the same
  // subject and duration. Every action has to be read, or none is.
  const acts = prohibitedActs(rest0);
  if (acts) {
    const out: Op[] = [];
    for (const act of acts.parts) {
      const one = compileProhibition(`${subject} can't ${act}${acts.tail}`, c);
      if (!one) return null;
      out.push(...one);
    }
    return out;
  }
  // "Your opponent's Battle Cards and Unisons can't attack for the turn **if
  // they have 25000 power or more**" (BT22-138, #1005): a description of the
  // cards the rule is about, said after the verb. Folded back into the subject
  // — it used to be dropped, which banned every attacker. Any other "if" after
  // an attack prohibition is a condition this reader does not take, and the
  // clause stays unread rather than becoming a wider ban.
  // "This card can't attack **if it has 3 or fewer markers on it**" (BT11-154,
  // BT12-124, DB3-103, DB3-139, EX15-05, #1005): a condition on this card, which
  // is the same sentence the other markers cards print up front. The rule is
  // read without it and put under the condition the leading form reads.
  const selfIf = /^(this card|it)?\s*$/.test(subject) && /^attack(?:\s+(?:for|during|until)\b.*?)?\s+if (?:it|this card) (?:has|have) (.+)$/.exec(rest0);
  if (selfIf) {
    const cond = parseConditionClause(`if this card has ${selfIf[1].trim()}`, true);
    const rule = cond ? compileProhibition(t.replace(/\s+if (?:it|this card) (?:has|have) .+$/, ""), c) : null;
    return cond && rule ? [{ op: "if", cond: cond.cond, then: rule }] : null;
  }
  if (/^attack\b/.test(rest0) && /\sif\s/.test(rest0)) {
    // Only "they have": the plural pronoun is the set of cards the subject names.
    // "…if **it** has 2 or fewer markers" (BT11-154, DB3-103 …) is a condition
    // on one card — the subject here would drop it — and stays unread.
    const ifTail = /^(attack\b.*?)\s+if they have (.+)$/.exec(rest0);
    if (!ifTail || /^you$|^your opponent$/.test(subject) || /\bthis card\b|^it$|^that card$/.test(subject) || /\bif\b/.test(ifTail[1])) return null;
    subject = `${subject} with ${ifTail[2]}`;
    rest0 = ifTail[1];
  }
  // P-299 (#1005): "Battle Cards with energy costs **greater than or equal to
  // their current energy** can't attack Leader Cards". The comparison is a
  // measure the selector cannot say, and "their … energy" is not an area —
  // read as one it was the Energy Area, so the rule was about no card at all.
  // (The same words in a *choose* are read that way across the catalog; that
  // is a separate gap, listed in #1005's PR.)
  if (/\b(?:greater|more|higher|less|lower|fewer)\s+than(?:\s+or\s+equal\s+to)?\s+(?:your|their)\s+(?:current\s+)?energy\b/.test(subject)) return null;
  const unlessTail = /\s+unless\s+(.+)$/.exec(rest0);
  const unlessPlayBySkill = !!unlessTail && /^(?:it is |it's )?played by (?:card )?skills?$/.test(unlessTail[1].trim());
  // 20-14-1: "…unless your opponent sends 2 cards from their hand to their
  // Warp each time" is a price, not a condition (BT30-100). A play and a
  // switch of energy are one act each, so their price needs no "each time"
  // to be one: "can't play it unless they send 3 cards from their Drop to
  // their owner's Warp" (BT31-093) is paid by every play it taxes.
  const oneAct = /^(?:play\b|switch energy to active mode\b)/.test(rest0);
  // #677: a skill activation is taxed like an attack — "each time" is part of
  // the wording — but its price is paid while an Extra is still in the hand it
  // is used from, so a hand price is said the way a play's is.
  // #677: and on the five catalog cards that print one (EX06-35, DB1-015,
  // BT29-022, BT23-140, BT10-097) the price may close with "as an additional
  // (skill) cost" — the cost it is (22-30-3's "additional skill cost"), not a
  // part of what is done — so the words are dropped before the price is read.
  const taxOn = oneAct ? (/^play\b/.test(rest0) ? "play" : "switch") : /^activate\b/.test(rest0) ? "activate" : "attack";
  // A play's price says it the same two ways: "…as an additional cost"
  // (BT6-023) and "…as they play the Battle Card" (BT6-017) — when it is paid,
  // which is as the play is declared, the moment a play tax is charged.
  const priceSaid = unlessTail
    ? taxOn === "activate"
      ? unlessTail[1].trim().replace(/\s+as an additional (?:skill )?cost$/, "")
      : taxOn === "play"
        ? unlessTail[1].trim().replace(/\s+(?:as an additional cost|as they play the (?:battle )?card)(?=\s+(?:until|for|during)\b|$)/, "").replace(/\s+for the duration of your opponent's next turn$/, "")
        : unlessTail[1].trim()
    : "";
  const tax = unlessTail && !unlessPlayBySkill ? taxProgram(priceSaid, c, taxOn) : null;
  // "…unless {Dormant Legend} is in your Drop Area" (BT7-115, BT7-116, BT9-078):
  // the card named is there, which the condition reader says as "you have …".
  // "…unless {Display of Power Son Gohan} is in play in your Battle Area"
  // (BT6-081) is the same; "…unless <Pan> is under this card" (BT3-016) is
  // the card under this one, which the reader says as "there is a <Pan> under
  // this card".
  const escapeSaid = unlessTail ? unlessTail[1].trim().replace(/^(\{[^}]+\}|<[^>]+>(?: card)?) is (?:in play )?in your (drop area|battle area|hand|warp)$/, "you have $1 in your $2").replace(/^(\{[^}]+\}|<[^>]+>) is under this card$/, "there is a $1 under this card") : "";
  // "…unless you have <A>, <B> and <C> in your Drop Area" (P-021): each of
  // the named cards is there — read as one count per name, all of which have
  // to hold. (The bare condition reader takes such a list as any one of them.)
  const eachNamed = /^you have ((?:<[^>]+>,\s*)+<[^>]+>,? and <[^>]+>) in your (drop area|battle area|hand|warp)$/.exec(escapeSaid);
  // BT21-068's back (prohibition batch 6): "…unless there is a green <Android
  // 17> card with an energy cost of 2 under this card as well as a green
  // <Android 18> card with an energy cost of 2 under this card" — both.
  const asWell = eachNamed ? null : /^(there is an? .+? under this card) as well as (an? .+? under this card)$/.exec(escapeSaid);
  const eachConds = eachNamed ? [...eachNamed[1].matchAll(/<[^>]+>/g)].map((n) => parseConditionClause(`if you have ${n[0]} in your ${eachNamed[2]}`, true)?.cond ?? null) : asWell ? [parseConditionClause(`if ${asWell[1]}`, true)?.cond ?? null, parseConditionClause(`if there is ${asWell[2]}`, true)?.cond ?? null] : null;
  const unless = !unlessTail || unlessPlayBySkill || tax ? null : eachConds ? (eachConds.every((x) => x) ? { cond: { kind: "all" as const, conds: eachConds as Cond[] } } : null) : parseConditionClause(`if ${escapeSaid}`, true);
  if (unlessTail && !unlessPlayBySkill && !unless && !tax) return null;
  const rest = unlessTail && !unlessPlayBySkill ? rest0.slice(0, unlessTail.index).trim() : rest0;
  const withUnless = unless ? { unless: unless.cond } : {};
  // The engine charges a tax on an attack only; on any other action the
  // clause stays unread rather than becoming a ban or nothing at all.
  if (tax) {
    // "Your opponent can't play Battle Cards unless they …" (BT31-093,
    // BT31-150, said that way by `taxWordings`): a price on every play the
    // player declares of the cards it names — a rule about a player, paid by
    // that player.
    const play = /^play (.+?)(?:\s+(?:until|for|during)\b.*)?$/.exec(rest);
    if (play) {
      // "You and your opponent can't play Battle Cards … unless **they** …"
      // (BT6-017): both players, each paying for their own play — the price
      // runs in the frame of whoever plays, so "they" is that player.
      const both = /^you and your opponent$/.test(subject) && /^they\b/.test(priceSaid);
      const side: Side | null = /^you$/.test(subject) ? "you" : /^your opponent$/.test(subject) ? "opponent" : both ? "both" : null;
      if (!side || (side !== "both" && side !== tax.payer)) return null;
      const what = play[1].trim();
      if (/^cards?$/.test(what)) return [{ op: "forbid", what: "play", side, until, unlessPay: tax.ops }];
      const filter = filterFor(what, null);
      const type: "UNISON" | "EXTRA" | "BATTLE" | null = /\bunison cards?\b/.test(what) ? "UNISON" : /\bextra cards?\b/.test(what) ? "EXTRA" : /\bbattle cards?\b/.test(what) ? "BATTLE" : null;
      if (filter === null || (!filter && !type)) return null;
      const which = { ...(filter ?? parseFilter("")), ...(type ? { type } : {}) };
      // A description read only in part taxes more plays than the card does:
      // "a Battle Card with an original power the same as your declared
      // number" (BT23-055) is not every Battle Card.
      if (unreadFilterWords(what, which).length) return null;
      return [{ op: "forbid", what: "play", side, until, filter: which, unlessPay: tax.ops }];
    }
    // "The turn player can't switch energy to Active Mode with the skills of
    // Battle Cards or Extra Cards unless they …" (BT8-051, said that way by
    // `taxWordings`): whoever's turn it is, and only by those cards' skills.
    const sw = /^switch energy to active mode(?: with the skills? of (.+?))?(?:\s+(?:until|for|during)\b.*)?$/.exec(rest);
    if (sw) {
      if (subject !== "the turn player") return null;
      const named = sw[1] ?? "";
      const byTypes = (["LEADER", "BATTLE", "EXTRA", "UNISON"] as const).filter((t) => new RegExp(`\\b${t.toLowerCase()} cards?\\b`).test(named));
      // "…of Battle Cards or Extra Cards" and nothing else: a description the
      // type words do not cover would be read wider than it is printed.
      if (sw[1] && named.replace(/\b(?:leader|battle|extra|unison) cards?\b|\bor\b|\ban?\b|,/g, "").trim()) return null;
      return [{ op: "forbid", what: "switchEnergyToActive", side: "both", turnPlayer: true, until, ...(byTypes.length ? { byTypes: [...byTypes] } : {}), unlessPay: tax.ops }];
    }
    // #677, 20-14-1: "Your opponent can't activate skills unless they send 1
    // card from their hand to their Drop Area each time" — a price on every
    // skill activation that player makes, paid by them. No printed card is
    // known to say this (a synthetic wording proves the path); only the bare
    // player form is read, so a narrower description ("skills of Extra
    // Cards", "[Auto] skills") stays unread rather than taxing more than it
    // names. Both engines charge it on a declared or invoked [Activate];
    // an [Auto] or [Counter] activation under it stops with `NotYet`.
    //
    // Since the catalog check of 13 Oct 2026 four narrower descriptions are
    // read too, each exactly as printed and nothing wider:
    // - "activate the skills of Battle Cards in any Area" (BT23-140): every
    //   skill of a Battle Card, wherever the card is (`filter.type`);
    // - "activate Extra Cards" (BT10-097): 12-1-3's "activating an Extra
    //   Card" — an [Activate] or [Counter] skill of an Extra used from the
    //   hand (`extraCardActivation`), not an Extra's [Auto];
    // - "activate [Counter] skills" (DB1-015) and "activate [Counter: Attack]
    //   skills" (BT29-022): a [Counter] of that kind (`activateCounter`,
    //   `counterKind`).
    if (taxOn === "activate") {
      const side: Side | null = /^you$/.test(subject) ? "you" : /^your opponent$/.test(subject) ? "opponent" : null;
      if (!side || side !== tax.payer) return null;
      const said = rest.replace(/\s+(?:until|for|during)\b.*$/, "").trim();
      if (said === "activate skills") return [{ op: "forbid", what: "activateSkill", side, until, unlessPay: tax.ops }];
      if (/^activate (?:the )?skills of battle cards(?: in any area)?$/.test(said)) return [{ op: "forbid", what: "activateSkill", side, until, filter: { ...parseFilter(""), type: "BATTLE" }, unlessPay: tax.ops }];
      if (said === "activate extra cards") return [{ op: "forbid", what: "activateSkill", side, until, filter: { ...parseFilter(""), type: "EXTRA" }, extraCardActivation: true, unlessPay: tax.ops }];
      // TB1-077 (prohibition batch 6): "non-keyword [Auto]/[Activate] skills"
      // — every [Auto] and [Activate] line that is no keyword's own line.
      if (said === "activate non-keyword [auto]/[activate] skills") return [{ op: "forbid", what: "activateSkill", side, until, skillKinds: ["auto", "activate:main", "activate:battle", "activate:main/battle"], unlessPay: tax.ops }];
      const counter = /^activate (?:the )?\[counter(?:: (play|attack|battle card attack|counter))?\] skills$/.exec(said);
      if (counter) {
        const counterKind = counter[1] === undefined ? undefined : counter[1] === "battle card attack" ? "battleCardAttack" : (counter[1] as "play" | "attack" | "counter");
        return [{ op: "forbid", what: "activateCounter", side, until, ...(counterKind ? { counterKind } : {}), unlessPay: tax.ops }];
      }
      return null;
    }
    if (!/^attack\b/.test(rest) || /^attack (?:this card|it)\b/.test(rest)) return null;
    // "…during your opponent's next turn, **they** can't attack with Battle
    // Cards unless …" (BT11-034, BT14-122): "they" is the opponent the same
    // sentence has just named.
    const side: Side | null = /^you$/.test(subject) ? "you" : /^your opponent$/.test(subject) || (subject === "they" && /\byour opponent\b/i.test(c.raw)) ? "opponent" : null;
    if (side) {
      if (side !== tax.payer) return null;
      // A bare "can't attack" taxes every attack; "with Battle Cards" taxes
      // the attacks those cards make (a `filter` on the attacker, which
      // `ruleApplies` tests on the card asked about, #1015). A description of
      // the **defender** ("attack Leader Cards", "your non-Leader cards",
      // BT13-082, BT14-076, BT18-099) is not read: the tax is asked per
      // attacker, before a defender is known, and charging it on every attack
      // would tax attacks the card does not name.
      if (/^attack(?:\s+with cards?)?(?:\s+(?:for|during|until)\b.*)?$/.test(rest)) return [{ op: "forbid", what: "attack", side, until, unlessPay: tax.ops }];
      const objects = attackObjects(rest.replace(/^attack\s+/, ""));
      // A description of the **defender** ("can't attack Leader Cards unless
      // they discard 1 card each time", BT13-082; "your Leader Card", BT14-076;
      // "your non-Leader cards", BT18-099): the price is charged on an attack
      // declared against one of them (`attackTarget`), asked once the defender
      // is known, and a defender nobody can pay for is not offered.
      if (!objects || (!objects.attacker && !objects.defender)) return null;
      return [{ op: "forbid", what: "attack", side, until, ...(objects.attacker ? { filter: objects.attacker } : {}), ...(objects.defender ? { attackTarget: objects.defender } : {}), unlessPay: tax.ops }];
    }
    const target = subject ? refFor(subject, c) : (c.lastTarget ?? refFor("this card", c));
    if (!target) return null;
    return [{ op: "forbid", what: "attack", until, target, unlessPay: tax.ops }];
  }

  // Deck-building restrictions are not rules of play (6-1); the engine takes
  // the deck it is given, so the clause is read and does nothing.
  if (/^include\b/.test(rest)) return [];

  // "Players can't attack with Battle Cards with energy costs of 1" (P-074,
  // #1005): both of them, which is what an absent `side` has always meant.
  // "You and your opponent can't play Battle Cards …" (EX23-05, BT24-138):
  // both players, as "players" is.
  const side: Side | null = /^you$/.test(subject) ? "you" : /^your opponent$/.test(subject) ? "opponent" : (/^players$/.test(subject) && /^attack\b/.test(rest)) || (/^you and your opponent$/.test(subject) && /^play\b/.test(rest)) ? "both" : null;

  // A sentence about a player: what follows names the cards it is about.
  if (side) {
    let mm: RegExpExecArray | null;
    // BT6-053: a player prohibition, not damage prevention or an optional payment.
    if (side === "you" && /^add cards from your life to your hand(?: for the duration of the turn)?$/.test(rest))
      return [{ op: "forbid", what: "addLifeToHand", side, until }];
    // "…you can't add face-up cards in your life to your hand" (BT12-086,
    // prohibition batch 6): the same, for the Life cards that are face up.
    if (side === "you" && /^add face-up cards in your life to your hand$/.test(rest))
      return [{ op: "forbid", what: "addLifeToHand", side, until, filter: { ...parseFilter(""), faceUp: true }, ...withUnless }];
    // "You cannot lose the game … and the opponent cannot win the game"
    // (P-032): the game's loss and win conditions do not end the game for
    // that player while the rule holds (`loseGame`, `winGame`).
    if (/^lose the game(?:\s+(?:for|during|until)\b.*)?$/.test(rest)) return [{ op: "forbid", what: "loseGame", side, until, ...withUnless }];
    // EB1-07 (prohibition batch 6): "you can't activate non-keyword Leader Card
    // skills for the turn" — that player's Leader's [Auto] and [Activate] lines,
    // not its keyword ones.
    if (side !== "both" && /^activate non-keyword leader card skills(?:\s+(?:for|during|until)\b.*)?$/.test(rest)) return [{ op: "forbid", what: "activateSkill", side, until, filter: { ...parseFilter(""), type: "LEADER" }, skillKinds: ["auto", "activate:main", "activate:battle", "activate:main/battle"], ...withUnless }];
    // BT7-025 (prohibition batch 6): "…and you can't activate this skill for the
    // duration of the game" — this line of this card is not activated again.
    if (side === "you" && c.skillKind && /^activate this skill(?:\s+(?:for|during|until)\b.*)?$/.test(rest)) return [{ op: "forbid", what: "activateSkill", until, target: { sel: { special: "self" } }, skillKinds: [c.skillKind], ...withUnless }];
    // "If your Leader Card is an ≪Android≫, the opponent cannot draw cards when
    // their Leader Card activates [Awaken]" (P-017, prohibition batch 6): the
    // draw of that player's [Awaken] does not happen; the [Awaken] still does.
    if (side !== "both" && /^draw cards? when (?:their|your) leader(?: card)? activates \[awaken(?:: surge)?\](?: skills?)?$/.test(rest)) return [{ op: "forbid", what: "drawByAwaken", side, until, ...withUnless }];
    // "You can't flip your Leader Card to its front (back) for the turn"
    // (BT12-001, BT15-091): that player's Leader is not turned over that way —
    // by a skill's flip, or, to the back, by [Awaken] / [Wish] (22-2-4).
    if (side !== "both" && (mm = /^flip (your|their) leader(?: card)? to its (front|back)(?: side)?(?:\s+(?:for|during|until)\b.*)?$/.exec(rest))) {
      if ((mm[1] === "your") !== (side === "you")) return null;
      return [{ op: "forbid", what: mm[2] === "front" ? "flipLeaderFront" : "flipLeaderBack", side, until, cardsOf: side, ...withUnless }];
    }
    if (/^win the game(?:\s+(?:for|during|until)\b.*)?$/.test(rest)) return [{ op: "forbid", what: "winGame", side, until, ...withUnless }];
    // "Your opponent can't use non-Leader Card skills to add cards from their
    // deck to their hand" (BT9-077), "…can't add cards from their deck to
    // their hand using non-Leader Card skills" (DB3-092): a search by a skill
    // of a Battle, Extra or Unison Card (`byTypes`) moving a card of that
    // player's own deck (`cardsOf`, `fromArea: deck`) to a hand. A draw is
    // not an addition from the deck by a skill's choice, and is not stopped.
    if ((mm = /^(?:use non-leader card skills to add cards from (their|your) deck to (?:their|your) hand|add cards from (their|your) deck to (?:their|your) hand using non-leader card skills)(?:\s+(?:for|during|until)\b.*)?$/.exec(rest))) {
      const whose = mm[1] ?? mm[2];
      if (side === "both" || (whose === "your") !== (side === "you")) return null;
      return [{ op: "forbid", what: "beMovedBySkill", side, until, cardsOf: side, fromArea: "deck", toArea: "hand", byTypes: ["BATTLE", "EXTRA", "UNISON"], ...withUnless }];
    }
    // BT6-054: "…, except with this card's skill" — this card's own skill is
    // the one move the rule lets through (`exceptOwnSkills`, asked with the
    // skill's card as the move's `source`); damage and prices name none.
    if (side === "you" && (mm = /^add cards from your life to your hand( during your turn)?,? except with this card'?s skills?$/.exec(rest))) {
      const rule: Op = { op: "forbid", what: "addLifeToHand", side, until, exceptOwnSkills: true };
      return mm[1] ? [{ op: "if", cond: { kind: "isTurnPlayer" }, then: [rule] }] : [rule];
    }
    // "During your turn, you can't use skills to play Battle Cards" (BT20-024):
    // a play by a skill (`bySkill`), of the cards it names. A declared play is
    // not this rule's.
    if ((mm = /^use (?:card )?skills to play (.+?)(?:\s+(?:for|during|until)\b.*)?$/.exec(rest))) {
      const what = mm[1].trim();
      const type = /^battle cards?$/.test(what) ? "BATTLE" : /^cards?$/.test(what) ? null : undefined;
      if (type === undefined) return null;
      return [{ op: "forbid", what: "play", side, until, bySkill: true, ...(type ? { filter: { ...parseFilter(""), type } } : {}), ...withUnless }];
    }
    if ((mm = /^play\s+(.*)$/.exec(rest))) {
      // "…can't play Battle Cards … **from their owner's hands**" (EX23-05,
      // BT24-138): only a play of a card that is in a hand — declared or by a
      // skill — and not one from the Drop, the deck or the Warp.
      const fromHand = /\s+from (?:your|their|their owners?'?s?) hands?(?=\s+(?:for|during|until)\b|$)/;
      const fromArea = fromHand.test(mm[1]) ? ("hand" as const) : undefined;
      if (fromArea) {
        const what = mm[1].replace(fromHand, "").replace(DURATION_AFTER_OBJECT, "").trim();
        if (side === "both" && !/\btheir owners?'?s?\b/.test(mm[1])) return null;
        if (!/\bbattle cards?\b/.test(what)) return null;
        const filter = filterFor(what, null);
        if (filter === null || (filter && unreadFilterWords(what, filter).length)) return null;
        return [{ op: "forbid", what: "play", side, until, fromArea, filter: { ...(filter ?? parseFilter("")), type: "BATTLE" }, ...withUnless }];
      }
      if (side === "both") return null;
      const what = mm[1];
      if (/\bcopies of this card\b|\banother copy of this card\b/.test(what)) return [{ op: "forbid", what: "play", side, until, sameNameAsSelf: true, ...withUnless }];
      // "You can't play this card from any area **using skills**" (BT14-152):
      // a play by a skill only — read as the bare form it banned the play
      // from the hand the card is printed to be played by.
      if (/^this card from any area (?:using|by|with) (?:card )?skills?(?:\s+(?:for|during|until)\b.*)?$/.test(what)) return [{ op: "forbid", what: "play", side, until: "game", target: { sel: { special: "self" } }, bySkill: true, ...withUnless }];
      // "You can't play this card from any area with skills other than [Revive
      // Blue/Green]" (owner ruling 26 Oct 2026): the declared play from the
      // hand is allowed; of the plays a skill makes, only the named keyword's.
      const butKeyword = keywordException(what.replace(/^this card from any area\s+/, ""));
      if (/^this card from any area\b/.test(what) && butKeyword) return [{ op: "forbid", what: "play", side, until: "game", target: { sel: { special: "self" } }, bySkill: true, exceptKeyword: butKeyword, ...withUnless }];
      if (/^this card\b/.test(what) && /\bskills?\b/.test(what)) return null;
      // "…this card from any area" (P-021) is a rule of the card wherever it is, for the game — read from the hand it is played from.
      if (/^this card\b/.test(what)) return [{ op: "forbid", what: "play", side, until: /^this card from any area$/.test(what.trim()) ? "game" : until, target: { sel: { special: "self" } }, ...withUnless }];
      // "…play Battle Cards from their hand **with the skills of cards with
      // [Super Combo]**" (BT4-104): where the play comes from and what plays
      // it are not a description of the card, and read as one they were.
      // Prohibition batch 5 reads that one wording whole: a play by a skill
      // (`bySkill`) of a Battle Card from that player's hand (`fromArea`),
      // when the skill's card has the keyword named (`byFilter`, asked of the
      // card whose skill plays). A declared play, and another skill's, are not
      // this rule's.
      const byKeyword = /^(battle cards?) from (?:their|your) hands? with the skills? of (cards? with \[[^\]]+\])(?:\s+(?:for|during|until)\b.*)?$/.exec(what);
      if (byKeyword) {
        const byFilter = filterFor(byKeyword[2], null);
        if (!byFilter || !byFilter.keywords.length || unreadFilterWords(byKeyword[2], byFilter).length) return null;
        return [{ op: "forbid", what: "play", side, until, bySkill: true, fromArea: "hand", filter: { ...parseFilter(""), type: "BATTLE" }, byFilter, ...withUnless }];
      }
      // "…you can't play any cards **other than red <Trunks: Future> cards** for
      // the turn" (BT23-005, prohibition batch 6): every play but of the cards
      // described (`exceptFilter`). Read before as a description of the cards
      // banned, it banned exactly the cards it lets through.
      const otherThan = /^(?:any )?cards? other than (.+?)(?:\s+(?:for|during|until)\b.*)?$/.exec(what);
      if (otherThan) {
        const exceptFilter = filterFor(otherThan[1], null);
        if (!exceptFilter || unreadFilterWords(otherThan[1], exceptFilter).length) return null;
        return [{ op: "forbid", what: "play", side, until, exceptFilter, ...withUnless }];
      }
      if (/\bother than\b/.test(what)) return null;
      // "…and you can't play cards from your deck for the rest of the game"
      // (P-496, prohibition batch 6): any play of a card in that player's deck.
      if (side === "you" && /^cards from your deck(?:\s+(?:for|during|until)\b.*)?$/.test(what)) return [{ op: "forbid", what: "play", side, until, fromArea: "deck", ...withUnless }];
      if (/\bfrom\b|\bskills? of\b|\bby (?:card )?skills?\b|\busing\b/.test(what)) return null;
      const filter = filterFor(what, null);
      const type = /\bunison cards?\b/.test(what) ? "UNISON" : /\bextra cards?\b/.test(what) ? "EXTRA" : /\bbattle cards?\b/.test(what) ? "BATTLE" : null;
      // A description that could not be read must not fall back to the type
      // alone: "you can't play Battle Cards with [X]" would ban every Battle
      // Card, which is a wider rule than the card states.
      if (filter === null) return null;
      if (!filter && !type) return null;
      return [{ op: "forbid", what: "play", side, until, filter: { ...(filter ?? parseFilter("")), ...(type ? { type } : {}) }, ...withUnless }];
    }
    // "You can't place this card in your Combo Area from any area" (BT6-081):
    // the card is never used in a combo (5-7), from the hand or the Battle
    // Area alike.
    if (side === "you" && /^place this card in your combo area from any area$/.test(rest)) return [{ op: "forbid", what: "combo", side, until: "game", target: { sel: { special: "self" } }, ...withUnless }];
    // "Your opponent can't switch Battle Cards or Unisons to Active Mode during
    // the next Charge Phase" (BT30-146): the Charge Phase's switch (7-2-7) of
    // that player's cards in their Battle Area and Unison Area — a card in the
    // Energy Area is not one (`fromArea`). A skill may still switch them later
    // that turn, as with "it can't switch … during your opponent's next Charge
    // Phase" (#539). Said on the turn of the card that says it, "the next
    // Charge Phase" is the opponent's.
    if (side === "opponent" && (mm = /^switch (battle cards|unisons|unison cards|battle cards (?:or|and) (?:unisons|unison cards)) to active mode during (?:the|your opponent'?s|their) next charge phase$/.exec(rest))) {
      const kinds = [...(/battle cards/.test(mm[1]) ? ["BATTLE" as const] : []), ...(/unison/.test(mm[1]) ? ["UNISON" as const] : [])];
      return kinds.map((type): Op => ({ op: "forbid", what: "switchToActiveInCharge", side, until: "afterOpponentCharge", filter: { ...parseFilter(""), type }, fromArea: type === "BATTLE" ? "battle" : "unison", ...withUnless }));
    }
    // "You may not activate [EX-Evolve] for the duration of the turn" (BT4-003):
    // that keyword skill, on any of the player's cards (`keywordSkill`). An
    // [Evolve] rule would be every [Evolve] skill (22-5-2-2); only the one
    // keyword named is read.
    if ((mm = /^activate \[(ex-evolve|xeno-evolve|evolve|z-awaken)\](?: skills?)?(?:\s+(?:for|during|until)\b.*)?$/.exec(rest))) {
      const keywordSkill = mm[1] === "ex-evolve" ? "EX-Evolve" : mm[1] === "xeno-evolve" ? "Xeno-Evolve" : mm[1] === "z-awaken" ? "Z-Awaken" : "Evolve";
      return [{ op: "forbid", what: "activateSkill", side, until, keywordSkill, ...withUnless }];
    }
    // 5-7: "your opponent can't combo for the battle", "…can't use a card in a
    // combo", "you can't combo with cards in your Battle Area" (BT10-154),
    // "…can't use cards from your hand in combos" (BT14-152).
    const combo = /^(?:combo\b|use\b.*\bin (?:a )?combos?\b)/.test(rest) ? comboWords(rest.replace(/\s+for the duration of this card'?s battle$/, "")) : null;
    // "You can't use your Earthling Tokens or green <Android 17>/<Android 18>
    // cards with an energy cost of 2 in a combo" (BT21-099, prohibition batch
    // 6): two kinds of card, one rule each — only when the whole cannot be read
    // as one description and each half is read whole on its own.
    if (!combo && side === "you" && !/\bthis card'?s battle\b/.test(rest)) {
      const either = /^use your (.+? (?:tokens|cards)) or (.+?) in (?:a )?combos?((?:\s+(?:for|during|until)\b.*)?)$/.exec(rest);
      const halves = either ? [either[1], either[2]].map((half) => comboWords(`use ${half} in a combo`)) : null;
      if (halves && halves.every((h) => h?.filter && !h.fromArea)) return halves.map((h) => ({ op: "forbid", what: "combo", side, until, filter: h!.filter, ...withUnless }) as Op);
    }
    if (combo) {
      // "For the duration of this card's battle" (BT3-033): a [Permanent] says
      // it holds while this card is in a battle; a resolved skill, for the battle.
      if (/\bthis card'?s battle\b/.test(rest)) {
        const rule: Op = { op: "forbid", what: "combo", side, until: "battle", ...combo, ...withUnless };
        return c.permanent ? [{ op: "if", cond: { kind: "inBattle", sel: { special: "self" } }, then: [rule] }] : [rule];
      }
      return [{ op: "forbid", what: "combo", side, until, ...combo, ...withUnless }];
    }
    if (/^combo\b|^use\b.*\bcombos?\b/.test(rest)) return null;
    // "You can't place cards under this card, except with this card's skill"
    // (BT25-008, BT7-022; 23-2): a skill of this player's moving a card under
    // this one, unless the skill is this card's own (`exceptOwnSkills`).
    // "You can't place more than 1 card with the same character name under
    // this card in your Battle Area" (BT22-113, prohibition batch 6): a card
    // is kept out from under this card while it is in the Battle Area only if
    // one sharing a character name with it is there already.
    if (/^place more than 1 card with the same character name under this card(?: in your battle area)?$/.test(rest)) {
      return [{ op: "forbid", what: "placeUnder", side, until: "game", target: { sel: { special: "self" } }, sameCharacterUnder: true, ...(/in your battle area$/.test(rest) ? { fromArea: "battle" as const } : {}), ...withUnless }];
    }
    if ((mm = /^place cards under this card(,? except with this card'?s skills?)?(?:\s+(?:for|during|until)\b.*)?$/.exec(rest))) {
      return [{ op: "forbid", what: "placeUnder", side, until, target: { sel: { special: "self" } }, ...(mm[1] ? { exceptOwnSkills: true as const } : {}), ...withUnless }];
    }
    // "You can't send cards from Drop Areas to Warps" (BT6-028), "…from your
    // Drop Area to your Warp" (BT16-001): a move by this player — a skill's or
    // a price's — out of a Drop and into a Warp.
    if ((mm = /^send cards from (drop areas|(?:your|their) drop(?: area)?) to (?:warps|(?:your|their) warp)(?:\s+(?:for|during|until)\b.*)?$/.exec(rest))) {
      return [{ op: "forbid", what: "dropToWarp", side, until, fromArea: "drop", ...(mm[1] === "drop areas" ? {} : { fromOwnArea: true as const }), ...withUnless }];
    }
    // "Your opponent can't activate its skills" (BT31-111): the card the
    // sentence has just named, and only that player's activation of it.
    // A duration has to be said in the clause: BT31-111 prints it ahead of
    // the sentence ("until the end of your opponent's turn, that card can't
    // attack and your opponent can't activate its skills"), and only the
    // first clause receives it — so the clause looks back in the printed
    // sentence for a duration leading the "can't …" it is joined to by "and",
    // and takes that one; with none, it stays unread.
    if (/^activate (?:its|their) skills\s+(?:for|during|until)\b/.test(rest)) {
      const it = c.lastTarget;
      return it ? [{ op: "forbid", what: "activateSkill", side, until, target: it, ...withUnless }, { op: "forbid", what: "block", until, target: it, ...withUnless }] : null;
    }
    if (/^activate (?:its|their) skills$/.test(rest)) {
      const said = t.replace(/[.\s]+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const lead = new RegExp(`(until the end of [^,.]+?|for the (?:duration of the )?turn),\\s+[^,.]*?\\bcan'?t\\b[^,.]*?\\s+and\\s+${said}`, "i").exec(c.raw);
      const it = c.lastTarget;
      const span = lead ? (/\buntil the end of their(?: next)? turn\b/i.test(lead[1]) ? "nextTurn" : durationOf(lead[1])) : until;
      return lead && it ? [{ op: "forbid", what: "activateSkill", side, until: span, target: it, ...withUnless }, { op: "forbid", what: "block", until: span, target: it, ...withUnless }] : null;
    }
    // "Your opponent can't activate skills on Battle Cards for the duration of
    // the turn" (P-093): every skill of a Battle Card, in any area.
    // Owner ruling 26 Oct 2026 (A2): "can't activate skills on Battle Cards"
    // covers their [Counter] lines (`activateCounter`, asked on its own) and
    // their [Blocker] (22-4: a [Blocker] is activated) as well.
    if (/^activate (?:the )?skills (?:of|on) battle cards(?: in any areas?)?(?:\s+(?:for|during|until)\b.*)?$/.test(rest)) {
      const battle = { ...parseFilter(""), type: "BATTLE" as const };
      return [
        { op: "forbid", what: "activateSkill", side, until, filter: battle, ...withUnless },
        { op: "forbid", what: "activateCounter", side, until, filter: battle, ...withUnless },
        { op: "forbid", what: "block", side, until, filter: battle, ...withUnless },
      ];
    }
    // "When this card is in a battle, your opponent can't activate
    // non-[Super Combo] card skills" (BT18-019), "…can't activate skills on
    // Battle Cards with original energy costs of 7 or less from any area when
    // this card is in a battle" (BT14-097): the skills of the cards described,
    // wherever they are — an [Activate] or [Auto] (`activateSkill`) and a
    // [Counter], which is asked on its own (`activateCounter`). A trailing
    // "when this card is in a battle" is the rule's escape turned round: it
    // holds only while this card is in a battle.
    {
      const inBattleTail = /\s+when this card is in a battle$/.exec(rest);
      const body = inBattleTail ? rest.slice(0, inBattleTail.index) : rest;
      const said =
        /^activate (non-\[[^\]]+\]) card skills(?:\s+(?:for|during|until)\b.*)?$/.exec(body)?.[1]?.concat(" cards") ??
        /^activate skills (?:on|of) (battle cards with .+?)(?: from any area| in any area)?(?:\s+(?:for the|until|during)\b.*)?$/.exec(body)?.[1];
      if (said && !(inBattleTail && unless)) {
        const filter = filterFor(said, null);
        if (!filter || unreadFilterWords(said, filter).length) return null;
        const which = /\bbattle cards?\b/.test(said) ? { ...filter, type: "BATTLE" as const } : filter;
        const escape = inBattleTail ? { unless: { kind: "not" as const, cond: { kind: "inBattle" as const, sel: { special: "self" as const } } } } : withUnless;
        // Owner ruling 26 Oct 2026 (A2): a [Blocker] is a skill activated
        // (22-4), so the described cards do not block either.
        return [
          { op: "forbid", what: "activateSkill", side, until, filter: which, ...escape },
          { op: "forbid", what: "activateCounter", side, until, filter: which, ...escape },
          { op: "forbid", what: "block", side, until, filter: which, ...escape },
        ];
      }
    }
    // "You can't activate Extras" (BT20-024; owner ruling 26 Oct 2026): 12-1-3's
    // "activating an Extra Card" — an [Activate] or [Counter] skill of an Extra
    // used from the hand (`extraCardActivation`), the reading BT10-097's taxed
    // form already has; an Extra's [Auto] is not an activation of the card.
    // A [Counter] is asked as `activateCounter`, so the Extra's [Counter] lines
    // are that rule's, said of Extra Cards.
    if (/^activate extra(?:s| cards)(?:\s+(?:for|during|until)\b.*)?$/.test(rest)) {
      const extra = { ...parseFilter(""), type: "EXTRA" as const };
      return [
        { op: "forbid", what: "activateSkill", side, until, filter: extra, extraCardActivation: true, ...withUnless },
        { op: "forbid", what: "activateCounter", side, until, filter: extra, ...withUnless },
      ];
    }
    // "You can't activate the [Activate: Main] skill on copies of this card
    // for the turn" (BT12-031, BT12-035 …): every card with this card's name,
    // this one included, and only lines of the kind it names. A [Counter] is
    // asked as `activateCounter`; "copies of this card" bare is every line,
    // "…from your hand" only a card used from there.
    if (side === "you") {
      const copies = COPIES_ACTIVATION.exec(`you can't ${rest}`);
      if (copies) {
        const kind = copies[1] === undefined ? undefined : copies[1].replace(": ", ":");
        const fromHand = copies[2] ? { fromArea: "hand" as const } : {};
        const skillRule: Op = { op: "forbid", what: "activateSkill", side, until, sameNameAsSelf: true, ...(kind ? { skillKinds: [kind] } : {}), ...fromHand, ...withUnless };
        const counterRule: Op = { op: "forbid", what: "activateCounter", side, until, sameNameAsSelf: true, ...fromHand, ...withUnless };
        if (kind === "counter") return [counterRule];
        return kind ? [skillRule] : [skillRule, counterRule];
      }
    }
    if (/^attack\b/.test(rest)) {
      // "attack this card" is about the defender, not the attacker.
      if (/^attack (?:this card|it)\b/.test(rest)) return [{ op: "forbid", what: "beAttacked", until, target: { sel: { special: "self" } }, ...withUnless }];
      // A bare "can't attack" bans every attack of the player's.
      if (/^attack(?:\s+(?:for|during|until)\b.*)?$/.test(rest)) return [{ op: "forbid", what: "attack", side, until, ...withUnless }];
      // What follows the verb is the **defender** ("your Leader", "Leader
      // Cards or Unison Cards", EX21-11's "your Unisons with specified costs
      // of 2", #728), the **attackers** ("with Battle Cards"), or both ("your
      // Leader with Battle Cards", BT18-098) — #1005. Read as one description
      // it forbade the attackers instead of the defenders, and a bare
      // "can't attack" for every wording it could not place: the cards that
      // print "can't attack your Leader" banned every attack the player had.
      // A description the filter cannot say whole stays unread.
      const objects = attackObjects(rest.replace(/^attack\s+/, ""));
      if (!objects) {
        // "Your opponent cannot attack your other Battle Cards" (BT1-093), "the
        // opponent cannot attack <Evil Wizard Babidi>" (BT2-023): the cards of
        // yours no attack of theirs may be declared against — each one asked
        // as the defender (`beAttacked`), whoever attacks it.
        const object = rest.replace(/^attack\s+/, "").replace(DURATION_AFTER_OBJECT, "").trim();
        if (side !== "opponent" || !/^(?:your\b|[<{])/.test(object) || /\bwith\b/.test(object)) return null;
        const target = refFor(object, c);
        if (!target || !("sel" in target) || target.sel.special || (target.sel.side && target.sel.side !== "you")) return null;
        return [{ op: "forbid", what: "beAttacked", until, target, ...withUnless }];
      }
      return [{ op: "forbid", what: "attack", side, until, ...(objects.attacker ? { filter: objects.attacker } : {}), ...(objects.defender ? { attackTarget: objects.defender } : {}), ...withUnless }];
    }
    if (/^activate\b/.test(rest) && /\[counter/.test(rest)) {
      // BT6-060/061: energy-cost information is on the Counter card
      // (1-2-4/5), not its additional skill price or what is actually paid.
      const bounded = /^activate (?:the )?\[counter\] skills? with energy costs? of (\d+) or more(?: for (?:the (?:duration of the )?turn|the battle)| during (?:this turn|the battle)| until the end of (?:the turn|the battle))?$/.exec(rest);
      if (bounded) return [{ op: "forbid", what: "activateCounter", side, until, filter: { ...parseFilter(""), costMin: Number(bounded[1]) }, ...withUnless }];
      // #716: "the [Counter: Play] skills of other cards for the turn"
      // (BT10-008's price) names one kind of [Counter] and leaves this card out.
      // BT15-016's own price says it "on other cards this turn".
      const narrow = /^activate (?:the )?\[counter: (play|attack|battle card attack|counter)\] skills (?:of|on) other cards(?:\s+(?:for|during|until)\b.*|\s+this turn)?$/.exec(rest);
      if (narrow) {
        const counterKind = narrow[1] === "battle card attack" ? "battleCardAttack" : (narrow[1] as "play" | "attack" | "counter");
        return [{ op: "forbid", what: "activateCounter", side, until, counterKind, otherCards: true, ...withUnless }];
      }
      if (/^activate (?:the )?\[counter\] skills?(?:\s+(?:until|for|during)\b.*)?$/.test(rest))
        return [{ op: "forbid", what: "activateCounter", side, until, ...withUnless }];
      // "Your opponent may not activate [Counter: Play] skills for the duration
      // of the turn" (BT4-122): one kind of [Counter] (22-10-2-1), every card's.
      const kind = /^activate (?:the )?\[counter: (play|attack|battle card attack|counter)\] skills?(?:\s+(?:until|for|during)\b.*)?$/.exec(rest);
      if (kind) return [{ op: "forbid", what: "activateCounter", side, until, counterKind: kind[1] === "battle card attack" ? "battleCardAttack" : (kind[1] as "play" | "attack" | "counter"), ...withUnless }];
      // A trailing qualifier cannot be discarded into a wider Counter ban.
      return null;
    }
    if (/^activate\b/.test(rest) && /\[blocker/.test(rest)) return [{ op: "forbid", what: "block", side, until, ...withUnless }];
    // "…you can't add cards to your energy" (P-485, prohibition batch 6): the
    // Charge Phase's placement and a skill's move of the player's cards into
    // their Energy Area from any area.
    if (side !== "both" && /^add cards? to (?:your|their) energy(?: area)?(?:\s+(?:for|during|until)\b.*)?$/.test(rest)) {
      return [
        { op: "forbid", what: "placeEnergy", side, until, ...withUnless },
        { op: "forbid", what: "beMovedBySkill", side, until, cardsOf: side, fromArea: "any", toArea: "energy", ...withUnless },
      ];
    }
    // "You can't place cards in your energy for the turn" (EX22-02): the
    // Charge Phase, which the engine offers as an action of its own (3-8).
    if (/^place cards? (?:in|into) (?:your|their) energy\b/.test(rest)) return [{ op: "forbid", what: "placeEnergy", side, until, ...withUnless }];
    // "You can't place cards on top of this card" (BT1-111, BT25-131): no
    // card is played on top of it — an evolution or a [Union-Potara] (23-1).
    if (/^place cards on top of this card(?:\s+(?:for|during|until)\b.*)?$/.test(rest)) return [{ op: "forbid", what: "placeOnTop", side, until, target: { sel: { special: "self" } }, ...withUnless }];
    // "You can't switch this card in your Energy Area to Active Mode"
    // (BT18-052): a rule about itself while it is in the Energy Area — a
    // skill's switch and the Charge Phase's alike (`fromArea: energy`).
    if (side === "you" && /^switch this card in your energy(?: area)? to active mode$/.test(rest)) return [{ op: "forbid", what: "switchToActive", until: "game", target: { sel: { special: "self" } }, fromArea: "energy", ...withUnless }];
    // "You can't use non-≪Red Ribbon Army≫ card skills to place cards in your
    // energy" (BT17-032): a skill of a card the description fits (`byFilter`,
    // asked of the skill's card) moving a card of this player's, from any
    // area, into an Energy Area. The Charge Phase is no skill's.
    if (side !== "both" && (mm = /^use (.+?) card skills to place cards (?:in|into) (your|their) energy(?:\s+(?:for|during|until)\b.*)?$/.exec(rest))) {
      const said = `${mm[1]} card`;
      const byFilter = filterFor(said, null);
      if (!byFilter || unreadFilterWords(said, byFilter).length || (mm[2] === "your") !== (side === "you")) return null;
      return [{ op: "forbid", what: "beMovedBySkill", side, until, cardsOf: side, fromArea: "any", toArea: "energy", byFilter, ...withUnless }];
    }
    // "You cannot place your opponent's hand in their Drop Area using
    // {Destined Conclusion Hero}'s skill for the duration of the turn"
    // (TB2-045): that card's skill (`byFilter` by name) moving a card of the
    // opponent's hand to a Drop Area — every card of it, one that enters
    // the hand later included (`cardsOf`).
    if (side === "you" && (mm = /^place your opponent'?s hand in their drop(?: area)? using (\{[^}]+\})'?s skills?(?:\s+(?:for|during|until)\b.*)?$/.exec(rest))) {
      return [{ op: "forbid", what: "beMovedBySkill", side, until, cardsOf: "opponent", fromArea: "hand", toArea: "drop", byFilter: { ...parseFilter(""), names: [mm[1].slice(1, -1).trim()] }, ...withUnless }];
    }
    return null;
  }

  // "Its attacks can't be negated", "this card's attack can't be negated for
  // the turn", "that card's attack cannot be negated" (EX03-14, BT25-126,
  // P-080, P-072; #936). The attack half of "this card's attack and skill
  // cannot be negated" (BT1-043, TB1-097) is this too: `taxWordings` cuts that
  // into its two rules before the sentence is split. A `permit
  // attackUnnegatable` (8-6: a negation of this card's attack fails) — not an
  // attack prohibition and not skill immunity. A [Permanent] says it for the
  // game; "its" and a missing subject are the card the clause before named.
  // "…the chosen card gets +15000 power, …, can't have its attacks negated"
  // (DB2-033), "this card gets +6000 power, can't have its attack negated"
  // (BT5-009): the same rule said of the card, in a list that names it once.
  if (/^have (?:its|their) attacks? negated(?:\s+(?:for|during|until)\b.*)?$/.test(rest0)) {
    const owner: Ref | null = subject ? refFor(subject, c) : (c.lastTarget ?? refFor("this card", c));
    return owner ? [{ op: "permit", what: "attackUnnegatable", target: owner, until: c.permanent ? "game" : until }] : null;
  }
  {
    const attackSaid = /^(.*?)(?:'s)?\s+attacks?$/.exec(subject);
    if (attackSaid && /^be negated\b/.test(rest)) {
      const who = attackSaid[1].trim();
      const owner: Ref | null = !who || who === "its" || who === "their" || who === "it" ? (c.lastTarget ?? refFor("this card", c)) : refFor(who, c);
      if (!owner) return null;
      return [{ op: "permit", what: "attackUnnegatable", target: owner, until: c.permanent ? "game" : until }];
    }
  }

  // A sentence about cards: "this card", "it", "your Battle Cards". With no
  // subject at all it continues the clause before it, and only falls back to
  // this card when nothing was named — which is what the sets mean when they
  // print "this card gets +5000 power and can't attack for the turn".
  // "That card's [Blocker] can't activate for the turn" (P-498): the card's
  // [Blocker] is what blocks (22-4), so it is that card that can't block.
  const keywordSubject = /^(.+?)'s? \[blocker\](?: skills?)?$/.exec(subject);
  if (keywordSubject && /^activate(?:\s+(?:for|during|until)\b.*)?$/.test(rest)) {
    const owner = refFor(keywordSubject[1], c);
    return owner ? [{ op: "forbid", what: "block", until, target: owner, ...withUnless }] : null;
  }
  const target = subject ? refFor(subject, c) : (c.lastTarget ?? refFor("this card", c));
  if (!target) return null;
  // "Your opponent's Battle Cards **with the same keyword skills as cards
  // under this card**" (BT27-069) is a comparison no selector says; read as a
  // description it became the cards under this card. A subject that names the
  // opponent's cards and resolved to the player's own is refused the same way.
  if (/\bsame\b.*\bas\b/.test(subject)) return null;
  if (/^your opponent'?s\b/.test(subject) && "sel" in target && target.sel.side === "you") return null;
  // "can't be KO'd by your opponent's skills" — who is stopped from doing it.
  // "…by your opponent's **card** skills" (BT8-040), "…by **an** opponent's
  // skill" (BT30-030), "…by **the skills of** your opponent's Battle Cards"
  // (BT10-058) and "…by your **own** skills" (BT3-078) say the same two sides.
  const bySide: Side | undefined = /\bby (?:your |an )?opponent'?s? (?:card'?s? )?skills?\b|\bby the skills of your opponent'?s\b/.test(rest) ? "opponent" : /\bby your (?:own )?skills?\b/.test(rest) ? "you" : undefined;
  // "This card can't be played by skills from any area", "…from any area
  // except by skills" (20-14). Fifteen cards print one of these, and the moment
  // that matters is always a *skill* reaching into the Drop or the deck for
  // them, so which of the two it is decides everything. The forms that carve
  // out an exception — "by skills other than its own" — are left unread: an
  // exception the engine gets wrong bans a play the card allows, and a gap here
  // only means the card is playable as normal. ("with non-[Evolve] skills" is
  // read above, #933, because its one exception is a kind of play the VM can
  // tell.)
  // #933: "This card can't be played from any area with non-[Evolve] skills"
  // (BT13-017, BT13-021, BT13-024). The carve-out is exactly the Evolve family
  // — a skill play that is an evolution still happens — and nothing else about
  // the card changes: it is still played from hand for its printed cost.
  if (/^be played from any area with non-\[evolve\] skills?$/.test(rest)) {
    return [{ op: "forbid", what: "play", until: "game", target, bySkill: true, exceptEvolve: true, ...withUnless }];
  }
  // "This card can't be played from any area unless {Dormant Legend} is in
  // your Drop Area" (BT9-078, BT9-079, P-281, BT22-077): every play of it —
  // declared, by a skill, by a keyword — while the escape does not hold.
  if (/^be played(?: from any area)?$/.test(rest) && unless) return [{ op: "forbid", what: "play", until: "game", target, ...withUnless }];
  // "This card can't be played from any area by skills other than its own"
  // (EB1-27), "…by card skills except its own" (DB2-008): a play by a skill,
  // unless the skill is one of this card's (`exceptOwnSkills`) — its own
  // [Activate: Main] that plays it from the hand is the one way in.
  if (/^be played from any area by (?:card )?skills (?:other than|except) its own$/.test(rest)) {
    return [{ op: "forbid", what: "play", until: "game", target, bySkill: true, exceptOwnSkills: true, ...withUnless }];
  }
  // "…can't be played from any area **using** skills" (DB3-028, BT14-152's
  // "you can't play this card from any area using skills") is "by skills".
  if (/^be played from any area using (?:card )?skills$/.test(rest)) return [{ op: "forbid", what: "play", until: "game", target, bySkill: true, ...withUnless }];
  // "This card can't be played from any area with skills other than [Revive
  // Blue/Green]": the same rule as the player's sentence above.
  {
    const butKeyword = /^be played from any area\s/.test(rest) ? keywordException(rest.replace(/^be played from any area\s+/, "")) : null;
    if (butKeyword) return [{ op: "forbid", what: "play", until: "game", target, bySkill: true, exceptKeyword: butKeyword, ...withUnless }];
  }
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
  if (/^attack\b/.test(rest)) {
    // The object is the defender (BT1-057), not a blanket prohibition.
    if (/^attack(?:$| (?:for|during|until)\b)/.test(rest)) return [{ op: "forbid", what: "attack", until, target, ...withUnless }];
    const object = /^attack (.+?)(?= (?:for|during|until)\b|$)/.exec(rest)?.[1];
    // "Your opponent's skill-less cards can't attack **this card**" (BT15-122),
    // "your opponent's Leader Card cannot attack this card" (TB1-026): those
    // attackers, and only an attack on this card (`against`).
    if (object === "this card") return [{ op: "forbid", what: "attack", until, target, against: { sel: { special: "self" } }, ...withUnless }];
    if (!object) return null;
    // "Your opponent's Battle Cards and Unisons can't attack **your yellow
    // Z-Unisons**" (BT24-101): a described defender of this player's, read
    // only when the description is read whole and names a kind of card.
    if (!/^(?:(?:your(?: opponent'?s)?|their|an?|the) )?(?:battle cards?|leaders?(?: cards?)?|unisons?(?: cards?)?)\b/.test(object)) {
      const described = /^your\b/.test(object) && /^your opponent'?s\b/.test(subject) ? attackObjects(object) : null;
      if (!described?.defender || described.attacker) return null;
      return [{ op: "forbid", what: "attack", until, target, attackTarget: described.defender, ...withUnless }];
    }
    // "…can't attack Leader Cards **or Unison Cards**" is two kinds, which
    // `filterFor` alone reads as the first and a bare "cards" as none (#1005).
    const objects = attackObjects(object);
    if (!objects?.defender || objects.attacker) return null;
    return [{ op: "forbid", what: "attack", until, target, attackTarget: objects.defender, ...withUnless }];
  }
  // "It can't activate skills" (BT29-041): the card's own [Activate] and
  // [Auto] skills, both of which are *activated* (9-6-3-2 — an [Auto] that
  // cannot be activated is cancelled), so `activateSkill` stops both.
  // Owner ruling 26 Oct 2026 (A2): its [Blocker] is a skill it activates
  // (22-4), so a card that can't activate skills does not block.
  if (/^activate (?:its |their )?skills\b/.test(rest)) return [{ op: "forbid", what: "activateSkill", until, target, ...withUnless }, { op: "forbid", what: "block", until, target, ...withUnless }];
  // "Those cards can't activate [Blocker] skills for the turn" (EB1-36), "it
  // can't attack or activate the [Blocker] skill" (BT25-100): its [Blocker] is
  // how a card blocks (22-4), so this is a card that can't block.
  // Only with a duration after it: "…during this card's attack" (BT1-031) is a
  // moment, said about the opponent's [Blocker], and stays unread.
  if (/^activate (?:the |its |their )?\[blocker\](?: skills?)?(?:$|\s+(?:for the|until|during (?:this|the) turn)\b)/.test(rest)) return [{ op: "forbid", what: "block", until, target, ...withUnless }];
  // 5-7: "This card can't be used in a combo from the Battle Area" (EB1-21),
  // "…in combos from Battle Areas" (P-277), "this card can't be used in a combo
  // this turn" (BT15-129); "be placed in your opponent's Combo Area" (BT9-087)
  // and "…in a Combo Area from your opponent's Battle Area" (SD10-04) are the
  // same move said from where the card lands. Anything after the area is not read.
  {
    const comboSaid = /^(?:be used in (?:a )?combos?|be placed in (?:your opponent'?s |your |their |its owner'?s |a )?combo areas?)(.*)$/.exec(rest);
    if (comboSaid) {
      const after = comboSaid[1].replace(DURATION_AFTER_OBJECT, "").replace(/\s+this turn$/, "").trim();
      const fromArea = fromAreaWords(after);
      if (after && !(fromArea && /^from (?:the |a |your |their |your opponent'?s |its owner'?s )?(?:battle areas?|hands?)$/.test(after))) return null;
      return [{ op: "forbid", what: "combo", until, target, ...(fromArea ? { fromArea } : {}), ...withUnless }];
    }
  }
  // "This card can't be switched to Rest Mode by your opponent's skills"
  // (DB2-138, P-680, BT8-040): a skill's switch only, whose side `bySide` says.
  // A bare "can't be switched to Rest Mode" would also stop the rest an attack
  // makes (8-1-2), which is a different rule, and stays unread.
  if (/^be switched to rest mode\b/.test(rest)) {
    if (!/^be switched to rest mode by (?:your |an )?(?:opponent'?s? )?(?:card'?s? )?skills?(?:$|\s+(?:for|during|until)\b)/.test(rest)) return null;
    return [{ op: "forbid", what: "beRestedBySkill", until, target, side: bySide, ...withUnless }];
  }
  // "This card can't [Evolve] into other cards" (BT8-009, DB2-131, EX25-37):
  // it is no base for an evolution of any kind (22-5) — the card itself
  // still evolves onto others, and a [Union-Potara] onto it is not this rule's.
  if (c.permanent && /^\[evolve\] into other cards$/.test(rest)) return [{ op: "forbid", what: "evolveOnto", until: "game", target, ...withUnless }];
  // "Cards in your hand can't be discarded by your green <Broly> Leader Card
  // skills" (P-270): a skill's move from the hand to the Drop Area (a discard,
  // 20-7), by a skill of a card the description fits (`byFilter`).
  {
    const discarded = /^be discarded by (your (?:own )?|your opponent'?s |an opponent'?s )(?:(.+?) )?(?:card )?skills?(?:\s+(?:for|during|until)\b.*)?$/.exec(rest);
    if (discarded && "sel" in target && target.sel.area === "hand") {
      const said = discarded[2] ? (/\bcards?$/.test(discarded[2]) ? discarded[2] : `${discarded[2]} card`) : "";
      const byFilter = said ? filterFor(said, null) : undefined;
      if (byFilter === null || (byFilter && unreadFilterWords(said, byFilter).length)) return null;
      const actor: Side = /^your (?:own )?$/.test(discarded[1]) ? "you" : "opponent";
      const scope = { side: actor, fromArea: "hand" as const, toArea: "drop" as const, ...(byFilter ? { byFilter } : {}) };
      if (!c.permanent) {
        const whole = /^cards in (your|your opponent'?s) hand$/.exec(subject);
        if (!whole || "var" in target || target.sel.filter) return null;
        return [{ op: "forbid", what: "beMovedBySkill", until, cardsOf: whole[1] === "your" ? "you" : "opponent", ...scope, ...withUnless }];
      }
      return [{ op: "forbid", what: "beMovedBySkill", until, target, ...scope, ...withUnless }];
    }
  }
  if (/^be attacked\b/.test(rest)) return [{ op: "forbid", what: "beAttacked", until, target, ...withUnless }];
  if (/^block\b/.test(rest)) return [{ op: "forbid", what: "block", until, target, ...withUnless }];
  if (/^(?:switch|be switched)\b.*\bactive mode\b/.test(rest)) {
    // "…during your opponent's next Charge Phase" (BT3-085, BT3-101, XD1-01,
    // #539): the Charge Phase's switch alone, not a skill's later that turn.
    const inCharge = /\bduring (?:your opponent'?s|their) next charge phase\b/.test(t);
    return [{ op: "forbid", what: inCharge ? "switchToActiveInCharge" : "switchToActive", until, target, ...withUnless }];
  }
  // "It can't be KO'd by your opponent's attacks for the battle" (BT13-118):
  // the KO a battle makes when one of the opponent's cards attacked it, not
  // one by a skill.
  if (/^be ko'?d by your opponent'?s attacks?(?:$|\s+(?:for|during|until)\b)/.test(rest)) return [{ op: "forbid", what: "beKOdInBattle", until, target, side: "opponent", ...withUnless }];
  // "This card can't be KO'd in battle against Battle Cards with energy costs
  // of 3 or less" (P-481), "…in battle by Battle Cards with an original power
  // of 15000 or less" (BT8-060): the battle's KO (8-4-6-2), when the card it
  // fights is one of those (`byFilter`, asked of the attacking card). A
  // description the filter cannot say whole stays unread.
  {
    const vs = /^be ko'?d in battle (?:against|by) (.+?)(?:\s+(?:for|during|until)\b.*)?$/.exec(rest);
    if (vs) {
      const who = vs[1].trim();
      const filter = filterFor(who, null);
      if (!filter || unreadFilterWords(who, filter).length) return null;
      const type = /\bbattle cards?\b/.test(who) ? { type: "BATTLE" as const } : {};
      return [{ op: "forbid", what: "beKOdInBattle", until, target, byFilter: { ...filter, ...type }, ...withUnless }];
    }
  }
  // "…it can't be KO'd **by your opponent**" (EX04-04, prohibition batch 6):
  // by the opponent's skills, and in any battle — the battle's KO is the
  // opponent's card's doing whichever card attacked (8-4-6-2). A skill of the
  // card's own controller still KOs it.
  if (/^be ko'?d by (?:your |an |the )?opponent(?:\s+(?:for|during|until)\b.*)?$/.test(rest)) {
    return [
      { op: "forbid", what: "beKOdInBattle", until, target, ...withUnless },
      { op: "forbid", what: "beKOdBySkill", until, target, side: "opponent", ...withUnless },
    ];
  }
  if (/^be ko'?d\b/.test(rest)) {
    // #907 round 4 (P-481, BT8-060): "can't be KO'd in battle **against Battle Cards with energy costs of 3 or
    // less**" / "…**by Battle Cards with an original power of 15000 or less**" names whose KO is stopped. The
    // bare rule below is stronger than that (every KO), so a qualifier that is not "by skills" is refused.
    if (/\b(?:against|by) (?!(?:your opponent'?s |your (?:own )?)?(?:card'?s )?skills?\b)/.test(rest)) return null;
    // "by skills" is the narrow rule; a bare "can't be KO'd" covers the battle too.
    const bySkill = /\bby (?:your opponent's |your (?:own )?)?(?:card'?s )?skills?\b/.test(rest);
    return [{ op: "forbid", what: bySkill ? "beKOdBySkill" : "beKOd", until, target, side: bySide, ...withUnless }];
  }
  if (/^be chosen\b/.test(rest)) return [{ op: "forbid", what: "beChosen", until, target, side: bySide, ...withUnless }];
  // "Can't be removed from a Battle Area by your opponent's skills" (20-14) —
  // a departure a skill causes, and not one a battle causes. Only the form
  // that names skills as the cause is read: a bare "can't be removed from a
  // Battle Area" would also cover the battle's KO.
  // Owner ruling, 26 Oct 2026: a KO by a skill **is** a removal (it places the
  // card from the Battle Area in the Drop), so every such wording is two
  // rules with the same scope — a skill's move (`beMovedBySkill`) and a
  // skill's KO (`beKOdBySkill`).
  const removedBySkill = (extra: Partial<Extract<Op, { op: "forbid" }>>): Op[] => [
    { op: "forbid", what: "beMovedBySkill", until, target, ...extra, ...withUnless },
    { op: "forbid", what: "beKOdBySkill", until, target, ...extra, ...withUnless },
  ];
  if (/^be removed from (?:a|the|your|their) battle area\b/.test(rest) && /\bby (?:your opponent's |your )?skills?\b/.test(rest)) {
    return removedBySkill({ side: bySide });
  }
  // The same rule said other ways: "…from Battle Areas by skills" (BT10-065),
  // "…by your opponent's card skills" (BT8-040), "…by an opponent's skill"
  // (BT30-030), "…by the skills of your opponent's Battle Cards" (BT10-058, a
  // skill of a Battle Card only — `byTypes`). An exception ("other than",
  // "except") stays unread.
  {
    const removed = /^be removed from (?:(?:a|the|your|their) battle areas?|battle areas) by (skills|your opponent'?s (?:card )?skills|an opponent'?s skill|the skills of your opponent'?s battle cards)(?:$|\s+(?:for|during|until)\b)/.exec(rest);
    if (removed) return removedBySkill({ ...(bySide ? { side: bySide } : {}), ...(/battle cards$/.test(removed[1]) ? { byTypes: ["BATTLE" as const] } : {}) });
  }
  // "This card can't be removed from under your Leader by a skill other than
  // this card's skills" (BT21-012), "…can't be removed from the Leader Area by
  // a skill other than this card's skills" while it is under a Leader
  // (BT21-052; prohibition batch 6): a skill's move of it out from under its
  // host (`fromArea: under`), unless the skill is this card's own.
  if (/^be removed from (?:under (?:your|a|the|its) leader(?: card)?|the leader area) by (?:a |any )?(?:card )?skills? other than this card'?s skills$/.test(rest)) {
    return [{ op: "forbid", what: "beMovedBySkill", until, target, fromArea: "under", exceptOwnSkills: true, ...withUnless }];
  }
  // "This card can't be removed from Battle Areas by skills other than
  // {Jaguar's Island}'s skills" (BT22-072): the same two rules, with the one
  // card whose skills may (`exceptSourceName`).
  {
    const but = /^be removed from (?:(?:a|the|your|their) battle areas?|battle areas) by skills other than (\{[^}]+\})'s skills$/.exec(rest);
    if (but) return removedBySkill({ exceptSourceName: but[1].slice(1, -1).trim() });
  }
  // "This card can't attack or be removed from Battle Areas" (BT19-153), no
  // cause named: no skill moves it out and nothing KOs it — a skill's KO or
  // the battle's (`beKOd`, 5-12-1: a KO is a removal to the Drop Area).
  if (/^be removed from (?:(?:a|the|your|their) battle areas?|battle areas)(?:\s+(?:for|during|until)\b.*)?$/.test(rest)) {
    return [
      { op: "forbid", what: "beMovedBySkill", until, target, ...withUnless },
      { op: "forbid", what: "beKOd", until, target, ...withUnless },
    ];
  }
  // Where a skill would put the card (`toArea`): "…can't be returned to your
  // hand by your skills" (DB2-040), "…placed at the bottom of their owner's
  // deck by your opponent's skills" (P-672), "cards in your Battle Area can't
  // be placed in their owners' Drop Areas by your skills" (EX06-18, BT3-078,
  // BT12-082). A KO is a move from the Battle Area to the Drop Area (5-12-1),
  // so the Drop Area's rule stops a skill's KO as well, as "removed" does.
  // "Cards in your hand can't be returned to your deck by your opponent's
  // skills" (DB2-156) is about cards in the hand (`fromArea`).
  {
    const sent = /^be (returned|placed|sent) (?:in|into|to|at) (?:the bottom of )?(?:your|their|its|the|their owners?'?s?|its owner'?s) (hand|deck|drop(?: area)?s?|warp) by (your (?:own )?skills?|your opponent'?s skills?|skills?)(?:\s+(?:for|during|until)\b.*)?$/.exec(rest);
    if (sent) {
      const toArea: "hand" | "deck" | "warp" | "drop" = sent[2] === "hand" ? "hand" : sent[2] === "deck" ? "deck" : sent[2] === "warp" ? "warp" : "drop";
      // "Returned to your hand" is the only return; any other verb has to name its place.
      if (sent[1] === "returned" && toArea !== "hand" && toArea !== "deck") return null;
      const toBottom = /\bthe bottom of\b/.test(rest);
      if (toBottom && toArea !== "deck") return null;
      const inHand = "sel" in target && target.sel.area === "hand";
      // A timed rule binds the cards it names as it resolves, and "cards in
      // your hand … for the turn" (DB2-156) means the hand all turn long
      // (owner ruling 26 Oct 2026): a rule about no card in particular, about
      // every card in that player's hand (`cardsOf`, `fromArea: hand`) — one
      // drawn later included. Only the bare "cards in your hand" is said so.
      if (inHand && !c.permanent) {
        const whole = /^cards in (your|your opponent'?s) hand$/.exec(subject);
        if (!whole || "var" in target || target.sel.filter) return null;
        const cardsOf: Side = whole[1] === "your" ? "you" : "opponent";
        const actor: Side = bySide === "you" ? "you" : bySide === "opponent" ? "opponent" : "both";
        return [{ op: "forbid", what: "beMovedBySkill", until, side: actor, cardsOf, fromArea: "hand", toArea, ...(toBottom ? { toBottom: true as const } : {}), ...withUnless }];
      }
      const scope = { ...(bySide ? { side: bySide } : {}), toArea, ...(toBottom ? { toBottom: true as const } : {}), ...(inHand ? { fromArea: "hand" as const } : {}) };
      const move: Op = { op: "forbid", what: "beMovedBySkill", until, target, ...scope, ...withUnless };
      if (inHand || toArea !== "drop") return [move];
      return [move, { op: "forbid", what: "beKOdBySkill", until, target, ...(bySide ? { side: bySide } : {}), ...withUnless }];
    }
  }
  // "This card's skills can't be negated in any area" (9-1-5). `durationOf`
  // already reads "in any area" as the game.
  if (/^be negated\b/.test(rest) && /\bskills?\b/.test(subject)) {
    const owner = refFor(subject.replace(/'?s skills?\b.*$/, ""), c);
    return owner ? [{ op: "forbid", what: "beNegated", until, target: owner, ...withUnless }] : null;
  }
  return null;
}

/**
 * 20-14-1's prices said **around** the action they tax, put back in the shape
 * `compileProhibition` reads — "<player> can't <act> unless <price>" — before
 * the sentence is cut into clauses:
 *
 * - "when your opponent's Battle Card is played, your opponent can't play it
 *   unless they send 3 cards from their Drop to their owner's Warp" (BT31-093,
 *   and BT31-150's "…card is played, they can't play it unless …"): the
 *   "when" is not a trigger but the act the price is charged on — "your
 *   opponent can't play Battle Card unless they …".
 * - "for the duration of the game, if the turn player would use the skill of a
 *   Battle Card or Extra Card to switch energy to Active Mode, they can't
 *   switch energy to Active Mode unless they choose 5 cards from their Drop
 *   Area and send them to their Warp" (BT8-051): "the turn player can't switch
 *   energy to active mode with the skills of Battle Card or Extra Card for the
 *   duration of the game unless they send 5 cards from their drop area to
 *   their warp" — the choice is the sending's own, and said as one verb the
 *   price is not cut in two at its "and".
 *
 * Anything else comes back as it went.
 */
export function taxWordings(text: string): string {
  return playTaxWording(text)
    .replace(
      /\b(?:then )?(for the duration of the game|during the game), if the turn player would use the skills? of (?:an? )?(.+?) to switch energy to active mode, they can(?:'|no)t switch energy to active mode unless they choose (\d+) cards? from their drop(?: area)? and send them to their warp\b/gi,
      (_m, lasts: string, whose: string, n: string) => `the turn player can't switch energy to active mode with the skills of ${whose} ${lasts} unless they send ${n} cards from their drop area to their warp`,
    )
    // #677, EX06-35: "your opponent can't activate skills unless they choose 1
    // card in their hand and send it to their Warp" — the choice is the
    // sending's own, said as one verb so the price is not cut at its "and".
    // #936, BT1-043 / TB1-097: "this card's attack and skill cannot be negated"
    // is two rules (the attack's and 9-1-5's), said as two so the sentence is
    // not cut at its "and" into a subject-less half.
    .replace(
      /\b((?:this card|that card|it)'s|its) attacks? and skills? (can(?:'|no)t) be negated\b/gi,
      (_m, who: string, can: string) => `${who} attack ${can} be negated, ${who} skills ${can} be negated`,
    )
    .replace(
      /\b(can(?:'|no)t activate [^.]*?) unless they choose (\d+) (cards?) in their hand and send (?:it|them) to their warp\b/gi,
      (_m, head: string, n: string, cards: string) => `${head} unless they send ${n} ${cards} from their hand to their warp`,
    )
    .replace(CHOSEN_PRICE, chosenPrice)
    // Prohibition batch 5: a [Permanent] ban whose escape is printed in front
    // of it as a condition — "Unless {Display of Power Son Gohan} is in play in
    // your Battle Area, you can't place this card in your Combo Area from any
    // area" (BT6-081), "If <Pan> is not under this card, it cannot attack"
    // (BT3-016), "If you don't have <Son Gohan: Adolescence>, <Son Goten> and
    // <Trunks: Youth> in your Drop Area, you can't play this card from any
    // area" (P-021). Each is the ban with that escape (20-14): said the way
    // `compileProhibition` reads an escape, after the ban, so the sentence is
    // not cut at its comma into a condition and a ban that would hold always.
    .replace(/(^|\]\s*|[.:]\s+)unless ([^,.]+?), (you can(?:'|no)t (?:place this card in your combo area|play this card) from any area)(?=\.|$)/gi, (_m, lead: string, escape: string, ban: string) => `${lead}${ban} unless ${escape}`)
    .replace(/(^|\]\s*|[.:]\s+)if (<[^>]+>|\{[^}]+\}) is not under this card, (?:it|this card) (can(?:'|no)t) attack(?=\.|$)/gi, (_m, lead: string, named: string, cant: string) => `${lead}this card ${cant} attack unless ${named} is under this card`)
    .replace(/(^|\]\s*|[.:]\s+)if you (?:don'?t|do not) have ((?:<[^>]+>,\s*)+<[^>]+>,? and <[^>]+>) in your (drop area|battle area|hand|warp), (you can(?:'|no)t play this card from any area)(?=\.|$)/gi, (_m, lead: string, names: string, area: string, ban: string) => `${lead}${ban} unless you have ${names} in your ${area}`)
    // Prohibition batch 6: "…your opponent's [counter] skills and non-keyword
    // [auto]/[activate] skills cannot be activated unless they place 1 card
    // from their life in their Drop Area" (TB1-077): two activation prices,
    // each said the way `compileProhibition` reads one.
    .replace(/\byour opponent'?s \[counter\] skills and non-keyword \[auto\]\/\[activate\] skills can(?:'|no)t be activated (unless they [^,.]+)/gi, (_m, price: string) => `your opponent can't activate [counter] skills ${price}, and your opponent can't activate non-keyword [auto]/[activate] skills ${price}`)
    // Prohibition batch 6: "…and until the start of your next Main Phase, as
    // long as the chosen card is in Rest Mode, your opponent's cards can't
    // attack Leader Cards" (BT8-044's back): the player's attacks, every card
    // of theirs (one played later too), with the span and the escape after
    // the ban, so the sentence is not cut at its commas.
    .replace(/(,\s*(?:and\s+)?)until the start of your next main phase, as long as (the chosen card) is in (rest|active) mode, your opponent'?s cards can(?:'|no)t attack leader cards(?=\.|$)/gi, (_m, lead: string, chosen: string, mode: string) => `${lead}your opponent can't attack leader cards until the start of your next main phase as long as ${chosen} is in ${mode} mode`)
    // Prohibition batch 6: "…you can't activate non-keyword Leader Card skills
    // or skills on copies of this card for the turn" (EB1-07): two bans, each
    // said as `compileProhibition` reads one.
    .replace(/\byou can(?:'|no)t activate non-keyword leader card skills or skills on copies of this card((?:\s+(?:for|during|until)\b[^,.;]*)?)/gi, (_m, span: string) => `you can't activate non-keyword leader card skills${span}, and you can't activate skills on copies of this card${span}`)
    // Prohibition batch 6: "If <Gotenks> is under this card, and if there are
    // no cards in your opponent's Combo Area, this card cannot be KO'd"
    // (BT2-026): two conditions on one ban, said as one condition with "and".
    .replace(/(^|\]\s*|[.:]\s+)if (<[^>]+>|\{[^}]+\}) is under this card, and if /gi, (_m, lead: string, named: string) => `${lead}if there is a ${named} under this card and `)
    // Prohibition batch 6: "…for the turn, if your opponent's <Evil Saiyan> or
    // <Cumber> card—both black and with an energy cost of 8—is attacking and
    // in a battle, you can't activate [Counter] skills" (BT20-125): a ban for
    // the turn that holds only while such a card is the attacking card (8-1),
    // said with its condition after it so the sentence is not cut at its comma
    // into a condition and a ban that would hold always.
    .replace(/(,\s*|^|\]\s*|[.:]\s+)(?:for the turn, )?if (your opponent'?s [^,.]+?)\s*is attacking(?: for the turn)? and in a battle, (you can(?:'|no)t activate \[counter\] skills)(?=\.|$)/gi, (_m, lead: string, who: string, ban: string) => `${lead}${ban} for the turn while ${who} is attacking`)
    // Prohibition batch 6: "Unless there are 1 or more cards of both <Android
    // 17> and <Android 18>―both green and with an energy cost of 2―under this
    // card, you can't activate [Z-Awaken]" (BT21-068's back): the same, the
    // escape after the ban, and each name's card said whole so the sentence
    // is not cut at the "and" between the names.
    .replace(/(^|\]\s*|[.:]\s+)unless there (?:are|is) (?:1 or more|a) cards? of both (<[^>]+>) and (<[^>]+>)\s*[―—–]\s*both (red|blue|green|yellow|black) and (with an? [^―—–]+?)\s*[―—–]\s*under this card, (you can(?:'|no)t activate \[z-awaken\])(?=\.|$)/gi, (_m, lead: string, a: string, b: string, colour: string, rest: string, ban: string) => `${lead}${ban} unless there is a ${colour} ${a} card ${rest} under this card as well as a ${colour} ${b} card ${rest} under this card`);
}

/**
 * "…can't attack with Battle Cards unless **they choose 1 of their Battle Cards
 * with an energy cost of 2 or more and place it in its owner's Drop Area**"
 * (BT10-063, BT11-034, BT19-049, and every card that prints the price this way:
 * BT11-035, BT13-082, BT13-140, BT14-076, BT14-082, BT14-122, BT16-105,
 * BT16-149, BT18-099, BT20-099, P-151, P-442; #1015). The price is one act said
 * as two clauses, "choose X" and "<verb> it", and the sentence was cut at its
 * "and" into a choice nothing is done to (half a price, refused) and a verb with
 * no object. Said as the one verb it is — "place 1 of their Battle Cards with an
 * energy cost of 2 or more in its owner's Drop Area" — the price reads the way
 * BT17-053's printed form always has. The choice stays the payer's: `taxProgram`
 * turns "their" into "your" and the engine runs the price in the payer's chair.
 * "Cards in their hand/life" become "cards from their hand/life", the form the
 * price readers know.
 */
const CHOSEN_PRICE =
  /\bunless (they|your opponent) chooses? (up to )?(\d+) (cards? (?:in|from) their (?:hand|life|life area|drop area|drop|energy|energy area)|of (?:their|your opponent'?s) [^,.]+?) and (place|send|discard|switch|return|put) (?:it|them)\b([^,.]*)/gi;
function chosenPrice(_m: string, who: string, upTo: string | undefined, n: string, what: string, verb: string, tail: string): string {
  const from = what.replace(/^(cards?) in\b/i, "$1 from");
  return `unless ${who} ${verb.toLowerCase()} ${upTo ?? ""}${n} ${from}${tail}`;
}

/** The steps a tax may be made of: the price ops both engines can say in advance whether a player can pay (`canPayPriceProgram`). */
const TAX_OPS = new Set<Op["op"]>(["discard", "mill", "choose", "moveTo", "switchMode", "removeMarker"]);

/**
 * 20-14-1's price: "your opponent sends 2 cards from their hand to their Warp
 * each time" (BT30-100), read as the program the **payer** runs — said again
 * from their chair ("send 2 cards from your hand to your Warp"), because the
 * engine runs it with the acting player as "you". `payer` is who the clause
 * names, so the caller can check it is the player the rule stops.
 *
 * Null for anything that is not "<player> <does something> each time", and
 * for a price made of anything but the steps whose payability is known before
 * they run: a tax the engine cannot promise is either a ban the card does not
 * state or an attack that half-pays.
 */
function taxProgram(said: string, c: Ctx, on: "attack" | "play" | "switch" | "activate" = "attack"): { payer: Side; ops: Op[] } | null {
  // An attack's price says "each time"; a play's and a switch's need not
  // (one act each), but then the sentence's own duration may follow it. An
  // activation is one act too (#677): the printed cards say it without "each
  // time" ("unless they discard 2 cards from their hand", BT29-022), and
  // 20-14-1 charges every activation it governs either way.
  // #1015: an attack's price may leave "each time" out too (BT11-035, P-151,
  // BT11-053, BT24-087). The official card FAQ says of BT11-035 that the
  // opponent "has to choose 1 card from their hand and place it on the bottom
  // of their deck in order to attack" and of P-442 that they cannot declare an
  // attack with no card to pay with; 20-14-1 makes action B the condition of
  // every action A. It is read as paid for every attack — LABELLED BEST GUESS
  // for "every" (no ruling says once or each time for the cards that omit it).
  const m =
    /^(your opponent|they|you)\s+(.+?)\s+each time(?:\s+(?:until|for|during)\b.*)?$/.exec(said) ??
    /^(your opponent|they|you)\s+(.+?)(?:\s+(?:until the end of .+|for the (?:duration of the )?(?:turn|game)|during .+))?$/.exec(said);
  if (!m) return null;
  const payer: Side = m[1] === "you" ? "you" : "opponent";
  let clause = m[2];
  // "…to their owner's Warp" (BT31-093) is the Warp of the cards' owner —
  // "its owner's" — and not "your owner's" once the pronouns turn round.
  clause = clause.replace(/\btheir owner'?s\b/g, "its owner's");
  if (payer === "opponent") {
    // "sends" → "send", "pushes" → "push": the verb back to the imperative.
    clause = clause.replace(/^(\w+?)(?:(?<=(?:ch|sh|ss|x))es|s)\b/, "$1");
    clause = clause.replace(/\btheir\b/g, "your").replace(/\bthey\b/g, "you").replace(/\bthemselves\b/g, "yourself");
  }
  // 20-14-1's own example (BT13-030): "…unless they give the attacking card
  // -5000 power for the turn each time". The price is paid in the frame whose
  // "this card" is the attacker, before the attack is declared — so "the
  // attacking card" is that card, and the price is a power change to it, the
  // only power change a price may make (`taxPowerOnSelf`).
  if (on === "attack") clause = clause.replace(/^give (?:the attacking card|it) ([+-]\d+ power\b.*)$/, "this card gets $1");
  // "…unless they place 1 card each from their hand and Z-Energy in their
  // owners' Drops each time" (BT20-145, prohibition batch 6): one card from
  // each of the two areas, each to its owner's Drop Area — two choices and two
  // moves, the hand's first as printed.
  const eachFrom = /^place (\d+) cards? each from your (hand|z-energy|energy|life) and (hand|z-energy|energy|life) in (?:your|its) owners?'?s?'? drop(?: area)?s?$/.exec(clause);
  const AREA_OF: Record<string, ScriptArea> = { hand: "hand", "z-energy": "zEnergy", energy: "energy", life: "life" };
  const read = eachFrom
    ? [eachFrom[2], eachFrom[3]].flatMap((area, i): Op[] => [
        { op: "choose", sel: { side: "you", area: AREA_OF[area], count: Number(eachFrom[1]) }, as: `each${i}`, reason: `place ${eachFrom[1]} card from your ${area} in its owner's Drop Area` },
        { op: "moveTo", target: { var: `each${i}` }, to: "drop" },
      ])
    : compileClause(clause, { ...c, choices: [...c.choices] });
  const taxOp = (o: Op) => TAX_OPS.has(o.op) || (on === "attack" && taxPowerOnSelf(o));
  if (!read?.length || read.some((o) => !taxOp(o) || ("side" in o && o.side !== undefined && o.side !== "you"))) return null;
  // A play's price is paid while the card is still in the hand it is played
  // from (5-5-2-1): "send 1 card from your hand" is never the card itself.
  // A `discard` cannot say so, so it is said as the choice and the move it
  // stands for — and the choice below rules the card out.
  const inHand = on === "play" || on === "activate";
  const ops =
    inHand
      ? read.flatMap((o, i): Op[] =>
          o.op === "discard" && typeof o.n === "number"
            ? [
                { op: "choose", sel: { side: "you", area: "hand", count: o.n }, as: `tax${i}`, reason: `send ${o.n} card${o.n === 1 ? "" : "s"} from your hand to your ${o.to ?? "drop"}` },
                { op: "moveTo", target: { var: `tax${i}` }, to: o.to ?? "drop", reveal: true },
              ]
            : [o],
        )
      : read;
  if (inHand && ops.some((o) => o.op === "discard")) return null;
  // A choice nothing is then done to is half a price: "unless they choose 3
  // cards from their hand **and** place them in their Drop Area" (BT6-023) is
  // cut at its "and" before it gets here, and the half left is not the price.
  const named = (as: string) => ops.some((o) => o.op !== "choose" && JSON.stringify(o).includes(`"var":"${as}"`));
  if (ops.some((o) => o.op === "choose" && !named(o.as))) return null;
  // The price runs with the acting card as "this card" (the attacker), and B
  // is done before A is declared (20-14-1): "switch 1 of their Active Mode
  // cards to Rest Mode" (BT24-133) paid with the attacker itself would leave
  // nothing able to attack, so a choice in the price never offers it.
  // #677: an activation's price is not an attack's. The activating card is
  // ruled out of a price taken from the hand — a [Counter] pays it from there
  // and is itself the counter (22-10-7) — but not out of one taken from play:
  // "switch 2 of their Active Mode cards to Rest Mode" (BT23-140) names any
  // of them, and nothing in 20-14-1 or 9-4 keeps the card whose skill it is
  // from being one.
  const ruledOut = (o: Extract<Op, { op: "choose" }>) => on !== "activate" || o.sel.area === "hand";
  // 5-8-2-2: a switch to Rest Mode is paid only by a card it switches, so
  // "switch 1 of their energy to Rest Mode" (BT10-097) offers Active Mode
  // energy alone — the same `mode` BT23-140's "Active Mode cards" says.
  const rested = (o: Extract<Op, { op: "choose" }>) => ops.some((s) => s.op === "switchMode" && s.mode === "rest" && "var" in s.target && s.target.var === o.as);
  const priced = (o: Extract<Op, { op: "choose" }>): Extract<Op, { op: "choose" }> => (on === "activate" && !o.sel.mode && rested(o) ? { ...o, sel: { ...o.sel, mode: "active" } } : o);
  return { payer, ops: ops.map((o) => (o.op === "choose" ? (ruledOut(o) ? { ...priced(o), sel: { ...priced(o).sel, notSelf: "card" as const } } : priced(o)) : o)) };
}

function compileToken(clause: string, c: Ctx): Op[] | null {
  // "…then play **a** Chilled's Army Token with 10000 power" (BT13-062, phrasing batch 2): one token.
  const m = /play (?:up to )?(\d+|an?) (.+?) tokens?/i.exec(clause);
  if (!m) return null;
  if (/^an?$/i.test(m[1])) m[1] = "1";
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
  // "...and **they** gain [Blocker] for the turn" (BT31-141) is about the tokens
  // this play made. Name them only when the sentence goes on to say so, so the
  // token programs that never refer back stay exactly as they were.
  const after = c.raw.slice(Math.max(0, c.raw.indexOf(m[0])) + m[0].length);
  // "play 1 Frieza's Army Token with 10000 power, and it gains…" (BT28-020) and
  // "play 1 Shadow Token, and that card gets…" (BT26-079) say the same thing.
  // "…Chilled's Army Token with 10000 power**;** it gains [Blocker] for the turn" (EB1-22, phrasing batch 2): the
  // semicolon carries the sentence on as the comma does.
  const bound = /^\s*(?:\([^)]*\))?\s*(?:with [\d,]+ power\s*)?(?:in rest mode\s*)?(?:[,.;]|and|then)?\s*(?:and\s+)?(?:they|it|those tokens?|those cards|the tokens?|that (?:card|token))\b/i.test(after)
    // "Play **up to** 2 Cell Jr. Tokens …, and those cards get …" (BT21-088): the token op makes the number it is given,
    // so a sentence that goes on about the tokens of an "up to" play is not read as if all of them were made.
    && !/^play up to /i.test(m[0]);
  // "play 2 Ghost Tokens **with 15000 power**" (BT31-134, BT28-020, EB1-48): the
  // skill prints the token's power itself and that figure, not the 5000 default
  // or a reminder's, is the power the tokens arrive with (#907, left over from #1023).
  const printed = /^\s*with ([\d,]+) power\b/i.exec(after);
  return [
    {
      op: "token",
      ...(bound ? { as: `t${c.n++}` } : {}),
      name: `${m[2].trim()} Token`,
      power: printed ? num(printed[1]) : power ? num(power[1]) : 5000,
      comboCost: combo ? num(combo[1]) : 0,
      comboPower: combo ? num(combo[2]) : 5000,
      colors: [],
      n: Number(m[1]),
      // Phrasing batch 4: "play 1 Ghost Token with 15000 power **in Rest Mode**" (P-683): how the tokens arrive.
      ...(/\btokens?\b(?:\s*\([^)]*\))?(?: with [\d,]+ power)?\s+in rest mode\b/i.test(clause) ? { mode: "rest" as const } : {}),
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
  // Phrasing batch 3: "When this card attacks choose one**---**" (BT9-126b) prints three.
  const m = /choose one\s*(?:[-–—―－ー?:]{1,3})?\s*/i.exec(text);
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
 * "You may choose 5 cards from your Warp and place them in the Drop Area. If
 * you do so, …" (BT3-109, #538): the offer is optional, so the choice is
 * compiled as up to 5 — but what hangs on it is owed only when all 5 were
 * chosen. With fewer, the player did not do it. "Choose **up to** 2 … if you
 * do" is a different sentence: one card is enough there. Read off the choice's
 * own printed words, which is all that tells the two apart once both are
 * `upTo`.
 */
function exactCount(c: Ctx, v: string): { atLeast?: number } {
  const made = [...c.choices].reverse().find((ch) => ch.var === v);
  const n = made?.sel.count ?? 1;
  const said = made?.reason ?? "";
  if (n <= 1 || n >= 99 || /\bup to\b|\bany number\b/i.test(said)) return {};
  return { atLeast: n };
}

/**
 * What an op leaves behind for the clauses after it: which cards "it" means,
 * and which name a later "if that card is …" is asking about.
 */
function track(o: Op, c: Ctx): void {
  if (o.op === "choose") {
    c.last = o.as;
    c.choices.push({ var: o.as, sel: o.sel, reason: o.reason });
    c.lastTarget = { var: o.as };
  } else if (o.op === "token") {
    // The tokens just made are what "they"/"it" mean next (and not "the chosen
    // card": a token play chooses nothing, so `c.last` stays as it was).
    if (o.as) c.lastTarget = { var: o.as };
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
  } else if (o.op === "moveTo" && o.to === "under" && o.under && "sel" in o.target && o.target.sel.special === "self") {
    // Phrasing batch 3: "Place this card under the chosen Battle Card, **and that card** gets +5000 power" (TB3-058,
    // TB3-059): once this card is under another it is out of play, and what the sentence goes on about is the host.
    c.lastTarget = o.under;
  } else if ("target" in o && o.target) c.lastTarget = o.target;
  if (o.op === "moveTo" && o.to === "warp" && "var" in o.target && !o.target.minus) c.sentToWarp = o.target.var;
  if ((o.op === "power" || o.op === "grant") && (o.until === "battle" || o.until === "turn")) c.lastUntil = o.until;
  if (o.op === "ko" && "var" in o.target && !o.target.minus) c.koed = o.target.var;
  if (o.op === "moveTo" && o.to === "drop" && "var" in o.target && !o.target.minus) c.dropped = o.target.var;
}

/**
 * Phrasing batch 1: "if <the card this skill did something to> is/was/has …", asked of the name the step bound.
 * - "…choose up to 1 of your opponent's Battle Cards … and KO it … if **the KO'd card was** a ≪Saiyan≫ or
 *   ≪Earthling≫ card" (BT25-097): the card the KO just before took, and only once it is in the Drop — a card the KO
 *   did not reach was not KO'd.
 * - "…switch it to Rest Mode; if **the card you switched to Rest Mode has** an energy cost of 2 or less, KO it"
 *   (BT12-113): the card the switch just before named.
 * - "Choose 1 card in your life and place it in the Drop Area: if **the card you placed in the Drop Area with this
 *   skill was** blue" (BT2-034): the price's card, which the price put in the Drop (`priceDiscarded`).
 * - "…choose that card, and it gains +5000 power … Then, if **its power is** 20000 or more" (BT3-001): the card
 *   the sentence has been talking about, measured now.
 * - "if **the chosen card's character name includes** <Turles>" (BT12-083): the last choice.
 * A description the filter cannot read, or a negated one it does not carry, is no condition (null), as for "that
 * card" below.
 */
function backReferenceCondition(clause: string, c: Ctx): Cond | null {
  const t = clause.trim().replace(/[.,;]$/, "").toLowerCase();
  const lastVar = c.lastTarget && "var" in c.lastTarget && !c.lastTarget.minus ? c.lastTarget.var : null;
  const described = (said: string): CardFilter | null => {
    const filter = filterFor(said, null);
    if (!filter || filter.unreadable) return null;
    if (/\b(?:not|non|other than|except|besides)\b/.test(said)) return null;
    return filter;
  };
  let m: RegExpExecArray | null;
  if ((m = /^if the ko'?d card (?:is|was) (?:an? )?(.+)$/.exec(t)) && c.koed) {
    const filter = described(m[1]);
    return filter ? { kind: "count", sel: { fromVar: c.koed, area: "drop", filter }, atLeast: 1 } : null;
  }
  if ((m = /^if the card you switched to (rest|active) mode (has|is|was) (?:an? )?(.+)$/.exec(t)) && lastVar && c.lastOp === "switchMode") {
    const filter = described(m[2] === "has" ? `card with ${m[3]}` : m[3]);
    return filter ? { kind: "varMatches", var: lastVar, filter } : null;
  }
  if ((m = /^if the card you placed in (?:the|your) drop(?: area)? (?:with|using|by) this skill (?:is|was) (?:an? )?(.+)$/.exec(t)) && c.priceChoice && c.priceDiscarded) {
    const filter = described(m[1]);
    return filter ? { kind: "count", sel: { fromVar: c.priceChoice, area: "drop", filter }, atLeast: 1 } : null;
  }
  // Phrasing batch 2: "…place up to 2 cards with [Dragon Ball] from your deck in your Drop Area, then shuffle your deck.
  // **If you placed a card in your Drop Area using this skill**, draw 1 card" (EX19-11), "If you placed a [Dragon
  // Ball] card in your Drop Area, …" (BT5-106): the cards this skill's own move took to the Drop, and only those
  // still there — a card the move did not reach was not placed.
  if ((m = /^if you placed (?:a|an|1 or more|any) (.*?)cards? in (?:your|a|the) drop(?: area)?(?: (?:using|with|by) this skill)?$/.exec(t)) && c.dropped) {
    const said = m[1].trim();
    const filter = said ? described(`${said} card`) : null;
    if (said && !filter) return null;
    return { kind: "count", sel: { fromVar: c.dropped, area: "drop", ...(filter ? { filter } : {}) }, atLeast: 1 };
  }
  if ((m = /^if its power is (\d+) or (more|less)$/.exec(t)) && lastVar) {
    return { kind: "power", sel: { fromVar: lastVar, area: "play" }, ...(m[2] === "more" ? { atLeast: Number(m[1]) } : { atMost: Number(m[1]) }) };
  }
  if ((m = /^if the chosen card'?s character name includes ((?:<[^>]+>))$/.exec(t)) && c.last) {
    const filter = described(`card with ${m[1]} in its character name`);
    return filter ? { kind: "varMatches", var: c.last, filter } : null;
  }
  return null;
}

/**
 * Owner's ruling of 26 Oct 2026 (phrasing batch 2, BT9-037, BT10-081): "place
 * them on the top and/or bottom of your deck in any order" with several cards
 * sends EACH card to the top or the bottom as the player chooses, in the order
 * the player chooses. Read as one choice of the pile's cards — any number, none
 * included — that go on top, and the rest to the bottom; the order within each
 * end is the player's, as for any pile moved at once (the engine keeps none).
 * `pool` is the variable the look bound; a choice from it takes its picks out
 * of it, so the bottom is what the top choice left.
 */
function topOrBottomEach(pool: string, c: Ctx): Op[] {
  const v = `c${c.n++}`;
  return [
    { op: "choose", sel: { fromVar: pool, count: 99, upTo: true }, as: v, reason: "Choose the cards to put on the top of the deck (the rest go to the bottom)" },
    { op: "moveTo", target: { var: v }, to: "deck", position: "top" },
    { op: "moveTo", target: { var: pool, minus: v }, to: "deck", position: "bottom" },
  ];
}

/** A clause that is nothing but a duration, split off from the effect it belongs to. */
const PURE_DURATION =
  /^(?:during (?:this|that|the) turn|for the (?:duration of the )?(?:turn|battle)|for the duration of your opponent's next turn|for the rest of the turn|until the end of (?:your|your opponent's|the)(?: next)? turn|until the (?:start|beginning) of your (?:next )?turn|until the (?:start|beginning) of your opponent's next turn)[.,]?$/i;

/**
 * A clause that is nothing but "for each marker on this card", split off from
 * the effect it multiplies (BT27-003/004/005/006, EX19-21). Scoped to "this
 * card" alone, not to a marker phrase in general: the catalog's other three
 * "for each marker on …" cards (BT15-095, BT24-139, BT28-054) reduce a cost
 * rather than a power, which `compileForEach` does not swap an amount into
 * today, so merging their clause the same way would only change which text
 * shows up unread, not whether it reads — left split, as before.
 */
const PURE_FOREACH_MARKERS_ON_SELF = /^for (?:each|every) (?:\d+ )?markers? on this card[.,]?$/i;
/** A token count leads the four BT23 hand reducers; never leave a flat discount behind. */
const PURE_FOREACH_OWN_TOKENS = /^for each of your\b[^,]*\btokens?\b[^,]*[.,]?$/i;
/** "For each card color in your Battle Area and Energy Area, this card gets +2000 power" (EX19-20, P-373, P-321): a color count leads the effect, comma-joined. */
const PURE_FOREACH_COLORS = /^for (?:each|every) (?:card )?colou?rs?(?: types?)?\s+(?:among|on|in)\s+[^,]+[.,]?$/i;
const LEADING_COLOR_COUNT = /^for (?:each|every) (?:card )?colou?rs?(?: types?)?\s+(?:among|on|in)\s+[^,]+,/i;
/**
 * "…the next time you activate an [Activate] skill of your Leader during this
 * turn, reduce its skill cost by {b}" (BT31-096, BT31-092), "…the next time
 * you activate the [Activate: Main/Battle] skill on {Support Broadcast} in
 * your Battle Area during this turn, reduce the skill cost by {1}" (BT30-106).
 * `splitClauses` cuts it at its comma into these two halves, neither a
 * sentence alone; `nextActivationReduction` reads the pair.
 */
const NEXT_ACTIVATION = /^(?:and |then )?(?:during (?:this|that) turn,? )?(?:the next time|if) (?:you|your) (?:would )?(activate|play|place|use|pay the energy cost to place) (.+?)(?: (?:during )?(?:this|that|the) (turn|battle)| until the end of (your|the) turn)?[.,]?$/i;
const REDUCE_THAT_SKILL_COST = /^(?:then |and )?reduce (?:its|the|that card's|that skill's|the skill's|their|this card's) (?:(skill|energy|specified|activation) )?costs?(?: of (?:it|that (?:\[[^\]]+\] )?skill|that card|the extra card))? by ((?:\{[rugykbw\d]+\})+|\d+)(?: for the turn)?[.]?$/i;
/** A sentence that is a cost reducer ending in its amount - what a leading "for each ..." count is hung on. */
/**
 * A count a cost reducer can hang on as it stands: one description in one place. Not "among" colours,
 * not the cost of other cards, not two places ("Battle Area and/or Drop"), not markers or tokens - those
 * are read wrongly as a plain count of cards, so they stay unread. (Phrasing batch 4: a count of cards of your own
 * Z-Energy, Drop or Battle Area across two of them is folded to the trailing form before the clauses are cut —
 * `splitClausesJoined` — and the reducer counts both areas there.)
 */
const SIMPLE_COUNT = /^(?!.*\b(?:among|colou?rs?|costs?|markers?|tokens?|and|or)\b).+$/i;
/** `SIMPLE_COUNT`, and not "in play" with no side named: "Battle Card in play" is both players' cards, which the target reader reads as yours. */
const simpleCount = (counted: string): boolean => SIMPLE_COUNT.test(counted) && !(/\bin play\b/i.test(counted) && !/\b(?:your|their|opponent's)\b/i.test(counted));
// (Not the Z-Energy cost: P-464 prints a cap, "(Up to 2)", that the note-stripper has already dropped by now.)
const COST_REDUCER = /^(?!.*z-energy)(?:reduce|decrease) .*\bcosts?\b.* by (?:\d+|(?:\{[rugykbw\d]+\})+)[.]?$/i;
/** "When you would play a Unison with [Empower] from your hand, reduce the specified cost by {y}" (P-733): every such play this turn. */
const WHEN_WOULD_PLAY = /^when you would play (.+?)(?: during this turn)?$/i;
/** [Permanent] "When you activate X, reduce its skill cost by N" (BT27-069): the standing form of the pair above. */
const WHEN_ACTIVATE = /^when (?:you )?(?:activate|activating) (.+)$/i;

/** What a bracketed tag in a cost sentence names: a kind of line, the [Evolve] family, or one keyword skill. */
export interface SkillTag {
  skillKind?: SkillKindPrefix;
  evolve?: true;
  tag?: string;
}
/** The keyword skills a cost change may be about, spelled as the card prints them. */
const KEYWORD_NAMES: Record<string, KeywordSkill["name"]> = { arrival: "Arrival", swap: "Swap", union: "Union", successor: "Successor", "z-awaken": "Z-Awaken", field: "Field", revive: "Revive", aegis: "Aegis", alliance: "Alliance", overlord: "Overlord", rejuvenate: "Rejuvenate" };
const KEYWORD_TAGS = new Set(["arrival", "swap", "union", "successor", "z-awaken", "field", "revive", "aegis", "alliance", "overlord", "rejuvenate"]);
export function skillTagOf(raw: string): SkillTag | null {
  const word = raw.trim().toLowerCase().split(/[:\s/]/)[0];
  if (word === "activate" || word === "counter" || word === "auto" || word === "permanent") return { skillKind: word };
  // 22-5-2-2: "[Evolve] skills" are [Evolve], [EX-Evolve] and [Xeno-Evolve] alike.
  if (word === "evolve") return { evolve: true };
  if (word === "ex-evolve" || word === "xeno-evolve") return { evolve: true, tag: word };
  if (word.startsWith("union")) return { tag: "union" };
  if (/^(?:dark )?over realm\b/i.test(raw.trim())) return { tag: /^dark/i.test(raw.trim()) ? "dark over realm" : "over realm" };
  return KEYWORD_TAGS.has(word) ? { tag: word } : null;
}

export interface SkillScope extends SkillTag {
  target: Ref;
}
/**
 * "[Z-Awaken] skills on <Majin Buu> cards in your Z-Deck", "this card's [Union]
 * skill in your hand", "[Arrival Red/Yellow] on a <Beerus> card" - the tag and
 * the cards it is on. `anySkill` also reads "a skill on X" (no tag: every line).
 */
function skillScopeOf(raw: string, c: Ctx, anySkill = false): SkillScope | null {
  const r = raw.trim();
  // Places this reader cannot hold together are refused rather than narrowed:
  // "in your Battle Area and/or Combo Area" read as the Combo Area alone, a card
  // "under" another as the pair of them, and two descriptions joined by "or"
  // ("on X from your Z-Deck or Y from your hand") as one merged description.
  if (/\band\/or\b|\bunder\b|\bcardunder\b/i.test(r)) return null;
  if ((r.match(/\b(?:in|from) your (?:hand|z-deck|drop(?: area)?|warp|battle area)\b/gi) ?? []).length > 1) return null;
  let m: RegExpExecArray | null;
  let tagText: string | null = null;
  let who: string;
  if ((m = /^(?:(?:your|their|the|an?)\s+)?\[([^\]]+)\](?: skills?)? (?:on|of) (.+)$/i.exec(r))) [tagText, who] = [m[1], m[2]];
  else if ((m = /^(.+?)'?s \[([^\]]+)\](?: skills?)?(?: (in your (?:hand|z-deck|drop(?: area)?|battle area)))?$/i.exec(r))) [tagText, who] = [m[2], m[3] ? `${m[1]} ${m[3]}` : m[1]];
  else if (anySkill && (m = /^(?:an?|the) skills? (?:on|of) (.+)$/i.exec(r))) who = m[1];
  // "a [Dark Over Realm] skill from your hand" (BT27-092b): no card is named, so any card there.
  else if ((m = /^(?:an?|the) \[([^\]]+)\] skills? in your (hand|z-deck|drop(?: area)?|warp)$/i.exec(r))) [tagText, who] = [m[1], `cards in your ${m[2]}`];
  else return null;
  const kind: SkillTag | null = tagText === null ? {} : skillTagOf(tagText);
  if (!kind) return null;
  // "in their hand and Battle Area" is the union of the two, which the target
  // reader holds only as "or".
  const target = refFor(who.replace(/\b(hand|z-deck|drop area|battle area|warp) and (hand|z-deck|drop area|battle area|warp)\b/i, "$1 or $2"), c);
  if (!target || (c.stale && target === c.stale)) return null;
  // "the Extra Card's [Activate: Main] skill" (EX19-11) points back at a card an earlier clause
  // named, which a description cannot hold: read as one it is every Extra in the hand.
  if (/^the\s+(?!chosen\b)/i.test(who) && "sel" in target) return null;
  return { target, ...kind };
}

/**
 * The cost change a "the next time you activate / play / place X, reduce its
 * ... cost by N" pair says (the pair `splitClauses` cuts at the comma), or
 * "When you activate X, reduce the skill cost by N" on a [Permanent] (`once`
 * false: standing, no budget).
 *
 * Three nouns, three costs:
 * - "skill cost": one skill line's orbs (`what: skill`/`evolve`, `skillKind`
 *   or `tag` naming the line). The scope is "an [Activate] skill of your
 *   Leader", "the [Activate: Main/Battle] skill on {X} in your Battle Area",
 *   "this card's [Activate: Main] skill", "[Arrival Red/Yellow] on a <Beerus>
 *   card in your hand", "an [EX-Evolve] skill on {X} from your hand", "that
 *   card's [Swap] skill". A tag's timing words are not kept: `skillKind` has
 *   the kind and no more, which reaches both timings of the line.
 * - "energy cost": the card's own price, for a play or an Extra's activation
 *   (12-2-2) - the scope is then the cards themselves ("a green <World
 *   Tournament> Extra in your hand", "a red <Broly> card from your Z-Deck").
 * - "specified cost": the coloured half alone (owner's BT19-039 ruling).
 * It is `uses: 1` and shared by every card the words reach (the engine ends the
 * lot when one is paid for), bounded by the turn - or the battle, for
 * "during the battle". Anything else in the scope is refused whole.
 */
function nextTimeReduction(verb: string, scopeRaw: string, noun: string | undefined, amountText: string, until: Duration, c: Ctx, once: boolean): Op[] | null {
  const orbs = /^\d+$/.test(amountText) ? null : orbsIn(amountText);
  const amount = orbs ? Object.values(orbs).reduce<number>((sum, n) => sum + (n ?? 0), 0) : Number(amountText);
  if (!amount) return null;
  const colors = orbs ? orbsToList(orbs) : null;
  // "from your hand" / "in your Battle Area from your Z-Deck": where the card is
  // while it is paid for, which is the place to look.
  let scope = scopeRaw
    .trim()
    .replace(/ in your battle area from your (z-deck|hand)$/i, " in your $1")
    .replace(/ from your (hand|z-deck|drop(?: area)?|warp)\b/i, " in your $1");
  // "...place a Z-Extra in your Battle Area" (BT23-081): a Z-card is placed from the Z-Deck.
  if ((verb === "place" || verb === "play") && /\bin your battle area$/i.test(scope)) {
    if (!/\bz-/i.test(scope)) return null;
    scope = scope.replace(/ in your battle area$/i, " in your z-deck");
  }
  const word = (noun ?? "").toLowerCase();
  if (/\band\/or\b|\bunder\b/i.test(scope)) return null;
  // "...without using skills" (P-329) limits the play to one made by the rules, which a description cannot say.
  if (/\bwithout using skills\b/i.test(scope)) return null;
  // Two energy-cost descriptions ("mono-black with an energy cost of 10 or multicolor with an
  // energy cost of 8", EX23-45) are two kinds of card, which one filter cannot say.
  if ((scope.match(/energy costs?/gi) ?? []).length > 1) return null;
  if ((scope.match(/\bin your (?:hand|z-deck|drop(?: area)?|warp|battle area)\b/gi) ?? []).length > 1) return null;
  // "Original energy cost" (20-3-1) asks about the printed price, which is not the one this very change
  // is moving - `originalCostMin`/`originalCostMax` read it (#907 round 6), so it no longer needs refusing.
  const every = (target: Ref): Ref => ("sel" in target && !target.sel.special && target.sel.count !== undefined ? { sel: { ...target.sel, count: 99, upTo: undefined } } : target);
  // A card that is about to be bought is in the hand, not in play (20-1-6's
  // default), unless the words name its place.
  const toHand = (target: Ref): Ref =>
    "sel" in target && target.sel.area === "play" && !/\b(?:hand|deck|drop|energy|warp|life|battle area|z-deck)\b/i.test(scope) ? { sel: { ...target.sel, area: "hand" } } : target;
  const budget = once ? { uses: 1 } : {};
  if (word === "specified") {
    if (!colors || verb === "activate" || verb === "use") return null;
    const target = refFor(scope, c);
    if (!target || (c.stale && target === c.stale)) return null;
    return [{ op: "costReduction", target: every(toHand(target)), amount, what: "specified", colors, until, ...budget }];
  }
  if (word === "energy") {
    // The card's own price: a play, a placement from the Z-Deck, an Extra's use.
    let target: Ref | null = null;
    if (verb === "activate" || verb === "use") {
      const wide = skillScopeOf(scope, c, true);
      if (wide) {
        // The price belongs to the card, not to one of its lines. An Extra is
        // bought by activating it, so "[Activate]" adds nothing; a keyword
        // names the cards that print it; any other line (a [Counter], an
        // [Evolve]) would make the change wider than printed - unread.
        if (wide.evolve || (wide.skillKind && wide.skillKind !== "activate")) return null;
        target = wide.target;
        if (wide.tag) {
          const named = KEYWORD_NAMES[wide.tag];
          if (!named || !("sel" in target) || target.sel.special || !target.sel.filter) return null;
          target = { sel: { ...target.sel, filter: { ...target.sel.filter, keywords: [...target.sel.filter.keywords, named] } } };
        }
      } else target = /\bskills?\b/i.test(scope) ? null : refFor(scope, c);
    } else target = refFor(scope, c);
    if (!target || (c.stale && target === c.stale)) return null;
    return [{ op: "costReduction", target: every(toHand(target)), amount, ...(colors ? { colors } : {}), until, ...budget }];
  }
  // Skill cost (the default noun after "activate").
  if (verb !== "activate" && verb !== "use") return null;
  const scoped = skillScopeOf(scope, c, true);
  if (!scoped) return null;
  return [
    {
      op: "costReduction",
      target: every(scoped.target),
      amount,
      what: scoped.evolve ? "evolve" : "skill",
      ...(scoped.skillKind ? { skillKind: scoped.skillKind } : {}),
      ...(scoped.tag ? { tag: scoped.tag } : {}),
      ...(colors ? { colors } : {}),
      until,
      ...budget,
    },
  ];
}

/** The two halves of the copied-skill wording (20-18); see the merge in `compileClauseList`. */
/** EX03-16's first half: the card names the [Evolve] played onto this one, and whether it must differ in name (group 2). */
const EVOLVING_ONTO_SELF = /^when evolving this card into (?:an? )?([<≪{][^>≫}]+[>≫}])(?: cards?)?( with a different card name)?(?: from your hand)?$/i;
/** EX03-16's second half: the [Evolve] price, moved by printed orbs. */
const EVOLVE_COST_CHANGED = /^(?:the |its |that card's )?\[?evolve\]? cost is (decreased|reduced|increased) by ((?:\{[a-z0-9]\}\s*)+)\.?$/i;
const COPY_SKILL_CHOICE =/^choose (?:up to )?\d+ (?:of (?:the )?.+?'s (?:keyword )?skills?|(?:keyword )?skills? (?:on|of|from|in) .+?)[.,]?$/i;
const GAINS_THAT_SKILL = /^.*?\bgains? that skill\b/i;
/** The two halves of "choose up to 1 keyword skill on … and negate that skill" (9-1-5); see the same merge. */
const KEYWORD_SKILL_CHOICE = /^choose (?:up to )?(?:\d+|a|an|one) (?:of (?:the )?)?keyword skills? (?:on|of) .+?[.,]?$/i;
const NEGATE_THAT_SKILL = /^(?:and )?(?:negate (?:it|that skill)|that skill is negated)\b/i;

/** The clause loop, shared by a skill's body and by each modal option. */
/**
 * #916: "place up to 1 card in your opponent's life and 1 card in your
 * opponent's energy in their Drop Area" — one placement said once, over two
 * areas. `splitClauses` cuts it at "and", leaving a first half with no
 * destination and a second with no "up to". Owner-confirmed reading: the
 * "up to" holds for both, so each area is its own optional choice and its own
 * move, read by the ordinary single-area placement. Two *different* areas only.
 */
const SPLIT_PLACE_FIRST = /^(place up to \d+ cards?) in (your opponent'?s) (life|energy)(?: area)?$/i;
const SPLIT_PLACE_SECOND = /^(\d+ cards?) in (your opponent'?s) (life|energy)(?: area)? in (?:their|its owner'?s) drop(?: area)?$/i;
function joinSplitPlacements(clauses: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < clauses.length; i++) {
    const first = SPLIT_PLACE_FIRST.exec(clauses[i].trim());
    const second = first ? SPLIT_PLACE_SECOND.exec(clauses[i + 1]?.trim() ?? "") : null;
    if (first && second && first[2].toLowerCase() === second[2].toLowerCase() && first[3].toLowerCase() !== second[3].toLowerCase()) {
      out.push(`${first[1]} in ${first[2]} ${first[3]} in their drop area`, `place up to ${second[1]} in ${second[2]} ${second[3]} in their drop area`);
      i++;
    } else out.push(clauses[i]);
  }
  return out;
}

/**
 * "Choose up to 1 of your red <Son Goku: GT> cards **and it** gets +15000
 * power" (BT26-027): the pronoun is the clause's own choice, named before it in
 * the same clause — no back reference to what an earlier sentence did.
 */
const OWN_CHOICE_PRONOUN = /^choose (?:(?!\b(?:it|them|they|the rest|that card|those cards)\b).)+? and (?:it|they) (?:gets?|gains?|loses?)\b/i;

/**
 * `rawJoined[k]` says clause k was cut from the one before it at an "and" of
 * the same sentence (`splitClausesJoined`). Omitted, every clause
 * starts a sentence of its own, which is what a caller that never asked meant.
 */
export function compileClauseList(rawClauses: string[], c: Ctx, unsupported: string[], rawJoined: boolean[] = []): Op[] {
  const clauses = joinSplitPlacements(rawClauses);
  // Kept the same length as `clauses` at every splice below.
  const joined = clauses.map((_, k) => !!rawJoined[k]);
  /**
   * 20-16: the offer pushed by the clause just before this one. "You may reveal
   * 1 card from your hand **and** place it at the bottom of your deck" is one
   * offer over both halves; read a clause at a time the second half was
   * outside it and happened whether or not the offer was taken, and "if you
   * do" had nothing to ask about.
   */
  let pendingMay: Extract<Op, { op: "may" }> | null = null;
  // "if you do" (20-16) makes the rest conditional on the previous choice, and
  // a run of conditions all have to hold, so a group carries a list of them.
  type Group = {
    conds: Cond[];
    ops: Op[];
    delay?: { at: DelayTiming; scope: DelayScope; label: string };
    /**
     * Conditions that come *after* the timing phrase ("At the start of your next
     * Main Phase, **if you don't have a Unison Card in play**, you may pay {u}"):
     * they are asked when the delayed part runs, so they wrap its body inside the
     * delay and not the delay itself (`conds` are checked as the skill resolves).
     */
    innerConds?: Cond[];
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
    // A choice bounded by the *sum* of the chosen cards' costs ("any number
    // of … whose total cost adds up to 3 or less and KO them", `SUMMED_COUNT`)
    // is the same trap: refused, it left the last choice standing, and "KO
    // them" landed on a card an earlier clause had chosen (TB1-053). So is a
    // count per area or kind ("up to 1 each of …", `EACH_COUNT`): BT14-092b's
    // "switch them to Rest Mode" fell on the card its price had chosen.
    if (TWO_NAMED_CARDS.test(text) || SUMMED_COUNT.test(text) || SUM_UNREAD.test(text) || EACH_COUNT.test(text)) c.twoNamedCardsRefused = true;
  };
  const push = (ops: Op[]) => {
    const g = groups[groups.length - 1];
    (g.sink ?? g.ops).push(...ops);
  };
  // "…if your Leader Card is blue and your life is at 4 or less, this card
  // gains +10000 combo power. Then, choose up to 1 card … Then, **if** there
  // are no cards in your opponent's Combo Area, draw 1 card" (BT3-043, #539):
  // "Then" starts a follow-up of its own, outside the condition the sentence
  // before it opened. The official FAQ (BT3-043) says the "Then," parts resolve
  // even when the Leader is not blue and life is above 4, and the owner
  // (18 Oct 2026) made the official FAQ final over his own 4 Oct 2026 ruling
  // that kept them under the opening condition. A "Then, if …" is a condition
  // of its own, not one added to the first.
  let afterThen = false;
  /** The subject of the last count condition read ("you have", "your opponent has"), for a bare count joined to it by "and". */
  let countSubject: { said: string; area: boolean; clause: string } | null = null;
  for (let i = 0; i < clauses.length; i++) {
    const clause = clauses[i];
    const mayBefore = pendingMay as Extract<Op, { op: "may" }> | null;
    pendingMay = null;
    const thenHere = afterThen || /^then,?\s+/i.test(clause.trim());
    afterThen = /^then[.,]?$/i.test(clause.trim());
    {
      const here = groups[groups.length - 1];
      // Two "Then" tails are not follow-ups of their own but the end of what the condition opened: a shuffle
      // after a search, and a clause that points back at what the first part chose or looked at (BT3-029's "Then,
      // gain control of it", whose FAQ says it does not resolve when the Leader condition fails; BT3-086's "place
      // the rest in your Drop Area").
      const tail = clause.trim().replace(/^then,?\s*/i, "");
      // A pronoun the clause binds itself ("choose up to 1 … and it gets …") points back at nothing.
      const tailOfCondition = /^shuffle\b/i.test(tail) || (/\b(?:it|them|the rest|that card|those cards)\b/i.test(tail) && !OWN_CHOICE_PRONOUN.test(tail));
      // Phrasing batch 2 (owner's ruling of 26 Oct 2026 on BT26-027): a new sentence — a clause opening on a capital
      // letter, the way the catalog starts every sentence — that is not itself a condition, a connective or a
      // timing is outside the condition the sentence before it opened, as a "Then," follow-up is (BT3-043's FAQ):
      // "If your Leader is …, draw 2 cards and discard 2 cards from your hand. Choose up to 1 …" gates only the
      // draw and the discard. The same back references stay inside.
      const newSentence = /^[A-Z]/.test(clause.trim()) && !/^(?:If|When|While|Unless|Otherwise|Additionally|At|Then|Instead|Also|During|Until|For)\b/.test(clause.trim());
      if ((thenHere || newSentence) && !tailOfCondition && here.conds.length && here.ops.length && !here.delay && !here.sink) groups.push({ conds: [], ops: [] });
    }
    // "You can activate its [Awaken] skill **even if you have 5 or more life**" (BT7-069, EX06-03, EX25-02, P-208,
    // P-500, P-508, P-548, P-694, BT1-051): the permission lifts a keyword's life gate. The trailing "even if"
    // clause was cut off as a condition and the rest read as a play of the Leader (#907 round 6): unread whole.
    if (/\byou (?:can|may) activate\b[^.]*\[[a-z: -]+\][^.]*\beven (?:if|when)\b/i.test(clause)) {
      refuse(clause);
      continue;
    }
    // "…from your deck or life and add them to your hand. Then shuffle any
    // areas you looked through" (SD7-01, #539): search results are shown as
    // one pool, and the running frame records which closed areas were actually
    // inspected. Shuffle just those areas after the search (5-11-2).
    if (/^(?:then,? )?shuffle any (?:secret )?areas? you looked (?:through|at)\b/i.test(clause.trim())) {
      const areas = [...new Set(c.choices.flatMap((ch) => ch.sel.areas ?? (ch.sel.area ? [ch.sel.area] : [])).filter((a): a is "deck" | "life" => a === "deck" || a === "life"))];
      if (areas.length) push([{ op: "shuffle", areas, inspectedOnly: true }]);
      continue;
    }
    // "Once per turn, if this card would be KO'd by an opponent's skill, you may
    // place … instead" (BT21-040) and "…, once per turn, this card can't be
    // removed from a Battle Area by skills" (BT22-117, P-638): `splitClauses` cuts
    // the limit off at its comma, and alone it reads as nothing. A [Permanent]
    // replacement spends its own line for the turn (`negateOwnSkill`, as
    // BT29-141's does), which is exactly "once per turn" for a standing rule, so
    // the limit is carried to the clause that does the replacing.
    if (c.permanent && /^once per turn[.,]?$/i.test(clause.trim()) && i + 1 < clauses.length) {
      const next = clauses[i + 1].trim();
      // …"would" clause, then its substitute: the limit moves onto the substitute, where `oncePerTurn` reads it.
      if (i + 2 < clauses.length && (parseWouldLeave(next) || parseWouldReturnToHand(next) || parseWouldMoveFromLife(next) || parseWouldLoseMarker(next))) {
        clauses[i + 2] = `once per turn, ${clauses[i + 2].trim()}`;
        clauses.splice(i, 1);
        joined.splice(i, 1);
        i--;
        continue;
      }
      // Labelled best guess: "once per turn, this card can't be removed" shields the
      // card from the first removal by a skill each turn and from no later one. It
      // is the `leave` replacement with nothing to put in the card's place but the
      // spending of the line (no card says what else would happen). A skill's
      // KO is a removal too (owner ruling, 26 Oct 2026, as for the plain
      // prohibition): `skillOrKoBySkill`, never the battle's KO.
      const guard = /^(?:this card|it) can'?t be removed from (?:your|a|the) battle area by (your opponent'?s |an opponent'?s )?skills?$/i.exec(next);
      if (guard) {
        push([{ op: "replace", event: "leave", by: "skillOrKoBySkill", ...(guard[1] ? { bySide: "opponent" as const } : {}), with: [{ op: "negateOwnSkill", until: "turn" }] }]);
        i++;
        continue;
      }
    }
    // 12-2-4 (SD7-01): this is an activation of the chosen Extra's named
    // skill, not a play. `splitClauses` separates the target and the verb at
    // "and", so consume the exact pair before either half can be misread.
    const invoked = /^choose 1 ≪([^≫]+)≫ card in your hand with an energy cost less than or equal to your current energy$/i.exec(clause.trim());
    if (invoked && /^activate its \[activate: ?main\] skill[.]?$/i.test(clauses[i + 1]?.trim() ?? "")) {
      push([{ op: "invokeSkill", trait: invoked[1], skillKind: "activate:main", from: "hand", maxCost: "currentEnergy" }]);
      i++;
      continue;
    }
    // The Desire family (#979): "Choose 1 red or black ≪Desire≫ card in your hand
    // with an energy cost less than or equal to your current energy" followed by
    // "activate its [Activate: Main] skill" (BT5-002 and five more), or the same
    // said in one clause — "Activate the [Activate: Main] skill of up to 1 red or
    // black ≪Desire≫ from your hand with …" (BT21-002). SD7-01's bare form above
    // keeps its own spelling; these carry the colours too, as a one-card hand
    // selector with the energy bound, so the card is a hand Extra of the
    // description the text gives and no other. Anything the selector cannot say
    // exactly (another area, another count, a further measure) stays unread.
    const desireTwo = /^choose (1) ((?:(?:red|blue|green|yellow|black|white)(?: or (?:red|blue|green|yellow|black|white))? )?≪[^≫]+≫ card) (?:in|from) your hand (with an energy cost less than or equal to your current energy)$/i.exec(clause.trim());
    const desireOne = /^activate the \[activate: ?main\] skill of (up to 1) ((?:(?:red|blue|green|yellow|black|white)(?: or (?:red|blue|green|yellow|black|white))? )?≪[^≫]+≫(?: card)?) from your hand (with an energy cost less than or equal to your current energy)$/i.exec(clause.trim());
    const desire = desireOne ?? (desireTwo && /^activate its \[activate: ?main\] skill[.]?$/i.test(clauses[i + 1]?.trim() ?? "") ? desireTwo : null);
    if (desire) {
      const sel = parseTarget(`${desire[1]} ${desire[2]} in your hand ${desire[3]}`);
      if (sel && sel.side === "you" && sel.area === "hand" && sel.count === 1 && !!sel.upTo === (desire === desireOne) && sel.filter && !sel.filter.unreadable
        && sel.filter.traits.length === 1 && sel.filter.costAtMostEnergy && !sel.special && !sel.fromVar) {
        push([{ op: "invokeSkill", sel, skillKind: "activate:main", from: "hand" }]);
        if (desire === desireTwo) i++;
        continue;
      }
      refuse(clause);
      continue;
    }
    // BT31-116 (#539/#680): another effect activates the hand Extra's real
    // Main/Battle line (§12-2-4); it does not play that Extra into Battle.
    // Keep the whole printed target on one optional selector so declining the
    // choice is distinct from finding no legal line, and neither pays an
    // original Extra or skill cost.
    const freeExtra = /^activate an \[activate: ?main\/battle\] skill of (up to 1 mono-white extra with an energy cost of 2 in your hand)[.]?$/i.exec(clause.trim());
    if (freeExtra) {
      const sel = parseTarget(freeExtra[1]);
      if (sel?.side === "you" && sel.area === "hand" && sel.count === 1 && sel.upTo === true
        && sel.filter?.type === "EXTRA" && sel.filter.monoColor === true
        && sel.filter.colors.length === 1 && sel.filter.colors[0] === "White"
        && sel.filter.costMin === 2 && sel.filter.costMax === 2 && !sel.filter.unreadable) {
        push([{ op: "invokeSkill", sel, skillKind: "activate:main/battle", from: "hand" }]);
        continue;
      }
      refuse(clause);
      continue;
    }
    // BT2-009 (#539): fill one named card's stack to a total, using the
    // current count after *each* top-deck placement. The printed number is a
    // finite bound, so existing `choose`, `count` and `moveTo` operations can
    // state this without guessing an amount once at compile or trigger time.
    // Choose the host if several copies exist; an absent host does nothing.
    const fillUnder = /^place cards from the top of your deck under (?:your )?(\{[^{}]+\}) until there are (\d+) cards under (?:your )?(\{[^{}]+\})[.]?$/i.exec(clause.trim());
    if (fillUnder) {
      const total = Number(fillUnder[2]);
      const sameHost = fillUnder[1].toLowerCase() === fillUnder[3].toLowerCase();
      const filter = parseFilter(fillUnder[1]);
      // Keep the expansion bounded and the host exact. Another target, a
      // missing card name or a wildly large total remains an honest gap.
      if (!sameHost || !Number.isSafeInteger(total) || total < 1 || total > 20 || filter.unreadable || filter.names.length !== 1) {
        refuse(clause);
        continue;
      }
      const hostSel: Selector = { side: "you", area: "battle", filter, count: 1 };
      const hostVar = `c${c.n++}`;
      const chooseHost: Op = { op: "choose", sel: hostSel, as: hostVar, reason: `choose your ${fillUnder[1]} to fill` };
      const underHost: Selector = { fromVar: hostVar };
      const below: Selector = { side: "you", area: "under", underHost, count: 99 };
      const steps: Op[] = Array.from({ length: total }, () => ({
        op: "if" as const,
        cond: { kind: "count" as const, sel: below, atMost: total - 1 },
        then: [{ op: "moveTo" as const, target: { sel: { side: "you" as const, area: "deck" as const, take: 1 } }, to: "under" as const, under: { var: hostVar } }],
      }));
      push([{ op: "if", cond: { kind: "count", sel: hostSel, atLeast: 1 }, then: [chooseHost, ...steps] }]);
      track(chooseHost, c);
      continue;
    }
    if (/\buntil there are \d+ cards? under\b/i.test(clause)) {
      refuse(clause);
      continue;
    }
    // "Choose all of your opponent's Battle Cards and energy and switch them to
    // Rest Mode" (BT3-084, #539): two areas, each with its own noun. Read as one
    // phrase it was the Battle Cards *in the Energy Area*, which is nothing.
    const bothKinds = /^choose all (?:of )?(your opponent's|your) battle cards and (?:all (?:of )?(?:their|your) )?energy$/i.exec(clause.trim().replace(/[.,]$/, ""));
    const bothSwitch = bothKinds && i + 1 < clauses.length ? /^(?:and |then )?switch them to (rest|active) mode[.]?$/i.exec(clauses[i + 1].trim()) : null;
    if (bothKinds && bothSwitch) {
      const side = bothKinds[1].toLowerCase() === "your" ? "you" : "opponent";
      const mode = bothSwitch[1].toLowerCase() as "rest" | "active";
      push([
        { op: "switchMode", target: { sel: { side, area: "battle", filter: { ...parseFilter("Battle Card") }, count: 99 } }, mode },
        { op: "switchMode", target: { sel: { side, area: "energy", count: 99 } }, mode },
      ]);
      i++;
      continue;
    }
    // "…the next time you activate X during this turn, reduce its skill cost
    // by {b}": the two halves `splitClauses` cut apart, read as the pair.
    const nextTime = NEXT_ACTIVATION.exec(clause.trim());
    const reduce = nextTime && i + 1 < clauses.length ? REDUCE_THAT_SKILL_COST.exec(clauses[i + 1].trim()) : null;
    if (nextTime && reduce) {
      const verb = nextTime[1].toLowerCase().startsWith("pay") ? "place" : nextTime[1].toLowerCase();
      // "the skill cost" after "activate", "the energy cost" after a play.
      const noun = reduce[1]?.toLowerCase().replace("activation", "skill") ?? (verb === "activate" || verb === "use" ? "skill" : "energy");
      // #930, BT31-043: "until the end of **your** turn" (put at the end of the clause by `PURE_DURATION`)
      // ends with its controller's own turn, the next one when it resolved on the opponent's (`ownTurn`).
      const until: Duration = nextTime[3]?.toLowerCase() === "battle" ? "battle" : nextTime[4]?.toLowerCase() === "your" ? "ownTurn" : "turn";
      const ops = nextTimeReduction(verb, nextTime[2], noun, reduce[2], until, c, true);
      if (ops) push(ops);
      else {
        refuse(clause);
        refuse(clauses[i + 1]);
      }
      i++;
      continue;
    }
    // [Permanent] "When you activate an [Activate: Main/Battle] skill on {X} in
    // your hand, reduce the skill cost by {y}{y}" (BT27-069): the standing form.
    // "Once per turn, when you activate ..." (BT28-078b) counts uses, which a
    // standing change cannot; the clause before it says so and it stays unread.
    const wouldPlay = WHEN_WOULD_PLAY.exec(clause.trim());
    const reduceWould = wouldPlay && i + 1 < clauses.length ? REDUCE_THAT_SKILL_COST.exec(clauses[i + 1].trim()) : null;
    if (wouldPlay && reduceWould && reduceWould[1]?.toLowerCase() === "specified") {
      const ops = nextTimeReduction("play", wouldPlay[1], "specified", reduceWould[2], "turn", c, false);
      if (ops) push(ops);
      else {
        refuse(clause);
        refuse(clauses[i + 1]);
      }
      i++;
      continue;
    }
    const whenActivate = c.permanent ? WHEN_ACTIVATE.exec(clause.trim()) : null;
    const reduceStanding = whenActivate && i + 1 < clauses.length ? REDUCE_THAT_SKILL_COST.exec(clauses[i + 1].trim()) : null;
    if (whenActivate && reduceStanding && !(i > 0 && /\bonce per turn\b|\blimit\b/i.test(clauses[i - 1]))) {
      const noun = reduceStanding[1]?.toLowerCase().replace("activation", "skill") ?? "skill";
      // An energy price belongs to the card, not to one line: only an Extra is bought by activating it.
      const ops = noun === "skill" || /\bextra\b/i.test(whenActivate[1]) ? nextTimeReduction("activate", whenActivate[1], noun, reduceStanding[2], "game", c, false) : null;
      if (ops) push(ops);
      else {
        refuse(clause);
        refuse(clauses[i + 1]);
      }
      i++;
      continue;
    }
    // "During this turn, your opponent can't…", "…, until the end of your
    // opponent's turn, it can't attack" — a duration split off on its own
    // belongs to the clause after it, where `durationOf` will find it.
    if (PURE_DURATION.test(clause.trim()) && i + 1 < clauses.length) {
      clauses[i + 1] = `${clauses[i + 1].replace(/[.]$/, "")} ${clause.trim()}`;
      continue;
    }
    // 20-18: "Choose up to 1 keyword skill on a card under this card" names
    // no cards to *do* anything to — it is the first half of "…, and this
    // card gains that skill for the turn", and only the pair says anything.
    // Merged so `compileClause` reads the two as one `copySkills`; apart, the
    // first half compiled as a choice of cards and the second went unread.
    // EX03-16: "When evolving this card into a <Broly> with a different card
    // name from your hand, the [evolve] cost is decreased by {g}{g}" — not a
    // trigger but a standing change to the price of an [Evolve] played onto
    // this card: the two halves are one `costReduction(what: evolve, onto:
    // [self])` over the named cards in the hand.
    const ontoSelf = EVOLVING_ONTO_SELF.exec(clause.trim());
    const ontoPrice = ontoSelf && i + 1 < clauses.length ? EVOLVE_COST_CHANGED.exec(clauses[i + 1].trim()) : null;
    if (ontoSelf && ontoPrice) {
      const target = parseTarget(`${ontoSelf[1]} cards in your hand`);
      const orbs = orbsIn(ontoPrice[2]);
      const n = Object.values(orbs).reduce<number>((sum, k) => sum + (k ?? 0), 0);
      if (target && n > 0) {
        const sel: Selector = { ...target, ...(ontoSelf[2] ? { notSelf: "name" as const } : {}) };
        push([{ op: "costReduction", target: { sel }, amount: (ontoPrice[1].toLowerCase() === "increased" ? -1 : 1) * n, what: "evolve", colors: orbsToList(orbs), onto: { sel: { special: "self" } }, until: durationOf(clauses[i + 1]) }]);
        i++;
        continue;
      }
    }
    if (COPY_SKILL_CHOICE.test(clause.trim()) && i + 1 < clauses.length && GAINS_THAT_SKILL.test(clauses[i + 1].trim())) {
      clauses[i + 1] = `${clause.trim().replace(/[.,]$/, "")}, ${clauses[i + 1]}`;
      continue;
    }
    // 9-1-5, the same shape: "choose up to 1 keyword skill on …" names the
    // skill the next clause negates, and apart the first half read as a choice
    // of a card and the second negated every skill of it.
    if (KEYWORD_SKILL_CHOICE.test(clause.trim()) && i + 1 < clauses.length && NEGATE_THAT_SKILL.test(clauses[i + 1].trim())) {
      clauses[i + 1] = `${clause.trim().replace(/[.,]$/, "")}, ${clauses[i + 1]}`;
      continue;
    }
    // "For each marker on this card, this card gets +5000 power during your
    // turn" — the reverse of a duration: the count leads the effect it
    // multiplies rather than trailing it, so it is reattached in front, not
    // behind, and `compileForEach` reads it out of the merged clause.
    if ((PURE_FOREACH_MARKERS_ON_SELF.test(clause.trim()) || PURE_FOREACH_OWN_TOKENS.test(clause.trim()) || PURE_FOREACH_COLORS.test(clause.trim())) && i + 1 < clauses.length) {
      clauses[i + 1] = `${clause.trim().replace(/[.,]$/, "")}, ${clauses[i + 1]}`;
      continue;
    }
    // "For each green Unison Card in your Drop, reduce the Z-Energy cost of this
    // card in your Z-Deck by 1" (P-464) and "If your Leader is a green <Son Goku: GT>
    // card, for each green <Son Goku: GT> card in your Warp, reduce the energy cost
    // of this card in your hand by 1" (BT20-068): the count leads the reducer, which
    // reads it trailing ("by 1 for each ..."); the condition in front is its own clause.
    const leadFor = /^(if .+?), (for (?:each|every) .+)$/i.exec(clause.trim());
    if (leadFor && i + 1 < clauses.length && COST_REDUCER.test(clauses[i + 1].trim()) && simpleCount(leadFor[2].replace(/^for (?:each|every) /i, ""))) {
      clauses.splice(i, 1, leadFor[1], leadFor[2]);
      i--;
      continue;
    }
    const countFirst = /^for (?:each|every) (.+?)[.,]?$/i.exec(clause.trim());
    if (countFirst && i + 1 < clauses.length && COST_REDUCER.test(clauses[i + 1].trim()) && !/\bfor (?:each|every)\b/i.test(clauses[i + 1]) && simpleCount(countFirst[1])) {
      // The count now trails the reducer; the clause it led is gone, so the
      // guard below (a reducer after an unread "for each") does not take it.
      clauses.splice(i, 2, `${clauses[i + 1].trim().replace(/[.]$/, "")} for each ${countFirst[1]}`);
      i--;
      continue;
    }
    // Phrasing batch 5: the same count leading any other effect, after a trigger — "When … KO'd by this card's attack,
    // **for every 5 cards in your Z-Energy**, add 1 of your opponent's life to its owner's Z-Energy" (BT23-109), "When
    // this card attacks, **for each non-Leader card under this card**, this card gets +10000 power for the battle": put
    // behind the effect it multiplies, where `compileForEach` reads it ("… for every 5 cards in your Z-Energy"). Not
    // over a sentence end, and not onto an effect that counts something of its own. Only the clause right after an
    // [Auto]'s moment (the one `TRIGGER_THEN_COUNT` cuts off), and only when `compileForEach` reads the pair whole —
    // anything else leaves the count unread, as it was before the cut (BT15-063, P-597: a choice "for each …" is not
    // a number `compileForEach` can multiply).
    // (A list of areas keeps its commas — "…in your Leader Area, Battle Area, and Unison Area" (P-658); a comma before a
    // verb is a clause the count is not.)
    // The same count opening an [Activate]'s effect — "[Activate: Battle] For each card in your Warp, this card gets +5000
    // power for the battle" (EX15-05, EX21-32) — reads the same way. Never a count "with different character names"
    // (BT18-059b, BT18-091): that is how many names, which a count of cards is not.
    const leadCount = (c.skillKind === "auto" || c.skillKind?.startsWith("activate")) && i === 0 ? /^for (each|every) ([^;:]+?)[,]?$/i.exec(clause.trim()) : null;
    const countOnly = !!leadCount && !/,\s*(?:then\s+)?(?:add|draw|choose|play|place|send|switch|ko|look|reveal|discard|return|remove|negate|reduce|this card|it|they|your opponent)\b/i.test(leadCount[2]) && !/\bdifferent (?:card |character )?names?\b/i.test(leadCount[2]);
    if (leadCount && countOnly && i + 1 < clauses.length && !/\bfor (?:each|every)\b|\bequal to\b/i.test(clauses[i + 1])) {
      const multiplied = compileForEach(`${clauses[i + 1].trim().replace(/[.]$/, "")} for ${leadCount[1].toLowerCase()} ${leadCount[2]}`, c);
      if (multiplied) {
        push(multiplied);
        i++;
        continue;
      }
    }
    // "Otherwise, draw 1 card" — the else of the condition just before it,
    // printed without a break. Split so the two halves read as themselves.
    const inlineOtherwise = /^otherwise[\s,]+(.+)$/i.exec(clause.trim());
    if (inlineOtherwise) {
      clauses.splice(i, 1, "otherwise", inlineOtherwise[1]);
      joined.splice(i, 1, false, false);
      i--;
      continue;
    }
    // Phrasing batch 4: "…add them to your hand. **If you added 2 cards to your hand**, …" (P-108, P-242, EX19-24),
    // "…under the chosen card. **If you placed a card**, …" (BT21-073), "…place them in your Drop Area, then shuffle your
    // deck. **If you placed cards in your Drop Area**, …" (P-121), "**If you placed a Battle Card at the bottom of your
    // deck**" (P-142): how many cards the move just before it took (20-16), counted off the choice that move took
    // them from — and only when that move is the skill's last, goes where the words say, and moves exactly what the
    // choice chose. Anything else ("…a card **from your hand** at the bottom of your deck", EX16-02) stays unread.
    const counted = /^if you (added|placed) (a|an|1|2|3|4|5|1 or more|cards) ?(battle )?(?:cards?)?(?: (to your hand|(?:in|into) (?:your|the) drop(?: area)?|at the bottom of your deck))?[.,]?$/i.exec(clause.trim().toLowerCase());
    // ("If you added **a card** to your hand" is `did addToHand`, the condition reader's, and stays so.)
    if (counted && !(counted[1] === "added" && !/^[2-9]$/.test(counted[2]))) {
      const open = groups[groups.length - 1];
      const host = open.sink ?? open.ops;
      // "…add up to 2 … among them to your hand, then place the rest at the bottom of your deck. If you added 2 cards
      // to your hand" (EX19-24): the add, not the rest's move after it.
      const moves = host.filter((o) => o.op === "moveTo" && (counted[1] !== "added" || o.to === "hand"));
      const move = moves[moves.length - 1];
      const chosen = move && move.op === "moveTo" && "var" in move.target && !move.target.minus ? c.choices.find((ch) => ch.var === (move.target as { var: string }).var) : undefined;
      const place = counted[4] ?? "";
      const where = !move || move.op !== "moveTo" ? false
        : counted[1] === "added" ? move.to === "hand" && (!place || place === "to your hand")
        : place.startsWith("at the bottom") ? move.to === "deck" && move.position === "bottom"
        : place ? move.to === "drop"
        : ["drop", "deck", "under", "warp", "energy"].includes(move.to);
      const battleOnly = !counted[3] || chosen?.sel.filter?.type === "BATTLE";
      const n = /^\d+$/.test(counted[2]) ? Number(counted[2]) : 1;
      // One choice that can hold that many: "up to 1 <Son Goku: Br> card and 1 <Vegeta: Br> card … If you added 2 cards"
      // (P-108) is two choices of one card each, which no count of either one answers.
      if (chosen && where && battleOnly && c.last === chosen.var && (chosen.sel.count ?? 1) >= n) {
        groups.push({ conds: [{ kind: "chose", var: chosen.var, atLeast: n }], ops: [] });
        continue;
      }
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
    // A choice the offer's own sentence made is what "if you do" reads when
    // there is one; otherwise the offer itself is the decision — "you may
    // reveal 1 card **and** place it at the bottom of your deck. If you do
    // so, draw 2 cards" (TB1-042) — however many clauses it took to say.
    //
    // A compulsory move of this very card ("At the end of your turn, send
    // this card to its owner's Warp. **If you do**, play up to 1 … from your
    // Warp", BT15-066) has no choice and no offer to read, so it is read off
    // the board: the card is now where the move was to put it. A card that
    // could not go — already gone, or kept where it was by a replacement —
    // is not there, and what hangs on the move does not happen (20-16-1).
    // Last of the three, so that a choice or an offer in the same skill keeps
    // being the thing it is read from, as it always was.
    const sentSelf = (() => {
      const open = groups[groups.length - 1];
      let host = open.sink ?? open.ops;
      let last = host[host.length - 1];
      if (last?.op === "delay") {
        host = last.ops;
        last = host[host.length - 1];
      }
      if (last?.op !== "moveTo" || !("sel" in last.target) || last.target.sel.special !== "self") return null;
      return last.to === "warp" || last.to === "drop" || last.to === "hand" || last.to === "deck" || last.to === "energy" ? last.to : null;
    })();
    const decided: Cond | null =
      c.lastOp === "may"
        ? { kind: "did", what: "may" }
        : c.last
          ? { kind: "chose", var: c.last, ...exactCount(c, c.last) }
          : mayBefore
            ? { kind: "did", what: "may" }
            : sentSelf
              ? { kind: "count", sel: { special: "self", area: sentSelf }, atLeast: 1 }
              : null;
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
      // 9-10-3 / 20-1-11: "…you may place it in your Z-Energy **instead**.
      // If you do, place 1 of your Z-Energy in its owner's Drop" (BT19-100,
      // BT26-006). A voluntary replacement happens only if its substitute is
      // carried out (9-10-3-1), so what "if you do" hangs on is the substitute
      // itself: the rest of the sentence runs as part of it, after it, and
      // never when the offer is declined or cannot be met and the departure
      // goes ahead. A bare redirect (\`replaceLeave\`) is the one-move form of
      // the same substitute, so it is said that way to take a second step.
      if (!decided && last && (last.op === "replace" || last.op === "replaceLeave") && last.optional && !(last.op === "replaceLeave" && (last.until || last.requestedTo))) {
        if (last.op === "replaceLeave") {
          const { to, from, by, bySide, mode, position, optional, target } = last;
          const redirected: Op = { op: "moveTo", target: { sel: { special: "subject" } }, to, ...(mode ? { mode } : {}), ...(position ? { position } : {}) };
          const swapped: Op = { op: "replace", event: "leave", ...(from ? { from } : {}), ...(by ? { by } : {}), ...(bySide ? { bySide } : {}), ...(optional ? { optional } : {}), ...(target ? { target } : {}), with: [redirected] };
          host[host.length - 1] = swapped;
          last = swapped;
        }
        if (last.op === "replace") {
          open.sink = last.with;
          continue;
        }
      }
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
      // "At the start of your next Main Phase, **you may pay {u}{u}. If you
      // do,** choose up to 1 … and play it" (BT12-042, BT13-057): a group that
      // is a delayed program makes the offer inside the delay, and the answer
      // it records (`did`, or the energy it chose) is bound there — the delayed
      // frame has its own variables — so the follow-up is a branch of the same
      // program, not a group beside it that would ask a frame that never saw
      // the offer. A choice the offer itself made is read as the choice, the
      // finer answer; otherwise it is the offer.
      if (open.delay && last?.op === "may" && decided) {
        const askedInside = decided.kind === "chose" && JSON.stringify(last.ops).includes(`"as":"${decided.var}"`);
        if (decided.kind === "did" || askedInside) {
          const branch: Op = { op: "if", cond: decided, then: [] };
          host.push(branch);
          open.sink = branch.then;
          open.sinkCond = decided;
          continue;
        }
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
    const durationTail = /[,\s]+(until the end of (?:your opponent's|your|the)(?: next)? turn)[,.]?$/i.exec(clause.trim());
    const replacementClause = durationTail ? clause.trim().slice(0, durationTail.index).trim().replace(/,$/, "") : clause;
    const timedReturn = durationTail ? parseWouldReturnToHand(replacementClause) : null;
    const would = timedReturn ?? parseWouldLeave(clause);
    if (would) {
      c.replacing = { ...would, ...(durationTail ? { until: durationOf(durationTail[1]) } : {}) };
      // "…it goes to the Warp instead" — "it" is the card the phrase named.
      c.lastTarget = { sel: { special: "self" } };
      continue;
    }
    const wouldLife = parseWouldMoveFromLife(clause);
    if (wouldLife) {
      c.replacing = { event: "life", ...wouldLife };
      // Unlike `parseWouldLeave`'s family, the departing card is never the
      // permanent's own — a Leader printing this text is never itself sitting
      // in the life area — so "it" means the substitute's `subject`, not `self`.
      c.lastTarget = { sel: { special: "subject" } };
      continue;
    }
    if (parseWouldLoseMarker(clause)) {
      c.replacing = { event: "marker" };
      c.lastTarget = { sel: { special: "self" } };
      // "…by an opponent's attack, once per turn, you may add 1 card from
      // under this card to your hand instead" (BT29-044): the limit is split
      // off on its own, and alone it would close the replacement empty-handed
      // and leave the substitute to compile as a plain effect. It belongs to
      // the clause after it, where `oncePerTurn` reads it.
      if (/^once per turn[.,]?$/i.test(clauses[i + 1]?.trim() ?? "") && i + 2 < clauses.length) {
        clauses[i + 2] = `once per turn, ${clauses[i + 2].trim()}`;
        clauses.splice(i + 1, 1);
        joined.splice(i + 1, 1);
      }
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
      // A [Permanent] that is not a trigger never resolves, so a battle-end effect in one is a misread, not a rule.
      // P-087 is the only one: the feed breaks its [Dual Attack] reminder at a <br> and the tail would read as a skill.
      if (c.permanent && trailing.at === "battleEnd") {
        refuse(clause);
        continue;
      }
      // "When this card attacks a Battle Card, **KO that card after the battle**" (BT1-015): "that card" is the card
      // this card attacked, taken when the attack is declared. FAQ (BT1-015 Q1/Q2): a [Blocker] does not change which
      // card is KO'd ("KO the original target of the attack"), and a negated attack still pays it ("KO the card
      // attacked"). So the target is chosen now (the `guard`, before any block) and KO'd at the Battle End Step.
      if (trailing.at === "battleEnd" && /^ko (?:that|the attacked) card$/.test(trailing.head) && /\bwhen this card attacks (?:an?|1) [a-z' ]*card\b/i.test(c.raw)) {
        const v = `c${c.n++}`;
        push([
          { op: "choose", sel: { special: "guard" }, as: v, reason: "the card this card attacked" },
          { op: "delay", at: trailing.at, scope: trailing.scope, ops: [{ op: "ko", target: { var: v } }], label: trailing.label },
        ]);
        continue;
      }
      const got = compileClause(trailing.head, c);
      if (got) {
        for (const o of got) track(o, c);
        push([{ op: "delay", at: trailing.at, scope: trailing.scope, ops: got, label: trailing.label }]);
        continue;
      }
      refuse(clause);
      continue;
    }

    // "Additionally, if **the attacking card is a ≪Frieza Clan≫ card**, place
    // 1 of your Battle Cards in its owner's Drop. If you do, draw 1 card"
    // (BT18-120): the card attacking in the battle in progress (8-1), asked of
    // the battle itself rather than of anything the skill chose. Only the plain
    // description; a negated one would need its negation checked (see below).
    const attackingIs = /^(?:if|when) the attacking card is (?:an? )?(.+)$/i.exec(clause.trim().replace(/[.,]$/, ""));
    // A later "choose **it**, KO **it**" (BT15-080) means this card, which no
    // pronoun here is bound to — read, it landed on whatever was seen last — so
    // a sentence that goes on to say "it" stays unread.
    const pronounAfter = clauses.slice(i + 1).some((x) => /\b(?:it|them|that card)\b/i.test(x));
    if (attackingIs && !pronounAfter && !/\b(?:not|non|other than|except|besides)\b/i.test(attackingIs[1])) {
      const filter = filterFor(attackingIs[1], null);
      if (filter) {
        groups.push({ conds: [{ kind: "count", sel: { special: "attacker", filter }, atLeast: 1 }], ops: [] });
        continue;
      }
    }

    // Phrasing batch 1: a condition about a card an earlier step of this same skill named, by what was done to it.
    const backRef = backReferenceCondition(clause, c);
    if (backRef) {
      groups.push({ conds: [backRef], ops: [] });
      continue;
    }

    // "If that card is a Battle Card" — what the reveal or the look just
    // turned up. The name only exists here, so the condition is built with
    // the compiler's own bookkeeping rather than by `parseConditionClause`.
    if (c.lastNamed || c.last) {
      // "If **it's** a Battle Card" is the same sentence contracted, which the
      // reveal wordings print as often as the long form.
      // "If **the card sent to your Warp** is …" (BT29-105b) names the card the
      // move just before it moved, which is "that card" said the long way.
      // "…by this skill" is the price's card (P-628), not the effect's last
      // move, so that form is left to the readings that know the price.
      const seen = /\bby this skill\b/i.test(clause)
        ? null
        : /^(?:if|when) (?:that card|it|it'?s|the (revealed|chosen) card|the card (?:sent|placed|moved|added|returned) (?:to|into|in) (?:your|its owner'?s|their) [a-z-]+(?: area)?) (?:is )?(?:an? )?(.+)$/i.exec(clause.trim().replace(/[.,]$/, ""));
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
      // "If it's a black ≪Shadow Dragon≫ card **you may add it to your hand**"
      // (BT14-131 …, #969): the action rides on the condition with no comma of
      // its own; read whole it was swallowed by the description and lost. It is
      // put back as the clause after the condition.
      const tail = seen ? /^(.+?)(?:,\s*|\s+)(you may .+)$/i.exec(seen[2]) : null;
      const described = tail ? tail[1] : seen?.[2];
      const read = described ? filterFor(described, null) : undefined;
      const negates = described ? /\b(?:not|non|other than|except|besides)\b/i.test(described) : false;
      const carriesNegative = read
        ? read.notColors.length > 0 || read.notCharacters.length > 0 || read.notTraits.length > 0 || read.notNames.length > 0 || read.notKeywords.length > 0 || (read.notKeywordsExact?.length ?? 0) > 0 || read.notType != null || read.notToken
        : false;
      const filter = negates && !carriesNegative ? undefined : read;
      if (seen && filter && v) {
        groups.push({ conds: [{ kind: "varMatches", var: v, filter }], ops: [] });
        c.lastTarget = { var: v };
        if (tail) {
          clauses.splice(i + 1, 0, tail[2]);
          joined.splice(i + 1, 0, false);
        }
        continue;
      }
    }

    // "If the revealed card's energy cost is the same as the declared number"
    // (BT22-090 and the Fortuneteller Baba cards): the card the reveal turned up
    // against the number the `declare` before it named.
    if (c.lastNamed && /^(?:if|when) the (?:revealed|chosen) card'?s energy cost is (?:the same as|equal to) the declared number$/i.test(clause.trim().replace(/[.,]$/, ""))) {
      groups.push({ conds: [{ kind: "varAttrIsX", var: c.lastNamed, attr: "energyCost" }], ops: [] });
      continue;
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
    const chaining = open.ops.length === 0 && (open.conds.length > 0 || !!open.innerConds?.length);
    // Phrasing batch 2: the second count of "If your opponent has 2 or more energy **and 1 or more Battle Card in their
    // Warp**" (BT13-147), "If you have 3 or more energy **and 3 or more Z-Energy**" (BT25-148), "…and **a black Unison
    // in play**" (BT29-087): the "and" cut the count off the subject it shares with the one before it, which is said
    // again for it. Only straight after such a condition, and only a bare count. Not when this half names an area
    // the first did not — "you have 1 or more red cards **and** 1 or more yellow cards **in your energy**" (BT24-132):
    // that area closes both counts (owner's ruling, phrasing batch 3, `closingArea` below).
    const areaNamed = (said: string) => /\b(?:in|from) (?:your|their|play|the|a|its)\b|\benergy\b|\bz-energy\b/i.test(said);
    const bareCount = /^(?:\d+ or (?:more|less|fewer)|an?|no|at least \d+) \S/i.test(clause.trim());
    const sharedSubject: string | null = chaining && countSubject && bareCount && !(!countSubject.area && /\bin (?:your|their)\b/i.test(clause)) ? countSubject.said : null;
    // Phrasing batch 3 (owner's ruling of 26 Oct 2026 on BT24-132): "If your Leader is a red <Whis> card and you have 1
    // or more red cards and 1 or more yellow cards **in your energy**" counts both in the energy — the area closing the
    // second count closes the first, which named none: one list of what you have there. Both are read with it.
    const closingArea = chaining && countSubject && !countSubject.area && bareCount && open.conds.length ? /\s(in your (?:energy|z-energy|drop(?: area)?|warp|hand))$/i.exec(clause.trim().replace(/[.,]$/, ""))?.[1] : undefined;
    const subjectBefore = countSubject as { said: string; area: boolean; clause: string } | null;
    if (closingArea && subjectBefore) {
      const first = parseConditionClause(`${subjectBefore.clause} ${closingArea}`, true);
      const second = parseConditionClause(`${subjectBefore.said} ${clause.trim()}`, true);
      if (first && second && first.cond.kind === "count" && second.cond.kind === "count") {
        open.conds[open.conds.length - 1] = first.cond;
        open.conds.push(second.cond);
        countSubject = { said: subjectBefore.said, clause: subjectBefore.clause, area: true };
        continue;
      }
    }
    const cond: ReturnType<typeof parseConditionClause> = parseConditionClause(clause, chaining) ?? (sharedSubject ? parseConditionClause(`${sharedSubject} ${clause.trim()}`, true) : null);
    const subjectHere = /^(?:(?:if|while|as long as) )?(you have|your opponent has)\b/i.exec(clause.trim())?.[1];
    countSubject = subjectHere ? { said: subjectHere, area: areaNamed(clause), clause: clause.trim().replace(/[.,]$/, "").replace(/^(?:if|while|as long as) /i, "") } : sharedSubject && cond ? countSubject : null;
    if (cond) {
      // The condition follows a timing phrase with nothing between them: it is
      // the delayed part's own, asked when that part runs. Read as a group of
      // its own it left the delay behind, and the effect happened at once
      // (BT13-057's "At the start of your next Main Phase, if you don't have a
      // Unison Card in play, you may pay {u}").
      if (open.delay && open.ops.length === 0 && !open.sink) (open.innerConds ??= []).push(cond.cond);
      else if (chaining) open.conds.push(cond.cond);
      else groups.push({ conds: [cond.cond], ops: [] });
      if (cond.subject) c.lastTarget = cond.subject;
      // Phrasing batch 2: "[Permanent] While there are 2 or more cards under **this card**, **it** gets +15000 power"
      // (P-391, P-392): with nothing named before it, "it" is the one card the condition spoke of.
      else if (!c.lastTarget && c.last === null && /\bthis card\b/i.test(clause) && !/\bother than this card\b/i.test(clause)) c.lastTarget = { sel: { special: "self" } };
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
    // 20-14: "your opponent **may not** activate [Counter: Play] skills"
    // (BT4-122, BT4-003, BT4-080, BT4-094, BT4-104, P-060) is the same
    // prohibition as "can't" — not an offer, which "may" alone would be.
    const plain = clause.replace(/^((?:your opponent|they|you)\s+)?instead[,\s]+/i, "$1").replace(/\bmay not\b/i, "can't");
    const unbounded = c.replacing ? plain.replace(/[\s,]+instead[.\s]*$/i, "") : plain;
    // 9-10 once a turn: "…, once per turn you may switch 1 of your cards to
    // Revealed Mode instead" (BT29-141). The replacement's program ends by
    // switching its own [Permanent] off for the turn (`negateOwnSkill`), which
    // is exactly "once per turn" for a standing rule.
    const oncePerTurn = !!c.replacing && /^once per turn,?\s+/i.test(unbounded.trim());
    const saidWhole = oncePerTurn ? unbounded.trim().replace(/^once per turn,?\s+/i, "") : unbounded;
    // "Choose 1 of your and your opponent's Battle Cards **ignoring [Barrier]**
    // . Then …" (TB3-066, TB3-068, BT8-122): printed inside the choosing
    // clause with no comma to cut it off as its own, which is how the sets
    // that print it as ", ignoring [Barrier], and KO it" are read above. The
    // words come off the description (they would otherwise be the end of a
    // card description no filter reads) and mark the choice they ended.
    // (Not for "your opponent chooses A and B, ignoring [Barrier], and sends
    // them …", whose reader takes the words itself, #1015.)
    const inlineIgnoresBarrier = /\S\s+ignoring \[barrier\]/i.test(saidWhole) && !opponentChoiceWords(saidWhole);
    const said = inlineIgnoresBarrier ? saidWhole.replace(/\s+ignoring \[barrier\]/i, "") : saidWhole;
    // 20-16: "your opponent **may** choose 1 of their Battle Cards and KO it"
    // — the offer is theirs to decline, and the "if they don't" after it reads
    // their answer. `compileClause` strips "you may" so every pattern sees a
    // bare instruction; this strips the other subject and remembers whose
    // decision it was, which is the whole difference between the two.
    const theirOffer = /^(?:your opponent|they) may\s+\S/i.test(said.trim());
    // #922: "Your opponent chooses 1 card in their hand and places it at the
    // bottom of their deck" (TB3-019). The plain hand clause below reads as a
    // discard to the Drop, which is a different destination; when the clause
    // after it moves "it" to a deck, the choosing is its own `choose` (the
    // opponent picks from their own hand) and the next clause moves that card.
    const handThenDeck = /^your opponent chooses? (\d+) cards? (?:in|from) their hand$/i.exec(said.trim());
    const handChosen = handThenDeck && i + 1 < clauses.length && /^places? it (?:at|on) the bottom of (?:their) deck$/i.test(clauses[i + 1].trim());
    let got = handChosen
      ? [{ op: "choose", sel: { side: "opponent", area: "hand", count: Number(handThenDeck[1]) }, as: `c${c.n++}`, chooser: "opponent", reason: clause } as Op]
      : compileClause(theirOffer ? said.trim().replace(/^(?:your opponent|they) may\s+/i, "") : said, c);
    // 20-16: "you may …" is the player's decision. `compileClause` strips the
    // words so that every pattern below sees a bare instruction, which meant
    // 787 compiled skills carried out an optional effect without asking. The
    // clause is read as usual and then wrapped in the offer.
    // "You can only play mono-yellow ≪Saiyan≫ cards" is a prohibition rather
    // than an offer, and is read by `compileProhibition`.
    // "You can use … Rest Mode … cards in combos" lifts a rule (5-7); it is a
    // permission standing for the turn, not a choice made now.
    const offered = /^(?:you may|you can(?! only)|the player may)\s+\S/i.test(said.trim()) && !/^you can use .*\brest mode\b.* in combos?\b/i.test(said.trim());
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
    if (i > 0 && /^for (?:each|every)\b/i.test(clauses[i - 1].trim()) && !/\bfor (?:each|every)\b/i.test(clause) && got?.some((o) => o.op === "costReduction")) {
      got = null;
    }
    // The same cap, on the chance it ever survives `stripNotes` as a clause
    // of its own rather than being swallowed by the parenthesis check above —
    // belt and braces, not reached by any card in the catalog today.
    if (got && i + 1 < clauses.length && /^\(up to \d+\)\.?$/i.test(clauses[i + 1].trim()) && got.some((o) => o.op === "costReduction")) {
      got = null;
    }
    if (got && inlineIgnoresBarrier) {
      const marked = got.filter((o) => o.op === "choose" || (o.op === "may" && o.ops.some((m) => m.op === "choose")));
      // Words that end no choice in this clause are not dropped silently.
      if (!marked.length) got = null;
      for (const o of marked) {
        if (o.op === "choose") o.sel.ignoreBarrier = true;
        else if (o.op === "may") for (const m of o.ops) if (m.op === "choose") m.sel.ignoreBarrier = true;
      }
    }
    if (!got) {
      if (c.replacing) {
        c.replacing = null;
        // Half of the sentence had already been read as the first half of the
        // replacement; with the clause that closes it unread, none of it is.
        for (const heldClause of c.replacingClauses ?? []) refuse(heldClause);
        c.replacingClauses = [];
        c.replacingOps = [];
        c.replacingOffered = false;
      }
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
    // 9-10: a replacement's body runs to the word "instead", and that is not
    // always one clause. "You may choose 1 of your Majin Tokens and remove it
    // from the game instead" (BT30-057, P-185, BT21-004) is two or three of
    // them, and read a clause at a time the first became the whole
    // replacement while the rest fell out of it and happened *always* — half
    // a replacement, which is worse than none. Each clause is compiled as
    // itself and held until the one carrying "instead" closes the sentence.
    if (c.replacing && !/\binstead\b/i.test(clause) && clauses.slice(i + 1).some((x) => /\binstead\b/i.test(x))) {
      c.replacingOps = [...(c.replacingOps ?? []), ...got];
      c.replacingClauses = [...(c.replacingClauses ?? []), clause];
      // "**You may** choose 1 of your Majin Tokens and remove it from the game
      // instead": the offer is on the clause that opens the body, and 9-10-3
      // is about the whole replacement, so it is remembered rather than lost
      // with the clause it was printed on.
      if (offered) c.replacingOffered = true;
      for (const o of got) track(o, c);
      continue;
    }
    // 9-10: the clause after "if this card would leave the Battle Area" is
    // where it goes instead, so it is a replacement rather than a move.
    if (c.replacing) {
      const held = c.replacingOps ?? [];
      const heldOffer = !!c.replacingOffered;
      c.replacingOps = [];
      c.replacingClauses = [];
      c.replacingOffered = false;
      if (held.length) got = [...held, ...got];
      const only = got.length === 1 ? got[0] : null;
      const { from, by, bySide, subject, subjectSide, requestedTo, until, event: replaceEvent, to: lifeTo, lifeSelf } = c.replacing;
      c.replacing = null;
      // A redirect says where **the card itself** goes. The card is what the
      // opener bound, so the move's target must still be it: "place all the
      // cards under this card in its owner's Drop Area instead" (BT3-051) is a
      // move of a different pile of cards altogether, and read as a redirect it
      // hung a replacement on each buried card — a rule about cards that are
      // not in a Battle Area at all, so the printed skill did nothing. It is a
      // substitute, and falls through to the branch below.
      // "…you may remove **this card in your Warp** from the game instead"
      // (BT30-104, deck flags 26 Oct 2026, 9-10-1-1): this card, taken out of
      // an area of its own, is not the card leaving the Battle Area — read as a
      // redirect, the ≪Maiden Squadron≫ card the skill protects was itself
      // removed from the game. It is a substitute, below.
      const selfMove = only?.op === "moveTo" && "sel" in only.target && only.target.sel.special === "self" && !only.target.sel.area && !only.target.sel.areas?.length;
      if (replaceEvent !== "life" && replaceEvent !== "marker" && only && only.op === "moveTo" && selfMove && only.to !== "under" && only.to !== "play" && !only.under && !oncePerTurn) {
        // When the rule names other cards, they are the ones it is about —
        // not whatever "it" happened to point at in the second half.
        const filter = subject ? filterFor(subject, "battle") : undefined;
        if (filter === null) {
          refuse(clause);
          continue;
        }
        const target: Ref = subject ? { sel: { side: subjectSide ?? "you", area: "battle", filter, count: 99 } } : only.target;
        // "…to your energy in Rest Mode instead" — the move said how it
        // arrives as well as where, and the replacement has to carry both.
        push([{ op: "replaceLeave", to: only.to, target, ...(from ? { from } : {}), ...(by ? { by } : {}), ...(bySide ? { bySide } : {}), ...(only.mode ? { mode: only.mode } : {}), ...(only.position ? { position: only.position } : {}), ...(requestedTo ? { requestedTo } : {}), ...(until ? { until } : {}), ...(offered ? { optional: true } : {}) }]);
        continue;
      }
      // The departure is replaced by something other than a destination for
      // the card itself — "place all the cards under this card in the Drop
      // Area instead" (BT3-051), where the card stays and its pile goes. That
      // is `replace`'s substitute form (#125). Since #107 it may also stop and
      // ask, and be an offer rather than a rule ("you may … instead", 9-10-3):
      // the two suspendable call sites run it as a frame that can wait, and
      // the other 46 leave it unapplied rather than half-running it.
      const filter = subject ? filterFor(subject, "battle") : undefined;
      if (filter !== null && substitutable(got)) {
        const target: Ref | undefined = subject ? { sel: { side: "you", area: "battle", filter, count: 99 } } : lifeSelf ? { sel: { special: "self" } } : undefined;
        // #272: "reveal it and add it to your hand instead" — the reveal is
        // what makes the arriving card's identity public (20-11-2), carried
        // onto the move as `faceUp` so it stays public once sitting in a
        // hand, the way a revealed life card already does (`revealedTo`).
        // The card names no "face up" of its own; the reveal says it instead.
        const revealedAs = new Set(got.filter((o): o is Extract<Op, { op: "reveal" }> => o.op === "reveal").map((o) => o.as));
        const revealedOps =
          replaceEvent === "life" && revealedAs.size
            ? got.map((o) => (o.op === "moveTo" && o.to === "hand" && "var" in o.target && revealedAs.has(o.target.var) ? { ...o, faceUp: true } : o))
            : got;
        const withOps: Op[] = oncePerTurn ? [...revealedOps, { op: "negateOwnSkill", until: "turn" }] : revealedOps;
        // 13-5-2: a marker kept, the one moment `by: "attack"` names.
        if (replaceEvent === "marker") {
          push([{ op: "replace", event: "marker", by: "attack", with: withOps, ...(offered || heldOffer ? { optional: true } : {}) }]);
          continue;
        }
        push([
          {
            op: "replace",
            event: replaceEvent === "life" ? "life" : by === "ko" ? "ko" : "leave",
            ...(replaceEvent === "life" ? (lifeTo ? { to: lifeTo } : {}) : by && by !== "ko" ? { by } : {}),
            ...(replaceEvent !== "life" && bySide ? { bySide } : {}),
            ...(replaceEvent !== "life" && from ? { from } : {}),
            with: withOps,
            ...(offered || heldOffer ? { optional: true } : {}),
            ...(target ? { target } : {}),
          },
        ]);
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
    // "You may discard 1 card from your hand **and draw 1 card**": the rest of
    // the sentence the offer was printed in is the offer's too (20-16), so a
    // plain instruction by the same player joined to it goes inside. Read
    // outside, the draw happened whether or not the offer was taken. An
    // opponent's own clause or a second offer is a decision of its own, and
    // only the offer still last in its branch can be added to.
    //
    // A clause that only *uses what the offer chose* ("choose 2 cards … and
    // place **them** in the Drop Area") stays where it was: it already does
    // nothing when nothing was chosen, and "if you do" reads the choice itself
    // (all N taken) — the finer answer, which this must not replace.
    let chain: Extract<Op, { op: "may" }> | null = null;
    if (mayBefore && joined[i] && !offeredClause && !opponentDoes && got.length) {
      const open = groups[groups.length - 1];
      const host = open.sink ?? open.ops;
      if (host[host.length - 1] === mayBefore) {
        const text = JSON.stringify(got);
        const boundInside = JSON.stringify(mayBefore.ops).match(/"as":"([^"]+)"/g)?.map((x) => x.slice(6, -1)) ?? [];
        if (!boundInside.some((v) => text.includes(`"${v}"`))) {
          mayBefore.ops.push(...got);
          if (mayBefore.reason) mayBefore.reason = `${mayBefore.reason} and ${clause.trim().replace(/[.]$/, "")}`;
          c.lastOp = "may";
          pendingMay = mayBefore;
          continue;
        }
        // #930, BT26-088: "you may reveal 1 mono-green <Vegito> card from your
        // hand **and switch the same number of your green energy as that
        // card's specified cost to Rest Mode**. If you do, …": the switch is
        // counted off the revealed card and is part of what is offered (20-16)
        // — "if you do" needs both. The counted reveal becomes a pick of the
        // one card, then its reveal, so "that card" is one card and not every
        // match in the hand.
        const pay = got[0];
        const shownFirst = mayBefore.ops[0];
        if (
          got.length === 2 && pay.op === "choose" && pay.exactly !== undefined && got[1].op === "switchMode" && "var" in got[1].target && got[1].target.var === pay.as &&
          mayBefore.ops.length === 1 && shownFirst?.op === "reveal" && shownFirst.audience !== "you" && shownFirst.sel.area === "hand" && shownFirst.sel.count === 1 && !shownFirst.sel.upTo
        ) {
          // Only a card whose specified cost the Active energy the switch
          // chooses from can pay in full is on offer (owner's ruling of 26 Oct
          // 2026): an unpayable one is never revealed.
          const pick: Op = { op: "choose", sel: shownFirst.sel, as: shownFirst.as, reason: mayBefore.reason ?? "reveal", specifiedCostAtMost: { count: pay.sel } };
          mayBefore.ops.splice(0, 1, pick, { op: "reveal", sel: { fromVar: shownFirst.as }, as: shownFirst.as });
          mayBefore.ops.push(...got);
          if (mayBefore.reason) mayBefore.reason = `${mayBefore.reason} and ${clause.trim().replace(/[.]$/, "")}`;
          c.lastOp = "may";
          pendingMay = mayBefore;
          continue;
        }
        // BT6-066: returning the optional exact selection AND shuffling the
        // deck is one action. The move alone is inert on decline, but its
        // shuffle is not; keep both inside the offer. "If you do" still
        // checks the exact chosen set, rather than merely accepting the offer.
        const selection = mayBefore.ops[0];
        if (selection?.op === "choose" && !selection.sel.upTo
          && /^shuffle (?:it|them|those cards) (?:into|in) your deck[.]?$/i.test(clause.trim())
          && got.some((op) => op.op === "shuffle")) {
          mayBefore.ops.push(...got);
          c.lastOp = "choose";
          pendingMay = mayBefore;
          continue;
        }
        chain = mayBefore;
        // "…reveal 1 ≪Universe 9≫ card from your hand and place **it** at the
        // bottom of your deck" (TB1-042): a counted reveal shows every match
        // (\`reveal\` takes no count), so "it" would be all of them. Said as
        // what it is — you pick the one card, and it is shown as it moves —
        // "it" is that card, and "if you do" has a choice to read.
        const shown = mayBefore.ops[0];
        if (shown?.op === "reveal" && shown.audience !== "you" && shown.sel.area === "hand" && shown.sel.count && !shown.sel.upTo && got.every((o) => o.op === "moveTo" && "var" in o.target && o.target.var === shown.as)) {
          const pick: Op = { op: "choose", sel: shown.sel, as: shown.as, reason: mayBefore.reason ?? "reveal" };
          mayBefore.ops[0] = pick;
          for (const o of got) if (o.op === "moveTo") o.reveal = true;
          track(pick, c);
        }
      }
    }
    // What "if you do" points at is the *offer*, not the last thing inside it.
    if (said2.length) c.lastOp = said2[said2.length - 1].op;
    if (said2.length === 1 && said2[0].op === "may" && said2[0] !== (got[0] as Op)) pendingMay = said2[0] as Extract<Op, { op: "may" }>;
    else if (chain) pendingMay = chain;
    push(said2);
  }

  const ops: Op[] = [];
  for (const g of groups) {
    if (!g.ops.length) continue;
    // Nest the conditions outermost-first, so all of them have to hold.
    let body = g.ops;
    for (const cond of [...(g.innerConds ?? [])].reverse()) body = [{ op: "if", cond, then: body }];
    if (g.delay) body = [{ op: "delay", at: g.delay.at, scope: g.delay.scope, ops: body, label: g.delay.label }];
    for (const cond of [...g.conds].reverse()) body = [{ op: "if", cond, then: body }];
    ops.push(...body);
  }
  return ops;
}
