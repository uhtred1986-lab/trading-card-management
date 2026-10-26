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
/** The combo card's own end-of-battle wording enters pending at 8-5-9. */
const COMBO_BATTLE_END = /^(?:during your turn,\s*)?at the end of (?:the|a|this) battle(?: after| in which) you (?:combo|combod|comboed|used?) (?:with )?this card/;
const COMBO_BATTLE_END_FROM_HAND = new RegExp(`${COMBO_BATTLE_END.source} from your hand\\b`);
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
const YOUR_CARD_ATTACKS = /^when (?:your|one of your) ((?!opponent)(?!leader)[^,]{1,120}?) (?:attacks|attack)(?:,|$)/;
const YOUR_CARD_REMOVED_BY_OPPONENT = /^when (?:your|one of your) ((?!opponent)[^,]{1,160}?) (?:is|are) removed from your battle area by (?:an? |one of )?(?:your )?opponent'?s? skills?(?:,|$)/;
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
  return /when you use this card in a combo|when this card(?: in your (?:hand|deck or hand|hand or deck)| in (?:a|your) battle area)? is used in a combo|when you combo with this card|or if you combo with this card|when you (?:play|attack) or combo with this card|when this card in your hand is played or used in a combo/.test(text);
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
  if (/^when this card in your (?:deck or hand|hand or deck) is used in a combo\b/.test(head)) return { origins: ["deck", "hand"] };
  const via = /^when you combo with this card from an? energy area using (\{\d+\})['’]s skill\s*(?:,|$)/.exec(head);
  if (via) return { origins: ["energy"], viaSkillOf: masked.unmask(via[1]).replace(/^\{|\}$/g, "") };
  if (/^when you combo with this card from the battle area\s*(?:,|$)/.test(head)) return { origins: ["battle"] };
  // Phrasing batch 5: "When this card **in your/a Battle Area** is used in a combo" (BT21-084, BT26-019, BT27-022).
  if (/^when this card in (?:a|your) battle area is used in a combo\s*(?:,|$)/.test(head)) return { origins: ["battle"] };
  const company = /^when you combo with this card from your hand with (?:an?|1) (<[^>]+> card) in battle\s*(?:,|$)/.exec(head);
  if (company) return { origins: ["hand"], company: company[1] };
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
const PLAYED_USING_OVER_REALM = /when (?:you play this card|this card is played) using \[(?:dark )?over realm[^\]]*\]/g;

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
const PLAYED_FROM_HAND = new RegExp(String.raw`when (?:you play this card|this card is played) from your hand(?=\s*(?:,|:|\.|$)|\s+or (?:when )?(?:this card |it )?attacks\s*(?:,|:|\.|$)|\s+or ${DISCARDED_BY_SKILL})|${PLAYED_HAND_THEN_ENERGY}`);
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
  const t = playTaxWording(maskNames(sk.cost + " " + sk.effect).text).toLowerCase();
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
  switch (trigger) {
    case "played":
      // 12-2: activating an Extra *is* playing it, and the sets print both.
      // "When you play or combo with this card" and "when this card in your
      // hand is played or used in a combo" are this trigger and the self
      // combo entry trigger (`comboUsed`; `comboed` is its stored alias).
      // Each fires at its own moment, and only one of them happens.
      // "…using [Over Realm]" is `playedUsingOverRealm`'s and is not this.
      return /when (?:you play this card|this card is played)|when you activate this card(?!['’]s \[blocker\])|when you play or combo with this card|when this card(?: in your hand)? is played(?: or used in a combo)?/.test(
        t.replace(PLAYED_USING_OVER_REALM, "").replace(PLAYED_FROM_HAND_G, ""),
      );
    case "playedFromHand":
      return new RegExp(PLAYED_FROM_HAND.source).test(t);
    case "playedUsingOverRealm":
      return new RegExp(PLAYED_USING_OVER_REALM.source).test(t);
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
      return /when this card attacks(?! and kos?\b)|when you attack or combo with this card/.test(t) || PLAYED_OR_ATTACKS.test(head);
    case "attacked":
      return /when this card is attacked/.test(t);
    // 8-1: a Battle Card watching the *Leader* be attacked. The Leader's own
    // copy of that sentence is `attacked` above — it is a card in play like
    // any other — so this is only for the ones printed elsewhere. The words
    // between "your" and "Leader" ("mono-red ≪Saiyan≫", SD15-02, #1168) are
    // not lost here: the compiler reads them into a condition on the attacked
    // Leader (`attackedLeaderDescription`), or leaves the skill unread.
    case "yourLeaderAttacked":
      return /when your [^,]{0,60}leader(?: card)? is attacked/.test(head);
    // 21-3: damage from a skill, which is the only damage the `damage` op
    // deals — battle damage takes a different path — so "from a non-keyword
    // skill" is satisfied by the moment itself.
    case "youTookDamage":
      return /when you (?:take|receive) damage/.test(head);
    case "opponentTookDamage":
      return /when your opponent (?:takes|receives) damage/.test(head);
    // 3-9: a life card leaving the Life Area, however it leaves.
    case "lifeLeft":
      return /when your life (?:moves|is moved|is placed|leaves|is added)/.test(head);
    case "koed":
      // "…removed from a Battle Area by a skill **or KO'd**" is the KO half of
      // a wording whose other half is `removedFromBattle`.
      // SD15-03 (#728) writes the same pair with "placed in your Drop Area from
      // your Battle Area by an opponent's skill or KO'd"; the first half is
      // `droppedByOpponent`.
      return /when this card is (?:played or )?ko'?d|when this card is (?:played or )?removed from [a-z' ]*battle area by [a-z' ]*skills? or ko'?d|when this card is (?:played or )?placed in [a-z' ]*drop area from [a-z' ]*battle area by [a-z' ]*skills? or ko'?d/.test(t);
    // 3-1: a move an effect caused, which is not a KO — the cards write "or
    // KO'd" when they mean both.
    case "removedFromBattle":
      return /when this card is (?:played or )?removed from [a-z' ]*battle area by (?:a|your|one of your) skill/.test(t);
    // 3-1: the narrower wording — a skill put it out of the Battle Area *and*
    // it ended in the Drop. `removedFromBattle` covers a skill that sends it
    // anywhere, so this cannot simply widen that one: a card bounced to the
    // hand is that moment and not this.
    case "droppedFromBattle":
      return /when this card is placed in (?:a|your|its owner'?s) drop area from (?:a|your|the) battle area by (?:a|your|one of your) skill/.test(t)
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
      return DROP_FROM_Z_ENERGY.test(head);
    case "yourCardAttacks": {
      const m = YOUR_CARD_ATTACKS.exec(head);
      return !!m && readableSubject(effect, m[1]);
    }
    case "yourCardRemovedByOpponent": {
      const m = YOUR_CARD_REMOVED_BY_OPPONENT.exec(head);
      return !!m && readableSubject(effect, m[1]);
    }
    case "opponentLifeToZBySkill":
      return /^when your opponent'?s life is added to (?:its owner'?s|their) z-energy by (?:one of )?your skills?(?:,|$)/.test(head);
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
    case "opponentCardKoed":
      return /^when (?:your opponent's|an opponent's|one of your opponent's) [^,]{0,70} (?:is|are) ko'd(?:,|$)/.test(head);
    case "removedByOpponent":
      return /when this card is (?:played or )?removed from [a-z' ]*battle area by (?:an? |one of )?(?:your )?opponent'?s? skill/.test(t);
    case "evolvedInto":
      return /when a card evolves into this card|when this card evolves\b/.test(t);
    case "evolveFromHandActivated":
      return /when using this card'?s \[evolve\] from your hand|when you (?:use|activate) this card'?s \[evolve\](?: skill)? from your hand/.test(t);
    case "opponentCounter":
      return /when your opponent activates a \[counter/.test(t);
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
      return /when you activate a \[union[^\]]*\](?: skill)?/.test(t);
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
    case "extraActivated": {
      const m = /^when you activate (?:an?|1) ([^,:]{0,90}?\bextra(?: cards?)?\b[^,:]{0,90}?)(?:,|$)/.exec(head);
      if (!m) return false;
      const said = m[1].replace(/\s+from your hand$/, "");
      // "An energy cost of 1 **or** more" is one bound, not two kinds.
      const kinds = said.replace(/\b\d+ or (?:less|fewer|more|greater|higher|lower)\b/g, "");
      // "Original" (20-3-1) is the printed cost: `originalCostMin`/`originalCostMax` read it (#907 round 6).
      if (/ or |\[|\bby\b|\busing\b|\bwithout\b|\bfrom\b|\bin your\b/.test(kinds)) return false;
      return !parseFilter(effect.unmask(said)).unreadable;
    }
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
    case "addedToZEnergy":
      return /when this card is added to (?:your )?z-energy|when you add this card to your z-energy/.test(t);
    case "chargeStart":
      return /^at the (?:beginning|start) of (?:your|the|this) (?:turn|charge phase)\b/.test(head);
    case "dealtDamage":
      return /when this card deals damage|when you deal damage/.test(t);
    case "battleEnd":
      // "…after you combo with this card" is the combo card's own end of the
      // battle, `comboed` below (#539).
      return /^at the end of (?:the|a|this) battle\b/.test(head) && !COMBO_BATTLE_END.test(head);
    case "comboToDrop":
      return /^when (?:a|1) card in your combo area is (?:placed|put) (?:in|into) your drop(?: area)?\b/.test(head);
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
      if (/\bis played (?:by|using|from)\b|\bwhen you play [^,]*\b(?:using|from your)\b/.test(t)) return false;
      const spoken = /when you play ((?:an?|1|up to \d+|\d+) [^,]{0,80}?)(?:,|$)/.exec(t);
      const passive = /when (a|an|your) ([^,]{0,120}?)(?:[-—–]\s*)?is played\b/.exec(t);
      if (!spoken && !passive) return false;
      const said = expandSharedCardDescription(spoken ? spoken[1] : `${passive![1]} ${passive![2]}`);
      if (/^your opponent/.test(said)) return false;
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
        && !/when your opponent attacks your .+? with a specified cost of \d+\b/.test(head.toLowerCase());
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
      return /when your opponent combos\b|when your opponent uses a card in a combo\b/.test(t);
    // Your own side of it. "When you combo with this card" is the card's own
    // skill and belongs to `comboUsed`, so the possessive has to be excluded
    // here or every combo card would fire twice.
    case "youCombo":
      // Phrasing batch 3: "When you use **a red skill-less Battle Card with an energy cost of 2** in a combo" (BT14-001b):
      // the same moment, the card used described (the compiler reads the description as a condition on it).
      // Phrasing batch 5: "When you use **one of your** Red/Yellow multicolor ≪God≫ cards in a combo" (BT24-002, BT24-003).
      return (/when you (?:use a card in a combo|combo)\b/.test(t) || /^when you use (?:an?|1|one of your) [^,]+? in a combo\b/.test(head)) && !/when you combo with this card/.test(t);
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
      return /when a card in your energy is placed in (?:your|its owner's) drop/.test(t);
    case "unisonToDrop":
      return /when this card is placed in (?:a|your|its owner'?s) drop area from (?:a|your) unison area|when this card in a unison area is placed into its owner's drop/.test(t);
    // #930: "When this card is removed from a Unison Area" (BT31-043): this card
    // leaving the Unison Area for any area, by any cause. A cause said after it
    // ("… by a skill") is a narrower moment and is not read here.
    case "removedFromUnison":
      return /^when this card is removed from (?:a|the|your) unison area(?!\s+(?:by|due|because|using|during))(?:,|$)/.test(head.toLowerCase());
    case "markerRemoved":
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
export function playedOrUnplacedAlternative(sk: Skill): boolean {
  if (sk.kind !== "auto") return false;
  const head = effectHead(maskNames(sk.effect).text);
  const m = PLAYED_COORDINATED.exec(head);
  if (!m) return false;
  const [, qualifier, rest] = m;
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
  if (/^(?:removed from|placed in (?:a|your|its owner'?s|the) (?:drop|warp)|sent |returned |ko'?d|put )/.test(rest))
    return !(["removedFromBattle", "removedByOpponent", "koed"] as const).some((t) => autoTriggerMatches(sk, t));
  return true;
}

/** Compile-time only: the executable record owns these facts after drafting. */
export function compileComboQualification(sk: Skill): ComboQualification | null {
  if (sk.kind !== "auto") return null;
  const end = comboBattleEndSelf(sk);
  if (!end && !comboEntrySelf(sk)) return null;
  const head = effectHead(maskNames(sk.effect).text);
  const turn = /\bduring your opponent'?s turn\b/.test(head) ? "opponent"
    : /\bduring your turn\b/.test(head) ? "controller" : "any";
  const entry = comboEntryQualifier(sk);
  const origins = end ? (comboBattleEndFromHand(sk) ? ["hand"] : null) : comboEntryOrigins(sk);
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
