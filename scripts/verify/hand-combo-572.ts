/** #572: an end-of-battle Auto belongs to this copy's combo from hand. */
import assert from "node:assert/strict";
import { compileSkill } from "../../src/lib/arena/compile";
import { skillRecords } from "../../src/lib/arena/draft";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { comboBattleEndFromHand } from "../../src/lib/arena/text/triggers";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { isVmState } from "../../src/lib/arena/vm/state";
import type { Action, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { EngineState } from "../../src/lib/arena/engines";
import { CTX, DEFS, IMPL, arenaG, card, leaderOf, moveByRuleG, zoneOf } from "./harness";

const BT2 = "[Auto] At the end of the battle after you combo with this card from your hand, play this card in Rest Mode.";
const BT6 = "[Auto] At the end of a battle in which you combo with this card from your hand during your opponent's turn, if your Leader Card is red, play this card in Rest Mode.";
DEFS["C572-BT2"] = card("C572-BT2", { energyCost: 3, comboCost: 0, comboPower: 5000, skill: BT2 });
DEFS["C572-BT6"] = card("C572-BT6", { energyCost: 3, comboCost: 0, comboPower: 5000, skill: BT6 });

for (const [id, printed] of [["C572-BT2", BT2], ["C572-BT6", BT6]] as const) {
  const sk = parseSkills(printed)[0]!;
  assert.equal(comboBattleEndFromHand(sk), true, `${id}: source phrase is part of the timing`);
  assert.deepEqual(skillRecords(DEFS[id]).map((row) => row.trigger), [["comboed"]], `${id}: the stored WHEN is this card's cleanup moment`);
  assert.deepEqual(compileSkill(sk).unsupported, [], `${id}: the Auto reads whole`);
}
assert.deepEqual((compileSkill(parseSkills(BT6)[0]!).ops[0] as { cond: unknown }).cond,
  { kind: "not", cond: { kind: "isTurnPlayer" } }, "BT6-010: opponent-turn condition remains part of the reading");
for (const verb of ["comboed with", "used"] as const) {
  const alias = BT6.replace("combo with", verb);
  const sk = parseSkills(alias)[0]!;
  assert.equal(comboBattleEndFromHand(sk), true, `${verb}: the same source-bound timing`);
  assert.deepEqual((compileSkill(sk).ops[0] as { cond: unknown }).cond,
    { kind: "not", cond: { kind: "isTurnPlayer" } }, `${verb}: opponent-turn reading survives its printed alias`);
}
assert.equal(comboBattleEndFromHand(parseSkills("[Auto] At the end of the battle after you combo with this card from your Battle Area, place 1 card from your hand in its owner's Drop Area.")[0]!), false,
  "an effect's mention of hand does not change the combo's source");
assert.deepEqual((compileSkill(parseSkills("[Auto] At the end of a battle in which you combo with this card during your opponent's turn, draw 1 card.")[0]!).ops[0] as { cond: unknown }).cond,
  { kind: "not", cond: { kind: "isTurnPlayer" } }, "a no-hand-source wording keeps its prior opponent-turn condition");

function take(state: EngineState, action: Action): { state: EngineState; events: GameEvent[] } {
  assert.ok(IMPL.legalActions(CTX, state).some((row) => JSON.stringify(row.action) === JSON.stringify(action)),
    `rules: expected legal ${JSON.stringify(action)} at ${state.prompt.kind}; actual ${JSON.stringify(IMPL.legalActions(CTX, state).map((row) => row.action))}`);
  return IMPL.apply(CTX, state, action);
}

function stage(owner: PlayerId, cardId: string, area: "hand" | "battle" | "energy", state: EngineState): string {
  const source = zoneOf(state, owner, "deck");
  const id = source.shift();
  assert.ok(id, "fixture deck has a spare card");
  state.cards[id].cardId = cardId;
  zoneOf(state, owner, area).push(id);
  if (area !== "hand") state.cards[id].mode = "active";
  return id;
}

function open(args: { card: "C572-BT2" | "C572-BT6"; owner?: PlayerId; area?: "hand" | "battle"; z?: string[] }): { state: EngineState; combo: string } {
  const state = arenaG({ z: args.z });
  const owner = args.owner ?? "p1";
  if (args.card === "C572-BT6") state.cards[leaderOf(state, owner)].cardId = "L-RED";
  const combo = stage(owner, args.card, args.area ?? "hand", state);
  return { state, combo };
}

function begin(state: EngineState): { state: EngineState; events: GameEvent[] } {
  return take(state, { type: "attack", player: "p1", attacker: leaderOf(state, "p1"), target: leaderOf(state, "p2") });
}

function finish(state: EngineState): { state: EngineState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < 8 && state.prompt.kind !== "main"; i++) {
    const p = state.prompt;
    let action: Action;
    if (p.kind === "combo") action = { type: "pass", player: p.player };
    else if (p.kind === "zEnergyFromCombo") action = { type: "zEnergyFromCombo", player: p.player, card: null };
    else throw Error(`rules: battle stopped at ${p.kind}`);
    const next = take(state, action);
    state = next.state;
    events.push(...next.events);
  }
  assert.equal(state.prompt.kind, "main", `rules: battle finished`);
  return { state, events };
}

