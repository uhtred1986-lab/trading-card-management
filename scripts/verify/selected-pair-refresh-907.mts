/** Offline application plan. Writes only local evidence, never the database.
 * Allow metadata-only migrations and explicitly reviewed exact program repairs.
 * Actual application still uses atomic lock-and-compare arena:refresh-ids. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {cardDefFrom} from '../../src/lib/arena/load.ts';
import {skillRecords} from '../../src/lib/arena/draft.ts';
import {zeroCostRecord} from '../../src/lib/arena/vm/skill-payment.ts';
import {sem,normPrinted} from '../lib/refresh-ids.ts';
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
 if(['BT6-060/front/10','BT6-061/front/10'].includes(key))reasons.push('known Counter energy-cost qualifier requires separate semantic proof');
 const upgradedCost=old.cost==null ? zeroCostRecord() : {version:1,readable:true,...old.cost};
 let metadataOnly=sem({...fresh,usage:old.usage,validity:old.validity,cost:fresh.cost})===sem({...old,cost:upgradedCost});
 let reviewedRepair:string|null=null;
 if(key==='BT6-060/front/20'&&!metadataOnly){
   const repaired=structuredClone(old);
   assert.equal(repaired.ops[0].op,'choose');
   assert.equal(repaired.ops[0].reason,"Choose up to 1 of your opponent's Battle Cards ignoring [Barrier]");
   assert.equal(repaired.ops[0].sel.ignoreBarrier,undefined);
   repaired.ops[0].sel.ignoreBarrier=true;
   repaired.ops[0].reason="Choose up to 1 of your opponent's Battle Cards";
   assert.equal(repaired.reads,"choose up to 1 Battle Card in your opponent's Battle Area, KO the chosen cards");
   repaired.reads="choose up to 1 Battle Card in your opponent's Battle Area ignoring [Barrier], KO the chosen cards";
   metadataOnly=sem({...fresh,usage:old.usage,validity:old.validity})===sem({...repaired,cost:upgradedCost});
   assert.ok(metadataOnly,'Barrier repair must be the only extra change');
   reviewedRepair='Existing compiler omitted printed ignoring [Barrier]; both-seat actual-program usage proof covers Barrier target';
 }
 if(!metadataOnly)reasons.push('other semantic/reading difference requires separate review');
 const record={key,id:old.id,version:old.version,status:old.status,source:old.source,metadataOnly:metadataOnly&&!reviewedRepair,reviewedRepair,reasons};
 if(reasons.length)held.push(record);else plan.push(record);
}
const out={before:beforePath,plan,held,protectedUnchanged:[...protectedKeys],note:'No human confirmation or pair qualification; frozen original inputs remain unchanged'};
writeFileSync(process.argv[outFlag+1],JSON.stringify(out,null,2)+'\n');
writeFileSync(process.argv[idsFlag+1],plan.map(r=>r.key).join('\n')+'\n');
console.log(JSON.stringify({planned:plan.length,held:held.map(r=>({key:r.key,reasons:r.reasons}))},null,2));
