/**
 * #930, the rest of the three "next time you activate the [Union] skill …"
 * cards whose reduction #1174 made work (`union-next-time-930.ts`), with the
 * clauses around it that were still unread:
 *
 *  - BT31-043 front#20 — Pan, Adorable Supporter: "[auto] When this card is
 *    removed from a Unison Area, until the end of your turn, the next time you
 *    activate the [union] skill on a green <Gogeta: GT> card from your hand,
 *    reduce the skill cost by {1}." The moment had no trigger: it is
 *    `removedFromUnison` now — this card leaving a Unison Area for any other
 *    area, whatever moved it (3-11, 13-2-1-3, 21-9-2) — and "until the end of
 *    **your** turn" is `ownTurn`: the end of its controller's own turn, the
 *    next one when the card left on the opponent's turn.
 *  - EX23-11 front#10 — Son Goku & Vegeta, Pre-Fusion Warriors: "Add up to 1
 *    <Son Goku> card and 1 <Vegeta> card―both blue and with 20000 power―from
 *    among all cards in your deck and Drop to your hand, shuffle your deck if
 *    you looked through it, …": one "up to 1" slot per name (the named-set
 *    gather, `compile/named-set.ts`), each blue with 20000 power, from the deck
 *    and/or the Drop, each a card of its own.
 *  - EX25-11 front#10 — Bonds of Potara: "Play up to 1 each of <Kale> and
 *    <Caulifla> cards with 9000 power in Rest Mode from your Drop, …": one
 *    "up to 1" slot per name, each played in Rest Mode.
 *
 * Proved here: the records (nothing unread, trigger and duration, the JSON
 * round trip), and in the VM for both seats with every step reloaded from JSON
 * — each new clause doing what it says, and the reduction after it applying
 * once only. Printed texts: docs/arena-backlog/evidence/923/inventory.json and
 * docs/rules-audit-2026-10-15/audit.json (catalog snapshot of 15 Oct 2026).
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
const BT31_043_F20 = "[auto] When this card is removed from a Unison Area, until the end of your turn, the next time you activate the [union] skill on a green <Gogeta: GT> card from your hand, reduce the skill cost by {1}.";
const EX23_11_F10 =
  "[activate: main][limit 1] If your Leader is {Miracle Strike Gogeta} or {SSB Gogeta, Miraculous Strongest Warrior}, you place 1 card from your hand at the bottom of your deck, and you remove this card from the game: Add up to 1 <Son Goku> card and 1 <Vegeta> card―both blue and with 20000 power―from among all cards in your deck and Drop to your hand, shuffle your deck if you looked through it, and during that turn, the next time you activate [union] on a blue <Gogeta> card in your hand with an energy cost of 5, reduce the skill cost by {u}{1}.";
const EX25_11_F10 =
  "[Activate: Main][Limit 1] If your Leader's back side is {Kefla, Surge of Ferocity} and you discard 1 card from your hand: Play up to 1 each of <Kale> and <Caulifla> cards with 9000 power in Rest Mode from your Drop, and the next time you activate the [Union] skill on {Kefla, Everlasting Light} from your hand during this turn, reduce the skill cost by {y}.";
// BT31-043's other printed line ("[-x] … remove X markers from it") is not read yet; a plain
// [-1] line stands in for it so the card can take its own last marker off (21-9-2).
const BT31_043_TEST = `${BT31_043_F20}\n[-1][activate: main] Draw 1 card.`;
// The [Union] lines the reductions wait for (hyphenated "Mono-green" as in `union-next-time-930.ts`).
const GOGETA_GT_FUSION = "[union-fusion] {g}{g}{1}, draw 1 card: Mono-green <Son Goku: GT> card and mono-green <Vegeta: GT> card.";
const GOGETA_BLUE_FUSION = "[union-fusion] {u}{u}{1}, draw 1 card: Blue <Son Goku> card and blue <Vegeta> card.";
const KEFLA_FUSION = "[union-fusion] {y}{y}{1}, draw 1 card: Yellow <Kale> card and yellow <Caulifla> card.";

const mat = (id: string, colors: Color[], characters: string[], o: Partial<CardDef> = {}) => card(id, { colors, characters, power: 10000, energyCost: 1, skill: null, ...o });
const unison = (id: string, skill: string) => card(id, { type: "UNISON", colors: ["Green"], characters: ["Pan: GT"], energyCost: "X", power: 15000, comboCost: null, comboPower: null, skill });
const defs: Record<string, CardDef> = {
  ...DEFS,
  "L-GRN": card("L-GRN", { type: "LEADER", colors: ["Green"], characters: ["Gogeta: GT"], power: 10000, energyCost: null, skill: null }),
  "L-MSG": card("L-MSG", { type: "LEADER", name: "Miracle Strike Gogeta", colors: ["Blue"], characters: ["Gogeta"], power: 10000, energyCost: null, skill: null }),
  "L-KEF": card("L-KEF", { type: "LEADER", name: "Kale", colors: ["Yellow"], characters: ["Kale"], power: 10000, energyCost: null, skill: null, back: { name: "Kefla, Surge of Ferocity", power: 15000, skill: null } }),
  PAN: unison("PAN", BT31_043_TEST),
  // Another Unison, played over Pan (13-2-1-3), and an opponent's card that sends a Unison to the Drop.
  UNI: unison("UNI", "[-1][activate: main] Draw 1 card."),
  KICK: card("KICK", { colors: ["Blue"], energyCost: 1, power: 10000, skill: "[Activate: Main] Choose up to 1 of your opponent's Unisons and place it in its owner's Drop Area." }),
  GOG: card("GOG", { colors: ["Green"], characters: ["Gogeta: GT"], energyCost: 6, power: 35000, skill: GOGETA_GT_FUSION }),
  GOKU: mat("GOKU", ["Green"], ["Son Goku: GT"]),
  VEGETA: mat("VEGETA", ["Green"], ["Vegeta: GT"]),
  "G-E": mat("G-E", ["Green"], ["Filler"]),
  // EX23-11 and what it looks for: blue 20000 Son Goku and Vegeta, and the decoys beside them.
  EX2311: card("EX2311", { type: "Z-BATTLE", colors: ["Blue"], characters: ["Son Goku", "Vegeta"], energyCost: null, zEnergyCost: 1, power: 15000, skill: EX23_11_F10 }),
  "GOKU-B20": mat("GOKU-B20", ["Blue"], ["Son Goku"], { power: 20000 }),
  "VEG-B20": mat("VEG-B20", ["Blue"], ["Vegeta"], { power: 20000 }),
  "GOKU-B15": mat("GOKU-B15", ["Blue"], ["Son Goku"], { power: 15000 }),
  "VEG-R20": mat("VEG-R20", ["Red"], ["Vegeta"], { power: 20000 }),
  "GOG-B5": card("GOG-B5", { colors: ["Blue"], characters: ["Gogeta"], energyCost: 5, power: 35000, skill: GOGETA_BLUE_FUSION }),
  "B-E": mat("B-E", ["Blue"], ["Filler"]),
  // EX25-11 and what it plays: Kale and Caulifla with 9000 power, a Kale with 10000 that it does not.
  EX2511: card("EX2511", { name: "Bonds of Potara", type: "Z-EXTRA", colors: ["Yellow"], characters: [], energyCost: 1, zEnergyCost: 1, power: null, comboCost: null, comboPower: null, skill: EX25_11_F10 }),
  "KALE-9": mat("KALE-9", ["Yellow"], ["Kale"], { power: 9000 }),
  "CAUL-9": mat("CAUL-9", ["Yellow"], ["Caulifla"], { power: 9000 }),
  "KALE-10": mat("KALE-10", ["Yellow"], ["Kale"], { power: 10000 }),
  KEFLA: card("KEFLA", { name: "Kefla, Everlasting Light", colors: ["Yellow"], characters: ["Kefla"], energyCost: 6, power: 35000, skill: KEFLA_FUSION }),
  "Y-E": mat("Y-E", ["Yellow"], ["Filler"]),
};

// ── 1. the records ───────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Rec = ReturnType<typeof skillRecords>[number];
const asRule = (rec: Rec) => roundtrip({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops }) as Rule;
/** The one record, through the stored-row JSON round trip and the rules language's print and reparse. */
const only = (def: CardDef): Rec => {
  const recs = skillRecords(def);
  assert.equal(recs.length, 1, `${def.id}: one record`);
  const rule = asRule(recs[0]);
  assert.equal(validateRule(rule, recs[0].kind), null, `${def.id}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${def.id}: the rules language prints and reparses it`);
  // `upTo: false` is the selector default, and a selector over several areas prints its `areas` alone
  // (`area` is the first of them): neither is printed by the language.
  const plain = (v: unknown) =>
    JSON.parse(JSON.stringify(v, function (this: Record<string, unknown>, k, x) {
      if (k === "upTo" && x === false) return undefined;
      if (k === "area" && Array.isArray(this.areas) && this.areas[0] === x) return undefined;
      return x;
    }));
  assert.deepEqual(plain(round.value), plain(rule), `${def.id}: …unchanged`);
  return recs[0];
};
const noFilterNoise = (f: Record<string, unknown> | undefined) => Object.fromEntries(Object.entries(f ?? {}).filter(([, v]) => v !== null && v !== false && !(Array.isArray(v) && !v.length)));
{
  const r = only(card("BT31-043", { type: "UNISON", skill: BT31_043_F20 }));
  assert.deepEqual(r.unread, [], "BT31-043 front#20: nothing unread");
  assert.deepEqual(r.trigger, ["removedFromUnison"], "BT31-043 front#20: when this card is removed from a Unison Area");
  const op = r.ops.at(-1)!;
  assert.ok(op.op === "costReduction" && op.uses === 1 && op.tag === "union", "the one-use [Union] reduction");
  assert.equal(op.until, "ownTurn", "until the end of YOUR turn");
  assert.equal(op.amount, 1);
}
{
  const r = only(card("EX23-11", { type: "Z-BATTLE", skill: EX23_11_F10 }));
  assert.deepEqual(r.unread, [], "EX23-11 front#10: nothing unread");
  const [a, b, ma, mb, shuffle, reduce] = r.ops;
  assert.ok(a.op === "choose" && b.op === "choose", "a choice per name");
  for (const [ch, who] of [[a, "son goku"], [b, "vegeta"]] as const) {
    if (ch.op !== "choose" || !("side" in ch.sel)) throw new Error("a description");
    assert.deepEqual(ch.sel.areas, ["deck", "drop"], `${who}: from the deck and/or the Drop`);
    assert.equal(ch.sel.count, 1);
    assert.equal(ch.sel.upTo, true, `${who}: up to 1`);
    assert.deepEqual(noFilterNoise(ch.sel.filter as unknown as Record<string, unknown>), { colors: ["Blue"], characters: [who], powerMin: 20000, powerMax: 20000 }, `${who}: blue with 20000 power`);
  }
  if (b.op !== "choose" || !("side" in b.sel)) throw new Error("a description");
  assert.deepEqual(b.sel.notIn, ["c0"], "a card of its own");
  assert.deepEqual([ma, mb].map((m) => m.op === "moveTo" && m.to), ["hand", "hand"]);
  assert.equal(shuffle.op, "shuffle");
  assert.ok(reduce.op === "costReduction" && reduce.uses === 1 && reduce.until === "turn" && reduce.amount === 2, "{u}{1}, once, this turn");
}
{
  const r = only(card("EX25-11", { type: "Z-EXTRA", skill: EX25_11_F10 }));
  assert.deepEqual(r.unread, [], "EX25-11 front#10: nothing unread");
  const [a, b, pa, pb, reduce] = r.ops;
  for (const [ch, who] of [[a, "kale"], [b, "caulifla"]] as const) {
    if (ch.op !== "choose" || !("side" in ch.sel)) throw new Error("a description");
    assert.equal(ch.sel.area, "drop", `${who}: from your Drop`);
    assert.equal(ch.sel.upTo, true);
    assert.deepEqual(noFilterNoise(ch.sel.filter as unknown as Record<string, unknown>), { characters: [who], powerMin: 9000, powerMax: 9000 }, `${who}: with 9000 power`);
    assert.equal(ch.sel.mode, undefined, "\"in Rest Mode\" is how it is played, not a mode the Drop card is in");
  }
  assert.deepEqual([pa, pb].map((p) => p.op === "play" && p.mode), ["rest", "rest"], "each played in Rest Mode");
  assert.ok(reduce.op === "costReduction" && reduce.uses === 1 && reduce.until === "turn", "the one-use reduction");
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

function take(s: VmState, action: Action): VmState {
  return roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
}
/** `turn`'s Main Phase, hands and energy emptied back into the decks; the seat's Leader is `leader`. */
function fresh(seat: PlayerId, turn: PlayerId, seed: number, leader: string): VmState {
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
    ...(turn === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[])
    s = take(s, action);
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  staged.clear();
  return s;
}
const staged = new Set<string>();
function stage(s: VmState, p: PlayerId, def: string, area: string, markers?: number): string {
  // A card staged in the deck stays where it is, so the next one is a different card.
  const deck = s.sides[p].zones.deck;
  const id = area === "deck" ? deck.find((c) => !staged.has(c))! : deck.at(-1)!;
  staged.add(id);
  s.cards[id].cardId = def;
  if (area !== "deck") assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy" || area === "unison") s.cards[id].mode = "active";
  if (markers !== undefined) s.cards[id].markers = markers;
  s.pending = [];
  return id;
}
const lineOf = (def: string, pred: (sk: ReturnType<typeof parseSkills>[number]) => boolean) => parseSkills(defs[def].skill!).find(pred)!.index;
const unionLine = (def: string) => lineOf(def, (sk) => sk.keyword?.name === "Union");
const activateLine = (def: string) => lineOf(def, (sk) => sk.kind.startsWith("activate"));
const offer = (s: VmState, c: string, skill: number) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === skill);
const rested = (s: VmState, p: PlayerId) => s.sides[p].zones.energy.filter((c) => s.cards[c].mode === "rest").length;
const pending = (s: VmState, master?: PlayerId) => s.effects.filter((e) => e.kind === "skillCost" && e.matching && (!master || e.master === master));

