/**
 * Audit effects 1 (lane E of the readings audit of 2 Nov 2026): effects, clauses, durations. Printed text inline (the
 * catalog snapshot of 2 Nov 2026, corrected by `errata.ts` as a sync stores it).
 *
 * A.  Durations. "…until the end of your next turn" is `ownNextTurn` (BT12-132, BT20-134, DB1-094, DB2-032, DB3-142,
 *     EB1-28, P-394, BT20-138, BT9-087); "…during / until the end of their next Charge Phase" said of the opponent's card
 *     is their Charge Phase (DB3-099, P-469); "…at the start of your next Charge Phase" is yours (BT25-051); a list of
 *     grants said with commas shares the span at its end (BT26-138, BT27-061); a negation said before the play's place,
 *     or with no span at all, is not "for the turn" (EX23-37, DB2-088, BT21-063); "for the duration of your opponent's
 *     next turn, …" opens the rule at that turn (BT6-023); P-685's "until te end" (errata.ts). R-200 (pending): an
 *     untimed negation or grant lasts while its card stays.
 * B.  Cost changes say their orbs and span; "[Activate: Main]" / "[Activate: Battle]" reach that timing alone; a "next time
 *     you activate X on <described> card" waits for the next such activation on any card it describes (R-201, pending).
 * C.  "You can activate this card (or {X}) from your hand without paying its energy cost" is the `altCost` waiver; a skill
 *     used from the energy or from under a card, or an Extra used for an action price, is unread — never a play.
 * D.  "Your opponent reveals the top card of their deck" is followed by their shuffle (R-203); "top or bottom … in any
 *     order" is one end for all of them (R-202, superseding R-007 for "or").
 *
 * Proved here: the records (nothing unread where the line is whole, the stored-row JSON round trip, the rules
 * language's print and reparse), and in the VM where the engine learned something (`ownNextTurn`'s end).
 */
import assert from "node:assert/strict";
import { card } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { correctSkillText } from "../../src/lib/catalog/errata";
import { endOwnTurnEffects } from "../../src/lib/arena/vm/effects";
import { activateTimingReaches } from "../../src/lib/arena/vm/costs";
import type { CardDef } from "../../src/lib/arena/types";
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
  return roundtrip(rec);
}
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "chooseMode" ? o.modes.flatMap((m) => opsDeep(m.ops)) : [])]);
const opOf = <K extends Op["op"]>(rec: Rec, op: K) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: K }> => o.op === op);
const untilOf = (o: Op) => (o as { until?: string }).until;
let records = 0;

