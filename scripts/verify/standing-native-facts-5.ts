/** Exact pre-extraction observer oracle; scenarios are staged native boards. */
import assert from "node:assert/strict";
import fixtures from "./fixtures/combo-standing-source.json";
import oracle from "./fixtures/standing-native-facts-5.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { newCard, moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import type { EngineContext, PlayerId, Area } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { observeMixedStandingNegation as observe, mixedStandingOccurrences } from "../../src/lib/arena/vm/standing-negation-mixed-observation";
import { emptyMixedStandingNegationHistory as empty, settleMixedStandingNegation as settle, mixedStandingObservationFromHistory as previous } from "../../src/lib/arena/vm/standing-negation-mixed-history";
import { priorStandingView, standingPriorFacts } from "../../src/lib/arena/vm/standing-negation-prior-view";
import { collectNativeStandingFacts } from "../../src/lib/arena/vm/standing-negation-native-facts";
import { emptyUnderStandingHistory, settleUnderStanding } from "../../src/lib/arena/vm/standing-negation-under-history";
import type { UnderHistory } from "../../src/lib/arena/vm/standing-negation-under-history";
import { NotYet } from "../../src/lib/arena/vm/errors";
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const clone=<T,>(v:T):T=>structuredClone(v);
const defs:EngineContext["defs"]={L:card("L",{type:"LEADER",skill:null}),F:card("F",{skill:null})};
for(const [id,f] of Object.entries(fixtures))defs[id]=card(id,f.card as Parameters<typeof card>[1]);
const ctx:EngineContext={defs,scripts:rulesFromRows(Object.values(defs).flatMap(skillRecords).map((r,id)=>({...r,id,status:r.unread.length?"open":"confirmed",source:"compiler"}) as RuleRow),defs)};
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const results:Record<string,unknown>={};
function board(p:PlayerId){
 const state=RULES.createGame({defs:{L:defs.L,F:defs.F}},{seed:524,p1:{name:"one",leader:"L",main:fifty("F"),z:[]},p2:{name:"two",leader:"L",main:fifty("F"),z:[]}}).state as VmState;
 let history=empty();
 const raw=(id:string,cardId:string,holder:PlayerId,area:Area)=>{state.cards[id]=newCard(id,cardId,holder);state.sides[holder].zones[area].push(id);return id;};
 const record=(name:string,arrivals:string[]=[],battle?:ReturnType<typeof previous>["battle"],advance=true)=>{
  const before=JSON.stringify({state,history,ctx});
  try{const observation=observe(ctx,game,state,history,mixedStandingOccurrences(ctx,game,state).filter(c=>arrivals.includes(c.card)),battle);results[`${p}/${name}`]={observation};if(advance)history=settle(history,observation);}
  catch(error){const e=error as {step?:string;issue?:string;message:string};results[`${p}/${name}`]={refusal:{step:e.step,issue:e.issue,message:e.message}};}
  // The reducer returns a new ledger; the observer never changes the board/context.
  assert.equal(JSON.stringify({state,ctx}),JSON.stringify({state:JSON.parse(before).state,ctx:JSON.parse(before).ctx}));
 };
 return {state,raw,record,get history(){return history;}};
}
for(const p of ["p1","p2"] as PlayerId[]){
 const b=board(p);b.record("empty");
 b.raw("king","DB1-066",p,"battle");b.record("king-arrives",["king"]);
 b.raw("gotenks","BT10-153",other(p),"battle");b.record("second-gotenks",["gotenks"]);
 b.raw("whis","BT1-043",other(p),"battle");b.record("protected-arrival",["whis"]);
 const suppressed=addEffect(b.state,[],{target:"whis",kind:"negateSkill",value:10,until:"turn"});b.record("whis-external-negation");
 b.state.effects=b.state.effects.filter(e=>e.id!==suppressed.id);b.record("whis-expiry-under-original-source");b.record("forged-arrival",["whis"],undefined,false);
 addEffect(b.state,[],{target:"king",kind:"negateSkills",value:0,until:"turn"});b.record("takeover");
 const c=board(p);c.raw("gotenks","BT10-153",p,"battle");c.record("reverse-first",["gotenks"]);c.raw("king","DB1-066",other(p),"battle");c.record("reverse-second",["king"]);
 const d=board(p);const original=d.state.sides[p].zones.leader[0];d.state.sides[p].zones.leader=[];d.state.sides[p].zones.drop.push(original);d.raw("goku","BT20-086",p,"leader");d.record("goku-no-battle",["goku"]);
 d.raw("prum","DB2-086",other(p),"combo"); // full fixture target; test fixture validates definition below
 const guard=d.state.sides[other(p)].zones.leader[0];d.state.battle={attacker:"goku",guard,target:guard,step:"offense",negated:false,blockerOffered:false,counters:[]};
 const cards=mixedStandingOccurrences(ctx,game,d.state);const battle={attacker:{occurrence:cards.find(c=>c.card==="goku")!,present:true},guard:{occurrence:cards.find(c=>c.card===guard)!,present:true}};
 for(let i=0;i<8;i++){d.raw(`combo${i}`,"F",p,"combo");if(i>=5)d.record(`combo-${i+1}`,["prum",...Array.from({length:i+1},(_,n)=>`combo${n}`)],battle);}
 d.state.battle.negated=true;d.record("negated-attack");
 d.state.sides[other(p)].zones.leader=[];d.state.sides[other(p)].zones.drop.push(guard);d.record("unannounced-retirement",[],undefined,false);
 const retired=clone(previous(d.history).battle!);retired.guard.present=false;d.record("opponent-retired",[],retired);
 const e=board(p);addEffect(e.state,[],{target:e.state.sides[p].zones.leader[0],kind:"forbid",value:0,until:"turn",forbid:{what:"beNegated"}});e.record("dormant-timed-protection");e.raw("king","DB1-066",p,"battle");e.record("active-timed-protection",["king"]);
}
if(process.argv.includes("--record"))console.log(JSON.stringify(results,null,2));else{assert.deepEqual(JSON.parse(JSON.stringify(results)),oracle);console.log(`standing-native-facts-5: ${Object.keys(results).length} frozen observer cases PASS`);}

