/**
 * Phrasing batch 4 (26 Oct 2026): more wordings of the open production rules
 * read by the compiler's phrase readers alone, the owner's ruling of the day
 * and the two engine fixes the owner approved. Printed text inline (catalog
 * text of the open-rules export of 26 Oct 2026; costs, powers and companions in
 * the VM cases are synthetic).
 *
 * A1 (owner's ruling): "add up to 1 <Pan> card or card with <GT> in its
 *    character name-both multicolor and with an energy cost of 4-from your Drop
 *    to your hand" (P-711) — the aside describes BOTH alternatives.
 * A2 (owner's approval, engine fix a): "negate its non-keyword skills" / "with
 *    its non-keyword skills negated" switches off the [Auto], [Activate] and
 *    [Permanent] skills only; keyword skills ([Blocker], [Barrier], [Counter],
 *    …) keep working (22-1-1, 9-7-1). It used to negate every skill.
 * A3 (owner's approval, engine fix b): an action price's exact "choose N" is
 *    never taken short: not offered when the orbs, paid first, leave fewer
 *    Active Mode candidates than it needs (any such choice, not only BT24-096's
 *    switch), and left unpaid — nothing more of it paid and no effect — when at
 *    payment time fewer cards than N can be chosen.
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
const chooses = (rec: Rec) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: "choose" }> => o.op === "choose");
let records = 0;

// A1. P-711: the aside closing the whole description is said of both alternatives.
const P_711 = "[auto][limit 1] Discard 1 multicolor card from your hand: When this card is played, add up to 1 <Pan> card or card with <GT> in its character name-both multicolor and with an energy cost of 4-from your Drop to your hand.";
{
  const pick = chooses(record(P_711, "P-711"))[0];
  assert.ok(pick && "area" in pick.sel && pick.sel.area === "drop" && pick.sel.count === 1 && pick.sel.upTo, "A1: up to 1 card of your Drop");
  // Phrasing batch 7 (owner, BT25-068): two alternatives — a <Pan> card, or one with <GT> in its character name — and
  // the aside's measures on each.
  const alts = pick.sel.filter?.anyOf ?? [];
  assert.equal(alts.length, 2, "A1: two alternatives");
  assert.deepEqual(alts[0].characters.map((x) => x.toLowerCase()), ["pan"], "A1: a <Pan> card…");
  assert.deepEqual(alts[1].charactersIncluding.map((x) => x.toLowerCase()), ["gt"], "A1: …or a card with <GT> in its character name");
  assert.ok(alts.every((f) => f.multiColor && f.costMin === 4 && f.costMax === 4), "A1: …either one multicolour with an energy cost of 4");
  records++;
}
// Narrow on purpose: an aside after a pair of names joined into one alternative is that alternative's (BT24-092 as before).
{
  const BT24_092 = "[Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 yellow Unison with a specified cost of 2 or up to 1 ≪Saiyan≫ or ≪Earthling≫ card—both yellow and with an energy cost of 4 or less—to your hand, then shuffle your deck.";
  const alts = chooses(record(BT24_092, "BT24-092"))[0]?.sel.filter?.anyOf ?? [];
  assert.equal(alts.length, 2, "A1: BT24-092 has two alternatives");
  assert.equal(alts[0].costMax, null, "A1: the Unison does not take the trait pair's energy cost");
  assert.equal(alts[1].costMax, 4, "A1: …the ≪Saiyan≫ or ≪Earthling≫ card does");
  records++;
}

// A2. "Non-keyword skills": the [Auto], [Activate] and [Permanent] kinds, one negation each; never all of the card.
const NON_KEYWORD = ["auto", "activate", "permanent"];
const kindsNegated = (rec: Rec) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: "negateSkillsOfKind" }> => o.op === "negateSkillsOfKind");
for (const [text, what, until] of [
  ["[Activate: Battle][Once per turn] Choose 3 cards in your hand, place them in your Drop Area, then choose 1 card in your life and add it to your hand: Choose your opponent's Leader Card and all of their Battle Cards, and they get -20000 power and have their non-keyword skills negated for the duration of the turn.", "BT8-115", "turn"],
  ["[activate: main][once per turn]{1}, if your Leader is a red <Gogeta: Br> card: Play up to 1 red <Gogeta: Br> card with an energy cost of 8 from your hand on top of this card in Active Mode with its non-keyword skills negated until the end of your opponent's next turn.", "EX21-20", "nextTurn"],
] as const) {
  const rec = record(text, what);
  const negs = kindsNegated(rec);
  assert.deepEqual(negs.map((n) => n.kind), NON_KEYWORD, `${what}: the three non-keyword kinds`);
  assert.ok(negs.every((n) => n.until === until), `${what}: …for ${until}`);
  assert.ok(!opsDeep(rec.ops).some((o) => o.op === "negateSkills" || (o.op === "play" && o.negated)), `${what}: …and never every skill`);
  records++;
}
// BT21-063 and BT21-066 were read before as every skill negated; now the keyword skills stay.
{
  const BT21_063 = "[Activate: Main][Once per turn] If there are 2 or more cards in your opponent's Energy Area and there are 1 or more {Universal Tuffleization Plan} cards in your Battle Area: Choose 1 of your opponent's Battle Cards with an energy cost of 4 or less that does not have a character name that includes <Son Goku: GT>, place this card under that card, negate that card's non-keyword skills, you gain control of it, and that card gains [servant].";
  const rec = record(BT21_063, "BT21-063");
  assert.deepEqual(kindsNegated(rec).map((n) => n.kind), NON_KEYWORD, "A2: BT21-063 negates the non-keyword kinds…");
  assert.ok(!opsDeep(rec.ops).some((o) => o.op === "negateSkills"), "A2: …and not the card's [Servant] or other keywords");
  const BT21_066 = "[Auto][Once per turn] If your Leader is a blue <Baby> card and it's your turn: When a blue <Baby> card with an energy cost of 4 or more is placed on top of this card, play up to 1 Battle Card with an energy cost of 3 or less and an original power of 10000 or less from under this card with its non-keyword skills negated for the turn.";
  const rec2 = skillRecords(card("BT21-066", { skill: BT21_066 }))[0];
  assert.ok(rec2.unread.length === 0 || rec2.unread.every((u) => !/non-keyword/.test(u)), "A2: BT21-066's play is read");
  if (!rec2.unread.length) {
    assert.deepEqual(kindsNegated(rec2).map((n) => n.kind), NON_KEYWORD, "A2: BT21-066 plays the card with its non-keyword skills negated");
    assert.ok(!opsDeep(rec2.ops).some((o) => o.op === "play" && o.negated), "A2: …the play itself is plain");
  }
  records++;
}
// "Keyword skills negated" (P-327's play, EB1-07's Leader) is not this: phrasing batch 7 reads it as the keyword half.
{
  const rec = skillRecords(card("KW", { skill: "[Activate: Main] Choose 1 of your Leader Cards, and that card has its keyword skills negated for the turn." }))[0];
  assert.deepEqual(kindsNegated(rec).map((n) => n.kind).sort(), ["counter", "keyword"], "A2: \"its keyword skills\" is not read as the non-keyword ones");
}

// B1. A trigger's second moment after a play: an opponent's attack, this card's [Blocker].
for (const [text, what, triggers] of [
  ["[auto] When this card is played or one of your opponent's cards attacks, choose up to 1 of your opponent's Battle Cards and it gets -5000 power for the turn.", "P-716", "played,opponentAttacks"],
  ["[auto][once per turn][spirit boost 2] When this card is played or activates the [blocker] skill, choose up to 1 of your ≪Power Wish≫ cards and switch it to Active Mode.", "P-699", "played,blockerUsed"],
  ["[auto] When this card is played or its [blocker] skill is activated, play up to 1 black skill-less Battle Card with an energy cost of 1 from your Drop Area or Warp in Rest Mode.", "BT14-125", "played,blockerUsed"],
] as const) {
  const rec = record(text, what);
  assert.equal([...rec.trigger].sort().join(), triggers.split(",").sort().join(), `${what}: both moments`);
  records++;
}
// A second moment no reader names stays refused (BT12-038: "your opponent activates a Battle Card's skill").
assert.ok(unreadOf("[Auto] When this card is played or your opponent activates a Battle Card's skill, choose up to 2 of your opponent's Battle Cards and return them to their owners' hands.").length > 0, "B1: an unknown second moment stays unread");

// B2. "…and if you looked at your deck, shuffle your deck": the shuffle a search leaves behind.
for (const [text, what] of [
  ["[Auto][Limit 1] If you place 2 cards from your hand at the bottom of your deck and KO 1 of your yellow <Bora> cards: When this card is played, add up to a total of 3 [Dragon Ball] cards from your deck or Drop to your hand, and if you looked at your deck, shuffle your deck.", "BT22-085"],
  ["[activate: main/battle][limit 1]{y}, if your Leader is a non-≪Great Ape≫ <Son Goku: Childhood> card or ≪Shenron≫ card: Play up to 1 yellow skill-less Battle Card with an energy cost less than or equal to your energy from your deck or Drop, and if you looked at your deck, shuffle your deck.", "BT22-112"],
] as const) {
  const ops = opsDeep(record(text, what).ops);
  assert.equal(ops.filter((o) => o.op === "shuffle").length, 1, `${what}: one shuffle, of the deck a look at it leaves`);
  records++;
}

// B3. "This card gains all skills of the chosen card": the copy with the card after the noun.
{
  const BT31_074 = "[auto] When this card is played, choose up to 1 of your opponent's Battle Cards, ignoring [barrier], and this card gains all skills of the chosen card until the end of your opponent's turn.";
  const rec = record(BT31_074, "BT31-074");
  const copy = rec.ops.find((o) => o.op === "copySkills");
  assert.ok(copy && copy.op === "copySkills" && copy.which === "all" && "var" in copy.from && copy.until === "nextTurn" && !copy.only, "B3: every skill of the chosen card, until the end of the opponent's turn");
  records++;
}

// B4. "For each card in your Z-Energy and Drop, reduce the energy cost …": the count said first.
for (const [text, what, every] of [
  ["[Permanent] This card can't attack, and for each card in your Z-Energy and Drop, reduce the energy cost of this card in your hand by 1.", "BT23-139", 1],
  ["[permanent] For every 2 green Extras in your Battle Area and/or Drop, reduce the energy cost of this card in your hand by 1.", "P-430", 2],
] as const) {
  const red = opsDeep(record(text, what).ops).find((o) => o.op === "costReduction");
  assert.ok(red && red.op === "costReduction" && typeof red.amount === "object" && red.amount !== null && "count" in red.amount, `${what}: a reduction counted off the board`);
  if (every > 1) assert.ok(JSON.stringify(red).includes(`"per":${every}`) || JSON.stringify(red).includes(`"every":${every}`) || JSON.stringify(red).includes(`"divide":${every}`) || JSON.stringify(red).includes(`"div":${every}`), `${what}: for every ${every}`);
  records++;
}
// The rest of the family counts otherwise. (Phrasing batch 6 reads "For each Battle Card in play" — both players' — and
// "For each marker on your blue Unison": `phrasing-batch-6.ts`; phrasing batch 7 reads "…in your Unison Area and Drop
// Area" (P-379): `phrasing-batch-7.ts`.)

// B5. "…it's sent to its owner's Warp instead of being played": the [Counter: Play]'s move to the Warp.
for (const [text, what] of [
  ["[Counter: Play] If your Leader Card is black and your life is at 4 or less: If the Battle Card being played has an energy cost of 3 or less, it is sent to its owner's Warp instead of being played.", "BT8-104"],
  ["[Counter: Play] Play this card, and if the Battle Card being played has an energy cost of 2 or less, it's sent to its owner's Warp instead of being played.", "BT11-146"],
] as const) {
  const stop = opsDeep(record(text, what).ops).find((o) => o.op === "resolvingPlay");
  assert.ok(stop && stop.op === "resolvingPlay" && stop.instead === "warp", `${what}: the play goes to the Warp instead`);
  records++;
}

// B6. "If you added 2 cards to your hand" / "If you placed a card": how many the move just before took.
for (const [text, what, n] of [
  ["[Auto] When this card is played, look at up to 7 cards from the top of your deck, add up to 2 cards with [Offering] skills among them to your hand, then shuffle your deck. If you added 2 cards to your hand, choose 1 card in your hand and discard it.", "P-242", 2],
  ["[Activate: Main][Limit 1] If your Leader Card is a black <Bardock: Xeno> card or a ≪Saiyan≫ card with {SS4} in its card name: Look at up to 3 cards from the top of your deck, add up to 2 black cards with {SS4} in their card names among them to your hand, then place the rest at the bottom of your deck in any order. If you added 2 cards to your hand, choose 1 card in your hand and place it at the bottom of your deck.", "EX19-24", 2],
  ["[Auto] When you play or combo with this card, if your Leader Card is a green ≪Shenron≫ card, choose up to 3 [Dragon Ball] cards from your deck, place them in your Drop Area, then shuffle your deck. If you placed cards in your Drop Area, choose up to 1 of your opponent's Battle Cards with an energy cost of 1 and KO it.", "P-121", 1],
  ["[Auto][Once per turn] When you play a Battle Card using [Over Realm], choose up to 2 black Battle Cards with energy costs of 7 or less in your Warp and place them at the bottom of your deck in any order. If you placed a Battle Card at the bottom of your deck, draw 1 card.", "P-142", 1],
] as const) {
  const rec = record(text, what);
  const asked = condsDeep(rec).find((c): c is Extract<Cond, { kind: "chose" }> => c.kind === "chose");
  const moved = chooses(rec).find((ch) => asked && ch.as === asked.var);
  assert.ok(asked && moved && asked.atLeast === n, `${what}: at least ${n} chosen by the move before it`);
  records++;
}
// Two choices of one card each, and a card counted by where it came from, are not this.
assert.ok(skillRecords(card("P-108", { skill: "[Auto] When this card is KO'd, if your Leader Card is a blue <Gogeta: Br> card, choose up to 1 red <Son Goku: Br> card and 1 red <Vegeta: Br> card from your Drop Area and add them to your hand. If you added 2 cards to your hand, add 2 cards from the top of your deck to your energy." }))[0].unread.length > 0, "B6: P-108's two one-card choices stay unread");
// "…from your hand" is read since phrasing batch 6 (owner's ruling of 26 Oct 2026 on EX16-02, `choseFrom`).
assert.deepEqual(unreadOf("[+1][Activate: Main] You may choose 1 <Dark Broly> card in your hand or Drop Area and place it at the bottom of your deck. If you placed a card from your hand at the bottom of your deck, draw 1 card."), [], "B6: \"from your hand\" is read (batch 6)");

// B7. "Your opponent's Tokens": any token of theirs.
{
  const pick = chooses(record("[Counter: Attack] Negate the attack, then choose up to 2 of your opponent's Tokens and switch them to Rest Mode.", "BT14-117"))[0];
  assert.ok(pick && "side" in pick.sel && pick.sel.side === "opponent" && pick.sel.filter?.token && !pick.sel.filter.names.length && pick.sel.count === 2, "B7: up to 2 of the opponent's tokens, whatever their name");
  records++;
}

// B8. A place in the Drop after a look, without "among them": the cards looked at.
{
  const ops = record("[activate: main][once per turn] Look at up to 5 cards from the top of your deck, place up to 1 blue ≪Earthling≫ card into its owner's Drop, then shuffle your deck.", "BT30-030").ops;
  const look = ops.find((o) => o.op === "look");
  const pick = ops.find((o): o is Extract<Op, { op: "choose" }> => o.op === "choose");
  assert.ok(look && look.op === "look" && pick && pick.sel.fromVar === look.as, "B8: chosen among the cards looked at, not in play");
  records++;
}

// B9. Tokens played in Rest Mode, and "it" after them.
{
  const P_683 = correctSkillText("P-683", "[Auto][Limit 1] If your Leader is a green card with <Gotenks> in its character name: When this card is placed from a hand into its owner's Drop by a [Union] skill, play 1 Ghost Token with 15000 power in Rest Mode, and it gains [Barrier] until he end of your opponent's turn.")!;
  assert.ok(P_683 && /until the end of/.test(P_683), "B9: the catalog misspelling is corrected (errata.ts)");
  const ops = record(P_683, "P-683").ops;
  const token = ops.find((o) => o.op === "token");
  const grant = ops.find((o) => o.op === "grant");
  assert.ok(token && token.op === "token" && token.mode === "rest" && token.power === 15000 && token.as, "B9: one Ghost Token, 15000 power, in Rest Mode");
  assert.ok(grant && grant.op === "grant" && token && token.op === "token" && JSON.stringify(grant.target) === JSON.stringify({ var: token.as }), "B9: \"it\" is the token");
  records++;
}

// B10. "…card-both …-in Rest Mode from your energy with its skills negated": the mode is the play's.
{
  const EX25_14 = "[auto] When this card is played, you may play 1 <Son Goku> or <Vegeta> card-both blue and with an energy cost of 3-in Rest Mode from your energy with its skills negated for the game. If you do, add the top card of your deck to your energy in Rest Mode.";
  const ops = opsDeep(record(EX25_14, "EX25-14", {}, 0).ops);
  const pick = ops.find((o): o is Extract<Op, { op: "choose" }> => o.op === "choose");
  const play = ops.find((o) => o.op === "play");
  assert.ok(pick && !pick.sel.mode && "area" in pick.sel && pick.sel.area === "energy", "B10: any of your energy, rested or not");
  assert.ok(play && play.op === "play" && play.mode === "rest" && play.negated === "game", "B10: played in Rest Mode with its skills negated for the game");
  records++;
}

// B12. "Look at your deck and life, add up to 2 [Dragon Ball] cards to your hand": a search of both areas.
{
  const BT21_029 = "[Auto] Your Leader is a red <Garlic Jr.>: When this card is played, choose one― ・Add up to 1 red <Sansyo> with an energy cost of 4 from your deck to your hand, then shuffle your deck. ・You may place 1 card from your hand at the bottom of your deck. If you do, look at your deck and life, add up to 2 [Dragon Ball] cards to your hand, then shuffle any areas you looked through using this skill.";
  const picks = chooses(record(BT21_029, "BT21-029"));
  const both = picks.find((p) => "areas" in p.sel && JSON.stringify(p.sel.areas) === JSON.stringify(["deck", "life"]));
  assert.ok(both && both.sel.count === 2 && both.sel.upTo && both.sel.filter?.keywords.join() === "Dragon Ball", "B12: up to 2 [Dragon Ball] cards of your deck and life");
  records++;
}

// B11. Catalog misspellings (errata.ts, applied at the next sync).
for (const [id, wrong, right] of [
  ["BT26-120", "Look at up to 5cards from the top of your deck", "Look at up to 5 cards from"],
  ["BT26-071", "or up to 1 green <Vegito> card with and energy cost of 7 or less", "with an energy cost of 7"],
  ["BT25-114", "switch this card toActive Mode.", "switch this card to Active Mode"],
  ["BT31-084", "Flip up ot 1 <Vegeta> card", "Flip up to 1 <Vegeta>"],
] as const) assert.ok(correctSkillText(id, wrong)?.includes(right), `B11: ${id} corrected`);

// ── 2. the VM ────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  // A1: P-711's choice as an [Activate: Main] line.
  PANGT: card("PANGT", { skill: "[Activate: Main] Add up to 1 <Pan> card or card with <GT> in its character name-both multicolor and with an energy cost of 4-from your Drop to your hand." }),
  "PAN-MULTI4": card("PAN-MULTI4", { colors: ["Red", "Yellow"], energyCost: 4, characters: ["Pan"] }),
  "PAN-MONO4": card("PAN-MONO4", { colors: ["Red"], energyCost: 4, characters: ["Pan"] }),
  "PAN-MULTI3": card("PAN-MULTI3", { colors: ["Red", "Yellow"], energyCost: 3, characters: ["Pan"] }),
  "GT-MULTI4": card("GT-MULTI4", { colors: ["Red", "Yellow"], energyCost: 4, characters: ["Son Goku: GT"] }),
  // A2: DB3-024's negation on a card of your own, and EX21-20's play.
  NKNEG: card("NKNEG", { skill: "[Activate: Main] Choose up to 1 of your other Battle Cards and negate its non-keyword skills for the turn." }),
  ALLNEG: card("ALLNEG", { skill: "[Activate: Main] Choose up to 1 of your other Battle Cards and negate its skills for the turn." }),
  KEYED: card("KEYED", { skill: "[Blocker]<br>[Permanent] This card gets +5000 power.<br>[Activate: Main] Draw 1 card." }),
  NKPLAY: card("NKPLAY", { skill: "[Activate: Main] Play up to 1 <Kid> card from your hand with its non-keyword skills negated for the turn." }),
  KID: card("KID", { characters: ["Kid"], energyCost: 1, skill: "[Blocker]<br>[Auto] When you play this card, draw 1 card." }),
  // A3: an exact price choice of 2 energy (stored rule: the choice wants Active Mode cards), and a price taken short.
  PRICEACT: card("PRICEACT", { skill: "[Activate: Main]{1}, place 2 of your energy in your Drop Area: Draw 1 card." }),
  PRICE2: card("PRICE2", { skill: "[Activate: Main] Discard 1 card from your hand and place 2 of your energy in your Drop Area: Draw 1 card." }),
  // B1: P-716's line.
  P716: card("P716", { skill: "[auto] When this card is played or one of your opponent's cards attacks, choose up to 1 of your opponent's Battle Cards and it gets -5000 power for the turn." }),
  // B4: P-430's and BT21-147's counts said first, across two places.
  EVERY2: card("EVERY2", { energyCost: 2, skill: "[permanent] For every 2 green Extras in your Battle Area and/or Drop, reduce the energy cost of this card in your hand by 1." }),
  EACHZD: card("EACHZD", { energyCost: 3, skill: "[Permanent] This card can't attack, and for every card in your Z-Energy and Drop, reduce the energy cost of this card in your hand by 1." }),
  "X-GREEN": card("X-GREEN", { type: "EXTRA", colors: ["Green"], power: null, comboCost: null, comboPower: null }),
  // B6: P-242's count, from a look at the deck.
  ADD2: card("ADD2", { skill: "[Activate: Main] Look at up to 3 cards from the top of your deck, add up to 2 <Kid> cards among them to your hand, then place the rest at the bottom of your deck in any order. If you added 2 cards to your hand, choose 1 card in your hand and discard it." }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
// A3: PRICEACT's choice, as a reviewed row would store it, asks for Active Mode energy (`mode: active`) without switching it.
for (const r of rows as unknown as { cardId: string; cost: { program: Op[] | null } | null }[]) {
  if (r.cardId !== "PRICEACT") continue;
  const pick = r.cost?.program?.[0];
  assert.ok(pick && pick.op === "choose", "A3: PRICEACT's price is a choice");
  pick.sel = { ...pick.sel, mode: "active" };
}
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
const powerNow = (s: VmState, id: string) => Number(attrsNow(ctx, game, s, id).power ?? 0);

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 26400 + n * 2 + (seat === "p1" ? 0 : 1);

  // A1. Either alternative, each multicolour and costing 4: a mono-colour <Pan> and a <Pan> costing 3 are not offered.
  {
    let s = fresh(seat, seed(0));
    const me = stage(s, seat, "PANGT", "battle");
    const yes = [stage(s, seat, "PAN-MULTI4", "drop"), stage(s, seat, "GT-MULTI4", "drop")];
    const no = [stage(s, seat, "PAN-MONO4", "drop"), stage(s, seat, "PAN-MULTI3", "drop")];
    const offer = offerOf(s, me);
    assert.ok(offer, `${seat}: A1: offered`);
    let offered: string[] = [];
    s = settle(take(s, offer.action), { cards: (q) => { offered = q.choice.candidates.slice(); return [yes[1]]; } });
    assert.deepEqual([...offered].sort(), [...yes].sort(), `${seat}: A1: the multicolour <Pan> and the multicolour <GT> card, both costing 4 — nothing else`);
    assert.ok(s.sides[seat].zones.hand.includes(yes[1]), `${seat}: A1: the <GT> card is added`);
    for (const id of no) assert.ok(s.sides[seat].zones.drop.includes(id), `${seat}: A1: ${s.cards[id].cardId} stays`);
    cases++;
  }

  // A2. "Negate its non-keyword skills": its [Permanent] and [Activate] stop, its [Blocker] does not. "Negate its skills" stops all three.
  for (const [negator, keywordKept] of [["NKNEG", true], ["ALLNEG", false]] as const) {
    let s = fresh(seat, seed(keywordKept ? 1 : 2));
    const me = stage(s, seat, negator, "battle");
    const target = stage(s, seat, "KEYED", "battle");
    assert.equal(powerNow(s, target), 15000, `${seat}: A2: the [Permanent] +5000 stands at first`);
    assert.ok(offerOf(s, target, linesOf("KEYED")[2]), `${seat}: A2: its [Activate: Main] is offered at first`);
    const offer = offerOf(s, me);
    assert.ok(offer, `${seat}: A2: ${negator} offered`);
    s = settle(take(s, offer.action), { cards: (q) => (q.choice.candidates.includes(target) ? [target] : undefined) });
    assert.equal(powerNow(s, target), 10000, `${seat}: A2 (${negator}): the [Permanent] is negated`);
    assert.ok(!offerOf(s, target, linesOf("KEYED")[2]), `${seat}: A2 (${negator}): the [Activate: Main] is negated`);
    assert.equal(hasKeyword(ctx, game, s, target, "Blocker"), keywordKept, `${seat}: A2 (${negator}): [Blocker] ${keywordKept ? "still works" : "is negated too"}`);
    assert.equal(skillsNegated(s, target), !keywordKept, `${seat}: A2 (${negator}): ${keywordKept ? "not" : ""} every skill negated`);
    cases++;
  }

  // A2. Played "with its non-keyword skills negated": its "when you play this card" does not fire; it keeps [Blocker].
  {
    let s = fresh(seat, seed(3));
    const me = stage(s, seat, "NKPLAY", "battle");
    const kid = stage(s, seat, "KID", "hand");
    const offer = offerOf(s, me);
    assert.ok(offer, `${seat}: A2 play: offered`);
    const hand0 = s.sides[seat].zones.hand.length;
    s = settle(take(s, offer.action));
    assert.ok(s.sides[seat].zones.battle.includes(kid), `${seat}: A2 play: the card is played`);
    assert.equal(s.sides[seat].zones.hand.length, hand0 - 1, `${seat}: A2 play: its [Auto] did not draw`);
    assert.ok(hasKeyword(ctx, game, s, kid, "Blocker"), `${seat}: A2 play: …and it keeps [Blocker]`);
    cases++;
  }

  // A3. An exact price of 2 Active Mode energy beside {1}: 2 active energy are not enough once {1} rests one; 3 are.
  {
    const s = fresh(seat, seed(4));
    const me = stage(s, seat, "PRICEACT", "battle");
    stage(s, seat, "V1", "energy");
    stage(s, seat, "V1", "energy");
    assert.ok(!offerOf(s, me), `${seat}: A3: {1} rests one of 2 active energy, so 2 Active Mode energy cannot be chosen — not offered`);
    let t = fresh(seat, seed(5));
    const me2 = stage(t, seat, "PRICEACT", "battle");
    const energy = [0, 1, 2].map(() => stage(t, seat, "V1", "energy"));
    const offer = offerOf(t, me2);
    assert.ok(offer, `${seat}: A3: 3 active energy — offered`);
    const hand0 = t.sides[seat].zones.hand.length;
    t = settle(take(t, offer.action));
    assert.equal(energy.filter((id) => t.sides[seat].zones.drop.includes(id)).length, 2, `${seat}: A3: 2 energy placed in the Drop`);
    assert.equal(t.sides[seat].zones.hand.length, hand0 + 1, `${seat}: A3: drew 1`);
    cases++;
  }

  // A3. Taken short at payment time: the energy leaves while the price's discard is being answered — the rest of the
  // price (2 energy) finds 1, and the price is unpaid rather than paid with that one.
  {
    let s = fresh(seat, seed(6));
    const me = stage(s, seat, "PRICE2", "battle");
    const energy = [0, 1, 2].map(() => stage(s, seat, "V1", "energy"));
    const hand = [stage(s, seat, "V1", "hand"), stage(s, seat, "V1", "hand")];
    const offer = offerOf(s, me);
    assert.ok(offer, `${seat}: A3 short: offered with 3 energy and 2 cards in hand`);
    s = take(s, offer.action);
    assert.equal(s.prompt.kind, "chooseCards", `${seat}: A3 short: the discard is asked first`);
    // Two of the three energy leave the Energy Area before the discard is answered (a reload in between).
    for (const id of energy.slice(1)) assert.ok(moveCard(s, game, id, "deck", { owner: seat }).ok);
    s = roundtrip(s);
    const hand0 = s.sides[seat].zones.hand.length;
    s = settle(take(s, { type: "choose", player: seat, cards: [hand[0]] }));
    assert.ok(s.sides[seat].zones.energy.includes(energy[0]), `${seat}: A3 short: 1 energy is not 2 — the price is not paid with it, it stays in the energy`);
    assert.equal(s.sides[seat].zones.hand.length, hand0 - 1, `${seat}: A3 short: the discard was paid, and no draw — the effect behind an unpaid price does not happen`);
    assert.ok(!s.programs.some((f) => f.pricedBy || f.saveVarsAs), `${seat}: A3 short: nothing left behind`);
    cases++;
  }

  // B1. P-716 answers an opponent's attack as well as its own play.
  {
    let s = fresh(seat, seed(7));
    const watcher = stage(s, foe, "P716", "battle");
    const mine = stage(s, seat, "V1", "battle");
    s = take(s, { type: "attack", player: seat, attacker: s.sides[seat].zones.leader[0], target: s.sides[foe].zones.leader[0] } as Action);
    s = settle(s, { cards: (q) => (q.choice.candidates.includes(mine) ? [mine] : undefined) });
    assert.ok(s.sides[foe].zones.battle.includes(watcher), `${seat}: B1: the watcher is in play`);
    assert.equal(powerNow(s, mine), 5000, `${seat}: B1: the attack set it off — -5000 on the chosen card`);
    cases++;
  }

  // B4. The counts across two places: every 2 green Extras in the Battle Area and the Drop together; every card in the
  // Z-Energy and the Drop together.
  {
    const playable = (s: VmState, c: string) => RULES.legalActions(ctx, s).some((l) => l.action.type === "play" && (l.action as { card: string }).card === c);
    const s = fresh(seat, seed(10));
    const c = stage(s, seat, "EVERY2", "hand");
    stage(s, seat, "V1", "energy");
    stage(s, seat, "X-GREEN", "drop");
    assert.ok(!playable(s, c), `${seat}: B4: 1 green Extra — no reduction, cost 2 on 1 energy`);
    stage(s, seat, "X-GREEN", "battle");
    assert.ok(playable(s, c), `${seat}: B4: a second in the Battle Area — 2 across both places, cost 1`);
    const t = fresh(seat, seed(11));
    const z = stage(t, seat, "EACHZD", "hand");
    stage(t, seat, "V1", "energy");
    stage(t, seat, "V1", "drop");
    assert.ok(!playable(t, z), `${seat}: B4: 1 card in the Drop — cost 2 on 1 energy`);
    stage(t, seat, "V1", "zEnergy");
    assert.ok(playable(t, z), `${seat}: B4: and 1 in the Z-Energy — cost 1`);
    cases++;
  }

  // B6. "If you added 2 cards to your hand": one added — no discard; two added — discard 1.
  for (const two of [false, true]) {
    let s = fresh(seat, seed(8 + (two ? 1 : 0)));
    const me = stage(s, seat, "ADD2", "battle");
    const deck = s.sides[seat].zones.deck;
    // The top three cards of the deck: one or two <Kid> cards.
    for (const [i, def] of (two ? ["KID", "KID", "V1"] : ["KID", "V1", "V1"]).entries()) s.cards[deck[i]].cardId = def;
    const offer = offerOf(s, me);
    assert.ok(offer, `${seat}: B6: offered`);
    s = settle(take(s, offer.action), { cards: (q) => (q.choice.min === 0 ? q.choice.candidates.slice(0, 1) : undefined) });
    // Answering one card at a time, the second <Kid> is offered after the first.
    // The hand held nothing before: every <Kid> now in the hand or the Drop was added.
    const kids = [...s.sides[seat].zones.hand, ...s.sides[seat].zones.drop].filter((id) => s.cards[id].cardId === "KID").length;
    assert.equal(kids, two ? 2 : 1, `${seat}: B6: ${two ? 2 : 1} added`);
    assert.equal(s.sides[seat].zones.drop.length, two ? 1 : 0, `${seat}: B6: ${two ? "two added — one discarded" : "one added — nothing discarded"}`);
    cases++;
  }
}

console.log(`phrasing-batch-4: ${records} record-level cases, and ${cases} both-seat reload cases`);
