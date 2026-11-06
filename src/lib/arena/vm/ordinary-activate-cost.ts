/** Preparatory only; no native caller. Caller supplies authentic source facts,
 * original stored program and strict payment outcome. No ctx/state authentication
 * or shared ledger mutation is performed by this pure continuation contract. */
import type {PlayerId,Skill} from '../types';
import type {Script,ScriptFrame,Op} from './script';
import type {Occurrence} from './applied-effect-receipt';
import type {UsageRecord} from './usage';
import {requireUsage} from './usage';
import {skillPriceProblem} from './skill-payment';
import {activationPriceProblem} from './activation-price-support';
import {canonicalTaxValue as canonical} from './tax-receipt';
import {discardAs,comboFromAs,programProblem} from './script-schema';
import {IllegalAction} from './illegal-action';

export interface OrdinaryActivateSource {occurrence:Occurrence;master:PlayerId;skill:Skill;script:Script;flipped:boolean;priceContext:{optionalOwnDiscard:boolean}}
export interface OrdinaryActivateCost {
 version:1;source:OrdinaryActivateSource;key:string;limitKey:string|null;phase:'paying'|'committed'|'failed';
}
export interface OrdinaryActivatePair {price:ScriptFrame;effect:ScriptFrame}
export type OrdinaryUsageCommit = {kind:'limit';master:PlayerId;key:string;maximum:number}
 | {kind:'once';source:Occurrence;skillIndex:number};
export interface OrdinaryActivateFinish {continuation:OrdinaryActivateCost;announce:boolean;discardEffect:boolean;usage:OrdinaryUsageCommit|null}
function fail():never {throw new IllegalAction('rebuild the original ordinary Activate price continuation');}
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const integer=(x:unknown):x is number=>Number.isSafeInteger(x)&&Number(x)>=0;
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
function requireSource(value:unknown):asserts value is OrdinaryActivateSource {
 if(!object(value)||!object(value.occurrence)||!object(value.skill)||!object(value.script)||!['p1','p2'].includes(String(value.master))||typeof value.flipped!=='boolean'||!object(value.priceContext)||typeof value.priceContext.optionalOwnDiscard!=='boolean')fail();
 const s=value as unknown as OrdinaryActivateSource,o=s.occurrence,sk=s.skill,script=s.script;
 if(typeof o.card!=='string'||!o.card||typeof o.cardId!=='string'||!o.cardId||!integer(o.epoch)||!integer(o.hiddenCount)||!['p1','p2'].includes(o.holder)||typeof o.area!=='string'||!o.area||!integer(sk.index)||!['activate:main','activate:battle','activate:main/battle'].includes(sk.kind)||sk.keyword||sk.granted||sk.grants)fail();
 if(script.kind!==sk.kind||!same(script.trigger,[])||!same(script.unsupported,[])||!Array.isArray(script.ops)||programProblem(script.ops)||!script.price||skillPriceProblem(script.price)||!Array.isArray(script.price.ops)||!script.price.ops.length||script.price.ops.some(op=>!object(op))||activationPriceProblem(script.price.ops)||!object(script.validity)||script.combo!=null||script.playReplacement)fail();
 const u=requireUsage(script.usage);
 if(sk.oncePerTurn!==u.oncePerTurn||sk.limit!==u.limit||!same(script.validity,{version:1,sparking:sk.sparking})||typeof sk.raw!=='string'||!sk.raw)fail();
}
function usage(source:OrdinaryActivateSource):UsageRecord {return requireUsage(source.script.usage);}
function expectedLimitKey(s:OrdinaryActivateSource):string|null {
 return usage(s).limit===null?null:`${s.occurrence.cardId}${s.flipped?'/back':''}#${s.skill.index}`;
}
export function beginOrdinaryActivateCost(source:OrdinaryActivateSource):OrdinaryActivateCost {
 requireSource(source);
 return {version:1,source:structuredClone(source),key:`costvars:${source.occurrence.card}:${source.skill.index}`,limitKey:expectedLimitKey(source),phase:'paying'};
}
/** Expected is obtained by the future native caller from the original captured
 * source/definition, not from a fresh source occurrence after payment. */
