/**
 * #1135: [Awaken] "You may draw N cards and flip this card over" is a mandatory
 * draw (official Q&A on BT2-001, -002, -003, ...: "Can you choose not to draw
 * cards with [Awaken]? No, you cannot. You must draw 2 cards."). The optional
 * part is the [Awaken] itself. Real printed texts of BT2-002 and BT2-003 (front 10).
 */
import assert from "node:assert/strict";
import { DEFS, arenaG, assertConsistentG, canActivateG, compileSkill, leaderOf, parseSkills, playG, powerOfG, stageMoveG, zoneOf } from "./harness";
import type { Op } from "../../src/lib/arena/vm/script";

const BT2_002 = "[Awaken] When your life is at 4 or less: You may draw 2 cards and flip this card over.";
const BT2_003 = "[Awaken] When your life is at 6 or less: You may draw 2 cards and flip this card over.";
const BT6_001 = "[Awaken] When your life is at 4 or less: You may draw 1 card, then choose up to 1 of your energy, switch it to Active Mode, and flip this card over.";
const DRAW_AND_SWITCH = "[Awaken] When your life is at 4 or less: You may draw 1 card and switch up to 1 of your energy to Active Mode.";
const BLUE_ENERGY = "[Awaken] When your life is at 4 or less: If you have a blue energy, you may switch 1 of your energy to Active Mode.";
const SWITCH_ONLY = "[Awaken] When your life is at 4 or less: You may switch up to 2 of your energy to Active Mode and flip this card over.";

const shape = (text: string): string[] => compileSkill(parseSkills(text)[0]).ops.map((o: Op) => (o.op === "may" ? `may{${o.ops.map((x) => x.op).join(",")}}` : o.op));

// Compiler: the draw that opens the effect is no `may`; every other clause reads as before.
assert.deepEqual(shape(BT2_002), ["draw"]);
assert.deepEqual(shape(BT2_003), ["draw"]);
assert.deepEqual(shape(BT6_001), ["draw", "choose", "switchMode"]);
assert.deepEqual(shape(DRAW_AND_SWITCH), ["draw", "may{choose,switchMode}"], "the draw is Awaken's; the rest stays optional, unchanged");
assert.deepEqual(shape(BLUE_ENERGY), ["if"], "another optional clause inside an [Awaken]: unchanged");
assert.deepEqual(shape(SWITCH_ONLY), ["choose", "switchMode"], "no draw, nothing to change");
assert.equal((compileSkill(parseSkills(BT2_002)[0]).ops[0] as { n: number }).n, 2);
// Outside an [Awaken] a "you may draw" is still an offer.
assert.deepEqual(shape("[Auto] When you play this card, you may draw 2 cards."), ["may{draw}"]);

// Engine, on the real texts: taking the [Awaken] draws exactly N, asks nothing, and flips.
for (const [id, text, lifeLeft, n] of [["L-BT2-002", BT2_002, 4, 2], ["L-BT2-003", BT2_003, 6, 2]] as const) {
  DEFS[id] = { ...DEFS["L-RED"], id, name: id, skill: text, back: { name: `${id} awakened`, power: 15000, skill: null } };
  let s = arenaG({});
  const leader = leaderOf(s, "p1");
  s.cards[leader].cardId = id;
  assert.ok(!canActivateG(s, leader), `${id}: life 8 is above ${lifeLeft}`);
  for (const c of zoneOf(s, "p1", "life").slice(lifeLeft)) stageMoveG(s, c, "drop", "p1");
  assert.ok(canActivateG(s, leader), `${id}: the condition holds`);
  const before = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "activate", player: "p1", card: leader, skill: 0 });
  assert.equal(s.prompt.kind, "main", `${id}: no draw prompt, no Don't`);
  assert.equal(zoneOf(s, "p1", "hand").length, before + n, `${id}: exactly ${n} cards drawn`);
  assert.equal(s.cards[leader].flipped, true, `${id}: and the Leader flipped`);
  assert.equal(powerOfG(s, leader), 15000);
  assertConsistentG(s);
  delete DEFS[id];
}
