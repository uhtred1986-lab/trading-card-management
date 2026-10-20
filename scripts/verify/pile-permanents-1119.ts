/**
 * #1119: a [Permanent] printed on a card UNDER another card is applied, when (and only when) its
 * record asks for the card to be under one. Permanents were read from cards in zones alone, and a pile
 * is no zone (23-2), so the two cards below never granted their [Barrier]:
 *
 *  - BT3-050 f20  "[Permanent] When this card is under a card, the <Majin Buu> on top of this card gains [Barrier]."
 *  - BT31-130 f10 "[Permanent] If your Leader is a white <Cell> card and this card is under a white <Cell> card, the card on top of this card gains [Barrier]."
 *    (the printed line as quoted in the 20 Oct 2026 review receipt, batch 5; its Blocker and Auto lines are not under test)
 *
 * The condition is read from the compiled record (a count of the `onTop` selector), never from a name:
 * an ordinary [Permanent] on a buried card, with no such condition, must change nothing.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { hasKeyword } from "../../src/lib/arena/vm/program";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const BT3_050 = "[permanent] When this card is under a card, the <Majin Buu> on top of this card gains [barrier].";
const BT31_130_F10 = "[permanent] If your Leader is a white <Cell> card and this card is under a white <Cell> card, the card on top of this card gains [Barrier].";
// An ordinary [Permanent] with no under-condition that reaches cards other than the one above it.
const ORDINARY = "[permanent] Your Battle Cards gain [Barrier].";

const defs: Record<string, CardDef> = { ...DEFS,
  "BT3050": card("BT3050", { colors: ["Blue"], characters: ["Majin Buu"], energyCost: 3, power: 20000, skill: BT3_050 }),
  "BT31130": card("BT31130", { colors: ["White"], characters: ["Cell"], energyCost: 3, power: 10000, skill: BT31_130_F10 }),
  "ORD": card("ORD", { colors: ["Blue"], characters: ["Filler"], energyCost: 1, power: 10000, skill: ORDINARY }),
  // The stored production row of BT3-050 f20: the same text, but the record is a bare grant to `onTop` with no condition (set below).
  "BT3050S": card("BT3050S", { colors: ["Blue"], characters: ["Majin Buu"], energyCost: 3, power: 20000, skill: BT3_050 }),
  "BUU": card("BUU", { colors: ["Blue"], characters: ["Majin Buu"], energyCost: 5, power: 25000, skill: null }),
  "NOBUU": card("NOBUU", { colors: ["Blue"], characters: ["Filler"], energyCost: 5, power: 25000, skill: null }),
  "WCELL": card("WCELL", { colors: ["White"], characters: ["Cell"], energyCost: 5, power: 25000, skill: null }),
  "RCELL": card("RCELL", { colors: ["Red"], characters: ["Cell"], energyCost: 5, power: 25000, skill: null }),
  "WOTHER": card("WOTHER", { colors: ["White"], characters: ["Filler"], energyCost: 5, power: 25000, skill: null }),
  "L-WCELL": card("L-WCELL", { type: "LEADER", colors: ["White"], characters: ["Cell"], power: 0, energyCost: 0, skill: null }),
};

const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => {
  // Stored as it is in production: [{"op":"grant","until":"game","target":{"sel":{"filter":{<Majin Buu>},"special":"onTop"}},"keyword":{"name":"Barrier"}}], no `if`, no `cond`.
  const stored = d.id === "BT3050S" ? { cond: null, ops: roundtrip(skillRecords(defs.BT3050)[0].ops) } : {};
  return { ...r, ...stored, id, source: "compiler", status: "draft" } as unknown as RuleRow;
}));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;

// The record says it in the data: "under a card" is a count of the `onTop` selector.
for (const id of ["BT3050", "BT31130"]) {
  const rec = skillRecords(defs[id])[0];
  assert.deepEqual(rec.unread, [], `${id}: nothing unread`);
  assert.match(JSON.stringify(rec.ops), /"special":"onTop"/, `${id}: the record names the card on top`);
}
{
  const stored = rows.find((r) => (r as unknown as { cardId: string }).cardId === "BT3050S") as unknown as { cond: unknown; ops: { op: string; target: { sel: { special: string } } }[] };
  assert.equal(stored.cond, null, "the stored shape has no condition");
  assert.deepEqual(stored.ops.map((o) => [o.op, o.target.sel.special]), [["grant", "onTop"]], "and is a bare grant to onTop");
}
assert.match(skillRecords(defs.BT3050)[0].reads, /on top of this card/, "BT3-050 f20 reads as a condition on the card on top");

function take(s: VmState, action: Action): VmState {
  return roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
}
function fresh(seat: PlayerId, leader: string, seed = 1119): VmState {
  const leaders = { p1: seat === "p1" ? leader : "L-BLUE", p2: seat === "p2" ? leader : "L-BLUE" };
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader: leaders.p1, main: fifty("V1") }, p2: { name: "Second", leader: leaders.p2, main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(seat === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action);
  return s;
}
/** Take a card from the deck, make it `def` and put it in `area`. */
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); return id;
}
/** Stage `top` in the Battle Area with `under` in its pile. */
function stack(s: VmState, p: PlayerId, top: string, under: string): { top: string; under: string } {
  const t = stage(s, p, top, "battle");
  const u = stage(s, p, under, "deck");
  assert.ok(moveCard(s, game, u, "under", { owner: p, under: t }).ok);
  assert.deepEqual(s.cards[t].under.includes(u), true, "the card is in the pile");
  return { top: t, under: u };
}
const barrier = (s: VmState, id: string) => hasKeyword(ctx, game, s, id, "Barrier");

