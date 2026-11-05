/** R435 native modal arrivals. SOURCE is a labeled mechanism fixture. */
import assert from "node:assert/strict";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript } from "../../src/lib/arena/vm/script";
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
  ENERGY: card("ENERGY", { colors: ["Red"] }),
  SOURCE: card("SOURCE", { skill: "[Activate: Main] Choose up to 2 Battle Cards from your hand and play them." }),
  SOURCEEMPTY: card("SOURCEEMPTY", { skill: "[Activate: Main] Place this card in its owner's Drop Area, then choose up to 2 Battle Cards from your hand and play them." }),
  DEFLECT: card("DEFLECT", { skill: "[Deflect]", power: 10000 }),
  BARRIER: card("BARRIER", { skill: "[Barrier]", power: 10000 }),
  HIGH: card("HIGH", { power: 25000, energyCost: 0, specifiedCost: {} }),
  UNISON: card("UNISON", { type: "UNISON", power: 10000, energyCost: 1, specifiedCost: {} }),
  LOW1: card("LOW1", { name: "First low", power: 10000 }),
  LOW2: card("LOW2", { name: "Second low", power: 20000 }),
  "DB2-030": card("DB2-030", { name: "Ultrasonic Exchange", type: "EXTRA", colors: ["Red"], energyCost: 2, specifiedCost: { Red: 1 },
    skill: "[Counter: Play] You can activate this skill if your opponent declares they're playing a Battle Card with 20000 power or less. Your opponent may place that Battle Card in their Drop Area instead of playing it. If they don't, they choose 1 of their Battle Cards and place it in its owner's Drop Area." }),
};
defs["P-162"] = card("P-162", {"name": "Announcer, Witness of History", "type": "BATTLE", "colors": ["Black"], "power": 20000, "characters": ["Announcer"], "traits": ["Earthling", "World Tournament"], "skill": "[Deflect] (This card isn't affected by [Counter: Play] skills.)<br>[Auto] When you play this card, if your Leader Card is a \u226aWorld Tournament\u226b card, choose up to 8 \u226aWorld Tournament\u226b cards from your hand with different names that aren't &lt;Announcer&gt; cards and play them.", "energyCost": 7});
defs["TB2-069"] = card("TB2-069", {"name": "Son Goku & Uub, Seeds of the Future", "type": "BATTLE", "colors": ["Blue"], "power": 40000, "characters": ["Son Goku", "Uub"], "traits": ["Saiyan", "Earthling", "World Tournament"], "skill": "[Double Strike]<br>[Dual Attack]<br>[Ultimate]<br>[Permanent] If your Leader Card is \u226aWorld Tournament\u226b and if there are 6 cards or more in both your Energy Area and your opponent's Energy Area, decrease this card's energy cost in your hand by 2.<br>[Auto] When this card attacks, choose up to 1 card each from your opponent's Life and Energy Areas, then place them at the bottom of their owner's deck in any order.", "energyCost": 8});
defs["TB2-044"] = card("TB2-044", {"name": "Best Buddy Chiaotzu", "type": "BATTLE", "colors": ["Green"], "power": 5000, "characters": ["Chiaotzu"], "traits": ["Earthling", "World Tournament"], "skill": "[Auto] When you combo with this card during your turn, choose up to 1 {Tien Shinhan, Trading Moves} in your Battle Area and switch it to Active Mode.", "energyCost": 1});
defs["P-162"].specifiedCost = {}; // Official image: seven generic, no specified orb.
defs.L.traits = ["World Tournament"];
const rows = Object.values(defs).flatMap(skillRecords).map((row, id) => ({ ...row, id, source: "compiler", status: "confirmed" }) as unknown as RuleRow);
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (player: PlayerId): PlayerId => player === "p1" ? "p2" : "p1";
function take(state: VmState, action: Action): VmState {
  const next = RULES.apply(ctx, copy(state), action).state as VmState;
  assert.equal(next.outcome, undefined, JSON.stringify(next.outcome));
  return next;
}
function fresh(first: PlayerId): VmState {
  let state = RULES.createGame(ctx, { seed: 435, p1: { name: "One", leader: "L", main: fifty("F") }, p2: { name: "Two", leader: "L", main: fifty("F") } }).state as VmState;
  for (const action of [{ type: "chooseFirst", player: state.chooser, first }, { type: "mulligan", player: first, redraw: false },
    { type: "mulligan", player: other(first), redraw: false }, { type: "charge", player: first, card: null }, { type: "endMain", player: first },
    { type: "charge", player: other(first), card: null }, { type: "endMain", player: other(first) }, { type: "charge", player: first, card: null }] as Action[]) state = take(state, action);
  return state;
}
function stage(state: VmState, player: PlayerId, def: string, area: string): string {
  const id = state.sides[player].zones.deck.at(-1)!;
  state.cards[id].cardId = def;
  assert.ok(moveCard(state, game, id, area, { owner: player }).ok);
  return id;
}
function passTo(state: VmState, kind: string): VmState {
  for (let n = 0; n < 50 && state.prompt.kind !== kind; n++) {
    const action = RULES.legalActions(ctx, state).map(item => item.action).find(item => item.type === "payCost" || item.type === "counter" && item.card === null || item.type === "orderPending" && item.index === 0);
    assert.ok(action, JSON.stringify(state.prompt)); state = take(state, action);
  }
  assert.equal(state.prompt.kind, kind); return state;
}
let cases = 0;
for (const player of ["p1", "p2"] as const) for (const empty of [true, false]) for (const firstAccept of [true, false]) for (const secondAccept of [true, false]) {
  let state = fresh(player);
  const source = stage(state, player, empty ? "SOURCEEMPTY" : "SOURCE", "battle");
  const first = stage(state, player, "LOW1", "hand"), second = stage(state, player, "LOW2", "hand");
  const counter = stage(state, other(player), "DB2-030", "hand");
  for (let n = 0; n < 2; n++) stage(state, other(player), "ENERGY", "energy");
  const activate = RULES.legalActions(ctx, state).map(item => item.action).find(item => item.type === "activate" && item.card === source);
  assert.ok(activate); state = take(state, activate); state = passTo(state, "counter");
  assert.ok(RULES.legalActions(ctx, state).some(item => item.action.type === "counter" && item.action.card === counter));
  state = take(state, { type: "counter", player: other(player), card: counter });
  state = passTo(state, "chooseCards");
  assert.equal(state.prompt.kind, "chooseCards");
  assert.equal(state.prompt.player, player);
  state = take(state, { type: "choose", player, cards: [first] });
  state = take(state, { type: "choose", player, cards: [second] });
  assert.equal(state.prompt.kind, "chooseMode");
  assert.equal(state.prompt.player, player);
  state = take(state, { type: "chooseMode", player, index: firstAccept ? 0 : 1 });
  // SOURCE remains in Battle; SOURCEEMPTY leaves before choosing the incoming cards.
  if (!firstAccept && state.prompt.kind === "chooseCards") state = take(state, { type: "choose", player, cards: [source] });
  assert.equal(state.prompt.kind, "chooseMode");
  assert.equal(state.sides[player].zones.battle.includes(second), false);
  state = take(state, { type: "chooseMode", player, index: secondAccept ? 0 : 1 });
  if (!secondAccept && state.prompt.kind === "chooseCards") state = take(state, { type: "choose", player, cards: [firstAccept ? source : first] });
  state = passTo(state, "main");
  assert.equal(state.sides[player].zones.drop.includes(first), firstAccept || !secondAccept);
  assert.equal(state.sides[player].zones.battle.includes(second), !secondAccept);
  assert.equal(state.sides[other(player)].zones.energy.filter(id => state.cards[id].mode === "rest").length, 2);
  assert.ok(state.sides[other(player)].zones.drop.includes(counter));
  assert.equal(state.skillPlayScopes, undefined);
  cases++;
}
// Actual P-162: use a legal low World Tournament card. The FAQ's named
// TB2-066 Announcer is excluded by P-162's actual print and is not substituted
// with altered attributes. This proves its mixed high/low mechanism legally.
for (const player of ["p1", "p2"] as const) for (const lowFirst of [true, false]) {
  let state = fresh(player);
  const source = stage(state, player, "P-162", "hand");
  const high = stage(state, player, "TB2-069", "hand"), low = stage(state, player, "TB2-044", "hand");
  const counter = stage(state, other(player), "DB2-030", "hand");
  for (let n = 0; n < 7; n++) stage(state, player, "ENERGY", "energy");
  for (let n = 0; n < 2; n++) stage(state, other(player), "ENERGY", "energy");
  const play = RULES.legalActions(ctx, state).map(item => item.action).find(item => item.type === "play" && item.card === source);
  assert.ok(play, JSON.stringify(RULES.rejectedActions?.(ctx, state, RULES.legalActions(ctx, state)).filter(item => JSON.stringify(item).includes(source)))); state = take(state, play);
  let reached = false;
  for (let n = 0; n < 40; n++) {
    if (state.prompt.kind === "counter" && state.skillPlayScopes?.some(scope => scope.source === source && scope.profile.arrivals === "many")) { reached = true; break; }
    const action = RULES.legalActions(ctx, state).map(item => item.action).find(item => item.type === "payCost" || item.type === "counter" && item.card === null || item.type === "orderPending" && item.index === 0);
    assert.ok(action, JSON.stringify(state.prompt)); state = take(state, action);
  }
  assert.ok(reached, "actual P-162 Auto has its own before window");
  state = take(state, { type: "counter", player: other(player), card: counter });
  state = passTo(state, "chooseCards");
  for (const id of lowFirst ? [low, high] : [high, low]) state = take(state, { type: "choose", player, cards: [id] });
  if (state.prompt.kind === "chooseCards") state = take(state, { type: "choose", player, cards: [] });
  assert.equal(state.prompt.kind, "chooseMode");
  assert.equal(state.programs.find(frame => frame.arrivalDecision)?.arrivalDecision?.arrival.card, low);
  state = take(state, { type: "chooseMode", player, index: 0 });
  state = passTo(state, "main");
  assert.ok(state.sides[player].zones.battle.includes(high));
  assert.ok(state.sides[player].zones.drop.includes(low));
  assert.ok(state.sides[player].zones.battle.includes(source));
  assert.equal(state.skillPlayScopes, undefined);
  cases++;
}
for (const player of ["p1", "p2"] as const) for (const incomingDeflect of [false, true]) for (const protection of ["LOW1", "DEFLECT", "BARRIER"]) {
  let state = fresh(player);
  const source = stage(state, player, "SOURCEEMPTY", "battle"), incoming = stage(state, player, incomingDeflect ? "DEFLECT" : "LOW2", "hand");
  const existing = stage(state, player, protection, "battle"), otherExisting = stage(state, player, "LOW1", "battle");
  const counter = stage(state, other(player), "DB2-030", "hand");
  for (let n = 0; n < 2; n++) stage(state, other(player), "ENERGY", "energy");
  const activate = RULES.legalActions(ctx, state).map(item => item.action).find(item => item.type === "activate" && item.card === source);
  assert.ok(activate); state = take(state, activate); state = passTo(state, "counter");
  state = take(state, { type: "counter", player: other(player), card: counter }); state = passTo(state, "chooseCards");
  state = take(state, { type: "choose", player, cards: [incoming] });
  state = take(state, { type: "choose", player, cards: [] });
  if (!incomingDeflect) { assert.equal(state.prompt.kind, "chooseMode"); state = take(state, { type: "chooseMode", player, index: 1 }); }
  // The opponent's skill cannot choose Barrier. Deflect is selectable but
  // remains unaffected when that Counter subsequently tries to move it.
  if (protection !== "BARRIER") {
    assert.equal(state.prompt.kind, "chooseCards");
    if (state.prompt.kind !== "chooseCards") throw new Error("fallback chooser");
    assert.ok(state.prompt.choice.candidates.includes(existing));
    assert.ok(!state.prompt.choice.candidates.includes(incoming));
    state = take(state, { type: "choose", player, cards: [existing] });
  }
  state = passTo(state, "main");
  assert.ok(state.sides[player].zones.battle.includes(incoming));
  assert.equal(state.sides[player].zones.drop.includes(existing), protection === "LOW1");
  assert.equal(state.sides[player].zones.drop.includes(otherExisting), protection === "BARRIER");
  cases++;
}
for (const player of ["p1", "p2"] as const) for (const route of ["mandatory", "declineReplacement", "acceptReplacement"] as const) {
  let state = fresh(player);
  const source = stage(state, player, "SOURCEEMPTY", "battle"), incoming = stage(state, player, "LOW2", "hand");
  const existing = stage(state, player, "LOW1", "battle"), counter = stage(state, other(player), "DB2-030", "hand");
  for (let n = 0; n < 2; n++) stage(state, other(player), "ENERGY", "energy");
  // Typed mechanism fixture: only a skill/effect departure controlled by the
  // opponent, never a payment. This catches using the strict cost host as proof.
  assert.equal(stepScript(vmHost(ctx, game, state, []), { ops: [{ op: "replaceLeave", requestedTo: "drop", to: "warp", by: "skill", bySide: "opponent", optional: route !== "mandatory", until: "turn", target: { var: "incoming" } }],
    ip: 0, vars: { incoming: [incoming] }, card: state.sides[player].zones.leader[0], master: player }), "done");
  const activate = RULES.legalActions(ctx, state).map(item => item.action).find(item => item.type === "activate" && item.card === source);
  assert.ok(activate); state = take(state, activate); state = passTo(state, "counter");
  state = take(state, { type: "counter", player: other(player), card: counter }); state = passTo(state, "chooseCards");
  state = take(state, { type: "choose", player, cards: [incoming] }); state = take(state, { type: "choose", player, cards: [] });
  if (route !== "mandatory") {
    assert.equal(state.prompt.kind, "chooseMode");
    state = take(state, { type: "chooseMode", player, index: 0 });
    assert.equal(state.prompt.kind, "replaceMove");
    if (state.prompt.kind !== "replaceMove") throw new Error("effect replacement");
    state = take(state, { type: "chooseMode", player, index: route === "declineReplacement" ? state.prompt.options.length - 1 : 0 });
  }
  state = passTo(state, "main");
  assert.equal(state.sides[player].zones.battle.includes(incoming), route === "mandatory");
  assert.equal(state.sides[player].zones.drop.includes(incoming), route === "declineReplacement");
  assert.equal(state.sides[player].zones.warp.includes(incoming), route === "acceptReplacement");
  assert.equal(state.sides[player].zones.drop.includes(existing), route !== "declineReplacement");
  cases++;
}
// Known high declarations still allow activation; qualification is not an
// admission gate. No decision or fallback can occur for this arrival.
for (const player of ["p1", "p2"] as const) for (const type of ["HIGH", "UNISON"]) {
  let state = fresh(player);
  const incoming = stage(state, player, type, "hand");
  stage(state, player, "ENERGY", "energy");
  const existing = stage(state, player, "LOW1", "battle");
  const counter = stage(state, other(player), "DB2-030", "hand");
  for (let n = 0; n < 2; n++) stage(state, other(player), "ENERGY", "energy");
  const play = RULES.legalActions(ctx, state).map(item => item.action).find(item => (item.type === "play" || item.type === "playUnison") && item.card === incoming);
  assert.ok(play); state = take(state, play); state = passTo(state, "counter");
  assert.ok(RULES.legalActions(ctx, state).some(item => item.action.type === "counter" && item.action.card === counter));
  state = take(state, { type: "counter", player: other(player), card: counter });
  state = passTo(state, "main");
  assert.ok(state.sides[player].zones[type === "UNISON" ? "unison" : "battle"].includes(incoming));
  assert.ok(state.sides[player].zones.battle.includes(existing));
  assert.ok(state.sides[other(player)].zones.drop.includes(counter));
  assert.equal(state.skillPlayScopes, undefined);
  cases++;
}
// A before-window template with no selected arrivals expires without offering
// a mode or sacrificing an already-present Battle Card.
for (const player of ["p1", "p2"] as const) {
  let state = fresh(player);
  const source = stage(state, player, "SOURCE", "battle");
  stage(state, player, "LOW1", "hand");
  const counter = stage(state, other(player), "DB2-030", "hand");
  for (let n = 0; n < 2; n++) stage(state, other(player), "ENERGY", "energy");
  const activate = RULES.legalActions(ctx, state).map(item => item.action).find(item => item.type === "activate" && item.card === source);
  assert.ok(activate); state = take(state, activate); state = passTo(state, "counter");
  state = take(state, { type: "counter", player: other(player), card: counter });
  state = passTo(state, "chooseCards");
  state = take(state, { type: "choose", player, cards: [] });
  state = passTo(state, "main");
  assert.ok(state.sides[player].zones.battle.includes(source));
  assert.equal(state.skillPlayScopes, undefined);
  cases++;
}
// An after-window activation has no future arrival. Existing and just-played
// cards must remain untouched even though the Counter is paid and activated.
for (const player of ["p1", "p2"] as const) {
  let state = fresh(player);
  const source = stage(state, player, "SOURCE", "battle");
  const incoming = stage(state, player, "LOW1", "hand");
  const counter = stage(state, other(player), "DB2-030", "hand");
  for (let n = 0; n < 2; n++) stage(state, other(player), "ENERGY", "energy");
  const activate = RULES.legalActions(ctx, state).map(item => item.action).find(item => item.type === "activate" && item.card === source);
  assert.ok(activate); state = take(state, activate); state = passTo(state, "counter");
  state = take(state, { type: "counter", player: other(player), card: null });
  state = passTo(state, "chooseCards");
  state = take(state, { type: "choose", player, cards: [incoming] });
  if (state.prompt.kind === "chooseCards") state = take(state, { type: "choose", player, cards: [] });
  state = passTo(state, "counter");
  assert.equal(state.resolving?.scopeWindow?.boundary, "after");
  state = take(state, { type: "counter", player: other(player), card: counter });
  state = passTo(state, "main");
  assert.ok(state.sides[player].zones.battle.includes(source));
  assert.ok(state.sides[player].zones.battle.includes(incoming));
  assert.ok(state.sides[other(player)].zones.drop.includes(counter));
  assert.equal(state.skillPlayScopes, undefined);
  cases++;
}
console.log(`counter-arrival-native-5: ${cases} native mechanism/stored-card cases passed`);
