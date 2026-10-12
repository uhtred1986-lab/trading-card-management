/** #683: nested Extra activation with an unfinished invoking parent. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { move } from "../../src/lib/arena/engine/state";
import type { GameState, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const wish = "[Activate: Main] Choose one- ・Draw 1 card. ・Choose 1 ≪Desire≫ card in your hand with an energy cost less than or equal to your current energy and activate its [Activate: Main] skill. Then draw 2 cards.";
const defs = { ...DEFS,
  P683_CHAIN: card("P683_CHAIN", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, skill: wish }),
  P683_DESIRE: card("P683_DESIRE", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, traits: ["Desire"],
    skill: "[Villainous]<br>[Activate: Main]: Draw 1 card." }),
  P683_WATCH: card("P683_WATCH", { energyCost: 0, skill: "[Villainous]" }),
};
const ctx = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const parent = ctx.scripts.P683_CHAIN.bySkill[0];
assert.ok(parent && parent.unsupported.length === 0, "the invoking parent is compiler-read");
assert.equal(parent.ops[0]?.op, "chooseMode");
if (parent.ops[0]?.op === "chooseMode") {
  assert.deepEqual(parent.ops[0].modes[1]?.ops.map((op) => op.op), ["invokeSkill", "draw"],
    "the chosen branch resumes with two parent draws after the child invocation");
}
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);

for (const engineName of ["rules", "legacy"] as const) {
  const engine = engineFor(engineName);
  let state = engine.createGame(ctx, { seed: 68350 + Number(engineName === "legacy"),
    p1: { name: "First", leader: "P683_CHAIN", main: fifty("V1") },
    p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") },
  }).state as VmState | GameState;
  state = engine.apply(ctx, state, { type: "chooseFirst", player: (state.prompt as { player: PlayerId }).player, first: "p1" }).state as VmState | GameState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) {
    const action = engine.legalActions(ctx, state)[0]?.action;
    assert.ok(action);
    state = engine.apply(ctx, state, action).state as VmState | GameState;
  }
  assert.equal(state.prompt.kind, "main");
  const hand = engineName === "rules" ? (state as VmState).sides.p1.zones.hand : (state as GameState).players.p1.hand;
  const desire = hand[0];
  const watch = hand[1];
  assert.ok(desire && watch);
  state.cards[desire].cardId = "P683_DESIRE";
  state.cards[watch].cardId = "P683_WATCH";
  if (engineName === "rules") assert.ok(moveCard(state as VmState, loaded.definition, watch, "battle", { owner: "p1" }).ok);
  else move(ctx, state as GameState, [], watch, "battle", "p1", { reason: "effect" });
  const leader = engineName === "rules" ? (state as VmState).sides.p1.zones.leader[0] : (state as GameState).players.p1.leader;
  assert.ok(leader);
  const action = engine.legalActions(ctx, state).find((entry) => entry.action.type === "activate" && entry.action.card === leader)?.action;
  assert.ok(action, `${engineName} offers invoking parent`);
  const started = engine.apply(ctx, state, action);
  assert.equal(started.state.prompt.kind, "chooseMode");
  const savedOffer = JSON.stringify(started.state);
  const chooseMode = { type: "chooseMode" as const, player: "p1" as const, index: 1 };
  const invoked = engine.apply(ctx, JSON.parse(savedOffer), chooseMode);
  const repeated = engine.apply(ctx, JSON.parse(savedOffer), chooseMode);
  assert.deepEqual(repeated.events, invoked.events, `${engineName}: reload repeats the same child and parent events`);
  assert.deepEqual(repeated.state, invoked.state);
  assert.equal(invoked.state.prompt.kind, "chooseCards", `${engineName}: Villainous waits on the opponent`);
  assert.equal((invoked.state.prompt as { player: PlayerId }).player, "p2");
  const beforeChoice = invoked.events.filter((event) => event.type === "draw" && event.player === "p1").length;
  assert.equal(beforeChoice, engineName === "rules" ? 3 : 1,
    `${engineName}: observable order differs before the pending Villainous choice`);
  assert.deepEqual(invoked.events.filter((event) => event.type === "skill" && event.card === desire)
    .map((event) => event.type === "skill" ? event.skill : -1), [10], "the nested Desire skill activates once");
  const drop = engineName === "rules" ? (invoked.state as VmState).sides.p1.zones.drop : (invoked.state as GameState).players.p1.drop;
  assert.ok(drop.includes(desire));
  if (engineName === "rules") {
    assert.ok((invoked.state as VmState).programs.some((frame) => frame.card === watch && frame.pendingHookSkill && frame.skillIndex === 0),
      "the individually identified keyword frame survives the opponent choice");
  } else {
    assert.ok((invoked.state as GameState).flow.some((step) => step.op === "script.step"),
      "the parent continuation remains queued behind the legacy keyword choice");
  }
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
  assert.equal(afterChoice, engineName === "rules" ? 0 : 2);
  assert.equal(beforeChoice + afterChoice, 3, "child effect draws one and parent continuation draws two, exactly once");
  assert.ok((engineName === "rules" ? (chosen.state as VmState).sides.p2.zones.drop : (chosen.state as GameState).players.p2.drop).includes(candidate));
  assert.deepEqual(chosen.state.effects.filter((effect) => effect.kind === "negateSkill" && effect.target === watch).map((effect) => effect.value), [0]);
  assert.deepEqual((chosen.state as VmState | GameState).pending, []);
  if (engineName === "rules") assert.deepEqual((chosen.state as VmState).programs, []);
  console.log(`#683 nested parent continuation observed on ${engineName}: child draw, ${engineName === "rules" ? "parent draws, keyword choice" : "keyword choice, parent draws"}`);
}
