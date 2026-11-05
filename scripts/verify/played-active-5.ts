/** R-481. Coordinated played / skill-caused Active switch: exact frozen text, synthetic numeric costs, saved native actions. */
import assert from "node:assert/strict";
import fixtures from "./fixtures/played-active-5.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { newCard } from "../../src/lib/arena/vm/zones";
import { addEffect, skillsNegated } from "../../src/lib/arena/vm/effects";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const defs:Record<string,CardDef>={
 F:card("F",{energyCost:0}), L:card("L",{type:"LEADER",skill:null}),
 MAIN:card("MAIN",{type:"LEADER",skill:"[Activate: Main] Choose up to 1 Battle Card and switch it to Active Mode."}),
 COUNTER:card("COUNTER",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] Choose up to 1 Battle Card and switch it to Active Mode."}),
 PLAY:card("PLAY",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] Choose up to 1 Battle Card from your hand and play it."}),
 HIGH:card("HIGH",{energyCost:5,skill:"[Critical]"}), LOW:card("LOW",{energyCost:2}), EDGE:card("EDGE",{energyCost:3}), UNISON:card("UNISON",{type:"UNISON",energyCost:2,power:10000,skill:"[Blocker]"}),
 VICTIM:card("VICTIM",{energyCost:4,skill:"[Critical]"}),
};
for(const [id,v] of Object.entries(fixtures))defs[id]=card(id,{name:v.name,skill:v.skill,energyCost:0,power:v.power});
const rows=Object.values(defs).flatMap(skillRecords);
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(rows.map((r,id)=>({...r,id,status:"draft",source:"compiler"}) as unknown as RuleRow)),defs)};
const keys=Object.keys(fixtures);
for(const id of keys){const r=rows.find(r=>r.cardId===id&&r.printed.includes("during your turn"))!;assert.deepEqual(r.trigger,["played","activeBySkillDuringYourTurn"]);assert.deepEqual(r.unread,[]);assert.equal(r.cond,null,"the play branch has no turn restriction");}
for(const text of [
 "[Auto] When this card is played, or when this card is switched to Active Mode by your Leader's skill during your turn, draw 1 card.",
 "[Auto] When this card is played, or when this card is switched to Active Mode by a skill during your opponent's turn, draw 1 card.",
]) assert.ok(skillRecords(card("unknown",{skill:text}))[0].unread.length,"unrepresented alternative remains unread");
const standalone=skillRecords(card("standalone",{skill:"[Auto] When this card is switched to Active Mode by a skill during your turn, draw 1 card."}))[0];
assert.deepEqual(standalone.trigger,["activeBySkillDuringYourTurn"]);assert.equal(standalone.cond,null);assert.deepEqual(standalone.unread,[]);
const mixed=skillRecords(card("mixed",{skill:"[Auto] When this card is played, or when this card is switched to Active Mode by a skill during your turn, draw 1 card, then invent a new rule."}))[0];
assert.deepEqual(mixed.trigger,["played","activeBySkillDuringYourTurn"]);assert.ok(mixed.unread.some(x=>x.includes("invent")));assert.ok(mixed.ops.some(x=>x.op==="draw"),"a separate unread body clause does not erase the readable effect");
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
let count=0;
function take(s:VmState,a:Action){const before=JSON.stringify(s);const saved=copy(s); RULES.boardView(ctx,saved,"p1",{}); RULES.boardView(ctx,saved,"p2",{}); const r=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(s),before);assert.equal(r.state.outcome,undefined);return r.state as VmState;}
function fresh(p:PlayerId){let s=RULES.createGame(ctx,{seed:481,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;for(const a of [{type:"chooseFirst",player:s.chooser,first:p},{type:"mulligan",player:p,redraw:false},{type:"mulligan",player:other(p),redraw:false},{type:"charge",player:p,card:null}] as Action[])s=take(s,a);return s;}
function add(s:VmState,p:PlayerId,id:string,def:string,area:string,rest=false){s.cards[id]=newCard(id,def,p);s.cards[id].mode=area==="hand"?null:rest?"rest":"active";s.sides[p].zones[area].push(id);return id;}
function act(s:VmState,type:"activate"|"play",id:string){const a=RULES.legalActions(ctx,copy(s)).find(x=>x.action.type===type&&"card"in x.action&&x.action.card===id)?.action;assert.ok(a,`${type} ${id}`);return take(s,a);}
// Every action reloads; each saved choice is answered through the ordinary API.
function finish(s:VmState,choose:string[]=[]){let auto=0;for(let i=0;i<30&&s.prompt.kind!=="main"&&s.prompt.kind!=="charge";i++){const q=s.prompt;if(q.kind==="counter")s=take(s,{type:"counter",player:q.player,card:null});else if(q.kind==="orderPending")s=take(s,{type:"orderPending",player:q.player,index:0});else if(q.kind==="chooseMode"){auto++;s=take(s,{type:"chooseMode",player:q.player,index:1});}else if(q.kind==="chooseCards"){const id=choose.find(id=>q.choice.candidates.includes(id));if(q.choice.candidates.includes("victim"))auto++;s=take(s,{type:"choose",player:q.player,cards:id?[id]:[]});}else throw new Error(`unexpected ${q.kind}`);}return {s,auto};}
function reachChoice(s:VmState){for(let i=0;i<10&&(s.prompt.kind==="counter"||s.prompt.kind==="orderPending");i++)s=s.prompt.kind==="counter"?take(s,{type:"counter",player:s.prompt.player,card:null}):take(s,{type:"orderPending",player:s.prompt.player,index:0});assert.equal(s.prompt.kind,"chooseCards");return s;}
for(const p of ["p1","p2"] as PlayerId[])for(const def of keys){
 // A played Auto answers on either player's turn, including native Counter skill play.
 for(const ownTurn of [true,false]){let s=fresh(ownTurn?p:other(p));add(s,p,"subject",def,"hand");add(s,other(p),"victim","VICTIM","battle");
  if(ownTurn)s=act(s,"play","subject");else {add(s,other(p),"dummy","F","hand");add(s,p,"counter","PLAY","hand");s=act(s,"play","dummy");assert.equal(s.prompt.kind,"counter");s=take(s,{type:"counter",player:p,card:"counter"});s=reachChoice(s);s=take(s,{type:"choose",player:p,cards:["subject"]});}
  const done=finish(s,["victim"]);assert.ok(done.auto>=1,`${def} play ${p}/${ownTurn}`);count++;
 }
 // Actual switches by either player's skill; own turn only, never an already Active card.
 for(const ownTurn of [true,false])for(const ownSkill of [true,false])for(const rest of [true,false]){
  const turn=ownTurn?p:other(p),actor=ownSkill?p:other(p);let s=fresh(turn);add(s,p,"subject",def,"battle",rest);add(s,other(p),"victim","VICTIM","battle");
  if(actor===turn){const leader=s.sides[actor].zones.leader[0];s.cards[leader].cardId="MAIN";s=act(s,"activate",leader);}else{add(s,turn,"dummy","F","hand");add(s,actor,"counter","COUNTER","hand");s=act(s,"play","dummy");assert.equal(s.prompt.kind,"counter");s=take(s,{type:"counter",player:actor,card:"counter"});}
  s=reachChoice(s);s=take(s,{type:"choose",player:actor,cards:["subject"]});const done=finish(s,["victim"]);assert.equal(done.auto>0,ownTurn&&rest,`${def} ${p} turn=${ownTurn} skill=${ownSkill} rest=${rest}`);if(def!=="EX08-06")assert.equal(skillsNegated(done.s,"victim"),ownTurn&&rest);count++;
 }
}
for(const p of ["p1","p2"] as PlayerId[])for(const def of keys){
 // Rule-driven Charge stand is an actual switch, but no skill caused it.
 {let s=fresh(other(p));add(s,p,"subject",def,"battle",true);add(s,other(p),"victim","VICTIM","battle");s=take(s,{type:"endMain",player:other(p)});const done=finish(s);assert.equal(done.s.prompt.kind,"charge");assert.equal(done.s.cards.subject.mode,"active");assert.equal(done.auto,0);count++;}
 // A different card switching never supplies this card's self moment.
 {let s=fresh(p);add(s,p,"subject",def,"battle",true);add(s,p,"different","F","battle",true);add(s,other(p),"victim","VICTIM","battle");const leader=s.sides[p].zones.leader[0];s.cards[leader].cardId="MAIN";s=act(s,"activate",leader);s=reachChoice(s);s=take(s,{type:"choose",player:p,cards:["different"]});const done=finish(s);assert.equal(done.auto,0);assert.equal(done.s.cards.subject.mode,"rest");count++;}
 // A real skill switch cannot activate a source whose Auto is already negated.
 {let s=fresh(p);add(s,p,"subject",def,"battle",true);add(s,other(p),"victim","VICTIM","battle");addEffect(s,[],{kind:"negateSkills",target:"subject",until:"turn",value:0});const leader=s.sides[p].zones.leader[0];s.cards[leader].cardId="MAIN";s=act(s,"activate",leader);s=reachChoice(s);s=take(s,{type:"choose",player:p,cards:["subject"]});const done=finish(s);assert.equal(done.auto,0);assert.equal(done.s.cards.subject.mode,"active");count++;}
}
for(const p of ["p1","p2"] as PlayerId[]){
 // EX08's first mode has no side restriction and compares >= current opposing energy, including equality.
 {let s=fresh(p);add(s,p,"subject","EX08-06","hand");add(s,p,"ownEdge","EDGE","battle");add(s,other(p),"opposingEdge","EDGE","battle");add(s,other(p),"low","LOW","battle");for(let i=0;i<3;i++)add(s,other(p),`energy${i}`,"F","energy");s=act(s,"play","subject");while(s.prompt.kind==="counter")s=take(s,{type:"counter",player:s.prompt.player,card:null});assert.equal(s.prompt.kind,"chooseMode");s=take(s,{type:"chooseMode",player:p,index:0});assert.equal(s.prompt.kind,"chooseCards");if(s.prompt.kind!=="chooseCards")throw new Error();assert.ok(s.prompt.choice.candidates.includes("ownEdge"));assert.ok(s.prompt.choice.candidates.includes("opposingEdge"));assert.ok(!s.prompt.choice.candidates.includes("low"));assert.equal(s.prompt.choice.min,1);s=take(s,{type:"choose",player:p,cards:["ownEdge"]});const done=finish(s).s;assert.ok(done.sides[p].zones.drop.includes("ownEdge"));count++;}
 // EX08's second mode draws once and may rest an opposing card, including the Leader.
 {let s=fresh(p);add(s,p,"subject","EX08-06","hand");const n=s.sides[p].zones.hand.length;s=act(s,"play","subject");while(s.prompt.kind==="counter")s=take(s,{type:"counter",player:s.prompt.player,card:null});s=take(s,{type:"chooseMode",player:p,index:1});assert.equal(s.sides[p].zones.hand.length,n);assert.equal(s.prompt.kind,"chooseCards");const target=s.sides[other(p)].zones.leader[0];s=take(s,{type:"choose",player:p,cards:[target]});assert.equal(finish(s).s.cards[target].mode,"rest");count++;}
 for(const def of ["EX19-30","EX19-31"]){let s=fresh(p);add(s,p,"subject",def,"hand");add(s,p,"friendly","VICTIM","battle");add(s,other(p),"victim","VICTIM","battle");add(s,other(p),"high","HIGH","battle");add(s,other(p),"unison","UNISON","unison");s.cards.unison.markers=3;s=act(s,"play","subject");s=reachChoice(s);if(s.prompt.kind!=="chooseCards")throw new Error();const cs=s.prompt.choice.candidates;assert.ok(cs.includes("victim"));assert.ok(!cs.includes("friendly"));assert.ok(!cs.includes(s.sides[other(p)].zones.leader[0]));assert.equal(cs.includes("high"),def==="EX19-30");assert.equal(cs.includes("unison"),def==="EX19-30");assert.equal(s.prompt.choice.min,0);const target=def==="EX19-30"?"unison":"victim";const declined=finish(take(s,{type:"choose",player:p,cards:[]})).s;assert.equal(skillsNegated(declined,target),false);s=finish(take(s,{type:"choose",player:p,cards:[target]})).s;assert.equal(skillsNegated(s,target),true);s=finish(take(s,{type:"endMain",player:p})).s;assert.equal(skillsNegated(s,target),false,"turn expiry");count++;}
}
console.log(`played / Active qualification: ${count} native saved-action cases`);
