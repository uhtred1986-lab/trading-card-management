/**
 * "When this card is sent from your deck to your Warp by your <Heles> card's
 * skill" (BT30-106, 3-10): the `deckToWarpBySkill` moment, on both engines.
 *
 * It fires when a <Heles> card's skill sends it from the deck to the Warp, and
 * not when another card's skill does, nor when a <Heles> skill sends it to the
 * Warp from somewhere else. Every card defined here is taken out of DEFS again
 * at the end, so the probe sweep (`verify/probe.ts`) is unchanged by them.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { DEFS, actsG, arenaG, assertConsistentG, compileSkill, findG, parseSkills, playG, zoneOf } from "./harness";
import type { Action, EngineState, PlayerId } from "./harness";
import { triggersOf } from "../../src/lib/arena/gaps";

const DELIVERY = "[auto] When this card is sent from your deck to your Warp by your <Heles> card's skill, look at up to 1 card from the top of your deck, play up to 1 black ≪Maiden Squadron≫ card, then send the rest to their owner's Warp.";

const TEMP: string[] = [];
const def = (id: string, o: Partial<(typeof DEFS)[string]>) => {
  DEFS[id] = { ...DEFS.V1, ...o, id, name: id };
  TEMP.push(id);
};

// ── the reading ─────────────────────────────────────────────────────────────
{
  const sk = parseSkills(DELIVERY)[0];
  assert.deepEqual(triggersOf(sk), ["deckToWarpBySkill"]);
  const compiled = compileSkill(sk);
  assert.deepEqual(compiled.unsupported, []);
  // "By one of your skills" is the moment with nothing asked of the cause; "by
  // a skill" is either player's and not this moment.
  assert.deepEqual(triggersOf(parseSkills("[auto] When this card is sent from your deck to your Warp by one of your skills, draw 1 card.")[0]), ["deckToWarpBySkill"]);
  assert.deepEqual(compileSkill(parseSkills("[auto] When this card is sent from your deck to your Warp by one of your skills, draw 1 card.")[0]).ops, [{ op: "draw", n: 1 }]);
  assert.deepEqual(triggersOf(parseSkills("[auto] When this card is sent to its owner's Warp by a skill, draw 1 card.")[0]), []);
  // A cause the compiler cannot describe refuses the skill rather than firing for every skill of yours.
  assert.notDeepEqual(compileSkill(parseSkills("[auto] When this card is sent from your deck to your Warp by your ???'s skill, draw 1 card.")[0]).unsupported, []);
}

// ── the board ───────────────────────────────────────────────────────────────
def("WP-HELES", { characters: ["Heles"], skill: "[Activate: Main] Send the top card of your deck to your Warp." });
def("WP-OTHER", { characters: ["Belmod"], skill: "[Activate: Main] Send the top card of your deck to your Warp." });
def("WP-HELES-HAND", { characters: ["Heles"], skill: "[Activate: Main] Choose 1 card in your hand and send it to its owner's Warp." });
def("WP-DELIVERY", { colors: ["Black"], skill: DELIVERY });
def("WP-MAIDEN", { colors: ["Black"], traits: ["Maiden Squadron"], characters: ["Maiden"] });

const act = (s: EngineState, card: string) => actsG(s).find((a) => a.type === "activate" && a.card === card) as Action | undefined;
const choose = (s: EngineState, player: PlayerId, cards: string[]) => (s.prompt.kind === "chooseCards" ? playG(s, { type: "choose", player, cards }) : s);

/** p1's deck with BT30-106 on top and a black ≪Maiden Squadron≫ card under it. */
function stacked(battle: string[], hand: string[] = []): { s: EngineState; delivery: string; maiden: string } {
  const s = arenaG({ battle, hand });
  const deck = zoneOf(s, "p1", "deck");
  const [delivery, maiden] = deck;
  s.cards[delivery].cardId = "WP-DELIVERY";
  s.cards[maiden].cardId = "WP-MAIDEN";
  return { s, delivery, maiden };
}

// A <Heles> card's skill sends it from the deck to the Warp: it answers, looks
// at the next card and plays the ≪Maiden Squadron≫ card it finds.
{
  const staged = stacked(["WP-HELES"]);
  const { delivery, maiden } = staged;
  let s = staged.s;
  const heles = findG(s, "p1", "battle", "WP-HELES");
  s = playG(s, act(s, heles)!);
  assert.ok(zoneOf(s, "p1", "warp").includes(delivery), "the Heles skill sent it to the Warp");
  assert.equal(s.prompt.kind, "chooseCards", "BT30-106 answered and asks which looked-at card to play");
  const offered = s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : [];
  assert.deepEqual(offered, [maiden], "the choice is among the cards looked at, not the cards in play");
  s = choose(s, "p1", [maiden]);
  assert.ok(zoneOf(s, "p1", "battle").includes(maiden), "the looked-at ≪Maiden Squadron≫ card was played");
  assertConsistentG(s);
}

// Declining the play: the rest of the look goes to the Warp.
{
  const staged = stacked(["WP-HELES"]);
  const { delivery, maiden } = staged;
  let s = staged.s;
  s = playG(s, act(s, findG(s, "p1", "battle", "WP-HELES"))!);
  s = choose(s, "p1", []);
  assert.ok(zoneOf(s, "p1", "warp").includes(delivery));
  assert.ok(zoneOf(s, "p1", "warp").includes(maiden), "the card not played was sent to the Warp");
  assertConsistentG(s);
}

// Another card's skill does the same: no answer.
{
  const staged = stacked(["WP-OTHER"]);
  const { delivery, maiden } = staged;
  let s = staged.s;
  s = playG(s, act(s, findG(s, "p1", "battle", "WP-OTHER"))!);
  assert.ok(zoneOf(s, "p1", "warp").includes(delivery));
  assert.equal(s.prompt.kind, "main", "a non-Heles skill is not the moment");
  assert.equal(zoneOf(s, "p1", "deck")[0], maiden, "nothing was looked at or played");
  assertConsistentG(s);
}

// A <Heles> skill sends it to the Warp from the hand: not from the deck, no answer.
{
  let s = arenaG({ battle: ["WP-HELES-HAND"], hand: ["WP-DELIVERY"] });
  const delivery = findG(s, "p1", "hand", "WP-DELIVERY");
  const top = zoneOf(s, "p1", "deck")[0];
  s.cards[top].cardId = "WP-MAIDEN";
  s = playG(s, act(s, findG(s, "p1", "battle", "WP-HELES-HAND"))!);
  s = choose(s, "p1", [delivery]);
  assert.ok(zoneOf(s, "p1", "warp").includes(delivery), "the Heles skill sent it to the Warp from the hand");
  assert.equal(s.prompt.kind, "main", "from the hand is not the moment");
  assert.equal(zoneOf(s, "p1", "deck")[0], top, "nothing was looked at or played");
  assertConsistentG(s);
}

for (const id of TEMP) delete DEFS[id];
console.log("verify/warp: sent from your deck to the Warp by your skill");
