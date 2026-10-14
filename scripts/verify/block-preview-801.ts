/** #801: a Blocker reroute is an engine-backed, pre-combo stakes reading. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { buildSnapshot } from "../../src/lib/arena/snapshot-core";
import type { EngineContext } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const defs = { ...DEFS,
  A25: card("A25", { type: "LEADER", power: 25000, energyCost: null, comboCost: null, comboPower: null, skill: "[Double Strike][Critical]" }),
  B4: card("B4", { type: "BATTLE", power: 4000, skill: "[Blocker]" }),
  B4I: card("B4I", { type: "BATTLE", power: 4000, skill: "[Blocker][Indestructible]" }),
  B4B: card("B4B", { type: "BATTLE", power: 4000, skill: "[Blocker][Barrier]" }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
function blockingState(blocker: "B4" | "B4I" | "B4B"): VmState {
  let state = RULES.createGame(ctx, { seed: 8011, p1: { name: "Attacker", leader: "A25", main: fifty("V1") },
    p2: { name: "Defender", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const moves = [
    { type: "chooseFirst", player: state.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" },
    { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" },
    { type: "charge", player: "p1", card: null },
  ] as const;
  for (const move of moves) state = RULES.apply(ctx, state, move).state as VmState;
  const id = state.sides.p2.zones.hand.shift();
  assert.ok(id);
  state.sides.p2.zones.battle.push(id);
  state.cards[id].cardId = blocker;
  state.cards[id].mode = "active";
  const attack = RULES.legalActions(ctx, state).find((row) => row.action.type === "attack" && row.action.target === state.sides.p2.zones.leader[0])?.action;
  assert.ok(attack);
  state = RULES.apply(ctx, state, attack).state as VmState;
  assert.equal(state.prompt.kind, "blocker");
  return state;
}
function snapshot(state: VmState) {
  return buildSnapshot({ id: 8011, mode: "versus", status: "playing", p1Name: "Attacker", p2Name: "Defender", ctx, state,
    legal: RULES.legalActions(ctx, state), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
    ai: null, viewer: "p2", images: {} });
}
for (const blocker of ["B4", "B4I", "B4B"] as const) {
  const state = blockingState(blocker);
  const before = JSON.stringify(state);
  const snap = snapshot(state);
  const preview = snap.blockPreviews?.find((row) => {
    const action = snap.legal[row.action]?.action;
    return action?.type === "block" && !!action.card;
  });
  assert.ok(preview);
  assert.equal(preview.state, "known");
  assert.equal(preview.battle?.attackPower, 25000);
  assert.equal(preview.battle?.guardPower, 4000);
  assert.equal(preview.battle?.stakes?.target, "battle", "the blocker becomes the guard even when the Leader was the original target");
  assert.equal(preview.battle?.stakes?.lifeDamage, 0, "blocking saves the Leader's life before combo");
  assert.equal(preview.battle?.stakes?.strikeDamage, 2);
  assert.equal(preview.battle?.stakes?.critical, true);
  assert.equal(preview.battle?.stakes?.koPrevented, blocker === "B4I");
  const action = snap.legal[preview.action].action;
  assert.equal(action.type, "block");
  const independent = RULES.previewLegalBlock(ctx, state, action);
  assert.deepEqual(preview.battle, RULES.boardView(ctx, independent.state, "p2", {}).battle,
    "block preview is the independent rules-engine battle view at the pre-combo boundary");
  assert.equal(JSON.stringify(state), before, "projection must not mutate the live battle");
  const hiddenTwin = structuredClone(state);
  hiddenTwin.cards[hiddenTwin.sides.p1.zones.hand[0]].cardId = "BIG";
  assert.deepEqual(snapshot(hiddenTwin).blockPreviews, snap.blockPreviews,
    "the attacker's concealed hand cannot affect the defender's block preview");
}
console.log("#801 block previews: 4k Blocker vs 25k Double Strike/Critical, Barrier, Indestructible, pre-combo engine equality, purity and hidden-hand invariance passed");
