/**
 * #907, the leftovers #1021 and #1023 named:
 *
 *  - the opponent's own choices that were not "chooses N and places them": "…chooses 5 cards in
 *    their hand and **adds the rest** to their Z-Energy" (BT20-148), "…chooses 6 cards in their
 *    hand, **discards the rest**" (BT12-059), "they choose 3 cards in their hand and place the rest
 *    at the bottom of their deck" (BT12-038); "…places them in their Drop Area **until they have 12
 *    cards** in hand" (BT7-105, SD7-03); "**all of the cards** in their hand" (BT6-125); and the
 *    count that is a board reading (BT2-046, BT7-052), which is left unread rather than read as a
 *    choice of the wrong cards.
 *  - "The Battle Card **played** is played in Rest Mode" (BT1-110), "…has its skill negated"
 *    (BT1-107), "…in Rest Mode with its skills negated" (DB2-128, EB1-46, XD1-10), the same said
 *    in two halves (BT10-121).
 *  - "play 1 Frieza's Army Token **with 10000 power**" (BT28-020, BT31-134, EB1-48, and a dozen
 *    more): the power printed on the skill is the token's, not 5000.
 *
 * Rules engine only; nothing reads the database. Wordings are the catalog's deckplanet text of
 * 18 Oct 2026, with the trigger shortened where it is not the point.
 */
import assert from "node:assert/strict";
import { DEFS, actsG, assertConsistentG, card, compileSkill, findG, parseSkills, playG, stagedG, zoneOf } from "./harness";
import type { Action } from "./harness";
import { validateProgram, type Op } from "../../src/lib/arena/vm/script";

const compile = (text: string) => compileSkill(parseSkills(text)[0]);
const TEMP: string[] = [];
const def = (id: string, o: Parameters<typeof card>[1] & { skill?: string }) => {
  DEFS[id] = { ...card(id, o), ...o, id, name: id } as (typeof DEFS)[string];
  TEMP.push(id);
};
function find<T extends Op["op"]>(node: unknown, kind: T, out: Extract<Op, { op: T }>[] = []): Extract<Op, { op: T }>[] {
  if (Array.isArray(node)) for (const x of node) find(x, kind, out);
  else if (node && typeof node === "object") {
    if ((node as { op?: string }).op === kind) out.push(node as Extract<Op, { op: T }>);
    for (const v of Object.values(node)) find(v, kind, out);
  }
  return out;
}

// ── token power ──────────────────────────────────────────────────────────────
{
  const power = (text: string) => find(compile(text).ops, "token").map((t) => t.power);
  assert.deepEqual(power("[Auto] When this card is played, play 2 Ghost Tokens with 15000 power, and they gain [Blocker] and [Revenge] for the turn."), [15000], "BT31-134");
  assert.deepEqual(power("[Auto][Limit 1] When this card or your opponent's Battle Card is played, play 1 Frieza's Army Token with 10000 power, and it gains [Barrier] and [Blocker] until the end of your opponent's turn."), [10000], "BT28-020");
  assert.deepEqual(power("[Counter: Attack] If your Leader Card is mono-yellow: Negate the attack, then play 1 Frieza's Army Token with 10000 power and it gains [Blocker] for the turn."), [10000], "EB1-48");
  assert.deepEqual(power("[Auto] When this card is KO'd, play 1 Chilled's Army Token with 10000 power."), [10000], "a token that never named its power elsewhere");
  // A token with no printed power keeps the long-standing 5000.
  assert.deepEqual(power("[Auto] When this card is played, play 1 Ghost Token."), [5000]);
  // The tokens a later clause refers to are still named.
  const bt31134 = compile("[Auto] When this card is played, play 2 Ghost Tokens with 15000 power, and they gain [Blocker] and [Revenge] for the turn.");
  assert.ok(find(bt31134.ops, "token")[0].as, "the tokens are bound for 'they gain'");
}

// ── [Counter: Play] about "the Battle Card played" ───────────────────────────
{
  assert.deepEqual(compile("[Counter: Play] The Battle Card played is played in Rest Mode.").ops, [{ op: "resolvingPlay", mode: "rest" }], "BT1-110");
  const bt1107 = compile("[Counter: Play] If your Leader Card is ≪Frieza's Army≫, the Battle Card played has its skill negated for the duration of the turn.");
  assert.deepEqual(bt1107.unsupported, []);
  assert.deepEqual(find(bt1107.ops, "resolvingPlay"), [{ op: "resolvingPlay", negated: true }], "BT1-107");
  const db2128 = compile("[Counter: Play] If your Leader Card has ≪Universe≫ in its special trait: If the Battle Card being played has an energy cost of 4 or less, it's played in Rest Mode with its skills negated for the turn.");
  assert.deepEqual(find(db2128.ops, "resolvingPlay"), [{ op: "resolvingPlay", mode: "rest", negated: true }], "DB2-128: both, in one op");
  const bt10121 = compile("[Counter: Play] If you have a yellow Unison Card in play: If the Battle Card being played has an energy cost of 4 or less, it has its skills negated for the turn and is played in Rest Mode.");
  assert.deepEqual(find(bt10121.ops, "resolvingPlay"), [{ op: "resolvingPlay", mode: "rest", negated: true }], "BT10-121: said in two halves, read as one");
  assert.deepEqual(bt10121.unsupported, []);
  const xd110 = compile("[Counter: Play] The Battle Card your opponent is playing is played in Rest Mode with its skills negated for the duration of the turn, then draw 1 card.");
  assert.deepEqual(find(xd110.ops, "resolvingPlay"), [{ op: "resolvingPlay", mode: "rest", negated: true }], "XD1-10");
}

