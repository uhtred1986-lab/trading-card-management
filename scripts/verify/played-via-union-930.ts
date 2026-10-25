/**
 * #930, "played using [Union]" as a condition (owner's ruling of 25 Oct 2026:
 * it counts ONLY on a successful entry by the [Union] skill's own play; a
 * negated/replaced play or a failed entry does not count):
 *
 *  - BT5-037 front#10 — Vexing Outcome Veku: "[activate: main] Place this card
 *    in your Drop Area: Choose up to 1 each of blue {Super Saiyan Son Goku} and
 *    {Super Saiyan Vegeta} cards with energy costs of 2 from your deck and add
 *    them to your hand. Then shuffle your deck, and if you played this card
 *    using [union], draw 1 card."
 *  - BT6-036 front#10 — Vegito, Powers Combined: "[auto] When you play this
 *    card, draw 1 card, and if this card was played using [union], draw 1 more
 *    card."
 *
 * The reading: `playedUsing(sel: self, what: Union)`, the copy's memory of a
 * successful [Union-(type)] entry (`VmCard.enteredUsing`, set by `resolvePlay`
 * only on success, kept across turns while the copy stays, cleared by a change
 * of area, 3-1-4). BT5-037's own cost places it in the Drop before the effect,
 * so "this card" is read as it was when the skill was activated
 * (`ScriptFrame.selfEnteredUsing`).
 *
 * Proved here, both seats, the records through a stored-row JSON round trip
 * and every action through a state JSON round trip: the record shapes (nothing
 * unread, the rules language round trip); a successful Union entry satisfies
 * it (BT5-037 also on a later turn); an ordinary play does not; a Union play a
 * [Counter: Play] replaced ("placed in its owner's Drop Area instead" / "returned
 * to its owner's hand instead of being played") does not — the returned copy,
 * played ordinarily afterwards, does not inherit it; and (owner's second
 * ruling, 25 Oct 2026: the condition is how it was played) a [Union] Vegito
 * KO'd before its on-play [Auto] resolves — by a [Counter: Play] after it
 * landed, or by the seat's own Auto ordered first — still draws the extra
 * card, while an ordinary-play Vegito KO'd the same way does not. Printed texts:
 * docs/arena-backlog/evidence/923/inventory.json (`catalogContext`, catalog
 * snapshot of 15 Oct 2026). Costs, powers and the companion cards are synthetic.
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
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── printed texts ────────────────────────────────────────────────────────────
const BT5_037 =
  "[union-fusion] {u}：<Son Goku> and <Vegeta> (Place 1 each of the specified card with the same power from your hand into your Drop Area and play this card.)\n" +
  "[activate: main] Place this card in your Drop Area: Choose up to 1 each of blue {Super Saiyan Son Goku} and {Super Saiyan Vegeta} cards with energy costs of 2 from your deck and add them to your hand. Then shuffle your deck, and if you played this card using [union], draw 1 card.";
const BT6_036 =
  "[union-potara] {1}: <Son Goku> and <Vegeta> (Place this card in Active Mode on top of the 2 specified cards stacked together.)\n" +
  "[auto] When you play this card, draw 1 card, and if this card was played using [union], draw 1 more card.\n" +
  "[activate: main] {2}: Choose up to 1 <Vegito> card other than {Vegito, Powers Combined} with an energy cost less than or equal to your current energy from your Energy Area and play it. If you played a card, add this card to your energy in Rest Mode.";

const blue = (id: string, o: Partial<CardDef>): CardDef => card(id, { colors: ["Blue"], power: 10000, energyCost: 1, skill: null, ...o });
const counter = (id: string, skill: string): CardDef => card(id, { type: "EXTRA", energyCost: 0, comboCost: null, comboPower: null, skill });
const defs: Record<string, CardDef> = {
  ...DEFS,
  BT5037: blue("BT5037", { name: "Vexing Outcome Veku", characters: ["Veku"], traits: ["Saiyan"], power: 15000, skill: BT5_037 }),
  BT6036: blue("BT6036", { name: "Vegito, Powers Combined", characters: ["Vegito"], traits: ["Saiyan"], power: 25000, skill: BT6_036 }),
  GOKU: blue("GOKU", { characters: ["Son Goku"] }),
  VEGETA: blue("VEGETA", { characters: ["Vegeta"] }),
  SSG: blue("SSG", { name: "Super Saiyan Son Goku", characters: ["Son Goku"], energyCost: 2 }),
  SSV: blue("SSV", { name: "Super Saiyan Vegeta", characters: ["Vegeta"], energyCost: 2 }),
  "B-E": blue("B-E", { characters: ["Filler"] }),
  CDROP: counter("CDROP", "[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played."),
  CRET: counter("CRET", "[Counter: Play] The Battle Card being played is returned to its owner's hand instead of being played."),
  CKO: counter("CKO", "[Counter: Play] Choose 1 of your opponent's Battle Cards and KO it."),
  KOER: blue("KOER", { characters: ["Filler"], skill: "[Auto] When you play a card, choose 1 of your Battle Cards and KO it." }),
};

// ── 1. the records ───────────────────────────────────────────────────────────
type Rec = ReturnType<typeof skillRecords>[number];
const UNION = { kind: "playedUsing", sel: { special: "self" }, what: "Union" };
const asRule = (rec: Rec) => JSON.parse(JSON.stringify({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops })) as Rule;
function language(rec: Rec, what: string): void {
  const rule = asRule(rec);
  assert.equal(validateRule(rule, rec.kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  assert.deepEqual(round.value, rule, `${what}: …unchanged`);
}
{
  const r = skillRecords(defs.BT5037).find((x) => x.skillIndex === 10)!;
  assert.ok(r, "BT5-037 front#10 exists");
  assert.deepEqual(r.unread, [], "BT5-037 front#10: nothing unread");
  assert.equal(r.kind, "activate:main");
  assert.deepEqual(r.cost?.program, [{ op: "moveTo", target: { sel: { special: "self" } }, to: "drop", reveal: true }], "the price: this card to the Drop");
  const [c0, c1, m0, m1, shuffle, cond] = r.ops;
  for (const [op, name] of [[c0, "super saiyan son goku"], [c1, "super saiyan vegeta"]] as const) {
    if (op.op !== "choose" || !("area" in op.sel)) throw new Error("a choice from the deck");
    assert.equal(op.sel.area, "deck");
    assert.equal(op.sel.side, "you");
    assert.equal(op.sel.count, 1);
    assert.equal(op.sel.upTo, true, "up to 1 each");
    assert.deepEqual(op.sel.filter!.colors, ["Blue"], "blue, for every name");
    assert.deepEqual(op.sel.filter!.names.map((n) => n.toLowerCase()), [name]);
    assert.deepEqual([op.sel.filter!.costMin, op.sel.filter!.costMax], [2, 2], "energy cost of 2, for every name");
  }
  assert.ok(c1.op === "choose" && c1.sel.notIn?.includes((c0 as { as: string }).as), "two different cards");
  assert.deepEqual([m0, m1].map((m) => m.op === "moveTo" && m.to), ["hand", "hand"]);
  assert.equal(shuffle.op, "shuffle");
  assert.deepEqual(cond, { op: "if", cond: UNION, then: [{ op: "draw", n: 1 }] }, "if played using [union], draw 1");
  assert.equal(r.ops.length, 6);
  language(r, "BT5-037 front#10");

  const v = skillRecords(defs.BT6036).find((x) => x.skillIndex === 10)!;
  assert.deepEqual(v.unread, [], "BT6-036 front#10: nothing unread");
  assert.deepEqual(v.trigger, ["played"]);
  assert.deepEqual(v.ops, [{ op: "draw", n: 1 }, { op: "if", cond: UNION, then: [{ op: "draw", n: 1 }] }], "draw 1, and if played using [union], 1 more");
  language(v, "BT6-036 front#10");
  // The [Union] lines themselves are unchanged keyword moves.
  for (const d of [defs.BT5037, defs.BT6036]) assert.deepEqual(skillRecords(d).find((x) => x.skillIndex === 0)!.unread, []);
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
function fresh(seat: PlayerId, seed: number): VmState {
  let s = RULES.createGame(ctx, {
    seed,
    p1: { name: "First", leader: "L-BLUE", main: fifty("V-BLUE") },
    p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") },
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
  assert.equal(s.turnPlayer, seat);
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const deck = s.sides[p].zones.deck;
  // A card searched for stays in the deck, in its middle: away from the end
  // the next card staged is taken from, and from the draws either way.
  const id = area === "deck" ? deck[Math.floor(deck.length / 2) + deck.filter((c) => s.cards[c].cardId === "SSG").length] : deck.at(-1)!;
  s.cards[id].cardId = def;
  if (area === "deck") return id;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy") s.cards[id].mode = "active";
  return id;
}
const lineOf = (def: string, pred: (sk: ReturnType<typeof parseSkills>[number]) => boolean) => parseSkills(defs[def].skill!).find(pred)!.index;
const UNION_LINE = (def: string) => lineOf(def, (sk) => sk.keyword?.name === "Union");
const VEKU_LINE = lineOf("BT5037", (sk) => sk.kind.startsWith("activate"));
const offer = (s: VmState, c: string, skill: number) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === skill);
const playOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && l.action.card === c);
const hand = (s: VmState, p: PlayerId) => s.sides[p].zones.hand;

/**
 * Run to the Main Phase; the opponent answers a counter window with `answer`
 * (null: decline) — the window before the play lands, or with `landed` the
 * one after a [Union] play has landed (#929). `steer` answers a prompt first
 * when it returns an action.
 */
