/** Official BT13-046 image: generic six plus draw two, not an unknown X price. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { correctSkillText } from "../../src/lib/catalog/errata";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const RAW = "[double strike][dual attack]<br>[ex-evolve]?, draw 2 cards: <Boujack> with an energy cost of 3 or 4.<br>[auto]{u}③: At the end of a battle in which this card is used in a combo from your hand or energy, draw 1 card, choose up to 1 of your opponent's Battle Cards and place it at the bottom of its owner's deck, then play this card from your Drop Area in Rest Mode.<br>[auto][once per turn] If this card is in Rest Mode: When your opponent attacks with a Battle Card, switch up to 1 of your blue energy to Active Mode, then switch up to 1 of your opponent's energy to Rest Mode.";
const corrected = correctSkillText("BT13-046", RAW)!;
assert.equal(corrected, RAW.replace("[ex-evolve]?", "[ex-evolve]{6}"));
assert.equal(correctSkillText("BT13-046", corrected), corrected);
assert.equal(correctSkillText("UNRELATED", RAW), RAW);
const defs: Record<string, CardDef> = {
  L: card("L", {type:"LEADER"}), F: card("F", {}),
  "BT13-046": card("BT13-046", {name:"Boujack, On a Rampage", colors:["Blue"], characters:["Boujack"], traits:["Boujack Brigade"], energyCost:8, power:30000, skill:corrected}),
  THREE: card("THREE", {characters:["Boujack"], energyCost:3}),
  FOUR: card("FOUR", {characters:["Boujack"], energyCost:4}),
  LOW: card("LOW", {characters:["Boujack"], energyCost:2}),
  HIGH: card("HIGH", {characters:["Boujack"], energyCost:5}),
  WRONG: card("WRONG", {characters:["Son Goku"], energyCost:3}),
};
const records = Object.values(defs).flatMap(skillRecords);
const evolve = records.find(r=>r.cardId==="BT13-046" && r.printed.toLowerCase().includes("[ex-evolve]"))!;
assert.equal(evolve.cost?.readable, true);
assert.deepEqual(evolve.cost?.program, [{op:"draw",n:2}]);
const ctx:EngineContext = {defs,scripts:rulesFromRows(records.map((r,id)=>({...r,id,source:"compiler",status:"confirmed"}) as unknown as RuleRow),defs)};
const loaded=rulesetFor("dbs"); assert.ok(loaded.ok); const game=loaded.definition;
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
function take(s:VmState,a:Action):VmState {
  const one=RULES.apply(ctx,copy(s),copy(a)),two=RULES.apply(ctx,copy(s),copy(a));
  assert.deepEqual(one,two,"saved native action replay"); return one.state as VmState;
}
function fresh(p:PlayerId):VmState {
  let s=RULES.createGame(ctx,{seed:446,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
  for(const a of [{type:"chooseFirst",player:s.chooser,first:p},{type:"mulligan",player:p,redraw:false},{type:"mulligan",player:other(p),redraw:false},{type:"charge",player:p,card:null}] as Action[])s=take(s,a);
  return s;
}
function stage(s:VmState,p:PlayerId,def:string,area:string):string {
  const id=s.sides[p].zones.deck.at(-1)!; s.cards[id].cardId=def;
  assert.ok(moveCard(s,game,id,area,{owner:p}).ok); return id;
}
let cases=0;
for(const p of ["p1","p2"] as const)for(const variant of ["three","four","rest","shortEnergy","shortDeck","low","high","wrong","wrongSide","wrongArea"]){
  let s=fresh(p);const source=stage(s,p,"BT13-046","hand");
  const base=stage(s,variant==="wrongSide"?other(p):p,variant==="four"?"FOUR":variant==="low"?"LOW":variant==="high"?"HIGH":variant==="wrong"?"WRONG":"THREE",variant==="wrongArea"?"drop":"battle");
  if(variant==="rest")s.cards[base].mode="rest";
  const energy=Array.from({length:variant==="shortEnergy"?5:6},()=>stage(s,p,"F","energy"));
  if(variant==="shortDeck")for(const id of s.sides[p].zones.deck.slice(1))assert.ok(moveCard(s,game,id,"drop",{owner:p}).ok);
  const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate" && a.card===source && a.skill===evolve.skillIndex);
  const payable=["three","four","rest"].includes(variant);assert.equal(!!action,payable,variant);
  if (!action) assert.throws(()=>RULES.apply(ctx,copy(s),{type:"activate",player:p,card:source,skill:evolve.skillIndex}), "forged unpaid/ineligible evolution refuses");
  if(action){
    const deck=s.sides[p].zones.deck.length,hand=s.sides[p].zones.hand.length;
    s=take(s,action);
    for(let i=0;i<20 && s.prompt.kind!=="main";i++){
      const q=s.prompt;
      if(q.kind==="chooseCards")s=take(s,{type:"choose",player:q.player,cards:q.choice.candidates.includes(base)?[base]:q.choice.candidates.slice(0,q.choice.min)});
      else if(q.kind==="counter")s=take(s,{type:"counter",player:q.player,card:null});
      else if(q.kind==="payCost")s=take(s,{type:"payCost",player:q.player,option:0});
      else throw Error(JSON.stringify(q));
    }
    assert.equal(s.prompt.kind,"main");assert.equal(s.outcome,undefined);
    assert.ok(s.sides[p].zones.battle.includes(source));assert.ok(s.cards[source].under.includes(base));
    assert.equal(s.cards[source].mode,variant==="rest"?"rest":"active");
    assert.equal(s.sides[p].zones.deck.length,deck-2);assert.equal(s.sides[p].zones.hand.length,hand+1);
    assert.ok(energy.every(id=>s.cards[id].mode==="rest"),"all six generic energy paid");
  }
  cases++;
}
console.log(`Boujack source price 5: ${cases} native payment/base scenarios passed`);
