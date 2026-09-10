/**
 * The §22 keywords as engine rules.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import {
  CTX,
  DEFS,
  acts,
  arena,
  assertConsistent,
  autoTriggerMatches,
  canActivate,
  compileSkill,
  eitherOrbsIn,
  find,
  has,
  labels,
  move,
  orbsIn,
  parseConditionClause,
  parseSkills,
  play,
  skillNegated,
  splitClauses,
} from "./harness";

// ── §22 keywords as engine rules ───────────────────────────────────────────

{
  // Trigger moments that are keyword timings, not plain phase timings, are
  // named in WHEN and fired by the engine where the keyword is used.
  DEFS.EVOHOST = { ...DEFS.V1, id: "EVOHOST", name: "EVOHOST", characters: ["Evo Host"] };
  DEFS.EVOTRIG = {
    ...DEFS.V1,
    id: "EVOTRIG",
    name: "EVOTRIG",
    energyCost: 2,
    skill: "[Auto] When using this card's [Evolve] from your hand, draw 1 card.\n[Evolve]{r}: <Evo Host>",
  };
  let s = arena({ hand: ["EVOTRIG"], battle: ["EVOHOST"], energy: ["V1", "V1"] });
  const handBeforePlay = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "EVOTRIG") });
  assert.equal(s.players.p1.hand.length, handBeforePlay - 1, "playing from hand is not the [Evolve] timing");

  s = arena({ hand: ["EVOTRIG"], battle: ["EVOHOST"], energy: ["V1", "V1"] });
  const handBeforeEvolve = s.players.p1.hand.length;
  const evolveAction = acts(s).find((a) => a.type === "activate" && a.card === find(s, "p1", "hand", "EVOTRIG") && !a.alt);
  assert.ok(evolveAction, "the [Evolve] activation is offered from hand");
  s = play(s, evolveAction);
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [s.players.p1.battle[0]] });
  assert.equal(s.players.p1.hand.length, handBeforeEvolve, "using [Evolve] from hand fires the [Auto] once");
  assertConsistent(s);

  DEFS.UABS = {
    ...DEFS.V1,
    id: "UABS",
    name: "UABS",
    skill: "[Auto] When this card's [Union-Absorb] is activated, draw 1 card.\n[Union-Absorb][Activate: Main] Draw 1 card.",
  };
  s = arena({ battle: ["UABS"] });
  const handBeforeAbsorb = s.players.p1.hand.length;
  const absorbAction = acts(s).find((a) => a.type === "activate" && a.card === s.players.p1.battle[0] && !a.alt);
  assert.ok(absorbAction, "the [Union-Absorb] activation is offered");
  s = play(s, absorbAction);
  assert.equal(s.players.p1.hand.length, handBeforeAbsorb + 2, "the activation and the timing [Auto] both resolve");
  assertConsistent(s);
  delete DEFS.EVOTRIG;
  delete DEFS.EVOHOST;
  delete DEFS.UABS;
}

{
  // Free [Counter] from hand is a timing of its own.
  DEFS.CFREE = {
    ...DEFS["E-NEGATE"],
    id: "CFREE",
    name: "CFREE",
    energyCost: 2,
    skill:
      "[Permanent] You may activate this card's [Counter] skill from your hand without paying its energy cost.\n" +
      "[Auto] When you activate this card's [Counter] skill from your hand without paying its energy cost, draw 1 card.\n" +
      "[Counter: Attack] Negate the attack.",
  };
  let s = arena({ hand: ["CFREE"], energy: ["V1"] });
  s = play(
    s,
    { type: "endMain", player: "p1" },
    { type: "charge", player: "p2", card: null },
    { type: "attack", player: "p2", attacker: s.players.p2.leader, target: s.players.p1.leader },
  );
  assert.equal(s.prompt.kind, "counter");
  assert.ok(labels(s).some((x) => x.includes("Counter with CFREE (for no energy)")), "the free counter is offered from hand");
  const handBeforeFreeCounter = s.players.p1.hand.length;
  const activeBefore = s.players.p1.energy.filter((id) => s.cards[id].mode === "active").length;
  const freeCounter = acts(s).find((a) => a.type === "counter" && a.card === find(s, "p1", "hand", "CFREE") && a.alt);
  assert.ok(freeCounter, "the free counter action is legal");
  s = play(s, freeCounter);
  const activeAfter = s.players.p1.energy.filter((id) => s.cards[id].mode === "active").length;
  assert.equal(activeAfter, activeBefore, "free [Counter] from hand rests no energy");
  assert.equal(s.players.p1.hand.length, handBeforeFreeCounter, "the free-counter timing [Auto] drew 1 card");
  assertConsistent(s);

  s = arena({ hand: ["CFREE"], energy: ["V1", "V1", "V1"] });
  s = play(
    s,
    { type: "endMain", player: "p1" },
    { type: "charge", player: "p2", card: null },
    { type: "attack", player: "p2", attacker: s.players.p2.leader, target: s.players.p1.leader },
  );
  const handBeforePaidCounter = s.players.p1.hand.length;
  const paidCounter = acts(s).find((a) => a.type === "counter" && a.card === find(s, "p1", "hand", "CFREE") && !a.alt);
  assert.ok(paidCounter, "the paid counter action is legal too");
  s = play(s, paidCounter);
  assert.equal(s.players.p1.hand.length, handBeforePaidCounter - 1, "paying the [Counter] energy cost does not fire the free-counter timing");
  assertConsistent(s);
  delete DEFS.CFREE;
}

{
  // Skill-cost modifiers: a red-scoped reduction lowers a red [Counter] skill's
  // orbs, does not lower a blue one, and ends at its printed `until`.
  DEFS.COUNTER_RR = { ...DEFS["E-NEGATE"], id: "COUNTER_RR", name: "COUNTER_RR", colors: ["Red"], energyCost: 0, skill: "[Counter: Attack]{r}{r}: Negate the attack." };
  DEFS.COUNTER_UU = { ...DEFS["E-NEGATE"], id: "COUNTER_UU", name: "COUNTER_UU", colors: ["Blue"], energyCost: 0, skill: "[Counter: Attack]{u}{u}: Negate the attack." };
  DEFS.SKILLCHEAP = {
    ...DEFS.V1,
    id: "SKILLCHEAP",
    name: "SKILLCHEAP",
    energyCost: 1,
    skill: "[Auto] When you play this card, reduce the skill cost of your red cards in your hand by {r} until the start of your next turn.",
  };
  let s = arena({ hand: ["SKILLCHEAP", "COUNTER_RR", "COUNTER_UU"], energy: ["V1", "V1"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "SKILLCHEAP") }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null }, {
    type: "attack",
    player: "p2",
    attacker: s.players.p2.leader,
    target: s.players.p1.leader,
  });
  assert.equal(s.prompt.kind, "counter");
  assert.ok(labels(s).some((x) => x.startsWith("Counter with COUNTER_RR")), "the red [Counter] is reduced to {r}");
  assert.ok(!labels(s).some((x) => x.startsWith("Counter with COUNTER_UU")), "the blue card still costs {r}{r}");
  s = play(s, { type: "counter", player: "p1", card: null }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" }, { type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }, {
    type: "endMain",
    player: "p1",
  }, { type: "charge", player: "p2", card: null });
  s.cards[s.players.p1.energy[0]].mode = "rest";
  s = play(s, { type: "attack", player: "p2", attacker: s.players.p2.leader, target: s.players.p1.leader });
  assert.equal(s.prompt.kind, "combo", "once `until` passes, 1 energy no longer offers the {r}{r} counter");
  assertConsistent(s);
}

{
  // [Burst X] (22-27): X cards from the top of the deck to the Drop as a cost;
  // with fewer than X cards in the deck the cost cannot be paid.
  DEFS.BURSTER = { ...DEFS.V1, id: "BURSTER", name: "BURSTER", skill: "[Burst 2][Activate: Main] Draw 1 card." };
  let s = arena({ battle: ["BURSTER"] });
  const b = s.players.p1.battle[0];
  assert.ok(canActivate(s, b), "22-27: offered with a deck to burn");
  const deck = s.players.p1.deck.length;
  const hand = s.players.p1.hand.length;
  const drop = s.players.p1.drop.length;
  s = play(s, { type: "activate", player: "p1", card: b, skill: 0 });
  assert.equal(s.players.p1.drop.length, drop + 2, "22-27-2: two cards to the Drop as the cost");
  assert.equal(s.players.p1.hand.length, hand + 1, "then the skill resolves");
  assert.equal(s.players.p1.deck.length, deck - 3);
  assertConsistent(s);

  const d = arena({ battle: ["BURSTER"] });
  d.players.p1.deck.splice(1).forEach((id) => d.players.p1.drop.push(id));
  assert.ok(!canActivate(d, d.players.p1.battle[0]), "22-27-3: one card in the deck is not enough for [Burst 2]");
}

{
  // [Spirit Boost X] (22-43): X markers off your Unison as a cost.
  DEFS.SPIRIT = { ...DEFS.V1, id: "SPIRIT", name: "SPIRIT", skill: "[Spirit Boost 2][Activate: Main] Draw 1 card." };
  let s = arena({ battle: ["SPIRIT"], hand: ["U1"], energy: ["V1", "V1", "V1"] });
  const sp = s.players.p1.battle[0];
  assert.ok(!canActivate(s, sp), "22-43-3: no Unison, no Spirit Boost");
  s = play(s, { type: "playUnison", player: "p1", card: find(s, "p1", "hand", "U1"), x: 3 });
  const u = s.players.p1.unison!;
  assert.ok(canActivate(s, sp));
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "activate", player: "p1", card: sp, skill: 0 });
  assert.equal(s.cards[u].markers, 1, "22-43-2: two markers removed as the cost");
  assert.equal(s.players.p1.hand.length, hand + 1);
  assert.ok(!canActivate(s, sp), "one marker left is not enough for a second use");
  assertConsistent(s);
}

{
  // 22-43-3: sixteen cards watch the [Spirit Boost] *payment* rather than the
  // marker, from both ends — the Unison the markers came off and the Battle
  // Cards watching it. An attack knocking markers off is not their moment.
  DEFS.SPIRIT2 = { ...DEFS.V1, id: "SPIRIT2", name: "SPIRIT2", skill: "[Spirit Boost 1][Activate: Main] Draw 1 card." };
  DEFS.BOOSTWATCH = { ...DEFS.V1, id: "BOOSTWATCH", name: "BOOSTWATCH", skill: "[Auto] When you remove a marker from one of your Unison Cards using a [Spirit Boost] skill, draw 1 card." };
  DEFS.UWATCH = { ...DEFS.U1, id: "UWATCH", name: "UWATCH", skill: "[Auto] When you remove a marker from this card using a [Spirit Boost] skill, draw 1 card." };
  let s = arena({ battle: ["SPIRIT2", "BOOSTWATCH"], hand: ["UWATCH"], energy: ["V1", "V1", "V1"] });
  s = play(s, { type: "playUnison", player: "p1", card: find(s, "p1", "hand", "UWATCH"), x: 3 });
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "activate", player: "p1", card: s.players.p1.battle[0], skill: 0 });
  // The skill itself draws one, the Unison's own [Auto] one, the watcher one.
  assert.equal(s.players.p1.hand.length, hand + 3, "22-43-3: both ends of the payment fire");
  assertConsistent(s);
}

{
  // 1-10: "when this card is switched to Rest Mode by one of your skills" —
  // your skill and your card, so an opponent resting it is a different moment
  // and this does not fire.
  DEFS.RESTWATCH = { ...DEFS.V1, id: "RESTWATCH", name: "RESTWATCH", skill: "[Auto] When this card is switched to Rest Mode by one of your skills, draw 1 card." };
  DEFS.RESTER = { ...DEFS.V1, id: "RESTER", name: "RESTER", energyCost: 1, skill: "[Auto] When you play this card, switch up to 1 of your Battle Cards to Rest Mode." };
  let s = arena({ hand: ["RESTER"], battle: ["RESTWATCH"], energy: ["V1"] });
  const watcher = s.players.p1.battle[0];
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "RESTER") });
  s = play(s, { type: "choose", player: "p1", cards: [watcher] });
  assert.equal(s.cards[watcher].mode, "rest");
  assert.equal(s.players.p1.hand.length, hand - 1 + 1, "one played, one drawn by the rested card");
  assertConsistent(s);
}

{
  // 5-7: "when you use a card in a combo" is the board's moment, watched by
  // your own cards in play — not the combo card's own skill, which is
  // `comboed` and fires when it leaves the Combo Area (8-5-8).
  DEFS.COMBOWATCH = { ...DEFS.V1, id: "COMBOWATCH", name: "COMBOWATCH", skill: "[Auto] When you use a card in a combo, draw 1 card." };
  let s = arena({ hand: ["V1"], battle: ["COMBOWATCH"] });
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "combo", player: "p1", card: find(s, "p1", "hand", "V1") });
  assert.equal(s.players.p1.hand.length, hand - 1 + 1, "one combo'd, one drawn");
  assertConsistent(s);
}

{
  // [Arrival X/Y] (22-29): from hand during a battle, once cards of both
  // colours are in the Combo Area; the effect is playing the card.
  DEFS.ARRIVER = { ...DEFS.V1, id: "ARRIVER", name: "ARRIVER", energyCost: 4, power: 20000, skill: "[Arrival red/blue] {r}" };
  let s = arena({ hand: ["ARRIVER", "V1", "V-BLUE"], energy: ["V1", "V1"] });
  const arr = find(s, "p1", "hand", "ARRIVER");
  assert.ok(!canActivate(s, arr), "22-29-4: not in the Main Phase");
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  assert.ok(!canActivate(s, arr), "no combo cards yet");
  s = play(s, { type: "combo", player: "p1", card: find(s, "p1", "hand", "V1") });
  assert.ok(!canActivate(s, arr), "red alone is not red and blue");
  s = play(s, { type: "combo", player: "p1", card: find(s, "p1", "hand", "V-BLUE") });
  assert.ok(canActivate(s, arr), "22-29-3: both colours are in the Combo Area");
  s = play(s, { type: "activate", player: "p1", card: arr, skill: 0 });
  assert.ok(s.players.p1.battle.includes(arr), "22-29-5: the card is played");
  assert.equal(s.players.p1.energy.filter((id) => s.cards[id].mode === "rest").length, 1, "for {r}, not its printed cost");
  assert.equal(s.prompt.kind, "combo", "and the battle goes on");
  assert.equal((s.prompt as { side: string }).side, "offense");
  assertConsistent(s);
}

{
  // [Empower X Y] (22-45-3, owner's ruling 9 Sep 2026): a Unison replacing one
  // of colour X *may* carry up to Y of its markers over — a choice the master
  // makes, not an automatic maximum, so playing it asks rather than deciding
  // for them. This used to assert the maximum was applied with no question
  // asked; that was the bug 22-45-3's "may" describes, not a description of it.
  DEFS.EMP = { ...DEFS.U1, id: "EMP", name: "EMP", skill: "[Empower Red 2]" };
  let s = arena({ hand: ["U1", "EMP"], energy: ["V1", "V1", "V1", "V1", "V1"] });
  s = play(s, { type: "playUnison", player: "p1", card: find(s, "p1", "hand", "U1"), x: 3 });
  const old = s.players.p1.unison!;
  s = play(s, { type: "playUnison", player: "p1", card: find(s, "p1", "hand", "EMP"), x: 1 });
  assert.equal(s.prompt.kind, "empowerCarry", "22-45-3: carrying is asked, not assumed");
  assert.equal((s.prompt as { from: string }).from, old);
  assert.equal((s.prompt as { max: number }).max, 2, "capped by the printed Y of 2, though the old Unison had 3 markers");
  s = play(s, { type: "empowerCarry", player: "p1", amount: 2 });
  const emp = s.players.p1.unison!;
  assert.equal(s.cards[emp].cardId, "EMP");
  assert.ok(s.players.p1.drop.includes(old), "13-2-3: the old Unison went to the Drop");
  assert.equal(s.cards[emp].markers, 3, "22-45-2: 1 paid plus 2 carried over (of the 3 it had)");
  assertConsistent(s);
}

{
  // Choosing fewer than the maximum — including none at all — is just as
  // legal an answer, and is the whole point of the choice existing.
  DEFS.EMP2 = { ...DEFS.U1, id: "EMP2", name: "EMP2", skill: "[Empower Red 2]" };
  let s = arena({ hand: ["U1", "EMP2"], energy: ["V1", "V1", "V1", "V1", "V1"] });
  s = play(s, { type: "playUnison", player: "p1", card: find(s, "p1", "hand", "U1"), x: 3 });
  s = play(s, { type: "playUnison", player: "p1", card: find(s, "p1", "hand", "EMP2"), x: 1 });
  assert.equal(s.prompt.kind, "empowerCarry");
  s = play(s, { type: "empowerCarry", player: "p1", amount: 0 });
  const emp2 = s.players.p1.unison!;
  assert.equal(s.cards[emp2].markers, 1, "22-45-3: declining the carry leaves only the marker paid for");
  assertConsistent(s);
}

{
  // [Successor] (22-38): from hand by dropping green/yellow Battle Cards
  // whose costs add up exactly to this card's cost; picked one at a time,
  // and only cards that still leave a way to the exact sum are offered.
  DEFS.SUCC = { ...DEFS.V1, id: "SUCC", name: "SUCC", colors: ["Green", "Yellow"], energyCost: 5, power: 25000, skill: "[Successor]{g}{y}" };
  DEFS.G2 = { ...DEFS.V1, id: "G2", name: "G2", colors: ["Green"], energyCost: 2 };
  DEFS.Y3 = { ...DEFS.V1, id: "Y3", name: "Y3", colors: ["Yellow"], energyCost: 3 };
  DEFS.G4 = { ...DEFS.V1, id: "G4", name: "G4", colors: ["Green"], energyCost: 4 };
  let s = arena({ hand: ["SUCC"], battle: ["G2", "Y3", "G4"], energy: ["G2", "Y3"] });
  const succ = find(s, "p1", "hand", "SUCC");
  const [g2, y3, g4] = s.players.p1.battle;
  assert.ok(
    labels(s).some((x) => x.startsWith("Successor: play SUCC")),
    "22-38-2: a sum of 5 exists (2 + 3)",
  );
  s = play(s, { type: "activate", player: "p1", card: succ, skill: 0 });
  assert.equal(s.prompt.kind, "chooseCards");
  assert.deepEqual((s.prompt as { choice: { candidates: string[] } }).choice.candidates, [g2, y3], "4 alone can never reach 5, so it is not offered");
  s = play(s, { type: "choose", player: "p1", cards: [g2] });
  assert.equal(s.prompt.kind, "chooseCards", "3 more to find");
  assert.deepEqual((s.prompt as { choice: { candidates: string[] } }).choice.candidates, [y3]);
  s = play(s, { type: "choose", player: "p1", cards: [y3] });
  assert.ok(s.players.p1.battle.includes(succ), "22-38-4: played");
  assert.ok(s.players.p1.drop.includes(g2) && s.players.p1.drop.includes(y3), "22-38-3: the chosen cards were dropped");
  assert.ok(s.players.p1.battle.includes(g4), "the rest stay");
  assert.ok(
    s.players.p1.energy.every((id) => s.cards[id].mode === "rest"),
    "{g}{y} was paid",
  );
  assertConsistent(s);

  const n = arena({ hand: ["SUCC"], battle: ["G4", "G4"], energy: ["G2", "Y3"] });
  assert.ok(!labels(n).some((x) => x.startsWith("Successor")), "4 + 4 is not 5");
}

{
  // [Aegis X/Y] (22-30): in the Defense Step of the opponent's turn only; drop
  // one card of each colour from hand, then up to two energy go active.
  DEFS.AEG = { ...DEFS.V1, id: "AEG", name: "AEG", skill: "[Aegis red/blue] {r}" };
  let s = arena({ battle: ["AEG"], hand: ["V1", "V-BLUE"], energy: ["V1", "V1", "V1"] });
  const aeg = s.players.p1.battle[0];
  assert.ok(!canActivate(s, aeg), "22-30-4: not in your own Main Phase");
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  const [e1, e2, e3] = s.players.p1.energy;
  s.cards[e1].mode = "rest";
  s.cards[e2].mode = "rest";
  s = play(s, { type: "attack", player: "p2", attacker: s.players.p2.leader, target: s.players.p1.leader });
  assert.ok(!canActivate(s, aeg), "22-30-4: not in the Offense Step");
  s = play(s, { type: "pass", player: "p2" });
  assert.equal((s.prompt as { side: string }).side, "defense");
  assert.ok(
    labels(s).some((x) => x.startsWith("Aegis Red/Blue")),
    "22-30-4: the Defense Step of the opponent's turn",
  );
  s = play(s, { type: "activate", player: "p1", card: aeg, skill: 0 });
  assert.equal(s.cards[e3].mode, "rest", "the {r} was paid");
  assert.equal(s.prompt.kind, "chooseCards");
  const v1 = find(s, "p1", "hand", "V1");
  const vb = find(s, "p1", "hand", "V-BLUE");
  s = play(s, { type: "choose", player: "p1", cards: [v1] });
  assert.equal(s.prompt.kind, "chooseCards", "one colour down, one to go");
  const rest = (s.prompt as { choice: { candidates: string[] } }).choice.candidates;
  assert.ok(rest.includes(vb) && !rest.includes(v1), "the picked card is off the menu");
  s = play(s, { type: "choose", player: "p1", cards: [vb] });
  assert.ok(s.players.p1.drop.includes(v1) && s.players.p1.drop.includes(vb), "22-30-3: both dropped as the cost");
  assert.equal(s.prompt.kind, "chooseCards", "22-30-5: which energy to stand");
  s = play(s, { type: "choose", player: "p1", cards: [e1] }, { type: "choose", player: "p1", cards: [e2] });
  assert.equal(s.cards[e1].mode, "active");
  assert.equal(s.cards[e2].mode, "active");
  assert.equal(s.cards[e3].mode, "rest", "up to two, not all");
  assert.equal(s.prompt.kind, "combo");
  assert.equal((s.prompt as { side: string }).side, "defense", "back to the Defense Step");
  assertConsistent(s);
}

{
  // [Revive X/Y] (22-34): KO'd, its owner may drop cards from hand covering
  // both colours to play it back from the Drop — once per card per turn.
  DEFS.REV = { ...DEFS.V1, id: "REV", name: "REV", skill: "[Revive red/blue]" };
  let s = arena({ battle: ["REV"], hand: ["V1", "V-BLUE", "V1", "V-BLUE"], oppBattle: ["DOUBLE"] });
  const rev = s.players.p1.battle[0];
  s.cards[rev].mode = "rest";
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  const dbl = s.players.p2.battle[0];
  s = play(s, { type: "attack", player: "p2", attacker: dbl, target: rev }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.ok(s.players.p1.drop.includes(rev), "20000 into 10000: KO'd");
  assert.equal(s.prompt.kind, "chooseCards", "22-34-3: the owner is asked");
  assert.equal((s.prompt as { player: string }).player, "p1");
  const v1 = find(s, "p1", "hand", "V1");
  const vb = find(s, "p1", "hand", "V-BLUE");
  s = play(s, { type: "choose", player: "p1", cards: [v1] }, { type: "choose", player: "p1", cards: [vb] });
  assert.ok(s.players.p1.battle.includes(rev), "22-34-4: played from the Drop");
  assert.ok(s.players.p1.drop.includes(v1) && s.players.p1.drop.includes(vb), "the cost was dropped");
  assert.equal(s.prompt.kind, "main");
  assert.equal(s.turnPlayer, "p2");
  // KO'd again the same turn: [Revive] is negated on it (22-34-4), no question asked.
  s.cards[rev].mode = "rest";
  const handBefore = s.players.p1.hand.length;
  s = play(s, { type: "attack", player: "p2", attacker: s.players.p2.leader, target: rev }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.ok(s.players.p1.drop.includes(rev), "KO'd by the 10000 leader on a tie");
  assert.equal(s.prompt.kind, "main", "no second Revive this turn");
  assert.equal(s.players.p1.hand.length, handBefore, "and nothing was dropped");
  assertConsistent(s);

  // Declining keeps the card in the Drop and the hand whole.
  let d = arena({ battle: ["REV"], hand: ["V1", "V-BLUE"], oppBattle: ["DOUBLE"] });
  const r2 = d.players.p1.battle[0];
  d.cards[r2].mode = "rest";
  d = play(d, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  d = play(d, { type: "attack", player: "p2", attacker: d.players.p2.battle[0], target: r2 }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.equal(d.prompt.kind, "chooseCards");
  const kept = d.players.p1.hand.length;
  d = play(d, { type: "choose", player: "p1", cards: [] });
  assert.ok(d.players.p1.drop.includes(r2));
  assert.equal(d.players.p1.hand.length, kept);
}

{
  // [Rejuvenate] (22-42): a Unison drops a card from beneath itself and pays
  // the printed marker cost; the top card of the deck becomes life.
  DEFS.REJ = { ...DEFS.U1, id: "REJ", name: "REJ", skill: "[Rejuvenate] Remove 2 markers from this card." };
  let s = arena({ hand: ["REJ", "REJ"], energy: ["V1", "V1", "V1"] });
  s = play(s, { type: "playUnison", player: "p1", card: find(s, "p1", "hand", "REJ"), x: 3 });
  const u = s.players.p1.unison!;
  assert.ok(!canActivate(s, u), "22-42-3: nothing beneath it yet");
  const copy = find(s, "p1", "hand", "REJ");
  s = play(s, { type: "growUnison", player: "p1", card: copy });
  assert.equal(s.cards[u].markers, 4);
  assert.ok(labels(s).some((x) => x.startsWith("Rejuvenate: 2 markers")));
  const life = s.players.p1.life.length;
  const top = s.players.p1.deck[0];
  s = play(s, { type: "activate", player: "p1", card: u, skill: 0 });
  assert.equal(s.cards[u].markers, 2, "22-42-3: the marker cost");
  assert.deepEqual(s.cards[u].under, [], "and the card beneath");
  assert.ok(s.players.p1.drop.includes(copy));
  assert.equal(s.players.p1.life.length, life + 1, "22-42-4: the top card of the deck to life");
  assert.ok(s.players.p1.life.includes(top));
  assert.ok(!canActivate(s, u), "13-4-2: one marker skill per card per turn");
  assertConsistent(s);
}

{
  // A prompt for more than one card is answered one card at a time, with
  // "Done choosing" once the minimum is met.
  let s = arena({ hand: ["V1", "V1", "V1"] });
  const [a, b, c] = s.players.p1.hand;
  s.prompt = { kind: "chooseCards", player: "p1", choice: { reason: "test", candidates: [a, b, c], min: 1, max: 2, continuation: "swap" } };
  s.continuations.swap = { card: a };
  assert.ok(!labels(s).includes("Choose none"), "one is required");
  s = play(s, { type: "choose", player: "p1", cards: [a] });
  assert.equal(s.prompt.kind, "chooseCards");
  assert.deepEqual((s.prompt as { choice: { candidates: string[]; min: number; max: number } }).choice.candidates, [b, c]);
  assert.ok(labels(s).includes("Done choosing"), "the minimum is met");
  assert.throws(() => play(s, { type: "choose", player: "p1", cards: [a] }), /invalid choice/, "a card cannot be picked twice");
}

{
  // [Alliance X/Y] (22-32): as it attacks, its owner may rest other Battle
  // Cards of the named colours; the printed effect then reads "the total
  // power of the cards switched to Rest Mode by this skill" off those cards.
  DEFS.ALLY = {
    ...DEFS.V1,
    id: "ALLY",
    name: "ALLY",
    colors: ["Red", "Green"],
    energyCost: 3,
    skill: "[Alliance Red/Green] This card gains power equal to the total power of the cards switched to Rest Mode by this skill and [Double Strike] for the battle, then draw 1 card.",
  };
  DEFS.GRN = { ...DEFS.V1, id: "GRN", name: "GRN", colors: ["Green"], power: 15000 };
  let s = arena({ battle: ["ALLY", "V1", "GRN", "V-BLUE"], oppBattle: ["BIG"] });
  const [ally, v1, grn] = s.players.p1.battle;
  const big = s.players.p2.battle[0];
  s.cards[big].mode = "rest";
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "attack", player: "p1", attacker: ally, target: big });
  assert.equal(s.prompt.kind, "chooseCards", "22-32-3: asked which cards to rest");
  assert.deepEqual((s.prompt as { choice: { candidates: string[] } }).choice.candidates, [v1, grn], "red or green, active, and not the attacker");
  s = play(s, { type: "choose", player: "p1", cards: [v1] }, { type: "choose", player: "p1", cards: [grn] });
  assert.equal(s.cards[v1].mode, "rest");
  assert.equal(s.cards[grn].mode, "rest");
  assert.equal(s.players.p1.hand.length, hand + 1, "then draw 1 card");
  assert.equal(s.prompt.kind, "combo");
  s = play(s, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(s.players.p2.drop.includes(big), "10000 + (10000 + 15000) beats 25000");
  assertConsistent(s);

  // Declining rests nothing and the attack is what it was.
  let d = arena({ battle: ["ALLY", "V1"], oppBattle: ["BIG"] });
  const b2 = d.players.p2.battle[0];
  d.cards[b2].mode = "rest";
  d = play(d, { type: "attack", player: "p1", attacker: d.players.p1.battle[0], target: b2 }, { type: "choose", player: "p1", cards: [] });
  assert.equal(d.cards[d.players.p1.battle[1]].mode, "active");
  d = play(d, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(d.players.p2.battle.includes(b2), "10000 into 25000 does nothing");

  // Nothing of the right colours to rest: no question.
  let n = arena({ battle: ["ALLY", "V-BLUE"], oppBattle: ["BIG"] });
  n.cards[n.players.p2.battle[0]].mode = "rest";
  n = play(n, { type: "attack", player: "p1", attacker: n.players.p1.battle[0], target: n.players.p2.battle[0] });
  assert.equal(n.prompt.kind, "combo");

  // A printed condition on the keyword ("If your Leader Card is blue:") is
  // read before asking.
  DEFS.ALLYC = {
    ...DEFS.ALLY,
    id: "ALLYC",
    name: "ALLYC",
    skill: "[Alliance Red/Green] If your Leader Card is blue: This card gains power equal to the total power of the cards switched to Rest Mode by this skill for the battle.",
  };
  let c = arena({ battle: ["ALLYC", "V1"], oppBattle: ["BIG"] });
  c.cards[c.players.p2.battle[0]].mode = "rest";
  c = play(c, { type: "attack", player: "p1", attacker: c.players.p1.battle[0], target: c.players.p2.battle[0] });
  assert.equal(c.prompt.kind, "combo", "a red Leader: the skill does not apply");
}

{
  // [Invoker] (22-37): a Red/Blue multicolour Extra can be paid for by resting
  // one active Red/Blue multicolour energy instead of its energy cost.
  DEFS.INVK = { ...DEFS.V1, id: "INVK", name: "INVK", colors: ["Red", "Blue"], skill: "[Invoker]" };
  DEFS["E-RB"] = { ...DEFS["E-DRAW"], id: "E-RB", name: "E-RB", colors: ["Red", "Blue"], energyCost: 2 };
  DEFS.RB = { ...DEFS.V1, id: "RB", name: "RB", colors: ["Red", "Blue"] };
  let s = arena({ hand: ["E-RB"], battle: ["INVK"], energy: ["RB"] });
  const e = find(s, "p1", "hand", "E-RB");
  const l = labels(s);
  assert.ok(!l.includes("Activate E-RB (2)"), "one energy cannot pay 2");
  assert.ok(
    l.some((x) => x.startsWith("Activate E-RB by resting a Red/Blue energy")),
    "22-37: [Invoker] in play and a Red/Blue energy active",
  );
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "activate", player: "p1", card: e, skill: 0, alt: true });
  assert.equal(s.cards[s.players.p1.energy[0]].mode, "rest", "the Red/Blue energy was rested");
  assert.equal(s.players.p1.hand.length, hand - 1 + 2, "and the Extra resolved");
  assert.ok(s.players.p1.drop.includes(e));
  assertConsistent(s);

  assert.ok(!labels(arena({ hand: ["E-RB"], energy: ["RB"] })).some((x) => x.includes("Invoker")), "no [Invoker] in play, no offer");
  assert.ok(!labels(arena({ hand: ["E-RB"], battle: ["INVK"], energy: ["V1"] })).some((x) => x.includes("Invoker")), "a mono-red energy will not do");
  assert.ok(!labels(arena({ hand: ["E-DRAW"], battle: ["INVK"], energy: ["RB"] })).some((x) => x.includes("Invoker")), "nor a mono-red Extra");
}

{
  // A condition written before the colon ("[Auto] If your Leader Card is
  // red: …") is part of the skill's validity (9-1-3). It used to land in
  // `cost` and be dropped, so the skill ran whatever the Leader was.
  const cond = compileSkill(parseSkills("[Auto] If your Leader Card is blue: When you play this card, draw 1 card.")[0]);
  assert.deepEqual(cond.unsupported, []);
  assert.equal(cond.ops.length, 1);
  assert.equal(cond.ops[0].op, "if");
  assert.deepEqual((cond.ops[0] as { then: unknown[] }).then, [{ op: "draw", n: 1 }]);
  // One the compiler cannot read fails the skill rather than running it anyway.
  const odd = compileSkill(parseSkills("[Auto] If the moon is full: When you play this card, draw 1 card.")[0]);
  assert.deepEqual(odd.ops, []);
  assert.ok(odd.unsupported.length > 0);

  DEFS.CONDDRAW = { ...DEFS.V1, id: "CONDDRAW", name: "CONDDRAW", energyCost: 1, skill: "[Auto] If your Leader Card is blue: When you play this card, draw 2 cards." };
  let s = arena({ hand: ["CONDDRAW"], energy: ["V1"] });
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "CONDDRAW") });
  assert.equal(s.players.p1.hand.length, hand - 1, "a red Leader: no draw");

  DEFS.CONDACT = { ...DEFS.V1, id: "CONDACT", name: "CONDACT", skill: "[Activate: Main] If your Leader Card is red: Draw 1 card." };
  DEFS.CONDACTB = { ...DEFS.V1, id: "CONDACTB", name: "CONDACTB", skill: "[Activate: Main] If your Leader Card is blue: Draw 1 card." };
  const a = arena({ battle: ["CONDACT", "CONDACTB"] });
  assert.ok(canActivate(a, a.players.p1.battle[0]), "the condition holds: offered");
  assert.ok(!canActivate(a, a.players.p1.battle[1]), "the condition fails: not offered");

  // The shapes the catalog prints most that used to be gaps.
  const read = (t: string) => parseConditionClause(t)?.cond;
  assert.deepEqual(read("if this card has 3 or more markers on it"), { kind: "markers", sel: { special: "self" }, atLeast: 3 });
  assert.deepEqual(read("if this card is in a battle"), { kind: "inBattle", sel: { special: "self" } });
  assert.deepEqual(read("if this card isn't in a battle"), { kind: "inBattle", sel: { special: "self" }, not: true });
  assert.equal(read("if your Leader's back side is a black <Goku> card")?.kind, "leaderMatches");
  assert.ok((read("if your Leader's back side is a black <Goku> card") as { back?: boolean }).back);
  const either = read("when your life is at 4 or less, or you have 5 or more energy");
  assert.equal(either?.kind, "any");
  assert.deepEqual(
    (either as { conds: { kind: string }[] }).conds.map((x) => x.kind),
    ["life", "count"],
  );
  const bothOf = read("if your life is at 4 or less and you have 3 or more energy");
  assert.equal(bothOf?.kind, "all");
  assert.equal(read("if your life is at 4 or less, or the moon is full"), undefined, "one unreadable part fails the whole condition");
  assert.deepEqual(read("if your opponent's Leader Card's back is facing up"), { kind: "leaderFlipped", side: "opponent" });
  assert.deepEqual(read("if this card's power is 30000 or more"), { kind: "power", sel: { special: "self" }, atLeast: 30000 });
  const trait = read("if your Leader Card has ≪Saiyan≫ in its special trait");
  assert.equal(trait?.kind, "leaderMatches");
  assert.deepEqual(
    (trait as { filter: { traits: string[] } }).filter.traits.map((x) => x.toLowerCase()),
    ["saiyan"],
  );
  assert.equal(read("when your life is at 4 or less or your opponent's Leader Card's back is facing up")?.kind, "any");
  // "red or blue" and "4 or less" are not alternatives.
  assert.equal(read("if your Leader Card is red or blue")?.kind, "leaderMatches");

  DEFS.CONDOR = { ...DEFS.V1, id: "CONDOR", name: "CONDOR", skill: "[Activate: Main] If your life is at 4 or less or you have 1 or more energy: Draw 1 card." };
  const o = arena({ battle: ["CONDOR"], energy: ["V1"] });
  assert.ok(canActivate(o, o.players.p1.battle[0]), "8 life, but one energy: the other half holds");
  const o2 = arena({ battle: ["CONDOR"] });
  assert.ok(!canActivate(o2, o2.players.p1.battle[0]), "neither holds");
}

{
  // "Choose up to 1 of your opponent's Battle Cards with power less than or
  // equal to this card's power" used to read "this card" as the target and
  // pick the card itself. The bound is measured where the skill runs.
  const sc = compileSkill(
    parseSkills("[Auto] When this card attacks, choose up to 1 of your opponent's Battle Cards with power less than or equal to this card's power, ignoring [Barrier], and KO it.")[0],
  );
  assert.deepEqual(sc.unsupported, []);
  const sel = (sc.ops[0] as { sel: { side?: string; area?: string; ignoreBarrier?: boolean; filter?: { powerRel: unknown } } }).sel;
  assert.equal(sel.side, "opponent");
  assert.equal(sel.area, "battle");
  assert.deepEqual(sel.filter?.powerRel, { of: "self", cmp: "<=" });
  assert.ok(sel.ignoreBarrier);

  DEFS.RELKO = {
    ...DEFS.V1,
    id: "RELKO",
    name: "RELKO",
    power: 15000,
    skill: "[Auto] When this card attacks, choose up to 1 of your opponent's Battle Cards with power less than or equal to this card's power and KO it.",
  };
  let s = arena({ battle: ["RELKO"], oppBattle: ["V-BLUE", "BIG"] });
  const [small, big] = s.players.p2.battle;
  s.cards[big].mode = "rest";
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.battle[0], target: big });
  assert.equal(s.prompt.kind, "chooseCards");
  assert.deepEqual((s.prompt as { choice: { candidates: string[] } }).choice.candidates, [small], "10000 ≤ 15000; 25000 is not");
  s = play(s, { type: "choose", player: "p1", cards: [small] });
  assert.ok(s.players.p2.drop.includes(small));
  assertConsistent(s);
}

{
  // Wordings from the top of the "one clause away" list.
  const one = (text: string) => compileSkill(parseSkills(`[Auto] When you play this card, ${text}`)[0]);
  const ops = (text: string) => one(text).ops.map((o) => o.op);

  // Several cards to several owners' areas.
  assert.deepEqual(ops("choose 2 of your opponent's Battle Cards and return them to their owners' hands."), ["choose", "moveTo"]);
  assert.deepEqual(ops("choose 2 of your opponent's Battle Cards and place them at the bottom of their owners' decks in any order."), ["choose", "moveTo"]);
  assert.equal((one("choose 2 of your opponent's Battle Cards and place them at the bottom of their owners' decks in any order.").ops[1] as { position?: string }).position, "bottom");
  assert.deepEqual(ops("choose 2 of your opponent's Battle Cards and send them to their owners' Warps."), ["choose", "moveTo"]);

  // The top of the deck to the Drop, either side. The cards go face up, so the
  // mill names them for a clause that asks about them afterwards.
  assert.deepEqual(one("your opponent places the top card of their deck in their Drop Area.").ops, [{ op: "mill", n: 1, side: "opponent", as: "m0" }]);
  assert.deepEqual(one("place the top 2 cards of your deck in your Drop Area.").ops, [{ op: "mill", n: 2, as: "m0" }]);

  // BT2-001: "If that card is red" is a condition on the rest of the sentence,
  // and "that card" is the one the mill just put in the Drop. Before the mill
  // named it there was nothing for the phrase to point at, so the clause was
  // unread — and the ops it did produce gained the power every time.
  const vegito = one("place up to 1 card from the top of your deck in the Drop Area. If that card is red, this card gains +5000 power for the duration of the turn.");
  assert.deepEqual(vegito.unsupported, [], "the whole skill reads");
  assert.deepEqual(
    vegito.ops.map((o) => o.op),
    ["mill", "if"],
  );
  const milled = (vegito.ops[0] as { as: string }).as;
  const gate = vegito.ops[1] as { cond: { kind: string; var: string; filter: { colors: string[] } }; then: { op: string }[] };
  assert.equal(gate.cond.kind, "varMatches");
  assert.equal(gate.cond.var, milled, "the condition asks about the card the mill named");
  assert.deepEqual(gate.cond.filter.colors, ["Red"]);
  assert.deepEqual(
    gate.then.map((o) => o.op),
    ["power"],
    "and the power is inside the condition, not beside it",
  );

  // The comma was never the problem: the same sentence with a condition the
  // parser already knew read correctly all along.
  assert.deepEqual(one("if your Leader Card is red, draw 1 card.").unsupported, []);

  // The other wording for the same move reads the back-reference too.
  assert.deepEqual(one("place the top card of your deck in your Drop Area. If that card is red, draw 1 card.").unsupported, []);

  // "If that card is **not** a <Broly>": `parseFilter` drops the negation, so
  // reading it would hold for exactly the card the sentence excludes. It goes
  // to the referee instead — and, since 9 Sep 2026, so does the clause it
  // governs. Refusing the condition alone left the draw happening every time,
  // which is a wider skill than the card prints; the move before it is kept,
  // because nothing about it hangs on the condition that follows.
  assert.deepEqual(
    one("place the top card of your deck in your Drop Area. If that card is not a <Broly>, draw 1 card.").unsupported,
    ["If that card is not a <Broly>", "draw 1 card"],
    "a refused condition takes the clause it governs with it",
  );

  // A delay the table did not have.
  const later = one("at the start of your opponent's next Main Phase, draw 1 card.").ops[0] as { op: string; at?: string; scope?: string };
  assert.equal(later.op, "delay");
  assert.equal(later.at, "mainStart");
  assert.equal(later.scope, "opponentNextTurn");

  // Hidden Mode (23-5).
  assert.deepEqual(ops("choose 1 of your opponent's Battle Cards and switch it to Hidden Mode."), ["choose", "hidden"]);
  DEFS.HIDER = { ...DEFS.V1, id: "HIDER", name: "HIDER", energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and switch it to Hidden Mode." };
  let s = arena({ hand: ["HIDER"], energy: ["V1"], oppBattle: ["V-BLUE"] });
  const vb = s.players.p2.battle[0];
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "HIDER") });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [vb] });
  assert.equal(s.cards[vb].hidden, true, "23-5-1: face down in the Battle Area");
  assert.ok(s.players.p2.battle.includes(vb), "and still there");

  // "If you added a card to your hand" remembers what this skill did (20-16).
  const did = one("choose up to 1 card in your Drop Area and add it to your hand. If you added a card to your hand, draw 1 card.");
  assert.deepEqual(did.unsupported, []);
  const tail = did.ops[did.ops.length - 1] as { op: string; cond?: { kind: string; what?: string } };
  assert.equal(tail.op, "if");
  assert.deepEqual(tail.cond, { kind: "did", what: "addToHand" });
  DEFS.DIDDRAW = {
    ...DEFS.V1,
    id: "DIDDRAW",
    name: "DIDDRAW",
    energyCost: 1,
    skill: "[Auto] When you play this card, choose up to 1 card in your Drop Area and add it to your hand. If you added a card to your hand, draw 1 card.",
  };
  let d = arena({ hand: ["DIDDRAW", "DIDDRAW"], energy: ["V1", "V1"] });
  let hand = d.players.p1.hand.length;
  d = play(d, { type: "play", player: "p1", card: find(d, "p1", "hand", "DIDDRAW") });
  if (d.prompt.kind === "chooseCards") d = play(d, { type: "choose", player: "p1", cards: [] });
  assert.equal(d.players.p1.hand.length, hand - 1, "an empty Drop: nothing added, nothing drawn");
  const dropped = d.players.p1.deck[0];
  move(CTX, d, [], dropped, "drop", "p1");
  hand = d.players.p1.hand.length;
  d = play(d, { type: "play", player: "p1", card: find(d, "p1", "hand", "DIDDRAW") });
  assert.equal(d.prompt.kind, "chooseCards");
  d = play(d, { type: "choose", player: "p1", cards: [dropped] });
  assert.equal(d.players.p1.hand.length, hand - 1 + 2, "the card from the Drop, then the draw it earned");
  assertConsistent(d);
}

{
  // Negation for a duration (9-1-5) is a continuous effect: it was being
  // written into the state and never read, so "negate its skills for the
  // turn" did nothing — and the card was marked negated for the game as well.
  const ctx = CTX;
  DEFS.MUTER = { ...DEFS.V1, id: "MUTER", name: "MUTER", energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate its skills for the turn." };
  assert.deepEqual(compileSkill(parseSkills(DEFS.MUTER.skill!)[0]).unsupported, []);
  let s = arena({ hand: ["MUTER"], energy: ["V1"], oppBattle: ["BLOCKER"] });
  const blocker = s.players.p2.battle[0];
  assert.ok(has(ctx, s, blocker, "Blocker"));
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "MUTER") });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [blocker] });
  assert.ok(!has(ctx, s, blocker, "Blocker"), "negated for the turn");
  assert.deepEqual(s.cards[blocker].negated, [], "but not marked for the game");
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  assert.equal(s.prompt.kind, "combo", "no [Blocker] to offer");
  s = play(s, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  assert.ok(has(ctx, s, blocker, "Blocker"), "back when the turn ends");

  // "Negate this skill for the turn" is the same idea for one skill.
  DEFS.SELFMUTET = { ...DEFS.V1, id: "SELFMUTET", name: "SELFMUTET", skill: "[Auto] When this card attacks, draw 1 card, then negate this skill for the turn." };
  const sc = compileSkill(parseSkills(DEFS.SELFMUTET.skill!)[0]);
  assert.deepEqual(sc.ops, [
    { op: "draw", n: 1 },
    { op: "negateOwnSkill", until: "turn" },
  ]);
  let t = arena({ battle: ["SELFMUTET"] });
  const sm = t.players.p1.battle[0];
  const hand = t.players.p1.hand.length;
  t = play(t, { type: "attack", player: "p1", attacker: sm, target: t.players.p2.leader }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(t.players.p1.hand.length, hand + 1);
  assert.ok(skillNegated(t, sm, 0), "off for the rest of the turn");
  assert.deepEqual(t.cards[sm].negated, []);
  t = play(t, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  assert.ok(!skillNegated(t, sm, 0), "and back next turn");
}

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const auto = (text: string) => one(`[Auto] When you play this card, ${text}`);

  // "{r}/{u}" is one orb payable with either colour — which is not the same as
  // one of *any* colour, and used to be folded into that.
  assert.deepEqual(orbsIn("{r}/{u}"), {});
  assert.deepEqual(eitherOrbsIn("{r}/{u}"), [["Red", "Blue"]]);
  assert.deepEqual(orbsIn("{r}/{u}{g}"), { Green: 1 });
  const either = parseSkills("[Activate: Main]{r}/{u}: Draw 1 card.")[0];
  assert.deepEqual(either.energyCost, {});
  assert.deepEqual(either.energyEither, [["Red", "Blue"]]);
  assert.equal(either.effect, "Draw 1 card.");

  // A discard that ends in the Warp.
  assert.deepEqual(auto("your opponent sends 1 card from their hand to their Warp.").ops, [{ op: "discard", n: 1, side: "opponent", to: "warp" }]);
  // The opponent's deck, to their Drop.
  assert.deepEqual(auto("place the top card of your opponent's deck into its owner's Drop.").ops, [{ op: "mill", n: 1, side: "opponent", as: "m0" }]);
  // Placed, not played.
  const placed = auto("place up to 2 {Dragon Ball} from your Drop into the Battle Area.").ops;
  assert.deepEqual(
    placed.map((o) => o.op),
    ["choose", "moveTo"],
  );
  assert.equal((placed[0] as { sel: { area?: string } }).sel.area, "drop");
  assert.equal((placed[1] as { to: string }).to, "battle");
  // Shuffled in.
  assert.deepEqual(
    auto("choose 1 card in your Drop Area and shuffle it into your deck.").ops.map((o) => o.op),
    ["choose", "moveTo", "shuffle"],
  );
  // "isn't in play".
  const absent = auto("if {Demonic Invasion Majin Buu} isn't in play in your Battle Area, draw 1 card.").ops[0] as { op: string; cond: { kind: string; atMost?: number } };
  assert.equal(absent.op, "if");
  assert.equal(absent.cond.kind, "count");
  assert.equal(absent.cond.atMost, 0);
  // A duration on its own belongs to the clause after it.
  const lock = auto("choose 1 of your opponent's Battle Cards. Until the end of your opponent's turn, it can't attack.");
  assert.deepEqual(lock.unsupported, []);
  assert.equal((lock.ops[1] as { until?: string }).until, "nextTurn");
  // "If you don't" is the opposite of "if you do".
  const either2 = auto("you may choose 1 card in your hand and discard it. If you don't, your opponent draws 1 card.");
  assert.deepEqual(either2.unsupported, []);
  assert.equal(either2.ops[either2.ops.length - 1].op, "if");
  assert.equal((either2.ops[either2.ops.length - 1] as { cond: { kind: string } }).cond.kind, "not");
  // Looking's housekeeping is not an effect.
  assert.deepEqual(
    auto("look at the top 3 cards of your deck, then put them back in any order.").ops.map((o) => o.op),
    ["look"],
  );
  // A card in the opponent's hand is a hand card.
  assert.equal((auto("choose up to 1 card in your opponent's hand and discard it.").ops[0] as { sel: { area?: string; side?: string } }).sel.area, "hand");

  // "When this card KOs an opponent's Battle Card": the KO'er is told, by battle and by skill.
  DEFS.HUNTER = { ...DEFS.V1, id: "HUNTER", name: "HUNTER", power: 20000, skill: "[Auto] When this card KOs an opponent's Battle Card, draw 1 card." };
  let s = arena({ battle: ["HUNTER"], oppBattle: ["V-BLUE"] });
  const prey = s.players.p2.battle[0];
  s.cards[prey].mode = "rest";
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.battle[0], target: prey }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(s.players.p2.drop.includes(prey));
  assert.equal(s.players.p1.hand.length, hand + 1, "the KO by battle triggers it");
  assertConsistent(s);

  // "Switch the target of the attack to it" — a redirect from a skill.
  DEFS["E-DECOY"] = { ...DEFS["E-NEGATE"], id: "E-DECOY", name: "E-DECOY", skill: "[Counter: Attack] Choose 1 of your Battle Cards and switch the target of the attack to it." };
  assert.deepEqual(
    one(DEFS["E-DECOY"].skill!).ops.map((o) => o.op),
    ["choose", "redirectAttack"],
  );
  let r = arena({ oppHand: ["E-DECOY"], oppEnergy: ["V1"], oppBattle: ["BIG"] });
  const big = r.players.p2.battle[0];
  r = play(r, { type: "attack", player: "p1", attacker: r.players.p1.leader, target: r.players.p2.leader });
  assert.equal(r.prompt.kind, "counter", "the [Counter: Attack] window");
  const edecoy = find(r, "p2", "hand", "E-DECOY");
  r = play(r, { type: "counter", player: "p2", card: edecoy, skill: 0 });
  if (r.prompt.kind === "chooseCards") r = play(r, { type: "choose", player: "p2", cards: [big] });
  assert.equal(r.battle?.guard, big, "the attack now goes at BIG");
}

{
  // A selector resolves to every card it matches, so a move whose target has
  // a number in it has to be a choice first — "add 1 card from your Drop to
  // your hand" used to add the whole Drop.
  const sc = compileSkill(parseSkills("[Auto] When you play this card, add 1 card from your Drop to your hand.")[0]);
  assert.deepEqual(
    sc.ops.map((o) => o.op),
    ["choose", "moveTo"],
  );
  // A bare plural still means all of them.
  assert.deepEqual(
    compileSkill(parseSkills("[Auto] When you play this card, return your opponent's Battle Cards to their owners' hands.")[0]).ops.map((o) => o.op),
    ["moveTo"],
  );

  DEFS.FETCH = { ...DEFS.V1, id: "FETCH", name: "FETCH", energyCost: 1, skill: "[Auto] When you play this card, add 1 card from your Drop to your hand." };
  let s = arena({ hand: ["FETCH"], energy: ["V1"] });
  const [d1, d2] = s.players.p1.deck;
  move(CTX, s, [], d1, "drop", "p1");
  move(CTX, s, [], d2, "drop", "p1");
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "FETCH") });
  assert.equal(s.prompt.kind, "chooseCards", "which one is the player's to say");
  s = play(s, { type: "choose", player: "p1", cards: [d2] });
  assert.equal(s.players.p1.hand.length, hand, "one card in, one card played out");
  assert.ok(s.players.p1.hand.includes(d2));
  assert.ok(s.players.p1.drop.includes(d1), "the other stays");
  assertConsistent(s);
}

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const ops = (text: string) => one(text).ops.map((o) => o.op);

  // A trigger split on its "and" is still the trigger; a condition riding on it wraps the effect.
  const kos = one("[Auto][Once per turn] When this card attacks and KOs an opponent's Battle Card, your opponent chooses 1 card in their hand and discards it.");
  assert.deepEqual(kos.unsupported, []);
  assert.deepEqual(
    kos.ops.map((o) => o.op),
    ["discard"],
  );
  const riding = one("[Auto] When you play this card from your hand and your Leader Card is a ≪Universe 6≫ card, draw 1 card.");
  assert.deepEqual(riding.unsupported, []);
  assert.equal(riding.ops[0].op, "if");
  assert.equal((riding.ops[0] as { cond: { kind: string } }).cond.kind, "leaderMatches");
  // "attacks and KOs" fires on the KO, not on the attack.
  const sk = parseSkills("[Auto] When this card attacks and KOs an opponent's Battle Card, draw 1 card.")[0];
  assert.ok(!autoTriggerMatches(sk, "attacks"));
  assert.ok(autoTriggerMatches(sk, "kos"));

  // Names joined by "and" are one phrase.
  assert.deepEqual(splitClauses("When your opponent plays a red Battle Card with both <Son Goku> and <Piccolo>, play this card."), [
    "When your opponent plays a red Battle Card with both <Son Goku> and <Piccolo>",
    "play this card",
  ]);

  // Under a named host, from an area.
  const under = one("[Auto] When you play this card, place up to 1 yellow ≪Frieza Clan≫ card from your Drop under {Wickedest Clan} in your Battle Area.");
  assert.deepEqual(under.unsupported, []);
  assert.deepEqual(
    under.ops.map((o) => o.op),
    ["choose", "moveTo"],
  );
  assert.equal((under.ops[1] as { to: string }).to, "under");

  // Under a host that is one of two earlier choices (BT3-052, BT3-054). "The
  // chosen opponent Battle Card" and "the chosen <Majin Buu>" are told apart
  // by what each choice asked for, so each half points at its own.
  const buu = one(
    "[Activate: Main] If your Leader Card is <Majin Buu>, choose 1 of your <Majin Buu> and 1 of your opponent's Battle Cards. Place the chosen opponent Battle Card under the chosen <Majin Buu>.",
  );
  assert.deepEqual(buu.unsupported, [], "the whole card reads");
  const flat = JSON.stringify(buu.ops);
  const buried = flat.match(/"op":"moveTo","target":\{"var":"(c\d+)"\},"to":"under","under":\{"var":"(c\d+)"\}/);
  assert.ok(buried, "the opponent's card moves under a card, and both ends are earlier choices");
  assert.notEqual(buried[1], buried[2], "and they are not the same choice");
  const reasons = new Map([...flat.matchAll(/"as":"(c\d+)","reason":"([^"]*)"/g)].map((m) => [m[1], m[2]]));
  assert.match(reasons.get(buried[1]) ?? "", /opponent/i, "the card that gets buried is the opponent's");
  assert.match(reasons.get(buried[2]) ?? "", /your <Majin Buu>/i, "the host is your <Majin Buu>");

  // Nothing to tell the two apart is left to the referee: guessing which of
  // them the sentence means would bury the wrong card half the time.
  const tie = one("[Auto] When you play this card, choose 1 of your <Majin Buu> and 1 of your opponent's <Majin Buu>. Place the chosen <Majin Buu> under the chosen <Majin Buu>.");
  assert.deepEqual(tie.unsupported, ["Place the chosen <Majin Buu> under the chosen <Majin Buu>"]);

  // "All of X is Y" (XD1-01) is the whole set against the part of it the
  // description picks out — and with nothing in the set it does not hold
  // (0-2-4-1), so the skill cannot fire on a turn where the opponent has no
  // energy at all.
  const every = one("[Auto] When your opponent's Leader Card attacks, if all of your opponent's energy is in Rest Mode, draw 1 card.");
  assert.deepEqual(every.unsupported, []);
  assert.match(JSON.stringify(every.ops), /"kind":"every","sel":\{"side":"opponent","area":"energy"\},"matching":\{"side":"opponent","area":"energy","mode":"rest"\}/);
  // A description `parseTarget` cannot take in would leave the two selectors
  // identical and the condition always true, which is worse than a gap — and
  // the draw goes with it, because refusing the condition alone left the skill
  // drawing on every attack (9 Sep 2026).
  assert.deepEqual(one("[Auto] When this card attacks, if all of your energy is thoroughly cromulent, draw 1 card.").unsupported, [
    "if all of your energy is thoroughly cromulent",
    "draw 1 card",
  ]);

  // One end of the battle rather than either (BT4-085). A card of yours doing
  // the attacking is not one being attacked, and "one of" is the article.
  const guard = one("[Auto] When you combo with this card, if one of your yellow Battle Cards is being attacked, this card gains +10000 combo power for the duration of the turn.");
  assert.deepEqual(guard.unsupported, []);
  assert.match(JSON.stringify(guard.ops), /"kind":"inBattle".*"role":"guard"/);
  assert.match(JSON.stringify(one("[Auto] When this card attacks, if this card is attacking, draw 1 card.").ops), /"role":"attacker"/);

  // "If you use this skill to play a Battle Card with [Over Realm]" (BT3-121):
  // what the play earlier in this same skill turned out to be, not anything
  // the board holds.
  const overRealm = one(
    "[Activate: Main] Choose up to 1 Battle Card in your Warp with an energy cost of 4 or less and play it. If you use this skill to play a Battle Card with [Over Realm], draw 1 card.",
  );
  assert.deepEqual(overRealm.unsupported, []);
  assert.match(JSON.stringify(overRealm.ops), /"op":"if","cond":\{"kind":"varMatches","var":"c0"/);
  assert.match(JSON.stringify(overRealm.ops), /"keywords":\["Over Realm"\]/);

  // Two colours joined by "and" are one target phrase (XD1-05). Cut there, the
  // halves are a verb whose object is a colour and a bare noun phrase.
  assert.deepEqual(splitClauses("reduce the combo cost of blue and yellow ≪Universe 6≫ cards in your hand by 1"), ["reduce the combo cost of blue and yellow ≪Universe 6≫ cards in your hand by 1"]);
  assert.deepEqual(one("[Auto] When you play this card, reduce the combo cost of blue and yellow ≪Universe 6≫ cards in your hand by 1 for the duration of the turn.").unsupported, []);

  // "If they don't KO a card this way" (EX03-16) is "if they don't" with the
  // action spelled out again, and "they instead …" is the same branch saying
  // so twice. Both halves of the sentence have to read, or the trailing move
  // binds to the card that was *not* chosen.
  const orElse = one(
    "[Auto] When you play this card, your opponent may choose 1 of their Battle Cards and KO it. If they don't KO a card this way, they instead choose 2 cards in their hand and place them in their Drop Area.",
  );
  assert.deepEqual(orElse.unsupported, []);
  const branch = JSON.stringify(orElse.ops).match(/"cond":\{"kind":"not","cond":\{"kind":"chose","var":"c0"\}\},"then":\[([^\]]*)\]/);
  assert.ok(branch, "the second sentence is the other branch of the offer");
  assert.match(branch[1], /"op":"discard","n":2,"side":"opponent"/, "and it is the opponent discarding 2, not the KO'd card moving again");
  // A condition about the board still reads as one.
  assert.match(JSON.stringify(one("[Activate: Main] If you don't have a Unison in play, draw 1 card.").ops), /"op":"if"/);

  // The alternative cost told over two sentences (BT4-070, BT4-097): the price
  // as something you may do when the [Counter] is activated, the waiver
  // hanging on "if you do so". Clause by clause it became a *play* of this
  // card, which is not what any of it says.
  const alt = one(
    "[Permanent] If your Leader Card is ≪Goku's Lineage≫, when you activate this card's [Counter], you may choose 1 card in your life and add it to your hand. If you do so, you may activate this card's [Counter] without paying its energy cost.",
  );
  assert.deepEqual(alt.unsupported, []);
  assert.match(JSON.stringify(alt.ops), /"kind":"leaderMatches".*"traits":\["goku's lineage"\]/);
  assert.match(JSON.stringify(alt.ops), /\{"op":"altCost","pay":"life","n":1\}/);

  // A combo from the Drop.
  const cf = one("[Activate: Battle] Use up to 1 green card with 5000 combo power from your Drop in a combo with its skills negated for the battle.");
  assert.deepEqual(cf.unsupported, []);
  assert.deepEqual(
    cf.ops.map((o) => o.op),
    ["choose", "comboFrom"],
  );
  assert.equal((cf.ops[1] as { negated?: boolean }).negated, true);
  assert.deepEqual(ops("[Activate: Battle] Use this card from your Drop in a combo."), ["comboFrom"]);
  DEFS.GRAVE = { ...DEFS["E-DRAW"], id: "GRAVE", name: "GRAVE", skill: "[Activate: Battle] Use up to 1 card with 5000 combo power from your Drop in a combo with its skills negated for the battle." };
  let s = arena({ hand: ["GRAVE"], energy: ["V1"], battle: ["BLOCKER"] });
  const dropped = s.players.p1.deck[0];
  move(CTX, s, [], dropped, "drop", "p1");
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  assert.equal(s.prompt.kind, "combo");
  const grave = find(s, "p1", "hand", "GRAVE");
  assert.ok(
    acts(s).some((a) => a.type === "activate" && a.card === grave),
    "[Activate: Battle] from hand during the combo step",
  );
  s = play(s, { type: "activate", player: "p1", card: grave, skill: 0 });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [dropped] });
  assert.ok(s.players.p1.combo.includes(dropped), "5-7: in the Combo Area");
  assert.equal(s.cards[dropped].negated, "all", "with its skills negated");
  assert.equal(s.prompt.kind, "combo");
  assertConsistent(s);

  // Odds and ends from the same list.
  assert.deepEqual(ops("[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate it for the duration of the turn."), ["choose", "negateSkills"]);
  assert.deepEqual(ops("[Counter: Attack] Negate that attack."), ["negateAttack"]);
  assert.equal(parseSkills("[Auto][em][/em] When you play this card, draw 1 card.")[0].kind, "auto");
  const negatedLeader = one("[Counter: Attack] Negate the attack. If you negated a Leader Card's attack with this skill, draw 1 card.");
  assert.deepEqual(negatedLeader.unsupported, []);
  assert.deepEqual((negatedLeader.ops[1] as { cond: unknown }).cond, { kind: "did", what: "negateLeaderAttack" });
  const played = one("[Auto] At the start of your opponent's Main Phase, play up to 1 red card with an energy cost of 3 or less from under this card, and place this card under the played card.");
  assert.deepEqual(played.unsupported, []);
  // 20-16: the flip is offered, and "if you do" is the answer to that offer.
  // It used to be read as simply done, and the draw simply followed.
  const mayFlip = one("[Auto] When one of your yellow Battle Cards is switched to Rest Mode by a skill, you may flip this card over. If you do, draw 1 card.");
  assert.deepEqual(
    mayFlip.ops.map((o) => o.op),
    ["may", "if"],
  );
  assert.deepEqual(
    (mayFlip.ops[0] as { ops: { op: string }[] }).ops.map((o) => o.op),
    ["flip"],
  );
  assert.deepEqual((mayFlip.ops[1] as { cond: unknown }).cond, { kind: "did", what: "may" });
  // On an [Awaken] the flip is the engine's, not an effect.
  assert.deepEqual(ops("[Awaken] When your life is at 4 or less: Draw 1 card and flip this card over."), ["draw"]);
}

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  assert.deepEqual(one("[Auto] When you play this card, draw cards until you have 4 cards in your hand.").ops, [{ op: "draw", n: { handUpTo: 4 } }]);
  assert.deepEqual(one("[Auto] When you play this card, place 2 cards from the top of your opponent's deck in their Drop Area.").ops, [{ op: "mill", n: 2, side: "opponent", as: "m0" }]);
  const marked = one("[Auto] When you play this card, choose 1 of your Battle Cards. Add a marker to the chosen card.");
  assert.deepEqual(marked.unsupported, []);
  assert.deepEqual(marked.ops[1], { op: "addMarker", target: { var: "c0" }, n: 1 });
  const kod = one("[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards with 10000 power or less and KO it. If you KO'd a card, draw 1 card.");
  assert.deepEqual(kod.unsupported, []);
  assert.deepEqual((kod.ops[kod.ops.length - 1] as { cond: unknown }).cond, { kind: "did", what: "ko" });
  assert.ok(autoTriggerMatches(parseSkills("[Auto] When you Combo with this card, draw 1 card.")[0], "comboed"));

  assert.deepEqual(one("[Awaken] If you have 5 or more ≪Saiyan≫ cards in your Warp: Draw 2 cards and add card from your life to you hand until you have 6 life left.").ops, [
    { op: "draw", n: 2 },
    { op: "lifeDownTo", n: 6 },
  ]);
  const under = one(
    "[Activate: Main] Choose up to 1 <Majin Buu> card from your Energy Area and play it. If you played a card, choose up to 1 Battle Card in your Drop Area and place it under the card you played with this skill.",
  );
  assert.deepEqual(under.unsupported, []);
  const noDraw = one(
    "[Auto] When this card attacks, look at the top card of your deck, and if it's a red card, add it to your hand. If you did not draw a card with this skill, this card gets +5000 power for the battle.",
  );
  // The look and the add compile; the hinge after them does not — "if you did
  // not draw a card with this skill" points at a decision nothing bound — and
  // the power it governs is refused with it rather than granted every time.
  assert.deepEqual(noDraw.ops.map((o) => o.op), ["look", "if"]);
  assert.deepEqual(noDraw.unsupported, ["If you did not draw a card with this skill", "this card gets +5000 power for the battle"]);

  // "Draw until you have 4" draws what is missing, and nothing when there is nothing missing.
  DEFS.REFILL = { ...DEFS.V1, id: "REFILL", name: "REFILL", energyCost: 1, skill: "[Auto] When you play this card, draw cards until you have 4 cards in your hand." };
  let s = arena({ hand: ["REFILL"], energy: ["V1"] });
  for (const id of s.players.p1.hand.slice()) if (s.cards[id].cardId !== "REFILL") move(CTX, s, [], id, "deck", "p1", { position: "bottom" });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "REFILL") });
  assert.equal(s.players.p1.hand.length, 4);
}
