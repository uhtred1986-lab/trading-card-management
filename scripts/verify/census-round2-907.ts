/**
 * #907, the second census round (18 Oct 2026):
 *
 *  - "[activate main]" with no colon (BT9-126b) is the [Activate: Main] tag, in the parser and in
 *    `CORRECTIONS` (a catalog misprint, not an official erratum), and "[Counter Play]" likewise.
 *  - "add up to 1 <A> or <B> card―both red and with an energy cost of 4 or less―to your hand"
 *    (BT22-081, BT23-010, BT24-018 and the rest of the family, 14 skills) - the dash closes up
 *    against "to your hand" - and the feed's "?" for the dash pair (BT18-047, BT18-050, BT18-051,
 *    BT18-116).
 *  - two named cards taken to the hand: "add up to 1 yellow <A> card and up to 1 yellow <B> card
 *    from your Drop Area to your hand" (BT10-111, P-255) and "choose up to 1 red <A> card and 1 red
 *    <B> card from your Drop Area and add them to your hand" (BT6-012, P-095, P-108).
 *  - "if <A> and <B> are in play in your Battle Area" (TB1-051b, TB1-058, TB1-059, BT3-056) and
 *    "if <A> is in your Battle Area or Leader Area" (BT2-018, BT2-050, BT3-012, TB1-017).
 *  - what this exposed: "from you hand" (BT2-081) and "you can activate this card's [Awaken] when
 *    your life is at 6 or less" (BT3-056, BT6-105), which read as an instruction to play the card.
 *
 * Rules engine only; nothing reads the database.
 */
import assert from "node:assert/strict";
import { CORRECTIONS, correctSkillText } from "../../src/lib/catalog/errata";
import { DBS_DEFINITION, DEFS, assertConsistentG, card, compileSkill, findG, parseSkills, playG, stagedG, zoneOf } from "./harness";
import type { Action, EngineState } from "./harness";
import { splitClauses } from "../../src/lib/arena/compile/clauses";
import { validateProgram, type Op } from "../../src/lib/arena/vm/script";
import { moveCard } from "../../src/lib/arena/vm/zones";

