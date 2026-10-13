/**
 * #720 (9-10-3, 9-10-3-1, 20-1-11): a voluntary KO substitute — "you may
 * choose 1 card in your hand and discard it instead" — is applied only when
 * its action is performed completely. The "you may" is the offer itself, so
 * once the player takes it the discard is owed in full: an empty answer is
 * refused, and an offer that cannot be paid (an empty hand) is not made, so
 * the KO happens.
 *
 * Independent expectations from the manual's text, never derived from either
 * engine. Runs on both lanes of `verify-arena.ts`; the viewer projections are
 * the rules engine's own snapshot.
 */
import assert from "node:assert/strict";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { isVmState } from "../../src/lib/arena/vm/state";
import type { Action, EngineState, PlayerId } from "./harness";
import { CTX, DEFS, ENGINE, IMPL, assertConsistentG, card, compileSkill, findG, labelsG, parseSkills, playG, stageMoveG, stagedG, zoneOf } from "./harness";

const PILE = "[Permanent] If this card would be removed from your Battle Area by an opponent's skill or KO'd, you may choose 1 card in your hand and discard it instead.";
// A printed "up to" inside the offer: the choice may stop short of its number,
// and the existing reading of it is kept (see the PR's judgement calls).
const UPTO = "[Permanent] If this card would be KO'd, you may choose up to 1 card in your hand and discard it instead.";
// A substitute with no "you may": not a voluntary replacement (9-10-3 does not apply).
const MUST = "[Permanent] If this card would leave the Battle Area, choose 1 card in your hand and discard it instead.";
DEFS.PILE720 = card("PILE720", { energyCost: 2, power: 5000, skill: PILE });
DEFS.UPTO720 = card("UPTO720", { energyCost: 2, power: 5000, skill: UPTO });
DEFS.MUST720 = card("MUST720", { energyCost: 2, power: 5000, skill: MUST });
DEFS.HANDA720 = card("HANDA720", { skill: null });
DEFS.HANDB720 = card("HANDB720", { skill: null });
const fixtureIds = ["PILE720", "UPTO720", "MUST720", "HANDA720", "HANDB720"];

const reload = (s: EngineState): EngineState => JSON.parse(JSON.stringify(s));
const choose = (s: EngineState, cards: string[], player: PlayerId = "p1") => IMPL.apply(CTX, reload(s), { type: "choose", player, cards } as Action).state;
const view = (s: EngineState, viewer: PlayerId) => JSON.stringify(buildSnapshot({
  id: 720, revision: 1, mode: "versus", engine: "rules", status: "playing",
  p1Name: "Player 1", p2Name: "Player 2", ctx: CTX, state: s as never,
  legal: [], log: [], beats: null, spotlight: null,
  spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {},
}));

/** p1 holds `defender` in battle and `hand`; p2 plays KILLER on its turn and targets it. */
function killed(defender: string, hand: string[]): { s: EngineState; target: string } {
  let s = stagedG({ battle: [defender], hand, oppHand: ["KILLER"], oppEnergy: ["V1"] });
  const target = findG(s, "p1", "battle", defender);
  assert.deepEqual(zoneOf(s, "p1", "hand").map((id) => s.cards[id].cardId).sort(), [...hand].sort(), "the staged hand is exactly the fixture's");
  s = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = playG(s, { type: "play", player: "p2", card: findG(s, "p2", "hand", "KILLER") }, { type: "choose", player: "p2", cards: [target] });
  return { s, target };
}

