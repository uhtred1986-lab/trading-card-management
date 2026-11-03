/**
 * Audit selectors 3 (3 Nov 2026): the readings audit's selector lane, round 3. Printed text inline (catalog text of the
 * snapshot of 3 Nov 2026; costs, powers and companions in the VM cases are synthetic).
 *
 * A.  "This face-up card" is this card in the life (BT12-005, BT12-006, BT12-009, BT12-010); a life replacement with no
 *     target reads "a card" (BT10-031, SD18-01).
 * B.  Price changes: a description with no number is every card (TB1-031, TB1-062), "in your hand and Battle Area" both
 *     (BT8-023's back), "a {Power Pole}" in all of your areas (Q&A BT21-001), [Swap]'s skill cost on the Battle Card
 *     (BT21-101, BT21-102), "this card in your hand and Drop Area" in the Drop too (BT9-071, EX21-03 — VM).
 * C.  Both players' (R-321): a subject with no owner (EX06-31, BT22-084, BT2-105; BT26-092 keeps yours), "in all areas"
 *     (P-268), "other than this card or your <Caulifla>" (TB1-015 — VM).
 * D.  Kinds and places: Battle Cards and Unisons (BT28-149), ≪God≫ cards or Unisons (BT29-103), Battle Area or Unison
 *     Area (P-623's back), "A and B" in a sweep (EX25-35), "either mono-green or has ≪Heroine≫" (P-330), the Earthling
 *     card or token used in a combo (BT21-075, BT21-090, BT21-091, P-507), ≪Great Ape≫ (P-415's catalog line).
 * E.  The card a combo is with (EB1-45, DB2-003, BT10-017); "it" after "when this card …" stays this card (BT16-119).
 * F.  Offers: a one-card offer's sentence (R-322: SD9-05, P-129; BT15-061 not), "you may choose that card" (DB2-023,
 *     DB1-020), the [Awaken] life step (R-320: P-434, SD14-01).
 * G.  Replacements: "a … card" (BT12-056), "you may place this card … instead" a substitute (BT19-136).
 * H.  The review's repairs: P-129's one gate, a Battle Card's [Counter: Attack] (DB3-129 — VM), [Blocker] against one
 *     card's attack (DB3-014, DB3-023 — VM), skills on Battle Cards in a Battle Area (P-093 — VM), the host's description
 *     (BT18-008), all of the chosen cards (BT21-118), control of a Unison unread (BT14-153, BT23-139), Active or Rest
 *     Mode (P-645); "in all areas" both players' is R-323 (P-268).
 *
 * Proved here: the records (nothing unread where the line is whole, the stored-row JSON round trip, the rules
 * language's print and reparse), and in the VM where an engine path moved (B, C).
 */
import assert from "node:assert/strict";
import { CTX, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow, forbids, staticsNow } from "../../src/lib/arena/vm/program";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { correctSkillText } from "../../src/lib/catalog/errata";
import type { Op, Selector } from "../../src/lib/arena/vm/script";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── the records ──────────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Rec = ReturnType<typeof skillRecords>[number];
const asRule = (rec: Rec) => roundtrip({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops }) as Rule;
const plain = (v: unknown) =>
  JSON.parse(JSON.stringify(v, function (this: Record<string, unknown>, k, x) {
    if (k === "upTo" && x === false) return undefined;
    if (k === "area" && Array.isArray(this.areas)) return undefined;
    if (k === "kind" && typeof x === "string" && x.startsWith("counter:")) return x.replace(/\s+/g, "");
    return x;
  }));
/** The record of `text` at `index` (or its only one), read whole, through the stored-row round trip and the language's print and reparse. */
function record(text: string, what: string, o: Partial<CardDef> = {}, index?: number): Rec {
  const recs = skillRecords(card(what, { skill: text, ...o }));
  const rec = index === undefined ? (assert.equal(recs.length, 1, `${what}: one record`), recs[0]) : recs.find((r) => r.skillIndex === index);
  assert.ok(rec, `${what}: a record at ${index}`);
  assert.deepEqual(rec.unread, [], `${what}: nothing unread (${rec.reads})`);
  const rule = asRule(rec);
  assert.equal(validateRule(rule, rec.kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  assert.deepEqual(plain(round.value), plain(rule), `${what}: …unchanged`);
  records++;
  return roundtrip(rec);
}
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "chooseMode" ? o.modes.flatMap((m) => opsDeep(m.ops)) : [])]);
const opOf = <K extends Op["op"]>(ops: Op[], op: K) => opsDeep(ops).filter((o): o is Extract<Op, { op: K }> => o.op === op);
const selOf = (o: { target?: unknown }): Selector => (o.target as { sel: Selector }).sel;
let records = 0;

