/**
 * #907, the effect families the census (issue comment of 18 Oct 2026) named:
 *
 *  - "…then **place the remaining cards on top of your deck in any order**" (BT12-027, BT12-031),
 *    "…**into their owner's Drop**" (BT29-014, BT29-015), "…any remaining cards in your Drop Area"
 *    (BT10-001), and "…on the top **or** bottom of your deck" (BT12-044, BT10-079), which the
 *    player decides (best guess: one answer for the whole remainder).
 *  - "**You win the game**" (BT16-017, BT16-068, BT8-045b, BT30-017b): the skill ends the game.
 *    Its conditions are read exactly: "5 cards **owned by your opponent** under this card"
 *    (BT16-068) and "a {Dr.Uiro's Lab} in your Battle Area has 17 or more cards under it"
 *    (BT8-045b) - a win must not fire on a wider board than the card prints.
 *  - "**Declare 1 number**" (BT22-090 and the Fortuneteller Baba cards): named first, read back as
 *    "the declared number" against the revealed card's energy cost, and as a rise of an energy
 *    cost (BT24-105, BT24-059).
 *  - "**Reduce the combo cost by 1** and negate the [Energy-Exhaust] skill of A cards and B cards
 *    in all of your areas" (BT25-098, BT25-103, BT29-085b, EX19-20): one reduction per description.
 *  - "…and **you draw 1 card**" (BT8-089b, TB2-033, BT19-022, BT19-024).
 *
 * Rules engine only; nothing reads the database. Wordings are the catalog's deckplanet text of
 * 18 Oct 2026, with the trigger shortened where it is not the point.
 */
import assert from "node:assert/strict";
import { DBS_DEFINITION, DEFS, actsG, assertConsistentG, card, comboCostOfG, compileSkill, findG, moveG, parseSkills, playCostG, playG, stagedG, zoneOf } from "./harness";
import type { Action, EngineState } from "./harness";
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

// ── the compiler: the remainder of a look ───────────────────────────────────
{
  const rest = (text: string) => compile(text);
  const bt12031 = rest("[Activate: Main] If your Leader Card is a blue <Paikuhan> card and you discard this card: Look at up to 3 cards from the top of your deck, add up to 1 mono-blue ≪Saiyan≫ or ≪West Galaxy Warrior≫ card with an energy cost of 5 or less among them to your hand, place the remaining cards on top of your deck in any order.");
  assert.deepEqual(bt12031.unsupported.filter((u) => /remaining/.test(u)), [], "BT12-031: 'on top of your deck' (no 'the') reads");
  const back = find(bt12031.ops, "moveTo").filter((m) => m.to === "deck");
  assert.deepEqual(back.map((m) => m.position), ["top"]);
  assert.deepEqual((back[0].target as { var: string; minus?: string }).var, "looked");
  assert.ok((back[0].target as { minus?: string }).minus, "the rest is the look minus what the choice took");

  const bt29014 = rest("[auto] When this card is played, look at up to 3 cards from the top of your deck, add up to 1 red card to your hand, then place the remaining cards into their owner's Drop.");
  assert.deepEqual(bt29014.unsupported, [], "BT29-014: 'their owner's Drop'");
  assert.deepEqual(find(bt29014.ops, "moveTo").filter((m) => m.to === "drop").length, 1);

  const bt10001 = rest("[Auto] When this card attacks, look at up to 2 cards from the top of your deck, add up to 1 red card among them to your hand, then place any remaining cards in your Drop Area and this card gets +5000 power for the turn.");
  assert.deepEqual(bt10001.unsupported, [], "BT10-001: 'any remaining cards'");

  const either = rest("[Auto] When this card is played, look at up to 2 cards from the top of your deck, add up to 1 mono-blue card among them to your hand, then place the remaining cards at the top or bottom of your deck in any order. You can't play copies of this card for the turn.");
  assert.deepEqual(either.unsupported, [], "BT12-044: top or bottom");
  const [mode] = find(either.ops, "chooseMode");
  assert.deepEqual(mode.modes.map((m) => (m.ops[0] as { position?: string }).position), ["top", "bottom"]);
  assert.equal(validateProgram(either.ops), true);
}

