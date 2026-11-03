/**
 * Audit lane C, conditions, round 3 (3 Nov 2026): skills that were unread because their first unread clause was a
 * condition no reader knew, taught by wording family. Printed text inline (catalog text of the snapshot of 3 Nov 2026);
 * the boards in the VM cases are synthetic.
 *
 * A.  Where a battle stands (8-1): "during a battle in which your <Broly> card is attacking a Battle Card" (BT22-056),
 *     "…is attacking an opponent's Battle Card" (BT16-043), "your opponent's card is attacking" (BT31-140), "during this
 *     card's battle" (TB2-001), "in a battle with a Battle Card" (BT27-050), "another card is in a battle" (EX19-14), "…in
 *     a battle during your turn" (P-743).
 * B.  Counts over a list of places and counts said another way: P-456, P-616, EB1-58, EX23-22, P-475, BT19-140, BT26-136,
 *     BT18-107, BT20-060/062, BT20-012, BT4-032, BT2-042, BT3-107b, BT3-032, BT26-093, BT9-021b, BT26-118, BT23-071b,
 *     EX06-14, BT24-096, BT15-149, P-625, EX23-02, EX19-21, DB2-123.
 * C.  Leaders: BT19-066, BT19-037, BT18-053, BT20-121, P-411, P-176, BT24-008, BT19-030, BT26-023, BT29-071.
 * D.  What the skill's own steps did: the attacker (BT20-083, BT15-080, BT1-001, TB1-001), the played card (P-570), the
 *     opponent's discarded card (BT4-106, BT3-073), the milled pile (BT2-101, BT30-031), a choice's count (BT19-149), a
 *     play and where from (P-306, EX23-18, EX17-01), cards added (EX21-30, P-108), sent (P-289), the card the price placed
 *     (P-628), a power after the change (SD17-01, BT16-006), the chosen card's mode (BT9-066), an opponent's card placed in
 *     their energy (EX08-02), the card played with this skill (BT7-108), the pile under this card (BT6-030); "this card
 *     can only attack or be used in a combo if …" (BT22-013); colours other than black (EX23-50, EX23-45); only this card
 *     and one other in the Combo Area (BT14-013).
 *
 * Proved here: the records (nothing unread where the line is whole, the stored-row JSON round trip, the rules
 * language's print and reparse), and the conditions asked of staged boards in the VM (`condHolds`).
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { condHolds } from "../../src/lib/arena/vm/program";
import { matches } from "../../src/lib/arena/text/filters";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Cond, Op, Selector } from "../../src/lib/arena/vm/script";
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
/** Every condition the record states: its own, its price's, and those of the `if`s of its program, nested ones included. */
function conds(rec: Rec): Cond[] {
  const out = [...flat(rec.cond), ...flat((rec.cost as { condition?: Cond | null } | null)?.condition)];
  const walk = (list: Op[]) => {
    for (const o of list) {
      if (o.op === "if") { out.push(...flat(o.cond)); walk(o.then); if (o.else) walk(o.else); }
      if (o.op === "may") walk(o.ops);
      if (o.op === "chooseMode") for (const m of o.modes) walk(m.ops);
    }
  };
  walk(rec.ops);
  // A price's condition is the record's own said twice (`cost.condition`): each condition once.
  return out.filter((c, i) => out.findIndex((d) => JSON.stringify(d) === JSON.stringify(c)) === i);
}
/** The one condition of `kind` the record states (the first, when several). */
function the<K extends Cond["kind"]>(rec: Rec, kind: K, what: string, where: (c: Extract<Cond, { kind: K }>) => boolean = () => true): Extract<Cond, { kind: K }> {
  const got = conds(rec).find((c): c is Extract<Cond, { kind: K }> => c.kind === kind && where(c as Extract<Cond, { kind: K }>));
  assert.ok(got, `${what}: a ${kind} condition (${JSON.stringify(conds(rec))})`);
  return got;
}
let records = 0;

// A. Where a battle stands.
{
  for (const [what, text] of [
    ["BT22-056", "[Permanent] During a battle in which your <Broly> card is attacking a Battle Card, your opponent can't activate [Counter] skills."],
    ["P-671", "[permanent] During a battle in which your green ≪Turtle School≫ card is attacking a Battle Card, your opponent can't activate [blocker] or [counter] skills."],
    ["BT16-043", "[Counter: Counter] If one of your blue <Beerus> cards is attacking an opponent's Battle Card: Negate the [Counter: Attack] and switch up to 1 of your blue energy to Active Mode."],
  ] as const) {
    const rec = record(text, what, what === "BT16-043" ? { type: "EXTRA" } : {});
    const attacker = the(rec, "inBattle", what, (c) => c.role === "attacker");
    assert.equal(attacker.sel.side, "you", `A: ${what} — your attacker`);
    const guard = the(rec, "inBattle", what, (c) => c.role === "guard");
    assert.deepEqual([guard.sel.side, guard.sel.area], ["opponent", "battle"], `A: ${what} — attacking their Battle Card`);
    records++;
  }
  const b31 = the(record("[Activate: Main/Battle] Draw 1 card and switch up to 3 of your energy to Revealed Mode. Additionally, if your opponent's card is attacking, your Leader gets +10000 power for the battle.", "BT31-140", { type: "EXTRA" }), "inBattle", "BT31-140");
  assert.deepEqual([b31.sel.side, b31.sel.area, b31.role], ["opponent", "play", "attacker"], "A: BT31-140 — any card of theirs attacking");
  const tb2 = the(record("[Activate: Battle] During this card's battle, if there are cards in your Combo Area, draw 1 card and negate this skill for the duration of the battle.", "TB2-001", { type: "LEADER" }), "inBattle", "TB2-001");
  assert.deepEqual([tb2.sel.special, tb2.role], ["self", undefined], "A: TB2-001 — a battle this card is in");
  const b27 = conds(record("[Activate: Battle][Once per turn] If this card is in a battle with a Battle Card: Switch this card to Active Mode and it gets +10000 power for the battle.", "BT27-050")).filter((c) => c.kind === "inBattle");
  assert.equal(b27.length, 2, "A: BT27-050 — this card, and the other card in the battle");
  const ex19 = the(record("[0][Activate: Battle] If another card is in a battle: Use up to 1 Green/Yellow multicolor card from your Drop Area in a combo with its skills negated for the battle.", "EX19-14", { type: "UNISON" }), "inBattle", "EX19-14");
  assert.deepEqual([ex19.sel.side, ex19.sel.notSelf], ["both", "card"], "A: EX19-14 — any card but this one");
  const p743 = record("[auto] [limit 1] If your blue <Vegeta: GT> is in a battle during your turn and you remove this card from the game: When your opponent uses cards in a combo, place those cards on top of their owner's deck.", "P-743");
  assert.ok(conds(p743).some((c) => c.kind === "isTurnPlayer" && !c.who) && conds(p743).some((c) => c.kind === "inBattle"), "A: P-743 — in a battle, during your turn");
  // "…card―both green and with an energy cost of 4―is attacking" (BT22-067): the aside closes the subject.
  const b22 = the(record("[activate: battle][limit 1]{g}, if your <Son Gohan: Adolescence> or <Son Goten> card―both green and with an energy cost of 4―is attacking: Play this card from your hand on top of the attacking card, then draw 1 card.", "BT22-067"), "inBattle", "BT22-067");
  assert.deepEqual([b22.role, b22.sel.filter?.colors, b22.sel.filter?.costMin, b22.sel.filter?.costMax], ["attacker", ["Green"], 4, 4], "A: BT22-067 — green, cost 4, attacking");
  // Any other object of "is attacking" is not read here.
  assert.ok(only("[Permanent] During a battle in which your <Broly> card is attacking a Unison, your opponent can't activate [Counter] skills.", "AC3_UNREAD").unread.length > 0, "A: another object — unread");
  records += 7;
}

