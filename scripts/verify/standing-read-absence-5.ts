/** Validated no-history read lifetimes. R533 fixture is an unchanged dependency
 * owned by that source slice. No inspection admission is asserted here. */
import assert from "node:assert/strict";
import attackSources from "./fixtures/incremental-look-attacks-5.json";
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
import { vmHost } from "../../src/lib/arena/vm/host";
import { mixedStandingNegationReadSealMatches, mixedStandingSkillsNegated } from "../../src/lib/arena/vm/standing-negation-mixed-read";
import { nativeUnderReadMatches } from "../../src/lib/arena/vm/under-native-read";
import { standingNegationReadSealMatches } from "../../src/lib/arena/vm/standing-negation-read";
import { scopedStandingReadMatches, withUncachedStandingReads } from "../../src/lib/arena/vm/standing-read-scope";
import { validateStandingNegationRead } from "../../src/lib/arena/vm/standing-negation-runtime";
import { buildSnapshot, withSnapshotReading } from "../../src/lib/arena/snapshot-core";
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const benchmarkOnly = process.argv.includes("--benchmark-only");
let cases = 0;
function test(label: string, run: () => void) { run(); cases++; console.log(`PASS ${label}`); }
function context(defs: EngineContext["defs"]) {
  return withTokens({ defs, scripts: rulesFromRows(Object.values(defs).flatMap(skillRecords).map((row, id) =>
    ({ ...row, id, source: "compiler", status: row.unread.length ? "open" : "confirmed" }) as RuleRow), defs) });
}
function setup(ctx: EngineContext, leader = "L") {
  let state = RULES.createGame(ctx, { seed: 533,
    p1: { name: "One", leader, main: fifty("F"), z: [] }, p2: { name: "Two", leader: "L", main: fifty("F"), z: [] } }).state as VmState;
  for (const action of [{ type: "chooseFirst", player: state.chooser, first: "p2" },
    { type: "mulligan", player: "p2", redraw: false }, { type: "mulligan", player: "p1", redraw: false },
    { type: "charge", player: "p2", card: null }, { type: "pass", player: "p2" },
    { type: "charge", player: "p1", card: null }] as Action[]) state = RULES.apply(ctx, state, action).state as VmState;
  assert.equal(state.turnPlayer, "p1"); assert.equal(state.prompt.kind, "main"); assert.ok(state.turn > 1);
  assert.equal(state.standingNegationHistory, undefined); assert.equal(state.mixedStandingNegationHistory, undefined); assert.equal(state.underStandingNegationHistory, undefined);
  return state;
}
function ordinary() {
  const ctx = context({ L: card("L", { type: "LEADER", skill: null }), F: card("F", { skill: null }) }), state = setup(ctx);
  const target = state.sides.p1.zones.deck.at(-1)!;
  assert.ok(moveCard(state, game, target, "battle", { owner: "p1" }).ok);
  return { ctx, state, target };
}
const baseline = ordinary();
function fresh() { return { ctx: withTokens(copy({ defs: baseline.ctx.defs, scripts: baseline.ctx.scripts })), state: copy(baseline.state), target: baseline.target }; }
if (!benchmarkOnly) {
  test("absence authority has no family seal and ends after the callback", () => {
    const { ctx, state } = fresh();
    readingBoard(ctx, game, state, () => {
      assert.ok(scopedStandingReadMatches(ctx, state));
      assert.equal(nativeUnderReadMatches(ctx, state), false); assert.equal(standingNegationReadSealMatches(ctx, state), false);
      assert.equal(Reflect.apply(mixedStandingNegationReadSealMatches, undefined, [ctx, state, undefined]), false);
      assert.throws(() => Reflect.apply(mixedStandingSkillsNegated, undefined, [ctx, state, undefined, state.sides.p1.zones.leader[0]]), /validate mixed standing-negation history/);
    });
    assert.equal(scopedStandingReadMatches(ctx, state), false);
  });
  test("ordinary actual menus, snapshots and saved input have exact raw parity", () => {
    const { ctx, state } = fresh(), before = JSON.stringify(state);
    const read = () => {
      const legal = RULES.legalActions(ctx, state), rejected = RULES.rejectedActions(ctx, state, legal);
      return { legal, rejected, availability: RULES.abilityAvailability(ctx, state, "p1", legal, rejected),
        snapshot: buildSnapshot({ id: 533, mode: "hotseat", status: "playing", p1Name: "One", p2Name: "Two", ctx, state, legal,
          log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, images: {} }) };
    };
    const raw = withUncachedStandingReads(read), enabled = read(); assert.deepEqual(enabled, raw);
    assert.ok(enabled.snapshot.attackPreviews?.some(preview => preview.state === "known"));
    assert.equal(JSON.stringify(state), before);
    assert.deepEqual(RULES.legalActions(ctx, copy(state)), enabled.legal);
  });
  for (const id of ["DB1-066", "BT20-086", "BT23-070"] as const) for (const inside of [false, true]) test(`${id} new physical standing source ${inside ? "inside" : "between"} reads refuses without migration`, () => {
    const { ctx, state, target } = fresh();
    const c = id === "BT23-070" ? underSources[id].card : areaSources[id].card;
    const def = card(id, { name: c.name, type: c.type as CardDef["type"], colors: c.colors as CardDef["colors"], energyCost: c.cost === null ? null : Number(c.cost), power: c.power, characters: c.characters, traits: c.traits, skill: c.skill });
    const scripts = context({ [id]: def }).scripts!;
    ctx.defs[id] = def; Object.assign(ctx.scripts!, scripts);
    readingBoard(ctx, game, state, () => assert.ok(scopedStandingReadMatches(ctx, state)));
    const mutate = () => { state.cards[id === "BT20-086" ? state.sides.p1.zones.leader[0] : id === "BT23-070" ? state.sides.p1.zones.deck[0] : target].cardId = id; };
    if (inside) assert.throws(() => readingBoard(ctx, game, state, mutate), /dependencies changed/);
    else { mutate(); assert.throws(() => RULES.legalActions(ctx, state)); }
    assert.equal(state.standingNegationHistory, undefined); assert.equal(state.mixedStandingNegationHistory, undefined); assert.equal(state.underStandingNegationHistory, undefined);
  });
  for (const inside of [false, true]) test(`changed full standing definition ${inside ? "inside" : "between"} reads cannot reuse absence`, () => {
    const { ctx, state } = fresh(), c = areaSources["DB1-066"].card;
    const mutate = () => {
      // Synthetic F identity with the complete known whole-negation text is
      // deliberately a definition-change control, not printed-card admission.
      ctx.defs.F = card("F", { ...ctx.defs.F, skill: c.skill });
      Object.assign(ctx.scripts!, context({ F: ctx.defs.F }).scripts);
    };
    readingBoard(ctx, game, state, () => 1);
    if (inside) assert.throws(() => readingBoard(ctx, game, state, mutate), /dependencies changed/);
    else { mutate(); assert.throws(() => RULES.legalActions(ctx, state)); }
  });
  test("benign definition replacement between questions produces a fresh value", () => {
    const { ctx, state, target } = fresh();
    const before = readingBoard(ctx, game, state, () => attrsNow(ctx, game, state, target).power);
    ctx.defs.F = { ...ctx.defs.F, power: Number(before) + 5000 };
    assert.equal(readingBoard(ctx, game, state, () => attrsNow(ctx, game, state, target).power), Number(before) + 5000);
  });
  test("absence raw mutation, caught writer and original exception retain the same boundaries", () => {
    const { ctx, state, target } = fresh(), ev: GameEvent[] = [], before = JSON.stringify(state);
    assert.throws(() => readingBoard(ctx, game, state, () => {
      assert.throws(() => vmHost(ctx, game, state, ev).setMode(target, "rest"), /Cannot mutate/);
      validateStandingNegationRead(ctx, state); assert.equal(scopedStandingReadMatches(ctx, state), false);
    }), /dependencies changed/);
    assert.equal(JSON.stringify(state), before); assert.deepEqual(ev, []);
    const err = new Error("unchanged callback exception");
    assert.throws(() => withSnapshotReading({ ctx, state }, () => { throw err; }), error => error === err);
    assert.equal(scopedStandingReadMatches(ctx, state), false);
    assert.throws(() => withSnapshotReading({ ctx, state }, () => state.sides.p1.zones.deck.reverse()), /dependencies changed/);
  });
  test("nested history and absence lifetimes bind their own actual board and context", () => {
    const { ctx, state } = fresh(), c = areaSources["DB1-066"].card;
    const historyCtx = context({ ...ctx.defs, "DB1-066": card("DB1-066", { name: c.name, type: c.type as CardDef["type"], colors: c.colors as CardDef["colors"], energyCost: c.cost === null ? null : Number(c.cost), power: c.power, characters: c.characters, traits: c.traits, skill: c.skill }) });
    const historyState = RULES.createGame(historyCtx, { seed: 533, p1: { name: "One", leader: "L", main: fifty("F") }, p2: { name: "Two", leader: "L", main: fifty("F") } }).state as VmState;
    assert.ok(historyState.standingNegationHistory);
    readingBoard(ctx, game, state, () => {
      assert.ok(scopedStandingReadMatches(ctx, state));
      readingBoard(historyCtx, game, historyState, () => {
        assert.ok(scopedStandingReadMatches(historyCtx, historyState));
        assert.equal(Reflect.apply(mixedStandingNegationReadSealMatches, undefined, [historyCtx, historyState, undefined]), false);
        assert.equal(scopedStandingReadMatches(ctx, state), false);
      });
      assert.ok(scopedStandingReadMatches(ctx, state));
      assert.equal(nativeUnderReadMatches(ctx, state), false);
    });
  });
  test("actual mixed family matcher still requires its legitimate original history", () => {
    const { ctx } = fresh(), c = areaSources["BT20-086"].card;
    const mixedCtx = context({ ...ctx.defs, "BT20-086": card("BT20-086", { name: c.name, type: c.type as CardDef["type"], colors: c.colors as CardDef["colors"], energyCost: c.cost === null ? null : Number(c.cost), power: c.power, characters: c.characters, traits: c.traits, skill: c.skill }) });
    // This is explicitly the same factory-started Z-Leader mechanism fixture
    // used by R513; it is not a paid Z-Awaken claim.
    const state = RULES.createGame(mixedCtx, { seed: 533, p1: { name: "One", leader: "BT20-086", main: fifty("F") }, p2: { name: "Two", leader: "L", main: fifty("F") } }).state as VmState;
    assert.ok(state.mixedStandingNegationHistory);
    readingBoard(mixedCtx, game, state, () => {
      assert.equal(mixedStandingNegationReadSealMatches(mixedCtx, state, state.mixedStandingNegationHistory!), true);
      assert.equal(Reflect.apply(mixedStandingNegationReadSealMatches, undefined, [mixedCtx, state, undefined]), false);
    });
  });
  test("absence lifetime retains exact pinned game and synchronous return contract", () => {
    const { ctx, state } = fresh(), pinnedGame = copy(game), pinnedContext = { ...ctx, rulesetDefinition: pinnedGame }, pinnedCtx = withTokens(pinnedContext);
    readingBoard(pinnedCtx, game, state, () => assert.equal(scopedStandingReadMatches(pinnedCtx, state), false));
    assert.throws(() => readingBoard(pinnedCtx, pinnedGame, state, () => { pinnedGame.attributes.power.layers = ["printed"]; }), /dependencies changed/);
    assert.throws(() => readingBoard(ctx, game, state, () => Promise.resolve(1)), /synchronously/);
    assert.equal(scopedStandingReadMatches(ctx, state), false);
  });
}
function benchmark(label: string, ctx: EngineContext, state: VmState) {
  const before = JSON.stringify(state);
  const start = performance.now(), raw = withUncachedStandingReads(() => RULES.legalActions(ctx, state)), middle = performance.now();
  const enabled = RULES.legalActions(ctx, state), end = performance.now();
  assert.deepEqual(enabled, raw); assert.equal(JSON.stringify(state), before);
  assert.ok(enabled.some(entry => entry.action.type === "attack"));
  console.log(`BENCH ${label} raw=${(middle-start).toFixed(1)}ms scope=${(end-middle).toFixed(1)}ms legal=${enabled.length}`);
}
benchmark("ordinary-small-board", baseline.ctx, baseline.state);
const source = attackSources.sources["BT23-072"];
interface SourceCard {
  id: string; name: string; type: string; colors: string[]; cost: string | null; power: number | null;
  characters: string[]; traits: string[]; skill: string | null; backName: string | null; backSkill: string | null;
}
const toDef = (c: SourceCard) => card(c.id, { name: c.name, type: c.type as CardDef["type"], colors: c.colors as CardDef["colors"], energyCost: c.cost === null ? null : Number(c.cost), specifiedCost: {}, power: c.power,
  comboCost: c.type === "LEADER" || c.type === "EXTRA" ? null : 0, comboPower: c.type === "LEADER" || c.type === "EXTRA" ? null : 5000,
  characters: c.characters, traits: c.traits, skill: c.skill, back: c.backName ? { name: c.backName, power: 15000, skill: c.backSkill } : null });
