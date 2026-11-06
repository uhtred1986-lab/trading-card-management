import type {Ctx} from '../../src/lib/arena/compile/shared';
import {compilePaidDropFollowup} from '../../src/lib/arena/compile/effects';
import {parseRule,printRule,type Rule} from '../../src/lib/arena/lang';
/** Isolated R518 candidate contract. Native/compiler admission is separate. */
import assert from 'node:assert/strict';
import fixture from './fixtures/paid-drop-5.json';
import {card} from './harness';
import {skillRecords} from '../../src/lib/arena/draft';
import {parseSkills} from '../../src/lib/arena/text/cards';
import {priceFromCostRecord} from '../../src/lib/arena/vm/skill-payment';
import type {Script,CostRecord} from '../../src/lib/arena/vm/script';
import type {OrdinaryActivateSource} from '../../src/lib/arena/vm/ordinary-activate-cost';
import {IllegalAction} from '../../src/lib/arena/vm/illegal-action';
import {paidDropTail,requirePaidDropShape,capturePaidDrop,requirePendingPaidDrop,completedPaidDropInfo,type PaidDropPayer,type PaidDropResult} from '../../src/lib/arena/vm/paid-drop-contract';
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const full=fixture['BT17-035'],row=full.records['BT17-035#0'];
const def=card('BT17-035',{name:full.card.name,type:'BATTLE',colors:['Blue'],energyCost:2,power:10000,characters:full.card.characters,traits:full.card.traits,skill:full.card.skill});
const compiled=clone(skillRecords(def))[0];
assert.deepEqual({...compiled,ops:row.ops,unread:row.unread,pattern:row.pattern,reads:row.reads},row);
assert.deepEqual(compiled.ops,[...row.ops,paidDropTail()]);assert.deepEqual(compiled.unread,[]);
const skill=parseSkills(full.card.skill)[0];
const script:Script={kind:'activate:main',usage:row.usage as Script['usage'],validity:row.validity as Script['validity'],unsupported:[],price:priceFromCostRecord(row.cost as CostRecord),ops:[...clone(row.ops) as Script['ops'],paidDropTail()]};
requirePaidDropShape(skill,script);
const rule=clone({kind:compiled.kind,trigger:compiled.trigger,cost:compiled.cost,usage:compiled.usage,validity:compiled.validity,cond:compiled.cond,ops:compiled.ops}) as Rule;
const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);
const normalizedDsl=(v:unknown)=>JSON.parse(JSON.stringify(v,(k,x)=>k==='upTo'&&x===false?undefined:x));assert.deepEqual(normalizedDsl(parsed.value),normalizedDsl(rule));
requirePaidDropShape(skill,{...script,ops:parsed.value.ops,price:priceFromCostRecord(parsed.value.cost!)});

let cases=0;const refusal=(fn:()=>unknown)=>{assert.throws(fn,e=>e instanceof IllegalAction);cases++;};
for(const master of ['p1','p2'] as const)for(const foreign of [false,true])for(const blue of [false,true]){
 const source:OrdinaryActivateSource={occurrence:{card:'tao',cardId:def.id,epoch:4,hiddenCount:0,area:'hand',holder:master},master,skill,script,flipped:false,priceContext:{optionalOwnDiscard:false}};
 const owner=foreign?(master==='p1'?'p2':'p1'):master;
 const payer:PaidDropPayer={card:'payer',cardId:blue?'BT17-040':'BT17-042',owner,holder:master,area:'battle',epoch:3,hiddenCount:0,flipped:false,attributes:{type:'BATTLE',characters:[blue?'General Blue':'Colonel Violet'],traits:['Red Ribbon Army'],energyCost:1,power:blue?4000:10000}};
 const capture=capturePaidDrop(source,payer);requirePendingPaidDrop(source,clone(capture),payer);cases++;
 const result:PaidDropResult={capture,outcome:{card:'payer',from:'battle',fromEpoch:3,to:'drop',toEpoch:4,completed:true},destination:{holder:owner,attributes:clone(payer.attributes)}};
 const info=completedPaidDropInfo(source,clone(result));assert.deepEqual(info,foreign?{}:{payer:payer.attributes});cases++;
 for(const fault of ['missing','nullPayer','sourceEpoch','payerEpoch','attributes','holder','owner','false','destination','changedIdentity'] as const){
  const r=clone(result);
  if(fault==='missing')delete r.outcome;if(fault==='nullPayer')r.capture.payer=null as never;if(fault==='sourceEpoch')source.occurrence.epoch++;if(fault==='payerEpoch')r.capture.payer.epoch++;if(fault==='attributes')r.capture.payer.attributes=null as never;if(fault==='holder')r.destination!.holder=owner==='p1'?'p2':'p1';if(fault==='owner')r.capture.payer.owner=owner==='p1'?'p2':'p1';if(fault==='false')r.outcome!.completed=false;if(fault==='destination')r.outcome!.to='removed';if(fault==='changedIdentity')r.destination!.attributes={...payer.attributes,characters:[blue?'Colonel Violet':'General Blue']};
  refusal(()=>completedPaidDropInfo(source,r));if(fault==='sourceEpoch')source.occurrence.epoch--;
 }
 const stale=clone(payer);stale.epoch++;refusal(()=>requirePendingPaidDrop(source,capture,stale));
}
for(const fault of ['kind','nullTrigger','trigger','limit','type','area','count','optional','playAlias','priceAlias','amount','duration','sourceArea','nullOps'] as const){
 const s=clone(script);
 if(fault==='kind')s.kind='auto';if(fault==='nullTrigger')s.trigger=null as never;if(fault==='trigger')s.trigger=['played'];if(fault==='limit')s.usage!.limit=2;
 const choice=s.price!.ops![0];assert.equal(choice.op,'choose');if(choice.op==='choose'){if(fault==='type')choice.sel.filter!.type='BATTLE';if(fault==='area')choice.sel.area='battle';if(fault==='count')choice.sel.count=2;if(fault==='optional')choice.sel.upTo=true;if(fault==='priceAlias')choice.as='paid_own_drop';}
 const play=s.ops[1];if(fault==='playAlias'&&play.op==='play')play.target={var:'other'};
 const tail=s.ops[2];if(tail.op==='if'&&tail.then[0].op==='power'){if(fault==='amount')tail.then[0].amount=10000;if(fault==='duration')tail.then[0].until='battle';}
 if(fault==='sourceArea'&&s.ops[0].op==='choose')s.ops[0].sel.area='drop';if(fault==='nullOps')s.ops=null as never;
 refusal(()=>requirePaidDropShape(skill,s));
}
for(const [before,after] of [['[Activate: Main]','[Activate: Battle]'],['[Limit 1]','[Limit 2]'],['Choose 1','Choose up to 1'],['cards with an energy cost','Battle Cards with an energy cost'],['owner\'s Drop Area','owner\'s Warp'],['<General Blue>','<Colonel Violet>'],['+5000','+10000'],['for the turn','for the battle']] as const){
 const changed=parseSkills(row.printed.replace(before,after))[0];const context:Ctx={permanent:false,last:null,choices:[],lastSeen:null,lastNamed:null,mills:0,costs:0,lastPlayed:null,lastTarget:null,stale:null,twoNamedCardsRefused:false,lastOp:null,replacing:null,n:0,raw:changed.effect,xBound:false};
 const original=clone(context);assert.equal(compilePaidDropFollowup(changed,script,context),null,`${before} → ${after}`);assert.deepEqual(context,original);cases++;
}
console.log(`paid-drop-contract-5: ${cases} isolated candidate cases PASS; exact Tao compiler admission`);
