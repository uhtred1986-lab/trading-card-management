/**
 * #907, the sixth census round (18 Oct 2026). What each reading must say, and what it must refuse:
 *
 *  - "an ORIGINAL energy cost of N" (20-3-1: the printed value, before any skill effect is applied; 62 skills)
 *    is a measure of its own, `originalCostMin`/`originalCostMax`, answered by the printed `energyCost` and never
 *    by `costOf`, the price as it stands. The word used to be swallowed by the plain bound, which left the reading
 *    unable to tell the two questions apart, and two readers refused it outright (a reducer scoped by it, an
 *    Extra's activation trigger). "Whose original energy cost WAS 5 or more" (BT2-105) and "an original COST of 1"
 *    (BT26-095) were read with no bound at all.
 *  - the reading of "for each X" names X (P-293 read "for each of your Battle Cards" for a filtered count), and
 *    "the rest" of what was looked at is said as such.
 *  - a count over areas joined by a plain "and" ("green Extra Cards in your Battle Area and Drop Area", BT13-073 and
 *    seven more) counts every area it names, not the last one.
 *  - "place up to 1 {X} from your Z-Deck in your Battle Area" (BT25-047/050/098/099, BT22-036 to -038).
 *  - "they lose -N power" (BT3-018, BT3-019, P-070b); "get -1 combo cost and -5000 combo power" (BT22-055b, BT23-072,
 *    BT23-072b); "add +N to this card's Combo" (BT1-045, BT1-069, BT1-100).
 *  - a misread found on the way: after "look at the top 5", "choose up to 1 <description> and play it" (TB3-007, -008,
 *    -010) chose among the cards in play, and "place the rest at the bottom" then put the played card back in the deck.
 *
 * Rules engine only; nothing reads the database.
 */
import assert from "node:assert/strict";
import { compileSkill, parseSkills } from "./harness";
import { describeFilter, describeScript, type Op } from "../../src/lib/arena/vm/script";
import { emptyFilter, parseFilter } from "../../src/lib/arena/text/filters";
import { predicateOf } from "../../src/lib/arena/vm/filters";
import { rulesetFor } from "../../src/lib/arena/rulesets";

const compile = (text: string) => compileSkill(parseSkills(text)[0]);
function find<T extends Op["op"]>(node: unknown, kind: T, out: Extract<Op, { op: T }>[] = []): Extract<Op, { op: T }>[] {
  if (Array.isArray(node)) for (const x of node) find(x, kind, out);
  else if (node && typeof node === "object") {
    if ((node as { op?: string }).op === kind) out.push(node as Extract<Op, { op: T }>);
    for (const v of Object.values(node)) find(v, kind, out);
  }
  return out;
}
type Sel = { area?: string; areas?: string[]; fromVar?: string; filter?: Record<string, unknown> };

