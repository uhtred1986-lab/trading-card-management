/**
 * #1137: "When you combo with this card from the Battle Area" sets the combo origin to `battle`.
 * Printed wordings (BT5-062 f10, SD2-04 f10, BT5-013 f0) played on the rules VM: a combo from the hand does nothing,
 * a combo from the Battle Area runs the Auto. Nothing reads the database.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, IMPL, arenaG, card, leaderOf, zoneOf } from "./harness";
import { comboEntryOrigins } from "../../src/lib/arena/text/triggers";
import { parseSkills } from "../../src/lib/arena/text/cards";
import type { Action, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { EngineState } from "../../src/lib/arena/engines";

const BT5_062 = "[Auto] When you combo with this card from the Battle Area, choose up to 1 card in your opponent's Combo Area and place it in its owner's Drop Area.";
const SD2_04 = "[Auto] When you combo with this card from the Battle Area, draw 1 card.";
const BT5_013 = "[Auto] When you combo with this card from the Battle Area, you may add 1 card from your life to your hand. If you do, choose up to 1 red {Yamcha} with an energy cost of 2 from your deck, play it, and shuffle your deck.";
DEFS.D1137 = card("D1137", { skill: BT5_062 });
DEFS.W1137 = card("W1137", { skill: SD2_04 });
DEFS.T1137 = card("T1137", {});

for (const text of [BT5_062, SD2_04, BT5_013]) {
  const sk = parseSkills(text).find((s) => s.kind === "auto");
  assert.ok(sk);
  assert.deepEqual(comboEntryOrigins(sk), ["battle"], text.slice(0, 60));
}
// The hand wording is still the hand's, and the plain wording still asks no area.
assert.deepEqual(comboEntryOrigins(parseSkills("[Auto] When you combo with this card from your hand, draw 1 card.").find((s) => s.kind === "auto")!), ["hand"]);
assert.equal(comboEntryOrigins(parseSkills("[Auto] When you combo with this card, draw 1 card.").find((s) => s.kind === "auto")!), null);

const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
function take(state: EngineState, action: Action): { state: EngineState; events: GameEvent[] } {
  assert.ok(IMPL.legalActions(CTX, state).some((row) => JSON.stringify(row.action) === JSON.stringify(action)), `expected legal ${JSON.stringify(action)} at ${state.prompt.kind}`);
  const r = IMPL.apply(CTX, roundtrip(state), action);
  return { state: r.state, events: r.events };
}
function stage(state: EngineState, owner: PlayerId, cardId: string, area: "hand" | "battle" | "combo"): string {
  const id = zoneOf(state, owner, "deck").shift();
  assert.ok(id);
  state.cards[id].cardId = cardId;
  zoneOf(state, owner, area).push(id);
  if (area === "battle") state.cards[id].mode = "active";
  return id;
}
function toComboStep(state: EngineState): EngineState {
  let r = take(state, { type: "attack", player: "p1", attacker: leaderOf(state, "p1")!, target: leaderOf(state, "p2")! });
  for (let i = 0; i < 20 && r.state.prompt.kind !== "combo"; i++) {
    const q = r.state.prompt;
    r = take(r.state, q.kind === "orderPending" ? { type: "orderPending", player: q.player, index: 0 }
      : q.kind === "counter" ? { type: "counter", player: q.player, card: null }
      : q.kind === "blocker" ? { type: "block", player: q.player, card: null }
      : (() => { throw Error(`unexpected ${q.kind}`); })());
  }
  assert.equal(r.state.prompt.kind, "combo");
  return r.state;
}
const skills = (events: GameEvent[], id: string) => events.filter((e) => e.type === "skill" && e.card === id);

// SD2-04: draw 1 only for a Battle Area combo.
for (const [area, draws] of [["hand", 0], ["battle", 1]] as const) {
  const s = arenaG();
  const id = stage(s, "p1", "W1137", area);
  const st = toComboStep(s);
  const before = zoneOf(st, "p1", "hand").length;
  const r = take(st, { type: "combo", player: "p1", card: id });
  assert.equal(skills(r.events, id).length, draws, `SD2-04 wording from the ${area}`);
  assert.equal(zoneOf(r.state, "p1", "hand").length, before - (area === "hand" ? 1 : 0) + draws, `hand size after a combo from the ${area}`);
}

// BT5-062: the opponent's Combo Area card is dropped only by a Battle Area combo.
for (const area of ["hand", "battle"] as const) {
  const s = arenaG();
  const id = stage(s, "p1", "D1137", area);
  const target = stage(s, "p2", "T1137", "combo");
  const st = toComboStep(s);
  let r = take(st, { type: "combo", player: "p1", card: id });
  for (let i = 0; i < 6 && r.state.prompt.kind === "chooseCards"; i++) {
    const q = r.state.prompt;
    r = take(r.state, { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, 1) });
  }
  const dropped = zoneOf(r.state, "p2", "drop").includes(target);
  assert.equal(dropped, area === "battle", `BT5-062 wording from the ${area}: opponent's combo card ${dropped ? "dropped" : "stays"}`);
  if (area === "hand") assert.equal(skills(r.events, id).length, 0, "a hand combo does not fire the Auto");
}

console.log("#1137 combo from the Battle Area: origin read, hand combo silent, Battle Area combo fires (SD2-04, BT5-062)");
