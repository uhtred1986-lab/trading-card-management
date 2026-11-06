/** Isolated continuation preparation. Native runners remain unchanged. */
import assert from 'node:assert/strict';
import fixture from './fixtures/ordinary-activate-cost-5.json';
import {card} from './harness';
import {skillRecords} from '../../src/lib/arena/draft';
import {rulesFromRows,type RuleRow} from '../../src/lib/arena/rules-store';
import {parseSkills} from '../../src/lib/arena/text/cards';
import {IllegalAction} from '../../src/lib/arena/vm/illegal-action';
import type {Op,ScriptFrame} from '../../src/lib/arena/vm/script';
import {beginOrdinaryActivateCost,requireOrdinaryActivateCost,requireOrdinaryActivatePair,finishOrdinaryActivateCost,ordinaryActivateCompletionX,type OrdinaryActivateSource} from '../../src/lib/arena/vm/ordinary-activate-cost';
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const definitions=Object.fromEntries(Object.entries(fixture).map(([id,{card:c}])=>[id,card(id,{name:c.name,type:c.type as 'BATTLE'|'EXTRA',colors:c.colors as ('Blue'|'Yellow')[],energyCost:Number(c.cost),power:c.power,characters:c.characters,traits:c.traits,skill:c.skill})]));
const rows=Object.values(definitions).flatMap(skillRecords),scripts=rulesFromRows(rows.map((r,id)=>({...r,id,status:'confirmed',source:'compiler'})as RuleRow),definitions);
for(const [id,item]of Object.entries(fixture)){assert.deepEqual(clone(rows.filter(r=>r.cardId===id)),Object.values(item.records));}
let cases=0;
function refused(fn:()=>unknown){assert.throws(fn,e=>e instanceof IllegalAction);cases++;}
function source(id:string,index:number,master:'p1'|'p2'):OrdinaryActivateSource {
 return {occurrence:{card:'original',cardId:id,epoch:4,hiddenCount:0,holder:master,area:'hand'},master,skill:parseSkills(definitions[id].skill!).find(s=>s.index===index)!,script:clone(scripts[id].bySkill[index]),flipped:false,priceContext:{optionalOwnDiscard:false}};
}
function frames(s:OrdinaryActivateSource):ScriptFrame[]{const c=beginOrdinaryActivateCost(s),base={card:s.occurrence.card,master:s.master,skillIndex:s.skill.index,usage:s.script.usage,validity:s.script.validity,ip:0,vars:{}};
 return [{...clone(base),ops:clone(s.script.price!.ops!),saveVarsAs:c.key},{...clone(base),ops:clone(s.script.ops),pricedBy:{key:c.key,text:s.skill.raw}}];}
