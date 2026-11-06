/** R477 coupon and isolated projection fixtures. No catalog admission. */
import assert from "node:assert/strict";
import fixtures from "./fixtures/standing-negation-observation-5.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { newCard } from "../../src/lib/arena/vm/zones";
import { run, moved } from "../../src/lib/arena/vm/flow";
import { resolvePlay } from "../../src/lib/arena/vm/play";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript, type Script, type ScriptFrame } from "../../src/lib/arena/vm/script";
import { spendPriceUses, consumeActivationEnergyUses } from "../../src/lib/arena/vm/costs";
import { skillsNegated } from "../../src/lib/arena/vm/effects";
import { projectStandingNegationMoves } from "../../src/lib/arena/vm/standing-negation-projection";
import { validateStandingNegationRead } from "../../src/lib/arena/vm/standing-negation-runtime";
import { attrsNow, type TaxInForce } from "../../src/lib/arena/vm/program";
import { unpaidActivationTax, unpaidKeywordPlayTax } from "../../src/lib/arena/vm/activate";
import { parseSkills } from "../../src/lib/arena/text/cards";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
const defs:EngineContext["defs"]={W:card("W",{type:"LEADER",skill:"[Auto] When a card in your Combo Area is placed in your Drop Area, choose 1 Battle Card in your Combo Area and draw 1 card."}),L:card("L",{type:"LEADER",skill:null}),F:card("F",{skill:null}),A:card("A",{skill:"[Activate: Main] {1}: Draw 1 card."}),R:card("R",{skill:"[Over Realm 3]"})};
for(const id of ["DB1-066","BT10-153"] as const)defs[id]=card(id,{skill:fixtures[id].skill});
const scripts=rulesFromRows(Object.values(defs).flatMap(skillRecords).map((r,id)=>({...r,id,status:"confirmed",source:"compiler"}) as unknown as RuleRow),defs);
for(const id of ["DB1-066","BT10-153"] as const){scripts[id]={bySkill:{},complete:false,unsupported:["R477 fixture only"]};for(const r of fixtures[id].records)scripts[id].bySkill[r.skillIndex]={kind:r.kind,ops:r.ops,unsupported:r.unread,validity:r.validity,usage:r.usage} as Script;}
scripts.W={...scripts.W,complete:true,unsupported:[],bySkill:{0:{...scripts.W.bySkill[0],trigger:["comboToDrop"],unsupported:[],ops:[{op:"choose",sel:{area:"combo",side:"both",count:1},as:"picked"},{op:"draw",n:1}]}}};
const ctx:EngineContext={defs,scripts},loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
let count=0;
for(const master of ["p1","p2"] as PlayerId[]){
 const other=master==="p1"?"p2":"p1";
 const fresh=()=>RULES.createGame(ctx,{seed:477,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const add=(s:VmState,id:string,cardId:string,area="hand")=>{s.cards[id]=newCard(id,cardId,master);s.sides[master].zones[area].push(id);};
 const king=(s:VmState)=>{add(s,"king","DB1-066");resolvePlay(ctx,game,s,[],"king",master);};
 {
  const s=fresh();king(s);add(s,"coupon","F");
  const h=vmHost(ctx,game,s,[]),e=h.addEffect({target:"coupon",kind:"cost",value:-1,until:"turn",uses:2,master});assert.ok(e);
  spendPriceUses(ctx,s,[],"coupon");assert.equal(e.uses,1);assert.equal(skillsNegated(s,"king"),false);
  spendPriceUses(ctx,s,[],"coupon");assert.ok(!s.effects.some(x=>x.id===e.id));assert.equal(skillsNegated(s,"king"),false);count++;
 }
 {
  const s=fresh();king(s);add(s,"coupon","F");add(s,"coupon2","F");const h=vmHost(ctx,game,s,[]);
  const frame:ScriptFrame={card:"coupon",master,ops:[{op:"costReduction",target:{var:"targets"},amount:-1,what:"energy",uses:1,until:"turn"}],ip:0,vars:{targets:["coupon","coupon2"]}};
  assert.equal(stepScript(h,frame),"done");const e=s.effects.find(x=>x.target==="coupon"&&x.kind==="cost");assert.ok(e);assert.equal(e.group,e.id);assert.equal(skillsNegated(s,"king"),false);assert.equal(s.effects.filter(x=>x.group===e.id).length,2);spendPriceUses(ctx,s,[],"coupon");assert.equal(s.effects.filter(x=>x.group===e.id).length,0);assert.equal(skillsNegated(s,"king"),false);count++;
 }
 {
  const s=fresh();king(s);add(s,"gotenks","BT10-153");resolvePlay(ctx,game,s,[],"gotenks",other);add(s,"coupon","F");const h=vmHost(ctx,game,s,[]);
  h.addEffect({target:"king",kind:"negateSkills",value:0,until:"game",master,group:477});
  h.addEffect({target:"coupon",kind:"cost",value:-1,until:"game",uses:1,master,group:477});
  assert.equal(skillsNegated(s,"gotenks"),false);const before=JSON.stringify(s);assert.throws(()=>spendPriceUses(ctx,s,[],"coupon"),/coupon group containing non-cost effects/);assert.equal(JSON.stringify(s),before);count++;
 }
 {
  const s=fresh();king(s);add(s,"coupon","F");const h=vmHost(ctx,game,s,[]);
  const e=h.addEffect({target:"coupon",kind:"cost",value:-1,until:"turn",uses:1,master,energyActivation:"main"});assert.ok(e);
  consumeActivationEnergyUses(ctx,s,[],{version:1,ids:[e.id]});assert.equal(skillsNegated(s,"king"),false);count++;
 }
 for(const procedure of ["keywordPrice","comboSubject"] as const){
  const s=fresh();king(s);add(s,"subject","F",procedure==="keywordPrice"?"hand":"combo");
  vmHost(ctx,game,s,[]).addEffect({target:"subject",kind:"power",value:5000,until:"turn",master});
  const before=JSON.stringify(s),projected=clone(s);projectStandingNegationMoves(ctx,game,projected,[{id:"subject",to:"drop"}],procedure);
  assert.equal(JSON.stringify(s),before);assert.ok(projected.sides[master].zones.drop.includes("subject"));assert.equal(skillsNegated(projected,"king"),false);
  assert.equal(projected.effects.some(e=>e.target==="subject"),false,"both actual reset writers end the old target power");
  const actual=clone(s);if(procedure==="comboSubject")moved(ctx,game,actual,[],"subject","drop",{owner:master});else vmHost(ctx,game,actual,[]).move("subject","drop",master);
  assert.deepEqual(projected,actual,"projection matches its actual writer's complete cleanup and standing settlement");
  attrsNow(ctx,game,projected,"subject");const stale=clone(s);stale.cards.king.zoneEpoch=(stale.cards.king.zoneEpoch??0)+1;const original=JSON.stringify(stale);assert.throws(()=>projectStandingNegationMoves(ctx,game,stale,[{id:"subject",to:"drop"}],procedure));assert.equal(JSON.stringify(stale),original);count++;
 }
 {
  const s=fresh();delete s.standingNegationHistory;add(s,"coupon","F");const h=vmHost(ctx,game,s,[]);h.addEffect({target:"coupon",kind:"cost",value:-1,until:"turn",uses:1,master,group:88});h.addEffect({target:"coupon",kind:"power",value:1000,until:"turn",master,group:88});
  const events:GameEvent[]=[];spendPriceUses(ctx,s,events,"coupon");assert.equal(s.standingNegationHistory,undefined);assert.equal(events.filter(e=>e.type==="effectEnded").length,2);count++;
 }
 {
  for(const grouped of [false,true]) {
  let s=fresh();for(const a of [{type:"chooseFirst",player:s.chooser,first:master},{type:"mulligan",player:master,redraw:false},{type:"mulligan",player:other,redraw:false},{type:"pass",player:master}] as Action[])s=RULES.apply(ctx,s,a).state as VmState;
  add(s,"source","A");resolvePlay(ctx,game,s,[],"source",master);add(s,"king","DB1-066");
  resolvePlay(ctx,game,s,[],"king",master);
  // This coupon-group control needs a live Battle negation, not an old Hand effect.
  vmHost(ctx,game,s,[]).addEffect({target:"king",kind:"negateSkills",value:0,until:"game",master,...(grouped?{group:99}:{})});
  vmHost(ctx,game,s,[]).addEffect({target:"source",kind:"skillCost",value:-1,until:"turn",uses:1,master,group:99});
  for(let i=0;i<2;i++){add(s,`energy${i}`,"F","energy");s.cards[`energy${i}`].mode="active";}
  const action=RULES.legalActions(ctx,s).find(a=>a.action.type==="activate"&&a.action.card==="source");assert.ok(action);
  const before=JSON.stringify(s),hand=s.sides[master].zones.hand.length;
  if(grouped)assert.throws(()=>RULES.apply(ctx,s,action.action),/coupon group containing non-cost effects/);
  else {const result=RULES.apply(ctx,s,action.action).state as VmState;assert.equal(result.sides[master].zones.hand.length,hand+1);assert.equal(skillsNegated(result,"source"),false);assert.ok(!result.effects.some(e=>e.kind==="skillCost"));}
  assert.equal(JSON.stringify(s),before,"activation or refusal never mutates its input match");count++;
  }
 }
 // The existing menu projection remains pure and validates its cloned history.
 {
  const s=fresh();king(s);add(s,"revive","R");for(let i=0;i<3;i++)add(s,`drop${i}`,"F","drop");validateStandingNegationRead(ctx,s);const before=JSON.stringify(s);
  const skill=parseSkills(defs.R.skill).find(sk=>sk.keyword?.name==="Over Realm");assert.ok(skill);
  const tax:TaxInForce={ops:[{op:"choose",sel:{area:"drop",side:"you",count:1},as:"payment"},{op:"moveTo",target:{var:"payment"},to:"warp"}],by:null,until:"turn",key:"fixture"};
  assert.equal(unpaidActivationTax(ctx,game,s,master,"revive",[tax]),null,"Drop tax payable before keyword cost");
  assert.equal(unpaidKeywordPlayTax(ctx,game,s,master,"revive",skill,[tax],0),tax,"Over Realm projected payment exhausts the Drop tax pool");
  assert.equal(JSON.stringify(s),before);validateStandingNegationRead(ctx,s);count++;
 }
 {
  let s=fresh();for(const a of [{type:"chooseFirst",player:s.chooser,first:master},{type:"mulligan",player:master,redraw:false},{type:"mulligan",player:other,redraw:false},{type:"pass",player:master}] as Action[])s=RULES.apply(ctx,s,a).state as VmState;
  const watcher=s.sides[master].zones.leader[0];s.cards[watcher].cardId="W";king(s);add(s,"subject","F","combo");s.cards.subject.faceUp=true;s.cards.otherSubject=newCard("otherSubject","F",other);s.sides[other].zones.combo.push("otherSubject");
  const guard=s.sides[other].zones.leader[0];s.battle={attacker:"king",guard,target:guard,step:"battleEnd",negated:false,blockerOffered:false,counters:[]};s.phase="battle";s.flow.push({phase:"battle",index:game.phases.battle.steps.indexOf("battleEnd"),repeats:0});
  run(ctx,game,s,[]);
  for(let i=0;i<2 && s.prompt.kind==="zEnergyFromCombo";i++)s=RULES.apply(ctx,clone(s),{type:"zEnergyFromCombo",player:s.prompt.player,card:null}).state as VmState;
  assert.equal(s.prompt.kind,"chooseCards");assert.ok(s.sides[master].zones.combo.includes("subject"),"projection did not move live Combo subject");assert.ok(s.programs[0].subjectInfo);assert.equal(s.programs[0].subjectInfo?.faceUp,false);assert.equal(s.cards.subject.faceUp,true);
  const before=JSON.stringify(s);const result=RULES.apply(ctx,s,{type:"choose",player:master,cards:["subject"]}).state as VmState;assert.equal(JSON.stringify(s),before);assert.ok(result.sides[master].zones.drop.includes("subject"));assert.equal(skillsNegated(result,"king"),false);count++;
 }

 {
  const s=fresh();king(s);add(s,"coupon","F");vmHost(ctx,game,s,[]).addEffect({target:"coupon",kind:"cost",value:-1,until:"turn",uses:1,master});
  s.cards.king.zoneEpoch=(s.cards.king.zoneEpoch??0)+1;const before=JSON.stringify(s);
  assert.throws(()=>spendPriceUses(ctx,s,[],"coupon"));assert.equal(JSON.stringify(s),before,"stale cost history refuses before decrement or expiry");count++;
 }

}
console.log(`standing-negation costs/projections: ${count} grouped cases passed`);
