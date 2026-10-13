/** Disposable Main Phase fixture with two fixed-price own activations. */
import assert from "node:assert/strict";
import type { EngineState } from "../../src/lib/arena/engines";
import type { Action } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { zoneOf } from "../../src/lib/arena/engine-state";
import { CTX, IMPL } from "./harness";

CTX.defs["PLAN-READY"] = { ...CTX.defs.V1, id: "PLAN-READY", name: "Plan Resource", skill: "[Activate: Main]{r}: Switch this card to Rest Mode." };
CTX.defs["PLAN-COUNTER"] = { ...CTX.defs.V1, id: "PLAN-COUNTER", name: "Hidden Response", skill: "[Counter: Play] Play this card." };
export const planCtx = CTX;

export function planState(): EngineState {
  const impl = IMPL;
  const fifty = (id: string) => Array.from({ length: 50 }, () => id);
  let state = impl.createGame(planCtx, { seed: 7, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Opponent", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const chooser = (state.prompt as { player: "p1" | "p2" }).player;
  const setup: Action[] = [
    { type: "chooseFirst", player: chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false },
    { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null },
    { type: "endMain", player: "p1" },
    { type: "charge", player: "p2", card: null },
    { type: "endMain", player: "p2" },
    { type: "charge", player: "p1", card: null },
  ];
  for (const action of setup) state = impl.apply(planCtx, state, action).state as VmState;
  assert.equal(state.prompt.kind, "main");
  for (const [id, area] of [["PLAN-READY", "battle"], ["PLAN-READY", "battle"], ["V1", "energy"], ["V1", "energy"]] as const) {
    const card = zoneOf(state, "p1", "deck").find((candidate) => state.cards[candidate].cardId === "V1")!;
    assert.ok(card);
    zoneOf(state, "p1", "deck").splice(zoneOf(state, "p1", "deck").indexOf(card), 1);
    state.cards[card].cardId = id;
    zoneOf(state, "p1", area).push(card);
    state.cards[card].mode = "active";
  }
  return state;
}

export function planActions(state: EngineState): Action[] {
  return zoneOf(state, "p1", "battle").filter((id) => state.cards[id].cardId === "PLAN-READY").slice(0, 2)
    .map((card) => ({ type: "activate", player: "p1", card, skill: 0 }));
}
