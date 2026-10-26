/**
 * #930, the one-use "the next time you activate the [Union] skill …"
 * reductions (owner ruling of 25 Oct 2026):
 *
 *  - BT31-042 front#0 — Ultimate Fusion: "…and during the turn, the next time
 *    you activate the [union] skill on a green <Gogeta: GT> card from your
 *    hand, reduce the skill cost by {g}."
 *  - EX23-29 front#10 — Son Gohan, Rookie Support: "[activate: main][limit 1]
 *    If your Leader is a yellow <Gotenks: Adolescence> card, you have 3 or
 *    more energy, and you remove this card from the game: During that turn,
 *    the next time you activate the [union] skill on a yellow <Gotenks:
 *    Adolescence> card with an energy cost of 7 or less from your hand,
 *    reduce the skill cost by {y}{y}."
 *  (BT31-043 f#20, EX23-11 f#10 and EX25-11 f#10 print the same reduction;
 *  it is checked at the record level here, and their other clauses with it in
 *  the VM in `union-reductions-rest-930.ts`.)
 *
 * The ruling: the reduction waits for the NEXT [Union] activation this turn on
 * ANY card matching the description — a card that reaches the hand after the
 * effect resolved included — and that one payment uses it up. So it is one
 * pending change keyed by the description (`ContinuousEffect.matching`, put in
 * force by `vm/script.ts`' `costReduction`), read where a line's price is read
 * and spent (`vm/costs.ts`' `skillOrbs`, `spendSkillCostUses`, `onCard`), not
 * a change pinned to the cards in the hand when the skill resolved.
 *
 * Proved here, both seats, every step reloaded from JSON: a matching card
 * drawn after resolution is reduced; the reduction applies once only; a
 * non-matching card's [Union] and an ordinary play of a matching card do not
 * consume it; the opponent's matching card is not reduced; it ends with the
 * turn. Printed texts: docs/arena-backlog/evidence/923/inventory.json
 * (catalog snapshot of 15 Oct 2026).
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { parseSkills } from "../../src/lib/arena/text/cards";
import type { Action, CardDef, Color, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── printed texts ────────────────────────────────────────────────────────────
const BT31_042 =
  "[auto] [limit 1] Discard 1 card from your hand: When this card is placed in a Battle Area, add up to 1 mono-green <Gogeta: GT> card from your deck to your hand, then shuffle your deck, and during the turn, the next time you activate the [union] skill on a green <Gogeta: GT> card from your hand, reduce the skill cost by {g}.\n" +
  "[activate: battle] Remove this card from the game: Choose up to 1 of your green <Gogeta: GT> cards and it gets +10000 power for the battle.";
const BT31_043_F20 = "[auto] When this card is removed from a Unison Area, until the end of your turn, the next time you activate the [union] skill on a green <Gogeta: GT> card from your hand, reduce the skill cost by {1}.";
const EX23_11_F10 =
  "[activate: main][limit 1] If your Leader is {Miracle Strike Gogeta} or {SSB Gogeta, Miraculous Strongest Warrior}, you place 1 card from your hand at the bottom of your deck, and you remove this card from the game: Add up to 1 <Son Goku> card and 1 <Vegeta> card―both blue and with 20000 power―from among all cards in your deck and Drop to your hand, shuffle your deck if you looked through it, and during that turn, the next time you activate [union] on a blue <Gogeta> card in your hand with an energy cost of 5, reduce the skill cost by {u}{1}.";
const EX25_11_F10 =
  "[Activate: Main][Limit 1] If your Leader's back side is {Kefla, Surge of Ferocity} and you discard 1 card from your hand: Play up to 1 each of <Kale> and <Caulifla> cards with 9000 power in Rest Mode from your Drop, and the next time you activate the [Union] skill on {Kefla, Everlasting Light} from your hand during this turn, reduce the skill cost by {y}.";
const EX23_29 =
  "[auto][limit 1] If your Leader is a yellow <Gotenks: Adolescence> card and you discard 1 card from your hand: When this card is played, look at up to 7 cards from the top of your deck, play up to 1 <Son Goten: GT> or <Trunks: GT> card―both yellow and with an energy cost of 3 or less―, shuffle your deck, then at the end of the turn, add up to 1 Battle Card played by this skill to your hand.\n" +
  "[activate: main][limit 1] If your Leader is a yellow <Gotenks: Adolescence> card, you have 3 or more energy, and you remove this card from the game: During that turn, the next time you activate the [union] skill on a yellow <Gotenks: Adolescence> card with an energy cost of 7 or less from your hand, reduce the skill cost by {y}{y}.";
// EX23-36's Union-Fusion line (its other lines are not this suite's), and BT31-052's.
const EX23_36_FUSION = "[union-fusion]{y}{y}{y}, draw 1 card: Yellow <Son Goten: GT> card and yellow <Trunks: GT> card.";
// BT31-052 prints "Mono green" without the hyphen, which the material reader leaves unread (a separate gap,
// reported on #930); the hyphenated spelling is used here so the [Union] line itself can be played.
const BT31_052_FUSION = "[union-fusion] {g}{g}{1}, draw 1 card: Mono-green <Son Goku: GT> card and mono-green <Vegeta: GT> card.";

const mat = (id: string, colors: Color[], characters: string[], o: Partial<CardDef> = {}) => card(id, { colors, characters, power: 10000, energyCost: 1, skill: null, ...o });
const defs: Record<string, CardDef> = {
  ...DEFS,
  "L-GOT": card("L-GOT", { type: "LEADER", colors: ["Yellow"], characters: ["Gotenks: Adolescence"], power: 10000, energyCost: null, skill: null }),
  "L-GRN": card("L-GRN", { type: "LEADER", colors: ["Green"], characters: ["Gogeta: GT"], power: 10000, energyCost: null, skill: null }),
  EX2329: card("EX2329", { type: "Z-BATTLE", colors: ["Yellow"], characters: ["Son Gohan: GT"], traits: ["Saiyan", "Earthling"], energyCost: null, zEnergyCost: 1, power: 10000, skill: EX23_29 }),
  // The [Union] cards: a yellow <Gotenks: Adolescence> of cost 7 (EX23-36's Fusion), the same at cost 8 (no match),
  // a cheap one with the same line (played as an ordinary play), a green <Gogeta: GT> (BT31-052's Fusion).
  GOT7: card("GOT7", { colors: ["Yellow"], characters: ["Gotenks: Adolescence"], energyCost: 7, power: 35000, skill: EX23_36_FUSION }),
  GOT8: card("GOT8", { colors: ["Yellow"], characters: ["Gotenks: Adolescence"], energyCost: 8, power: 35000, skill: EX23_36_FUSION }),
  GOT1: card("GOT1", { colors: ["Yellow"], characters: ["Gotenks: Adolescence"], energyCost: 1, power: 15000, skill: EX23_36_FUSION }),
  GOG: card("GOG", { colors: ["Green"], characters: ["Gogeta: GT"], energyCost: 6, power: 35000, skill: BT31_052_FUSION }),
  // A yellow Gogeta with the same Fusion price: a [Union] on a card the words do not name.
  GOGY: card("GOGY", { colors: ["Yellow"], characters: ["Gogeta: GT"], energyCost: 6, power: 35000, skill: EX23_36_FUSION }),
  GOTEN: mat("GOTEN", ["Yellow"], ["Son Goten: GT"]),
  TRUNKS: mat("TRUNKS", ["Yellow"], ["Trunks: GT"]),
  GOKU: mat("GOKU", ["Green"], ["Son Goku: GT"]),
  VEGETA: mat("VEGETA", ["Green"], ["Vegeta: GT"]),
  "Y-E": mat("Y-E", ["Yellow"], ["Filler"]),
  "G-E": mat("G-E", ["Green"], ["Filler"]),
  ZX042: card("ZX042", { name: "Ultimate Fusion", type: "Z-EXTRA", colors: ["Green"], energyCost: 1, zEnergyCost: 1, power: null, comboCost: null, comboPower: null, characters: [], skill: BT31_042 }),
};

// ── 1. the readings ──────────────────────────────────────────────────────────
type Rec = ReturnType<typeof skillRecords>[number];
function reduction(rec: Rec, what: string, until: "turn" | "ownTurn" = "turn") {
  const op = rec.ops.at(-1)!;
  if (op.op !== "costReduction") throw new Error(`${what}: the last step is a costReduction`);
  assert.equal(op.what, "skill", `${what}: a skill cost`);
  assert.equal(op.tag, "union", `${what}: the [Union] line`);
  assert.equal(op.uses, 1, `${what}: one use`);
  assert.equal(op.until, until, `${what}: for the turn`);
  if (!op.target || !("sel" in op.target)) throw new Error(`${what}: a description`);
  assert.equal(op.target.sel.side, "you");
  assert.equal(op.target.sel.area, "hand", `${what}: "from your hand"`);
  assert.ok(!op.target.sel.special && !op.target.sel.fromVar, `${what}: a description, not a bound card`);
  return { op, filter: op.target.sel.filter! };
}
{
  const r042 = skillRecords(defs.ZX042).find((r) => r.skillIndex === 0)!;
  assert.deepEqual(r042.unread, [], "BT31-042 front#0: nothing unread");
  const a = reduction(r042, "BT31-042");
  assert.deepEqual(a.op.colors, ["Green"], "{g}");
  assert.deepEqual(a.filter.colors, ["Green"]);
  assert.deepEqual(a.filter.characters.map((c) => c.toLowerCase()), ["gogeta: gt"]);

  const r029 = skillRecords(defs.EX2329).find((r) => r.skillIndex === 10)!;
  assert.ok(r029, "EX23-29 front#10 exists");
  assert.deepEqual(r029.unread, [], "EX23-29 front#10: nothing unread");
  const b = reduction(r029, "EX23-29");
  assert.deepEqual(b.op.colors, ["Yellow", "Yellow"], "{y}{y}");
  assert.deepEqual(b.filter.colors, ["Yellow"]);
  assert.deepEqual(b.filter.characters.map((c) => c.toLowerCase()), ["gotenks: adolescence"]);
  assert.equal(b.filter.costMax, 7, "energy cost of 7 or less");

  // The other three: only the reduction is this suite's (their other clauses: `union-reductions-rest-930.ts`).
  // BT31-043 says "until the end of YOUR turn" (`ownTurn`).
  reduction(skillRecords(card("BT31-043", { skill: BT31_043_F20 }))[0], "BT31-043", "ownTurn");
  reduction(skillRecords(card("EX23-11", { skill: EX23_11_F10 }))[0], "EX23-11");
  reduction(skillRecords(card("EX25-11", { skill: EX25_11_F10 }))[0], "EX25-11");
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

function take(s: VmState, action: Action): VmState {
  return roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
}
function fresh(seat: PlayerId, seed: number, leader: string, z: string[] = []): VmState {
  const leaders = { p1: seat === "p1" ? leader : "L-BLUE", p2: seat === "p2" ? leader : "L-BLUE" };
  let s = RULES.createGame(ctx, {
    seed,
    p1: { name: "First", leader: leaders.p1, main: fifty("V1"), ...(seat === "p1" ? { z } : {}) },
    p2: { name: "Second", leader: leaders.p2, main: fifty("V-BLUE"), ...(seat === "p2" ? { z } : {}) },
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
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy") s.cards[id].mode = "active";
  return id;
}
const lineOf = (def: string, pred: (sk: ReturnType<typeof parseSkills>[number]) => boolean) => parseSkills(defs[def].skill!).find(pred)!.index;
const unionLine = (def: string) => lineOf(def, (sk) => sk.keyword?.name === "Union");
const offer = (s: VmState, c: string, skill: number) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === skill);
const playOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && l.action.card === c);
const rested = (s: VmState, p: PlayerId) => s.sides[p].zones.energy.filter((c) => s.cards[c].mode === "rest").length;
const pending = (s: VmState) => s.effects.filter((e) => e.kind === "skillCost" && e.matching);

function settle(s0: VmState, seat: PlayerId): VmState {
  let s = s0;
  for (let i = 0; i < 30 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: seat, index: 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: seat, option: 0 } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 } as Action);
    else s = take(s, { type: "pass", player: (q as { player: PlayerId }).player } as Action);
  }
  assert.equal(s.prompt.kind, "main", `back at the Main Phase (at ${s.prompt.kind})`);
  return s;
}
/** Take a [Union] line and settle it; how many of the seat's energy it rested. */
function union(s: VmState, seat: PlayerId, u: string, line: number, what: string): { s: VmState; paid: number } {
  const before = rested(s, seat);
  const a = offer(s, u, line);
  assert.ok(a, `${seat}: ${what} is offered`);
  const d = settle(take(s, a.action), seat);
  assert.ok(d.sides[seat].zones.battle.includes(u), `${seat}: ${what} is played`);
  return { s: d, paid: rested(d, seat) - before };
}

