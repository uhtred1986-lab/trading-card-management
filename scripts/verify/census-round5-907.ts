/**
 * #907, the fifth census round (18 Oct 2026). What each reading must say, and what it must refuse:
 *
 *  - an [Activate] / [Auto] whose price is closed with a comma where the card should print a colon -
 *    "[Activate: Main][Once per turn]{g}, choose one-" (BT11-061b), "[Auto][Limit 1]{b}, when this card is played
 *    using [Over Realm], ..." (BT31-097), BT12-154, BT14-115, BT21-037, BT21-131, P-523, P-709: the orbs are the price,
 *    the rest is the skill. Keyword lines ("[Successor]{g}{y}{1}, draw 2 cards.") keep their old split.
 *  - "If your Battle Card in battle is red" (DB1-003, DB1-036, DB1-042, DB1-072).
 *  - "a green <Son Goku: GT> card is in your Warp" (BT20-065, BT20-066, BT20-069) - and the chain it sits in
 *    (BT20-078: "..., this card and {X} are in your Warp") stays unread rather than lose "this card".
 *  - "Add this card to your hand from your Warp / Drop Area" (BT16-089, EX19-28, EX19-35, XD3-07, BT13-059).
 *  - "Negate the [Counter] skill" (BT11-042, BT30-150, P-418); the typed "[Counter: Attack]" (EX09-06, BT16-043) stays unread.
 *  - "...you lose the game" (BT2-069b): the opponent wins, at the end of the turn; a [Permanent] one (BT12-086) stays unread.
 *  - misreads found on the way: "your opponent places N cards from the top of their deck in their Drop Area" (BT9-024,
 *    BT9-035, BT9-101, BT6-121, BT10-149) was read as the opponent CHOOSING N cards of their whole deck; ", then you choose
 *    up to N of your opponent's Battle Cards" (BT10-149, BT18-143, P-279, BT12-152, BT13-144, BT7-111, BT8-105, EX03-28)
 *    was unread after any sentence about the opponent; a per-count change read "+-2000".
 *
 * Rules engine only; nothing reads the database.
 */
import assert from "node:assert/strict";
import { compileSkill, parseSkills } from "./harness";
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

// ── a price closed with a comma ─────────────────────────────────────────────
{
  const green = parseSkills("[activate: main][once per turn]{g}, choose one— ・Choose 1 of your opponent's Unison Cards and remove a marker from it. ・You may choose 1 green card in your hand and discard it. If you do, play 2 Ghost Tokens in Rest Mode. (Ghost Tokens have 15000 power.)")[0];
  assert.equal(green.cost, "{g}", "BT11-061b: the orb is the price");
  assert.match(green.effect, /^choose one/, "and the rest is the skill");
  assert.deepEqual(compileSkill(green).unsupported, [], "which now reads whole");

  const yellow = parseSkills("[activate: main][once per turn]{y}, play up to 1 yellow <Hell Fighter 17> card with an energy cost of 1 from your deck or Drop Area, then shuffle your deck if you looked through it.")[0];
  assert.deepEqual([yellow.cost, compileSkill(yellow).unsupported], ["{y}", []], "BT14-115");
  const two = parseSkills("[activate: main] {1}, choose this card and all of your opponent's Battle Cards and Unison Cards and send them to their owners' Warps.")[0];
  assert.equal(two.cost, "{1}", "BT12-154: a generic orb is a price too");
  assert.ok(compileSkill(two).unsupported.length > 0, "BT12-154 still has the part it cannot read: all of the opponent's cards");

  const realm = parseSkills("[auto] [limit 1] {b}, when this card is played using [over realm], play up to 1 <Aeos> card with an energy cost of 6 or less from your Warp.")[0];
  assert.equal(realm.cost, "{b}", "BT31-097");
  assert.match(realm.effect, /^when this card is played using \[over realm\]/i, "the trigger stays in the effect, where triggers are read from");
  assert.deepEqual(compileSkill(realm).unsupported, []);

  // unchanged: keyword lines, a colon, a plain trigger with no orbs
  assert.equal(parseSkills("[Successor]{g}{y}{1}, draw 2 cards.")[0].cost, "", "a keyword line keeps its split");
  const colon = parseSkills("[activate: main]{r}, if your Leader Card is a red <King Piccolo> card: Play this card from your hand.")[0];
  assert.equal(colon.cost, "{r}, if your Leader Card is a red <King Piccolo> card", "a colon still splits there");
  assert.equal(parseSkills("[Auto] When this card is played, draw 1 card.")[0].cost, "");
}

