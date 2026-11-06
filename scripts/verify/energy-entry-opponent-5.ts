/** R491: frozen P-656 text/Auto; structural Counter and zero-combo-cost fixtures. */
import assert from "node:assert/strict";
import fixtures from "./fixtures/played-combo-end-5.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
import { requireEnergyEntryPayers } from "../../src/lib/arena/vm/energy-entry-payers";
import { hasKeyword } from "../../src/lib/arena/vm/program";
import type { Action, CardDef, Color, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const printed=fixtures["P-656#10"],whis=printed.card;
const defs:Record<string,CardDef>={L:card("L",{type:"LEADER",colors:["Blue"],characters:["Whis"]}),F:card("F",{}),BLUE:card("BLUE",{colors:["Blue"]}),YELLOW:card("YELLOW",{colors:["Yellow"]}),R:card("R",{colors:["Red"]}),B:card("B",{colors:["Blue"]}),A:card("A",{energyCost:0,power:10000}),G:card("G",{power:100000}),
 IN:card("IN",{colors:["Red","Blue"],skill:"[Energy-Exhaust]\n[Permanent] This card gets +1000 power.\n[Barrier]\n[Auto] When this card is removed from your Battle Area by an opponent's skill, draw 1 card.\n[Auto] When this card is placed in your energy, draw 1 card."}),
 WRONGCOLOR:card("WRONGCOLOR",{type:"LEADER",colors:["Red"],characters:["Whis"]}),WRONGCHAR:card("WRONGCHAR",{type:"LEADER",colors:["Blue"],characters:["Son Goku"]}),
 CAST:card("CAST",{skill:"[Activate: Main] Choose up to 1 of your opponent's Battle Cards, ignoring [Barrier], and add it to its owner's energy."}),
 COUNTER:card("COUNTER",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] Choose up to 1 Battle Card from your hand and play it."}),
 "P-656":card("P-656",{name:whis.name,colors:whis.colors as Color[],characters:whis.characters,traits:whis.traits,skill:whis.skill,energyCost:2,power:whis.power,comboCost:0}),
};
const records=Object.values(defs).flatMap(skillRecords),actual=records.find(r=>r.cardId==="P-656"&&r.skillIndex===10)!;
for(const key of ["printed","trigger","combo","cost","usage","validity"] as const)assert.deepEqual(actual[key],printed.record[key]);assert.deepEqual(JSON.parse(JSON.stringify(actual.ops)),printed.expectedOps);assert.deepEqual(actual.cond,printed.expectedCond);assert.deepEqual(actual.unread,[]);
const ctx:EngineContext={defs,scripts:rulesFromRows(records.map((r,id)=>({...r,id,status:"draft",source:"compiler"}) as unknown as RuleRow),defs)};ctx.scripts!.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];ctx.scripts!.IN.bySkill[10].unsupported=[];
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
type Lane="main"|"counter"|"offense"|"defense";
function stage(s:VmState,p:PlayerId,def:string,area:string){const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);s.cards[id].mode="active";return id;}
function setup(mover:PlayerId,lane:Lane="main",mode="accept"){
 const c=copy(ctx),owner=other(mover),turn=lane==="main"||lane==="offense"?mover:owner,events:GameEvent[]=[];
 let s=RULES.createGame(c,{seed:491,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const take=(a:Action)=>{const before=JSON.stringify(s),saved=copy(s),r=RULES.apply(c,saved,a);assert.equal(JSON.stringify(s),before);assert.equal(JSON.stringify(saved),before);s=r.state as VmState;events.push(...r.events);assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));};
 for(const a of [{type:"chooseFirst",player:s.chooser,first:turn},{type:"mulligan",player:turn,redraw:false},{type:"mulligan",player:other(turn),redraw:false},{type:"charge",player:turn,card:null},{type:"endMain",player:turn},{type:"charge",player:other(turn),card:null},{type:"endMain",player:other(turn)},{type:"charge",player:turn,card:null}] as Action[])take(a);
 s.sides.p1.attrs.energyMarkers=0;s.sides.p2.attrs.energyMarkers=0;
 const parent=stage(s,mover,"P-656","hand"),incoming=stage(s,owner,"IN","battle"),blue=stage(s,mover,"BLUE","energy"),yellow=stage(s,mover,"YELLOW","energy"),redPayer=stage(s,owner,"R","drop"),bluePayer=stage(s,owner,"B","drop");stage(s,owner,"R","drop");stage(s,owner,"B","drop");const foreign=[stage(s,mover,"R","drop"),stage(s,mover,"B","drop")];
 const h=vmHost(c,game,s,[]);h.addEffect({target:incoming,kind:"power",value:9000,until:"game"});
 if(mode==="whole")h.addEffect({target:incoming,kind:"negateSkills",value:0,until:"game"});if(mode==="line")h.addEffect({target:incoming,kind:"negateSkill",value:10,until:"game"});
 if(mode==="partial")h.addEffect({target:redPayer,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",fromArea:"drop",toArea:"warp",bySkill:true}});
 if(mode==="protected")h.addEffect({target:"",kind:"forbid",value:0,until:"game",forbid:{what:"beNegated",fromArea:"any"}});
 if(["payerOtherActor","payerOwnerActor","payerSource"].includes(mode))h.addEffect({target:redPayer,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",fromArea:"drop",toArea:"warp",bySkill:true,...(mode==="payerSource"?{exceptSource:{name:defs.IN.name}}:{player:mode==="payerOtherActor"?mover:owner})}});
 if(mode==="originalSource")h.addEffect({target:incoming,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",fromArea:"battle",toArea:"energy",bySkill:true,exceptSource:{name:whis.name}}});
 if(mode==="negationOpponent"||mode==="negationOwner")h.addEffect({target:"",kind:"forbid",value:0,until:"game",forbid:{what:"beNegated",fromArea:"any",player:mode==="negationOpponent"?mover:owner}});
 if(mode==="refused")h.addEffect({target:incoming,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",fromArea:"battle",toArea:"energy",bySkill:true}});
 const advance=(stop:(s:VmState)=>boolean)=>{for(let n=0;n<100;n++){if(stop(s))return;const q=s.prompt;let a:Action|undefined;
  if(q.kind==="chooseCards")a={type:"choose",player:q.player,cards:q.choice.candidates.includes(parent)?[parent]:[]};
  else if(q.kind==="optionalCost")a={type:"optionalCost",player:q.player,pay:true};
  else if(q.kind==="orderPending")a={type:"orderPending",player:q.player,index:s.pendingOrder!.candidates[0]};
  else if(q.kind==="combo")a={type:"pass",player:q.player};else if(q.kind==="zEnergyFromCombo")a={type:"zEnergyFromCombo",player:q.player,card:null};
  else {const legal=RULES.legalActions(c,s).map(x=>x.action);a=legal.find(x=>x.type==="counter"&&x.card===null)??legal.find(x=>x.type==="block"&&x.card===null)??legal.find(x=>x.type==="chooseMode"&&x.index===0)??legal.find(x=>x.type==="payCost")??legal.find(x=>x.type==="pass");}
  assert.ok(a,JSON.stringify(q));take(a);
 }throw Error("advance bound");};
 const start=()=>{
  if(lane==="main")take({type:"activate",player:mover,card:parent,skill:20});
  else if(lane==="counter"){const counter=stage(s,mover,"COUNTER","hand"),play=stage(s,owner,"A","hand");take({type:"play",player:owner,card:play});assert.equal(s.prompt.kind,"counter");take({type:"counter",player:mover,card:counter});}
  else {const attacker=stage(s,turn,"A","battle"),guard=stage(s,other(turn),"G","battle");s.cards[guard].mode="rest";take({type:"attack",player:turn,attacker,target:guard});advance(s=>s.prompt.kind==="combo"&&s.prompt.player===mover);take({type:"combo",player:mover,card:parent});}
 };
 const begin=(select=true)=>{start();
  advance(s=>s.prompt.kind==="chooseCards"&&s.prompt.player===mover&&s.prompt.choice.candidates.includes(incoming));
  assert.equal(s.cards[yellow].mode,"rest","real Yellow Auto cost paid");assert.equal(s.cards[blue].mode,lane==="main"?"rest":"active","printed Blue self-play cost is independent");
  if(select)take({type:"choose",player:mover,cards:[incoming]});
 };
 return {c,get s(){return s;},take,advance,start,begin,mover,owner,parent,incoming,blue,yellow,redPayer,bluePayer,foreign,events};
}
let cases=0;
for(const mover of ["p1","p2"] as const)for(const lane of ["main","counter","offense","defense"] as const)for(const mode of ["accept","decline","partial","whole","line","protected","refused","payerOtherActor","payerOwnerActor","payerSource","originalSource","negationOpponent","negationOwner","parentLeaves"]){
 const b=setup(mover,lane,mode),epoch=b.s.cards[b.incoming].zoneEpoch??0,draws=b.events.filter(e=>e.type==="draw"&&e.player===mover).length;b.begin();let question=0,selected=0;
 while(b.s.programs.some(f=>f.energyEntry)){
  if(mode==="parentLeaves"&&question===0){const h=vmHost(b.c,game,b.s,[]);h.move(b.parent,"warp",mover);h.addEffect({target:b.parent,kind:"negateSkills",value:0,until:"game"});}
  const parent=b.s.programs.find(f=>f.energyEntry)!;assert.equal(parent.master,mover);assert.equal(parent.card,b.parent);assert.equal(parent.energyEntry!.child.master,b.owner);assert.equal(parent.energyEntry!.child.card,b.incoming);assert.equal("player" in b.s.prompt?b.s.prompt.player:undefined,b.owner);assert.ok(b.s.sides[b.owner].zones.battle.includes(b.incoming));assert.ok(question++<3);
  const q=b.s.prompt;assert.ok(q.kind==="chooseMode"||q.kind==="chooseCards");if(q.kind==="chooseCards")assert.ok(b.foreign.every(id=>!q.choice.candidates.includes(id)));
  const action:Action=q.kind==="chooseMode"?{type:"chooseMode",player:b.owner,index:mode==="decline"?1:0}:{type:"choose",player:b.owner,cards:[selected++===0?b.redPayer:b.bluePayer]};
  const before=JSON.stringify(b.s);assert.throws(()=>RULES.apply(b.c,b.s,{...action,player:mover}),/player|turn|answer|choice|prompt|decision/i);assert.equal(JSON.stringify(b.s),before);RULES.boardView(b.c,copy(b.s),mover,{});RULES.boardView(b.c,copy(b.s),b.owner,{});b.take(action);
 }
 b.advance(s=>s.prompt.kind==="main"||s.prompt.kind==="charge");
 assert.equal(b.events.filter(e=>e.type==="draw"&&e.player===mover).length,draws+1,"Whis original draw happens once");
 assert.equal(question===0,["whole","line","refused"].includes(mode));assert.ok(b.foreign.every(id=>b.s.sides[mover].zones.drop.includes(id)));assert.equal(b.events.filter(e=>e.type==="skill"&&e.card===b.parent&&e.skill===10).length,1);
 if(mode==="refused"){assert.ok(b.s.sides[b.owner].zones.battle.includes(b.incoming));assert.ok(b.s.sides[b.owner].zones.drop.includes(b.redPayer));}else{
  assert.ok(b.s.sides[b.owner].zones.energy.includes(b.incoming));assert.equal(b.s.cards[b.incoming].mode,"rest","Whis requests Rest even when Exhaust was negated");assert.equal(b.s.cards[b.incoming].zoneEpoch,epoch+1);assert.equal(hasKeyword(b.c,game,b.s,b.incoming,"Energy-Exhaust"),!["accept","payerOtherActor","payerSource","originalSource","negationOpponent","parentLeaves"].includes(mode));assert.equal(b.events.filter(e=>e.type==="move"&&e.card===b.incoming&&e.to==="energy").length,1);
  if(["accept","payerOtherActor","payerSource","originalSource","negationOpponent","parentLeaves"].includes(mode)){const stamp=b.s.effects.find(e=>e.target===b.incoming&&e.energyEntryEpoch!==undefined);assert.ok(stamp);assert.equal(stamp.master,b.owner);assert.equal(stamp.source,b.incoming);assert.equal(stamp.energyEntryEpoch,epoch+1);}
  if(mode==="partial"||mode==="payerOwnerActor"){assert.ok(b.s.sides[b.owner].zones.drop.includes(b.redPayer));assert.ok(b.s.sides[b.owner].zones.warp.includes(b.bluePayer));}
  for(const index of [30,40])assert.equal(b.events.filter(e=>e.type==="skill"&&e.card===b.incoming&&e.skill===index&&e.master===b.owner).length,mode==="whole"?0:1);
 }cases++;
}
// Each saved owner question retains separate parent, child and source provenance.
for(const mover of ["p1","p2"] as const)for(const lane of ["main","counter","offense","defense"] as const){
 const b=setup(mover,lane);b.begin();for(let question=0;question<3;question++){
  const action:Action=question===0?{type:"chooseMode",player:b.owner,index:0}:{type:"choose",player:b.owner,cards:[question===1?b.redPayer:b.bluePayer]};
  const faults:Record<string,(s:VmState)=>void>={
   sourceABA:s=>{s.cards[b.incoming].zoneEpoch=(s.cards[b.incoming].zoneEpoch??0)+2;},sourceFace:s=>{s.cards[b.incoming].flipped=true;},sourceHidden:s=>{s.cards[b.incoming].hidden=true;},sourceOwner:s=>{s.cards[b.incoming].owner=mover;},
   sourceHolder:s=>{s.sides[b.owner].zones.battle=s.sides[b.owner].zones.battle.filter(id=>id!==b.incoming);s.sides[mover].zones.battle.push(b.incoming);},
   parentMaster:s=>{s.programs.find(f=>f.energyEntry)!.master=b.owner;},childMaster:s=>{s.programs.find(f=>f.energyEntry)!.energyEntry!.child.master=mover;},destination:s=>{s.programs.find(f=>f.energyEntry)!.energyEntry!.witness.destination.player=mover;},
   savedHolder:s=>{s.programs.find(f=>f.energyEntry)!.energyEntry!.witness.incoming.holder=mover;},parentSkill:s=>{s.programs.find(f=>f.energyEntry)!.skillIndex=20;},
  };
  if(question===1)faults.firstOfferHolder=s=>{s.sides[b.owner].zones.drop=s.sides[b.owner].zones.drop.filter(id=>id!==b.redPayer);s.sides[mover].zones.drop.push(b.redPayer);};
  if(question===2)faults.secondOfferHolder=s=>{s.sides[b.owner].zones.drop=s.sides[b.owner].zones.drop.filter(id=>id!==b.bluePayer);s.sides[mover].zones.drop.push(b.bluePayer);};
  if(question===2){faults.payerABA=s=>{s.cards[b.redPayer].zoneEpoch=(s.cards[b.redPayer].zoneEpoch??0)+2;};faults.payerHolder=s=>{s.sides[b.owner].zones.drop=s.sides[b.owner].zones.drop.filter(id=>id!==b.redPayer);s.sides[mover].zones.drop.push(b.redPayer);};}
  for(const [label,mutate] of Object.entries(faults)){
   const bad=copy(b.s);mutate(bad);const before=JSON.stringify(bad);let result:ReturnType<typeof RULES.apply>|undefined;
   try{result=RULES.apply(b.c,bad,action);}catch(error){assert.match(String(error),/Energy|Battle|payer|available|original/i,label);}
   if(result){assert.equal(result.state.outcome?.kind,"interrupted",label);assert.equal(result.events.some(e=>e.type==="move"),false,label);}
   assert.equal(JSON.stringify(bad),before,label);cases++;
  }
  b.take(action);
 }
}
// Mandatory location support and opposite-owner cards physically in the owner's Drop.
for(const mover of ["p1","p2"] as const){
 const b=setup(mover);b.begin();const parent=b.s.programs.find(f=>f.energyEntry)!;
 assert.throws(()=>requireEnergyEntryPayers({...vmHost(b.c,game,b.s,[]),energyEntryLocation:undefined},parent.energyEntry!.child,parent.energyEntry!.payers),/payer occurrence history/);cases++;
 const bad=copy(b.s),foreign=b.foreign[0];bad.sides[mover].zones.drop=bad.sides[mover].zones.drop.filter(id=>id!==foreign);bad.sides[b.owner].zones.drop.push(foreign);const before=JSON.stringify(bad);
 const r=RULES.apply(b.c,bad,{type:"chooseMode",player:b.owner,index:0});assert.equal(r.state.outcome?.kind,"interrupted");assert.equal(r.events.some(e=>e.type==="move"),false);assert.equal(JSON.stringify(bad),before);cases++;
}
// The original frozen Auto still requires its Blue Whis Leader and Yellow price.
for(const mover of ["p1","p2"] as const)for(const lane of ["main","counter"] as const)for(const fault of ["wrongColor","wrongCharacter","noYellow","declineAuto"]){
 const b=setup(mover,lane);if(fault==="wrongColor")b.s.cards[b.s.sides[mover].zones.leader[0]].cardId="WRONGCOLOR";if(fault==="wrongCharacter")b.s.cards[b.s.sides[mover].zones.leader[0]].cardId="WRONGCHAR";if(fault==="noYellow")b.s.cards[b.yellow].cardId="BLUE";
 const draws=b.events.filter(e=>e.type==="draw"&&e.player===mover).length;b.start();
 if(fault==="declineAuto"){
  b.advance(s=>s.prompt.kind==="optionalCost"||s.prompt.kind==="chooseMode"&&s.prompt.reason==="Pay this Auto skill's cost?");
  const q=b.s.prompt;assert.ok(q.kind==="optionalCost"||q.kind==="chooseMode");assert.equal(q.player,mover);b.take(q.kind==="optionalCost"?{type:"optionalCost",player:mover,pay:false}:{type:"chooseMode",player:mover,index:1});
 }
 b.advance(s=>s.prompt.kind==="main"||s.prompt.kind==="charge");assert.ok(b.s.sides[b.owner].zones.battle.includes(b.incoming));assert.equal(b.events.filter(e=>e.type==="draw"&&e.player===mover).length,draws,`${mover}/${lane}/${fault}`);assert.equal(b.s.programs.some(f=>f.energyEntry),false);cases++;
}
// Structural and special movement exclusions remain before optional owner payment.
for(const mover of ["p1","p2"] as const)for(const fault of ["hidden","stack","zCard","owner","loan","copied","replacement","cost"]){
 const b=setup(mover);b.begin(false);
 if(fault==="hidden")b.s.cards[b.incoming].hidden=true;
 if(fault==="stack"){b.s.sides[b.owner].zones.drop=b.s.sides[b.owner].zones.drop.filter(id=>id!==b.redPayer);b.s.cards[b.incoming].under.push(b.redPayer);}
 if(fault==="zCard")b.s.cards[b.incoming].zCard=true;if(fault==="owner")b.s.cards[b.incoming].owner=mover;
 if(fault==="loan")vmHost(b.c,game,b.s,[]).addEffect({target:b.incoming,kind:"control",value:0,until:"turn",control:{from:mover}});
 if(fault==="copied")vmHost(b.c,game,b.s,[]).addEffect({target:b.incoming,kind:"copiedSkills",value:0,until:"game",copied:{cardId:"IN",side:"front",skills:[40]}});
 if(fault==="replacement")vmHost(b.c,game,b.s,[]).addEffect({target:b.incoming,source:b.incoming,master:b.owner,kind:"replaceLeave",value:{target:{special:"self"},by:"skill",to:"deck"},until:"game"});
 if(fault==="cost"){const op=b.s.programs.at(-1)!.ops.find(op=>op.op==="moveTo")!;assert.equal(op.op,"moveTo");if(op.op==="moveTo")op.cause="cost";}
 const before=JSON.stringify(b.s);let r:ReturnType<typeof RULES.apply>|undefined;
 try{r=RULES.apply(b.c,b.s,{type:"choose",player:mover,cards:[b.incoming]});}catch(error){assert.match(String(error),/Energy|Battle|available|choice/i);}
 if(r){if(fault!=="hidden")assert.equal(r.state.outcome?.kind,"interrupted",fault);else assert.ok(r.state.sides[b.owner].zones.battle.includes(b.incoming));assert.equal(r.events.some(e=>e.type==="move"),false,fault);}
 assert.equal(JSON.stringify(b.s),before);cases++;
}
// An ordinary opposing Activate without explicit Rest exposes the mode difference.
for(const mover of ["p1","p2"] as const)for(const accept of [true,false]){
 const b=setup(mover),caster=stage(b.s,mover,"CAST","battle");assert.deepEqual(b.c.scripts!.CAST.bySkill[0].unsupported,[]);b.take({type:"activate",player:mover,card:caster,skill:0});b.take({type:"choose",player:mover,cards:[b.incoming]});assert.equal("player" in b.s.prompt?b.s.prompt.player:undefined,b.owner);
 b.take({type:"chooseMode",player:b.owner,index:accept?0:1});if(accept){b.take({type:"choose",player:b.owner,cards:[b.redPayer]});b.take({type:"choose",player:b.owner,cards:[b.bluePayer]});}b.advance(s=>s.prompt.kind==="main");
 assert.equal(b.s.cards[b.incoming].mode,accept?"active":"rest");assert.equal(hasKeyword(b.c,game,b.s,b.incoming,"Energy-Exhaust"),!accept);const stamp=b.s.effects.find(e=>e.target===b.incoming&&e.energyEntryEpoch!==undefined);assert.equal(!!stamp,accept);if(stamp){assert.equal(stamp.master,b.owner);assert.equal(stamp.source,b.incoming);}cases++;
}
// The real opposing Auto preserves old Battle information through owner questions.
for(const mover of ["p1","p2"] as const)for(const lane of ["main","counter","offense","defense"] as const){
 const b=setup(mover,lane);b.c.defs.WATCH=card("WATCH",{skill:"[Auto] When one of your Battle Cards with 15000 power or more is removed from your Battle Area by an opponent's skill, draw 1 card."});const rows=skillRecords(b.c.defs.WATCH);assert.ok(rows.every(r=>!r.unread.length));b.c.scripts!.WATCH=rulesFromRows(rows.map((r,id)=>({...r,id,status:"draft",source:"compiler"}) as unknown as RuleRow),b.c.defs).WATCH;const watcher=stage(b.s,b.owner,"WATCH","battle");
 b.begin();b.take({type:"chooseMode",player:b.owner,index:0});b.take({type:"choose",player:b.owner,cards:[b.redPayer]});b.take({type:"choose",player:b.owner,cards:[b.bluePayer]});assert.equal(b.s.prompt.kind,"orderPending");const pending=b.s.pending.find(x=>x.card===watcher);assert.ok(pending&&"subjectInfo" in pending);assert.equal(pending.master,b.owner);assert.equal(pending.subjectInfo?.power,19000);
 vmHost(b.c,game,b.s,[]).move(b.incoming,"warp",b.owner);assert.equal(b.s.effects.some(e=>e.target===b.incoming&&e.energyEntryEpoch!==undefined),false);assert.equal(hasKeyword(b.c,game,b.s,b.incoming,"Energy-Exhaust"),true);b.advance(s=>s.prompt.kind==="main"||s.prompt.kind==="charge");assert.equal(b.events.filter(e=>e.type==="skill"&&e.card===watcher&&e.master===b.owner).length,1);cases++;
}
// Owner-relative payer replacement is detected before either payer moves.
for(const mover of ["p1","p2"] as const){
 const b=setup(mover);vmHost(b.c,game,b.s,[]).addEffect({target:b.redPayer,source:b.redPayer,master:b.owner,kind:"replaceLeave",value:{target:{special:"self"},by:"skill",bySide:"you",to:"deck",optional:true},until:"game"});b.begin();b.take({type:"chooseMode",player:b.owner,index:0});b.take({type:"choose",player:b.owner,cards:[b.redPayer]});const before=JSON.stringify(b.s),r=RULES.apply(b.c,b.s,{type:"choose",player:b.owner,cards:[b.bluePayer]});assert.equal(r.state.outcome?.kind,"interrupted");assert.match(r.state.outcome?.privateContext?.detail??"",/payer replacement/);assert.equal(r.events.some(e=>e.type==="move"),false);assert.equal(JSON.stringify(b.s),before);cases++;
}
console.log(`energy-entry-opponent-5: ${cases} native opposing-mover controls passed`);
