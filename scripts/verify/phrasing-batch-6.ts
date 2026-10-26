/**
 * Phrasing batch 6 (26 Oct 2026): the owner's rulings of the day, the moment wordings batch 5 left reading as no moment
 * (mostly the [Union]/[Evolve] family), "<A>, <B> and <C> in your Drop Area" read as all of them, and more wordings of
 * the open production rules read by the compiler's phrase readers. Printed text inline (catalog text of the open-rules
 * export of 26 Oct 2026; costs, powers and companions in the VM cases are synthetic).
 *
 * A1 (owner's ruling): "[Rejuvenate] If your Leader Card is green and you remove 4 markers from this card" (BT12-057,
 *    BT13-124): the Leader condition gates the keyword's move — it is not offered while the condition fails.
 * A2 (owner's ruling): "…negate [Indestructible], and KO it / place it at the bottom" (P-454, BT23-081, P-493): no span
 *    printed is for the turn — a timed `negateKeyword`.
 * A3 (owner's ruling): "negate the [Energy-Exhaust] of your Red/Blue multicolor cards in all areas" (BT9-037): every such
 *    card wherever it is, so one placed in energy arrives in Active Mode.
 * A4 (owner's ruling): "If you placed a card from your hand at the bottom of your deck, draw 1 card" (EX16-02): only a card
 *    chosen from the hand (`choseFrom`).
 * A5 (kept): one skill moving two life cards fires BT23-103's moment once per card.
 * B: moments for [Auto]s that compiled with none. C: lists of names in a condition are each of them.
 * D: the clusters (see the PR).
 *
 * Proved here: the records (nothing unread, the stored-row JSON round trip, the rules language's print and reparse),
 * what stays unread on purpose, and in the VM for both seats with every action reloaded from JSON.
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
const unreadOf = (text: string, index = 0) => skillRecords(card("U", { skill: text })).find((r) => r.skillIndex === index)!.unread;
const flat = (c: Cond | null | undefined): Cond[] => (!c ? [] : c.kind === "all" ? c.conds.flatMap(flat) : [c]);
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "chooseMode" ? o.modes.flatMap((m) => opsDeep(m.ops)) : [])]);
/** Every condition the record asks — its own, its price's (the same one, for a line whose price states it) and its branches'. */
const condsDeep = (rec: Rec): Cond[] => [...flat(rec.cond ?? rec.cost?.condition), ...opsDeep(rec.ops).flatMap((o) => (o.op === "if" ? flat(o.cond) : []))];
const opOf = <K extends Op["op"]>(rec: Rec, op: K) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: K }> => o.op === op);
const subjectFilter = (rec: Rec) => condsDeep(rec).find((c): c is Extract<Cond, { kind: "count" }> => c.kind === "count" && "special" in c.sel && c.sel.special === "subject")?.sel.filter;
let records = 0;

// A1. BT12-057, BT13-124 (and BT12-126's life gate): the condition is the line's price condition, the markers its price.
for (const [text, what, kind] of [
  ["[rejuvenate][once per turn] If your Leader Card is green and you remove 4 markers from this card. (Place 1 card under this card in its owner's Drop Area and pay the skill cost: Place the top card of your deck in your life.)", "BT12-057", "leaderMatches"],
  ["[Rejuvenate][Once per turn] If your Leader Card is black and you remove 4 markers from this card.", "BT13-124", "leaderMatches"],
  ["[Rejuvenate][Once per turn] If your life is at 3 or less and you remove 5 markers from this card. (Place 1 card under this card in its owner's Drop Area and pay the skill cost: Place the top card of your deck in your life.)", "BT12-126", "life"],
] as const) {
  const rec = record(text, what, { type: "UNISON" }, 0);
  assert.equal(rec.kind, "keyword", `A1: ${what} is the keyword's move`);
  assert.equal(rec.cost?.condition?.kind, kind, `A1: ${what} — the condition gates the move (the price's condition, 9-4)`);
  assert.equal(opOf(rec, "removeMarker")[0]?.n, /BT12-126/.test(what) ? 5 : 4, `A1: ${what} — the markers are the printed price`);
  const kw = parseSkills(text)[0].keyword;
  assert.ok(kw?.name === "Rejuvenate" && kw.markers === (/BT12-126/.test(what) ? 5 : 4), `A1: ${what} — the keyword still carries its marker count`);
  records++;
}