// A1. "…until the end of your next turn": `ownNextTurn`, whatever kind of skill says it.
for (const [id, text, op] of [
  ["BT12-132", "[Auto][Once per turn] When your opponent plays a Battle Card with an energy cost greater than their current energy using a skill, this card gets +10000 power until the end of your next turn.", "power"],
  ["BT20-134", "[Counter: Attack] If your Leader is a <Cumber> card: Negate the attack, choose up to 1 of your opponent's Battle Cards, and it gains [Servant] until the end of your next turn.", "grant"],
  ["DB1-094", "[activate: battle] {1}, choose 1 of your ≪Universe 7≫ or ≪Universe 6≫ Battle Cards being attacked: It gets +6000 power until the end of your next turn, then play this card from your hand, and you can't play {Vegeta, Saiyan Tag Team} for the duration of the turn.", "power"],
  ["DB2-032", "[Counter: Attack] Negate the attack, then choose up to 1 of your Battle Cards and it gets +5000 power until the end of your next turn.", "power"],
  ["DB3-142", "[activate: main][once per turn] Choose up to 1 of your Meta-Cooler Tokens or yellow <Meta-Cooler> cards and it gains [blocker] until the end of your next turn.", "grant"],
  ["EB1-28", "[Auto] If your Leader Card is a green <Tien Shinhan> card: When this card is KO'd, add up to 1 card from your life to your hand, play up to 1 green <Tien Shinhan> card with an energy cost of 3 from your deck, then shuffle your deck. The card you played with this skill can't attack until the end of your next turn.", "forbid"],
  ["P-394", "[activate: main][sparking 5]{r}{r}{u}, if your Leader Card is a red ≪Universe 7≫ card and you send this card from your Drop Area to your Warp: Your Leader Card gains [invoker] until the end of your next turn.", "grant"],
  ["BT20-138", "[activate: battle][limit 1] If your Leader is a red <Warriors of Universe 7> card and it's your opponent's turn: Switch up to 1 of your Red/Blue multicolor energy to Active Mode, and you can't play Battle Cards from your hand until the end of your next turn.", "forbid"],
  ["BT9-087", "[Counter: Attack] If your Leader Card is black: Negate the attack, and you may choose 1 card from your hand and place it in your Drop Area. If you placed a card in your Drop Area, choose up to 1 of your opponent's Battle Cards, ignoring [Barrier], and it can't attack, be placed in your opponent's Combo Area, or activate skills until the end of your next turn.", "forbid"],
] as const) {
  const rec = record(id, text);
  const ops = opsDeep(rec.ops).filter((o) => o.op === op && (op !== "forbid" || (o as { what: string }).what !== "play" || id === "BT20-138"));
  assert.ok(ops.length && ops.every((o) => untilOf(o) === "ownNextTurn"), `A1: ${id} — ${op} until the end of your next turn (${JSON.stringify(ops).slice(0, 300)})`);
  assert.ok(/until the end of your next turn/.test(rec.reads), `A1: ${id} — and says so (${rec.reads})`);
  records++;
}
// DB1-094's own ban is still "for the duration of the turn".
assert.ok(opOf(record("DB1-094", "[activate: battle] {1}, choose 1 of your ≪Universe 7≫ or ≪Universe 6≫ Battle Cards being attacked: It gets +6000 power until the end of your next turn, then play this card from your hand, and you can't play {Vegeta, Saiyan Tag Team} for the duration of the turn."), "forbid").every((o) => o.until === "turn"), "A1: DB1-094 — its ban stays the turn's");

// A2. The Charge Phases: theirs (said "their" of the opponent's card) and yours.
{
  const db3 = record("DB3-099", "[Activate: Main] If your Leader Card is yellow: Choose 1 of your opponent's Battle Cards, it can't be switched to Active Mode during their next Charge Phase, and you can't activate copies of this card during your next turn.");
  const lock = opOf(db3, "forbid").find((o) => o.what === "switchToActiveInCharge");
  assert.ok(lock && lock.until === "afterOpponentCharge", `A2: DB3-099 — their next Charge Phase's switch (${JSON.stringify(lock)})`);
  const p469 = record("P-469", "[auto] When this card attacks, choose 1 of your opponent's Battle Cards or Unisons, and it can't be switched to Active Mode until the end of their next Charge Phase.");
  const span = opOf(p469, "forbid")[0];
  assert.ok(span.what === "switchToActive" && span.until === "afterOpponentCharge", `A2: P-469 — from now through their next Charge Phase (${JSON.stringify(span)})`);
  const bt25 = record("BT25-051", "[Activate: Main][Limit 1] If your Leader is a blue <Nappa> card and your opponent has 2 or more energy: Play this card from your hand in Rest Mode, and this card can't switch to Active Mode at the start of your next Charge Phase.");
  assert.ok(opOf(bt25, "forbid").some((o) => o.what === "switchToActive" && o.until === "afterNextCharge"), "A2: BT25-051 — through your next Charge Phase");
  // P-685's "until te end" (errata.ts) is the opponent's turn.
  const p685 = record("P-685", "[Auto] If your Leader is a yellow <Lord Slug> card and you place 1 card from your hand at the bottom of its owner's deck: When this card is played or used in a combo, draw 1 card, choose up to 1 of your opponent's Rest Mode Battle Cards, and it can't switch to Active Mode until te end of your opponent's turn.");
  assert.ok(opOf(p685, "forbid").some((o) => o.what === "switchToActive" && o.until === "nextTurn"), "A2: P-685 — until the end of your opponent's turn");
  records += 4;
}

