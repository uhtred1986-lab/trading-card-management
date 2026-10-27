/**
 * Mechanism batch 1 (27 Oct 2026): delayed effects (1-7-2-1-1) and replacement effects (9-10). Printed text inline
 * (catalog text of the open-rules export of 26 Oct 2026, with the catalog's errata applied; costs, powers and companions in
 * the VM cases are synthetic).
 *
 * R1: departures from the Combo Area — "would leave your Combo Area", "placed in a Drop (Area) from a Combo Area", "you
 *     would place … from your Combo Area in your Drop", "removed from a Battle Area or Combo Area", and an [Auto]'s redirect
 *     "this turn" (BT17-145).
 * R2: substitutes gated on the pile under the card (P-436, BT17-144, BT20-149), the Rest Mode opener (EX24-37), "you may
 *     instead" (BT6-094), "once per turn" at the end (BT22-139), other cards' KO (BT18-060b), "KO'd in battle" (BT17-139).
 * R3: the battle's KO asks 9-10-2/9-10-3's question (it took only a mandatory, question-free replacement before).
 * R4: [Counter: Play] — "the Battle Card your opponent is playing" (DB1-040, BT7-047, TB3-048, BT7-110).
 * D: a timed special trait (BT19-124), "gains the [Servant] skill" (BT13-075), `comboRest` through the opponent's turn
 *    (BT24-027, BT27-022), one attack in the opponent's next turn (BT11-132, BT11-093, P-330), "you switch … at the end of
 *    the turn" (BT27-028), "is sent to your Warp at the end of the battle" (P-207).
 *
 * Proved here: the records (nothing unread, the stored-row JSON round trip, the rules language's print and reparse), what
 * stays unread on purpose, and in the VM for both seats with every action reloaded from JSON.
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
import type { Op } from "../../src/lib/arena/vm/script";
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
/** The record of `text` at `index`, read whole, through the stored-row round trip and the language's print and reparse. */
function record(text: string, what: string, index: number, o: Partial<CardDef> = {}): Rec {
  const recs = skillRecords(card(what, { skill: text, ...o }));
  const rec = recs.find((r) => r.skillIndex === index);
  assert.ok(rec, `${what}: a record at ${index}`);
  assert.deepEqual(rec.unread, [], `${what}: nothing unread`);
  const rule = asRule(rec);
  assert.equal(validateRule(rule, rec.kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  assert.deepEqual(plain(round.value), plain(rule), `${what}: …unchanged`);
  return roundtrip(rec);
}
/** A Leader's back side, read the same way. */
function backRecord(text: string, what: string, index: number): Rec {
  const recs = skillRecords(card(what, { type: "LEADER", skill: "", back: { name: what, power: 10000, skill: text } } as Partial<CardDef>));
  const rec = recs.find((r) => r.skillIndex === index && (r as { side?: string }).side === "back");
  assert.ok(rec, `${what}: a back record at ${index}`);
  assert.deepEqual(rec.unread, [], `${what}: nothing unread`);
  const rule = asRule(rec);
  assert.equal(validateRule(rule, rec.kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  assert.deepEqual(plain(round.value), plain(rule), `${what}: …unchanged`);
  return roundtrip(rec);
}
const unreadOf = (text: string, index = 0) => skillRecords(card("U", { skill: text })).find((r) => r.skillIndex === index)!.unread;
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "replace" ? opsDeep(o.with) : [])]);
const opOf = <K extends Op["op"]>(rec: Rec, op: K) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: K }> => o.op === op);
let records = 0;

