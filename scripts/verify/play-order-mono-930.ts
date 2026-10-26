/**
 * #930, two printings the compiler did not take, both read now.
 *
 * 1. BT17-077 (Piccolo, Fusing Further) front #0, a native [Union-Absorb]:
 *
 *   [union absorb][once per turn]{2}, if your Leader Card is a ≪Namekian≫
 *   card, you have 3 or more energy, and you choose 1 ≪Namekian≫ card in your
 *   hand or Battle Area and place it under this card: Play up to 1 green
 *   <Piccolo> card with an energy cost of 4 **on top of this card from your
 *   deck**, then shuffle your deck.
 *
 *   The destination is printed before the source. The play-on-top reader took
 *   only "… from your deck on top of this card"; the play was unread and the
 *   Absorb only shuffled. The source is now moved in front of the destination
 *   before the clause is read (`compileClause`, `compile/effects.ts`).
 *
 * 2. BT31-052 (SS4 Gogeta, the Light Protecting the Universe) front #10:
 *
 *   [union-fusion] {g}{g}{1}, draw 1 card: **Mono green** <Son Goku: GT> card
 *   and mono-green <Vegeta: GT> card.
 *
 *   "Mono green" without the hyphen: no mono-colour reader took it, and the
 *   Fusion's material record was refused. "Mono <colour>" / "mono colour" is
 *   tidied to the hyphenated word before the line is read (`tidyEffect`,
 *   `text/cards.ts`).
 *
 * Proof: printed text → stored rows → JSON → `rulesFromRows` → the VM, both
 * seats, the state reloaded from JSON after every action. Source:
 * docs/rules/rulemanual.txt 22-13-4 (Union-Fusion), 22-13-6 (Union-Absorb);
 * printed texts from docs/rules-audit-2026-10-15/audit.json and
 * docs/arena-backlog/evidence/923/inventory.json.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { recordContractGaps, rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { parseFilter } from "../../src/lib/arena/text/filters";
import type { Op } from "../../src/lib/arena/vm/script";
import { deepEqual, parseRule, printRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, Color, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── the printed texts ────────────────────────────────────────────────────────
const BT17_077 = "[union absorb][once per turn]{2}, if your Leader Card is a ≪Namekian≫ card, you have 3 or more energy, and you choose 1 ≪Namekian≫ card in your hand or Battle Area and place it under this card: Play up to 1 green <Piccolo> card with an energy cost of 4 on top of this card from your deck, then shuffle your deck.";
const BT17_077_USUAL = BT17_077.replace("on top of this card from your deck", "from your deck on top of this card");
const BT31_052_FUSION = "[union-fusion] {g}{g}{1}, draw 1 card: Mono green <Son Goku: GT> card and mono-green <Vegeta: GT> card.";
const BT31_052 = [
  "[deflect] [barrier] [dual attack]",
  BT31_052_FUSION,
  "[auto] [once per turn] When your opponent activates a [counter] skill, your opponent discards 1 card from their hand.",
  "[activate: main] [limit 1] {g}: Activate the [activate: main] skill of up to 1 {Big Bang Kamehameha} in your hand.",
].join("\n");

const green = (id: string, o: Partial<CardDef> = {}): CardDef => card(id, { colors: ["Green"] as Color[], skill: null, ...o });
const defs: Record<string, CardDef> = { ...DEFS,
  "L-NAM": card("L-NAM", { type: "LEADER", colors: ["Green"], traits: ["Namekian"], characters: ["Nail"], energyCost: null, comboCost: null, comboPower: null, skill: null }),
  "L-GREEN": card("L-GREEN", { type: "LEADER", colors: ["Green"], energyCost: null, comboCost: null, comboPower: null, skill: null }),
  "BT17-077": green("BT17-077", { name: "Piccolo, Fusing Further", characters: ["Piccolo"], traits: ["Namekian"], energyCost: 5, power: 20000, skill: BT17_077 }),
  "BT31-052": green("BT31-052", { name: "SS4 Gogeta, the Light Protecting the Universe", characters: ["Gogeta: GT"], traits: ["Saiyan"], energyCost: 8, power: 35000, skill: BT31_052 }),
  "NAM": green("NAM", { characters: ["Dende"], traits: ["Namekian"], energyCost: 2, power: 10000 }),
  "SAI": green("SAI", { characters: ["Raditz"], traits: ["Saiyan"], energyCost: 2, power: 10000 }),
  "PIC4": green("PIC4", { characters: ["Piccolo"], traits: ["Namekian"], energyCost: 4, power: 25000 }),
  "PIC4Y": card("PIC4Y", { colors: ["Yellow"], characters: ["Piccolo"], traits: ["Namekian"], energyCost: 4, power: 25000, skill: null }),
  "PIC3": green("PIC3", { characters: ["Piccolo"], traits: ["Namekian"], energyCost: 3, power: 20000 }),
  "GOKU-GT": green("GOKU-GT", { characters: ["Son Goku: GT"], traits: ["Saiyan"], energyCost: 4, power: 20000 }),
  "VEG-GT": green("VEG-GT", { characters: ["Vegeta: GT"], traits: ["Saiyan"], energyCost: 4, power: 20000 }),
  "VEG-GT-GY": card("VEG-GT-GY", { colors: ["Green", "Yellow"], characters: ["Vegeta: GT"], traits: ["Saiyan"], energyCost: 4, power: 20000, skill: null }),
  "GOKU-GT-GY": card("GOKU-GT-GY", { colors: ["Green", "Yellow"], characters: ["Son Goku: GT"], traits: ["Saiyan"], energyCost: 4, power: 20000, skill: null }),
  "G-E": green("G-E"),
};
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;

type Row = RuleRow & { ops: Op[]; unread: string[]; reads: string; kind: string; cost: Rule["cost"] & { program: Op[] | null; absorb?: unknown; fusion?: { needs: { name: string; filter: { colors: string[]; monoColor: boolean } }[]; samePower: boolean } } | null };
const rowOf = (cardId: string, skillIndex: number): Row => {
  const row = rows.find((r) => r.cardId === cardId && r.skillIndex === skillIndex);
  assert.ok(row, `${cardId}#${skillIndex}: a stored row`);
  const back = roundtrip(row);
  assert.deepEqual(recordContractGaps(back), [], `${cardId}#${skillIndex}: the stored row needs no rebuild`);
  assert.deepEqual(runtimeSupportOfRow(back).unsupported, [], `${cardId}#${skillIndex}: the stored row is runnable`);
  return back as Row;
};
const roundTrips = (r: Row, label: string) => {
  const rule = { kind: r.kind, trigger: r.trigger, cost: r.cost, usage: r.usage, validity: r.validity, cond: r.cond, ops: r.ops } as unknown as Rule;
  const text = printRule(rule);
  const back = parseRule(text);
  assert.ok(back.ok, `${label}: the rules language parses what it printed: ${text}`);
  assert.ok(back.ok && deepEqual(back.value, rule), `${label}: and comes back the same`);
};

// ── 1. the records ───────────────────────────────────────────────────────────
{
  const r = rowOf("BT17-077", 0);
  assert.equal(r.printed, BT17_077, "the row keeps the printed order");
  assert.equal(r.kind, "keyword");
  assert.deepEqual(r.unread, [], "BT17-077#0: nothing unread");
  assert.deepEqual(r.cost?.absorb, { version: 1, variant: "Absorb", area: "battle" }, "the typed Union-Absorb identity");
  assert.deepEqual(r.ops.map((o) => o.op), ["choose", "play", "shuffle"], "search, play on top, shuffle");
  const search = r.ops[0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual([search.sel.side, search.sel.area, search.sel.filter?.colors, search.sel.filter?.characters, search.sel.filter?.costMin, search.sel.filter?.costMax, search.sel.count, search.sel.upTo],
    ["you", "deck", ["Green"], ["piccolo"], 4, 4, 1, true], "up to 1 green <Piccolo> with an energy cost of 4, from your deck");
  const play = r.ops[1] as Extract<Op, { op: "play" }>;
  assert.deepEqual([JSON.stringify(play.target), JSON.stringify(play.onto), play.using, play.counterWindow], [JSON.stringify({ var: search.as }), JSON.stringify({ sel: { special: "self" } }), "Union-Absorb", true], "played on top of this card, as the Absorb's own play");
  roundTrips(r, "BT17-077#0");
  // The usual order reads the same program.
  const usual = skillRecords(card("U", { skill: BT17_077_USUAL }))[0];
  assert.deepEqual(usual.unread, []);
  assert.deepEqual(roundtrip(usual.ops).map((o: Op & { reason?: string }) => ({ ...o, reason: undefined })), r.ops.map((o: Op & { reason?: string }) => ({ ...o, reason: undefined })), "destination-first and source-first give one program");
  // With a mode tail, the mode stays the play's.
  const rested = skillRecords(card("R", { skill: BT17_077.replace("from your deck,", "from your deck in Rest Mode,") }))[0];
  assert.deepEqual(rested.unread, []);
  assert.equal((rested.ops[1] as Extract<Op, { op: "play" }>).mode, "rest", "“… on top of this card from your deck in Rest Mode”: the mode is kept");
  // Not widened: a destination the reader does not take stays unread.
  const elsewhere = skillRecords(card("E", { skill: "[Activate: Main] Play up to 1 green <Piccolo> card with an energy cost of 4 in your opponent's Battle Area from your deck." }))[0];
  assert.ok(elsewhere.unread.length > 0, "a play into the opponent's Battle Area stays unread");
}
{
  const r = rowOf("BT31-052", 10);
  assert.equal(r.printed, BT31_052_FUSION, "the row keeps “Mono green” as printed");
  assert.deepEqual(r.unread, [], "BT31-052#10: the material line is read");
  const fusion = r.cost?.fusion;
  assert.ok(fusion, "a typed Fusion material record");
  assert.deepEqual(fusion!.needs.map((n) => [n.name, n.filter.colors, n.filter.monoColor]), [["Son Goku: GT", ["Green"], true], ["Vegeta: GT", ["Green"], true]], "both materials are mono-green, each by its own name");
  assert.equal(fusion!.samePower, true);
  roundTrips(r, "BT31-052#10");
  // Every spelling of mono-colour reads the same.
  for (const w of ["mono-green", "Mono-Green"]) assert.deepEqual([parseFilter(`${w} card`).monoColor, parseFilter(`${w} card`).colors], [true, ["Green"]], `the hyphenated word the tidy-up produces: “${w}”`);
  assert.equal(parseSkills(BT31_052_FUSION)[0].effect, "Mono-green <Son Goku: GT> card and mono-green <Vegeta: GT> card.", "the line is tidied before it is read");
  for (const w of ["Mono green", "mono green", "MONO GREEN", "mono-green", "Mono-Green"]) {
    const rec = skillRecords(card("F", { skill: `[union-fusion] {g}{g}{1}: ${w} <Son Goku: GT> card and ${w} <Vegeta: GT> card.` }))[0];
    assert.deepEqual(rec.unread, [], `“${w}” materials are read`);
    assert.deepEqual(rec.cost?.fusion?.needs.map((n) => n.filter.monoColor), [true, true], `“${w}” is mono-colour`);
  }
  for (const w of ["mono color", "monocolor", "mono-colour"]) {
    const rec = skillRecords(card("C", { skill: `[Activate: Main] Choose up to 1 of your ${w} Battle Cards and it gets +5000 power for the turn.` }))[0];
    assert.deepEqual(rec.unread, [], `“${w}” is read`);
    assert.equal((rec.ops[0] as Extract<Op, { op: "choose" }>).sel.filter?.monoColor, true, `“${w}” is mono-colour`);
  }
  // A bracketed name is never touched.
  assert.equal(parseSkills("[Activate: Main] Choose up to 1 <Mono Green> card.")[0].effect, "Choose up to 1 <Mono Green> card.");
}

// ── 2. the VM, both seats ───────────────────────────────────────────────────
function take(s: VmState, action: Action): VmState {
  return roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
}
function fresh(seat: PlayerId, seed: number, leader: string): VmState {
  const leaders = { p1: seat === "p1" ? leader : "L-BLUE", p2: seat === "p2" ? leader : "L-BLUE" };
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader: leaders.p1, main: fifty("V1") }, p2: { name: "Second", leader: leaders.p2, main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(seat === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, seat);
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy") s.cards[id].mode = "active";
  return id;
}
const offer = (s: VmState, c: string, skill: number) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && (l.action as { card?: string }).card === c && (l.action as { skill?: number }).skill === skill);
/** Declare the line; at each card choice take the first of `picks` on offer (or nothing / the minimum). Every step reloaded. */
function run(s: VmState, c: string, skill: number, picks: string[]): { s: VmState; offered: string[][] } {
  const o = offer(s, c, skill);
  assert.ok(o, "the line is offered");
  s = take(s, o.action);
  const offered: string[][] = [];
  const left = [...picks];
  for (let i = 0; i < 40 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt as { kind: string; player: PlayerId; choice?: { candidates: string[]; min: number } };
    if (q.kind === "chooseCards") {
      offered.push([...q.choice!.candidates]);
      const want = left.filter((id) => q.choice!.candidates.includes(id));
      const cards = want.length ? want.slice(0, Math.max(1, q.choice!.min)) : q.choice!.candidates.slice(0, q.choice!.min);
      for (const w of cards) if (left.includes(w)) left.splice(left.indexOf(w), 1);
      s = take(s, { type: "choose", player: q.player, cards });
    } else if (q.kind === "payCost") s = take(s, { type: "payCost", player: q.player, option: 0 } as Action);
    else if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: q.player, index: 0 } as Action);
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null } as Action);
    else s = take(s, { type: "pass", player: q.player } as Action);
  }
  assert.equal(s.prompt.kind, "main", "back in the Main Phase");
  assert.deepEqual(left, [], "every intended card was offered and taken");
  return { s, offered };
}
const rested = (s: VmState, p: PlayerId) => s.sides[p].zones.energy.filter((id) => s.cards[id].mode === "rest").length;
const FUSION = parseSkills(BT31_052).find((sk) => sk.keyword?.name === "Union")!.index;
assert.equal(FUSION, 10, "BT31-052's Fusion is line #10");

