/** R475 typed mechanism tests; writer/reader integration is a separate step. */
import assert from "node:assert/strict";
import { CTX, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { addEffect, endEffects } from "../../src/lib/arena/vm/effects";
import { captureResolvedGrantDeletions, requireResolvedGrantHistory, resolvedGrantDeleted } from "../../src/lib/arena/vm/resolved-grant-deletion";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { ContinuousEffect, PlayerId } from "../../src/lib/arena/types";

let cases = 0;
for (const player of ["p1", "p2"] as PlayerId[]) {
  const state = RULES.createGame(CTX, { seed: 475, p1: { name: "One", leader: "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const card = state.sides[player].zones.deck[0];
  assert.ok(card);
  const remember = (effect: ContinuousEffect) => { captureResolvedGrantDeletions(state, effect); return effect; };
  const keyword = remember(addEffect(state, [], { target: card, master: player, kind: "keyword", value: { name: "Blocker" }, until: "game" }));
  const copied = remember(addEffect(state, [], { target: card, master: player, kind: "copiedSkills", value: 0, copied: { cardId: "V1", side: "front", skills: [10, 20], from: card, name: "Mechanism" }, until: "game" }));
  assert.equal(resolvedGrantDeleted(state, card, keyword.id), false);
  requireResolvedGrantHistory(state, card); cases++;
  remember(addEffect(state, [], { target: card, master: player, kind: "negateSkills", value: 0, until: "turn" }));
  assert.equal(resolvedGrantDeleted(state, card, keyword.id), true);
  assert.equal(resolvedGrantDeleted(state, card, copied.id, 10), true);
  assert.equal(resolvedGrantDeleted(state, card, copied.id, 30), false); cases++;
  const during = remember(addEffect(state, [], { target: card, master: player, kind: "keyword", value: { name: "Barrier" }, until: "game" }));
  endEffects(state, [], "turn");
  assert.equal(resolvedGrantDeleted(state, card, keyword.id), true);
  assert.equal(resolvedGrantDeleted(state, card, during.id), true);
  const reload = JSON.parse(JSON.stringify(state)) as VmState;
  assert.equal(resolvedGrantDeleted(reload, card, copied.id, 20), true); cases++;
  const fresh = remember(addEffect(state, [], { target: card, master: player, kind: "keyword", value: { name: "Blocker" }, until: "game" }));
  assert.equal(resolvedGrantDeleted(state, card, fresh.id), false); cases++;
  const before = JSON.stringify(state);
  for (let i = 0; i < 5; i++) resolvedGrantDeleted(state, card, keyword.id);
  assert.equal(JSON.stringify(state), before); cases++;
  const corrupt = JSON.parse(before) as VmState;
  corrupt.resolvedGrantDeletions!.push({ ...corrupt.resolvedGrantDeletions![0] });
  assert.throws(() => resolvedGrantDeleted(corrupt, card, keyword.id), /rebuild resolved skill-grant/); cases++;
  const badShape = JSON.parse(before) as VmState;
  (badShape as unknown as { resolvedGrantDeletions: unknown }).resolvedGrantDeletions = {};
  assert.throws(() => resolvedGrantDeleted(badShape, card, keyword.id), /rebuild resolved skill-grant/); cases++;
  delete reload.resolvedGrantDeletions;
  assert.throws(() => requireResolvedGrantHistory(reload, card), /rebuild resolved skill-grant/); cases++;
  reload.effects = [];
  assert.doesNotThrow(() => requireResolvedGrantHistory(reload, card)); cases++;
}
console.log(`resolved grant deletion mechanism: ${cases} cases passed`);
