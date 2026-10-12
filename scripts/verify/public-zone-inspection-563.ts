/** Independent expected visibility for inspection; neither engine is an oracle. */
import assert from "node:assert/strict";
import { engineFor, isVmState, type EngineState } from "../../src/lib/arena/engines";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import type { PlayerId } from "../../src/lib/arena/types";
import { CTX, DEFS, card, stageMoveG } from "./harness";
import { RULES_ONLY } from "./rules-only";

const main = Array.from({ length: 50 }, () => "V1");
const engines = RULES_ONLY ? ["rules"] as const : ["legacy", "rules"] as const;
for (const engineId of engines) {
  const engine = engineFor(engineId);
  let state = engine.createGame(CTX, { seed: 563, p1: { name: "You", leader: "L-RED", main }, p2: { name: "Opponent", leader: "L-BLUE", main } }).state;
  assert.equal(state.prompt.kind, "chooseFirst");
  state = engine.apply(CTX, state, { type: "chooseFirst", player: state.prompt.player!, first: "p1" }).state;
  for (const player of ["p1", "p2"] as const) state = engine.apply(CTX, state, { type: "mulligan", player, redraw: false }).state;
  const zones = (p: PlayerId) => isVmState(state) ? state.sides[p].zones : state.players[p];
  const expected = new Map<PlayerId, Record<"drop" | "warp" | "zEnergy" | "zDeck", string[]>>();
  const privateIds: string[] = [];
  for (const p of ["p1", "p2"] as const) {
    const zoneIds = { drop: [] as string[], warp: [] as string[], zEnergy: [] as string[], zDeck: [] as string[] };
    for (const zone of ["drop", "warp", "zEnergy", "zDeck"] as const) {
      for (let index = 0; index < 3; index++) {
        const id = zones(p).deck[0]!;
        const definition = `INSPECT_${engineId}_${p}_${zone}_${index}`;
        DEFS[definition] = card(definition, { name: `Synthetic ${p} ${zone} ${index}`, ...(zone === "zDeck" ? { type: "Z-BATTLE", zEnergyCost: 1, comboCost: null, comboPower: null } : {}) });
        state.cards[id]!.cardId = definition;
        stageMoveG(state, id, zone, p);
        state.cards[id]!.hidden = index === 2;
        state.cards[id]!.faceUp = zone === "zDeck" && index === 0;
        if (index !== 2) zoneIds[zone].push(id);
      }
    }
    expected.set(p, zoneIds);
    for (const zone of ["hand", "life", "deck"] as const) {
      const id = zones(p)[zone][0]!;
      const definition = `PRIVATE_${engineId}_${p}_${zone}`;
      DEFS[definition] = card(definition, { name: `Secret ${p} ${zone}` });
      state.cards[id]!.cardId = definition;
      privateIds.push(id);
    }
  }
  const snapshot = (current: EngineState, viewer: PlayerId, revision = 1) => buildSnapshot({
    id: 563, revision, engine: engineId, mode: "versus", status: "playing", p1Name: "You", p2Name: "Opponent", ctx: CTX, state: current,
    legal: engine.legalActions(CTX, current), log: [], beats: null, spotlight: null,
    spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {},
  });
  const original = JSON.stringify(state);
  for (const viewer of ["p1", "p2"] as const) {
    const view = snapshot(state, viewer);
    for (const side of [view.view.you, view.view.them]) {
      const wanted = expected.get(side.player)!;
      for (const zone of ["drop", "warp", "zEnergy", "zDeck"] as const) {
        const ids = wanted[zone].filter((id) => zone !== "zDeck" || side.player === viewer || state.cards[id]!.faceUp);
        assert.deepEqual(side.inspectableZones![zone].map((item) => item.id), ids, `${engineId}/${viewer}/${side.player}/${zone}`);
        assert.equal(side[zone], 3, "count includes unreadable cards without disclosing their faces");
        assert.ok(side.inspectableZones![zone].every((item) => !item.hidden && item.cardId && item.name));
      }
    }
    const zoneJson = JSON.stringify([view.view.you.inspectableZones, view.view.them.inspectableZones]);
    for (const id of privateIds) assert.ok(!zoneJson.includes(state.cards[id]!.cardId), "inspection must never add hand/life/deck identities");
    assert.deepEqual(snapshot(JSON.parse(original), viewer).view, view.view, "serialization retains viewer-specific inspection");
    assert.equal(JSON.stringify(state), original, "inspection never advances or mutates the state");
    const next = JSON.parse(original) as EngineState;
    const moved = expected.get(viewer)!.drop[0]!;
    stageMoveG(next, moved, "warp", viewer);
    const fresh = snapshot(next, viewer, 2);
    assert.ok(!fresh.view.you.inspectableZones!.drop.some((item) => item.id === moved));
    assert.ok(fresh.view.you.inspectableZones!.warp.some((item) => item.id === moved));
    assert.ok(view.view.you.inspectableZones!.drop.some((item) => item.id === moved), "older snapshot retains its original zone list");
    assert.equal(view.game.revision, 1);
    assert.equal(fresh.game.revision, 2);
  }
}
console.log(`public-zone-inspection-563: ${engines.join("/")} and both viewers, owner Z-Deck, hidden faces, serialization, revision and state purity passed`);