// ── A. this face-up card; any card of the life ──────────────────────────────
{
  const BT12_005 = "[auto]{r}{r}, if your Leader Card is a red ≪Earthling≫-only card: When this card in your life is flipped face up by one of your red card skills, you may place the top card of your deck in your life, then play this face-up card from your life. If you didn't play a card, place this face-up card in your Drop Area from your life.";
  const rec = record(BT12_005, "AS3-FACEUP");
  const pick = opOf(rec.ops, "choose")[0];
  assert.deepEqual(pick.sel, { special: "self", area: "life" }, "A1 — the card played is this one, in the life");
  const dropped = opOf(rec.ops, "moveTo").find((o) => o.to === "drop")!;
  assert.deepEqual(selOf(dropped), { special: "self", area: "life" }, "A1 — the card dropped is this one");
  for (const text of [
    "[Permanent] During your opponent's turn, if you would add a card from your life to your hand or place it in your Drop Area, you may reveal it and add it to your hand instead.",
    "[Permanent] During your opponent's turn, if you would add a card from your life to your hand or place it in your Drop, you may reveal it and add it to your hand instead.",
  ]) {
    const life = record(text, "AS3-LIFE", { type: "LEADER" });
    assert.ok(life.reads.includes("if a card would move from your life"), `A2 — any card of the life: ${life.reads}`);
  }
}

// ── B. price changes ────────────────────────────────────────────────────────
{
  const cost = (text: string, what: string) => opOf(record(text, what).ops, "costReduction");
  const [beerus] = cost("[Permanent] The energy cost of <Beerus> in your hand is reduced by 1.", "AS3-TB1-031");
  assert.equal(selOf(beerus).count, 99, "B1 — every <Beerus> in the hand");
  const [maiden] = cost("[Permanent] Reduce the energy cost of ≪Maiden Squadron≫ in your hand by 2. (You must pay the specified cost even if it exceeds the reduced energy cost)", "AS3-TB1-062");
  assert.equal(selOf(maiden).count, 99, "B1 — every ≪Maiden Squadron≫");
  const both = cost("[Activate: Main][Once per turn] Choose 1 Clone Token in your opponent's Battle Area and remove it from the game: Choose up to 1 of your opponent's Battle Cards with an energy cost of 1, return it to its owner's hand, then reduce the combo cost of all blue and green cards in your hand and Battle Area by 1 for the duration of the turn.", "AS3-BT8-023b");
  assert.deepEqual(selOf(both[0]).areas, ["hand", "battle"], "B2 — the hand and the Battle Area");
  const [pole] = cost("[permanent] Reduce the energy cost of a {Power Pole} by {r}.", "AS3-POLE");
  assert.equal(selOf(pole).areas?.length, 12, "B3 — a {Power Pole} in all of your areas (Q&A BT21-001)");
  assert.equal(selOf(pole).side, "you");
  for (const text of ["[permanent] Reduce the skill cost of [swap] on your yellow <Frieza> cards by {y}.", "[permanent] Reduce the skill cost of [swap] on your yellow <Frieza> cards by {y}{2}."]) {
    const [swap] = cost(text, "AS3-SWAP");
    assert.equal(selOf(swap).area, "battle", "B4 — [Swap]'s price is the Battle Card's");
    assert.equal(swap.tag, "swap");
  }
  const [dabura] = cost("[Permanent] If all of your energy is black, reduce the energy cost of this card in your hand and Drop Area by 1.", "AS3-BT9-071");
  assert.deepEqual(selOf(dabura).areas, ["hand", "drop"], "B5 — this card in the hand and the Drop");
}

// ── C. both players' ────────────────────────────────────────────────────────
{
  const lock = opOf(record("[Counter: Play] Play this card, and Battle Cards with energy costs of 2 or less cannot attack until the start of your opponent's next turn.", "AS3-EX06-31").ops, "forbid")[0];
  assert.equal(selOf(lock).side, "both", "C1 — EX06-31's lock is both players' (R-321)");
  const korin = opOf(record("[Permanent] If your Leader is a yellow <Korin> card and you have a yellow originally skill-less Battle Card in play, this card and yellow non-≪Great Ape≫ <Son Goku: Childhood> cards with an energy cost of 5 or more get +10000 power.", "AS3-BT22-084").ops, "power");
  assert.equal(selOf(korin[1]).side, "both", "C1 — BT22-084's Son Goku: Childhood cards on either side (Q&A)");
  const cold = opOf(record("[Permanent] Reduce the energy costs of all  ≪Frieza Clan≫ whose original energy cost was 5 or more by 2.", "AS3-BT2-105").ops, "costReduction")[0];
  assert.equal(selOf(cold).side, "both", "C1 — BT2-105 both players' (Q&A)");
  const swapNext = opOf(record("[Activate: Main][Once per turn] If you have 4 or more energy: Draw 1 card, and the next time you activate a [Swap] skill on a ≪Goku's Lineage≫ card with an energy cost of 5 during this turn, reduce the skill cost by {y}.", "AS3-BT26-092").ops, "costReduction")[0];
  assert.equal(selOf(swapNext).side, "you", "C1 — one card of yours, whose activation it is");
  const u9 = opOf(record("[Permanent] Treat ≪Universe 9≫ cards in all areas as if they have no specified cost.", "AS3-P-268", { type: "LEADER" }).ops, "costReduction")[0];
  assert.equal(selOf(u9).side, "both", "C2 — in all areas, both players' (R-323, pending)");
  assert.equal(selOf(u9).areas?.length, 12);
  const kale = opOf(record("[auto] When a card evolves into this card, choose all Battle Cards with 25000 or less power other than this card or your <Caulifla>, and KO them.", "AS3-TB1-015").ops, "choose")[0];
  assert.equal(kale.sel.side, "opponent", "C3 — the opponent's cards as described");
  assert.deepEqual(kale.sel.filter?.notCharacters ?? [], [], "C3 — the opponent's <Caulifla> is not spared");
  assert.equal(kale.sel.alsoFrom?.[0].side, "you");
  assert.deepEqual(kale.sel.alsoFrom?.[0].filter?.notCharacters, ["Caulifla"], "C3 — your own <Caulifla> is spared");
}

