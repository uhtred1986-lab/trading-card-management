/** R513 stage 2a: real board observation/transaction, no live writer hookup. */
import assert from "node:assert/strict";
import fixtures from "./fixtures/combo-standing-source.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { EngineContext, PlayerId, Area } from "../../src/lib/arena/types";
import { newCard } from "../../src/lib/arena/vm/zones";
import { addEffect, endEffects } from "../../src/lib/arena/vm/effects";
import { resolvedGrantDeleted } from "../../src/lib/arena/vm/resolved-grant-deletion";
import { emptyStandingNegationHistory } from "../../src/lib/arena/vm/standing-negation-history";
import { mixedStandingOccurrences } from "../../src/lib/arena/vm/standing-negation-mixed-observation";
import { initializeMixedStandingNegation as initialize, captureMixedStandingNegationMutation as capture,
  settleMixedStandingNegationMutation as settle, assertMixedStandingNegationSettled as check } from "../../src/lib/arena/vm/standing-negation-mixed-transaction";
import type { MixedStandingState as State, MixedStandingNegationMutation as Token } from "../../src/lib/arena/vm/standing-negation-mixed-transaction";
import { mixedStandingSkillsNegated as negated, mixedStandingNegationReadSealMatches as seal } from "../../src/lib/arena/vm/standing-negation-mixed-read";
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const defs: EngineContext["defs"] = { L: card("L", { type: "LEADER" }), F: card("F", {}),
  PROTECTED: card("PROTECTED", { skill: "[Permanent] This card's skills can't be negated in any area." }),
  GRANT: card("GRANT", { skill: "[Permanent] All of your Battle Cards gain [Blocker]." }) };
