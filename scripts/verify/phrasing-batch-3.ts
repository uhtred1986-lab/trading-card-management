/**
 * Phrasing batch 3 (26 Oct 2026): more wordings of the open production rules
 * read by the compiler's phrase readers alone, and the owner's four rulings of
 * the day. Printed text inline (catalog text of the open-rules export of 26 Oct
 * 2026; costs, powers and companions in the VM cases are synthetic).
 *
 * A1 (owner's ruling): "{y}{y}, if you switch 5 yellow cards to Rest Mode:"
 *    (BT24-096) — any 5 of your Active Mode yellow cards, the energy included
 *    (P-106's Q&A counts the Leader, Battle Area and energy; BT23-140's "2 of
 *    your cards" is any 2 Active Mode cards).
 * A2 (owner's ruling): "you have 1 or more red cards and 1 or more yellow cards
 *    in your energy" (BT24-132) — both counts are in the energy.
 * A3 (owner's ruling): "they have a skill-less Battle Card or Unison Card in
 *    play" (BT15-125) — "skill-less" describes both.
 * A4 (owner's ruling): "[Counter: Play] Play this card, then … The played Battle
 *    Card has its skills negated for the turn" (BT14-154) — the card whose play
 *    the counter answers, not this card.
 *
 * Proved here: the records (nothing unread, the stored-row JSON round trip, the
 * rules language's print and reparse), what stays unread on purpose, and in the
 * VM for both seats with every action reloaded from JSON.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { skillsNegated } from "../../src/lib/arena/vm/effects";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { parseFilter } from "../../src/lib/arena/text/filters";
import { correctSkillText } from "../../src/lib/catalog/errata";
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
/** The one record of `text` at `index` (default: the only one), read whole, through the stored-row round trip and the language's print and reparse. */
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
const unreadOf = (text: string) => skillRecords(card("U", { skill: text }))[0].unread;
const flat = (c: Cond | null | undefined): Cond[] => (!c ? [] : c.kind === "all" ? c.conds.flatMap(flat) : [c]);
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "chooseMode" ? o.modes.flatMap((m) => opsDeep(m.ops)) : [])]);
const condsDeep = (rec: Rec): Cond[] => [...flat(rec.cond), ...opsDeep(rec.ops).flatMap((o) => (o.op === "if" ? flat(o.cond) : []))];
let records = 0;

// A1. BT24-096: the price is 5 of your Active Mode yellow cards, from every area a card has a mode in, the energy included.
const BT24_096 = "[activate: main][limit 1]{y}{y}, if you switch 5 yellow cards to Rest Mode: Draw 1 card and play this card from your hand.";
{
  const rec = record(BT24_096, "BT24-096", { colors: ["Yellow"] });
  const price = rec.cost?.program;
  assert.ok(price, "A1: an action price");
  const pick = price[0];
  assert.ok(pick.op === "choose" && "areas" in pick.sel && JSON.stringify(pick.sel.areas) === JSON.stringify(["play", "energy"]), "A1: chosen from the cards in play and the energy");
  assert.ok(pick.op === "choose" && pick.sel.count === 5 && !pick.sel.upTo && pick.sel.mode === "active" && pick.sel.filter?.colors.join() === "Yellow", "A1: exactly 5 Active Mode yellow cards");
  assert.deepEqual(price[1], { op: "switchMode", target: { var: pick.op === "choose" ? pick.as : "" }, mode: "rest" }, "A1: switched to Rest Mode");
  assert.equal(rec.cost?.orbs.Yellow, 2, "A1: …beside the {y}{y}");
  records++;
}
// Narrow on purpose: "switch" with anything more than a colour is not this ruling's shape.
assert.ok(unreadOf("[Activate: Main] If you switch 2 yellow Battle Cards in your Battle Area to Rest Mode: Draw 1 card.").length > 0, "A1: a described switch price stays to its own readers");

// A2. BT24-132: the area closing the second count closes the first.
const BT24_132 = "[Permanent] If your Leader is a red <Whis> card and you have 1 or more red cards and 1 or more yellow cards in your energy, reduce the energy cost of this card in your hand by 3.";
{
  const rec = record(BT24_132, "BT24-132");
  const counts = condsDeep(rec).filter((c): c is Extract<Cond, { kind: "count" }> => c.kind === "count");
  assert.equal(counts.length, 2, "A2: two counts");
  for (const [i, colour] of ["Red", "Yellow"].entries()) {
    const sel = counts[i].sel;
    assert.ok("area" in sel && sel.area === "energy" && sel.side === "you", `A2: the ${colour.toLowerCase()} cards are counted in your energy`);
    assert.equal(sel.filter?.colors.join(), colour);
  }
  records++;
}