// A3. A list said with commas shares the span at its end.
{
  const bt26 = record("BT26-138", "[auto] If your opponent has 3 or more energy: When this card is played, add up to 2 cards from your Z-Energy to your hand, and this card gains [barrier], [triple attack], and [blocker] until the end of your opponent's turn.");
  assert.deepEqual(opOf(bt26, "grant").map((o) => [o.keyword.name, o.until]), [["Barrier", "nextTurn"], ["Attack", "nextTurn"], ["Blocker", "nextTurn"]], "A3: BT26-138 — all three until the end of your opponent's turn");
  const bt27 = record("BT27-061", "[Activate: Battle]{g}: Choose up to 1 of your <Son Goku: Childhood> or <Master Roshi> cards -- both green and with ≪Adventure≫ -- and it gets +15000 power, [Critical], and [Double Strike] for the battle.");
  assert.deepEqual([...opOf(bt27, "power"), ...opOf(bt27, "grant")].map(untilOf), ["battle", "battle", "battle"], "A3: BT27-061 — power and both keywords for the battle");
  // A leading span over such a list still reaches the price after it (DB1-015).
  const db1 = record("DB1-015", "[Auto] When there are 10 or more Battle Cards in your Drop Area with 10000 power: At the start of your Main Phase, for the duration of the turn, this card gets +25000 power, [Double Strike], and [Dual Attack], and your opponent can't activate [Counter] skills unless they place 2 cards from their hand in their Drop Area as an additional cost.");
  assert.ok(opOf(db1, "forbid").some((o) => o.what === "activateCounter" && o.unlessPay), "A3: DB1-015 — the [Counter] tax still reads");
  records += 3;
}

// A4. Negations that are not "for the turn".
{
  const ex23 = record("EX23-37", "[activate: main][once per turn] Place 1 card from your hand at the bottom of your deck: Choose 1 of your <Mechikabura> cards with an energy cost of 8 and 30000 power and switch it to Active Mode, then play up to 1 Battle Card with an energy cost of 5 or less with its skills negated for the game from your opponent's Warp in your Battle Area.");
  const play = opOf(ex23, "play")[0];
  assert.equal(play.negated, "game", "A4: EX23-37 — negated for the game");
  const choose = opOf(ex23, "choose").find((o) => o.as === ("var" in play.target ? play.target.var : ""));
  assert.ok(choose && choose.sel.side === "opponent" && choose.sel.area === "warp" && choose.sel.filter?.costMax === 5, "A4: EX23-37 — out of the opponent's Warp");
  assert.equal(opOf(record("DB2-088", "[Auto] When you play this card, choose up to 1 green Battle Card with an energy cost of 3 or less in your Drop Area, and play it with its skills negated."), "play")[0].negated, "game", "A4: DB2-088 — no span printed: while it stays");
  const bt21 = record("BT21-063", "[activate: main]{u}, if your opponent has 2 or more energy and you have a {Universal Tuffleization Plan} in your Battle Area: Choose 1 of your opponent's Battle Cards with an energy cost of 4 or less that does not have a character name that includes <Son Goku: GT>, place this card under that card, negate that card's non-keyword skills, you gain control of it, and that card gains [servant].");
  assert.ok([...opOf(bt21, "negateSkillsOfKind"), ...opOf(bt21, "grant")].every((o) => untilOf(o) === "game") && opOf(bt21, "control").length === 1, "A4: BT21-063 — taken for good, and so are its negation and [Servant]");
  records += 3;
}

// A5. "For the duration of your opponent's next turn, …" opens the rule at that turn.
{
  const rec = record("BT6-023", "[Activate: Main] If your Leader Card is a red ≪Frieza's Army≫ card and your opponent has 3 or more energy: Draw 1 card, and for the duration of your opponent's next turn, your opponent can't play Battle Cards with 20000 power or less unless they choose 3 cards from their hand and place them in their Drop Area as an additional cost.");
  const delay = rec.ops.find((o): o is Extract<Op, { op: "delay" }> => o.op === "delay");
  assert.ok(delay && delay.at === "turnStart" && delay.scope === "opponentNextTurn", `A5: BT6-023 — at the start of the opponent's next turn (${JSON.stringify(rec.ops).slice(0, 300)})`);
  const tax = delay.ops[0];
  assert.ok(tax.op === "forbid" && tax.what === "play" && tax.until === "turn" && tax.unlessPay, "A5: BT6-023 — the play tax, for that turn");
  records++;
}

