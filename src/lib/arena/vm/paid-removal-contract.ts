/** R516 exact printed payment/body contract.
 * Pure validation of caller-supplied facts, not native ctx/state authentication.
 * Native integration obtains original source/payer facts and rejects copied
 * or unauthorized waived routes before calling these helpers. MovementOutcome
 * is trusted output from the existing native writer, not independently proved here.
 */
import type {PlayerId,Skill} from '../types';
import type {Script,Op} from './script';
import type {Attrs} from './cards';
import type {MovementOutcome} from './movement-result';
import {emptyFilter} from '../text/filters';
import {zeroSkillPrice} from './skill-payment';
import {canonicalTaxValue as canonical} from './tax-receipt';
import {IllegalAction} from './illegal-action';

export const PAID_REMOVAL_ALIAS='paid_removed';
function fail():never {throw new IllegalAction('rebuild the exact original paid Battle removal history');}
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const integer=(x:unknown):x is number=>Number.isSafeInteger(x)&&Number(x)>=0;
const name=(x:unknown):x is string=>typeof x==='string'&&/^\w+$/.test(x)&&x!==PAID_REMOVAL_ALIAS;
const normalized=(x:unknown)=>JSON.parse(JSON.stringify(x, (key,value)=>key==='reason'||key==='upTo'&&value===false?undefined:value));
const same=(a:unknown,b:unknown)=>canonical(normalized(a))===canonical(normalized(b));
const phrase=(x:string)=>x.trim().replace(/\s+/g,' ').replace(/\.$/,'').toLowerCase();