// R1. Departures from the Combo Area.
for (const [text, what, index, to, from, requestedTo, sub] of [
  ["[Super Combo]<br>[Permanent] If this card would leave your Combo Area, remove it from the game instead.<br>[Auto][Limit 1] If your Leader Card is a blue ≪Bardock's Crew≫ card, your life is at 3 or less, and you have 3 or more energy: When this card is used in a combo from your hand, choose up to 1 mono-blue &lt;Bardock&gt; card with an energy cost of 5 or less in your hand and play it in Rest Mode.", "EX19-07", 10, "removed", "combo", undefined, null],
  ["[super combo]<br>[permanent] If this card would leave your Combo Area, remove it from the game instead.<br>[auto][limit 1] If your Leader Card is a red <Frieza: Br> card, your life is at 3 or less, and it's your opponent's turn: When this card is used in a combo from your hand, the next time you would activate a mono-red Extra Card with an original energy cost of 3 or less this turn, reduce its activation cost by {r}.", "EX19-05", 10, "removed", "combo", undefined, null],
  ["[energy-exhaust]<br>[permanent] When this card is placed in a Drop Area from a Combo Area, it is sent to its owner's Warp instead.<br>[activate: battle]{g}, if your Leader Card is red: Combo with this card from your Battle Area or Drop Area.", "P-182", 10, "warp", "combo", "drop", null],
  ["[double strike][servant]<br>[permanent] When this card is placed in your Drop from your Battle Area or Combo Area, place it at the bottom of its owner's deck instead.", "BT18-133", 10, "deck", "battle,combo", "drop", null],
  ["[Permanent] When you would place a ≪Universe 7≫ card from your Combo Area in your Drop, place it in your Z-Energy instead.<br>[Permanent] You can't play Z-Battle Cards.<br>[Auto][Once per turn] When your yellow ≪Universe 7≫ card is used in a combo, draw 1 card.", "BT23-099", 0, "zEnergy", "combo", "drop", "universe 7"],
] as const) {
  const rec = record(text, what, index);
  const r = opOf(rec, "replaceLeave")[0];
  assert.ok(r, `R1: ${what} — a redirect`);
  assert.equal(r.to, to, `R1: ${what} — to ${to}`);
  assert.equal(r.from?.join(), from, `R1: ${what} — from ${from}`);
  assert.equal(r.requestedTo, requestedTo, `R1: ${what} — ${requestedTo ? "only the move to the Drop" : "every departure"}`);
  if (sub) assert.ok(r.target && "sel" in r.target && r.target.sel.area === "combo" && r.target.sel.filter?.traits.includes(sub), `R1: ${what} — each of your ≪${sub}≫ combo cards`);
  else assert.ok(r.target && "sel" in r.target && r.target.sel.special === "self", `R1: ${what} — this card`);
  records++;
}
{
  const bt18 = backRecord("[Permanent] When you would place a card from your Combo Area in your Drop, remove it from the game instead.<br>[Auto] Send 1 ≪Demon Realm Race≫ or ≪Demon God≫ card from your hand to your Warp: When this card attacks, draw 2 cards.", "BT18-122", 0);
  const r = opOf(bt18, "replaceLeave")[0];
  assert.ok(r && r.to === "removed" && r.from?.join() === "combo" && r.requestedTo === "drop" && r.target && "sel" in r.target && r.target.sel.area === "combo" && r.target.sel.side === "you", "R1: BT18-122b — every card of yours in the Combo Area");
  const bt31 = backRecord("[auto] At the end of your opponent's turn, flip this card to its front side.<br>[permanent] If your Battle Card would be removed from a Battle Area or Combo Area, remove it from the game instead.", "BT31-055", 10);
  const r2 = opOf(bt31, "replaceLeave")[0];
  assert.ok(r2 && r2.to === "removed" && r2.from?.join() === "battle,combo" && !r2.by && r2.target && "sel" in r2.target && r2.target.sel.areas?.join() === "battle,combo" && r2.target.sel.filter?.type === "BATTLE", "R1: BT31-055b — your Battle Cards in either area, any cause");
  const BT17_145 = "[energy-exhaust][double strike][dual attack]\r [ex-evolve]{3}: <Cell> with an energy cost of 8 or 9.\r [auto][once per turn] When this card attacks, choose 1 card in your opponent's hand and discard it.\r [auto] When this card is used in a combo from your Drop Area, if it would leave your Combo Area this turn, remove it from the game instead.\r [activate: battle]{1}: Use this card in a combo from your Drop Area.";
  const bt17 = record(BT17_145, "BT17-145", 30);
  const r3 = opOf(bt17, "replaceLeave")[0];
  assert.ok(r3 && r3.to === "removed" && r3.from?.join() === "combo" && r3.until === "turn", "R1: BT17-145 — the [Auto]'s redirect lasts the turn");
  assert.deepEqual((bt17 as { combo?: { origins?: string[] } }).combo?.origins, ["drop"], "R1: BT17-145 — only a combo from the Drop Area");
  records += 3;
}
// The obsolete DB2 wording stays unread (the catalog corrects it, errata #920).
assert.ok(unreadOf("[Permanent] When this card is placed in a Drop Area from a Battle Area or Combo Area, place it at the bottom of its owner's deck instead.").length > 0, "R1: the obsolete DB2 wording stays unread");
// "When this card would be placed in a Drop" (P-413) names every area, which the engine does not watch: unread.
assert.ok(unreadOf("[permanent] When this card would be placed in a Drop, place it at the bottom of its owner's deck instead.").length > 0, "R1: P-413 stays unread");

