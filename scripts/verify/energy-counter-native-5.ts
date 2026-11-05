import {buildSnapshot} from "../../src/lib/arena/snapshot";
import {stepScript} from "../../src/lib/arena/vm/script";
import {vmHost} from "../../src/lib/arena/vm/host";
/** R463 native energy Counter activation, payment and captured origin. */
import assert from "node:assert/strict";
import {card,fifty} from "./harness";
import {skillRecords} from "../../src/lib/arena/draft";
import {rulesFromRows,type RuleRow} from "../../src/lib/arena/rules-store";
import {RULES} from "../../src/lib/arena/vm";
import {stepCounterCost} from "../../src/lib/arena/vm/battle";
import {rulesetFor} from "../../src/lib/arena/rulesets";
import {moveCard} from "../../src/lib/arena/vm/zones";
import type {Action,GameEvent,PlayerId,EngineContext,CardDef} from "../../src/lib/arena/types";
import type {VmState} from "../../src/lib/arena/vm/state";
const defs:Record<string,CardDef>={L:card("L",{type:"LEADER",colors:["Blue"],traits:["Boujack Brigade","Red Ribbon Army"]}),F:card("F",{colors:["Blue"]}),SOURCE:card("SOURCE",{skill:"[Activate: Main] Choose up to 1 Battle Card from your hand and play it."})};
defs["BT13-055"]=card("BT13-055",{"type": "BATTLE", "name": "Bujin, the Commando", "colors": ["Blue"], "characters": ["Bujin"], "traits": ["Boujack Brigade"], "skill": "[Counter: Attack] If your Leader Card is a ≪Boujack Brigade≫ card: Negate the attack and play this card. If you activated this card's [Counter: Attack] skill from your energy, place the top card of your deck in your energy in Rest Mode.<br>[Permanent] You can activate this card's [Counter] skill from your energy by paying its energy cost and choosing 1 card in your hand and discarding it.", "energyCost": 1, "specifiedCost": {"Blue": 1}});
defs["BT17-050"]=card("BT17-050",{"type": "BATTLE", "name": "Android 19, Energy Absorber", "colors": ["Blue"], "characters": ["Android 19"], "traits": ["Android", "Red Ribbon Army"], "skill": "[Counter: Attack] Negate the attack and play this card.\r\n[Permanent] If your Leader Card is a blue ≪Red Ribbon Army≫ card, you can activate this card's [Counter] skill from your energy by paying its energy cost and discarding 1 card from your hand.", "energyCost": 1, "specifiedCost": {"Blue": 1}});
defs["BT17-055"]=card("BT17-055",{"type": "BATTLE", "name": "Android 15, Inorganic Horror", "colors": ["Blue"], "characters": ["Android 15"], "traits": ["Android", "Red Ribbon Army"], "skill": "[Deflect]\r\n[Counter: Play] Play this card, and if the Battle Card being played has an energy cost of 3 or less, return it to its owner's hand instead.\r\n[Permanent] If your Leader Card is a blue ≪Red Ribbon Army≫ card, you can activate this card's [Counter] skill from your energy by paying its energy cost.\r\n[Permanent][Bond 3] Blue ≪Android≫: This card gets +10000 power.", "energyCost": 2, "specifiedCost": {"Blue": 1}});
defs["EX13-23"]=card("EX13-23",{"type": "BATTLE", "name": "Great Ape Bardock, Might of the Resistance", "colors": ["Yellow"], "characters": ["Bardock: Xeno"], "traits": ["Saiyan", "Great Ape"], "skill": "[Unique][Critical][Blocker]<br>[Permanent] You can only play mono-yellow ≪Saiyan≫ cards.<br>[Auto] If your Leader Card is yellow: At the end of a battle where this card is used in a combo from your hand, play this card.", "energyCost": 4, "specifiedCost": {"Yellow": 1}});
defs.GENERIC=card("GENERIC",{colors:["Blue"],skill:"[Counter: Attack] Negate the attack. Choose up to 1 blue Battle Card from your Drop Area and play it."});
defs.ANSWER=card("ANSWER",{type:"EXTRA",energyCost:0,skill:"[Counter: Counter] Negate the [Counter]."});
defs.TAX=card("TAX",{skill:"[Permanent] Your opponent can’t activate skills unless they send 1 card from their hand to their Warp each time."});
defs.MOVEAUTO=card("MOVEAUTO",{skill:"[Auto] When a card in your energy is placed in your Drop Area, draw 1 card."});
defs.PLAYAUTO=card("PLAYAUTO",{skill:"[Auto] When this card is played, draw 1 card."});
defs.ENERGY2=card("ENERGY2",{colors:["Blue","Green"]});
defs.WRONG=card("WRONG",{type:"LEADER",colors:["Red"]});
const rows=Object.values(defs).flatMap(skillRecords).map((r,id)=>({...r,id,status:"confirmed",source:"compiler"}) as unknown as RuleRow);
const ctx:EngineContext={defs,scripts:rulesFromRows(rows,defs)},loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const snapshot=(s:VmState,viewer:PlayerId)=>buildSnapshot({id:463,revision:1,mode:"versus",status:"playing",p1Name:"One",p2Name:"Two",ctx,state:s,legal:[],log:[],beats:null,spotlight:null,spend:{calls:0,input:0,output:0,cached:0,micros:0},ai:null,viewer,images:{}});
const history:GameEvent[]=[];
const take=(s:VmState,a:Action)=>{const r=RULES.apply(ctx,copy(s),a);history.push(...r.events);return r.state as VmState;};
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
function fresh(owner:PlayerId){const first=other(owner);let s=RULES.createGame(ctx,{seed:463,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:owner,redraw:false},{type:"charge",player:first,card:null},{type:"endMain",player:first},{type:"charge",player:owner,card:null},{type:"endMain",player:owner},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);s.sides[owner].attrs.energyMarkers=0;return s;}
function stage(s:VmState,p:PlayerId,def:string,area:string){const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);return id;}
function finish(s:VmState){for(let n=0;n<50&&s.prompt.kind!=="main";n++){assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));const p=s.prompt;if(p.kind==="chooseCards")s=take(s,{type:"choose",player:p.player,cards:p.choice.candidates.slice(0,p.choice.min)});else {const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="payCost")??RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="counter"&&a.card===null)??RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="orderPending");assert.ok(a,JSON.stringify(p));s=take(s,a);}}assert.equal(s.prompt.kind,"main");return s;}
let cases=0;
for(const owner of ["p1","p2"] as const)for(const id of ["BT13-055","BT17-050"])for(const from of ["energy","hand"] as const)for(const blocked of [false,true]){
history.length=0;let s=fresh(owner);const first=other(owner),source=stage(s,owner,id,from);if(from==="hand")stage(s,owner,"F","energy");if(blocked)stage(s,owner,"EX13-23","battle");const payer=s.sides[owner].zones.hand.find(c=>c!==source)!;const energyBefore=s.sides[owner].zones.energy.length,top=s.sides[owner].zones.deck[0];
s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});assert.ok(RULES.legalActions(ctx,s).some(l=>l.action.type==="counter"&&l.action.card===source),id+" "+from);
s=take(s,{type:"counter",player:owner,card:source});if(from==="energy"){assert.equal(s.prompt.kind,"chooseCards");assert.ok(s.sides[owner].zones.energy.includes(source));assert.equal(s.cards[source].mode,"rest","the source itself pays normal energy");s=take(s,{type:"choose",player:owner,cards:[payer]});}
s=finish(s);assert.ok(s.sides[owner].zones[blocked?"drop":"battle"].includes(source));if(from==="energy")assert.ok(s.sides[owner].zones.drop.includes(payer));
const refilled=id==="BT13-055"&&from==="energy";assert.equal(s.sides[owner].zones.energy.length,energyBefore-(from==="energy"?1:0)+(refilled?1:0));if(refilled){assert.ok(s.sides[owner].zones.energy.includes(top));assert.equal(s.cards[top].mode,"rest");}assert.equal(history.filter(e=>e.type==="skill"&&e.card===source&&e.skill===0).length,1);cases++;
}
for(const owner of ["p1","p2"] as const)for(const timing of ["before","after","declared"] as const){
 history.length=0;let s=fresh(owner);const first=other(owner),counter=stage(s,owner,"BT17-055","energy");stage(s,owner,"F","energy");const target=stage(s,first,"F","hand");
 if(timing==="declared"){stage(s,first,"F","energy");s=take(s,{type:"play",player:first,card:target});}
 else{const source=stage(s,first,"SOURCE","battle");s=take(s,{type:"activate",player:first,card:source,skill:0});
 if(timing==="after"){assert.equal(s.prompt.kind,"counter");s=take(s,{type:"counter",player:owner,card:null});assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:first,cards:[target]});assert.equal(s.resolving?.scopeWindow?.boundary,"after");}}
 assert.ok(RULES.legalActions(ctx,s).some(l=>l.action.type==="counter"&&l.action.card===counter));s=take(s,{type:"counter",player:owner,card:counter});
 if(timing==="before"){assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:first,cards:[target]});}
 s=finish(s);assert.ok(s.sides[owner].zones.battle.includes(counter));assert.ok(s.sides[first].zones[timing==="after"?"battle":"hand"].includes(target));assert.equal(s.sides[owner].zones.energy.length,1);cases++;
}
for(const owner of ["p1","p2"] as const)for(const id of ["BT13-055","BT17-050","BT17-055"])for(const mode of ["leader","energy","hand","negated","area"] as const){
 let s=fresh(owner);const first=other(owner),source=stage(s,owner,id,mode==="area"?"drop":"energy");if(id==="BT17-055")stage(s,owner,"F","energy");
 if(mode==="leader")s.cards[s.sides[owner].zones.leader[0]].cardId="WRONG";
 if(mode==="energy")for(const card of s.sides[owner].zones.energy)s.cards[card].mode="rest";
 if(mode==="hand")for(const card of [...s.sides[owner].zones.hand])assert.ok(moveCard(s,game,card,"deck",{owner}).ok);
 if(mode==="negated")assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"negateSkillsOfKind",kind:"permanent",target:{var:"source"},until:"turn"}],ip:0,vars:{source:[source]},card:s.sides[first].zones.leader[0],master:first}),"done");
 if(id==="BT17-055"){const trigger=stage(s,first,"SOURCE","battle");stage(s,first,"F","hand");s=take(s,{type:"activate",player:first,card:trigger,skill:0});}
 else s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 const offered=RULES.legalActions(ctx,s).some(l=>l.action.type==="counter"&&l.action.card===source);assert.equal(offered,mode==="hand"&&id==="BT17-055",`${id} ${mode}`);cases++;
}
for(const owner of ["p1","p2"] as const)for(const id of ["BT13-055","BT17-050"])for(const fault of ["prompt-aba","prompt-missing","prompt-malformed","price-aba","price-missing-origin","price-missing-declaration","price-wrong-skill","price-missing-script"] as const){
 history.length=0;let s=fresh(owner);const first=other(owner),source=stage(s,owner,id,"energy"),payer=s.sides[owner].zones.hand[0];
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});assert.equal(s.prompt.kind,"counter");if(s.prompt.kind!=="counter")throw new Error("counter");
 if(fault.startsWith("prompt")){
  if(fault==="prompt-aba"){assert.ok(moveCard(s,game,source,"hand",{owner}).ok);assert.ok(moveCard(s,game,source,"energy",{owner}).ok);}else if(fault==="prompt-missing")delete s.prompt.energyOccurrences;else s.prompt.energyOccurrences!.version=0 as 1;
  const legal=RULES.legalActions(ctx,s),rejected=RULES.rejectedActions(ctx,s,legal);assert.ok(!legal.some(l=>l.action.type==="counter"&&l.action.card===source));assert.equal(RULES.abilityAvailability(ctx,s,owner,legal,rejected).find(r=>r.card===source&&r.skill===0)?.state,"refused");assert.throws(()=>take(s,{type:"counter",player:owner,card:source}),/energy Counter/);cases++;continue;
 }
 s=take(s,{type:"counter",player:owner,card:source});assert.equal(s.prompt.kind,"chooseCards");const frame=s.programs.find(f=>f.counterCost)!;
 // Explicit saved-state fault controls; there is no native interleaving in payment.
 if(fault==="price-aba"){assert.ok(moveCard(s,game,source,"hand",{owner}).ok);assert.ok(moveCard(s,game,source,"energy",{owner}).ok);}
 if(fault==="price-missing-origin")delete frame.counterCost!.energyOrigin;
 if(fault==="price-missing-declaration")delete frame.counterActivation;
 if(fault==="price-wrong-skill")frame.counterActivation!.skillIndex=999;
 if(fault==="price-missing-script")delete frame.counterDeclaredScript;
 s=take(s,{type:"choose",player:owner,cards:[payer]});assert.ok(s.sides[owner].zones.hand.includes(payer));assert.ok(s.sides[owner].zones.energy.includes(source));assert.equal(history.filter(e=>e.type==="skill"&&e.card===source&&e.skill===0).length,0);if(fault!=="price-aba")assert.match(JSON.stringify(s.outcome),/rebuild/);cases++;
}
// An independently selected Drop card is a fresh target, even if it has the same physical ID.
for(const owner of ["p1","p2"] as const){
 let s=fresh(owner);const first=other(owner),source=stage(s,owner,"GENERIC","hand");stage(s,owner,"F","energy");stage(s,first,"ANSWER","hand");
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});s=take(s,{type:"counter",player:owner,card:source});assert.equal(s.prompt.kind,"counter");
 assert.ok(moveCard(s,game,source,"warp",{owner}).ok);assert.ok(moveCard(s,game,source,"drop",{owner}).ok);s=take(s,{type:"counter",player:first,card:null});assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:owner,cards:[source]});s=finish(s);assert.ok(s.sides[owner].zones.battle.includes(source));cases++;
}
for(const owner of ["p1","p2"] as const)for(const fault of ["decline","negate","effect-origin","effect-admission","source-aba"] as const){
 history.length=0;let s=fresh(owner);const first=other(owner),source=stage(s,owner,"BT13-055","energy"),payer=s.sides[owner].zones.hand[0],response=stage(s,first,"ANSWER","hand"),top=s.sides[owner].zones.deck[0];
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});s=take(s,{type:"counter",player:owner,card:source});s=take(s,{type:"choose",player:owner,cards:[payer]});assert.equal(s.prompt.kind,"counter");assert.equal(s.prompt.player,first);assert.ok(s.sides[owner].zones.drop.includes(source));
 if(fault==="effect-origin")delete [...s.programs,...(s.skillPlayScopes??[]).flatMap(scope=>scope.window?.programs??[])].find(f=>f.card===source&&f.skillKind==="counter")!.counterActivation;
 if(fault==="effect-admission")delete [...s.programs,...(s.skillPlayScopes??[]).flatMap(scope=>scope.window?.programs??[])].find(f=>f.card===source&&f.skillKind==="counter")!.counterAdmission;
 // A saved-state fault after activation, not an invented interrupt in payment.
 if(fault==="source-aba"){assert.ok(moveCard(s,game,source,"warp",{owner}).ok);assert.ok(moveCard(s,game,source,"drop",{owner}).ok);}
 s=take(s,{type:"counter",player:first,card:fault==="negate"?response:null});
 if(fault==="effect-admission"){assert.match(JSON.stringify(s.outcome),/rebuild.*admission/);cases++;continue;}
 if(fault==="effect-origin"){assert.match(JSON.stringify(s.outcome),/rebuild.*Counter activation origin/);cases++;continue;}
 if(fault==="negate"){assert.ok(s.sides[owner].zones.drop.includes(source));assert.ok(!s.sides[owner].zones.energy.includes(top));assert.equal(history.filter(e=>e.type==="skill"&&e.card===source&&e.skill===0).length,1);cases++;continue;}
 s=finish(s);assert.ok(s.sides[owner].zones[fault==="source-aba"?"drop":"battle"].includes(source),fault+" must not play a fresh source occurrence");assert.ok(s.sides[owner].zones.energy.includes(top),"captured-origin independent refill survives failed self-play");cases++;
}
// Native activation-tax choices; the ABA mutations below are saved-state fault controls.
for(const owner of ["p1","p2"] as const)for(const id of ["BT13-055","BT17-050","BT17-055"])for(const fault of ["none","aba","missing-child","malformed-child","missing-parent-origin","missing-all-origin","missing-gate-epoch","missing-gate-from","malformed-gate-from","missing-gate-counter","missing-gate","child-cost","child-gate"] as const){
 history.length=0;let s=fresh(owner);const first=other(owner),source=stage(s,owner,id,"energy");
 stage(s,first,"TAX","battle");if(id==="BT17-055")stage(s,owner,"F","energy");
 if(id==="BT17-055"){const trigger=stage(s,first,"SOURCE","battle");stage(s,first,"F","hand");s=take(s,{type:"activate",player:first,card:trigger,skill:0});}
 else s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 assert.ok(RULES.legalActions(ctx,s).some(l=>l.action.type==="counter"&&l.action.card===source));
 s=take(s,{type:"counter",player:owner,card:source});
 if(id!=="BT17-055"){assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:owner,cards:[s.sides[owner].zones.hand[0]]});}
 assert.equal(s.prompt.kind,"chooseCards");assert.ok(s.programs.some(f=>f.taxGate?.from==="energy"));
 const payer=s.sides[owner].zones.hand[0];
 const child=s.programs.find(f=>f.counterNonhandTax)!,parent=s.programs.find(f=>f.counterCost)!;
 assert.ok(child);assert.ok(parent);
 if(fault==="child-cost")child.counterCost=structuredClone(parent.counterCost);
 if(fault==="child-gate")child.taxGate=structuredClone(s.programs.find(f=>f.taxGate)!.taxGate);
 if(fault==="missing-child")delete child.counterNonhandTax;
 if(fault==="malformed-child")child.counterNonhandTax!.version=0 as 1;
 if(fault==="missing-parent-origin"||fault==="missing-all-origin")delete parent.counterCost!.energyOrigin;
 if(fault==="missing-all-origin"){delete parent.counterActivation;delete child.counterNonhandTax;}
 if(fault==="missing-gate-epoch")delete s.programs.find(f=>f.taxGate)!.taxGate!.counterEnergyEpoch;
 if(fault.startsWith("missing-gate")||fault==="malformed-gate-from"){
  const gateFrame=s.programs.find(f=>f.taxGate)!;
  delete child.counterNonhandTax;
  if(fault==="missing-gate-from")delete gateFrame.taxGate!.from;
  if(fault==="malformed-gate-from")gateFrame.taxGate!.from="hand";
  if(fault==="missing-gate-counter")delete gateFrame.taxGate!.counter;
  if(fault==="missing-gate")delete gateFrame.taxGate;
 }

 if(fault==="aba"){assert.ok(moveCard(s,game,source,"hand",{owner}).ok);assert.ok(moveCard(s,game,source,"energy",{owner}).ok);}
 s=take(s,{type:"choose",player:owner,cards:[payer]});
 assert.equal(s.sides[owner].zones.hand.includes(payer),fault!=="none","stale activation source must not spend a tax payer");
 if(fault!=="none"){if(fault!=="aba")assert.match(JSON.stringify(s.outcome),/rebuild/);assert.ok(s.sides[owner].zones.energy.includes(source));assert.equal(history.filter(e=>e.type==="skill"&&e.card===source).length,0);}
 else {assert.ok(s.sides[owner].zones.warp.includes(payer));assert.equal(history.filter(e=>e.type==="skill"&&e.card===source).length,1,JSON.stringify({id,fault,prompt:s.prompt,outcome:s.outcome,notes:history.filter(e=>e.type==="note"||e.type==="skill")}));}
 cases++;
}
// R463 staging must end modifiers belonging to the old energy occurrence.
for(const owner of ["p1","p2"] as const)for(const id of ["BT13-055","BT17-050","BT17-055"]){
 let s=fresh(owner);const first=other(owner),source=stage(s,owner,id,"energy");
 stage(s,first,"ANSWER","hand");if(id==="BT17-055")stage(s,owner,"F","energy");
 assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"power",target:{var:"source"},amount:5000,until:"turn"}],ip:0,vars:{source:[source]},card:source,master:owner}),"done");
 assert.ok(s.effects.some(e=>e.target===source&&e.kind==="power"));
 if(id==="BT17-055"){const trigger=stage(s,first,"SOURCE","battle");stage(s,first,"F","hand");s=take(s,{type:"activate",player:first,card:trigger,skill:0});}
 else s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 s=take(s,{type:"counter",player:owner,card:source});
 if(id!=="BT17-055")s=take(s,{type:"choose",player:owner,cards:[s.sides[owner].zones.hand[0]]});
 assert.equal(s.prompt.kind,"counter");assert.ok(s.sides[owner].zones.drop.includes(source));
 assert.ok(!s.effects.some(e=>e.target===source&&e.kind==="power"),"energy modifiers end before the Counter response window");cases++;
}
// Copied Counter identity is captured before Energy-to-Drop clears the copy.
for(const owner of ["p1","p2"] as const){
 let s=fresh(owner);const first=other(owner),source=stage(s,owner,"BT17-055","energy"),donor=stage(s,owner,"BT13-055","battle");
 stage(s,first,"ANSWER","hand");stage(s,owner,"F","energy");const top=s.sides[owner].zones.deck[0];
 assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"copySkills",target:{var:"target"},from:{var:"donor"},skill:0,until:"turn"}],ip:0,vars:{target:[source],donor:[donor]},card:donor,master:owner}),"done");
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 const action=RULES.legalActions(ctx,s).map(l=>l.action).find(a=>a.type==="counter"&&a.card===source);
 assert.ok(action,JSON.stringify({offered:RULES.legalActions(ctx,s),effects:s.effects.filter(e=>e.target===source)}));s=take(s,action);
 assert.equal(s.prompt.kind,"counter");assert.ok(!s.effects.some(e=>e.target===source&&e.kind==="copiedSkills"));
 s=take(s,{type:"counter",player:first,card:null});s=finish(s);
 assert.ok(s.sides[owner].zones.battle.includes(source));assert.ok(s.sides[owner].zones.energy.includes(top));cases++;
}
// A typed movement Auto whose original program cannot yet be retained is an explicit pre-payment gap.
for(const owner of ["p1","p2"] as const)for(const donorId of ["MOVEAUTO","PLAYAUTO"]){
 let s=fresh(owner);const first=other(owner),source=stage(s,owner,"BT13-055","energy"),donor=stage(s,owner,donorId,"battle");
 stage(s,owner,"GENERIC","hand"); // Keep a real Counter decision open when this Energy route is refused.
 assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"copySkills",target:{var:"target"},from:{var:"donor"},skill:0,until:"turn"}],ip:0,vars:{target:[source],donor:[donor]},card:donor,master:owner}),"done");
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 const offered=RULES.legalActions(ctx,s).some(l=>l.action.type==="counter"&&l.action.card===source);
 assert.equal(offered,donorId==="PLAYAUTO",donorId+" movement capability is bounded");
 if(donorId==="MOVEAUTO"){
  const legal=RULES.legalActions(ctx,s),rejected=RULES.rejectedActions(ctx,s,legal);
  const availability=RULES.abilityAvailability(ctx,s,owner,legal,rejected).find(row=>row.card===source&&row.skill===0);
  assert.match(JSON.stringify(availability),/original energy-movement Auto/);
 }
 assert.equal(s.cards[source].mode,"active");cases++;
}
// Tax becomes unaffordable after the already-declared Counter pays its printed discard.
for(const owner of ["p1","p2"] as const)for(const id of ["BT13-055","BT17-050"]){
 history.length=0;let s=fresh(owner);const first=other(owner),source=stage(s,owner,id,"energy");stage(s,first,"TAX","battle");
 assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"power",target:{var:"source"},amount:5000,until:"turn"}],ip:0,vars:{source:[source]},card:source,master:owner}),"done");
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});s=take(s,{type:"counter",player:owner,card:source});
 assert.equal(s.prompt.kind,"chooseCards");const payer=s.sides[owner].zones.hand[0];
 // Saved-state fault at the price chooser, not an invented native interruption.
 for(const id of [...s.sides[owner].zones.hand])if(id!==payer)assert.ok(moveCard(s,game,id,"deck",{owner}).ok);
 s=take(s,{type:"choose",player:owner,cards:[payer]});
 assert.ok(s.sides[owner].zones.drop.includes(source));assert.ok(!s.effects.some(e=>e.target===source));
 assert.equal(history.filter(e=>e.type==="skill"&&e.card===source).length,0);cases++;
}
// Native normal-energy choice, persisted route witness and both viewer projections.
for(const owner of ["p1","p2"] as const)for(const fault of ["none","aba","missing"] as const){
 let s=fresh(owner);const first=other(owner),source=stage(s,owner,"BT13-055","energy"),otherEnergy=stage(s,owner,"ENERGY2","energy");
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 assert.equal(s.prompt.kind,"counter");
 for(const viewer of [owner,first])assert.ok(!JSON.stringify(snapshot(s,viewer)).includes("energyOccurrences"));
 s=take(s,{type:"counter",player:owner,card:source});assert.equal(s.prompt.kind,"payCost");
 if(s.prompt.kind!=="payCost")throw new Error("energy choice");assert.ok(s.prompt.energyOccurrences);
 const payment=RULES.legalActions(ctx,s).map(l=>l.action).find(a=>a.type==="payCost");assert.ok(payment);
 for(const viewer of [owner,first])assert.ok(!JSON.stringify(snapshot(s,viewer)).includes("energyOccurrences"));
 if(fault==="aba"){
  assert.ok(moveCard(s,game,source,"hand",{owner}).ok);
  assert.ok(!JSON.stringify(snapshot(s,first)).includes(JSON.stringify(source)),"private fresh source is not exposed by stale prompt map");
  assert.ok(moveCard(s,game,source,"energy",{owner}).ok);
 } else if(fault==="missing")delete s.prompt.energyOccurrences;
 if(fault!=="none"){assert.throws(()=>take(s,payment),/energy Counter/);assert.equal(s.cards[source].mode,"active");assert.equal(s.cards[otherEnergy].mode,"active");}
 else {s=take(s,payment);assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:owner,cards:[s.sides[owner].zones.hand[0]]});s=finish(s);assert.ok(s.sides[owner].zones.battle.includes(source));}
 cases++;
}
// Permission/admission gates are checked at declaration, not again after payment.
for(const owner of ["p1","p2"] as const)for(const id of ["BT13-055","BT17-050"])for(const change of ["leader","permission"] as const){
 let s=fresh(owner);const first=other(owner),source=stage(s,owner,id,"energy");stage(s,first,"TAX","battle");
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});s=take(s,{type:"counter",player:owner,card:source});
 s=take(s,{type:"choose",player:owner,cards:[s.sides[owner].zones.hand[0]]});assert.equal(s.prompt.kind,"chooseCards");
 // Saved-state fault at the later tax chooser, after printed payment was completed.
 if(change==="leader")s.cards[s.sides[owner].zones.leader[0]].cardId="WRONG";
 else assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"negateSkillsOfKind",kind:"permanent",target:{var:"source"},until:"turn"}],ip:0,vars:{source:[source]},card:s.sides[first].zones.leader[0],master:first}),"done");
 s=take(s,{type:"choose",player:owner,cards:[s.sides[owner].zones.hand[0]]});s=finish(s);
 assert.ok(s.sides[owner].zones.battle.includes(source),id+" paid declaration gate must not become a resolution condition");cases++;
}
for(const owner of ["p1","p2"] as const)for(const from of ["hand","energy"] as const)for(const wrongAtDeclaration of [false,true]){
 let s=fresh(owner);const first=other(owner),source=stage(s,owner,"BT13-055",from);if(from==="hand")stage(s,owner,"F","energy");stage(s,first,"TAX","battle");
 if(wrongAtDeclaration)s.cards[s.sides[owner].zones.leader[0]].cardId="WRONG";
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 if(wrongAtDeclaration){assert.ok(!RULES.legalActions(ctx,s).some(l=>l.action.type==="counter"&&l.action.card===source));cases++;continue;}
 s=take(s,{type:"counter",player:owner,card:source});
 if(from==="energy")s=take(s,{type:"choose",player:owner,cards:[s.sides[owner].zones.hand[0]]});
 assert.equal(s.prompt.kind,"chooseCards");s.cards[s.sides[owner].zones.leader[0]].cardId="WRONG";
 s=take(s,{type:"choose",player:owner,cards:[s.sides[owner].zones.hand.find(id=>id!==source)!]});s=finish(s);assert.ok(s.sides[owner].zones.battle.includes(source));cases++;
}
// Native payment procedure fault control, matching #716's failed-declaration boundary.
for(const owner of ["p1","p2"] as const)for(const id of ["BT13-055","BT17-050"]){
 let s=fresh(owner);const first=other(owner),source=stage(s,owner,id,"energy");
 assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"power",target:{var:"source"},amount:5000,until:"turn"}],ip:0,vars:{source:[source]},card:source,master:owner}),"done");
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});s=take(s,{type:"counter",player:owner,card:source});assert.equal(s.prompt.kind,"chooseCards");
 const frame=s.programs.shift()!;assert.ok(frame.counterCost);delete frame.awaiting;
 for(const payer of [...s.sides[owner].zones.hand])assert.ok(moveCard(s,game,payer,"deck",{owner}).ok);
 const ev:GameEvent[]=[];assert.equal(stepCounterCost(ctx,game,s,ev,frame),"done");
 assert.ok(s.sides[owner].zones.drop.includes(source));assert.ok(!s.effects.some(e=>e.target===source));assert.equal(ev.filter(e=>e.type==="skill"&&e.card===source).length,0);cases++;
}
console.log(`energy-counter-native-5: ${cases} native cases passed`);
