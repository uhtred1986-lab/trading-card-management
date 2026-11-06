/** R525 native authority comes from the original R515 declaration and actual whole-Hand resolution. */
import type {EngineContext} from '../types';
import type {GameDefinition} from '../rulesets';
import type {VmState} from './state';
import type {Script,ScriptFrame} from './script';
import type {ActivationLine} from './activate';
import {activationTaxes} from './activate';
import {requireOrdinaryActivation} from './ordinary-activate-runtime';
import {findCard,hostOf} from './zones';
import {vmHost} from './host';
import {startMovementResult} from './movement-result';
import {canonicalTaxValue as canonical} from './tax-receipt';
import {NotYet} from './errors';
import {HAND_PAYERS,PAID_HAND,allHandPaymentMove,paidHandIntent,requirePaidHandShape,captureHandPayment,requireHandProgress,completeHandPayment,handPaymentRebuild as fail} from './paid-hand-contract';
export function paidHandFrameIntent(f:ScriptFrame):boolean {return f.paidHand!==undefined||paidHandIntent(f)||paidHandIntent(f.ordinaryActivation?.cost?.source?.script);}
export function paidHandProblem(ctx:EngineContext,game:GameDefinition,state:VmState,line:ActivationLine):string|null {
 if(!paidHandIntent(line.script))return null;
 try{requirePaidHandShape(line.skill,line.script!);}catch{return 'the entire-Hand price needs its exact complete original skill (R525)';}
 const c=state.cards[line.card],at=findCard(state,line.card),def=c&&ctx.defs[c.cardId];
 if(!c||!at||def?.type!=='LEADER'||at.zone!=='leader'||at.owner!==c.owner||c.hidden||hostOf(state,line.card))return 'the entire-Hand payment requires its original top normal Leader (R525)';
 if(line.skill.granted||line.skill.grants)return 'copied entire-Hand prices need a reviewed source (R525)';
 if(!state.sides[at.owner].zones.hand.length)return 'this ability cannot activate with no cards in hand (R525)';
 if(vmHost(ctx,game,state,[]).permits?.('ownDiscardOptional',line.card))return 'optional own-discard instructions need a reviewed entire-Hand payment (R525)';
 if(activationTaxes(ctx,game,state,at.owner,line.card,line.kind).length)return 'additional activation taxes need a reviewed entire-Hand payment (R525)';
 return null;
}
function original(ctx:EngineContext,state:VmState,frame:ScriptFrame){
 if(!frame.ordinaryActivation)fail();requireOrdinaryActivation(ctx,state,frame.ordinaryActivation,frame.card,frame.master,frame.skillIndex);
 const source=frame.ordinaryActivation.cost.source;requirePaidHandShape(source.skill,source.script);
 if(source.occurrence.area!=='leader'||source.occurrence.holder!==source.master||source.priceContext.optionalOwnDiscard||ctx.defs[source.occurrence.cardId]?.type!=='LEADER')fail();
 const c=state.cards[frame.card],at=findCard(state,frame.card);
 if(!c||c.cardId!==source.occurrence.cardId||(c.zoneEpoch??0)!==source.occurrence.epoch||(c.hiddenCount??0)!==source.occurrence.hiddenCount||c.hidden||c.flipped!==source.flipped||at?.zone!=='leader'||at.owner!==source.master||hostOf(state,frame.card))throw new NotYet('resolve the entire-Hand skill after an unreviewed original Leader transition','R525');
 return source;
}
export function captureAllHandPayment(ctx:EngineContext,state:VmState,frame:ScriptFrame,ids:string[]):void {
 const source=original(ctx,state,frame);if(!frame.saveVarsAs||!allHandPaymentMove(frame.ops[frame.ip]))fail();
 const existing=frame.paidHand;
 if(existing){if(existing.published||!existing.capture||canonical(captureHandPayment(source,existing.capture.selected))!==canonical(existing.capture)||canonical(ids)!==canonical(existing.capture.selected.map(p=>p.card)))fail();return;}
 if(frame.moveLoop||frame.ip!==0||frame.movementResults?.[HAND_PAYERS]||frame.vars[HAND_PAYERS]||frame.vars[PAID_HAND])fail();
 const hand=state.sides[frame.master].zones.hand;if(canonical(ids)!==canonical(hand))fail();
 const selected=ids.map(id=>{const c=state.cards[id],at=findCard(state,id);if(!c||at?.zone!=='hand'||at.owner!==frame.master)fail();return {card:id,epoch:c.zoneEpoch??0,hiddenCount:c.hiddenCount??0,owner:c.owner};});
 frame.paidHand={capture:captureHandPayment(source,selected)};
 startMovementResult(frame,HAND_PAYERS,selected.map(p=>({card:p.card,epoch:p.epoch})));
}
export function requirePaidHandFrame(ctx:EngineContext,state:VmState,frame:ScriptFrame,script?:Script):void {
 if(!paidHandFrameIntent(frame)&&!paidHandIntent(script))return;
 const source=original(ctx,state,frame);
 if(!Array.isArray(frame.ops)||!frame.vars||typeof frame.vars!=='object'||Array.isArray(frame.vars)||!Number.isSafeInteger(frame.ip)||frame.ip<0||frame.ip>(frame.saveVarsAs?1:2))fail();
 if(frame.taxGate||frame.copiedSkillCapture||frame.autoCost||frame.counterCost)throw new NotYet('resolve a specialized entire-Hand payment continuation','R525');
 const saved=frame.paidHand;
 if(frame.saveVarsAs){
  if(canonical(frame.ops)!==canonical(source.script.price!.ops))fail();
  if(!saved){if(frame.paidHand!==undefined||frame.moveLoop||frame.awaiting||frame.replacementMove||frame.replacing||frame.ip>0||Object.keys(frame.vars).length||frame.movementResults!==undefined)fail();return;}
  if(!saved.capture||!Array.isArray(saved.capture.selected)||saved.published||frame.vars[PAID_HAND]!==undefined)fail();
  const result=frame.movementResults?.[HAND_PAYERS];if(!result||!Array.isArray(result.outcomes))fail();
  const cursor=frame.moveLoop?.index??(frame.ip===1?saved.capture.selected.length:0);
  const processed=cursor+(frame.priceUnpaid&&result.outcomes.length===cursor+1?1:0);
  requireHandProgress(source,saved.capture,result,processed);
  if(result.outcomes.some(r=>!r.completed)&&!frame.priceUnpaid)fail();
  for(const p of saved.capture.selected.slice(0,processed)){const c=state.cards[p.card];if(c&&(c.owner!==p.owner||!Number.isSafeInteger(c.hiddenCount??0)||(c.hiddenCount??0)<p.hiddenCount))fail();}
  if(frame.moveLoop){const l=frame.moveLoop;if(l.kind!=='moveTo'||canonical(l.ids)!==canonical(saved.capture.selected.map(p=>p.card))||!Number.isSafeInteger(l.index)||l.index!==cursor||l.to!=='drop'||l.reveal!==true||l.reason!=='effect'||l.position!==undefined||l.mode!==undefined||l.faceUp!==undefined||l.owner!==undefined&&l.owner!==frame.master||l.leftBattle!==undefined&&l.leftBattle!==false||frame.ip!==0)fail();}
  else if(frame.ip!==1)fail();
  if(frame.awaiting!==undefined&&frame.awaiting!=='replaceMove')fail();
  if(frame.replacementMove){const p=saved.capture.selected[processed],r=frame.replacementMove;if(!p||r.card!==p.card||r.epoch!==p.epoch||r.completedAs!==HAND_PAYERS)fail();}
  if(canonical(frame.vars[HAND_PAYERS])!==canonical(saved.capture.selected.map(p=>p.card)))fail();
  // A substituted original attempt has already failed. Its child may move
  // further payers; this history can only reach R515 failure, never publication.
  const substitutedFailure=!!frame.priceUnpaid&&result.outcomes.at(-1)?.completed===false;
  for(const p of substitutedFailure?[]:saved.capture.selected.slice(processed)){const c=state.cards[p.card],at=findCard(state,p.card);if(!c||c.owner!==p.owner||(c.zoneEpoch??0)!==p.epoch||(c.hiddenCount??0)!==p.hiddenCount||at?.zone!=='hand'||at.owner!==frame.master)fail();}
 }else{
  if(!saved?.published||!saved.capture||canonical(frame.ops)!==canonical(source.script.ops))fail();
  const result=frame.movementResults?.[PAID_HAND];if(!result)fail();completeHandPayment(source,saved.capture,result);
  if(canonical(frame.vars[PAID_HAND])!==canonical(saved.capture.selected.map(p=>p.card))||canonical(frame.vars[HAND_PAYERS])!==canonical(frame.vars[PAID_HAND]))fail();
  for(const r of result.outcomes){const c=state.cards[r.card];if(c&&(!Number.isSafeInteger(c.zoneEpoch??0)||(c.zoneEpoch??0)<r.toEpoch))fail();}
 }
}
/** Called only after R515 has accepted complete payment and original usage availability. */
export function publishPaidHand(ctx:EngineContext,state:VmState,frame:ScriptFrame,effect:ScriptFrame):void {
 requirePaidHandFrame(ctx,state,frame);const source=original(ctx,state,frame),saved=frame.paidHand;if(!saved||saved.published)fail();
 const result=frame.movementResults?.[HAND_PAYERS];if(!result)fail();completeHandPayment(source,saved.capture,result);
 effect.paidHand={...structuredClone(saved),published:true};
 (effect.movementResults??={})[PAID_HAND]=structuredClone(result);
 effect.vars[PAID_HAND]=saved.capture.selected.map(p=>p.card);
}