// A6. The VM: `ownNextTurn` ends at the end of the master's next turn after the one it was made on.
{
  const effect = (createdTurn: number) => ({ id: createdTurn, master: "p1", source: "x", target: "y", kind: "power", value: 5000, until: "ownNextTurn", createdTurn, ownerTurn: "p1" });
  // Made on the opponent's turn 4 (a [Counter]): spent at the end of p1's turn 5.
  const s = { turn: 4, turnPlayer: "p2", effects: [effect(4)] } as unknown as VmState;
  assert.equal(endOwnTurnEffects(s, []).length, 0, "A6: not at the end of the opponent's turn it was made on");
  s.turn = 5;
  s.turnPlayer = "p1";
  assert.equal(endOwnTurnEffects(s, []).length, 1, "A6: …at the end of your next turn");
  // Made on p1's own turn 5 (an [Activate: Main]): it outlives turn 5 and the opponent's turn 6, and ends with turn 7.
  const t = { turn: 5, turnPlayer: "p1", effects: [effect(5)] } as unknown as VmState;
  assert.equal(endOwnTurnEffects(t, []).length, 0, "A6: not at the end of the turn it was made on, when that is yours");
  t.turn = 6;
  t.turnPlayer = "p2";
  assert.equal(endOwnTurnEffects(t, []).length, 0, "A6: nor at the end of the opponent's turn");
  t.turn = 7;
  t.turnPlayer = "p1";
  assert.equal(endOwnTurnEffects(t, []).length, 1, "A6: …at the end of your next turn");
}

// B. Cost changes: the orbs, the span and the [Activate] timing they print (R-201 pending: "the next time you activate
// X on <described> card" waits for the next such activation on any card the description finds).
for (const [id, text, reads] of [
  ["EX24-26", "[activate: main] Remove this card from the game: Reduce the [auto] skill cost of {Family Kamehameha, Emotions Delivered} in your Battle Area by {g} for the turn.", /\[Auto\] skills is 1 less \(\{Green\}\) for the turn$/],
  ["EX23-29", "[activate: main][limit 1] If your Leader is a yellow <Gotenks: Adolescence> card, you have 3 or more energy, and you remove this card from the game: During that turn, the next time you activate the [union] skill on a yellow <Gotenks: Adolescence> card with an energy cost of 7 or less from your hand, reduce the skill cost by {y}{y}.", /is 2 less \(\{Yellow\}\{Yellow\}\) the next time it is paid this turn$/],
  ["SD19-04", "[permanent] If your Leader is a Z-Leader or you have a Z-Battle Card in play, reduce the skill cost of this card's [union] skill in your hand by {g}.", /is 1 less \(\{Green\}\)$/],
  ["BT24-072", "[Activate: Main][Limit 1] If your Leader is a green <Frieza> card and you discard this card from your hand: Choose up to 1 of your opponent's non-token Battle Cards and increase its energy cost by 1 for the turn.", /costs 1 more for the turn$/],
  ["BT24-105", "[activate: main][once per turn] Declare 1 number that's 3 or less: Increase this card's energy cost by the declared number for the turn.", /this card costs X more for the turn$/],
  ["EX24-03", "[activate: main][limit 1] If your Leader is a ≪Power Wish≫ card, you have 2 or more energy, and you add this card in your hand to your Z-Energy: During this turn, ignore the specified costs on ≪Shenron≫ Z-Unisons in your Z-Deck.", /has no specified cost for the turn$/],
] as const) {
  const rec = record(id, text);
  assert.match(rec.reads, reads, `B: ${id} — ${rec.reads}`);
  records++;
}
for (const [id, text, timing] of [
  ["BT28-075", "[Activate: Main][Limit 1] Place this card into its owner's Drop: The next time you activate an [Activate: Main] skill on a <Son Goku> card with an [Alliance] skill from your hand during this turn, reduce the skill cost by {g}.", "main"],
  ["BT28-056", "[Activate: Battle][Once per turn] If your opponent has 2 or more energy: The next time you activate an [Activate: Battle] skill on a green <Tien Shinhan> card in your hand during the battle, reduce the skill cost by {g}.", "battle"],
  ["BT29-003", "[-3][activate: main/battle] If your Leader is a red <Krillin> card and you place 4 red ≪Earthling≫ Extras from your Drop at the bottom of their owner's deck: The next time you activate an [activate] skill on a red Extra from your hand during this turn, reduce the skill cost by {1}.", undefined],
] as const) {
  const cut = opOf(record(id, text), "costReduction")[0];
  assert.ok(cut.skillKind === "activate" && cut.activateTiming === timing && cut.uses === 1, `B: ${id} — the [Activate${timing ? `: ${timing}` : ""}] lines, once (${JSON.stringify(cut)})`);
  records++;
}
// The span of BT28-056's is the battle.
assert.equal(opOf(record("BT28-056", "[Activate: Battle][Once per turn] If your opponent has 2 or more energy: The next time you activate an [Activate: Battle] skill on a green <Tien Shinhan> card in your hand during the battle, reduce the skill cost by {g}."), "costReduction")[0].until, "battle", "B: BT28-056 — during the battle");
// The VM's reach: a timing reaches its own lines and the [Activate: Main/Battle] ones, never the other timing's.
for (const [timing, kind, reaches] of [
  ["main", "activate:main", true], ["main", "activate:main/battle", true], ["main", "activate:battle", false],
  ["battle", "activate:battle", true], ["battle", "activate:main/battle", true], ["battle", "activate:main", false],
  [undefined, "activate:battle", true],
] as const) assert.equal(activateTimingReaches({ kind }, timing), reaches, `B: [Activate${timing ? `: ${timing}` : ""}] reaches a ${kind} line: ${reaches}`);

