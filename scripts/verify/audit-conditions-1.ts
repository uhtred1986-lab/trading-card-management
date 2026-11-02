/**
 * Audit lane C, conditions (2 Nov 2026): the readings a production audit of every readable skill found with a lost or
 * turned condition or qualifier. Printed text inline (catalog text of the snapshot of 2 Nov 2026; costs, powers and
 * companions in the VM cases are synthetic).
 *
 * A.  "Another ≪Trait≫ is in play" and "another of your Battle Cards" rule out the card printing them (TB1-016 …).
 * B.  KO shields: "in battle" (Q&A BT1-020), "once per turn" (R-161), "while it's in Rest Mode".
 * C.  "Cannot be attacked by a Leader Card" (BT1-066): the opponent's Leader may not attack it, nothing else.
 * D.  Whose negation a "can't be negated" rule stops (DB1-021, P-680, P-641).
 * E.  "[Counter] against this card's attack" (BT1-031, TB1-010, R-160).
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
import { attrsNow } from "../../src/lib/arena/vm/program";
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
  const walk = (ops: Op[]) => { for (const o of ops) if (o.op === "if") { out.push(...flat(o.cond)); walk(o.then); if (o.else) walk(o.else); } };
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
const forbids = (rec: Rec) => ops(rec).filter((o): o is Extract<Op, { op: "forbid" }> => o.op === "forbid");
let records = 0;

// A. "Another" rules out this card.
for (const [what, text] of [
  ["TB1-016", "[Auto] When this card attacks, if another ≪Universe 6≫ is in play in your Battle Area, draw 1 card and this card gains +5000 power for the duration of the turn."],
  ["TB1-037", "[Auto] When this card attacks, if another ≪Trio De Dangers≫ is in play in your Battle Area, choose up to 1 of your opponent's Battle Cards with an energy cost of 4 or less and KO it."],
  ["TB1-084", "[Permanent] During your turn, if another ≪Universe 11≫ is in play in your Battle Area, this card gains +5000 power."],
  ["TB1-041", "[Permanent] If another ≪Universe 9≫ is in play in your Battle Area, your opponent cannot activate [Blocker] during this card's attack."],
] as const) {
  const rec = record(text, what);
  const counted = conds(rec).find((c): c is Extract<Cond, { kind: "count" }> => c.kind === "count");
  assert.ok(counted && counted.sel.notSelf === "card" && counted.sel.area === "battle", `A: ${what} — another card of that trait, not this one (${JSON.stringify(counted)})`);
  records++;
}
{
  const rec = record("[Permanent] When another of your Battle Cards would be removed from a Battle Area by an opponent's skill, you may place 1 {God of Dreams Dragon Ball} from your Battle Area into its owner's Drop instead.", "BT28-014");
  const rep = ops(rec).find((o) => o.op === "replace");
  assert.ok(rep && rep.op === "replace" && rep.target && "sel" in rep.target && rep.target.sel.notSelf === "card", "A: BT28-014 — the replacement is about the other Battle Cards");
  const five = record("[Auto] At the end of your turn, choose up to 2 of your yellow Battle Cards with an energy cost of 2 or more other than this one and switch them to Active Mode.", "BT5-082");
  const chosen = ops(five).find((o) => o.op === "choose");
  assert.ok(chosen && chosen.op === "choose" && chosen.sel.notSelf === "card", "A: BT5-082 — \"other than this one\"");
  // The trait's own word is no adjective.
  const budokai = record("[Activate: Main] Choose up to 1 ≪Another World Budokai≫ card in your hand and play it.", "BUDOKAI");
  assert.ok(ops(budokai).every((o) => o.op !== "choose" || !o.sel.notSelf), "A: ≪Another World Budokai≫ is a trait");
  records += 3;
}

// B. KO shields.
{
  for (const [what, text] of [["BT1-020", "[Permanent] This card cannot be KO'd in battle."], ["BT20-005", "[auto] When this card is played, it can't be KO'd in battle for the turn."]] as const) {
    const f = forbids(record(text, what));
    assert.deepEqual(f.map((o) => o.what), ["beKOdInBattle"], `B: ${what} — the battle's KO only (Q&A BT1-020)`);
    records++;
  }
  for (const [what, text, inBattle] of [
    ["BT21-091", "[permanent] If this card's power is 15000 or more, it can't be KO'd once per turn.", false],
    ["P-317", "[Permanent] This card can't be KO'd once per turn.", false],
  ] as const) {
    const rep = ops(record(text, what)).find((o) => o.op === "replace");
    assert.ok(rep && rep.op === "replace" && rep.event === "ko" && (rep.by === "koInBattle") === inBattle && rep.with.length === 1 && rep.with[0].op === "negateOwnSkill", `B: ${what} — R-161: the first KO a turn is stopped and spends the line`);
    records++;
  }
  // A line that says more beside the shield would lose it with the line: unread (R-161).
  const p345 = only("[Permanent] This card is also treated as yellow and can't be KO'd in battle once per turn.", "P-345");
  assert.ok(p345.unread.length > 0, "B: P-345 — the shield beside \"also yellow\" stays unread");
  const rested = record("[permanent] This card can't be KO'd while it's in Rest Mode.", "BT20-101");
  assert.deepEqual(forbids(rested).map((o) => o.what), ["beKOd"], "B: BT20-101 — one ban");
  assert.ok(conds(rested).some((c) => c.kind === "count" && c.sel.special === "self" && c.sel.mode === "rest"), "B: BT20-101 — …that this card is rested");
  records += 2;
}

// C. Attacked by a Leader Card.
{
  const f = forbids(record("[Permanent] This card cannot be attacked by a Leader Card.", "BT1-066"));
  assert.equal(f.length, 1, "C: BT1-066 — one rule");
  assert.ok(f[0].what === "attack" && f[0].target && "sel" in f[0].target && f[0].target.sel.area === "leader" && f[0].target.sel.side === "opponent" && f[0].against && "sel" in f[0].against && f[0].against.sel.special === "self", "C: BT1-066 — the opponent's Leader can't attack this card");
  assert.ok(forbids(record("[Permanent] If your Leader Card is red, this card gains [Critical] and can't be attacked by your opponent's cards.", "BT9-009")).some((o) => o.what === "beAttacked"), "C: BT9-009 — every attacker is the opponent's");
  records += 2;
}

// D. Whose negation.
{
  const db1 = forbids(record("[Permanent] This card's skills can't be negated in any area by your opponent's skills.", "DB1-021"));
  assert.ok(db1.length === 1 && db1[0].what === "beNegated" && db1[0].side === "opponent" && !db1[0].byFilter, "D: DB1-021 — the opponent's negation only");
  const p680 = forbids(record("[Permanent] Skills on your Battle Cards can't be negated by your opponent's skills.", "P-680"));
  assert.ok(p680.length === 1 && p680[0].side === "opponent", "D: P-680 — the opponent's negation only");
  const p641 = forbids(record("[permanent] Skills on this card in any area can't be negated by the skills of your red <Garlic Jr.> cards.", "P-641"));
  assert.ok(p641.length === 1 && p641[0].side === "you" && p641[0].byFilter?.characters.includes("garlic jr.") && p641[0].byFilter.colors.includes("Red"), `D: P-641 — your red <Garlic Jr.> cards' negation only (${JSON.stringify(p641[0].byFilter)})`);
  const blanket = forbids(record("[Permanent] This card's skills can't be negated in any area.", "DB1-087"));
  assert.ok(blanket.length === 1 && !blanket[0].side && !blanket[0].byFilter, "D: DB1-087 — every negation");
  records += 4;
}

// E. [Counter] against this card's attack (R-160).
{
  for (const [what, text] of [
    ["BT1-031", "[permanent] Your opponent cannot activate [counter] against this card's attack and cannot activate [blocker] during this card's attack."],
    ["TB1-010", "[Permanent] This card can attack Battle Cards in Active Mode, and your opponent cannot activate [Counter] against this card's attack."],
  ] as const) {
    const counters = forbids(record(text, what)).filter((o) => o.what === "activateCounter");
    assert.deepEqual(counters.map((o) => o.counterKind).sort(), ["attack", "battleCardAttack"], `E: ${what} — R-160: the counters an attack makes pending`);
    records++;
  }
}

// ── 2. the VM ────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  // D: negation by whose skill
  SHIELDOPP: card("SHIELDOPP", { skill: "[Permanent] This card's skills can't be negated in any area by your opponent's skills.\n[Permanent] This card gets +5000 power." }),
  SHIELDGARLIC: card("SHIELDGARLIC", { skill: "[permanent] Skills on this card in any area can't be negated by the skills of your red <Garlic Jr.> cards.\n[Permanent] This card gets +5000 power." }),
  OPPNEG: card("OPPNEG", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and negate its skills for the turn." }),
  OWNNEG: card("OWNNEG", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and negate its skills for the turn." }),
  GARLIC: card("GARLIC", { characters: ["Garlic Jr."], skill: "[Activate: Main] Choose up to 1 of your Battle Cards and negate its skills for the turn." }),
  GARLICOPP: card("GARLICOPP", { characters: ["Garlic Jr."], skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and negate its skills for the turn." }),
  // B: once per turn
  ONCEKO: card("ONCEKO", { skill: "[Permanent] This card can't be KO'd once per turn." }),
  KOER: card("KOER", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it.\n[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
  BATTLEKO: card("BATTLEKO", { skill: "[Permanent] This card cannot be KO'd in battle." }),
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
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader, main: fifty("V1") }, p2: { name: "Second", leader, main: fifty("V1") } }).state as VmState;
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
/** A card from the deck's bottom, made `def`, put in `area` (Battle Area Active). */
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
const offersOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).filter((l) => l.action.type === "activate" && l.action.card === c);
/** Answer every question until the turn player's Main Phase; a card choice takes `want` when offered. */
function settle(s0: VmState, want?: string): VmState {
  let s = s0;
  for (let i = 0; i < 80 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: want && q.choice.candidates.includes(want) ? [want] : q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: null } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.equal(s.prompt.kind, "main", `settled (at ${s.prompt.kind})`);
  return s;
}
function activate(s: VmState, c: string, want: string, nth = 0): VmState {
  const offer = offersOf(s, c)[nth];
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), want);
}
const power = (s: VmState, id: string) => Number(attrsNow(ctx, game, s, id).power ?? 0);
let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 52100 + n * 2 + (seat === "p1" ? 0 : 1);

  // D. "…by your opponent's skills": the opponent's negation fails, your own works.
  {
    let s = fresh(seat, seed(0));
    const shielded = stage(s, foe, "SHIELDOPP", "battle");
    const neg = stage(s, seat, "OPPNEG", "battle");
    const before = power(s, shielded);
    s = activate(s, neg, shielded);
    assert.equal(before, 15000, `${seat}: D: the shielded card stands at 15000`);
    assert.equal(power(s, shielded), before, `${seat}: D: the opponent's negation does not switch it off`);
    s = fresh(seat, seed(1));
    const mine = stage(s, seat, "SHIELDOPP", "battle");
    const ownNeg = stage(s, seat, "OWNNEG", "battle");
    const was = power(s, mine);
    s = activate(s, ownNeg, mine);
    assert.equal(power(s, mine), was - 5000, `${seat}: D: your own negation does`);
    cases += 2;
  }
  // D. "…by the skills of your red <Garlic Jr.> cards": only those.
  {
    let s = fresh(seat, seed(2));
    const shielded = stage(s, seat, "SHIELDGARLIC", "battle");
    const garlic = stage(s, seat, "GARLIC", "battle");
    const before = power(s, shielded);
    s = activate(s, garlic, shielded);
    assert.equal(power(s, shielded), before, `${seat}: D: your red <Garlic Jr.>'s negation fails`);
    s = fresh(seat, seed(3));
    const theirs = stage(s, foe, "SHIELDGARLIC", "battle");
    const g2 = stage(s, seat, "GARLICOPP", "battle");
    const was = power(s, theirs);
    s = activate(s, g2, theirs);
    assert.equal(power(s, theirs), was - 5000, `${seat}: D: the opponent's <Garlic Jr.> is not "yours" to the card's controller`);
    s = fresh(seat, seed(6));
    const plainShield = stage(s, seat, "SHIELDGARLIC", "battle");
    const plainNeg = stage(s, seat, "OWNNEG", "battle");
    const had = power(s, plainShield);
    s = activate(s, plainNeg, plainShield);
    assert.equal(power(s, plainShield), had - 5000, `${seat}: D: your other cards' negation works`);
    cases += 3;
  }
  // B. Once per turn: the first KO is stopped, the second is not.
  {
    let s = fresh(seat, seed(4));
    const target = stage(s, foe, "ONCEKO", "battle");
    const koer = stage(s, seat, "KOER", "battle");
    s = activate(s, koer, target, 0);
    assert.ok(s.sides[foe].zones.battle.includes(target), `${seat}: B: the first KO a turn is stopped`);
    s = activate(s, koer, target, 0);
    assert.ok(s.sides[foe].zones.drop.includes(target), `${seat}: B: …the second is not`);
    cases += 2;
  }
  // B. In battle only: a skill's KO still KOs it (Q&A BT1-020).
  {
    let s = fresh(seat, seed(5));
    const target = stage(s, foe, "BATTLEKO", "battle");
    const koer = stage(s, seat, "KOER", "battle");
    s = activate(s, koer, target, 0);
    assert.ok(s.sides[foe].zones.drop.includes(target), `${seat}: B: a skill KOs a card that can't be KO'd in battle`);
    cases++;
  }
}
console.log(`audit-conditions-1: ${records} records, ${cases} VM cases — ok`);
