/** R-483: exact frozen skill records on structural fixtures; native saved actions. */
import assert from "node:assert/strict";
import fixtures from "./fixtures/watched-combo-origin-5.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { vmRevealedTo } from "../../src/lib/arena/vm/view";
import { pendAutos } from "../../src/lib/arena/vm/triggers";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy = <T,>(v:T):T => JSON.parse(JSON.stringify(v));
const defs:Record<string,CardDef> = {
 F:card("F",{}), L:card("L",{type:"LEADER"}), A:card("A",{power:10000}), G:card("G",{power:100000}),
 REDBOUNCE:card("REDBOUNCE",{colors:["Red"],traits:["Saiyan"],comboCost:1,skill:"[Auto] When this card is used in a combo, return this card to its owner’s hand."}),
 BOUNCE:card("BOUNCE",{colors:["Blue"],traits:["Universe 7"],comboCost:1,skill:"[Auto] When this card is used in a combo, return this card to its owner’s hand."}),
 MATCH:card("MATCH",{colors:["Blue"],traits:["Universe 7"],comboCost:1}),
 WRONG:card("WRONG",{colors:["Red"],traits:["Saiyan"],comboCost:1}),
 YELLOW:card("YELLOW",{colors:["Yellow"],traits:["Universe 7"],comboCost:1}),
 BLUEOTHER:card("BLUEOTHER",{colors:["Blue"],traits:["Saiyan"],comboCost:1}),
 OR:card("OR",{type:"LEADER",skill:"[Auto][Once per turn] When you use a blue or yellow ≪Universe 7≫ card from your hand in a combo, draw 1 card."}),
 E:card("E",{colors:["Blue"]}),
};
const keys = ["BT19-035#0","TB1-025#10","TB1-025#20b"] as const;
for(const key of keys) defs[key]=card(key,{type:"LEADER",skill:fixtures[key].printed});
for(const area of ["hand","Battle Area","Drop Area","deck","Combo Area"])
 defs[`SKILL-${area}`]=card(`SKILL-${area}`,{skill:`[Activate: Battle] Choose up to 1 blue Battle Card from your ${area} and use it in a combo.`});
