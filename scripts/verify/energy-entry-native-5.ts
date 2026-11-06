/** R476 synthetic mechanism controls; R507/R508 separately prove printed source admission. */
import assert from "node:assert/strict";
import standingFixtures from "./fixtures/standing-negation-observation-5.json";
import { resolvePlay } from "../../src/lib/arena/vm/play";
import { validateStandingNegationRead } from "../../src/lib/arena/vm/standing-negation-runtime";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import type { Action, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript, type ScriptFrame } from "../../src/lib/arena/vm/script";
import { automaticPriceHost } from "../../src/lib/arena/vm/auto-costs";
import { hasKeyword } from "../../src/lib/arena/vm/program";
import { NotYet } from "../../src/lib/arena/vm/errors";
import { moved } from "../../src/lib/arena/vm/flow";

const defs = { L: card("L", { type: "LEADER" }), F: card("F", {}),
  IN: card("IN", { colors: ["Red", "Blue"], skill: "[Energy-Exhaust]\n[Permanent] This card gets +1000 power." }),
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

ctx.scripts!.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];
ctx.scripts!.IN.bySkill[10].unsupported=[];
let cases=0;
for(const player of ["p1","p2"] as const)for(const origin of ["hand","deck"] as const)for(const choice of ["accept","decline","partial","protected","explicitRest"] as const){
 let state=RULES.createGame(ctx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const incoming=stage(state,player,"IN",origin),first=stage(state,player,"R","drop");stage(state,player,"R","drop");stage(state,player,"B","drop");stage(state,player,"B","drop");
 if(choice==="partial")addEffect(state,[],{target:first,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",fromArea:"drop",toArea:"warp",bySkill:true}});
 if(choice==="protected")addEffect(state,[],{target:"",kind:"forbid",value:0,until:"game",forbid:{what:"beNegated",fromArea:"any"}});
 const master=player==="p1"?"p2":"p1";
 let parent:ScriptFrame={card:state.sides[master].zones.leader[0],master,ops:[{op:"moveTo",target:{var:"incoming"},to:"energy",...(choice==="explicitRest"?{mode:"rest" as const}:{})}],vars:{incoming:[incoming]},ip:0};
 const originalEpoch=state.cards[incoming].zoneEpoch??0,events:GameEvent[]=[];
 let questions=0;
 for(;;){
  const native=vmHost(ctx,game,state,events,parent);
  const result=stepScript({...native,move:(id,to,owner,opts)=>native.move(id,to,owner,{...opts,onResult:result=>{
   opts?.onResult?.(result);
   if(id===incoming){
    assert.equal(result.to,"energy");assert.equal(result.toEpoch,originalEpoch+1);
    assert.equal(state.cards[incoming].mode,choice==="accept"?"active":"rest");
    assert.equal(hasKeyword(ctx,game,state,incoming,"Energy-Exhaust"),!(choice==="accept"||choice==="explicitRest"));
    assert.equal(events.some(event=>event.type==="move"&&event.card===incoming&&event.to==="energy"),false,"final occurrence is settled before arrival is exposed");
   }
  }})},parent);
  if(result==="done")break;
  assert.equal(state.sides[player].zones[origin].includes(incoming),true);
  assert.equal(state.programs.length,1);assert.ok(++questions<6);
  assert.ok("player" in state.prompt);assert.equal(state.prompt.player,player);
  assert.ok(!JSON.stringify(state.prompt).includes("IN:"));
  state=copy(state);parent=state.programs.shift()!;
  if(state.prompt.kind==="chooseMode")state.lastMode=choice==="decline"?1:0;
  else if(state.prompt.kind==="chooseCards")state.lastChoice=[state.prompt.choice.candidates[0]];
  else assert.fail(`unexpected ${state.prompt.kind}`);
 }
 const negated=choice==="accept"||choice==="explicitRest";
 assert.ok(state.sides[player].zones.energy.includes(incoming));
 assert.equal(state.cards[incoming].zoneEpoch,originalEpoch+1);
 assert.equal(state.cards[incoming].mode,choice==="accept"?"active":"rest");
 assert.equal(hasKeyword(ctx,game,state,incoming,"Energy-Exhaust"),!negated);
 const effect=state.effects.find(effect=>effect.target===incoming&&effect.kind==="negateKeyword");
 assert.equal(!!effect,negated);if(effect){assert.equal(effect.source,incoming);assert.equal(effect.master,player);}
 assert.equal(events.filter(event=>event.type==="move"&&event.card===incoming&&event.to==="energy").length,1);
 assert.equal(parent.energyEntry,undefined);cases++;
 if(choice==="accept"){
  RULES.boardView(ctx,copy(state),player,{});RULES.legalActions(ctx,copy(state));
  assert.equal(JSON.stringify({state,parent}).includes("energyEntryCleanup"),false,"cleanup ownership is only a synchronous call option");
  const malformedStamps=[
   (saved:VmState)=>{saved.effects.find(effect=>effect.energyEntryEpoch!==undefined)!.energyEntryEpoch!++;},
   (saved:VmState)=>{saved.effects.find(effect=>effect.energyEntryEpoch!==undefined)!.source="wrong-source";},
   (saved:VmState)=>{saved.effects.find(effect=>effect.energyEntryEpoch!==undefined)!.target=saved.sides[player].zones.leader[0];},
   (saved:VmState)=>{saved.effects.find(effect=>effect.energyEntryEpoch!==undefined)!.kind="power";},
   (saved:VmState)=>{saved.effects.find(effect=>effect.energyEntryEpoch!==undefined)!.value="Blocker";},
   (saved:VmState)=>{saved.effects.find(effect=>effect.energyEntryEpoch!==undefined)!.until="turn";},
   (saved:VmState)=>{saved.effects.find(effect=>effect.energyEntryEpoch!==undefined)!.master=player==="p1"?"p2":"p1";},
   (saved:VmState)=>{saved.sides[player].zones.energy=saved.sides[player].zones.energy.filter(id=>id!==incoming);saved.sides[player].zones.hand.push(incoming);},
  ];
  for(const corrupt of malformedStamps){
   const saved=copy(state);corrupt(saved);const before=JSON.stringify(saved);
   for(const read of [()=>hasKeyword(ctx,game,saved,incoming,"Energy-Exhaust"),()=>RULES.boardView(ctx,saved,player,{}),()=>RULES.legalActions(ctx,saved)])assert.throws(read,error=>error instanceof NotYet);
   assert.equal(JSON.stringify(saved),before,"saved stamp refusal never repairs state");cases++;
  }
  for(const mutate of [
   ()=>moveCard(state,game,incoming,"drop"),
   ()=>moveCard(state,game,incoming,"drop",{under:state.sides[player].zones.leader[0]}),
   ()=>moveCard(state,game,state.sides[player].zones.leader[0],"battle",{onto:incoming}),
   ()=>vmHost(ctx,game,state,events).placeUnder(incoming,state.sides[player].zones.leader[0]),
   ()=>vmHost(ctx,game,state,events).placeOnTop(incoming,state.sides[player].zones.leader[0]),
   ()=>vmHost(ctx,game,state,events).setHidden(incoming,true),
   ()=>vmHost(ctx,game,state,events).flip(incoming,true),
  ]){
   const before=JSON.stringify({state,events});assert.throws(mutate,/procedure for an optional Energy negation occurrence/);assert.equal(JSON.stringify({state,events}),before);cases++;
  }

  const unrelated=vmHost(ctx,game,state,events).addEffect({target:incoming,kind:"power",value:1000,until:"game"})!;
  const oldKeyword=vmHost(ctx,game,state,events).addEffect({target:incoming,kind:"negateKeyword",value:"Blocker",until:"game"})!;
  if(origin==="hand"){
   const projected=copy(state),departureEvents:GameEvent[]=[];
   vmHost(ctx,game,projected,departureEvents).move(incoming,"drop",player);
   assert.ok(projected.sides[player].zones.drop.includes(incoming));assert.equal(projected.effects.some(effect=>effect.energyEntryEpoch!==undefined),false);
   assert.equal(hasKeyword(ctx,game,projected,incoming,"Energy-Exhaust"),true);cases++;
  }
  moved(ctx,game,state,events,incoming,"drop",{owner:player});
  assert.equal(state.effects.some(effect=>effect.target===incoming&&effect.energyEntryEpoch!==undefined),false);
  assert.equal(state.effects.some(effect=>effect.id===unrelated.id||effect.id===oldKeyword.id),false,"R505 Energy-to-Drop reset ends both old target effects");
  for(const effect of [unrelated,oldKeyword])assert.ok(events.some(event=>event.type==="effectEnded"&&event.effect.id===effect.id));
  assert.equal(hasKeyword(ctx,game,state,incoming,"Energy-Exhaust"),true);
  moved(ctx,game,state,events,incoming,"hand",{owner:player});
  let again:ScriptFrame={card:state.sides[player].zones.leader[0],master:player,ops:[{op:"moveTo",target:{var:"incoming"},to:"energy"}],vars:{incoming:[incoming]},ip:0};
  assert.equal(stepScript(vmHost(ctx,game,state,events,again),again),"wait");
  state=copy(state);again=state.programs.shift()!;state.lastMode=1;
  assert.equal(stepScript(vmHost(ctx,game,state,events,again),again),"done");
  assert.equal(state.cards[incoming].mode,"rest");assert.equal(hasKeyword(ctx,game,state,incoming,"Energy-Exhaust"),true);cases++;
 }
}
for(const route of ["host","flow","charge"] as const){
 let state=RULES.createGame(ctx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 if(route==="charge"){
  for(const action of [{type:"chooseFirst",player:state.chooser,first:"p1"},{type:"mulligan",player:"p1",redraw:false},{type:"mulligan",player:"p2",redraw:false}] as Action[])state=RULES.apply(ctx,copy(state),action).state as VmState;
  assert.equal(String(state.prompt.kind),"charge");
 }
 const incoming=stage(state,"p1","IN","hand"),events:GameEvent[]=[];
 const before=JSON.stringify({state,events});
 if(route==="host")assert.throws(()=>vmHost(ctx,game,state,events).move(incoming,"energy","p1"),/original script movement/);
 if(route==="flow")assert.throws(()=>moved(ctx,game,state,events,incoming,"energy",{owner:"p1"}),/original script movement/);
 if(route==="charge"){
  const result=RULES.apply(ctx,copy(state),{type:"charge",player:"p1",card:incoming});
  assert.equal(result.state.prompt.kind,"main");assert.equal(result.state.outcome,undefined);
 }
 assert.equal(JSON.stringify({state,events}),before);cases++;
}
for(const malformed of [null,{}, {version:1}, {version:1,policy:{version:1,colors:["Red","Blue"]},witness:{}}])for(const route of ["direct","script"]){
 const state=RULES.createGame(ctx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const incoming=stage(state,"p1","IN","hand"),events:GameEvent[]=[];
 const frame:ScriptFrame={card:incoming,master:"p1",ops:[{op:"moveTo",target:{var:"incoming"},to:"energy"}],vars:{incoming:[incoming]},ip:0,energyEntry:malformed as unknown as ScriptFrame["energyEntry"]};
 const before=JSON.stringify({state,events,frame}),host=vmHost(ctx,game,state,events,frame);
 assert.throws(()=>route==="direct"?host.move(incoming,"energy","p1"):stepScript(host,frame),error=>error instanceof NotYet,"malformed saved/native continuation must typed-refuse");
 assert.equal(JSON.stringify({state,events,frame}),before);cases++;
}
for(const player of ["p1","p2"] as const)for(const accept of [false,true]){
 const actualDefs={...defs,L:card("L",{type:"LEADER",skill:"[Activate: Main] Add the top card of your deck to your energy."})};
 const actualRows=Object.values(actualDefs).flatMap(skillRecords);
 const actualCtx:EngineContext={defs:actualDefs,scripts:rulesFromRows(actualRows.map((row,id)=>({...row,id,status:"draft",source:"compiler"}) as unknown as RuleRow),actualDefs)};
 actualCtx.scripts!.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];actualCtx.scripts!.IN.bySkill[10].unsupported=[];
 let state=RULES.createGame(actualCtx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const other:PlayerId=player==="p1"?"p2":"p1";
 const events:GameEvent[]=[];
 const take=(action:Action)=>{const result=RULES.apply(actualCtx,copy(state),action);state=result.state as VmState;events.push(...result.events);};
 take({type:"chooseFirst",player:state.chooser,first:player});take({type:"mulligan",player,redraw:false});take({type:"mulligan",player:other,redraw:false});take({type:"pass",player});
 assert.equal(String(state.prompt.kind),"main");
 const incoming=stage(state,player,"IN","deck");stage(state,player,"R","drop");stage(state,player,"R","drop");stage(state,player,"B","drop");stage(state,player,"B","drop");
 take({type:"activate",player,card:state.sides[player].zones.leader[0],skill:0});
 let questions=0;
 while(state.prompt.kind==="chooseMode"||state.prompt.kind==="chooseCards"){
  assert.ok(++questions<6);assert.equal(state.prompt.player,player);
  assert.ok(state.sides[player].zones.deck.includes(incoming));
  for(const viewer of [player,other]){
   const view=RULES.boardView(actualCtx,copy(state),viewer,{});
   assert.equal(JSON.stringify(view).includes('"IN"'),false,"Deck source remains private in both board views before its arrival");
  }
  if(state.prompt.kind==="chooseMode")take({type:"chooseMode",player,index:accept?0:1});
  else take({type:"choose",player,cards:[state.prompt.choice.candidates[0]]});
 }
 assert.ok(state.sides[player].zones.energy.includes(incoming));assert.equal(state.cards[incoming].mode,accept?"active":"rest");
 assert.equal(hasKeyword(actualCtx,game,state,incoming,"Energy-Exhaust"),!accept);
 assert.equal(events.filter(event=>event.type==="move"&&event.card===incoming&&event.to==="energy").length,1);
 assert.equal(state.programs.length,0);cases++;
}
for(const player of ["p1","p2"] as const){
 const state=RULES.createGame(ctx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const incoming=stage(state,player,"IN","hand"),events:GameEvent[]=[];
 stage(state,player,"R","drop");stage(state,player,"R","drop");stage(state,player,"B","drop");stage(state,player,"B","drop");
 addEffect(state,[],{target:incoming,kind:"forbid",value:0,until:"game",forbid:{what:"beNegated",fromArea:"any"}});
 const frame:ScriptFrame={card:state.sides[player].zones.leader[0],master:player,ops:[{op:"moveTo",target:{var:"incoming"},to:"energy"}],vars:{incoming:[incoming]},ip:0};
 for(let question=0;question<3;question++){
  assert.equal(stepScript(vmHost(ctx,game,state,events,frame),frame),"wait");state.programs.shift();
  if(state.prompt.kind==="chooseMode")state.lastMode=0;
  else if(state.prompt.kind==="chooseCards")state.lastChoice=[state.prompt.choice.candidates[0]];
  else assert.fail("missing optional question");
 }
 assert.throws(()=>stepScript(vmHost(ctx,game,state,events,frame),frame),/protection changes with its entry/);
 assert.ok(state.sides[player].zones.hand.includes(incoming));assert.equal(state.effects.some(effect=>effect.energyEntryEpoch!==undefined),false);cases++;
}
for(const player of ["p1","p2"] as const){
 const localDefs={...defs,IN:{...defs.IN,skill:defs.IN.skill+"\n[Permanent] If there are 4 or more ≪Android≫ cards in your Drop Area, negate this card's [Energy-Exhaust] skill in all areas."},R:{...defs.R,traits:["Android"]},B:{...defs.B,traits:["Android"]}};
 const localRows=Object.values(localDefs).flatMap(skillRecords);
 const localCtx:EngineContext={defs:localDefs,scripts:rulesFromRows(localRows.map((row,id)=>({...row,id,status:"draft",source:"compiler"}) as unknown as RuleRow),localDefs)};
 localCtx.scripts!.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];localCtx.scripts!.IN.bySkill[10].unsupported=[];
 let state=RULES.createGame(localCtx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const incoming=stage(state,player,"IN","hand"),first=stage(state,player,"R","drop"),events:GameEvent[]=[];
 stage(state,player,"R","drop");stage(state,player,"B","drop");stage(state,player,"B","drop");
 addEffect(state,[],{target:first,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",fromArea:"drop",toArea:"warp",bySkill:true}});
 assert.equal(hasKeyword(localCtx,game,state,incoming,"Energy-Exhaust"),false);
 let frame:ScriptFrame={card:state.sides[player].zones.leader[0],master:player,ops:[{op:"moveTo",target:{var:"incoming"},to:"energy"}],vars:{incoming:[incoming]},ip:0};
 for(let n=0;n<5;n++){
  if(stepScript(vmHost(localCtx,game,state,events,frame),frame)==="done")break;
  state=copy(state);frame=state.programs.shift()!;
  if(state.prompt.kind==="chooseMode")state.lastMode=0;
  else if(state.prompt.kind==="chooseCards")state.lastChoice=[state.prompt.choice.candidates[0]];
  else assert.fail("missing optional question");
 }
 assert.equal(state.sides[player].zones.drop.length,3);assert.equal(state.cards[incoming].mode,"rest","mode observes failed/partial payer effects before capturing Exhaust");
 assert.equal(hasKeyword(localCtx,game,state,incoming,"Energy-Exhaust"),true);cases++;
}
for(const player of ["p1","p2"] as const)for(const scenario of ["batch","drop","payment","hidden"] as const){
 const state=RULES.createGame(ctx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const incoming=stage(state,player,"IN",scenario==="drop"?"drop":"hand"),ordinary=stage(state,player,"F","hand"),events:GameEvent[]=[];
 if(scenario==="hidden")state.cards[incoming].hidden=true;
 const frame:ScriptFrame={card:state.sides[player].zones.leader[0],master:player,ops:[...(scenario==="payment"?[{op:"moveTo" as const,target:{var:"ordinary"},to:"drop" as const}]:[]),{op:"moveTo",target:{var:"incoming"},to:"energy"}],vars:{incoming:scenario==="batch"?[ordinary,incoming]:[incoming],ordinary:[ordinary]},ip:0};
 const host=scenario==="payment"?automaticPriceHost(ctx,game,state,events):vmHost(ctx,game,state,events,frame);
 const before=JSON.stringify({state,events,frame});
 if(scenario==="drop"){assert.equal(stepScript(host,frame),"done");assert.ok(state.sides[player].zones.energy.includes(incoming));assert.equal(state.cards[incoming].mode,"rest");assert.equal(state.effects.some(e=>e.energyEntryEpoch!==undefined),false,"one physical Drop card cannot satisfy both distinct payer slots");assert.equal(events.filter(e=>e.type==="move"&&e.card===incoming&&e.to==="energy").length,1);}
 else {assert.throws(()=>stepScript(host,frame),error=>error instanceof NotYet);assert.equal(JSON.stringify({state,events,frame}),before,"unsupported route refuses before first ordinary payment or batch move");}
 cases++;
}
for(const player of ["p1","p2"] as const){
 const localDefs={...defs,"DB1-066":card("DB1-066",{skill:standingFixtures["DB1-066"].skill})};
 const localRows=Object.values(localDefs).flatMap(skillRecords);
 const localCtx:EngineContext={defs:localDefs,scripts:rulesFromRows(localRows.map((row,id)=>({...row,id,status:"draft",source:"compiler"}) as unknown as RuleRow),localDefs)};
 localCtx.scripts!.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];localCtx.scripts!.IN.bySkill[10].unsupported=[];
 let state=RULES.createGame(localCtx,{seed:476,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const incoming=stage(state,player,"IN","hand"),king=stage(state,player,"DB1-066","hand"),events:GameEvent[]=[];
 stage(state,player,"R","drop");stage(state,player,"R","drop");stage(state,player,"B","drop");stage(state,player,"B","drop");
 resolvePlay(localCtx,game,state,events,king,player);assert.ok(state.standingNegationHistory);
 let frame:ScriptFrame={card:state.sides[player].zones.leader[0],master:player,ops:[{op:"moveTo",target:{var:"incoming"},to:"energy"}],vars:{incoming:[incoming]},ip:0};
 for(let n=0;n<5;n++){
  if(stepScript(vmHost(localCtx,game,state,events,frame),frame)==="done")break;
  state=copy(state);frame=state.programs.shift()!;validateStandingNegationRead(localCtx,state);
  if(state.prompt.kind==="chooseMode")state.lastMode=0;
  else if(state.prompt.kind==="chooseCards")state.lastChoice=[state.prompt.choice.candidates[0]];
  else assert.fail("missing optional question");
 }
 validateStandingNegationRead(localCtx,state);assert.equal(state.cards[incoming].mode,"active");assert.equal(hasKeyword(localCtx,game,state,incoming,"Energy-Exhaust"),false);
 moved(localCtx,game,state,events,incoming,"drop",{owner:player});validateStandingNegationRead(localCtx,state);assert.equal(hasKeyword(localCtx,game,state,incoming,"Energy-Exhaust"),true);cases++;
}
console.log(`energy-entry-native-5: ${cases} synthetic native entry checks passed; synthetic mechanism fixtures`);
