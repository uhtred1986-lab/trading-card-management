/** #672: ordinary self-combo Autos answer the 5-7 entry checkpoint. */
import assert from "node:assert/strict";
import { compileSkill } from "../../src/lib/arena/compile";
import { skillRecords } from "../../src/lib/arena/draft";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { comboEntryFromHand, comboEntrySelf } from "../../src/lib/arena/text/triggers";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { fire } from "../../src/lib/arena/vm/events";
import { moved } from "../../src/lib/arena/vm/flow";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { NotYet } from "../../src/lib/arena/vm/errors";
import { isVmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { EngineState } from "../../src/lib/arena/engines";
import { CTX, DEFS, IMPL, arenaG, card, leaderOf, zoneOf } from "./harness";

const ORDINARY = "[Auto] When this card is used in a combo, draw 1 card.";
const SHARED = "[Auto] When you combo with this card, if your Leader Card is blue and your life is at 4 or less, this card gains +10000 combo power for the duration of the turn. Then, choose up to 1 card in your opponent's Combo Area and return it to their owner's hand. Then, if there are no cards in your opponent's Combo Area, draw 1 card.";
const LATE = "[Auto] At the end of the battle after you combo with this card from your hand, play this card in Rest Mode.";
const HAND_ONLY = "[Auto] When this card in your hand is played or used in a combo, draw 1 card.";
DEFS["C672-ORDINARY"] = card("C672-ORDINARY", { skill: ORDINARY });
DEFS["C672-SHARED"] = card("C672-SHARED", { skill: SHARED });
DEFS["C672-LATE"] = card("C672-LATE", { skill: LATE });
DEFS["C672-PRICE"] = card("C672-PRICE", { comboCost: 1, skill: ORDINARY });
DEFS["C672-SUPER"] = card("C672-SUPER", { skill: `[Super Combo]\n${ORDINARY}` });
DEFS["C672-PLAY-OR-COMBO"] = card("C672-PLAY-OR-COMBO", { energyCost: 0, skill: "[Auto] When you play or combo with this card, draw 1 card." });
DEFS["C672-ATTACK-OR-COMBO"] = card("C672-ATTACK-OR-COMBO", { skill: "[Auto] When you attack or combo with this card, draw 1 card." });
DEFS["C672-HAND-ONLY"] = card("C672-HAND-ONLY", { skill: HAND_ONLY });
const fixtureIds = ["C672-ORDINARY", "C672-SHARED", "C672-LATE", "C672-PRICE", "C672-SUPER", "C672-PLAY-OR-COMBO", "C672-ATTACK-OR-COMBO", "C672-HAND-ONLY"];

try {

for (const [line, expected] of [
  [ORDINARY, true], [SHARED, true],
  ["[Auto] When you play or combo with this card, draw 1 card.", true],
  ["[Auto] When you attack or combo with this card, draw 1 card.", true],
  [HAND_ONLY, true],
  [LATE, false],
] as const) {
  const skill = parseSkills(line)[0]!;
  assert.equal(comboEntrySelf(skill), expected, line);
  assert.equal(skillRecords(card("C672-TEXT", { skill: line }))[0]?.trigger.includes("comboUsed"), expected, `compiled entry: ${line}`);
  if (expected) assert.deepEqual(compileSkill(skill).unsupported, [], `supported wording: ${line}`);
}
assert.deepEqual(skillRecords(DEFS["C672-ORDINARY"])[0]?.trigger, ["comboed", "comboUsed"], "legacy record name remains as an alias");
assert.deepEqual(skillRecords(DEFS["C672-LATE"])[0]?.trigger, ["comboed"], "explicit battle-end wording stays late");
assert.ok(skillRecords(DEFS["C672-SUPER"]).some((row) => row.trigger.includes("comboUsed")), "[Super Combo] does not hide its separate ordinary Auto");
assert.ok(skillRecords(DEFS["C672-PLAY-OR-COMBO"])[0]?.trigger.includes("played"));
assert.ok(skillRecords(DEFS["C672-ATTACK-OR-COMBO"])[0]?.trigger.includes("attacks"));
assert.equal(comboEntryFromHand(parseSkills(HAND_ONLY)[0]!), true);
assert.equal(comboEntryFromHand(parseSkills(ORDINARY)[0]!), false);

function take(state: EngineState, action: Action): { state: EngineState; events: GameEvent[] } {
  assert.ok(IMPL.legalActions(CTX, state).some((row) => JSON.stringify(row.action) === JSON.stringify(action)),
    `expected legal ${JSON.stringify(action)} at ${state.prompt.kind}`);
  return IMPL.apply(CTX, state, action);
}

function stage(state: EngineState, owner: PlayerId, cardId: string, area: "hand" | "battle" | "energy"): string {
  const id = zoneOf(state, owner, "deck").shift();
  assert.ok(id);
  state.cards[id].cardId = cardId;
  zoneOf(state, owner, area).push(id);
  if (area !== "hand") state.cards[id].mode = "active";
  return id;
}

function attack(state: EngineState): EngineState {
  return take(state, { type: "attack", player: "p1", attacker: leaderOf(state, "p1")!, target: leaderOf(state, "p2")! }).state;
}

function finish(state: EngineState): { state: EngineState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < 10 && state.prompt.kind !== "main"; i++) {
    const prompt = state.prompt;
    const action: Action = prompt.kind === "combo" ? { type: "pass", player: prompt.player }
      : prompt.kind === "zEnergyFromCombo" ? { type: "zEnergyFromCombo", player: prompt.player, card: null }
      : (() => { throw Error(`battle stopped at ${prompt.kind}`); })();
    const next = take(state, action);
    state = next.state;
    events.push(...next.events);
  }
  assert.equal(state.prompt.kind, "main");
  return { state, events };
}

function skills(events: GameEvent[], id: string): GameEvent[] {
  return events.filter((e) => e.type === "skill" && e.card === id);
}

// The legacy lane checks only the shared compiler aliases above. It keeps its
// frozen runtime oracle, while every game below uses the default rules VM.
// A self Auto resolves before combat and is not queued again on cleanup.
for (const [cardId, area] of [
["C672-ORDINARY", "hand"], ["C672-ORDINARY", "battle"],
["C672-SUPER", "hand"], ["C672-PLAY-OR-COMBO", "hand"],
["C672-ATTACK-OR-COMBO", "battle"],
] as const) {
let state = arenaG();
const combo = stage(state, "p1", cardId, area);
state = attack(state);
const handBefore = zoneOf(state, "p1", "hand").length;
const joined = take(state, { type: "combo", player: "p1", card: combo });
state = joined.state;
assert.equal(state.prompt.kind, "combo", "entry Auto resolves before the next combo offer");
assert.equal(skills(joined.events, combo).length, 1);
assert.equal(zoneOf(state, "p1", "hand").length, handBefore - Number(area === "hand") + 1);
state = JSON.parse(JSON.stringify(state)) as EngineState;
const ended = finish(state);
assert.equal(skills(ended.events, combo).length, 0, "no ordinary Auto on Combo-to-Drop");
assert.equal(ended.events.filter((e) => e.type === "move" && e.card === combo && e.from === "combo" && e.to === "drop").length, 1);
}

// Hand-qualified ordinary wording is narrower than general combo entry. The
// captured actual source (also used by #572's late Auto) survives the move.
for (const area of ["hand", "battle"] as const) {
let state = arenaG();
const combo = stage(state, "p1", "C672-HAND-ONLY", area);
state = attack(state);
const joined = take(state, { type: "combo", player: "p1", card: combo });
assert.equal(skills(joined.events, combo).length, Number(area === "hand"));
const ended = finish(joined.state);
assert.equal(skills(ended.events, combo).length, 0);
}

// The compound line still answers its other printed timing as well.
{
const state = arenaG();
const played = stage(state, "p1", "C672-PLAY-OR-COMBO", "hand");
const result = take(state, { type: "play", player: "p1", card: played });
assert.equal(skills(result.events, played).length, 1);
assert.ok(zoneOf(result.state, "p1", "battle").includes(played));
}

// An old confirmed `card_rules` row has only the historical trigger name.
// The new DSL maps its ordinary printed wording to entry, once, without
// rewriting that person's stored record.
{
const state = arenaG();
assert.ok(isVmState(state));
const combo = stage(state, "p1", "C672-ORDINARY", "hand");
const definition = rulesetFor("dbs");
assert.ok(definition.ok);
const oldScripts = Object.create(CTX.scripts) as typeof CTX.scripts;
const current = CTX.scripts["C672-ORDINARY"];
oldScripts["C672-ORDINARY"] = { ...current, bySkill: { ...current.bySkill, 0: { ...current.bySkill[0], trigger: ["comboed"] } } };
const oldCtx = { ...CTX, scripts: oldScripts };
assert.ok(moveCard(state, definition.definition, combo, "combo", { owner: "p1" }).ok);
fire(oldCtx, definition.definition, state, { event: "comboUsed", card: combo, controller: "p1", args: { to: "combo" } });
assert.deepEqual(state.pending.map((p) => [p.card, p.trigger]), [[combo, "comboUsed"]]);
state.pending = [];
moved(oldCtx, definition.definition, state, [], combo, "drop", { owner: "p1" });
assert.deepEqual(state.pending, [], "old confirmed row does not duplicate at cleanup");
}

// The next combo belongs to its own copy and master. A saved state between
// the two declarations keeps the first Auto already resolved.
{
let state = arenaG();
const first = stage(state, "p1", "C672-ORDINARY", "hand");
const second = stage(state, "p1", "C672-ORDINARY", "hand");
state = attack(state);
const one = take(state, { type: "combo", player: "p1", card: first });
assert.equal(skills(one.events, first).length, 1);
state = JSON.parse(JSON.stringify(one.state)) as EngineState;
const two = take(state, { type: "combo", player: "p1", card: second });
assert.equal(skills(two.events, first).length, 0);
assert.equal(skills(two.events, second).length, 1);
const ended = finish(two.state);
assert.equal(skills(ended.events, first).length + skills(ended.events, second).length, 0);
}

// A payable combo cost is charged before area entry and its Auto. An
// unaffordable declaration changes nothing, and a suspended payment survives
// a saved-game roundtrip without an early move or draw.
{
let state = arenaG();
const combo = stage(state, "p1", "C672-PRICE", "hand");
state = attack(state);
const before = JSON.stringify(state);
assert.throws(() => IMPL.apply(CTX, state, { type: "combo", player: "p1", card: combo }), IllegalAction);
assert.equal(JSON.stringify(state), before);
const energyA = stage(state, "p1", "V1", "energy");
const energyB = stage(state, "p1", "V-BLUE", "energy");
const ask = take(state, { type: "combo", player: "p1", card: combo });
assert.equal(ask.state.prompt.kind, "payCost");
assert.equal(skills(ask.events, combo).length, 0);
assert.ok(zoneOf(ask.state, "p1", "hand").includes(combo));
assert.equal(ask.state.cards[energyA].mode, "active");
assert.equal(ask.state.cards[energyB].mode, "active");
state = JSON.parse(JSON.stringify(ask.state)) as EngineState;
const waiting = JSON.stringify(state);
assert.throws(() => IMPL.apply(CTX, state, { type: "payCost", player: "p2", option: 0 }), IllegalAction);
assert.throws(() => IMPL.apply(CTX, state, { type: "payCost", player: "p1", option: 99 }), IllegalAction);
assert.equal(JSON.stringify(state), waiting, "invalid payment answers leave the saved source and cost unchanged");
const payment = IMPL.legalActions(CTX, state).find((row) => row.action.type === "payCost");
assert.ok(payment);
const paid = take(state, payment.action);
assert.equal(skills(paid.events, combo).length, 1);
assert.ok(zoneOf(paid.state, "p1", "combo").includes(combo));
assert.equal(Number(paid.state.cards[energyA].mode === "rest") + Number(paid.state.cards[energyB].mode === "rest"), 1);
const after = JSON.stringify(paid.state);
assert.throws(() => IMPL.apply(CTX, paid.state, payment.action), IllegalAction, "the completed payment cannot be replayed as a new entry");
assert.equal(JSON.stringify(paid.state), after);
}

// BT3-043's conditional bonus is present in power comparison; per the official FAQ (supersedes the 4 Oct 2026 owner ruling, #539)
// only the bonus needs the printed conditions, and the draw needs only an empty opponent Combo Area. The opponent's Combo Area
// is empty here, so no return choice is offered.
for (const [blue, life, draws] of [[true, 4, true], [true, 5, true], [false, 4, true]] as const) {
let state = arenaG();
if (blue) state.cards[leaderOf(state, "p1")!].cardId = "L-BLUE";
const lifeArea = zoneOf(state, "p1", "life");
zoneOf(state, "p1", "drop").push(...lifeArea.splice(life));
const combo = stage(state, "p1", "C672-SHARED", "hand");
state = attack(state);
const before = zoneOf(state, "p1", "hand").length;
const joined = take(state, { type: "combo", player: "p1", card: combo });
state = joined.state;
assert.equal(skills(joined.events, combo).length, 1, "BT3-043 resolves before another combo action");
assert.equal(zoneOf(state, "p1", "hand").length, before - 1 + Number(draws));
const ended = finish(state);
const compare = ended.events.find((e) => e.type === "powerCompare");
assert.ok(compare && compare.type === "powerCompare");
assert.equal(compare.attackPower, blue && life <= 4 ? 25000 : 15000);
assert.equal(skills(ended.events, combo).length, 0);
}

// Both masters may combo in one battle. BT3-043 returns a genuine opposing
// Combo Area card before comparison, then sees the area empty for its draw.
{
let state = arenaG();
const first = stage(state, "p1", "C672-ORDINARY", "hand");
const second = stage(state, "p2", "C672-SHARED", "hand");
const life = zoneOf(state, "p2", "life");
zoneOf(state, "p2", "drop").push(...life.splice(4));
state = attack(state);
const own = take(state, { type: "combo", player: "p1", card: first });
assert.equal(skills(own.events, first).length, 1);
state = take(own.state, { type: "pass", player: "p1" }).state;
const opposingHand = zoneOf(state, "p2", "hand").length;
const other = take(state, { type: "combo", player: "p2", card: second });
assert.equal(skills(other.events, first).length, 0);
assert.equal(other.state.prompt.kind, "chooseCards", "return choice occurs before combat");
const returned = take(JSON.parse(JSON.stringify(other.state)) as EngineState, { type: "choose", player: "p2", cards: [first] });
assert.equal(skills([...other.events, ...returned.events], second).length, 1);
assert.ok(zoneOf(returned.state, "p1", "hand").includes(first));
assert.equal(zoneOf(returned.state, "p2", "hand").length, opposingHand, "the emptied opposing Combo Area enables the draw");
const ended = finish(returned.state);
assert.ok(ended.events.some((e) => e.type === "powerCompare" && e.guardPower === 25000));
assert.equal(skills(ended.events, first).length + skills(ended.events, second).length, 0);
}

// The explicit 8-5-10-1 Auto stays late and is tied to a hand-origin entry.
{
let state = arenaG();
const combo = stage(state, "p1", "C672-LATE", "hand");
state = attack(state);
const joined = take(state, { type: "combo", player: "p1", card: combo });
assert.equal(skills(joined.events, combo).length, 0);
const ended = finish(joined.state);
assert.equal(skills(ended.events, combo).length, 1);
assert.ok(zoneOf(ended.state, "p1", "battle").includes(combo));
}

// 8-5-2 may take the already-triggered copy as Z-Energy. Its second area
// departure cannot manufacture a second ordinary Auto.
{
let state = arenaG({ z: ["V1"] });
const combo = stage(state, "p1", "C672-ORDINARY", "hand");
state = attack(state);
const joined = take(state, { type: "combo", player: "p1", card: combo });
assert.equal(skills(joined.events, combo).length, 1);
state = take(joined.state, { type: "pass", player: "p1" }).state;
state = take(state, { type: "pass", player: "p2" }).state;
assert.equal(state.prompt.kind, "zEnergyFromCombo");
const departure = take(state, { type: "zEnergyFromCombo", player: "p1", card: combo });
assert.ok(zoneOf(departure.state, "p1", "zEnergy").includes(combo));
assert.equal(skills(departure.events, combo).length, 0);
const ended = departure.state.prompt.kind === "main" ? departure : finish(departure.state);
assert.equal(skills(ended.events, combo).length, 0);
}

// A synthetic moment cannot invent an arrival when the card did not join
// Combo Area. The opponent's public snapshot must not expose its identity.
{
const state = arenaG();
assert.ok(isVmState(state));
const combo = stage(state, "p1", "C672-ORDINARY", "hand");
const definition = rulesetFor("dbs");
assert.ok(definition.ok);
if (definition.ok) {
  fire(CTX, definition.definition, state, { event: "comboUsed", card: combo, controller: "p1", args: { to: "combo" } });
  assert.deepEqual(state.pending, [], "no Auto for a card that stayed in hand");
  const publicView = buildSnapshot({
    id: 672, revision: 1, mode: "versus", status: "playing",
    p1Name: "Player 1", p2Name: "Player 2", ctx: CTX, state,
    legal: [], log: [], beats: null, spotlight: null,
    spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
    ai: null, viewer: "p2", images: {},
  });
  assert.ok(!JSON.stringify(publicView).includes("C672-ORDINARY"));
}
}

// A forged entry for a physically present, hand-qualified card has no source
// record. It must stop with a typed boundary instead of guessing hand from
// the current Combo Area or silently losing a potentially due Auto.
{
let state = arenaG();
const combo = stage(state, "p1", "C672-HAND-ONLY", "hand");
state = attack(state);
assert.ok(isVmState(state));
const definition = rulesetFor("dbs");
assert.ok(definition.ok);
assert.ok(moveCard(state, definition.definition, combo, "combo", { owner: "p1" }).ok);
assert.equal(state.battle?.comboOrigins?.[combo], undefined);
assert.throws(() => fire(CTX, definition.definition, state, { event: "comboUsed", card: combo, controller: "p1", args: { to: "combo" } }),
  (error: unknown) => error instanceof NotYet && error.issue === "#672");
assert.deepEqual(state.pending, []);
}
} finally {
  for (const id of fixtureIds) delete DEFS[id];
}