// A2. P-454, BT23-081, P-493: [Indestructible] of the chosen cards negated for the turn, before the move.
for (const [text, what, next] of [
  ["[auto][once per turn] When this card attacks, choose up to 1 of your opponent's Battle Cards, ignoring [barrier], negate [indestructible], and place it at the bottom of its owner's deck.", "P-454", "moveTo"],
  ["[auto] When this card attacks, choose up to 1 of your opponent's Battle Cards, ignoring [barrier], negate [indestructible], and KO it.", "BT23-081", "ko"],
  ["[auto] When this card is played, choose up to 12 of your opponent's Battle Cards with ≪God≫ or ≪Universe≫ in their special traits, ignoring [barrier], negate their [indestructible] skills, and remove them from the game.", "P-493", "moveTo"],
] as const) {
  const rec = record(text, what);
  const i = rec.ops.findIndex((o) => o.op === "negateKeyword");
  const neg = rec.ops[i] as Extract<Op, { op: "negateKeyword" }>;
  assert.ok(neg && neg.keyword === "Indestructible" && neg.until === "turn" && neg.target && "var" in neg.target, `A2: ${what} — the chosen cards' [Indestructible], for the turn`);
  assert.equal(rec.ops[i + 1]?.op, next, `A2: ${what} — …before the ${next}`);
  records++;
}
// The same timed negation of [Energy-Exhaust] on cards chosen to go to energy (BT9-104, EX10-03b).
{
  const rec = record("[Auto] Choose 3 of your energy and place them in their owners' Drop Areas: When you play this card from your hand, choose up to 3 cards in your Drop Area, negate their [Energy-Exhaust] and place them in your energy.", "BT9-104");
  assert.ok(opOf(rec, "negateKeyword").some((n) => n.keyword === "Energy-Exhaust" && n.until === "turn"), "A2: BT9-104 — their [Energy-Exhaust], for the turn");
  records++;
}

// A3. BT9-037: every Red/Blue multicolour card of yours, wherever it is.
{
  const rec = record("[Permanent] If your Leader Card is a ≪Universe 7≫ card, negate the [Energy-Exhaust] of your Red/Blue multicolor cards in all areas.", "BT9-037");
  const neg = opOf(rec, "negateKeyword")[0];
  assert.ok(neg && neg.keyword === "Energy-Exhaust" && !neg.until && neg.target && "sel" in neg.target, "A3: a standing negation");
  const sel = neg.target && "sel" in neg.target ? neg.target.sel : null;
  assert.ok(sel?.areas?.includes("hand") && sel.areas.includes("deck") && sel.areas.includes("energy") && sel.areas.includes("drop"), "A3: …of the cards in every area, not only in play");
  assert.ok(sel?.filter?.multiColor && sel.filter.colors.includes("Red") && sel.filter.colors.includes("Blue"), "A3: …Red/Blue multicolour ones");
  records++;
}

// A4. EX16-02#10: the draw only when the chosen card came from the hand.
{
  const EX16_02 = "[Permanent] This card can't attack.<br>[+1][Activate: Main] You may choose 1 <Dark Broly> card with an original energy cost of 9 or less or 1 non-black Battle Card with <Xeno> in its character name and an original energy cost of 9 or less in your hand or Drop Area and place it at the bottom of your deck. If you placed a card from your hand at the bottom of your deck, draw 1 card.<br>[-3][Auto] If your Leader Card is a <Towa> card and you have 4 or more energy: At the start of your Main Phase, choose up to 3 non-black Battle Cards with energy costs of 3 or less and <Xeno> in their character names and/or <Dark Broly> cards from your deck or hand, play them, then shuffle your deck if you looked through it.";
  const rec = record(EX16_02, "EX16-02", {}, 10);
  const gate = opOf(rec, "if")[0];
  assert.ok(gate && gate.cond.kind === "choseFrom" && gate.cond.areas.join() === "hand", "A4: drawn only if a card was chosen from the hand");
  assert.equal(gate.then[0]?.op, "draw", "A4: …draw 1");
  records++;
}

