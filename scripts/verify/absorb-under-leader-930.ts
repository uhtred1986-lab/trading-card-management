/**
 * #930, BT17-082 back#0 — Piccolo, Supreme Power: "[Permanent] When placing
 * Battle Cards under other cards to pay skill costs for your ≪Namekian≫
 * [Union Absorb] skills, you can use cards from under this card instead."
 *
 * Owner-accepted default of 25 Oct 2026 (#930 triage): cards under this Leader
 * substitute ONLY for the place-under material of a Namekian [Union-Absorb]
 * cost, one card for one, never for energy. The record is a standing
 * `permit(what: absorbMaterialUnder, filter: ≪Namekian≫)`; `resolveSelector`
 * offers the Leader's Battle Cards beside the cost's own areas to the material
 * choice of a recorded Absorb price (`absorbIdentity`) only, the cost's own
 * description still applying.
 *
 * Printed text -> skills -> stored-row JSON round trip (and the rules
 * language) -> the real VM, both seats, every step reloaded. Source:
 * docs/rules/rulemanual.txt 22-13-6-1; BT17-082's official card text
 * (docs/arena-backlog/evidence/907/fusion-materials-2026-10-19/online-sources.md:
 * "This names Absorb, not Fusion"; no FAQ or errata entry).
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { describeScript } from "../../src/lib/arena/vm/script";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, Color, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const FRONT = "[Auto] Place 1 ≪Namekian≫ card from your hand under this card: When this card attacks, draw 1 card, then look at up to 5 cards from the top of your deck, add up to 1 green or yellow ≪Namekian≫ card among them to your hand, and shuffle your deck.\n[Awaken] When your life is at 4 or less or there are 2 or more cards under this card: You may draw 1 card, switch up to 1 of your energy to Active Mode, add cards from your life to your hand until you have 5 life left, and flip this card over.";
const BACK = "[Permanent] When placing Battle Cards under other cards to pay skill costs for your ≪Namekian≫ [Union Absorb] skills, you can use cards from under this card instead.";
// BT17-091's printed line: one ≪Namekian≫ card from the hand or the Battle Area.
const BT17_091 = "[union absorb][once per turn]{1}, if your Leader Card is a ≪Namekian≫ card and you choose 1 ≪Namekian≫ card in your hand or Battle Area and place it under this card: Play up to 1 yellow <Piccolo> card with an energy cost of 3 from your deck or hand on top of this card, then shuffle your deck if you looked through it.";
// Two cards placed, to prove a mixed payment (hand and pile) and one-for-one.
const TWO = "[union absorb]{1}, choose 2 ≪Namekian≫ cards in your hand and place them under this card: Play up to 1 yellow <Piccolo> card with an energy cost of 3 from your deck on top of this card, then shuffle your deck.";
// The same cost on a non-Namekian card, and a Namekian price that is no [Union-Absorb].
const MAJIN = BT17_091.replace("if your Leader Card is a ≪Namekian≫ card and you choose", "you choose");
const ACTIVATE = "[Activate: Main][Once per turn] Choose 1 ≪Namekian≫ card in your hand and place it under this card: Draw 1 card.";

const nam = (id: string, o: Partial<CardDef> = {}) => card(id, { colors: ["Yellow"] as Color[], traits: ["Namekian"], power: 10000, energyCost: 2, skill: null, ...o });
const defs: Record<string, CardDef> = { ...DEFS,
  "L082": card("L082", { type: "LEADER", name: "Piccolo", colors: ["Yellow"], characters: ["Piccolo"], traits: ["Namekian"], power: 10000, energyCost: null, skill: FRONT, back: { name: "Piccolo, Supreme Power", power: 15000, skill: BACK } }),
  "ABS": nam("ABS", { characters: ["Nail"], skill: BT17_091 }),
  "ABS2": nam("ABS2", { characters: ["Kami"], skill: TWO }),
  "MAJ": card("MAJ", { colors: ["Yellow"], traits: ["Majin"], characters: ["Buu"], skill: MAJIN }),
  "ACT": nam("ACT", { characters: ["Dende"], skill: ACTIVATE }),
  // Materials: a ≪Namekian≫ Battle Card, a ≪Namekian≫ Extra, a Battle Card of another trait.
  "M-NAM": nam("M-NAM", { characters: ["Cargo"] }),
  "M-NAMX": nam("M-NAMX", { type: "EXTRA", characters: [], power: null }),
  "M-SAI": card("M-SAI", { colors: ["Yellow"], traits: ["Saiyan"], characters: ["Raditz"] }),
  "PIC3": nam("PIC3", { characters: ["Piccolo"], energyCost: 3, power: 20000 }),
  "Y-E": card("Y-E", { colors: ["Yellow"] }),
};

// ── 1. the reading ───────────────────────────────────────────────────────────
const back = skillRecords(defs.L082).filter((r) => r.side === "back");
{
  assert.equal(back.length, 1, "BT17-082 has one back skill");
  const rec = back[0];
  assert.deepEqual(rec.unread, [], "BT17-082 back#0: nothing unread");
  assert.equal(rec.ops.length, 1);
  const op = rec.ops[0];
  assert.ok(op.op === "permit" && op.what === "absorbMaterialUnder", "a standing absorbMaterialUnder permission");
  if (op.op !== "permit") throw new Error("unreachable");
  assert.deepEqual(op.target, { sel: { special: "self" } }, "…from under this card");
  assert.equal(op.until, "game");
  assert.deepEqual(op.filter?.traits, ["Namekian"], "…for ≪Namekian≫ cards' [Union-Absorb]");
  assert.match(describeScript(rec.ops), /\[Union-Absorb\].*from under this card instead, one for one/);
  const rule = { kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops } as Rule;
  assert.equal(validateRule(rule, rec.kind), null, "the record validates");
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, "the rules language prints and reparses it");
  assert.deepEqual(round.value, rule, "…unchanged");
  // Other wordings stay unread: no Fusion, no energy, no other pile.
  for (const other of [
    "[Permanent] When placing Battle Cards under other cards to pay skill costs for your ≪Namekian≫ [Union Fusion] skills, you can use cards from under this card instead.",
    "[Permanent] When paying energy for your ≪Namekian≫ [Union Absorb] skills, you can use cards from under this card instead.",
  ]) assert.ok(skillRecords(card("X", { skill: other }))[0].unread.length > 0, `stays unread: ${other}`);
  // The Absorb lines themselves are unchanged: still their own price program.
  const abs = skillRecords(defs.ABS)[0];
  assert.deepEqual(abs.unread, []);
  assert.ok(abs.cost?.absorb, "BT17-091 keeps its typed Absorb procedure");
  assert.equal(describeScript(abs.cost?.program ?? []), "choose 1 ≪Namekian≫ card in your hand or Battle Area, move the chosen cards to under");
  const two = skillRecords(defs.ABS2)[0];
  assert.deepEqual(two.unread, [], "the two-card fixture is read");
  assert.ok(two.cost?.absorb);
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;

function take(s: VmState, action: Action): VmState {
  return roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
}
function fresh(seat: PlayerId, seed: number): VmState {
  const leaders = { p1: seat === "p1" ? "L082" : "L-BLUE", p2: seat === "p2" ? "L082" : "L-BLUE" };
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader: leaders.p1, main: fifty("V1") }, p2: { name: "Second", leader: leaders.p2, main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(seat === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action);
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  // The second player's energy marker would pay an orb; every orb here is paid by energy cards.
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); return id;
}
function underLeader(s: VmState, p: PlayerId, def: string): string {
  const id = s.sides[p].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, "under", { under: s.sides[p].zones.leader[0] }).ok); return id;
}
const lineOf = (text: string) => parseSkills(text)[0].index;
const offer = (s: VmState, c: string, text: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === lineOf(text));

interface Board { s: VmState; leader: string; abs: string; pile: string[] }
function board(seat: PlayerId, seed: number, o: { abs?: string; pile?: string[]; hand?: string[]; energy?: number; awakened?: boolean } = {}): Board & { hand: string[] } {
  const s = fresh(seat, seed);
  const leader = s.sides[seat].zones.leader[0];
  s.cards[leader].flipped = o.awakened ?? true;
  const abs = stage(s, seat, o.abs ?? "ABS", "battle");
  const pile = (o.pile ?? ["M-NAM"]).map((d) => underLeader(s, seat, d));
  const hand = (o.hand ?? []).map((d) => stage(s, seat, d, "hand"));
  for (let i = 0; i < (o.energy ?? 1); i++) stage(s, seat, "Y-E", "energy");
  // A Piccolo of cost 3 at the top of the deck for the effect to find.
  s.cards[s.sides[seat].zones.deck[0]].cardId = "PIC3";
  return { s, leader, abs, pile, hand };
}

/** Declare, answer every material prompt with `picks` (in order), take the first effect card offered. */
function run(b: Board, text: string, picks: string[]): { s: VmState; offered: string[][] } {
  const o = offer(b.s, b.abs, text);
  assert.ok(o, "the Absorb is offered");
  let s = take(b.s, o.action);
  const offered: string[][] = [];
  const left = [...picks];
  for (let i = 0; i < 30 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    if (q.kind === "chooseCards") {
      offered.push([...q.choice.candidates]);
      const want = left.find((id) => q.choice.candidates.includes(id));
      if (want) { left.splice(left.indexOf(want), 1); s = take(s, { type: "choose", player: q.player, cards: [want] }); }
      else s = take(s, { type: "choose", player: q.player, cards: q.choice.candidates.length ? [q.choice.candidates[0]] : [] });
    } else if (q.kind === "payCost") s = take(s, { type: "payCost", player: q.player, option: 0 } as Action);
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null } as Action);
    else s = take(s, { type: "pass", player: (q as { player: PlayerId }).player } as Action);
  }
  assert.equal(s.prompt.kind, "main");
  assert.deepEqual(left, [], "every intended material was offered and taken");
  return { s, offered };
}
const rested = (s: VmState, p: PlayerId) => s.sides[p].zones.energy.filter((id) => s.cards[id].mode === "rest").length;
const played = (s: VmState, p: PlayerId) => s.sides[p].zones.battle.find((c) => s.cards[c].cardId === "PIC3");