const compile = (text: string) => compileSkill(parseSkills(text)[0]);
const def = (id: string, o: Parameters<typeof card>[1] & { skill?: string }) => {
  DEFS[id] = { ...card(id, o), ...o, id, name: id } as (typeof DEFS)[string];
};
function find<T extends Op["op"]>(node: unknown, kind: T, out: Extract<Op, { op: T }>[] = []): Extract<Op, { op: T }>[] {
  if (Array.isArray(node)) for (const x of node) find(x, kind, out);
  else if (node && typeof node === "object") {
    if ((node as { op?: string }).op === kind) out.push(node as Extract<Op, { op: T }>);
    for (const v of Object.values(node)) find(v, kind, out);
  }
  return out;
}
const pay = (s: EngineState) => (s.prompt.kind === "payCost" ? playG(s, { type: "payCost", player: "p1", option: 0 } as Action) : s);
const playCard = (s: EngineState, id: string) => pay(playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", id) }));

// ── the tag with no colon ───────────────────────────────────────────────────
{
  assert.equal(parseSkills("[activate main]{16}: You win the game.")[0].kind, "activate:main", "BT9-126b: the parser takes the missing colon");
  assert.equal(parseSkills("[Activate Battle] Draw 1 card.")[0].kind, "activate:battle");
  assert.equal(parseSkills("[Counter Play] Draw 1 card.")[0].kind, "counter:play");
  assert.equal(parseSkills("[Permanent] You can only place up to 6 energy in your Energy Area.")[0].kind, "permanent", "a [Permanent] is still one");
  assert.equal(parseSkills("[Counter] Draw 1 card.")[0].kind, "permanent", "the bare [Counter] is not a timing tag");
  const text = correctSkillText("BT9-126", "[activate main]{16}: You win the game.");
  assert.equal(text, "[activate: main]{16}: You win the game.", "the catalog misprint is fixed on the way in");
  assert.ok(CORRECTIONS["BT9-126"], "and the fix is recorded in CORRECTIONS");
  assert.equal(correctSkillText("BT9-126", "[activate: main]{16}: You win the game."), "[activate: main]{16}: You win the game.", "safe to apply twice");
}

// ── the search with a dash aside ────────────────────────────────────────────
{
  const search = (tail: string) => compile(`[Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 ${tail}, then shuffle your deck.`);
  const closed = search("≪Saiyan≫ or ≪Earthling≫ card—both red and with an energy cost of 4 or less—to your hand");
  assert.deepEqual(closed.unsupported, [], "BT24-018: the dash is closed up against 'to your hand'");
  const [pick] = find(closed.ops, "choose");
  const filter = (pick.sel as { filter: { colors: string[]; traits: string[]; costMax: number | null } }).filter;
  assert.deepEqual([filter.colors, filter.traits, filter.costMax], [["Red"], ["saiyan", "earthling"], 4], "red AND (Saiyan or Earthling) AND cost 4 or less");
  assert.equal((pick.sel as { fromVar?: string }).fromVar, "looked", "taken from the cards looked at");
  assert.deepEqual(find(closed.ops, "moveTo").map((m) => m.to), ["hand"]);
  assert.equal(validateProgram(closed.ops), true);

  const question = search("≪Earthling≫ or ≪Namekian≫ card?both yellow and with an energy cost of 4 or less?or 1 yellow Unison with a specified cost of 2 among them to your hand");
  assert.deepEqual(question.unsupported, [], "BT18-116: the feed's '?' for the dash pair");
  const [either] = find(question.ops, "choose");
  const anyOf = (either.sel as { filter: { anyOf?: unknown[] } }).filter.anyOf;
  assert.equal(anyOf?.length, 2, "two descriptions, the Unison one with its own cost");

  const play = compile("[auto] When this card attacks, play up to 1 <Android 14> or <Android 15> card?both red and with an energy cost of 1?from your hand or Drop.");
  assert.deepEqual(play.unsupported, [], "BT19-004: the same aside on a play");
  const [from] = find(play.ops, "choose");
  assert.deepEqual((from.sel as { areas?: string[] }).areas?.slice().sort(), ["drop", "hand"], "from the hand or the Drop, not from play");
}

// ── two named cards to the hand ─────────────────────────────────────────────
{
  const pair = compile("[auto] When this card is KO'd, add up to 1 green <Trunks: Youth> card and up to 1 green <Gotenks> card from your Drop Area to your hand.");
  assert.deepEqual(pair.unsupported, [], "P-255");
  const picks = find(pair.ops, "choose");
  assert.equal(picks.length, 2, "one choice per name");
  assert.ok((picks[1].sel as { notIn?: string[] }).notIn?.length, "the second is a card of its own");
  assert.deepEqual(find(pair.ops, "moveTo").map((m) => m.to), ["hand", "hand"]);

  const choose = compile("[Activate: Main] Place this card in its owner's Drop Area: If your Leader Card is a red ≪Saiyan≫ card, choose up to 1 red <Son Goku: Br> card and 1 red <Vegeta: Br> card from your Drop Area and add them to your hand, then choose up to 1 of your opponent's Battle Cards and it gets -10000 power for the turn.");
  assert.deepEqual(choose.unsupported, [], "BT6-013: the pair, then the next sentence");
  assert.equal(find(choose.ops, "choose").length, 3);

  // A single name is still the ordinary reading; the pair shape does not take it.
  const single = compile("[auto] When this card is KO'd, add up to 1 green <Gotenks> card from your Drop Area to your hand.");
  assert.equal(find(single.ops, "choose").length, 1);
}

// …in a game: both cards come out of the Drop, one each, and nothing else does.
{
  def("R2-GOTEN", { colors: ["Green"], characters: ["R2 Goten"] });
  def("R2-TRUNKS", { colors: ["Green"], characters: ["R2 Trunks"] });
  def("R2-OTHER", { colors: ["Green"], characters: ["R2 Other"] });
  def("R2-PAIR", { energyCost: 0, skill: "[Auto] When this card is played, add up to 1 green <R2 Goten> card and up to 1 green <R2 Trunks> card from your Drop Area to your hand." });
  let s = stagedG({ hand: ["R2-PAIR", "R2-GOTEN", "R2-TRUNKS", "R2-OTHER"] });
  for (const id of ["R2-GOTEN", "R2-TRUNKS", "R2-OTHER"]) moveCard(s, DBS_DEFINITION, findG(s, "p1", "hand", id), "drop");
  s = playCard(s, "R2-PAIR");
  for (let i = 0; i < 6 && s.prompt.kind === "chooseCards"; i++) s = playG(s, { type: "choose", player: "p1", cards: [s.prompt.choice.candidates[0]] });
  const hand = zoneOf(s, "p1", "hand").map((id) => s.cards[id].cardId);
  assert.ok(hand.includes("R2-GOTEN") && hand.includes("R2-TRUNKS"), "both named cards are back in the hand");
  assert.ok(!hand.includes("R2-OTHER"), "the third card stayed in the Drop");
  assertConsistentG(s);
}

// ── two names present, and either of two areas ──────────────────────────────
{
  assert.deepEqual(splitClauses("if <Android 14> and <Android 15> are in your Drop Area, draw 1 card."), ["if <Android 14> and <Android 15> are in your Drop Area", "draw 1 card"], "the 'and' is the condition's own");
  assert.deepEqual(splitClauses("if your Leader Card is a ≪Shenron≫ card and {Oolong's Wish} is in your Drop Area, draw 2 cards.").length, 3, "a Leader test and a presence test stay two clauses (BT5-014)");

  const both = compile("[Activate: Main] [Once per turn] If <Kakunsa> and <Rozie> are in play in your Battle Area, choose 1 of your opponent's Battle Cards and KO it.");
  assert.deepEqual(both.unsupported, [], "TB1-051b");
  const [gate] = find(both.ops, "if");
  assert.equal((gate.cond as { kind: string; conds: unknown[] }).kind, "all", "both must be there");
  assert.equal((gate.cond as { conds: unknown[] }).conds.length, 2);

  const either = compile("[Permanent] If <Pan> is in your Battle Area or Leader Area, you can play this card from your hand without paying its energy cost.");
  assert.deepEqual(either.unsupported, [], "BT3-012");
  const [open] = find(either.ops, "if");
  const cond = open.cond as { kind: string; conds: { kind: string; sel: { area: string }; atLeast: number }[] };
  assert.equal(cond.kind, "any");
  assert.deepEqual(cond.conds.map((x) => [x.sel.area, x.atLeast]), [["battle", 1], ["leader", 1]], "a <Pan> in either area");
  assert.deepEqual(find(either.ops, "altCost").map((o) => o.pay), ["none"], "and then the play costs no energy");

  // The reversed order of the two areas.
  assert.deepEqual(compile("[Auto] When this card attacks, if <Gotenks> is in your Leader Area or Battle Area, draw 1 card.").unsupported, []);
}

// ── what the exposure showed ────────────────────────────────────────────────
{
  const typo = compile("[Permanent] If <Android 18> is in your Battle Area or Leader Area, you can play this card from you hand without paying its energy cost.");
  assert.deepEqual(typo.unsupported, [], "BT2-081: 'from you hand' is 'from your hand'");
  assert.deepEqual(find(typo.ops, "altCost").map((o) => o.pay), ["none"], "a permission, not an instruction to play the card");
  assert.deepEqual(find(typo.ops, "play"), [], "nothing is played");

  const awaken = compile("[Permanent] If there is a skill-less Battle Card in your Drop Area, you can activate this card's [Awaken] skill when your life is at 6 or less.");
  assert.deepEqual(find(awaken.ops, "play"), [], "BT6-105: a widened [Awaken] moment is not a play");
  assert.ok(awaken.unsupported.length > 0, "and it stays unread rather than guessed");
}

console.log("census-round2-907: ok");