// B. Counts over a list of places, and counts said another way.
{
  const count = (rec: Rec, what: string, where: (c: Extract<Cond, { kind: "count" }>) => boolean = () => true) => the(rec, "count", what, where);
  const areasOf = (s: Selector) => [...(s.areas ?? [s.area])].sort();
  const p456 = count(record("[Permanent] If you have a total of 7 or more cards in your energy, Z-Energy, Battle Area, and Drop, reduce this card's energy cost in your hand by 2.", "P-456"), "P-456");
  assert.deepEqual([areasOf(p456.sel), p456.atLeast], [["battle", "drop", "energy", "zEnergy"], 7], "B: P-456 — one count over four places");
  const p616 = count(record("[Activate: Main][Limit 1] If you have a total of 7 or more cards with <GT> in their character names among all cards in your energy, Z-Energy, Battle Area, and/or Drop: Play this card from your hand.", "P-616"), "P-616");
  assert.deepEqual([areasOf(p616.sel), p616.sel.filter?.charactersIncluding, p616.atLeast], [["battle", "drop", "energy", "zEnergy"], ["gt"], 7], "B: P-616 — <GT> inside the names, four places");
  const eb1 = count(record("[Auto][Once per turn] If there are a total of 6 or more Battle Cards with energy costs of 1 in your Battle Area and Drop Area: When this card attacks, it gets +10000 power for the turn, then choose up to 3 of your opponent's Battle Cards and KO them.", "EB1-58"), "EB1-58");
  assert.deepEqual([areasOf(eb1.sel), eb1.sel.filter?.type, eb1.sel.filter?.costMax, eb1.atLeast], [["battle", "drop"], "BATTLE", 1, 6], "B: EB1-58 — both places");
  const ex23 = record("[activate: main][limit 1]{g}, if you have 3 or more energy and the total ≪Turles Crusher Corps≫ cards with different card names among all cards in your Z-Energy, Battle Area, and Drop is 5 or more: Draw 1 card and play this card from your hand.", "EX23-22");
  const names = count(ex23, "EX23-22", (c) => !!c.sel.differentNames);
  assert.deepEqual([areasOf(names.sel), names.atLeast], [["battle", "drop", "zEnergy"], 5], "B: EX23-22 — names counted over three places");
  assert.ok(conds(ex23).some((c) => c.kind === "count" && c.sel.area === "energy" && c.atLeast === 3), "B: EX23-22 — …and 3 or more energy");
  const p475 = record("[activate: main][limit 1]{1}, if your Leader Card has {Agent of Destruction} in its card name and the total number of cards with {Agent of Destruction} in their names in your Leader Area, energy, Z-Energy, Battle Area, and Drop is 7 or more: Play this card from your hand.", "P-475");
  assert.deepEqual(areasOf(count(p475, "P-475").sel), ["battle", "drop", "energy", "leader", "zEnergy"], "B: P-475 — five places");
  const b19 = count(record("[Auto] When this card is played from your hand, choose one― ・Place up to 3 cards from the top of your deck in your Drop, and if there are a total of 7 or more cards in all Drops, draw 2 cards. ・Choose up to 1 of your opponent's Battle Cards with an energy cost of 7 or less, ignoring [Barrier], and send it to its owner's Warp.", "BT19-140"), "BT19-140", (c) => c.sel.side === "both");
  assert.deepEqual([b19.sel.area, b19.atLeast], ["drop", 7], "B: BT19-140 — both Drops");
  const b26 = count(record("[activate: main/battle][limit 1]{1}, if your Leader is a red or green ≪Android≫ card, you have 3 or more energy, and you have a Z-Card in your Leader Area, Battle Area, or Unison Area: Play this card from your hand.", "BT26-136"), "BT26-136", (c) => !!c.sel.filter?.z);
  assert.deepEqual(areasOf(b26.sel), ["battle", "leader", "unison"], "B: BT26-136 — a Z-Card in any of three places");
  assert.equal(count(record("[activate: main]{3}, if there are 4 or more ≪Bardock's Crew≫ cards with different character names in your energy, Z-Energy, Battle Area, and/or Drop: Play this card from your hand.", "BT18-107"), "BT18-107").sel.differentCharacters, true, "B: BT18-107 — different character names");
  const pan = count(record("[permanent] While there are 3 or more <Pan> cards and/or cards with <GT> in their character names—both green and without <Son Goku: GT>—in your Z-Energy, Battle Area, and Drop, this card gains [double strike] and [dual attack].", "BT20-060"), "BT20-060");
  assert.deepEqual([pan.sel.filter?.colors, pan.sel.filter?.notCharacters, pan.sel.filter?.anyOf?.length, areasOf(pan.sel)], [["Green"], ["son goku: gt"], 2, ["battle", "drop", "zEnergy"]], "B: BT20-060 — either description, the aside on both");
  const each = conds(record("[activate: main][limit 1]{r}, if your Leader is a red ≪Universe 3≫ card and there are 1 or more <Koitsukai>, <Panchia>, and <Bollarator> cards—all red—in your energy, Z-Energy, Battle Area, and Drop, and your opponent has 2 or more energy: Play this card from your hand.", "BT20-012")).filter((c) => c.kind === "count" && c.sel.side === "you");
  assert.deepEqual(each.map((c) => c.kind === "count" && c.sel.filter?.characters).sort(), [["bollarator"], ["koitsukai"], ["panchia"]], "B: BT20-012 — one count per name");
  assert.ok(each.every((c) => c.kind === "count" && c.sel.filter?.colors[0] === "Red" && areasOf(c.sel).length === 4), "B: BT20-012 — red, four places each");
  const tapion = count(record("[Permanent] If <Tapion> is in your Drop Area or Warp, this card gains [Double Strike] and [Barrier].", "BT4-032"), "BT4-032");
  assert.deepEqual(areasOf(tapion.sel), ["drop", "warp"], "B: BT4-032 — either place");
  assert.equal(conds(record("[permanent] If both <Son Goku> and <Vegeta> are in your Battle Area or Drop Area, this card gains [triple strike] (This card inflicts 3 damage instead of 1 when attacking).", "BT2-042")).filter((c) => c.kind === "count").length, 2, "B: BT2-042 — each name");
  const warp = count(record("[Permanent] If your Warp has 5 cards or more in it, this card gains [Critical].", "BT3-107"), "BT3-107");
  assert.deepEqual([warp.sel.area, warp.atLeast], ["warp", 5], "B: BT3-107 — the Warp");
  const none = count(record("[Activate: Main] Place 1 card from your hand in the Drop Area: If you have no energy, choose 2 cards in your life and add them to your energy.", "BT3-032"), "BT3-032");
  assert.deepEqual([none.sel.area, none.atMost], ["energy", 0], "B: BT3-032 — no energy");
  assert.equal(count(record("[Permanent] If this card has a <Son Goku> card under it, it gets +10000 power.", "BT26-093"), "BT26-093").sel.area, "under", "B: BT26-093 — its own pile");
  assert.equal(count(record("[activate: main][once per turn] If there are 9 or more multicolor Extra Cards and/or ≪Universe 7≫ cards in your Drop Area: This card gets +5000 power, [double strike], and [critical] for the duration of the turn.", "BT9-021"), "BT9-021").sel.filter?.anyOf?.length, 2, "B: BT9-021 — either description");
  const rest = conds(record("[Activate: Main][Limit 1] If your Leader is yellow and you have 1 or more <Son Goku> and 1 or more <Son Gohan: Childhood> cards in Rest Mode: Draw 2 cards, and you can't attack for the turn.", "BT26-118")).filter((c) => c.kind === "count");
  assert.ok(rest.length === 2 && rest.every((c) => c.kind === "count" && c.sel.mode === "rest"), "B: BT26-118 — both counts in Rest Mode");
  assert.equal(count(record("[Auto] When this card attacks, play up to 1 green <Mai: Future> card with an energy cost of 1 from your deck or Drop, then shuffle your deck if you looked through it. Additionally, if you and your opponent have a total of 10 or more Battle Cards, this card gets +10000 power for the turn.", "BT23-071"), "BT23-071", (c) => c.sel.side === "both").atLeast, 10, "B: BT23-071 — both players' Battle Cards");
  assert.equal(count(record("[Activate: Battle] If your Leader Card is a <Goku Black> or <Zamasu> card, it gets +10000 power for the duration of the battle, then if there is a total of 7 or more energy between you and your opponent, place this card from your Drop Area in your energy in Rest Mode.", "EX06-14", { type: "EXTRA" }), "EX06-14", (c) => c.sel.side === "both").atLeast, 7, "B: EX06-14 — both Energy Areas");
  assert.equal(count(record("[activate: main][once per turn] If your Leader is yellow and the total number of cards in Rest Mode between you and your opponent is 15 or more: Choose all of your opponent's Rest Mode Battle Cards and KO them, switch this card to Active Mode, and this card gains [dual attack] for the turn.", "BT24-096"), "BT24-096", (c) => c.sel.side === "both").atLeast, 15, "B: BT24-096 — both players");
  const life = count(record("[Permanent] If your Leader Card is a ≪Turles Crusher Corps≫ card and there are 3 or more face-up life cards between you and your opponent, negate this card's [Energy-Exhaust] skill in all areas.", "BT15-149"), "BT15-149", (c) => c.sel.side === "both");
  assert.deepEqual([life.sel.area, life.sel.filter?.faceUp, life.atLeast], ["life", true, 3], "B: BT15-149 — face-up life cards of both Life Areas");
  const p625 = the(record("[activate: main][limit 1]{r}, if your Leader is red, you have 3 or more energy, and the number of cards in your Battle Area is less than the number of cards in your opponent's Battle Area: Play this card from your hand.", "P-625"), "outnumbers", "P-625");
  assert.deepEqual([p625.sel.side, p625.than.side, p625.sel.area], ["opponent", "you", "battle"], "B: P-625 — theirs outnumber yours");
  const ex02 = count(record("[Activate: Main/Battle][Limit 1] Remove this card from under a red <Jiren> card from the game: Choose up to 1 of your red <Jiren> Battle Cards and switch it to Active Mode. Additionally, if one of your Unisons has 5 or more markers on it, choose up to 1 of your opponent's Battle Cards or Unisons and it gets -15000 power for the turn.", "EX23-02", { type: "UNISON" }), "EX23-02", (c) => c.sel.area === "unison");
  assert.equal(ex02.sel.filter?.markersMin, 5, "B: EX23-02 — one Unison with 5 markers");
  const ex21 = the(record("[Auto][Limit 1] If this card has 1 marker: When this card is played, add a marker to it for every 2 multicolor cards in your energy.", "EX19-21"), "markers", "EX19-21");
  assert.deepEqual([ex21.atLeast, ex21.atMost], [1, 1], "B: EX19-21 — exactly 1 marker");
  assert.equal(conds(record("[Auto] If your opponent has 4 or more energy: At the start of your Charge Phase, if this card is the only card in your hand, you may play this card from your hand.", "DB2-123")).filter((c) => c.kind === "count" && c.sel.area === "hand").length, 2, "B: DB2-123 — this card in the hand, and nothing else");
  // A list piece that opens a clause of its own is still a joint: "…in your energy and your life is at 4 or less" (BT8-022).
  assert.ok(conds(record("[Permanent] If you have a multicolor card in your energy and your life is at 4 or less, you can activate this card's [Counter] skill from your hand by adding a card from your life to your hand instead of paying its energy cost.", "BT8-022")).some((c) => c.kind === "life"), "B: BT8-022 — the life condition stays");
  // "4 or more colors among cards in your energy and Battle Area" (BT16-016) counts colours.
  assert.ok(count(record("[Permanent] If there are 4 or more colors among cards in your energy and Battle Area, you can activate this card's [Counter] skill from your hand without paying its energy cost.", "BT16-016"), "BT16-016").sel.distinctColors, "B: BT16-016 — colours, not cards");
  records += 30;
}

