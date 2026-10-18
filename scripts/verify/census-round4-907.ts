/**
 * #907, the fourth census round (18 Oct 2026). What each reading must say, and what it must refuse:
 *
 *  - a description with several measures - "an energy cost of 3 or more and **power of 35000 or less** in
 *    your Drop Area" (BT7-017 and three more), "different card names**,** energy costs of 3 or less**, and**
 *    19000 power or less in your deck or hand" (DB3-133): one selection from one area. Cut at the comma or the
 *    "and", the area fell back to the Battle Area and the power bound was lost.
 *  - "power of N or less" said before its number is a bound (SD2-05, BT7-107 lost it).
 *  - "add it to its owner's hand", "return it to the bottom of your deck", "place it in its owner's energy in
 *    Rest Mode", "return it to your opponent's deck": the move after a choice that had read.
 *  - "choose your opponent's Leader Card and all of their Battle Cards", "Leaders, Battle Cards, and Unisons":
 *    the card types of one choice, in every area they name (the Leader Area was dropped once).
 *  - "can only attack with Battle Cards one more time", "can only attack 2 more times".
 *  - "it gets +N power and has its skills negated for the turn", "-N power during the next turn".
 *  - misreads found on the way: "1 or more <A>, <B>, and <C> cards" counted any one of the names; "same name as
 *    the chosen card" moved or played the chosen card itself; "can't be KO'd in battle against X" banned every
 *    KO; "equal to or less than their current energy" bounding a count was lost; "your total energy".
 *
 * Rules engine only; nothing reads the database.
 */
import assert from "node:assert/strict";
import { compileSkill, parseSkills } from "./harness";
import { splitClauses } from "../../src/lib/arena/compile/clauses";
import { describeScript, validateProgram, type Op } from "../../src/lib/arena/vm/script";

const compile = (text: string) => compileSkill(parseSkills(text)[0]);
function find<T extends Op["op"]>(node: unknown, kind: T, out: Extract<Op, { op: T }>[] = []): Extract<Op, { op: T }>[] {
  if (Array.isArray(node)) for (const x of node) find(x, kind, out);
  else if (node && typeof node === "object") {
    if ((node as { op?: string }).op === kind) out.push(node as Extract<Op, { op: T }>);
    for (const v of Object.values(node)) find(v, kind, out);
  }
  return out;
}
type Sel = { area?: string; areas?: string[]; side?: string; filter?: { costMin: number | null; costMax: number | null; powerMax: number | null; powerMin: number | null; type?: string | null; keywords?: unknown[] } };

// ── several measures, one description ───────────────────────────────────────
{
  const s = compile("[Auto] When you play this card, choose up to 3 Battle Cards with an energy cost of 3 or more and power of 35000 or less in your Drop Area and place them at the bottom of your deck in any order.");
  assert.deepEqual(s.unsupported, [], "BT7-017: read whole");
  const sel = find(s.ops, "choose")[0].sel as Sel;
  assert.equal(sel.area, "drop", "the Drop Area, not the Battle Area it fell back to");
  assert.deepEqual([sel.filter?.costMin, sel.filter?.powerMax], [3, 35000], "both bounds");
  const move = find(s.ops, "moveTo")[0];
  assert.deepEqual([move.to, move.position], ["deck", "bottom"]);

  const list = compile("[Activate: Main] Choose up to 2 mono-red Battle Cards with different card names, energy costs of 3 or less, and 19000 power or less in your deck or hand, play them, then shuffle your deck if you looked through it.");
  assert.deepEqual(list.unsupported, [], "DB3-133: the comma list is one description");
  assert.equal(find(list.ops, "choose").length, 1, "one choice, not a choice of 2 and a second of 1");
  const lsel = find(list.ops, "choose")[0].sel as Sel;
  assert.deepEqual([lsel.filter?.costMax, lsel.filter?.powerMax], [3, 19000]);
  assert.deepEqual(lsel.areas ?? [lsel.area], ["deck", "hand"], "from the deck or the hand");

  const bare = compile("[Auto] When you play this card, choose up to 1 Battle Card from your hand with power of 15000 or less and play it.");
  assert.equal((find(bare.ops, "choose")[0].sel as Sel).filter?.powerMax, 15000, "SD2-05: 'power of N or less' is a bound");

  // "original power of" is the printed value and keeps its own reading
  const original = compile("[Auto] When you play this card, choose up to 1 Battle Card with an original power of 5000 or less in your Drop Area and play it.");
  assert.equal((find(original.ops, "choose")[0].sel as Sel).filter?.powerMax ?? null, null, "an original power is not the current-power bound");
}

