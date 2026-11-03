/**
 * Audit effects 3 (lane E of the readings audit, round 3): effects, clauses, durations and the ops they need. Printed
 * text inline (the catalog snapshot of 3 Nov 2026, corrected by `errata.ts` as a sync stores it).
 *
 * A.  "An [Activate: Main/Battle] skill" in a description is a line of that timing (BT31-132, BT31-116), never any [Activate].
 * B.  "…with [blocker] and without ≪Great Ape≫" is one description, the trait named out (P-487): a moment, not a replacement.
 * C.  "…in your Drop Area or Warp" is one area, picked first (DB2-019's Q&A, R-340); "and/or", "a total of" and "shuffle
 *     any areas you looked through" pool the two.
 * D.  "When … attacks during that turn, …" (BT21-142) is a delayed trigger the engine lacks: unread, never a condition now.
 * E.  "Only 1 {X} can be played in your Battle Area" (21-11-2): a second copy that arrives anyway is processed like
 *     [Unique] — the master keeps one (BT6-047's Mafuba Q&A).
 * F.  "Skip your turn and begin your opponent's Charge Phase" (BT31-097): `skip` "rest" — the turn in progress ends now,
 *     nothing at its end happens, and the opponent's turn begins (its Q&As).
 * G.  "Reduce the energy cost of the next {X} you place in your Battle Area this turn" (BT23-041): one purchase, from
 *     the Z-Deck or the hand.
 *
 * Proved here: the records (nothing unread where the line is whole, the stored-row JSON round trip, the rules language's
 * print and reparse) and, where the engine learned something, a short play on the rules engine.
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
import { correctSkillText } from "../../src/lib/catalog/errata";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── the records ─────────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Rec = ReturnType<typeof skillRecords>[number];
const asRule = (rec: Rec) => roundtrip({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops }) as Rule;
const plain = (v: unknown) =>
  JSON.parse(JSON.stringify(v, function (this: Record<string, unknown>, k, x) {
    if (k === "upTo" && x === false) return undefined;
    if (k === "area" && Array.isArray(this.areas)) return undefined;
    return x;
  }));
let records = 0;
/** The record of `text` on card `id` (its only one, or the one at `index`), read whole, round-tripped and reparsed. */
function record(id: string, text: string, o: Partial<CardDef> = {}, index?: number, unread: string[] = []): Rec {
  const recs = skillRecords(card(id, { skill: correctSkillText(id, text) ?? text, ...o }));
  const rec = index === undefined ? (assert.equal(recs.length, 1, `${id}: one record`), recs[0]) : recs.find((r) => r.skillIndex === index);
  assert.ok(rec, `${id}: a record at ${index}`);
  assert.deepEqual(rec.unread, unread, `${id}: unread is ${JSON.stringify(unread)} (${rec.reads})`);
  if (!unread.length) {
    const rule = asRule(rec);
    assert.equal(validateRule(rule, rec.kind), null, `${id}: the record validates`);
    const round = parseRule(printRule(rule));
    assert.ok(round.ok, `${id}: the rules language prints and reparses it`);
    assert.deepEqual(plain(round.value), plain(rule), `${id}: …unchanged`);
  }
  records++;
  return roundtrip(rec);
}
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "chooseMode" ? o.modes.flatMap((m) => opsDeep(m.ops)) : [])]);
const opOf = <K extends Op["op"]>(rec: Rec, op: K) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: K }> => o.op === op);

// A. "…with an [Activate: Main/Battle] skill": that one timing, as printed.
for (const [id, text] of [
  ["BT31-132", "[Activate: Main][Limit 1] If your Leader is a white <Cell> card, and you remove this card in your Drop from the game and discard 1 card from your hand: Add up to 1 white Extra with an[Activate: Main/Battle] skill from your Drop to your hand."],
  ["BT31-116", "[activate: main/battle] [once per turn] Add up to 1 white Extra with an [activate: main/battle] skill and an energy cost of 2 from your Drop to your hand."],
] as const) {
  const rec = record(id, text);
  const pick = opOf(rec, "choose")[0];
  assert.equal(pick.sel.filter?.skillKind, "activate:main/battle", `A: ${id}: an [Activate: Main/Battle] line, not any [Activate]`);
  assert.match(rec.reads, /with \[Activate: Main\/Battle\] skills/, `A: ${id}: …and the reading says so`);
}

