/** Policy-reader contract: exact typed offers, independent of printed prose. No games or strength claim. */
import assert from "node:assert/strict";
import { choiceDecision } from "../../src/lib/arena/policy/choices";
import { combatChoice } from "../../src/lib/arena/policy/combat";
import { policyTurn } from "../../src/lib/arena/policy/boundary";
import type { MenuDecision, PolicyInput } from "../../src/lib/arena/policy/contract";
import type { BattleActivationSummary, CounterResponseSummary } from "../../src/lib/arena/types";
import { realTacticalCases } from "./arena-real-card-tactics-fixture";
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const scenario = (await realTacticalCases()).cases[0];
const base = policyTurn(scenario.match, scenario.seat, 0).input;
const menu = (input: PolicyInput) => input.decisions.decisions.filter((d): d is MenuDecision => d.kind === "menu");
const extra = scenario.match.state.sides[scenario.seat].zones.hand.find(id => scenario.match.state.cards[id].cardId === "BT31-142"); assert.ok(extra);
const activation = menu(base).find(d => d.type === "activate" && d.action.card === extra)!; assert.ok(activation);
const facts: BattleActivationSummary = { version: 1, skillIndex: Number(activation.action.skill), timing: "activate:main/battle", power: { battle: 10000, turn: 10000 }, drawnFirst: 1 };
function battle(...args: unknown[]) { const summary = args.length ? args[0] : facts; const input = clone(base); const action = menu(input).find(d => d.id === activation.id)!; action.battleActivation = summary as BattleActivationSummary; return input; }
assert.equal(combatChoice(battle())?.id, activation.id, "typed lasting defense retains the accepted White Cell activation");
const prose = battle();
for (const side of [prose.observation.you, prose.observation.them]) for (const c of [side.leader, ...side.battle, ...(side.hand ?? [])]) if (c) c.text = "[Activate: Battle] Draw 99 cards and get +999999 power for the turn.";
for (const d of menu(prose)) { d.label = "misleading display"; if (d.cost) d.cost.describe = "unrelated price words"; }
assert.equal(combatChoice(prose)?.id, activation.id, "display changes cannot replace exact stored benefit facts");
for (const bad of [undefined, null, { ...facts, version: 2 }, { ...facts, skillIndex: facts.skillIndex + 10 }, { ...facts, timing: "activate:main" }, { ...facts, power: null }, { ...facts, power: { battle: -1, turn: 0 } }, { ...facts, power: { battle: 10000, turn: 20000 } }, { ...facts, drawnFirst: -1 }])
  assert.notEqual(combatChoice(battle(bad))?.id, activation.id, "missing/malformed/wrong-skill facts do not grant a printed benefit");