const rows=Object.values(defs).flatMap(skillRecords);
for(const key of keys){ const r=rows.find(r=>r.cardId===key)!; assert.deepEqual(r.unread,[]); assert.deepEqual(r.ops,fixtures[key].ops); assert.deepEqual(r.cond,fixtures[key].cond); assert.deepEqual(r.trigger,[key.startsWith("BT19")?"youComboFromHand":"youComboFromBattle"]); }
assert.ok(skillRecords(card("excluded",{skill:fixtures["BT20-041#20"].printed}))[0].unread.length,"multi-origin under/hand body remains blocked");
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(rows.map((r,id)=>({...r,id,status:"confirmed",source:"compiler"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
function take(s:VmState,a:Action):VmState {
 const before=JSON.stringify(s); const saved=copy(s);
 RULES.boardView(ctx,saved,"p1",{}); RULES.boardView(ctx,saved,"p2",{});
 const next=RULES.apply(ctx,saved,a).state as VmState;
 assert.equal(JSON.stringify(s),before); assert.equal(JSON.stringify(saved),before,"apply and both views preserve their input"); assert.equal(next.outcome,undefined,JSON.stringify(next.outcome));return next;
}
function fresh(first:PlayerId):VmState {
 let s=RULES.createGame(ctx,{seed:483,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},
 {type:"charge",player:first,card:null},{type:"endMain",player:first},{type:"charge",player:other(first),card:null},{type:"endMain",player:other(first)},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);
 s.sides.p1.attrs.energyMarkers=0;s.sides.p2.attrs.energyMarkers=0;return s;
}
function stage(s:VmState,p:PlayerId,def:string,area:string):string {
 const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);s.cards[id].mode="active";if(area==="deck"){s.sides[p].zones.deck=s.sides[p].zones.deck.filter(x=>x!==id);s.sides[p].zones.deck.unshift(id);}return id;
}
function proceed(s:VmState,p:PlayerId,end=false):VmState {
 for(let n=0;n<40;n++){
  if(end?s.prompt.kind==="main":s.prompt.kind==="combo"&&s.prompt.player===p)return s;
  const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="payCost"||a.type==="counter"&&a.card===null||a.type==="pass"||a.type==="block"&&a.card===null||a.type==="zEnergyFromCombo"&&a.card===null);
  assert.ok(a,JSON.stringify(s.prompt));s=take(s,a);
 }throw Error("no destination prompt");
}
function setup(p:PlayerId,key:string,turn:PlayerId,area:string,candidate="MATCH",negated=false){
 let s=fresh(turn);const watcher=s.sides[p].zones.leader[0];s.cards[watcher].cardId=key;
 // Opposing matching watcher must not hear this player's combo.
 const opposite=s.sides[other(p)].zones.leader[0];s.cards[opposite].cardId=key;
 const source=stage(s,p,candidate,area),energy=stage(s,p,"E","energy");stage(s,p,"E","energy");
 const attacker=stage(s,turn,"A","battle"),guard=stage(s,other(turn),"G","battle");s.cards[guard].mode="rest";
 if(negated)addEffect(s,[],{kind:"negateSkills",target:watcher,value:0,until:"turn"});
 s=take(s,{type:"attack",player:turn,attacker,target:guard});s=proceed(s,p);return {s,source,watcher,opposite,energy};
}
let cases=0;
for(const p of ["p1","p2"] as const)for(const key of keys)for(const ownTurn of [true,false])for(const area of ["hand","battle"])for(const candidate of ["MATCH","WRONG"])for(const negated of [false,true]){
 const turn=ownTurn?p:other(p);const {s:initial,source,energy}=setup(p,key,turn,area,candidate,negated);let s=initial;
 const deck=s.sides[p].zones.deck.length,opp=s.sides[other(p)].zones.deck.length;
 assert.ok(RULES.legalActions(ctx,s).some(x=>x.action.type==="combo"&&x.action.card===source));
 s=take(s,{type:"combo",player:p,card:source});s=proceed(s,p);
 const draw=!negated&&candidate==="MATCH"&&(key.startsWith("BT19")?area==="hand":area==="battle"&&ownTurn)?(key.startsWith("BT19")?1:2):0;
 assert.equal(s.sides[p].zones.deck.length,deck-draw,`${p}/${key}/${ownTurn}/${area}/${candidate}/${negated}`);
 assert.equal(s.sides[other(p)].zones.deck.length,opp,"opponent watcher does not hear own combo");
 assert.equal(s.cards[energy].mode,"rest","actual combo cost paid");
 const d=s.sides[p].zones.deck.length;s=proceed(s,p,true);assert.equal(s.sides[p].zones.deck.length,d,"no cleanup duplicate");cases++;
}
// Skill-created combos traverse the real activation/choice/host alias dispatch.
for(const p of ["p1","p2"] as const)for(const key of keys)for(const ownTurn of [true,false])for(const [area,words] of [["hand","hand"],["battle","Battle Area"],["drop","Drop Area"],["deck","deck"]]){
 const turn=ownTurn?p:other(p);const {s:initial,source}=setup(p,key,turn,area);let s=initial;
 const actor=stage(s,p,`SKILL-${words}`,"battle");
 const deck=s.sides[p].zones.deck.length;
 const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===actor);
 assert.ok(a,`skill action ${words}: ${JSON.stringify(s.prompt)}`);s=take(s,a);
 assert.equal(s.prompt.kind,"chooseCards",`${key}/${area}/${ownTurn}: ${JSON.stringify(rows.find(r=>r.cardId===`SKILL-${words}`))}`);if(area==="deck"){assert.ok(vmRevealedTo(game,s,p).has(source));assert.ok(!vmRevealedTo(game,s,other(p)).has(source),"private Deck choice conceals source from opponent");}
 s=take(s,{type:"choose",player:p,cards:[source]});s=proceed(s,p);
 assert.ok(s.sides[p].zones.combo.includes(source));assert.equal(s.battle?.comboOrigins?.[source],area);
 const draw=key.startsWith("BT19")?(area==="hand"?1:0):(area==="battle"&&ownTurn?2:0);
 assert.equal(s.sides[p].zones.deck.length,deck-draw-(area==="deck"?1:0),`skill ${key}/${area}/${ownTurn}`);cases++;
}
// A nonmatching subject does not spend usage; a second matching combo does.
for(const p of ["p1","p2"] as const)for(const key of keys){
 const area=key.startsWith("BT19")?"hand":"battle";
 const {s:initial,source}=setup(p,key,p,area,"WRONG");let s=initial;
 const good=stage(s,p,"MATCH",area),again=stage(s,p,"MATCH",area);stage(s,p,"E","energy");
 s=take(s,{type:"combo",player:p,card:source});s=proceed(s,p);
 const deck=s.sides[p].zones.deck.length;
 s=take(s,{type:"combo",player:p,card:good});s=proceed(s,p);
 const draw=key.startsWith("BT19")?1:2;assert.equal(s.sides[p].zones.deck.length,deck-draw);
 s=take(s,{type:"combo",player:p,card:again});s=proceed(s,p);assert.equal(s.sides[p].zones.deck.length,deck-draw);cases++;
}
// Native turn transition resets usage, and an attempted Combo-to-Combo skill
// does not reuse the subject's old Hand provenance to produce another trigger.
for(const p of ["p1","p2"] as const)for(const key of keys){
 const area=key.startsWith("BT19")?"hand":"battle";
 const {s:initial,source}=setup(p,key,p,area);let s=initial;s=take(s,{type:"combo",player:p,card:source});s=proceed(s,p);
 const actor=stage(s,p,"SKILL-Combo Area","battle");
 const activation=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===actor);assert.ok(activation);
 // A fresh, unused watcher isolates no-op dispatch from once-per-turn suppression.
 const newWatcher=stage(s,p,key,"battle");const before=s.sides[p].zones.deck.length;
 s=take(s,activation);assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:p,cards:[source]});s=proceed(s,p);
 assert.equal(s.sides[p].zones.deck.length,before,"already Combo target produces no entry");
 assert.ok(!s.pending.some(x=>x.card===newWatcher));
 s=proceed(s,p,true);
 // Remove the fixture watcher through setup only; the original Leader's
 // once-per-turn receipt remains and must be cleared by the native turn.
 moveCard(s,game,newWatcher,"drop",{owner:p});
 s=take(s,{type:"endMain",player:p});s=take(s,{type:"charge",player:other(p),card:null});s=take(s,{type:"endMain",player:other(p)});s=take(s,{type:"charge",player:p,card:null});
 const next=stage(s,p,"MATCH",area),att=stage(s,p,"A","battle"),guard=stage(s,other(p),"G","battle");s.cards[guard].mode="rest";
 s=take(s,{type:"attack",player:p,attacker:att,target:guard});s=proceed(s,p);const deck=s.sides[p].zones.deck.length;
 s=take(s,{type:"combo",player:p,card:next});s=proceed(s,p);assert.equal(s.sides[p].zones.deck.length,deck-(key.startsWith("BT19")?1:2));cases++;
}
// A real cleanup followed by a real skill entry overwrites old provenance.
for(const p of ["p1","p2"] as const)for(const key of keys){
 const area=key.startsWith("BT19")?"hand":"battle";const {s:initial,source}=setup(p,key,p,area);let s=initial;
 s=take(s,{type:"combo",player:p,card:source});s=proceed(s,p,true);assert.ok(s.sides[p].zones.drop.includes(source));
 // Fresh watcher has no spent use; the returning old subject must still fail.
 stage(s,p,key,"battle");const actor=stage(s,p,"SKILL-Drop Area","battle");const attacker=stage(s,p,"A","battle"),guard=stage(s,other(p),"G","battle");s.cards[guard].mode="rest";
 s=take(s,{type:"attack",player:p,attacker,target:guard});s=proceed(s,p);const before=s.sides[p].zones.deck.length;
 const activation=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===actor);assert.ok(activation);s=take(s,activation);
 s=take(s,{type:"choose",player:p,cards:[source]});s=proceed(s,p);
 assert.equal(s.battle?.comboOrigins?.[source],"drop");assert.equal(s.sides[p].zones.deck.length,before);cases++;
}
// A competing native Auto moves the subject before this watcher resolves.
// The queued, saved watcher retains the attributes that qualified its event.
for(const p of ["p1","p2"] as const)for(const key of keys){
 const area=key.startsWith("BT19")?"hand":"battle";const {s:initial,source,watcher}=setup(p,key,p,area,"BOUNCE");let s=initial;
 const deck=s.sides[p].zones.deck.length;s=take(s,{type:"combo",player:p,card:source});
 if(s.prompt.kind==="payCost"){const pay=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="payCost");assert.ok(pay);s=take(s,pay);}
 const pending=s.pending.find(x=>x.card===watcher);assert.ok(pending&&"subjectInfo" in pending&&pending.subjectInfo,"event attrs captured before ordering");
 assert.equal(pending.subject,source);assert.deepEqual(pending.subjectInfo.colors,["Blue"]);
 for(const fault of ["subjectInfo","subject"] as const){
  const bad=copy(s);for(const queue of [bad.pending,bad.pendingOrder!.queue])for(const item of queue)if(item.card===watcher&&item.kind!=="hook")delete item[fault];
  const before=JSON.stringify(bad);const stopped=RULES.apply(ctx,bad,{type:"orderPending",player:p,index:bad.pending.findIndex(x=>x.card===watcher)}).state as VmState;
  assert.equal(JSON.stringify(bad),before);assert.equal(stopped.outcome?.kind,"interrupted");assert.equal(stopped.outcome?.privateContext?.issue,"R483");
  assert.match(stopped.outcome?.privateContext?.detail??"",/missing its subject attributes/);assert.equal(stopped.sides[p].zones.deck.length,deck);cases++;
 }

 const index=s.pending.findIndex(x=>x.card===source);assert.ok(index>=0);
 s=take(s,{type:"orderPending",player:p,index});
 assert.ok(s.sides[p].zones.hand.includes(source),"other Auto moved subject first");
 s=proceed(s,p);assert.equal(s.sides[p].zones.deck.length,deck-(key.startsWith("BT19")?1:2),"fulfilled trigger survives subject departure");cases++;
}
// Strong capture control: Battle-to-Combo retains a temporary Universe 7
// trait under RM 3-1-4; the subsequent self-return ends that real grant.
for(const p of ["p1","p2"] as const)for(const key of ["TB1-025#10","TB1-025#20b"]){
 const {s:initial,source,watcher}=setup(p,key,p,"battle","REDBOUNCE");let s=initial;
 addEffect(s,[],{kind:"gains",target:source,value:{colors:[],traits:["Universe 7"],characters:[],names:[]},until:"turn"});
 const deck=s.sides[p].zones.deck.length;s=take(s,{type:"combo",player:p,card:source});
 if(s.prompt.kind==="payCost"){const pay=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="payCost");assert.ok(pay);s=take(s,pay);}
 const pending=s.pending.find(x=>x.card===watcher);assert.ok(pending&&"subjectInfo" in pending&&pending.subjectInfo);
 assert.ok((pending.subjectInfo.traits as string[]).some(x=>x.toLowerCase()==="universe 7"));
 s=take(s,{type:"orderPending",player:p,index:s.pending.findIndex(x=>x.card===source)});
 assert.ok(s.sides[p].zones.hand.includes(source));assert.deepEqual(attrsNow(ctx,game,s,source).traits,["Saiyan"]);
 s=proceed(s,p);assert.equal(s.sides[p].zones.deck.length,deck-2,"captured Universe 7 qualifies despite its expired grant");cases++;
}
// No energy means the priced combo is not offered and creates no draw.
for(const p of ["p1","p2"] as const){
 const {s,source}=setup(p,"BT19-035#0",p,"hand");for(const id of s.sides[p].zones.energy)s.cards[id].mode="rest";
 assert.ok(!RULES.legalActions(ctx,s).some(x=>x.action.type==="combo"&&x.action.card===source));
 assert.throws(()=>take(s,{type:"combo",player:p,card:source}));cases++;
}
// Synthetic conjunction/OR description: neither an OR alternative nor the
// required trait may disappear in the watched subject gate.
for(const p of ["p1","p2"] as const)for(const candidate of ["MATCH","YELLOW","WRONG","BLUEOTHER"]){
 const {s:initial,source}=setup(p,"OR",p,"hand",candidate);let s=initial;const deck=s.sides[p].zones.deck.length;
 s=take(s,{type:"combo",player:p,card:source});s=proceed(s,p);
 assert.equal(s.sides[p].zones.deck.length,deck-(["MATCH","YELLOW"].includes(candidate)?1:0));cases++;
}
// Mechanism controls supplement native actions: missing old-save provenance is
// refused only for a matching, active watcher; source identity is the arrival.
for(const p of ["p1","p2"] as const){
 const {s,source,watcher}=setup(p,"BT19-035#0",p,"hand");
 assert.ok(moveCard(s,game,source,"combo",{owner:p}).ok);
 const moment={event:"comboUsed",card:source,controller:p,args:{to:"combo"}};
 delete s.battle!.comboOrigins?.[source];
 assert.throws(()=>pendAutos(ctx,game,copy(s),moment),/infer the origin of a watched combo/);
 const wrong=copy(s);wrong.cards[source].cardId="WRONG";assert.doesNotThrow(()=>pendAutos(ctx,game,wrong,moment));
 const absent=copy(s);absent.cards[watcher].cardId="L";stage(absent,p,"BT19-035#0","hand");assert.doesNotThrow(()=>pendAutos(ctx,game,absent,moment));
 const stale=copy(s);moveCard(stale,game,source,"hand",{owner:p});(stale.battle!.comboOrigins??={})[source]="hand";
 assert.equal(pendAutos(ctx,game,stale,moment).filter(x=>x.card===watcher).length,0,"stale history cannot qualify a failed arrival");cases++;
}
console.log(`watched combo origin: ${cases} cases (native saved actions plus missing-origin controls)`);
