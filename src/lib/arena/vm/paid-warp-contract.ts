/** R522 source-bound original payment count and exact stored Auto contract. */
import type {Skill,PlayerId} from '../types';
import type {Script,Op} from './script';
import type {MovementResult} from './movement-result';
import {emptyFilter} from '../text/filters';
import {zeroSkillPrice} from './skill-payment';
import {canonicalTaxValue as canonical} from './tax-receipt';
import {IllegalAction} from './illegal-action';
export const WARP_PAYERS='warp_payers', PAID_WARP='paid_warp';
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const integer=(x:unknown):x is number=>Number.isSafeInteger(x)&&Number(x)>=0;
const word=(x:unknown):x is string=>typeof x==='string'&&x.trim()===x&&x.length>0;
const destination=(x:unknown)=>x===null||typeof x==='string'&&['deck','hand','drop','leader','battle','combo','energy','life','warp','unison','zDeck','zEnergy','removed','under'].includes(x);
const player=(x:unknown):x is PlayerId=>x==='p1'||x==='p2';
const phrase=(x:string)=>x.trim().replace(/\s+/g,' ').replace(/\.$/,'').toLowerCase();
const normalized=(x:unknown)=>x===undefined?undefined:JSON.parse(JSON.stringify(x,(key,v)=>key==='reason'||key==='upTo'&&v===false?undefined:v));
const same=(a:unknown,b:unknown)=>canonical(normalized(a))===canonical(normalized(b));
function fail():never {throw new IllegalAction('rebuild the original successful Warp-count payment (R522)');}
export function paidWarpPrice():NonNullable<Script['price']>{const p=zeroSkillPrice();p.payment.burst=1;p.ops=[{op:'choose',sel:{side:'you',area:'drop',count:99,minCount:3,differentNames:true},as:WARP_PAYERS},{op:'moveTo',target:{var:WARP_PAYERS},to:'warp',completedAs:WARP_PAYERS}];return p;}
export function paidWarpBody():Op[]{return [{op:'choose',sel:{side:'you',area:'drop',filter:{...emptyFilter(),colors:['Green']},count:1,upTo:true},as:'recovered',energyCostEquals:{var:PAID_WARP}},{op:'moveTo',target:{var:'recovered'},to:'hand',reveal:true}];}
export function requirePaidWarpShape(skill:Skill,script:Script):void {
 if(!skill||skill.kind!=='auto'||skill.burst!==1||skill.oncePerTurn||skill.limit!=null||skill.granted||skill.grants||skill.keyword||canonical(skill.energyCost)!=='{}'||canonical(skill.energyEither)!=='[]'||skill.bond!=null||skill.sparking!=null||skill.spiritBoost!=null||skill.markerCost!=null||!Array.isArray(skill.tags)||skill.tags.some(t=>typeof t!=='string')||canonical(skill.tags.map(t=>t.toLowerCase()))!==canonical(['auto','burst 1']))fail();
 if(typeof skill.cost!=='string'||phrase(skill.cost)!=="send 3 or more cards with different card names from your drop to their owner's warp"||typeof skill.effect!=='string'||phrase(skill.effect)!=="when this card attacks, add up to 1 green card with an energy cost equal to the number of cards sent to their owner's warp by this skill from your drop to your hand")fail();
 if(!script||script.kind!=='auto'||!same(script.trigger,['attacks'])||!same(script.usage,{version:1,oncePerTurn:false,limit:null})||!same(script.validity,{version:1,sparking:null})||!same(script.unsupported,[])||!same(script.price,paidWarpPrice())||!same(script.ops,paidWarpBody())||script.combo!=null||script.paidAdmission||script.keepResolutionCondition||script.playReplacement)fail();
}
export interface PaidWarpSource {version:1;card:string;cardId:string;master:PlayerId;skillIndex:number;epoch:number;hiddenCount:number;flipped:boolean;skill:Skill;script:Script}
export interface WarpPayer {card:string;epoch:number;owner:PlayerId;name:string}
export interface PaidWarpSelection {version:1;source:string;selected:WarpPayer[]}
/** Caller must obtain this source at the actual pending occurrence; no current-state reconstruction. */
export function paidWarpSourceKey(s:PaidWarpSource):string {
 if(!object(s)||s.version!==1||!word(s.card)||!word(s.cardId)||!player(s.master)||!integer(s.skillIndex)||!integer(s.epoch)||!integer(s.hiddenCount)||typeof s.flipped!=='boolean'||s.skill?.index!==s.skillIndex)fail();
 requirePaidWarpShape(s.skill,s.script);return canonical(s);
}
export function captureWarpSelection(source:PaidWarpSource,payers:WarpPayer[]):PaidWarpSelection {
 const key=paidWarpSourceKey(source);
 if(!Array.isArray(payers)||payers.length<3||payers.length>99||payers.some(p=>!object(p)||!word(p.card)||!integer(p.epoch)||p.owner!==source.master||!word(p.name))||new Set(payers.map(p=>p.card)).size!==payers.length||new Set(payers.map(p=>p.name.toLowerCase())).size!==payers.length)fail();
 return {version:1,source:key,selected:structuredClone(payers)};
}
/** Existing native MovementResult is trusted writer output; this validator does not authenticate arbitrary caller facts. */
export function requireWarpProgress(source:PaidWarpSource,capture:PaidWarpSelection,result:MovementResult,processed:number):void {
 if(!object(capture)||capture.version!==1||capture.source!==paidWarpSourceKey(source)||!Array.isArray(capture.selected))fail();
 if(canonical(captureWarpSelection(source,capture.selected))!==canonical(capture)||!integer(processed)||processed>capture.selected.length)fail();
 if(!object(result)||result.version!==1||!Array.isArray(result.selected)||!Array.isArray(result.outcomes)||result.destination!==undefined||result.outcomes.length!==processed||canonical(result.selected)!==canonical(capture.selected.map(p=>({card:p.card,epoch:p.epoch}))))fail();
 const seen=new Set<string>();
 for(const [index,r] of result.outcomes.entries()){const p=capture.selected[index];if(!p||!r||r.card!==p.card||seen.has(p.card)||r.from!=='drop'||r.fromEpoch!==p.epoch||!integer(r.toEpoch)||r.toEpoch<r.fromEpoch||typeof r.completed!=='boolean'||r.host!==undefined||!destination(r.to)||r.completed&&(r.to!=='warp'||r.toEpoch!==r.fromEpoch+1))fail();seen.add(p.card);}
}
export function completedWarpPayers(source:PaidWarpSource,capture:PaidWarpSelection,result:MovementResult):string[]{requireWarpProgress(source,capture,result,capture?.selected?.length);if(result.outcomes.some(r=>!r.completed))fail();return capture.selected.map(p=>p.card);}
