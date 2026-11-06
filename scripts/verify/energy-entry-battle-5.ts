/** R489: ordinary owned Battle optional entry, native actions and saved choices. */
import fixtures from "./fixtures/standing-negation-observation-5.json";
import type { Script } from "../../src/lib/arena/vm/script";
import { assertStandingNegationSettled } from "../../src/lib/arena/vm/standing-negation-transaction";
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
const defs={L:card("L",{type:"LEADER",skill:"[Activate: Main/Battle] Draw 1 card."}),F:card("F",{}),IN:card("IN",{colors:["Red","Blue"],skill:"[Energy-Exhaust]\n[Permanent] This card gets +1000 power.\n[Activate: Main/Battle] Draw 1 card."}),R:card("R",{colors:["Red"]}),B:card("B",{colors:["Blue"]}),A:card("A",{power:10000}),G:card("G",{power:100000})};
const ctx:EngineContext={defs,scripts:rulesFromRows(Object.values(defs).flatMap(skillRecords).map((row,id)=>({...row,id,status:"draft",source:"compiler"}) as unknown as RuleRow),defs)};
ctx.scripts!.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];ctx.scripts!.IN.bySkill[10].unsupported=[];
ctx.scripts!.L.bySkill[0].ops=[{op:"choose",sel:{side:"you",area:"battle",count:1},as:"incoming"},{op:"moveTo",target:{var:"incoming"},to:"energy",reveal:true},{op:"draw",n:1}];
ctx.scripts!.IN.bySkill[20].ops=[{op:"moveTo",target:{sel:{special:"self"}},to:"energy",reveal:true},{op:"draw",n:1}];
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
function stage(s:VmState,p:PlayerId,def:string,area:Area){const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);return id;}
function setup(p:PlayerId,route:"main"|"offense"|"defense"="main",self=false,choice="accept"){
 const c:EngineContext & {rulesetDefinition?:typeof game}=copy(ctx),turn=route==="defense"?other(p):p,events:GameEvent[]=[];
 if(choice==="standing"){
  c.defs.N=card("N",{skill:fixtures["DB1-066"].skill});const row=fixtures["DB1-066"].records[0];c.scripts!.N={bySkill:{0:{kind:row.kind,ops:row.ops,unsupported:row.unread,validity:row.validity,usage:row.usage} as Script},complete:true,unsupported:[]};
 }
 let s=RULES.createGame(c,{seed:489,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const take=(a:Action)=>{const before=JSON.stringify(s),r=RULES.apply(c,s,a);assert.equal(JSON.stringify(s),before);s=r.state as VmState;events.push(...r.events);assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));};
 for(const a of [{type:"chooseFirst",player:s.chooser,first:turn},{type:"mulligan",player:turn,redraw:false},{type:"mulligan",player:other(turn),redraw:false},{type:"charge",player:turn,card:null},{type:"endMain",player:turn},{type:"charge",player:other(turn),card:null},{type:"endMain",player:other(turn)},{type:"charge",player:turn,card:null}] as Action[])take(a);
 const incoming=stage(s,p,"IN","battle"),red=stage(s,p,"R","drop"),blue=stage(s,p,"B","drop"),ordinary=stage(s,p,"F","battle");stage(s,p,"R","drop");stage(s,p,"B","drop");
 const mover=self?incoming:s.sides[p].zones.leader[0],skill=self?20:0;
 if(choice==="ordinary")c.scripts!.IN.bySkill[10].ops=[];
 if(choice==="rest"){const ops=c.scripts![self?"IN":"L"].bySkill[skill].ops;const move=ops.find(op=>op.op==="moveTo")!;assert.equal(move.op,"moveTo");if(move.op==="moveTo")move.mode="rest";}
 const h=vmHost(c,game,s,[]);
 let king:string|undefined;
 if(choice==="standing"){king=stage(s,p,"N","hand");h.move(king,"battle",p);h.addEffect({target:king,source:incoming,master:p,kind:"negateSkills",value:0,until:"whileSourceInPlay"});}
 if(choice==="exhaustOnly")h.addEffect({target:incoming,kind:"negateKeyword",value:"Energy-Exhaust",until:"game"});
 h.addEffect({target:incoming,kind:"power",value:9000,until:"game"});h.addEffect({target:ordinary,source:incoming,master:p,kind:"power",value:3000,until:"whileSourceInPlay"});h.addEffect({target:ordinary,source:incoming,master:p,kind:"power",value:2000,until:"game"});
 if(choice==="whole")h.addEffect({target:incoming,kind:"negateSkills",value:0,until:"game"});
 if(choice==="line")h.addEffect({target:incoming,kind:"negateSkill",value:10,until:"game"});
 if(choice==="protected")h.addEffect({target:"",kind:"forbid",value:0,until:"game",forbid:{what:"beNegated",fromArea:"any"}});
 if(["partial","payerAttribution","payerBattleBan"].includes(choice))h.addEffect({target:red,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",fromArea:"drop",toArea:"warp",bySkill:true,...(choice==="payerAttribution"?{byTypes:["LEADER"]}:choice==="payerBattleBan"?{byTypes:["BATTLE"]}:{})}});
 const proceed=()=>{for(let n=0;n<30;n++){if(s.prompt.kind==="combo"&&s.prompt.player===p)return;const a=RULES.legalActions(c,s).map(x=>x.action).find(a=>a.type==="payCost"||a.type==="counter"&&a.card===null||a.type==="pass"||a.type==="block"&&a.card===null);assert.ok(a,JSON.stringify(s.prompt));take(a);}throw Error("no Combo prompt");};
 if(route!=="main"){const attacker=stage(s,turn,"A","battle"),guard=stage(s,other(turn),"G","battle");s.cards[guard].mode="rest";take({type:"attack",player:turn,attacker,target:guard});proceed();}
 const activate=()=>{take({type:"activate",player:p,card:mover,skill});if(s.prompt.kind==="chooseCards"&&s.prompt.choice.candidates.includes(incoming))take({type:"choose",player:p,cards:[incoming]});};
 return {c,get s(){return s;},take,activate,incoming,red,blue,ordinary,mover,events,king};
}
let cases=0;
for(const p of ["p1","p2"] as const)for(const route of ["main","offense","defense"] as const)for(const self of [false,true])for(const choice of ["accept","decline","partial","whole","line","protected","rest","payerAttribution","payerBattleBan","ordinary","exhaustOnly"]){
 if(self&&choice==="whole")continue;
 const b=setup(p,route,self,choice),epoch=b.s.cards[b.incoming].zoneEpoch??0,draws=b.events.filter(e=>e.type==="draw").length;b.activate();
 let questions=0,selected=0;
 while(b.s.prompt.kind==="chooseMode"||b.s.prompt.kind==="chooseCards"){
  questions++;assert.ok(questions<=3);assert.ok(b.s.sides[p].zones.battle.includes(b.incoming));assert.ok(b.s.effects.some(e=>e.target===b.ordinary&&e.until==="whileSourceInPlay"));
  const frame=b.s.programs.find(f=>f.energyEntry);assert.ok(frame?.energyEntry?.witness.battle);assert.equal(frame.energyEntry.witness.incoming.holder,p);assert.equal(frame.energyEntry.witness.battle.activation.kind,"activate");
  RULES.boardView(b.c,copy(b.s),p,{});RULES.boardView(b.c,copy(b.s),other(p),{});
  b.take(b.s.prompt.kind==="chooseMode"?{type:"chooseMode",player:p,index:["decline","exhaustOnly"].includes(choice)?1:0}:{type:"choose",player:p,cards:[selected++===0?b.red:b.blue]});
 }
 const earned=["accept","rest","payerAttribution"].includes(choice);
 assert.equal(questions===0,["whole","line","ordinary"].includes(choice));assert.equal(b.s.prompt.kind,route==="main"?"main":"combo");assert.ok(b.s.sides[p].zones.energy.includes(b.incoming));assert.equal(b.s.cards[b.incoming].zoneEpoch,epoch+1);assert.equal(b.s.cards[b.incoming].mode,["whole","exhaustOnly"].includes(choice)||earned&&choice!=="rest"?"active":"rest");assert.equal(hasKeyword(b.c,game,b.s,b.incoming,"Energy-Exhaust"),!earned);
 assert.equal(b.s.effects.some(e=>e.target===b.incoming&&e.kind!=="negateKeyword"),false);assert.equal(b.s.effects.some(e=>e.target===b.ordinary&&e.until==="whileSourceInPlay"),false);assert.ok(b.s.effects.some(e=>e.target===b.ordinary&&e.until==="game"));
 assert.equal(b.events.filter(e=>e.type==="draw").length,draws+1,"original parent tail resolves once, including self after departure");assert.equal(b.events.filter(e=>e.type==="move"&&e.card===b.incoming&&e.to==="energy").length,1);
 if(choice==="partial"||choice==="payerBattleBan"){assert.ok(b.s.sides[p].zones.drop.includes(b.red));assert.ok(b.s.sides[p].zones.warp.includes(b.blue));}
 if(earned){const stamp=b.s.effects.find(e=>e.target===b.incoming&&e.energyEntryEpoch!==undefined);assert.ok(stamp);assert.equal(stamp.master,p);assert.equal(stamp.source,b.incoming);assert.equal(stamp.energyEntryEpoch,epoch+1);vmHost(b.c,game,b.s,[]).move(b.incoming,"warp",p);assert.equal(b.s.effects.some(e=>e.target===b.incoming&&e.energyEntryEpoch!==undefined),false);}
 cases++;
}
// Every optional choice retains source occurrence/holder and the original effect.
for(const p of ["p1","p2"] as const)for(const route of ["main","offense","defense"] as const)for(const self of [false,true]){
 const b=setup(p,route,self);b.activate();
 for(let question=0;question<3;question++){
  const action:Action=question===0?{type:"chooseMode",player:p,index:0}:{type:"choose",player:p,cards:[question===1?b.red:b.blue]};
  const faults:Record<string,(s:VmState)=>void>={
   sourceABA:s=>{s.cards[b.incoming].zoneEpoch=(s.cards[b.incoming].zoneEpoch??0)+2;},sourceFace:s=>{s.cards[b.incoming].flipped=true;},sourceHidden:s=>{s.cards[b.incoming].hidden=true;},sourceHiddenABA:s=>{s.cards[b.incoming].hiddenCount=(s.cards[b.incoming].hiddenCount??0)+2;},
   sourceOwner:s=>{s.cards[b.incoming].owner=other(p);},sourceHolder:s=>{s.sides[p].zones.battle=s.sides[p].zones.battle.filter(id=>id!==b.incoming);s.sides[other(p)].zones.battle.push(b.incoming);},
   sourceZ:s=>{s.cards[b.incoming].zCard=true;},sourceStack:s=>{s.sides[p].zones.drop=s.sides[p].zones.drop.filter(id=>id!==b.red);s.cards[b.incoming].under.push(b.red);},
   missingOrigin:s=>{delete s.programs.find(f=>f.energyEntry)!.skillEffectOrigin;},forgedOrigin:s=>{s.programs.find(f=>f.energyEntry)!.skillEffectOrigin={version:2,kind:"counter"};},oldOrigin:s=>{s.programs.find(f=>f.energyEntry)!.skillEffectOrigin={version:1,kind:"activate"};},
   copiedParent:s=>{s.programs.find(f=>f.energyEntry)!.skillIndex=100000;},missingScope:s=>{delete s.programs.find(f=>f.energyEntry)!.energyEntry!.witness.battle;},forgedScope:s=>{s.programs.find(f=>f.energyEntry)!.energyEntry!.witness.battle!.activation.kind="auto";},
  };
  if(question===2)faults.payerABA=s=>{s.cards[b.red].zoneEpoch=(s.cards[b.red].zoneEpoch??0)+2;};
  for(const [label,mutate] of Object.entries(faults)){
   const bad=copy(b.s);mutate(bad);const before=JSON.stringify(bad);
   try{const r=RULES.apply(b.c,bad,action);assert.equal(r.state.outcome?.kind,"interrupted",label);assert.equal(r.events.some(e=>e.type==="move"),false,label);}catch(error){assert.match(String(error),/Energy|Battle|payer|available/,label);}
   assert.equal(JSON.stringify(bad),before,label);cases++;
  }
  b.take(action);
 }
}
function teach(c:EngineContext,id:string,skill:string){c.defs[id]=card(id,{...(id==="IN"?c.defs.IN:{}),skill});const rows=skillRecords(c.defs[id]);assert.ok(rows.every(row=>row.unread.length===0),JSON.stringify(rows));c.scripts![id]=rulesFromRows(rows.map((row,id)=>({...row,id,status:"draft",source:"compiler"}) as unknown as RuleRow),c.defs)[id];}
function finish(b:ReturnType<typeof setup>,p:PlayerId){let selected=0;for(let n=0;n<30;n++){
 if(b.s.prompt.kind==="chooseMode")b.take({type:"chooseMode",player:p,index:0});
 else if(b.s.prompt.kind==="chooseCards")b.take({type:"choose",player:p,cards:[selected++===0?b.red:b.blue]});
 else if(b.s.prompt.kind==="orderPending")b.take({type:"orderPending",player:b.s.prompt.player,index:0});
 else return;
}throw Error("unfinished native entry");}
const movementAutos="\n[Auto] When this card is removed from your Battle Area by a skill, draw 1 card.\n[Auto] When this card is placed in your energy, draw 1 card.";
for(const p of ["p1","p2"] as const)for(const mode of ["accept","decline","whole","line","arrivalNegated","ordinary"]){
 const b=setup(p,"main",false,mode);teach(b.c,"W","[Auto] When one of your Battle Cards with 15000 power or more is removed from your Battle Area by a skill, draw 1 card.");const watcher=stage(b.s,p,"W","battle");
 teach(b.c,"WO","[Auto] When one of your opponent's Battle Cards with 15000 power or more is removed from a Battle Area by a skill, draw 1 card.");const opponentWatcher=stage(b.s,other(p),"WO","battle");
 teach(b.c,"NO","[Auto][Once per turn] When one of your Battle Cards with 20000 power or more is removed from your Battle Area by a skill, draw 1 card.");const nonmatching=stage(b.s,p,"NO","battle");
 teach(b.c,"IN",defs.IN.skill+movementAutos);b.c.scripts!.IN.bySkill[10].ops=mode==="ordinary"?[]:[{op:"energyEntryExhaust",colors:["Red","Blue"]}];b.c.scripts!.IN.bySkill[10].unsupported=[];
 if(mode==="arrivalNegated")vmHost(b.c,game,b.s,[]).addEffect({target:b.incoming,kind:"negateSkill",value:40,until:"game"});
 const draws=b.events.filter(e=>e.type==="draw").length;b.activate();
 if(mode==="decline")b.take({type:"chooseMode",player:p,index:1});
 else {if(b.s.prompt.kind==="chooseMode")b.take({type:"chooseMode",player:p,index:0});if(b.s.prompt.kind==="chooseCards"){b.take({type:"choose",player:p,cards:[b.red]});b.take({type:"choose",player:p,cards:[b.blue]});}}
 if(mode!=="whole"){assert.equal(b.s.prompt.kind,"orderPending",mode);
 assert.equal(b.s.pending.filter(x=>x.card===watcher).length,1);assert.equal(b.s.pending.filter(x=>x.card===opponentWatcher).length,1);assert.equal(b.s.pending.some(x=>x.card===nonmatching),false);assert.deepEqual(b.s.cards[nonmatching].usedThisTurn,[]);
 for(const w of [watcher,opponentWatcher]){const pending=b.s.pending.find(x=>x.card===w);assert.ok(pending&&"subjectInfo" in pending);assert.equal(pending.subjectInfo?.power,19000);assert.equal(pending.master,w===watcher?p:other(p));}
 assert.equal(b.s.pending.filter(x=>x.card===b.incoming&&x.skillIndex===30).length,mode==="whole"?0:1);
 assert.equal(b.s.pending.filter(x=>x.card===b.incoming&&x.skillIndex===40).length,["whole","arrivalNegated"].includes(mode)?0:1);
 }
 assert.deepEqual(b.s.cards[nonmatching].usedThisTurn,[]);
 finish(b,p);assert.equal(b.events.filter(e=>e.type==="draw").length-draws,mode==="whole"?3:mode==="arrivalNegated"?4:5);
 // A real later occurrence is not swallowed by the synchronous alias receipt.
 vmHost(b.c,game,b.s,[]).move(b.incoming,"battle",p);vmHost(b.c,game,b.s,[]).addEffect({target:b.incoming,kind:"power",value:12000,until:"game"});
 for(const payer of [b.red,b.blue])vmHost(b.c,game,b.s,[]).move(payer,"drop",p);
 b.activate();finish(b,p);assert.equal(b.s.cards[nonmatching].usedThisTurn.filter(i=>i===0).length,1);assert.equal(b.events.filter(e=>e.type==="move"&&e.card===b.incoming&&e.to==="energy").length,2);cases++;
}
// A genuine Auto body moves its own attacker, then continues after departure.
for(const p of ["p1","p2"] as const){
 const b=setup(p);teach(b.c,"IN",defs.IN.skill+"\n[Auto] When this card attacks, draw 1 card.");b.c.scripts!.IN.bySkill[10].ops=[{op:"energyEntryExhaust",colors:["Red","Blue"]}];b.c.scripts!.IN.bySkill[10].unsupported=[];b.c.scripts!.IN.bySkill[30].ops=[{op:"moveTo",target:{sel:{special:"self"}},to:"energy"},{op:"draw",n:1}];
 const guard=stage(b.s,other(p),"G","battle");b.s.cards[guard].mode="rest";const draws=b.events.filter(e=>e.type==="draw").length;b.take({type:"attack",player:p,attacker:b.incoming,target:guard});
 for(let n=0;b.s.prompt.kind!=="chooseMode"&&n<15;n++){const a=RULES.legalActions(b.c,b.s).map(x=>x.action).find(a=>a.type==="counter"&&a.card===null||a.type==="block"&&a.card===null||a.type==="pass");assert.ok(a,JSON.stringify(b.s.prompt));b.take(a);}
 assert.equal(b.s.programs.find(f=>f.energyEntry)?.energyEntry?.witness.battle?.activation.kind,"auto");finish(b,p);assert.ok(b.s.sides[p].zones.energy.includes(b.incoming));assert.equal(b.events.filter(e=>e.type==="draw").length,draws+1);cases++;
}
// Actual optional entry observes the new standing generation after source cleanup.
for(const p of ["p1","p2"] as const){const b=setup(p,"main",false,"standing"),serial=b.s.standingNegationHistory!.nextSerial;b.activate();finish(b,p);assert.ok(b.s.sides[p].zones.energy.includes(b.incoming));assert.equal(b.s.cards[b.incoming].mode,"active");assert.ok(b.s.standingNegationHistory!.nextSerial>serial);assert.ok(b.s.standingNegationHistory!.active.some(x=>x.source.card===b.king));assertStandingNegationSettled(b.c,b.s);cases++;}
// Area and candidate-mode protection disagreements remain explicit refusals.
for(const p of ["p1","p2"] as const)for(const variant of ["battleOnly","energyOnly","activeOnly","restOnly","sourceDuration"] as const){
 const b=setup(p),h=vmHost(b.c,game,b.s,[]);
 h.addEffect({target:variant==="sourceDuration"?b.incoming:"",source:b.incoming,master:p,kind:"forbid",value:0,until:variant==="sourceDuration"?"whileSourceInPlay":"game",forbid:{what:"beNegated",...(variant==="battleOnly"?{fromArea:"battle" as const}:variant==="energyOnly"?{fromArea:"energy" as const}:{}),...(["activeOnly","restOnly"].includes(variant)?{unless:{kind:"count" as const,sel:{special:"self" as const,mode:variant==="activeOnly"?"rest" as const:"active" as const},atLeast:1}}:{})}});
 b.activate();b.take({type:"chooseMode",player:p,index:0});b.take({type:"choose",player:p,cards:[b.red]});const before=JSON.stringify(b.s);
 const stopped=RULES.apply(b.c,b.s,{type:"choose",player:p,cards:[b.blue]});assert.equal(stopped.state.outcome?.kind,"interrupted",variant);assert.match(stopped.state.outcome?.privateContext?.detail??"",/protection changes/);assert.equal(stopped.events.some(e=>e.type==="move"&&e.card===b.incoming&&e.to==="energy"),false);assert.equal(JSON.stringify(b.s),before);cases++;
}
// Opponent's ordinary skill preserves the original controller and skill actor.
// R491: the owner now decides the optional procedure under an opposing mover.
for(const owner of ["p1","p2"] as const)for(const variant of ["ordinary","whole","arrivalNegated","optional"]){
 const actor=other(owner),b=setup(actor,"main",false,variant);
 b.s.cards[b.incoming].owner=owner;assert.ok(moveCard(b.s,game,b.incoming,"battle",{owner,carry:true}).ok);
 const choice=b.c.scripts!.L.bySkill[0].ops[0];assert.equal(choice.op,"choose");if(choice.op==="choose")choice.sel.side="opponent";
 teach(b.c,"IN",defs.IN.skill+movementAutos+"\n[Auto] When this card is removed from your Battle Area by an opponent's skill, draw 1 card.");b.c.scripts!.IN.bySkill[10].ops=variant==="optional"?[{op:"energyEntryExhaust",colors:["Red","Blue"]}]:[];b.c.scripts!.IN.bySkill[10].unsupported=[];
 if(variant==="arrivalNegated")vmHost(b.c,game,b.s,[]).addEffect({target:b.incoming,kind:"negateSkill",value:40,until:"game"});
 const start=b.events.length;
 if(variant==="optional"){
  b.activate();if(b.s.prompt.kind==="chooseMode"){assert.equal(b.s.prompt.player,owner);b.take({type:"chooseMode",player:owner,index:1});}finish(b,owner);assert.ok(b.s.sides[owner].zones.energy.includes(b.incoming));assert.ok(b.s.sides[actor].zones.drop.includes(b.red));assert.ok(b.s.sides[actor].zones.drop.includes(b.blue));
 }else{
  b.activate();if(variant!=="whole"){assert.equal(b.s.prompt.kind,"orderPending");assert.ok(b.s.pending.every(x=>x.card!==b.incoming||x.master===owner));assert.equal(b.s.pending.filter(x=>x.card===b.incoming&&x.skillIndex===50).length,1);}
  finish(b,owner);const draws=b.events.slice(start).filter(e=>e.type==="draw");assert.equal(draws.filter(e=>e.player===actor).length,1);assert.equal(draws.filter(e=>e.player===owner).length,variant==="whole"?0:variant==="arrivalNegated"?2:3);assert.ok(b.s.sides[owner].zones.energy.includes(b.incoming));
 }cases++;
}
// Initial native admission refuses structural/specialized routes before payment.
for(const p of ["p1","p2"] as const)for(const fault of ["hidden","stack","zCard","zType","token","loan","cost","replacement","batch","owner"]){
 const b=setup(p);b.take({type:"activate",player:p,card:b.mover,skill:0});assert.equal(b.s.prompt.kind,"chooseCards");
 if(fault==="hidden")b.s.cards[b.incoming].hidden=true;
 if(fault==="stack"){b.s.sides[p].zones.drop=b.s.sides[p].zones.drop.filter(id=>id!==b.red);b.s.cards[b.incoming].under.push(b.red);}
 if(fault==="zCard")b.s.cards[b.incoming].zCard=true;
 if(fault==="zType")b.c.defs.IN.type="Z-BATTLE";
 if(fault==="token")b.c.defs.IN.type="TOKEN";
 if(fault==="loan")vmHost(b.c,game,b.s,[]).addEffect({target:b.incoming,kind:"control",value:0,until:"turn",control:{from:p}});
 if(fault==="owner")b.s.cards[b.incoming].owner=other(p);
 if(fault==="replacement")vmHost(b.c,game,b.s,[]).addEffect({target:b.incoming,source:b.incoming,master:p,kind:"replaceLeave",value:{target:{special:"self"},by:"skill",to:"deck"},until:"game"});
 const f=b.s.programs.at(-1)!;if(fault==="cost"){const move=f.ops.find(op=>op.op==="moveTo")!;if(move.op==="moveTo")move.cause="cost";}
 if(fault==="batch"){const move=f.ops.find(op=>op.op==="moveTo")!;if(move.op==="moveTo")move.target={sel:{side:"you",area:"battle",count:99}};}
 const before=JSON.stringify(b.s);
 try{const r=RULES.apply(b.c,b.s,{type:"choose",player:p,cards:[b.incoming]});assert.equal(r.state.outcome?.kind,"interrupted",fault);assert.equal(r.events.some(e=>e.type==="move"),false,fault);}catch(error){assert.match(String(error),/Energy|Battle|available|choice/i,fault);}
 assert.equal(JSON.stringify(b.s),before);cases++;
}
// A queued watched departure keeps old attributes after another actual move.
for(const p of ["p1","p2"] as const){
 const b=setup(p);teach(b.c,"HISTORY","[Auto] When one of your Battle Cards with 15000 power or more is removed from your Battle Area by a skill, draw 1 card.");const watchers=[stage(b.s,p,"HISTORY","battle"),stage(b.s,p,"HISTORY","battle")];
 b.activate();b.take({type:"chooseMode",player:p,index:0});b.take({type:"choose",player:p,cards:[b.red]});b.take({type:"choose",player:p,cards:[b.blue]});assert.equal(b.s.prompt.kind,"orderPending");
 const prior=b.s.cards[b.incoming].zoneEpoch??0;vmHost(b.c,game,b.s,[]).move(b.incoming,"warp",p);assert.equal(b.s.cards[b.incoming].zoneEpoch,prior+1);
 for(const watcher of watchers){const pending=b.s.pending.find(x=>x.card===watcher);assert.ok(pending&&"subjectInfo" in pending);assert.equal(pending.subjectInfo?.power,19000);}
 const draws=b.events.filter(e=>e.type==="draw").length;finish(b,p);assert.equal(b.events.filter(e=>e.type==="draw").length,draws+2);cases++;
}
// A prohibited original move produces no departure/arrival or alias receipt.
for(const p of ["p1","p2"] as const)for(const descriptor of [true,false]){
 const b=setup(p);teach(b.c,"IN",defs.IN.skill+movementAutos);b.c.scripts!.IN.bySkill[10].ops=descriptor?[{op:"energyEntryExhaust",colors:["Red","Blue"]}]:[];b.c.scripts!.IN.bySkill[10].unsupported=[];
 vmHost(b.c,game,b.s,[]).addEffect({target:b.incoming,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",fromArea:"battle",toArea:"energy",bySkill:true}});
 const draws=b.events.filter(e=>e.type==="draw").length;b.activate();assert.equal(b.s.prompt.kind,"main");assert.ok(b.s.sides[p].zones.battle.includes(b.incoming));assert.equal(b.events.filter(e=>e.type==="draw").length,draws+1);assert.equal(b.events.some(e=>e.type==="move"&&e.card===b.incoming&&e.to==="energy"),false);assert.ok(b.s.sides[p].zones.drop.includes(b.red));assert.ok(b.s.sides[p].zones.drop.includes(b.blue));cases++;
}
// A copied parent is refused at initial optional admission, never mid-payment.
for(const p of ["p1","p2"] as const){
 const b=setup(p);vmHost(b.c,game,b.s,[]).addEffect({target:b.mover,kind:"copiedSkills",value:0,until:"game",copied:{cardId:"L",side:"front",skills:[0]}});const copied=skillsShowing(b.c,b.s,b.mover).skills.find(sk=>sk.index>=100000);assert.ok(copied);
 b.take({type:"activate",player:p,card:b.mover,skill:copied.index});const r=RULES.apply(b.c,b.s,{type:"choose",player:p,cards:[b.incoming]});assert.equal(r.state.outcome?.kind,"interrupted");assert.equal(r.events.some(e=>e.type==="move"),false);assert.ok(r.state.sides[p].zones.drop.includes(b.red));assert.ok(r.state.sides[p].zones.drop.includes(b.blue));cases++;
}
// Incoming copied/quoted-granted scripts need historical departure capture;
// bound them out initially and at every saved child question before any payer moves.
for(const p of ["p1","p2"] as const)for(const quoted of [false,true])for(const question of [-1,0,1,2]){
 const b=setup(p);teach(b.c,"AUTO","[Auto] When this card is placed in your energy, draw 1 card.");
 b.c.defs.GRANT=card("GRANT",{skill:'[Activate: Main] This card gains the following skill for the turn-\n"[Auto] When this card is placed in your energy, draw 1 card."'});
 b.c.scripts!.GRANT={bySkill:{10:copy(b.c.scripts!.AUTO.bySkill[0])},complete:false,unsupported:["grant body fixture"]};
 if(question>=0){b.activate();if(question>=1)b.take({type:"chooseMode",player:p,index:0});if(question>=2)b.take({type:"choose",player:p,cards:[b.red]});}
 else b.take({type:"activate",player:p,card:b.mover,skill:0});
 vmHost(b.c,game,b.s,[]).addEffect({target:b.incoming,master:p,kind:"copiedSkills",value:0,until:"game",copied:{cardId:quoted?"GRANT":"AUTO",side:"front",skills:[quoted?10:0],...(quoted?{quoted:true}:{})}});
 assert.ok(skillsShowing(b.c,b.s,b.incoming).skills.some(sk=>sk.index>=100000&&sk.kind==="auto"));
 const action:Action=question<0?{type:"choose",player:p,cards:[b.incoming]}:question===0?{type:"chooseMode",player:p,index:0}:{type:"choose",player:p,cards:[question===1?b.red:b.blue]};
 const before=JSON.stringify(b.s),r=RULES.apply(b.c,b.s,action);assert.equal(r.state.outcome?.kind,"interrupted");assert.equal(r.events.some(e=>e.type==="move"),false);assert.equal(JSON.stringify(b.s),before);cases++;
}
for(const p of ["p1","p2"] as const){const b=setup(p);vmHost(b.c,game,b.s,[]).addEffect({target:b.incoming,kind:"keyword",value:{name:"Barrier"},until:"game"});b.activate();finish(b,p);assert.ok(b.s.sides[p].zones.energy.includes(b.incoming));assert.equal(b.s.cards[b.incoming].mode,"active");assert.equal(hasKeyword(b.c,game,b.s,b.incoming,"Barrier"),false);cases++;}
// Suppressing the optional Permanent cannot bypass copied-source history refusal.
for(const p of ["p1","p2"] as const)for(const kind of ["negateSkill","negateSkills"] as const){
 const b=setup(p);teach(b.c,"COPYAUTO","[Auto] When this card is placed in your energy, draw 1 card.");
 const h=vmHost(b.c,game,b.s,[]);h.addEffect({target:b.incoming,master:p,kind:"copiedSkills",value:0,until:"game",copied:{cardId:"COPYAUTO",side:"front",skills:[0]}});h.addEffect({target:b.incoming,kind,value:kind==="negateSkill"?10:0,until:"game"});
 b.take({type:"activate",player:p,card:b.mover,skill:0});const before=JSON.stringify(b.s),r=RULES.apply(b.c,b.s,{type:"choose",player:p,cards:[b.incoming]});assert.equal(r.state.outcome?.kind,"interrupted");assert.equal(r.events.some(e=>e.type==="move"),false);assert.match(r.state.outcome?.privateContext?.detail??"",/copied movement-skill history/);assert.equal(JSON.stringify(b.s),before);
 assert.throws(()=>vmHost(b.c,game,b.s,[]).move(b.incoming,"energy",p),/copied movement-skill history/);assert.equal(JSON.stringify(b.s),before);cases++;
}
console.log(`energy-entry-battle-5: ${cases} native Battle entry cases passed`);