// ── "If your Battle Card in battle is red" ──────────────────────────────────
{
  const s = compile("[Auto] If your Battle Card in battle is red: When you combo with this card, it gets +5000 combo power for the duration of the turn.");
  assert.deepEqual(s.unsupported, [], "DB1-003");
  const cond = find(s.ops, "if")[0]?.cond as { kind: string; sel: { side: string; area: string; filter: { colors: string[]; type: string } } };
  assert.equal(cond.kind, "inBattle");
  assert.deepEqual([cond.sel.side, cond.sel.area, cond.sel.filter.colors, cond.sel.filter.type], ["you", "battle", ["Red"], "BATTLE"]);
  assert.match(describeScript(s.ops), /red Battle Cards? in your Battle Area is in a battle: this card \+5000 combo power/);
  assert.ok(compile("[Auto] If your Battle Card in battle isn't red: When you combo with this card, it gets +5000 combo power for the duration of the turn.").unsupported.length > 0, "'isn't' is not read: not in a battle is not 'in a battle, of another colour'");
}

// ── "...is in your Warp" ────────────────────────────────────────────────────
{
  const s = compile("[Permanent] If your Leader is a green <Son Goku: GT> card and a green <Son Goku: GT> card is in your Warp, reduce the energy cost of this card in your hand by 1.");
  assert.deepEqual(s.unsupported, [], "BT20-065");
  const count = find(s.ops, "if").map((o) => o.cond).find((c) => c.kind === "count") as { kind: "count"; sel: { area: string; side: string }; atLeast: number };
  assert.deepEqual([count.sel.area, count.sel.side, count.atLeast], ["warp", "you", 1]);
  // BT20-078: "this card and {X} are in your Warp" is two requirements; cutting at the "and" lost the first.
  const chain = compile("[Auto][Limit 1] If your Leader is a green <Son Goku: GT> card, this card and {Dr. Myuu, Vengeful Alliance} are in your Warp, and you send 1 green <Son Goku: GT> card from your hand to your Warp: At the start of your Main Phase, draw 1 card.");
  assert.ok(chain.unsupported.length > 0, "BT20-078 stays unread rather than drop 'this card'");
}

// ── "Add this card to your hand from your Warp / Drop Area" ─────────────────
{
  const warp = compile("[activate: main][limit 1]{y}, if your Leader Card is a <Zamasu> or <Goku Black> card: Add this card to your hand from your Warp.");
  assert.deepEqual(warp.unsupported, [], "BT16-089");
  const move = find(warp.ops, "moveTo")[0];
  assert.deepEqual([move.to, (move.target as { sel: { special: string; area: string } }).sel], ["hand", { special: "self", area: "warp" }]);
  const drop = compile("[activate: main]{y}, if your Leader Card is a <Cell> card: Add this card to your hand from your Drop Area.");
  assert.deepEqual([drop.unsupported, (find(drop.ops, "moveTo")[0].target as { sel: { area: string } }).sel.area], [[], "drop"], "XD3-07");
  const delayed = compile("[activate: main]{b}, send this card to its owner's Warp: Choose up to 1 black multicolor Battle Card with an energy cost of 2 in your hand and play it. At the start of your next turn, add this card to your hand from your Warp.");
  assert.deepEqual(delayed.unsupported, [], "EX19-28: the delayed half reads too");
  assert.equal(find(delayed.ops, "delay").length, 1);
}

