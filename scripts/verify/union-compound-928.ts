/**
 * #928: a [Union] activation printed on the same line as bare keyword tags is
 * still the Union's move — printed text -> skills -> stored-row JSON
 * round-trip -> the real VM.
 *
 * EX25-16 prints "[barrier][blocker] [union-potara]{u}{u}{u}, draw 2 cards:
 * Blue <Son Goku> card and blue <Vegeta> card." and EX25-40 "[energy-exhaust]
 * [union-potara]{u}, draw 2 cards: Blue <Kale> card and yellow <Caulifla>
 * card." (docs/arena-backlog/evidence/923/cards.md, from the catalog).
 * `parseSkills` used to hand such a line the FIRST tag as its keyword, so
 * `keywordMoveOf` saw [Barrier] / [Energy-Exhaust] and no Union move was ever
 * offered, while [Blocker] (only ever a tag) was never in force either.
 * Now the Union owns the line (22-13-3: the tag is followed by its price and
 * the two materials) and each bare keyword in front of it is its own keyword
 * skill. Controls: the materials in the wrong area, one material missing, the
 * price unpayable, and lines of other shapes that must read exactly as before.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { keywordsInForce } from "../../src/lib/arena/vm/program";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { keywordsOf, parseSkills } from "../../src/lib/arena/text/cards";
import type { Action, CardDef, Color, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const PRINTED: Record<string, { name: string; colors: Color[]; characters: string[]; power: number; skill: string }> = {
  "EX25-16": { name: "SSB Vegito, Future Hope", colors: ["Blue"], characters: ["Vegito"], power: 35000,
    skill: "[barrier][blocker] [union-potara]{u}{u}{u}, draw 2 cards: Blue <Son Goku> card and blue <Vegeta> card." },
  "EX25-40": { name: "SS2 Kefla, Miraculous Friendship", colors: ["Blue"], characters: ["Kefla"], power: 30000,
    skill: "[energy-exhaust] [union-potara]{u}, draw 2 cards: Blue <Kale> card and yellow <Caulifla> card." },
};
const mat = (id: string, colors: Color[], characters: string[]) => card(id, { colors, characters, power: 10000, energyCost: 1, skill: null });
const defs: Record<string, CardDef> = { ...DEFS,
  ...Object.fromEntries(Object.entries(PRINTED).map(([id, p]) => [id, card(id, { ...p, energyCost: 5 })])),
  "GOKU928": mat("GOKU928", ["Blue"], ["Son Goku"]), "VEG928": mat("VEG928", ["Blue"], ["Vegeta"]),
  "KALE928": mat("KALE928", ["Blue"], ["Kale"]), "CAUL928": mat("CAUL928", ["Yellow"], ["Caulifla"]),
  "B928": mat("B928", ["Blue"], ["Filler"]),
};

// ── 1. the reading ───────────────────────────────────────────────────────────
{
  const v = parseSkills(PRINTED["EX25-16"].skill);
  assert.deepEqual(v.map((s) => [s.index, s.kind, s.keyword?.name]), [[0, "keyword", "Union"], [1, "keyword", "Barrier"], [2, "keyword", "Blocker"]], "EX25-16: the Union keeps index 0; Barrier and Blocker are skills of their own");
  assert.deepEqual(v[0].keyword, { name: "Union", variant: "Potara" });
  assert.equal(v[0].cost, "{u}{u}{u}, draw 2 cards", "the printed price is untouched");
  assert.equal(v[0].effect, "Blue <Son Goku> card and blue <Vegeta> card.", "…and so are the materials");
  assert.deepEqual(v[0].energyCost, { Blue: 3 });
  assert.deepEqual(v[0].raw, PRINTED["EX25-16"].skill, "the Union keeps the printed line");
  assert.deepEqual(keywordsOf(defs["EX25-16"]).map((k) => k.name).sort(), ["Barrier", "Blocker", "Union"], "every keyword on the line is still carried");
  const k = parseSkills(PRINTED["EX25-40"].skill);
  assert.deepEqual(k.map((s) => [s.index, s.keyword?.name]), [[0, "Union"], [1, "Energy-Exhaust"]]);
  assert.equal(k[0].cost, "{u}, draw 2 cards");
  // Shapes that must read exactly as before: separate lines, a keyword-only
  // line, and a line led by a cost-bearing keyword.
  assert.deepEqual(parseSkills("[Barrier][Blocker]<br>[Union-Potara] Draw 1 card: <A> and <B>.").map((s) => [s.index, s.keyword?.name]), [[0, "Barrier"], [1, "Blocker"], [10, "Union"]], "separate lines: unchanged");
  assert.deepEqual(parseSkills("[Blocker][Evolve]{r}{r}: <Pan>").map((s) => [s.index, s.keyword?.name]), [[0, "Blocker"]], "[Blocker][Evolve]: not decided here, unchanged");
  assert.deepEqual(parseSkills("[Union-Potara] [Barrier] Draw 1 card: <A> and <B>.").map((s) => s.keyword?.name), ["Union"], "a Union tag that is not last: unchanged (first tag)");
  assert.deepEqual(parseSkills("[Union-Fusion][Union-Potara] Draw 1 card: <A> and <B>.").map((s) => s.keyword?.name), ["Union"], "two Unions: unchanged");
  assert.deepEqual(parseSkills("[Barrier][Union-Potara]").map((s) => [s.index, s.keyword?.name]), [[0, "Barrier"], [1, "Union"]], "no body: still one skill per keyword");
}

// ── 2. stored rows and the VM ────────────────────────────────────────────────
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
for (const id of Object.keys(PRINTED)) {
  const recs = skillRecords(defs[id]);
  const union = recs.find((r) => r.skillIndex === 0)!;
  assert.deepEqual(union.unread, [], `${id}: the Union line has nothing unread`);
  assert.deepEqual(union.cost?.program?.map((o) => o.op), ["draw"], `${id}: 'draw 2 cards' is its price`);
}
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

function take(s: VmState, action: Action): { s: VmState } {
  const r = RULES.apply(ctx, roundtrip(s), action);
  return { s: roundtrip(r.state as VmState) };
}
function fresh(seat: PlayerId, seed = 928): VmState {
  const leaders = { p1: seat === "p1" ? "L-RED" : "L-BLUE", p2: seat === "p2" ? "L-RED" : "L-BLUE" };
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
const unionIndex = (id: string) => parseSkills(defs[id].skill!).find((sk) => sk.keyword?.name === "Union")!.index;
const offer = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === unionIndex(s.cards[c].cardId));
const refusal = (s: VmState, c: string) => RULES.rejectedActions(ctx, s, RULES.legalActions(ctx, s)).find((r) => r.action.type === "activate" && r.action.card === c && r.action.skill === unionIndex(s.cards[c].cardId))?.why ?? [];
const count = (s: VmState, p: PlayerId, area: string) => s.sides[p].zones[area].length;

function run(s: VmState, seat: PlayerId, c: string): VmState {
  let r = take(s, offer(s, c)!.action);
  for (let i = 0; i < 10 && r.s.prompt.kind !== "main"; i++) {
    const q = r.s.prompt;
    if (q.kind === "payCost") r = take(r.s, { type: "payCost", player: seat, option: 0 } as Action);
    else if (q.kind === "chooseCards") r = take(r.s, { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    else if (q.kind === "orderPending") r = take(r.s, { type: "orderPending", player: q.player, index: 0 } as Action);
    else r = take(r.s, { type: "pass", player: (q as { player: PlayerId }).player } as Action);
  }
  assert.equal(r.s.prompt.kind, "main");
  return r.s;
}

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  for (const [id, mats, energy] of [
    ["EX25-16", ["GOKU928", "VEG928"], 3],
    ["EX25-40", ["KALE928", "CAUL928"], 1],
  ] as const) {
    const board = (o: { energy?: number; deck?: number; materialsIn?: string; only?: number } = {}) => {
      const s = fresh(seat, 9280);
      const pot = stage(s, seat, id, "hand");
      const into = o.materialsIn ?? "battle";
      const ms = mats.slice(0, o.only ?? 2).map((m) => stage(s, seat, m, into));
      for (let i = 0; i < (o.energy ?? energy); i++) stage(s, seat, "B928", "energy");
      if (o.deck !== undefined) for (const c of s.sides[seat].zones.deck.slice(o.deck)) assert.ok(moveCard(s, game, c, "warp", { owner: seat }).ok);
      return { s, pot, ms };
    };
    const ok = board();
    assert.ok(offer(ok.s, ok.pot), `${seat}: ${id} is offered with both materials in play, the energy and a deck`);
    assert.equal(offer(board({ materialsIn: "hand" }).s, ok.pot), undefined, `${id}: materials in the hand are not in play`);
    const b2 = board({ materialsIn: "hand" });
    assert.equal(offer(b2.s, b2.pot), undefined, `${id}: wrong area, not offered`);
    const b3 = board({ only: 1 });
    assert.equal(offer(b3.s, b3.pot), undefined, `${id}: one material is not enough`);
    const b4 = board({ energy: energy - 1 });
    assert.equal(offer(b4.s, b4.pot), undefined, `${id}: one orb short`);
    const b5 = board({ deck: 1 });
    assert.equal(offer(b5.s, b5.pot), undefined, `${id}: 'draw 2 cards' cannot be paid from a one-card deck`);
    assert.deepEqual(refusal(b5.s, b5.pot), [{ kind: "other", detail: "its skill cost cannot be paid in full" }]);
    assert.throws(() => RULES.apply(ctx, roundtrip(b5.s), { type: "activate", player: seat, card: b5.pot, skill: unionIndex(id) } as Action), IllegalAction, "a forged declaration is refused");

    const deck = count(ok.s, seat, "deck");
    const done = run(ok.s, seat, ok.pot);
    assert.ok(done.sides[seat].zones.battle.includes(ok.pot), `${id} is played`);
    assert.deepEqual([...done.cards[ok.pot].under].sort(), [...ok.ms].sort(), "on top of both named cards");
    assert.equal(count(done, seat, "deck"), deck - 2, "draw 2 paid");
    assert.equal(count(done, seat, "hand"), 2);
    assert.equal(done.sides[seat].zones.energy.filter((c) => done.cards[c].mode === "rest").length, energy, "the printed orbs are paid");
    assert.equal(count(done, foe, "hand"), count(ok.s, foe, "hand"), "nothing happens to the opponent");

    // The other tags still work: they are keyword skills of the card in play.
    const names = keywordsInForce(ctx, game, done, ok.pot).map((k) => k.name).sort();
    assert.deepEqual(names, id === "EX25-16" ? ["Barrier", "Blocker", "Union"] : ["Energy-Exhaust", "Union"], `${id}: every keyword on the line is in force once played`);
  }
}
console.log("union-compound-928: [Barrier][Blocker] [Union-Potara] and [Energy-Exhaust] [Union-Potara] lines — reading, other shapes unchanged, stored rows, offered with materials in play and the price payable, wrong area / missing material / short orb / thin deck refused, stacking, every keyword in force; both seats passed");
