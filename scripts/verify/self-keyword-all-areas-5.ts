/** R478: source qualification survives records, DSL, lowering and area observation. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { recordContractGaps, rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { validateRule } from "../../src/lib/arena/lang/validate";
import { parseRule } from "../../src/lib/arena/lang/parse";
import { printRule } from "../../src/lib/arena/lang/print";
import type { Rule } from "../../src/lib/arena/lang/ast";
import { expandMacros, rulesetFor } from "../../src/lib/arena/rulesets";
import { negateAs, programProblem } from "../../src/lib/arena/vm/script-schema";
import type { Op } from "../../src/lib/arena/vm/script";
import { RULES } from "../../src/lib/arena/vm";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { hasKeyword, staticsNow } from "../../src/lib/arena/vm/program";
import type { EngineContext } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const defs={L:card("L",{type:"LEADER"}),F:card("F",{}),
 A:card("A",{skill:"[Energy-Exhaust]\n[Permanent] Negate this card's [Energy-Exhaust] skill in all areas."}),
 B:card("B",{skill:"[Energy-Exhaust]\n[Permanent] Negate this card's [Energy-Exhaust] skill."})};
const rows=Object.values(defs).flatMap(skillRecords).map((r,id)=>({...r,id,source:"compiler",status:"draft"}) as unknown as RuleRow);
const ctx:EngineContext={defs,scripts:rulesFromRows(rows,defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
let cases=0;
for(const row of rows){
 const rule={kind:row.kind,trigger:row.trigger,cost:row.cost,usage:row.usage,validity:row.validity,cond:row.cond,ops:row.ops} as Rule;
 assert.equal(validateRule(rule,row.kind),null);const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);assert.deepEqual(parsed.value,rule); cases++;
}
const qualified=rows.find(r=>r.cardId==="A"&&r.kind==="permanent")!;
const ops=qualified.ops as Op[];assert.equal((ops[0] as {allAreas?:boolean}).allAreas,true);
const expanded=expandMacros(ops,game);assert.equal(programProblem(expanded),null);assert.deepEqual(expanded.map(negateAs),ops);cases++;
for(const target of [{var:"other"},{sel:{side:"you",area:"battle"}},{sel:{special:"self",filter:{color:"Blue"}}}])assert.ok(programProblem([{op:"negateKeyword",keyword:"Energy-Exhaust",target,allAreas:true}]));
assert.ok(programProblem([{op:"negate",what:"skills",allAreas:true}]));
assert.ok(programProblem([{...ops[0],until:"turn"}]));cases+=5;
for(const status of ["draft","confirmed","corrected","open"] as const){
 const row=structuredClone(qualified); row.status=status;
 (row.ops as {allAreas?:boolean}[]).forEach(op=>delete op.allAreas);
 assert.ok(recordContractGaps(row).some(g=>g.includes("self keyword")));
 assert.ok(rulesFromRows([row],defs).A.bySkill[row.skillIndex].unsupported.length);cases++;
}
for(const player of ["p1","p2"] as const)for(const area of ["hand","deck","drop","energy","warp","life","combo","battle"])for(const kind of ["A","B"] as const){
 const state=RULES.createGame(ctx,{seed:478,p1:{name:"A",leader:"L",main:fifty("F")},p2:{name:"B",leader:"L",main:fifty("F")}}).state as VmState;
 const id=state.sides[player].zones.deck.at(-1)!;state.cards[id].cardId=kind;
 if(area!=="deck")assert.ok(moveCard(state,game,id,area,{owner:player}).ok);
 assert.equal(hasKeyword(ctx,game,state,id,"Energy-Exhaust"),kind==="B"&&area!=="battle",`${player}/${area}/${kind}`);cases++;
}
for(const player of ["p1","p2"] as const)for(const silenced of [false,true]){
 const state=RULES.createGame(ctx,{seed:478,p1:{name:"A",leader:"L",main:fifty("F")},p2:{name:"B",leader:"L",main:fifty("F")}}).state as VmState;
 const id=state.sides[player].zones.deck.at(-1)!;state.cards[id].cardId="A";
 assert.ok(moveCard(state,game,id,"energy",{owner:player}).ok);
 if(silenced) addEffect(state,[],{target:id,kind:"negateSkill",value:qualified.skillIndex,until:"turn"});
 else state.cards[id].hidden=true;
 assert.equal(staticsNow(ctx,game,state).some(e=>e.source===id&&e.kind==="negateKeyword"),false,"unavailable Permanent makes no standing negation");cases++;
}
console.log(`self-keyword-all-areas-5: ${cases} qualification checks passed`);
