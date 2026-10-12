/** #626: independent fixed privacy expectations on each engine, never compared. */
import assert from "node:assert/strict";
import { compileCard } from "../../src/lib/arena/compile";
import { isVmState, playableEngine } from "../../src/lib/arena/engines";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import type { CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { CardView } from "../../src/lib/arena/view";
import { RULES_ONLY } from "./rules-only";

const engineId = RULES_ONLY || process.argv.some((arg, n) => arg === "--engine" && process.argv[n + 1] === "rules") ? "rules" : "legacy";
const engine = playableEngine(engineId);
const card: CardDef = { id: "PUBLIC626", name: "Public Blue card", type: "BATTLE", colors: ["Blue"], energyCost: 1, zEnergyCost: null, power: 10000, comboCost: 0, comboPower: 5000, skill: "[Activate: Main] Draw 1 card.", characters: [], traits: [] };
const leader: CardDef = { ...card, id: "LEADER626", name: "Leader", type: "LEADER", energyCost: null, comboCost: null, comboPower: null, skill: null };
const ctx: EngineContext = { defs: { PUBLIC626: card, LEADER626: leader }, scripts: { PUBLIC626: compileCard(card), LEADER626: compileCard(leader) } };
const state = engine.createGame(ctx, { seed: 626, p1: { name: "You", leader: "LEADER626", main: Array(50).fill("PUBLIC626") }, p2: { name: "Other", leader: "LEADER626", main: Array(50).fill("PUBLIC626") } }).state;
const sides = isVmState(state) ? state.sides.p1.zones : state.players.p1;
// Staged public-zone fixture, keeping the physical card in exactly one zone.
const id = sides.deck.pop(); assert.ok(id); sides.energy.push(id);
state.cards[id].hidden = true;
const image = "http://arena-626-art.local/public.webp";
const snapshot = (viewer: PlayerId) => buildSnapshot({ id: 626, engine: engineId, mode: "versus", status: "playing", p1Name: "You", p2Name: "Other", ctx, state, legal: engine.legalActions(ctx, state), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: { PUBLIC626: { front: image, back: null } } });
for (const viewer of ["p1", "p2"] as const) {
  const view = snapshot(viewer).view;
  const projected: CardView = (viewer === "p1" ? view.you : view.them).energy.find((c) => c.id === id)!;
  assert.ok(projected);
  assert.equal(projected.cardId, ""); assert.equal(projected.name, "Face-down card");
  assert.deepEqual(projected.colors, []); assert.equal(projected.text, null); assert.equal(projected.imageUrl, null);
  assert.equal(projected.power, null); assert.equal(projected.cost, null);
  assert.equal(projected.comboCost, null); assert.equal(projected.comboPower, null);
  assert.deepEqual(projected.keywords, []); assert.equal(projected.reading, "");
  assert.equal(projected.referee, false); assert.deepEqual(projected.permanents ?? [], []);
  assert.deepEqual(projected.abilities ?? [], []);
}
// Control: the same public card in Revealed Mode keeps its catalogue identity.
state.cards[id].hidden = false;
for (const viewer of ["p1", "p2"] as const) {
  const view = snapshot(viewer).view;
  const projected: CardView = (viewer === "p1" ? view.you : view.them).energy.find((c) => c.id === id)!;
  assert.equal(projected.cardId, "PUBLIC626"); assert.equal(projected.name, "Public Blue card");
  assert.deepEqual(projected.colors, ["Blue"]); assert.equal(projected.text, card.skill); assert.equal(projected.imageUrl, image);
}
console.log(`Hidden Mode projection #626: ${engineId} fixed identity/face/ability privacy and revealed control passed for both viewers`);
