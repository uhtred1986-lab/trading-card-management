/**
 * #970: multi-card named send/place prices with disjoint choices. Printed text
 * (Bandai card list, 17 Oct 2026) -> compile -> stored-row JSON round-trip ->
 * the real VM:
 *
 *   - BT10-025/026 "send 1 <Pilaf> card, 1 <Mai> card, and 1 <Shu> card from
 *     your Drop Area to your Warp": offered only when a *disjoint* assignment
 *     exists — one card carrying all the names cannot pay two slots, three
 *     single-name cards can, and the multi-name card can fill either slot;
 *   - the cost moves exactly the cards chosen; a forged duplicate is refused;
 *   - P-441 (hand and/or Drop, colour + name slots), BT19-004 (Z-Energy),
 *     P-286 ("place … in your Drop Area from your Warp");
 *   - the language round trip (`EXCEPT $c0`), schema validation, both seats.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { disjointAssignment, disjointGroups } from "../../src/lib/arena/vm/disjoint";
import { programProblem } from "../../src/lib/arena/vm/script-schema";
import { deepEqual, parseRule, printOps } from "../../src/lib/arena/lang";
import type { Op } from "../../src/lib/arena/vm/script";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const one = (text: string) => parseSkills(text)[0]!;
const unread = (text: string) => compileSkill(one(text)).unsupported.length > 0;

// ── printed text (Bandai card list, 17 Oct 2026) ─────────────────────────────
const BT10_025 = "[activate: main]{r}{r}{r}, send 1 <Pilaf> card, 1 <Mai> card, and 1 <Shu> card from your Drop Area to your Warp: Play this card from your hand.";
const BT10_026 = "[activate: main]{r}{r}, send 1 <Pilaf> card and 1 <Shu> card from your Drop Area to your Warp: Play this card from your hand.";
const BT12_138 = "[activate: main]{2}, if your Leader Card is a black ≪Saiyan≫ card and you send 1 <Son Gohan: Xeno> card and 1 <Trunks: Xeno> card from your Drop Area to your Warp: Play this card from your hand.";
const P_287 = "[activate: main] Send 1 <Son Gohan: Xeno> card and 1 <Trunks: Xeno> card from your Drop Area to your Warp: Play this card from your hand.";
const EB1_38B = "[Activate: Battle][Once per turn] Send 1 <Android 14> and 1 <Android 15> card from your Drop Area to your Warp: Choose 1 of your Leader Cards or ≪Android≫ cards and it gets +5000 power for the battle.";
const P_441 = "[activate: main]{u}, if your Leader is blue, has <Gotenks> in its character name, and you send 1 blue card with <Son Goten> in its character name and 1 blue card with <Trunks> in its character name from your hand and/or Drop to your Warp: Play this card from your hand.";
const BT18_041 = "[activate: main]{u}{u}, place 1 <Frieza> card and 1 <Cell> card from your energy in their owners' Drops: Play this card from your hand, then place up to 2 cards from the top of your deck in your energy in Rest Mode.";
const BT19_004 = "[activate: battle][once per turn] Place 1 <Android 13> card, 1 <Android 14> card, and 1 <Android 15> card from your Z-Energy in their owners' Drops: Draw 1 card, and this card gets +5000 power and [double strike] for the turn.";
const P_286 = "[activate: main][once per turn] Place 1 <Son Goku: Xeno> card with 5000 power and 1 <Vegeta: Xeno> card with 5000 power in your Drop Area from your Warp: Switch this card to Active Mode.";
const SD16_03 = "[activate: main][limit 1] (You can only activate this skill once per turn across all copies of this card.) [spirit boost 1] (You must remove a marker from your Unison Card to activate this skill.) {1}, if you have 3 or more energy and you send 1 red card, 1 blue card, 1 green card, and 1 yellow card from your Drop Area to your Warp: Play this card from your Drop Area or Warp, and it gains [critical] for the turn.";

// ── the reading ──────────────────────────────────────────────────────────────
type ChooseOp = Extract<Op, { op: "choose" }>;
const priceOf = (text: string): Op[] => {
  const rec = skillRecords({ ...DEFS["L-RED"], id: "X", skill: text }).find((r) => r.kind.startsWith("activate"))!;
  assert.deepEqual(rec.unread, [], text.slice(0, 50));
  return (rec.cost as unknown as { program: Op[] }).program;
};
{
  const p = priceOf(BT10_025);
  assert.deepEqual(p.map((o) => o.op), ["choose", "choose", "choose", "moveTo", "moveTo", "moveTo"], "three slots, then the moves");
  const slots = p.slice(0, 3) as ChooseOp[];
  assert.deepEqual(slots.map((s) => s.sel.filter!.characters), [["pilaf"], ["mai"], ["shu"]]);
  assert.equal(slots[0].sel.notIn, undefined);
  assert.deepEqual(slots[1].sel.notIn, [slots[0].as]);
  assert.deepEqual(slots[2].sel.notIn, [slots[0].as, slots[1].as]);
  assert.ok(slots.every((s) => s.sel.area === "drop" && s.sel.count === 1 && !s.sel.upTo));
  assert.deepEqual(disjointGroups(p), [[0, 1, 2]]);
  // Stored-row JSON, schema validation and the language round trip.
  const stored = roundtrip(p);
  assert.equal(programProblem(stored), null, "the stored program validates");
  const text = `WHEN [activate:main]\nTHEN\n${printOps(stored, 1)}`;
  assert.match(text, /EXCEPT \$c\d+ \$c\d+/);
  const back = parseRule(text);
  assert.ok(back.ok, back.ok ? "" : JSON.stringify(back));
  assert.ok(back.ok && deepEqual(back.value.ops, stored), "print -> parse gives the same program");
  // Old programs stay valid; a bad `notIn` is refused by name.
  assert.equal(programProblem([{ op: "choose", sel: { side: "you", area: "drop", count: 1 }, as: "a" }]), null);
  assert.match(programProblem([{ op: "choose", sel: { side: "you", area: "drop", count: 1, notIn: ["ghost"] }, as: "a" }]) ?? "", /no earlier choose/);
  assert.match(programProblem([{ op: "choose", sel: { side: "you", area: "drop", count: 1, notIn: [] }, as: "a" }]) ?? "", /notIn/);
  assert.match(programProblem([{ op: "choose", sel: { side: "you", area: "drop", count: 1 }, as: "a" }, { op: "moveTo", target: { sel: { side: "you", area: "drop", count: 1, notIn: ["a"] } }, to: "warp" }]) ?? "", /only a choose/);
}
for (const [name, text] of [["BT10-026", BT10_026], ["BT12-138", BT12_138], ["P-287", P_287], ["EB1-38b", EB1_38B], ["P-441", P_441], ["BT18-041", BT18_041], ["BT19-004", BT19_004], ["P-286", P_286], ["SD16-03", SD16_03]] as const) {
  const p = priceOf(text);
  const slots = p.filter((o): o is ChooseOp => o.op === "choose");
  assert.ok(slots.length >= 2 && slots.every((s, i) => (i === 0 ? !s.sel.notIn : s.sel.notIn!.length === i)), `${name}: every slot after the first excludes the ones before`);
  assert.equal(programProblem(roundtrip(p)), null, name);
}
assert.equal((priceOf(SD16_03).filter((o) => o.op === "choose") as ChooseOp[]).length, 4, "SD16-03: a card per colour");
assert.deepEqual((priceOf(BT19_004).filter((o) => o.op === "choose") as ChooseOp[]).map((s) => s.sel.area), ["zEnergy", "zEnergy", "zEnergy"]);
assert.deepEqual((priceOf(P_441).filter((o) => o.op === "choose") as ChooseOp[]).map((s) => s.sel.areas), [["hand", "drop"], ["hand", "drop"]]);
assert.ok(priceOf(BT18_041).every((o) => o.op !== "moveTo" || (o.to === "drop" && o.reveal === true)), "place goes to the Drop face up");

// What stays unread.
assert.ok(unread("[Activate: Main]{r}, send up to 1 <Pilaf> card and 1 <Shu> card from your Drop Area to your Warp: Play this card from your hand."), "an 'up to' slot is not read");
assert.ok(unread("[Activate: Main]{r}, send this card and 1 <Goku Black> card from your Combo Area to their owners' Warps: Draw 1 card."), "'this card' is not a slot");
assert.ok(unread("[Activate: Main]{r}, send 1 <Pilaf> card, 1 <Koitsukai> card—all red—from your Drop to your Warp: Draw 1 card."), "a dash qualifier is not read");
assert.ok(unread("[Activate: Main]{u}{u}{u}, if your Leader Card is a blue <Paikuhan> card and you place 1 blue <Son Goku> card and 1 blue <Vegeta> card with energy costs of 1 from your deck in your Drop Area and shuffle your deck: Play this card from your hand."), "a qualifier only the last slot says (BT12-039) is not guessed");
assert.ok(unread("[Activate: Battle][Once per turn] If it's your turn, you have a <Gogeta> or <Veku> card―both with the [aegis] skill―in play, and you send 1 blue card and 1 yellow card from your Drop to your Warp: Draw 1 card."), "BT22-033's half-read condition stays unread");
assert.ok(unread("[Auto] When this card is played, you may send 1 <Pilaf> card and 1 <Shu> card from your Drop Area to your Warp: Draw 1 card."), "an optional two-slot send is not read");
assert.ok(unread("[Auto] If you send 1 <Pilaf> card and 1 <Shu> card from your Drop Area to your Warp: When this card is played, draw 1 card."), "an [Auto] price is not charged by the disjoint planner");

// The matching itself.
assert.equal(disjointAssignment([{ cands: ["m"], need: 1 }, { cands: ["m"], need: 1 }]), false, "one card, two slots");
assert.equal(disjointAssignment([{ cands: ["m", "p"], need: 1 }, { cands: ["m"], need: 1 }]), true, "m must go to the second slot: not greedy");
assert.equal(disjointAssignment([{ cands: ["a", "b"], need: 2 }, { cands: ["a"], need: 1 }]), false);
assert.equal(disjointAssignment([{ cands: ["a", "b", "c"], need: 2 }, { cands: ["a"], need: 1 }]), true);

// ── the VM ───────────────────────────────────────────────────────────────────
const lead = (id: string, extra: Partial<CardDef>) => card(id, { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, power: 10000, skill: null, ...extra });
const piece = (id: string, characters: string[], extra: Partial<CardDef> = {}) => card(id, { colors: ["Red"], energyCost: 1, power: 5000, skill: null, characters, ...extra });
const hand = (id: string, skill: string, extra: Partial<CardDef> = {}) => card(id, { colors: ["Red"], energyCost: 3, power: 15000, comboCost: 0, comboPower: 5000, skill, ...extra });
const defs: Record<string, CardDef> = {
  ...DEFS,
  P2S: hand("P2S", BT10_026),
  P3S: hand("P3S", BT10_025),
  G441: hand("G441", P_441, { colors: ["Blue"], characters: ["Gotenks"] }),
  "L970-GOTENKS": lead("L970-GOTENKS", { colors: ["Blue"], characters: ["Gotenks"] }),
  PILAF: piece("PILAF", ["Pilaf"]),
  PILAF2: piece("PILAF2", ["Pilaf"]),
  SHU: piece("SHU", ["Shu"]),
  SHU2: piece("SHU2", ["Shu"]),
  MAI: piece("MAI", ["Mai"]),
  MULTI: piece("MULTI", ["Pilaf", "Shu", "Mai"]),
  PS: piece("PS", ["Pilaf", "Shu"]),
  GOTEN: piece("GOTEN", ["Son Goten"], { colors: ["Blue"] }),
  TRUNKS: piece("TRUNKS", ["Trunks"], { colors: ["Blue"] }),
  GT: piece("GT", ["Son Goten", "Trunks"], { colors: ["Blue"] }),
  RED970: piece("RED970", ["Filler"]),
  BLU970: piece("BLU970", ["Filler"], { colors: ["Blue"] }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "confirmed" } as unknown as RuleRow)));
const stored = roundtrip(rows);
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(stored, defs) };
const game = (() => {
  const loaded = rulesetFor("dbs");
  assert.ok(loaded.ok);
  return loaded.definition;
})();

function take(s: VmState, action: Action): VmState {
  return RULES.apply(ctx, roundtrip(s), action).state as VmState;
}
/** A game at `seat`'s first Main Phase, `seat` having the leader `leader`. */
function main(seat: PlayerId, leader: string): VmState {
  const other: PlayerId = seat === "p1" ? "p2" : "p1";
  const decks = { [seat]: { name: "You", leader, main: fifty("V1") }, [other]: { name: "Other", leader: "L-RED", main: fifty("V-BLUE") } } as Record<PlayerId, { name: string; leader: string; main: string[] }>;
  let s = RULES.createGame(ctx, { seed: 970, p1: decks.p1, p2: decks.p2 }).state as VmState;
  s = take(s, { type: "chooseFirst", player: s.chooser, first: seat });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = take(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  assert.equal(s.prompt.kind, "main");
  assert.equal(s.turnPlayer, seat);
  return s;
}
function stage(s: VmState, def: string, area: string, side: PlayerId, mode: "active" | "rest" = "active"): string {
  const id = s.sides[side].zones.deck[0];
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: side }).ok, `${def} into ${area}`);
  if (area === "energy" || area === "battle") s.cards[id].mode = mode;
  return id;
}
function clear(s: VmState, side: PlayerId): void {
  for (const area of ["hand", "energy", "drop"]) for (const id of s.sides[side].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: side, position: "bottom" }).ok);
}
const zone = (s: VmState, area: string, side: PlayerId) => s.sides[side].zones[area];
const activates = (s: VmState, id: string) => RULES.legalActions(ctx, s).filter((l) => l.action.type === "activate" && (l.action as { card?: string }).card === id);
const chooses = (s: VmState) => RULES.legalActions(ctx, s).filter((l) => l.action.type === "choose");

