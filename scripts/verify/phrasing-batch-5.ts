/**
 * Phrasing batch 5 (26 Oct 2026): the owner's three rulings of the day, the known
 * leftovers of batch 4 (moments no trigger reader named, BT23-109's multiplier,
 * EX16-02's two descriptions), and more wordings of the open production rules
 * read by the compiler's phrase readers. Printed text inline (catalog text of the
 * open-rules export of 26 Oct 2026; costs, powers and companions in the VM cases
 * are synthetic).
 *
 * A1 (owner's ruling): "[Counter: Play] When the Battle Card is played, you may
 *    choose it and switch it to Rest Mode" (DB2-126, EX12-07) is a real switch,
 *    made once the card has landed — so "switched to Rest Mode" moments happen.
 * A2 (owner's ruling): "play it with its keyword skills negated" (P-327) negates
 *    its keyword skills (and [Counter]s, 9-7-1) only — the inverse of batch 4.
 * A3 (owner's ruling): "then shuffle your Drop" (BT26-015) does nothing.
 * B: moments read that read as none before ("placed in its owner's Drop from a
 *    Battle Area", BT22-079, and its siblings), BT23-109's "for every 5 cards in
 *    your Z-Energy" kept and its life move read (BT23-103's moment too), EX16-02's
 *    two alternatives.
 * C: the phrase clusters (see the PR).
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
import { attrsNow, hasKeyword } from "../../src/lib/arena/vm/program";
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
/** The record of `text` at `index` (default: the only one), read whole, through the stored-row round trip and the language's print and reparse. */
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
const recordAt = (text: string, what: string, index: number) => skillRecords(card(what, { skill: text })).find((r) => r.skillIndex === index)!;
const unreadOf = (text: string, index = 0) => skillRecords(card("U", { skill: text })).find((r) => r.skillIndex === index)!.unread;
const flat = (c: Cond | null | undefined): Cond[] => (!c ? [] : c.kind === "all" ? c.conds.flatMap(flat) : [c]);
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "chooseMode" ? o.modes.flatMap((m) => opsDeep(m.ops)) : [])]);
const condsDeep = (rec: Rec): Cond[] => [...flat(rec.cond), ...opsDeep(rec.ops).flatMap((o) => (o.op === "if" ? flat(o.cond) : []))];
const chooses = (rec: Rec) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: "choose" }> => o.op === "choose");
const opOf = <K extends Op["op"]>(rec: Rec, op: K) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: K }> => o.op === op);
const subjectFilter = (rec: Rec) => condsDeep(rec).find((c): c is Extract<Cond, { kind: "count" }> => c.kind === "count" && "special" in c.sel && c.sel.special === "subject")?.sel.filter;
let records = 0;

// A1. DB2-126, EX12-07: the card being played, chosen ("you may": up to 1), and switched — the VM holds the switch until it lands.
for (const [text, what] of [
  ["[Counter: Play] When the Battle Card is played, you may choose it and switch it to Rest Mode, then draw 1 card.", "DB2-126"],
  ["[Counter: Play] When the Battle Card is played, you may choose it and switch it to Rest Mode.", "EX12-07"],
] as const) {
  const rec = record(text, what, {}, 0);
  const pick = chooses(rec)[0];
  assert.ok(pick && "special" in pick.sel && pick.sel.special === "resolving" && pick.sel.count === 1 && pick.sel.upTo, `${what}: up to 1, the card being played`);
  const sw = opOf(rec, "switchMode")[0];
  assert.ok(sw && sw.mode === "rest" && "var" in sw.target && sw.target.var === pick.as, `${what}: …switched to Rest Mode (not the manner of the play, \`resolvingPlay\`)`);
  assert.ok(!opOf(rec, "resolvingPlay").length, `${what}: the play itself is not changed`);
  records++;
}

// A2. P-327: "play it with its keyword skills negated" — the keyword kind and [Counter]s, for the turn; never every skill.
{
  const P_327 = "[union absorb][limit 1]{g}/{y}, if your Leader Card is an ≪Android≫ card and you have 4 or more energy: You may place up to 1 <Cell> card from your deck or Drop Area under this card. If you do, choose up to 1 {Super 17, Cell Absorbed} or {Super 17, Hell's Storm Unleashed} in your deck or hand, play it with its keyword skills negated for the turn, then shuffle your deck if you looked through it.";
  const rec = record(P_327, "P-327");
  const negs = opOf(rec, "negateSkillsOfKind");
  assert.deepEqual(negs.map((n) => n.kind), ["keyword", "counter"], "A2: the keyword skills and the [Counter]s");
  assert.ok(negs.every((n) => n.until === "turn"), "A2: …for the turn");
  assert.ok(!opsDeep(rec.ops).some((o) => o.op === "negateSkills" || (o.op === "play" && o.negated)), "A2: …and never every skill (it read as that before)");
  records++;
}
// Not read where the keyword half is not a play's: EB1-07's "has its keyword skills negated" sits beside a "you can't activate
// non-keyword Leader Card skills …" the compiler skips as a reminder, and BT31-002b's is a [Permanent] no standing reader collects.
assert.ok(unreadOf("[auto]{r}, if your opponent has 3 or more energy and it's your turn: At the end of a battle in which you combo with this card from your hand, switch up to 1 of your mono-red Leader Cards to Active Mode, and that card gets +5000 power and has its keyword skills negated for the turn; you can't activate non-keyword Leader Card skills or skills on copies of this card for the turn.").includes("has its keyword skills negated for the turn"), "A2: EB1-07 stays unread");
assert.ok(unreadOf("[permanent] Negate the keyword skills of all your Battle Cards.").length > 0, "A2: BT31-002b stays unread");

