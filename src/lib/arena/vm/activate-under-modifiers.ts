/** R514: refuse omitted hand-equivalent or consumable layers before paying. */
import type {EngineContext} from '../types';
import type {GameDefinition} from '../rulesets';
import type {VmState} from './state';
import type {ActivationLine} from './activate';
import {activateTimingReaches} from './costs';
import {attrsNow,resolveSelector} from './program';
import {skillsShowing} from './triggers';
import {skillNegated} from './effects';
import {predicateOf} from './filters';
import {energyActivationReaches} from './energy-coupons';
import {underCounterExternalCostProblem} from './counter-under-price';
function containsModifier(value:unknown):boolean {
 if(Array.isArray(value))return value.some(containsModifier);
 if(!value||typeof value!=='object')return false;
 const r=value as Record<string,unknown>;
 return ['costReduction','altCost','payWith'].includes(String(r.op))||Object.values(r).some(containsModifier);
}
export function activateUnderModifierProblem(ctx:EngineContext,game:GameDefinition,state:VmState,line:ActivationLine):string|null {
 const o=line.activateUnderOrigin!;
 const showing=skillsShowing(ctx,state,line.card);
 if(showing.skills.some(sk=>sk.kind==='permanent'&&!skillNegated(state,line.card,sk.index,sk.kind)&&containsModifier(showing.scripts.bySkill[sk.index]?.ops)))return 'an additional own hand-equivalent cost modifier requires a reviewed Activate payment layer (R514)';
 const standing=underCounterExternalCostProblem(ctx,game,state,line.card,o.master);if(standing)return `under-card Activate modifier: ${standing} (R514)`;
 const attrs=attrsNow(ctx,game,state,line.card);
 for(const e of state.effects){
  if(!['cost','specifiedCost','skillCost','altCost'].includes(e.kind)||(e.uses??1)<=0||!energyActivationReaches(e.energyActivation,line.skill)||e.skillKind&&!line.kind.startsWith(e.skillKind)||!activateTimingReaches(line.skill,e.activateTiming))continue;
  let actual=e.target===line.card,potential=false;
  if(!e.target&&e.matching){
   const sel=e.matching.sel;
   actual=resolveSelector(ctx,game,state,{card:e.source??line.card,master:e.master,ops:[],ip:0,vars:e.matching.vars},sel).includes(line.card);
   if((sel.area==='hand'||sel.areas?.includes('hand'))&&((sel.side??'you')==='both'||(sel.side??'you')==='you'&&e.master===o.master||sel.side==='opponent'&&e.master!==o.master)&&(!sel.filter||predicateOf(sel.filter,game)(attrs)))potential=true;
  }
  if(potential||actual&&(e.uses!==undefined||e.kind==='skillCost'||e.kind==='altCost'))return 'a hand-equivalent or consumable Extra payment modifier requires a reviewed under-card continuation (R514)';
 }
 return null;
}