// …in a game: the three cards looked at, one taken, the other two go where the card says.
{
  def("C907-A", { colors: ["Red"] });
  def("C907-B", { colors: ["Red"] });
  def("C907-C", { colors: ["Red"] });
  const top3 = (s: EngineState) => {
    const deck = zoneOf(s, "p1", "deck");
    s.cards[deck[0]].cardId = "C907-A";
    s.cards[deck[1]].cardId = "C907-B";
    s.cards[deck[2]].cardId = "C907-C";
    return deck.slice(0, 3);
  };
  const run = (skill: string, answers: Action[] = []) => {
    def("C907-LOOK", { energyCost: 0, skill });
    let s = stagedG({ hand: ["C907-LOOK"] });
    const seen = top3(s);
    const before = zoneOf(s, "p1", "deck").length;
    s = playCard(s, "C907-LOOK");
    let taken: string | null = null;
    for (let i = 0; i < 6 && (s.prompt.kind === "chooseCards" || s.prompt.kind === "chooseMode"); i++) {
      if (s.prompt.kind === "chooseCards") {
        taken = s.prompt.choice.candidates[0];
        s = playG(s, { type: "choose", player: "p1", cards: [taken] });
      } else s = playG(s, answers.shift() ?? { type: "chooseMode", player: "p1", index: 0 });
    }
    assert.ok(taken, "one card is chosen from the three");
    assert.ok(zoneOf(s, "p1", "hand").includes(taken!), "and goes to the hand");
    assert.equal(zoneOf(s, "p1", "deck").length, skill.includes("Drop") ? before - 3 : before - 1, "the other two went where the card says");
    assertConsistentG(s);
    return { s, rest: seen.filter((id) => id !== taken) };
  };
  const onTop = run("[Auto] When this card is played, look at up to 3 cards from the top of your deck, add up to 1 card among them to your hand, then place the remaining cards on top of your deck in any order.");
  assert.deepEqual(zoneOf(onTop.s, "p1", "deck").slice(0, 2).sort(), [...onTop.rest].sort(), "BT12-031: the other two are back on top");
  const drop = run("[Auto] When this card is played, look at up to 3 cards from the top of your deck, add up to 1 card to your hand, then place the remaining cards into their owner's Drop.");
  assert.ok(onTop.rest.length === 2 && drop.rest.every((id) => zoneOf(drop.s, "p1", "drop").includes(id)), "BT29-014: the other two are in the Drop");
  const bottom = run("[Auto] When this card is played, look at up to 3 cards from the top of your deck, add up to 1 card among them to your hand, then place the remaining cards at the top or bottom of your deck in any order.", [{ type: "chooseMode", player: "p1", index: 1 }]);
  assert.deepEqual(zoneOf(bottom.s, "p1", "deck").slice(-2).sort(), [...bottom.rest].sort(), "BT12-044: 'bottom' was the answer, so they are last");
  const top = run("[Auto] When this card is played, look at up to 3 cards from the top of your deck, add up to 1 card among them to your hand, then place the remaining cards at the top or bottom of your deck in any order.", [{ type: "chooseMode", player: "p1", index: 0 }]);
  assert.deepEqual(zoneOf(top.s, "p1", "deck").slice(0, 2).sort(), [...top.rest].sort(), "and 'top' puts them first");
}

// ── "you win the game" ──────────────────────────────────────────────────────
{
  const p = compile("[Activate: Main] If there are 5 cards owned by your opponent under this card: You win the game.");
  assert.deepEqual(p.unsupported, []);
  assert.deepEqual(find(p.ops, "win"), [{ op: "win" }]);
  const [cnt] = find(p.ops, "if");
  const sel = (cnt.cond as { sel: { area?: string; ownedByOpponent?: boolean } }).sel;
  assert.deepEqual([sel.area, sel.ownedByOpponent], ["under", true], "BT16-068: only the opponent's cards under it count");
  const lab = compile("[Activate: Main] If a {Dr.Uiro's Lab} in your Battle Area has 17 or more cards under it: You win the game.");
  assert.deepEqual(lab.unsupported, [], "BT8-045b");
  const labCond = (find(lab.ops, "if")[0].cond as { kind: string; sel: { area?: string; underHost?: unknown }; atLeast?: number });
  assert.deepEqual([labCond.kind, labCond.sel.area, labCond.atLeast, !!labCond.sel.underHost], ["count", "under", 17, true]);
  const priest = compile("[activate: main]{r}{u}{g}{y}{1}, if your Leader Card is a <Great Priest> card: Deal 1 damage to your opponent for every 2 colors on ≪God≫ cards in your Battle Area. (2 damage max.) Additionally, if you have 12 or more multicolor ≪God≫ cards in play, you win the game.");
  assert.equal(find(priest.ops, "win").length, 1, "BT16-017");
  assert.equal(validateProgram(priest.ops), true);
}

