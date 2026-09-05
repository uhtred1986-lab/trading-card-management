/**
 * Trigger conditions and KO, split out of `engine.ts` so the effect
 * interpreter can queue triggers too without importing the engine
 * (which imports the interpreter).
 */
import { areaOf, cardsInPlay, def, forbids, move, skillNegated, skillsNegated, skillsOfInstance, type GameContext } from "./state";
import type { GameEvent, GameState, PlayerId, Skill, Trigger } from "./types";
import { PLAYERS } from "./types";

/** The player whose area the card sits in; its owner when it is not in play. */
export function masterOf(s: GameState, card: string): PlayerId {
  for (const p of PLAYERS) if (cardsInPlay(s, p).includes(card)) return p;
  return s.cards[card].owner;
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
 * Read the "When …" clause of an [Auto] skill. Unrecognised wording never
 * pends — a skill the engine cannot place in time is better left out than
 * fired at the wrong moment.
 */
export function autoTriggerMatches(sk: Skill, trigger: Trigger): boolean {
  const t = (sk.cost + " " + sk.effect).toLowerCase();
  /**
   * The timing triggers name a moment, and a card may equally well *mention*
   * that moment in the middle of an effect — "…, and at the end of the turn,
   * flip all face-up cards in your life face down", which is a delayed effect
   * and no trigger at all. 116 skills do exactly that, and every one of them
   * was pending its whole skill again at every turn end. A trigger is the head
   * of the sentence, so these are matched against the head and nothing else.
   */
  const head = sk.effect
    .toLowerCase()
    .trim()
    // A validity condition may be printed in front of the trigger rather than
    // before the colon — "If your Leader Card is red, at the end of your turn,
    // …", or with the sets' own bar between them — and that is still the head
    // of the sentence. A "when …" in front of it is not: that is the skill's
    // own trigger, and what follows it is a delayed effect.
    .replace(/^if [^,|]{0,90}[,|]\s*/, "");
  switch (trigger) {
    case "played":
      // 12-2: activating an Extra *is* playing it, and the sets print both.
      // "When you play or combo with this card" and "when this card in your
      // hand is played or used in a combo" are this trigger and `comboed`
      // both — each fires at its own moment, and only one of them happens.
      return /when (?:you play this card|this card is played)|when you activate this card|when you play or combo with this card|when this card(?: in your hand)? is played(?: or used in a combo)?/.test(t);
    case "attacks":
      // "When this card attacks and KOs an opponent's Battle Card" is the KO, not the attack.
      // "When you attack or combo with this card" is this trigger and `comboed`
      // both, like "play or combo" above: each fires at its own moment and only
      // one of them happens.
      return /when this card attacks(?! and kos?\b)|when you attack or combo with this card/.test(t);
    case "attacked":
      return /when this card is attacked/.test(t);
    case "koed":
      // "…removed from a Battle Area by a skill **or KO'd**" is the KO half of
      // a wording whose other half is `removedFromBattle`.
      return /when this card is ko'?d|when this card is removed from [a-z' ]*battle area by [a-z' ]*skills? or ko'?d/.test(t);
    // 3-1: a move an effect caused, which is not a KO — the cards write "or
    // KO'd" when they mean both.
    case "removedFromBattle":
      return /when this card is removed from [a-z' ]*battle area by (?:a|your|one of your) skill/.test(t);
    // 3-1: the narrower wording — a skill put it out of the Battle Area *and*
    // it ended in the Drop. `removedFromBattle` covers a skill that sends it
    // anywhere, so this cannot simply widen that one: a card bounced to the
    // hand is that moment and not this.
    case "droppedFromBattle":
      return /when this card is placed in (?:a|your|its owner'?s) drop area from (?:a|your|the) battle area by (?:a|your|one of your) skill/.test(t);
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
      return /when this card is removed from [a-z' ]*battle area by (?:an? |one of )?(?:your )?opponent'?s? skill/.test(t);
    case "evolvedInto":
      return /when a card evolves into this card|when this card evolves\b/.test(t);
    case "opponentCounter":
      return /when your opponent activates a \[counter/.test(t);
    case "kos":
      // The same moment said the other way round — "when an opponent's Battle
      // Card is KO'd **by this card's attack**" — which is still this card
      // doing the KO'ing and so still this trigger.
      return /when this card (?:attacks and )?kos? (?:an opponent's|your opponent's|one of your opponent's|a) (?:battle card|card)|when (?:an|your) opponent'?s? (?:battle )?card is ko'?d by this card'?s attack/.test(t);
    case "leaderPlaced":
      return /when this card is placed in (?:your|a) leader area|when you place this card in (?:your|a) leader area/.test(t);
    // 7-1: whose turn it is decides whether these happen at all, and "your" is
    // the card's controller, never the turn player. One trigger covered both
    // wordings and was pended for both players, so 164 cards that act "at the
    // end of your turn" also acted at the end of the opponent's, and 13 that
    // wait for the opponent's turn fired a turn early as well.
    case "turnEnd":
      return /^at the end of (?:your|the|this) turn\b/.test(head);
    case "opponentTurnEnd":
      return /^at the end of your opponent'?s turn\b/.test(head);
    case "opponentTurnStart":
      return /^at the (?:beginning|start) of your opponent'?s turn\b/.test(head);
    case "mainStart":
      return /^at the (?:beginning|start) of (?:your|the) main phase\b/.test(head);
    case "opponentMainStart":
      return /^at the (?:beginning|start) of your opponent'?s main phase\b/.test(head);
    case "blockerUsed":
      return /when this card activates (?:its )?\[blocker\]/.test(t);
    // Both wordings are the same moment: "when **this card** in your life is
    // flipped face up" is the card that was flipped, "when **a** card…" is
    // watched by that player's cards in play. The colour qualifier some of
    // them add is checked in `script.ts`, where the flipping card is known.
    case "flippedFaceUp":
      return /when (?:a|this) card in your life is flipped face up/.test(t);
    // 22: a keyword skill being used, which the cards name by its own bracket.
    case "unionActivated":
      return /when you activate a \[union[^\]]*\](?: skill)?/.test(t);
    case "overlordActivated":
      return /when you activate an \[overlord\](?: skill)?/.test(t);
    case "overRealmPlayed":
      return /when you play a battle card using \[over realm\]/.test(t);
    // 1-10: the narrower [Alliance] wording just below is read first, so a card
    // that names the keyword is not also caught by this.
    case "restedBySkill":
      return /when this card is switched to rest mode by (?:one of )?your skills?\b/.test(t);
    case "restedByAlliance":
      return /when this card is switched to rest mode by (?:an?|one of your) \[alliance\]/.test(t);
    case "addedToZEnergy":
      return /when this card is added to (?:your )?z-energy|when you add this card to your z-energy/.test(t);
    case "chargeStart":
      return /^at the (?:beginning|start) of (?:your|the|this) (?:turn|charge phase)\b/.test(head);
    case "dealtDamage":
      return /when this card deals damage|when you deal damage/.test(t);
    case "battleEnd":
      return /^at the end of (?:the|a|this) battle\b/.test(head);
    case "comboed":
      return /when you use this card in a combo|when this card(?: in your hand)? is used in a combo|when you combo with this card|when you (?:play|attack) or combo with this card|when this card in your hand is played or used in a combo/.test(t);
    // The card the opponent played is the subject, whichever way round the
    // sentence names it. "Plays this card" is never how a card says it.
    case "opponentPlayed":
      return /when your opponent plays (?:a|an|1|up to)\b|when your opponent's [a-z ]*card is played|when a card is played by your opponent/.test(t);
    // Your own side of `opponentPlayed`: a card of yours watching another of
    // your cards arrive. Not "this card" — that is `played`, the card's own
    // arrival — and not the opponent's.
    //
    // A trigger that names *how* the card was played ("by a [Union] skill",
    // "using [Swap]", "from your life") is left out: the engine cannot check
    // that, and firing on an ordinary play would be worse than not firing.
    case "youPlayed": {
      if (/when (?:you play this card|this card is played)/.test(t)) return false;
      if (/\bis played (?:by|using|from)\b|\bwhen you play [^,]*\b(?:using|from your)\b/.test(t)) return false;
      const spoken = /when you play ((?:an?|1|up to \d+|\d+) [^,]{0,80}?)(?:,|$)/.exec(t);
      const passive = /when (a|an|your) ([^,]{0,80}?) is played\b/.exec(t);
      if (!spoken && !passive) return false;
      const said = spoken ? spoken[1] : `${passive![1]} ${passive![2]}`;
      if (/^your opponent/.test(said)) return false;
      // This fires for *every* card that player plays, and the effect then acts
      // on it — so a description the compiler cannot turn into a filter must
      // not fire at all. "A blue **or** yellow ≪Universe 6≫ card" is the shape
      // that matters: `parseFilter` keeps one colour of the two, so the whole
      // trigger stays an honest gap rather than buffing whatever was played.
      return !/ or /.test(said);
    }
    case "opponentAttacks":
      return /when your opponent attacks\b|when your opponent's [a-z ]*cards? attacks?\b|when one of your opponent's [a-z ]*cards? attacks\b/.test(t);
    case "opponentCombos":
      return /when your opponent combos\b|when your opponent uses a card in a combo\b/.test(t);
    // Your own side of it. "When you combo with this card" is the card's own
    // skill and belongs to `comboed`, so the possessive has to be excluded
    // here or every combo card would fire twice.
    case "youCombo":
      return /when you (?:use a card in a combo|combo)\b/.test(t) && !/when you combo with this card/.test(t);
    // 5-5: placed, not played. A card that says both is caught by `played`
    // first, so this only ever adds the ones that say only this.
    case "placed":
      return /when this card is placed in (?:a|your|their|an opponent's) battle area/.test(t);
    case "energyToDrop":
      return /when a card in your energy is placed in (?:your|its owner's) drop/.test(t);
    case "unisonToDrop":
      return /when this card is placed in a drop area from your unison area|when this card in a unison area is placed into its owner's drop/.test(t);
    case "markerRemoved":
      return /when a marker is removed/.test(t);
    // 22-43-3: paying [Spirit Boost X] takes markers off your Unison. These
    // cards watch for that *cost* rather than for a marker leaving, so an
    // opponent's attack knocking markers off (13-5-2) is not their moment —
    // which is why it is a trigger of its own and not the one above. Both ends
    // of it are printed: the Unison itself ("from this card") and the Battle
    // Cards watching it ("from one of your Unison Cards").
    case "spiritBoostPaid":
      return /when you remove a marker from (?:this card|(?:one of )?your (?:[a-z-]+ )?unison cards?)/.test(t) && /\[spirit boost\]/.test(t);
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

/** Queue every [Auto] skill on `card` whose printed trigger matches (9-6-2). */
export function pendTriggers(ctx: GameContext, s: GameState, trigger: Trigger, card: string, subject?: string): void {
  const inst = s.cards[card];
  if (!inst || inst.hidden || skillsNegated(s, card)) return;
  const area = areaOf(s, card);
  // 9-1-3-1: a card's skills are only valid in its own area.
  const valid = area === "leader" || area === "battle" || area === "unison";
  // Triggers about a card arriving somewhere that is not a play area, or
  // leaving one, fire when the card is already there — so its area is not one
  // its skills would ordinarily be valid in (9-1-3-1). These name that moment
  // themselves, which is what makes them the exception.
  const elsewhere =
    trigger === "koed" ||
    trigger === "comboed" ||
    trigger === "energyToDrop" ||
    trigger === "unisonToDrop" ||
    trigger === "removedFromBattle" ||
    trigger === "droppedFromBattle" ||
    trigger === "removedByOpponent" ||
    trigger === "addedToZEnergy" ||
    // 3-9-2-1: the card this fires on is sitting in a Life Area.
    trigger === "flippedFaceUp";
  if (!valid && !elsewhere) return;
  const master = masterOf(s, card);
  for (const sk of skillsOfInstance(ctx, s, card)) {
    if (skillNegated(s, card, sk.index, sk.kind)) continue;
    const isAuto = sk.kind === "auto";
    const isKeyword = sk.kind === "keyword" && keywordTriggers(sk, trigger);
    if (!isAuto && !isKeyword) continue;
    if (isAuto && !autoTriggerMatches(sk, trigger)) continue;
    // 22-11-5 / 22-44-5: once-per-turn and [Limit X] skills stop pending once used up.
    const used = inst.usedThisTurn.filter((i) => i === sk.index).length;
    if (sk.oncePerTurn && used >= 1) continue;
    if (sk.limit != null && used >= sk.limit) continue;
    s.pending.push({ card, skillIndex: sk.index, master, trigger, subject });
  }
}

/** 5-12 / 21-14: move a Battle Card from the Battle Area to its owner's Drop Area. */
export function koCard(ctx: GameContext, s: GameState, ev: GameEvent[], card: string, by?: string): void {
  // 20-14: a card that can't be KO'd at all is not KO'd by battle damage
  // either, so the check belongs here rather than in the `ko` operation.
  if (forbids(ctx, s, "beKOd", { card })) return;
  const p = masterOf(s, card);
  ev.push({ type: "ko", card, by });
  pendTriggers(ctx, s, "koed", card);
  // 21-14: the rest of the board watches it too, each side hearing only the
  // wording that is about it. The KO'd card is left out — its own arrival at
  // the moment is `koed` just above.
  for (const w of cardsInPlay(s, p)) if (w !== card) pendTriggers(ctx, s, "yourCardKoed", w, card);
  for (const w of cardsInPlay(s, p === "p1" ? "p2" : "p1")) pendTriggers(ctx, s, "opponentCardKoed", w, card);
  // "When this card KOs an opponent's Battle Card": the card that did it,
  // whether by battle or by its own skill.
  if (by && by !== card && s.cards[by] && p !== masterOf(s, by)) pendTriggers(ctx, s, "kos", by);
  move(ctx, s, ev, card, "drop", p, { reason: "ko" });
}

/** Whether a card is a Battle Card in a Battle Area (20-1-2). */
export function isBattleCardInPlay(ctx: GameContext, s: GameState, id: string): boolean {
  return areaOf(s, id) === "battle" && !s.cards[id].hidden && def(ctx, s, id).type !== "Z-EXTRA";
}