try {
  // The reading is unchanged: "you may" is the offer (`optional`), and the
  // compiler also carries it as "up to" on the choice inside — the stored
  // rule this fix has to be right for without a recompile.
  const rule = compileSkill(parseSkills(PILE)[0]);
  assert.deepEqual(rule.unsupported, []);
  const replace = rule.ops[0] as { op: string; optional?: boolean; with: { op: string; sel?: { upTo?: boolean; count?: number } }[] };
  assert.equal(replace.op, "replace");
  assert.equal(replace.optional, true);
  assert.equal(replace.with[0].op, "choose");
  assert.equal(replace.with[0].sel?.upTo, true, "the stored shape: the offer's \"you may\" also reads as \"up to\" on its choice");

  // ── the offer, taken: the discard is owed in full ──────────────────────────
  {
    const { s, target } = killed("PILE720", ["HANDA720", "HANDB720"]);
    assert.equal(s.prompt.kind, "replaceMove", "the voluntary replacement is offered (9-10-3)");
    assert.equal(labelsG(s).length, 2, "take it, or let the card go");
    const taken = playG(s, { type: "chooseMode", player: "p1", index: 0 });
    assert.equal(taken.prompt.kind, "chooseCards", "taking it asks which card is discarded");
    assert.ok(zoneOf(taken, "p1", "battle").includes(target), "the card waits in the Battle Area");
    if (taken.prompt.kind === "chooseCards") {
      assert.equal(taken.prompt.player, "p1");
      assert.equal(taken.prompt.choice.min, 1, "9-10-3-1: the offered action is performed completely — one card, not up to one");
      assert.equal(taken.prompt.choice.max, 1);
    }
    assert.ok(!labelsG(taken).some((l) => /choose none|done choosing/i.test(l)), "no empty answer on the menu");
    const hand = zoneOf(taken, "p1", "hand");

    // The bug (#720): an empty answer kept the card for free. Refused now, unchanged.
    const before = JSON.stringify(taken);
    assert.throws(() => choose(taken, []), IllegalAction, "an empty answer would apply the replacement unpaid");
    // Wrong actor: only the card's master answers.
    assert.throws(() => choose(taken, [hand[0]], "p2"), IllegalAction, "the opponent cannot answer p1's choice");
    // A card that is not a candidate: the defender itself is in the Battle Area.
    assert.throws(() => choose(taken, [target]), IllegalAction, "a card outside the hand cannot pay");
    assert.equal(JSON.stringify(taken), before, "every refusal leaves the state as it was");

    // Stale: the chosen card left the hand after the question was put.
    const stale = reload(taken);
    stageMoveG(stale, hand[0], "deck", "p1");
    const staleBefore = JSON.stringify(stale);
    assert.throws(() => choose(stale, [hand[0]]), IllegalAction, "a card that has left the hand cannot pay");
    assert.equal(JSON.stringify(stale), staleBefore);

    // Paid: the card stays, the chosen card is discarded, the other kept.
    const paid = choose(taken, [hand[0]]);
    assert.ok(zoneOf(paid, "p1", "battle").includes(target), "paid in full: the KO did not happen (9-10-1-1)");
    assert.ok(zoneOf(paid, "p1", "drop").includes(hand[0]), "the chosen card was discarded");
    assert.ok(!zoneOf(paid, "p1", "drop").includes(target));
    assert.deepEqual(zoneOf(paid, "p1", "hand"), [hand[1]], "and only that one");
    assertConsistentG(paid);

    // A JSON reload mid-choice resolves the same.
    assert.equal(JSON.stringify(choose(reload(taken), [hand[0]])), JSON.stringify(paid), "a reload at the choice resolves the same");

    // Both viewer projections (the rules engine's snapshot).
    if (isVmState(taken)) {
      const mine = view(taken, "p1");
      const theirs = view(taken, "p2");
      assert.ok(mine.includes("HANDA720") && mine.includes("HANDB720"), "the chooser sees the hand cards it may discard");
      assert.ok(!theirs.includes("HANDA720") && !theirs.includes("HANDB720"), "the opponent's view does not reveal p1's hand");
      assert.ok(view(paid, "p2").includes("HANDA720"), "the discarded card is public in the Drop");
    }
  }

  // ── the offer, declined: the KO happens and nothing is discarded ───────────
  {
    const { s, target } = killed("PILE720", ["HANDA720", "HANDB720"]);
    const declined = playG(s, { type: "chooseMode", player: "p1", index: 1 });
    assert.ok(zoneOf(declined, "p1", "drop").includes(target), "declined: the card is KO'd");
    assert.equal(zoneOf(declined, "p1", "hand").length, 2, "and nothing was discarded");
    assertConsistentG(declined);
  }

  // ── nothing to pay with: the offer is not made, and the KO happens ─────────
  {
    const { s, target } = killed("PILE720", []);
    assert.notEqual(s.prompt.kind, "replaceMove", "9-10-3: a choice the player cannot make is not offered");
    assert.ok(zoneOf(s, "p1", "drop").includes(target), "unpaid: the KO happens");
    assert.ok(!zoneOf(s, "p1", "battle").includes(target));
    assertConsistentG(s);
  }

  // ── neighbours ────────────────────────────────────────────────────────────
  // A printed "up to" keeps its reading: the choice may stop short.
  {
    const { s, target } = killed("UPTO720", ["HANDA720"]);
    assert.equal(s.prompt.kind, "replaceMove");
    const taken = playG(s, { type: "chooseMode", player: "p1", index: 0 });
    assert.equal(taken.prompt.kind, "chooseCards");
    if (taken.prompt.kind === "chooseCards") assert.equal(taken.prompt.choice.min, 0, "a printed \"up to\" is still up to");
    const none = choose(taken, []);
    assert.ok(zoneOf(none, "p1", "battle").includes(target), "the printed \"up to\" reading is unchanged by #720");
    assertConsistentG(none);
  }
  // A mandatory substitute (no "you may") is not a voluntary replacement: its
  // choice was always exact, and it is applied without an offer.
  {
    const { s, target } = killed("MUST720", ["HANDA720", "HANDB720"]);
    assert.equal(s.prompt.kind, "chooseCards", "no offer: the substitute runs and asks");
    if (s.prompt.kind === "chooseCards") assert.equal(s.prompt.choice.min, 1);
    const hand = zoneOf(s, "p1", "hand");
    const paid = choose(s, [hand[0]]);
    assert.ok(zoneOf(paid, "p1", "battle").includes(target));
    assert.ok(zoneOf(paid, "p1", "drop").includes(hand[0]));
  }

  console.log(`#720 (${ENGINE}): a voluntary KO substitute is owed in full — an empty answer is refused, an unpayable offer is not made`);
} finally {
  for (const id of fixtureIds) delete DEFS[id];
}
