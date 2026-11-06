/** R-390: official Evolve colored-orb runs followed by a bare generic number. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { skillLines } from "../../src/lib/arena/text/cards";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const PRINTS={"BT2-084": "[evolve] {g}{g}4: <Cell><br>[double strike]<br>[auto] When you play this card, if your Leader Card is an ≪Android≫, your opponent must choose cards in their hand until there are only 3 remaining, and place the chosen cards in the Drop Area.", "P-006": "[evolve] {g}{g}１: <Broly> (Play this card on top of the specified card)<br>[double strike] (This card inflicts 2 damage instead of 1 when attacking)<br>[auto]  When a card evolves into this card, choose up to 1 opponent Battle Card in the Battle Area, and KO  that card."} as const;
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const defs:Record<string,CardDef>={
 LEADER:card("LEADER",{type:"LEADER"}),GREEN:card("GREEN",{colors:["Green"]}),RED:card("RED",{colors:["Red"]}),
 BROLY:card("BROLY",{characters:["Broly"],power:10000}),CELL:card("CELL",{characters:["Cell"],power:10000}),WRONG:card("WRONG",{characters:["Vegeta"],power:10000}),
 "P-006":card("P-006",{characters:["Broly"],colors:["Green"],energyCost:4,power:15000,skill:PRINTS["P-006"]}),
 "BT2-084":card("BT2-084",{characters:["Cell"],colors:["Green"],energyCost:7,power:30000,skill:PRINTS["BT2-084"]}),
};
const records=Object.values(defs).flatMap(skillRecords);
for(const r of records.filter(r=>r.skillIndex===0)){
 assert.deepEqual(r.unread,[]);assert.equal(r.cost?.readable,true);assert.deepEqual(r.cost?.orbs,{Green:2,any:r.cardId==="P-006"?1:4});assert.deepEqual(runtimeSupportOfRow(r).unsupported,[]);
}
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,source:"compiler",status:"draft"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(ctx,copy(s),a).state as VmState;
function fresh(first:PlayerId):VmState{
 let s=RULES.createGame(ctx,{seed:390,p1:{name:"One",leader:"LEADER",main:fifty("RED")},p2:{name:"Two",leader:"LEADER",main:fifty("RED")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);return s;
}
function stage(s:VmState,p:PlayerId,def:string,zone:string):string{
 const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,zone,{owner:p}).ok);s.pending=[];return id;
}
let cases=0;
for(const owner of ["p1","p2"] as const)for(const id of ["P-006","BT2-084"] as const)for(const variant of ["exact","extra","short","one-green","wrong-base","opponent-base","hand-base","drop-source"]){
 let s=fresh(owner);const need=id==="P-006"?3:6;
 const source=stage(s,owner,id,variant==="drop-source"?"drop":"hand");
 const base=stage(s,variant==="opponent-base"?other(owner):owner,variant==="wrong-base"?"WRONG":id==="P-006"?"BROLY":"CELL",variant==="hand-base"?"hand":"battle");s.cards[base].mode="rest";
 addEffect(s,[],{target:base,kind:"power",value:5000,until:"turn",source:base,master:owner});
 const energy:string[]=[];for(let n=0;n<need+(variant==="extra"?1:variant==="short"?-1:0);n++)energy.push(stage(s,owner,n<(variant==="one-green"?1:2)?"GREEN":"RED","energy"));
 const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source&&a.skill===0);
 const yes=["exact","extra"].includes(variant);assert.equal(!!a,yes,`${owner}/${id}/${variant}: Evolve offer`);
 if(a){
  s=take(s,a);
  for(let n=0;n<40&&s.prompt.kind!=="main";n++){
   const actions=RULES.legalActions(ctx,s).map(x=>x.action);let action:Action|undefined;
   if(s.prompt.kind==="chooseCards"){const pr=s.prompt;action={type:"choose",player:pr.player,cards:pr.choice.candidates.slice(0,pr.choice.min??0)};}
   else action=actions.find(a=>a.type==="counter"&&a.card===null)??actions.find(a=>a.type==="orderPending"&&!a.decline)??actions[0];
   assert.ok(action);s=take(s,action);
  }
  assert.equal(s.prompt.kind,"main");assert.ok(s.sides[owner].zones.battle.includes(source));assert.deepEqual(s.cards[source].under,[base]);assert.equal(s.cards[source].mode,"rest");
  assert.equal(attrsNow(ctx,game,s,source).power,(id==="P-006"?15000:30000)+5000);
  assert.equal(energy.filter(e=>s.cards[e].mode==="rest").length,need);assert.ok(energy.slice(0,2).every(e=>s.cards[e].mode==="rest"));
 }
 cases++;
}
// This repairs only the missing generic orb in an Evolve cost, never a target count.
assert.equal(skillLines("[Evolve] {g}{g}１: <Broly>")[0],"[Evolve] {g}{g}{1}: <Broly>");
for(const text of ["[Activate: Main] {g}{g}4: Draw 1 card.","[EX-Evolve] {g}{g}4: <Cell>","[Evolve] 4: <Cell>","[Evolve] {g}{g}: <Cell> with an energy cost of 4", "[Evolve] {g}{g}4 cards: <Cell>"]){assert.equal(skillLines(text)[0],text);}
console.log(`Evolve orbs 5: ${cases} stored/native both-seat scenarios passed`);
