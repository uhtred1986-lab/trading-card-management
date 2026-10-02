/**
 * 20-14-1, "you can't do A unless you do B": the price an action carries,
 * paid by whoever takes it, each time — `forbid`'s `unlessPay` (BT30-100,
 * "…that card can't attack unless your opponent sends 2 cards from their hand
 * to their Warp each time").
 *
 * The compiler and the language half are engine-free; the board half runs on
 * whichever engine `--engine` names, so `npm test` holds both to it. Every card
 * defined here is taken out of DEFS again at the end, so the probe sweep
 * (`verify/probe.ts`, every DEFS card) is unchanged by them.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { DEFS, actsG, addEffectG, compileSkill, describeScript, findG, labelsG, leaderOf, parseSkills, playG, rejectedActionsG, stagedG, assertConsistentG, zoneOf } from "./harness";
import type { Action, EngineState, PlayerId } from "./harness";
import { deepEqual, parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Op } from "../../src/lib/arena/vm/script";

const one = (text: string) => compileSkill(parseSkills(text)[0]);

const TEMP: string[] = [];
const def = (id: string, o: Partial<(typeof DEFS)[string]>) => {
  DEFS[id] = { ...DEFS.V1, ...o, id, name: id };
  TEMP.push(id);
};

const TAX: Op[] = [{ op: "discard", n: 2, to: "warp" }];

// ── the compiler ────────────────────────────────────────────────────────────
{
  // BT30-100's clause, after the choice that names the card.
  const bt30 = one("[Auto] When this card attacks, choose up to 1 of your opponent's Battle Cards, and until the end of your opponent's turn, that card can't attack unless your opponent sends 2 cards from their hand to their warp each time.");
  assert.deepEqual(bt30.unsupported, []);
  const forbid = bt30.ops[1] as Extract<Op, { op: "forbid" }>;
  assert.deepEqual(
    { op: forbid.op, what: forbid.what, until: forbid.until, target: forbid.target, unlessPay: forbid.unlessPay, unless: forbid.unless },
    { op: "forbid", what: "attack", until: "nextTurn", target: { var: "c0" }, unlessPay: TAX, unless: undefined },
    "a price said from the payer's chair, not a condition",
  );
  assert.match(describeScript(bt30.ops), /the chosen cards can't attack unless, each time, the player doing it first pays: discard 2 to the Warp until the end of your opponent's turn$/);

  // A rule about a player, paid by that player.
  const side = one("[Auto] When you play this card, until the end of your opponent's turn, your opponent can't attack unless they send 1 card from their hand to their Warp each time.").ops;
  assert.deepEqual(side, [{ op: "forbid", what: "attack", side: "opponent", until: "nextTurn", unlessPay: [{ op: "discard", n: 1, to: "warp" }] }]);
  // A price named for the other player is not this rule's, and neither is a
  // tax on an action the engine does not charge one on: both stay unread.
  assert.notDeepEqual(one("[Auto] When you play this card, your opponent can't attack unless you send 1 card from your hand to your Warp each time.").unsupported, []);
  assert.notDeepEqual(one("[Auto] When you play this card, your opponent can't play Battle Cards unless they send 1 card from their hand to their Warp each time.").unsupported, []);
  // The plain condition is still a condition.
  const cond = one("[Permanent] This card can't attack unless you have a Z-Extra in your Battle Area.").ops[0] as Extract<Op, { op: "forbid" }>;
  assert.ok(cond.unless && !cond.unlessPay);
}

// ── the language: print → parse → the same record, and the validator ───────
{
  const rule: Rule = {
    kind: "auto",
    trigger: [],
    cost: null,
    cond: null,
    ops: [
      { op: "choose", sel: { side: "opponent", area: "battle", count: 1, upTo: true }, as: "c0" },
      { op: "forbid", what: "attack", until: "nextTurn", target: { var: "c0" }, unlessPay: TAX },
    ],
  };
  const text = printRule(rule);
  assert.match(text, /forbid\(what: attack, until: nextTurn, target: \$c0, unlessPay: \{\n\s+discard\(n: 2, to: warp\)\n\s+\}\)/);
  const back = parseRule(text);
  assert.ok(back.ok, back.ok ? "" : back.error.message);
  assert.ok(deepEqual(back.value, rule), "the price comes back as it went");
  assert.equal(printRule(back.value), text);
  assert.equal(validateRule(back.value, "auto"), null);
  // A tax on anything but an attack, an empty one, or one beside a condition, is refused.
  const bad = (forbid: Record<string, unknown>) => validateRule({ ...rule, ops: [{ op: "forbid", until: "turn", side: "opponent", ...forbid }] }, "auto");
  assert.ok(bad({ what: "block", unlessPay: TAX }), "only the attack charges a tax");
  assert.ok(bad({ what: "attack", unlessPay: [] }), "a price of nothing");
  assert.ok(bad({ what: "attack", unlessPay: TAX, unless: { kind: "isTurnPlayer" } }), "a price and a condition at once");
  assert.equal(bad({ what: "attack", unlessPay: TAX }), null);
}

// ── the board, on both engines ──────────────────────────────────────────────
const handOf = (s: EngineState, p: PlayerId) => zoneOf(s, p, "hand").length;
const attacks = (s: EngineState, attacker: string) => actsG(s).filter((a) => a.type === "attack" && a.attacker === attacker) as Extract<Action, { type: "attack" }>[];
/** Answer the price's question with the first cards offered, then decline every window until the Main Phase is back. */
function settle(s: EngineState): EngineState {
  for (let i = 0; i < 30 && s.prompt.kind !== "main"; i++) {
    if (s.prompt.kind === "chooseCards") {
      const c = s.prompt.choice;
      s = playG(s, { type: "choose", player: s.prompt.player, cards: c.candidates.slice(0, c.min) });
      continue;
    }
    s = playG(s, actsG(s).find((a) => a.type === "pass" || (a.type === "counter" && !a.card) || (a.type === "block" && !a.card)) ?? actsG(s)[0]);
  }
  assert.equal(s.prompt.kind, "main");
  return s;
}