const zDefs: EngineContext["defs"] = { L: card("L", { type: "LEADER", skill: null }), F: card("F", { type: "EXTRA", colors: ["Red"], skill: null }), "BT23-072": toDef(source.card) };
for (const c of [...source.matchingCards, ...attackSources.fillers]) zDefs[c.id] = toDef(c);
const zCtx = context(zDefs), zState = setup(zCtx, "BT23-072");
while (zState.sides.p1.zones.deck.length > 30) assert.ok(moveCard(zState, game, zState.sides.p1.zones.deck.at(-1)!, "warp", { owner: "p1" }).ok);
const top = zState.sides.p1.zones.deck;
// Same full original R533 front/back and target definitions; the 50 synthetic
// Extra list is an engine fixture, not a tournament-legal deck claim. Ordered
// Deck targets are staged exactly as in the R533 fixture, with original skills.
for (let i = 0; i < top.length; i++) zState.cards[top[i]].cardId = attackSources.fillers[i].id;
source.matchingCards.forEach((c, i) => { zState.cards[top[i]].cardId = c.id; });
assert.equal(zState.standingNegationHistory, undefined); assert.equal(zState.mixedStandingNegationHistory, undefined); assert.equal(zState.underStandingNegationHistory, undefined);
for (const id of top.slice(0, 2)) assert.equal(readingBoard(zCtx, game, zState, () => attrsNow(zCtx, game, zState, id).comboPower), Math.max(0, (zDefs[zState.cards[id].cardId].comboPower ?? 0) - 5000));
benchmark("actual-R533-BT23-072", zCtx, zState);
console.log(`standing-read-absence-5: ${cases} contracts PASS; both benchmark outputs and inputs equal`);
