/** R-389: Burst conditions remember the paid cards; playing them requires their paid occurrence. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { openLandedPlayWindow } from "../../src/lib/arena/vm/battle";
import { chargeCost, type VmPayment } from "../../src/lib/arena/vm/costs";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { NotYet } from "../../src/lib/arena/vm/errors";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { attrsNow, hasKeyword, condHolds, resolveSelector } from "../../src/lib/arena/vm/program";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { moved, run } from "../../src/lib/arena/vm/flow";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const PRINTS={"BT12-039": {"skill": "[unique][barrier][dual attack]<br>[activate: main]{u}{u}{u}, if your Leader Card is a blue <Paikuhan> card and you place 1 blue <Son Goku> card and 1 blue <Vegeta> card with energy costs of 1 from your deck in your Drop Area and shuffle your deck: Play this card from your hand.<br>[activate: main][once per turn][burst 1]{u}, if your Leader Card is a blue <Paikuhan> card and you have 4 or more energy: If the card placed in your Drop Area with this skill was a blue <Gogeta> card with an energy cost of 8, play it on top of this card.", "backSkill": null}, "BT16-145": {"skill": "[energy-exhaust]\r [xeno-evolve]{u}/{b}: <Vegeta: Xeno> with an energy cost of 3 or less.\r [auto][limit 1][burst 1] When this card is played or your opponent attacks, if the card placed in your Drop Area using this skill is a black ≪Saiyan≫ card, draw 1 card.", "backSkill": null}, "BT12-044": {"skill": "[Auto] When this card is played, look at up to 2 cards from the top of your deck, add up to 1 mono-blue card among them to your hand, then place the remaining cards at the top or bottom of your deck in any order. You can't play copies of this card for the turn.<br>[Auto][Burst 1] If your Leader Card is a blue &lt;Paikuhan&gt; card: When this card is removed from your Battle Area by a skill, if the card you placed in the Drop Area with this skill was a blue &lt;Son Goku&gt; or &lt;Vegeta&gt; card with an energy cost of 1, you may play it with its skills negated for the turn.", "backSkill": null}, "BT12-043": {"skill": "[Auto] If your Leader Card is a blue &lt;Paikuhan&gt; card: When this card is played, draw 1 card, add up to 1 card from your life to your hand, then choose 1 card in your hand and place it on top of your deck.<br>[Auto][Burst 1] If your Leader Card is a blue &lt;Paikuhan&gt; card: When this card is removed from your Battle Area by a skill, if the card you placed in the Drop Area with this skill was a blue &lt;Son Goku&gt; or &lt;Vegeta&gt; card with an energy cost of 1, you may play it with its skills negated for the turn.", "backSkill": null}, "BT16-146": {"skill": "[energy-exhaust]\r [xeno-evolve]{y}/{b}: <Son Goku: Xeno> with an energy cost of 3 or less.\r [auto][limit 1][burst 1] When this card is played or your opponent attacks, if the card placed in your Drop Area using this skill is a black ≪Saiyan≫ card, your opponent chooses 1 card in their hand and sends it to their Warp.", "backSkill": null}, "SD16-01": {"skill": "[Activate: Main][Once per turn][Burst 3] Add up to 1 card from your life to your hand; if a black card is placed in your Drop Area by this skill, this card gains [Critical] for the turn. If a non-black card is placed in your Drop Area by this skill, this card gets +5000 power for the turn.<br>[Awaken] When your life is at 4 or less: You may draw 1 card, switch up to 1 of your energy to Active Mode, then flip this card over.", "backSkill": "[Auto] When this card attacks, draw 1 card.<br>[Auto][Once per turn] Add 1 card from your life to your hand: When you remove a marker from one of your black Unison Cards using a [Spirit Boost] skill, switch this card to Active Mode and negate its keyword skills for the turn.<br>[Activate: Main][Once per turn][Burst 3] If a black card is placed in your Drop Area by this skill, this card gains [Critical] for the turn. If a non-black card is placed in your Drop Area by this skill, this card gets +5000 power for the turn."}} as const;
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const defs:Record<string,CardDef>={
 LEADER:card("LEADER",{type:"LEADER",colors:["Blue"],characters:["Paikuhan"]}),
 FILLER:card("FILLER",{colors:["Blue"]}), BLACK:card("BLACK",{colors:["Black"],traits:["Saiyan"]}),
 MULTI:card("MULTI",{colors:["Black","Blue"],traits:["Saiyan"]}), WRONG_TRAIT:card("WRONG_TRAIT",{colors:["Black"],traits:["Earthling"]}),
 GOKU:card("GOKU",{colors:["Blue"],characters:["Son Goku"],energyCost:1,skill:"[Barrier]"}), VEGETA:card("VEGETA",{colors:["Blue"],characters:["Vegeta"],energyCost:1,skill:"[Barrier]"}),
 GOGETA:card("GOGETA",{colors:["Blue"],characters:["Gogeta"],energyCost:8}),
};
defs.GOKU_COST=card("GOKU_COST",{colors:["Blue"],characters:["Son Goku"],energyCost:2});
defs.GOKU_RED=card("GOKU_RED",{colors:["Red"],characters:["Son Goku"],energyCost:1});
defs.GOGETA_COST=card("GOGETA_COST",{colors:["Blue"],characters:["Gogeta"],energyCost:7});
defs.GOGETA_RED=card("GOGETA_RED",{colors:["Red"],characters:["Gogeta"],energyCost:8});
for(const [id,p] of Object.entries(PRINTS))defs[id]=card(id,{type:id==="SD16-01"?"LEADER":"BATTLE",energyCost:0,skill:p.skill,colors:["Blue"],power:10000,...(p.backSkill?{back:{name:"Burst Leader",power:15000,skill:p.backSkill}}:{})});
defs.RESPONSE=card("RESPONSE",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] Choose up to 1 card in your opponent's Drop Area and send it to its owner's Warp."});
defs["SD16-03"]=card("SD16-03",{colors:["Red"],energyCost:6,power:30000,skill:"[unique]<br>[permanent] This card is also treated as black in all areas.<br>[auto] When this card is played, choose up to 1 of your opponent's Battle Cards and it gets -15000 power for the turn.<br>[activate: main][limit 1] (You can only activate this skill once per turn across all copies of this card.) [spirit boost 1] (You must remove a marker from your Unison Card to activate this skill.) {1}, if you have 3 or more energy and you send 1 red card, 1 blue card, 1 green card, and 1 yellow card from your Drop Area to your Warp: Play this card from your Drop Area or Warp, and it gains [critical] for the turn."});
defs.BOOST=card("BOOST",{skill:"[Activate: Main][Spirit Boost 1] Draw 1 card."});
defs.UNISON=card("UNISON",{type:"UNISON",colors:["Black"]});
defs.STANDING=card("STANDING",{type:"LEADER",skill:"[Permanent] Negate the keyword skills of all your Battle Cards."});
defs.PROTECTED_BURST={...defs["BT16-145"],id:"PROTECTED_BURST",skill:defs["BT16-145"].skill+"<br>[Permanent] This card’s skills can’t be negated."};
const records=Object.values(defs).flatMap(skillRecords);
for(const r of records.filter(r=>/\[burst/i.test(r.printed)))assert.deepEqual(r.unread,[],r.cardId+"#"+r.skillIndex);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,source:"compiler",status:"draft"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(ctx,copy(s),a).state as VmState;
function fresh(first:PlayerId):VmState{
 let s=RULES.createGame(ctx,{seed:389,p1:{name:"One",leader:"LEADER",main:fifty("FILLER")},p2:{name:"Two",leader:"LEADER",main:fifty("FILLER")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);
 return s;
}
function stage(s:VmState,owner:PlayerId,def:string,area:string):string{
 const id=s.sides[owner].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner}).ok);s.pending=[];return id;
}
function top(s:VmState,owner:PlayerId,names:string[]):string[]{const ids=s.sides[owner].zones.deck.slice(0,names.length);ids.forEach((id,i)=>s.cards[id].cardId=names[i]);return ids;}
function settle(s:VmState,picks:string[]=[],decline=false):VmState{
 for(let n=0;n<60&&s.prompt.kind!=="main";n++){
  let action:Action|undefined;
  if(s.prompt.kind==="chooseCards"){
   const pr=s.prompt;const candidates=pr.choice.candidates;const selected=picks.find(id=>candidates.includes(id));
   action={type:"choose",player:pr.player,cards:selected?[selected]:candidates.slice(0,pr.choice.min??0)};
  }else{
   const a=RULES.legalActions(ctx,s).map(x=>x.action);
   action=a.find(a=>a.type==="chooseMode"&&a.index===(decline&&s.prompt.kind==="chooseMode"?s.prompt.options.length-1:0))??a.find(a=>a.type==="counter"&&a.card===null)??a.find(a=>a.type==="orderPending"&&!a.decline)??a[0];
  }
  assert.ok(action,JSON.stringify(s.prompt));s=take(s,action);
 }
 return s;
}
let cases=0;
for(const owner of ["p1","p2"] as const)for(const back of [false,true])for(const pool of [["BLACK","BLACK","BLACK"],["FILLER","FILLER","FILLER"],["BLACK","FILLER","FILLER"],["MULTI","MULTI","MULTI"],["SD16-03","SD16-03","SD16-03"]]){
 let s=fresh(owner);const source=s.sides[owner].zones.leader[0];s.cards[source].cardId="SD16-01";s.cards[source].flipped=back;
 stage(s,owner,"BLACK","drop");stage(s,owner,"FILLER","drop");const paid=top(s,owner,pool);
 const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source&&a.skill===(back?20:0));assert.ok(a);
 s=settle(take(s,a));assert.ok(paid.every(id=>s.sides[owner].zones.drop.includes(id)));
 assert.equal(hasKeyword(ctx,game,s,source,"Critical"),pool.some(x=>x!=="FILLER"));
 assert.equal(attrsNow(ctx,game,s,source).power,(back?15000:10000)+(pool.some(x=>x!=="BLACK")?5000:0));cases++;
}
// SD16-001 FAQ: its actual second Auto negates Burst but leaves Activate usable.
for(const owner of ["p1","p2"] as const)for(const shortDeck of [false,true]){
 let s=fresh(owner);const leader=s.sides[owner].zones.leader[0];s.cards[leader].cardId="SD16-01";s.cards[leader].flipped=true;s.cards[leader].mode="rest";
 const unison=stage(s,owner,"UNISON","unison");s.cards[unison].markers=2;
 const booster=stage(s,owner,"BOOST","battle");
 const boost=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===booster);assert.ok(boost);
 s=settle(take(s,boost));assert.equal(s.cards[leader].mode,"active");
 top(s,owner,["BLACK","FILLER","MULTI"]);
 if(shortDeck)s.sides[owner].zones.deck.splice(1);
 const before=s.sides[owner].zones.deck.length;
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===leader&&a.skill===20);assert.ok(action);
 s=settle(take(s,action));assert.equal(s.sides[owner].zones.deck.length,before);assert.equal(attrsNow(ctx,game,s,leader).power,15000);cases++;
}
// BT31-002b's standing Permanent suppresses Burst; protection preserves it.
for(const owner of ["p1","p2"] as const)for(const protectedSkill of [false,true]){
 let s=fresh(owner);s.cards[s.sides[owner].zones.leader[0]].cardId="STANDING";
 const source=stage(s,owner,protectedSkill?"PROTECTED_BURST":"BT16-145","hand");const paid=top(s,owner,["BLACK"])[0];
 const play=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="play"&&a.card===source);assert.ok(play);
 s=settle(take(s,play));assert.equal(s.sides[owner].zones.drop.includes(paid),protectedSkill);cases++;
}
for(const owner of ["p1","p2"] as const)for(const sourceDef of ["BT16-145","BT16-146"] as const)for(const paidDef of ["BLACK","MULTI","FILLER","WRONG_TRAIT"]){
 let s=fresh(owner);const source=stage(s,owner,sourceDef,"hand");stage(s,owner,"BLACK","drop");const paid=top(s,owner,[paidDef])[0];
 const hand=s.sides[owner].zones.hand.length,foeHand=s.sides[other(owner)].zones.hand.length;
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="play"&&a.card===source);assert.ok(action);
 s=settle(take(s,action));const yes=["BLACK","MULTI"].includes(paidDef);
 assert.ok(s.sides[owner].zones.drop.includes(paid));assert.equal(s.sides[owner].zones.hand.length,hand-1+(sourceDef==="BT16-145"&&yes?1:0));
 assert.equal(s.sides[other(owner)].zones.hand.length,foeHand-(sourceDef==="BT16-146"&&yes?1:0));cases++;
}
for(const owner of ["p1","p2"] as const)for(const sourceDef of ["BT12-043","BT12-044"] as const)for(const paidDef of ["GOKU","VEGETA","FILLER","GOKU_COST","GOKU_RED"]){
 let s=fresh(owner);const source=stage(s,owner,sourceDef,"battle");const old=stage(s,owner,"GOKU","drop");const paid=top(s,owner,[paidDef])[0];
 moved(ctx,game,s,[],source,"drop",{by:"skill",byOpponent:true,byCard:s.sides[other(owner)].zones.leader[0]});run(ctx,game,s,[]);
 s=settle(copy(s),[paid]);assert.equal(s.sides[owner].zones.battle.includes(paid),["GOKU","VEGETA"].includes(paidDef));if(["GOKU","VEGETA"].includes(paidDef))assert.equal(hasKeyword(ctx,game,s,paid,"Barrier"),false,"played paid card has its skills negated");assert.ok(s.sides[owner].zones.drop.includes(old));cases++;
}
for(const owner of ["p1","p2"] as const)for(const paidDef of ["GOGETA","GOKU","GOGETA_COST","GOGETA_RED"]){
 let s=fresh(owner);const source=stage(s,owner,"BT12-039","battle");for(let i=0;i<4;i++)stage(s,owner,"FILLER","energy");const paid=top(s,owner,[paidDef])[0];
 const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source&&a.skill===20);assert.ok(a);s=settle(take(s,a),[paid]);
 assert.equal(s.sides[owner].zones.battle.includes(paid),paidDef==="GOGETA");if(paidDef==="GOGETA")assert.ok(s.cards[paid].under.includes(source));cases++;
}
// Natural post-payment life-choice checkpoint: historical facts survive changes,
// while live selectors reject a paid card which left and returned as a new occurrence.
for(const owner of ["p1","p2"] as const)for(const change of ["gain-black","leave","return"]){
 let s=fresh(owner);const source=s.sides[owner].zones.leader[0];s.cards[source].cardId="SD16-01";
 const wasBlack=change!=="gain-black";const paid=top(s,owner,wasBlack?["BLACK","BLACK","BLACK"]:["FILLER","FILLER","FILLER"]);
 const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source&&a.skill===0);assert.ok(a);s=take(s,a);assert.equal(s.prompt.kind,"chooseCards");
 const frame=s.programs.find(f=>f.card===source&&f.paidCardInfo)!;assert.ok(frame);assert.deepEqual(frame.vars.paid_burst,paid);
 if(change==="gain-black")for(const id of paid)addEffect(s,[],{target:id,kind:"gains",value:{colors:["Black"],names:[],characters:[],traits:[]},until:"turn",master:owner,source});
 else for(const id of paid){assert.ok(moveCard(s,game,id,"warp",{owner}).ok);if(change==="return")assert.ok(moveCard(s,game,id,"drop",{owner}).ok);}
 s=copy(s);const restored=s.programs.find(f=>f.card===source&&f.paidCardInfo)!;
 const blackCond=records.find(r=>r.cardId==="SD16-01"&&r.side==="front"&&r.skillIndex===0)!.ops.find(o=>o.op==="if");assert.ok(blackCond?.op==="if");
 assert.equal(condHolds(ctx,game,s,restored,blackCond.cond),wasBlack);
 assert.equal(resolveSelector(ctx,game,s,restored,{fromVar:"paid_burst",area:"drop",side:"you"},true).length,change==="gain-black"?3:0);
 s=settle(s);assert.equal(hasKeyword(ctx,game,s,source,"Critical"),wasBlack);assert.equal(attrsNow(ctx,game,s,source).power,wasBlack?10000:15000);cases++;
}
// Declined Auto never binds a payment; failed native resource gates pay nothing.
for(const owner of ["p1","p2"] as const){
 let s=fresh(owner);const source=stage(s,owner,"BT16-145","hand");const paid=top(s,owner,["BLACK"])[0];
 const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="play"&&a.card===source);assert.ok(a);s=settle(take(s,a),[],true);
 assert.ok(s.sides[owner].zones.deck.includes(paid));assert.ok(!s.programs.some(f=>f.paidCardInfo?.paid_burst));cases++;
 const t=fresh(owner),leader=t.sides[owner].zones.leader[0];t.cards[leader].cardId="SD16-01";t.sides[owner].zones.deck.splice(2);
 assert.ok(!RULES.legalActions(ctx,t).some(x=>x.action.type==="activate"&&x.action.card===leader&&x.action.skill===0));cases++;
}
for(const owner of ["p1","p2"] as const)for(const change of ["leave","return"]){
 let s=fresh(owner);const source=stage(s,owner,"BT12-043","battle"),paid=top(s,owner,["GOKU"])[0];
 moved(ctx,game,s,[],source,"drop",{by:"skill",byOpponent:true,byCard:s.sides[other(owner)].zones.leader[0]});run(ctx,game,s,[]);
 for(let n=0;n<8&&!s.programs.some(f=>f.paidCardInfo?.paid_burst);n++){
  const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="chooseMode"&&a.index===0)??RULES.legalActions(ctx,s)[0]?.action;assert.ok(a);s=take(s,a);
 }
 assert.equal(s.prompt.kind,"chooseMode","optional play pauses after paying Burst");assert.ok(s.programs.some(f=>f.paidCardInfo?.paid_burst));
 assert.ok(moveCard(s,game,paid,"warp",{owner}).ok);if(change==="return")assert.ok(moveCard(s,game,paid,"drop",{owner}).ok);
 s=settle(copy(s),[paid]);assert.ok(!s.sides[owner].zones.battle.includes(paid),"play it cannot follow the ID to a new occurrence");cases++;
}
// Staged postpayment response checkpoint: use the native Counter prompt/handler,
// without claiming this suite supplies the shared Counter timing under development.
for(const owner of ["p1","p2"] as const){
 let s=fresh(owner);const foe=other(owner),source=s.sides[owner].zones.leader[0];s.cards[source].cardId="SD16-01";
 const counter=stage(s,foe,"RESPONSE","hand"),played=stage(s,owner,"FILLER","battle"),paid=top(s,owner,["BLACK","FILLER","FILLER"])[0];
 const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source&&a.skill===0);assert.ok(a);s=take(s,a);
 const index=s.programs.findIndex(f=>f.card===source&&!!f.paidCardInfo);assert.ok(index>=0);const [resume]=s.programs.splice(index,1);delete resume.awaiting;
 assert.ok(openLandedPlayWindow(ctx,game,s,played,owner,resume));s=copy(s);
 const response=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="counter"&&a.card===counter);assert.ok(response);s=take(s,response);
 assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:foe,cards:[paid]});assert.ok(s.sides[owner].zones.warp.includes(paid));
 s=settle(copy(s));assert.equal(hasKeyword(ctx,game,s,source,"Critical"),true,"Counter moving the paid card cannot erase its historical color");cases++;
}
// Suppressed/replaced resource movement never exposes successful payment memory.
for(const owner of ["p1","p2"] as const)for(const failed of ["suppressed","replaced"]){
 const s=fresh(owner),ids=top(s,owner,["BLACK","BLACK"]);const source=s.sides[owner].zones.leader[0];
 const payment:VmPayment={rest:[],energyMarkers:0,markers:0,markersOff:[],life:[],pooled:[{cost:"burst",cards:ids}],restsSelf:false};
 let memory:ReturnType<typeof chargeCost>|undefined;
 assert.throws(()=>{memory=chargeCost(ctx,game,s,[],owner,payment,source,["burst"],(id,to,opts)=>{if(id===ids[0])moved(ctx,game,s,[],id,to,opts);else if(failed==="replaced")moved(ctx,game,s,[],id,"warp",opts);});},IllegalAction);
 assert.equal(memory,undefined);assert.ok(!s.programs.some(f=>f.paidCardInfo?.paid_burst));cases++;
}
// Historical admission is explicit: obsolete saved memory cannot fall back to a live variable.
{
 const r=records.find(r=>r.cardId==="BT16-145"&&r.skillIndex===20)!;assert.ok(r.cond?.kind==="varMatches"&&r.cond.paid);
 const s=fresh("p1"),id=stage(s,"p1","BLACK","drop");
 assert.throws(()=>condHolds(ctx,game,s,{ops:[],ip:0,vars:{paid_burst:[id]},card:s.sides.p1.zones.leader[0],master:"p1"},r.cond!),NotYet);
 assert.equal(condHolds(ctx,game,s,{ops:[],ip:0,vars:{ordinary:[id]},card:s.sides.p1.zones.leader[0],master:"p1"},{...r.cond,paid:undefined,var:"ordinary"}),true);
}
for(const r of records.filter(r=>/\[burst/i.test(r.printed))){
 const rule=copy({kind:r.kind,trigger:r.trigger,cost:r.cost,usage:r.usage,validity:r.validity,cond:r.cond,ops:r.ops}) as Rule;
 assert.equal(validateRule(rule,r.kind),null);const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);
 const plain=(v:unknown)=>JSON.parse(JSON.stringify(v,(key,v)=>key==="upTo"&&v===false?undefined:v));assert.deepEqual(plain(parsed.value),plain(rule));
}
console.log(`Burst memory 5: ${cases} stored/native both-seat scenarios passed`);
