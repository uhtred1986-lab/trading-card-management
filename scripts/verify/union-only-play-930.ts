/**
 * #930, the two "only by [Union-Fusion]" play restrictions:
 *
 *  - P-069 back#10 — Miracle Strike Gogeta: "[Activate: Main][Once per turn]
 *    Choose 1 card in your life and place it in your Drop Area: Choose all of
 *    your opponent's Battle Cards ignoring [Barrier], negate their skills for
 *    the duration of the turn, and this card gains +5000 power for the duration
 *    of the turn. You can only play Battle Cards by using [Union-Fusion] for the
 *    remainder of the turn."
 *  - P-226 front#0 — SS Trunks, Primed for Fusion: "[Activate: Main] If your
 *    opponent has 4 or more cards in Rest Mode, and you have only <Son Goten:
 *    GT> cards in play or no Battle Cards in play: Play this card from your
 *    hand, and you can only play Battle Cards using [Union-Fusion] skills for
 *    the turn."
 *
 * Owner-agreed reading (#930): one typed restriction, `forbid(what: play,
 * side: you, filter: Battle Cards, exceptUnion: [Fusion])` for the turn. The
 * rule manual says nothing more about "can only play … by using" (20-14 is
 * "can't … unless", 22-13 defines the Union plays), so the narrow reading is
 * implemented: every play of a Battle Card is forbidden — declared from the
 * hand, by any other skill ("play this card from …"), an [Evolve], another
 * [Union] variant — except a [Union-Fusion] play. It is applied where moves
 * are offered: the declared play and the forbidden keyword moves are not on
 * the menu, the [Union-Fusion] is, and a skill that would play a Battle Card
 * plays nothing.
 *
 * Printed texts: docs/arena-backlog/evidence/923/cards.md and inventory.json
 * (catalog snapshot of 15 Oct 2026). P-069's back is reduced to this one line
 * here (index 0 in this suite, 10 on the printed card). Printed text -> skill
 * records -> rules language round trip -> stored-row JSON -> the real VM, both
 * seats, every step reloaded from JSON.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard, findCard } from "../../src/lib/arena/vm/zones";
import { forbids } from "../../src/lib/arena/vm/program";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { describeScript } from "../../src/lib/arena/vm/script";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, Color, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── printed texts ────────────────────────────────────────────────────────────
const P069_BACK = "[Activate: Main][Once per turn] Choose 1 card in your life and place it in your Drop Area: Choose all of your opponent's Battle Cards ignoring [Barrier], negate their skills for the duration of the turn, and this card gains +5000 power for the duration of the turn. You can only play Battle Cards by using [Union-Fusion] for the remainder of the turn.";
const P226 = "[Activate: Main] If your opponent has 4 or more cards in Rest Mode, and you have only <Son Goten: GT> cards in play or no Battle Cards in play: Play this card from your hand, and you can only play Battle Cards using [Union-Fusion] skills for the turn.";
// P-227, the [Union-Fusion] P-226 is printed for.
const P227 = "[union-fusion]{y}{y}{2}: Yellow <Son Goten: GT> and yellow <Trunks: GT>.";
// The other plays the restriction is about, shared wordings (no card ids in the engine).
const POTARA = "[union-potara]{1}: Yellow <Son Goten: GT> and yellow <Trunks: GT>.";
const EVOLVE = "[Evolve]{1}: Yellow <Son Goten: GT> card with an energy cost of 1.";
const SKILL_PLAY = "[Activate: Main] Choose up to 1 yellow card with an energy cost of 1 in your hand and play it.";

const RESTRICTION = { op: "forbid", what: "play", side: "you", until: "turn", exceptUnion: ["Fusion"] };

const mat = (id: string, colors: Color[], characters: string[], o: Partial<CardDef> = {}) => card(id, { colors, characters, power: 10000, energyCost: 1, skill: null, ...o });
const defs: Record<string, CardDef> = { ...DEFS,
  "L069": card("L069", { type: "LEADER", name: "Son Goku & Vegeta", colors: ["Red"], characters: ["Son Goku", "Vegeta"], power: 10000, energyCost: null, comboCost: null, comboPower: null, skill: null, back: { name: "Miracle Strike Gogeta", power: 15000, skill: P069_BACK } }),
  "L-YELLOW": card("L-YELLOW", { type: "LEADER", colors: ["Yellow"], power: 10000, energyCost: null, comboCost: null, comboPower: null }),
  "P226": card("P226", { name: "SS Trunks, Primed for Fusion", colors: ["Yellow"], characters: ["Trunks: GT"], energyCost: 3, power: 10000, skill: P226 }),
  "P227": card("P227", { name: "SS Gotenks, Matchless Fusion", colors: ["Yellow"], characters: ["Gotenks: GT"], energyCost: 6, power: 30000, skill: P227 }),
  "POT930": card("POT930", { colors: ["Yellow"], characters: ["Gotenks: GT"], energyCost: 6, power: 30000, skill: POTARA }),
  "EVO930": card("EVO930", { colors: ["Yellow"], characters: ["Son Goten: GT"], energyCost: 4, power: 20000, skill: EVOLVE }),
  "SKP930": card("SKP930", { colors: ["Yellow"], characters: ["Filler"], energyCost: 9, power: 10000, skill: SKILL_PLAY }),
  "GOTEN": mat("GOTEN", ["Yellow"], ["Son Goten: GT"]), "TRUNKS": mat("TRUNKS", ["Yellow"], ["Trunks: GT"]),
  "PLAIN": mat("PLAIN", ["Yellow"], ["Filler"]),
  "OTHER": mat("OTHER", ["Yellow"], ["Pan: GT"]),
  "Y-E": mat("Y-E", ["Yellow"], ["Filler"]),
};

// ── 1. the readings ──────────────────────────────────────────────────────────
const strip = <T,>(v: T): T => JSON.parse(JSON.stringify(v, (_k, x) => ((Array.isArray(x) && x.length === 0) || x === false || x === null ? undefined : x)));
type Rec = ReturnType<typeof skillRecords>[number];
const asRule = (rec: Rec) => JSON.parse(JSON.stringify({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops })) as Rule;
function language(rec: Rec, what: string): void {
  const rule = asRule(rec);
  assert.equal(validateRule(rule, rec.kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  // The printer leaves out what it treats as defaults (a choice's `upTo: false`, a selector's `area`
  // beside its `areas`), so the reparsed record is compared as printed text, a fixed point; the
  // restriction itself comes back field for field.
  if (!round.ok) return;
  assert.equal(printRule(round.value), printRule(rule), `${what}: …unchanged`);
  const forbid = (r: Rule) => (r.ops as { op: string }[]).find((o) => o.op === "forbid");
  assert.ok(forbid(rule), `${what}: has the restriction`);
  assert.deepEqual(forbid(round.value), forbid(rule), `${what}: the restriction round-trips exactly`);
}
{
  const back = skillRecords(defs.L069).filter((r) => r.side === "back");
  assert.equal(back.length, 1);
  const rec = back[0];
  assert.deepEqual(rec.unread, [], "P-069 back: nothing unread");
  assert.equal(rec.kind, "activate:main");
  assert.deepEqual(rec.ops.map((o) => o.op), ["choose", "negateSkills", "power", "forbid"], "the printed effect, then the restriction");
  assert.deepEqual(strip(rec.ops[3]), { ...RESTRICTION, filter: { type: "BATTLE" } });
  assert.match(describeScript([rec.ops[3]]), /^you can only play Battle Cards by using \[Union-Fusion\] for the turn$/);
  language(rec, "P-069 back");

  const p = skillRecords(defs.P226);
  assert.equal(p.length, 1);
  const r = p[0];
  assert.deepEqual(r.unread, [], "P-226: nothing unread");
  assert.deepEqual(r.ops.map((o) => o.op), ["choose", "play", "forbid"], "the play first, the restriction after it");
  assert.deepEqual(strip(r.ops[2]), { ...RESTRICTION, filter: { type: "BATTLE" } });
  assert.equal((r.ops[1] as { using?: string }).using, undefined, "P-226's own play is a skill's plain play");
  // The condition: 4+ of the opponent's cards in Rest Mode, and (every card in your Battle Area is a
  // <Son Goten: GT> card, or you have no Battle Cards in play). It used to read "1 or more <Son Goten: GT>
  // or 1 or more Battle Cards", which held with any Battle Card at all.
  const cond = strip(r.cost?.condition);
  assert.deepEqual(cond, {
    kind: "all",
    conds: [
      { kind: "count", sel: { side: "opponent", area: "battle", mode: "rest", areas: ["leader", "battle", "unison", "energy"] }, atLeast: 4 },
      { kind: "any", conds: [
        { kind: "every", sel: { side: "you", area: "battle" }, matching: { side: "you", area: "battle", filter: { characters: ["son goten: gt"] } } },
        { kind: "count", sel: { side: "you", area: "battle", filter: { type: "BATTLE" } }, atMost: 0 },
      ] },
    ],
  });
  language(r, "P-226");
  for (const id of ["P227", "POT930", "EVO930", "SKP930"]) assert.deepEqual(skillRecords(defs[id]).flatMap((x) => x.unread), [], `${id} reads`);
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

/** Every step is taken on a state reloaded from JSON and comes back as JSON. */
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
  assert.equal(s.prompt.kind, "main"); assert.equal((s.prompt as { player: PlayerId }).player, seat);
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  return roundtrip(s);
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); return id;
}
const lineOf = (def: string, pred: (sk: ReturnType<typeof parseSkills>[number]) => boolean) => parseSkills(defs[def].skill!).find(pred)!.index;
const keywordLine = (def: string) => lineOf(def, (sk) => sk.keyword?.name === "Union" || sk.keyword?.name === "Evolve");
const activation = (s: VmState, c: string, skill?: number) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && (skill === undefined || l.action.skill === skill));
const declared = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && (l.action as { card?: string }).card === c);
const zone = (s: VmState, p: PlayerId, a: string) => s.sides[p].zones[a];

