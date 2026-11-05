/** R476 ordinary-effect mechanism controls; no native entry admission yet. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import type { EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript, type ScriptFrame } from "../../src/lib/arena/vm/script";
import { createEnergyEntryContinuation, requireEnergyEntryContinuation, runEnergyEntryContinuation, energyEntryNegationEarned } from "../../src/lib/arena/vm/energy-entry-continuation";

const defs = { L: card("L", { type: "LEADER" }), F: card("F", {}),
  IN: card("IN", { colors: ["Red", "Blue"], skill: "[Energy-Exhaust]" }),
  R: card("R", { colors: ["Red"] }), B: card("B", { colors: ["Blue"] }),
  RB: card("RB", { colors: ["Red", "Blue"] }) };
const rows = Object.values(defs).flatMap(skillRecords);
const ctx: EngineContext = { defs, scripts: rulesFromRows(rows.map((row, id) => ({ ...row, id, status: "draft", source: "compiler" }) as unknown as RuleRow), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
function stage(state: VmState, player: PlayerId, cardId: string, area: string): string {
  const id = area === "deck" ? state.sides[player].zones.deck[0] : state.sides[player].zones.deck.at(-1)!; state.cards[id].cardId = cardId;
  assert.ok(moveCard(state, game, id, area, { owner: player, ...(area === "deck" ? { position: "top" as const } : {}) }).ok); return id;
}

let cases=0;
const policy={version:1 as const,colors:["Red","Blue"] as ["Red","Blue"]};
for(const player of ["p1","p2"] as const)for(const origin of ["hand","deck"] as const)for(const accept of [false,true])for(const blockAfterPayer of [false,true]){
 let state=RULES.createGame(ctx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const incoming=stage(state,player,"IN",origin);
 stage(state,player,"R","drop");stage(state,player,"R","drop");stage(state,player,"B","drop");stage(state,player,"B","drop");
 let parent:ScriptFrame={card:state.sides[player].zones.leader[0],master:player,ops:[{op:"moveTo",target:{var:"incoming"},to:"energy"}],vars:{incoming:[incoming]},ip:0};
 const events:GameEvent[]=[],order:string[]=[];
 let attempts=0,questions=0;
 for(;;){
  const base=vmHost(ctx,game,state,events,parent);
  const host={...base,
   forbids:(...args:Parameters<typeof base.forbids>)=>args[0]==="energyCap"&&blockAfterPayer&&state.sides[player].zones.warp.length>0 || base.forbids(...args),
   guardEnergyEntryFrame:()=>{order.push("frame");},
   guardEnergyEntryBatch:()=>{order.push("batch");},
   prepareEnergyEntry:(frame:ScriptFrame,id:string,destination:{player:PlayerId;area:"energy";mode?:"active"|"rest"}):"ready"|"wait"|"recheck"=>{
    assert.equal(state.sides[player].zones[origin].includes(incoming),true);
    frame.energyEntry??=createEnergyEntryContinuation(base,frame,id,10,policy,destination);
    const pending=frame.energyEntry;
    requireEnergyEntryContinuation(base,frame,pending,10,policy,destination);
    const completedBefore=pending.completed;
    if(runEnergyEntryContinuation(base,vmHost(ctx,game,state,events,pending.child),frame,pending)==="suspended")return "wait";
    assert.equal(energyEntryNegationEarned(pending),accept);
    order.push("ready");return completedBefore?"ready":"recheck";
   },
   move:(...args:Parameters<typeof base.move>)=>{
    assert.equal(parent.energyEntry?.completed,true,"child is completed before native mode capture/move");
    assert.equal(state.sides[player].zones.warp.length,accept?2:0,"payer effects finish before the original movement");
    order.push("move");attempts++;return base.move(...args);
   },
  };
  const result=stepScript(host,parent);
  if(result==="done")break;
  assert.equal(attempts,0);assert.equal(parent.ip,0);assert.equal(parent.moveLoop?.index,0);
  assert.equal(state.programs.length,1);assert.ok(++questions<5);
  state=copy(state);parent=state.programs.shift()!;
  if(state.prompt.kind==="chooseMode")state.lastMode=accept?0:1;
  else if(state.prompt.kind==="chooseCards")state.lastChoice=[state.prompt.choice.candidates[0]];
  else assert.fail(`unexpected ${state.prompt.kind}`);
 }
 const blocked=accept&&blockAfterPayer;
 assert.equal(attempts,blocked?0:1);assert.equal(parent.ip,1);assert.equal(parent.energyEntry,undefined);
 if(!blocked)assert.deepEqual(order.slice(-2),["ready","move"]);
 assert.equal(state.sides[player].zones.energy.includes(incoming),!blocked);
 assert.equal(state.sides[player].zones.warp.length,accept?2:0,"a new cap does not abandon an already started child");
 // This seam-only wrapper deliberately does not install negation. Native
 // mode still sees Energy-Exhaust; earning it is not implementing it.
 if(!blocked)assert.equal(state.cards[incoming].mode,"rest");
 assert.equal(stepScript(vmHost(ctx,game,state,events),parent),"done");assert.equal(attempts,blocked?0:1);
 cases++;
}
for(const player of ["p1","p2"] as const){
 const state=RULES.createGame(ctx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const ordinary=stage(state,player,"F","hand"),incoming=stage(state,player,"IN","hand");
 const frame:ScriptFrame={card:ordinary,master:player,ops:[{op:"moveTo",target:{var:"batch"},to:"energy",random:true,completedAs:"result"}],vars:{batch:[ordinary,incoming]},ip:0};
 const before=JSON.stringify({state,frame});
 assert.throws(()=>stepScript({...vmHost(ctx,game,state,[]),guardEnergyEntryBatch:(_frame,ids)=>{assert.deepEqual(ids,[ordinary,incoming]);throw new Error("unsupported entire batch");}},frame),/unsupported entire batch/);
 assert.equal(JSON.stringify({state,frame}),before,"batch guard precedes RNG, receipts and first ordinary movement");cases++;
}
console.log(`energy-entry-script-5: ${cases} isolated native-host wrapper ordering checks passed; native optional admission remains unwired`);