// A3. BT26-015: "then shuffle your Drop" is nothing; the moment ("in your hand … discarded by one of your skills") is read.
{
  const BT26_015 = "[Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 mono-red ≪Saiyan≫ card with an energy cost of 3 or less or up to mono-red Extra to your hand, then shuffle your deck.<br>[Auto][Limit 1] If your Leader is a red <Son Goku: GT> card: When this card in your hand is discarded by one of your skills, look at up to 5 cards from the top of your deck, place up to 1 red Extra with an energy cost of 1 into its owner's Drop, then shuffle your Drop.";
  const rec = record(BT26_015, "BT26-015", {}, 10);
  assert.deepEqual(rec.trigger, ["droppedFromHandByYou"], "A3: the discard by one of your own skills");
  assert.ok(!opOf(rec, "shuffle").length, "A3: no shuffle — the Drop has no order to shuffle");
  assert.equal(opOf(rec, "moveTo").at(-1)?.to, "drop", "A3: the Extra goes to the Drop");
  records++;
}

// B1. The moments read: "placed in its owner's Drop from a Battle Area" (BT22-079) and "…from Z-Energy or a Battle Area" (P-563).
{
  const BT22_079 = "[Field]<br>[Permanent] This card is also treated as {Dormant Legend} in all areas.<br>[Auto][Limit 1] If your Leader is a green <Broly> card and you have 3 or more energy: When this card is placed in its owner's Drop from a Battle Area, play up to 1 {SS Broly, Glacial Awakening} from your deck, hand, or Drop, and if you looked at your deck, shuffle your deck.";
  assert.deepEqual(record(BT22_079, "BT22-079", { type: "EXTRA" }, 20).trigger, ["leftBattleToDrop"], "B1: BT22-079 answers the move from a Battle Area to the Drop");
  const P_563 = "[auto] When this card is placed in a Drop from Z-Energy or a Battle Area, remove this card in the Drop from the game.";
  assert.deepEqual([...record(P_563, "P-563").trigger].sort(), ["leftBattleToDrop", "zEnergyToDrop"], "B1: P-563 answers both places");
  records += 2;
}
// B2. Another card of yours, described: the attacker (BT27-001b), the card removed by an opponent's skill (BT15-062), with the
// description a condition on the subject.
{
  const BT27_001B = "[Auto] When your ≪Saiyan≫ card attacks, send up to 1 red or black ≪Saiyan≫ card from your Warp to its owner's Drop.";
  const rec = record(BT27_001B, "BT27-001");
  assert.deepEqual(rec.trigger, ["yourCardAttacks"], "B2: BT27-001b — one of your cards attacking");
  assert.deepEqual(subjectFilter(rec)?.traits, ["saiyan"], "B2: …a ≪Saiyan≫ one");
  const BT2_003B = "[Auto] [Once per turn] When your Battle Cards attack, draw 1 card, and place up to 1 card from the top of your deck under your {Majin Buu's Sealed Ball}.";
  const rec2 = record(BT2_003B, "BT2-003");
  assert.deepEqual(rec2.trigger, ["yourCardAttacks"], "B2: BT2-003b — your Battle Cards attacking");
  assert.equal(subjectFilter(rec2)?.type, "BATTLE", "B2: …a Battle Card, not the Leader");
  const BT15_062 = "[Auto][Once per turn] If it's your opponent's turn: When one of your Battle Cards is removed from your Battle Area by an opponent's skill, your opponent chooses 1 card in their hand and discards it.";
  const rec3 = skillRecords(card("BT15-062", { skill: BT15_062 }))[0];
  assert.deepEqual(rec3.trigger, ["yourCardRemovedByOpponent"], "B2: BT15-062 — one of your Battle Cards removed by an opponent's skill");
  records += 3;
}
// B3. The moments read from wordings the readers missed by a word: "in **the** Leader Area" (BT2-100), "…energy cost of 4 **or
// more**" (BT21-066), "**one of your** … cards in a combo" (BT24-003), "this card **in a Battle Area** is used in a combo"
// (BT27-022), a reminder in parentheses before the moment (BT14-001b), "sent from your Drop Area to your Warp by a skill" (BT12-130).
for (const [text, what, trigger, index] of [
  ["[Auto] When you place this card in the Leader Area, choose 1 {Big Gete Star} from your deck and place it in the Battle Area in Active Mode.", "BT2-100", "leaderPlaced", 0],
  ["[Barrier][Field]<br>[Auto][Once per turn] If your Leader is a blue <Baby> with an original power of 15000 or more and it's your turn: When you play a blue <Baby> with an energy cost of 4 or more, play up to 1 Battle Card with an energy cost of 3 or less and an original power of 10000 or less from under this card with its non-keyword skills negated for the turn.", "BT21-066", "youPlayed", 10],
  ["[auto][once per turn] When you use one of your Red/Yellow multicolor ≪God≫ cards in a combo, during this turn, the next time you activate [arrival red/yellow] on a <Beerus> card with an energy cost of 5 in your hand, reduce the skill cost by {r}.", "BT24-003", "youCombo", 0],
  ["[Auto] When this card in a Battle Area is used in a combo, choose up to 1 of your opponent's Battle Cards and it gets -10000 power for the battle.", "BT27-022", "comboUsed", 0],
  ["[Auto][Once per turn][Spirit Boost 1] (You must remove a marker from your Unison Card to activate this skill.) When you use a red skill-less Battle Card with an energy cost of 2 in a combo, it gets +6000 combo power for the battle.", "BT14-001", "youCombo", 0],
  ["[Auto] If your Leader Card is a black ≪Saiyan≫ card: When this card is sent from your Drop Area to your Warp by a skill, place this card at the bottom of your deck from your Warp.", "BT12-130", "dropToWarpBySkill", 0],
] as const) {
  const rec = record(text, what, {}, index);
  assert.deepEqual(rec.trigger, [trigger], `B3: ${what} answers ${trigger}`);
  records++;
}
{
  const rec = recordAt("[Barrier][Field]<br>[Auto][Once per turn] If your Leader is a blue <Baby> with an original power of 15000 or more and it's your turn: When you play a blue <Baby> with an energy cost of 4 or more, play up to 1 Battle Card with an energy cost of 3 or less and an original power of 10000 or less from under this card with its non-keyword skills negated for the turn.", "BT21-066", 10);
  assert.equal(subjectFilter(rec)?.costMin, 4, "B3: BT21-066 — only a <Baby> costing 4 or more");
  const combo = record("[auto][once per turn] When you use one of your Red/Yellow multicolor ≪God≫ cards in a combo, during this turn, the next time you activate [arrival red/yellow] on a <Beerus> card with an energy cost of 5 in your hand, reduce the skill cost by {r}.", "BT24-003");
  assert.ok(subjectFilter(combo)?.multiColor && subjectFilter(combo)?.traits.includes("god"), "B3: BT24-003 — only a multicolour ≪God≫ card");
}
// B4. BT23-109: the multiplier is kept (it went with the trigger and was dropped), and the life move is read: an unseen card of
// the opponent's Life Area to their Z-Energy, 1 for every 5 cards in your Z-Energy, as many as possible.
{
  const BT23_109 = "[deflect]<br>[auto][limit 1]{y}, if your Leader is {Son Goku, Autonomous Awakening}: When an opponent's Battle Card is KO'd by this card's attack, for every 5 cards in your Z-Energy, add 1 of your opponent's life to its owner's Z-Energy.";
  const rec = record(BT23_109, "BT23-109", {}, 10);
  const pick = chooses(rec)[0];
  assert.ok(pick && "area" in pick.sel && pick.sel.side === "opponent" && pick.sel.area === "life" && pick.blind, "B4: an unseen card of the opponent's life");
  assert.deepEqual(pick.atMost, { count: { side: "you", area: "zEnergy", count: 99, upTo: false }, per: 5 }, "B4: …1 for every 5 cards in your Z-Energy");
  assert.ok(pick.owed && !pick.sel.upTo, "B4: …owed, not offered");
  assert.equal(opOf(rec, "moveTo")[0]?.to, "zEnergy", "B4: to its owner's Z-Energy");
  const BT23_103 = "[Auto] Remove this card from the game: When your opponent's life is added to its owner's Z-Energy by your skill, add 1 of your opponent's life to its owner's Z-Energy.";
  const rec2 = record(BT23_103, "BT23-103");
  assert.deepEqual(rec2.trigger, ["opponentLifeToZBySkill"], "B4: BT23-103's moment");
  assert.equal(chooses(rec2)[0]?.sel.count, 1, "B4: …and exactly 1 card of their life");
  records += 2;
}
// The same count leading an effect after other moments: P-658 (its "te battle" corrected) and a count of cards under this card.
{
  const P_658 = correctSkillText("P-658", "[Auto] When this card attacks, for every Z-Energy cost of the Z-Cards in your Leader Area, Battle Area, and Unison Area, this card gets +5000 power for te battle.")!;
  const power = opOf(record(P_658, "P-658"), "power")[0];
  assert.ok(power && typeof power.amount === "object" && "sumOf" in power.amount && power.amount.attr === "zEnergyCost" && power.amount.times === 5000, "B4: P-658 — +5000 for each Z-Energy cost (a sum, not a count of cards)");
  assert.deepEqual(power.amount.sumOf.areas, ["leader", "battle", "unison"], "B4: …over the three areas");
  const under = opOf(record("[auto] When this card attacks, for each non-Leader card under this card, this card gets +10000 power for the battle.", "UNDERCOUNT"), "power")[0];
  assert.ok(under && typeof under.amount === "object" && "count" in under.amount && under.amount.count.area === "under", "B4: a count of the cards under this card");
  const ex15 = opOf(record("[-2][Activate: Battle] For each card in your Warp, this card gets +5000 power for the battle.", "EX15-05"), "power")[0];
  assert.ok(ex15 && typeof ex15.amount === "object" && "count" in ex15.amount && ex15.amount.count.area === "warp", "B4: EX15-05 — the same count opening an [Activate]");
  records += 3;
}
// Never a count of names ("with a different character name", BT18-059b), nor a choice "for each" (BT15-063).
assert.ok(unreadOf("[activate: battle][once per turn] If it's your turn: For each ≪Bardock's Crew≫ card with different character names in your Z-Energy, this card gets +3000 power for the battle.").length > 0, "B4: a count of different names stays unread");
assert.ok(unreadOf("[-X][activate: main] For each marker you remove using this skill, choose up to 1 of your opponent's Battle Cards and KO it.").length > 0, "B4: a choice for each stays unread");