// B. The moments read that read as none before.
for (const [text, what, trigger, o] of [
  ["[auto] When this card is discarded from your hand by a [union] skill, look at up to 7 cards from the top of your deck, add up to 1 green Unison Card with a specified cost of 2 among them to your hand, then shuffle your deck.", "BT11-079", ["droppedFromHandByUnion"], {}],
  ["[Auto][Limit 1] If your Leader is a green card with <Gotenks> in its character name: When this card is placed from a hand into its owner's Drop by a [Union] skill, play 1 Ghost Token with 15000 power in Rest Mode, and it gains [Barrier] until the end of your opponent's turn.", "P-683", ["droppedFromHandByUnion"], {}],
  ["[Auto] When this card is discarded from your hand by a [Union-Fusion] skill, add up to 1 card from your life to your hand.", "P-246", ["droppedFromHandByFusion"], {}],
  ["[Auto] When this card is placed in your Drop Area from your hand as a result of [Union-Fusion], if your Leader Card is a <Gogeta> card, draw 1 card.", "SD6-03", ["droppedFromHandByFusion"], {}],
  ["[Auto][Limit 1] If your Leader is green and has <Gotenks> in its character name: When this card is placed in your Drop from your hand by [Union-Fusion], you may choose your Leader and it gets +5000 power for the turn.", "BT18-085", ["droppedFromHandByFusion"], {}],
  ["[Auto][Once per turn] When you activate [Union-Fusion], this card gets +5000 power and [Critical] for the turn.", "BT10-092", ["unionFusionActivated"], {}],
  ["[auto][once per turn] When you activate [union absorb], play 1 Majin Token in Rest Mode. (Majin Tokens have 15000 power, 0 combo cost, and 5000 combo power)", "BT30-044", ["unionAbsorbUsed"], {}],
  ["[Auto][Once per turn] If it's your turn: When you activate an [Evolve] or [Union] skill, add a marker to this card.", "BT14-094", ["evolveActivated", "unionActivated"], { type: "UNISON" }],
  ["[Auto][Once per turn] When you activate [Evolve] or [Union Absorb], draw 1 card.", "BT17-002", ["unionAbsorbUsed", "evolveActivated"], {}],
  ["[Auto][Once per turn] When a card in a Battle Area is returned to its owner's hand by a skill, draw 1 card, then choose 1 card in your hand and place it at the top or bottom of your deck.", "BT12-029", ["battleCardReturnedToHand"], {}],
  ["[auto][once per turn] If this card is in a battle: When your energy is placed at the bottom of its owner's deck, this card gets +11000 power for the battle.", "BT30-030", ["yourEnergyToDeck"], {}],
  ["[Auto][Limit 1] If your Leader is a blue <Uub> and it's your turn: When one of your opponent's cards is added to their Z-Energy, choose up to 1 of your opponent's Battle Cards from their Battle Area or Drop and add it to its owner's Z-Energy.", "BT21-038", ["opponentCardToZEnergy"], {}],
  ["[Auto][Once per turn] When one of your cards deals damage to your opponent, deal 1 additional damage to your opponent.", "BT9-104", ["yourCardDealtDamage"], {}],
] as const) {
  const rec = record(text, what, o);
  assert.deepEqual([...rec.trigger].sort(), [...trigger].sort(), `B: ${what} answers ${trigger.join(" and ")}`);
  records++;
}
// B. The card the moment is about, described: a condition on the subject.
for (const [text, what, trigger, check] of [
  ["[Auto][Once per turn] When one of your ≪Namekian≫ cards activates [Union Absorb], place the top card of your deck under this card, then choose up to 1 of your opponent's Battle Cards and switch it to Rest Mode.", "BT17-089", "unionAbsorbUsed", (f: NonNullable<ReturnType<typeof subjectFilter>>) => f.traits.map((x) => x.toLowerCase()).includes("namekian")],
  ["[Auto] If you place 2 of your Z-Energy into your Drop: When one of your opponent's Battle Cards is played by a skill, choose up to 1 of your opponent's Battle Cards with an energy cost of 7 or less and switch it to Rest Mode.", "BT21-105", "opponentCardPlayedBySkill", (f: NonNullable<ReturnType<typeof subjectFilter>>) => f.type === "BATTLE"],
  ["[Auto] When {Destined Conclusion Piccolo Jr.} is played from your hand, if your Leader Card is a green ≪World Tournament≫, this card gains +10000 power and [Critical] for the duration of the turn.", "TB2-045", "yourCardPlayedFromHand", (f: NonNullable<ReturnType<typeof subjectFilter>>) => f.names.map((x) => x.toLowerCase()).includes("destined conclusion piccolo jr.")],
  ["[Auto][Limit 1] When an originally skill-less Battle Card with an energy cost of 2 or less is played from your Drop, it gets +10000 power for the turn.", "EX25-02", "yourCardPlayedFromDrop", (f: NonNullable<ReturnType<typeof subjectFilter>>) => f.originallySkillLess && f.costMax === 2],
  ["[Auto] When your or your opponent's <Majin Buu> card is played, draw 1 card.", "BT28-100", "eitherCardPlayed", (f: NonNullable<ReturnType<typeof subjectFilter>>) => f.characters.map((x) => x.toLowerCase()).includes("majin buu")],
] as const) {
  const rec = record(text, what);
  assert.deepEqual(rec.trigger, [trigger], `B: ${what} answers ${trigger}`);
  const f = subjectFilter(rec);
  assert.ok(f && check(f), `B: ${what} — the subject described`);
  records++;
}
// Left unread or with no moment on purpose: a description the subject filter would misread (BT20-054b's aside with
// "without"), a move from under a card (BT26-052).
assert.equal(skillRecords(card("BT20-054", { skill: "[Auto][Once per turn] When a <Pan> card or a card with <GT> in its character name—both green and without <Son Goku: GT>—is placed from your Battle Area in your Drop, add it to your Z-Energy from your Drop." }))[0].trigger.length, 0, "B: BT20-054b keeps no moment");

