/** R431: parked after-window lifecycle and existing observational being-played conditions. */
import assert from "node:assert/strict";
import {card,fifty} from "./harness";
import {skillRecords} from "../../src/lib/arena/draft";
import {rulesFromRows,type RuleRow} from "../../src/lib/arena/rules-store";
import {RULES} from "../../src/lib/arena/vm";
import {rulesetFor} from "../../src/lib/arena/rulesets";
import {moveCard} from "../../src/lib/arena/vm/zones";
import type {Action,CardDef,EngineContext,PlayerId} from "../../src/lib/arena/types";
import type {VmState} from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const defs:Record<string,CardDef>={F:card("F",{}),L:card("L",{type:"LEADER"}),ENERGY:card("ENERGY",{colors:["Blue","Yellow","Black"]}),HIGH:card("HIGH",{energyCost:6}),SOURCE:card("SOURCE",{skill:"[Activate: Main] Choose up to 1 Battle Card from your hand and play it."})};
defs["DB2-169"]=card("DB2-169",{"name": "Geene & Martinne, Universe 12 Destroyer & Angel", "colors": ["Blue", "Yellow"], "power": 19000, "characters": ["Geene", "Martinne"], "traits": ["God", "Universe 12"], "skill": "[Counter: Play] If the Battle Card being played has an energy cost of 5 or less, negate its skills for the turn and play this card.<br>[Energy-Exhaust]<br>[Aegis Blue/Yellow][Once per turn]<br>[Auto][Once per turn] When you activate [Aegis Blue/Yellow], draw 2 cards.", "type": "BATTLE", "energyCost": 3});
defs["BT1-110"]=card("BT1-110",{"name": "Crusher Ball", "colors": ["Yellow"], "power": null, "characters": [], "traits": [], "skill": "[Counter: Play] The Battle Card played is played in Rest Mode.", "type": "EXTRA", "energyCost": 1});
defs["BT10-136"]=card("BT10-136",{"name": "Towa, Twisted Sister", "colors": ["Black"], "power": 4000, "characters": ["Towa"], "traits": ["Demon Realm Race", "Demon God"], "skill": "[Counter: Play] Play this card.<br>[Auto] When this card is played, draw 1 card, then shuffle up to 1 card from your opponent's Drop Area into their deck.", "type": "BATTLE", "energyCost": 1});
defs["DB2-040"]=card("DB2-040",{"name": "Hit, Deadly Vanguard", "colors": ["Blue"], "power": 15000, "characters": ["Hit"], "traits": ["Alien", "Universe 6"], "skill": "[Counter: Play] If the Battle Card being played has an energy cost of 5 or less, it is returned to its owner's hand instead of being played, then play this card.<br>[Permanent] During your opponent's turn, reduce the energy cost of this card in your hand by 2.<br>[Permanent] This card can't be returned to your hand by your skills.<br>[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards with an energy cost of 5 or less and return it to its owner's hand.", "type": "BATTLE", "energyCost": 5});
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
function ready(owner:PlayerId,name:string,targetDef:string|null){
 let s=fresh(owner);const source=stage(s,owner,"SOURCE","battle"),target=stage(s,owner,targetDef??"F","hand"),counter=stage(s,other(owner),name,"hand");for(let n=0;n<6;n++)stage(s,other(owner),"ENERGY","energy");
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source);assert.ok(action);s=take(s,action);if(s.prompt.kind==="counter")s=answer(s,null);assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:owner,cards:targetDef?[target]:[]});assert.equal(s.resolving?.scopeWindow?.boundary,"after");assert.equal(s.skillPlayScopes![0].phase,"after");return {s,source,target,counter};
}
function finish(s:VmState):VmState{
 for(let n=0;n<50&&s.prompt.kind!=="main";n++){
  assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));const p=s.prompt;
  if(p.kind==="chooseCards")s=take(s,{type:"choose",player:p.player,cards:p.choice.candidates.slice(0,p.choice.min??0)});
  else {const actions=RULES.legalActions(ctx,s).map(x=>x.action),a=actions.find(a=>a.type==="payCost")??actions.find(a=>a.type==="counter"&&a.card===null)??actions.find(a=>a.type==="orderPending"&&a.index===0);assert.ok(a,JSON.stringify(p));s=take(s,a);}
 }assert.equal(s.prompt.kind,"main");return s;
}
let cases=0;
for(const owner of ["p1","p2"] as const)for(const name of ["DB2-040","DB2-169"])for(const targetDef of ["F","HIGH",null]){
 const initial=ready(owner,name,targetDef);let s=answer(copy(initial.s),initial.counter);s=finish(s);
 assert.ok(s.sides[other(owner)].zones.drop.includes(initial.counter));assert.ok(!s.sides[other(owner)].zones.battle.includes(initial.counter));assert.equal(s.sides[owner].zones.battle.includes(initial.target),!!targetDef);assert.ok(!s.effects.some(effect=>effect.target===initial.target&&effect.kind==="negateSkills"));assert.equal(s.skillPlayScopes,undefined);cases++;
}
for(const owner of ["p1","p2"] as const){
 const initial=ready(owner,"BT10-136","F");let s=initial.s;const crusher=stage(s,owner,"BT1-110","hand");stage(s,owner,"ENERGY","energy");s=answer(copy(s),initial.counter);
 if(s.prompt.kind==="payCost"){const pay=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="payCost");assert.ok(pay);s=take(s,pay);}
 assert.equal(s.prompt.kind,"counter");assert.equal(s.skillPlayScopes?.length,2);assert.equal(s.skillPlayScopes![0].phase,"after");assert.equal(s.skillPlayScopes![1].phase,"before");
 s=answer(copy(s),crusher);s=finish(s);assert.ok(s.sides[other(owner)].zones.battle.includes(initial.counter));assert.equal(s.cards[initial.counter].mode,"rest");assert.equal(s.skillPlayScopes,undefined);assert.equal(s.resolving,null);cases++;
}
console.log(`counter-after-scope-5: ${cases} native after-window cases passed`);
