/**
 * Issue #746: [Once per turn] starts again when a copy changes area (3-1-4),
 * on the rules engine; [Limit X] (counted on the master, 22-44-3) does not.
 *
 *   3-1-4   a card moved to another area "is treated as a new card in a new
 *           area" (docs/rules/rulemanual.txt).
 *   3-1-4-1 Battle/Unison -> Battle/Unison/Combo carries what was on the card;
 *   3-1-4-2 so does Combo -> Battle. The manual does not say a used
 *           [Once per turn] is one of "the effects applied to the card"; the
 *           engine reads it as carried on those moves (a judgement call, noted
 *           in the glossary).
 *   22-11-3 [Once per turn] is counted per copy; 22-44-3 [Limit X] across copies.
 */
import assert from "node:assert/strict";
import type { VmState } from "../../src/lib/arena/vm/state";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import type { Action, CardDef, PlayerId } from "../../src/lib/arena/types";
import { CTX, DEFS, card, fifty } from "./harness";

function add(id: string, def: Partial<CardDef>): void {
  DEFS[id] = card(id, def);
}
add("R746-ONCE", { type: "BATTLE", colors: ["Red"], energyCost: 0, skill: "[Activate: Main][Once per turn] Draw 1 card." });
add("R746-LIMIT", { type: "BATTLE", colors: ["Red"], energyCost: 0, skill: "[Activate: Main][Limit 1] Draw 1 card." });

