import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { stepScript } from "../../src/lib/arena/vm/script";
import { vmHost } from "../../src/lib/arena/vm/host";
/** R473 actual Launch permission; modified-price/filter fixtures are labeled. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const defs: Record<string, CardDef> = {
  F: card("F", {}), L: card("L", { type: "LEADER" }),
  ATTACKER: card("ATTACKER", { power: 10000 }), GUARD: card("GUARD", { power: 30000 }),
  ENERGY: card("ENERGY", { colors: ["Yellow"] }),
  ENERGYBLUE: card("ENERGYBLUE", { colors: ["Blue"] }),
};
defs["BT31-055"]=card("BT31-055",{"name": "Launch", "type": "LEADER", "colors": ["Yellow"], "power": 5000, "characters": ["Launch"], "traits": ["Earthling", "World Tournament"], "skill": "[auto] At the end of your turn, flip this card to its back side.\n[br]\n[auto] [limit 1] [burst 2] When your yellow ≪Earthling≫ card with an energy cost of 3 or more is played, add up to 1 yellow <Launch> card with an energy cost of 4 from your Drop to your hand.\n[br]\n[activate: main] [limit 1] [burst 2] Draw 1 card, then discard 1 card from your hand.", "energyCost": null, "back": {"name": "Launch, Transformed", "skill": "[auto] At the end of your opponent's turn, flip this card to its front side.\n[br]\n[permanent] If your Battle Card would be removed from a Battle Area or Combo Area, remove it from the game instead.\n[br]\n[permanent] You can use mono-yellow ≪Earthling≫ cards with 5000 combo power from your Drop in combos.\n[br]\n[activate: battle] [once per turn] If you have 3 or fewer cards in your Combo Area: Negate this card's skills for the battle.", "power": 5000}});
defs["BT31-066"]=card("BT31-066",{"name": "Launch, Violent Personality", "type": "BATTLE", "colors": ["Yellow"], "power": 20000, "characters": ["Launch"], "traits": ["Earthling", "World Tournament"], "skill": "[activate: main] [limit 1] {y}, if your opponent has 2 or more energy: Draw 1 card, play this card from your hand and flip your yellow <Launch> Leader with an original power of 5000 to its back side.\n[br]\n[activate: battle] [limit 1] If you have 3 or fewer cards in your Combo Area and flip your yellow <Launch> Leader with an original power of 10000 to its front side: Choose up to 1 of your yellow ≪Earthling≫ cards and that card gains [double strike] for the battle.", "energyCost": 4, "comboCost": 0, "comboPower": 5000, "specifiedCost": {"Yellow": 2}});
defs["BT31-064"]=card("BT31-064",{"name": "Bulma, Contest Spectator", "type": "BATTLE", "colors": ["Yellow"], "power": 1000, "characters": ["Bulma"], "traits": ["Earthling", "World Tournament"], "skill": "[auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 yellow ≪Earthling≫ card with an energy cost of 4 or less to your hand, then shuffle your deck.\n[br]\n[activate: main] [limit 1] [burst 1] {y}, if your Leader is a yellow <Launch> card, you have 3 or more energy and place this card from your Drop at the bottom of its owner's deck: Play up to 1 yellow skill-less Battle Card from your Drop.", "energyCost": 1, "comboCost": 0, "comboPower": 5000, "specifiedCost": {"Yellow": 1}});
// Battle power of the setup Leader is immaterial; official candidate combo
// stats and specified costs above were read from BT31-066/064 images.
// Explicit mechanism controls: these are not altered official printings.
for (const [id, changes] of Object.entries({ PAID: { comboCost: 1 }, MULTI: { colors: ["Yellow", "Green"] }, WRONGTRAIT: { traits: ["Saiyan"] }, WRONGPOWER: { comboPower: 10000 } })) {
  defs[id] = card(id, { ...defs["BT31-064"], ...changes, id, skill: "" } as Partial<CardDef>);
}
const rows = Object.values(defs).flatMap(skillRecords).map((row, id) => ({ ...row, id, source: "compiler", status: "confirmed" }) as unknown as RuleRow);
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (player: PlayerId): PlayerId => player === "p1" ? "p2" : "p1";
function take(state: VmState, action: Action): VmState {
  const next = RULES.apply(ctx, copy(state), action).state as VmState;
  assert.equal(next.outcome, undefined, JSON.stringify(next.outcome)); return next;
}
function fresh(first: PlayerId): VmState {
  let state = RULES.createGame(ctx, { seed: 473, p1: { name: "One", leader: "L", main: fifty("F") }, p2: { name: "Two", leader: "L", main: fifty("F") } }).state as VmState;
  for (const action of [{ type: "chooseFirst", player: state.chooser, first }, { type: "mulligan", player: first, redraw: false }, { type: "mulligan", player: other(first), redraw: false },
    { type: "charge", player: first, card: null }, { type: "endMain", player: first }, { type: "charge", player: other(first), card: null }, { type: "endMain", player: other(first) }, { type: "charge", player: first, card: null }] as Action[]) state = take(state, action);
  state.sides.p1.attrs.energyMarkers = 0; state.sides.p2.attrs.energyMarkers = 0;
  return state;
}
function stage(state: VmState, player: PlayerId, def: string, area: string): string {
  const id = state.sides[player].zones.deck.at(-1)!; state.cards[id].cardId = def;
  assert.ok(moveCard(state, game, id, area, { owner: player }).ok); return id;
}
function promptFor(state: VmState, player: PlayerId): VmState {
  for (let n = 0; n < 25; n++) {
    if (state.prompt.kind === "combo" && state.prompt.player === player) return state;
    const action = RULES.legalActions(ctx, state).map(item => item.action).find(item => item.type === "counter" && item.card === null || item.type === "pass" || item.type === "block" && item.card === null);
    assert.ok(action, JSON.stringify(state.prompt)); state = take(state, action);
  }
  throw new Error("no combo prompt");
}
function finish(state: VmState): VmState {
  for (let n = 0; n < 30 && state.prompt.kind !== "main"; n++) {
    const action = RULES.legalActions(ctx, state).map(item => item.action).find(item => item.type === "counter" && item.card === null || item.type === "pass" || item.type === "orderPending" && item.index === 0 || item.type === "zEnergyFromCombo" && item.card === null);
    assert.ok(action, JSON.stringify(state.prompt)); state = take(state, action);
  }
  assert.equal(state.prompt.kind, "main"); return state;
}
function setup(player: PlayerId, candidate: string, area = "drop", defense = false) {
  const turn = defense ? other(player) : player;
  let state = fresh(turn);
  const leader = state.sides[player].zones.leader[0]; state.cards[leader].cardId = "BT31-055"; state.cards[leader].flipped = true;
  const source = stage(state, player, candidate, area);
  const attacker = stage(state, turn, "ATTACKER", "battle"), guard = stage(state, other(turn), "GUARD", "battle");
  state.cards[guard].mode = "rest";
  state = take(state, { type: "attack", player: turn, attacker, target: guard }); state = promptFor(state, player);
  return { state, leader, source };
}
const snapshot = (state: VmState, viewer: PlayerId) => buildSnapshot({ id: 473, revision: 1, mode: "versus", status: "playing", p1Name: "One", p2Name: "Two", ctx, state, legal: [], log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
let cases = 0;
for (const player of ["p1", "p2"] as const) for (const defense of [false, true]) for (const candidate of ["BT31-066", "BT31-064"]) {
  const turn = defense ? other(player) : player;
  let state = fresh(turn);
  const leader = state.sides[player].zones.leader[0]; state.cards[leader].cardId = "BT31-055"; state.cards[leader].flipped = true;
  const source = stage(state, player, candidate, "drop");
  const attacker = stage(state, turn, "ATTACKER", "battle"), guard = stage(state, other(turn), "GUARD", "battle");
  state.cards[guard].mode = "rest";
  assert.ok(state.sides[player].zones.drop.includes(source), "reading Permanent never performs a combo");
  state = take(state, { type: "attack", player: turn, attacker, target: guard }); state = promptFor(state, player);
  assert.ok(RULES.legalActions(ctx, state).some(item => item.action.type === "combo" && item.action.card === source));
  state = take(state, { type: "combo", player, card: source });
  assert.ok(state.sides[player].zones.combo.includes(source));
  assert.equal(state.battle?.comboOrigins?.[source], "drop");
  state = finish(state);
  assert.ok(state.sides[player].zones.removed.includes(source), "R055 replaces end-of-battle Combo departure");
  cases++;
}
for (const player of ["p1", "p2"] as const) for (const candidate of ["MULTI", "WRONGTRAIT", "WRONGPOWER"]) {
  const { state, source } = setup(player, candidate);
  assert.ok(!RULES.legalActions(ctx, state).some(item => item.action.type === "combo" && item.action.card === source));
  assert.throws(() => take(state, { type: "combo", player, card: source }), /can't combo/);
  cases++;
}
for (const player of ["p1", "p2"] as const) {
  const { state, source, leader } = setup(player, "BT31-064");
  state.cards[leader].flipped = false;
  assert.ok(!RULES.legalActions(ctx, state).some(item => item.action.type === "combo" && item.action.card === source));
  cases++;
}
// The printed self-negation disables both permission and replacement for the
// battle, then both return when that duration ends.
for (const player of ["p1", "p2"] as const) {
  const setupState = setup(player, "BT31-064"); let state = setupState.state;
  const { source, leader } = setupState;
  state = take(state, { type: "combo", player, card: source });
  const activate = RULES.legalActions(ctx, state).map(item => item.action).find(item => item.type === "activate" && item.card === leader);
  assert.ok(activate); state = take(state, activate);
  const otherDrop = stage(state, player, "BT31-066", "drop");
  assert.ok(!RULES.legalActions(ctx, state).some(item => item.action.type === "combo" && item.action.card === otherDrop));
  state = finish(state); assert.ok(state.sides[player].zones.drop.includes(source));
  const attacker = stage(state, player, "ATTACKER", "battle"), guard = stage(state, other(player), "GUARD", "battle"); state.cards[guard].mode = "rest";
  state = take(state, { type: "attack", player, attacker, target: guard }); state = promptFor(state, player);
  assert.ok(RULES.legalActions(ctx, state).some(item => item.action.type === "combo" && item.action.card === source));
  cases++;
}
for (const player of ["p1", "p2"] as const) for (const area of ["hand", "battle", "drop"]) for (const defense of [false, true]) for (const fault of ["none", "missing", "sourceABA", "sourceHandMissing", "payerABA"] as const) {
  const prepared = setup(player, "PAID", area, defense); let state = prepared.state; const source = prepared.source;
  if (area !== "drop") state.cards[prepared.leader].flipped = false; // Ordinary-route controls exclude Launch's separate Battle-departure replacement.
  assert.ok(!RULES.legalActions(ctx, state).some(item => item.action.type === "combo" && item.action.card === source), "normal combo cost is not waived");
  const e1 = stage(state, player, "ENERGY", "energy"), e2 = stage(state, player, "ENERGYBLUE", "energy");
  state = take(state, { type: "combo", player, card: source });
  assert.equal(state.prompt.kind, "payCost"); if (state.prompt.kind !== "payCost") throw new Error("combo price prompt");
  assert.equal(state.prompt.comboDeclaration?.source.area, area);
  const option = state.prompt.options.findIndex(payment => payment.rest.includes(e1)); assert.ok(option >= 0);
  if (fault === "sourceABA" || fault === "sourceHandMissing") {
    assert.ok(moveCard(state, game, source, "warp", { owner: player }).ok);
    assert.ok(moveCard(state, game, source, fault === "sourceHandMissing" ? "hand" : area, { owner: player }).ok);
  }
  if (fault === "payerABA") {
    assert.ok(moveCard(state, game, e1, "hand", { owner: player }).ok); assert.ok(moveCard(state, game, e1, "energy", { owner: player }).ok);
  }
  if (fault === "missing" || fault === "sourceHandMissing") delete state.prompt.comboDeclaration;
  state = copy(state);
  for (const viewer of [player, other(player)]) {
    const publicView = JSON.stringify(snapshot(state, viewer));
    assert.ok(!publicView.includes('"comboDeclaration"')); assert.ok(!publicView.includes('"permissions"'));
    if (fault === "sourceHandMissing" && viewer !== player) assert.ok(!publicView.includes(JSON.stringify(source)), "old public Drop source now in private hand stays hidden");
  }
  if (fault === "none") {
    state = take(state, { type: "payCost", player, option });
    assert.ok(state.sides[player].zones.combo.includes(source)); assert.equal(state.battle?.comboOrigins?.[source], area);
    assert.equal(state.cards[e1].mode, "rest"); assert.equal(state.cards[e2].mode, "active");
  } else {
    assert.throws(() => RULES.apply(ctx, copy(state), { type: "payCost", player, option }), /rebuild.*combo|original combo/);
    assert.equal(state.cards[e1].mode, "active"); assert.equal(state.cards[e2].mode, "active");
    assert.ok(!state.sides[player].zones.combo.includes(source));
  }
  cases++;
}
for (const player of ["p1", "p2"] as const) {
  const { state, source, leader } = setup(player, "BT31-064");
  assert.equal(stepScript(vmHost(ctx, game, state, []), { ops: [{ op: "forbid", what: "combo", side: "you", until: "battle" }], ip: 0, vars: {}, card: leader, master: player }), "done");
  assert.ok(!RULES.legalActions(ctx, state).some(item => item.action.type === "combo" && item.action.card === source));
  assert.throws(() => take(state, { type: "combo", player, card: source }), /can't combo/); cases++;
}
// Typed extra grants and saved-state faults exercise permission ownership.
// They do not claim a player can interrupt an atomic payment with a new skill.
for (const player of ["p1", "p2"] as const) for (const fault of ["negated", "removed", "grantABA", "secondSurvives", "badFilter"] as const) {
  const prepared = setup(player, "PAID"); let state = prepared.state; const { source, leader } = prepared;
  const permit = skillRecords(defs["BT31-055"]).find(row => row.side === "back" && row.skillIndex === 20)!.ops[0];
  assert.equal(permit.op, "permit"); if (permit.op !== "permit") throw new Error("Launch permission");
  let grant = leader;
  if (fault !== "negated" && fault !== "badFilter") {
    state.cards[leader].flipped = false;
    grant = stage(state, player, "GUARD", "battle");
    const grants = fault === "secondSurvives" ? [grant, stage(state, player, "GUARD", "battle")] : [grant];
    for (const id of grants) assert.equal(stepScript(vmHost(ctx, game, state, []), { ops: [{ ...permit, target: { var: "grant" } }], ip: 0, vars: { grant: [id] }, card: id, master: player }), "done");
  }
  const e1 = stage(state, player, "ENERGY", "energy"), e2 = stage(state, player, "ENERGYBLUE", "energy");
  state = take(state, { type: "combo", player, card: source });
  assert.equal(state.prompt.kind, "payCost"); if (state.prompt.kind !== "payCost") throw new Error("grant payment");
  assert.equal(state.prompt.comboDeclaration?.permissions?.length, fault === "secondSurvives" ? 2 : 1);
  const option = state.prompt.options.findIndex(payment => payment.rest.includes(e1)); assert.ok(option >= 0);
  if (fault === "negated") assert.equal(stepScript(vmHost(ctx, game, state, []), { ops: [{ op: "negateSkills", target: { var: "grant" }, until: "battle" }], ip: 0, vars: { grant: [grant] }, card: leader, master: player }), "done");
  else if (fault === "badFilter") state.prompt.comboDeclaration!.permissions![0].filter = { colors: "bad" } as never;
  else {
    assert.ok(moveCard(state, game, grant, "warp", { owner: player }).ok);
    if (fault === "grantABA") assert.ok(moveCard(state, game, grant, "battle", { owner: player }).ok);
  }
  state = copy(state);
  if (fault === "secondSurvives") {
    state = take(state, { type: "payCost", player, option });
    assert.ok(state.sides[player].zones.combo.includes(source)); assert.equal(state.cards[e1].mode, "rest"); assert.equal(state.cards[e2].mode, "active");
  } else {
    assert.throws(() => RULES.apply(ctx, copy(state), { type: "payCost", player, option }), /rebuild.*combo|original Drop combo permission/);
    assert.equal(state.cards[e1].mode, "active"); assert.equal(state.cards[e2].mode, "active"); assert.ok(state.sides[player].zones.drop.includes(source));
  }
  cases++;
}
for (const player of ["p1", "p2"] as const) for (const foreign of ["card", "permission"] as const) {
  const prepared = setup(player, "BT31-064"); const state = prepared.state;
  let source = prepared.source;
  if (foreign === "card") source = stage(state, other(player), "BT31-064", "drop");
  else {
    state.cards[prepared.leader].flipped = false;
    const leader = state.sides[other(player)].zones.leader[0]; state.cards[leader].cardId = "BT31-055"; state.cards[leader].flipped = true;
  }
  assert.ok(!RULES.legalActions(ctx, state).some(item => item.action.type === "combo" && item.action.card === source));
  assert.throws(() => take(state, { type: "combo", player, card: source }), /can't combo/); cases++;
}
console.log(`launch-drop-combo-5: ${cases} native cases passed`);