// …in a game: BT1-110 answers a play, and the card arrives rested; BT1-107 negates what it says.
{
  def("LO-REST", { type: "EXTRA", colors: ["Blue"], energyCost: 0, comboCost: null, comboPower: null, skill: "[Counter: Play] The Battle Card played is played in Rest Mode." });
  def("LO-NEG", { type: "EXTRA", colors: ["Blue"], energyCost: 0, comboCost: null, comboPower: null, skill: "[Counter: Play] The Battle Card played has its skill negated for the duration of the turn." });
  def("LO-BODY", { energyCost: 1, colors: ["Red"], power: 30000, skill: "[Permanent] This card gets +5000 power." });
  for (const id of ["LO-REST", "LO-NEG"]) {
    let s = stagedG({ hand: ["LO-BODY"], energy: ["V1"], oppHand: [id], oppEnergy: ["V-BLUE"] });
    const played = findG(s, "p1", "hand", "LO-BODY");
    s = playG(s, { type: "play", player: "p1", card: played });
    if (s.prompt.kind === "payCost") s = playG(s, { type: "payCost", player: "p1", option: 0 });
    assert.equal(s.prompt.kind, "counter", `${id}: the opponent may answer`);
    s = playG(s, { type: "counter", player: "p2", card: findG(s, "p2", "hand", id), skill: 0 } as Action);
    for (let i = 0; i < 10 && s.prompt.kind !== "main"; i++) s = playG(s, actsG(s).find((x) => x.type === "pass") ?? actsG(s)[0]);
    assert.ok(zoneOf(s, "p1", "battle").includes(played), `${id}: it was played`);
    if (id === "LO-REST") assert.equal(s.cards[played].mode, "rest", "played in Rest Mode");
    else assert.equal(s.cards[played].mode, "active", "the negation does not rest it");
    assertConsistentG(s);
  }
}

// ── the rest of the hand ─────────────────────────────────────────────────────
{
  const bt12059 = compile("[Auto][Once per turn] When your opponent activates a [Counter: Attack] skill, your opponent chooses 6 cards in their hand, discards the rest, then you and your opponent draw 1 card.");
  assert.deepEqual(bt12059.unsupported, []);
  const picks = find(bt12059.ops, "choose");
  assert.deepEqual(picks.map((p) => [p.chooser, p.sel.count, p.sel.upTo ?? false, p.sel.notIn ? true : false]), [["opponent", 6, false, false], [undefined, 99, true, true]], "they keep 6; everything else is the second choice");
  assert.deepEqual(picks[1].sel.notIn, [picks[0].as]);
  assert.deepEqual(find(bt12059.ops, "moveTo").map((m) => [m.to, (m.target as { var: string }).var]), [["drop", picks[1].as]], "the rest, not the six, go to the Drop");
  assert.equal(validateProgram(bt12059.ops), true);

  const bt20148 = compile("[auto] When this card is played, choose all of your opponent's Battle Cards, ignoring [barrier], send them to their owners' Warps, then your opponent chooses 5 cards in their hand and adds the rest to their Z-Energy, and this card gains [barrier] for the turn.");
  assert.deepEqual(bt20148.unsupported, []);
  assert.deepEqual(find(bt20148.ops, "moveTo").map((m) => m.to), ["warp", "zEnergy"]);
  assert.equal(find(bt20148.ops, "gains").length, 1, "and the sentence goes on after it");
  assert.equal(validateProgram(bt20148.ops), true);

  const bt12038 = compile("[auto] If your Leader Card is mono-blue and you have 6 or fewer cards in your hand: At the end of your opponent's turn, they choose 3 cards in their hand and place the rest at the bottom of their deck in any order.");
  assert.deepEqual(bt12038.unsupported, []);
  const [, rest] = find(bt12038.ops, "moveTo").concat(find(bt12038.ops, "moveTo"));
  assert.deepEqual([rest.to, rest.position], ["deck", "bottom"]);

  // A kept count the compiler cannot take as a number is not read.
  assert.deepEqual(compile("[Auto] When this card is played, your opponent chooses up to 2 cards in their hand and adds the rest to their Z-Energy.").ops, []);
}

