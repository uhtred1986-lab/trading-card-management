/**
 * #930, the [Auto] triggers "when this card is played using [Union]" (BT14-114
 * front#10), "when you play this card with [union]" (BT5-039 front#20, BT2-085
 * front#20, BT7-123 front#30, P-109 front#30), "when you play this card using
 * [union]" (BT4-108 front#20) and "when this card is played by a [union] skill"
 * (BT28-097 front#20, BT28-099 front#20).
 *
 * They used to compile as a plain `played` moment and so fired on an ordinary
 * play too. The reading now: `played`, gated by `playedUsing(sel: self, what:
 * Union)` — the record's lone IF, hoisted to `cond` — and a named variant
 * ("using [Union-Potara]") gates on that variant only. The VM honours the gate
 * as a trigger condition (`resolvePlay` with `unionPlayGate`): the Auto is
 * withdrawn from any play that is not a successful entry by the named [Union]
 * keyword's own play (owner's ruling, 25 Oct 2026), and the Autos that entry
 * pended carry it (`VmPending.selfEnteredUsing`, #1176), so a copy KO'd before
 * its Auto resolves still counts (owner's ruling: it entered via [Union]).
 * A card played by another card's [Union-Absorb] counts (owner's ruling).
 *
 * Proved here: the records of all eight cards from their printed texts (shape,
 * nothing newly unread, the rules language round trip), BT4-019 front#30
 * ("…played using [union-potara] or attacks") still refused, BT6-036's later
 * condition still not a gate; and on the VM, both seats, the records through a
 * stored-row JSON round trip and every action through a state JSON round
 * trip: it fires on a successful [Union] entry ([Union-Fusion] BT5-039,
 * [Union-Absorb] onto BT14-114), not on an ordinary play (never pended), not
 * on a [Union] play a [Counter: Play] placed in the Drop or returned to the
 * hand, not on a play by another [Union] variant than the one named, and still
 * on a copy KO'd before the Auto resolves. Printed texts:
 * docs/arena-backlog/evidence/923/inventory.json (`catalogContext`, catalog
 * snapshot of 15 Oct 2026). Costs, powers and the companion cards are synthetic.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { unionPlayGate } from "../../src/lib/arena/vm/triggers";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, Color, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── printed texts (the 15 Oct 2026 catalog snapshot in the repo) ──────────────
interface Printed { name: string; card_type: string; colors: string[]; characters: string[]; traits: string[]; skill: string | null }
const catalog = (JSON.parse(readFileSync(new URL("../../docs/arena-backlog/evidence/923/inventory.json", import.meta.url), "utf8")) as { catalogContext: Record<string, Printed> }).catalogContext;
const printed = (id: string): CardDef => {
  const c = catalog[id];
  assert.ok(c?.skill, `${id} is in the fixture`);
  return card(id.replace(/-/g, ""), { name: c.name, type: c.card_type as CardDef["type"], colors: c.colors as Color[], characters: c.characters, traits: c.traits, power: 15000, energyCost: 2, skill: c.skill });
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
  // `upTo: false` is the selector default and the language does not print it (P-109's deck choice).
  const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (k, x) => (k === "upTo" && x === false ? undefined : x)));
  assert.deepEqual(plain(round.value), plain(rule), `${what}: …unchanged`);
}
/** Each card's [Auto], the program inside its gate, and what stays unread (none: BT7-123's "add them to their energy in Rest Mode" is read since `union-leftovers-930.ts`). */
const CARDS: [string, number, unknown[], string[]][] = [
  ["BT14-114", 10, [{ op: "draw", n: 1 }], []],
  ["BT5-039", 20, [{ op: "draw", n: 2 }], []],
  ["BT2-085", 20, ["draw", "choose", "ko"], []],
  ["BT4-108", 20, ["discard", "grant"], []],
  ["BT7-123", 30, ["reveal", "choose", "moveTo"], []],
  ["P-109", 30, ["choose", "moveTo"], []],
  ["BT28-097", 20, ["choose", "negateSkills", "ko"], []],
  ["BT28-099", 20, [{ op: "grant", target: { sel: { special: "self" } }, keyword: { name: "Barrier" }, until: "nextTurn" }], []],
];
for (const [id, index, ops, unread] of CARDS) {
  const r = skillRecords(printed(id)).find((x) => x.skillIndex === index && x.side === "front");
  assert.ok(r, `${id} front#${index} exists`);
  assert.equal(r.kind, "auto", `${id}: an [Auto]`);
  assert.deepEqual(r.trigger, ["played"], `${id}: the moment is still \`played\``);
  assert.deepEqual(r.cond, UNION, `${id}: gated by playedUsing(self, Union)`);
  assert.deepEqual(r.unread, unread, `${id}: nothing newly unread`);
  if (typeof ops[0] === "string") assert.deepEqual(r.ops.map((o) => o.op).filter((o, i, a) => a.indexOf(o) === i), ops, `${id}: the effect inside the gate`);
  else assert.deepEqual(r.ops, ops, `${id}: the effect inside the gate`);
  assert.equal(unionPlayGate([{ op: "if", cond: r.cond!, then: r.ops }]), "Union", `${id}: the VM reads it as a gate`);
  if (!unread.length) language(r, `${id} front#${index}`);
}
{
  // BT4-019 front#30: "…played using [union-potara] or attacks" — one half
  // gated, the other not, has no reading here: still refused, not widened.
  const r = skillRecords(printed("BT4-019")).find((x) => x.skillIndex === 30)!;
  assert.ok(r.unread.length > 0, "BT4-019 front#30 stays unread");
  assert.equal(r.cond, null);
  // BT6-036's "…and if this card was played using [union], draw 1 more card": a later condition, not a gate.
  const v = skillRecords(card("V", { skill: "[auto] When you play this card, draw 1 card, and if this card was played using [union], draw 1 more card." }))[0];
  assert.equal(v.cond, null);
  assert.equal(unionPlayGate(v.ops), null, "BT6-036: the Auto answers every play");
  // A named variant gates on that variant only; the three spellings of the bare one read alike.
  const one = (skill: string) => skillRecords(card("N", { skill }))[0];
  for (const [text, what] of [
    ["[Auto] When this card is played using [Union-Potara], draw 1 card.", "Union-Potara"],
    ["[Auto] When you play this card with [union-fusion], draw 1 card.", "Union-Fusion"],
    ["[Auto] When this card is played by a [Union-Absorb] skill, draw 1 card.", "Union-Absorb"],
    ["[Auto] When this card is played by the [Union] skill, draw 1 card.", "Union"],
  ] as const) {
    const r = one(text);
    assert.deepEqual([r.trigger, r.cond, r.unread], [["played"], { ...UNION, what }, []], text);
    language(r, text);
  }
  // Not the card's own play: "When your <Gogeta> card is played by a [union] skill" (BT22-033) is not this reading.
  assert.equal(one("[Auto] When your <Gogeta> card is played by a [Union] skill, draw 1 card.").cond?.kind === "playedUsing", false);
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const blue = (id: string, o: Partial<CardDef>): CardDef => card(id, { colors: ["Blue"], power: 10000, energyCost: 1, skill: null, ...o });
const counter = (id: string, skill: string): CardDef => card(id, { type: "EXTRA", energyCost: 0, comboCost: null, comboPower: null, skill });
const FUSION_LINE = "[union-fusion]{u}{u}: <Son Goten> and <Trunks: Youth> (Place 1 each of the specified card with the same power from your hand into your Drop Area and play this card.)";
const defs: Record<string, CardDef> = {
  ...DEFS,
  BT5039: { ...printed("BT5-039"), id: "BT5039", power: 20000, energyCost: 1 },
  BT14114: { ...printed("BT14-114"), id: "BT14114", colors: ["Blue"], energyCost: 2 },
  // A named variant, synthetic: a [Union-Fusion] card whose Auto names another variant, and one naming its own.
  NVPOT: blue("NVPOT", { name: "Gate Potara", characters: ["Gotenks"], energyCost: 1, skill: `${FUSION_LINE}\n[Auto] When this card is played using [Union-Potara], draw 1 card.` }),
  NVFUS: blue("NVFUS", { name: "Gate Fusion", characters: ["Gotenks"], energyCost: 1, skill: `${FUSION_LINE}\n[Auto] When this card is played using [Union-Fusion], draw 1 card.` }),
  // Plays a <Super 17> from the deck on top of itself by its own [Union-Absorb] (22-13-6-3).
  ABS17: blue("ABS17", { name: "Absorber", characters: ["Hell Fighter 17"], skill: "[Union Absorb] Choose 1 of your Battle Cards and place it under this card: Choose up to 1 <Super 17> with an energy cost of 4 or less from your deck, and play it on top of this card. Then, shuffle your deck." }),
  GOTEN: blue("GOTEN", { characters: ["Son Goten"] }),
  TRUNKS: blue("TRUNKS", { characters: ["Trunks: Youth"] }),
  "B-E": blue("B-E", { characters: ["Filler"] }),
  MAT: blue("MAT", { characters: ["Filler"] }),
  CDROP: counter("CDROP", "[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played."),
  CRET: counter("CRET", "[Counter: Play] The Battle Card being played is returned to its owner's hand instead of being played."),
  CKO: counter("CKO", "[Counter: Play] Choose 1 of your opponent's Battle Cards and KO it."),
  KOER: blue("KOER", { characters: ["Filler"], skill: "[Auto] When you play a card, choose 1 of your Battle Cards and KO it." }),
};
for (const d of ["ABS17", "NVPOT", "NVFUS"]) for (const r of skillRecords(defs[d])) assert.deepEqual(r.unread, [], `${d}: read`);

const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

/** Every event the actions produced, for telling whether an [Auto] was triggered at all. */
let events: GameEvent[] = [];
function take(s: VmState, action: Action): VmState {
  const out = RULES.apply(ctx, roundtrip(s), action);
  events.push(...roundtrip(out.events));
  return roundtrip(out.state as VmState);
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
  // A card searched for stays in the middle of the deck, away from the draws.
  const id = area === "deck" ? deck[Math.floor(deck.length / 2)] : deck.at(-1)!;
  s.cards[id].cardId = def;
  if (area === "deck") return id;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy") s.cards[id].mode = "active";
  return id;
}
const unionLine = (def: string) => parseSkills(defs[def].skill!).find((sk) => sk.keyword?.name === "Union")!.index;
const autoLine = (def: string) => parseSkills(defs[def].skill!).find((sk) => sk.kind === "auto" && /union/i.test(sk.raw))!.index;
const offer = (s: VmState, c: string, skill: number) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === skill);
const playOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && l.action.card === c);
const deckOf = (s: VmState, p: PlayerId) => s.sides[p].zones.deck.length;