// A3. BT15-125: "skill-less" describes the Unison Card too; "they" is the opponent.
const BT15_125 = "[Permanent] If it's your opponent's turn and they have a skill-less Battle Card or Unison Card in play, reduce the energy cost of this card in your hand by 1.";
{
  const rec = record(BT15_125, "BT15-125");
  const any = condsDeep(rec).find((c): c is Extract<Cond, { kind: "any" }> => c.kind === "any");
  assert.ok(any, "A3: one of two counts");
  const sels = any.conds.map((c) => (c.kind === "count" ? c.sel : null));
  assert.deepEqual(sels.map((s) => s && "area" in s ? `${s.side}:${s.area}:${s.filter?.skillLess}` : null), ["opponent:battle:true", "opponent:unison:true"], "A3: the opponent's skill-less Battle Cards or skill-less Unison Cards");
  records++;
}

// A4. BT14-154: the played Battle Card is the one the counter answers.
const BT14_154 = "[Counter: Play] Play this card, then choose up to 1 of your opponent's Battle Cards in Rest Mode, ignoring [Barrier], and place it under this card. The played Battle Card has its skills negated for the turn.";
{
  const ops = record(BT14_154, "BT14-154").ops;
  assert.deepEqual(ops[ops.length - 1], { op: "resolvingPlay", negated: true }, "A4: the card being played arrives with its skills negated");
  assert.ok(!ops.some((o) => o.op === "negateSkills"), "A4: …and this card, which the skill played, is not negated");
  records++;
}
// Outside a [Counter: Play] "the played card" is the skill's own play, as before.
assert.ok(!JSON.stringify(skillRecords(card("U", { skill: "[Activate: Main] Play up to 1 red card from your hand. The played Battle Card has its skills negated for the turn." }))[0].ops).includes("resolvingPlay"), "A4: only in a [Counter: Play]");

// B1. A trigger's second moment said after a comma (the trigger readers already answer to both).
for (const [text, what, triggers] of [
  ["[Auto] When this card attacks, or activates the [Blocker] skill, switch this card to Active Mode.", "BT27-074", "attacks,blockerUsed"],
  ["[Auto][Once per turn] At the end of your turn, or when this card activates its [blocker] skill, switch this card to Active Mode.", "BT13-018", "turnEnd,blockerUsed"],
  ["[Auto][Once per turn] At the end of your turn, or when you activate this card's [Blocker] skill, switch this card to Active Mode.", "BT25-116", "turnEnd,blockerUsed"],
] as const) {
  const rec = record(text, what);
  assert.equal([...rec.trigger].sort().join(), triggers.split(",").sort().join(), `${what}: both moments`);
  assert.deepEqual(rec.ops, [{ op: "switchMode", target: { sel: { special: "self" } }, mode: "active" }], `${what}: the effect alone`);
  records++;
}

