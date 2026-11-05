import {rulesFromRows,type RuleRow} from "../../src/lib/arena/rules-store";
import {counterEffectOps,paidCounterAdmission,requireCounterAdmission} from "../../src/lib/arena/vm/counter-admission";
/** R463 compiler/serialized-origin protocol; native energy admission is tested separately. */
import assert from "node:assert/strict";
import {card} from "./harness";
import {skillRecords} from "../../src/lib/arena/draft";
import {programProblem} from "../../src/lib/arena/vm/script-schema";
import {counterEnergyPermit,counterEnergyPermitProblem} from "../../src/lib/arena/vm/counter-energy-contract";
import {counterActivationFrom,requireCounterActivationOrigin} from "../../src/lib/arena/vm/counter-activation-origin";
import type {ScriptFrame} from "../../src/lib/arena/vm/script";
import {parseConditionClause} from "../../src/lib/arena/compile/conditions";
const defs=[
card("BT13-055",{"type": "BATTLE", "name": "Bujin, the Commando", "colors": ["Blue"], "characters": ["Bujin"], "traits": ["Boujack Brigade"], "skill": "[Counter: Attack] If your Leader Card is a ≪Boujack Brigade≫ card: Negate the attack and play this card. If you activated this card's [Counter: Attack] skill from your energy, place the top card of your deck in your energy in Rest Mode.<br>[Permanent] You can activate this card's [Counter] skill from your energy by paying its energy cost and choosing 1 card in your hand and discarding it.", "energyCost": 1, "specifiedCost": {"Blue": 1}}),
card("BT17-050",{"type": "BATTLE", "name": "Android 19, Energy Absorber", "colors": ["Blue"], "characters": ["Android 19"], "traits": ["Android", "Red Ribbon Army"], "skill": "[Counter: Attack] Negate the attack and play this card.\r\n[Permanent] If your Leader Card is a blue ≪Red Ribbon Army≫ card, you can activate this card's [Counter] skill from your energy by paying its energy cost and discarding 1 card from your hand.", "energyCost": 1, "specifiedCost": {"Blue": 1}}),
card("BT17-055",{"type": "BATTLE", "name": "Android 15, Inorganic Horror", "colors": ["Blue"], "characters": ["Android 15"], "traits": ["Android", "Red Ribbon Army"], "skill": "[Deflect]\r\n[Counter: Play] Play this card, and if the Battle Card being played has an energy cost of 3 or less, return it to its owner's hand instead.\r\n[Permanent] If your Leader Card is a blue ≪Red Ribbon Army≫ card, you can activate this card's [Counter] skill from your energy by paying its energy cost.\r\n[Permanent][Bond 3] Blue ≪Android≫: This card gets +10000 power.", "energyCost": 2, "specifiedCost": {"Blue": 1}}),
 ];
let cases=0;
for(const def of defs){const rows=skillRecords(def);const permission=rows.find(r=>r.kind==="permanent"&&r.ops.some(o=>o.op==="permit"&&o.what==="counterFromEnergy"))!;assert.ok(permission,def.id);assert.deepEqual(permission.unread,[]);assert.equal(programProblem(permission.ops),null);assert.equal(counterEnergyPermitProblem(permission.ops[0]),null);cases++;}
assert.ok(counterEnergyPermitProblem(counterEnergyPermit(false,false)),"unsupported unconditional no-discard grammar remains bounded");
assert.equal(parseConditionClause("you activated this card’s [Counter: Attack] skill from your energy",true)?.cond.kind,"counterActivatedFrom");
for(const bad of ["your opponent activated this card’s [Counter: Attack] skill from your energy","you activated another card’s [Counter: Attack] skill from your energy","you activated this card’s [Activate: Main] skill from your energy"]){assert.notEqual(parseConditionClause(bad,true)?.cond.kind,"counterActivatedFrom");cases++;}
const frame:ScriptFrame={ops:[],ip:0,vars:{},card:"source",master:"p1",skillIndex:0,skillKind:"counter",counterActivation:{version:1,card:"source",epoch:7,skillIndex:0,kind:"counter:attack",from:"energy"}};
assert.equal(counterActivationFrom(frame,"energy","counter:attack"),true);const hand=structuredClone(frame);hand.counterActivation!.from="hand";assert.equal(counterActivationFrom(hand,"energy","counter:attack"),false);cases+=2;
for(const fault of ["missing","version","card","skill","epoch","kind","bogus-kind","area"]){const f=structuredClone(frame);if(fault==="missing")delete f.counterActivation;else if(fault==="version")f.counterActivation!.version=0 as 1;else if(fault==="card")f.counterActivation!.card="other";else if(fault==="skill")f.counterActivation!.skillIndex=99;else if(fault==="epoch")f.counterActivation!.epoch=-1;else if(fault==="kind")delete (f.counterActivation as unknown as Record<string,unknown>).kind;else if(fault==="bogus-kind")f.counterActivation!.kind="counter:bogus";else f.counterActivation!.from="battle" as "energy";assert.throws(()=>counterActivationFrom(f,"energy","counter:attack"),/rebuild.*Counter activation origin/);cases++;}
const old=structuredClone(frame);delete old.counterActivation;old.ops=[{op:"if",cond:{kind:"counterActivatedFrom",from:"energy",skill:"counter:attack"},then:[]}];assert.throws(()=>requireCounterActivationOrigin(old,undefined),/rebuild/);const unrelated=structuredClone(old);unrelated.ops=[];assert.doesNotThrow(()=>requireCounterActivationOrigin(unrelated,undefined));cases+=2;
const loaded=rulesFromRows(skillRecords(defs[0]).map((r,id)=>({...r,id,status:"confirmed",source:"compiler"}) as unknown as RuleRow),{[defs[0].id]:defs[0]});
const script=loaded[defs[0].id].bySkill[0]!;
const body=counterEffectOps(script);assert.equal(body[0].op,"negateAttack");
const persisted=JSON.parse(JSON.stringify(body));
assert.ok(paidCounterAdmission(script,persisted),"JSON omission of optional undefined fields preserves paid provenance");cases++;
const reordered=JSON.parse(JSON.stringify(script),(key,value)=>value&&typeof value==="object"&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value);
assert.ok(paidCounterAdmission(reordered,persisted));cases++;
const repeated=structuredClone(script);const outer=repeated.ops[0];assert.equal(outer.op,"if");if(outer.op!=="if")throw new Error("outer");outer.then=[{op:"if",cond:structuredClone(repeated.paidAdmission!.condition),then:outer.then}];
assert.deepEqual(counterEffectOps(repeated),repeated.ops,"a genuinely repeated inner condition remains a resolution gate");cases++;
const effect:ScriptFrame={...structuredClone(frame),ops:persisted};
assert.throws(()=>requireCounterAdmission(effect,script),/rebuild.*admission/);effect.counterAdmission=paidCounterAdmission(script,persisted);assert.doesNotThrow(()=>requireCounterAdmission(effect,script));cases++;
const wrongKind=structuredClone(effect);wrongKind.counterActivation!.kind="counter:play";assert.throws(()=>requireCounterActivationOrigin(wrongKind,script),/rebuild.*origin skill/);cases++;
console.log(`energy-counter-contract-5: ${cases} compiler/origin protocol cases passed`);
