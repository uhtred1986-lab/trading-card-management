import type {GameDefinition} from '../rulesets';
import {attrsNow} from './program';
import {burstNegated} from './activate';
/** R522 exact Auto source and original movement-count transport. */
import type {EngineContext,Skill,PlayerId} from '../types';
import type {VmState} from './state';
import type {Script,ScriptFrame} from './script';
import {parseSkills} from '../text/cards';
import {programsOf} from './common';
import {withUsage} from './usage';
import {withValidity} from './validity';
import {recordedSkillIdentity} from './skill-identity';
import {canonicalTaxValue as canonical} from './tax-receipt';
import {findCard} from './zones';
import {NotYet} from './errors';
import {IllegalAction} from './illegal-action';
import {WARP_PAYERS,PAID_WARP,requirePaidWarpShape,paidWarpSourceKey,captureWarpSelection,requireWarpProgress,completedWarpPayers,type PaidWarpSource,type PaidWarpSelection} from './paid-warp-contract';
export interface PaidWarpFrame {source:PaidWarpSource;binding:string;selection?:PaidWarpSelection;published?:true}
function fail():never {throw new IllegalAction('rebuild the original Warp-count Auto source and payment (R522)');}
export function paidWarpIntent(script:Pick<Script,'ops'>|undefined):boolean {
 const walk=(v:unknown):boolean=>{if(!v||typeof v!=='object')return false;if(Array.isArray(v))return v.some(walk);const o=v as Record<string,unknown>;return o.op==='moveTo'&&o.completedAs===WARP_PAYERS||o.op==='choose'&&!!o.energyCostEquals&&typeof o.energyCostEquals==='object'&&(o.energyCostEquals as {var?:unknown}).var===PAID_WARP||Object.values(o).some(walk);};return walk(script?.ops);
}
export function requirePaidWarpSource(ctx:EngineContext,state:VmState,s:PaidWarpSource|undefined,card:string,master:PlayerId,index:number|undefined):Script {
 if(!s)fail();paidWarpSourceKey(s);
 const def=ctx.defs[s.cardId],inst=state.cards[card],stored=def&&programsOf(ctx,def,s.flipped?'back':'front').bySkill[s.skillIndex];
 const parsed=def&&parseSkills((s.flipped?def.back?.skill:def.skill)??null).find(sk=>sk.index===s.skillIndex);
 const skill=parsed&&stored?withValidity(withUsage(recordedSkillIdentity(parsed,stored),stored.usage),stored.validity):undefined;
 if(s.card!==card||s.master!==master||s.skillIndex!==index||!def||!['BATTLE','Z-BATTLE'].includes(def.type)||!inst||inst.cardId!==s.cardId||!Number.isSafeInteger(inst.zoneEpoch??0)||(inst.zoneEpoch??0)<s.epoch||canonical(stored)!==canonical(s.script)||canonical(skill)!==canonical(s.skill))fail();return s.script;
}
export function capturePaidWarpSource(ctx:EngineContext,state:VmState,card:string,master:PlayerId,skill:Skill,script:Script):PaidWarpSource {
 if(skill.granted||skill.grants)throw new NotYet('capture a copied or granted Warp-count Auto declaration','R522');
 requirePaidWarpShape(skill,script);const c=state.cards[card],at=findCard(state,card);if(!c||!at||at.zone!=='battle'||at.owner!==master||c.hidden)fail();
 const s:PaidWarpSource={version:1,card,cardId:c.cardId,master,skillIndex:skill.index,epoch:c.zoneEpoch??0,hiddenCount:c.hiddenCount??0,flipped:c.flipped,skill:structuredClone(skill),script:structuredClone(script)};
 requirePaidWarpSource(ctx,state,s,card,master,skill.index);return s;
}
/** R091: until alias-aware distinct-name selection is reviewed, do not ignore any known extra name. */
function requirePlainWarpNames(ctx:EngineContext,game:GameDefinition,state:VmState,ids:string[]):void {
 const intent=(v:unknown):boolean=>{if(!v||typeof v!=='object')return false;if(Array.isArray(v))return v.some(intent);const o=v as Record<string,unknown>;return o.op==='gains'&&Array.isArray(o.names)&&o.names.length>0||o.op==='modifyAttr'&&o.attr==='alsoNames'||Object.values(o).some(intent);};
 for(const id of ids){const c=state.cards[id],def=c&&ctx.defs[c.cardId];if(!c||!def)fail();const printed=(c.flipped?def.back?.skill:def.skill)??'';
  if(/also treated as\s*[{“"]/i.test(printed)||intent(programsOf(ctx,def,c.flipped?'back':'front'))||(attrsNow(ctx,game,state,id).alsoNames as unknown[]|undefined)?.length)throw new NotYet('pay this distinct-name Auto with an unreviewed additional-name pool','R522');
 }
}
export function requirePaidWarpPending(ctx:EngineContext,game:GameDefinition,state:VmState,s:PaidWarpSource|undefined,card:string,master:PlayerId,index:number):void {
 requirePaidWarpSource(ctx,state,s,card,master,index);const c=state.cards[card];
 requirePlainWarpNames(ctx,game,state,[...state.sides[master].zones.drop,...(!burstNegated(ctx,game,state,card)?state.sides[master].zones.deck.slice(0,1):[])]);
 if(state.sides[master].zones.drop.length>=99)throw new NotYet('pay an unbounded Warp-count price from an oversized synthetic Drop','R522');
 if((c.zoneEpoch??0)!==s!.epoch||(c.hiddenCount??0)!==s!.hiddenCount||c.flipped!==s!.flipped)throw new NotYet('activate this paid-count Auto after an unreviewed source occurrence change','R522');
}
function original(ctx:EngineContext,state:VmState,frame:ScriptFrame):PaidWarpFrame {
 const saved=frame.paidWarp;if(!saved||saved.binding!==paidWarpSourceKey(saved.source))fail();requirePaidWarpSource(ctx,state,saved.source,frame.card,frame.master,frame.skillIndex);return saved;
}
/** Actual selected move execution only, never selector/prohibition queries. */
export function captureSelectedWarp(ctx:EngineContext,state:VmState,frame:ScriptFrame,ids:string[],nameOf:(id:string)=>string):void {
 const saved=original(ctx,state,frame);if(saved.published)fail();
 if(saved.selection!==undefined){if(!saved.selection||canonical(captureWarpSelection(saved.source,saved.selection.selected))!==canonical(saved.selection)||canonical(saved.selection.selected.map(p=>p.card))!==canonical(ids))fail();return;}
 const selected=ids.map(id=>{const c=state.cards[id],at=findCard(state,id);if(!c||!at||at.zone!=='drop'||at.owner!==frame.master)fail();return {card:id,epoch:c.zoneEpoch??0,owner:c.owner,name:nameOf(id)};});
 saved.selection=captureWarpSelection(saved.source,selected);
}
export function paidWarpFrameIntent(frame:ScriptFrame):boolean {return frame.paidWarp!==undefined||paidWarpIntent(frame)||paidWarpIntent(frame.autoCost?{ops:frame.autoCost.effect}:undefined);}
export function requirePaidWarpFrame(ctx:EngineContext,game:GameDefinition,state:VmState,frame:ScriptFrame,script?:Script):void {
 if(!paidWarpFrameIntent(frame)&&!paidWarpIntent(script))return;
 const saved=original(ctx,state,frame),source=saved.source;
 if(!Array.isArray(frame.ops)||!frame.vars||typeof frame.vars!=='object'||Array.isArray(frame.vars)||!Number.isSafeInteger(frame.ip)||frame.ip<0||frame.ip>2)fail();
 if(frame.copiedSkillCapture||frame.taxGate||frame.autoCost?.taxGate)throw new NotYet('pay this Warp-count Auto through copied or taxed continuation','R522');
 if(frame.autoCost){
  if(canonical(frame.ops)!==canonical(source.script.price!.ops)||canonical(frame.autoCost.effect)!==canonical(source.script.ops)||canonical(frame.autoCost.skill)!==canonical(source.skill)||saved.published||frame.vars[PAID_WARP]!==undefined)fail();
  if(saved.selection===undefined){if(frame.moveLoop||frame.awaiting==='replaceMove'||frame.ip>0||frame.movementResults?.[WARP_PAYERS])fail();requirePlainWarpNames(ctx,game,state,state.sides[frame.master].zones.drop);return;}
  if(!saved.selection||!Array.isArray(saved.selection.selected))fail();
  const result=frame.movementResults?.[WARP_PAYERS];if(!result)fail();
  const processed=frame.moveLoop?.index??(frame.ip===2?saved.selection.selected.length:0);
  requireWarpProgress(source,saved.selection,result,processed);
  requirePlainWarpNames(ctx,game,state,saved.selection.selected.slice(processed).map(p=>p.card));
  if(canonical(frame.vars[WARP_PAYERS])!==canonical(saved.selection.selected.map(p=>p.card)))fail();
  for(const p of saved.selection.selected.slice(processed)){const c=state.cards[p.card],at=findCard(state,p.card);if(!c||c.owner!==p.owner||(c.zoneEpoch??0)!==p.epoch||at?.zone!=='drop'||at.owner!==frame.master)fail();}
 }else{
  if(!saved.published||!saved.selection||canonical(frame.ops)!==canonical(source.script.ops))fail();
  const result=frame.movementResults?.[WARP_PAYERS];if(!result)fail();const paid=completedWarpPayers(source,saved.selection,result);
  for(const r of result.outcomes){const c=state.cards[r.card];if(c&&(!Number.isSafeInteger(c.zoneEpoch??0)||(c.zoneEpoch??0)<r.toEpoch))fail();}
  if(canonical(frame.vars[PAID_WARP])!==canonical(paid)||canonical(frame.vars[WARP_PAYERS])!==canonical(paid))fail();
 }
}
export function publishPaidWarp(ctx:EngineContext,game:GameDefinition,state:VmState,frame:ScriptFrame):void {
 if(!frame.paidWarp&&!paidWarpIntent(frame.autoCost?{ops:frame.autoCost.effect}:undefined))return;
 requirePaidWarpFrame(ctx,game,state,frame);const saved=original(ctx,state,frame);if(!saved.selection||saved.published)fail();
 frame.vars[PAID_WARP]=completedWarpPayers(saved.source,saved.selection,frame.movementResults![WARP_PAYERS]);saved.published=true;
}
export function refusePaidWarpTax(frame:ScriptFrame,hasTax:boolean):void {if(frame.paidWarp&&hasTax)throw new NotYet('pay this Warp-count Auto with an additional activation tax','R522');}