// …in a game: the skill ends it, and nothing after it is played.
{
  def("C907-WIN", { energyCost: 0, skill: "[Auto] When this card is played, you win the game. Draw 1 card." });
  let s = stagedG({ hand: ["C907-WIN"] });
  const hand = zoneOf(s, "p1", "hand").length;
  s = playCard(s, "C907-WIN");
  assert.equal(s.prompt.kind, "gameOver");
  assert.equal(s.winner, "p1");
  assert.equal(zoneOf(s, "p1", "hand").length, hand - 1, "the card left the hand and the draw after 'you win' did not happen");
  assertConsistentG(s);

  // BT16-068: five of the opponent's cards under the card, not four, and not five of mine.
  def("C907-THEIRS", { colors: ["Blue"] });
  def("C907-LAB", { energyCost: 0, skill: "[Activate: Main] If there are 5 cards owned by your opponent under this card: You win the game." });
  const staged = (own: number, theirs: number) => {
    const g = stagedG({ battle: ["C907-LAB"], oppHand: ["C907-THEIRS", "C907-THEIRS", "C907-THEIRS", "C907-THEIRS", "C907-THEIRS", "C907-THEIRS"] });
    const host = findG(g, "p1", "battle", "C907-LAB");
    for (const id of zoneOf(g, "p1", "deck").slice(0, own)) assert.ok(moveCard(g, DBS_DEFINITION, id, "battle", { under: host }).ok);
    for (const id of zoneOf(g, "p2", "hand").filter((x) => g.cards[x].cardId === "C907-THEIRS").slice(0, theirs)) assert.ok(moveCard(g, DBS_DEFINITION, id, "battle", { under: host }).ok);
    assert.equal(g.cards[host].under.length, own + theirs);
    return { g, host };
  };
  const activate = (g: EngineState, host: string) => actsG(g).find((a) => a.type === "activate" && a.card === host);
  for (const [own, theirs, wins] of [[0, 5, true], [3, 4, false], [5, 0, false]] as const) {
    const { g, host } = staged(own, theirs);
    const a = activate(g, host);
    if (!wins) {
      // The condition is part of the skill: it may be offered, and it must not win.
      if (a) {
        const after = pay(playG(g, a));
        assert.notEqual(after.winner, "p1", `${own} of mine and ${theirs} of theirs under it must not win`);
      }
      continue;
    }
    assert.ok(a, "offered with five of theirs under it");
    const after = pay(playG(g, a!));
    assert.equal(after.winner, "p1", "five of the opponent's cards under it wins");
  }
}

// ── "declare 1 number" ──────────────────────────────────────────────────────
{
  const baba = compile("[Auto][Limit 1] Declare 1 number: When this card is played from your hand, reveal the top card of your opponent's deck, then flip the revealed card over and place it at the top of their deck. Additionally, if the revealed card's energy cost is the same as the declared number, draw 1 card.");
  assert.deepEqual(baba.unsupported, []);
  assert.deepEqual(find(baba.ops, "declare"), [{ op: "declare", min: 0, max: 10 }]);
  assert.equal(baba.ops[0].op, "declare", "named first");
  assert.ok(find(baba.ops, "if").some((i) => (i.cond as { kind: string }).kind === "varAttrIsX"), "the revealed card is measured against the number");
  assert.equal(validateProgram(baba.ops), true);

  const raise = compile("[activate: main][once per turn] Declare 1 number that's 3 or less: Increase this card's energy cost by the declared number for the turn.");
  assert.deepEqual(raise.unsupported, []);
  assert.deepEqual(find(raise.ops, "declare"), [{ op: "declare", min: 0, max: 3 }]);
  const [cost] = find(raise.ops, "costReduction");
  assert.deepEqual(cost.amount, { x: true, times: -1 }, "a raise is a reduction turned round");
  assert.equal(validateProgram(raise.ops), true);

  // The declaration is the price's tail, and an "and" in front of it is a condition that stays.
  const frieza = compile("[+2][Activate: Main] If your Leader is a green <Frieza> card and you declare 1 number that's 3 or less: Choose up to 1 of your opponent's non-token Battle Cards and increase its energy cost by the declared number for the turn.");
  assert.deepEqual(find(frieza.ops, "declare"), [{ op: "declare", min: 0, max: 3 }], "BT24-059");
  assert.deepEqual(frieza.unsupported, []);
  // The effect says nothing of the number: not a declaration, no op.
  assert.deepEqual(find(compile("[Auto] If you have 3 or more energy and you declare 1 number: When this card is played, until the end of your opponent's turn, your opponent can't play a Battle Card with an original power the same as your declared number unless they place 1 card from their hand at the bottom of their deck.").ops, "declare"), []);
}

