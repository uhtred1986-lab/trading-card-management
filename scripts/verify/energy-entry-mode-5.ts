/** R476 pre-entry mode mechanism proof; no native bridge admission yet. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect, dropEffectsOn } from "../../src/lib/arena/vm/effects";
import { captureEnergyEntryMode } from "../../src/lib/arena/vm/energy-entry-mode";

const defs = {
  L: card("L", { type: "LEADER" }), F: card("F", {}),
  E: card("E", { skill: "[Energy-Exhaust]" }),
  "BT8-120": card("BT8-120", { colors: ["Blue", "Green"], skill: "[Energy-Exhaust]\n[Permanent] If you have a Blue/Green multicolor card in your energy, negate this card's [Energy-Exhaust] in all areas." }),
  "EX18-05": card("EX18-05", { colors: ["Blue", "Yellow"], traits: ["Boujack Brigade"], skill: "[Energy-Exhaust]\n[Permanent] If you have a ≪Boujack Brigade≫ card in your energy, reduce the combo cost of this card by 1 and negate its [Energy-Exhaust] skill in all areas." }),
  "BT14-151": card("BT14-151", { colors: ["Green", "Yellow"], traits: ["Android"], skill: "[Energy-Exhaust]\n[Permanent] If there are 3 or more ≪Android≫ cards in your Drop Area, negate this card's [Energy-Exhaust] skill in all areas." }),
  BG: card("BG", { colors: ["Blue", "Green"] }),
  BO: card("BO", { traits: ["Boujack Brigade"] }),
  AND: card("AND", { traits: ["Android"] }),
};
const rows = Object.values(defs).flatMap(skillRecords);
for (const row of rows) assert.deepEqual(row.unread, [], `${row.cardId}#${row.skillIndex}`);
const ctx: EngineContext = { defs, scripts: rulesFromRows(rows.map((row, id) => ({ ...row, id, status: "draft", source: "compiler" }) as unknown as RuleRow), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
function fresh(): VmState { return RULES.createGame(ctx, { seed: 476, p1: { name: "One", leader: "L", main: fifty("F") }, p2: { name: "Two", leader: "L", main: fifty("F") } }).state as VmState; }
function stage(state: VmState, player: PlayerId, cardId: string, area: string): string {
  const id = state.sides[player].zones.deck.at(-1)!; state.cards[id].cardId = cardId;
  assert.ok(moveCard(state, game, id, area, { owner: player }).ok); return id;
}
let cases = 0;
for (const player of ["p1", "p2"] as const) for (const kind of ["E", "F"] as const) for (const explicit of [undefined, "active", "rest"] as const) {
  const state = fresh(), id = stage(state, player, kind, "hand"), before = JSON.stringify(state);
  const observed = captureEnergyEntryMode(ctx, game, state, id, explicit);
  assert.equal(observed.mode, kind === "E" || explicit === "rest" ? "rest" : "active");
  assert.equal(observed.restRequired, kind === "E"); assert.equal(JSON.stringify(state), before); cases++;
}
for (const player of ["p1", "p2"] as const) for (const [kind, prerequisite] of [["BT8-120", "BG"], ["EX18-05", "BO"]] as const) for (const prior of [false, true]) {
  const state = fresh(); if (prior) stage(state, player, prerequisite, "energy");
  const id = stage(state, player, kind, "hand");
  const captured = captureEnergyEntryMode(ctx, game, state, id, "active");
  assert.equal(captured.mode, prior ? "active" : "rest");
  assert.ok(moveCard(state, game, id, "energy", { owner: player, mode: captured.mode }).ok);
  assert.equal(state.cards[id].mode, prior ? "active" : "rest");
  assert.equal(captureEnergyEntryMode(ctx, game, state, id).restRequired, false, "a post-entry query would wrongly allow self-qualification on first entry"); cases++;
}
for (const player of ["p1", "p2"] as const) {
  const state = fresh(), id = stage(state, player, "BT14-151", "drop");
  stage(state, player, "AND", "drop"); const payer = stage(state, player, "AND", "drop");
  assert.equal(captureEnergyEntryMode(ctx, game, state, id).restRequired, false);
  assert.ok(moveCard(state, game, payer, "warp", { owner: player }).ok);
  assert.equal(captureEnergyEntryMode(ctx, game, state, id).restRequired, true, "validity must be captured after optional payer effects"); cases++;
}
for (const player of ["p1", "p2"] as const) for (const explicit of ["active", "rest"] as const) {
  const state = fresh(), id = stage(state, player, "E", "hand");
  addEffect(state, [], { target: id, kind: "negateKeyword", value: "Energy-Exhaust", until: "turn" });
  const captured = captureEnergyEntryMode(ctx, game, state, id, explicit);
  assert.equal(captured.restRequired, false); assert.equal(captured.mode, explicit);
  assert.ok(moveCard(state, game, id, "energy", { owner: player, mode: captured.mode }).ok); dropEffectsOn(state, [], id);
  assert.equal(state.cards[id].mode, explicit, "clearing old effects cannot rewrite the already captured entry mode"); cases++;
}
console.log(`energy-entry-mode-5: ${cases} pre-entry mode cases passed`);
