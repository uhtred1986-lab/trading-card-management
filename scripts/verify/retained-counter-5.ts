/** R432: actual future-card Counter continuation prototype. */
import assert from "node:assert/strict";
import {card,fifty} from "./harness";
import {skillRecords} from "../../src/lib/arena/draft";
import {rulesFromRows,type RuleRow} from "../../src/lib/arena/rules-store";
import {RULES} from "../../src/lib/arena/vm";
import {rulesetFor} from "../../src/lib/arena/rulesets";
import {stepScript} from "../../src/lib/arena/vm/script";
import {vmHost} from "../../src/lib/arena/vm/host";
import {moveCard} from "../../src/lib/arena/vm/zones";
import type {Action,CardDef,EngineContext,PlayerId} from "../../src/lib/arena/types";
import type {VmState} from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const defs:Record<string,CardDef>={F:card("F",{}),L:card("L",{type:"LEADER"}),ENERGY:card("ENERGY",{colors:["Blue","Yellow","Black","Green","White"]}),HIGH:card("HIGH",{energyCost:6,power:40000}),SOURCE:card("SOURCE",{skill:"[Activate: Main] Choose up to 1 Battle Card from your hand and play it."})};
defs["DB2-169"]=card("DB2-169",{"name": "Geene & Martinne, Universe 12 Destroyer & Angel", "colors": ["Blue", "Yellow"], "power": 19000, "characters": ["Geene", "Martinne"], "traits": ["God", "Universe 12"], "skill": "[Counter: Play] If the Battle Card being played has an energy cost of 5 or less, negate its skills for the turn and play this card.<br>[Energy-Exhaust]<br>[Aegis Blue/Yellow][Once per turn]<br>[Auto][Once per turn] When you activate [Aegis Blue/Yellow], draw 2 cards.", "type": "BATTLE", "energyCost": 3});
defs["BT1-110"]=card("BT1-110",{"name": "Crusher Ball", "colors": ["Yellow"], "power": null, "characters": [], "traits": [], "skill": "[Counter: Play] The Battle Card played is played in Rest Mode.", "type": "EXTRA", "energyCost": 1});
defs["BT10-136"]=card("BT10-136",{"name": "Towa, Twisted Sister", "colors": ["Black"], "power": 4000, "characters": ["Towa"], "traits": ["Demon Realm Race", "Demon God"], "skill": "[Counter: Play] Play this card.<br>[Auto] When this card is played, draw 1 card, then shuffle up to 1 card from your opponent's Drop Area into their deck.", "type": "BATTLE", "energyCost": 1});
defs["DB2-040"]=card("DB2-040",{"name": "Hit, Deadly Vanguard", "colors": ["Blue"], "power": 15000, "characters": ["Hit"], "traits": ["Alien", "Universe 6"], "skill": "[Counter: Play] If the Battle Card being played has an energy cost of 5 or less, it is returned to its owner's hand instead of being played, then play this card.<br>[Permanent] During your opponent's turn, reduce the energy cost of this card in your hand by 2.<br>[Permanent] This card can't be returned to your hand by your skills.<br>[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards with an energy cost of 5 or less and return it to its owner's hand.", "type": "BATTLE", "energyCost": 5});
defs["BT29-112"]=card("BT29-112",{"name": "Hyper Meta-Rilldo, Masterpiece", "type": "BATTLE", "colors": ["White"], "power": 15000, "characters": ["General Rilldo"], "traits": ["Machine Mutant"], "skill": "[Counter: Play][Limit 1] If the Battle Card being played has an energy cost of 3 or less, place it in its owner's Drop instead of playing it, then play this card.\n[Permanent] If your life is at 4 or less and you have a Hidden Mode card, reduce the energy cost of this card in your hand by 2.\n[Auto] When this card is played, choose up to 1 of your white Battle Cards and it gets +5000 power for the turn.", "energyCost": 3});
defs["BT27-073"]=card("BT27-073",{"name": "Mercenary Tao, Confrontation", "type": "BATTLE", "colors": ["Yellow"], "power": 25000, "characters": ["Mercenary Tao"], "traits": ["Earthling", "Fierce Foe"], "skill": "[Blocker]\n[br]\n[Counter: Play][Limit 1] If your opponent's Battle Card being played has 35000 power or less, it's played in Rest Mode, then you play this card.\n[br]\n[Permanent] If your Leader is a yellow \u226aFierce Foe\u226b card and all of your energy is in Rest Mode, you can activate this card's [Counter] skill from your hand by adding 1 card from your life to your hand instead of paying its energy cost.", "energyCost": 4});
defs["BT9-027"]=card("BT9-027",{"name": "Frieza, Undying Emperor", "type": "BATTLE", "colors": ["Blue"], "power": 15000, "characters": ["Frieza"], "traits": ["Frieza Clan", "Universe 7"], "skill": "[Counter: Play] If the Battle Card being played has an energy cost of 3 or less, it is returned to its owner's hand instead of being played, then play this card.", "energyCost": 2});
defs["BT25-092"]=card("BT25-092",{"name": "Bujin, Space Pirate Psychic", "type": "BATTLE", "colors": ["Green"], "power": 4000, "characters": ["Bujin"], "traits": ["Boujack Brigade"], "skill": "[Counter: Play][Limit 1] If the Battle Card being played has an energy cost of 2 or less, place it in its owner's Drop instead of playing it, then play this card.\n[br]\n[Permanent] If you have 3 or more face-up \u226aBoujack Brigade\u226b cards in your Z-Deck, you can activate this card's [Counter] skill from your hand by adding 1 card from your life to your hand instead of paying its energy cost.", "energyCost": 1});
defs["BT11-042"]=card("BT11-042",{"name": "Baby, Golden Avenger", "type": "BATTLE", "colors": ["Blue"], "power": 30000, "characters": ["Baby"], "traits": ["Saiyan", "Machine Mutant", "Great Ape"], "skill": "[Unique][Triple Strike]<br>[Counter: Play] Play this card, then if the Battle Card being played has an energy cost of 7 or less, it's returned to its owner's hand instead of being played.<br>[Counter: Counter] Negate the [Counter] skill and play this card.<br>[Auto] When this card is played, draw 1 card, then choose up to 1 of your opponent's Battle Cards, ignoring [Barrier], and place it at the bottom of its owner's deck.", "energyCost": 5});
defs.UNISON=card("UNISON",{type:"UNISON"});
defs.SOURCEMANY=card("SOURCEMANY",{skill:"[Activate: Main] Choose up to 2 Battle Cards from your hand and play them."});
defs.SOURCEANY=card("SOURCEANY",{skill:"[Activate: Main] Choose up to 1 Unison Card from your hand and play it with 2 markers on it."});
defs.DEFLECT=card("DEFLECT",{skill:"[Deflect]"});
const rows=Object.values(defs).flatMap(skillRecords).map((r,id)=>({...r,id,source:"compiler",status:"confirmed"}) as unknown as RuleRow);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(rows),defs)};const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(ctx,copy(s),a).state as VmState;
function fresh(first:PlayerId,leader="L"){
 let s=RULES.createGame(ctx,{seed:430,p1:{name:"One",leader:first==="p1"?leader:"L",main:fifty("F")},p2:{name:"Two",leader:first==="p2"?leader:"L",main:fifty("F")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null},{type:"endMain",player:first},{type:"charge",player:other(first),card:null},{type:"endMain",player:other(first)},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);return s;
}
function stage(s:VmState,p:PlayerId,def:string,area:string){const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);return id;}
function answer(s:VmState,id:string|null){assert.equal(s.prompt.kind,"counter");return take(s,{type:"counter",player:s.prompt.player!,card:id});}
function finish(s:VmState):VmState{
 for(let n=0;n<50&&s.prompt.kind!=="main";n++){
  assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));const p=s.prompt;
  if(p.kind==="chooseCards")s=take(s,{type:"choose",player:p.player,cards:p.choice.candidates.slice(0,p.choice.min??0)});
  else {const actions=RULES.legalActions(ctx,s).map(x=>x.action),a=actions.find(a=>a.type==="payCost")??actions.find(a=>a.type==="counter"&&a.card===null)??actions.find(a=>a.type==="orderPending"&&a.index===0);assert.ok(a,JSON.stringify(p));s=take(s,a);}
 }assert.equal(s.prompt.kind,"main");return s;
}
let cases=0;
for(const owner of ["p1","p2"] as const)for(const name of ["DB2-040","DB2-169","BT9-027","BT25-092","BT27-073","BT29-112"])for(const targetDef of ["F","DEFLECT","HIGH","UNISON",null])for(const staleSource of [false,true]){
 let s=fresh(owner);const source=stage(s,owner,targetDef==="UNISON"?"SOURCEANY":"SOURCE","battle"),target=stage(s,owner,targetDef??"F","hand"),counter=stage(s,other(owner),name,"hand");for(let n=0;n<6;n++)stage(s,other(owner),"ENERGY","energy");
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source);assert.ok(action);s=take(s,action);
 assert.equal(s.prompt.kind,"counter");assert.ok(RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===counter),JSON.stringify(s.prompt));s=answer(s,counter);
 for(let n=0;n<20&&s.prompt.kind!=="chooseCards";n++){
  assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));const actions=RULES.legalActions(ctx,s).map(x=>x.action);const a=actions.find(a=>a.type==="payCost")??actions.find(a=>a.type==="counter"&&a.card===null);assert.ok(a,JSON.stringify(s.prompt));s=take(s,a);
 }
 assert.equal(s.prompt.kind,"chooseCards");assert.equal(s.prompt.player,owner);assert.equal(s.skillPlayScopes?.length,1);assert.equal(s.skillPlayScopes![0].retainedCounters?.[0].state,"waiting");
 if(owner==="p1"&&name==="DB2-040"&&targetDef==="F"&&!staleSource){
  const mutations:((saved:VmState)=>void)[]=[
   saved=>{delete saved.skillPlayScopes![0].retainedCounters![0].frame!.counterSource;},
   saved=>{saved.skillPlayScopes![0].retainedCounters![0].frame!.counterSource!.epoch=-1;},
   saved=>{saved.skillPlayScopes![0].retainedCounters!.push(copy(saved.skillPlayScopes![0].retainedCounters![0]));},
   saved=>{saved.skillPlayScopes![0].retainedCounters![0].scope!.parent=999;},
   saved=>{saved.skillPlayScopes![0].retainedCounters![0].state="running";},
   saved=>{saved.skillPlayScopes![0].retainedCounters![0]=null as never;},
  ];
  for(const mutate of mutations){const saved=copy(s);mutate(saved);const stopped=take(saved,{type:"choose",player:owner,cards:[target]});assert.match(JSON.stringify(stopped.outcome),/rebuild this/);assert.ok(!stopped.sides[other(owner)].zones.battle.includes(counter));cases++;}
 }
 if(name==="DB2-040"&&targetDef==="F"&&!staleSource){
  const canceled=copy(s);canceled.skillPlayScopes![0].canceled=true;
  const settled=finish(take(canceled,{type:"choose",player:owner,cards:[]}));assert.ok(settled.sides[other(owner)].zones.drop.includes(counter));assert.equal(settled.skillPlayScopes,undefined);cases++;
 }
 // Staged fault injection while the actual parent chooser is saved.
 if(staleSource){assert.ok(moveCard(s,game,counter,"hand").ok);assert.ok(moveCard(s,game,counter,"drop").ok);}
 s=take(copy(s),{type:"choose",player:owner,cards:targetDef?[target]:[]});s=finish(s);
 const qualifies=targetDef==="F"||targetDef==="DEFLECT";assert.equal(s.sides[other(owner)].zones.battle.includes(counter),qualifies&&!staleSource);assert.equal(s.sides[other(owner)].zones.drop.includes(counter),!qualifies||staleSource);
 assert.equal(s.sides[owner].zones.battle.includes(target),!!targetDef&&targetDef!=="UNISON"&&!(targetDef==="F"&&["DB2-040","BT9-027","BT25-092","BT29-112"].includes(name)));if(targetDef==="UNISON")assert.ok(s.sides[owner].zones.unison.includes(target));
 if(name==="BT27-073"&&targetDef==="F")assert.equal(s.cards[target].mode,"rest");
 if(name==="DB2-169"&&targetDef==="DEFLECT")assert.ok(!s.effects.some(effect=>effect.target===target&&effect.kind==="negateSkills"));
 assert.equal(s.skillPlayScopes,undefined);assert.equal(s.resolving,null);cases++;
}
for(const owner of ["p1","p2"] as const){
 let s=fresh(owner);const source=stage(s,owner,"SOURCE","battle"),target=stage(s,owner,"F","hand"),counter=stage(s,other(owner),"DB2-169","hand"),crusher=stage(s,owner,"BT1-110","hand");stage(s,owner,"ENERGY","energy");for(let n=0;n<6;n++)stage(s,other(owner),"ENERGY","energy");
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source);assert.ok(action);s=take(s,action);s=answer(s,counter);let used=false;
 for(let n=0;n<20&&s.prompt.kind!=="chooseCards";n++){
  assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));const actions=RULES.legalActions(ctx,s).map(x=>x.action);const response=actions.find(a=>a.type==="counter"&&a.card===crusher);const a=response??actions.find(a=>a.type==="payCost")??actions.find(a=>a.type==="counter"&&a.card===null);assert.ok(a,JSON.stringify(s.prompt));if(response)used=true;s=take(s,a);
 }
 assert.ok(used);assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:owner,cards:[target]});s=finish(s);assert.ok(s.sides[other(owner)].zones.battle.includes(counter));assert.equal(s.cards[counter].mode,"rest");assert.ok(s.sides[owner].zones.battle.includes(target));assert.equal(s.skillPlayScopes,undefined);cases++;
}
for(const owner of ["p1","p2"] as const){
 let s=fresh(owner);const source=stage(s,owner,"SOURCE","battle"),target=stage(s,owner,"F","hand"),counter=stage(s,other(owner),"DB2-169","hand"),negator=stage(s,owner,"BT11-042","hand");for(const p of [owner,other(owner)])for(let n=0;n<6;n++)stage(s,p,"ENERGY","energy");
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source);assert.ok(action);s=take(s,action);s=answer(s,counter);let used=false;
 for(let n=0;n<30&&!(s.prompt.kind==="chooseCards"&&s.prompt.choice.candidates.includes(target));n++){
  assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));const actions=RULES.legalActions(ctx,s).map(x=>x.action);const response=actions.find(a=>a.type==="counter"&&a.card===negator&&a.skill===20);const a=response??actions.find(a=>a.type==="payCost")??actions.find(a=>a.type==="counter"&&a.card===null);assert.ok(a,JSON.stringify(s.prompt));if(response)used=true;s=take(s,a);
 }
 assert.ok(used);assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:owner,cards:[target]});s=finish(s);assert.ok(s.sides[other(owner)].zones.drop.includes(counter));assert.ok(s.sides[owner].zones.battle.includes(negator));assert.ok(s.sides[owner].zones.battle.includes(target));assert.ok(!s.effects.some(effect=>effect.target===target&&effect.kind==="negateSkills"));assert.equal(s.skillPlayScopes,undefined);cases++;
}
for(const owner of ["p1","p2"] as const)for(const heldName of ["DB2-040","DB2-169"])for(const fault of ["none","blocked","fresh"]){
 let s=fresh(owner);const source=stage(s,owner,"SOURCE","battle"),target=stage(s,owner,"F","hand"),counter=stage(s,other(owner),heldName,"hand");stage(s,owner,"BT1-110","hand");stage(s,owner,"ENERGY","energy");for(let n=0;n<6;n++)stage(s,other(owner),"ENERGY","energy");
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source);assert.ok(action);s=take(s,action);s=answer(s,counter);
 for(let n=0;n<20&&s.prompt.kind!=="chooseCards";n++){const actions=RULES.legalActions(ctx,s).map(x=>x.action),a=actions.find(a=>a.type==="payCost")??actions.find(a=>a.type==="counter"&&a.card===null);assert.ok(a);s=take(s,a);}
 s=take(s,{type:"choose",player:owner,cards:[target]});assert.equal(s.prompt.kind,"counter");assert.equal(s.resolving?.scopeWindow?.boundary,"after");assert.ok(s.sides[other(owner)].zones.battle.includes(counter));assert.ok(s.sides[owner].zones.hand.includes(target));
 if(owner==="p1"&&heldName==="DB2-169"&&fault==="none"){
  const mutations:((resume:NonNullable<import("../../src/lib/arena/vm/script").ScriptFrame["retainedResume"]>)=>void)[]=[
   resume=>{resume.owner=999;},
   resume=>{if(resume.kind==="play")resume.cards=[counter];},
   resume=>{resume.frame.pendingArrival!.epoch=-1;},
   resume=>{resume.frame.pendingArrival!.cursor=999;},
   resume=>{resume.frame.pendingArrival!.complete="yes" as never;},
   resume=>{if(resume.kind==="play")delete resume.options.playPermission;},
  ];
  for(const mutate of mutations){const saved=copy(s),resume=saved.skillPlayScopes!.at(-1)!.window!.programs.find(frame=>frame.retainedResume)!.retainedResume!;assert.ok(resume);mutate(resume);const stopped=answer(saved,null);assert.match(JSON.stringify(stopped.outcome),/rebuild this/);assert.ok(stopped.sides[owner].zones.hand.includes(target));cases++;}
 }
 const rested=s.sides[other(owner)].zones.energy.filter(id=>s.cards[id].mode==="rest").length;assert.equal(rested,3);
 // Staged faults at a real saved child after-window: no invented activation.
 if(fault==="blocked")assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"forbid",what:"play",side:"opponent",until:"turn"}],ip:0,vars:{},card:counter,master:other(owner)}),"done");
 if(fault==="fresh"){assert.ok(moveCard(s,game,target,"drop").ok);assert.ok(moveCard(s,game,target,"hand").ok);}
 s=finish(copy(s));assert.equal(s.sides[owner].zones.battle.includes(target),fault==="none"&&heldName==="DB2-169");assert.equal(s.sides[other(owner)].zones.energy.filter(id=>s.cards[id].mode==="rest").length,rested);assert.equal(s.skillPlayScopes,undefined);cases++;
}
for(const owner of ["p1","p2"] as const){
 let s=fresh(owner);const source=stage(s,owner,"SOURCEMANY","battle"),counter=stage(s,other(owner),"DB2-040","hand");for(let n=0;n<6;n++)stage(s,other(owner),"ENERGY","energy");
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source);assert.ok(action);s=take(s,action);if(s.prompt.kind==="counter"){assert.ok(!RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===counter));s=answer(s,null);}assert.equal(s.prompt.kind,"chooseCards");assert.ok(s.sides[other(owner)].zones.hand.includes(counter));assert.ok(s.sides[other(owner)].zones.energy.every(id=>s.cards[id].mode==="active"));s=take(s,{type:"choose",player:owner,cards:[]});s=finish(s);cases++;
}
console.log(`retained-counter-5: ${cases} native future-card cases passed`);
