/**
 * #930: the Union support that was left unread — printed text -> skills ->
 * stored-row JSON round trip -> the real VM, both seats, every step reloaded.
 *
 *  1. [Union-Absorb] pays its printed cost (22-13-6-1, "skill cost : effect"):
 *     BT3-070's "{g}, choose 1 each of <Android 14> and <Android 15> from your
 *     Drop Area and place them under this card" (after the official errata of
 *     2018-03-02, "choose up to 1 each" -> "choose 1 each"), BT3-020 and BT3-022
 *     (same wording), BT3-048 ("place 1 Battle Card from your hand under this
 *     card"), a Leader-conditioned cost (BT17-067).
 *  2. [Union-Potara] area extensions (22-13-5-2-1, 22-13-5-2-1-1): BT10-046 /
 *     BT10-053 / P-220 choose Battle Cards in the energy, BT10-132 / P-230 in the
 *     Warp; the chosen card is moved to the Battle Area first, without area
 *     movement triggers and without a counter window.
 *  3. [Union-Fusion] Warp permission printed without the "place in Drop" half
 *     (EX25-32, P-308, BT10-132-style wording).
 *  4. P-360's "Red <Gogeta: Br> cards in your hand gain the following skill:
 *     [union-fusion]{r}{u}{2}: <Son Goku: Br> and <Vegeta: Br>."
 *
 * Sources: docs/rules/rulemanual.txt 22-13-4 .. 22-13-6; the card FAQ has no
 * per-card ruling for these; labelled best guesses are named where used.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { compileCostProgram } from "../../src/lib/arena/compile";
import { describeScript } from "../../src/lib/arena/vm/script";
import { correctSkillText } from "../../src/lib/catalog/errata";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { GRANTED_LINE_BASE } from "../../src/lib/arena/vm/common";
import type { Action, CardDef, Color, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const BT3_070 = "[union absorb] {g} , choose 1 each of <Android 14> and <Android 15> from your Drop Area and place them under this card: Choose up to 1 <Android 13> with an energy cost of 7 from your deck and play it on top of this card. Then, shuffle your deck.";
const BT3_048 = "[union absorb]{u},place 1 Battle Card from your hand under this card: Choose up to 1 blue <Majin Buu> with an energy cost of 5 from your deck and place it on top of this card. Then, shuffle your deck.";
const BT17_067 = "[union absorb][once per turn]{1}, if your Leader Card is a ≪Namekian≫ card and you choose 1 ≪Namekian≫ card in your hand or Battle Area and place it under this card: Play up to 1 yellow <Piccolo> card with an energy cost of 3 from your deck or hand on top of this card, then shuffle your deck if you looked through it.";

// The printed [Permanent]s (docs/arena-backlog/evidence/923/cards.md).
const PERM_ENERGY4 = "[Permanent] If you have 4 or more energy, you can choose Battle Cards in your energy when choosing cards to use with this card's [Union] skill from your hand.";
const PERM_ENERGY = "[Permanent] You can choose Battle Cards in your energy when choosing cards to use with this card's [Union] skill from your hand.";
const PERM_WARP = "[Permanent] You can choose Battle Cards in your Warp when choosing cards to use with this card's [Union] skill from your hand.";
// P-360's back-face [Permanent]; it sits on a Leader's front here, where the same standing text is read.
const P360_GRANT = "[permanent] Red <Gogeta: Br> cards in your hand gain the following skill: ・[union-fusion]{r}{u}{2}: <Son Goku: Br> and <Vegeta: Br>.";
const POT = "[Union-Potara] Blue <Son Goku> and blue <Vegeta>";
const POT_ENERGY4 = POT + "\n" + PERM_ENERGY4;
const POT_ENERGY = POT + "\n" + PERM_ENERGY;
const POT_WARP = POT + "\n" + PERM_WARP;
// EX25-32 and P-308 print their Warp permission with a different tail than BT12-136; the
// Union lines below are simplified (no Leader / opponent-energy condition) to keep the proof on the permission.
const PERM_EX25_32 = "[Permanent] You can choose Battle Cards in your Warp when choosing cards to use with this card's [Union] skill from your hand. If you do, place the chosen cards from your Warp into their owner's Drop.";
const PERM_P308 = "[permanent] You can choose Battle Cards in your Warp when choosing cards to use with this card's [union] skill from your hand. If you do, place the chosen cards from your Warp in your Drop Area.";
const FUSION_WARP_EX25_32 = "[Union-Fusion]{u}: <Son Goku: Xeno> card and <Vegeta: Xeno> card.\n" + PERM_EX25_32;
const FUSION_WARP_P308 = "[union-fusion]{u}: <Son Goku: Xeno> and <Vegeta: Xeno>.\n" + PERM_P308;

const BT14_079 = "[union absorb][once per turn] Choose 1 card under your ≪Majin≫ Leader Card and place it under this card: Play up to 1 mono-green <Majin Buu> card with an energy cost of 4 and 15000 power from your deck or Drop Area on top of this card, then shuffle your deck if you looked through it.";

const mat = (id: string, colors: Color[], characters: string[], o: Partial<CardDef> = {}) => card(id, { colors, characters, power: 10000, energyCost: 1, skill: null, ...o });

const defs: Record<string, CardDef> = { ...DEFS,
  // Absorbers (the printed lines of the cards named in the comments).
  "BT3070": card("BT3070", { colors: ["Green"], characters: ["Android 13"], energyCost: 5, power: 20000, skill: BT3_070 }),
  "BT3048": card("BT3048", { colors: ["Blue"], characters: ["Majin Buu"], energyCost: 3, power: 20000, skill: BT3_048 }),
  "BT17067": card("BT17067", { colors: ["Yellow"], characters: ["Piccolo"], traits: ["Namekian"], energyCost: 2, power: 10000, skill: BT17_067 }),
  // Materials and targets.
  "A14": mat("A14", ["Green"], ["Android 14"]), "A15": mat("A15", ["Green"], ["Android 15"]),
  "A13": mat("A13", ["Green"], ["Android 13"], { energyCost: 7, power: 30000 }),
  "BUU5": mat("BUU5", ["Blue"], ["Majin Buu"], { energyCost: 5, power: 25000 }),
  "PIC3": mat("PIC3", ["Yellow"], ["Piccolo"], { energyCost: 3, power: 20000 }),
  "NAM": mat("NAM", ["Yellow"], ["Dende"], { traits: ["Namekian"] }),
  "FIL": mat("FIL", ["Green"], ["Filler"]), "FILU": mat("FILU", ["Blue"], ["Filler"]), "FILY": mat("FILY", ["Yellow"], ["Filler"]),
  // [Union-Potara] cards with an area-extension [Permanent] (the printed lines of the cards named).
  "BT10046": card("BT10046", { colors: ["Blue"], characters: ["Vegito"], energyCost: 6, power: 30000, skill: POT_ENERGY4 }),
  "P220": card("P220", { colors: ["Blue"], characters: ["Vegito"], energyCost: 6, power: 30000, skill: POT_ENERGY }),
  "BT10132": card("BT10132", { colors: ["Blue"], characters: ["Vegeks"], energyCost: 6, power: 30000, skill: POT_WARP }),
  "NOEXT": card("NOEXT", { colors: ["Blue"], characters: ["Vegito"], energyCost: 6, power: 30000, skill: "[Union-Potara] Blue <Son Goku> and blue <Vegeta>" }),
  "GOK": mat("GOK", ["Blue"], ["Son Goku"]), "VEG": mat("VEG", ["Blue"], ["Vegeta"]), "VEGR": mat("VEGR", ["Red"], ["Vegeta"]),
  "XGOK": mat("XGOK", ["Blue"], ["Son Goku: Xeno"], { power: 5000 }), "XVEG": mat("XVEG", ["Blue"], ["Vegeta: Xeno"], { power: 5000 }),
  "EXTRA-GOK": mat("EXTRA-GOK", ["Blue"], ["Son Goku"], { type: "EXTRA" }),
  "WATCH": card("WATCH", { colors: ["Blue"], characters: ["Watcher"], power: 10000, energyCost: 1, skill: "[Auto] When a card is placed in your Battle Area, draw 1 card." }),
  "EX2532": card("EX2532", { colors: ["Blue"], characters: ["Gogeta: Xeno"], energyCost: 6, power: 30000, skill: FUSION_WARP_EX25_32 }),
  "P308": card("P308", { colors: ["Blue"], characters: ["Gogeta: Xeno"], energyCost: 6, power: 30000, skill: FUSION_WARP_P308 }),
  "L-GRANT": card("L-GRANT", { type: "LEADER", colors: ["Red"], characters: ["Vegeta: Br"], power: 0, energyCost: 0, skill: P360_GRANT }),
  "GOGB": card("GOGB", { colors: ["Red"], characters: ["Gogeta: Br"], energyCost: 6, power: 30000, skill: null }),
  "GOGBLUE": card("GOGBLUE", { colors: ["Blue"], characters: ["Gogeta: Br"], energyCost: 6, power: 30000, skill: null }),
  "GOGXENO": card("GOGXENO", { colors: ["Red"], characters: ["Gogeta: Xeno"], energyCost: 6, power: 30000, skill: null }),
  "SGKB": mat("SGKB", ["Red"], ["Son Goku: Br"], { power: 10000 }), "VGB": mat("VGB", ["Red"], ["Vegeta: Br"], { power: 10000 }), "VGB2": mat("VGB2", ["Red"], ["Vegeta: Br"], { power: 15000 }),
  "FILR": mat("FILR", ["Red"], ["Filler"]),
  "BT14079": card("BT14079", { colors: ["Green"], characters: ["Majin Buu"], energyCost: 3, power: 10000, skill: BT14_079 }),
  "BUUG4": mat("BUUG4", ["Green"], ["Majin Buu"], { energyCost: 4, power: 15000 }),
  "L-MAJIN": card("L-MAJIN", { type: "LEADER", colors: ["Green"], characters: ["Majin Buu"], traits: ["Majin"], power: 0, energyCost: 0, skill: null }),
  "L-NAM": card("L-NAM", { type: "LEADER", colors: ["Yellow"], characters: ["Piccolo"], traits: ["Namekian"], power: 0, energyCost: 0, skill: null }),
};

// ── 1. the readings ──────────────────────────────────────────────────────────
{
  const program = (text: string) => {
    const p = compileCostProgram(parseSkills(text)[0]);
    return p ? describeScript(p.ops) : null;
  };
  assert.equal(program(BT3_070), "choose 1 <android 14> card in your Drop Area, move the chosen cards to under, choose 1 <android 15> card in your Drop Area, move the chosen cards to under", "BT3-070: both named cards, required, each placed under this card");
  assert.equal(program("[Union Absorb] Choose 1 each of <Bizu> and <Ribet> from your hand or Battle Area and place them under this card: Play it."), "choose 1 <bizu> card in your hand or Battle Area, move the chosen cards to under, choose 1 <ribet> card in your hand or Battle Area, move the chosen cards to under", "BT3-022");
  assert.match(program("[Union Absorb] Choose 1 each of <Nezi>, <Natt>, <Bizu>, and <Ribet> from your Drop Area and place them under this card: Play it.")!, /nezi.*natt.*bizu.*ribet/, "BT3-020: four names");
  // The pre-errata "up to" print is a different, optional wording and keeps its own reading.
  assert.equal(correctSkillText("BT3-070", "[union absorb] {g} , choose up to 1 each of <Android 14> and <Android 15> from your Drop Area and place them under this card: Play it."), "[union absorb] {g} , choose 1 each of <Android 14> and <Android 15> from your Drop Area and place them under this card: Play it.");
  assert.equal(program("[Union Absorb] Choose 1 each of <A> and <A> from your Drop Area and place them under this card: Play it."), null, "the same name twice is not read");
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
for (const id of ["BT3070", "BT3048", "BT17067"]) {
  const rec = skillRecords(defs[id])[0];
  assert.deepEqual(rec.unread, [], `${id}: nothing unread`);
  assert.ok(rec.cost?.program?.length, `${id}: the cost has a program`);
}
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

function take(s: VmState, action: Action): { s: VmState } {
  const r = RULES.apply(ctx, roundtrip(s), action);
  return { s: roundtrip(r.state as VmState) };
}
function fresh(seat: PlayerId, seed = 930, leader = "L-RED"): VmState {
  const leaders = { p1: seat === "p1" ? leader : "L-BLUE", p2: seat === "p2" ? leader : "L-BLUE" };
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
const unionIndex = (s: VmState, id: string) => parseSkills(defs[s.cards[id].cardId].skill!).find((sk) => sk.keyword?.name === "Union")!.index;
const offer = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === unionIndex(s, c));
const why = (s: VmState, c: string) => RULES.rejectedActions(ctx, s, RULES.legalActions(ctx, s)).find((r) => r.action.type === "activate" && r.action.card === c && r.action.skill === unionIndex(s, c))?.why ?? [];
const count = (s: VmState, p: PlayerId, area: string) => s.sides[p].zones[area].length;

function settle(s0: VmState, seat: PlayerId, pick: (candidates: string[], min: number) => string[] = (cs, min) => cs.slice(0, Math.max(1, min))): VmState {
  let r = { s: s0 };
  for (let i = 0; i < 20 && r.s.prompt.kind !== "main"; i++) {
    const q = r.s.prompt;
    if (q.kind === "chooseMode") r = take(r.s, { type: "chooseMode", player: seat, index: 0 } as Action);
    else if (q.kind === "payCost") r = take(r.s, { type: "payCost", player: seat, option: 0 } as Action);
    else if (q.kind === "chooseCards") r = take(r.s, { type: "choose", player: q.player, cards: pick(q.choice.candidates, q.choice.min) });
    else if (q.kind === "orderPending") r = take(r.s, { type: "orderPending", player: q.player, index: 0 } as Action);
    else r = take(r.s, { type: "pass", player: (q as { player: PlayerId }).player } as Action);
  }
  assert.equal(r.s.prompt.kind, "main");
  return r.s;
}
/** Declare the line and answer every prompt with the first candidates, reloading the state at each step. */
const run = (s: VmState, seat: PlayerId, c: string, pick?: (candidates: string[], min: number) => string[]): VmState => settle(take(s, offer(s, c)!.action).s, seat, pick);

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);

  // ── BT3-070 ──
  {
    const board = (o: { drop?: string[]; hand?: string[]; energy?: number; deck?: boolean } = {}) => {
      const s = fresh(seat, 9300);
      const abs = stage(s, seat, "BT3070", "battle");
      const drop = (o.drop ?? ["A14", "A15"]).map((d) => stage(s, seat, d, "drop"));
      const hand = (o.hand ?? []).map((d) => stage(s, seat, d, "hand"));
      for (let i = 0; i < (o.energy ?? 1); i++) stage(s, seat, "FIL", "energy");
      const target = o.deck === false ? null : stage(s, seat, "A13", "deck");
      return { s, abs, drop, hand, target };
    };
    const ok = board();
    assert.ok(offer(ok.s, ok.abs), `${seat}: BT3-070 is offered with both Androids in the Drop, an orb and a target in the deck`);
    assert.equal(offer(board({ drop: ["A14"] }).s, ok.abs), undefined, "one Android is not the pair");
    assert.equal(offer(board({ drop: ["A14", "A14"] }).s, ok.abs), undefined, "two Android 14s are not an Android 14 and an Android 15");
    const inHand = board({ drop: [], hand: ["A14", "A15"] });
    assert.equal(offer(inHand.s, inHand.abs), undefined, "the pair in the hand is not the Drop Area");
    const noOrb = board({ energy: 0 });
    assert.equal(offer(noOrb.s, noOrb.abs), undefined, "no orb, no activation");
    assert.deepEqual(why(board({ drop: ["A14"] }).s, ok.abs).length > 0, true, "and it says why");
    assert.throws(() => RULES.apply(ctx, roundtrip(board({ drop: ["A14"] }).s), { type: "activate", player: seat, card: ok.abs, skill: 0 } as Action), IllegalAction, "a forged declaration is refused");

    const done = run(ok.s, seat, ok.abs);
    const top = done.sides[seat].zones.battle.find((c) => done.cards[c].cardId === "A13");
    assert.ok(top, "Android 13 is played");
    assert.ok(!done.sides[seat].zones.battle.includes(ok.abs), "the absorber is no longer on top");
    assert.deepEqual(new Set(done.cards[top!].under), new Set([...ok.drop, ok.abs]), "both materials and the absorber are under the new card");
    assert.equal(count(done, seat, "drop"), 0, "the Drop gave both materials");
    assert.equal(done.sides[seat].zones.energy.filter((c) => done.cards[c].mode === "rest").length, 1, "the printed orb is paid");
    assert.equal(count(done, foe, "hand"), count(ok.s, foe, "hand"), "nothing happens to the opponent");

    // The pair is asked one name at a time and nothing else is offered: the
    // first prompt holds the Android 14s only, the second the Android 15s only.
    {
      const b = board({ drop: ["A14", "A15", "A14", "A15"] });
      let r = take(b.s, offer(b.s, b.abs)!.action);
      while (r.s.prompt.kind === "payCost") r = take(r.s, { type: "payCost", player: seat, option: 0 } as Action);
      const q1 = r.s.prompt;
      assert.equal(q1.kind, "chooseCards");
      if (q1.kind !== "chooseCards") throw new Error("unreachable");
      assert.deepEqual(q1.choice.candidates.map((c) => r.s.cards[c].cardId), ["A14", "A14"], "first the Android 14");
      assert.throws(() => take(r.s, { type: "choose", player: q1.player, cards: [b.drop[1]] }), IllegalAction, "an Android 15 is no Android 14");
      assert.throws(() => take(r.s, { type: "choose", player: q1.player, cards: [b.hand[0] ?? "nope"] }), "a card that is not a candidate is refused");
      r = take(r.s, { type: "choose", player: q1.player, cards: [b.drop[2]] });
      const q2 = r.s.prompt;
      assert.equal(q2.kind, "chooseCards");
      if (q2.kind !== "chooseCards") throw new Error("unreachable");
      assert.deepEqual(q2.choice.candidates.map((c) => r.s.cards[c].cardId), ["A15", "A15"], "then the Android 15");
      r = take(r.s, { type: "choose", player: q2.player, cards: [b.drop[1]] });
      r = { s: settle(r.s, seat) };
      const top = r.s.sides[seat].zones.battle.find((c) => r.s.cards[c].cardId === "A13")!;
      assert.deepEqual(new Set(r.s.cards[top].under), new Set([b.abs, b.drop[2], b.drop[1]]), "the cards picked go under, the others stay");
      assert.deepEqual(new Set(r.s.sides[seat].zones.drop), new Set([b.drop[0], b.drop[3]]), "the unchosen Androids stay in the Drop");
    }
  }

  // ── BT3-048: "place 1 Battle Card from your hand under this card", effect "place it on top" ──
  {
    const board = (o: { hand?: string[]; energy?: number } = {}) => {
      const s = fresh(seat, 9301);
      const abs = stage(s, seat, "BT3048", "battle");
      const hand = (o.hand ?? ["FIL"]).map((d) => stage(s, seat, d, "hand"));
      for (let i = 0; i < (o.energy ?? 1); i++) stage(s, seat, "FILU", "energy");
      const target = stage(s, seat, "BUU5", "deck");
      return { s, abs, hand, target };
    };
    const ok = board();
    assert.ok(offer(ok.s, ok.abs), `${seat}: BT3-048 is offered with a card in hand to place`);
    const empty = board({ hand: [] });
    assert.equal(offer(empty.s, empty.abs), undefined, "an empty hand cannot pay 'place 1 Battle Card from your hand'");
    const done = run(ok.s, seat, ok.abs);
    const top = done.sides[seat].zones.battle.find((c) => done.cards[c].cardId === "BUU5");
    assert.ok(top, "the Majin Buu is played");
    assert.deepEqual(new Set(done.cards[top!].under), new Set([ok.abs, ok.hand[0]]), "the absorber and the placed card are under it");
    assert.ok(!done.sides[seat].zones.hand.includes(ok.hand[0]), "the placed card left the hand");
  }

  // ── BT17-067: a Leader condition beside the cost; the material comes from hand or Battle Area ──
  {
    const board = (o: { leader?: string; nam?: "hand" | "battle" | null } = {}) => {
      const s = fresh(seat, 9302, o.leader ?? "L-NAM");
      const abs = stage(s, seat, "BT17067", "battle");
      const nam = o.nam === null ? null : stage(s, seat, "NAM", o.nam ?? "hand");
      stage(s, seat, "FILY", "energy");
      const target = stage(s, seat, "PIC3", "deck");
      return { s, abs, nam, target };
    };
    const ok = board();
    assert.ok(offer(ok.s, ok.abs), `${seat}: BT17-067 is offered with a Namekian Leader and a Namekian in hand`);
    assert.ok(offer(board({ nam: "battle" }).s, ok.abs), "…or in the Battle Area");
    assert.equal(offer(board({ leader: "L-RED" }).s, ok.abs), undefined, "a non-Namekian Leader: the condition fails");
    assert.equal(offer(board({ nam: null }).s, ok.abs), undefined, "no Namekian to place");
    const done = run(ok.s, seat, ok.abs);
    const top = done.sides[seat].zones.battle.find((c) => done.cards[c].cardId === "PIC3");
    assert.ok(top, "the Piccolo is played on top");
    assert.deepEqual(new Set(done.cards[top!].under), new Set([ok.abs, ok.nam!]));
    // The absorber is the one card that cannot pay for itself: with it alone in play it is not a material.
    const alone = board({ nam: null });
    const abs2 = alone.abs; void abs2;
    assert.equal(offer(alone.s, alone.abs), undefined, "the absorbing Namekian cannot place itself under itself");
  }
}

