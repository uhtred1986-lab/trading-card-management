/** R477 synchronous adapter prototype, without production host integration. */
import assert from "node:assert/strict";
import fixtures from "./fixtures/standing-negation-observation-5.json";
import { CTX, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { CardScripts, Script } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import { newCard } from "../../src/lib/arena/vm/zones";
import { addEffect, endEffects } from "../../src/lib/arena/vm/effects";
import { resolvedGrantDeleted } from "../../src/lib/arena/vm/resolved-grant-deletion";
import { captureStandingNegationMutation as capture, settleStandingNegationMutation as settle, assertStandingNegationSettled as check } from "../../src/lib/arena/vm/standing-negation-transaction";
import type { StandingNegationMutation } from "../../src/lib/arena/vm/standing-negation-transaction";
import type { StandingNegationCard as Card } from "../../src/lib/arena/vm/standing-negation-history";
const defs = { ...CTX.defs }, scripts: Record<string, CardScripts> = { ...CTX.scripts };
for (const [id, fixture] of Object.entries(fixtures)) {
  defs[id] = { ...CTX.defs.V1, id, skill: fixture.skill };
  scripts[id] = { bySkill: {}, complete: false, unsupported: ["observation fixture only"] };
  for (const row of fixture.records) scripts[id].bySkill[row.skillIndex] = { kind: row.kind, ops: row.ops, unsupported: row.unread, validity: row.validity, usage: row.usage } as Script;
}
const ctx: EngineContext = { ...CTX, defs, scripts };
function board(master: PlayerId) {
  const state = RULES.createGame(CTX, { seed: 477, p1: { name: "One", leader: "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const put = (id: string, cardId: string, owner = master): Card => {
    state.cards[id] = newCard(id, cardId, owner); state.sides[owner].zones.battle.push(id);
    return { card: id, cardId, epoch: 0, hiddenCount: 0, side: "front", master: owner };
  };
  const enter = (id: string, cardId: string, owner = master) => {
    const token = capture(ctx, state), arrival = put(id, cardId, owner);
    settle(ctx, state, token, { arrivals: [arrival] }); return arrival;
  };
  return { state, put, enter };
}
let cases = 0;
const test = (name: string, fn: () => void) => { fn(); cases++; console.log(`PASS ${name}`); };
for (const master of ["p1", "p2"] as PlayerId[]) {
  test(`${master}: unaffected unread Permanent and timed protection need no history`, () => {
    const b = board(master); b.put("whis", "BT1-043");
    addEffect(b.state, [], { target: "whis", kind: "forbid", value: 0, forbid: { what: "beNegated" }, until: "turn", master });
    const before = JSON.stringify(b.state), token = capture(ctx, b.state); settle(ctx, b.state, token); check(ctx, b.state);
    assert.equal(JSON.stringify(b.state), before); assert.equal(b.state.standingNegationHistory, undefined);
  });
  test(`${master}: unaffected external protection aura needs no history`, () => {
    const b = board(master); b.state.cards.aura = newCard("aura", "AURA", master); b.state.sides[master].zones.energy.push("aura");
    const script: Script = { kind: "permanent", unsupported: [], ops: [{ op: "forbid", what: "beNegated", target: { sel: { side: "you", area: "battle", count: 99 } }, until: "game" }] };
    const auraCtx: EngineContext = { ...ctx, defs: { ...ctx.defs, AURA: { ...CTX.defs.V1, id: "AURA" } }, scripts: { ...ctx.scripts, AURA: { bySkill: { 0: script }, complete: true, unsupported: [] } } };
    const token = capture(auraCtx, b.state), arrival = b.put("ordinary", "V1");
    settle(auraCtx, b.state, token, { arrivals: [arrival] }); check(auraCtx, b.state);
    assert.equal(b.state.standingNegationHistory, undefined);
  });
  test(`${master}: copied whole-negator cannot disappear through missing or empty source record`, () => {
    const b = board(master); b.put("ordinary", "V1");
    addEffect(b.state, [], { target: "ordinary", master, kind: "copiedSkills", value: 0, until: "game", copied: { cardId: "DB1-066", side: "front", skills: [0] } });
    const variants: CardScripts["bySkill"][] = [{}, { 0: { ...scripts["DB1-066"].bySkill[0], ops: [] } }];
    for (const bySkill of variants) {
      const altered = { ...ctx, scripts: { ...ctx.scripts, "DB1-066": { bySkill, complete: false, unsupported: [] } } };
      assert.throws(() => capture(altered, b.state), /copied standing negators with reviewed grant identities/);
    }
    const missing = { ...ctx, defs: Object.fromEntries(Object.entries(ctx.defs).filter(([id]) => id !== "DB1-066")) };
    assert.throws(() => capture(missing, b.state), /copied standing-negation source definition/);
  });
  test(`${master}: unrelated valid copied Auto retains unaffected path`, () => {
    const b = board(master); b.put("ordinary", "V1");
    addEffect(b.state, [], { target: "ordinary", master, kind: "copiedSkills", value: 0, until: "game", copied: { cardId: "BT10-153", side: "front", skills: [30] } });
    const before = JSON.stringify(b.state), token = capture(ctx, b.state); settle(ctx, b.state, token); check(ctx, b.state);
    assert.equal(JSON.stringify(b.state), before); assert.equal(b.state.standingNegationHistory, undefined);
  });
  test(`${master}: capture is pure and commit preserves native reference identity`, () => {
    const b = board(master), before = JSON.stringify(b.state), frames = b.state.programs, pending = b.state.pending;
    const token = capture(ctx, b.state); assert.equal(JSON.stringify(b.state), before);
    const arrival = b.put("king", "DB1-066"); settle(ctx, b.state, token, { arrivals: [arrival] });
    assert.equal(b.state.programs, frames); assert.equal(b.state.pending, pending); check(ctx, b.state);
    assert.throws(() => settle(ctx, b.state, token), /original synchronous/);
  });
  test(`${master}: serialized, foreign-state and changed-history tokens cannot authorize commit`, () => {
    const b = board(master), token = capture(ctx, b.state);
    assert.throws(() => settle(ctx, b.state, JSON.parse(JSON.stringify(token)) as StandingNegationMutation), /original synchronous/);
    assert.throws(() => settle(ctx, structuredClone(b.state), token), /original synchronous/);
    b.state.standingNegationHistory = { version: 1, policy: "otherBattleWholeV1", nextSerial: 1, observation: "[]", active: [], suppressed: [] };
    assert.throws(() => settle(ctx, b.state, token), /history changed/);
  });
  test(`${master}: read detects unsettled arrival without initializing history`, () => {
    const b = board(master); b.put("king", "DB1-066"); const before = JSON.stringify(b.state);
    assert.throws(() => check(ctx, b.state), /rebuild affected/); assert.equal(JSON.stringify(b.state), before);
  });
  test(`${master}: entering standing negator deletes preexisting resolved keyword grant`, () => {
    const b = board(master); const target = b.put("ordinary", "V1");
    const grant = addEffect(b.state, [], { target: target.card, master, kind: "keyword", value: { name: "Blocker" }, until: "game" });
    b.enter("king", "DB1-066"); assert.equal(resolvedGrantDeleted(b.state, target.card, grant.id), true);
    const token = capture(ctx, b.state); b.state.sides[master].zones.battle = [target.card]; settle(ctx, b.state, token);
    assert.equal(resolvedGrantDeleted(b.state, target.card, grant.id), true, "standing source departure cannot restore resolved granted text");
  });
  test(`${master}: newly resolved grant under unchanged graph is observed then deleted`, () => {
    const b = board(master); b.enter("ordinary", "V1"); b.enter("king", "DB1-066");
    const token = capture(ctx, b.state), observation = b.state.standingNegationHistory!.observation;
    const grant = addEffect(b.state, [], { target: "ordinary", master, kind: "keyword", value: { name: "Blocker" }, until: "game" });
    const beforeRead = JSON.stringify(b.state);
    assert.throws(() => check(ctx, b.state), /newly granted text/); assert.equal(JSON.stringify(b.state), beforeRead);
    assert.equal(resolvedGrantDeleted(b.state, "ordinary", grant.id), false);
    settle(ctx, b.state, token); assert.equal(b.state.standingNegationHistory!.observation, observation);
    assert.equal(resolvedGrantDeleted(b.state, "ordinary", grant.id), true); check(ctx, b.state);
  });
  test(`${master}: missing grant receipt fails before either history field is published`, () => {
    const b = board(master); b.enter("ordinary", "V1"); b.enter("king", "DB1-066");
    const token = capture(ctx, b.state), history = b.state.standingNegationHistory, receipts = b.state.resolvedGrantDeletions;
    b.state.effects.push({ id: 90, target: "ordinary", master, ownerTurn: master, kind: "keyword", value: { name: "Blocker" }, until: "game", createdTurn: 1 });
    assert.throws(() => settle(ctx, b.state, token), /rebuild resolved skill-grant/);
    assert.equal(b.state.standingNegationHistory, history); assert.equal(b.state.resolvedGrantDeletions, receipts);
    b.state.standingNegationHistory = { ...history!, nextSerial: history!.nextSerial + 1 };
    assert.throws(() => settle(ctx, b.state, token), /history changed/, "failed old capture cannot commit against a later history");
  });
  test(`${master}: complete timed-negation expiry preserves takeover`, () => {
    const b = board(master); b.enter("king", "DB1-066"); b.enter("gotenks", "BT10-153");
    const disable = capture(ctx, b.state); addEffect(b.state, [], { target: "king", master, kind: "negateSkills", value: 0, until: "turn" }); settle(ctx, b.state, disable);
    const serial = b.state.standingNegationHistory!.active[0].serial; assert.equal(b.state.standingNegationHistory!.active[0].source.card, "gotenks");
    const expire = capture(ctx, b.state); endEffects(b.state, [], "turn"); settle(ctx, b.state, expire);
    assert.equal(b.state.standingNegationHistory!.active[0].serial, serial); assert.equal(b.state.standingNegationHistory!.active[0].source.card, "gotenks");
  });
  test(`${master}: simultaneous expiry cannot acquire priority from effect enumeration`, () => {
    const b = board(master); b.enter("king", "DB1-066"); b.enter("gotenks", "BT10-153");
    const disable = capture(ctx, b.state);
    for (const target of ["king", "gotenks"]) addEffect(b.state, [], { target, master, kind: "negateSkills", value: 0, until: "turn" });
    settle(ctx, b.state, disable); assert.equal(b.state.standingNegationHistory!.active.length, 0);
    const expire = capture(ctx, b.state), history = b.state.standingNegationHistory;
    endEffects(b.state, [], "turn"); assert.throws(() => settle(ctx, b.state, expire), /proven mutation ordering/);
    assert.equal(b.state.standingNegationHistory, history);
  });
}
console.log(`standing-negation synchronous transaction prototype: ${cases} cases passed`);
