/**
 * The wordings the compiler learned after the keywords: secret areas, energy,
 * prohibitions, replacements, prices, and the sentences that were being cut in
 * the wrong place.
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
  compileCostProgram,
  compileSkill,
  costIsOnlyOrbs,
  costText,
  find,
  forbids,
  koCard,
  labels,
  locate,
  matches,
  move,
  parseConditionClause,
  parseFilter,
  parseSkills,
  parseTarget,
  play,
  playCost,
  powerOf,
  priceCondition,
  skillLines,
  skillNegated,
  skillsNegated,
} from "./harness";

// ── searching a secret area (20-12), and the rest of what was looked at ────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // "with an energy cost of 3 and 5000 power": the "and" joins two measures of
  // one card description, and splitting on it left both halves unreadable.
  const search = one("[Auto] When you play this card, add up to 1 yellow <Son Goku> card with an energy cost of 3 and 5000 power from your deck to your hand, then shuffle your deck.");
  assert.deepEqual(search.unsupported, []);
  assert.deepEqual(
    search.ops.map((o) => o.op),
    ["choose", "moveTo", "shuffle"],
  );
  const found = (search.ops[0] as { sel: { area?: string; filter?: { costMin: number | null; powerMin: number | null } } }).sel;
  assert.equal(found.area, "deck");
  assert.equal(found.filter?.costMin, 3, "the cost is read");
  assert.equal(found.filter?.powerMin, 5000, "and so is the power behind the 'and'");

  // The set prints the two measures in either order.
  const other = one("[Auto] When you play this card, add up to 1 card with 5000 power and an energy cost of 2 or less from your deck to your hand.");
  assert.deepEqual(other.unsupported, []);
  assert.equal((other.ops[0] as { sel: { filter?: { costMax: number | null; powerMax: number | null } } }).sel.filter?.costMax, 2);

  // "for each" still reads a bare power as a measure of the *target*, not of
  // the bonus: "+5000 power" must not become a filter.
  const buff = one("[Auto] When you play this card, choose 1 of your Battle Cards and it gets +5000 power for the turn.");
  assert.deepEqual(buff.unsupported, []);
  assert.equal((buff.ops[0] as { sel: { filter?: unknown } }).sel.filter, undefined, "the bonus is not a bound on the choice");

  // "Among them" names its own target and only says where to look for it.
  // Read as an "it" this became *this card*, which was silently wrong.
  const dig = one(
    "[Auto] When you play this card, look at the top 3 cards of your deck, add up to 1 <Son Goku> card among them to your hand, and place the rest at the bottom of your deck in any order.",
  );
  assert.deepEqual(dig.unsupported, []);
  assert.deepEqual(
    dig.ops.map((o) => o.op),
    ["look", "choose", "moveTo", "moveTo"],
  );
  assert.equal((dig.ops[1] as { sel: { fromVar?: string } }).sel.fromVar, "looked");
  // "The rest" is what the choice did not take, so the card added to the hand
  // is not put back at the bottom of the deck.
  assert.deepEqual((dig.ops[3] as { target: unknown }).target, { var: "looked", minus: "c0" });

  // A Z-card is the only thing said about the host, so it has to count as a
  // narrowing — without it the phrase named no area and the clause failed.
  const host = one("[Auto] When you play this card, place up to 1 red <Android 17> card from your deck under a Z-Extra in your Battle Area, then shuffle your deck.");
  assert.deepEqual(host.unsupported, []);
  assert.deepEqual(
    host.ops.map((o) => o.op),
    ["choose", "moveTo", "shuffle"],
  );

  // "Up to the number of cards in your Battle Area" — read off the board.
  const many = one("[Activate: Main] Look at cards from the top of your deck up to the number of cards in your Battle Area.");
  assert.deepEqual(many.unsupported, []);
  assert.equal((many.ops[0] as { n: { count?: { area?: string } } }).n.count?.area, "battle");
}

{
  // A clause that stands after a look and says only what to add, never where
  // from: "look at up to 5 cards from the top of your deck, **add up to 1
  // white ≪Android≫ card to your hand**". The newer sets stopped printing the
  // "among them" the block above reads, and without it the description named
  // no area — so 20-1-6's "an unqualified card is one on the table" took over
  // and the search offered the Battle Area, where the card was never going to
  // be. 191 skills across the catalog read that way.
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  type Choice = { sel: { area?: string; fromVar?: string; count?: number; upTo?: boolean; filter?: { colors: string[]; traits: string[]; costMax: number | null } } };

  const dig = one("[Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 white ≪Android≫ card to your hand, then shuffle your deck.");
  assert.deepEqual(dig.unsupported, []);
  assert.deepEqual(
    dig.ops.map((o) => o.op),
    ["look", "choose", "moveTo", "shuffle"],
  );
  assert.deepEqual(dig.ops[0], { op: "look", n: 5, as: "looked" });
  const pick = (dig.ops[1] as Choice).sel;
  assert.equal(pick.fromVar, "looked", "the card comes out of what was looked at");
  assert.equal(pick.area, undefined, "and not out of an area");
  // The look's own "up to 5" belongs to a clause of its own: read off the
  // whole sentence it would have sized this choice five cards wide.
  assert.equal(pick.count, 1);
  assert.equal(pick.upTo, true);
  assert.deepEqual(pick.filter?.colors, ["White"], "the colour word narrows the choice");
  // Traits are held as the clause spells them, which by here is lower case;
  // `matches` compares them that way too.
  assert.deepEqual(pick.filter?.traits, ["android"], "and so does the trait in guillemets");
  // Adding is a move out of the cards looked at, not a draw — a draw would
  // take the top of the deck and leave the chosen card where it was.
  assert.deepEqual(dig.ops[2], { op: "moveTo", target: { var: "c0" }, to: "hand" });
  // Nothing is said about the cards not taken, so nothing is emitted for
  // them; the shuffle that follows is what puts them back.
  assert.deepEqual(dig.ops[3], { op: "shuffle" });

  // A measure after the trait still reads, and "card" or "cards" makes no
  // difference to how many are taken.
  const two = one("[Activate: Main] Look at up to 7 cards from the top of your deck, add up to 2 green ≪Adventure≫ cards to your hand, then shuffle your deck.");
  assert.deepEqual(two.unsupported, []);
  assert.equal((two.ops[1] as Choice).sel.count, 2);
  const measured = one(
    "[Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 green ≪World Tournament≫ card with an energy cost of 4 or less to your hand, then shuffle your deck.",
  );
  assert.equal((measured.ops[1] as Choice).sel.filter?.costMax, 4);

  // "Up to 1 card" says nothing about the card at all, which is a description
  // and not a lack of one: an empty filter here would match nothing.
  const any = one("[Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 card to your hand, then shuffle your deck.");
  assert.deepEqual(any.unsupported, []);
  assert.equal((any.ops[1] as Choice).sel.fromVar, "looked");
  assert.equal((any.ops[1] as Choice).sel.filter, undefined, "nothing said, nothing required");

  // An area the text does print still wins: this is a search of the Drop that
  // happens to follow a look, not a pick out of the look.
  const drop = one("[Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 red ≪Saiyan≫ card from your Drop to your hand, then shuffle your deck.");
  assert.equal((drop.ops[1] as Choice).sel.area, "drop");
  assert.equal((drop.ops[1] as Choice).sel.fromVar, undefined);

  // With no look before it the clause is the deck search it has always been,
  // and must not go hunting for a variable nothing bound.
  const alone = one("[Activate: Main] Add up to 1 red ≪Saiyan≫ card from your deck to your hand, then shuffle your deck.");
  assert.deepEqual(alone.unsupported, []);
  assert.equal((alone.ops[0] as Choice).sel.area, "deck");
  assert.equal((alone.ops[0] as Choice).sel.fromVar, undefined);

  // "Add **it** to your hand" points back at the choice just made. Read as a
  // fresh description it became a second choice on top of the first, and the
  // player was asked to pick twice out of the same three cards.
  const pronoun = one("[Auto] When you play this card, look at the top 3 cards of your deck, choose up to 1 ≪Saiyan≫ card among them, add it to your hand, then shuffle your deck.");
  assert.deepEqual(
    pronoun.ops.map((o) => o.op),
    ["look", "choose", "moveTo", "shuffle"],
  );
  assert.deepEqual((pronoun.ops[2] as { target: unknown }).target, { var: "c0" });
}

{
  // The engine side: a search offers exactly the cards that match, and the
  // rest of the look goes back to the bottom of the deck (20-12-3).
  DEFS.DIGGER = {
    ...DEFS.V1,
    id: "DIGGER",
    name: "DIGGER",
    energyCost: 1,
    skill: "[Auto] When you play this card, look at the top 3 cards of your deck, add up to 1 card among them to your hand, and place the rest at the bottom of your deck in any order.",
  };
  let s = arena({ hand: ["DIGGER"], energy: ["V1"] });
  const [t1, t2, t3] = s.players.p1.deck;
  const deckSize = s.players.p1.deck.length;
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DIGGER") });
  assert.equal(s.prompt.kind, "chooseCards", "the player picks out of what was looked at");
  s = play(s, { type: "choose", player: "p1", cards: [t2] });
  assert.ok(s.players.p1.hand.includes(t2), "the chosen card is in hand");
  assert.equal(s.players.p1.hand.length, hand, "one in, one played out");
  assert.equal(s.players.p1.deck.length, deckSize - 1, "only the chosen card left the deck");
  assert.deepEqual(s.players.p1.deck.slice(-2), [t1, t3], "and they went to the bottom, not to the hand");
  assertConsistent(s);
}

// ── energy as an effect (3-8), and reading what a card turned up (20-11) ────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // "The top card of your deck" is a position, not a choice — reading it as
  // one handed the player their whole deck to pick from (20-12).
  const top = one("[Auto] When you play this card, place the top card of your deck in your energy in Rest Mode.");
  assert.deepEqual(top.unsupported, []);
  assert.deepEqual(
    top.ops.map((o) => o.op),
    ["moveTo"],
    "no choice: the deck is not searched",
  );
  assert.equal((top.ops[0] as { target: { sel?: { take?: number } } }).target.sel?.take, 1);

  // A number in the phrase is still a choice, and `switchMode` had never been
  // wrapped in one — "up to 1 of your energy" switched all of it.
  const sw = one("[Activate: Main] Draw 1 card, switch up to 1 of your energy to Active Mode, and add up to 1 card from your hand to your energy.");
  assert.deepEqual(sw.unsupported, []);
  assert.deepEqual(
    sw.ops.map((o) => o.op),
    ["draw", "choose", "switchMode", "choose", "moveTo"],
  );

  // Whose energy area, which is not always the card's owner (3-8).
  const gift = one(
    "[Auto] When you play this card, reveal the top card of your opponent's deck. If that card is a Battle Card, place it in your opponent's energy in Rest Mode, otherwise draw 1 card.",
  );
  assert.deepEqual(gift.unsupported, []);
  assert.deepEqual(
    gift.ops.map((o) => o.op),
    ["reveal", "if", "if"],
  );
  const then = (gift.ops[1] as { then: { op: string; owner?: string; mode?: string }[] }).then[0];
  assert.equal(then.owner, "opponent", "into their energy, not its owner's");
  assert.equal(then.mode, "rest");
  // "Otherwise" is the opposite of the condition just asked.
  assert.equal((gift.ops[2] as { cond: { kind: string } }).cond.kind, "not");
  assert.deepEqual(
    (gift.ops[2] as { then: { op: string }[] }).then.map((o) => o.op),
    ["draw"],
  );

  // Looking at a hand is a whole area, not an end of a deck.
  assert.deepEqual(one("[Activate: Main] Look at your opponent's hand.").ops, [{ op: "look", n: 99, as: "looked", side: "opponent", area: "hand" }]);
}

{
  // The engine side of a reveal: the card is named in the log, stays where it
  // was, and the clause after it acts on what was turned up.
  DEFS.PEEP = {
    ...DEFS.V1,
    id: "PEEP",
    name: "PEEP",
    energyCost: 1,
    skill: "[Auto] When you play this card, reveal the top card of your opponent's deck. If that card is a Battle Card, place it in your opponent's energy in Rest Mode, otherwise draw 1 card.",
  };
  let s = arena({ hand: ["PEEP"], energy: ["V1"] });
  const top = s.players.p2.deck[0];
  const energy = s.players.p2.energy.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "PEEP") });
  // Every card the arena's synthetic decks hold is a Battle Card, so the
  // "then" branch is the one that runs.
  assert.ok(s.players.p2.energy.includes(top), "it went into *their* energy");
  assert.equal(s.players.p2.energy.length, energy + 1);
  assert.equal(s.cards[top].mode, "rest", "and in Rest Mode");
  assert.equal(s.cards[top].owner, "p2");
  assertConsistent(s);
}

// ── three more things a card can forbid (20-14) ────────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // "Can't be removed from a Battle Area by your opponent's skills" is not the
  // same rule as "can't be KO'd": a move by a skill, and nothing else.
  const stay = one("[Permanent] Your green non-<Bulma> ≪Adventure≫ cards can't be removed from a Battle Area by your opponent's skills.");
  assert.deepEqual(stay.unsupported, []);
  assert.equal((stay.ops[0] as { what: string; side?: string }).what, "beMovedBySkill");
  assert.equal((stay.ops[0] as { side?: string }).side, "opponent");

  const keep = one("[Permanent] This card's skills can't be negated in any area.");
  assert.deepEqual(keep.unsupported, []);
  assert.deepEqual(keep.ops, [{ op: "forbid", what: "beNegated", until: "game", target: { sel: { special: "self" } } }]);

  const noCharge = one("[Auto] When you play this card, you can't place cards in your energy for the turn.");
  assert.deepEqual(noCharge.unsupported, []);
  assert.deepEqual(noCharge.ops, [{ op: "forbid", what: "placeEnergy", side: "you", until: "turn" }]);

  const counted = one("[Auto] When you play this card, your opponent can only attack one more time with Battle Cards for the duration of the turn.");
  assert.deepEqual(counted.unsupported, []);
  assert.equal((counted.ops[0] as { op: string }).op, "forbid");
  assert.equal((counted.ops[0] as { uses: number }).uses, 1);

  const escaped = one("[Permanent] Your opponent can't play Battle Cards unless your opponent has 3 or more energy.");
  assert.deepEqual(escaped.unsupported, []);
  assert.equal((escaped.ops[0] as { op: string }).op, "forbid");
  assert.equal((escaped.ops[0] as { unless?: { kind: string } }).unless?.kind, "count");

  // The same rule printed as "will not" rather than "can't", and a duration
  // that has to outlive "your next turn" by one step (7-2-7).
  const lock = one("[Activate: Main] Choose 1 of your opponent's Battle Cards and switch it to Rest Mode. The chosen card will not switch to Active Mode during your next Charge Phase.");
  assert.deepEqual(lock.unsupported, []);
  assert.deepEqual(
    lock.ops.map((o) => o.op),
    ["choose", "switchMode", "forbid"],
  );
  assert.equal((lock.ops[2] as { until: string }).until, "afterNextCharge");

  // A [Counter: Play] asking about the card it is answering (9-6).
  const gate = parseConditionClause("if the Battle Card being played has an energy cost of 7 or less");
  assert.ok(gate, "the condition is readable even though negating a play is not");
  assert.equal((gate.cond as { sel: { special?: string; filter?: { costMax: number | null } } }).sel.special, "resolving");
  assert.equal((gate.cond as { sel: { filter?: { costMax: number | null } } }).sel.filter?.costMax, 7);

  // "If the chosen card is a <X> card" — the same reading as "that card", over
  // the choice rather than over a reveal.
  const check = one("[Auto] When you play this card, choose 1 card in your Drop Area. If the chosen card is a <Supreme Kai of Time> card, draw 1 card.");
  assert.deepEqual(check.unsupported, []);
  assert.deepEqual((check.ops[1] as { cond: { kind: string; var: string } }).cond.var, "c0");
}

{
  // A rest-lock has to survive the opponent's whole turn *and* the Active Step
  // of the next one, which is where a "nextTurn" effect would already be gone.
  DEFS.LOCKER = {
    ...DEFS.V1,
    id: "LOCKER",
    name: "LOCKER",
    energyCost: 1,
    skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and switch it to Rest Mode. The chosen card will not switch to Active Mode during your next Charge Phase.",
  };
  let s = arena({ hand: ["LOCKER"], energy: ["V1"], oppBattle: ["V-BLUE"] });
  const victim = s.players.p2.battle[0];
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "LOCKER") });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [victim] });
  assert.equal(s.cards[victim].mode, "rest", "it was switched to Rest Mode");
  // Their turn: their Active Step runs and must leave it rested.
  s = play(s, { type: "endMain", player: "p1" });
  assert.equal(s.cards[victim].mode, "rest", "7-2-7 did not switch it back");
  assert.ok(!s.effects.some((e) => e.until === "afterNextCharge"), "and the rule is spent");
  assertConsistent(s);
}

{
  // A card whose skills can't be negated keeps them, and keeps its keywords.
  DEFS.STUBBORN = { ...DEFS.BLOCKER, id: "STUBBORN", name: "STUBBORN", skill: "[Blocker]<br>[Permanent] This card's skills can't be negated in any area." };
  DEFS.SILENCER = {
    ...DEFS.V1,
    id: "SILENCER",
    name: "SILENCER",
    energyCost: 1,
    skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate its skills for the turn.",
  };
  let s = arena({ hand: ["SILENCER"], energy: ["V1"], oppBattle: ["STUBBORN"] });
  const stubborn = s.players.p2.battle[0];
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "SILENCER") });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [stubborn] });
  assert.ok(!skillsNegated(s, stubborn), "0-2-5: the prohibition beats the instruction");
  assertConsistent(s);
}

{
  // "You can't place cards in your energy for the turn" is a rule about a
  // player, and the Charge Phase is the one place it bites.
  DEFS.DROUGHT = { ...DEFS.V1, id: "DROUGHT", name: "DROUGHT", energyCost: 1, skill: "[Permanent] Your opponent can't place cards in their energy." };
  let s = arena({ hand: ["DROUGHT"], energy: ["V1"] });
  assert.ok(!forbids(CTX, s, "placeEnergy", { player: "p2" }), "nothing forbids it yet");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DROUGHT") });
  assert.ok(forbids(CTX, s, "placeEnergy", { player: "p2" }), "the [Permanent] holds while the card is in play");
  assert.ok(!forbids(CTX, s, "placeEnergy", { player: "p1" }), "and only against them");
  // Their Charge Phase then offers nothing to charge.
  s = play(s, { type: "endMain", player: "p1" });
  assert.equal(s.prompt.kind, "charge", "it is their Charge Phase");
  assert.deepEqual(labels(s), ["Skip charge"], "and there is nothing to do in it");
}

// ── counting the cards under a card (23-2), and the type words ─────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const countOf = (sc: { ops: unknown[] }) => (sc.ops[0] as { amount: { count: { area?: string; special?: string; filter?: { notType: string | null } } } }).amount.count;

  // "For each card placed under it" is about the stack. The phrase used to be
  // taken for "this card" and counted one, whatever the stack held.
  const stack = one("[Permanent] This card gets +5000 power for each card placed under it.");
  assert.deepEqual(stack.unsupported, []);
  assert.equal(countOf(stack).area, "under");
  assert.equal(countOf(stack).special, undefined, "not the card on top");

  // "Non-Leader" is the type it must *not* be — read as the type itself, the
  // filter counted Leaders and nothing else.
  const nonLeader = one("[Permanent] This card gets +5000 power for each non-Leader card under this card.");
  assert.deepEqual(nonLeader.unsupported, []);
  assert.equal(countOf(nonLeader).filter?.notType, "LEADER");
  assert.equal(matches({ ...DEFS.V1 }, parseFilter("non-Leader card")), true, "a Battle Card is a non-Leader card");
  assert.equal(matches({ ...DEFS.V1, type: "LEADER" }, parseFilter("non-Leader card")), false);

  // "Multicolor" is two colours or more, which is not what mono-colour denies.
  assert.equal(matches({ ...DEFS.V1, colors: ["Red", "Blue"] }, parseFilter("multicolor <V1> cards")), true);
  assert.equal(matches({ ...DEFS.V1, colors: ["Red"] }, parseFilter("multicolor <V1> cards")), false);
}

{
  // The engine side: the power really does follow the size of the stack.
  DEFS.PILE = { ...DEFS.V1, id: "PILE", name: "PILE", skill: "[Permanent] This card gets +5000 power for each card placed under it." };
  const s = arena({ battle: ["PILE"] });
  const pile = s.players.p1.battle[0];
  const base = powerOf(CTX, s, pile);
  const [a, b] = s.players.p1.deck;
  s.cards[pile].under.push(a, b);
  s.players.p1.deck = s.players.p1.deck.filter((id) => id !== a && id !== b);
  assert.equal(powerOf(CTX, s, pile), base + 10000, "two cards under it, +10000");
}

// ── what a replacement replaces (9-10) ─────────────────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // "Instead" is the word every replacement ends on, and it broke the anchor
  // of every move pattern but one: the same sentence without it compiled.
  const warp = one("[Permanent] If this card would be KO'd, send it to the Warp instead.");
  assert.deepEqual(warp.unsupported, []);
  assert.deepEqual(warp.ops, [{ op: "replaceLeave", to: "warp", target: { sel: { special: "self" } }, by: "ko" }]);

  // "Would be KO'd" replaces the KO and nothing else; "would leave the Battle
  // Area" replaces every departure, so it carries no cause at all.
  assert.equal((one("[Permanent] If this card would leave the Battle Area, return it to its owner's hand instead.").ops[0] as { by?: string }).by, undefined);
  assert.equal((one("[Permanent] If this card would be removed from the Battle Area by a skill, send it to the Warp instead.").ops[0] as { by?: string }).by, "skill");

  // BT30-016: other cards by filter, both causes, and the mode it arrives in.
  const earthling = one("[Permanent] If your blue ≪Earthling≫ card would be removed from a Battle Area by a skill or KO'd, add that card to your energy in Rest Mode instead.");
  assert.deepEqual(earthling.unsupported, []);
  const rep = earthling.ops[0] as { to: string; by?: string; mode?: string; target: { sel: { filter?: { traits: string[] } } } };
  assert.equal(rep.to, "energy");
  assert.equal(rep.by, "skillOrKo");
  assert.equal(rep.mode, "rest", "the replacement says how it arrives as well as where");
  assert.deepEqual(rep.target.sel.filter?.traits, ["earthling"], "and which cards it is about");

  const may = one("[Permanent] If this card would leave the Battle Area, you may send it to your Warp instead.");
  assert.deepEqual(may.unsupported, []);
  assert.equal((may.ops[0] as { optional?: boolean }).optional, true, '"you may" stays on the replacement');
}

{
  // The engine side. A KO-only replacement sends the card to the Warp…
  DEFS.PHOENIX = { ...DEFS.V1, id: "PHOENIX", name: "PHOENIX", skill: "[Permanent] If this card would be KO'd, send it to the Warp instead." };
  const s = arena({ battle: ["PHOENIX"], oppBattle: ["BIG"] });
  const bird = s.players.p1.battle[0];
  koCard(CTX, s, [], bird);
  assert.ok(s.players.p1.warp.includes(bird), "9-10: it went to the Warp, not the Drop");
  assert.ok(!s.players.p1.drop.includes(bird));
  assertConsistent(s);

  // …and leaves an ordinary skill-move alone, which is what `by` is for.
  const t = arena({ battle: ["PHOENIX"] });
  const bird2 = t.players.p1.battle[0];
  move(CTX, t, [], bird2, "hand", "p1", { reason: "effect" });
  assert.ok(t.players.p1.hand.includes(bird2), "a return to hand is not a KO");
  assertConsistent(t);
}

{
  // A replacement that covers *other* cards by filter, and says the mode.
  DEFS.WARDEN = {
    ...DEFS.V1,
    id: "WARDEN",
    name: "WARDEN",
    skill: "[Permanent] If your ≪Earthling≫ card would be removed from a Battle Area by a skill or KO'd, add that card to your energy in Rest Mode instead.",
  };
  DEFS.PEASANT = { ...DEFS.V1, id: "PEASANT", name: "PEASANT", traits: ["Earthling"] };
  const s = arena({ battle: ["WARDEN", "PEASANT", "BIG"] });
  const peasant = s.players.p1.battle.find((id) => s.cards[id].cardId === "PEASANT")!;
  const big = s.players.p1.battle.find((id) => s.cards[id].cardId === "BIG")!;
  const energy = s.players.p1.energy.length;
  koCard(CTX, s, [], peasant);
  assert.ok(s.players.p1.energy.includes(peasant), "the ≪Earthling≫ card went to the energy");
  assert.equal(s.players.p1.energy.length, energy + 1);
  assert.equal(s.cards[peasant].mode, "rest", "and in Rest Mode, as printed");
  // A card the filter does not name still goes to the Drop.
  koCard(CTX, s, [], big);
  assert.ok(s.players.p1.drop.includes(big), "9-10 only replaces what the skill names");
  assertConsistent(s);
}

{
  // An optional replacement asks the affected player, and declining keeps the
  // original move instead of silently taking the replacement.
  let s = arena({ battle: ["MAYWARP"], oppHand: ["KILLER"], oppEnergy: ["V1"] });
  const may = find(s, "p1", "battle", "MAYWARP");
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = play(s, { type: "play", player: "p2", card: find(s, "p2", "hand", "KILLER") }, { type: "choose", player: "p2", cards: [may] });
  assert.equal(s.prompt.kind, "replaceMove");
  assert.equal((s.prompt as { player: string }).player, "p1");
  assert.deepEqual(
    labels(s),
    ["To the Warp", "Keep going to the Drop"],
  );
  const accepted = play(s, { type: "chooseMode", player: "p1", index: 0 });
  assert.ok(accepted.players.p1.warp.includes(may), "taking the offer sends it to the Warp");
  assert.ok(!accepted.players.p1.drop.includes(may));
  assertConsistent(accepted);

  const declined = play(s, { type: "chooseMode", player: "p1", index: 1 });
  assert.ok(declined.players.p1.drop.includes(may), "declining keeps the ordinary KO");
  assert.ok(!declined.players.p1.warp.includes(may));
  assertConsistent(declined);
}

{
  // 9-10-2: when two replacements apply, the affected player chooses which one.
  let s = arena({ battle: ["EARTHWARP", "WARDEN"], oppHand: ["KILLER"], oppEnergy: ["V1"] });
  const earthwarp = find(s, "p1", "battle", "EARTHWARP");
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = play(s, { type: "play", player: "p2", card: find(s, "p2", "hand", "KILLER") }, { type: "choose", player: "p2", cards: [earthwarp] });
  assert.equal(s.prompt.kind, "replaceMove");
  assert.deepEqual(
    labels(s),
    ["To the Warp", "To the Energy Area in Rest Mode"],
  );
  s = play(s, { type: "chooseMode", player: "p1", index: 1 });
  assert.ok(s.players.p1.energy.includes(earthwarp), "the chosen replacement is the one that happens");
  assert.equal(s.cards[earthwarp].mode, "rest");
  assert.ok(!s.players.p1.warp.includes(earthwarp));
  assertConsistent(s);
}

{
  // A mandatory replacement still happens when an optional one also applies.
  DEFS.MAYEARTH = {
    ...DEFS.V1,
    id: "MAYEARTH",
    name: "MAYEARTH",
    traits: ["Earthling"],
    skill: "[Permanent] If this card would leave the Battle Area, you may send it to your Warp instead.",
  };
  let s = arena({ battle: ["MAYEARTH", "WARDEN"], oppHand: ["KILLER"], oppEnergy: ["V1"] });
  const mayearth = find(s, "p1", "battle", "MAYEARTH");
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = play(s, { type: "play", player: "p2", card: find(s, "p2", "hand", "KILLER") }, { type: "choose", player: "p2", cards: [mayearth] });
  assert.equal(s.prompt.kind, "replaceMove");
  assert.deepEqual(labels(s), ["To the Warp", "To the Energy Area in Rest Mode"]);
  s = play(s, { type: "chooseMode", player: "p1", index: 0 });
  assert.ok(s.players.p1.warp.includes(mayearth), "the optional replacement may still be chosen");
  assertConsistent(s);
}

{
  // A replacement prompt mid-loop resumes the rest of the KO list afterwards.
  let s = arena({ battle: ["MAYWARP", "V1"], oppHand: ["TWOKILL"], oppEnergy: ["V1"] });
  const may = find(s, "p1", "battle", "MAYWARP");
  const plain = s.players.p1.battle.find((id) => id !== may)!;
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = play(s, { type: "play", player: "p2", card: find(s, "p2", "hand", "TWOKILL") });
  assert.equal(s.prompt.kind, "replaceMove");
  s = play(s, { type: "chooseMode", player: "p1", index: 1 });
  assert.ok(s.players.p1.drop.includes(may), "the prompted card still follows the answer");
  assert.ok(s.players.p1.drop.includes(plain), "and the rest of the loop still finishes");
  assertConsistent(s);
}

// ── what a cost reduction is about, and how much (20-21) ───────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const sel = (sc: { ops: unknown[] }) => (sc.ops[0] as { target: { sel?: { area?: string } } }).target.sel;

  // The area the text names is part of the target. It used to be stripped out
  // of the phrase, so a reducer for cards "in your hand" selected cards in
  // play — it compiled, and then did nothing at all.
  const hand = one("[Permanent] Reduce the energy cost of your <Son Goku> cards in your hand by 1.");
  assert.deepEqual(hand.unsupported, []);
  assert.equal(sel(hand)?.area, "hand");

  // A phrase that names no area is about the card you are about to play, not
  // about a card on the table — 20-1-6's default is the one place a cost
  // reduction can never matter.
  const named = one("[Permanent] Reduce the energy cost of a {Power Pole} by {r}.");
  assert.deepEqual(named.unsupported, []);
  assert.equal(sel(named)?.area, "hand");
  assert.equal((named.ops[0] as { amount: number }).amount, 1, "an orb is one less");

  // "For each …" is the same count amount the power statics take.
  const each = one("[Permanent] Reduce the energy cost of this card in your hand by 1 for each of your blue Battle Cards.");
  assert.deepEqual(each.unsupported, []);
  assert.equal((each.ops[0] as { amount: { count?: { area?: string } } }).amount.count?.area, "battle");
}

{
  // The engine side: the reduction is real, it follows the board, and it
  // reaches a card in hand — which is the only place it could ever apply.
  DEFS.CHEAP = { ...DEFS.V1, id: "CHEAP", name: "CHEAP", energyCost: 4 };
  DEFS.DISCOUNT = { ...DEFS.V1, id: "DISCOUNT", name: "DISCOUNT", skill: "[Permanent] Reduce the energy cost of your <CHEAP> cards in your hand by 1 for each of your blue Battle Cards." };
  DEFS.CHEAP.characters = ["CHEAP"];
  const s = arena({ hand: ["CHEAP"], battle: ["DISCOUNT"] });
  const cheap = find(s, "p1", "hand", "CHEAP");
  assert.equal(playCost(CTX, s, cheap).total, 4, "no blue Battle Cards yet");
  // One blue Battle Card on the board takes one off.
  const blue = s.players.p1.deck.find((id) => s.cards[id].cardId === "V-BLUE") ?? s.players.p1.deck[0];
  move(CTX, s, [], blue, "battle", "p1");
  s.cards[blue].cardId = "V-BLUE";
  assert.equal(playCost(CTX, s, cheap).total, 3, "20-21: one blue Battle Card, one less");
}

// ── negating one kind of skill, not all of them (9-1-5) ────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  const auto = one("[Counter: Attack] Choose 1 of your opponent's Battle Cards and negate that card's [Auto] skill for the duration of turn.");
  assert.deepEqual(auto.unsupported, []);
  assert.deepEqual(auto.ops[1], { op: "negateSkillsOfKind", target: { var: "c0" }, kind: "auto", until: "turn" });

  // A printed "[Counter]" covers every counter kind, so the stored value is a
  // prefix. And the tag must be read *before* the bare "negate … skills"
  // pattern, whose subject would otherwise swallow it and silence the card.
  assert.equal(
    (one("[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate that card's [Counter] skills for the turn.").ops[1] as { op: string; kind?: string }).kind,
    "counter",
  );
  assert.equal(
    (one("[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate that card's skills for the turn.").ops[1] as { op: string }).op,
    "negateSkills",
    "a bare 'skills' still silences everything",
  );

  // "Negate this skill for the battle" — the third duration, which had to be
  // an effect rather than a mark, because the skill comes back.
  const once = one("[Auto] When this card attacks, this card gets +5000 power for the battle. Negate this skill for the battle.");
  assert.deepEqual(once.unsupported, []);
  assert.deepEqual(once.ops[1], { op: "negateOwnSkill", until: "battle" });
}

{
  // The engine side: an [Auto] is silenced and an [Activate] on the same card
  // is not, which is the whole point of naming a kind.
  DEFS.TWOSKILL = {
    ...DEFS.V1,
    id: "TWOSKILL",
    name: "TWOSKILL",
    skill: "[Auto] When this card attacks, draw 1 card.<br>[Activate: Main] Draw 1 card.",
  };
  DEFS.HUSH = {
    ...DEFS.V1,
    id: "HUSH",
    name: "HUSH",
    energyCost: 1,
    skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate that card's [Auto] skill for the turn.",
  };
  let s = arena({ hand: ["HUSH"], energy: ["V1"], oppBattle: ["TWOSKILL"] });
  const quiet = s.players.p2.battle[0];
  const skills = parseSkills(DEFS.TWOSKILL.skill!);
  assert.equal(skills.length, 2, "the card really does have two skills of different kinds");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "HUSH") });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [quiet] });
  assert.ok(skillNegated(s, quiet, skills[0].index, skills[0].kind), "the [Auto] is negated");
  assert.ok(!skillNegated(s, quiet, skills[1].index, skills[1].kind), "the [Activate: Main] is not");
  assert.ok(!skillsNegated(s, quiet), "and the card is not silenced");
  assertConsistent(s);
}

// ── what a [Counter: Play] does to the card it answers (9-6) ───────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  const stop = one("[Counter: Play] Choose 1 Battle Card with an energy cost of 2 or less being played by your opponent. It is placed in its owner's Drop Area instead of being played.");
  assert.deepEqual(stop.unsupported, []);
  // "Being played" names the card the counter is answering — there is only
  // ever one — so it is not a choice among the cards already in play.
  assert.equal((stop.ops[0] as { sel: { special?: string } }).sel.special, "resolving");
  assert.deepEqual(stop.ops[1], { op: "resolvingPlay", instead: "drop" });

  const deck = one("[Counter: Play] If the Battle Card being played has an energy cost of 7 or less, it's placed at the bottom of its owner's deck instead of being played.");
  assert.deepEqual(deck.unsupported, []);
  assert.deepEqual((deck.ops[0] as { then: unknown[] }).then, [{ op: "resolvingPlay", instead: "deck", position: "bottom" }]);

  // Without "instead of being played" the play happens; only the manner changes.
  assert.deepEqual(one("[Counter: Play] The Battle Card being played is played in Rest Mode.").ops, [{ op: "resolvingPlay", mode: "rest" }]);
  assert.deepEqual(one("[Counter: Play] It's played with its skills negated for the turn.").ops, [{ op: "resolvingPlay", negated: true }]);
}

{
  // The engine side: the card never reaches the Battle Area, and the energy
  // stays paid — negating a play does not undo the cost (9-6).
  DEFS["E-STOP"] = { ...DEFS["E-NEGATE"], id: "E-STOP", name: "E-STOP", skill: "[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played." };
  let s = arena({ hand: ["V1"], energy: ["V1", "V1"], oppHand: ["E-STOP"], oppEnergy: ["V1"] });
  const played = find(s, "p1", "hand", "V1");
  const battle = s.players.p1.battle.length;
  s = play(s, { type: "play", player: "p1", card: played });
  assert.equal(s.prompt.kind, "counter", "the [Counter: Play] window");
  s = play(s, { type: "counter", player: "p2", card: find(s, "p2", "hand", "E-STOP"), skill: 0 });
  while (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [] });
  assert.ok(s.players.p1.drop.includes(played), "it went to the Drop");
  assert.equal(s.players.p1.battle.length, battle, "and never reached the Battle Area");
  assert.equal(s.players.p1.energy.filter((id) => s.cards[id].mode === "rest").length, 1, "the energy stays paid");
  assertConsistent(s);
}

{
  // "Played in Rest Mode" and "played with its skills negated" let the play
  // happen — the two continuations `resolvePlay` reads and nothing ever wrote.
  DEFS["E-TIRE"] = { ...DEFS["E-NEGATE"], id: "E-TIRE", name: "E-TIRE", skill: "[Counter: Play] The Battle Card being played is played in Rest Mode." };
  let s = arena({ hand: ["V1"], energy: ["V1", "V1"], oppHand: ["E-TIRE"], oppEnergy: ["V1"] });
  const played = find(s, "p1", "hand", "V1");
  s = play(s, { type: "play", player: "p1", card: played });
  s = play(s, { type: "counter", player: "p2", card: find(s, "p2", "hand", "E-TIRE"), skill: 0 });
  assert.ok(s.players.p1.battle.includes(played), "the play still happened");
  assert.equal(s.cards[played].mode, "rest", "but the card arrived rested");
  assertConsistent(s);
}

// ── three ways a sentence was being cut in the wrong place ─────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // The full-width hyphen-minus after "choose one". Left out of the dash
  // class it survived into the options list as an option of its own — which
  // is where the six bare "－" clauses in the gap report came from.
  const modal = one(
    "[Auto] When this card is played from your hand, choose one－<br>・Choose up to 1 of your opponent's Battle Cards and place it at the bottom of its owner's deck.<br>・If your Leader Card is a green <Son Goku> card, draw 1 card.",
  );
  assert.deepEqual(modal.unsupported, []);
  const modes = (modal.ops.find((o) => o.op === "chooseMode") as { modes: { label: string; ops: unknown[] }[] } | undefined)?.modes;
  assert.equal(modes?.length, 2, "two printed options, and no dash among them");
  assert.ok(
    modes?.every((mode) => mode.ops.length),
    "both of them do something",
  );

  // "All cards in your opponent's Battle Cards and Unisons" names two areas.
  // Split on the "and", the second half was a bare area word and the first
  // half quietly narrowed to one area.
  const both = one("[Auto] When this card attacks, choose up to 2 total cards from among all cards in your opponent's Battle Cards and Unisons and they get -15000 power for the turn.");
  assert.deepEqual(both.unsupported, []);
  assert.deepEqual((both.ops[0] as { sel: { areas?: string[] } }).sel.areas, ["battle", "unison"]);

  // "When your ≪Turtle School≫ card attacks …, **it** gets +10000 power" — a
  // trigger about a card other than this one. "It" is the trigger's subject,
  // which the engine binds; before this it pointed at nothing.
  //
  // 9-6-2: and the clause also said *which* card. Dropping it dropped that
  // too, so the skill fired for anything of yours that attacked; what the
  // clause said is now a condition on the same subject, and the effect sits
  // inside it.
  const other = one("[Auto] When your green ≪Turtle School≫ card with an energy cost of 5 or less attacks a Battle Card, it gets +10000 power for the turn.");
  assert.deepEqual(other.unsupported, []);
  const gate = other.ops[0] as { op: string; cond?: { sel?: { special?: string; filter?: { traits: string[]; costMax: number | null } } }; then?: { target: { sel?: { special?: string } } }[] };
  assert.equal(gate.op, "if");
  assert.equal(gate.cond?.sel?.special, "subject");
  assert.deepEqual(gate.cond?.sel?.filter?.traits, ["turtle school"]);
  assert.equal(gate.cond?.sel?.filter?.costMax, 5);
  assert.deepEqual(gate.then?.[0].target.sel?.special, "subject");
  // A trigger that says no more than "a card" keeps firing as it always did:
  // an over-fire is bad, but a wrong filter would stop a skill that should
  // happen, which is worse.
  assert.equal(one("[Auto] When your opponent plays a card, draw 1 card, then draw 1 card.").ops[0].op, "draw");
  // A trigger that does name this card still means this card.
  assert.deepEqual((one("[Auto] When this card attacks, it gets +5000 power for the turn.").ops[0] as { target: { sel?: { special?: string } } }).target.sel?.special, "self");
}

// ── an instruction carried out by the other player (20-7) ──────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // The selectors already point at their cards, because the sentence said
  // "their Drop Area"; what was missing was who picks which one.
  const warp = one("[Auto] When this card attacks, your opponent sends 1 Battle Card from their Drop Area to their Warp.");
  assert.deepEqual(warp.unsupported, []);
  assert.deepEqual(
    warp.ops.map((o) => o.op),
    ["choose", "moveTo"],
  );
  assert.equal((warp.ops[0] as { chooser?: string; sel: { side?: string } }).chooser, "opponent");
  assert.equal((warp.ops[0] as { sel: { side?: string } }).sel.side, "opponent");

  const bottom = one("[Auto] When this card is played, your opponent places 1 card from their hand at the bottom of their deck.");
  assert.deepEqual(bottom.unsupported, []);
  assert.equal((bottom.ops[0] as { chooser?: string }).chooser, "opponent");

  // It is only a fallback: the patterns that read the subject themselves say
  // it better. A hand card leaving for the Warp is a discard (20-7), and
  // "your opponent discards 1 card" names no area for the rewrite to keep.
  assert.deepEqual(one("[Auto] When this card attacks, your opponent sends 1 card from their hand to their Warp.").ops, [{ op: "discard", n: 1, side: "opponent", to: "warp" }]);
  const delayed = one("[Auto] When you play this card, during your opponent's next turn, your opponent discards 1 card.");
  assert.deepEqual((delayed.ops[0] as { ops: unknown[] }).ops, [{ op: "discard", n: 1, side: "opponent" }]);
}

{
  // "Their" is a possessive far more often than a pronoun. Read as one, "1
  // Battle Card from **their** Drop Area" became whatever the trigger had
  // last named — here, this card.
  const ref = compileSkill(parseSkills("[Auto] When this card attacks, your opponent sends 1 Battle Card from their Drop Area to their Warp.")[0]);
  assert.notDeepEqual((ref.ops[1] as { target: unknown }).target, { sel: { special: "self" } }, "not this card");

  // The engine side: the prompt goes to the player the card says chooses.
  DEFS.EXILE = {
    ...DEFS.V1,
    id: "EXILE",
    name: "EXILE",
    energyCost: 1,
    skill: "[Auto] When you play this card, your opponent places 1 card from their hand at the bottom of their deck.",
  };
  let s = arena({ hand: ["EXILE"], energy: ["V1"], oppHand: ["BIG", "BIG"] });
  const theirHand = s.players.p2.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "EXILE") });
  assert.equal(s.prompt.kind, "chooseCards");
  assert.equal(s.prompt.player, "p2", "20-7: their card, their choice");
  const pick = s.players.p2.hand[0];
  s = play(s, { type: "choose", player: "p2", cards: [pick] });
  assert.equal(s.players.p2.hand.length, theirHand - 1);
  assert.equal(s.players.p2.deck[s.players.p2.deck.length - 1], pick, "and it went to the bottom of their deck");
  assertConsistent(s);
}

// ── choosing a card the trigger already named (5-2) ────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // "Their" is a possessive inside a phrase and a pronoun on its own. Taking
  // it out of the pronoun list to fix "from **their** Drop Area" broke this,
  // the commonest wording on the list at the time.
  const negate = one("[Auto] When this card attacks, choose up to 2 of your opponent's Battle Cards and negate their skills for the turn.");
  assert.deepEqual(negate.unsupported, []);
  assert.deepEqual(negate.ops[1], { op: "negateSkills", target: { var: "c0" }, until: "turn" });

  // "You may choose that card": the trigger named it, so nothing is picked out
  // of an area — the only question is whether to take it (5-2-4).
  const may = one("[Auto] When your opponent plays a Battle Card or Unison Card, you may choose that card and switch it to Rest Mode.");
  assert.deepEqual(may.unsupported, []);
  assert.deepEqual(may.ops[0], { op: "choose", sel: { special: "subject", count: 1, upTo: true }, as: "c0", reason: "you may choose that card" });
  assert.deepEqual(may.ops[1], { op: "switchMode", target: { var: "c0" }, mode: "rest" });

  // The same sentence without "you may" is not declinable.
  // (This one names the kind of card, so the whole program sits inside the
  // condition on the trigger's subject — see the ≪Turtle School≫ case above.)
  const must = one("[Auto] When your opponent's Battle Card is played, choose that card and switch it to Rest Mode.");
  assert.deepEqual(must.unsupported, []);
  const inside = (must.ops[0] as { op: string; then: unknown[] }).then;
  assert.equal((inside[0] as { sel: { upTo?: boolean } }).sel.upTo, undefined);

  // "Your Leaders" is the Leader Area; the plural was not in the area words,
  // so the phrase fell through to "cards on the table" and included the
  // Battle Area.
  assert.equal(
    (one("[Auto] When this card is played, choose up to 1 of your Leaders, and it gets +5000 power until the end of your opponent's turn.").ops[0] as { sel: { area?: string } }).sel.area,
    "leader",
  );

  // "They" after "when your opponent combos" is the opponent.
  assert.deepEqual(one("[Auto] When your opponent combos, they choose 1 card in their hand and place it in their Drop Area.").ops, [{ op: "discard", n: 1, side: "opponent" }]);
}

{
  // The engine side: an optional choice over a card the trigger named is a
  // real prompt with a "no" in it, and declining does nothing at all.
  DEFS.TAX = {
    ...DEFS.V1,
    id: "TAX",
    name: "TAX",
    skill: "[Auto] When your opponent plays a Battle Card, you may choose that card and switch it to Rest Mode.",
  };
  let s = arena({ battle: ["TAX"], oppHand: ["V-BLUE"], oppEnergy: ["V-BLUE"] });
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  const theirs = find(s, "p2", "hand", "V-BLUE");
  s = play(s, { type: "play", player: "p2", card: theirs });
  if (s.prompt.kind === "payCost") s = play(s, { type: "payCost", player: "p2", option: 0 });
  assert.equal(s.prompt.kind, "chooseCards", "5-2-4: 'you may' asks");
  assert.equal(s.prompt.player, "p1", "and it is the skill's master who answers");
  s = play(s, { type: "choose", player: "p1", cards: [theirs] });
  assert.equal(s.cards[theirs].mode, "rest");
  assertConsistent(s);
}

{
  // The other half of the same gap: these skills compiled all along and could
  // never fire, because no trigger watched what the *opponent* did. Declining
  // the optional choice leaves the board alone.
  DEFS.WATCH = {
    ...DEFS.V1,
    id: "WATCH",
    name: "WATCH",
    skill: "[Auto] When your opponent attacks with a Battle Card, you may choose it and it gets -25000 power for the turn.",
  };
  let s = arena({ battle: ["WATCH"], oppBattle: ["BIG"] });
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  const attacker = s.players.p2.battle.find((id) => s.cards[id].cardId === "BIG")!;
  const before = powerOf(CTX, s, attacker);
  s = play(s, { type: "attack", player: "p2", attacker, target: s.players.p1.leader });
  assert.equal(s.prompt.kind, "chooseCards", "the defender's card watches the attack");
  assert.equal(s.prompt.player, "p1");
  // 5-2-4: declining an optional choice does nothing.
  s = play(s, { type: "choose", player: "p1", cards: [] });
  assert.equal(powerOf(CTX, s, attacker), before, "no choice, no effect");
  assertConsistent(s);
}

{
  // The engine side of two of them: blocking is a moment of its own (22-4),
  // and the *other* player's cards see your Main Phase begin (7-3).
  DEFS.WALL = { ...DEFS.BLOCKER, id: "WALL", name: "WALL", skill: "[Blocker]<br>[Auto] When this card activates [Blocker], draw 1 card." };
  let s = arena({ battle: ["WALL"] });
  const wall = s.players.p1.battle[0];
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "attack", player: "p2", attacker: s.players.p2.leader, target: s.players.p1.leader });
  while (s.prompt.kind === "counter") s = play(s, { type: "counter", player: s.prompt.player, card: null });
  assert.equal(s.prompt.kind, "blocker", "the [Blocker] window");
  s = play(s, { type: "block", player: "p1", card: wall });
  assert.equal(s.players.p1.hand.length, hand + 1, "22-4: blocking is its own moment");
  assertConsistent(s);
}

{
  DEFS.NOSY = { ...DEFS.V1, id: "NOSY", name: "NOSY", skill: "[Auto] At the start of your opponent's Main Phase, draw 1 card." };
  let s = arena({ battle: ["NOSY"] });
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  assert.equal(s.turnPlayer, "p2");
  assert.equal(s.players.p1.hand.length, hand + 1, "7-3: their Main Phase, my card watching it");
  assertConsistent(s);
}

// ── moments the engine did not know about (4-2) ────────────────────────────

{
  // These wordings all compiled and could never happen: no `Trigger` matched
  // the moment they name, so the engine read the skill and waited forever.
  // `npm run arena:gaps` now counts them; this keeps the ones fixed, fixed.
  const fires = (text: string, trigger: Parameters<typeof autoTriggerMatches>[1]) => autoTriggerMatches(parseSkills(text)[0], trigger);
  assert.ok(fires("[Auto] When your opponent attacks, draw 1 card.", "opponentAttacks"));
  assert.ok(fires("[Auto] When one of your opponent's cards attacks, draw 1 card.", "opponentAttacks"));
  assert.ok(fires("[Auto] When your opponent combos, draw 1 card.", "opponentCombos"));
  assert.ok(fires("[Auto] When this card is placed in a Battle Area, draw 1 card.", "placed"));
  assert.ok(fires("[Auto] When this card is removed from your Battle Area by an opponent's skill, draw 1 card.", "removedByOpponent"));
  // "Or KO'd" is the KO half of the same sentence, and belongs to `koed`.
  assert.ok(fires("[Auto] When this card is removed from a Battle Area by a skill or KO'd, draw 1 card.", "koed"));
  assert.ok(fires("[Auto] When this card is removed from a Battle Area by a skill or KO'd, draw 1 card.", "removedFromBattle"));
  assert.ok(fires("[Auto] When a card evolves into this card, draw 1 card.", "evolvedInto"));
  assert.ok(fires("[Auto] If your Leader Card is red: When your opponent activates a [Counter] skill, deal 1 damage to them.", "opponentCounter"));
  // A card that only says "played" must not fire on a placement, or every
  // skill that puts a card into play would run twice.
  assert.ok(!fires("[Auto] When you play this card, draw 1 card.", "placed"));
  assert.ok(!fires("[Auto] When you play this card, draw 1 card.", "evolvedInto"));

  // 12-2: activating an Extra is playing it.
  assert.ok(fires("[Auto] When you activate this card, draw 1 card.", "played"));
  // One sentence naming two moments belongs to both triggers; only one of
  // them ever happens to a given copy.
  assert.ok(fires("[Auto] When you play or combo with this card, draw 1 card.", "played"));
  assert.ok(fires("[Auto] When you play or combo with this card, draw 1 card.", "comboed"));
  assert.ok(fires("[Auto] When this card in your hand is played or used in a combo, draw 1 card.", "played"));
  assert.ok(fires("[Auto] When this card in your hand is played or used in a combo, draw 1 card.", "comboed"));
  assert.ok(fires("[Auto] When you place this card in your Leader Area, draw 1 card.", "leaderPlaced"));
  assert.ok(fires("[Auto] At the start of your opponent's Main Phase, draw 1 card.", "opponentMainStart"));
  assert.ok(!fires("[Auto] At the start of your Main Phase, draw 1 card.", "opponentMainStart"), "and only theirs");
  assert.ok(fires("[Auto] When this card activates [Blocker], draw 1 card.", "blockerUsed"));
  assert.ok(fires("[Auto] When this card activates its [Blocker] skill, draw 1 card.", "blockerUsed"));
  assert.ok(fires("[Auto] When this card is added to your Z-Energy, draw 1 card.", "addedToZEnergy"));
}

{
  // 5-5: placed, not played. A skill that *places* a card in a Battle Area
  // does not play it, so only the second wording fires.
  DEFS.ARRIVES = { ...DEFS.V1, id: "ARRIVES", name: "ARRIVES", skill: "[Auto] When this card is placed in a Battle Area, draw 1 card." };
  DEFS.SUMMON = { ...DEFS.V1, id: "SUMMON", name: "SUMMON", energyCost: 1, skill: "[Auto] When you play this card, place up to 1 <ARRIVES> card from your Drop into your Battle Area." };
  DEFS.ARRIVES.characters = ["ARRIVES"];
  let s = arena({ hand: ["SUMMON"], energy: ["V1"] });
  const sleeping = s.players.p1.deck.find((id) => s.cards[id].cardId === "V1")!;
  s.cards[sleeping].cardId = "ARRIVES";
  move(CTX, s, [], sleeping, "drop", "p1");
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "SUMMON") });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [sleeping] });
  assert.ok(s.players.p1.battle.includes(sleeping), "it was placed");
  assert.equal(s.players.p1.hand.length, hand - 1 + 1, "SUMMON left the hand, the draw came in");
  assertConsistent(s);
}

{
  // "Removed from your Battle Area by an opponent's skill" — a move an effect
  // caused, and only when the effect was theirs.
  DEFS.GRUDGE = { ...DEFS.V1, id: "GRUDGE", name: "GRUDGE", skill: "[Auto] When this card is removed from your Battle Area by an opponent's skill, draw 1 card." };
  DEFS.BOUNCE = { ...DEFS.V1, id: "BOUNCE", name: "BOUNCE", energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and return it to its owner's hand." };
  let s = arena({ hand: ["BOUNCE"], energy: ["V1"], oppBattle: ["GRUDGE"] });
  const grudge = s.players.p2.battle[0];
  const theirHand = s.players.p2.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "BOUNCE") });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [grudge] });
  // The card itself came back to hand, and the skill drew them one more.
  assert.equal(s.players.p2.hand.length, theirHand + 2, "3-1: it was removed, and it noticed");
  assertConsistent(s);
}

// ── the price before the colon (9-1-3) ─────────────────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const priceOf = (text: string) => costText(parseSkills(text)[0].cost);

  // A card that costs orbs *and* names a condition never starts with the
  // condition, and both `activatable` and `compileSkill` tested the raw text
  // for a leading "if" — so the condition was neither checked before offering
  // the skill nor applied to the program. 1,626 skills were in that state.
  assert.equal(priceOf("[Activate: Main]{r}{r}, if your Leader is red: Draw 1 card."), "if your Leader is red");
  // A reminder in brackets is not a price either (1-5-8).
  assert.equal(priceOf("[Activate: Main][Limit 1] (You can only activate this skill once per turn.) If your Leader is red: Draw 1 card."), "If your Leader is red");
  assert.ok(costIsOnlyOrbs("{r}{r}"), "orbs alone are a price the engine can charge");
  assert.ok(costIsOnlyOrbs("{r}{r} (a reminder)"));
  assert.ok(!costIsOnlyOrbs("{r}, if your Leader is red"));

  // Both halves of a compound price are kept. Read whole, the greedy tail of
  // the Leader pattern swallowed the second and dropped it — which would have
  // offered the skill without its energy requirement.
  const both = one("[Activate: Main]{r}{r}, if your Leader is a green <Broly> card and you have 2 or more energy: Draw 1 card.");
  assert.deepEqual(both.unsupported, []);
  const gate = (both.ops[0] as { op: string; cond: { kind: string; conds?: { kind: string }[] } }).cond;
  assert.equal(gate.kind, "all");
  assert.deepEqual(
    gate.conds?.map((c) => c.kind),
    ["leaderMatches", "count"],
  );

  // A price the engine cannot read still fails the skill rather than running
  // the effect for free.
  assert.ok(one("[Activate: Main] If the moon is full: Draw 1 card.").unsupported.length > 0);
}

// ── a price that is an action, not a condition (4-3-3) ─────────────────────

{
  // "Switch this card to Rest Mode: Draw 1 card" — the price is the same
  // vocabulary as an effect, and is compiled by the same code.
  DEFS.TIRED = { ...DEFS.V1, id: "TIRED", name: "TIRED", skill: "[Activate: Main] Switch this card to Rest Mode: Draw 1 card." };
  let s = arena({ battle: ["TIRED"] });
  const tired = s.players.p1.battle[0];
  const hand = s.players.p1.hand.length;
  assert.ok(canActivate(s, tired), "it is active, so the price can be paid");
  s = play(s, { type: "activate", player: "p1", card: tired, skill: 0 });
  assert.equal(s.cards[tired].mode, "rest", "the price was charged");
  assert.equal(s.players.p1.hand.length, hand + 1, "and the effect happened");
  // A price that cannot be paid twice is not offered twice.
  assert.ok(!canActivate(s, tired), "already rested: nothing left to pay with");
  assertConsistent(s);
}

{
  // A price that discards is only offered while there is something to discard,
  // and the effect never happens for free.
  DEFS.TITHE = { ...DEFS.V1, id: "TITHE", name: "TITHE", skill: "[Activate: Main] Choose 1 card in your hand and place it in your Drop Area: Draw 2 cards." };
  let s = arena({ battle: ["TITHE"], hand: ["BIG", "BIG"] });
  const tithe = s.players.p1.battle[0];
  const hand = s.players.p1.hand.length;
  assert.ok(canActivate(s, tithe));
  s = play(s, { type: "activate", player: "p1", card: tithe, skill: 0 });
  assert.equal(s.prompt.kind, "chooseCards", "the price is a choice");
  const paid = s.players.p1.hand[0];
  s = play(s, { type: "choose", player: "p1", cards: [paid] });
  assert.ok(s.players.p1.drop.includes(paid), "4-3-3: the price was charged");
  assert.equal(s.players.p1.hand.length, hand - 1 + 2, "one paid, two drawn");
  assertConsistent(s);

  // With an empty hand there is nothing to pay with, so it is not offered.
  const t = arena({ battle: ["TITHE"] });
  const other = t.players.p1.battle[0];
  for (const id of t.players.p1.hand.slice()) move(CTX, t, [], id, "deck", "p1", { position: "bottom" });
  assert.ok(!canActivate(t, other), "an unpayable price is not offered");
}

// ── a price that is a condition *and* an action (9-1-3 + 4-3-3) ────────────

{
  // BT31-132: "If your Leader is a white <Cell> card, and you remove this card
  // in your Drop from the game and discard 1 card from your hand:". The two
  // were read as alternatives, so the leading condition matched and a greedy
  // pattern swallowed the rest — 655 skills were offered without ever paying.
  const both = parseSkills("[Activate: Main] If your Leader Card is red and you place this card from your hand in your Drop Area : Draw 1 card.")[0];
  assert.equal(priceCondition(both)?.cond.kind, "leaderMatches", "the condition half still guards the skill");
  assert.deepEqual(
    compileCostProgram(both)?.ops.map((o) => o.op),
    ["moveTo"],
    "4-3-3: and the action half is charged",
  );

  // Two conditions and an action: every condition is kept, not just the first.
  const two = parseSkills("[Activate: Main] If your Leader Card is red, you have 2 or more energy, and you discard 1 card from your hand : Draw 1 card.")[0];
  const chained = priceCondition(two);
  assert.equal(chained?.cond.kind, "all");
  assert.equal((chained?.cond as { conds: unknown[] }).conds.length, 2, "9-1-3: both conditions hold the skill back");
  assert.deepEqual(
    compileCostProgram(two)?.ops.map((o) => o.op),
    ["discard"],
  );

  // A price is only split when both halves are read. When the action half is
  // not — BT13-115's "choose this card and 1 ≪Android≫ card and discard them
  // from your hand" — the whole price is unread and the skill goes to the
  // referee, never the condition alone, which would hand out the effect free.
  const half = parseSkills("[Activate: Main] If your Leader Card is red and you choose this card and 1 ≪Android≫ card and discard them from your hand : Draw 1 card.")[0];
  assert.equal(priceCondition(half), null, "no half-read price");
  assert.equal(compileCostProgram(half), null);

  // A single condition that carries an "and" of its own is still one
  // condition: the pieces do not read, so the sentence is read whole.
  const wide = priceCondition(parseSkills("[Activate: Main] If your Leader Card is a red and blue card : Draw 1 card.")[0]);
  assert.equal(wide?.cond.kind, "leaderMatches");
  assert.deepEqual((wide?.cond as { filter: { colors: string[] } }).filter.colors, ["Red", "Blue"]);

  // And the whole thing works in a game: the price is charged, then the effect.
  DEFS.BOTHPAY = { ...DEFS.V1, id: "BOTHPAY", name: "BOTHPAY", skill: "[Activate: Main] If your Leader Card is red and you discard 1 card from your hand : Draw 2 cards." };
  let s = arena({ battle: ["BOTHPAY"], hand: ["BIG", "BIG"] });
  const both2 = s.players.p1.battle[0];
  const hand = s.players.p1.hand.length;
  assert.ok(canActivate(s, both2), "the leader is red and there is a card to discard");
  s = play(s, { type: "activate", player: "p1", card: both2, skill: 0 });
  assert.equal(s.prompt.kind, "chooseCards", "20-7: the discard is the owner's choice");
  const paid = s.players.p1.hand[0];
  s = play(s, { type: "choose", player: "p1", cards: [paid] });
  assert.ok(s.players.p1.drop.includes(paid), "the action half was charged");
  assert.equal(s.players.p1.hand.length, hand - 1 + 2, "one discarded, two drawn");
  assertConsistent(s);

  // Empty the hand and the same skill is no longer on offer.
  const t = arena({ battle: ["BOTHPAY"] });
  for (const id of t.players.p1.hand.slice()) move(CTX, t, [], id, "deck", "p1", { position: "bottom" });
  assert.ok(!canActivate(t, t.players.p1.battle[0]), "nothing to discard: the price cannot be paid");
}

// ── where a card is, remembered but never trusted ──────────────────────────

{
  // `locate` keeps a hint per state and checks it before believing it, which
  // is what makes it safe against the mutations that do not go through
  // `move` — an evolve splicing an array, a card placed under another.
  const s = arena({ battle: ["V1", "BIG"], hand: ["V-BLUE"] });
  const [first, second] = s.players.p1.battle;
  assert.equal(locate(s, first)?.area, "battle");
  assert.equal(locate(s, first)?.index, 0);
  // Move it the honest way: the hint follows.
  move(CTX, s, [], first, "drop", "p1");
  assert.equal(locate(s, first)?.area, "drop", "the hint was refreshed");
  assert.equal(locate(s, second)?.area, "battle");

  // Now mutate the arrays behind `move`'s back, as the evolve and Z-Awaken
  // paths do. A cache that trusted itself would still say "battle".
  const moved = s.players.p1.battle.pop()!;
  s.players.p1.warp.unshift(moved);
  assert.equal(locate(s, moved)?.area, "warp", "the stale hint was checked and missed");

  // And a card that is nowhere is nowhere, not wherever it last was.
  s.players.p1.warp.shift();
  assert.equal(locate(s, moved), null);
}

// ── [Union-Absorb] (22-13-6) ───────────────────────────────────────────────

{
  // Three things were wrong with this line at once, and it compiled cleanly.
  const line = "[Union Absorb] Play up to 1 mono-green <Majin Buu> card with an energy cost of 4 from your deck or Drop Area on top of this card, then shuffle your deck.";
  const sk = parseSkills(line)[0];
  // 22-13-3: printed with a hyphen, but some sets set it with a space, and
  // unrecognised the whole line fell back to [Permanent].
  assert.deepEqual(sk.keyword, { name: "Union", variant: "Absorb" });
  // 22-13-6-1: its line really is "cost : effect", unlike Fusion and Potara,
  // so the keyword must not swallow the text.
  const sc = compileSkill(sk);
  assert.deepEqual(sc.unsupported, []);
  assert.deepEqual(
    sc.ops.map((o) => o.op),
    ["choose", "play", "shuffle"],
  );
  // "On top of this card" names the *host*. Left in the phrase, `parseTarget`
  // took the whole thing for "this card" and the skill played the card onto
  // itself.
  assert.deepEqual((sc.ops[1] as { onto?: unknown }).onto, { sel: { special: "self" } });
  assert.notDeepEqual((sc.ops[0] as { sel: unknown }).sel, { special: "self" });
  // "From your deck or Drop Area" is two areas; the second was being dropped.
  assert.deepEqual((sc.ops[0] as { sel: { areas?: string[] } }).sel.areas, ["deck", "drop"]);
}

{
  // The engine side: 22-13-6-2 activates it from the Battle Area, and
  // 22-13-6-3 plays the chosen card on top of the one that activated it.
  DEFS.ABSORBER = {
    ...DEFS.V1,
    id: "ABSORBER",
    name: "ABSORBER",
    skill: "[Union Absorb] Play up to 1 <BIG> card from your deck on top of this card, then shuffle your deck.",
  };
  DEFS.BIG.characters = ["BIG"];
  let s = arena({ battle: ["ABSORBER"] });
  const absorber = s.players.p1.battle[0];
  const food = s.players.p1.deck.find((id) => s.cards[id].cardId === "V1")!;
  s.cards[food].cardId = "BIG";
  const width = s.players.p1.battle.length;
  assert.ok(canActivate(s, absorber), "22-13-6-2: offered from the Battle Area");
  s = play(s, { type: "activate", player: "p1", card: absorber, skill: 0 });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [food] });
  assert.ok(s.players.p1.battle.includes(food), "the chosen card is in play");
  assert.equal(s.players.p1.battle.length, width, "22-13-6-3: on top of it, not beside it");
  assert.ok(s.cards[food].under.includes(absorber), "and the activator is underneath");
  assertConsistent(s);
}

// ── an orb payable with either of two colours ──────────────────────────────

{
  // Read as "one orb of any colour", a {r}/{u} skill could be paid with green.
  DEFS.EITHER = { ...DEFS.V1, id: "EITHER", name: "EITHER", skill: "[Activate: Main]{r}/{u}: Draw 1 card." };
  DEFS["V-GREEN"] = { ...DEFS.V1, id: "V-GREEN", name: "V-GREEN", colors: ["Green"] };

  // Green energy alone cannot pay it.
  const s = arena({ battle: ["EITHER"], energy: ["V-GREEN"] });
  assert.ok(!canActivate(s, s.players.p1.battle[0]), "green is neither red nor blue");

  // Either of the named colours can.
  const red = arena({ battle: ["EITHER"], energy: ["V1"] });
  assert.ok(canActivate(red, red.players.p1.battle[0]), "V1 is red");
  const blue = arena({ battle: ["EITHER"], energy: ["V-BLUE"] });
  assert.ok(canActivate(blue, blue.players.p1.battle[0]), "and V-BLUE is blue");

  // And paying it rests the right one, leaving the green alone.
  const mixed = arena({ battle: ["EITHER"], energy: ["V-GREEN", "V-BLUE"] });
  const after = play(mixed, { type: "activate", player: "p1", card: mixed.players.p1.battle[0], skill: 0 });
  assert.equal(after.cards[find(after, "p1", "energy", "V-BLUE")].mode, "rest");
  assert.equal(after.cards[find(after, "p1", "energy", "V-GREEN")].mode, "active", "the green was not spendable, so it was not spent");
  assertConsistent(after);
}

// ── [Aegis] cannot be paid wrongly (22-30-3) ───────────────────────────────

{
  // Covering the named colours is a *condition of activating* [Aegis], not
  // something a player can get wrong. The engine used to take any two cards
  // that each matched a colour, then check — and a red-and-red pair ate the
  // orbs and did nothing.
  DEFS.AEG2 = { ...DEFS.V1, id: "AEG2", name: "AEG2", skill: "[Aegis red/blue] {r}" };
  let s = arena({ battle: ["AEG2"], hand: ["V1", "V1", "V-BLUE"], energy: ["V1", "V1"] });
  const aeg = s.players.p1.battle[0];
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s.cards[s.players.p1.energy[0]].mode = "rest";
  s = play(s, { type: "attack", player: "p2", attacker: s.players.p2.leader, target: s.players.p1.leader }, { type: "pass", player: "p2" });
  s = play(s, { type: "activate", player: "p1", card: aeg, skill: 0 });
  const reds = s.players.p1.hand.filter((id) => s.cards[id].cardId === "V1");
  const blue = find(s, "p1", "hand", "V-BLUE");
  s = play(s, { type: "choose", player: "p1", cards: [reds[0]] });
  assert.equal(s.prompt.kind, "chooseCards", "blue is still to cover");
  const menu = (s.prompt as { choice: { candidates: string[]; min: number } }).choice;
  assert.deepEqual(menu.candidates, [blue], "only the card that covers what is missing");
  assert.equal(menu.min, 1, "and stopping here is not on the menu");
  assert.ok(!labels(s).includes("Choose none"));
  s = play(s, { type: "choose", player: "p1", cards: [blue] });
  assert.ok(s.players.p1.drop.includes(reds[0]) && s.players.p1.drop.includes(blue), "22-30-3: a covering pair");
  assert.ok(!s.players.p1.drop.includes(reds[1]), "and only the two it needed");
  assertConsistent(s);
}

{
  // A single multicolour card covers both on its own (22-30-3), and then
  // there is nothing more to ask.
  DEFS.AEG3 = { ...DEFS.V1, id: "AEG3", name: "AEG3", skill: "[Aegis red/blue]" };
  DEFS.PURPLE = { ...DEFS.V1, id: "PURPLE", name: "PURPLE", colors: ["Red", "Blue"] };
  let s = arena({ battle: ["AEG3"], hand: ["PURPLE"], energy: ["V1"] });
  const aeg = s.players.p1.battle[0];
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s.cards[s.players.p1.energy[0]].mode = "rest";
  s = play(s, { type: "attack", player: "p2", attacker: s.players.p2.leader, target: s.players.p1.leader }, { type: "pass", player: "p2" });
  assert.ok(canActivate(s, aeg), "one card covering both is enough to activate");
  s = play(s, { type: "activate", player: "p1", card: aeg, skill: 0 });
  const purple = find(s, "p1", "hand", "PURPLE");
  s = play(s, { type: "choose", player: "p1", cards: [purple] });
  assert.ok(s.players.p1.drop.includes(purple), "it paid the whole cost by itself");
  assertConsistent(s);
}

// ── the last two §6.14 approximations ──────────────────────────────────────

{
  // 22-32-3: the cards rested to pay for [Alliance] notice it. Five cards
  // print this and none of them could ever fire.
  assert.ok(autoTriggerMatches(parseSkills("[Auto] When this card is switched to Rest Mode by an [Alliance] skill, draw 1 card.")[0], "restedByAlliance"));

  DEFS.ALLY = { ...DEFS.V1, id: "ALLY", name: "ALLY", skill: "[Auto] When this card is switched to Rest Mode by an [Alliance] skill, draw 1 card." };
  DEFS.LEADS = { ...DEFS.V1, id: "LEADS", name: "LEADS", power: 20000, skill: "[Alliance Red] When this card attacks, this card gets +5000 power for the battle." };
  let s = arena({ battle: ["LEADS", "ALLY"] });
  const leads = s.players.p1.battle.find((id) => s.cards[id].cardId === "LEADS")!;
  const ally = s.players.p1.battle.find((id) => s.cards[id].cardId === "ALLY")!;
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "attack", player: "p1", attacker: leads, target: s.players.p2.leader });
  assert.equal(s.prompt.kind, "chooseCards", "22-32-3: which cards to rest as the cost");
  s = play(s, { type: "choose", player: "p1", cards: [ally] });
  assert.equal(s.cards[ally].mode, "rest", "it was rested to pay");
  assert.equal(s.players.p1.hand.length, hand + 1, "and it noticed");
  assertConsistent(s);
}

{
  // 22-37: [Invoker] rests one Red/Blue energy in place of the card's energy
  // cost, but the *skill's* orbs are still paid out of what is left. With one
  // Red/Blue energy and a skill costing {r}, the same card cannot do both.
  DEFS.INVOKE = { ...DEFS.V1, id: "INVOKE", name: "INVOKE", skill: "[Invoker]" };
  DEFS["E-COSTLY"] = { ...DEFS["E-DRAW"], id: "E-COSTLY", name: "E-COSTLY", colors: ["Red", "Blue"], skill: "[Activate: Main]{r}: Draw 1 card." };
  DEFS["V-PURPLE"] = { ...DEFS.V1, id: "V-PURPLE", name: "V-PURPLE", colors: ["Red", "Blue"] };

  // One Red/Blue energy: [Invoker] would rest it, leaving nothing for the {r}.
  const tight = arena({ battle: ["INVOKE"], hand: ["E-COSTLY"], energy: ["V-PURPLE"] });
  const one = find(tight, "p1", "hand", "E-COSTLY");
  assert.ok(!acts(tight).some((a) => a.type === "activate" && a.card === one && a.alt), "the same energy cannot pay twice");

  // A second energy for the orbs, and the offer is real.
  const roomy = arena({ battle: ["INVOKE"], hand: ["E-COSTLY"], energy: ["V-PURPLE", "V1"] });
  const two = find(roomy, "p1", "hand", "E-COSTLY");
  assert.ok(
    acts(roomy).some((a) => a.type === "activate" && a.card === two && a.alt),
    "one to rest for [Invoker], one for the {r}",
  );
}

// ── a pronoun in a trailing modifier is not an antecedent ──────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const chosen = (sc: { ops: unknown[] }) => (sc.ops[0] as { sel: { special?: string; filter?: { names: string[] } } }).sel;

  // "…with **its** skills negated" describes the card just named, not whatever
  // the last clause acted on. Read as a reference it played this card instead,
  // on 66 choices across the catalog.
  const negated = one("[Auto] When you play this card, play up to 1 {Piccolo, Bestowed Power} from your deck with its skills negated for the turn.");
  assert.deepEqual(negated.unsupported, []);
  assert.equal(chosen(negated).special, undefined, "not this card");
  assert.deepEqual(chosen(negated).filter?.names, ["piccolo, bestowed power"], "the named card, not this one");
  assert.equal((negated.ops[1] as { negated?: string }).negated, "turn", "and the negation itself is read");
  assert.equal(
    (one("[Auto] When you play this card, play up to 1 {X} from your deck with its skills negated for game.").ops[1] as { negated?: string }).negated,
    "game",
    "'for game' without the article",
  );

  // Same for "with a marker on it".
  const marked = one("[Auto] When you play this card, play up to 1 {Spaceship, Vessel of Hope} from your deck with a marker on it.");
  assert.equal(chosen(marked).special, undefined);

  // "From under this card" says where to look, not which card — and the rest
  // of the phrase still says how many. Hard-coding "all" here (which is what
  // the fix for "each card under this card" first did) played the whole pile.
  const beneath = one("[Activate: Main] Play up to 1 red ≪Universe 7≫ card with an energy cost of 3 or less from under this card.");
  assert.deepEqual(beneath.unsupported, []);
  assert.equal(chosen(beneath).special, undefined, "the pile, not the card on top of it");
  assert.equal((beneath.ops[0] as { sel: { area?: string; count?: number; upTo?: boolean } }).sel.area, "under");
  assert.equal((beneath.ops[0] as { sel: { count?: number } }).sel.count, 1, "up to 1, not the whole pile");
  assert.equal((beneath.ops[0] as { sel: { upTo?: boolean } }).sel.upTo, true);
  // The plural in the same area is still all of them.
  const each = one("[Permanent] This card gets +5000 power for each non-Leader card under this card.");
  const counted = (each.ops[0] as { amount: { count: { area?: string; count?: number } } }).amount.count;
  assert.equal(counted.area, "under");
  assert.equal(counted.count, 99);

  // "from under your <Kefla> Battle Card" / "from under your Leader Card":
  // the pile belongs to the named host, not this card.
  const host = parseTarget("up to 1 card from under your <Kefla> Battle Card");
  assert.equal(host?.area, "under");
  assert.equal(host?.underHost?.area, "battle");
  assert.deepEqual(host?.underHost?.filter?.characters, ["Kefla"]);
  const leader = parseTarget("up to 1 card from under your Leader Card");
  assert.equal(leader?.area, "under");
  assert.equal(leader?.underHost?.special, "leader");

  // A phrase that really is a pronoun still is one.
  assert.deepEqual((one("[Auto] When you play this card, choose 1 of your opponent's Battle Cards and KO it.").ops[1] as { target: unknown }).target, { var: "c0" });
}

// ── what a refused clause leaves behind ────────────────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // An [Auto] seeds the antecedent to the card it is on, so a clause the
  // compiler cannot read hands the pronoun after it this card. P-645's "play
  // 1 {Majin Buu, Unadulterated Destruction} from under your green <Majin
  // Buu> card, and **it** gains [Double Strike]" gave the keyword to the card
  // printing the skill; P-279's "KO it" KO'd it.
  const stale = one("[Auto] When this card is played, draw 1 card, reduce the skill cost of your next [Union] skill by {r}, and it gains [Barrier] for the turn.");
  assert.deepEqual(
    stale.ops.map((o) => o.op),
    ["draw"],
    "the draw stands; the pronoun after the hole does not",
  );
  assert.equal(stale.unsupported.length, 2, "both the clause that went unread and the one pointing at it");
  // Nothing between the trigger and the pronoun went unread here, so "it" is
  // still this card — the seeded antecedent is only wrong once there is a hole.
  assert.deepEqual((one("[Auto] When this card attacks, switch this card to Active Mode and it gains [Barrier] for the turn.").ops[1] as { target: unknown }).target, {
    sel: { special: "self" },
  });

  // 20-16: "if you do" hangs on a decision. When the clause that would have
  // made it went unread, dropping the hinge alone makes what follows happen
  // every time — BT12-042 played a 5-cost <Gogeta> without paying the {u}{u}.
  const hinge = one("[Auto] When this card is played, you may pay {u}{u}. If you do, draw 2 cards.");
  assert.deepEqual(hinge.ops, [], "the price is unread, so what it buys is not free");
  assert.ok(
    hinge.unsupported.some((u) => /draw 2 cards/i.test(u)),
    "and the clause it governs says so",
  );
  // The hinge with a decision behind it still reads as it always did.
  const kept = one("[Auto] When this card is played, you may draw 1 card. If you do, place 1 card from your hand in the Drop Area.");
  assert.deepEqual(kept.unsupported, []);
  assert.deepEqual(
    kept.ops.map((o) => o.op),
    ["may", "if"],
  );

  // A modal option the compiler could not read is an empty branch, and the
  // menu then offers a mode that does nothing at all (P-396). One empty
  // option fails the skill, so the referee is asked what the card prints.
  const modal = one("[Activate: Main] Choose one- ・Draw 1 card. ・Reduce the skill cost of your next [Union] skill by {r}.");
  assert.deepEqual(modal.ops, [], "a mode that silently does nothing is not a choice");
  assert.ok(modal.unsupported.length > 0);
  // Both options readable, and the menu stands.
  const both = one("[Activate: Main] Choose one- ・Draw 1 card. ・Choose up to 1 of your opponent's Battle Cards and KO it.");
  assert.deepEqual(
    both.ops.map((o) => o.op),
    ["chooseMode"],
  );
}

{
  // The engine side: a card played with its skills negated for the game does
  // not fire its own [Auto] on the way in (9-1-5).
  DEFS.LOUD = { ...DEFS.V1, id: "LOUD", name: "LOUD", skill: "[Auto] When you play this card, draw 1 card." };
  DEFS.MUZZLE = {
    ...DEFS.V1,
    id: "MUZZLE",
    name: "MUZZLE",
    energyCost: 1,
    skill: "[Auto] When you play this card, play up to 1 <LOUD> card from your Drop with its skills negated for the game.",
  };
  DEFS.LOUD.characters = ["LOUD"];
  let s = arena({ hand: ["MUZZLE"], energy: ["V1"] });
  const loud = s.players.p1.deck.find((id) => s.cards[id].cardId === "V1")!;
  s.cards[loud].cardId = "LOUD";
  move(CTX, s, [], loud, "drop", "p1");
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "MUZZLE") });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [loud] });
  assert.ok(s.players.p1.battle.includes(loud), "it was played");
  assert.ok(skillsNegated(s, loud), "9-1-5: and silenced");
  assert.equal(s.players.p1.hand.length, hand - 1, "MUZZLE left the hand and nothing was drawn");
  assertConsistent(s);
}

// ── a card taken out of a pile leaves the pile (23-2) ──────────────────────

{
  // Cards under a card are in no area of their own, so `locate` cannot see
  // them and nothing that moves a card could take one out. Playing a card
  // *from* a pile put it in its new area while it was still in the pile — the
  // fuzzer found it as "found 2 times" the moment such a skill compiled.
  DEFS.PILEHOST = { ...DEFS.V1, id: "PILEHOST", name: "PILEHOST" };
  const s = arena({ battle: ["PILEHOST"] });
  const host = s.players.p1.battle[0];
  const buried = s.players.p1.deck[0];
  move(CTX, s, [], buried, "removed", "p1");
  s.players.p1.removed = s.players.p1.removed.filter((id) => id !== buried);
  s.cards[host].under.push(buried);
  assert.equal(locate(s, buried), null, "a card in a pile is in no area");

  // Moving it out the ordinary way takes it out of the pile.
  move(CTX, s, [], buried, "hand", "p1");
  assert.ok(s.players.p1.hand.includes(buried));
  assert.ok(!s.cards[host].under.includes(buried), "and not still underneath");
  assertConsistent(s);
}

// ── a phrase that names two areas (20-1-6) ─────────────────────────────────

{
  // `AREA_WORDS` is first-match-wins, so the second area of "from your deck or
  // Drop Area" was dropped and the search looked in half the places the card
  // says. The catalog prints sixteen such pairs in both orders, so they are
  // read from a table rather than listed one at a time.
  const areas = (phrase: string) => (parseTarget(phrase) as { areas?: string[] } | null)?.areas;
  assert.deepEqual(areas("1 card from your deck or Drop Area"), ["deck", "drop"]);
  assert.deepEqual(areas("1 card in your hand or Drop Area"), ["hand", "drop"]);
  assert.deepEqual(areas("1 card from your Drop or Warp"), ["drop", "warp"]);
  assert.deepEqual(areas("1 card in your hand or Battle Area"), ["hand", "battle"]);
  assert.deepEqual(areas("1 card from your deck or life"), ["deck", "life"]);
  // Both orders, and the preposition repeated after the "or".
  assert.deepEqual(areas("1 card from your energy or from your Drop"), ["energy", "drop"]);
  assert.deepEqual(areas("1 card from your Warp or deck"), ["warp", "deck"]);
  // One area is still one area, and "an energy cost" is not the Energy Area.
  assert.equal(areas("1 card in your hand with an energy cost of 3 or less"), undefined);
  assert.equal((parseTarget("1 card in your hand with an energy cost of 3 or less") as { area?: string }).area, "hand");
  // "Or" between two things that are not areas says nothing about where.
  assert.equal(areas("1 red or blue card in your Drop"), undefined);
}

// ── "in all of your areas" is a span, not an area (3-1-1) ──────────────────

{
  // "Areas" is not an area word, so BT2-001's "each <Son Goku> and <Vegeta> in
  // all of your areas" fell through to the 20-1-6 default of the table — and a
  // colour grant that is the Leader's whole point reached nothing in hand,
  // energy or drop. The "all" in the phrase would also have been read as the
  // count, which is why the phrase comes off before anything else reads it.
  const all = parseTarget("each <Son Goku> and <Vegeta> in all of your areas");
  assert.deepEqual(all?.areas, ["leader", "battle", "unison", "combo", "energy", "hand", "deck", "drop", "life", "warp", "zDeck", "zEnergy"]);
  assert.equal(all?.area, undefined, "no single area stands for all of them");
  assert.equal(all?.side, "you");
  assert.equal(all?.count, 99, "the “all” of the phrase is not the count");
  assert.deepEqual(all?.filter?.characters, ["Son Goku", "Vegeta"]);
  // The possessive is the only thing in BT2-001's phrase that says whose cards
  // these are, so it has to survive the phrase coming off.
  assert.equal(parseTarget("≪God≫ cards in all of their areas")?.side, "opponent");
  // The shorter wording, where the subject carries its own possessive (BT23-072).
  const short = parseTarget("your multicolor <Zamasu> and <Goku Black> cards in all areas");
  assert.equal(short?.areas?.length, 12);
  assert.equal(short?.side, "you");
  // A phrase that names one area still names one.
  assert.equal(parseTarget("1 card in your hand")?.areas, undefined);
}

// ── two skills printed without the line break between them (1-5) ───────────

{
  // 153 cards arrive with a missing <br>, so the second skill was never parsed
  // as one. On BT16-115 the first line is an [EX-Evolve], which owns its own
  // text, and the [Auto] glued behind it was discarded without even being
  // reported as unread.
  const glued = "[EX-Evolve]{b}{1}: <Towa> with an energy cost of 2 or less. [Auto] When this card is played, draw 1 card.";
  const lines = skillLines(glued);
  assert.equal(lines.length, 2, "a sentence ending then a skill tag is a new line");
  assert.ok(lines[1].startsWith("[Auto]"));
  const skills = parseSkills(glued);
  assert.equal(skills.length, 2);
  assert.equal(skills[1].kind, "auto");
  assert.deepEqual(compileSkill(skills[1]).ops, [{ op: "draw", n: 1 }], "and it compiles on its own");

  // A reminder note may name a tag without starting a skill (1-5-8).
  assert.equal(skillLines("[Deflect] (This card isn't affected by [Counter: Play] skills.)").length, 1);
  // So may a sentence that refers to one mid-clause.
  assert.equal(skillLines("[Permanent] You can activate this card's [Counter] skill from your hand.").length, 1);
  // And a tag that is not a skill type is not a break either.
  assert.equal(skillLines("[Auto] When this card attacks, it gains [Critical] for the turn.").length, 1);
}

// ── full-width text reads as the ASCII the compiler steers by ──────────────

{
  // Some sets set a run of the text in full-width forms. Every one of them
  // reads the same to a person and matched nothing here: "：" is the colon
  // `splitCost` cuts a price at, "｛｝" the braces round a card name, "【】" a
  // keyword tag, "《》" a special trait, "･" a modal option's bullet.
  assert.deepEqual(skillLines("［Ｐｅｒｍａｎｅｎｔ］ Ｌｅａｄｅｒ Ｃard"), ["[Permanent] Leader Card"]);
  assert.equal(skillLines("【Evolve】 {g}{g}{2}: <Broly>")[0], "[Evolve] {g}{g}{2}: <Broly>");
  assert.equal(skillLines("[Permanent] Reduce the cost of ｛Power Pole｝ by 1.")[0], "[Permanent] Reduce the cost of {Power Pole} by 1.");
  assert.equal(skillLines("[Auto] When you play a 《Saiyan》 card, draw 1 card.")[0], "[Auto] When you play a ≪Saiyan≫ card, draw 1 card.");

  // BT1-074 printed its [Evolve] in full-width brackets, so the keyword was
  // never recognised at all and its character name was left as a fragment.
  const evolve = parseSkills("【Evolve】 {g}{g}{2}: <Broly> (Play this card on top of the specified card)")[0];
  assert.equal(evolve.keyword?.name, "Evolve", "the tag is the keyword, whichever brackets it is printed in");
  assert.deepEqual(compileSkill(evolve).unsupported, [], "so <Broly> is the Evolve condition, not an unread clause");

  // A count spelled out rather than printed as a digit. Every counted target
  // is read by a pattern that wants a digit, and a phrase with none is taken
  // as *all* of them — BT1-074 emptied the opponent's hand instead of taking
  // two cards from it.
  const spelled = parseSkills("[Auto] When a card evolves into this card, your opponent chooses two cards from their hand, and places them in the Drop Area.")[0];
  assert.deepEqual(compileSkill(spelled).ops, [{ op: "discard", n: 2, side: "opponent" }]);
  // "One" is left alone: "Choose one—" is how a modal skill opens. So is a
  // number inside a card name.
  assert.equal(skillLines("[Auto] Choose one― ・Draw 1 card")[0].includes("Choose one"), true);
  assert.equal(skillLines("[Activate: Main] Add up to 1 {Grandpa's Heirloom, the Four-Star Ball} to your hand.")[0].includes("Four-Star Ball"), true);
}

// ── what "for each" is counting stops at its noun ──────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // "…+6000 power for each card in your energy **and [Triple Strike] for the
  // duration of the battle**" carries on about the card, not about what is
  // being counted. Taken as part of the counted phrase, the keyword was
  // dropped without a word and the power lasted the turn instead of the
  // battle — a clause that compiled and did two things wrong at once.
  const both = one("[Auto] When this card attacks, this card gets +6000 power for each card in your energy and [Triple Strike] for the duration of the battle.");
  assert.deepEqual(both.unsupported, []);
  assert.deepEqual(
    both.ops.map((o) => o.op),
    ["power", "grant"],
  );
  assert.equal((both.ops[0] as { until: string }).until, "battle");
  assert.equal((both.ops[1] as { until: string }).until, "battle");
  assert.deepEqual((both.ops[1] as { keyword: unknown }).keyword, { name: "Strike", x: 3 });
  const amount = (both.ops[0] as { amount: { count: { area?: string }; times?: number } }).amount;
  assert.equal(amount.count.area, "energy", "and it still counts the right thing");
  assert.equal(amount.times, 6000);

  // A duration alone at the end is not part of the count either.
  const plain = one("[Auto] When this card attacks, this card gets +5000 power for each card in your Drop Area for the turn.");
  assert.equal((plain.ops[0] as { amount: { count: { area?: string } } }).amount.count.area, "drop");
  assert.equal((plain.ops[0] as { until: string }).until, "turn");

  // And a count with nothing after it is unchanged.
  assert.deepEqual(
    one("[Auto] When this card attacks, draw 1 card for each of your Battle Cards.").ops.map((o) => o.op),
    ["draw"],
  );
}
