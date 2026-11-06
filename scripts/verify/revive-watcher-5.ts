/** R467: the printed Leader watches completed Revive activation, not KO/play. */
import assert from "node:assert/strict";
import {card,fifty} from "./harness";
import {skillRecords} from "../../src/lib/arena/draft";
import {rulesFromRows,type RuleRow} from "../../src/lib/arena/rules-store";
import {RULES} from "../../src/lib/arena/vm";
import {rulesetFor} from "../../src/lib/arena/rulesets";
import {vmHost} from "../../src/lib/arena/vm/host";
import {addEffect} from "../../src/lib/arena/vm/effects";
import {emptyFilter} from "../../src/lib/arena/text/filters";
import {moved} from "../../src/lib/arena/vm/flow";
import {moveCard} from "../../src/lib/arena/vm/zones";
import type {Action,CardDef,EngineContext,PlayerId,GameEvent} from "../../src/lib/arena/types";
import type {VmState} from "../../src/lib/arena/vm/state";
const actual=[
  {
    "id": "BT8-044",
    "type": "LEADER",
    "colors": [
      "Green"
    ],
    "cost": null,
    "specified": null,
    "z": null,
    "power": 10000,
    "name": "Son Goku",
    "characters": [
      "Son Goku"
    ],
    "traits": [
      "Saiyan"
    ],
    "skill": "[Auto] When this card attacks a Leader Card, draw 1 card. <br>[Auto][Once per turn] When one of your Battle Cards activates [Revive], draw 1 card. <br>[Awaken] When your life is at 4 or less: You may draw 1 card, then choose up to 1 of your energy, switch it to Active Mode, and flip this card over.",
    "backName": "Kaio-Ken Son Goku, Turning the Tide",
    "backSkill": "[Auto] When this card attacks, draw 1 card. <br>[Auto][Once per turn] When one of your Battle Cards activates [Revive], draw 2 cards. <br>[Activate: Main][Once per turn] Choose 1 of your Blue/Green multicolor Battle Cards in Rest Mode, and until the start of your next Main Phase, as long as the chosen card is in Rest Mode, your opponent's cards can't attack Leader Cards."
  },
  {
    "id": "BT8-119",
    "type": "BATTLE",
    "colors": [
      "Blue",
      "Green"
    ],
    "cost": "3",
    "specified": null,
    "z": null,
    "power": 15000,
    "name": "Son Gohan & Piccolo, Pupil and Master",
    "characters": [
      "Son Gohan: Youth",
      "Piccolo"
    ],
    "traits": [
      "Saiyan",
      "Earthling",
      "Namekian"
    ],
    "skill": "[Barrier]<br>[Energy-Exhaust]<br>[Revive Blue/Green] (Place cards in your hand in your Drop Area that match all colors specified by [Revive]: When this card is KO'd, play this card and negate this skill for the duration of the turn.)<br>[Auto] When this card attacks, your opponent chooses 1 card in their hand and places it in their Drop Area.",
    "backName": null,
    "backSkill": null
  }
];
const defs:Record<string,CardDef>={BLUE:card("BLUE",{colors:["Blue"]}),GREEN:card("GREEN",{colors:["Green"]}),F:card("F",{colors:["Yellow"]}),DUAL:card("DUAL",{colors:["Blue","Green"]}),BIG:card("BIG",{power:50000}),C:card("C",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played."})};
for(const c of actual)defs[c.id]=card(c.id,{name:c.name,type:c.type as CardDef["type"],colors:c.colors as CardDef["colors"],power:c.power??0,energyCost:Number(c.cost),characters:c.characters,traits:c.traits,skill:c.skill,...(c.backSkill?{back:{name:c.backName!,power:15000,skill:c.backSkill}}:{})});
const rows=Object.values(defs).flatMap(skillRecords).map(r=>({...r,source:"compiler",status:"confirmed"}) as RuleRow);
for(const side of [false,true]){const row=rows.find(r=>r.cardId==="BT8-044"&&r.skillIndex===10&&(r.side==="back")===side);assert.ok(row);assert.deepEqual(row.unread,[]);}
const ctx:EngineContext={defs,scripts:rulesFromRows(rows,defs)};const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
let events:GameEvent[]=[];
const take=(s:VmState,a:Action)=>{const r=RULES.apply(clone(ctx),clone(s),clone(a));events.push(...r.events);return r.state as VmState;};
function fresh(first:PlayerId){let s=RULES.createGame(ctx,{seed:467,p1:{name:"One",leader:"BT8-044",main:fifty("F")},p2:{name:"Two",leader:"BT8-044",main:fifty("F")}}).state as VmState;for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);s.turn=2;return s;}
function stage(s:VmState,p:PlayerId,id:string,area:string){const cid=s.sides[p].zones.deck.at(-1)!;s.cards[cid].cardId=id;assert.ok(moveCard(s,game,cid,area,{owner:p}).ok);return cid;}
function battleKo(s:VmState,attacker:string,target:string){const p=s.turnPlayer;s=take(s,{type:"attack",player:p,attacker,target});for(let n=0;n<12&&s.prompt.kind!=="chooseCards"&&s.prompt.kind!=="main";n++){const q=s.prompt;if(q.kind==="counter")s=take(s,{type:"counter",player:q.player,card:null});else if(q.kind==="combo")s=take(s,{type:"pass",player:q.player});else throw Error(JSON.stringify(q));}return s;}
function finish(s:VmState){for(let n=0;n<25&&s.prompt.kind!=="main"&&!s.outcome;n++){const q=s.prompt;if(q.kind==="counter")s=take(s,{type:"counter",player:q.player,card:null});else if(q.kind==="chooseCards")s=take(s,{type:"choose",player:q.player,cards:q.choice.candidates.slice(0,q.choice.min)});else if(q.kind==="chooseMode")s=take(s,{type:"chooseMode",player:q.player,index:0});else if(q.kind==="combo")s=take(s,{type:"pass",player:q.player});else throw Error(JSON.stringify(q));}return s;}
let checks=0;
for(const p of ["p1","p2"] as const)for(const back of [false,true])for(const borrowed of [false,true])for(const pay of [false,true]){
 const attackerOwner=borrowed?p:other(p);let s=fresh(attackerOwner);s.cards[s.sides[p].zones.leader[0]].flipped=back;
 const source=stage(s,p,"BT8-119","battle"),payer=stage(s,p,"DUAL","hand"),attacker=stage(s,attackerOwner,"BIG","battle");s.cards[source].mode="rest";
 if(borrowed)assert.ok(moveCard(s,game,source,"battle",{owner:other(p),carry:true}).ok);
 events=[];s=battleKo(s,attacker,source);assert.equal(s.prompt.kind,"chooseCards");assert.equal(s.prompt.player,p,"Revive owner pays even when opponent controlled the KO'd card");
 s=take(s,{type:"choose",player:p,cards:pay?[payer]:[]});s=finish(s);
 const watcher=events.filter(e=>e.type==="skill"&&e.card===s.sides[p].zones.leader[0]&&e.skill===10);assert.equal(watcher.length,pay?1:0);
 const draws=events.filter(e=>e.type==="draw"&&e.player===p);assert.equal(draws.length,pay?(back?2:1):0);
 assert.equal(events.some(e=>e.type==="skill"&&e.card===s.sides[other(p)].zones.leader[0]&&e.skill===10),false);
 assert.equal(s.sides[p].zones.battle.includes(source),pay);checks++;
}
// Independent activation taxes are protocol-issued rules; the Revive and
// watched Leader programs remain actual stored card records throughout.
for(const p of ["p1","p2"] as const)for(const variant of ["taxPay","colorDecline","taxReplace","playReplaced"]) {
 let s=fresh(other(p));const source=stage(s,p,"BT8-119","battle"),payer=stage(s,p,"DUAL","hand"),extra=stage(s,p,"F","hand"),attacker=stage(s,other(p),"BIG","battle");s.cards[source].mode="rest";
 const counter=variant==="playReplaced"?stage(s,other(p),"C","hand"):undefined;
 if(!counter)addEffect(s,[],{target:"",kind:"forbid",value:0,until:"turn",master:other(p),source:s.sides[other(p)].zones.leader[0],forbid:{what:"activateSkill",player:p,filter:{...emptyFilter(),type:"BATTLE"},pay:[{op:"choose",sel:{side:"you",area:"hand",count:1,upTo:false},as:"reviveTax"},{op:"moveTo",target:{var:"reviveTax"},to:"drop"}]}});
 events=[];s=battleKo(s,attacker,source);assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:p,cards:variant==="colorDecline"?[]:[payer]});
 if(counter){assert.equal(s.prompt.kind,"counter");s=take(s,{type:"counter",player:other(p),card:counter,skill:0});}
 else if(variant!=="colorDecline") {
  assert.equal(s.prompt.kind,"chooseCards");assert.equal(events.some(e=>e.type==="skill"&&e.card===source),false,"no announcement before tax completes");
  if(variant==="taxReplace")addEffect(s,[],{target:extra,kind:"replaceLeave",value:{to:"warp",optional:true,target:{special:"self"}},until:"turn",source:extra,master:p});
  s=take(s,{type:"choose",player:p,cards:[extra]});
  if(variant==="taxReplace"){assert.equal(s.prompt.kind,"replaceMove");s=take(s,{type:"chooseMode",player:p,index:0});}
 }
 s=finish(s);const activated=variant==="taxPay"||variant==="playReplaced";
 assert.equal(events.filter(e=>e.type==="skill"&&e.card===s.sides[p].zones.leader[0]&&e.skill===10).length,activated?1:0);
 assert.equal(s.sides[p].zones.battle.includes(source),variant==="taxPay");assert.equal(s.sides[p].zones.drop.includes(payer),variant!=="colorDecline");checks++;
}
// A second different Battle Card can activate Revive, but this Leader's
// Once-per-turn watcher cannot draw twice in the same turn.
for(const p of ["p1","p2"] as const) {
 let s=fresh(other(p));events=[];
 for(let n=0;n<2;n++){
  const source=stage(s,p,"BT8-119","battle"),payer=stage(s,p,"DUAL","hand"),attacker=stage(s,other(p),"BIG","battle");s.cards[source].mode="rest";
  s=battleKo(s,attacker,source);assert.equal(s.prompt.kind,"chooseCards");s=finish(take(s,{type:"choose",player:p,cards:[payer]}));
 }
 assert.equal(events.filter(e=>e.type==="skill"&&e.card===s.sides[p].zones.leader[0]&&e.skill===10).length,1);checks++;
}
for(const p of ["p1","p2"] as const)for(const departure of ["warp","zero"]) {
 const s=fresh(other(p)),source=stage(s,p,"BT8-119","battle");stage(s,p,"DUAL","hand");const ev:GameEvent[]=[];
 if(departure==="warp")moved(ctx,game,s,ev,source,"warp",{owner:p,reason:"effect"});
 else {addEffect(s,[],{target:source,kind:"power",value:-50000,until:"turn",master:other(p)});vmHost(ctx,game,s,ev).ruleInterrupt!({card:source,master:p,ops:[],ip:0,vars:{}});}
 assert.equal(s.pending.some(q=>q.card===source),false,"Warp and zero-power rule departures do not activate Revive");
 assert.equal(s.pending.some(q=>q.card===s.sides[p].zones.leader[0]&&q.skillIndex===10),false);checks++;
}
// The original occurrence is rebound only at the KO declaration, never
// because the same physical card returned during a saved cost/response.
for(const p of ["p1","p2"] as const)for(const phase of ["color","tax","counter","missingColor","missingTax"]) {
 let s=fresh(other(p));const source=stage(s,p,"BT8-119","battle"),payer=stage(s,p,"DUAL","hand"),extra=stage(s,p,"F","hand"),attacker=stage(s,other(p),"BIG","battle");s.cards[source].mode="rest";
 if(phase==="counter")stage(s,other(p),"C","hand");
 if(phase==="tax"||phase==="missingTax")addEffect(s,[],{target:"",kind:"forbid",value:0,until:"turn",master:other(p),source:s.sides[other(p)].zones.leader[0],forbid:{what:"activateSkill",player:p,filter:{...emptyFilter(),type:"BATTLE"},pay:[{op:"choose",sel:{side:"you",area:"hand",count:1,upTo:false},as:"tax"},{op:"moveTo",target:{var:"tax"},to:"drop"}]}});
 events=[];s=battleKo(s,attacker,source);assert.equal(s.prompt.kind,"chooseCards");
 const aba=()=>{assert.ok(moveCard(s,game,source,"warp",{owner:p}).ok);assert.ok(moveCard(s,game,source,"drop",{owner:p}).ok);};
 if(phase==="color")aba();
 if(phase==="missingColor")for(const f of s.programs)if(f.viaKeyword==="Revive")delete f.vars["§reviveSourceContract"];
 s=take(s,{type:"choose",player:p,cards:[payer]});
 if(phase==="tax"||phase==="missingTax"){
  assert.equal(s.prompt.kind,"chooseCards");
  if(phase==="tax")aba();else for(const f of s.programs)if(f.autoCost)delete f.autoCost.reviveSource;
  s=take(s,{type:"choose",player:p,cards:[extra]});
 }
 if(phase==="counter"){assert.equal(s.prompt.kind,"counter");aba();s=take(s,{type:"counter",player:other(p),card:null});}
 if(!phase.startsWith("missing"))s=finish(s);
 else assert.equal(s.outcome?.kind,"interrupted","obsolete saved Revive binding requires rebuild");
 const activated=phase==="tax"||phase==="counter";
 assert.equal(events.filter(e=>e.type==="skill"&&e.card===s.sides[p].zones.leader[0]&&e.skill===10).length,activated?1:0);
 assert.ok(s.sides[p].zones.drop.includes(source));assert.equal(s.sides[p].zones.drop.includes(payer),phase!=="color"&&phase!=="missingColor");checks++;
}
// Full ordered affordability: color payment can supply Drop tax materials,
// and must leave a required hand tax payer. These taxes are protocol fixtures.
for (const p of ["p1", "p2"] as const) for (const variant of ["drop", "compete", "impossible"]) {
 let s=fresh(other(p)); for (const id of [...s.sides[p].zones.hand]) assert.ok(moveCard(s,game,id,"deck",{owner:p}).ok);
 const source=stage(s,p,"BT8-119","battle"), blue=stage(s,p,"BLUE","hand"), green=stage(s,p,"GREEN","hand"), attacker=stage(s,other(p),"BIG","battle"); s.cards[source].mode="rest";
 const dual=variant==="compete"?stage(s,p,"DUAL","hand"):undefined;
 addEffect(s,[],{target:"",kind:"forbid",value:0,until:"turn",master:other(p),source:s.sides[other(p)].zones.leader[0],forbid:{what:"activateSkill",player:p,filter:{...emptyFilter(),type:"BATTLE"},pay:[{op:"choose",sel:{side:"you",area:variant==="drop"?"drop":"hand",count:variant==="drop"?3:1,upTo:false,...(variant!=="drop"?{filter:{...emptyFilter(),names:["DUAL"]}}:{})},as:"jointTax"},{op:"moveTo",target:{var:"jointTax"},to:"warp"}]}});
 events=[]; s=battleKo(s,attacker,source);
 if(variant==="impossible") { assert.equal(s.prompt.kind,"main"); assert.ok(s.sides[p].zones.hand.includes(blue)); assert.ok(s.sides[p].zones.hand.includes(green)); }
 else {
  assert.equal(s.prompt.kind,"chooseCards"); if(s.prompt.kind!=="chooseCards")throw Error("missing color choice");
  if(dual)assert.equal(s.prompt.choice.candidates.includes(dual),false,"a color answer must leave the only tax payer");
  s=take(s,{type:"choose",player:p,cards:[blue]}); s=take(s,{type:"choose",player:p,cards:[green]}); s=finish(s);
  assert.equal(events.filter(e=>e.type==="skill"&&e.card===s.sides[p].zones.leader[0]&&e.skill===10).length,1);
 }
 checks++;
}
// Multi-pick tax payers are also bound before later selections and reload.
for (const p of ["p1", "p2"] as const) for (const corrupt of [false, true, "alias"]) {
 let s=fresh(other(p)); const source=stage(s,p,"BT8-119","battle"), dual=stage(s,p,"DUAL","hand"), first=stage(s,p,"F","hand"), second=stage(s,p,"F","hand"), attacker=stage(s,other(p),"BIG","battle"); s.cards[source].mode="rest";
 addEffect(s,[],{target:"",kind:"forbid",value:0,until:"turn",master:other(p),source:s.sides[other(p)].zones.leader[0],forbid:{what:"activateSkill",player:p,filter:{...emptyFilter(),type:"BATTLE"},pay:[{op:"choose",sel:{side:"you",area:"hand",count:2,upTo:false},as:"twoTax"},{op:"moveTo",target:{var:"twoTax"},to:"drop"}]}});
 events=[]; s=battleKo(s,attacker,source); s=take(s,{type:"choose",player:p,cards:[dual]}); s=take(s,{type:"choose",player:p,cards:[first]}); assert.equal(s.prompt.kind,"chooseCards");
 if(corrupt) {
  for(const f of s.programs)if(f.autoCost?.reviveTax) { if(corrupt==="alias")f.autoCost.reviveTax.aliases=[]; else delete f.autoCost.reviveTax.paying; }
  s=take(s,{type:"choose",player:p,cards:[second]}); assert.equal(s.outcome?.kind,"interrupted");
 } else {
  assert.ok(moveCard(s,game,first,"drop",{owner:p}).ok); assert.ok(moveCard(s,game,first,"hand",{owner:p}).ok);
  assert.throws(()=>take(s,{type:"choose",player:p,cards:[second]}),/Revive tax payer occurrence/);
 }
 assert.ok(s.sides[p].zones.drop.includes(dual)); assert.ok(s.sides[p].zones.hand.includes(second));
 assert.equal(events.some(e=>e.type==="skill"&&e.card===source),false); checks++;
}
// A saved partial color choice is an occurrence, not a reusable physical ID.
for (const p of ["p1", "p2"] as const) {
 let s=fresh(other(p)); const source=stage(s,p,"BT8-119","battle"), blue=stage(s,p,"BLUE","hand"), green=stage(s,p,"GREEN","hand"), attacker=stage(s,other(p),"BIG","battle"); s.cards[source].mode="rest";
 events=[]; s=battleKo(s,attacker,source); s=take(s,{type:"choose",player:p,cards:[blue]}); assert.equal(s.prompt.kind,"chooseCards");
 assert.ok(moveCard(s,game,blue,"drop",{owner:p}).ok); assert.ok(moveCard(s,game,blue,"hand",{owner:p}).ok);
 assert.throws(()=>take(s,{type:"choose",player:p,cards:[green]}),/Revive.*occurrence/);
 assert.ok(s.sides[p].zones.hand.includes(blue)); assert.ok(s.sides[p].zones.hand.includes(green)); checks++;
}
console.log(`Revive watcher: ${checks} native both-seat cases passed`);