const loaded = rulesetFor("dbs");
assert.ok(loaded.ok, "the DBS ruleset should load");
const DBS = loaded.definition;
const rules = RULES;
const deck = { seed: 746, p1: { name: "P1", leader: "L-RED", main: fifty("V1") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") } };

async function main(): Promise<void> {
  try {
    const { moveCard } = await import("../../src/lib/arena/vm/zones");

    type Game = { get: () => VmState; set: (s: VmState) => void; apply: (a: Action) => void };
    function game(): Game {
      let state = rules.createGame(CTX, deck).state as VmState;
      const g: Game = { get: () => state, set: (s) => { state = s; }, apply: (a) => { state = rules.apply(CTX, state, a).state as VmState; } };
      g.apply({ type: "chooseFirst", player: (state.prompt as { player: PlayerId }).player, first: "p1" });
      g.apply({ type: "mulligan", player: "p1", redraw: false });
      g.apply({ type: "mulligan", player: "p2", redraw: false });
      g.apply({ type: "charge", player: "p1", card: null });
      assert.equal(state.prompt.kind, "main");
      return g;
    }
    function stage(state: VmState, player: PlayerId, cardId: string, area: "battle" | "unison" | "hand"): string {
      const id = state.sides[player].zones.deck[0];
      state.cards[id].cardId = cardId;
      const moved = moveCard(state, DBS, id, area, { owner: player });
      assert.ok(moved.ok, `could not stage ${cardId}`);
      state.pending = [];
      return id;
    }
    const mainOf = (s: VmState): PlayerId | null => (s.prompt.kind === "main" ? (s.prompt as { player: PlayerId }).player : null);
    /** Answer whatever is asked (paying an optional price, taking the first card) until `player`'s Main Phase. */
    function settle(g: Game, player: PlayerId, prefer?: (a: Action) => boolean): void {
      for (let i = 0; i < 30 && mainOf(g.get()) !== player; i++) {
        const options = rules.legalActions(CTX, g.get());
        const pick = (prefer && options.find(({ action }) => prefer(action))) ?? options.find(({ action }) => action.type === "optionalCost") ?? options.find(({ action }) => action.type !== "concede");
        assert.ok(pick, `stopped at ${g.get().prompt.kind}`);
        g.apply(pick.action.type === "optionalCost" ? { ...pick.action, pay: true } : pick.action);
      }
      assert.equal(mainOf(g.get()), player, `back at ${player}'s Main Phase`);
    }
    /** Pass turns until `player`'s next Main Phase. */
    function nextTurnOf(g: Game, player: PlayerId): void {
      const from = g.get().turn;
      for (let i = 0; i < 40 && !(mainOf(g.get()) === player && g.get().turn > from); i++) {
        const options = rules.legalActions(CTX, g.get());
        const pick = options.find(({ action }) => action.type === "endMain") ?? options.find(({ action }) => action.type === "charge") ?? options.find(({ action }) => action.type !== "concede");
        assert.ok(pick, `stopped at ${g.get().prompt.kind}`);
        g.apply(pick.action);
      }
      assert.ok(mainOf(g.get()) === player && g.get().turn > from, `reached ${player}'s next Main Phase`);
    }
    const offered = (s: VmState, id: string) => rules.legalActions(CTX, s).find(({ action }) => action.type === "activate" && action.card === id);
    const limitRow = (s: VmState, viewer: PlayerId, id: string, skillIndex: number) => {
      const snap = buildSnapshot({ id: 746, mode: "versus", status: "playing", p1Name: "P1", p2Name: "P2", ctx: CTX, state: s, legal: rules.legalActions(CTX, s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
      const side = viewer === "p1" ? snap.view.you : snap.view.them;
      return side.battle.find((v) => v.id === id)?.abilities?.find((a) => a.skillIndex === skillIndex)?.limit;
    };

    const move = (g: Game, id: string, area: string): void => {
      const r = moveCard(g.get(), DBS, id, area, { owner: "p1" });
      assert.ok(r.ok, `could not move ${id} to ${area}`);
      g.get().pending = [];
    };
    const activateLine = (g: Game, id: string): void => { g.apply(offered(g.get(), id)!.action); settle(g, "p1"); };
    const reload = (g: Game): void => g.set(JSON.parse(JSON.stringify(g.get())) as VmState);

    // 1. [Once per turn]: use, leave play and come back the same turn -> usable again.
    {
      const g = game();
      const a = stage(g.get(), "p1", "R746-ONCE", "battle");
      const b = stage(g.get(), "p1", "R746-ONCE", "battle");
      activateLine(g, a);
      assert.equal(offered(g.get(), a), undefined, "spent after use");
      assert.ok(offered(g.get(), b), "the other copy keeps its own once (22-11-3)");
      for (const viewer of ["p1", "p2"] as PlayerId[]) assert.deepEqual(limitRow(g.get(), viewer, a, 0), { max: 1, used: 1, remaining: 0 }, `${viewer} sees it spent`);
      reload(g);
      assert.equal(offered(g.get(), a), undefined, "still spent after a reload (same copy, not moved)");
      move(g, a, "drop");
      move(g, a, "battle");
      assert.deepEqual(g.get().cards[a].usedThisTurn, [], "3-1-4: a new card has no use");
      assert.ok(offered(g.get(), a), "usable again after leaving and re-entering play");
      for (const viewer of ["p1", "p2"] as PlayerId[]) assert.deepEqual(limitRow(g.get(), viewer, a, 0), { max: 1, used: 0, remaining: 1 }, `${viewer} sees it fresh`);
      reload(g);
      assert.ok(offered(g.get(), a), "fresh after a reload mid-turn");
      activateLine(g, a);
      assert.equal(offered(g.get(), a), undefined, "and spent again by the second use");
      reload(g);
      assert.equal(offered(g.get(), a), undefined, "second use survives a reload");
      move(g, a, "hand");
      move(g, a, "battle");
      assert.ok(offered(g.get(), a), "battle -> hand -> battle resets as well");
    }

    // 2. Moves that 3-1-4-1 / 3-1-4-2 carry keep the use; others reset it.
    {
      const g = game();
      const a = stage(g.get(), "p1", "R746-ONCE", "battle");
      activateLine(g, a);
      move(g, a, "combo");
      assert.deepEqual(g.get().cards[a].usedThisTurn, [0], "3-1-4-1: Battle -> Combo carries the use");
      move(g, a, "battle");
      assert.deepEqual(g.get().cards[a].usedThisTurn, [0], "3-1-4-2: Combo -> Battle carries the use");
      move(g, a, "combo");
      move(g, a, "drop");
      assert.deepEqual(g.get().cards[a].usedThisTurn, [], "Combo -> Drop is a new card");
    }

    // 3. [Limit 1]: leaving and re-entering play does not free it (22-44-3), on either copy.
    {
      const g = game();
      const a = stage(g.get(), "p1", "R746-LIMIT", "battle");
      const b = stage(g.get(), "p1", "R746-LIMIT", "battle");
      activateLine(g, a);
      assert.equal(offered(g.get(), b), undefined);
      move(g, a, "drop");
      move(g, a, "battle");
      assert.equal(offered(g.get(), a), undefined, "[Limit 1]: the moved copy is still held");
      assert.equal(offered(g.get(), b), undefined, "[Limit 1]: and the other copy");
      assert.equal(g.get().sides.p1.limitUses?.["R746-LIMIT#0"], 1, "the master's count is untouched");
      for (const viewer of ["p1", "p2"] as PlayerId[]) assert.deepEqual(limitRow(g.get(), viewer, a, 0), { max: 1, used: 1, remaining: 0 }, `${viewer} still sees the shared count`);
      reload(g);
      assert.equal(offered(g.get(), a), undefined, "held after a reload");
      nextTurnOf(g, "p2");
      nextTurnOf(g, "p1");
      assert.ok(offered(g.get(), a) && offered(g.get(), b), "both back next turn");
    }
    console.log("  #746: [Once per turn] resets on a change of area (3-1-4), carries on 3-1-4-1/2; [Limit X] unaffected");
  } finally {
    for (const id of Object.keys(DEFS).filter((candidate) => candidate.startsWith("R746-"))) delete DEFS[id];
  }
}

export default main();
