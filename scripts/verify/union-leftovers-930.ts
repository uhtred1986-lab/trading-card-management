/**
 * #930, the three clauses still unread on Union-related cards once their
 * moments and prices were read:
 *
 *  - BT7-123 front#30 — Fused Zamasu, Divine Providence: "[auto] When you play
 *    this card with [union], your opponent reveals their hand, and you choose
 *    up to 2 cards from it and **add them to their energy in Rest Mode**." The
 *    trigger has been gated on a successful [Union] entry since #1177; the
 *    move is read now: the chosen cards go to their owner's (the opponent's)
 *    Energy Area in Rest Mode (3-8).
 *  - BT26-088 front#20: "…You may reveal 1 mono-green <Vegito> card from your
 *    hand and switch the same number of your green energy as that card's
 *    specified cost to Rest Mode. If you do, **play the revealed card on top of
 *    this card**." The offer is now the pick of one such card, its reveal, and
 *    exactly as many of your Active Mode green energy switched to Rest Mode as
 *    its specified cost (1-2-3), counted as the choice is made (`choose`'s
 *    `exactly`); "if you do" plays that card on top of this card (5-5-3: no
 *    energy cost). Before, the switch read "that card" as the revealed card and
 *    switched the Vegito itself, outside the offer, and the play was unread.
 *    Only a Vegito whose specified cost the Active green energy can pay in
 *    full is on offer (owner's ruling of 26 Oct 2026, `choose`'s
 *    `specifiedCostAtMost`); with none payable the reveal has no candidates,
 *    nothing is switched and nothing is played.
 *  - BT29-150 front#10: "[auto] When this card is removed from a Unison Area,
 *    **both players send cards from their hands to their owners' Warps until
 *    both hands have 7 cards**." Each player gives up the excess of their own
 *    hand over 7, choosing the cards themselves (20-7); a hand of 7 or fewer
 *    sends nothing. The turn player acts first (0-2-8, owner's ruling of 26
 *    Oct 2026), also when the skill resolves on the opponent's turn.
 *
 * Proved here: the records (nothing unread, the stored-row JSON round trip,
 * the rules language's print and reparse), and in the VM for both seats with
 * every action reloaded from JSON. Printed texts:
 * skills/dbs-rules-review/data/open-rules.json and
 * docs/arena-backlog/evidence/923/inventory.json (catalog snapshot of 15 Oct
 * 2026). Costs, powers and the companion cards are synthetic.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, Color, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── printed texts ────────────────────────────────────────────────────────────
const BT7_123_F10 = "[union-potara] {u}{u}{u}{u}{y}{y}: Blue <Goku Black> and yellow <Zamasu>";
const BT7_123_F30 = "[auto] When you play this card with [union], your opponent reveals their hand, and you choose up to 2 cards from it and add them to their energy in Rest Mode.";
const BT26_088_F20 =
  "[Activate: Main][Once per turn] If you have 3 or more energy and you choose 1 <Son Goku> and 1 <Vegeta> card -- both green and with energy costs of 4 or less -- from among all cards in your Z-Energy and Battle Area and place them under this card: You may reveal 1 mono-green <Vegito> card from your hand and switch the same number of your green energy as that card's specified cost to Rest Mode. If you do, play the revealed card on top of this card.";
const BT29_150_F10 = "[auto] When this card is removed from a Unison Area, both players send cards from their hands to their owners' Warps until both hands have 7 cards.";
// BT29-150 leaves its Unison Area here by its own last marker (21-9-2); a plain [-1] line stands in for its other lines.
const BT29_150_TEST = `${BT29_150_F10}\n[-1][activate: main] Draw 1 card.`;

const mat = (id: string, colors: Color[], characters: string[], o: Partial<CardDef> = {}) => card(id, { colors, characters, power: 10000, energyCost: 1, skill: null, ...o });
const defs: Record<string, CardDef> = {
  ...DEFS,
  "L-GRN": card("L-GRN", { type: "LEADER", colors: ["Green"], characters: ["Vegito"], power: 10000, energyCost: null, skill: null }),
  "L-BY": card("L-BY", { type: "LEADER", colors: ["Blue", "Yellow"], characters: ["Zamasu"], power: 10000, energyCost: null, skill: null }),
  // BT7-123: its [Union-Potara] line and the [Auto] (22-13-5), with the two materials it names.
  BT7123: card("BT7123", { name: "Fused Zamasu, Divine Providence", colors: ["Blue", "Yellow"], characters: ["Fused Zamasu"], energyCost: 6, power: 30000, skill: `${BT7_123_F10}\n${BT7_123_F30}` }),
  BLACK: mat("BLACK", ["Blue"], ["Goku Black"]),
  ZAMASU: mat("ZAMASU", ["Yellow"], ["Zamasu"]),
  "U-E": mat("U-E", ["Blue"], ["Filler"]),
  "Y-E": mat("Y-E", ["Yellow"], ["Filler"]),
  // BT26-088 and what its price places under it; the Vegitos it may reveal.
  BT26088: card("BT26088", { colors: ["Green"], characters: ["Potara Host"], energyCost: 5, power: 20000, skill: BT26_088_F20 }),
  GOKU: mat("GOKU", ["Green"], ["Son Goku"], { energyCost: 3 }),
  VEGETA: mat("VEGETA", ["Green"], ["Vegeta"], { energyCost: 3 }),
  VEGITO3: mat("VEGITO3", ["Green"], ["Vegito"], { energyCost: 6, power: 35000, specifiedCost: { Green: 3 } }),
  VEGITO2: mat("VEGITO2", ["Green"], ["Vegito"], { energyCost: 4, power: 30000, specifiedCost: { Green: 2 } }),
  "VEGITO-GY": mat("VEGITO-GY", ["Green", "Yellow"], ["Vegito"], { energyCost: 4, power: 30000, specifiedCost: { Green: 1, Yellow: 1 } }),
  "G-E": mat("G-E", ["Green"], ["Filler"]),
  "R-E": mat("R-E", ["Red"], ["Filler"]),
  // The opponent's skill that removes a Unison on their own turn.
  KICK: card("KICK", { colors: ["Blue"], energyCost: 1, power: 10000, skill: "[Activate: Main] Choose up to 1 of your opponent's Unisons and place it in its owner's Drop Area." }),
  // BT29-150, a Unison.
  BT29150: card("BT29150", { type: "UNISON", colors: ["Black"], characters: ["Filler"], energyCost: "X", power: 15000, comboCost: null, comboPower: null, skill: BT29_150_TEST }),
};

// ── 1. the records ───────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Rec = ReturnType<typeof skillRecords>[number];
const asRule = (rec: Rec) => roundtrip({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops }) as Rule;
/** The record of `text`, through the stored-row JSON round trip and the rules language's print and reparse. */
function record(def: CardDef, what: string): Rec {
  const recs = skillRecords(def);
  assert.equal(recs.length, 1, `${what}: one record`);
  const rule = asRule(recs[0]);
  assert.equal(validateRule(rule, recs[0].kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  // `upTo: false` is the selector default, and a selector over several areas prints its `areas` alone
  // (`area` is the first of them): neither is printed by the language.
  const plain = (v: unknown) =>
    JSON.parse(JSON.stringify(v, function (this: Record<string, unknown>, k, x) {
      if (k === "upTo" && x === false) return undefined;
      if (k === "area" && Array.isArray(this.areas) && this.areas[0] === x) return undefined;
      return x;
    }));
  assert.deepEqual(plain(round.value), plain(rule), `${what}: …unchanged`);
  assert.deepEqual(recs[0].unread, [], `${what}: nothing unread`);
  return recs[0];
}
{
  const r = record(card("BT7-123", { skill: BT7_123_F30 }), "BT7-123 front#30");
  assert.deepEqual(r.cond, { kind: "playedUsing", sel: { special: "self" }, what: "Union" }, "still gated on a [Union] entry");
  const [reveal, choose, move] = r.ops;
  assert.ok(reveal.op === "reveal" && "side" in reveal.sel && reveal.sel.side === "opponent" && reveal.sel.area === "hand", "the opponent reveals their hand");
  assert.ok(choose.op === "choose" && choose.sel.fromVar === reveal.as && choose.sel.count === 2 && choose.sel.upTo === true && !choose.chooser, "you choose up to 2 of them");
  assert.deepEqual(move, { op: "moveTo", target: { var: choose.as }, to: "energy", mode: "rest", reveal: true }, "to their owner's Energy Area, in Rest Mode");
}
{
  const r = record(card("BT26-088", { colors: ["Green"], skill: BT26_088_F20 }), "BT26-088 front#20");
  const [offer, ifDid] = r.ops;
  assert.equal(r.ops.length, 2);
  if (offer.op !== "may") throw new Error("an offer");
  const [pick, shown, energy, sw] = offer.ops;
  assert.equal(offer.ops.length, 4, "the reveal and the switch are one offer");
  assert.ok(pick.op === "choose" && "side" in pick.sel && pick.sel.area === "hand" && pick.sel.count === 1 && !pick.sel.upTo, "pick 1 card from the hand");
  assert.ok(pick.sel.filter?.monoColor && pick.sel.filter.colors.join() === "Green" && pick.sel.filter.characters.join() === "vegito", "mono-green <Vegito>");
  assert.ok(shown.op === "reveal" && shown.sel.fromVar === pick.as && shown.as === pick.as, "…and reveal it");
  assert.ok(pick.op === "choose" && energy.op === "choose");
  assert.deepEqual(pick.specifiedCostAtMost, { count: energy.sel }, "only a Vegito whose specified cost the Active green energy can pay is offered");
  assert.ok(energy.op === "choose" && "side" in energy.sel && energy.sel.side === "you" && energy.sel.area === "energy" && energy.sel.mode === "active" && energy.sel.filter?.colors.join() === "Green", "your Active Mode green energy");
  assert.deepEqual(energy.exactly, { attr: { var: pick.as }, name: "specifiedCost" }, "exactly that card's specified cost");
  assert.equal(energy.sel.count, undefined, "the selector's count is not the count");
  assert.deepEqual(sw, { op: "switchMode", target: { var: energy.as }, mode: "rest" }, "switched to Rest Mode");
  assert.deepEqual(ifDid, { op: "if", cond: { kind: "did", what: "may" }, then: [{ op: "play", target: { var: pick.as }, onto: { sel: { special: "self" } } }] }, "if you do, play it on top of this card");
}
{
  const r = record(card("BT29-150", { type: "UNISON", skill: BT29_150_F10 }), "BT29-150 front#10");
  assert.deepEqual(r.trigger, ["removedFromUnison"]);
  const step = (side: "you" | "opponent") => {
    const hand = { side, area: "hand" };
    return { op: "if", cond: { kind: "count", sel: hand, atLeast: 8 }, then: [{ op: "discard", n: { plus: [{ count: hand }, -7] }, side, to: "warp" }] };
  };
  assert.deepEqual(r.ops, [{ op: "if", cond: { kind: "isTurnPlayer" }, then: [step("you"), step("opponent")], else: [step("opponent"), step("you")] }], "each player's excess over 7 to the Warp, the turn player first (0-2-8)");
}
// The general switch reader no longer takes "the same number of … as that card's …" for that card.
assert.ok(skillRecords(card("SN", { skill: "[Activate: Main] Reveal 1 card from your hand. Switch the same number of your energy as that card's energy cost to Rest Mode." }))[0].unread.length > 0, "another measure than the specified cost stays unread");

// ── 2. the VM ────────────────────────────────────────────────────────────────
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

function take(s: VmState, action: Action): VmState {
  const out = RULES.apply(ctx, roundtrip(s), action);
  return roundtrip(out.state as VmState);
}
/** The seat's Main Phase, hands and energy emptied back into the decks; the seat's Leader is `leader`. */
function fresh(seat: PlayerId, seed: number, leader: string): VmState {
  const leaders = { p1: seat === "p1" ? leader : "L-BLUE", p2: seat === "p2" ? leader : "L-BLUE" };
  let s = RULES.createGame(ctx, {
    seed,
    p1: { name: "First", leader: leaders.p1, main: fifty("V1") },
    p2: { name: "Second", leader: leaders.p2, main: fifty("V-BLUE") },
  }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false },
    { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null },
    { type: "endMain", player: "p1" },
    { type: "charge", player: "p2", card: null },
    ...(seat === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[])
    s = take(s, action);
  assert.equal(s.turnPlayer, seat);
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string, markers?: number): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy" || area === "unison") s.cards[id].mode = "active";
  if (markers !== undefined) s.cards[id].markers = markers;
  s.pending = [];
  return id;
}
const lineOf = (def: string, pred: (sk: ReturnType<typeof parseSkills>[number]) => boolean) => parseSkills(defs[def].skill!).find(pred)!.index;
const offerOf = (s: VmState, c: string, skill: number) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === skill);
type Prompt = VmState["prompt"];
type CardsPrompt = Extract<Prompt, { kind: "chooseCards" }>;
interface Steer {
  /** Answer a card choice; the first candidates by default. */
  cards?: (q: CardsPrompt, s: VmState) => string[] | undefined;
  /** Answer a "you may" (0 = do it, 1 = don't); 0 by default. */
  mode?: (q: Extract<Prompt, { kind: "chooseMode" }>) => number;
}
/** Answer every question until the turn player is back at the Main Phase; every card question asked, with who was asked. */
function settle(s0: VmState, steer: Steer = {}): { s: VmState; asked: { player: PlayerId; candidates: string[]; reason: string }[] } {
  let s = s0;
  const asked: { player: PlayerId; candidates: string[]; reason: string }[] = [];
  for (let i = 0; i < 60 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: steer.mode?.(q) ?? 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "chooseCards") {
      asked.push({ player: who, candidates: q.choice.candidates.slice(), reason: q.choice.reason });
      s = take(s, { type: "choose", player: who, cards: steer.cards?.(q, s) ?? q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    } else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.equal(s.prompt.kind, "main", `back at the Main Phase (at ${s.prompt.kind})`);
  return { s, asked };
}
const rested = (s: VmState, p: PlayerId, ids?: string[]) => (ids ?? s.sides[p].zones.energy).filter((c) => s.cards[c].mode === "rest").length;

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 9300 + n * 2 + (seat === "p1" ? 0 : 1);

  // ── BT7-123 front#30 ──
  // A successful [Union-Potara] entry: the opponent reveals a hand of three, the seat picks two,
  // and those two go to the OPPONENT's Energy Area in Rest Mode; the third stays in their hand.
  // Then "up to": picking one moves one.
  for (const n of [2, 1]) {
    let s = fresh(seat, seed(n), "L-BY");
    for (let i = 0; i < 4; i++) stage(s, seat, "U-E", "energy");
    for (let i = 0; i < 2; i++) stage(s, seat, "Y-E", "energy");
    stage(s, seat, "BLACK", "battle");
    stage(s, seat, "ZAMASU", "battle");
    const zamasu = stage(s, seat, "BT7123", "hand");
    const hand = [stage(s, foe, "V-BLUE", "hand"), stage(s, foe, "V-BLUE", "hand"), stage(s, foe, "V-BLUE", "hand")];
    const energy0 = s.sides[foe].zones.energy.length;
    const a = offerOf(s, zamasu, lineOf("BT7123", (sk) => sk.keyword?.name === "Union"));
    assert.ok(a, `${seat}: BT7-123's [Union-Potara] is offered`);
    // Picked one card at a time; with one wanted, the second question is declined (5-2-4).
    const picked: string[] = [];
    const r = settle(take(s, a.action), {
      cards: (q) => {
        if (!q.choice.candidates.length || !q.choice.candidates.every((c) => hand.includes(c))) return undefined;
        if (picked.length >= n) return [];
        picked.push(q.choice.candidates[0]);
        return [q.choice.candidates[0]];
      },
    });
    s = r.s;
    assert.ok(s.sides[seat].zones.battle.includes(zamasu), `${seat}: Fused Zamasu entered by [Union-Potara]`);
    const ask = r.asked.find((q) => q.candidates.length === 3 && q.candidates.every((c) => hand.includes(c)));
    assert.ok(ask, "the seat is asked to choose among the revealed hand");
    assert.equal(ask.player, seat, "the seat chooses, not the opponent");
    assert.equal(picked.length, n);
    for (const c of picked) {
      assert.ok(s.sides[foe].zones.energy.includes(c), "the chosen card is in the opponent's Energy Area");
      assert.equal(s.cards[c].mode, "rest", "…in Rest Mode");
    }
    assert.equal(s.sides[foe].zones.energy.length, energy0 + n, `${n} added to their energy`);
    assert.deepEqual(s.sides[foe].zones.hand.slice().sort(), hand.filter((c) => !picked.includes(c)).sort(), "the rest stay in their hand");
    assert.ok(!picked.some((c) => s.sides[seat].zones.energy.includes(c)), "not the seat's energy");
    cases++;
  }

  // ── BT26-088 front#20 ──
  /** BT26-088 in play, its price's Goku and Vegeta beside it, `green` Active green energy (and two red), and these cards in hand. */
  function vegitoBoard(n: number, green: number, inHand: string[]) {
    const s = fresh(seat, seed(n), "L-GRN");
    const greens = Array.from({ length: green }, () => stage(s, seat, "G-E", "energy"));
    stage(s, seat, "R-E", "energy");
    stage(s, seat, "R-E", "energy");
    const host = stage(s, seat, "BT26088", "battle");
    const goku = stage(s, seat, "GOKU", "battle");
    const vegeta = stage(s, seat, "VEGETA", "battle");
    const hand = inHand.map((d) => stage(s, seat, d, "hand"));
    const a = offerOf(s, host, lineOf("BT26088", (sk) => sk.kind.startsWith("activate")));
    assert.ok(a, `${seat}: BT26-088's [Activate: Main] is offered`);
    return { s, a, host, goku, vegeta, hand, greens };
  }
  // (a) Accepted with three Active green energy and a Vegito whose specified cost is 3: the
  // Green/Yellow Vegito is not on offer, three green energy are rested, and the Vegito is played
  // on top of BT26-088 — no energy cost paid for the play (5-5-3), the red energy untouched.
  {
    const b = vegitoBoard(3, 4, ["VEGITO3", "VEGITO-GY"]);
    const [vegito, gy] = b.hand;
    const r = settle(take(b.s, b.a.action));
    const s = r.s;
    // The Vegito is the top of the pile now: BT26-088 and the Son Goku and Vegeta its price placed under it are all beneath.
    assert.deepEqual(s.cards[vegito].under.slice().sort(), [b.host, b.goku, b.vegeta].sort(), "BT26-088 and the price's Son Goku and Vegeta are under the Vegito");
    // A lone candidate is taken without a question; either way the Green/Yellow one is never offered.
    assert.ok(!r.asked.some((q) => q.candidates.includes(gy)), "a Green/Yellow Vegito is not mono-green: never offered");
    assert.ok(r.asked.some((q) => q.candidates.length === 4 && q.candidates.every((c) => b.greens.includes(c))), "the seat chooses which three of its four Active green energy to switch");
    assert.ok(s.sides[seat].zones.battle.includes(vegito), `${seat}: the revealed Vegito is played`);
    assert.ok(s.cards[vegito].under.includes(b.host), "…on top of BT26-088");
    assert.equal(rested(s, seat, b.greens), 3, "exactly its specified cost (3) of green energy switched to Rest Mode");
    assert.equal(rested(s, seat), 3, "nothing else rested: the play costs no energy");
    assert.ok(s.sides[seat].zones.hand.includes(gy), "the other Vegito stays in the hand");
    cases++;
  }
  // (b) Accepted with only two Active green energy and no payable Vegito: the reveal has no
  // candidates — nothing is revealed, switched or played.
  {
    const b = vegitoBoard(4, 2, ["VEGITO3"]);
    const [vegito] = b.hand;
    const r = settle(take(b.s, b.a.action));
    const s = r.s;
    assert.ok(!r.asked.some((q) => q.candidates.includes(vegito)), `${seat}: a Vegito with specified cost 3 is not offered over two green energy`);
    assert.ok(s.sides[seat].zones.hand.includes(vegito), `${seat}: too little green energy: the Vegito stays in the hand`);
    assert.equal(rested(s, seat), 0, "and no energy was switched");
    assert.ok(s.sides[seat].zones.battle.includes(b.host), "BT26-088 is still in play");
    cases++;
  }
  // (b2) A payable and an unpayable mono-green Vegito in hand over two Active green energy: only
  // the payable one (specified cost 2) is offered, and it is the one played; the other stays.
  {
    const b = vegitoBoard(8, 2, ["VEGITO3", "VEGITO2"]);
    const [three, two] = b.hand;
    const r = settle(take(b.s, b.a.action));
    const s = r.s;
    assert.ok(!r.asked.some((q) => q.candidates.includes(three)), `${seat}: the unpayable Vegito (specified cost 3) is never offered`);
    assert.ok(s.sides[seat].zones.battle.includes(two), `${seat}: the payable Vegito (specified cost 2) is played`);
    assert.ok(s.cards[two].under.includes(b.host), "…on top of BT26-088");
    assert.equal(rested(s, seat, b.greens), 2, "both green energy switched to Rest Mode");
    assert.ok(s.sides[seat].zones.hand.includes(three), "the unpayable Vegito stays in the hand");
    cases++;
  }
  // (b3) With three Active green energy both are payable: both are offered.
  {
    const b = vegitoBoard(9, 3, ["VEGITO3", "VEGITO2"]);
    const [three, two] = b.hand;
    const r = settle(take(b.s, b.a.action), { cards: (q) => (q.choice.candidates.includes(three) ? [three] : undefined) });
    assert.ok(r.asked.some((q) => q.candidates.includes(three) && q.candidates.includes(two)), `${seat}: both payable Vegitos are offered`);
    assert.ok(r.s.sides[seat].zones.battle.includes(three), "the one chosen is played");
    assert.equal(rested(r.s, seat, b.greens), 3, "its specified cost (3) switched");
    cases++;
  }
  // (c) Declined: nothing switched, nothing played.
  {
    const b = vegitoBoard(5, 4, ["VEGITO3"]);
    const [vegito] = b.hand;
    const s = settle(take(b.s, b.a.action), { mode: (q) => (q.options.length === 2 ? 1 : 0) }).s;
    assert.ok(s.sides[seat].zones.hand.includes(vegito), `${seat}: declined: the Vegito stays in the hand`);
    assert.equal(rested(s, seat), 0, "nothing switched");
    cases++;
  }

  // ── BT29-150 front#10 ──
  // Removed from the Unison Area by its last marker: each player above 7 sends the excess to their
  // own Warp, choosing the cards themselves; a hand of 7 or fewer is left alone.
  for (const [n, mine, theirs] of [[6, 9, 8], [7, 5, 10]] as const) {
    let s = fresh(seat, seed(n), "L-BLUE");
    const uni = stage(s, seat, "BT29150", "unison", 1);
    for (let i = 0; i < mine; i++) stage(s, seat, "V1", "hand");
    for (let i = 0; i < theirs; i++) stage(s, foe, "V-BLUE", "hand");
    const warp0 = { [seat]: s.sides[seat].zones.warp.length, [foe]: s.sides[foe].zones.warp.length };
    const a = offerOf(s, uni, lineOf("BT29150", (sk) => sk.kind.startsWith("activate")));
    assert.ok(a, `${seat}: the [-1] line is offered`);
    // The [-1] line draws 1 first: the seat's hand is one larger when the [Auto] resolves.
    const r = settle(take(s, a.action));
    s = r.s;
    assert.ok(s.sides[seat].zones.drop.includes(uni), "zero markers: the Unison left for the Drop (21-9-2)");
    const mineAtAuto = mine + 1;
    for (const [p, had] of [[seat, mineAtAuto], [foe, theirs]] as const) {
      const sent = Math.max(0, had - 7);
      assert.equal(s.sides[p].zones.hand.length, Math.min(had, 7), `${p}: the hand is down to 7 (or untouched below it)`);
      assert.equal(s.sides[p].zones.warp.length - warp0[p], sent, `${p}: the excess (${sent}) went to their own Warp`);
      const ask = r.asked.filter((q) => q.player === p && q.candidates.every((c) => s.cards[c] && (s.sides[p].zones.hand.includes(c) || s.sides[p].zones.warp.includes(c))));
      if (sent) assert.ok(ask.length > 0, `${p} chose the cards from their own hand`);
      else assert.equal(ask.length, 0, `${p} was not asked`);
    }
    // Both over 7: the turn player (here the seat, who controls the skill) chooses first (0-2-8).
    const hands = r.asked.filter((q) => q.candidates.length > 0 && q.candidates.every((c) => s.sides[q.player].zones.hand.includes(c) || s.sides[q.player].zones.warp.includes(c)));
    if (mine + 1 > 7 && theirs > 7) assert.equal(hands[0]?.player, seat, "the turn player chooses first");
    cases++;
  }
  // Removed on the OPPONENT's turn by their skill: BT29-150's controller is not the turn player,
  // and the turn player (the opponent) still sends their excess first (0-2-8), then the seat.
  {
    let s = fresh(foe, seed(10), "L-BLUE");
    assert.equal(s.turnPlayer, foe);
    const uni = stage(s, seat, "BT29150", "unison", 3);
    stage(s, foe, "V-BLUE", "energy");
    const kick = stage(s, foe, "KICK", "battle");
    for (let i = 0; i < 9; i++) stage(s, seat, "V1", "hand");
    for (let i = 0; i < 10; i++) stage(s, foe, "V-BLUE", "hand");
    const warp0 = { [seat]: s.sides[seat].zones.warp.length, [foe]: s.sides[foe].zones.warp.length };
    const a = offerOf(s, kick, lineOf("KICK", (sk) => sk.kind.startsWith("activate")));
    assert.ok(a, `${foe}: the opponent's line is offered`);
    const r = settle(take(s, a.action));
    s = r.s;
    assert.ok(s.sides[seat].zones.drop.includes(uni), "the opponent's skill sent BT29-150 to the Drop");
    for (const [p, had] of [[seat, 9], [foe, 10]] as const) {
      assert.equal(s.sides[p].zones.hand.length, 7, `${p}: the hand is down to 7`);
      assert.equal(s.sides[p].zones.warp.length - warp0[p], had - 7, `${p}: the excess went to their own Warp`);
    }
    const hands = r.asked.filter((q) => q.candidates.length > 0 && q.candidates.every((c) => s.sides[q.player].zones.hand.includes(c) || s.sides[q.player].zones.warp.includes(c)));
    assert.ok(hands.some((q) => q.player === seat) && hands.some((q) => q.player === foe), "both players chose from their own hands");
    assert.equal(hands[0].player, foe, `${seat}'s BT29-150 on ${foe}'s turn: the turn player (${foe}) chooses first`);
    const firstSeat = hands.findIndex((q) => q.player === seat);
    assert.ok(hands.slice(0, firstSeat).every((q) => q.player === foe), "the turn player's cards are all chosen before the other player's");
    cases++;
  }
}

console.log(`union-leftovers-930: BT7-123 front#30 (to their energy), BT26-088 front#20 (only a payable Vegito, played on top), BT29-150 front#10 (hands down to 7, the turn player first) — records and ${cases} both-seat reload cases`);