def("TX-FODDER", {});
def("TX-ATT", {});

// A rule on one card, for the turn: refused without the price, paid each time.
{
  let s = stagedG({ battle: ["TX-ATT"], hand: ["TX-FODDER", "TX-FODDER", "TX-FODDER"] });
  const attacker = findG(s, "p1", "battle", "TX-ATT");
  addEffectG(s, [], { master: "p2", source: leaderOf(s, "p2"), target: attacker, kind: "forbid", value: 0, until: "turn", forbid: { what: "attack", pay: TAX } });
  const offered = attacks(s, attacker);
  assert.ok(offered.length, "three cards in hand pay a price of two");
  assert.ok(labelsG(s).some((l) => l.startsWith("Attack") && l.endsWith(" — first pay: discard 2 to the Warp")), "the button says what the attack costs");
  const warp = zoneOf(s, "p1", "warp").length;
  s = playG(s, { ...offered[0] });
  s = settle(s);
  assert.equal(handOf(s, "p1"), 1, "two cards paid");
  assert.equal(zoneOf(s, "p1", "warp").length, warp + 2, "to the Warp");
  assertConsistentG(s);

  // Each time: stood up again, the same card owes the price again — and one card in hand cannot pay it.
  s.cards[attacker].mode = "active";
  assert.equal(attacks(s, attacker).length, 0, "20-14-1: a price that cannot be paid is a ban");
  const why = rejectedActionsG(s).find((r) => r.action.type === "attack" && r.action.attacker === attacker)?.why ?? [];
  assert.ok(why.some((w) => w.kind === "forbidden" && /discard 2 to the Warp/.test(w.unless ?? "")), `the refusal names the price: ${JSON.stringify(why)}`);

  // For the turn: it ends with it.
  s = playG(s, { type: "endMain", player: "p1" });
  assert.ok(!(s as { effects: { kind: string }[] }).effects.some((e) => e.kind === "forbid"), "the rule ends with the turn");
}

// A rule about a player, from a [Permanent] of the other side: every attack pays, and a second one pays again.
{
  def("TX-WALL", { skill: "[Permanent] Your opponent can't attack unless they send 1 card from their hand to their Warp each time." });
  def("TX-ATT2", {});
  let s = stagedG({ battle: ["TX-ATT", "TX-ATT2"], hand: ["TX-FODDER", "TX-FODDER", "TX-FODDER"], oppBattle: ["TX-WALL"] });
  const a1 = findG(s, "p1", "battle", "TX-ATT");
  const a2 = findG(s, "p1", "battle", "TX-ATT2");
  s = settle(playG(s, { ...attacks(s, a1)[0] }));
  assert.equal(handOf(s, "p1"), 2, "the first attack paid one card");
  s = settle(playG(s, { ...attacks(s, a2)[0] }));
  assert.equal(handOf(s, "p1"), 1, "the second attack paid again");
  assertConsistentG(s);
  // The rule is p2's about p1: p2's own attacks are untaxed.
  assert.ok(!labelsG(s).some((l) => l.includes("first pay") && l.includes("TX-WALL")));
}

for (const id of TEMP) delete DEFS[id];