// C. A [Permanent] that lets this card (or another) be used without its energy cost is the `altCost` waiver, never a play.
for (const [id, text, forWhat] of [
  ["BT15-090", "[permanent] If your Leader Card is a green ≪Saiyan≫ card, you can activate this card from your hand without paying its energy cost.", "play"],
  ["BT12-120", "[Permanent] If you have 3 or more energy in Rest Mode, you can activate this card from your hand without paying its energy cost.", "play"],
  ["BT8-020", "[Permanent] If you have a Red/Yellow multicolor card in your energy, you can activate this card from your hand without paying its energy cost.", "play"],
  ["BT20-113", "[Permanent] If your Leader is a yellow <Majin Buu> Z-Leader, you can activate this card from your hand without paying its energy cost.", "play"],
  ["BT11-118", "[Permanent] If you have 4 or more yellow ≪Demon Clan≫ cards in play, you can activate this card from your hand without paying its energy cost.", "play"],
  ["BT23-122", "[Permanent] If you have 3 or more energy and you have a {Kale's Rampage} in your Battle Area, you may activate the [Counter] skill on this card in your hand without paying its energy cost.", undefined],
] as const) {
  const rec = record(id, text, { type: "EXTRA", power: null, comboCost: null, comboPower: null });
  const alt = opOf(rec, "altCost");
  assert.ok(alt.length === 1 && alt[0].pay === "none" && alt[0].for === forWhat && !alt[0].target, `C: ${id} — the waiver on this card (${JSON.stringify(rec.ops)})`);
  assert.equal(opOf(rec, "play").length, 0, `C: ${id} — and no play`);
  records++;
}
{
  const rec = record("BT27-052", "[Permanent] If your <Son Goku: Childhood> card is in play, you may activate {Kamehameha Energy Release} from your hand without paying its energy cost.");
  const alt = opOf(rec, "altCost")[0];
  assert.ok(alt && alt.pay === "none" && alt.for === "play" && alt.target && "sel" in alt.target && alt.target.sel.area === "hand" && alt.target.sel.filter?.names.join() === "kamehameha energy release", `C: BT27-052 — the waiver on the named card in your hand (${JSON.stringify(rec.ops)})`);
  records++;
}
// Areas no engine offers a skill from, and an action price for an Extra's use: unread, where each was a play.
for (const [id, text] of [
  ["BT17-055", "[Permanent] If your Leader Card is a blue ≪Red Ribbon Army≫ card, you can activate this card's [Counter] skill from your energy by paying its energy cost."],
  ["BT19-093", "[Permanent] If your Leader is a green <Broly: Br> card and this card is under a <Broly: Br> card, you can activate this card's [Activate] skill under the same conditions as if it were in your hand."],
  ["BT21-048", "[Permanent] If this card is under a {Universal Tuffleization Plan} in your Battle Area, you can activate this card's [Counter] skill under the same conditions as if it were in your hand."],
  ["DB2-164", "[Permanent] If you have 4 or more energy, you can activate this card from your hand by placing 1 red card in your hand in your Drop Area instead of paying this card's energy cost."],
  ["BT14-119", "[Permanent] You can activate the [Activate: Battle] skill on this card from your hand without paying its energy cost by placing 1 card from under one of your Battle Cards in its owner's Drop Area."],
] as const) {
  const recs = skillRecords(card(id, { skill: text, type: "EXTRA", power: null, comboCost: null, comboPower: null }));
  assert.ok(recs.length === 1 && recs[0].unread.length > 0 && !opsDeep(recs[0].ops).some((o) => o.op === "play"), `C: ${id} — unread, never a play (${recs[0].reads})`);
}