interface Board { s: VmState; id: string; drop: Record<string, string> }
/** `def` in hand with `energy` red energy and the named pieces in the Drop (keyed by `name#n`). */
function board(seat: PlayerId, def: string, pieces: string[], energy: number, leader = "L-RED"): Board {
  const s = main(seat, leader);
  clear(s, seat);
  const id = stage(s, def, "hand", seat);
  for (let i = 0; i < energy; i++) stage(s, "RED970", "energy", seat);
  const drop: Record<string, string> = {};
  pieces.forEach((p, i) => (drop[`${p}@${i}`] = stage(s, p, "drop", seat)));
  return { s, id, drop };
}
/** Runs the activation, answering each pending choice with `pick(candidates)`. */
function run(b: Board, seat: PlayerId, pick: (cands: string[]) => string): VmState {
  const rows = activates(b.s, b.id);
  assert.equal(rows.length, 1, "offered");
  let t = take(b.s, rows[0].action);
  for (let i = 0; i < 8 && t.prompt.kind === "chooseCards"; i++) {
    const legal = chooses(t);
    const cands = legal.map((l) => (l.action as unknown as { cards: string[] }).cards[0]);
    const chosen = pick(cands);
    t = take(t, legal[cands.indexOf(chosen)].action);
  }
  assert.notEqual(t.prompt.kind, "chooseCards", `the price finished (seat ${seat})`);
  return t;
}

