/**
 * Hidden Mode (1-10-2, 23-5), the mechanic BT28 is built on.
 *
 * The compiler half runs on both engines; the board half on the rules engine
 * only — the legacy engine is on its way out (#118) and is not taught these
 * rules. Every card defined here is taken out of DEFS again at the end, so
 * the probe sweep (`verify/probe.ts`, every DEFS card) is unchanged by them.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { DEFS, ENGINE, actsG, arenaG, assertConsistentG, compileSkill, describeScript, findG, koCardG, labelsG, leaderOf, parseSkills, playG, powerOfG, zoneOf } from "./harness";
import type { Action, EngineState, PlayerId } from "./harness";

const one = (text: string) => compileSkill(parseSkills(text)[0]);
const reads = (text: string) => describeScript(one(text).ops);
const act = (s: EngineState, card: string) => actsG(s).find((a) => a.type === "activate" && a.card === card) as Action | undefined;
const choose = (s: EngineState, player: PlayerId, cards: string[]) => (s.prompt.kind === "chooseCards" ? playG(s, { type: "choose", player, cards }) : s);
const handOf = (s: EngineState, p: PlayerId) => zoneOf(s, p, "hand").length;

const TEMP: string[] = [];
const def = (id: string, o: Partial<(typeof DEFS)[string]>) => {
  DEFS[id] = { ...DEFS.V1, ...o, id, name: id };
  TEMP.push(id);
};

// ── the compiler ────────────────────────────────────────────────────────────
{
  // 11-1-2 with 23-5-2: "Battle Cards" is a description in the Battle Area,
  // because a face-down card there has no card type; "cards" is not.
  assert.equal(reads("[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and KO it."), "choose up to 1 Battle Card in your opponent's Battle Area, KO the chosen cards");
  assert.match(reads("[Activate: Main] Choose all the cards in your opponent's Battle Area and switch them to Revealed Mode."), /^choose all cards in your opponent's Battle Area in Hidden Mode, switch the chosen cards to Revealed Mode$/);
  // "Battle Cards or Unisons" keeps both kinds.
  const both = one("[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards or Unisons and KO it.").ops[0] as { sel: { filter?: unknown; areas?: string[] } };
  assert.deepEqual([both.sel.filter, both.sel.areas], [undefined, ["battle", "unison"]], "the type word narrows neither area of a pair");

  // 5-8-2-2: a choice that is then switched is narrowed to what the switch can act on.
  const reveal = one("[Activate: Main] Choose 1 card in your Battle Area and switch it to Revealed Mode: Draw 1 card.");
  assert.deepEqual(reveal.unsupported, []);
  // The first switch decides: BT28-113 hides, then reveals at the end of the turn.
  const hideThenReveal = one("[Auto] When this card is played, choose up to 1 card in your opponent's Battle Area, switch it to Hidden Mode, then switch it to Revealed Mode at the end of the turn.");
  assert.equal((hideThenReveal.ops[0] as { sel: { hidden?: boolean } }).sel.hidden, false, "chosen for the hiding, among the cards face up");

  // The triggers.
  assert.equal(reads("[Auto] When this card in a Battle Area is switched to Hidden Mode by one of your skills, draw 1 card."), "draw 1");

  // BT28-121, -105, -150, -136.
  const back = one("[Counter: Play] Choose 1 of your white Battle Cards and switch it to Hidden Mode: Play this card, then switch the card that was switched to Hidden Mode by this skill to Revealed Mode at the end of the turn.");
  assert.deepEqual(back.unsupported, []);
  const delayed = back.ops.find((o) => o.op === "delay") as { ops: { target: { var: string } }[] };
  assert.deepEqual(delayed.ops[0].target, { var: "c0" }, "the price's card, which the effect's own choices do not overwrite");
  assert.ok(!JSON.stringify(back.ops.filter((o) => o.op !== "delay")).includes('"c0"'), "the effect's own names start past the price's");
  assert.deepEqual(one("[Activate: Main] Choose 1 of your white Battle Cards and switch it to Hidden Mode: Increase this card's power by the original power on the front of the card that was switched to Hidden Mode by this skill for the turn.").unsupported, []);
  assert.deepEqual(one("[Auto] When this card attacks, choose up to 1 non-Extra card in your Battle Area and switch it to Revealed Mode or Hidden Mode.").unsupported, []);
  assert.equal(reads("[Auto] When your opponent activates a [Counter] skill, your opponent adds 2 cards from their hand to their energy in Hidden Mode."), "choose 2 cards in your opponent's hand, move the chosen cards to energy, switch the chosen cards to Hidden Mode");

  // BT28-105b: a Leader or a described Battle Card, picked as a kind first.
  const either = one("[Activate: Main] Choose 1 of your white Battle Cards and switch it to Hidden Mode: Choose up to 1 of your Leaders or up to 1 of your white ≪Universe 7≫ Battle Cards and increase that card's power by the original power on the front of the card that was switched to Hidden Mode by this skill for the turn.");
  assert.deepEqual(either.unsupported, []);
  assert.deepEqual(either.ops.map((o) => o.op), ["chooseMode", "power"]);
  // A Hidden Mode card with no area named is one wherever a card has that position (1-10-2).
  const anywhere = one("[Permanent] If you have a Hidden Mode card, reduce the energy cost of this card in your hand by 2.");
  assert.deepEqual(anywhere.unsupported, []);
  assert.match(JSON.stringify(anywhere.ops), /"areas":\["battle","energy","unison"\],"hidden":true/);
  // BT30-112: "up to 1 of your energy … to Revealed Mode or Hidden Mode" chooses, then switches it to the other.
  const energyToggle = one("[Auto] When this card is played, switch up to 1 of your energy to Revealed Mode or Hidden Mode.");
  assert.deepEqual(energyToggle.ops.map((o) => o.op), ["choose", "if"]);
  assert.equal((energyToggle.ops[0] as { sel: { hidden?: boolean } }).sel.hidden, undefined, "either mode may be chosen");
  // BT31-148.
  assert.deepEqual(one("[Auto] When your opponent's card is played, switch this card to Revealed Mode with 1 marker on it.").ops.map((o) => o.op), ["hidden", "addMarker"]);
}

if (ENGINE !== "rules") {
  console.log("  hidden: the board half runs on the rules engine only");
} else {
  def("HM-HIDER", { energyCost: 1, skill: "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and switch it to Hidden Mode." });
  def("HM-KOER", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and KO it." });
  def("HM-WHITE", { colors: ["White"], power: 25000 });

  // ── 23-5-2: face down, a card is not a Battle Card ──────────────────────
  {
    let s = arenaG({ hand: ["HM-HIDER", "HM-KOER"], energy: ["V1", "V1"], oppBattle: ["V-BLUE"], battle: ["V1"] });
    const theirs = zoneOf(s, "p2", "battle")[0];
    s = choose(playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "HM-HIDER") }), "p1", [theirs]);
    assert.equal(s.cards[theirs].hidden, true);
    s.cards[theirs].mode = "rest";
    assert.ok(!labelsG(s).some((l) => l.startsWith("Attack") && l.includes("vs 0")), "8-1-1: a face-down card is not attacked, and its name is not shown");
    s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "HM-KOER") });
    assert.ok(zoneOf(s, "p2", "battle").includes(theirs), "a KO of a Battle Card does not reach a face-down card");
    assertConsistentG(s);

    // And it does not attack.
    const t = arenaG({ battle: ["V1"] });
    const mine = zoneOf(t, "p1", "battle")[0];
    t.cards[mine].hidden = true;
    assert.ok(!actsG(t).some((a) => a.type === "attack" && a.attacker === mine), "a face-down card cannot attack");
  }

  // ── 23-5-4: hidden mid-battle, an attack card leaves the battle ─────────
  {
    def("HM-COUNTERHIDE", { ...DEFS["E-NEGATE"], skill: "[Counter: Attack] Choose up to 1 of your opponent's Battle Cards and switch it to Hidden Mode." });
    let s = arenaG({ battle: ["V1"], oppHand: ["HM-COUNTERHIDE"], oppEnergy: ["V1"] });
    const attacker = zoneOf(s, "p1", "battle")[0];
    const life = zoneOf(s, "p2", "life").length;
    s = playG(s, { type: "attack", player: "p1", attacker, target: leaderOf(s, "p2") });
    assert.equal(s.prompt.kind, "counter");
    s = choose(playG(s, { type: "counter", player: "p2", card: findG(s, "p2", "hand", "HM-COUNTERHIDE"), skill: 0 }), "p2", [attacker]);
    assert.equal(s.cards[attacker].hidden, true);
    for (let i = 0; i < 20 && s.prompt.kind !== "main"; i++) s = playG(s, actsG(s).find((a) => a.type === "pass" || (a.type === "counter" && !a.card) || (a.type === "block" && !a.card)) ?? actsG(s)[0]);
    assert.equal(zoneOf(s, "p2", "life").length, life, "23-5-4, 8-1-7: the battle ended with no damage dealt");
    assertConsistentG(s);
  }

  // ── prices that switch a card (5-8-2-2) ─────────────────────────────────
  {
    def("HM-GOKU", { colors: ["White"], power: 10000, skill: "[Activate: Main][Once per turn] Choose 1 of your white Battle Cards and switch it to Hidden Mode: Increase this card's power by the original power on the front of the card that was switched to Hidden Mode by this skill for the turn." });
    def("HM-REV", { skill: "[Activate: Main] Choose 1 card in your Battle Area and switch it to Revealed Mode: Draw 1 card." });
    let s = arenaG({ battle: ["HM-GOKU", "HM-WHITE", "HM-REV"] });
    const goku = findG(s, "p1", "battle", "HM-GOKU");
    const white = findG(s, "p1", "battle", "HM-WHITE");
    const rev = findG(s, "p1", "battle", "HM-REV");
    assert.equal(act(s, rev), undefined, "nothing face down, nothing to reveal: the line is not offered");
    s = choose(playG(s, act(s, goku)!), "p1", [white]);
    assert.equal(s.cards[white].hidden, true, "the price was paid");
    assert.equal(powerOfG(s, goku), 35000, "23-5-2-4: the front's original power, read although face down");
    const hand = handOf(s, "p1");
    s = choose(playG(s, act(s, rev)!), "p1", [white]);
    assert.equal(s.cards[white].hidden, false);
    assert.equal(handOf(s, "p1"), hand + 1);
    assertConsistentG(s);
  }

  // ── a [Counter] whose price is an action (BT28-121) ─────────────────────
  {
    def("HM-SEVENTEEN", { ...DEFS["E-NEGATE"], skill: "[Counter: Play][Limit 1] Choose 1 of your white Battle Cards and switch it to Hidden Mode: Draw 1 card, then switch the card that was switched to Hidden Mode by this skill to Revealed Mode at the end of the turn." });
    let s = arenaG({ hand: ["V1"], energy: ["V1", "V1"], oppHand: ["HM-SEVENTEEN"], oppEnergy: ["V1"], oppBattle: ["HM-WHITE"] });
    const white = findG(s, "p2", "battle", "HM-WHITE");
    s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "V1") });
    assert.equal(s.prompt.kind, "counter", "offered while a white Battle Card can be switched");
    const hand = handOf(s, "p2");
    s = choose(playG(s, { type: "counter", player: "p2", card: findG(s, "p2", "hand", "HM-SEVENTEEN"), skill: 0 }), "p2", [white]);
    assert.equal(s.cards[white].hidden, true);
    assert.equal(handOf(s, "p2"), hand, "the counter left the hand and its draw came back");
    s = playG(s, { type: "endMain", player: "p1" });
    assert.equal(s.cards[white].hidden, false, "revealed at the end of the turn: the price's card");
    assertConsistentG(s);
  }

  // ── the triggers, and 9-6-9-3 ───────────────────────────────────────────
  {
    def("HM-SHY", { colors: ["White"], skill: "[Auto] When this card in a Battle Area is switched to Hidden Mode by one of your skills, draw 1 card." });
    def("HM-HIDEME", { colors: ["White"], skill: "[Activate: Main] Choose up to 1 white card in your Battle Area and switch it to Hidden Mode." });
    def("HM-GONE", { colors: ["White"], skill: "[Auto] When this Hidden Mode card in a Battle Area is placed into its owner's Drop, draw 2 cards.<br>[Auto] When this card is KO'd, draw 1 card." });
    def("HM-SAC", { skill: "[Activate: Main] Choose 1 Hidden Mode card in your Battle Area and place it into its owner's Drop: Draw 1 card." });
    let s = arenaG({ battle: ["HM-SHY", "HM-HIDEME", "HM-GONE", "HM-SAC"] });
    const shy = findG(s, "p1", "battle", "HM-SHY");
    const gone = findG(s, "p1", "battle", "HM-GONE");
    let hand = handOf(s, "p1");
    s = choose(playG(s, act(s, findG(s, "p1", "battle", "HM-HIDEME"))!), "p1", [shy]);
    assert.equal(handOf(s, "p1"), hand + 1, "23-5-2-4: the front side answers the switch");
    s.cards[gone].hidden = true;
    hand = handOf(s, "p1");
    s = choose(playG(s, act(s, findG(s, "p1", "battle", "HM-SAC"))!), "p1", [gone]);
    assert.ok(zoneOf(s, "p1", "drop").includes(gone));
    assert.equal(handOf(s, "p1"), hand + 1 + 2, "the price's draw, and the Hidden Mode card's own");
    assertConsistentG(s);

    // KO'd face down: "when this card is KO'd" stays silent (9-6-9-3).
    const t = arenaG({ battle: ["HM-GONE"] });
    const g = findG(t, "p1", "battle", "HM-GONE");
    t.cards[g].hidden = true;
    koCardG(t, g);
    assert.deepEqual(
      (t as { pending: { trigger: string }[] }).pending.map((p) => p.trigger),
      ["hiddenToDrop"],
      "only the moment that names Hidden Mode",
    );
  }

  // ── BT28-150 and BT28-136 ───────────────────────────────────────────────
  {
    def("HM-TOGGLE", { skill: "[Activate: Main] Choose up to 1 non-Extra card in your Battle Area and switch it to Revealed Mode or Hidden Mode." });
    let s = arenaG({ battle: ["HM-TOGGLE", "HM-WHITE"] });
    const white = findG(s, "p1", "battle", "HM-WHITE");
    s = choose(playG(s, act(s, findG(s, "p1", "battle", "HM-TOGGLE"))!), "p1", [white]);
    assert.equal(s.cards[white].hidden, true, "face up, so it goes face down");
    s = choose(playG(s, act(s, findG(s, "p1", "battle", "HM-TOGGLE"))!), "p1", [white]);
    assert.equal(s.cards[white].hidden, false, "face down is still a non-Extra card, and it comes back up");


    // 23-5-2: energy face down has no colour, so it cannot pay a {w}.
    def("HM-WCOST", { colors: ["White"], skill: "[Activate: Main]{w}: Draw 1 card." });
    const t = arenaG({ battle: ["HM-WCOST"], energy: ["HM-WHITE"] });
    const energy = findG(t, "p1", "energy", "HM-WHITE");
    const line = findG(t, "p1", "battle", "HM-WCOST");
    assert.ok(act(t, line), "a white energy pays {w}");
    t.cards[energy].hidden = true;
    assert.equal(act(t, line), undefined, "face down, it has no colour to pay it with");
  }

  // ── BT28-105b: "your Leaders or … Battle Cards", the front's original power ─
  {
    def("HM-GOKU-B", { colors: ["White"], skill: "[Activate: Main][Once per turn] Choose 1 of your white Battle Cards and switch it to Hidden Mode: Choose up to 1 of your Leaders or up to 1 of your white ≪Universe 7≫ Battle Cards and increase that card's power by the original power on the front of the card that was switched to Hidden Mode by this skill for the turn." });
    let s = arenaG({ battle: ["HM-GOKU-B", "HM-WHITE"] });
    const line = findG(s, "p1", "battle", "HM-GOKU-B");
    const fuel = findG(s, "p1", "battle", "HM-WHITE");
    const leader = leaderOf(s, "p1");
    const before = powerOfG(s, leader);
    s = choose(playG(s, act(s, line)!), "p1", [fuel]);
    assert.equal(s.prompt.kind, "chooseMode", "a Leader or a Battle Card: the kind first (20-2)");
    s = playG(s, { type: "chooseMode", player: "p1", index: 0 } as Action);
    s = choose(s, "p1", [leader]);
    assert.equal(powerOfG(s, leader), before + 25000, "the Leader gets the face-down card's front power");
    assertConsistentG(s);
  }

  // ── BT28-106: Hidden Mode cards as energy, for one kind of skill cost ───
  {
    def("HM-BELMOD", { ...DEFS["L-RED"], colors: ["White"], back: undefined, skill: "[Permanent] When paying the skill cost of skills on white ≪God≫ cards in any of your areas, once per turn you can use 1 Hidden Mode card in your Battle Area as energy." });
    def("HM-GOD", { colors: ["White"], traits: ["God"], skill: "[Activate: Main]{2}: Draw 1 card." });
    def("HM-MORTAL", { colors: ["White"], skill: "[Activate: Main]{2}: Draw 1 card." });
    let s = arenaG({ battle: ["HM-GOD", "HM-MORTAL", "HM-WHITE", "HM-WHITE"], energy: ["V1"] });
    const leader = leaderOf(s, "p1");
    s.cards[leader].cardId = "HM-BELMOD";
    const god = findG(s, "p1", "battle", "HM-GOD");
    const mortal = findG(s, "p1", "battle", "HM-MORTAL");
    const [w1, w2] = zoneOf(s, "p1", "battle").filter((id) => s.cards[id].cardId === "HM-WHITE");
    assert.equal(act(s, god), undefined, "one energy and nothing face down: {2} is not there");
    s.cards[w1].hidden = true;
    s.cards[w2].hidden = true;
    assert.ok(act(s, god), "a Hidden Mode card stands in for the second energy");
    assert.equal(act(s, mortal), undefined, "only for the skill costs of white ≪God≫ cards");
    s = playG(s, act(s, god)!);
    if (s.prompt.kind === "payCost") s = playG(s, { ...(s.prompt.action as Action), pay: s.prompt.options[0].rest } as Action);
    assert.deepEqual([w1, w2].map((id) => s.cards[id].mode).sort(), ["active", "rest"], "at most 1 of them, rested where it stands");
    s.cards[zoneOf(s, "p1", "energy")[0]].mode = "active";
    assert.equal(act(s, god), undefined, "once per turn: the second Hidden Mode card does not pay again");
    assertConsistentG(s);
  }

  // ── BT28-124, BT28-138: a [Counter] paid with a Hidden Mode card ────────
  {
    def("HM-BEERUS", { energyCost: 5, skill: "[Counter: Play][Limit 1] Play this card.<br>[Permanent] If your opponent has 1 or more energy, you can activate this card's [Counter] skill from your hand by choosing 1 Hidden Mode card in your Battle Area and placing it into its owner's Drop instead of paying its energy cost." });
    let s = arenaG({ hand: ["V1"], energy: ["V1", "V1"], oppHand: ["HM-BEERUS"], oppBattle: ["HM-WHITE"] });
    s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "V1") });
    assert.notEqual(s.prompt.kind, "counter", "nothing face down: five energy it does not have, and no other way to pay");
    s = arenaG({ hand: ["V1"], energy: ["V1", "V1"], oppHand: ["HM-BEERUS"], oppBattle: ["HM-WHITE"] });
    const down = findG(s, "p2", "battle", "HM-WHITE");
    s.cards[down].hidden = true;
    s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "V1") });
    assert.equal(s.prompt.kind, "counter");
    s = choose(playG(s, actsG(s).find((a) => a.type === "counter" && (a as { alt?: boolean }).alt)!), "p2", [down]);
    assert.ok(zoneOf(s, "p2", "drop").includes(down), "the Hidden Mode card paid for it");
    assert.ok(zoneOf(s, "p2", "battle").some((id) => s.cards[id].cardId === "HM-BEERUS"), "and the counter played the card");
    assertConsistentG(s);

    def("HM-STOP", { ...DEFS["E-NEGATE"], energyCost: 5, skill: "[Counter: Attack] Negate the attack.<br>[Permanent] You can activate this card's [Counter] skill from your hand by switching 1 Hidden Mode card in your Battle Area to Rest Mode instead of paying its energy cost." });
    let t = arenaG({ battle: ["V1"], oppHand: ["HM-STOP"], oppBattle: ["HM-WHITE"] });
    const one = findG(t, "p2", "battle", "HM-WHITE");
    t.cards[one].hidden = true;
    t.cards[one].mode = "rest";
    const attacker = zoneOf(t, "p1", "battle")[0];
    t = playG(t, { type: "attack", player: "p1", attacker, target: leaderOf(t, "p2") });
    assert.ok(!actsG(t).some((a) => a.type === "counter" && (a as { alt?: boolean }).alt), "5-8-2-2: a rested Hidden Mode card cannot be switched to Rest Mode to pay");
    t = arenaG({ battle: ["V1"], oppHand: ["HM-STOP"], oppBattle: ["HM-WHITE"] });
    const two = findG(t, "p2", "battle", "HM-WHITE");
    t.cards[two].hidden = true;
    t = playG(t, { type: "attack", player: "p1", attacker: zoneOf(t, "p1", "battle")[0], target: leaderOf(t, "p2") });
    t = choose(playG(t, actsG(t).find((a) => a.type === "counter" && (a as { alt?: boolean }).alt)!), "p2", [two]);
    assert.equal(t.cards[two].mode, "rest", "rested to pay");
    assert.ok(!t.battle || t.battle.negated, "and the attack is negated");
    assertConsistentG(t);
  }

  for (const id of TEMP) delete DEFS[id];
}
