/** R-360/R-361: successful play origins at turn end and watched Arrival entries. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { resolvePlay } from "../../src/lib/arena/vm/play";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { run } from "../../src/lib/arena/vm/flow";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy = <T,>(v:T):T => JSON.parse(JSON.stringify(v));
const END = "[Auto] Choose 1 Red/Blue multicolor card in your energy: At the end of a turn where this card was played from your hand, draw 1 card and switch the chosen card to Active Mode.";
const ARRIVAL = "[Auto][Limit 1] When you use [Arrival] to play a Red/Blue multicolor Battle Card, draw 1 card.";
const defs: Record<string,CardDef> = {
  TP5_LEADER: card("TP5_LEADER", {type:"LEADER",energyCost:null,comboCost:null,comboPower:null}),
  TP5_RED_LEADER: card("TP5_RED_LEADER", {type:"LEADER",energyCost:null,comboCost:null,comboPower:null,colors:["Red"],characters:["Warriors of Universe 7"]}),
  TP5_COMBO: card("TP5_COMBO", {skill:"[Auto][Limit 1] If your Leader is a red <Warriors of Universe 7> card and you place this card from your Combo Area in its owner's Drop: When you use [Arrival] to play a Red/Blue multicolor Battle Card, draw 1 card."}),
  TP5_FILLER: card("TP5_FILLER", {}),
  TP5_END: card("TP5_END", {skill:END,energyCost:0}),
  TP5_WATCH: card("TP5_WATCH", {skill:ARRIVAL}),
  TP5_GOOD: card("TP5_GOOD", {colors:["Red","Blue"],energyCost:0}),
  TP5_ARRIVER: card("TP5_ARRIVER", {colors:["Red","Blue"],energyCost:4,skill:"[Arrival Red/Blue] {r}"}),
  TP5_COUNTER: card("TP5_COUNTER", {type:"EXTRA",energyCost:0,power:null,comboCost:null,comboPower:null,skill:"[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played."}),
  TP5_BAD: card("TP5_BAD", {colors:["Red","Green"],energyCost:0}),
  TP5_MONO: card("TP5_MONO", {colors:["Red"],energyCost:0}),
};
const records=Object.values(defs).flatMap(d=>skillRecords(d));assert.deepEqual(records.flatMap(r=>r.unread),[]);
const end=records.find(r=>r.cardId==="TP5_END")!, arrival=records.find(r=>r.cardId==="TP5_WATCH")!;
assert.deepEqual(new Set(end.trigger),new Set(["turnEnd","opponentTurnEnd"]));
assert.deepEqual(end.cond,{kind:"placedThisTurn",sel:{special:"self"},played:true,from:["hand"]});
assert.deepEqual(arrival.trigger,["youPlayed"]);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,source:"compiler",status:"draft"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>copy(RULES.apply(ctx,copy(s),a).state as VmState);
function fresh(first:PlayerId):VmState{
 let s=RULES.createGame(ctx,{seed:360,p1:{name:"A",leader:"TP5_LEADER",main:fifty("TP5_FILLER")},p2:{name:"B",leader:"TP5_LEADER",main:fifty("TP5_FILLER")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);
 return s;
}
function stage(s:VmState,p:PlayerId,def:string,zone:string):string{
 const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,zone,{owner:p}).ok);return id;
}
function settle(s:VmState):VmState{
 for(let n=0;n<60;n++){
  const q=s.prompt;if(q.kind==="main"||q.kind==="charge")return s;
  const actions=RULES.legalActions(ctx,s).map(x=>x.action);
  const a=actions.find(a=>a.type==="counter"?a.card===null:a.type==="orderPending"?!a.decline:a.type==="choose"?a.cards.length>0:a.type==="chooseMode"?a.index===0:a.type==="payCost"||a.type==="pass");
  assert.ok(a,`no answer to ${q.kind}`);s=take(s,a);
 }throw new Error("did not settle");
}
let cases=0;
for(const seat of ["p1","p2"] as const){
 for(const turn of [seat,other(seat)])for(const mode of ["hand","drop","left","replayDrop","returned","placed"]){
  let s=fresh(turn);const energy=stage(s,seat,"TP5_GOOD","energy");s.cards[energy].mode="rest";
  const src=stage(s,seat,"TP5_END",mode==="drop"?"drop":"hand");
  if(mode==="placed")assert.ok(moveCard(s,game,src,"battle",{owner:seat}).ok);
  else assert.equal(resolvePlay(ctx,game,s,[],src,seat),true);
  if(["left","replayDrop","returned"].includes(mode)){
   assert.ok(moveCard(s,game,src,"drop",{owner:seat}).ok);
   if(mode==="replayDrop")assert.equal(resolvePlay(ctx,game,s,[],src,seat,{by:"skill"}),true);
   if(mode==="returned"){assert.ok(moveCard(s,game,src,"hand",{owner:seat}).ok);assert.ok(moveCard(s,game,src,"battle",{owner:seat}).ok);}
  }
  const hand=s.sides[seat].zones.hand.length;
  s=settle(take(s,{type:"endMain",player:turn}));
  // Entering the next player's Charge Phase draws once for that player.
  const nextDraw=other(turn)===seat?1:0;
  assert.equal(s.sides[seat].zones.hand.length,hand+nextDraw+(mode==="hand"?1:0),`${seat}/${turn}/${mode}: only successful same-copy hand play draws`);
  assert.equal(s.cards[energy].mode,mode==="hand"||other(turn)===seat?"active":"rest");cases++;
 }
 for(const using of [undefined,"Arrival","Union-Fusion"] as const)for(const def of ["TP5_GOOD","TP5_BAD","TP5_MONO"]){
  let s=fresh(seat);const watcher=stage(s,seat,"TP5_WATCH","battle"),foeWatch=stage(s,other(seat),"TP5_WATCH","battle");
  const played=stage(s,seat,def,"hand"),before=s.sides[seat].zones.hand.length;
  assert.equal(resolvePlay(ctx,game,s,[],played,seat,{...(using?{using}:{}),by:"skill"}),true);
  const expected=using==="Arrival"&&def==="TP5_GOOD";
  assert.equal(s.pending.some(p=>p.card===watcher),expected,`${using}/${def}: exact successful entry gate`);
  assert.equal(s.pending.some(p=>p.card===foeWatch),false,"opponent's play never triggers your watcher");
  if(expected){run(ctx,game,s,[]);s=settle(copy(s));assert.equal(s.sides[seat].zones.hand.length,before,"played one, drew one");}
  cases++;
 }
 for(const origin of ["combo","battle","hand","drop","energy"]){
  let s=fresh(seat);s.cards[s.sides[seat].zones.leader[0]].cardId="TP5_RED_LEADER";
  const watcher=stage(s,seat,"TP5_COMBO",origin),ordinary=stage(s,seat,"TP5_WATCH","combo"),played=stage(s,seat,"TP5_GOOD","hand");
  const before=s.sides[seat].zones.hand.length;
  assert.equal(resolvePlay(ctx,game,s,[],played,seat,{using:"Arrival",by:"skill"}),true);
  assert.equal(s.pending.some(p=>p.card===watcher),origin==="combo",`BT20-032 only ${origin}`);
  assert.equal(s.pending.some(p=>p.card===ordinary),false,"ordinary Combo copy has no out-of-play validity");
  if(origin==="combo"){run(ctx,game,s,[]);s=settle(copy(s));assert.ok(s.sides[seat].zones.drop.includes(watcher));assert.equal(s.sides[seat].zones.hand.length,before,"paid combo source, then drew");}
  cases++;
 }
 // Played subjects are observations even when protected from this watcher's skills.
 {
  let s=fresh(seat);const watcher=stage(s,seat,"TP5_WATCH","battle"),played=stage(s,seat,"TP5_GOOD","hand");
  addEffect(s,[],{target:played,kind:"immune",value:0,until:"game",immune:{from:seat}});
  assert.equal(resolvePlay(ctx,game,s,[],played,seat,{using:"Arrival",by:"skill"}),true);
  assert.ok(s.effects.some(e=>e.target===played&&e.kind==="immune"),"immune subject remains protected at play event");
  assert.ok(s.pending.some(p=>p.card===watcher));const before=s.sides[seat].zones.hand.length;
  run(ctx,game,s,[]);s=settle(copy(s));assert.equal(s.sides[seat].zones.hand.length,before+1,"immune observed subject still resolves Arrival Auto");cases++;
 }
 // A different pending effect can remove the Combo source before its Auto is paid.
 {
  let s=fresh(seat);s.cards[s.sides[seat].zones.leader[0]].cardId="TP5_RED_LEADER";
  const watcher=stage(s,seat,"TP5_COMBO","combo"),played=stage(s,seat,"TP5_GOOD","hand");
  assert.equal(resolvePlay(ctx,game,s,[],played,seat,{using:"Arrival",by:"skill"}),true);
  assert.ok(s.pending.some(p=>p.card===watcher));assert.ok(moveCard(s,game,watcher,"drop",{owner:seat}).ok);
  const before=s.sides[seat].zones.hand.length;run(ctx,game,s,[]);s=settle(copy(s));assert.equal(s.sides[seat].zones.hand.length,before,"departed Combo source cannot pay and draw");cases++;
 }
 // Declare the real Arrival keyword during a battle, with its colour/payment gates and Counter:Play window.
 for(const countered of [false,true]){
  let s=fresh(seat);
  for(const a of [{type:"endMain",player:seat},{type:"charge",player:other(seat),card:null},{type:"endMain",player:other(seat)},{type:"charge",player:seat,card:null}] as Action[])s=take(s,a);
  const watcher=stage(s,seat,"TP5_WATCH","battle"),arriver=stage(s,seat,"TP5_ARRIVER","hand"),energy=stage(s,seat,"TP5_MONO","energy");
  stage(s,seat,"TP5_GOOD","combo");const counter=countered?stage(s,other(seat),"TP5_COUNTER","hand"):null;
  s=take(s,{type:"attack",player:seat,attacker:s.sides[seat].zones.leader[0],target:s.sides[other(seat)].zones.leader[0]});
  for(let i=0;i<10&&s.prompt.kind!=="combo";i++){
   const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="counter"?a.card===null:a.type==="pass");assert.ok(a);s=take(s,a);
  }
  assert.equal(s.prompt.kind,"combo");const before=s.sides[seat].zones.hand.length;
  s=take(s,{type:"activate",player:seat,card:arriver,skill:0});
  if(countered){assert.equal(s.prompt.kind,"counter");s=take(s,{type:"counter",player:other(seat),card:counter});}
  let observed=false;
  for(let i=0;i<30;i++){
   observed ||= s.pending.some(p=>p.card===watcher);
   if(s.prompt.kind==="combo"||s.prompt.kind==="main")break;
   const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="counter"?a.card===null:a.type==="orderPending"?!a.decline:a.type==="chooseMode"?a.index===0:a.type==="payCost"||a.type==="pass");assert.ok(a,`arrival ${s.prompt.kind}`);s=take(s,a);
  }
  assert.equal(s.cards[energy].mode,"rest","Arrival charges printed red orb");
  assert.equal(s.sides[seat].zones.battle.includes(arriver),!countered);
  assert.equal(s.sides[seat].zones.hand.length,before-1+(countered?0:1),"only successful Arrival draws");
  if(countered)assert.equal(observed,false,"replaced Arrival never pends watched play");cases++;
 }
 // A failed play (invalid evolution base) emits no Arrival-like watched play.
 {
  const s=fresh(seat),watcher=stage(s,seat,"TP5_WATCH","battle"),played=stage(s,seat,"TP5_GOOD","hand");
  assert.equal(resolvePlay(ctx,game,s,[],played,seat,{using:"Evolve",onto:"missing"}),false);assert.ok(!s.pending.some(p=>p.card===watcher));cases++;
 }
}
console.log(`trigger play memories 5: ${cases} actual play/turn-end scenarios passed`);
