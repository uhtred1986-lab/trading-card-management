/**
 * Audit triggers 1 (2 Nov 2026): the wrong-trigger findings of the readings audit — an [Auto] answering the wrong
 * moment or only part of it. Printed text inline (catalog text of the snapshot of 2 Nov 2026; costs, powers and
 * companions in the VM cases are synthetic).
 *
 * A.  Several moments in one sentence (9-6-2): each read alone, the skill answering to every one; a moment no reader
 *     places, or a condition one moment alone would carry, leaves the skill unread. Descriptions of a watched card.
 * B.  The battle's end (8-5): the combo card's own end of the battle with its areas; this card's part in a plain one.
 * C.  Played, combo areas, a described KO'd card, Z-Energy, the removed area, BT10-038's "if" moment, a reminder; this
 *     card KO'd by an attack, by your opponent, or by a skill (whose, and a described card's); a [Counter] by its window.
 * D.  The VM, both seats: a watched and a self coordinated moment, a described KO'd card, a KO by a described card's
 *     skill, and a [Permanent]'s standing power change starting to apply (R-132, R-134; Q&A BT13-002).
 *
 * Rulings: R-132 (owner), R-133, R-134 and R-135 (pending, best-guess).
 *
 * Review: the whole head's own reading dropped once a head is read one by one (BT16-131); "would" not split (SD12-01);
 * R-135 for "KO'd or removed … by an opponent's skill"; BT25-113's typo; "the attacking Battle Cards" is the attacker
 * (P-409, P-203); the removed area only from an area (Q&A BT27-094, 23-2-5-1).
 */
