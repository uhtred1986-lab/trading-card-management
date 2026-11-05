import { IllegalAction } from "./illegal-action";
/** R438: only this card's typed own-Drop Permanent widens Counter admission. */
import type { EngineContext, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import type { ScriptFrame, SkillPrice } from "./script";
import type { VmState } from "./state";
import { counterDropPermitProblem } from "./counter-drop-contract";
import { skillsShowing } from "./triggers";
import { findCard } from "./zones";
import { skillNegated, skillsNegated } from "./effects";
import { sparkingIsValid } from "./validity";

export interface CounterDropPermission { skillIndex: number; price: SkillPrice }
export function counterDropPermission(ctx: EngineContext, _game: GameDefinition, state: VmState, player: PlayerId, card: string): CounterDropPermission | null {
  const inst = state.cards[card];
  if (!inst || inst.owner !== player || inst.hidden || findCard(state, card)?.zone !== "drop" || ctx.defs[inst.cardId]?.type !== "EXTRA" || skillsNegated(state, card)) return null;
  const showing = skillsShowing(ctx, state, card);
  for (const skill of showing.skills) {
    if (skill.kind !== "permanent" || skillNegated(state, card, skill.index, skill.kind) || !sparkingIsValid(state, player, skill.validity) || skill.bond != null) continue;
    const script = showing.scripts.bySkill[skill.index];
    if (!script || script.unsupported.length || script.ops.length !== 1) continue;
    const op = script.ops[0];
    if (op.op !== "permit" || op.what !== "counterFromDrop" || counterDropPermitProblem(op)) continue;
    return { skillIndex: skill.index, price: structuredClone(op.price!) };
  }
  return null;
}

/** Saved payment authority must still name this exact stored permission. */
export function validCounterDropOrigin(ctx: EngineContext, state: VmState, frame: ScriptFrame): boolean {
 const origin=frame.counterCost?.dropOrigin;
 if(!origin || origin.version!==1 || !Number.isSafeInteger(origin.sourceEpoch) || origin.sourceEpoch<0 || !Number.isSafeInteger(origin.permissionSkill) || origin.permissionSkill<0 || (origin.paidEpoch!==undefined && (!Number.isSafeInteger(origin.paidEpoch)||origin.paidEpoch<=origin.sourceEpoch)))return false;
 const inst=state.cards[frame.card];if(!inst||inst.owner!==frame.master||ctx.defs[inst.cardId]?.type!=="EXTRA")return false;
 const script=skillsShowing(ctx,state,frame.card).scripts.bySkill[origin.permissionSkill];
 return !!script && script.kind==="permanent" && script.ops.length===1 && !script.unsupported.length && counterDropPermitProblem(script.ops[0])===null;
}

export interface CounterDropOccurrences { version: 1; cards: Record<string, number> }
export function counterDropOccurrences(state: VmState, candidates: readonly string[]): { dropOccurrences?: CounterDropOccurrences } {
 const cards=Object.fromEntries(candidates.filter(id=>findCard(state,id)?.zone==="drop").map(id=>[id,state.cards[id].zoneEpoch??0]));
 return Object.keys(cards).length ? {dropOccurrences:{version:1,cards}} : {};
}
export function counterDropOccurrenceProblem(state: VmState, card: string, saved: CounterDropOccurrences | undefined): string | null {
 const epoch=saved?.cards?.[card];
 if(saved && (saved.version!==1 || !saved.cards || typeof saved.cards!=="object" || Array.isArray(saved.cards))) return "rebuild the saved Drop Counter candidates";
 if(findCard(state,card)?.zone!=="drop" && epoch===undefined)return null;
 if(!Number.isSafeInteger(epoch)||epoch!<0)return "rebuild the saved Drop Counter occurrence";
 if(findCard(state,card)?.zone!=="drop" || (state.cards[card]?.zoneEpoch??0)!==epoch)return "the original Drop Counter occurrence is no longer available";
 return null;
}

export function requireCounterDropOccurrence(state: VmState, card: string, saved: CounterDropOccurrences | undefined): void {
 const problem=counterDropOccurrenceProblem(state,card,saved);if(problem)throw new IllegalAction(problem);
}
