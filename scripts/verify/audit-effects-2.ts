/**
 * Audit effects 2 (lane E of the readings audit, round 2): effects, clauses and the ops they need. Printed text inline
 * (the catalog snapshot of 3 Nov 2026, corrected by `errata.ts` as a sync stores it).
 *
 * A.  "…and put them back in any order" / "…place them on top of your deck in any order" after a look is `arrange`: the
 *     master orders the cards one at a time, the first pick on top, and none of them leaves the deck (20-12-2).
 * B.  "Activate it" is an activation (a [Field] by its skill, a hand Extra by its [Activate: Main], 12-2-4); a skill named
 *     is never its card's play — unread where no reader activates it.
 * C.  Your own locks on the skills of the cards you describe; "you can't activate [Field] cards" (R-270, owner: every activation, any area).
 * D–I. Rest Mode combo permissions, negated combos, played on top, lists of choices, counted markers, hinges.
 * K.  One wording each; a capital "Then," closes an offer's branch (R-271, BT1-090's Q&A); silent blanks are unread.
 * J.  `arena:refresh-ids --describe-only` writes the reading the compile writes.
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
import { describeOnlyReading } from "../lib/refresh-ids";
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

// B. "Activate it": an Extra the skill chose is activated, never played; a skill named is never the card's play.
for (const [id, text] of [
  ["BT6-064", "[Auto] When you play this card from your hand, choose up to 1 {Broly Control Mechanism} from your deck and activate it, then shuffle your deck."],
  ["P-179", "[Auto] If your Leader Card is a red <Broly> card: When you play this card, choose up to 1 {Dormant Legend} from your deck, activate it, then shuffle your deck."],
  ["BT13-064", "[+1][Activate: Main] Choose up to 1 mono-green Extra Card with an energy cost of 2 or less and the [Field] skill in your hand and activate it."],
  ["BT13-080", "[activate: main][once per turn]{g}, if your Leader Card is a <King Cold: Br> card: Activate 1 mono-green Extra Card with an energy cost of 2 and the [field] skill from your Drop Area."],
  ["EB1-59", "[activate: main]{u}{1}, if your Leader Card is a ≪Bardock's Crew≫ card: Choose 1 {Tora's Red Armband} or {Assault of the Great Apes} in your hand, activate it, then negate this skill for the game."],
] as const) {
  const rec = record(id, text);
  const plays = opOf(rec, "play");
  assert.equal(plays.length, 1, `B: ${id}: one activation`);
  assert.equal(plays[0].activating, true, `B: ${id}: …activating, not a play`);
}
// XD3-01: the arena is activated, and the game-long lock on [Field] cards is a rule (12-1-3), not a reminder.
{
  const rec = record("XD3-01", "[Auto] When this card is placed in your Leader Area, choose up to 1 {Cell Games Arena} from your deck, activate it, and you can't activate [Field] cards for the duration of the game.", { type: "LEADER" });
  assert.equal(opOf(rec, "play")[0].activating, true, "B: XD3-01: activated");
  const lock = opOf(rec, "forbid").find((o) => o.what === "activateSkill");
  assert.ok(lock && lock.until === "game" && lock.extraCardActivation && lock.filter?.type === "EXTRA" && lock.filter.keywords.includes("Field"), "B: XD3-01: …and [Field] Extras can't be activated for the game");
  // R-270 (owner): and the [Field] keyword itself, however it is activated (a skill's "activate {X}" from the deck too).
  assert.ok(opOf(rec, "forbid").some((o) => o.what === "activateSkill" && o.keywordSkill === "Field" && o.until === "game"), "B: XD3-01: …nor any [Field] skill, from any area (R-270)");
}
// P-313: a hand Extra's own [Activate: Main/Battle] line, free (`invokeSkill`).
{
  const rec = record("P-313", "[Activate: Main/Battle][Once per turn][Spirit Boost 1] (You must remove a marker from your Unison Card to activate this skill.) If your Leader Card is a ≪Shadow Dragon≫ card: Choose up to 1 ≪Shadow Dragon≫ Extra Card in your hand and activate its [Activate: Main/Battle] skill without paying its energy cost.");
  const invoked = opOf(rec, "invokeSkill");
  assert.equal(invoked.length, 1, "B: P-313: the line is invoked");
  assert.ok("sel" in invoked[0] && invoked[0].skillKind === "activate:main/battle" && invoked[0].sel.upTo, "B: P-313: …an optional hand Extra's Main/Battle line");
  assert.equal(opOf(rec, "play").length, 0, "B: P-313: …never played");
}
// A skill named is unread where no reader activates it (a card in the Drop), never a play of its card.
for (const [id, text, unread] of [
  ["BT26-113", "[Auto] When this card is played or attacks, place up to 1 ≪Cell Games≫ card from under this card into its owner's Drop, then activate up to 1 of that card's [Activate: Main] skills from the Drop.", "activate up to 1 of that card's [Activate: Main] skills from the Drop"],
  ["BT26-110", "[Auto] When this card attacks, choose up to 1 of your opponent's Rest Mode Battle Cards, ignoring [Barrier], KO it, place all ≪Cell Games≫ cards under this card into their owner's Drop, then activate up to 1 [Activate: Main] skill on each of those cards from your Drop.", "activate up to 1 [Activate: Main] skill on each of those cards from your Drop"],
  ["BT28-103", "[Counter: Play] Activate this card's [Activate: Main] skill.", "Activate this card's [Activate: Main] skill"],
] as const) {
  const recs = skillRecords(card(id, { skill: text }));
  assert.deepEqual(recs[0].unread, [unread], `B: ${id}: unread`);
  assert.equal(opsDeep(recs[0].ops).filter((o) => o.op === "play").length, 0, `B: ${id}: …and nothing played`);
  records++;
}

// C. Your own locks on skills by the cards' description, wherever they are (each was skipped as a reminder).
for (const [id, text, until, check] of [
  ["BT26-140", "[activate: main]{1}, if your opponent has 4 or more energy and you have 7 or fewer cards in your hand: Play this card from your hand, and you can't activate skills on cards other than this card in any of your areas for the turn.", "turn", (o: Extract<Op, { op: "forbid" }>) => o.otherCards === true],
  ["BT26-125", "[Auto] When this card is sent from your Drop to its owner's Warp by the skills of a ≪Prison Planet≫ card in any of your areas, remove this card in your Warp from the game, then you may send 1 ≪Prison Planet≫ card from your Drop to its owner's Warp. If you do, choose up to 1 of your cards and it gets +5000 power for the turn, and you can't activate skills on <Trunks: Future> cards in any of your areas for the turn.", "turn", (o: Extract<Op, { op: "forbid" }>) => o.filter?.characters.includes("trunks: future") === true],
  ["BT30-016", "[awaken] When your life is at 6 or less: Draw 1 card, and you can't activate skills on cards with an energy cost of 4 or more in any of your areas for the game.", "game", (o: Extract<Op, { op: "forbid" }>) => o.filter?.costMin === 4],
  ["BT17-032", "[Auto] Add 3 blue ≪Android≫ cards from your energy to your hand: At the end of your turn, draw 1 card, add up to 3 blue ≪Android≫ cards in your hand to your energy, and until the end of your opponent's next turn, you can't activate the skills of non-≪Android≫ Battle Cards with energy costs of 7 or less in all areas.", "nextTurn", (o: Extract<Op, { op: "forbid" }>) => o.filter?.type === "BATTLE" && o.filter.costMax === 7 && o.filter.notTraits.length === 1],
] as const) {
  const rec = record(id, text);
  const locks = opOf(rec, "forbid");
  assert.deepEqual(locks.map((o) => o.what).sort(), ["activateCounter", "activateSkill", "block"], `C: ${id}: [Activate]/[Auto], [Counter] and [Blocker]`);
  for (const o of locks) assert.equal(o.until, until, `C: ${id}: ${o.what} lasts ${until}`);
  assert.ok(check(locks.find((o) => o.what === "activateSkill")!), `C: ${id}: …of the cards it describes`);
}

// D. "You can combo with this card even when it is in Rest Mode" is a permission, never the action of a combo.
for (const [id, text, what, until] of [
  ["BT23-030", "[permanent] You can combo with this card even when it is in Rest Mode.", "comboRestSelf", "game"],
  ["BT23-125", "[permanent] You can use this card in a combo even when it is in Rest Mode.", "comboRestSelf", "game"],
  ["TB2-010", "[Permanent] You can combo with this card from your Battle Area even when it is in Rest Mode.", "comboRestSelf", "game"],
  ["BT6-080", "[Permanent] You can combo with ≪Boujack Brigade≫ cards in Rest Mode in your Battle Area.", "comboRest", "game"],
] as const) {
  const rec = record(id, text);
  assert.deepEqual(rec.ops.map((o) => o.op), ["permit"], `D: ${id}: a permit`);
  const permit = rec.ops[0] as Extract<Op, { op: "permit" }>;
  assert.equal(permit.what, what, `D: ${id}: ${what}`);
  assert.equal(permit.until, until, `D: ${id}: …for the ${until}`);
  if (what === "comboRest") assert.deepEqual(permit.filter?.traits, ["boujack brigade"], `D: ${id}: …of the cards described`);
}
{
  const rec = record("BT21-081", "[auto] When this card is played from under a {Hyperbolic Time Chamber} in your Battle Area, this card gets +5000 power and you may use this card in a combo in Rest Mode for the turn.");
  const permit = opOf(rec, "permit")[0];
  assert.ok(permit && permit.what === "comboRestSelf" && permit.until === "turn", "D: BT21-081: a permission for the turn");
  assert.equal(opOf(rec, "comboFrom").length + opOf(rec, "may").length, 0, "D: BT21-081: …never a combo now");
}

// E. "…in a combo with its skill negated" (singular) and "…with its skills negated for the turn in a combo".
for (const [id, text] of [
  ["BT27-103", "[auto] When this card attacks, use up to 1 black Battle Card with 5000 combo power from your Warp in a combo with its skill negated for the turn."],
  ["BT30-089", "[activate: battle] [limit 1] If this card isn't in a battle: Use up to 1 black ≪Universe 7≫ card from your Drop in a combo with its skill negated for the turn."],
  ["BT21-123", "[auto][limit 1] When this card attacks, look at up to 3 cards from the top of your deck, use up to 1 yellow ≪Frieza's Army≫ with its skills negated for the turn in a combo, and place the rest at the bottom of your deck in any order."],
] as const) {
  const combo = opOf(record(id, text), "comboFrom");
  assert.equal(combo.length, 1, `E: ${id}: one combo`);
  assert.equal(combo[0].negated, true, `E: ${id}: …with its skills negated`);
}

// F. "Play this card … on top of" the attacking card, the card played with this skill, a card described.
{
  const gohan = record("BT22-063", "[activate: battle][limit 1]{g}, if your green <Son Gohan: Adolescence> card with an energy cost of 4 is attacking: Play this card from your hand on top of the attacking card, and this card gains [critical] for the battle.");
  assert.deepEqual(opOf(gohan, "play")[0].onto, { sel: { special: "attacker" } }, "F: BT22-063: onto the attacking card");
  const babidi = record("BT6-126", "[Activate: Main] {6}, choose 1 <Evil Wizard Babidi> card in your Drop Area or Warp: Play the chosen card, then play this card from your hand on top of the card you played with this skill.");
  const [first, second] = opOf(babidi, "play");
  assert.ok("var" in first.target && second.onto && "var" in second.onto && second.onto.var === first.target.var, "F: BT6-126: this card onto the Babidi played first");
  const vegeta = record("BT7-057", "[Activate: Main] If there is a {Power Ball} in your Battle Area and {Great Ape Vegeta, Energy Manipulation} is not in play in your Battle Area: Play this card from your hand on top of a <Vegeta> card in your Battle Area with an energy cost of 3.");
  const host = opOf(vegeta, "choose").find((o) => o.sel.area === "battle");
  assert.ok(host && host.sel.count === 1 && !host.sel.upTo && host.sel.filter?.characters.includes("vegeta") && host.sel.filter.costMin === 3, "F: BT7-057: the <Vegeta> host is chosen");
  assert.deepEqual(opOf(vegeta, "play")[0].onto, { var: host.as }, "F: BT7-057: …and played onto");
}

// G. A list of choices acted on as one ("…and switch them to Active Mode"); "play A and B"; a pile under the chosen card.
for (const [id, text, op, n] of [
  ["DB2-063", "[Counter: Attack] Negate the attack, and your opponent reveals the top card of their deck. If that card is a Battle Card, choose up to 1 of your Battle Cards and up to 1 of your energy and switch them to Active Mode.", "switchMode", 2],
  ["BT14-123", "[+1][Activate: Main] Draw 1 card, then choose 1 card in your hand and up to 3 ≪Shadow Dragon≫ Extra Cards in your Drop Area and place them at the bottom of your deck in any order.", "moveTo", 2],
  ["BT4-036", "[auto] When you play this card, choose up to 1 of your opponent's Battle Cards and up to 1 card from their hand, and place them on top of their owner's deck in any order.", "moveTo", 2],
  ["BT30-150", "[auto] When this card is played or attacks, choose up to 1 card in your opponent's hand, up to 1 of their Z-Energy, and up to 1 of their Battle Cards—all ignoring [barrier]—and place them into their owner's Drop.", "moveTo", 3],
] as const) {
  const rec = record(id, text);
  const chosen = opOf(rec, "choose").map((o) => o.as);
  const acts = opsDeep(rec.ops).filter((o) => o.op === op) as Extract<Op, { target: unknown }>[];
  assert.equal(acts.length, n, `G: ${id}: ${n} ${op}s`);
  assert.deepEqual(acts.map((o) => ("var" in (o.target as object) ? (o.target as { var: string }).var : "?")).sort(), chosen.slice(-n).sort(), `G: ${id}: …one for each choice of the list`);
}
{
  const kale = record("BT7-075", "[Activate: Main] When you have 3 or more energy: Choose up to 1 blue <Kale> card and 1 yellow <Caulifla> card with energy costs of 2 or less in your hand and play them, then negate this skill for the duration of the game.");
  const picks = opOf(kale, "choose");
  assert.ok(picks.every((o) => o.sel.area === "hand" && o.sel.filter?.costMax === 2), "G: BT7-075: both from the hand, both cost 2 or less");
  assert.equal(opOf(kale, "play").length, 2, "G: BT7-075: …and both played");
  const broly = record("EX13-21", "[Activate: Main] If your Leader Card is a <Cheelai: Br/Lemo: Br> card and you choose 1 card in your hand and discard it: Choose one? ・If you have no cards in your Battle Area, play up to 1 green <Broly: Br> card with an energy cost of 4 from your deck and up to 1 green <Cheelai: Br> or <Lemo: Br> card from your deck, then shuffle your deck. ・Play up to 1 green <Cheelai: Br> or <Lemo: Br> card from your Drop Area.");
  assert.equal(opOf(broly, "play").length, 3, "G: EX13-21: both deck cards of the first mode are played");
  const egg = record("BT25-004", "[+1][Activate: Main] Choose up to 1 of your {King Piccolo's Egg, Terror is Born}, place up to 1 ≪Demon Clan≫ card from your Z-Energy under that card, and play up to 1 red ≪Demon Clan≫ card with an energy cost of 3 from under the chosen card.");
  const fromPile = opOf(egg, "choose").find((o) => o.sel.area === "under");
  assert.ok(fromPile && fromPile.sel.underHost?.fromVar === opOf(egg, "choose")[0].as && fromPile.sel.filter?.costMin === 3, "G: BT25-004: a red cost-3 ≪Demon Clan≫ from under the Egg");
  assert.deepEqual(opOf(egg, "play")[0].target, { var: fromPile.as }, "G: BT25-004: …is the card played");
}

// H. Markers counted, not flat: "for each card under this card. (Up to 3.)", "for each card in your Z-Energy".
{
  const saiyan = record("BT17-003", "[0][Activate: Main] Place 1 ≪Saiyan≫ card from your hand under this card: Draw 1 card, then add a marker to this card for each card under this card. (Up to 3.)");
  assert.deepEqual(plain(opOf(saiyan, "addMarker")[0].n), plain({ capped: [{ count: { side: "you", area: "under", count: 99 } }, 3] }), "H: BT17-003: one per card under, up to 3");
  const rival = record("BT18-076", "[activate: main][limit 1]{g}, if you have {Son Goku, Fated Rival} in play: Play this card from your hand, then choose up to 1 of your opponent's Unisons and remove 1 marker from it for each card in your Z-Energy.");
  assert.deepEqual(plain(opOf(rival, "removeMarker")[0].n), { count: { side: "you", area: "zEnergy", count: 99 } }, "H: BT18-076: one per Z-Energy");
}

// I. After a hinge ("if they don't"), the clause is its effect, never a condition; an unreadable one is unread.
{
  const unison = skillRecords(card("BT13-150", { skill: "[Activate: Battle] Choose 1 of your opponent's Unison Cards: Your opponent may remove a marker from that card. If they don't, your Leader Card doesn't take damage from attacks by their Unison Cards with [Strike] skills for the battle." }))[0];
  assert.deepEqual(unison.unread, ["your Leader Card doesn't take damage from attacks by their Unison Cards with [Strike] skills for the battle"], "I: BT13-150: the consequence is unread, never dropped");
  records++;
  const counter = record("P-171", "[Counter: Play] Draw 1 card, then your opponent may choose 1 Extra Card from their hand and place it in their Drop Area. If they don't, the Battle Card being played has its skills negated for the duration of the turn.");
  const branch = opOf(counter, "if").find((o) => o.cond.kind === "not");
  assert.ok(branch && branch.then.some((o) => o.op === "resolvingPlay" && o.negated), "I: P-171: if they don't, the card being played is negated");
}

// K. Clauses that were dropped or turned, one wording each.
{
  const goku = record("EB1-08", "[Activate: Main][Once per turn] If you have red and blue cards in your Energy Area and you place 1 card from your life in your Drop Area: For the turn, this card gets +20000 power and can't attack your opponent's Leader Card, and you can't play any Battle Cards except ≪Universe 7≫ cards.");
  const ban = opOf(goku, "forbid").find((o) => o.what === "play");
  assert.ok(ban && ban.filter?.type === "BATTLE" && ban.exceptFilter?.traits.includes("universe 7"), "K: EB1-08: every Battle Card but ≪Universe 7≫ ones");
  const keywords = record("P-744", "[auto] When this card is played, choose all of the keyword skills on your opponent's Battle Cards and negate them for the turn.");
  assert.deepEqual(keywords.ops.map((o) => o.op), ["negateSkillsOfKind"], "K: P-744: the keyword skills alone");
  const crew = record("P-437", "[auto][limit 1] When this card is played, look at up to 5 cards from the top of your deck, play up to 1 red ≪Bardock's Crew≫ card with an energy cost of 1 among them with its [auto] skills negated for the turn, and shuffle your deck.");
  assert.ok(!opOf(crew, "play")[0].negated && opOf(crew, "negateSkillsOfKind").some((o) => o.kind === "auto"), "K: P-437: only its [Auto] skills negated");
  const beerus = record("BT8-126", "[Auto] When you play this card, choose up to 1 <Beerus> card in your Drop Area with an energy cost of 3 or more, add it to your hand, then if you have 5 or less cards in your hand also draw 1 card.");
  assert.ok(opOf(beerus, "if").some((o) => o.then.some((x) => x.op === "draw")), "K: BT8-126: the conditional draw");
  const trunks = record("P-275", "[Auto] If your Leader Card is a blue <Trunks: Future> card: When this card is played, you may add 1 card from your life to your hand. If you do, choose 1 card in your hand and place it face up in your life.");
  assert.ok(opOf(trunks, "moveTo").some((o) => o.to === "life" && o.faceUp), "K: P-275: back into the life face up");
  const vegito = record("BT1-090", "[Auto] When you play this card, you may place 1 card from your hand in the Drop Area. If you do so, choose up to 2 opponent Rest Mode Battle Cards and KO those cards. Then, this card gains [Double Strike] for the duration of the turn.");
  assert.ok(vegito.ops.some((o) => o.op === "grant"), "K: BT1-090: [Double Strike] whether or not a card was placed (its Q&A)");
  const kaio = record("BT6-117", "[Activate: Battle] Choose up to 1 of your Battle Cards or Leader Cards, it gets +5000 power for the duration of the battle, and if it's a skill-less Battle Card it gets an additional +5000 power for the duration of the battle.");
  assert.equal(opOf(kaio, "power").length, 2, "K: BT6-117: +5000, and +5000 more for a skill-less Battle Card");
  const gotenks = record("BT2-014", "[permanent] If you have 4 or less cards in your hand, this card and all of your Ghost tokens gain [double strike].");
  assert.equal(opOf(gotenks, "grant").length, 2, "K: BT2-014: this card and the Ghost tokens");
  const goku7 = record("BT23-118", "[Counter: Play][Limit 1] If your Leader is a yellow ≪Universe 7≫ <Son Goku> card: Play this card, and if the Battle Card being played has an energy cost of 7 or less, play it in Rest Mode.");
  assert.ok(opOf(goku7, "resolvingPlay").some((o) => o.mode === "rest") && opOf(goku7, "play").length === 1, "K: BT23-118: the card being played lands rested, no second play");
  const leader = record("EX17-03", "[auto][limit 2] (You can only activate this skill twice per turn across all copies of this card.) [spirit boost 2] (You must remove 2 markers from your Unison Card to activate this skill.) If your opponent has 3 or more energy and it's your turn: When this card attacks or at the end of a battle in which this card was used in a combo from your hand, choose up to 1 of your mono-blue Leader Cards and switch it to Active Mode, it gets +5000 power for the turn, then negate its keyword skills for the turn and you can't activate your Leader Card's non-keyword skills for the turn.");
  assert.ok(opOf(leader, "forbid").some((o) => o.what === "activateSkill" && o.filter?.type === "LEADER"), "K: EX17-03: your Leader's non-keyword skills can't be activated");
  assert.equal(describeScript([{ op: "forbid", what: "attack", side: "opponent", until: "turn", uses: 2 }]), "your opponent can attack only 2 more times for the turn", "K: BT19-092: the allowance, said as one");
}
// Catalog text (errata.ts): BT30-135's shuffle, BT29-146's lock, P-657's switch, BT25-008's name.
{
  const goten = record("BT30-135", "[activate: main] Look at up to 7 cards from the top of your deck, play up to 1  <Son Goku: GT>, <Pan>, or <Trunks: GT> card -- all white and with an energy cost of 1 -- shuffle your deck, then choose up to 1 of your white Battle CArds with an energy cost of 1, switch it to Hidden Mode, then switch that card to Revealed Mode at the end of your opponent's turn.");
  assert.ok(opOf(goten, "shuffle").length === 1 && opOf(goten, "choose")[0].sel.fromVar === "looked", "K: BT30-135: played out of the look, then the shuffle");
  const lock = record("BT29-146", "[activate: main][limit 1]{y}, if your Leader is yellow, your opponent has 2 or more energy, and you place this card from your hand into its owner's Z-Deck face-up: Draw 1 card, choose up to 2 total of your opponent's Battle Cards and/or Unisons-both in Rest Mode-and they can't switch to Active Mode until the end of your opponent's turn, then play this card from your Z-Deck at the start of your next Main Phase.");
  assert.ok(opOf(lock, "forbid").some((o) => o.what === "switchToActive"), "K: BT29-146: the chosen cards can't switch to Active Mode");
}
// Unread, never a misread: a play at its price (TB1-029), and the lines that read as nothing in silence.
{
  const tien = skillRecords(card("TB1-029", { skill: "[Activate: Main] [Once per turn] Look at up to 7 cards from the top of your deck and choose up to 1 ≪Universe 7≫  among them. You may play that card by paying its energy cost. Then, shuffle your deck." }))[0];
  assert.deepEqual(tien.unread, ["You may play that card by paying its energy cost"], "K: TB1-029: the paid play is unread");
  const silent = skillRecords(card("BT14-074", { skill: "[Permanent] If your Leader Card is a green ≪Earthling≫ card, green skill-less Battle Cards in your Combo Area get +5000 combo power while this card is in a battle." }))[0];
  assert.equal(silent.unread.length, 1, "K: BT14-074: a silent blank is unread");
  records += 2;
}

// J. `arena:refresh-ids --describe-only` writes the text the full compile writes — a granted line keeps its "granted by
// skill #N, not this card's own: " (it dropped it on 17 production rows), and every other line is unchanged.
for (const [id, text, back] of [
  ["BT29-083", "[Auto] When this card is played, play up to 1 yellow ≪Ginyu Force≫ card with an energy cost of 3 or less from your Drop, and your ≪Ginyu Force≫ Leader gains the following skill for the turn-\n\"[auto][bond 2] ≪Ginyu Force≫ card: When your ≪Ginyu Force≫ card is played by this card's skill, it gets +5000 power for the turn.\"", undefined],
  ["BT30-064", "[Activate: Main] Choose up to 1 of your green <Majin Buu> cards with an energy cost of 4 and it gains the following skill for the turn—\n\"[union absorb][once per turn] If your opponent has 2 or more energy, choose 1 Battle Card in your Drop or your opponent's Battle Area and place it under this card: Play up to 1 green <Majin Buu> card with an energy cost of 6 from your deck or Drop on top of this card in Active Mode, then shuffle your deck.\"", undefined],
  ["E2-GRANT-BACK", "[Activate: Main] Draw 1 card.", "[Auto] When this card attacks, this card gains the following skill for the turn: \n\"[Activate: Main] Draw 1 card.\""],
] as const) {
  const recs = skillRecords(card(id, { skill: text, ...(back ? { back: { name: id, power: null, skill: back } as CardDef["back"] } : {}) }));
  const granted = recs.filter((r) => r.reads.startsWith("granted by skill #"));
  assert.ok(granted.length >= 1, `J: ${id}: a granted line`);
  for (const r of recs) {
    const row = roundtrip({ ops: r.ops, cond: r.cond, kind: r.kind, skill_index: r.skillIndex });
    assert.equal(describeOnlyReading(row, id, r.side === "back" ? back : text), r.reads, `J: ${id}#${r.skillIndex}${r.side === "back" ? "b" : ""}: describe-only writes what the compile writes`);
    records++;
  }
}

// R. The review of this lane (adversarial pass, 3 Nov 2026): what the fixes above left wrong, and lane items left over.
{
  // A list's cards sent to the Warp go under one name, so "all cards sent to Warps by this skill" is every one of them.
  const xeno = record("BT13-096", "[Auto] When this card is played, choose this card and up to 1 of your opponent's Battle Cards with an energy cost of 3 or less and send them to their owners' Warps; at the end of the turn, negate the skills of all cards sent to Warps by this skill for the turn and play them to their owners' Battle Areas.");
  const sends = opOf(xeno, "moveTo").filter((o) => o.to === "warp");
  assert.equal(sends.length, 2, "R: BT13-096: both cards of the list are sent");
  assert.ok(sends[0].as && sends.every((o) => o.as === sends[0].as), "R: BT13-096: …under one name");
  const back = opOf(xeno, "delay")[0];
  assert.ok(back && JSON.stringify(back.ops).includes(`"fromVar":"${sends[0].as}"`), "R: BT13-096: the end-of-turn play reads all of them, this card included");
  // A pick from the pile under the chosen card gets a name of its own, and is never "the chosen card".
  const trunks = record("EX21-29", "[Auto] Choose 1 <Trunks: Future> card in your Battle Area: When this card attacks or activates [Blocker], use 1 card from under the chosen card in a combo, then switch the chosen card to Active Mode and it can't attack for the turn.");
  const pick = opOf(trunks, "choose").find((o) => o.sel.area === "under")!;
  const host = pick.sel.underHost?.fromVar;
  assert.ok(host && pick.as !== host, "R: EX21-29: the pick from under the price's card is not bound over it");
  assert.deepEqual(opOf(trunks, "comboFrom")[0].target, { var: pick.as }, "R: EX21-29: …the pick is used in the combo");
  assert.deepEqual(opOf(trunks, "switchMode")[0].target, { var: host }, "R: EX21-29: …and the chosen card itself stands up");
  assert.deepEqual(opOf(trunks, "forbid")[0].target, { var: host }, "R: EX21-29: …and can't attack");
  const vegito = record("BT28-079", "[activate: main][once per turn] Choose 1 of your yellow <Vegito> Battle Cards and place 2 of the cards from under that card into their owner's Drop: The chosen card gets +5000 power and [critical] for the turn.");
  const priced = (vegito.cost as { program?: Op[] }).program ?? [];
  const vegitoVar = priced.find((o): o is Extract<Op, { op: "choose" }> => o.op === "choose" && o.sel.area === "battle")!.as;
  assert.ok(opOf(vegito, "power").every((o) => "var" in o.target && o.target.var === vegitoVar), "R: BT28-079: the chosen <Vegito>, not the cards from under it, gets +5000");
  // "Otherwise" of a card a condition may never have revealed.
  const black = record("BT7-042", "[Auto] When you play this card and your Leader Card is a <Goku Black> or <Zamasu> card, choose up to 1 of your opponent's Battle Cards, place it in your opponent's energy in Rest Mode, then play 1 Shadow Token. (Shadow Tokens have 10000 power, 0 combo cost, and 5000 combo power.) Then, if your opponent has 3 or less energy, reveal the top card of your opponent's deck. If that card is a Battle Card, place it in your opponent's energy in Rest Mode, otherwise, draw 1 card then your opponent shuffles their deck.");
  const otherwise = opOf(black, "if").find((o) => o.then.some((x) => x.op === "draw"))!;
  assert.equal(otherwise.cond.kind, "all", "R: BT7-042: the draw needs a card revealed…");
  assert.ok(otherwise.cond.kind === "all" && otherwise.cond.conds.some((x) => x.kind === "chose"), "R: BT7-042: …and one that is not a Battle Card");
  // "(2 damage max.)" caps the damage; "(and specified green cost)" is the effect's.
  const priest = record("BT16-017", "[activate: main]{r}{u}{g}{y}{1}, if your Leader Card is a <Great Priest> card: Deal 1 damage to your opponent for every 2 colors on ≪God≫ cards in your Battle Area. (2 damage max.) Additionally, if you have 12 or more multicolor ≪God≫ cards in play, you win the game.");
  const dmg = opOf(priest, "damage")[0];
  assert.ok(typeof dmg.n === "object" && "capped" in dmg.n && dmg.n.capped[1] === 2, "R: BT16-017: at most 2 damage");
  const kale = record("P-041", "[Permanent] While this card is in play in your Battle Area, decrease the energy cost (and specified green cost) of <Caulifla> and <Kale> in your hand by 1.");
  const cuts = opOf(kale, "costReduction");
  assert.ok(cuts.some((o) => !o.what) && cuts.some((o) => o.what === "specified" && o.colors?.join() === "Green"), "R: P-041: the total and the green orb both go down");
  // The catalog's run-on lines (errata.ts): each skill on its own line, read.
  const baby = skillRecords(card("EX25-36", { skill: correctSkillText("EX25-36", "[energy-exhaust][offering] [arrival red/yellow]{y}, if your Leader is {Super Baby 2, Awakened Malevolence}: [activate: battle][once per turn] Choose 1 of your red or yellow ≪Brainwashed≫ cards and KO it: Choose up to 1 of your opponent's Battle Cards, ignoring [barrier], switch it to Rest Mode, and it can't switch to Active Mode until the end of your opponent's turn.") ?? "" }));
  assert.ok(baby.some((r) => r.kind === "activate:battle" && !r.unread.length && r.ops.some((o) => o.op === "switchMode")), "R: EX25-36: the [Activate: Battle] is its own line, read");
  records++;
}
// Unread, never a misread: each of these was a misread at the fix head.
for (const [id, text, why] of [
  ["BT19-074", "[activate: main][limit 1] If your Leader is a green <Broly: Br> card: During your opponent's next turn, reduce the energy cost of the first Extra you activate from under one of your <Broly: Br> cards by {g}.", /first Extra you activate/],
  ["BT23-041", "[auto][limit 1] If your Leader is a mono-blue <Son Goku> card and you remove this card from the game: When your blue <Piccolo> card attacks, the attacking card gains [critical] for the battle, then reduce the energy cost of the next {Piercing Special Beam Cannon} you place in your Battle Area this turn by {u}.", /next \{Piercing Special Beam Cannon\} you place/],
  ["BT27-058", "[Auto] When this card is played, draw 1 card, and you can activate [Revive] skills on ≪Namekian≫ cards from your Drop without paying their skills costs until the end of your opponent's turn.", /\[Revive\] skills/],
  ["BT27-067", "[Auto][Once per turn]{y}: When your Battle Card is played or when this card attacks, you can activate a skill that includes a marker skill cost on this card twice for the turn.", /marker skill cost/],
  ["BT26-031", "[Permanent] You may choose Battle Cards in your Drop when choosing cards to use with a blue <Gogeta: Br> card's [Union] skill from your hand. If you do, add the chosen cards to your Z-Energy.", /when choosing cards to use with/],
  ["BT20-028", "[Permanent] You may choose up to 1 of your opponent's Battle Cards when choosing cards for this card's [Z-Stack] conditions.", /when choosing cards for/],
  ["BT27-070", "[Activate: Main] Place 3 cards from under this card into their owner's Drop: Choose up to 1 [Permanent] skill other than a keyword skill on your yellow ≪Frieza Clan≫ card with an energy cost of 11 and negate it for the turn.", /\[Permanent\] skill other than a keyword skill/],
  ["BT31-097", "[activate: main] If your Leader is an <Aeos> card: Skip your turn and begin your opponent's Charge Phase", /Skip your turn/],
] as const) {
  const recs = skillRecords(card(id, { skill: text }));
  const rec = recs[recs.length - 1];
  assert.ok(rec.unread.some((u) => why.test(u)), `R: ${id}: unread (${rec.unread.join(" | ") || rec.reads})`);
  assert.equal(opsDeep(rec.ops).filter((o) => o.op === "play" || o.op === "skip").length, 0, `R: ${id}: …nothing played or skipped in its place`);
  records++;
}
// A [Permanent] that names a keyword and prints a sentence of its own is not a keyword line: unread, never silent.
{
  const realm = skillRecords(card("BT30-067", { skill: "[permanent][evolve] Skills on yellow ≪Demon Realm≫ cards in your hand can also activate at [counter: play] timings." }))[0];
  assert.equal(realm.unread.length, 1, "R: BT30-067's back: unread, not a blank");
  records++;
}

// ── the VM ──────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  E2_ARRANGE_THEIRS: card("E2_ARRANGE_THEIRS", { skill: "[Activate: Main] Look at up to 3 cards from the top of your opponent's deck and put them back in any order." }),
  E2_ARRANGE_MINE: card("E2_ARRANGE_MINE", { skill: "[Activate: Main] Look at up to 3 cards from the top of your deck and place them on top of your deck in any order." }),
  E2_ACTIVATE_IT: card("E2_ACTIVATE_IT", { skill: "[Activate: Main] Choose 1 {E2 Armband} in your hand, activate it." }),
  E2_ARMBAND: card("E2_ARMBAND", { name: "E2 Armband", type: "EXTRA", energyCost: 3, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Draw 2 cards." }),
  E2_LOCK: card("E2_LOCK", { skill: "[Activate: Main] Draw 1 card, and you can't activate skills on cards other than this card in any of your areas for the turn." }),
  E2_DRAWER: card("E2_DRAWER", { skill: "[Activate: Main] Draw 1 card." }),
  E2_XENO: card("E2_XENO", { skill: "[Activate: Main] Choose this card and up to 1 of your opponent's Battle Cards and send them to their owners' Warps; at the end of the turn, negate the skills of all cards sent to Warps by this skill for the turn and play them to their owners' Battle Areas." }),
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

  // B. "Activate it" on an Extra with no [Field] in the hand: its [Activate: Main] resolves (12-2-4) and it goes to the
  // Drop; it is never put in the Battle Area.
  {
    let s = fresh(seat, seed(2));
    const me = stage(s, seat, "E2_ACTIVATE_IT", "battle");
    const armband = stage(s, seat, "E2_ARMBAND", "hand");
    const before = s.sides[seat].zones.hand.length;
    s = activate(s, me);
    assert.ok(s.sides[seat].zones.drop.includes(armband), `${seat}: B: the Extra is in the Drop`);
    assert.ok(!s.sides[seat].zones.battle.includes(armband), `${seat}: B: …not in the Battle Area`);
    assert.equal(s.sides[seat].zones.hand.length, before - 1 + 2, `${seat}: B: …and its [Activate: Main] drew 2`);
    cases++;
  }

  // C. "…you can't activate skills on cards other than this card … for the turn": another card's line is not offered;
  // this card's own still is.
  {
    let s = fresh(seat, seed(3));
    const lock = stage(s, seat, "E2_LOCK", "battle");
    const drawer = stage(s, seat, "E2_DRAWER", "battle");
    assert.ok(offerOf(s, drawer), `${seat}: C: the other card's line is offered before`);
    s = activate(s, lock);
    assert.equal(offerOf(s, drawer), undefined, `${seat}: C: …not after the lock`);
    assert.ok(offerOf(s, lock), `${seat}: C: …while this card's own still is`);
    cases++;
  }

  // R. "Choose this card and up to 1 of your opponent's Battle Cards and send them to their owners' Warps; at the end of
  // the turn, … play them to their owners' Battle Areas" (BT13-096): both come back, each to its own owner's side.
  {
    let s = fresh(seat, seed(4));
    const me = stage(s, seat, "E2_XENO", "battle");
    const theirs = stage(s, foe, "V1", "battle");
    s = activate(s, me);
    assert.ok(s.sides[seat].zones.warp.includes(me) && s.sides[foe].zones.warp.includes(theirs), `${seat}: R: both cards are in their owners' Warps`);
    s = take(s, { type: "endMain", player: seat } as Action);
    for (let i = 0; i < 40 && s.turnPlayer === seat; i++) {
      const q = s.prompt;
      const who = (q as { player: PlayerId }).player;
      if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
      else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
      else if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: null } as Action);
      else s = take(s, { type: "pass", player: who } as Action);
    }
    assert.ok(s.sides[seat].zones.battle.includes(me), `${seat}: R: this card is played back at the end of the turn`);
    assert.ok(s.sides[foe].zones.battle.includes(theirs), `${seat}: R: …and the opponent's card, on their side`);
    cases++;
  }
}

console.log(`verify/audit-effects-2: ok (${records} records, ${cases} VM cases across both seats)`);