function settle(s0: VmState, want: string[] = []): VmState {
  let s = s0;
  for (let i = 0; i < 40 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: q.player, index: 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: q.player, option: 0 } as Action);
    else if (q.kind === "chooseCards") {
      const picked = q.choice.candidates.filter((c) => want.includes(c));
      s = take(s, { type: "choose", player: q.player, cards: picked.length >= q.choice.min ? picked.slice(0, q.choice.max) : q.choice.candidates.slice(0, q.choice.min) });
    } else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null } as Action);
    else if (q.kind === "charge") s = take(s, { type: "charge", player: q.player, card: null } as Action);
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  assert.equal(s.prompt.kind, "main");
  return s;
}

/**
 * The board every check below is asked on, with the restriction in force or not:
 * a PLAIN Battle Card in hand (ordinary play, 1 energy), P-227 with its two
 * materials in hand (the Fusion), POT930 with materials in the Battle Area,
 * EVO930 with its base in the Battle Area, SKP930's "play it" in the Battle
 * Area, and six yellow energy.
 */
function addPlays(s: VmState, seat: PlayerId) {
  const plain = stage(s, seat, "PLAIN", "hand");
  const fusion = stage(s, seat, "P227", "hand");
  const goten = stage(s, seat, "GOTEN", "hand");
  const trunks = stage(s, seat, "TRUNKS", "hand");
  const potara = stage(s, seat, "POT930", "hand");
  const evolve = stage(s, seat, "EVO930", "hand");
  for (let i = 0; i < 6; i++) stage(s, seat, "Y-E", "energy");
  return { plain, fusion, goten, trunks, potara, evolve };
}
/** The menu with the restriction in force: the Fusion only. */
function checkRestricted(s: VmState, seat: PlayerId, c: ReturnType<typeof addPlays>, tag: string): void {
  assert.equal(declared(s, c.plain), undefined, `${tag}: the ordinary play is not offered`);
  assert.equal(declared(s, c.goten), undefined, `${tag}: …of any Battle Card`);
  assert.ok(activation(s, c.fusion, keywordLine("P227")), `${tag}: the [Union-Fusion] is offered`);
  assert.equal(activation(s, c.potara, keywordLine("POT930")), undefined, `${tag}: a [Union-Potara] is not offered`);
  assert.equal(activation(s, c.evolve, keywordLine("EVO930")), undefined, `${tag}: an [Evolve] is not offered`);
  // The predicate itself, both halves of the exception.
  assert.ok(forbids(ctx, game, s, "play", { player: seat, card: c.plain, bySkill: false }), `${tag}: a declared play is forbidden`);
  assert.ok(forbids(ctx, game, s, "play", { player: seat, card: c.plain, bySkill: true }), `${tag}: a skill's plain play is forbidden`);
  assert.ok(forbids(ctx, game, s, "play", { player: seat, card: c.fusion, bySkill: true, union: "Potara" }), `${tag}: a Potara play is forbidden`);
  assert.ok(!forbids(ctx, game, s, "play", { player: seat, card: c.fusion, bySkill: true, union: "Fusion" }), `${tag}: a Fusion play is let through`);
  assert.ok(!forbids(ctx, game, s, "play", { player: other(seat), card: c.plain, bySkill: false }), `${tag}: the opponent is not bound`);
}
function checkOpen(s: VmState, c: ReturnType<typeof addPlays>, tag: string): void {
  assert.ok(declared(s, c.plain), `${tag}: the ordinary play is offered (control)`);
  assert.ok(activation(s, c.fusion, keywordLine("P227")), `${tag}: the [Union-Fusion] is offered (control)`);
  assert.ok(activation(s, c.potara, keywordLine("POT930")), `${tag}: the [Union-Potara] is offered (control)`);
  assert.ok(activation(s, c.evolve, keywordLine("EVO930")), `${tag}: the [Evolve] is offered (control)`);
}
/** Activate the Fusion and see it played: P-227 on the table, the two materials in the Drop. */
function fuse(s: VmState, seat: PlayerId, c: ReturnType<typeof addPlays>, tag: string): VmState {
  const done = settle(take(s, activation(s, c.fusion, keywordLine("P227"))!.action), [c.goten, c.trunks]);
  assert.ok(zone(done, seat, "battle").includes(c.fusion), `${tag}: the Fusion plays P-227`);
  assert.ok(zone(done, seat, "drop").includes(c.goten) && zone(done, seat, "drop").includes(c.trunks), `${tag}: …its materials in the Drop`);
  return done;
}

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);

  // ── P-069 back#10 ──
  {
    const board = (awakened = true) => {
      const s = fresh(seat, 6900 + (seat === "p1" ? 0 : 1), "L069");
      const leader = s.sides[seat].zones.leader[0];
      s.cards[leader].flipped = awakened;
      const c = addPlays(s, seat);
      // The Potara's and the Evolve's own materials and base in the Battle Area.
      stage(s, seat, "GOTEN", "battle"); stage(s, seat, "TRUNKS", "battle");
      const skp = stage(s, seat, "SKP930", "battle");
      return { s: roundtrip(s), leader, skp, ...c };
    };
    const b = board();
    checkOpen(b.s, b, `${seat} P-069 before`);
    const act = activation(b.s, b.leader);
    assert.ok(act, `${seat}: the awakened P-069's [Activate: Main] is offered`);
    assert.equal(activation(board(false).s, board(false).leader), undefined, `${seat}: the front face has no such line`);
    const life0 = zone(b.s, seat, "life").length;
    const after = settle(take(b.s, act.action));
    assert.equal(zone(after, seat, "life").length, life0 - 1, `${seat}: the life card is paid`);
    checkRestricted(after, seat, b, `${seat} P-069 after`);
    cases += 2;
    // A skill that would play a Battle Card plays nothing; the card stays in the hand, in one place.
    {
      const open = take(after, activation(after, b.skp)!.action);
      const done = settle(open, [b.plain]);
      assert.ok(zone(done, seat, "hand").includes(b.plain), `${seat}: SKP930's play is refused — PLAIN stays in the hand`);
      assert.ok(!zone(done, seat, "battle").includes(b.plain), `${seat}: …and is not on the table`);
      assert.equal((["hand", "drop", "warp", "battle", "energy", "deck", "life"] as const).filter((a) => zone(done, seat, a).includes(b.plain)).length, 1);
      cases++;
    }
    // The Fusion still happens, and the restriction still holds after it.
    {
      const done = fuse(after, seat, b, `${seat} P-069`);
      assert.equal(declared(done, b.plain), undefined, `${seat}: still no ordinary play after the Fusion`);
      cases++;
    }
    // "For the remainder of the turn": gone by the next turn — the ordinary play is offered again.
    {
      let s = settle(take(after, { type: "endMain", player: seat } as Action));
      assert.equal((s.prompt as { player: PlayerId }).player, foe, `${seat}: the opponent's turn`);
      assert.ok(!forbids(ctx, game, s, "play", { player: seat, card: b.plain, bySkill: false }), `${seat}: the restriction expired with the turn`);
      s = settle(take(s, { type: "endMain", player: foe } as Action));
      assert.equal((s.prompt as { player: PlayerId }).player, seat, `${seat}: your next turn`);
      assert.ok(declared(s, b.plain), `${seat}: the ordinary play is offered again`);
      cases++;
    }
  }

  // ── P-226 front#0 ──
  {
    const board = (o: { rested?: number; inBattle?: string[] } = {}) => {
      const s = fresh(seat, 22600 + (seat === "p1" ? 0 : 1), "L-YELLOW");
      const trunks226 = stage(s, seat, "P226", "hand");
      const c = addPlays(s, seat);
      for (const def of o.inBattle ?? []) stage(s, seat, def, "battle");
      for (let i = 0; i < (o.rested ?? 4); i++) { const e = stage(s, foe, "V-BLUE", "energy"); s.cards[e].mode = "rest"; }
      return { s: roundtrip(s), trunks226, ...c };
    };
    const line = lineOf("P226", (sk) => sk.kind === "activate:main");
    // The condition: four of the opponent's cards in Rest Mode, and an empty Battle Area or only <Son Goten: GT>.
    const b = board();
    assert.ok(activation(b.s, b.trunks226, line), `${seat}: P-226 is offered with no Battle Cards in play`);
    assert.equal(activation(board({ rested: 3 }).s, b.trunks226, line), undefined, `${seat}: three rested cards are not four`);
    assert.ok(activation(board({ inBattle: ["GOTEN"] }).s, b.trunks226, line), `${seat}: only <Son Goten: GT> in play`);
    assert.equal(activation(board({ inBattle: ["GOTEN", "OTHER"] }).s, b.trunks226, line), undefined, `${seat}: a <Pan: GT> beside the Goten breaks "only"`);
    assert.equal(activation(board({ inBattle: ["OTHER"] }).s, b.trunks226, line), undefined, `${seat}: a Battle Card that is no <Son Goten: GT>`);
    cases += 5;
    // Before: everything open. The Potara and the Evolve have no materials on this board; only the
    // ordinary play and the Fusion are asked.
    assert.ok(declared(b.s, b.plain), `${seat}: ordinary play before P-226 (control)`);
    const after = settle(take(b.s, activation(b.s, b.trunks226, line)!.action), [b.trunks226]);
    assert.ok(zone(after, seat, "battle").includes(b.trunks226), `${seat}: P-226 plays itself from the hand (before the restriction)`);
    assert.equal(declared(after, b.plain), undefined, `${seat}: no ordinary play for the turn`);
    assert.ok(forbids(ctx, game, after, "play", { player: seat, card: b.plain, bySkill: true }), `${seat}: no skill play either`);
    assert.ok(!forbids(ctx, game, after, "play", { player: seat, card: b.plain, bySkill: false, union: "Fusion" }));
    // P-227 with Goten and Trunks from the hand: offered and played.
    const done = fuse(after, seat, b, `${seat} P-226`);
    assert.equal(declared(done, b.plain), undefined, `${seat}: still restricted after the Fusion`);
    // Reload: the restriction is in the stored state, not in memory.
    assert.equal(declared(roundtrip(done), b.plain), undefined, `${seat}: …and after a reload`);
    assert.equal(findCard(done, b.plain)?.zone, "hand");
    cases += 4;
  }
}
console.log(`union-only-play-930: ok (${cases} cases)`);
