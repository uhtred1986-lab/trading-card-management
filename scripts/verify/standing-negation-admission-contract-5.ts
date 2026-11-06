/** R509 isolated negative source contracts; no synthetic successful gameplay. */
import assert from "node:assert/strict";
import fixture from "./fixtures/standing-negation-admission-5.json";
import { card, fifty } from "./harness";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { newCard } from "../../src/lib/arena/vm/zones";
import { validateStandingNegationRead } from "../../src/lib/arena/vm/standing-negation-runtime";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Script } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const row={...fixture["DB1-066"].records["DB1-066#0"],id:1,status:"confirmed",source:"compiler"} as unknown as RuleRow;
const defs={"DB1-066":card("DB1-066",{skill:row.printed}),L:card("L",{type:"LEADER",skill:null}),F:card("F",{skill:null})};
const scripts=rulesFromRows([row],defs),setup={seed:509,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}};
const nativeChanges:((s:Script)=>void)[]=[
 s=>{s.price!.payment.orbs.any=0;},
 s=>{s.price!.ops=[{op:"draw",n:1}];},
 s=>{s.price!.condition={kind:"isTurnPlayer",who:"you"};},
 s=>{s.usage={version:1,oncePerTurn:true,limit:null};},
 s=>{s.usage={version:1,oncePerTurn:false,limit:1};},
 s=>{s.trigger=["played"];},
 s=>{s.validity={version:1,sparking:1};},
 s=>{s.price!.payment.marker=0;},
];
let count=0;
for(const p of ["p1","p2"] as PlayerId[])for(const change of nativeChanges){
 const altered=copy(scripts);change(altered["DB1-066"].bySkill[0]);const ctx:EngineContext={defs,scripts:altered};
 const s=RULES.createGame(ctx,setup).state as VmState;
 assert.equal(s.standingNegationHistory,undefined,"invalid native source must not initialize history");
 s.cards.source=newCard("source","DB1-066",p);s.sides[p].zones.battle.push("source");const before=JSON.stringify(s);
 assert.throws(()=>validateStandingNegationRead(ctx,s),/standing-negation|whole-negation/);
 assert.equal(JSON.stringify(s),before,"read refuses without repairing history");count++;
}
for(const printed of ["[Permanent][Once per turn] Negate the skills of all other Battle Cards.","[Permanent][Limit 1] Negate the skills of all other Battle Cards.","[Permanent][Sparking 1] Negate the skills of all other Battle Cards.","[Permanent][Bond 1] Negate the skills of all other Battle Cards.","[Permanent] {0}: Negate the skills of all other Battle Cards."]){
 for(const status of ["open","draft","confirmed","corrected"] as const){const altered={...copy(row),printed,status};const localDefs={...defs,"DB1-066":card("DB1-066",{skill:printed})};assert.ok(runtimeSupportOfRow(altered).unsupported.length);const localScripts=rulesFromRows([altered],localDefs);assert.ok(localScripts["DB1-066"].bySkill[0].unsupported.length);const s=RULES.createGame({defs:localDefs,scripts:localScripts},setup).state as VmState;assert.equal(s.standingNegationHistory,undefined);count++;}
}
// These edited/native source definitions are outside the Battle-source policy.
for(const [type,zone] of [["LEADER","leader"],["Z-LEADER","leader"],["UNISON","unison"],["EXTRA","battle"]] as const){
 const sourceDef=card("OTHER",{type,skill:(type==="EXTRA"?"[Field]\n":"")+row.printed});
 const index=type==="EXTRA"?10:0;
 const c:EngineContext={defs:{...defs,OTHER:sourceDef},scripts:{...scripts,OTHER:{bySkill:{[index]:copy(scripts["DB1-066"].bySkill[0])},complete:true,unsupported:[]}}};
 const state=RULES.createGame({defs,scripts},setup).state as VmState;state.cards.source=newCard("source","OTHER","p1");state.sides.p1.zones[zone].push("source");const before=JSON.stringify(state);
 assert.throws(()=>validateStandingNegationRead(c,state),/non-Battle source/);assert.equal(JSON.stringify(state),before);count++;
 for(const inactive of ["hand","energy","combo"]){state.sides.p1.zones[zone]=state.sides.p1.zones[zone].filter(id=>id!=="source");state.sides.p1.zones[inactive].push("source");validateStandingNegationRead(c,state);state.sides.p1.zones[inactive]=state.sides.p1.zones[inactive].filter(id=>id!=="source");count++;}
 // An ordinary buried copy is not an active source of this policy.
 state.cards.host=newCard("host","F","p1");state.cards.host.under.push("source");state.sides.p1.zones.battle.push("host");validateStandingNegationRead(c,state);count++;
}
console.log(`standing-negation-admission-contract-5: ${count} isolated native/record rejection cases PASS`);
