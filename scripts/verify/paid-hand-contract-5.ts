/** R525 isolated source/schema/history contracts; gameplay is in paid-hand-5. */
import assert from 'node:assert/strict';
import fixture from './fixtures/paid-hand-5.json';
import {card} from './harness';
import {skillRecords} from '../../src/lib/arena/draft';
import {parseSkills} from '../../src/lib/arena/text/cards';
import {parseRule,printRule,type Rule} from '../../src/lib/arena/lang';
import {compilePaidHand} from '../../src/lib/arena/compile/paid-hand';
import {priceFromCostRecord} from '../../src/lib/arena/vm/skill-payment';
import {validateProgram,type CostRecord} from '../../src/lib/arena/vm/script';
import type {OrdinaryActivateSource} from '../../src/lib/arena/vm/ordinary-activate-cost';
import {IllegalAction} from '../../src/lib/arena/vm/illegal-action';
import {allHandPaymentMove,allHandPaymentOp,requirePaidHandShape,captureHandPayment,completeHandPayment,requireHandProgress} from '../../src/lib/arena/vm/paid-hand-contract';
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const c=fixture.card,skill=parseSkills(c.backSkill!)[0],script=compilePaidHand(skill)!;assert.ok(script);
const d=card(c.id,{name:c.name,type:'LEADER',colors:c.colors as never,energyCost:null,power:c.power,characters:c.characters,traits:c.traits,skill:c.skill,back:{name:c.backName!,power:5000,skill:c.backSkill!}});
const row=skillRecords(d).find(r=>r.side==='back'&&r.skillIndex===0)!;
const baseline=fixture.records['P-045#0b'];
assert.deepEqual(Object.keys(row).sort(),Object.keys(baseline).sort());
const changed=Object.keys(row).filter(k=>JSON.stringify((row as unknown as Record<string,unknown>)[k])!==JSON.stringify((baseline as unknown as Record<string,unknown>)[k]));
assert.deepEqual(changed.sort(),['cost','ops','pattern','reads','unread']);
assert.deepEqual({...row.cost,condition:baseline.cost.condition,program:baseline.cost.program},baseline.cost);
const rule=clone({kind:row.kind,trigger:row.trigger,cost:row.cost,usage:row.usage,validity:row.validity,cond:row.cond,ops:row.ops}) as Rule;
const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);
const norm=(v:unknown)=>JSON.parse(JSON.stringify(v,(k,x)=>k==='upTo'&&x===false?undefined:x));assert.deepEqual(norm(parsed.value),norm(rule));
requirePaidHandShape(skill,{...script,ops:parsed.value.ops,price:priceFromCostRecord(parsed.value.cost as CostRecord)});
let cases=0;const refuses=(fn:()=>unknown)=>{assert.throws(fn,e=>e instanceof IllegalAction);cases++;};
for(const master of ['p1','p2'] as const)for(const n of [1,4,5,6,100]){
 const source:OrdinaryActivateSource={occurrence:{card:'leader',cardId:c.id,epoch:0,hiddenCount:0,area:'leader',holder:master},master,skill,script,flipped:true,priceContext:{optionalOwnDiscard:false}};
 const selected=Array.from({length:n},(_,i)=>({card:`payer${i}`,epoch:i,hiddenCount:0,owner:master}));
 const capture=captureHandPayment(source,selected),result={version:1 as const,selected:selected.map(p=>({card:p.card,epoch:p.epoch})),outcomes:selected.map(p=>({card:p.card,from:'hand',fromEpoch:p.epoch,to:'drop',toEpoch:p.epoch+1,completed:true}))};
 completeHandPayment(source,clone(capture),clone(result));cases++;
 for(const fault of ['null','selected','duplicate','source','outcome','order','destination','epoch','incomplete'] as const){const x=clone(capture),r=clone(result);if(fault==='null')refuses(()=>completeHandPayment(source,null as never,r));else {if(fault==='selected')x.selected=null as never;if(fault==='duplicate')x.selected.push(x.selected[0]);if(fault==='source')x.source+='x';if(fault==='outcome')r.outcomes[0]=null as never;if(fault==='order')r.outcomes[0].card='wrong';if(fault==='destination')r.outcomes[0].to='warp';if(fault==='epoch')r.outcomes[0].toEpoch++;if(fault==='incomplete')r.outcomes[0].completed=false;refuses(()=>completeHandPayment(source,x,r));}}
 requireHandProgress(source,capture,{...result,outcomes:[]},0);cases++;
}
for(const key of ['trigger','usage','validity','price','ops','unsupported'] as const){const bad=clone(script);(bad as unknown as Record<string,unknown>)[key]=null;refuses(()=>requirePaidHandShape(skill,bad));}
for(const change of [(s:typeof skill)=>{s.raw=s.raw.replace(" (you can't activate this ability with no cards in hand)",'');},(s:typeof skill)=>{s.effect=s.effect!.replace('50000','40000');},(s:typeof skill)=>{s.cost=s.cost!.replace('all cards','up to 5 cards');},(s:typeof skill)=>{s.kind='activate:battle';},(s:typeof skill)=>{s.oncePerTurn=false;}]){const bad=clone(skill);change(bad);assert.equal(compilePaidHand(bad),null);cases++;}
assert.equal(allHandPaymentMove(allHandPaymentOp()),true);assert.equal(validateProgram([allHandPaymentOp()]),true);
for(const mutate of [(o:ReturnType<typeof allHandPaymentOp>)=>{o.to='warp';},(o:ReturnType<typeof allHandPaymentOp>)=>{o.target={sel:{side:'you',area:'hand',count:5}};},(o:ReturnType<typeof allHandPaymentOp>)=>{o.completedAs='other';}]){const op=allHandPaymentOp();mutate(op);assert.equal(allHandPaymentMove(op),false);assert.equal(validateProgram([op]),false);cases++;}
console.log(`paid-hand-contract-5: ${cases} contracts plus full-source DSL assertions passed`);
