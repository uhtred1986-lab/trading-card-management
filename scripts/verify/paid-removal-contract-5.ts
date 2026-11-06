/** Isolated preparatory contract only; no compiled or native Battle admission. */
import assert from 'node:assert/strict';
import fixture from './fixtures/paid-removal-contract-5.json';
import {card} from './harness';
import {skillRecords} from '../../src/lib/arena/draft';
import {parseSkills} from '../../src/lib/arena/text/cards';
import {priceFromCostRecord} from '../../src/lib/arena/vm/skill-payment';
import {IllegalAction} from '../../src/lib/arena/vm/illegal-action';
import type {CostRecord,Script} from '../../src/lib/arena/vm/script';
import type {MovementOutcome} from '../../src/lib/arena/vm/movement-result';
import {PAID_REMOVAL_ALIAS,paidRemovalTail,requirePaidRemovalShape,capturePaidRemovalSource,capturePaidRemoval,requirePendingPaidRemoval,completedPaidRemovalInfo,authorizedEmptyPaidRemovalInfo,type PaidRemovalCurrentSource,type PaidRemovalPayer} from '../../src/lib/arena/vm/paid-removal-contract';
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const full=fixture['BT17-131'],row=full.records['BT17-131#10'];
const def=card('BT17-131',{name:full.card.name,type:'EXTRA',colors:['Black'],energyCost:1,skill:full.card.skill});
assert.deepEqual(clone(skillRecords(def)),Object.values(full.records));
assert.equal(full.faq.length,0);assert.equal(row.unread.length,2);
const skill=parseSkills(full.card.skill).find(s=>s.index===10)!;
// Explicit temporary proposed full body, never installed into ctx.scripts or the compiler.
const script:Script={kind:'activate:battle',trigger:[],usage:clone(row.usage) as Script["usage"],validity:clone(row.validity) as Script["validity"],unsupported:[],price:priceFromCostRecord(clone(row.cost) as CostRecord),ops:[...clone(row.ops) as Script['ops'],paidRemovalTail()]};
requirePaidRemovalShape(skill,script);
assert.notEqual((script.price!.ops![0] as {as:string}).as,PAID_REMOVAL_ALIAS);
assert.notEqual((script.ops[0] as {as:string}).as,PAID_REMOVAL_ALIAS);
let cases=0;
requirePaidRemovalShape({...skill,tags:['Activate: Battle']},script);cases++;
function refusal(fn:()=>unknown){assert.throws(fn,e=>e instanceof IllegalAction);cases++;}
for(const master of ['p1','p2'] as const){
 const current:PaidRemovalCurrentSource={card:'source',cardId:'full-original-extra',master,skillIndex:10,epoch:4};
 const binding=capturePaidRemovalSource(skill,script,current);
 for(const type of ['TOKEN','BATTLE','Z-BATTLE']){
  const payer:PaidRemovalPayer={card:'payer',epoch:7,area:'battle',holder:master,attributes:{type,skillLess:true,power:5000,colors:[],characters:[]}};
  const cap=capturePaidRemoval(skill,script,binding,current,payer),saved=clone(cap),before=JSON.stringify(saved);
  requirePendingPaidRemoval(skill,script,saved,current,payer);assert.equal(JSON.stringify(saved),before);cases++;
  const outcome:MovementOutcome={card:payer.card,from:'battle',to:'removed',fromEpoch:7,toEpoch:8,completed:true};
  const info=completedPaidRemovalInfo(skill,script,saved,{...current,epoch:6},outcome);assert.deepEqual(info,{payer:payer.attributes});assert.equal(info.payer.type,type);assert.equal('cost' in info.payer,false);cases++;
  payer.attributes={...payer.attributes,power:20000};assert.equal(info.payer.power,5000);refusal(()=>requirePendingPaidRemoval(skill,script,saved,current,payer));
  for(const mutate of [ (v:typeof saved)=>{v.payer.epoch=8;}, (v:typeof saved)=>{v.payer.attributes={type:'TOKEN',skillLess:false};},(v:typeof saved)=>{v.payer.attributes={type:'TOKEN',skillLess:true,power:NaN};},(v:typeof saved)=>{v.payer=null as never;},(v:typeof saved)=>{v.source=null as never;} ]){const v=clone(saved);mutate(v);refusal(()=>requirePendingPaidRemoval(skill,script,v,current,{...payer,attributes:info.payer}));}
  for(const changed of [{...outcome,completed:false},{...outcome,to:'drop'},{...outcome,from:'hand'},{...outcome,toEpoch:9},{...outcome,fromEpoch:6},{...outcome,card:'other'}])refusal(()=>completedPaidRemovalInfo(skill,script,saved,current,changed));
 }
 const payer:PaidRemovalPayer={card:'payer',epoch:2,area:'battle',holder:master,attributes:{type:'TOKEN',skillLess:true}};
 const cap=capturePaidRemoval(skill,script,binding,current,payer);
 for(const bad of [undefined,null,[],{}, {...cap,version:2},{...cap,source:{...binding,epoch:5}},{...cap,source:{...binding,canonicalSource:'forged'}},{...cap,source:{...binding,master:master==='p1'?'p2':'p1'}},{...cap,source:{...binding,cardId:'substitution'}},{...cap,payer:{...payer,attributes:{type:'TOKEN',skillLess:true,colors:[null]}}}])refusal(()=>requirePendingPaidRemoval(skill,script,bad,current,payer));
 const empty={version:1,kind:'authorized-empty',source:binding};assert.deepEqual(authorizedEmptyPaidRemovalInfo(skill,script,empty,current,true),{});cases++;
 refusal(()=>authorizedEmptyPaidRemovalInfo(skill,script,undefined,current,true));refusal(()=>authorizedEmptyPaidRemovalInfo(skill,script,empty,current,false));refusal(()=>authorizedEmptyPaidRemovalInfo(skill,script,{...empty,payer},current,true));
}
for(const fault of ['kind','trigger','usage','validity','zeroOrb','priced','count','chooser','target','amount','duration','tailAlias','choiceAlias','missingPrice','missingOps','nullOp','unsupported','unknownFilter'] as const){
 const s=clone(script);
 if(fault==='kind')s.kind='activate:main';if(fault==='trigger')s.trigger=['played'];if(fault==='usage')s.usage!.oncePerTurn=true;if(fault==='validity')s.validity!.sparking=5;if(fault==='zeroOrb')s.price!.payment.orbs={Black:0};if(fault==='priced')s.price!.payment.orbs={Black:1};if(fault==='missingPrice')delete s.price;if(fault==='missingOps')s.ops=null as never;if(fault==='nullOp')s.ops[0]=null as never;if(fault==='unsupported')s.unsupported=['unread'];
 const choose=s.price?.ops?.[0];if(choose?.op==='choose'){if(fault==='count')choose.sel.count=2;if(fault==='chooser')choose.chooser='opponent';if(fault==='choiceAlias')choose.as=PAID_REMOVAL_ALIAS;if(fault==='unknownFilter')choose.sel.filter!.token=true;}
 const power=s.ops?.[1];if(power?.op==='power'){if(fault==='target')power.target={var:'other'};if(fault==='amount')power.amount=15000;if(fault==='duration')power.until='turn';}
 if(fault==='tailAlias'){const tail=s.ops[2];if(tail.op==='if'&&tail.cond.kind==='varMatches')tail.cond.var='c0';}
 refusal(()=>requirePaidRemovalShape(skill,s));
}
for(const mutate of [(s:typeof skill)=>{s.cost='Remove 2 of your skill-less Battle Cards from the game';},(s:typeof skill)=>{s.kind='auto';},(s:typeof skill)=>{s.oncePerTurn=true;},(s:typeof skill)=>{s.energyCost={Black:0};}]){const s=clone(skill);mutate(s);refusal(()=>requirePaidRemovalShape(s,script));}
const reordered=JSON.parse(JSON.stringify(script),(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v);requirePaidRemovalShape(skill,reordered);cases++;
console.log(`paid-removal-contract-5: ${cases} isolated preparation cases PASS; no native admission`);