let cases = 0;
const EX29_LINE = lineOf("EX2329", (sk) => sk.kind.startsWith("activate"));
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);

  // ── EX23-29 front#10 ──
  /** Gohan in play, `energy` yellow energy, the materials for two Fusions in hand; `hand` staged too. */
  const board = (o: { energy?: number; hand?: string[]; foeHand?: string[] } = {}) => {
    const s = fresh(seat, 9930 + (seat === "p1" ? 0 : 1), "L-GOT");
    const gohan = stage(s, seat, "EX2329", "battle");
    for (let i = 0; i < (o.energy ?? 3); i++) stage(s, seat, "Y-E", "energy");
    for (let i = 0; i < 2; i++) {
      stage(s, seat, "GOTEN", "hand");
      stage(s, seat, "TRUNKS", "hand");
    }
    const hand = (o.hand ?? []).map((d) => stage(s, seat, d, "hand"));
    const foeHand = (o.foeHand ?? []).map((d) => stage(s, foe, d, "hand"));
    return { s, gohan, hand, foeHand };
  };
  /** Gohan's line, taken and settled: the reduction is pending. */
  const gohan = (b: ReturnType<typeof board>): VmState => {
    const a = offer(b.s, b.gohan, EX29_LINE);
    assert.ok(a, `${seat}: EX23-29's [Activate: Main] is offered`);
    const d = settle(take(b.s, a.action), seat);
    assert.ok(!d.sides[seat].zones.battle.includes(b.gohan), "Gohan removed himself from the game (the price)");
    assert.equal(rested(d, seat), 0, "the line's price is no energy");
    assert.equal(pending(d).length, 1, "one pending reduction, keyed by the description");
    assert.equal(pending(d)[0].target, "", "…pinned to no card");
    return d;
  };

  // (a) A matching card that reaches the hand after the skill resolved is reduced.
  {
    const b = board();
    let s = gohan(b);
    const got = stage(s, seat, "GOT7", "hand");
    const r = union(s, seat, got, unionLine("GOT7"), "the Gotenks drawn afterwards");
    assert.equal(r.paid, 1, "{y}{y}{y} less {y}{y}: one energy");
    assert.equal(pending(r.s).length, 0, "the payment used the reduction up");
    s = r.s;
    cases++;
  }
  // (b) Once only: the second matching [Union] this turn pays in full.
  {
    const b = board({ energy: 4, hand: ["GOT7", "GOT7"] });
    const s = gohan(b);
    const first = union(s, seat, b.hand[0], unionLine("GOT7"), "the first Gotenks");
    assert.equal(first.paid, 1, "the first: one energy");
    const second = union(first.s, seat, b.hand[1], unionLine("GOT7"), "the second Gotenks");
    assert.equal(second.paid, 3, "the second: the full three");
    cases++;
  }
  // (c) A non-matching card's [Union] does not consume it: cost 8 (not "7 or less"), and a yellow Gogeta.
  {
    const b = board({ energy: 7, hand: ["GOT8", "GOGY"] });
    let s = gohan(b);
    const eight = union(s, seat, b.hand[0], unionLine("GOT8"), "the cost-8 Gotenks");
    assert.equal(eight.paid, 3, "cost 8 is not 7 or less: the full three");
    assert.equal(pending(eight.s).length, 1, "…and the reduction still waits");
    s = eight.s;
    // GOGY's Fusion needs Goten and Trunks too: the second pair is in hand.
    const gog = union(s, seat, b.hand[1], unionLine("GOGY"), "the yellow Gogeta");
    assert.equal(gog.paid, 3, "a Gogeta is no Gotenks: the full three");
    assert.equal(pending(gog.s).length, 1, "…and the reduction still waits");
    cases++;
  }
  // (d) An ordinary play of a matching card does not consume it; the [Union] after it is reduced.
  {
    const b = board({ energy: 3, hand: ["GOT1", "GOT7"] });
    let s = gohan(b);
    const p = playOf(s, b.hand[0]);
    assert.ok(p, `${seat}: the cost-1 Gotenks is playable`);
    s = settle(take(s, p.action), seat);
    assert.ok(s.sides[seat].zones.battle.includes(b.hand[0]), "played");
    assert.equal(rested(s, seat), 1, "its energy cost, one");
    assert.equal(pending(s).length, 1, "an ordinary play is no [Union] activation: the reduction still waits");
    const r = union(s, seat, b.hand[1], unionLine("GOT7"), "the Gotenks after the ordinary play");
    assert.equal(r.paid, 1, "…and reduces the next [Union]");
    cases++;
  }
  // (e) The opponent's matching card is not reduced ("your hand"), and the pending change does not touch it.
  {
    const b = board({ foeHand: ["GOT7"] });
    const s = gohan(b);
    const foeLine = unionLine("GOT7");
    assert.equal(offer(s, b.foeHand[0], foeLine), undefined, "not the opponent's turn: nothing offered to them");
    assert.equal(pending(s)[0].master, seat, "the pending reduction is the seat's");
    cases++;
  }
  // (f) It ends with the turn: on the next turn a matching [Union] pays in full.
  {
    const b = board({ energy: 3 });
    let s = gohan(b);
    s = take(s, { type: "endMain", player: seat } as Action);
    assert.equal(pending(s).length, 0, "the turn ended: the unused reduction ended with it");
    s = settle(s, foe);
    s = take(s, { type: "endMain", player: foe } as Action);
    if (s.prompt.kind === "charge") s = take(s, { type: "charge", player: seat, card: null } as Action);
    s = settle(s, seat);
    assert.equal((s.prompt as { player: PlayerId }).player, seat, "the seat's next Main Phase");
    for (const id of s.sides[seat].zones.energy) s.cards[id].mode = "active";
    const got = stage(s, seat, "GOT7", "hand");
    const r = union(s, seat, got, unionLine("GOT7"), "the Gotenks a turn later");
    assert.equal(r.paid, 3, "the full three");
    cases++;
  }

  // ── BT31-042 front#0 ──
  {
    // Ultimate Fusion placed from the Z-Deck (one Z-Energy, one energy); its [Auto] discards the one card in hand.
    // The deck holds no mono-green <Gogeta: GT>, so the search finds nothing: every Gogeta below reaches the hand afterwards.
    let s = fresh(seat, 9940 + (seat === "p1" ? 0 : 1), "L-GRN", ["ZX042"]);
    const zx = s.sides[seat].zones.zDeck[0];
    for (let i = 0; i < 7; i++) stage(s, seat, "G-E", "energy");
    stage(s, seat, "G-E", "zEnergy");
    const fodder = stage(s, seat, "V1", "hand");
    const z = RULES.legalActions(ctx, s).find((l) => l.action.type === "playZ" && l.action.card === zx);
    assert.ok(z, `${seat}: Ultimate Fusion can be placed`);
    s = settle(take(s, z.action), seat);
    assert.ok(s.sides[seat].zones.battle.includes(zx), "placed in the Battle Area");
    assert.ok(s.sides[seat].zones.drop.includes(fodder), "the [Auto]'s price: one card discarded");
    assert.equal(pending(s).length, 1, "one pending reduction");
    const spent = rested(s, seat);
    // (a) drawn afterwards: {g}{g}{1} less {g}.
    const gog1 = stage(s, seat, "GOG", "hand");
    stage(s, seat, "GOKU", "hand");
    stage(s, seat, "VEGETA", "hand");
    const first = union(s, seat, gog1, unionLine("GOG"), "the green Gogeta drawn afterwards");
    assert.equal(first.paid, 2, "{g}{g}{1} less {g}: two energy");
    assert.equal(pending(first.s).length, 0, "used up");
    // (b) once only.
    s = first.s;
    const gog2 = stage(s, seat, "GOG", "hand");
    stage(s, seat, "GOKU", "hand");
    stage(s, seat, "VEGETA", "hand");
    const second = union(s, seat, gog2, unionLine("GOG"), "a second green Gogeta");
    assert.equal(second.paid, 3, "the second pays the full three");
    assert.equal(rested(second.s, seat), spent + 5);
    cases += 2;
  }
}

console.log(`union-next-time-930: BT31-042 front#0, EX23-29 front#10 — pending one-use [Union] reductions, ${cases} both-seat reload cases`);
