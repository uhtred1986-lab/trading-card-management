/**
 * Audit effects 2 (lane E of the readings audit, round 2): effects, clauses and the ops they need. Printed text inline
 * (the catalog snapshot of 3 Nov 2026, corrected by `errata.ts` as a sync stores it).
 *
 * A.  "…and put them back in any order" / "…place them on top of your deck in any order" after a look is `arrange`: the
 *     master orders the cards one at a time, the first pick on top, and none of them leaves the deck (20-12-2).
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

// ── the VM ──────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  E2_ARRANGE_THEIRS: card("E2_ARRANGE_THEIRS", { skill: "[Activate: Main] Look at up to 3 cards from the top of your opponent's deck and put them back in any order." }),
  E2_ARRANGE_MINE: card("E2_ARRANGE_MINE", { skill: "[Activate: Main] Look at up to 3 cards from the top of your deck and place them on top of your deck in any order." }),
  E2_ACTIVATE_IT: card("E2_ACTIVATE_IT", { skill: "[Activate: Main] Choose 1 {E2 Armband} in your hand, activate it." }),
  E2_ARMBAND: card("E2_ARMBAND", { name: "E2 Armband", type: "EXTRA", energyCost: 3, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Draw 2 cards." }),
  E2_LOCK: card("E2_LOCK", { skill: "[Activate: Main] Draw 1 card, and you can't activate skills on cards other than this card in any of your areas for the turn." }),
  E2_DRAWER: card("E2_DRAWER", { skill: "[Activate: Main] Draw 1 card." }),
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
}

console.log(`verify/audit-effects-2: ok (${records} records, ${cases} VM cases across both seats)`);
