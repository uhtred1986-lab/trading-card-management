/**
 * 20-14-1, "you can't do A unless you do B": the price an action carries,
 * paid by whoever takes it, each time — `forbid`'s `unlessPay` (BT30-100,
 * "…that card can't attack unless your opponent sends 2 cards from their hand
 * to their Warp each time"); since 3 Oct 2026 also a declared play's
 * (BT31-093, BT31-150), paid as the play is declared, and a skill's switch of
 * energy to Active Mode (BT8-051), asked mid-resolution.
 *
 * The compiler and the language half are engine-free; the board half runs on
 * whichever engine `--engine` names, so `npm test` holds both to it. Every card
 * defined here is taken out of DEFS again at the end, so the probe sweep
 * (`verify/probe.ts`, every DEFS card) is unchanged by them.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { DEFS, actsG, addEffectG, compileSkill, describeScript, findG, labelsG, leaderOf, moveG, parseFilter, parseSkills, playG, rejectedActionsG, stagedG, assertConsistentG, zoneOf } from "./harness";
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
  assert.notDeepEqual(one("[Auto] When you play this card, your opponent can't block unless they send 1 card from their hand to their Warp each time.").unsupported, []);
  // A play's price out of the hand is a choice that never offers the card
  // being played (5-5-2-1), not a `discard`, which could not say so.
  assert.deepEqual(one("[Auto] When you play this card, your opponent can't play Battle Cards unless they send 1 card from their hand to their Warp each time.").ops, [
    {
      op: "forbid",
      what: "play",
      side: "opponent",
      until: "turn",
      filter: { ...parseFilter("battle card"), type: "BATTLE" },
      unlessPay: [
        { op: "choose", sel: { side: "you", area: "hand", count: 1, notSelf: "card" }, as: "tax0", reason: "send 1 card from your hand to your warp" },
        { op: "moveTo", target: { var: "tax0" }, to: "warp", reveal: true },
      ],
    },
  ]);
  // BT24-133: "until the end of their turn" is the opponent's, and the price's
  // choice never offers the attacker itself (20-14-1: B before A is declared).
  const rest = one("[Auto] When this card is played, your opponent can't attack until the end of their turn unless they switch 1 of their Active Mode cards to Rest Mode each time.").ops[0] as Extract<Op, { op: "forbid" }>;
  assert.equal(rest.until, "nextTurn");
  assert.deepEqual(rest.unlessPay?.map((o) => o.op), ["choose", "switchMode"]);
  assert.equal((rest.unlessPay![0] as Extract<Op, { op: "choose" }>).sel.notSelf, "card");
  // P-379's older spelling.
  assert.deepEqual(one("[Auto] When this card is played, your opponent can't attack for the turn unless they discard 1 card from their hand each time.").ops, [{ op: "forbid", what: "attack", side: "opponent", until: "turn", unlessPay: [{ op: "discard", n: 1 }] }]);
  // The plain condition is still a condition.
  const cond = one("[Permanent] This card can't attack unless you have a Z-Extra in your Battle Area.").ops[0] as Extract<Op, { op: "forbid" }>;
  assert.ok(cond.unless && !cond.unlessPay);
}

// ── the compiler: a play's price and a switch's (BT31-093, BT31-150, BT8-051) ─
const BT31_093 =
  "[Auto] [Limit 1] If you have 3 or more energy: When this card is played, draw 1 card, choose up to 1 of your opponent's Battle Cards, send it to its owner's Warp and during your opponent's next turn, when your opponent's Battle Card is played, your opponent can't play it unless they send 3 cards from their Drop to their owner's Warp.";
const BT31_150 =
  "[Auto] When this card is played, choose up to 1 of your opponent's Battle Cards, send it to its owner's Warp, and until the end of your opponent's turn, when your opponent's card is played, they can't play it unless they send 1 card from their hand to its owner's Warp.";
const BT8_051 =
  "[Auto] When you play this card, draw 1 card, then for the duration of the game, if the turn player would use the skill of a Battle Card or Extra Card to switch energy to Active Mode, they can't switch energy to Active Mode unless they choose 5 cards from their Drop Area and send them to their Warp.";
type Forbid = Extract<Op, { op: "forbid" }>;
const forbidIn = (ops: Op[]): Forbid => {
  const found: Forbid[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    if ((v as Op).op === "forbid") found.push(v as Forbid);
    for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k]);
  };
  walk(ops);
  assert.equal(found.length, 1, "one rule");
  return found[0];
};
{
  // BT31-093: the "when … is played" is the act the price is charged on, not a
  // trigger — a rule about the opponent's plays of Battle Cards, during their
  // next turn, paid out of their own Drop.
  const s93 = one(BT31_093);
  assert.deepEqual(s93.unsupported, []);
  const f93 = forbidIn(s93.ops);
  assert.deepEqual({ ...f93, unlessPay: undefined }, { op: "forbid", what: "play", until: "turn", side: "opponent", filter: { ...parseFilter("battle card"), type: "BATTLE" }, unlessPay: undefined });
  assert.deepEqual(
    f93.unlessPay?.map((o) => o.op),
    ["choose", "moveTo"],
  );
  const pick93 = f93.unlessPay![0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual({ side: pick93.sel.side, area: pick93.sel.area, count: pick93.sel.count }, { side: "you", area: "drop", count: 3 }, "3 cards of the payer's own Drop");
  assert.equal((f93.unlessPay![1] as Extract<Op, { op: "moveTo" }>).to, "warp");
  assert.match(JSON.stringify(s93.ops), /"scope":"opponentNextTurn"/, "during the opponent's next turn");

  // BT31-150: any card, until the end of the opponent's turn, paid out of the hand — never with the card being played.
  const f150 = forbidIn(one(BT31_150).ops);
  assert.deepEqual(one(BT31_150).unsupported, []);
  assert.equal(f150.what, "play");
  assert.equal(f150.side, "opponent");
  assert.equal(f150.until, "nextTurn");
  assert.equal(f150.filter, undefined, "any card");
  const pick150 = f150.unlessPay![0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual({ area: pick150.sel.area, count: pick150.sel.count, notSelf: pick150.sel.notSelf }, { area: "hand", count: 1, notSelf: "card" });

  // BT8-051: the turn player's switch of energy by a Battle or Extra Card's skill, for the game.
  const s51 = one(BT8_051);
  assert.deepEqual(s51.unsupported, []);
  assert.deepEqual(s51.ops[0], { op: "draw", n: 1 });
  const f51 = forbidIn(s51.ops);
  assert.deepEqual(
    { what: f51.what, side: f51.side, until: f51.until, turnPlayer: f51.turnPlayer, byTypes: f51.byTypes },
    { what: "switchEnergyToActive", side: "both", until: "game", turnPlayer: true, byTypes: ["BATTLE", "EXTRA"] },
  );
  const pick51 = f51.unlessPay![0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual({ area: pick51.sel.area, count: pick51.sel.count }, { area: "drop", count: 5 });

  // What stays unread: a description of the cards read only in part
  // (BT23-055), and half a price cut at its "and" (BT6-023).
  assert.notDeepEqual(
    one("[Auto] When this card is played, until the end of your opponent's turn, your opponent can't play a Battle Card with an original power the same as your declared number unless they place 1 card from their hand at the bottom of their deck.").unsupported,
    [],
  );
  assert.notDeepEqual(
    one("[Activate: Main] Draw 1 card, and for the duration of your opponent's next turn, your opponent can't play Battle Cards with 20000 power or less unless they choose 3 cards from their hand and place them in their Drop Area as an additional cost.").unsupported,
    [],
  );
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
  assert.ok(bad({ what: "block", unlessPay: TAX }), "a block charges no tax");
  assert.ok(bad({ what: "attack", unlessPay: [] }), "a price of nothing");
  assert.ok(bad({ what: "attack", unlessPay: TAX, unless: { kind: "isTurnPlayer" } }), "a price and a condition at once");
  assert.equal(bad({ what: "attack", unlessPay: TAX }), null);
  assert.equal(bad({ what: "play", unlessPay: TAX }), null, "a declared play charges one");
  assert.equal(bad({ what: "switchEnergyToActive", side: "both", turnPlayer: true, byTypes: ["BATTLE", "EXTRA"], unlessPay: TAX }), null, "and a skill's switch of energy");
  assert.ok(bad({ what: "switchEnergyToActive", byTypes: ["FIELD"], unlessPay: TAX }), "a card type that does not exist");

  // The three cards' own programs, whole: printed, parsed back to the same
  // record, printed the same again, and accepted by the validator.
  for (const [text, kind] of [
    [BT31_093, "auto"],
    [BT31_150, "auto"],
    [BT8_051, "auto"],
  ] as const) {
    const whole: Rule = { kind, trigger: [], cost: null, cond: null, ops: one(text).ops };
    const printed = printRule(whole);
    const parsed = parseRule(printed);
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.error.message);
    assert.ok(deepEqual(parsed.value, whole), `${text.slice(0, 60)}… comes back as it went`);
    assert.equal(printRule(parsed.value), printed);
    assert.equal(validateRule(parsed.value, kind), null);
  }
  assert.match(describeScript(one(BT8_051).ops), /the turn player can't switch energy to Active Mode with the skill of a Battle Card or an Extra Card unless/);
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

// A price paid by resting another card (BT24-133): the attacker is not one of them.
{
  const RESTS = one("[Auto] When this card is played, your opponent can't attack until the end of their turn unless they switch 1 of their Active Mode cards to Rest Mode each time.").ops[0] as Extract<Op, { op: "forbid" }>;
  const tax = (s: EngineState, attacker: string) => addEffectG(s, [], { master: "p2", source: leaderOf(s, "p2"), target: attacker, kind: "forbid", value: 0, until: "turn", forbid: { what: "attack", pay: RESTS.unlessPay } });
  let s = stagedG({ battle: ["TX-ATT"] });
  const attacker = findG(s, "p1", "battle", "TX-ATT");
  for (const id of [leaderOf(s, "p1"), ...zoneOf(s, "p1", "energy")]) s.cards[id].mode = "rest";
  tax(s, attacker);
  assert.equal(attacks(s, attacker).length, 0, "the attacker is the only active card, and it cannot pay for its own attack");
  s = stagedG({ battle: ["TX-ATT", "TX-ATT2"] });
  const a = findG(s, "p1", "battle", "TX-ATT");
  const other = findG(s, "p1", "battle", "TX-ATT2");
  for (const id of [leaderOf(s, "p1"), ...zoneOf(s, "p1", "energy")]) s.cards[id].mode = "rest";
  tax(s, a);
  s = settle(playG(s, { ...attacks(s, a)[0] }));
  assert.equal(s.cards[other].mode, "rest", "the other card paid");
  assertConsistentG(s);
}

// ── a play's price (BT31-150's, on p1's plays), on both engines ────────────
const PLAY_TAX = forbidIn(one(BT31_150).ops).unlessPay!;
const taxPlays = (s: EngineState) => addEffectG(s, [], { master: "p2", source: leaderOf(s, "p2"), target: "", kind: "forbid", value: 0, until: "turn", forbid: { what: "play", player: "p1", pay: PLAY_TAX } });
const plays = (s: EngineState, card: string) => actsG(s).filter((a) => a.type === "play" && a.card === card);
def("TX-PLAY", {});
def("TX-PLAY2", {});
{
  // The card being played is the only card in hand: the price cannot be paid, so the play is refused, naming it.
  let s = stagedG({ hand: ["TX-PLAY"], energy: ["V1"] });
  const card = findG(s, "p1", "hand", "TX-PLAY");
  assert.ok(plays(s, card).length, "untaxed, it is offered");
  taxPlays(s);
  assert.equal(plays(s, card).length, 0, "20-14-1: the card itself cannot pay for its own play");
  const why = rejectedActionsG(s).find((r) => r.action.type === "play" && (r.action as { card: string }).card === card)?.why ?? [];
  assert.ok(why.some((w) => w.kind === "forbidden" && /choose 1 card in your hand other than this card, move the chosen cards to warp/.test(w.unless ?? "")), `the refusal names the price: ${JSON.stringify(why)}`);

  // With another card in hand it is offered, says the price, and pays it as the play is declared.
  s = stagedG({ hand: ["TX-PLAY", "TX-FODDER", "TX-FODDER"], energy: ["V1"] });
  const played = findG(s, "p1", "hand", "TX-PLAY");
  taxPlays(s);
  const offered = plays(s, played);
  assert.equal(offered.length, 1);
  assert.ok(labelsG(s).some((l) => l.startsWith("Play TX-PLAY") && l.endsWith(" — first pay: choose 1 card in your hand other than this card, move the chosen cards to warp")), `the button says what the play costs: ${labelsG(s).join(" | ")}`);
  s = playG(s, offered[0]);
  assert.equal(s.prompt.kind, "chooseCards", "the price is asked first");
  const choice = s.prompt.kind === "chooseCards" ? s.prompt.choice : null;
  assert.equal(choice?.candidates.length, 2, "the two other cards");
  assert.ok(!choice?.candidates.includes(played), "never the card being played");
  s = settle(s);
  assert.ok(zoneOf(s, "p1", "battle").includes(played), "the play landed");
  assert.equal(zoneOf(s, "p1", "warp").filter((id) => s.cards[id].cardId === "TX-FODDER").length, 1, "the price went to the Warp");
  assert.equal(zoneOf(s, "p1", "hand").length, 1);
  assertConsistentG(s);
}
{
  // Each play pays: two plays, two cards.
  let s = stagedG({ hand: ["TX-PLAY", "TX-PLAY2", "TX-FODDER", "TX-FODDER"], energy: ["V1", "V1"] });
  taxPlays(s);
  /** Pay with a TX-FODDER: the other card waiting to be played could pay too. */
  const withFodder = (t: EngineState): EngineState => {
    if (t.prompt.kind !== "chooseCards") return t;
    const c = t.prompt.choice;
    return playG(t, { type: "choose", player: t.prompt.player, cards: c.candidates.filter((id) => t.cards[id].cardId === "TX-FODDER").slice(0, c.min) });
  };
  s = settle(withFodder(playG(s, plays(s, findG(s, "p1", "hand", "TX-PLAY"))[0])));
  s = settle(withFodder(playG(s, plays(s, findG(s, "p1", "hand", "TX-PLAY2"))[0])));
  assert.equal(zoneOf(s, "p1", "hand").length, 0, "each play paid one card");
  assert.equal(zoneOf(s, "p1", "warp").filter((id) => s.cards[id].cardId === "TX-FODDER").length, 2);
  // p2's own plays are not the rule's.
  assertConsistentG(s);
}
{
  // The price is paid as the play is declared — before the opponent may answer it with a [Counter: Play] — and stays paid when they do.
  def("TX-STOP", { ...DEFS["E-NEGATE"], skill: "[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played." });
  let s = stagedG({ hand: ["TX-PLAY", "TX-FODDER", "TX-FODDER"], energy: ["V1"], oppHand: ["TX-STOP"], oppEnergy: ["V1"] });
  const played = findG(s, "p1", "hand", "TX-PLAY");
  const fodder = findG(s, "p1", "hand", "TX-FODDER");
  taxPlays(s);
  s = playG(s, plays(s, played)[0]);
  assert.equal(s.prompt.kind, "chooseCards", "the price before the window");
  s = playG(s, { type: "choose", player: "p1", cards: [fodder] });
  assert.equal(s.prompt.kind, "counter", "then the [Counter: Play] window");
  assert.equal(s.prompt.kind === "counter" && s.prompt.window, "play");
  s = playG(s, { type: "counter", player: "p2", card: findG(s, "p2", "hand", "TX-STOP"), skill: 0 } as Action);
  assert.ok(zoneOf(s, "p1", "drop").includes(played), "countered: the card went to the Drop");
  assert.ok(zoneOf(s, "p1", "warp").includes(fodder), "and the price stays paid");
  s = settle(s);
  assertConsistentG(s);
}

