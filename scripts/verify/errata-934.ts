/**
 * #934: five official errata (BT2-015, BT22-137, BT3-070, BT4-108, P-360),
 * applied in `src/lib/catalog/errata.ts` and never by UPDATE: the catalog
 * snapshot's text -> `correctSkillText` -> compiled record -> stored-row JSON
 * round trip -> the real VM, with the exact official before/after strings
 * (page re-read 17 Oct 2026, https://www.dbs-cardgame.com/us-en/rule/errata-cards.php).
 *
 * Not claimed here (still #926/#930): the [Union-Absorb] cost of BT3-070 has no
 * program the engine pays, so the corrected "choose 1 each" is stored text and
 * a record cost.text only; P-360's *granted* Fusion skill is a Union permission
 * the compiler leaves unread. Colour orbs ({u}{y}, {r}{1}, {g}) are untouched by
 * these errata and were not re-derived from the extracted monochrome text.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { canPayPriceProgram } from "../../src/lib/arena/vm/activate";
import { CORRECTIONS, OFFICIAL_ERRATA, correctSkillText, unmatchedCorrections } from "../../src/lib/catalog/errata";
import type { Action, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ── 1. the catalog correction: exact before -> after, idempotent, audited ─────
assert.deepEqual(OFFICIAL_ERRATA.map((e) => e.cardId).sort(), ["BT2-015", "BT22-137", "BT3-070", "BT4-108", "P-360"]);
for (const e of OFFICIAL_ERRATA) {
  assert.ok(CORRECTIONS[e.cardId], `${e.cardId} is corrected in CORRECTIONS, not in the database`);
  assert.equal(correctSkillText(e.cardId, e.snapshot), e.corrected, `${e.cardId}: snapshot text becomes the official After`);
  assert.equal(correctSkillText(e.cardId, e.corrected), e.corrected, `${e.cardId}: applying twice changes nothing`);
  assert.notEqual(e.snapshot, e.corrected, `${e.cardId}: the audit keeps both texts apart`);
  // The official page's After differs from its Before by exactly what the correction changed.
  assert.notEqual(norm(e.officialBefore), norm(e.officialAfter));
  // …and drift from the source is reported: the 'wrong' side matches the snapshot only.
  assert.deepEqual(unmatchedCorrections(new Map([[e.cardId, [e.snapshot]]])), [], `${e.cardId}: matches the snapshot`);
  assert.equal(unmatchedCorrections(new Map([[e.cardId, [e.corrected]]])).length, CORRECTIONS[e.cardId].length, `${e.cardId}: reported once the source is fixed upstream`);
}
// Spacing / line breaks in the source must not make a correction miss.
assert.equal(correctSkillText("P-360", "Choose  up to\n1 red or blue ≪Saiyan≫ card in your hand and discard it"), "Choose 1 red or blue ≪Saiyan≫ card in your hand and discard it");
assert.equal(correctSkillText("BT3-070", "choose up to 1 each of <Android 14>"), "choose 1 each of <Android 14>", "'up to 1 each' goes");
assert.equal(correctSkillText("BT3-070", "Choose up to 1 <Android 13> with an energy cost of 7"), "Choose up to 1 <Android 13> with an energy cost of 7", "the effect's own 'up to 1' stays");
assert.equal(correctSkillText("P-360", "Look at up to 3 cards"), "Look at up to 3 cards", "other 'up to' wording stays");
assert.equal(correctSkillText("BT22-137", "[union-fusion]{u}{y}{2}, if your opponent has 3 or more energy and draws 2 cards: X"), "[union-fusion]{u}{y}{2}, if your opponent has 3 or more energy and you draw 2 cards: X");
assert.equal(correctSkillText("BT4-108", "[auto] +5000 power for each card in your Warp. [auto] Other."), "[auto] +5000 power for each card in your Warp for the duration of the turn. [auto] Other.");
assert.equal(correctSkillText("BT2-015", "(Place 1 each of the specified card with the same power into your Drop Area and play this card)"), "(Place 1 each of the specified card with the same power from your hand into your Drop Area and play this card)");

const fixed = (id: string) => OFFICIAL_ERRATA.find((e) => e.cardId === id)!.corrected;
const snap = (id: string) => OFFICIAL_ERRATA.find((e) => e.cardId === id)!.snapshot;
const rec = (id: string, skill: string) => skillRecords(card(id, { skill }))[0];

// ── 2. the stored compiler record, before and after ──────────────────────────
// BT4-108: the gain is for the turn either way; the reading is unchanged and now matches the text.
for (const skill of [snap("BT4-108"), fixed("BT4-108")]) {
  const r = rec("BT4108", skill);
  assert.deepEqual(r.unread, []);
  const op = r.ops[0] as { op: string; until?: string; amount: { times: number } };
  assert.equal(op.op, "power"); assert.equal(op.until, "turn"); assert.equal(op.amount.times, 5000);
}
assert.equal(rec("BT4108", fixed("BT4-108")).printed, fixed("BT4-108"));
// BT2-015: reminder text only; the price and materials are the keyword's.
assert.deepEqual(rec("BT2015", fixed("BT2-015")).cost?.orbs, { Red: 1, any: 1 });
assert.deepEqual(rec("BT2015", fixed("BT2-015")).unread, []);
// BT22-137: the condition is the opponent's energy, the program a draw 2 by the activator.
for (const skill of [snap("BT22-137"), fixed("BT22-137")]) {
  const c = rec("BT22137", skill).cost!;
  assert.deepEqual(c.program, [{ op: "draw", n: 2 }]);
  assert.deepEqual(roundtrip(c.condition), { kind: "count", sel: { side: "opponent", area: "energy" }, atLeast: 3 });
}
assert.match(rec("BT22137", fixed("BT22-137")).cost!.text, /and you draw 2 cards$/);
// BT3-070: the cost text is the corrected one; the engine reads no program for it (#926/#930).
assert.match(rec("BT3070", fixed("BT3-070")).cost!.text, /^choose 1 each of <Android 14> and <Android 15>/);
assert.doesNotMatch(rec("BT3070", fixed("BT3-070")).cost!.text, /up to/);
assert.equal(rec("BT3070", fixed("BT3-070")).cost!.program, null, "unsupported absorb cost stays under #926/#930");
// P-360: the discard is a required choice after the errata, optional before.
const discardChoice = (skill: string) => (rec("P360", skill).cost!.program![0] as { op: string; sel: { upTo: boolean; count: number } });
assert.equal(discardChoice(snap("P-360")).sel.upTo, true, "snapshot: 'up to 1' (could be paid with nothing, 5-2-4)");
assert.equal(discardChoice(fixed("P-360")).sel.upTo, false, "corrected: exactly 1");
assert.equal(discardChoice(fixed("P-360")).sel.count, 1);

// ── 3. the VM ────────────────────────────────────────────────────────────────
const mat = (id: string, colors: ("Red" | "Blue" | "Yellow")[], characters: string[], power: number) => card(id, { colors, characters, power, energyCost: 1, skill: null });
const defs = { ...DEFS,
  GOG934: card("GOG934", { name: "SS Gogeta, Sparking to Utmost Limit", colors: ["Blue"], characters: ["Gogeta"], power: 35000, energyCost: 5, skill: fixed("BT22-137") }),
  OLD934: card("OLD934", { name: "SS Gogeta (snapshot)", colors: ["Blue"], characters: ["Gogeta"], power: 35000, energyCost: 5, skill: snap("BT22-137") }),
  P934: card("P934", { name: "Vegeta", type: "LEADER", colors: ["Red"], characters: ["Vegeta: Br"], energyCost: null, comboCost: null, comboPower: null, skill: fixed("P-360") }),
  GOKU934: mat("GOKU934", ["Yellow"], ["Son Goku"], 5000), VEG934: mat("VEG934", ["Blue"], ["Vegeta"], 5000),
  EB934: card("EB934", { colors: ["Blue"], characters: ["Filler"], energyCost: 1, skill: null }),
  EY934: card("EY934", { colors: ["Yellow"], characters: ["Filler"], energyCost: 1, skill: null }),
  SAI934: card("SAI934", { colors: ["Red"], characters: ["Vegeta"], traits: ["Saiyan"], energyCost: 1, skill: null }),
  NON934: card("NON934", { colors: ["Red"], characters: ["Filler"], traits: [], energyCost: 1, skill: null }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
function take(s: VmState, action: Action) { const r = RULES.apply(ctx, roundtrip(s), action); return { s: roundtrip(r.state as VmState), ev: r.events }; }
function fresh(seat: PlayerId, seed = 934): VmState {
  const leaders = { p1: seat === "p1" ? "L-BLUE" : "L-RED", p2: seat === "p2" ? "L-BLUE" : "L-RED" };
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader: leaders.p1, main: fifty("V1") }, p2: { name: "Second", leader: leaders.p2, main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(seat === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action).s;
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); return id;
}
const count = (s: VmState, p: PlayerId, area: string) => s.sides[p].zones[area].length;
const offered = (s: VmState, card: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === card);

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  // BT22-137: opponent >= 3 energy is the condition; the ACTIVATING seat draws 2.
  const board = (foeEnergy: number, def = "GOG934") => {
    const s = fresh(seat, 9341);
    const gog = stage(s, seat, def, "hand");
    stage(s, seat, "GOKU934", "hand"); stage(s, seat, "VEG934", "hand");
    stage(s, seat, "EB934", "energy"); stage(s, seat, "EY934", "energy"); stage(s, seat, "EB934", "energy"); stage(s, seat, "EB934", "energy");
    for (let i = 0; i < foeEnergy; i++) stage(s, foe, "V-BLUE", "energy");
    return { s, gog };
  };
  for (const def of ["GOG934", "OLD934"]) {
    const no = board(2, def); assert.equal(offered(no.s, no.gog), undefined, `${seat}: ${def} needs the opponent's 3 energy`);
  }
  const yes = board(3);
  const o = offered(yes.s, yes.gog); assert.ok(o, `${seat}: corrected BT22-137 offered with 3 foe energy`);
  const deckMe = count(yes.s, seat, "deck"), deckFoe = count(yes.s, foe, "deck"), handFoe = count(yes.s, foe, "hand");
  let r = take(yes.s, o.action);
  for (let i = 0; i < 12 && r.s.prompt.kind !== "main"; i++) {
    const q = r.s.prompt;
    if (q.kind === "payCost") r = take(r.s, { type: "payCost", player: seat, option: 0 } as Action);
    else if (q.kind === "chooseCards") r = take(r.s, { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    else if (q.kind === "orderPending") r = take(r.s, { type: "orderPending", player: q.player, index: 0 } as Action);
    else r = take(r.s, { type: "pass", player: (q as { player: PlayerId }).player } as Action);
  }
  assert.equal(r.s.prompt.kind, "main");
  assert.ok(r.s.sides[seat].zones.battle.includes(yes.gog), `${seat}: Gogeta fused in`);
  assert.equal(count(r.s, seat, "deck"), deckMe - 2, `${seat}: the activating player drew 2 (paid)`);
  assert.equal(count(r.s, foe, "deck"), deckFoe, `${seat}: the opponent drew nothing`);
  assert.equal(count(r.s, foe, "hand"), handFoe, `${seat}: the opponent's hand is untouched`);

  // P-360: with the errata the discard price is exactly 1 matching card.
  const price = discardChoice(fixed("P-360")) && (skillRecords(defs.P934)[0].cost!.program as never);
  const hasHand = (cards: string[]) => {
    const s = fresh(seat, 9342);
    const lead = s.sides[seat].zones.leader[0];
    for (const c of cards) stage(s, seat, c, "hand");
    return canPayPriceProgram(ctx, game, s, seat, lead, price);
  };
  assert.equal(hasHand(["SAI934"]), true, `${seat}: a red Saiyan in hand pays P-360's discard`);
  assert.equal(hasHand([]), false, `${seat}: an empty hand cannot pay 'choose 1 … and discard it'`);
  assert.equal(hasHand(["NON934"]), false, `${seat}: a card that is not a Saiyan cannot`);
  const optional = skillRecords(card("P360old", { skill: snap("P-360") }))[0].cost!.program as never;
  const empty = fresh(seat, 9343);
  assert.equal(canPayPriceProgram(ctx, game, empty, seat, empty.sides[seat].zones.leader[0], optional), true, "the snapshot's 'up to 1' was payable with nothing");
}

console.log("errata-934: BT2-015, BT22-137, BT3-070, BT4-108, P-360 — exact official before/after through correctSkillText, idempotent, stored records, BT22-137 draw payer and P-360 required discard in the VM, both seats passed");
