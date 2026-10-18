/**
 * #1015, the second part: the opponent's own choices, and trigger qualifiers that were not enforced.
 *
 *  - "…your opponent chooses 2 cards in their hand **and places them** at the bottom of their
 *    deck" (BT10-045), "…and sends them to their Warp" (BT10-134 …), "…chooses 1 of their Battle
 *    Cards and 1 of their energy and places them …" (BT11-049): the opponent's choice and the move
 *    it ends in are one sentence. Cut at its "and" the choice became a discard (to the Drop,
 *    whatever the card said) and the move read "this card" or "your Leader" (a real misreading
 *    in some dozen cards, e.g. BT10-133 sent the printing card to the Warp).
 *  - "…can't attack with Battle Cards unless **they choose 1 of their Battle Cards with an energy
 *    cost of 2 or more and place it in its owner's Drop Area**" (BT10-063, BT11-034, BT19-049,
 *    BT11-035 …): a price, read, with the attackers it names. A description of the *defender*
 *    (BT13-082, BT14-076, BT18-099) stays unread. "Cards other than their Leader" (BT26-127) is
 *    every card but the Leader, not the Leader.
 *  - "When your opponent **uses a skill to play** a Battle Card with an energy cost greater than
 *    their current energy" (BT15-005, BT15-085, BT15-101) and "…plays … using a skill" (BT12-132)
 *    had no trigger at all or fired on every play. They answer to `opponentPlayedBySkill` now, and
 *    the cost-against-energy bound on a trigger's subject (BT16-023, BT17-124, DB2-059, P-196,
 *    P-202 …) is enforced instead of dropped.
 *
 * Rules engine only; nothing reads the database. Wordings are the catalog's deckplanet text of
 * 18 Oct 2026, with the trigger shortened where it is not the point.
 */
import assert from "node:assert/strict";
import { DEFS, actsG, addEffectG, assertConsistentG, card, compileSkill, findG, labelsG, leaderOf, parseSkills, playG, rejectedActionsG, stagedG, triggersOf, zoneOf } from "./harness";
import type { Action, EngineState } from "./harness";
import { describeScript, validateProgram, type Op } from "../../src/lib/arena/vm/script";

const compile = (text: string) => compileSkill(parseSkills(text)[0]);
const TEMP: string[] = [];
const def = (id: string, o: Parameters<typeof card>[1] & { skill?: string }) => {
  DEFS[id] = { ...card(id, o), ...o, id, name: id } as (typeof DEFS)[string];
  TEMP.push(id);
};
type Forbid = Extract<Op, { op: "forbid" }>;
function find<T extends Op["op"]>(node: unknown, kind: T, out: Extract<Op, { op: T }>[] = []): Extract<Op, { op: T }>[] {
  if (Array.isArray(node)) for (const x of node) find(x, kind, out);
  else if (node && typeof node === "object") {
    if ((node as { op?: string }).op === kind) out.push(node as Extract<Op, { op: T }>);
    for (const v of Object.values(node)) find(v, kind, out);
  }
  return out;
}

