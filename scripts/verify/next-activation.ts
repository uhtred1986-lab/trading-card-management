/**
 * "The next time you activate …, reduce its skill cost by …" — a one-use
 * change to a skill line's price (`costReduction`'s `uses`), BT31-096,
 * BT31-092, BT30-106 and the rest of the 40 cards that print it.
 *
 * The compiler half reads the wordings; the board half runs on whichever
 * engine `--engine` named, so `npm test` runs it on both: the first
 * activation the change reaches costs less and spends it, the second costs
 * the full price, the menu offers the line at the reduced price and no
 * further, and an unspent change still ends with the turn. Every card defined
 * here is taken out of DEFS again at the end, so the probe sweep is unchanged.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { DEFS, actsG, arenaG, assertConsistentG, compileSkill, describeScript, findG, leaderOf, parseSkills, playG, zoneOf } from "./harness";
import type { Action, EngineState, PlayerId } from "./harness";
import type { ContinuousEffect } from "../../src/lib/arena/types";

const one = (text: string) => compileSkill(parseSkills(text)[0]);

// ── the compiler ────────────────────────────────────────────────────────────
{
  // BT31-096: the +5000 and the one-use reduction, under the Leader condition.
  const bt31096 = one("[Auto] [Limit 1] If your Leader is a black <Vegito> card: When this card is played, your Leader gets +5000 power for the turn, and the next time you activate an [Activate] skill of your Leader during this turn, reduce its skill cost by {b}.");
  assert.deepEqual(bt31096.unsupported, []);
  const then96 = (bt31096.ops[0] as { op: string; then: unknown[] }).then;
  assert.deepEqual(then96[1], { op: "costReduction", target: { sel: { special: "leader" } }, amount: 1, what: "skill", skillKind: "activate", colors: ["Black"], until: "turn", uses: 1 });
  assert.match(describeScript(bt31096.ops), /your leader's skill cost for \[Activate\] skills is 1 less the next time it is paid$/);

  // BT31-092: the same, without the +5000.
  const bt31092 = one("[Auto] [Limit 1] If your Leader is a black <Vegito> card: When this card is played, the next time you activate an [Activate] skill of your Leader during this turn, reduce its skill cost by {b}.");
  assert.deepEqual(bt31092.unsupported, []);
  assert.deepEqual((bt31092.ops[0] as { then: unknown[] }).then, [then96[1]]);

  // BT30-106: "the [Activate: Main/Battle] skill on {Support Broadcast} in your
  // Battle Area" — every copy there, and "the skill cost" rather than "its".
  const bt30106 = one("[Counter: Attack] Negate the attack, and the next time you activate the [Activate: Main/Battle] skill on {Support Broadcast} in your Battle Area during this turn, reduce the skill cost by {1}.");
  assert.deepEqual(bt30106.unsupported, []);
  const broadcast = bt30106.ops[1] as { op: string; target: { sel: { area: string; count: number; filter: { names: string[] } } }; skillKind: string; amount: number; colors: string[]; uses: number; until: string };
  assert.deepEqual([broadcast.op, broadcast.target.sel.area, broadcast.target.sel.count, broadcast.target.sel.filter.names], ["costReduction", "battle", 99, ["Support Broadcast"]]);
  assert.deepEqual([broadcast.skillKind, broadcast.amount, broadcast.colors, broadcast.uses, broadcast.until], ["activate", 1, ["any"], 1, "turn"]);

  // A scope the reader does not know is refused whole, both halves of it.
  const unknown = one("[Auto] When this card is played, the next time you activate a skill during this turn, reduce its skill cost by {1}.");
  assert.deepEqual(unknown.ops, []);
  assert.equal(unknown.unsupported.length, 2, "neither half is left behind as a reduction for the whole turn");
}

// ── the board ───────────────────────────────────────────────────────────────
{
  const TEMP: string[] = [];
  const def = (id: string, o: Partial<(typeof DEFS)[string]>) => {
    DEFS[id] = { ...DEFS.V1, ...o, id, name: id };
    TEMP.push(id);
  };
  def("NT-LEAD", { ...DEFS["L-RED"], colors: ["Black"], back: undefined, skill: "[Activate: Main] {b}{1}: Draw 1 card." });
  def("NT-VEG", { colors: ["Black"], energyCost: 0, skill: "[Auto] When this card is played, the next time you activate an [Activate] skill of your Leader during this turn, reduce its skill cost by {b}." });
  def("NT-BLACK", { colors: ["Black"] });

  const act = (s: EngineState, card: string) => actsG(s).find((a) => a.type === "activate" && a.card === card) as Action | undefined;
  const pay = (s: EngineState) => (s.prompt.kind === "payCost" ? playG(s, { type: "payCost", player: "p1", option: 0 } as Action) : s);
  const rested = (s: EngineState, p: PlayerId) => zoneOf(s, p, "energy").filter((id) => s.cards[id].mode === "rest").length;
  const oneUse = (s: EngineState, leader: string) => (s as unknown as { effects: ContinuousEffect[] }).effects.filter((e) => e.kind === "skillCost" && e.target === leader);
  const start = (energy: string[]) => {
    const s = arenaG({ hand: ["NT-VEG"], energy });
    s.cards[leaderOf(s, "p1")].cardId = "NT-LEAD";
    return s;
  };

  // The first activation costs {b} less and spends it; the second costs the
  // whole {b}{1}; the third is not on the menu with one energy left.
  {
    let s = start(["NT-BLACK", "NT-BLACK", "V1", "V1"]);
    const leader = leaderOf(s, "p1");
    assert.equal(zoneOf(s, "p1", "energy").length, 4);
    s = pay(playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "NT-VEG") }));
    assert.equal(rested(s, "p1"), 0, "NT-VEG costs nothing");
    assert.deepEqual(oneUse(s, leader).map((e) => e.uses), [1], "in force, with one use");
    s = pay(playG(s, act(s, leader)!));
    assert.equal(rested(s, "p1"), 1, "the first activation pays {1}: {b}{1} less {b}");
    assert.deepEqual(oneUse(s, leader), [], "and spends the change");
    s = pay(playG(s, act(s, leader)!));
    assert.equal(rested(s, "p1"), 3, "the second pays the whole {b}{1}");
    assert.equal(act(s, leader), undefined, "one energy left: {b}{1} is not offered again");
    assertConsistentG(s);
  }

  // The menu sees the reduction: with two red energy and no black, {b}{1} is
  // not there until the change makes it {1} — and then only once.
  {
    let s = start(["V1", "V1"]);
    const leader = leaderOf(s, "p1");
    assert.equal(act(s, leader), undefined, "no black energy: {b}{1} is not payable");
    s = pay(playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "NT-VEG") }));
    assert.ok(act(s, leader), "with the change in force it is {1}, and offered");
    assert.deepEqual(oneUse(s, leader).map((e) => e.uses), [1], "offering it spent nothing");
    s = pay(playG(s, act(s, leader)!));
    assert.equal(rested(s, "p1"), 1);
    assert.equal(act(s, leader), undefined, "spent: the full price again, which red energy cannot pay");
    assertConsistentG(s);
  }

  // Unused, it still ends with the turn.
  {
    let s = start(["V1", "V1"]);
    const leader = leaderOf(s, "p1");
    s = pay(playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "NT-VEG") }));
    assert.equal(oneUse(s, leader).length, 1);
    s = playG(s, { type: "endMain", player: "p1" });
    assert.notEqual(s.turnPlayer, "p1", "the turn has passed");
    assert.deepEqual(oneUse(s, leader), [], "bounded by `until: turn`, used or not");
  }

  for (const id of TEMP) delete DEFS[id];
}