// ── "original energy cost" is the printed total ─────────────────────────────
{
  const exact = parseFilter("up to 1 green Battle Card with an original energy cost of 1 in your hand");
  assert.deepEqual([exact.originalCostMin, exact.originalCostMax, exact.costMin, exact.costMax], [1, 1, null, null], "the original bound is read, and the plain one is not");
  const less = parseFilter("all of your Battle Cards with original energy costs of 5 or less");
  assert.deepEqual([less.originalCostMin ?? null, less.originalCostMax, less.costMax], [null, 5, null]);
  const more = parseFilter("whose original energy cost was 5 or more");
  assert.deepEqual([more.originalCostMin, more.originalCostMax ?? null, more.costMin], [5, null, null], "BT2-105: 'was', not 'of'");
  const bare = parseFilter("yellow Battle Card with an original cost of 1");
  assert.deepEqual([bare.originalCostMin, bare.originalCostMax], [1, 1], "BT26-095: 'original cost' without 'energy'");
  const both = parseFilter("a blue Battle Card with an original energy cost of 2 or less and an energy cost of 1 or more");
  assert.deepEqual([both.originalCostMax, both.costMin, both.costMax], [2, 1, null], "the two measures sit side by side");
  const plain = parseFilter("up to 1 green Battle Card with an energy cost of 1");
  assert.equal(plain.originalCostMin, undefined, "a plain bound writes nothing: no stored filter grows two nulls");
  assert.equal(describeFilter(exact, { plural: false }).includes("an original energy cost of 1"), true, "and the reading says the word");

  // The measure reads the printed total: a card on the table whose price is discounted to 0 is still an original 3.
  const dbs = rulesetFor("dbs");
  assert.ok(dbs.ok);
  const game = dbs.ok ? dbs.definition : (undefined as never);
  const attrs = { energyCost: 3, costOf: 0 };
  assert.equal(predicateOf({ ...emptyFilter(), originalCostMin: 3, originalCostMax: 3 }, game)(attrs), true, "20-3-1: the printed 3");
  assert.equal(predicateOf({ ...emptyFilter(), originalCostMin: 0, originalCostMax: 0 }, game)(attrs), false, "not the reduced 0");
  assert.equal(predicateOf({ ...emptyFilter(), originalCostMax: 2 }, game)({}), false, "an X cost has no printed total to bound");

  // Newly read: the reducer scoped by the printed price (BT13-061) and the Extra trigger (P-266).
  const reducer = compile("[Permanent] When activating a [Field] skill of a green Extra Card with an original energy cost of 2 from your hand, reduce that card's energy cost by 1.");
  assert.deepEqual(reducer.unsupported, [], "BT13-061: read whole");
  const cut = find(reducer.ops, "costReduction")[0];
  const scope = (cut.target as { sel: Sel }).sel;
  assert.deepEqual([scope.filter?.originalCostMin, scope.filter?.originalCostMax, scope.filter?.costMin], [2, 2, null], "scoped by the printed price, not by the one it is lowering");
  const trigger = compile("[Auto][Once per turn] If your Leader Card is a yellow <Frieza> card: When you activate a yellow Extra Card with an original energy cost of 1 or more from your hand, add a marker to this card.");
  assert.deepEqual(trigger.unsupported, [], "P-266: read whole");
  assert.ok(describeScript(trigger.ops).includes("an original energy cost of 1 or more"), "and it says original");

  const frieza = compile("[Permanent] Reduce the energy costs of all ≪Frieza Clan≫ whose original energy cost was 5 or more by 2.");
  const target = (find(frieza.ops, "costReduction")[0].target as { sel: Sel }).sel;
  assert.equal(target.filter?.originalCostMin, 5, "BT2-105 reduced every Frieza Clan card, whatever it printed");
  const crew = compile("[Auto] When this card attacks, choose up to 1 of your opponent's Rest Mode Battle Cards and KO it, then play up to 1 yellow Battle Card with an original cost of 1 from your hand.");
  assert.equal((find(crew.ops, "choose")[1].sel as Sel).filter?.originalCostMax, 1, "BT26-095: the bound was lost");
}

