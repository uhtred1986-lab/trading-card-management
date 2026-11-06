/** R486: native plain Combo Energy entry; synthetic runtime descriptors only. */
import assert from "node:assert/strict";
import fixtures from "./fixtures/energy-arrival-negation-5.json";
import { skillsNegated } from "../../src/lib/arena/vm/effects";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import type { Action, EngineContext, GameEvent, PlayerId, Area } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
const defs={L:card("L",{type:"LEADER",skill:"[Activate: Battle] Draw 1 card."}),F:card("F",{}),IN:card("IN",{comboCost:0,comboPower:5000,colors:["Red","Blue"],skill:"[Energy-Exhaust]\n[Permanent] This card gets +1000 power."}),C:card("C",{comboCost:0,comboPower:3000}),D:card("D",{comboCost:0,comboPower:1000}),A:card("A",{power:10000}),G:card("G",{power:18000}),R:card("R",{colors:["Red"]}),B:card("B",{colors:["Blue"]})};
const rows=Object.values(defs).flatMap(skillRecords);
const ctx:EngineContext={defs,scripts:rulesFromRows(rows.map((row,id)=>({...row,id,status:"draft",source:"compiler"}) as unknown as RuleRow),defs)};
ctx.scripts!.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];ctx.scripts!.IN.bySkill[10].unsupported=[];
ctx.scripts!.L.bySkill[0].ops=[{op:"choose",sel:{side:"you",area:"combo",count:1},as:"incoming"},{op:"moveTo",target:{var:"incoming"},to:"energy",reveal:true}];
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
function stage(s:VmState,p:PlayerId,def:string,area:Area){const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);s.cards[id].mode="active";return id;}
function setup(p:PlayerId,offense:boolean,origin:"hand"|"battle",mode="accept"){
 const c:EngineContext & { rulesetDefinition?: typeof game }=copy(ctx),turn=offense?p:other(p),events:GameEvent[]=[];
 if(!offense){c.defs.A.power=19000;c.defs.G.power=11000;}
 {
  c.defs.IN.skill+="\n[Auto] When this card is placed in your energy, draw 1 card.";
  c.scripts!.IN=rulesFromRows(skillRecords(c.defs.IN).map((row,id)=>({...row,id,status:"draft",source:"compiler"}) as unknown as RuleRow),c.defs).IN;
  c.scripts!.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];c.scripts!.IN.bySkill[10].unsupported=[];
 }
 if(mode==="rest")c.scripts!.L.bySkill[0].ops[1]={op:"moveTo",target:{var:"incoming"},to:"energy",mode:"rest",reveal:true};
 if(mode==="ordinary")c.scripts!.IN.bySkill[10].ops=[];
 let s=RULES.createGame(c,{seed:486,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 if(mode==="arrivalAttribution"){const pinned=copy(game);pinned.triggers.placedInEnergy.on.args.by="skill";pinned.triggers.placedInEnergy.on.args.viaCard=s.sides[p].zones.leader[0];c.rulesetDefinition=pinned;}
 const take=(a:Action)=>{s=copy(s);const before=JSON.stringify(s),result=RULES.apply(c,s,a);assert.equal(JSON.stringify(s),before);s=result.state as VmState;events.push(...result.events);assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));};
 const proceed=(end=false)=>{for(let n=0;n<40;n++){if(end?s.prompt.kind==="main":s.prompt.kind==="combo"&&s.prompt.player===p)return;const a=RULES.legalActions(c,s).map(x=>x.action).find(a=>a.type==="payCost"||a.type==="counter"&&a.card===null||a.type==="pass"||a.type==="block"&&a.card===null||a.type==="zEnergyFromCombo"&&a.card===null);assert.ok(a,JSON.stringify(s.prompt));take(a);}throw Error("no destination");};
 for(const a of [{type:"chooseFirst",player:s.chooser,first:turn},{type:"mulligan",player:turn,redraw:false},{type:"mulligan",player:other(turn),redraw:false},{type:"charge",player:turn,card:null},{type:"endMain",player:turn},{type:"charge",player:other(turn),card:null},{type:"endMain",player:other(turn)},{type:"charge",player:turn,card:null}] as Action[])take(a);
 const incoming=stage(s,p,"IN",origin),red=stage(s,p,"R","drop"),blue=stage(s,p,"B","drop");stage(s,p,"R","drop");stage(s,p,"B","drop");
 const extra=[stage(s,p,"C","hand"),stage(s,p,"D","battle")],attacker=stage(s,turn,"A","battle"),guard=stage(s,other(turn),"G","battle");s.cards[guard].mode="rest";
 const h=vmHost(c,game,s,[]);
 if(mode==="whole")h.addEffect({target:incoming,kind:"negateSkills",value:0,until:"game"});
 if(mode==="line")h.addEffect({target:incoming,kind:"negateSkill",value:20,until:"game"});
 if(mode==="protected")h.addEffect({target:"",kind:"forbid",value:0,until:"game",forbid:{what:"beNegated",fromArea:"any"}});
 if(["partial","payerAttribution","payerBattleBan"].includes(mode))h.addEffect({target:red,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",fromArea:"drop",toArea:"warp",bySkill:true,...(mode==="payerAttribution"?{byTypes:["LEADER"]}:mode==="payerBattleBan"?{byTypes:["BATTLE"]}:{})}});
 take({type:"attack",player:turn,attacker,target:guard});proceed();
 for(const id of [incoming,...extra]){take({type:"combo",player:p,card:id});proceed();}
 return {c,get s(){return s;},take,proceed,incoming,red,blue,extra,events,attacker,guard};
}

let cases=0;const results=[];
for(const p of ["p1","p2"] as const)for(const offense of [true,false])for(const origin of ["hand","battle"] as const)for(const mode of ["accept","whole","line"]){
 const b=setup(p,offense,origin,mode),beforeDraws=b.events.filter(e=>e.type==="draw"&&e.player===p).length,oldNegations=b.s.effects.filter(e=>e.target===b.incoming&&["negateSkills","negateSkill"].includes(e.kind)).length;
 assert.equal(oldNegations,mode!=="accept"&&origin==="battle"?1:0,"ordinary Hand-to-Combo resets old negation; Battle-to-Combo retains it");
 b.take({type:"activate",player:p,card:b.s.sides[p].zones.leader[0],skill:0});b.take({type:"choose",player:p,cards:[b.incoming]});let chosen=0;
 while(b.s.prompt.kind==="chooseMode"||b.s.prompt.kind==="chooseCards") b.take(b.s.prompt.kind==="chooseMode"?{type:"chooseMode",player:p,index:0}:{type:"choose",player:p,cards:[chosen++===0?b.red:b.blue]});
 if(origin==="hand"&&mode!=="accept"){
  assert.equal(chosen,2);assert.ok([b.red,b.blue].every(id=>b.s.sides[p].zones.warp.includes(id)));
  const stamp=b.s.effects.find(effect=>effect.target===b.incoming&&effect.energyEntryEpoch!==undefined);assert.ok(stamp);
  assert.equal(stamp.energyEntryEpoch,b.s.cards[b.incoming].zoneEpoch);assert.equal(stamp.source,b.incoming);assert.equal(stamp.master,p);assert.equal(b.s.cards[b.incoming].mode,"active");
 }
 const arrivalAutos=b.events.filter(e=>e.type==="skill"&&e.card===b.incoming&&e.skill===20).length;
 const draws=b.events.filter(e=>e.type==="draw"&&e.player===p).length;
 assert.ok(b.s.sides[p].zones.energy.includes(b.incoming));assert.equal(b.events.filter(e=>e.type==="move"&&e.card===b.incoming&&e.to==="energy").length,1);
 results.push({p,offense,origin,mode,oldNegations,arrivalAutos,draws:draws-beforeDraws,prompt:b.s.prompt.kind});cases++;
}
for(const r of results){const active=r.mode==="accept"||r.origin==="hand";assert.equal(r.arrivalAutos,active?1:0);assert.equal(r.draws,active?1:0);}
// Full actual records remain exact; only the independent mover is structural.
for(const value of Object.values(fixtures))assert.deepEqual(copy(skillRecords(value.def as EngineContext["defs"][string])),value.records);
const printedDefs:EngineContext["defs"]={L:card("L",{type:"LEADER",colors:["Blue"],characters:["Son Gohan: Childhood"],skill:"[Activate: Main] Draw 1 card."}),F:card("F",{}),E:card("E",{colors:["Blue"]}),WATCH:card("WATCH",{skill:"[Auto] When this card attacks, draw 1 card."})};
for(const [id,v] of Object.entries(fixtures))printedDefs[id]=v.def as EngineContext["defs"][string];
const printedRows=Object.values(printedDefs).flatMap(skillRecords);
const printedCtx:EngineContext={defs:printedDefs,scripts:rulesFromRows(printedRows.map((r,id)=>({...r,id,status:"draft",source:"compiler"}) as unknown as RuleRow),printedDefs)};
function printed(p:PlayerId,id:string,area:Area,charge=false){
 const c=copy(printedCtx),events:GameEvent[]=[];let s=RULES.createGame(c,{seed:493,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const take=(a:Action)=>{const saved=copy(s),before=JSON.stringify(saved),r=RULES.apply(c,saved,a);assert.equal(JSON.stringify(saved),before);s=r.state as VmState;events.push(...r.events);assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));};
 take({type:"chooseFirst",player:s.chooser,first:p});take({type:"mulligan",player:p,redraw:false});take({type:"mulligan",player:other(p),redraw:false});if(!charge)take({type:"charge",player:p,card:null});
 stage(s,p,"E","energy");stage(s,p,"E","energy");const incoming=stage(s,p,id,area);
 c.scripts!.L.bySkill[0].ops=[{op:"choose",sel:{side:"you",area,count:1},as:"incoming"},{op:"moveTo",target:{var:"incoming"},to:"energy",reveal:true}];
 const run=()=>{if(charge)take({type:"charge",player:p,card:incoming});else{take({type:"activate",player:p,card:s.sides[p].zones.leader[0],skill:0});if(s.prompt.kind==="chooseCards"&&s.prompt.choice.candidates.includes(incoming))take({type:"choose",player:p,cards:[incoming]});}};
 return {c,get s(){return s;},take,run,incoming,events};
}
for(const p of ["p1","p2"] as const)for(const id of ["BT18-052","EX17-02","BT13-040"])for(const area of ["hand","deck","warp","zEnergy"] as const)for(const mode of ["none","whole","line"]){
 const b=printed(p,id,area);if(mode!=="none")vmHost(b.c,game,b.s,[]).addEffect({target:b.incoming,kind:mode==="whole"?"negateSkills":"negateSkill",value:mode==="whole"?0:10,until:"game"});
 b.run();const expected=mode==="none"&&(id!=="BT13-040"||area==="hand");
 if(id==="BT13-040"){
  const q=b.s.prompt;assert.equal(q.kind==="optionalCost"||q.kind==="chooseMode",expected,`${id}/${area}/${mode}`);
  if(q.kind==="optionalCost")b.take({type:"optionalCost",player:p,pay:false});else if(q.kind==="chooseMode")b.take({type:"chooseMode",player:p,index:1});
 }else assert.equal(b.events.filter(e=>e.type==="skill"&&e.card===b.incoming&&e.skill===10).length,expected?1:0,`${id}/${area}/${mode}: ${JSON.stringify(b.s.prompt)}`);
 assert.equal(b.events.filter(e=>e.type==="move"&&e.card===b.incoming&&e.to==="energy").length,1);assert.ok(b.s.sides[p].zones.energy.includes(b.incoming));
 if(id==="EX17-02")assert.equal(skillsNegated(b.s,b.incoming),expected);cases++;
}
for(const p of ["p1","p2"] as const)for(const id of ["BT18-052","EX17-02","BT13-040"])for(const mode of ["none","whole","line"]){
 const b=printed(p,id,"hand",true);if(mode!=="none")vmHost(b.c,game,b.s,[]).addEffect({target:b.incoming,kind:mode==="whole"?"negateSkills":"negateSkill",value:mode==="whole"?0:10,until:"game"});b.run();
 if(id==="BT13-040"){const q=b.s.prompt;assert.equal(q.kind==="optionalCost"||q.kind==="chooseMode",mode==="none");if(q.kind==="optionalCost")b.take({type:"optionalCost",player:p,pay:false});else if(q.kind==="chooseMode")b.take({type:"chooseMode",player:p,index:1});}
 else assert.equal(b.events.filter(e=>e.type==="skill"&&e.card===b.incoming&&e.skill===10).length,mode==="none"?1:0);
 assert.equal(b.events.filter(e=>e.type==="move"&&e.card===b.incoming&&e.to==="energy").length,1);cases++;
}
// An unrelated Battle-only Auto never answers an Energy arrival.
for(const p of ["p1","p2"] as const){const b=printed(p,"WATCH","hand");b.run();assert.equal(b.events.some(e=>e.type==="skill"&&e.card===b.incoming),false);cases++;}
// Capture at the actual move, after payer work, not at the first optional prompt.
for(const p of ["p1","p2"] as const)for(const negateLate of [true,false]){
 const b=setup(p,true,"battle","accept");if(!negateLate)vmHost(b.c,game,b.s,[]).addEffect({target:b.incoming,kind:"negateSkill",value:20,until:"game"});
 b.take({type:"activate",player:p,card:b.s.sides[p].zones.leader[0],skill:0});b.take({type:"choose",player:p,cards:[b.incoming]});b.take({type:"chooseMode",player:p,index:0});b.take({type:"choose",player:p,cards:[b.red]});
 if(negateLate)vmHost(b.c,game,b.s,[]).addEffect({target:b.incoming,kind:"negateSkill",value:20,until:"game"});else b.s.effects=b.s.effects.filter(e=>!(e.target===b.incoming&&e.kind==="negateSkill"&&e.value===20));
 b.take({type:"choose",player:p,cards:[b.blue]});assert.equal(b.events.filter(e=>e.type==="skill"&&e.card===b.incoming&&e.skill===20).length,negateLate?0:1);assert.ok(b.s.sides[p].zones.warp.includes(b.red)&&b.s.sides[p].zones.warp.includes(b.blue));cases++;
}
console.log(`energy-arrival-negation-5: ${cases} native history controls passed`);