function skillEvents(events: GameEvent[], cardId: string, state: EngineState): GameEvent[] {
  return events.filter((event) => event.type === "skill" && state.cards[event.card]?.cardId === cardId);
}

// Hand combo: the entry remembers hand across JSON, fires once at cleanup,
// and visibly moves the very same instance through Combo, Drop, then Battle.
{
  const { state: opened, combo } = open({ card: "C572-BT2" });
  let state = opened;
  const energy = stage("p1", "V1", "energy", state);
  state = begin(state).state;
  const joined = take(state, { type: "combo", player: "p1", card: combo });
  state = joined.state;
  assert.ok(joined.events.some((event) => event.type === "move" && event.card === combo && event.from === "hand" && event.to === "combo"));
  assert.equal(state.battle?.comboOrigins?.[combo], "hand", "source survives the combo prompt");
  assert.equal(skillEvents(joined.events, "C572-BT2", state).length, 0, "end Auto has not fired at combo entry");
  state = JSON.parse(JSON.stringify(state)) as EngineState;
  assert.equal(state.battle?.comboOrigins?.[combo], "hand", "source survives a saved-game roundtrip");
  const ended = finish(state);
  assert.equal(skillEvents(ended.events, "C572-BT2", ended.state).length, 1, "one Auto at battle end");
  assert.equal(ended.events.filter((event) => event.type === "move" && event.card === combo && event.from === "combo" && event.to === "drop").length, 1);
  assert.equal(ended.events.filter((event) => event.type === "move" && event.card === combo && event.from === "drop" && event.to === "battle").length, 1);
  assert.ok(zoneOf(ended.state, "p1", "battle").includes(combo));
  assert.equal(ended.state.cards[combo].mode, "rest");
  assert.deepEqual(zoneOf(ended.state, "p1", "energy"), [energy], "zero combo cost leaves energy in place");
  assert.equal(ended.state.cards[energy].mode, "active", "zero combo cost does not spend energy");
  assert.equal(ended.state.battle, null, "provenance ends with this battle");

  // The same copy is in play for another battle. Its earlier hand origin
  // cannot make a new battle's from-Battle-Area combo read as from hand.
  state = ended.state;
  state.cards[combo].mode = "active";
  const attacker = stage("p1", "V1", "battle", state);
  state = take(state, { type: "attack", player: "p1", attacker, target: leaderOf(state, "p2") }).state;
  const second = take(state, { type: "combo", player: "p1", card: combo });
  assert.equal(second.state.battle?.comboOrigins?.[combo], "battle");
  const later = finish(second.state);
  assert.equal(skillEvents(later.events, "C572-BT2", later.state).length, 0, "old hand source cannot leak into the next battle");
  assert.ok(zoneOf(later.state, "p1", "drop").includes(combo));
}

