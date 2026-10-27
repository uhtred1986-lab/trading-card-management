/**
 * Phrasing batch 1 (26 Oct 2026): wordings of the open production rules that
 * needed no new engine mechanism, only the compiler's phrase readers. One
 * representative card per cluster, printed text inline (catalog text of the
 * open-rules export of 26 Oct 2026; costs, powers and companions are synthetic):
 *
 *  1. price conditions — "you or your opponent has 3 or more energy" (BT26-079),
 *     "your Leader Card and energy are all yellow" (P-305), "a <Trunks: SH> card
 *     is in your Z-Energy" (BT19-054), "a player has a [field] Extra Card in their
 *     Battle Area" (BT15-073), "your Leader has both <Shroom> and <Salsa>"
 *     (P-654), "a green card with both <Zamasu> and <Goku Black> and you have …"
 *     (BT23-092, the "and" of "both A and B" is no joint), "this card is in a
 *     Combo Area" (BT23-016), "a total of 3 or more energy between you and your
 *     opponent" (EX19-28), both lives added up (BT10-012), either life
 *     (DB3-122), "your life is less than or equal to your opponent's" (BT15-067),
 *     "a Battle Card with 30000 power or more in play" (BT25-009), "on its front
 *     side" / "its front side is facing up" (EX13-24, P-473);
 *  2. the cards just looked at, put back — "place them on top of their deck in
 *     any order" (BT22-114), "place it at the top or bottom of their deck"
 *     (BT22-093), a chosen card "at the top or bottom of your deck" (BT12-029),
 *     "at the bottom of your opponent's deck" (BT5-045);
 *  3. "the card sent to the Warp by this skill" in a delayed step (BT13-025,
 *     EX24-24, P-150), "they reveal their hand" (BT13-024), "when you play a
 *     Battle Card on your turn" (BT13-026);
 *  4. the Leader flipped to its back side (BT26-067, BT31-066, P-473, EX19-08);
 *  5. "…to your Z-Energy with its skills negated for the turn" (BT26-068);
 *  6. power wordings — "your card that's in a battle" (BT22-057), "an
 *     additional +10000 power" (BT6-103), "+15000 power and has its skills
 *     negated for the battle" (BT15-030), "+5000 and [Critical]" (P-025), "it
 *     also gains [Double Strike]" (BT12-083), "when you play a red ≪Alien≫, it
 *     gains …" (BT1-006);
 *  7. back references — "if the KO'd card was …" (BT25-097), "if the card you
 *     switched to Rest Mode has …" (BT12-113), "if the card you placed in the
 *     Drop Area with this skill was blue" (BT2-034), "if its power is 20000 or
 *     more" (BT3-001);
 *  8. this card's own price from another area — "you place this card at the
 *     bottom of your deck from your Warp" (P-288), used from the Warp (#1118).
 *
 * Proved here: the records (nothing unread, the stored-row JSON round trip, the
 * rules language's print and reparse), what stays unread on purpose, and in the
 * VM for both seats with every action reloaded from JSON: the delayed return of
 * the card sent to the Warp (3), the looked card to the bottom (2), the Leader
 * flip (4), the KO'd-card condition (7) and both lives counted together (1).
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { usableFrom } from "../../src/lib/arena/vm/activate";
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
    // A selector over several areas is read by its `areas` alone ("read instead of it when present"), and the
    // language prints only those: "5 or more cards in Rest Mode" (`restAnywhere`, SD8-08) keeps `area: "battle"`.
    if (k === "area" && Array.isArray(this.areas)) return undefined;
    return x;
  }));
/** The one record of `text` (one line), read whole, through the stored-row round trip and the language's print and reparse. */
function record(text: string, what: string, o: Partial<CardDef> = {}): Rec {
  const recs = skillRecords(card(what, { skill: text, ...o }));
  assert.equal(recs.length, 1, `${what}: one record`);
  assert.deepEqual(recs[0].unread, [], `${what}: nothing unread`);
  const rule = asRule(recs[0]);
  assert.equal(validateRule(rule, recs[0].kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  assert.deepEqual(plain(round.value), plain(rule), `${what}: …unchanged`);
  return roundtrip(recs[0]);
}
const unreadOf = (text: string) => skillRecords(card("U", { skill: text }))[0].unread;
/** The record's conditions, the price's and the effect's, flattened out of `all`. */
const conds = (r: Rec): Cond[] => {
  const flat = (c: Cond | null | undefined): Cond[] => (!c ? [] : c.kind === "all" ? c.conds.flatMap(flat) : [c]);
  // A price's condition is also hoisted onto the record (`hoist`): each condition once.
  const all = [...flat(r.cost?.condition as Cond | null), ...flat(r.cond)];
  return all.filter((c, i) => all.findIndex((d) => JSON.stringify(d) === JSON.stringify(c)) === i);
};
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "chooseMode" ? o.modes.flatMap((m) => opsDeep(m.ops)) : [])]);
let records = 0;

