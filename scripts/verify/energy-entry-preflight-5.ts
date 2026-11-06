/** R476 ordinary-effect mechanism controls; no native entry admission yet. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript, type ScriptFrame, type Op } from "../../src/lib/arena/vm/script";
import { energyEntrySource } from "../../src/lib/arena/vm/energy-entry-source";
import { guardCostEnergyEntry, guardEnergyEntryBatch } from "../../src/lib/arena/vm/energy-entry-preflight";
import { parseRule } from "../../src/lib/arena/lang/parse";
import { printRule } from "../../src/lib/arena/lang/print";
import { validateRule } from "../../src/lib/arena/lang/validate";
import type { Rule } from "../../src/lib/arena/lang/ast";
import { emptyFilter } from "../../src/lib/arena/text/filters";
import { programProblem } from "../../src/lib/arena/vm/script-schema";

const defs = { L: card("L", { type: "LEADER" }), F: card("F", {}),
  IN: card("IN", { colors: ["Red", "Blue"], skill: "[Energy-Exhaust]\n[Permanent] This card gets +1000 power." }),
  R: card("R", { colors: ["Red"] }), B: card("B", { colors: ["Blue"] }),
  RB: card("RB", { colors: ["Red", "Blue"] }) };
const rows = Object.values(defs).flatMap(skillRecords);
const ctx: EngineContext = { defs, scripts: rulesFromRows(rows.map((row, id) => ({ ...row, id, status: "draft", source: "compiler" }) as unknown as RuleRow), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;

function stage(state: VmState, player: PlayerId, cardId: string, area: string): string {
  const id = area === "deck" ? state.sides[player].zones.deck[0] : state.sides[player].zones.deck.at(-1)!; state.cards[id].cardId = cardId;
  assert.ok(moveCard(state, game, id, area, { owner: player, ...(area === "deck" ? { position: "top" as const } : {}) }).ok); return id;
}

// Synthetic stored program proof only; the actual six-card compiler remains unwired.
ctx.scripts!.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];
ctx.scripts!.IN.bySkill[10].unsupported=[];
assert.equal(programProblem(ctx.scripts!.IN.bySkill[10].ops),null);
let cases=0;
const descriptorRule:Rule={kind:"permanent",trigger:[],cost:null,cond:null,ops:ctx.scripts!.IN.bySkill[10].ops};
assert.equal(validateRule(descriptorRule,"permanent"),null);
const roundtrip=parseRule(printRule(descriptorRule));assert.ok(roundtrip.ok);assert.deepEqual(roundtrip.value,descriptorRule);cases++;
const unadmitted=rulesFromRows([{...rows.find(row=>row.cardId==="IN"&&row.kind==="permanent")!,id:10000,status:"confirmed",source:"compiler",ops:descriptorRule.ops}] as unknown as RuleRow[],defs);
assert.ok(unadmitted.IN.bySkill[10].unsupported.length,"dedicated descriptor is not native admission");cases++;

for(const player of ["p1","p2"] as const)for(const origin of ["hand","deck","drop","battle"]){
 const state=RULES.createGame(ctx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const incoming=stage(state,player,"IN",origin),ordinary=stage(state,player,"F","hand"),host=vmHost(ctx,game,state,[]);
 const parent:ScriptFrame={card:state.sides[player].zones.leader[0],master:player,ops:[{op:"moveTo",target:{var:"incoming"},to:"energy"}],vars:{incoming:[incoming]},ip:0};
 assert.deepEqual(energyEntrySource(ctx,state,incoming),{skillIndex:10,policy:{version:1,colors:["Red","Blue"]}});cases++;
 const before=JSON.stringify(state);
 guardCostEnergyEntry(ctx,state,{...host,resolveSelector:()=>{throw new Error("unrelated selector evaluated");}}, {...parent,ops:[{op:"choose",sel:{area:"hand"},as:"other"}]});cases++;

 if(origin==="hand"||origin==="deck"||origin==="drop")guardEnergyEntryBatch(ctx,state,host,parent,[incoming]);else assert.throws(()=>guardEnergyEntryBatch(ctx,state,host,parent,[incoming]),/origin/);cases++;
 assert.throws(()=>guardEnergyEntryBatch(ctx,state,host,parent,[ordinary,incoming]),/ordering/);cases++;
 assert.throws(()=>guardCostEnergyEntry(ctx,state,host,{...parent,ops:[{op:"moveTo",target:{var:"other"},to:"drop"},...parent.ops],vars:{...parent.vars,other:[ordinary]}}),/payment or proof/);cases++;
 guardCostEnergyEntry(ctx,state,host,{...parent,ops:[{op:"moveTo",target:{var:"other"},to:"drop"}]});cases++;
 for(const ops of [
  [{op:"moveTo",target:{var:"ordinary"},to:"energy"}],
  [{op:"moveTo",target:{var:"ordinary"},to:"drop"},{op:"moveTo",target:{var:"ordinary"},to:"energy"}],
  [{op:"moveTo",target:{sel:{special:"self"}},to:"energy"}],
  [{op:"choose",sel:{side:"you",area:"hand",filter:{...emptyFilter(),names:["F"]}},as:"payer"},{op:"moveTo",target:{var:"payer"},to:"energy"}],
 ] as Op[][]){guardCostEnergyEntry(ctx,state,host,{...parent,ops,vars:{ordinary:[ordinary]}});cases++;}
 assert.throws(()=>guardCostEnergyEntry(ctx,state,host,{...parent,ops:[{op:"moveTo",target:{var:"ordinary"},to:"drop"},{op:"choose",sel:{side:"you",area:"drop"},as:"later"},{op:"moveTo",target:{var:"later"},to:"energy"}],vars:{ordinary:[ordinary]}}),/payment or proof/);cases++;
 for(const prefix of [
  {op:"draw",n:1},
  {op:"look",n:1,as:"ordinary"},
 ] as Op[]) {
  assert.throws(()=>guardCostEnergyEntry(ctx,state,host,{...parent,ops:[prefix,{op:"choose",sel:{side:"you",area:"hand"},as:"later"},{op:"moveTo",target:{var:"later"},to:"energy"}],vars:{ordinary:[ordinary]}}),/payment or proof/);cases++;
 }
 assert.throws(()=>guardCostEnergyEntry(ctx,state,host,{...parent,ops:[{op:"look",n:1,as:"ordinary"},{op:"moveTo",target:{var:"ordinary"},to:"energy"}],vars:{ordinary:[ordinary]}}),/payment or proof/);cases++;
 for(const prefix of [
  {op:"copySkills",target:{var:"ordinary"},from:{var:"incoming"},until:"turn"},
  {op:"invokeSkill",trait:"Desire",skillKind:"activate:main",from:"hand",maxCost:"currentEnergy"},
 ] as Op[]){
  assert.throws(()=>guardCostEnergyEntry(ctx,state,host,{...parent,ops:[prefix,{op:"moveTo",target:{var:"ordinary"},to:"energy"}],vars:{ordinary:[ordinary],incoming:[incoming]}}),/payment or proof/);cases++;
 }
 assert.equal(JSON.stringify(state),before,"all preflight checks are read-only");
 addEffect(state,[],{target:incoming,kind:"negateSkill",value:10,until:"turn"});assert.equal(energyEntrySource(ctx,state,incoming),undefined);cases++;
 assert.throws(()=>guardCostEnergyEntry(ctx,state,host,parent),/payment or proof/,"a presently suppressed stored descriptor remains possible after preceding mutations");cases++;
}
for(const colors of [["Red"],["Red","Red"],["Black","Blue"],["Red","Blue","Green"]]){assert.ok(programProblem([{op:"energyEntryExhaust",colors}]));cases++;}
for(const wrapper of [
 (op:Op):Op=>({op:"if",cond:{kind:"life",side:"you",atLeast:0},then:[op]}),
 (op:Op):Op=>({op:"may",ops:[op]}),
 (op:Op):Op=>({op:"chooseMode",modes:[{label:"Entry",ops:[op]}]}),
]) {
 const state=RULES.createGame(ctx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const id=stage(state,"p1","IN","hand"), original=ctx.scripts!.IN.bySkill[10].ops;
 ctx.scripts!.IN.bySkill[10].ops=[wrapper(original[0])];
 assert.throws(()=>energyEntrySource(ctx,state,id),/descriptor or qualification/);cases++;
 ctx.scripts!.IN.bySkill[10].ops=original;
}
for(const copied of [false,true]){
 const state=RULES.createGame(ctx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const ordinary=stage(state,"p1","F","hand"),host=vmHost(ctx,game,state,[]);
 assert.equal(Object.values(state.cards).some(card=>card.cardId==="IN"),false,"optional definition has no physical source");
 const frame:ScriptFrame={card:ordinary,master:"p1",ops:[{op:"copySkills",target:{var:"ordinary"},from:{var:"absent"},which:"all",until:"turn"},{op:"moveTo",target:{var:"ordinary"},to:"energy"}],vars:{ordinary:[ordinary],absent:["not-a-live-card"]},ip:0};
 if(copied){
  addEffect(state,[],{target:ordinary,kind:"copiedSkills",value:0,until:"turn",copied:{cardId:"IN",side:"front",skills:[10],from:"not-a-live-card",name:"IN"}});
  assert.throws(()=>guardCostEnergyEntry(ctx,state,host,frame),/payment or proof/,"persisted copied descriptor checks its catalog source without a live source");
 }else{
  guardCostEnergyEntry(ctx,state,host,frame);
  assert.equal(stepScript(host,frame),"done");
  assert.equal(state.effects.some(effect=>effect.kind==="copiedSkills"),false,"copySkills cannot introduce a definition-only source");
  assert.ok(state.sides.p1.zones.energy.includes(ordinary));
 }
 cases++;
}
console.log(`energy-entry-preflight-5: ${cases} synthetic stored-descriptor guards passed; synthetic mechanism fixtures`);
