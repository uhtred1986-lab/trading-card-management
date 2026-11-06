/** R434: short active Counter replacements prevent the original arrival. */
import assert from "node:assert/strict";
import {card,fifty} from "./harness";
import {correctSkillText} from "../../src/lib/catalog/errata";
import {skillRecords} from "../../src/lib/arena/draft";
import {rulesFromRows,recordContractGaps,type RuleRow} from "../../src/lib/arena/rules-store";
import {RULES} from "../../src/lib/arena/vm";
import {rulesetFor} from "../../src/lib/arena/rulesets";
import {parseFilter} from "../../src/lib/arena/text/filters";
import {playReplacementDescriptor,requirePlayReplacement,shortPlayReplacementGap} from "../../src/lib/arena/vm/short-play-replacement";
import type {Op,ScriptFrame} from "../../src/lib/arena/vm/script";
import {moveCard} from "../../src/lib/arena/vm/zones";
import type {Action,CardDef,EngineContext,PlayerId} from "../../src/lib/arena/types";
import type {VmState} from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const defs:Record<string,CardDef>={F:card("F",{}),L:card("L",{type:"LEADER",colors:["Green"],characters:["Son Goku"]}),ZBLUE:card("ZBLUE",{type:"Z-BATTLE",colors:["Blue"],zEnergyCost:1}),HIGH:card("HIGH",{energyCost:6,power:40000}),DEFLECT:card("DEFLECT",{skill:"[Deflect]"}),UNISON:card("UNISON",{type:"UNISON"}),SOURCE:card("SOURCE",{skill:"[Activate: Main] Choose up to 1 Battle Card from your hand and play it."}),SOURCEANY:card("SOURCEANY",{skill:"[Activate: Main] Choose up to 1 Unison Card from your hand and play it with 2 markers on it."})};
defs.AUTO=card("AUTO",{skill:"[Auto] When this card is played, draw 1 card."});
defs.NEG=card("NEG",{type:"EXTRA",skill:"[Counter: Counter] Negate the [Counter]."});
for(const color of ["Red","Green","Blue","Yellow","Black","White"] as const)defs[color]=card(color,{colors:[color]});
defs["BT20-065"]=card("BT20-065",{"name": "Son Gohan, Spirit of Resistance", "type": "BATTLE", "colors": ["Green"], "power": 10000, "characters": ["Son Gohan: GT"], "traits": ["Saiyan", "Earthling"], "skill": "[counter: play]{g}: Play this card, and if the Battle Card being played has an energy cost of 4 or less, place it in its owner's Drop instead.<br>[permanent] If your Leader is a green <Son Goku: GT> card and a green <Son Goku: GT> card is in your Warp, reduce the energy cost of this card in your hand by 1.<br>[auto][limit 1] When this card is played, draw 1 card, and choose up to 1 of your opponent's Unisons and remove a marker from it.", "energyCost": 2});
defs["BT19-065"]=card("BT19-065",{"name": "Decisive Strike", "type": "EXTRA", "colors": ["Blue"], "power": null, "characters": [], "traits": [], "skill": "[Counter: Play] If you have a blue Z-Battle Card in play: If the Battle Card being played has an energy cost of 3 or less, place it at the bottom of its owner's deck instead.<br>[Permanent] If all of your energy is mono-blue, you can activate this card's [Counter] skill from your hand without paying its energy cost by placing 1 other card from your hand at the bottom of your deck.", "energyCost": 1});
defs["BT14-025"]=card("BT14-025",{"name": "Kettol, Warrior of Universe 11", "type": "BATTLE", "colors": ["Red"], "power": 15000, "characters": ["Kettol"], "traits": ["Alien", "Pride Troopers", "Universe 11"], "skill": "[Blocker]<br>[Counter: Play] If the Battle Card being played has 20000 power or less, place it in its owner's Drop Area instead, then play this card.<br>[Permanent][Bond 3] Reduce the energy cost of this card in your hand by 1. <br>[Auto] When this card is played, choose up to 1 of your opponent's Battle Cards and it gets -10000 power for the turn.", "energyCost": 3});
defs["BT18-075"]=card("BT18-075",{"name": "Chi-Chi, Promise Fulfilled", "type": "BATTLE", "colors": ["Green"], "power": 5000, "characters": ["Chi-Chi"], "traits": ["Earthling", "World Tournament"], "skill": "[Counter: Play] If your Leader is a &lt;Son Goku&gt; card and you place this card in its owner's Drop: If the Battle Card being played has an energy cost of 2 or less, place it in its owner's Drop instead.<br>[Permanent] If your Leader is a green \u226aTurtle School\u226b card, reduce the energy cost of this card in your hand by 1.<br>[Auto] When this card is played, look at up to 7 cards from the top of your deck, add up to 1 green &lt;Son Goku&gt; card among them to your hand, then shuffle your deck.", "energyCost": 2});
defs["EX19-25"]=card("EX19-25",{"name": "SS4 Bardock, Prismatic Burst", "type": "BATTLE", "colors": ["Red", "Black"], "power": 16000, "characters": ["Bardock: Xeno"], "traits": ["Saiyan"], "skill": "[energy-exhaust]<br>[counter: play] Play this card, and if the Battle Card being played has 20000 power or less, place it in its owner's Drop Area instead.<br>[permanent] If you have 2 or more black multicolor energy, you may add a card from your life to your hand when activating this card's [counter] skill from your hand. If you do, reduce the activation cost of this card's [counter] skill by {b}.", "energyCost": 2});
defs["P-376"]=card("P-376",{"name": "SSG Vegeta, Divine Restraint", "type": "BATTLE", "colors": ["Red", "Blue"], "power": 10000, "characters": ["Vegeta: Br"], "traits": ["Saiyan"], "skill": "[Energy-Exhaust]\r\n[Counter: Play] Play this card, and if the Battle Card being played has 20000 power or less, place it at the bottom of its owner's deck instead.\r\n[Permanent] If all of your opponent's energy is in Rest Mode, negate this card's [Energy-Exhaust] skill in all areas.\r\n[Permanent] This card gets +3000 power for each card in your energy.", "energyCost": 2});
for(const def of Object.values(defs))def.skill=correctSkillText(def.id,def.skill);
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
const names=["BT20-065","BT14-025","BT18-075","EX19-25","BT19-065","P-376"];
function prepared(owner:PlayerId,name:string,targetDef="F",useCtx=ctx){
 let s=fresh(owner);const source=stage(s,owner,targetDef==="UNISON"?"SOURCEANY":"SOURCE","battle"),target=stage(s,owner,targetDef,"hand"),counter=stage(s,other(owner),name,"hand");if(name==="BT19-065")stage(s,other(owner),"ZBLUE","battle");
 for(const color of ["Red","Green","Blue","Yellow","Black","White","Green","Blue"])stage(s,other(owner),color,"energy");
 const action=RULES.legalActions(useCtx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source);assert.ok(action);s=RULES.apply(useCtx,copy(s),action).state as VmState;return {s,source,target,counter};
}
function untilChoice(s:VmState){for(let n=0;n<30&&s.prompt.kind!=="chooseCards";n++){assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));const actions=RULES.legalActions(ctx,s).map(x=>x.action),a=actions.find(a=>a.type==="payCost")??actions.find(a=>a.type==="counter"&&a.card===null);assert.ok(a,JSON.stringify(s.prompt));s=take(s,a);}assert.equal(s.prompt.kind,"chooseCards");return s;}
for(const owner of ["p1","p2"] as const)for(const name of names)for(const targetDef of ["F","AUTO","HIGH","DEFLECT","UNISON",null]){
 const p=prepared(owner,name,targetDef??"F");let s=p.s;assert.equal(s.prompt.kind,"counter");assert.ok(RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===p.counter),name);s=untilChoice(answer(s,p.counter));assert.ok(s.prompt.kind==="chooseCards");assert.equal(s.prompt.player,owner,`${name} parent choice`);
 const ownerDeck=s.sides[owner].zones.deck.length,ownerHand=s.sides[owner].zones.hand.length;
 const spent=s.sides[other(owner)].zones.energy.filter(id=>s.cards[id].mode==="rest").length;
 s=take(s,{type:"choose",player:owner,cards:targetDef?[p.target]:[]});s=finish(s);
 const replaced=targetDef==="F"||targetDef==="AUTO",bottom=["BT19-065","P-376"].includes(name);assert.equal(s.sides[owner].zones.battle.includes(p.target),!!targetDef&&targetDef!=="UNISON"&&!replaced,`${name} ${targetDef}`);
 if(replaced){assert.ok(s.sides[owner].zones[bottom?"deck":"drop"].includes(p.target));if(bottom)assert.equal(s.sides[owner].zones.deck.at(-1),p.target);}
 if(targetDef==="AUTO"){assert.equal(s.sides[owner].zones.hand.length,ownerHand-1);assert.equal(s.sides[owner].zones.deck.length,ownerDeck+(bottom?1:0));}
 if(targetDef==="UNISON")assert.ok(s.sides[owner].zones.unison.includes(p.target));
 const selfPlayed=["BT20-065","EX19-25","P-376"].includes(name)||name==="BT14-025"&&(targetDef==="F"||targetDef==="AUTO"||targetDef==="DEFLECT");assert.equal(s.sides[other(owner)].zones.battle.includes(p.counter),selfPlayed,`${name} self-play ${targetDef}`);
 assert.equal(s.sides[other(owner)].zones.energy.filter(id=>s.cards[id].mode==="rest").length,spent);assert.equal(s.skillPlayScopes,undefined);cases++;
}
function downgrade(value:unknown):unknown{
 if(Array.isArray(value))return value.map(downgrade);if(!value||typeof value!=="object")return value;const op=value as Record<string,unknown>;
 if(op.op==="resolvingPlay"&&(op.instead==="drop"||op.instead==="deck"))return {op:"moveTo",target:{sel:{special:"resolving"}},to:op.instead,...(op.position?{position:op.position}:{reveal:true})};
 return Object.fromEntries(Object.entries(op).map(([key,item])=>[key,downgrade(item)]));
}
for(const name of names){const row=rows.find(row=>row.cardId===name&&row.kind==="counter:play")!;for(const status of ["draft","confirmed","corrected"] as const){
 const stale={...row,status,ops:downgrade(row.ops)};assert.ok(recordContractGaps(stale).includes("rebuild the stored short-form Counter play replacement"));const oldCtx={...ctx,scripts:rulesFromRows(rows.map(r=>r===row?stale:r),defs)};
 assert.ok(oldCtx.scripts[name].bySkill[row.skillIndex].unsupported.includes("rebuild the stored short-form Counter play replacement"));const p=prepared("p1",name,"F",oldCtx);assert.ok(!RULES.legalActions(oldCtx,p.s).some(x=>x.action.type==="counter"&&x.action.card===p.counter));const stalePrompt=prepared("p1",name);assert.throws(()=>RULES.apply(oldCtx,copy(stalePrompt.s),{type:"counter",player:"p2",card:stalePrompt.counter}),/unsupported Counter|rebuild/);cases++;
}}
for(const owner of ["p1","p2"] as const)for(const name of names){
 const p=prepared(owner,name);let s=p.s;stage(s,owner,"NEG","hand");stage(s,owner,"Red","energy");s=answer(s,p.counter);
 while(s.prompt.kind==="payCost"){const pay=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="payCost");assert.ok(pay);s=take(s,pay);}
 assert.equal(s.prompt.kind,"counter");const frames=[...s.programs,...(s.skillPlayScopes??[]).flatMap(scope=>scope.window?.programs??[])];const old=frames.find(frame=>frame.card===p.counter&&frame.counterPlay);assert.ok(old);old.ops=downgrade(old.ops) as Op[];
 s=answer(copy(s),null);assert.match(JSON.stringify(s.outcome),/rebuild this saved Counter play replacement/);assert.ok(s.sides[owner].zones.hand.includes(p.target));assert.ok(!s.sides[other(owner)].zones.battle.includes(p.counter));cases++;
}
const replacement:Op={op:"resolvingPlay",instead:"drop"};const ordinary:Op={op:"moveTo",target:{sel:{special:"resolving"}},to:"drop"};
assert.deepEqual(playReplacementDescriptor([replacement]),{version:1,to:"drop"});
for(const later of [ordinary,{op:"if",cond:{kind:"all",conds:[]},then:[ordinary]},{op:"delay",at:"turnEnd",ops:[ordinary]}] as Op[])assert.equal(playReplacementDescriptor([replacement,later]),undefined);cases+=4;
const primitive:Op={op:"replace",event:"play",with:[ordinary]};assert.deepEqual(playReplacementDescriptor([primitive]),{version:1,to:"drop"});assert.equal(shortPlayReplacementGap({kind:"counter:play",printed:"If the Battle Card being played has 20000 power or less, place it in its owner's Drop instead.",ops:[primitive]}),null);cases++;
const filtered:Op={op:"moveTo",target:{sel:{special:"resolving",filter:parseFilter("Battle Card")}},to:"drop"};
const filteredSource={kind:"counter:play" as const,ops:[replacement,filtered],unsupported:[],playReplacement:playReplacementDescriptor([replacement,filtered])};assert.doesNotThrow(()=>requirePlayReplacement({ops:[filtered],ip:0,vars:{},card:"x",master:"p1",counterPlay:true},filteredSource));cases++;
assert.equal(shortPlayReplacementGap({kind:"activate:main",printed:"Place it in its owner's Drop instead.",ops:[ordinary]}),null);assert.doesNotThrow(()=>shortPlayReplacementGap({kind:"counter:play",printed:"If the Battle Card being played has 20000 power or less, place it in its owner's Drop instead.",ops:[{op:"moveTo"}]}));cases++;
const frame:ScriptFrame={ops:[ordinary],ip:0,vars:{},card:"x",master:"p1",counterPlay:true};assert.throws(()=>requirePlayReplacement(frame,{kind:"counter:play",ops:[replacement],unsupported:[],playReplacement:{version:0,to:"drop"} as never}),/rebuild this saved Counter replacement descriptor/);cases++;
console.log(`counter-short-replacement-5: ${cases} native cases passed`);