// 1. price conditions
const BT26_079 = "[Activate: Main/Battle][Limit 1]{g}, if your Leader is a green <Zamasu> card and you or your opponent has 3 or more energy: Play this card from your hand, then place the top card of your opponent's deck into its owner's Drop.";
{
  const either = conds(record(BT26_079, "BT26-079")).find((c) => c.kind === "any");
  assert.ok(either && either.kind === "any");
  assert.deepEqual(either.conds, [{ kind: "count", sel: { side: "you", area: "energy" }, atLeast: 3 }, { kind: "count", sel: { side: "opponent", area: "energy" }, atLeast: 3 }], "BT26-079: either player's 3 energy");
  records++;
}
const P_305 = "[auto][burst 1]{y}, if your Leader Card and energy are all yellow: When this card is used in a combo from your hand, choose up to 1 of your opponent's Battle Cards or Unison Cards and switch it to Rest Mode.";
{
  const [leader, energy] = conds(record(P_305, "P-305"));
  assert.ok(leader.kind === "leaderMatches" && leader.filter.colors.join() === "Yellow", "P-305: the Leader is yellow");
  assert.ok(energy.kind === "every" && energy.sel.area === "energy" && energy.matching.filter?.colors.join() === "Yellow", "…and all of your energy is yellow");
  records++;
}
const BT19_054 = "[activate: main][limit 1]{u}, if a <Trunks: SH> card is in your Z-Energy: Play this card from your hand.";
{
  const [z] = conds(record(BT19_054, "BT19-054"));
  assert.ok(z.kind === "count" && "side" in z.sel && z.sel.side === "you" && z.sel.area === "zEnergy" && z.sel.filter?.characters.join() === "trunks: sh" && z.atLeast === 1, "BT19-054: a <Trunks: SH> card in your Z-Energy");
  records++;
}
const BT15_073 = "[activate: main]{g}{g}, if a player has a [field] Extra Card in their Battle Area: Play this card from your hand.";
{
  const [f] = conds(record(BT15_073, "BT15-073"));
  assert.ok(f.kind === "count" && f.sel.side === "both" && f.sel.area === "battle" && f.sel.filter?.type === "EXTRA" && f.sel.filter.keywords.join() === "Field", "BT15-073: a [Field] Extra in either Battle Area");
  records++;
}
const P_654 = "[activate: main][limit 1]{b}, if your Leader has both <Shroom> and <Salsa> and you have 3 or more energy: Play this card from your hand, and your opponent sends 3 Battle Cards from their Drop to their owner's Warp.";
const BT23_092 = "[activate: battle][limit 1] If your Leader is a green card with both <Zamasu> and <Goku Black> and you have a <Zamasu> card in your Combo Area: Use this card in a combo from your Drop.";
{
  const [leader, energy] = conds(record(P_654, "P-654"));
  assert.ok(leader.kind === "leaderMatches" && leader.filter.charactersAll.join() === "shroom,salsa", "P-654: a Leader with both names");
  assert.deepEqual(energy, { kind: "count", sel: { side: "you", area: "energy" }, atLeast: 3 });
  const [both, combo] = conds(record(BT23_092, "BT23-092"));
  assert.ok(both.kind === "leaderMatches" && both.filter.colors.join() === "Green" && both.filter.charactersAll.join() === "zamasu,goku black", "BT23-092: green, both names");
  assert.ok(combo.kind === "count" && "side" in combo.sel && combo.sel.area === "combo" && combo.sel.filter?.characters.join() === "zamasu", "…and a <Zamasu> in your Combo Area");
  records += 2;
}
const BT23_016 = "[activate: battle][limit 1]{1}, if your Leader is a red <Son Gohan: Future> or <Gohanks: Xeno> card and this card is in a Combo Area: Choose up to 1 of your red <Son Gohan: Future> or <Trunks: Future> cards and it gains [double strike] for the battle.";
{
  const own = conds(record(BT23_016, "BT23-016")).find((c) => c.kind === "count");
  assert.deepEqual(own, { kind: "count", sel: { special: "self", area: "combo", side: "you" }, atLeast: 1 }, "BT23-016: this card is in your Combo Area");
  records++;
}
const EX19_28 = "[auto]{b}, if your Leader Card is a black ≪Saiyan≫ card and there's a total of 3 or more energy between you and your opponent: At the end of a battle in which this card was used in a combo from your hand, play this card from your Drop Area in Rest Mode, then choose up to 1 of your opponent's Battle Cards with an energy cost of 3 or less and return it to its owner's hand.";
{
  assert.ok(conds(record(EX19_28, "EX19-28")).some((c) => c.kind === "count" && c.sel.side === "both" && c.sel.area === "energy" && c.atLeast === 3), "EX19-28: one count over both Energy Areas");
  records++;
}
const BT10_012 = "[Auto] If your Leader Card is red and you and your opponent have a total of 8 or less life: When this card is used in a combo, draw 1 card, then if it's your turn, choose up to 1 red ≪Earthling≫ card with an energy cost of 1 in your hand and play it.";
const DB3_122 = "[activate: main]{r}{y}{2}, if you or your opponent's life is at 2 or less: Play this card from your hand.";
const BT15_067 = "[activate: main][limit 1] {g}, if your opponent has 3 or more energy and your life is less than or equal to your opponent's: Choose up to 1 {Kaio-Ken Son Goku, Decisive Battle} in your hand and play it on top of this card.";
{
  assert.ok(conds(record(BT10_012, "BT10-012")).some((c) => c.kind === "life" && c.side === "both" && c.atMost === 8), "BT10-012: both lives added up");
  assert.deepEqual(conds(record(DB3_122, "DB3-122")), [{ kind: "any", conds: [{ kind: "life", side: "you", atMost: 2 }, { kind: "life", side: "opponent", atMost: 2 }] }], "DB3-122: either life");
  assert.ok(conds(record(BT15_067, "BT15-067")).some((c) => c.kind === "lifeVsOpponent" && c.atMost), "BT15-067: your life no more than theirs");
  records += 3;
}
const BT25_009 = "[Activate: Main][Limit 1]{r}{r}, if your Leader is red and you or your opponent have a Battle Card with 30000 power or more in play: Play up to 1 red skill-less Battle Card from your Drop, and play this card from your hand.";
{
  const either = conds(record(BT25_009, "BT25-009")).find((c) => c.kind === "any");
  assert.ok(either?.kind === "any" && either.conds.every((x) => x.kind === "count" && x.sel.filter?.powerMin === 30000 && x.sel.filter.type === "BATTLE"), "BT25-009: a Battle Card with 30000 power or more, for either player — the \"or more\" is the measure's");
  records++;
}
const EX13_24 = "[Activate: Main] If your Leader Card is a yellow <Boujack> card on its front side, you have 2 or more energy, and you discard this card from your hand: Flip your Leader Card to its back side, then draw 2 cards.";
const P_473 = "[Activate: Main] If your Leader's back side is a {Majin Buu, Leader of the Agents of Destruction}, its front side is facing up, you have 6 or less life, and you have 2 or more energy: Flip 1 of your Leaders to its back side, draw 2 cards, and remove this card from the game.";
{
  const r = record(EX13_24, "EX13-24");
  assert.ok(conds(r).some((c) => c.kind === "leaderFlipped" && c.flipped === false), "EX13-24: the Leader shows its front side");
  assert.deepEqual(r.ops[0], { op: "flip", target: { sel: { special: "leader" } }, to: "back" }, "…and is flipped to its back");
  const p = record(P_473, "P-473");
  const kinds = conds(p).map((c) => c.kind);
  assert.deepEqual(kinds, ["leaderMatches", "leaderFlipped", "life", "count"], "P-473: all four requirements, none swallowed");
  assert.ok(p.ops[0].op === "choose" && "side" in p.ops[0].sel && p.ops[0].sel.area === "leader" && p.ops[0].sel.count === 1 && p.ops[1].op === "flip", "…1 of your Leaders, flipped");
  records += 2;
}

