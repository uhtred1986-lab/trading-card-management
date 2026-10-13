/** #626: fixed privacy expectations on the rules engine. */
import assert from "node:assert/strict";
import { compileCard } from "../../src/lib/arena/compile";
import { RULES } from "../../src/lib/arena/vm";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { hiddenAliases } from "../../src/lib/arena/conceal";
import type { CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { CardView } from "../../src/lib/arena/view";

const engine = RULES;
const card: CardDef = { id: "PUBLIC626", name: "Public Blue card", type: "BATTLE", colors: ["Blue"], energyCost: 1, zEnergyCost: null, power: 10000, comboCost: 0, comboPower: 5000, skill: "[Activate: Main] Draw 1 card.", characters: [], traits: [] };
const leader: CardDef = { ...card, id: "LEADER626", name: "Leader", type: "LEADER", energyCost: null, comboCost: null, comboPower: null, skill: null };
const ctx: EngineContext = { defs: { PUBLIC626: card, LEADER626: leader }, scripts: { PUBLIC626: compileCard(card), LEADER626: compileCard(leader) } };
const state = engine.createGame(ctx, { seed: 626, p1: { name: "You", leader: "LEADER626", main: Array(50).fill("PUBLIC626") }, p2: { name: "Other", leader: "LEADER626", main: Array(50).fill("PUBLIC626") } }).state;
const sides = state.sides.p1.zones;
// Staged public-zone fixture, keeping the physical card in exactly one zone.
const id = sides.deck.pop(); assert.ok(id); sides.energy.push(id);
state.cards[id].hidden = true;
const image = "http://arena-626-art.local/public.webp";
const snapshot = (viewer: PlayerId) => buildSnapshot({ id: 626, mode: "versus", status: "playing", p1Name: "You", p2Name: "Other", ctx, state, legal: engine.legalActions(ctx, state), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: { PUBLIC626: { front: image, back: null } } });
for (const viewer of ["p1", "p2"] as const) {
  const view = snapshot(viewer).view;
  // Named by its position, not its instance id, for both viewers (`conceal.ts`): the id is a decklist position.
  const alias: string = hiddenAliases(state, viewer)[id];
  assert.equal(alias, "?p1:energy:0");
  assert.ok(!(viewer === "p1" ? view.you : view.them).energy.some((c) => c.id === id), "never under its instance id");
  const projected: CardView = (viewer === "p1" ? view.you : view.them).energy.find((c) => c.id === alias)!;
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
console.log(`Hidden Mode projection #626: rules fixed identity/face/ability privacy and revealed control passed for both viewers`);
