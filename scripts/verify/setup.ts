/**
 * The seed, and setting a game up (6-2).
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { assertConsistentG, energyMarkersOf, gameG, labelsG, leaderOf, playG, seedFrom, zoneOf } from "./harness";
import type { PlayerId } from "./harness";

// A seed has to fit a signed 32-bit column so it can be stored with the game.
{
  for (const text of ["1:2:1757000000000", "", "a", "zzzzzzzzzzzzzzzzzzzz"]) {
    const seed = seedFrom(text);
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 2147483647, `seed ${seed} fits an integer column`);
  }
}

// ── setup (6-2) ────────────────────────────────────────────────────────────

{
  let s = gameG();
  assert.equal(s.prompt.kind, "chooseFirst");
  const chooser = (s.prompt as { player: PlayerId }).player;
  s = playG(s, { type: "chooseFirst", player: chooser, first: "p1" });
  assert.equal(s.prompt.kind, "mulligan");
  assert.equal((s.prompt as { player: PlayerId }).player, "p1");
  assert.equal(zoneOf(s, "p1", "hand").length, 6);
  s = playG(s, { type: "mulligan", player: "p1", redraw: true });
  assert.equal(zoneOf(s, "p1", "hand").length, 6, "6-2-1-9-1: redraw six");
  assert.equal(zoneOf(s, "p1", "deck").length, 44);
  s = playG(s, { type: "mulligan", player: "p2", redraw: false });
  assert.equal(zoneOf(s, "p1", "life").length, 8, "6-2-1-10: eight life");
  assert.equal(zoneOf(s, "p2", "life").length, 8);
  assert.equal(energyMarkersOf(s, "p2"), 1, "6-2-1-11: second player gets an energy marker");
  assert.equal(energyMarkersOf(s, "p1"), 0);
  assert.equal(s.turn, 1);
  assert.equal(s.turnPlayer, "p1");
  assert.equal(s.phase, "charge");
  assert.equal(s.prompt.kind, "charge");
  assert.equal(zoneOf(s, "p1", "hand").length, 6, "7-2-9-1: no draw on the first player's first turn");
  assertConsistentG(s);

  // Charge, then Main: cost-1 plays are legal, attacks are not (7-3-4-4-1).
  const first = zoneOf(s, "p1", "hand")[0];
  s = playG(s, { type: "charge", player: "p1", card: first });
  assert.equal(zoneOf(s, "p1", "energy").length, 1);
  assert.equal(s.prompt.kind, "main");
  const l = labelsG(s);
  assert.ok(
    l.some((x) => x.startsWith("Play V1")),
    "can play a 1-cost with 1 energy",
  );
  assert.ok(!l.some((x) => x.startsWith("Attack")), "no attack on turn 1");
  assert.ok(l.includes("End turn"));

  // Play a card: energy rests, card in battle area, still Main.
  const v = zoneOf(s, "p1", "hand")[0];
  s = playG(s, { type: "play", player: "p1", card: v });
  assert.deepEqual(zoneOf(s, "p1", "battle"), [v]);
  assert.equal(s.cards[zoneOf(s, "p1", "energy")[0]].mode, "rest", "5-3-1: energy switched to Rest Mode");
  assert.ok(!labelsG(s).some((x) => x.startsWith("Play")), "no energy left");
  s = playG(s, { type: "endMain", player: "p1" });

  // p2's turn 2: draw, energy from the marker + charge.
  assert.equal(s.turn, 2);
  assert.equal(s.turnPlayer, "p2");
  assert.equal(zoneOf(s, "p2", "hand").length, 7, "7-2-9: the second player draws");
  assert.equal(s.cards[zoneOf(s, "p1", "energy")[0]].mode, "rest", "opponent's energy stays rested on my turn");
  s = playG(s, { type: "charge", player: "p2", card: zoneOf(s, "p2", "hand")[0] });
  const l2 = labelsG(s);
  assert.ok(
    l2.some((x) => x.startsWith("Attack L-RED with L-BLUE")),
    "8-1-1: the leader can attack the leader",
  );
  assert.ok(!l2.some((x) => x.includes(`with ${v}`)), "opponent's cards don't attack for me");
  assert.ok(!l2.some((x) => x.startsWith("Attack V1")), "8-1-1: active battle cards can't be attacked");
  assert.ok(
    l2.some((x) => x.startsWith("Play V-BLUE")),
    "1-14: an energy marker plus one energy pays cost 2? no — cost 1 with two sources",
  );

  // Attack the leader: offense → defense → damage. 10000 vs 10000 hits (8-4-6).
  s = playG(s, { type: "attack", player: "p2", attacker: leaderOf(s, "p2"), target: leaderOf(s, "p1") });
  assert.equal(s.cards[leaderOf(s, "p2")].mode, "rest", "8-1-1: attacking rests the attacker");
  assert.equal(s.prompt.kind, "combo");
  assert.equal((s.prompt as { side: string }).side, "offense");
  s = playG(s, { type: "pass", player: "p2" });
  assert.equal(s.prompt.kind, "combo");
  assert.equal((s.prompt as { player: PlayerId }).player, "p1");
  const lifeBefore = zoneOf(s, "p1", "life").length;
  const handBefore = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "pass", player: "p1" });
  assert.equal(zoneOf(s, "p1", "life").length, lifeBefore - 1, "21-3: one damage");
  assert.equal(zoneOf(s, "p1", "hand").length, handBefore + 1, "21-3: the life card goes to the hand");
  assert.equal(s.battle, null);
  assert.equal(s.prompt.kind, "main");
  assertConsistentG(s);

  // Turn 3: p1's rested energy and leader are active again (7-2-7).
  s = playG(s, { type: "endMain", player: "p2" });
  assert.equal(s.turnPlayer, "p1");
  assert.equal(s.cards[zoneOf(s, "p1", "energy")[0]].mode, "active");
  assert.equal(s.cards[leaderOf(s, "p2")].mode, "rest", "only the turn player's cards wake up");
}