// B5. EX16-02: two alternatives, each with its own measures, in the hand or the Drop Area (#10); the same "and/or" (#20).
{
  const EX16_02 = "[Permanent] This card can't attack.<br>[+1][Activate: Main] You may choose 1 <Dark Broly> card with an original energy cost of 9 or less or 1 non-black Battle Card with <Xeno> in its character name and an original energy cost of 9 or less in your hand or Drop Area and place it at the bottom of your deck. If you placed a card from your hand at the bottom of your deck, draw 1 card.<br>[-3][Auto] If your Leader Card is a <Towa> card and you have 4 or more energy: At the start of your Main Phase, choose up to 3 non-black Battle Cards with energy costs of 3 or less and <Xeno> in their character names and/or <Dark Broly> cards from your deck or hand, play them, then shuffle your deck if you looked through it.";
  const rec10 = recordAt(EX16_02, "EX16-02", 10);
  const alts = chooses(rec10)[0]?.sel.filter?.anyOf ?? [];
  assert.equal(alts.length, 2, "B5: EX16-02#10 — two descriptions");
  assert.deepEqual(alts[0].characters.map((x) => x.toLowerCase()), ["dark broly"], "B5: …a <Dark Broly> card");
  assert.ok(alts[0].originalCostMax === 9 && !alts[0].notColors.length && !alts[0].charactersIncluding.length, "B5: …costing 9 or less, nothing more");
  assert.ok(alts[1].notColors.includes("Black") && alts[1].charactersIncluding.map((x) => x.toLowerCase()).includes("xeno") && alts[1].type === "BATTLE" && alts[1].originalCostMax === 9, "B5: …or a non-black Battle Card with <Xeno>, costing 9 or less");
  assert.deepEqual(rec10.unread, ["If you placed a card from your hand at the bottom of your deck", "draw 1 card"], "B5: the hand-only count after it stays unread");
  const alts20 = chooses(record(EX16_02, "EX16-02", {}, 20))[0]?.sel.filter?.anyOf ?? [];
  assert.equal(alts20.length, 2, "B5: EX16-02#20 — the same two descriptions, either one for each card");
  records++;
}