// …in a game: the revealed card's cost against the number named.
{
  def("C907-COST3", { energyCost: 3 });
  def("C907-BABA", { energyCost: 0, skill: "[Auto][Limit 1] Declare 1 number: When this card is played from your hand, reveal the top card of your opponent's deck, then flip the revealed card over and place it at the top of their deck. Additionally, if the revealed card's energy cost is the same as the declared number, draw 1 card." });
  const attempt = (declared: number) => {
    let s = stagedG({ hand: ["C907-BABA"] });
    const top = zoneOf(s, "p2", "deck")[0];
    s.cards[top].cardId = "C907-COST3";
    const hand = zoneOf(s, "p1", "hand").length;
    s = playCard(s, "C907-BABA");
    assert.equal(s.prompt.kind, "chooseMode", "the number is asked for");
    const asked = s.prompt as { options: string[] };
    assert.equal(asked.options.length, 11, "0 to 10");
    assert.equal(asked.options[declared], String(declared));
    s = playG(s, { type: "chooseMode", player: "p1", index: declared });
    assert.equal(zoneOf(s, "p2", "deck")[0], top, "the revealed card is still on top of their deck");
    assertConsistentG(s);
    return zoneOf(s, "p1", "hand").length - (hand - 1);
  };
  assert.equal(attempt(3), 1, "declared 3, the card costs 3: the draw happens");
  assert.equal(attempt(4), 0, "declared 4: it does not");
  assert.equal(attempt(0), 0);
}

// …and the raise: BT24-105 names a number from 0 to 3 and its own energy cost goes up by it.
{
  def("C907-RAISER", { energyCost: 2, skill: "[activate: main][once per turn] Declare 1 number that's 3 or less: Increase this card's energy cost by the declared number for the turn." });
  let s = stagedG({ battle: ["C907-RAISER"] });
  const id = findG(s, "p1", "battle", "C907-RAISER");
  assert.equal(playCostG(s, id).total, 2);
  s = pay(playG(s, actsG(s).find((a) => a.type === "activate" && a.card === id) as Action));
  assert.equal(s.prompt.kind, "chooseMode");
  assert.deepEqual((s.prompt as { options: string[] }).options, ["0", "1", "2", "3"], "'3 or less' bounds the declaration");
  s = playG(s, { type: "chooseMode", player: "p1", index: 2 });
  assert.equal(playCostG(s, id).total, 4, "2 plus the declared 2");
  assertConsistentG(s);
}

// ── "reduce the combo cost by 1" ────────────────────────────────────────────
{
  const bt25098 = compile("[Permanent] Reduce the combo cost by 1 and negate the [Energy-Exhaust] skill of multicolor <Pan> cards and multicolor Battle Cards with <GT> in their character names in all of your areas.");
  assert.deepEqual(bt25098.unsupported, [], "BT25-098");
  const reductions = find(bt25098.ops, "costReduction");
  assert.deepEqual(reductions.map((r) => [r.what, r.amount]), [["combo", 1], ["combo", 1]], "one per description");
  assert.equal(find(bt25098.ops, "negateKeyword").length, 2);
  const filters = reductions.map((r) => JSON.stringify((r.target as { sel: { filter?: unknown } }).sel.filter));
  assert.notEqual(filters[0], filters[1], "each description keeps its own filter (no merged <Pan> + <GT>)");
  const bt25103 = compile("[Permanent] If your Leader is a yellow <Gogeta: GT> card, reduce the combo cost by 1 and negate the [Energy-Exhaust] skill of multicolor <Pan> cards and multicolor Battle Cards with <GT> in their character names in all of your areas.");
  assert.deepEqual(bt25103.unsupported, [], "BT25-103");
  const one = compile("[permanent] Reduce the combo cost by 1 and negate the [energy-exhaust] skill on Black/White multicolor ≪Saiyan≫ cards in all of your areas.");
  assert.deepEqual(one.unsupported, [], "BT29-085b");
  assert.deepEqual(find(one.ops, "costReduction").map((r) => r.what), ["combo"]);
  assert.equal(validateProgram(one.ops), true);
}

