import {compilePaidWarp} from '../../src/lib/arena/compile/paid-warp';
import {parseRule,printRule,type Rule} from '../../src/lib/arena/lang';
import {priceFromCostRecord} from '../../src/lib/arena/vm/skill-payment';
import assert from 'node:assert/strict';
import fixture from './fixtures/paid-warp-count-5.json';
import {card} from './harness';
import {skillRecords} from '../../src/lib/arena/draft';
import {parseSkills} from '../../src/lib/arena/text/cards';
import type {Script} from '../../src/lib/arena/vm/script';
import type {MovementResult} from '../../src/lib/arena/vm/movement-result';
import {IllegalAction} from '../../src/lib/arena/vm/illegal-action';
import {paidWarpPrice,paidWarpBody,requirePaidWarpShape,captureWarpSelection,requireWarpProgress,completedWarpPayers,type PaidWarpSource} from '../../src/lib/arena/vm/paid-warp-contract';
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const full=fixture['P-764'],row=full.records['P-764#20'];
const def=card('P-764',{type:'Z-BATTLE',colors:['Green'],energyCost:6,zEnergyCost:1,power:25000,name:full.card.name,characters:full.card.characters,traits:full.card.traits,skill:full.card.skill});
const records=clone(skillRecords(def)),compiled=records.find(r=>r.skillIndex===20)!;assert.deepEqual(records.filter(r=>r.skillIndex!==20),Object.values(full.records).filter(r=>r.skillIndex!==20));assert.deepEqual({...compiled,cost:row.cost,ops:row.ops,reads:row.reads,unread:row.unread,pattern:row.pattern},row);assert.deepEqual(compiled.unread,[]);assert.deepEqual(compiled.cost?.program,paidWarpPrice().ops);assert.deepEqual(compiled.ops,paidWarpBody());assert.deepEqual({...compiled.cost,program:row.cost.program},row.cost);
const skill=parseSkills(full.card.skill).find(s=>s.index===20)!;
const script:Script={kind:'auto',trigger:['attacks'],usage:{version:1,oncePerTurn:false,limit:null},validity:{version:1,sparking:null},unsupported:[],price:paidWarpPrice(),ops:paidWarpBody()};
requirePaidWarpShape(skill,script);
const rule=clone({kind:row.kind,trigger:row.trigger,cost:{...row.cost,program:paidWarpPrice().ops},usage:row.usage,validity:row.validity,cond:row.cond,ops:paidWarpBody()}) as Rule;
const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);const norm=(v:unknown)=>JSON.parse(JSON.stringify(v,(k,x)=>k==='upTo'&&x===false?undefined:x));assert.deepEqual(norm(parsed.value),norm(rule));requirePaidWarpShape(skill,{...script,ops:parsed.value.ops,price:priceFromCostRecord(parsed.value.cost!)});
let cases=0;const refusal=(fn:()=>unknown)=>{assert.throws(fn,e=>e instanceof IllegalAction);cases++;};
for(const master of ['p1','p2'] as const)for(const n of [3,4,5]){
 const source:PaidWarpSource={version:1,card:'source',cardId:def.id,master,skillIndex:20,epoch:2,hiddenCount:0,flipped:false,skill,script};
 const payers=Array.from({length:n},(_,i)=>({card:`payer${i}`,epoch:i,owner:master,name:`Printed name ${i}`}));const capture=captureWarpSelection(source,payers);
 const result:MovementResult={version:1,selected:payers.map(p=>({card:p.card,epoch:p.epoch})),outcomes:payers.map(p=>({card:p.card,from:'drop',fromEpoch:p.epoch,to:'warp',toEpoch:p.epoch+1,completed:true}))};
 for(let i=0;i<=n;i++){requireWarpProgress(source,clone(capture),{...clone(result),outcomes:result.outcomes.slice(0,i)},i);cases++;}
 assert.deepEqual(completedWarpPayers(source,capture,result),payers.map(p=>p.card));cases++;
 for(const fault of ['missing','name','sourceEpoch','duplicate','failed','away','epoch','extra','destination','nullOutcome','order'] as const){const cap=clone(capture),r=clone(result);
  if(fault==='order')[r.outcomes[0],r.outcomes[1]]=[r.outcomes[1],r.outcomes[0]];if(fault==='missing')r.outcomes.pop();if(fault==='name')cap.selected[1].name=cap.selected[0].name;if(fault==='sourceEpoch')source.epoch++;if(fault==='duplicate')r.outcomes[1]=r.outcomes[0];if(fault==='failed')r.outcomes[0].completed=false;if(fault==='away')r.outcomes[0].to='drop';if(fault==='epoch')r.outcomes[0].toEpoch++;if(fault==='extra')r.outcomes.push(r.outcomes[0]);if(fault==='destination')r.outcomes[0].to='invented';if(fault==='nullOutcome')r.outcomes[0]=null as never;
  refusal(()=>completedWarpPayers(source,cap,r));if(fault==='sourceEpoch')source.epoch--;
 }
 refusal(()=>captureWarpSelection(source,payers.slice(0,2)));refusal(()=>captureWarpSelection(source,payers.map(p=>({...p,owner:master==='p1'?'p2':'p1'}))));
}
for(const fault of ['count','minimum','names','burst','paidAlias','bodyCount','bodyOptional','color','trigger','limit'] as const){const s=clone(script);const choose=s.price!.ops![0],body=s.ops[0];
 if(choose.op==='choose'){if(fault==='count')choose.sel.count=3;if(fault==='minimum')choose.sel.minCount=2;if(fault==='names')delete choose.sel.differentNames;if(fault==='paidAlias')choose.as='paid_warp';}
 if(fault==='burst')s.price!.payment.burst=2;if(body.op==='choose'){if(fault==='bodyCount')body.sel.count=2;if(fault==='bodyOptional')body.sel.upTo=false;if(fault==='color')body.sel.filter!.colors=['Blue'];}if(fault==='trigger')s.trigger=['played'];if(fault==='limit')s.usage!.limit=1;
 refusal(()=>requirePaidWarpShape(skill,s));
}
for(const key of ['trigger','usage','validity','unsupported','price','ops'] as const){for(const value of [undefined,null,[null]]){const s=clone(script);(s as unknown as Record<string,unknown>)[key]=value;refusal(()=>requirePaidWarpShape(skill,s));}}
for(const value of [undefined,null,[null],{},[1]]){const k=clone(skill);k.tags=value as never;refusal(()=>requirePaidWarpShape(k,script));}
for(const fault of ['kind','burst','count','names','destination','bodyColor','bodyCount','bodyCost','once','limit','orbs','condition'] as const){const k=clone(skill);
 if(fault==='kind')k.kind='activate:main';if(fault==='burst')k.burst=2;if(fault==='count')k.cost=k.cost.replace('3 or more','3');if(fault==='names')k.cost=k.cost.replace('different card names','the same card name');if(fault==='destination')k.cost=k.cost.replace('Warp','hand');if(fault==='bodyColor')k.effect=k.effect.replace('green','blue');if(fault==='bodyCount')k.effect=k.effect.replace('up to 1','up to 2');if(fault==='bodyCost')k.effect=k.effect.replace('equal to','less than');if(fault==='once')k.oncePerTurn=true;if(fault==='limit')k.limit=1;if(fault==='orbs')k.energyCost={Green:1};if(fault==='condition')k.effect='If an unsupported condition is met, '+k.effect;
 const before=clone(k);assert.equal(compilePaidWarp(k),null,fault);assert.deepEqual(k,before);cases++;
}
for(const [from,to] of [['Send 3 or more','Send 3'],['Send 3 or more','Send 4 or more'],['different card names from your Drop','the same card name from your Drop'],['up to 1 green card','up to 2 green cards'],['up to 1 green card','up to 1 blue card'],['energy cost equal to','energy cost less than'],['[auto] [burst 1]','[activate: main] [burst 1]'],['[auto] [burst 1]','[auto] [once per turn] [burst 1]'],['[auto] [burst 1]','[auto] [burst 2]']] as const){const changed=card('near',{...def,id:'near',skill:full.card.skill.replace(from,to)});assert.notEqual(changed.skill,full.card.skill);const rs=skillRecords(changed),r=rs.find(x=>x.skillIndex===20)!;assert.ok(r.unread.length,from+' -> '+to);assert.ok(!JSON.stringify(r.ops).includes('paid_warp'));assert.ok(!JSON.stringify(r.cost?.program).includes('warp_payers'));cases++;}
console.log(`paid-warp-contract-5: ${cases} isolated contract cases PASS; full P-764 record and DSL checked`);
