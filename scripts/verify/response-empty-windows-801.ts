/** #801: empty battle response windows come from the engine and respect hand privacy. */
import assert from "node:assert/strict";
import { CTX, DEFS, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import type { PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

function atMain(): VmState {
  let state = RULES.createGame(CTX, {
    seed: 801,
    p1: { name: "You", leader: "L-RED", main: fifty("V1") },
    p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") },
  }).state as VmState;
  const actions = [
    { type: "chooseFirst", player: state.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false },
    { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null },
    { type: "endMain", player: "p1" },
    { type: "charge", player: "p2", card: null },
    { type: "endMain", player: "p2" },
    { type: "charge", player: "p1", card: null },
  ] as const;
  for (const action of actions) state = RULES.apply(CTX, state, action).state as VmState;
  assert.equal(state.prompt.kind, "main");
  return state;
}

function stage(state: VmState, player: PlayerId, cardId: string, area: "battle"): string {
  const base = player === "p1" ? "V1" : "V-BLUE";
  const id = state.sides[player].zones.deck.find((card) => state.cards[card].cardId === base);
  assert.ok(id, `fixture deck has a ${base}`);
  state.sides[player].zones.deck = state.sides[player].zones.deck.filter((card) => card !== id);
  state.cards[id!].cardId = cardId;
  state.sides[player].zones[area].push(id!);
  state.cards[id!].mode = "active";
  return id!;
}

function attack(state: VmState): VmState {
  return RULES.apply(CTX, state, {
    type: "attack", player: "p1", attacker: state.sides.p1.zones.leader[0], target: state.sides.p2.zones.leader[0],
  }).state as VmState;
}

// With a public [Blocker] available, an empty Counter window is carried to the
// real defender prompt. Only the defender may learn that the attack found no
// Counter in their hand.
{
  const state = atMain();
  stage(state, "p2", "BLOCKER", "battle");
  const battle = attack(state);
  assert.equal(battle.prompt.kind, "blocker");
  assert.deepEqual(battle.battle?.emptyResponses, ["counter"]);
  const attackerView = RULES.boardView(CTX, battle, "p1", {}).battle;
  const defenderView = RULES.boardView(CTX, battle, "p2", {}).battle;
  assert.ok(attackerView);
  assert.ok(defenderView);
  assert.ok(!attackerView.emptyResponses?.includes("counter"), "the attacker must not learn the defender's hand has no Counter");
  assert.ok(defenderView.emptyResponses?.includes("counter"), "the defender sees the empty Counter window");
}

// With no [Blocker] on the board, the engine records that public empty window
// before it asks the offense-side Combo question.
{
  const battle = attack(atMain());
  assert.equal(battle.prompt.kind, "combo");
  assert.equal((battle.prompt as { side: string }).side, "offense");
  assert.deepEqual(battle.battle?.emptyResponses, ["counter", "blocker"]);
  for (const viewer of ["p1", "p2"] as const) {
    assert.ok(RULES.boardView(CTX, battle, viewer, {}).battle?.emptyResponses?.includes("blocker"), "Blocker availability is public board information");
  }
}

// The typed projection filters each private Combo-empty marker to the player
// who owned that response window, while preserving the public Blocker marker.
{
  const battle = attack(atMain());
  assert.ok(battle.battle);
  battle.battle!.emptyResponses = ["counter", "blocker", "offenseCombo", "defenseCombo"];
  const attacker = RULES.boardView(CTX, battle, "p1", {}).battle!;
  const defender = RULES.boardView(CTX, battle, "p2", {}).battle!;
  assert.deepEqual(attacker.emptyResponses, ["blocker", "offenseCombo"]);
  assert.deepEqual(defender.emptyResponses, ["counter", "blocker", "defenseCombo"]);
}

// A [Counter] in the defender's hand that cannot answer (no energy to pay it) leaves the window empty, as
// before; the defender — and only the defender — is told which card was passed over and why, since no
// counter prompt ever named it (bug report of 11 Nov 2026: "I can't play counters").
{
  const state = atMain();
  stage(state, "p2", "BLOCKER", "battle");
  const counter = state.sides.p2.zones.deck.find((card) => state.cards[card].cardId === "V-BLUE")!;
  state.sides.p2.zones.deck = state.sides.p2.zones.deck.filter((card) => card !== counter);
  state.cards[counter].cardId = "E-NEGATE";
  state.sides.p2.zones.hand.push(counter);
  assert.equal(state.sides.p2.zones.energy.filter((card) => state.cards[card].mode === "active").length, 0, "the defender has no ready energy");
  const battle = attack(state);
  assert.equal(battle.prompt.kind, "blocker");
  assert.deepEqual(battle.battle?.emptyResponses, ["counter"]);
  const attacker = RULES.boardView(CTX, battle, "p1", {}).battle!;
  const defender = RULES.boardView(CTX, battle, "p2", {}).battle!;
  assert.equal(attacker.counterRefusals, undefined, "the attacker must not learn which Counter the defender holds");
  assert.deepEqual(defender.counterRefusals?.map((row) => row.card), [counter], "the defender is told which Counter was passed over");
  assert.ok(defender.counterRefusals![0].why.some((why) => why.kind === "energy" || why.kind === "energyColour"), `the reason is the energy: ${JSON.stringify(defender.counterRefusals![0].why)}`);
}

// With no Counter in hand there is nothing to explain.
{
  const state = atMain();
  stage(state, "p2", "BLOCKER", "battle");
  const battle = attack(state);
  assert.equal(RULES.boardView(CTX, battle, "p2", {}).battle?.counterRefusals, undefined);
}

assert.ok(DEFS.BLOCKER, "the fixture includes the engine-readable Blocker keyword");
console.log("#801 empty response windows: engine evidence and viewer privacy passed");