function settle(s0: VmState, seat: PlayerId, answer: (s: VmState) => string | null = () => null, landed = false, steer: (s: VmState) => Action | null = () => null): VmState {
  let s = s0;
  for (let i = 0; i < 40 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    const steered = steer(s);
    if (steered) s = take(s, steered);
    else if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: q.player, index: 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: q.player, option: 0 } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: !!s.resolving?.landed === landed ? answer(s) : null } as Action);
    else s = take(s, { type: "pass", player: (q as { player: PlayerId }).player } as Action);
  }
  assert.equal(s.prompt.kind, "main", `back at the Main Phase (at ${s.prompt.kind})`);
  assert.equal(s.turnPlayer, seat);
  return s;
}

interface Board { s: VmState; union: string; mats: string[]; foeCounter?: string }
/** The seat's board for one [Union] card: `energy` blue energy, the two materials where the variant takes them. */
function board(seat: PlayerId, seed: number, which: "BT5037" | "BT6036", o: { energy?: number; counter?: "CDROP" | "CRET" | "CKO"; searchable?: boolean } = {}): Board {
  const s = fresh(seat, seed);
  for (let i = 0; i < (o.energy ?? 3); i++) stage(s, seat, "B-E", "energy");
  if (o.searchable) {
    stage(s, seat, "SSG", "deck");
    stage(s, seat, "SSV", "deck");
  }
  const where = which === "BT5037" ? "hand" : "battle";
  const mats = [stage(s, seat, "GOKU", where), stage(s, seat, "VEGETA", where)];
  const union = stage(s, seat, which, "hand");
  const foeCounter = o.counter ? stage(s, other(seat), o.counter, "hand") : undefined;
  return { s, union, mats, ...(foeCounter ? { foeCounter } : {}) };
}
function unionPlay(b: Board, seat: PlayerId, which: "BT5037" | "BT6036", answer?: (s: VmState) => string | null, landed = false, steer?: (s: VmState) => Action | null): VmState {
  const a = offer(b.s, b.union, UNION_LINE(which));
  assert.ok(a, `${seat}: ${which}'s [Union] is offered`);
  return settle(take(b.s, a.action), seat, answer, landed, steer);
}
function ordinaryPlay(s: VmState, seat: PlayerId, c: string, steer?: (s: VmState) => Action | null): VmState {
  const p = playOf(s, c);
  assert.ok(p, `${seat}: ${c} can be played ordinarily`);
  return settle(take(s, p.action), seat, undefined, false, steer);
}
/**
 * KOER's [Auto] goes first and KOs `victim`, before the victim's own on-play
 * [Auto] resolves — the same seat's two Autos, ordered (9-6-6).
 */