// C1. "…until you have 6 life left" (EX11-01, P-743): the life brought down, the cards to the hand.
for (const [text, what] of [
  ["[Awaken] When your life is at 4 or less, or your opponent has 3 or more energy and you have a red Unison Card with a specified cost of 2 in play: You may draw 2 cards, choose cards in your life and add them to your hand until you have 6 life left, and flip this card over.", "EX11-01"],
  ["[auto] If your Leader's back side is {SS4 Vegeta, Ultimate Evolution} and you have 2 or more energy: When this card is played, add cards from your life to your hand, until you have 6 life left and flip your Leader to its back side.", "P-743"],
] as const) {
  const down = opOf(record(text, what, what === "EX11-01" ? { type: "LEADER" } : {}), "lifeDownTo")[0];
  assert.equal(down?.n, 6, `C1: ${what} — life down to 6`);
  records++;
}
// C2. "choose up to X …, where X is the number of …" (BT17-083, BT18-037): any number, up to that count read off the board.
for (const [text, what, counted] of [
  ["[Auto] If this card has 4 or more markers on it: When this card is played, choose up to X of your opponent's Battle Cards in Rest Mode, ignoring [Barrier], where X is equal to the number of yellow Unison Cards in your Drop Area, and KO them.", "BT17-083", "UNISON"],
  ["[auto] When this card is played, draw 1 card, then choose up to X of your opponent's Battle Cards, where X is the number of Extras in your Drop, and place them at the bottom of their owners' decks in any order.", "BT18-037", "EXTRA"],
] as const) {
  const pick = chooses(record(text, what))[0];
  assert.ok(pick?.atMost && typeof pick.atMost === "object" && "count" in pick.atMost && pick.atMost.count.area === "drop" && pick.atMost.count.filter?.type === counted, `C2: ${what} — up to the number of those in your Drop`);
  if (what === "BT17-083") assert.ok(pick.sel.ignoreBarrier && pick.sel.mode === "rest", "C2: BT17-083 — in Rest Mode, ignoring [Barrier]");
  records++;
}
// C3. "draw cards equal to the number of cards you discarded with this skill" (DB3-058), "then draw that many cards" (XD1-02).
{
  const db3 = record("[Auto] Choose up to 2 cards in your hand and discard them: When this card is played, draw cards equal to the number of cards you discarded with this skill.", "DB3-058");
  const draw = opOf(db3, "draw")[0];
  assert.ok(draw && typeof draw.n === "object" && "var" in draw.n, "C3: DB3-058 — as many as the price discarded");
  const xd = record("[Auto] When you play this card, choose up to 2 of your opponent's Battle Cards with energy costs of 3 or less and return them to their owners' hands, then draw that many cards.", "XD1-02");
  const draw2 = opOf(xd, "draw")[0];
  assert.ok(draw2 && typeof draw2.n === "object" && "var" in draw2.n && draw2.n.var === chooses(xd)[0].as, "C3: XD1-02 — as many as were returned");
  records += 2;
}
// Not "revealed by this skill" (P-749): its next clause, "place cards equal to the number drawn this way", has no reader.
assert.ok(unreadOf("[auto] Reveal any number of yellow ≪Turles Crusher Corps≫ cards with an energy cost of 1 from your hand: When this card is played, draw cards equal to the number of cards revealed by this skill, and place cards equal to the number drawn this way from your hand at the bottom of your deck.").length > 0, "C3: P-749 stays unread");
// C4. "…and switch the attack card to this card" (BT25-145, BT30-021): this card takes the attacker's seat (8-1-7-2).
for (const [text, what] of [
  ["[Activate: Battle]{r}{r}{r}, if your Leader is red and your red Battle Card with 30000 power or more is attacking: Play this card from your hand in Rest Mode and switch the attack card to this card.", "BT25-145"],
  ["[activate: battle][limit 1]{u}, if your Leader is blue and your Battle Card with an energy cost of 3 or less is attacking: Play this card from your energy and switch the attack card to this card.", "BT30-021"],
] as const) {
  const swap = opOf(record(text, what), "swapBattle")[0];
  assert.ok(swap && "sel" in swap.target && swap.target.sel.special === "self", `C4: ${what} — this card in the attacking card's place`);
  records++;
}
// C5. The subject said once (BT19-017), "negate its [Energy-Exhaust] skill in all areas" (EX18-05), "there is a X in A and a Y in B" (BT21-084).
{
  const bt19 = record("[permanent] This card gets -10000 power during your turn, and gains [barrier] during your opponent's turn.", "BT19-017");
  const grant = opsDeep(bt19.ops).find((o) => o.op === "if" && o.cond.kind === "isTurnPlayer" && o.cond.who === "opponent");
  assert.ok(grant && grant.op === "if" && grant.then.some((o) => o.op === "grant" && o.keyword.name === "Barrier"), "C5: BT19-017 — [Barrier] on your opponent's turn");
  const ex18 = record("[permanent] If you have a ≪Boujack Brigade≫ card in your energy, reduce the combo cost of this card by 1 and negate its [energy-exhaust] skill in all areas.", "EX18-05");
  assert.ok(opOf(ex18, "negateKeyword").some((o) => o.keyword === "Energy-Exhaust" && o.target && "sel" in o.target && o.target.sel.special === "self"), "C5: EX18-05 — its own [Energy-Exhaust]");
  const bt21 = record("[Auto][Limit 1] There is a {Hyperbolic Time Chamber} in your Battle Area and a skill-less Battle Card in your Combo Area: When this card in your Battle Area is used in a combo, draw 1 card and add this card to its owner's Z-Energy.", "BT21-084");
  const counts = condsDeep(bt21).filter((c): c is Extract<Cond, { kind: "count" }> => c.kind === "count");
  assert.deepEqual(counts.map((c) => ("area" in c.sel ? c.sel.area : null)), ["battle", "combo"], "C5: BT21-084 — two conditions, each in its own area (it read as one card in the Combo Area)");
  assert.deepEqual(bt21.trigger, ["comboUsed"], "C5: …and its moment is read");
  records += 3;
}
// Left unread on purpose: BT9-037's "in all areas" (the reader keeps only the cards in play) and [Rejuvenate]'s "and you remove N
// markers" (its Leader condition does not gate the keyword's move).
assert.ok(unreadOf("[Permanent] If your Leader Card is a ≪Universe 7≫ card, negate the [Energy-Exhaust] of your Red/Blue multicolor cards in all areas.").length > 0, "C5: BT9-037 stays unread");
assert.ok(unreadOf("[Rejuvenate][Once per turn] If your Leader Card is black and you remove 4 markers from this card.").length > 0, "C5: BT13-124 stays unread");