// B2. A host named by a counted description, chosen; the top card "up to 1"; "the chosen Battle Card"; "that card" after this card went under.
{
  const BT8_058 = "[Auto] When you play this card, place the top card of your deck under a {Dr.Uiro's Lab} in your Battle Area, then draw 1 card.";
  const ops = record(BT8_058, "BT8-058").ops;
  assert.ok(ops[0].op === "choose" && "area" in ops[0].sel && ops[0].sel.area === "battle" && ops[0].sel.count === 1 && ops[0].sel.filter?.names.join() === "dr.uiro's lab", "BT8-058: the Lab is chosen in your Battle Area");
  assert.ok(ops[1].op === "moveTo" && ops[1].to === "under" && JSON.stringify(ops[1].under) === JSON.stringify({ var: ops[0].op === "choose" ? ops[0].as : "" }) && "sel" in ops[1].target && ops[1].target.sel.take === 1, "BT8-058: the top card goes under the chosen Lab");
  const BT9_085 = "[Activate: Battle] Choose up to 1 of your opponent's Battle Cards and place it under a <Majin Buu> card in your Battle Area.";
  const ops2 = record(BT9_085, "BT9-085").ops;
  assert.ok(ops2[1].op === "choose" && ops2[1].sel.filter?.characters.join() === "majin buu" && ops2[2].op === "moveTo" && ops2[2].to === "under", "BT9-085: a <Majin Buu> card chosen as the host");
  const P_639 = "[Auto] When this card attacks, choose up to 1 of your opponent's Battle Cards, place it under your <Fin> Leader.";
  const ops3 = record(P_639, "P-639").ops;
  const toFin = ops3.find((o) => o.op === "moveTo");
  assert.ok(toFin?.op === "moveTo" && toFin.under && "sel" in toFin.under && toFin.under.sel.area === "leader" && toFin.under.sel.filter?.characters.join() === "fin", "P-639: under your Leader, when it is a <Fin>");
  const P_555 = "[Auto] When this card attacks, look at up to 5 cards from the top of your deck, place up to 1 red <Trunks: Future> card under a {Destroyed West City} in your battle area, then shuffle your deck.";
  const ops4 = record(P_555, "P-555").ops;
  assert.ok(ops4[1].op === "choose" && "fromVar" in ops4[1].sel && ops4[1].sel.fromVar === "looked", "P-555: the card is among the cards looked at");
  const BT2_024 = "[Auto] When this card attacks, place up to 1 card from the top of your deck under your {Majin Buu's Sealed Ball}.";
  const ops5 = record(BT2_024, "BT2-024").ops;
  assert.ok(ops5[1].op === "may" && ops5[1].ops[0].op === "moveTo" && "sel" in ops5[1].ops[0].target && ops5[1].ops[0].target.sel.take === 1, "BT2-024: the top card, if the player wants — never a card searched out of the deck");
  const TB3_058 = "[Activate: Main] Choose 1 other ≪Namekian≫ card in your Battle Area: Place this card under the chosen Battle Card, and that card gets +5000 power for the duration of the turn.";
  const rec6 = record(TB3_058, "TB3-058");
  const host = rec6.cost?.program?.[0];
  assert.ok(host?.op === "choose", "TB3-058: the price chose the host");
  assert.deepEqual(rec6.ops, [
    { op: "moveTo", target: { sel: { special: "self" } }, to: "under", under: { var: host.as } },
    { op: "power", target: { var: host.as }, amount: 5000, until: "turn" },
  ], "TB3-058: this card under the chosen card, and that card +5000");
  records += 6;
}
// A list of alternatives cannot be one description: left unread.
assert.ok(unreadOf("[Auto] When this card is played, look at up to 7 cards from the top of your deck, place up to 1 mono-blue <Vegeta: GT> with an energy cost of 1 or 1 mono-blue ≪Brainwashed≫ under one of your {Universal Tuffleization Plan} cards, then shuffle your deck.").length > 0, "BT21-041: \"…or 1 mono-blue ≪Brainwashed≫\" stays unread");

