/** Offline application plan. Writes only local evidence, never the database.
 * Allow metadata-only migrations and explicitly reviewed exact program repairs.
 * Actual application still uses atomic lock-and-compare arena:refresh-ids. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {cardDefFrom} from '../../src/lib/arena/load.ts';
import {skillRecords} from '../../src/lib/arena/draft.ts';
import {fusionMaterialsProblem} from '../../src/lib/arena/vm/fusion-materials.ts';
import {evolutionBaseProblem} from '../../src/lib/arena/vm/evolution-base.ts';
import {zeroCostRecord} from '../../src/lib/arena/vm/skill-payment.ts';
import {sem,normPrinted,parseIdList} from '../lib/refresh-ids.ts';
const base='docs/arena-backlog/evidence/';
const catalog: Parameters<typeof cardDefFrom>[0][]=JSON.parse(readFileSync(base+'897/selected-pair-inputs-2026-10-19/catalog.json','utf8')).cards;
const beforeFlag=process.argv.indexOf('--before');
const beforePath=beforeFlag<0?base+'907/combo-qualifications-2026-10-19/stored-rules-after-combo.json':process.argv[beforeFlag+1];
const current=JSON.parse(readFileSync(beforePath,'utf8'));
assert.equal(current.length,67);
const outFlag=process.argv.indexOf('--out'); assert.ok(outFlag>=0&&process.argv[outFlag+1],'--out evidence path required');
const idsFlag=process.argv.indexOf('--ids-out'); assert.ok(idsFlag>=0&&process.argv[idsFlag+1],'--ids-out path required');
const protectedKeys=new Set(['BT6-001/back/10','BT6-012/front/30','BT6-013/front/20','BT6-015/front/20']);
const plan=[]; const held=[];
for(const old of current){
 const key=`${old.card_id}/${old.side}/${old.skill_index}`;
 const card=catalog.find(c=>c.id===old.card_id); assert.ok(card,key);
 const def=cardDefFrom(card);
 const fresh=skillRecords(def).find(r=>r.side===old.side&&r.skillIndex===old.skill_index)!;
 assert.ok(fresh,key);
 const reasons=[];
 if(protectedKeys.has(key))reasons.push('protected user correction');
 if(!['draft','open'].includes(old.status)||old.source!=='compiler')reasons.push('not eligible compiler-owned open/draft');
 if(normPrinted(fresh.printed)!==normPrinted(old.printed))reasons.push('source not current');
 if(fresh.unread.length)reasons.push('fresh unread');
 const upgradedCost=old.cost==null ? zeroCostRecord() : {version:1,readable:true,...old.cost};
 let metadataOnly=sem({...fresh,usage:old.usage,validity:old.validity,cost:fresh.cost})===sem({...old,cost:upgradedCost});
 let reviewedRepair:string|null=null;
 if(['BT6-060/front/20','BT6-059/front/20'].includes(key)&&!metadataOnly){
   const positiveBarrier=key==='BT6-059/front/20';
   const repaired=structuredClone(old);
   assert.equal(repaired.ops[0].op,'choose');
   assert.equal(repaired.ops[0].reason,positiveBarrier?"choose up to 1 of your opponent's Battle Cards with [Barrier] ignoring [Barrier]":"Choose up to 1 of your opponent's Battle Cards ignoring [Barrier]");
   assert.equal(repaired.ops[0].sel.ignoreBarrier,undefined);
   repaired.ops[0].sel.ignoreBarrier=true;
   repaired.ops[0].reason=positiveBarrier?"choose up to 1 of your opponent's Battle Cards with [Barrier]":"Choose up to 1 of your opponent's Battle Cards";
   assert.equal(repaired.reads,`choose up to 1 Battle Card${positiveBarrier?" with [Barrier]":""} in your opponent's Battle Area, KO the chosen cards`);
   repaired.reads=`choose up to 1 Battle Card${positiveBarrier?" with [Barrier]":""} in your opponent's Battle Area ignoring [Barrier], KO the chosen cards`;
   metadataOnly=sem({...fresh,usage:old.usage,validity:old.validity})===sem({...repaired,cost:upgradedCost});
   assert.ok(metadataOnly,'Barrier repair must be the only extra change');
   reviewedRepair='Existing compiler omitted printed ignoring [Barrier]; both-seat actual-program proof covers Barrier target and retained positive target properties';
 }
 if(['BT6-053/front/10','BT6-053/back/0'].includes(key)&&!metadataOnly){
   const repaired=structuredClone(old), back=old.side==='back';
   assert.deepEqual(repaired.ops,[]); assert.equal(repaired.cond,null);
   assert.deepEqual(repaired.unread,["You can't add cards from your life to your hand "+(back?'during your turn':'for the duration of the turn')]);
   assert.deepEqual(fresh.ops,[{op:'forbid',what:'addLifeToHand',side:'you',until:back?'game':'turn'}]);
   assert.deepEqual(fresh.cond,back?{kind:'isTurnPlayer'}:null);
   assert.equal(fresh.pattern,back?'if:isTurnPlayer[forbid:addLifeToHand]':'forbid:addLifeToHand');
   assert.match(fresh.reads,/add cards from life to hand/);
   repaired.ops=fresh.ops; repaired.cond=fresh.cond; repaired.unread=[];
   repaired.pattern=fresh.pattern; repaired.reads=fresh.reads;
   metadataOnly=sem({...fresh,usage:old.usage,validity:old.validity})===sem({...repaired,cost:upgradedCost});
   assert.ok(metadataOnly,'Life prohibition must be the only extra change');
   reviewedRepair='Exact Paragus prohibition previously unread; both-seat Life-lock/official Broly Q7 continuation and actual damage proofs';
 }
 if(['BT6-060/front/10','BT6-061/front/10'].includes(key)&&!metadataOnly){
   const repaired=structuredClone(old);
   assert.deepEqual(repaired.ops,[{op:'forbid',side:'opponent',what:'activateCounter',until:'game'}]);
   repaired.ops[0].filter={costMin:2};
   assert.equal(repaired.reads,"if this card is attacking: your opponent can't activate [Counter] skills");
   assert.match(fresh.reads,/energy cost of 2 or more/);
   repaired.reads=fresh.reads;
   metadataOnly=sem({...fresh,usage:old.usage,validity:old.validity})===sem({...repaired,cost:upgradedCost});
   assert.ok(metadataOnly,'Counter card-cost bound must be the only extra change');
   reviewedRepair='Existing compiler dropped printed Counter cost>=2 bound; both-seat current-card-cost, skill-price and live-refusal proofs';
 }
 if(['BT6-012/front/0','BT6-013/front/0','BT6-015/front/10'].includes(key)&&!metadataOnly){
   const fusion=fresh.cost?.fusion; assert.ok(fusion); assert.equal(fusionMaterialsProblem(fusion),null);
   assert.equal(fresh.kind,'keyword'); assert.equal(fusion.samePower,true);
   assert.equal(fusion.activation,'hand'); assert.equal(fusion.base,'hand');
   assert.deepEqual(fusion.needs.map(n=>({name:n.name,colors:n.filter.colors})),[{name:'Son Goku: Br',colors:['Red']},{name:'Vegeta: Br',colors:['Red']}]);
   const repaired={...old,cost:{...upgradedCost,fusion}};
   metadataOnly=sem({...fresh,usage:old.usage,validity:old.validity})===sem(repaired);
   assert.ok(metadataOnly,'Typed Fusion contract must be the only extra change');
   reviewedRepair='Previously delivered typed Fusion material contract plus persisted keyword kind; exact three frozen both-seat payment/play/draw and identity proofs';
 }
 if(key==='BT6-014/front/0'&&!metadataOnly){
   const evolution=fresh.cost?.evolution; assert.ok(evolution); assert.equal(evolutionBaseProblem(evolution),null);
   assert.equal(fresh.kind,'keyword');
   assert.deepEqual({version:evolution.version,variant:evolution.variant,activation:evolution.activation,area:evolution.base.area,side:evolution.base.side},
     {version:1,variant:'EX-Evolve',activation:'hand',area:'battle',side:'you'});
   assert.deepEqual(evolution.base.filter.colors,['Red']);
   assert.deepEqual(evolution.base.filter.characters,['Gogeta: Br']);
   assert.equal(evolution.base.filter.type,'BATTLE');
   assert.equal(evolution.base.filter.costMin,6); assert.equal(evolution.base.filter.costMax,6);
   metadataOnly=sem({...fresh,usage:old.usage,validity:old.validity})===sem({...old,cost:{...upgradedCost,evolution}});
   assert.ok(metadataOnly,'Typed EX-Evolve base must be the only extra change');
   reviewedRepair='Typed EX-Evolve hand/Main identity and own Battle Area red Gogeta: Br current-energy-six base; existing two-red-hand payment and effect bodies preserved';
 }
 if(!metadataOnly)reasons.push('other semantic/reading difference requires separate review');
 const record={key,id:old.id,version:old.version,status:old.status,source:old.source,metadataOnly:metadataOnly&&!reviewedRepair,reviewedRepair,reasons,...(reviewedRepair?{beforeProgram:{cost:old.cost,cond:old.cond,ops:old.ops,unread:old.unread,reads:old.reads},afterProgram:{cost:fresh.cost,cond:fresh.cond,ops:fresh.ops,unread:fresh.unread,reads:fresh.reads,usage:fresh.usage,validity:fresh.validity}}:{})};
 if(reasons.length)held.push(record);else plan.push(record);
}
const out={before:beforePath,plan,held,protectedUnchanged:[...protectedKeys],note:'No human confirmation or pair qualification; frozen original inputs remain unchanged'};
writeFileSync(process.argv[outFlag+1],JSON.stringify(out,null,2)+'\n');
const ids=plan.map(r=>{const [card,side,index]=r.key.split('/');return `${card}#${index}#${side}`;}).join('\n')+'\n';
const parsedIds=parseIdList(ids); assert.deepEqual(parsedIds.bad,[]); assert.equal(parsedIds.specs.length,plan.length);
assert.ok(parsedIds.specs.every(s=>s.skill!==null&&s.side!==null),'Only concrete existing face/skill targets may be refreshed');
writeFileSync(process.argv[idsFlag+1],ids);
console.log(JSON.stringify({planned:plan.length,held:held.map(r=>({key:r.key,reasons:r.reasons}))},null,2));
