/** R484 bounded own Warp/Z-Energy entry and physical source-holder proof. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import type { Action, EngineContext, GameEvent, PlayerId, Area } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
import { hasKeyword } from "../../src/lib/arena/vm/program";
import { guardEnergyEntryBatch } from "../../src/lib/arena/vm/energy-entry-preflight";
import { stepScript, type ScriptFrame } from "../../src/lib/arena/vm/script";
const defs={L:card("L",{type:"LEADER",skill:"[Activate: Main] Add the top card of your deck to your energy."}),F:card("F",{}),IN:card("IN",{colors:["Red","Blue"],skill:"[Energy-Exhaust]\n[Permanent] This card gets +1000 power."}),R:card("R",{colors:["Red"]}),B:card("B",{colors:["Blue"]})};
const rows=Object.values(defs).flatMap(skillRecords);
const ctx:EngineContext={defs,scripts:rulesFromRows(rows.map((row,id)=>({...row,id,status:"draft",source:"compiler"}) as unknown as RuleRow),defs)};
ctx.scripts!.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];ctx.scripts!.IN.bySkill[10].unsupported=[];
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const copy=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
function stage(state:VmState,player:PlayerId,cardId:string,area:Area){const id=state.sides[player].zones.deck.at(-1)!;state.cards[id].cardId=cardId;assert.ok(moveCard(state,game,id,area,{owner:player,...(area==="deck"?{position:"top" as const}:{})}).ok);return id;}
function fresh(player:PlayerId,area:Area){
 const ownCtx=copy(ctx),other:PlayerId=player==="p1"?"p2":"p1";
 ownCtx.scripts!.L.bySkill[0].ops=[{op:"choose",sel:{side:"you",area,count:1},as:"incoming"},{op:"moveTo",target:{var:"incoming"},to:"energy",reveal:true}];
 let state=RULES.createGame(ownCtx,{seed:484,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 for(const action of [{type:"chooseFirst",player:state.chooser,first:player},{type:"mulligan",player,redraw:false},{type:"mulligan",player:other,redraw:false},{type:"pass",player}] as Action[])state=RULES.apply(ownCtx,copy(state),action).state as VmState;
 const incoming=stage(state,player,"IN",area),red=stage(state,player,"R","drop"),blue=stage(state,player,"B","drop");
 stage(state,player,"R","drop");stage(state,player,"B","drop");
 return {ctx:ownCtx,state,incoming,red,blue,other};
}
let cases=0;
for(const player of ["p1","p2"] as const)for(const area of ["warp","zEnergy"] as const)for(const choice of ["accept","decline","partial","wholeNegated","lineNegated","protected","payerAttribution","payerBattleBan","rest"] as const){
 const b=fresh(player,area),events:GameEvent[]=[];let state=b.state;
 const take=(action:Action)=>{const result=RULES.apply(b.ctx,copy(state),action);state=result.state as VmState;events.push(...result.events);assert.equal(state.outcome,undefined,JSON.stringify(state.outcome));};
 const h=vmHost(b.ctx,game,state,[]);
 if(choice==="wholeNegated")h.addEffect({target:b.incoming,kind:"negateSkills",value:0,until:"game"});
 if(choice==="lineNegated")h.addEffect({target:b.incoming,kind:"negateSkill",value:10,until:"game"});
 if(choice==="protected")h.addEffect({target:"",kind:"forbid",value:0,until:"game",forbid:{what:"beNegated",fromArea:"any"}});
 if(choice==="partial"||choice==="payerAttribution"||choice==="payerBattleBan")h.addEffect({target:b.red,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",fromArea:"drop",toArea:"warp",bySkill:true,...(choice==="payerAttribution"?{byTypes:["LEADER"]}:choice==="payerBattleBan"?{byTypes:["BATTLE"]}: {})}});
 if(choice==="rest")b.ctx.scripts!.L.bySkill[0].ops[1]={op:"moveTo",target:{var:"incoming"},to:"energy",mode:"rest",reveal:true};
 const epoch=state.cards[b.incoming].zoneEpoch??0;
 take({type:"activate",player,card:state.sides[player].zones.leader[0],skill:0});if(state.prompt.kind==="chooseCards"&&state.prompt.choice.candidates.includes(b.incoming))take({type:"choose",player,cards:[b.incoming]});
 let chooser=0,questions=0;
 while(state.prompt.kind==="chooseMode"||state.prompt.kind==="chooseCards"){
  questions++;assert.ok(questions<=3);assert.equal(state.prompt.player,player);assert.ok(state.sides[player].zones[area].includes(b.incoming));
  const parent=state.programs.find(f=>f.energyEntry);assert.ok(parent?.energyEntry);assert.equal(parent.energyEntry.witness.incoming.holder,player);assert.equal(parent.energyEntry.witness.incoming.area,area);
  RULES.boardView(b.ctx,copy(state),player,{});RULES.boardView(b.ctx,copy(state),b.other,{});
  if(state.prompt.kind==="chooseMode")take({type:"chooseMode",player,index:choice==="decline"?1:0});
  else take({type:"choose",player,cards:[chooser++===0?b.red:b.blue]});
 }
 assert.equal(state.prompt.kind,"main");assert.equal(questions===0,choice==="wholeNegated"||choice==="lineNegated");
 assert.ok(state.sides[player].zones.energy.includes(b.incoming));assert.equal(state.cards[b.incoming].zoneEpoch,epoch+1);
 const earned=["accept","payerAttribution","rest"].includes(choice),active=choice==="wholeNegated"||earned&&choice!=="rest";
 assert.equal(state.cards[b.incoming].mode,active?"active":"rest");assert.equal(hasKeyword(b.ctx,game,state,b.incoming,"Energy-Exhaust"),!earned);
 assert.equal(events.filter(e=>e.type==="move"&&e.card===b.incoming&&e.to==="energy").length,1);
 assert.equal(state.effects.some(e=>e.target===b.incoming&&e.energyEntryEpoch!==undefined),earned);
 if(choice==="partial"||choice==="payerBattleBan"){assert.ok(state.sides[player].zones.drop.includes(b.red));assert.ok(state.sides[player].zones.warp.includes(b.blue));}
 if(earned){
  const stamp=state.effects.find(e=>e.energyEntryEpoch!==undefined)!;assert.equal(stamp.master,player);assert.equal(stamp.source,b.incoming);assert.equal(stamp.energyEntryEpoch,epoch+1);
  vmHost(b.ctx,game,state,events).move(b.incoming,area,player);assert.equal(state.effects.some(e=>e.target===b.incoming&&e.energyEntryEpoch!==undefined),false);assert.equal(hasKeyword(b.ctx,game,state,b.incoming,"Energy-Exhaust"),true);
 }
 cases++;
}
for(const player of ["p1","p2"] as const)for(const area of ["hand","deck","warp","zEnergy"] as const){
 const b=fresh(player,area);let state=b.state;
 const take=(action:Action)=>{const result=RULES.apply(b.ctx,copy(state),action);state=result.state as VmState;assert.equal(state.outcome,undefined);};
 take({type:"activate",player,card:state.sides[player].zones.leader[0],skill:0});if(state.prompt.kind==="chooseCards"&&state.prompt.choice.candidates.includes(b.incoming))take({type:"choose",player,cards:[b.incoming]});
 assert.equal(state.prompt.kind,"chooseMode",`${area}: ${JSON.stringify(state.prompt)}`);
 for(const corrupt of [
  (s:VmState)=>{s.cards[b.incoming].zoneEpoch=(s.cards[b.incoming].zoneEpoch??0)+2;},
  (s:VmState)=>{s.cards[b.incoming].flipped=true;},
  (s:VmState)=>{s.cards[b.incoming].cardId="F";},
  (s:VmState)=>{s.sides[player].zones[area]=s.sides[player].zones[area].filter(id=>id!==b.incoming);s.sides[b.other].zones[area].push(b.incoming);},
  (s:VmState)=>{s.cards[b.incoming].owner=b.other;},
  (s:VmState)=>{s.programs.find(f=>f.energyEntry)!.energyEntry!.witness.incoming.holder=b.other;},
 ]){
  const bad=copy(state);corrupt(bad);const before=JSON.stringify(bad);
  try{const result=RULES.apply(b.ctx,bad,{type:"chooseMode",player,index:0});assert.equal(result.state.outcome?.kind,"interrupted");assert.equal(result.events.some(e=>e.type==="move"),false);}catch(error){assert.match(String(error),/original incoming Energy|rebuild.*Energy/);}
  assert.equal(JSON.stringify(bad),before);cases++;
 }
 if(area==="warp"||area==="zEnergy"){
  take({type:"chooseMode",player,index:0});take({type:"choose",player,cards:[b.red]});assert.equal(String(state.prompt.kind),"chooseCards");
  for(const corrupt of [
   (s:VmState)=>{s.cards[b.red].zoneEpoch=(s.cards[b.red].zoneEpoch??0)+2;},
   (s:VmState)=>{s.sides[player].zones[area]=s.sides[player].zones[area].filter(id=>id!==b.incoming);s.sides[b.other].zones[area].push(b.incoming);},
   (s:VmState)=>{s.cards[b.incoming].flipped=true;},
  ]){
   const bad=copy(state);corrupt(bad);const before=JSON.stringify(bad);assert.throws(()=>RULES.apply(b.ctx,bad,{type:"choose",player,cards:[b.blue]}),/Energy|payer|available/);assert.equal(JSON.stringify(bad),before);cases++;
  }
 }
 const wrong=copy(b.state);wrong.sides[player].zones[area]=wrong.sides[player].zones[area].filter(id=>id!==b.incoming);wrong.sides[b.other].zones[area].push(b.incoming);
 const frame:ScriptFrame={card:wrong.sides[player].zones.leader[0],master:player,ops:[{op:"moveTo",target:{var:"incoming"},to:"energy"}],vars:{incoming:[b.incoming]},ip:0};
 const before=JSON.stringify({wrong,frame}),h=vmHost(b.ctx,game,wrong,[]);
 assert.equal(h.masterOf(b.incoming),player,"non-play master alone cannot prove the physical holder");
 assert.throws(()=>guardEnergyEntryBatch(b.ctx,wrong,h,frame,[b.incoming]),/origin or controller/);assert.equal(JSON.stringify({wrong,frame}),before);cases++;
 assert.throws(()=>stepScript(vmHost(b.ctx,game,wrong,[],frame),frame),/origin or controller/);assert.equal(JSON.stringify({wrong,frame}),before);cases++;
}
for(const player of ["p1","p2"] as const)for(const area of ["warp","zEnergy"] as const){
 const b=fresh(player,area),autoDef={...defs.IN,skill:defs.IN.skill+"\n[Auto] When this card is placed in your energy, draw 1 card."};
 b.ctx.defs={...b.ctx.defs,IN:autoDef};const autoRows=skillRecords(autoDef);
 b.ctx.scripts!.IN=rulesFromRows(autoRows.map((row,id)=>({...row,id,status:"draft",source:"compiler"}) as unknown as RuleRow),b.ctx.defs).IN;
 b.ctx.scripts!.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];b.ctx.scripts!.IN.bySkill[10].unsupported=[];
 const pinned=copy(game),leader=b.state.sides[player].zones.leader[0];pinned.triggers.placedInEnergy.on.args.by="skill";pinned.triggers.placedInEnergy.on.args.viaCard=leader;
 const autoCtx={...b.ctx,rulesetDefinition:pinned};let state=b.state;const events:GameEvent[]=[];
 const take=(action:Action)=>{const result=RULES.apply(autoCtx,copy(state),action);state=result.state as VmState;events.push(...result.events);assert.equal(state.outcome,undefined);};
 take({type:"activate",player,card:leader,skill:0});take({type:"chooseMode",player,index:0});let selected=0;
 while(state.prompt.kind==="chooseCards")take({type:"choose",player,cards:[selected++===0?b.red:b.blue]});
 assert.equal(state.prompt.kind,"main");assert.equal(events.filter(e=>e.type==="draw").length,1,"original arrival retains the original Leader skill source");
 assert.equal(events.filter(e=>e.type==="move"&&e.card===b.incoming&&e.to==="energy").length,1);cases++;
}
for(const player of ["p1","p2"] as const)for(const area of ["warp","zEnergy"] as const)for(const fault of ["hidden","stack","cost","controller","replacement","multi","type"] as const){
 const b=fresh(player,area),state=b.state,events:GameEvent[]=[];
 const frame:ScriptFrame={card:state.sides[player].zones.leader[0],master:player,ops:[{op:"moveTo",target:{var:"incoming"},to:"energy"}],vars:{incoming:[b.incoming]},ip:0};
 if(fault==="hidden")state.cards[b.incoming].hidden=true;
 if(fault==="stack"){state.sides[player].zones.drop=state.sides[player].zones.drop.filter(id=>id!==b.red);state.cards[b.incoming].under.push(b.red);}
 if(fault==="cost")frame.ops=[{op:"moveTo",target:{var:"incoming"},to:"energy",cause:"cost"}];
 if(fault==="controller")frame.ops=[{op:"moveTo",target:{var:"incoming"},to:"energy",owner:"opponent"}];
 if(fault==="replacement")vmHost(b.ctx,game,state,[]).addEffect({target:b.incoming,source:b.incoming,master:player,kind:"replaceLeave",value:{target:{special:"self"},by:"skill",to:"deck"},until:"game"});
 if(fault==="multi")frame.vars.incoming.unshift(state.sides[player].zones.hand[0]);
 if(fault==="type")b.ctx.defs.IN.type="EXTRA";
 const before=JSON.stringify({state,frame,events});assert.throws(()=>stepScript(vmHost(b.ctx,game,state,events,frame),frame),/Energy entry|Energy-entry/);assert.equal(JSON.stringify({state,frame,events}),before);cases++;
}
for(const player of ["p1","p2"] as const)for(const area of ["battle","combo","life","drop"] as const){
 const b=fresh(player,area),frame:ScriptFrame={card:b.state.sides[player].zones.leader[0],master:player,ops:[{op:"moveTo",target:{var:"incoming"},to:"energy"}],vars:{incoming:[b.incoming]},ip:0};
 const before=JSON.stringify({state:b.state,frame});assert.throws(()=>stepScript(vmHost(b.ctx,game,b.state,[],frame),frame),/Energy entry origin|plain Combo Energy entry|plain owned Battle Energy entry/);assert.equal(JSON.stringify({state:b.state,frame}),before);cases++;
}
console.log(`energy-entry-origins-5: ${cases} native origins and physical-holder controls passed`);
