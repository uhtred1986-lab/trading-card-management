/**
 * #907 / #964 (#961): "if your Leader is X **or is** Y, and you have N or more energy"
 * is a Leader disjunction and an energy count, read together.
 *
 * #961 made `leaderTailHoldsAClause` refuse a Leader description that contains a
 * verb, to stop "…is blue and you send …" being read as the colour alone. The verb
 * of a restated alternative ("green **or is** a black <Announcer> card", "green **or
 * has** <GT> in its character name") is part of the disjunction, and the whole price
 * of BT31-049, P-525 and P-526 went unread. Printed text from the catalog, 17 Oct 2026.
 */
import assert from "node:assert/strict";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { priceIsUnread } from "../../src/lib/arena/compile/prices";
import { describeScript } from "../../src/lib/arena/vm/script-schema";

const BT31_049 = "[activate: main/battle] [limit 1] {1}, if your Leader is green or has <GT> in its character name, and you have 3 or more energy: Play this card from your hand.";
const P_525 = "[activate: main][limit 1]{g}{g}, if your Leader is green or is a black <Announcer> card and you have 3 or more energy: Play this card from your hand.";
const P_526 = "[activate: main][limit 1]{g}, if your Leader is green or is a black <Announcer> card and you have 3 or more energy: Play this card from your hand, and this card gains [barrier] for the turn.";

const one = (text: string) => parseSkills(text)[0]!;
type Cond = { kind: string; conds?: Cond[]; atLeast?: number; filter?: { colors: string[]; characters: string[]; charactersIncluding: string[] } };
const condOf = (text: string): Cond => (compileSkill(one(text)).ops[0] as unknown as { cond: Cond }).cond;

for (const [id, text] of [["BT31-049", BT31_049], ["P-525", P_525], ["P-526", P_526]] as const) {
  const read = compileSkill(one(text));
  assert.deepEqual(read.unsupported, [], `${id} reads whole`);
  assert.equal(priceIsUnread(one(text)), false, `${id}'s price is read`);
  const cond = condOf(text);
  // AND over OR: (Leader A or Leader B) and energy >= 3 — never Leader A or (Leader B and energy).
  assert.equal(cond.kind, "all", `${id}: the Leader test and the energy count both gate the skill`);
  assert.equal(cond.conds!.length, 2);
  const [leader, energy] = cond.conds!;
  assert.equal(leader.kind, "any", `${id}: the Leader is one or the other`);
  assert.deepEqual(leader.conds!.map((c) => c.kind), ["leaderMatches", "leaderMatches"]);
  assert.deepEqual(leader.conds![0].filter!.colors, ["Green"]);
  assert.equal(energy.kind, "count", `${id}: 3 or more energy`);
  assert.equal(energy.atLeast, 3);
}
assert.deepEqual(condOf(P_525).conds![0].conds![1].filter!.characters, ["announcer"]);
assert.deepEqual(condOf(P_525).conds![0].conds![1].filter!.colors, ["Black"]);
assert.deepEqual(condOf(BT31_049).conds![0].conds![1].filter!.charactersIncluding, ["gt"]);
// The reading names the second Leader rather than "a match".
{
  const reads = describeScript(compileSkill(one(BT31_049)).ops);
  assert.match(reads, /your leader is a card with <gt> in its character name/i, `BT31-049 reads: ${reads}`);
  assert.doesNotMatch(reads, /a match/);
}

// ── #961's refusals stay refused ─────────────────────────────────────────────
{
  const unread = (text: string) => compileSkill(one(text)).unsupported.length > 0;
  assert.ok(unread("[Activate: Main]{r}, if your Leader Card is a black ≪Saiyan≫ card and you send this card and 1 <Goku Black> card from your Combo Area to their owners' Warps: Play this card from your hand."), "a Leader condition does not hide an unread send price");
  // BT16-087's two places read since #907 round 6 (the Combo Area is an area word): one count over both, either colour.
  const places = compileSkill(one("[Activate: Battle]{2}, if you have 2 or more blue and/or yellow cards in your Battle Area and/or Combo Area: Play this card from your hand or Warp."));
  assert.deepEqual(places.unsupported, [], "BT16-087's two places read");
  assert.ok(JSON.stringify(places.ops).includes('"areas":["battle","combo"]'), "as one count over the Battle Area and the Combo Area");
  // A verb after a comma or "and" is another clause, not a restated alternative.
  assert.ok(unread("[Activate: Main]{1}, if your Leader is green or is blue and you send 1 card from your Drop Area to your Warp, you have 3 or more energy: Play this card from your hand."), "a second clause after the alternatives stays unread");
  assert.ok(unread("[Activate: Main]{1}, if your Leader is green and has <GT> in its character name and 3 or more blue and/or yellow cards are in your Combo Area and/or Drop: Play this card from your hand."), "an unread count behind a Leader list stays unread");
}
console.log("leader-or-is-price-907 ok");
