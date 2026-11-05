import { fire } from "../../src/lib/arena/vm/events";
import { isExtraCardActivation } from "../../src/lib/arena/vm/extra-activation";
/** R460: native Extra self-activation regressions. */
import assert from "node:assert/strict";
import {card,fifty} from "./harness";
import {skillRecords} from "../../src/lib/arena/draft";
import {recordContractGaps,rulesFromRows,type RuleRow} from "../../src/lib/arena/rules-store";
import {RULES} from "../../src/lib/arena/vm";
import {rulesetFor} from "../../src/lib/arena/rulesets";
import {moveCard} from "../../src/lib/arena/vm/zones";
import type {Action,CardDef,EngineContext,PlayerId} from "../../src/lib/arena/types";
import type {VmState} from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const defs:Record<string,CardDef>={F:card("F",{}),L:card("L",{type:"LEADER"}),ENERGY:card("ENERGY",{colors:["Red"]})};
defs["BT7-024"]=card("BT7-024",{name:"The Final Guardian",type:"EXTRA",colors:["Red"],energyCost:1,skill:"[Counter: Attack] If your Leader Card is red: Negate the attack, then choose up to 1 of your Battle Cards and it gets +5000 power for the duration of the turn.\n[Permanent] If this card is in your Drop Area, you can activate it by paying its energy cost and removing it and 1 red card in your hand from the game.\n[Auto] When you activate this card, you can't activate {The Final Guardian} for the duration of the turn."});
defs["BT11-057"]=card("BT11-057",{"name": "Super Blutz Wave Generator", "type": "EXTRA", "colors": ["Blue"], "power": null, "characters": [], "traits": [], "skill": "[Field]<br>[Auto] When you activate this card, draw 1 card.<br>[Activate: Main][Once per turn] If your Leader Card is a blue &lt;Vegeta: GT&gt;-only card on its front side: Place the top card of your deck under your Leader Card, and if there are 4 or more cards under it, place all of those cards in their owners' Drop Areas, add up to 2 cards from your life to your hand, then place up to 2 cards from your life in your Drop Area.", "energyCost": 1});
defs["BT10-058"]=card("BT10-058",{"name": "Tragedy Overground", "type": "EXTRA", "colors": ["Blue"], "power": null, "characters": [], "traits": [], "skill": "[Field]<br>[Permanent] This card can't be removed from your Battle Area by the skills of your opponent's Battle Cards.<br>[Permanent] When your opponent plays a Battle Card with an energy cost of 4 or more, it is placed it in its owner's energy in Rest Mode instead. <br>[Auto] When this card is activated, choose all of your opponent's Battle Cards, ignoring [Barrier], and place them in their owners' energy in Rest Mode.", "energyCost": 9});
defs["SD7-01"]=card("SD7-01",{"name": "Dragon Ball", "type": "LEADER", "colors": ["Black"], "power": 10000, "characters": ["Dragon Ball"], "traits": ["Shenron"], "skill": "[Permanent] This card can't attack.<br>[Activate: Main] Switch this card to Rest Mode: Choose up to 2 [Dragon Ball] cards from your deck or life and add them to your hand. Then shuffle any areas you looked through.<br>[Wish] When there are 7 [Dragon Ball] cards in your Drop Area: Choose up to 1 \u226aDesire\u226b card in your Drop Area, add it to your hand, and flip this card over.", "energyCost": null, "back": {"name": "Miraculous Arrival Shenron", "power": 10000, "skill": "[Permanent] This card can't attack.<br>[Activate: Main][Once per turn] Choose one \u2014<br>\u30fbDraw 1 card. <br>\u30fbChoose 1 \u226aDesire\u226b card in your hand with an energy cost less than or equal to your current energy and activate its [Activate: Main] skill.<br>\u30fbRemove 7 [Dragon Ball] cards in your Drop Area from the game. If you do, choose 1 of your Battle Cards and it gets +10000 power and [Triple Attack] for the duration of the turn, then flip this card over at the end of the turn."}});
defs["BT10-092"]=card("BT10-092",{"name": "Gotenks", "type": "LEADER", "colors": ["Yellow"], "power": 10000, "characters": ["Gotenks: Adolescence"], "traits": ["Saiyan", "Earthling"], "skill": "[Auto] When this card attacks, add up to 1 card from your life to your hand, then draw 1 card.<br>[Auto][Once per turn] If your opponent has 1 or more energy: When your opponent activates an Extra Card, draw 1 card.<br>[Awaken] When your life is at 4 or less: You may switch up to 2 of your energy to Active Mode and flip this card over.", "energyCost": null, "back": {"name": "SS Gotenks, Display of Mastery", "power": 10000, "skill": "[Auto] When this card attacks, draw 1 card.<br>[Auto][Once per turn] When your opponent activates an Extra Card, draw 1 card, then choose up to 1 of your opponent's Battle Cards and switch it to Rest Mode.<br>[Auto][Once per turn] When you activate [Union-Fusion], this card gets +5000 power and [Critical] for the turn."}});
defs["BT9-109"]=card("BT9-109",{"name": "Emperor's Death Beam", "type": "EXTRA", "colors": ["Red", "Blue"], "power": null, "characters": [], "traits": [], "skill": "[Energy-Exhaust]<br>[Activate: Main/Battle] Choose up to 1 of your opponent's Battle Cards, ignoring [Barrier], and it gets -30000 power for the duration of the turn.<br>[Activate: Main] Send this card from your Drop Area to your Warp: Look at the top card of your deck; if it's a multicolor Extra Card, you may add it to your hand; otherwise, place it on top of your deck.", "energyCost": 3});
defs.OMNI=card("OMNI",{colors:["Red","Blue","Green","Yellow","Black","White"]});
defs.EXTRA=card("EXTRA",{type:"EXTRA",colors:["Blue"],traits:["Desire"],energyCost:1,skill:"[Auto] When you activate this card, draw 1 card. [Activate: Main/Battle] Draw 1 card."});
defs.DESIRE=card("DESIRE",{type:"EXTRA",colors:["Blue"],traits:["Desire"],energyCost:1,skill:"[Auto] When you activate this card, draw 1 card. [Activate: Main] Draw 1 card."});
defs.WATCH=card("WATCH",{skill:"[Auto] When you activate a blue Extra Card from your hand, draw 1 card."});
defs.BATTLEAUTO=card("BATTLEAUTO",{skill:"[Auto] When this card is played, draw 1 card."});
defs.BROAD=card("BROAD",{skill:"[Auto] When you activate a blue Extra Card, draw 1 card."});
defs.DROPSELF=card("DROPSELF",{type:"EXTRA",colors:["Blue"],skill:"[Auto] When you activate this card, draw 3 cards. [Activate: Main] Send this card from your Drop Area to your Warp: Draw 1 card."});
defs.ALT=card("ALT",{type:"EXTRA",colors:["Blue"],energyCost:3,skill:"[Counter: Attack] Negate the attack.<br>[Permanent] You can activate this card's [Counter] skill from your hand without paying its energy cost by choosing 1 other black card in your hand and placing it in your Drop Area.<br>[Auto] When you activate this card, draw 1 card."});
defs.BLACK=card("BLACK",{colors:["Black"]});
defs.STRICT=card("STRICT",{type:"EXTRA",colors:["Blue"],energyCost:1,skill:"[Counter: Attack] Choose 1 card in your hand and place it in your Drop Area: Negate the attack.<br>[Auto] When you activate this card, draw 1 card."});
const rows=Object.values(defs).flatMap(skillRecords).map((r,id)=>({...r,id,source:"compiler",status:"confirmed"}) as unknown as RuleRow);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(rows),defs)};const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(ctx,copy(s),a).state as VmState;
function fresh(first:PlayerId,leader="L"){
 let s=RULES.createGame(ctx,{seed:430,p1:{name:"One",leader:first==="p1"?leader:"L",main:fifty("F")},p2:{name:"Two",leader:first==="p2"?leader:"L",main:fifty("F")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null},{type:"endMain",player:first},{type:"charge",player:other(first),card:null},{type:"endMain",player:other(first)},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);return s;
}
function stage(s:VmState,p:PlayerId,def:string,area:string){const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);return id;}
function answer(s:VmState,id:string|null){assert.equal(s.prompt.kind,"counter");return take(s,{type:"counter",player:s.prompt.player!,card:id});}
function finish(s:VmState,until:"main"|"combo"="main"):VmState{
 for(let n=0;n<50&&s.prompt.kind!==until;n++){
  assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));const p=s.prompt;
  if(p.kind==="chooseCards")s=take(s,{type:"choose",player:p.player,cards:p.choice.candidates.slice(0,p.choice.min??0)});
  else if(p.kind==="chooseMode")s=take(s,{type:"chooseMode",player:p.player,index:0});
  else {const actions=RULES.legalActions(ctx,s).map(x=>x.action),a=actions.find(a=>a.type==="payCost")??actions.find(a=>a.type==="counter"&&a.card===null)??actions.find(a=>a.type==="orderPending"&&a.index===0);assert.ok(a,JSON.stringify(p));s=take(s,a);}
 }assert.equal(s.prompt.kind,until);return s;
}
let cases=0;
for(const owner of ["p1","p2"] as const){
 let s=fresh(owner);const first=stage(s,other(owner),"BT7-024","hand"),second=stage(s,other(owner),"BT7-024","hand"),attacker=stage(s,owner,"F","battle");stage(s,other(owner),"ENERGY","energy");stage(s,other(owner),"ENERGY","energy");
 s=take(s,{type:"attack",player:owner,attacker:s.sides[owner].zones.leader[0],target:s.sides[other(owner)].zones.leader[0]});assert.equal(s.prompt.kind,"counter");s=answer(s,first);s=finish(s);
 s=take(s,{type:"attack",player:owner,attacker,target:s.sides[other(owner)].zones.leader[0]});assert.ok(!RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===second),"own activation Auto must lock a second copy this turn");cases++;
}
for(const owner of ["p1","p2"] as const)for(const kind of ["BT11-057","BT10-058","EXTRA","invoke"]){
 let s=fresh(owner);const extra=stage(s,owner,kind==="invoke"?"DESIRE":kind,"hand");for(let n=0;n<10;n++)stage(s,owner,"OMNI","energy");s.cards[s.sides[other(owner)].zones.leader[0]].cardId="BT10-092";
 const enemy=kind==="BT10-058"?stage(s,other(owner),"F","battle"):undefined;
 if(kind!=="BT10-058")stage(s,owner,"WATCH","battle");
 const mine=s.sides[owner].zones.hand.length,theirs=s.sides[other(owner)].zones.hand.length;
 if(kind==="invoke") {const leader=s.sides[owner].zones.leader[0];s.cards[leader].cardId="SD7-01";s.cards[leader].flipped=true;const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===leader);assert.ok(action);s=take(s,action);assert.ok(s.prompt.kind==="chooseMode");s=take(s,{type:"chooseMode",player:owner,index:1});if(s.prompt.kind==="chooseCards"){assert.ok(s.prompt.choice.candidates.includes(extra));s=take(s,{type:"choose",player:owner,cards:[extra]});}}
 else {const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===extra);assert.ok(action,kind);s=take(s,action);}
 s=finish(s);assert.equal(s.sides[other(owner)].zones.hand.length,theirs+1,kind+" opponent watcher");assert.equal(s.sides[owner].zones.hand.length,mine+(kind==="BT10-058"?-1:kind==="BT11-057"?1:2),kind+" own activation and hand watcher");
 if(enemy){assert.ok(s.sides[other(owner)].zones.energy.includes(enemy));assert.equal(s.cards[enemy].mode,"rest");}if(kind.startsWith("BT"))assert.ok(s.sides[owner].zones.battle.includes(extra));else assert.ok(s.sides[owner].zones.drop.includes(extra));cases++;
}
for(const owner of ["p1","p2"] as const)for(const mode of ["battle","drop","played"]){
 let s=fresh(owner);const id=stage(s,owner,mode==="drop"?"BT9-109":mode==="played"?"BATTLEAUTO":"EXTRA",mode==="drop"?"drop":"hand");stage(s,owner,"WATCH","battle");for(let n=0;n<3;n++)stage(s,owner,"OMNI","energy");s.cards[s.sides[other(owner)].zones.leader[0]].cardId="BT10-092";
 const mine=s.sides[owner].zones.hand.length,theirs=s.sides[other(owner)].zones.hand.length;
 if(mode==="battle"){s=take(s,{type:"attack",player:owner,attacker:s.sides[owner].zones.leader[0],target:s.sides[other(owner)].zones.leader[0]});assert.equal(s.prompt.kind,"combo");}
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>(mode==="played"?a.type==="play":a.type==="activate")&&"card"in a&&a.card===id);assert.ok(action,mode);s=take(s,action);s=finish(s,mode==="battle"?"combo":"main");
 assert.equal(s.sides[other(owner)].zones.hand.length,theirs+(mode==="battle"?1:0),mode+" watcher");assert.equal(s.sides[owner].zones.hand.length,mine+(mode==="battle"?2:0),mode+" own cards");if(mode==="drop")assert.ok(s.sides[owner].zones.warp.includes(id));cases++;
}
for(const status of ["draft","confirmed","corrected","missing"] as const){
 const row=rows.find(r=>r.cardId==="BT7-024"&&r.skillIndex===20)!;const stale={...row,status:status==="missing"?"confirmed":status,trigger:["played"]};if(status!=="missing")assert.ok(recordContractGaps(stale).includes("rebuild the stored Extra self-activation trigger"));
 const oldCtx={...ctx,scripts:rulesFromRows(rows.flatMap(r=>r===row?status==="missing"?[]:[stale]:[r]),defs)};
 let s=fresh("p1");const counter=stage(s,"p2","BT7-024","hand");stage(s,"p2","ENERGY","energy");const attack:Action={type:"attack",player:"p1",attacker:s.sides.p1.zones.leader[0],target:s.sides.p2.zones.leader[0]};
 const old=RULES.apply(oldCtx,copy(s),attack).state as VmState;assert.ok(!RULES.legalActions(oldCtx,old).some(x=>x.action.type==="counter"&&x.action.card===counter));s=take(s,attack);assert.throws(()=>RULES.apply(oldCtx,copy(s),{type:"counter",player:"p2",card:counter}),/rebuild the stored Extra self-activation trigger/);assert.ok(s.sides.p2.zones.energy.every(id=>s.cards[id].mode==="active"));cases++;
}
for(const owner of ["p1","p2"] as const){
 let s=fresh(owner);const source=stage(s,owner,"DESIRE","removed"),otherCopy=stage(s,owner,"DESIRE","drop"),broad=stage(s,owner,"BROAD","battle"),hand=stage(s,owner,"WATCH","battle");stage(s,owner,"OMNI","energy");s.cards[s.sides[other(owner)].zones.leader[0]].cardId="BT10-092";
 // Typed event protocol for the forthcoming permitted Drop route, not native Drop activation support.
 const moment={event:"skillActivated",card:source,controller:owner,args:{kind:"counter",from:"drop",extra:true,cardActivation:true,paid:true}};
 const pending=fire(ctx,game,s,moment);assert.ok(pending.some(p=>p.card===source&&p.trigger==="selfExtraActivated"));assert.ok(pending.some(p=>p.card===broad));assert.ok(pending.some(p=>p.card===s.sides[other(owner)].zones.leader[0]));assert.ok(!pending.some(p=>p.card===hand||p.card===otherCopy));cases++;
 s=copy(s);s.pending=[];assert.equal(fire(ctx,game,s,{...moment,args:{...moment.args,cardActivation:false}}).length,0);cases++;
 assert.throws(()=>fire(ctx,game,s,{...moment,args:{kind:"activate",from:"hand",extra:true,paid:true}}),/rebuild this saved Extra activation moment/);cases++;
 const missing=rows.filter(r=>!(r.cardId==="DROPSELF"&&r.kind==="auto")),dropCtx={...ctx,scripts:rulesFromRows(missing,defs)};s=fresh(owner);const id=stage(s,owner,"DROPSELF","drop"),before=s.sides[owner].zones.hand.length;
 const action=RULES.legalActions(dropCtx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===id);assert.ok(action,"unrelated Drop skill remains available despite missing self-card-activation Auto");s=RULES.apply(dropCtx,copy(s),action).state as VmState;assert.equal(s.prompt.kind,"main");assert.equal(s.sides[owner].zones.hand.length,before+1);assert.ok(s.sides[owner].zones.warp.includes(id));cases++;
}
for(const status of ["draft","confirmed","corrected"] as const){const row=rows.find(r=>r.cardId==="WATCH")!,stale={...row,status,trigger:["extraActivated"]};assert.ok(recordContractGaps(stale).includes("rebuild the stored hand-only Extra activation trigger"));assert.ok(rulesFromRows(rows.map(r=>r===row?stale:r),defs).WATCH.bySkill[row.skillIndex].unsupported.includes("rebuild the stored hand-only Extra activation trigger"));cases++;}
for(const text of ["[Auto] When this card is played, draw 1 card.","[Auto] When you activate this card's [Blocker] skill, draw 1 card.","[Auto] When you activate this card's [Villainous] skill, draw 1 card."]){assert.ok(skillRecords(card("NEGATIVE",{skill:text})).every(row=>!row.trigger.includes("selfExtraActivated")));cases++;}
assert.equal(isExtraCardActivation(false,"hand","keyword","Blocker"),false);assert.equal(isExtraCardActivation(true,"drop","activate:main"),false);cases+=2;
for(const owner of ["p1","p2"] as const){
 let s=fresh(other(owner));const source=stage(s,owner,"ALT","hand");stage(s,owner,"BLACK","hand");stage(s,owner,"BLACK","hand");stage(s,owner,"WATCH","battle");stage(s,owner,"BROAD","battle");const before=s.sides[owner].zones.hand.length;
 s=take(s,{type:"attack",player:other(owner),attacker:s.sides[other(owner)].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 s=take(s,{type:"counter",player:owner,card:source,alt:true});assert.equal(s.prompt.kind,"chooseCards");if(s.prompt.kind!=="chooseCards")throw new Error("price chooser");s=take(s,{type:"choose",player:owner,cards:[s.prompt.choice.candidates[0]]});s=finish(s);assert.equal(s.sides[owner].zones.hand.length,before-2+3,"alternative price: self Auto and both own watchers");assert.ok(s.sides[owner].zones.drop.includes(source));cases++;
}
assert.equal(isExtraCardActivation(true,"battle","activate:battle"),false,"ordinary Z-Extra Battle skill is not card activation");cases++;
for(const [cardId,trigger] of [["BT7-024",["played","selfExtraActivated"]],["WATCH",["extraActivated","extraActivatedFromHand"]]] as const){const row=rows.find(r=>r.cardId===cardId&&r.kind==="auto")!;assert.ok(recordContractGaps({...row,trigger:[...trigger]}).some(g=>g.includes("rebuild the stored")),"duplicate stale and new trigger requires rebuilding");cases++;}
for(const owner of ["p1","p2"] as const){
 let s=fresh(other(owner));const source=stage(s,owner,"STRICT","hand");stage(s,owner,"OMNI","energy");stage(s,owner,"BLACK","hand");stage(s,owner,"BLACK","hand");
 s=take(s,{type:"attack",player:other(owner),attacker:s.sides[other(owner)].zones.leader[0],target:s.sides[owner].zones.leader[0]});s=take(s,{type:"counter",player:owner,card:source});assert.equal(s.prompt.kind,"chooseCards");if(s.prompt.kind!=="chooseCards")throw new Error("strict price chooser");assert.ok(s.sides[owner].zones.energy.every(id=>s.cards[id].mode==="rest"),"energy paid before saved choice");
 const oldCtx={...ctx,scripts:rulesFromRows(rows.map(r=>r.cardId==="STRICT"&&r.kind==="auto"?{...r,trigger:["played"]}:r),defs)};
 const result=RULES.apply(oldCtx,copy(s),{type:"choose",player:owner,cards:[s.prompt.choice.candidates[0]]}).state as VmState;
 assert.match(JSON.stringify(result.outcome),/rebuild the stored Extra self-activation trigger/);assert.ok(result.sides[owner].zones.energy.every(id=>result.cards[id].mode==="rest"));cases++;
}
console.log(`extra-self-activated-5: ${cases} native and protocol cases passed`);
