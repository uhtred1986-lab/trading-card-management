/** R516: bind one original selected removal to the authenticated ordinary price. */
import type {EngineContext} from '../types';
import type {GameDefinition} from '../rulesets';
import type {VmState} from './state';
import type {Script,ScriptFrame} from './script';
import type {MovementOutcome} from './movement-result';
import {validateMovementResult} from './movement-result';
import {findCard} from './zones';
import {attrsNow} from './program';
import {IllegalAction} from './illegal-action';
import {canonicalTaxValue as canonical} from './tax-receipt';
import {PAID_REMOVAL_ALIAS,capturePaidRemovalSource,capturePaidRemoval,requirePaidRemovalShape,requirePendingPaidRemoval,completedPaidRemovalInfo,type PaidRemovalCapture} from './paid-removal-contract';
export interface PaidRemovalFrame {capture:PaidRemovalCapture;outcome?:MovementOutcome}
function fail():never {throw new IllegalAction('rebuild the original selected removal payment (R516)');}
export function paidRemovalIntent(script:Script|undefined):boolean {
 const contains=(value:unknown):boolean=>{
  if(!value||typeof value!=='object')return false;
  if(Array.isArray(value))return value.some(contains);
  const node=value as Record<string,unknown>;
  return node.kind==='varMatches'&&node.paid===true&&node.var===PAID_REMOVAL_ALIAS||Object.values(node).some(contains);
 };
 return contains(script?.ops);
}
function original(frame:ScriptFrame){
 const source=frame.ordinaryActivation?.cost.source;if(!source)fail();
 requirePaidRemovalShape(source.skill,source.script);
 const current={card:source.occurrence.card,cardId:source.occurrence.cardId,master:source.master,skillIndex:source.skill.index,epoch:source.occurrence.epoch};
 return {source,current};
}
function payer(ctx:EngineContext,game:GameDefinition,state:VmState,id:string){
 const at=findCard(state,id),inst=state.cards[id];if(!at||!inst)fail();
 return {card:id,epoch:inst.zoneEpoch??0,area:at.zone,holder:at.owner,attributes:attrsNow(ctx,game,state,id)};
}
/** Called only while executing the represented move's actual target, before replacement suspension. */
export function captureSelectedRemoval(ctx:EngineContext,game:GameDefinition,state:VmState,frame:ScriptFrame,ids:string[]):void {
 const {source,current}=original(frame);if(ids.length!==1||frame.paidRemoval)fail();
 frame.paidRemoval={capture:capturePaidRemoval(source.skill,source.script,capturePaidRemovalSource(source.skill,source.script,current),current,payer(ctx,game,state,ids[0]))};
}
/** Writer completion, never a reconstructed current-area inference. */
export function recordSelectedRemoval(frame:ScriptFrame,outcome:MovementOutcome):void {
 const {source,current}=original(frame),saved=frame.paidRemoval;if(!saved||saved.outcome)fail();
 validateSavedOutcome(frame,outcome);
 saved.outcome=structuredClone(outcome);
 if(outcome.completed){
  const info=completedPaidRemovalInfo(source.skill,source.script,saved.capture,current,outcome);
  frame.vars[PAID_REMOVAL_ALIAS]=Object.keys(info);
  (frame.paidCardInfo??={})[PAID_REMOVAL_ALIAS]=info;
 }
}
function validateSavedOutcome(frame:ScriptFrame,outcome:MovementOutcome):void {
 const cap=frame.paidRemoval?.capture;if(!cap)fail();
 validateMovementResult({...frame,movementResults:{paid:{version:1,selected:[{card:cap.payer.card,epoch:cap.payer.epoch}],outcomes:[outcome]}}},'paid');
 if(outcome.from!=='battle'||outcome.host!==undefined)fail();
}
export function requirePaidRemovalFrame(ctx:EngineContext,game:GameDefinition,state:VmState,frame:ScriptFrame,script:Script|undefined):void {
 if(!paidRemovalIntent(script)&&!frame.paidRemoval)return;
 const {source,current}=original(frame);
 if(!Array.isArray(frame.ops)||!frame.vars||typeof frame.vars!=='object'||Array.isArray(frame.vars))fail();
 if(!frame.saveVarsAs&&canonical(frame.ops)!==canonical(source.script.ops))fail();
 const saved=frame.paidRemoval;
 if(!saved){
  if(!frame.saveVarsAs||frame.moveLoop||frame.awaiting==='replaceMove'||frame.ip>0||frame.paidCardInfo?.[PAID_REMOVAL_ALIAS]||frame.vars?.[PAID_REMOVAL_ALIAS])fail();
  return;
 }
 if(!saved.capture||!saved.capture.payer)fail();
 if(canonical(saved.capture.source)!==canonical(capturePaidRemovalSource(source.skill,source.script,current)))fail();
 // Validate historical structure independently of whether the paid card still exists.
 requirePendingPaidRemoval(source.skill,source.script,saved.capture,current,saved.capture.payer);
 const selected=source.script.price!.ops![0];if(selected.op!=='choose')fail();
 if(frame.saveVarsAs&&canonical(frame.vars[selected.as])!==canonical([saved.capture.payer.card]))fail();
 if(!saved.outcome){
  if(!frame.saveVarsAs)fail();
  requirePendingPaidRemoval(source.skill,source.script,saved.capture,current,payer(ctx,game,state,saved.capture.payer.card));
  return;
 }
 validateSavedOutcome(frame,saved.outcome);
 if(!saved.outcome.completed){if(!frame.saveVarsAs||!frame.priceUnpaid||frame.vars[PAID_REMOVAL_ALIAS]||frame.paidCardInfo?.[PAID_REMOVAL_ALIAS])fail();return;}
 const info=completedPaidRemovalInfo(source.skill,source.script,saved.capture,current,saved.outcome);
 if(canonical(frame.vars[PAID_REMOVAL_ALIAS])!==canonical(Object.keys(info))||canonical(frame.paidCardInfo?.[PAID_REMOVAL_ALIAS])!==canonical(info))fail();
}
