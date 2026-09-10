/**
 * The keywords that had a rule and no test, and the readings that follow from
 * whose decision a skill is.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import {
  CTX,
  DEFS,
  acts,
  addEffect,
  arena,
  assertConsistent,
  autoTriggerMatches,
  canActivate,
  compileCostProgram,
  compileSkill,
  describeScript,
  find,
  koCard,
  labels,
  matches,
  move,
  parseFilter,
  parseSkills,
  parseTarget,
  play,
  playCost,
  powerOf,
  priceCondition,
  schedule,
  splitClauses,
  trailingTrigger,
} from "./harness";
import type { GameState, Trigger } from "./harness";

// ── the keywords that had a rule and no test ───────────────────────────────

{
  // 22-40-2: [Servant] gets +10000 power and does not stand in its master's
  // Charge Phase.
  DEFS.SERV = { ...DEFS.V1, id: "SERV", name: "SERV", skill: "[Servant]" };
  let s = arena({ battle: ["SERV"] });
  const serv = s.players.p1.battle[0];
  assert.equal(powerOf(CTX, s, serv), (DEFS.V1.power ?? 0) + 10000, "22-40-2: +10000");
  s.cards[serv].mode = "rest";
  // Round to p1's next Charge Phase.
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" });
  assert.equal(s.turnPlayer, "p1");
  assert.equal(s.cards[serv].mode, "rest", "22-40-2: and it stays rested through the Active Step");
  assertConsistent(s);
}

{
  // 22-14-3: a card with [Ultimate] leaving a Battle Area is removed from the
  // game instead of going wherever it was headed.
  DEFS.ULT = { ...DEFS.V1, id: "ULT", name: "ULT", skill: "[Ultimate]" };
  const s = arena({ battle: ["ULT"] });
  const ult = s.players.p1.battle[0];
  koCard(CTX, s, [], ult);
  assert.ok(s.players.p1.removed.includes(ult), "22-14-3: removed from the game");
  assert.ok(!s.players.p1.drop.includes(ult), "not the Drop");
  assertConsistent(s);
}

{
  // 22-19-2: [Warrior of Universe 7] treats your Universe 7 cards as having no
  // specified cost, so any colour of energy pays for them.
  DEFS.WU7 = { ...DEFS.V1, id: "WU7", name: "WU7", skill: "[Warrior of Universe 7]" };
  DEFS.U7GUY = { ...DEFS.V1, id: "U7GUY", name: "U7GUY", energyCost: 1, traits: ["Universe 7"], colors: ["Red"] };
  // Without it, a red card needs red energy.
  const bare = arena({ hand: ["U7GUY"], energy: ["V-BLUE"] });
  assert.deepEqual(playCost(CTX, bare, find(bare, "p1", "hand", "U7GUY")).specified, { Red: 1 });
  // With it in play, the specified cost is gone.
  const helped = arena({ battle: ["WU7"], hand: ["U7GUY"], energy: ["V-BLUE"] });
  assert.deepEqual(playCost(CTX, helped, find(helped, "p1", "hand", "U7GUY")).specified, {}, "22-19-2");
  assert.ok(
    acts(helped).some((a) => a.type === "play" && a.card === find(helped, "p1", "hand", "U7GUY")),
    "so blue energy can pay for a red Universe 7 card",
  );
}

{
  // 22-35: [Heroic] pends when its owner plays *another* card with [Heroic].
  // It was pended at index -1, where `resolveAuto` looks for a printed skill,
  // finds none and gives up — so it never once fired.
  DEFS.HERO = { ...DEFS.V1, id: "HERO", name: "HERO", energyCost: 1, skill: "[Heroic]" };
  DEFS.VILL = { ...DEFS.V1, id: "VILL", name: "VILL", energyCost: 1, skill: "[Villainous]" };
  let s = arena({ battle: ["HERO"], hand: ["HERO", "HERO"], energy: ["V1", "V1"] });
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "HERO") });
  // 22-35-3: draw 1. One card left the hand to be played, one came in.
  assert.equal(s.players.p1.hand.length, hand, "22-35-3: the one in play drew a card");
  // …and then negates itself for the turn. Playing a third one makes only the
  // *second* pay out: one card in, one card played, so the hand is unchanged.
  // Without the negation the first would draw again and it would be one up.
  const after = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "HERO") });
  assert.equal(s.players.p1.hand.length, after, "22-35-3: each card pays out once a turn, not once per play");
  assertConsistent(s);
}

{
  // 22-35-2 / 22-36-2: each watches its *own* keyword. They used to
  // cross-match, so playing a [Villainous] card set off every [Heroic].
  let s = arena({ battle: ["HERO"], hand: ["VILL"], energy: ["V1"] });
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "VILL") });
  assert.equal(s.players.p1.hand.length, hand - 1, "a Villainous card is not another Heroic one");
  assertConsistent(s);
}

{
  // 22-36-3: [Villainous] makes the opponent drop a card — and 20-7 says which
  // one is their choice, where the engine used to take the last in hand.
  let s = arena({ battle: ["VILL"], hand: ["VILL"], energy: ["V1"], oppHand: ["BIG", "BIG"] });
  const theirs = s.players.p2.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "VILL") });
  assert.equal(s.prompt.kind, "chooseCards");
  assert.equal(s.prompt.player, "p2", "20-7: their hand, their choice");
  s = play(s, { type: "choose", player: "p2", cards: [s.players.p2.hand[0]] });
  assert.equal(s.players.p2.hand.length, theirs - 1);
  assertConsistent(s);
}

{
  // 22-3: [Field] is an [Activate: Main] on an Extra that puts the card itself
  // into the Battle Area in Active Mode, and 22-3-5 drops any other [Field]
  // Extra already there.
  DEFS.FIELD = { ...DEFS["E-DRAW"], id: "FIELD", name: "FIELD", energyCost: 1, skill: "[Field]" };
  let s = arena({ hand: ["FIELD", "FIELD"], energy: ["V1", "V1"] });
  const first = find(s, "p1", "hand", "FIELD");
  s = play(s, { type: "activate", player: "p1", card: first, skill: 0 });
  assert.ok(s.players.p1.battle.includes(first), "22-3-2: into the Battle Area");
  assert.equal(s.cards[first].mode, "active", "22-3-2: in Active Mode");
  const second = find(s, "p1", "hand", "FIELD");
  s = play(s, { type: "activate", player: "p1", card: second, skill: 0 });
  assert.ok(s.players.p1.battle.includes(second));
  assert.ok(s.players.p1.drop.includes(first), "22-3-5: the one already there goes to the Drop");
  assertConsistent(s);
}

{
  // 22-41: [Overlord] costs a [Servant] Battle Card, sent to the bottom of its
  // owner's deck, and draws 1.
  DEFS.OVER = { ...DEFS.V1, id: "OVER", name: "OVER", skill: "[Overlord]" };
  DEFS.SERV2 = { ...DEFS.V1, id: "SERV2", name: "SERV2", skill: "[Servant]" };
  let s = arena({ battle: ["OVER"] });
  const over = s.players.p1.battle[0];
  assert.ok(!canActivate(s, over), "22-41-2: no [Servant] to pay with");
  s = arena({ battle: ["OVER", "SERV2"] });
  const over2 = s.players.p1.battle.find((id) => s.cards[id].cardId === "OVER")!;
  const servant = s.players.p1.battle.find((id) => s.cards[id].cardId === "SERV2")!;
  const hand = s.players.p1.hand.length;
  assert.ok(canActivate(s, over2));
  s = play(s, { type: "activate", player: "p1", card: over2, skill: 0 });
  assert.equal(s.players.p1.deck[s.players.p1.deck.length - 1], servant, "22-41-2: to the bottom of the deck");
  assert.equal(s.players.p1.hand.length, hand + 1, "22-41-3: and draw 1");
  assertConsistent(s);

  // 22-41: four cards watch the keyword being used rather than anything it
  // does — "when you activate an [Overlord] skill".
  DEFS.OVERWATCH = { ...DEFS.V1, id: "OVERWATCH", name: "OVERWATCH", skill: "[Auto] When you activate an [Overlord] skill, draw 1 card." };
  let w = arena({ battle: ["OVER", "SERV2", "OVERWATCH"] });
  const o3 = w.players.p1.battle.find((id) => w.cards[id].cardId === "OVER")!;
  const before = w.players.p1.hand.length;
  w = play(w, { type: "activate", player: "p1", card: o3, skill: 0 });
  assert.equal(w.players.p1.hand.length, before + 2, "the keyword's own draw, and the watcher's");
  assertConsistent(w);
}

{
  // 22-18-2: dealing life damage with a [Victory Strike] card wins the game.
  DEFS.VICTORY = { ...DEFS.V1, id: "VICTORY", name: "VICTORY", power: 30000, skill: "[Victory Strike]" };
  let s = arena({ battle: ["VICTORY"] });
  const vs = s.players.p1.battle[0];
  s.cards[vs].enteredTurn = 0;
  s = play(s, { type: "attack", player: "p1", attacker: vs, target: s.players.p2.leader });
  while (s.prompt.kind === "counter" || s.prompt.kind === "blocker" || s.prompt.kind === "combo") {
    if (s.prompt.kind === "blocker") s = play(s, { type: "block", player: s.prompt.player, card: null });
    else if (s.prompt.kind === "combo") s = play(s, { type: "pass", player: s.prompt.player });
    else s = play(s, { type: "counter", player: s.prompt.player, card: null });
  }
  assert.equal(s.prompt.kind, "gameOver", "22-18-2: the game is over");
  assert.equal(s.phase, "over");
  assertConsistent(s);
}

{
  // 13-5-2-2: against a Unison, [Victory Strike] takes *all* the markers,
  // where [Strike] would take its own number and a plain attack takes one.
  DEFS.UNI = { ...DEFS.U1, id: "UNI", name: "UNI" };
  const setup = (attacker: string) => {
    let g = arena({ battle: [attacker] });
    const me = g.players.p1.battle[0];
    g.cards[me].enteredTurn = 0;
    const uni = g.players.p2.deck[0];
    g.cards[uni].cardId = "UNI";
    move(CTX, g, [], uni, "unison", "p2");
    g.cards[uni].markers = 3;
    g = play(g, { type: "attack", player: "p1", attacker: me, target: uni });
    while (g.prompt.kind === "counter" || g.prompt.kind === "blocker" || g.prompt.kind === "combo") {
      if (g.prompt.kind === "blocker") g = play(g, { type: "block", player: g.prompt.player, card: null });
      else if (g.prompt.kind === "combo") g = play(g, { type: "pass", player: g.prompt.player });
      else g = play(g, { type: "counter", player: g.prompt.player, card: null });
    }
    return g.cards[uni].markers;
  };
  assert.equal(setup("VICTORY"), 0, "13-5-2-2: all of them");
  assert.equal(setup("BIG"), 2, "13-5-2-3: one, without either keyword");
}

{
  // 22-33-3: the *opponent* may drop a life card; if they don't, the owner
  // draws 2. Their choice, not yours.
  DEFS.OFFER = { ...DEFS.V1, id: "OFFER", name: "OFFER", energyCost: 1, skill: "[Offering]" };
  let s = arena({ hand: ["OFFER"], energy: ["V1"] });
  const theirLife = s.players.p2.life.length;
  const myHand = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "OFFER") });
  assert.equal(s.prompt.kind, "offering");
  assert.equal(s.prompt.player, "p2", "22-33-3: the opponent decides");
  // Declining pays the owner instead.
  const declined = play(s, { type: "offering", player: "p2", dropLife: false });
  assert.equal(declined.players.p2.life.length, theirLife, "their life is untouched");
  assert.equal(declined.players.p1.hand.length, myHand - 1 + 2, "so the owner draws 2");
  assertConsistent(declined);
  // Paying costs them a life card and the owner draws nothing.
  const paid = play(s, { type: "offering", player: "p2", dropLife: true });
  assert.equal(paid.players.p2.life.length, theirLife - 1);
  assert.equal(paid.players.p1.hand.length, myHand - 1, "and no draw");
  assertConsistent(paid);
}

{
  // 22-24-2: [Over Realm] is once a turn, and [Wormhole] makes it twice.
  DEFS.HOLE = { ...DEFS.V1, id: "HOLE", name: "HOLE", skill: "[Wormhole]" };
  DEFS.ORB2 = { ...DEFS.V1, id: "ORB2", name: "ORB2", energyCost: 1, skill: "[Over Realm 1]" };
  const dropOne = (g: GameState) => {
    const id = g.players.p1.deck[0];
    move(CTX, g, [], id, "drop", "p1");
  };
  // 22-15-4: activating it sends the *whole* Drop to the Warp, so the second
  // one needs the Drop refilled — otherwise 22-15-3 stops it for want of
  // cards rather than for the limit this is testing.
  const spendDrop = (g: GameState) => {
    dropOne(g);
    let next = play(g, { type: "activate", player: "p1", card: find(g, "p1", "hand", "ORB2"), skill: 0 });
    while (next.prompt.kind === "counter") next = play(next, { type: "counter", player: next.prompt.player, card: null });
    return next;
  };
  const offered = (g: GameState) => {
    const card = find(g, "p1", "hand", "ORB2");
    return !!card && acts(g).some((a) => a.type === "activate" && a.card === card);
  };

  const s = spendDrop(arena({ hand: ["ORB2", "ORB2"], energy: ["V1", "V1"] }));
  dropOne(s);
  assert.ok(!offered(s), "22-15-7: once a turn, even with the Drop refilled");

  const w = spendDrop(arena({ battle: ["HOLE"], hand: ["ORB2", "ORB2"], energy: ["V1", "V1"] }));
  dropOne(w);
  assert.ok(offered(w), "22-24-2: [Wormhole] allows a second");
}

// ── an effect that points back at what its price chose (4-3-3) ─────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // "Choose 1 {Tree of Might} … and place this card under the chosen card:
  // **Add a marker to the chosen card**." The price is its own program, so
  // "the chosen card" had nothing to point at when the effect was compiled.
  const paid = one("[Activate: Main] Choose 1 {Tree of Might, Divine Roots} in your Unison Area and place this card under the chosen card: Add a marker to the chosen card.");
  assert.deepEqual(paid.unsupported, []);
  assert.deepEqual(paid.ops, [{ op: "addMarker", target: { var: "c0" }, n: 1 }]);
  // …and the price itself compiles, with the same name bound.
  const price = compileCostProgram(
    parseSkills("[Activate: Main] Choose 1 {Tree of Might, Divine Roots} in your Unison Area and place this card under the chosen card: Add a marker to the chosen card.")[0],
  );
  assert.ok(price, "the price is an action the engine can charge");
  assert.equal((price.ops[0] as { as?: string }).as, "c0", "and it binds the name the effect uses");

  // A line may carry two tags — "[Blocker][Evolve]{r}{r}: <Pan>" — and the one
  // that owns the text is not always the one picked as *the* keyword, so the
  // Evolve's target was compiled as if it were an effect.
  assert.deepEqual(one("[Blocker][Evolve]{r}{r}: <Pan>.").unsupported, []);
  assert.deepEqual(one("[Blocker][Evolve]{r}{r}: <Pan>.").ops, []);

  // 22-13-4-5-1-1 names this form specially: returned to hand, not dropped.
  const back = one("[Counter: Play] If the Battle Card being played has an energy cost of 3 or less, it is returned to its owner's hand instead of being played.");
  assert.deepEqual(back.unsupported, []);
  assert.deepEqual((back.ops[0] as { then: unknown[] }).then, [{ op: "resolvingPlay", instead: "hand" }]);
}

// ── one verb, two targets ──────────────────────────────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // "This card **and** your Leader get +5000 power" — the "and" joins two
  // targets, not two clauses. Split, the first half was a bare name reported
  // as unreadable; joined but read as one subject, the Leader would have been
  // missed in silence, which is worse. Both have to get the power.
  const two = one("[Auto] When you play a ≪Demon Clan≫ card, this card and your Leader get +5000 power for the turn.");
  assert.deepEqual(two.unsupported, []);
  assert.deepEqual(
    two.ops.map((o) => o.op),
    ["power", "power"],
  );
  assert.deepEqual((two.ops[0] as { target: unknown }).target, { sel: { special: "self" } });
  // "Your Leader" is the one card a player has in that area (3-1-2), so it is
  // the special rather than a search of the Leader Area — the reading that
  // also lets "your **opponent's** Leader" mean the Leader and not any card
  // they happen to have on the table.
  assert.deepEqual((two.ops[1] as { target: unknown }).target, { sel: { special: "leader" } });

  // The same with a pronoun for the card just chosen.
  const both = one("[Auto] When this card attacks, choose up to 1 of your opponent's Battle Cards, and it and this card get -10000 power for the turn.");
  assert.deepEqual(both.unsupported, []);
  assert.deepEqual(
    both.ops.map((o) => o.op),
    ["choose", "power", "power"],
  );
  assert.deepEqual((both.ops[1] as { target: unknown }).target, { var: "c0" });
  assert.deepEqual((both.ops[2] as { target: unknown }).target, { sel: { special: "self" } });

  // A phrase that names two *areas* is one target and must not be cut in half.
  const areas = one("[Auto] When this card attacks, all of your opponent's Battle Cards and Unisons get -5000 power for the turn.");
  assert.deepEqual(areas.unsupported, []);
  assert.deepEqual(
    areas.ops.map((o) => o.op),
    ["power"],
  );
  assert.deepEqual((areas.ops[0] as { target: { sel?: { areas?: string[] } } }).target.sel?.areas, ["battle", "unison"]);

  // A trigger split at its own "and" is still the trigger, not the first
  // thing the skill does.
  const trig = one("[Auto] When this card is revealed from the top of your deck and placed in your Drop Area, draw 1 card.");
  assert.deepEqual(trig.unsupported, []);
  assert.deepEqual(trig.ops, [{ op: "draw", n: 1 }]);
}

// ── "you may" is the player's decision (20-16) ─────────────────────────────

{
  // The words used to be stripped so that every pattern saw a bare
  // instruction, which meant 787 compiled skills carried out an optional
  // effect without asking. Now the offer is real, and "if you don't" has
  // something to be the opposite of.
  DEFS.MAYBE = {
    ...DEFS.V1,
    id: "MAYBE",
    name: "MAYBE",
    energyCost: 1,
    skill: "[Auto] When you play this card, you may draw 1 card. If you don't, your opponent draws 1 card.",
  };
  let s = arena({ hand: ["MAYBE"], energy: ["V1"] });
  const mine = s.players.p1.hand.length;
  const theirs = s.players.p2.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "MAYBE") });
  assert.equal(s.prompt.kind, "chooseMode", "20-16: it asks");
  assert.equal(s.prompt.player, "p1");
  assert.deepEqual(labels(s), ["draw 1 card", "Don't"]);

  // Taking it draws, and the "if you don't" half does not happen.
  const took = play(s, { type: "chooseMode", player: "p1", index: 0 });
  assert.equal(took.players.p1.hand.length, mine - 1 + 1, "one played, one drawn");
  assert.equal(took.players.p2.hand.length, theirs, "and they drew nothing");
  assertConsistent(took);

  // Declining does not draw, and the other half happens instead.
  const left = play(s, { type: "chooseMode", player: "p1", index: 1 });
  assert.equal(left.players.p1.hand.length, mine - 1, "no draw");
  assert.equal(left.players.p2.hand.length, theirs + 1, "20-16: so they draw");
  assertConsistent(left);
}

{
  // A clause that is already a declinable choice asks once, not twice —
  // taking no card *is* declining (5-2-4).
  const sc = compileSkill(parseSkills("[Activate: Main] You may choose 1 card in your hand and discard it.")[0]);
  assert.deepEqual(
    sc.ops.map((o) => o.op),
    ["choose", "moveTo"],
  );
  // And a [Permanent]'s "you can …" is a standing permission, not an offer:
  // wrapped in a decision it disappears from the static layer altogether.
  const perm = compileSkill(parseSkills("[Permanent] You can activate this card's [Counter] skill from your hand by adding a card from your life to your hand instead of paying its energy cost.")[0]);
  assert.deepEqual(sc.unsupported, []);
  assert.ok(
    perm.ops.some((o) => o.op === "altCost"),
    "9-5-1: still a standing effect",
  );
}

{
  // 3-9-2-1: a Life card a skill turns face up stays in the Life Area — it is
  // still life, and still taken as damage in its turn — but both players can
  // see it, and the cards that watch for the moment fire.
  const sc = compileSkill(parseSkills("[Auto] When this card is used in a combo, flip up to 1 card in your life face up; at the end of the turn, flip all face-up cards in your life face down.")[0]);
  assert.deepEqual(sc.unsupported, []);
  assert.deepEqual(
    sc.ops.map((o) => o.op),
    ["choose", "faceUp", "delay"],
    "the number makes it a choice first (5-2), and the turn end puts them back",
  );
  // "Add it to your life face up" is one move, not a move and a second action.
  const give = compileSkill(parseSkills("[Auto] When this card is played, you may choose 1 ≪Frieza's Army≫ card in your hand and add it to your life face up.")[0]);
  assert.deepEqual(give.unsupported, []);
  const moved = give.ops.find((o) => o.op === "moveTo");
  assert.equal(moved?.op === "moveTo" && moved.to, "life");
  assert.equal(moved?.op === "moveTo" && moved.faceUp, true, "3-1-4: marked once it has arrived");
}

{
  // The whole mechanism through the engine: flipping one face up leaves it in
  // the life area, fires the card's own [Auto] there, and the colour the text
  // asks for is the colour of the card whose skill did it.
  let s = arena({ hand: ["FLIPPER", "FLIPPER"], energy: ["V1", "V1"], battle: ["BLUEWATCH"] });
  const target = s.players.p1.life[0];
  s.cards[target].cardId = "LIFEWATCH";
  const life = s.players.p1.life.length;
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "FLIPPER") });
  assert.equal(s.prompt.kind, "chooseCards", "5-2: which life card");
  s = play(s, { type: "choose", player: "p1", cards: [target] });
  assert.equal(s.cards[target].faceUp, true);
  assert.equal(s.players.p1.life.length, life, "3-9-2-1: it is still life");
  assert.ok(s.players.p1.life.includes(target), "and still in the life area");
  // One card played, one drawn by the life card's own [Auto]. BLUEWATCH asks
  // for a *blue* card's skill and FLIPPER is red, so it did not fire.
  assert.equal(s.players.p1.hand.length, hand - 1 + 1, "22: the flipped card's own [Auto] drew");
  assertConsistent(s);

  // Taking it as damage is the ordinary rule: a face-up life card is drawn
  // like any other, and stops being face up once it has left (3-1-4).
  const ctx = CTX;
  const after = structuredClone(s);
  move(ctx, after, [], target, "hand", "p1");
  assert.equal(after.cards[target].faceUp, false, "3-1-4: a card that changed area is a new card");
}

{
  // Prices the engine could not read at all, in the order the catalog prints
  // them. Each is a price, so a wrong reading hands out a skill for free.

  // A few sets print a colourless skill cost as a circled number where the
  // rest print "{3}"; `skillLines` normalises it so every reader of a cost
  // sees one form.
  const circled = parseSkills("[Activate: Main]③, if your Leader Card is a blue <Gogeta> card : Draw 1 card.")[0];
  assert.deepEqual(circled.energyCost, { any: 3 }, "③ is three colourless energy");

  // 9-1-3: a dozen cards state the condition bare, with no "if" in front.
  const bare = parseSkills("[Activate: Main] Your Leader Card is a green ≪Android≫ card : Draw 1 card.")[0];
  const cond = priceCondition(bare);
  assert.equal(cond?.cond.kind, "leaderMatches", "a price that only states a condition");
  // …but an action price is the stronger reading and wins, so a price the
  // engine can charge is never mistaken for a condition that costs nothing.
  const action = parseSkills("[Activate: Main] Switch this card to Rest Mode : Draw 1 card.")[0];
  assert.equal(priceCondition(action), null, "4-3-3: an action price is charged, not merely checked");

  // 20-7: a discard the text describes is still the owner's choice, but only
  // among the cards described — which the `discard` op cannot say.
  const filtered = compileCostProgram(parseSkills("[Activate: Main] Discard 1 mono-green card from your hand : Draw 1 card.")[0]);
  assert.deepEqual(
    filtered?.ops.map((o) => o.op),
    ["choose", "moveTo"],
    "the description makes it a choose plus a move",
  );
  // Naming the card outright is the opposite: nobody chooses.
  const named = compileCostProgram(parseSkills("[Activate: Main] Discard this card from your hand : Draw 1 card.")[0]);
  assert.deepEqual(
    named?.ops.map((o) => o.op),
    ["moveTo"],
  );

  // 19: a token is named by what it is, and only a token carries that name.
  const tokenDef = { ...DEFS.V1, id: "TOKEN:x", name: "Earthling", type: "TOKEN" as const };
  const printed = { ...DEFS.V1, id: "BT1-999", name: "Earthling" };
  const f = parseFilter("1 of your Earthling Tokens");
  assert.deepEqual(f.names, ["earthling"], "the grammar in front of the name is not part of it");
  assert.ok(matches(tokenDef, f));
  assert.ok(!matches(printed, f), "a printed card of the same name is not a token");
  // "If you or your opponent removes 1 token with combo power from the game"
  // names no token at all, and must come out with nothing rather than a name.
  assert.deepEqual(parseFilter("1 token with combo power").names, []);

  // A full stop inside an abbreviation is not the end of a sentence: splitting
  // there left the removal below with nothing to remove.
  assert.deepEqual(splitClauses("Choose up to 2 Cell Jr. tokens in your Battle Area and remove them from the game").length, 2);
  assert.deepEqual(splitClauses("Draw 1 card. Choose 1 of your Battle Cards.").length, 2, "a real sentence still splits");
}

{
  // 20-14: "This card can't be played by skills from any area". The moment
  // that matters is a skill reaching into the Drop for the card, where its own
  // [Permanent] would never have been read — a card in the Drop is not in an
  // area the static layer covers, which is why this is checked on the card
  // itself rather than through `staticEffects`.
  DEFS.NOSKILLPLAY = { ...DEFS.V1, id: "NOSKILLPLAY", name: "NOSKILLPLAY", energyCost: 1, skill: "[Permanent] This card can't be played by skills from any area." };
  DEFS.ONLYSKILLPLAY = { ...DEFS.V1, id: "ONLYSKILLPLAY", name: "ONLYSKILLPLAY", energyCost: 1, skill: "[Permanent] This card can't be played from any area except by skills." };
  DEFS.DROPCALLER = { ...DEFS.V1, id: "DROPCALLER", name: "DROPCALLER", energyCost: 1, skill: "[Auto] When you play this card, play up to 1 card from your drop area." };

  let s = arena({ hand: ["DROPCALLER", "NOSKILLPLAY", "ONLYSKILLPLAY"], energy: ["V1", "V1"] });
  const ctx = CTX;
  const banned = find(s, "p1", "hand", "NOSKILLPLAY");
  const onlyBySkill = find(s, "p1", "hand", "ONLYSKILLPLAY");
  // The one that may only be played by a skill is not offered as a play.
  const labelsNow = labels(s);
  assert.ok(!labelsNow.some((x) => x.includes("ONLYSKILLPLAY")), "20-14: not a play the player may declare");
  assert.ok(
    labelsNow.some((x) => x.includes("NOSKILLPLAY")),
    "…while the other bans only the skill, so the player may still play it",
  );

  // Now put both in the Drop and let a skill try to fetch one.
  move(ctx, s, [], banned, "drop", "p1");
  move(ctx, s, [], onlyBySkill, "drop", "p1");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DROPCALLER") });
  assert.equal(s.prompt.kind, "chooseCards", "the skill asks which card to play");
  // The choice is offered over the area, and the prohibition is applied when
  // the play itself is attempted — so the test is what happens, not what was
  // listed. Picking the banned card leaves it exactly where it was.
  const tried = play(s, { type: "choose", player: "p1", cards: [banned] });
  assert.ok(tried.players.p1.drop.includes(banned), "20-14: a skill can't play it, even out of the Drop");
  assertConsistent(tried);
  // The other way round: a skill is the only way that one can be played.
  const allowed = play(s, { type: "choose", player: "p1", cards: [onlyBySkill] });
  assert.ok(allowed.players.p1.battle.includes(onlyBySkill), "…and its own ban is on the player, not the skill");
  assertConsistent(allowed);
}

{
  // 7-1: "your turn" on a card is its controller's turn, not the turn player's.
  // Both wordings were one trigger pended for both players, so a skill written
  // for your own end step also fired at the end of your opponent's — and the
  // ones that wait for the opponent's turn fired a turn early as well.
  DEFS.MYEND = { ...DEFS.V1, id: "MYEND", name: "MYEND", skill: "[Auto] At the end of your turn, draw 1 card." };
  DEFS.THEIREND = { ...DEFS.V1, id: "THEIREND", name: "THEIREND", skill: "[Auto] At the end of your opponent's turn, draw 1 card." };
  // Measured against a control game, because passing the turn draws a card of
  // its own (7-3) and that has nothing to do with either skill.
  const run = (battle: string[]) => {
    let g = arena({ battle });
    const start = g.players.p1.hand.length;
    g = play(g, { type: "endMain", player: "p1" });
    const own = g.players.p1.hand.length - start;
    g = play(g, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" });
    assertConsistent(g);
    return { own, theirs: g.players.p1.hand.length - start - own };
  };
  const none = run(["V1"]);
  const mine = run(["MYEND"]);
  const theirs = run(["THEIREND"]);
  assert.equal(mine.own - none.own, 1, "7-1: at the end of p1's own turn");
  assert.equal(mine.theirs - none.theirs, 0, "…and not at the end of p1's opponent's turn");
  assert.equal(theirs.own - none.own, 0, "the other wording waits");
  assert.equal(theirs.theirs - none.theirs, 1, "…for the opponent's turn to end");
  // 7-4-4: the End Phase repeats when a skill newly triggers, and the skills
  // that already had their moment must not be offered again — one "draw 1
  // card" drew five.
  assert.equal(mine.own, none.own + 1, "exactly once, not once per End Phase pass");

  // And a card that merely *mentions* a turn boundary in the middle of an
  // effect is not triggered by it: that phrase is a delayed effect (1-7-2-1-1)
  // and the skill has its own trigger already.
  const mid = parseSkills("[Auto] When you play this card, draw 1 card; at the end of the turn, flip all face-up cards in your life face down.")[0];
  assert.ok(autoTriggerMatches(mid, "played"));
  assert.ok(!autoTriggerMatches(mid, "turnEnd"), "116 skills were pending their whole text again at every turn end");

  // …but a skill with no trigger *at all* has nowhere else for its moment to
  // be. Read by the head rule alone, BT3-103's [Auto] never pended and the
  // card did nothing whatsoever, so a trailing timing phrase is its trigger —
  // and, being the trigger, is no longer part of the effect it introduces.
  const trailing = parseSkills("[Auto] Switch this card to Active Mode at the end of your turn.")[0];
  assert.ok(autoTriggerMatches(trailing, "turnEnd"), "the only moment it names is the one it happens at");
  assert.equal(trailingTrigger(trailing), "at the end of your turn");
  assert.deepEqual(compileSkill(trailing).ops, [{ op: "switchMode", target: { sel: { special: "self" } }, mode: "active" }]);
  // A moment printed mid-sentence is still only a delay, trigger or no.
  assert.equal(trailingTrigger(mid), null, "it has a trigger of its own");
  assert.equal(trailingTrigger(parseSkills("[Auto] At the end of the battle, draw 1 card.")[0]), null, "already at the head");
  // Two moments joined by an “or” (BT25-040) is a shape this does not read,
  // and taking one of them would act at a moment the card does not name.
  assert.equal(trailingTrigger(parseSkills("[Auto] Remove this card from the game at the end of the battle for this card or at the end of the turn.")[0]), null);

  // Every head-anchored timing, positively: an anchor that matches nothing is
  // the same silence as no rule at all, and reads as an improvement in the
  // orphan-trigger count while turning the trigger off.
  const heads: [string, Trigger][] = [
    ["At the end of your turn, draw 1 card.", "turnEnd"],
    ["At the end of your opponent's turn, draw 1 card.", "opponentTurnEnd"],
    ["At the start of your opponent's turn, draw 1 card.", "opponentTurnStart"],
    ["At the start of your Main Phase, draw 1 card.", "mainStart"],
    ["At the start of your opponent's Main Phase, draw 1 card.", "opponentMainStart"],
    ["At the start of your turn, draw 1 card.", "chargeStart"],
    ["At the end of the battle, draw 1 card.", "battleEnd"],
    ["At the start of the Offense Step, draw 1 card.", "offenseStart"],
    ["At the start of the Defense Step, draw 1 card.", "defenseStart"],
    ["At the start of the Damage Step, draw 1 card.", "damageStart"],
  ];
  for (const [text, trigger] of heads) {
    assert.ok(autoTriggerMatches(parseSkills(`[Auto] ${text}`)[0], trigger), `${trigger}: ${text}`);
    // …and the condition the sets sometimes print in front of the trigger, with
    // a comma or with their own bar, does not hide it.
    assert.ok(autoTriggerMatches(parseSkills(`[Auto] If your Leader Card is red | ${text}`)[0], trigger), `${trigger} behind a condition`);
  }
}

{
  // 9-9: the two durations written from the controller's chair rather than the
  // turn's. A [Counter] resolves on the opponent's turn by definition, so an
  // effect one of those makes has to be read against its own master — keyed on
  // the turn player at the time, every one of them lasted a whole turn longer
  // than it says.
  const ctx = CTX;
  let s = arena({ battle: ["V1"] });
  const mine = s.players.p1.battle[0];
  const base = powerOf(ctx, s, mine);
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  assert.equal(s.turnPlayer, "p2", "p1's opponent is now the turn player");

  // "…until the end of your opponent's turn", said by p1 during p2's turn.
  const now = structuredClone(s);
  addEffect(now, [], { master: "p1", target: mine, kind: "power", value: 5000, until: "nextTurn" });
  assert.equal(powerOf(ctx, now, mine), base + 5000);
  const p1sTurn = play(now, { type: "endMain", player: "p2" });
  assert.equal(p1sTurn.turnPlayer, "p1");
  assert.equal(powerOf(ctx, p1sTurn, mine), base, "the opponent's turn ended, so the effect did");

  // "…until the start of your opponent's next turn", said at the same moment,
  // runs the other way: through p1's whole turn, ending as p2's next opens.
  const other2 = structuredClone(s);
  addEffect(other2, [], { master: "p1", target: mine, kind: "power", value: 5000, until: "opponentTurn" });
  const mid = play(other2, { type: "endMain", player: "p2" });
  assert.equal(powerOf(ctx, mid, mine), base + 5000, "still there through p1's own turn");
  const later = play(mid, { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  assert.equal(later.turnPlayer, "p2");
  assert.equal(powerOf(ctx, later, mine), base, "…and gone as their next turn opens");

  // 1-7-2-1-1: the same reading for a delayed effect. "At the end of your
  // opponent's turn", written down during that turn, means the turn now under
  // way — asking for a *later* one made it skip the whole turn it was about.
  const scheduled = structuredClone(s);
  const delay = { at: "turnEnd" as const, ops: [{ op: "draw" as const, n: 1 }], card: mine, master: "p1" as const, vars: {}, label: "test" };
  schedule(scheduled, [], { ...delay, scope: "opponentNextTurn" });
  schedule(scheduled, [], { ...delay, scope: "yourNextTurn" });
  const ended = play(scheduled, { type: "endMain", player: "p2" });
  assert.equal(ended.delayed.length, 1, "the opponent's-turn one fired, the own-turn one waits");
  assert.equal(ended.delayed[0].scope, "yourNextTurn");
}

{
  // 9-6-2: "when your ≪Saiyan≫ card is played" is your own side of a moment
  // the engine only announced to the opponent, and the kind of card it names
  // is part of the trigger — dropping that clause dropped the filter with it,
  // so the skill fired for anything at all.
  DEFS.SAIYANWATCH = { ...DEFS.V1, id: "SAIYANWATCH", name: "SAIYANWATCH", skill: "[Auto] When your ≪Saiyan≫ card is played, draw 1 card." };
  DEFS.ASAIYAN = { ...DEFS.V1, id: "ASAIYAN", name: "ASAIYAN", energyCost: 1, traits: ["Saiyan"] };
  DEFS.NOTSAIYAN = { ...DEFS.V1, id: "NOTSAIYAN", name: "NOTSAIYAN", energyCost: 1, traits: ["Android"] };

  const played = (cardId: string) => {
    let g = arena({ hand: [cardId], battle: ["SAIYANWATCH"], energy: ["V1", "V1"] });
    const before = g.players.p1.hand.length;
    g = play(g, { type: "play", player: "p1", card: find(g, "p1", "hand", cardId) });
    assertConsistent(g);
    return g.players.p1.hand.length - (before - 1);
  };
  assert.equal(played("ASAIYAN"), 1, "the watcher drew for a ≪Saiyan≫");
  assert.equal(played("NOTSAIYAN"), 0, "…and not for anything else");
}

{
  // 5-2 / 20-7: the skill is yours, the choice is theirs. "Your opponent
  // chooses 1 of their Battle Cards and KOs it" is a different game from you
  // choosing — they give up their weakest card, not their best — and the
  // clause was unread, so twenty-odd cards did nothing at all.
  DEFS.THEIRPICK = { ...DEFS.V1, id: "THEIRPICK", name: "THEIRPICK", energyCost: 1, skill: "[Auto] When you play this card, your opponent chooses 1 of their Battle Cards and KOs it." };
  let s = arena({ hand: ["THEIRPICK"], energy: ["V1", "V1"], oppBattle: ["V-BLUE", "BIG"] });
  const theirs = s.players.p2.battle.slice();
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "THEIRPICK") });
  assert.equal(s.prompt.kind, "chooseCards");
  assert.equal(s.prompt.player, "p2", "20-7: whoever the card says chooses, chooses");
  const offered = (s.prompt as { choice: { candidates: string[] } }).choice.candidates;
  assert.deepEqual([...offered].sort(), [...theirs].sort(), "…among their own Battle Cards");
  const kept = theirs[1];
  const given = theirs[0];
  const after = play(s, { type: "choose", player: "p2", cards: [given] });
  assert.ok(!after.players.p2.battle.includes(given), "the one they gave up is KO'd");
  assert.ok(after.players.p2.battle.includes(kept), "…and only that one");
  assertConsistent(after);
}

{
  // Sentences the splitter used to cut into nonsense. Each left a fragment
  // naming no action, which failed the whole skill — the fragments in
  // `arena:gaps` ("energy", "choose 1", "<Broly>") are what these look like
  // from the outside.

  // A pair of dashes hangs a description off the target, commas and all.
  assert.deepEqual(splitClauses("Play up to 1 <Son Goku: GT> or <Vegeta: GT> card ―both mono-green, with an energy cost of 5 and 20000 power― from your Drop."), [
    "Play up to 1 <Son Goku: GT> or <Vegeta: GT> card ―both mono-green, with an energy cost of 5 and 20000 power― from your Drop",
  ]);
  // A lone dash is ordinary punctuation and must not swallow the rest.
  assert.equal(splitClauses("Draw 1 card ― then draw 1 card, and draw 1 card.").length, 3);

  // "…your opponent's Battle Cards **and energy**" is one target phrase naming
  // two areas, like "Battle Cards and Unisons" beside it.
  const twoAreas = compileSkill(parseSkills("[Auto] When a card evolves into this card, choose all of your opponent's Battle Cards and energy and switch them to Rest Mode.")[0]);
  assert.deepEqual(twoAreas.unsupported, []);

  // 20-12: "look at the top 3 cards …, choose 1, and add it to your hand" —
  // the middle clause does not repeat what is being chosen among.
  const look = compileSkill(parseSkills("[Auto] When you play this card, look at up to the top 3 cards of your deck, choose 1, and add it to your hand. Then, place the rest in your Drop Area.")[0]);
  assert.deepEqual(look.unsupported, []);
  const picked = look.ops.find((o) => o.op === "choose");
  assert.equal(picked?.op === "choose" && picked.sel.fromVar, "looked", "chosen from what was looked at");

  // 20-16: the other half of "if you do" — the half that decides whether the
  // rest of the skill happens.
  assert.deepEqual(
    compileSkill(
      parseSkills(
        "[Auto] When you play this card, look at up to 3 cards from the top of your deck. Choose up to 1 card among them and add it to your hand, then place the rest in your Drop Area. If you chose not to add any cards to your hand, choose up to 1 of your opponent's Battle Cards in Rest Mode and KO it.",
      )[0],
    ).unsupported,
    [],
  );

  // BT1-074 closes its tag with a brace. Left unread, the tag is not a tag and
  // the line becomes a [Permanent] whose text opens with its own trigger.
  const typo = parseSkills("[Auto} When a card evolves into this card, draw 1 card.")[0];
  assert.equal(typo.kind, "auto");
  assert.ok(autoTriggerMatches(typo, "evolvedInto"));
}

{
  // 21-14: a card of yours being KO'd, watched by the rest of your board —
  // and the same from the other side. `koed` is the KO'd card's own skill and
  // fires on the card that died; these fire on the ones still standing.
  DEFS.MOURNER = { ...DEFS.V1, id: "MOURNER", name: "MOURNER", skill: "[Auto] When your ≪Saiyan≫ card is KO'd, draw 1 card." };
  DEFS.GLOATER = { ...DEFS.V1, id: "GLOATER", name: "GLOATER", skill: "[Auto] When an opponent's Battle Card is KO'd, draw 1 card." };
  DEFS.MYSAIYAN = { ...DEFS.V1, id: "MYSAIYAN", name: "MYSAIYAN", traits: ["Saiyan"] };
  DEFS.MYPLAIN = { ...DEFS.V1, id: "MYPLAIN", name: "MYPLAIN", traits: ["Android"] };

  const ctx = CTX;
  const koing = (victimId: string, ko = true) => {
    const s = arena({ battle: ["MOURNER", victimId], oppBattle: ["GLOATER"] });
    const mine = s.players.p1.hand.length;
    const theirs = s.players.p2.hand.length;
    const victim = s.players.p1.battle.find((id) => s.cards[id].cardId === victimId)!;
    const ev: Parameters<typeof koCard>[2] = [];
    const after = structuredClone(s);
    if (ko) koCard(ctx, after, ev, victim);
    // The pended skills are drained by the engine, so run it to a prompt.
    const done = play(after, { type: "endMain", player: "p1" });
    return { mine: done.players.p1.hand.length - mine, theirs: done.players.p2.hand.length - theirs };
  };
  // Passing the turn draws for the new turn player, so both sides are read
  // against a KO of a card neither watcher cares about.
  const plain = koing("MYPLAIN");
  const saiyan = koing("MYSAIYAN");
  assert.equal(saiyan.mine - plain.mine, 1, "9-6-2: the ≪Saiyan≫ was the one it was watching for");
  assert.equal(saiyan.theirs - plain.theirs, 0, "…and their side heard the same KO only once, either way");
  const none = koing("MYPLAIN", false);
  assert.equal(plain.theirs - none.theirs, 1, "an opponent's Battle Card was KO'd, whatever it was");
  assert.equal(plain.mine - none.mine, 0, "…and it was not a ≪Saiyan≫");
}

{
  // The moments the owner's own decks were still waiting for. Asserted
  // positively, one wording each: a trigger regex that matches nothing is the
  // same silence as no rule at all, and reads as an improvement in the count.
  const moments: [string, Trigger][] = [
    ["When this card is placed in the Drop Area from the Battle Area, draw 1 card.", "leftBattleToDrop"],
    ["When your mono-red ≪Saiyan≫ Leader Card is attacked, draw 1 card.", "yourLeaderAttacked"],
    ["When you take damage from an opponent's non-keyword skill, draw 1 card.", "youTookDamage"],
    ["When your opponent takes damage from a skill on one of your Battle Cards, draw 1 card.", "opponentTookDamage"],
    ["When your life moves to another area, draw 1 card.", "lifeLeft"],
    ["When your life is placed in your Drop, draw 1 card.", "lifeLeft"],
    ["When one of your card skills switches an opponent's Battle Card or energy to Rest Mode, draw 1 card.", "restedTheirsBySkill"],
    ["When this card is placed in your Drop Area from your Unison Area, draw 1 card.", "unisonToDrop"],
  ];
  for (const [text, trigger] of moments) {
    assert.ok(autoTriggerMatches(parseSkills(`[Auto] ${text}`)[0], trigger), `${trigger}: ${text}`);
  }
  // 3-1: "placed in the Drop Area from the Battle Area **by a skill**" names a
  // cause, and a battle KO is not it — so the two wordings stay apart.
  const bySkill = parseSkills("[Auto] When this card is placed in a Drop Area from a Battle Area by a skill, draw 1 card.")[0];
  assert.ok(autoTriggerMatches(bySkill, "droppedFromBattle"));
  assert.ok(!autoTriggerMatches(bySkill, "leftBattleToDrop"), "the one that names a cause is not the one that names none");

  // 8-1: through the engine — a Battle Card watching the Leader be attacked.
  DEFS.LEADERWATCH = { ...DEFS.V1, id: "LEADERWATCH", name: "LEADERWATCH", skill: "[Auto] When your Leader Card is attacked, draw 1 card." };
  let s = arena({ oppBattle: ["LEADERWATCH"] });
  const theirs = s.players.p2.hand.length;
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  assert.equal(s.players.p2.hand.length, theirs + 1, "8-1: their board heard their Leader being attacked");
  assertConsistent(s);
}

{
  // 5-3: the card's own offer of another way to pay for its [Counter], when
  // what it asks for is an *action* rather than energy. Twenty-two cards print
  // one, and every one of them was unread — the skill could only ever be paid
  // for with energy it may not have.
  DEFS.ALTC = {
    ...DEFS["E-NEGATE"],
    id: "ALTC",
    name: "ALTC",
    energyCost: 3,
    skill:
      "[Counter: Attack] Negate the attack.<br>[Permanent] You can activate this card's [Counter] skill from your hand without paying its energy cost by choosing 1 other black card in your hand and placing it in your Drop Area.",
  };
  DEFS.BLACKCARD = { ...DEFS.V1, id: "BLACKCARD", name: "BLACKCARD", colors: ["Black"] };

  // No energy at all, so the printed cost is out of reach; the alternative is
  // the only way in. Two black cards, so the price is a real choice and p2 is
  // the one asked (20-7) — with only one the engine takes it silently, which
  // is 5-2 and not this rule.
  let s = arena({ oppHand: ["ALTC", "BLACKCARD", "BLACKCARD"] });
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  const counter = find(s, "p2", "hand", "ALTC");
  const offered = acts(s).filter((a) => a.type === "counter" && a.card === counter);
  assert.ok(
    offered.some((a) => (a as { alt?: boolean }).alt),
    "4-3-3: offered, because the board can meet the price",
  );
  const hand = s.players.p2.hand.length;
  const drop = s.players.p2.drop.length;
  s = play(s, { type: "counter", player: "p2", card: counter, alt: true });
  assert.equal(s.prompt.kind, "chooseCards", "the price asks which black card");
  assert.equal(s.prompt.player, "p2", "20-7: and it is theirs to answer");
  const black = (s.prompt as { choice: { candidates: string[] } }).choice.candidates[0];
  s = play(s, { type: "choose", player: "p2", cards: [black] });
  assert.ok(s.players.p2.drop.includes(black), "the price was charged");
  assert.equal(s.players.p2.hand.length, hand - 2, "the counter and the card it cost both left the hand");
  assert.equal(s.players.p2.drop.length, drop + 2);
  assert.equal(s.battle, null, "…and the attack was negated");
  assertConsistent(s);

  // With nothing black to give up, the alternative is not offered at all —
  // a price the board cannot meet is not an offer (4-3-3).
  let poor = arena({ oppHand: ["ALTC"] });
  poor = play(poor, { type: "attack", player: "p1", attacker: poor.players.p1.leader, target: poor.players.p2.leader });
  const lone = find(poor, "p2", "hand", "ALTC");
  assert.ok(!acts(poor).some((a) => a.type === "counter" && a.card === lone && (a as { alt?: boolean }).alt));
}

{
  // A comma inside a *list* is not a sentence break, and neither is the "and"
  // that ends one. Ninety-eight skills were losing a one-word fragment to
  // this — "green", "hand", "Battle Area" — and a fragment fails the whole
  // skill, so each of these sentences did nothing at all.
  const one = (text: string) => splitClauses(text);
  assert.deepEqual(one("This card is also treated as red, blue, and green."), ["This card is also treated as red, blue, and green"]);
  assert.deepEqual(one("Play up to 1 card from your hand, Drop, or Warp."), ["Play up to 1 card from your hand, Drop, or Warp"]);
  assert.deepEqual(one("All cards in your opponent's Leader Area, Battle Area, and Combo Area get -5000 power."), [
    "All cards in your opponent's Leader Area, Battle Area, and Combo Area get -5000 power",
  ]);
  // The two-item version, which the sets write without a comma.
  assert.deepEqual(one("This card is green while in your deck and Drop Area."), ["This card is green while in your deck and Drop Area"]);

  // …and none of that may swallow a real sentence break. Two conditions are
  // not a list, even when both halves happen to be list words ("yellow",
  // "life"); the missing comma is what tells them apart.
  assert.equal(one("If your Leader Card is yellow and your life is at 4 or less, draw 1 card.").length, 3);
  assert.equal(one("Draw 1 card, and draw 1 card.").length, 2);
  assert.equal(one("Choose 1 card in your hand, and place it in your Drop Area.").length, 2);
  assert.equal(one("Place it in your Drop Area and draw 1 card.").length, 2);

  // "You and your opponent draw 1 card" is one sentence about both players.
  const both = compileSkill(parseSkills("[Auto] When this card is played, you and your opponent draw 1 card.")[0]);
  assert.deepEqual(both.unsupported, []);
  assert.deepEqual(both.ops, [
    { op: "draw", n: 1 },
    { op: "draw", n: 1, side: "opponent" },
  ]);
}

{
  // Sentences from the owner's own decks, each of which did nothing at all.
  const read = (text: string) => compileSkill(parseSkills(text)[0]);

  // 20-21 works in both directions and the sets print both.
  const dearer = read("[Permanent] Increase the energy cost of this card in your Battle Area by 2.");
  assert.deepEqual(dearer.unsupported, []);
  assert.equal((dearer.ops[0] as { amount: number }).amount, -2, "the same standing effect with the sign turned round");
  assert.equal(describeScript(dearer.ops), "this card costs 2 more", "…and 'costs -2 less' is not English");

  // A deck-building rule keeps its exception: splitting at that comma left
  // "except for <Vegeta> cards" behind as a clause naming no action.
  assert.deepEqual(read("[Permanent] You can't include non-≪Universe 6≫ Battle Cards in your deck, except for <Vegeta> cards.").unsupported, []);

  // 9-9: a condition tail on a [Permanent], with two effects hanging off one
  // subject — the "and" before a keyword tag is not a sentence break either.
  const crit = read("[Permanent] When your life is less than or equal to your opponent's life, this card gains +5000 power and [Critical] during your turn.");
  assert.deepEqual(crit.unsupported, []);
  // A [Permanent] holds while its card is where the skill is valid (9-5-1):
  // its ops carry `game` rather than the turn every clause used to get, and
  // the inspector says no duration at all for one.
  assert.ok(
    crit.ops.every((o) => JSON.stringify(o).includes('"until":"game"')),
    "a [Permanent]'s ops hold for the game, not a turn",
  );
  assert.equal(describeScript(crit.ops, { permanent: true }), "if your life is no more than theirs: if it is your turn: this card +5000 power, this card gains [Critical]");
  assert.equal(describeScript(read("[Activate: Main] This card gets +5000 power for the turn.").ops), "this card +5000 power for the turn");
  assert.equal(
    describeScript(read("[Auto] When you play this card, choose 1 of your opponent's Battle Cards. It can't attack until the end of your opponent's next turn.").ops),
    "choose 1 in opponent's battle, the chosen cards can't attack until the end of your opponent's turn",
    "a duration reads as words, never as the enum's name",
  );
}

{
  // Two silent mis-reads, both of the kind ground rule 5 is about: the clause
  // compiled, so nothing reported them, and the reading was wrong.

  // A digit inside a name is part of the name, not a count. 533 skills on 436
  // cards name one — ≪Universe 7≫, <Android 18>, <Super 17> — and "your
  // ≪Universe 6≫ cards in your hand" was six of them.
  assert.equal(parseTarget("blue ≪Universe 6≫ cards in your hand")?.count, 99, "a plural with no number is all of them");
  assert.equal(parseTarget("1 ≪Universe 6≫ card in your hand")?.count, 1, "…and a real count still wins");
  assert.equal(parseTarget("up to 2 <Android 17> cards in your hand")?.count, 2);
  assert.equal(parseTarget("<Android 18> cards in your Battle Area")?.count, 99);

  // Several colours in one description mean *either* of them. Requiring all of
  // them made "blue, yellow ≪Universe 6≫ cards" match nothing at all, because
  // no card is both.
  const either = parseFilter("blue, yellow ≪Universe 6≫ cards");
  const blue = { ...DEFS.V1, colors: ["Blue" as const], traits: ["Universe 6"] };
  const red = { ...DEFS.V1, colors: ["Red" as const], traits: ["Universe 6"] };
  assert.ok(matches(blue, either));
  assert.ok(!matches(red, either));
  // …unless the text says one card in both colours at once, which is what
  // "multicolor" says (22-37 leans on the same reading).
  const both = parseFilter("a Red/Yellow multicolor card");
  assert.ok(matches({ ...DEFS.V1, colors: ["Red", "Yellow"] }, both));
  assert.ok(!matches({ ...DEFS.V1, colors: ["Red"] }, both));

  // 20-21: a cost change may carry a duration like anything else, and
  // anchoring the pattern to the end of the raw clause missed every one.
  assert.deepEqual(
    compileSkill(parseSkills("[Auto] When you play this card, reduce the combo cost of blue, yellow ≪Universe 6≫ cards in your hand by 1 for the duration of the turn.")[0]).unsupported,
    [],
  );
}

{
  // Three areas a target phrase could name and the parser could not hear.
  // None of these was ever reported: the clause compiled, it just looked in
  // the wrong place — found by checking each compiled `choose` against the
  // clause its own `reason` records.

  // "In your opponent's Drop" was the one possessive the Drop line did not
  // admit, so the phrase fell through to the Battle Area and chose a card in
  // play instead of one in the Drop.
  const theirDrop = parseTarget("up to 1 Battle Card in your opponent's Drop");
  assert.equal(theirDrop?.area, "drop");
  assert.equal(theirDrop?.side, "opponent");

  // The adjectives between the possessive and "energy" include a slash.
  assert.equal(parseTarget("up to 1 of your Red/Blue multicolor energy")?.area, "energy");
  assert.equal(parseTarget("up to 1 of your Blue/Yellow multicolor energy")?.area, "energy");

  // A pair of areas behind a possessive: "in **your opponent's** Battle Area
  // or Drop" put the possessive where the first area word was expected.
  const pair = parseTarget("up to 1 Battle Card in your opponent's Battle Area or Drop");
  assert.deepEqual(pair?.areas, ["battle", "drop"]);
  assert.equal(pair?.side, "opponent");
  // …and the form without one still reads.
  assert.deepEqual(parseTarget("up to 1 card in your hand or Drop Area")?.areas, ["hand", "drop"]);
}

{
  // Ground rule 5 done mechanically: a measure the clause names and the filter
  // does not carry *widens* the selection. Found by checking every compiled
  // `choose` against the clause its own `reason` records.

  // "2 non-black Battle Cards in your opponent's Drop Area" chose black ones
  // as happily as any other — and worse, `filterFor` threw the whole filter
  // away, because "narrows" did not count a measure that says what a card
  // must *not* be.
  const notBlack = parseFilter("2 non-black Battle Cards");
  assert.deepEqual(notBlack.notColors, ["Black"]);
  assert.deepEqual(notBlack.colors, [], "the colour is not also read as one the card must have");
  assert.ok(matches({ ...DEFS.V1, colors: ["Red"] }, notBlack));
  assert.ok(!matches({ ...DEFS.V1, colors: ["Black"] }, notBlack));
  assert.ok(parseTarget("up to 2 non-black Battle Cards in your opponent's Drop")?.filter, "…and the filter survives");

  // "A blue non-[Super Combo] Battle Card": read off the printed skills, which
  // is what the wording is about.
  const notCombo = parseFilter("blue non-[super combo] Battle Card");
  assert.deepEqual(notCombo.notKeywords, ["Super Combo"]);
  assert.ok(!matches({ ...DEFS.V1, colors: ["Blue"], skill: "[Super Combo]" }, notCombo));
  assert.ok(matches({ ...DEFS.V1, colors: ["Blue"], skill: "[Blocker]" }, notCombo));

  // 19-1-5: "non-token" is the other way round, and has to be read before the
  // token name — otherwise it is a token called "non".
  const notToken = parseFilter("your opponent's non-token Battle Cards");
  assert.ok(notToken.notToken);
  assert.deepEqual(notToken.names, [], 'not a token named "non"');
  assert.ok(!matches({ ...DEFS.V1, type: "TOKEN" }, notToken));
}

{
  // 20-14: one rule the sets print three ways, and only the first was read.
  const read = (text: string) => compileSkill(parseSkills(text)[0]);
  for (const text of [
    "[Permanent] Only 1 {Speedy Entrance Cheelai} can be played in your Battle Area.",
    "[Permanent] You can only have up to 1 {Speedy Entrance Cheelai} in play in your Battle Area.",
    "[Permanent] Only 1 copy of this card can be played in your Battle Area.",
  ]) {
    const sc = read(text);
    assert.deepEqual(sc.unsupported, [], text);
    assert.equal(sc.ops[0].op, "if");
  }
  // "Copies of **this card**" is the card's own name, which only the instance
  // knows — and it has to be read before the general form, which would take
  // "copy of this card" for a description of the cards and fail on it.
  const copies = read("[Permanent] Only 1 copy of this card can be played in your Battle Area.");
  assert.equal(describeScript(copies.ops, { permanent: true }), "if there are 1 or more cards in your battle: you can't play another copy of this card");

  // 20-12-3: a search of *their* deck is theirs to shuffle afterwards.
  assert.deepEqual(read("[Auto] When you play this card, your opponent shuffles their deck.").ops, [{ op: "shuffle", side: "opponent" }]);

  // "During **that** turn" is the turn the sentence has been talking about.
  assert.deepEqual(read("[Auto] When you play this card, this card gets +5000 power during that turn.").unsupported, []);
}

{
  // 20-16: "your opponent may choose 1 of their Battle Cards and KO it. If
  // they don't, draw 2 cards." The offer is *theirs* to decline, and the
  // clause after it reads their answer — 27 clauses said "if they don't" and
  // had nothing to be the opposite of, because `may` only knew one decider.
  DEFS.THEIRCHOICE = {
    ...DEFS.V1,
    id: "THEIRCHOICE",
    name: "THEIRCHOICE",
    energyCost: 1,
    skill: "[Auto] When you play this card, your opponent may choose 1 of their Battle Cards and KO it. If they don't, draw 2 cards.",
  };
  const compiled = compileSkill(parseSkills(DEFS.THEIRCHOICE.skill!)[0]);
  assert.deepEqual(compiled.unsupported, []);
  assert.equal(compiled.ops[0].op, "may");
  assert.equal((compiled.ops[0] as { chooser?: string }).chooser, "opponent");
  assert.equal(describeScript(compiled.ops).startsWith("your opponent may:"), true);

  const start = () => {
    // Two of theirs, so the pick is a real choice and they make it (5-2).
    const g = arena({ hand: ["THEIRCHOICE"], energy: ["V1"], oppBattle: ["V-BLUE", "BIG"] });
    return play(g, { type: "play", player: "p1", card: find(g, "p1", "hand", "THEIRCHOICE") });
  };

  // They are the ones asked, on your turn, about their own cards.
  const s = start();
  assert.equal(s.prompt.kind, "chooseMode");
  assert.equal(s.prompt.player, "p2", "20-16: whoever the card says may, decides");
  const mine = s.players.p1.hand.length;
  const victim = s.players.p2.battle[0];

  // Taking the offer: they pick which of their cards dies, and you draw nothing.
  const took = play(s, { type: "chooseMode", player: "p2", index: 0 }, { type: "choose", player: "p2", cards: [victim] });
  assert.ok(!took.players.p2.battle.includes(victim), "they gave up the card they chose");
  assert.equal(took.players.p1.hand.length, mine, "…so the other half did not happen");
  assertConsistent(took);

  // Declining: the card lives and the "if they don't" half fires.
  const left = play(s, { type: "chooseMode", player: "p2", index: 1 });
  assert.ok(left.players.p2.battle.includes(victim), "nothing was KO'd");
  assert.equal(left.players.p1.hand.length, mine + 2, "…and you drew 2 instead");
  assertConsistent(left);
}

{
  // 22-13: a [Union-Fusion] asks for two characters at once, and the board and
  // the move list answer one card at a time — so the minimum is owed on the
  // *last* answer, not on every one. Checking it on each made the prompt
  // unanswerable: a single card was the only thing on the menu, and the engine
  // threw on it. Found by the fuzzer the day a deck with BT6-001 was added.
  DEFS.FUSER = {
    ...DEFS.V1,
    id: "FUSER",
    name: "FUSER",
    energyCost: 3,
    skill: "[Union-Fusion]{r}: <V1> <UNI-B>",
  };
  DEFS["UNI-B"] = { ...DEFS.V1, id: "UNI-B", name: "UNI-B", characters: ["UNI-B"] };
  let s = arena({ hand: ["FUSER", "V1", "UNI-B"], energy: ["V1", "V1", "V1"] });
  const fuser = find(s, "p1", "hand", "FUSER");
  const offer = acts(s).find((a) => a.type === "activate" && a.card === fuser);
  assert.ok(offer, "22-13: the Union is offered when both characters are in hand");
  s = play(s, offer!);
  assert.equal(s.prompt.kind, "chooseCards");
  // One card at a time, and the first answer must not be refused for being one.
  const first = (s.prompt as { choice: { candidates: string[] } }).choice.candidates[0];
  s = play(s, { type: "choose", player: "p1", cards: [first] });
  assert.equal(s.prompt.kind, "chooseCards", "it asks again for the second");
  const second = (s.prompt as { choice: { candidates: string[] } }).choice.candidates[0];
  s = play(s, { type: "choose", player: "p1", cards: [second] });
  assertConsistent(s);
}

{
  // ------------------------------------------------------------------------
  // Three ways a target phrase was read as naming a card it does not name.
  // All three compiled cleanly, so no gap report ever mentioned them; they
  // were found by comparing each program with the clause it came from (§5.3b).
  // ------------------------------------------------------------------------

  // 1. The oldest sets drop the possessive: "choose up to 1 **opponent**
  // Battle Card" (BT1-036, BT1-082, BT1-090/091/094, BT2-041/068/083/085,
  // BT3-096, EX01-06/07, EX02-02/04, P-006 — sixteen skills). Read as naming
  // no side, every one of them chose *your own* card and KO'd, rested or
  // returned it — the opposite of what the card says (5-2, 9-6).
  const oppSel = (phrase: string) => parseTarget(phrase)?.side;
  assert.equal(oppSel("up to 1 opponent Battle Card with an energy cost of 2 or less"), "opponent");
  assert.equal(oppSel("up to 2 opponent Rest Mode Battle Cards"), "opponent");
  assert.equal(oppSel("up to 1 opponent's Battle Card in Rest Mode"), "opponent", "the bare possessive too");
  assert.equal(oppSel("up to 1 of an opponent's Battle Cards"), "opponent");
  assert.equal(oppSel("up to 1 of your opponent's Battle Cards"), "opponent", "the modern wording still reads");
  assert.equal(oppSel("up to 1 of your Battle Cards"), "you", "and yours is still yours");
  assert.equal(oppSel("1 card in your hand"), "you");

  // A possessive after the source names a destination or a measure, not the
  // cards selected from the source area.
  assert.equal(oppSel("up to 1 card from your deck to your opponent's Battle Area"), "you");
  assert.equal(oppSel("up to 1 of your opponent's Rest Mode Battle Cards"), "opponent");
  assert.equal(oppSel("up to 1 Battle Card in your opponent's Battle Area"), "opponent");
  for (const number of ["DB1-059", "EX08-06"]) {
    const target = parseTarget("up to 1 of your opponent's Battle Cards with an energy cost greater than or equal to your opponent's energy");
    assert.equal(target?.area, "battle", `${number}: the comparison is not an energy area`);
    assert.equal(target?.side, "opponent", `${number}: the source Battle Card belongs to the opponent`);
  }

  // 2. "**Other than** this card" names the one card the target is not, and
  // "this card's power" is a measure of some other card. `refFor` tested only
  // whether the words appeared, so both read as this card: "play up to 1
  // ≪Demon Clan≫ card among them other than copies of this card" (BT11-107,
  // BT17-036, EX13-26, EX14-03) played this card, which is already in play.
  const opsOf = (text: string) => compileSkill(parseSkills(text)[0]);
  const otherThan = opsOf("[Activate: Main] Add up to 1 card from your Drop Area other than this card to your hand.");
  assert.deepEqual(otherThan.unsupported, []);
  assert.equal((otherThan.ops[0] as { op: string }).op, "choose", "it is a choice among the Drop, not this card");
  assert.ok(!JSON.stringify(otherThan.ops).includes('"special":"self"'));
  const measure = opsOf("[Activate: Main] Return up to 1 of your opponent's Battle Cards with power less than or equal to this card's power to their hand.");
  assert.deepEqual(measure.unsupported, []);
  assert.equal((measure.ops[0] as { op: string; sel: { side: string } }).sel.side, "opponent");
  // …but a possessive in the *head* of the phrase is about this card, and an
  // "other" qualifying something else must not disarm the test either.
  const own = opsOf("[Permanent] This card's skills can't be negated in any area.");
  assert.ok(JSON.stringify(own.ops).includes('"special":"self"'), "9-1-5: this card's own skills");
  const notThisCard = opsOf("[Permanent] You can't play this card from any area with skills other than [Revive Blue/Green].");
  assert.ok(JSON.stringify(notThisCard.ops).includes('"special":"self"'), "a bare 'other' does not make it another card");

  // 3. "Cards chosen with this card's skill can't be switched to Active Mode"
  // (P-137, XD1-06, XD1-01) is the long way of saying "the chosen cards", and
  // it used to put the restriction on the card printing it.
  const chosen = opsOf(
    "[Activate: Main] Choose up to 1 of your opponent's Battle Cards in Rest Mode. Cards chosen with this card's skill can't be switched to Active Mode until the end of your opponent's next turn.",
  );
  assert.deepEqual(chosen.unsupported, []);
  assert.ok(JSON.stringify(chosen.ops).includes('"forbid"'));
  assert.ok(!JSON.stringify(chosen.ops.slice(2)).includes('"special":"self"'), "the restriction lands on the choice");
}

{
  // A colour word inside a card *name* is not the card's colour. ≪Red Ribbon
  // Army≫, <Goku Black>, <Commander Red>, {Super Saiyan Blue Vegeta} and
  // [Revive Blue/Green] all carry one, and `parseFilter` read it as if the
  // text had said so. While several colours meant "all of them" such a filter
  // merely matched nothing; since they mean "either" it selects the extra
  // colour as well — the same mis-read, turned from a missing effect into a
  // wrong one (ground rule 5). 39 selectors and one [Auto] trigger.
  const f = (text: string) => parseFilter(text);
  assert.deepEqual(f("blue ≪Red Ribbon Army≫ card").colors, ["Blue"]);
  assert.deepEqual(f("blue <Goku Black> card").colors, ["Blue"]);
  assert.deepEqual(f("blue <Commander Red> card").colors, ["Blue"]);
  assert.deepEqual(f("yellow {Super Saiyan Blue Vegeta}").colors, ["Yellow"]);
  assert.deepEqual(f("Battle Card with the [Revive Blue/Green] skill").colors, []);
  assert.deepEqual(f("your ≪Saiyan≫ cards with [Arrival Red/Green]").colors, []);
  // The alternatives the sets really do print are still read as either.
  assert.deepEqual(f("blue or green ≪Android≫ card").colors, ["Blue", "Green"]);
  assert.deepEqual(f("red and/or black ≪Saiyan≫ cards").colors, ["Red", "Black"]);
  // "Multicolor" is the one wording that means one card in both colours at
  // once, and its slash sits inside no bracket.
  const both = f("Blue/Green multicolor card in your energy");
  assert.deepEqual(both.colors, ["Blue", "Green"]);
  assert.equal(both.multiColor, true);
  assert.equal(matches({ ...DEFS.V1, colors: ["Blue"] }, both), false, "one of the two is not multicolor");
  assert.equal(matches({ ...DEFS.V1, colors: ["Blue", "Green"] }, both), true);
  assert.equal(matches({ ...DEFS.V1, colors: ["Blue"] }, f("blue or green card")), true, "…but either is enough without it");
  assert.equal(matches({ ...DEFS.V1, colors: ["Green"] }, f("blue or green card")), true);
  assert.equal(matches({ ...DEFS.V1, colors: ["Yellow"] }, f("blue or green card")), false);
  // A colour the card must *not* have is read off the same text, so it must
  // not be harvested from a name either.
  assert.deepEqual(f("non-black Battle Card").notColors, ["Black"]);
  assert.deepEqual(f("blue non-<Commander Red> ≪Red Ribbon Army≫ card").notColors, []);

  // "and/or" ends a name list as often as "and" does, and the comma before it
  // was read as a sentence break — which cost BT7-092 its whole skill.
  assert.deepEqual(splitClauses("choose up to 2 ≪Saiyan≫, ≪Earthling≫, and/or ≪God≫ cards in your opponent's Battle Area and switch them to Rest Mode"), [
    "choose up to 2 ≪Saiyan≫, ≪Earthling≫, and/or ≪God≫ cards in your opponent's Battle Area",
    "switch them to Rest Mode",
  ]);
}

{
  // The engine assertion behind the first of those: the bare wording has to
  // offer *their* card. A compile assertion alone would not have caught the
  // side being wrong, because the program compiled cleanly either way.
  DEFS["OLD-KILL"] = { ...DEFS.V1, id: "OLD-KILL", name: "OLD-KILL", energyCost: 1, skill: "[Auto] When you play this card, choose up to 1 opponent Battle Card and KO that card." };
  let s = arena({ hand: ["OLD-KILL"], energy: ["V1", "V1"], battle: ["BIG"], oppBattle: ["V-BLUE"] });
  const mine = find(s, "p1", "battle", "BIG");
  const theirs = find(s, "p2", "battle", "V-BLUE");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "OLD-KILL") });
  assert.equal(s.prompt.kind, "chooseCards");
  const offered = (s.prompt as { choice: { candidates: string[] } }).choice.candidates;
  assert.ok(offered.includes(theirs), "5-2: the opponent's card is the one on offer");
  assert.ok(!offered.includes(mine), "…and yours is not");
  s = play(s, { type: "choose", player: "p1", cards: [theirs] });
  assert.ok(s.players.p1.battle.includes(mine), "your own card survives");
  assertConsistent(s);
}

{
  // Refusing to *resolve* to this card is only half of "other than this card":
  // read as nothing, the phrase still offered this card among the candidates,
  // so BT21-023's "choose all Battle Cards other than this card, and they get
  // -15000 power" shrank the card printing it too.
  const sel = parseTarget("all Battle Cards other than this card");
  assert.equal(sel?.notSelf, "card");
  assert.equal(parseTarget("up to 1 ≪Demon Clan≫ card among them other than copies of this card")?.notSelf, "copies");
  assert.equal(parseTarget("up to 1 of your Battle Cards")?.notSelf, undefined);

  DEFS["SHRINK"] = {
    ...DEFS.V1,
    id: "SHRINK",
    name: "SHRINK",
    energyCost: 1,
    power: 20000,
    skill: "[Auto] When you play this card, choose all Battle Cards other than this card, and they get -15000 power for the turn.",
  };
  let s = arena({ hand: ["SHRINK"], energy: ["V1", "V1"], battle: ["BIG"], oppBattle: ["V-BLUE"] });
  const big = find(s, "p1", "battle", "BIG");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "SHRINK") });
  const self = s.players.p1.battle.find((id) => s.cards[id].cardId === "SHRINK")!;
  assert.equal(powerOf(CTX, s, big), 25000 - 15000, "every other Battle Card is shrunk");
  assert.equal(powerOf(CTX, s, self), 20000, "…and the card that said so is not");
  assertConsistent(s);
}

{
  // Two wordings off the deck-scoped miss list, both a measure short.

  // "…with an energy cost of 1 **and no keyword skills**" (BT29-001, P-246/7/9,
  // XD1-08, SD15-01 and six more). The "and" was cutting the sentence, and the
  // measure had no field to land in — so on the five cards that did compile,
  // the choice was offered every card in the area (ground rule 5).
  const f = parseFilter("red Extra Card with an energy cost of 1 and no keyword skills");
  assert.equal(f.noKeywords, true);
  assert.equal(f.costMax ?? f.costMin, 1);
  assert.equal(parseFilter("red Extra Card with an energy cost of 1").noKeywords, false);
  assert.deepEqual(splitClauses("add up to 1 red Extra Card with an energy cost of 1 and no keyword skills from your Drop Area to your hand"), [
    "add up to 1 red Extra Card with an energy cost of 1 and no keyword skills from your Drop Area to your hand",
  ]);
  // It is about the keywords only: a card with an [Auto] and no keyword still
  // qualifies, which is what separates it from "skill-less".
  assert.equal(matches({ ...DEFS.V1, skill: "[Auto] When you play this card, draw 1 card." }, f), false, "the cost is wrong, not the keywords");
  assert.equal(matches({ ...DEFS.V1, type: "EXTRA", colors: ["Red"], energyCost: 1, skill: "[Auto] When you play this card, draw 1 card." }, f), true);
  assert.equal(matches({ ...DEFS.V1, type: "EXTRA", colors: ["Red"], energyCost: 1, skill: "[Blocker]" }, f), false, "a keyword disqualifies it");

  // "For the duration of **this** turn" (BT3-013, BT1-003) is the same
  // duration as "for the duration of the turn", one demonstrative apart, and
  // `TRAILING_QUALIFIER` knew only the article — so the pattern behind it,
  // which anchors on `$`, never matched.
  const combo = compileSkill(parseSkills("[Auto] When you combo with this card, this card gains +10000 combo power for the duration of this turn.")[0]);
  assert.deepEqual(combo.unsupported, []);
  assert.deepEqual(combo.ops, [{ op: "comboPower", target: { sel: { special: "self" } }, amount: 10000, until: "turn" }]);
}

{
  // ------------------------------------------------------------------------
  // Two "and"s that join halves of one instruction, not two instructions.
  // ------------------------------------------------------------------------

  // A numeric range. Cut, the *left* half compiled — "an energy cost between
  // 3" fell through to the plain `energy cost N` pattern and came out as
  // exactly 3, a bound narrower than anything the card says — while the "7
  // from your deck to your hand" it left behind failed the whole skill.
  assert.deepEqual(splitClauses("Add up to 1 black Battle Card with an energy cost between 3 and 7 from your Warp to your hand"), [
    "Add up to 1 black Battle Card with an energy cost between 3 and 7 from your Warp to your hand",
  ]);
  const range = parseFilter("black Battle Card with an energy cost between 3 and 7");
  assert.equal(range.costMin, 3);
  assert.equal(range.costMax, 7);
  // The sets write the same range for power, and in the plural.
  const pow = parseFilter("black Battle Cards with powers between 20000 and 30000");
  assert.equal(pow.powerMin, 20000);
  assert.equal(pow.powerMax, 30000);
  assert.equal(parseFilter("Battle Cards with power between 30000 and 35000").powerMax, 35000);
  // …and an exact power is still an exact power.
  assert.equal(parseFilter("a yellow <Son Goku> card with 5000 power").powerMin, 5000);

  // "Switch this card **and** up to 1 of your energy to Active Mode" (1-10) —
  // one verb and one mode shared by two targets, on eleven cards. Keeping it
  // whole is only half the job: `refFor` collapsed it to this card and left
  // the energy standing, which is why the pattern reads `refsFor` now.
  assert.deepEqual(splitClauses("Switch this card and up to 1 of your energy to Active Mode"), ["Switch this card and up to 1 of your energy to Active Mode"]);
  const both = compileSkill(parseSkills("[Auto] When you play this card, switch this card and up to 1 of your energy to Active Mode.")[0]);
  assert.deepEqual(both.unsupported, []);
  assert.deepEqual(
    both.ops.map((o) => o.op),
    ["switchMode", "choose", "switchMode"],
    "this card switches, and the energy is chosen first (5-2)",
  );
  assert.deepEqual((both.ops[0] as { target: { sel: { special: string } } }).target.sel.special, "self");

  // The guard is deliberately narrow, and these are the counter-examples that
  // decide its shape. A real sentence break after the same words still splits…
  assert.equal(splitClauses("Switch this card to Active Mode and draw 1 card").length, 2);
  assert.equal(splitClauses("Switch this card and draw 1 card").length, 2, "no mode at the end of the second half");
  // …and "choose this card and all of your Battle Cards" is left alone on
  // purpose: the choose pattern reads one target, so keeping it whole would
  // lose the second half in silence instead of failing. Fragment now, wrong
  // effect if this assertion ever flips without the pattern changing too.
  assert.equal(splitClauses("Choose this card and all of your non-black Battle Cards").length, 2);
}

{
  // The engine assertion behind the switch: both targets really move. The
  // compile assertion above cannot see that the second one is applied.
  DEFS["RESTER"] = {
    ...DEFS.V1,
    id: "RESTER",
    name: "RESTER",
    energyCost: 1,
    skill: "[Auto] When you play this card, switch this card and up to 1 of your energy to Rest Mode.",
  };
  let s = arena({ hand: ["RESTER"], energy: ["V1", "V1", "V1"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "RESTER") });
  const self = s.players.p1.battle.find((id) => s.cards[id].cardId === "RESTER")!;
  assert.equal(s.cards[self].mode, "rest", "1-10: this card is switched");
  assert.equal(s.prompt.kind, "chooseCards", "…and the energy is a choice of its own");
  const energy = (s.prompt as { choice: { candidates: string[] } }).choice.candidates;
  assert.ok(
    energy.every((id) => s.players.p1.energy.includes(id)),
    "the candidates are your energy",
  );
  s = play(s, { type: "choose", player: "p1", cards: [energy[0]] });
  assert.equal(s.cards[energy[0]].mode, "rest", "…and it is switched too");
  assertConsistent(s);
}

{
  // ------------------------------------------------------------------------
  // 8-1-1 lifted: "This card can attack Battle Cards in Active Mode". The one
  // rule of the game a card may turn off, and the largest wording left in the
  // prohibition family — 48 clauses.
  // ------------------------------------------------------------------------
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const plain = one("[Permanent] This card can attack Battle Cards in Active Mode.");
  assert.deepEqual(plain.unsupported, []);
  assert.equal((plain.ops[0] as { op: string }).op, "permit");
  assert.equal((plain.ops[0] as { what: string }).what, "attackActive");
  assert.equal((plain.ops[0] as { filter: { type: string } }).filter.type, "BATTLE");

  // "…**without [Barrier]** in Active Mode" carves an exception out, and a
  // permission read too widely allows an attack the card forbids — so the
  // keyword has to reach the filter (16 of the 48 print it).
  const barrier = one("[Permanent] This card can attack Battle Cards without [Barrier] in Active Mode.");
  assert.deepEqual(barrier.unsupported, []);
  assert.deepEqual((barrier.ops[0] as { filter: { notKeywords: string[] } }).filter.notKeywords, ["Barrier"]);

  // The sentence is usually the second half of one about power, so the subject
  // is in the clause before it — and "that are in Active Mode" is the same
  // thing said longer.
  const tail = one("[Activate: Main] This card gets +10000 power and can attack Battle Cards that are in Active Mode for the duration of the turn.");
  assert.deepEqual(tail.unsupported, []);
  assert.deepEqual(
    tail.ops.map((o) => o.op),
    ["power", "permit"],
  );
  assert.equal((tail.ops[1] as { until: string }).until, "turn");

  // A prohibition with no subject continues the clause before it too:
  // "it gets +10000 power and can't attack for the turn" (DB2-004).
  const cant = one("[Auto] When this card attacks, switch this card to Active Mode, then it gets +10000 power and can't attack for the turn.");
  assert.deepEqual(cant.unsupported, []);
  assert.ok(JSON.stringify(cant.ops).includes('"forbid"'));

  // The plural of a card type is the same type. Anchored with a trailing \b,
  // "Battle Card" did not match "Battle **Cards**", so a phrase whose only
  // measure was the type set none at all and selected the whole area.
  assert.equal(parseFilter("your opponent's Battle Cards").type, "BATTLE");
  assert.equal(parseFilter("your opponent's Unisons").type, "UNISON");
  assert.equal(parseFilter("skill-less Battle Cards from your Drop Area").type, "BATTLE");
  // …but two kinds in one phrase cannot both be held, so neither is: taking
  // the first would drop the other half in silence. "Battle Cards or Unison
  // Cards" was coming out as UNISON alone.
  assert.equal(parseFilter("your opponent's Battle Cards or Unison Cards").type, null);
  assert.equal(parseFilter("your opponent's Battle Cards or Unisons").type, null);
  assert.equal(parseFilter("non-Leader card under this card").notType, "LEADER", "the negative still reads");
}

{
  // The engine assertion: the permission has to reach `legalActions`, and the
  // carve-out has to hold. 8-1-1 otherwise allows an attack only against a
  // Leader, a Unison, or a *rested* Battle Card.
  DEFS["ACTIVE-HUNTER"] = { ...DEFS.V1, id: "ACTIVE-HUNTER", name: "ACTIVE-HUNTER", energyCost: 1, power: 20000, skill: "[Permanent] This card can attack Battle Cards in Active Mode." };
  DEFS["PICKY-HUNTER"] = {
    ...DEFS.V1,
    id: "PICKY-HUNTER",
    name: "PICKY-HUNTER",
    energyCost: 1,
    power: 20000,
    skill: "[Permanent] This card can attack Battle Cards without [Barrier] in Active Mode.",
  };
  DEFS["WALL"] = { ...DEFS.V1, id: "WALL", name: "WALL", energyCost: 1, power: 5000, skill: "[Barrier]" };

  const s = arena({ battle: ["ACTIVE-HUNTER", "PICKY-HUNTER", "V1"], oppBattle: ["V-BLUE", "WALL"] });
  const target = find(s, "p2", "battle", "V-BLUE");
  const walled = find(s, "p2", "battle", "WALL");
  assert.equal(s.cards[target].mode, "active", "the opponent's card is in Active Mode");
  const attacks = acts(s).filter((a) => a.type === "attack") as { attacker: string; target: string }[];
  const from = (cardId: string) => attacks.filter((a) => s.cards[a.attacker].cardId === cardId).map((a) => a.target);

  assert.ok(from("ACTIVE-HUNTER").includes(target), "8-1-1 is lifted for the card that says so");
  assert.ok(!from("V1").includes(target), "…and only for that card");
  assert.ok(from("PICKY-HUNTER").includes(target), "the carve-out still allows the ordinary case");
  assert.ok(!from("PICKY-HUNTER").includes(walled), "…but not a [Barrier] card, which the text excludes");
  assert.ok(from("ACTIVE-HUNTER").includes(walled), "22-16 is about being chosen by a skill, not attacked");
  // The Leader is attackable by everyone, as always.
  assert.ok(from("V1").includes(s.players.p2.leader));
}

{
  // ------------------------------------------------------------------------
  // Ground rule 5's second named widening, closed: a keyword the target must
  // *have*. Dropped, "up to 1 opponent Battle Card with [Blocker]" chose any
  // card in the area — 83 selectors did.
  // ------------------------------------------------------------------------
  const f = (text: string) => parseFilter(text);
  assert.deepEqual(f("opponent Battle Card with [Blocker]").keywords, ["Blocker"]);
  assert.deepEqual(f("yellow ≪Demon Realm≫ card with an [Evolve] skill").keywords, ["Evolve"]);
  assert.deepEqual(f("your yellow Unison Cards with [Rejuvenate] in its skill text").keywords, ["Rejuvenate"]);
  // The bare family name: "[Union]" means any of the three variants, and
  // `keywordOf` only reads the hyphenated forms the tag is printed with.
  assert.deepEqual(f("your black Battle Cards with a [union] skill").keywords, ["Union"]);
  // A *kind* of skill is not a keyword, and is the one shape keywordOf cannot
  // answer: "mono-blue Battle Cards with a [Counter] skill".
  assert.equal(f("mono-blue Battle Cards with a [Counter] skill").skillKind, "counter");
  assert.equal(f("an Extra Card with the [Activate: Main] skill").skillKind, "activate");
  assert.deepEqual(f("mono-blue Battle Cards with a [Counter] skill").keywords, []);
  // Anything else in brackets makes the description unreadable rather than
  // wider — [Sparking 7] is a numeric validity condition, not a keyword.
  assert.equal(f("≪Universe 7≫ card with a [Sparking 7] skill").unreadable, true);
  assert.equal(f("blue ≪Android≫ card").unreadable, false);
  // "Without [X]" and "non-[X]" stay the opposite of all this.
  assert.deepEqual(f("Battle Cards without [Barrier]").notKeywords, ["Barrier"]);
  assert.deepEqual(f("Battle Cards without [Barrier]").keywords, []);

  assert.equal(matches({ ...DEFS.V1, skill: "[Blocker]" }, f("Battle Card with [Blocker]")), true);
  assert.equal(matches({ ...DEFS.V1, skill: "[Critical]" }, f("Battle Card with [Blocker]")), false, "the requirement narrows");
  assert.equal(matches({ ...DEFS.V1, skill: "[Counter: Attack] Negate the attack." }, f("Battle Card with a [Counter] skill")), true);
  assert.equal(matches({ ...DEFS.V1, skill: "[Auto] When you play this card, draw 1 card." }, f("Battle Card with a [Counter] skill")), false);

  // An unreadable description fails the clause rather than selecting the whole
  // area — the difference between `null` and `undefined` out of `filterFor`.
  const sparking = compileSkill(parseSkills("[Activate: Main] Play up to 1 red ≪Universe 7≫ card with a [Sparking 7] skill from your Drop.")[0]);
  assert.equal(sparking.unsupported.length, 1, "9-1: an unread description is an honest gap, not a wide selection");
  const readable = compileSkill(parseSkills("[Activate: Main] Play up to 1 red ≪Universe 7≫ card with a [Blocker] skill from your Drop.")[0]);
  assert.deepEqual(readable.unsupported, []);

  // The measure survives the "and" that used to cut it off: "with an energy
  // cost of 3 and an [EX-Evolve] skill" was losing its second half.
  assert.deepEqual(splitClauses("play up to 1 Battle Card from your deck with an energy cost of 3 and an [EX-Evolve] skill"), [
    "play up to 1 Battle Card from your deck with an energy cost of 3 and an [EX-Evolve] skill",
  ]);
}

{
  // The engine assertion: a required keyword really narrows what is offered.
  DEFS["BLOCK-HUNTER"] = {
    ...DEFS.V1,
    id: "BLOCK-HUNTER",
    name: "BLOCK-HUNTER",
    energyCost: 1,
    skill: "[Auto] When you play this card, choose up to 1 opponent Battle Card with [Blocker] and KO that card.",
  };
  let s = arena({ hand: ["BLOCK-HUNTER"], energy: ["V1", "V1"], oppBattle: ["BLOCKER", "V-BLUE"] });
  const blocker = find(s, "p2", "battle", "BLOCKER");
  const plain = find(s, "p2", "battle", "V-BLUE");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "BLOCK-HUNTER") });
  assert.equal(s.prompt.kind, "chooseCards");
  const offered = (s.prompt as { choice: { candidates: string[] } }).choice.candidates;
  assert.ok(offered.includes(blocker), "the [Blocker] card is on offer");
  assert.ok(!offered.includes(plain), "…and the one without it is not");
  assertConsistent(s);
}

{
  // BT7-129: "areas other than your deck, hand, or life" (20-1-6)
  // The area list is inverted into the complement over ALL_AREAS, rather than
  // matching "your deck" and searching the exact areas the text excludes.
  const sk = parseSkills(
    "[Permanent] If you have any non-black cards in areas other than your deck, hand, or life, you can't play this card from any area."
  )[0];
  const compiled = compileSkill(sk);
  assert.equal(compiled.unsupported.length, 0);
  const reading = describeScript(compiled.ops, { permanent: true });
  assert.ok(reading.includes("in your leader or battle or unison or combo or energy or drop or warp or zDeck or zEnergy"));
  assert.ok(!reading.includes("in your deck"));

  // BT16-088: "non-<Zamasu> and non-<Goku Black>" Battle Cards for the game
  // Two negated names survive clause-splitting and merge into one filter carrying both exclusions,
  // with "for the game" parsed as until: "game".
  const sk2 = parseSkills(
    "[Activate: Main][Limit 1] If your Leader Card is a yellow ≪Shenron≫ <Zamasu> or yellow ≪Shenron≫ <Goku Black> card: Play this card from your Warp, and you can't play non-<Zamasu> and non-<Goku Black> Battle Cards for the game."
  )[0];
  const compiled2 = compileSkill(sk2);
  assert.equal(compiled2.unsupported.length, 0);
  const reading2 = describeScript(compiled2.ops);
  assert.ok(reading2.includes("non-<zamasu> non-<goku black> battle card for the rest of the game"));
}

{
  // s2-95: OR disjunction handling in condition clauses.
  // "If you have a green X or a yellow Y in play": a green X alone and a yellow Y alone
  // satisfy the disjunction; a green Y (combining one color with the other character) does not.
  DEFS["G-TRUNKS"] = { ...DEFS.V1, id: "G-TRUNKS", name: "G-TRUNKS", colors: ["Green"], characters: ["Trunks"] };
  DEFS["Y-VEGETA"] = { ...DEFS.V1, id: "Y-VEGETA", name: "Y-VEGETA", colors: ["Yellow"], characters: ["Vegeta"] };
  DEFS["G-VEGETA"] = { ...DEFS.V1, id: "G-VEGETA", name: "G-VEGETA", colors: ["Green"], characters: ["Vegeta"] };
  DEFS["OR-DRAWER"] = {
    ...DEFS.V1,
    id: "OR-DRAWER",
    name: "OR-DRAWER",
    skill: "[Activate: Main] If you have a green <Trunks> or a yellow <Vegeta> in play: Draw 1 card.",
  };

  const sGreenX = arena({ battle: ["OR-DRAWER", "G-TRUNKS"] });
  const sYellowY = arena({ battle: ["OR-DRAWER", "Y-VEGETA"] });
  const sGreenY = arena({ battle: ["OR-DRAWER", "G-VEGETA"] });

  const cardX = find(sGreenX, "p1", "battle", "OR-DRAWER");
  const cardY = find(sYellowY, "p1", "battle", "OR-DRAWER");
  const cardCross = find(sGreenY, "p1", "battle", "OR-DRAWER");

  assert.ok(canActivate(sGreenX, cardX), "a green X alone satisfies");
  assert.ok(canActivate(sYellowY, cardY), "a yellow Y alone satisfies");
  assert.ok(!canActivate(sGreenY, cardCross), "a green Y does not satisfy the disjunction");
}