// 2. the cards just looked at
const BT22_114 = "[activate: main/battle] If your Leader is a yellow <Fortuneteller Baba> card: Look at up to 3 cards from the top of your opponent's deck and place them on top of their deck in any order.";
const BT22_093 = "[Activate: Main][Once per turn] If your Leader is a <Fortuneteller Baba> card: Look at up to 1 card from the top of your opponent's deck, then place it at the top or bottom of their deck.";
const BT12_029 = "[Auto][Once per turn] When a card in a Battle Area is returned to its owner's hand by a skill, draw 1 card, then choose 1 card in your hand and place it at the top or bottom of your deck.";
const BT5_045 = "[Auto] When you play this card, you may choose 2 non-black Battle Cards from your opponent's Drop Area and place them at the bottom of your opponent's deck in any order. If you do, draw 1 card.";
{
  const back = record(BT22_114, "BT22-114").ops;
  assert.ok(back.some((o) => o.op === "look") && !back.some((o) => o.op === "moveTo"), "BT22-114: looked at and put back where they were");
  const tb = record(BT22_093, "BT22-093").ops.find((o) => o.op === "chooseMode");
  assert.ok(tb?.op === "chooseMode" && tb.chooser === "you");
  assert.deepEqual(tb.modes.map((m) => m.ops), [[{ op: "moveTo", target: { var: "looked" }, to: "deck", position: "top" }], [{ op: "moveTo", target: { var: "looked" }, to: "deck", position: "bottom" }]], "BT22-093: the looked card to the top or the bottom");
  const chosen = record(BT12_029, "BT12-029").ops;
  const pick = chosen.find((o) => o.op === "choose");
  const end = chosen.find((o) => o.op === "chooseMode");
  assert.ok(pick?.op === "choose" && end?.op === "chooseMode" && end.modes.every((m) => m.ops[0].op === "moveTo" && "var" in m.ops[0].target && m.ops[0].target.var === pick.as), "BT12-029: the chosen card to either end");
  // The offer is the choice (#538); what was chosen moves after it, and nothing moves when it was declined.
  const opp = record(BT5_045, "BT5-045").ops;
  assert.ok(opp[0].op === "may" && opp[0].ops[0].op === "choose" && opp[1].op === "moveTo" && "var" in opp[1].target && opp[1].target.var === opp[0].ops[0].as && opp[1].to === "deck" && opp[1].position === "bottom", "BT5-045: the chosen cards to the bottom of their owner's deck");
  records += 4;
}
// A plural "top or bottom" is one end per card since the owner's ruling of 26 Oct 2026 (phrasing batch 2, proved there).
assert.deepEqual(unreadOf("[Activate: Main][Once per turn] Look at up to 5 cards from the top of your deck and place them on the top and/or bottom of your deck in any order."), [], "BT10-081's \"top and/or bottom\" reads since the ruling");