for (const seat of ["p1", "p2"] as const) {
  const foe: PlayerId = seat === "p1" ? "p2" : "p1";

  // ── BT3-050 f20 ──
  {
    const s = fresh(seat, "L-RED");
    const buu = stack(s, seat, "BUU", "BT3050");
    assert.equal(barrier(s, buu.top), true, `${seat}: BT3-050 under a <Majin Buu> gives it [Barrier]`);
    const notBuu = stack(s, seat, "NOBUU", "BT3050");
    assert.equal(barrier(s, notBuu.top), false, `${seat}: under a card that is not a <Majin Buu>, no [Barrier]`);
    assert.equal(barrier(s, buu.top), true, "…and the first stack is unchanged");
    const loose = stage(s, seat, "BT3050", "battle");
    assert.equal(barrier(s, loose), false, "BT3-050 in the Battle Area grants itself nothing");
    const bare = stage(s, seat, "BUU", "battle");
    assert.equal(barrier(s, bare), false, "a <Majin Buu> with no pile has no [Barrier]");
    // The opponent's cards are not touched by a pile of mine.
    const theirs = stage(s, foe, "BUU", "battle");
    assert.equal(barrier(s, theirs), false, "the other player's <Majin Buu> is not granted [Barrier]");
    // A reload from the stored state changes nothing (the grant is read, never stored).
    assert.equal(barrier(roundtrip(s), buu.top), true, "the grant survives a reload");
    // The card is read from the pile only: take it out and the grant goes.
    const gone = roundtrip(s);
    gone.cards[buu.top].under = gone.cards[buu.top].under.filter((c) => c !== buu.under);
    assert.equal(barrier(gone, buu.top), false, "with BT3-050 out of the pile, the [Barrier] is gone");
  }

  // ── BT3-050 f20 as stored: a bare grant to the card on top ──
  {
    const s = fresh(seat, "L-RED", 11303);
    const buu = stack(s, seat, "BUU", "BT3050S");
    assert.equal(barrier(s, buu.top), true, `${seat}: stored BT3-050 under a <Majin Buu> gives it [Barrier]`);
    const notBuu = stack(s, seat, "NOBUU", "BT3050S");
    assert.equal(barrier(s, notBuu.top), false, "under a card that is not a <Majin Buu>: none");
    const loose = stage(s, seat, "BT3050S", "battle");
    assert.equal(barrier(s, loose), false, "in the Battle Area: nothing is on top of it, no effect");
  }

  // ── BT31-130 f10 ──
  {
    const white = fresh(seat, "L-WCELL", 11300);
    const ok = stack(white, seat, "WCELL", "BT31130");
    assert.equal(barrier(white, ok.top), true, `${seat}: BT31-130 under a white <Cell> with a white <Cell> Leader gives it [Barrier]`);
    const red = stack(white, seat, "RCELL", "BT31130");
    assert.equal(barrier(white, red.top), false, "under a red <Cell>: no [Barrier]");
    const other = stack(white, seat, "WOTHER", "BT31130");
    assert.equal(barrier(white, other.top), false, "under a white card that is no <Cell>: no [Barrier]");
    const loose = stage(white, seat, "BT31130", "battle");
    assert.equal(barrier(white, loose), false, "BT31-130 in the Battle Area grants nothing");

    const noLeader = fresh(seat, "L-RED", 11301);
    const wrong = stack(noLeader, seat, "WCELL", "BT31130");
    assert.equal(barrier(noLeader, wrong.top), false, "without a white <Cell> Leader: no [Barrier]");
  }

  // ── a [Permanent] that reaches other cards than the one above it changes nothing from a pile ──
  {
    const s = fresh(seat, "L-RED", 11302);
    const st = stack(s, seat, "BUU", "ORD");
    const bystander = stage(s, seat, "NOBUU", "battle");
    assert.equal(barrier(s, st.top), false, `${seat}: "your Battle Cards gain [Barrier]" does not apply from the pile`);
    assert.equal(barrier(s, bystander), false, "…to the rest of the board either");
    // The same text is live where it is valid, so the control above proves the refusal and not a dead card.
    const live = fresh(seat, "L-RED", 11304);
    stage(live, seat, "ORD", "battle");
    const other = stage(live, seat, "NOBUU", "battle");
    assert.equal(barrier(live, other), true, "in the Battle Area the same Permanent grants [Barrier]");
  }
}

console.log("pile-permanents-1119: ok");
