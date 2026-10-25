/**
 * #930, the [Auto] triggers about ANOTHER card's [Union] play: "When your
 * Blue/Yellow multicolor <Gogeta> card is played by a [union] skill"
 * (BT22-033 front#10), "When your blue <Gotenks> card is played by a [Union]
 * skill" (BT25-036 back#10 and back#20), "When your <Gotenks> with an energy
 * cost of 8 is played by a [Union] skill" (P-682 front#10, behind its price)
 * and "When you play a Battle Card using a [Union-Fusion] skill" (BT12-122
 * front#0 and back#0).
 *
 * They compiled with no trigger at all, so they never fired. The reading now:
 * `youPlayed` — the played card is the subject, and "your" includes the card
 * itself, as for every `youPlayed` moment — with the description kept as the
 * condition on the subject and, beside it in an `all`, `playedUsing(sel:
 * subject, what: Union)` (a named variant, "[Union-Fusion]", that one only).
 * The VM honours both as a trigger condition (`resolvePlay` with
 * `unionPlayedGate`): the Auto is withdrawn from any play that is not a
 * successful entry by the named [Union] keyword's own play of a card the
 * description meets, so it is never pending and uses no [Once per turn]; the
 * Autos that entry pended carry the subject's entry
 * (`VmPending.subjectEnteredUsing`), so a card KO'd before the Auto resolves
 * still counts (owner's ruling, 25 Oct 2026), and a card played by another
 * card's [Union-Absorb] counts (owner's ruling).
 *
 * Proved here: the six records from their printed texts (shape, nothing
 * unread, the rules language round trip); and on the VM, both seats, the
 * records through a stored-row JSON round trip and every action through a
 * state JSON round trip: it fires when a matching card enters via [Union]
 * (also another card's [Union-Absorb], and the watcher's own entry), not on
 * the same card's ordinary play, not on a [Union] play a [Counter: Play]
 * placed in the Drop or returned to the hand, not for a card the description
 * refuses (and its [Once per turn] is still unused), not for the opponent's
 * card, the named [Union-Fusion] gate rejects a [Union-Absorb] entry, and a
 * card KO'd after it landed still counts. Printed texts:
 * docs/arena-backlog/evidence/923/inventory.json (`catalogContext`, catalog
 * snapshot of 15 Oct 2026). The VM watchers carry those printed lines on
 * synthetic Battle Cards; costs, powers and the played cards are synthetic.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { unionPlayedGate } from "../../src/lib/arena/vm/triggers";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { parseFilter } from "../../src/lib/arena/text/filters";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, Color, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── printed texts (the 15 Oct 2026 catalog snapshot in the repo) ──────────────
interface Printed { name: string; back_name: string | null; card_type: string; colors: string[]; characters: string[]; traits: string[]; skill: string | null; back_skill: string | null }
const catalog = (JSON.parse(readFileSync(new URL("../../docs/arena-backlog/evidence/923/inventory.json", import.meta.url), "utf8")) as { catalogContext: Record<string, Printed> }).catalogContext;
const printed = (id: string): CardDef => {
  const c = catalog[id];
  assert.ok(c?.skill, `${id} is in the fixture`);
  return card(id.replace(/-/g, ""), {
    name: c.name, type: c.card_type as CardDef["type"], colors: c.colors as Color[], characters: c.characters, traits: c.traits, power: 15000, energyCost: 2, skill: c.skill,
    ...(c.back_skill ? { back: { name: c.back_name ?? c.name, power: 20000, skill: c.back_skill } } : {}),
  });
};
/** One printed line of a fixture card, by its face and index. */
const line = (id: string, side: "front" | "back", index: number): string => {
  const c = catalog[id];
  const sk = parseSkills((side === "front" ? c.skill : c.back_skill)!).find((x) => x.index === index);
  assert.ok(sk, `${id} ${side}#${index} is printed`);
  return sk.raw;
};