// 3. the card sent to the Warp by this skill
const BT13_025 = "[auto] If you have 2 or more energy and all of your opponent's energy is in Rest Mode: When this card is played, your opponent reveals their hand. You choose up to 1 Battle Card with 15000 power or less from it and send it to its owner's Warp. At the end of your opponent's next turn, return the card sent to the Warp by this skill to its owner's hand.";
const BT13_024 = "[auto][once per turn] If this card is in Rest Mode: When your opponent attacks a Leader Card, they reveal their hand. Choose up to 1 card from it and send it to their Warp. At the end of the turn, return the card sent to the Warp by this skill to its owner's hand.";
const BT13_026 = "[Auto][Once per turn] When you play a Battle Card on your turn, choose 1 card in your hand and send it to its owner's Warp. At the end of the turn, return the card sent to the Warp by this skill to its owner's hand.";
const EX24_24 = "[Auto] When this card is played, send up to 3 blue cards from your hand to their owner's Warp, then at the end of the turn, add all of the cards sent to their owner's Warp by this skill to their owner's hand.";
{
  const ops = record(BT13_025, "BT13-025").ops;
  const pick = ops.find((o) => o.op === "choose");
  const later = ops.find((o) => o.op === "delay");
  assert.ok(pick?.op === "choose" && later?.op === "delay" && later.at === "turnEnd" && later.scope === "opponentNextTurn");
  assert.deepEqual(later.ops, [{ op: "moveTo", target: { sel: { fromVar: pick.as, area: "warp" } }, to: "hand" }], "BT13-025: the card sent, only while it is still in the Warp");
  const reveal = record(BT13_024, "BT13-024").ops[0];
  assert.deepEqual(reveal, { op: "reveal", sel: { side: "opponent", area: "hand" }, as: "revealed" }, "BT13-024: \"they reveal their hand\" is the whole hand");
  const turn = record(BT13_026, "BT13-026");
  assert.ok(conds(turn).some((c) => c.kind === "isTurnPlayer"), "BT13-026: only a play on your turn");
  const ex = record(EX24_24, "EX24-24").ops.find((o) => o.op === "delay");
  assert.ok(ex?.op === "delay" && ex.ops[0].op === "moveTo" && "sel" in ex.ops[0].target && ex.ops[0].target.sel.area === "warp" && ex.ops[0].to === "hand", "EX24-24: back to the hand from the Warp");
  records += 4;
}
// The opponent's card played into its owner's Battle Area is a play the `play` op cannot place: unread.
assert.ok(unreadOf("[Activate: Main] Choose up to 1 of your opponent's Battle Cards and send it to its owner's Warp; at the end of your opponent's next turn, play the card sent to their Warp with this skill to their Battle Area with its skills negated for the turn.").length > 0, "DB3-112 stays unread");

