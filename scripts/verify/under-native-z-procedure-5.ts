/** R528/R398 mechanism: the existing synthetic Uub price runs natively with a dormant actual #0 source. */
import assert from "node:assert/strict";
import under from "./fixtures/under-standing-observer-5.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { vmHost } from "../../src/lib/arena/vm/host";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { issueNativeUnderRead } from "../../src/lib/arena/vm/under-native-read";
import type { Action, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const defs:EngineContext["defs"]={
 BASE:card("BASE",{type:"LEADER",colors:["Blue"],characters:["Uub"],back:{name:"Awakened Test Leader",power:15000,skill:null}}),
 F:card("F",{colors:["Blue"],skill:null}),BUU:card("BUU",{colors:["Blue"],characters:["Mr. Buu"],skill:null}),
 Z:card("Z",{type:"Z-LEADER",colors:["Blue"],characters:["Uub"],zEnergyCost:3,skill:"[Z-Awaken] {u}, you have 3 or less life and you place 1 blue <Mr. Buu> from your Drop under this card: Blue <Uub>."}),
 "BT23-070":card("BT23-070",{type:"EXTRA",name:under["BT23-070"].card.name,colors:["Blue"],energyCost:1,skill:under["BT23-070"].card.skill}),
};
const ctx:EngineContext={defs,scripts:rulesFromRows(Object.values(defs).flatMap(skillRecords).map((r,id)=>({...r,id,status:r.unread.length?"open":"confirmed",source:"compiler"}) as RuleRow),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const copy=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
const other=(p:PlayerId)=>p==="p1"?"p2":"p1";
function take(s:VmState,a:Action){const out=RULES.apply(ctx,copy(s),a);assert.equal(out.state.outcome,undefined,JSON.stringify(out.state.outcome));return out.state as VmState;}
for(const p of ["p1","p2"] as const){
 const deck=["BT23-070",...fifty("F").slice(1)];
 let s=RULES.createGame(ctx,{seed:528,p1:{name:"One",leader:"BASE",main:deck,z:["Z"]},p2:{name:"Two",leader:"BASE",main:deck,z:["Z"]}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first:p},{type:"mulligan",player:p,redraw:false},{type:"mulligan",player:other(p),redraw:false},{type:"charge",player:p,card:null}] as Action[])s=take(s,a);
 assert.ok(s.underStandingNegationHistory);
 const stage=(zone:string)=>{const id=s.sides[p].zones.deck.find(x=>s.cards[x].cardId==="F")!;assert.ok(moveCard(s,game,id,zone,{owner:p}).ok);return id;};
 const pool=Array.from({length:4},()=>stage("zEnergy"));stage("energy");s.cards[pool[3]].cardId="BUU";
 while(s.sides[p].zones.life.length>3)assert.ok(moveCard(s,game,s.sides[p].zones.life.at(-1)!,"hand",{owner:p}).ok);
 issueNativeUnderRead(ctx,game,s);vmHost(ctx,game,s,[]).flip(s.sides[p].zones.leader[0],true);
 const z=s.sides[p].zones.zDeck[0];
 s=take(s,{type:"activate",player:p,card:z,skill:0});
 for(const payer of [pool[0],pool[1],pool[3]]){assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:p,cards:[payer]});}
 assert.equal(s.sides[p].zones.leader[0],z);assert.ok(s.cards[z].under.includes(pool[3]));
 console.log(`PASS ${p} native paid synthetic Z-Awaken self-placement with actual dormant #0`);
}
