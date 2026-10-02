/**
 * Trigger conditions and KO, split out of `engine.ts` so the effect
 * interpreter can queue triggers too without importing the engine
 * (which imports the interpreter).
 */
import { areaOf, cardsInPlay, forbids, masterOf, move, scriptsOfInstance, skillNegated, skillsNegated, skillsOfInstance } from "./state";
import { autoTriggerMatches, keywordTriggers } from "../text/triggers";
import type { GameContext, MoveOptions } from "../types";
// `masterOf` lives in `state.ts` — it is a question about where a card *is*,
// and the ownership audit in `glossary.ts` made every one of its callers a
// reader of that file. Re-exported here because the engine has imported it
// from this module since it was written.
export { masterOf } from "./state";
import type { GameEvent, GameState, Skill, Trigger } from "../types";

/**
 * Does this skill answer to this moment? The record's WHEN if it has one, the
 * printed text if it has not (9-6-2).
 *
 * The precedent is the price of 8 Sep 2026, and the reason is the same: the
 * engine plays from `card_rules`, so the WHEN a person edits on the workbench
 * has to be the WHEN the engine matches. Read off the text instead, an edited
 * trigger would be a label on a record and nothing else — the skill would go
 * on firing where the compiler's regexes put it, and the workbench would say
 * otherwise.
 *
 * `undefined` is *no record* and falls back to the text, so a card nobody has
 * drafted still plays. An empty array is a record that says this skill answers
 * to nothing, and is honoured as that.
 */
function skillAnswersTo(ctx: GameContext, s: GameState, card: string, sk: Skill, trigger: Trigger): boolean {
  // 20-18: a copied [Auto] answers to *this* card's moments, so it is asked
  // the same question as a printed one — and off the source's record, which is
  // what `scriptsOfInstance` carries it under.
  const recorded = scriptsOfInstance(ctx, s, card).bySkill[sk.index]?.trigger;
  return recorded ? recorded.includes(trigger) : autoTriggerMatches(sk, trigger);
}

/** Queue every [Auto] skill on `card` whose trigger matches (9-6-2). */
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
    // 3-10: the card answers from the Warp it was just sent to.
    trigger === "deckToWarpBySkill" ||
    trigger === "evolveFromHandActivated" ||
    trigger === "counterFreeFromHand" ||
    // 3-9-2-1: the card this fires on is sitting in a Life Area.
    trigger === "flippedFaceUp";
  if (!valid && !elsewhere) return;
  const master = masterOf(s, card);
  for (const sk of skillsOfInstance(ctx, s, card)) {
    if (skillNegated(s, card, sk.index, sk.kind)) continue;
    const isAuto = sk.kind === "auto";
    const isKeyword = sk.kind === "keyword" && keywordTriggers(sk, trigger);
    if (!isAuto && !isKeyword) continue;
    if (isAuto && !skillAnswersTo(ctx, s, card, sk, trigger)) continue;
    // 22-11-5 / 22-44-5: once-per-turn and [Limit X] skills stop pending once used up.
    const used = inst.usedThisTurn.filter((i) => i === sk.index).length;
    if (sk.oncePerTurn && used >= 1) continue;
    if (sk.limit != null && used >= sk.limit) continue;
    s.pending.push({ card, skillIndex: sk.index, master, trigger, subject });
  }
}

/**
 * "When this card is placed in a Battle Area" for a card that has just arrived
 * there by being played or by its [Field] (22-3). 5-5-1: playing a card places
 * it in the Battle Area, so a play fires `placed` as well as `played` (owner's
 * ruling, 2 Oct 2026). A move by a skill pends `placed` from the interpreter's
 * `moveTo` instead, so this is only the arrivals that go round it. A skill
 * already pended as `played` for this arrival (`since` is the queue length
 * before that) answers it once.
 */
export function pendPlacedOnArrival(ctx: GameContext, s: GameState, card: string, since: number = s.pending.length): void {
  if (areaOf(s, card) !== "battle") return;
  const played = new Set(
    s.pending
      .slice(since)
      .filter((p) => p.card === card && p.trigger === "played")
      .map((p) => p.skillIndex),
  );
  const at = s.pending.length;
  pendTriggers(ctx, s, "placed", card);
  const fresh = s.pending.splice(at).filter((p) => !played.has(p.skillIndex));
  s.pending.push(...fresh);
}

/** 5-12 / 21-14: move a Battle Card from the Battle Area to its owner's Drop Area. */
export function koCard(ctx: GameContext, s: GameState, ev: GameEvent[], card: string, by?: string, opts: Pick<MoveOptions, "replaced"> = {}): void {
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
  // A KO is one of the ways a card is "placed in the Drop Area from the Battle
  // Area", and the wording that names no cause means every cause.
  if (areaOf(s, card) === "battle") pendTriggers(ctx, s, "leftBattleToDrop", card);
  // "When this card KOs an opponent's Battle Card": the card that did it,
  // whether by battle or by its own skill.
  if (by && by !== card && s.cards[by] && p !== masterOf(s, by)) pendTriggers(ctx, s, "kos", by);
  // 5-12-1: "its **owner's** Drop Area" — the owner, not the master, which is
  // the whole of the difference once a card can be controlled by the other
  // player. `move` clamps a non-play destination to the owner anyway
  // (3-1-6-1, `state.ts`), so this is what has always happened; saying it here
  // means the KO does not depend on that clamp to be right.
  move(ctx, s, ev, card, "drop", s.cards[card].owner, { reason: "ko", ...opts });
}
