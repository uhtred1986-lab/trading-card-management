/** R477 native timing fixtures; exact stored King/Gotenks rows, no catalog admission. */
import assert from "node:assert/strict";
import fixtures from "./fixtures/standing-negation-observation-5.json";
import { card, fifty } from "./harness";
import { correctSkillText } from "../../src/lib/catalog/errata";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { newCard } from "../../src/lib/arena/vm/zones";
import { moved, run } from "../../src/lib/arena/vm/flow";
import { resolvePlay } from "../../src/lib/arena/vm/play";
import { skillsNegated } from "../../src/lib/arena/vm/effects";
import { attrsNow, hasKeyword } from "../../src/lib/arena/vm/program";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const defs:Record<string,CardDef>={
 F:card("F",{skill:null}), L:card("L",{type:"LEADER",skill:null}),
 OWN:card("OWN",{type:"LEADER",skill:"[Activate: Main] Choose up to 1 of your Battle Cards and place it in its owner's Drop Area."}),
 WATCHOWN:card("WATCHOWN",{type:"LEADER",skill:"[Auto] When one of your Battle Cards is removed from your Battle Area by an opponent's skill, draw 1 card.\n[Auto] When one of your Battle Cards is removed from your Battle Area by a skill, draw 1 card."}),
 KILLWATCH:card("KILLWATCH",{type:"LEADER",skill:"[Activate: Main] Choose up to 1 of your opponent's Battle Cards and place it in its owner's Drop Area.\n[Auto] When one of your opponent's Battle Cards is removed from their Battle Area by a skill, draw 1 card."}),
 KILL:card("KILL",{type:"LEADER",skill:"[Activate: Main] Choose up to 1 of your opponent's Battle Cards and place it in its owner's Drop Area."}),
 PLAY:card("PLAY",{type:"LEADER",skill:"[Activate: Main] Choose up to 1 Battle Card from your hand and play it."}),
 ENDPLAY:card("ENDPLAY",{type:"LEADER",skill:"[Auto] At the end of your turn, choose up to 1 Battle Card from your hand and play it."}),
 ENDER:card("ENDER",{skill:"[Auto] At the end of your turn, draw 1 card."}),
 ACTIVE:card("ACTIVE",{skill:"[Activate: Main] Choose up to 1 Battle Card from your hand and play it, then draw 1 card."}),
 ARRIVE:card("ARRIVE",{skill:"[Auto] When this card is played, draw 1 card."}),
 DEFLECT:card("DEFLECT",{energyCost:2,power:20000,skill:"[Deflect]"}),
 PRE:card("PRE",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] If the Battle Card being played has an energy cost of 4 or less, it is placed in its owner's Drop Area instead of being played."}),
 POST:card("POST",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] Choose up to 1 of your opponent's Battle Cards and it gets -15000 power for the turn."}),
 COUNTERPLAY:card("COUNTERPLAY",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] Choose up to 1 Battle Card from your hand and play it."}),
 OR:card("OR",{skill:"[Over Realm 3]{1}"}),
};
for(const id of ["DB1-066","BT10-153"] as const)defs[id]=card(id,{skill:correctSkillText(id,fixtures[id].skill)});
const rows=Object.values(defs).filter(d=>!fixtures[d.id as keyof typeof fixtures]).flatMap(skillRecords);
for(const id of ["DB1-066","BT10-153"] as const)rows.push(...fixtures[id].records as unknown as typeof rows);
const scripts=rulesFromRows(rows.map((row,id)=>({...row,id,status:"confirmed",source:"compiler"}) as unknown as RuleRow),defs);
// Fixture-only opt-in to the exact stored whole-negation policy; card-level
// runtime support remains blocked and all other loaded metadata is retained.
for(const [id,index] of [["DB1-066",0],["BT10-153",20]] as const){assert.deepEqual(scripts[id].bySkill[index].unsupported,["Permanent negateSkills is not collected as a runtime static"]);scripts[id].bySkill[index].unsupported=[];}
assert.deepEqual(scripts["BT10-153"].bySkill[30].trigger,["removedByOpponent"]);
const ctx:EngineContext={defs,scripts},loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
let events:GameEvent[]=[],count=0;
function take(s:VmState,a:Action){const before=JSON.stringify(s),r=RULES.apply(ctx,copy(s),a);assert.equal(JSON.stringify(s),before);assert.equal(r.state.outcome,undefined);events.push(...r.events);return r.state as VmState;}
function fresh(player:PlayerId){let s=RULES.createGame(ctx,{seed:477,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;for(const a of [{type:"chooseFirst",player:s.chooser,first:player},{type:"mulligan",player,redraw:false},{type:"mulligan",player:other(player),redraw:false},{type:"charge",player,card:null}] as Action[])s=take(s,a);events=[];return s;}
function add(s:VmState,holder:PlayerId,id:string,definition:string,area="hand",owner=holder){s.cards[id]=newCard(id,definition,owner);s.cards[id].mode=area==="hand"?null:"active";s.sides[holder].zones[area].push(id);return id;}
function enter(s:VmState,p:PlayerId,id:string,definition:string,owner=p){add(s,p,id,definition,"hand",owner);resolvePlay(ctx,game,s,[],id,p);}
function leader(s:VmState,p:PlayerId,definition:string){const id=s.sides[p].zones.leader[0];s.cards[id].cardId=definition;return id;}
function activate(s:VmState,p:PlayerId,id:string){const a=RULES.legalActions(ctx,s).find(x=>x.action.type==="activate"&&x.action.card===id)?.action;assert.ok(a,`activation offered for ${id}`);return take(s,a);}
function finish(s:VmState){for(let i=0;i<30&&s.prompt.kind!=="main"&&s.prompt.kind!=="charge";i++){if(s.prompt.kind==="orderPending")s=take(s,{type:"orderPending",player:s.prompt.player,index:0});else {assert.equal(s.prompt.kind,"counter",JSON.stringify(s.prompt));s=take(s,{type:"counter",player:(s.prompt as {player:PlayerId}).player,card:null});}}return s;}
for(const p of ["p1","p2"] as PlayerId[]){
 for(const suppressed of [false,true])for(const borrowed of [false,true]){
  const remover=other(p);let s=fresh(remover);const source=leader(s,remover,"KILL");
  if(suppressed)enter(s,remover,"king","DB1-066");
  enter(s,p,"gotenks","BT10-153",borrowed?remover:p);
  if(!suppressed)enter(s,remover,"king","DB1-066");
  enter(s,remover,"victim","F");s.cards.victim.mode="rest";enter(s,p,"friendly","F");s.cards.friendly.mode="rest";add(s,remover,"energy","F","energy");s.cards.energy.mode="rest";
  s=activate(s,remover,source);assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:remover,cards:["gotenks"]});s=finish(s);
  assert.ok(s.sides[borrowed?remover:p].zones[suppressed?"drop":"removed"].includes("gotenks"),"only active Ultimate redirects to owner removal area");
  assert.equal(s.sides[remover].zones.drop.includes("victim"),!suppressed,`departure uses pre-leave negation (${p}, borrowed=${borrowed}, suppressed=${suppressed})`);assert.ok(s.sides[p].zones.battle.includes("friendly"),"departure targets original controller's opponent");
  const fired=events.filter(e=>e.type==="skill"&&e.card==="gotenks");assert.equal(fired.length,suppressed?0:1);if(fired[0]?.type==="skill")assert.equal(fired[0].master,p);count++;
 }
 // A resolved Over Realm procedure owns its delayed departure independently of source skills.
 {
  let s=fresh(p);enter(s,other(p),"king","DB1-066");add(s,p,"realm","OR");for(let i=0;i<3;i++)add(s,p,`drop${i}`,"F","drop");add(s,p,"energy","F","energy");
  s=finish(activate(s,p,"realm"));assert.ok(s.sides[p].zones.battle.includes("realm"));assert.equal(skillsNegated(s,"realm"),true);
  s=take(s,{type:"endMain",player:p});s=finish(s);assert.ok(s.sides[p].zones.warp.includes("realm"));count++;
 }
 // A body already activated keeps resolving after its own play makes King suppress its source.
 {
  let s=fresh(p);enter(s,p,"active","ACTIVE");add(s,p,"king","DB1-066");const before=s.sides[p].zones.hand.length;
  s=activate(s,p,"active");if(s.prompt.kind==="counter")s=finish(s);
  assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:p,cards:["king"]});s=finish(s);
  assert.equal(skillsNegated(s,"active"),true);assert.equal(s.sides[p].zones.hand.length,before,"played King then still drew one");count++;
 }
 // Ordinary pending Autos are rechecked before activation, unlike witnessed arrival Autos.
 {
  let s=fresh(p);const source=leader(s,p,"ENDPLAY");enter(s,p,"ender","ENDER");add(s,p,"king","DB1-066");const hand=s.sides[p].zones.hand.length;
  s=take(s,{type:"endMain",player:p});assert.equal(s.prompt.kind,"orderPending");const idx=s.pending.findIndex(item=>item.card===source);assert.ok(idx>=0);
  const queued=s.pending.find(item=>item.card==="ender");assert.ok(queued&&queued.kind!=="hook"&&!queued.arrivalWitness);
  s=take(s,{type:"orderPending",player:p,index:idx});assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:p,cards:["king"]});s=finish(s);
  assert.equal(s.sides[p].zones.hand.length,hand-1);assert.equal(events.some(e=>e.type==="skill"&&e.card==="ender"),false);count++;
 }
 // An already-pending R422 arrival survives a later Counter that plays King.
 {
  let s=fresh(p);const source=leader(s,p,"PLAY");add(s,p,"arrival","ARRIVE");add(s,other(p),"counter","COUNTERPLAY");add(s,other(p),"king","DB1-066");const hand=s.sides[p].zones.hand.length;
  s=activate(s,p,source);assert.equal(s.prompt.kind,"counter");s=take(s,{type:"counter",player:other(p),card:null});assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:p,cards:["arrival"]});
  assert.equal(s.prompt.kind,"counter");const pending=s.pending.find(item=>item.card==="arrival");assert.ok(pending&&pending.kind!=="hook"&&pending.arrivalWitness);
  s=take(s,{type:"counter",player:other(p),card:"counter"});
  for(let i=0;i<12&&s.prompt.kind!=="chooseCards";i++){assert.equal(s.prompt.kind,"counter");s=take(s,{type:"counter",player:(s.prompt as {player:PlayerId}).player,card:null});}
  assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:other(p),cards:["king"]});s=finish(s);
  assert.equal(skillsNegated(s,"arrival"),true);assert.equal(s.sides[p].zones.hand.length,hand);assert.equal(events.filter(e=>e.type==="skill"&&e.card==="arrival").length,1);count++;
 }
 for(const window of ["pre","post"] as const){
  let s=fresh(p);const source=leader(s,p,"PLAY");enter(s,other(p),"king","DB1-066");add(s,p,"target","DEFLECT");add(s,other(p),"counter",window==="pre"?"PRE":"POST");
  s=activate(s,p,source);assert.equal(s.prompt.kind,"counter");s=take(s,{type:"counter",player:other(p),card:window==="pre"?"counter":null});
  for(let i=0;i<12&&s.prompt.kind!=="chooseCards";i++){assert.equal(s.prompt.kind,"counter");s=take(s,{type:"counter",player:(s.prompt as {player:PlayerId}).player,card:null});}
  assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:p,cards:["target"]});
  if(window==="post") {assert.equal(s.prompt.kind,"counter");assert.equal(hasKeyword(ctx,game,s,"target","Deflect"),false);s=take(s,{type:"counter",player:other(p),card:"counter"});assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:other(p),cards:["target"]});}
  s=finish(s);assert.ok(s.sides[p].zones.battle.includes("target"));assert.equal(attrsNow(ctx,game,s,"target").power,window==="pre"?20000:5000);count++;
 }
 // A borrowed card removed by its own controller's skill is not an opponent-skill removal.
 {
  let s=fresh(p);const source=leader(s,p,"OWN");enter(s,p,"gotenks","BT10-153",other(p));enter(s,other(p),"king","DB1-066");
  s=activate(s,p,source);assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:p,cards:["gotenks"]});s=finish(s);assert.equal(events.some(e=>e.type==="skill"&&e.card==="gotenks"),false);count++;
 }
 // Native movement events carry the same old-controller snapshot without named script pends.
 {
  const s=fresh(other(p));enter(s,p,"gotenks","BT10-153",other(p));enter(s,other(p),"king","DB1-066");
  moved(ctx,game,s,[],"gotenks","drop",{owner:other(p),actor:other(p),by:"skill",byOpponent:true});
  const queued=s.pending.find(item=>item.card==="gotenks");assert.ok(queued);assert.equal(queued.master,p);run(ctx,game,s,[]);count++;
 }

 {
  let s=fresh(other(p));const watcher=leader(s,p,"WATCHOWN"),source=leader(s,other(p),"KILLWATCH");enter(s,p,"gotenks","BT10-153",other(p));enter(s,other(p),"king","DB1-066");
  const ownHand=s.sides[p].zones.hand.length,opponentHand=s.sides[other(p)].zones.hand.length;
  s=activate(s,other(p),source);assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:other(p),cards:["gotenks"]});s=finish(s);
  assert.equal(s.sides[p].zones.hand.length,ownHand+2,"both own departure watchers use old holder");assert.equal(s.sides[other(p)].zones.hand.length,opponentHand+1,"opponent watcher uses old opposing holder");
  assert.equal(events.filter(e=>e.type==="skill"&&e.card===watcher).length,2);assert.equal(events.filter(e=>e.type==="skill"&&e.card===source&&e.skill!==0).length,1);count++;
 }

}
console.log(`standing-negation trigger boundaries: ${count} grouped cases passed`);