// …in a game: a multicolor <Pan> card in hand pays 1 less to combo, a mono-colour one does not.
{
  def("C907-PANHOLDER", { energyCost: 0, colors: ["Red", "Blue"], skill: "[Permanent] Reduce the combo cost by 1 and negate the [Energy-Exhaust] skill of multicolor <C907Pan> cards in all of your areas." });
  def("C907-PAN", { colors: ["Red", "Blue"], comboCost: 2, characters: ["C907Pan"] });
  def("C907-PAN1", { colors: ["Red"], comboCost: 2, characters: ["C907Pan"] });
  const without = stagedG({ hand: ["C907-PAN", "C907-PAN1"] });
  assert.equal(comboCostOfG(without, findG(without, "p1", "hand", "C907-PAN")), 2, "no reducer yet");
  const s = stagedG({ battle: ["C907-PANHOLDER"], hand: ["C907-PAN", "C907-PAN1"] });
  assert.equal(comboCostOfG(s, findG(s, "p1", "hand", "C907-PAN")), 1, "the multicolor <Pan> card combos for 1 less");
  assert.equal(comboCostOfG(s, findG(s, "p1", "hand", "C907-PAN1")), 2, "the mono-colour one is not reached");
}

// ── "…and you draw 1 card" ──────────────────────────────────────────────────
{
  for (const text of [
    "[Auto] When this card attacks, this card gets +5000 power for the duration of the turn, and you draw 1 card.",
    "[Activate: Battle] If your Leader Card is <Uub>, it gains +10000 power for the duration of the battle, and you draw 1 card.",
    "[activate: main/battle][limit 1]{1}, if your Leader is a red <Android 13> card and you have 2 or more energy and a red <Android 15> card in your Z-Energy: Your opponent may choose 2 of their Battle Cards and have them get -20000 power for the turn. If they don't, you draw 1 card and play this card from your hand in Rest Mode.",
  ]) {
    const sc = compile(text);
    assert.deepEqual(sc.unsupported, [], text.slice(0, 50));
    assert.equal(find(sc.ops, "draw").length, 1);
  }
}

// ── "you may choose 1 red card and 1 green card in your Drop Area and send them to your Warp" ──
{
  const db2 = compile("[permanent] When placing this card in your energy from any area, you may choose 1 red card and 1 green card in your Drop Area and send them to your Warp. If you do, negate this card's [energy-exhaust] skill.");
  assert.deepEqual(db2.unsupported, [], "DB2-166 and its five siblings read");
  const [offer] = find(db2.ops, "may");
  assert.deepEqual(find(offer.ops, "choose").map((x) => [x.sel.area, x.sel.count, !!x.sel.notIn]), [["drop", 1, false], ["drop", 1, true]], "each from the Drop, a card of its own");
  assert.equal(find(db2.ops, "negateKeyword").length, 1, "'if you do' follows the offer");
  assert.equal(validateProgram(db2.ops), true);

  def("C907-RED", { colors: ["Red"] });
  def("C907-GREEN", { colors: ["Green"] });
  def("C907-RG", { colors: ["Red", "Green"] });
  def("C907-OFFER", { energyCost: 0, skill: "[Auto] When this card is played, you may choose 1 red card and 1 green card in your Drop Area and send them to your Warp. If you do, draw 1 card." });
  const attempt = (inDrop: string[]) => {
    let s = stagedG({ hand: ["C907-OFFER", ...inDrop] });
    for (const id of inDrop) moveG(s, findG(s, "p1", "hand", id), "drop", "p1");
    const hand = zoneOf(s, "p1", "hand").length;
    s = playCard(s, "C907-OFFER");
    let asked = 0;
    for (let i = 0; i < 8 && (s.prompt.kind === "chooseMode" || s.prompt.kind === "chooseCards"); i++) {
      asked++;
      s = s.prompt.kind === "chooseMode" ? playG(s, { type: "chooseMode", player: "p1", index: 0 }) : playG(s, { type: "choose", player: "p1", cards: [s.prompt.choice.candidates[0]] });
    }
    assertConsistentG(s);
    return { warp: zoneOf(s, "p1", "warp").length, drawn: zoneOf(s, "p1", "hand").length - (hand - 1), asked };
  };
  const both = attempt(["C907-RED", "C907-GREEN"]);
  assert.deepEqual([both.warp, both.drawn], [2, 1], "a red and a green card: both go to the Warp, and 'if you do' draws");
  const one = attempt(["C907-RED"]);
  assert.deepEqual([one.warp, one.drawn, one.asked], [0, 0, 0], "only a red card: the pair is both or neither, and the offer is not even made");
  const shared = attempt(["C907-RG"]);
  assert.deepEqual([shared.warp, shared.drawn], [0, 0], "one red-and-green card cannot be both halves of the pair");
  const shared2 = attempt(["C907-RG", "C907-GREEN"]);
  assert.deepEqual([shared2.warp, shared2.drawn], [2, 1], "a red-green card and a green one can: each half has a card of its own");
}

console.log("census-effects-907: remainders, win the game, declare, combo cost, 'you draw' passed");
