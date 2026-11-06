import { priceFromCostRecord } from "../../src/lib/arena/vm/skill-payment";
import type { CostRecord } from "../../src/lib/arena/vm/script";
/** R477 bounded native writer fixtures; no catalog admission. */
import assert from "node:assert/strict";
import fixtures from "./fixtures/standing-negation-observation-5.json";
import currentWhis from "./fixtures/standing-negation-whis-r479.json";
import { CTX, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { Action, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { CardScripts, Script, ScriptFrame } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import { newCard } from "../../src/lib/arena/vm/zones";
import { draw, moved } from "../../src/lib/arena/vm/flow";
import { resolvePlay } from "../../src/lib/arena/vm/play";
import { vmHost } from "../../src/lib/arena/vm/host";
import { hasKeyword } from "../../src/lib/arena/vm/program";
import { addEffect, endEffects, skillsNegated } from "../../src/lib/arena/vm/effects";
import { expireStandingNegationBatch, validateStandingNegationRead } from "../../src/lib/arena/vm/standing-negation-runtime";
const defs = { ...CTX.defs }, scripts: Record<string, CardScripts> = { ...CTX.scripts };
for (const [id, fixture] of Object.entries(fixtures)) {
  defs[id] = { ...CTX.defs.V1, id, skill: fixture.skill };
  scripts[id] = { bySkill: {}, complete: false, unsupported: ["R477 native fixture only"] };
  for (const row of id === "BT1-043" ? currentWhis : fixture.records) scripts[id].bySkill[row.skillIndex] = { kind: row.kind, ops: row.ops, unsupported: row.unread, validity: row.validity, usage: row.usage, trigger: row.trigger, price: priceFromCostRecord(row.cost as CostRecord) } as Script;
}
for (const id of ["L-RED", "L-BLUE"]) { defs[id] = { ...defs[id], skill: null, back: undefined }; scripts[id] = { bySkill: {}, complete: true, unsupported: [] }; }
const ctx: EngineContext = { ...CTX, defs, scripts };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
let count = 0;
for (const master of ["p1", "p2"] as PlayerId[]) {
 const other = master === "p1" ? "p2" : "p1";
 const fresh = () => RULES.createGame(ctx, { seed:477,p1:{name:"One",leader:"L-RED",main:fifty("V1")},p2:{name:"Two",leader:"L-BLUE",main:fifty("V-BLUE")} }).state as VmState;
 const add = (state:VmState,id:string,cardId:string,owner=master) => {state.cards[id]=newCard(id,cardId,owner);state.sides[owner].zones.hand.push(id);};
 {
  const state=fresh(),ev:GameEvent[]=[];add(state,"king","DB1-066");add(state,"gotenks","BT10-153",other);
  resolvePlay(ctx,game,state,ev,"king",master);resolvePlay(ctx,game,state,ev,"gotenks",other);
  assert.equal(skillsNegated(state,"king"),false);assert.equal(skillsNegated(state,"gotenks"),true);assert.equal(hasKeyword(ctx,game,state,"gotenks","Strike"),false);
  const saved=JSON.parse(JSON.stringify(state)) as VmState;
  assert.throws(()=>skillsNegated(saved,"gotenks"),/validate standing-negation history/);
  validateStandingNegationRead(ctx,saved);assert.equal(skillsNegated(saved,"gotenks"),true);
  const before=JSON.stringify(saved);validateStandingNegationRead(ctx,saved);assert.equal(JSON.stringify(saved),before);count++;
 }
 {
  const state=fresh(),ev:GameEvent[]=[];add(state,"king","DB1-066");add(state,"gotenks","BT10-153",other);
  resolvePlay(ctx,game,state,ev,"king",master);resolvePlay(ctx,game,state,ev,"gotenks",other);
  const frame:ScriptFrame={card:"king",master,ops:[],ip:0,vars:{}};
  vmHost(ctx,game,state,ev,frame).addEffect({target:"king",kind:"negateSkills",value:0,until:"turn",master});
  assert.equal(skillsNegated(state,"gotenks"),false);assert.equal(skillsNegated(state,"king"),true);
  expireStandingNegationBatch(ctx,state,ev,(s,e)=>endEffects(s,e,"turn"));
  assert.equal(skillsNegated(state,"gotenks"),false);assert.equal(skillsNegated(state,"king"),true);count++;
 }
 for(const negate of [false,true]){
  const state=fresh(),ev:GameEvent[]=[];add(state,"king","DB1-066");add(state,"whis","BT1-043",other);
  resolvePlay(ctx,game,state,ev,"king",master);resolvePlay(ctx,game,state,ev,"whis",other,negate?{negatedForTurn:true,negatedBy:{player:master,source:"king"}}:{});
  assert.equal(skillsNegated(state,"whis"),negate);count++;
 }
 {
  const state=fresh(),ev:GameEvent[]=[];add(state,"king","DB1-066");add(state,"gotenks","BT10-153",other);
  resolvePlay(ctx,game,state,ev,"king",master);resolvePlay(ctx,game,state,ev,"gotenks",other);
  vmHost(ctx,game,state,ev,{card:"king",master,ops:[],ip:0,vars:{}}).move("king","drop",master);
  assert.equal(state.standingNegationHistory!.active[0].source.card,"gotenks");assert.equal(skillsNegated(state,"gotenks"),false);count++;
 }
 {
  const state=fresh(),ev:GameEvent[]=[];add(state,"king","DB1-066");
  resolvePlay(ctx,game,state,ev,"king",master);
  const host=vmHost(ctx,game,state,ev),before=JSON.stringify(state);
  assert.throws(()=>host.setHidden("king",true),/standing whole-negation/);
  assert.equal(JSON.stringify(state),before);
  state.cards.king.hidden=true;
  assert.throws(()=>skillsNegated(state,"king"),/validate standing-negation history/);count++;
 }
 {
  let state=fresh();
  for(const action of [{type:"chooseFirst",player:state.chooser,first:master},{type:"mulligan",player:master,redraw:false},{type:"mulligan",player:other,redraw:false},{type:"pass",player:master}] as Action[]) state=RULES.apply(ctx,state,action).state as VmState;
  assert.equal(state.prompt.kind,"main");
  add(state,"king","DB1-066");
  for(let i=0;i<10;i++){const id=`energy${i}`;state.cards[id]=newCard(id,"V1",master);state.cards[id].mode="active";state.sides[master].zones.energy.push(id);}
  const start=performance.now();
  const menu=RULES.legalActions(ctx,state);const afterMenu=performance.now();
  const play=menu.find(entry=>entry.action.type==="play" && entry.action.card==="king");assert.ok(play,"native ordinary play menu");
  state=RULES.apply(ctx,JSON.parse(JSON.stringify(state)),play.action).state as VmState;const afterPlay=performance.now();
  for(let i=0;i<8 && !state.sides[master].zones.battle.includes("king");i++) {
    assert.ok("player" in state.prompt);state=RULES.apply(ctx,JSON.parse(JSON.stringify(state)),{type:"pass",player:(state.prompt as {player:PlayerId}).player}).state as VmState;
  }
  assert.ok(state.sides[master].zones.battle.includes("king"));
  const saved=JSON.parse(JSON.stringify(state));RULES.boardView(ctx,saved,master,{});RULES.legalActions(ctx,saved);
  assert.equal(skillsNegated(saved,"king"),false);
  state=saved;add(state,"gotenks","BT10-153",other);resolvePlay(ctx,game,state,[],"gotenks",other);
  vmHost(ctx,game,state,[]).addEffect({target:"king",kind:"negateSkills",value:0,until:"turn",master});
  state=RULES.apply(ctx,JSON.parse(JSON.stringify(state)),{type:"endMain",player:master}).state as VmState;
  assert.equal(state.standingNegationHistory!.active[0].source.card,"gotenks");
  validateStandingNegationRead(ctx,state);assert.equal(skillsNegated(state,"king"),true);
  assert.ok(!state.effects.some(effect=>effect.target==="king" && effect.kind==="negateSkills"));
  console.log(`R477 native menu/play/reload/view (${Object.keys(state.cards).length} cards): ${Math.round(performance.now()-start)}ms total, menu ${Math.round(afterMenu-start)}ms, play ${Math.round(afterPlay-afterMenu)}ms`);count++;
 }

 {
  const state=fresh(),ev:GameEvent[]=[];add(state,"king","DB1-066");
  const grantDef={...defs.V1,id:"REGRANT",skill:"[Permanent] This card gains [Double Strike]."};
  const grantCtx:EngineContext={...ctx,defs:{...defs,REGRANT:grantDef},scripts:{...scripts,REGRANT:{bySkill:{0:{kind:"permanent",validity:{version:1,sparking:null},usage:{version:1,oncePerTurn:false,limit:null},ops:[{op:"grant",target:{sel:{special:"self"}},keyword:{name:"Strike",x:2},until:"game"}],unsupported:[]}},complete:true,unsupported:[]}}};
  add(state,"grant","REGRANT");resolvePlay(grantCtx,game,state,ev,"grant",master);
  assert.equal(hasKeyword(grantCtx,game,state,"grant","Strike"),true,"unaffected standing grant still applies");
  const before=JSON.stringify(state);
  assert.throws(()=>resolvePlay(grantCtx,game,state,ev,"king",master),/standing skill-grant regeneration/);
  assert.equal(JSON.stringify(state),before,"first negator refuses before any movement");count++;
  for (const grantArea of ["leader", "battle"] as const) {
    const ordinary=fresh();delete ordinary.standingNegationHistory;
    const ordinaryCtx:EngineContext={...grantCtx,defs:{...grantCtx.defs,REGRANT:{...grantDef,type:grantArea==="leader"?"LEADER":"BATTLE"}}};
    if(grantArea==="leader") ordinary.cards[ordinary.sides[master].zones.leader[0]].cardId="REGRANT";
    else {add(ordinary,"grant","REGRANT");resolvePlay(ordinaryCtx,game,ordinary,[],"grant",master);}
    const host=vmHost(ordinaryCtx,game,ordinary,[]);
    for (const [id,route] of [["drawn","draw"],["milled","mill"],["charged","charge"],["under","under"],["hidden","hidden"],["flipped","flip"]] as const) {
      ordinary.cards[id]=newCard(id,"DB1-066",master);
      if(route==="draw" || route==="mill") ordinary.sides[master].zones.deck.unshift(id);else ordinary.sides[master].zones.hand.push(id);
      if(route==="draw") {draw(ordinaryCtx,game,ordinary,[],master,1);assert.ok(ordinary.sides[master].zones.hand.includes(id));}
      if(route==="mill") {host.move(id,"drop",master);assert.ok(ordinary.sides[master].zones.drop.includes(id));}
      if(route==="charge") {moved(ordinaryCtx,game,ordinary,[],id,"energy",{owner:master});assert.ok(ordinary.sides[master].zones.energy.includes(id));}
      if(route==="under") {const top=grantArea==="leader"?ordinary.sides[master].zones.leader[0]:"grant";assert.equal(host.placeUnder(id,top),true);assert.ok(ordinary.cards[top].under.includes(id));}
      if(route==="hidden") {host.setHidden(id,true);assert.equal(ordinary.cards[id].hidden,true);}
      if(route==="flip") {host.flip(id);assert.equal(ordinary.cards[id].flipped,true);}
    }
    // The same source intent still refuses when its actual destination is Battle.
    add(ordinary,"arrivingKing","DB1-066");const snapshot=JSON.stringify(ordinary);
    assert.throws(()=>resolvePlay(ordinaryCtx,game,ordinary,[],"arrivingKing",master),/standing skill-grant regeneration/);
    assert.equal(JSON.stringify(ordinary),snapshot);assert.equal(ordinary.standingNegationHistory,undefined);count++;
  }
 }

 {
  const state=fresh(),ev:GameEvent[]=[];add(state,"king","DB1-066");add(state,"ordinary","V1");
  resolvePlay(ctx,game,state,ev,"ordinary",master);resolvePlay(ctx,game,state,ev,"king",master);
  vmHost(ctx,game,state,ev).addEffect({target:"ordinary",master,kind:"keyword",value:{name:"Blocker"},until:"game"});
  assert.equal(hasKeyword(ctx,game,state,"ordinary","Blocker"),false);
  vmHost(ctx,game,state,ev).move("king","drop",master);
  assert.equal(hasKeyword(ctx,game,state,"ordinary","Blocker"),false);count++;
 }
 {
  const state=fresh(),ev:GameEvent[]=[];add(state,"king","DB1-066");resolvePlay(ctx,game,state,ev,"king",master);
  const local:EngineContext={...ctx,scripts:structuredClone(ctx.scripts)};validateStandingNegationRead(local,state);
  local.scripts!["DB1-066"].bySkill[0].unsupported.push("changed stored source");
  assert.throws(()=>skillsNegated(state,"king"),/validate standing-negation history/);
  assert.throws(()=>validateStandingNegationRead(local,state),/complete unconditional/);count++;
 }

 for (const expiry of ["turn", "afterOpponentCharge"] as const) {
  let state=fresh();delete state.standingNegationHistory;
  for(const action of [{type:"chooseFirst",player:state.chooser,first:master},{type:"mulligan",player:master,redraw:false},{type:"mulligan",player:other,redraw:false},{type:"pass",player:master}] as Action[]) state=RULES.apply(ctx,state,action).state as VmState;
  state.cards.loan=newCard("loan","V1",other);state.cards.loan.mode="active";state.sides[master].zones.battle.push("loan");
  addEffect(state,[],{target:"loan",kind:"control",value:0,until:expiry,master,control:{from:other}});
  const later=addEffect(state,[],{target:"loan",kind:"power",value:1000,until:"battleOrTurn",master});
  const result=RULES.apply(ctx,JSON.parse(JSON.stringify(state)),{type:"endMain",player:master});state=result.state as VmState;
  assert.equal(state.standingNegationHistory,undefined);
  if(expiry==="turn") {
    assert.ok(state.sides[other].zones.battle.includes("loan"));
    const returned=result.events.findIndex(event=>event.type==="move" && event.card==="loan");
    const secondExpiry=result.events.findIndex(event=>event.type==="effectEnded" && event.effect.id===later.id);
    assert.ok(returned>=0 && secondExpiry>returned,"legacy turn loan callback precedes battleOrTurn expiry");
  } else {
    assert.ok(state.sides[master].zones.battle.includes("loan"),"legacy Charge expiry does not introduce loan callbacks");
    assert.ok(!state.effects.some(effect=>effect.target==="loan" && effect.kind==="control"));
  }
  count++;
 }

}
console.log(`standing-negation native writer: ${count} grouped cases passed`);
