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
 * B.  Leaders and attackers: "your red <Beerus> Leader", "your white Leader", "your opponent's Leaders" are the Leader
 *     Area (BT24-005, BT28-112, BT22-009…), "your Leader Cards or ≪Android≫ cards" the Leader and Battle Areas (EB1-38),
 *     "in your Battle Area and Leader Area" both (EX08-03, with "<Baby> and ≪Brainwashed≫ cards" either kind); "the
 *     attacking Battle Card", "up to 1 attacking card", "your attacking cards" are the attacker (P-203, BT10-030,
 *     BT22-035).
 * C.  "The chosen card(s)" after a price that chose and an effect that chose nothing itself are the price's (BT22-127,
 *     BT21-111, BT15-048, BT24-007), never the card the effect just played.
 * D.  The reading says who chooses ("your opponent chooses", SD16-02), whose cards a look is of ("look at your
 *     opponent's hand", BT10-004 — and "choose … in it" is out of that look, EX11-02), where a card goes under ("under
 *     your leader", BT20-026) and which end of the deck ("to the bottom of the deck", BT5-044).
 *
 * Proved here: the records (nothing unread where the line is whole, the stored-row JSON round trip, the rules
 * language's print and reparse), and in the VM where an engine path moved.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { describeFilter, type Cond, type Op } from "../../src/lib/arena/vm/script";
import { parseFilter } from "../../src/lib/arena/text/filters";
import { correctSkillText } from "../../src/lib/catalog/errata";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmBattle, VmState } from "../../src/lib/arena/vm/state";
import { resolveSelector } from "../../src/lib/arena/vm/program";
import type { ScriptFrame } from "../../src/lib/arena/vm/script";

// ── the records ──────────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Rec = ReturnType<typeof skillRecords>[number];
const asRule = (rec: Rec) => roundtrip({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops }) as Rule;
const plain = (v: unknown) =>
  JSON.parse(JSON.stringify(v, function (this: Record<string, unknown>, k, x) {
    if (k === "upTo" && x === false) return undefined;
    if (k === "area" && Array.isArray(this.areas)) return undefined;
    // The language spells a [Counter: Battle Card Attack]'s kind without its spaces (a reparse that predates this batch).
    if (k === "kind" && typeof x === "string" && x.startsWith("counter:")) return x.replace(/\s+/g, "");
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

// ── B. Leaders and attackers ─────────────────────────────────────────────────
// B1. A Leader said with a name, a colour or the other player's possessive is the Leader Area.
for (const [text, what, side, op] of [
  ["[Auto] At the end of your turn, switch one of your red <Beerus> Leaders to Active Mode.", "BT24-005", "you", "choose"],
  ["[Auto] When this card is placed in a Battle Area, your red <Super 17> Leader gets +5000 power for the turn.", "BT26-007", "you", "power"],
  ["[activate: battle] [once per turn] Your white <North Kai> Leader gets +5000 power for the battle.", "BT30-115", "you", "power"],
  ["[activate: main][limit 1]{y}, if you have 4 or more energy: Choose up to 1 of your yellow <Broly: Br> Leaders and it gets +5000 power until the end of your opponent's turn.", "P-539", "you", "choose"],
  ["[auto][limit 1] If you have a {Special Beam Cannon, Inherited Power} in your Battle Area and this card is attacking: When your opponent activates a [counter] skill, choose up to 1 of your opponent's Leaders, and it gets -5000 power for the turn.", "BT22-009", "opponent", "choose"],
] as const) {
  const rec = record(text, what);
  const sel = op === "choose" ? opOf(rec, "choose")[0]?.sel : (() => { const p = opOf(rec, "power")[0]; return p && "sel" in p.target ? p.target.sel : undefined; })();
  assert.ok(sel && sel.area === "leader" && !sel.areas && sel.side === side, `B1: ${what} — the ${side === "you" ? "caster's" : "opponent's"} Leader Area (${JSON.stringify(sel)})`);
  records++;
}
{
  const rec = record("[Activate: Battle][Once per turn] Send 1 <Android 14> and 1 <Android 15> card from your Drop Area to your Warp: Choose 1 of your Leader Cards or ≪Android≫ cards and it gets +5000 power for the battle.", "EB1-38");
  const sel = opOf(rec, "choose")[0].sel;
  assert.deepEqual(sel.areas, ["leader", "battle"], `B1: EB1-38 — the Leader, or an ≪Android≫ card in the Battle Area too (${JSON.stringify(sel)})`);
  const baby = record("[Auto] When you play this card from your hand, if your Leader Card is a <Baby> card, choose all <Baby> and ≪Brainwashed≫ cards in your Battle Area and Leader Area, and they get +5000 power for the duration of the turn; choose up to 1 of your opponent's Leader Cards and negate its non-keyword skills for the duration of the turn.", "EX08-03");
  const all = opOf(baby, "choose")[0].sel;
  assert.ok(all.area === "play" && all.filter?.characterOrTrait, `B1: EX08-03 — every <Baby> and every ≪Brainwashed≫ card on the table (${JSON.stringify(all)})`);
  records += 2;
}
// B2. "Attacking" is the attack's own card.
for (const [text, what, kind] of [
  ["[counter: battle card attack] Choose the attacking Battle Card, KO it, then play this card.", "P-203", "BATTLE"],
  ["[Counter: Attack] If your Leader Card is mono-red: Choose up to 1 attacking Battle Card or Leader Card, ignoring [Barrier], and it gets -15000 power for the battle.", "BT10-030", null],
] as const) {
  const rec = record(text, what);
  const sel = opOf(rec, "choose")[0].sel;
  // Integration 2: a counted choice ("up to 1 attacking …", BT10-030) is audit-conditions-1's battle-role choice — a real
  // choice, so [Barrier] and "can't be chosen" are asked — of either player's card; "the attacking Battle Card" is the
  // attack's own card (special).
  if (what === "BT10-030") assert.ok(sel.battleRole === "attacker" && sel.side === "both" && !!sel.upTo && !!sel.ignoreBarrier, `B2: ${what} — the attacker (${JSON.stringify(sel)})`);
  else assert.ok(sel.special === "attacker" && (sel.filter?.type ?? null) === kind && !sel.upTo, `B2: ${what} — the attacker (${JSON.stringify(sel)})`);
  assert.match(rec.reads, what === "P-203" ? /choose the attacking Battle Card/ : /choose up to 1 card in each player's Leader Area or Battle Area that is attacking/, `B2: ${what} — said so`);
  records++;
}
{
  const rec = record("[activate: battle][limit 1]{u}{y}, if you have 5 or more energy, your blue <Gogeta> Z-Leader is attacking, and you remove this card from the game: Your attacking cards get +30000 power and [triple strike] for the battle.", "BT22-035");
  // Integration 2: audit-conditions-1 reads "your attacking cards" as your cards in the attacker's role (battleRole).
  for (const o of [...opOf(rec, "power"), ...opOf(rec, "grant")]) assert.ok("sel" in o.target && (o.target.sel.special === "attacker" || (o.target.sel.battleRole === "attacker" && o.target.sel.side === "you")), `B2: BT22-035 — only the attacking card (${JSON.stringify(o.target)})`);
  records++;
}
// B3 (review). Whose attacker: "1 of **your** attacking cards" (BT1-005, TB2-012 — combo cards the defender plays too)
// is the attacker only while it is the caster's; "1 of **your opponent's** attacking Battle Cards" (BT2-097) only while
// it is theirs; with no possessive (P-203) either. The VM half is below (B3 in play).
const attackerSel: Record<string, Op & { op: "choose" }> = {};
for (const [text, what, side] of [
  ["[Auto] When you Combo with this card, choose 1 of your attacking cards. It gains [Double Strike] (This card inflicts 2 damage instead of 1 when attacking) for the duration of the battle.", "BT1-005", "you"],
  ["[Auto] When you Combo with this card, choose up to 1 of your attacking cards. It gains [Double Strike] (This card inflicts 2 damage instead of 1 when attacking) for the duration of the battle.", "TB2-012", "you"],
  ["[Counter: Attack] Place 1 card from your hand in the Drop Area: Choose 1 of your opponent's attacking Battle Cards and KO it.", "BT2-097", "opponent"],
  ["[counter: battle card attack] Choose the attacking Battle Card, KO it, then play this card.", "P-203", undefined],
] as const) {
  const rec = record(text, what);
  const choose = opOf(rec, "choose")[0];
  // Integration 2: a counted choice ("1 of your attacking cards") is audit-conditions-1's battle-role choice, whose side
  // says whose attacker it may be; "the attacking Battle Card" stays the special.
  assert.ok((choose.sel.special === "attacker" && choose.sel.side === side) || (choose.sel.battleRole === "attacker" && choose.sel.side === side), `B3: ${what} — the attacker, ${side ?? "either player's"} (${JSON.stringify(choose.sel)})`);
  assert.match(rec.reads, side === "you" ? /your attacking card|card you have in play that is attacking/ : side === "opponent" ? /your opponent's attacking Battle Card|Battle Card in your opponent's Battle Area that is attacking/ : /the attacking Battle Card/, `B3: ${what} — said so (${rec.reads})`);
  attackerSel[what] = choose;
  records++;
}
// R (review). "That doesn't have ≪X≫" rules the name out; "the card sent to the Warp by this skill" after a price that
// sent this card is this card; a program that would play the Leader is unread, never played.
{
  const rec = record("[auto][limit 1] If your Leader is a yellow <Son Goku: Childhood> card or yellow Z-Leader: When this card is removed from a Battle Area by an opponent's skill, play up to 1 yellow <Son Goku: Childhood> card with an energy cost of 4 or less that doesn't have ≪Great Ape≫ from your Drop.", "BT18-096");
  const f = opOf(rec, "choose")[0].sel.filter!;
  assert.deepEqual([f.traits, f.notTraits.map((x) => x.toLowerCase()), f.characters.map((x) => x.toLowerCase())], [[], ["great ape"], ["son goku: childhood"]], `R: BT18-096 — ≪Great Ape≫ ruled out (${JSON.stringify(f)})`);
  assert.match(rec.reads, /non-≪great ape≫/, "R: BT18-096 — said so");
  records++;
}
{
  const rec = record("[Activate: Main] Send this card to its owner's Warp: At the start of your next Main Phase, if your Leader Card is a yellow ≪Universe 6≫ card, play the card that was sent to the Warp by this skill in its owner's Battle Area.", "BT7-080");
  const chosen = opOf(rec, "choose")[0];
  assert.ok(chosen.sel.special === "self" && chosen.sel.area === "warp", `R: BT7-080 — this card, from the Warp (${JSON.stringify(chosen.sel)})`);
  assert.ok(opOf(rec, "play").some((o) => "var" in o.target && o.target.var === chosen.as), "R: BT7-080 — and it is the card played");
  assert.ok(!opsDeep(rec.ops).some((o) => o.op === "choose" && o.sel.special === "leader"), "R: BT7-080 — never the Leader");
  records++;
}
{
  const recs = skillRecords(card("EX15-01", { skill: "[unique][blocker]<br>[union-fusion] Draw 1 card: Red <Son Goku: Br> and red <Vegeta: Br>.<br>[activate: main]{r}{r}{r}: If your Leader Card is a red <Gogeta: Br> card and you have 4 or more energy: Choose up to 1 mono-red <Gogeta: Br> card with an energy cost of 8 or less from your deck or hand, play it on top of this card, then shuffle your deck if you looked through it. You can't activate the [activate: main] skill on copies of this card for the turn." }));
  const line = recs.find((r) => r.skillIndex === 20);
  assert.ok(line && line.unread.length > 0, /* integration 2: audit-conditions-1 stops it earlier, at its "If …:" inside the effect */ `R: EX15-01 — a play of the Leader is unread (${JSON.stringify(line?.unread)})`);
}
for (const [text, what, clause] of [
  ["[Auto][Limit 1] If your Leader is a yellow Z-Leader or yellow <Son Goku: Childhood> card: When this card is switched to Rest Mode by one of your Leader skills, switch this card to Active Mode, then choose 1 of your yellow <Son Goku: Childhood> cards in Rest Mode that hasn't attacked this turn and switch it to Active Mode. If you do, draw 1 card.", "SD20-05", /hasn't attacked this turn/],
  ["[Activate: Battle] If your Leader Card is a mono-blue ≪Saiyan≫ card: Choose 1 of your cards in battle, and it gets +10000 power for the battle; if it's a blue skill-less ≪Saiyan≫ card, draw 1 card and the chosen card gets an additional +10000 power for the battle.", "BT13-058", /cards in battle/],
] as const) {
  const [rec] = skillRecords(card(what, { skill: text }));
  // Integration 2: audit-conditions-1 taught both qualifiers (`notAttackedThisTurn`, `battleRole: "any"`), so the clause
  // is now read with the qualifier on its selector; unread stays acceptable, a read without it is not.
  assert.ok(rec.unread.some((u) => clause.test(u)) || (!rec.unread.length && /"(?:notAttackedThisTurn|battleRole)"/.test(JSON.stringify(rec.ops))), `R: ${what} — the qualifier is read or leaves the clause unread (${JSON.stringify(rec.unread)})`);
}
{
  // …and "in a Battle Area", "not in a battle" are still read.
  const rec = record("[Auto] When you play this card, you may choose 1 [Field] card in a Battle Area with an energy cost of 1 or less and place it in its owner's Drop Area. If you do, this card gets +5000 power for the duration of the turn.", "P-152");
  assert.equal(opOf(rec, "choose")[0].sel.side, "both", "R: P-152 — a Battle Area is either player's, and still read");
  records++;
}

// ── C. "the chosen card(s)" after a price ───────────────────────────────────────
for (const [text, what, n, to] of [
  ["[activate: main][limit 1]{b}, if you have 3 or more energy and you choose 1 black <Cumber> card from your Drop or Warp: Play this card from your hand and place the chosen card under this card.", "BT22-127", 1, "under"],
  ["[activate: main]{y}{y}, choose 1 of your yellow ≪Saiyan≫ or ≪Frieza's Army≫ cards: Play this card from your Z-Energy and add the chosen card to your Z-Energy.", "BT21-111", 1, "zEnergy"],
  ["[activate: main]{u}, if your opponent has 2 or more energy and you choose 1 <Caulifla> card and 1 <Kale> card in your Drop Area: Play this card from your hand, then place the chosen cards under it.", "BT15-048", 2, "under"],
] as const) {
  const rec = record(text, what);
  const played = opOf(rec, "choose").find((o) => o.sel.special === "self")!.as;
  const moves = opOf(rec, "moveTo");
  assert.equal(moves.length, n, `C: ${what} — one move per card the price chose`);
  for (const m of moves) {
    assert.ok("var" in m.target && /^c\d+$/.test(m.target.var) && m.target.var !== played && m.to === to, `C: ${what} — the price's card moves, not the one played (${JSON.stringify(m)})`);
    if (to === "under") assert.ok(!m.under || ("var" in m.under && m.under.var === played), `C: ${what} — under the card played`);
  }
  records++;
}

// ── D. the reading says who, whose and where ──────────────────────────────────
for (const [text, what, said] of [
  ["[Auto][Once per turn] When you remove a marker from this card using a [Spirit Boost] skill, your opponent chooses 1 of their Battle Cards with an energy cost of 1 or less and sends it to its owner's Warp.", "SD16-02", /^your opponent chooses 1 Battle Card/],
  ["[-2][Activate: Main] Look at your opponent's hand, choose up to 1 Battle Card with 25000 power or less from it and discard it.", "BT10-004", /^look at your opponent's hand, choose up to 1 Battle Card with 25000 power or less of the cards looked at/],
  ["[Auto] At the end of your turn, place up to 1 blue <Android 18> card from your Drop under your Leader.", "BT20-026", /move the chosen cards under your leader$/],
  ["[Auto] During your turn, when your opponent plays a Battle Card, your opponent chooses 1 card in their hand and places it at the bottom of their deck.", "BT5-044", /your opponent chooses 1 card in your opponent's hand, move the chosen cards to the bottom of the deck$/],
] as const) {
  const rec = record(text, what);
  assert.match(rec.reads, said, `D: ${what} — ${rec.reads}`);
  records++;
}
{
  const rec = record("[-2][Activate: Main] Choose 1 of your Leader Cards and it gets -5000 power for the turn: Look at your opponent's hand, choose up to 1 multicolor Battle Card or Battle Card with 10000 power or less in it, and place it in its owner's Drop Area.", "EX11-02");
  const pick = opOf(rec, "choose")[0];
  assert.equal(pick.sel.fromVar, "looked", `D: EX11-02 — "in it" is the hand looked at (${JSON.stringify(pick.sel)})`);
  records++;
}

// ── E. tokens ────────────────────────────────────────────────────────────────
// E1. "Play up to N" tokens: each an offer of its own, one at a time.
for (const [text, what, n] of [
  ["[Auto] When this card attacks, play up to 1 Demon Realm Soldier Token. (Demon Realm Soldier Tokens have 5000 power, 0 combo cost, and 5000 combo power.)", "BT17-110", 1],
  ["[+1][Activate: Main] Play up to 2 Demon Realm Soldier Tokens. (Demon Realm Soldier Tokens have 5000 power, 0 combo cost, and 5000 combo power.)", "BT17-111", 2],
] as const) {
  const rec = record(text, what);
  const offers = opOf(rec, "may");
  assert.equal(offers.length, n, `E1: ${what} — ${n} offer(s)`);
  assert.ok(opOf(rec, "token").every((o) => o.n === 1 && o.power === 5000), `E1: ${what} — one token per offer, 5000 power`);
  records++;
}
// E2. In the opponent's Battle Area; and the power the card prints, however it prints it.
for (const [text, what, power, side] of [
  ["[Auto] At the start of your opponent's Main Phase, play 2 Clone Tokens with 10000 power in your opponent's Battle Area.", "BT8-041", 10000, "opponent"],
  ["[Auto] When this card attacks, play 1 Chilled's Army token. (Chilled's Army token has 10000 power)", "BT2-102", 10000, undefined],
] as const) {
  const rec = record(text, what);
  const token = opOf(rec, "token")[0];
  assert.ok(token.power === power && token.side === side, `E2: ${what} — ${power} power${side ? ", the opponent's side" : ""} (${JSON.stringify(token)})`);
  records++;
}
{
  // BT30-018: the reminder is printed on another line of the card (19-1-2).
  const recs = skillRecords(card("BT30-018", { skill: "[blocker]<br>[auto] When this card is played, add up to 1 card from your life to your hand, and play 2 Earthling Tokens. (Earthling Tokens have 1000 power, 0 combo cost, and 0 combo power.)<br>[+2][activate: main] Choose 1 of your Earthling Tokens and switch it to Rest Mode: Draw 2 cards and discard 2 cards from your hand.<br>[0][activate: battle] Play 1 Earthling Token." }));
  const last = recs.find((r) => r.skillIndex === 30)!;
  const token = opsDeep(last.ops).find((o): o is Extract<Op, { op: "token" }> => o.op === "token");
  assert.ok(token && token.power === 1000 && token.comboPower === 0, `E2: BT30-018 — the Earthling Token its first line describes (${JSON.stringify(token)})`);
  const frieza = record("[Auto] Add 1 card from your life to your hand, discard 1 card from your hand, and switch this card to Rest Mode: When your yellow <Frieza> with an energy cost of 3 is played, play 1 yellow Frieza's Army Token with a power of 10000 at the end of the turn, and that card gains [Blocker] until the end of your opponent's turn.", "BT21-106");
  const army = opOf(frieza, "token")[0];
  assert.ok(army.name === "Frieza's Army Token" && army.power === 10000 && army.colors.join() === "Yellow", `E2: BT21-106 — a yellow Frieza's Army Token of 10000 (${JSON.stringify(army)})`);
  records += 2;
}
// E3. "Your opponent chooses 1 card in their hand, sends it to their Warp, and draws 1 card": all the opponent's.
{
  const rec = record("[auto] When this card is played, your opponent chooses 1 card in their hand, sends it to their Warp, and draws 1 card.", "BT13-145");
  assert.deepEqual(rec.ops, [{ op: "discard", n: 1, side: "opponent", to: "warp" }, { op: "draw", n: 1, side: "opponent" }], `E3: BT13-145 (${JSON.stringify(rec.ops)})`);
  records++;
}

// ── F. one choice in two places ─────────────────────────────────────────────────
for (const [text, what, main, alt] of [
  ["[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards or energy and switch it to Rest Mode.", "BT7-083", "battle", "energy"],
  ["[auto] When this card is played, choose up to 1 card in your opponent's hand or up to 1 of their Battle Cards and send it to its owner's Warp.", "BT13-146", "hand", "battle"],
  ["[activate: main] {b}: You may play 1 blue <Son Goku> card with an energy cost of 2 from your energy or from under {Conflict} in your Battle Area. If you do, place this card under {Conflict} in your Battle Area.", "BT31-034", "under", "energy"],
  ["[activate: main][once per turn]{r}, if you don't have a red Unison Card in play: Choose up to 1 {Piccolo Jr., Descendant of the King} in your hand or face up in your life and play it with a marker on it.", "BT13-011", "hand", "life"],
] as const) {
  const rec = record(text, what);
  const sel = opOf(rec, "choose").find((o) => o.sel.alsoFrom)?.sel;
  assert.ok(sel && sel.area === main && sel.alsoFrom?.length === 1 && sel.alsoFrom[0].area === alt, `F: ${what} — ${main}, or ${alt} (${JSON.stringify(sel)})`);
  if (what === "BT7-083") assert.ok(sel.filter?.type === "BATTLE" && !sel.alsoFrom![0].filter, "F: BT7-083 — Battle Cards in the Battle Area, any card of the energy");
  if (what === "BT13-011") assert.ok(!sel.filter?.faceUp && sel.alsoFrom![0].filter?.faceUp, "F: BT13-011 — face up said of the life card only");
  records++;
}
{
  const rec = record("[Auto] When you play this card, choose all of your opponent's Battle Cards and energy in Rest Mode and place them in the Drop Area.", "TB1-081");
  const sel = opOf(rec, "choose")[0].sel;
  assert.ok(sel.count === 99 && !sel.upTo && sel.mode === "rest" && sel.alsoFrom?.[0].mode === "rest", `F: TB1-081 — all of both, in Rest Mode (${JSON.stringify(sel)})`);
  records++;
}

// ── G. alternatives of different kinds ─────────────────────────────────────────
{
  const alts = (text: string) => (parseFilter(text).anyOf ?? []).map((a) => JSON.stringify(Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null && v !== false && !(Array.isArray(v) && !v.length)))));
  assert.deepEqual(alts("{The Return of the Army of Terror} or yellow <Frieza>"), ['{"names":["The Return of the Army of Terror"]}', '{"colors":["Yellow"],"characters":["Frieza"]}'], "G: BT21-101 — a card name, or a yellow <Frieza>");
  assert.deepEqual(alts("{We Are Universe 7}, {Tournament of Power Arena}, or Red/Blue multicolor Extra Card"), ['{"names":["We Are Universe 7"]}', '{"names":["Tournament of Power Arena"]}', '{"colors":["Red","Blue"],"multiColor":true,"type":"EXTRA"}'], "G: BT9-028 — two Fields by name, or a Red/Blue Extra");
  assert.deepEqual(alts("red or green ≪Saiyan≫ card or {King Vegeta's Dynasty}"), ['{"colors":["Red","Green"],"traits":["Saiyan"]}', '{"names":["King Vegeta\'s Dynasty"]}'], "G: SD9-01 — the colour list stays the ≪Saiyan≫'s");
  assert.deepEqual(alts("red or ≪Universe 7≫ Battle Card"), ['{"colors":["Red"],"type":"BATTLE"}', '{"traits":["Universe 7"],"type":"BATTLE"}'], "G: BT14-013 — a red Battle Card or a ≪Universe 7≫ one");
  assert.deepEqual(alts("[Dragon Ball] or ≪Desire≫ cards"), ['{"keywords":["Dragon Ball"]}', '{"traits":["Desire"]}'], "G: BT5-116 — a keyword or a trait");
  assert.deepEqual(alts("<Great Priest> or blue <Whis> card"), ['{"characters":["Great Priest"]}', '{"colors":["Blue"],"characters":["Whis"]}'], "G: BT16-040 — blue is the <Whis>'s alone");
  assert.deepEqual(alts("choose up to 1 mono-yellow ≪Frieza's Army≫ or Unison Card in your hand"), ['{"colors":["Yellow"],"monoColor":true,"traits":["Frieza\'s Army"]}', '{"type":"UNISON"}'], "G: EX19-17 — a ≪Frieza's Army≫ card or a Unison Card");
  // Unchanged: one kind of name, characters beside traits, a qualifier before the "or".
  assert.ok(!parseFilter("<Son Goku> or <Vegeta> card").anyOf && !parseFilter("blue ≪Saiyan≫ or ≪Earthling≫ card").anyOf, "G: names of one kind stay one description");
  assert.ok(parseFilter("blue <Trunks: Youth>, ≪Hero≫, or ≪Phantom Demon≫ card").characterOrTrait, "G: BT24-025 — a character or either trait, all blue (R-180, pending)");
  assert.ok(!parseFilter("your green <Zamasu> card with an [Evolve] or [Union] skill").anyOf?.some((a) => !a.keywords.length), "G: BT26-061 — the keyword pair is still the keyword reader's");
  for (const [text, what] of [
    ["[Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 green <Majin Buu> card or {Absorption} to your hand, then shuffle your deck.", "BT30-062"],
    ["[Auto] When you play this card, look at up to 3 cards from the top of your deck. Choose up to 1  ≪Machine Mutant≫ or card whose card name includes {Baby} among them and add it to your hand. Then, shuffle your deck.", "BT3-017"],
  ] as const) {
    const pick = opOf(record(text, what), "choose")[0];
    assert.equal(pick.sel.filter?.anyOf?.length, 2, `G: ${what} — either one (${JSON.stringify(pick.sel.filter)})`);
    records++;
  }
}

// ── H. misprints, a name in brackets, a token's article ──────────────────────────
{
  const leader = record("[activate: main] [limit 1] {y}, if your Leader is a <(Duplicate) Vegeta> card: Play this card from your hand.", "BT31-073");
  const cond = flat(leader.cond).find((c): c is Extract<Cond, { kind: "leaderMatches" }> => c.kind === "leaderMatches");
  assert.deepEqual(cond?.filter.characters.map((x) => x.toLowerCase()), ["(duplicate) vegeta"], `H: BT31-073 — the character name with its brackets (${JSON.stringify(cond)})`);
  const after = record("[Permanent] If an Afterimage Token is in play in your Battle Area, this card can't be KO'd.", "DB2-046");
  const count = condsOf(after).find((c): c is Extract<Cond, { kind: "count" }> => c.kind === "count");
  assert.deepEqual(count?.sel.filter?.names, ["afterimage"], `H: DB2-046 — the Afterimage Token, without the article (${JSON.stringify(count)})`);
  records += 2;
  // The catalog's misprints, corrected as a sync stores them (`errata.ts`), then read.
  for (const [id, printed, wants] of [
    ["BT1-052", "[Activate: Main] Choose up to 1card from your hand, and add it to your energy.", /^choose up to 1 card in your hand/],
    ["BT25-018", "[Activate: Battle][Limit 1]{r}, if your Leader is a red <Son Goku: Childhood> card and you discard this card from your hand: Add up t 1 red skill-less Battle Card from your Drop to your hand, and your Leader gets +15000 power for the battle.", /choose up to 1 red skill-less Battle Card in your Drop Area/],
    ["BT27-015", "[Activate: Main][Once per turn] If your Leader is a red <Vegeta> card and you have 4 or more energy: Play up to 4 total red and/or black ≪Saiyan≫ cards from your Warp into their owner's Drop.", /in your Warp, move the chosen cards to drop$/],
    ["BT28-008", "[Permanent] You can activate this card's [Counter] skill from your hand by returning 1 {Gods of Dreams Dragon Ball} from your Battle Area to your hand instead of paying its energy cost.", /\{god of dreams dragon ball\}/],
  ] as const) {
    const fixed = correctSkillText(id, printed);
    assert.notEqual(fixed, printed, `H: ${id} — corrected`);
    assert.match(record(fixed!, id).reads, wants, `H: ${id} — read as the card means`);
    records++;
  }
}

// ── I. after a look, a description that names no place is one of the cards looked at ──
for (const [text, what] of [
  ["[Auto] When this card is played from your hand, look at up to 5 cards from the top of your deck, add up to 1 red Battle Card with an energy cost of 5 or less and <SH> in its character name to your hand, then shuffle your deck.", "BT22-014"],
  ["[Auto] When you play this card, look at up to 5 cards from the top of your deck, choose up to 1 Battle Card with 15000 or less power and <GT> in its character name and play it, then shuffle your deck.", "BT4-009"],
  ["[auto] Discard 1 card from your hand: When this card is played, look at up to 7 cards from the top of your deck, place up to 1 green ≪Earthling≫ card under this card, then shuffle your deck.", "BT29-044"],
  ["[activate: main] [once per turn] Add 1 card from your life to your hand: Look at up to 5 cards from the top of your deck, add up to 1 yellow card to your life, then shuffle your deck.", "BT31-056"],
] as const) {
  const rec = record(text, what);
  const pick = opOf(rec, "choose").find((o) => o.sel.fromVar);
  assert.ok(pick && pick.sel.fromVar === "looked" && !pick.sel.area, `I: ${what} — one of the cards looked at (${JSON.stringify(opOf(rec, "choose").map((o) => o.sel))})`);
  records++;
}
{
  // An owner is a place: "choose up to 1 opponent Battle Card" after a reveal is theirs in play (EX01-06).
  const rec = record("[Auto] When this card attacks, you may reveal 1 <Son Goten> from your hand. If you do so, choose up to 1 opponent Battle Card with an energy cost of 3 or less and KO that card.", "EX01-06");
  const ko = opOf(rec, "choose").find((o) => o.sel.side === "opponent");
  assert.ok(ko && ko.sel.area === "battle" && !ko.sel.fromVar, `I: EX01-06 — the opponent's Battle Area, not the revealed card (${JSON.stringify(ko?.sel)})`);
  records++;
}

// ── VM ───────────────────────────────────────────────────────────────────────
const vmDefs: Record<string, CardDef> = {
  ...DEFS,
  RESTER: card("RESTER", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards or energy and switch it to Rest Mode." }),
  FIELDX: card("FIELDX", { type: "EXTRA", colors: ["Blue"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Field] [Permanent] Nothing happens." }),
  CLONER: card("CLONER", { skill: "[Activate: Main] Play 2 Clone Tokens with 10000 power in your opponent's Battle Area." }),
  UPTWO: card("UPTWO", { skill: "[Activate: Main] Play up to 2 Demon Realm Soldier Tokens. (Demon Realm Soldier Tokens have 5000 power, 0 combo cost, and 5000 combo power.)" }),
};
const vmRows = Object.values(vmDefs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs: vmDefs, scripts: rulesFromRows(roundtrip(vmRows), vmDefs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const take = (s: VmState, action: Action): VmState => roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
function fresh(seat: PlayerId, seed: number): VmState {
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader: "L-BLUE", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
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
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
type Prompt = VmState["prompt"];
function settle(s0: VmState, pick: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[], answer = 0): VmState {
  let s = s0;
  for (let i = 0; i < 60 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: pick(q) });
    else if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: answer } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: null } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.equal(s.prompt.kind, "main", "settled");
  return s;
}
function activate(s: VmState, c: string, pick: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[] = (q) => q.choice.candidates.slice(0, q.choice.min), answer = 0): VmState {
  const offer = RULES.legalActions(ctx, s).find((l) => (l.action as { card?: string }).card === c && l.action.type === "activate");
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), pick, answer);
}
let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  // F in play: the opponent's Battle Card and energy are on offer, their [Field] Extra is not; the energy chosen rests.
  {
    let s = fresh(seat, 52000 + (seat === "p1" ? 0 : 1));
    const me = stage(s, seat, "RESTER", "battle");
    const theirs = stage(s, foe, "V-BLUE", "battle");
    const field = stage(s, foe, "FIELDX", "battle");
    const energy = stage(s, foe, "V-BLUE", "energy");
    let offered: string[] = [];
    s = activate(s, me, (q) => ((offered = q.choice.candidates), [energy]));
    assert.ok(offered.includes(theirs) && offered.includes(energy) && !offered.includes(field), `${seat}: F — a Battle Card or an energy, not their Field (${offered.join()})`);
    assert.equal(s.cards[energy].mode, "rest", `${seat}: F — the energy chosen is rested`);
    assert.equal(s.cards[theirs].mode, "active", `${seat}: F — and only it`);
    cases++;
  }
  // E in play: two Clone Tokens on the opponent's side; "up to 2" declined makes none.
  {
    let s = fresh(seat, 52010 + (seat === "p1" ? 0 : 1));
    const me = stage(s, seat, "CLONER", "battle");
    const before = s.sides[foe].zones.battle.length;
    s = activate(s, me);
    assert.equal(s.sides[foe].zones.battle.length, before + 2, `${seat}: E — two tokens in the opponent's Battle Area`);
    assert.ok(s.sides[foe].zones.battle.slice(-2).every((id) => s.cards[id].cardId === "Clone Token" || /clone/i.test(String((s.cards[id] as { name?: string }).name ?? s.cards[id].cardId))), `${seat}: E — Clone Tokens`);
    const up = stage(s, seat, "UPTWO", "battle");
    const mine = s.sides[seat].zones.battle.length;
    s = activate(s, up, (q) => q.choice.candidates.slice(0, q.choice.min), 1);
    assert.equal(s.sides[seat].zones.battle.length, mine, `${seat}: E — "up to 2" declined, none made`);
    s = activate(s, up, (q) => q.choice.candidates.slice(0, q.choice.min), 0);
    assert.equal(s.sides[seat].zones.battle.length, mine + 2, `${seat}: E — "up to 2" taken twice, two made`);
    cases++;
  }
  // B3 in play (review): "your attacking card" is nothing while the opponent attacks, and the attacker once it is yours.
  {
    const s = fresh(seat, 52020 + (seat === "p1" ? 0 : 1));
    const mine = stage(s, seat, "V1", "battle");
    const theirs = stage(s, foe, "V-BLUE", "battle");
    const frame = { card: mine, master: seat, vars: {} } as unknown as ScriptFrame;
    const offered = (what: string) => resolveSelector(ctx, game, s, frame, attackerSel[what].sel);
    s.battle = { attacker: theirs, guard: mine, target: mine, step: "attack", negated: false, blockerOffered: false } as unknown as VmBattle;
    assert.deepEqual([offered("BT1-005"), offered("TB2-012"), offered("BT2-097"), offered("P-203")], [[], [], [theirs], [theirs]], `${seat}: B3 — the opponent attacks: none of yours, theirs and "the attacking" one`);
    s.battle = { attacker: mine, guard: theirs, target: theirs, step: "attack", negated: false, blockerOffered: false } as unknown as VmBattle;
    assert.deepEqual([offered("BT1-005"), offered("TB2-012"), offered("BT2-097"), offered("P-203")], [[mine], [mine], [], [mine]], `${seat}: B3 — you attack: yours, none of theirs`);
    cases++;
  }
}

console.log(`audit-selectors-1: ${records} records, ${cases} VM cases`);