// ── 1. the records ───────────────────────────────────────────────────────────
type Rec = ReturnType<typeof skillRecords>[number];
const asRule = (rec: Rec) => JSON.parse(JSON.stringify({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops })) as Rule;
function language(rec: Rec, what: string): void {
  const rule = asRule(rec);
  assert.equal(validateRule(rule, rec.kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (k, x) => (k === "upTo" && x === false ? undefined : x)));
  assert.deepEqual(plain(round.value), plain(rule), `${what}: …unchanged`);
}
const f = (text: string) => parseFilter(text.toLowerCase());
/** Each record: face, index, the gate's [Union] keyword, the played card's description, the effect's ops, and [Once per turn]. */
const CARDS: [string, "front" | "back", number, string, ReturnType<typeof f>, string[], boolean][] = [
  ["BT22-033", "front", 10, "Union", f("Blue/Yellow multicolor <Gogeta> card"), ["draw", "choose", "moveTo"], true],
  ["BT25-036", "back", 10, "Union", f("blue <Gotenks> card"), ["draw"], true],
  ["BT25-036", "back", 20, "Union", f("blue <Gotenks> card"), ["choose", "moveTo"], false],
  ["P-682", "front", 10, "Union", f("<Gotenks> with an energy cost of 8"), ["discard"], false],
  ["BT12-122", "front", 0, "Union-Fusion", f("Battle Card"), ["draw"], true],
  ["BT12-122", "back", 0, "Union-Fusion", f("Battle Card"), ["draw"], true],
];
for (const [id, side, index, what, filter, ops, once] of CARDS) {
  const tag = `${id} ${side}#${index}`;
  const r = skillRecords(printed(id)).find((x) => x.skillIndex === index && x.side === side);
  assert.ok(r, `${tag} exists`);
  assert.equal(r.kind, "auto", `${tag}: an [Auto]`);
  assert.deepEqual(r.trigger, ["youPlayed"], `${tag}: the moment is \`youPlayed\` (it had none)`);
  assert.deepEqual(r.unread, [], `${tag}: nothing unread`);
  assert.equal(r.usage.oncePerTurn, once, `${tag}: [Once per turn] as printed`);
  const program = [{ op: "if" as const, cond: r.cond!, then: r.ops }];
  const gate = unionPlayedGate(program, "subject");
  assert.ok(gate, `${tag}: the VM reads a gate`);
  assert.equal(gate.what, what, `${tag}: gated on ${what}`);
  assert.deepEqual(gate.filter, filter, `${tag}: the description is the subject's condition`);
  assert.equal(unionPlayedGate(program, "self"), null, `${tag}: not about this card's own play`);
  // The gate is the innermost IF of the chain, the effect inside it.
  let inner = r.ops;
  let gateCond = r.cond!;
  while (inner.length === 1 && inner[0].op === "if" && !inner[0].else) { gateCond = inner[0].cond; inner = inner[0].then; }
  assert.deepEqual(gateCond, { kind: "all", conds: [{ kind: "count", sel: { special: "subject", filter }, atLeast: 1 }, { kind: "playedUsing", sel: { special: "subject" }, what }] }, `${tag}: description AND playedUsing(subject, ${what})`);
  assert.deepEqual(inner.map((o) => o.op).filter((o, i, a) => a.indexOf(o) === i), ops, `${tag}: the effect inside the gate`);
  language(r, tag);
}
{
  // P-682's price and its condition are unchanged: the gate sits inside the price's condition.
  const r = skillRecords(printed("P-682")).find((x) => x.skillIndex === 10)!;
  assert.equal(r.cost?.text, "If your Leader is a green card with <Gotenks> in its character name, you have 4 or more energy, and you remove this card from the game");
  assert.equal(r.cond?.kind, "all");
  assert.ok(r.cost?.program, "the removal is the price");
  // The self reading of #1177 and this one do not overlap, and the spellings read alike.
  const one = (skill: string) => skillRecords(card("N", { skill }))[0];
  assert.deepEqual(one("[Auto] When this card is played by a [Union] skill, draw 1 card.").trigger, ["played"]);
  for (const [text, what] of [
    ["[Auto] When your <Gotenks> card is played using [Union-Potara], draw 1 card.", "Union-Potara"],
    ["[Auto] When your <Gotenks> card is played by a [Union-Absorb] skill, draw 1 card.", "Union-Absorb"],
    ["[Auto] When you play a <Gotenks> card using a [Union] skill, draw 1 card.", "Union"],
  ] as const) {
    const r = one(text);
    assert.deepEqual([r.trigger, r.unread, unionPlayedGate([{ op: "if", cond: r.cond!, then: r.ops }], "subject")?.what], [["youPlayed"], [], what], text);
  }
  // The opponent's card is not this reading (no `youPlayed`), nor is a description the filter cannot read whole.
  assert.notDeepEqual(one("[Auto] When your opponent's <Gotenks> card is played by a [Union] skill, draw 1 card.").trigger, ["youPlayed"]);
  // A plain "when your <X> card is played" is unchanged: no gate.
  const plain = one("[Auto] When your blue <Gotenks> card is played, draw 1 card.");
  assert.deepEqual(plain.trigger, ["youPlayed"]);
  assert.equal(unionPlayedGate([{ op: "if", cond: plain.cond!, then: plain.ops }], "subject"), null, "an ungated youPlayed stays ungated");
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const blue = (id: string, o: Partial<CardDef>): CardDef => card(id, { colors: ["Blue"], power: 10000, energyCost: 1, skill: null, ...o });
const counter = (id: string, skill: string): CardDef => card(id, { type: "EXTRA", energyCost: 0, comboCost: null, comboPower: null, skill });
const FUSION_LINE = "[union-fusion]{u}{u}: <Son Goten> and <Trunks: Youth> (Place 1 each of the specified card with the same power from your hand into your Drop Area and play this card.)";
const W25_LINE = line("BT25-036", "back", 10);
const W12_LINE = line("BT12-122", "front", 0);
assert.equal(W25_LINE, "[Auto][Once per turn] When your blue <Gotenks> card is played by a [Union] skill, draw 1 card.");
assert.equal(W12_LINE, "[Auto][Once per turn] When you play a Battle Card using a [Union-Fusion] skill, draw 1 card.");
const defs: Record<string, CardDef> = {
  ...DEFS,
  // Watchers in the Battle Area carrying the printed lines.
  W25: blue("W25", { name: "Gotenks watcher", characters: ["Filler"], skill: W25_LINE }),
  W12: blue("W12", { name: "Fusion watcher", characters: ["Filler"], skill: W12_LINE }),
  W17: blue("W17", { name: "Super 17 watcher", characters: ["Filler"], skill: "[Auto] When your <Super 17> card is played by a [Union] skill, draw 1 card." }),
  // The played cards: a blue <Gotenks> and a blue <Vegito> by [Union-Fusion]; a <Gotenks> watching its own entry.
  GFUS: blue("GFUS", { name: "Fusion Gotenks", characters: ["Gotenks"], skill: FUSION_LINE }),
  VFUS: blue("VFUS", { name: "Fusion Vegito", characters: ["Vegito"], skill: FUSION_LINE }),
  GSELF: blue("GSELF", { name: "Self Gotenks", characters: ["Gotenks"], skill: `${FUSION_LINE}\n${W25_LINE}` }),
  // Plays a <Super 17> from the deck on top of itself by its own [Union-Absorb] (22-13-6-3).
  ABS17: blue("ABS17", { name: "Absorber", characters: ["Hell Fighter 17"], skill: "[Union Absorb] Choose 1 of your Battle Cards and place it under this card: Choose up to 1 <Super 17> with an energy cost of 4 or less from your deck, and play it on top of this card. Then, shuffle your deck." }),
  S17: blue("S17", { name: "Super 17", characters: ["Super 17"], energyCost: 4 }),
  GOTEN: blue("GOTEN", { characters: ["Son Goten"] }),
  TRUNKS: blue("TRUNKS", { characters: ["Trunks: Youth"] }),
  "B-E": blue("B-E", { characters: ["Filler"] }),
  MAT: blue("MAT", { characters: ["Filler"] }),
  CDROP: counter("CDROP", "[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played."),
  CRET: counter("CRET", "[Counter: Play] The Battle Card being played is returned to its owner's hand instead of being played."),
  CKO: counter("CKO", "[Counter: Play] Choose 1 of your opponent's Battle Cards and KO it."),
};
for (const d of ["W25", "W12", "W17", "GFUS", "VFUS", "GSELF", "ABS17"]) for (const r of skillRecords(defs[d])) assert.deepEqual(r.unread, [], `${d}: read`);

const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

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
  const id = area === "deck" ? deck[Math.floor(deck.length / 2)] : deck.at(-1)!;
  s.cards[id].cardId = def;
  if (area === "deck") return id;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy") s.cards[id].mode = "active";
  return id;
}
const unionLine = (def: string) => parseSkills(defs[def].skill!).find((sk) => sk.keyword?.name === "Union")!.index;
const autoLine = (def: string) => parseSkills(defs[def].skill!).find((sk) => sk.kind === "auto")!.index;
const offer = (s: VmState, c: string, skill: number) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === skill);
const playOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && l.action.card === c);
const deckOf = (s: VmState, p: PlayerId) => s.sides[p].zones.deck.length;