// Leaving Combo Area before the 8-5 cleanup cannot satisfy an end-of-battle
// Auto, even though the prior entry was from hand.
{
  const { state: opened, combo } = open({ card: "C572-BT2" });
  let state = opened;
  state = begin(state).state;
  state = take(state, { type: "combo", player: "p1", card: combo }).state;
  moveByRuleG(state, combo, "drop", "p1");
  assert.ok(zoneOf(state, "p1", "drop").includes(combo));
  const ended = finish(state);
  assert.equal(skillEvents(ended.events, "C572-BT2", ended.state).length, 0);
  assert.ok(!zoneOf(ended.state, "p1", "battle").includes(combo));
}

// Another card's combo cannot pay this copy's trigger, even in that battle.
{
  const { state: opened, combo } = open({ card: "C572-BT2" });
  let state = opened;
  const other = stage("p1", "V1", "hand", state);
  state = begin(state).state;
  state = take(state, { type: "combo", player: "p1", card: other }).state;
  const ended = finish(state);
  assert.equal(skillEvents(ended.events, "C572-BT2", ended.state).length, 0);
  assert.ok(zoneOf(ended.state, "p1", "hand").includes(combo));
}

// An in-play Battle Card can combo, but its source is battle, not hand.
{
  const { state: opened, combo } = open({ card: "C572-BT2", area: "battle" });
  let state = opened;
  state = begin(state).state;
  assert.ok(zoneOf(state, "p1", "battle").includes(combo), `rules: staged card left battle ${JSON.stringify(state.cards[combo])}`);
  assert.equal(state.cards[combo].mode, "active", `rules: staged combo card rested unexpectedly`);
  const joined = take(state, { type: "combo", player: "p1", card: combo });
  assert.equal(joined.state.battle?.comboOrigins?.[combo], "battle");
  const ended = finish(joined.state);
  assert.equal(skillEvents(ended.events, "C572-BT2", ended.state).length, 0);
  assert.ok(zoneOf(ended.state, "p1", "drop").includes(combo));
}

// An old mid-battle save with no source record cannot be guessed from a card
// now sitting in Combo Area. The rules engine records a typed interruption.
{
  const { state: opened, combo } = open({ card: "C572-BT2" });
  let state = opened;
  state = begin(state).state;
  state = take(state, { type: "combo", player: "p1", card: combo }).state;
  delete state.battle?.comboOrigins;
  state = JSON.parse(JSON.stringify(state)) as EngineState;
  state = take(state, { type: "pass", player: "p1" }).state;
  let stopped = false;
  for (let i = 0; i < 4 && !stopped; i++) {
    const pr = state.prompt;
    const action: Action = pr.kind === "combo"
      ? { type: "pass", player: pr.player }
      : pr.kind === "zEnergyFromCombo"
        ? { type: "zEnergyFromCombo", player: pr.player, card: null }
        : (() => { throw Error(`rules: old battle reached ${pr.kind} without an interruption`); })();
    const next = take(state, action);
    state = next.state;
    if (!isVmState(state) || state.outcome?.kind !== "interrupted") continue;
    assert.equal(state.outcome.privateContext?.issue, "#572");
    assert.equal(state.winner, null);
    assert.equal(state.prompt.kind, "gameOver");
    assert.equal(skillEvents(next.events, "C572-BT2", state).length, 0);
    assert.ok(!next.events.some((event) => event.type === "move" && event.card === combo && event.to === "battle"));
    assert.ok(next.events.some((event) => event.type === "gameOver" && event.winner === null));
    assert.ok(!next.events.some((event) => event.type === "note" && event.text.includes(combo)), "public event hides the source identity");
    for (const viewer of ["p1", "p2"] as const) {
      const publicView = buildSnapshot({
        id: 572, revision: 1, mode: "versus", status: "over",
        p1Name: "Player 1", p2Name: "Player 2", ctx: CTX, state,
        legal: [], log: [], beats: null, spotlight: null,
        spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
        ai: null, viewer, images: {},
      });
      assert.equal(publicView.over?.kind, "interrupted");
      assert.ok(!JSON.stringify(publicView).includes("privateContext"));
      assert.ok(!JSON.stringify(publicView).includes("comboOrigins"));
      assert.ok(!JSON.stringify(publicView).includes("infer the origin"));
    }
    stopped = true;
  }
  assert.equal(stopped, true, `rules: missing source did not stop the battle`);
}