const cases: string[] = [];
for (const seat of ["p1", "p2"] as const) {
  // A card from under the awakened Leader pays BT17-091's material; the energy is still paid.
  {
    const b = board(seat, 8200, { pile: ["M-NAM", "M-NAMX", "M-SAI"] });
    const [nm, nx, ns] = b.pile;
    const { s, offered } = run(b, BT17_091, [nm]);
    assert.ok(offered[0].includes(nm), `${seat}: the ≪Namekian≫ Battle Card under the Leader is offered`);
    assert.ok(!offered[0].includes(nx), "an Extra under the Leader is no Battle Card: not offered");
    assert.ok(!offered[0].includes(ns), "a non-≪Namekian≫ Battle Card fails the cost's own description");
    assert.ok(!s.cards[b.leader].under.includes(nm), "it left the Leader's pile");
    assert.deepEqual(new Set(s.cards[b.leader].under), new Set([nx, ns]), "…and only it");
    const top = played(s, seat);
    assert.ok(top, "the effect resolved: a <Piccolo> is played on top");
    assert.ok(s.cards[top!].under.includes(b.abs) && s.cards[top!].under.includes(nm), "the substituted card is the placed material, in the pile");
    assert.equal(rested(s, seat), 1, "the {1} is paid with energy, not with a pile card");
    cases.push(`${seat}/substitute`);
  }

  // Mixed payment, one for one: two cards owed, one from the hand and one from under the Leader.
  {
    const b = board(seat, 8201, { abs: "ABS2", pile: ["M-NAM"], hand: ["M-NAM", "M-NAM"] });
    const { s, offered } = run(b, TWO, [b.hand[0], b.pile[0]]);
    assert.ok(offered[0].includes(b.hand[0]) && offered[0].includes(b.pile[0]), `${seat}: hand and pile are offered together`);
    const top = played(s, seat);
    assert.ok(top, "paid in full, the effect resolves");
    for (const m of [b.hand[0], b.pile[0]]) assert.ok(s.cards[top!].under.includes(m), "both cards were placed");
    assert.deepEqual(s.cards[b.leader].under, [], "the pile gave one card");
    assert.deepEqual(s.sides[seat].zones.hand, [b.hand[1]], "the hand gave one card");
    cases.push(`${seat}/mixed`);
  }
  // Both from the pile.
  {
    const b = board(seat, 8202, { abs: "ABS2", pile: ["M-NAM", "M-NAM"], hand: ["M-NAM"] });
    const { s } = run(b, TWO, b.pile);
    assert.ok(played(s, seat), `${seat}: two pile cards pay the two-card material`);
    assert.deepEqual(s.cards[b.leader].under, []);
    cases.push(`${seat}/pile-only`);
  }
  // One for one: one pile card never counts as two.
  {
    const b = board(seat, 8203, { abs: "ABS2", pile: ["M-NAM"] });
    assert.equal(offer(b.s, b.abs, TWO), undefined, `${seat}: one card under the Leader cannot pay a two-card material`);
    cases.push(`${seat}/one-for-one`);
  }
  // Never energy: a full pile pays no orb.
  {
    const b = board(seat, 8204, { pile: ["M-NAM", "M-NAM", "M-NAM"], energy: 0 });
    assert.equal(offer(b.s, b.abs, BT17_091), undefined, `${seat}: no energy, no Absorb, however many cards are under the Leader`);
    cases.push(`${seat}/never-energy`);
  }
  // Without the permission: front side (not awakened), or another Leader.
  {
    const b = board(seat, 8205, { awakened: false });
    assert.equal(offer(b.s, b.abs, BT17_091), undefined, `${seat}: BT17-082 front side: the pile pays nothing`);
    const c = board(seat, 8206);
    c.s.cards[c.leader].cardId = "L-BLUE";
    assert.equal(offer(c.s, c.abs, BT17_091), undefined, `${seat}: another Leader: nothing`);
    cases.push(`${seat}/no-permission`);
  }
  // With the pile available but a normal material too, the normal one still works.
  {
    const b = board(seat, 8207, { hand: ["M-NAM"] });
    const { s, offered } = run(b, BT17_091, [b.hand[0]]);
    assert.ok(offered[0].includes(b.pile[0]), "the pile is offered beside the hand");
    assert.ok(s.cards[b.leader].under.includes(b.pile[0]), `${seat}: chose the hand card, the pile is untouched`);
    cases.push(`${seat}/hand-still-pays`);
  }
  // Only a ≪Namekian≫ card's [Union-Absorb]: not another trait's, and not another kind of price.
  {
    const b = board(seat, 8208, { abs: "MAJ" });
    assert.equal(offer(b.s, b.abs, MAJIN), undefined, `${seat}: a non-≪Namekian≫ Absorb is not widened`);
    const c = board(seat, 8209, { abs: "ACT" });
    assert.equal(offer(c.s, c.abs, ACTIVATE), undefined, `${seat}: a Namekian [Activate: Main] place-under price is not widened`);
    // Controls: each is offered once its own material is in the hand.
    const d = board(seat, 8210, { abs: "MAJ", hand: ["M-NAM"] });
    assert.ok(offer(d.s, d.abs, MAJIN), "control: the non-Namekian Absorb is payable from the hand");
    const e = board(seat, 8211, { abs: "ACT", hand: ["M-NAM"] });
    assert.ok(offer(e.s, e.abs, ACTIVATE), "control: the [Activate: Main] is payable from the hand");
    cases.push(`${seat}/scope`);
  }
  // The opponent's awakened BT17-082 widens nothing of yours.
  {
    const b = board(seat, 8212, { abs: "ABS2", pile: [], hand: ["M-NAM"] });
    const foe: PlayerId = seat === "p1" ? "p2" : "p1";
    const theirs = b.s.sides[foe].zones.leader[0];
    b.s.cards[theirs].cardId = "L082"; b.s.cards[theirs].flipped = true;
    for (let i = 0; i < 2; i++) { const id = b.s.sides[foe].zones.deck.at(-1)!; b.s.cards[id].cardId = "M-NAM"; assert.ok(moveCard(b.s, game, id, "under", { under: theirs }).ok); }
    assert.equal(offer(b.s, b.abs, TWO), undefined, `${seat}: cards under the opponent's Leader never pay your material`);
    cases.push(`${seat}/opponent-leader`);
  }
}

console.log(`absorb-under-leader-930: BT17-082 back#0 — under-Leader substitution for Namekian Absorb material, ${cases.length} both-seat reload cases`);