export function requireOrdinaryActivateCost(value:unknown,expected:OrdinaryActivateSource):asserts value is OrdinaryActivateCost {
 requireSource(expected);
 if(!object(value)||value.version!==1||!['paying','committed','failed'].includes(String(value.phase)))fail();
 requireSource(value.source);
 if(!same(value.source,expected)||value.key!==`costvars:${expected.occurrence.card}:${expected.skill.index}`||value.limitKey!==expectedLimitKey(expected))fail();
}
function variables(value:unknown):boolean {return object(value)&&Object.values(value).every(v=>Array.isArray(v)&&v.every(id=>typeof id==='string'));}
/** Match only interpreter-defined macro folding/expansion. UI reasons carry no authority. */
function programKey(ops:readonly Op[]):string {
 return canonical(JSON.parse(JSON.stringify(ops,(key,value)=>key==='reason'?undefined:value)));
}
function foldMacros(ops:readonly Op[]):Op[] {
 const out:Op[]=[];
 for(let i=0;i<ops.length;){const folded=discardAs(ops,i)??comboFromAs(ops,i);out.push(folded?.op??ops[i]);i+=folded?.span??1;}return out;
}
function priceProgramMatches(source:OrdinaryActivateSource,saved:Op[]):boolean {
 if(saved.some(op=>!object(op)))return false;
 const original=foldMacros(source.script.price!.ops!),actual=foldMacros(saved);let at=0;
 for(const op of original){
  if(programKey([op])===programKey(actual.slice(at,at+1))){at++;continue;}
  let expanded:Op[]=[];
  if(op.op==='discard'&&typeof op.n==='number'){
   const sides=op.side==='both'?['you','opponent'] as const:[op.side??'you'];
   for(const who of sides){const player=who==='you'?source.master:source.master==='p1'?'p2':'p1',as=`discarded${at}${player}`,optional=who==='you'&&source.priceContext.optionalOwnDiscard;
    expanded.push({op:'choose',sel:{side:who,area:'hand',count:op.n,...(optional?{upTo:true}: {})},as,chooser:who},{op:'moveTo',target:{var:as},to:op.to??'drop',reveal:true});}
  }else if(op.op==='reveal'&&!op.sel.fromVar&&!op.sel.special&&!(op.sel.count&&op.sel.count>=99)){
   expanded=[{op:'choose',sel:op.sel,as:op.as},{...op,sel:{fromVar:op.as,...(op.sel.upTo?{upTo:true}: {})}}];
  }
  if(!expanded.length||programKey(expanded)!==programKey(actual.slice(at,at+expanded.length)))return false;
  at+=expanded.length;
 }
 return at===actual.length;
}
/** Match precisely one price/effect pair; never select an arbitrary same-key sibling. */
export function requireOrdinaryActivatePair(value:OrdinaryActivateCost,frames:readonly ScriptFrame[]):OrdinaryActivatePair {
 requireOrdinaryActivateCost(value,value.source);
 if(!Array.isArray(frames)||frames.some(f=>!object(f)))fail();
 const prices=frames.filter(f=>f.saveVarsAs===value.key),effects=frames.filter(f=>f.pricedBy?.key===value.key);
 if(prices.length!==1||effects.length!==1||prices[0]===effects[0])fail();
 const price=prices[0],effect=effects[0],s=value.source;
 for(const f of [price,effect])if(f.autoCost||f.counterCost||f.keywordCost||f.keywordPrice||f.swapCost||f.dropCost||f.fieldCost||f.activateUnderCost||f.awakenPayment||f.awakenAlternativeCost||f.declaredPlay||f.viaKeyword||f.copiedSkillCapture)fail();
 for(const f of [price,effect])if(f.card!==s.occurrence.card||f.master!==s.master||f.skillIndex!==s.skill.index||!same(f.usage,s.script.usage)||!same(f.validity,s.script.validity)||!variables(f.vars)||!Array.isArray(f.ops)||!integer(f.ip)||f.ip>f.ops.length)fail();
 if(price.pricedBy||effect.saveVarsAs||effect.pricedBy?.text!==s.skill.raw||!priceProgramMatches(s,price.ops)||!same(effect.ops,s.script.ops)||effect.ip!==0)fail();
 return {price,effect};
}
/** A pure decision: the native writer must commit the returned continuation and
 * requested usage/announcement atomically. Duplicate completed calls emit none.
 * The outcome comes from the existing strict cost runner, not from final area. */
export function finishOrdinaryActivateCost(value:OrdinaryActivateCost,expected:OrdinaryActivateSource,frames:readonly ScriptFrame[],outcome:'paid'|'failed'):OrdinaryActivateFinish {
 requireOrdinaryActivateCost(value,expected);
 if(outcome!=='paid'&&outcome!=='failed')fail();
 const pair=requireOrdinaryActivatePair(value,frames);
 if(value.phase==='committed'){
  if(outcome!=='paid')fail();
  return {continuation:structuredClone(value),announce:false,discardEffect:false,usage:null};
 }
 if(value.phase==='failed'){
  if(outcome!=='failed')fail();
  return {continuation:structuredClone(value),announce:false,discardEffect:true,usage:null};
 }
 if(outcome==='paid'&&(pair.price.ip!==pair.price.ops.length||pair.price.awaiting!==undefined||pair.price.moveLoop!==undefined||pair.price.priceUnpaid!==undefined))fail();
 const continuation=structuredClone(value);continuation.phase=outcome==='paid'?'committed':'failed';
 if(outcome==='failed')return {continuation,announce:false,discardEffect:true,usage:null};
 const u=usage(expected);
 return {continuation,announce:true,discardEffect:false,usage:u.limit!==null?{kind:'limit',master:expected.master,key:value.limitKey!,maximum:u.limit}:u.oncePerTurn?{kind:'once',source:structuredClone(expected.occurrence),skillIndex:expected.skill.index}:null};
}

/** saveVars precedes saveX in the existing interpreter. This separate completion
 * step forwards the same bound X without another usage/announcement decision. */
export function ordinaryActivateCompletionX(value:OrdinaryActivateCost,expected:OrdinaryActivateSource,frames:readonly ScriptFrame[],x:number):number {
 requireOrdinaryActivateCost(value,expected);if(value.phase!=='committed'||!integer(x))fail();
 const pair=requireOrdinaryActivatePair(value,frames);
 if(pair.price.ip!==pair.price.ops.length||pair.price.x!==x||pair.effect.x!==undefined&&!integer(pair.effect.x))fail();return pair.effect.x??x;
}