// 8-5-2 lets the player choose Z-Energy before Combo Area cleanup. That is
// a distinct departure, so the battle-end Auto must not run or play the card.
{
  const { state: opened, combo } = open({ card: "C572-BT2", z: ["V1"] });
  let state = opened;
  state = begin(state).state;
  state = take(state, { type: "combo", player: "p1", card: combo }).state;
  state = take(state, { type: "pass", player: "p1" }).state;
  state = take(state, { type: "pass", player: "p2" }).state;
  assert.equal(state.prompt.kind, "zEnergyFromCombo", "the choice precedes cleanup");
  const chosen = take(state, { type: "zEnergyFromCombo", player: "p1", card: combo });
  const ended = chosen.state.prompt.kind === "main" ? chosen : finish(chosen.state);
  assert.ok(chosen.events.some((event) => event.type === "move" && event.card === combo && event.from === "combo" && event.to === "zEnergy"));
  assert.equal(skillEvents([...chosen.events, ...ended.events], "C572-BT2", ended.state).length, 0);
  assert.ok(zoneOf(ended.state, "p1", "zEnergy").includes(combo));
  assert.ok(!zoneOf(ended.state, "p1", "battle").includes(combo));
}

// BT6's source and opponent-turn tests run at the genuine offensive and
// defensive combo questions, with a red Leader for its printed condition.
{
  const { state: opened, combo } = open({ card: "C572-BT6" });
  let state = opened;
  state = begin(state).state;
  state = take(state, { type: "combo", player: "p1", card: combo }).state;
  const ended = finish(state);
  assert.equal(skillEvents(ended.events, "C572-BT6", ended.state).length, 0, "own turn is excluded");
  assert.ok(zoneOf(ended.state, "p1", "drop").includes(combo));
}
{
  const { state: opened, combo } = open({ card: "C572-BT6", owner: "p2" });
  let state = opened;
  state = begin(state).state;
  state = take(state, { type: "pass", player: "p1" }).state;
  const joined = take(state, { type: "combo", player: "p2", card: combo });
  assert.equal(skillEvents(joined.events, "C572-BT6", joined.state).length, 0);
  const ended = finish(JSON.parse(JSON.stringify(joined.state)) as EngineState);
  assert.equal(skillEvents(ended.events, "C572-BT6", ended.state).length, 1, "opponent-turn hand combo fires once");
  assert.ok(zoneOf(ended.state, "p2", "battle").includes(combo));
  assert.equal(ended.state.cards[combo].mode, "rest");
}

// Two sources in one fight are bound independently: the attacker uses BT2,
// the defender uses BT6 during their opponent's turn, and each resolves once.
{
  const { state: opened, combo: bt2 } = open({ card: "C572-BT2" });
  let state = opened;
  state.cards[leaderOf(state, "p2")].cardId = "L-RED";
  const bt6 = stage("p2", "C572-BT6", "hand", state);
  state = begin(state).state;
  state = take(state, { type: "combo", player: "p1", card: bt2 }).state;
  state = take(state, { type: "pass", player: "p1" }).state;
  state = take(state, { type: "combo", player: "p2", card: bt6 }).state;
  const ended = finish(state);
  assert.equal(skillEvents(ended.events, "C572-BT2", ended.state).length, 1);
  assert.equal(skillEvents(ended.events, "C572-BT6", ended.state).length, 1);
  assert.ok(zoneOf(ended.state, "p1", "battle").includes(bt2));
  assert.ok(zoneOf(ended.state, "p2", "battle").includes(bt6));
}

// The shared harness definitions feed the later probe digest suite. These
// synthetic cards belong only to this scenario, so leave that fixture set
// exactly as it was before this suite ran.
delete DEFS["C572-BT2"];
delete DEFS["C572-BT6"];
console.log(`#572 hand-combo source and battle-end scenarios passed on rules`);
