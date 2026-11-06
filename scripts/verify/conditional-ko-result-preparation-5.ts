/** R506 complete frozen source checks and native paid-play setup prerequisites. */
import assert from "node:assert/strict";
import fixture from "./fixtures/conditional-ko-result-5.json";
import {skillRecords} from "../../src/lib/arena/draft";
import {card} from "./harness";
import {copy,records,ctx,game,fresh,stage,paidCell,playHand} from "./conditional-ko-result-harness-5";
import {attrsNow} from "../../src/lib/arena/vm/program";
import {vmHost} from "../../src/lib/arena/vm/host";
import {moveCard} from "../../src/lib/arena/vm/zones";
import {parseRule,printRule,type Rule} from "../../src/lib/arena/lang";
import type {PlayerId} from "../../src/lib/arena/types";
// DSL omits explicit upTo:false; compare this documented selector default canonically.
const dslCanonical=(x:unknown)=>JSON.parse(JSON.stringify(x,(key,value)=>key==="upTo"&&value===false?undefined:value));
for(const [id,item] of Object.entries(fixture))for(const old of Object.values(item.records)){const row=records.find(r=>r.cardId===id&&r.side===old.side&&r.skillIndex===old.skillIndex);if(id==="BT3-071"&&old.skillIndex===10){
 const expected=copy(old);assert.equal(row!.unread.length,0);assert.deepEqual(copy(row!.ops.slice(0,1)),expected.ops.slice(0,1));assert.deepEqual(row!.ops[1],{...expected.ops[1],completedAs:"c0"});assert.deepEqual(row!.ops[2],{op:"if",cond:{kind:"koedByThisSkill",var:"c0",costMax:3},then:[{op:"draw",n:1}]});
 for(const field of ["printed","kind","trigger","cost","usage","validity","combo","cond"] as const)assert.deepEqual(copy(row![field]),expected[field]);
 }else assert.deepEqual(copy(row),old);if(!row!.unread.length){const rule=copy({kind:row!.kind,trigger:row!.trigger,cost:row!.cost,usage:row!.usage,validity:row!.validity,cond:row!.cond,ops:row!.ops}) as Rule;const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);assert.deepEqual(dslCanonical(parsed.value),dslCanonical(rule));}}
const tail="your opponent chooses 1 of their Battle Cards and KO-s it. If this skill is used to KO a Battle Card with an energy cost of 3 or less, draw 1 card.";
for(const text of [`[Activate: Main] ${tail}`,`[Auto] {g}: When this card is played, ${tail}`,`[Auto] When this card attacks, ${tail}`,`[Auto] When this card is played, choose one—\n・${tail}\n・Draw 1 card.`, `[Auto] When this card is played, ${tail.replace("chooses 1", "chooses 2")}`,`[Auto] When this card is played, ${tail.replace("3 or less", "4 or less")}`]){const rows=skillRecords(card("NEAR",{skill:text}));assert.ok(rows.some(r=>r.unread.length),text);assert.ok(!JSON.stringify(rows.map(r=>r.ops)).includes("koedByThisSkill"),text);}
let cases=0;
for(const p of ["p1","p2"] as PlayerId[]){
 {const played=paidCell(fresh(p),p),s=played.state,id=played.card;assert.equal(attrsNow(ctx,game,s,id).costOf,3);vmHost(ctx,game,s,[]).ko(id,undefined);assert.ok(s.sides[p].zones.removed.includes(id));assert.equal(attrsNow(ctx,game,s,id).costOf,3);cases++;}
 {let s=fresh(p);for(const id of [...s.sides[p].zones.hand])assert.ok(moveCard(s,game,id,"deck").ok);const id=stage(s,p,"BT2-006","hand");for(let i=0;i<2;i++)stage(s,p,"Red","energy");assert.equal(attrsNow(ctx,game,s,id).costOf,2);s=playHand(s,id);assert.equal(attrsNow(ctx,game,s,id).costOf,2);vmHost(ctx,game,s,[]).ko(id,undefined);assert.ok(s.sides[p].zones.drop.includes(id));assert.equal(attrsNow(ctx,game,s,id).costOf,6);cases++;}
 {let s=fresh(p);const id=stage(s,p,"BT4-124","hand");for(let i=0;i<10;i++)stage(s,p,"Black","energy");s=playHand(s,id);assert.ok(s.sides[p].zones.battle.includes(id));vmHost(ctx,game,s,[]).ko(id,undefined);assert.ok(s.sides[p].zones.removed.includes(id));assert.equal(attrsNow(ctx,game,s,id).costOf,10);cases++;}
 {let s=fresh(p);const id=stage(s,p,"BT3-071","hand");stage(s,p==="p1"?"p2":"p1","LOW","battle");for(let i=0;i<4;i++)stage(s,p,"Green","energy");const hand=s.sides[p].zones.hand.length;s=playHand(s,id);assert.equal(s.sides[p].zones.hand.length,hand);cases++;}
}
console.log(`conditional-ko-result-preparation-5: ${cases} baseline scenarios PASS (native paid plays; mechanism KO, Android14 conditional draw)`);