for (const seat of ["p1", "p2"] as PlayerId[]) {
  const tag = `seat ${seat}`;
  // BT10-026 (Pilaf + Shu): who can pay?
  const cases: [string, string[], boolean][] = [
    ["one multi-name card alone cannot pay two slots", ["MULTI"], false],
    ["one card named Pilaf and Shu alone", ["PS"], false],
    ["two Pilaf cards and no Shu", ["PILAF", "PILAF2"], false],
    ["a Pilaf and a Shu", ["PILAF", "SHU"], true],
    ["the multi-name card with a Pilaf (it fills Shu)", ["MULTI", "PILAF"], true],
    ["the multi-name card with a Shu (it fills Pilaf)", ["MULTI", "SHU"], true],
    ["two multi-name cards", ["MULTI", "PS"], true],
  ];
  for (const [name, pieces, offered] of cases) {
    const b = board(seat, "P2S", pieces, 2);
    assert.equal(activates(b.s, b.id).length > 0, offered, `${tag}, BT10-026: ${name}`);
  }
  // Three single-name cards pay BT10-025; the multi-name card alone does not; two of three names do not.
  {
    const b = board(seat, "P3S", ["PILAF", "MAI", "SHU"], 3);
    assert.equal(activates(b.s, b.id).length, 1, `${tag}, BT10-025: three single-name cards pay`);
    const done = run(b, seat, (c) => c[0]);
    for (const k of Object.keys(b.drop)) assert.ok(zone(done, "warp", seat).includes(b.drop[k]), `${tag}: ${k} was sent to the Warp`);
    assert.ok(zone(done, "battle", seat).includes(b.id), `${tag}: and the card was played`);
  }
  for (const pieces of [["MULTI"], ["PILAF", "SHU"], ["MULTI", "PILAF"], ["PS", "PILAF"]]) {
    const b = board(seat, "P3S", pieces, 3);
    assert.equal(activates(b.s, b.id).length, 0, `${tag}, BT10-025 with ${pieces.join("+")}: three names need three cards`);
  }
  {
    // Not greedy: MULTI+PILAF+MAI pays Pilaf/Mai/Shu only as PILAF, MAI, MULTI(Shu).
    const b = board(seat, "P3S", ["MULTI", "PILAF", "MAI"], 3);
    assert.equal(activates(b.s, b.id).length, 1, `${tag}: the multi-name card is kept for the slot only it can fill`);
    // Every pick offered along the way leaves the price payable: the first slot never offers MULTI.
    let t = take(b.s, activates(b.s, b.id)[0].action);
    // Forced picks are taken silently; whatever is asked is a legal way out.
    for (let i = 0; i < 6 && t.prompt.kind === "chooseCards"; i++) {
      const legal = chooses(t);
      const cands = legal.map((l) => (l.action as unknown as { cards: string[] }).cards[0]);
      assert.ok(!cands.includes(b.drop["MULTI@0"]), `${tag}: the Pilaf slot does not offer the card the Shu slot needs`);
      t = take(t, legal[0].action);
    }
    for (const k of Object.keys(b.drop)) assert.ok(zone(t, "warp", seat).includes(b.drop[k]), `${tag}: ${k} in the Warp`);
  }
  {
    // The multi-name card can fill either slot: with a spare Pilaf and a spare Shu, both orders are offered.
    const b = board(seat, "P2S", ["MULTI", "PILAF", "SHU", "SHU2"], 2);
    const rows = activates(b.s, b.id);
    assert.equal(rows.length, 1);
    let t = take(b.s, rows[0].action);
    assert.equal(t.prompt.kind, "chooseCards", "a real choice is asked");
    const first = chooses(t).map((l) => (l.action as unknown as { cards: string[] }).cards[0]);
    assert.deepEqual([...first].sort(), [b.drop["MULTI@0"], b.drop["PILAF@1"]].sort(), `${tag}: the Pilaf slot offers the multi-name card and the Pilaf`);
    // Take MULTI for the Pilaf slot -> the Shu slot offers the Shu cards, never MULTI again.
    t = take(t, chooses(t)[first.indexOf(b.drop["MULTI@0"])].action);
    assert.equal(t.prompt.kind, "chooseCards");
    const second = chooses(t).map((l) => (l.action as unknown as { cards: string[] }).cards[0]);
    assert.deepEqual([...second].sort(), [b.drop["SHU@2"], b.drop["SHU2@3"]].sort(), `${tag}: the Shu slot does not offer the card already chosen`);
    // A forged duplicate is refused.
    const forged = { ...chooses(t)[0].action, cards: [b.drop["MULTI@0"]] } as Action;
    assert.throws(() => RULES.apply(ctx, roundtrip(t), forged), `${tag}: choosing the same card for the second slot is refused`);
    const reloaded = roundtrip(t);
    t = take(reloaded, chooses(reloaded)[0].action);
    // The price moved exactly the two chosen cards.
    assert.deepEqual([...zone(t, "warp", seat)].filter((x) => Object.values(b.drop).includes(x)).sort(), [b.drop["MULTI@0"], b.drop["SHU@2"]].sort(), `${tag}: exactly those cards moved`);
    assert.deepEqual([...zone(t, "drop", seat)].filter((x) => Object.values(b.drop).includes(x)).sort(), [b.drop["PILAF@1"], b.drop["SHU2@3"]].sort(), `${tag}: the rest stayed in the Drop`);
    assert.ok(zone(t, "battle", seat).includes(b.id), `${tag}: the card was played`);
  }
  // P-441: hand and/or Drop, colour + name slots. A card with both names pays one slot, not both.
  const gotenks = (hands: string[], drop: string[]) => {
    const s = main(seat, "L970-GOTENKS");
    clear(s, seat);
    const id = stage(s, "G441", "hand", seat);
    stage(s, "BLU970", "energy", seat);
    const ids = [...hands.map((d) => stage(s, d, "hand", seat)), ...drop.map((d) => stage(s, d, "drop", seat))];
    return { s, id, ids };
  };
  for (const [name, h, d, offered] of [
    ["Goten + Trunks across hand and Drop", ["GOTEN"], ["TRUNKS"], true],
    ["a card named both, alone", [], ["GT"], false],
    ["a card named both and a Goten (the multi card is Trunks)", ["GOTEN"], ["GT"], true],
    ["Goten only", ["GOTEN"], [], false],
  ] as [string, string[], string[], boolean][]) {
    const g = gotenks(h, d);
    assert.equal(activates(g.s, g.id).length > 0, offered, `${tag}, P-441: ${name}`);
  }
}

console.log("  #970: multi-slot send/place prices read generically; offered only when a disjoint assignment exists, cost moves exactly the chosen cards, duplicates refused");