// ── the opponent's choice and its move ───────────────────────────────────────
{
  // BT10-045: the opponent picks two cards of their own hand, which go to the bottom of their deck.
  const bt10045 = compile("[Auto] When this card is played, your opponent chooses 2 cards in their hand and places them at the bottom of their deck in any order.");
  assert.deepEqual(bt10045.unsupported, []);
  const [choose] = find(bt10045.ops, "choose");
  assert.deepEqual(choose.sel, { side: "opponent", area: "hand", count: 2 });
  assert.equal(choose.chooser, "opponent");
  const [move] = find(bt10045.ops, "moveTo");
  assert.deepEqual([move.to, move.position, move.target], ["deck", "bottom", { var: choose.as }]);
  assert.equal(validateProgram(bt10045.ops), true);

  // BT10-134 / BT7-114 …: the Warp, not the Drop (it was `opponent discards 2`).
  assert.deepEqual(compile("[Auto] When this card is played, your opponent chooses 2 cards in their hand and sends them to their Warp.").ops, [{ op: "discard", n: 2, side: "opponent", to: "warp" }]);
  assert.deepEqual(compile("[Auto] When this card is played, your opponent chooses 1 card in their hand and places it in their Drop Area.").ops, [{ op: "discard", n: 1, side: "opponent" }], "the Drop is still the plain discard");
  // BT10-133: it is the opponent's card that goes to the Warp, not the printing card.
  const bt10133 = compile("[Auto] When this card attacks, your opponent chooses 1 card in their hand and sends it to their Warp. If the card your opponent sent to their Warp was a Battle Card, combo it with this card.");
  assert.deepEqual(bt10133.ops, [{ op: "discard", n: 1, side: "opponent", to: "warp" }], "…and nothing moves this card");
  assert.ok(bt10133.unsupported.length > 0, "the second sentence is still unread");

  // BT14-129 / BT18-133 / BT10-154: a card of the hand and a Battle Card of theirs, ignoring [Barrier].
  const bt14129 = compile("[auto][once per turn] When this card attacks, your opponent chooses 2 cards in their hand and 2 of their Battle Cards, ignoring [barrier], and sends them to their owners' Warps. At the end of the turn, switch this card to Active Mode.");
  assert.deepEqual(bt14129.unsupported, []);
  const picks = find(bt14129.ops, "choose");
  assert.deepEqual(picks.map((p) => [p.sel.side, p.sel.area, p.sel.count, p.chooser, p.sel.ignoreBarrier ?? false]), [["opponent", "hand", 2, "opponent", false], ["opponent", "battle", 2, "opponent", true]]);
  assert.deepEqual(find(bt14129.ops, "moveTo").map((m) => [m.to, (m.target as { var: string }).var]), picks.map((p) => ["warp", p.as]), "every choice goes to the Warp");

  // BT11-049: a Battle Card and an energy, both theirs, both to the bottom of their owners' decks (the Battle Card used to stay).
  const bt11049 = compile("[Auto] At the end of your turn, switch this card to Active Mode, then your opponent chooses 1 of their Battle Cards and 1 of their energy and places them at the bottom of their owners' decks in any order.");
  assert.deepEqual(bt11049.unsupported, []);
  const two = find(bt11049.ops, "choose");
  assert.deepEqual(two.map((p) => [p.sel.area, p.chooser]), [["battle", "opponent"], ["energy", "opponent"]], "both chosen by the opponent");
  assert.equal(find(bt11049.ops, "moveTo").length, 2, "and both moved");

  // BT4-024b: on top of the deck. TB2-025: the same, with a count of two.
  assert.deepEqual(find(compile("[Auto] When this card attacks, your opponent chooses 1 card from their hand and places it on top of their deck.").ops, "moveTo").map((m) => [m.to, m.position]), [["deck", "top"]]);

  // What it does not read: a place it cannot name, and a sentence that is not one act.
  assert.notDeepEqual(compile("[Auto] When you play this card, your opponent chooses 2 cards from their hand and places them under your {Dr.Uiro's Lab}.").unsupported, []);
  assert.deepEqual(compile("[Auto] When you play this card, your opponent chooses 2 cards from their hand and places them under your {Dr.Uiro's Lab}.").ops, []);
}

