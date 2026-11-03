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
import { CTX, DEFS, IMPL, card, fifty, findG, stagedG, zoneOf } from "./harness";
import { leaderOf } from "../../src/lib/arena/engine-state";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { matches, skillKindHas } from "../../src/lib/arena/text/filters";
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

const forbids = (rec: Rec) => ops(rec).filter((o): o is Extract<Op, { op: "forbid" }> => o.op === "forbid");
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

// B. What a description says about the cards.
{
  const chosen = (rec: Rec, n = 0) => ops(rec).filter((o): o is Extract<Op, { op: "choose" }> => o.op === "choose")[n].sel;
  // "[Activate: Battle]" is one timing of [Activate] (BT15-004); an [Activate: Main/Battle] line is both.
  const b15 = chosen(record("[+1][Activate: Main] Look at up to 5 cards from the top of your deck, add up to 1 red Extra Card with an [Activate: Battle] skill and an energy cost of 3 or less among them to your hand, then shuffle your deck.", "BT15-004"));
  assert.equal(b15.filter?.skillKind, "activate:battle", "B: BT15-004 — [Activate: Battle] only");
  for (const [kind, want, has] of [["activate:battle", "activate:battle", true], ["activate:main/battle", "activate:battle", true], ["activate:main", "activate:battle", false], ["activate:main", "activate", true], ["activate:main/battle", "activate:main", true]] as const)
    assert.equal(skillKindHas(kind, want), has, `B: a ${kind} line ${has ? "is" : "is not"} ${want}`);
  // "Without keyword skills" (BT7-126) and "with a keyword skill" (EX24-42).
  assert.equal(chosen(record("[auto] When this card attacks, choose all Battle Cards without keyword skills in your Drop Area and combo with them in your Combo Area.", "BT7-126")).filter?.noKeywords, true, "B: BT7-126 — none");
  assert.equal(chosen(record("[auto] When this card attacks, choose up to 1 of your opponent's Battle Cards with a keyword skill, ignoring [barrier], and use it in a combo in your Combo Area.", "EX24-42")).filter?.someKeyword, true, "B: EX24-42 — one at least");
  // "With 2 or more character names including <SH>" (EX24-25): two names, SH inside them (R-231, pending).
  const sh = chosen(record("[Auto] When this card is played, choose up to 2 of your Battle Cards with 2 or more character names including <SH> and they gain [Barrier] until the end of your opponent's turn.", "EX24-25"));
  assert.deepEqual([sh.filter?.charactersMin, sh.filter?.charactersIncluding, sh.filter?.characters], [2, ["SH"], []], "B: EX24-25 — two or more names, <SH> inside them");
  const pairSH = card("AC2_PAIRSH", { characters: ["Gamma 1: SH", "Gamma 2: SH"] });
  const oneSH = card("AC2_ONESH", { characters: ["Gamma 2: SH"] });
  assert.deepEqual([matches(pairSH, sh.filter!), matches(oneSH, sh.filter!)], [true, false], "B: EX24-25 — a two-name SH card only");
  // "[Arrival Red/Green]" names the colours (BT25-082), whichever is printed first.
  const arr = chosen(record("[Auto][Limit 1] If your Leader is a green <Trunks: Future> card: When this card is played, choose up to 1 of your ≪Saiyan≫ cards with [Arrival Red/Green] and return it to its owner's hand.", "BT25-082"));
  assert.deepEqual(arr.filter?.keywordsExact, ["Arrival Red/Green"], "B: BT25-082 — that [Arrival]");
  const saiyan = (skill: string) => card("AC2_ARR", { traits: ["Saiyan"], skill });
  assert.deepEqual([matches(saiyan("[Arrival Red/Green]{r}"), arr.filter!), matches(saiyan("[Arrival Green/Red]{r}"), arr.filter!), matches(saiyan("[Arrival Blue/Yellow]{u}"), arr.filter!)], [true, true, false], "B: BT25-082 — red and green, not blue and yellow");
  // "Larger than or equal to the opponent's amount of total energy" (BT2-098).
  const b2 = chosen(record("[Activate: Main] Choose 1 of your opponent's Battle Cards with an energy cost larger than or equal to the opponent's amount of total energy and KO it.", "BT2-098"));
  assert.deepEqual([b2.filter?.costAtLeastEnergy, b2.filter?.energyOfOpponent], [true, true], "B: BT2-098 — at least their energy");
  // "…with power less than or equal to that card's power" (BT25-035): the King Piccolo chosen just before.
  const kp = record("[Activate: Main] Choose up to 1 of your red <King Piccolo> cards with an energy cost of 3 or 6, then choose all of your opponent's Battle Cards with power less than or equal to that card's power and KO them.", "BT25-035");
  const first = ops(kp).find((o): o is Extract<Op, { op: "choose" }> => o.op === "choose")!;
  assert.deepEqual(chosen(kp, 1).filter?.powerRel, { of: "chosen", cmp: "<=", var: first.as }, "B: BT25-035 — measured against the chosen <King Piccolo>");
  // "…card you own in your opponent's Battle Area" (BT20-114).
  const own = chosen(record("[Activate: Main][Once per turn] Choose up to 1 card you own in your opponent's Battle Area and it gains [Servant] until the end of your opponent's next turn.", "BT20-114"));
  assert.deepEqual([own.side, own.area, own.ownedByYou], ["opponent", "battle", true], "B: BT20-114 — yours, in their Battle Area");
  // "…with a character name different from any Battle Cards you have in play" (EB1-33).
  const eb = chosen(record("[activate: main][once per turn][burst 2]{1}, if your Leader Card is green or a ≪Heroine≫ card and you have 3 or more green energy: Play up to 1 green ≪Universe 2≫ card with an energy cost of 3 or less from your deck with a character name different from any Battle Cards you have in play, then shuffle your deck.", "EB1-33"));
  assert.deepEqual([eb.area, eb.charactersNotInPlay, eb.filter?.costMax], ["deck", true, 3], "B: EB1-33 — no name you have in play");
  // "A skill-less Battle Card or Unison" (P-451): skill-less both.
  const p451 = conds(record("[auto]{b}, if your Leader is a black <Fin> card, you have 2 or more energy, and your opponent has a skill-less Battle Card or Unison in play: When you add this card to your Z-Energy, you may play 1 <Fin> card with an energy cost of 2 or less and 15000 power or more from your hand. If you do, draw 1 card.", "P-451"));
  const unison = p451.flatMap((c) => (c.kind === "any" ? c.conds : [c])).find((c) => c.kind === "count" && c.sel.filter?.type === "UNISON");
  assert.ok(unison && unison.kind === "count" && unison.sel.filter?.skillLess, "B: P-451 — a skill-less Unison");
  // "…with {Power Pole} under it" (BT24-009): a pile no measure holds — unread, not a card named {Power Pole}.
  assert.ok(only("[Auto][Limit 1] When your red <Son Goku> card with {Power Pole} under it and an energy cost of 5 or more is removed from your Battle Area by your opponent's skill, you may play this card from your hand.", "BT24-009").unread.length > 0, "B: BT24-009 — unread");
  records += 12;
}

