/** R486: native plain Combo Energy entry; synthetic runtime descriptors only. */
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
import { skillsShowing } from "../../src/lib/arena/vm/triggers";
import { hasKeyword } from "../../src/lib/arena/vm/program";
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
 if(mode==="arrivalAttribution"){
  c.defs.IN.skill+="\n[Auto] When this card is placed in your energy, draw 1 card.";
  c.scripts!.IN=rulesFromRows(skillRecords(c.defs.IN).map((row,id)=>({...row,id,status:"draft",source:"compiler"}) as unknown as RuleRow),c.defs).IN;
  c.scripts!.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];c.scripts!.IN.bySkill[10].unsupported=[];
 }
 if(mode==="rest")c.scripts!.L.bySkill[0].ops[1]={op:"moveTo",target:{var:"incoming"},to:"energy",mode:"rest",reveal:true};
 if(mode==="ordinary")c.scripts!.IN.bySkill[10].ops=[];
 let s=RULES.createGame(c,{seed:486,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 if(mode==="arrivalAttribution"){const pinned=copy(game);pinned.triggers.placedInEnergy.on.args.by="skill";pinned.triggers.placedInEnergy.on.args.viaCard=s.sides[p].zones.leader[0];c.rulesetDefinition=pinned;}
 const take=(a:Action)=>{const before=JSON.stringify(s),result=RULES.apply(c,s,a);assert.equal(JSON.stringify(s),before);s=result.state as VmState;events.push(...result.events);assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));};
 const proceed=(end=false)=>{for(let n=0;n<40;n++){if(end?s.prompt.kind==="main":s.prompt.kind==="combo"&&s.prompt.player===p)return;const a=RULES.legalActions(c,s).map(x=>x.action).find(a=>a.type==="payCost"||a.type==="counter"&&a.card===null||a.type==="pass"||a.type==="block"&&a.card===null||a.type==="zEnergyFromCombo"&&a.card===null);assert.ok(a,JSON.stringify(s.prompt));take(a);}throw Error("no destination");};
 for(const a of [{type:"chooseFirst",player:s.chooser,first:turn},{type:"mulligan",player:turn,redraw:false},{type:"mulligan",player:other(turn),redraw:false},{type:"charge",player:turn,card:null},{type:"endMain",player:turn},{type:"charge",player:other(turn),card:null},{type:"endMain",player:other(turn)},{type:"charge",player:turn,card:null}] as Action[])take(a);
 const incoming=stage(s,p,"IN",origin),red=stage(s,p,"R","drop"),blue=stage(s,p,"B","drop");stage(s,p,"R","drop");stage(s,p,"B","drop");
 const extra=[stage(s,p,"C","hand"),stage(s,p,"D","battle")],attacker=stage(s,turn,"A","battle"),guard=stage(s,other(turn),"G","battle");s.cards[guard].mode="rest";
 const h=vmHost(c,game,s,[]);
 if(mode==="whole")h.addEffect({target:incoming,kind:"negateSkills",value:0,until:"game"});
 if(mode==="line")h.addEffect({target:incoming,kind:"negateSkill",value:10,until:"game"});
 if(mode==="protected")h.addEffect({target:"",kind:"forbid",value:0,until:"game",forbid:{what:"beNegated",fromArea:"any"}});
 if(["partial","payerAttribution","payerBattleBan"].includes(mode))h.addEffect({target:red,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",fromArea:"drop",toArea:"warp",bySkill:true,...(mode==="payerAttribution"?{byTypes:["LEADER"]}:mode==="payerBattleBan"?{byTypes:["BATTLE"]}:{})}});
 take({type:"attack",player:turn,attacker,target:guard});proceed();
 for(const id of [incoming,...extra]){take({type:"combo",player:p,card:id});proceed();}
 return {c,get s(){return s;},take,proceed,incoming,red,blue,extra,events,attacker,guard};
}
let cases=0;
for(const p of ["p1","p2"] as const)for(const offense of [true,false])for(const origin of ["hand","battle"] as const)for(const mode of ["accept","decline","partial","protected","whole","line","ordinary","rest","arrivalAttribution","payerAttribution","payerBattleBan"]){
 const b=setup(p,offense,origin,mode),epoch=b.s.cards[b.incoming].zoneEpoch??0,otherCards=copy(b.extra.map(id=>b.s.cards[id])),draws=b.events.filter(e=>e.type==="draw").length;
 assert.equal(b.s.battle!.comboOrigins![b.incoming],origin);
 if(mode==="whole"||mode==="line")assert.equal(b.s.effects.some(e=>e.target===b.incoming),origin==="battle","Battle-to-Combo carries negation; ordinary Hand-to-Combo resets it");
 b.take({type:"activate",player:p,card:b.s.sides[p].zones.leader[0],skill:0});b.take({type:"choose",player:p,cards:[b.incoming]});
 let questions=0,selected=0;
 while(b.s.prompt.kind==="chooseMode"||b.s.prompt.kind==="chooseCards"){
  questions++;assert.ok(questions<=3);assert.ok(b.s.sides[p].zones.combo.includes(b.incoming));assert.deepEqual(b.extra.map(id=>b.s.cards[id]),otherCards);
  assert.equal(b.s.battle!.comboOrigins![b.extra[0]],"hand");assert.equal(b.s.battle!.comboOrigins![b.extra[1]],"battle");
  RULES.boardView(b.c,copy(b.s),p,{});RULES.boardView(b.c,copy(b.s),other(p),{});
  b.take(b.s.prompt.kind==="chooseMode"?{type:"chooseMode",player:p,index:mode==="decline"?1:0}:{type:"choose",player:p,cards:[selected++===0?b.red:b.blue]});
 }
 assert.equal(questions===0,mode==="ordinary"||origin==="battle"&&["whole","line"].includes(mode));assert.equal(b.s.prompt.kind,"combo");
 if(origin==="hand"&&["whole","line"].includes(mode)){assert.equal(questions,3);assert.equal(selected,2);assert.ok([b.red,b.blue].every(id=>b.s.sides[p].zones.warp.includes(id)));}
 assert.ok(b.s.sides[p].zones.energy.includes(b.incoming));assert.equal(b.s.cards[b.incoming].zoneEpoch,epoch+1);
 const earned=["accept","rest","arrivalAttribution","payerAttribution"].includes(mode)||origin==="hand"&&["whole","line"].includes(mode);
 assert.equal(b.s.cards[b.incoming].mode,earned&&mode!=="rest"||mode==="whole"?"active":"rest");assert.equal(hasKeyword(b.c,game,b.s,b.incoming,"Energy-Exhaust"),!earned);
 assert.equal(b.s.battle!.comboOrigins?.[b.incoming],undefined);assert.deepEqual(b.extra.map(id=>b.s.cards[id]),otherCards);
 if(mode==="partial"||mode==="payerBattleBan"){assert.ok(b.s.sides[p].zones.drop.includes(b.red));assert.ok(b.s.sides[p].zones.warp.includes(b.blue));}
 if(mode==="arrivalAttribution")assert.equal(b.events.filter(e=>e.type==="draw").length,draws+1,"one original-source-qualified arrival Auto");
 b.proceed(true);
 const compare=b.events.find(e=>e.type==="powerCompare");assert.ok(compare&&compare.type==="powerCompare");assert.equal(compare.attackPower,offense?14000:19000);assert.equal(compare.guardPower,offense?18000:15000);assert.equal(compare.hit,!offense);
 assert.ok(b.extra.every(id=>b.s.sides[p].zones.drop.includes(id)));assert.ok(b.s.sides[p].zones.energy.includes(b.incoming));assert.equal(b.events.filter(e=>e.type==="move"&&e.card===b.incoming&&e.to==="energy").length,1);
 if(earned){const stamp=b.s.effects.find(e=>e.target===b.incoming&&e.energyEntryEpoch!==undefined);assert.ok(stamp);assert.equal(stamp.source,b.incoming);assert.equal(stamp.master,p);assert.equal(stamp.energyEntryEpoch,epoch+1);vmHost(b.c,game,b.s,[]).move(b.incoming,"warp",p);assert.equal(b.s.effects.some(e=>e.target===b.incoming&&e.energyEntryEpoch!==undefined),false);}
 cases++;
}
// Independent control: keeping the 5000 Combo power reverses the real result.
for(const p of ["p1","p2"] as const)for(const offense of [true,false]){
 const b=setup(p,offense,"hand");b.proceed(true);const compare=b.events.find(e=>e.type==="powerCompare");assert.ok(compare&&compare.type==="powerCompare");assert.equal(compare.attackPower,offense?19000:19000);assert.equal(compare.guardPower,offense?18000:20000);assert.equal(compare.hit,offense);cases++;
}
// All three child questions retain exact battle, flow and physical occurrence facts.
for(const p of ["p1","p2"] as const)for(const offense of [true,false])for(const origin of ["hand","battle"] as const){
 const b=setup(p,offense,origin);b.take({type:"activate",player:p,card:b.s.sides[p].zones.leader[0],skill:0});b.take({type:"choose",player:p,cards:[b.incoming]});
 for(let question=0;question<3;question++){
  const action:Action=question===0?{type:"chooseMode",player:p,index:0}:{type:"choose",player:p,cards:[question===1?b.red:b.blue]};
  const mutations:Record<string,(s:VmState)=>void>={
   absent:s=>{delete s.battle;},step:s=>{s.battle!.step="damage";},negated:s=>{s.battle!.negated=true;},
   skipped:s=>{s.battle!.skipped=[offense?"offense":"defense"];},damage:s=>{s.battle!.damage={} as NonNullable<VmState["battle"]>["damage"];},markerLoss:s=>{s.battle!.markerLoss={remaining:1,lost:0};},guardKo:s=>{s.battle!.guardKo={};},
   turn:s=>{s.turn++;},turnPlayer:s=>{s.turnPlayer=other(s.turnPlayer);},attacker:s=>{s.battle!.attacker=s.sides[p].zones.leader[0];},guard:s=>{s.battle!.guard=s.sides[other(p)].zones.leader[0];},target:s=>{s.battle!.target=b.incoming;},
   attackEpoch:s=>{s.cards[b.attacker].zoneEpoch=(s.cards[b.attacker].zoneEpoch??0)+2;},guardEpoch:s=>{s.cards[b.guard].zoneEpoch=(s.cards[b.guard].zoneEpoch??0)+2;},attackCount:s=>{s.cards[b.attacker].attacksThisTurn!++;},
   flowIndex:s=>{s.flow.at(-1)!.index++;},flowRepeat:s=>{s.flow.at(-1)!.repeats++;},flowReask:s=>{s.flow.at(-1)!.reask=false;},flowDepth:s=>{s.flow.unshift(copy(s.flow[0]));},flowAsking:s=>{s.flow.at(-1)!.asking=[other(p)];},
   sourceEpoch:s=>{s.cards[b.incoming].zoneEpoch=(s.cards[b.incoming].zoneEpoch??0)+2;},sourceFace:s=>{s.cards[b.incoming].flipped=true;},sourceHolder:s=>{s.sides[p].zones.combo=s.sides[p].zones.combo.filter(id=>id!==b.incoming);s.sides[other(p)].zones.combo.push(b.incoming);},sourceOwner:s=>{s.cards[b.incoming].owner=other(p);},
   origin:s=>{s.battle!.comboOrigins![b.incoming]="other";},missingOrigin:s=>{delete s.battle!.comboOrigins![b.incoming];},via:s=>{(s.battle!.comboVia??={})[b.incoming]=b.red;},
   missingActivation:s=>{delete s.programs.find(f=>f.energyEntry)!.skillEffectOrigin;},forgedActivation:s=>{s.programs.find(f=>f.energyEntry)!.skillEffectOrigin={version:2,kind:"auto"};},oldActivation:s=>{s.programs.find(f=>f.energyEntry)!.skillEffectOrigin={version:1,kind:"activate"};},copiedActivation:s=>{s.programs.find(f=>f.energyEntry)!.skillIndex=100000;},
   savedScope:s=>{s.programs.find(f=>f.energyEntry)!.energyEntry!.witness.combo!.attacker.attacks++;},missingScope:s=>{delete s.programs.find(f=>f.energyEntry)!.energyEntry!.witness.combo;},
  };
  for(const stage of ["choices","checkpoint","cleanup","preDropCheckpoint","departures","battleEndCheckpoint"] as const)mutations[`endCombo/${stage}`]=s=>{s.battle!.endCombo={stage} as NonNullable<VmState["battle"]>["endCombo"];};
  if(question===2)mutations.payerEpoch=s=>{s.cards[b.red].zoneEpoch=(s.cards[b.red].zoneEpoch??0)+2;};
  for(const [label,mutate] of Object.entries(mutations)){
   const bad=copy(b.s);mutate(bad);const before=JSON.stringify(bad);
   try{const result=RULES.apply(b.c,bad,action);assert.equal(result.state.outcome?.kind,"interrupted",label);assert.equal(result.events.some(e=>e.type==="move"),false,label);assert.ok(result.state.sides[p].zones.drop.includes(b.red));assert.ok(result.state.sides[p].zones.drop.includes(b.blue));}
   catch(error){assert.match(String(error),/Combo|Energy|payer|available/,label);}
   assert.equal(JSON.stringify(bad),before,label);cases++;
  }
  b.take(action);
 }
}
// Initial preflight refuses end-of-battle cleanup and unproved provenance,
// before offering or spending either optional payer.
for(const p of ["p1","p2"] as const)for(const offense of [true,false]){
 const b=setup(p,offense,"hand");b.take({type:"activate",player:p,card:b.s.sides[p].zones.leader[0],skill:0});
 const faults:Record<string,(s:VmState)=>void>={
  missingActivation:s=>{delete s.programs.at(-1)!.skillEffectOrigin;},forgedActivation:s=>{s.programs.at(-1)!.skillEffectOrigin={version:2,kind:"auto"};},oldActivation:s=>{s.programs.at(-1)!.skillEffectOrigin={version:1,kind:"activate"};},copiedActivation:s=>{s.programs.at(-1)!.skillIndex=100000;},
  phase:s=>{s.phase="main";},nearbyStep:s=>{s.battle!.step="damage";},hidden:s=>{s.cards[b.incoming].hidden=true;},stack:s=>{s.sides[p].zones.drop=s.sides[p].zones.drop.filter(id=>id!==b.red);s.cards[b.incoming].under.push(b.red);},missingOrigin:s=>{delete s.battle!.comboOrigins![b.incoming];},
 };
 for(const origin of ["other","drop","deck","warp","zEnergy"] as const)faults[origin]=s=>{s.battle!.comboOrigins![b.incoming]=origin;};
 for(const stage of ["choices","checkpoint","cleanup","preDropCheckpoint","departures","battleEndCheckpoint"] as const)faults[stage]=s=>{s.battle!.endCombo={stage} as NonNullable<VmState["battle"]>["endCombo"];};
 for(const [label,mutate] of Object.entries(faults)){
  const bad=copy(b.s);mutate(bad);const before=JSON.stringify(bad);
  const result=RULES.apply(b.c,bad,{type:"choose",player:p,cards:[b.incoming]});assert.equal(result.state.outcome?.kind,"interrupted",label);assert.equal(result.events.some(e=>e.type==="move"),false);assert.equal(JSON.stringify(bad),before);if(label!=="stack")assert.ok(result.state.sides[p].zones.drop.includes(b.red));assert.ok(result.state.sides[p].zones.drop.includes(b.blue));cases++;
 }
}
// Copied parent activations are explicitly unadmitted before payer movement.
for(const p of ["p1","p2"] as const)for(const offense of [true,false]){
 const b=setup(p,offense,"hand"),leader=b.s.sides[p].zones.leader[0];
 vmHost(b.c,game,b.s,[]).addEffect({target:leader,kind:"copiedSkills",value:0,until:"game",copied:{cardId:"L",side:"front",skills:[0]}});
 const copied=skillsShowing(b.c,b.s,leader).skills.find(sk=>sk.index>=100000);assert.ok(copied);
 b.take({type:"activate",player:p,card:leader,skill:copied.index});
 const result=RULES.apply(b.c,copy(b.s),{type:"choose",player:p,cards:[b.incoming]});assert.equal(result.state.outcome?.kind,"interrupted");assert.equal(result.events.some(e=>e.type==="move"),false);assert.ok(result.state.sides[p].zones.drop.includes(b.red));assert.ok(result.state.sides[p].zones.drop.includes(b.blue));cases++;
}
// An ordinary activated parent continues after its source leaves and is negated.
for(const p of ["p1","p2"] as const)for(const offense of [true,false]){
 const b=setup(p,offense,"battle");b.c.defs.CAST=card("CAST",{skill:defs.L.skill});b.c.scripts!.CAST=copy(b.c.scripts!.L);
 const caster=stage(b.s,p,"CAST","battle");b.take({type:"activate",player:p,card:caster,skill:0});b.take({type:"choose",player:p,cards:[b.incoming]});assert.equal(b.s.prompt.kind,"chooseMode");
 const h=vmHost(b.c,game,b.s,[]);h.move(caster,"drop",p);h.addEffect({target:caster,kind:"negateSkills",value:0,until:"game"});
 b.take({type:"chooseMode",player:p,index:0});b.take({type:"choose",player:p,cards:[b.red]});b.take({type:"choose",player:p,cards:[b.blue]});assert.ok(b.s.sides[p].zones.energy.includes(b.incoming));assert.equal(b.s.cards[b.incoming].mode,"active");assert.ok(b.s.sides[p].zones.drop.includes(caster));cases++;
}
console.log(`energy-entry-combo-5: ${cases} native Combo cases passed`);