// C. Leaders.
{
  const any = (rec: Rec, what: string) => the(rec, "any", what);
  const b66 = any(record("[Activate: Main/Battle][Limit 1] If your Leader's character name includes <Son Goten>, <Trunks>, or <Gotenks>: Add up to 1 card with <Son Goten> in its character name and 1 card with <Trunks> in its character name—both blue and with an energy cost of 3—from your deck or Drop to your hand, then shuffle your deck if you looked through it.", "BT19-066"), "BT19-066");
  assert.deepEqual(b66.conds.map((c) => c.kind === "leaderMatches" && c.filter.charactersIncluding[0]), ["son goten", "trunks", "gotenks"], "B: BT19-066 — any of three inside the Leader's name");
  const b18 = the(record("[auto] If the name of your Leader's back side includes {Super Saiyan Blue Son Goku}: When this card is played, draw 1 card, add up to 1 {Beerus, the Visitor} from your deck to your energy in Rest Mode, then shuffle your deck.", "BT18-053"), "leaderMatches", "BT18-053");
  assert.deepEqual([b18.back, b18.filter.namesIncluding], [true, ["super saiyan blue son goku"]], "C: BT18-053 — the back side's card name");
  const b20 = any(record("[auto][limit 1] If a player's Leader is black: When this card is used in a combo, choose up to 1 of your cards and it gets +10000 power for the battle.", "BT20-121"), "BT20-121");
  assert.deepEqual(b20.conds.map((c) => c.kind === "leaderMatches" && (c.side ?? "you")), ["you", "opponent"], "C: BT20-121 — either Leader");
  const p411 = conds(record("[activate: main][once per turn] If no player has a Leader with its front side facing up and your opponent has 3 or more energy: This card gets +16000 power and [critical] until the start of your next Main Phase.", "P-411")).filter((c) => c.kind === "leaderFlipped");
  assert.deepEqual(p411.map((c) => c.kind === "leaderFlipped" && [c.side ?? "you", c.flipped]), [["you", true], ["opponent", true]], "C: P-411 — both Leaders awakened");
  const p176 = the(record("[Activate: Battle] If your Leader Card is a ≪Shenron≫ card: Choose one- ・If your Leader Card has 10000 power and you have 5 or less life, your Leader Card gets +5000 power for the duration of the turn. ・Choose your Leader Card or 1 of your Battle Cards and it gets +5000 power for the duration of the battle.", "P-176"), "power", "P-176");
  assert.deepEqual([p176.atLeast, p176.atMost], [10000, 10000], "C: P-176 — exactly 10000 power");
  const b24 = any(record("[activate: main][limit 1]{r}, if your Leader is a mono-red <Son Goku> card and {Son Gohan, Awakened Hidden Power} is under your Leader or your opponent's Leader: Add up to 1 {Power Pole} from your Drop to your hand and play this card from your hand.", "BT24-008"), "BT24-008");
  assert.deepEqual(b24.conds.map((c) => c.kind === "count" && c.sel.underHost?.side), ["you", "opponent"], "C: BT24-008 — either Leader's pile");
  const b19 = record("[Activate: Main][Limit 1] If a red <Son Goku> <Vegeta> <Trunks: Future> Leader is under your Z-Leader: Choose up to 1 of your red <Son Goku> Z-Leaders and it gets +30000 power and [Critical] for the turn.", "BT19-030");
  const pile = the(b19, "count", "BT19-030");
  assert.deepEqual([pile.sel.area, pile.sel.filter?.type, pile.sel.filter?.charactersAll], ["under", "LEADER", ["son goku", "vegeta", "trunks: future"]], "C: BT19-030 — one Leader with all three names");
  const zLeader = b19.ops.find((o): o is Extract<Op, { op: "choose" }> => o.op === "choose");
  assert.equal(zLeader?.sel.area, "leader", "C: BT19-030 — your Z-Leaders are the Leader Area");
  const b26 = conds(record("[Activate: Battle][Limit 1]{r}, if your Leader's back side is a red <Super 17> card, you have 2 or more energy, and you have 1 or more <Android 17> card and 1 or more <Hell Fighter 17> card in your Combo Area: Play this card from your hand.", "BT26-023"));
  assert.deepEqual([b26.filter((c) => c.kind === "leaderMatches").length, b26.filter((c) => c.kind === "count").length], [1, 3], "C: BT26-023 — the back side, the energy, and each name in the Combo Area");
  const b29 = conds(record("[activate: battle][limit 1] If it's your opponent's turn, and this card and all of your energy are in Rest Mode: Switch the target of attack to this card.", "BT29-071"));
  assert.ok(b29.some((c) => c.kind === "isTurnPlayer" && c.who === "opponent") && b29.some((c) => c.kind === "every") && b29.some((c) => c.kind === "count" && c.sel.special === "self" && c.sel.mode === "rest"), "C: BT29-071 — their turn, this card and all energy rested");
  records += 9;
}