// R2. Substitutes and their gates.
for (const [text, what, index] of [
  ["[energy-exhaust][deflect][blocker]<br>[permanent] If this card has 1 or more cards under it and would be removed from your Battle Area by an opponent's skill, you may place all of the cards under this card in their owners' Drops instead.", "P-436", 0],
  ["[energy-exhaust][critical][double strike] [permanent] If this card has 1 or more cards under it and would be removed from your Battle Area by an opponent's skill, you may place all of the cards under this card in their owners' Drop Areas instead.", "BT17-144", 0],
  ["[Ultimate][Blocker]<br>[Permanent] When this card would be removed from your Battle Area by an opponent's skill, if 1 or more cards are under this card, you may place all cards from under this card in their owners' Drops instead.", "BT20-149", 0],
] as const) {
  const recs = skillRecords(card(what, { skill: text }));
  const idx = recs.find((r) => r.kind === "permanent" && r.ops.some((o) => o.op === "replace" || o.op === "if"))!.skillIndex;
  const rec = record(text, what, idx ?? index);
  const r = opOf(rec, "replace")[0];
  assert.ok(r && r.event === "leave" && r.by === "skillOrKoBySkill" && r.bySide === "opponent" && r.optional, `R2: ${what} — the opponent's skill removing it, an offer`);
  assert.ok(r.with.length === 1 && r.with[0].op === "moveTo" && r.with[0].to === "drop", `R2: ${what} — …the pile to the Drop instead`);
  const gate = rec.cond ?? (rec.ops[0]?.op === "if" ? rec.ops[0].cond : null);
  assert.ok(gate && gate.kind === "count" && "area" in gate.sel && gate.sel.area === "under" && gate.atLeast === 1, `R2: ${what} — only with a card under it`);
  records++;
}
{
  const ex24 = record("[servant] <br> [permanent] If your life is at 1 and this card in Rest Mode would be KO'd, once per turn you may switch this card to Active Mode instead.", "EX24-37", 10);
  const r = opOf(ex24, "replace")[0];
  assert.ok(r && r.event === "ko" && r.optional && r.with.some((o) => o.op === "switchMode") && r.with.some((o) => o.op === "negateOwnSkill"), "R2: EX24-37 — the KO replaced by the switch, once a turn");
  assert.ok(opsDeep(ex24.ops).some((o) => o.op === "if" && o.cond.kind === "count" && "special" in o.cond.sel && o.cond.sel.special === "self" && o.cond.sel.mode === "rest"), "R2: EX24-37 — only while it is in Rest Mode");
  const bt6 = record("[Permanent] If this card would be KO'd, you may instead place 1 ≪Boujack Brigade≫ card other than this card from your Battle Area into your Drop Area.", "BT6-094", 0);
  const r2 = opOf(bt6, "replace")[0];
  assert.ok(r2 && r2.event === "ko" && r2.optional && r2.with.some((o) => o.op === "choose" && o.sel.filter?.traits.includes("boujack brigade")), "R2: BT6-094 — the offer with the adverb in front");
  const bt22 = record("[ultimate][double strike]<br>[permanent] If this card would be removed from a Battle Area by an opponent's skill, you may add 1 card from your life to your hand once per turn instead.", "BT22-139", 10);
  const r3 = opOf(bt22, "replace")[0];
  assert.ok(r3 && r3.optional && r3.with.at(-1)?.op === "negateOwnSkill", "R2: BT22-139 — once a turn, printed at the end");
  const bt18 = backRecord("[Permanent] When one of your ≪Namekian≫ or ≪Demon Clan≫ cards would be KO'd by an opponent's skill, you may place 1 ≪Demon Clan≫ card from your Z-Energy in your Drop instead.", "BT18-060", 0);
  const r4 = opOf(bt18, "replace")[0];
  assert.ok(r4 && r4.event === "ko" && r4.bySide === "opponent" && r4.target && "sel" in r4.target && r4.target.sel.area === "battle", "R2: BT18-060b — each of your cards that fits, by an opponent's skill");
  const bt17 = record("[Energy-Exhaust][Critical] [Permanent] Once per turn, if this card would be KO'd in battle, you may place 1 card from under this card in its owner's Drop Area instead.", "BT17-139", 0);
  const r5 = opOf(bt17, "replace")[0];
  assert.ok(r5 && r5.event === "ko" && r5.by === "koInBattle" && r5.optional && r5.with.at(-1)?.op === "negateOwnSkill", "R2: BT17-139 — the battle's KO only, once a turn");
  records += 5;
}

