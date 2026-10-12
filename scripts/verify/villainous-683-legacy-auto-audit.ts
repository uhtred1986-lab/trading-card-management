/** Focused legacy proof for #683: legally triggered Extra Autos. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { move } from "../../src/lib/arena/engine/state";
import type { GameState, PlayerId } from "../../src/lib/arena/types";

const legacy = engineFor("legacy");
DEFS.V683_LEGACY_FIELD = card("V683_LEGACY_FIELD", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null,
  skill: "[Field]<br>[Heroic]<br>[Auto] When this card is placed in a Battle Area, draw 1 card." });
DEFS.V683_LEGACY_PAID = card("V683_LEGACY_PAID", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null,
  skill: "[Field]<br>[Heroic]<br>[Auto] {r}: When this card is placed in a Battle Area, draw 1 card." });
DEFS.V683_LEGACY_VILLAIN = card("V683_LEGACY_VILLAIN", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null,
  skill: "[Field]<br>[Villainous]<br>[Auto] When this card is placed in a Battle Area, draw 1 card." });
DEFS.V683_LEGACY_MAIN = card("V683_LEGACY_MAIN", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null,
  skill: "[Field]<br>[Heroic]<br>[Activate: Main]: Draw 1 card." });

function main(seed: number): GameState {
  let s = legacy.createGame(CTX, { seed, p1: { name: "First", leader: "L-RED", main: fifty("V1") },
    p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as GameState;
  s = legacy.apply(CTX, s, { type: "chooseFirst", player: (s.prompt as { player: PlayerId }).player, first: "p1" }).state as GameState;
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) {
    const next = legacy.legalActions(CTX, s)[0]?.action;
    assert.ok(next);
    s = legacy.apply(CTX, s, next).state as GameState;
  }
  assert.equal(s.prompt.kind, "main");
  return s;
}

function stage(s: GameState, id: string, area: "hand" | "energy" = "hand"): string {
  const physical = s.players.p1.hand.find((candidate) => !s.cards[candidate].cardId.startsWith("V683_LEGACY_"));
  assert.ok(physical);
  s.cards[physical].cardId = id;
  if (area !== "hand") move(CTX, s, [], physical, area, "p1", { reason: "effect" });
  return physical;
}

function activateField(s: GameState, cardId: string) {
  const card = stage(s, cardId);
  const action = legacy.legalActions(CTX, s).find((entry) => entry.action.type === "activate" && entry.action.card === card)?.action;
  assert.ok(action, "the Field activation must be legal from hand");
  return { card, applied: legacy.apply(CTX, s, action) };
}

{
  const { card, applied } = activateField(main(68341), "V683_LEGACY_FIELD");
  const state = applied.state as GameState;
  assert.ok(state.players.p1.battle.includes(card));
  assert.deepEqual(applied.events.filter((event) => event.type === "skill" && event.card === card).map((event) => event.type === "skill" ? event.skill : -1), [0, 20]);
  const autoEvent = applied.events.findIndex((event) => event.type === "skill" && event.card === card && event.skill === 20);
  const drawEvents = applied.events.flatMap((event, index) => event.type === "draw" && event.player === "p1" ? [index] : []);
  const spendEvent = applied.events.findIndex((event) => event.type === "effect" && event.effect.kind === "negateSkill" && event.effect.target === card && event.effect.value === 10);
  assert.equal(drawEvents.length, 2, "Auto effect and own Heroic each draw once");
  assert.ok(autoEvent < drawEvents[0] && drawEvents[0] < drawEvents[1] && drawEvents[1] < spendEvent,
    "Auto effect resolves before its keyword payout and individual spend");
  assert.deepEqual(state.effects.filter((effect) => effect.kind === "negateSkill" && effect.target === card).map((effect) => effect.value), [10]);
  assert.deepEqual(state.pending, [], "own keyword payout does not recurse");
  console.log("legacy legal Field arrival: free Auto effect then own Heroic, spent exactly once");
}

for (const pay of [false, true]) {
  const s = main(pay ? 68342 : 68343);
  stage(s, "V1", "energy");
  const { card, applied } = activateField(s, "V683_LEGACY_PAID");
  assert.equal(applied.state.prompt.kind, "optionalCost", "the native Auto offers its own price");
  const after = legacy.apply(CTX, JSON.parse(JSON.stringify(applied.state)), { type: "optionalCost", player: "p1", pay });
  const state = after.state as GameState;
  assert.equal(state.prompt.kind, "main");
  assert.deepEqual([...applied.events, ...after.events].filter((event) => event.type === "skill" && event.card === card)
    .map((event) => event.type === "skill" ? event.skill : -1), pay ? [0, 20] : [0]);
  assert.equal(after.events.filter((event) => event.type === "draw" && event.player === "p1").length, pay ? 2 : 0);
  assert.deepEqual(state.effects.filter((effect) => effect.kind === "negateSkill" && effect.target === card).map((effect) => effect.value), pay ? [10] : []);
  assert.deepEqual(state.pending, []);
  if (pay) {
    const rested = after.events.findIndex((event) => event.type === "mode" && event.mode === "rest");
    const skill = after.events.findIndex((event) => event.type === "skill" && event.card === card && event.skill === 20);
    const drawn = after.events.findIndex((event) => event.type === "draw" && event.player === "p1");
    assert.ok(rested >= 0 && rested < skill && skill < drawn, "paid energy precedes the Auto skill event and effect");
  }
  console.log(`legacy native Auto ${pay ? "paid after reload: effect and Heroic exactly once" : "declined: no activation or payout"}`);
}

{
  const s = main(68344);
  for (const energy of s.players.p1.energy) s.cards[energy].mode = "rest";
  const { card, applied } = activateField(s, "V683_LEGACY_PAID");
  assert.equal(applied.state.prompt.kind, "main", "unaffordable Auto never offers an optional price");
  assert.deepEqual(applied.events.filter((event) => event.type === "skill" && event.card === card)
    .map((event) => event.type === "skill" ? event.skill : -1), [0]);
  assert.deepEqual((applied.state as GameState).effects.filter((effect) => effect.kind === "negateSkill" && effect.target === card), []);
  console.log("legacy unaffordable Auto: no activation or keyword payout");
}

{
  const { card, applied } = activateField(main(68345), "V683_LEGACY_VILLAIN");
  const state = applied.state as GameState;
  assert.equal(state.prompt.kind, "chooseCards", "own Villainous waits until the Auto draw has finished");
  assert.equal(state.prompt.player, "p2");
  assert.equal(applied.events.filter((event) => event.type === "draw" && event.player === "p1").length, 1);
  const candidate = state.prompt.choice.candidates[0];
  assert.ok(candidate);
  const chosen = legacy.apply(CTX, JSON.parse(JSON.stringify(state)), { type: "choose", player: "p2", cards: [candidate] });
  const finalState = chosen.state as GameState;
  assert.ok(finalState.players.p2.drop.includes(candidate));
  assert.deepEqual(finalState.effects.filter((effect) => effect.kind === "negateSkill" && effect.target === card).map((effect) => effect.value), [10]);
  assert.deepEqual(finalState.pending, []);
  console.log("legacy legal Field arrival: Auto effect then own Villainous choice and spend");
}

{
  const { card, applied } = activateField(main(68346), "V683_LEGACY_MAIN");
  const state = applied.state as GameState;
  const action = legacy.legalActions(CTX, state).find((entry) => entry.action.type === "activate" && entry.action.card === card && entry.action.skill === 20)?.action;
  assert.ok(action, "the in-play Field Extra offers its own Main skill");
  const started = legacy.apply(CTX, state, action);
  assert.equal(started.state.prompt.kind, "main");
  assert.equal(started.events.filter((event) => event.type === "draw" && event.player === "p1").length, 2);
  assert.deepEqual((started.state as GameState).effects.filter((effect) => effect.kind === "negateSkill" && effect.target === card).map((effect) => effect.value), [10]);
  console.log("legacy in-play Extra Main: own Heroic pays once");
}
