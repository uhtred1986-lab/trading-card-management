import { priceFromCostRecord } from "../../src/lib/arena/vm/skill-payment";
import type { CostRecord } from "../../src/lib/arena/vm/script";
/** R488: shared script placement cleanup and isolated Energy projection. */
import assert from "node:assert/strict";
import fixtures from "./fixtures/standing-negation-observation-5.json";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import type { EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Script } from "../../src/lib/arena/vm/script";
import { newCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
import { projectEnergyEntryCleanup } from "../../src/lib/arena/vm/energy-entry-runtime";
import { assertStandingNegationSettled } from "../../src/lib/arena/vm/standing-negation-transaction";
import { forbids, attrsNow } from "../../src/lib/arena/vm/program";
const defs={L:card("L",{type:"LEADER"}),F:card("F",{}),"DB1-066":card("DB1-066",{skill:fixtures["DB1-066"].skill})};
const ctx:EngineContext={defs,scripts:rulesFromRows(Object.values(defs).flatMap(skillRecords).map((r,id)=>({...r,id,status:"draft",source:"compiler"}) as unknown as RuleRow),defs)};
const row=fixtures["DB1-066"].records[0];ctx.scripts!["DB1-066"].bySkill[0]={kind:row.kind,ops:row.ops,unsupported:row.unread,validity:row.validity,usage:row.usage,trigger:row.trigger,price:priceFromCostRecord(row.cost as CostRecord)} as Script;
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
function setup(p:PlayerId,standing=false,c:EngineContext=ctx){
 const state=RULES.createGame(c,{seed:488,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 // Stage raw fixture cards before constructing the validated native host.
 const staged=[["source",c.defs.AUTO?"AUTO":"F"],["other",standing?"DB1-066":"F"],["unrelated","F"]];
 for(const [id,def] of staged){state.cards[id]=newCard(id,def,p);state.sides[p].zones.hand.push(id);}
 const events:GameEvent[]=[],h=vmHost(c,game,state,events);
 for(const [id] of staged)h.move(id,"battle",p);
 h.addEffect({target:"source",kind:"power",value:7000,until:"game"});
 h.addEffect({target:"other",source:"source",master:p,kind:standing?"negateSkills":"power",value:standing?0:3000,until:"whileSourceInPlay"});
 h.addEffect({target:"unrelated",source:"source",master:p,kind:"power",value:2000,until:"game"});
 h.addEffect({target:"unrelated",source:"other",master:p,kind:"power",value:4000,until:"whileSourceInPlay"});
 state.publicAutoReveals=[{card:"source",skillIndex:0,epoch:1,trigger:"played",sourceZoneEpoch:1},{card:"unrelated",skillIndex:0,epoch:1,trigger:"played",sourceZoneEpoch:1}];
 events.length=0;return {state,events};
}
let cases=0;
for(const p of ["p1","p2"] as const)for(const mode of ["active","rest"] as const)for(const standing of [false,true]){
 const b=setup(p,standing),before=JSON.stringify(b),pending=copy(b.state.pending),serial=b.state.standingNegationHistory?.nextSerial;
 const projected=projectEnergyEntryCleanup(ctx,game,b.state,"source",p,mode);
 assert.equal(JSON.stringify(b),before,"projection leaves original state/events untouched");assert.deepEqual(projected.pending,pending,"projection never pends movement Autos");assert.equal(projected.cards.source.mode,mode);
 assert.equal(projected.effects.some(e=>e.target==="source"),false,"old target effects end");assert.equal(projected.effects.some(e=>e.target==="other"&&e.source==="source"),false,"Battle source duration on another card ends");
 assert.equal(projected.effects.filter(e=>e.target==="unrelated").length,2,"unrelated game-duration and other-source effects survive");assert.deepEqual(projected.publicAutoReveals?.map(r=>r.card),["unrelated"]);
 if(standing){assertStandingNegationSettled(ctx,projected);assert.ok(projected.standingNegationHistory!.nextSerial>serial!);assert.ok(projected.standingNegationHistory!.active.some(r=>r.source.card==="other"),"source departure reactivates the other standing negator");}
 const actual=copy(b.state),events:GameEvent[]=[];vmHost(ctx,game,actual,events).move("source","energy",p,{requestedMode:mode});
 assert.deepEqual(projected,actual,"same complete board after actual pre-stamp cleanup and settlement");assert.deepEqual(events.filter(e=>e.type==="effectEnded").map(e=>e.effect.target),["source","other"]);assert.equal(events.filter(e=>e.type==="move"&&e.card==="source").length,1);cases++;
}
// Protection changes because a Battle source departs must be visible in the clone.
for(const p of ["p1","p2"] as const)for(const mode of ["active","rest"] as const){
 const b=setup(p),h=vmHost(ctx,game,b.state,b.events),actor={card:"other",player:p,source:"source"};
 h.addEffect({target:"other",source:"source",master:p,kind:"forbid",value:0,until:"whileSourceInPlay",forbid:{what:"beNegated"}});
 assert.equal(forbids(ctx,game,b.state,"beNegated",actor),true);const before=JSON.stringify(b),projected=projectEnergyEntryCleanup(ctx,game,b.state,"source",p,mode);
 assert.equal(forbids(ctx,game,projected,"beNegated",actor),false);assert.equal(JSON.stringify(b),before);assert.equal(attrsNow(ctx,game,projected,"unrelated").power,ctx.defs.F.power!+6000);cases++;
}
// Existing host carry and placement bookkeeping are preserved by extraction.
for(const p of ["p1","p2"] as const){
 const b=setup(p),h=vmHost(ctx,game,b.state,b.events);delete b.state.cards.source.placedThisTurn;h.move("source","combo",p);
 assert.ok(b.state.effects.some(e=>e.target==="source"),"Battle-to-Combo carries target effects");assert.equal(b.state.effects.some(e=>e.target==="other"&&e.source==="source"),false,"existing script mover ends Battle-only source duration even on carried departure");
 h.move("source","battle",p);assert.equal(b.state.cards.source.placedThisTurn,true);assert.ok(b.state.effects.some(e=>e.target==="source"));
 delete b.state.cards.source.placedThisTurn;h.move("source","battle",p);assert.equal(b.state.cards.source.placedThisTurn,undefined,"same-area move does not invent arrival");cases++;
}
// Projection must not announce the actual source's arrival Auto.
for(const p of ["p1","p2"] as const)for(const mode of ["active","rest"] as const){
 const c=copy(ctx);c.defs.AUTO=card("AUTO",{skill:"[Auto] When this card is placed in your energy, draw 1 card."});
 c.scripts!.AUTO=rulesFromRows(skillRecords(c.defs.AUTO).map((r,id)=>({...r,id,status:"draft",source:"compiler"}) as unknown as RuleRow),c.defs).AUTO;
 const b=setup(p,false,c),before=JSON.stringify(b),projected=projectEnergyEntryCleanup(c,game,b.state,"source",p,mode);assert.equal(JSON.stringify(b),before);assert.deepEqual(projected.pending,b.state.pending);
 const actual=copy(b.state),events:GameEvent[]=[];vmHost(c,game,actual,events).move("source","energy",p,{requestedMode:mode});assert.ok(actual.pending.some(item=>item.card==="source"),"only actual arrival announces its Auto");assert.equal(projected.pending.some(item=>item.card==="source"),false);cases++;
}
// Unqualified existing stack movement still clears revealed released materials.
// This is host compatibility only; optional stacked sources remain unadmitted.
for(const p of ["p1","p2"] as const){
 const b=setup(p);b.state.cards.material=newCard("material","F",p);b.state.cards.source.under.push("material");b.state.publicAutoReveals!.push({card:"material",skillIndex:0,epoch:0,trigger:"played",sourceZoneEpoch:0});
 vmHost(ctx,game,b.state,b.events).move("source","energy",p);assert.ok(b.state.sides[p].zones.drop.includes("material"));assert.deepEqual(b.state.publicAutoReveals?.map(r=>r.card),["unrelated"]);assert.equal(b.events.filter(e=>e.type==="move"&&e.card==="source").length,1);cases++;
}
console.log(`script-placement-cleanup-5: ${cases} native cleanup/projection controls passed`);