// ── BT8-051: a skill switching energy to Active Mode, on both engines ──────
const SWITCH_TAX = forbidIn(one(BT8_051).ops);
def("TX-RAMP", { skill: "[Activate: Main] Switch all of your energy to Active Mode." });
def("TX-LRAMP", { ...DEFS["L-RED"], skill: "[Activate: Main] Switch all of your energy to Active Mode.", back: undefined });
assert.deepEqual(one("[Activate: Main] Switch all of your energy to Active Mode.").unsupported, []);
/** p1's Main Phase with TX-RAMP in play, two rested energy, `drop` cards in the Drop, and BT8-051's rule in force. */
function rampBoard(drop: number): EngineState {
  const s = stagedG({ battle: ["TX-RAMP"], energy: ["V1", "V1"] });
  for (const id of zoneOf(s, "p1", "energy")) s.cards[id].mode = "rest";
  for (const id of zoneOf(s, "p1", "deck").slice(0, drop)) moveG(s, id, "drop", "p1");
  addEffectG(s, [], {
    master: "p2",
    source: leaderOf(s, "p2"),
    target: "",
    kind: "forbid",
    value: 0,
    until: "game",
    forbid: { what: "switchEnergyToActive", turnPlayer: true, byTypes: SWITCH_TAX.byTypes, pay: SWITCH_TAX.unlessPay },
  });
  return s;
}
const ramp = (s: EngineState) => playG(s, { type: "activate", player: "p1", card: findG(s, "p1", "battle", "TX-RAMP"), skill: 0 } as Action);
const restedEnergy = (s: EngineState) => zoneOf(s, "p1", "energy").filter((id) => s.cards[id].mode === "rest").length;
{
  // Paid: asked mid-resolution, five cards of the Drop to the Warp, and the energy stands up.
  let s = ramp(rampBoard(6));
  assert.equal(s.prompt.kind, "chooseMode", "the skill's controller is asked to pay");
  s = playG(s, { type: "chooseMode", player: "p1", index: 0 });
  assert.equal(s.prompt.kind, "chooseCards");
  s = settle(s);
  assert.equal(restedEnergy(s), 0, "both energy switched to Active Mode");
  assert.equal(zoneOf(s, "p1", "drop").length, 1, "five of six left the Drop");
  assert.equal(zoneOf(s, "p1", "warp").length, 5, "for the Warp");
  assertConsistentG(s);
}
{
  // Declined: nothing is paid and the energy stays in Rest Mode.
  let s = ramp(rampBoard(6));
  s = settle(playG(s, { type: "chooseMode", player: "p1", index: 1 }));
  assert.equal(restedEnergy(s), 2, "the energy stays in Rest Mode");
  assert.equal(zoneOf(s, "p1", "drop").length, 6, "and nothing was paid");
}
{
  // Unpayable: four cards in the Drop — no question, and no switch.
  const s = settle(ramp(rampBoard(4)));
  assert.equal(restedEnergy(s), 2, "a price that cannot be paid is a switch that does not happen");
  assert.equal(zoneOf(s, "p1", "drop").length, 4);
}
{
  // A Leader's skill is not a Battle Card's or an Extra Card's: untaxed.
  let s = rampBoard(6);
  s.cards[leaderOf(s, "p1")].cardId = "TX-LRAMP";
  s = settle(playG(s, { type: "activate", player: "p1", card: leaderOf(s, "p1"), skill: 0 } as Action));
  assert.equal(restedEnergy(s), 0, "the Leader's switch is not the rule's");
  assert.equal(zoneOf(s, "p1", "drop").length, 6, "and costs nothing");
}

for (const id of TEMP) delete DEFS[id];
