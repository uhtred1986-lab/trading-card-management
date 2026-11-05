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
import { addEffect } from "../../src/lib/arena/vm/effects";
import { vmHost } from "../../src/lib/arena/vm/host";
import { type ScriptFrame } from "../../src/lib/arena/vm/script";
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
for(const player of ["p1","p2"] as const)for(const origin of ["hand","deck"] as const)for(const actingOpponent of [false,true])for(const choice of ["accept","decline","partial"] as const){
 let state=RULES.createGame(ctx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const incoming=stage(state,player,"IN",origin),first=stage(state,player,"R","drop"),second=stage(state,player,"B","drop");
 stage(state,player,"R","drop");stage(state,player,"B","drop");
 if(choice==="partial")addEffect(state,[],{target:first,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",fromArea:"drop",toArea:"warp",bySkill:true}});
 const master=actingOpponent?(player==="p1"?"p2":"p1"):player;
 let parent:ScriptFrame={card:state.sides[master].zones.leader[0],master,ops:[{op:"moveTo",target:{var:"incoming"},to:"energy",mode:"active"}],vars:{incoming:[incoming]},ip:0,moveLoop:{kind:"moveTo",ids:[incoming],index:0}};
 const destination={area:"energy" as const,player,mode:"active" as const},events:GameEvent[]=[];
 parent.energyEntry=createEnergyEntryContinuation(vmHost(ctx,game,state,events),parent,incoming,10,policy,destination);
 let questions=0;
 for(;;){
  const pending=parent.energyEntry!;
  const parentHost=vmHost(ctx,game,state,events,parent);
  requireEnergyEntryContinuation(parentHost,parent,pending,10,policy,destination);
  const status=runEnergyEntryContinuation(parentHost,vmHost(ctx,game,state,events,pending.child),parent,pending);
  if(status==="completed")break;
  assert.equal(state.programs.length,1,"only the original parent is queued");
  assert.equal(state.programs[0].card,parent.card);assert.ok("player" in state.prompt);assert.equal(state.prompt.player,player,"incoming Permanent's owner decides, not effect actor");
  assert.ok(++questions<8);
  assert.ok(!JSON.stringify(state.prompt).includes("IN:"),"private incoming name is absent from prompt reasons");
  state=copy(state);parent=state.programs.shift()!;
  if(state.prompt.kind==="chooseMode")state.lastMode=choice==="decline"?1:0;
  else if(state.prompt.kind==="chooseCards")state.lastChoice=[state.prompt.choice.candidates[0]];
  else assert.fail(`unexpected ${state.prompt.kind}`);
 }
 assert.equal(energyEntryNegationEarned(parent.energyEntry!),choice==="accept");
 assert.ok(state.sides[player].zones[origin].includes(incoming));assert.equal(parent.ip,0);assert.equal(parent.moveLoop?.index,0);
 const before=JSON.stringify({state,events,parent});assert.equal(runEnergyEntryContinuation(vmHost(ctx,game,state,events,parent),vmHost(ctx,game,state,events,parent.energyEntry!.child),parent,parent.energyEntry!),"completed");assert.equal(JSON.stringify({state,events,parent}),before,"completed child retry never repeats payment");
 const corruptions=[(f:ScriptFrame)=>{f.energyEntrySequence!++;},(f:ScriptFrame)=>{f.energyEntry!.child.master=master===player?(player==="p1"?"p2":"p1"):master;},(f:ScriptFrame)=>{f.energyEntry!.child.ops[0]={op:"draw",n:2};},(f:ScriptFrame)=>{f.moveLoop!.ids=[second];},(f:ScriptFrame)=>{f.ops[0]={op:"moveTo",target:{sel:{special:"self"}},to:"drop"};}];
 for(const corrupt of corruptions){const bad=copy(parent);corrupt(bad);assert.throws(()=>requireEnergyEntryContinuation(vmHost(ctx,game,state,events),bad,bad.energyEntry!,10,policy,destination),/rebuild/);cases++;}
 if(choice!=="decline") {
  const slot=choice==="partial"?"§energyEntrySecond":"§energyEntryFirst";
  const receiptMutations=[(f:ScriptFrame)=>{delete f.energyEntry!.child.movementResults;},(f:ScriptFrame)=>{delete (f.energyEntry!.child.movementResults![slot] as unknown as Record<string,unknown>).selected;},(f:ScriptFrame)=>{delete (f.energyEntry!.child.movementResults![slot] as unknown as Record<string,unknown>).outcomes;},(f:ScriptFrame)=>{const r=f.energyEntry!.child.movementResults![slot];r.outcomes.push(copy(r.outcomes[0]));},(f:ScriptFrame)=>{const r=f.energyEntry!.child.movementResults![slot];r.outcomes[0].from="hand";},(f:ScriptFrame)=>{const r=f.energyEntry!.child.movementResults![slot];r.outcomes[0].completed=true;r.outcomes[0].to="battle";}];
  for(const mutate of receiptMutations){const bad=copy(parent);mutate(bad);assert.throws(()=>requireEnergyEntryContinuation(vmHost(ctx,game,state,events),bad,bad.energyEntry!,10,policy,destination),/rebuild/);cases++;}
 }
 cases++;
}
for(const player of ["p1","p2"] as const)for(const afterFirst of [false,true]){
 let state=RULES.createGame(ctx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const incoming=stage(state,player,"IN","hand"),first=stage(state,player,"R","drop");stage(state,player,"R","drop");stage(state,player,"B","drop");stage(state,player,"B","drop");
 let parent:ScriptFrame={card:incoming,master:player,ops:[{op:"moveTo",target:{sel:{special:"self"}},to:"energy"}],vars:{},ip:0,moveLoop:{kind:"moveTo",ids:[incoming],index:0}};
 const destination={area:"energy" as const,player},events:GameEvent[]=[];
 parent.energyEntry=createEnergyEntryContinuation(vmHost(ctx,game,state,events),parent,incoming,10,policy,destination);
 for(let i=0;i<(afterFirst?3:2);i++){
  const p: NonNullable<ScriptFrame["energyEntry"]>=parent.energyEntry!;assert.equal(runEnergyEntryContinuation(vmHost(ctx,game,state,events,parent),vmHost(ctx,game,state,events,p.child),parent,p),"suspended");
  state=copy(state);parent=state.programs.shift()!;
  if(state.prompt.kind==="chooseMode")state.lastMode=0;
  else if(state.prompt.kind==="chooseCards")state.lastChoice=[state.prompt.choice.candidates[0]];
 }
 assert.ok(moveCard(state,game,first,"warp",{owner:player}).ok);assert.ok(moveCard(state,game,first,"drop",{owner:player}).ok);
 const before=JSON.stringify(state);
 assert.throws(()=>requireEnergyEntryContinuation(vmHost(ctx,game,state,events),parent,parent.energyEntry!,10,policy,destination),/original Drop card|no longer available/);
 assert.equal(JSON.stringify(state),before,"stale offered/selected occurrence fails before payer mutation");cases++;
}
console.log(`energy-entry-continuation-5: ${cases} original-parent continuation checks passed; placement remains unwired`);