// ── 2. the VM ────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  // A1: DB2-126's [Counter: Play] on an Extra, the card it answers, and a card of the counter's master watching its skills rest the opponent's.
  CPREST: card("CPREST", { type: "EXTRA", power: null, comboCost: null, comboPower: null, energyCost: 1, skill: "[Counter: Play] When the Battle Card is played, you may choose it and switch it to Rest Mode, then draw 1 card." }),
  PLAYED: card("PLAYED", { energyCost: 1 }),
  WATCHREST: card("WATCHREST", { skill: "[Auto] When one of your skills switches your opponent's Battle Card to Rest Mode, draw 1 card." }),
  // A2: P-327's play.
  KWPLAY: card("KWPLAY", { skill: "[Activate: Main] Play up to 1 <Kid> card from your hand with its keyword skills negated for the turn." }),
  KID5: card("KID5", { characters: ["Kid"], energyCost: 1, skill: "[Blocker]<br>[Permanent] This card gets +5000 power.<br>[Auto] When you play this card, draw 1 card." }),
  // B: the moments.
  DISCARDME: card("DISCARDME", { skill: "[Auto] When this card in your hand is discarded by one of your skills, draw 1 card." }),
  DISCARDER: card("DISCARDER", { skill: "[Activate: Main] Discard 1 card from your hand." }),
  DROPWATCH: card("DROPWATCH", { skill: "[Auto] When this card is placed in its owner's Drop from a Battle Area, draw 1 card." }),
  KOER: card("KOER", { skill: "[Activate: Main] Choose 1 of your other Battle Cards and KO it." }),
  ZDROP: card("ZDROP", { type: "Z-BATTLE", zEnergyCost: 1, skill: "[Auto] When this card is placed in a Drop from Z-Energy or a Battle Area, draw 1 card." }),
  ZMOVER: card("ZMOVER", { skill: "[Activate: Main] Choose 1 card in your Z-Energy and place it in your Drop." }),
  ATKWATCH: card("ATKWATCH", { skill: "[Auto] When your ≪Saiyan≫ card attacks, draw 1 card." }),
  SAIYAN: card("SAIYAN", { traits: ["Saiyan"] }),
  REMWATCH: card("REMWATCH", { colors: ["Blue"], skill: "[Auto] When one of your red Battle Cards is removed from your Battle Area by an opponent's skill, draw 1 card." }),
  // DB2-174's line, heard from the hand: it plays itself.
  DB2174: card("DB2174", { colors: ["Blue"], energyCost: 2, skill: "[Auto] If you have 3 or more energy: When one of your red or blue Battle Cards is removed from your Battle Area by an opponent's skill, play this card from your hand, and you can't play another copy of this card for the turn." }),
  BOUNCE: card("BOUNCE", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and return it to its owner's hand." }),
  LIFEZ: card("LIFEZ", { skill: "[Activate: Main] For every 5 cards in your Z-Energy, add 1 of your opponent's life to its owner's Z-Energy." }),
  LIFEWATCH: card("LIFEWATCH", { skill: "[Auto] When your opponent's life is added to its owner's Z-Energy by your skill, draw 1 card." }),
  D2W: card("D2W", { skill: "[Auto] When this card is sent from your Drop Area to your Warp by a skill, draw 1 card." }),
  SENDER: card("SENDER", { skill: "[Activate: Main] Choose up to 1 card in your Drop Area and send it to your Warp." }),
  // C: the clusters.
  LIFEDOWN: card("LIFEDOWN", { skill: "[Activate: Main] Add cards from your life to your hand, until you have 3 life left." }),
  WHEREX: card("WHEREX", { skill: "[Activate: Main] Choose up to X of your opponent's Battle Cards, where X is the number of Extras in your Drop, and place them at the bottom of their owners' decks in any order." }),
  "X-GREEN": card("X-GREEN", { type: "EXTRA", colors: ["Green"], power: null, comboCost: null, comboPower: null }),
  THATMANY: card("THATMANY", { skill: "[Activate: Main] Choose up to 2 of your opponent's Battle Cards and return them to their owners' hands, then draw that many cards." }),
  ZCOST: card("ZCOST", { skill: "[Activate: Main] For every Z-Energy cost of the Z-Cards in your Leader Area, Battle Area, and Unison Area, this card gets +5000 power for the turn." }),
  ZC2: card("ZC2", { type: "Z-BATTLE", zEnergyCost: 2 }),
  DBALT: card("DBALT", { skill: "[Activate: Main] Choose 1 <Dark Broly> card with an original energy cost of 9 or less or 1 non-black Battle Card with <Xeno> in its character name and an original energy cost of 9 or less in your hand or Drop Area and place it at the bottom of your deck." }),
  DARK: card("DARK", { characters: ["Dark Broly"], energyCost: 9 }),
  XENO: card("XENO", { characters: ["Vegeta: Xeno"], energyCost: 5 }),
  BLACKXENO: card("BLACKXENO", { colors: ["Black"], characters: ["Goku: Xeno"], energyCost: 5 }),
  NOTXENO: card("NOTXENO", { characters: ["Goku"], energyCost: 5 }),
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
const linesOf = (def: string) => parseSkills(defs[def].skill!).map((sk) => sk.index);
const offerOf = (s: VmState, c: string, line = linesOf(s.cards[c].cardId)[0]) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === line);
type Prompt = VmState["prompt"];
/** Answer every question until `done` holds (the turn player's Main Phase by default). */
function settle(s0: VmState, steer: { cards?: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[] | undefined } = {}, done: (s: VmState) => boolean = (s) => s.prompt.kind === "main"): VmState {
  let s = s0;
  for (let i = 0; i < 80 && !done(s); i++) {
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
const powerNow = (s: VmState, id: string) => Number(attrsNow(ctx, game, s, id).power ?? 0);
const hand = (s: VmState, p: PlayerId) => s.sides[p].zones.hand.length;
/** Use this card's first [Activate: Main] and answer everything after it. */
function activateLine(s: VmState, c: string, steer: Parameters<typeof settle>[1] = {}): VmState {
  const offer = offerOf(s, c);
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), steer);
}

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 26500 + n * 2 + (seat === "p1" ? 0 : 1);

  // A1. The counter switches the played card once it has landed: it is in the Battle Area in Rest Mode, and the switch was a
  // skill's — the counter's master's watcher answers it. Declined, the card stays in Active Mode and nothing answers.
  for (const accept of [true, false]) {
    let s = fresh(seat, seed(accept ? 0 : 1));
    const played = stage(s, seat, "PLAYED", "hand");
    stage(s, seat, "V1", "energy");
    const cp = stage(s, foe, "CPREST", "hand");
    stage(s, foe, "V1", "energy");
    stage(s, foe, "WATCHREST", "battle");
    s = take(s, { type: "play", player: seat, card: played } as Action);
    if (s.prompt.kind === "payCost") s = take(s, { type: "payCost", player: seat, option: 0 } as Action);
    assert.equal(s.prompt.kind, "counter", `${seat}: A1: the play opens the [Counter: Play] window`);
    s = take(s, { type: "counter", player: foe, card: cp } as Action);
    s = settle(s, { cards: (q) => (q.choice.candidates.includes(played) ? (accept ? [played] : []) : undefined) });
    assert.ok(s.sides[seat].zones.battle.includes(played), `${seat}: A1: the card is played`);
    assert.equal(s.cards[played].mode, accept ? "rest" : "active", `${seat}: A1: ${accept ? "switched to Rest Mode once it landed" : "declined — it stays in Active Mode"}`);
    assert.equal(hand(s, foe), accept ? 2 : 1, `${seat}: A1: the counter draws 1${accept ? ", and the switch is a skill's — the watcher draws 1 more" : ""}`);
    assert.ok(!s.resolving, `${seat}: A1: nothing left being played`);
    cases++;
  }

  // A2. Played with its keyword skills negated: no [Blocker]; its [Permanent] and its "when you play this card" go on working.
  {
    let s = fresh(seat, seed(2));
    const me = stage(s, seat, "KWPLAY", "battle");
    const kid = stage(s, seat, "KID5", "hand");
    s = activateLine(s, me);
    assert.ok(s.sides[seat].zones.battle.includes(kid), `${seat}: A2: the card is played`);
    assert.ok(!hasKeyword(ctx, game, s, kid, "Blocker"), `${seat}: A2: …its [Blocker] is negated`);
    assert.equal(powerNow(s, kid), 15000, `${seat}: A2: …its [Permanent] +5000 stands`);
    assert.equal(hand(s, seat), 1, `${seat}: A2: …and its [Auto] drew 1`);
    cases++;
  }

  // B. The moments. A discard by your own skill (BT26-015); a move from a Battle Area to the Drop (BT22-079); from the Z-Energy
  // (P-563); a move from the Drop to the Warp by a skill (BT12-130).
  {
    let s = fresh(seat, seed(3));
    const me = stage(s, seat, "DISCARDER", "battle");
    const dm = stage(s, seat, "DISCARDME", "hand");
    s = activateLine(s, me, { cards: (q) => (q.choice.candidates.includes(dm) ? [dm] : undefined) });
    assert.ok(s.sides[seat].zones.drop.includes(dm), `${seat}: B: discarded`);
    assert.equal(hand(s, seat), 1, `${seat}: B: …by one of your skills — it draws 1`);
    cases++;
  }
  {
    let s = fresh(seat, seed(4));
    const me = stage(s, seat, "KOER", "battle");
    const w = stage(s, seat, "DROPWATCH", "battle");
    s = activateLine(s, me, { cards: (q) => (q.choice.candidates.includes(w) ? [w] : undefined) });
    assert.ok(s.sides[seat].zones.drop.includes(w), `${seat}: B: KO'd to its owner's Drop`);
    assert.equal(hand(s, seat), 1, `${seat}: B: …from a Battle Area — it draws 1`);
    cases++;
  }
  {
    let s = fresh(seat, seed(5));
    const me = stage(s, seat, "ZMOVER", "battle");
    const z = stage(s, seat, "ZDROP", "zEnergy");
    s = activateLine(s, me, { cards: (q) => (q.choice.candidates.includes(z) ? [z] : undefined) });
    assert.ok(s.sides[seat].zones.drop.includes(z), `${seat}: B: placed in the Drop from the Z-Energy`);
    assert.equal(hand(s, seat), 1, `${seat}: B: …it draws 1`);
    cases++;
  }
  {
    let s = fresh(seat, seed(6));
    const me = stage(s, seat, "SENDER", "battle");
    const d = stage(s, seat, "D2W", "drop");
    s = activateLine(s, me, { cards: (q) => (q.choice.candidates.includes(d) ? [d] : undefined) });
    assert.ok(s.sides[seat].zones.warp.includes(d), `${seat}: B: sent from the Drop to the Warp`);
    assert.equal(hand(s, seat), 1, `${seat}: B: …by a skill — it draws 1`);
    cases++;
  }

  // B. Another card of yours: a ≪Saiyan≫ attacking sets the watcher off, another card does not (BT27-001b).
  for (const saiyan of [true, false]) {
    let s = fresh(seat, seed(saiyan ? 7 : 8));
    stage(s, seat, "ATKWATCH", "battle");
    const atk = stage(s, seat, saiyan ? "SAIYAN" : "V1", "battle");
    s = take(s, { type: "attack", player: seat, attacker: atk, target: s.sides[foe].zones.leader[0] } as Action);
    s = settle(s);
    assert.equal(hand(s, seat), saiyan ? 1 : 0, `${seat}: B: ${saiyan ? "your ≪Saiyan≫ attacks — draw 1" : "another card attacks — nothing"}`);
    cases++;
  }
  // B. Your red Battle Card removed by an opponent's skill: the watcher draws; a blue one, or one you remove yourself, does not (BT15-062, DB2-174).
  for (const [target, drawn] of [["V1", 1], ["V-BLUE", 0]] as const) {
    let s = fresh(seat, seed(target === "V1" ? 9 : 10));
    const me = stage(s, seat, "BOUNCE", "battle");
    stage(s, foe, "REMWATCH", "battle");
    const theirs = stage(s, foe, target, "battle");
    s = activateLine(s, me, { cards: (q) => (q.choice.candidates.includes(theirs) ? [theirs] : undefined) });
    assert.ok(s.sides[foe].zones.hand.includes(theirs), `${seat}: B: returned to its owner's hand`);
    assert.equal(hand(s, foe), 1 + drawn, `${seat}: B: ${drawn ? "a red Battle Card — the watcher draws 1" : "a blue one — nothing"}`);
    cases++;
  }

  // B. DB2-174 in its master's hand answers the same moment and plays itself.
  {
    let s = fresh(seat, seed(18));
    const me = stage(s, seat, "BOUNCE", "battle");
    const watcher = stage(s, foe, "DB2174", "hand");
    for (let i = 0; i < 3; i++) stage(s, foe, "V1", "energy");
    const theirs = stage(s, foe, "V1", "battle");
    s = activateLine(s, me, { cards: (q) => (q.choice.candidates.includes(theirs) ? [theirs] : undefined) });
    assert.ok(s.sides[foe].zones.hand.includes(theirs), `${seat}: B: their red card returned to its owner's hand`);
    assert.ok(s.sides[foe].zones.battle.includes(watcher), `${seat}: B: DB2-174 heard it from the hand and played itself`);
    cases++;
  }

  // B. BT23-109 and BT23-103: 1 of the opponent's life for every 5 cards in your Z-Energy, and the watcher answers the move.
  for (const z of [5, 4]) {
    let s = fresh(seat, seed(z === 5 ? 11 : 12));
    const me = stage(s, seat, "LIFEZ", "battle");
    stage(s, seat, "LIFEWATCH", "battle");
    for (let i = 0; i < z; i++) stage(s, seat, "V1", "zEnergy");
    const life0 = s.sides[foe].zones.life.length;
    const zfoe0 = s.sides[foe].zones.zEnergy.length;
    s = activateLine(s, me);
    const moved = z === 5 ? 1 : 0;
    assert.equal(s.sides[foe].zones.life.length, life0 - moved, `${seat}: B4: ${z} Z-Energy — ${moved} of their life taken`);
    assert.equal(s.sides[foe].zones.zEnergy.length, zfoe0 + moved, `${seat}: B4: …to their Z-Energy`);
    assert.equal(hand(s, seat), moved, `${seat}: B4: …and the watcher ${moved ? "draws 1" : "does nothing"}`);
    cases++;
  }

  // C1. Life down to 3, the cards to the hand.
  {
    let s = fresh(seat, seed(13));
    const me = stage(s, seat, "LIFEDOWN", "battle");
    const life0 = s.sides[seat].zones.life.length;
    s = activateLine(s, me);
    assert.equal(s.sides[seat].zones.life.length, 3, `${seat}: C1: 3 life left`);
    assert.equal(hand(s, seat), life0 - 3, `${seat}: C1: …the rest added to the hand`);
    cases++;
  }
  // C2. Up to X, where X is the number of Extras in your Drop: 1 Extra, 2 of their Battle Cards — one is placed, not two.
  {
    let s = fresh(seat, seed(14));
    const me = stage(s, seat, "WHEREX", "battle");
    stage(s, seat, "X-GREEN", "drop");
    const theirs = [stage(s, foe, "V-BLUE", "battle"), stage(s, foe, "V-BLUE", "battle")];
    s = activateLine(s, me, { cards: (q) => (q.choice.candidates.length ? [q.choice.candidates[0]] : undefined) });
    assert.equal(theirs.filter((id) => s.sides[foe].zones.battle.includes(id)).length, 1, `${seat}: C2: one placed at the bottom of the deck, one left`);
    cases++;
  }
  // C3. Draw that many: two returned, two drawn.
  {
    let s = fresh(seat, seed(15));
    const me = stage(s, seat, "THATMANY", "battle");
    const theirs = [stage(s, foe, "V-BLUE", "battle"), stage(s, foe, "V-BLUE", "battle")];
    s = activateLine(s, me, { cards: (q) => (q.choice.candidates.length ? [q.choice.candidates[0]] : undefined) });
    assert.ok(theirs.every((id) => s.sides[foe].zones.hand.includes(id)), `${seat}: C3: both returned`);
    assert.equal(hand(s, seat), 2, `${seat}: C3: …and 2 drawn`);
    cases++;
  }
  // P-658's count: +5000 for each Z-Energy cost of your Z-Cards (a Z-Battle Card costing 2: +10000).
  {
    let s = fresh(seat, seed(16));
    const me = stage(s, seat, "ZCOST", "battle");
    stage(s, seat, "ZC2", "battle");
    s = activateLine(s, me);
    assert.equal(powerNow(s, me), 20000, `${seat}: B4: +5000 × a Z-Energy cost of 2`);
    cases++;
  }
  // B5. EX16-02's two alternatives: the <Dark Broly> card and the non-black <Xeno> card are offered, nothing else.
  {
    let s = fresh(seat, seed(17));
    const me = stage(s, seat, "DBALT", "battle");
    const yes = [stage(s, seat, "DARK", "hand"), stage(s, seat, "XENO", "drop")];
    const no = [stage(s, seat, "BLACKXENO", "hand"), stage(s, seat, "NOTXENO", "hand")];
    let offered: string[] = [];
    s = activateLine(s, me, { cards: (q) => { offered = q.choice.candidates.slice(); return [yes[0]]; } });
    assert.deepEqual([...offered].sort(), [...yes].sort(), `${seat}: B5: either description, and nothing else`);
    assert.ok(no.every((id) => s.sides[seat].zones.hand.includes(id)), `${seat}: B5: the others stay`);
    cases++;
  }
}

console.log(`phrasing-batch-5: ${records} record-level cases, and ${cases} both-seat reload cases`);
