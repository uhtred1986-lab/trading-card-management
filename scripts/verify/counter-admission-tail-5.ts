/** R433: activation gates remain paid while a Counter awaits its incoming card. */
import assert from "node:assert/strict";
import {card,fifty} from "./harness";
import {correctSkillText} from "../../src/lib/catalog/errata";
import {skillRecords} from "../../src/lib/arena/draft";
import {rulesFromRows,type RuleRow} from "../../src/lib/arena/rules-store";
import {RULES} from "../../src/lib/arena/vm";
import {rulesetFor} from "../../src/lib/arena/rulesets";
import type {CostRecord} from "../../src/lib/arena/vm/script";
import {counterEffectOps} from "../../src/lib/arena/vm/counter-admission";
import {storedPaidAdmission,paidAdmissionBody} from "../../src/lib/arena/vm/paid-admission";
import {moveCard} from "../../src/lib/arena/vm/zones";
import type {Action,CardDef,EngineContext,PlayerId} from "../../src/lib/arena/types";
import type {VmState} from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const reordered=(x:unknown):unknown=>Array.isArray(x)?x.map(reordered):x&&typeof x==="object"?Object.fromEntries(Object.entries(x).reverse().map(([key,value])=>[key,reordered(value)])):x;
const defs:Record<string,CardDef>={F:card("F",{}),L:card("L",{type:"LEADER"}),VEGITO:card("VEGITO",{type:"LEADER",characters:["Vegito"]}),GREEN:card("GREEN",{type:"LEADER",colors:["Green"]}),YELLOW:card("YELLOW",{type:"LEADER",colors:["Yellow"]}),UG:card("UG",{type:"UNISON",colors:["Green"]}),UY:card("UY",{type:"UNISON",colors:["Yellow"]}),ENERGY:card("ENERGY",{colors:["Red","Blue","Yellow","Black","Green","White"]}),HIGH:card("HIGH",{energyCost:6,power:40000}),SOURCE:card("SOURCE",{skill:"[Activate: Main] Choose up to 1 Battle Card from your hand and play it."})};
defs["EX13-04"]=card("EX13-04",{"name": "Vegeta, Resolve Renewed", "type": "BATTLE", "colors": ["Red"], "power": 10000, "characters": ["Vegeta"], "traits": ["Saiyan"], "skill": "[counter: play] If the Battle Card being played has 15000 power or less, it is placed in its owner's Drop Area instead of being played, then play this card.<br>[permanent] If you have 3 or more energy, reduce the energy cost of this card in your deck and hand by 2.<br>[activate: main]{r}, if your Leader Card is a <Vegito> card and you add 1 card from your life to your hand: Play this card from your hand.", "energyCost": 3});
defs["BT10-082"]=card("BT10-082",{"name": "Dodoria, Brimming with Power", "type": "BATTLE", "colors": ["Green"], "power": 5000, "characters": ["Dodoria"], "traits": ["Frieza's Army"], "skill": "[Counter: Play] If your Leader Card is mono-green and you have a green Unison Card in play: If the Battle Card being played has an energy cost of 2 or less, it's placed in its owner's Drop Area instead of being played, then play this card.", "energyCost": 1});
defs["BT10-113"]=card("BT10-113",{"name": "Bulma, Devoted Supporter", "type": "BATTLE", "colors": ["Yellow"], "power": 1000, "characters": ["Bulma: GT"], "traits": ["Earthling"], "skill": "[Counter: Play] If your Leader Card is mono-yellow and you have a yellow Unison Card in play: If the Battle Card being played has an energy cost of 2 or less, it has its skills negated for the turn before being played, then play this card.", "energyCost": 1});
defs.CRUSHER=card("CRUSHER",{type:"EXTRA",colors:["Yellow"],skill:"[Counter: Play] The Battle Card played is played in Rest Mode."});
const rawDefs=copy(defs);
for(const def of Object.values(defs))def.skill=correctSkillText(def.id,def.skill);
const rows=Object.values(defs).flatMap(skillRecords).map((r,id)=>({...r,cond:reordered(r.cond),id,source:"compiler",status:"confirmed"}) as unknown as RuleRow);
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
function prepared(owner:PlayerId,name:string,targetDef="F",gate="valid"){
 let s=fresh(owner);const responder=other(owner);s.cards[s.sides[responder].zones.leader[0]].cardId=gate==="wrongLeader"?"L":name==="EX13-04"?"VEGITO":name==="BT10-082"?"GREEN":"YELLOW";
 if(name!=="EX13-04"&&gate!=="noUnison"){const unison=stage(s,responder,gate==="wrongUnison"?(name==="BT10-082"?"UY":"UG"):name==="BT10-082"?"UG":"UY","unison");s.cards[unison].markers=2;}
 const source=stage(s,owner,"SOURCE","battle"),target=stage(s,owner,targetDef,"hand"),counter=stage(s,responder,name,"hand");for(let n=0;n<6;n++)stage(s,responder,"ENERGY","energy");
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source);assert.ok(action);s=take(s,action);return {s,source,target,counter,responder};
}
function untilChoice(s:VmState){for(let n=0;n<20&&s.prompt.kind!=="chooseCards";n++){assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));const actions=RULES.legalActions(ctx,s).map(x=>x.action),a=actions.find(a=>a.type==="payCost")??actions.find(a=>a.type==="counter"&&a.card===null);assert.ok(a,JSON.stringify(s.prompt));s=take(s,a);}assert.equal(s.prompt.kind,"chooseCards");return s;}
for(const owner of ["p1","p2"] as const)for(const name of ["EX13-04","BT10-082","BT10-113"])for(const targetDef of ["F","HIGH",null])for(const removeGate of [false,true]){
 const p=prepared(owner,name,targetDef??"F");let s=p.s;assert.equal(s.prompt.kind,"counter");assert.ok(RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===p.counter),`${name} should be offered with its admission gate`);
 s=untilChoice(answer(s,p.counter));
 if(targetDef==="F"&&!removeGate){
  const frame=s.skillPlayScopes![0].retainedCounters![0].frame!;assert.ok(frame.counterAdmission);frame.counterAdmission.condition=reordered(frame.counterAdmission.condition) as typeof frame.counterAdmission.condition;
  const legacy=copy(s);delete legacy.skillPlayScopes![0].retainedCounters![0].frame!.counterAdmission;const stopped=take(legacy,{type:"choose",player:owner,cards:[p.target]});assert.match(JSON.stringify(stopped.outcome),/rebuild this saved Counter admission witness/);cases++;
 }

 if(removeGate){s.cards[s.sides[p.responder].zones.leader[0]].cardId="L";for(const id of [...s.sides[p.responder].zones.unison])assert.ok(moveCard(s,game,id,"drop").ok);}
 s=take(s,{type:"choose",player:owner,cards:targetDef?[p.target]:[]});s=finish(s);assert.equal(s.sides[p.responder].zones.battle.includes(p.counter),targetDef==="F");assert.equal(s.skillPlayScopes,undefined);cases++;
}
for(const owner of ["p1","p2"] as const)for(const name of ["EX13-04","BT10-082","BT10-113"])for(const gate of name==="EX13-04"?["wrongLeader"]:["wrongLeader","noUnison","wrongUnison"]){
 const p=prepared(owner,name,"F",gate);let s=p.s;assert.ok(!RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===p.counter),`${name} ${gate}`);assert.ok(s.sides[p.responder].zones.hand.includes(p.counter));assert.ok(s.sides[p.responder].zones.energy.every(id=>s.cards[id].mode==="active"));s=untilChoice(s);s=finish(take(s,{type:"choose",player:owner,cards:[p.target]}));cases++;
}
for(const owner of ["p1","p2"] as const)for(const name of ["EX13-04","BT10-082","BT10-113"]){
 const p=prepared(owner,name);let s=untilChoice(answer(p.s,null));s=take(s,{type:"choose",player:owner,cards:[p.target]});assert.equal(s.resolving?.scopeWindow?.boundary,"after");s=finish(answer(s,p.counter));assert.ok(s.sides[p.responder].zones.drop.includes(p.counter));assert.ok(s.sides[owner].zones.battle.includes(p.target));cases++;
}
for(const owner of ["p1","p2"] as const)for(const name of ["EX13-04","BT10-082","BT10-113"]){
 const p=prepared(owner,name);let s=p.s;stage(s,owner,"CRUSHER","hand");stage(s,owner,"ENERGY","energy");s=answer(s,p.counter);
 while(s.prompt.kind==="payCost"){const pay=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="payCost");assert.ok(pay);s=take(s,pay);}
 assert.equal(s.prompt.kind,"counter");assert.equal(s.skillPlayScopes?.length,2);assert.equal(s.skillPlayScopes!.at(-1)!.phase,"before");assert.ok(s.sides[p.responder].zones.drop.includes(p.counter));
 // Change only the already-paid gate at a real native response window.
 s.cards[s.sides[p.responder].zones.leader[0]].cardId="L";for(const id of [...s.sides[p.responder].zones.unison])assert.ok(moveCard(s,game,id,"drop").ok);
 s=untilChoice(answer(s,null));s=take(s,{type:"choose",player:owner,cards:[p.target]});s=finish(s);assert.ok(s.sides[p.responder].zones.battle.includes(p.counter));cases++;
}
const staleDefinitions=rulesFromRows(rows,rawDefs);assert.ok(staleDefinitions["EX13-04"].bySkill[0].unsupported.some(reason=>reason.includes("no current rule record")));cases++;
// A manually authored DO deliberately repeats the paid condition.
const original=rows.find(row=>row.cardId==="EX13-04"&&row.skillIndex===0)!;
const repeated={...copy(original),cond:null,ops:[{op:"if",cond:copy((original.cost as CostRecord).condition),then:copy(original.ops)}]};
assert.equal(storedPaidAdmission(repeated.cond,(repeated.cost as CostRecord).condition),undefined);
const repeatedScripts=rulesFromRows(rows.map(row=>row===original?repeated:row),defs);
assert.equal(repeatedScripts["EX13-04"].bySkill[0].paidAdmission,undefined);assert.deepEqual(counterEffectOps(repeatedScripts["EX13-04"].bySkill[0]),repeated.ops);cases++;
// Both the real paid wrapper and a deliberately repeated post-colon gate exist.
const repeatedDef=card("REPEATED",{skill:"[Counter: Play] If your Leader Card is a <Vegito> card: If your Leader Card is a <Vegito> card, if the Battle Card being played has 15000 power or less, it is placed in its owner's Drop Area instead of being played, then play this card."});
const repeatedDraft=skillRecords(repeatedDef)[0];
const doubled={...copy(original),cardId:repeatedDef.id,printed:repeatedDraft.printed,cond:copy(original.cond),ops:copy(repeated.ops),unread:[]};
const doubledScript=rulesFromRows([doubled],{[repeatedDef.id]:repeatedDef})[repeatedDef.id].bySkill[0];assert.ok(doubledScript.paidAdmission);assert.deepEqual(paidAdmissionBody(doubledScript),doubled.ops);assert.equal(doubledScript.unsupported.length,0);assert.deepEqual(counterEffectOps(doubledScript),doubledScript.ops);cases++;
console.log(`counter-admission-tail-5: ${cases} native cases passed`);