// …in a game: BT20-148's Z-Energy half. The opponent chooses what they keep; the rest goes to their Z-Energy.
{
  def("LO-F", {});
  def("LO-KEEP", { skill: "[Auto] When this card is played, your opponent chooses 2 cards in their hand and adds the rest to their Z-Energy.", energyCost: 0 });
  let s = stagedG({ hand: ["LO-KEEP"], oppHand: ["LO-F", "LO-F", "LO-F", "LO-F"] });
  const z = zoneOf(s, "p2", "zEnergy").length;
  s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "LO-KEEP") });
  if (s.prompt.kind === "payCost") s = playG(s, { type: "payCost", player: "p1", option: 0 });
  const kept: string[] = [];
  while (s.prompt.kind === "chooseCards") {
    assert.equal(s.prompt.player, "p2", "every question is the opponent's");
    const one = s.prompt.choice.candidates[0];
    kept.push(one);
    s = playG(s, { type: "choose", player: "p2", cards: [one] });
  }
  assert.equal(kept.length, 2, "two asked: the cards they keep");
  assert.deepEqual(zoneOf(s, "p2", "hand").sort(), [...kept].sort(), "exactly the kept cards stay in hand");
  assert.equal(zoneOf(s, "p2", "zEnergy").length, z + 2, "the other two went to their Z-Energy");
  assertConsistentG(s);
}

// ── "until they have N cards in hand" ────────────────────────────────────────
{
  const bt7105 = compile("[Auto] When you play this card, you may choose 1 card in your life and add it to your hand. If you do, your opponent chooses cards in their hand and places them in their Drop Area until they have 12 cards in hand.");
  const [guard] = find(bt7105.ops, "if").filter((o) => find(o.then, "discard").length);
  assert.deepEqual(guard.cond, { kind: "count", sel: { side: "opponent", area: "hand" }, atLeast: 13 }, "only when they hold more than 12");
  const [d] = find(guard.then, "discard");
  assert.deepEqual([d.side, d.to ?? "drop", d.n], ["opponent", "drop", { plus: [{ count: { side: "opponent", area: "hand" } }, -12] }], "the excess over 12");
  const sd703 = compile("[Auto] When you play this card, if your opponent has 11 or more cards in hand, your opponent chooses cards from their hand and sends them to their Warp until they have 10 cards in hand.");
  assert.deepEqual(sd703.unsupported, []);
  assert.equal(find(sd703.ops, "discard")[0].to, "warp");
  // Shuffled into the deck (BT9-108) would need a count a choice cannot take: unread.
  const bt9108 = compile("[Activate: Main] Draw 2 cards; if your opponent has 11 or more cards in their hand, they choose cards in their hand and shuffle them into their deck until they have 10 cards in their hand.");
  assert.equal(find(bt9108.ops, "discard").length, 0);
  assert.ok(bt9108.unsupported.length > 0);

  for (const [hand, gives] of [[5, 2], [3, 0]] as const) {
    def("LO-U", { skill: "[Auto] When this card is played, your opponent chooses cards in their hand and places them in their Drop Area until they have 3 cards in hand.", energyCost: 0 });
    let s = stagedG({ hand: ["LO-U"], oppHand: Array(hand).fill("LO-F") });
    s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "LO-U") });
    if (s.prompt.kind === "payCost") s = playG(s, { type: "payCost", player: "p1", option: 0 });
    let asked = 0;
    while (s.prompt.kind === "chooseCards") {
      assert.equal(s.prompt.player, "p2");
      asked++;
      s = playG(s, { type: "choose", player: "p2", cards: [s.prompt.choice.candidates[0]] });
    }
    assert.equal(asked, gives, `a hand of ${hand}: ${gives} given up`);
    assert.equal(zoneOf(s, "p2", "hand").length, Math.min(hand, 3), "and no more than down to 3");
    assertConsistentG(s);
  }
}

// ── all of the cards, and a count that is a board reading ────────────────────
{
  const bt6125 = compile("[Auto] When this card attacks, if your life is at 1, your opponent chooses all of the cards in their hand and places them in their Drop Area.");
  assert.deepEqual(bt6125.unsupported, []);
  const [pick] = find(bt6125.ops, "choose");
  assert.deepEqual([pick.sel.count, pick.sel.upTo, pick.chooser], [99, true, "opponent"]);
  assert.deepEqual(find(bt6125.ops, "moveTo").map((m) => m.to), ["drop"]);
  const gate = find(bt6125.ops, "if")[0];
  assert.deepEqual(gate.cond, { kind: "life", side: "you", atLeast: 1, atMost: 1 });

  const bt2046 = compile("[Auto] When you play this card, your opponent chooses a number of cards from their hand equal to the number of Battle Cards in their Battle Area with an energy cost of 1 or less and places the cards on the top of their decks in any order.");
  assert.deepEqual(bt2046.ops, [], "no choice of the wrong cards");
  assert.ok(bt2046.unsupported.length > 0);
  const bt7052 = compile("[Auto] When you play this card, choose up to 2 of your opponent's Battle Cards with energy costs of 3 or less, KO them, then your opponent chooses cards from their hand equal to the number of cards you KO'd with this skill and sends them to their Warp.");
  assert.deepEqual(find(bt7052.ops, "moveTo"), [], "it used to send the opponent's whole hand to the Warp");
  assert.ok(bt7052.unsupported.length > 0);
}

for (const id of TEMP) delete DEFS[id];
