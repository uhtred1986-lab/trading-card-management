/** Read-lifetime contracts. Source records are real; placement below is explicit
 * mechanism staging, not a paid-card or full-card admission claim. */
import assert from "node:assert/strict";
import areaSources from "./fixtures/combo-standing-source.json";
import underSources from "./fixtures/under-standing-observer-5.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { RULES } from "../../src/lib/arena/vm";
import type { Action, CardDef, EngineContext, GameEvent } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { readingBoard, attrsNow } from "../../src/lib/arena/vm/program";
import { withTokens } from "../../src/lib/arena/vm/cards";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { moved } from "../../src/lib/arena/vm/flow";
import { vmHost } from "../../src/lib/arena/vm/host";
import { addEffect, skillsNegated } from "../../src/lib/arena/vm/effects";
import { nativeUnderReadMatches } from "../../src/lib/arena/vm/under-native-read";
import { standingNegationReadSealMatches } from "../../src/lib/arena/vm/standing-negation-read";
import { validateStandingNegationRead } from "../../src/lib/arena/vm/standing-negation-runtime";
import { invalidateScopedStandingRead, scopedStandingReadMatches, withUncachedStandingReads } from "../../src/lib/arena/vm/standing-read-scope";
import { buildSnapshot, buildUnconcealedSnapshotForProof, withSnapshotReading } from "../../src/lib/arena/snapshot-core";
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let cases = 0;
function test(label: string, run: () => void) { run(); cases++; console.log(`PASS ${label}`); }
const allDefs: EngineContext["defs"] = { L: card("L", { type: "LEADER", skill: null }), F: card("F", { skill: null }) };
for (const [id, { card: c }] of Object.entries({ ...areaSources, ...underSources })) allDefs[id] = card(id, {
  name: c.name, type: c.type as CardDef["type"], colors: c.colors as CardDef["colors"], energyCost: c.cost === null ? null : Number(c.cost),
  power: c.power, characters: c.characters, traits: c.traits, skill: c.skill,
});
function setup(family: 1 | 2 | 3) {
  const defs = copy(Object.fromEntries(["L", "F", "DB1-066", ...(family >= 2 ? ["BT20-086"] : []), ...(family === 3 ? ["BT23-070", "BT1-034"] : [])].map(id => [id, allDefs[id]])));
  const ctx = withTokens({ defs, scripts: rulesFromRows(Object.values(defs).flatMap(skillRecords).map((row, id) =>
    ({ ...row, id, source: "compiler", status: row.unread.length ? "open" : "confirmed" }) as RuleRow), defs) });
  let state = RULES.createGame(ctx, { seed: 528,
    p1: { name: "One", leader: family >= 2 ? "BT20-086" : "L", main: family === 3 ? ["BT23-070", ...fifty("F").slice(1)] : fifty("F"), z: [] },
    p2: { name: "Two", leader: "L", main: fifty("F"), z: [] } }).state as VmState;
  for (const action of [{ type: "chooseFirst", player: state.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "pass", player: "p1" }] as Action[]) state = RULES.apply(ctx, state, action).state as VmState;
  assert.equal(state.prompt.kind, "main");
  const king = state.sides.p1.zones.deck.at(-1)!;
  state.cards[king].cardId = "DB1-066";
  // Dormant-source identity edit is validated, then the actual writer admits
  // its Battle occurrence and settles the original family ledger.
  validateStandingNegationRead(ctx, state);
  moved(ctx, game, state, [], king, "battle", { owner: "p1", reason: "effect" });
  const target = state.sides.p2.zones.deck.at(-1)!;
  if (family === 3) state.cards[target].cardId = "BT1-034";
  moved(ctx, game, state, [], target, "battle", { owner: "p2", reason: "effect" });
  if (family === 3) {
    const source = Object.values(state.cards).find(card => card.cardId === "BT23-070")!.id;
    moved(ctx, game, state, [], source, "drop", { owner: "p1", reason: "effect" });
    assert.equal(vmHost(ctx, game, state, []).placeUnder(source, target), true);
  }
  // Explicit later-turn staging exposes real cloned attack previews (the
  // first player cannot attack on turn 1). This is a read-equivalence fixture.
  state.turn = 3; state.turnPlayer = "p1"; state.prompt = { kind: "main", player: "p1" };
  return { ctx, state, king, target };
}
for (const family of [1, 2, 3] as const) {
  const base = setup(family);
  const fresh = () => ({ ...base, state: copy(base.state) });
  test(`v${family} exact public read parity and unchanged board`, () => {
    const { ctx, state, target } = fresh(), before = JSON.stringify(state);
    const read = () => {
      const menu = RULES.legalActions(ctx, state), rejected = RULES.rejectedActions(ctx, state, menu);
      const input = { id: 528, mode: "hotseat" as const, status: "playing", p1Name: "One", p2Name: "Two", ctx, state, legal: menu,
        log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, images: {} };
      return { menu, rejected, snapshot: buildSnapshot(input), unconcealed: buildUnconcealedSnapshotForProof(input), availability: RULES.abilityAvailability(ctx, state, "p1", menu, rejected),
        board: RULES.boardView(ctx, state, "p1", {}),
        power: readingBoard(ctx, game, state, () => attrsNow(ctx, game, state, target).power),
        negated: readingBoard(ctx, game, state, () => skillsNegated(state, target)) };
    };
    const raw = withUncachedStandingReads(read), cached = read();
    assert.deepEqual(cached, raw); assert.equal(JSON.stringify(state), before);
    assert.ok(cached.snapshot.attackPreviews?.some(entry => entry.state === "known"), "actual cloned attack preview reaches a battle");
    assert.equal(scopedStandingReadMatches(ctx, state), false);
  });
  for (const [label, mutate] of Object.entries({
    mode: (ctx: EngineContext, state: VmState, target: string) => { state.cards[target].mode = "rest"; },
    effect: (ctx: EngineContext, state: VmState, target: string) => { state.effects.push({ id: 987, target, kind: "power", value: 5000, until: "turn", createdTurn: state.turn, ownerTurn: "p1", master: "p1" }); },
    definition: (ctx: EngineContext) => { ctx.defs.F.power = (ctx.defs.F.power ?? 0) + 1000; },
    privateOrder: (ctx: EngineContext, state: VmState) => { state.sides.p1.zones.deck.reverse(); },
    program: (ctx: EngineContext) => { ctx.scripts!["DB1-066"].complete = !ctx.scripts!["DB1-066"].complete; },
  })) test(`v${family} successful raw ${label} mutation cannot return stale result`, () => {
    const { state, target } = fresh(), ctx = withTokens(copy({ defs: base.ctx.defs, scripts: base.ctx.scripts }));
    assert.throws(() => readingBoard(ctx, game, state, () => { attrsNow(ctx, game, state, target); mutate(ctx, state, target); return "stale"; }), /dependencies changed/);
    assert.equal(scopedStandingReadMatches(ctx, state), false);
  });
  for (const writer of ["move", "effect", "mode", "token", "runHostFrame"] as const) test(`v${family} ${writer} refuses before mutation and caught error poisons lifetime`, () => {
    const { ctx, state, target } = fresh(), ev: GameEvent[] = [], host = vmHost(ctx, game, state, ev), before = JSON.stringify(state);
    assert.throws(() => readingBoard(ctx, game, state, () => {
      assert.ok(scopedStandingReadMatches(ctx, state));
      assert.throws(() => {
        if (writer === "move") moveCard(state, game, target, "drop", { owner: "p2" });
        if (writer === "effect") addEffect(state, ev, { target, kind: "power", value: 5000, until: "turn" });
        if (writer === "mode") host.setMode(target, "rest");
        if (writer === "token") host.createToken("p1", "Scope token", 1000, 0, 0, []);
        if (writer === "runHostFrame") host.resume({ card: target, master: "p2", ops: [], ip: 0, vars: {} });
      }, /Cannot mutate/);
      validateStandingNegationRead(ctx, state);
      assert.equal(scopedStandingReadMatches(ctx, state), false);
      readingBoard(ctx, game, state, () => assert.equal(scopedStandingReadMatches(ctx, state), false));
    }), /dependencies changed/);
    assert.equal(JSON.stringify(state), before); assert.deepEqual(ev, []);
  });
  test(`v${family} nested identities, callback throw, clone writer and scope restoration`, () => {
    const { ctx, state, target } = fresh(), err = new Error("original callback");
    assert.throws(() => readingBoard(ctx, game, state, () => { throw err; }), error => error === err);
    assert.equal(scopedStandingReadMatches(ctx, state), false);
    assert.throws(() => readingBoard(ctx, game, state, () => Promise.resolve("late")), /synchronously/);
    assert.equal(scopedStandingReadMatches(ctx, state), false);
    readingBoard(ctx, game, state, () => {
      assert.ok(scopedStandingReadMatches(ctx, state));
      if (family !== 3) assert.equal(nativeUnderReadMatches(ctx, state), false, "a different family cannot authorize a native seal");
      if (family !== 1) assert.equal(standingNegationReadSealMatches(ctx, state), false, "a different family cannot authorize a legacy seal");
      readingBoard(ctx, game, state, () => assert.ok(scopedStandingReadMatches(ctx, state)));
      const ctx2 = withTokens(copy({ defs: ctx.defs, scripts: ctx.scripts }));
      readingBoard(ctx2, game, state, () => { assert.ok(scopedStandingReadMatches(ctx2, state)); assert.equal(scopedStandingReadMatches(ctx, state), false); });
      assert.ok(scopedStandingReadMatches(ctx, state)); assert.equal(skillsNegated(state, target), true);
      const otherGame = copy(game);
      readingBoard(ctx, otherGame, state, () => assert.equal(scopedStandingReadMatches(ctx, state), false));
      assert.ok(scopedStandingReadMatches(ctx, state));
      const projection = copy(state); assert.ok(moveCard(projection, game, target, "drop", { owner: "p2" }).ok);
    });
    assert.equal(scopedStandingReadMatches(ctx, state), false);
  });
  test(`v${family} public snapshot callback cannot mutate valid topology`, () => {
    const { ctx, state, target } = fresh();
    assert.throws(() => withSnapshotReading({ ctx, state }, () => { state.cards[target].mode = "rest"; }), /dependencies changed/);
  });
  test(`v${family} saved history corruption and cross-game mutation are still refused`, () => {
    const { ctx, state } = fresh();
    readingBoard(ctx, game, state, () => 1);
    const history = state.underStandingNegationHistory ?? state.mixedStandingNegationHistory ?? state.standingNegationHistory!;
    history.nextSerial = -1;
    assert.throws(() => readingBoard(ctx, game, state, () => 1));
    const clean = fresh().state;
    assert.throws(() => readingBoard(ctx, game, clean, () => { clean.game = "fusion"; }), /dependencies changed/);
  });
  test(`v${family} explicit invalidation and raw reseal cannot restore lifetime authority`, () => {
    const { ctx, state } = fresh();
    assert.throws(() => readingBoard(ctx, game, state, () => {
      invalidateScopedStandingRead(state); validateStandingNegationRead(ctx, state);
      assert.equal(scopedStandingReadMatches(ctx, state), false);
    }), /dependencies changed/);
    readingBoard(ctx, game, state, () => assert.ok(scopedStandingReadMatches(ctx, state)));
  });
  test(`v${family} actual pinned definition mutation and identity replacement are rejected`, () => {
    for (const replace of [false, true]) {
      const { state } = fresh(), pinnedGame = copy(game);
      const pinnedContext = { defs: base.ctx.defs, scripts: base.ctx.scripts, rulesetDefinition: pinnedGame };
      const ctx = withTokens(pinnedContext);
      assert.throws(() => readingBoard(ctx, pinnedGame, state, () => {
        if (replace) Object.assign(ctx, { rulesetDefinition: copy(pinnedGame) });
        else pinnedGame.zones.battle.inPlay = !pinnedGame.zones.battle.inPlay;
      }), /dependencies changed/);
    }
  });
  test(`v${family} missing and multiple saved families keep their refusal`, () => {
    for (const multiple of [false, true]) {
      const { ctx, state } = fresh();
      if (multiple) Object.assign(state, family === 1 ? { mixedStandingNegationHistory: {} } : { standingNegationHistory: {} });
      else { delete state.standingNegationHistory; delete state.mixedStandingNegationHistory; delete state.underStandingNegationHistory; }
      assert.throws(() => readingBoard(ctx, game, state, () => 1));
    }
  });
  test(`v${family} caught nested writer poisons both contexts on the original board`, () => {
    const { ctx, state, target } = fresh(), ctx2 = withTokens(copy({ defs: ctx.defs, scripts: ctx.scripts })), before = JSON.stringify(state);
    assert.throws(() => readingBoard(ctx, game, state, () => {
      assert.throws(() => readingBoard(ctx2, game, state, () => {
        assert.throws(() => moveCard(state, game, target, "drop", { owner: "p2" }), /Cannot mutate/);
      }), /dependencies changed/);
      assert.equal(scopedStandingReadMatches(ctx, state), false);
      validateStandingNegationRead(ctx, state);
      assert.equal(scopedStandingReadMatches(ctx, state), false);
    }), /dependencies changed/);
    assert.equal(JSON.stringify(state), before);
  });
  test(`v${family} throwing mutated callbacks preserve their original exception and never leak scope`, () => {
    const { ctx, state, target } = fresh(), original = new Error("callback owns this error");
    assert.throws(() => withSnapshotReading({ ctx, state }, () => {
      state.cards[target].mode = "rest"; throw original;
    }), error => error === original);
    assert.equal(scopedStandingReadMatches(ctx, state), false);
    readingBoard(ctx, game, state, () => assert.ok(scopedStandingReadMatches(ctx, state)));
    assert.throws(() => readingBoard(ctx, game, state, () => {
      readingBoard(ctx, game, state, () => Promise.resolve("discarded nested result"));
    }), /synchronously/);
  });
  const { ctx, state } = fresh();
  const startRaw = performance.now(), raw = withUncachedStandingReads(() => RULES.legalActions(ctx, state)), endRaw = performance.now();
  const enabled = RULES.legalActions(ctx, state), endEnabled = performance.now();
  assert.deepEqual(enabled, raw);
  console.log(`BENCH v${family} legalActions raw=${(endRaw-startRaw).toFixed(1)}ms scope=${(endEnabled-endRaw).toFixed(1)}ms`);
}
console.log(`standing-read-scope-5: ${cases} PASS`);