// ── BT14-079: the cost is a card from under the Leader, placed under this card ──
for (const seat of ["p1", "p2"] as const) {
  const board = (o: { leader?: string; under?: boolean } = {}) => {
    const s = fresh(seat, 9307, o.leader ?? "L-MAJIN");
    const abs = stage(s, seat, "BT14079", "battle");
    const leader = s.sides[seat].zones.leader[0];
    const pile = o.under === false ? null : stage(s, seat, "FIL", "hand");
    if (pile) assert.ok(moveCard(s, game, pile, "x", { owner: seat, under: leader }).ok, "a card goes under the Leader");
    const target = stage(s, seat, "BUUG4", "deck");
    return { s, abs, leader, pile, target };
  };
  const ok = board();
  assert.deepEqual(ok.s.cards[ok.leader].under, [ok.pile], "staged: one card under the Leader");
  assert.ok(offer(ok.s, ok.abs), `${seat}: BT14-079 is offered with a card under a Majin Leader`);
  assert.equal(offer(board({ under: false }).s, ok.abs), undefined, "nothing under the Leader: the cost cannot be paid");
  const done = run(ok.s, seat, ok.abs);
  const top = done.sides[seat].zones.battle.find((c) => done.cards[c].cardId === "BUUG4");
  assert.ok(top, "the Majin Buu is played on top");
  assert.deepEqual(done.cards[ok.leader].under, [], "the Leader's pile gave the card");
  assert.deepEqual(new Set(done.cards[top!].under), new Set([ok.abs, ok.pile!]), "…and it went under the absorber, which is now under the new card");
}