const koFirst = (seat: PlayerId, victim: string) => (s: VmState): Action | null => {
  const q = s.prompt;
  if (q.kind === "orderPending" && q.player === seat) {
    const i = q.candidates.find((n) => s.pending[n]?.card !== victim && s.cards[s.pending[n]!.card]?.cardId === "KOER");
    if (i !== undefined) return { type: "orderPending", player: seat, index: i } as Action;
  }
  if (q.kind === "chooseCards" && q.player === seat && q.choice.candidates.includes(victim)) return { type: "choose", player: seat, cards: [victim] } as Action;
  return null;
};
/** BT5-037's [Activate: Main] from the Battle Area: how many cards it added to the hand. */
function veku(s: VmState, seat: PlayerId, c: string): { s: VmState; gained: number } {
  const a = offer(s, c, VEKU_LINE);
  assert.ok(a, `${seat}: BT5-037's [Activate: Main] is offered`);
  const before = hand(s, seat).length;
  const d = settle(take(s, a.action), seat);
  assert.ok(d.sides[seat].zones.drop.includes(c), "the price: Veku in the Drop");
  return { s: d, gained: hand(d, seat).length - before };
}
/** End the seat's turn and come back to its next Main Phase. */
function nextTurn(s0: VmState, seat: PlayerId): VmState {
  let s = take(s0, { type: "endMain", player: seat } as Action);
  s = settle(s, other(seat));
  s = take(s, { type: "endMain", player: other(seat) } as Action);
  if (s.prompt.kind === "charge") s = take(s, { type: "charge", player: seat, card: null } as Action);
  return settle(s, seat);
}

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const seed = 9300 + (seat === "p1" ? 0 : 50);

  // ── BT6-036 front#10 ──
  // (a) A successful [Union-Potara] entry: draw 1, and 1 more.
  {
    const b = board(seat, seed + 1, "BT6036");
    const h0 = hand(b.s, seat).length;
    const s = unionPlay(b, seat, "BT6036");
    assert.ok(s.sides[seat].zones.battle.includes(b.union), "Vegito is in play");
    assert.equal(s.cards[b.union].enteredUsing, "Union-Potara", "the copy remembers its [Union] entry");
    assert.equal(hand(s, seat).length - h0, -1 + 2, "left the hand, then drew 2");
    cases++;
  }
  // (b) An ordinary play: draw 1 only.
  {
    const b = board(seat, seed + 2, "BT6036");
    const h0 = hand(b.s, seat).length;
    const s = ordinaryPlay(b.s, seat, b.union);
    assert.ok(s.sides[seat].zones.battle.includes(b.union));
    assert.equal(s.cards[b.union].enteredUsing, undefined, "no [Union] entry");
    assert.equal(hand(s, seat).length - h0, -1 + 1, "left the hand, then drew 1");
    cases++;
  }
  // (c) A [Union-Potara] play a [Counter: Play] placed in the Drop instead: it never entered, no draw at all.
  {
    const b = board(seat, seed + 3, "BT6036", { counter: "CDROP" });
    const h0 = hand(b.s, seat).length;
    const s = unionPlay(b, seat, "BT6036", (q) => hand(q, other(seat)).find((c) => q.cards[c].cardId === "CDROP") ?? null);
    assert.ok(s.sides[seat].zones.drop.includes(b.union) && !s.sides[seat].zones.battle.includes(b.union), "Vegito never entered play");
    assert.equal(s.cards[b.union].enteredUsing, undefined, "a negated play is no [Union] entry");
    assert.equal(hand(s, seat).length - h0, -1, "no draw");
    cases++;
  }
  // (d) Returned to the hand instead of being played, then played ordinarily: the failed [Union] is not inherited.
  {
    const b = board(seat, seed + 4, "BT6036", { counter: "CRET" });
    const h0 = hand(b.s, seat).length;
    let s = unionPlay(b, seat, "BT6036", (q) => hand(q, other(seat)).find((c) => q.cards[c].cardId === "CRET") ?? null);
    assert.ok(hand(s, seat).includes(b.union), "returned to the hand");
    assert.equal(hand(s, seat).length - h0, 0, "no draw");
    s = ordinaryPlay(s, seat, b.union);
    assert.equal(hand(s, seat).length - h0, -1 + 1, "the ordinary play draws 1 only");
    cases++;
  }

  // (e) Owner's ruling of 25 Oct 2026: the condition is how it was played. A
  // [Union-Potara] Vegito the opponent KOs with a [Counter: Play] after it
  // landed (#929's second window), before its on-play [Auto] resolves, still
  // draws 1 and 1 more.
  {
    const b = board(seat, seed + 5, "BT6036", { counter: "CKO" });
    const h0 = hand(b.s, seat).length;
    const s = unionPlay(b, seat, "BT6036", (q) => hand(q, other(seat)).find((c) => q.cards[c].cardId === "CKO") ?? null, true);
    assert.ok(s.sides[seat].zones.drop.includes(b.union) && !s.sides[seat].zones.battle.includes(b.union), "the counter KO'd Vegito after it landed");
    assert.ok(s.sides[other(seat)].zones.drop.some((c) => s.cards[c].cardId === "CKO"), "the counter was used");
    assert.equal(s.cards[b.union].enteredUsing, undefined, "the copy's memory went with it (3-1-4)…");
    assert.equal(hand(s, seat).length - h0, -1 + 2, "…but the Auto was triggered by a [Union] entry: drew 2");
    cases++;
  }
  // (f) The same, KO'd by the seat's own [Auto] ordered first.
  {
    const b = board(seat, seed + 6, "BT6036");
    stage(b.s, seat, "KOER", "battle");
    const h0 = hand(b.s, seat).length;
    const s = unionPlay(b, seat, "BT6036", undefined, false, koFirst(seat, b.union));
    assert.ok(s.sides[seat].zones.drop.includes(b.union), "KO'd before its Auto resolved");
    assert.equal(hand(s, seat).length - h0, -1 + 2, "a [Union] entry: drew 2");
    cases++;
  }
  // (g) An ordinary play KO'd the same way before its Auto resolves: draw 1
  // only. (An ordinary play has no counter window after it lands — #929's is
  // a [Union] play's — so the KO is the seat's own [Auto], ordered first.)
  {
    const b = board(seat, seed + 7, "BT6036");
    stage(b.s, seat, "KOER", "battle");
    const h0 = hand(b.s, seat).length;
    const s = ordinaryPlay(b.s, seat, b.union, koFirst(seat, b.union));
    assert.ok(s.sides[seat].zones.drop.includes(b.union), "KO'd before its Auto resolved");
    assert.equal(hand(s, seat).length - h0, -1 + 1, "an ordinary play: drew 1 only");
    cases++;
  }
  // (h) A [Union-Potara] Vegito returned to the hand, then played ordinarily
  // and KO'd before its Auto resolves: the old entry is not inherited.
  {
    const b = board(seat, seed + 8, "BT6036", { counter: "CRET" });
    stage(b.s, seat, "KOER", "battle");
    const h0 = hand(b.s, seat).length;
    let s = unionPlay(b, seat, "BT6036", (q) => hand(q, other(seat)).find((c) => q.cards[c].cardId === "CRET") ?? null);
    assert.ok(hand(s, seat).includes(b.union), "returned to the hand");
    s = ordinaryPlay(s, seat, b.union, koFirst(seat, b.union));
    assert.ok(s.sides[seat].zones.drop.includes(b.union), "KO'd before its Auto resolved");
    assert.equal(hand(s, seat).length - h0, -1 + 1, "the ordinary play draws 1 only");
    cases++;
  }

  // ── BT5-037 front#10 ──
  // (a) A successful [Union-Fusion] entry: the two searched cards and 1 drawn.
  {
    const b = board(seat, seed + 11, "BT5037", { searchable: true });
    let s = unionPlay(b, seat, "BT5037");
    assert.ok(s.sides[seat].zones.battle.includes(b.union), "Veku is in play");
    assert.equal(s.cards[b.union].enteredUsing, "Union-Fusion");
    const r = veku(s, seat, b.union);
    s = r.s;
    assert.equal(r.gained, 2 + 1, "both searched cards, and the draw: the cost took Veku to the Drop, and its memory as activated still counts");
    assert.ok(["SSG", "SSV"].every((d) => hand(s, seat).some((c) => s.cards[c].cardId === d)), "the blue Super Saiyans of cost 2 are in hand");
    cases++;
  }
  // (b) The memory lasts while the copy stays: activated on a later turn, it still draws.
  {
    const b = board(seat, seed + 12, "BT5037", { searchable: true });
    let s = unionPlay(b, seat, "BT5037");
    s = nextTurn(s, seat);
    assert.equal(s.cards[b.union].enteredUsing, "Union-Fusion", "kept across the turn");
    const r = veku(s, seat, b.union);
    assert.equal(r.gained, 2 + 1, "a later turn: still the draw");
    cases++;
  }
  // (c) An ordinary play: the search, and no draw.
  {
    const b = board(seat, seed + 13, "BT5037", { searchable: true });
    const s = ordinaryPlay(b.s, seat, b.union);
    const r = veku(s, seat, b.union);
    assert.equal(r.gained, 2, "the searched cards only");
    cases++;
  }
  // (d) A [Union-Fusion] play returned to the hand instead of being played, then played ordinarily: no draw.
  {
    const b = board(seat, seed + 14, "BT5037", { searchable: true, counter: "CRET" });
    let s = unionPlay(b, seat, "BT5037", (q) => hand(q, other(seat)).find((c) => q.cards[c].cardId === "CRET") ?? null);
    assert.ok(hand(s, seat).includes(b.union), "returned to the hand");
    assert.ok(b.mats.every((m) => s.sides[seat].zones.drop.includes(m)), "the materials stay paid");
    s = ordinaryPlay(s, seat, b.union);
    assert.equal(s.cards[b.union].enteredUsing, undefined);
    const r = veku(s, seat, b.union);
    assert.equal(r.gained, 2, "the failed [Union] is not this copy's: no draw");
    cases++;
  }
  // (e) A [Union-Fusion] play placed in the Drop instead: it never entered play.
  {
    const b = board(seat, seed + 15, "BT5037", { counter: "CDROP" });
    const s = unionPlay(b, seat, "BT5037", (q) => hand(q, other(seat)).find((c) => q.cards[c].cardId === "CDROP") ?? null);
    assert.ok(s.sides[seat].zones.drop.includes(b.union) && !s.sides[seat].zones.battle.includes(b.union));
    assert.equal(s.cards[b.union].enteredUsing, undefined, "no [Union] entry");
    assert.equal(offer(s, b.union, VEKU_LINE), undefined, "nothing to activate from the Drop");
    cases++;
  }
}

console.log(`played-via-union-930: BT5-037 front#10, BT6-036 front#10 — "played using [union]" only on a successful [Union] entry, ${cases} both-seat reload cases`);