// …in a game: the opponent is asked, from their own hand, and the cards end at the bottom of their deck.
{
  def("OC-F", {});
  def("OC-BOTTOM", { skill: "[Auto] When this card is played, your opponent chooses 2 cards in their hand and places them at the bottom of their deck in any order.", energyCost: 0 });
  def("OC-WARP", { skill: "[Auto] When this card is played, your opponent chooses 1 card in their hand and sends it to their Warp.", energyCost: 0 });
  for (const id of ["OC-BOTTOM", "OC-WARP"]) {
    let s = stagedG({ hand: [id], oppHand: ["OC-F", "OC-F", "OC-F"] });
    const mine = zoneOf(s, "p1", "hand").length;
    const deck = zoneOf(s, "p2", "deck").length;
    s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", id) });
    if (s.prompt.kind === "payCost") s = playG(s, { type: "payCost", player: "p1", option: 0 });
    assert.equal(s.prompt.kind, "chooseCards", `${id}: someone is asked`);
    assert.equal((s.prompt as { player: string }).player, "p2", `${id}: the opponent chooses`);
    const asked = s.prompt.kind === "chooseCards" ? s.prompt.choice : null;
    assert.ok(asked && asked.candidates.every((c) => s.cards[c].owner === "p2" && zoneOf(s, "p2", "hand").includes(c)), `${id}: only their own hand is on offer`);
    const n = id === "OC-BOTTOM" ? 2 : 1;
    // A choice of several is asked one card at a time.
    const pick: string[] = [];
    while (s.prompt.kind === "chooseCards") {
      assert.equal(s.prompt.player, "p2", `${id}: every question is theirs`);
      const one = s.prompt.choice.candidates[0];
      pick.push(one);
      s = playG(s, { type: "choose", player: "p2", cards: [one] });
    }
    assert.equal(pick.length, n, `${id}: ${n} asked`);
    assert.equal(zoneOf(s, "p2", "hand").length, 3 - n, `${id}: they gave up ${n}`);
    assert.equal(zoneOf(s, "p1", "hand").length, mine - 1, `${id}: and I gave up only the card I played`);
    if (id === "OC-BOTTOM") {
      assert.equal(zoneOf(s, "p2", "deck").length, deck + 2, "the deck grew by the two");
      assert.deepEqual(zoneOf(s, "p2", "deck").slice(-2).sort(), [...pick].sort(), "at the bottom");
    } else {
      assert.ok(zoneOf(s, "p2", "warp").includes(pick[0]), "to the Warp, not the Drop");
      assert.ok(!zoneOf(s, "p2", "drop").includes(pick[0]));
    }
    assertConsistentG(s);
  }
}