// D. What the skill's own steps did.
{
  const b20 = the(record("[Counter: Attack][Limit 1] Negate the attack. Additionally,  if the attacker was a ≪Saiyan≫ card, choose up to 1 of your <Super 17> cards and switch it to Active Mode.", "BT20-083", { type: "EXTRA" }), "count", "BT20-083");
  assert.deepEqual([b20.sel.special, b20.sel.filter?.traits.map((x) => x.toLowerCase())], ["attacker", ["saiyan"]], "D: BT20-083 — the attacker");
  const b15 = record("[Counter: Attack] Negate the attack and play this card in Rest Mode. If the attacking card is a ≪Great Ape≫ or ≪Demon Clan≫ Battle Card, choose it, KO it, and your opponent draws 1 card.", "BT15-080");
  const ko = b15.ops.find((o): o is Extract<Op, { op: "if" }> => o.op === "if")!;
  const chosen = ko.then.find((o): o is Extract<Op, { op: "choose" }> => o.op === "choose");
  assert.equal(chosen?.sel.battleRole, "attacker", "D: BT15-080 — \"choose it\" is the attacking card");
  assert.ok(ko.then.some((o) => o.op === "ko"), "D: BT15-080 — …and it is KO'd");
  const b1 = conds(only("[Auto] [Once per turn] When your Battle Card attacks a Leader Card, if the attacking card has 15000 or more power, draw 1 card.", "BT1-001")).length;
  void b1;
  const p570 = conds(record("[Auto][Once per turn] When you play a red <Beerus> or <Whis> card, if the played card is a <Beerus> card, this card gets +5000 power for the turn. If the played card is a <Whis> card, choose up to 1 of your opponent's Battle Cards and switch it to Rest Mode.", "P-570")).filter((c) => c.kind === "count" && c.sel.special === "subject");
  assert.ok(p570.length >= 2, "D: P-570 — the played card, each name");
  const tb1 = record("[Auto] [Once per turn] When you attack with a ≪Saiyan≫ Battle Card, if that card is ≪Universe 7≫ or ≪Universe 6≫, draw 1 card and choose the attacking card. The chosen card and this card gain +5000 power for the duration of the turn.", "TB1-001", { type: "LEADER" });
  const tb1If = tb1.ops.find((o): o is Extract<Op, { op: "if" }> => o.op === "if");
  assert.ok(tb1If && tb1If.cond.kind === "count" && tb1If.cond.sel.special === "attacker", "D: TB1-001 — \"that card\" is the attacker");
  assert.equal(tb1If!.then.filter((o) => o.op === "power").length, 2, "D: TB1-001 — the +5000s are the condition's (\"the chosen card\" points back)");
  for (const [what, text, to] of [
    ["BT4-106", "[Auto] When this card attacks, your opponent chooses 1 card from their hand and sends it to their Warp. If that card was a Battle Card, combo with it in your Combo Area.", "warp"],
    ["BT3-073", "[Auto] When you play this card, your opponent chooses 1 card from their hand and places it in the Drop Area. If that card is a Battle Card with an energy cost of 4 or more, draw 1 card.", "drop"],
  ] as const) {
    const rec = record(text, what);
    const pick = rec.ops.find((o): o is Extract<Op, { op: "choose" }> => o.op === "choose");
    assert.deepEqual([pick?.chooser, pick?.sel.area, (rec.ops.find((o) => o.op === "moveTo") as Extract<Op, { op: "moveTo" }> | undefined)?.to], ["opponent", "hand", to], `D: ${what} — their choice, then the move`);
    assert.ok(conds(rec).some((c) => c.kind === "varMatches" && c.var === pick!.as && c.filter.type === "BATTLE"), `D: ${what} — that card is asked`);
    records++;
  }
  const b2 = the(record("[Activate: Main] [Once per turn] Place up to 3 cards from the top of your deck in the Drop Area. If there was 1 or more ≪Frieza Clan≫ among them, this card gains +5000 power for the duration of the turn.", "BT2-101"), "any", "BT2-101");
  assert.equal(b2.conds.length, 3, "D: BT2-101 — any of the three cards placed");
  const b30 = the(record("[auto][limit 1] If your Leader is blue: When this card is played, place the top 5 cards of your deck into your Drop. Additionally, if 1 or more ≪Earthling≫ cards are placed into your Drop by this skill, add the top card of your deck to your energy in Rest Mode.", "BT30-031"), "count", "BT30-031", (c) => !!c.sel.fromVar);
  assert.deepEqual([b30.sel.area, b30.sel.filter?.traits.map((x) => x.toLowerCase())], ["drop", ["earthling"]], "D: BT30-031 — the placed cards");
  assert.equal(the(record("[auto] When this card is played, choose a total of up to 7 of your opponent's Battle Cards and/or Unisons and they get -10000 power for the turn. Additionally, if you chose 5 or more cards with this skill, this card gets +10000 power and [double strike] for the turn.", "BT19-149"), "chose", "BT19-149").atLeast, 5, "D: BT19-149 — 5 or more chosen");
  for (const [what, text] of [
    ["P-306", "[Activate: Main] Choose this card and 1 of your <Trunks: Xeno> cards and send them to their owners' Warps: Choose up to 1 <Gotenks: Xeno> card with an energy cost of 3 from your hand or Warp and play it. If you played that card from your hand, draw 1 card."],
    ["EX23-18", "[activate: main][limit 1]{u}, if your Leader's back side is {SSB Vegito, Godhood Transcended} and you send this card from your Drop to your Warp: Play up to 1 {Gogeta, Pursuit of Power} with 1 marker on it from your hand or Drop. Additionally, if you played it from your hand, draw 1 card."],
  ] as const) {
    const rec = record(text, what);
    assert.ok(conds(rec).some((c) => c.kind === "did" && c.what === "play") && conds(rec).some((c) => c.kind === "choseFrom" && c.areas[0] === "hand"), `D: ${what} — played, from the hand`);
    records++;
  }
  assert.ok(conds(record("[+1][Activate: Main] If your Leader Card is mono-blue: You may switch this card to Rest Mode. If you do, choose up to 1 blue skill-less Battle Card with an energy cost of 2 in your energy and play it; if you played it, place the top card of your deck in your energy in Rest Mode at the end of the turn.", "EX17-01")).some((c) => c.kind === "did" && c.what === "play"), "D: EX17-01 — the play");
  assert.equal(the(record("[Auto] If your Leader's back side is {Frieza, Resurrected}: When this card is played, you may add 1 mono-yellow ≪Frieza's Army≫ card or mono-yellow Unison from your hand to your life face up. If you added a card to your life, draw 1 card, and place 1 card from your life in your Drop.", "EX21-30"), "count", "EX21-30", (c) => !!c.sel.fromVar).sel.area, "life", "D: EX21-30 — the card in the life");
  const p108 = conds(record("[Auto] When this card is KO'd, if your Leader Card is a blue <Gogeta: Br> card, choose up to 1 red <Son Goku: Br> card and 1 red <Vegeta: Br> card from your Drop Area and add them to your hand. If you added 2 cards to your hand, add 2 cards from the top of your deck to your energy.", "P-108")).filter((c) => c.kind === "count" && c.sel.fromVar && c.sel.area === "hand");
  assert.equal(p108.length, 2, "D: P-108 — each choice's card in the hand");
  assert.equal(the(record("[Auto][Once per turn] When this card attacks, you may send 1 card in your opponent's life to their Warp for every 10 cards in their Warp. If you sent cards from your opponent's life to their Warp, send 1 card from your life to your Warp.", "P-289"), "count", "P-289", (c) => !!c.sel.fromVar).sel.area, "warp", "D: P-289 — the cards in their Warp");
  assert.equal(the(record("[activate: main][limit 1]{u}{u}{u}{u}, place 1 blue Battle Card with an energy cost of 5 or more into its owner's Drop: Play this card from your hand. Additionally, if the card placed into its owner's Drop by this skill is a ≪Phantom Demon≫ card, draw 2 cards.", "P-628"), "count", "P-628", (c) => !!c.sel.fromVar).sel.filter?.traits[0]?.toLowerCase(), "phantom demon", "D: P-628 — the price's card");
  const sd17 = the(record("[Auto][Once per turn] When you play a Battle Card, choose it, and it gets +5000 power for the turn. If this raises that card's power to 20000 or more, draw 1 card.", "SD17-01", { type: "LEADER" }), "power", "SD17-01");
  assert.deepEqual([!!sd17.sel.fromVar, sd17.atLeast], [true, 20000], "D: SD17-01 — that card's power after the raise");
  const b16 = the(record("[Auto] If your Leader Card is a ≪Universe 7≫ card: When this card is played, choose up to 1 of your opponent's Battle Cards and it gets -15000 power for the turn. Additionally, if this skill reduces the chosen card's power to 0 or less, draw 1 card.", "BT16-006"), "power", "BT16-006");
  assert.deepEqual([!!b16.sel.fromVar, b16.atMost], [true, 0], "D: BT16-006 — 0 or less after the reduction");
  assert.equal(the(record("[Auto] If your Leader Card is yellow: When you play this card, choose up to 1 of your opponent's Battle Cards and negate its skills for the duration of the turn. If the chosen card is in Rest Mode, it can't be switched to Active Mode during your opponent's next Charge Phase.", "BT9-066"), "count", "BT9-066", (c) => !!c.sel.fromVar).sel.mode, "rest", "D: BT9-066 — the chosen card rested");
  const b7 = the(record("[Activate: Main] Choose up to 1 black Battle Card with an energy cost of 4 or less in your Warp and play it. If the Battle Card played with this skill has [Over Realm] or [Dark Over Realm], choose up to 2 of your energy and switch them to Active Mode.", "BT7-108", { type: "EXTRA" }), "varMatches", "BT7-108");
  assert.ok(matches(card("AC3_DOR", { skill: "[Dark Over Realm 7] (blah)" }), b7.filter) && !matches(card("AC3_NOR", { skill: "[Blocker]" }), b7.filter), "D: BT7-108 — [Over Realm] of either kind");
  assert.equal(the(record("[Activate: Main] [Once per turn] Place a card from the top of your deck under this card: If 7 or more cards are placed under this card, this card gains [Triple Strike] for the duration of the turn.", "BT6-030"), "count", "BT6-030").atLeast, 7, "D: BT6-030 — the pile under this card");
  const ex08 = conds(record("[Activate: Battle] If your Leader Card is a <Zamasu> card and it's your opponent's turn: Choose one- ・Choose up to 1 of your opponent's Battle Cards with an energy cost of 3 or less, place it in your opponent's energy in Rest Mode, then if you placed an opponent's card in their energy, at the end of the turn your opponent chooses 1 of their energy and places it in its owner's Drop Area. ・Draw 1 card, then choose 1 card in your opponent's hand, place it in their energy in Rest Mode, then if you placed an opponent's card in their energy, at the end of the turn your opponent chooses 1 of their energy and places it in its owner's Drop Area.", "EX08-02", { type: "EXTRA" })).filter((c) => c.kind === "count" && c.sel.fromVar && c.sel.area === "energy");
  assert.equal(ex08.length, 1, "D: EX08-02 — each mode asks the card it placed (the same question, deduplicated)");
  // "This card can only attack or be used in a combo if …" (BT22-013): two bans, each with the escape.
  const b22 = record("[Permanent] This card can only attack or be used in a combo if your Leader is a red <Son Gohan: SH> card.", "BT22-013").ops.filter((o): o is Extract<Op, { op: "forbid" }> => o.op === "forbid");
  assert.deepEqual(b22.map((o) => [o.what, o.unless?.kind]), [["attack", "leaderMatches"], ["combo", "leaderMatches"]], "D: BT22-013 — no attack and no combo unless the Leader is one");
  // EX23-50, EX23-45: colours other than black among black multicolour cards — black is always one of them.
  const ex50 = the(record("[Permanent] If there are 2 or less non-black colors present among black multicolor cards in your energy, this card gets -6000 power.", "EX23-50"), "count", "EX23-50");
  assert.deepEqual([ex50.sel.distinctColors, ex50.sel.filter?.colors, ex50.sel.filter?.multiColor, ex50.atMost], [true, ["Black"], true, 3], "D: EX23-50 — 2 others and black");
  // BT14-013: only this card and one red skill-less Battle Card in the Combo Area.
  const b14 = conds(record("[Auto] If your Leader Card is a mono-red ≪Universe 7≫ card, and you only have this card and 1 red skill-less Battle Card in your Combo Area: When this card is used in a combo, draw 1 card.", "BT14-013"));
  assert.ok(b14.some((c) => c.kind === "count" && c.sel.area === "combo" && c.atLeast === 2 && c.atMost === 2), "D: BT14-013 — exactly two cards in the Combo Area");
  records += 26;
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  AC3_TAPION: card("AC3_TAPION", { characters: ["Tapion"] }),
  AC3_GOKU: card("AC3_GOKU", { characters: ["Son Goku"] }),
  AC3_ZCARD: card("AC3_ZCARD", { type: "Z-BATTLE" as CardDef["type"] }),
  AC3_PAN: card("AC3_PAN", { colors: ["Green"], characters: ["Pan"] }),
  AC3_GTGOKU: card("AC3_GTGOKU", { colors: ["Green"], characters: ["Son Goku: GT"] }),
};
const ctx: EngineContext = { ...CTX, defs };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const take = (s: VmState, action: Action): VmState => roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
/** p1's Main Phase, every hand and Energy Area emptied back into the decks. */
function fresh(): VmState {
  let s = RULES.createGame(ctx, { seed: 31, p1: { name: "First", leader: "L-BLUE", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false },
    { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null },
  ] as Action[])
    s = take(s, action);
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string, under?: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p, ...(under ? { under } : {}) }).ok);
  if (area === "battle" || area === "energy") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
