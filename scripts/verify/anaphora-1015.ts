/**
 * #1015 (found in #1014): "that Battle Card" and "they choose" took the wrong card or player.
 *
 *  - BT15-005, P-202 and BT10-115: "you may choose **that Battle Card**" is the pronoun "that
 *    card" said with its noun, pointing at the card the trigger named. It was read as a fresh
 *    description, so the player was offered their *own* Battle Area. BT7-122 and P-159 say
 *    "that Battle Card's skills" / "that Battle Card can't switch" of the card just chosen.
 *  - BT15-085: "**they** choose 1 card in their hand or 1 of their Battle Cards and place it in
 *    its owner's Drop Area" — the opponent whose play set it off picks, from their own hand or
 *    their own Battle Area; it was read as one Battle Card in the opponent's hand.
 *  - DB1-059 / EX08-06: a bare "Choose 1 Battle Card" under an opponent's-energy bound. No
 *    official Q&A covers either card (card FAQ searched 18 Oct 2026); read as either player's
 *    Battle Cards, a labelled best guess.
 *  - P-202 / P-337 come out of the feed with `&apos;`, which the readers never saw as an apostrophe.
 *
 * Rules engine only; nothing reads the database. Wordings are the catalog's deckplanet text of
 * 18 Oct 2026, with the trigger shortened where it is not the point.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, assertConsistentG, card, compileSkill, findG, parseSkills, playG, powerIn, stagedG, zoneOf } from "./harness";
import { describeScript, validateProgram, type Op } from "../../src/lib/arena/vm/script";

const compile = (text: string) => compileSkill(parseSkills(text)[0]);
function chooses(node: unknown, out: Extract<Op, { op: "choose" }>[] = []): Extract<Op, { op: "choose" }>[] {
  if (Array.isArray(node)) for (const x of node) chooses(x, out);
  else if (node && typeof node === "object") {
    if ((node as { op?: string }).op === "choose") out.push(node as Extract<Op, { op: "choose" }>);
    for (const v of Object.values(node)) chooses(v, out);
  }
  return out;
}

// ── the readings ────────────────────────────────────────────────────────────
{
  const BT15_005 = compile("[Auto] Switch this card to Rest Mode: When your opponent uses a skill to play a Battle Card with an energy cost greater than their current energy, you may choose that Battle Card and have it get -15000 power for the turn.");
  assert.deepEqual(BT15_005.unsupported, []);
  const pick = chooses(BT15_005.ops);
  assert.equal(pick.length, 1);
  assert.equal(pick[0].sel.special, "subject", "BT15-005: the card the trigger named, not a description");
  assert.equal(pick[0].sel.area, undefined);
  assert.ok(JSON.stringify(BT15_005.ops).includes(`"var":"${pick[0].as}"`), "and the power change acts on it");

  // P-202 as the feed prints it: `&apos;` and all.
  const P202 = compile(parseSkills("[auto] If you have 5 or more energy and place this card in its owner&apos;s Drop Area: When your opponent plays a Battle Card with an energy cost greater than their current energy, you may choose that Battle Card and place it at the bottom of its owner&apos;s deck.")[0].raw);
  const p202 = chooses(P202.ops);
  assert.equal(p202.length, 1);
  assert.equal(p202[0].sel.special, "subject", "P-202: that Battle Card is the played one");
  assert.ok(JSON.stringify(P202.ops).includes('"to":"deck"'), "P-202: and it goes to the deck");
  assert.deepEqual(P202.unsupported, []);
  assert.equal(parseSkills("[auto] it isn&apos;t")[0].raw.includes("&apos;"), false, "the entity is an apostrophe");

  const BT10_115 = compile("[auto] When your opponent plays a Battle Card, you may choose that Battle Card, ignoring [barrier], and negate its skills for the turn.");
  const b115 = chooses(BT10_115.ops);
  assert.equal(b115.length, 1);
  assert.equal(b115[0].sel.special, "subject");
  assert.equal(b115[0].sel.ignoreBarrier, true, "BT10-115: still ignoring [Barrier]");

  // "Negate that Battle Card's skills" after a choice is that choice (BT7-122), not 1 Battle Card of yours.
  const BT7_122 = compile("[auto] When you play this card during your turn, choose up to 1 of your opponent's Battle Cards, switch it to Rest Mode, then negate that Battle Card's skills until the end of your opponent's next turn.");
  assert.deepEqual(BT7_122.unsupported, []);
  assert.equal(chooses(BT7_122.ops).length, 1, "BT7-122: one choice, in the opponent's area");
  assert.ok(!/in your Battle Area/.test(describeScript(BT7_122.ops)), "BT7-122: nothing of yours is on offer");
  assert.ok(/negate the skills of the chosen cards/.test(describeScript(BT7_122.ops)));

  // BT15-085: the opponent picks, from either place.
  const BT15_085 = compile("[Auto] Switch this card to Rest Mode: When your opponent uses a skill to play a Battle Card with an energy cost greater than their current energy, they choose 1 card in their hand or 1 of their Battle Cards and place it in its owner's Drop Area.");
  assert.deepEqual(BT15_085.unsupported, []);
  const mode = BT15_085.ops.find((o) => o.op === "chooseMode");
  assert.ok(mode && mode.op === "chooseMode" && mode.chooser === "opponent" && mode.modes.length === 2);
  const areas = chooses(BT15_085.ops).map((c) => [c.sel.side, c.sel.area, c.chooser]);
  assert.deepEqual(areas, [["opponent", "hand", "opponent"], ["opponent", "battle", "opponent"]]);
  assert.equal(validateProgram(BT15_085.ops), true);

  // DB1-059 / EX08-06 (best guess): either player's Battle Cards; the option that names the opponent keeps to them.
  const DB1_059 = compile("[Activate: Main] If Your Leader Card is green: Choose one- ・Choose 1 Battle Card with an energy cost greater than or equal to your opponent's energy and KO it. ・Choose 1 of your opponent's Battle Cards with an energy cost of 3 or less and KO it.");
  assert.deepEqual(DB1_059.unsupported, []);
  const both = chooses(DB1_059.ops);
  assert.deepEqual(both.map((c) => [c.sel.side, c.sel.area]), [["both", "battle"], ["opponent", "battle"]]);
  assert.equal(both[0].sel.filter?.costAtLeastEnergy, true);
  assert.equal(both[0].sel.filter?.energyOfOpponent, true);
  const EX08_06 = compile("[auto] When you play this card, choose one- ・Choose 1 Battle Card with an energy cost greater than or equal to your opponent's current energy and KO it. ・Draw 1 card.");
  assert.deepEqual(chooses(EX08_06.ops).map((c) => c.sel.side), ["both"]);
  // Still refused where there is nowhere to apply it: only a Battle Area has the bound on offer.
  assert.ok(compile("[Activate: Main] Choose 1 card in your Drop Area with an energy cost greater than your opponent's energy and add it to your hand.").ops.every((o) => o.op !== "choose" || o.sel.side !== "both"));
  assert.equal(validateProgram(DB1_059.ops), true);
}

// ── in a game ────────────────────────────────────────────────────────────────
function opponentPlays(skill: string, setup: { battle?: string[]; oppBattle?: string[]; oppHand?: string[] }, id: string) {
  DEFS[id] = { ...DEFS.V1, id, name: id, skill };
  let s = stagedG({ battle: [id, ...(setup.battle ?? [])], oppBattle: setup.oppBattle, oppHand: ["V-BLUE", ...(setup.oppHand ?? [])], oppEnergy: ["V-BLUE"] });
  s = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  const played = findG(s, "p2", "hand", "V-BLUE");
  s = playG(s, { type: "play", player: "p2", card: played });
  if (s.prompt.kind === "payCost") s = playG(s, { type: "payCost", player: "p2", option: 0 });
  return { s, played };
}

// "That Battle Card" is the one just played: my own Battle Cards are not on offer, and it is the one that is hit.
{
  DEFS.MINE = card("MINE", { energyCost: 2, colors: ["Red"], power: 10000 });
  const { s, played } = opponentPlays("[Auto] When your opponent plays a Battle Card, you may choose that Battle Card and have it get -15000 power for the turn.", { battle: ["MINE"] }, "T1015A");
  assert.equal(s.prompt.kind, "chooseCards");
  assert.equal(s.prompt.player, "p1");
  assert.deepEqual(s.prompt.choice.candidates, [played], "only the card just played is on offer");
  const before = powerIn(CTX, s, played);
  const after = playG(s, { type: "choose", player: "p1", cards: [played] });
  assert.equal(powerIn(CTX, after, played), before - 15000);
  const mine = zoneOf(after, "p1", "battle").find((x) => after.cards[x].cardId === "MINE")!;
  assert.equal(powerIn(CTX, after, mine), 10000, "my own Battle Card is untouched");
  assertConsistentG(after);
}

// P-202's second half: that Battle Card goes to the bottom of its owner's deck.
{
  const { s, played } = opponentPlays("[Auto] When your opponent plays a Battle Card, you may choose that Battle Card and place it at the bottom of its owner's deck.", {}, "T1015B");
  assert.equal(s.prompt.kind, "chooseCards");
  assert.deepEqual(s.prompt.choice.candidates, [played]);
  const after = playG(s, { type: "choose", player: "p1", cards: [played] });
  assert.equal(zoneOf(after, "p2", "deck").at(-1), played, "bottom of its owner's deck");
  assertConsistentG(after);
}

// BT15-085: THEY choose, from their own hand or their own Battle Cards; I choose nothing.
{
  const { s } = opponentPlays("[Auto] When your opponent plays a Battle Card, they choose 1 card in their hand or 1 of their Battle Cards and place it in its owner's Drop Area.", { oppBattle: ["BIG"], oppHand: ["BIG"] }, "T1015C");
  assert.notEqual(s.prompt.kind, "main", "the skill asked someone");
  assert.equal((s.prompt as { player: string }).player, "p2", "the opponent decides where to take it from");
  let t = s;
  if (t.prompt.kind === "chooseMode") {
    assert.equal((t.prompt as unknown as { options: unknown[] }).options.length, 2);
    t = playG(t, { type: "chooseMode", player: "p2", index: 1 });
  }
  assert.equal(t.prompt.kind, "chooseCards");
  assert.equal(t.prompt.player, "p2", "and the opponent picks the card");
  const offered = t.prompt.choice.candidates;
  assert.ok(offered.length >= 1);
  assert.ok(offered.every((x: string) => t.cards[x].owner === "p2"), "only their own cards, never mine");
  const pick = offered[0];
  const done = playG(t, { type: "choose", player: "p2", cards: [pick] });
  assert.ok(zoneOf(done, "p2", "drop").includes(pick), "it goes to its owner's Drop Area");
  assertConsistentG(done);
}

// DB1-059 / EX08-06 (best guess): either player's Battle Cards at or over the opponent's energy are on offer.
{
  DEFS.T1015D = { ...DEFS.V1, id: "T1015D", name: "T1015D", energyCost: 0, skill: "[Activate: Main] Choose 1 Battle Card with an energy cost greater than or equal to your opponent's energy and KO it." };
  DEFS.CHEAP = card("CHEAP", { energyCost: 0, colors: ["Red"] });
  DEFS.DEAR = card("DEAR", { energyCost: 9, colors: ["Red"] });
  let s = stagedG({ battle: ["T1015D", "DEAR", "CHEAP"], oppBattle: ["DEAR", "CHEAP"], oppEnergy: ["V-BLUE", "V-BLUE", "V-BLUE"] });
  const engine = zoneOf(s, "p2", "energy").length;
  assert.ok(engine >= 3 && engine < 9);
  const source = findG(s, "p1", "battle", "T1015D");
  s = playG(s, { type: "activate", player: "p1", card: source, skill: 0 });
  assert.equal(s.prompt.kind, "chooseCards");
  const offered = s.prompt.choice.candidates.slice().sort();
  const dear = [...zoneOf(s, "p1", "battle"), ...zoneOf(s, "p2", "battle")].filter((x) => s.cards[x].cardId === "DEAR").sort();
  assert.equal(dear.length, 2);
  assert.deepEqual(offered, dear, "both players' costly Battle Cards, and no cheap one");
  const theirs = dear.find((x) => s.cards[x].owner === "p2")!;
  const after = playG(s, { type: "choose", player: "p1", cards: [theirs] });
  assert.ok(zoneOf(after, "p2", "drop").includes(theirs), "KO'd");
  assertConsistentG(after);
}