// B3. A pair of named cards with one aside for both, each its own choice (`named-set.ts`).
{
  const each = (rec: Rec, what: string, n: number) => {
    const picks = opsDeep(rec.ops).filter((o): o is Extract<Op, { op: "choose" }> => o.op === "choose");
    const last = picks.slice(-n);
    assert.ok(last.slice(1).every((p, i) => JSON.stringify(p.sel.notIn) === JSON.stringify(last.slice(0, i + 1).map((q) => q.as))), `${what}: each a card of its own`);
    return last;
  };
  const BT24_123 = "[Auto] When this card is played, play up to 1 <Son Goku: Xeno> and up to 1 <Vegeta: Xeno> card—both mono-black and with an energy cost of 4 or less—from your deck in Rest Mode with their skills negated for the game.";
  const picks = each(record(BT24_123, "BT24-123"), "BT24-123", 2);
  for (const p of picks) assert.ok(p.sel.filter?.monoColor && p.sel.filter.colors.join() === "Black" && p.sel.filter.costMax === 4 && "area" in p.sel && p.sel.area === "deck", "BT24-123: mono-black, cost 4 or less, from the deck");
  const plays = record(BT24_123, "BT24-123").ops.filter((o) => o.op === "play");
  assert.ok(plays.length === 2 && plays.every((o) => o.op === "play" && o.mode === "rest" && o.negated === "game"), "BT24-123: both played in Rest Mode, negated for the game");
  const P_632 = "[Auto] When this card is played, add up to 1 <Son Goku> card and up to 1 <Vegeta> card―both green, with an energy cost of 1, and without [Super Combo]―from your Drop to your hand.";
  for (const p of each(record(P_632, "P-632"), "P-632", 2)) assert.ok(p.sel.filter?.colors.join() === "Green" && p.sel.filter.costMax === 1 && p.sel.filter.notKeywords.length === 1, "P-632: green, cost 1, without [Super Combo]");
  const BT25_061 = "[Auto] When this card is played, add up to 1 <Son Goten> card and up to 1 <Trunks: Youth> card -- both blue and skill-less -- from your Drop to your hand.";
  for (const p of each(record(BT25_061, "BT25-061"), "BT25-061", 2)) assert.ok(p.sel.filter?.skillLess && p.sel.filter.colors.join() === "Blue", "BT25-061: blue and skill-less");
  const BT20_079 = "[Auto] When this card is played, play up to 1 <Android 17> card and 1 <Hell Fighter 17> card―both with energy costs of 1―from your Drop with their skills negated for the turn.";
  for (const p of each(record(BT20_079, "BT20-079"), "BT20-079", 2)) assert.ok(p.sel.filter?.costMax === 1 && p.sel.filter.costMin === 1, "BT20-079: no colour, cost 1");
  const BT10_020 = "[Auto] When this card is played from your hand, play up to 1 red <Mai> card and up to 1 red <Shu> card with energy costs of 2 from your deck, then shuffle your deck.";
  for (const p of each(record(BT10_020, "BT10-020"), "BT10-020", 2)) assert.ok(p.sel.filter?.costMax === 2 && "area" in p.sel && p.sel.area === "deck", "BT10-020: the plural measure is every card's");
  const BT20_054 = "[Auto] When this card is placed in your Leader Area, send up to 1 {Android 20, Vengeful Alliance} and 1 {Dr. Myuu, Vengeful Alliance} from your deck to your Warp.";
  const sends = each(record(BT20_054, "BT20-054"), "BT20-054", 2);
  assert.deepEqual(sends.map((p) => p.sel.filter?.names.join()), ["android 20, vengeful alliance", "dr. myuu, vengeful alliance"], "BT20-054: a name's own comma does not cut the list");
  const BT7_006 = "[Auto] When a card evolves into this card, choose up to 1 green <Son Goten> card and 1 green <Trunks: Youth> card with energy costs of 4 from your Drop Area and play them.";
  each(record(BT7_006, "BT7-006"), "BT7-006", 2);
  const BT5_015 = "[Auto] When this card is KO'd, choose up to 1 each of {Pilaf, Leader of the Crew}, {Shu, Trusted Lackey}, and {Mai, Trusted Lackey} from your Drop Area and play them.";
  const pilaf = each(record(BT5_015, "BT5-015"), "BT5-015", 3);
  assert.equal(pilaf[0].sel.filter?.type, null, "BT5-015: the word in a name is not a card type");
  records += 8;
}
// (P-711's "-both multicolor and with an energy cost of 4-" aside was left unread here for a ruling; the owner ruled on
// 26 Oct 2026 that it describes both alternatives, and `phrasing-batch-4.ts` proves the reading.)

// B4. Measures joined by "and" that a split lost.
{
  const BT19_123 = "[Auto] When this card is used in a combo from your Battle Area, play up to 1 yellow ≪Slug's Army≫ card with an energy cost of 3 and combo cost of 1 from your hand.";
  const pick = record(BT19_123, "BT19-123").ops[0];
  assert.ok(pick.op === "choose" && pick.sel.filter?.costMax === 3 && JSON.stringify(pick.sel.filter).includes('"comboCost'), "BT19-123: the energy cost and the combo cost");
  const BT21_139 = "[Activate: Main] Play up to 1 black <Mechikabura> with an energy cost of 8 and a power of 30000 from your hand or Drop, and that card gains [barrier] for the turn.";
  const pick2 = record(BT21_139, "BT21-139").ops[0];
  assert.ok(pick2.op === "choose" && pick2.sel.filter?.powerMin === 30000 && pick2.sel.filter.powerMax === 30000, "BT21-139: \"a power of 30000\" is the power");
  const BT15_015 = "[Activate: Main] Choose up to 1 red <Son Gohan: Adolescence> card without [barrier] and with an energy cost of 4 in your hand and play it.";
  const pick3 = record(BT15_015, "BT15-015").ops[0];
  assert.ok(pick3.op === "choose" && pick3.sel.filter?.costMax === 4 && pick3.sel.filter.notKeywords.length === 1 && "area" in pick3.sel && pick3.sel.area === "hand", "BT15-015: without [Barrier] and cost 4, in the hand");
  assert.equal(parseFilter("Battle Card that does not have a character name that includes <Son Goku: GT>").notCharactersIncluding.join(), "Son Goku: GT", "BT21-063: the negation said the long way");
  records += 3;
}