// 4. the Leader flip
const BT31_066 = "[activate: main] [limit 1] {y}, if your opponent has 2 or more energy: Draw 1 card, play this card from your hand and flip your yellow <Launch> Leader with an original power of 5000 to its back side.";
const EX19_08 = "[Auto][Limit 1] Choose 1 card in your hand and discard it: When this card is played, flip over up to 1 of your blue <Goku Black>-only Leader Cards, and you can't play non-<Zamasu> or non-<Goku Black> Battle Cards for the game.";
{
  const flip = record(BT31_066, "BT31-066").ops.find((o) => o.op === "flip");
  assert.ok(flip?.op === "flip" && "sel" in flip.target && flip.target.sel.area === "leader" && flip.target.sel.filter?.originalPowerMin === 5000 && flip.target.sel.filter.characters.join() === "launch", "BT31-066: your yellow <Launch> Leader of original power 5000");
  const ops = record(EX19_08, "EX19-08").ops;
  assert.ok(ops[0].op === "choose" && ops[0].sel.upTo && "side" in ops[0].sel && ops[0].sel.area === "leader" && ops[1].op === "flip", "EX19-08: up to 1 Leader, flipped");
  records += 2;
}
// (Phrasing batch 7 reads BT28-015's flip to the front side: `phrasing-batch-7.ts`.)

// 5. Z-Energy with its skills negated
const BT26_068 = "[Auto][Limit 1] When this card is played, draw 1 card, then add up to 1 green <Vegeta> card with an energy cost of 4 or less from your Drop to your Z-Energy with its skills negated for the turn.";
{
  const ops = record(BT26_068, "BT26-068").ops;
  const pick = ops.find((o) => o.op === "choose");
  assert.ok(pick?.op === "choose" && "side" in pick.sel && pick.sel.area === "drop");
  assert.deepEqual(ops.slice(-2), [{ op: "moveTo", target: { var: pick.as }, to: "zEnergy" }, { op: "negateSkills", target: { var: pick.as }, until: "turn" }], "BT26-068: added to the Z-Energy, then its skills negated for the turn");
  records++;
}