// ── the combo cost is a measure (2-9) ───────────────────────────────────────
{
  // 28 skills say "a <description> card with a combo cost of 1" and the filter had no combo-cost measure, so the phrase was dropped and
  // every card of the description was on offer (BT19-102: any yellow ≪Slug's Army≫ card from the Drop in a combo).
  const f = parseFilter("up to 1 mono-yellow ≪Slug's Army≫ card with a combo cost of 1 in your Drop Area");
  assert.deepEqual([f.comboCostMin, f.comboCostMax], [1, 1]);
  assert.deepEqual([parseFilter("both blue and with a combo cost of 1 or less").comboCostMax, parseFilter("original combo cost of 2 or more").comboCostMin], [1, 2], "'original' is the printed one");
  assert.equal(parseFilter("a <Lord Slug> card with an energy cost of 3 and combo cost of 1").costMax, 3, "beside the energy cost");
  assert.equal(parseFilter("all <Goku> cards in your hand").comboCostMin, undefined, "the change to a cost is not a bound on one");
  const combo = compile("[auto] When this card attacks, draw 1 card, and use up to 1 mono-yellow ≪Slug's Army≫ card with a combo cost of 1 from your Drop in a combo with its skills negated for the turn.");
  assert.deepEqual(combo.unsupported, []);
  assert.deepEqual([(find(combo.ops, "choose")[0].sel as Sel).filter?.comboCostMin, (find(combo.ops, "choose")[0].sel as Sel).filter?.comboCostMax], [1, 1], "BT19-102: the bound is kept");
  assert.match(describeScript(combo.ops), /with a combo cost of 1 in your Drop Area/, "and the reading says it");
  const reducer = compile("[+1][Activate: Main] Until the start of your next turn, reduce the combo cost of all mono-yellow ≪Android≫ cards with an original combo cost of 1 in your hand by 1.");
  assert.equal((find(reducer.ops, "costReduction")[0].target as { sel: Sel }).sel.filter?.comboCostMin, 1, "BT13-094: it reduced every Android's combo cost");
  const dbs = rulesetFor("dbs");
  assert.ok(dbs.ok);
  const game = dbs.ok ? dbs.definition : (undefined as never);
  assert.equal(predicateOf({ ...emptyFilter(), comboCostMin: 1, comboCostMax: 1 }, game)({ comboCost: 1 }), true);
  assert.equal(predicateOf({ ...emptyFilter(), comboCostMin: 1, comboCostMax: 1 }, game)({ comboCost: 2 }), false);
  assert.equal(predicateOf({ ...emptyFilter(), comboCostMax: 1 }, game)({}), false, "no combo cost at all matches no bound");
  // "Original combo power" is not the combo power as it stands (EX23-19 raises the very number it selects by): refused.
  assert.ok(compile("[permanent] ≪Turles Crusher Corps≫ cards with an original combo power of 3000 in your Combo Area get +2000 combo power.").unsupported.length > 0, "EX23-19 stays unread");
}