// ── D. kinds and places ─────────────────────────────────────────────────────
{
  const sweep = opOf(record("[Activate: Main]{y}{y}{y}, if your Leader is yellow and you have 4 or more energy: Play this card from your hand then choose all of your opponent's Rest Mode Battle Cards and Unisons, ignoring [Barrier], and place them into their owner's Drop.", "AS3-BT28-149").ops, "choose")[1];
  assert.deepEqual(sweep.sel.filter?.anyOf?.map((a) => a.type), ["BATTLE", "UNISON"], "D1 — Battle Cards and Unisons, no Hidden Mode card or Field");
  const god = opOf(record("[activate: battle]{b}, remove this card in your Warp from the game: Choose up to 1 of your black ≪God≫ cards or black Unisons and it gets +10000 power for the battle.", "AS3-BT29-103").ops, "choose")[0];
  assert.equal(god.sel.area, "play", "D2 — a ≪God≫ card anywhere in play, or a Unison");
  const trunks = opOf(record("[activate: battle][once per turn] Add 1 card from your life to your hand: Choose up to 1 of your green cards with {Trunks} in its card name in your Battle Area or Unison Area, switch it to Active Mode, and it gains [double strike] for the turn.", "AS3-P-623b").ops, "choose")[0];
  assert.deepEqual(trunks.sel.areas, ["battle", "unison"], "D3 — both areas");
  assert.equal(trunks.sel.filter?.type ?? null, null, "D3 — an area's name is no card type");
  assert.deepEqual(trunks.sel.filter?.namesIncluding, ["Trunks"]);
  const lockAll = opOf(record("[+1][activate: main] Choose all of your opponent's skill-less Battle Cards and Battle Cards with 15000 power or less-all in Rest Mode-and they can't switch to Active Mode until the end of your opponent's turn.", "AS3-EX25-35").ops, "forbid")[0];
  assert.equal(selOf(lockAll).filter?.anyOf?.length, 2, "D4 — either description");
  const heroine = opOf(record("[+1][Activate: Main] At the end of the turn, switch up to 1 of your Leader Cards that's either mono-green or has ≪Heroine≫ to Active Mode, and it gains [Blocker] until the start of your next turn.", "AS3-P-330").ops, "choose")[0];
  assert.equal(heroine.sel.filter?.anyOf?.length, 2, "D5 — mono-green, or ≪Heroine≫");
  for (const text of [
    "[Auto][Limit 1] When this card attacks, use up to 1 of your opponent's ≪Earthling≫ cards with an energy cost of 1 or 1 Earthling Token in a combo in your Combo Area. If you do, this card gets +5000 power until the end of your opponent's turn.",
    "[auto] When this card attacks, use up to 1 of your opponent's ≪Earthling≫ cards with an energy cost of 1 or 1 of their Earthling Tokens in a combo in your Combo Area. If you do, this card gets +10000 power until the end of your opponent's turn.",
  ]) {
    const earthling = opOf(record(text, "AS3-EARTH").ops, "choose")[0];
    assert.equal(earthling.sel.side, "opponent", "D6 — the opponent's cards");
    assert.notEqual(earthling.sel.area, "combo", "D6 — not chosen in your Combo Area");
    const [a, b] = earthling.sel.filter?.anyOf ?? [];
    assert.ok(a?.traits.includes("earthling") && a.costMax === 1 && !a.token, "D6 — a ≪Earthling≫ card with an energy cost of 1");
    assert.ok(b?.token && b.names.includes("earthling") && b.costMax == null, "D6 — or an Earthling Token");
  }
  const ape = correctSkillText("P-415", "[activate: main] [once per turn] {g}, if your Leader is green and you have a [field] Extra in your Battle Area: Add up to 1 green Great Ape card with an energy cost of 4 or less and [blocker] from your Drop to your hand.")!;
  const added = opOf(record(ape, "AS3-P-415").ops, "choose")[0];
  assert.deepEqual(added.sel.filter?.traits.map((x) => x.toLowerCase()), ["great ape"], "D7 — P-415's ≪Great Ape≫");
}