// B. P-487: the description is whole, "without ≪Great Ape≫" names the trait out, and the moment is a moment.
{
  const rec = record("P-487", "[auto][limit 1]{g}: When one of your green <Vegeta> cards with [blocker] and without ≪Great Ape≫ is removed from your Battle Area by an opponent's skill, play this card from your hand.");
  assert.deepEqual(rec.trigger, ["yourCardRemovedByOpponent"], "B: P-487: the removal moment");
  assert.equal(opOf(rec, "replace").length, 0, "B: P-487: …never a replacement");
  const subject = rec.cond && rec.cond.kind === "count" ? rec.cond.sel : null;
  assert.ok(subject && "special" in subject && subject.special === "subject", "B: P-487: a condition on the card removed");
  const f = (subject as { filter?: { colors: string[]; characters: string[]; keywords: string[]; traits: string[]; notTraits: string[] } }).filter!;
  assert.deepEqual([f.colors, f.characters, f.keywords, f.traits, f.notTraits], [["Green"], ["vegeta"], ["Blocker"], [], ["great ape"]], "B: P-487: green <Vegeta> with [Blocker], not ≪Great Ape≫");
  assert.equal(opOf(rec, "play").length, 1, "B: P-487: …then this card is played");
}

// C. One area of two (R-340): DB2-019 picks the Drop Area or the Warp first; "and/or", "a total of" and "shuffle any
// areas you looked through" keep the pooled choice.
for (const [id, text, areas] of [
  ["DB2-019", "[Activate: Main][Once per turn] Choose up to 2 skill-less Battle Cards with an energy cost of 1 in your Drop Area or Warp and play them.", ["drop", "warp"]],
  ["BT6-126", "[Auto] When you play this card, if there is an <Evil Wizard Babidi> card under this card, choose up to 5 ≪Agent of Destruction≫ cards from your Drop Area or Warp and play them.", ["drop", "warp"]],
  ["P-336", "[auto] When this card is played, add up to 2 cards with [dragon ball] from your deck or Drop Area to your hand, then shuffle your deck if you looked through it.", ["deck", "drop"]],
  ["EX13-30", "[-1][Activate: Main] Play up to 2 skill-less Battle Cards with energy costs of 1 from your deck or Drop Area, then shuffle your deck if you looked through it.", ["deck", "drop"]],
] as const) {
  const rec = record(id, text);
  const mode = opOf(rec, "chooseMode");
  assert.equal(mode.length, 1, `C: ${id}: the area is picked first`);
  assert.deepEqual(mode[0].modes.map((m) => (m.ops[0] as Extract<Op, { op: "choose" }>).sel), mode[0].modes.map((m, i) => ({ ...(m.ops[0] as Extract<Op, { op: "choose" }>).sel, area: areas[i] })), `C: ${id}: …each mode one area`);
  for (const m of mode[0].modes) assert.equal((m.ops[0].op === "choose" && "areas" in m.ops[0].sel) ? m.ops[0].sel.areas : undefined, undefined, `C: ${id}: …never the pooled pair`);
  const vars = new Set(mode[0].modes.map((m) => (m.ops[0] as Extract<Op, { op: "choose" }>).as));
  assert.equal(vars.size, 1, `C: ${id}: …both modes bind the one variable the rest reads`);
}
for (const [id, text] of [
  ["DB2-031", "[Activate: Main] Choose up to 2 skill-less Battle Cards with 10000 power in your Drop Area and/or Warp and play them."],
  ["BT6-106", "[Activate: Main] Switch this card to Rest Mode: Choose up to 2 [Dragon Ball] cards from your deck or life and add them to your hand. Then shuffle any areas you looked through."],
  ["BT21-051", "[Auto][Limit 1] If your Leader is mono-blue and your opponent has 3 or more energy: When this card is played, draw 1 card, choose up to a total of 3 Battle Cards in your opponent's Battle Area or Drop and add them to its owner's Z-Energy."],
] as const) {
  const rec = record(id, text);
  assert.equal(opOf(rec, "chooseMode").length, 0, `C: ${id}: the pooled choice stays`);
  assert.ok(opOf(rec, "choose").some((o) => !("special" in o.sel) && (o.sel as { areas?: string[] }).areas?.length === 2), `C: ${id}: …across both areas`);
}

// D. A moment inside an effect that waits for the rest of the turn: unread, never a condition on the battle at hand.
{
  const recs = skillRecords(card("BT21-142", { skill: "[activate: battle][limit 1] If your Leader is a mono-red card and you discard 1 card from your hand during your opponent's turn: When your opponent's Battle Card or Unison attacks during that turn, choose up to 1 of your cards, and that card gets +10000 power for the battle." }));
  assert.deepEqual(recs[0].unread, ["When your opponent's Battle Card or Unison attacks during that turn"], "D: BT21-142: the delayed trigger is unread");
  records++;
}

