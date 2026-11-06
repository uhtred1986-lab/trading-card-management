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
 * M.  The lane's review: "attacks your opponent's Leader" (P-027), "copies of both <A> and <B>" (P-113), "that hasn't
 *     attacked this turn" (SD20-05), "less than 2" (DB1-041), markers on this card (BT18-125), your Charge Phase
 *     (BT19-060); in the VM, a shield from under a card (BT20-092, R-161) and a card that hasn't attacked.
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
import { attrsNow, resolveSelector } from "../../src/lib/arena/vm/program";
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

// F. The Leader's description: a shared qualifier reaches every name; a measure inside a name or trait; a keyword.
const leaderFilters = (rec: Rec) => conds(rec).flatMap((c) => (c.kind === "leaderMatches" ? [c.filter] : c.kind === "any" ? c.conds.flatMap((x) => (x.kind === "leaderMatches" ? [x.filter] : [])) : []));
{
  const buu = leaderFilters(record("[Auto][Limit 1] If your Leader is a <Majin Buu> or <Evil Wizard Babidi> card—both yellow: When this card is played, draw 1 card.", "BT20-105"));
  assert.ok(buu.length === 2 && buu.every((f) => f.colors.includes("Yellow")), "F: BT20-105 — \"—both yellow:\" is each name's");
  const only = leaderFilters(record("[Auto] If your Leader Card is a black ≪Saiyan≫-only or ≪God≫-only card: When this card is played, draw 1 card.", "BT13-123"));
  assert.ok(only.length === 2 && only.every((f) => f.colors.includes("Black") && f.onlyTraits && f.traits.length === 1), "F: BT13-123 — R-162: each \"-only\" name, black");
  const heroine = leaderFilters(record("[Auto] If your Leader Card is a red ≪Earthling≫ card or a ≪Heroine≫ card: When this card is played, draw 1 card.", "EB1-03"));
  assert.ok(heroine.length === 2 && !heroine[1].colors.length, "F: EB1-03 — a name with its own article keeps its own description");
  const list = leaderFilters(record("[Permanent] If your Leader is a red ≪Earthling≫, ≪Namekian≫, or ≪Shenron≫ card, this card gets +5000 power.", "BT28-018"));
  assert.ok(list.length === 1 && list[0].colors.includes("Red") && list[0].traits.length === 3, "F: BT28-018 — red is every trait's");
  const gotenks = leaderFilters(record("[Auto] If your Leader is green and has <Gotenks> in its character name: When this card is played, draw 1 card.", "BT18-085"));
  assert.ok(gotenks.some((f) => f.charactersIncluding.includes("gotenks") && !f.characters.length), "F: BT18-085 — a part of the character name");
  const universe = leaderFilters(record("[-7][Activate: Main] If your Leader Card has ≪Universe≫ in its special trait: Draw 1 card, then place the top card of your deck in your life.", "BT16-004"));
  assert.ok(universe.length === 1 && universe[0].traitsIncluding?.includes("universe") && !universe[0].traits.length, "F: BT16-004 — a part of a trait");
  const p189 = record("[Permanent] If you have a Battle Card in play with ≪Universe≫ in its special trait, reduce the energy cost of this card in your hand by 2.", "P-189");
  assert.ok(conds(p189).some((c) => c.kind === "count" && !!c.sel.filter?.traitsIncluding?.includes("universe")), "F: P-189 — the same in a count");
  const warrior = leaderFilters(record("[activate: main][limit 1]{1}, if your Leader has [warrior of universe 7]: Draw 1 card.", "SD21-05"));
  assert.ok(warrior.length === 1 && (warrior[0].keywordsExact ?? []).includes("Warrior of Universe 7"), "F: SD21-05 — the Leader's keyword");
  const front = record("[Permanent] If your Leader Card is on its front side, reduce the energy cost of this card in your hand by 1.", "BT9-094");
  assert.ok(conds(front).some((c) => c.kind === "leaderFlipped" && c.flipped === false), "F: BT9-094 — the side alone");
  const back = record("[auto][limit 1]{1}, if your Leader is a ≪Bardock's Crew≫ card with its back facing up: At the end of a battle where this card was used in a combo from your hand, play this card from your Drop.", "BT18-098");
  assert.ok(conds(back).some((c) => c.kind === "leaderFlipped" && c.flipped === true), "F: BT18-098 — awakened");
  records += 10;
}