for(const master of ['p1','p2'] as const)for(const [id,index]of [['BT18-038',30],['BT17-036',10],['DB3-090',10]] as const){
 const s=source(id,index,master),c=beginOrdinaryActivateCost(s),pair=frames(s),before=JSON.stringify({s,c,pair});
 requireOrdinaryActivatePair(c,pair);assert.equal(JSON.stringify({s,c,pair}),before);cases++;
 const failed=finishOrdinaryActivateCost(c,s,pair,'failed');assert.equal(failed.announce,false);assert.equal(failed.discardEffect,true);assert.equal(failed.usage,null);assert.equal(c.phase,'paying');cases++;
 const failedAgain=finishOrdinaryActivateCost(failed.continuation,s,pair,'failed');assert.deepEqual(failedAgain,failed);cases++;
 refused(()=>finishOrdinaryActivateCost(failed.continuation,s,pair,'paid'));
 refused(()=>finishOrdinaryActivateCost(c,s,pair,'paid'));
 pair[0].ip=pair[0].ops.length;
 const paid=finishOrdinaryActivateCost(c,s,pair,'paid');assert.equal(paid.announce,true);assert.equal(paid.discardEffect,false);
 if(id==='BT18-038')assert.deepEqual(paid.usage,{kind:'limit',master,key:'BT18-038#30',maximum:1});
 if(id==='BT17-036')assert.deepEqual(paid.usage,{kind:'once',source:s.occurrence,skillIndex:10});
 if(id==='DB3-090')assert.equal(paid.usage,null);cases++;
 // The return is a commit instruction, not a rollback or current-source lookup.
 const ledger:Record<string,number>={};let announcements=0;
 for(const result of [paid,finishOrdinaryActivateCost(paid.continuation,s,pair,'paid')]){if(result.announce)announcements++;if(result.usage?.kind==='limit')ledger[result.usage.key]=(ledger[result.usage.key]??0)+1;}
 assert.equal(announcements,1);assert.deepEqual(ledger,id==='BT18-038'?{'BT18-038#30':1}:{});cases++;
 refused(()=>finishOrdinaryActivateCost(paid.continuation,s,pair,'failed'));
 pair[0].x=3;assert.equal(ordinaryActivateCompletionX(paid.continuation,s,pair,3),3);pair[1].x=3;assert.equal(ordinaryActivateCompletionX(paid.continuation,s,pair,3),3);cases++;
 pair[1].x=5;assert.equal(ordinaryActivateCompletionX(paid.continuation,s,pair,3),5);cases++;
 refused(()=>ordinaryActivateCompletionX(c,s,pair,3));refused(()=>ordinaryActivateCompletionX(paid.continuation,s,pair,4));
 for(const fault of ['source','master','cardId','epoch','face','skill','key','limitKey','phase','program'] as const){const bad=clone(c);if(fault==='source')bad.source=null as never;if(fault==='master')bad.source.master=master==='p1'?'p2':'p1';if(fault==='cardId')bad.source.occurrence.cardId='new incarnation';if(fault==='epoch')bad.source.occurrence.epoch++;if(fault==='face')bad.source.flipped=true;if(fault==='skill')bad.source.skill.index++;if(fault==='key')bad.key='costvars:other:30';if(fault==='limitKey')bad.limitKey='forged';if(fault==='phase')bad.phase='unknown' as never;if(fault==='program')bad.source.script.ops=[];refused(()=>requireOrdinaryActivateCost(bad,s));}
 for(const fault of ['duplicatePrice','duplicateEffect','missingEffect','wrongMaster','wrongBody','wrongPrice','wrongText','nullVars','arrayVars','badIp','pending','unpaid','otherRunner'] as const){const f=clone(pair);if(fault==='duplicatePrice')f.push(clone(f[0]));if(fault==='duplicateEffect')f.push(clone(f[1]));if(fault==='missingEffect')f.pop();if(fault==='wrongMaster')f[1].master=master==='p1'?'p2':'p1';if(fault==='wrongBody')f[1].ops=[];if(fault==='wrongPrice')f[0].ops=[];if(fault==='wrongText')f[1].pricedBy!.text='changed';if(fault==='nullVars')f[0].vars=null as never;if(fault==='arrayVars')f[0].vars=[] as never;if(fault==='badIp')f[0].ip=NaN;if(fault==='pending')f[0].awaiting='replaceMove';if(fault==='unpaid')f[0].priceUnpaid='failed original move';if(fault==='otherRunner')f[0].autoCost={} as never;refused(()=>finishOrdinaryActivateCost(c,s,f,'paid'));}
}
// Interpreter rewrite compatibility is mechanism coverage, not new printed source admission.
for(const master of ['p1','p2'] as const){
 for(const variant of ['discard','discardBoth','reveal','comboFold'] as const){
  const s=source('DB3-090',10,master);let original:Op[],expanded:Op[];
  if(variant==='discard'||variant==='discardBoth'){
   original=[{op:'discard',n:1,...(variant==='discardBoth'?{side:'both' as const}:{})}];expanded=[];
   for(const who of variant==='discardBoth'?['you','opponent'] as const:['you'] as const){const p=who==='you'?master:master==='p1'?'p2':'p1',as=`discarded0${p}`;expanded.push({op:'choose',sel:{side:who,area:'hand',count:1},as,chooser:who,reason:'discard 1 card'},{op:'moveTo',target:{var:as},to:'drop',reveal:true});}
  }else if(variant==='reveal'){
   original=[{op:'reveal',sel:{side:'you',area:'hand',count:1},as:'shown'}];expanded=[{op:'choose',sel:{side:'you',area:'hand',count:1},as:'shown',reason:'Bulma: choose a card to reveal'},{op:'reveal',sel:{fromVar:'shown'},as:'shown'}];
  }else{
   original=[{op:'choose',sel:{side:'you',area:'battle',count:1},as:'payer'},{op:'comboFrom',target:{var:'payer'}}];expanded=[original[0],{op:'moveTo',target:{var:'payer'},to:'combo',reveal:true,cause:'combo'}];
  }
  s.script.price!.ops=original;const c=beginOrdinaryActivateCost(s),f=frames(s);f[0].ops=expanded;f[0].ip=1;requireOrdinaryActivatePair(c,f);cases++;f[0].ip=f[0].ops.length;assert.equal(finishOrdinaryActivateCost(c,s,f,'paid').announce,true);cases++;
  const bad=clone(f);const move=bad[0].ops.find(o=>o.op==='moveTo');if(move?.op==='moveTo')move.to='warp';else bad[0].ops[1]={op:'draw',n:1};refused(()=>requireOrdinaryActivatePair(c,bad));
 }
}
// Saved cursors retain generated aliases after preceding expansions change ip offsets.
for(const master of ['p1','p2'] as const)for(const variant of ['twoDiscards','twoReveals','mixed'] as const){
 const s=source('DB3-090',10,master),first:Op={op:'discard',n:1},second:Op={op:'discard',n:2};
 const reveal=(as:string):Op=>({op:'reveal',sel:{side:'you',area:'hand',count:1},as});
 const original=variant==='twoDiscards'?[first,second]:variant==='twoReveals'?[reveal('r0'),reveal('r1')]:[first,reveal('r0'),second];s.script.price!.ops=original;
 const c=beginOrdinaryActivateCost(s),f=frames(s),expanded:Op[]=[];
 for(const op of original){const at=expanded.length;if(op.op==='discard'){const as=`discarded${at}${master}`;expanded.push({op:'choose',sel:{side:'you',area:'hand',count:op.n as number},as,chooser:'you',reason:'discard'},{op:'moveTo',target:{var:as},to:'drop',reveal:true});}else if(op.op==='reveal')expanded.push({op:'choose',sel:op.sel,as:op.as,reason:'choose a card to reveal'},{...op,sel:{fromVar:op.as}});}
 f[0].ops=expanded;
 for(const ip of Array.from({length:expanded.length+1},(_,i)=>i)){f[0].ip=ip;requireOrdinaryActivatePair(c,clone(f));cases++;}
 assert.equal(finishOrdinaryActivateCost(c,s,f,'paid').announce,true);cases++;
 const bad=clone(f);if(variant==='twoDiscards'){const pick=bad[0].ops[2];if(pick.op==='choose')pick.as=`discarded1${master}`;}else {const last=bad[0].ops.at(-1)!;if(last.op==='reveal')last.sel.fromVar='wrong';else if(last.op==='moveTo')last.target={var:'wrong'};}
 refused(()=>requireOrdinaryActivatePair(c,bad));
}
console.log(`ordinary-activate-cost-5: ${cases} isolated preparation cases PASS; native integration deferred`);
