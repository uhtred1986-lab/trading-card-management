/**
 * Audit lane C, conditions, round 2 (3 Nov 2026): the lost or turned conditions the production audit of 2 Nov 2026
 * confirmed that round 1 did not reach. Printed text inline (catalog text of the snapshot of 3 Nov 2026; costs, powers
 * and companions in the VM cases are synthetic).
 *
 * A.  How a play was made (`playedUsing`): "when you play this card with [Swap]" (BT4-075, BT4-083), "…using [Arrival]"
 *     (BT25-129), "…with [successor]" (BT9-113), "…by [evolve]" (BT19-009), "…with Evolve by placing it on top of {X}"
 *     (P-052), "…with the skill of {Majin Buu's Sealed Ball}" (BT2-028), "…with <Trunks: Future> skill" (BT2-041),
 *     "…by another card's skill" (BT20-104), "…without using skills" (BT15-042), "…by [over realm]" (P-450), and "…during
 *     your opponent's turn" (BT9-058) — each a condition of the moment, asked before the [Auto] is pended (9-6-2).
 *
 * Proved here: the records (nothing unread where the line is whole, the stored-row JSON round trip, the rules
 * language's print and reparse), and in the VM for both seats with every action reloaded from JSON.
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
import type { Cond, Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── 1. the records ───────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Rec = ReturnType<typeof skillRecords>[number];
const asRule = (rec: Rec) => roundtrip({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops }) as Rule;
const plain = (v: unknown) =>
  JSON.parse(JSON.stringify(v, function (this: Record<string, unknown>, k, x) {
    if (k === "upTo" && x === false) return undefined;
    if (k === "area" && Array.isArray(this.areas)) return undefined;
    return x;
  }));
function only(text: string, what: string, o: Partial<CardDef> = {}, index?: number): Rec {
  const recs = skillRecords(card(what, { skill: text, ...o }));
  const rec = index === undefined ? (assert.equal(recs.length, 1, `${what}: one record`), recs[0]) : recs.find((r) => r.skillIndex === index);
  assert.ok(rec, `${what}: a record at ${index}`);
  return rec;
}
/** The record of `text`, read whole, through the stored-row round trip and the language's print and reparse. */
function record(text: string, what: string, o: Partial<CardDef> = {}, index?: number): Rec {
  const rec = only(text, what, o, index);
  assert.deepEqual(rec.unread, [], `${what}: nothing unread`);
  const rule = asRule(rec);
  assert.equal(validateRule(rule, rec.kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  assert.deepEqual(plain(round.value), plain(rule), `${what}: …unchanged`);
  return roundtrip(rec);
}
const flat = (c: Cond | null | undefined): Cond[] => (!c ? [] : c.kind === "all" ? c.conds.flatMap(flat) : [c]);
/** Every condition the record states: its own and those of the `if`s its program opens with, nested ones included. */
function conds(rec: Rec): Cond[] {
  const out = flat(rec.cond);
  const walk = (list: Op[]) => { for (const o of list) if (o.op === "if") { out.push(...flat(o.cond)); walk(o.then); if (o.else) walk(o.else); } };
  walk(rec.ops);
  return out;
}
/** Every op of the program, `if` bodies included. */
function ops(rec: Rec): Op[] {
  const out: Op[] = [];
  const walk = (list: Op[]) => { for (const o of list) { out.push(o); if (o.op === "if") { walk(o.then); if (o.else) walk(o.else); } if (o.op === "may") walk(o.ops); } };
  walk(rec.ops);
  return out;
}
void ops;
let records = 0;

// A. How a play was made.
{
  const played = (c: Cond) => (c.kind === "playedUsing" ? c : c.kind === "not" && c.cond.kind === "playedUsing" ? c.cond : null);
  for (const [what, text, want, negated] of [
    ["BT4-083", "[auto] When you play this card with [swap], draw 2 cards.", { what: "Swap" }, false],
    ["BT4-075", "[Auto] When you play this card with [Swap], choose up to a total of 3 of your opponent's Battle Cards or energy ignoring [Barrier], and switch them to Rest Mode.", { what: "Swap" }, false],
    ["BT21-122", "[auto] When this card is played by [swap], draw 1 card.", { what: "Swap" }, false],
    ["BT25-129", "[Auto] When this card is played using [Arrival], choose up to 1 of your opponent's cards and it gets -5000 for the battle.", { what: "Arrival" }, false],
    ["BT9-114", "[auto] When you play this card with [successor], choose up to 1 of your opponent's Battle Cards, ignoring [barrier], KO it, then your opponent chooses 1 card in their hand and places it in their Drop Area.", { what: "Successor" }, false],
    ["BT16-075", "[auto] When this card is played using [ex-evolve], switch it to Active Mode.", { what: "EX-Evolve" }, false],
    ["BT19-009", "[auto] When this card is played by [evolve], draw 1 card, and switch this card to Active Mode.", { what: "Evolve" }, false],
    ["P-450", "[auto] When this card is played by [over realm], draw 1 card, and this card gets +10000 power for the turn.", { what: "Over Realm" }, false],
    ["BT16-051", "[Auto] When this card is played using a skill, draw 1 card.", { what: "skill" }, false],
    ["BT20-104", "[auto] When this card is played by another card's skill, it gains [barrier] and [dual attack] for the turn.", { what: "skill", by: "other" }, false],
    ["P-628", "[auto] When this card is played using this card's skill, draw 1 card.", { what: "skill", by: "self" }, false],
    ["BT2-028", "[Auto] When you play this card with the skill of {Majin Buu's Sealed Ball}, inflict 1 damage to the opponent's life.", { what: "skill", source: { names: ["Majin Buu's Sealed Ball"] } }, false],
    ["BT2-041", "[Auto] When you play this card with &lt;Trunks: Future&gt; skill, choose up to 1 opponent Battle Card and KO that card.", { what: "skill", source: { characters: ["Trunks: Future"] } }, false],
    ["BT24-100", "[Auto][Spirit Boost 1] When this card is played by a yellow <Turles> card's skill, choose up to 1 of your opponent's Rest Mode Battle Cards and KO it.", { what: "skill", source: { colors: ["Yellow"], characters: ["Turles"] } }, false],
    ["BT15-042", "[Auto] When this card is played without using skills, draw 1 card.", { what: "skill" }, true],
    ["BT24-104", "[Auto][Limit 1] When this card is played without using a <Rasin> card's skills, play up to 1 yellow <Rasin> card with an energy cost of 1 from your deck, then shuffle your deck.", { what: "skill", source: { characters: ["Rasin"] } }, true],
  ] as const) {
    const rec = record(text, what);
    assert.deepEqual(rec.trigger, ["played"], `A: ${what} — the moment is the play`);
    const gate = conds(rec).find((c) => played(c));
    assert.ok(gate, `A: ${what} — a gate on how it was played (${JSON.stringify(rec.cond)})`);
    assert.equal(gate.kind === "not", negated, `A: ${what} — ${negated ? "\"without\"" : "\"with\""}`);
    const p = played(gate)!;
    assert.equal(p.what, want.what, `A: ${what} — ${want.what}`);
    if ("by" in want) assert.equal(p.by, want.by, `A: ${what} — whose skill`);
    if ("source" in want) for (const [k, v] of Object.entries(want.source)) assert.deepEqual((p.source as unknown as Record<string, unknown>)?.[k]?.toString().toLowerCase(), v.toString().toLowerCase(), `A: ${what} — the source's ${k}`);
    records++;
  }
  // P-052: an evolution onto that card, which stays under it (22-5).
  const p052 = record("[auto] When you play this card with Evolve by placing it on top of {Maiden Squadron Leader Ribrianne}, switch it to Active Mode.", "P-052");
  assert.ok(conds(p052).some((c) => c.kind === "playedUsing" && c.what === "Evolve"), "A: P-052 — played by an evolution");
  assert.ok(conds(p052).some((c) => c.kind === "count" && c.sel.area === "under" && c.sel.filter?.names?.[0]?.toLowerCase() === "maiden squadron leader ribrianne"), "A: P-052 — …onto {Maiden Squadron Leader Ribrianne}");
  // BT9-058, BT7-058: the turn the card is played in.
  for (const [what, text, who] of [
    ["BT9-058", "[Auto] Choose 1 or 2 cards in your life and add them to your hand: When you play this card during your opponent's turn, choose up to 1 of your green energy and switch it to Active Mode.", "opponent"],
    ["BT7-122", "[auto] When you play this card during your turn, choose up to 1 of your opponent's Battle Cards and switch it to Rest Mode.", undefined],
  ] as const) {
    const rec = record(text, what);
    assert.ok(conds(rec).some((c) => c.kind === "isTurnPlayer" && c.who === who), `A: ${what} — whose turn it is`);
    records++;
  }
  // Words not read whole refuse the line: "…a [successor] skill that was activated by choosing …" (BT21-145).
  assert.ok(only("[auto] When this card is played using a [successor] skill that was activated by choosing 1 or more each of <Android 17>, <Android 18>, and <Cell> for their skill costs, draw 1 card.", "BT21-145").unread.length > 0, "A: BT21-145 stays unread");
  // Where the card came from is another reader's: "…played from your hand" is not a gate here.
  assert.equal(conds(record("[Auto] When this card is played from your hand, draw 1 card.", "FROMHAND")).length, 0, "A: from your hand — no gate");
  records += 4;
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const DRAW = "draw 1 card.";
const defs: Record<string, CardDef> = {
  ...DEFS,
  // A. how a play was made
  AC2_SEAL: card("AC2_SEAL", { name: "AC2 Sealed Ball", skill: "[Activate: Main] Choose up to 1 Battle Card in your hand and play it." }),
  AC2_OTHER: card("AC2_OTHER", { name: "AC2 Other", skill: "[Activate: Main] Choose up to 1 Battle Card in your hand and play it." }),
  AC2_BYSEAL: card("AC2_BYSEAL", { skill: `[Auto] When you play this card with the skill of {AC2 Sealed Ball}, ${DRAW}` }),
  AC2_NOSKILL: card("AC2_NOSKILL", { skill: `[Auto] When this card is played without using skills, ${DRAW}` }),
  AC2_SWAPPER: card("AC2_SWAPPER", { energyCost: 3, skill: "[Swap 1]: <AC2_SWAPPED> with an energy cost of 1." }),
  AC2_SWAPPED: card("AC2_SWAPPED", { skill: `[Auto] When you play this card with [Swap], ${DRAW}` }),
  AC2_THEIRTURN: card("AC2_THEIRTURN", { skill: "[Auto] Choose 1 card in your hand and discard it: When you play this card during your opponent's turn, draw 2 cards." }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
for (const d of ["AC2_SEAL", "AC2_BYSEAL", "AC2_NOSKILL", "AC2_SWAPPER", "AC2_SWAPPED"]) for (const r of skillRecords(defs[d])) assert.deepEqual(r.unread, [], `${d}: read`);
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
function stage(s: VmState, p: PlayerId, def: string, area: string, under?: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p, ...(under ? { under } : {}) }).ok);
  if (area === "battle" || area === "energy" || area === "unison") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
type Prompt = VmState["prompt"];
/** Answer every question until the turn player's Main Phase. */
function settle(s0: VmState, steer: { cards?: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[] | undefined } = {}): VmState {
  let s = s0;
  for (let i = 0; i < 80 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: steer.cards?.(q) ?? q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: null } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.equal(s.prompt.kind, "main", `settled (at ${s.prompt.kind})`);
  return s;
}
const lineOf = (def: string, kind: string) => parseSkills(defs[def].skill!).find((sk) => sk.kind.startsWith(kind) || sk.keyword?.name === kind)!.index;
const offerOf = (s: VmState, c: string, skill?: number) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && (skill === undefined || (l.action as { skill: number }).skill === skill));
const playOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && l.action.card === c);
const hand = (s: VmState, p: PlayerId) => s.sides[p].zones.hand.length;
const pick = (...ids: string[]) => ({ cards: (q: Extract<Prompt, { kind: "chooseCards" }>) => { const got = ids.filter((id) => q.choice.candidates.includes(id)).slice(0, q.choice.max); return got.length ? got : undefined; } });

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const seed = (n: number) => 52300 + n * 2 + (seat === "p1" ? 0 : 1);
  void other;

  // A1. Played by the skill of {AC2 Sealed Ball}: answers; by another card's skill, or from the hand: no trigger.
  for (const [n, actor, drew] of [[0, "AC2_SEAL", 1], [1, "AC2_OTHER", 0]] as const) {
    let s = fresh(seat, seed(n));
    const a = stage(s, seat, actor, "battle");
    const g = stage(s, seat, "AC2_BYSEAL", "hand");
    const offer = offerOf(s, a);
    assert.ok(offer, `${seat}: A1: ${actor} offered`);
    s = settle(take(s, offer.action), pick(g));
    assert.equal(s.cards[g].mode, "active", `${seat}: A1: played`);
    assert.ok(s.sides[seat].zones.battle.includes(g), `${seat}: A1: in the Battle Area`);
    assert.equal(hand(s, seat), drew, `${seat}: A1: played by ${actor}'s skill — ${drew ? "answers" : "no trigger (9-6-2)"}`);
    cases++;
  }
  {
    let s = fresh(seat, seed(2));
    stage(s, seat, "V1", "energy");
    const g = stage(s, seat, "AC2_BYSEAL", "hand");
    const play = playOf(s, g);
    assert.ok(play, `${seat}: A1: playable from the hand`);
    s = settle(take(s, play.action));
    assert.ok(s.sides[seat].zones.battle.includes(g), `${seat}: A1: played from the hand`);
    assert.equal(hand(s, seat), 0, `${seat}: A1: a declared play is no skill's — no trigger`);
    cases++;
  }
  // A2. "Without using skills": a declared play answers, a skill's play does not.
  {
    let s = fresh(seat, seed(3));
    stage(s, seat, "V1", "energy");
    const g = stage(s, seat, "AC2_NOSKILL", "hand");
    s = settle(take(s, playOf(s, g)!.action));
    assert.equal(hand(s, seat), 1, `${seat}: A2: played from the hand without skills — answers`);
    s = fresh(seat, seed(4));
    const a = stage(s, seat, "AC2_OTHER", "battle");
    const g2 = stage(s, seat, "AC2_NOSKILL", "hand");
    s = settle(take(s, offerOf(s, a)!.action), pick(g2));
    assert.ok(s.sides[seat].zones.battle.includes(g2), `${seat}: A2: played by a skill`);
    assert.equal(hand(s, seat), 0, `${seat}: A2: …by a skill — no trigger`);
    cases += 2;
  }
  // A3. "With [Swap]": the [Swap] keyword's own play answers; a play from the hand does not.
  {
    let s = fresh(seat, seed(5));
    const swapper = stage(s, seat, "AC2_SWAPPER", "battle");
    const g = stage(s, seat, "AC2_SWAPPED", "hand");
    const offer = offerOf(s, swapper, lineOf("AC2_SWAPPER", "Swap"));
    assert.ok(offer, `${seat}: A3: [Swap] offered`);
    s = settle(take(s, offer.action), pick(g));
    assert.ok(s.sides[seat].zones.battle.includes(g), `${seat}: A3: swapped in`);
    assert.ok(s.sides[seat].zones.hand.includes(swapper), `${seat}: A3: …and the swapper went to the hand`);
    assert.equal(hand(s, seat), 2, `${seat}: A3: played with [Swap] — answers (the swapper and the draw)`);
    s = fresh(seat, seed(6));
    stage(s, seat, "V1", "energy");
    const g2 = stage(s, seat, "AC2_SWAPPED", "hand");
    s = settle(take(s, playOf(s, g2)!.action));
    assert.equal(hand(s, seat), 0, `${seat}: A3: played from the hand — no trigger`);
    cases += 2;
  }
  // A4. "During your opponent's turn": played on your own turn, nothing is drawn and the price is not taken.
  {
    let s = fresh(seat, seed(7));
    stage(s, seat, "V1", "energy");
    stage(s, seat, "V1", "hand");
    const g = stage(s, seat, "AC2_THEIRTURN", "hand");
    s = settle(take(s, playOf(s, g)!.action));
    assert.ok(s.sides[seat].zones.battle.includes(g), `${seat}: A4: played`);
    assert.equal(hand(s, seat), 1, `${seat}: A4: on your own turn — no draw, and the card in hand stays`);
    cases++;
  }
}

console.log(`audit-conditions-2: ${records} records, ${cases} VM cases — ok`);