const holds = (s: VmState, cond: Cond, self?: string) => condHolds(ctx, game, s, { ops: [], ip: 0, vars: {}, card: self ?? s.sides.p1.zones.leader[0], master: "p1" }, cond);
const whole = (rec: Rec): Cond => ({ kind: "all", conds: conds(rec) });
let cases = 0;
{
  // BT4-032: <Tapion> in the Drop or the Warp, either.
  const tapion = whole(record("[Permanent] If <Tapion> is in your Drop Area or Warp, this card gains [Double Strike] and [Barrier].", "BT4-032"));
  let s = fresh();
  assert.equal(holds(s, tapion), false, "VM: BT4-032 — no <Tapion>");
  stage(s, "p1", "AC3_TAPION", "warp");
  assert.equal(holds(s, tapion), true, "VM: BT4-032 — one in the Warp");
  s = fresh();
  stage(s, "p1", "AC3_TAPION", "drop");
  assert.equal(holds(s, tapion), true, "VM: BT4-032 — one in the Drop");
  s = fresh();
  stage(s, "p2", "AC3_TAPION", "drop");
  assert.equal(holds(s, tapion), false, "VM: BT4-032 — your opponent's is not yours");
  cases += 4;
  // P-456: seven cards across four places, counted together; six are not enough.
  const total = whole(record("[Permanent] If you have a total of 7 or more cards in your energy, Z-Energy, Battle Area, and Drop, reduce this card's energy cost in your hand by 2.", "P-456"));
  s = fresh();
  for (const area of ["energy", "energy", "battle", "battle", "drop", "drop"]) stage(s, "p1", "V1", area);
  assert.equal(holds(s, total), false, "VM: P-456 — six cards");
  stage(s, "p1", "V1", "drop");
  assert.equal(holds(s, total), true, "VM: P-456 — seven across the places");
  cases += 2;
  // BT26-136: a Z-Card in the Battle Area answers; one in the Drop does not.
  const zc = conds(record("[activate: main/battle][limit 1]{1}, if your Leader is a red or green ≪Android≫ card, you have 3 or more energy, and you have a Z-Card in your Leader Area, Battle Area, or Unison Area: Play this card from your hand.", "BT26-136")).find((c) => c.kind === "count" && c.sel.filter?.z)!;
  s = fresh();
  stage(s, "p1", "AC3_ZCARD", "drop");
  assert.equal(holds(s, zc), false, "VM: BT26-136 — a Z-Card in the Drop");
  stage(s, "p1", "AC3_ZCARD", "battle");
  assert.equal(holds(s, zc), true, "VM: BT26-136 — a Z-Card in the Battle Area");
  cases += 2;
  // BT20-060: green <Pan> cards count; a green <Son Goku: GT> does not (the aside's "without").
  const pan = whole(record("[permanent] While there are 3 or more <Pan> cards and/or cards with <GT> in their character names—both green and without <Son Goku: GT>—in your Z-Energy, Battle Area, and Drop, this card gains [double strike] and [dual attack].", "BT20-060"));
  s = fresh();
  stage(s, "p1", "AC3_PAN", "battle");
  stage(s, "p1", "AC3_PAN", "drop");
  stage(s, "p1", "AC3_GTGOKU", "drop");
  assert.equal(holds(s, pan), false, "VM: BT20-060 — a <Son Goku: GT> is not counted");
  stage(s, "p1", "AC3_PAN", "drop");
  assert.equal(holds(s, pan), true, "VM: BT20-060 — three <Pan> cards");
  cases += 2;
  // DB2-123: this card is the only card in the hand.
  const lone = conds(record("[Auto] If your opponent has 4 or more energy: At the start of your Charge Phase, if this card is the only card in your hand, you may play this card from your hand.", "DB2-123")).filter((c) => c.kind === "count" && c.sel.area === "hand");
  s = fresh();
  const me = stage(s, "p1", "V1", "hand");
  assert.equal(holds(s, { kind: "all", conds: lone }, me), true, "VM: DB2-123 — alone in the hand");
  stage(s, "p1", "V1", "hand");
  assert.equal(holds(s, { kind: "all", conds: lone }, me), false, "VM: DB2-123 — another card beside it");
  cases += 2;
  // BT15-149: face-up life cards of both Life Areas, three together.
  const faceUp = conds(record("[Permanent] If your Leader Card is a ≪Turles Crusher Corps≫ card and there are 3 or more face-up life cards between you and your opponent, negate this card's [Energy-Exhaust] skill in all areas.", "BT15-149")).find((c) => c.kind === "count" && c.sel.side === "both")!;
  s = fresh();
  s.cards[s.sides.p1.zones.life[0]].faceUp = true;
  s.cards[s.sides.p2.zones.life[0]].faceUp = true;
  assert.equal(holds(s, faceUp), false, "VM: BT15-149 — two face up");
  s.cards[s.sides.p2.zones.life[1]].faceUp = true;
  assert.equal(holds(s, faceUp), true, "VM: BT15-149 — three between both players");
  cases += 2;
}
// Battles: BT22-056's attacker and guard, BT27-050's two Battle Cards, EX19-14's other card.
{
  const broly = card("AC3_BROLY", { characters: ["Broly"] });
  defs.AC3_BROLY = broly;
  const b22 = whole(record("[Permanent] During a battle in which your <Broly> card is attacking a Battle Card, your opponent can't activate [Counter] skills.", "BT22-056"));
  const s = fresh();
  const attacker = stage(s, "p1", "AC3_BROLY", "battle");
  const theirs = stage(s, "p2", "V-BLUE", "battle");
  const battle = (a: string, g: string) => ({ attacker: a, guard: g, target: g, step: "attack", negated: false, blockerOffered: false, counters: [] }) as unknown as VmState["battle"];
  s.battle = battle(attacker, s.sides.p2.zones.leader[0]);
  assert.equal(holds(s, b22), false, "VM: BT22-056 — attacking the Leader");
  s.battle = battle(attacker, theirs);
  assert.equal(holds(s, b22), true, "VM: BT22-056 — attacking a Battle Card");
  const b27 = whole(record("[Activate: Battle][Once per turn] If this card is in a battle with a Battle Card: Switch this card to Active Mode and it gets +10000 power for the battle.", "BT27-050"));
  assert.equal(holds(s, b27, attacker), true, "VM: BT27-050 — this card and a Battle Card");
  s.battle = battle(attacker, s.sides.p2.zones.leader[0]);
  assert.equal(holds(s, b27, attacker), false, "VM: BT27-050 — this card and a Leader");
  const ex19 = whole(record("[0][Activate: Battle] If another card is in a battle: Use up to 1 Green/Yellow multicolor card from your Drop Area in a combo with its skills negated for the battle.", "EX19-14", { type: "UNISON" }));
  assert.equal(holds(s, ex19, theirs), true, "VM: EX19-14 — a battle of other cards");
  s.battle = null as unknown as VmState["battle"];
  assert.equal(holds(s, ex19, theirs), false, "VM: EX19-14 — no battle");
  cases += 6;
}