interface Run { s: VmState; pended: boolean }
/**
 * Run to the Main Phase, every state reloaded; the opponent answers a counter
 * window with `answer` (null: decline) — the window before the play lands, or
 * with `landed` the one after a [Union] play has landed (#929). `steer`
 * answers a prompt first when it returns an action. `pended` says whether the
 * watched card's gated [Auto] was ever pending.
 */
function settle(s0: VmState, seat: PlayerId, watch: { card: string; skill: number }, answer: (s: VmState) => string | null = () => null, landed = false, steer: (s: VmState) => Action | null = () => null): Run {
  let s = s0;
  let pended = false;
  // Pending at an action's end, or resolved inside one (its declaration or resolution is an event).
  const look = (q: VmState) => {
    if (q.pending.some((p) => p.card === watch.card && p.skillIndex === watch.skill && p.kind !== "hook")) pended = true;
    if (events.some((e) => (e.type === "skill" || e.type === "autoDeclared") && e.card === watch.card && e.skill === watch.skill)) pended = true;
  };
  look(s);
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
    look(s);
  }
  assert.equal(s.prompt.kind, "main", `back at the Main Phase (at ${s.prompt.kind})`);
  assert.equal(s.turnPlayer, seat);
  return { s, pended };
}
const foeCounter = (kind: string) => (q: VmState) => q.sides[other(q.turnPlayer)].zones.hand.find((c) => q.cards[c].cardId === kind) ?? null;
/** KOER's [Auto] goes first and KOs `victim` before the victim's own on-play [Auto] resolves (9-6-6). */
const koFirst = (seat: PlayerId, victim: string) => (s: VmState): Action | null => {
  const q = s.prompt;
  if (q.kind === "orderPending" && q.player === seat) {
    const i = q.candidates.find((n) => s.pending[n]?.card !== victim && s.cards[s.pending[n]!.card]?.cardId === "KOER");
    if (i !== undefined) return { type: "orderPending", player: seat, index: i } as Action;
  }
  if (q.kind === "chooseCards" && q.player === seat && q.choice.candidates.includes(victim)) return { type: "choose", player: seat, cards: [victim] } as Action;
  return null;
};