/** Answer every question (the first candidates, the first option) until `who` is back at the Main Phase. */
function settle(s0: VmState, pick: (q: Extract<VmState["prompt"], { kind: "chooseCards" }>) => string[] = (q) => q.choice.candidates.slice(0, Math.max(1, q.choice.min))): VmState {
  let s = s0;
  for (let i = 0; i < 40 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: pick(q) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.equal(s.prompt.kind, "main", `back at the Main Phase (at ${s.prompt.kind})`);
  return s;
}
/** Take a [Union] line and settle it; how many of the seat's energy it rested. */
function union(s: VmState, seat: PlayerId, u: string, line: number, what: string): { s: VmState; paid: number } {
  const before = rested(s, seat);
  const a = offer(s, u, line);
  assert.ok(a, `${seat}: ${what} is offered`);
  const d = settle(take(s, a.action));
  assert.ok(d.sides[seat].zones.battle.includes(u), `${seat}: ${what} is played`);
  return { s: d, paid: rested(d, seat) - before };
}
/** A green <Gogeta: GT> and its two materials in the seat's hand; the Gogeta. */
function gogetaInHand(s: VmState, seat: PlayerId): string {
  const g = stage(s, seat, "GOG", "hand");
  stage(s, seat, "GOKU", "hand");
  stage(s, seat, "VEGETA", "hand");
  return g;
}

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 9310 + n * 2 + (seat === "p1" ? 0 : 1);

  // ── BT31-043 front#20 ──
  // (a) Its own last marker taken off (21-9-2): it leaves, the [Auto] fires, the next green Gogeta's
  // [Union] is reduced by {1} and the one after it is not. Before it leaves, nothing is reduced.
  {
    let s = fresh(seat, seat, seed(0), "L-GRN");
    for (let i = 0; i < 9; i++) stage(s, seat, "G-E", "energy");
    const pan = stage(s, seat, "PAN", "unison", 1);
    const before = gogetaInHand(s, seat);
    const plain = union(s, seat, before, unionLine("GOG"), "a green Gogeta while Pan is still in the Unison Area");
    assert.equal(plain.paid, 3, "nothing reduced yet: the full three");
    s = plain.s;
    const a = offer(s, pan, activateLine("PAN"));
    assert.ok(a, `${seat}: Pan's [-1] line is offered`);
    s = settle(take(s, a.action));
    assert.ok(!s.sides[seat].zones.unison.includes(pan) && s.sides[seat].zones.drop.includes(pan), "zero markers: Pan went to the Drop (21-9-2)");
    assert.equal(pending(s, seat).length, 1, "removed from the Unison Area: the reduction is pending");
    assert.equal(pending(s, seat)[0].until, "ownTurn");
    const first = union(s, seat, gogetaInHand(s, seat), unionLine("GOG"), "the next green Gogeta");
    assert.equal(first.paid, 2, "{g}{g}{1} less {1}: two energy");
    assert.equal(pending(first.s).length, 0, "used up");
    const second = union(first.s, seat, gogetaInHand(first.s, seat), unionLine("GOG"), "a second green Gogeta");
    assert.equal(second.paid, 3, "once only: the full three");
    cases++;
  }
  // (b) A new Unison played over it (13-2-1-3) sends it to the Drop: the same moment.
  {
    let s = fresh(seat, seat, seed(1), "L-GRN");
    for (let i = 0; i < 5; i++) stage(s, seat, "G-E", "energy");
    const pan = stage(s, seat, "PAN", "unison", 2);
    const uni = stage(s, seat, "UNI", "hand");
    const play = RULES.legalActions(ctx, s).find((l) => l.action.type === "playUnison" && l.action.card === uni && (l.action as { x?: number }).x === 1);
    assert.ok(play, `${seat}: the other Unison can be played with one marker`);
    s = settle(take(s, play.action));
    assert.ok(s.sides[seat].zones.unison.includes(uni) && s.sides[seat].zones.drop.includes(pan), "Pan was replaced and went to the Drop");
    assert.equal(pending(s, seat).length, 1, "the reduction is pending");
    const r = union(s, seat, gogetaInHand(s, seat), unionLine("GOG"), "a green Gogeta after the replacement");
    assert.equal(r.paid, 2, "reduced by {1}");
    cases++;
  }
  // (c) Removed on the OPPONENT's turn by their skill: "until the end of your turn" carries it
  // through to the seat's next turn, where it reduces once; an unused one ends with that turn.
  for (const use of [true, false]) {
    let s = fresh(seat, foe, seed(use ? 2 : 3), "L-GRN");
    const pan = stage(s, seat, "PAN", "unison", 3);
    stage(s, foe, "V-BLUE", "energy");
    const kick = stage(s, foe, "KICK", "battle");
    const a = offer(s, kick, activateLine("KICK"));
    assert.ok(a, `${foe}: the opponent's line is offered`);
    s = settle(take(s, a.action));
    assert.ok(s.sides[seat].zones.drop.includes(pan), "the opponent's skill sent Pan to the Drop");
    assert.equal(pending(s, seat).length, 1, "the seat's [Auto] resolved on the opponent's turn: pending");
    s = take(s, { type: "endMain", player: foe } as Action);
    assert.equal(pending(s, seat).length, 1, "the opponent's turn ended, not the seat's: still pending");
    if (s.prompt.kind === "charge") s = take(s, { type: "charge", player: seat, card: null } as Action);
    s = settle(s);
    assert.equal((s.prompt as { player: PlayerId }).player, seat, "the seat's own Main Phase");
    for (let i = 0; i < 3; i++) stage(s, seat, "G-E", "energy");
    if (use) {
      const r = union(s, seat, gogetaInHand(s, seat), unionLine("GOG"), "a green Gogeta on the seat's next turn");
      assert.equal(r.paid, 2, "reduced by {1} on the seat's own turn");
      assert.equal(pending(r.s).length, 0, "used up");
    } else {
      s = take(s, { type: "endMain", player: seat } as Action);
      assert.equal(pending(s, seat).length, 0, "unused, it ended with the end of the seat's turn");
    }
    cases++;
  }

  // ── EX23-11 front#10 ──
  {
    let s = fresh(seat, seat, seed(4), "L-MSG");
    for (let i = 0; i < 4; i++) stage(s, seat, "B-E", "energy");
    const ex = stage(s, seat, "EX2311", "battle");
    const fodder = stage(s, seat, "V1", "hand");
    const goku = stage(s, seat, "GOKU-B20", "deck");
    const goku15 = stage(s, seat, "GOKU-B15", "deck");
    const vegeta = stage(s, seat, "VEG-B20", "drop");
    const vegetaRed = stage(s, seat, "VEG-R20", "drop");
    const a = offer(s, ex, activateLine("EX2311"));
    assert.ok(a, `${seat}: EX23-11's [Activate: Main] is offered`);
    const asked: string[][] = [];
    s = settle(take(s, a.action), (q) => {
      asked.push(q.choice.candidates.slice().sort());
      return q.choice.candidates.slice(0, Math.max(1, q.choice.min));
    });
    assert.ok(s.sides[seat].zones.deck.includes(fodder), "the price: a card from the hand to the bottom of the deck");
    assert.ok(!s.sides[seat].zones.battle.includes(ex), "the price: it removed itself from the game");
    assert.ok(asked.some((c) => c.length === 1 && c[0] === goku), "Son Goku: only the blue 20000 one is offered (not the 15000 one)");
    assert.ok(asked.some((c) => c.length === 1 && c[0] === vegeta), "Vegeta: only the blue 20000 one in the Drop is offered (not the red one)");
    assert.ok(s.sides[seat].zones.hand.includes(goku), "the Son Goku from the deck is in the hand");
    assert.ok(s.sides[seat].zones.hand.includes(vegeta), "the Vegeta from the Drop is in the hand");
    assert.ok(s.sides[seat].zones.deck.includes(goku15) && s.sides[seat].zones.drop.includes(vegetaRed), "the others stay");
    assert.equal(pending(s, seat).length, 1, "the reduction is pending");
    // The [Union] on a blue <Gogeta> with an energy cost of 5, its materials the two just found.
    const gog = stage(s, seat, "GOG-B5", "hand");
    const first = union(s, seat, gog, unionLine("GOG-B5"), "the blue Gogeta");
    assert.equal(first.paid, 1, "{u}{u}{1} less {u}{1}: one energy");
    const gog2 = stage(first.s, seat, "GOG-B5", "hand");
    stage(first.s, seat, "GOKU-B20", "hand");
    stage(first.s, seat, "VEG-B20", "hand");
    const second = union(first.s, seat, gog2, unionLine("GOG-B5"), "a second blue Gogeta");
    assert.equal(second.paid, 3, "once only: the full three");
    cases++;
  }

  // ── EX25-11 front#10 ──
  {
    let s = fresh(seat, seat, seed(5), "L-KEF");
    for (let i = 0; i < 6; i++) stage(s, seat, "Y-E", "energy");
    const bonds = stage(s, seat, "EX2511", "battle");
    stage(s, seat, "V1", "hand");
    const kale = stage(s, seat, "KALE-9", "drop");
    const caul = stage(s, seat, "CAUL-9", "drop");
    const kale10 = stage(s, seat, "KALE-10", "drop");
    const a = offer(s, bonds, activateLine("EX2511"));
    assert.ok(a, `${seat}: EX25-11's [Activate: Main] is offered`);
    const asked: string[][] = [];
    s = settle(take(s, a.action), (q) => {
      asked.push(q.choice.candidates.slice().sort());
      return q.choice.candidates.slice(0, Math.max(1, q.choice.min));
    });
    assert.ok(asked.some((c) => c.length === 1 && c[0] === kale), "Kale: only the 9000 one is offered");
    for (const id of [kale, caul]) {
      assert.ok(s.sides[seat].zones.battle.includes(id), "played");
      assert.equal(s.cards[id].mode, "rest", "in Rest Mode");
    }
    assert.ok(s.sides[seat].zones.drop.includes(kale10), "the 10000 Kale stays in the Drop");
    assert.equal(rested(s, seat), 0, "played by the skill: no energy cost paid (5-5-3)");
    assert.equal(pending(s, seat).length, 1, "the reduction is pending");
    const kef = stage(s, seat, "KEFLA", "hand");
    // Materials of one power (22-13-4): the 9000 pair again, in the hand.
    stage(s, seat, "KALE-9", "hand");
    stage(s, seat, "CAUL-9", "hand");
    const first = union(s, seat, kef, unionLine("KEFLA"), "Kefla, Everlasting Light");
    assert.equal(first.paid, 2, "{y}{y}{1} less {y}: two energy");
    const kef2 = stage(first.s, seat, "KEFLA", "hand");
    stage(first.s, seat, "KALE-9", "hand");
    stage(first.s, seat, "CAUL-9", "hand");
    const second = union(first.s, seat, kef2, unionLine("KEFLA"), "a second Kefla");
    assert.equal(second.paid, 3, "once only: the full three");
    cases++;
  }
}

console.log(`union-reductions-rest-930: BT31-043 front#20 (removed from a Unison Area), EX23-11 front#10 (search), EX25-11 front#10 (play) — records and ${cases} both-seat reload cases`);