// R4. [Counter: Play].
for (const [text, what, instead] of [
  ["[Counter: Play] If the Battle Card your opponent is playing has an energy cost of 2 or less, it is returned to its owner's hand instead of being played, then choose up to 1 of your blue Battle Cards with an energy cost of 3 or less and return it to its owner's hand.", "DB1-040", "hand"],
  ["[Counter: Play] If your Leader Card is blue: If the Battle Card your opponent is playing has an energy cost of 4 or less, it is returned to its owner's hand instead of being played.", "BT7-047", "hand"],
  ["[Counter: Play] If your Leader Card is green and the Battle Card your opponent is playing has an energy cost of 4 or less, it is placed in its owner's Drop Area instead of being played.", "TB3-048", "drop"],
  ["[Counter: Play] If your opponent has 3 or more Battle Cards in play with energy costs of 2 or more, the Battle Card your opponent is playing is placed in its owner's Drop Area instead, then choose all Battle Cards with energy costs of 2 or less, ignoring [Barrier], and send them to their owners' Warps.", "BT7-110", "drop"],
] as const) {
  const rec = record(text, what, 0);
  const p = opOf(rec, "resolvingPlay")[0];
  assert.ok(p && p.instead === instead, `R4: ${what} — not played, to the ${instead}`);
  records++;
}
assert.ok(unreadOf("[Counter: Play] Play this card. Additionally, if the Battle Card to be played has an energy cost of 7 or less, send it to your Warp instead.").length > 0, "R4: BT21-149's 'to be played' stays unread");