/** A [Union-Fusion] card in hand with blue energy and its two materials (same power) in hand. */
function fusionBoard(seat: PlayerId, seed: number, which: "BT5039" | "NVPOT" | "NVFUS", o: { counter?: "CDROP" | "CRET" | "CKO"; koer?: boolean } = {}) {
  const s = fresh(seat, seed);
  for (let i = 0; i < 5; i++) stage(s, seat, "B-E", "energy");
  stage(s, seat, "GOTEN", "hand");
  stage(s, seat, "TRUNKS", "hand");
  if (o.koer) stage(s, seat, "KOER", "battle");
  const union = stage(s, seat, which, "hand");
  if (o.counter) stage(s, other(seat), o.counter, "hand");
  return { s, union, watch: { card: union, skill: autoLine(which) } };
}
function unionPlay(b: ReturnType<typeof fusionBoard>, seat: PlayerId, which: string, answer?: (s: VmState) => string | null, landed = false, steer?: (s: VmState) => Action | null): Run {
  const a = offer(b.s, b.union, unionLine(which));
  assert.ok(a, `${seat}: ${which}'s [Union] is offered`);
  events = [];
  return settle(take(b.s, a.action), seat, b.watch, answer, landed, steer);
}
function ordinaryPlay(s: VmState, seat: PlayerId, c: string, watch: { card: string; skill: number }, steer?: (s: VmState) => Action | null): Run {
  const p = playOf(s, c);
  assert.ok(p, `${seat}: ${c} can be played ordinarily`);
  events = [];
  return settle(take(s, p.action), seat, watch, undefined, false, steer);
}

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const seed = 9310 + (seat === "p1" ? 0 : 50);

  // ── BT5-039 front#20, "when you play this card with [union], draw 2 cards" ──
  // (a) A successful [Union-Fusion] entry: it fires, 2 drawn.
  {
    const b = fusionBoard(seat, seed + 1, "BT5039");
    const d0 = deckOf(b.s, seat);
    const r = unionPlay(b, seat, "BT5039");
    assert.ok(r.s.sides[seat].zones.battle.includes(b.union), "Gotenks is in play");
    assert.equal(r.s.cards[b.union].enteredUsing, "Union-Fusion");
    assert.ok(r.pended, "the Auto was triggered");
    assert.equal(d0 - deckOf(r.s, seat), 2, `${seat}: a [Union] entry draws 2`);
    cases++;
  }
  // (b) An ordinary play: never triggered, nothing drawn.
  {
    const b = fusionBoard(seat, seed + 2, "BT5039");
    const d0 = deckOf(b.s, seat);
    const r = ordinaryPlay(b.s, seat, b.union, b.watch);
    assert.ok(r.s.sides[seat].zones.battle.includes(b.union), "played ordinarily");
    assert.equal(r.pended, false, `${seat}: an ordinary play does not trigger it (it is never pending)`);
    assert.equal(d0 - deckOf(r.s, seat), 0, "nothing drawn");
    cases++;
  }
  // (c) A [Union-Fusion] play a [Counter: Play] placed in the Drop instead: never entered, never triggered.
  {
    const b = fusionBoard(seat, seed + 3, "BT5039", { counter: "CDROP" });
    const d0 = deckOf(b.s, seat);
    const r = unionPlay(b, seat, "BT5039", foeCounter("CDROP"));
    assert.ok(r.s.sides[seat].zones.drop.includes(b.union) && !r.s.sides[seat].zones.battle.includes(b.union), "never entered play");
    assert.ok(r.s.sides[other(seat)].zones.drop.some((c) => r.s.cards[c].cardId === "CDROP"), "the counter was used");
    assert.equal(r.pended, false, `${seat}: a negated [Union] play does not trigger it`);
    assert.equal(d0 - deckOf(r.s, seat), 0);
    cases++;
  }
  // (d) Returned to the hand instead of being played, then played ordinarily: neither triggers it.
  {
    const b = fusionBoard(seat, seed + 4, "BT5039", { counter: "CRET" });
    const d0 = deckOf(b.s, seat);
    const r = unionPlay(b, seat, "BT5039", foeCounter("CRET"));
    assert.ok(r.s.sides[seat].zones.hand.includes(b.union), "returned to the hand");
    assert.equal(r.pended, false, `${seat}: a returned [Union] play does not trigger it`);
    const r2 = ordinaryPlay(r.s, seat, b.union, b.watch);
    assert.equal(r2.pended, false, "the returned copy played ordinarily does not either");
    assert.equal(d0 - deckOf(r2.s, seat), 0, "nothing drawn");
    cases++;
  }
  // (e) Owner's ruling: a [Union] entry KO'd by a [Counter: Play] after it landed
  // (#929's second window), before the Auto resolves, still draws 2.
  {
    const b = fusionBoard(seat, seed + 5, "BT5039", { counter: "CKO" });
    const d0 = deckOf(b.s, seat);
    const r = unionPlay(b, seat, "BT5039", foeCounter("CKO"), true);
    assert.ok(r.s.sides[seat].zones.drop.includes(b.union), "KO'd after it landed");
    assert.ok(r.s.sides[other(seat)].zones.drop.some((c) => r.s.cards[c].cardId === "CKO"), "the counter was used");
    assert.equal(r.s.cards[b.union].enteredUsing, undefined, "the copy's memory went with it (3-1-4)…");
    assert.equal(d0 - deckOf(r.s, seat), 2, `${seat}: …but it entered via [Union]: drew 2`);
    cases++;
  }
  // (f) The same, KO'd by the seat's own [Auto] ordered first.
  {
    const b = fusionBoard(seat, seed + 6, "BT5039", { koer: true });
    const d0 = deckOf(b.s, seat);
    const r = unionPlay(b, seat, "BT5039", undefined, false, koFirst(seat, b.union));
    assert.ok(r.s.sides[seat].zones.drop.includes(b.union), "KO'd before its Auto resolved");
    assert.equal(d0 - deckOf(r.s, seat), 2, `${seat}: a [Union] entry: drew 2`);
    cases++;
  }

  // ── the named-variant gate ──
  // (g) "…played using [Union-Potara]" on a card played by [Union-Fusion]: another variant, never triggered.
  {
    const b = fusionBoard(seat, seed + 7, "NVPOT");
    const d0 = deckOf(b.s, seat);
    const r = unionPlay(b, seat, "NVPOT");
    assert.equal(r.s.cards[b.union].enteredUsing, "Union-Fusion", "a successful [Union-Fusion] entry");
    assert.equal(r.pended, false, `${seat}: the [Union-Potara] gate rejects a [Union-Fusion] entry`);
    assert.equal(d0 - deckOf(r.s, seat), 0);
    cases++;
  }
  // (h) "…played using [Union-Fusion]" on the same entry: it fires.
  {
    const b = fusionBoard(seat, seed + 8, "NVFUS");
    const d0 = deckOf(b.s, seat);
    const r = unionPlay(b, seat, "NVFUS");
    assert.ok(r.pended, `${seat}: the named variant's own entry triggers it`);
    assert.equal(d0 - deckOf(r.s, seat), 1);
    cases++;
  }

  // ── BT14-114 front#10, "when this card is played using [Union], draw 1 card" ──
  // (i) Played on top of another card by that card's [Union-Absorb] (owner's ruling: it counts).
  {
    const s = fresh(seat, seed + 9);
    const abs = stage(s, seat, "ABS17", "battle");
    const mat = stage(s, seat, "MAT", "battle");
    const s17 = stage(s, seat, "BT14114", "deck");
    const watch = { card: s17, skill: autoLine("BT14114") };
    const a = offer(s, abs, unionLine("ABS17"));
    assert.ok(a, `${seat}: the [Union-Absorb] is offered`);
    const d0 = deckOf(s, seat);
    events = [];
    const r = settle(take(s, a.action), seat, watch, undefined, false, (q) => {
      const p = q.prompt;
      if (p.kind === "chooseCards" && p.choice.candidates.includes(mat)) return { type: "choose", player: seat, cards: [mat] } as Action;
      if (p.kind === "chooseCards" && p.choice.candidates.includes(s17)) return { type: "choose", player: seat, cards: [s17] } as Action;
      return null;
    });
    assert.ok(r.s.sides[seat].zones.battle.includes(s17) && r.s.cards[s17].under.includes(abs), "Super 17 is on top of the absorber");
    assert.equal(r.s.cards[s17].enteredUsing, "Union-Absorb");
    assert.ok(r.pended, `${seat}: another card's [Union-Absorb] play triggers it`);
    assert.equal(d0 - 1 - deckOf(r.s, seat), 1, "drew 1 (the searched card aside)");
    cases++;
  }
  // (j) The same card played ordinarily from the hand: never triggered.
  {
    const s = fresh(seat, seed + 10);
    for (let i = 0; i < 3; i++) stage(s, seat, "B-E", "energy");
    const s17 = stage(s, seat, "BT14114", "hand");
    const d0 = deckOf(s, seat);
    const r = ordinaryPlay(s, seat, s17, { card: s17, skill: autoLine("BT14114") });
    assert.ok(r.s.sides[seat].zones.battle.includes(s17));
    assert.equal(r.pended, false, `${seat}: BT14-114 played ordinarily does not trigger it`);
    assert.equal(d0 - deckOf(r.s, seat), 0);
    cases++;
  }
}

console.log(`union-play-triggers-930: 8 "when this card is played using [Union]" Autos gated on a successful [Union] entry (named variant: that one only), ${cases} both-seat reload cases`);