// C. Conditions and causes said in passing.
{
  // "…would be placed in its owner's Drop Area by one of your skills" (BT15-097): a move to the Drop only.
  const warp = ops(record("[permanent] If this card in your Battle Area would be placed in its owner's Drop Area by one of your skills, it's sent to its owner's Warp instead.", "BT15-097")).find((o) => o.op === "replaceLeave");
  assert.ok(warp && warp.op === "replaceLeave" && warp.requestedTo === "drop" && warp.to === "warp", "C: BT15-097 — a move to the Drop, sent to the Warp");
  // "…you can't place cards in your Energy Area by your skills for the game" (BT22-031): your skills' moves, not the charge.
  const b22 = forbids(record("[Awaken] When your life is at 5 or less: Draw 2 cards, and you can't place cards in your Energy Area by your skills for the game.", "BT22-031", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }));
  assert.deepEqual(b22.map((o) => [o.what, o.side, o.toArea, o.until]), [["beMovedBySkill", "you", "energy", "game"]], "C: BT22-031 — your skills' placements, for the game");
  // "If that card was your own Battle Card" (BT4-045).
  const b4 = conds(record("[Activate: Main] If your Leader Card is blue, choose up to 1 of your or your opponent's Battle Cards with an energy cost of 3 or less and return it to its owner's hand. If that card was your own Battle Card, draw 1 card.", "BT4-045"));
  assert.ok(b4.some((c) => c.kind === "count" && c.sel.ownedByYou && c.sel.fromVar), "C: BT4-045 — the returned card is yours");
  // "If you have only black cards in your energy" (BT8-104): all of it.
  assert.ok(conds(record("[Permanent] If you have only black cards in your energy and your life is at 4 or less, you can activate this card's [Counter] skill from your hand by adding a card from your life to your hand instead of paying its energy cost.", "BT8-104")).some((c) => c.kind === "every"), "C: BT8-104 — every card in the energy");
  // "If all of the cards placed in your Drop Area are black" (BT4-098): the cards this skill placed.
  const b98 = conds(record("[Auto] When this card attacks a Leader Card, place 3 cards from the top of your deck in your Drop Area. If all of the cards placed in your Drop Area are black, draw 1 card.", "BT4-098")).find((c) => c.kind === "every");
  assert.ok(b98 && b98.kind === "every" && b98.sel.fromVar && b98.matching.fromVar === b98.sel.fromVar, "C: BT4-098 — the milled cards, not the whole Drop");
  // "KO it if it's a skill-less Battle Card" (EX19-36).
  const ex19 = record("[Auto] When this card is played from your hand, choose up to 1 of your opponent's Battle Cards, switch it to Rest Mode, and KO it if it's a skill-less Battle Card.", "EX19-36");
  const gate = ex19.ops.find((o) => o.op === "if");
  assert.ok(gate && gate.op === "if" && gate.cond.kind === "varMatches" && gate.cond.filter.skillLess && gate.then.some((o) => o.op === "ko"), "C: EX19-36 — the KO hangs on skill-less");
  assert.ok(!ex19.ops.some((o) => o.op === "ko"), "C: EX19-36 — …and only there");
  // "When this card attacks twice in the same turn" (EX01-04).
  assert.ok(conds(record("[auto] When this card attacks twice in the same turn, it gains [double strike] for the duration of the turn.", "EX01-04")).some((c) => c.kind === "attacked" && c.atLeast === 2), "C: EX01-04 — the second attack");
  // "…and it's the turn when this card was played" (BT23-040).
  assert.ok(conds(record("[auto] If your Leader is a blue <Raditz> or <Nappa> card and it's the turn when this card was played: When this card attacks, draw 1 card.", "BT23-040")).some((c) => c.kind === "placedThisTurn" && c.played), "C: BT23-040 — played this turn");
  records += 9;
}

