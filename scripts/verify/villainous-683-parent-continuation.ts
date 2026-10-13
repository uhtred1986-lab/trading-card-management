/** #683: nested Extra activation with an unfinished invoking parent. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const wish = "[Activate: Main] Choose one- ・Draw 1 card. ・Choose 1 ≪Desire≫ card in your hand with an energy cost less than or equal to your current energy and activate its [Activate: Main] skill. Then draw 2 cards.";
const defs = { ...DEFS,
  P683_CHAIN: card("P683_CHAIN", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, skill: wish }),
  P683_DESIRE: card("P683_DESIRE", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, traits: ["Desire"],
    skill: "[Villainous]<br>[Activate: Main]: Draw 1 card." }),
  P683_TARGET: card("P683_TARGET", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, traits: ["Desire"],
    skill: "[Villainous]<br>[Activate: Main]: Choose 1 of your Battle Cards and place it in its owner's Drop Area. Draw 1 card." }),
  P683_WATCH: card("P683_WATCH", { energyCost: 0, skill: "[Villainous]" }),
  P683_FODDER: card("P683_FODDER", { energyCost: 0, skill: null }),
};
const ctx = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const parent = ctx.scripts.P683_CHAIN.bySkill[0];
assert.ok(parent && parent.unsupported.length === 0, "the invoking parent is compiler-read");
assert.equal(parent.ops[0]?.op, "chooseMode");
if (parent.ops[0]?.op === "chooseMode") {
  assert.deepEqual(parent.ops[0].modes[1]?.ops.map((op) => op.op), ["invokeSkill", "draw"],
    "the chosen branch resumes with two parent draws after the child invocation");
}
assert.deepEqual(ctx.scripts.P683_TARGET.bySkill[10]?.unsupported, [], "the child target choice is compiler-read");
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);

const engines: readonly "rules"[] = ["rules"];
for (const engineName of engines) {
  const engine = RULES;
  let state = engine.createGame(ctx, { seed: 68350,
    p1: { name: "First", leader: "P683_CHAIN", main: fifty("V1") },
    p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") },
  }).state as VmState;
  state = engine.apply(ctx, state, { type: "chooseFirst", player: (state.prompt as { player: PlayerId }).player, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) {
    const action = engine.legalActions(ctx, state)[0]?.action;
    assert.ok(action);
    state = engine.apply(ctx, state, action).state as VmState;
  }
  assert.equal(state.prompt.kind, "main");
  const hand = (state as VmState).sides.p1.zones.hand;
  const desire = hand[0];
  const watch = hand[1];
  assert.ok(desire && watch);
  state.cards[desire].cardId = "P683_DESIRE";
  state.cards[watch].cardId = "P683_WATCH";
  assert.ok(moveCard(state as VmState, loaded.definition, watch, "battle", { owner: "p1" }).ok);
  const leader = (state as VmState).sides.p1.zones.leader[0];
  assert.ok(leader);
  const action = engine.legalActions(ctx, state).find((entry) => entry.action.type === "activate" && entry.action.card === leader)?.action;
  assert.ok(action, `${engineName} offers invoking parent`);
  const started = engine.apply(ctx, state, action);
  assert.equal(started.state.prompt.kind, "chooseMode");
  const savedOffer = JSON.stringify(started.state);
  const otherBranch = engine.apply(ctx, JSON.parse(savedOffer), { type: "chooseMode", player: "p1", index: 0 });
  assert.equal(otherBranch.events.filter((event) => event.type === "draw" && event.player === "p1").length, 1);
  assert.ok(!otherBranch.events.some((event) => event.type === "skill" && event.card === desire),
    "declining the invoking branch does not activate a nested Extra");
  assert.ok(!otherBranch.state.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watch));
  const chooseMode = { type: "chooseMode" as const, player: "p1" as const, index: 1 };
  const invoked = engine.apply(ctx, JSON.parse(savedOffer), chooseMode);
  const repeated = engine.apply(ctx, JSON.parse(savedOffer), chooseMode);
  assert.deepEqual(repeated.events, invoked.events, `${engineName}: reload repeats the same child and parent events`);
  assert.deepEqual(repeated.state, invoked.state);
  assert.equal(invoked.state.prompt.kind, "chooseCards", `${engineName}: Villainous waits on the opponent`);
  assert.equal((invoked.state.prompt as { player: PlayerId }).player, "p2");
  const beforeChoice = invoked.events.filter((event) => event.type === "draw" && event.player === "p1").length;
  assert.equal(beforeChoice, 3,
    `${engineName}: the child's draw and the parent's two remaining draws finish before Villainous resolves`);
  assert.deepEqual(invoked.events.filter((event) => event.type === "skill" && event.card === desire)
    .map((event) => event.type === "skill" ? event.skill : -1), [10], "the nested Desire skill activates once");
  const drop = (invoked.state as VmState).sides.p1.zones.drop;
  assert.ok(drop.includes(desire));
  assert.ok((invoked.state as VmState).programs.some((frame) => frame.card === watch && frame.pendingHookSkill && frame.skillIndex === 0),
    "the individually identified keyword frame survives the opponent choice");
  const candidate = (invoked.state.prompt as { choice: { candidates: string[] } }).choice.candidates[0];
  assert.ok(candidate);
  const choice = { type: "choose" as const, player: "p2" as const, cards: [candidate] };
  const savedChoice = JSON.stringify(invoked.state);
  const chosen = engine.apply(ctx, JSON.parse(savedChoice), choice);
  const repeatedChoice = engine.apply(ctx, JSON.parse(savedChoice), choice);
  assert.deepEqual(repeatedChoice.events, chosen.events, `${engineName}: reload repeats the same payout and parent continuation`);
  assert.deepEqual(repeatedChoice.state, chosen.state);
  assert.equal(chosen.state.prompt.kind, "main");
  const afterChoice = chosen.events.filter((event) => event.type === "draw" && event.player === "p1").length;
  assert.equal(afterChoice, 0, "no parent effect resumes after the keyword choice");
  assert.equal(beforeChoice + afterChoice, 3, "child effect draws one and parent continuation draws two, exactly once");
  assert.ok(((chosen.state as VmState).sides.p2.zones.drop).includes(candidate));
  assert.deepEqual(chosen.state.effects.filter((effect) => effect.kind === "negateSkill" && effect.target === watch).map((effect) => effect.value), [0]);
  assert.deepEqual((chosen.state as VmState).pending, []);
  assert.deepEqual((chosen.state as VmState).programs, []);
  console.log(`#683 nested parent continuation on ${engineName}: child draw, parent draws, keyword choice`);
}

// The child's own target prompt is still inside its effect. Neither the
// parent's trailing draw nor the pending keyword may jump across that choice.
for (const engineName of engines) {
  const engine = RULES;
  let state = engine.createGame(ctx, { seed: 68360,
    p1: { name: "First", leader: "P683_CHAIN", main: fifty("V1") },
    p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") },
  }).state as VmState;
  state = engine.apply(ctx, state, { type: "chooseFirst", player: (state.prompt as { player: PlayerId }).player, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) {
    const action = engine.legalActions(ctx, state)[0]?.action;
    assert.ok(action);
    state = engine.apply(ctx, state, action).state as VmState;
  }
  assert.equal(state.prompt.kind, "main");
  const hand = (state as VmState).sides.p1.zones.hand;
  const desire = hand[0];
  const watch = hand[1];
  const fodder = hand[2];
  assert.ok(desire && watch && fodder);
  state.cards[desire].cardId = "P683_TARGET";
  state.cards[watch].cardId = "P683_WATCH";
  state.cards[fodder].cardId = "P683_FODDER";
  for (const battleCard of [watch, fodder]) {
    assert.ok(moveCard(state as VmState, loaded.definition, battleCard, "battle", { owner: "p1" }).ok);
  }
  const leader = (state as VmState).sides.p1.zones.leader[0];
  assert.ok(leader);
  const parentAction = engine.legalActions(ctx, state).find((entry) => entry.action.type === "activate" && entry.action.card === leader)?.action;
  assert.ok(parentAction);
  const started = engine.apply(ctx, state, parentAction);
  assert.equal(started.state.prompt.kind, "chooseMode");
  const invoked = engine.apply(ctx, JSON.parse(JSON.stringify(started.state)), { type: "chooseMode", player: "p1", index: 1 });
  assert.equal(invoked.state.prompt.kind, "chooseCards", "the child asks which Battle Card to place in Drop");
  assert.equal((invoked.state.prompt as { player: PlayerId }).player, "p1");
  assert.equal(invoked.events.filter((event) => event.type === "draw" && event.player === "p1").length, 0,
    "neither child's draw nor parent's continuation overtakes the child target prompt");
  const childChoice = { type: "choose" as const, player: "p1" as const, cards: [fodder] };
  assert.ok(engine.legalActions(ctx, invoked.state).some((entry) => JSON.stringify(entry.action) === JSON.stringify(childChoice)));
  const afterTarget = engine.apply(ctx, JSON.parse(JSON.stringify(invoked.state)), childChoice);
  assert.equal(afterTarget.state.prompt.kind, "chooseCards", "Villainous follows child and parent effects");
  assert.equal((afterTarget.state.prompt as { player: PlayerId }).player, "p2");
  assert.equal(afterTarget.events.filter((event) => event.type === "draw" && event.player === "p1").length, 3);
  assert.ok(((afterTarget.state as VmState).sides.p1.zones.drop).includes(fodder));
  const opponentCard = (afterTarget.state.prompt as { choice: { candidates: string[] } }).choice.candidates[0];
  assert.ok(opponentCard);
  const resolved = engine.apply(ctx, JSON.parse(JSON.stringify(afterTarget.state)), { type: "choose", player: "p2", cards: [opponentCard] });
  assert.equal(resolved.state.prompt.kind, "main");
  assert.ok(((resolved.state as VmState).sides.p2.zones.drop).includes(opponentCard));
  assert.deepEqual(resolved.state.effects.filter((effect) => effect.kind === "negateSkill" && effect.target === watch).map((effect) => effect.value), [0]);
  console.log(`#683 nested child target on ${engineName}: target choice, child effect, parent continuation, keyword choice`);
}