// D. Timed and delayed effects.
{
  const bt19 = record("[Activate: Main][Once per turn] Choose up to 1 of your Battle Cards with &lt;Son Gohan&gt; in its character name, and it gains ≪Master's Teachings≫ until the end of your opponent's next turn.", "BT19-124", 0);
  const m = opOf(bt19, "modifyAttr")[0];
  assert.ok(m && m.attr === "traits" && m.values?.join() === "Master's Teachings".toLowerCase() || (m && m.values?.map((v) => v.toLowerCase()).join() === "master's teachings"), "D: BT19-124 — the special trait");
  assert.equal(m.until, "nextTurn", "D: BT19-124 — through the opponent's next turn");
  const bt13 = record("[unique][overlord]<br>[activate: main]{g}, if your Leader Card is green: Choose 1 of your green Battle Cards with an energy cost of 3 or less and no keyword skills, and it gains the [servant] skill until the start of your next Main Phase.", "BT13-075", 10);
  const g = opOf(bt13, "grant")[0];
  assert.ok(g && (g.keyword as { name: string }).name === "Servant" && g.until === "nextMain", "D: BT13-075 — [Servant] until your next Main Phase");
  for (const [text, what, kw] of [
    ["[Auto] When this card is played, you can use Rest Mode ≪Hero≫ cards in combos until the end of your opponent's turn.", "BT24-027", null],
    ["[Auto] When this card is played, you can use Rest Mode Battle Cards without [Unique] skills in combos until the end of your opponent's turn.", "BT27-022", "Unique"],
  ] as const) {
    const p = opOf(record(text, what, 0), "permit")[0];
    assert.ok(p && p.what === "comboRest" && p.until === "nextTurn", `D: ${what} — Rest Mode combos through the opponent's turn`);
    if (kw) assert.ok(p.filter?.notKeywords.includes(kw) && p.filter.type === "BATTLE", `D: ${what} — Battle Cards without [${kw}]`);
  }
  for (const [text, what, cost] of [
    ["[over realm 6]{b}<br>[auto] When this card is played using [over realm], your opponent can only attack with Battle Cards once during their next turn.", "BT11-132", null],
    ["[-2][Activate: Main] If your Leader Card is yellow: Your opponent can only attack with Battle Cards once during their next turn.", "BT11-093", null],
    ["[-2][Activate: Main] Until the end of your opponent's next turn, they can only attack one time with Battle Cards with energy costs of 4 or less.", "P-330", 4],
  ] as const) {
    const recs = skillRecords(card(what, { skill: text }));
    const f = opOf(record(text, what, recs.find((r) => r.ops.length || r.cond)!.skillIndex), "forbid")[0];
    assert.ok(f && f.what === "attack" && f.side === "opponent" && f.uses === 1 && f.until === "nextTurn" && f.filter?.type === "BATTLE", `D: ${what} — one attack with Battle Cards in their next turn`);
    if (cost) assert.equal(f.filter?.costMax, cost, `D: ${what} — …with energy costs of ${cost} or less`);
  }
  const bt27 = record("[0] [Activate: Main] Your opponent places 1 card from their hand at the bottom of its owner's deck, and you switch up to 1 of your blue energy to Active Mode at the end of the turn.", "BT27-028", 0);
  const d1 = opOf(bt27, "delay")[0];
  assert.ok(d1 && d1.at === "turnEnd" && d1.ops.some((o) => o.op === "switchMode" && o.mode === "active"), "D: BT27-028 — the switch at the end of the turn");
  const p207 = record("[auto]{r}: When you combo with this card, it gets +5000 combo power for the turn and is sent to your Warp at the end of the battle.", "P-207", 0);
  const d2 = opOf(p207, "delay")[0];
  assert.ok(d2 && d2.at === "battleEnd" && d2.ops[0]?.op === "moveTo" && d2.ops[0].to === "warp", "D: P-207 — this card to the Warp at the end of the battle");
  records += 9;
}
// (Phrasing batch 8 reads BT24-108's Damage Step timing, P-560's "the same amount" and EX17-04's span — `phrasing-batch-8.ts`.)