// C. Names listed in a condition are each of them, not any one.
for (const [text, what, names] of [
  ["[Permanent] If you have <Android 13>, <Android 14> and <Android 15> in your Drop Area, this card gets +5000 power.", "LIST-HAVE", 3],
  ["[Permanent] If you have <Android 14> and <Android 15> in your Drop Area, this card gets +5000 power.", "PAIR-HAVE", 2],
  ["[Activate: Main] If there are <Android 13>, <Android 14> and <Android 15> in your Drop: Draw 1 card.", "LIST-THERE", 3],
  ["[Activate: Main] If <Android 13>, <Android 14>, and <Android 15> are in your Drop Area: Draw 1 card.", "LIST-ARE", 3],
  ["[Permanent] If <Bergamo>, <Lavender>, and <Basil> are in play in your Battle Area, negate the skills of all of your opponent's Battle Cards with energy costs of 4 or less in their Battle Area.", "TB1-048", 3],
] as const) {
  const rec = record(text, what);
  const counts = condsDeep(rec).filter((c): c is Extract<Cond, { kind: "count" }> => c.kind === "count");
  assert.equal(counts.length, names, `C: ${what} — one condition per name`);
  assert.ok(counts.every((c) => c.sel.filter?.characters.length === 1 && (c.atLeast ?? 0) >= 1), `C: ${what} — …each asking for one card of its name`);
  records++;
}
// The list in an effect is still one description: "≪Evil Wizard≫ card, ≪Demon Realm Race≫ card, or ≪Demon God≫ card—all
// black …—" (BT17-112): the aside is said of every alternative.
{
  const rec = record("[dark over realm 3]{2}<br>[auto][limit 1] When this card attacks, play up to 1 ≪Evil Wizard≫ card, ≪Demon Realm Race≫ card, or ≪Demon God≫ card—all black and with an energy cost of 2 or less—from your hand.", "BT17-112", {}, 10);
  const sel = opOf(rec, "choose")[0]?.sel;
  const alts = sel?.filter?.anyOf?.length ? sel.filter.anyOf : sel?.filter ? [sel.filter] : [];
  assert.ok(alts.length && alts.every((f) => f.colors.includes("Black") && f.costMax === 2), "C: BT17-112 — black, costing 2 or less, whichever of the three");
  records++;
}

// D. The clusters.
{
  // "…until the next end of the battle" (BT31-103).
  const bt31 = record("[auto] If your Leader is an <Aeos> card: When this card is played, add up to 1 black ≪God≫ card with an energy cost of 1 from your Warp to your hand, then choose up to 1 of your black ≪God≫ cards and it gets +10000 power until the next end of the battle.", "BT31-103");
  assert.equal(opOf(bt31, "power")[0]?.until, "battle", "D: BT31-103 — until the next battle ends");
  // "For each …, reduce the energy cost of this card in your hand by N" (BT15-155, BT28-054, BT15-095).
  const bt15 = record("[permanent] For each Battle Card in play, reduce the energy cost of this card in your hand by 2.", "BT15-155");
  const r1 = opOf(bt15, "costReduction")[0];
  assert.ok(r1 && typeof r1.amount === "object" && "count" in r1.amount && r1.amount.count.side === "both" && r1.amount.times === 2, "D: BT15-155 — 2 for each Battle Card in play, either player's");
  const bt28 = record("[Permanent] For each marker on your blue Unison, reduce the energy cost of this card in your hand by 1.", "BT28-054");
  const r2 = opOf(bt28, "costReduction")[0];
  assert.ok(r2 && typeof r2.amount === "object" && "markers" in r2.amount && r2.amount.markers.filter?.type === "UNISON", "D: BT28-054 — the markers on your blue Unison");
  assert.ok(r2.target && "sel" in r2.target && r2.target.sel.special === "self" && r2.target.sel.area === "hand", "D: …this card in your hand");
  // "if all of your Battle Cards are red and no other color" (TB3-007): mono-red.
  const tb3 = record("[Auto] When you play this card from your hand, if all of your Battle Cards are red and no other color, look at up to the top 5 cards of your deck, choose up to 1 red ≪Ginyu Force≫ card with an energy cost of 2 other than {Strikeforce Recoome} and play it. Then place the rest at the bottom of your deck in any order.", "TB3-007");
  const every = condsDeep(tb3).find((c): c is Extract<Cond, { kind: "every" }> => c.kind === "every");
  assert.ok(every?.matching.filter?.monoColor && every.matching.filter.colors.join() === "Red", "D: TB3-007 — every Battle Card mono-red");
  records += 4;
}
// "…you can activate your Leader's [Awaken] even if your life is at 6 or less" (P-500), "…even if you have 5 or more life"
// (BT7-069, under its Leader condition), "Your blue {Fused Zamasu} Leader Card can activate its [awaken] skill even if you
// have 3 or more life" (a [Permanent]): `awakenLife` on your Leader.
for (const [text, what, n, until] of [
  ["[auto] If your Leader's back side is {Sharpened Power Son Goku} and your opponent has 2 or more energy: When this card is played, during this turn, you can activate your Leader's [awaken] even if your life is at 6 or less.", "P-508", 6, "turn"],
  ["[Auto] When you play this card, for the duration of the turn, if your Leader Card is a red <Broly> card, you can activate its [Awaken] skill even if you have 5 or more life.", "BT7-069", 99, "turn"],
  ["[Auto] When this card is played, draw 1 card, and during that turn, your Leader can activate [Awaken] even if your life is at 6 or less.", "P-548", 6, "turn"],
  ["[permanent] Your blue {Fused Zamasu} Leader Card can activate its [awaken] skill even if you have 3 or more life.", "FUSED-ZAMASU", 99, "game"],
] as const) {
  const permit = opOf(record(text, what), "permit")[0];
  assert.ok(permit && permit.what === "awakenLife" && permit.n === n && permit.until === until && "sel" in permit.target && permit.target.sel.area === "leader", `D: ${what} — your Leader's [Awaken] at ${n === 99 ? "any life" : `${n} life or less`}, for the ${until}`);
  records++;
}
// Not read: the same lift in an [Auto] that names no moment (P-500 as the export prints it) would never fire.
assert.ok(unreadOf("[Auto] If your Leader's back side is {Saiyan Bond Vegeta} and your opponent has 2 or more energy: During this turn, you can activate your Leader's [Awaken] even if your life is at 6 or less.").length > 0, "D: P-500 stays unread (no moment)");
// Not read: two areas said with "and" in the leading count (P-379) and a printed ceiling (P-464) — no amount says either.
assert.ok(unreadOf("[Permanent] For each green Unison Card in your Unison Area and Drop Area, reduce the energy cost of this card in your hand by 1.").length > 0, "D: P-379 stays unread");
assert.ok(unreadOf("[permanent] For each green Unison Card in your Drop, reduce the Z-Energy cost of this card in your Z-Deck by 1. (Up to 2)").length > 0, "D: P-464 stays unread");

