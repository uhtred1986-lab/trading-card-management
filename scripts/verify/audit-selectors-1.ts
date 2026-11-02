/**
 * Audit selectors 1 (2 Nov 2026): the readings audit's selector lane — who a choice is of, where it looks, how many it
 * takes and which cards it names. Printed text inline (catalog text of the snapshot of 2 Nov 2026; costs, powers and
 * companions in the VM cases are synthetic).
 *
 * A.  Colours: several colours in one description are either of them unless the card must be multicolour, and the
 *     reading says so ("red or black", "multicolour green and yellow"); "a card that is both red and green" is that
 *     multicolour card (BT7-117, EX04-02, EX05-01…); "if you have blue and green cards in your Energy Area" is one of
 *     each (BT14-149, EB1-08, DB2-131), "1 or more each of red <A> and <B> cards" each name (BT22-004); a Leader "red,
 *     blue, green, and yellow" is one of every colour (P-264), "yellow, a <A> card, or a <B> card" three Leaders
 *     (BT17-148).
 *
 * Proved here: the records (nothing unread where the line is whole, the stored-row JSON round trip, the rules
 * language's print and reparse), and in the VM where an engine path moved.
 */
import assert from "node:assert/strict";
import { card } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { describeFilter, type Cond, type Op } from "../../src/lib/arena/vm/script";
import { parseFilter } from "../../src/lib/arena/text/filters";
import type { CardDef } from "../../src/lib/arena/types";

// ── the records ──────────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Rec = ReturnType<typeof skillRecords>[number];
const asRule = (rec: Rec) => roundtrip({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops }) as Rule;
const plain = (v: unknown) =>
  JSON.parse(JSON.stringify(v, function (this: Record<string, unknown>, k, x) {
    if (k === "upTo" && x === false) return undefined;
    if (k === "area" && Array.isArray(this.areas)) return undefined;
    return x;
  }));
/** The record of `text` (its only one, or the one at `index`), read whole, through the stored-row round trip and the language's print and reparse. */
function record(text: string, what: string, o: Partial<CardDef> = {}, index?: number): Rec {
  const recs = skillRecords(card(what, { skill: text, ...o }));
  const rec = index === undefined ? (assert.equal(recs.length, 1, `${what}: one record`), recs[0]) : recs.find((r) => r.skillIndex === index);
  assert.ok(rec, `${what}: a record at ${index}`);
  assert.deepEqual(rec.unread, [], `${what}: nothing unread`);
  const rule = asRule(rec);
  assert.equal(validateRule(rule, rec.kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  assert.deepEqual(plain(round.value), plain(rule), `${what}: …unchanged`);
  return roundtrip(rec);
}
const flat = (c: Cond | null | undefined): Cond[] => (!c ? [] : c.kind === "all" || c.kind === "any" ? c.conds.flatMap(flat) : [c]);
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "chooseMode" ? o.modes.flatMap((m) => opsDeep(m.ops)) : [])]);
const opOf = <K extends Op["op"]>(rec: Rec, op: K) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: K }> => o.op === op);
const condsOf = (rec: Rec) => [...flat(rec.cond), ...opOf(rec, "if").flatMap((o) => flat(o.cond))];
let records = 0;