import assert from "node:assert/strict";
import { pendStandingPower } from "../../src/lib/arena/vm/host";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { matchTriggers } from "../../src/lib/arena/vm/triggers";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { correctSkillText } from "../../src/lib/catalog/errata";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Cond } from "../../src/lib/arena/vm/script";
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
const only = (text: string, what: string, o: Partial<CardDef> = {}): Rec => {
  const recs = skillRecords(card(what, { skill: text, ...o }));
  assert.equal(recs.length, 1, `${what}: one record`);
  return recs[0];
};
/** The record of `text`, read whole, through the stored-row round trip and the language's print and reparse. */
function record(text: string, what: string, o: Partial<CardDef> = {}): Rec {
  const rec = only(text, what, o);
  assert.deepEqual(rec.unread, [], `${what}: nothing unread (${rec.unread.join(" | ")})`);
  const rule = asRule(rec);
  assert.equal(validateRule(rule, rec.kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  assert.deepEqual(plain(round.value), plain(rule), `${what}: …unchanged`);
  return roundtrip(rec);
}
const flat = (c: Cond | null | undefined): Cond[] => (!c ? [] : c.kind === "all" ? c.conds.flatMap(flat) : [c]);
const chain = (rec: Rec): Cond[] => {
  const out = flat(rec.cond);
  for (let at = rec.ops; at.length === 1 && at[0].op === "if" && !at[0].else; at = at[0].then) out.push(...flat(at[0].cond));
  return out;
};
const combo = (rec: Rec) => (rec as unknown as { combo?: { timing: string; origins: string[] | null } | null }).combo ?? null;
const unreadOf = (text: string, what: string) => only(text, what).unread;
let records = 0;
const DRAW = "draw 1 card.";

// A. Several moments in one sentence.
const A: [string, string, string[], ((rec: Rec) => void)?][] = [
  ["[auto] When this card attacks or is attacked, choose up to 1 blue battle card in your Drop Area and combo with it.", "BT2-042", ["attacks", "attacked"]],
  ["[Auto][Once per turn] When this card attacks or is attacked, you may choose 1 card in your hand and place it in your Drop Area. If you do, choose up to 1 Battle Card in your Drop Area that is both red and green, and combo with it in your Combo Area.", "P-130", ["attacks", "attacked"]],
  ["[Auto][Limit 1] If it's your turn: When this card attacks or is used in a combo, choose up to 1 of your opponent's Battle Cards and add it to its owner's hand.", "BT22-051", ["attacks", "comboUsed"], (rec) => assert.deepEqual(combo(rec)?.origins, null, "A: BT22-051 — any combo")],
  ["[auto][limit 1] If your Leader is a red <Cooler> card: When this card attacks or is used in a combo from your hand, you may use 1 Red/Blue multicolor card from your hand in a combo. If you do, draw 1 card.", "EX23-04", ["attacks", "comboUsed"], (rec) => assert.deepEqual(combo(rec)?.origins, ["hand"], "A: EX23-04 — the combo from the hand")],
  [`[Auto] When this card is played or used in a combo, ${DRAW}`, "BT13-067", ["played", "comboUsed"]],
  [`[Auto] When this card is played or used in a combo from your deck or hand, ${DRAW}`, "BT13-069", ["played", "comboUsed"], (rec) => assert.deepEqual(combo(rec)?.origins, ["deck", "hand"], "A: BT13-069 — the combo from the deck or hand (R-133)")],
  [`[Auto] When you play this card or combo with it from your hand, ${DRAW}`, "P-169", ["played", "comboUsed"], (rec) => assert.deepEqual(combo(rec)?.origins, ["hand"], "A: P-169 — the combo from the hand, the play from anywhere (R-133)")],
  [`[auto] When you play this card or use it in a combo from your hand, ${DRAW}`, "EB1-64", ["played", "comboUsed"]],
  ["[auto] When this card is KO'd or removed from a Battle Area by an opponent's skill, draw 1 card.", "BT23-056", ["koed", "removedByOpponent"]],
  ["[Auto] When this card is KO'd or is removed from your Battle Area by an opponent's skill, choose up to 1 multicolor Extra Card in your Drop Area and add it to your hand.", "BT9-026", ["koed", "removedByOpponent"]],
  ["[Auto] When this card is KO'd or KOs an opponent's Battle Card, choose up to 1 Red/Blue multicolor Extra Card in your Drop Area or Warp and add it to your hand.", "BT9-013", ["koed", "kos"]],
  ["[auto][once per turn] When this card KOs an opponent's Battle Card or activates its [blocker] skill, switch this card to Active Mode.", "EX16-10", ["kos", "blockerUsed"]],
  [`[Auto] When this card activates its [Blocker] skill or is removed from your Battle Area by an opponent's skill, ${DRAW}`, "BT12-079", ["removedByOpponent", "blockerUsed"]],
  [`[Auto] When this card is removed from your Battle Area by an opponent's skill or activates its [Blocker] skill, ${DRAW}`, "BT13-097", ["removedByOpponent", "blockerUsed"]],
  [`[auto] When this card attacks or is placed in your Drop Area from your Battle Area by a skill, ${DRAW}`, "BT9-118", ["attacks", "droppedFromBattle"]],
  ["[Auto] When this card attacks or is removed from your Battle Area by a skill, look at up to 3 cards from the top of your opponent's deck and put them back in any order.", "DB2-051", ["attacks", "removedFromBattle"]],
  [`[Auto] When this card is KO'd or placed in a Drop Area from a Battle Area by an opponent's skill, ${DRAW}`, "P-143", ["koed", "droppedByOpponent"]],
  // watched moments, and this card's beside another's
  [`[Auto] When your opponent plays a card or attacks, ${DRAW}`, "BT21-021", ["opponentPlayed", "opponentAttacks"]],
  ["[Auto] When your opponent's Battle Card is played or attacks, your Leader and this card get +5000 power for the turn.", "BT29-004", ["opponentPlayed", "opponentAttacks"], (rec) => {
    const c = chain(rec).find((x) => x.kind === "count" && x.sel.special === "subject");
    assert.ok(c?.kind === "count" && c.sel.filter?.type === "BATTLE", "A: BT29-004 — a Battle Card, either moment's");
  }],
  ["[Auto] When your opponent plays a card or at the end of your opponent's turn, you may KO this card.", "BT21-074", ["opponentTurnEnd", "opponentPlayed"]],
  [`[auto] [once per turn] When this card attacks or your opponent plays a Battle Card, ${DRAW}`, "BT4-016", ["attacks", "opponentPlayed"], (rec) => {
    const c = chain(rec).find((x) => x.kind === "any");
    assert.ok(c?.kind === "any" && c.conds[0].kind === "not" && c.conds[1].kind === "count" && c.conds[1].sel.filter?.type === "BATTLE", `A: BT4-016 — the Battle Card asked only of a card handed on (${JSON.stringify(c).slice(0, 160)})`);
  }],
  [`[Auto] When one of your Battle Cards is KO'd or removed from your Battle Area by an opponent's skill, ${DRAW}`, "BT22-087", ["yourCardKoed", "yourCardRemovedByOpponent"]],
  [`[Auto] When one of your <Goku Black> is added to your Z-Energy or this card attacks, ${DRAW}`, "EX22-05", ["attacks", "yourCardToZEnergy"]],
];
for (const [text, what, trigger, more] of A) {
  const rec = record(text, what);
  assert.deepEqual(rec.trigger, trigger, `A: ${what} answers ${trigger.join(", ")} (${JSON.stringify(rec.trigger)})`);
  more?.(rec);
  records++;
}
// BT31-006's catalog typo is corrected where a sync stores it.
assert.equal(correctSkillText("BT31-006", "[auto] When your red Z-Card is palyed or attacks, play 1 Ghost Token with 15000 power in Rest Mode."), "[auto] When your red Z-Card is played or attacks, play 1 Ghost Token with 15000 power in Rest Mode.", "A: BT31-006 — errata");
assert.deepEqual(record(`[auto] When your red Z-Card is played or attacks, ${DRAW}`, "BT31-006").trigger, ["youPlayed", "yourCardAttacks"], "A: BT31-006 — both moments");
records += 2;
// Unread rather than half read.
for (const [text, what, why] of [
  [`[Auto] When this card attacks or one of your energy is added to your Z-Energy, ${DRAW}`, "EX22-05x", "a moment no reader places"],
  ["[auto][once per turn] If your Leader Card is a red ≪Saiyan≫ card: When this card KOs one of your opponent's Battle Cards with an original energy cost of 2 or more or is removed from your Battle Area by an opponent's skill, deal 1 damage to your opponent.", "BT13-017", "a described KO'd card on one moment"],
  ["[Auto] If it's your opponent's turn: At the end of the battle for this card or at the end of the turn, play 1 Majin Token in Rest Mode (Majin Tokens have 15000 power, 0 combo cost, and 5000 combo power), then remove this card from the game.", "BT25-039", "this card's battle on one moment"],
] as const) {
  assert.ok(unreadOf(text, what).length > 0, `A: ${what} — unread (${why})`);
  records++;
}

// Review of audit triggers 1: what the whole head's readers made of coordinated words is dropped once the moments are
// read one by one (BT16-131 answered every play); a replacement's "would" (9-10) is not split into moments.
assert.deepEqual(only("[Auto] When this card is played from your hand or at the end of a battle in which this card was used in a combo from your hand, add up to 1 skill-less Battle Card with an energy cost of 2 from your deck or Drop Area to your hand, then shuffle your deck if you looked through it.", "BT16-131").trigger, ["playedFromHand", "comboed"], "A: BT16-131 — the play from the hand, never every play");
for (const [text, what] of [
  ["[Auto] If it's your opponent's turn: When one of your blue Unison Cards would be placed in your Drop Area or one of your blue Battle Cards is removed from your Battle Area by an opponent's skill or KO'd, you may flip this card over. If you do, draw 2 cards.", "SD12-01"],
  ["[Auto][Limit 1] If your Leader is a red <Warriors of Universe 7> card, and you send 1 ≪Universe 7≫ card and this card from your Drop to your Warp: When one of your ≪Universe 7≫ cards would be removed from your Battle Area by an opponent's skill or KO'd, draw 1 card.", "BT20-141"],
] as const) {
  const rec = only(text, what);
  assert.deepEqual(rec.trigger, [], `A: ${what} — "would" is a replacement's wording, no moment (${JSON.stringify(rec.trigger)})`);
  assert.ok(rec.unread.length > 0, `A: ${what} — unread`);
  records++;
}
// R-135 (pending): "KO'd or removed from a Battle Area by an opponent's skill" — any KO, the cause the removal's. BT25-113's
// typo ("by and opponent's skill") is corrected where a sync stores it, and its two moments are read.
const bt25113 = correctSkillText("BT25-113", "[Auto] When this card is removed from a Battle Area by and opponent's skill or KO'd, play up to 1 {Three-Star Ball, Negative Energy Overflow} from your Drop.");
assert.equal(bt25113, "[Auto] When this card is removed from a Battle Area by an opponent's skill or KO'd, play up to 1 {Three-Star Ball, Negative Energy Overflow} from your Drop.", "A: BT25-113 — errata");
assert.deepEqual(record(bt25113, "BT25-113").trigger, ["koed", "removedByOpponent"], "A: BT25-113 — both moments (R-135)");
records += 2;
// "…choose up to 1 of the attacking Battle Cards" is the battle's attacker (8-1), never one of your own Battle Cards.
for (const [text, what, sel] of [
  ["[auto]{u}, if your Leader is mono-blue and you discard this card from your hand: When one of your Battle Cards is KO'd by an opponent's attack, choose up to 1 of the attacking Battle Cards and place it on top of its owner's deck.", "P-409", '{"special":"attacker","count":1,"upTo":true}'],
  ["[counter: battle card attack] Choose the attacking Battle Card, KO it, then play this card.", "P-203", '{"special":"attacker"}'],
] as const) {
  const rec = only(text, what);
  assert.deepEqual(rec.unread, [], `A: ${what} — read (${rec.unread.join(" | ")})`);
  // Integration 2: audit-selectors-1 reads the same phrase with the noun kept as a filter (the attacking *Battle Card*),
  // so the record is checked by its shape, not its exact JSON.
  const want = JSON.parse(sel) as { count?: number; upTo?: boolean };
  const found: { count?: number; upTo?: boolean }[] = [];
  const walk = (x: unknown): void => {
    if (!x || typeof x !== "object") return;
    const o = x as { sel?: { special?: string } };
    // Integration 2 (R-204): a choice of the attacker is a battle-role choice, so [Barrier] is asked.
    if (o.sel?.special === "attacker" || (o.sel as { battleRole?: string } | undefined)?.battleRole === "attacker") found.push(o.sel as { count?: number; upTo?: boolean });
    Object.values(x).forEach(walk);
  };
  walk(rec.ops);
  const got = found[0];
  assert.ok(got && !!got.upTo === !!want.upTo && (got.count ?? 1) === (want.count ?? 1) && !JSON.stringify(rec.ops).includes('"side":"you","area":"battle"'), `A: ${what} — the attacker${sel.includes("upTo") ? ", up to 1" : ""}, not one of your Battle Cards (${rec.reads})`);
  records++;
}

// B. The battle's end.
const B: [string, string, string[], ((rec: Rec) => void)?][] = [
  [`[Auto] At the end of a battle in which this card is used in a combo from your hand or energy, ${DRAW}`, "BT13-046", ["comboed"], (rec) => assert.deepEqual([combo(rec)?.timing, combo(rec)?.origins], ["battleEnd", ["hand", "energy"]], "B: BT13-046 — its areas")],
  [`[Auto] At the end of a battle where this card was used in a combo from your life, ${DRAW}`, "BT12-020", ["comboed"], (rec) => assert.deepEqual(combo(rec)?.origins, ["life"], "B: BT12-020 — from the life")],
  [`[Auto] At the end of a battle where this card is used in a combo from your Battle Area, ${DRAW}`, "EX13-25", ["comboed"], (rec) => assert.deepEqual(combo(rec)?.origins, ["battle"], "B: EX13-25 — from a Battle Area")],
  [`[Auto] At the end of a battle where this card was used in a combo, ${DRAW}`, "EB1-03", ["comboed"], (rec) => assert.deepEqual(combo(rec)?.origins, null, "B: EB1-03 — any combo")],
  [`[auto][limit 2] If it's your turn: When this card attacks or at the end of a battle in which this card was used in a combo from your hand, ${DRAW}`, "EX17-03", ["attacks", "comboed"], (rec) => assert.deepEqual([combo(rec)?.timing, combo(rec)?.origins], ["battleEnd", ["hand"]], "B: EX17-03 — the combo moment's areas")],
  [`[Auto] At the end of the battle for this card, ${DRAW}`, "BT25-041", ["battleEnd"], (rec) => assert.ok(chain(rec).some((c) => c.kind === "inBattle" && c.sel.special === "self" && !c.role), "B: BT25-041 — in the battle")],
  [`[Auto] At the end of a battle in which this card attacked, ${DRAW}`, "BT17-045", ["battleEnd"], (rec) => assert.ok(chain(rec).some((c) => c.kind === "inBattle" && c.sel.special === "self" && c.role === "attacker"), "B: BT17-045 — attacking")],
  [`[Auto] At the end of the battle after this card attacks, ${DRAW}`, "BT2-071", ["battleEnd"], (rec) => assert.ok(chain(rec).some((c) => c.kind === "inBattle" && c.role === "attacker"), "B: BT2-071 — attacking")],
  [`[Auto] At the end of a battle in which this card was attacked, ${DRAW}`, "BT24-057", ["battleEnd"], (rec) => assert.ok(chain(rec).some((c) => c.kind === "inBattle" && c.role === "guard"), "B: BT24-057 — attacked")],
  [`[auto] At the end of a battle in which your red <Android 18> Battle Card attacked, ${DRAW}`, "BT23-024", ["battleEnd"], (rec) => {
    const c = chain(rec).find((x) => x.kind === "inBattle");
    assert.ok(c?.kind === "inBattle" && c.role === "attacker" && c.sel.side === "you" && c.sel.filter?.characters.includes("Android 18"), "B: BT23-024 — your red <Android 18> attacking");
  }],
];
for (const [text, what, trigger, more] of B) {
  const rec = record(text, what);
  assert.deepEqual(rec.trigger, trigger, `B: ${what} answers ${trigger.join(", ")} (${JSON.stringify(rec.trigger)})`);
  more?.(rec);
  records++;
}
for (const [text, what] of [
  ["[Auto] At the end of a battle in which this card attacked a <Hit> card in your opponent's Battle Area, KO that card.", "BT16-056"],
  ["[auto] At the end of a battle where this card was played, choose up to 1 of your opponent's Battle Cards and it gets -10000 power for the turn.", "SD17-05"],
] as const) {
  assert.ok(unreadOf(text, what).length > 0, `B: ${what} — a qualifier no reader keeps: unread`);
  records++;
}

// C. Played, combo areas, a described KO'd card, Z-Energy, the removed area, BT10-038, a reminder.
const C: [string, string, string[], ((rec: Rec) => void)?][] = [
  [`[auto] When you play this card with [over realm], ${DRAW}`, "BT4-112", ["playedUsingOverRealm"]],
  [`[Auto] When you play this card from a Drop Area, ${DRAW}`, "TB3-039", ["playedFromDrop"]],
  [`[Auto] When you play this card from your hand and your Leader Card is a ≪Universe 6≫ card, ${DRAW}`, "XD1-04", ["playedFromHand"], (rec) => assert.ok(chain(rec).some((c) => c.kind === "leaderMatches"), "C: XD1-04 — the Leader condition kept")],
  [`[Auto] When you combo with this card from a Battle Area, ${DRAW}`, "BT5-085", ["comboUsed"], (rec) => assert.deepEqual(combo(rec)?.origins, ["battle"], "C: BT5-085 — from a Battle Area")],
  [`[Auto] When you combo with this card from your Drop Area, ${DRAW}`, "XD3-05", ["comboUsed"], (rec) => assert.deepEqual(combo(rec)?.origins, ["drop"], "C: XD3-05 — from the Drop")],
  [`[Auto] When this card attacks and KOs an opponent's Battle Card with an energy cost of 2 or more, ${DRAW}`, "P-384", ["kos"], (rec) => {
    const c = chain(rec).find((x) => x.kind === "count" && x.sel.special === "subject");
    assert.ok(c?.kind === "count" && c.sel.filter?.costMin === 2 && c.sel.filter.type === "BATTLE", "C: P-384 — the KO'd card described");
  }],
  [`[Auto] If all of your energy is mono-blue: When one of your blue Battle Cards is added to your Z-Energy, ${DRAW}`, "BT19-034b", ["yourCardToZEnergy"], (rec) => assert.ok(chain(rec).some((c) => c.kind === "count" && c.sel.special === "subject" && c.sel.filter?.colors.includes("Blue")), "C: BT19-034b — a blue Battle Card")],
  [`[Auto] If your Leader is black: When this card is placed in a Battle Area or removed from the game, ${DRAW}`, "BT27-094", ["placed", "removedFromGame"]],
  ["[Auto] If this card is removed from a Battle Area by an opponent's skill, choose up to 1 {SSB Son Goku, Hope for Victory} in your hand and place it in your energy.", "BT10-038", ["removedByOpponent"]],
  ["[auto] When a card evolves into this card, this card gains [dual attack] (Once per turn, when this card attacks, switch this card to Active Mode after the battle) for the duration of the turn.", "SD1-03", ["evolvedInto"]],
  // KO'd, and how (5-12, 8-4-6-2)
  [`[Auto] When this card is KO'd by an opponent's attack, ${DRAW}`, "BT15-071", ["koedByAttack"]],
  [`[auto] {1}: When this card is KO'd by your opponent, ${DRAW}`, "BT15-006", ["koedByOpponent"]],
  [`[Auto] When this card is KO'd by an opponent's skill, ${DRAW}`, "BT20-078", ["koedByOpponentSkill"]],
  [`[Auto] When this card is KO'd by one of your skills, ${DRAW}`, "BT23-039", ["koedByYourSkill"]],
  [`[Auto] When this card is KO'd by a <Vegeta> card's skill, ${DRAW}`, "BT25-051", ["koedBySkill"], (rec) => assert.ok(chain(rec).some((c) => c.kind === "count" && c.sel.special === "subject" && c.sel.filter?.characters.includes("Vegeta")), "C: BT25-051 — a <Vegeta> card's skill")],
  [`[Auto] If your Leader is a blue <Majin Buu> card: When this card is KO'd by an opponent's attack or placed in your Drop by an opponent's skill, ${DRAW}`, "EX21-05", ["koedByAttack", "toDropByOpponent"]],
  [`[Auto] When this card is KO'd, ${DRAW}`, "KO", ["koed"]],
  [`[auto]{u}: When one of your Battle Cards is KO'd by an opponent's attack, ${DRAW}`, "P-409", ["yourCardKoedByAttack"], (rec) => assert.ok(chain(rec).some((c) => c.kind === "count" && c.sel.special === "subject" && c.sel.filter?.type === "BATTLE"), "C: P-409 — one of your Battle Cards")],
  [`[Auto] When one of your yellow <Son Gohan: Future> cards is KO'd by an opponent's attack or removed from your Battle Area by one of their skills, ${DRAW}`, "BT13-103", ["yourCardKoedByAttack", "yourCardRemovedByOpponent"]],
  // a [Counter] by its window (22-10-2-1)
  ["[Auto] When your opponent activates a [Counter: Play] skill, they choose 2 cards in their hand and discard them.", "EX13-19", ["opponentCounterPlay"]],
  [`[Auto][Once per turn] When your opponent activates a [Counter: Attack] skill, ${DRAW}`, "BT12-059", ["opponentCounterAttack"]],
  [`[Auto] When your opponent activates a [Counter] skill, ${DRAW}`, "BT7-020", ["opponentCounter"]],
  // a card played on the other side, whoever played it
  [`[Auto][Once per turn] If it's your turn: When a skill-less Battle Card or skill-less Unison Card is played in your opponent's Battle Area or Unison Area, ${DRAW}`, "BT15-122", ["opponentPlayed"], (rec) => {
    const c = chain(rec).find((x) => x.kind === "count" && x.sel.special === "subject");
    assert.ok(c?.kind === "count" && c.sel.filter?.anyOf?.every((f) => f.skillLess), "C: BT15-122 — skill-less, either kind (its Q&A)");
  }],
];
for (const [text, what, trigger, more] of C) {
  const rec = record(text, what);
  assert.deepEqual(rec.trigger, trigger, `C: ${what} answers ${trigger.join(", ")} (${JSON.stringify(rec.trigger)})`);
  more?.(rec);
  records++;
}
for (const [text, what] of [
  ["[Auto] When you activate this card's [Villainous], negate this card's skills for the game.", "BT19-007"],
  // an area the combo card came from, which no watched combo asks
  [`[Auto][Once per turn] When you use a blue card from your hand in a combo, ${DRAW}`, "BT19-035"],
  [`[auto] When you combo with a ≪Universe 7≫ from your Battle Area during your turn, ${DRAW}`, "TB1-025"],
  [`[auto] [limit 1] When this card is added to your Z-Energy by your <Gogeta: Br> card's skill, ${DRAW}`, "P-727"],
] as const) {
  assert.ok(unreadOf(text, what).length > 0, `C: ${what} — unread`);
  records++;
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  V2: card("V2", { energyCost: 2 }),
  KOTHEIRS: card("KOTHEIRS", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
  BOUNCE: card("BOUNCE", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and return it to its owner's hand." }),
  W_YOURS: card("W_YOURS", { skill: `[Auto] When one of your Battle Cards is KO'd or removed from your Battle Area by an opponent's skill, ${DRAW}` }),
  W_SELF: card("W_SELF", { skill: `[Auto] When this card is KO'd or removed from your Battle Area by an opponent's skill, ${DRAW}` }),
  KOER: card("KOER", { skill: `[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it.\n[Auto] When this card KOs an opponent's Battle Card with an energy cost of 2 or more, ${DRAW}` }),
  BROLY: card("BROLY", { energyCost: 0, skill: "[Permanent] Your opponent's Battle Cards get -5000 power." }),
  FREE: card("FREE", { energyCost: 0 }),
  W_THEIRS: card("W_THEIRS", { skill: `[Auto] When the power of one of your opponent's Battle Cards is decreased, ${DRAW}` }),
  VEGKO: card("VEGKO", { characters: ["Vegeta"], skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
  W_BYVEGETA: card("W_BYVEGETA", { skill: `[Auto] When this card is KO'd by a <Vegeta> card's skill, ${DRAW}` }),
  RFG: card("RFG", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and remove it from the game." }),
  STRONG: card("STRONG", { power: 30000 }),
  W_ATTACKED: card("W_ATTACKED", { skill: `[Auto] At the end of a battle in which this card attacked, ${DRAW}` }),
  W_P409: card("W_P409", { skill: "[Auto] When one of your Battle Cards is KO'd by an opponent's attack, choose up to 1 of the attacking Battle Cards and place it on top of its owner's deck." }),
  W_RFG: card("W_RFG", { skill: `[Auto] When this card is removed from the game, ${DRAW}` }),
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
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
type Prompt = VmState["prompt"];
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
const hand = (s: VmState, p: PlayerId) => s.sides[p].zones.hand.length;
const pick = (...ids: string[]) => ({ cards: (q: Extract<Prompt, { kind: "chooseCards" }>) => { const got = ids.filter((id) => q.choice.candidates.includes(id)).slice(0, q.choice.max); return got.length ? got : undefined; } });
function activate(s: VmState, c: string, steer: Parameters<typeof settle>[1] = {}): VmState {
  const offer = RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && parseSkills(defs[s.cards[c].cardId].skill!).find((sk) => sk.index === (l.action as { skill: number }).skill)?.kind.startsWith("activate"));
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), steer);
}
function play(s: VmState, seat: PlayerId, c: string): VmState {
  const offer = RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && (l.action as { card?: string }).card === c);
  assert.ok(offer, `${s.cards[c].cardId}: playable`);
  return settle(take(s, offer.action));
}

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 52200 + n * 2 + (seat === "p1" ? 0 : 1);

  // D1. A watched pair: one of their Battle Cards KO'd, or removed by your (their opponent's) skill — their watcher answers both.
  for (const [actor, n, extra] of [["KOTHEIRS", 0, 0], ["BOUNCE", 1, 1]] as const) {
    let s = fresh(seat, seed(n));
    const a = stage(s, seat, actor, "battle");
    stage(s, foe, "W_YOURS", "battle");
    const t = stage(s, foe, "V-BLUE", "battle");
    s = activate(s, a, pick(t));
    assert.equal(hand(s, foe), 1 + extra, `${seat}: D1: their card ${actor === "KOTHEIRS" ? "KO'd" : "returned to the hand"} — their watcher drew (${actor === "KOTHEIRS" ? "yourCardKoed" : "yourCardRemovedByOpponent"})`);
    cases++;
  }
  // D2. This card's own pair: KO'd, or removed by an opponent's skill.
  for (const [actor, n, extra] of [["KOTHEIRS", 2, 0], ["BOUNCE", 3, 1]] as const) {
    let s = fresh(seat, seed(n));
    const a = stage(s, seat, actor, "battle");
    const w = stage(s, foe, "W_SELF", "battle");
    s = activate(s, a, pick(w));
    assert.equal(hand(s, foe), 1 + extra, `${seat}: D2: ${actor === "KOTHEIRS" ? "KO'd (koed)" : "returned to the hand (removedByOpponent)"} — it answered`);
    cases++;
  }
  // D3. A KO by this card of a described card: an energy cost of 2 answers, of 1 does not (9-6-2).
  for (const [target, n, drew] of [["V2", 4, 1], ["V-BLUE", 5, 0]] as const) {
    let s = fresh(seat, seed(n));
    const k = stage(s, seat, "KOER", "battle");
    const t = stage(s, foe, target, "battle");
    s = activate(s, k, pick(t));
    assert.ok(s.sides[foe].zones.drop.includes(t), `${seat}: D3: KO'd`);
    assert.equal(hand(s, seat), drew, `${seat}: D3: KO'd a card with an energy cost of ${target === "V2" ? 2 : 1} — ${drew ? "answers" : "no trigger"}`);
    cases++;
  }
  // D3b. KO'd by a <Vegeta> card's skill only (the card that KO'd it is the moment's subject).
  for (const [actor, n, drew] of [["VEGKO", 7, 1], ["KOTHEIRS", 8, 0]] as const) {
    let s = fresh(seat, seed(n));
    const k = stage(s, seat, actor, "battle");
    const w = stage(s, foe, "W_BYVEGETA", "battle");
    s = activate(s, k, pick(w));
    assert.ok(s.sides[foe].zones.drop.includes(w), `${seat}: D3b: KO'd`);
    assert.equal(hand(s, foe), drew, `${seat}: D3b: by ${actor} — ${drew ? "answers (koedBySkill)" : "no trigger (9-6-2)"}`);
    cases++;
  }
  // D4. A standing power change starting to apply (R-132, R-134): playing the [Permanent] answers once per card it
  // lowers; it going on applying does not.
  {
    let s = fresh(seat, seed(6));
    stage(s, seat, "W_THEIRS", "battle");
    stage(s, foe, "V-BLUE", "battle");
    stage(s, foe, "V-BLUE", "battle");
    const broly = stage(s, seat, "BROLY", "hand");
    const free = stage(s, seat, "FREE", "hand");
    // Staging turns deck cards into the listener mid-game; in a game it is in the deck from the start and every
    // checkpoint has looked (`pendStandingPower` looks only once some card can answer). Take that look now.
    pendStandingPower(ctx, game, s, []);
    s = play(s, seat, broly);
    assert.equal(hand(s, seat), 1 + 2, `${seat}: D4: Broly played — two of theirs lowered, two moments (Q&A BT13-002)`);
    s = play(s, seat, free);
    assert.equal(hand(s, seat), 2, `${seat}: D4: …and it going on applying is no moment`);
    cases += 2;
  }
  // D5. Removed from the game (20-10) from a Battle Area answers; a card under another card answers to no area-movement
  // [Auto] (23-2-5-1; Q&A BT27-094, removed from under BT27-069), and a pile card's move names no area it came from.
  {
    let s = fresh(seat, seed(9));
    const r = stage(s, seat, "RFG", "battle");
    const w = stage(s, foe, "W_RFG", "battle");
    s = activate(s, r, pick(w));
    assert.ok(s.sides[foe].zones.removed.includes(w), `${seat}: D5: removed from the game`);
    assert.equal(hand(s, foe), 1, `${seat}: D5: from a Battle Area — it answered (removedFromGame)`);
    const fromPile = matchTriggers(game, s, { event: "moved", card: w, controller: foe, args: { to: "removed", asPlay: false, cause: "effect" } });
    assert.ok(!fromPile.some((m) => m.trigger === "removedFromGame"), `${seat}: D5: from under a card — no moment (23-2-5-1)`);
    cases += 2;
  }
  // D6. P-409's wording: one of their Battle Cards KO'd by an attack — "the attacking Battle Cards" is the attacker, back
  // on top of its owner's deck (never one of the watcher's own Battle Cards).
  {
    let s = fresh(seat, seed(10));
    const atk = stage(s, seat, "STRONG", "battle");
    const watcher = stage(s, foe, "W_P409", "battle");
    const guard = stage(s, foe, "V-BLUE", "battle");
    s.cards[guard].mode = "rest";
    s = settle(take(s, { type: "attack", player: seat, attacker: atk, target: guard } as Action));
    assert.ok(s.sides[foe].zones.drop.includes(guard), `${seat}: D6: their Battle Card KO'd by the attack`);
    assert.equal(s.sides[seat].zones.deck[0], atk, `${seat}: D6: the attacker on top of its owner's deck (yourCardKoedByAttack)`);
    assert.ok(s.sides[foe].zones.battle.includes(watcher), `${seat}: D6: …and the watcher's own Battle Card stays`);
    cases++;
  }
  // D7. "At the end of a battle in which this card attacked" (BT17-045): the copy that attacked answers, the copy beside
  // it does not — read as a plain end of the battle, both did.
  {
    let s = fresh(seat, seed(11));
    const a1 = stage(s, seat, "W_ATTACKED", "battle");
    stage(s, seat, "W_ATTACKED", "battle");
    s = settle(take(s, { type: "attack", player: seat, attacker: a1, target: s.sides[foe].zones.leader[0] } as Action));
    assert.equal(hand(s, seat), 1, `${seat}: D7: only the attacker answered the battle's end (inBattle attacker)`);
    cases++;
  }
}

console.log(`verify/audit-triggers-1: ok (${records} records, ${cases} VM cases across both seats)`);
