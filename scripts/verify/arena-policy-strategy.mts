/** Focused v2 resource-planning and synthetic strategy evidence proofs. */
import assert from "node:assert/strict";
import { applyMove, legalMoves, type PinnedMatch } from "../../src/lib/arena/browser.ts";
import { canonicalJson } from "../../src/lib/arena/replay-core.ts";
import { addEffect } from "../../src/lib/arena/vm/effects.ts";
import { policyTurn, applyDecision } from "../../src/lib/arena/policy/boundary.ts";
import { policyRng } from "../../src/lib/arena/policy/rng.ts";
import { localPolicy } from "../../src/lib/arena/policy/combat.ts";
import { searchDecision, SEARCH_LIMITS } from "../../src/lib/arena/policy/search.ts";
import { permutedFor } from "./arena-policy-permute.ts";
import { strategyCases, runStrategyCases } from "./arena-policy-strategy.ts";
import { layout, declare, strategyOpening } from "./arena-policy-strategy-fixture.ts";
import { SEARCH_HOLDOUT_PROTOCOL, SEARCH_EVAL_SETS } from "./arena-search-protocol.ts";

const {bundle,cases}=await strategyCases();
const freshSeeds=Object.values(SEARCH_HOLDOUT_PROTOCOL.engineSeeds).flat();
assert.equal(freshSeeds.length,160);assert.equal(new Set(freshSeeds).size,160);
assert.ok(freshSeeds.every((seed)=>seed>20_000_000 && seed<21_000_000));
assert.equal(SEARCH_EVAL_SETS.holdout.base,20_000_000,"consumed v1 +10M seeds are never reused as fresh");
const {records}=await runStrategyCases();
assert.equal(records.length,15);
assert.ok(records.every((row)=>row.outcome!=="error" && row.outcome!=="interrupted"));
for(const row of records) {
  const expected=row.policyKey==="heuristic-v1" && ["ai-01-own-combo-lethal","ai-02-defer-first-defense","ai-05-critical-first"].includes(row.key)?"fail":"pass";
  assert.equal(row.outcome,expected,`${row.key}/${row.policyKey}`);
  if(row.key==="ai-01-own-combo-lethal" && row.outcome==="pass") {assert.equal(row.detail.energySpent,1);assert.equal(row.detail.comboCards,1);}
  if(row.key==="ai-02-defer-first-defense" && row.outcome==="pass") {assert.equal(row.detail.energySpent,1);assert.equal(row.detail.comboCards,3);assert.equal(row.detail.life,1);}
  if(row.key==="ai-05-normal-first") assert.equal(row.detail.battles,1,"counterexample has a declared one-battle finish objective");
}
// Independent engine oracle: ordinary Life damage adds one actual 5k card to
// hand, Critical sends that same identity to Drop. No candidate scorer involved.
const opening=await strategyOpening(bundle);
const empty={hand:[],energy:[],battle:[],energyMarkers:0,leaderMode:"rest" as const};
const resolveUnopposed=(initial:PinnedMatch)=>{
  let match=initial;
  for(let n=0;n<30 && match.state.battle;n++) {
    const moves=legalMoves(match).map((m)=>m.action);
    const action=moves.find((a)=>a.type==="pass" || a.type==="counter" && a.card===null || a.type==="block" && a.card===null || a.type==="zEnergyFromCombo" && a.card===null);
    assert.ok(action,"oracle only declines offered responses");
    match=applyMove(match,action).match;
  }
  assert.equal(match.state.battle,null);
  return match;
};
for(const [cardId,hand,drop] of [["S-5",1,0],["S-CRIT",0,1]] as const) {
  const m=layout(opening,{...empty,battle:[{cardId,mode:"active"}]},{...empty,life:2});
  const lifeId=m.state.sides.p2.zones.life[0];
  const after=resolveUnopposed(declare(m,cardId));
  assert.equal(after.state.sides.p2.zones.life.length,1);
  assert.equal(after.state.sides.p2.zones.hand.length,hand);
  assert.equal(after.state.sides.p2.zones.drop.length,drop);
  assert.ok(after.state.sides.p2.zones[hand?"hand":"drop"].includes(lifeId));
}
// Actual negation preserves printed text while removing the active Strike
// family; a grant without an observable reliable parameter must fall back.
const strikeMatch=layout(opening,{...empty,battle:[{cardId:"S-DS25",mode:"active"}]},{...empty,life:2,battle:[{cardId:"S-25",mode:"rest"}]});
const strikeId=strikeMatch.state.sides.p1.zones.battle[0];
const negated={...strikeMatch,state:structuredClone(strikeMatch.state)};
addEffect(negated.state,[],{target:strikeId,source:strikeId,kind:"negateSkills",value:0,until:"turn"});
const negatedTurn=policyTurn(negated,"p1",0);
assert.match(negatedTurn.input.observation.you.battle[0].text!,/Double Strike/);
assert.ok(!negatedTurn.input.observation.you.battle[0].keywords.includes("Strike"));
const activeTurn=policyTurn(strikeMatch,"p1",0);
assert.equal((activeTurn.key.menu[searchDecision(activeTurn.input,policyRng(82601)).answer.id] as {target:string}).target,strikeMatch.state.sides.p2.zones.leader[0],"active Double Strike takes the forced finish");
assert.equal((negatedTurn.key.menu[searchDecision(negatedTurn.input,policyRng(82601)).answer.id] as {target:string}).target,negated.state.sides.p2.zones.battle[0],"same printed text with negated skill no longer predicts lethal");
const afterNegation=resolveUnopposed(declare(negated,"S-DS25"));
assert.equal(afterNegation.state.sides.p2.zones.life.length,1,"negated printed Double Strike deals one actual damage");
const granted=layout(opening,{...empty,battle:[{cardId:"S-25",mode:"active"}]},{...empty,life:2});
const grantId=granted.state.sides.p1.zones.battle[0];
addEffect(granted.state,[],{target:grantId,source:grantId,kind:"keyword",value:{name:"Strike",x:2},until:"turn"});
const grantedTurn=policyTurn(granted,"p1",0), rng=policyRng(82601);
assert.ok(grantedTurn.input.observation.you.battle[0].keywords.includes("Strike"));
assert.equal(searchDecision(grantedTurn.input,rng).status,"unsupported","unresolved granted Strike is explicit fallback");
// Hidden twins, complete budget fallback and purity in every newly searched
// window: main, attacker combo, and defender combo.
const main=cases.find((c)=>c.key==="ai-01-own-combo-lethal")!.match;
const offense=declare(main,"S-15");
let defense=cases.find((c)=>c.key==="ai-02-defer-first-defense")!.match;
defense=applyMove(defense,{type:"pass",player:"p1"}).match;
let twins=0;
for(const [match,seat] of [[main,"p1"],[offense,"p1"],[defense,"p2"],[negated,"p1"]] as const) {
  const turn=policyTurn(match,seat,0), before=canonicalJson({match,input:turn.input,rng});
  const result=searchDecision(turn.input,rng);
  assert.equal(result.status,"searched");
  assert.ok(applyDecision(match,turn.key,result.answer).ok);
  for(let salt=1;salt<=8;salt++) {
    const twin=permutedFor(match,seat,salt), shown=policyTurn(twin,seat,0);
    assert.deepEqual(shown.input,turn.input);assert.deepEqual(searchDecision(shown.input,rng),result);twins++;
  }
  for(const options of [{nodes:2},{bytes:1},{stop:()=>"cancelled" as const}]) {
    const stopped=searchDecision(turn.input,rng,options), fallback=localPolicy()(turn.input,rng);
    assert.deepEqual({answer:stopped.answer,rng:stopped.rng},fallback);assert.ok(stopped.nodes<=SEARCH_LIMITS.nodes);
  }
  assert.equal(canonicalJson({match,input:turn.input,rng}),before);
}
console.log(`arena-policy-strategy: 15 measured rows; own paid combo/lethal, Life replenishment, delayed defense and both attack orders; engine negation/grant controls; ${twins} hidden twins, all resource windows bounded/pure`);