// E. 21-11-2's wording keeps its play ban (the reading is unchanged) — the engine's processing is below.
for (const [id, text] of [
  ["BT6-047", "[Permanent] You can only have up to 1 {Babidi, Overseer of Destruction} in play in your Battle Area. Treat ≪Agent of Destruction≫ cards in your hand as if they had no specified cost."],
  ["DB2-039", "[Permanent] Only 1 copy of this card can be played in your Battle Area."],
] as const) {
  const rec = record(id, text);
  assert.ok(opOf(rec, "forbid").some((o) => o.what === "play" && (o.sameNameAsSelf || o.filter?.names.length === 1)), `E: ${id}: a ban on its own name`);
}

// F. "Skip your turn": the turn in progress.
{
  const rec = record("BT31-097", "[activate: main] If your Leader is an <Aeos> card: Skip your turn and begin your opponent's Charge Phase");
  assert.deepEqual(opOf(rec, "skip"), [{ op: "skip", what: "rest" }], "F: BT31-097: the rest of this turn, not the next one");
}

// G. The next named card placed in the Battle Area: one purchase this turn, wherever its price is paid from.
{
  const rec = record("BT23-041", "[auto][limit 1] If your Leader is a mono-blue <Son Goku> card and you remove this card from the game: When your blue <Piccolo> card attacks, the attacking card gains [critical] for the battle, then reduce the energy cost of the next {Piercing Special Beam Cannon} you place in your Battle Area this turn by {u}. Additionally, you may choose 1 of your blue <Son Goku> Battle Cards and KO it. If you do, choose up to 1 of your opponent's Battle Cards and place it at the bottom of its owner's deck, then the attacking card gets +15000 power for the battle.", { type: "EXTRA" });
  const cut = opOf(rec, "costReduction");
  assert.equal(cut.length, 1, "G: BT23-041: one cost change");
  const sel = (cut[0].target as { sel: { area: string; areas?: string[]; filter?: { names: string[] } } }).sel;
  assert.deepEqual([sel.areas, sel.filter?.names, cut[0].uses, cut[0].until, cut[0].colors], [["zDeck", "hand"], ["piercing special beam cannon"], 1, "turn", ["Blue"]], "G: BT23-041: the next one this turn, by {u}, from the Z-Deck or the hand");
}