// B5. Both players, the opponent's verbs, and smaller wordings.
{
  const EX25_33 = "[Activate: Main] Play this card from your hand, then you and your opponent both draw 2 cards and discard 1 card from your hands.";
  const ops = record(EX25_33, "EX25-33").ops;
  assert.deepEqual(ops.slice(-4), [{ op: "draw", n: 2 }, { op: "draw", n: 2, side: "opponent" }, { op: "discard", n: 1 }, { op: "discard", n: 1, side: "opponent" }], "EX25-33: each player draws 2 and discards 1");
  const BT14_121 = "[Auto] When this card is played, you and your opponent place the top card of your decks in your Drop Areas.";
  assert.deepEqual(record(BT14_121, "BT14-121").ops.map((o) => (o.op === "mill" ? `${o.n}:${o.side ?? "you"}` : o.op)), ["1:you", "1:opponent"], "BT14-121: one card each");
  const BT30_007 = "[Activate: Main] Add up to 1 {Spirit} from your life to your hand, then shuffle your life.";
  assert.deepEqual(record(BT30_007, "BT30-007").ops.at(-1), { op: "shuffle", areas: ["life"] }, "BT30-007: the Life Area shuffled");
  const DB1_077 = "[Activate: Main][Once per turn] Your opponent reveals the top card of their deck, then shuffles their deck. If the revealed card was a Battle Card, this card gains [Double Strike] for the duration of the turn.";
  assert.deepEqual(record(DB1_077, "DB1-077").ops[1], { op: "shuffle", side: "opponent" }, "DB1-077: the opponent shuffles");
  const BT26_028 = "[Activate: Battle][Limit 1] Choose 1 of your red <Son Goku: GT> cards and you may give it -15000 power for the battle. If you do, draw 1 card.";
  const ops2 = record(BT26_028, "BT26-028").ops;
  assert.ok(ops2[1].op === "may" && ops2[1].ops[0].op === "power" && ops2[1].ops[0].amount === -15000, "BT26-028: the offer is the power change");
  const P_134 = "[Auto] When a card evolves into this card, your opponent reveals their hand. Choose up to 1 Battle Card with 35000 power or less from it and place it in your opponent's Drop Area.";
  assert.ok(record(P_134, "P-134").ops.some((o) => o.op === "moveTo" && o.to === "drop"), "P-134: to its owner's Drop Area");
  const BT14_001B = "[Auto][Once per turn] When you use a red skill-less Battle Card with an energy cost of 2 in a combo, it gets +6000 combo power for the battle.";
  const rec = record(BT14_001B, "BT14-001b");
  assert.deepEqual(rec.trigger, ["youCombo"], "BT14-001b: the moment you use a card in a combo");
  assert.ok(rec.ops.some((o) => o.op === "comboPower" && "sel" in o.target && o.target.sel.special === "subject"), "BT14-001b: \"it\" is the card used");
  const BT19_091 = "[Activate: Main][Limit 1] Send this card to its owner's Warp: At the start of your next turn's Main Phase, play this card from your Warp.";
  const delay = record(BT19_091, "BT19-091").ops[0];
  assert.ok(delay.op === "delay" && delay.at === "mainStart" && delay.scope === "yourNextTurn", "BT19-091: your next Main Phase");
  const P_662 = "[Activate: Main][Once per turn] Add 2 yellow ≪Cell Games≫ cards with energy costs of 7 or less from your Drop to your deck, then shuffle your deck: Choose up to 1 of your opponent's Battle Cards and switch it to Rest Mode.";
  assert.deepEqual(record(P_662, "P-662").cost?.program?.map((o) => o.op), ["choose", "moveTo", "shuffle"], "P-662: the price shuffles the two cards into the deck");
  const BT9_126B = "[Auto] When this card attacks choose one---・Choose up to 1 of your opponent's Battle Cards with an energy cost of 3 or less and KO it.・Draw 1 card";
  assert.ok(record(BT9_126B, "BT9-126b").ops[0].op === "chooseMode", "BT9-126b: three dashes after \"choose one\"");
  records += 10;
}

