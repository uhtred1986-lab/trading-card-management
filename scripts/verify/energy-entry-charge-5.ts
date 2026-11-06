import { priceFromCostRecord } from "../../src/lib/arena/vm/skill-payment";
import type { CostRecord } from "../../src/lib/arena/vm/script";
/** R482 saved ordinary Charge action and optional Energy entry. */
import assert from "node:assert/strict";
import fixtures from "./fixtures/standing-negation-observation-5.json";
import { resolvePlay } from "../../src/lib/arena/vm/play";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript, type Script, type ScriptFrame } from "../../src/lib/arena/vm/script";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import type { Action, EngineContext, GameEvent, PlayerId, Replacement } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { hasKeyword } from "../../src/lib/arena/vm/program";
const defs:EngineContext["defs"]={L:card("L",{type:"LEADER",skill:"[Activate: Main] Add the top card of your deck to your energy."}),F:card("F",{}),IN:card("IN",{skill:"[Energy-Exhaust]\n[Permanent] This card gets +1000 power."}),R:card("R",{colors:["Red"]}),B:card("B",{colors:["Blue"]})};
defs.K=card("K",{skill:fixtures["DB1-066"].skill});
const rows=Object.values(defs).flatMap(skillRecords);
const ctx:EngineContext={defs,scripts:rulesFromRows(rows.map((row,id)=>({...row,id,status:"draft",source:"compiler"}) as unknown as RuleRow),defs)};
ctx.scripts!.K={bySkill:{},complete:false,unsupported:["R477 fixture only"]};
for(const r of fixtures["DB1-066"].records)ctx.scripts!.K.bySkill[r.skillIndex]={kind:r.kind,ops:r.ops,unsupported:r.unread,validity:r.validity,usage:r.usage,trigger:r.trigger,price:priceFromCostRecord(r.cost as CostRecord)} as Script;
ctx.scripts!.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];ctx.scripts!.IN.bySkill[10].unsupported=[];
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const copy=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
function stage(state:VmState,player:PlayerId,cardId:string,area:string){const id=state.sides[player].zones.deck.at(-1)!;state.cards[id].cardId=cardId;assert.ok(moveCard(state,game,id,area,{owner:player,...(area==="deck"?{position:"top" as const}:{})}).ok);return id;}
let cases=0;
for(const player of ["p1","p2"] as const)for(const answer of ["accept","decline","partial"] as const)for(const scenario of ["ordinary","budget","standingBudget","skillBan","protected","skillReplacement"] as const){
 let state=RULES.createGame(ctx,{seed:482,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const other:PlayerId=player==="p1"?"p2":"p1",events:GameEvent[]=[];
 const take=(action:Action)=>{const result=RULES.apply(ctx,copy(state),action);state=result.state as VmState;events.push(...result.events);assert.equal(state.outcome,undefined,JSON.stringify(state.outcome));};
 take({type:"chooseFirst",player:state.chooser,first:player});take({type:"mulligan",player,redraw:false});take({type:"mulligan",player:other,redraw:false});
 const promptKind=()=>state.prompt.kind;
 assert.equal(promptKind(),"charge");
 const incoming=stage(state,player,"IN","hand"),red=stage(state,player,"R","drop"),blue=stage(state,player,"B","drop");
 if(scenario==="standingBudget"){const king=stage(state,player,"K","hand");resolvePlay(ctx,game,state,[],king,player);}
 const effectHost=vmHost(ctx,game,state,[]);
 if(scenario==="budget"||scenario==="standingBudget")for(const uses of [1,2])effectHost.addEffect({target:"",kind:"forbid",value:0,until:"game",forbid:{what:"placeEnergy",player,uses}});
 if(scenario==="skillBan")effectHost.addEffect({target:incoming,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",fromArea:"hand",toArea:"energy",bySkill:true}});
 if(scenario==="skillReplacement")effectHost.addEffect({target:incoming,source:incoming,master:player,kind:"replaceLeave",value:{target:{special:"self"},by:"skill",to:"deck"} as Replacement,until:"game"});
 if(scenario==="protected")effectHost.addEffect({target:"",kind:"forbid",value:0,until:"game",forbid:{what:"beNegated",fromArea:"any"}});
 if(answer==="partial")effectHost.addEffect({target:red,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",fromArea:"drop",toArea:"warp",bySkill:true}});
 if(answer==="accept"&&scenario==="ordinary"){
  for(const corrupt of [
   (_s:VmState,f:ScriptFrame)=>{f.ops=[{op:"draw",n:1}];},
   (_s:VmState,f:ScriptFrame)=>{f.vars.card=[red];},
   (_s:VmState,f:ScriptFrame)=>{f.moveLoop={kind:"moveTo",ids:[red],index:0,to:"energy",reason:"charge"};},
   (_s:VmState,f:ScriptFrame)=>{f.moveLoop={kind:"moveTo",ids:[incoming],index:0,to:"warp",reason:"charge"};},
   (_s:VmState,f:ScriptFrame)=>{f.moveLoop={kind:"moveTo",ids:[incoming],index:0,to:"energy",reason:"effect"};},
   (_s:VmState,f:ScriptFrame)=>{f.skillIndex=0;},
   (_s:VmState,f:ScriptFrame)=>{f.master=other;},
   (_s:VmState,f:ScriptFrame)=>{f.saveVarsAs="forged";},
   (s:VmState)=>{s.flow.at(-1)!.asking=[player];},
  ]){
   const saved=copy(state);saved.flow.at(-1)!.asking=[];
   const frame:ScriptFrame={card:incoming,master:player,ip:0,vars:{card:[incoming]},ops:copy(game.actions.charge.do),declaredCharge:true};
   corrupt(saved,frame);const before=JSON.stringify({saved,frame});assert.throws(()=>stepScript(vmHost(ctx,game,saved,[],frame),frame),/original ordinary Charge/);assert.equal(JSON.stringify({saved,frame}),before);cases++;
  }
  for(const what of ["placeEnergy","energyCap"] as const){
   const blocked=copy(state);vmHost(ctx,game,blocked,[]).addEffect({target:"",kind:"forbid",value:0,until:"game",forbid:{what,player}});
   const before=JSON.stringify(blocked);assert.throws(()=>RULES.apply(ctx,blocked,{type:"charge",player,card:incoming}),/refused/);assert.equal(JSON.stringify(blocked),before);cases++;
  }
  const taxed=copy(state);vmHost(ctx,game,taxed,[]).addEffect({target:"",kind:"forbid",value:0,until:"game",forbid:{what:"placeEnergy",player,pay:[{op:"draw",n:1}]}});
  const beforeTax=JSON.stringify(taxed);assert.throws(()=>RULES.apply(ctx,taxed,{type:"charge",player,card:incoming}),/original ordinary Charge/);assert.equal(JSON.stringify(taxed),beforeTax);cases++;
  const replaced=copy(state);vmHost(ctx,game,replaced,[]).addEffect({target:incoming,source:incoming,master:player,kind:"replaceLeave",value:{target:{special:"self"},to:"deck"} as Replacement,until:"game"});
  const refused=RULES.apply(ctx,replaced,{type:"charge",player,card:incoming});assert.equal(refused.state.outcome?.kind,"interrupted");assert.equal((refused.state as VmState).energyCharge,undefined);assert.equal(refused.events.some(e=>e.type==="move"),false);cases++;
  const changed=copy(game);changed.actions.charge.do.push({op:"draw",n:1});
  const changedCtx={...ctx,rulesetDefinition:changed};assert.throws(()=>RULES.apply(changedCtx,copy(state),{type:"charge",player,card:incoming}),/original ordinary Charge/);cases++;
 }
 events.length=0;take({type:"charge",player,card:incoming});
 if(answer==="accept"&&scenario==="ordinary"){
  assert.throws(()=>RULES.apply(ctx,copy(state),{type:"chooseMode",player:other,index:0}),/decision/);cases++;
  const conceded=RULES.apply(ctx,copy(state),{type:"concede",player:other});assert.equal(conceded.state.outcome?.kind,"concession");assert.equal((conceded.state as VmState).energyCharge,undefined);assert.equal(conceded.events.some(e=>e.type==="move"),false);cases++;
  let capped=copy(state),selection=0;const capEvents:GameEvent[]=[];
  vmHost(ctx,game,capped,[]).addEffect({target:"",kind:"forbid",value:0,until:"game",forbid:{what:"energyCap",player}});
  while(capped.prompt.kind==="chooseMode"||capped.prompt.kind==="chooseCards"){
   const action:Action=capped.prompt.kind==="chooseMode"?{type:"chooseMode",player,index:0}:{type:"choose",player,cards:[selection++===0?red:blue]};
   const result=RULES.apply(ctx,copy(capped),action);capped=result.state as VmState;capEvents.push(...result.events);
  }
  assert.equal(capped.outcome,undefined);assert.equal(capped.prompt.kind,"main");assert.equal(capped.energyCharge,undefined);assert.ok(capped.sides[player].zones.hand.includes(incoming));
  assert.ok(capped.sides[player].zones.warp.includes(red)&&capped.sides[player].zones.warp.includes(blue));assert.equal(capEvents.some(e=>e.type==="move"&&e.card===incoming),false);cases++;
 }
 if(answer==="accept"&&scenario==="ordinary")for(const corrupt of [
  (s:VmState)=>{delete s.programs[0].declaredCharge;},
  (s:VmState)=>{delete s.energyCharge;},
  (s:VmState)=>{delete s.programs[0].energyCharge;},
  (s:VmState)=>{delete s.energyCharge;delete s.programs[0].energyCharge;},
  (s:VmState)=>{s.turn++;},
  (s:VmState)=>{s.turnPlayer=other;},
  (s:VmState)=>{s.flow.at(-1)!.index++;},
  (s:VmState)=>{s.flow.at(-1)!.asking=[player];},
  (s:VmState)=>{s.energyCharge!.budgetSpent=false as true;},
  (s:VmState)=>{s.energyCharge!.epoch++;},
  (s:VmState)=>{s.cards[incoming].zoneEpoch=(s.cards[incoming].zoneEpoch??0)+1;},
  (s:VmState)=>{s.cards[incoming].flipped=true;},
  (s:VmState)=>{s.programs[0].ops=[{op:"draw",n:1}];},
  (s:VmState)=>{s.programs[0].vars.card=[red];},
  (s:VmState)=>{s.programs[0].master=other;},
  (s:VmState)=>{s.programs[0].skillIndex=0;},
 ]){
  const bad=copy(state);corrupt(bad);const before=JSON.stringify(bad);assert.throws(()=>RULES.apply(ctx,bad,{type:"chooseMode",player,index:0}),/original ordinary Charge/);
  assert.equal(JSON.stringify(bad),before);cases++;
 }
 const savedFlow=copy(state.flow);assert.equal(state.phase,"charge");assert.equal(promptKind(),"chooseMode");assert.ok(state.energyCharge);
 let chooser=0;
 while(state.prompt.kind==="chooseMode"||state.prompt.kind==="chooseCards"){
  if(scenario==="budget"||scenario==="standingBudget")assert.deepEqual(state.effects.filter(e=>e.forbid?.what==="placeEnergy").map(e=>e.forbid!.uses),[0,1]);
  assert.equal(JSON.stringify(RULES.boardView(ctx,copy(state),other,{})).includes("budgetBefore"),false,"internal action scope is not a public board field");
  assert.equal(state.prompt.player,player);assert.ok(!JSON.stringify(state.prompt).includes(defs.IN.name),"private incoming name is absent from choice text");
  assert.equal(state.phase,"charge");assert.deepEqual(state.flow,savedFlow);assert.ok(state.sides[player].zones.hand.includes(incoming));assert.ok(!state.sides[player].attrs.charged);
  if(state.prompt.kind==="chooseMode")take({type:"chooseMode",player,index:answer==="decline"?1:0});
  else take({type:"choose",player,cards:[chooser++===0?red:blue]});
 }
 assert.equal(promptKind(),"main");assert.equal(state.phase,"main");assert.equal(state.energyCharge,undefined);assert.equal(state.sides[player].attrs.charged,true);
 assert.ok(state.sides[player].zones.energy.includes(incoming));assert.equal(state.cards[incoming].mode,answer==="accept"&&scenario!=="protected"?"active":"rest");assert.equal(hasKeyword(ctx,game,state,incoming,"Energy-Exhaust"),answer!=="accept"||scenario==="protected");
 assert.equal(events.filter(e=>e.type==="move"&&e.card===incoming&&e.to==="energy").length,1);cases++;
}
for(const player of ["p1","p2"] as const)for(const optional of [false,true])for(const skillOnly of [false,true]){
 const autoDefs={...defs,IN:{...defs.IN,skill:defs.IN.skill+"\n[Auto] When this card is placed in your energy, draw 1 card."}};
 const scripts=rulesFromRows(Object.values(autoDefs).flatMap(skillRecords).map((row,id)=>({...row,id,status:"draft",source:"compiler"}) as unknown as RuleRow),autoDefs);
 scripts.K=ctx.scripts!.K;
 if(optional){scripts.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];scripts.IN.bySkill[10].unsupported=[];}
 const pinned=copy(game);if(skillOnly)pinned.triggers.placedInEnergy.on.args.by="skill";
 const autoCtx={defs:autoDefs,scripts,rulesetDefinition:pinned};
 let state=RULES.createGame(autoCtx,{seed:482,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const other=player==="p1"?"p2":"p1",events:GameEvent[]=[];
 const take=(action:Action)=>{const result=RULES.apply(autoCtx,copy(state),action);state=result.state as VmState;events.push(...result.events);assert.equal(state.outcome,undefined);};
 take({type:"chooseFirst",player:state.chooser,first:player});take({type:"mulligan",player,redraw:false});take({type:"mulligan",player:other,redraw:false});
 const incoming=stage(state,player,"IN","hand");
 stage(state,player,"R","drop");stage(state,player,"B","drop");
 vmHost(autoCtx,pinned,state,[]).addEffect({target:incoming,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",fromArea:"hand",toArea:"energy",bySkill:true}});
 events.length=0;take({type:"charge",player,card:incoming});
 if(optional){assert.equal(events.some(e=>e.type==="autoDeclared"),false);take({type:"chooseMode",player,index:1});}
 assert.equal(state.prompt.kind,"main");assert.ok(state.sides[player].zones.energy.includes(incoming));
 assert.equal(events.filter(e=>e.type==="draw").length,skillOnly?0:1,"ordinary Charge has an arrival Auto, but no skill-only arrival Auto");
 const arrival=events.findIndex(e=>e.type==="move"&&e.card===incoming&&e.to==="energy"),draw=events.findIndex(e=>e.type==="draw");if(!skillOnly)assert.ok(draw>arrival,"arrival Auto waits until original Charge has moved");cases++;
}
for(const player of ["p1","p2"] as const)for(const standing of [false,true]){
 let state=RULES.createGame(ctx,{seed:482,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const other=player==="p1"?"p2":"p1";
 for(const action of [{type:"chooseFirst",player:state.chooser,first:player},{type:"mulligan",player,redraw:false},{type:"mulligan",player:other,redraw:false},{type:"pass",player}] as Action[])state=RULES.apply(ctx,copy(state),action).state as VmState;
 if(standing){const king=stage(state,player,"K","hand");resolvePlay(ctx,game,state,[],king,player);}
 for(const uses of [1,2])vmHost(ctx,game,state,[]).addEffect({target:"",kind:"forbid",value:0,until:"game",forbid:{what:"activateSkill",player,uses}});
 const action:Action={type:"activate",player,card:state.sides[player].zones.leader[0],skill:0};
 const result=RULES.apply(ctx,copy(state),action);state=result.state as VmState;
 assert.equal(state.outcome,undefined);assert.equal(state.prompt.kind,"main");assert.deepEqual(state.effects.filter(e=>e.forbid?.what==="activateSkill").map(e=>e.forbid!.uses),[0,1]);
 assert.equal(result.events.filter(e=>e.type==="move"&&e.to==="energy").length,1);assert.throws(()=>RULES.apply(ctx,copy(state),action),/refused/);cases++;
}
for(const player of ["p1","p2"] as const)for(const route of ["fusion","tax","custom","redirect","substitute","skillReplacement"] as const){
 const pinned=copy(game);if(route==="custom")pinned.actions.charge.do.push({op:"draw",n:1});
 const testCtx=route==="custom"?{...ctx,rulesetDefinition:pinned}:ctx;
 let state=RULES.createGame(testCtx,{game:route==="fusion"?"fusion":"dbs",seed:482,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const other=player==="p1"?"p2":"p1";
 for(const action of [{type:"chooseFirst",player:state.chooser,first:player},{type:"mulligan",player,redraw:false},{type:"mulligan",player:other,redraw:false}] as Action[])state=RULES.apply(testCtx,copy(state),action).state as VmState;
 const incoming=state.sides[player].zones.hand[0];
 if(route==="tax")vmHost(testCtx,pinned,state,[]).addEffect({target:"",kind:"forbid",value:0,until:"game",forbid:{what:"placeEnergy",player,pay:[{op:"choose",sel:{side:"you",area:"hand",count:1,notSelf:"card"},as:"tax"},{op:"moveTo",target:{var:"tax"},to:"warp",cause:"cost"}]}});
 if(["redirect","substitute","skillReplacement"].includes(route)){
  const replacement:Replacement={target:{special:"self"},...(route==="substitute"?{ops:[{op:"moveTo",target:{sel:{special:"self"}},to:"drop"}]}:{to:"deck"}),...(route==="skillReplacement"?{by:"skill"}:{})};
  vmHost(testCtx,pinned,state,[]).addEffect({target:incoming,source:incoming,master:player,kind:"replaceLeave",value:replacement,until:"game"});
 }
 let result=RULES.apply(testCtx,copy(state),{type:"charge",player,card:incoming});state=result.state as VmState;
 while(state.prompt.kind==="chooseCards"){result=RULES.apply(testCtx,copy(state),{type:"choose",player,cards:[state.prompt.choice.candidates.find(id=>id!==incoming)!]});state=result.state as VmState;}
 assert.equal(state.outcome,undefined,JSON.stringify(state.outcome));assert.equal(state.prompt.kind,"main");
 assert.ok(state.sides[player].zones[route==="redirect"?"deck":route==="substitute"?"drop":"energy"].includes(incoming),route);
 assert.equal(result.events.filter(e=>e.type==="draw").length,route==="custom"?1:0);cases++;
}
console.log(`energy-entry-charge-5: ${cases} native Charge controls passed`);