// ── the VM ──────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  E3_ONE_AREA: card("E3_ONE_AREA", { skill: "[Activate: Main] Choose up to 2 skill-less Battle Cards with an energy cost of 1 in your Drop Area or Warp and play them." }),
  E3_LIMITED: card("E3_LIMITED", { name: "E3 Limited", skill: "[Permanent] Only 1 {E3 Limited} can be played in your Battle Area." }),
  E3_COPY: card("E3_COPY", { name: "E3 Copy", skill: "[Permanent] Only 1 copy of this card can be played in your Battle Area." }),
  E3_DRAWER: card("E3_DRAWER", { skill: "[Activate: Main] Draw 1 card." }),
  E3_SKIPPER: card("E3_SKIPPER", { skill: "[Activate: Main] Skip your turn and begin your opponent's Charge Phase" }),
  E3_LATER: card("E3_LATER", { skill: "[Activate: Main] At the end of the turn, draw 2 cards." }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
function take(s: VmState, action: Action): VmState {
  const out = RULES.apply(ctx, roundtrip(s), action);
  return roundtrip(out.state as VmState);
}
/** The seat's Main Phase, hands and energy emptied back into the decks. */
function fresh(seat: PlayerId, seed: number, leader = "L-BLUE"): VmState {
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader, main: fifty("V1") }, p2: { name: "Second", leader, main: fifty("V-BLUE") } }).state as VmState;
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
/** A card from the deck's bottom, made `def`, put in `area` (Battle and Energy Areas Active). */
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy" || area === "unison") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
const linesOf = (def: string) => parseSkills(defs[def].skill!).map((sk) => sk.index);
const offerOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && linesOf(s.cards[c].cardId).includes((l.action as { skill: number }).skill));
type Prompt = VmState["prompt"];
type Steer = { cards?: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[] | undefined; mode?: number; asked?: string[] };
/** Answer every question until the turn player's Main Phase. */
function settle(s0: VmState, steer: Steer = {}): VmState {
  let s = s0;
  for (let i = 0; i < 80 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: steer.mode ?? 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "chooseCards") {
      steer.asked?.push(q.choice.reason);
      s = take(s, { type: "choose", player: who, cards: steer.cards?.(q) ?? q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    } else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: null } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.equal(s.prompt.kind, "main", `settled (at ${s.prompt.kind})`);
  return s;
}
function activate(s: VmState, c: string, steer: Steer = {}): VmState {
  const offer = offerOf(s, c);
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), steer);
}

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const seed = (n: number) => 53300 + n * 2 + (seat === "p1" ? 0 : 1);

  // C. One area: with a card in the Drop and one in the Warp, the Warp is picked and only the Warp's card is offered.
  {
    let s = fresh(seat, seed(0));
    const me = stage(s, seat, "E3_ONE_AREA", "battle");
    const inDrop = stage(s, seat, "V1", "drop");
    const inWarp = stage(s, seat, "V1", "warp");
    const offered: string[][] = [];
    s = activate(s, me, { mode: 1, cards: (q) => (offered.push(q.choice.candidates), q.choice.candidates) });
    assert.deepEqual(offered, [[inWarp]], `${seat}: C: only the Warp's card is offered once the Warp is picked`);
    assert.ok(s.sides[seat].zones.battle.includes(inWarp) && s.sides[seat].zones.drop.includes(inDrop), `${seat}: C: …the Warp's card played, the Drop's left`);
    cases++;
  }

  // E. Two copies in one Battle Area while the limit is in force (the Mafuba case): the master keeps one at once.
  for (const def of ["E3_LIMITED", "E3_COPY"]) {
    let s = fresh(seat, seed(def === "E3_LIMITED" ? 1 : 2));
    const drawer = stage(s, seat, "E3_DRAWER", "battle");
    const a = stage(s, seat, def, "battle");
    const b = stage(s, seat, def, "battle");
    const asked: string[] = [];
    s = activate(s, drawer, { asked, cards: (q) => (q.choice.candidates.includes(b) ? [b] : undefined) });
    assert.ok(asked.length >= 1, `${seat}: E: ${def}: the master is asked which to keep`);
    assert.ok(s.sides[seat].zones.battle.includes(b) && !s.sides[seat].zones.battle.includes(a), `${seat}: E: ${def}: …the one kept stays`);
    assert.ok(s.sides[seat].zones.drop.includes(a), `${seat}: E: ${def}: …the other goes to the Drop Area`);
    cases++;
  }
  // …and one copy alone is no violation; another card's name is never limited.
  {
    let s = fresh(seat, seed(3));
    const drawer = stage(s, seat, "E3_DRAWER", "battle");
    const a = stage(s, seat, "E3_LIMITED", "battle");
    const c1 = stage(s, seat, "V1", "battle");
    const c2 = stage(s, seat, "V1", "battle");
    s = activate(s, drawer);
    assert.ok([a, c1, c2].every((id) => s.sides[seat].zones.battle.includes(id)), `${seat}: E: one limited copy and two of another name stay`);
    cases++;
  }
  // F. Skip your turn: the Main Phase ends at once, the "at the end of the turn" draw never happens, and the opponent's
  // turn begins with its Charge Phase.
  {
    let s = fresh(seat, seed(4));
    const later = stage(s, seat, "E3_LATER", "battle");
    const skipper = stage(s, seat, "E3_SKIPPER", "battle");
    s = activate(s, later);
    const hand = s.sides[seat].zones.hand.length;
    const turn = s.turn;
    const offer = offerOf(s, skipper);
    assert.ok(offer, `${seat}: F: the skip is offered`);
    s = take(s, offer.action);
    for (let i = 0; i < 20 && s.turnPlayer === seat; i++) {
      const q = s.prompt;
      const who = (q as { player: PlayerId }).player;
      if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
      else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
      else if (q.kind === "main") assert.fail(`${seat}: F: the Main Phase asked again after the skip`);
      else s = take(s, { type: "pass", player: who } as Action);
    }
    assert.equal(s.turnPlayer, other(seat), `${seat}: F: the opponent's turn`);
    assert.equal(s.turn, turn + 1, `${seat}: F: …the very next turn`);
    assert.equal(s.prompt.kind, "charge", `${seat}: F: …at its Charge Phase`);
    assert.equal(s.sides[seat].zones.hand.length, hand, `${seat}: F: the end-of-turn draw never happened (its timing was skipped)`);
    assert.deepEqual(s.sides[seat].skips ?? [], [], `${seat}: F: no skip entry is left over`);
    cases++;
  }
}

console.log(`verify/audit-effects-3: ok (${records} records, ${cases} VM cases across both seats)`);
