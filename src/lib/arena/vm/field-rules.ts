/** R469: Field identity for rule processing differs from a skill referencing Field. */
import type { CardOccurrence, EngineContext, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import { parseSkills } from "../text/cards";
import { hasKeyword, permissions, permitted } from "./program";
import type { VmState } from "./state";
import { findCard, hostOf } from "./zones";

/** 9-1-2-1 retains negated printed text. A negated granted skill is deleted
 * (9-1-2-2), so only effective grants/copies supplement the printed face. */
export function fieldForRule(ctx: EngineContext, game: GameDefinition, state: VmState, card: string): boolean {
  const inst = state.cards[card], def = inst && ctx.defs[inst.cardId];
  if (!inst || !def || inst.hidden || def.type !== "EXTRA") return false;
  const face = inst.flipped && def.back ? def.back : def;
  return parseSkills(face.skill ?? null).some(skill => skill.keyword?.name === "Field")
    || hasKeyword(ctx, game, state, card, "Field");
}

/** 22-3-5 is mandatory rule processing, not choosing targets. Under-card
 * placement is expressly excluded by22-3-5-1. Permission remains a live skill. */
export function otherFieldsToDrop(ctx: EngineContext, game: GameDefinition, state: VmState, arriving: string): string[] {
  const at = findCard(state, arriving);
  if (!at || at.zone !== "battle" || hostOf(state, arriving) || !fieldForRule(ctx, game, state, arriving)) return [];
  const keep = permissions(ctx, game, state, "fieldKeepOthers").some(permission => {
    const source = findCard(state, permission.target);
    return permission.master === at.owner && source?.owner === at.owner && source.zone === "battle"
      && !hostOf(state, permission.target) && permitted(ctx, game, state, permission.filter, arriving);
  });
  if (keep) return [];
  return state.sides[at.owner].zones.battle.filter(card => card !== arriving && !hostOf(state, card) && fieldForRule(ctx, game, state, card));
}

/** One arrival owns this rule action even when a replacement asks a question. */
export interface FieldCleanup { version: 1; arriving: CardOccurrence; master: PlayerId; cards: CardOccurrence[] }
