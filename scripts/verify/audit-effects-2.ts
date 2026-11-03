/**
 * Audit effects 2 (lane E of the readings audit, round 2): effects, clauses and the ops they need. Printed text inline
 * (the catalog snapshot of 3 Nov 2026, corrected by `errata.ts` as a sync stores it).
 *
 * A.  "…and put them back in any order" / "…place them on top of your deck in any order" after a look is `arrange`: the
 *     master orders the cards one at a time, the first pick on top, and none of them leaves the deck (20-12-2).
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
import { describeScript } from "../../src/lib/arena/vm/script-schema";
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
let records = 0;

// A. "Put them back in any order": `arrange` on the cards just looked at, never a note.
for (const [id, text, side] of [
  ["DB2-058", "[Activate: Main][Once per turn] Look at up to 3 cards from the top of your opponent's deck and put them back in any order.", "opponent"],
  ["DB2-049", "[counter: attack] Look at up to 3 cards from the top of your opponent's deck, put them back in any order, then play this card.", "opponent"],
  ["DB2-051", "[Auto] When this card attacks or is removed from your Battle Area by a skill, look at up to 3 cards from the top of your opponent's deck and put them back in any order.", "opponent"],
  ["DB2-053", "[Auto] If you have a ≪Universe 10≫ card in play: When you play or combo with this card, look at up to 3 cards from the top of your opponent's deck and put them back in any order.", "opponent"],
  ["DB2-064", "[Counter: Attack] Negate the attack, look at up to 3 cards from the top of your opponent's deck and put them back in any order, then choose up to 1 ≪Universe 10≫ card with an energy cost of 2 or less in your hand and play it.", "opponent"],
  ["BT14-093", "[+2][Activate: Main] Look at up to 3 cards from the top of your deck and place them on top of your deck in any order.", undefined],
  ["BT22-082", "[Activate: Main] Switch this card to Rest Mode: Draw 1 card, look at up to 2 cards from the top of your opponent's deck and place them on top of their deck in any order.", "opponent"],
  ["BT22-114", "[activate: main/battle] If your Leader is a yellow <Fortuneteller Baba> card: Look at up to 3 cards from the top of your opponent's deck and place them on top of their deck in any order.", "opponent"],
  ["P-319", "[Activate: Main] If your Leader Card is blue: Look at up to 3 cards from the top of your deck and place them on top of your deck in any order. At the start of your next Main Phase, draw 1 card.", undefined],
] as const) {
  const rec = record(id, text);
  const look = opOf(rec, "look");
  assert.equal(look.length, 1, `A: ${id}: one look`);
  assert.equal(look[0].side, side, `A: ${id}: …of ${side ?? "your"} deck`);
  const arranged = opOf(rec, "arrange");
  assert.deepEqual(arranged, [{ op: "arrange", target: { var: look[0].as } }], `A: ${id}: the cards looked at are arranged`);
  assert.equal(opOf(rec, "note").length, 0, `A: ${id}: …never a note`);
  assert.match(rec.reads, /put the cards looked at back on top of the deck in any order/, `A: ${id}: …and the reading says so`);
}
// "…then place the remaining cards on top of your deck in any order" (BT12-031): the rest of the look, arranged.
{
  const rec = record("BT12-031", "[Activate: Main] If your Leader Card is a blue <Paikuhan> card and you discard this card: Look at up to 3 cards from the top of your deck, add up to 1 mono-blue ≪Saiyan≫ or ≪West Galaxy Warrior≫ card with an energy cost of 5 or less among them to your hand, then place the remaining cards on top of your deck in any order, and you can't activate the [Activate: Main] skill on copies of this card for the turn.");
  const arranged = opOf(rec, "arrange");
  assert.equal(arranged.length, 1, "A: BT12-031: the remaining cards are arranged");
  assert.ok("var" in arranged[0].target && arranged[0].target.minus, "A: BT12-031: …the look less the card taken");
}
// The bottom keeps its move: "…place the rest at the bottom of your deck in any order" is not asked (a bottom the deck reaches last).
{
  const rec = record("E2-BOTTOM", "[Activate: Main] Look at up to 3 cards from the top of your deck, add up to 1 card among them to your hand, and place the rest at the bottom of your deck in any order.");
  assert.equal(opOf(rec, "arrange").length, 0, "A: the bottom: no arrange");
  assert.ok(opOf(rec, "moveTo").some((o) => o.position === "bottom"), "A: the bottom: …a move to the bottom");
}
assert.equal(describeScript([{ op: "arrange", target: { var: "looked" } }]), "put the cards looked at back on top of the deck in any order", "A: the describer");

// ── the VM ──────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  E2_ARRANGE_THEIRS: card("E2_ARRANGE_THEIRS", { skill: "[Activate: Main] Look at up to 3 cards from the top of your opponent's deck and put them back in any order." }),
  E2_ARRANGE_MINE: card("E2_ARRANGE_MINE", { skill: "[Activate: Main] Look at up to 3 cards from the top of your deck and place them on top of your deck in any order." }),
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
function stage(s: VmState, p: PlayerId, def: string, area: string, under?: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p, ...(under ? { under } : {}) }).ok);
  if (area === "battle" || area === "energy" || area === "unison") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
const linesOf = (def: string) => parseSkills(defs[def].skill!).map((sk) => sk.index);
const offerOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && linesOf(s.cards[c].cardId).includes((l.action as { skill: number }).skill) && parseSkills(defs[s.cards[c].cardId].skill!).find((sk) => sk.index === (l.action as { skill: number }).skill)?.kind.startsWith("activate"));
type Prompt = VmState["prompt"];
type Steer = { cards?: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[] | undefined; asked?: string[] };
/** Answer every question until the turn player's Main Phase. */
function settle(s0: VmState, steer: Steer = {}): VmState {
  let s = s0;
  for (let i = 0; i < 80 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: 0 } as Action);
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
const inOrder = (...ids: string[]): Steer => {
  const asked: string[] = [];
  return { asked, cards: (q) => { const got = ids.filter((id) => q.choice.candidates.includes(id)).slice(0, 1); return got.length ? got : undefined; } };
};

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 52200 + n * 2 + (seat === "p1" ? 0 : 1);

  // A. The opponent's top 3, put back third, first, second; your own the same; one card left is not asked.
  for (const [def, whose] of [["E2_ARRANGE_THEIRS", foe], ["E2_ARRANGE_MINE", seat]] as const) {
    let s = fresh(seat, seed(def === "E2_ARRANGE_THEIRS" ? 0 : 1));
    const me = stage(s, seat, def, "battle");
    const [a, b, c] = s.sides[whose].zones.deck.slice(0, 3);
    const rest = s.sides[whose].zones.deck.slice(3);
    const steer = inOrder(c, a, b);
    s = activate(s, me, steer);
    assert.deepEqual(s.sides[whose].zones.deck.slice(0, 3), [c, a, b], `${seat}: A: ${def}: the top 3 in the order picked, the first on top`);
    assert.deepEqual(s.sides[whose].zones.deck.slice(3), rest, `${seat}: A: ${def}: …the rest of the deck untouched`);
    assert.equal(steer.asked!.length, 2, `${seat}: A: ${def}: …two picks asked, the last card forced`);
    assert.match(steer.asked![0], /choose the card to go on top$/, `${seat}: A: ${def}: …the first asks for the top card`);
    cases++;
  }
}

console.log(`verify/audit-effects-2: ok (${records} records, ${cases} VM cases across both seats)`);
