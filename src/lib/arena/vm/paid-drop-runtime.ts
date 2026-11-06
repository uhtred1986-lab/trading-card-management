/** Native R518 source/selection binding; pure contracts never infer missing history. */
import type {EngineContext} from '../types';
import type {GameDefinition} from '../rulesets';
import type {VmState} from './state';
import type {Script,ScriptFrame} from './script';
import type {ActivationLine} from './activate';
import type {MovementOutcome} from './movement-result';
import {validateMovementResult} from './movement-result';
import {attrsNow} from './program';
import {vmHost} from './host';
import {findCard} from './zones';
import {IllegalAction} from './illegal-action';
import {canonicalTaxValue as canonical} from './tax-receipt';
import {paidDropPayerPayable} from './paid-drop-preflight';
import {PAID_OWN_DROP,paidDropIntent,requirePaidDropShape,paidDropDeclaration,capturePaidDrop,requirePendingPaidDrop,requirePaidDropCapture,completedPaidDropInfo,type PaidDropResult,type PaidDropPayer} from './paid-drop-contract';
function fail():never {throw new IllegalAction('rebuild the original owner-Drop paid history (R518)');}
function original(frame:ScriptFrame){const s=frame.ordinaryActivation?.cost?.source;if(!s)fail();paidDropDeclaration(s);return s;}
function payer(ctx:EngineContext,game:GameDefinition,state:VmState,id:string):PaidDropPayer {
 const c=state.cards[id],at=findCard(state,id);if(!c||!at)fail();
 return {card:id,cardId:c.cardId,owner:c.owner,holder:at.owner,area:at.zone,epoch:c.zoneEpoch??0,hiddenCount:c.hiddenCount??0,flipped:c.flipped,attributes:attrsNow(ctx,game,state,id)};
}
export function paidDropCandidates(ctx:EngineContext,game:GameDefinition,state:VmState,source:{card:string;master:ScriptFrame['master']},script:Script):string[]{
 const choice=script.price?.ops?.[0];if(choice?.op!=='choose')fail();
 const frame:ScriptFrame={...source,ops:[],ip:0,vars:{}};
 return vmHost(ctx,game,state,[]).resolveSelector(frame,choice.sel).filter(id=>paidDropPayerPayable(ctx,game,state,source,script,id));
}
export function paidDropProblem(ctx:EngineContext,game:GameDefinition,state:VmState,line:ActivationLine):string|null {
 if(!paidDropIntent(line.script))return null;
 try{requirePaidDropShape(line.skill,line.script!);}catch{return 'historical owner-Drop needs its exact original price and self-play body (R518)';}
 const at=findCard(state,line.card),c=state.cards[line.card];
 if(!at||at.zone!=='hand'||!c||c.owner!==at.owner||c.flipped)return 'the original owner-Drop skill must be declared by its owner from Hand (R518)';
 return paidDropCandidates(ctx,game,state,{card:line.card,master:at.owner},line.script!).length?null:'no selected in-play card can pay the original owner-Drop price';
}
export function captureSelectedDrop(ctx:EngineContext,game:GameDefinition,state:VmState,frame:ScriptFrame,ids:string[]):void {
 const s=original(frame);if(ids.length!==1)fail();
 if(frame.paidDrop){if(frame.paidDrop.outcome)fail();requirePendingPaidDrop(s,frame.paidDrop.capture,payer(ctx,game,state,ids[0]));return;}
 // Exact candidate projection is repeated at the actual instruction, not just the earlier menu.
 if(!paidDropPayerPayable(ctx,game,state,{card:frame.card,master:frame.master},s.script,ids[0])){frame.priceUnpaid='the selected original owner-Drop price cannot complete';return;}
 frame.paidDrop={capture:capturePaidDrop(s,payer(ctx,game,state,ids[0]))};
}
function outcomeShape(frame:ScriptFrame,r:MovementOutcome):void {
 const p=frame.paidDrop?.capture.payer;if(!p)fail();
 validateMovementResult({...frame,movementResults:{paid:{version:1,selected:[{card:p.card,epoch:p.epoch}],outcomes:[r]}}},'paid');
 if(r.from!==p.area||r.host!==undefined)fail();
}
export function recordSelectedDrop(ctx:EngineContext,game:GameDefinition,state:VmState,frame:ScriptFrame,r:MovementOutcome):void {
 const s=original(frame),saved=frame.paidDrop;if(!saved||saved.outcome)fail();outcomeShape(frame,r);saved.outcome=structuredClone(r);
 if(r.completed){const at=findCard(state,r.card);if(!at||at.zone!=='drop')fail();saved.destination={holder:at.owner,attributes:structuredClone(attrsNow(ctx,game,state,r.card))};
  const info=completedPaidDropInfo(s,saved);frame.vars[PAID_OWN_DROP]=Object.keys(info);(frame.paidCardInfo??={})[PAID_OWN_DROP]=info;
 }
}
export function requirePaidDropFrame(ctx:EngineContext,game:GameDefinition,state:VmState,frame:ScriptFrame,script:Script|undefined):void {
 if(!paidDropIntent(script)&&!frame.paidDrop)return;
 const s=original(frame);if(!Array.isArray(frame.ops)||!frame.vars||typeof frame.vars!=='object'||Array.isArray(frame.vars))fail();
 if(!frame.saveVarsAs&&canonical(frame.ops)!==canonical(s.script.ops))fail();
 const saved=frame.paidDrop;
 if(!saved){if(!frame.saveVarsAs||frame.ip>0||frame.moveLoop||frame.awaiting==='replaceMove'||frame.vars[PAID_OWN_DROP]||frame.paidCardInfo?.[PAID_OWN_DROP])fail();return;}
 requirePaidDropCapture(s,saved.capture);
 const selected=s.script.price!.ops![0];if(selected.op!=='choose')fail();
 if(frame.saveVarsAs&&canonical(frame.vars[selected.as])!==canonical([saved.capture.payer.card]))fail();
 if(!saved.outcome){if(!frame.saveVarsAs)fail();requirePendingPaidDrop(s,saved.capture,payer(ctx,game,state,saved.capture.payer.card));return;}
 outcomeShape(frame,saved.outcome);
 if(!saved.outcome.completed){if(!frame.saveVarsAs||!frame.priceUnpaid||saved.destination||frame.vars[PAID_OWN_DROP]||frame.paidCardInfo?.[PAID_OWN_DROP])fail();return;}
 const info=completedPaidDropInfo(s,saved);
 if(canonical(frame.vars[PAID_OWN_DROP])!==canonical(Object.keys(info))||canonical(frame.paidCardInfo?.[PAID_OWN_DROP])!==canonical(info))fail();
}
/** Retained Counter resumes bypass the interpreter; bind their original pending arrival before host dispatch. */
export function requirePaidDropResume(ctx:EngineContext,game:GameDefinition,state:VmState,frame:ScriptFrame,cards:string[]):void {
 if(!frame.paidDrop&&!paidDropIntent(frame.ordinaryActivation?.cost?.source?.script)&&!paidDropIntent(frame))return;const s=original(frame);requirePaidDropFrame(ctx,game,state,frame,s.script);
 if(cards.length!==1||cards[0]!==s.occurrence.card||!frame.pendingArrival&&!frame.arrivalBatch)fail();
 if(frame.pendingArrival&&(frame.pendingArrival.card!==s.occurrence.card||frame.pendingArrival.epoch!==s.occurrence.epoch))fail();
 if(frame.arrivalBatch&&(frame.arrivalBatch.cards.length!==1||frame.arrivalBatch.cards[0].card!==s.occurrence.card||frame.arrivalBatch.cards[0].epoch!==s.occurrence.epoch))fail();
}
export type PaidDropFrame=PaidDropResult;