// ── 2. the VM ────────────────────────────────────────────────────────────────
const unison = (id: string, skill: string): CardDef => card(id, { type: "UNISON", colors: ["Blue"], energyCost: "X" as unknown as number, power: 5000, comboCost: null, comboPower: null, skill });
const blue = (id: string, o: Partial<CardDef>): CardDef => card(id, { colors: ["Blue"], power: 10000, energyCost: 1, skill: null, ...o });
const FUSION_LINE = "[union-fusion]{u}{u}: <Son Goten> and <Trunks: Youth> (Place 1 each of the specified card with the same power from your hand into your Drop Area and play this card.)";
const defs: Record<string, CardDef> = {
  ...DEFS,
  // A1: [Rejuvenate] gated on a blue Leader (the fixture Leader is blue) and on a red one.
  REJBLUE: unison("REJBLUE", "[Rejuvenate][Once per turn] If your Leader Card is blue and you remove 2 markers from this card."),
  REJRED: unison("REJRED", "[Rejuvenate][Once per turn] If your Leader Card is red and you remove 2 markers from this card."),
  // A2: the negation before the KO.
  NEGKO: card("NEGKO", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards, negate [Indestructible], and KO it." }),
  PLAINKO: card("PLAINKO", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
  // A3: BT9-037's standing negation, and a mover into energy.
  EXHAUSTNEG: card("EXHAUSTNEG", { skill: "[Permanent] Negate the [Energy-Exhaust] of your Red/Blue multicolor cards in all areas." }),
  TOENERGY: card("TOENERGY", { skill: "[Activate: Main] Choose 1 card in your hand and place it in your energy." }),
  RBEX: card("RBEX", { colors: ["Red", "Blue"], skill: "[Energy-Exhaust]" }),
  REX: card("REX", { skill: "[Energy-Exhaust]" }),
  // A4: EX16-02's choice and its draw.
  HANDDRAW: card("HANDDRAW", { skill: "[Activate: Main] You may choose 1 <Dark Broly> card in your hand or Drop Area and place it at the bottom of your deck. If you placed a card from your hand at the bottom of your deck, draw 1 card." }),
  DARK: card("DARK", { characters: ["Dark Broly"] }),
  // A5: BT23-109's count and BT23-103's watcher.
  LIFEZ: card("LIFEZ", { skill: "[Activate: Main] For every 5 cards in your Z-Energy, add 1 of your opponent's life to its owner's Z-Energy." }),
  LIFEWATCH: card("LIFEWATCH", { skill: "[Auto] When your opponent's life is added to its owner's Z-Energy by your skill, draw 1 card." }),
  // B: the [Union-Fusion] family — the materials watching their own discard, a watcher of the activation.
  FUSION: blue("FUSION", { name: "Gotenks", characters: ["Gotenks"], skill: FUSION_LINE }),
  GOTEN: blue("GOTEN", { characters: ["Son Goten"], skill: "[Auto] When this card is discarded from your hand by a [Union-Fusion] skill, draw 1 card." }),
  TRUNKS: blue("TRUNKS", { characters: ["Trunks: Youth"], skill: "[Auto] When this card is discarded from your hand by a [Union] skill, draw 1 card." }),
  FUSIONWATCH: blue("FUSIONWATCH", { skill: "[Auto] When you activate [Union-Fusion], draw 1 card." }),
  "B-E": blue("B-E", { characters: ["Filler"] }),
  // B: the moments read off other moves.
  BOUNCE: card("BOUNCE", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and return it to its owner's hand." }),
  RETWATCH: card("RETWATCH", { skill: "[Auto] When a card in a Battle Area is returned to its owner's hand by a skill, draw 1 card." }),
  ENERGYBACK: card("ENERGYBACK", { skill: "[Activate: Main] Choose 1 of your energy and place it at the bottom of its owner's deck." }),
  ENERGYWATCH: card("ENERGYWATCH", { skill: "[Auto] When your energy is placed at the bottom of its owner's deck, draw 1 card." }),
  BUUWATCH: card("BUUWATCH", { skill: "[Auto] When your or your opponent's <Majin Buu> card is played, draw 1 card." }),
  BUU: card("BUU", { characters: ["Majin Buu"] }),
  PICCOLOWATCH: card("PICCOLOWATCH", { skill: "[Auto] When {Piccolo Jr.} is played from your hand, draw 1 card." }),
  PICCOLO: card("PICCOLO", { name: "Piccolo Jr." }),
  DMGWATCH: card("DMGWATCH", { skill: "[Auto] When one of your cards deals damage to your opponent, draw 1 card." }),
  // D: the [Awaken] life gate lifted for the turn (the fixture's red Leader awakens "when your life is at 4 or less").
  AWAKEN6: card("AWAKEN6", { skill: "[Activate: Main] During this turn, you can activate your Leader's [Awaken] even if your life is at 6 or less." }),
  // D: a [Permanent]'s leading count of markers (BT28-054) and of Battle Cards in play, either player's (BT15-155).
  MARKCUT: card("MARKCUT", { energyCost: 3, skill: "[Permanent] For each marker on your blue Unison, reduce the energy cost of this card in your hand by 1." }),
  BLUEU: unison("BLUEU", "[Blocker]"),
  INPLAYCUT: card("INPLAYCUT", { energyCost: 5, skill: "[permanent] For each Battle Card in play, reduce the energy cost of this card in your hand by 2." }),
  AWAKENANY: card("AWAKENANY", { skill: "[Activate: Main] During this turn, you may activate your Leader Card's [Awaken] even if you have 5 or more life." }),
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
const hand = (s: VmState, p: PlayerId) => s.sides[p].zones.hand.length;
/** Use this card's first [Activate: Main] and answer everything after it. */
function activateLine(s: VmState, c: string, steer: Parameters<typeof settle>[1] = {}): VmState {
  const offer = offerOf(s, c);
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), steer);
}
const pick = (id: string) => ({ cards: (q: Extract<Prompt, { kind: "chooseCards" }>) => (q.choice.candidates.includes(id) ? [id] : undefined) });

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 26600 + n * 2 + (seat === "p1" ? 0 : 1);

  // A1. [Rejuvenate] offered under a blue Leader, and used: the markers paid, a card from under it dropped, +1 life. Under a
  // condition that fails (a red Leader), the move is not offered at all.
  for (const ok of [true, false]) {
    const s = fresh(seat, seed(ok ? 0 : 1));
    const u = stage(s, seat, ok ? "REJBLUE" : "REJRED", "unison");
    s.cards[u].markers = 4;
    const beneath = s.sides[seat].zones.deck.at(-1)!;
    assert.ok(moveCard(s, game, beneath, "under", { under: u }).ok);
    const offer = offerOf(s, u, 0);
    if (!ok) {
      assert.equal(offer, undefined, `${seat}: A1: a red Leader condition fails — the [Rejuvenate] move is not offered`);
      cases++;
      continue;
    }
    assert.ok(offer, `${seat}: A1: the condition holds — offered`);
    const life0 = s.sides[seat].zones.life.length;
    const after = settle(take(s, offer.action));
    assert.equal(after.cards[u].markers, 2, `${seat}: A1: 2 markers removed`);
    assert.equal(after.sides[seat].zones.life.length, life0 + 1, `${seat}: A1: +1 life`);
    cases++;
  }

  // A2. [Indestructible] negated for the turn, then the KO: the card goes. Without the negation it stays.
  for (const negate of [true, false]) {
    let s = fresh(seat, seed(negate ? 2 : 3));
    const me = stage(s, seat, negate ? "NEGKO" : "PLAINKO", "battle");
    const theirs = stage(s, foe, "INDESTRUCT", "battle");
    s = activateLine(s, me, pick(theirs));
    assert.equal(s.sides[foe].zones.drop.includes(theirs), negate, `${seat}: A2: ${negate ? "negated, then KO'd" : "[Indestructible] keeps it in play"}`);
    if (negate) assert.ok(s.effects.some((e) => e.kind === "negateKeyword" && e.target === theirs && e.value === "Indestructible" && e.until === "turn"), `${seat}: A2: the negation lasts the turn`);
    cases++;
  }

  // A3. With BT9-037's negation in force, a Red/Blue multicolour [Energy-Exhaust] card placed in energy from the hand arrives
  // in Active Mode; a mono-red one still arrives in Rest Mode.
  for (const multi of [true, false]) {
    let s = fresh(seat, seed(multi ? 4 : 5));
    stage(s, seat, "EXHAUSTNEG", "battle");
    const me = stage(s, seat, "TOENERGY", "battle");
    const c = stage(s, seat, multi ? "RBEX" : "REX", "hand");
    assert.equal(hasKeyword(ctx, game, s, c, "Energy-Exhaust"), !multi, `${seat}: A3: ${multi ? "negated in the hand already" : "the mono-red card keeps it"}`);
    s = activateLine(s, me, pick(c));
    assert.ok(s.sides[seat].zones.energy.includes(c), `${seat}: A3: placed in energy`);
    assert.equal(s.cards[c].mode, multi ? "active" : "rest", `${seat}: A3: ${multi ? "arrives in Active Mode" : "arrives in Rest Mode"}`);
    cases++;
  }

  // A4. Chosen from the hand: drawn. Chosen from the Drop: nothing drawn.
  for (const from of ["hand", "drop"] as const) {
    let s = fresh(seat, seed(from === "hand" ? 6 : 7));
    const me = stage(s, seat, "HANDDRAW", "battle");
    const d = stage(s, seat, "DARK", from);
    const deck0 = s.sides[seat].zones.deck.length;
    s = activateLine(s, me, pick(d));
    assert.equal(s.sides[seat].zones.deck.at(-1), d, `${seat}: A4: placed at the bottom of the deck`);
    assert.equal(s.sides[seat].zones.deck.length, deck0 + 1 - (from === "hand" ? 1 : 0), `${seat}: A4: ${from === "hand" ? "from the hand — 1 drawn" : "from the Drop — nothing drawn"}`);
    cases++;
  }

  // A5. 10 cards in Z-Energy: two of their life move, and BT23-103's watcher answers each — 2 drawn.
  {
    let s = fresh(seat, seed(8));
    const me = stage(s, seat, "LIFEZ", "battle");
    stage(s, seat, "LIFEWATCH", "battle");
    for (let i = 0; i < 10; i++) stage(s, seat, "V1", "zEnergy");
    const life0 = s.sides[foe].zones.life.length;
    s = activateLine(s, me);
    assert.equal(s.sides[foe].zones.life.length, life0 - 2, `${seat}: A5: two of their life taken`);
    assert.equal(hand(s, seat), 2, `${seat}: A5: …and the watcher answers once per card`);
    cases++;
  }

  // B. [Union-Fusion]: the materials' own moments (by [Union-Fusion], by a [Union] skill) and the activation's watcher.
  {
    let s = fresh(seat, seed(9));
    for (let i = 0; i < 5; i++) stage(s, seat, "B-E", "energy");
    const goten = stage(s, seat, "GOTEN", "hand");
    const trunks = stage(s, seat, "TRUNKS", "hand");
    stage(s, seat, "FUSIONWATCH", "battle");
    const fusion = stage(s, seat, "FUSION", "hand");
    const line = parseSkills(defs.FUSION.skill!).find((sk) => sk.keyword?.name === "Union")!.index;
    const offer = offerOf(s, fusion, line);
    assert.ok(offer, `${seat}: B: the [Union-Fusion] is offered`);
    s = settle(take(s, offer.action));
    assert.ok(s.sides[seat].zones.battle.includes(fusion), `${seat}: B: Gotenks is in play`);
    assert.ok(s.sides[seat].zones.drop.includes(goten) && s.sides[seat].zones.drop.includes(trunks), `${seat}: B: both materials in the Drop`);
    assert.equal(hand(s, seat), 3, `${seat}: B: three draws — each material's discard by the [Union] skill, and the activation's watcher`);
    cases++;
  }

  // B. A card returned from a Battle Area by a skill: the watcher on either side answers.
  for (const watcherSide of [seat, foe]) {
    let s = fresh(seat, seed(watcherSide === seat ? 10 : 11));
    const me = stage(s, seat, "BOUNCE", "battle");
    stage(s, watcherSide, "RETWATCH", "battle");
    const theirs = stage(s, foe, "V-BLUE", "battle");
    const h0 = hand(s, watcherSide);
    s = activateLine(s, me, pick(theirs));
    assert.ok(s.sides[foe].zones.hand.includes(theirs), `${seat}: B: returned`);
    assert.equal(hand(s, watcherSide), h0 + 1 + (watcherSide === foe ? 1 : 0), `${seat}: B: the ${watcherSide === seat ? "bouncer's" : "owner's"} watcher draws 1`);
    cases++;
  }

  // B. Your energy placed at the bottom of its owner's deck.
  {
    let s = fresh(seat, seed(12));
    const me = stage(s, seat, "ENERGYBACK", "battle");
    stage(s, seat, "ENERGYWATCH", "battle");
    const e = stage(s, seat, "V1", "energy");
    s = activateLine(s, me, pick(e));
    assert.ok(s.sides[seat].zones.deck.includes(e), `${seat}: B: the energy is in the deck`);
    assert.equal(hand(s, seat), 1, `${seat}: B: …and the watcher draws 1`);
    cases++;
  }

  // B. Either side's <Majin Buu> played; a {Piccolo Jr.} played from your hand; your attacker dealing damage.
  {
    let s = fresh(seat, seed(13));
    stage(s, seat, "BUUWATCH", "battle");
    stage(s, seat, "PICCOLOWATCH", "battle");
    for (let i = 0; i < 3; i++) stage(s, seat, "V1", "energy");
    const buu = stage(s, seat, "BUU", "hand");
    const pic = stage(s, seat, "PICCOLO", "hand");
    const other1 = stage(s, seat, "V1", "hand");
    const h0 = hand(s, seat);
    for (const c of [buu, pic, other1]) {
      const play = RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && (l.action as { card: string }).card === c);
      assert.ok(play, `${seat}: B: ${s.cards[c].cardId} can be played`);
      s = settle(take(s, play.action));
    }
    assert.equal(hand(s, seat), h0 - 3 + 2, `${seat}: B: the <Majin Buu> and the {Piccolo Jr.} from the hand draw 1 each; the other play nothing`);
    cases++;
  }
  {
    let s = fresh(seat, seed(14));
    stage(s, seat, "DMGWATCH", "battle");
    const atk = stage(s, seat, "V1", "battle");
    s = take(s, { type: "attack", player: seat, attacker: atk, target: s.sides[foe].zones.leader[0] } as Action);
    s = settle(s);
    assert.equal(hand(s, seat), 1, `${seat}: B: your card dealt damage — the watcher draws 1`);
    cases++;
  }

  // D. The leading counts: 2 markers on your blue Unison take a 3-cost card to 1; one Battle Card on each side takes a
  // 5-cost card to 1. With one energy each is playable; with no markers / one Battle Card it is not.
  for (const [def, ready] of [["MARKCUT", true], ["MARKCUT", false], ["INPLAYCUT", true], ["INPLAYCUT", false]] as const) {
    const s = fresh(seat, seed(30 + (def === "MARKCUT" ? 0 : 2) + (ready ? 0 : 1)));
    if (def === "MARKCUT") {
      const u = stage(s, seat, "BLUEU", "unison");
      s.cards[u].markers = ready ? 2 : 0;
    } else {
      stage(s, seat, "V1", "battle");
      if (ready) stage(s, foe, "V-BLUE", "battle");
    }
    stage(s, seat, "V1", "energy");
    const c = stage(s, seat, def, "hand");
    const play = RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && (l.action as { card: string }).card === c);
    assert.equal(!!play, ready, `${seat}: D: ${def} ${ready ? "costs 1 — playable with one energy" : "costs more than one energy"}`);
    cases++;
  }

  // D. The [Awaken] life gate lifted for the turn: at 6 life, "6 or less" lets the Leader awaken and 7 still does not;
  // "5 or more life" lets it awaken at any life. Before the permission, neither is offered.
  for (const [def, life, offered] of [["AWAKEN6", 6, true], ["AWAKEN6", 7, false], ["AWAKENANY", 8, true]] as const) {
    let s = fresh(seat, seed(15 + life), "L-RED");
    const me = stage(s, seat, def, "battle");
    for (const id of s.sides[seat].zones.life.slice(life)) assert.ok(moveCard(s, game, id, "drop", { owner: seat }).ok);
    assert.equal(s.sides[seat].zones.life.length, life);
    const leader = s.sides[seat].zones.leader[0];
    assert.equal(offerOf(s, leader, 0), undefined, `${seat}: D: at ${life} life the [Awaken] is not offered before`);
    s = activateLine(s, me);
    const awaken = offerOf(s, leader, 0);
    assert.equal(!!awaken, offered, `${seat}: D: ${def} at ${life} life — ${offered ? "offered" : "still not offered"}`);
    if (awaken) {
      s = settle(take(s, awaken.action));
      assert.ok(s.cards[leader].flipped, `${seat}: D: the Leader awakened`);
    }
    cases++;
  }
}

console.log(`phrasing-batch-6: ${records} record-level cases, and ${cases} both-seat reload cases`);
