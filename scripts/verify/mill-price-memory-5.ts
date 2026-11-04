/** R-392: explicit mill prices retain historical characteristics and live occurrences. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { attrsNow, hasKeyword, condHolds, resolveSelector } from "../../src/lib/arena/vm/program";
import { activationsOf, resolveActivation } from "../../src/lib/arena/vm/activate";
import { run } from "../../src/lib/arena/vm/flow";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript, type ScriptFrame } from "../../src/lib/arena/vm/script";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const defs:Record<string,CardDef>={
 LEADER:card("LEADER",{type:"LEADER"}),
 BLUE:card("BLUE",{colors:["Blue"]}),BLACK:card("BLACK",{colors:["Black"]}),MULTI:card("MULTI",{colors:["Black","Red"]}),
 GAINED:card("GAINED",{colors:["Red"],skill:"[Permanent] This card is also treated as black in all areas."}),
};
defs["SD3-01"]=card("SD3-01",{type:"LEADER",colors:["Black"],power:10000,skill:"[Activate: Main] [Once per turn] Place the top 3 cards of your deck in the Drop Area: If you place a black card in the Drop Area with this skill, this card gains [Critical] (When this card inflicts damage to your opponent's life, they place that many cards in their Drop Area instead of their hand) for the duration of the turn. If a card of any other color is placed in the Drop Area, this card also gains +5000 power for the duration of the turn.<br>[Awaken] When your life is at 4 or less: You may draw 2 cards and flip this card over.",back:{name:"Bardock",power:15000,skill:"[Activate: Main] [Once per turn] Place the top 3 cards of your deck in the Drop Area: If you place a black card in the Drop Area with this skill, this card gains [Critical] for the duration of the turn. If a card of any other color is placed in the Drop Area, this card also gains +5000 power for the duration of the turn.<br>[Auto] When this card attacks, draw 1 card."}});
defs.AUTO=card("AUTO",{energyCost:0,power:10000,skill:"[Auto] Place the top 3 cards of your deck in the Drop Area: When this card is played, if you place a black card in the Drop Area with this skill, this card gains [Critical] for the turn. If a card of any other color is placed in the Drop Area, this card gets +5000 power for the turn."});
defs.AUTO_COLLISION=card("AUTO_COLLISION",{...defs.AUTO,id:"AUTO_COLLISION",skill:defs.AUTO.skill!.replace("When this card is played, if", "When this card is played, place the top 1 card of your deck in your Drop Area. If")});
defs.WAIVED=card("WAIVED",{type:"EXTRA",energyCost:0,skill:"[Activate: Main] Place the top 3 cards of your deck in the Drop Area: If you place a black card in the Drop Area with this skill, draw 1 card."});
const records=Object.values(defs).flatMap(skillRecords);
for(const r of records)assert.deepEqual(r.unread,[],r.cardId+"#"+r.skillIndex);
const rows=records.map((r,id)=>({...r,id,source:"compiler",status:"draft"}) as unknown as RuleRow);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(rows),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(ctx,copy(s),a).state as VmState;
function fresh(first:PlayerId):VmState{
 let s=RULES.createGame(ctx,{seed:392,p1:{name:"One",leader:"SD3-01",main:fifty("BLUE")},p2:{name:"Two",leader:"SD3-01",main:fifty("BLUE")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);
 return s;
}
function settle(s:VmState):VmState{
 for(let i=0;i<40&&s.prompt.kind!=="main";i++){
 const legal=RULES.legalActions(ctx,s).map(x=>x.action);
 const a=legal.find(a=>a.type==="counter"&&a.card===null)??legal.find(a=>a.type==="chooseMode"&&a.index===0)??legal[0];assert.ok(a);s=take(s,a);
 }return s;
}
let cases=0;
for(const owner of ["p1","p2"] as const)for(const back of [false,true]){
 const record=records.find(r=>r.cardId==="SD3-01"&&r.side===(back?"back":"front")&&r.skillIndex===0)!;
 assert.deepEqual(record.unread,[]);assert.equal(record.cost!.readable,true);
 for(const pool of [["BLACK","BLACK","BLACK"],["BLUE","BLUE","BLUE"],["BLACK","BLUE","BLUE"],["MULTI","MULTI","MULTI"],["GAINED","GAINED","GAINED"]]){
 let s=fresh(owner);const leader=s.sides[owner].zones.leader[0];s.cards[leader].flipped=back;
 const ids=s.sides[owner].zones.deck.slice(0,3);ids.forEach((id,i)=>s.cards[id].cardId=pool[i]);
 const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===leader&&a.skill===0);assert.ok(a);
 assert.ok(ids.every(id=>s.sides[owner].zones.deck.includes(id)),"offer simulation does not pay");
 s=settle(take(s,a));assert.ok(ids.every(id=>s.sides[owner].zones.drop.includes(id)));
 assert.equal(hasKeyword(ctx,game,s,leader,"Critical"),pool.some(x=>x!=="BLUE"));
 assert.equal(attrsNow(ctx,game,s,leader).power,(back?15000:10000)+(pool.some(x=>x!=="BLACK")?5000:0));cases++;
 }
 const short=fresh(owner),leader=short.sides[owner].zones.leader[0];short.cards[leader].flipped=back;short.sides[owner].zones.deck.splice(2);
 assert.ok(!RULES.legalActions(ctx,short).some(x=>x.action.type==="activate"&&x.action.card===leader&&x.action.skill===0));cases++;
}
for(const owner of ["p1","p2"] as const){
 let s=fresh(owner);const source=s.sides[owner].zones.hand[0];s.cards[source].cardId="AUTO";
 const paid=s.sides[owner].zones.deck.slice(0,3);paid.forEach(id=>s.cards[id].cardId="MULTI");
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="play"&&a.card===source);assert.ok(action);
 s=settle(take(s,action));assert.ok(paid.every(id=>s.sides[owner].zones.drop.includes(id)));assert.equal(hasKeyword(ctx,game,s,source,"Critical"),true);assert.equal(attrsNow(ctx,game,s,source).power,15000);cases++;
}
// Finishing the Auto price removes autoCost before its ordinary effect mill.
for(const owner of ["p1","p2"] as const){
 let s=fresh(owner);const source=s.sides[owner].zones.hand[0];s.cards[source].cardId="AUTO_COLLISION";
 const paid=s.sides[owner].zones.deck.slice(0,3);paid.forEach(id=>s.cards[id].cardId="BLACK");
 const effectMilled=s.sides[owner].zones.deck[3];s.cards[effectMilled].cardId="BLUE";
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="play"&&a.card===source);assert.ok(action);
 s=settle(take(s,action));assert.ok([...paid,effectMilled].every(id=>s.sides[owner].zones.drop.includes(id)));assert.equal(hasKeyword(ctx,game,s,source,"Critical"),true);assert.equal(attrsNow(ctx,game,s,source).power,10000);cases++;
}
// Isolate the real stored payment/effect continuation at its saved boundary.
for(const owner of ["p1","p2"] as const)for(const change of ["color","leave","return"]){
 const s=fresh(owner),leader=s.sides[owner].zones.leader[0];
 const r=records.find(r=>r.cardId==="SD3-01"&&r.side==="front"&&r.skillIndex===0)!;
 const ids=s.sides[owner].zones.deck.slice(0,3);ids.forEach(id=>s.cards[id].cardId="BLACK");
 const effect:ScriptFrame={ops:r.ops,ip:0,vars:{},card:leader,master:owner,pricedBy:{key:"mill-paid",text:r.printed}};
 const price:ScriptFrame={ops:r.cost!.program!,ip:0,vars:{},card:leader,master:owner,saveVarsAs:"mill-paid"};s.programs=[effect];
 assert.equal(stepScript(vmHost(ctx,game,s,[]),price),"done");assert.ok(effect.paidCardInfo?.paid_mill_m0);assert.deepEqual(effect.vars.paid_mill_m0,ids);
 if(change==="color")for(const id of ids)addEffect(s,[],{target:id,kind:"gains",value:{colors:["Red"],names:[],characters:[],traits:[]},until:"turn",master:owner,source:leader});
 else for(const id of ids){assert.ok(moveCard(s,game,id,"hand",{owner}).ok);if(change==="return")assert.ok(moveCard(s,game,id,"drop",{owner}).ok);}
 effect.vars.m0=[]; // a later ordinary effect variable cannot overwrite the reserved paid alias
 const saved=copy(effect);assert.equal(resolveSelector(ctx,game,s,saved,{fromVar:"paid_mill_m0",area:"drop",side:"you"}).length,change==="color"?3:0);
 const cond=saved.ops.find(o=>o.op==="if");assert.ok(cond?.op==="if");assert.equal(condHolds(ctx,game,s,saved,cond.cond),true);
 assert.equal(stepScript(vmHost(ctx,game,s,[]),saved),"done");assert.equal(attrsNow(ctx,game,s,leader).power,10000);assert.equal(hasKeyword(ctx,game,s,leader,"Critical"),true);cases++;
}
for(const owner of ["p1","p2"] as const)for(const replaced of [false,true]){
 const s=fresh(owner),leader=s.sides[owner].zones.leader[0];
 const r=records.find(r=>r.cardId==="SD3-01"&&r.side==="front"&&r.skillIndex===0)!;
 const effect:ScriptFrame={ops:r.ops,ip:0,vars:{},card:leader,master:owner,pricedBy:{key:"failed-mill",text:r.printed}};
 const price:ScriptFrame={ops:r.cost!.program!,ip:0,vars:{},card:leader,master:owner,saveVarsAs:"failed-mill"};s.programs=[effect];
 const host=vmHost(ctx,game,s,[]);let moved=0;
 const failedHost={...host,move:((...args:Parameters<typeof host.move>)=>{if(++moved===2){if(replaced)return host.move(args[0],"hand",owner,args[3]);return "deck" as const;}return host.move(...args);})};
 assert.equal(stepScript(failedHost,price),"done");assert.equal(s.programs.length,0);assert.equal(price.paidCardInfo,undefined);assert.equal(hasKeyword(ctx,game,s,leader,"Critical"),false);cases++;
 // Ordinary effect mill keeps its ordinary variable but cannot manufacture payment history.
 const ordinary:ScriptFrame={ops:r.cost!.program!,ip:0,vars:{},card:leader,master:owner};
 assert.equal(stepScript(host,ordinary),"done");assert.equal(ordinary.paidCardInfo,undefined);cases++;
}
// The invocation boundary waives this printed price, so its known paid pool is empty.
for(const owner of ["p1","p2"] as const)for(const existing of [false,true]){
 const s=fresh(owner);const source=s.sides[owner].zones.hand[0];s.cards[source].cardId="WAIVED";
 const line=activationsOf(ctx,s,game.actions.activate!,source,game).find(l=>l.card===source)!;assert.ok(line);
 const historical=s.sides[owner].zones.deck[0];s.cards[historical].cardId="BLACK";
 const resolved=existing?{vars:{paid_mill_m0:[historical],"paid_mill_m0@epoch":[`${historical}@0`]},paidCardInfo:{paid_mill_m0:{[historical]:attrsNow(ctx,game,s,historical)}}}:undefined;
 const before=s.sides[owner].zones.deck.length;
 resolveActivation(ctx,game,s,[],owner,line,undefined,undefined,resolved,true);run(ctx,game,s,[]);assert.equal(s.prompt.kind,"main");
 assert.equal(s.sides[owner].zones.deck.length,before-(existing?1:0));cases++;
}
console.log(`Mill price memory 5: ${cases} both-seat stored/native scenarios passed`);
