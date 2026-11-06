/**
 * Printed trigger wording → the moment it names (9-6-2, 22).
 *
 * The compiler's own regexes for "When …" clauses, read at game time only for
 * a skill that has no record yet — the rules engine falls back to this exactly
 * where the record's WHEN is absent (`vm/triggers.ts`'s `answersTo`), and the
 * mechanism report (`gaps.ts`) groups by it. Moved out of the legacy
 * `engine/triggers.ts` (#118); nothing here reads a game.
 */
import { effectHead, maskNames, trailingTrigger } from "./cards";
import { expandSharedCardDescription, parseFilter, readsOr, type CardFilter } from "./filters";
import type { ComboQualification } from "../vm/combo-qualification";
import type { Skill, Trigger } from "../types";
import { playTaxWording } from "./play-tax";

/**
 * BT31-116's shared Cell/Cell Jr. qualification belongs to the play moment,
 * before its Auto price is offered (9-6-2). A later Auto may change the
 * played card's cost or move it before this one resolves; neither can change
 * which moment was witnessed. This is a narrow printed-wording bridge like
 * the hand-combo origin checks below, not a runtime compilation of card text.
 */
const WHITE_CELL_PLAYED = parseFilter(expandSharedCardDescription("white <Cell> or <Cell Jr.> card with an energy cost of 3 or more"));
export function whiteCellPlayedSubjectFilter(sk: Skill): CardFilter | null {
  if (sk.kind !== "auto") return null;
  const head = effectHead(maskNames(sk.effect).text);
  const exact = /^when your <cell> or <cell jr\.> card—both white and with an energy cost of 3 or more—is played(?=,|\.|$)/.exec(head);
  // The comma in the known line introduces its activation effect. If it
  // introduces another condition, this is no longer the known trigger; its
  // separate condition must stay on the compiled program.
  if (!exact || (head[exact[0].length] === "," && !/^,\s*activate\b/.test(head.slice(exact[0].length)))) return null;
  return WHITE_CELL_PLAYED;
}

/** Keyword [Auto] skills and the events that make them pending (22). */
export function keywordTriggers(sk: Skill, trigger: Trigger): boolean {
  const k = sk.keyword;
  if (!k) return false;
  switch (k.name) {
    case "Attack":
      return trigger === "attacks";
    case "Alliance":
      return trigger === "attacks";
    case "Revenge":
      return trigger === "attacked";
    case "Offering":
      return trigger === "played";
    case "Revive":
      return trigger === "koed";
    case "Z-Stack":
      return trigger === "played" || trigger === "leaderPlaced";
    default:
      return false;
  }
}

/**
 * Both players' turns, named as one moment: "at the end of **you and your
 * opponent's turns**" (BT21-100, EX24-20, P-700), "at the end of **your or
 * your opponent's turn**" (EX07-01), "at the end of **each player's turn**".
 * And the Main Phase said the same way: "at the start of **you and your
 * opponent's Main Phases**" (BT21-109, BT21-110, BT21-114, BT31-115b,
 * EX24-29), "at the start of **your or your opponent's Main Phase**" (P-688).
 *
 * Neither wording matched the one-sided phrase either case was anchored on, so
 * twelve [Auto] skills answered to no trigger at all and never fired once —
 * a card that stands itself up every Main Phase simply stayed rested. And
 * nothing said so: the timing clause is consumed wherever it appears, whether
 * or not a trigger was found for it, so these carried no unread clause and no
 * gap to count.
 *
 * The phrase is one moment in the text and two in the engine, which is exactly
 * what this predicate is shaped for — a skill answers to both, and only one of
 * them can happen at a time (7-1), so it fires once per turn either way. The
 * same precedent as "when you play or combo with this card" below.
 */
/**
 * The combo card's own end-of-battle wording enters pending at 8-5-9. Audit triggers 1: the passive "at the end of a
 * battle in which **this card was used in a combo** [from your hand]" (EX17-03, BT25-066) is the same moment; read as a
 * plain `battleEnd` it answered every battle's end.
 */
const COMBO_BATTLE_END = /^(?:during your turn,\s*)?at the end of (?:the|a|this) battle(?: after| in which| where) (?:you (?:combo|combod|comboed|used?) (?:with )?this card|this card(?: in your hand)? (?:was|is) used in a combo)/;
const COMBO_BATTLE_END_FROM_HAND = new RegExp(`(?:${COMBO_BATTLE_END.source}) from your hand\\b`);
export function comboBattleEndSelf(sk: Skill): boolean {
  return COMBO_BATTLE_END.test(effectHead(maskNames(sk.effect).text));
}
/** BT3-096/098: the same cleanup occurrence, only on this card's owner's turn. */
export function comboBattleEndYourTurn(sk: Skill): boolean {
  const head = effectHead(maskNames(sk.effect).text);
  return COMBO_BATTLE_END.test(head) && /^during your turn,/.test(head);
}

/**
 * "…is played **by this card's skill**" (BT29-083, #1163): the means of a play,
 * naming the watching card as what played the subject — never the subject
 * itself. The compiler sets it aside before asking whether "it" means this card.
 */
