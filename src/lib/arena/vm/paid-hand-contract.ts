/** R525: one original whole-Hand price, not a later Drop/choice count. */
import type {Skill} from '../types';
import type {Script,Op} from './script';
import type {MovementResult} from './movement-result';
import type {OrdinaryActivateSource} from './ordinary-activate-cost';
import {zeroSkillPrice} from './skill-payment';
import {canonicalTaxValue as canonical} from './tax-receipt';
import {IllegalAction} from './illegal-action';
export const HAND_PAYERS='hand_payers',PAID_HAND='paid_hand';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const word=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
const normalized=(v:unknown)=>v===undefined?undefined:JSON.parse(JSON.stringify(v,(k,x)=>k==='reason'||k==='upTo'&&x===false?undefined:x));
const same=(a:unknown,b:unknown)=>canonical(normalized(a))===canonical(normalized(b));
const phrase=(v:string)=>v.trim().replace(/\s+/g,' ').replace(/\.$/,'').toLowerCase();
export function handPaymentRebuild():never {throw new IllegalAction('rebuild the original entire-Hand payment (R525)');}
export function allHandPaymentOp():Extract<Op,{op:'moveTo'}>{return {op:'moveTo',target:{sel:{side:'you',area:'hand',count:99,upTo:false}},to:'drop',reveal:true,as:HAND_PAYERS,completedAs:HAND_PAYERS};}
/** Shared by schema and interpreter; no other selector completion is admitted. */
export function allHandPaymentMove(op:unknown):boolean {return same(op,allHandPaymentOp());}
export function paidHandPrice():NonNullable<Script['price']>{const p=zeroSkillPrice();p.condition={kind:'count',sel:{side:'you',area:'hand'},atLeast:1};p.ops=[allHandPaymentOp()];return p;}
export function paidHandBody():Op[]{return [{op:'power',target:{sel:{special:'self'}},amount:50000,until:'turn'},{op:'if',cond:{kind:'moved',var:PAID_HAND,atLeast:5,all:true},then:[{op:'grant',target:{sel:{special:'self'}},keyword:{name:'Strike',x:3},until:'turn'}]}];}
export function paidHandIntent(script:Pick<Script,'ops'>|undefined):boolean {const walk=(v:unknown):boolean=>{if(!object(v)&&!Array.isArray(v))return false;if(Array.isArray(v))return v.some(walk);return v.kind==='moved'&&v.var===PAID_HAND||v.op==='moveTo'&&v.completedAs===HAND_PAYERS||Object.values(v).some(walk);};return walk(script?.ops);}
export function requirePaidHandShape(skill:Skill,script:Script):void {
 if(!skill||skill.kind!=='activate:main'||!skill.oncePerTurn||skill.limit!=null||skill.keyword||skill.granted||skill.grants||skill.burst!=null||skill.spiritBoost!=null||skill.sparking!=null||skill.bond!=null||skill.markerCost!=null||canonical(skill.energyCost)!=='{}'||canonical(skill.energyEither)!=='[]'||!Array.isArray(skill.tags)||skill.tags.some(x=>typeof x!=='string')||canonical(skill.tags.map(x=>x.toLowerCase()))!==canonical(['activate: main','once per turn']))handPaymentRebuild();
 const cost="place all cards from your hand in the drop area (you can't activate this ability with no cards in hand)";
 const body='this card gains +50000 power for the duration of the turn. if you placed 5 or more cards in the drop area with this skill, this card gains [triple strike] for the duration of the turn';
 if(typeof skill.raw!=='string'||phrase(skill.raw.replace(/^\[activate:\s*main\]\s*\[once per turn\]\s*/i,''))!==cost+': '+body||typeof skill.cost!=='string'||phrase(skill.cost)!==cost||typeof skill.effect!=='string'||phrase(skill.effect)!==body)handPaymentRebuild();
 if(!script||script.kind!==skill.kind||!(script.trigger===undefined||same(script.trigger,[]))||!same(script.usage,{version:1,oncePerTurn:true,limit:null})||!same(script.validity,{version:1,sparking:null})||!same(script.unsupported,[])||!same(script.price,paidHandPrice())||!same(script.ops,paidHandBody())||script.combo!=null||script.paidAdmission||script.playReplacement||script.keepResolutionCondition)handPaymentRebuild();
}
export interface HandPayer {card:string;epoch:number;hiddenCount:number;owner:'p1'|'p2'}
export interface PaidHandCapture {version:1;source:string;selected:HandPayer[]}
export interface PaidHandFrame {capture:PaidHandCapture;published?:true}
export function handSourceKey(source:OrdinaryActivateSource):string {if(!object(source)||!object(source.occurrence)||!object(source.skill)||!object(source.script))handPaymentRebuild();requirePaidHandShape(source.skill,source.script);return canonical(source);}
export function captureHandPayment(source:OrdinaryActivateSource,payers:HandPayer[]):PaidHandCapture {
 const key=handSourceKey(source);if(!Array.isArray(payers)||!payers.length||payers.some(p=>!object(p)||!word(p.card)||!integer(p.epoch)||!integer(p.hiddenCount)||p.owner!==source.master)||new Set(payers.map(p=>p.card)).size!==payers.length)handPaymentRebuild();return {version:1,source:key,selected:structuredClone(payers)};
}
export function requireHandProgress(source:OrdinaryActivateSource,capture:PaidHandCapture,result:MovementResult,processed:number):void {
 if(!object(capture)||capture.version!==1||!Array.isArray(capture.selected)||canonical(captureHandPayment(source,capture.selected))!==canonical(capture)||!integer(processed)||processed>capture.selected.length)handPaymentRebuild();
 if(!object(result)||result.version!==1||result.destination!==undefined||!Array.isArray(result.selected)||!Array.isArray(result.outcomes)||result.outcomes.length!==processed||!same(result.selected,capture.selected.map(p=>({card:p.card,epoch:p.epoch}))))handPaymentRebuild();
 for(const [i,r] of result.outcomes.entries()){const p=capture.selected[i];if(!object(r)||r.card!==p.card||r.from!=='hand'||r.fromEpoch!==p.epoch||!integer(r.toEpoch)||r.toEpoch<p.epoch||typeof r.completed!=='boolean'||r.host!==undefined||!(r.to===null||typeof r.to==='string'&&['hand','drop','deck','warp','removed','battle','energy','life','under','combo','unison','zEnergy','zDeck','leader'].includes(r.to))||r.completed&&(r.to!=='drop'||r.toEpoch!==p.epoch+1))handPaymentRebuild();}
}
export function completeHandPayment(source:OrdinaryActivateSource,capture:PaidHandCapture,result:MovementResult):void {requireHandProgress(source,capture,result,capture?.selected?.length);if(result.outcomes.some(r=>!r.completed))handPaymentRebuild();}
