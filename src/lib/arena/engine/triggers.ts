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
  switch (trigger) {
    case "played":
      return /when (?:you play this card|this card is played)/.test(t);
    case "attacks":
      // "When this card attacks and KOs an opponent's Battle Card" is the KO, not the attack.
      return /when this card attacks(?! and kos?\b)/.test(t);
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
    case "removedByOpponent":
      return /when this card is removed from [a-z' ]*battle area by (?:an? |one of )?(?:your )?opponent'?s? skill/.test(t);
    case "kos":
      return /when this card (?:attacks and )?kos? (?:an opponent's|your opponent's|one of your opponent's|a) (?:battle card|card)/.test(t);
    case "leaderPlaced":
      return /when this card is placed in (?:your|a) leader area/.test(t);
    case "turnEnd":
      return /at the end of (?:your|the|your opponent's) turn/.test(t);
    case "mainStart":
      return /at the (?:beginning|start) of (?:your|the) main phase/.test(t);
    case "chargeStart":
      return /at the (?:beginning|start) of (?:your|the) (?:turn|charge phase)/.test(t);
    case "dealtDamage":
      return /when this card deals damage|when you deal damage/.test(t);
    case "battleEnd":
      return /at the end of (?:the|a|this) battle/.test(t);
    case "comboed":
      return /when you use this card in a combo|when this card is used in a combo|when you combo with this card/.test(t);
    // The card the opponent played is the subject, whichever way round the
    // sentence names it. "Plays this card" is never how a card says it.
    case "opponentPlayed":
      return /when your opponent plays (?:a|an|1|up to)\b|when your opponent's [a-z ]*card is played|when a card is played by your opponent/.test(t);
    case "opponentAttacks":
      return /when your opponent attacks\b|when your opponent's [a-z ]*cards? attacks?\b|when one of your opponent's [a-z ]*cards? attacks\b/.test(t);
    case "opponentCombos":
      return /when your opponent combos\b|when your opponent uses a card in a combo\b/.test(t);
    // 5-5: placed, not played. A card that says both is caught by `played`
    // first, so this only ever adds the ones that say only this.
    case "placed":
      return /when this card is placed in (?:a|your|their|an opponent's) battle area/.test(t);
    case "energyToDrop":
      return /when a card in your energy is placed in (?:your|its owner's) drop/.test(t);
    case "unisonToDrop":
      return /when this card is placed in a drop area from your unison area/.test(t);
    case "markerRemoved":
      return /when a marker is removed/.test(t);
    case "offenseStart":
      return /at the (?:beginning|start) of (?:your|the) offense step/.test(t);
    case "defenseStart":
      return /at the (?:beginning|start) of (?:your|the) defense step/.test(t);
    case "damageStart":
      return /at the (?:beginning|start) of (?:your|the) damage step/.test(t);
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
  // The triggers about a card *leaving* fire once it has already gone, so its
  // area is no longer one its skills are valid in (9-1-3-1).
  const onLeaving = trigger === "koed" || trigger === "comboed" || trigger === "energyToDrop" || trigger === "unisonToDrop" || trigger === "removedFromBattle" || trigger === "removedByOpponent";
  if (!valid && !onLeaving) return;
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
  // "When this card KOs an opponent's Battle Card": the card that did it,
  // whether by battle or by its own skill.
  if (by && by !== card && s.cards[by] && p !== masterOf(s, by)) pendTriggers(ctx, s, "kos", by);
  move(ctx, s, ev, card, "drop", p, { reason: "ko" });
}

/** Whether a card is a Battle Card in a Battle Area (20-1-2). */
export function isBattleCardInPlay(ctx: GameContext, s: GameState, id: string): boolean {
  return areaOf(s, id) === "battle" && !s.cards[id].hidden && def(ctx, s, id).type !== "Z-EXTRA";
}