// ── the reading of "for each" names what is counted ─────────────────────────
{
  const s = compile("[Auto] When this card attacks, choose up to 1 of your opponent's Battle Cards and it gets -4000 power for the turn for each red ≪Saiyan≫ card and/or ≪Bardock's Crew≫ card in your Battle Area.");
  const said = describeScript(s.ops);
  assert.match(said, /for each of red ≪saiyan≫ cards or ≪bardock's crew≫ cards in your Battle Area/i, "P-293: the cards counted are named");
  assert.doesNotMatch(said, /for each of your Battle Cards/, "not the blanket count it used to print");
  const plain = compile("[Auto] When this card attacks, this card gets +1000 power for each card in your Drop Area.");
  assert.match(describeScript(plain.ops), /for each of your cards in the Drop/, "a count with no description keeps the area noun");
  const rest = compile("[Auto] When this card is played, look at up to 3 cards from the top of your deck, add up to 1 ≪Slug's Army≫ card among them to your hand, and place the rest at the bottom of your deck in any order.");
  assert.match(describeScript(rest.ops), /move the rest of the cards looked at to deck/, "'the rest' is said");
}

// ── a count over areas joined by "and" ──────────────────────────────────────
{
  const two = compile("[Permanent] Reduce the energy cost of this card in your hand by 1 for each green Extra Card in your Battle Area and Drop Area.");
  assert.deepEqual(two.unsupported, []);
  const sel = (find(two.ops, "costReduction")[0].amount as { count: Sel }).count;
  assert.deepEqual(sel.areas, ["battle", "drop"], "BT13-073: it kept only the Drop Area");
  const three = compile("[Auto] When this card attacks, this card gets +1000 power for each yellow Extra Card in your Battle Area, Energy Area, and Drop Area.");
  assert.deepEqual((find(three.ops, "power")[0].amount as { count: Sel }).count.areas, ["battle", "energy", "drop"], "a list of three");
  const combo = compile("[Permanent] This card loses -5000 power for each <Tien Shinhan> in your Battle Area or Combo Area.");
  assert.deepEqual((find(combo.ops, "power")[0].amount as { count: Sel }).count.areas, ["battle", "combo"], "TB1-033: the Combo Area is an area");
  const z = compile("[Permanent] If your Leader is a green non-≪Saiyan≫ card, reduce the energy cost of this card in your hand by 1 for each green non-≪Saiyan≫ Battle Card from among all cards in your Z-Energy and Drop.");
  assert.deepEqual((find(z.ops, "costReduction")[0].amount as { count: Sel }).count.areas, ["zEnergy", "drop"], "P-561");
  // Not a count: a pair of sentences keeps reading as it did.
  const one = compile("[Permanent] Reduce the energy cost of this card in your hand by 1 for each green Extra Card in your Drop Area.");
  assert.equal((find(one.ops, "costReduction")[0].amount as { count: Sel }).count.area, "drop");
}

// ── placing from the Z-Deck ─────────────────────────────────────────────────
{
  const scouter = compile("[Activate: Main][Limit 1] If your opponent has a <Son Goku> card in play and you discard this card from your hand: Place up to 1 {Scouter} from your Z-Deck in your Battle Area.");
  assert.deepEqual(scouter.unsupported, [], "BT25-050");
  assert.equal((find(scouter.ops, "choose")[0].sel as Sel).area, "zDeck", "from the Z-Deck");
  assert.equal(find(scouter.ops, "moveTo")[0].to, "battle", "placed in the Battle Area, not played");
  assert.equal(find(scouter.ops, "play").length, 0, "5-5: nothing that triggers on a play fires");
  const hole = compile("[Activate: Main/Battle][Limit 1] Place up to 1 {Dimensional Hole} or {Lightning Shower Rain} from your Z-Deck in the Battle Area.");
  assert.deepEqual(hole.unsupported, [], "BT22-036");
  assert.deepEqual((find(hole.ops, "choose")[0].sel as Sel).filter?.names, ["dimensional hole", "lightning shower rain"], "either card");
  assert.match(describeScript(hole.ops), /\{dimensional hole\} or \{lightning shower rain\} card/, "and the reading says 'or' (adjacent names are all-of, round 5)");
}

// ── "they lose", combo cost and combo power, a card's Combo ─────────────────
{
  const lose = compile("[Activate: Main][Once per turn] Draw 2 cards. Then, choose all of your opponent's Battle Cards, and they lose -10000 power for the duration of the turn.");
  assert.deepEqual(lose.unsupported, [], "BT3-018");
  const power = find(lose.ops, "power")[0];
  assert.deepEqual([power.amount, power.until], [-10000, "turn"], "a loss is a loss, whatever the sign printed");
  assert.ok("var" in power.target, "of the cards chosen");

  const both = compile("[Permanent] Your Red/Green multicolor <Broly> cards in all areas get -1 combo cost and -5000 combo power.");
  assert.deepEqual(both.unsupported, [], "BT22-055b");
  const cost = find(both.ops, "costReduction")[0];
  const comboPower = find(both.ops, "comboPower")[0];
  assert.deepEqual([cost.what, cost.amount, comboPower.amount], ["combo", 1, -5000]);
  assert.deepEqual(comboPower.target, cost.target, "the same cards");
  assert.match(describeScript(both.ops), /\(combo cost\)/, "and the reading says it is the combo cost");

  const combo = compile("[Auto] When you Combo with this card, if your Leader Card is blue and your life is 4 or less, draw 1 card and add +10000 to this card's Combo for the duration of the turn.");
  assert.deepEqual(combo.unsupported, [], "BT1-045");
  const add = find(combo.ops, "comboPower")[0];
  assert.deepEqual([add.amount, add.until, add.target], [10000, "turn", { sel: { special: "self" } }]);
}

// ── after a look, a choice with no area of its own is from the cards looked at ──
{
  const s = compile("[Auto] When you play this card from your hand, look at up to the top 5 cards of your deck, choose up to 1 red ≪Ginyu Force≫ card with an energy cost of 2 other than {Strikeforce Recoome} and play it. Then place the rest at the bottom of your deck in any order.");
  const pick = find(s.ops, "choose")[0].sel as Sel;
  assert.equal(pick.fromVar, "looked", "TB3-007: from the cards looked at");
  assert.equal(pick.area, undefined, "not the cards in play");
  const rest = find(s.ops, "moveTo")[0];
  assert.deepEqual(rest.target, { var: "looked", minus: "c0" }, "the rest are the looked-at cards the choice did not take");
  // An area of its own keeps the choice there.
  const own = compile("[Auto] When you play this card, look at up to the top 3 cards of your deck, choose up to 1 of your opponent's Battle Cards and KO it.");
  assert.equal((find(own.ops, "choose")[0].sel as Sel).fromVar, undefined, "a described area is the area");
  // And so does an owner: "of your <Paikuhan> cards" is the board (BT12-027), not what was looked at.
  const board = compile("[Auto] When this card attacks, look at up to 2 cards from the top of your deck, add up to 1 mono-blue card among them to your hand, then place the remaining cards on top of your deck in any order; choose up to 1 of your <Paikuhan> cards with an energy cost of 3 or less and return it to its owner's hand.");
  assert.equal((find(board.ops, "choose")[1].sel as Sel).fromVar, undefined, "BT12-027: your own cards are on the table");
  // Found by the same census: the look itself was right - "the rest" are the looked-at cards the choice left.
  const sentence = compile("[Auto] When you play this card, look at up to 3 cards from the top of your deck. Choose up to 1 ≪Saiyan≫ and add it to your hand. Then, shuffle your deck.");
  assert.equal((find(sentence.ops, "choose")[0].sel as Sel).fromVar, "looked", "BT3-067: a trait alone, after a look, is from the cards looked at (it read '≪Android≫ card you have in play')");
}

// ── refusals: what a reading must not claim ─────────────────────────────────
{
  // A name "in its skill text" is text, not a character (EX24-23 read '<Janemba> Z-Extras', P-269b any Battle Card in hand).
  assert.ok(compile("[auto] When this card is removed from a Battle Area by an opponent's skill or KO'd, place up to 1 blue Z-Extra with <Janemba> in its skill text from your Z-Deck into your Battle Area.").unsupported.length > 0, "EX24-23 stays unread");
  assert.ok(compile("[activate: main][once per turn]{1}, choose 1 ≪World Tournament≫ card in your Battle Area: Choose up to 1 Battle Card from your hand with a card name in the chosen card's skill text and play it.").unsupported.length > 0, "P-269b stays unread");
  const keyword = compile("[Activate: Main][Once per turn] Choose up to 1 of your red Unison Cards with [Rejuvenate] in its skill text, and you may place 1 red ≪Demon Clan≫ card from your Drop Area under it.");
  assert.equal(((find(keyword.ops, "choose")[0].sel as Sel).filter?.keywords as unknown[] | undefined)?.length, 1, "a keyword in the text is still read as the keyword");
  // "You can activate its [Awaken] even if your life is at N or less" lifts a gate; it is not a play of a card. Phrasing
  // batch 6 reads the second as that gate lifted (`awakenLife`); the first, an [Auto] naming no moment, and the third, a
  // card of no fixed area, stay unread.
  for (const [text, lifted] of [
    ["[Auto] If your Leader's back side is {Saiyan Bond Vegeta} and your opponent has 2 or more energy: During this turn, you can activate your Leader's [Awaken] even if your life is at 6 or less.", false],
    ["[Auto] When you play this card, for the duration of the turn, if your Leader Card is a red <Broly> card, you can activate its [Awaken] skill even if you have 5 or more life.", true],
    ["[Auto] You can activate your green <Beerus> or <Champa> card's [Awaken] even when your life is at 4 or less.", false],
  ] as const) {
    const s = compile(text);
    assert.equal(find(s.ops, "play").length, 0, "no play of a card");
    assert.equal(find(s.ops, "choose").length, 0, "and no choice of six Leaders");
    if (lifted) assert.ok(!s.unsupported.length && find(s.ops, "permit").some((p) => (p as { what?: string }).what === "awakenLife"), "the permission is the gate lifted");
    else assert.ok(s.unsupported.length > 0, "the permission stays unread");
  }
  assert.equal(find(compile("[Permanent] If your Leader Card is a Blue/Green multicolor card, you can activate your Leader Card's [Activate: Main], [Activate: Battle], and [Activate: Main/Battle] skills even when your life is at 4 or less.").ops, "play").length, 0, "P-208: a Leader is not played");
  // "They both lose": two choices, and a bare reference names only the last.
  const both = compile("[Auto] When this card attacks, draw 1 card, then choose 1 of your Battle Cards and 1 of your opponent's Battle Cards, and they both lose -10000 power for the duration of the turn.");
  assert.equal(find(both.ops, "power").length, 0, "BT4-002b: -10000 on one of the two cards is not what is printed");
  assert.ok(both.unsupported.length > 0);
}