// ── the move after a choice ─────────────────────────────────────────────────
{
  const hand = compile("[auto] When this card attacks, draw 1 card, choose up to 1 of your opponent's Battle Cards and add it to its owner's hand, then this card gets +5000 power for the turn.");
  assert.deepEqual(hand.unsupported, [], "EX23-10");
  assert.deepEqual(find(hand.ops, "moveTo").map((m) => m.to), ["hand"]);

  const energy = compile("[Auto] When you play this card, draw 1 card, then choose up to 1 of your opponent's Battle Cards and place it in its owner's energy in Rest Mode.");
  assert.deepEqual(energy.unsupported, [], "DB1-025");
  const [put] = find(energy.ops, "moveTo");
  assert.deepEqual([put.to, put.mode, put.owner], ["energy", "rest", undefined], "into the card's own owner's energy, resting");

  const bottom = compile("[activate: main][once per turn]{g}: You may look at the bottom card of your deck; if it's a <Vegeta> card with an energy cost of 3 or less and the [servant] skill, you may play it, otherwise return it to the bottom of your deck.");
  assert.deepEqual(bottom.unsupported, [], "BT11-062b");
  assert.equal(find(bottom.ops, "look")[0].from, "bottom", "the look is from the bottom");
  assert.ok(describeScript(bottom.ops).includes("look at the bottom"), "and the reading says so (it said 'the top')");
  assert.deepEqual(find(bottom.ops, "moveTo").map((m) => [m.to, m.position]), [["deck", "bottom"]], "the otherwise: back to the bottom");

  const opponentDeck = compile("[Auto] When you play this card, choose 1 Battle Card in your opponent's Drop Area, return it to your opponent's deck, then your opponent shuffles their deck.");
  assert.deepEqual(opponentDeck.unsupported, [], "BT7-017's second option");
  assert.deepEqual(find(opponentDeck.ops, "moveTo").map((m) => m.to), ["deck"]);
}

// ── card types in one choice ────────────────────────────────────────────────
{
  assert.deepEqual(splitClauses("Draw 1 card, choose your opponent's Leader and all of their Battle Cards, and those cards get -5000 power for the turn."), ["Draw 1 card", "choose your opponent's Leader and all of their Battle Cards", "those cards get -5000 power for the turn"]);
  const two = compile("[Activate: Main][Limit 1] Draw 1 card, choose your opponent's Leader and all of their Battle Cards, and those cards get -5000 power for the turn.");
  assert.deepEqual(two.unsupported, [], "BT25-125");
  assert.deepEqual((find(two.ops, "choose")[0].sel as Sel).areas, ["leader", "battle"]);

  const three = compile("[Auto] When this card is played, choose all of your opponent's Leaders, Battle Cards, and Unisons, switch them to Rest Mode.");
  assert.deepEqual(three.unsupported, [], "BT25-110 / BT21-147");
  assert.deepEqual((find(three.ops, "choose")[0].sel as Sel).areas, ["leader", "battle", "unison"], "all three areas - the Leader Area was the one dropped");

  const pair = compile("[Auto] When this card is played, choose all of your opponent's Battle Cards, Unisons and KO them.");
  assert.deepEqual((find(pair.ops, "choose")[0].sel as Sel).areas, ["battle", "unison"], "a comma between the two kinds names both areas");

  // a type list followed by a measure of the last type is not read: the bound would fall off the end
  const bounded = compile("[Auto] Choose any number of your opponent's Leader Cards, Battle Cards, and Unison Cards equal to or less than their current energy, ignoring [barrier], and switch them to Rest Mode.");
  assert.notDeepEqual(bounded.unsupported, [], "BT13-152: a count bounded by energy is refused, not read as 'all'");
}