// ── E. the card a combo is with ─────────────────────────────────────────────
{
  const pan = record("[auto]{1}: When this card is used in a combo from your hand with a ≪Heroine≫ card in your Leader Area or Battle Area, that card gets +5000 power and [double strike] for the battle.", "AS3-EB1-45");
  assert.deepEqual(pan.trigger, ["comboUsed"]);
  const boost = opOf(pan.ops, "power")[0];
  assert.equal(selOf(boost).battleRole, "any", "E1 — your card in the battle, not this one");
  assert.deepEqual(selOf(boost).filter?.traits, ["Heroine"]);
  const tien = record("[Auto] When you combo this card with a skill-less Battle Card with 10000 power, you may choose that card and switch it to Active Mode.", "AS3-DB2-003");
  assert.deepEqual(tien.trigger, ["comboUsed"], "E2 — this card's combo entry, not every combo");
  const picked = opOf(tien.ops, "choose")[0];
  assert.equal(picked.sel.battleRole, "any");
  assert.ok(picked.sel.upTo, "E2 — you may");
  assert.ok(tien.cond && JSON.stringify(tien.cond).includes("inBattle"), "E2 — the description is a condition");
  const yamcha = record("[Auto] If it's your turn: When this card is used in a combo with a red <Yamcha> card, it gets +5000 combo power for the battle.", "AS3-BT10-017");
  assert.deepEqual(selOf(opOf(yamcha.ops, "comboPower")[0]), { special: "self" }, "E3 — \"it\" is this card, the combo power's");
  assert.ok(JSON.stringify(yamcha.ops).includes("inBattle"), "E3 — with a red <Yamcha> in the battle");
  const cumber = record("[auto] If your Leader is a black <Cumber> card: When this card attacks, choose up to 1 of your opponent's cards with the [servant] skill and use it in a combo with this card.", "AS3-P-545");
  const used = opOf(cumber.ops, "comboFrom")[0];
  assert.deepEqual(used.target, { var: opOf(cumber.ops, "choose")[0].as }, "E5 — the chosen [Servant] card is used, not this one");
  const vegeta = record("[Auto][Once per turn] When your blue ≪Universe 6≫ card is played, draw 1 card. Additionally, if it's your opponent's turn, switch up to 1 of your blue energy to Active Mode, and the played card gains [Barrier] for the turn.", "AS3-BT26-033");
  assert.deepEqual(opOf(vegeta.ops, "grant")[0].target, { sel: { special: "subject" } }, "E6 — the played card is the moment's, not the energy");
  assert.ok(vegeta.reads.startsWith("if that card is a blue"), `E6 — the moment's description kept: ${vegeta.reads}`);
  const super17 = record("[Activate: Main][Limit 1] If this card is under a green <Super 17> card: Choose up to 1 of your opponent's Battle Cards and place it under a <Super 17> card on top of this card, then switch a <Super 17> card on top of this card to Active Mode at the end of the turn.", "AS3-EX23-27");
  const under = opOf(super17.ops, "moveTo")[0];
  assert.deepEqual(under.target, { var: opOf(super17.ops, "choose")[0].as }, "E7 — the chosen card goes under, not this one");
  assert.equal((under.under as { sel: Selector }).sel.special, "onTop", "E7 — under the <Super 17> on top of this card");
  const shenron = record("[Activate: Main] Choose 2 Battle Cards from your Drop Area with energy costs of 4 or less and 15000 power or more, and 2 Battle Cards from your opponent's Drop Area with energy costs of 4 or less and 15000 power or more: If your Leader Card is a ≪Shenron≫ card, play the chosen cards from your opponent's Drop Area in their Battle Area, then play the chosen cards from your Drop Area in your Battle Area in Rest Mode.", "AS3-BT6-116");
  const [theirs, mine] = opOf(shenron.ops, "play");
  assert.ok(theirs.toOwners && mine.mode === "rest" && !mine.toOwners, "E8 — the opponent's cards to their side, yours to yours in Rest Mode");
  assert.notDeepEqual(theirs.target, mine.target, "E8 — two choices, told apart by place");
  const universe = skillRecords(card("AS3-BT16-068", { skill: "[Auto] If your Leader Card is a green <Beerus> or green <Champa> card and you switch this card to Rest Mode: When your opponent attacks, choose 1 of your green Battle Cards in Rest Mode with the same ≪Universe≫ special trait as your Leader Card and switch the target of attack to that card." }))[0];
  assert.ok(universe.unread.some((u) => /same ≪Universe≫ special trait/.test(u)), "E9 — a trait measured against the Leader's is unread, an honest gap");
  const own = record("[auto] When this card is played from your hand, it gets +5000 power and [double strike] for the turn.", "AS3-BT16-119");
  assert.deepEqual(selOf(opOf(own.ops, "power")[0]), { special: "self" }, "E4 — \"it\" after \"when this card\" is this card");
}