// D. The extra items of the round.
{
  // "{r}{r}{r}: If …: Choose …" (EX15-01): a condition closed by a colon inside the effect (R-230, pending).
  const ex15 = record("[activate: main]{r}{r}{r}: If your Leader Card is a red <Gogeta: Br> card and you have 4 or more energy: Choose up to 1 mono-red <Gogeta: Br> card with an energy cost of 8 or less from your deck or hand, play it on top of this card, then shuffle your deck if you looked through it. You can't activate the [activate: main] skill on copies of this card for the turn.", "EX15-01");
  assert.ok(conds(ex15).some((c) => c.kind === "leaderMatches") && conds(ex15).some((c) => c.kind === "count" && c.sel.area === "energy" && c.atLeast === 4), "D: EX15-01 — both halves of the condition");
  assert.ok(ops(ex15).some((o) => o.op === "play"), "D: EX15-01 — …and the play under them");
  // "If you have 4 or more energy, for each marker on your Z-Unison, reduce …" (BT24-139).
  const b24 = record("[Permanent] If you have 4 or more energy, for each marker on your Z-Unison, reduce the energy cost on this card in your hand by 3.", "BT24-139");
  const red = ops(b24).find((o) => o.op === "costReduction");
  assert.ok(conds(b24).some((c) => c.kind === "count" && c.sel.area === "energy" && c.atLeast === 4), "D: BT24-139 — the energy condition");
  assert.ok(red && red.op === "costReduction" && typeof red.amount === "object" && "markers" in red.amount && red.amount.times === 3, "D: BT24-139 — 3 for each marker on the Z-Unison");
  // "…place the card you placed in your energy with this skill in its owner's Drop Area" (BT10-035): that card alone.
  const b10 = record("[+2][Activate: Main] If your Leader Card is mono-blue: Place the top card of your deck in your energy; you can't place cards in your Energy Area for the turn, then, at the end of the turn, place the card you placed in your energy with this skill in its owner's Drop Area.", "BT10-035");
  const later = ops(b10).find((o) => o.op === "delay");
  assert.ok(later && later.op === "delay" && later.ops.some((o) => o.op === "moveTo" && "sel" in o.target && o.target.sel.fromVar === "placedInEnergy"), "D: BT10-035 — the card it placed, not every energy");
  // "When this card is discarded by your Leader's skill" (P-491): your own Leader's, and no discard without a card.
  const p491 = conds(record("[Auto] If your Leader is a yellow <Evil Wizard Babidi> card: When this card is discarded by your Leader's skill, play it from your Drop.", "P-491"));
  assert.ok(p491.some((c) => c.kind === "count" && c.sel.special === "subject" && c.sel.side === "you" && c.sel.filter?.type === "LEADER"), "D: P-491 — your Leader");
  assert.ok(!p491.some((c) => c.kind === "any"), "D: P-491 — no \"no card\" alternative");
  // "When this card attacks a Leader or Unison" (BT18-059).
  const b18 = conds(record("[Auto] When this card attacks a Leader or Unison, draw 1 card, then add up to 1 card from your life to your hand.", "BT18-059"));
  assert.ok(b18.some((c) => c.kind === "any" && c.conds.every((x) => x.kind === "inBattle" && x.role === "guard")), "D: BT18-059 — the guard is a Leader or a Unison");
  // "…and the total ≪X≫ cards with different card names among … is 5 or more" (EX23-22): never one count of Turles in the
  // energy. Round 3 reads it (audit-conditions-3: the energy, and a count of names over the three places).
  const ex23 = only("[activate: main][limit 1]{g}, if you have 3 or more energy and the total ≪Turles Crusher Corps≫ cards with different card names among all cards in your Z-Energy, Battle Area, and Drop is 5 or more: Draw 1 card and play this card from your hand.", "EX23-22");
  assert.ok(ex23.unread.length > 0 || !flat(ex23.cond).some((c) => c.kind === "count" && c.sel.area === "energy" && !c.sel.areas && !!c.sel.filter?.traits.length), "D: EX23-22 — not a count of Turles in the energy");
  records += 6;
}

