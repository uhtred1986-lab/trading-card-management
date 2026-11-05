/** R466 actual stored Trunks under-Plan native Counter route. */
import assert from "node:assert/strict";
import {stepScript} from "../../src/lib/arena/vm/script";
import {vmHost} from "../../src/lib/arena/vm/host";
import {attrsNow} from "../../src/lib/arena/vm/program";
import {RULES} from "../../src/lib/arena/vm";
import {card,fifty} from "./harness";
import {skillRecords} from "../../src/lib/arena/draft";
import {rulesFromRows,type RuleRow} from "../../src/lib/arena/rules-store";
import {rulesetFor} from "../../src/lib/arena/rulesets";
import {moveCard} from "../../src/lib/arena/vm/zones";
import type {Action,GameEvent,EngineContext,PlayerId} from "../../src/lib/arena/types";
import type {VmState} from "../../src/lib/arena/vm/state";
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const defs = {
  L: card("L",{type:"LEADER",colors:["Blue"],traits:["Boujack Brigade"]}), F:card("F",{colors:["Blue"]}),
  PLAN:card("PLAN",{name:"Universal Tuffleization Plan",type:"EXTRA",colors:["Blue"],skill:"[Barrier][Field]"}),
  BUJIN:card("BUJIN",{name:"Bujin, the Commando",colors:["Blue"],energyCost:1,specifiedCost:{Blue:1},skill:"[Counter: Attack] If your Leader Card is a ≪Boujack Brigade≫ card: Negate the attack and play this card. If you activated this card’s [Counter: Attack] skill from your energy, place the top card of your deck in your energy in Rest Mode.<br>[Permanent] You can activate this card’s [Counter] skill from your energy by paying its energy cost and choosing 1 card in your hand and discarding it."}),
  TAX2:card("TAX2",{skill:"[Permanent] Your opponent can’t activate skills unless they send 2 cards from their hand to their Warp each time."}),
  TAX:card("TAX",{skill:"[Permanent] Your opponent can’t activate skills unless they send 1 card from their hand to their Warp each time."}),
  ANSWER:card("ANSWER",{type:"EXTRA",energyCost:0,skill:"[Counter: Counter] Negate the [Counter] skill."}),
  BLOCK:card("BLOCK",{skill:"[Permanent] You can only play mono-yellow ≪Saiyan≫ cards."}),
  BABY:card("BABY",{colors:["Blue"],characters:["Baby"]}), REDBABY:card("REDBABY",{colors:["Red"],characters:["Baby"]}),
  DUO:card("DUO",{colors:["Blue","Red"]}),
  REDUCER:card("REDUCER",{skill:"[Permanent] Reduce the energy cost of blue Battle Cards in your hand by 1."}),
  TRUNKS:card("TRUNKS",{name:"Trunks, Domination Complete",colors:["Blue"],energyCost:3,specifiedCost:{Blue:1},power:5000,skill:"[Servant]<br>[Counter: Attack][Limit 1] Negate the attack and play this card in Rest Mode.<br>[Permanent] During your opponent's turn, if you have a blue <Baby> in play, reduce the energy cost of this card in all areas by 2.<br>[Permanent] If this card is under a {Universal Tuffleization Plan} in your Battle Area, you can activate this card's [Counter] skill under the same conditions as if it were in your hand."}),
};
const rows=Object.values(defs).flatMap(skillRecords).map((row,id)=>({...row,id,status:"confirmed",source:"compiler"}) as unknown as RuleRow);
const ctx:EngineContext={defs,scripts:rulesFromRows(rows,defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
function stage(s:VmState,p:PlayerId,def:string,area:string){const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);return id;}
const history:GameEvent[]=[];
const take=(s:VmState,a:Action)=>{const r=RULES.apply(ctx,copy(s),a);history.push(...r.events);return r.state as VmState;};
function fresh(owner:PlayerId){const first=other(owner);let s=RULES.createGame(ctx,{seed:463,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:owner,redraw:false},{type:"charge",player:first,card:null},{type:"endMain",player:first},{type:"charge",player:owner,card:null},{type:"endMain",player:owner},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);s.sides[owner].attrs.energyMarkers=0;return s;}
function finish(s:VmState){for(let n=0;n<50&&s.prompt.kind!=="main";n++){assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));const p=s.prompt;if(p.kind==="chooseCards")s=take(s,{type:"choose",player:p.player,cards:p.choice.candidates.slice(0,p.choice.min)});else {const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="payCost")??RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="counter"&&a.card===null)??RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="orderPending");assert.ok(a,JSON.stringify(p));s=take(s,a);}}assert.equal(s.prompt.kind,"main");return s;}
let cases=0;
for(const owner of ["p1","p2"] as const) for(const borrowed of [false,true]) for(const blocked of [false,true]) {
 history.length=0;let s=fresh(owner);const first=other(owner),sourceOwner=borrowed?first:owner;
 const host=stage(s,owner,"PLAN","battle"),source=stage(s,sourceOwner,"TRUNKS","hand");
 stage(s,owner,"BABY","battle");if(blocked)stage(s,owner,"BLOCK","battle");const energy=stage(s,owner,"F","energy");
 assert.ok(moveCard(s,game,source,"battle",{owner,under:host}).ok);
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 assert.ok(RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===source),JSON.stringify(s.prompt));
 s=take(s,{type:"counter",player:owner,card:source});s=finish(s);
 assert.ok(s.sides[blocked?sourceOwner:owner].zones[blocked?"drop":"battle"].includes(source));
 if(!blocked){assert.equal(s.cards[source].mode,"rest");assert.equal(attrsNow(ctx,game,s,source).power,15000);}
 assert.equal(s.cards[energy].mode,"rest");assert.equal(s.cards[source].owner,sourceOwner);
 assert.equal(history.filter(e=>e.type==="skill"&&e.card===source).length,1);cases++;
}
// Menu rejection and saved-state faults; fault injection is not an invented
// opportunity to move cards during atomic payment.
for(const owner of ["p1","p2"] as const) for(const fault of ["wrong-host","no-baby","no-energy","negated","external","source-aba","host-epoch","missing","malformed"] as const){
 let s=fresh(owner);const first=other(owner),host=stage(s,owner,fault==="wrong-host"?"F":"PLAN","battle"),source=stage(s,owner,"TRUNKS","hand");
 if(fault!=="no-baby")stage(s,owner,"BABY","battle");if(fault!=="no-energy")stage(s,owner,"F","energy");
 assert.ok(moveCard(s,game,source,"battle",{owner,under:host}).ok);
 if(fault==="external")stage(s,owner,"REDUCER","battle");
 if(fault==="negated")assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"negateSkillsOfKind",kind:"permanent",target:{var:"source"},until:"turn"}],ip:0,vars:{source:[source]},card:s.sides[first].zones.leader[0],master:first}),"done");
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 if(["source-aba","host-epoch","missing","malformed"].includes(fault)){
  assert.equal(s.prompt.kind,"counter");if(s.prompt.kind!=="counter")throw new Error("counter");
  if(fault==="source-aba"){assert.ok(moveCard(s,game,source,"drop",{owner}).ok);assert.ok(moveCard(s,game,source,"battle",{owner,under:host}).ok);}
  if(fault==="host-epoch")s.cards[host].zoneEpoch=(s.cards[host].zoneEpoch??0)+1;
  if(fault==="missing")delete s.prompt.underOccurrences;
  if(fault==="malformed")s.prompt.underOccurrences!.version=0 as 1;
  assert.throws(()=>take(s,{type:"counter",player:owner,card:source}),/under-card Counter/);
 }
 const legal=RULES.legalActions(ctx,s),rejected=RULES.rejectedActions(ctx,s,legal);
 assert.ok(!legal.some(x=>x.action.type==="counter"&&x.action.card===source),fault);
 if(s.prompt.kind==="counter")assert.equal(RULES.abilityAvailability(ctx,s,owner,legal,rejected).find(x=>x.card===source&&x.skill===10)?.state,"refused",fault);
 cases++;
}
for(const owner of ["p1","p2"] as const) for(const fault of ["none","source-aba","host-aba","missing"] as const){
 let s=fresh(owner);const first=other(owner),host=stage(s,owner,"PLAN","battle"),source=stage(s,owner,"TRUNKS","hand");
 stage(s,owner,"BABY","battle");const energy1=stage(s,owner,"F","energy"),energy2=stage(s,owner,"DUO","energy");
 assert.ok(moveCard(s,game,source,"battle",{owner,under:host}).ok);
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 s=take(s,{type:"counter",player:owner,card:source});assert.equal(s.prompt.kind,"payCost");
 if(s.prompt.kind!=="payCost")throw new Error("payCost");
 if(fault==="missing")delete s.prompt.underOccurrences;
 if(fault==="source-aba"){assert.ok(moveCard(s,game,source,"drop",{owner}).ok);assert.ok(moveCard(s,game,source,"battle",{owner,under:host}).ok);}
 if(fault==="host-aba"){assert.ok(moveCard(s,game,host,"hand",{owner}).ok);assert.ok(moveCard(s,game,host,"battle",{owner}).ok);assert.ok(moveCard(s,game,source,"battle",{owner,under:host}).ok);}
 if(fault!=="none"){
  assert.throws(()=>take(s,{type:"payCost",player:owner,option:0}),/under-card Counter/);
  assert.equal(s.cards[energy1].mode,"active");assert.equal(s.cards[energy2].mode,"active");
 }else{s=take(s,{type:"payCost",player:owner,option:0});s=finish(s);assert.ok(s.sides[owner].zones.battle.includes(source));}
 cases++;
}
for(const owner of ["p1","p2"] as const) for(const answer of [false,true]) {
 history.length=0;let s=fresh(owner);const first=other(owner),host=stage(s,owner,"PLAN","battle"),source=stage(s,owner,"TRUNKS","hand"),second=stage(s,owner,"TRUNKS","hand");
 stage(s,owner,"BABY","battle");stage(s,owner,"F","energy");const response=stage(s,first,"ANSWER","hand");
 assert.ok(moveCard(s,game,source,"battle",{owner,under:host}).ok);assert.ok(moveCard(s,game,second,"battle",{owner,under:host}).ok);
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 s=take(s,{type:"counter",player:owner,card:source});assert.equal(s.prompt.kind,"counter");
 s=take(s,{type:"counter",player:first,card:answer?response:null});
 // Declining a negate-counter response ends the current timing. The negated
 // attack path returns Main; the negated Counter path finishes normal combat.
 for(let n=0;n<20&&s.prompt.kind!=="main";n++){
  if(s.prompt.kind==="combo")s=take(s,{type:"pass",player:s.prompt.player});
  else {const act=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="counter"&&a.card===null)??RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="pass");assert.ok(act,JSON.stringify(s.prompt));s=take(s,act);}
 }
 assert.equal(s.prompt.kind,"main");assert.ok(s.sides[owner].zones[answer?"drop":"battle"].includes(source));
 assert.equal(history.filter(e=>e.type==="skill"&&e.card===source).length,1);
 s.cards[s.sides[owner].zones.energy[0]].mode="active"; // state fixture: isolate Limit from affordability
 const attacker=stage(s,first,"F","battle");s=take(s,{type:"attack",player:first,attacker,target:s.sides[owner].zones.leader[0]});
 assert.ok(!RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===second));cases++;
}
// Actual tax continuation, with explicit saved-state protocol faults.
for(const owner of ["p1","p2"] as const) for(const fault of ["none","source-aba","host-aba","missing-child","missing-parent","missing-source","missing-gate-from","missing-gate-counter","child-cost","child-gate"] as const){
 history.length=0;let s=fresh(owner);const first=other(owner),host=stage(s,owner,"PLAN","battle"),source=stage(s,owner,"TRUNKS","hand");
 stage(s,owner,"BABY","battle");const energy=stage(s,owner,"F","energy");stage(s,first,"TAX","battle");
 assert.ok(moveCard(s,game,source,"battle",{owner,under:host}).ok);
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 s=take(s,{type:"counter",player:owner,card:source});assert.equal(s.prompt.kind,"chooseCards",JSON.stringify(s.outcome));
 const child=s.programs.find(f=>f.counterNonhandTax)!,parent=s.programs.find(f=>f.counterCost)!,gate=s.programs.find(f=>f.taxGate)!;
 assert.ok(child);assert.ok(parent);assert.equal(gate.taxGate!.from,"under");
 const payer=s.sides[owner].zones.hand[0];assert.equal(s.cards[energy].mode,"rest");assert.equal(history.filter(e=>e.type==="skill"&&e.card===source).length,0);
 if(fault==="missing-child")delete child.counterNonhandTax;
 if(fault==="missing-parent")delete parent.counterCost!.underOrigin;
 if(fault==="missing-source")delete gate.taxGate!.counterUnderSource;
 if(fault==="missing-gate-from"){delete gate.taxGate!.from;delete child.counterNonhandTax;}
 if(fault==="missing-gate-counter"){delete gate.taxGate!.counter;delete child.counterNonhandTax;}
 if(fault==="child-cost")child.counterCost=structuredClone(parent.counterCost);
 if(fault==="child-gate")child.taxGate=structuredClone(gate.taxGate);
 if(fault==="source-aba"){assert.ok(moveCard(s,game,source,"drop",{owner}).ok);assert.ok(moveCard(s,game,source,"battle",{owner,under:host}).ok);}
 if(fault==="host-aba"){assert.ok(moveCard(s,game,host,"hand",{owner}).ok);assert.ok(moveCard(s,game,host,"battle",{owner}).ok);assert.ok(moveCard(s,game,source,"battle",{owner,under:host}).ok);}
 s=take(s,{type:"choose",player:owner,cards:[payer]});
 assert.equal(s.sides[owner].zones.hand.includes(payer),fault!=="none","invalid saved tax ownership cannot spend a payer");
 assert.equal(history.filter(e=>e.type==="skill"&&e.card===source).length,fault==="none"?1:0);
 if(fault==="none"){s=finish(s);assert.ok(s.sides[owner].zones.battle.includes(source));}
 else if(!fault.endsWith("aba"))assert.match(JSON.stringify(s.outcome),/rebuild/);
 cases++;
}
for(const owner of ["p1","p2"] as const){
 history.length=0;let s=fresh(owner);const first=other(owner),host=stage(s,owner,"PLAN","battle"),source=stage(s,owner,"TRUNKS","hand");
 stage(s,owner,"BABY","battle");stage(s,owner,"F","energy");stage(s,first,"TAX","battle");
 assert.ok(moveCard(s,game,source,"battle",{owner,under:host}).ok);
 const offered=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 assert.ok(RULES.legalActions(ctx,offered).some(x=>x.action.type==="counter"&&x.action.card===source),"positive tax control before replacement");
 const payers=[...s.sides[owner].zones.hand];
 assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"replaceLeave",to:"drop",until:"turn",target:{var:"payers"}}],ip:0,vars:{payers},card:s.sides[first].zones.leader[0],master:first}),"done");
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 if(RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===source)){
  s=take(s,{type:"counter",player:owner,card:source});assert.equal(s.prompt.kind,"chooseCards");
  s=take(s,{type:"choose",player:owner,cards:[payers[0]]});
 }
 assert.equal(history.filter(e=>e.type==="skill"&&e.card===source).length,0,"a replaced tax movement never activates the Counter");cases++;
}
for(const owner of ["p1","p2"] as const)for(const fault of ["none","selected-aba","missing-payer"] as const){
 history.length=0;let s=fresh(owner);const first=other(owner),host=stage(s,owner,"PLAN","battle"),source=stage(s,owner,"TRUNKS","hand");
 stage(s,owner,"BABY","battle");stage(s,owner,"F","energy");stage(s,first,"TAX2","battle");
 assert.ok(moveCard(s,game,source,"battle",{owner,under:host}).ok);
 const [payer1,payer2]=s.sides[owner].zones.hand;
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 s=take(s,{type:"counter",player:owner,card:source});s=take(s,{type:"choose",player:owner,cards:[payer1]});
 assert.equal(s.prompt.kind,"chooseCards");const stamp=s.programs.find(f=>f.counterNonhandTax)!.counterNonhandTax!;
 assert.ok(Object.values(stamp.payers).some(p=>p.card===payer1&&!p.paid));
 if(fault==="selected-aba"){assert.ok(moveCard(s,game,payer1,"drop",{owner}).ok);assert.ok(moveCard(s,game,payer1,"hand",{owner}).ok);}
 if(fault==="missing-payer")for(const [key,payer] of Object.entries(stamp.payers))if(payer.card===payer1)delete stamp.payers[key];
 s=take(s,{type:"choose",player:owner,cards:[payer2]});
 assert.equal(s.sides[owner].zones.hand.includes(payer2),fault!=="none");
 assert.equal(history.filter(e=>e.type==="skill"&&e.card===source).length,fault==="none"?1:0);
 if(fault==="missing-payer")assert.match(JSON.stringify(s.outcome),/rebuild/);
 cases++;
}
for(const owner of ["p1","p2"] as const)for(const mode of ["decline","accept","selected-aba"] as const){
 history.length=0;let s=fresh(owner);const first=other(owner),host=stage(s,owner,"PLAN","battle"),source=stage(s,owner,"TRUNKS","hand");
 stage(s,owner,"BABY","battle");stage(s,owner,"F","energy");stage(s,first,"TAX2","battle");
 assert.ok(moveCard(s,game,source,"battle",{owner,under:host}).ok);
 const [payer1,payer2]=s.sides[owner].zones.hand;
 assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"replaceLeave",to:"drop",optional:true,until:"turn",target:{var:"payer"}}],ip:0,vars:{payer:[payer2]},card:s.sides[first].zones.leader[0],master:first}),"done");
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 s=take(s,{type:"counter",player:owner,card:source});s=take(s,{type:"choose",player:owner,cards:[payer1]});s=take(s,{type:"choose",player:owner,cards:[payer2]});
 assert.equal(s.prompt.kind,"replaceMove");if(s.prompt.kind!=="replaceMove")throw new Error("replacement");
 assert.ok(s.sides[owner].zones.warp.includes(payer1),"first original payment remains spent");
 const stamp=s.programs.find(f=>f.counterNonhandTax)!.counterNonhandTax!;
 assert.ok(Object.values(stamp.payers).some(p=>p.card===payer1&&p.paid));
 if(mode==="selected-aba"){assert.ok(moveCard(s,game,payer2,"drop",{owner}).ok);assert.ok(moveCard(s,game,payer2,"hand",{owner}).ok);}
 s=take(s,{type:"chooseMode",player:s.prompt.player,index:mode==="accept"?0:s.prompt.options.length-1});
 assert.ok(s.sides[owner].zones.warp.includes(payer1));
 assert.equal(history.filter(e=>e.type==="skill"&&e.card===source).length,mode==="decline"?1:0);
 if(mode==="decline")assert.ok(s.sides[owner].zones.warp.includes(payer2));
 if(mode==="accept")assert.ok(s.sides[owner].zones.drop.includes(payer2));
 if(mode==="selected-aba")assert.ok(s.sides[owner].zones.hand.includes(payer2));
 if(mode!=="decline")assert.ok(s.sides[owner].zones.drop.includes(source));
 cases++;
}
// The actual Bujin price creates the pool for a protocol-issued Drop tax.
// A competing Hand tax cannot reuse its single printed-discard payer.
for(const owner of ["p1","p2"] as const)for(const pool of ["drop","hand"] as const){
 history.length=0;let s=fresh(owner);const first=other(owner),source=stage(s,owner,"BUJIN","energy");
 const payer=s.sides[owner].zones.hand[0];for(const id of s.sides[owner].zones.hand.slice(1))assert.ok(moveCard(s,game,id,"deck",{owner}).ok);
 assert.equal(s.sides[owner].zones.drop.length,0);
 assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"forbid",what:"activateSkill",side:"opponent",until:"turn",unlessPay:[{op:"choose",sel:{side:"you",area:pool,count:1,upTo:false},as:"taxCard"},{op:"moveTo",target:{var:"taxCard"},to:"warp"}]}],ip:0,vars:{},card:s.sides[first].zones.leader[0],master:first}),"done");
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 assert.equal(RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===source),pool==="drop");
 if(pool==="drop"){
  s=take(s,{type:"counter",player:owner,card:source});
  if(s.prompt.kind==="chooseCards")s=take(s,{type:"choose",player:owner,cards:[payer]});
  if(s.prompt.kind==="chooseCards")s=take(s,{type:"choose",player:owner,cards:[payer]});
  s=finish(s);assert.ok(s.sides[owner].zones.warp.includes(payer));assert.ok(s.sides[owner].zones.battle.includes(source));
 }else {assert.equal(s.cards[source].mode,"active");assert.ok(s.sides[owner].zones.hand.includes(payer));}
 cases++;
}
console.log(`under-counter-native-5: ${cases} native cases passed`);
