/** R-395: Z-Awaken native placement and per-global-turn use. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard, findCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { activationsOf, resolveActivation } from "../../src/lib/arena/vm/activate";
import { run } from "../../src/lib/arena/vm/flow";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const PRINT = {"id": "EX23-28", "type": "Z-LEADER", "colors": ["Yellow"], "cost": null, "z": "2", "power": 20000, "name": "Omega Shenron, Collected Minus Energy", "characters": ["Syn Shenron"], "traits": ["Shadow Dragon"], "skill": "[double strike]<br>[z-awaken]{y}, if you have a total of 6 or more \u226aShadow Dragon\u226b cards among all the cards in your Drop and Warp: Yellow <Syn Shenron> card.<br>[auto] At the end of your turn, draw 1 card, then switch all yellow \u226aShadow Dragon\u226b cards in your Battle Area to Active Mode.<br>[activate: main/battle] Remove this card from the game: You may discard 6 yellow cards from your hand. If you do, choose all of your opponent's Rest Mode Battle Cards, ignoring [barrier], then negate their skills and KO them.", "backName": null, "backSkill": null};
const defs:Record<string,CardDef>={
 BASE:card("BASE",{type:"LEADER",colors:["Yellow"],characters:["Syn Shenron"],back:{name:"Syn Shenron",power:15000,skill:null}}),
 WRONG:card("WRONG",{type:"LEADER",colors:["Red"],characters:["Vegeta"],back:{name:"Vegeta",power:15000,skill:null}}),
 FILLER:card("FILLER",{colors:["Yellow"]}), DRAGON:card("DRAGON",{type:"EXTRA",traits:["Shadow Dragon"]}),
 COUNTER:card("COUNTER",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] If the Battle Card being played has an energy cost of 2 or less, it is placed in its owner's Drop Area instead of being played."}),
};
defs[PRINT.id]=card(PRINT.id,{type:"Z-LEADER",colors:["Yellow"],characters:PRINT.characters,traits:PRINT.traits,power:PRINT.power,zEnergyCost:Number(PRINT.z),skill:PRINT.skill});
defs.WATCHZ={...defs[PRINT.id],id:"WATCHZ",skill:"[Double Strike]<br>[Z-Awaken] {y}: Yellow <Syn Shenron> card.<br>[Auto] When this card is placed in your Leader Area, draw 1 card.<br>[Auto] When this card is played, draw 2 cards."};
const records=Object.values(defs).flatMap(skillRecords);
const row=records.find(r=>r.cardId===PRINT.id&&r.printed.toLowerCase().includes("[z-awaken]"))!;
assert.equal(row.cost?.readable,true);assert.deepEqual(runtimeSupportOfRow(row).unsupported,[]);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,source:"compiler",status:"confirmed"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(ctx,copy(s),a).state as VmState;
function stage(s:VmState,p:PlayerId,id:string,area:string):string{const cid=s.sides[p].zones.deck.at(-1)!;s.cards[cid].cardId=id;assert.ok(moveCard(s,game,cid,area,{owner:p}).ok);s.pending=[];return cid;}
function fresh(owner:PlayerId){
 let s=RULES.createGame(ctx,{seed:395,p1:{name:"One",leader:"BASE",main:fifty("FILLER"),z:[PRINT.id,PRINT.id]},p2:{name:"Two",leader:"BASE",main:fifty("FILLER"),z:[PRINT.id,PRINT.id]}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first:owner},{type:"mulligan",player:owner,redraw:false},{type:"mulligan",player:other(owner),redraw:false},{type:"charge",player:owner,card:null}] as Action[])s=take(s,a);
 for(const p of [owner,other(owner)]){s.cards[s.sides[p].zones.leader[0]].flipped=true;stage(s,p,"FILLER","energy");for(let i=0;i<4;i++)stage(s,p,"FILLER","zEnergy");for(let i=0;i<6;i++)stage(s,p,"DRAGON",i%2?"drop":"warp");}
 stage(s,other(owner),"COUNTER","hand");return s;
}
function offer(s:VmState,p:PlayerId,id=s.sides[p].zones.zDeck[0]){return RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===id&&a.skill===row.skillIndex);}
function finish(s:VmState){for(let i=0;i<30&&s.prompt.kind!=="main"&&s.prompt.kind!=="combo";i++){assert.notEqual(s.prompt.kind,"counter","placement opens no Counter window");const as=RULES.legalActions(ctx,s).map(x=>x.action);const a=as.find(a=>a.type==="choose")??as[0];assert.ok(a,JSON.stringify(s.prompt));s=take(s,a);}return s;}
let cases=0;
for(const p of ["p1","p2"] as const){
 for(const variant of ["normal","seven","allDrop","allWarp","five","wrongSide","wrongArea","wrongTrait","front","zLeader","faceUp","energy","zEnergy","protected"]){let s=fresh(p);const base=s.sides[p].zones.leader[0],z=s.sides[p].zones.zDeck[0];
 if(variant==="seven")stage(s,p,"DRAGON","drop");
 if(variant==="allDrop")for(const id of s.sides[p].zones.warp.slice())moveCard(s,game,id,"drop",{owner:p});
 if(variant==="allWarp")for(const id of s.sides[p].zones.drop.slice())moveCard(s,game,id,"warp",{owner:p});
 if(variant==="five")moveCard(s,game,s.sides[p].zones.warp[0],"hand",{owner:p});
 if(variant==="wrongSide"){moveCard(s,game,s.sides[p].zones.warp[0],"hand",{owner:p});stage(s,other(p),"DRAGON","warp");}
 if(variant==="wrongArea")moveCard(s,game,s.sides[p].zones.warp[0],"hand",{owner:p});
 if(variant==="wrongTrait")s.cards[s.sides[p].zones.warp[0]].cardId="FILLER";
 if(variant==="front")s.cards[base].flipped=false;
 if(variant==="zLeader")s.cards[base].cardId=PRINT.id;
 if(variant==="faceUp")s.cards[z].faceUp=true;
 if(variant==="energy")s.cards[s.sides[p].zones.energy[0]].mode="rest";
 if(variant==="zEnergy")for(const id of s.sides[p].zones.zEnergy.slice(1))moveCard(s,game,id,"drop",{owner:p});
 if(variant==="protected")for(const id of [...s.sides[p].zones.drop,...s.sides[p].zones.warp])addEffect(s,[],{target:id,kind:"immune",value:0,until:"game",master:p});
 const a=offer(s,p);assert.equal(!!a,["normal","seven","allDrop","allWarp","protected"].includes(variant),variant);
 if(a){s.cards[base].mode="rest";addEffect(s,[],{target:base,kind:"power",value:5000,until:"turn",master:p});s=finish(take(s,a));assert.equal(s.sides[p].zones.leader[0],z);assert.deepEqual(s.cards[z].under,[base]);assert.equal(s.cards[z].mode,"rest");assert.ok(s.effects.some(e=>e.target===z&&e.kind==="power"&&e.value===5000));assert.equal(s.sides[p].attrs.zAwakens,1);assert.equal(s.sides[p].zones.zEnergy.length,2);assert.equal(s.cards[s.sides[p].zones.energy[0]].mode,"rest");
 assert.ok(moveCard(s,game,z,"removed",{owner:p}).ok);assert.equal(s.sides[p].zones.leader[0],base);s.cards[s.sides[p].zones.energy[0]].mode="active";assert.equal(offer(s,p),undefined,"restoring base does not restore this turn's use");}
 else assert.equal(s.sides[p].attrs.zAwakens??0,0);cases++;
 }
 // Successful native placement pends its Leader-Area Auto, not its played Auto.
 {let s=fresh(p);const z=s.sides[p].zones.zDeck[0];s.cards[z].cardId="WATCHZ";const hand=s.sides[p].zones.hand.length;const a=offer(s,p,z);assert.ok(a);s=finish(take(s,a));assert.equal(s.sides[p].zones.hand.length,hand+1,"only placement Auto draws");cases++;}
 // Both turn players may activate during their own combo opportunity.
 for(const ownTurn of [true,false]){let s=fresh(p);const q=other(p),base=s.sides[p].zones.leader[0],z=s.sides[p].zones.zDeck[0];s.turnPlayer=ownTurn?p:q;s.phase="battle";s.battle={attacker:s.sides[s.turnPlayer].zones.leader[0],guard:s.sides[other(s.turnPlayer)].zones.leader[0],target:s.sides[other(s.turnPlayer)].zones.leader[0],step:ownTurn?"offense":"defense",negated:false,blockerOffered:false,counters:[]};s.prompt={kind:"combo",player:p,side:ownTurn?"offense":"defense"};const a=offer(s,p);assert.ok(a,"Main/Battle on either turn");s=take(s,a);assert.equal(s.sides[p].zones.leader[0],z);assert.equal(ownTurn?s.battle?.attacker:s.battle?.guard,z);assert.deepEqual(s.cards[z].under,[base]);assert.notEqual(s.prompt.kind,"counter");cases++;}
 for(const gain of ["color","character"]){const s=fresh(p),base=s.sides[p].zones.leader[0];s.cards[base].cardId="WRONG";addEffect(s,[],{target:base,kind:"gains",value:{colors:gain==="color"?["Yellow"]:[],characters:gain==="character"?["Syn Shenron"]:[],traits:[],names:[]},until:"turn",master:p});assert.equal(offer(s,p),undefined,`both qualifications required, only ${gain} gained`);cases++;}
 // The printed description sees current color and character gains, and loses
 // qualification when those gains end before the saved placement resolves.
 for(const removeGain of [false,true]){let s=fresh(p);const z=s.sides[p].zones.zDeck[0],base=s.sides[p].zones.leader[0];s.cards[base].cardId="WRONG";assert.equal(offer(s,p),undefined);addEffect(s,[],{target:base,kind:"gains",value:{colors:["Yellow"],characters:["Syn Shenron"],traits:[],names:[]},until:"turn",master:p});assert.ok(offer(s,p));const line=activationsOf(ctx,s,game.actions.activate!,z,game).find(l=>l.skill.index===row.skillIndex)!;resolveActivation(ctx,game,s,[],p,line);s=copy(s);if(removeGain)s.effects=s.effects.filter(e=>e.target!==base||e.kind!=="gains");run(ctx,game,s,[]);assert.equal(findCard(s,z)?.zone,removeGain?"removed":"leader");cases++;}
 // A normal end-turn transition resets both players' declared counters.
 {let s=fresh(p);s=finish(take(s,offer(s,p)!));const z=s.sides[p].zones.leader[0];assert.ok(moveCard(s,game,z,"removed",{owner:p}).ok);s.sides[other(p)].attrs.zAwakens=1;const turn=s.turn;for(let i=0;i<60&&s.turn===turn;i++){const as=RULES.legalActions(ctx,s).map(x=>x.action);const a=as.find(a=>a.type==="pass")??as.find(a=>a.type==="choose")??as[0];assert.ok(a,JSON.stringify(s.prompt));s=take(s,a);}assert.equal(s.turn,turn+1);assert.equal(s.turnPlayer,other(p));assert.equal(s.sides[p].attrs.zAwakens,0);assert.equal(s.sides[other(p)].attrs.zAwakens,0);s.cards[s.sides[p].zones.energy[0]].mode="active";s.phase="battle";s.battle={attacker:s.sides[other(p)].zones.leader[0],guard:s.sides[p].zones.leader[0],target:s.sides[p].zones.leader[0],step:"defense",negated:false,blockerOffered:false,counters:[]};s.prompt={kind:"combo",player:p,side:"defense"};assert.ok(offer(s,p),"usable again on opponent's next turn");cases++;}
 // Old persisted DOs must not silently replay ordinary play or guess a base.
 for(const missing of ["oldDO","sourceEpoch","baseEpoch"]){const s=fresh(p),z=s.sides[p].zones.zDeck[0];const line=activationsOf(ctx,s,game.actions.activate!,z,game).find(l=>l.skill.index===row.skillIndex)!;resolveActivation(ctx,game,s,[],p,line);const f=s.programs.find(f=>f.viaKeyword==="Z-Awaken")!;if(missing==="oldDO"){f.vars={};f.ops=[{op:"play",target:{sel:{special:"self"}},onto:{sel:{side:"you",area:"leader"}}}];}else delete f.vars[missing==="sourceEpoch"?"zAwakenSource@epoch":"zAwakenBase@epoch"];run(ctx,game,s,[]);assert.equal(s.outcome?.kind,"interrupted");assert.equal(findCard(s,z)?.zone,"zDeck");assert.equal(s.sides[p].attrs.zAwakens??0,0);cases++;}
 // Deliberately stage a saved post-payment continuation: there is no natural
 // response window between Z-Awaken payment and placement.
 for(const change of ["none","baseFront","baseReentry","sourceReentry","sourceLeaves"]){let s=fresh(p);const z=s.sides[p].zones.zDeck[0],base=s.sides[p].zones.leader[0];const line=activationsOf(ctx,s,game.actions.activate!,z,game).find(l=>l.skill.index===row.skillIndex)!;assert.ok(line);resolveActivation(ctx,game,s,[],p,line);s=copy(s);
 if(change==="baseFront")s.cards[base].flipped=false;
 if(change==="baseReentry"){s.cards[base].zoneEpoch=(s.cards[base].zoneEpoch??0)+2;}
 if(change==="sourceReentry"){s.cards[z].zoneEpoch=(s.cards[z].zoneEpoch??0)+2;}
 if(change==="sourceLeaves")assert.ok(moveCard(s,game,z,"removed",{owner:p}).ok);
 run(ctx,game,s,[]);assert.equal(s.sides[p].attrs.zAwakens,1);
 assert.equal(findCard(s,z)?.zone,change==="none"?"leader":change==="sourceReentry"?"zDeck":"removed",change);cases++;
 }
}
console.log(`Z-Awaken procedure 5: ${cases} stored/native scenarios passed`);