// F. The review's repairs (round 2's items the fix pass left).
{
  const LEADER = { type: "LEADER" as const, energyCost: null, comboCost: null, comboPower: null };
  const deep = (c: Cond | null | undefined): Cond[] => (!c ? [] : c.kind === "any" || c.kind === "all" ? [c, ...c.conds.flatMap(deep)] : [c]);
  const priceCond = (rec: Rec) => deep((rec.cost as { condition?: Cond | null }).condition ?? null);
  // BT19-001's [Awaken]: "…or you have 2 or more energy and a <Son Goku>, <Vegeta>, or <Trunks: Future> card—all red
  // and with [EX-Evolve]—in play" — 2 energy, and one such card (any of the three names, each red with [EX-Evolve]).
  const b19 = priceCond(record("[Awaken] When your life is at 4 or less, or you have 2 or more energy and a <Son Goku>, <Vegeta>, or <Trunks: Future> card—all red and with [EX-Evolve]—in play: You may draw 1 card, switch up to 1 of your energy to Active Mode, and add cards from your life to your hand until you have 6 life left.", "BT19-001", LEADER));
  assert.ok(b19.some((c) => c.kind === "count" && c.sel.area === "energy" && c.atLeast === 2 && !c.sel.filter?.characters.length), "F: BT19-001 — 2 or more energy, any energy");
  const named = b19.filter((c): c is Extract<Cond, { kind: "count" }> => c.kind === "count" && c.sel.area === "play");
  assert.deepEqual(named.map((c) => [c.sel.filter?.characters.join(), c.sel.filter?.colors.join(), c.sel.filter?.keywordsExact?.join(), c.atLeast]), [["son goku", "Red", "EX-Evolve", 1], ["vegeta", "Red", "EX-Evolve", 1], ["trunks: future", "Red", "EX-Evolve", 1]], "F: BT19-001 — one red [EX-Evolve] card of any of the three names");
  // BT18-001's [Awaken]: "…2 or more energy and both <Son Goku: GT> and <Vegeta: GT> cards in your Z-Energy".
  const b18a = priceCond(record("[Awaken] When your life is at 4 or less or you have 2 or more energy and both <Son Goku: GT> and <Vegeta: GT> cards in your Z-Energy: You may draw 1 card, switch up to 1 of your energy to Active Mode, and add cards from your life to your hand until you have 6 life left.", "BT18-001", LEADER));
  assert.ok(b18a.some((c) => c.kind === "count" && c.sel.area === "energy" && c.atLeast === 2 && !c.sel.filter), "F: BT18-001 — 2 or more energy");
  for (const name of ["son goku: gt", "vegeta: gt"]) assert.ok(b18a.some((c) => c.kind === "count" && c.sel.area === "zEnergy" && c.sel.filter?.characters.join() === name && c.atLeast === 1), `F: BT18-001 — a ${name} card in the Z-Energy`);
  // BT10-038: "if you haven't added life to your hand due to an opponent's attack this turn" — history no condition holds:
  // unread, where it read as a card of your hand attacking.
  assert.ok(only("[Auto] If your Leader Card is a blue <Trunks: Future> card and you return this card to its owner's hand: At the end of your opponent's turn, if you haven't added life to your hand due to an opponent's attack this turn, choose up to 1 {SSB Son Goku, Hope for Victory} in your hand and play it.", "BT10-038").unread.length > 0, "F: BT10-038 — unread");
  // BT15-058: "…can only attack one more time for the turn with a Battle Card or Unison Card with 20000 power or more"
  // (R-232, pending): the budget is those attacks alone, the measure on both kinds.
  const b15 = forbids(record("[Counter: Attack] If your Leader Card is a ≪Universe 6≫ card: Negate the attack. You may choose 1 blue card in your hand and discard it. If you do, your opponent can only attack one more time for the turn with a Battle Card or Unison Card with 20000 power or more.", "BT15-058", { type: "EXTRA", power: null }));
  assert.deepEqual(b15.map((o) => [o.what, o.side, o.uses, o.filter?.anyOf?.map((a) => [a.type, a.powerMin])]), [["attack", "opponent", 1, [["BATTLE", 20000], ["UNISON", 20000]]]], "F: BT15-058 — one more attack by a 20000-power Battle Card or Unison");
  // BT12-108's price: "…with an energy cost between 2 and 4 that isn't a <Syn Shenron> card" is one card, not 1 and 4.
  const b12 = only("[activate: main][once per turn] If your Leader Card is a yellow ≪Shadow Dragon≫ card and you send 1 mono-yellow ≪Shadow Dragon≫ card with an energy cost between 2 and 4 that isn't a <Syn Shenron> card from your Drop Area to its owner's Warp: Add up to 1 card from your life to your hand.", "BT12-108");
  const sent = ((b12.cost as { program?: Op[] | null }).program ?? []).filter((o): o is Extract<Op, { op: "choose" }> => o.op === "choose");
  assert.deepEqual(sent.map((o) => [o.sel.count, o.sel.filter?.costMin, o.sel.filter?.costMax, o.sel.filter?.notCharacters.join()]), [[1, 2, 4, "syn shenron"]], "F: BT12-108 — one card costing 2 to 4, not a <Syn Shenron>");
  // XD2-04: "When a card in your energy is placed in your Drop Area by one of your skills" — your skills alone.
  assert.deepEqual(record("[Auto] When a card in your energy is placed in your Drop Area by one of your skills, you may play this card from your hand.", "XD2-04").trigger, ["yourEnergyToDropByYou"], "F: XD2-04 — your skill's move of your energy");
  // BT24-112's back: "…from under your Battle Cards or Z-Unisons—both black—in a combo" (no space after the dash): both hosts black.
  const b24b = ops(record("[Activate: Battle][Once per turn] Use up to 2 black cards with 5000 combo power from under your Battle Cards or Z-Unisons—both black—in a combo with their skills negated for the turn.", "BT24-112")).find((o) => o.op === "choose");
  assert.ok(b24b && b24b.op === "choose" && b24b.sel.underHost?.filter?.anyOf?.length === 2 && b24b.sel.underHost.filter.anyOf.every((a) => a.colors.join() === "Black"), "F: BT24-112 — a black Battle Card or a black Z-Unison");
  // BT28-038: "…then play this card from under a Battle Card at the end of your opponent's turn": only from under one.
  const b28 = ops(record("[Activate: Main] {u}: Choose up to 1 of your opponent's Battle Cards and place this card under the chosen card, then play this card from under a Battle Card at the end of your opponent's turn.", "BT28-038")).find((o) => o.op === "delay");
  assert.ok(b28 && b28.op === "delay" && b28.ops.some((o) => o.op === "choose" && o.sel.special === "self" && o.sel.area === "under" && o.sel.underHost?.filter?.type === "BATTLE"), "F: BT28-038 — this card, while under a Battle Card");
  records += 8;
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
  // B. a description against your board, and a card you own
  AC2_UNLIKE: card("AC2_UNLIKE", { skill: "[Activate: Main] Play up to 1 card with an energy cost of 1 from your Drop Area with a character name different from any Battle Cards you have in play." }),
  AC2_WARPER: card("AC2_WARPER", { skill: "[Permanent] If this card in your Battle Area would be placed in its owner's Drop Area by one of your skills, it's sent to its owner's Warp instead." }),
  AC2_BOUNCE: card("AC2_BOUNCE", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and return it to its owner's hand." }),
  AC2_TODROP: card("AC2_TODROP", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and place it in its owner's Drop Area." }),
  AC2_OWNED: card("AC2_OWNED", { skill: "[Activate: Main] Choose up to 1 card you own in your opponent's Battle Area and it gains [Servant] until the end of your opponent's next turn." }),
  // F. your energy to your Drop by one of your skills (XD2-04)
  AC2_MYBURN: card("AC2_MYBURN", { skill: "[Activate: Main] Choose up to 1 card in your energy and place it in its owner's Drop Area." }),
  AC2_THEIRBURN: card("AC2_THEIRBURN", { skill: "[Activate: Main] Choose up to 1 card in your opponent's energy and place it in its owner's Drop Area." }),
  AC2_XD2: card("AC2_XD2", { skill: `[Auto] When a card in your energy is placed in your Drop Area by one of your skills, ${DRAW}` }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
for (const d of ["AC2_SEAL", "AC2_BYSEAL", "AC2_NOSKILL", "AC2_SWAPPER", "AC2_SWAPPED", "AC2_MYBURN", "AC2_THEIRBURN", "AC2_XD2"]) for (const r of skillRecords(defs[d])) assert.deepEqual(r.unread, [], `${d}: read`);
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
  // B1. "A character name different from any Battle Cards you have in play": a card named like one in play is not offered.
  {
    let s = fresh(seat, seed(8));
    const a = stage(s, seat, "AC2_UNLIKE", "battle");
    stage(s, seat, "V1", "battle");
    const same = stage(s, seat, "V1", "drop");
    const other = stage(s, seat, "V-BLUE", "drop");
    s = take(s, offerOf(s, a)!.action);
    assert.equal(s.prompt.kind, "chooseCards", `${seat}: B1: a choice`);
    const offered = (s.prompt as Extract<Prompt, { kind: "chooseCards" }>).choice.candidates;
    assert.ok(offered.includes(other) && !offered.includes(same), `${seat}: B1: <V-BLUE> offered, <V1> (in play) not`);
    cases++;
  }
  // B2. "A card you own in your opponent's Battle Area": their own card there is not offered, yours is.
  {
    let s = fresh(seat, seed(9));
    const a = stage(s, seat, "AC2_OWNED", "battle");
    const theirs = stage(s, other(seat), "V-BLUE", "battle");
    const mine = stage(s, seat, "V1", "hand");
    assert.ok(moveCard(s, game, mine, "battle", { owner: other(seat) }).ok);
    s.cards[mine].mode = "active";
    s = take(s, offerOf(s, a)!.action);
    assert.equal(s.prompt.kind, "chooseCards", `${seat}: B2: a choice`);
    const offered = (s.prompt as Extract<Prompt, { kind: "chooseCards" }>).choice.candidates;
    assert.ok(offered.includes(mine) && !offered.includes(theirs), `${seat}: B2: yours there offered, theirs not`);
    cases++;
  }
  // C1. To the Warp instead of the Drop: only a move to the Drop by your skill; a return to the hand stays a return.
  for (const [n, actor, to] of [[10, "AC2_TODROP", "warp"], [11, "AC2_BOUNCE", "hand"]] as const) {
    let s = fresh(seat, seed(n));
    const a = stage(s, seat, actor, "battle");
    const w = stage(s, seat, "AC2_WARPER", "battle");
    s = settle(take(s, offerOf(s, a)!.action), pick(w));
    assert.ok(s.sides[seat].zones[to].includes(w), `${seat}: C1: ${actor} — it went to the ${to}`);
    cases++;
  }
  // F1. "When a card in your energy is placed in your Drop Area by one of your skills" (XD2-04): your own skill's burn of
  // your energy answers; the opponent's skill burning it does not.
  for (const [n, burner, mine] of [[12, "AC2_MYBURN", true], [13, "AC2_THEIRBURN", false]] as const) {
    let s = fresh(seat, seed(n));
    const a = stage(s, seat, burner, "battle");
    const owner = mine ? seat : other(seat);
    const watcher = stage(s, owner, "AC2_XD2", "battle");
    const energy = stage(s, owner, "V1", "energy");
    s = settle(take(s, offerOf(s, a)!.action), pick(energy));
    assert.ok(s.sides[owner].zones.drop.includes(energy), `${seat}: F1: ${burner} — the energy went to the Drop`);
    assert.ok(s.sides[owner].zones.battle.includes(watcher), `${seat}: F1: the watcher stays`);
    assert.equal(hand(s, owner), mine ? 1 : 0, `${seat}: F1: ${burner} — ${mine ? "your skill: answers" : "the opponent's skill: no trigger"}`);
    cases++;
  }
}

// E. "If you would reveal this card from your life …" (BT10-036, Q&A BT10-036/BT10-040): a card face up in the life is
// not revealed, so the replacement is offered only for a face-down one. p1 attacks p2's Leader for one damage.
{
  DEFS.AC2_LIFE = card("AC2_LIFE", { energyCost: 1, skill: "[Permanent] During your opponent's turn, if all of your energy is mono-blue and you would reveal this card from your life to add it to your hand, you may place it in your energy in Rest Mode instead. If you do, draw 1 card." });
  for (const faceUp of [false, true]) {
    const staged = stagedG({ battle: ["BIG"], oppEnergy: ["V-BLUE"] });
    const life = zoneOf(staged, "p2", "life")[0];
    staged.cards[life].cardId = "AC2_LIFE";
    if (faceUp) staged.cards[life].faceUp = true;
    let r = IMPL.apply(CTX, staged, { type: "attack", player: "p1", attacker: findG(staged, "p1", "battle", "BIG"), target: leaderOf(staged, "p2") });
    for (let i = 0; i < 6 && r.state.battle && r.state.prompt.kind !== "replaceMove"; i++) r = IMPL.apply(CTX, r.state, { type: "pass", player: (r.state.prompt as { player: PlayerId }).player });
    if (faceUp) {
      assert.notEqual(r.state.prompt.kind, "replaceMove", "E: a face-up life card is not revealed — no offer");
      assert.ok(zoneOf(r.state, "p2", "hand").includes(life), "E: …it is added to the hand");
    } else assert.equal(r.state.prompt.kind, "replaceMove", "E: a face-down life card revealed — the offer is made");
    cases++;
  }
}

console.log(`audit-conditions-2: ${records} records, ${cases} VM cases — ok`);