// ── "Negate the [Counter] skill" ────────────────────────────────────────────
{
  const s = compile("[Counter: Counter] If your Leader is a black <Supreme Kai of Time> card: Negate the [Counter] skill and play this card.");
  assert.deepEqual(s.unsupported, [], "P-418");
  assert.equal(find(s.ops, "negateCounter").length, 1);
  assert.deepEqual(compile("[counter: counter] Negate the [counter] skill and remove this card from the game.").unsupported, [], "BT30-150");
  assert.ok(compile("[Counter: Counter] If your Leader Card is red and you choose 1 yellow card in your hand and place it in your Drop Area: Negate the [Counter: Attack] skill.").unsupported.length > 0, "EX09-06: the kind it answers is not asked, so it is not read");
  // "negate that card's [Auto] skill" is still the kind-scoped negation
  assert.equal(find(compile("[Auto] When this card is played, choose up to 1 of your opponent's Battle Cards and negate that card's [Auto] skill for the turn.").ops, "negateSkillsOfKind").length, 1);
}

// ── "you lose the game" ─────────────────────────────────────────────────────
{
  const s = compile("[Activate: Battle] [Once per turn] Remove all of your cards in the Drop Area from the game: This card gains +5000 power and [Triple Strike] (This card inflicts 3 damage instead of 1 when attacking). Then, at the end of the turn, you lose the game.");
  assert.deepEqual(s.unsupported, [], "BT2-069b");
  const delay = find(s.ops, "delay")[0];
  assert.equal(delay.at, "turnEnd");
  assert.deepEqual(find(delay.ops, "win"), [{ op: "win", side: "opponent" }], "the other player wins");
  assert.match(describeScript(s.ops), /at the end of the turn: your opponent wins the game/);
  assert.equal(validateProgram(s.ops), true);
  assert.ok(compile("[Permanent] If all of your life is face up, you lose the game.").unsupported.length > 0, "BT12-086: a [Permanent] never resolves, so it stays unread");
}

// ── misreads found on the way ───────────────────────────────────────────────
{
  const mill = compile("[Auto] When you play this card, your opponent places 5 cards from the top of their deck in their Drop Area.");
  assert.deepEqual(mill.unsupported, [], "BT9-024");
  assert.deepEqual(find(mill.ops, "choose"), [], "nobody chooses: it was read as the opponent picking 5 cards of their whole deck");
  assert.deepEqual(find(mill.ops, "mill").map(({ n, side }) => [n, side]), [[5, "opponent"]]);
  assert.equal(describeScript(mill.ops), "5 from the top of your opponent's deck to the Drop", "and the reading says whose deck");
  assert.equal(describeScript(compile("[Auto] When you play this card, place 2 cards from the top of your deck in your Drop Area.").ops), "2 from the top of the deck to the Drop");

  const then = compile("[auto] When this card is played, your opponent places 2 cards from the top of their deck in their Drop Area, then you choose up to 1 of your opponent's Battle Cards and it gets -5000 power for the turn.");
  assert.deepEqual(then.unsupported, [], "BT10-149: 'then you choose'");
  const power = find(then.ops, "power")[0];
  assert.equal(power.amount, -5000);
  assert.equal(find(then.ops, "choose")[0].sel && (find(then.ops, "choose")[0].sel as { area: string }).area, "battle", "the power lands on a Battle Card, not on the milled cards");
  for (const text of [
    "[auto] When this card is played, your opponent sends 1 card from their hand to their Warp, then you choose up to 2 of your opponent's Battle Cards and they get -30000 power for the turn.",
    "[Auto] If all of your energy is mono-green: When this card is played from your hand, you and your opponent draw 1 card, then you choose up to 1 of your opponent's Battle Cards and KO it.",
    "[auto] When this card attacks, your opponent reveals their hand. You choose 1 card from their hand with an energy cost of 7 or less, place it at the bottom of its owner's deck, then your opponent draws 1 card.",
  ]) assert.deepEqual(compile(text).unsupported, [], text);
  assert.ok(compile("[Permanent] When this card deals damage, you choose the card your opponent loses from their life.").unsupported.length > 0, "BT12-056b: 'you choose the card ...' names no count and stays unread");

  // a per-count change keeps its sign
  const minus = describeScript(compile("[Auto] When this card is played, choose up to 1 of your opponent's Battle Cards and it gets -3000 power for the turn for each of your Z-Energy.").ops);
  assert.match(minus, /-3000 power for each of your Z-Energy/, minus);
  assert.doesNotMatch(minus, /\+-/);
}

console.log("census round 5 (#907): ok");
