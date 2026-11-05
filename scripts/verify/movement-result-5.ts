/** R-426: native stored one-card hinges and staged original movement outcome faults. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript, type ScriptFrame, type Op } from "../../src/lib/arena/vm/script";
import { completedMovement, requireMovementResults } from "../../src/lib/arena/vm/movement-result";
import { NotYet } from "../../src/lib/arena/vm/errors";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { parseRule, printOps, validateRule } from "../../src/lib/arena/lang";
import { programProblem } from "../../src/lib/arena/vm/script-schema";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const defs:Record<string,CardDef>={LEADER:card("LEADER",{type:"LEADER"}),FILLER:card("FILLER",{}),"TB2-024":card("TB2-024",{skill:"[Auto] When this card attacks, you may choose 1 card from your life and add it to your hand. If you do so, this card gains +10000 power for the duration of the turn."})};
const rows=Object.values(defs).flatMap(skillRecords).map((r,id)=>({...r,id,source:"compiler",status:"confirmed"}) as unknown as RuleRow);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(rows),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(ctx,copy(s),a).state as VmState;
function fresh(first:PlayerId):VmState{
 let s=RULES.createGame(ctx,{seed:426,p1:{name:"One",leader:"LEADER",main:fifty("FILLER")},p2:{name:"Two",leader:"LEADER",main:fifty("FILLER")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null},{type:"endMain",player:first},{type:"charge",player:other(first),card:null},{type:"endMain",player:other(first)},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);
 return s;
}
function frame(s:VmState,master:PlayerId,ids:string[]):ScriptFrame{return {ops:[{op:"moveTo",target:{var:"pick"},to:"drop",completedAs:"pick"}],ip:0,vars:{pick:ids,"pick@epoch":ids.map(id=>`${id}@${s.cards[id].zoneEpoch??0}`)},card:s.sides[master].zones.leader[0],master};}
let cases=0;
// Actual stored attack Auto, both seats; a saved chooser retains zero/one cardinality.
for(const owner of ["p1","p2"] as const)for(const accept of [false,true]){
 let s=fresh(owner);const source=s.sides[owner].zones.hand[0];s.cards[source].cardId="TB2-024";assert.ok(moveCard(s,game,source,"battle",{owner}).ok);
 s=take(s,{type:"attack",player:owner,attacker:source,target:s.sides[other(owner)].zones.leader[0]});
 for(let i=0;i<12&&s.prompt.kind!=="chooseCards";i++){const pass=RULES.legalActions(ctx,s).map(x=>x.action).find(x=>x.type==="counter"&&x.card===null);assert.ok(pass);s=take(s,pass);}
 assert.equal(s.prompt.kind,"chooseCards");if(s.prompt.kind!=="chooseCards")throw Error("choice");assert.equal(s.prompt.choice.min,0);assert.equal(s.prompt.choice.max,1);
 const selected=s.prompt.choice.candidates[0],before=s.sides[owner].zones.hand.length;
 if(accept){
  const legacyState=copy(s),waiting=legacyState.programs.find(f=>f.card===source)!;assert.ok(waiting);
  for(const op of waiting.ops){if(op.op==="moveTo")delete op.completedAs;if(op.op==="if")op.cond={kind:"chose",var:"c0"};}
  const refused=take(legacyState,{type:"choose",player:owner,cards:[selected]});assert.match(JSON.stringify(refused.outcome),/original-movement completion contract/);assert.equal(refused.sides[owner].zones.hand.length,before);cases++;
 }
 s=take(copy(s),{type:"choose",player:owner,cards:accept?[selected]:[]});
 assert.equal(s.sides[owner].zones.hand.length,before+Number(accept));
 assert.equal(vmHost(ctx,game,s,[]).amount({ops:[],ip:0,vars:{},card:source,master:owner},{attr:{sel:{special:"self"}},name:"power"}),accept?20000:10000);cases++;
}
// Typed VM fault controls use the native mover, not a fake move success boolean.
for(const owner of ["p1","p2"] as const)for(const count of [0,1,2]){
 const s=fresh(owner),ids=s.sides[owner].zones.hand.slice(0,count),f=frame(s,owner,ids),h=vmHost(ctx,game,s,[]);
 assert.equal(stepScript(h,f),"done");assert.equal(completedMovement(copy(f),"pick",1,true),count>0);assert.equal(completedMovement(f,"pick",2),count===2);cases++;
}
for(const owner of ["p1","p2"] as const){
 const s=fresh(owner),ids=s.sides[owner].zones.hand.slice(0,2),f=frame(s,owner,ids),h=vmHost(ctx,game,s,[]);
 // Return one chosen card to its area as a fresh occurrence before resolution.
 assert.ok(moveCard(s,game,ids[0],"drop",{owner}).ok);assert.ok(moveCard(s,game,ids[0],"hand",{owner}).ok);
 assert.equal(stepScript(h,f),"done");assert.equal(completedMovement(f,"pick",1,true),false);assert.equal(completedMovement(f,"pick",1),true);assert.ok(s.sides[owner].zones.hand.includes(ids[0]));cases++;
}
// Typed installed redirects include same-destination replacement: final area alone is insufficient.
for(const owner of ["p1","p2"] as const)for(const destination of ["drop","hand"] as const){
 const state=fresh(owner),id=state.sides[owner].zones.hand[0];assert.ok(moveCard(state,game,id,"battle",{owner}).ok);
 const f=frame(state,owner,[id]),h=vmHost(ctx,game,state,[]);
 assert.equal(stepScript(h,{...frame(state,owner,[id]),ops:[{op:"replaceLeave",from:["battle"],requestedTo:"drop",to:destination,until:"turn",target:{var:"pick"}}]}),"done");
 assert.equal(stepScript(h,f),"done");assert.ok(state.sides[owner].zones[destination].includes(id));assert.equal(completedMovement(copy(f),"pick",1,true),false);cases++;
}
for(const owner of ["p1","p2"] as const)for(const normalized of ["token","z"] as const){
 const state=fresh(owner),id=state.sides[owner].zones.hand[0];assert.ok(moveCard(state,game,id,"battle",{owner}).ok);
 if(normalized==="token"){defs["TOKEN:R426"]=card("TOKEN:R426",{});state.cards[id].cardId="TOKEN:R426";}else state.cards[id].zCard=true;
 const f=frame(state,owner,[id]);assert.equal(stepScript(vmHost(ctx,game,state,[]),f),"done");assert.ok(state.sides[owner].zones.removed.includes(id));assert.equal(completedMovement(f,"pick",1,true),false);cases++;
}
for(const owner of ["p1","p2"] as const){
 const state=fresh(owner),id=state.sides[owner].zones.hand[0];assert.ok(moveCard(state,game,id,"battle",{owner}).ok);
 const f=frame(state,owner,[id]),h=vmHost(ctx,game,state,[]);
 assert.equal(stepScript(h,{...frame(state,owner,[id]),ops:[{op:"forbid",what:"beMovedBySkill",side:"you",until:"turn",target:{var:"pick"}}]}),"done");
 assert.equal(stepScript(h,f),"done");assert.ok(state.sides[owner].zones.battle.includes(id));assert.equal(completedMovement(f,"pick",1,true),false);cases++;
}
// Save/reload at a real optional replacement prompt; reject a fresh chosen occurrence.
for(const owner of ["p1","p2"] as const){
 let state=fresh(owner);const id=state.sides[owner].zones.hand[0];assert.ok(moveCard(state,game,id,"battle",{owner}).ok);
 const f=frame(state,owner,[id]),h=vmHost(ctx,game,state,[]);
 assert.equal(stepScript(h,{...frame(state,owner,[id]),ops:[{op:"replaceLeave",from:["battle"],requestedTo:"drop",to:"hand",optional:true,until:"turn",target:{var:"pick"}}]}),"done");
 assert.equal(stepScript(h,f),"wait");assert.equal(state.prompt.kind,"replaceMove");
 assert.ok(moveCard(state,game,id,"hand",{owner}).ok);assert.ok(moveCard(state,game,id,"battle",{owner}).ok);
 state=take(copy(state),{type:"chooseMode",player:owner,index:0});assert.ok(state.sides[owner].zones.battle.includes(id));cases++;
}
const record=rows.find(r=>r.cardId==="TB2-024")!;assert.deepEqual(runtimeSupportOfRow(record).unsupported,[]);
const old=copy(record);for(const op of old.ops as Op[]){if(op.op==="moveTo")delete op.completedAs;if(op.op==="if")op.cond={kind:"chose",var:"c0"};}
for(const status of ["draft","confirmed","corrected"] as const){const stale={...old,status};assert.ok(runtimeSupportOfRow(stale).unsupported.some(s=>s.includes("movement completion")));const scripts=rulesFromRows([stale],defs);assert.ok(scripts["TB2-024"].bySkill[0].unsupported?.length);cases++;}
const legacy:ScriptFrame={ops:copy(old.ops as Op[]),ip:2,vars:{c0:[]},card:"source",master:"p1"};
assert.throws(()=>requireMovementResults(legacy,ctx.scripts!["TB2-024"].bySkill[0]),e=>e instanceof NotYet&&e instanceof IllegalAction);cases++;
const alreadySpliced=copy(legacy);alreadySpliced.ops.splice(2,1,{op:"draw",n:1});assert.throws(()=>requireMovementResults(alreadySpliced,ctx.scripts!["TB2-024"].bySkill[0]),NotYet);cases++;
const unrelated=copy(legacy);unrelated.ops=[{op:"draw",n:1}];assert.doesNotThrow(()=>requireMovementResults(unrelated,ctx.scripts!["TB2-024"].bySkill[0]));cases++;
const missing=frame(fresh("p1"),"p1",[]);missing.ip=1;assert.throws(()=>requireMovementResults(missing,undefined),NotYet);cases++;
for(const hinge of ["If you don’t", "If you didn't", "If you didn’t", "If you do not", "If they don't", "If not"]){
 const stale={...old,printed:old.printed.replace("If you do so",hinge)};
 assert.ok(runtimeSupportOfRow(stale).unsupported.some(reason=>reason.includes("movement completion")));cases++;
}
for(const to of ["under","play"] as const){
 const state=fresh("p1"),id=state.sides.p1.zones.hand[0],f=frame(state,"p1",[id]);f.ops=[{op:"moveTo",target:{var:"pick"},to,completedAs:"pick"}];
 assert.ok(programProblem(f.ops));assert.throws(()=>stepScript(vmHost(ctx,game,state,[]),f),NotYet);assert.ok(state.sides.p1.zones.hand.includes(id));cases++;
}
const broken=frame(fresh("p1"),"p1",[]);broken.movementResults={pick:{version:1,selected:[],outcomes:[]}};(broken.movementResults.pick as unknown as {version:number}).version=0;
assert.throws(()=>completedMovement(broken,"pick"),NotYet);cases++;
const contract:Op[]=[{op:"moveTo",target:{var:"pick"},to:"drop",completedAs:"pick"},{op:"if",cond:{kind:"moved",var:"pick",all:true},then:[]}];
assert.equal(programProblem(contract),null);const parsed=parseRule(`WHEN [Activate: Main]\nTHEN\n${printOps(contract)}`);assert.ok(parsed.ok);assert.equal(validateRule(parsed.value,parsed.value.kind),null);assert.deepEqual(parsed.value.ops,contract);cases++;
// Adjacent modal hinges are covered; cross-body delayed/conditional hinges stay outside this batch.
for(const [id,skill] of [
 ["BT7-036", "[Auto] When you combo with this card and your Leader Card is blue, you may choose 1 card from your hand and place it in your Drop Area. If you do, choose oneー ・Choose up to 3 Battle Cards with an energy cost of 3 or more and power of 35000 or less in your Drop Area and place them at the bottom of your deck in any order. ・Choose 1 Battle Card in your opponent's Drop Area, return it to your opponent's deck, then your opponent shuffles their deck."],
 ["BT11-030", "[Counter: Attack] If your Leader Card is red: Negate the attack. You may choose 1 card in your hand and discard it. If you do, choose one— ・Your opponent can't attack with Battle Cards with 30000 power or more for the turn. ・Your opponent can't attack with Unison Cards with 30000 power or more for the turn."]
]){const row=skillRecords(card(id,{skill}))[0];assert.match(JSON.stringify(row.ops),/"kind":"moved"/);assert.deepEqual(runtimeSupportOfRow({...row,id:999,status:"confirmed",source:"compiler"} as unknown as RuleRow).unsupported,[]);cases++;}
for(const [id,skill] of [
 ["BT8-033", "[Auto] When you play this card, activate this skill. At the end of the turn, you may choose 1 Blue/Green multicolor card in your energy, and return it to your hand. If you do, choose 1 card in your hand and place it in your energy in Rest Mode."],
 ["TB3-033", "[Counter: Attack] Negate the attack, and if your Leader Card is a ≪Bardock's Crew≫ card, you may choose 1 blue card in your hand and place it in your Drop Area. If you do, add this card to your hand."]
]){const row=skillRecords(card(id,{skill}))[0];assert.doesNotMatch(JSON.stringify(row.ops),/"kind":"moved"|"completedAs"/);
 if(id==="TB3-033")for(const owner of ["p1","p2"] as const){const state=fresh(owner),f=frame(state,owner,[]);f.ops=copy(row.ops as Op[]);assert.equal(stepScript(vmHost(ctx,game,state,[]),f),"done");assert.equal(f.movementResults,undefined);cases++;}cases++;}
// P-129 has three actions, so a one-card witness alone cannot certify its entire price-like offer.
const composite=card("P-129",{colors:["Yellow"],energyCost:1,power:4000,characters:["Zamasu"],traits:["God"],skill:"[Auto] When you play this card, draw 1 card.<br>[Auto] When your opponent attacks with a card, you may choose 1 yellow card in your hand and place it in your Drop Area, choose 1 of your yellow energy and switch it to Rest Mode, and place this card in its owner's Drop Area. If you do, negate the attack."});
const compositeRecord=skillRecords(composite).find(row=>row.skillIndex===10)!;
for(const status of ["draft","confirmed","corrected"] as const){const row={...compositeRecord,id:426,status,source:"compiler"} as unknown as RuleRow;assert.ok(runtimeSupportOfRow(row).unsupported.some(reason=>reason.includes("movement completion")));assert.ok(rulesFromRows([row],{[composite.id]:composite})[composite.id].bySkill[10].unsupported.length);cases++;}
console.log(`movement-result-5: ${cases} cases passed`);
