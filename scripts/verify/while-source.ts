/**
 * "…while this card is in a Battle Area" trailing an [Auto] effect (BT29-041,
 * BT29-042): the `whileSourceInPlay` duration, which ends as the card that
 * made the effect leaves the Battle Area.
 *
 * The compiler half, the text language round trip, and the board half on
 * whichever engine `--engine` names — `npm test` runs it on both. Every card
 * defined here is taken out of DEFS again at the end, so the probe sweep
 * (`verify/probe.ts`, every DEFS card) is unchanged by them.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { DEFS, actsG, arenaG, assertConsistentG, compileSkill, describeScript, findG, forbidsG, hasG, koCardG, parseSkills, playG, zoneOf } from "./harness";
import type { EngineState, PlayerId } from "./harness";
import { parseRule, printRule, validateRule } from "../../src/lib/arena/lang";
import type { Trigger } from "../../src/lib/arena/types";

const BT29_041 = "[Auto] When this card is placed in a Battle Area, choose up to 1 of your opponent's Battle Cards and it can't activate skills while this card is in a Battle Area.";
const BT29_042 = "[Auto] When this card is placed in a Battle Area, choose up to 1 of your blue <Cooler> or ≪Cooler's Armored Squadron≫ Battle Cards and it gains [Barrier] while this card is in a Battle Area.";

const one = (text: string) => compileSkill(parseSkills(text)[0]);
const choose = (s: EngineState, player: PlayerId, cards: string[]) => (s.prompt.kind === "chooseCards" ? playG(s, { type: "choose", player, cards }) : s);

const TEMP: string[] = [];
const def = (id: string, o: Partial<(typeof DEFS)[string]>) => {
  DEFS[id] = { ...DEFS.V1, ...o, id, name: id };
  TEMP.push(id);
};

// ── the compiler, and the text language ─────────────────────────────────────
{
  const lock = one(BT29_041);
  assert.deepEqual(lock.unsupported, []);
  assert.deepEqual(lock.ops.map((o) => o.op), ["choose", "forbid"]);
  assert.deepEqual(lock.ops[1], { op: "forbid", what: "activateSkill", until: "whileSourceInPlay", target: { var: "c0" } });
  assert.equal(describeScript(lock.ops), "choose up to 1 Battle Card in your opponent's Battle Area, the chosen cards can't activate skills while this card is in a Battle Area");

  const barrier = one(BT29_042);
  assert.deepEqual(barrier.unsupported, []);
  assert.deepEqual(barrier.ops.map((o) => o.op), ["choose", "grant"]);
  assert.deepEqual(barrier.ops[1], { op: "grant", target: { var: "c0" }, keyword: { name: "Barrier" }, until: "whileSourceInPlay" });

  // The text language spells it like the other durations, and reads it back.
  for (const ops of [lock.ops, barrier.ops]) {
    const text = printRule({ kind: "auto", trigger: ["placed" as Trigger], cost: null, cond: null, ops });
    assert.match(text, /until: whileSourceInPlay/);
    const back = parseRule(text);
    assert.ok(back.ok, `the program does not parse back: ${text}`);
    assert.equal(validateRule(back.value, "auto"), null);
    assert.equal(printRule(back.value), text, "prints the same way twice");
  }

  // Only the trailing form: a duration already printed is not overridden.
  assert.equal((one("[Auto] When you play this card, choose up to 1 of your Battle Cards and it gains [Barrier] for the turn.").ops[1] as { until: string }).until, "turn");
}

// ── the board ───────────────────────────────────────────────────────────────
def("WS-LOCK", { energyCost: 1, skill: BT29_041.replace("When this card is placed in a Battle Area", "When you play this card") });
def("WS-BARRIER", { energyCost: 1, colors: ["Blue"], skill: BT29_042.replace("When this card is placed in a Battle Area", "When you play this card") });
def("WS-COOLER", { colors: ["Blue"], characters: ["Cooler"] });
def("WS-DRAWER", { skill: "[Activate: Main] Draw 1 card." });

// BT29-041: the lock holds while the source stays, and ends as it leaves.
{
  let s = arenaG({ hand: ["WS-LOCK"], energy: ["V1", "V1"], oppBattle: ["WS-DRAWER"] });
  const drawer = findG(s, "p2", "battle", "WS-DRAWER");
  s = choose(playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "WS-LOCK") }), "p1", [drawer]);
  const lock = findG(s, "p1", "battle", "WS-LOCK");
  assert.ok(forbidsG(s, "activateSkill", { player: "p2", card: drawer }), "the chosen card can't activate skills");
  s = playG(s, { type: "endMain", player: "p1" });
  for (let i = 0; i < 10 && !(s.prompt.kind === "main" && (s.prompt as { player: PlayerId }).player === "p2"); i++) s = playG(s, actsG(s).find((a) => a.type === "pass" || a.type === "charge") ?? actsG(s)[0]);
  assert.ok(!actsG(s).some((a) => a.type === "activate" && a.card === drawer), "still locked on the next turn: the duration is the source's, not the turn's");
  koCardG(s, lock);
  assert.ok(!zoneOf(s, "p1", "battle").includes(lock));
  assert.ok(!forbidsG(s, "activateSkill", { player: "p2", card: drawer }), "the source left the Battle Area, so the lock is over");
  assert.ok(actsG(s).some((a) => a.type === "activate" && a.card === drawer), "and the skill is offered again");
  assertConsistentG(s);
}

// BT29-042: [Barrier] while the source stays.
{
  let s = arenaG({ hand: ["WS-BARRIER"], energy: ["V-BLUE", "V-BLUE"], battle: ["WS-COOLER"] });
  const cooler = findG(s, "p1", "battle", "WS-COOLER");
  assert.ok(!hasG(s, cooler, "Barrier"));
  s = choose(playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "WS-BARRIER") }), "p1", [cooler]);
  assert.ok(hasG(s, cooler, "Barrier"), "the chosen <Cooler> gains [Barrier]");
  s = playG(s, { type: "endMain", player: "p1" });
  assert.ok(hasG(s, cooler, "Barrier"), "past the end of the turn");
  koCardG(s, findG(s, "p1", "battle", "WS-BARRIER"));
  assert.ok(!hasG(s, cooler, "Barrier"), "the source left the Battle Area, so [Barrier] goes with it");
  assertConsistentG(s);
}

// 9-6-3-2: "can't activate skills" cancels a pending [Auto] of the card too.
{
  def("WS-AUTO", { skill: "[Auto] When this card attacks, draw 1 card." });
  let s = arenaG({ hand: ["WS-LOCK"], energy: ["V1", "V1"], oppBattle: ["WS-AUTO"] });
  const auto = findG(s, "p2", "battle", "WS-AUTO");
  s = choose(playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "WS-LOCK") }), "p1", [auto]);
  s = playG(s, { type: "endMain", player: "p1" });
  for (let i = 0; i < 10 && !(s.prompt.kind === "main" && (s.prompt as { player: PlayerId }).player === "p2"); i++) s = playG(s, actsG(s).find((a) => a.type === "pass" || a.type === "charge") ?? actsG(s)[0]);
  const hand = zoneOf(s, "p2", "hand").length;
  const attack = actsG(s).find((a) => a.type === "attack" && a.attacker === auto);
  assert.ok(attack, "the locked card can still attack");
  s = playG(s, attack!);
  assert.equal(zoneOf(s, "p2", "hand").length, hand, "its [Auto] does not resolve");

  // The control: unlocked, the same attack draws.
  let t = arenaG({ oppBattle: ["WS-AUTO"] });
  const free = findG(t, "p2", "battle", "WS-AUTO");
  t = playG(t, { type: "endMain", player: "p1" });
  for (let i = 0; i < 10 && !(t.prompt.kind === "main" && (t.prompt as { player: PlayerId }).player === "p2"); i++) t = playG(t, actsG(t).find((a) => a.type === "pass" || a.type === "charge") ?? actsG(t)[0]);
  const before = zoneOf(t, "p2", "hand").length;
  t = playG(t, actsG(t).find((a) => a.type === "attack" && a.attacker === free)!);
  assert.equal(zoneOf(t, "p2", "hand").length, before + 1, "unlocked, its [Auto] draws");
}

for (const id of TEMP) delete DEFS[id];
