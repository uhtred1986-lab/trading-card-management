/** R476: unproven payer replacements refuse before any payer movement. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import type { Action, EngineContext, GameEvent, PlayerId, Replacement } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { hasKeyword } from "../../src/lib/arena/vm/program";
const defs={L:card("L",{type:"LEADER",skill:"[Activate: Main] Add the top card of your deck to your energy."}),F:card("F",{}),IN:card("IN",{skill:"[Energy-Exhaust]\n[Permanent] This card gets +1000 power."}),R:card("R",{colors:["Red"]}),B:card("B",{colors:["Blue"]})};
const rows=Object.values(defs).flatMap(skillRecords);
const ctx:EngineContext={defs,scripts:rulesFromRows(rows.map((row,id)=>({...row,id,status:"draft",source:"compiler"}) as unknown as RuleRow),defs)};
ctx.scripts!.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];ctx.scripts!.IN.bySkill[10].unsupported=[];
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const copy=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
function stage(state:VmState,player:PlayerId,cardId:string,area:string){const id=state.sides[player].zones.deck.at(-1)!;state.cards[id].cardId=cardId;assert.ok(moveCard(state,game,id,area,{owner:player,...(area==="deck"?{position:"top" as const}:{})}).ok);return id;}
let cases=0;
for(const player of ["p1","p2"] as const)for(const slot of ["first","second"] as const)for(const route of ["question","inline","redirect"] as const)for(const answer of ["affected","decline","unaffected"] as const){
 let state=RULES.createGame(ctx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const other:PlayerId=player==="p1"?"p2":"p1",events:GameEvent[]=[];
 const take=(action:Action)=>{const result=RULES.apply(ctx,copy(state),action);state=result.state as VmState;events.push(...result.events);};
 take({type:"chooseFirst",player:state.chooser,first:player});take({type:"mulligan",player,redraw:false});take({type:"mulligan",player:other,redraw:false});take({type:"pass",player});
 const incoming=stage(state,player,"IN","deck"),red=stage(state,player,"R","drop"),redOther=stage(state,player,"R","drop"),blue=stage(state,player,"B","drop"),blueOther=stage(state,player,"B","drop"),affected=slot==="first"?red:blue;
 const replacement:Replacement={target:{special:"self"},by:"skill",...(route==="redirect"?{to:"deck" as const}:{ops:route==="question"?[{op:"choose" as const,sel:{side:"you" as const,area:"hand" as const,count:1},as:"substitute"}]:[{op:"draw" as const,n:1}]})};
 addEffect(state,[],{target:affected,source:affected,master:player,kind:"replaceLeave",value:replacement,until:"game"});
 const before={hand:state.sides[player].zones.hand.length,drop:[...state.sides[player].zones.drop],epoch:state.cards[incoming].zoneEpoch};
 events.length=0;take({type:"activate",player,card:state.sides[player].zones.leader[0],skill:0});
 if(slot==="first"&&route==="question"&&answer==="affected") {
  for(const corrupt of [
   (child:NonNullable<VmState["programs"][number]["energyEntry"]>["child"])=>{child.awaiting="replaceMove";},
   (child:NonNullable<VmState["programs"][number]["energyEntry"]>["child"])=>{child.replacementMove={card:red,epoch:state.cards[red].zoneEpoch??0};},
   (child:NonNullable<VmState["programs"][number]["energyEntry"]>["child"])=>{child.replacing=red;},
   (child:NonNullable<VmState["programs"][number]["energyEntry"]>["child"])=>{child.replacementAuto={} as NonNullable<typeof child.replacementAuto>;},
  ]) {
   const bad=copy(state),parent=bad.programs.find(frame=>frame.energyEntry);assert.ok(parent?.energyEntry);corrupt(parent.energyEntry.child);
   const beforeBad=JSON.stringify(bad),result=RULES.apply(ctx,bad,{type:"chooseMode",player,index:0});
   assert.equal(JSON.stringify(bad),beforeBad);assert.equal(result.state.outcome?.kind,"interrupted");assert.match(result.state.outcome?.privateContext?.detail??"",/payer replacement continuation/);
   assert.equal(result.events.some(event=>event.type==="move"),false);assert.deepEqual((result.state as VmState).sides[player].zones.drop,before.drop);cases++;
  }
 }
 const seen=new Set<string>();let chooser=0;
 while(state.prompt.kind==="chooseMode"||state.prompt.kind==="chooseCards"){
  const key=JSON.stringify(state.prompt);assert.ok(!seen.has(key),"no stalled/repeated original or substitute prompt");seen.add(key);
  assert.ok(seen.size<=3);assert.equal(state.prompt.player,player);
  if(state.prompt.kind==="chooseMode")take({type:"chooseMode",player,index:answer==="decline"?1:0});
  else {const id=chooser++===0?(answer==="unaffected"?redOther:red):(answer==="unaffected"?blueOther:blue);assert.ok(state.prompt.choice.candidates.includes(id));take({type:"choose",player,cards:[id]});}
 }
 if(answer==="affected"){
  assert.equal(state.outcome?.kind,"interrupted");assert.match(state.outcome?.privateContext?.detail??"",/payer replacement/);
  assert.equal(state.prompt.kind,"gameOver");assert.equal(state.programs.length,0);
  assert.deepEqual(state.sides[player].zones.drop,before.drop,"even a second-payer substitute refuses before the first payer moves");
  assert.equal(state.sides[player].zones.warp.length,0);assert.ok(state.sides[player].zones.deck.includes(incoming));assert.equal(state.cards[incoming].zoneEpoch,before.epoch);
  assert.equal(events.some(event=>event.type==="move"&&[incoming,red,blue].includes(event.card)),false);assert.equal(state.sides[player].zones.hand.length,before.hand,"inline replacement body never executes");
 }else{
  assert.equal(state.outcome,undefined);assert.ok(state.sides[player].zones.energy.includes(incoming));assert.equal(state.cards[incoming].mode,answer==="decline"?"rest":"active");
  assert.equal(hasKeyword(ctx,game,state,incoming,"Energy-Exhaust"),answer==="decline");assert.ok(state.sides[player].zones.drop.includes(affected),"unselected replacement target is not touched");
 }
 cases++;
}
console.log(`energy-entry-payer-boundary-5: ${cases} saved native payer-route refusal/decline/unaffected controls passed`);