// D. The ≪Universe 10≫ reveals shuffle the opponent's deck at once (R-203, each card's Q&A); "top or bottom … in any
// order" is one end for all of them (R-202, BT9-037's Q&A), "top and/or bottom" each card's own.
for (const [id, text] of [
  ["DB2-047", "[Activate: Main][Once per turn] Choose 1 card in your hand and place it in your Drop Area: Your opponent reveals the top card of their deck; if it's a Battle Card, choose up to 1 of your opponent's Battle Cards and place it at the bottom of its owner's deck."],
  ["DB2-049", "[activate: main][once per turn]{u}{1}: Your opponent reveals the top card of their deck; if it's a Battle Card, draw 1 card."],
  ["DB2-063", "[Counter: Attack] Negate the attack, then your opponent reveals the top card of their deck; if it's a Battle Card, choose up to 1 of your Battle Cards and up to 1 of your energy, and switch them to Active Mode."],
] as const) {
  const ops = record(id, text).ops;
  const at = ops.findIndex((o) => o.op === "reveal");
  assert.ok(at >= 0 && ops[at + 1]?.op === "shuffle" && (ops[at + 1] as { side?: string }).side === "opponent", `D: ${id} — the opponent shuffles right after the reveal (${JSON.stringify(ops).slice(0, 300)})`);
  records++;
}
assert.equal(opOf(record("DB1-077", "[Activate: Main][Once per turn] Your opponent reveals the top card of their deck, then shuffles their deck. If the revealed card was a Battle Card, this card gains [Double Strike] and [Dual Attack] for the duration of the turn. Otherwise, this card gets -15000 power for the duration of the turn."), "shuffle").length, 1, "D: DB1-077 — its own shuffle, once");
for (const [id, text] of [
  ["BT9-037", "[Activate: Main] If your Leader Card is a ≪Universe 7≫ card and you switch this card to Rest Mode: Look at up to 3 cards from the top of your deck, then place them on the top or bottom of your deck in any order."],
  ["BT9-026", "[Auto] When you play this card from your hand, look at up to 3 cards from the top of your deck, choose up to 1 multicolor Extra Card among them, add it to your hand, then place the remaining cards at the top or bottom of your deck in any order."],
] as const) {
  const rec = record(id, text, { type: "EXTRA", power: null, comboCost: null, comboPower: null });
  const mode = opOf(rec, "chooseMode")[0];
  assert.ok(mode && mode.modes.length === 2, `D: ${id} — one choice of end (${JSON.stringify(rec.ops).slice(0, 300)})`);
  const [top, bottom] = mode.modes.map((m) => m.ops[0] as Extract<Op, { op: "moveTo" }>);
  assert.ok(top.position === "top" && bottom.position === "bottom" && JSON.stringify(top.target) === JSON.stringify(bottom.target), `D: ${id} — all of them to the top, or all to the bottom`);
  assert.equal(opOf(rec, "choose").filter((o) => o.sel.count === 99).length, 0, `D: ${id} — no per-card split`);
  records++;
}

console.log(`audit-effects-1: ${records} records read as printed`);