/** Exact body uses the existing historical predicate, never current Removed membership. */
export function paidRemovalTail():Op {
 return {op:'if',cond:{kind:'varMatches',var:PAID_REMOVAL_ALIAS,paid:true,filter:{...emptyFilter(),token:true}},then:[{op:'draw',n:1}]};
}
export function requirePaidRemovalShape(skill:Skill,script:Script):void {
 if(!object(skill)||!object(script)||!Array.isArray(script.ops)||!script.price||!object(script.price))fail();
 if(skill.kind!=='activate:battle'||(!Array.isArray(skill.tags)||skill.tags.some(t=>typeof t!=='string')||canonical(skill.tags.map(t=>t.toLowerCase()))!==canonical(['activate: battle']))||skill.oncePerTurn||skill.limit!==null||skill.bond!==null||skill.sparking!==null||skill.burst!==null||skill.spiritBoost!==null||skill.markerCost!==null||canonical(skill.energyCost)!=='{}'||canonical(skill.energyEither)!=='[]'||skill.granted||skill.grants||skill.keyword)fail();
 if(typeof skill.cost!=='string'||phrase(skill.cost)!=='remove 1 of your skill-less battle cards from the game'||typeof skill.effect!=='string'||phrase(skill.effect)!=='choose up to 1 of your battle cards and it gets +10000 power for the battle. additionally, if you used this skill to remove a token from the game, draw 1 card')fail();
 const choice=script.price.ops?.[0],target=script.ops[0];
 if(choice?.op!=='choose'||!name(choice.as)||target?.op!=='choose'||!name(target.as))fail();
 const price={...zeroSkillPrice(),ops:[{op:'choose',sel:{side:'you',area:'battle',filter:{...emptyFilter(),type:'BATTLE',skillLess:true},count:1,upTo:false},as:choice.as},{op:'moveTo',target:{var:choice.as},to:'removed'}]};
 const ops=[{op:'choose',sel:{side:'you',area:'battle',filter:{...emptyFilter(),type:'BATTLE'},count:1,upTo:true},as:target.as},{op:'power',target:{var:target.as},amount:10000,until:'battle'},paidRemovalTail()];
 if(script.kind!=='activate:battle'||script.trigger!==undefined&&canonical(script.trigger)!=='[]'||canonical(script.unsupported)!=='[]'||canonical(script.usage)!==canonical({version:1,oncePerTurn:false,limit:null})||canonical(script.validity)!==canonical({version:1,sparking:null})||script.combo!=null||script.paidAdmission||script.keepResolutionCondition||script.playReplacement||!same(script.price,price)||!same(script.ops,ops))fail();
}
export interface PaidRemovalSource {
 version:1;card:string;cardId:string;master:PlayerId;skillIndex:number;epoch:number;canonicalSource:string;
}
export interface PaidRemovalCurrentSource {card:string;cardId:string;master:PlayerId;skillIndex:number;epoch:number}
export interface PaidRemovalPayer {card:string;epoch:number;area:string;holder:PlayerId;attributes:Attrs}
export interface PaidRemovalCapture {version:1;source:PaidRemovalSource;payer:PaidRemovalPayer}
export interface PaidRemovalWaiver {version:1;source:PaidRemovalSource;kind:'authorized-empty'}
function sourceKey(skill:Skill,script:Script):string {requirePaidRemovalShape(skill,script);return canonical({skill,script:normalized(script)});}
export function capturePaidRemovalSource(skill:Skill,script:Script,current:PaidRemovalCurrentSource):PaidRemovalSource {
 const value:PaidRemovalSource={version:1,...current,canonicalSource:sourceKey(skill,script)};
 requirePaidRemovalSource(skill,script,value,current);return structuredClone(value);
}
export function requirePaidRemovalSource(skill:Skill,script:Script,value:unknown,current:PaidRemovalCurrentSource):asserts value is PaidRemovalSource {
 const key=sourceKey(skill,script);
 if(!object(value)||value.version!==1||typeof value.card!=='string'||!value.card||typeof value.cardId!=='string'||!value.cardId||!['p1','p2'].includes(String(value.master))||!integer(value.skillIndex)||!integer(value.epoch)||value.card!==current.card||value.cardId!==current.cardId||value.master!==current.master||value.skillIndex!==current.skillIndex||value.skillIndex!==skill.index||!integer(current.epoch)||current.epoch<value.epoch||value.canonicalSource!==key)fail();
}
function requirePayer(value:unknown,master:PlayerId):asserts value is PaidRemovalPayer {
 if(!object(value)||typeof value.card!=='string'||!value.card||!integer(value.epoch)||value.area!=='battle'||value.holder!==master||!object(value.attributes))fail();
 const a=value.attributes;
 if(Object.values(a).some(v=>!(typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||Array.isArray(v)&&v.every(x=>typeof x==='string')))||!['BATTLE','Z-BATTLE','TOKEN'].includes(String(a.type))||a.skillLess!==true)fail();
}
export function capturePaidRemoval(skill:Skill,script:Script,source:PaidRemovalSource,current:PaidRemovalCurrentSource,payer:PaidRemovalPayer):PaidRemovalCapture {
 requirePaidRemovalSource(skill,script,source,current);requirePayer(payer,current.master);
 return structuredClone({version:1,source,payer});
}
/** Pending validation never reconstructs a missing capture from the current payer. */
export function requirePendingPaidRemoval(skill:Skill,script:Script,value:unknown,current:PaidRemovalCurrentSource,payer:PaidRemovalPayer):asserts value is PaidRemovalCapture {
 if(!object(value)||value.version!==1)fail();
 requirePaidRemovalSource(skill,script,value.source,current);requirePayer(value.payer,current.master);requirePayer(payer,current.master);
 if(canonical(value.payer)!==canonical(payer))fail();
}
/** Isolated adapter to the existing paidCardInfo shape, not another movement receipt API. */
export function completedPaidRemovalInfo(skill:Skill,script:Script,value:unknown,current:PaidRemovalCurrentSource,outcome:MovementOutcome):Record<string,Attrs> {
 if(!object(value)||value.version!==1)fail();requirePaidRemovalSource(skill,script,value.source,current);requirePayer(value.payer,current.master);
 const payer=value.payer;
 if(!object(outcome)||outcome.card!==payer.card||outcome.from!=='battle'||outcome.to!=='removed'||outcome.completed!==true||outcome.fromEpoch!==payer.epoch||!integer(outcome.toEpoch)||outcome.toEpoch!==payer.epoch+1||outcome.host!==undefined)fail();
 return {[payer.card]:structuredClone(payer.attributes)};
}
/** Caller authorization is separate from saved data; no native waiver route is admitted by this helper. */
export function authorizedEmptyPaidRemovalInfo(skill:Skill,script:Script,value:unknown,current:PaidRemovalCurrentSource,authorized:boolean):Record<string,Attrs> {
 if(!authorized||!object(value)||value.version!==1||value.kind!=='authorized-empty'||Object.keys(value).some(k=>!['version','source','kind'].includes(k)))fail();
 requirePaidRemovalSource(skill,script,value.source,current);return {};
}