interface Watch { card: string; skill: number }
interface Run { s: VmState; pended: Set<string> }
/**
 * Run to the Main Phase, every state reloaded; the opponent answers a counter
 * window with `answer` — before the play lands, or with `landed` after it has
 * (#929). `pended` names each watched card whose watched [Auto] was ever pending.
 */
function settle(s0: VmState, seat: PlayerId, watches: Watch[], answer: (s: VmState) => string | null = () => null, landed = false, steer: (s: VmState) => Action | null = () => null): Run {
  let s = s0;
  const pended = new Set<string>();
  const look = (q: VmState) => {
    for (const w of watches) {
      if (q.pending.some((p) => p.card === w.card && p.skillIndex === w.skill && p.kind !== "hook")) pended.add(w.card);
      if (events.some((e) => (e.type === "skill" || e.type === "autoDeclared") && e.card === w.card && e.skill === w.skill)) pended.add(w.card);
    }
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

/** A [Union-Fusion] card in hand with blue energy and its two materials in hand, and watchers in play. */
function board(seat: PlayerId, seed: number, which: "GFUS" | "VFUS" | "GSELF", o: { counter?: "CDROP" | "CRET" | "CKO"; mine?: string[]; theirs?: string[]; twice?: boolean } = {}) {
  const s = fresh(seat, seed);
  for (let i = 0; i < (o.twice ? 10 : 5); i++) stage(s, seat, "B-E", "energy");
  for (let i = 0; i < (o.twice ? 2 : 1); i++) { stage(s, seat, "GOTEN", "hand"); stage(s, seat, "TRUNKS", "hand"); }
  const watchers: Record<string, string> = {};
  for (const w of o.mine ?? []) watchers[w] = stage(s, seat, w, "battle");
  for (const w of o.theirs ?? []) watchers[`foe:${w}`] = stage(s, other(seat), w, "battle");
  const union = stage(s, seat, which, "hand");
  if (o.counter) stage(s, other(seat), o.counter, "hand");
  return { s, union, watchers };
}
const watchOf = (b: { watchers: Record<string, string> }, key: string): Watch => ({ card: b.watchers[key], skill: autoLine(key.replace(/^foe:/, "")) });
function unionPlay(s: VmState, c: string, which: string, seat: PlayerId, watches: Watch[], answer?: (s: VmState) => string | null, landed = false, steer?: (s: VmState) => Action | null): Run {
  const a = offer(s, c, unionLine(which));
  assert.ok(a, `${seat}: ${which}'s [Union] is offered`);
  events = [];
  return settle(take(s, a.action), seat, watches, answer, landed, steer);
}
function ordinaryPlay(s: VmState, seat: PlayerId, c: string, watches: Watch[]): Run {
  const p = playOf(s, c);
  assert.ok(p, `${seat}: ${c} can be played ordinarily`);
  events = [];
  return settle(take(s, p.action), seat, watches);
}

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const seed = 9330 + (seat === "p1" ? 0 : 50);

  // (a) BT25-036 back#10's line watching a blue <Gotenks> entering by [Union-Fusion]; BT12-122's line ([Union-Fusion], a Battle Card) too.
  {
    const b = board(seat, seed + 1, "GFUS", { mine: ["W25", "W12"] });
    const d0 = deckOf(b.s, seat);
    const r = unionPlay(b.s, b.union, "GFUS", seat, [watchOf(b, "W25"), watchOf(b, "W12")]);
    assert.ok(r.s.sides[seat].zones.battle.includes(b.union), "Gotenks entered");
    assert.equal(r.s.cards[b.union].enteredUsing, "Union-Fusion");
    assert.ok(r.pended.has(b.watchers.W25), `${seat}: "your blue <Gotenks> card … by a [Union] skill" fires`);
    assert.ok(r.pended.has(b.watchers.W12), `${seat}: "a Battle Card using a [Union-Fusion] skill" fires`);
    assert.equal(d0 - deckOf(r.s, seat), 2, "each drew 1");
    cases++;
  }
  // (b) The same card played ordinarily: neither is ever pending.
  {
    const b = board(seat, seed + 2, "GFUS", { mine: ["W25", "W12"] });
    const d0 = deckOf(b.s, seat);
    const r = ordinaryPlay(b.s, seat, b.union, [watchOf(b, "W25"), watchOf(b, "W12")]);
    assert.ok(r.s.sides[seat].zones.battle.includes(b.union), "played ordinarily");
    assert.equal(r.pended.size, 0, `${seat}: an ordinary play triggers neither`);
    assert.equal(d0 - deckOf(r.s, seat), 0);
    cases++;
  }
  // (c) A [Union] play a [Counter: Play] placed in the Drop instead: never triggered.
  {
    const b = board(seat, seed + 3, "GFUS", { mine: ["W25"], counter: "CDROP" });
    const d0 = deckOf(b.s, seat);
    const r = unionPlay(b.s, b.union, "GFUS", seat, [watchOf(b, "W25")], foeCounter("CDROP"));
    assert.ok(r.s.sides[seat].zones.drop.includes(b.union), "never entered");
    assert.ok(r.s.sides[other(seat)].zones.drop.some((c) => r.s.cards[c].cardId === "CDROP"), "the counter was used");
    assert.equal(r.pended.size, 0, `${seat}: a negated [Union] play does not trigger it`);
    assert.equal(d0 - deckOf(r.s, seat), 0);
    cases++;
  }
  // (d) Returned to the hand instead, then played ordinarily: neither triggers it.
  {
    const b = board(seat, seed + 4, "GFUS", { mine: ["W25"], counter: "CRET" });
    const d0 = deckOf(b.s, seat);
    const r = unionPlay(b.s, b.union, "GFUS", seat, [watchOf(b, "W25")], foeCounter("CRET"));
    assert.ok(r.s.sides[seat].zones.hand.includes(b.union), "returned to the hand");
    assert.equal(r.pended.size, 0, `${seat}: a returned [Union] play does not trigger it`);
    const r2 = ordinaryPlay(r.s, seat, b.union, [watchOf(b, "W25")]);
    assert.equal(r2.pended.size, 0, "nor its later ordinary play");
    assert.equal(d0 - deckOf(r2.s, seat), 0);
    cases++;
  }
  // (e) A card the description refuses (a blue <Vegito>) entering by [Union]: not triggered, and the
  // [Once per turn] is still unused — a blue <Gotenks> entering by [Union] after it fires.
  {
    const b = board(seat, seed + 5, "VFUS", { mine: ["W25"], twice: true });
    const g = stage(b.s, seat, "GFUS", "hand");
    const d0 = deckOf(b.s, seat);
    const r = unionPlay(b.s, b.union, "VFUS", seat, [watchOf(b, "W25")]);
    assert.ok(r.s.sides[seat].zones.battle.includes(b.union) && r.s.cards[b.union].enteredUsing === "Union-Fusion", "Vegito entered by [Union]");
    assert.equal(r.pended.size, 0, `${seat}: a non-matching card does not trigger it`);
    assert.equal(d0 - deckOf(r.s, seat), 0);
    const r2 = unionPlay(r.s, g, "GFUS", seat, [watchOf(b, "W25")]);
    assert.ok(r2.pended.has(b.watchers.W25), `${seat}: [Once per turn] was not used by the refused card`);
    assert.equal(d0 - deckOf(r2.s, seat), 1);
    cases++;
  }
  // (f) The opponent's watcher: my card entering by [Union] is not "your" card for it.
  {
    const b = board(seat, seed + 6, "GFUS", { theirs: ["W25", "W12"] });
    const d1 = deckOf(b.s, other(seat));
    const r = unionPlay(b.s, b.union, "GFUS", seat, [watchOf(b, "foe:W25"), watchOf(b, "foe:W12")]);
    assert.ok(r.s.sides[seat].zones.battle.includes(b.union));
    assert.equal(r.pended.size, 0, `${seat}: the opponent's card does not trigger it`);
    assert.equal(d1 - deckOf(r.s, other(seat)), 0);
    cases++;
  }
  // (g) Owner's ruling: a card KO'd by a [Counter: Play] after it landed, before the Auto resolves, still counts.
  {
    const b = board(seat, seed + 7, "GFUS", { mine: ["W25"], counter: "CKO" });
    const d0 = deckOf(b.s, seat);
    // The opponent's counter KOs the Gotenks that has just landed.
    const koGotenks = (q: VmState): Action | null => q.prompt.kind === "chooseCards" && q.prompt.player === other(seat) && q.prompt.choice.candidates.includes(b.union) ? { type: "choose", player: other(seat), cards: [b.union] } as Action : null;
    const r = unionPlay(b.s, b.union, "GFUS", seat, [watchOf(b, "W25")], foeCounter("CKO"), true, koGotenks);
    assert.ok(r.s.sides[other(seat)].zones.drop.some((c) => r.s.cards[c].cardId === "CKO"), "the counter was used");
    assert.ok(r.s.sides[seat].zones.drop.includes(b.union), "the Gotenks was KO'd after it landed");
    assert.ok(r.s.sides[seat].zones.battle.includes(b.watchers.W25), "the watcher stayed");
    assert.equal(r.s.cards[b.union].enteredUsing, undefined, "its memory went with it (3-1-4)…");
    assert.ok(r.pended.has(b.watchers.W25));
    assert.equal(d0 - deckOf(r.s, seat), 1, `${seat}: …but it entered via [Union]: the watcher drew 1`);
    cases++;
  }
  // (h) "Your" includes the card itself (the `youPlayed` convention): a blue <Gotenks> carrying the line sees its own [Union] entry.
  {
    const b = board(seat, seed + 8, "GSELF");
    const d0 = deckOf(b.s, seat);
    const self = { card: b.union, skill: autoLine("GSELF") };
    const r = unionPlay(b.s, b.union, "GSELF", seat, [self]);
    assert.ok(r.pended.has(b.union), `${seat}: its own [Union] entry triggers it`);
    assert.equal(d0 - deckOf(r.s, seat), 1);
    const b2 = board(seat, seed + 9, "GSELF");
    const r2 = ordinaryPlay(b2.s, seat, b2.union, [{ card: b2.union, skill: autoLine("GSELF") }]);
    assert.equal(r2.pended.size, 0, "its ordinary play does not");
    cases++;
  }
  // (i) Another card's [Union-Absorb] plays a <Super 17> on top of itself: the bare [Union] watcher fires
  // (owner's ruling: it counts), BT12-122's named [Union-Fusion] gate rejects it.
  {
    const s = fresh(seat, seed + 10);
    const abs = stage(s, seat, "ABS17", "battle");
    const mat = stage(s, seat, "MAT", "battle");
    const w17 = stage(s, seat, "W17", "battle");
    const w12 = stage(s, seat, "W12", "battle");
    const s17 = stage(s, seat, "S17", "deck");
    const a = offer(s, abs, unionLine("ABS17"));
    assert.ok(a, `${seat}: the [Union-Absorb] is offered`);
    const d0 = deckOf(s, seat);
    events = [];
    const r = settle(take(s, a.action), seat, [{ card: w17, skill: autoLine("W17") }, { card: w12, skill: autoLine("W12") }], undefined, false, (q) => {
      const p = q.prompt;
      if (p.kind === "chooseCards" && p.choice.candidates.includes(mat)) return { type: "choose", player: seat, cards: [mat] } as Action;
      if (p.kind === "chooseCards" && p.choice.candidates.includes(s17)) return { type: "choose", player: seat, cards: [s17] } as Action;
      return null;
    });
    assert.ok(r.s.sides[seat].zones.battle.includes(s17) && r.s.cards[s17].under.includes(abs), "Super 17 is on top of the absorber");
    assert.equal(r.s.cards[s17].enteredUsing, "Union-Absorb");
    assert.ok(r.pended.has(w17), `${seat}: another card's [Union-Absorb] play triggers "…by a [Union] skill"`);
    assert.equal(r.pended.has(w12), false, `${seat}: the [Union-Fusion] gate rejects a [Union-Absorb] entry`);
    assert.equal(d0 - 1 - deckOf(r.s, seat), 1, "drew 1 (the searched card aside)");
    cases++;
  }
}

console.log(`union-played-other-930: 6 "when your <X> card is played by a [Union] skill" records read as youPlayed gated on the played card's successful [Union] entry, ${cases} both-seat reload cases`);