if (!process.argv.includes("--record")) {
 let checks=0;
 for(const bad of [undefined,null,{},[],{version:4},{...empty(),nextSerial:0},{...emptyUnderStandingHistory(),seen:null}]){
  assert.throws(()=>priorStandingView(bad as never),NotYet);checks++;
 }
 assert.throws(()=>standingPriorFacts({} as never),NotYet);checks++;
 for(const p of ["p1","p2"] as PlayerId[]){
  const b=board(p);b.raw("king","DB1-066",p,"battle");
  const observed=observe(ctx,game,b.state,empty(),mixedStandingOccurrences(ctx,game,b.state).filter(c=>c.card==="king"));
  const v2=settle(empty(),observed);v2.nextSerial=19; // valid monotonic gap, never compacted
  const v3=settleUnderStanding(emptyUnderStandingHistory(),{version:3,policy:"underAwareWholeV1",area:observed,piles:[],under:[]});v3.nextSerial=19;
  const a=priorStandingView(v2),c=priorStandingView(v3),original=JSON.stringify({state:b.state,v2,v3,ctx});
  assert.deepEqual(collectNativeStandingFacts(ctx,game,b.state,a,[],null),collectNativeStandingFacts(ctx,game,b.state,c,[],null));
  assert.equal(standingPriorFacts(a).nextSerial,19);assert.equal(standingPriorFacts(c).nextSerial,19);
  assert.deepEqual(standingPriorFacts(a).active,standingPriorFacts(c).active);assert.deepEqual(standingPriorFacts(a).edges,standingPriorFacts(c).edges);
  const exposed=standingPriorFacts(a);exposed.nextSerial=1;exposed.active.length=0;exposed.edges.length=0;
  assert.equal(standingPriorFacts(a).active.length,1);assert.equal(standingPriorFacts(a).nextSerial,19);
  assert.equal(JSON.stringify({state:b.state,v2,v3,ctx}),original);checks++;
  v2.active.length=0;assert.equal(standingPriorFacts(a).active.length,1);checks++;
  assert.throws(()=>observe(ctx,game,b.state,v3 as never),NotYet);checks++;
  const host=observed.cards.find(card=>card.card==="king")!;
  const occurrence={card:"under",cardId:"BT23-070",epoch:1,hiddenCount:0,side:"front" as const,owner:other(p)};
  const area={...observed,candidates:[]}; // supplied v3 under-only ledger mechanism, no native source admission
  const under:UnderHistory=settleUnderStanding(emptyUnderStandingHistory(),{version:3,policy:"underAwareWholeV1",area,
   piles:[{host,type:"BATTLE",hidden:false,cards:[occurrence.card]}],under:[{
    source:{kind:"under",policy:"battleOnTopNegationAndAttackBanV1",occurrence,skillIndex:0,skillIdentity:"isolated prior-view source"},
    relation:{source:occurrence,host,position:0},externalEnabled:true,negateTargets:[host],attackBanTargets:[host]}]});
  const view=priorStandingView(under),facts=standingPriorFacts(view);assert.equal(facts.hasUnderInteraction,true);
  assert.deepEqual(facts.edges,under.negated);assert.deepEqual(facts.active,under.active);assert.equal(facts.nextSerial,under.nextSerial);
  const before=JSON.stringify(b.state);assert.throws(()=>collectNativeStandingFacts(ctx,game,b.state,view,[],null),NotYet);assert.equal(JSON.stringify(b.state),before);checks++;
  const copied=clone(view);assert.throws(()=>standingPriorFacts(copied),NotYet);checks++;
  const plain=board(p);plain.raw("host","F",p,"battle");plain.raw("material","F",other(p),"drop");
  const plainFacts=observe(ctx,game,plain.state,empty());
  const plainV2=settle(empty(),plainFacts),plainV3=settleUnderStanding(emptyUnderStandingHistory(),{version:3,policy:"underAwareWholeV1",area:plainFacts,piles:[],under:[]});
  const plainView=priorStandingView(plainV3);
  assert.ok(moveCard(plain.state,game,"material","drop",{under:"host"}).ok); // actual primitive attachment, unrelated plain material
  const placed=JSON.stringify(plain.state);assert.throws(()=>collectNativeStandingFacts(ctx,game,plain.state,plainView,[],null),NotYet);
  assert.doesNotThrow(()=>collectNativeStandingFacts(ctx,game,plain.state,priorStandingView(plainV2),[],null));
  assert.equal(JSON.stringify(plain.state),placed);checks++;
 }
 const malformed=board("p1");malformed.state.cards.invalid=null as never;
 const malformedBefore=JSON.stringify(malformed.state);
 assert.throws(()=>collectNativeStandingFacts(ctx,game,malformed.state,priorStandingView(emptyUnderStandingHistory()),[],null),NotYet);
 assert.equal(JSON.stringify(malformed.state),malformedBefore);checks++;
 console.log(`standing-native-facts-5: ${checks} validated-prior view cases PASS`);
}