// ── F. offers ───────────────────────────────────────────────────────────────
{
  const field = record("[Auto] When your opponent attacks with a card, you may choose 1 red card in your Energy Area, switch it to Rest Mode, and place this card in its owner's Drop Area. If you do, negate the attack.", "AS3-SD9-05", { type: "EXTRA" });
  const top = field.ops.find((o) => o.op === "moveTo");
  assert.equal(top, undefined, "F1 — the Field is not placed in the Drop outside the offer (R-322)");
  const gate = field.ops.find((o) => o.op === "if") as Extract<Op, { op: "if" }>;
  assert.ok(gate.then.some((o) => o.op === "moveTo") && gate.then.some((o) => o.op === "negateAttack"), "F1 — placed and negated only when taken");
  const ghost = record("[Auto] When your opponent attacks with a card, you may choose 1 yellow card in your hand and place it in your Drop Area, choose 1 of your yellow energy and switch it to Rest Mode, and place this card in its owner's Drop Area. If you do, negate the attack.", "AS3-P-129", { type: "EXTRA" });
  assert.ok(!ghost.ops.some((o) => o.op === "moveTo" && "sel" in o.target && o.target.sel.special === "self"), "F1 — P-129 likewise");
  const awaken = record("[Awaken] When your life is at 4 or less or your opponent's Leader Card's back is facing up: You may switch up to 1 of your energy to Active Mode, have this card get +5000 power for the turn, and flip this card over.", "AS3-BT15-061", { type: "LEADER" });
  assert.ok(awaken.ops.some((o) => o.op === "power"), "F1 — an offer of up to 1 hangs nothing on itself");
  const counter = record("[Counter: Play] When the Battle Card is played, you may choose it and switch it to Rest Mode, then draw 1 card.", "AS3-DB2-126", { type: "EXTRA" });
  assert.ok(counter.ops.some((o) => o.op === "draw"), "F1 — no \"If you do\": the draw is not hung on the offer (phrasing batch 5)");
  for (const [text, what] of [
    ["[Auto] When one of your opponent's cards attacks, you may choose that card and it gets -10000 power for the turn.", "AS3-DB2-023"],
    ["[Counter: Play] When the Battle Card is played, choose up to 1 of those Battle Cards and it gets -15000 power for the duration of the turn.", "AS3-DB1-020"],
  ] as const) {
    const r = record(text, what, what === "AS3-DB1-020" ? { type: "EXTRA" } : {});
    assert.ok(r.reads.startsWith("you may choose"), `F2 — ${what}: ${r.reads}`);
  }
  const p434 = record("[Awaken] When your life is at 4 or less or 2 or more ≪Villainous≫ cards are in your energy: You may draw 2 cards, and add cards from your life to your hand until you have 6 life left.", "AS3-P-434", { type: "LEADER" });
  assert.deepEqual(p434.ops.map((o) => o.op), ["draw", "lifeDownTo"], "F3 — both the [Awaken]'s (R-320)");
  const sd14 = record("[Awaken] When your life is at 4 or less or you have 20 or more cards in your Drop Area: You may draw 1 card, switch up to 1 of your energy to Active Mode, add cards from your life to your hand until you have 6 cards in your life, and flip this card over.", "AS3-SD14-01", { type: "LEADER" });
  assert.equal(opOf(sd14.ops, "lifeDownTo")[0]?.n, 6, "F3 — life down to 6, not 6 cards of the hand to the life");
}

// ── G. replacements ─────────────────────────────────────────────────────────
{
  const tcc = record("[Permanent] If a ≪Turles Crusher Corps≫ card in your Battle Area would be placed in its owner's Drop Area by one of your skills, it's sent to its owner's Warp instead.", "AS3-BT12-056", { type: "LEADER" });
  assert.ok(tcc.reads.startsWith("if a ≪turles crusher corps≫ card"), `G1 — ${tcc.reads}`);
  const goku = record("[permanent] When a black <Son Goku: Childhood> card with an energy cost of 2 or more would be removed from your Battle Area by an opponent's skill, you may place this card in its owner's Drop instead.", "AS3-BT19-136");
  const sub = goku.ops[0] as Extract<Op, { op: "replace" }>;
  assert.equal(sub.op, "replace", "G2 — a substitute, not a redirect of the Goku");
  assert.deepEqual((sub.with[0] as Extract<Op, { op: "moveTo" }>).target, { sel: { special: "self" } }, "G2 — this card goes to the Drop");
  assert.ok(sub.optional);
}