// G. Counts: a shared dash qualifier, a Z-Leader, a second measure, both orders of a place pair, a count's end.
{
  const counted = (rec: Rec) => conds(rec).flatMap((c) => (c.kind === "count" ? [c] : c.kind === "any" ? c.conds.filter((x): x is Extract<Cond, { kind: "count" }> => x.kind === "count") : []));
  const evo = counted(record("[activate: main][limit 1]{r}, if you have a <Vegeta> or <Trunks: Future> card—both red and with an energy cost of 3 and [ex-evolve]—in play: Play this card from your hand.", "BT19-009"));
  assert.ok(evo.length === 2 && evo.every((c) => c.sel.filter?.colors.includes("Red") && c.sel.filter.costMin === 3 && (c.sel.filter.keywordsExact ?? []).includes("EX-Evolve")), "F: BT19-009 — both names, red, cost 3, [EX-Evolve] exactly");
  const z = record("[Permanent] If you have a Z-Leader or Z-Battle Card in play, this card gets +5000 power.", "P-446");
  assert.ok(leaderFilters(z).some((f) => f.z === true), "G: P-446 — the Z-Leader is the Leader");
  const measure = counted(record("[activate: main][limit 1]{u}, if your Leader is blue, your opponent has 3 or more energy, and you have a blue Battle Card with an energy cost of 8 or more or an original power of 30000 or more in play: Play this card from your hand.", "P-454"));
  assert.ok(measure.some((c) => c.sel.filter?.originalPowerMin === 30000 && c.sel.filter.colors.includes("Blue") && c.sel.filter.type === "BATTLE"), "G: P-454 — the second measure is the same blue Battle Card's");
  const slug = counted(record("[Permanent] If you have a <Lord Slug> card in your Battle Area or Leader Area, this card gets +5000 power.", "BT6-068"));
  assert.ok(slug.length === 1 && !slug[0].sel.filter?.anyOf, "G: BT6-068 — one description over both areas");
  const send = record("[activate: main][limit 1]{b}, if you have 2 or more energy, you send 1 black card and 1 white card from your Drop to their owner's Warp, then discard 1 card from your hand: Play this card from your Warp.", "BT29-095");
  assert.ok(counted(send).some((c) => c.sel.area === "energy" && c.atLeast === 2), "G: BT29-095 — 2 or more energy, the sends a price");
  assert.ok(only("[Auto] When this card attacks, draw 1 card. Additionally, if this card attacks your opponent's Leader and there are no cards in your opponent's Combo Area at the beginning of that battle's Damage Step, draw 1 card.", "BT21-034").unread.length > 0, "G: BT21-034 — a count asked later stays unread");
  const total = record("[auto]{b}, if your Leader Card is a black ≪Saiyan≫ card and there's a total of 3 or more energy between you and your opponent: At the end of a battle in which this card was used in a combo from your hand, play this card from your Drop Area in Rest Mode.", "EX19-28");
  assert.match(total.reads, /3 or more cards in both players' Energy Area in total/, "G: EX19-28 — said as one total");
  const dark = ops(record("[Auto] At the end of your turn, choose up to 2 of your Battle Cards with a [Dark Over Realm] skill and switch them to Active Mode.", "BT27-104")).find((o) => o.op === "choose");
  assert.ok(dark && dark.op === "choose" && (dark.sel.filter?.keywordsExact ?? []).includes("Dark Over Realm"), "G: BT27-104 — [Dark Over Realm] exactly");
  records += 8;
}

// H. Two counts against each other; the pile under either Leader; the battle's ends.
{
  const vs = conds(record("[Activate: Main] Draw 1 card, and if your opponent has more cards in their hand than you, they choose 1 card in their hand and discard it.", "BT16-067")).find((c) => c.kind === "outnumbers");
  assert.ok(vs && vs.kind === "outnumbers" && vs.sel.side === "opponent" && vs.sel.area === "hand" && vs.than.side === "you" && !vs.by, "H: BT16-067 — their hand outnumbers yours");
  const less = conds(record("[Auto] When this card attacks your opponent's Leader, if you have less cards in hand than your opponent, your opponent chooses 1 card in their hand and places it in the Drop Area.", "P-027")).find((c) => c.kind === "outnumbers");
  assert.ok(less && less.kind === "outnumbers" && less.sel.side === "opponent" && less.than.side === "you", "H: P-027 — fewer is the sides swapped");
  const by2 = conds(record("[Activate: Battle] Choose up to 1 of your Battle Cards or Leader Cards and it gets +15000 power for the duration of the battle; if your opponent has 2 or more energy than you, choose up to 1 of your opponent's energy and place it in its owner's Drop Area.", "P-183")).find((c) => c.kind === "outnumbers");
  assert.ok(by2 && by2.kind === "outnumbers" && by2.by === 2 && by2.sel.area === "energy", "H: P-183 — by 2");
  const either = conds(record("[Permanent] During your opponent's turn, if there is a {Son Gohan, Awakened Hidden Power} under your Leader or your opponent's Leader, reduce the energy cost of this card in your hand by 3.", "BT21-014")).find((c) => c.kind === "any");
  assert.ok(either && either.kind === "any" && either.conds.length === 2 && either.conds.some((c) => c.kind === "count" && c.sel.underHost && "side" in c.sel.underHost && c.sel.underHost.side === "opponent"), "H: BT21-014 — under either Leader");
  const notUnder = conds(record("[Auto] If your Leader's back side is {Son Goku, for the Sake of Family} and your opponent's Leader doesn't have a {Son Gohan, Awakened Hidden Power} under it: When your opponent plays a card or attacks, place up to 1 {Son Gohan, Awakened Hidden Power} from your deck under your opponent's Leader, then shuffle your deck.", "BT21-021"));
  assert.ok(notUnder.some((c) => c.kind === "count" && c.atMost === 0 && c.sel.side === "opponent" && c.sel.area === "under"), "H: BT21-021 — none under the opponent's Leader");
  assert.ok(notUnder.some((c) => c.kind === "leaderMatches" && c.back && c.filter.names.length === 1), "H: BT21-021 — …and the back side is one name");
  const target = conds(record("[Auto] When this card attacks, draw 1 card. If this card attacks a Battle Card, it gains +5000 power for the duration of the turn.", "BT1-002"));
  assert.ok(target.some((c) => c.kind === "inBattle" && c.role === "guard" && c.sel.side === "opponent" && c.sel.area === "battle"), "H: BT1-002 — the attack is on a Battle Card");
  const leaderBattle = conds(record("[Activate: Battle] If it's your turn and your <Son Goku> Leader is in a battle: Draw 1 card.", "BT20-112"));
  assert.ok(leaderBattle.some((c) => c.kind === "inBattle" && c.sel.area === "leader"), "H: BT20-112 — the Leader");
  records += 8;
}

// I. The battle's ends in a choice (`battleRole`), and a mode said before a name.
{
  const chosen = (rec: Rec) => ops(rec).filter((o): o is Extract<Op, { op: "choose" }> => o.op === "choose").map((o) => o.sel);
  assert.equal(chosen(record("[Auto] When you Combo with this card, choose 1 of your attacking cards. It gains [Double Strike] (This card inflicts 2 damage instead of 1 when attacking) for the duration of the battle.", "BT1-005"))[0].battleRole, "attacker", "I: BT1-005 — your attacking card");
  const counter = chosen(record("[Counter: Attack] If your Leader Card is mono-red: Choose up to 1 attacking Battle Card or Leader Card, ignoring [Barrier], and it gets -15000 power for the battle.", "BT10-030"))[0];
  assert.ok(counter.battleRole === "attacker" && counter.side === "both", "I: BT10-030 — no owner said: the attacking card is either side's");
  assert.equal(chosen(record("[Activate: Battle][Once per turn][Bond 2] ≪Alien≫ (This skill takes effect when you have 2 or more of the specified Battle Cards in play.): Choose up to 1 of your red ≪Alien≫ cards in battle, and it gets +10000 power for the duration of the turn.", "DB1-017"))[0].battleRole, "any", "I: DB1-017 — in battle");
  const notAtk = chosen(record("[Auto] If your Leader is a yellow <Lord Slug> card: When this card is used in a combo, choose up to 1 of your opponent's Battle Cards in Rest Mode that isn't attacking and KO it.", "BT19-114"))[0];
  assert.ok(notAtk.battleRole === "notAttacker" && notAtk.mode === "rest", "I: BT19-114 — rested and not the attacker");
  assert.equal(chosen(record("[Counter: Attack] Choose up to 1 of your Rest Mode <Vegito> cards and switch it to Active Mode, that card gets +6000 power for the battle.", "BT23-096"))[0].mode, "rest", "I: BT23-096 — Rest Mode before the name");
  // "The attacking card" and "a card name with the word battle in it" are not this.
  assert.ok(chosen(record("[Activate: Main] Place up to 1 {SS Vegeta, Snowy Mountain Battle} from your deck into its owner's Drop, then shuffle your deck.", "BT26-039")).every((x) => !x.battleRole), "I: BT26-039 — a name is not a battle");
  assert.ok(chosen(record("[Auto] When you play this card, choose up to 1 <Vegeta> card with an energy cost of 6 or less in a Battle Area and place it in its owner's Drop Area.", "BT7-065")).every((x) => !x.battleRole), "I: BT7-065 — a Battle Area is not a battle");
  records += 7;
}

// J. Exclusions said as a relative clause; a play exception of one kind of card.
{
  const pick = (rec: Rec) => ops(rec).filter((o): o is Extract<Op, { op: "choose" }> => o.op === "choose").map((o) => o.sel.filter!);
  const tora = pick(record("[Auto] When this card is played from your hand, add up to 1 red ≪Bardock's Crew≫ card with an energy cost of 5 or less that isn't a <Tora> card from your Drop Area to your hand.", "BT13-006"))[0];
  assert.ok(tora.notCharacters.includes("tora") && !tora.characters.length, "J: BT13-006 — not a <Tora>");
  const slug = pick(record("[auto] When this card is played, play up to 2 ≪Slug's Army≫ cards with energy costs of 3 or less that don't have <Lord Slug> in their character names from your deck, then shuffle your deck.", "BT19-112"))[0];
  assert.ok(slug.notCharactersIncluding.includes("lord slug") && !slug.charactersIncluding.length, "J: BT19-112 — without <Lord Slug> in the name");
  const ape = pick(record("[auto] When this card is played, play up to 1 yellow <Son Goku: Childhood> card with an energy cost of 4 or less that doesn't have ≪Great Ape≫ from your Drop.", "BT18-096"))[0];
  assert.ok(ape.notTraits.includes("great ape") && !ape.traits.length, "J: BT18-096 — not ≪Great Ape≫");
  const combo = ops(record("[Auto] When this card is played, shuffle up to 7 mono-green Battle Cards with energy costs of 7 or less that don't have [Super Combo] skills from your Drop Area into your deck.", "P-237")).find((o) => o.op === "choose");
  assert.ok(combo && combo.op === "choose" && combo.sel.filter?.notKeywords.includes("Super Combo"), "J: P-237 — not [Super Combo]");
  const u7 = forbids(record("[Auto] When you play this card, it gets +10000 power and you can't play non- ≪Universe 7≫ Battle Cards for the duration of the turn.", "SD11-03"));
  assert.ok(u7.length === 1 && u7[0].filter?.notTraits.includes("universe 7"), "J: SD11-03 — \"non- ≪Universe 7≫\" with its space");
  const saiyan = forbids(record("[auto] At the start of your opponent's turn, draw 1 card. You can't play Battle Cards that aren't red ≪Saiyan≫ cards for the turn.", "BT13-028"));
  assert.ok(saiyan.length === 1 && saiyan[0].filter?.type === "BATTLE" && saiyan[0].exceptFilter?.traits.includes("saiyan") && saiyan[0].exceptFilter.colors.includes("Red"), "J: BT13-028 — every Battle Card but the red ≪Saiyan≫ ones");
  records += 6;
}

// K. What hangs on what: "if you do, choose one", "and if", a "Then" sentence, a trailing condition before a menu.
{
  const tree = (rec: Rec): string => JSON.stringify(rec.ops, (k, v) => (k === "sel" || k === "target" || k === "label" || k === "reason" || k === "filter" ? undefined : v));
  const ifDo = record("[Auto] When you combo with this card, you may choose 1 card from your hand and place it in your Drop Area. If you do, choose one— ・Draw 1 card. ・Choose 1 Battle Card in your opponent's Drop Area, return it to your opponent's deck, then your opponent shuffles their deck.", "BT7-017");
  assert.match(tree(ifDo), /"op":"if","cond":\{"kind":"moved","var":"c0","all":true\},"then":\[\{"op":"chooseMode"/, "K: BT7-017 — the menu hangs on the completed original discard");
  const nested = record("[Counter: Play] If the Battle Card being played has 15000 power or less, it is placed in its owner's Drop Area instead of being played, and if it's your opponent's turn, choose up to 1 of your Leader Cards and it gets +5000 power for the duration of the turn.", "BT8-022");
  // The lone outer condition is the record's own (`cond`); the turn's is inside it, beside the replacement.
  assert.ok(nested.cond?.kind === "count" && nested.ops.some((o) => o.op === "resolvingPlay") && nested.ops.some((o) => o.op === "if" && o.cond.kind === "isTurnPlayer"), "K: BT8-022 — R-163: the +5000 is asked inside the 15000-power check (Q&A BT8-022)");
  const parallel = record("[auto] When this card is played, if you have 2 or more red cards in your energy, choose up to 1 of your red Unisons and add 1 marker to it, and if you have 2 or more yellow cards in your energy, choose up to 1 of your opponent's Battle Cards or Unisons and switch it to Rest Mode.", "BT24-127");
  assert.equal(parallel.ops.filter((o) => o.op === "if").length, 2, "K: BT24-127 — R-163: two parallel colour counts");
  const then = record("[Auto] When this card attacks, reveal the top card of your deck; if it's a green ≪Ginyu Force≫ card with an energy cost of 2, you may play it. Then draw 1 card.", "BT10-061");
  assert.equal(then.ops[then.ops.length - 1].op, "draw", "K: BT10-061 — \"Then draw 1 card.\" is outside the reveal's condition");
  const turn = record("[Activate: Battle] If your Leader Card is a green <Vegito> card, it gets +15000 power for the duration of the battle, and if it is your turn, also choose one— ・Choose up to 1 of your opponent's Battle Cards with an energy cost of 4 or less and KO it. ・Choose up to 1 of your opponent's Battle Cards with an energy cost of 2 or less, ignoring [Barrier], and KO it.", "EX06-21");
  assert.match(tree(turn), /"op":"if","cond":\{"kind":"isTurnPlayer"\},"then":\[\{"op":"chooseMode"/, "K: EX06-21 — the menu only on your turn");
  records += 5;
}

// L. A copy of this card; a bare "Tokens"; the oldest sets' measures; one card in a second place.
{
  const copy = conds(record("[activate: main] If a copy of this card isn't in play in your Battle Area, choose 1 Clone Token in your opponent's Battle Area and remove it from the game: Play this card from your hand.", "P-202"));
  assert.ok(copy.some((c) => c.kind === "count" && c.atMost === 0 && c.sel.copyOfSelf === true && c.sel.area === "battle" && !c.sel.special), "L: P-202 — another card of this name, not this card");
  const tokens = conds(record("[activate: main]{b}, if your Leader Card is black and there are 1 or more Tokens in your Battle Area: Play this card from your hand.", "BT17-123"));
  assert.ok(tokens.some((c) => c.kind === "count" && c.sel.filter?.token === true), "L: BT17-123 — Tokens");
  const whis = ops(record("[Auto] When you play this card, choose up to 1 <Whis> with an energy cost of 4 or lower from your deck and add it to your hand.  Then, shuffle your deck.", "BT1-040")).find((o) => o.op === "choose");
  assert.ok(whis && whis.op === "choose" && whis.sel.filter?.costMax === 4 && whis.sel.filter.costMin === null, "L: BT1-040 — 4 or lower");
  const alien = ops(record("[Auto] When this card attacks, look at up to 3 cards from the top of your deck. Choose up to 1 ≪Alien≫ with power 15000 or less among them and play it. Then, shuffle your deck.", "BT1-008")).find((o) => o.op === "choose");
  assert.ok(alien && alien.op === "choose" && alien.sel.filter?.powerMax === 15000, "L: BT1-008 — with power 15000 or less");
  const zEnergy = conds(record("[auto] If you have a yellow <Vegeta> card in play or in your Z-Energy: At the start of your opponent's Main Phase, switch this card to Active Mode.", "SD22-05"));
  assert.ok(zEnergy.some((c) => c.kind === "any" && c.conds.every((x) => x.kind === "count" && x.sel.filter?.characters.includes("vegeta"))), "L: SD22-05 — a yellow <Vegeta> in either place");
  records += 5;
}

// M. Review of lane C: the attack's other end said without "Card"; "copies of both <A> and <B>"; "that hasn't attacked
// this turn".
{
  const leader = record("[Auto] When this card attacks your opponent's Leader, if you have less cards in hand than your opponent, your opponent chooses 1 card in their hand and places it in the Drop Area.", "P-027");
  assert.deepEqual(leader.cond, { kind: "inBattle", sel: { area: "leader", side: "opponent" }, role: "guard" }, "M: P-027 — only an attack on the opponent's Leader");
  assert.ok(conds(leader).some((c) => c.kind === "outnumbers"), "M: P-027 — the hands compared");
  // "a Leader or Unison" names a second guard: not this reading — audit conditions 2 reads it as either guard (BT18-059).
  const b18 = only("[Auto] When this card attacks a Leader or Unison, draw 1 card.", "BT18-059").cond;
  assert.ok(b18 && b18.kind === "any" && b18.conds.length === 2, "M: BT18-059 — not read as the Leader alone");
  const both = conds(record("[Permanent] If you have 1 or more copies of both <Tapion> and <Minotia> cards in your Drop Area and a ≪Phantom Demon≫ card isn't in play in your Battle Area, you can play this card from your hand without paying its energy cost. This card gets -10000 power during your turn.", "P-113"));
  const inDrop = (name: string) => both.some((c) => c.kind === "count" && c.sel.area === "drop" && c.atLeast === 1 && c.sel.filter?.characters.join() === name && !c.sel.filter.charactersAll?.length);
  assert.ok(inDrop("tapion") && inDrop("minotia"), "M: P-113 — a <Tapion> card and a <Minotia> card, not one card with both");
  const fresh = ops(record("[Auto][Limit 1] If your Leader is a yellow Z-Leader or yellow <Son Goku: Childhood> card: When this card is switched to Rest Mode by one of your Leader skills, switch this card to Active Mode, then choose 1 of your yellow <Son Goku: Childhood> cards in Rest Mode that hasn't attacked this turn and switch it to Active Mode. If you do, draw 1 card.", "SD20-05")).find((o) => o.op === "choose");
  assert.ok(fresh && fresh.op === "choose" && fresh.sel.notAttackedThisTurn === true && fresh.sel.mode === "rest", "M: SD20-05 — only a card that hasn't attacked this turn");
  // "Less than 2" is 1 or less (DB1-041); markers as the subject (BT18-125); your own Charge Phase (BT19-060).
  const fewer = conds(record("[Permanent] If there are less than 2 Battle Cards in your Battle Area with an original power of 10000, this card can't attack.", "DB1-041"));
  assert.ok(fewer.some((c) => c.kind === "count" && c.atMost === 1 && c.atLeast === undefined && c.sel.filter?.originalPowerMin === 10000), "M: DB1-041 — fewer than 2: 1 or less");
  const markers = record("[Auto] If there are 4 or more markers on this card: When this card is played, your opponent sends 1 card from their hand to their Warp.", "BT18-125");
  assert.deepEqual(markers.cond, { kind: "markers", sel: { special: "self" }, atLeast: 4 }, "M: BT18-125 — the markers on this card");
  const charge = forbids(record("[permanent] This card can't be switched to Active Mode during your Charge Phase.", "BT19-060"));
  assert.deepEqual(charge.map((f) => f.what), ["switchToActiveInCharge"], "M: BT19-060 — only the Charge Phase's switch");
  records += 7;
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
  // B (review): the shield a card under another gives the card above it (BT20-092)
  MAJINHOST: card("MAJINHOST", { colors: ["Yellow"], traits: ["Majin"], energyCost: 2 }),
  UNDERSHIELD: card("UNDERSHIELD", { colors: ["Yellow"], skill: "[permanent] While this card is under a yellow ≪Majin≫ card with an energy cost of 2 or more in a Battle Area, the card above this card can't be KO'd once per turn." }),
  // H: two counts against each other; the pile under either Leader
  HANDVS: card("HANDVS", { skill: "[Activate: Main] If your opponent has more cards in their hand than you, draw 1 card." }),
  GOHAN: card("GOHAN", { name: "Son Gohan, Awakened Hidden Power", characters: ["Son Gohan"] }),
  UNDEREITHER: card("UNDEREITHER", { skill: "[Activate: Main] If there is a {Son Gohan, Awakened Hidden Power} under your Leader or your opponent's Leader, draw 1 card." }),
  // K: the menu hangs on the discard
  COPYGATE: card("COPYGATE", { name: "Copy Gate", skill: "[Activate: Main] If a copy of this card isn't in play in your Battle Area, draw 1 card." }),
  IFDO: card("IFDO", { skill: "[Activate: Main] You may choose 1 card from your hand and place it in your Drop Area. If you do, choose one— ・Draw 2 cards. ・Draw 3 cards." }),
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
  // B (review). From under a card: the card above it is shielded once a turn (BT20-092, R-161).
  {
    let s = fresh(seat, seed(14));
    const host = stage(s, foe, "MAJINHOST", "battle");
    const under = s.sides[foe].zones.deck.at(-1)!;
    s.cards[under].cardId = "UNDERSHIELD";
    assert.ok(moveCard(s, game, under, "under", { owner: foe, under: host }).ok);
    const koer = stage(s, seat, "KOER", "battle");
    s = activate(s, koer, host, 0);
    assert.ok(s.sides[foe].zones.battle.includes(host), `${seat}: B: the card above is not KO'd the first time`);
    s = activate(s, koer, host, 0);
    assert.ok(!s.sides[foe].zones.battle.includes(host), `${seat}: B: …the second time it is`);
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

  // H. Two hands against each other, from both chairs.
  {
    let s = fresh(seat, seed(7));
    const me = stage(s, seat, "HANDVS", "battle");
    stage(s, foe, "V1", "hand");
    const before = s.sides[seat].zones.hand.length;
    s = activate(s, me, "");
    assert.equal(s.sides[seat].zones.hand.length, before + 1, `${seat}: H: their 1 card against your 0 — drawn`);
    s = fresh(seat, seed(8));
    const me2 = stage(s, seat, "HANDVS", "battle");
    stage(s, foe, "V1", "hand");
    stage(s, seat, "V1", "hand");
    const had = s.sides[seat].zones.hand.length;
    s = activate(s, me2, "");
    assert.equal(s.sides[seat].zones.hand.length, had, `${seat}: H: 1 against 1 is not more — nothing`);
    cases += 2;
  }
  // H. The Son Gohan under the opponent's Leader answers "your Leader or your opponent's Leader".
  {
    let s = fresh(seat, seed(9));
    const me = stage(s, seat, "UNDEREITHER", "battle");
    const gohan = s.sides[seat].zones.deck.at(-1)!;
    s.cards[gohan].cardId = "GOHAN";
    assert.ok(moveCard(s, game, gohan, "under", { owner: seat, under: s.sides[foe].zones.leader[0] }).ok);
    const before = s.sides[seat].zones.hand.length;
    s = activate(s, me, "");
    assert.equal(s.sides[seat].zones.hand.length, before + 1, `${seat}: H: under the opponent's Leader — drawn`);
    cases++;
  }

  // I. In a declared attack: the attacking card, either end, every card but the attacker (8-1-2).
  {
    let s = fresh(seat, seed(10));
    const atk = stage(s, seat, "V1", "battle");
    const other = stage(s, seat, "V1", "battle");
    const guard = s.sides[foe].zones.leader[0];
    s = take(s, { type: "attack", player: seat, attacker: atk, target: guard } as Action);
    assert.ok(s.battle, `${seat}: I: in a battle`);
    const frame = { master: seat, card: other, vars: {} } as never;
    const pick = (battleRole: "any" | "attacker" | "notAttacker") => resolveSelector(ctx, game, s, frame, { side: "both", areas: ["leader", "battle"], area: "leader", battleRole }).sort();
    assert.deepEqual(pick("attacker"), [atk], `${seat}: I: the attacking card`);
    assert.deepEqual(pick("any"), [atk, guard].sort(), `${seat}: I: either end`);
    assert.ok(!pick("notAttacker").includes(atk) && pick("notAttacker").includes(other), `${seat}: I: every card but the attacker`);
    // Review: "…that hasn't attacked this turn" (SD20-05) — the attacker is out, the other card in.
    const unused = resolveSelector(ctx, game, s, frame, { side: "you", area: "battle", notAttackedThisTurn: true });
    assert.ok(!unused.includes(atk) && unused.includes(other), `${seat}: I: a card that hasn't attacked this turn`);
    cases += 4;
  }

  // K. "If you do, choose one": declining the discard is no menu at all.
  {
    let s = fresh(seat, seed(11));
    const me = stage(s, seat, "IFDO", "battle");
    s = take(s, offersOf(s, me)[0].action);
    for (let i = 0; i < 20 && s.prompt.kind !== "main"; i++) {
      const q = s.prompt;
      const who = (q as { player: PlayerId }).player;
      if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: [] });
      else if (q.kind === "chooseMode") assert.fail(`${seat}: K: no menu after declining`);
      else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
      else s = take(s, { type: "pass", player: who } as Action);
    }
    assert.equal(s.sides[seat].zones.hand.length, 0, `${seat}: K: nothing drawn when nothing was discarded`);
    cases++;
  }

  // L. A copy of this card: the card itself in play is not one; a second card of its name is.
  {
    let s = fresh(seat, seed(12));
    const me = stage(s, seat, "COPYGATE", "battle");
    const before = s.sides[seat].zones.hand.length;
    s = activate(s, me, "");
    assert.equal(s.sides[seat].zones.hand.length, before + 1, `${seat}: L: alone, no copy in play — drawn`);
    s = fresh(seat, seed(13));
    const me2 = stage(s, seat, "COPYGATE", "battle");
    stage(s, seat, "COPYGATE", "battle");
    const had = s.sides[seat].zones.hand.length;
    s = activate(s, me2, "");
    assert.equal(s.sides[seat].zones.hand.length, had, `${seat}: L: a copy in play — nothing`);
    cases += 2;
  }
}
console.log(`audit-conditions-1: ${records} records, ${cases} VM cases — ok`);