for (const [id, f] of Object.entries(fixtures)) defs[id] = card(id, f.card as Parameters<typeof card>[1]);
function context(definitions = defs): EngineContext {
  return { defs: definitions, scripts: rulesFromRows(Object.values(definitions).flatMap(skillRecords)
    .map((row, id) => ({ ...row, id, source: "compiler", status: "draft" }) as unknown as RuleRow), definitions) };
}
const ctx = context();
function setup(p: PlayerId) {
  // Native createGame now initializes the mixed family. This mechanism suite
  // still owns the staged mutation protocol; the full context adds no live source.
  const initial = context({ L: defs.L, F: defs.F, "BT20-086": defs["BT20-086"] });
  const state = RULES.createGame(initial, { seed: 513, p1: { name: "one", leader: p === "p1" ? "BT20-086" : "L", main: fifty("F") },
    p2: { name: "two", leader: p === "p2" ? "BT20-086" : "L", main: fifty("F") } }).state as State;
  check(ctx, game, state);
  const source = state.sides[p].zones.leader[0], guard = state.sides[other(p)].zones.leader[0];
  function raw(id: string, def: string, holder: PlayerId, area: Area, owner = holder) {
    state.cards[id] = newCard(id, def, owner); state.sides[holder].zones[area].push(id); return id;
  }
  function enter(id: string, def: string, holder: PlayerId, area: Area, owner = holder) {
    const token = capture(ctx, game, state); raw(id, def, holder, area, owner);
    settle(ctx, game, state, token, { arrivals: mixedStandingOccurrences(ctx, game, state).filter(card => card.card === id) }); return id;
  }
  function move(id: string, from: Area, to: Area, holder: PlayerId, destination = holder) {
    const token = capture(ctx, game, state);
    state.sides[holder].zones[from] = state.sides[holder].zones[from].filter(card => card !== id);
    state.sides[destination].zones[to].push(id);
    // Deliberately unchanged epoch proves area and holder are identity inputs.
    settle(ctx, game, state, token, { arrivals: mixedStandingOccurrences(ctx, game, state).filter(card => card.card === id) });
  }
  function fight(on = true) {
    const token = capture(ctx, game, state);
    state.battle = on ? { attacker: source, guard, target: guard, step: "offense", negated: false, blockerOffered: false, counters: [] } : null;
    settle(ctx, game, state, token, { battle: { kind: on ? "begin" : "end" } });
  }
  function own(n: number) { for (let i = 0; i < n; i++) enter(`own${i}`, "F", p, "combo"); }
  return { state, source, guard, raw, enter, move, fight, own };
}
let cases = 0;
const test = (label: string, fn: () => void) => { fn(); cases++; console.log(`PASS ${label}`); };
for (const p of ["p1", "p2"] as const) {
  test(`${p} full actual Goku/Prum/Pan threshold and battle-role observation`, () => {
    const b = setup(p); b.enter("prum", "DB2-086", other(p), "combo"); b.enter("pan", "BT20-067", other(p), "combo");
    b.own(6); b.fight(); assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), false);
    b.enter("seventh", "F", p, "combo");
    assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), true);
    assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "pan"), true);
    b.fight(false); assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), false);
    b.fight(); assert.equal(b.state.mixedStandingNegationHistory!.active[0].serial, 2);
    b.move("seventh", "combo", "drop", p); assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), false);
  });
  test(`${p} printed owner does not replace physical Combo holder`, () => {
    const b = setup(p); b.own(6); b.fight(); b.enter("prum", "DB2-086", other(p), "combo", p);
    b.enter("foreignOwned", "F", p, "combo", other(p));
    assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), true);
    b.move("foreignOwned", "combo", "combo", p, other(p));
    assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), false);
  });
  test(`${p} original resolved keyword and copied Auto grants are deleted permanently`, () => {
    const b = setup(p); b.enter("prum", "DB2-086", other(p), "combo"); b.own(6); b.fight();
    const token = capture(ctx, game, b.state);
    const keyword = addEffect(b.state, [], { target: "prum", master: other(p), kind: "keyword", value: { name: "Blocker" }, until: "game" });
    const copied = addEffect(b.state, [], { target: "prum", master: other(p), kind: "copiedSkills", value: 0, until: "game",
      copied: { cardId: "DB2-086", side: "front", skills: [0] } });
    settle(ctx, game, b.state, token);
    assert.equal(resolvedGrantDeleted(b.state, "prum", keyword.id), false);
    b.enter("seventh", "F", p, "combo");
    for (const grant of [keyword, copied]) assert.equal(resolvedGrantDeleted(b.state, "prum", grant.id), true);
    b.move("seventh", "combo", "drop", p);
    for (const grant of [keyword, copied]) assert.equal(resolvedGrantDeleted(b.state, "prum", grant.id), true);
    const fresh = capture(ctx, game, b.state);
    const newGrant = addEffect(b.state, [], { target: "prum", kind: "keyword", value: { name: "Barrier" }, until: "game" });
    settle(ctx, game, b.state, fresh);
    assert.equal(resolvedGrantDeleted(b.state, "prum", newGrant.id), false);
    assert.ok(b.state.effects.includes(keyword)); assert.ok(b.state.effects.includes(copied));
  });
  test(`${p} departed opponent and negated attack retain surviving Goku through battle end`, () => {
    const b = setup(p); b.enter("prum", "DB2-086", other(p), "combo"); b.own(7);
    b.enter("opponent", "F", other(p), "battle");
    let token = capture(ctx, game, b.state);
    b.state.battle = { attacker: "opponent", guard: b.source, target: b.source, step: "defense", negated: false, blockerOffered: false, counters: [] };
    settle(ctx, game, b.state, token, { battle: { kind: "begin" } });
    const serial = b.state.mixedStandingNegationHistory!.active[0].serial;
    token = capture(ctx, game, b.state); b.state.battle.negated = true;
    settle(ctx, game, b.state, token); assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), true);
    token = capture(ctx, game, b.state);
    b.state.sides[other(p)].zones.battle = []; b.state.sides[other(p)].zones.warp.push("opponent"); b.state.cards.opponent.zoneEpoch = 1;
    assert.throws(() => settle(ctx, game, b.state, token), /retire changed/);
    settle(ctx, game, b.state, token, { battle: { kind: "retire", roles: ["attacker"] } });
    assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), true);
    assert.equal(b.state.mixedStandingNegationHistory!.active[0].serial, serial);
    const saved = clone(b.state); check(ctx, game, saved);
    assert.equal(negated(saved, saved.mixedStandingNegationHistory!, "prum"), true);
    token = capture(ctx, game, b.state); b.state.battle = null;
    assert.throws(() => settle(ctx, game, b.state, token), /explicit native assignment/);
    settle(ctx, game, b.state, token, { battle: { kind: "end" } });
    assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), false);
  });
  test(`${p} departed Goku does not inherit participation on same-ID reentry`, () => {
    const b = setup(p); b.enter("prum", "DB2-086", other(p), "combo"); b.own(7); b.fight();
    let token = capture(ctx, game, b.state);
    b.state.sides[p].zones.leader = []; b.state.sides[p].zones.warp.push(b.source); b.state.cards[b.source].zoneEpoch = 1;
    settle(ctx, game, b.state, token, { battle: { kind: "retire", roles: ["attacker"] } });
    assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), false);
    token = capture(ctx, game, b.state);
    b.state.sides[p].zones.warp = []; b.state.sides[p].zones.leader.push(b.source); b.state.cards[b.source].zoneEpoch = 2;
    const arrivals = mixedStandingOccurrences(ctx, game, b.state).filter(card => card.card === b.source);
    assert.throws(() => settle(ctx, game, b.state, token, { arrivals, battle: { kind: "assign", roles: ["attacker"] } }), /genuinely new/);
    settle(ctx, game, b.state, token, { arrivals });
    assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), false);
    check(ctx, game, clone(b.state));
    b.fight(false); b.fight();
    assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), true);
    assert.equal(b.state.mixedStandingNegationHistory!.active[0].serial, 2);
  });
  test(`${p} Hidden opposing participant retires without ending surviving Goku`, () => {
    const b = setup(p); b.enter("prum", "DB2-086", other(p), "combo"); b.own(7); b.enter("opponent", "F", other(p), "battle");
    let token = capture(ctx, game, b.state);
    b.state.battle = { attacker: "opponent", guard: b.source, target: b.source, step: "defense", negated: false, blockerOffered: false, counters: [] };
    settle(ctx, game, b.state, token, { battle: { kind: "begin" } });
    token = capture(ctx, game, b.state); b.state.cards.opponent.hidden = true;
    b.state.cards.opponent.hiddenCount = 1; b.state.battle.hiddenOut = true;
    settle(ctx, game, b.state, token, { arrivals: mixedStandingOccurrences(ctx, game, b.state).filter(card => card.card === "opponent"),
      battle: { kind: "retire", roles: ["attacker"] } });
    assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), true);
    token = capture(ctx, game, b.state); b.state.cards.opponent.hidden = false;
    settle(ctx, game, b.state, token);
    check(ctx, game, clone(b.state));
  });
  test(`${p} explicit distinct participant assignment binds the actual changed native role`, () => {
    const b = setup(p); b.own(7); b.fight(); b.enter("blocker", "F", other(p), "battle");
    const token = capture(ctx, game, b.state); b.state.battle!.guard = "blocker";
    assert.throws(() => settle(ctx, game, b.state, token), /native role record/);
    settle(ctx, game, b.state, token, { battle: { kind: "assign", roles: ["guard"] } });
    check(ctx, game, clone(b.state));
  });
  test(`${p} retirement requires a real occurrence change and cannot be replayed`, () => {
    const b = setup(p); b.own(7); b.fight();
    const token = capture(ctx, game, b.state), history = b.state.mixedStandingNegationHistory;
    assert.throws(() => settle(ctx, game, b.state, token, { battle: { kind: "retire", roles: ["attacker"] } }), /retire changed/);
    assert.equal(b.state.mixedStandingNegationHistory, history);
    b.state.sides[p].zones.leader = []; b.state.sides[p].zones.warp.push(b.source); b.state.cards[b.source].zoneEpoch = 1;
    assert.throws(() => check(ctx, game, b.state), /retire changed/);
    settle(ctx, game, b.state, token, { battle: { kind: "retire", roles: ["attacker"] } });
    const another = capture(ctx, game, b.state);
    assert.throws(() => settle(ctx, game, b.state, another, { battle: { kind: "retire", roles: ["attacker"] } }), /captured current/);
    for (const change of [(s: State) => { s.cards[b.source].zoneEpoch = -1; },
      (s: State) => { s.cards[b.source].zoneEpoch = Number.NaN; },
      (s: State) => { s.cards[b.source].owner = other(p); },
      (s: State) => { s.cards[b.source].cardId = "F"; }]) {
      const bad = clone(b.state); change(bad);
      assert.throws(() => check(ctx, game, bad), /historical mixed participant/);
    }
  });
  test(`${p} full Whis self-protection applies in Battle, not after Combo transfer`, () => {
    const b = setup(p); b.enter("whis", "BT1-043", other(p), "battle");
    b.enter("king", "DB1-066", p, "battle");
    assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "whis"), false);
    b.own(7); b.fight(); b.move("whis", "battle", "combo", other(p));
    assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "whis"), true);
  });
  test(`${p} new grant under active policy is deleted before settled read`, () => {
    const b = setup(p); b.enter("prum", "DB2-086", other(p), "combo"); b.own(7); b.fight();
    const token = capture(ctx, game, b.state);
    const grant = addEffect(b.state, [], { target: "prum", kind: "keyword", value: { name: "Barrier" }, until: "game" });
    assert.throws(() => check(ctx, game, b.state), /newly granted/);
    settle(ctx, game, b.state, token); assert.equal(resolvedGrantDeleted(b.state, "prum", grant.id), true);
    assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), true);
  });
  test(`${p} actual observation, seal reads and capture preserve input references`, () => {
    const b = setup(p); b.enter("prum", "DB2-086", other(p), "combo"); b.own(7); b.fight();
    const before = JSON.stringify(b.state), pending = b.state.pending, programs = b.state.programs, effects = b.state.effects;
    check(ctx, game, b.state); mixedStandingOccurrences(ctx, game, b.state);
    const token = capture(ctx, game, b.state); assert.equal(JSON.stringify(b.state), before);
    settle(ctx, game, b.state, token);
    assert.equal(JSON.stringify(b.state), before); assert.equal(b.state.pending, pending);
    assert.equal(b.state.programs, programs); assert.equal(b.state.effects, effects);
  });
  test(`${p} independent copied-state transaction cannot mutate live grant history`, () => {
    const b = setup(p); b.enter("prum", "DB2-086", other(p), "combo"); b.own(6); b.fight();
    let token = capture(ctx, game, b.state);
    const grant = addEffect(b.state, [], { target: "prum", kind: "keyword", value: { name: "Blocker" }, until: "game" });
    settle(ctx, game, b.state, token);
    const before = JSON.stringify(b.state), projected = clone(b.state);
    token = capture(ctx, game, projected);
    projected.cards.projectedSeventh = newCard("projectedSeventh", "F", p);
    projected.sides[p].zones.combo.push("projectedSeventh");
    settle(ctx, game, projected, token, { arrivals: mixedStandingOccurrences(ctx, game, projected).filter(card => card.card === "projectedSeventh") });
    assert.equal(resolvedGrantDeleted(projected, "prum", grant.id), true);
    assert.equal(resolvedGrantDeleted(b.state, "prum", grant.id), false);
    assert.equal(JSON.stringify(b.state), before);
  });
  test(`${p} source whole and line negation stop the policy; expiry creates new generation`, () => {
    const b = setup(p); b.enter("prum", "DB2-086", other(p), "combo"); b.own(7); b.fight();
    for (const kind of ["negateSkills", "negateSkill"] as const) {
      let token = capture(ctx, game, b.state);
      addEffect(b.state, [], { target: b.source, kind, value: kind === "negateSkill" ? 10 : 0, until: "turn" });
      settle(ctx, game, b.state, token); assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), false);
      token = capture(ctx, game, b.state); endEffects(b.state, [], "turn"); settle(ctx, game, b.state, token);
      assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), true);
    }
    assert.equal(b.state.mixedStandingNegationHistory!.active[0].serial, 3);
  });
  test(`${p} mixed King history retains grant deletion through same-epoch Combo carry`, () => {
    const b = setup(p); b.enter("prum", "DB2-086", other(p), "battle");
    const token = capture(ctx, game, b.state);
    const grant = addEffect(b.state, [], { target: "prum", kind: "keyword", value: { name: "Barrier" }, until: "game" });
    settle(ctx, game, b.state, token);
    b.enter("king", "DB1-066", p, "battle");
    assert.equal(resolvedGrantDeleted(b.state, "prum", grant.id), true);
    b.move("prum", "battle", "combo", other(p));
    assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), false);
    assert.equal(resolvedGrantDeleted(b.state, "prum", grant.id), true);
    b.own(7); b.fight(); assert.equal(negated(b.state, b.state.mixedStandingNegationHistory!, "prum"), true);
    assert.equal(b.state.mixedStandingNegationHistory!.active.find(g => g.source.card === "king")!.serial, 1);
  });
  test(`${p} forged captures, missing arrivals and stale roles refuse without publication`, () => {
    const b = setup(p), token = capture(ctx, game, b.state), original = b.state.mixedStandingNegationHistory;
    assert.throws(() => settle(ctx, game, clone(b.state), token), /original synchronous/);
    assert.throws(() => settle(ctx, game, b.state, clone(token) as Token), /original synchronous/);
    b.raw("new", "F", p, "combo"); assert.throws(() => settle(ctx, game, b.state, token), /arrivals/);
    assert.equal(b.state.mixedStandingNegationHistory, original);
    settle(ctx, game, b.state, token, { arrivals: mixedStandingOccurrences(ctx, game, b.state).filter(card => card.card === "new") });
    assert.throws(() => settle(ctx, game, b.state, token), /original synchronous/);
    b.state.battle = { attacker: b.source, guard: b.guard } as NonNullable<State["battle"]>;
    assert.equal(seal(ctx, b.state, b.state.mixedStandingNegationHistory!), false);
    assert.throws(() => check(ctx, game, b.state), /not been settled|explicit native assignment/);
  });
  test(`${p} missing original grant receipt cannot publish either ledger`, () => {
    const b = setup(p); b.enter("prum", "DB2-086", other(p), "combo"); b.own(7); b.fight();
    const token = capture(ctx, game, b.state), h = b.state.mixedStandingNegationHistory, receipts = b.state.resolvedGrantDeletions;
    b.state.effects.push({ id: 199, target: "prum", master: other(p), ownerTurn: p, createdTurn: 0, kind: "keyword", value: { name: "Blocker" }, until: "game" });
    assert.throws(() => settle(ctx, game, b.state, token), /grant/);
    assert.equal(b.state.mixedStandingNegationHistory, h); assert.equal(b.state.resolvedGrantDeletions, receipts);
  });
  for (const kind of ["copiedSource", "standingGrant", "timedProtection", "areaProtection"] as const) {
    test(`${p} explicitly bounded ${kind}`, () => {
      const b = setup(p); b.enter("ordinary", "F", other(p), "battle"); const token = capture(ctx, game, b.state);
      if (kind === "copiedSource") addEffect(b.state, [], { target: "ordinary", kind: "copiedSkills", value: 0, until: "game",
        copied: { cardId: "BT20-086", side: "front", skills: [10] } });
      if (kind === "standingGrant") b.raw("grant", "GRANT", p, "battle");
      if (kind === "timedProtection") addEffect(b.state, [], { target: "ordinary", kind: "forbid", value: 0, until: "turn", forbid: { what: "beNegated" } });
      if (kind === "areaProtection") b.raw("protect", "PROTECTED", other(p), "combo");
      const arrivals = mixedStandingOccurrences(ctx, game, b.state).filter(card => ["grant", "protect"].includes(card.card));
      assert.throws(() => settle(ctx, game, b.state, token, { arrivals }), /copied|grant|protect|Permanent/);
    });
  }
  test(`${p} save validation reissues seal only after actual observer and grant checks`, () => {
    const b = setup(p); b.enter("prum", "DB2-086", other(p), "combo"); b.own(7); b.fight();
    const saved = clone(b.state); assert.equal(seal(ctx, saved, saved.mixedStandingNegationHistory!), false);
    check(ctx, game, saved); assert.equal(negated(saved, saved.mixedStandingNegationHistory!, "prum"), true);
    saved.sides[p].zones.combo.pop(); assert.throws(() => check(ctx, game, saved), /not been settled/);
  });
}
for (const [label, mutate] of Object.entries({
  missingProgram: (c: EngineContext) => { delete c.scripts!["BT20-086"].bySkill[10]; },
  changedPrice: (c: EngineContext) => { c.scripts!["BT20-086"].bySkill[10].price!.payment.orbs = { Yellow: 1 }; },
  changedCondition: (c: EngineContext) => { (c.scripts!["BT20-086"].bySkill[10].ops[0] as { cond: { atLeast: number } }).cond.atLeast = 6; },
  addedUsage: (c: EngineContext) => { c.scripts!["BT20-086"].bySkill[10].usage!.oncePerTurn = true; },
})) test(`actual stored source refuses ${label} before capture`, () => {
  const b = setup("p1"), changed = clone(ctx); mutate(changed);
  const before = JSON.stringify(b.state); assert.throws(() => capture(changed, game, b.state), /reviewed mixed/);
  assert.equal(JSON.stringify(b.state), before);
});
for (const options of [null, [], { arrivals: null }, { arrivals: [null] }, { invented: true }]) {
  test("malformed native transaction options refuse without ledger publication", () => {
    const b = setup("p1"), token = capture(ctx, game, b.state), history = b.state.mixedStandingNegationHistory;
    assert.throws(() => settle(ctx, game, b.state, token, options as unknown as Parameters<typeof settle>[4]), error => {
      assert.ok(error instanceof Error); assert.notEqual(error.name, "TypeError"); return /transaction/.test(error.message);
    });
    assert.equal(b.state.mixedStandingNegationHistory, history);
  });
}
test("unannounced departed battle role cannot invent retirement on a read", () => {
  const b = setup("p1"); b.fight(); const token = capture(ctx, game, b.state);
  b.state.sides.p1.zones.leader = []; b.state.sides.p1.zones.warp.push(b.source);
  assert.throws(() => settle(ctx, game, b.state, token), /retire changed/);
});
test("legacy-only contexts do not acquire mixed history", () => {
  const oldCtx = context({ L: defs.L, F: defs.F, "DB1-066": defs["DB1-066"] });
  const state = RULES.createGame(oldCtx, { seed: 1, p1: { name: "1", leader: "L", main: fifty("F") }, p2: { name: "2", leader: "L", main: fifty("F") } }).state as State;
  const before = JSON.stringify(state); initialize(oldCtx, game, state); assert.equal(JSON.stringify(state), before);
  assert.equal(state.mixedStandingNegationHistory, undefined);
});
test("legacy and affected missing histories cannot initialize as new games", () => {
  const b = setup("p1"); delete b.state.mixedStandingNegationHistory; b.state.standingNegationHistory = emptyStandingNegationHistory();
  assert.throws(() => initialize(ctx, game, b.state), /fresh native/);
  assert.throws(() => capture(ctx, game, b.state), /without migrating/);
  delete b.state.standingNegationHistory; b.state.turn = 1;
  assert.throws(() => initialize(ctx, game, b.state), /fresh native/);
  assert.throws(() => capture(ctx, game, b.state), /without migrating/);
});
console.log(`mixed standing-negation native adapters: ${cases} cases passed`);