// B6. Catalog misspellings (`src/lib/catalog/errata.ts`), read once corrected.
{
  for (const [id, text, line] of [
    ["BT27-031", "[Activate: Main][Once per turn] Add 1 blue ≪Red Ribbon Army≫ card from your energy to you hand: Choose up to 1 of your opponent's Battle Cards and place it a the bottom of its owner's deck.", /to your hand: .* at the bottom of/],
    ["BT28-077", "[Activate: Main][Limit 1] If your Leader is a green <Tien Shinhan> card: Draw 1 card, choose up to 1 of your opponent's Battle Cards and KO it, then choose one --・Choose all of your Multi-Form Tkoens and they get +5000 power for the turn.・Choose up to 1 of your green <Tien Shinhan> cards and it gains [Double Strike] for the turn.", /Multi-Form Tokens/],
    ["BT31-144", "[Auto][Once per turn] Remove 1 marker from this card: When your opponent's Battle Card is played, switch up to 1 of your energy to Activate Mode, and this card gains [revenge] for the turn.", /to Active Mode/],
  ] as const) {
    const corrected = correctSkillText(id, text)!;
    assert.match(corrected, line, `${id}: the catalog correction applies`);
    assert.equal(correctSkillText(id, corrected), corrected, `${id}: …and is safe to apply twice`);
    assert.ok(unreadOf(text).length > 0, `${id}: as exported, unread`);
    record(corrected, id);
    records++;
  }
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  "L-YELLOW": card("L-YELLOW", { type: "LEADER", colors: ["Yellow"], energyCost: null, comboCost: null, comboPower: null }),
  "V-YEL": card("V-YEL", { colors: ["Yellow"] }),
  // A1: BT24-096's line.
  SWITCH5: card("SWITCH5", { colors: ["Yellow"], energyCost: 6, skill: "[Activate: Main][Limit 1]{y}{y}, if you switch 5 yellow cards to Rest Mode: Draw 1 card and play this card from your hand." }),
  // A2: BT24-132's reduction without its Leader condition.
  WHIS: card("WHIS", { colors: ["Red"], energyCost: 4, skill: "[Permanent] If you have 1 or more red cards and 1 or more yellow cards in your energy, reduce the energy cost of this card in your hand by 3." }),
  // A3: BT15-125's condition on the turn player's own turn ("your opponent has", as BT15-125's "they" reads).
  SKILLLESS: card("SKILLLESS", { colors: ["Red"], energyCost: 2, skill: "[Permanent] If your opponent has a skill-less Battle Card or Unison Card in play, reduce the energy cost of this card in your hand by 1." }),
  "U-SKILL": card("U-SKILL", { type: "UNISON", colors: ["Blue"], energyCost: 0, power: 10000, comboCost: null, comboPower: null, skill: "[Activate: Main] Draw 1 card." }),
  "U-BARE": card("U-BARE", { type: "UNISON", colors: ["Blue"], energyCost: 0, power: 10000, comboCost: null, comboPower: null, skill: null }),
  // A4: BT14-154's counter without its middle clause; the card it answers has a skill the negation would stop.
  CPNEG: card("CPNEG", { colors: ["Red"], energyCost: 1, skill: "[Counter: Play] Play this card. The played Battle Card has its skills negated for the turn." }),
  PLAYED: card("PLAYED", { colors: ["Red"], energyCost: 1, skill: "[Activate: Main] Draw 1 card." }),
  // B2: TB3-058's line.
  UNDERHOST: card("UNDERHOST", { skill: "[Activate: Main] Choose 1 other red card in your Battle Area: Place this card under the chosen Battle Card, and that card gets +5000 power for the duration of the turn." }),
  // B3: BT24-123's pair, from the Drop (a deck search would shuffle the staged deck).
  PAIR: card("PAIR", { skill: "[Activate: Main] Play up to 1 <Son Goku: Xeno> and up to 1 <Vegeta: Xeno> card—both mono-black and with an energy cost of 4 or less—from your Drop in Rest Mode with their skills negated for the game." }),
  GOKUX: card("GOKUX", { colors: ["Black"], energyCost: 4, characters: ["Son Goku: Xeno"], skill: "[Activate: Main] Draw 1 card." }),
  VEGX: card("VEGX", { colors: ["Black"], energyCost: 3, characters: ["Vegeta: Xeno"] }),
  VEGX5: card("VEGX5", { colors: ["Black"], energyCost: 5, characters: ["Vegeta: Xeno"] }),
  // B5: EX25-33's both-players draw and discard.
  BOTHDRAW: card("BOTHDRAW", { skill: "[Activate: Main] You and your opponent both draw 2 cards and discard 1 card from your hands." }),
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
/** The seat's Main Phase, hands and energy emptied back into the decks; the seat's Leader is `leader`. */
function fresh(seat: PlayerId, seed: number, leader = "L-BLUE"): VmState {
  const leaders = { p1: seat === "p1" ? leader : "L-BLUE", p2: seat === "p2" ? leader : "L-BLUE" };
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader: leaders.p1, main: fifty("V1") }, p2: { name: "Second", leader: leaders.p2, main: fifty("V-BLUE") } }).state as VmState;
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
  // The second player's Energy Marker would pay one energy the cases below count exactly.
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy" || area === "unison") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
const lineOf = (def: string) => parseSkills(defs[def].skill!)[0].index;
const offerOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === lineOf(s.cards[c].cardId));
const playable = (s: VmState, c: string) => RULES.legalActions(ctx, s).some((l) => l.action.type === "play" && (l.action as { card: string }).card === c);
type Prompt = VmState["prompt"];
/** Answer every question until `done` holds (the turn player's Main Phase by default). */
function settle(s0: VmState, steer: { cards?: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[] | undefined } = {}, done: (s: VmState) => boolean = (s) => s.prompt.kind === "main"): VmState {
  let s = s0;
  for (let i = 0; i < 60 && !done(s); i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: steer.cards?.(q) ?? q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: null } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.ok(done(s), `settled (at ${s.prompt.kind})`);
  return s;
}
const powerOf = (s: VmState, id: string) => s.effects.filter((e) => e.kind === "power" && e.target === id).reduce((n, e) => n + Number(e.value), 0);

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 26300 + n * 2 + (seat === "p1" ? 0 : 1);

  // A1. Five Active Mode yellow cards, the energy among them: four are not enough, five are, a red card never counts.
  {
    let s = fresh(seat, seed(0), "L-YELLOW");
    const hand = stage(s, seat, "SWITCH5", "hand");
    const energy = [0, 1, 2, 3].map(() => stage(s, seat, "V-YEL", "energy"));
    const yellow = stage(s, seat, "V-YEL", "battle");
    const red = stage(s, seat, "V1", "battle");
    assert.ok(!offerOf(s, hand), `${seat}: A1: after {y}{y}, the Leader, 2 energy and 1 Battle Card are 4 yellow cards — not offered`);
    const second = stage(s, seat, "V-YEL", "battle");
    const offer = offerOf(s, hand);
    assert.ok(offer, `${seat}: A1: a fifth yellow card — offered`);
    s = take(s, offer.action);
    const hand0 = s.sides[seat].zones.hand.length;
    let asked: string[] = [];
    s = settle(s, { cards: (q) => { if (q.choice.min === 5) asked = q.choice.candidates.slice(); return undefined; } });
    // Exactly five are left once {y}{y} is paid, so the five may be taken without a question; when one is asked, a red card is never offered.
    assert.ok(!asked.includes(red), `${seat}: A1: a red card is not a yellow card`);
    for (const id of [...energy, yellow, second, s.sides[seat].zones.leader[0]]) assert.equal(s.cards[id].mode, "rest", `${seat}: A1: ${s.cards[id].cardId} is rested — the Leader, the energy and the Battle Area all count`);
    assert.equal(s.cards[red].mode, "active", `${seat}: A1: the red card is left alone`);
    assert.ok(s.sides[seat].zones.battle.includes(hand), `${seat}: A1: the card is played`);
    assert.equal(s.sides[seat].zones.hand.length, hand0, `${seat}: A1: drew 1 (the played card left the hand)`);
    cases++;
  }

  // A2. Red and yellow both in the energy reduce the cost by 3; a yellow card elsewhere does not.
  {
    const s = fresh(seat, seed(1));
    const w = stage(s, seat, "WHIS", "hand");
    stage(s, seat, "V1", "energy");
    stage(s, seat, "V1", "energy");
    stage(s, seat, "V-YEL", "battle");
    assert.ok(!playable(s, w), `${seat}: A2: a yellow card in the Battle Area is not in the energy — cost 4 on 2 energy`);
    const t = fresh(seat, seed(2));
    const w2 = stage(t, seat, "WHIS", "hand");
    stage(t, seat, "V1", "energy");
    stage(t, seat, "V-YEL", "energy");
    assert.ok(playable(t, w2), `${seat}: A2: red and yellow in the energy — cost 1`);
    cases++;
  }

  // A3. A Unison counts only when it is skill-less.
  for (const [unison, reduced] of [["U-SKILL", false], ["U-BARE", true]] as const) {
    const s = fresh(seat, seed(3 + (reduced ? 1 : 0)));
    const c = stage(s, seat, "SKILLLESS", "hand");
    stage(s, seat, "V1", "energy");
    stage(s, foe, unison, "unison");
    assert.equal(playable(s, c), reduced, `${seat}: A3: the opponent's ${reduced ? "skill-less" : "skilled"} Unison ${reduced ? "reduces" : "does not reduce"} the cost`);
    cases++;
  }

  // A4. The counter is played; the card it answers arrives negated, the counter itself does not.
  {
    let s = fresh(seat, seed(5));
    const played = stage(s, seat, "PLAYED", "hand");
    stage(s, seat, "V1", "energy");
    const cp = stage(s, foe, "CPNEG", "hand");
    stage(s, foe, "V1", "energy");
    s = take(s, { type: "play", player: seat, card: played } as Action);
    if (s.prompt.kind === "payCost") s = take(s, { type: "payCost", player: seat, option: 0 } as Action);
    assert.equal(s.prompt.kind, "counter", `${seat}: A4: the play opens the [Counter: Play] window`);
    s = take(s, { type: "counter", player: foe, card: cp } as Action);
    s = settle(s);
    assert.ok(s.sides[seat].zones.battle.includes(played), `${seat}: A4: the card is played`);
    assert.ok(skillsNegated(s, played), `${seat}: A4: …with its skills negated`);
    assert.ok(!offerOf(s, played), `${seat}: A4: …so its [Activate: Main] is not offered`);
    assert.ok(s.sides[foe].zones.battle.includes(cp), `${seat}: A4: the counter played itself`);
    assert.ok(!skillsNegated(s, cp), `${seat}: A4: …and is not negated`);
    cases++;
  }

  // B2. TB3-058: this card goes under the chosen card, which gets +5000.
  {
    let s = fresh(seat, seed(6));
    const me = stage(s, seat, "UNDERHOST", "battle");
    const host = stage(s, seat, "V1", "battle");
    const offer = offerOf(s, me);
    assert.ok(offer, `${seat}: B2: offered`);
    s = settle(take(s, offer.action), { cards: (q) => (q.choice.candidates.includes(host) ? [host] : undefined) });
    assert.ok(s.cards[host].under.includes(me), `${seat}: B2: this card is under the chosen card`);
    assert.equal(powerOf(s, host), 5000, `${seat}: B2: that card gets +5000`);
    cases++;
  }

  // B3. BT24-123's pair: one of each name that fits, both rested and negated; a Vegeta costing 5 is not offered.
  {
    let s = fresh(seat, seed(7));
    const pair = stage(s, seat, "PAIR", "battle");
    const goku = stage(s, seat, "GOKUX", "drop");
    const vegeta = stage(s, seat, "VEGX", "drop");
    const dear = stage(s, seat, "VEGX5", "drop");
    const offer = offerOf(s, pair);
    assert.ok(offer, `${seat}: B3: offered`);
    let offered: string[] = [];
    s = settle(take(s, offer.action), { cards: (q) => { offered.push(...q.choice.candidates); return q.choice.candidates.slice(0, 1); } });
    assert.ok(!offered.includes(dear), `${seat}: B3: the cost-5 Vegeta is not offered`);
    for (const id of [goku, vegeta]) {
      assert.ok(s.sides[seat].zones.battle.includes(id), `${seat}: B3: ${s.cards[id].cardId} played`);
      assert.equal(s.cards[id].mode, "rest", `${seat}: B3: …in Rest Mode`);
      assert.ok(skillsNegated(s, id), `${seat}: B3: …with its skills negated`);
    }
    offered = [];
    cases++;
  }

  // B5. EX25-33: both players draw 2 and discard 1.
  {
    let s = fresh(seat, seed(8));
    const c = stage(s, seat, "BOTHDRAW", "battle");
    const offer = offerOf(s, c);
    assert.ok(offer, `${seat}: B5: offered`);
    s = settle(take(s, offer.action));
    for (const p of [seat, foe]) {
      assert.equal(s.sides[p].zones.hand.length, 1, `${p === seat ? "you" : "the opponent"}: B5: drew 2, discarded 1`);
      assert.equal(s.sides[p].zones.drop.length, 1, `${p === seat ? "you" : "the opponent"}: B5: one card discarded`);
    }
    cases++;
  }
}

console.log(`phrasing-batch-3: ${records} record-level cases, and ${cases} both-seat reload cases`);
