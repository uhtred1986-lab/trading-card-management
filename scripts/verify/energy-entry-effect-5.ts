/** R476 ordinary-effect mechanism controls; no native entry admission yet. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import type { EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript, type ScriptFrame } from "../../src/lib/arena/vm/script";
import { energyEntryEffect, energyEntryPayersCompleted } from "../../src/lib/arena/vm/energy-entry-effect";

const defs = { L: card("L", { type: "LEADER" }), F: card("F", {}),
  IN: card("IN", { colors: ["Red", "Blue"], skill: "[Energy-Exhaust]" }),
  R: card("R", { colors: ["Red"] }), B: card("B", { colors: ["Blue"] }),
  RB: card("RB", { colors: ["Red", "Blue"] }) };
const rows = Object.values(defs).flatMap(skillRecords);
const ctx: EngineContext = { defs, scripts: rulesFromRows(rows.map((row, id) => ({ ...row, id, status: "draft", source: "compiler" }) as unknown as RuleRow), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
function stage(state: VmState, player: PlayerId, cardId: string, area: string): string {
  const id = area === "deck" ? state.sides[player].zones.deck[0] : state.sides[player].zones.deck.at(-1)!; state.cards[id].cardId = cardId;
  assert.ok(moveCard(state, game, id, area, { owner: player, ...(area === "deck" ? { position: "top" as const } : {}) }).ok); return id;
}
let cases = 0;
for (const player of ["p1", "p2"] as const) for (const origin of ["hand", "deck"] as const) for (const mode of ["accept", "decline", "oneMulti", "twoMulti", "effectBan"] as const) {
  let state = RULES.createGame(ctx, { seed: 476, p1: { name: "One", leader: "L", main: fifty("F") }, p2: { name: "Two", leader: "L", main: fifty("F") } }).state as VmState;
  const incoming = stage(state, player, "IN", origin);
  const first = stage(state, player, mode.includes("Multi") ? "RB" : "R", "drop");
  const second = mode === "oneMulti" ? undefined : stage(state, player, mode === "twoMulti" ? "RB" : "B", "drop");
  if (mode === "effectBan") addEffect(state, [], { target: first, kind: "forbid", value: 0, until: "game", forbid: { what: "beMovedBySkill", fromArea: "drop", toArea: "warp", bySkill: true } });
  let frame: ScriptFrame = { card: incoming, master: player, ops: energyEntryEffect({ version: 1, colors: ["Red", "Blue"] }), ip: 0, vars: {} };
  const events: GameEvent[] = [];
  let count = 0;
  for (;;) {
    const result = stepScript({ ...vmHost(ctx, game, state, events), resume: () => {} }, frame);
    if (result === "done") break;
    assert.ok(++count < 8, "bounded effect procedure did not finish");
    // Reload before every answer; caller-owned entry witnesses are a later layer.
    state = copy(state); frame = copy(frame);
    if (state.prompt.kind === "chooseMode") state.lastMode = mode === "decline" ? 1 : 0;
    else if (state.prompt.kind === "chooseCards") state.lastChoice = [state.prompt.choice.candidates[0]];
    else assert.fail(`unexpected effect prompt ${state.prompt.kind}`);
  }
  assert.equal(energyEntryPayersCompleted(frame), mode === "accept" || mode === "twoMulti", `${player}/${origin}/${mode}`);
  assert.ok(state.sides[player].zones[origin].includes(incoming), "isolated effect never places incoming energy");
  assert.ok(!events.some(event => event.type === "move" && event.card === incoming), "no premature incoming movement");
  if (mode === "accept" || mode === "twoMulti") {
    assert.ok(state.sides[player].zones.warp.includes(first)); assert.ok(state.sides[player].zones.warp.includes(second!));
    const incomplete = copy(frame); delete incomplete.movementResults;
    assert.throws(() => energyEntryPayersCompleted(incomplete), /rebuild.*movement/);
  }
  if (mode === "effectBan") {
    assert.ok(state.sides[player].zones.drop.includes(first), "ordinary effect obeys the movement prohibition");
    assert.ok(state.sides[player].zones.warp.includes(second!), "already performed ordinary instructions are not rolled back");
  }
  if (mode === "decline" || mode === "oneMulti") assert.ok(state.sides[player].zones.drop.includes(first));
  cases++;
}
console.log(`energy-entry-effect-5: ${cases} ordinary-effect mechanism cases passed; native entry remains unwired`);
