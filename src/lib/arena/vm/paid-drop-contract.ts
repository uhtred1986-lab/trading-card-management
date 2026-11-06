/** R518: exact paid owner-Drop history, independent of later self play. */
import type {Skill,PlayerId} from '../types';
import type {Script,Op} from './script';
import type {Attrs} from './cards';
import type {OrdinaryActivateSource} from './ordinary-activate-cost';
import type {MovementOutcome} from './movement-result';
import {emptyFilter} from '../text/filters';
import {zeroSkillPrice} from './skill-payment';
import {canonicalTaxValue as canonical} from './tax-receipt';
import {IllegalAction} from './illegal-action';
export const PAID_OWN_DROP='paid_own_drop';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const player=(v:unknown):v is PlayerId=>v==='p1'||v==='p2';
const word=(v:unknown):v is string=>typeof v==='string'&&/^\w+$/.test(v)&&v!==PAID_OWN_DROP;
const phrase=(v:string)=>v.trim().replace(/\s+/g,' ').replace(/\.$/,'').toLowerCase();
const normalized=(v:unknown)=>JSON.parse(JSON.stringify(v,(k,x)=>k==='reason'||k==='upTo'&&x===false?undefined:(k==='traits'||k==='characters')&&Array.isArray(x)?x.map(v=>typeof v==='string'?v.toLowerCase():v):x));
const same=(a:unknown,b:unknown)=>canonical(normalized(a))===canonical(normalized(b));
function fail():never {throw new IllegalAction('rebuild the exact original owner-Drop payment (R518)');}
export function paidDropTail():Op {return {op:'if',cond:{kind:'varMatches',var:PAID_OWN_DROP,paid:true,filter:{...emptyFilter(),characters:['general blue']}},then:[{op:'power',target:{sel:{special:'self'}},amount:5000,until:'turn'}]};}
export function requirePaidDropShape(skill:Skill,script:Script):void {
 if(!object(skill)||!object(script)||!Array.isArray(script.ops)||!object(script.price))fail();
 if(skill.kind!=='activate:main'||!Array.isArray(skill.tags)||skill.tags.some(t=>typeof t!=='string')||canonical(skill.tags.map(t=>t.toLowerCase()))!==canonical(['activate: main','limit 1'])||skill.oncePerTurn||skill.limit!==1||skill.bond!==null||skill.sparking!==null||skill.burst!==null||skill.spiritBoost!==null||skill.markerCost!==null||canonical(skill.energyCost)!=='{}'||canonical(skill.energyEither)!=='[]'||skill.granted||skill.grants||skill.keyword)fail();
 if(typeof skill.cost!=='string'||phrase(skill.cost)!=="choose 1 of your ≪red ribbon army≫ cards with an energy cost of 2 or less and place it in its owner's drop area"||typeof skill.effect!=='string'||phrase(skill.effect)!=='play this card from your hand. additionally, if you used this skill to place a <general blue> card in your drop area, this card gets +5000 power for the turn')fail();
 const choice=script.price.ops?.[0],self=script.ops[0];
 if(choice?.op!=='choose'||!word(choice.as)||self?.op!=='choose'||!word(self.as))fail();
 const price={...zeroSkillPrice(),ops:[{op:'choose',sel:{side:'you',area:'play',filter:{...emptyFilter(),traits:['red ribbon army'],costMax:2},count:1,upTo:false},as:choice.as},{op:'moveTo',target:{var:choice.as},to:'drop',reveal:true}]};
 const ops:Op[]=[{op:'choose',sel:{special:'self',area:'hand'},as:self.as},{op:'play',target:{var:self.as}},paidDropTail()];
 if(script.kind!=='activate:main'||script.trigger!==undefined&&canonical(script.trigger)!=='[]'||canonical(script.unsupported)!=='[]'||canonical(script.usage)!==canonical({version:1,oncePerTurn:false,limit:1})||canonical(script.validity)!==canonical({version:1,sparking:null})||script.combo!=null||script.paidAdmission||script.keepResolutionCondition||script.playReplacement||!same(script.price,price)||!same(script.ops,ops))fail();
}
export function paidDropIntent(script:Pick<Script,'ops'>|undefined):boolean {
 const has=(v:unknown):boolean=>{if(!object(v))return Array.isArray(v)&&v.some(has);return v.kind==='varMatches'&&v.paid===true&&v.var===PAID_OWN_DROP||Object.values(v).some(has);};return has(script?.ops);
}
export function requirePaidDropAttributes(v:unknown):asserts v is Attrs {
 if(!object(v)||Object.values(v).some(x=>!(typeof x==='string'||typeof x==='boolean'||typeof x==='number'&&Number.isFinite(x)||Array.isArray(x)&&x.every(y=>typeof y==='string')))||!Array.isArray(v.characters)||!v.characters.every(x=>typeof x==='string'))fail();
}
export function isGeneralBlue(v:Attrs):boolean {requirePaidDropAttributes(v);return (v.characters as string[]).some(x=>x.toLowerCase()==='general blue');}
export interface PaidDropPayer {card:string;cardId:string;owner:PlayerId;holder:PlayerId;area:string;epoch:number;hiddenCount:number;flipped:boolean;attributes:Attrs}
export interface PaidDropCapture {version:1;declaration:string;payer:PaidDropPayer}
export interface PaidDropResult {capture:PaidDropCapture;outcome?:MovementOutcome;destination?:{holder:PlayerId;attributes:Attrs}}
export function paidDropDeclaration(source:OrdinaryActivateSource):string {
 if(!object(source)||!object(source.occurrence)||!player(source.master)||!object(source.skill)||!integer(source.skill.index)||!object(source.script))fail();
 requirePaidDropShape(source.skill,source.script);
 const o=source.occurrence;
 if(typeof o.card!=='string'||!o.card||typeof o.cardId!=='string'||!o.cardId||o.area!=='hand'||o.holder!==source.master||!integer(o.epoch)||!integer(o.hiddenCount)||source.flipped!==false)fail();
 return canonical(source);
}
export function requirePaidDropPayer(payer:unknown,master:PlayerId):asserts payer is PaidDropPayer {
 if(!object(payer)||typeof payer.card!=='string'||!payer.card||typeof payer.cardId!=='string'||!payer.cardId||!player(payer.owner)||payer.holder!==master||!['battle','unison','leader'].includes(String(payer.area))||!integer(payer.epoch)||!integer(payer.hiddenCount)||typeof payer.flipped!=='boolean')fail();
 requirePaidDropAttributes(payer.attributes);
}
export function capturePaidDrop(source:OrdinaryActivateSource,payer:PaidDropPayer):PaidDropCapture {const declaration=paidDropDeclaration(source);requirePaidDropPayer(payer,source.master);return structuredClone({version:1,declaration,payer});}
export function requirePaidDropCapture(source:OrdinaryActivateSource,value:unknown):asserts value is PaidDropCapture {
 if(!object(value)||value.version!==1||value.declaration!==paidDropDeclaration(source))fail();requirePaidDropPayer(value.payer,source.master);
}
export function requirePendingPaidDrop(source:OrdinaryActivateSource,value:unknown,payer:PaidDropPayer):void {requirePaidDropCapture(source,value);requirePaidDropPayer(payer,source.master);if(canonical(value.payer)!==canonical(payer))fail();}
export function completedPaidDropInfo(source:OrdinaryActivateSource,result:PaidDropResult):Record<string,Attrs> {
 if(!object(result))fail();requirePaidDropCapture(source,result.capture);const p=result.capture.payer,r=result.outcome,d=result.destination;
 if(!object(r)||r.card!==p.card||r.from!==p.area||r.fromEpoch!==p.epoch||r.to!=='drop'||!integer(r.toEpoch)||r.toEpoch!==p.epoch+1||r.completed!==true||r.host!==undefined||!object(d)||d.holder!==p.owner)fail();
 requirePaidDropAttributes(d.attributes);if(isGeneralBlue(p.attributes)!==isGeneralBlue(d.attributes))fail();
 return d.holder===source.master?{[p.card]:structuredClone(d.attributes)}:{};
}
