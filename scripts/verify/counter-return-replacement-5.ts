/** R464: conditional hand replacements preserve the original play boundary. */
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
const defs:Record<string,CardDef>={F:card("F",{}),L:card("L",{type:"LEADER",colors:["Green"],characters:["Son Goku"]}),HIGH:card("HIGH",{energyCost:6,power:40000}),DEFLECT:card("DEFLECT",{skill:"[Deflect]"}),UNISON:card("UNISON",{type:"UNISON"}),SOURCE:card("SOURCE",{skill:"[Activate: Main] Choose up to 1 Battle Card from your hand and play it."}),SOURCEANY:card("SOURCEANY",{skill:"[Activate: Main] Choose up to 1 Unison Card from your hand and play it with 2 markers on it."})};
defs.AUTO=card("AUTO",{skill:"[Auto] When this card is played, draw 1 card."});
defs.NEG=card("NEG",{type:"EXTRA",skill:"[Counter: Counter] Negate the [Counter]."});
for(const color of ["Red","Green","Blue","Yellow","Black","White"] as const)defs[color]=card(color,{colors:[color]});
defs["P-337"]=card("P-337",{"type": "BATTLE", "name": "Zamasu, the Eliminator", "colors": ["Blue", "Yellow"], "power": 5000, "characters": ["Zamasu"], "traits": ["God"], "skill": "[energy-exhaust][indestructible]<br>[counter: play] Play this card, and if the card being played has an energy cost of 4 or less, return it to its owner&apos;s hand instead.<br>[permanent] If you have another Blue/Yellow multicolor card in your energy, negate this card&apos;s [energy-exhaust] skill in all areas.<br>[auto] When this card is played, draw 1 card, then choose up to 1 of your opponent&apos;s Battle Cards and switch it to Rest Mode.", "energyCost": 2, "specifiedCost": {"Blue": 1, "Yellow": 1}});
defs["BT15-036"]=card("BT15-036",{"type": "BATTLE", "name": "Vados, Right on Time", "colors": ["Blue"], "power": 19000, "characters": ["Vados"], "traits": ["God", "Universe 6"], "skill": "[Dual Attack]<br>[Counter: Play] Play this card, and if the Battle Card being played has an energy cost of 3 or less, return it to its owner's hand instead.<br>[Permanent] During your opponent's turn, reduce the energy cost of this card in your hand by 1.", "energyCost": 3, "specifiedCost": {"Blue": 2}});
defs["BT17-055"]=card("BT17-055",{"type": "BATTLE", "name": "Android 15, Inorganic Horror", "colors": ["Blue"], "power": 5000, "characters": ["Android 15"], "traits": ["Android", "Red Ribbon Army"], "skill": "[Deflect]\r\n[Counter: Play] Play this card, and if the Battle Card being played has an energy cost of 3 or less, return it to its owner's hand instead.\r\n[Permanent] If your Leader Card is a blue ≪Red Ribbon Army≫ card, you can activate this card's [Counter] skill from your energy by paying its energy cost.\r\n[Permanent][Bond 3] Blue ≪Android≫: This card gets +10000 power.", "energyCost": 2, "specifiedCost": {"Blue": 1}});
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
const names=["P-337","BT15-036","BT17-055"];
function prepared(owner:PlayerId,name:string,targetDef="F",useCtx=ctx){
 let s=fresh(owner);const source=stage(s,owner,targetDef==="UNISON"?"SOURCEANY":"SOURCE","battle"),target=stage(s,owner,targetDef,"hand"),counter=stage(s,other(owner),name,"hand");
 for(const color of ["Red","Green","Blue","Yellow","Black","White","Green","Blue"])stage(s,other(owner),color,"energy");
 const action=RULES.legalActions(useCtx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source);assert.ok(action);s=RULES.apply(useCtx,copy(s),action).state as VmState;return {s,source,target,counter};
}
function untilChoice(s:VmState){for(let n=0;n<30&&s.prompt.kind!=="chooseCards";n++){assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));const actions=RULES.legalActions(ctx,s).map(x=>x.action),a=actions.find(a=>a.type==="payCost")??actions.find(a=>a.type==="counter"&&a.card===null);assert.ok(a,JSON.stringify(s.prompt));s=take(s,a);}assert.equal(s.prompt.kind,"chooseCards");return s;}
for(const owner of ["p1","p2"] as const)for(const name of names)for(const targetDef of ["F","AUTO","HIGH","DEFLECT","UNISON",null]){
 const p=prepared(owner,name,targetDef??"F");let s=p.s;const ownDeck=s.sides[other(owner)].zones.deck.length,ownHand=s.sides[other(owner)].zones.hand.length;assert.equal(s.prompt.kind,"counter");assert.ok(RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===p.counter),name);s=untilChoice(answer(s,p.counter));assert.ok(s.prompt.kind==="chooseCards");assert.equal(s.prompt.player,owner,`${name} parent choice`);if(name==="P-337"){assert.ok(s.sides[other(owner)].zones.battle.includes(p.counter),"independent self-play precedes future target selection");assert.equal(s.sides[other(owner)].zones.deck.length,ownDeck,"own arrival Auto waits until parent/Counter timings finish");assert.ok(s.pending.some(auto=>auto.card===p.counter));}
 const ownerDeck=s.sides[owner].zones.deck.length,ownerHand=s.sides[owner].zones.hand.length;
 const spent=s.sides[other(owner)].zones.energy.filter(id=>s.cards[id].mode==="rest").length;
 s=take(s,{type:"choose",player:owner,cards:targetDef?[p.target]:[]});s=finish(s);
 const replaced=targetDef==="F"||targetDef==="AUTO";assert.equal(s.sides[owner].zones.battle.includes(p.target),!!targetDef&&targetDef!=="UNISON"&&!replaced,`${name} ${targetDef}`);
 if(replaced)assert.ok(s.sides[owner].zones.hand.includes(p.target));
 if(targetDef==="AUTO"){assert.equal(s.sides[owner].zones.hand.length,ownerHand);assert.equal(s.sides[owner].zones.deck.length,ownerDeck);}
 if(targetDef==="UNISON")assert.ok(s.sides[owner].zones.unison.includes(p.target));
 assert.equal(s.sides[other(owner)].zones.battle.includes(p.counter),true,`${name} self-play ${targetDef}`);
 assert.equal(s.sides[other(owner)].zones.energy.filter(id=>s.cards[id].mode==="rest").length,spent);assert.equal(s.skillPlayScopes,undefined);if(name==="P-337"){assert.equal(s.sides[other(owner)].zones.deck.length,ownDeck-1);assert.equal(s.sides[other(owner)].zones.hand.length,ownHand,"own arrival draw resolves exactly once after Counter source leaves hand");}cases++;
}
function downgrade(value:unknown):unknown{
 if(Array.isArray(value))return value.map(downgrade);if(!value||typeof value!=="object")return value;const op=value as Record<string,unknown>;
 if(op.op==="resolvingPlay"&&(op.instead==="hand"||op.instead==="deck"))return {op:"moveTo",target:{sel:{special:"resolving"}},to:op.instead,...(op.position?{position:op.position}:{reveal:true})};
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
const replacement:Op={op:"resolvingPlay",instead:"hand"};const ordinary:Op={op:"moveTo",target:{sel:{special:"resolving"}},to:"hand"};
assert.deepEqual(playReplacementDescriptor([replacement]),{version:1,to:"hand"});
for(const later of [ordinary,{op:"if",cond:{kind:"all",conds:[]},then:[ordinary]},{op:"delay",at:"turnEnd",ops:[ordinary]}] as Op[])assert.equal(playReplacementDescriptor([replacement,later]),undefined);cases+=4;
const primitive:Op={op:"replace",event:"play",with:[ordinary]};assert.deepEqual(playReplacementDescriptor([primitive]),{version:1,to:"hand"});assert.equal(shortPlayReplacementGap({kind:"counter:play",printed:"If the Battle Card being played has 20000 power or less, return it to its owner's hand instead.",ops:[primitive]}),null);cases++;
const filtered:Op={op:"moveTo",target:{sel:{special:"resolving",filter:parseFilter("Battle Card")}},to:"hand"};
const filteredSource={kind:"counter:play" as const,ops:[replacement,filtered],unsupported:[],playReplacement:playReplacementDescriptor([replacement,filtered])};assert.doesNotThrow(()=>requirePlayReplacement({ops:[filtered],ip:0,vars:{},card:"x",master:"p1",counterPlay:true},filteredSource));cases++;
assert.equal(shortPlayReplacementGap({kind:"activate:main",printed:"Return it to its owner's hand instead.",ops:[ordinary]}),null);assert.doesNotThrow(()=>shortPlayReplacementGap({kind:"counter:play",printed:"If the Battle Card being played has 20000 power or less, return it to its owner's hand instead.",ops:[{op:"moveTo"}]}));cases++;
const frame:ScriptFrame={ops:[ordinary],ip:0,vars:{},card:"x",master:"p1",counterPlay:true};assert.throws(()=>requirePlayReplacement(frame,{kind:"counter:play",ops:[replacement],unsupported:[],playReplacement:{version:0,to:"hand"} as never}),/rebuild this saved Counter replacement descriptor/);cases++;
// Actual declared play and already-landed after windows use the same corrected record.
for(const owner of ["p1","p2"] as const)for(const name of names)for(const timing of ["declared","after"] as const){
 let s:VmState,target:string,counter:string;
 if(timing==="after"){
  const p=prepared(owner,name);s=untilChoice(answer(p.s,null));target=p.target;counter=p.counter;
  s=take(s,{type:"choose",player:owner,cards:[target]});assert.equal(s.prompt.kind,"counter");assert.equal(s.resolving?.scopeWindow?.boundary,"after");assert.ok(s.sides[owner].zones.battle.includes(target));
 }else{
  s=fresh(owner);target=stage(s,owner,"F","hand");counter=stage(s,other(owner),name,"hand");
  stage(s,owner,"Red","energy");for(const color of ["Blue","Yellow","Blue","Yellow","Blue","Yellow"])stage(s,other(owner),color,"energy");
  s=take(s,{type:"play",player:owner,card:target});assert.equal(s.prompt.kind,"counter");
 }
 assert.ok(RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===counter));
 s=finish(answer(s,counter));assert.ok(s.sides[other(owner)].zones.battle.includes(counter));
 assert.ok(s.sides[owner].zones[timing==="after"?"battle":"hand"].includes(target),`${name} ${timing} replacement boundary`);assert.equal(s.skillPlayScopes,undefined);cases++;
}
for(const owner of ["p1","p2"] as const)for(const name of names)for(const negate of [false,true]){
 const p=prepared(owner,name);let s=p.s;const answerCard=stage(s,owner,"NEG","hand");stage(s,owner,"Red","energy");
 s=answer(s,p.counter);while(s.prompt.kind==="payCost"){const pay=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="payCost");assert.ok(pay);s=take(s,pay);}
 assert.equal(s.prompt.kind,"counter");assert.equal(s.prompt.player,owner);s=answer(s,negate?answerCard:null);
 s=untilChoice(s);s=take(s,{type:"choose",player:owner,cards:[p.target]});s=finish(s);
 assert.ok(s.sides[other(owner)].zones[negate?"drop":"battle"].includes(p.counter));assert.ok(s.sides[owner].zones[negate?"battle":"hand"].includes(p.target));assert.equal(s.skillPlayScopes,undefined);cases++;
}
console.log(`counter-return-replacement-5: ${cases} native cases passed`);
