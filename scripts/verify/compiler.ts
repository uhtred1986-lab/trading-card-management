/**
 * The compiler and the interpreter: what a printed line becomes, and what the
 * engine then does with it.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import {
  CTX,
  DEFS,
  apply,
  arena,
  assertConsistent,
  autoTriggerMatches,
  cardNow,
  comboCostOf,
  compileSkill,
  describeScript,
  find,
  forbids,
  has,
  labels,
  legalActions,
  matches,
  move,
  parseFilter,
  parseSkills,
  play,
  playCost,
  powerOf,
  splitClauses,
} from "./harness";
import type { PlayerId } from "./harness";

// ── the effect compiler ────────────────────────────────────────────────────

{
  // Clause splitting keeps card names and traits, which contain commas, in one piece.
  assert.deepEqual(splitClauses("Choose 1 {Four-Star Ball, Parasitic Darkness} from your deck, then draw 1 card"), ["Choose 1 {Four-Star Ball, Parasitic Darkness} from your deck", "draw 1 card"]);
  assert.deepEqual(splitClauses("Draw 1 card and place 1 card from your hand at the bottom of your deck"), ["Draw 1 card", "place 1 card from your hand at the bottom of your deck"]);
  // 20-16: "if you do so" is the same connective as "if you do". Stripping the
  // phrase used to leave the "so" behind, which reads as a bare connective —
  // the condition vanished and the rest of the sentence happened regardless.
  assert.deepEqual(splitClauses("You may draw 1 card. If you do so, discard 1 card."), ["You may draw 1 card", "If you do", "discard 1 card"]);
  assert.deepEqual(splitClauses("Draw 1 card. If you did so, draw 1 more."), ["Draw 1 card", "If you did", "draw 1 more"]);

  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  const draw = one("[Auto] When this card attacks, draw 1 card.");
  assert.deepEqual(draw.unsupported, []);
  assert.deepEqual(draw.ops, [{ op: "draw", n: 1 }]);

  const ko = one("[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and KO it.");
  assert.deepEqual(ko.unsupported, []);
  assert.equal(ko.ops.length, 2);
  assert.equal(ko.ops[0].op, "choose");
  const koSel = (ko.ops[0] as { sel: { side: string; area: string; count: number; upTo: boolean } }).sel;
  assert.equal(koSel.side, "opponent");
  assert.equal(koSel.area, "battle");
  assert.equal(koSel.upTo, true);
  assert.equal(ko.ops[1].op, "ko");

  const pump = one("[Activate: Main] This card gets +5000 power for the battle.");
  assert.deepEqual(pump.ops, [{ op: "power", target: { sel: { special: "self" } }, amount: 5000, until: "battle" }]);

  const look = one("[Auto] When you play this card, look at up to 7 cards from the top of your deck, choose up to 1 card among them, place it in your energy in Rest Mode, then shuffle your deck.");
  assert.deepEqual(look.unsupported, []);
  assert.deepEqual(
    look.ops.map((o) => o.op),
    ["look", "choose", "moveTo", "shuffle"],
  );
  assert.equal((look.ops[2] as { to: string }).to, "energy");
  assert.equal((look.ops[2] as { mode: string }).mode, "rest");

  const grant = one("[Activate: Main] Choose up to 1 of your yellow Battle Cards and it gains [Blocker] for the turn.");
  assert.deepEqual(grant.unsupported, []);
  assert.equal(grant.ops[1].op, "grant");
  assert.deepEqual((grant.ops[1] as { keyword: { name: string } }).keyword, { name: "Blocker" });

  // Two conditions joined by "and" both have to hold — the second arrives
  // without a condition word in front of it, and used to be dropped.
  const twoConds = one("[Auto] When you combo with this card, if your Leader Card is yellow and your life is at 4 or less, draw 1 card.");
  assert.deepEqual(twoConds.unsupported, []);
  assert.deepEqual(twoConds.ops, [
    {
      op: "if",
      cond: { kind: "leaderMatches", filter: parseFilter("yellow") },
      then: [{ op: "if", cond: { kind: "life", side: "you", atMost: 4 }, then: [{ op: "draw", n: 1 }] }],
    },
  ]);

  // A keyword the engine handles itself is not "unreadable": the text after
  // the colon is the keyword's condition, which engine.ts reads for itself.
  assert.deepEqual(one("[Evolve]{2}: <Nail>").unsupported, []);
  assert.deepEqual(one("[Evolve]{2}: <Nail>").ops, []);

  // A comma between two names is not a sentence break.
  assert.deepEqual(splitClauses("choose 1 <Son Goku: GT>, <Trunks: GT>, or <Pan> with 15000 or less power"), ["choose 1 <Son Goku: GT>, <Trunks: GT>, or <Pan> with 15000 or less power"]);

  // A clause the parser cannot read marks the whole skill for the referee.
  const partial = one("[Auto] When you play this card, draw 1 card, then rearrange the stars in the sky.");
  assert.deepEqual(partial.unsupported, ["rearrange the stars in the sky"]);

  // The reading the inspector shows.
  assert.equal(describeScript(ko.ops), "choose up to 1 in opponent's battle, KO the chosen cards");
  assert.equal(describeScript(draw.ops), "draw 1");
}

// ── the interpreter ────────────────────────────────────────────────────────

// "When you play this card, draw 1 card" runs without asking anything.
{
  let s = arena({ hand: ["DRAWER"], energy: ["V1"] });
  const c = find(s, "p1", "hand", "DRAWER");
  const before = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: c });
  assert.equal(s.players.p1.hand.length, before - 1 + 1, "played one, drew one");
  assert.equal(s.prompt.kind, "main");
}

// "choose up to 1 of your opponent's Battle Cards and KO it" asks, then KOs.
{
  let s = arena({ hand: ["KILLER"], energy: ["V1"], oppBattle: ["V-BLUE", "BIG"] });
  const c = find(s, "p1", "hand", "KILLER");
  const victim = find(s, "p2", "battle", "BIG");
  s = play(s, { type: "play", player: "p1", card: c });
  assert.equal(s.prompt.kind, "chooseCards", "two candidates, so the choice is put to the player");
  assert.equal((s.prompt as { player: PlayerId }).player, "p1");
  assert.equal((s.prompt as { choice: { min: number } }).choice.min, 0, "up to N allows none");
  s = play(s, { type: "choose", player: "p1", cards: [victim] });
  assert.ok(s.players.p2.drop.includes(victim), "5-12: the chosen card is KO'd");
  assert.equal(s.prompt.kind, "main");
  assertConsistent(s);

  // "Up to 1" with a single candidate is still a real decision — taking it or
  // not are different outcomes — so it is put to the player (5-2-4).
  let single = arena({ hand: ["KILLER"], energy: ["V1"], oppBattle: ["BIG"] });
  single = play(single, { type: "play", player: "p1", card: find(single, "p1", "hand", "KILLER") });
  assert.equal(single.prompt.kind, "chooseCards");

  // A choice with no "up to" and exactly one candidate is forced, so it is taken silently (5-2-5).
  let t = arena({ hand: ["FORCEKILL"], energy: ["V1"], oppBattle: ["BIG"] });
  const only = find(t, "p2", "battle", "BIG");
  t = play(t, { type: "play", player: "p1", card: find(t, "p1", "hand", "FORCEKILL") });
  assert.equal(t.prompt.kind, "main", "a forced choice is not put to the player");
  assert.ok(t.players.p2.drop.includes(only));

  // Choosing nothing is allowed and KOs nothing.
  let u = arena({ hand: ["KILLER"], energy: ["V1"], oppBattle: ["V-BLUE", "BIG"] });
  u = play(u, { type: "play", player: "p1", card: find(u, "p1", "hand", "KILLER") }, { type: "choose", player: "p1", cards: [] });
  assert.equal(u.players.p2.battle.length, 2);
}

// [Barrier] (22-16) takes a card out of the opponent's choices.
{
  DEFS.BARRIER = { ...DEFS.BIG, id: "BARRIER", name: "BARRIER", skill: "[Barrier]" };
  let s = arena({ hand: ["KILLER"], energy: ["V1"], oppBattle: ["BIG"] });
  const shielded = find(s, "p2", "battle", "BIG");
  s.cards[shielded].cardId = "BARRIER";
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "KILLER") });
  assert.equal(s.prompt.kind, "main", "no legal target, so nothing was asked");
  assert.ok(s.players.p2.battle.includes(shielded), "22-16: not chosen by the opponent's skill");
}

// Tokens (19) are created with the stats the text spells out.
{
  let s = arena({ hand: ["SPAWN"], energy: ["V1"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "SPAWN") });
  const tokens = s.players.p1.battle.filter((id) => s.cards[id].isToken);
  assert.equal(tokens.length, 2, "two tokens entered the Battle Area");
  assert.equal(powerOf(CTX, s, tokens[0]), 10000);
  assertConsistent(s);
  // 19-1-7: a token that would leave play is removed from the game instead.
  const t0 = tokens[0];
  s.cards[t0].mode = "rest";
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s.effects.push({ id: 999, target: s.players.p2.leader, kind: "power", value: 20000, until: "turn", ownerTurn: "p2", master: "p2", createdTurn: s.turn });
  s = play(s, { type: "attack", player: "p2", attacker: s.players.p2.leader, target: t0 }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.ok(s.players.p1.removed.includes(t0), "19-1-7: removed, not dropped");
  assertConsistent(s);
}

// A skill the compiler cannot read is skipped when no referee is available…
{
  let s = arena({ hand: ["MYSTERY"], energy: ["V1"] });
  const before = JSON.stringify(s.players.p2);
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "MYSTERY") });
  assert.equal(s.prompt.kind, "main", "the game carries on");
  assert.equal(JSON.stringify(s.players.p2), before, "and nothing happened to the opponent");
}

// …and put to the referee when one is, whose ruling is a program in this same language.
{
  const refCtx = { ...CTX, referee: true };
  let s = arena({ hand: ["MYSTERY"], energy: ["V1"] });
  s = apply(refCtx, s, { type: "play", player: "p1", card: find(s, "p1", "hand", "MYSTERY") }).state;
  assert.equal(s.prompt.kind, "referee");
  const req = (s.prompt as { request: { cardId: string; unsupported: string[] } }).request;
  assert.equal(req.cardId, "MYSTERY");
  assert.deepEqual(req.unsupported, ["bend the fabric of reality to your will"]);
  assert.deepEqual(legalActions(refCtx, s), [], "no player action is legal while the referee is being asked");
  const before = s.players.p1.hand.length;
  s = apply(refCtx, s, { type: "refereeRuling", player: "p1", ops: [{ op: "draw", n: 2 }] }).state;
  assert.equal(s.players.p1.hand.length, before + 2, "the ruling ran");
  assert.equal(s.prompt.kind, "main");
  // A malformed ruling is refused rather than trusted.
  let t = arena({ hand: ["MYSTERY"], energy: ["V1"] });
  t = apply(refCtx, t, { type: "play", player: "p1", card: find(t, "p1", "hand", "MYSTERY") }).state;
  assert.throws(() => apply(refCtx, t, { type: "refereeRuling", player: "p1", ops: [{ op: "delete-the-database" }] as never }), /valid effect program/);
  // An empty ruling means "nothing happens".
  t = apply(refCtx, t, { type: "refereeRuling", player: "p1", ops: [] }).state;
  assert.equal(t.prompt.kind, "main");
}

// ── costs the rules make optional or a matter of choice ────────────────────

// 3-8-2: which energy to rest is asked only when the colours left would differ.
{
  // A combo cost has no colour (5-6-1-1), so with two colours in energy there
  // is a real choice.
  let s = arena({ hand: ["BLOCKER"], energy: ["V1", "V-BLUE"], battle: ["V1"] });
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  const c = find(s, "p1", "hand", "BLOCKER");
  s = play(s, { type: "combo", player: "p1", card: c });
  assert.equal(s.prompt.kind, "payCost", "two colours, one generic cost: the player picks");
  const options = (s.prompt as { options: { rest: string[] }[] }).options;
  assert.equal(options.length, 2);
  assert.ok(labels(s).some((x) => x.startsWith("Rest 1 Red")));
  assert.ok(labels(s).some((x) => x.startsWith("Rest 1 Blue")));
  const blue = options.findIndex((o) => o.rest.some((id) => s.cards[id].cardId === "V-BLUE"));
  s = play(s, { type: "payCost", player: "p1", option: blue });
  assert.equal(s.cards[find(s, "p1", "energy", "V-BLUE")].mode, "rest", "the blue energy was rested");
  assert.equal(s.cards[find(s, "p1", "energy", "V1")].mode, "active", "the red was kept");
  assert.ok(s.players.p1.combo.includes(c), "and the combo went through");
  assertConsistent(s);

  // One colour, so no question is asked.
  let mono = arena({ hand: ["BLOCKER"], energy: ["V1", "V1"], battle: ["V1"] });
  mono = play(mono, { type: "attack", player: "p1", attacker: mono.players.p1.leader, target: mono.players.p2.leader });
  mono = play(mono, { type: "combo", player: "p1", card: find(mono, "p1", "hand", "BLOCKER") });
  assert.equal(mono.prompt.kind, "combo", "identical energy, so nothing to decide");
}

// 9-6-4: an [Auto] skill's cost may be declined, and then it does not resolve.
{
  let s = arena({ hand: ["AUTOCOST"], energy: ["V1", "V1"] });
  const c = find(s, "p1", "hand", "AUTOCOST");
  const before = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: c });
  assert.equal(s.prompt.kind, "optionalCost");
  assert.equal((s.prompt as { describe: string }).describe, "1 Red energy");
  s = play(s, { type: "optionalCost", player: "p1", pay: false });
  assert.equal(s.players.p1.hand.length, before - 1, "declined, so no cards were drawn");
  assert.equal(s.players.p1.energy.filter((id) => s.cards[id].mode === "rest").length, 1, "only the play itself was paid for");
  assert.equal(s.prompt.kind, "main");

  // Paying resolves it.
  let t = arena({ hand: ["AUTOCOST"], energy: ["V1", "V1"] });
  const handBefore = t.players.p1.hand.length;
  t = play(t, { type: "play", player: "p1", card: find(t, "p1", "hand", "AUTOCOST") }, { type: "optionalCost", player: "p1", pay: true });
  assert.equal(t.players.p1.hand.length, handBefore - 1 + 2, "paid, so two cards were drawn");
  assert.equal(t.players.p1.energy.filter((id) => t.cards[id].mode === "rest").length, 2, "the skill cost was rested too");
  assertConsistent(t);
}

// 13-4: a Unison marker skill costs markers, and only one may be used per card per turn.
{
  let s = arena({ hand: ["UNI2", "UNI2"], energy: ["V1", "V1", "V1"] });
  const u = find(s, "p1", "hand", "UNI2");
  s = play(s, { type: "playUnison", player: "p1", card: u, x: 3 });
  assert.equal(s.cards[u].markers, 3);
  assert.ok(
    labels(s).some((x) => x.startsWith("Activate UNI2")),
    "the [-1] skill is offered",
  );
  const handBefore = s.players.p1.hand.length;
  s = play(s, { type: "activate", player: "p1", card: u, skill: 0 });
  assert.equal(s.cards[u].markers, 2, "13-4-1-3: one marker was removed as the cost");
  assert.equal(s.players.p1.hand.length, handBefore + 1, "and the effect ran");
  assert.ok(!labels(s).some((x) => x.startsWith("Activate UNI2")), "13-4-2: no second marker skill on that card this turn");
  assertConsistent(s);
}

// 1-2-2-2-1: with an X cost the player picks the value.
{
  let s = arena({ hand: ["XBAT"], energy: ["V1", "V1", "V1"] });
  const x = find(s, "p1", "hand", "XBAT");
  const offers = labels(s).filter((l) => l.startsWith("Play XBAT with X ="));
  assert.deepEqual(offers, ["Play XBAT with X = 0", "Play XBAT with X = 1", "Play XBAT with X = 2", "Play XBAT with X = 3"]);
  s = play(s, { type: "play", player: "p1", card: x, x: 2 });
  assert.ok(s.players.p1.battle.includes(x));
  assert.equal(s.players.p1.energy.filter((id) => s.cards[id].mode === "rest").length, 2, "two energy paid for X = 2");
}

// 8-1-7: if the attacker leaves the Battle Area, the battle ends with no damage.
{
  let s = arena({ battle: ["V1"], hand: ["E-NEGATE"] });
  const attacker = s.players.p1.battle[0];
  s = play(s, { type: "attack", player: "p1", attacker, target: s.players.p2.leader });
  assert.equal(s.prompt.kind, "combo");
  // Something removes the attacker mid-battle.
  const ctx = CTX;
  move(ctx, s, [], attacker, "drop", "p1");
  s = play(s, { type: "pass", player: "p1" });
  assert.equal(s.players.p2.life.length, 8, "no damage was dealt");
  assert.equal(s.battle, null, "and the battle is over");
  assert.equal(s.prompt.kind, "main");
  assertConsistent(s);
}

// ── [Permanent] skills hold on their own (9-5) ─────────────────────────────

{
  // A power buff applies to every matching card, and stops when the source leaves.
  let s = arena({ hand: ["AURA"], energy: ["V1"], battle: ["V1"] });
  const ally = s.players.p1.battle[0];
  const ctx = CTX;
  assert.equal(powerOf(ctx, s, ally), 10000, "no buff before it is played");
  const aura = find(s, "p1", "hand", "AURA");
  s = play(s, { type: "play", player: "p1", card: aura });
  assert.equal(powerOf(ctx, s, ally), 15000, "the permanent skill holds while the card is in play");
  assert.equal(powerOf(ctx, s, s.players.p2.battle[0] ?? s.players.p2.leader), 10000, "and not for the opponent");
  move(ctx, s, [], aura, "drop", "p1");
  assert.equal(powerOf(ctx, s, ally), 10000, "9-5-1: it stops when the source leaves play");
}

{
  // 9-1-3-3: a cost reducer names the hand, so it applies there and nowhere else.
  const s = arena({ hand: ["CHEAP"], energy: ["V1", "V1"] });
  const cheap = find(s, "p1", "hand", "CHEAP");
  const ctx = CTX;
  assert.equal(playCost(ctx, s, cheap).total, 2, "printed 3, reduced by 1");
  assert.ok(
    labels(s).some((x) => x.startsWith("Play CHEAP")),
    "so it is playable with two energy",
  );
}

{
  // A [Permanent] the compiler cannot read simply does nothing — there is no
  // moment at which the referee could be asked about it.
  const s = arena({ battle: ["ODDAURA", "V1"] });
  const ctx = CTX;
  assert.equal(powerOf(ctx, s, find(s, "p1", "battle", "V1")), 10000);
}

// ── delayed effects (1-7-2-1-1) ────────────────────────────────────────────

{
  // The timing phrase moves the rest of the sentence into the future rather
  // than defeating the compiler, which is what used to happen.
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const later = one("[Auto] When you play this card, choose 1 of your opponent's Battle Cards. At the end of the turn, KO it.");
  assert.deepEqual(later.unsupported, []);
  assert.equal(later.ops.length, 2);
  assert.equal(later.ops[0].op, "choose");
  const delay = later.ops[1] as { op: string; at: string; scope: string; ops: { op: string }[] };
  assert.equal(delay.op, "delay");
  assert.equal(delay.at, "turnEnd");
  assert.equal(delay.scope, "thisTurn");
  assert.deepEqual(
    delay.ops.map((o) => o.op),
    ["ko"],
    "the KO is inside the delay, not alongside it",
  );

  // Whose turn it has to be is read off the wording, not guessed.
  const mine = one("[Auto] When you play this card, at the start of your next turn, draw 2 cards.");
  assert.equal((mine.ops[0] as { at: string; scope: string }).at, "turnStart");
  assert.equal((mine.ops[0] as { scope: string }).scope, "yourNextTurn");
  const theirs = one("[Auto] When you play this card, during your opponent's next turn, your opponent discards 1 card.");
  assert.equal((theirs.ops[0] as { scope: string }).scope, "opponentNextTurn");

  // "for the turn" is a duration, not a timing, and must not become a delay.
  const pump = one("[Activate: Main] This card gets +5000 power for the turn.");
  assert.equal(pump.ops[0].op, "power");
}

{
  // The KO happens at the end of the turn, not when the skill resolves.
  let s = arena({ hand: ["DELAYKO"], energy: ["V1"], oppBattle: ["BIG"] });
  const victim = find(s, "p2", "battle", "BIG");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DELAYKO") });
  assert.ok(s.players.p2.battle.includes(victim), "still there while the turn runs");
  assert.equal(s.delayed.length, 1, "written down for later");
  assert.equal(s.delayed[0].at, "turnEnd");
  s = play(s, { type: "endMain", player: "p1" });
  assert.ok(s.players.p2.drop.includes(victim), "1-7-2-1-1: carried out at the end of the turn");
  assert.equal(s.delayed.length, 0, "and taken off the list");
  assertConsistent(s);
}

{
  // "At the start of your next turn" waits out the opponent's whole turn.
  let s = arena({ hand: ["DELAYDRAW"], energy: ["V1"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DELAYDRAW") });
  assert.equal(s.delayed.length, 1);
  s = play(s, { type: "endMain", player: "p1" });
  assert.equal(s.delayed.length, 1, "the opponent's turn is not yours");
  assert.equal(s.turnPlayer, "p2");
  const before = s.players.p1.hand.length;
  s = play(s, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" });
  assert.equal(s.turnPlayer, "p1");
  assert.equal(s.players.p1.hand.length, before + 2 + 1, "two from the skill, one from the draw step");
  assert.equal(s.delayed.length, 0);
}

{
  // The other side of the same rule: the opponent's next turn, not yours.
  let s = arena({ hand: ["DELAYOPP"], energy: ["V1"], oppHand: ["BIG", "BIG"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DELAYOPP") });
  const before = s.players.p2.hand.length;
  assert.equal(before, 2);
  s = play(s, { type: "endMain", player: "p1" });
  assert.equal(s.players.p2.hand.length, before - 1 + 1, "discarded one as their turn opened, then drew for the turn");
  assert.equal(s.delayed.length, 0);
}

{
  // An effect waiting for "the end of the turn" that never got there is
  // dropped rather than firing a turn late.
  let s = arena({ hand: ["DELAYKO"], energy: ["V1"], oppBattle: ["BIG"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DELAYKO") });
  s.delayed[0].at = "battleEnd"; // a timing this turn will never reach
  s = play(s, { type: "endMain", player: "p1" });
  assert.equal(s.delayed.length, 0, "its moment passed, so it is gone");
}

// ── prohibitions (20-14, 0-2-5) ────────────────────────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  const lock = one("[Auto] When you play this card, your opponent can't attack with Battle Cards until the start of your next turn.");
  assert.deepEqual(lock.unsupported, []);
  const f = lock.ops[0] as { op: string; what: string; side: string; until: string; filter?: { type: string | null } };
  assert.equal(f.op, "forbid");
  assert.equal(f.what, "attack");
  assert.equal(f.side, "opponent");
  assert.equal(f.filter?.type, "BATTLE", "only their Battle Cards, not their Leader");

  // The rest-lock wording has to outlast the opponent's whole turn.
  const rest = one("[Auto] When you play this card, choose 1 of your opponent's Battle Cards. It can't switch to Active Mode until the end of your opponent's turn.");
  assert.deepEqual(rest.unsupported, []);
  assert.equal((rest.ops[1] as { what: string }).what, "switchToActive");
  assert.equal((rest.ops[1] as { until: string }).until, "nextTurn");

  // Deck-building rules are not rules of play, and must not be read as one.
  const deckRule = one("[Permanent] You can't include non-≪Saiyan≫ Battle Cards in your deck.");
  assert.deepEqual(deckRule.unsupported, []);
  assert.deepEqual(deckRule.ops, []);
}

{
  // The move is not offered, and 0-2-5 means it is refused if sent anyway.
  let s = arena({ hand: ["LOCKDOWN"], energy: ["V1"], oppBattle: ["BIG"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "LOCKDOWN") }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  const attacker = find(s, "p2", "battle", "BIG");
  assert.ok(!labels(s).some((x) => x.includes("Attack") && x.includes("BIG")), "20-14: their Battle Card is not offered an attack");
  assert.ok(
    labels(s).some((x) => x.includes("Attack") && x.includes("L-BLUE")),
    "but their Leader still can — the rule named Battle Cards",
  );
  assert.throws(() => apply(CTX, s, { type: "attack", player: "p2", attacker, target: s.players.p1.leader }), /illegal attack/);
}

{
  // "It can't switch to Active Mode": the Charge Phase leaves it resting.
  let s = arena({ hand: ["RESTLOCK"], energy: ["V1"], oppBattle: ["BIG"] });
  const locked = find(s, "p2", "battle", "BIG");
  s.cards[locked].mode = "rest";
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "RESTLOCK") });
  assert.equal(s.cards[locked].mode, "rest");
  s = play(s, { type: "endMain", player: "p1" });
  assert.equal(s.cards[locked].mode, "rest", "7-2-7 did not stand it up");
  // It ends as the turn comes back round to the player who created it.
  s = play(s, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" });
  assert.equal(s.turnPlayer, "p1");
  assert.equal(s.effects.filter((e) => e.kind === "forbid").length, 0, "the rule has expired");
}

{
  // "You can't play copies of this card" is about the name, not the card.
  let s = arena({ hand: ["NOCOPIES", "NOCOPIES"], energy: ["V1", "V1"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "NOCOPIES") });
  assert.ok(!labels(s).some((x) => x.startsWith("Play NOCOPIES")), "the second copy is not offered");
  assert.throws(() => apply(CTX, s, { type: "play", player: "p1", card: find(s, "p1", "hand", "NOCOPIES") }), /can't be played/);
}

{
  // "Can't be KO'd by your opponent's skills" stops their skill, not the battle.
  let s = arena({ hand: ["TOUGH"], energy: ["V1", "V1"], oppHand: ["KILLER"], oppEnergy: ["V1"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "TOUGH") });
  const tough = find(s, "p1", "battle", "TOUGH");
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = play(s, { type: "play", player: "p2", card: find(s, "p2", "hand", "KILLER") });
  assert.equal(s.prompt.kind, "chooseCards", "it is still a legal choice — the KO simply does not happen");
  s = play(s, { type: "choose", player: "p2", cards: [tough] });
  assert.ok(s.players.p1.battle.includes(tough), "22-12-like: their skill cannot KO it");
  // 21-6 still applies: a rule, not a skill, and it ignores even [Indestructible].
  s.effects.push({ id: 998, target: tough, kind: "power", value: -99000, until: "turn", ownerTurn: "p2", master: "p2", createdTurn: s.turn });
  s = play(s, { type: "endMain", player: "p2" });
  assert.ok(s.players.p1.drop.includes(tough), "21-6: 0 power is a rule, and rules are not skills");
}

// ── cards under cards (23-2) and modal choice (20-2) ───────────────────────

{
  // "Place it under this card" used to compile to a move to the Drop, which is
  // a different game entirely.
  let s = arena({ hand: ["STACKER"], energy: ["V1"], battle: ["V1"] });
  const under = find(s, "p1", "battle", "V1");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "STACKER") });
  assert.equal(s.prompt.kind, "chooseCards", "both Battle Cards are candidates, so it asks");
  s = play(s, { type: "choose", player: "p1", cards: [under] });
  const host = find(s, "p1", "battle", "STACKER");
  assert.ok(!s.players.p1.battle.includes(under), "it is no longer a Battle Card of its own");
  assert.ok(!s.players.p1.drop.includes(under), "and it did not go to the Drop");
  assert.deepEqual(s.cards[host].under, [under]);
  assertConsistent(s);

  // 23-2-5: when the card on top leaves play, the stack goes with it.
  s.effects.push({ id: 997, target: host, kind: "power", value: -99000, until: "turn", ownerTurn: "p1", master: "p1", createdTurn: s.turn });
  s = play(s, { type: "endMain", player: "p1" });
  assert.ok(s.players.p1.drop.includes(under), "the card underneath followed it to the Drop");
  assertConsistent(s);
}

{
  // The options of a "Choose one—" are printed on separate lines but are not
  // skills of their own.
  const skills = parseSkills("[Auto] When you play this card, choose one-<br>・Draw 1 card.<br>・Your opponent discards 1 card.");
  assert.equal(skills.length, 1, "20-2: one skill, with two options");

  const script = compileSkill(skills[0]);
  assert.deepEqual(script.unsupported, []);
  assert.equal(script.ops.length, 1);
  const modal = script.ops[0] as { op: string; modes: { ops: { op: string }[] }[] };
  assert.equal(modal.op, "chooseMode");
  assert.deepEqual(
    modal.modes.map((mode) => mode.ops.map((o) => o.op)),
    [["draw"], ["discard"]],
  );
}

{
  // Exactly one option happens, and the player says which.
  let s = arena({ hand: ["MODAL"], energy: ["V1"], oppHand: ["BIG"] });
  const myHand = s.players.p1.hand.length;
  const theirHand = s.players.p2.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "MODAL") });
  assert.equal(s.prompt.kind, "chooseMode");
  assert.deepEqual(labels(s), ["Draw 1 card.", "Your opponent discards 1 card."]);
  s = play(s, { type: "chooseMode", player: "p1", index: 1 });
  assert.equal(s.players.p2.hand.length, theirHand - 1, "the option taken happened");
  assert.equal(s.players.p1.hand.length, myHand - 1, "and the one not taken did not");
  assert.equal(s.prompt.kind, "main");
}

// ── wordings the compiler learned in the first pattern pass ────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const ops = (text: string) => one(text).ops.map((o) => o.op);

  // Whose turn it is: the condition existed from the start and the compiler
  // had never once emitted it.
  const mine = one("[Activate: Main] If it's your turn, draw 1 card.");
  assert.deepEqual(mine.unsupported, []);
  assert.deepEqual(mine.ops, [{ op: "if", cond: { kind: "isTurnPlayer" }, then: [{ op: "draw", n: 1 }] }]);
  const theirs = one("[Activate: Battle] During your opponent's turn, draw 1 card.");
  assert.deepEqual((theirs.ops[0] as { cond: { kind: string; who?: string } }).cond, { kind: "isTurnPlayer", who: "opponent" });

  // One shape of counting condition, many areas.
  const counted = one("[Activate: Main] If your opponent has 2 or more Battle Cards in play in Rest Mode, draw 1 card.");
  assert.deepEqual(counted.unsupported, []);
  const cond = (counted.ops[0] as { cond: { kind: string; atLeast?: number; sel: { side: string; area: string; mode?: string } } }).cond;
  assert.equal(cond.kind, "count");
  assert.equal(cond.atLeast, 2);
  assert.deepEqual([cond.sel.side, cond.sel.area, cond.sel.mode], ["opponent", "battle", "rest"]);
  // "No cards" is the same shape read the other way.
  assert.equal((one("[Activate: Main] If there are no cards in your opponent's combo area, draw 1 card.").ops[0] as { cond: { atMost?: number } }).cond.atMost, 0);

  // Discarding written the long way round, and life written as a count.
  // 20-16: an optional one is the choice itself, so that declining and having
  // nothing to give come to the same answer; a mandatory one is the op.
  assert.deepEqual(ops("[Activate: Main] You may place 1 card from your hand in the drop area."), ["choose", "if"]);
  assert.deepEqual(ops("[Activate: Main] Place 1 card from your hand in the drop area."), ["discard"]);
  // BT1-077, BT1-078, BT3-054: the optional price and what it buys, in one
  // branch. Without the "up to" the player would have to pay; without the
  // branch, an empty hand would buy the rest of the skill for nothing.
  const bargain = one("[Counter: Attack] Negate the attack. Then, you may place 1 card from your hand in the Drop Area. If you do so, draw 1 card.");
  assert.deepEqual(bargain.unsupported, []);
  assert.deepEqual(bargain.ops, [
    { op: "negateAttack" },
    { op: "choose", sel: { side: "you", area: "hand", count: 1, upTo: true }, as: "cost", reason: "you may place 1 card from your hand in the Drop Area" },
    {
      op: "if",
      cond: { kind: "chose", var: "cost" },
      then: [
        { op: "moveTo", target: { var: "cost" }, to: "drop" },
        { op: "draw", n: 1 },
      ],
    },
  ]);
  // BT3-103 in full: the condition in front of it asks what the card did
  // earlier in the turn, which the board remembers for it, and whose turn it
  // is — two conditions the engine already had, asked together.
  const bergamoText =
    "[Auto] If this card participated in a battle during your opponent's turn, you may place 1 card from your hand in the Drop Area at the end of the battle. If you do so, switch this card to Active Mode, and this card gains +5000 power for the duration of the turn.";
  const bergamo = one(bergamoText);
  assert.deepEqual(bergamo.unsupported, []);
  assert.deepEqual((bergamo.ops[0] as { cond: unknown }).cond, {
    kind: "all",
    conds: [
      { kind: "battled", sel: { special: "self" } },
      { kind: "isTurnPlayer", who: "opponent" },
    ],
  });
  // The “at the end of the battle” is the skill's trigger, so it is gone from
  // the effect: left in, the skill would wait for the *next* end of a battle.
  assert.ok(autoTriggerMatches(parseSkills(bergamoText)[0], "battleEnd"), "the trailing timing is the trigger");
  assert.deepEqual(
    (bergamo.ops[0] as { then: { op: string }[] }).then.map((o) => o.op),
    ["choose", "if"],
  );
  // Without the turn half it is the memory alone.
  const anyTurn = one("[Auto] If this card participated in a battle, draw 1 card.");
  assert.deepEqual(anyTurn.unsupported, []);
  assert.deepEqual(anyTurn.ops, [{ op: "if", cond: { kind: "battled", sel: { special: "self" } }, then: [{ op: "draw", n: 1 }] }]);

  // A price paid at the end of the battle: what hangs on it happens then too.
  // Left outside the delay, the condition was asked before the delayed program
  // had bound anything, and the second half of the skill never ran.
  const later = one("[Auto] When this card attacks, you may place 1 card from your hand in the Drop Area at the end of the battle. If you do so, switch this card to Active Mode.");
  assert.deepEqual(later.unsupported, []);
  const wait = later.ops[0] as { op: string; at: string; ops: { op: string; then?: { op: string }[] }[] };
  assert.deepEqual([wait.op, wait.at], ["delay", "battleEnd"]);
  assert.deepEqual(
    wait.ops.map((o) => o.op),
    ["choose", "if"],
  );
  assert.deepEqual(
    (wait.ops[1].then ?? []).map((o) => o.op),
    ["moveTo", "switchMode"],
  );
  assert.equal(later.ops.length, 1);
  // BT3-122: a price of 2 cards is not paid by giving one, and the hand keeps
  // both until it is — otherwise an “up to” choice bought the effect at half
  // price, and the older reading bought it outright with an empty hand.
  const two = one("[Counter: Attack] Negate the attack. Then, you may place 2 cards from your hand in the Drop Area. If you do so, add this card to your hand.");
  assert.deepEqual(two.unsupported, []);
  assert.deepEqual((two.ops[1] as { sel: { count: number; upTo: boolean } }).sel.count, 2);
  assert.deepEqual((two.ops[2] as { cond: unknown }).cond, { kind: "chose", var: "cost", atLeast: 2 });
  // BT3-054 whole: the price keeps a name of its own, so the two choices the
  // effect goes on to make still start at c0 and the price is not spent twice.
  const buu = one(
    "[Auto] When you play this card, you may place 1 card from your hand in the Drop Area. If you do so, choose 1 of your <Majin Buu> and 1 of your opponent's Battle Cards with an energy cost of 3 or less. Place the chosen opponent Battle Card under the chosen <Majin Buu>.",
  );
  assert.deepEqual(buu.unsupported, []);
  assert.deepEqual(
    buu.ops.map((o) => o.op),
    ["choose", "if"],
  );
  const paid = buu.ops[1] as { cond: { kind: string; var: string }; then: { op: string; as?: string }[] };
  assert.deepEqual(paid.cond, { kind: "chose", var: "cost" });
  assert.deepEqual(
    paid.then.map((o) => [o.op, o.as ?? null]),
    [
      ["moveTo", null],
      ["choose", "c0"],
      ["choose", "c1"],
      ["moveTo", null],
    ],
  );
  assert.deepEqual(ops("[Activate: Main] Add cards from your life to your hand until you have 6 life left."), ["lifeDownTo"]);
  assert.deepEqual(ops("[Activate: Main] Both players choose 1 card from their hand."), ["discard"]);

  // A reminder of a rule the engine already applies is not an effect.
  const reminder = one("[Counter: Play] You can activate this card's [Counter] skill from your hand. Draw 1 card.");
  assert.deepEqual(reminder.unsupported, []);
  assert.deepEqual(
    reminder.ops.map((o) => o.op),
    ["draw"],
  );
  // Nor is a note in the full-width brackets some sets print.
  assert.deepEqual(one("[Auto] When you play this card, draw 1 card.（You can only include up to 4 cards with [Super Combo] in your deck）").unsupported, []);

  // A choice with no area named is a card on the table (20-1-6) — and until
  // this worked, every later "it" in the same skill had nothing to point at.
  const chain = one("[Auto] When you play this card, choose 1 of your <Son Goku>, and switch it to Rest Mode.");
  assert.deepEqual(chain.unsupported, []);
  assert.deepEqual(
    chain.ops.map((o) => o.op),
    ["choose", "switchMode"],
  );
}

// ── two conditions in front of one effect (9-1-3) ──────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const yellow = parseFilter("yellow");

  // BT5-088. Both conditions have to hold, so they nest, and the order they
  // are printed in is the order they nest in.
  const both = one("[Auto] When you combo with this card, if your Leader Card is yellow and your life is at 4 or less, draw 1 card.");
  assert.deepEqual(both.unsupported, []);
  assert.deepEqual(both.ops, [
    {
      op: "if",
      cond: { kind: "leaderMatches", filter: yellow },
      then: [{ op: "if", cond: { kind: "life", side: "you", atMost: 4 }, then: [{ op: "draw", n: 1 }] }],
    },
  ]);

  // The same card text with the conditions the other way round: same meaning,
  // and both still have to hold.
  const swapped = one("[Auto] When you combo with this card, if your life is at 4 or less and your Leader Card is yellow, draw 1 card.");
  assert.deepEqual(swapped.unsupported, []);
  assert.deepEqual(swapped.ops, [
    {
      op: "if",
      cond: { kind: "life", side: "you", atMost: 4 },
      then: [{ op: "if", cond: { kind: "leaderMatches", filter: yellow }, then: [{ op: "draw", n: 1 }] }],
    },
  ]);

  // Either half alone is the same condition without the nesting.
  assert.deepEqual(one("[Auto] When you combo with this card, if your life is at 4 or less, draw 1 card.").ops, [
    { op: "if", cond: { kind: "life", side: "you", atMost: 4 }, then: [{ op: "draw", n: 1 }] },
  ]);
  assert.deepEqual(one("[Auto] When you combo with this card, if your Leader Card is yellow, draw 1 card.").ops, [
    { op: "if", cond: { kind: "leaderMatches", filter: yellow }, then: [{ op: "draw", n: 1 }] },
  ]);

  // Whose life, and which way round the comparison goes, both change the test.
  assert.deepEqual((one("[Auto] When you combo with this card, if your opponent's life is at 4 or less, draw 1 card.").ops[0] as { cond: unknown }).cond, {
    kind: "life",
    side: "opponent",
    atMost: 4,
  });
  assert.deepEqual((one("[Auto] When you combo with this card, if your life is at 4 or more, draw 1 card.").ops[0] as { cond: unknown }).cond, {
    kind: "life",
    side: "you",
    atLeast: 4,
  });
}

// ── choosing more than one card, one tap at a time (5-2) ───────────────────

{
  // The board asks by tapping a card, so a "choose 2" is two questions. It
  // used to be offered as two separate one-card answers to a prompt that
  // demanded both at once, which the engine then refused as illegal.
  let s = arena({ hand: ["TWOKILL"], energy: ["V1"], oppBattle: ["BIG", "V-BLUE", "BLOCKER"] });
  const first = find(s, "p2", "battle", "BIG");
  const second = find(s, "p2", "battle", "BLOCKER");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "TWOKILL") });
  assert.equal(s.prompt.kind, "chooseCards");
  assert.equal((s.prompt as { choice: { max: number } }).choice.max, 1, "one card per answer");
  // Every candidate is offered, and taking one is legal.
  assert.equal(labels(s).length, 3);
  s = play(s, { type: "choose", player: "p1", cards: [first] });
  assert.equal(s.prompt.kind, "chooseCards", "it asks again for the second");
  assert.ok(!(s.prompt as { choice: { candidates: string[] } }).choice.candidates.includes(first), "and not for the same card twice");
  s = play(s, { type: "choose", player: "p1", cards: [second] });
  assert.ok(s.players.p2.drop.includes(first) && s.players.p2.drop.includes(second), "both chosen cards were KO'd");
  assert.equal(s.prompt.kind, "main");
  assertConsistent(s);
}

{
  // 3-1-2: "your opponent's cards" includes their Leader (20-1-6), but a
  // Leader does not leave the Leader Area — and an empty Leader Area is a
  // state the rest of the engine cannot read.
  let s = arena({ hand: ["GRABBER"], energy: ["V1"] });
  const leader = s.players.p2.leader;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "GRABBER") });
  assert.equal(s.players.p2.leader, leader, "their Leader is still there");
  assert.ok(!s.players.p2.drop.includes(leader));
  assert.equal(s.prompt.kind, "main");
  assert.ok(labels(s).length > 0, "and the game can still be played");
  assertConsistent(s);
}

// ── wordings the compiler learned in the second pattern pass ───────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const ops = (text: string) => one(text).ops.map((o) => o.op);

  // "A marker" is one marker.
  assert.deepEqual(ops("[Auto] When you play this card, choose up to 1 of your opponent's Unison Cards and remove a marker from it."), ["choose", "removeMarker"]);

  // An [Auto] restates its trigger and then says "it": the trigger is dropped,
  // but what it was about is not.
  const carried = one("[Auto] When this card is sent to the Warp from your Battle Area or deck, add it to your hand.");
  assert.deepEqual(carried.unsupported, []);
  assert.deepEqual(carried.ops, [{ op: "moveTo", target: { sel: { special: "self" } }, to: "hand" }]);

  // A count with no number: "a" and a bare plural both mean at least one.
  const any = one("[Activate: Main] If your opponent has a Battle Card in play in Rest Mode, draw 1 card.");
  assert.deepEqual(any.unsupported, []);
  assert.deepEqual((any.ops[0] as { cond: { kind: string; atLeast?: number } }).cond.atLeast, 1);
  assert.deepEqual((one("[Activate: Main] If your opponent has Battle Cards in their Battle Area, draw 1 card.").ops[0] as { cond: { atLeast?: number } }).cond.atLeast, 1);

  // Some sets print the odd full-width letter mid-word.
  assert.deepEqual(one("[Auto] When you play this card, if your Leader Ｃard is a ≪Majin≫, draw 1 card.").unsupported, []);

  // The two life counts against each other.
  assert.deepEqual((one("[Activate: Main] If your life is less than or equal to your opponent's life, draw 1 card.").ops[0] as { cond: unknown }).cond, {
    kind: "lifeVsOpponent",
    atMost: true,
  });

  // "Choose 1 of X and 1 of Y" splits on the "and"; the second half is a
  // choice with the verb left behind.
  assert.deepEqual(ops("[Activate: Main] Choose 1 of your <Son Goku> and 1 of your opponent's Battle Cards."), ["choose", "choose"]);
}

// ── prohibitions printed as [Permanent] skills (9-5-1, 20-14) ──────────────

{
  // A [Permanent] holds for as long as the card is where the skill is valid,
  // with no duration to expire — so unlike the same sentence on an [Auto], it
  // is still true next turn, and it stops the moment the card leaves play.
  const ctx = CTX;
  let s = arena({ battle: ["PERMTOUGH"], oppHand: ["KILLER"], oppEnergy: ["V1"] });
  const tough = find(s, "p1", "battle", "PERMTOUGH");
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = play(s, { type: "play", player: "p2", card: find(s, "p2", "hand", "KILLER") });
  assert.equal(s.prompt.kind, "chooseCards", "it is still a legal choice; the KO just does not happen");
  s = play(s, { type: "choose", player: "p2", cards: [tough] });
  assert.ok(s.players.p1.battle.includes(tough), "9-5-1: the permanent skill holds without being activated");
  // Take the card off the table and the rule goes with it.
  move(ctx, s, [], tough, "drop", "p1");
  assert.ok(!forbids(ctx, s, "beKOdBySkill", { player: "p2", card: tough }), "and stops when the source leaves play");
}

{
  // The same thing about a player rather than a card.
  const ctx = CTX;
  let s = arena({ battle: ["PERMLOCK"], oppBattle: ["BIG"] });
  const lock = find(s, "p1", "battle", "PERMLOCK");
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  assert.ok(!labels(s).some((x) => x.includes("Attack") && x.includes("BIG")), "their Battle Card cannot attack while the permanent skill is in play");
  assert.ok(
    labels(s).some((x) => x.includes("Attack") && x.includes("L-BLUE")),
    "their Leader still can — the rule named Battle Cards",
  );
  // 9-5-1 again: no duration to end, so removing the card is what ends it.
  move(ctx, s, [], lock, "drop", "p1");
  assert.ok(
    labels(s).some((x) => x.includes("Attack") && x.includes("BIG")),
    "with the source gone, the attack is offered again",
  );
}

// ── another way to pay (5-3) ───────────────────────────────────────────────

{
  // The card costs 3 and the defender has no energy at all, so the only way
  // it can be played is the one the card itself prints.
  let s = arena({ oppHand: ["E-LIFE"] });
  const counter = find(s, "p2", "hand", "E-LIFE");
  const lifeBefore = s.players.p2.life.length;
  const handBefore = s.players.p2.hand.length;
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  assert.equal(s.prompt.kind, "counter");
  assert.deepEqual((s.prompt as { candidates: string[] }).candidates, [counter], "offered although the energy is not there");
  const offers = labels(s).filter((x) => x.startsWith("Counter with"));
  assert.deepEqual(offers, ["Counter with E-LIFE (by adding 1 from your life to your hand)"], "only the cost it can actually pay");

  s = play(s, { type: "counter", player: "p2", card: counter, alt: true });
  assert.equal(s.battle, null, "the counter resolved: the attack was negated");
  assert.equal(s.players.p2.life.length, lifeBefore - 1, "one life card paid the cost");
  // The card left the hand for the Drop and one life card came in, so the hand
  // is the size it was. Losing life this way is a cost, not damage (1-13-2).
  assert.equal(s.players.p2.hand.length, handBefore, "the life card went to the hand");
  assert.ok(s.players.p2.drop.includes(counter));
  assert.equal(s.players.p2.damageTaken, 0, "paying a cost is not taking damage");
  assertConsistent(s);
}

{
  // With the energy there, both costs are offered and they are different
  // decisions — 0-2-5 does not choose for the player.
  let s = arena({ oppHand: ["E-LIFE"], oppEnergy: ["V1", "V1", "V1"] });
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  const offers = labels(s).filter((x) => x.startsWith("Counter with"));
  assert.equal(offers.length, 2, "the printed cost and the alternative, both on the menu");
  const before = s.players.p2.life.length;
  s = play(s, { type: "counter", player: "p2", card: find(s, "p2", "hand", "E-LIFE") });
  assert.equal(s.players.p2.life.length, before, "paying with energy leaves the life alone");
  assert.equal(s.players.p2.energy.filter((id) => s.cards[id].mode === "rest").length, 3, "it was paid with energy instead");
}

// ── what a [Permanent] can say about the card itself (9-1-5, 20-1, 20-21) ──

{
  const ctx = CTX;
  // 9-1-5: one named keyword goes, the card keeps the rest of itself.
  const s = arena({ battle: ["SELFMUTE"] });
  const mute = find(s, "p1", "battle", "SELFMUTE");
  assert.ok(!has(ctx, s, mute, "Blocker"), "the card negated its own [Blocker]");
}

{
  const ctx = CTX;
  // 20-1: a card that gains a trait is that trait to every skill that names
  // one — this is about what the card *is*, not what it does.
  let s = arena({ hand: ["SAIYANKILL"], energy: ["V1"], oppBattle: ["BECOMES", "BIG"] });
  const becomes = find(s, "p2", "battle", "BECOMES");
  assert.ok(
    cardNow(ctx, s, becomes).traits.some((t) => t.toLowerCase() === "saiyan"),
    "it counts as a ≪Saiyan≫",
  );
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "SAIYANKILL") });
  // Only one card on their side is a Saiyan, so the choice is forced and taken.
  assert.ok(s.players.p2.drop.includes(becomes), "the ≪Saiyan≫ skill found it");
  assert.ok(s.players.p2.battle.includes(find(s, "p2", "battle", "BIG")), "and left the card that is not one");
}

{
  const ctx = CTX;
  // 20-1: the fourth thing a card can be "also treated as" — a whole card
  // name. Eight cards print it ("this card is also treated as {Planet M-2} in
  // all areas") and the compiler read none of them until 9 Sep 2026, so every
  // skill naming the card they become passed them over.
  const compiled = compileSkill(parseSkills("[Permanent] This card is also treated as {Planet M-2} in all areas.")[0]);
  assert.deepEqual(compiled.unsupported, [], "the wording reads");
  assert.deepEqual(compiled.ops, [{ op: "gains", target: { sel: { special: "self" } }, traits: [], characters: [], colors: [], names: ["planet m-2"] }], "the clause is read lowercased, as every trait and character from this rule is; every name comparison is case-insensitive");

  // …and the card answers to both names, in any area, to anything that asks
  // what a card *is*.
  const s = arena({ battle: ["RENAMED"], hand: ["RENAMED"] });
  const asked = parseFilter("{Planet M-2}");
  for (const area of ["battle", "hand"] as const) {
    const id = find(s, "p1", area, "RENAMED");
    assert.ok(matches(cardNow(ctx, s, id), asked), `the copy in your ${area} is found by its gained name`);
    assert.ok(matches(cardNow(ctx, s, id), parseFilter("{RENAMED}")), "…and still by its own");
  }
  // A card without the skill is not: the gain is this card's, not the name's.
  assert.ok(!matches(cardNow(ctx, s, s.players.p1.leader), asked));
  // "Other than {Planet M-2}" reads the same list, so the exclusion catches it too.
  assert.ok(!matches(cardNow(ctx, s, find(s, "p1", "battle", "RENAMED")), parseFilter("card other than {Planet M-2}")));
}

{
  // 9-1-5, the same sentence with the target after the keyword rather than in
  // front of it: "negate the [K] skill **on** X". Ten wordings across the
  // catalog are printed this way and none of them read until 9 Sep 2026 — the
  // rule beside this one only knows "negate X's [K]".
  const one = (text: string) => compileSkill(parseSkills(`[Permanent] ${text}`)[0]);
  const on = one("Negate the [Energy-Exhaust] skill on your Red/Yellow multicolor ≪God≫ cards in all areas.");
  assert.deepEqual(on.unsupported, [], "the word order reads");
  assert.equal(on.ops.length, 1);
  assert.equal((on.ops[0] as { op: string; keyword?: string }).op, "negateKeyword");
  assert.equal((on.ops[0] as { keyword?: string }).keyword, "Energy-Exhaust");
  // Plural, and "of" for "on": the same sentence, the same reading.
  assert.deepEqual(one("Negate the [Energy-Exhaust] skills of all <Android 16> cards in all of your areas.").unsupported, []);
  // A tag naming a *kind* of skill is not a keyword, so this rule lets it go
  // by rather than inventing one. Nothing else reads that word order yet, so
  // the clause stays unread — which is the point: it is not read *wrongly*.
  const kind = one("Negate the [Auto] skills of your opponent's Battle Cards.");
  assert.deepEqual(kind.ops, []);
  assert.equal(kind.unsupported.length, 1);
}

{
  const ctx = CTX;
  // BT2-001 Vegito, "each <Son Goku> and <Vegeta> in all of your areas gain
  // red, blue, and green colors": what a card counts as does not depend on
  // where it is (20-1), and here the areas that matter are the ones off the
  // table — the colour of a card in your energy is what pays for costs.
  const s = arena({ battle: ["RECOLOR"], hand: ["RECOLORED"], energy: ["RECOLORED"], oppHand: ["RECOLORED"] });
  for (const area of ["hand", "energy"] as const) {
    const id = find(s, "p1", area, "RECOLORED");
    assert.deepEqual(cardNow(ctx, s, id).colors, ["Yellow", "Red", "Blue", "Green"], `the copy in your ${area} gained the three colours`);
  }
  // "Your" areas, so their copy of the same card is untouched.
  assert.deepEqual(cardNow(ctx, s, find(s, "p2", "hand", "RECOLORED")).colors, ["Yellow"]);
  // The card printing the skill is not itself a <RECOLORED>.
  assert.deepEqual(cardNow(ctx, s, find(s, "p1", "battle", "RECOLOR")).colors, ["Red"]);
}

{
  const ctx = CTX;
  // 20-21: a reducer that names the combo cost reduces the combo cost.
  const s = arena({ hand: ["CHEAPCOMBO"] });
  const cheap = find(s, "p1", "hand", "CHEAPCOMBO");
  assert.equal(DEFS.CHEAPCOMBO.comboCost, 2, "printed");
  assert.equal(comboCostOf(ctx, s, cheap), 0, "and free after its own [Permanent]");
}

{
  const ctx = CTX;
  // 20-21 with a duration on it. `collectStatics` only ever runs over a
  // [Permanent] (9-5-1), so the same sentence on an [Auto] used to compile to
  // a `costReduction` the interpreter walked straight past — the skill read
  // perfectly and did nothing, which no compile figure can show. Five cards in
  // the catalog print it, XD1-05 among them.
  let s = arena({ hand: ["CHEAPENER", "BLUECOMBO"], energy: ["V1"] });
  const blue = find(s, "p1", "hand", "BLUECOMBO");
  assert.equal(comboCostOf(ctx, s, blue), 2, "printed");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "CHEAPENER") });
  assert.equal(comboCostOf(ctx, s, blue), 1, "and 1 less while the skill is in force");
  assert.ok(
    s.effects.some((e) => e.kind === "comboCost" && e.target === blue && e.until === "turn"),
    "as an effect that ends with the turn, not a standing one",
  );
}

{
  // "Only 1 {ONLYONE} can be played in your Battle Area" — the rule switches
  // itself on once one is there, which a [Permanent] can say because the
  // static layer asks again every time.
  let s = arena({ hand: ["ONLYONE", "ONLYONE"], energy: ["V1", "V1"] });
  assert.ok(
    labels(s).some((x) => x.startsWith("Play ONLYONE")),
    "the first is playable",
  );
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "ONLYONE") });
  assert.ok(!labels(s).some((x) => x.startsWith("Play ONLYONE")), "the second is not, while the first is in play");
}

{
  const ctx = CTX;
  // A card's own mode as a condition, re-read every time it is asked.
  const s = arena({ battle: ["RESTCOND", "V1"] });
  const cond = find(s, "p1", "battle", "RESTCOND");
  const ally = find(s, "p1", "battle", "V1");
  assert.equal(powerOf(ctx, s, ally), 10000, "nothing while it stands");
  s.cards[cond].mode = "rest";
  assert.equal(powerOf(ctx, s, ally), 15000, "and +5000 once it is rested");
}

// ── replacement effects (9-10) ─────────────────────────────────────────────

{
  // 9-10-1-1: the move that was about to happen is treated as never having
  // happened, and the card goes where the skill says instead.
  let s = arena({ battle: ["EXILE"], oppHand: ["KILLER"], oppEnergy: ["V1"] });
  const exile = find(s, "p1", "battle", "EXILE");
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = play(s, { type: "play", player: "p2", card: find(s, "p2", "hand", "KILLER") }, { type: "choose", player: "p2", cards: [exile] });
  assert.ok(!s.players.p1.drop.includes(exile), "it did not go to the Drop");
  assert.ok(s.players.p1.removed.includes(exile), "9-10: it went where the skill said instead");
  assertConsistent(s);
}

{
  // "By a skill" is narrower than "would leave": a battle is not a skill.
  let s = arena({ battle: ["WARPER"], oppBattle: ["BIG"] });
  const warper = find(s, "p1", "battle", "WARPER");
  s.cards[warper].mode = "rest";
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = play(s, { type: "attack", player: "p2", attacker: find(s, "p2", "battle", "BIG"), target: warper }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.ok(s.players.p1.drop.includes(warper), "KO'd in a battle, so the Drop — the skill named a skill");
  assert.ok(!s.players.p1.warp.includes(warper));
  assertConsistent(s);
}

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  // The sentence splits at the comma, and neither half means anything alone.
  const r = one("[Permanent] If this card would leave the Battle Area, remove it from the game instead.");
  assert.deepEqual(r.unsupported, []);
  assert.deepEqual(r.ops, [{ op: "replaceLeave", to: "removed", target: { sel: { special: "self" } } }]);

  // A rule about other cards keeps its subject rather than the "it" that follows.
  const other = one("[Permanent] When a ≪Saiyan≫ card would leave your Battle Area, you may place it in your Z-Energy instead.");
  assert.deepEqual(other.unsupported, []);
  const op = other.ops[0] as { op: string; to: string; target: { sel: { area: string; filter?: { traits: string[] } } } };
  assert.equal(op.op, "replaceLeave");
  assert.equal(op.to, "zEnergy");
  assert.deepEqual(op.target.sel.filter?.traits, ["saiyan"]);

  // "By your opponent's skills" is left unread on purpose: `move` knows a
  // skill did it but not whose, and guessing lets the wrong cards escape.
  assert.ok(one("[Permanent] If this card would be removed from your Battle Area by an opponent's skill, send it to your Warp instead.").unsupported.length > 0);
}

// ── playing a card for another price (5-3) ─────────────────────────────────

{
  // BT3-087's wording. It used to compile to an *instruction to play the
  // card*, which a [Permanent] never carries out — so the card looked handled,
  // never reached the referee, and the player paid the energy anyway.
  const one = compileSkill(parseSkills("[Permanent] If you have <V1> in your Battle Area or Leader Area, you can play this card from your hand without paying its energy cost.")[0]);
  assert.deepEqual(one.unsupported, []);
  const gate = one.ops[0] as { op: string; cond: { kind: string; sel: { area: string; filter?: { type: string | null } } }; then: { op: string; for?: string }[] };
  assert.equal(gate.op, "if");
  // "Battle Area or Leader Area" is both areas, not a Battle Area holding a
  // Leader — which is nothing, so the waiver could never have switched on.
  assert.equal(gate.cond.sel.area, "play");
  assert.equal(gate.cond.sel.filter?.type, null);
  assert.deepEqual(gate.then, [{ op: "altCost", pay: "none", for: "play" }]);
}

{
  // With the named card on the table, it plays for nothing — and there is no
  // energy at all here, so nothing else could have paid for it.
  let s = arena({ hand: ["FREEPLAY"], battle: ["V1"] });
  assert.equal(s.players.p1.energy.length, 0);
  assert.ok(
    labels(s).some((x) => x === "Play FREEPLAY (for no energy)"),
    "the printed price is offered",
  );
  const free = find(s, "p1", "hand", "FREEPLAY");
  s = play(s, { type: "play", player: "p1", card: free, alt: true });
  assert.ok(s.players.p1.battle.includes(free), "it was played");
  assert.equal(s.players.p1.energy.length, 0, "and nothing was charged for it");
  assertConsistent(s);
}

{
  // Without the card the skill names, the waiver is not on the menu, and the
  // card costs 2 like anything else.
  const s = arena({ hand: ["FREEPLAY"], energy: ["V1", "V1"] });
  assert.ok(!labels(s).some((x) => x.includes("for no energy")), "no waiver without the condition");
  assert.ok(
    labels(s).some((x) => x === "Play FREEPLAY (2)"),
    "the printed cost is still there",
  );
}

// ── a counter can be countered (9-7) ───────────────────────────────────────

{
  // Until the window below existed, no [Counter: Counter] card in the game
  // could ever be played: the only window that collects them is the one
  // opened in answer to a counter, and none was ever opened.
  let s = arena({ hand: ["E-STOP"], energy: ["V1"], oppHand: ["E-NEGATE"], oppEnergy: ["V1"] });
  // p2 holds a counter that negates attacks; p1 holds one that negates counters.
  const stop = find(s, "p1", "hand", "E-STOP");
  const neg = find(s, "p2", "hand", "E-NEGATE");
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  assert.equal(s.prompt.kind, "counter");
  assert.equal((s.prompt as { player: PlayerId }).player, "p2");

  s = play(s, { type: "counter", player: "p2", card: neg });
  // 9-7: their counter is now itself open to an answer.
  assert.equal(s.prompt.kind, "counter", "the counter can be countered");
  assert.equal((s.prompt as { player: PlayerId }).player, "p1");
  assert.deepEqual((s.prompt as { candidates: string[] }).candidates, [stop]);

  s = play(s, { type: "counter", player: "p1", card: stop });
  // 9-7-3: the last one played resolves first, and it negates the one under it,
  // so the attack was never negated after all.
  assert.equal(s.battle?.negated ?? false, false, "9-7-4: the countered counter did nothing");
  assert.ok(s.players.p2.drop.includes(neg), "22-10-7: it was still paid for and still in the Drop");
  assert.ok(s.players.p1.drop.includes(stop));
  assertConsistent(s);
}

{
  // Declining the answer lets the counter through, as before.
  let s = arena({ hand: ["E-STOP"], energy: ["V1"], oppHand: ["E-NEGATE"], oppEnergy: ["V1"] });
  const neg = find(s, "p2", "hand", "E-NEGATE");
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  s = play(s, { type: "counter", player: "p2", card: neg });
  s = play(s, { type: "counter", player: "p1", card: null });
  assert.equal(s.battle, null, "the attack was negated and the battle ended");
  assert.equal(s.players.p2.life.length, 8);
  assertConsistent(s);
}

// ── numbers read off the board, and looking at a deck (20-11) ──────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // The `count` amount has been in the language from the start and the
  // compiler had never once emitted it.
  const each = one("[Activate: Main] Draw 1 card for each of your Battle Cards.");
  assert.deepEqual(each.unsupported, []);
  assert.deepEqual(each.ops, [
    {
      op: "draw",
      n: { count: { side: "you", area: "battle", filter: undefined, count: 99, upTo: false, mode: undefined, hidden: undefined, fromVar: undefined, take: undefined, fromEnd: undefined, notSelf: undefined } },
    },
  ]);

  // "+5000 power for each" is a multiple of the count, not the count.
  const power = one("[Activate: Main] This card gets +5000 power for each card in your Drop Area.");
  assert.deepEqual(power.unsupported, []);
  const amt = (power.ops[0] as { amount: { count: { area: string }; times?: number } }).amount;
  assert.equal(amt.times, 5000);
  assert.equal(amt.count.area, "drop");

  // It has to be read before the power pattern, which matches on a word
  // boundary and would otherwise take the +5000 and drop the rest in silence.
  assert.notEqual(typeof (power.ops[0] as { amount: unknown }).amount, "number", "not a flat +5000");

  // "Draw cards equal to the number of …" prints no number at all.
  assert.deepEqual((one("[Activate: Main] Draw cards equal to the number of your Battle Cards.").ops[0] as { op: string }).op, "draw");

  // Looking at a deck, in the half-dozen ways the text words it.
  const look = (text: string) => one(`[Activate: Main] ${text}`).ops[0] as { op: string; n: number; side?: string; from?: string };
  assert.deepEqual(look("Look at up to 3 cards from the top of your deck."), { op: "look", n: 3, as: "looked" });
  assert.equal(look("Look at up to the top 5 cards of your deck.").n, 5, "the number can come after the word");
  assert.equal(look("Look at up to 2 cards from the top of your opponent's deck.").side, "opponent");
  assert.equal(look("Look at the bottom card of your deck.").from, "bottom");
  assert.equal(look("Look at the bottom card of your deck.").n, 1, "a card is one card");
}

{
  // Looking is not revealing (20-11): the cards are bound to a name, not moved.
  DEFS.PEEK = { ...DEFS.V1, id: "PEEK", name: "PEEK", skill: "[Auto] When you play this card, look at the bottom card of your deck." };
  let s = arena({ hand: ["PEEK"], energy: ["V1"] });
  const deckSize = s.players.p1.deck.length;
  const bottom = s.players.p1.deck[deckSize - 1];
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "PEEK") });
  assert.equal(s.players.p1.deck.length, deckSize, "nothing left the deck");
  assert.equal(s.players.p1.deck[s.players.p1.deck.length - 1], bottom, "and the bottom card is where it was");
}

// ── a keyword's cost is written after the tag, with no colon ───────────────

{
  // "[Arrival red/green] {r}", "[Successor]{g}{y}" — the orbs are what the
  // keyword costs. Read as an effect they say nothing, and the engine never
  // learns the price; this was the single commonest reason a whole skill
  // failed to compile.
  const orbs = (line: string) => parseSkills(line)[0];
  assert.deepEqual(orbs("[Successor]{g}{g}{y}").energyCost, { Green: 2, Yellow: 1 });
  assert.equal(orbs("[Successor]{g}{g}{y}").effect, "", "nothing is left over to compile");
  assert.deepEqual(orbs("[Arrival red/green] {r} (Play this card from your hand when you have red cards.)").energyCost, { Red: 1 });
  // The orbs may be followed by the keyword's validity condition.
  assert.deepEqual(orbs("[Successor]{g}{y}, if your Leader is a green <Frieza> card.").energyCost, { Green: 1, Yellow: 1 });

  // It has to begin with an orb: a skill that merely *starts* with "When" is
  // an effect, and treating it as a cost would delete the whole skill.
  const normal = parseSkills("[Auto] When this card attacks, draw 1 card.")[0];
  assert.equal(normal.cost, "");
  assert.equal(normal.effect, "When this card attacks, draw 1 card.");
}

// ── a phrase that names two areas at once ──────────────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // "Battle Cards or Unisons" is the one two-area phrase the game prints
  // often enough to be worth a selector that can hold both. Reading it as
  // either one alone would drop the other half without saying so.
  const both = one("[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards or Unisons and switch it to Rest Mode.");
  assert.deepEqual(both.unsupported, []);
  const sel = (both.ops[0] as { sel: { areas?: string[]; side: string } }).sel;
  assert.deepEqual(sel.areas, ["battle", "unison"]);
  assert.equal(sel.side, "opponent");

  // Each area alone still resolves to just that one.
  assert.equal(
    (one("[Auto] When you play this card, choose up to 1 of your opponent's Unisons and remove 1 marker from it.").ops[0] as { sel: { area: string; areas?: string[] } }).sel.area,
    "unison",
  );
  assert.equal((one("[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and KO it.").ops[0] as { sel: { areas?: string[] } }).sel.areas, undefined);
}

{
  // And it finds cards in both areas at once.
  const ctx = CTX;
  DEFS.RESTBOTH = { ...DEFS.V1, id: "RESTBOTH", name: "RESTBOTH", skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards or Unisons and switch it to Rest Mode." };
  let s = arena({ hand: ["RESTBOTH"], energy: ["V1"] });
  // Their only card in either area is a Unison, so the choice is forced.
  const uni = s.players.p2.deck.find((id) => s.cards[id].cardId === "V-BLUE")!;
  s.cards[uni].cardId = "U1";
  move(ctx, s, [], uni, "unison", "p2");
  // 21-9: a Unison with no markers is dropped by rule processing before the
  // skill ever gets to look at it.
  s.cards[uni].markers = 2;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "RESTBOTH") });
  assert.equal(s.cards[uni].mode, "rest", "a Unison was found by a phrase that also names Battle Cards");
}

// ── a skill that switches itself off, and taking a card ────────────────────

{
  // 9-1-5: an effect meant to happen once. The skill is still printed; it
  // simply never triggers again, through the same list of negated skill
  // indexes another card's negation uses.
  let s = arena({ hand: ["ONCEONLY", "ONCEONLY"], energy: ["V1", "V1"] });
  const before = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "ONCEONLY") });
  const once = find(s, "p1", "battle", "ONCEONLY");
  assert.equal(s.players.p1.hand.length, before - 1 + 1, "played one, drew one");
  assert.deepEqual(s.cards[once].negated, [0], "the skill turned itself off — its own index, on its own instance");

  // The second copy is a different card, and its own skill still works.
  const after = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "ONCEONLY") });
  assert.equal(s.players.p1.hand.length, after - 1 + 1, "the other copy still draws");
}

{
  // 3-1-6-1: a Battle Card may sit in either player's Battle Area, so taking
  // control is a move to your own side. The card is not replayed and keeps
  // what it had.
  let s = arena({ hand: ["STEALER"], energy: ["V1"], oppBattle: ["BIG"] });
  const prize = find(s, "p2", "battle", "BIG");
  s.cards[prize].mode = "rest";
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "STEALER") });
  assert.ok(s.players.p1.battle.includes(prize), "it is yours now");
  assert.ok(!s.players.p2.battle.includes(prize));
  assert.equal(s.cards[prize].mode, "rest", "23-3: the card itself did not change");
  assert.equal(s.cards[prize].owner, "p2", "its owner is still its owner (3-1-6)");
  assertConsistent(s);
}

// ── the second half of a sentence, left in the third person ────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // Splitting on the "and" leaves "places it in their Drop Area" with its
  // subject in the clause before it. Only the verbs that move a card are
  // normalised, because there the card decides what happens and the actor
  // does not matter.
  const warp = one("[Auto] When you play this card, choose 1 of your opponent's Battle Cards and sends it to their Warp.");
  assert.deepEqual(warp.unsupported, []);
  assert.deepEqual(
    warp.ops.map((o) => o.op),
    ["choose", "moveTo"],
  );
  assert.equal((warp.ops[1] as { to: string }).to, "warp");

  // "Your opponent chooses 1 card in their hand and places it in their Drop
  // Area" is one action said twice. Read as two it moved the wrong card:
  // "it" had nothing of its own to point at and fell back on this card.
  const discard = one("[Auto] When you play this card, your opponent chooses 1 card in their hand and places it in their Drop Area.");
  assert.deepEqual(discard.unsupported, []);
  assert.deepEqual(discard.ops, [{ op: "discard", n: 1, side: "opponent" }], "the discard, once");
}

// ── a clause is read whole, or not at all ──────────────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(`[Activate: Battle] ${text}`)[0]);

  // The commonest two-part clause in the game. `splitClauses` keeps "and ["
  // together on purpose so that "gains [A] and [B]" stays whole, which means
  // this arrives in one piece — and the keyword used to be dropped in silence.
  const both = one("This card gets +10000 power and [Double Strike] for the turn.");
  assert.deepEqual(both.unsupported, []);
  assert.deepEqual(
    both.ops.map((o) => o.op),
    ["power", "grant"],
  );
  assert.equal((both.ops[0] as { amount: number; until: string }).until, "turn");
  assert.equal((both.ops[1] as { keyword: { name: string } }).keyword.name, "Strike");

  // Combo power says it the same way.
  assert.deepEqual(
    one("This card gets +5000 combo power and [Barrier] for the battle.").ops.map((o) => o.op),
    ["comboPower", "grant"],
  );

  // A tail the compiler does not know must fail the whole clause rather than
  // be discarded — reading "…for each card in your Drop" as a flat +5000 would
  // be wrong rather than incomplete.
  assert.ok(one("This card gets +5000 power while your opponent is winning.").unsupported.length > 0, "an unknown tail is an honest gap, not a silent loss");

  // 9-9: "during your turn" is one the compiler now knows, and it is a
  // *condition* rather than a duration — the bonus is there only while it is
  // your turn, which on a [Permanent] the static layer asks again every time.
  const whileMine = one("This card gets +5000 power during your turn.");
  assert.deepEqual(whileMine.unsupported, []);
  assert.equal(whileMine.ops[0].op, "if");
  assert.deepEqual((whileMine.ops[0] as { cond: unknown }).cond, { kind: "isTurnPlayer" });
  assert.deepEqual((one("This card gets +5000 power during your opponent's turn.").ops[0] as { cond: unknown }).cond, { kind: "isTurnPlayer", who: "opponent" });

  // The tails that really are only a duration still read.
  for (const tail of ["for the turn", "for the duration of the battle", "until the end of your opponent's turn"]) {
    assert.deepEqual(one(`This card gets +5000 power ${tail}.`).unsupported, [], tail);
  }
}

// ── a condition printed after its effect (XD1-01) ──────────────────────────

{
  // The skill kind decides how a trailing "when" reads, so these are compiled
  // with their real tags rather than through a wrapper.
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // XD1-01 prints its condition *after* the effect. Both halves already read —
  // the condition by `parseConditionClause`, the effect by the clause patterns
  // — so the leading and the trailing form must compile to the same program.
  const trailing = one("[Permanent] This card gets +5000 power when all of your opponent's energy is in Rest Mode.");
  assert.deepEqual(trailing.unsupported, []);
  assert.equal(trailing.ops[0].op, "if");
  const cond = (trailing.ops[0] as { cond: { kind: string; sel: { side: string; area: string }; matching: { mode: string } } }).cond;
  assert.equal(cond.kind, "every");
  assert.equal(cond.sel.side, "opponent");
  assert.equal(cond.sel.area, "energy");
  assert.equal(cond.matching.mode, "rest");
  assert.deepEqual(one("[Permanent] If all of your opponent's energy is in Rest Mode, this card gets +5000 power.").ops, trailing.ops, "the two orders are one rule");

  // "While" and "as long as" say the same thing on a [Permanent], which never
  // resolves: the static layer asks the condition again every time.
  const leading = one("[Permanent] If your life is at 4 or less, this card gets +5000 power.");
  for (const word of ["when", "while", "as long as"]) {
    assert.deepEqual(one(`[Permanent] This card gets +5000 power ${word} your life is at 4 or less.`).ops, leading.ops, word);
  }

  // On any other skill kind the same word is the skill's *trigger*, asked at a
  // different moment. Reading it as a condition would quietly turn one rule
  // into the other, so it stays an honest gap.
  for (const tag of ["[Auto]", "[Activate: Main]"]) {
    assert.ok(one(`${tag} Draw 1 card when this card attacks.`).unsupported.length > 0, `a trailing trigger is not a condition (${tag})`);
  }

  // "If" is a condition wherever it is printed, on any skill kind.
  const trailingIf = one("[Auto] When you play this card, draw 1 card if your Leader Card is red.");
  assert.deepEqual(trailingIf.unsupported, []);
  assert.equal(trailingIf.ops[0].op, "if");
  assert.deepEqual((trailingIf.ops[0] as { then: unknown }).then, [{ op: "draw", n: 1 }]);

  // A tail that is not a condition at all still fails the whole clause.
  assert.ok(one("[Permanent] This card gets +5000 power when your opponent is winning.").unsupported.length > 0, "an unreadable condition is a gap");

  // A colon in the tail is a skill's own cost/effect boundary, never
  // punctuation inside a condition — so a second skill run on after the first
  // is not a trailing condition, however much it looks like one. Without this
  // the bare "[Wish]" tag was read as the effect (a tag compiles, to "gains
  // [Wish]") and the whole of the second skill as its condition. No sentence
  // ends before the tag here, so `splitRunOn` cannot separate them either, and
  // the skill's own colon is already spent on its cost — which is exactly how
  // the second colon reached the effect on EX24-01.
  const mashed = one("[Activate: Main] Switch this card to Rest Mode: Add 1 card to your hand [Wish] If you have 3 or more cards in your Drop: Draw 1 card.");
  assert.ok(mashed.unsupported.length > 0, "a second skill on the same line is not a trailing condition");
}

// ── two skills printed on one line (EX24-01, BT16-129) ─────────────────────

{
  // A keyword skill carries its own type instead of a type tag, so "[Wish]"
  // and "[Aegis …]" open a skill just as "[Auto]" does. Until `opensASkill`
  // knew that, EX24-01's [Wish] was absorbed into the [Activate: Main] printed
  // before it and never parsed as a skill at all.
  const wish = parseSkills(
    "[Activate: Main] Switch this card to Rest Mode: Add up to 2 ≪Power Wish≫ cards from your deck to your hand, then shuffle your deck. [Wish] If you have a total of 7 or more ≪Power Wish≫ cards with different card names among all cards in your Z-Energy and/or Drop: Switch up to 1 of your energy to Active Mode.",
  );
  assert.equal(wish.length, 2, "the [Wish] opens a skill of its own");
  assert.equal(wish[0].kind, "activate:main");
  assert.equal(wish[1].keyword?.name, "Wish");
  assert.equal(wish[1].effect, "Switch up to 1 of your energy to Active Mode.");
  for (const s of wish) assert.deepEqual(compileSkill(s).unsupported, [], s.effect);

  // A bare carriage return separates skills on 307 faces of the original game,
  // which carry no <br> at all. Split on "\n" alone, every one of those cards
  // arrived as a single fused skill: BT16-129's [Aegis] and the [Permanent]
  // after it were one line, and its keyword skills were never their own.
  const cr = parseSkills("[Blocker]\r [Auto]{y}{y}, if your Leader Card is yellow: When this card is KO'd, draw 1 card.");
  assert.equal(cr.length, 2, "a carriage return separates skill lines");
  assert.equal(cr[0].keyword?.name, "Blocker");
  assert.equal(cr[1].kind, "auto");
  // \r\n is one break, not two.
  assert.equal(parseSkills("[Blocker]\r\n[Critical]").length, 2, "CRLF is a single break");
}
