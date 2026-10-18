/**
 * #907: the cause of a Rest Mode switch, and cards entering the Energy Area.
 *
 *  (b) "When this card is [played or] switched to Rest Mode by one of your
 *      yellow card skills" (BT13-112/113/116, EX19-18), "… by your Leader's
 *      skill" (BT23-110, SD20-05), "… by a skill" (BT18-104, P-492), "… with
 *      {Name}'s skill" (TB2-009): printed text -> compile -> stored rows -> the
 *      real VM, including the cause check (the skill's card's colour/kind/name
 *      and whose skill it was).
 *  (a) "When this card is placed in your energy [from your hand]" (BT13-040,
 *      BT18-052, EX17-02) and "When this card in your hand is played or placed
 *      in your energy" (EX19-26, P-353): a charge and a skill's placing alike.
 *
 * Sources of the rulings are in the comments of `text/triggers.ts`
 * (`restedCauseOf`) and `dbs/triggers.rules`.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { autoTriggerMatches, restedCauseOf } from "../../src/lib/arena/text/triggers";
import type { Action, CardDef, EngineContext, PlayerId, Trigger } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const DRAW = "draw 1 card.";
const PRINTED = {
  // (b) the watched card, by cause.
  YEL907: `[Auto] When this card is switched to Rest Mode by one of your yellow card skills, ${DRAW}`,
  TURLES907: `[Auto] When this card is switched to Rest Mode by your yellow <Turles> card's skill, ${DRAW}`,
  LEAD907: `[Auto] When this card is switched to Rest Mode by your Leader's skill, ${DRAW}`,
  MINE907: `[Auto] When this card is switched to Rest Mode by one of your skills, ${DRAW}`,
  ANY907: `[Auto] When this card is switched to Rest Mode by a skill, ${DRAW}`,
  OPP907: `[Auto] When this card is switched to Rest Mode by your opponent's skill, ${DRAW}`,
  NAMED907: `[Auto] When this card is switched from Active Mode to Rest Mode with {Named Source}'s skill, ${DRAW}`,
  ALLY907: `[Auto] When this card is switched to Rest Mode by [Alliance], ${DRAW}`,
  PLAYEDREST907: `[Auto] When this card is played or switched to Rest Mode by one of your yellow card skills, ${DRAW}`,
  // (a) energy.
  ENFROMHAND907: `[Auto] When this card is placed in your energy from your hand, ${DRAW}`,
  ENANY907: `[Auto] When this card is placed in your energy, ${DRAW}`,
  PLAYEN907: `[Auto] When this card in your hand is played or placed in your energy, ${DRAW}`,
  // Still gaps (honest): a cause or origin no reader keeps.
  GAPREST907: `[Auto] When this card is played or switched to Rest Mode by a skill of an opponent's card, ${DRAW}`,
  GAPEN907: `[Auto] When this card is played or placed in your energy from your Drop Area, ${DRAW}`,
  // Neighbours.
  PLAYONLY907: `[Auto] When this card is played, ${DRAW}`,
} as const;
// The skills that do the switching: one per card colour / owner.
const SRC = {
  SRCY907: ["Yellow", "Yellow Turles Source"],
  SRCR907: ["Red", "Red Source"],
  SRCN907: ["Red", "Named Source"],
} as const;
const defs: Record<string, CardDef> = { ...DEFS,
  FOE907: card("FOE907", { colors: ["Blue"], power: 5000, skill: null }),
  ...Object.fromEntries(Object.entries(PRINTED).map(([id, skill]) => [id, card(id, { energyCost: 0, power: 10000, skill })])),
  ...Object.fromEntries(Object.entries(SRC).map(([id, [color, name]]) => [id, card(id, { colors: [color as "Yellow" | "Red"], name, characters: name.includes("Turles") ? ["Turles"] : [], energyCost: 0, power: 10000,
    skill: "[Activate: Main] Choose up to 1 of your Battle Cards other than this card and switch it to Rest Mode." })])),
  ENSRC907: card("ENSRC907", { colors: ["Red"], energyCost: 0, power: 10000, skill: "[Activate: Main] Place the top card of your deck in your energy." }),
  OPPSRC907: card("OPPSRC907", { colors: ["Blue"], energyCost: 0, power: 10000, skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and switch it to Rest Mode." }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

// ── the reading ──────────────────────────────────────────────────────────────
const autoRow = (id: string) => skillRecords(defs[id]).find((r) => r.kind === "auto")!;
const autoSkill = (id: string) => parseSkills(defs[id].skill!).find((s) => s.kind === "auto")!;
const triggersOf = (id: string) => [...autoRow(id).trigger].sort();
const expectTriggers: Record<string, string[]> = {
  YEL907: ["restedBySkill"], TURLES907: ["restedBySkill"], LEAD907: ["restedBySkill"], MINE907: ["restedBySkill"],
  ANY907: ["restedByAnySkill"], OPP907: ["restedByOpponentSkill"], NAMED907: ["restedByAnySkill"], ALLY907: ["restedByAlliance"],
  PLAYEDREST907: ["played", "restedBySkill"],
  ENFROMHAND907: ["placedInEnergyFromHand"], ENANY907: ["placedInEnergy"], PLAYEN907: ["placedInEnergyFromHand", "playedFromHand"],
  PLAYONLY907: ["played"],
};
for (const [id, want] of Object.entries(expectTriggers)) {
  assert.deepEqual(triggersOf(id), [...want].sort(), `${id}: the moments`);
  assert.deepEqual(autoRow(id).unread, [], `${id}: reads whole`);
}
// Each cause is a condition on the skill's card, and only where one is printed.
const condOf = (id: string) => JSON.stringify(autoRow(id).cond);
for (const id of ["YEL907", "TURLES907", "LEAD907", "NAMED907"]) assert.match(condOf(id), /"special":"subject"/, `${id}: a condition on the skill's card`);
for (const id of ["MINE907", "ANY907", "OPP907", "ALLY907"]) assert.equal(autoRow(id).cond ?? null, null, `${id}: no cause condition`);
assert.match(condOf("PLAYEDREST907"), /"kind":"any"/, "the play half has no cause to ask");
assert.equal(restedCauseOf("when this card is switched to rest mode by your opponent's skill")?.side, "opponent");
assert.equal(restedCauseOf("when this card is played or switched to rest mode by one of your yellow card skills")?.played, true);
assert.equal(restedCauseOf("when this card attacks"), null);
// The honest gaps stay gaps and fire nowhere.
for (const id of ["GAPREST907", "GAPEN907"]) {
  assert.ok(autoRow(id).unread.length > 0, `${id}: an honest unread gap`);
  assert.deepEqual(autoRow(id).ops, [], `${id}: no half-skill`);
}
// Neighbours: the old wording keeps its single trigger, and "by a skill" is not "by one of your skills".
assert.ok(!autoTriggerMatches(autoSkill("MINE907"), "restedByAnySkill" as Trigger));
assert.ok(!autoTriggerMatches(autoSkill("ANY907"), "restedBySkill" as Trigger));

// ── the VM ───────────────────────────────────────────────────────────────────
function take(s: VmState, action: Action): VmState { return RULES.apply(ctx, roundtrip(s), action).state as VmState; }
function fresh(player: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 907, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(player === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, player);
  return s;
}
/** The Charge Phase question of `player` (7-2-11), before the card is chosen. */
function atCharge(player: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 907, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    ...(player === "p2" ? [{ type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }] : []),
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "charge");
  assert.equal((s.prompt as { player: PlayerId }).player, player);
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string, mode: "active" | "rest" = "active"): string {
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); if (area === "battle") s.cards[id].mode = mode; return id;
}
const deckSize = (s: VmState, p: PlayerId) => s.sides[p].zones.deck.length;
function settle(s: VmState): VmState {
  for (let i = 0; i < 20 && (s.prompt.kind !== "main" || s.battle); i++) {
    const q = s.prompt as { kind: string; player: PlayerId };
    if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: [] });
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  assert.equal(s.prompt.kind, "main");
  return s;
}
/** Activate `source`'s skill and choose `target`; returns the settled state. */
function rest(s: VmState, player: PlayerId, source: string, target: string): VmState {
  s = take(s, { type: "activate", player, card: source, skill: 0 } as Action);
  for (let i = 0; i < 20 && (s.prompt.kind !== "main" || s.battle); i++) {
    const q = s.prompt as { kind: string; player: PlayerId };
    if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: [target] });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  assert.equal(s.cards[target].mode, "rest", "the target was switched");
  return s;
}
function play(s: VmState, c: string): VmState {
  const a = RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && l.action.card === c);
  assert.ok(a, "playable");
  return settle(take(s, a.action));
}

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  // 1. The cause is asked: yellow source yes, red no; your skill yes, theirs no.
  for (const [watched, yellowDraws, redDraws, oppDraws] of [
    ["YEL907", 1, 0, 0], ["TURLES907", 1, 0, 0], ["MINE907", 1, 1, 0], ["ANY907", 1, 1, 1], ["OPP907", 0, 0, 1], ["PLAYEDREST907", 1, 0, 0], ["NAMED907", 0, 1, 0], ["LEAD907", 0, 0, 0],
  ] as const) {
    for (const [src, draws] of [["SRCY907", yellowDraws], ["SRCR907", redDraws]] as const) {
      // NAMED907 listens for the card named "Named Source" (the red SRCN907), not SRCR907.
      const srcId = watched === "NAMED907" ? (src === "SRCR907" ? "SRCN907" : "SRCY907") : src;
      let s = fresh(seat);
      const target = stage(s, seat, watched, "battle");
      const source = stage(s, seat, srcId, "battle");
      const before = deckSize(s, seat);
      s = rest(s, seat, source, target);
      assert.equal(before - deckSize(s, seat), watched === "NAMED907" ? (src === "SRCR907" ? 1 : 0) : draws, `${seat}/${watched} rested by ${srcId}`);
    }
    // The opponent's skill (a Blue source of theirs resting your card).
    let s = fresh(seat);
    const target = stage(s, seat, watched, "battle");
    s.cards[stage(s, foe, "OPPSRC907", "battle")].mode = "active";
    // The opponent's activation needs their turn; resolve it through the host instead of the turn order.
    const before = deckSize(s, seat);
    const opp = Object.keys(s.cards).find((id) => s.cards[id].cardId === "OPPSRC907")!;
    s.turnPlayer = foe; (s.prompt as { player: PlayerId }).player = foe;
    s = rest(s, foe, opp, target);
    assert.equal(before - deckSize(s, seat), watched === "NAMED907" ? 0 : oppDraws, `${seat}/${watched} rested by the opponent's skill`);
  }
  // 3. "Played or switched": the play itself draws once, with no cause to ask.
  {
    let s = fresh(seat);
    const c = stage(s, seat, "PLAYEDREST907", "hand");
    const before = deckSize(s, seat);
    s = play(s, c);
    assert.equal(before - deckSize(s, seat), 1, `${seat}: the play half answers without a cause`);
  }
  // 4. The neighbour: "when this card is played" alone is unchanged.
  {
    let s = fresh(seat);
    const c = stage(s, seat, "PLAYONLY907", "hand");
    const before = deckSize(s, seat);
    s = play(s, c);
    assert.equal(before - deckSize(s, seat), 1);
  }
  // 5. Energy: a charge is a placing from the hand (7-2-11), so it answers; a skill's placing from the deck is "placed in your energy" but not "from your hand".
  for (const [id, byCharge, bySkill] of [["ENFROMHAND907", 1, 0], ["ENANY907", 1, 1], ["PLAYEN907", 1, 0]] as const) {
    let s = atCharge(seat);
    const c = stage(s, seat, id, "hand");
    const before = deckSize(s, seat);
    s = take(s, { type: "charge", player: seat, card: c } as Action);
    while (s.pending.length) s = take(s, { type: "orderPending", player: seat, index: 0 });
    assert.equal(before - deckSize(s, seat), byCharge, `${seat}/${id}: charging it answers`);
    let t = fresh(seat);
    const src = stage(t, seat, "ENSRC907", "battle");
    const top = t.sides[seat].zones.deck[0]; t.cards[top].cardId = id;
    const b2 = deckSize(t, seat);
    t = take(t, { type: "activate", player: seat, card: src, skill: 0 } as Action);
    t = settle(t);
    assert.equal(t.cards[top].cardId, id);
    assert.ok(t.sides[seat].zones.energy.includes(top), "the skill placed it in energy");
    // one card left the deck to energy; any draw would be a second
    assert.equal(b2 - deckSize(t, seat), 1 + bySkill, `${seat}/${id}: a skill's placing from the deck`);
  }
  // 6. "This card in your hand is played or placed in your energy": the play answers too, once.
  {
    let s = fresh(seat);
    const c = stage(s, seat, "PLAYEN907", "hand");
    const before = deckSize(s, seat);
    s = play(s, c);
    assert.equal(before - deckSize(s, seat), 1, `${seat}: the play half answers once`);
  }
  // 7. The refused alternatives do nothing.
  for (const id of ["GAPREST907", "GAPEN907"]) {
    let s = fresh(seat);
    const c = stage(s, seat, id, "hand");
    const before = deckSize(s, seat);
    s = play(s, c);
    assert.equal(before, deckSize(s, seat), `${seat}/${id}: an unreadable Auto does not fire as a bare play`);
  }
}
console.log("#907 rest-cause-energy: reading, stored rows, cause asked of the skill's card (colour, name, Leader, side), played-or-rest, charge/play into energy, refused alternatives, both seats passed");