// ── attacks left, skills negated, power next turn ───────────────────────────
{
  const one = compile("[Counter: Attack] If your Leader Card is yellow: Your opponent can only attack with Battle Cards one more time for the turn.");
  assert.deepEqual(one.unsupported, [], "BT15-119");
  const [f1] = find(one.ops, "forbid");
  assert.deepEqual([f1.what, f1.side, f1.uses], ["attack", "opponent", 1]);
  assert.equal((f1.filter as { type?: string } | undefined)?.type, "BATTLE", "with Battle Cards only");

  const two = compile("[-6][Auto] When your opponent attacks, negate the attack, and your opponent can only attack 2 more times for the turn.");
  assert.deepEqual(two.unsupported, [], "BT24-005");
  assert.equal(find(two.ops, "forbid")[0].uses, 2, "two more");

  const negated = compile("[activate: battle]{y}: Choose up to 1 of your yellow <Trunks: Future> Battle Cards, switch it to Active Mode, and it gets +15000 power and has its skills negated for the turn.");
  assert.deepEqual(negated.unsupported, [], "BT13-117");
  const [neg] = find(negated.ops, "negateSkills");
  assert.ok(neg && "var" in neg.target, "the chosen card's skills");
  assert.equal(neg.until, "turn");

  const next = compile("[activate: battle][once per turn]{g}: This card gets +10000 power for the battle, and -10000 power during the next turn.");
  assert.deepEqual(next.unsupported, [], "P-414");
  const powers = find(next.ops, "power");
  assert.equal(powers.length, 2);
  assert.equal(powers[0].until, "battle");
  assert.equal(find(next.ops, "delay").length, 1, "the minus is a delayed program, not a span from now (it would cancel the plus)");
  assert.equal(validateProgram(next.ops), true);
}

// ── misreads found on the way ───────────────────────────────────────────────
{
  const each = compile("[Permanent] Only 1 {Son Gohan, Hope of the People} can be played in your Battle Area, and if there is at least 1 <Son Goten>, <Trunks: Youth>, and <Videl> card in your Drop Area, reduce the energy cost of this card in your hand by 2.");
  assert.deepEqual(each.unsupported, [], "BT7-054");
  const counts = find(each.ops, "if").flatMap((o) => (o.cond.kind === "all" ? o.cond.conds : [o.cond])).filter((c) => c.kind === "count");
  assert.ok(counts.length >= 3, "one count per name (it was one card that is any of the three)");

  const placed = compile("[Activate: Battle][Limit 1] Choose up to 1 mono-red <Broly> card in your Battle Area with an energy cost of 6 or less, add up to 1 card with the same name as the chosen card from your deck to your hand, and shuffle your deck.");
  assert.notDeepEqual(placed.unsupported, [], "P-440: 'the same name as the chosen card' is refused (it moved the chosen card itself)");
  assert.equal(find(placed.ops, "moveTo").length, 0);

  const ko = compile("[permanent] This card can't be KO'd in battle against Battle Cards with energy costs of 3 or less.");
  assert.notDeepEqual(ko.unsupported, [], "P-481: a KO ban naming whose KO is refused, not read as every KO");
  assert.equal(find(ko.ops, "forbid").length, 0);
  assert.deepEqual(compile("[permanent] This card can't be KO'd by your opponent's skills.").unsupported, [], "the by-skills rule still reads");

  const total = compile("[Auto] When you play this card, choose up to 1 ≪Universe 9≫ in your hand with an energy cost less than or equal to your total energy and play it.");
  assert.equal((find(total.ops, "choose")[0].sel as Sel).area, "hand", "TB1-040: 'your total energy' is the bound, not the Energy Area");

  const pairs = compile("[activate: main] {r}, choose 1 <Natt>, <Bizu>, and <Ribet> card from your hand or Battle Area and place them in their owners' Drop Areas: Play this card from your hand.");
  assert.notDeepEqual(pairs.unsupported, [], "EX06-06: three names behind a '1' is one card of each, which no selector counts: refused");
}

console.log("census round 4 (#907): ok");