// EX23-50: colours other than black among black multicolour energy.
{
  const ex50 = whole(record("[Permanent] If there are 2 or less non-black colors present among black multicolor cards in your energy, this card gets -6000 power.", "EX23-50"));
  defs.AC3_BR = card("AC3_BR", { colors: ["Black", "Red"] });
  defs.AC3_BU = card("AC3_BU", { colors: ["Black", "Blue"] });
  defs.AC3_BG = card("AC3_BG", { colors: ["Black", "Green"] });
  const s = fresh();
  assert.equal(holds(s, ex50), true, "VM: EX23-50 — no black multicolour energy: no other colours");
  stage(s, "p1", "AC3_BR", "energy");
  stage(s, "p1", "AC3_BU", "energy");
  assert.equal(holds(s, ex50), true, "VM: EX23-50 — red and blue: two");
  stage(s, "p1", "AC3_BG", "energy");
  assert.equal(holds(s, ex50), false, "VM: EX23-50 — red, blue and green: three");
  cases += 3;
}
// BT3-073: the opponent's discarded card, asked — a cost-4 Battle Card draws, a cost-1 one does not.
{
  defs.AC3_DISC = card("AC3_DISC", { skill: "[Activate: Main] Your opponent chooses 1 card from their hand and places it in the Drop Area. If that card is a Battle Card with an energy cost of 4 or more, draw 1 card." });
  defs.AC3_COST4 = card("AC3_COST4", { energyCost: 4 });
  for (const [what, cost, draws] of [["AC3_COST4", 4, 1], ["V1", 1, 0]] as const) {
    const ctx2: EngineContext = { ...ctx, defs, scripts: rulesFromRows(roundtrip(Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow))), defs) };
    let s = fresh();
    const a = stage(s, "p1", "AC3_DISC", "battle");
    stage(s, "p2", what, "hand");
    const offer = RULES.legalActions(ctx2, s).find((l) => l.action.type === "activate" && l.action.card === a);
    assert.ok(offer, `VM: BT3-073 (${cost}) — offered`);
    s = roundtrip(RULES.apply(ctx2, roundtrip(s), offer!.action).state as VmState);
    for (let i = 0; i < 20 && s.prompt.kind !== "main"; i++) {
      const q = s.prompt as { kind: string; player: PlayerId; choice?: { candidates: string[]; min: number } };
      const act = q.kind === "chooseCards" ? { type: "choose", player: q.player, cards: q.choice!.candidates.slice(0, Math.max(1, q.choice!.min)) } : { type: "pass", player: q.player };
      s = roundtrip(RULES.apply(ctx2, roundtrip(s), act as Action).state as VmState);
    }
    assert.equal(s.sides.p2.zones.drop.length, 1, `VM: BT3-073 (${cost}) — their card is in the Drop`);
    assert.equal(s.sides.p1.zones.hand.length, draws, `VM: BT3-073 (${cost}) — ${draws ? "a draw" : "no draw"}`);
    cases++;
  }
}

console.log(`audit-conditions-3: ${records} records, ${cases} VM cases — ok`);
