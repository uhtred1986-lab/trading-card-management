/** Exact stored policy fixtures observed without admitting their gameplay. */
import assert from "node:assert/strict";
import fixtures from "./fixtures/standing-negation-observation-5.json";
import { CTX, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { CardScripts, Script } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import { newCard } from "../../src/lib/arena/vm/zones";
import { observeStandingNegation as observe } from "../../src/lib/arena/vm/standing-negation-observation";
import type { StandingNegationTransaction as Transaction } from "../../src/lib/arena/vm/standing-negation-observation";
import { emptyStandingNegationHistory as empty, settleStandingNegation as settle, standingNegationAffects as affects } from "../../src/lib/arena/vm/standing-negation-history";
import type { StandingNegationCard as Card } from "../../src/lib/arena/vm/standing-negation-history";

const defs = { ...CTX.defs }, records: Record<string, CardScripts> = {};
for (const [id, fixture] of Object.entries(fixtures)) {
  defs[id] = { ...CTX.defs.V1, id, skill: fixture.skill };
  records[id] = { bySkill: {}, complete: false, unsupported: ["R477 observation fixture only"] };
  for (const row of fixture.records) records[id].bySkill[row.skillIndex] = { kind: row.kind, ops: row.ops, unsupported: row.unread, validity: row.validity, usage: row.usage } as Script;
}
const ctx: EngineContext = { ...CTX, defs, scripts: { ...CTX.scripts, ...records } };
let cases = 0;
const test = (name: string, fn: () => void) => { fn(); cases++; console.log(`PASS ${name}`); };
function board(master: PlayerId) {
  const state = RULES.createGame(CTX, { seed: 477, p1: { name: "One", leader: "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const put = (card: string, cardId: string, owner = master): Card => {
    state.cards[card] = newCard(card, cardId, owner);
    state.sides[owner].zones.battle.push(card);
    return { card, cardId, epoch: 0, hiddenCount: 0, side: "front", master: owner };
  };
  let transaction: Transaction = { previous: { version: 1, policy: "otherBattleWholeV1", candidates: [] }, history: empty(), arrivals: [] };
  const advance = (arrivals: Card[] = []) => {
    const current = observe(ctx, state, { ...transaction, arrivals });
    transaction = { previous: current, history: settle(transaction.history, current), arrivals: [] };
    return transaction;
  };
  return { state, put, advance, transaction: () => transaction };
}
for (const master of ["p1", "p2"] as PlayerId[]) {
  const other = master === "p1" ? "p2" : "p1";
  test(`${master}: native occurrences observe exact whole policy and handoff`, () => {
    const b = board(master), a = b.put("king", "DB1-066"), t1 = b.advance([a]);
    const c = b.put("gotenks", "BT10-153", other), t2 = b.advance([c]);
    assert.equal(t2.previous.candidates.length, 2);
    assert.equal(t2.previous.candidates.find(x => x.source.card === c.card)!.enabled, true, "external enablement ignores standing suppression");
    assert.equal(affects(t2.history, t2.previous, c), true);
    assert.deepEqual(t2.history.active, t1.history.active);
    b.state.effects.push({ id: 90, target: a.card, kind: "negateSkills", value: 0, until: "turn", createdTurn: 1, ownerTurn: master, master });
    const takeover = b.advance(); assert.equal(takeover.history.active[0].source.card, c.card);
    b.state.effects = []; const restored = b.advance(); assert.deepEqual(restored.history.active, takeover.history.active);
  });
  test(`${master}: arriving self-protection precedes existing standing edges`, () => {
    const b = board(master), a = b.put("king", "DB1-066"); b.advance([a]);
    const g = b.put("goku", "TB1-097", other), t = b.advance([g]);
    assert.equal(affects(t.history, t.previous, g), false);
  });
  test(`${master}: pre-entry timed negation suppresses protection, expiry does not revive it under King`, () => {
    const b = board(master), a = b.put("king", "DB1-066"); b.advance([a]);
    const g = b.put("goku", "TB1-097", other);
    b.state.effects.push({ id: 90, target: g.card, kind: "negateSkills", value: 0, until: "turn", createdTurn: 1, ownerTurn: master, master });
    const t = b.advance([g]); assert.equal(affects(t.history, t.previous, g), true);
    b.state.effects = []; const expired = b.advance(); assert.equal(affects(expired.history, expired.previous, g), true);
    b.state.sides[master].zones.battle = [];
    assert.throws(() => b.advance(), /review self-protection reactivation/);
  });
  test(`${master}: per-index protection negation is externally observed`, () => {
    const b = board(master), a = b.put("king", "DB1-066"); b.advance([a]);
    const g = b.put("goku", "TB1-097", other);
    b.state.effects.push({ id: 90, target: g.card, kind: "negateSkill", value: 30, until: "turn", createdTurn: 1, ownerTurn: master, master });
    const t = b.advance([g]); assert.equal(affects(t.history, t.previous, g), true);
  });
  test(`${master}: partial Whis stored record refuses instead of borrowing readable prefix`, () => {
    const b = board(master), a = b.put("king", "DB1-066"); b.advance([a]); b.put("whis", "BT1-043");
    assert.throws(() => b.advance(), /complete unconditional/);
  });
  test(`${master}: hidden source and non-Battle location do not emit candidate`, () => {
    const b = board(master), a = b.put("king", "DB1-066"); b.state.cards[a.card].hidden = true;
    assert.equal(b.advance().previous.candidates.length, 0);
    b.state.cards[a.card].hidden = false; b.state.sides[master].zones.battle = []; b.state.sides[master].zones.hand.push(a.card);
    assert.equal(b.advance().previous.candidates.length, 0);
  });
  test(`${master}: observation is pure and repeated reads do not allocate generations`, () => {
    const b = board(master), a = b.put("king", "DB1-066"); b.advance([a]);
    const before = JSON.stringify({ state: b.state, transaction: b.transaction() });
    for (let i = 0; i < 4; i++) observe(ctx, b.state, b.transaction());
    assert.equal(JSON.stringify({ state: b.state, transaction: b.transaction() }), before);
  });
  test(`${master}: wrong-side index and keyword-kind negation do not disable Permanent`, () => {
    const b = board(master), a = b.put("king", "DB1-066");
    b.state.effects.push({ id: 90, target: a.card, kind: "negateSkill", value: 0, skillSide: "back", until: "turn", createdTurn: 1, ownerTurn: master, master });
    b.state.effects.push({ id: 91, target: a.card, kind: "negateSkillKind", value: "keyword", until: "turn", createdTurn: 1, ownerTurn: master, master });
    assert.equal(b.advance([a]).previous.candidates[0].enabled, true);
    b.state.effects.push({ id: 92, target: a.card, kind: "negateSkillKind", value: "permanent", until: "turn", createdTurn: 1, ownerTurn: master, master });
    assert.equal(b.advance().previous.candidates[0].enabled, false);
  });
  test(`${master}: unknown timed protection refuses`, () => {
    const b = board(master), a = b.put("king", "DB1-066"); b.advance([a]);
    b.state.effects.push({ id: 90, target: a.card, kind: "forbid", value: 0, forbid: { what: "beNegated" }, until: "turn", createdTurn: 1, ownerTurn: master, master });
    assert.throws(() => b.advance(), /timed beNegated protection/);
  });
  test(`${master}: Barrier does not filter all-other Battle edges`, () => {
    const b = board(master), a = b.put("king", "DB1-066"); b.advance([a]);
    const target = b.put("barrier", "V1");
    b.state.effects.push({ id: 90, target: target.card, kind: "keyword", value: { name: "Barrier" }, until: "turn", createdTurn: 1, ownerTurn: master, master });
    const t = b.advance([target]); assert.equal(affects(t.history, t.previous, target), true);
  });
  test(`${master}: repeated suppressed occurrence cannot be declared freshly arriving`, () => {
    const b = board(master), a = b.put("king", "DB1-066"); b.advance([a]);
    const g = b.put("goku", "TB1-097", other);
    b.state.effects.push({ id: 90, target: g.card, kind: "negateSkills", value: 0, until: "turn", createdTurn: 1, ownerTurn: master, master });
    b.advance([g]); b.state.effects = [];
    assert.throws(() => b.advance([g]), /reuses a suppressed occurrence/);
  });
  test(`${master}: missing current Permanent record refuses`, () => {
    const b = board(master); b.put("king", "DB1-066");
    const incomplete = { ...ctx, scripts: { ...ctx.scripts, "DB1-066": { bySkill: {}, complete: false, unsupported: [] } } };
    assert.throws(() => observe(incomplete, b.state, b.transaction()), /complete unconditional/);
  });
  test(`${master}: altered target shape cannot borrow all-other policy`, () => {
    const b = board(master); b.put("king", "DB1-066");
    const changed = structuredClone(records["DB1-066"]);
    changed.bySkill[0].ops = [{ op: "negateSkills", target: { sel: { side: "opponent", area: "battle", count: 99 } }, until: "game" }];
    const alternate = { ...ctx, scripts: { ...ctx.scripts, "DB1-066": changed } };
    assert.throws(() => observe(alternate, b.state, b.transaction()), /only all-other-Battle/);
  });
  test(`${master}: external-area protection is not silently ignored`, () => {
    const b = board(master); b.put("king", "DB1-066");
    b.state.cards.aura = newCard("aura", "AURA", master); b.state.sides[master].zones.energy.push("aura");
    const script: Script = { kind: "permanent", unsupported: [], ops: [{ op: "forbid", what: "beNegated", target: { sel: { side: "you", area: "battle", count: 99 } }, until: "game" }] };
    const aura = { ...ctx, defs: { ...ctx.defs, AURA: { ...CTX.defs.V1, id: "AURA" } }, scripts: { ...ctx.scripts, AURA: { bySkill: { 0: script }, complete: true, unsupported: [] } } };
    assert.throws(() => observe(aura, b.state, b.transaction()), /external-area beNegated/);
  });
  test(`${master}: copied skills require reviewed original grant identity`, () => {
    const b = board(master), a = b.put("king", "DB1-066");
    b.state.effects.push({ id: 90, target: a.card, kind: "copiedSkills", value: 0, until: "turn", createdTurn: 1, ownerTurn: master, master });
    assert.throws(() => b.advance([a]), /reviewed grant identities/);
  });
  test(`${master}: empty prior observation still validates history`, () => {
    const b = board(master); const transaction = b.transaction(); transaction.history.observation = "corrupt";
    assert.throws(() => observe(ctx, b.state, transaction), /not been settled/);
  });
}
console.log(`standing-negation observation prototype: ${cases} cases passed`);
