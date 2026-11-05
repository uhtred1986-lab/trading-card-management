/** R476 saved original-movement contract, still isolated from entry admission. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { ScriptFrame } from "../../src/lib/arena/vm/script";
import { vmHost } from "../../src/lib/arena/vm/host";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { captureEnergyEntryWitness, requireEnergyEntryWitness } from "../../src/lib/arena/vm/energy-entry-witness";
const defs = { L: card("L", { type: "LEADER" }), F: card("F", {}) };
const ctx: EngineContext = { defs };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let cases = 0;
for (const player of ["p1", "p2"] as const) for (const area of ["hand", "deck", "drop"] as const) {
  const state = RULES.createGame(ctx, { seed: 476, p1: { name: "One", leader: "L", main: fifty("F") }, p2: { name: "Two", leader: "L", main: fifty("F") } }).state as VmState;
  const incoming = state.sides[player].zones.deck[0]; assert.ok(moveCard(state, game, incoming, area, { owner: player }).ok);
  const frame: ScriptFrame = { card: state.sides[player].zones.leader[0], master: player, skillIndex: 10, ip: 0,
    ops: [{ op: "moveTo", target: { var: "incoming" }, to: "energy", mode: "rest" }], vars: { incoming: [incoming] }, moveLoop: { kind: "moveTo", ids: [incoming], index: 0, to: "energy" } };
  const destination = { area: "energy" as const, player, mode: "rest" as const };
  const host = vmHost(ctx, game, state, []), saved = captureEnergyEntryWitness(host, 1, frame, incoming, destination);
  requireEnergyEntryWitness(host, 1, copy(frame), copy(saved), destination); cases++;
  for (const fault of ["owner", "parent", "operation", "destination", "sourceABA", "malformed"] as const) {
    const board = copy(state), parent = copy(frame), receipt = copy(saved);
    if (fault === "owner") receipt.owner = 2;
    if (fault === "parent") parent.skillIndex = 20;
    if (fault === "operation") parent.ops[0] = { op: "moveTo", target: { var: "incoming" }, to: "energy", mode: "active" };
    if (fault === "destination") receipt.destination.mode = "active";
    if (fault === "sourceABA") { assert.ok(moveCard(board, game, incoming, "warp", { owner: player }).ok); assert.ok(moveCard(board, game, incoming, area, { owner: player }).ok); }
    if (fault === "malformed") delete (receipt as unknown as { parent?: unknown }).parent;
    assert.throws(() => requireEnergyEntryWitness(vmHost(ctx, game, board, []), 1, parent, receipt, destination), /rebuild.*Energy entry|original incoming Energy/); cases++;
  }
  const multi = copy(frame); multi.moveLoop!.ids.push(state.sides[player].zones.deck.at(-1)!);
  assert.throws(() => captureEnergyEntryWitness(host, 1, multi, incoming, destination), /owner ordering/); cases++;
  const other: PlayerId = player === "p1" ? "p2" : "p1";
  assert.throws(() => captureEnergyEntryWitness(host, 1, frame, incoming, { ...destination, player: other }), /another player's Energy/); cases++;
}
console.log(`energy-entry-witness-5: ${cases} isolated movement-owner cases passed; card admission remains blocked`);