// ── H. the review's repairs ─────────────────────────────────────────────────
{
  // H1: P-129's offer — one gate over the rest of the sentence, the switch of the energy it chose inside it.
  const ghost = record("[Auto] When your opponent attacks with a card, you may choose 1 yellow card in your hand and place it in your Drop Area, choose 1 of your yellow energy and switch it to Rest Mode, and place this card in its owner's Drop Area. If you do, negate the attack.", "AS3-H-P129", { type: "EXTRA" });
  const gate = ghost.ops.find((o) => o.op === "if" && o.then.some((x) => x.op === "choose")) as Extract<Op, { op: "if" }>;
  assert.deepEqual(gate.then.map((o) => o.op), ["choose", "switchMode", "moveTo"], "H1 — the energy chosen, switched and this card dropped under one gate");
  // H2: DB3-129 — the counter answered when it is a Battle Card's [Counter: Attack].
  const stop = record("[Counter: Counter] If your Leader Card is red and you choose 1 red card in your hand and discard it: Negate the Battle Card's [Counter: Attack] skill, then switch up to 1 of your blue energy to Active Mode at the end of the turn.", "AS3-H-DB3129", { type: "EXTRA" });
  const answered = opOf(stop.ops, "if").find((o) => o.cond.kind === "countering");
  assert.deepEqual(answered?.cond, { kind: "countering", what: "attack", of: "BATTLE" }, "H2 — a Battle Card's [Counter: Attack]");
  assert.equal(opOf(stop.ops, "negateSkillsOfKind").length, 0, "H2 — not the [Counter] skills of a Battle Card of yours");
  // H3: the [Blocker] ban of one card's attack (DB3-014's [Permanent], DB3-023's chosen card).
  const own = opOf(record("[Permanent] If your Leader Card is red, your opponent can't activate [Blocker] skills in response to this card's attack.", "AS3-H-DB3014").ops, "forbid")[0];
  assert.deepEqual(own.attacker, { sel: { special: "self" } }, "H3 — this card's attack only");
  const chosen = record("[Activate: Main] If your Leader Card is red: Draw 1 card, then choose 1 of your red cards and your opponent can't activate [Blocker] skills in response to that card's attack for the turn.", "AS3-H-DB3023");
  const lock = opOf(chosen.ops, "forbid")[0];
  assert.deepEqual(lock.attacker, { var: opOf(chosen.ops, "choose")[0].as }, "H3 — the chosen card's attack only");
  assert.equal(lock.until, "turn");
  // H4: P-093 — a Battle Card is one in a Battle Area (Q&A: the Drop's skills and combo [Auto]s still work); "in any Area" stays every area.
  const ban = opOf(record("[auto] [sparking 10] (This skill takes effect when you have 10 or more cards in your Drop Area.) When a card evolves into this card, your opponent can't activate skills on Battle Cards for the duration of the turn.", "AS3-H-P093").ops, "forbid");
  assert.equal(ban.find((o) => o.what === "activateSkill")?.fromArea, "battle", "H4 — the skills of Battle Cards in a Battle Area");
  assert.ok(ban.some((o) => o.what === "activateCounter") && ban.some((o) => o.what === "block"), "H4 — [Counter] lines and [Blocker] stay A2's");
  // H5: BT18-008 — "the Z-Battle Card" is the one this card was placed under.
  const pan = record("[Auto] If your Leader is a <Pan> card: When this card is placed under one of your Z-Battle Cards, the Z-Battle Card gets +5000 power for the turn.", "AS3-H-BT18008");
  assert.equal(selOf(opOf(pan.ops, "power")[0]).special, "onTop", "H5 — the card on top of this one, not every Z-Battle Card");
  // H6: BT21-118 — "all of the chosen cards" is the price's two energy and the effect's <Vegeta>, under names of their own.
  const vegeta = skillRecords(card("AS3-H-BT21118", { skill: "[activate: main][limit 1] If you have 3 or more energy, you choose 2 of your energy in Rest Mode, and you place this card in your Drop: Choose up to 1 of your yellow <Vegeta> cards with an energy cost of 2, switch it to Active Mode, and all of the chosen cards will not switch to Active Mode during your next Charge Phase." }))[0];
  assert.deepEqual(vegeta.unread, []);
  const priceVar = (vegeta.cost?.program ?? []).find((o) => o.op === "choose")?.as;
  const locked = opOf(vegeta.ops as Op[], "forbid").map((o) => (o.target as { var: string }).var);
  assert.ok(priceVar && locked.includes(priceVar) && locked.includes(opOf(vegeta.ops as Op[], "choose")[0].as) && new Set(locked).size === 2, `H6 — the price's energy and the <Vegeta> (${JSON.stringify(locked)} / ${priceVar})`);
  // H7: control of a Unison is not a thing the engine does — unread rather than a Unison landing in the Battle Area.
  for (const text of ["[auto][spirit boost 2] When this card is played from your hand, choose 1 of your opponent's Unison Cards and gain control of it.", "[Activate: Main] Choose up to 1 of your opponent's Battle Cards or Unisons and switch it to Active Mode, then gain control of it."]) {
    const rec = skillRecords(card("AS3-H-UNICTRL", { skill: text }))[0];
    assert.ok(rec.unread.some((u) => /gain control of it/.test(u)), `H7 — unread: ${rec.reads}`);
  }
  assert.deepEqual(record("[auto] When this card is played, choose up to 1 of your opponent's Battle Cards and gain control of it.", "AS3-H-CTRL").ops.map((o) => o.op), ["choose", "moveTo"], "H7 — a Battle Card's control stays read");
  // H8: P-645 — "in Active Mode or Rest Mode" is the player's pick of the play, not the host's mode.
  const buu = record("[Auto][Limit 1] If your Leader is a green <Majin Buu> card and you have 3 or more energy: When this card is played, draw 1 card, play up to 1 {Majin Buu, Unadulterated Destruction} from under your green <Majin Buu> card in Active Mode or Rest Mode, and it gains [Double Strike] for the turn.", "AS3-H-P645");
  const both = opOf(buu.ops, "chooseMode")[0];
  assert.deepEqual(both.modes.map((m) => (m.ops[0] as Extract<Op, { op: "play" }>).mode ?? "active"), ["active", "rest"], "H8 — Active or Rest, the player's pick");
  assert.equal(opOf(buu.ops, "choose")[0].sel.underHost?.mode, undefined, "H8 — the host's mode is not asked");
}