export const BY_THIS_CARDS_SKILL = /\s+by this card['’]s skills?\b/gi;
/** "When your ≪Ginyu Force≫ card is played by this card's skill" (BT29-083, #1163), the description captured. */
const YOUR_CARD_PLAYED_BY_THIS_CARD = /^when your ((?!opponent)[^,]{1,120}?) is played by this card['’]s skill(?:,|\.|$)/;

/**
 * #930: "When your <X> card is played **by a [Union] skill**" (BT22-033,
 * BT25-036's back, P-682) and "When you play a Battle Card **using a
 * [Union-Fusion] skill**" (BT12-122): another of your cards' play, made by a
 * [Union] keyword's own play. The description and the variant are captured
 * (bare "[Union]" is any of them); only the whole moment, nothing coordinated
 * after it.
 */
const YOUR_CARD_PLAYED_BY_UNION = /^when (?:your ((?!opponent)[^,]{1,120}?) is played|you play ((?:an?|1) [^,]{1,120}?)) (?:by|using|with) (?:an? |the )?\[union(?:[- ](fusion|potara|absorb))?\](?: skills?)?\s*(?:,|:|\.|$)/i;
const UNION_VARIANT_NAME = { fusion: "Union-Fusion", potara: "Union-Potara", absorb: "Union-Absorb" } as const;
/** #930: the played card's description ("your blue <Gotenks> card", "a Battle Card") and the [Union] keyword named, or null for any other moment. */
export function yourCardPlayedByUnion(head: string): { said: string; what: "Union" | "Union-Fusion" | "Union-Potara" | "Union-Absorb" } | null {
  const m = YOUR_CARD_PLAYED_BY_UNION.exec(head.trim());
  if (!m) return null;
  return { said: m[1] !== undefined ? `your ${m[1]}` : m[2], what: m[3] ? UNION_VARIANT_NAME[m[3].toLowerCase() as keyof typeof UNION_VARIANT_NAME] : "Union" };
}

/** R-361: a successful [Arrival] play, not merely activating the keyword. */
export function yourCardPlayedUsingArrival(head: string): string | null {
  return /^when you use \[arrival\] to play ((?:an?|1) [^,]{1,120}?)\s*[,.]?$/i.exec(head.trim())?.[1] ?? null;
}

/**
 * Phrasing batch 5: "When this card **in your hand** is discarded by **one of your skills**" (BT26-015), "When this
 * card is discarded by one of your skills": the discard by a skill of the card's own master (`droppedFromHandByYou`),
 * not any skill's (`droppedFromHand`). Only the whole moment, nothing coordinated after it.
 */
const DISCARDED_BY_YOUR_SKILL = /^when this card(?: in your hand)? is discarded (?:from your hand )?by (?:one of )?your skills?\s*(?:,|:|\.|$)/;
/** Phrasing batch 5: "…is placed in its owner's Drop from a Battle Area" (BT22-079) and "…in a Drop from Z-Energy or a Battle Area" (BT23-092), no cause named. */
const DROP_FROM_BATTLE = /^when this card is placed (?:in|into) (?:a|your|its owner'?s|the) drop(?: area)? from (?:(?:your )?z-energy or )?(?:a|your|the) battle area(?:,|$)/;
const DROP_FROM_Z_ENERGY = /^when this card is placed (?:in|into) (?:a|your|its owner'?s|the) drop(?: area)? from (?:your )?z-energy(?: or (?:a|your|the) battle area)?(?:,|$)/;
/**
 * Phrasing batch 5: another card of yours, described — "When your ≪Saiyan≫ card attacks" (BT27-001), "When your
 * Battle Cards attack" (BT2-003); "When one of your red or blue Battle Cards is removed from your Battle Area by an
 * opponent's skill" (DB2-174). The description becomes a condition on the subject (`subjectFilterOf`); one the filter
 * cannot read whole leaves the skill unread rather than firing for every card.
 */
/** Phrasing batch 9: "When one of your <Son Goku: Xeno> or <Vegeta: Xeno> cards is used in a combo" (BT24-112) — `youCombo`, the card used the subject. */
export const YOUR_CARD_USED_IN_COMBO = /^when (?:one of your|your) ((?!opponent)(?!this card)[^,]{1,120}?) (?:is|are) used in a combo(?:,|$)/;
/** Audit triggers 1: "When a skill-less Battle Card or skill-less Unison Card is played in your opponent's Battle Area or Unison Area" (BT15-122). */
const PLAYED_IN_OPPONENTS_AREA = /^when (?:an?|1) ((?!this card)[^,]+?) (?:is|are) played in your opponent'?s (?:battle|unison) area(?: or (?:battle|unison) area)?(?:,|$)/;
/** Audit triggers 1: BT10-038's "[Auto] If this card is removed from a Battle Area by an opponent's skill, …": the moment said with "if". */
export const IF_REMOVED_BY_OPPONENT = /^if this card is removed from (?:a|the|your) battle area by (?:an? |one of )?(?:your )?opponent'?s? skills?\s*,/;
/** Audit triggers 1: "When one of your blue Battle Cards is added to your Z-Energy" (BT19-034b) — `yourCardToZEnergy`. */
export const YOUR_CARD_TO_Z_ENERGY = /^when (?:one of your|your) ((?!opponent)(?!energy\b)(?!this card)[^,]{1,120}?) (?:is|are) added to (?:your|its owner'?s) z-energy(?:,|$)/;
// Audit triggers 1: a description says no verb — "…cards is KO'd by an opponent's attack" is a KO, not an attack.
const YOUR_CARD_ATTACKS = /^when (?:your|one of your) ((?!opponent)(?!leader)(?![^,]*\b(?:is|are)\b)[^,]{1,120}?) (?:attacks|attack)(?:,|$)/;
/**
 * Phrasing batch 9: "When your black card with a [Union] skill or black Z-Unison **attacks or activates the [Blocker]
 * skill**" (BT24-112 back): two moments of another card of yours, as "this card attacks or activates [Blocker]" is two of
 * this card's — `yourCardAttacks`, and `yourCardBlockerUsed` (the blocker the subject).
 */
const YOUR_CARD_ATTACKS_OR_BLOCKS = /^when (?:your|one of your) ((?!opponent)(?!leader)(?!this card)[^,]{1,120}?) attacks,? or activates (?:its |the |an? )?\[blocker\](?: skill)?(?:,|$)/;
const YOUR_CARD_REMOVED_BY_OPPONENT = /^when (?:your|one of your) ((?!opponent)[^,]{1,160}?) (?:is|are) removed from your battle area by (?:(?:an? |one of )?(?:your )?opponent'?s? skills?|one of their skills)(?:,|$)/;
/**
 * Phrasing batch 6: "When this card is discarded from your hand by a [Union] skill" (BT11-079, BT19-052), "When this
 * card is placed from a hand into its owner's Drop by a [Union] skill" (P-683) — and the [Union-Fusion] wordings:
 * "…discarded from your hand by a [Union-Fusion] skill" (P-246), "…placed in your Drop from your hand by
 * [Union-Fusion]" (BT18-085), "…placed in your Drop Area from your hand as a result of [Union-Fusion]" (SD6-02).
 */
const DISCARDED_BY_UNION = /^when this card(?: in your hand)? is (?:discarded from (?:your|a) hand|placed from (?:your|a) hand (?:in|into) (?:your|its owner'?s) drop(?: area)?|placed (?:in|into) (?:your|its owner'?s) drop(?: area)? from (?:your|a) hand) by an? \[union\](?: skill)?(?:,|$)/;
const DISCARDED_BY_FUSION = /^when this card(?: in your hand)? is (?:discarded from (?:your|a) hand|placed from (?:your|a) hand (?:in|into) (?:your|its owner'?s) drop(?: area)?|placed (?:in|into) (?:your|its owner'?s) drop(?: area)? from (?:your|a) hand) (?:by an? |by |as a result of )\[union-fusion\](?: skill)?(?:,|$)/;
/** Phrasing batch 6: "When one of your ≪Namekian≫ cards activates [Union Absorb]" (BT17-089): the card is the subject. */
const YOUR_CARD_ABSORBS = /^when (?:one of your|your) ((?!opponent)[^,]{1,120}?) activates? (?:an? |the )?\[union[- ]absorb\](?: skill)?(?:,|$)/;
/** R472: the named procedure is a successful other-card arrival, not activation. */
export const YOUR_OTHER_BATTLE_DARK_PLAYED = /^when your battle card other than this card is played by a \[dark over realm\] skill(?:,|$)/i;
/** Phrasing batch 6: "When {X} is played from your hand" (TB2-045), "When a <Son Goku: GT> card is played from your Drop" (BT26-001b). */
const YOUR_CARD_PLAYED_FROM = /^when (?:an? |1 |one of your |your )?((?!this card\b|it\b|your opponent|an? opponent)[^,]{1,120}?) (?:is|are) played from your (hand|drop)(?: area)?(?:,|$)/;
/**
 * Phrasing batch 7: an opponent's Battle Card KO'd by one of yours, "by attack or skill" — "When a Battle Card that is in
 * your opponent's Battle Area and whose owner is your opponent is KO'd by your red card's attack or skill" (BT28-001b).
 * The card of yours that KO'd it is the subject (`yourCardKos`). Only "attack or skill": one of the two alone names a
 * cause the KO event does not carry.
 */
export const YOUR_CARD_BATTLE_TO_DROP = /^when (?:an? |1 |one of your |your )((?!this card\b|it\b|your opponent|an? opponent)[^,]{1,160}?)(?:\s*[-—–―]\s*|\s+)(?:is|are) placed from your battle area (?:in|into) (?:your|its owner'?s) drop(?: area)?(?:,|$)/;
/**
 * Phrasing batch 8: the damage wordings that print a battle answer only the battle's damage, never a skill's (the
 * `damage` op's moments since the owner's ruling of 27 Oct 2026): "When this card deals damage by attacking"
 * (BT13-005), "…deals damage to your opponent in a battle" (BT26-089); "When you deal damage to your opponent by
 * attacking with a blue card" (BT30-017) — any card of yours, the attacker the subject; "When you take damage from an
 * opponent's attack" (BT21-071).
 */
const DEALT_BATTLE_DAMAGE = /when this card deals damage(?: to your opponent)? (?:by attacking|in (?:a|the) battle)\b/;
export const YOUR_CARD_DEALT_BATTLE_DAMAGE = /^when you deal damage(?: to your opponent)? by attacking with (?:an? |1 |one of your |your )((?!this card\b)[^,]{1,120}?)(?:,|$)/;
const YOU_TOOK_BATTLE_DAMAGE = /^when you (?:take|receive) damage from (?:an |your )?opponent'?s (?:attack|battle card'?s attack)(?:,|$)/;
/**
 * Phrasing batch 9 (owner's rulings of 27 Oct 2026): a bare "When you take damage" (BT12-086's wording) is any damage —
 * a skill's and the battle's alike (1-13-2) — so it answers both moments; "When you take damage **from (one of) your
 * opponent's (non-keyword) skill(s)**" (BT14-070, BT13-039, BT14-023, BT14-104) is never your own skill's damage to you
 * (`youTookOpponentSkillDamage`).
 */
const YOU_TOOK_ANY_DAMAGE = /^when you (?:take|receive) damage(?:,|$)/;
const YOU_TOOK_OPPONENT_SKILL_DAMAGE = /^when you (?:take|receive) damage from (?:an |your |one of your )?opponent'?s (?:non-keyword )?skills?(?:,|$)/;
/**
 * Phrasing batch 10 (owner's ruling of 27 Oct 2026): every other skill damage moment answers any skill's damage, an
 * Extra card's included; "When your opponent takes damage from (non-keyword) skill(s) on (one of) your Battle Cards or
 * Unison Cards" (DB3-017, BT10-001b) still asks where the skill's card was (`opponentTookBoardSkillDamage`).
 */
const OPPONENT_TOOK_BOARD_SKILL_DAMAGE = /^when your opponent (?:takes|receives) damage from (?:a |an )?(?:non-keyword )?skills? on (?:one of )?your battle cards? or unison(?: cards?)?(?:,|$)/;
/** Phrasing batch 7: see `YOUR_CARD_BATTLE_TO_DROP` (BT20-054b) above, and the KO by one of yours below. */
export const YOUR_CARD_KOS = /^when (?:a battle card that is in your opponent'?s battle area and whose owner is your opponent|(?:one of )?your opponent'?s battle cards?|an opponent'?s battle card) (?:is|are) ko'd by (?:one of )?your ((?!opponent)[^,]{1,80}?)['’]s? (?:attack or skill|skill or attack|attacks? or skills?)(?:,|$)/;
/**
 * Phrasing batch 6: the keyword moves "When you activate …" names — "[Union-Fusion]" (BT10-092b), "an [Evolve] or
 * [Union] skill" (BT14-094), "[Evolve] or [Union Absorb]" (BT17-002b), "[union absorb]" (BT30-044b) — as `evolve`,
 * `union`, `fusion` or `absorb`. Empty for any other head.
 */
function activatedKeywords(head: string): string[] {
  const m = /^when you activate (?:an? )?\[([a-z -]+)\](?: skill)?(?: or (?:an? )?\[([a-z -]+)\](?: skill)?)?\s*(?:,|$)/.exec(head.toLowerCase());
  if (!m) return [];
  const one = (k: string | undefined) => (k === undefined ? null : k === "evolve" ? "evolve" : k === "union" ? "union" : /^union[- ]fusion$/.test(k) ? "fusion" : /^union[- ]absorb$/.test(k) ? "absorb" : "?");
  const out = [one(m[1]), one(m[2])].filter((k): k is string => k !== null);
  return out.includes("?") ? [] : out;
}

/** A description the subject filter reads whole: no "or" it would read half of, nothing it leaves unread. */
function readableSubject(effect: { unmask: (s: string) => string }, said: string): boolean {
  const description = expandSharedCardDescription(effect.unmask(said));
  if (/ or /.test(description.replace(/\b\d+(?: power)? or (?:less|fewer|more|greater|higher|lower)\b/g, "")) && !readsOr(description)) return false;
  return !parseFilter(description).unreadable;
}

/** A moved subject qualified in its original Battle Area (BT29-029, 9-6-9-1-2). */
export const RETURNED_FROM_YOUR_BATTLE = /^when (?:a|an|1) (.+?) is returned from your battle area to its owner'?s hand$/i;
/** No cause restriction is printed (BT3-112), unlike deckToWarpBySkill. */
const BATTLE_OR_DECK_TO_WARP = /^when this card is sent to the warp from your battle area or deck(?:,|\.|$)/;
/**
 * BT6-010 / BT2-010 require this very copy to have entered this battle's
 * Combo Area from hand. Both interpreters check the captured source when
 * `comboed` is pended at 8-5-9 from the captured 8-5-8 departure.
 */
export function comboBattleEndFromHand(sk: Skill): boolean {
  const head = effectHead(maskNames(sk.effect).text);
  return COMBO_BATTLE_END_FROM_HAND.test(head);
}

/** The area words of "…from your hand or energy", as `VmBattle.comboOrigins` remembers a combo card's area. */
const AREA_WORD: Record<string, string> = { hand: "hand", life: "life", energy: "energy", drop: "drop", battle: "battle", deck: "deck", warp: "warp" };
const ORIGIN_LIST = /^ from (?:your |the |a |an )?(hand|life|energy|drop|battle|deck|warp)(?: area)?((?:,? or (?:your |the |a |an )?(?:hand|life|energy|drop|battle|deck|warp)(?: area)?)*)\b/;
/**
 * Audit triggers 1: the areas the combo card's own end-of-battle wording names — "…used in a combo **from your hand or
 * energy**", "…**from your life**", "…after you combo with this card **from your Battle Area**", "…where this card
 * **in your hand** is used in a combo" — or `null` when it names none (any combo). The hand alone was read before
 * (`comboBattleEndFromHand`); another area was dropped, and the skill answered a combo from anywhere.
 */
export function comboBattleEndOrigins(sk: Skill): string[] | null {
  const head = effectHead(maskNames(sk.effect).text);
  const m = COMBO_BATTLE_END.exec(head);
  if (!m) return null;
  if (/\bthis card in your hand\b/.test(m[0])) return ["hand"];
  const list = ORIGIN_LIST.exec(head.slice(m[0].length));
  return list ? originsOf(list) : null;
}
function originsOf(list: RegExpExecArray): string[] {
  const words = [list[1], ...[...list[2].matchAll(/(hand|life|energy|drop|battle|deck|warp)/g)].map((w) => w[1])];
  return [...new Set(words.map((w) => AREA_WORD[w]))];
}

/** Audit triggers 1: the description in "…a battle in which your <description> attacked", as printed. */
export function battleAttackerSaid(clause: string): string | null {
  return /^at the end of (?:the|a|this) battle (?:in which|where) your (?!opponent)([^,]+?) attacked[,.]?$/i.exec(clause.trim())?.[1] ?? null;
}

/**
 * Audit triggers 1: what "at the end of the battle …" (8-5) says about the battle, when it is not the combo card's own
 * wording (`COMBO_BATTLE_END`): nothing (`any`), this card's part in it — "…the battle **for this card**" (`self`),
 * "…a battle **in which this card attacked**", "…**after this card attacks**" (`attacker`), "…**in which this card was
 * attacked**" (`guard`) — or something no reader keeps (`null`: the skill is unread rather than answering every
 * battle's end). `undefined` for a head that is not this moment.
 */
export function battleEndPart(head: string): "any" | "self" | "attacker" | "guard" | "yourAttacker" | null | undefined {
  if (COMBO_BATTLE_END.test(head)) return undefined;
  const m = /^at the end of (?:the|a|this) battle\b(.*)$/.exec(momentClause(head));
  if (!m) return undefined;
  const said = m[1].trim();
  if (!said) return "any";
  if (/^for this card$/.test(said)) return "self";
  if (/^(?:in which|where) this card (?:attacked|attacks)$|^after this card (?:attacks|attacked)$/.test(said)) return "attacker";
  if (/^(?:in which|where) this card (?:was|is) attacked$/.test(said)) return "guard";
  // "…a battle in which **your red <Android 18> Battle Card attacked**" (BT23-024): which of your cards attacked, a
  // description the compiler reads (`battleAttackerSaid`).
  if (/^(?:in which|where) your (?!opponent)[^,]+? attacked$/.test(said)) return "yourAttacker";
  return null;
}

/** BT6-010 additionally limits that same battle to the other player's turn. */
export function comboBattleEndOpponentTurn(sk: Skill): boolean {
  const head = effectHead(maskNames(sk.effect).text);
  return COMBO_BATTLE_END.test(head) && /\bduring your opponent'?s turn\b/.test(head);
}
/** "During your turn, " (or the opponent's) when a "when …" moment follows it directly: the turn is a condition, not the head (#907). */
export const TURN_THEN_WHEN = /^during (?:your|your opponent'?s) turn,\s*(?=when\b)/;
/**
 * Ordinary self-combo wording belongs to the 5-7 entry checkpoint.
 * "When a card evolves into this card, **or if you combo with this card**" (SD2-03)
 * is the same entry as the second moment of one skill.
 */
export function comboEntrySelf(sk: Skill): boolean {
  const head = effectHead(maskNames(sk.effect).text);
  if (COMBO_BATTLE_END.test(head)) return false;
  const text = maskNames(sk.cost + " " + sk.effect).text.toLowerCase();
  // (Audit selectors 3: "When you **combo this card with** a skill-less Battle Card with 10000 power" (DB2-003) is this card
  // used in a combo with the card in the battle — not every combo of yours, `youCombo`.)
  return /when you use this card in a combo|when this card(?: in your (?:hand|deck or hand|hand or deck)| in (?:a|your) battle area)? is used in a combo|when you combo with this card|when you combo this card with\b|or if you combo with this card|when you (?:play|attack) or combo with this card|when this card in your hand is played or used in a combo|when you attack with this card or combo with it\b/.test(text);
}
/**
 * A self-combo entry Auto whose printed timing explicitly requires hand — "when
 * this card in your hand is used in a combo" and "when you combo with this card
 * **from your hand**" (BT2-079; #907): the card that entered the Combo Area came
 * from the hand, which the entry moment captured.
 */
export function comboEntryFromHand(sk: Skill): boolean {
  const head = effectHead(maskNames(sk.effect).text).toLowerCase().replace(TURN_THEN_WHEN, "");
  return /when this card in your hand is (?:played or )?used in a combo\b|^when you combo with this card from your hand\b/.test(head);
}
/** R-483: one explicit origin on a watched combo; alternatives remain unread. */
export function watchedComboOrigin(sk: Skill): "hand" | "battle" | null {
  if (sk.kind !== "auto") return null;
  const masked = maskNames(sk.effect);
  const head = effectHead(masked.text);
  const hand = /^when you use (?:a|an|1) (.+?) from your hand in a combo(?:,|$)/.exec(head);
  const battle = /^when you combo with (?:a|an|1) (.+?) from your battle area during your turn(?:,|$)/.exec(head);
  const match = hand ?? battle;
  if (!match || /\bfrom\b|\busing\b|\bby\b/.test(match[1])) return null;
  const said = masked.unmask(match[1]);
  if (parseFilter(said).unreadable || (/ or /.test(said) && !readsOr(said))) return null;
  return hand ? "hand" : "battle";
}
/**
 * A self-combo entry moment that says more than "this card was used in a combo"
 * and that `comboEntryFromHand` (the plain hand wording, left exactly as it was
 * for the cards that already use it) does not ask (#907, follow-up to #1042):
 *
 *  - "when this card **is used in a combo from your hand**" (BT22-052, BT24-116, BT24-120, P-578):
 *    the hand, the same origin as "in your hand", said after the verb;
 *  - "when this card **in your deck or hand** is used in a combo" (EX23-23): either of two areas;
 *  - "when you combo with this card **from an Energy Area using {X}'s skill**" (BT7-030): the Energy
 *    Area, and only a combo that the named card's skill made (`viaSkillOf`, the card whose skill
 *    moved it, kept beside the origin on the battle);
 *  - "when you combo with this card **from the Battle Area**" (BT5-013, BT5-062, BT5-005, SD2-04; #1137):
 *    only a combo whose card came out of a Battle Area, not one from the hand (`comboOrigins` says `battle`);
 *  - "when you combo with this card from your hand **with an <Android 18> card in battle**"
 *    (BT8-030): the hand is `comboEntryFromHand`'s too; the company (`company`) is a condition the
 *    compiler puts on the program (a card of yours in the battle), because it is about the board when
 *    the Auto resolves, not about where the card came from.
 *
 * `origins` are the area names a combo card is remembered to have left (`VmBattle.comboOrigins`).
 */
export interface ComboEntryQualifier {
  origins: readonly string[];
  /** The printed name (without braces) of the card whose skill must have made the combo. */
  viaSkillOf?: string;
  /** The description of the card that must be in the battle with it, as printed (<names> card). */
  company?: string;
}
export function comboEntryQualifier(sk: Skill): ComboEntryQualifier | null {
  if (sk.kind !== "auto") return null;
  const masked = maskNames(sk.effect);
  const head = effectHead(masked.text).replace(TURN_THEN_WHEN, "");
  if (/^when (?:this card is used|you use this card) in a combo from your hand\b/.test(head)) return { origins: ["hand"] };
  // Delayed/replacement batch 1: "When this card is used in a combo **from your Drop Area**" (BT17-145, whose own
  // [Activate: Battle] uses it from there): only a combo whose card came out of the Drop Area.
  if (/^when (?:this card is used|you use this card) in a combo from your drop(?: area)?\s*(?:,|$)/.test(head)) return { origins: ["drop"] };
  if (/^when this card in your (?:deck or hand|hand or deck) is used in a combo\b/.test(head)) return { origins: ["deck", "hand"] };
  const via = /^when you combo with this card from an? energy area using (\{\d+\})['’]s skill\s*(?:,|$)/.exec(head);
  if (via) return { origins: ["energy"], viaSkillOf: masked.unmask(via[1]).replace(/^\{|\}$/g, "") };
  if (/^when you combo with this card from the battle area\s*(?:,|$)/.test(head)) return { origins: ["battle"] };
  // Phrasing batch 5: "When this card **in your/a Battle Area** is used in a combo" (BT21-084, BT26-019, BT27-022).
  if (/^when this card in (?:a|your) battle area is used in a combo\s*(?:,|$)/.test(head)) return { origins: ["battle"] };
  const company = /^when you combo with this card from your hand with (?:an?|1) (<[^>]+> card) in battle\s*(?:,|$)/.exec(head);
  if (company) return { origins: ["hand"], company: company[1] };
  // Audit triggers 1: any list of areas said after the combo, the clause ending there — "…used in a combo **from your
  // deck or hand**" (BT13-069), "When you combo with this card **from a Battle Area**" (BT5-085), "…**from your Drop
  // Area**" (XD3-05). Read only as "the" Battle Area or "your" Drop before, these answered a combo from anywhere.
  const combo = /^when (?:this card is used|you use this card) in a combo|^when you combo with this card/.exec(head);
  const list = combo ? ORIGIN_LIST.exec(head.slice(combo[0].length)) : null;
  // The hand alone, after "you combo with this card", keeps its own reader (`comboEntryFromHand`).
  if (combo && list && /^\s*(?:,|$)/.test(head.slice(combo[0].length + list[0].length)) && originsOf(list).join() !== "hand") return { origins: originsOf(list) };
  return null;
}
/** The areas a self-combo entry Auto asks the card to have come from, or `null` when it asks none (any combo). */
export function comboEntryOrigins(sk: Skill): readonly string[] | null {
  const q = comboEntryQualifier(sk);
  if (q) return q.origins;
  return comboEntryFromHand(sk) ? ["hand"] : null;
}
const EVERY_TURN_END = /^at the end of (?:(?:you|your) (?:and|or) your opponent'?s turns?|each player'?s turn)\b/;
/**
 * "At the end of **a turn in which this card was placed in a Battle Area**"
 * (BT15-118): every turn's end, either player's, and the rest of the sentence
 * is a condition the compiler puts on it — the card's memory of arriving in a
 * Battle Area this turn (`placedThisTurn`). Played counts (5-5-1).
 */
export const TURN_END_AFTER_PLACED = /^at the end of a turn in which this card was placed in (?:a|your) battle area\b/;
const EVERY_MAIN_START =/^at the (?:beginning|start) of (?:(?:you|your) (?:and|or) your opponent'?s main phases?|each player'?s main phase)\b/;

/**
 * 22-15: "When you play this card using [Over Realm]", "when this card is
 * played using [Over Realm]" (P-067, EX02-05, BT3-110, BT31-095 …) — the
 * card's own play, and only the one [Over Realm] made. Read as `played`, which
 * its opening words are, these fired on an ordinary play too, so the phrase is
 * taken out before `played` is looked for and is `playedUsingOverRealm` alone.
 */
const PLAYED_USING_OVER_REALM = /when (?:you play this card|this card is played) (?:using|with) \[(?:dark )?over realm[^\]]*\]/g;

/**
 * "When you play this card **from your hand**", "when this card is played from
 * your hand" (#936; BT8-122, BT10-020, EX03-14 …) — the card's own play, and
 * only the one made from the hand. Read as `played`, which its opening words
 * are, these fired on a play from the Drop or the Warp too, so the phrase is
 * taken out before `played` is looked for and is `playedFromHand` alone. Only
 * the bare qualifier is read (the head ends there): "from your hand or Warp",
 * "from your deck or hand" and "…, during your opponent's turn" name more than
 * the hand and stay a plain `played` as they were.
 */
/**
 * "… or **discarded by a skill**" (#969): the second moment of "when this card
 * is played [from your hand] or discarded by a <Shadow Dragon> card's skill"
 * (BT14-131 …, BT15-130 …, P-313) — a skill took the card out of its owner's
 * hand into the Drop (20-7-1), as its effect or its price: `droppedFromHand`.
 * The cause is a description of the skill's card, read by the compiler as a
 * condition on that discard half alone (`discardedBySkillCause`); the sentence must stop
 * there, so any other tail stays an unread gap.
 */
const DISCARDED_BY_SKILL = String.raw`(?:when )?(?:(?:it|this card) (?:is )?)?discarded by (?:an? |one of your |your )?[^,:]{0,80}?\bskills?\s*(?:,|:|\.|$)`;
/** The wording of the discard half of a coordinated play, to be read by the compiler: the cause as printed, or "" for any skill. */
export function discardedBySkillCause(trigger: string): string | null {
  const m = /(?:\bor (?:when )?(?:(?:it|this card) is )?|^when this card is )discarded by (?:an? |one of your |your )?([^,:]{0,80}?)\s*(?:,|:|\.|$)/i.exec(trigger.trim());
  if (!m) return null;
  const said = m[1].trim();
  if (/^skills?$/i.test(said)) return "";
  const by = /^(.+?)(?: card)?'s? skills?$/i.exec(said);
  return by ? by[1] : null;
}
/**
 * "When this card **in your hand** is played or placed in your energy" (EX19-26 …,
 * P-353, #907): the hand is where the card is for both halves, so the play half
 * is a play from the hand, and the other half is `placedInEnergyFromHand`.
 */
const PLAYED_HAND_THEN_ENERGY = String.raw`when this card in your hand is played(?=\s+or placed in your energy\s*(?:,|:|\.|$))`;
const PLACED_IN_ENERGY_TAIL = String.raw`(?=\s*(?:,|:|\.|$))`;
const PLACING_IN_ENERGY = new RegExp(String.raw`^when placing this card (?:in|into) your energy(?: area)?(?: from any area)?${PLACED_IN_ENERGY_TAIL}`);
/**
 * A [Permanent] that is really a trigger (#907): "[Permanent] When placing this
 * card in your energy from any area, you may choose 1 red card and 1 green card
 * in your Drop Area and send them to your Warp. If you do, negate this card's
 * [Energy-Exhaust] skill" (DB2-166, -168, -171, -173, -175, -176). It is
 * printed [Permanent] because it governs how the card enters the Energy Area
 * (22-31-2: an [Energy-Exhaust] card is placed in Rest Mode), but what it says
 * is a choice made as the card arrives, which only a moment can carry. LABELLED
 * BEST GUESS (manual 22-31, 9-6, no FAQ entry): the choice is offered at the
 * placing like any "when this card is placed in your energy" skill, after the
 * card has landed; a negated [Energy-Exhaust] then no longer matters for the
 * placing itself, which is why the card stays in Rest Mode (the manual's Rest
 * rule is about the placing, not a standing state).
 */
export function triggeredPermanent(sk: Skill): boolean {
  if (sk.kind !== "permanent") return false;
  return PLACING_IN_ENERGY.test(effectHead(maskNames(sk.effect).text));
}
// Audit triggers 1: "…from your hand **and your Leader Card is a ≪Universe 6≫ card**" (XD1-04, BT7-010, BT6-063): a
// condition riding on the moment (the compiler keeps it), so the play is still the one from the hand.
const PLAYED_FROM_HAND = new RegExp(String.raw`when (?:you play this card|this card is played) from your hand(?=\s*(?:,|:|\.|$)|\s+and (?:if )?your leader\b|\s+or (?:when )?(?:this card |it )?attacks\s*(?:,|:|\.|$)|\s+or ${DISCARDED_BY_SKILL})|${PLAYED_HAND_THEN_ENERGY}`);
/** Audit triggers 1: "When you play this card **from a Drop Area**" (TB3-039): the play from the Drop alone (`playedFromDrop`). */
const PLAYED_FROM_DROP = /when (?:you play this card|this card is played) from (?:a|your) drop(?: area)?(?=\s*(?:,|:|\.|$))/g;
/** The coordinated tail of "when you play this card or it is placed in a Drop Area from a Battle Area by a skill" (BT9-046, -059, -061, -120, -121, -122): a skill, whoever's, ends the sentence. */
const PLAYED_OR_DROPPED_FROM_BATTLE = /^when (?:you play this card|this card is played),? or (?:when )?(?:it|this card) is placed in (?:a|your|its owner'?s|the) drop area from (?:a|your|the) battle area by (?:a|your|one of your) skill\s*(?:,|:|\.|$)/;
const PLAYED_FROM_HAND_G = new RegExp(PLAYED_FROM_HAND.source, "g");

/**
 * "When this card is played **or attacks**" (#960) — one skill, two moments
 * (9-6-2): the play and the attack. The second moment is read only when the
 * sentence stops there ("…attacks," / "…attacks:"): "attacks an opponent's
 * Battle Card" (BT26-100) names a target, which would be a condition on the
 * attack half alone and cannot be put on the skill without also gating the play.
 */
const PLAYED_OR_ATTACKS = /^when (?:this card (?:in your hand )?is played(?: from your hand)?|you play this card(?: from your hand)?),? or (?:when )?(?:this card |it )?attacks\s*(?:,|:|\.|$)/;

/**
 * The cause a Rest Mode trigger prints (#907), or null when the head is not a
 * "this card is switched to Rest Mode by …" trigger at all.
 *
 *   side  whose skill: `mine` ("by one of your [yellow card] skills", "your
 *         Leader's skill"), `opponent`, `any` ("by a skill", "with
 *         {Name}'s skill") or `alliance` (the keyword's own switch, 22-32-3)
 *   desc  the description of the skill's card as printed ("yellow card",
 *         "yellow <turles> card", "leader", a masked {name}), "" for none
 *   played the sentence also says "is played or switched", so a condition on
 *         the cause belongs to the Rest half alone
 *
 * Best guess, no ruling: only a skill's own switch is "by a skill" — paying
 * Rest Mode as a skill cost is not, and [Alliance] keeps its own trigger.
 */
export interface RestCause { side: "mine" | "opponent" | "any" | "alliance"; desc: string; played: boolean }
export function restedCauseOf(head: string): RestCause | null {
  const masked = maskNames(head.toLowerCase().trim());
  // The clause up to its comma or colon, outside <…> (a character's subtitle) and {…}.
  let clause = masked.text, depth = 0;
  for (let i = 0; i < masked.text.length; i++) {
    const c = masked.text[i];
    if (c === "<") depth++; else if (c === ">") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === "," || c === ":")) { clause = masked.text.slice(0, i); break; }
  }
  clause = clause.replace(/[.\s]+$/, "");
  const leader = /^when you use your leader'?s skill to switch this card to rest mode$/.exec(clause);
  if (leader) return { side: "mine", desc: "leader", played: false };
  const m = /^when this card(?: in (?:a|your) battle area)? is (played or )?switched (?:from active mode )?to rest mode (?:by|with) (.+)$/.exec(clause);
  if (!m) return null;
  const played = !!m[1], by = m[2];
  const make = (side: RestCause["side"], desc: string): RestCause => ({ side, desc: masked.unmask(desc).trim(), played });
  if (/^(?:an? )?\[alliance\](?: skill)?$/.test(by)) return make("alliance", "");
  if (/^(?:a|any) skills?$/.test(by)) return make("any", "");
  if (/^(?:one of )?your skills?$/.test(by)) return make("mine", "");
  const opp = /^(?:one of )?your opponent'?s? (?:(.+?) (?:card'?s? )?)?skills?$/.exec(by);
  if (opp) return make("opponent", opp[1] ?? "");
  const named = /^(\{\d+\})'?s? skills?$/.exec(by);
  if (named) return make("any", named[1]);
  const mine = /^(?:one of )?your (?!opponent)(.+?)(?:'s)? (?:card )?skills?$/.exec(by);
  if (mine) return make("mine", /\b(?:card|leader)$/.test(mine[1]) ? mine[1] : `${mine[1]} card`);
  return null;
}

/** "When this card [in a Battle Area] is [played or] switched to X Mode [or Y Mode]", with no cause after it: the modes named, or "" for none. */
function switchedTo(t: string): string {
  const m = /when this card(?: in (?:a|your) battle area)? is (?:played or )?switched to ((?:revealed|hidden) mode(?: or (?:revealed|hidden) mode)?)(?! by)/.exec(t);
  return m ? m[1] : "";
}

/** #1015: the words that say a play was a skill's ("uses a skill to play", "using a skill", "using a non-keyword skill", "by a skill"). */
const OPPONENT_SKILL_PLAY_WORDS = /\buses? an? (?:non-keyword )?skill to play\b|\busing an? (?:non-keyword )?skill\b|\bby an? (?:non-keyword )?skill\b/;

/**
 * Read the "When …" clause of an [Auto] skill. Unrecognised wording never
 * pends — a skill the engine cannot place in time is better left out than
 * fired at the wrong moment.
 */
export function autoTriggerMatches(sk: Skill, trigger: Trigger): boolean {
  // A {name} is one word here — its comma and its "by" are the name's (P-526).
  // Audit triggers 1: a reminder in parentheses says what a keyword does, never when this skill happens — "this card
  // gains [dual attack] (Once per turn, **when this card attacks**, …)" (SD1-03) answered every attack.
  const t = playTaxWording(maskNames(sk.cost + " " + sk.effect).text).toLowerCase().replace(/\([^()]*\)/g, " ");
  /**
   * The timing triggers name a moment, and a card may equally well *mention*
   * that moment in the middle of an effect — "…, and at the end of the turn,
   * flip all face-up cards in your life face down", which is a delayed effect
   * and no trigger at all. 116 skills do exactly that, and every one of them
   * was pending its whole skill again at every turn end. A trigger is the head
   * of the sentence, so these are matched against the head and nothing else.
   *
   * The one exception is a skill with no trigger at all, where the phrase can
   * only be the trigger — see `trailingTrigger`. Reading it back onto the
   * front is all that takes, since every timing trigger below is anchored
   * there, and the phrase carries no wording the others look for.
   */
  const effect = maskNames(sk.effect);
  // #907: "During your turn, when this card attacks / you Combo with this card"
  // (BT1-063, BT1-101, BT2-044 …) puts the turn in front of the moment. The turn
  // is a condition the compiler keeps (`isTurnPlayer`); the moment is the head,
  // so the anchored readers below must see "when …" first. Only a turn phrase
  // directly followed by "when" is taken off: the end-of-battle combo wording
  // keeps its own "during your turn, at the end of …" prefix (`COMBO_BATTLE_END`).
  // Phrasing batch 5: a reminder in parentheses before the moment — "[Spirit Boost 1] **(You must remove a marker from
  // your Unison Card to activate this skill.)** When you use a red skill-less Battle Card … in a combo" (BT14-001b) —
  // says how the skill is paid, not when it happens (1-5-8); the head is the moment after it.
  const printed = effectHead(effect.text).replace(/^\([^()]*\)\s*/, "").replace(TURN_THEN_WHEN, "");
  const trailing = trailingTrigger(sk);
  const head = trailing ? `${trailing}, ${printed}` : printed;
  if (sk.kind === "auto" && momentsBatch1(head).some((m) => m.trigger === trigger)) return true;
  if (trigger === "activeBySkillDuringYourTurn" && playedOrActiveDuringYourTurn(sk)) return true;
  if (trigger === "youComboFromHand" || trigger === "youComboFromBattle") return watchedComboOrigin(sk) === (trigger === "youComboFromHand" ? "hand" : "battle");
  // Audit triggers 2: a watched card's moment, read by the grammar (`watchedMomentOf`) when its description reads whole.
  if (sk.kind === "auto") {
    const watched = watchedMomentOf(effect.unmask(printed));
    if (watched?.triggers.includes(trigger) && readableSubject({ unmask: (s) => s }, watched.said)) return true;
    // Audit triggers 3: a keyword's move said with no card described ("When you activate [Over Realm]").
    const move = watchedKeywordMove(momentClause(printed));
    if (move && move.said === null && move.triggers.includes(trigger)) return true;
    // …a card's move between areas said whole ("When this card is sent to its owner's Warp"), and a card going into a
    // pile from the areas named ("When this card in your hand is placed under …").
    const zone = zoneMoveOf(momentClause(printed));
    if (zone && zone.said === null && zone.trigger === trigger) return true;
    if (placedUnderFrom(printed).includes(trigger)) return true;
    // "At the end of a turn where this card was played" (BT16-142): either player's turn end (7-1), the play a condition
    // the compiler reads (`placedThisTurn`, played/from), using the successful entry remembered this turn.
    if (TURN_END_WHERE_PLAYED.test(momentClause(printed)) && (trigger === "turnEnd" || trigger === "opponentTurnEnd")) return true;
  }
  switch (trigger) {
    case "selfExtraActivated":
      return /when (?:you activate this card(?!['’]s)|this card is activated)(?=\s*(?:,|:|\.|$))/.test(t);
    case "played":
      // Arrival wording stays distinct from activating an Extra Card (R460).
      // "When you play or combo with this card" and "when this card in your
      // hand is played or used in a combo" are this trigger and the self
      // combo entry trigger (`comboUsed`; `comboed` is its stored alias).
      // Each fires at its own moment, and only one of them happens.
      // "…using [Over Realm]" is `playedUsingOverRealm`'s and is not this.
      return /when (?:you play this card|this card is played)|when you play or combo with this card|when this card(?: in your hand)? is played(?: or used in a combo)?/.test(
        t.replace(PLAYED_USING_OVER_REALM, "").replace(PLAYED_FROM_HAND_G, "").replace(PLAYED_FROM_DROP, ""),
      );
    case "playedFromHand":
      return new RegExp(PLAYED_FROM_HAND.source).test(t);
    case "playedFromDrop":
      return new RegExp(PLAYED_FROM_DROP.source).test(t);
    case "playedUsingOverRealm":
      return /when (?:you play this card|this card is played) (?:using|with) \[over realm[^\]]*\]/.test(t);
    case "playedUsingDarkOverRealm":
      return /when (?:you play this card|this card is played) (?:using|with) (?:\[over realm[^\]]*\] or )?\[dark over realm[^\]]*\]/.test(t);
    case "attacks":
      // "When this card attacks and KOs an opponent's Battle Card" is the KO, not the attack.
      // "When you attack or combo with this card" is this trigger and the
      // self combo entry trigger (`comboUsed`; `comboed` is its stored alias).
      // As with "play or combo", each fires at its own moment.
      // "When this card is **played or attacks**" (#960; BT25-128, P-575 …) and
      // its spellings ("when you play this card or when it attacks", "played
      // from your hand or attacks") say the attack as the second moment of one
      // skill. `played` (or `playedFromHand`) reads the first half; this reads
      // the second, so the skill answers to both and a play is not an attack.
      // Audit triggers 3: "When you attack with this card" (BT5-112, P-163), "…or combo with it" (BT4-040): the same attack.
      return /when this card attacks(?! and kos?\b)|when you attack or combo with this card|when you attack with this card(?! and\b)/.test(t) || PLAYED_OR_ATTACKS.test(head);
    case "attacked":
      return /when this card is attacked/.test(t);
    // 8-1: a Battle Card watching the *Leader* be attacked. The Leader's own
    // copy of that sentence is `attacked` above — it is a card in play like
    // any other — so this is only for the ones printed elsewhere. The words
    // between "your" and "Leader" ("mono-red ≪Saiyan≫", SD15-02, #1168) are
    // not lost here: the compiler reads them into a condition on the attacked
    // Leader (`attackedLeaderDescription`), or leaves the skill unread.
    case "yourLeaderAttacked":
      // (Review of audit selectors 2: "When **your opponent attacks your Leader Card**, you may have it get +5000 power"
      // (P-314), "…switch up to 1 of your opponent's energy to Rest Mode" (P-390) — the same moment said from the attacker's
      // side. Read as `opponentAttacks` it answered every attack, and P-314's "it" pumped the attacker.)
      return /when your [^,]{0,60}leader(?: card)? is attacked|when your opponent attacks your leader(?: card)?\s*(?:,|:|\.|$)/.test(head);
    // 21-3: damage from a skill, which is the only damage the `damage` op
    // deals — battle damage takes a different path — so "from a non-keyword
    // skill" is satisfied by the moment itself.
    case "youTookDamage":
      // Phrasing batch 8: not the attack's damage ("…from an opponent's attack", BT21-071), `youTookBattleDamage`'s.
      return /when you (?:take|receive) damage/.test(head) && !YOU_TOOK_BATTLE_DAMAGE.test(head) && !YOU_TOOK_OPPONENT_SKILL_DAMAGE.test(head);
    case "youTookBattleDamage":
      return YOU_TOOK_BATTLE_DAMAGE.test(head) || YOU_TOOK_ANY_DAMAGE.test(head);
    case "youTookOpponentSkillDamage":
      return YOU_TOOK_OPPONENT_SKILL_DAMAGE.test(head);
    case "opponentTookDamage":
      return /when your opponent (?:takes|receives) damage/.test(head) && !OPPONENT_TOOK_BOARD_SKILL_DAMAGE.test(head);
    case "opponentTookBoardSkillDamage":
      return OPPONENT_TOOK_BOARD_SKILL_DAMAGE.test(head);
    // 3-9: a life card leaving the Life Area, however it leaves.
    case "lifeLeft":
      // Audit triggers 2: "When a card is moved from your life to another area" (BT31-058, BT31-072) is the same moment.
      return /when your life (?:moves|is moved|is placed|leaves|is added)/.test(head) || /^when a card is moved from your life to another area(?:,|$)/.test(head);
    // Audit triggers 2: the keyword moves "When this card activates [Aegis]" (EX05-03), "…activates its [Aegis Blue/Yellow]
    // skill" (BT16-130), "When this card's [Aegis] skill activates", and "When you activate [Swap]" (BT28-086).
    case "aegisActivated":
      return /^when (?:this card activates (?:its |the )?\[aegis(?: [a-z/ ]+)?\](?: skill)?|this card'?s \[aegis(?: [a-z/ ]+)?\](?: skill)? activates)(?:,|$)/.test(head);
    case "swapActivated":
      return /^when you activate (?:an? )?\[swap\](?: skills?)?(?:,|$)/.test(head);
    case "koed":
      // "…removed from a Battle Area by a skill **or KO'd**" is the KO half of
      // a wording whose other half is `removedFromBattle`.
      // SD15-03 (#728) writes the same pair with "placed in your Drop Area from
      // your Battle Area by an opponent's skill or KO'd"; the first half is
      // `droppedByOpponent`.
      // Audit triggers 1: "…KO'd **by** …" names how or by whom, `koedBy…`'s (`momentsBatch1`), never every KO.
      return /when this card is (?:played or )?ko'?d(?! by\b)|when this card is (?:played or )?removed from [a-z' ]*battle area by [a-z' ]*skills? or ko'?d|when this card is (?:played or )?placed in [a-z' ]*drop area from [a-z' ]*battle area by [a-z' ]*skills? or ko'?d/.test(t);
    // 3-1: a move an effect caused, which is not a KO — the cards write "or
    // KO'd" when they mean both.
    case "removedFromBattle":
      // Mechanism batch 2: "When this card is **KO'd or removed** from the Battle Area by a skill" (P-569) is both moments.
      return /when this card is (?:played or )?(?:ko'?d or )?removed from [a-z' ]*battle area by (?:a|your|one of your) skill/.test(t);
    // 3-1: the narrower wording — a skill put it out of the Battle Area *and*
    // it ended in the Drop. `removedFromBattle` covers a skill that sends it
    // anywhere, so this cannot simply widen that one: a card bounced to the
    // hand is that moment and not this.
    case "droppedFromBattle":
      return /when this card is placed in (?:a|your|its owner'?s) drop area from (?:a|your|the) battle area by (?:a|any) skill/.test(t)
        // "When you play this card or it is placed in a Drop Area from a Battle Area by a skill" (BT9-046 …, #969): the play, and this.
        || PLAYED_OR_DROPPED_FROM_BATTLE.test(head);
    // The same move by an opponent's skill (SD15-03, #728).
    case "droppedByOpponent":
      return /when this card is placed in (?:a|your|its owner'?s) drop area from (?:a|your|the) battle area by (?:an? |one of )?(?:your )?opponent'?s? skill/.test(t);
    // The hand's side of the same sentence (SD13-05, BT7-127, BT11-022): a
    // skill discarded it, as its effect or as its cost (1-6, 1-7-1, 20-7-4).
    // SD13-05 says "**If** this card is placed …" after a condition before the
    // colon; it is the same moment, and the compiler drops it as a trigger.
    case "droppedFromHand":
      return /(?:when|if) this card is placed in (?:a|your|its owner'?s) drop area from (?:your|its owner'?s|the) hand by (?:a|any) skill/.test(t)
        // "…is played [from your hand] or discarded by a <Shadow Dragon> card's skill" (#969): the second moment, only when the sentence stops there.
        || (new RegExp(String.raw`^when (?:(?:you play this card|this card is played)(?: from your hand)?,? or |this card is )${DISCARDED_BY_SKILL}`).test(head) && !DISCARDED_BY_YOUR_SKILL.test(head));
    case "droppedFromHandByYou":
      return DISCARDED_BY_YOUR_SKILL.test(head);
    // The same sentence with no cause named at all, which is every cause: a
    // skill putting it there and a battle KO alike. Kept apart from the one
    // above because that one *does* name a cause, and a KO is not it.
    case "leftBattleToDrop":
      return /when this card is placed in (?:a|your|its owner'?s|the) drop area from (?:a|your|the) battle area(?!\s+by)/.test(head) || DROP_FROM_BATTLE.test(head);
    case "zEnergyToDrop":
      // Audit triggers 3: "When this card in your Z-Energy is placed in your Drop" (P-522), the area said first.
      return DROP_FROM_Z_ENERGY.test(head) || /^when this card in your z-energy(?: area)? is placed (?:in|into) (?:your|its owner'?s|a) drop(?: area)?(?:,|$)/.test(head);
    case "yourCardAttacks": {
      const m = YOUR_CARD_ATTACKS.exec(head) ?? YOUR_CARD_ATTACKS_OR_BLOCKS.exec(head);
      return !!m && readableSubject(effect, m[1]);
    }
    case "yourCardBlockerUsed": {
      const m = YOUR_CARD_ATTACKS_OR_BLOCKS.exec(head);
      return !!m && readableSubject(effect, m[1]);
    }
    case "yourCardRemovedByOpponent": {
      const m = YOUR_CARD_REMOVED_BY_OPPONENT.exec(head);
      return !!m && readableSubject(effect, m[1]);
    }
    case "opponentLifeToZBySkill":
      return /^when your opponent'?s life is added to (?:its owner'?s|their) z-energy by (?:one of )?your skills?(?:,|$)/.test(head);
    // Phrasing batch 6: the [Union]/[Evolve] family's moments.
    case "droppedFromHandByUnion":
      return DISCARDED_BY_UNION.test(head.toLowerCase());
    case "droppedFromHandByFusion":
      return DISCARDED_BY_FUSION.test(head.toLowerCase());
    case "unionFusionActivated":
      return activatedKeywords(head).includes("fusion");
    case "unionAbsorbUsed": {
      if (activatedKeywords(head).includes("absorb")) return true;
      const m = YOUR_CARD_ABSORBS.exec(head.toLowerCase());
      return !!m && readableSubject(effect, m[1]);
    }
    case "evolveActivated":
      return activatedKeywords(head).includes("evolve");
    case "battleCardReturnedToHand":
      return /^when (?:a|1) card in (?:a|the) battle area is returned to its owner'?s hand(?: by (?:a|any) skill)?(?:,|$)/.test(head.toLowerCase());
    case "opponentCardPlayedBySkill": {
      const m = /^when (?:one of )?your opponent'?s ((?!skill)[^,]{1,120}?) (?:is|are) played by (?:a|any) skill(?:,|$)/.exec(head.toLowerCase());
      return !!m && readableSubject(effect, m[1]);
    }
    case "yourEnergyToDeck":
      return /^when your energy is placed (?:at|on) the bottom of (?:its owner'?s|your) deck(?:,|$)/.test(head.toLowerCase());
    case "yourOtherBattlePlayedUsingDarkOverRealm":
      return YOUR_OTHER_BATTLE_DARK_PLAYED.test(head);
    case "yourCardPlayedFromHand":
    case "yourCardPlayedFromDrop": {
      const m = YOUR_CARD_PLAYED_FROM.exec(head.toLowerCase());
      return !!m && (m[2] === "hand") === (trigger === "yourCardPlayedFromHand") && readableSubject(effect, m[1]);
    }
    case "opponentCardToZEnergy":
      return /^when (?:one of )?your opponent'?s cards? (?:is|are) added to (?:their|its owner'?s) z-energy(?:,|$)/.test(head.toLowerCase());
    // Audit triggers 1: your own side of it, the card added described (a condition the compiler reads), never "your energy".
    case "yourCardToZEnergy": {
      const m = YOUR_CARD_TO_Z_ENERGY.exec(head.toLowerCase());
      return !!m && readableSubject(effect, m[1]);
    }
    case "removedFromGame":
      return /^when this card is removed from the game(?:,|$)/.test(head);
    case "eitherCardPlayed": {
      const m = /^when your or your opponent'?s ([^,]{1,120}?) (?:is|are) played(?:,|$)/.exec(head.toLowerCase());
      return !!m && readableSubject(effect, m[1]);
    }
    case "yourCardBattleToDrop": {
      const m = YOUR_CARD_BATTLE_TO_DROP.exec(head.toLowerCase());
      return !!m && readableSubject(effect, m[1]);
    }
    case "yourCardKos": {
      const m = YOUR_CARD_KOS.exec(head.toLowerCase());
      return !!m && readableSubject(effect, m[1]);
    }
    case "yourCardDealtBattleDamage": {
      const m = YOUR_CARD_DEALT_BATTLE_DAMAGE.exec(head.toLowerCase());
      return !!m && readableSubject(effect, m[1]);
    }
    case "yourCardDealtDamage":
      return /^when one of your cards deals damage(?: to your opponent)?(?:,|$)/.test(head.toLowerCase());
    case "yourCardReturnedToHand":
      return RETURNED_FROM_YOUR_BATTLE.test(head.split(/,|\./, 1)[0]);
    case "battleOrDeckToWarp":
      return BATTLE_OR_DECK_TO_WARP.test(head);
    // 21-14: a card of *yours* being KO'd, watched by the rest of your board —
    // "when your blue <Son Goku> card is KO'd, you may play this card from your
    // hand" — and the same from the other side of the table. `koed` is the
    // KO'd card's own skill and is not this.
    //
    // Only the plain wording. "…KO'd **by an opponent's skill**" and "…KO'd
    // **or removed from a Battle Area**" name a cause the engine cannot tell
    // apart from a battle KO, so the comma or the end of the clause is what
    // says the sentence stopped there.
    case "yourCardKoed":
      return /^when (?:your|one of your) (?!opponent)[^,]{0,70} (?:is|are) ko'd(?:,|$)/.test(head);
    // Audit triggers 1: "When one of your Battle Cards is KO'd by an opponent's attack" (P-409): the battle's KO only.
    case "yourCardKoedByAttack": {
      const m = /^when (?:your|one of your) ((?!opponent)[^,]{1,90}?) (?:is|are) ko'd by (?:an? |your )?opponent'?s attacks?(?:,|$)/.exec(head);
      return !!m && readableSubject(effect, m[1]);
    }
    case "opponentCardKoed":
      return /^when (?:your opponent's|an opponent's|one of your opponent's) [^,]{0,70} (?:is|are) ko'd(?:,|$)/.test(head);
    case "removedByOpponent":
      // Audit triggers 1: an older card says the same moment with "if" — "[Auto] **If** this card is removed from a Battle
      // Area by an opponent's skill, choose up to 1 {SSB Son Goku, Hope for Victory} in your hand and place it in your
      // energy" (BT10-038) — as SD13-05 says its discard; only at the head of the effect, where a trigger is printed.
      return /when this card is (?:played or )?removed from [a-z' ]*battle area by (?:an? |one of )?(?:your )?opponent'?s? skill/.test(t) || IF_REMOVED_BY_OPPONENT.test(effect.text.toLowerCase().trim());
    case "evolvedInto":
      return /when a card evolves into this card|when this card evolves\b/.test(t);
    case "evolveFromHandActivated":
      return /when using this card'?s \[evolve\] from your hand|when you (?:use|activate) this card'?s \[evolve\](?: skill)? from your hand/.test(t);
    // Audit triggers 1: a [Counter] named by its window is that one only (EX13-19's [Counter: Play]); said with more
    // after it ("…on an Extra Card"), it is not read.
    case "opponentCounter":
      return /when your opponent activates a \[counter\]/.test(t);
    case "opponentCounterPlay":
      return /^when your opponent activates an? \[counter: ?play\](?: skill)?(?:,|$)/.test(head);
    case "opponentCounterAttack":
      return /^when your opponent activates an? \[counter: ?attack\](?: skill)?(?:,|$)/.test(head);
    case "counterFreeFromHand":
      return /when you activate this card'?s \[counter[^\]]*\](?: skill)? from your hand without paying (?:its|the) energy cost/.test(t);
    case "kos":
      // The same moment said the other way round — "when an opponent's Battle
      // Card is KO'd **by this card's attack**" — which is still this card
      // doing the KO'ing and so still this trigger.
      return /when this card (?:attacks and )?kos? (?:an opponent's|your opponent's|one of your opponent's|a) (?:battle card|card)|when (?:an|your) opponent'?s? (?:battle )?card is ko'?d by this card'?s attack/.test(
        t,
      );
    case "leaderPlaced":
      // Phrasing batch 5: "When you place this card in **the** Leader Area" (BT2-100, BT2-003) is the same placing (6-2-4).
      return /when this card is placed in (?:your|a|the) leader area|when you place this card in (?:your|a|the) leader area/.test(t);
    // 7-1: whose turn it is decides whether these happen at all, and "your" is
    // the card's controller, never the turn player. One trigger covered both
    // wordings and was pended for both players, so 164 cards that act "at the
    // end of your turn" also acted at the end of the opponent's, and 13 that
    // wait for the opponent's turn fired a turn early as well.
    case "turnEnd":
      return /^at the end of (?:your|the|this) turn\b/.test(head) || EVERY_TURN_END.test(head) || TURN_END_AFTER_PLACED.test(head);
    case "opponentTurnEnd":
      return /^at the end of your opponent'?s turn\b/.test(head) || EVERY_TURN_END.test(head) || TURN_END_AFTER_PLACED.test(head);
    case "opponentTurnStart":
      return /^at the (?:beginning|start) of your opponent'?s turn\b/.test(head);
    case "mainStart":
      return /^at the (?:beginning|start) of (?:your|the) main phase\b/.test(head) || EVERY_MAIN_START.test(head);
    case "opponentMainStart":
      return /^at the (?:beginning|start) of your opponent'?s main phase\b/.test(head) || EVERY_MAIN_START.test(head);
    case "blockerUsed":
      // "When this card **attacks or activates [Blocker]**" (BT22-027 and its fourteen siblings, #907):
      // the second half of one skill is this moment, as "played or attacks" is `played` and `attacks`
      // (`attacks` reads the first half), so the skill answers to both and an attack is not a block.
      // Phrasing batch 4: the same second moment after a play — "When this card is played **or activates the [blocker]
      // skill**" (P-699), "…played **or its [blocker] skill is activated**" (BT14-125).
      return /when this card activates (?:its )?\[blocker\]|when you activate this card['’]s \[blocker\](?: skill)?|when this card attacks,? or activates (?:its |the |an? )?\[blocker\](?: skill)?|when this card is played,? or (?:(?:this card |it )?activates (?:its |the )?\[blocker\](?: skill)?|its \[blocker\] skill is activated)/.test(t);
    // Both wordings are the same moment: "when **this card** in your life is
    // flipped face up" is the card that was flipped, "when **a** card…" is
    // watched by that player's cards in play. The colour qualifier some of
    // them add is checked in `script.ts`, where the flipping card is known.
    case "flippedFaceUp":
      return /when (?:a|this) card in your life is flipped face up/.test(t);
    // 22: a keyword skill being used, which the cards name by its own bracket.
    case "unionActivated":
      // Phrasing batch 6: "When you activate an [Evolve] **or [Union]** skill" (BT14-094).
      return /when you activate a \[union[^\]]*\](?: skill)?/.test(t) || activatedKeywords(head).includes("union");
    case "unionAbsorbActivated":
      return /when this card'?s \[union-absorb\] is activated/.test(t);
    case "overlordActivated":
      return /when you activate an \[overlord\](?: skill)?/.test(t);
    case "overRealmPlayed":
      return /when you play a battle card using \[over realm\]/.test(t);
    // 12-1-3: "activating an Extra Card" is using its [Activate] or [Counter]
    // skill from the hand, unless the card says otherwise — so "from your
    // hand" (BT29-029) and the bare wording are the same moment. The Extra is
    // the subject, and the description becomes a condition on it, so — like
    // `youPlayed` — one the compiler cannot read whole must not fire at all:
    // "…with an original energy cost of 2 **and the [Field] skill**", "…from
    // your hand **by paying the cost**", "the [Activate: Battle] skill on a red
    // Extra … in your hand **or Drop Area**" are left as gaps.
    case "extraActivatedFromHand":
    case "extraActivated": {
      const m = /^when you activate (?:an?|1) ([^,:]{0,90}?\bextra(?: cards?)?\b[^,:]{0,90}?)(?:,|$)/.exec(head);
      if (!m) return false;
      if ((trigger === "extraActivatedFromHand") !== /\s+from your hand$/.test(m[1])) return false;
      const said = m[1].replace(/\s+from your hand$/, "");
      // "An energy cost of 1 **or** more" is one bound, not two kinds.
      const kinds = said.replace(/\b\d+ or (?:less|fewer|more|greater|higher|lower)\b/g, "");
      // "Original" (20-3-1) is the printed cost: `originalCostMin`/`originalCostMax` read it (#907 round 6).
      // Audit triggers 3: "…with an original energy cost of 2 **and the [Field] skill**" (BT13-061) is a keyword the filter
      // reads (`keywords`); any other bracket is still not read.
      if (/ or |\bby\b|\busing\b|\bwithout\b|\bfrom\b|\bin your\b/.test(kinds) || /\[/.test(kinds.replace(/\b(?:with|and) (?:the )?\[field\](?: skill)?/g, ""))) return false;
      return !parseFilter(effect.unmask(said)).unreadable;
    }
    // Audit triggers 3: "When your opponent activates an Extra Card" (BT10-092, BT10-095): their side of `extraActivated`
    // (12-1-3: activating an Extra Card is using its skill from the hand).
    case "opponentExtraActivated":
      return /^when your opponent activates an? extra(?: card)?(?:,|$)/.test(head);
    // 1-10: the narrower [Alliance] wording just below is read first, so a card
    // that names the keyword is not also caught by this.
    case "restedBySkill":
      return /when this card is switched to rest mode by (?:one of )?your skills?\b/.test(t) || restedCauseOf(head)?.side === "mine";
    // #907: the other two sides of the cause — a skill of either player's, and
    // the opponent's. The skill's card (a colour, a name, a Leader) is asked of
    // the moment's subject by the compiler; here only the side is read.
    case "restedByAnySkill":
      return restedCauseOf(head)?.side === "any";
    case "restedByOpponentSkill":
      return restedCauseOf(head)?.side === "opponent";
    // #907: entering the Energy Area, by the Charge Phase's placing (7-2-11) or a
    // skill's. "From your hand" is the other declaration; "this card in your hand
    // is played or placed" is that one too (the play half is `playedFromHand`).
    // "When **placing** this card in your energy from any area" (DB2-166 …, #907)
    // is the same arrival said as a gerund; "from any area" is no restriction
    // ("from any area" is every area), so it is the bare moment.
    case "placedInEnergy":
      return new RegExp(String.raw`^when this card is (?:placed|added|put) (?:in|into|to) (?:your |its owner'?s )?energy(?: area)?${PLACED_IN_ENERGY_TAIL}`).test(head)
        || PLACING_IN_ENERGY.test(head);
    case "placedInEnergyFromHand":
      return new RegExp(String.raw`^when this card is placed in your energy(?: area)? from your hand${PLACED_IN_ENERGY_TAIL}`).test(head)
        || new RegExp(String.raw`^when this card in your hand is (?:played or )?placed in your energy(?: area)?${PLACED_IN_ENERGY_TAIL}`).test(head);
    // The other end of the same act: your skill resting one of *theirs*,
    // watched by your cards in play. The only printed wording names their
    // Battle Cards and energy, and that is exactly where it is pended.
    case "restedTheirsBySkill":
      return /when (?:one of )?your (?:card )?skills? switch(?:es)? (?:an|your) opponent'?s/.test(head) && /rest mode/.test(head);
    case "restedByAlliance":
      return /when this card is switched to rest mode by (?:an?|one of your)? ?\[alliance\]/.test(t);
    // 1-10-2, 23-5-2-4: the same sentence about Hidden Mode (BT28-116,
    // BT28-119), "in a Battle Area" or not.
    case "hiddenBySkill":
      return /when this card(?: in (?:a|your) battle area)? is switched to hidden mode by (?:one of )?your skills?\b/.test(t);
    // 9-6-9-3: a face-down card's own leave-play [Auto] answers only when it
    // says so — "when this Hidden Mode card in a Battle Area is placed into
    // its owner's Drop" (BT28-117, BT28-118).
    // The same switch with no cause named — any skill, either player's — and
    // "…to Revealed Mode or Hidden Mode", which is both (BT29-116, -121, -122,
    // -125, -142). "By one of your skills" is `hiddenBySkill`'s, not these.
    case "switchedRevealed":
      return /revealed/.test(switchedTo(t));
    case "switchedHidden":
      return /hidden/.test(switchedTo(t));
    // 23-2: a card going into a pile under another (BT29-140).
    case "placedUnder":
      return /when this card is placed under\b/.test(t);
    // Out of the deck or the hand into the Drop (BT29-109) — "in your deck or
    // hand", either order, or just one of them.
    case "deckOrHandToDrop":
      return /when this card in your (?:deck|hand)(?: or (?:deck|hand))? is (?:placed|put|sent) (?:in|into) (?:its owner'?s|your) drop/.test(t);
    // Out of the deck into the Warp by one of *your* skills (3-10, BT30-106):
    // "…by your <Heles> card's skill", "…by one of your skills". Which card's
    // skill is a condition on the subject (`compileSkill`), so the moment is
    // any skill of yours. "By a skill" names either player's and is not this.
    // Phrasing batch 5: "When this card is sent from your Drop Area to your Warp by a skill" (BT12-130, BT12-135): a
    // skill's move, either player's.
    case "dropToWarpBySkill":
      return /^when this card is sent from (?:your|its owner'?s) drop(?: area)? to (?:your|its owner'?s) warp by (?:a|any) skill(?:,|$)/.test(head);
    case "deckToWarpBySkill":
      return /when this card (?:in your deck is sent (?:from your deck )?|is sent from your deck )to (?:your|its owner'?s) warp by (?:one of )?your\b[^,.]{0,60}?\bskills?\b/.test(t);
    case "hiddenToDrop":
      return /when this hidden mode card(?: in (?:a|your) battle area)? is placed (?:in|into) (?:its owner'?s|your|a) drop/.test(t);
    // Audit triggers 1: only the bare moment — "…by your <Gogeta: Br> card's skill" (P-727) names a cause this does not
    // ask, and answered every way of arriving.
    case "addedToZEnergy":
      return /^when this card is added to (?:your )?z-energy(?:,|$)|^when you add this card to your z-energy(?:,|$)/.test(head);
    case "chargeStart":
      return /^at the (?:beginning|start) of (?:your|the|this) (?:turn|charge phase)\b/.test(head);
    case "dealtDamage":
      // Phrasing batch 8: a wording that prints the battle is `dealtBattleDamage`'s or `yourCardDealtBattleDamage`'s.
      return /when this card deals damage|when you deal damage/.test(t) && !DEALT_BATTLE_DAMAGE.test(t) && !YOUR_CARD_DEALT_BATTLE_DAMAGE.test(head.toLowerCase());
    case "dealtBattleDamage":
      return DEALT_BATTLE_DAMAGE.test(t);
    case "battleEnd":
      // "…after you combo with this card" is the combo card's own end of the
      // battle, `comboed` below (#539). Audit triggers 1: what else the words say about the battle is this card's part
      // in it (a condition the compiler keeps) or nothing a reader keeps (`battleEndPart`).
      return /^at the end of (?:the|a|this) battle\b/.test(head) && !COMBO_BATTLE_END.test(head) && battleEndPart(head) !== null;
    case "comboToDrop":
      // Audit triggers 3: "…placed in its owner's Drop" (BT24-025's back) is the same Drop.
      return /^when (?:a|1) card in your combo area is (?:placed|put) (?:in|into) (?:your|its owner'?s) drop(?: area)?\b/.test(head);
    case "comboUsed":
      return comboEntrySelf(sk);
    case "comboed":
      // Keep the old record name for the frozen legacy oracle and confirmed
      // rows. The VM redirects ordinary wording to `comboUsed` at entry.
      return COMBO_BATTLE_END.test(head) || comboEntrySelf(sk);
    // The card the opponent played is the subject, whichever way round the
    // sentence names it. "Plays this card" is never how a card says it.
    case "opponentPlayed":
      // #1015: a play the text says a **skill** made ("uses a skill to play",
      // "plays … using a skill", "using a non-keyword skill") is not every play.
      // `opponentPlayedBySkill` reads the first two; the third (which skills
      // are keywords) and "… using a skill or activates a [Counter] skill" have
      // no moment to ask, and before this fired on every play the opponent made.
      // Audit triggers 1: "When a skill-less Battle Card or skill-less Unison Card is played **in your opponent's Battle
      // Area or Unison Area**" (BT15-122): a card arriving on their side, whoever played it — the subject described.
      { const there = PLAYED_IN_OPPONENTS_AREA.exec(head.toLowerCase()); if (there) return readableSubject(effect, there[1]); }
      return /when your opponent plays (?:a|an|1|up to)\b|when your opponent's [a-z ]*card is played|when a card is played by your opponent/.test(t) && !OPPONENT_SKILL_PLAY_WORDS.test(head.toLowerCase());
    // #1015: "when your opponent uses a skill to play a Battle Card with an
    // energy cost greater than their current energy" (BT15-005, BT15-085,
    // BT15-101) and "when your opponent plays a Battle Card … using a skill"
    // (BT12-132): the opponent's own skill played the subject. A description
    // with an "or" the filter cannot read whole stays a gap, as for `youPlayed`.
    case "opponentPlayedBySkill": {
      const m = /^when your opponent (?:uses an? skill to play|plays) ((?:an?|1|up to \d+|\d+) [^,:]+?)(?: using an? skill)?\s*(?:,|:|$)/.exec(head.toLowerCase());
      if (!m || !OPPONENT_SKILL_PLAY_WORDS.test(head.toLowerCase())) return false;
      const said = expandSharedCardDescription(effect.unmask(m[1]));
      // "using a non-keyword skill", "from their hand": a means or a place the moment cannot tell apart.
      if (/\busing\b|\bfrom\b|\bby\b/.test(said)) return false;
      return !/ or /.test(said.replace(/\b\d+(?: power)? or (?:less|fewer|more|greater|higher|lower)\b/g, "")) || readsOr(said);
    }
    // Your own side of `opponentPlayed`: a card of yours watching another of
    // your cards arrive. Not "this card" — that is `played`, the card's own
    // arrival — and not the opponent's.
    //
    // A trigger that names *how* the card was played ("using [Swap]", "from
    // your life") is left out: the engine cannot check that, and firing on an
    // ordinary play would be worse than not firing. "By a [Union] skill" is
    // the one it checks (#930, below).
    case "youPlayed": {
      const arrival = yourCardPlayedUsingArrival(effect.unmask(momentClause(head)));
      if (arrival) return readableSubject({ unmask: (s) => s }, arrival);
      // #930: "When your <X> card is played by a [Union] skill" (BT22-033,
      // BT25-036 back, P-682), "when you play a Battle Card using a
      // [Union-Fusion] skill" (BT12-122): the means is one the engine checks
      // — the compiler gates the record on the subject's successful [Union]
      // entry (`playedUsing(sel: subject)`, `vm/play.ts`) — so it is this
      // moment, with the same rule for a description the filter cannot read.
      const byUnion = yourCardPlayedByUnion(head.toLowerCase());
      if (byUnion) {
        const said = expandSharedCardDescription(effect.unmask(byUnion.said));
        if (/\bfrom\b|\busing\b|\bby\b|\bin your\b/.test(said)) return false;
        return !/ or /.test(said.replace(/\b\d+(?: power)? or (?:less|fewer|more|greater|higher|lower)\b/g, "")) || readsOr(said);
      }
      if (/when (?:you play this card|this card is played)/.test(t)) return false;
      // Audit triggers 1: "…is played **in your opponent's Battle Area or Unison Area**" (BT15-122) is a card arriving on the
      // other side, whoever played it — not yours, and its "skill-less Battle Card or Unison Card" is not read whole.
      if (/\bis played (?:by|using|from|in (?:your|an) opponent'?s)\b|\bwhen you play [^,]*\b(?:using|from your)\b/.test(t)) return false;
      const spoken = /when you play ((?:an?|1|up to \d+|\d+) [^,]{0,80}?)(?:,|$)/.exec(t);
      const passive = /when (a|an|your) ([^,]{0,120}?)(?:[-—–]\s*)?is played\b/.exec(t);
      if (!spoken && !passive) return false;
      const said = expandSharedCardDescription(spoken ? spoken[1] : `${passive![1]} ${passive![2]}`);
      if (/^your opponent|^(?:an?|one) opponent'?s\b/.test(said)) return false;
      // This fires for *every* card that player plays, and the effect then acts
      // on it — so a description the compiler cannot turn into a filter must
      // not fire at all. "A blue **or** yellow ≪Universe 6≫ card" is the shape
      // that matters: `parseFilter` keeps one colour of the two, so the whole
      // trigger stays an honest gap rather than buffing whatever was played.
      // Since #537 the filter reads "or" between colours, names and whole
      // descriptions (`anyOf`), so an "or" it reads in full no longer stands
      // in the way (XD1-01, owner's card review): only one it cannot read does.
      // Phrasing batch 5: "a blue <Baby> with an energy cost of 4 **or more**" (BT21-066) is one bound, not two kinds.
      return !/ or /.test(said.replace(/\b\d+(?: power)? or (?:less|fewer|more|greater|higher|lower)\b/g, "")) || readsOr(said);
    }
    // #1163: "When your ≪Ginyu Force≫ card is played by this card's skill"
    // (BT29-083): the play this card's own skill made, and no other — the
    // moment carries the playing card (`moved(byWatcher: true)`, `vm/triggers.ts`).
    // As for `youPlayed`, a description the filter cannot read whole does not fire.
    case "youPlayedByThisCard": {
      const m = YOUR_CARD_PLAYED_BY_THIS_CARD.exec(head.toLowerCase());
      if (!m) return false;
      const said = expandSharedCardDescription(effect.unmask(m[1]));
      if (/\bfrom\b|\busing\b|\bin your\b/.test(said)) return false;
      if (/ or /.test(said.replace(/\b\d+(?: power)? or (?:less|fewer|more|greater|higher|lower)\b/g, "")) && !readsOr(said)) return false;
      return !parseFilter(said).unreadable;
    }
    // BT8-089: "When a Battle Card attacks" — any player's, said with nothing else.
    case "battleCardAttacks":
      return /^when a battle card attacks\s*(?:,|:|\.|$)/.test(head.toLowerCase());
    // BT15-091: "When a player places a [Field] Extra Card in a Battle Area" and
    // "When a player's [Field] Extra Card leaves a Battle Area" — either
    // player's card, the description a condition on it, read only when it is
    // read whole (as `yourCardPlaced` is).
    case "aPlayerPlacesInBattle": {
      const m = /^when a player places (?:an?|1) ([^,:]{1,90}?) in a battle area\s*(?:,|:|\.|$)/.exec(head.toLowerCase());
      return !!m && !/ or |\bfrom\b|\bby\b|\busing\b|\bunder\b/.test(m[1]) && !parseFilter(effect.unmask(m[1])).unreadable;
    }
    case "aPlayersCardLeftBattle": {
      const m = /^when a player'?s ([^,:]{1,90}?) leaves? a battle area\s*(?:,|:|\.|$)/.exec(head.toLowerCase());
      return !!m && !/ or |\bfrom\b|\bby\b|\busing\b|\bunder\b/.test(m[1]) && !parseFilter(effect.unmask(m[1])).unreadable;
    }
    case "opponentAttacks":
      // Phrasing batch 4: also as the second moment of a play — "When this card is played **or one of your opponent's
      // cards attacks**" (P-716), "…played **or your opponent attacks**" (BT16-145, BT16-146).
      return /when your opponent attacks\b|when your opponent's [a-z ]*cards? attacks?\b|when one of your opponent's [a-z ]*cards? attacks\b|when (?:this card is played|you play this card),? or (?:when )?(?:your opponent attacks|one of your opponent's [a-z ]*cards? attacks)\b/.test(t)
        && !/when your opponent attacks your .+? with a specified cost of \d+\b/.test(head.toLowerCase())
        && !/when your opponent attacks your leader(?: card)?\s*(?:,|:|\.|$)/.test(head.toLowerCase());
    case "opponentEnergyActiveBySkill":
      return /when your opponent switches energy to active mode using a non-\[awaken\] skill during their turn\b/.test(head.toLowerCase());
    case "opponentOwnEnergyActiveBySkill":
      return /when your opponent switches (?:their )?energy to active mode using a non-\[awaken\] skill during their turn\b/.test(head.toLowerCase());
    // #916: the skill must itself be a [Counter] (a typed cause on the
    // moment, never the source card's other lines), on either player's turn.
    case "opponentOwnEnergyActiveByCounter":
      return /when your opponent switches their energy to active mode using an? \[?counter\]? skill\b/.test(head.toLowerCase());
    // #922: the card's own Rest -> Active switch, said in full.
    case "selfRestToActive":
      return /^when this card is switched from rest mode to active mode\b/.test(head.toLowerCase());
    case "opponentAttacksRedUnison2":
      return /when your opponent attacks your red unison card with a specified cost of 2\b/.test(head.toLowerCase());
    case "opponentCombos":
      // Mechanism batch 3: "When your opponent uses **cards** in a combo" (BT26-044) is the same moment.
      return /when your opponent combos\b|when your opponent uses (?:a card|cards) in a combo\b/.test(t);
    // Your own side of it. "When you combo with this card" is the card's own
    // skill and belongs to `comboUsed`, so the possessive has to be excluded
    // here or every combo card would fire twice.
    case "youCombo":
      // Phrasing batch 3: "When you use **a red skill-less Battle Card with an energy cost of 2** in a combo" (BT14-001b):
      // the same moment, the card used described (the compiler reads the description as a condition on it).
      // Phrasing batch 5: "When you use **one of your** Red/Yellow multicolor ≪God≫ cards in a combo" (BT24-002, BT24-003).
      // Phrasing batch 9: the passive — "When one of your <Son Goku: Xeno> or <Vegeta: Xeno> cards **is used in a combo**"
      // (BT24-112), read when its description is read whole.
      if (YOUR_CARD_USED_IN_COMBO.test(head)) {
        const said = effect.unmask(YOUR_CARD_USED_IN_COMBO.exec(head)![1]);
        return !/\bfrom\b|\busing\b|\bby\b/.test(said) && (!/ or /.test(said) || readsOr(said)) && !parseFilter(said).unreadable;
      }
      // Audit triggers 1: an area the card came from ("…a blue card **from your hand** in a combo", BT19-035; "…from your
      // Battle Area", TB1-025) is not asked of a watched combo: unread, rather than any combo.
      if (/^when you (?:use|combo with) (?:an?|1|one of your) [^,]*?\bfrom (?:your|the|a|an) /.test(head)) return false;
      return (/when you (?:use a card in a combo|combo)\b/.test(t) || /^when you use (?:an?|1|one of your) [^,]+? in a combo\b/.test(head)) && !/when you combo (?:with )?this card/.test(t);
    // 5-5-4: placed in a Battle Area, which a play is too (5-5-1, owner's
    // ruling of 2 Oct 2026) — the engines fire it for both. A skill that says
    // both this and `played` answers a play once (`vm/triggers.ts`,
    // `engine/triggers.ts`'s `pendPlacedOnArrival`).
    case "placed":
      return /when this card is placed in (?:a|the|your|their|an opponent's) battle area/.test(t);
    // The same arrival, about another card: "when a {Scouter} is placed in
    // your Battle Area" (BT23-066), "when one of your blue Z-Extras is placed
    // in a Battle Area" (BT22-032b). Played or placed by a skill alike (5-5-1).
    // The description becomes a condition on the subject, so — like
    // `extraActivated` — one the compiler cannot read whole does not fire at
    // all: an alternative ("a red **or** blue …"), a place it came from or a
    // means ("from your Drop", "by a skill", "using …") are left as gaps.
    case "yourCardPlaced": {
      const m = /^when (?:an?|1|one of your|your) (?!opponent)([^,:]{1,90}?) (?:is|are) placed in (?:your|a) battle area(?:,|$)/.exec(head);
      if (!m || /^this card\b/.test(m[1])) return false;
      const kinds = m[1].replace(/\b\d+ or (?:less|fewer|more|greater|higher|lower)\b/g, "");
      if (/ or |\bfrom\b|\bby\b|\busing\b|\bunder\b|\bwithout\b|\bin your\b/.test(kinds)) return false;
      return !parseFilter(effect.unmask(m[1])).unreadable;
    }
    // EX24-01b: another Unison of yours leaving your Unison Area, to anywhere.
    // The description becomes a condition on the subject as it left, so one
    // the compiler cannot read whole, or a place/means the moment does not
    // tell apart, does not fire at all.
    case "yourUnisonLeft": {
      const m = /^when (?:an?|1|one of your|your) (?!opponent)([^,:]{1,90}?) leaves? (?:your|the) unison area(?:,|$)/.exec(head);
      if (!m || /^this card\b/.test(m[1])) return false;
      if (/ or |\bfrom\b|\bby\b|\busing\b|\bunder\b|\bwithout\b/.test(m[1])) return false;
      return !parseFilter(effect.unmask(m[1])).unreadable;
    }
    case "energyToDrop":
      // Audit conditions 2 review: a cause said after it ("…by one of your skills", XD2-04) is another moment's
      // (`yourEnergyToDropByYou`); read as this one, the opponent's energy burn answered it too.
      // Audit triggers 3: "…a card in your Energy **Area**" (EX19-06) is the same energy.
      return /when a card in your energy(?: area)? is placed in (?:your|its owner's) drop(?! area by\b| by\b)/.test(t);
    case "unisonToDrop":
      return /when this card is placed in (?:a|your|its owner'?s) drop area from (?:a|your) unison area|when this card in a unison area is placed into its owner's drop/.test(t);
    // #930: "When this card is removed from a Unison Area" (BT31-043): this card
    // leaving the Unison Area for any area, by any cause. A cause said after it
    // ("… by a skill") is a narrower moment and is not read here.
    case "removedFromUnison":
      return /^when this card is removed from (?:a|the|your) unison area(?!\s+(?:by|due|because|using|during))(?:,|$)/.test(head.toLowerCase());
    case "markerRemoved":
      // Errata-official-2: "…removed from this card **by a non-keyword skill**" (BT11-064's erratum of 25 Dec 2020)
      // is a narrower moment than any removal — not a [Spirit Boost] price, not an attack (13-5-2) — and the moment
      // says nothing about the cause, so it is not read here (unread rather than firing on every removal).
      if (/when a marker is removed from [^,:]*\bby an? non-keyword skill/.test(t)) return false;
      return /when a marker is removed/.test(t);
    // 22-43-3: paying [Spirit Boost X] takes markers off your Unison. These
    // cards watch for that *cost* rather than for a marker leaving, so an
    // opponent's attack knocking markers off (13-5-2) is not their moment —
    // which is why it is a trigger of its own and not the one above. Both ends
    // of it are printed: the Unison itself ("from this card") and the Battle
    // Cards watching it ("from one of your Unison Cards"). What the watcher
    // says about the Unison ("your **red** Unison Cards", SD15-05, #1169) is a
    // condition on the payer the compiler reads (`spiritBoostPayerOf`).
    case "spiritBoostPaid":
      return /when you remove a marker from (?:this card|(?:one of )?your (?!opponent)(?:[^,:.]{1,80}? )?unison cards?|(?:one of )?your \{\d+\}(?: cards?)?)/.test(t) && /\[spirit boost\]/.test(t);
    case "offenseStart":
      return /^at the (?:beginning|start) of (?:your|the) offense step\b/.test(head);
    case "defenseStart":
      return /^at the (?:beginning|start) of (?:your|the) defense step\b/.test(head);
    case "damageStart":
      return /^at the (?:beginning|start) of (?:your|the) damage step\b/.test(head);
    default:
      return false;
  }
}

// ── moments batch 1 (2 Nov 2026) ─────────────────────────────────────────────

/**
 * Whose skill a printed cause names, and what it says about the skill's card: "by an opponent's skill" (opponent, no
 * card), "by one of your blue card skills" (you, "blue card"), "by your Leader Card's skill" (you, "Leader Card"),
 * "by the skills of a ≪Prison Planet≫ card in any of your areas" (you, the card and its area), "by a Battle Card's
 * skill" (either, "Battle Card"). Lower-case, names masked, as `autoTriggerMatches` reads a head. Null for a cause
 * this does not read whole ("…or by your [Revive] skill", a keyword's skill): no moment is better than a wider one.
 */
export interface MomentCause { side: "any" | "you" | "opponent"; desc: string | null }
export function momentCauseOf(said: string | undefined): MomentCause | null {
  if (said === undefined) return { side: "any", desc: null };
  // The printed case is kept: the description goes on to the target grammar (`filterFor`).
  let s = said.trim().replace(/\s+/g, " ").replace(/[.,]$/, "");
  if (/\bor by\b|\[|\bother than\b/i.test(s)) return null;
  if (/^(?:(?:a|any) skills?|skills|(?:one of )?you or your opponent'?s skills?)$/i.test(s)) return { side: "any", desc: null };
  let side: MomentCause["side"] = "any";
  let m: RegExpExecArray | null;
  const opponent = /^(?:an?|one of your|your|one of their) opponent'?s (.+)$|^an? opponent'?s (.+)$/i;
  const yours = /^(?:one of your|your) (.+)$/i;
  const plain = /^(?:an?|1|one) (.+)$/i;
  const owner = () => {
    if ((m = opponent.exec(s))) { side = "opponent"; s = m[1] ?? m[2]; }
    else if ((m = yours.exec(s))) { side = "you"; s = m[1]; }
    else if ((m = plain.exec(s))) s = m[1];
  };
  // "in any of your areas" says whose and nothing about where (20-7-3); "in any area" says neither.
  const anywhere = () => {
    if (/ in any of your areas$/i.test(s)) { side = "you"; s = s.replace(/ in any of your areas$/i, ""); }
    s = s.replace(/ in any areas?$/i, "");
  };
  const card = (d: string) => d.replace(/\bcards\b/gi, "card");
  // "the skill(s) of X", "a skill on X": X is the card; the skill is the cause either way.
  const of = /^(?:the |an? )?skills? (?:of|on) (.+)$/i.exec(s);
  if (of) {
    s = of[1];
    owner();
    anywhere();
    return { side, desc: card(s) };
  }
  owner();
  if (/^skills?$/i.test(s)) return { side, desc: null };
  // "By your {Soul Punisher, …}" (BT22-039): the card named, its skill understood.
  if (/^\{[^{}]+\}$/.test(s)) return { side, desc: s };
  anywhere();
  const named = /^(.+?)(?:'s)? skills?$/i.exec(s);
  if (!named) return null;
  s = named[1];
  anywhere();
  return { side, desc: card(s) };
}

/** "When this card is discarded from your hand [by …]", "…placed in your Drop from your hand [by …]" (20-7-1). */
const B1_HAND_DROP = /^when this card (?:in your hand is discarded|is discarded from your hand|is placed (?:in|into) (?:your|its owner'?s) drop(?: area)? from your hand)(?: by (.+?))?(?:,|$)/;
/** "When you use one of your yellow <Majin Buu> or yellow <Evil Wizard Babidi> card skills to discard this card from your hand" (BT20-104). */
const B1_USE_TO_DISCARD = /^when you use (.+?) to discard this card from your hand(?:,|$)/;
const B1_DROP_TO_WARP = /^when this card (?:in (?:your|a) drop(?: area)? is sent (?:from (?:your|a) drop(?: area)? )?|is sent from (?:your|a) drop(?: area)? )to (?:your|its owner'?s|a) warp by (.+?)(?:,|$)/;
const B1_OPPONENT_POWER = /^when (?:the power of (?:one of )?your opponent'?s (battle )?cards? is (?:decreased|reduced)|your opponent'?s (battle )?card'?s power is (?:decreased|reduced))( by (?:the skill of one of your battle cards|your battle card'?s skill))?(?:,|$)/;
const B1_PILE_TO_DROP = /^when a card is placed from under this card (?:in|into) (?:its owner'?s|your|a) drop(?: area)? by (.+?)(?:,|$)/;

/**
 * Moments batch 1: the [Auto] moments of the triggerless list of 2 Nov 2026, read off the head (lower-case, names
 * masked). Each names its moment and the printed cause (`cause`, the words after "by"), which the compiler turns into
 * a condition on the moment's subject (the skill's card). An unreadable cause names no moment.
 */
export function momentsBatch1(head: string): { trigger: Trigger; cause?: string; subject?: "battle" | "leader"; sided?: boolean }[] {
  let m: RegExpExecArray | null;
  const bySide = (said: string | undefined, any: Trigger, you: Trigger, opponent: Trigger): { trigger: Trigger; cause?: string; sided?: boolean }[] => {
    const c = momentCauseOf(said);
    if (!c) return [];
    return [{ trigger: c.side === "you" ? you : c.side === "opponent" ? opponent : any, sided: true, ...(said ? { cause: said } : {}) }];
  };
  if ((m = B1_HAND_DROP.exec(head))) return bySide(m[1], "droppedFromHand", "droppedFromHandByYou", "droppedFromHandByOpponent");
  // Audit triggers 1: this card KO'd "by an opponent's attack" (a battle's KO, 8-4-6-2), "by your opponent" (either way),
  // or by a skill — any, yours, an opponent's, or a described card's (BT25-051's "by a <Vegeta> card's skill").
  if ((m = /^when this card is ko'?d by (.+?)(?:,|$)/.exec(head)) && !momentParts(head)) {
    if (/^(?:an? |your |one of your )?opponent'?s (?:battle card'?s )?attacks?$|^an attack$/.test(m[1])) return [{ trigger: "koedByAttack" }];
    if (/^your opponent$/.test(m[1])) return [{ trigger: "koedByOpponent" }];
    return bySide(m[1], "koedBySkill", "koedByYourSkill", "koedByOpponentSkill");
  }
  if ((m = B1_USE_TO_DISCARD.exec(head))) return bySide(m[1], "droppedFromHand", "droppedFromHandByYou", "droppedFromHandByOpponent");
  // 1-10-1: a card switched to Active Mode — any switch, the Charge Phase's included (BT31-029's Q&A) — or by a skill.
  if (/^when this card is switched to active mode(?:,|$)/.test(head)) return [{ trigger: "selfRestToActive" }];
  // The turn qualifies this switch alone, including beside an unrestricted play (EX08-06, EX19-30/31).
  if (/^when this card is switched to active mode by a skill during your turn(?:,|$)/.test(head)) return [{ trigger: "activeBySkillDuringYourTurn" }];
  if ((m = /^when this card is switched to active mode by (.+?)(?:,|$)/.exec(head))) return momentCauseOf(m[1]) ? [{ trigger: "activeBySkill", cause: m[1] }] : [];
  if (/^when your energy is switched (?:from rest mode )?to active mode by (?:a|any) skills?(?:,|$)/.test(head)) return [{ trigger: "yourEnergyActiveBySkill" }];
  if ((m = B1_DROP_TO_WARP.exec(head))) return momentCauseOf(m[1]) ? [{ trigger: "dropToWarpBySkill", cause: m[1] }] : [];
  // 5-6: power changed by a skill's effect.
  if ((m = /^when this card'?s power is increased by (.+?)(?:,|$)/.exec(head))) {
    const said = m[1].replace(/ during your turn$/, "");
    return momentCauseOf(said) ? [{ trigger: "powerRaisedBySkill", cause: said }] : [];
  }
  if (/^when this card'?s power is (?:decreased|reduced) by (?:a|any) skills?(?:,|$)/.test(head)) return [{ trigger: "powerLoweredBySkill" }];
  if (/^when your card'?s power is increased by one of your skills(?:,|$)/.test(head)) return [{ trigger: "yourCardPowerRaisedByYou" }];
  if (/^when your leader(?: card)?'?s power is (?:decreased|reduced)(?: by (?:a|any) skills?)?(?:,|$)/.test(head)) return [{ trigger: "yourCardPowerLowered", subject: "leader" }];
  if ((m = B1_OPPONENT_POWER.exec(head))) return [{ trigger: m[3] ? "opponentCardPowerLoweredByBattleCard" : "opponentCardPowerLowered", ...(m[1] || m[2] ? { subject: "battle" as const } : {}) }];
  if ((m = /^when the power of one of you or your opponent'?s (battle )?cards is (?:decreased|reduced)(?:,|$)/.exec(head))) return [{ trigger: "eitherCardPowerLowered", ...(m[1] ? { subject: "battle" as const } : {}) }];
  // A skill's move out of the deck into the Drop; "and you don't have a Unison Card in play" (SD14-02) rides on it.
  if ((m = /^when this card is placed (?:in|into) (?:your|its owner'?s) drop(?: area)? from your deck(?: by (.+?))?(?: and [^,]+)?(?:,|$)/.exec(head))) return bySide(m[1], "deckToDropBySkill", "deckToDropByYou", "deckToDropBySkill");
  if (/^when this card is revealed from the top of your deck and placed (?:in|into) (?:your|its owner'?s) drop(?: area)?(?:,|$)/.test(head)) return [{ trigger: "revealedTopToDrop" }];
  // 23-2: a pile.
  if (/^when (?:a|1) card under this card is return(?:ed)? to (?:its owner'?s|your) hand(?:,|$)/.test(head)) return [{ trigger: "underReturnedToHand" }];
  if ((m = /^when this card is placed from under (?:an? |1 )?card (?:in|into) (?:its owner'?s|your|a) drop(?: area)? by (.+?)(?:,|$)/.exec(head))) return momentCauseOf(m[1]) ? [{ trigger: "underToDropBySkill", cause: m[1] }] : [];
  if (/^when your leader(?: card)?'?s skill places this card in (?:a|your|its owner'?s) drop(?: area)? from under your leader(?: card)?(?:,|$)/.test(head)) return [{ trigger: "underLeaderToDropBySkill", cause: "your leader's skill" }];
  if ((m = B1_PILE_TO_DROP.exec(head))) return momentCauseOf(m[1]) ? [{ trigger: "pileToDropBySkill", cause: m[1] }] : [];
  // A skill's move out of the Energy Area into the Drop.
  if ((m = /^when this card (?:in your energy(?: area)? is placed|is placed from your energy(?: area)?) (?:in|into) (?:your|its owner'?s|a) drop(?: area)? by (.+?)(?:,|$)/.exec(head))) return momentCauseOf(m[1]) ? [{ trigger: "energyToDropBySkill", cause: m[1] }] : [];
  if (/^when (?:one of your energy|a card in your energy(?: area)?) is placed (?:in|into) your drop(?: area)? by your leader(?: card)?'?s skill(?:,|$)/.test(head)) return [{ trigger: "yourEnergyToDropByYourLeader" }];
  // Audit conditions 2 review: "…by one of your skills" (XD2-01's back, XD2-04): any skill of yours, not the opponent's.
  if (/^when (?:one of your energy|a card in your energy(?: area)?) is placed (?:in|into) your drop(?: area)? by (?:one of )?your skills?(?:,|$)/.test(head)) return [{ trigger: "yourEnergyToDropByYou" }];
  // 3-1: from a Battle Area by one of your skills; and the Drop reached from anywhere by a skill.
  if (/^when this card (?:in (?:your|a) battle area is placed (?:in|into) (?:your|its owner'?s|a) drop(?: area)?|is placed (?:in|into) (?:your|its owner'?s|a) drop(?: area)? from (?:a|your|the) battle area) by (?:one of )?your skills?(?:,|$)/.test(head)) return [{ trigger: "droppedFromBattleByYou" }];
  if ((m = /^when this card is placed (?:in|into) (?:your|its owner'?s|a) drop(?: area)? by (.+?)(?:,|$)/.exec(head))) return bySide(m[1], "toDropBySkill", "toDropByYou", "toDropByOpponent");
  return [];
}

// ── audit triggers 1 (2 Nov 2026): one sentence, several moments ────────────

/** The verb a card's moment starts with after its subject ("this card", "your red Z-Card", "your opponent"). */
const MOMENT_VERB = /^(?:(?:is|are|gets) )?(?:attacks?|attacked|activates?|kos|ko'?s|ko'?d|used|played|plays|placed|removed|discarded|sent|returned|switched|leaves|deals|evolves|added|revealed)\b/;
/** A whole moment said after "or": a "when …" of its own or a timing ("at the end of your opponent's turn"). */
const MOMENT_START = /^(?:when |at the (?:end|start|beginning) of )/;
/** A new subject after "or": "…or your opponent plays a Battle Card", "…or one of your <Goku Black> is added …", "…or it attacks". */
const MOMENT_SUBJECT = /^(?:your opponent (?=plays?\b|attacks?\b|activates?\b|uses?\b|combos?\b)|one of your (?![^,]*\bskills?\b)|it |this card )/;
/** Said alone after its subject, a participle takes its "is" back: "KO'd or removed …" is "is removed …". */
const PARTICIPLE = /^(?:attacked|used|played|placed|removed|discarded|sent|returned|switched|added|revealed|ko'?d)\b/;

/** Top-level positions in `s` (outside <…>, ≪…≫, […], (…)) where `at(i)` holds. */
function topLevel(s: string, at: (i: number) => boolean): number[] {
  const out: number[] = [];
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "<" || c === "≪" || c === "[" || c === "(") depth++;
    else if (c === ">" || c === "≫" || c === "]" || c === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && at(i)) out.push(i);
  }
  return out;
}
const nextMoment = (rest: string) => MOMENT_VERB.test(rest) || MOMENT_START.test(rest) || MOMENT_SUBJECT.test(rest);

/**
 * The moment clause of a head: up to its first comma or colon, read on past ", or" when another moment follows
 * ("When this card attacks, or activates the [Blocker] skill" BT25-066; "At the end of your turn, or when this card
 * activates its [blocker] skill" BT13-018).
 */
function momentClause(head: string): string {
  const cut = topLevel(head, (i) => (head[i] === "," || head[i] === ":" || (head[i] === "." && /^\.\s/.test(head.slice(i)))) && !(head[i] === "," && /^,\s*or\s/.test(head.slice(i)) && nextMoment(head.slice(i).replace(/^,\s*or\s+/, ""))) && !listComma(head, i));
  return (cut.length ? head.slice(0, cut[0]) : head).trim().replace(/[.]$/, "");
}

/**
 * Audit triggers 3: a comma inside a list of names — "When your mono-blue <Raditz>**,** <Vegeta>**,** or <Nappa> card is
 * played" (BT23-042), "When you use a black ≪Evil Wizard≫**,** ≪Demon Realm Race≫**,** or ≪Demon God≫ card in a combo"
 * (BT12-142) — is the description's, not the end of the moment: a name before it and a name (or "or"/"and" and a
 * name) after it. The clause splitter already keeps such lists whole; cut there, the moment was "when your mono-blue
 * <raditz>", which names nothing.
 */
function listComma(head: string, i: number): boolean {
  return head[i] === "," && /[>≫}]$/.test(head.slice(0, i)) && /^,\s+(?:(?:or|and)\s+)?[<≪{]/.test(head.slice(i));
}

/**
 * Audit triggers 1: a head that coordinates several moments — "When this card **attacks or is attacked**" (BT2-042),
 * "…**is KO'd or removed** from your Battle Area by an opponent's skill" (BT23-056), "When **your opponent plays a card
 * or attacks**" (BT21-021), "When this card attacks **or your opponent plays a Battle Card**" (BT4-016), "When your
 * opponent plays a card **or at the end of your opponent's turn**" (BT21-074) — as the moments said one by one, each a
 * whole head ("when this card is attacked"): the subject said once in front is said again before each predicate after
 * it (9-6-2: one skill, a moment for each; only one of them happens at a time). Lower case, names masked, as
 * `autoTriggerMatches` reads a head; `null` for a head that names one moment.
 *
 * "When you play this card or use it in a combo / combo with it [from your hand]" (EB1-64, P-169) is the same pair as
 * "when this card is played or used in a combo [from your hand]"; a place said after the last predicate is that
 * predicate's ("…or used in a combo from your hand": the combo; R-133).
 */
export function momentParts(head: string): string[] | null {
  let clause = momentClause(head).replace(TURN_THEN_WHEN, "");
  // "…would be placed in your Drop Area or …" (SD12-01, BT20-141) is a replacement's wording (9-10), no moment: the
  // split re-said it as "would be is placed …", a head that is neither.
  if (/\bwould\b/.test(clause)) return null;
  clause = clause.replace(/^when you play this card,? or (?:when you )?(?:use it in a combo|combo with it|use this card in a combo|combo with this card)\b/, "when this card is played or used in a combo");
  // Audit triggers 2: two subjects of one predicate — "When this card **or an opponent's card** is played" (BT27-085),
  // "When this card **or one of your opponent's cards** attacks" (BT11-012), "…**or your opponent** attacks" (BT21-149):
  // the predicate said of each, and each of those split again where it coordinates moments of its own.
  const either = /^when this card or (?=\S)/.exec(clause);
  if (either) {
    const body = clause.slice(either[0].length);
    const at = topLevel(body, (i) => i > 0 && body[i - 1] === " " && MOMENT_VERB.test(body.slice(i)))[0];
    if (at === undefined) return null;
    const other = body.slice(0, at).trim();
    if (!/^(?:your|one of your|an?|1|an opponent'?s)\b/.test(other)) return null;
    const pred = body.slice(at);
    const mine = `when this card ${/^plays?\b/.test(pred) ? "" : pred.replace(/^are\b/, "is")}`;
    const theirs = `when ${other} ${pred}`;
    if (mine === "when this card ") return null;
    return [...(momentParts(mine) ?? [mine]), ...(momentParts(theirs) ?? [theirs])];
  }
  let subject: string, rest: string;
  const self = /^when (this card(?: in (?:your|a) (?:hand|battle area|drop(?: area)?|energy(?: area)?|deck or hand|hand or deck))?) (.+)$/.exec(clause);
  if (self) [subject, rest] = [self[1], self[2]];
  else if (/^at the (?:end|start|beginning) of /.test(clause)) [subject, rest] = ["", clause];
  else {
    const start = /^when (?=\S)/.exec(clause);
    if (!start) return null;
    const body = clause.slice(start[0].length);
    // The subject runs to the first verb that starts a moment ("your opponent's battle card | is played or attacks").
    const at = topLevel(body, (i) => i > 0 && body[i - 1] === " " && MOMENT_VERB.test(body.slice(i)))[0];
    if (at === undefined) return null;
    [subject, rest] = [body.slice(0, at).trim(), body.slice(at)];
    if (!/^(?:your|one of your|an?|1|an opponent'?s)\b/.test(subject)) return null;
  }
  const splits = topLevel(rest, (i) => / or $/.test(rest.slice(Math.max(0, i - 4), i)) && rest[i - 1] === " " && rest[i] !== " " && nextMoment(rest.slice(i)));
  if (!splits.length) return null;
  const pieces: string[] = [];
  let from = 0;
  for (const at of splits) {
    pieces.push(rest.slice(from, at).replace(/,?\s+or\s+$/, "").trim());
    from = at;
  }
  pieces.push(rest.slice(from).trim());
  const whole = (piece: string, first: boolean): string | null => {
    if (MOMENT_START.test(piece)) return piece.replace(/^when (?:it|this card) /, "when this card ");
    if (/^(?:it|this card) /.test(piece)) return `when this card ${piece.replace(/^(?:it|this card) /, "")}`;
    if (/^(?:your opponent|one of your)\b/.test(piece)) return `when ${piece}`;
    if (!subject) return first ? piece : null;
    const card = subject !== "your opponent";
    return `when ${subject} ${card && PARTICIPLE.test(piece) ? `is ${piece}` : piece}`;
  };
  const parts = pieces.map((p, i) => whole(p, i === 0));
  return parts.some((p) => p === null || !p.trim()) ? null : (parts as string[]);
}

/**
 * The moments of a coordinated head, each said alone as the skill it would be (for the trigger readers): `null` for a
 * head that names one moment. Names are put back, so a description is read as printed.
 */
export function momentPartSkills(sk: Skill): Skill[] | null {
  if (sk.kind !== "auto") return null;
  const effect = maskNames(sk.effect);
  const head = effectHead(effect.text).replace(/^\([^()]*\)\s*/, "").replace(TURN_THEN_WHEN, "");
  const parts = momentParts(head);
  return parts ? parts.map((part) => ({ ...sk, keyword: null, cost: "", effect: `${effect.unmask(part)}, .` })) : null;
}

/**
 * "When this card is played **or** …" (BT31-015, #940; #960) names two moments,
 * and the `played` half is all a reader that stops at "when this card is played"
 * sees: the other half was dropped with the rest of the trigger clause and the
 * program read clean. The alternatives the engine can place are each trigger's
 * own wording above — leaving play (`removedFromBattle`, `removedByOpponent`,
 * `koed`), the attack (`attacks`), a mode switch (`switchedRevealed`,
 * `switchedHidden`) and a combo entry (`comboUsed`). This is true when the
 * head coordinates "played or" with something else, or qualifies the play in a
 * way no reader keeps ("using [Union-Potara]"), so the compiler refuses the
 * clause (an unread gap) instead of keeping half of it.
 */
const PLAYED_COORDINATED = /^when (?:this card (?:in your hand )?is played|you play this card)((?: from your hand| using \[[^\]]*\])?)\s*,?\s+or\s+(?:when\s+)?([\s\S]*)$/;
/** Exact coordinated head: the qualified switch is a separate typed moment, never a condition on the play. */
export function playedOrActiveDuringYourTurn(sk: Skill): boolean {
  return sk.kind === "auto" && /^when (?:you play this card|this card is played),? or when this card is switched to active mode by a skill during your turn(?:,|$)/.test(effectHead(maskNames(sk.effect).text));
}
/** R-485: only the represented unqualified pair or Hand-qualified pair. */
export function playedOrComboBattleEnd(sk: Skill): boolean {
  if (sk.kind !== "auto") return false;
  const head = effectHead(maskNames(sk.effect).text);
  const hand = /^when this card is played from your hand,? or at the end of a battle (?:in which|where) this card was used in a combo from your hand(?:,|$)/.test(head);
  const plain = /^when this card is played or at the end of a battle in which this card was used in a combo(?:,|$)/.test(head);
  if (!hand && !plain) return false;
  const combo = compileComboQualification(sk);
  const parts = momentPartSkills(sk) ?? [];
  return combo?.timing === "battleEnd" && combo.subject === "self" && combo.turn === "any"
    && (hand ? combo.origins?.length === 1 && combo.origins[0] === "hand" : combo.origins === null)
    && parts.some(part => autoTriggerMatches(part, hand ? "playedFromHand" : "played"))
    && parts.some(part => autoTriggerMatches(part, "comboed"));
}
export function playedOrUnplacedAlternative(sk: Skill): boolean {
  if (sk.kind !== "auto") return false;
  const head = effectHead(maskNames(sk.effect).text);
  const m = PLAYED_COORDINATED.exec(head);
  if (!m) return false;
  const [, qualifier, rest] = m;
  if (playedOrActiveDuringYourTurn(sk)) return !autoTriggerMatches(sk, "activeBySkillDuringYourTurn");
  if (playedOrComboBattleEnd(sk)) return false;
  // A qualifier on the play that `played` would ignore: only "from your hand"
  // and "using [Over Realm]" have readers of their own.
  if (/^ using \[/.test(qualifier) && !/^ using \[(?:dark )?over realm/.test(qualifier)) return true;
  // "…using [Over Realm] or [Dark Over Realm]" and "…from your hand or Drop
  // Area" are one moment with two ways of arriving, not two moments.
  if (/^\[(?:dark )?over realm\]/.test(rest) || (qualifier && /^(?:your )?(?:drop|warp|deck|hand|energy)\b/.test(rest))) return false;
  if (/^(?:this card |it )?attacks\s*(?:,|:|\.|$)/.test(rest)) return !autoTriggerMatches(sk, "attacks");
  // Phrasing batch 4: an opponent's attack and this card's [Blocker], each a moment of its own (`opponentAttacks`,
  // `blockerUsed`), beside the play.
  if (/^(?:your opponent attacks|one of your opponent's [a-z ]*cards? attacks)\s*(?:,|:|\.|$)/.test(rest)) return !autoTriggerMatches(sk, "opponentAttacks");
  if (/^(?:(?:this card |it )?activates (?:its |the )?\[blocker\](?: skill)?|its \[blocker\] skill is activated)\s*(?:,|:|\.|$)/.test(rest)) return !autoTriggerMatches(sk, "blockerUsed");
  if (/^(?:used|use|combo)\b/.test(rest)) return false;
  // #969: a skill's discard (`droppedFromHand`), and a skill's move from a Battle Area to the Drop (`droppedFromBattle`).
  if (/^(?:(?:it|this card) is )?discarded by\b/.test(rest)) return !autoTriggerMatches(sk, "droppedFromHand") || (discardedBySkillCause(head) === null);
  if (/^(?:it|this card) is placed in (?:a|your|its owner'?s|the) drop area from\b/.test(rest)) return !autoTriggerMatches(sk, "droppedFromBattle");
  // #907: the Rest half of "played or switched to Rest Mode by …" and the energy half of "played or placed in your energy".
  if (/^switched (?:from active mode )?to rest mode\b/.test(rest)) return restedCauseOf(head) === null || !(["restedBySkill", "restedByAnySkill", "restedByOpponentSkill"] as const).some((t) => autoTriggerMatches(sk, t));
  if (/^placed in your energy\b/.test(rest)) return !autoTriggerMatches(sk, "placedInEnergyFromHand");
  if (/^switched to (?:revealed|hidden) mode\b/.test(rest)) return !(["switchedRevealed", "switchedHidden"] as const).some((t) => autoTriggerMatches(sk, t));
  if (/^(?:this card|it) is placed in (?:a|the|your|their|an opponent's) battle area\b/.test(rest)) return !autoTriggerMatches(sk, "placed");
  // Audit triggers 3: "…or sent to its owner's Warp by a skill" (BT31-021) is a moment of its own (`toWarpBySkill`, `toWarp`).
  if (/^sent to (?:its owner'?s|your|the|a) warp(?: by (?:a|any) skill)?\s*(?:,|:|\.|$)/.test(rest)) return false;
  if (/^(?:removed from|placed in (?:a|your|its owner'?s|the) (?:drop|warp)|sent |returned |ko'?d|put )/.test(rest))
    return !(["removedFromBattle", "removedByOpponent", "koed"] as const).some((t) => autoTriggerMatches(sk, t));
  return true;
}

/** Compile-time only: the executable record owns these facts after drafting. */
export function compileComboQualification(whole: Skill): ComboQualification | null {
  if (whole.kind !== "auto") return null;
  // Audit triggers 1: in a coordinated head ("When this card attacks or is used in a combo from your hand") the combo is
  // one of the moments, and what it says about the combo is said in that moment alone.
  const sk = momentPartSkills(whole)?.find((p) => comboBattleEndSelf(p) || comboEntrySelf(p)) ?? whole;
  const end = comboBattleEndSelf(sk);
  if (!end && !comboEntrySelf(sk)) return null;
  const head = effectHead(maskNames(whole.effect).text);
  const turn = /\bduring your opponent'?s turn\b/.test(head) ? "opponent"
    : /\bduring your turn\b/.test(head) ? "controller" : "any";
  const entry = comboEntryQualifier(sk);
  const origins = end ? comboBattleEndOrigins(sk) : comboEntryOrigins(sk);
  return { version: 1, timing: end ? "battleEnd" : "entry", subject: "self",
    origins: origins ? [...origins] : null,
    turn, ...(entry?.viaSkillOf ? { viaSkillOf: entry.viaSkillOf } : {}) };
}

/**
 * 22-43-3, #1169: "When you remove a marker from one of your **red** Unison
 * Cards using a [Spirit Boost] skill" (SD15-05) — the Unison the markers came
 * off is the moment's subject, and what the watcher says about it is a
 * condition on that subject. Returns the description as printed ("red Unison
 * Cards", "{SS Cabba, Spirit Resonance}"), or null when the trigger is not a
 * watcher of another Unison's payment ("from this card" has no description).
 */
const SPIRIT_BOOST_PAYER = /^when you remove (?:a marker|markers) from (?:one of )?your (?!opponent)(.+?) using an? \[spirit boost\] skill[,.]?$/i;
export function spiritBoostPayerOf(trigger: string): string | null {
  const names = maskNames(trigger.trim());
  const m = SPIRIT_BOOST_PAYER.exec(names.text);
  return m ? names.unmask(m[1]).trim() : null;
}

// ── audit triggers 2 (3 Nov 2026): the watched-card moment grammar ──────────

/** Whose card a watched moment is about, as its subject phrase says it. "a" waits for the area the sentence names. */
type WatchedWhose = "you" | "opponent" | "both" | "a";
const WATCHED_WHOSE: readonly [RegExp, WatchedWhose][] = [
  [/^when (?:one of |1 of )?your opponent'?s /, "opponent"],
  [/^when (?:an?|1|one) opponent'?s /, "opponent"],
  [/^when (?:you or your opponent'?s|your or your opponent'?s|a player'?s) /, "both"],
  [/^when (?:one of |1 of )?your (?!opponent\b|leader'?s\b|leader card'?s\b|life\b|energy\b|skills?\b|deck\b|hand\b)/, "you"],
  [/^when (?:an?|1) (?!opponent\b|player\b|card (?:in|from|is|under)\b|skill\b)/, "a"],
  // A card named and nothing more ("When {Fateful Reunion Son Goku} is played in your Battle Area", TB2-037).
  [/^when (?=\{\d+\} )/, "a"],
];
/**
 * The active voice, said as the passive the events are read in: "when you play X …" is "when your X is played …",
 * "when your opponent plays X" is "when your opponent's X is played", "when you attack with X" is "when your X
 * attacks", "when you or your opponent play X" is either player's X played, "when a player attacks" is either
 * player's card attacking.
 */
const WATCHED_ACTIVE: readonly [RegExp, string, "played" | "attacks" | "combo" | "zEnergy" | ""][] = [
  [/^when you play (?:an?|1|one) (?!card\b)/, "when your ", "played"],
  [/^when you play (?=\{\d+\}|<[^>]+>)/, "when your ", "played"],
  [/^when your opponent plays (?:an?|1|one) /, "when your opponent's ", "played"],
  [/^when you or your opponent plays? (?:an?|1|one) /, "when you or your opponent's ", "played"],
  [/^when you attack with (?:an?|1|one) (?!card\b)/, "when your ", "attacks"],
  [/^when a player attacks$/, "when a player's card attacks", ""],
  // Audit triggers 3: "When you use a black ≪Evil Wizard≫, … card in a combo" (BT12-142) is "…is used in a combo"; "When
  // you or your opponent uses a card with <Son Goku> in its character name in a combo" (BT26-111) is either player's;
  // "When you add one of your yellow cards to your Z-Energy" (SD22-07) is "…is added to your Z-Energy".
  [/^when you use (?:an?|1|one of your) (?!opponent)(?!card in a combo$)(?=.+ in a combo$)/, "when your ", "combo"],
  [/^when you or your opponent uses? (?:an?|1|one) (?=.+ in a combo$)/, "when you or your opponent's ", "combo"],
  [/^when you add (?:one of your|an?|1) (?=.+ to your z-energy$)/, "when your ", "zEnergy"],
];
/**
 * What happened to the card: the event, with its cause or origin where the sentence names one, and the Battle Area it
 * names (whose it is says whose the card was). Each reads the whole rest of the moment clause after the description.
 */
type WatchedEvent = "removedBySkill" | "removedByOpponent" | "leftBattle" | "koed" | "koedByOpponentSkill" | "koedByYourSkill" | "koedByOpponent"
  | "kosByAttack" | "attacked" | "attacks" | "unisonToDrop" | "played" | "playedFromHand" | "playedFromDrop" | "playedFromWarp" | "playedFromEnergy" | "playedFromLife"
  | "restedByYou" | "restedBySkill" | "evolveFromHand" | "exEvolveFromHand" | "swap"
  | "usedInCombo" | "toZEnergy" | "comboToDrop" | "battleToDrop";
const BATTLE_AREA = String.raw`(?:a|the|(your|their)) battle area`;
const WATCHED_EVENTS: readonly { re: RegExp; event: WatchedEvent }[] = [
  { re: new RegExp(String.raw` (?:is|are) removed from ${BATTLE_AREA} by (?:a|any) skills?$`), event: "removedBySkill" },
  { re: new RegExp(String.raw` (?:is|are) removed from ${BATTLE_AREA} by (?:(?:an? |one of )?(?:your )?opponent'?s?(?: card'?s?)? skills?|one of their skills)$`), event: "removedByOpponent" },
  // No cause: any departure (BT28-066's Q&A: a token used in a combo from the Battle Area was removed from it).
  { re: new RegExp(String.raw` (?:(?:is|are) removed from|leaves?) ${BATTLE_AREA}$`), event: "leftBattle" },
  { re: / (?:is|are) ko'd$/, event: "koed" },
  { re: / (?:is|are) ko'd by (?:an? |your |one of your )?opponent'?s (?:card'?s? )?skills?$/, event: "koedByOpponentSkill" },
  { re: / (?:is|are) ko'd by (?:one of )?your skills?$/, event: "koedByYourSkill" },
  { re: / (?:is|are) ko'd by (?:your|an?) opponent$/, event: "koedByOpponent" },
  { re: / attacks? and kos? (?:an? |one of your |your )?opponent'?s battle cards?$/, event: "kosByAttack" },
  { re: / (?:is|are) attacked$/, event: "attacked" },
  { re: / attacks?$/, event: "attacks" },
  { re: / (?:is|are) placed (?:in|into) (?:your|its owner'?s) drop(?: area)?$/, event: "unisonToDrop" },
  { re: / (?:is|are) played(?: in (your) battle area)?$/, event: "played" },
  { re: / (?:is|are) played from (your) hand$/, event: "playedFromHand" },
  { re: / (?:is|are) played from (your) drop(?: area)?$/, event: "playedFromDrop" },
  { re: / (?:is|are) played from (your) warp$/, event: "playedFromWarp" },
  { re: / (?:is|are) played from (your) energy(?: area)?$/, event: "playedFromEnergy" },
  { re: / (?:is|are) played from (your) life$/, event: "playedFromLife" },
  { re: / (?:is|are) switched (?:from active mode )?to rest mode by (?:one of )?your (?:card )?skills?$/, event: "restedByYou" },
  { re: / (?:is|are) switched to rest mode by (?:a|any) skills?$/, event: "restedBySkill" },
  // 22-5-2: an [Evolve] is activated from the hand; an [EX-Evolve] from the hand or the Z-Energy (only the hand is read).
  { re: / activates? (?:an? |the )?\[evolve\](?: skill)?(?: from your hand)?$/, event: "evolveFromHand" },
  { re: / activates? (?:an? |the )?\[ex-evolve\](?: skill)? from (your) hand$/, event: "exEvolveFromHand" },
  { re: / activates? (?:an? |the )?\[swap\](?: skills?)?$/, event: "swap" },
  // Audit triggers 3: used in a combo (5-7), added to the Z-Energy (17-3), and placed in the Drop from the Combo Area.
  { re: / (?:is|are) used in a combo$/, event: "usedInCombo" },
  { re: / (?:is|are) added to (?:your|its owner'?s) z-energy$/, event: "toZEnergy" },
  { re: / (?:is|are) placed (?:in|into) (your) drop(?: area)? from your combo area$/, event: "comboToDrop" },
];
/** The declared moments for each (side, event): one table, so a new wording of a known moment costs a row, not a reader. */
const WATCHED_MOMENT: Record<WatchedEvent, Partial<Record<"you" | "opponent" | "both", Trigger[]>>> = {
  removedBySkill: { you: ["yourCardRemovedBySkill"], opponent: ["opponentCardRemovedBySkill"] },
  removedByOpponent: { you: ["yourCardRemovedByOpponent"] },
  leftBattle: { you: ["yourCardLeftBattle"] },
  koed: { you: ["yourCardKoed"], opponent: ["opponentCardKoed"] },
  koedByOpponentSkill: { you: ["yourCardKoedByOpponentSkill"] },
  koedByYourSkill: { you: ["yourCardKoedByYourSkill"], opponent: ["opponentCardKoedByYourSkill"] },
  koedByOpponent: { you: ["yourCardKoedByOpponent"] },
  kosByAttack: { you: ["yourCardKosByAttack"] },
  attacked: { you: ["yourCardAttacked"] },
  // 8-1-3: either player's attack is two moments of the engine, one for each side; only one happens at a time.
  attacks: { you: ["yourCardAttacks"], opponent: ["opponentAttacks"], both: ["yourCardAttacks", "opponentAttacks"] },
  unisonToDrop: { you: ["yourUnisonToDrop"] },
  played: { you: ["youPlayed"], opponent: ["opponentPlayed"], both: ["eitherCardPlayed"] },
  playedFromHand: { you: ["yourCardPlayedFromHand"] },
  playedFromDrop: { you: ["yourCardPlayedFromDrop"] },
  playedFromWarp: { you: ["yourCardPlayedFromWarp"] },
  playedFromEnergy: { you: ["yourCardPlayedFromEnergy"] },
  playedFromLife: { you: ["yourCardPlayedFromLife"] },
  restedByYou: { opponent: ["opponentCardRestedByYourSkill"] },
  restedBySkill: { you: ["yourBattleCardRestedBySkill"], opponent: ["opponentBattleCardRestedBySkill"] },
  evolveFromHand: { you: ["evolveActivated"] },
  exEvolveFromHand: { you: ["yourCardExEvolveFromHand"] },
  swap: { you: ["swapActivated"] },
  usedInCombo: { you: ["youCombo"], opponent: ["opponentCombos"], both: ["youCombo", "opponentCombos"] },
  toZEnergy: { you: ["yourCardToZEnergy"], opponent: ["opponentCardToZEnergy"] },
  // Review of audit triggers 3 (R-280): "…is placed in your Drop Area from your Combo Area, you may play it from your
  // Drop Area" (BT12-085) is the move as it happens (8-5-8), so the card is in the Drop when its Auto resolves — not
  // 8-5-6's advance notice of "a card in your Combo Area" (`comboToDrop`, BT24-025), which resolves before the move.
  comboToDrop: { you: ["yourCardComboToDrop"] },
  // Audit triggers 3: "When {King Vegeta's Dynasty} in your Battle Area is placed in its owner's Drop Area" — any card's.
  battleToDrop: { you: ["yourCardBattleToDrop"] },
};

/**
 * Audit triggers 2: a watched card's moment read as subject × event × cause — "When one of your ≪Red Ribbon Army≫
 * cards is removed from your Battle Area by a skill" (BT17-038), "When an opponent's Battle Card is KO'd by one of your
 * skills" (BT24-008), "When one of your green Battle Cards attacks and KOs an opponent's Battle Card" (BT16-050), "When
 * a ≪Universe 7≫ <Son Goku> card in your Battle Area is attacked" (SD21-03), "When one of your green Unison Cards is
 * placed in your Drop Area" (BT17-069), "When a black Battle Card is played from your Warp" (BT16-110), "When you play
 * a blue Battle Card from your Drop Area" (BT14-034). The subject phrase says whose card it is ("your", "one of your
 * opponent's", "an opponent's", "a player's"; "a … in your Battle Area", "a … removed from / played from your …" is
 * yours), the rest of the clause what happened to it, from where, and who caused it; `WATCHED_MOMENT` names the
 * declared moments for the pair, and the description is returned as said (lower case, names put back) — a condition
 * on the card the moment hands on (`subjectFilterOf`), asked before the Auto is pended (`vm/triggers.ts`). `null` for
 * any other clause.
 */
export function watchedMomentOf(text: string): { triggers: Trigger[]; said: string } | null {
  const masked = maskNames(text.trim());
  let clause = momentClause(masked.text.toLowerCase().replace(TURN_THEN_WHEN, ""));
  // Audit triggers 3: a keyword's move, watched (`watchedKeywordMove`) — a watched card's moment where it describes the card.
  const move = watchedKeywordMove(clause);
  if (move) return move.said ? { triggers: move.triggers, said: masked.unmask(move.said) } : null;
  // …and a card's move between areas (`zoneMoveOf`), likewise.
  const zone = zoneMoveOf(clause);
  if (zone) return zone.said ? { triggers: [zone.trigger], said: masked.unmask(zone.said) } : null;
  for (const [re, voice, verb] of WATCHED_ACTIVE) {
    if (!re.test(clause)) continue;
    clause = clause.replace(re, voice);
    if (verb === "combo") clause = clause.replace(/ in a combo$/, " is used in a combo");
    else if (verb === "zEnergy") clause = clause.replace(/ to your z-energy$/, " is added to your z-energy");
    else if (verb) {
      // "…X from your Drop Area" / "…X in your Battle Area" after "you play": the place is the play's.
      const place = verb === "played" ? / (?:from your (?:hand|drop|warp|energy|life)(?: area)?|in your battle area)$/.exec(clause)?.[0] ?? "" : "";
      clause = `${clause.slice(0, clause.length - place.length)} ${verb === "played" ? "is played" : "attacks"}${place}`;
    }
    break;
  }
  const whose = WATCHED_WHOSE.find(([re]) => re.test(clause));
  if (!whose) return null;
  const rest = clause.replace(whose[0], "");
  for (const { re, event: read } of WATCHED_EVENTS) {
    const m = re.exec(rest);
    if (!m) continue;
    let event = read;
    let said = rest.slice(0, m.index).trim();
    // "a <Bulma> card in your Battle Area is removed from your Battle Area": the place says whose card it was.
    const inYours = / in your battle area\b/.test(said);
    said = said.replace(/ in your (?:battle|unison) area\b/, "").trim();
    const area = m[1];
    let side: "you" | "opponent" | "both" | null = whose[1] === "a" ? (inYours || area === "your" ? "you" : null) : whose[1];
    if ((area === "their" && side !== "opponent") || (area === "your" && side !== "you")) side = null;
    // A Unison leaves for the Drop from its Unison Area (Q&A BT17-059, BT17-069): only a Unison's. Audit triggers 3: a
    // card "in your Battle Area" placed in the Drop leaves from there (`yourCardBattleToDrop`), whatever it is.
    if (event === "unisonToDrop" && !/\bunison(?: cards?)?$|\bunison cards? with\b/.test(said)) {
      if (!inYours) return null;
      event = "battleToDrop";
    }
    // A switch by your skill of "an opponent's card" is any of theirs on the table, their Leader too
    // (`opponentCardRestedByYourSkill`, R-208); one by any
    // skill is read only of a Battle Card (20-1-2: one in a Battle Area), which is all its moment asks about.
    if (event === "restedByYou" && !/^cards?$/.test(said)) return null;
    if (event === "restedBySkill" && !/\bbattle cards?$/.test(said)) return null;
    // A description says no verb: "…cards is KO'd by an opponent's attack" is a KO, not an attack. "Other than" a kind
    // ("…other than a <Bulma> card", BT10-011; "…other than their Leader", BT25-085) is not read by the filter, which
    // took the excluded kind for the one asked: only a card name is set aside ("…other than {Cell, …}", P-190). Nor is
    // a means or a time ("…a Battle Card using a non-keyword skill", BT11-124; "…using [Arrival]", BT15-033): no event
    // here carries it, so the moment stays unread rather than answering every play.
    if (!side || !said || /\b(?:this card|it|is|are|was|were|or (?:your|a|an)|and|using|by|on your|during|until|from)\b|\bother than (?!\{)|\bexcept\b/.test(said)) return null;
    // Review of audit triggers 2: where the moment's card may stand outside the Battle Area — an attacker or the card
    // attacked may be a Leader (8-1-3) — "in your Battle Area" is a condition as well as whose card it is: "When a
    // ≪Universe 7≫ <Son Goku> card in your Battle Area is attacked" (SD21-03) is not your U7 <Son Goku> Leader attacked,
    // nor is "a blue <Beerus> card in your Battle Area attacks and KOs" (BT16-039) your blue <Beerus> Leader's attack.
    // A card in the Battle Area that attacks or is attacked is one that is no Leader.
    if (inYours && (event === "attacked" || event === "attacks" || event === "kosByAttack") && !/\bbattle cards?$/.test(said)) {
      if (!/\bcards?$/.test(said)) return null;
      said = said.replace(/\b(cards?)$/, "non-leader $1");
    }
    // A Leader attacked has its own moment and readers (`yourLeaderAttacked`, `attackedLeaderDescription`; 8-1-3).
    const triggers = event === "attacked" && /(?<!non-)\bleader(?: cards?)?$/.test(said) ? undefined : WATCHED_MOMENT[event][side];
    return triggers?.length ? { triggers, said: masked.unmask(said) } : null;
  }
  return null;
}

// ── audit triggers 3 (3 Nov 2026): a keyword's move, watched ────────────────

/**
 * The keyword moves a moment can name (22: a keyword skill being activated), and the declared moment for each side of
 * the table. [Dark Over Realm] is a keyword of its own (22-23), never an [Over Realm] (22-15); "[counter]" is any
 * [Counter] skill (4-3), a skill's activation rather than a keyword's move. A keyword not here names no moment, so its
 * skill stays unread.
 */
const KEYWORD_MOVE: Readonly<Record<string, { you?: Trigger; opponent?: Trigger }>> = {
  awaken: { you: "awakenActivated" },
  "awaken: surge": { you: "awakenActivated" },
  wish: { you: "wishActivated" },
  "over realm": { you: "overRealmPlayed" },
  "dark over realm": { you: "darkOverRealmActivated" },
  overlord: { you: "overlordActivated" },
  revive: { you: "reviveActivated" },
  rejuvenate: { you: "rejuvenateActivated" },
  blocker: { you: "yourCardBlockerUsed", opponent: "opponentBlockerUsed" },
  counter: { you: "youCounter", opponent: "opponentCounter" },
  swap: { you: "swapActivated" },
};
/** One keyword said as a skill ("[Awaken]", "an [Over Realm] skill", "the [Blocker] skill"), or several joined by "or". */
const KW_ONE = String.raw`(?:an? |the |its )?\[[^\]]+\](?: skills?)?`;
const KW_LIST = String.raw`${KW_ONE}(?:,? or ${KW_ONE})*`;
/** Whose move, and where the card is described: [pattern, side, description group, keyword-list group]. */
const KEYWORD_WATCHED: readonly [RegExp, "you" | "opponent", number | null, number][] = [
  // "When you activate [swap] on one of your yellow <Frieza> cards" (BT21-101), "When you activate the [Blocker] skill on
  // one of your yellow Battle Cards" (EX18-01).
  [new RegExp(String.raw`^when you activate (${KW_LIST}) on (?:one of |1 of )?your (?!opponent\b)(.+)$`), "you", 2, 1],
  // "When you activate [Over Realm]" (BT16-111), "…an [Over Realm] skill" (BT11-123), "…[Overlord]" (BT17-121),
  // "…a [Rejuvenate] skill" (BT12-055), "…a [counter] skill" (P-449).
  [new RegExp(String.raw`^when you activate (${KW_LIST})$`), "you", null, 1],
  // "When your opponent activates a [blocker] or [counter] skill" (BT26-140).
  [new RegExp(String.raw`^when your opponent activates (${KW_LIST})$`), "opponent", null, 1],
  // "When your Leader's [awaken] skill activates" (P-533).
  [new RegExp(String.raw`^when (?:one of |1 of )?your (?!opponent\b)(.+?)['’]s? (${KW_LIST}) activates$`), "you", 1, 2],
  // "When your Leader Card activates [Awaken]" (BT9-094), "…[Awaken] or [Wish]" (BT8-131), "When your yellow
  // <Garlic Jr.> activates an [Overlord] skill" (P-568), "When your Leader Card activates a [Blocker] skill" (BT14-123),
  // "When one of your Z-Energy cards activates [EX-Evolve]" (BT19-067).
  [new RegExp(String.raw`^when (?:one of |1 of )?your (?!opponent\b)(.+?) activates (${KW_LIST})$`), "you", 1, 2],
];

/**
 * Audit triggers 3: a keyword's move another card of yours (or of your opponent's) makes, read as subject × move —
 * "When your Leader Card activates [Awaken]" (BT9-094), "When you activate [Over Realm]" (BT16-111), "When your yellow
 * <Garlic Jr.> activates an [Overlord] skill" (P-568), "When your opponent activates a [blocker] or [counter] skill"
 * (BT26-140). The move is `keywordActivated` (the [Counter] `skillActivated`), fired as the line is used
 * (`vm/actions.ts`), its card the subject; what the sentence says about that card (`said`, lower case, names masked) is
 * a condition on it, asked before pending (`vm/triggers.ts`). Several keywords joined by "or" are a moment each
 * (9-6-2: only one happens at a time). "One of your Z-Energy cards activates [EX-Evolve]" (BT19-067) says where the
 * card was, not what it is: the [EX-Evolve] from the Z-Energy (22-5-2, #917). Null for any other clause, and for a
 * keyword or side no moment is declared for.
 */
export function watchedKeywordMove(clause: string): { triggers: Trigger[]; said: string | null } | null {
  for (const [re, side, saidAt, listAt] of KEYWORD_WATCHED) {
    const m = re.exec(clause);
    if (!m) continue;
    const names = [...m[listAt].matchAll(/\[([^\]]+)\]/g)].map((k) => k[1].trim().replace(/ \d+$/, ""));
    const said = saidAt === null ? null : m[saidAt].trim().replace(/^leader$/, "leader card");
    // 22-5-2, #917: the Z-Energy says where the [EX-Evolve] was used from, which is its own moment.
    if (names.length === 1 && names[0] === "ex-evolve") {
      if (side !== "you" || !said || !/^z-energy cards?$/.test(said)) return null;
      return { triggers: ["yourCardExEvolveFromZEnergy"], said: null };
    }
    const triggers = names.map((k) => KEYWORD_MOVE[k]?.[side]);
    if (!names.length || triggers.some((t) => t === undefined)) return null;
    // A description says no verb, no means and no time ("…black Z-Unison attacks or activates the [Blocker] skill" is two
    // moments, `YOUR_CARD_ATTACKS_OR_BLOCKS`'); one that does is not read as a card.
    if (said !== null && (!said || /\b(?:this card|it|is|are|was|were|attacks?|or (?:your|a|an|when)|and|using|by|on your|during|until|from)\b|\bother than (?!\{)|\bexcept\b/.test(said))) return null;
    return { triggers: [...new Set(triggers as Trigger[])], said };
  }
  return null;
}

// ── audit triggers 3 (3 Nov 2026): a card's move between areas ──────────────

/** Audit triggers 3: "At the end of a turn where this card was played" (BT16-142). */
export const TURN_END_WHERE_PLAYED = /^at the end of a turn (?:where|in which) this card was played(?: from your hand)?$/;

/** The areas a moment's "in your …" / "from your …" names, as the zones a move carries (`moved`'s `from`). */
const AREA_ZONE: Readonly<Record<string, string>> = { hand: "hand", drop: "drop", "drop area": "drop", "battle area": "battle", "z-energy": "zEnergy", "combo area": "combo" };
const UNDER_FROM: Readonly<Record<string, Trigger>> = { hand: "placedUnderFromHand", drop: "placedUnderFromDrop", battle: "placedUnderFromBattle", zEnergy: "placedUnderFromZEnergy", combo: "placedUnderFromCombo" };
const AREA_LIST = String.raw`(?:hand|drop(?: area)?|battle area|z-energy|combo area)(?: or (?:hand|drop(?: area)?|battle area|z-energy|combo area))*`;
const PLACED_UNDER_FROM = new RegExp(String.raw`^when this card (?:in your (${AREA_LIST}) is placed|is placed from your (${AREA_LIST})) under\b`);

/**
 * Audit triggers 3: "When this card **in your hand** is placed under a {Destroyed West City} in your Battle Area"
 * (BT23-025), "When this card is placed **from your hand or Drop** under an <Anilaza> or <Koichiarator> card" (BT20-014),
 * "When this card **in your hand or Battle Area** is placed under your green <Mai: Future>-only Leader" (P-635): going
 * into a pile (23-2) from the area named — a moment for each area (9-6-2: only one happens at a time). The card it goes
 * under is a condition the compiler reads (`special: "onTop"`). Empty for any other head.
 */
export function placedUnderFrom(head: string): Trigger[] {
  const m = PLACED_UNDER_FROM.exec(head);
  if (!m) return [];
  return [...new Set((m[1] ?? m[2]).split(" or ").map((a) => UNDER_FROM[AREA_ZONE[a.trim()]]))];
}

/**
 * Audit triggers 3: a card's move between areas, said whole, with no cause or with "by a skill" — this card's own
 * ("When this card is sent to its owner's Warp", BT31-108; "…sent from a Battle Area to a Warp", BT5-048; "When this
 * face-up card in your life is placed in your Drop Area", BT12-088), and another card's, watched ("When you add a card
 * from your life to your hand", BT20-023; "When your opponent adds a card from their life to their hand or places a
 * card from their life in their Drop Area", BT13-004; "When an opponent's card is sent to the Warp", P-326; "When a
 * card in your opponent's hand is sent to their Warp by one of your skills", P-346). Each is the plain `moved` moment
 * with its areas (`triggers.rules`), or — where it names a skill — the one a skill's move pends by name
 * (`vm/script.ts`'s `pendMovedBySkill`). `said` is a description of the card watched, lower case, names masked: a
 * condition on it ("When a **Battle Card** in your opponent's Drop Area is sent to their Warp by one of your skills",
 * BT13-148). Null for any other clause.
 */
const ZONE_MOVES: readonly [RegExp, Trigger][] = [
  [/^when this card is sent to (?:its owner'?s|your|the|a) warp$/, "toWarp"],
  [/^when this card is sent from (?:a|your|the) battle area to (?:its owner'?s|your|the|a) warp$/, "battleToWarp"],
  [/^when this card is sent to (?:its owner'?s|your|the|a) warp by (?:a|any) skill$/, "toWarpBySkill"],
  [/^when this card in your z-deck is added to your z-energy$/, "zDeckToZEnergy"],
  [/^when this card is returned to (?:its owner'?s|your) hand from (?:a|the|your) battle area$/, "battleToHand"],
  [/^when this face-up card in your life is placed (?:in|into) (?:your|its owner'?s) drop(?: area)?$/, "faceUpLifeToDrop"],
  [/^when you add (?:a card|cards) from your life to your hand$/, "yourLifeToHand"],
  [/^when you add (?:a card|cards) from your life to your hand or place (?:a card|cards) from your life (?:in|into) your drop(?: area)?$/, "yourLifeToHandOrDrop"],
  [/^when your opponent adds (?:a card|cards) from their life to their hand or (?:places (?:a card|cards) from their life (?:in|into) )?(?:their )?drop(?: area)?$/, "opponentLifeToHandOrDrop"],
  [/^when a card in your opponent'?s life is placed (?:in|into) their drop(?: area)?$/, "opponentLifeToDrop"],
  [/^when one of your energy is added to your z-energy$/, "yourEnergyToZEnergy"],
  [/^when an opponent'?s card is sent to (?:the|their|its owner'?s) warp$/, "opponentCardToWarp"],
  [/^when (?:a card in your opponent'?s hand is sent to their warp|a card is sent from your opponent'?s hand to its owner'?s warp) by one of your skills$/, "opponentHandToWarpByYou"],
  [/^when a card is placed (?:in|into) your drop(?: area)? from your deck$/, "yourDeckToDrop"],
  [/^when a battle area card is placed (?:in|into) a drop(?: area)?$/, "eitherBattleToDrop"],
];
const ZONE_MOVES_SAID: readonly [RegExp, Trigger][] = [
  [/^when an? ((?!card\b)[^,]{1,80}?) in your opponent'?s drop(?: area)? is sent to their warp by one of your skills$/, "opponentDropToWarpByYou"],
];
export function zoneMoveOf(clause: string): { trigger: Trigger; said: string | null } | null {
  for (const [re, trigger] of ZONE_MOVES) if (re.test(clause)) return { trigger, said: null };
  for (const [re, trigger] of ZONE_MOVES_SAID) {
    const m = re.exec(clause);
    if (m) return { trigger, said: m[1] };
  }
  return null;
}