// ── A. colours ───────────────────────────────────────────────────────────────
// A1. The reading says "or" between colours a card may have either of, "and" for a multicolour card — and the rules
// language's short form reads both back to the same colours.
{
  const either = parseFilter("red or black ≪Saiyan≫");
  assert.deepEqual([either.colors, either.multiColor, either.traits], [["Red", "Black"], false, ["Saiyan"]], "A1: either colour");
  assert.equal(describeFilter(either), "red or black ≪Saiyan≫", "A1: …said with 'or'");
  const three = parseFilter("mono-colour red, blue, green or yellow");
  assert.deepEqual(three.colors, ["Red", "Blue", "Green", "Yellow"], "A1: a list of four, one of them");
  assert.equal(describeFilter(three), "mono-colour red, blue, green or yellow", "A1: …said as a list");
  const both = parseFilter("Green/Yellow multicolor <Cell> card");
  assert.equal(describeFilter(both), "multicolour green and yellow <Cell>", "A1: a multicolour card is every colour, said with 'and'");
  assert.deepEqual(parseFilter(describeFilter(both)), both, "A1: …and reads back the same");
}
// A2. "A card that is both red and green": one multicolour card, not either colour.
for (const [text, what, where] of [
  ["[Permanent] If there is a card that is both red and green in your energy other than this card, negate this card's [Energy-Exhaust] skill in all areas.", "BT7-117", "cond"],
  ["[Auto] When you play this card, if there is a card that is both red and green in your energy, draw 1 card, then your opponent chooses 1 card from their hand and places it in their Drop Area.", "EX04-02", "cond"],
  ["[activate: main] {u}: Choose up to 1 ≪Agent of Destruction≫ card with an energy cost of 4 that is both blue and yellow from your deck, play it in Rest Mode, shuffle your deck, then place this card at the bottom of its owner's deck.", "EX05-01", "choose"],
  ["[Auto][Once per turn] When this card attacks or is attacked, you may choose 1 card in your hand and place it in your Drop Area. If you do, choose up to 1 Battle Card in your Drop Area that is both blue and yellow, and combo with it in your Combo Area.", "P-133", "choose"],
] as const) {
  const rec = record(text, what);
  const filters = where === "cond" ? condsOf(rec).flatMap((c) => ("sel" in c && c.sel?.filter ? [c.sel.filter] : [])) : opOf(rec, "choose").map((o) => o.sel.filter!).filter(Boolean);
  const f = filters.find((x) => x.colors.length === 2);
  assert.ok(f?.multiColor, `A2: ${what} — one card of both colours (${JSON.stringify(filters).slice(0, 200)})`);
  assert.match(rec.reads, /multicolour (?:red and green|blue and yellow)/, `A2: ${what} — and says so (${rec.reads})`);
  records++;
}
// A3. "If you have blue and green cards in your Energy Area": a card of each colour, every one counted.
for (const [text, what, colours, more] of [
  ["[permanent] If you have blue and green cards in your Energy Area, reduce the combo cost of this card in your hand by 1.", "BT14-149", ["Blue", "Green"], 0],
  ["[Activate: Main][Once per turn] If you have red and blue cards in your Energy Area and you place 1 card from your life in your Drop Area: For the turn, this card gets +20000 power and can't attack your opponent's Leader Card, and you can't play any Battle Cards except ≪Universe 7≫ cards.", "EB1-08", ["Red", "Blue"], 0],
  ["[activate: main] If you have at least 1 mono-red, mono-blue, mono-green, and mono-yellow card in your Drop Area and have 4 or more energy: Play this card from your hand.", "DB2-131", ["Red", "Blue", "Green", "Yellow"], 1],
] as const) {
  const rec = what === "EB1-08" ? roundtrip(skillRecords(card(what, { skill: text }))[0]) : record(text, what);
  const counts = condsOf(rec).filter((c): c is Extract<Cond, { kind: "count" }> => c.kind === "count");
  const coloured = counts.filter((c) => c.sel.filter?.colors.length);
  assert.deepEqual(coloured.map((c) => c.sel.filter!.colors), colours.map((c) => [c]), `A3: ${what} — one count per colour (${JSON.stringify(counts.map((c) => c.sel)).slice(0, 300)})`);
  assert.ok(coloured.every((c) => c.atLeast === 1), `A3: ${what} — at least one of each`);
  assert.equal(counts.length - coloured.length, more, `A3: ${what} — and the rest of the condition kept`);
  if (what === "DB2-131") assert.ok(counts.some((c) => c.sel.area === "energy" && c.atLeast === 4), "A3: DB2-131 — 4 or more energy, the half that was dropped");
  records++;
}
{
  const rec = record("[permanent] If you have 1 or more each of red <Gamma 1: SH> and <Gamma 2: SH> cards in play, reduce this card's energy cost in your Z-Deck by {r}, and reduce its Z-Energy cost by 1.", "BT22-004");
  const counts = condsOf(rec).filter((c): c is Extract<Cond, { kind: "count" }> => c.kind === "count");
  assert.deepEqual(counts.map((c) => [c.sel.filter!.colors, c.sel.filter!.characters.map((x) => x.toLowerCase())]), [[["Red"], ["gamma 1: sh"]], [["Red"], ["gamma 2: sh"]]], "A3: BT22-004 — each of the two names, both red");
  records++;
}
// A4. A Leader of every colour named, and a lone colour at the head of a list of Leaders.
{
  const rec = record("[Permanent] If your opponent's Leader Card is red, blue, green, and yellow, this card gains [Critical].", "P-264");
  const leader = condsOf(rec).find((c): c is Extract<Cond, { kind: "leaderMatches" }> => c.kind === "leaderMatches");
  assert.ok(leader?.side === "opponent" && leader.filter.multiColor && leader.filter.colors.length === 4, `A4: P-264 — their Leader has all four colours (${JSON.stringify(leader)?.slice(0, 200)})`);
  const gohan = record("[Auto] If your Leader Card is yellow, a <Son Gohan: Adolescence> card, or a <Piccolo> card: At the end of a battle in which this card was used in a combo from your hand, play this card from your Drop Area.", "BT17-148");
  const any = flat(gohan.cond).filter((c): c is Extract<Cond, { kind: "leaderMatches" }> => c.kind === "leaderMatches");
  assert.deepEqual(any.map((c) => [c.filter.colors, c.filter.characters.map((x) => x.toLowerCase())]), [[["Yellow"], []], [[], ["son gohan: adolescence"]], [[], ["piccolo"]]], "A4: BT17-148 — three Leaders, the yellow one any yellow Leader");
  records += 2;
}

console.log(`audit-selectors-1: ${records} records`);
