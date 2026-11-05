/** R476 script/native mode ordering; optional entry procedures remain unadmitted. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { captureEnergyEntryMode } from "../../src/lib/arena/vm/energy-entry-mode";

const defs = {
  L: card("L", { type: "LEADER" }), F: card("F", {}),
  E: card("E", { skill: "[Energy-Exhaust]" }),
  K: card("K", { skill: "[Blocker]" }),
  "BT8-120": card("BT8-120", { colors: ["Blue", "Green"], skill: "[Energy-Exhaust]\n[Permanent] If you have a Blue/Green multicolor card in your energy, negate this card's [Energy-Exhaust] in all areas." }),
  "EX18-05": card("EX18-05", { colors: ["Blue", "Yellow"], traits: ["Boujack Brigade"], skill: "[Energy-Exhaust]\n[Permanent] If you have a ≪Boujack Brigade≫ card in your energy, reduce the combo cost of this card by 1 and negate its [Energy-Exhaust] skill in all areas." }),
  "BT14-151": card("BT14-151", { colors: ["Green", "Yellow"], traits: ["Android"], skill: "[Energy-Exhaust]\n[Permanent] If there are 3 or more ≪Android≫ cards in your Drop Area, negate this card's [Energy-Exhaust] skill in all areas." }),
  BG: card("BG", { colors: ["Blue", "Green"] }),
  BO: card("BO", { traits: ["Boujack Brigade"] }),
  AND: card("AND", { traits: ["Android"] }),
};
const rows = Object.values(defs).flatMap(skillRecords);
for (const row of rows) assert.deepEqual(row.unread, [], `${row.cardId}#${row.skillIndex}`);
const ctx: EngineContext = { defs, scripts: rulesFromRows(rows.map((row, id) => ({ ...row, id, status: "draft", source: "compiler" }) as unknown as RuleRow), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
function fresh(): VmState { return RULES.createGame(ctx, { seed: 476, p1: { name: "One", leader: "L", main: fifty("F") }, p2: { name: "Two", leader: "L", main: fifty("F") } }).state as VmState; }
function stage(state: VmState, player: PlayerId, cardId: string, area: string): string {
  const id = state.sides[player].zones.deck.at(-1)!; state.cards[id].cardId = cardId;
  assert.ok(moveCard(state, game, id, area, { owner: player }).ok); return id;
}

import { addEffect } from "../../src/lib/arena/vm/effects";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript, type ScriptFrame } from "../../src/lib/arena/vm/script";
import type { Action, GameEvent } from "../../src/lib/arena/types";
let cases=0;
for(const player of ["p1","p2"] as const)for(const kind of ["E","F","BT8-120","EX18-05"] as const)for(const explicit of [undefined,"active","rest"] as const)for(const prior of [false,true]){
 const state=fresh(); if(prior) {stage(state,player,"BG","energy");stage(state,player,"BO","energy");}
 const id=stage(state,player,kind,"hand");
 const exhausts=kind==="E" || ((kind==="BT8-120" || kind==="EX18-05") && !prior);
 const expected=explicit==="rest" || exhausts ? "rest" : "active";
 assert.equal(captureEnergyEntryMode(ctx,game,state,id,explicit).mode,expected);
 const frame:ScriptFrame={card:id,master:player,ops:[{op:"moveTo",target:{sel:{special:"self"}},to:"energy",...(explicit?{mode:explicit}:{})}],ip:0,vars:{}};
 const events:GameEvent[]=[];const host=vmHost(ctx,game,state,events,frame),move=host.move;
 host.move=(card,to,owner,opts)=>move(card,to,owner,{...opts,onResult:outcome=>{assert.equal(state.cards[id].mode,expected,"completion observer sees final mode");opts?.onResult?.(outcome);}});
 assert.equal(stepScript(host,frame),"done");assert.equal(state.cards[id].mode,expected);
 assert.equal(events.filter(e=>e.type==="move"&&e.card===id).length,1);cases++;
}
for(const player of ["p1","p2"] as const)for(const kind of ["E","F","BT8-120","EX18-05"] as const)for(const prior of [false,true]){
 let state=fresh();const other=player==="p1"?"p2":"p1";
 for(const action of [{type:"chooseFirst",player:state.chooser,first:player},{type:"mulligan",player,redraw:false},{type:"mulligan",player:other,redraw:false}] as Action[]) state=RULES.apply(ctx,state,action).state as VmState;
 if(prior){stage(state,player,"BG","energy");stage(state,player,"BO","energy");}
 const id=stage(state,player,kind,"hand"),expected=kind==="E" || ((kind==="BT8-120" || kind==="EX18-05") && !prior) ? "rest" : "active";
 state=RULES.apply(ctx,JSON.parse(JSON.stringify(state)),{type:"charge",player,card:id}).state as VmState;
 assert.ok(state.sides[player].zones.energy.includes(id));assert.equal(state.cards[id].mode,expected);cases++;
}
for(const player of ["p1","p2"] as const)for(const mode of ["active","rest"] as const){
 const state=fresh(),id=stage(state,player,"F","hand"),frame:ScriptFrame={card:id,master:player,ops:[{op:"moveTo",target:{sel:{special:"self"}},to:"battle",mode}],ip:0,vars:{}};
 assert.equal(stepScript(vmHost(ctx,game,state,[],frame),frame),"done");assert.equal(state.cards[id].mode,mode);cases++;
}
for(const player of ["p1","p2"] as const)for(const mode of ["active","rest"] as const){
 const state=fresh(),id=stage(state,player,"E","hand");
 addEffect(state,[],{target:id,kind:"negateKeyword",value:"Energy-Exhaust",until:"turn"});
 const frame:ScriptFrame={card:id,master:player,ops:[{op:"moveTo",target:{sel:{special:"self"}},to:"energy",mode}],ip:0,vars:{}};
 assert.equal(stepScript(vmHost(ctx,game,state,[],frame),frame),"done");assert.equal(state.cards[id].mode,mode);
 assert.equal(captureEnergyEntryMode(ctx,game,state,id).restRequired,true,"old occurrence negation is cleared without changing entry mode");cases++;
}
for(const player of ["p1","p2"] as const)for(const destination of ["energy","drop"] as const)for(const kind of ["E","F"] as const)for(const mode of ["active","rest"] as const){
 const state=fresh(),id=stage(state,player,kind,"hand"),redirect=destination==="energy"?"battle":"energy";
 const expected=redirect==="energy"&&kind==="E"?"rest":mode;
 const frame:ScriptFrame={card:id,master:player,ops:[{op:"moveTo",target:{sel:{special:"self"}},to:destination,mode}],ip:0,vars:{}};
 const host=vmHost(ctx,game,state,[],frame),move=host.move;
 host.move=(card,to,owner,opts)=>move(card,to,owner,{...opts,replaced:{to:redirect}});
 assert.equal(stepScript(host,frame),"done");assert.ok(state.sides[player].zones[redirect].includes(id));assert.equal(state.cards[id].mode,expected,`${destination} redirected to ${redirect}`);cases++;
}
for(const player of ["p1","p2"] as const)for(const count of [2,3])for(const mode of [undefined,"active","rest"] as const){
 const state=fresh(),id=stage(state,player,"BT14-151","drop");
 for(let i=1;i<count;i++)stage(state,player,"AND","drop");
 const expected=count<3 || mode==="rest" ? "rest" : "active";
 const frame:ScriptFrame={card:id,master:player,ops:[{op:"moveTo",target:{sel:{special:"self"}},to:"energy",...(mode?{mode}:{})}],ip:0,vars:{}};
 const host=vmHost(ctx,game,state,[],frame),move=host.move;
 host.move=(card,to,owner,opts)=>move(card,to,owner,{...opts,onResult:outcome=>{assert.equal(state.cards[id].mode,expected,"Drop threshold is observed before the incoming Android leaves");opts?.onResult?.(outcome);}});
 assert.equal(stepScript(host,frame),"done");assert.equal(state.cards[id].mode,expected);assert.ok(state.sides[player].zones.energy.includes(id));
 assert.equal(state.sides[player].zones.drop.filter(card=>state.cards[card].cardId==="AND").length,count-1);
 assert.equal(captureEnergyEntryMode(ctx,game,state,id).restRequired,true,"post-entry Drop count is below three in both cases");cases++;
}
for(const player of ["p1","p2"] as const)for(const change of ["missing","active","otherRest","otherEffect"] as const){
 const altered=structuredClone(game),state=fresh(),id=stage(state,player,change.startsWith("other")?"K":"E","hand");
 if(change==="missing")altered.keywords["Energy-Exhaust"].hooks=[];
 if(change==="active")altered.keywords["Energy-Exhaust"].hooks=[{at:"chargeLimit",ops:[{op:"modifyAttr",target:{sel:{special:"self"}},attr:"mode",mode:"active"}]}];
 if(change.startsWith("other"))altered.keywords.Blocker.hooks=[{at:"chargeLimit",ops:change==="otherRest"?[{op:"modifyAttr",target:{sel:{special:"self"}},attr:"mode",mode:"rest"}]:[{op:"draw",n:1}]}];
 const frame:ScriptFrame={card:id,master:player,ops:[{op:"moveTo",target:{sel:{special:"self"}},to:"energy",mode:"active"}],ip:0,vars:{}};
 const events:GameEvent[]=[];
 if(change==="active" || change==="otherEffect"){
  const before=JSON.stringify(state);
  assert.throws(()=>stepScript(vmHost(ctx,altered,state,events,frame),frame),/chargeLimit/);
  assert.equal(JSON.stringify(state),before,"unsupported hook refuses before movement");assert.deepEqual(events,[]);
 } else {
  assert.equal(stepScript(vmHost(ctx,altered,state,events,frame),frame),"done");
  assert.equal(state.cards[id].mode,change==="otherRest"?"rest":"active","declared hook body controls arrival independent of keyword name");
 }
 cases++;
}
console.log(`energy-entry-mode-native-5: ${cases} script/native arrival mode checks passed`);
