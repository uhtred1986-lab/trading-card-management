/**
 * #930, the standing [Union] skill-cost reductions:
 *
 *  - BT28-079 back#0 — SS Vegito, Transcendent Rage: "[permanent] Reduce the
 *    skill cost of [union] skills on yellow <Vegito> cards in your hand by {1}."
 *  - SD19-04 front#20 — SS3 Gotenks, Ultimate Rookie: "[permanent] If your
 *    Leader is a Z-Leader or you have a Z-Battle Card in play, reduce the skill
 *    cost of this card's [union] skill in your hand by {g}."
 *
 * Both are one standing `costReduction(what: skill, tag: union)` over cards in
 * the hand (20-21-2, 5-8-2-4), read where a [Union] line's price is bound
 * (`vm/costs.ts`' `skillOrbs`, `skillTagMatches`): "[union]" names every
 * [Union-(type)] line (22-13-3-1), and "in your hand" is where Fusion and
 * Potara are activated (22-13-4-3, 22-13-5-3) — an [Union-Absorb] line is
 * activated from the Battle Area (22-13-6-2) and so is out of its reach.
 * BT28-079's "{1}" takes only a colourless orb and SD19-04's "{g}" only a
 * green one (5-8-2-4).
 *
 * Printed text -> skills -> stored-row JSON round trip (and the rules
 * language) -> the real VM, both seats, every step reloaded. Printed texts:
 * docs/arena-backlog/evidence/923/cards.md and inventory.json (catalog
 * snapshot of 15 Oct 2026). No FAQ or errata entry for either line.
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

// ── printed texts ────────────────────────────────────────────────────────────
const BT28_079_BACK = "[permanent] Reduce the skill cost of [union] skills on yellow <Vegito> cards in your hand by {1}.";
// BT28-097, the Union-Potara the reduction is for.
const BT28_097 = "[union-potara]{y}{y}{1}, if your opponent has 3 or more energy and you draw 2 cards: Yellow <Son Goku> card and yellow <Vegeta> card.";
const SD19_04_UNION = "[union-fusion]{g}{g}{g}{g}, if you have 4 or more energy and draw 2 cards: Green <Son Goten> and green <Trunks: Youth>.";
const SD19_04_PERM = "[permanent] If your Leader is a Z-Leader or you have a Z-Battle Card in play, reduce the skill cost of this card's [union] skill in your hand by {g}.";
const SD19_04 = `[deflect][dual attack]\n${SD19_04_UNION}\n${SD19_04_PERM}`;
// Controls: the same Potara price with no colourless orb, a non-Union line on a yellow Vegito, an Absorb in the Battle Area.
const POT_YYY = "[union-potara]{y}{y}{y}: Yellow <Son Goku> card and yellow <Vegeta> card.";
const ACT_Y1 = "[Activate: Main]{y}{1}: Draw 1 card.";
const ABS_Y1 = "[union absorb]{y}{1},place 1 Battle Card from your hand under this card: Choose up to 1 yellow <Vegito> with an energy cost of 5 from your deck and place it on top of this card. Then, shuffle your deck.";
// The same Fusion line without SD19-04's own [Permanent] (the reduction is "this card's").
const SD19_04_BARE = `[deflect][dual attack]\n${SD19_04_UNION}`;

const mat = (id: string, colors: Color[], characters: string[], o: Partial<CardDef> = {}) => card(id, { colors, characters, power: 10000, energyCost: 1, skill: null, ...o });
const defs: Record<string, CardDef> = { ...DEFS,
  "L079": card("L079", { type: "LEADER", name: "Vegito", colors: ["Yellow"], characters: ["Vegito"], traits: ["Saiyan"], power: 10000, energyCost: null, skill: "[Auto] When this card attacks, draw 1 card.", back: { name: "SS Vegito, Transcendent Rage", power: 15000, skill: BT28_079_BACK } }),
  "VEG97": card("VEG97", { colors: ["Yellow"], characters: ["Vegito"], traits: ["Saiyan"], energyCost: 7, power: 35000, skill: BT28_097 }),
  // Same line on a blue Vegito, a yellow Gogeta; a yellow Vegito with no colourless orb; a non-Union line; an Absorb.
  "VEGBLUE": card("VEGBLUE", { colors: ["Blue"], characters: ["Vegito"], energyCost: 7, power: 35000, skill: BT28_097.replace("{y}{y}{1}", "{u}{u}{1}") }),
  "GOGY": card("GOGY", { colors: ["Yellow"], characters: ["Gogeta"], energyCost: 7, power: 35000, skill: BT28_097 }),
  "VEGYYY": card("VEGYYY", { colors: ["Yellow"], characters: ["Vegito"], energyCost: 7, power: 35000, skill: POT_YYY }),
  "VEGACT": card("VEGACT", { colors: ["Yellow"], characters: ["Vegito"], energyCost: 3, power: 15000, skill: ACT_Y1 }),
  "VEGABS": card("VEGABS", { colors: ["Yellow"], characters: ["Vegito"], energyCost: 3, power: 15000, skill: ABS_Y1 }),
  "VEG5": mat("VEG5", ["Yellow"], ["Vegito"], { energyCost: 5, power: 25000 }),
  "GOKY": mat("GOKY", ["Yellow"], ["Son Goku"]), "VEGY": mat("VEGY", ["Yellow"], ["Vegeta"]),
  "Y-E": mat("Y-E", ["Yellow"], ["Filler"]), "U-E": mat("U-E", ["Blue"], ["Filler"]),
  // SD19-04 and its controls.
  "SD1904": card("SD1904", { colors: ["Green"], characters: ["Gotenks"], traits: ["Saiyan", "Earthling"], energyCost: 6, power: 30000, skill: SD19_04 }),
  "SD1904BARE": card("SD1904BARE", { colors: ["Green"], characters: ["Gotenks"], energyCost: 6, power: 30000, skill: SD19_04_BARE }),
  "GOTEN": mat("GOTEN", ["Green"], ["Son Goten"]), "TRUNKS": mat("TRUNKS", ["Green"], ["Trunks: Youth"]),
  "G-E": mat("G-E", ["Green"], ["Filler"]),
  "L-GREEN": card("L-GREEN", { type: "LEADER", colors: ["Green"], characters: ["Gotenks"], power: 10000, energyCost: null, skill: null }),
  "L-Z": card("L-Z", { type: "Z-LEADER", colors: ["Green"], characters: ["Gotenks"], power: 25000, energyCost: null, zEnergyCost: 1, skill: null }),
  "ZB": card("ZB", { type: "Z-BATTLE", colors: ["Green"], characters: ["Piccolo"], power: 15000, energyCost: null, zEnergyCost: 1, skill: null }),
};

// ── 1. the readings ──────────────────────────────────────────────────────────
const asRule = (rec: ReturnType<typeof skillRecords>[number]) => JSON.parse(JSON.stringify({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops })) as Rule;
function language(rec: ReturnType<typeof skillRecords>[number], what: string): void {
  const rule = asRule(rec);
  assert.equal(validateRule(rule, rec.kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  assert.deepEqual(round.value, rule, `${what}: …unchanged`);
}
{
  const back = skillRecords(defs.L079).filter((r) => r.side === "back");
  assert.equal(back.length, 1);
  const rec = back[0];
  assert.deepEqual(rec.unread, [], "BT28-079 back#0: nothing unread");
  assert.equal(rec.kind, "permanent");
  assert.equal(rec.cond ?? null, null, "no condition");
  assert.equal(rec.ops.length, 1);
  const op = rec.ops[0];
  if (op.op !== "costReduction") throw new Error("BT28-079: a costReduction");
  assert.equal(op.what, "skill");
  assert.equal(op.tag, "union", "[union] names every Union line (22-13-3-1)");
  assert.equal(op.amount, 1);
  assert.deepEqual(op.colors, ["any"], "{1}: a colourless orb only (5-8-2-4)");
  assert.equal(op.until, "game");
  if (!op.target || !("sel" in op.target)) throw new Error("a selector");
  assert.equal(op.target.sel.side, "you");
  assert.equal(op.target.sel.area, "hand");
  assert.deepEqual(op.target.sel.filter?.colors, ["Yellow"]);
  assert.deepEqual(op.target.sel.filter?.characters, ["vegito"]);
  assert.equal(describeScript(rec.ops), "all yellow <vegito> cards in your hand's skill cost for [union] skills is 1 less");
  language(rec, "BT28-079");

  const sd = skillRecords(defs.SD1904).find((r) => r.skillIndex === 20)!;
  assert.ok(sd, "SD19-04 front#20 exists");
  assert.deepEqual(sd.unread, [], "SD19-04 front#20: nothing unread");
  assert.equal(sd.kind, "permanent");
  assert.equal(sd.cond?.kind, "any", "Z-Leader or a Z-Battle Card in play");
  const sop = sd.ops[0];
  if (sop.op !== "costReduction") throw new Error("SD19-04: a costReduction");
  assert.deepEqual(sop.target, { sel: { special: "self", area: "hand" } }, "this card, in your hand");
  assert.equal(sop.what, "skill"); assert.equal(sop.tag, "union"); assert.equal(sop.amount, 1);
  assert.deepEqual(sop.colors, ["Green"], "{g}: a green orb only");
  language(sd, "SD19-04");
  const fusion = skillRecords(defs.SD1904).find((r) => r.skillIndex === 10)!;
  assert.deepEqual(fusion.unread, [], "SD19-04's Fusion line is read");
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

function take(s: VmState, action: Action): VmState {
  return roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
}
function fresh(seat: PlayerId, seed: number, leader: string, foeLeader = "L-BLUE"): VmState {
  const leaders = { p1: seat === "p1" ? leader : foeLeader, p2: seat === "p2" ? leader : foeLeader };
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader: leaders.p1, main: fifty("V1") }, p2: { name: "Second", leader: leaders.p2, main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(seat === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action);
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); return id;
}
const lineOf = (def: string, pred: (sk: ReturnType<typeof parseSkills>[number]) => boolean) => parseSkills(defs[def].skill!).find(pred)!.index;
const unionLine = (def: string) => lineOf(def, (sk) => sk.keyword?.name === "Union");
const offer = (s: VmState, c: string, skill: number) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === skill);
const rested = (s: VmState, p: PlayerId) => s.sides[p].zones.energy.filter((c) => s.cards[c].mode === "rest").length;

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
  assert.equal(s.prompt.kind, "main");
  return s;
}

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);

  // ── BT28-079 ──
  {
    const board = (o: { awakened?: boolean; leaderOnFoe?: boolean; unionDef?: string; energy?: number; energyDef?: string; foeEnergy?: number } = {}) => {
      const s = fresh(seat, 9790 + (seat === "p1" ? 0 : 1), o.leaderOnFoe ? "L-RED" : "L079", o.leaderOnFoe ? "L079" : "L-BLUE");
      const owner = o.leaderOnFoe ? foe : seat;
      const leader = s.sides[owner].zones.leader[0];
      s.cards[leader].flipped = o.awakened ?? true;
      const def = o.unionDef ?? "VEG97";
      const u = stage(s, seat, def, "hand");
      const gok = stage(s, seat, "GOKY", "battle");
      const veg = stage(s, seat, "VEGY", "battle");
      for (let i = 0; i < (o.energy ?? 2); i++) stage(s, seat, o.energyDef ?? "Y-E", "energy");
      for (let i = 0; i < (o.foeEnergy ?? 3); i++) stage(s, foe, "U-E", "energy");
      return { s, u, gok, veg, line: unionLine(def) };
    };
    // The reduction: {y}{y}{1} is {y}{y}, two yellow energy pay it.
    const ok = board();
    assert.ok(offer(ok.s, ok.u, ok.line), `${seat}: BT28-097 is offered at {y}{y} under the awakened BT28-079`);
    const hand0 = ok.s.sides[seat].zones.hand.length;
    const done = settle(take(ok.s, offer(ok.s, ok.u, ok.line)!.action), seat);
    assert.ok(done.sides[seat].zones.battle.includes(ok.u), "the Vegito is played");
    assert.deepEqual(new Set(done.cards[ok.u].under), new Set([ok.gok, ok.veg]), "on top of the Goku and the Vegeta");
    assert.equal(rested(done, seat), 2, "two energy paid: {y}{y}{1} less {1}");
    assert.equal(done.sides[seat].zones.hand.length, hand0 - 1 + 2, "the printed 'draw 2 cards' still happens");
    assert.equal(rested(done, foe), 0, "nothing of the opponent's is paid");
    cases++;
    // With three energy one stays active: the reduction is applied, not merely an extra energy found.
    {
      const three = board({ energy: 3 });
      const d = settle(take(three.s, offer(three.s, three.u, three.line)!.action), seat);
      assert.equal(rested(d, seat), 2, "three energy: still only two rested");
      assert.equal(d.sides[seat].zones.energy.length - rested(d, seat), 1, "…one stays active");
      cases++;
    }
    // Front face: no [Permanent], the full price.
    assert.equal(offer(board({ awakened: false }).s, ok.u, ok.line), undefined, "front face: {y}{y}{1} with two energy is not offered");
    {
      const front3 = board({ awakened: false, energy: 3 });
      const d = settle(take(front3.s, offer(front3.s, front3.u, front3.line)!.action), seat);
      assert.equal(rested(d, seat), 3, "front face: the full three are paid");
    }
    // The opponent's awakened BT28-079 is no help ("your hand").
    assert.equal(offer(board({ leaderOnFoe: true }).s, ok.u, ok.line), undefined, "the opponent's BT28-079 does not reduce your cost");
    // Not a blue Vegito, not a yellow Gogeta.
    {
      const blue = board({ unionDef: "VEGBLUE", energyDef: "U-E" });
      assert.equal(offer(blue.s, blue.u, blue.line), undefined, "a blue Vegito: {u}{u}{1} with two blue energy is not offered");
      const blue3 = board({ unionDef: "VEGBLUE", energyDef: "U-E", energy: 3 });
      assert.ok(offer(blue3.s, blue3.u, blue3.line), "…with three it is (control)");
      const gog = board({ unionDef: "GOGY" });
      assert.equal(offer(gog.s, gog.u, gog.line), undefined, "a yellow Gogeta is no Vegito");
    }
    // 5-8-2-4: "{1}" does nothing to a price of coloured orbs only.
    {
      const yyy = board({ unionDef: "VEGYYY" });
      assert.equal(offer(yyy.s, yyy.u, yyy.line), undefined, "{y}{y}{y}: no colourless orb, nothing reduced");
      const yyy3 = board({ unionDef: "VEGYYY", energy: 3 });
      const d = settle(take(yyy3.s, offer(yyy3.s, yyy3.u, yyy3.line)!.action), seat);
      assert.equal(rested(d, seat), 3, "…all three paid");
    }
    // Only [Union] skills: a yellow Vegito's [Activate: Main]{y}{1} is not reduced.
    {
      const s = fresh(seat, 9795, "L079");
      s.cards[s.sides[seat].zones.leader[0]].flipped = true;
      const a = stage(s, seat, "VEGACT", "battle");
      stage(s, seat, "Y-E", "energy");
      assert.equal(offer(s, a, lineOf("VEGACT", (sk) => sk.kind.startsWith("activate"))), undefined, "a non-Union line keeps its {y}{1}");
      stage(s, seat, "Y-E", "energy");
      assert.ok(offer(s, a, lineOf("VEGACT", (sk) => sk.kind.startsWith("activate"))), "…offered with two (control)");
    }
    // "in your hand": a Vegito's [Union-Absorb] in the Battle Area (22-13-6-2) is not reduced.
    {
      const s = fresh(seat, 9796, "L079");
      s.cards[s.sides[seat].zones.leader[0]].flipped = true;
      const a = stage(s, seat, "VEGABS", "battle");
      stage(s, seat, "GOKY", "hand");
      stage(s, seat, "VEG5", "deck");
      stage(s, seat, "Y-E", "energy");
      assert.equal(offer(s, a, unionLine("VEGABS")), undefined, "an Absorb in the Battle Area keeps its {y}{1}");
      stage(s, seat, "Y-E", "energy");
      assert.ok(offer(s, a, unionLine("VEGABS")), "…offered with two (control)");
    }
    cases += 8;
  }

  // ── SD19-04 ──
  {
    const board = (o: { leader?: string; zInPlay?: boolean; def?: string; energy?: number } = {}) => {
      const s = fresh(seat, 9840 + (seat === "p1" ? 0 : 1), o.leader ?? "L-Z");
      const def = o.def ?? "SD1904";
      const u = stage(s, seat, def, "hand");
      const goten = stage(s, seat, "GOTEN", "hand");
      const trunks = stage(s, seat, "TRUNKS", "hand");
      if (o.zInPlay) stage(s, seat, "ZB", "battle");
      for (let i = 0; i < (o.energy ?? 4); i++) stage(s, seat, "G-E", "energy");
      return { s, u, goten, trunks, line: unionLine(def) };
    };
    const pay = (b: ReturnType<typeof board>) => {
      const a = offer(b.s, b.u, b.line);
      assert.ok(a, `${seat}: SD19-04's Fusion is offered`);
      const d = settle(take(b.s, a.action), seat);
      assert.ok(d.sides[seat].zones.battle.includes(b.u), "SD19-04 is played");
      assert.ok(d.sides[seat].zones.drop.includes(b.goten) && d.sides[seat].zones.drop.includes(b.trunks), "both materials went to the Drop");
      return rested(d, seat);
    };
    // Z-Leader: {g}{g}{g}{g} is {g}{g}{g}.
    assert.equal(pay(board()), 3, "Z-Leader: three of four energy paid");
    // A Z-Battle Card in play instead.
    assert.equal(pay(board({ leader: "L-GREEN", zInPlay: true })), 3, "a Z-Battle Card in play: three paid");
    // Neither: the full four.
    assert.equal(pay(board({ leader: "L-GREEN" })), 4, "no Z-Leader, no Z-Battle Card: all four paid");
    // "this card's": the same Fusion line without the [Permanent] is not reduced.
    assert.equal(pay(board({ def: "SD1904BARE" })), 4, "the bare line under a Z-Leader: all four paid");
    // "if you have 4 or more energy" stays the line's own condition: three energy is no activation even reduced.
    const b3 = board({ energy: 3 });
    assert.equal(offer(b3.s, b3.u, b3.line), undefined, "three energy: the printed 4-energy condition still fails");
    cases += 5;
  }
}

console.log(`union-reductions-930: BT28-079 back#0, SD19-04 front#20 — standing [Union] skill-cost reductions, ${cases} both-seat reload cases`);