// ── 2. the VM ────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  // R1: a combo card that leaves the game instead of going to the Drop; a Leader-like rule over every ≪Universe 7≫ combo card.
  RFGCOMBO: card("RFGCOMBO", { skill: "[Permanent] If this card would leave your Combo Area, remove it from the game instead." }),
  U7ZE: card("U7ZE", { skill: "[Permanent] When you would place a ≪Universe 7≫ card from your Combo Area in your Drop, place it in your Z-Energy instead." }),
  U7: card("U7", { traits: ["Universe 7"] }),
  // D: P-207's delayed move to the Warp.
  WARPCOMBO: card("WARPCOMBO", { skill: "[Auto] When you combo with this card, it gets +5000 combo power for the turn and is sent to your Warp at the end of the battle." }),
  // R2: the pile under the card in place of a removal by an opponent's skill.
  PILE: card("PILE", { skill: "[Permanent] If this card has 1 or more cards under it and would be removed from your Battle Area by an opponent's skill, you may place all of the cards under this card in their owners' Drops instead." }),
  BOUNCE: card("BOUNCE", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and return it to its owner's hand." }),
  KOER: card("KOER", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
  // R3: KO replacements a battle now asks.
  BOUJACK: card("BOUJACK", { power: 5000, skill: "[Permanent] If this card would be KO'd, you may instead place 1 ≪Boujack Brigade≫ card other than this card from your Battle Area into your Drop Area." }),
  BRIGADE: card("BRIGADE", { traits: ["Boujack Brigade"] }),
  INBATTLE: card("INBATTLE", { power: 5000, skill: "[Permanent] Once per turn, if this card would be KO'd in battle, you may place 1 card from under this card in its owner's Drop Area instead." }),
  BIG: card("BIG", { power: 30000 }),
  // R4: the play stopped by a [Counter: Play].
  STOPPLAY: card("STOPPLAY", { skill: "[Counter: Play] The Battle Card your opponent is playing is placed in its owner's Drop Area instead." }),
  // D: a timed trait, one attack next turn.
  TEACH: card("TEACH", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and it gains ≪Master's Teachings≫ until the end of your opponent's next turn." }),
  ONCE: card("ONCE", { skill: "[Activate: Main] Your opponent can only attack with Battle Cards once during their next turn." }),
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
function stage(s: VmState, p: PlayerId, def: string, area: string, mode: "active" | "rest" = "active"): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy" || area === "unison") s.cards[id].mode = mode;
  s.pending = [];
  return id;
}
function under(s: VmState, p: PlayerId, host: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  assert.ok(moveCard(s, game, id, "under", { under: host }).ok);
  return id;
}
type Prompt = VmState["prompt"];
type Steer = { cards?: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[] | undefined; replace?: number; combo?: string; counter?: string | null };
/** Answer every question until `done` holds (the turn player's Main Phase by default). */
function settle(s0: VmState, steer: Steer = {}, done: (s: VmState) => boolean = (s) => s.prompt.kind === "main", seen: string[] = []): VmState {
  let s = s0;
  let comboUsed = false;
  for (let i = 0; i < 80 && !done(s); i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    seen.push(`${q.kind}:${who}`);
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: 0 } as Action);
    else if (q.kind === "replaceMove") s = take(s, { type: "chooseMode", player: who, index: steer.replace ?? 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: steer.cards?.(q) ?? q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: steer.counter && q.candidates.includes(steer.counter) ? steer.counter : null } as Action);
    else if (q.kind === "zEnergyFromCombo") s = take(s, { type: "zEnergyFromCombo", player: who, card: null } as Action);
    else if (q.kind === "combo" && steer.combo && !comboUsed && who === s.turnPlayer) {
      comboUsed = true;
      s = take(s, { type: "combo", player: who, card: steer.combo } as Action);
    } else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.ok(done(s), `settled (at ${s.prompt.kind})`);
  return s;
}
const linesOf = (def: string) => parseSkills(defs[def].skill!).map((sk) => sk.index);
const offerOf = (s: VmState, c: string, line = linesOf(s.cards[c].cardId)[0]) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === line);
function activateLine(s: VmState, c: string, steer: Steer = {}, seen: string[] = []): VmState {
  const offer = offerOf(s, c);
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), steer, undefined, seen);
}
const pick = (id: string) => ({ cards: (q: Extract<Prompt, { kind: "chooseCards" }>) => (q.choice.candidates.includes(id) ? [id] : undefined) });
const attack = (s: VmState, attacker: string, target: string): VmState => take(s, { type: "attack", player: s.turnPlayer, attacker, target } as Action);
const zoneOf = (s: VmState, p: PlayerId, id: string) => Object.entries(s.sides[p].zones).find(([, ids]) => (ids as string[]).includes(id))?.[0];

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 27100 + n * 2 + (seat === "p1" ? 0 : 1);

  // R1. A combo card that leaves the game at 8-5-8 instead of going to the Drop; a plain one goes to the Drop.
  for (const def of ["RFGCOMBO", "V1"] as const) {
    let s = fresh(seat, seed(def === "V1" ? 1 : 0));
    const atk = stage(s, seat, "V1", "battle");
    const c = stage(s, seat, def, "hand");
    s = settle(attack(s, atk, s.sides[foe].zones.leader[0]), { combo: c });
    assert.equal(zoneOf(s, seat, c), def === "V1" ? "drop" : "removed", `${seat}: R1: ${def === "V1" ? "a plain combo card goes to the Drop" : "the combo card leaves the game instead"}`);
    cases++;
  }
  // R1. Any ≪Universe 7≫ combo card goes to the Z-Energy under the standing rule; another card still to the Drop.
  for (const def of ["U7", "V1"] as const) {
    let s = fresh(seat, seed(def === "V1" ? 3 : 2));
    stage(s, seat, "U7ZE", "battle");
    const atk = stage(s, seat, "V1", "battle");
    const c = stage(s, seat, def, "hand");
    s = settle(attack(s, atk, s.sides[foe].zones.leader[0]), { combo: c });
    assert.equal(zoneOf(s, seat, c), def === "U7" ? "zEnergy" : "drop", `${seat}: R1: ${def === "U7" ? "the ≪Universe 7≫ combo card goes to the Z-Energy" : "another card goes to the Drop"}`);
    cases++;
  }
  // D. P-207: used in a combo, then sent to the Warp at the end of the battle.
  {
    let s = fresh(seat, seed(4));
    const atk = stage(s, seat, "V1", "battle");
    const c = stage(s, seat, "WARPCOMBO", "hand");
    s = settle(attack(s, atk, s.sides[foe].zones.leader[0]), { combo: c });
    assert.equal(zoneOf(s, seat, c), "warp", `${seat}: D: the combo card is sent to the Warp at the end of the battle`);
    cases++;
  }

  // R2. The opponent's skill would return the card: with a card under it, its master is asked; taken, the pile goes and the
  // card stays; declined, it goes. With nothing under it, no question — it goes.
  for (const [pile, answer] of [[true, 0], [true, 1], [false, 0]] as const) {
    let s = fresh(seat, seed(5 + (pile ? answer : 2)));
    const me = stage(s, seat, "BOUNCE", "battle");
    const theirs = stage(s, foe, "PILE", "battle");
    const beneath = pile ? under(s, foe, theirs) : null;
    const seen: string[] = [];
    s = activateLine(s, me, { ...pick(theirs), replace: answer }, seen);
    const asked = seen.includes(`replaceMove:${foe}`);
    assert.equal(asked, pile, `${seat}: R2: ${pile ? "the card's master is asked (9-10-2-1)" : "no pile, no offer (9-10-3)"}`);
    const stays = pile && answer === 0;
    assert.equal(zoneOf(s, foe, theirs), stays ? "battle" : "hand", `${seat}: R2: ${stays ? "taken — the card stays" : "the card is returned"}`);
    // Taken, the pile is placed in the Drop instead; declined, it follows its card out of play to the Drop (23-2).
    if (beneath) assert.equal(zoneOf(s, foe, beneath), "drop", `${seat}: R2: …its pile is in the Drop either way`);
    cases++;
  }

  // R3. The battle's KO now asks: the guard's master may place a ≪Boujack Brigade≫ card instead; declined, the guard goes.
  for (const answer of [0, 1] as const) {
    let s = fresh(seat, seed(8 + answer));
    const atk = stage(s, seat, "BIG", "battle");
    const guard = stage(s, foe, "BOUJACK", "battle", "rest");
    const mate = stage(s, foe, "BRIGADE", "battle");
    const seen: string[] = [];
    s = settle(attack(s, atk, guard), { replace: answer }, undefined, seen);
    assert.ok(seen.includes(`replaceMove:${foe}`), `${seat}: R3: the guard's master is asked`);
    assert.equal(zoneOf(s, foe, guard), answer === 0 ? "battle" : "drop", `${seat}: R3: ${answer === 0 ? "the substitute taken — the guard stays" : "declined — the guard is KO'd"}`);
    assert.equal(zoneOf(s, foe, mate), answer === 0 ? "drop" : "battle", `${seat}: R3: ${answer === 0 ? "…the ≪Boujack Brigade≫ card goes instead" : "…the other card stays"}`);
    cases++;
  }
  // R3. "KO'd in battle": the battle's KO is answered, a skill's is not.
  for (const by of ["battle", "skill"] as const) {
    let s = fresh(seat, seed(10 + (by === "battle" ? 0 : 1)));
    const guard = stage(s, foe, "INBATTLE", "battle", "rest");
    const beneath = under(s, foe, guard);
    const seen: string[] = [];
    if (by === "battle") s = settle(attack(s, stage(s, seat, "BIG", "battle"), guard), {}, undefined, seen);
    else s = activateLine(s, stage(s, seat, "KOER", "battle"), pick(guard), seen);
    assert.equal(seen.includes(`replaceMove:${foe}`), by === "battle", `${seat}: R3: ${by === "battle" ? "the battle's KO asks" : "a skill's KO does not"}`);
    assert.equal(zoneOf(s, foe, guard), by === "battle" ? "battle" : "drop", `${seat}: R3: KO'd by ${by} — ${by === "battle" ? "stays" : "goes"}`);
    if (by === "battle") assert.equal(zoneOf(s, foe, beneath), "drop", `${seat}: R3: …the card from under it in the Drop`);
    cases++;
  }

  // R4. A [Counter: Play] stops the opponent's play: the card goes to the Drop, not into play.
  {
    let s = fresh(seat, seed(12));
    stage(s, seat, "V1", "energy");
    const played = stage(s, seat, "V1", "hand");
    stage(s, foe, "V1", "energy");
    const counter = stage(s, foe, "STOPPLAY", "hand");
    const play = RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && (l.action as { card: string }).card === played);
    assert.ok(play, `${seat}: R4: the card can be played`);
    s = settle(take(s, play.action), { counter });
    assert.equal(zoneOf(s, seat, played), "drop", `${seat}: R4: countered — the played card is in the Drop`);
    assert.equal(zoneOf(s, foe, counter), "drop", `${seat}: R4: …and the [Counter: Play] card was used`);
    cases++;
  }

  // D. A special trait until the end of the opponent's next turn: there on their turn, gone after it.
  {
    let s = fresh(seat, seed(13));
    const me = stage(s, seat, "TEACH", "battle");
    const target = stage(s, seat, "V1", "battle");
    s = activateLine(s, me, pick(target));
    const has = (st: VmState) => (attrsNow(ctx, game, st, target).traits as string[] | undefined)?.some((t) => t.toLowerCase() === "master's teachings");
    assert.ok(has(s), `${seat}: D: the trait now`);
    s = settle(take(s, { type: "endMain", player: seat } as Action), {}, (x) => x.prompt.kind === "main" && x.turnPlayer === foe);
    assert.ok(has(s), `${seat}: D: …still on the opponent's turn`);
    s = settle(take(s, { type: "endMain", player: foe } as Action), {}, (x) => x.prompt.kind === "main" && x.turnPlayer === seat);
    assert.ok(!has(s), `${seat}: D: …gone once that turn ended`);
    cases++;
  }
  // D. One attack with Battle Cards in the opponent's next turn.
  {
    let s = fresh(seat, seed(14));
    const me = stage(s, seat, "ONCE", "battle");
    const a = stage(s, foe, "V1", "battle");
    const b = stage(s, foe, "V1", "battle");
    s = activateLine(s, me);
    s = settle(take(s, { type: "endMain", player: seat } as Action), {}, (x) => x.prompt.kind === "main" && x.turnPlayer === foe);
    const attacks = (st: VmState) => RULES.legalActions(ctx, st).filter((l) => l.action.type === "attack" && [a, b].includes((l.action as { attacker: string }).attacker));
    assert.ok(attacks(s).length > 0, `${seat}: D: their first attack is allowed`);
    s = settle(attack(s, a, s.sides[seat].zones.leader[0]), {}, (x) => x.prompt.kind === "main" && x.turnPlayer === foe);
    assert.equal(attacks(s).length, 0, `${seat}: D: …a second attack with a Battle Card is not`);
    assert.ok(RULES.legalActions(ctx, s).some((l) => l.action.type === "attack" && (l.action as { attacker: string }).attacker === s.sides[foe].zones.leader[0]), `${seat}: D: …their Leader may still attack`);
    void hasKeyword;
    cases++;
  }
}

console.log(`delayed-replacement-1: ${records} record-level cases, and ${cases} both-seat reload cases`);
