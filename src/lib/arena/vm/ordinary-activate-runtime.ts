import { paidRemovalIntent, captureSelectedRemoval, recordSelectedRemoval, requirePaidRemovalFrame } from './paid-removal-runtime';
import { requirePaidRemovalShape } from './paid-removal-contract';
/** Original ordinary Activate price completion. Dedicated keyword/Extra runners stay separate. */
import type {EngineContext,GameEvent,PlayerId,Action} from '../types';
import type {GameDefinition} from '../rulesets';
import type {VmState} from './state';
import {stepScript,type ScriptFrame,type Script} from './script';
import {activationMoment,type ActivationLine} from './activate';
import {skillsShowing} from './triggers';
import {hostOf} from './zones';
import {hasDropActionPrice} from './drop-costs';
import {isFieldPayment} from './field-costs';
import {effectOccurrence,executionReceipt} from './applied-effect-receipt';
import {beginOrdinaryActivateCost,requireOrdinaryActivateCost,requireOrdinaryActivatePair,finishOrdinaryActivateCost,ordinaryActivateCompletionX,type OrdinaryActivateCost} from './ordinary-activate-cost';
import {vmHost} from './host';
import {programsOf} from './common';
import {withUsage} from './usage';
import {withValidity} from './validity';
import {recordedSkillIdentity} from './skill-identity';
import {parseSkills} from '../text/cards';
import {canonicalTaxValue as canonical} from './tax-receipt';
import {IllegalAction} from './illegal-action';
import {NotYet} from './errors';
import {fire} from './events';
import {savedXKey} from './script';
export interface OrdinaryActivation {useGeneration:number;cost:OrdinaryActivateCost;moment:ReturnType<typeof activationMoment>}
function fail():never {throw new IllegalAction('rebuild the original ordinary Activate payment');}
export function ordinaryActionPrice(state:VmState,line:ActivationLine):boolean {
 return !line.keyword&&!line.activateUnderOrigin&&!isFieldPayment(line)&&!hasDropActionPrice(state,line)&&!!line.script?.price?.ops?.length;
}
/** A menu refusal, with no state or generation initialization. */
export function ordinaryActivationProblem(ctx:EngineContext,state:VmState,line:ActivationLine):string|null {
 if(!ordinaryActionPrice(state,line))return null;
 if(paidRemovalIntent(line.script)){try{requirePaidRemovalShape(line.skill,line.script!);}catch{return 'historical removal needs its exact original price and body (R516)';}}
 const inst=state.cards[line.card],def=inst&&ctx.defs[inst.cardId];
 const own=def&&programsOf(ctx,def,inst.flipped?'back':'front').bySkill[line.skillIndex];
 return !own||canonical(own)!==canonical(line.script)||line.skill.granted||line.skill.grants?'copied ordinary Activate action prices require a reviewed original usage contract (R515)':null;
}
/** Called before resources and again before staging, never reconstructed from Drop. */
export function captureOrdinaryActivation(ctx:EngineContext,game:GameDefinition,state:VmState,player:PlayerId,line:ActivationLine):OrdinaryActivation|undefined {
 if(!ordinaryActionPrice(state,line))return;
 const inst=state.cards[line.card];if(!inst)fail();
 if(paidRemovalIntent(line.script))requirePaidRemovalShape(line.skill,line.script!);
 const source={occurrence:effectOccurrence(state,line.card),master:player,skill:line.skill,script:line.script!,flipped:inst.flipped,priceContext:{optionalOwnDiscard:!!vmHost(ctx,game,state,[]).permits?.('ownDiscardOptional',line.card)}};
 const useGeneration=inst.ordinaryUseGeneration??0;
 const value={useGeneration,cost:beginOrdinaryActivateCost(source),moment:activationMoment(ctx,game,state,player,line)};
 inst.ordinaryUseGeneration??=useGeneration;
 requireOrdinaryActivation(ctx,state,value,line.card,player,line.skillIndex);
 return value;
}
/** Authenticate original stored face, allowing genuine later source occurrences. */
export function requireOrdinaryActivation(ctx:EngineContext,state:VmState,value:OrdinaryActivation|undefined,card:string,master:PlayerId,index:number|undefined):Script {
 if(!value||!value.cost||!value.cost.source)fail();
 const s=value.cost.source;
 requireOrdinaryActivateCost(value.cost,s);
 const def=ctx.defs[s.occurrence.cardId],script=def&&programsOf(ctx,def,s.flipped?'back':'front').bySkill[s.skill.index];
 const printed=def&&parseSkills((s.flipped?def.back?.skill:def.skill)??null).find(sk=>sk.index===s.skill.index);
 const skill=printed&&script?withValidity(withUsage(recordedSkillIdentity(printed,script),script.usage),script.validity):undefined;
 const inst=state.cards[card];
 if(card!==s.occurrence.card||master!==s.master||index!==s.skill.index||!script||canonical(script)!==canonical(s.script)||canonical(skill)!==canonical(s.skill)||!inst||inst.cardId!==s.occurrence.cardId||!Number.isSafeInteger(inst.zoneEpoch??0)||(inst.zoneEpoch??0)<s.occurrence.epoch)fail();
 const expected={event:'skillActivated',card,controller:master,args:{kind:'activate',from:s.occurrence.area,paid:true,extra:def.type==='EXTRA',cardActivation:def.type==='EXTRA'&&s.occurrence.area==='hand'}};
 if(canonical(value.moment)!==canonical(expected)||!Number.isSafeInteger(value.useGeneration)||value.useGeneration<0||!Number.isSafeInteger(inst.ordinaryUseGeneration)||inst.ordinaryUseGeneration!<value.useGeneration)fail();
 return script;
}
export function stepOrdinaryActivateCost(ctx:EngineContext,game:GameDefinition,state:VmState,ev:GameEvent[],frame:ScriptFrame):'done'|'wait' {
 const saved=frame.ordinaryActivation;
 requireOrdinaryActivation(ctx,state,saved,frame.card,frame.master,frame.skillIndex);
 if(!saved||!frame.saveVarsAs||saved.cost.phase!=='paying')fail();
 const frames=()=>[frame,...state.programs];
 const pair=requireOrdinaryActivatePair(saved.cost,frames());
 if(canonical(pair.effect.ordinaryActivation)!==canonical(saved))fail();
 requirePaidRemovalFrame(ctx,game,state,frame,saved.cost.source.script);
 const paidRemoval=paidRemovalIntent(saved.cost.source.script);
 const host=vmHost(ctx,game,state,ev,frame);
 const failed=(why:string)=>{
  const result=finishOrdinaryActivateCost(saved.cost,saved.cost.source,frames(),'failed');
  saved.cost=result.continuation;host.priceUnpaid(saved.cost.key,why);
 };
 const strict={...host,
  resolveRef:(...args:Parameters<typeof host.resolveRef>)=>{
   const found=host.resolveRef(...args),op=args[0].ops[args[0].ip],ref=args[1];
   if(op&&['moveTo','ko','comboFrom','switchMode','hidden','placeOnTop'].includes(op.op)&&'target' in op&&op.target===ref){
    if(!found.length&& !('var' in ref&&frame.vars[ref.var]?.length===0))frame.priceUnpaid??='the payment target is no longer present';
    if(op.op==='moveTo'&&found.some(id=>host.areaOf(id)==='leader'))frame.priceUnpaid??='the payment cannot move a Leader';
    if(op.op==='switchMode'&&found.some(id=>host.modeOf(id)===op.mode))frame.priceUnpaid??='the payment must actually change mode';
    if(op.op==='hidden'&&found.some(id=>!['battle','energy','unison'].includes(host.areaOf(id)??'')||host.isHidden(id)===op.hidden))frame.priceUnpaid??='the payment must actually change Hidden Mode';
   }
   if(paidRemoval&&op?.op==='moveTo'&&op.target===ref&&!frame.priceUnpaid)captureSelectedRemoval(ctx,game,state,frame,found);
   return frame.priceUnpaid?[]:found;
  },
  setMode:(...args:Parameters<typeof host.setMode>)=>{const done=host.setMode(...args);if(!done)frame.priceUnpaid??='the mode payment did not complete';return done;},
  placeUnder:(...args:Parameters<typeof host.placeUnder>)=>{let complete=false;const done=host.placeUnder(args[0],args[1],args[2],r=>{complete=r.completed;args[3]?.(r);});if(!done||!complete)frame.priceUnpaid??='the under placement price did not complete';return done;},
  replacementsFor:(...args:Parameters<typeof host.replacementsFor>)=>host.replacementsFor(args[0],args[1]==='ko'?'ko':'cost',{...args[2],actor:undefined}),
  move:(...args:Parameters<typeof host.move>)=>{
   const [id,to,owner,opts]=args;let completed=false;
   const actual=host.move(id,to,owner,{...opts,reason:opts?.reason==='combo'&&to==='combo'?'combo':'cost',onResult:r=>{completed=r.completed&&r.from!==r.to;if(paidRemoval)recordSelectedRemoval(frame,r);opts?.onResult?.(r);}});
   if(!completed)frame.priceUnpaid="the original movement price did not complete";return actual;
  },
  ko:(...args:Parameters<typeof host.ko>)=>{
   const [id,by,opts]=args;let completed=false;
   host.ko(id,by,{...opts,onKoResult:r=>{completed=r.moved&&!r.route.skillReplacementApplied&&r.to==='drop';opts?.onKoResult?.(r);}});
   if(!completed)frame.priceUnpaid="the original KO price did not complete";
  },
  saveVars:(...args:Parameters<typeof host.saveVars>)=>{
   if(args[0]!==saved.cost.key)fail();
   if(paidRemoval){requirePaidRemovalFrame(ctx,game,state,frame,saved.cost.source.script);if(!frame.paidRemoval?.outcome?.completed)fail();pair.effect.paidRemoval=structuredClone(frame.paidRemoval);}
   const result=finishOrdinaryActivateCost(saved.cost,saved.cost.source,frames(),'paid');
   const s=saved.cost.source,inst=state.cards[frame.card];
   const same=inst&&inst.cardId===s.occurrence.cardId&&inst.ordinaryUseGeneration===saved.useGeneration;
   const used=result.usage?.kind==='limit'?(state.sides[result.usage.master].limitUses?.[result.usage.key]??0):0;
   if(!Number.isSafeInteger(used)||used<0)fail();
   if(result.usage?.kind==='limit'&&used>=result.usage.maximum||result.usage?.kind==='once'&&same&&inst.usedThisTurn.includes(s.skill.index)||s.script.price?.payment?.marker!=null&&same&&inst.usedMarkerSkill) { failed('the original skill usage was consumed before payment completed'); return; }
   saved.cost=result.continuation;pair.effect.ordinaryActivation=structuredClone(saved);
   if(result.usage?.kind==='limit'){
    const ledger=state.sides[result.usage.master].limitUses??={};ledger[result.usage.key]=(ledger[result.usage.key]??0)+1;
   }
   if(result.usage&&same)inst.usedThisTurn.push(s.skill.index);
   if(s.script.price?.payment?.marker!=null&&same)inst.usedMarkerSkill=true;
   if(result.announce){host.saveVars(...args);fire(ctx,game,state,saved.moment);}
  },
  saveX:(key:string,x:number)=>{
   if(saved.cost.phase==='failed')return;
   if(key!==savedXKey(saved.cost.key))fail();
   pair.effect.x=ordinaryActivateCompletionX(saved.cost,saved.cost.source,frames(),x);
  },
  priceUnpaid:(key:string,why:string)=>{if(key!==saved.cost.key)fail();failed(why);},
 };
 executionReceipt(state,frame);return stepScript(strict,frame);
}
/** Old ordinary action-price saves lack the authentic before-payment source. */
export function requireOrdinaryPriceFrame(frame:ScriptFrame):void {
 if((frame.saveVarsAs||frame.pricedBy)&&!frame.awakenPayment&&!frame.viaKeyword&&!frame.ordinaryActivation)throw new NotYet('rebuild the saved ordinary Activate payment source','R515');
}

/** Resource questions have not paid yet: require the original current source. */
export function requireOrdinaryResourceDeclaration(ctx:EngineContext,state:VmState,value:OrdinaryActivation|undefined,action:Action):void {
 if(action.type!=='activate'){if(value)fail();return;}
 if(!Number.isSafeInteger(action.skill))fail();
 const showing=skillsShowing(ctx,state,action.card),sk=showing.skills.find(s=>s.index===action.skill);
 const line=sk?{card:action.card,skillIndex:sk.index,skill:sk,script:showing.scripts.bySkill[sk.index],kind:sk.kind}:undefined;
 const expected=!!line&&sk?.kind.startsWith('activate:')&&!hostOf(state,action.card)&&ordinaryActionPrice(state,line);
 if(!value){if(expected)fail();return;}
 requireOrdinaryActivation(ctx,state,value,action.card,action.player,action.skill);
 const s=value.cost.source,inst=state.cards[action.card];
 if(!expected||value.cost.phase!=='paying'||canonical(effectOccurrence(state,action.card))!==canonical(s.occurrence)||inst.flipped!==s.flipped||inst.ordinaryUseGeneration!==value.useGeneration)fail();
}
