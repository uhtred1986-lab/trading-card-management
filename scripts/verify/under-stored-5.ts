/** R-428: stored native P623→P624 and P349 chooser/placement continuations. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const defs:Record<string,CardDef>={F:card("F",{}),L:card("L",{type:"LEADER",colors:["Yellow"],traits:["Saiyan"]}),ENERGY:card("ENERGY",{colors:["Yellow"]}),SAIYAN:card("SAIYAN",{colors:["Green"],traits:["Saiyan"]}),GOKU:card("GOKU",{name:"Son Goku, Guardian Angel"}),GOHAN:card("GOHAN",{name:"Finishing Blow Son Gohan"})};
defs["P-623"]=card("P-623",{"name": "Mai", "type": "LEADER", "colors": ["Green"], "power": 5000, "characters": ["Mai: Future"], "traits": ["Earthling"], "skill": "[activate: main][once per turn] Add 1 card from your life to your hand: Look at up to 5 cards from the top of your deck, add up to 1 green ≪Saiyan≫ card to your hand, shuffle your deck, and this card gets +5000 power for the turn.\n[br]\n[awaken] When your life is at 4 or less: Draw 1 card, then switch up to 1 of your energy to Active Mode.", "energyCost": null, "back": {"name": "Mai, Defying Despair", "skill": "[rejuvenate][once per turn] {g}, if your life is at 4 or less: \n[br]\n[auto] When this card attacks, draw 1 card. Additionally, you may switch 1 of your {Trunks, Future Protector} in your Unison Area to Rest Mode. If you do, play up to 1 green ≪Saiyan≫ card with an original energy cost of 1 from your hand in Rest Mode.\n[br]\n[activate: battle][once per turn] Add 1 card from your life to your hand: Choose up to 1 of your green cards with {Trunks} in its card name in your Battle Area or Unison Area, switch it to Active Mode, and it gains [double strike] for the turn.", "power": 15000}});
defs["P-624"]=card("P-624",{"name": "Trunks, Future Protector", "type": "Z-UNISON", "colors": ["Green"], "power": 15000, "characters": [], "traits": [], "skill": "[blocker]\n[br]\n[auto] When this card is switched to Rest Mode by your green <Mai: Future>-only Leader's skill, draw 1 card. Additionally, you may choose 1 green ≪Saiyan≫ card from your hand or Battle Area and place it under your Leader. If you do, switch this card to Active Mode.\n[br]\n[+1][activate: main] If your Leader is a green <Mai: Future>-only card: Play up to 1 green ≪Saiyan≫ card with an original energy cost of 1 from your hand in Rest Mode, then add up to 1 card from your life to your hand.", "energyCost": null});
defs["P-327"]=card("P-327",{"name": "Super 17, Relentless Absorption", "type": "BATTLE", "colors": ["Green", "Yellow"], "power": 16000, "characters": ["Super 17"], "traits": ["Android", "Machine Mutant"], "skill": "[energy-exhaust]<br>[successor]{g}/{y}<br>[union absorb][limit 1]{g}/{y}, if your Leader Card is an ≪Android≫ card and you have 4 or more energy: You may place up to 1 <Cell> card from your deck or Drop Area under this card. If you do, choose up to 1 {Super 17, Cell Absorbed} or {Super 17, Hell's Storm Unleashed} in your deck or hand, play it with its keyword skills negated for the turn, then shuffle your deck if you looked through it.", "energyCost": 3});
defs["BT15-129"]=card("BT15-129",{"name": "Fin, Unison Absorber", "type": "BATTLE", "colors": ["Black"], "power": 15000, "characters": ["Fin"], "traits": ["Android"], "skill": "[auto]{b}, if your opponent has a skill-less Battle Card or Unison Card in play: At the end of a battle in which this card was used in a combo from your hand, play this card from your Drop Area in Rest Mode.<br>[auto] If your Leader Card is a black <Fin> card: When this card is played, you may choose 1 of your opponent's Unison Cards and place it under this card. If you do, this card can't be used in a combo this turn, and at the end of the turn, play the Unison Card under this card in your opponent's Unison Area with 2 markers on it and its skills negated for the game.", "energyCost": 2});
defs["P-349"]=card("P-349",{"name": "Son Gohan, Might Unleashed", "type": "BATTLE", "colors": ["Yellow"], "power": 4000, "characters": ["Son Gohan: Childhood"], "traits": ["Saiyan", "Earthling"], "skill": "[auto] When this card is played, draw 1 card.<br>[auto][limit 1]{y}{y}, if your Leader Card is a yellow ≪Saiyan≫ card: When this card is played from your hand, you may choose 1 {Son Goku, Guardian Angel} in your deck or hand and place it under this card. If you do, choose up to 1 {Finishing Blow Son Gohan} in your hand and play it on top of this card. Shuffle your deck if you looked through it.", "energyCost": 1});defs.ANSWER=card("ANSWER",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] The Battle Card played is played in Rest Mode."});
const rows=Object.values(defs).flatMap(skillRecords).map((r,id)=>({...r,id,source:"compiler",status:"confirmed"}) as unknown as RuleRow);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(rows),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(ctx,copy(s),a).state as VmState;
function fresh(first:PlayerId,leader:string){
 let s=RULES.createGame(ctx,{seed:428,p1:{name:"One",leader:first==="p1"?leader:"L",main:fifty("F")},p2:{name:"Two",leader:first==="p2"?leader:"L",main:fifty("F")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null},{type:"endMain",player:first},{type:"charge",player:other(first),card:null},{type:"endMain",player:other(first)},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);
 return s;
}
function stage(s:VmState,p:PlayerId,def:string,area:string){const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);return id;}
function untilPlacement(s:VmState,source:string,material:string,unison?:string){
 for(let n=0;n<60;n++){
  assert.notEqual(s.outcome?.kind,"interrupted",JSON.stringify(s.outcome));
  if(s.prompt.kind==="chooseCards"&&s.programs[0]?.card===source&&s.prompt.choice.candidates.includes(material))return s;
  const p=s.prompt;
  if(p.kind==="chooseCards")s=take(s,{type:"choose",player:p.player,cards:unison&&p.choice.candidates.includes(unison)?[unison]:p.choice.candidates.slice(0,p.choice.min??0)});
  else {const actions=RULES.legalActions(ctx,s).map(x=>x.action);const a=actions.find(a=>a.type==="counter"&&a.card===null)??actions.find(a=>a.type==="chooseMode"&&a.index===0)??actions.find(a=>a.type==="orderPending"&&a.index===0)??actions[0];assert.ok(a,JSON.stringify(p));s=take(s,a);}
 }throw Error("under-placement chooser not reached");
}
let cases=0;
for(const p of ["p1","p2"] as const)for(const accept of [false,true]){
 let s=fresh(p,"P-623");const leader=s.sides[p].zones.leader[0];s.cards[leader].flipped=true;
 const source=stage(s,p,"P-624","unison"),material=stage(s,p,"SAIYAN","hand"),old=stage(s,p,"F","hand");s.cards[source].zCard=true;s.cards[source].markers=2;assert.ok(moveCard(s,game,old,"drop",{under:leader}).ok);
 s=take(s,{type:"attack",player:p,attacker:leader,target:s.sides[other(p)].zones.leader[0]});s=untilPlacement(s,source,material,source);
 assert.equal(s.cards[source].mode,"rest");s=take(copy(s),{type:"choose",player:p,cards:accept?[material]:[]});assert.deepEqual(s.cards[leader].under,accept?[old,material]:[old]);assert.equal(s.cards[source].mode,accept?"active":"rest");cases++;
}
for(const p of ["p1","p2"] as const)for(const accept of [false,true]){
 let s=fresh(p,"L");for(let n=0;n<3;n++)stage(s,p,"ENERGY","energy");const source=stage(s,p,"P-349","hand"),material=stage(s,p,"GOKU","hand"),arrival=stage(s,p,"GOHAN","hand");
 const play=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="play"&&a.card===source);assert.ok(play);s=take(s,play);s=untilPlacement(s,source,material);
 s=take(copy(s),{type:"choose",player:p,cards:accept?[material]:[]});
 if(accept){assert.ok(s.cards[source].under.includes(material));assert.equal(s.prompt.kind,"chooseCards");s=take(copy(s),{type:"choose",player:p,cards:[arrival]});assert.ok(s.sides[p].zones.battle.includes(arrival));assert.deepEqual(s.cards[arrival].under,[source,material]);}
 else {assert.ok(s.sides[p].zones.hand.includes(material));assert.ok(s.sides[p].zones.hand.includes(arrival));}cases++;
}
// Actual P349 Auto shared window, with staged source-occurrence faults before its chooser opens.
for(const p of ["p1","p2"] as const)for(const variant of ["unchanged","left","returned","legacy"] as const){
 let s=fresh(p,"L");for(let n=0;n<3;n++)stage(s,p,"ENERGY","energy");const source=stage(s,p,"P-349","hand"),material=stage(s,p,"GOKU","hand");stage(s,p,"GOHAN","hand");stage(s,other(p),"ANSWER","hand");
 const play=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="play"&&a.card===source);assert.ok(play);s=take(s,play);
 for(let n=0;n<40&&!s.skillPlayScopes?.some(scope=>scope.source===source&&scope.skillIndex===10&&scope.phase==="before"&&scope.window);n++){
  const actions=RULES.legalActions(ctx,s).map(x=>x.action),a=actions.find(a=>a.type==="counter"&&a.card===null)??actions.find(a=>a.type==="chooseMode"&&a.index===0)??actions.find(a=>a.type==="orderPending"&&a.index===0)??actions[0];assert.ok(a,JSON.stringify(s.prompt));s=take(s,a);
 }
 const scope=s.skillPlayScopes?.find(scope=>scope.source===source&&scope.skillIndex===10&&scope.window);assert.ok(scope?.window);const waiting=scope.window.programs.find(f=>f.card===source&&f.skillIndex===10)!;assert.ok(waiting.underSource);
 if(variant==="left"||variant==="returned"){assert.ok(moveCard(s,game,source,"drop",{owner:p}).ok);if(variant==="returned")assert.ok(moveCard(s,game,source,"battle",{owner:p}).ok);}
 if(variant==="legacy")delete waiting.underSource;
 const pass=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="counter"&&a.card===null);assert.ok(pass);s=take(copy(s),pass);
 if(variant==="legacy"){assert.match(JSON.stringify(s.outcome),/under-placement source before Counter timing/);assert.ok(s.sides[p].zones.hand.includes(material));cases++;continue;}
 s=untilPlacement(s,source,material);s=take(copy(s),{type:"choose",player:p,cards:[material]});assert.equal(s.cards[source].under.includes(material),variant==="unchanged");assert.equal(s.sides[p].zones.hand.includes(material),variant!=="unchanged");cases++;
}
const fin=rows.find(r=>r.cardId==="BT15-129"&&r.skillIndex===10)!;assert.ok(runtimeSupportOfRow(fin).unsupported.length,"the remaining delayed Unison tail is still explicitly unread");assert.ok(ctx.scripts!["BT15-129"].bySkill[10].unsupported.length);cases++;
for(const id of ["P-624","P-327","BT15-129","P-349"]){
 const row=rows.find(r=>r.cardId===id&&r.skillIndex===(id==="P-327"?20:10))!;
 const old=copy(row);
 const strip=(value:unknown):void=>{if(Array.isArray(value))return value.forEach(strip);if(!value||typeof value!=="object")return;const item=value as Record<string,unknown>;delete item.completedAs;if(item.kind==="moved"){item.kind="chose";delete item.all;}Object.values(item).forEach(strip);};strip(old.ops);
 for(const status of ["draft","confirmed","corrected"] as const){const stale={...old,status};assert.ok(runtimeSupportOfRow(stale).unsupported.some(reason=>reason.includes("movement completion")));assert.ok(rulesFromRows([stale],defs)[id].bySkill[row.skillIndex].unsupported.length);cases++;}
}
console.log(`under-stored-5: ${cases} stored/native and explicit-gap controls passed`);