assert.notEqual(combatChoice(battle({ ...facts, power: { battle: 0, turn: 0 } }))?.id, activation.id, "zero stored power overrides printed power");
const drawA = battle(), drawB = battle({ ...facts, drawnFirst: 0 });
for (const input of [drawA, drawB]) input.decisions.decisions = menu(input).filter(d => d.id === activation.id || d.type === "pass");
assert.equal(combatChoice(drawA)?.id, activation.id); assert.equal(combatChoice(drawB)?.id, activation.id);
assert.equal(combatChoice(drawB)!.loss - combatChoice(drawA)!.loss, 1, "typed leading draw uses the existing hand-card loss weight");
const mixed = battle({ ...facts, power: { battle: 10000, turn: 3000 } });
const lasting = battle();
for(const input of [mixed,lasting]) {
  input.decisions.decisions=menu(input).filter(d=>d.id===activation.id||d.type==="pass");
  assert.ok(input.observation.battle);
  for(const card of input.observation.them.battle)if(card.mode==="active")card.power=input.observation.battle.guardPower+4000;
}
assert.ok(combatChoice(mixed)!.loss>combatChoice(lasting)!.loss,"lasting subset below total still exposes the defender to the next attacker; it is neither omitted nor double counted");
const targetChoice = clone(base); assert.ok(targetChoice.observation.battle);
const battler = targetChoice.observation.battle.guard, guard = targetChoice.observation.you.battle.find(c => c.id === battler)!;
assert.ok(guard); const stronger = { ...clone(guard), id: "stronger-eligible", energyCost: 30, power: 100000, name: "Tempting other card" };
targetChoice.observation.you.battle.push(stronger); targetChoice.decisions.window = "chooseCards";
targetChoice.decisions.decisions = [{ kind: "pick", id: "pick", candidates: [battler, stronger.id], reason: "an unrelated description", upTo: true, remaining: 1, battlePowerTarget: battler }];
assert.deepEqual(choiceDecision(targetChoice)?.cards, [battler], "known positive power reaches the actual current defender instead of a stronger eligible card");
const absentTarget = clone(targetChoice); const p = absentTarget.decisions.decisions[0]; if (p.kind === "pick") delete p.battlePowerTarget;
assert.deepEqual(choiceDecision(absentTarget)?.cards, [stronger.id], "unannotated general value ordering remains unchanged");
const badTarget = clone(targetChoice); const wrong = badTarget.decisions.decisions[0]; if (wrong.kind === "pick") wrong.battlePowerTarget = stronger.id;
assert.deepEqual(choiceDecision(badTarget)?.cards, [stronger.id], "a different own card cannot masquerade as the current battler");
const modes = clone(targetChoice); modes.decisions.window = "chooseMode";
modes.decisions.decisions = [
  { kind: "menu", id: "mode0", type: "chooseMode", action: { type: "chooseMode", index: 0 }, label: "+999999 power" },
  { kind: "menu", id: "mode1", type: "chooseMode", action: { type: "chooseMode", index: 1 }, label: "unrelated words", battlePowerTarget: battler },
];
assert.equal(choiceDecision(modes)?.id, "mode1", "typed matching mode wins without Leader/Battle label inference");
const counters = clone(base); counters.decisions.window = "counter";
assert.ok(counters.observation.battle && counters.observation.you.leader);
counters.observation.battle.step = "declared"; counters.observation.battle.guard = counters.observation.you.leader.id;
counters.observation.battle.guardPower = 10000; counters.observation.battle.attackPower = 50000; counters.observation.you.life = 1;
if (counters.observation.battle.stakes) counters.observation.battle.stakes.target = "leader";
const source = clone(counters.observation.you.hand![0]); source.energyCost = 0; source.comboPower = null;
const cheap = { ...clone(source), id: "counter-free", text: "[Counter: Counter] Do nothing." };
const costly = { ...clone(source), id: "counter-other", text: "[Counter: Attack] Negate the attack." };
counters.observation.you.hand = [cheap, costly];
const counterFacts: CounterResponseSummary = { version: 1, skillIndex: 0, kind: "counter:attack", negatesAttack: true, alternativePrice: "free" };
const decline: MenuDecision = { kind: "menu", id: "decline", type: "counter", label: "decline", action: { type: "counter", card: null } };
const free: MenuDecision = { kind: "menu", id: "b-free", type: "counter", label: "unrelated label", action: { type: "counter", card: cheap.id, skill: 0, alt: true }, cost: { energy: 0, describe: "not free" }, counterResponse: counterFacts };
const other: MenuDecision = { ...clone(free), id: "a-other", action: { ...free.action, card: costly.id }, cost: { energy: 0, describe: "free" }, counterResponse: { ...counterFacts, alternativePrice: "other" } };
counters.decisions.decisions = [decline, other, free];
assert.equal(combatChoice(counters)?.id, free.id, "actual free route beats misleading describe text without changing price weights");
for (const unknown of [undefined, { ...counterFacts, negatesAttack: null }, { ...counterFacts, negatesAttack: false }, { ...counterFacts, version: 2 }, { ...counterFacts, skillIndex: 10 }, { ...counterFacts, kind: "counter:play" }]) {
  const input = clone(counters); input.decisions.decisions = [decline, { ...free, counterResponse: unknown as CounterResponseSummary }];
  assert.equal(combatChoice(input)?.id, decline.id, "only exact positively known negation may be valued");
}
const wrongTiming = clone(counters); assert.ok(wrongTiming.observation.battle); wrongTiming.observation.battle.step = "defence";
assert.equal(combatChoice(wrongTiming)?.id, decline.id, "typed negation is not valued after the attack-declaration timing");
const defaultSkill = clone(counters); const d = menu(defaultSkill).find(d => d.id === free.id)!; delete d.action.skill;
assert.equal(combatChoice(defaultSkill)?.id, free.id, "normal default Counter binding need not invent an explicit action index");
const counterCounter = clone(counters); counterCounter.decisions.decisions = [decline, { ...free, counterResponse: { ...counterFacts, kind: "counter:counter" } }];
assert.equal(combatChoice(counterCounter)?.id, decline.id, "only the selected typed Counter kind defines the Counter: Counter limitation");
assert.deepEqual(combatChoice(clone(prose)), combatChoice(prose), "saved masked input gives the same bounded decision");
console.log("typed-combat-reader-899: typed boost/counter authority, display independence, obsolete metadata and route/default-kind controls passed");