const cases: string[] = [];
for (const seat of ["p1", "p2"] as const) {
  // ── BT17-077: the Absorb plays the green cost-4 <Piccolo> from the deck on top of itself.
  const absorbBoard = (seed: number, o: { energy?: number; leader?: string; deck?: string[] } = {}) => {
    const s = fresh(seat, seed, o.leader ?? "L-NAM");
    const host = stage(s, seat, "BT17-077", "battle");
    const mat = stage(s, seat, "NAM", "hand");
    const notMat = stage(s, seat, "SAI", "hand");
    for (let i = 0; i < (o.energy ?? 3); i++) stage(s, seat, "G-E", "energy");
    const deck = s.sides[seat].zones.deck;
    const [target, wrongColour, wrongCost] = [deck[0], deck[1], deck[2]];
    const ids = o.deck ?? ["PIC4", "PIC4Y", "PIC3"];
    [target, wrongColour, wrongCost].forEach((id, i) => { s.cards[id].cardId = ids[i]; });
    return { s, host, mat, notMat, target, wrongColour, wrongCost };
  };
  {
    const b = absorbBoard(9301);
    const deckBefore = b.s.sides[seat].zones.deck.length;
    const { s, offered } = run(b.s, b.host, 0, [b.mat, b.target]);
    assert.ok(offered[0].includes(b.mat) && !offered[0].includes(b.notMat), `${seat}: the price offers the ≪Namekian≫ card, not the ≪Saiyan≫`);
    assert.deepEqual(new Set(offered[1]), new Set([b.target]), `${seat}: the search finds only the green cost-4 <Piccolo> in the deck`);
    assert.ok(s.sides[seat].zones.battle.includes(b.target), `${seat}: the <Piccolo> is played`);
    assert.ok(s.cards[b.target].under.includes(b.host), `${seat}: on top of BT17-077`);
    assert.ok(s.cards[b.target].under.includes(b.mat), `${seat}: with the placed material in the pile`);
    assert.ok(!s.sides[seat].zones.battle.includes(b.host), `${seat}: BT17-077 left the Battle Area for the pile`);
    assert.equal(rested(s, seat), 2, `${seat}: the {2} is paid`);
    assert.equal(s.sides[seat].zones.deck.length, deckBefore - 1, `${seat}: one card left the deck`);
    cases.push(`${seat}/absorb`);
  }
  {
    // Declined: the host stays, the price stays paid; once per turn.
    const b = absorbBoard(9302);
    const { s } = run(b.s, b.host, 0, [b.mat]);
    assert.ok(s.sides[seat].zones.battle.includes(b.host), `${seat}: nothing played, BT17-077 stays`);
    assert.ok(s.cards[b.host].under.includes(b.mat), `${seat}: the material stays under it`);
    assert.equal(offer(s, b.host, 0), undefined, `${seat}: [Once per turn]`);
    cases.push(`${seat}/declined`);
  }
  {
    // The price's conditions: 2 energy is short, and a non-≪Namekian≫ Leader refuses it.
    const short = absorbBoard(9303, { energy: 2 });
    assert.equal(offer(short.s, short.host, 0), undefined, `${seat}: 2 energy — not offered`);
    const g = absorbBoard(9304, { leader: "L-GREEN" });
    assert.equal(offer(g.s, g.host, 0), undefined, `${seat}: a non-≪Namekian≫ Leader — not offered`);
    cases.push(`${seat}/absorb-conditions`);
  }

  // ── BT31-052: offered with two mono-green materials, refused with a multicolour one.
  const fusionBoard = (seed: number, gok = "GOKU-GT", veg = "VEG-GT") => {
    const s = fresh(seat, seed, "L-GREEN");
    const fus = stage(s, seat, "BT31-052", "hand");
    const g = stage(s, seat, gok, "hand");
    const v = stage(s, seat, veg, "hand");
    for (let i = 0; i < 3; i++) stage(s, seat, "G-E", "energy");
    return { s, fus, g, v };
  };
  {
    const b = fusionBoard(9305);
    const handBefore = b.s.sides[seat].zones.hand.length;
    const { s } = run(b.s, b.fus, FUSION, [b.g, b.v]);
    assert.ok(s.sides[seat].zones.battle.includes(b.fus), `${seat}: BT31-052 is played by its Fusion`);
    assert.ok(s.sides[seat].zones.drop.includes(b.g) && s.sides[seat].zones.drop.includes(b.v), `${seat}: both mono-green materials went to the Drop`);
    assert.equal(rested(s, seat), 3, `${seat}: {g}{g}{1} is paid`);
    assert.equal(s.sides[seat].zones.hand.length, handBefore - 3 + 1, `${seat}: the price's draw 1 card`);
    cases.push(`${seat}/fusion`);
  }
  for (const [g, v, why] of [["GOKU-GT", "VEG-GT-GY", "a Green/Yellow <Vegeta: GT>"], ["GOKU-GT-GY", "VEG-GT", "a Green/Yellow <Son Goku: GT>"]] as const) {
    const b = fusionBoard(9306, g, v);
    assert.equal(offer(b.s, b.fus, FUSION), undefined, `${seat}: ${why} is not mono-green — not offered`);
    // A mono-green one added beside it makes it legal again.
    const extra = stage(b.s, seat, g === "GOKU-GT" ? "VEG-GT" : "GOKU-GT", "hand");
    assert.ok(offer(b.s, b.fus, FUSION), `${seat}: with a mono-green ${why.replace(/^a Green\/Yellow /, "")} beside it, offered`);
    const { s, offered } = run(b.s, b.fus, FUSION, [g === "GOKU-GT" ? b.g : extra, g === "GOKU-GT" ? extra : b.v]);
    assert.ok(!offered.flat().includes(g === "GOKU-GT" ? b.v : b.g), `${seat}: the multicolour card is never a candidate`);
    assert.ok(s.sides[seat].zones.battle.includes(b.fus), `${seat}: played with the mono-green pair`);
    cases.push(`${seat}/fusion-multicolour-${g}`);
  }
}

assert.equal(cases.length, 12);
console.log(`play-order-mono-930: BT17-077#0 "on top of this card from your deck" reads as the usual order (green cost-4 <Piccolo> from the deck played on top as the Absorb); BT31-052#10 "Mono green" materials read as mono-green (offered with two mono-green, refused with a multicolour one); both seats, stored rows, JSON reload, rules-language round trip (${cases.length} cases)`);
