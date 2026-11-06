/** Baseline preparation; Android14 remains explicitly unsupported until R506 implementation. */
import assert from "node:assert/strict";
import fixture from "./fixtures/conditional-ko-result-5.json";
import {copy,records,ctx,game,fresh,stage,paidCell,playHand} from "./conditional-ko-result-harness-5";
import {attrsNow} from "../../src/lib/arena/vm/program";
import {vmHost} from "../../src/lib/arena/vm/host";
import {moveCard} from "../../src/lib/arena/vm/zones";
import {parseRule,printRule,type Rule} from "../../src/lib/arena/lang";
import type {PlayerId} from "../../src/lib/arena/types";
// DSL omits explicit upTo:false; compare this documented selector default canonically.
const dslCanonical=(x:unknown)=>JSON.parse(JSON.stringify(x,(key,value)=>key==="upTo"&&value===false?undefined:value));
for(const [id,item] of Object.entries(fixture))for(const old of Object.values(item.records)){const row=records.find(r=>r.cardId===id&&r.side===old.side&&r.skillIndex===old.skillIndex);assert.deepEqual(copy(row),old);if(!row!.unread.length){const rule=copy({kind:row!.kind,trigger:row!.trigger,cost:row!.cost,usage:row!.usage,validity:row!.validity,cond:row!.cond,ops:row!.ops}) as Rule;const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);assert.deepEqual(dslCanonical(parsed.value),dslCanonical(rule));}}
let cases=0;
for(const p of ["p1","p2"] as PlayerId[]){
 {const played=paidCell(fresh(p),p),s=played.state,id=played.card;assert.equal(attrsNow(ctx,game,s,id).costOf,3);vmHost(ctx,game,s,[]).ko(id,undefined);assert.ok(s.sides[p].zones.removed.includes(id));assert.equal(attrsNow(ctx,game,s,id).costOf,3);cases++;}
 {let s=fresh(p);for(const id of [...s.sides[p].zones.hand])assert.ok(moveCard(s,game,id,"deck").ok);const id=stage(s,p,"BT2-006","hand");for(let i=0;i<2;i++)stage(s,p,"Red","energy");assert.equal(attrsNow(ctx,game,s,id).costOf,2);s=playHand(s,id);assert.equal(attrsNow(ctx,game,s,id).costOf,2);vmHost(ctx,game,s,[]).ko(id,undefined);assert.ok(s.sides[p].zones.drop.includes(id));assert.equal(attrsNow(ctx,game,s,id).costOf,6);cases++;}
 {let s=fresh(p);const id=stage(s,p,"BT4-124","hand");for(let i=0;i<10;i++)stage(s,p,"Black","energy");s=playHand(s,id);assert.ok(s.sides[p].zones.battle.includes(id));vmHost(ctx,game,s,[]).ko(id,undefined);assert.ok(s.sides[p].zones.removed.includes(id));assert.equal(attrsNow(ctx,game,s,id).costOf,10);cases++;}
 {let s=fresh(p);const id=stage(s,p,"BT3-071","hand");stage(s,p==="p1"?"p2":"p1","LOW","battle");for(let i=0;i<4;i++)stage(s,p,"Green","energy");s=playHand(s,id,true);assert.ok(s.outcome,JSON.stringify(s.prompt));assert.equal(s.outcome.kind,"interrupted");assert.ok(JSON.stringify(s.outcome).includes("If this skill is used to KO a Battle Card with an energy cost of 3 or less"));cases++;}
}
console.log(`conditional-ko-result-preparation-5: ${cases} baseline scenarios PASS (native paid plays; mechanism KO, unsupported Android14)`);