// 6. power wordings
const BT22_057 = "[auto]{g}, if your {SS Son Gohan & SS Son Goten, Emotions Delivered} is in a battle and you switch this card to Rest Mode: When an [activate: battle] skill activates on your {Family Kamehameha, Emotions Delivered}, your card that's in a battle gets +10000 power and [triple strike] for the battle.";
const BT6_103 = "[Activate: Battle] If your Leader Card is a yellow <Son Gohan: Childhood> card, it gets +10000 power for the duration of the battle, and if your opponent has 5 or more cards in Rest Mode, it gets an additional +10000 power for the duration of the battle.";
const BT15_030 = "[Activate: Battle][Limit 1] Choose one- ・If it's your turn, choose any number of your opponent's Battle Cards that add up to a total power of 30000 or less and KO them. ・Choose up to 1 of your Leader Cards or Unison Cards and it gets +15000 power and has its skills negated for the battle. Additionally, if your Leader Card is a <Broly> card, the chosen card gets an additional +10000 power for the battle.";
const P_025 = "[Activate: Main] [Once per turn] Place 1 card from your hand in the Drop Area: This card gains +5000 and [Critical] (When this card inflicts damage to your opponent's life, they place that many cards in their Drop Area instead of their hand) for the duration of the turn.";
const BT12_083 = "[Activate: Battle] If your Leader Card is a ≪Turles Crusher Corps≫ card, all of your energy is mono-green, and you flip 1 face-up card in your opponent's life face down: Choose up to 1 of your Leader Cards or Battle Cards and it gets +20000 power for the battle; if the chosen card's character name includes <Turles>, it also gains [Double Strike].";
const BT1_006 = "[Auto] When you play a red ≪Alien≫, it gains +5000 power for the duration of the turn.";
{
  const [split] = record(BT22_057, "BT22-057").ops;
  assert.ok(split.op === "if" && split.cond.kind === "isTurnPlayer");
  assert.deepEqual(split.then, [{ op: "power", target: { sel: { special: "attacker" } }, amount: 10000, until: "battle" }, { op: "grant", target: { sel: { special: "attacker" } }, keyword: { name: "Strike", x: 3 }, until: "battle" }], "BT22-057: your card in the battle is the attacking card on your turn");
  assert.deepEqual(split.else, [{ op: "power", target: { sel: { special: "guard" } }, amount: 10000, until: "battle" }, { op: "grant", target: { sel: { special: "guard" } }, keyword: { name: "Strike", x: 3 }, until: "battle" }], "…and the card being attacked on your opponent's");
  const powers = opsDeep(record(BT6_103, "BT6-103").ops).filter((o) => o.op === "power");
  assert.deepEqual(powers.map((o) => o.op === "power" && [o.amount, o.until]), [[10000, "battle"], [10000, "battle"]], "BT6-103: +10000, and an additional +10000, both for the battle");
  const broly = opsDeep(record(BT15_030, "BT15-030").ops).filter((o) => o.op === "power" || o.op === "negateSkills");
  assert.ok(broly.every((o) => (o.op === "power" || o.op === "negateSkills") && o.until === "battle"), "BT15-030: +15000 and the negation both for the battle, and the additional +10000 too");
  assert.deepEqual(record(P_025, "P-025").ops, [{ op: "power", target: { sel: { special: "self" } }, amount: 5000, until: "turn" }, { op: "grant", target: { sel: { special: "self" } }, keyword: { name: "Critical" }, until: "turn" }], "P-025: +5000 power and [Critical]");
  const also = opsDeep(record(BT12_083, "BT12-083").ops).find((o) => o.op === "grant");
  assert.ok(also?.op === "grant" && also.keyword.name === "Strike" && also.keyword.x === 2 && also.until === "battle", "BT12-083: \"it also gains\" lasts as the +20000 did, for the battle");
  const alien = record(BT1_006, "BT1-006");
  assert.deepEqual(alien.ops, [{ op: "power", target: { sel: { special: "subject" } }, amount: 5000, until: "turn" }], "BT1-006: \"it\" is the card you played");
  records += 6;
}

// 7. back references
const BT25_097 = "[Activate: Battle] If you have 4 or more face-up ≪Boujack Brigade≫ cards in your Z-Deck: Choose up to 1 of your opponent's Battle Cards with an energy cost of 2 or less and KO it, then choose up to 1 of your ≪Boujack Brigade≫ cards and it gets +10000 power for the battle. Additionally, if the KO'd card was a ≪Saiyan≫ or ≪Earthling≫ card, draw 1 card.";
const BT12_113 = "[Auto] When this card attacks, choose up to 1 of your opponent's Battle Cards and switch it to Rest Mode; if the card you switched to Rest Mode has an energy cost of 2 or less, KO it.";
const BT2_034 = "[Activate: Main] [Once per turn] Choose 1 card in your life and place it in the Drop Area: If the card you placed in the Drop Area with this skill was blue, draw 1 card.";
const BT3_001 = "[Auto] [Once per turn] When you play a Battle Card, choose that card, and it gains +5000 power for the duration of the turn. Then, if its power is 20000 or more, draw 1 card.";
{
  const ops = record(BT25_097, "BT25-097").ops;
  const ko = ops.find((o) => o.op === "ko");
  const gate = ops.find((o) => o.op === "if");
  assert.ok(ko?.op === "ko" && "var" in ko.target && gate?.op === "if" && gate.cond.kind === "count");
  assert.ok(gate.cond.kind === "count" && gate.cond.sel.fromVar === ko.target.var && gate.cond.sel.area === "drop" && gate.cond.sel.filter?.traits.join() === "saiyan,earthling", "BT25-097: the KO'd card, once in the Drop");
  const sw = record(BT12_113, "BT12-113").ops;
  const turned = sw.find((o) => o.op === "switchMode");
  const ifCheap = sw.find((o) => o.op === "if");
  assert.ok(turned?.op === "switchMode" && "var" in turned.target && ifCheap?.op === "if" && ifCheap.cond.kind === "varMatches" && ifCheap.cond.var === turned.target.var && ifCheap.cond.filter.costMax === 2, "BT12-113: the card switched, energy cost 2 or less");
  const paid = record(BT2_034, "BT2-034");
  const priceCard = paid.cost?.program?.find((o) => o.op === "choose");
  const blue = paid.cond;
  assert.ok(priceCard?.op === "choose" && blue?.kind === "count" && blue.sel.fromVar === priceCard.as && blue.sel.area === "drop" && blue.sel.filter?.colors.join() === "Blue", "BT2-034: the price's card, in the Drop, blue");
  const big = opsDeep(record(BT3_001, "BT3-001").ops).find((o) => o.op === "if");
  assert.ok(big?.op === "if" && big.cond.kind === "power" && big.cond.atLeast === 20000 && big.cond.sel.area === "play", "BT3-001: that card's power now, while in play");
  records += 4;
}

