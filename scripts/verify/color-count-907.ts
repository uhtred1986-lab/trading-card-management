/**
 * #907: "for each card color in your Energy Area" counts COLORS, not cards.
 *
 * EX19-26 prints "...it gets -2000 power for the turn for each card color in
 * your Energy Area" and was read as "for each of your energy" (the count of
 * energy cards), because `parseTarget` places any unknown noun in the area that
 * follows it. The same collapse read "4 or more colors among cards in your
 * energy" (BT16-016 and 14 more) as "4 or more cards". Both are now a
 * selector carrying `distinctColors`; a multicolor card has each of its colors
 * (manual 1-8-1-1). A "for each <measure>" the compiler cannot map is refused.
 *
 * printed text -> compile -> stored-row JSON round-trip -> the real VM.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow } from "../../src/lib/arena/vm/program";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const EACH = "[Permanent] For each card color in your Energy Area, this card gets +1000 power.";
const EACH_TWO = "[Permanent] For each color among cards in your Energy Area and Battle Area, this card gets +100 power.";
const GATE = "[Permanent] If there are 3 or more colors among cards in your energy, this card gets +5000 power.";
const defs: Record<string, CardDef> = { ...DEFS,
  EACH907: card("EACH907", { colors: ["Red"], power: 10000, energyCost: 0, skill: EACH }),
  TWO907: card("TWO907", { colors: ["Red"], power: 10000, energyCost: 0, skill: EACH_TWO }),
  GATE907: card("GATE907", { colors: ["Red"], power: 10000, energyCost: 0, skill: GATE }),
  R907: card("R907", { colors: ["Red"], skill: null }), B907: card("B907", { colors: ["Blue"], skill: null }),
  RB907: card("RB907", { colors: ["Red", "Blue"], skill: null }), BG907: card("BG907", { colors: ["Blue", "Green"], skill: null }),
  K907: card("K907", { colors: ["Black"], skill: null }), Y907: card("Y907", { colors: ["Yellow"], skill: null }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;

// ── the reading ──────────────────────────────────────────────────────────────
const unread = (skill: string) => skillRecords(card("T907", { skill }))[0].unread.length > 0;
{
  const [row] = skillRecords(defs.EACH907);
  assert.deepEqual(row.unread, []);
  const op = row.ops[0] as { op: string; amount: { count: { area: string; distinctColors?: boolean }; times: number } };
  assert.equal(op.op, "power");
  assert.equal(op.amount.times, 1000);
  assert.equal(op.amount.count.area, "energy");
  assert.equal(op.amount.count.distinctColors, true, "the colors, not the energy cards");
  const two = skillRecords(defs.TWO907)[0].ops[0] as { amount: { count: { areas: string[]; distinctColors?: boolean } } };
  assert.deepEqual(two.amount.count.areas, ["energy", "battle"], "a plain 'and' keeps both places");
  assert.equal(two.amount.count.distinctColors, true);
  const gate = skillRecords(defs.GATE907)[0].cond as { kind: string; atLeast: number; sel: { distinctColors?: boolean } };
  assert.equal(gate.kind, "count"); assert.equal(gate.atLeast, 3); assert.equal(gate.sel.distinctColors, true);
  // EX19-26's own sentence (the live bug): the count is of colors.
  const ex = skillRecords(card("EX19-26", { skill: "[Auto] If your Leader Card is a <Bardock: Xeno> card and you have a black multicolor card in your energy other than this card: When this card in your hand is played or placed in your energy, choose up to 1 of your opponent's Battle Cards or Unison Cards and it gets -2000 power for the turn for each card color in your Energy Area." })).find((r) => r.kind === "auto")!;
  assert.deepEqual(ex.unread, []);
  assert.ok(JSON.stringify(ex.ops).includes('"distinctColors":true'), "EX19-26 counts colors");
}
{
  // P-321: a cost reduction per color among mono-color cards in two places.
  const [row] = skillRecords(card("P-321", { skill: "[Permanent] For each color among mono-color cards in your Drop Area and Warp, reduce the energy cost of this card in your hand by 1. (Black is a color.)" }));
  assert.deepEqual(row.unread, []);
  const op = row.ops[0] as { op: string; amount: { count: { areas: string[]; distinctColors?: boolean; filter?: { monoColor?: boolean } } } };
  assert.equal(op.op, "costReduction");
  assert.deepEqual(op.amount.count.areas, ["drop", "warp"]);
  assert.equal(op.amount.count.distinctColors, true);
  assert.equal(op.amount.count.filter?.monoColor, true, "only mono-color cards");
}
// Measures that are not cards are refused, not read as the area they stand in.
assert.ok(unread("[Permanent] This card gets +1000 power for each frobnitz in your Energy Area."), "an unknown noun is refused");
assert.ok(unread("[Permanent] This card gets +1000 power for each energy cost in your Drop Area."), "'energy cost' is not a card");
assert.ok(unread("[Permanent] This card gets +1000 power for each keyword skill they have."), "'keyword skill' is not a card");
assert.ok(unread("[Permanent] If there are 3 or more non-black colors present among black multicolor cards in your energy, this card gets +1000 power."), "'non-black colors' is not read as cards");
assert.ok(unread("[Permanent] For each color in your Energy Area or Drop Area, this card gets +1000 power."), "an 'or' of places is refused");
assert.ok(!unread("[Permanent] This card gets +1000 power for each card in your Energy Area."), "plain cards still read");
assert.ok(!unread("[Permanent] This card gets +1000 power for each multicolor card in your Energy Area."), "multicolor cards still read");
assert.ok(!unread("[Permanent] This card gets +100 power for each 1 energy you have."), "'energy you have' still reads");

// ── the VM ───────────────────────────────────────────────────────────────────
function take(s: VmState, action: Action): VmState { return RULES.apply(ctx, roundtrip(s), action).state as VmState; }
function fresh(): VmState {
  let s = RULES.createGame(ctx, { seed: 907, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-RED", main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
  ] as Action[]) s = take(s, action);
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.find((c) => !(s.cards[c].cardId in defs && defs[s.cards[c].cardId].skill)) ?? s.sides[p].zones.deck[0];
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok, `${def} -> ${area}`);
  if (area === "battle") s.cards[id].mode = "active";
  return id;
}
const power = (s: VmState, id: string) => attrsNow(ctx, game, s, id).power as number;
const colorsOf = (s: VmState, ids: string[]) => new Set(ids.flatMap((c) => attrsNow(ctx, game, s, c).colors as string[]));

for (const seat of ["p1", "p2"] as const) {
  const foe: PlayerId = seat === "p1" ? "p2" : "p1";
  // Energy colors and the unbonused power of the subject, whatever the starting charge was.
  const energy = (s: VmState) => colorsOf(s, s.sides[seat].zones.energy);
  {
    const s = fresh();
    const me = stage(s, seat, "EACH907", "battle");
    const base = power(s, me) - 1000 * energy(s).size;
    for (let i = 0; i < 6; i++) stage(s, seat, "R907", "energy");
    const afterRed = power(s, me);
    assert.equal(afterRed, base + 1000 * energy(s).size);
    for (let i = 0; i < 4; i++) stage(s, seat, "R907", "energy");
    assert.equal(power(s, me), afterRed, `${seat}: ten red energy cards are one color, not ten`);
    stage(s, seat, "B907", "energy");
    const withBlue = power(s, me);
    stage(s, seat, "B907", "energy");
    assert.equal(power(s, me), withBlue, "a second blue card adds nothing");
    assert.ok(withBlue >= afterRed);
    // A multicolor Blue/Green card adds Green only (Blue is already there): +1000, not +2000.
    stage(s, seat, "BG907", "energy");
    assert.equal(power(s, me), withBlue + 1000, "Blue/Green adds Green only");
    stage(s, seat, "RB907", "energy");
    assert.equal(power(s, me), withBlue + 1000, "Red/Blue adds no new color");
    stage(s, seat, "K907", "energy"); stage(s, seat, "Y907", "energy");
    assert.equal(energy(s).size, 5);
    assert.equal(power(s, me), base + 5000, "five colors in the Energy Area: +5000, however many cards");
    for (const d of ["R907", "B907", "K907"]) stage(s, foe, d, "energy");
    assert.equal(power(s, me), base + 5000, "the opponent's energy is not asked");
    assert.equal(attrsNow({ ...ctx, scripts: rulesFromRows(roundtrip(rows), defs) }, game, roundtrip(s), me).power, base + 5000, "reloaded from JSON");
  }
  // Two places: the colors of the union, each counted once.
  {
    const s = fresh();
    const me = stage(s, seat, "TWO907", "battle");
    const union = () => new Set([...energy(s), ...colorsOf(s, s.sides[seat].zones.battle)]).size;
    const base = power(s, me) - 100 * union();
    stage(s, seat, "Y907", "energy"); stage(s, seat, "Y907", "battle");
    assert.equal(power(s, me), base + 100 * union(), "Yellow in both places is one color");
  }
  // The gate: three COLORS, not three cards.
  {
    const s = fresh();
    const me = stage(s, seat, "GATE907", "battle");
    const gated = () => (energy(s).size >= 3 ? 5000 : 0);
    const base = power(s, me) - gated();
    for (let i = 0; i < 8; i++) stage(s, seat, "R907", "energy");
    assert.equal(power(s, me), base + gated());
    for (const d of ["B907", "K907", "Y907"]) stage(s, seat, d, "energy");
    assert.ok(energy(s).size >= 3);
    assert.equal(power(s, me), base + 5000, "three colors open it");
  }
  // Fewer colors than cards: the whole point.
  {
    const s = fresh();
    const me = stage(s, seat, "GATE907", "battle");
    // Empty the energy first, then eight cards of two colors.
    for (const c of [...s.sides[seat].zones.energy]) assert.ok(moveCard(s, game, c, "hand", { owner: seat }).ok);
    for (let i = 0; i < 4; i++) { stage(s, seat, "R907", "energy"); stage(s, seat, "B907", "energy"); }
    assert.equal(s.sides[seat].zones.energy.length, 8);
    assert.equal(power(s, me), 10000, `${seat}: eight energy cards of two colors do not meet 'three colors'`);
    stage(s, seat, "K907", "energy");
    assert.equal(power(s, me), 15000, "the third color does");
  }
}
console.log("color-count-907: ok");