// ── the price "unless they choose … and place it …" ──────────────────────────
{
  const bt10063 = compile("[-2][Activate: Main] Until the end of your opponent's next turn, your opponent can't attack with Battle Cards unless they choose 1 of their Battle Cards with an energy cost of 2 or more and place it in its owner's Drop Area.");
  assert.deepEqual(bt10063.unsupported, []);
  const [rule] = find(bt10063.ops, "forbid") as Forbid[];
  assert.equal(rule.what, "attack");
  assert.equal(rule.side, "opponent");
  assert.equal(rule.filter?.type, "BATTLE", "only the attacks Battle Cards make");
  assert.deepEqual(rule.unlessPay?.map((o) => o.op), ["choose", "moveTo"]);
  const price = rule.unlessPay![0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual([price.sel.area, price.sel.count, price.sel.filter?.costMin, price.sel.notSelf], ["battle", 1, 2, "card"], "a Battle Card of cost 2 or more, never the attacker (FAQ BT11-034, BT19-049)");

  // "they" is the opponent the sentence named (BT11-034, BT14-122).
  const bt11034 = compile("[Auto] When this card is played, during your opponent's next turn, they can't attack with Battle Cards unless they choose 1 of their Battle Cards with an energy cost of 2 or more and place it at the bottom of its owner's deck.");
  assert.deepEqual(bt11034.unsupported, []);
  const [bt11034rule] = find(bt11034.ops, "forbid") as Forbid[];
  assert.equal(bt11034rule.side, "opponent");
  assert.equal(find(bt11034rule.unlessPay, "moveTo")[0].position, "bottom");

  // The hand, with and without "each time" (the official FAQ for BT11-035 and P-442 prices every attack).
  for (const text of [
    "[Auto] When this card is played, your opponent can't attack for the turn unless they choose 1 card in their hand and place it at the bottom of their deck.",
    "[Auto] When this card is played, your opponent can't attack for the turn unless they choose 2 cards in their hand and send them to their Warp each time.",
    "[Auto] When this card is played, your opponent can't attack for the turn unless they choose 2 cards in their hand and discard them each time.",
  ]) {
    const r = compile(text);
    assert.deepEqual(r.unsupported, [], text);
    assert.ok((find(r.ops, "forbid")[0] as Forbid).unlessPay?.length, text);
  }

  // The defender's description is not read: the tax is asked per attacker, so reading it would tax every attack.
  for (const text of [
    "[Auto] When this card is played, your opponent can't attack Leader Cards for the turn unless they choose 1 card in their hand and discard it each time.",
    "[Permanent] While this card is in Rest Mode, your opponent can't attack your Leader Card unless they choose 2 cards in their hand and discard them each time.",
    "[Auto] When this card is played, your opponent can't attack your non-Leader cards for the turn unless they choose 1 of their cards in Active Mode and switch it to Rest Mode each time.",
  ]) {
    const r = compile(text);
    assert.deepEqual(r.ops, [], text);
    assert.equal(r.unsupported.length, 1, text);
  }

  // BT26-127: "cards other than their Leader" is every card but the Leader.
  const others = (find(compile("[Auto] When this card is played, your opponent can't attack with cards other than their Leader for the turn.").ops, "forbid")[0] as Forbid);
  assert.equal(others.filter?.notType, "LEADER");
  assert.equal(others.filter?.type ?? null, null);
}

// …in a game: the Battle Card's attack is priced, the Leader's is not, and the price is another Battle Card.
{
  def("TX-C2", { energyCost: 2 });
  def("TX-C2B", { energyCost: 2 });
  const rule = find(compile("[-2][Activate: Main] Until the end of your opponent's next turn, your opponent can't attack with Battle Cards unless they choose 1 of their Battle Cards with an energy cost of 2 or more and place it in its owner's Drop Area.").ops, "forbid")[0] as Forbid;
  const tax = (s: EngineState) => addEffectG(s, [], { master: "p2", source: leaderOf(s, "p2"), target: "", kind: "forbid", value: 0, until: "turn", forbid: { what: "attack", player: "p1", filter: rule.filter, pay: rule.unlessPay } });
  const attacksBy = (s: EngineState, who: string) => actsG(s).filter((a) => a.type === "attack" && a.attacker === who) as Extract<Action, { type: "attack" }>[];

  // Three Battle Cards: one of the other two pays for the third's attack.
  def("TX-C2C", { energyCost: 2 });
  let s = stagedG({ battle: ["TX-C2", "TX-C2B", "TX-C2C"] });
  const a = findG(s, "p1", "battle", "TX-C2");
  const b = findG(s, "p1", "battle", "TX-C2B");
  const c = findG(s, "p1", "battle", "TX-C2C");
  const leader = leaderOf(s, "p1");
  tax(s);
  assert.ok(attacksBy(s, leader).length, "the Leader's attack is untaxed");
  assert.ok(labelsG(s).some((l) => l.startsWith("Attack") && /first pay: choose 1 Battle Card with an energy cost of 2 or more/.test(l)), `a Battle Card's attack says its price: ${labelsG(s).join(" | ")}`);
  assert.ok(!labelsG(s).some((l) => /first pay/.test(l) && /with .*Leader|L-RED/.test(l)), "the Leader's button says no price");
  s = playG(s, attacksBy(s, a)[0]);
  assert.equal(s.prompt.kind, "chooseCards");
  const offered = s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : [];
  assert.deepEqual([...offered].sort(), [b, c].sort(), "the other Battle Cards, never the attacker");
  s = playG(s, { type: "choose", player: "p1", cards: [b] });
  assert.ok(zoneOf(s, "p1", "drop").includes(b), "paid: to the Drop");

  // The printed skill itself, played, taxes the opponent's next turn the same way ("they" is the opponent, BT11-034).
  def("TX-TAXER", { energyCost: 0, skill: "[Auto] When this card is played, during your opponent's next turn, they can't attack with Battle Cards unless they choose 1 of their Battle Cards with an energy cost of 2 or more and place it at the bottom of its owner's deck." });
  let t = stagedG({ hand: ["TX-TAXER"], oppBattle: ["TX-C2", "TX-C2B", "TX-C2C"] });
  t = playG(t, { type: "play", player: "p1", card: findG(t, "p1", "hand", "TX-TAXER") });
  if (t.prompt.kind === "payCost") t = playG(t, { type: "payCost", player: "p1", option: 0 });
  assert.equal(t.prompt.kind, "main");
  t = playG(t, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  const theirs = zoneOf(t, "p2", "battle");
  assert.ok(labelsG(t).some((l) => l.startsWith("Attack") && /first pay: choose 1 Battle Card with an energy cost of 2 or more/.test(l)), `their Battle Cards pay: ${labelsG(t).join(" | ")}`);
  const leaderAttack = attacksBy(t, leaderOf(t, "p2"));
  assert.ok(leaderAttack.length, "their Leader attacks");
  assert.ok(!labelsG(t).some((l) => l.includes(" — first pay") && l.includes("with L-BLUE")), "…untaxed");
  void theirs;

  // One Battle Card alone cannot pay for itself: the attack is refused, the Leader's is not.
  s = stagedG({ battle: ["TX-C2"] });
  tax(s);
  const solo = findG(s, "p1", "battle", "TX-C2");
  assert.equal(attacksBy(s, solo).length, 0, "20-14-1: a price that cannot be paid is a ban");
  assert.ok(rejectedActionsG(s).some((r) => r.action.type === "attack" && r.action.attacker === solo));
  assert.ok(attacksBy(s, leaderOf(s, "p1")).length, "and the Leader still attacks");
}

// ── "uses a skill to play" ───────────────────────────────────────────────────
{
  const trig = (text: string) => triggersOf(parseSkills(text)[0]);
  assert.deepEqual(trig("[Auto] Switch this card to Rest Mode: When your opponent uses a skill to play a Battle Card with an energy cost greater than their current energy, you may choose that Battle Card and have it get -15000 power for the turn."), ["opponentPlayedBySkill"]);
  assert.deepEqual(trig("[Auto][Once per turn] When your opponent plays a Battle Card with an energy cost greater than their current energy using a skill, this card gets +10000 power until the end of your next turn."), ["opponentPlayedBySkill"]);
  assert.deepEqual(trig("[Auto] When your opponent plays a Battle Card with an energy cost greater than their current energy, return that card to its owner's hand."), ["opponentPlayed"], "no means said: any play");
  // A means the moment cannot tell apart: no trigger, where it used to fire on every play.
  assert.deepEqual(trig("[Auto][once per turn] If your Leader Card is black: When your opponent plays a Battle Card using a non-keyword skill, they choose 1 card from their hand and discard it."), []);
  assert.deepEqual(trig("[Auto] When your opponent plays a Battle Card using a skill or activates a [Counter] skill, choose up to 1 of your opponent's Battle Cards and switch it to Rest Mode."), []);

  // The subject carries the comparison: a Battle Card costing more than the player's energy.
  const bt16023 = compile("[-3][auto] When your opponent plays a Battle Card with an energy cost greater than their current energy, return that card to its owner's hand.");
  const cond = find({ ops: bt16023.ops }, "if")[0];
  assert.ok(cond, "a condition on the subject");
  assert.match(JSON.stringify(cond.cond), /"costAboveEnergy":true,"energyOfOpponent":true/);
  assert.match(describeScript(bt16023.ops), /energy cost greater than your opponent's current energy/);
}

// …in a game: the watcher answers a skill's play of a costly card, and neither a cheap card nor a declared play.
{
  def("SK-BIG", { energyCost: 4, colors: ["Blue"], power: 10000 });
  def("SK-SMALL", { energyCost: 1, colors: ["Blue"], power: 10000 });
  def("SK-PLAYER", { skill: "[Activate: Main] Choose 1 Battle Card in your hand and play it.", colors: ["Blue"], energyCost: 0 });
  def("SK-WATCH", { skill: "[Auto] When your opponent uses a skill to play a Battle Card with an energy cost greater than their current energy, draw 1 card." });
  def("SK-ANY", { skill: "[Auto] When your opponent uses a skill to play a Battle Card, draw 1 card." });
  const startP2 = (hand: string[]) => {
    let s = stagedG({ battle: ["SK-WATCH", "SK-ANY"], oppBattle: ["SK-PLAYER"], oppHand: hand, oppEnergy: ["V-BLUE"] });
    s = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
    return s;
  };
  const drawn = (before: EngineState, after: EngineState) => zoneOf(after, "p1", "hand").length - zoneOf(before, "p1", "hand").length;
  const settleAll = (s: EngineState): EngineState => {
    for (let i = 0; i < 20 && s.prompt.kind !== "main"; i++) {
      if (s.prompt.kind === "chooseCards") { const c = s.prompt.choice; s = playG(s, { type: "choose", player: s.prompt.player, cards: c.candidates.slice(0, c.min) }); continue; }
      s = playG(s, actsG(s).find((x) => x.type === "pass" || (x.type === "counter" && !x.card) || (x.type === "block" && !x.card)) ?? actsG(s)[0]);
    }
    return s;
  };

  // A skill plays the costly card (4 against one energy): both watchers answer.
  let before = startP2(["SK-BIG"]);
  let s = playG(before, { type: "activate", player: "p2", card: findG(before, "p2", "battle", "SK-PLAYER"), skill: 0 } as Action);
  s = settleAll(s);
  assert.ok(zoneOf(s, "p2", "battle").some((x) => s.cards[x].cardId === "SK-BIG"), "the skill played it");
  assert.equal(drawn(before, s), 2, "both watchers saw a skill play it, and it costs more than their energy");

  // A skill plays the cheap card: only the unqualified watcher.
  before = startP2(["SK-SMALL"]);
  s = settleAll(playG(before, { type: "activate", player: "p2", card: findG(before, "p2", "battle", "SK-PLAYER"), skill: 0 } as Action));
  assert.ok(zoneOf(s, "p2", "battle").some((x) => s.cards[x].cardId === "SK-SMALL"));
  assert.equal(drawn(before, s), 1, "the cheap card is no concern of the bounded watcher");

  // The opponent declares the play from their hand: no skill, no answer from either.
  before = startP2(["SK-SMALL"]);
  s = playG(before, { type: "play", player: "p2", card: findG(before, "p2", "hand", "SK-SMALL") });
  if (s.prompt.kind === "payCost") s = playG(s, { type: "payCost", player: "p2", option: 0 });
  s = settleAll(s);
  assert.ok(zoneOf(s, "p2", "battle").some((x) => s.cards[x].cardId === "SK-SMALL"), "played from the hand");
  assert.equal(drawn(before, s), 0, "a declared play is not a skill's");
  assertConsistentG(s);
}

// ── "those Battle Cards" and "that Extra Card" ───────────────────────────────
{
  // DB1-020: the card being played, which the player may leave alone — not a Battle Card of their own.
  const db1020 = compile("[Counter: Play] When the Battle Card is played, choose up to 1 of those Battle Cards and it gets -15000 power for the duration of the turn.");
  assert.deepEqual(db1020.unsupported, []);
  const [pick] = find(db1020.ops, "choose");
  assert.equal(pick.sel.special, "resolving", "the card being played");
  assert.equal(pick.sel.upTo, true, "up to 1: they may decline");
  assert.ok(!/in your Battle Area/.test(describeScript(db1020.ops)), "nothing of mine is on offer");
  assert.equal(validateProgram(db1020.ops), true);

  // The plural pronoun with its noun is the pronoun: the cards the skill just chose.
  const plural = compile("[Activate: Main] Choose up to 2 of your Battle Cards. Those Battle Cards get +5000 power for the turn.");
  assert.deepEqual(plural.unsupported, []);
  assert.match(describeScript(plural.ops), /the chosen cards \+5000 power for the turn/, "the two chosen, not every Battle Card");

  // BT7-025b: the combo'd Battle Cards are held by no variable, so the choice is not read (it chose any Battle Card of mine).
  const bt7025b = compile("[Auto][Once per turn] When you combo with 1 or more Battle Cards with a combo cost of 1 in your Energy Area using a skill, choose up to 1 of those Battle Cards, and when the battle ends the chosen card is returned to its owner's hand instead of being placed in its owner's Drop Area.");
  assert.deepEqual(bt7025b.ops, []);
  assert.ok(bt7025b.unsupported.some((u) => /those cards|those Battle Cards/i.test(u)), `the choice is named as unread: ${JSON.stringify(bt7025b.unsupported)}`);

  // P-028: "that Extra Card" is the Extra being activated; it was "all Extra Cards in your hand", and the reduction is not read.
  const p028 = compile("[Permanent] When you activate an Extra Card, you may choose 1 card in your life and add it to your hand. If you do, reduce the energy cost of that Extra Card by 1 for the duration of the turn.");
  assert.ok(!/costs? \d+ less/.test(describeScript(p028.ops)), "no blanket reduction of every Extra Card");
  assert.ok(p028.unsupported.some((u) => /reduce the energy cost of that Extra Card/i.test(u)));
}

// …in a game: the [Counter: Play] hits the card just played, and only that one.
{
  def("DB-HIT", { skill: "[Counter: Play] When the Battle Card is played, choose up to 1 of those Battle Cards and it gets -15000 power for the duration of the turn.", energyCost: 0, colors: ["Blue"] });
  def("DB-MINE", { energyCost: 1, colors: ["Red"], power: 20000 });
  def("DB-PLAYED", { energyCost: 1, colors: ["Red"], power: 30000 });
  let s = stagedG({ hand: ["DB-PLAYED"], energy: ["V1"], battle: ["DB-MINE"], oppHand: ["DB-HIT"], oppEnergy: ["V-BLUE"] });
  const played = findG(s, "p1", "hand", "DB-PLAYED");
  s = playG(s, { type: "play", player: "p1", card: played });
  if (s.prompt.kind === "payCost") s = playG(s, { type: "payCost", player: "p1", option: 0 });
  assert.equal(s.prompt.kind, "counter", "the opponent may answer with the [Counter: Play]");
  s = playG(s, { type: "counter", player: "p2", card: findG(s, "p2", "hand", "DB-HIT"), skill: 0 } as Action);
  assert.equal(s.prompt.kind, "chooseCards");
  assert.equal((s.prompt as { player: string }).player, "p2");
  assert.deepEqual(s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : [], [played], "only the card being played is on offer");
  s = playG(s, { type: "choose", player: "p2", cards: [played] });
  for (let i = 0; i < 10 && s.prompt.kind !== "main"; i++) s = playG(s, actsG(s).find((x) => x.type === "pass") ?? actsG(s)[0]);
  const mine = zoneOf(s, "p1", "battle").find((x) => s.cards[x].cardId === "DB-MINE")!;
  assert.ok(zoneOf(s, "p1", "battle").includes(played), "it was played");
  assertConsistentG(s);
  void mine;
}

for (const id of TEMP) delete DEFS[id];