// 8. this card's own price from another area
const P_288 = "[Activate: Main] If your Leader Card is a black ≪Saiyan≫-only card and you place this card at the bottom of your deck from your Warp: If you don't have a Unison Card in play, choose 1 black Unison Card with no specified cost and 15000 power in your hand or Warp and play it with a marker on it; you can't play Unison Cards for the turn.";
{
  const r = record(P_288, "P-288");
  assert.deepEqual(r.cost?.program, [{ op: "moveTo", target: { sel: { special: "self", area: "warp" } }, to: "deck", position: "bottom" }], "P-288: the price takes this card from the Warp to the bottom of the deck");
  const p288 = card("P-288", { skill: P_288 });
  const stored = rulesFromRows(roundtrip(skillRecords(p288).map((x, id) => ({ ...x, id, source: "compiler", status: "draft" }) as unknown as RuleRow)), { "P-288": p288 });
  assert.deepEqual(usableFrom(stored["P-288"].bySkill[0]), ["warp"], "…so the stored line is used from the Warp (#1118)");
  records++;
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  // 3: BT13-026's effect as an [Activate: Main], so the test drives it directly.
  SENDER: card("SENDER", { skill: "[Activate: Main] Choose 1 card in your hand and send it to its owner's Warp. At the end of the turn, return the card sent to the Warp by this skill to its owner's hand." }),
  // 2: BT22-093's effect, ungated.
  BABA: card("BABA", { skill: "[Activate: Main] Look at up to 1 card from the top of your opponent's deck, then place it at the top or bottom of their deck." }),
  // 4: BT26-067's flip, alone.
  FLIPLEAD: card("FLIPLEAD", { skill: "[Activate: Main] Flip your Leader to its back side." }),
  // 7: BT25-097's back reference, with a colour for the description.
  KOER: card("KOER", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it. Additionally, if the KO'd card was a blue card, draw 1 card." }),
  // 1: BT10-012's both lives added up, as the condition of an [Activate: Main]'s price (9-1-3).
  LIVES: card("LIVES", { skill: "[Activate: Main] If your Leader Card is blue and you and your opponent have a total of 8 or less life: Draw 1 card." }),
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
  if (area === "battle" || area === "energy") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
const lineOf = (def: string) => parseSkills(defs[def].skill!)[0].index;
const offerOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === lineOf(s.cards[c].cardId));
type Prompt = VmState["prompt"];
/** Answer every question until the turn player is back at the Main Phase; `mode` answers a "choose one" (0 by default). */
function settle(s0: VmState, steer: { mode?: (q: Extract<Prompt, { kind: "chooseMode" }>) => number; cards?: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[] | undefined } = {}): VmState {
  let s = s0;
  for (let i = 0; i < 60 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: steer.mode?.(q) ?? 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: steer.cards?.(q) ?? q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.equal(s.prompt.kind, "main", `back at the Main Phase (at ${s.prompt.kind})`);
  return s;
}
/** End the seat's turn and run the End Phase, up to the next player's Charge Phase. */
function endTurn(s0: VmState, seat: PlayerId): VmState {
  let s = take(s0, { type: "endMain", player: seat } as Action);
  for (let i = 0; i < 30 && s.turnPlayer === seat; i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.notEqual(s.turnPlayer, seat, "the turn passed");
  return s;
}

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 26100 + n * 2 + (seat === "p1" ? 0 : 1);

  // 3. Sent to the Warp, back to the hand at the end of the turn — and not if it left the Warp first.
  for (const leaves of [false, true]) {
    let s = fresh(seat, seed(leaves ? 1 : 0));
    const sender = stage(s, seat, "SENDER", "battle");
    const sent = stage(s, seat, "V1", "hand");
    const a = offerOf(s, sender);
    assert.ok(a, `${seat}: the line is offered`);
    s = settle(take(s, a.action), { cards: (q) => (q.choice.candidates.includes(sent) ? [sent] : undefined) });
    assert.ok(s.sides[seat].zones.warp.includes(sent), `${seat}: the chosen card is in the Warp`);
    if (leaves) assert.ok(moveCard(s, game, sent, "drop", { owner: seat }).ok);
    s = endTurn(s, seat);
    if (leaves) assert.ok(s.sides[seat].zones.drop.includes(sent) && !s.sides[seat].zones.hand.includes(sent), `${seat}: a card no longer in the Warp is not fetched back from elsewhere`);
    else assert.ok(s.sides[seat].zones.hand.includes(sent), `${seat}: the card sent to the Warp by this skill is back in the hand at the end of the turn`);
    cases++;
  }

  // 2. The looked-at top card of the opponent's deck: kept on top, or put at the bottom.
  for (const bottom of [false, true]) {
    let s = fresh(seat, seed(2 + (bottom ? 1 : 0)));
    const baba = stage(s, seat, "BABA", "battle");
    const deck = s.sides[foe].zones.deck;
    const top = deck[0]; // the top of a deck is its first card (`zones.ts`)
    const a = offerOf(s, baba);
    assert.ok(a, `${seat}: Baba's line is offered`);
    s = settle(take(s, a.action), { mode: (q) => (q.options.length === 2 ? (bottom ? 1 : 0) : 0) });
    const after = s.sides[foe].zones.deck;
    if (bottom) assert.equal(after[after.length - 1], top, `${seat}: the looked-at card is at the bottom of their deck`);
    else assert.equal(after[0], top, `${seat}: the looked-at card is still on top`);
    assert.equal(after.length, deck.length, "the deck keeps its size");
    cases++;
  }

  // 4. The Leader flipped to its back side by a skill (22-2-4).
  {
    let s = fresh(seat, seed(4), "L-RED");
    const leader = s.sides[seat].zones.leader[0];
    assert.ok(!s.cards[leader].flipped);
    const a = offerOf(s, stage(s, seat, "FLIPLEAD", "battle"));
    assert.ok(a, `${seat}: the flip line is offered`);
    s = settle(take(s, a.action));
    assert.ok(s.cards[leader].flipped, `${seat}: the Leader shows its back side`);
    cases++;
  }

  // 7. Draw only when the KO'd card was blue; a red one KO'd draws nothing.
  for (const colour of ["V-BLUE", "V1"] as const) {
    let s = fresh(seat, seed(5 + (colour === "V1" ? 1 : 0)));
    const koer = stage(s, seat, "KOER", "battle");
    const victim = stage(s, foe, colour, "battle");
    const hand0 = s.sides[seat].zones.hand.length;
    const a = offerOf(s, koer);
    assert.ok(a, `${seat}: the KO line is offered`);
    s = settle(take(s, a.action), { cards: (q) => (q.choice.candidates.includes(victim) ? [victim] : undefined) });
    assert.ok(s.sides[foe].zones.drop.includes(victim), `${seat}: the chosen card was KO'd`);
    assert.equal(s.sides[seat].zones.hand.length - hand0, colour === "V-BLUE" ? 1 : 0, `${seat}: ${colour === "V-BLUE" ? "a blue card KO'd draws 1" : "a red card KO'd draws nothing"}`);
    cases++;
  }

  // 1. Both lives added up: 4 + 4 is 8 or less, 5 + 4 is not.
  for (const [mine, theirs] of [[4, 4], [5, 4]] as const) {
    let s = fresh(seat, seed(7 + mine));
    for (const [p, n] of [[seat, mine], [foe, theirs]] as const) {
      while (s.sides[p].zones.life.length > n) assert.ok(moveCard(s, game, s.sides[p].zones.life[0], "deck", { owner: p }).ok);
      assert.equal(s.sides[p].zones.life.length, n);
    }
    const hand0 = s.sides[seat].zones.hand.length;
    const a = offerOf(s, stage(s, seat, "LIVES", "battle"));
    if (mine + theirs > 8) assert.equal(a, undefined, `${seat}: ${mine}+${theirs} life — the line is not offered`);
    else {
      assert.ok(a, `${seat}: ${mine}+${theirs} life — the line is offered`);
      s = settle(take(s, a.action));
      assert.equal(s.sides[seat].zones.hand.length - hand0, 1, `${seat}: …and draws`);
    }
    cases++;
  }
}

console.log(`phrasing-batch-1: ${records} record-level cases across eight clusters, and ${cases} both-seat reload cases`);