// ── the VM ──────────────────────────────────────────────────────────────────
const vmDefs: Record<string, CardDef> = {
  ...CTX.defs,
  "AS3-DROPCOST": card("AS3-DROPCOST", { energyCost: 3, skill: "[Permanent] Reduce the energy cost of this card in your hand and Drop Area by 1." }),
  "AS3-SWAPRED": card("AS3-SWAPRED", { skill: "[permanent] Reduce the skill cost of [swap] on your yellow <AS3 Frieza> cards by {y}." }),
  "AS3-FRIEZA": card("AS3-FRIEZA", { colors: ["Yellow"], characters: ["AS3 Frieza"] }),
  "AS3-SWEEP": card("AS3-SWEEP", { power: 30000, skill: "[Activate: Main] Choose all Battle Cards with 25000 or less power other than this card or your <AS3 Caulifla>, and KO them." }),
  "AS3-CAUL": card("AS3-CAUL", { characters: ["AS3 Caulifla"], power: 10000 }),
  "AS3-SMALL": card("AS3-SMALL", { power: 10000 }),
  // H: the review's repairs, in play.
  "AS3-NOBLOCK": card("AS3-NOBLOCK", { skill: "[Permanent] Your opponent can't activate [Blocker] skills in response to this card's attack." }),
  "AS3-PICKNOBLOCK": card("AS3-PICKNOBLOCK", { skill: "[Activate: Main] Choose 1 of your Battle Cards and your opponent can't activate [Blocker] skills in response to that card's attack for the turn." }),
  "AS3-WALL": card("AS3-WALL", { power: 5000, skill: "[Blocker]" }),
  "AS3-CATK": card("AS3-CATK", { type: "EXTRA", power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack] Negate the attack." }),
  "AS3-BCATK": card("AS3-BCATK", { skill: "[Counter: Attack] Negate the attack." }),
  "AS3-STOPBC": card("AS3-STOPBC", { type: "EXTRA", power: null, comboCost: null, comboPower: null, skill: "[Counter: Counter] Negate the Battle Card's [Counter: Attack] skill." }),
  "AS3-SKILLBAN": card("AS3-SKILLBAN", { skill: "[Activate: Main] Your opponent can't activate skills on Battle Cards for the turn." }),
};
const vmRows = Object.values(vmDefs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs: vmDefs, scripts: rulesFromRows(roundtrip(vmRows), vmDefs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const take = (s: VmState, action: Action): VmState => roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
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
type Prompt = VmState["prompt"];
function settle(s0: VmState, pick: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[]): VmState {
  let s = s0;
  for (let i = 0; i < 60 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: pick(q) });
    else if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: null } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.equal(s.prompt.kind, "main", "settled");
  return s;
}
/** The [Blocker]s offered against an attack on the opponent's Leader by `attacker` (counters passed). */
function blockersFor(s0: VmState, attacker: string): string[] {
  const seat = s0.turnPlayer;
  let s = take(s0, { type: "attack", player: seat, attacker, target: s0.sides[other(seat)].zones.leader[0] } as Action);
  for (let i = 0; i < 20 && s.prompt.kind !== "blocker" && s.prompt.kind !== "main"; i++) {
    const q = s.prompt as { kind: string; player: PlayerId };
    s = take(s, q.kind === "counter" ? ({ type: "counter", player: q.player, card: null } as Action) : ({ type: "pass", player: q.player } as Action));
  }
  return s.prompt.kind === "blocker" ? [...s.prompt.candidates] : [];
}
let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  // B5: "this card in your hand and Drop Area" holds in the Drop too, and nowhere else.
  {
    const s = fresh(seat, 61000 + (seat === "p1" ? 0 : 1));
    const inDrop = stage(s, seat, "AS3-DROPCOST", "drop");
    const inHand = stage(s, seat, "AS3-DROPCOST", "hand");
    const inPlay = stage(s, seat, "AS3-DROPCOST", "battle");
    // The change stands on the card in the Drop and in the hand (the price a play reads, `kind: "cost"`), never in play.
    const cut = (id: string) => staticsNow(ctx, game, s).filter((e) => e.kind === "cost" && e.target === id).reduce((n, e) => n + (e.value as number), 0);
    assert.equal(cut(inDrop), 1, `${seat}: B5 — 1 less in the Drop`);
    assert.equal(cut(inHand), 1, `${seat}: B5 — 1 less in the hand`);
    assert.equal(cut(inPlay), 0, `${seat}: B5 — not in the Battle Area`);
    assert.equal(attrsNow(ctx, game, s, inPlay).energyCost, 3);
    cases++;
  }
  // B4: the [Swap] price change stands on the yellow <Frieza> in the Battle Area, not in the hand.
  {
    const s = fresh(seat, 61100 + (seat === "p1" ? 0 : 1));
    stage(s, seat, "AS3-SWAPRED", "battle");
    const fighting = stage(s, seat, "AS3-FRIEZA", "battle");
    const held = stage(s, seat, "AS3-FRIEZA", "hand");
    const changes = staticsNow(ctx, game, s).filter((e) => e.kind === "skillCost");
    assert.ok(changes.some((e) => e.target === fighting), `${seat}: B4 — on the Battle Card`);
    assert.ok(!changes.some((e) => e.target === held), `${seat}: B4 — not on the one in hand`);
    cases++;
  }
  // C3: the sweep KOs the opponent's <Caulifla> and spares yours.
  {
    let s = fresh(seat, 61200 + (seat === "p1" ? 0 : 1));
    const me = stage(s, seat, "AS3-SWEEP", "battle");
    const mine = stage(s, seat, "AS3-CAUL", "battle");
    const mySmall = stage(s, seat, "AS3-SMALL", "battle");
    const theirs = stage(s, foe, "AS3-CAUL", "battle");
    const theirSmall = stage(s, foe, "AS3-SMALL", "battle");
    const offer = RULES.legalActions(ctx, s).find((l) => (l.action as { card?: string }).card === me && l.action.type === "activate");
    assert.ok(offer, `${seat}: C3 — offered`);
    s = settle(take(s, offer.action), (q) => q.choice.candidates);
    assert.ok(s.sides[seat].zones.battle.includes(mine), `${seat}: C3 — your <Caulifla> is spared`);
    assert.ok(s.sides[seat].zones.battle.includes(me), `${seat}: C3 — this card is spared`);
    for (const id of [mySmall, theirs, theirSmall]) assert.ok(s.sides[seat].zones.drop.includes(id) || s.sides[foe].zones.drop.includes(id), `${seat}: C3 — ${s.cards[id].cardId} KO'd`);
    cases++;
  }
  // H3: "…can't activate [Blocker] skills in response to this card's attack" — that card's attack, no other.
  {
    const s = fresh(seat, 61300 + (seat === "p1" ? 0 : 1));
    const me = stage(s, seat, "AS3-NOBLOCK", "battle");
    const plain = stage(s, seat, "AS3-SMALL", "battle");
    const wall = stage(s, foe, "AS3-WALL", "battle");
    assert.deepEqual(blockersFor(s, me), [], `${seat}: H3 — no [Blocker] against this card's attack`);
    assert.deepEqual(blockersFor(s, plain), [wall], `${seat}: H3 — …and the other card's attack can be blocked`);
    cases++;
  }
  // H3: "…in response to that card's attack for the turn" — the chosen card's.
  {
    let s = fresh(seat, 61400 + (seat === "p1" ? 0 : 1));
    const me = stage(s, seat, "AS3-PICKNOBLOCK", "battle");
    const picked = stage(s, seat, "AS3-SMALL", "battle");
    const wall = stage(s, foe, "AS3-WALL", "battle");
    const offer = RULES.legalActions(ctx, s).find((l) => (l.action as { card?: string }).card === me && l.action.type === "activate");
    assert.ok(offer, `${seat}: H3 — offered`);
    s = settle(take(s, offer.action), () => [picked]);
    assert.deepEqual(blockersFor(s, picked), [], `${seat}: H3 — the chosen card's attack can't be blocked`);
    assert.deepEqual(blockersFor(s, me), [wall], `${seat}: H3 — …another's can`);
    cases++;
  }
  // H2: "Negate the Battle Card's [Counter: Attack] skill" — a Battle Card's counter negated (the attack hits), an
  // Extra's left standing (the attack is negated).
  for (const [answer, negated] of [["AS3-BCATK", true], ["AS3-CATK", false]] as const) {
    let s = fresh(seat, 61500 + (seat === "p1" ? 0 : 1) + (negated ? 0 : 10));
    for (let i = 0; i < 2; i++) stage(s, seat, "V1", "energy");
    for (let i = 0; i < 2; i++) stage(s, foe, "V1", "energy");
    const counter = stage(s, foe, answer, "hand");
    const stop = stage(s, seat, "AS3-STOPBC", "hand");
    const lifeBefore = s.sides[foe].zones.life.length;
    s = take(s, { type: "attack", player: seat, attacker: s.sides[seat].zones.leader[0], target: s.sides[foe].zones.leader[0] } as Action);
    assert.equal(s.prompt.kind, "counter", `${seat}: H2 — the attack window`);
    s = take(s, { type: "counter", player: foe, card: counter } as Action);
    assert.equal(s.prompt.kind, "counter", `${seat}: H2 — the [Counter: Counter] window`);
    s = take(s, { type: "counter", player: seat, card: stop } as Action);
    s = settle(s, (q) => q.choice.candidates.slice(0, 1));
    if (negated) assert.ok(s.sides[foe].zones.life.length < lifeBefore, `${seat}: H2 — the Battle Card's [Counter: Attack] negated, the attack hit`);
    else assert.equal(s.sides[foe].zones.life.length, lifeBefore, `${seat}: H2 — an Extra's [Counter: Attack] is not the Battle Card's: the attack was negated`);
    cases++;
  }
  // H4: "…can't activate skills on Battle Cards" — the ones in a Battle Area (Q&A P-093), not a Battle Card in the Drop.
  {
    let s = fresh(seat, 61600 + (seat === "p1" ? 0 : 1));
    const me = stage(s, seat, "AS3-SKILLBAN", "battle");
    const inPlay = stage(s, foe, "AS3-PICKNOBLOCK", "battle");
    const inDrop = stage(s, foe, "AS3-PICKNOBLOCK", "drop");
    const offer = RULES.legalActions(ctx, s).find((l) => (l.action as { card?: string }).card === me && l.action.type === "activate");
    assert.ok(offer, `${seat}: H4 — offered`);
    s = settle(take(s, offer.action), (q) => q.choice.candidates);
    assert.ok(forbids(ctx, game, s, "activateSkill", { player: foe, card: inPlay }), `${seat}: H4 — a Battle Card in the Battle Area is banned`);
    assert.ok(!forbids(ctx, game, s, "activateSkill", { player: foe, card: inDrop }), `${seat}: H4 — …one in the Drop is not`);
    cases++;
  }
}
console.log(`verify/audit-selectors-3: ${records} records, ${cases} VM cases`);