// ── the permissions' readings ────────────────────────────────────────────────
{
  const ops = (text: string) => JSON.stringify(skillRecords(card("RD", { skill: text }))[0]?.ops);
  const e4 = skillRecords(card("RD", { skill: PERM_ENERGY4 }))[0];
  assert.deepEqual(roundtrip(e4.cond), { kind: "count", sel: { side: "you", area: "energy" }, atLeast: 4 }, "BT10-046: the energy count is the record's condition (9-1-3)");
  assert.match(ops(PERM_ENERGY4), /^\[\{"op":"permit","what":"unionEnergy"/);
  assert.match(ops(PERM_ENERGY), /^\[\{"op":"permit","what":"unionEnergy"/, "P-220: no condition");
  for (const t of [PERM_WARP, PERM_EX25_32, PERM_P308, "[permanent] You can choose Battle Cards in your Warp when choosing cards to use with this card's [union] skill from your hand. If you do, place the chosen cards in your Drop Area from your Warp."]) {
    assert.match(ops(t), /^\[\{"op":"permit","what":"unionFusionWarp"/, `a Warp permission: ${t.slice(0, 50)}…`);
  }
  assert.equal(skillRecords(card("RD", { skill: PERM_EX25_32 }))[0].unread.length, 0, "EX25-32: nothing unread");
  assert.doesNotMatch(ops("[Permanent] You can choose Battle Cards in your Drop when choosing cards to use with this card's [Union] skill from your hand."), /unionEnergy|unionFusionWarp/, "the Drop permissions stay unread (EX21-12, BT26-031 family)");
}

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);

  // ── [Union-Potara] energy extension (BT10-046 at 4+, P-220), 22-13-5-2-1 / 22-13-5-2-1-1 ──
  for (const [pot, energyWith] of [["BT10046", 4], ["P220", 1]] as const) {
    const board = (o: { gokIn?: "energy" | "battle" | "warp" | "hand"; vegIn?: "energy" | "battle"; vegDef?: string; energy?: number; gokDef?: string; foeEnergy?: boolean } = {}) => {
      const s = fresh(seat, 9303);
      const p = stage(s, seat, pot, "hand");
      const watch = stage(s, seat, "WATCH", "battle");
      const gok = stage(s, seat, o.gokDef ?? "GOK", o.gokIn ?? "energy");
      const veg = stage(s, seat, o.vegDef ?? "VEG", o.vegIn ?? "battle");
      const inEnergy = [gok, veg].filter((c) => s.sides[seat].zones.energy.includes(c)).length;
      for (let i = inEnergy; i < (o.energy ?? energyWith); i++) stage(s, seat, "FILU", "energy");
      if (o.foeEnergy) { for (let i = 0; i < 6; i++) stage(s, foe, "FILU", "energy"); const g = stage(s, foe, "GOK", "energy"); void g; }
      return { s, p, gok, veg, watch };
    };
    const ok = board();
    assert.ok(offer(ok.s, ok.p), `${seat}: ${pot} is offered with a Goku in the energy and a Vegeta in the Battle Area`);
    if (pot === "BT10046") {
      const three = board({ energy: 3 });
      assert.equal(offer(three.s, three.p), undefined, "BT10-046: with 3 energy the permission is off");
      assert.ok(why(three.s, three.p).length > 0, "…and says why");
      assert.ok(offer(board({ energy: 5 }).s, ok.p), "…5 energy: on");
    }
    assert.equal(offer(board({ gokIn: "battle" }).s, ok.p) !== undefined, true, "both in the Battle Area: the plain Potara still works");
    assert.equal(offer(board({ gokIn: "hand" }).s, ok.p), undefined, "a Goku in the hand is in no allowed area");
    assert.equal(offer(board({ gokIn: "warp" }).s, ok.p), undefined, "the energy permission is not a Warp permission");
    assert.equal(offer(board({ vegDef: "VEGR" }).s, ok.p), undefined, "a red Vegeta is not the blue one");
    assert.equal(offer(board({ gokDef: "EXTRA-GOK" }).s, ok.p), undefined, "an Extra card printing the name is no Battle Card");
    assert.equal(offer(board({ foeEnergy: true, gokIn: "hand", energy: 6 }).s, ok.p), undefined, "the opponent's energy is not yours: a Goku there is out of reach, and so are their six cards when counting");
    assert.throws(() => RULES.apply(ctx, roundtrip(board({ gokIn: "hand" }).s), { type: "activate", player: seat, card: ok.p, skill: 0 } as Action), IllegalAction, "a forged declaration is refused");

    const handBefore = count(ok.s, seat, "hand");
    const done = run(ok.s, seat, ok.p);
    assert.ok(done.sides[seat].zones.battle.includes(ok.p), `${pot} is played`);
    assert.deepEqual(new Set(done.cards[ok.p].under), new Set([ok.gok, ok.veg]), "on top of both: the energy Goku and the Battle Area Vegeta");
    assert.ok(!done.sides[seat].zones.energy.includes(ok.gok), "the Goku left the energy");
    assert.equal(count(done, seat, "energy"), count(ok.s, seat, "energy") - 1);
    // 22-13-5-2-1-1: the chosen card moved to the Battle Area first with no movement Auto and no counter window;
    // the watcher saw one card placed in the Battle Area, the Potara itself.
    assert.equal(count(done, seat, "hand"), handBefore - 1 + 1, "the played Potara left the hand and the watcher drew once, not twice");
    assert.equal(count(done, foe, "hand"), count(ok.s, foe, "hand"));

    // Both materials in the energy (Goku and Vegeta both chosen from there).
    const both = board({ vegIn: "energy" });
    const doneBoth = run(both.s, seat, both.p);
    assert.deepEqual(new Set(doneBoth.cards[both.p].under), new Set([both.gok, both.veg]), "both from the energy");
    assert.ok(doneBoth.sides[seat].zones.battle.includes(both.p));
  }

  // ── [Union-Potara] Warp (BT10-132 / P-230) ──
  {
    const board = (o: { card?: string; gokIn?: string } = {}) => {
      const s = fresh(seat, 9304);
      const p = stage(s, seat, o.card ?? "BT10132", "hand");
      const gok = stage(s, seat, "GOK", o.gokIn ?? "warp");
      const veg = stage(s, seat, "VEG", "battle");
      stage(s, seat, "FILU", "energy");
      return { s, p, gok, veg };
    };
    const ok = board();
    assert.ok(offer(ok.s, ok.p), `${seat}: BT10-132 is offered with a Goku in the Warp`);
    assert.equal(offer(board({ card: "NOEXT" }).s, ok.p), undefined, "the same line with no Permanent: a Goku in the Warp is out of reach");
    assert.equal(offer(board({ gokIn: "energy" }).s, ok.p), undefined, "the Warp permission is not an energy permission");
    const done = run(ok.s, seat, ok.p);
    assert.deepEqual(new Set(done.cards[ok.p].under), new Set([ok.gok, ok.veg]));
    assert.ok(!done.sides[seat].zones.warp.includes(ok.gok), "the Goku left the Warp");
  }

  // ── [Union-Fusion] Warp, EX25-32 and P-308's wording ──
  for (const id of ["EX2532", "P308"]) {
    const board = (o: { gokIn?: string } = {}) => {
      const s = fresh(seat, 9305);
      const p = stage(s, seat, id, "hand");
      const gok = stage(s, seat, "XGOK", o.gokIn ?? "warp");
      const veg = stage(s, seat, "XVEG", "hand");
      stage(s, seat, "FILU", "energy");
      return { s, p, gok, veg };
    };
    const ok = board();
    assert.ok(offer(ok.s, ok.p), `${seat}: ${id} is offered with a Goku in the Warp and a Vegeta in the hand`);
    assert.equal(offer(board({ gokIn: "drop" }).s, ok.p), undefined, "…not from the Drop");
    const done = run(ok.s, seat, ok.p);
    assert.ok(done.sides[seat].zones.battle.includes(ok.p), "the Fusion is played");
    assert.ok(done.sides[seat].zones.drop.includes(ok.gok) && done.sides[seat].zones.drop.includes(ok.veg), "both materials went to the Drop");
  }
}

// ── P-360: a granted [Union-Fusion] line on the Gogeta cards in hand ─────────
{
  const rd = skillRecords(card("RD", { type: "LEADER", skill: P360_GRANT }))[0];
  assert.deepEqual(rd.unread, [], "P-360: the granted line is read");
  assert.equal(rd.ops[0].op, "permit");
  assert.equal((rd.ops[0] as { what: string }).what, "unionLine");
  assert.equal((rd.ops[0] as { line: string }).line, "[union-fusion]{r}{u}{2}: <Son Goku: Br> and <Vegeta: Br>.");
  assert.match(skillRecords(card("RD", { type: "LEADER", skill: "[permanent] Red <Gogeta: Br> cards in your hand gain the following skill: ・[Activate: Main] Draw 1 card." }))[0].unread.join("|"), /Draw 1 card|Activate/, "any other granted line stays unread");
}
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const board = (o: { leader?: string; gog?: string; vgPower?: number; energy?: string[]; mats?: "hand" | "drop"; noVeg?: boolean } = {}) => {
    const s = fresh(seat, 9306, o.leader ?? "L-GRANT");
    const gog = stage(s, seat, o.gog ?? "GOGB", "hand");
    const goku = stage(s, seat, "SGKB", o.mats ?? "hand");
    const veg = o.noVeg ? null : stage(s, seat, o.vgPower ? "VGB2" : "VGB", o.mats ?? "hand");
    for (const e of o.energy ?? ["FILR", "FILU", "FILR", "FILR"]) stage(s, seat, e, "energy");
    return { s, gog, goku, veg };
  };
  const granted = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && (l.action as { skill: number }).skill >= GRANTED_LINE_BASE);
  const ok = board();
  const line = granted(ok.s, ok.gog);
  assert.ok(line, `${seat}: the granted Fusion is offered on a red Gogeta: Br in hand with both materials, the orbs and the Leader`);
  assert.equal(granted(board({ leader: "L-RED" }).s, ok.gog), undefined, "without P-360's Permanent in force the card has no such line");
  const blue = board({ gog: "GOGBLUE" }); assert.equal(granted(blue.s, blue.gog), undefined, "a blue Gogeta: Br is not 'Red <Gogeta: Br>'");
  const xeno = board({ gog: "GOGXENO" }); assert.equal(granted(xeno.s, xeno.gog), undefined, "a red Gogeta: Xeno is not <Gogeta: Br>");
  const noVeg = board({ noVeg: true }); assert.equal(granted(noVeg.s, noVeg.gog), undefined, "one material missing");
  const unequal = board({ vgPower: 15000 }); assert.equal(granted(unequal.s, unequal.gog), undefined, "Fusion's equal-power requirement holds on the granted line (22-13-4-2)");
  const short = board({ energy: ["FILR", "FILU", "FILR"] }); assert.equal(granted(short.s, short.gog), undefined, "{r}{u}{2} is four orbs: three are short");
  const inDrop = board({ mats: "drop" }); assert.equal(granted(inDrop.s, inDrop.gog), undefined, "materials in the Drop are out of reach");
  assert.throws(() => RULES.apply(ctx, roundtrip(blue.s), { type: "activate", player: seat, card: blue.gog, skill: GRANTED_LINE_BASE } as Action), IllegalAction, "a forged activation of a line the card does not have is refused");

  // The printed card in the Battle Area has no such line: it is a skill of the cards "in your hand".
  const played = board(); assert.ok(moveCard(played.s, game, played.gog, "battle", { owner: seat }).ok);
  assert.equal(granted(played.s, played.gog), undefined, "in the Battle Area the granted line is gone");

  // The snapshot builder must read the card with the extra line.
  buildSnapshot({ id: 93001, mode: "versus", status: "playing", p1Name: "A", p2Name: "B", ctx, state: ok.s, legal: RULES.legalActions(ctx, ok.s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer: seat, images: {} });

  const act = line!.action as Extract<Action, { type: "activate" }>;
  let r = take(ok.s, act);
  r = { s: settle(r.s, seat) };
  assert.ok(r.s.sides[seat].zones.battle.includes(ok.gog), "the Gogeta is played");
  assert.ok(r.s.sides[seat].zones.drop.includes(ok.goku) && r.s.sides[seat].zones.drop.includes(ok.veg!), "both materials went to the Drop as the cost (22-13-4-4)");
  assert.equal(r.s.sides[seat].zones.energy.filter((c) => r.s.cards[c].mode === "rest").length, 4, "the printed {r}{u}{2} is paid");
  assert.equal(count(r.s, foe, "hand"), count(ok.s, foe, "hand"));
  assert.equal(granted(r.s, ok.gog), undefined, "and the line is not offered again once the card is in play");
}
console.log("union-sources-930: [Union-Absorb] costs (BT3-070 / BT3-048 / BT17-067); [Union-Potara] energy (BT10-046 / P-220) and Warp (BT10-132) extensions; Fusion Warp wordings (EX25-32 / P-308); P-360 granted Fusion line; both seats, every step reloaded");
