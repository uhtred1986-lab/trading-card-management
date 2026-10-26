/**
 * Phrasing batch 2 (26 Oct 2026): more wordings of the open production rules
 * read by the compiler's phrase readers alone, the owner's rulings of the day,
 * and the engine follow-up batch 1 left (lines used from the Combo Area, the
 * Energy Area and the Z-Energy). Printed text inline (catalog text of the
 * open-rules export of 26 Oct 2026; costs, powers and companions in the VM
 * cases are synthetic).
 *
 * A1 (owner's ruling): "place them on the top and/or bottom of your deck in
 *    any order" with several cards — each card to the top or the bottom as the
 *    player chooses, in the order the player chooses (BT9-037, BT10-081, and
 *    "the remaining cards … on the top or bottom" with it).
 * A2 (owner's ruling): BT26-027's comma before "Choose" is a misprinted full
 *    stop (`src/lib/catalog/errata.ts`); the Leader condition gates only the
 *    draw and the discard.
 * C  [Activate] lines the card's own text ties to the Combo Area (BT23-016,
 *    EX19-12), the Energy Area (EX17-05) or the Z-Energy (BT19-048, BT24-018)
 *    are offered there (9-1-3-1 "unless otherwise specified", 9-1-3-2).
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
import { parseSkills } from "../../src/lib/arena/text/cards";
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
const conds = (r: Rec): Cond[] => {
  const all = [...flat(r.cost?.condition as Cond | null), ...flat(r.cond)];
  return all.filter((c, i) => all.findIndex((d) => JSON.stringify(d) === JSON.stringify(c)) === i);
};
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "chooseMode" ? o.modes.flatMap((m) => opsDeep(m.ops)) : [])]);
let records = 0;

// A1. "top and/or bottom", one end per card.
const BT10_081 = "[Activate: Main][Once per turn] Look at up to 5 cards from the top of your deck and place them on the top and/or bottom of your deck in any order.";
const BT9_037 = "[Activate: Main] If your Leader Card is a ≪Universe 7≫ card and you switch this card to Rest Mode: Look at up to 3 cards from the top of your deck, then place them on the top or bottom of your deck in any order.";
const BT10_079 = "[Auto] When you play this card, look at up to 3 cards from the top of your deck, reveal up to 1 ≪Ginyu Force≫ card among them and add it to your hand, and place the remaining cards on the top or bottom of your deck in any order.";
{
  const each = (ops: Op[], pool: string, what: string) => {
    const at = ops.findIndex((o) => o.op === "choose" && "fromVar" in o.sel && o.sel.fromVar === pool && o.sel.count === 99 && o.sel.upTo === true);
    assert.ok(at >= 0, `${what}: any number of the cards are chosen for the top`);
    const pick = ops[at] as Extract<Op, { op: "choose" }>;
    assert.deepEqual(ops.slice(at + 1, at + 3), [
      { op: "moveTo", target: { var: pick.as }, to: "deck", position: "top" },
      { op: "moveTo", target: { var: pool, minus: pick.as }, to: "deck", position: "bottom" },
    ], `${what}: those on top, every other one at the bottom`);
  };
  each(record(BT10_081, "BT10-081").ops, "looked", "BT10-081");
  each(opsDeep(record(BT9_037, "BT9-037").ops), "looked", "BT9-037");
  each(opsDeep(record(BT10_079, "BT10-079").ops), "looked", "BT10-079 (the remaining cards)");
  assert.ok(!JSON.stringify(record(BT10_079, "BT10-079").ops).includes("chooseMode"), "BT10-079: no longer one end for the whole remainder");
  records += 3;
}

// A2. BT26-027, the comma read as the full stop it is.
const BT26_027 = "[Activate: Battle][Limit 1] If your Leader is a red card with both <Son Goku: GT> and <Android 18>, draw 2 cards and discard 2 cards from your hand, Choose up to 1 of your red <Son Goku: GT> cards and it gets +15000 power for the battle. Additionally, if you have a red <Android 18> card with 20000 power or more in play, the chosen card gets +10000 power for the battle.";
const BT26_027_FIXED = correctSkillText("BT26-027", BT26_027)!;
{
  assert.match(BT26_027_FIXED, /from your hand\. Choose up to 1/, "A2: the catalog correction puts the full stop back");
  assert.equal(correctSkillText("BT26-027", BT26_027_FIXED), BT26_027_FIXED, "…and is safe to apply twice");
  const ops = record(BT26_027_FIXED, "BT26-027").ops;
  assert.equal(ops.length, 4, "A2: four top-level steps");
  const [gate, pick, power, extra] = ops;
  assert.ok(gate.op === "if" && gate.cond.kind === "leaderMatches" && gate.then.map((o) => o.op).join() === "draw,discard" && !gate.else, "A2: the Leader condition gates only the draw and the discard");
  assert.ok(pick.op === "choose" && power.op === "power" && power.amount === 15000 && "var" in power.target && power.target.var === pick.as, "…the +15000 happens whatever the Leader");
  assert.ok(extra.op === "if" && extra.cond.kind === "count" && extra.then[0].op === "power" && extra.then[0].amount === 10000, "…and the additional +10000 asks only about the <Android 18>");
  records++;
}

// C. lines used from the Combo Area, the Energy Area and the Z-Energy: read as before (batch 1), now offered.
const BT23_016 = "[activate: battle][limit 1]{1}, if your Leader is a red <Son Gohan: Future> or <Gohanks: Xeno> card and this card is in a Combo Area: Choose up to 1 of your red <Son Gohan: Future> or <Trunks: Future> cards and it gains [double strike] for the battle.";
const EX19_12 = "[Activate: Battle] Place this card in its owner's Drop Area from your Combo Area: Choose up to 1 Battle Card with a combo cost of 0 in your opponent's Combo Area and place it in its owner's Drop Area.";
const EX17_05 = "[activate: main]{u}, if your Leader Card is a blue ≪Android≫ card: You may place this card in its owner's Drop Area from your energy. If you do, play this card from your Drop Area.";
const BT24_018 = "[Activate: Main][Limit 1] If your Leader's back side is {Vegeta, Awakened Feelings} and you place this card from your Z-Energy in your Drop: Add up to 1 red ≪Saiyan≫ card from your Drop to your Z-Energy with its skills negated for the turn.";
{
  for (const [text, what] of [[BT23_016, "BT23-016"], [EX19_12, "EX19-12"], [EX17_05, "EX17-05"], [BT24_018, "BT24-018"]] as const) {
    record(text, what);
    records++;
  }
}

// B1. Prices said as "If you …": the action is the price.
const BT21_003 = "[Activate: Main][Once per turn] If you place 1 card from your hand at the bottom of your deck: Add up to 1 {Power Pole} from your Drop to your hand.";
const BT24_139 = "[Activate: Main][Burst 3] If you send 3 cards from your hand to your Warp: Switch this card to Active Mode.";
const BT22_063 = "[auto] If you place 2 cards from under this card in your Drop: When this card attacks, your opponent discards 1 card from their hand.";
const BT22_002B = "[Auto][Once per turn] If you discard 1 red ≪Red Ribbon Army≫ card from your hand: When your red <Gamma 2: SH> card attacks, draw 2 cards.";
const BT21_105 = "[Auto] If you place 2 of your Z-Energy into your Drop: When one of your opponent's Battle Cards is played by a skill, play this card from under one of your Z-Leaders, then choose up to 1 of your opponent's Battle Cards with an energy cost of 7 or less and switch it to Rest Mode.";
{
  const bottom = record(BT21_003, "BT21-003").cost?.program;
  assert.ok(bottom?.[0].op === "choose" && "side" in bottom[0].sel && bottom[0].sel.area === "hand" && bottom[1].op === "moveTo" && bottom[1].to === "deck" && bottom[1].position === "bottom", "BT21-003: the price is the card from the hand to the bottom of the deck");
  assert.deepEqual(record(BT24_139, "BT24-139").cost?.program, [{ op: "discard", n: 3, to: "warp" }], "BT24-139: three cards from the hand to the Warp");
  const under = record(BT22_063, "BT22-063").cost?.program;
  assert.ok(under?.[0].op === "choose" && "side" in under[0].sel && under[0].sel.area === "under" && under[0].sel.count === 2, "BT22-063: 2 cards from under this card");
  const red = record(BT22_002B, "BT22-002b").cost?.program;
  assert.ok(red?.[0].op === "choose" && red[0].sel.filter?.traits.join() === "red ribbon army" && red[0].sel.filter.colors.join() === "Red", "BT22-002b: a red ≪Red Ribbon Army≫ card discarded");
  const z = record(BT21_105, "BT21-105").ops[0];
  assert.ok(z.op === "choose" && "special" in z.sel && z.sel.special === "self" && z.sel.area === "under" && z.sel.underHost?.area === "leader", "BT21-105: this card from under your (Z-)Leader");
  records += 5;
}
assert.ok(unreadOf("[activate: main][limit 1]{y}{y}, if you switch 5 yellow cards to Rest Mode: Draw 1 card and play this card from your hand.").length > 0, "BT24-096: \"switch 5 yellow cards\" (energy or not?) stays unread");
assert.ok(unreadOf("[Auto] If you add 1 yellow <Vegeta> with an energy cost of 2 to your hand: At the start of your Main Phase, play this card under a yellow <Whis> Z-Battle Card.").length > 0, "BT21-103: the \"add\" price stays unread (its effect is no plain play)");

// B2. Misspellings corrected on the way in (`src/lib/catalog/errata.ts`), read once corrected.
{
  const fixed = (id: string, text: string) => correctSkillText(id, text)!;
  for (const [id, text, line] of [
    ["BT27-078", "[Activate: Main][Limit 1]{y}, fi your Leader is a yellow <Frieza> card and your opponent has 2 or more energy: Draw 1 card and play this card from your hand.", /, if your Leader/],
    ["BT30-091", "[activate: battle] [limit 1] If yourLeader is a black ≪Universe 7≫ card and you discard 1 card from your hand: Use this card in a combo.", /If your Leader is/],
    ["BT6-096", "[Activate: Main] 1, place this card in its owner's Drop Area: If your Leader Card is a ≪Boujack Brigade≫ card, choose up to 1 <Boujack> card with an energy cost of 3 in your hand and play it.", /\{1\}, place this card/],
    ["BT25-108", "[Activate: Main] Look at up to 5 cards from the top of your deck, add up to 1 card with an energy cost of 4 or 8 and <GT> in its character name to your hand, the shuffle your deck.", /then shuffle your deck/],
  ] as const) {
    const corrected = fixed(id, text);
    assert.match(corrected, line, `${id}: the catalog correction applies`);
    assert.ok(unreadOf(text).length > 0, `${id}: as exported, unread`);
    record(corrected, id);
    records++;
  }
}

// B3. Conditions said in other words.
const BT16_045 = "[Activate: Battle] If your Leader Card and all of your energy is blue: Choose 1 of your cards and it gets +10000 power for the battle.";
const BT23_124 = "[Auto] If your Leader and all of your energy are mono-yellow ≪Universe 6≫ cards: When this card is played from your hand, draw 2 cards.";
const EX22_08 = "[activate: main][limit 1]{u}{u}, if your energy is 5 or more and you have a <Zamasu> with [indestructible] in play: Choose up to 1 of your opponent's Battle Cards, place it at the bottom of their deck, then play this card from your hand.";
const P_439 = "[activate: main/battle][limit 1]{1}, if your Leader is a red <Android 13> card, you have 2 or more energy, and have a red <Android 13> card in your Z-Energy: Play this card from your hand.";
const BT16_062 = "[activate: main]{g}{g}, if your Leader Card is a <Champa> card and you have 3 or more energy and no Battle Cards in play: Play this card from your hand.";
const BT13_147 = "[permanent] If your opponent has 2 or more energy and 1 or more Battle Card in their Warp, this card gets +6000 power and can attack your opponent's Battle Cards in Active Mode.";
const BT25_148 = "[permanent] If you have 3 or more energy and 3 or more Z-Energy, reduce the energy cost of this card in your hand by 7.";
const BT20_095 = "[activate: main][limit 1] If all cards in your Battle Area are in Rest Mode: Switch this card to Active Mode.";
const BT23_084 = "[activate: main][once per turn] If you and your opponent have a total of 10 or more Battle Cards: Switch this card to Active Mode, and your opponent discards 1 card from their hand.";
const EX06_17 = "[Permanent] If your Leader Card is a green <Son Goku> card and it's flipped to its back, increase this card's energy cost by 3 in all areas and this card gains [Blocker].";
const BT1_010 = "[Auto] When you Combo with this card, if your Leader Card is red and your life is 4 or lower, draw 1 card and add +10000 to this card's Combo for the duration of the turn.";
const DB1_006 = "[Permanent] If there are any red ≪God≫ or ≪Alien≫ cards in play in your Battle Area other than this card, this card gets +6000 power and gains [Double Strike] and [Critical].";
const TB3_016 = "[Auto] At the end of your turn, choose up to 1 red ≪Frieza's Army≫ card with an energy cost of 2 from your hand and play it. If you played a card with this skill, draw 1 card.";
const EX19_11 = "[auto] When this card is played, place up to 2 cards with [dragon ball] from your deck in your Drop Area, then shuffle your deck. If you placed a card in your Drop Area using this skill, draw 1 card.";
const P_391 = "[permanent] While there are 2 or more cards under this card, it gets +15000 power.";
{
  const deep = (r: Rec): Cond[] => [...conds(r), ...opsDeep(r.ops).flatMap((o) => (o.op === "if" ? flat(o.cond) : []))];
  const [leader, energy] = conds(record(BT16_045, "BT16-045"));
  assert.ok(leader.kind === "leaderMatches" && leader.filter.colors.join() === "Blue" && energy.kind === "every" && energy.matching.filter?.colors.join() === "Blue", "BT16-045: the Leader blue, every energy blue");
  const [l6, e6] = conds(record(BT23_124, "BT23-124"));
  assert.ok(l6.kind === "leaderMatches" && l6.filter.traits.join() === "universe 6" && l6.filter.monoColor && e6.kind === "every" && e6.matching.filter?.traits.join() === "universe 6", "BT23-124: mono-yellow ≪Universe 6≫ Leader and energy");
  assert.ok(conds(record(EX22_08, "EX22-08")).some((c) => c.kind === "count" && "side" in c.sel && c.sel.area === "energy" && c.atLeast === 5), "EX22-08: 5 or more energy");
  assert.ok(conds(record(P_439, "P-439")).some((c) => c.kind === "count" && "side" in c.sel && c.sel.side === "you" && c.sel.area === "zEnergy"), "P-439: you have it in your Z-Energy");
  assert.ok(conds(record(BT16_062, "BT16-062")).some((c) => c.kind === "count" && "side" in c.sel && c.sel.area === "battle" && c.atMost === 0), "BT16-062: no Battle Cards in play");
  assert.ok(deep(record(BT13_147, "BT13-147")).some((c) => c.kind === "count" && "side" in c.sel && c.sel.side === "opponent" && c.sel.area === "warp"), "BT13-147: the opponent's Warp, the subject carried");
  assert.ok(deep(record(BT25_148, "BT25-148")).some((c) => c.kind === "count" && "side" in c.sel && c.sel.side === "you" && c.sel.area === "zEnergy" && c.atLeast === 3), "BT25-148: 3 or more Z-Energy");
  assert.ok(unreadOf("[Permanent] If your Leader is a red <Whis> card and you have 1 or more red cards and 1 or more yellow cards in your energy, reduce the energy cost of this card in your hand by 3.").length > 0, "BT24-132: the area the second count names may be the first's too — unread");
  assert.deepEqual(conds(record(BT20_095, "BT20-095")), [{ kind: "every", sel: { side: "you", area: "battle" }, matching: { side: "you", area: "battle", mode: "rest" } }], "BT20-095: every card in your Battle Area rested");
  assert.ok(conds(record(BT23_084, "BT23-084")).some((c) => c.kind === "count" && "side" in c.sel && c.sel.side === "both" && c.sel.area === "battle" && c.atLeast === 10), "BT23-084: one count over both Battle Areas");
  assert.ok(deep(record(EX06_17, "EX06-17")).some((c) => c.kind === "leaderFlipped" && c.flipped === true), "EX06-17: the Leader awakened");
  assert.ok(deep(record(BT1_010, "BT1-010")).some((c) => c.kind === "life" && c.side === "you" && c.atMost === 4), "BT1-010: 4 or less life");
  const gods = deep(record(DB1_006, "DB1-006")).find((c) => c.kind === "any");
  assert.ok(gods?.kind === "any" && gods.conds.every((c) => c.kind === "count" && "side" in c.sel && c.sel.notSelf), "DB1-006: other than this card, in both halves");
  assert.ok(deep(record(TB3_016, "TB3-016")).some((c) => c.kind === "did" && c.what === "play"), "TB3-016: the play this skill made");
  const placed = deep(record(EX19_11, "EX19-11")).find((c) => c.kind === "count" && "fromVar" in c.sel && c.sel.area === "drop");
  assert.ok(placed, "EX19-11: the cards this skill placed, still in the Drop");
  assert.ok(opsDeep(record(P_391, "P-391").ops).some((o) => o.op === "power" && o.amount === 15000 && "sel" in o.target && o.target.sel.special === "self"), "P-391: \"it\" is this card");
  records += 15;
}

// B4. Effect wordings.
const TB2_020 = "[Auto] When you play this card, if your Leader Card is ≪World Tournament≫, you may choose 1 {Test of Strength Uub} from your hand and play it. If you do so, both that card and this card gain +5000 power for the duration of the turn.";
const P_043 = "[Activate: Main] [Once per turn] Choose 1 card in your life and add it to your hand: Choose this card and all of your non-black Battle Cards. They gain +5000 power for the duration of the turn.";
const BT25_129 = "[Auto] When this card is played using [Arrival], choose up to 1 of your opponent's cards and it gets -5000 for the battle.";
const BT24_022 = "[Activate: Battle][Limit 1] If your Leader is a red <Beerus> or <Whis> card and you send this card from your Drop to your Warp: Use up to 1 Red/Yellow multicolor Battle Card from your hand in a combo with its skills negated for the turn, and reduce its combo power by -5000 for the turn.";
const BT31_079 = "[auto] {y}: When this card attacks, draw 1 card and this card gets +5000 power and gains [critical] and [double strike] for the turn.";
const P_030 = "[Auto] When this card KOs an opponent's Battle Card, deal 1 damage to their life.";
const TB2_029 = "[Auto] When your {Pan, Proudest Daughter} is played in your Battle Area, draw up to 2 cards.";
const BT20_143 = "[Auto][Once per turn] When your opponent activates a [Counter] skill, they discard 2 cards from their hand.";
const BT17_049 = "[auto][once per turn] If this card is in a battle: When your opponent activates a [counter: attack] skill, they place 1 card from their hand at the bottom of their deck.";
const BT11_014 = "[Auto] If your Leader Card is red: When this card is played, choose up to 1 of your red Unison Cards, add 2 markers to it, then choose up to 3 cards in your opponent's hand and send them to their Warp. At the end of your opponent's next turn, they add all cards sent to their Warp by this skill from their Warp to their hand.";
const DB3_028 = "[Auto] If your Leader Card is a blue ≪Saiyan≫ card: When this card is KO'd by an opponent's skill, place this card in your energy from your Drop Area.";
const P_381 = "[Auto] If your Leader Card is a <Dr. Myuu> card: When this card is played from your hand, add up to 1 red <General Rilldo> card with an energy cost of 5 or less to your hand from your deck, then shuffle your deck.";
const BT15_040 = "[activate: main]{2}, if your Leader Card is a blue <Kale> card: Place this card under your Leader Card from your hand.";
const BT3_044 = "[Auto] When you play this card, if your Leader Card is <Majin Buu>, choose 2 of your energy and place them at the bottom of your deck in any order. Then, take the top 2 cards of your deck and add them to your energy.";
const BT2_003 = "[Auto] When you place this card in the Leader Area, choose 1 {Majin Buu's Sealed Ball} from your deck and place it in the Battle Area in Active Mode.";
const BT21_034B = "[Activate: Main][Once per turn] Add up to 1 Battle Card in your opponent's Drop to their Z-Energy.";
const EB1_22 = "[Counter: Attack] If your Leader Card is mono-blue: Negate the attack, then play 1 Chilled's Army Token with 10000 power; it gains [Blocker] for the turn.";
const BT2_103 = "[Auto] When you play this card, if <King Cold> is in play in your Battle Area, choose up to 2 ≪Frieza Clan≫ other than <Frieza> from your hand and play them.  Their skills are negated for the duration of the game.";
const BT6_002B = "[Auto] When this card is attacked by a Battle Card, you may choose 1 red ≪Frieza's Army≫ card from your hand and place it in your Drop Area. If you do, negate that attack and this skill for the duration of the turn.";
const BT9_020 = "[Counter: Play] When the Battle Card is played, choose up to 2 of your opponent's Battle Cards and they get -5000 power for the duration of the turn.";
{
  const both = opsDeep(record(TB2_020, "TB2-020").ops).filter((o) => o.op === "power");
  assert.deepEqual(both.map((o) => o.op === "power" && ("var" in o.target ? "chosen" : o.target.sel.special)), ["chosen", "self"], "TB2-020: that card and this card, each +5000");
  const p043 = record(P_043, "P-043").ops;
  assert.ok(p043.length === 2 && p043.every((o) => o.op === "power" && o.amount === 5000), "P-043: this card and all of the others");
  assert.ok(record(BT25_129, "BT25-129").ops.some((o) => o.op === "power" && o.amount === -5000 && o.until === "battle"), "BT25-129: -5000 power");
  assert.ok(opsDeep(record(BT24_022, "BT24-022").ops).some((o) => o.op === "comboPower" && o.amount === -5000 && o.until === "turn"), "BT24-022: -5000 combo power, not +5000");
  assert.deepEqual(record(BT31_079, "BT31-079").ops.filter((o) => o.op === "grant").map((o) => o.op === "grant" && o.keyword.name), ["Critical", "Strike"], "BT31-079: both keywords, on this card");
  assert.deepEqual(record(P_030, "P-030").ops, [{ op: "damage", n: 1, side: "opponent" }], "P-030: 1 damage to the opponent");
  assert.ok(opsDeep(record(TB2_029, "TB2-029").ops).filter((o) => o.op === "may").length === 2, "TB2-029: two optional draws, one at a time");
  assert.ok(record(BT20_143, "BT20-143").ops.some((o) => o.op === "discard" && o.side === "opponent"), "BT20-143: the opponent discards");
  const bt17 = opsDeep(record(BT17_049, "BT17-049").ops);
  assert.ok(bt17.some((o) => o.op === "choose" && o.chooser === "opponent" && "side" in o.sel && o.sel.side === "opponent" && o.sel.area === "hand") && bt17.some((o) => o.op === "moveTo" && o.position === "bottom"), "BT17-049: they choose from their hand, to the bottom");
  const later = opsDeep(record(BT11_014, "BT11-014").ops).find((o) => o.op === "delay");
  assert.ok(later?.op === "delay" && later.ops[0].op === "moveTo" && later.ops[0].to === "hand" && "sel" in later.ops[0].target && later.ops[0].target.sel.area === "warp", "BT11-014: back from the Warp to the hand");
  assert.ok(opsDeep(record(DB3_028, "DB3-028").ops).some((o) => o.op === "moveTo" && o.to === "energy" && "sel" in o.target && o.target.sel.special === "self" && o.target.sel.area === "drop"), "DB3-028: this card from the Drop to the energy");
  assert.ok(opsDeep(record(P_381, "P-381").ops).some((o) => o.op === "choose" && "side" in o.sel && o.sel.area === "deck"), "P-381: searched from the deck");
  assert.ok(record(BT15_040, "BT15-040").ops.some((o) => o.op === "moveTo" && o.to === "under" && "sel" in o.target && o.target.sel.area === "hand"), "BT15-040: this card from the hand, under the Leader");
  assert.ok(opsDeep(record(BT3_044, "BT3-044").ops).some((o) => o.op === "moveTo" && o.to === "energy" && "sel" in o.target && o.target.sel.take === 2), "BT3-044: the top 2 cards to the energy");
  assert.ok(record(BT2_003, "BT2-003").ops.some((o) => o.op === "moveTo" && o.to === "battle" && o.mode === "active"), "BT2-003: placed in Active Mode");
  assert.ok(record(BT21_034B, "BT21-034b").ops.some((o) => o.op === "moveTo" && o.to === "zEnergy" && o.owner === "opponent"), "BT21-034b: to its owner's Z-Energy");
  const tok = opsDeep(record(EB1_22, "EB1-22").ops);
  const made = tok.find((o) => o.op === "token");
  assert.ok(made?.op === "token" && made.as && tok.some((o) => o.op === "grant" && "var" in o.target && o.target.var === made.as), "EB1-22: \"it\" is the token");
  assert.ok(opsDeep(record(BT2_103, "BT2-103").ops).some((o) => o.op === "negateSkills" && o.until === "game" && "var" in o.target), "BT2-103: the cards played, negated for the game");
  assert.ok(opsDeep(record(BT6_002B, "BT6-002b").ops).some((o) => o.op === "negateOwnSkill" && o.until === "turn"), "BT6-002b: this skill off for the turn");
  assert.ok(record(BT9_020, "BT9-020").ops[0].op === "choose", "BT9-020: the [Counter: Play]'s restated moment reads as nothing");
  records += 20;
}
assert.ok(unreadOf("[Auto] When you play this card from your hand, if your Leader Card is red, choose up to 1 of your other ≪Saiyan≫ Battle Cards in play which are ≪Universe 7≫ or ≪Universe 6≫ and switch it to Active Mode. Both that card and this card gain +10000 power and [Triple Strike] for the duration of the turn.").length > 0, "TB1-004: \"which are\" stays unread");
assert.ok(unreadOf("[activate: main][spirit boost 1] {1}, remove this card in your Drop Area from the game: Choose up to 1 of your opponent's Battle Cards with an energy cost greater than their current energy, and until the end of your opponent's next turn, its skills are negated and it can't attack.").length > 0, "EX17-04: the span over both halves stays unread");
assert.ok(unreadOf("[auto] When this card is played from your hand, play up to 2 Cell Jr. Tokens (10000 power, 0 combo cost, and 5000 combo power), and those cards get +5000 power for the turn.").length > 0, "BT21-088: an \"up to\" token play stays unread");

// ── 2. the VM ────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  // A1: BT10-081's line, with no limit, so the test drives it directly.
  TOPBOTTOM: card("TOPBOTTOM", { skill: "[Activate: Main] Look at up to 3 cards from the top of your deck and place them on the top and/or bottom of your deck in any order." }),
  // A2: BT26-027 as corrected, its Leader written as a plain colour so either outcome can be staged.
  DOUBLESTRIKE: card("DOUBLESTRIKE", { skill: "[Activate: Main][Limit 1] If your Leader Card is red, draw 2 cards and discard 2 cards from your hand. Choose up to 1 of your Battle Cards and it gets +15000 power for the turn." }),
  // C: BT23-016's shape, BT19-048's, EX19-12's, EX17-05's and BT24-018's, each without its Leader condition.
  COMBOSELF: card("COMBOSELF", { skill: "[Activate: Battle][Limit 1] If this card is in a Combo Area: Draw 1 card." }),
  COMBODROP: card("COMBODROP", { skill: "[Activate: Battle] Place this card in its owner's Drop Area from your Combo Area: Draw 1 card." }),
  COMBONONE: card("COMBONONE", { skill: "[Activate: Battle] Draw 1 card." }),
  ENERGYPLAY: card("ENERGYPLAY", { skill: "[Activate: Main] You may place this card in its owner's Drop Area from your energy. If you do, play this card from your Drop Area." }),
  ZSELF: card("ZSELF", { skill: "[Activate: Battle][Limit 1] If this card is in your Z-Energy: Draw 1 card." }),
  ZDROP: card("ZDROP", { skill: "[Activate: Main][Limit 1] If your Leader Card is blue and you place this card from your Z-Energy in your Drop: Draw 1 card." }),
  // B1: BT21-003's "If you place …" price, with an effect the test can count.
  IFPRICE: card("IFPRICE", { skill: "[Activate: Main] If you place 1 card from your hand at the bottom of your deck: Draw 2 cards." }),
  // B3: EX19-11's "If you placed a card in your Drop Area using this skill", over a choice that may be declined.
  PLACED: card("PLACED", { skill: "[Activate: Main] Choose up to 1 card in your hand and place it in your Drop Area. If you placed a card in your Drop Area using this skill, draw 2 cards." }),
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
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy" || area === "combo" || area === "zEnergy") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
const lineOf = (def: string) => parseSkills(defs[def].skill!)[0].index;
const offerOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === lineOf(s.cards[c].cardId));
type Prompt = VmState["prompt"];
/** Answer every question until `done` holds (the turn player's Main Phase by default). */
function settle(s0: VmState, steer: { mode?: (q: Extract<Prompt, { kind: "chooseMode" }>) => number; cards?: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[] | undefined } = {}, done: (s: VmState) => boolean = (s) => s.prompt.kind === "main"): VmState {
  let s = s0;
  for (let i = 0; i < 60 && !done(s); i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: steer.mode?.(q) ?? 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: steer.cards?.(q) ?? q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.ok(done(s), `settled (at ${s.prompt.kind})`);
  return s;
}
/** The seat's Leader attacks the other Leader, and the defender answers nothing, up to the seat's combo prompt (8-2). */
function toCombo(s0: VmState, seat: PlayerId): VmState {
  // A card in hand that could be used in a combo, so the combo step is asked at all (8-2).
  stage(s0, seat, "V1", "hand");
  let s = take(s0, { type: "attack", player: seat, attacker: s0.sides[seat].zones.leader[0], target: s0.sides[other(seat)].zones.leader[0] } as Action);
  for (let i = 0; i < 12; i++) {
    const p = s.prompt as { kind: string; player?: PlayerId };
    if (p.kind === "combo" && p.player === seat) return s;
    const pass = RULES.legalActions(ctx, s).find((r) => "player" in r.action && r.action.player === p.player && (r.action.type === "pass" || (r.action.type === "block" && (r.action as { card: string | null }).card === null)));
    assert.ok(pass, `the battle stopped at ${p.kind} with no pass`);
    s = take(s, pass.action);
  }
  throw new Error("never reached the combo prompt");
}
const atCombo = (seat: PlayerId) => (s: VmState) => s.prompt.kind === "combo" && (s.prompt as { player: PlayerId }).player === seat;

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 26200 + n * 2 + (seat === "p1" ? 0 : 1);

  // A1. Three cards looked at: the first to the top, the other two to the bottom.
  {
    let s = fresh(seat, seed(0));
    const looker = stage(s, seat, "TOPBOTTOM", "battle");
    const deck0 = s.sides[seat].zones.deck.slice();
    const [a, b, c] = deck0.slice(0, 3);
    const offer = offerOf(s, looker);
    assert.ok(offer, `${seat}: the top/bottom line is offered`);
    s = take(s, offer.action);
    assert.equal(s.prompt.kind, "chooseCards", `${seat}: the player picks which cards go on top`);
    const q = s.prompt as Extract<Prompt, { kind: "chooseCards" }>;
    assert.deepEqual([...q.choice.candidates].sort(), [a, b, c].sort(), `${seat}: among the three looked at`);
    assert.equal(q.choice.min, 0, `${seat}: none at all is an answer (every card to the bottom)`);
    s = settle(s, { cards: (q2) => (q2.choice.candidates.includes(a) ? [a] : []) });
    const deck = s.sides[seat].zones.deck;
    assert.equal(deck[0], a, `${seat}: the card kept on top is on top`);
    assert.deepEqual(deck.slice(-2).sort(), [b, c].sort(), `${seat}: the other two are at the bottom`);
    assert.equal(deck.length, deck0.length, `${seat}: the deck keeps its size`);
    cases++;
  }

  // A2. The Leader condition gates the draw and the discard only; the +15000 always happens.
  for (const leader of ["L-RED", "L-BLUE"] as const) {
    let s = fresh(seat, seed(1 + (leader === "L-RED" ? 0 : 1)), leader);
    const host = stage(s, seat, "DOUBLESTRIKE", "battle");
    const target = stage(s, seat, "V1", "battle");
    for (let k = 0; k < 2; k++) stage(s, seat, "V1", "hand");
    const hand0 = s.sides[seat].zones.hand.length;
    const offer = offerOf(s, host);
    assert.ok(offer, `${seat}: the line is offered`);
    s = settle(take(s, offer.action), { cards: (q) => (q.choice.candidates.includes(target) ? [target] : undefined) });
    assert.equal(s.sides[seat].zones.hand.length, hand0, `${seat}: ${leader}: the hand size is unchanged (drew 2, discarded 2 — or neither)`);
    assert.equal(s.sides[seat].zones.drop.length, leader === "L-RED" ? 2 : 0, `${seat}: ${leader}: ${leader === "L-RED" ? "two cards discarded" : "nothing discarded under a blue Leader"}`);
    const power = s.effects.filter((e) => e.kind === "power" && e.target === target).reduce((n, e) => n + Number(e.value), 0);
    assert.equal(power, 15000, `${seat}: ${leader}: the chosen card gets +15000 either way`);
    cases++;
  }

  // C1. The Combo Area: a line whose condition asks for it, one whose price takes the card from there, and one
  // that says nothing about it (not offered), at the combo prompt of the seat's own attack.
  {
    let s = fresh(seat, seed(3));
    for (let k = 0; k < 2; k++) stage(s, seat, "V1", "energy");
    s = toCombo(s, seat);
    const self = stage(s, seat, "COMBOSELF", "combo");
    const drop = stage(s, seat, "COMBODROP", "combo");
    const none = stage(s, seat, "COMBONONE", "combo");
    assert.ok(!offerOf(s, none), `${seat}: a line that names no area is not used from the Combo Area (9-1-3-1)`);
    const hand0 = s.sides[seat].zones.hand.length;
    const a = offerOf(s, self);
    assert.ok(a, `${seat}: "if this card is in a Combo Area" is offered at the combo prompt`);
    s = settle(take(s, a.action), {}, atCombo(seat));
    assert.equal(s.sides[seat].zones.hand.length, hand0 + 1, `${seat}: …and draws`);
    const b = offerOf(s, drop);
    assert.ok(b, `${seat}: "place this card … from your Combo Area" is offered at the combo prompt`);
    s = settle(take(s, b.action), {}, atCombo(seat));
    assert.ok(s.sides[seat].zones.drop.includes(drop), `${seat}: the price put it in the Drop`);
    assert.equal(s.sides[seat].zones.hand.length, hand0 + 2, `${seat}: …and it drew`);
    cases++;
  }
  // C1b. The same lines are not offered from the Battle Area, and not in the Main Phase.
  {
    const s = fresh(seat, seed(4));
    const self = stage(s, seat, "COMBOSELF", "battle");
    assert.ok(!offerOf(s, self), `${seat}: no Combo Area, no line`);
    cases++;
  }

  // C2. The Energy Area: EX17-05's shape, used from the energy in the Main Phase; the card is played.
  {
    let s = fresh(seat, seed(5));
    const e = stage(s, seat, "ENERGYPLAY", "energy");
    const offer = offerOf(s, e);
    assert.ok(offer, `${seat}: the energy line is offered`);
    s = settle(take(s, offer.action), { mode: () => 0 });
    assert.ok(s.sides[seat].zones.battle.includes(e), `${seat}: placed in the Drop from the energy, then played`);
    const again = fresh(seat, seed(6));
    assert.ok(!offerOf(again, stage(again, seat, "ENERGYPLAY", "battle")), `${seat}: from the Battle Area it is not offered (its card is not in the energy)`);
    cases++;
  }

  // C3. The Z-Energy: a condition asking for it (at the combo prompt) and a price taking the card from there (Main).
  {
    let s = fresh(seat, seed(7));
    const z = stage(s, seat, "ZDROP", "zEnergy");
    const hand0 = s.sides[seat].zones.hand.length;
    const offer = offerOf(s, z);
    assert.ok(offer, `${seat}: the Z-Energy price line is offered in the Main Phase`);
    s = settle(take(s, offer.action));
    assert.ok(s.sides[seat].zones.drop.includes(z), `${seat}: the card went from the Z-Energy to the Drop`);
    assert.equal(s.sides[seat].zones.hand.length, hand0 + 1, `${seat}: …and drew`);
    let b = fresh(seat, seed(8));
    const zs = stage(b, seat, "ZSELF", "zEnergy");
    assert.ok(!offerOf(b, zs), `${seat}: an [Activate: Battle] line is not offered in the Main Phase`);
    b = toCombo(b, seat);
    const at = offerOf(b, zs);
    assert.ok(at, `${seat}: "if this card is in your Z-Energy" is offered at the combo prompt`);
    const before = b.sides[seat].zones.hand.length;
    b = settle(take(b, at.action), {}, atCombo(seat));
    assert.equal(b.sides[seat].zones.hand.length, before + 1, `${seat}: …and draws`);
    void foe;
    cases++;
  }

  // B1. "If you place 1 card from your hand at the bottom of your deck:" is charged: not offered with an empty hand,
  // and paid by the card going to the bottom before the draw.
  {
    let s = fresh(seat, seed(9));
    const host = stage(s, seat, "IFPRICE", "battle");
    assert.ok(!offerOf(s, host), `${seat}: no card in hand, no price to pay — not offered`);
    const paid = stage(s, seat, "V1", "hand");
    const offer = offerOf(s, host);
    assert.ok(offer, `${seat}: with a card in hand it is offered`);
    s = settle(take(s, offer.action));
    const deck = s.sides[seat].zones.deck;
    assert.ok(deck.includes(paid) && !s.sides[seat].zones.hand.includes(paid), `${seat}: the price put the card back in the deck`);
    assert.equal(s.sides[seat].zones.hand.length, 2, `${seat}: …and the effect drew 2`);
    cases++;
  }

  // B3. "If you placed a card in your Drop Area using this skill": a card placed draws 2; declining draws nothing.
  for (const place of [true, false]) {
    let s = fresh(seat, seed(10 + (place ? 0 : 1)));
    const host = stage(s, seat, "PLACED", "battle");
    const card1 = stage(s, seat, "V1", "hand");
    const offer = offerOf(s, host);
    assert.ok(offer, `${seat}: the line is offered`);
    s = settle(take(s, offer.action), { cards: (q) => (place && q.choice.candidates.includes(card1) ? [card1] : []) });
    assert.equal(s.sides[seat].zones.drop.includes(card1), place, `${seat}: ${place ? "placed" : "kept"}`);
    assert.equal(s.sides[seat].zones.hand.length, place ? 2 : 1, `${seat}: ${place ? "a card placed draws 2" : "nothing placed draws nothing"}`);
    cases++;
  }
}

console.log(`phrasing-batch-2: ${records} record-level cases, and ${cases} both-seat reload cases`);
