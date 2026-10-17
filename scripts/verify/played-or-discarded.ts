/**
 * #969: "When this card is played from your hand or discarded by a <Shadow
 * Dragon> card's skill" (BT14-131 … BT15-137, P-313) and "When you play this
 * card or it is placed in a Drop Area from a Battle Area by a skill" (BT9-046 …)
 * — printed text -> compile -> stored-row JSON round-trip -> the real VM.
 *
 * Both moments are kept in one skill. A play from the hand and a skill's
 * discard are different occurrences and each pends the Auto once; the cause
 * ("by a <Shadow Dragon> card's skill") qualifies the discard half alone, the
 * play having no cause. A move the rules make, a card that was never in the
 * hand and a battle KO are not "discarded by a skill".
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { koCard } from "../../src/lib/arena/vm/battle";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { autoTriggerMatches, playedOrUnplacedAlternative } from "../../src/lib/arena/text/triggers";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId, Trigger } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const SHADOW = "If your Leader Card is a ≪Shadow Dragon≫ card: ";
const PRINTED = {
  // BT14-131's shape, with an effect the VM can observe (a draw).
  SD969: `[Auto] ${SHADOW}When this card is played from your hand or discarded by a ≪Shadow Dragon≫ card's skill, draw 1 card.`,
  SDONCE969: `[Auto][Once per turn] ${SHADOW}When this card is played from your hand or discarded by a ≪Shadow Dragon≫ card's skill, draw 1 card.`,
  // The BT14-131 effect itself: look at the top card, a black one may be added to the hand.
  SDLOOK969: `[Auto] ${SHADOW}When this card is played from your hand or discarded by a ≪Shadow Dragon≫ card's skill, you may look at the top card of your deck; if it's a black ≪Shadow Dragon≫ card you may add it to your hand, otherwise, place it at the bottom of your deck.`,
  // "or discarded by a skill" with no description of the skill's card.
  ANY969: "[Auto] When this card is played from your hand or discarded by a skill, draw 1 card.",
  // BT9-046's shapes.
  DROPB969: "[Auto] When you play this card or it is placed in a Drop Area from a Battle Area by a skill, draw 1 card.",
  DROPBONCE969: "[Auto][Once per turn] When you play this card or it is placed in your Drop Area from your Battle Area by a skill, draw 1 card.",
  // BT14-138: the discard alone.
  DISCONLY969: `[Auto] ${SHADOW}When this card is discarded by a ≪Shadow Dragon≫ card's skill, draw 1 card.`,
  // Honest gaps.
  SDUNREAD969: `[Auto] ${SHADOW}When this card is played from your hand or discarded by a ≪Shadow Dragon≫ card's skill or KO'd, draw 1 card.`,
  CAUSE969: "[Auto] When this card is played from your hand or discarded by a much too odd cause of skill, draw 1 card.",
  BATTLEWARP969: "[Auto] When you play this card or it is placed in a Warp from a Battle Area by a skill, draw 1 card.",
  // Untouched neighbours.
  PLAYONLY969: "[Auto] When this card is played from your hand, draw 1 card.",
  DROPONLY969: "[Auto] When this card is placed in your Drop Area from your hand by a skill, draw 1 card.",
} as const;
const DISCARDERS = {
  // A Shadow Dragon card's skill: an effect, the opponent's hand, and a price.
  SDEFFECT969: "[Activate: Main] Choose 1 card in your hand and place it in your Drop Area.",
  SDOPP969: "[Activate: Main] Your opponent discards 1 card from their hand.",
  SDPRICE969: "[Activate: Main] Place 1 card from your hand in your Drop Area: Draw 1 card.",
  // …and the same skill on a card that is not one.
  PLAINEFFECT969: "[Activate: Main] Choose 1 card in your hand and place it in your Drop Area.",
  // A play from the Drop Area.
  FROMDROP969: "[Activate: Main] Choose up to 1 card in your Drop Area and play it.",
  // Skills taking a card out of a Battle Area.
  TODROP969: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and place it in its owner's Drop Area.",
  OWNDROP969: "[Activate: Main] Choose up to 1 of your Battle Cards and place it in your Drop Area.",
  TOHAND969: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and return it to its owner's hand.",
  TOWARP969: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and send it to its owner's Warp.",
  KOSKILL969: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it.",
};
const SD_TRAITS = ["Shadow Dragon"];
const defs: Record<string, CardDef> = { ...DEFS,
  LSD969: card("LSD969", { type: "LEADER", colors: ["Black"], energyCost: null, comboCost: null, comboPower: null, traits: SD_TRAITS, skill: null }),
  FOE969: card("FOE969", { colors: ["Blue"], power: 5000, skill: null }),
  BLACKSD969: card("BLACKSD969", { colors: ["Black"], traits: SD_TRAITS, skill: null }),
  BLACKOTHER969: card("BLACKOTHER969", { colors: ["Black"], skill: null }),
  ...Object.fromEntries(Object.entries(PRINTED).map(([id, skill]) => [id, card(id, { energyCost: 0, power: 10000, colors: ["Black"], skill })])),
  ...Object.fromEntries(Object.entries(DISCARDERS).map(([id, skill]) => [id, card(id, { energyCost: 0, power: 10000, traits: id.startsWith("SD") ? SD_TRAITS : [], skill })])),
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
for (const id of ["SD969", "SDONCE969", "SDLOOK969", "ANY969"]) {
  assert.deepEqual(triggersOf(id), ["droppedFromHand", "playedFromHand"], `${id}: both halves are kept`);
  assert.deepEqual(autoRow(id).unread, [], `${id}: and the whole Auto reads`);
}
assert.deepEqual(autoRow("SD969").ops.map((o) => o.op), ["if"], "the cause is a condition on the program");
assert.equal(autoRow("ANY969").ops[0].op, "draw", "'by a skill' names no card: no condition");
for (const id of ["DROPB969", "DROPBONCE969"]) {
  assert.deepEqual(triggersOf(id), ["droppedFromBattle", "played"], `${id}: the play, and a skill's move to the Drop`);
  assert.deepEqual(autoRow(id).unread, []);
  assert.deepEqual(autoRow(id).ops.map((o) => o.op), ["draw"]);
}
assert.deepEqual(triggersOf("DISCONLY969"), ["droppedFromHand"], "the discard alone (BT14-138)");
assert.deepEqual(autoRow("DISCONLY969").unread, []);
assert.deepEqual(triggersOf("PLAYONLY969"), ["playedFromHand"]);
assert.deepEqual(triggersOf("DROPONLY969"), ["droppedFromHand"]);
for (const id of ["SDUNREAD969", "CAUSE969", "BATTLEWARP969"]) {
  assert.ok(playedOrUnplacedAlternative(autoSkill(id)), `${id}: an alternative nothing can place is refused`);
  assert.ok(autoRow(id).unread.length > 0, `${id}: an honest unread gap, not half a skill`);
  assert.deepEqual(autoRow(id).ops, [], `${id}: no half-skill`);
}
for (const id of ["SD969", "SDLOOK969", "ANY969", "DROPB969", "PLAYONLY969"])
  assert.ok(!playedOrUnplacedAlternative(autoSkill(id)), `${id}: not refused`);
assert.ok(!autoTriggerMatches(autoSkill("SD969"), "played" as Trigger), "'played from your hand' is the hand-qualified play, not any play");
assert.ok(!autoTriggerMatches(autoSkill("DROPONLY969"), "playedFromHand" as Trigger));
{
  // The effect of BT14-131: the black <Shadow Dragon> card may be added; anything else goes to the bottom.
  const ops = JSON.stringify(autoRow("SDLOOK969").ops);
  assert.ok(ops.includes('"to":"hand"') && ops.includes('"position":"bottom"'), "the add-to-hand half is read, not swallowed");
}

// ── the VM ───────────────────────────────────────────────────────────────────
function take(s: VmState, action: Action): VmState { return RULES.apply(ctx, roundtrip(s), action).state as VmState; }
function fresh(player: PlayerId, leader = "LSD969"): VmState {
  let s = RULES.createGame(ctx, { seed: 969, p1: { name: "First", leader, main: fifty("V1") }, p2: { name: "Second", leader, main: fifty("V-BLUE") } }).state as VmState;
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
function stage(s: VmState, p: PlayerId, def: string, area: string, mode: "active" | "rest" = "active"): string {
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); if (area === "battle") s.cards[id].mode = mode; return id;
}
const deckSize = (s: VmState, p: PlayerId) => s.sides[p].zones.deck.length;
const has = (s: VmState, p: PlayerId, area: string, id: string) => s.sides[p].zones[area].includes(id);
/** Answer whatever is asked until the main prompt is back; `pick` is chosen whenever it is offered. */
function settle(s: VmState, pick: string[] = []): VmState {
  for (let i = 0; i < 20 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt as { kind: string; player: PlayerId; choice?: { candidates: string[]; min: number } };
    if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "chooseCards") {
      const mine = pick.filter((c) => q.choice!.candidates.includes(c));
      s = take(s, { type: "choose", player: q.player, cards: mine.length ? mine : q.choice!.candidates.slice(0, q.choice!.min) });
    } else if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null });
    else if (q.kind === "blocker" || q.kind === "combo") s = take(s, { type: "pass", player: q.player } as Action);
    else if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: q.player, index: 0 });
    else throw new Error(`unexpected prompt ${q.kind} ${JSON.stringify(q)}`);
  }
  assert.equal(s.prompt.kind, "main");
  return s;
}
function play(s: VmState, c: string): VmState {
  const a = RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && l.action.card === c);
  assert.ok(a, "playable");
  return settle(take(s, a.action));
}
/** The acting seat activates `skill` (the card is in its Battle Area), answering with `pick`. */
function activate(s: VmState, skill: string, pick: string[] = []): VmState {
  const a = RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === skill);
  assert.ok(a, `${skill}: activatable`);
  return settle(take(s, a.action), pick);
}

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  // 1. The play from the hand pends the Auto once, whichever family it is.
  for (const id of ["SD969", "ANY969", "DROPB969"] as const) {
    const s = fresh(seat);
    const c = stage(s, seat, id, "hand");
    const before = deckSize(s, seat);
    const done = play(s, c);
    assert.equal(before - deckSize(done, seat), 1, `${seat}/${id}: a play pends the Auto once`);
    assert.equal(done.pending.length, 0);
  }
  // 2. The condition before the colon still gates the whole Auto.
  {
    const s = fresh(seat, "L-RED");
    const c = stage(s, seat, "SD969", "hand");
    const before = deckSize(s, seat);
    assert.equal(before, deckSize(play(s, c), seat), `${seat}: no Shadow Dragon Leader, no Auto`);
  }
  // 3. Discarded by a Shadow Dragon card's skill, as its effect: once, and the card is in the Drop.
  {
    const s = fresh(seat);
    const sd = stage(s, seat, "SD969", "hand"), by = stage(s, seat, "SDEFFECT969", "battle");
    const before = deckSize(s, seat);
    const done = activate(s, by, [sd]);
    assert.ok(has(done, seat, "drop", sd), `${seat}: the card was discarded`);
    assert.equal(before - deckSize(done, seat), 1, `${seat}: a Shadow Dragon skill's discard pends the Auto once`);
    assert.equal(done.pending.length, 0);
  }
  // …as the skill's price (1-6-1, 1-7-1, 20-7-4)…
  {
    const s = fresh(seat);
    const sd = stage(s, seat, "SD969", "hand"), by = stage(s, seat, "SDPRICE969", "battle");
    const before = deckSize(s, seat);
    const done = activate(s, by, [sd]);
    assert.ok(has(done, seat, "drop", sd), `${seat}: the price discarded it`);
    assert.equal(before - deckSize(done, seat), 2, `${seat}: the price's draw and the Auto's draw`);
  }
  // …and by the opponent's Shadow Dragon skill (the owner chooses what leaves the hand, 20-7).
  {
    const s = fresh(seat);
    const sd = stage(s, foe, "SD969", "hand"), by = stage(s, seat, "SDOPP969", "battle");
    const before = deckSize(s, foe);
    const hand = s.sides[foe].zones.hand.filter((x) => x !== sd);
    for (const x of hand) moveCard(s, game, x, "deck", { owner: foe }); // the card in the hand is the only one to give
    const mid = deckSize(s, foe);
    const done = activate(s, by, [sd]);
    assert.ok(has(done, foe, "drop", sd), `${seat}: the opponent's skill took ${sd}`);
    assert.equal(mid - deckSize(done, foe), 1, `${seat}: the Auto of the card that was discarded pends once for its own controller (${before})`);
  }
  // 4. A skill whose card is no Shadow Dragon card does not count; "by a skill" with no description does.
  for (const [id, drew] of [["SD969", 0], ["ANY969", 1]] as const) {
    const s = fresh(seat);
    const c = stage(s, seat, id, "hand"), by = stage(s, seat, "PLAINEFFECT969", "battle");
    const before = deckSize(s, seat);
    const done = activate(s, by, [c]);
    assert.ok(has(done, seat, "drop", c));
    assert.equal(before - deckSize(done, seat), drew, `${seat}/${id}: a skill of a card that is not a Shadow Dragon card draws ${drew}`);
  }
  // 5. Not discarded by a skill: a move the rules make, a KO in battle, a card that was never in the hand.
  {
    const s = fresh(seat);
    const c = stage(s, seat, "SD969", "hand");
    assert.ok(moveCard(s, game, c, "drop", { owner: seat }).ok);
    assert.equal(s.pending.length, 0, `${seat}: a rules move from the hand to the Drop pends nothing`);
    const k = fresh(seat), b = stage(k, seat, "SD969", "battle"), ev: GameEvent[] = [];
    koCard(ctx, game, k, ev, b);
    assert.ok(has(k, seat, "drop", b)); assert.equal(k.pending.length, 0, `${seat}: a KO in battle is not a discard`);
    const d = fresh(seat);
    const inDrop = stage(d, seat, "SD969", "drop"), pl = stage(d, seat, "FROMDROP969", "battle");
    const mid = deckSize(d, seat);
    const done = activate(d, pl, [inDrop]);
    assert.ok(has(done, seat, "battle", inDrop), `${seat}: played from the Drop Area`);
    assert.equal(mid, deckSize(done, seat), `${seat}: 'played from your hand' is not a play from the Drop Area`);
  }
  // 6. The effect of BT14-131 (look; a black <Shadow Dragon> card may be added, anything else goes to the bottom), through a discard.
  for (const [top, added] of [["BLACKSD969", true], ["BLACKOTHER969", false]] as const) {
    const s = fresh(seat);
    const sd = stage(s, seat, "SDLOOK969", "hand"), by = stage(s, seat, "SDEFFECT969", "battle");
    const t = s.sides[seat].zones.deck[0]; s.cards[t].cardId = top;
    const handBefore = s.sides[seat].zones.hand.length;
    const done = activate(s, by, [sd]);
    assert.equal(has(done, seat, "hand", t), added, `${seat}/${top}: ${added ? "added to the hand" : "not added"}`);
    if (!added) assert.equal(done.sides[seat].zones.deck.at(-1), t, `${seat}/${top}: placed at the bottom of the deck`);
    assert.equal(done.sides[seat].zones.hand.length, handBefore - 1 + (added ? 1 : 0));
  }
  // 7. [Once per turn] is the skill's: one skill carries both alternatives, and its discard uses it once.
  //    (A play and a later removal cannot share it on one copy: the card that left the Battle Area is a new card, 3-1-4.)
  assert.equal(autoSkill("DROPBONCE969").oncePerTurn, true);
  assert.equal(skillRecords(defs.DROPBONCE969).filter((r) => r.kind === "auto").length, 1, "one skill carries both alternatives");
  {
    const s = fresh(seat);
    const a = stage(s, seat, "SDONCE969", "hand"), by = stage(s, seat, "SDEFFECT969", "battle");
    const before = deckSize(s, seat);
    const t = activate(s, by, [a]);
    assert.equal(before - deckSize(t, seat), 1, `${seat}: a [Once per turn] discard pends the Auto once`);
  }
  // 8. A skill's move of a Battle Card to the Drop is the second moment — either player's skill — once.
  for (const [remover, owner, zone, draws] of [
    ["OWNDROP969", seat, "drop", 1], ["TODROP969", foe, "drop", 1],
    ["TOHAND969", foe, "hand", 0], ["TOWARP969", foe, "warp", 0], ["KOSKILL969", foe, "drop", 0],
  ] as const) {
    const s = fresh(seat);
    const c = stage(s, owner, "DROPB969", "battle"), rem = stage(s, seat, remover, "battle"); stage(s, seat, "V1", "battle");
    const before = deckSize(s, owner);
    const done = activate(s, rem, [c]);
    assert.ok(has(done, owner, zone, c), `${seat}/${remover}: the card is in ${zone}`);
    assert.equal(before - deckSize(done, owner), draws, `${seat}/${remover}: ${draws ? "pends the Auto once" : "is not a move to the Drop by a skill"}`);
  }
  // 9. Not by a skill: a KO in battle and a rules move do not trigger the Drop alternative.
  {
    const s = fresh(seat);
    const c = stage(s, seat, "DROPB969", "battle"), ev: GameEvent[] = [];
    const before = deckSize(s, seat);
    koCard(ctx, game, s, ev, c);
    assert.ok(has(s, seat, "drop", c)); assert.equal(s.pending.length, 0, `${seat}: a KO pends nothing`);
    assert.equal(before, deckSize(s, seat));
    const r = fresh(seat), c2 = stage(r, seat, "DROPB969", "battle");
    assert.ok(moveCard(r, game, c2, "drop", { owner: seat }).ok);
    assert.equal(r.pending.length, 0, `${seat}: a rules move pends nothing`);
  }
  // 9b. BT14-138's discard-only wording: a Shadow Dragon skill's discard draws, a plain skill's does not, a play never does.
  for (const [by, drew] of [["SDEFFECT969", 1], ["PLAINEFFECT969", 0]] as const) {
    const s = fresh(seat);
    const c = stage(s, seat, "DISCONLY969", "hand"), skill = stage(s, seat, by, "battle");
    const before = deckSize(s, seat);
    assert.equal(before - deckSize(activate(s, skill, [c]), seat), drew, `${seat}/${by}: discard-only Auto draws ${drew}`);
  }
  {
    const s = fresh(seat), c = stage(s, seat, "DISCONLY969", "hand"), before = deckSize(s, seat);
    assert.equal(before, deckSize(play(s, c), seat), `${seat}: a play is not a discard`);
  }
  // 10. The neighbours keep to their own moment; refused alternatives do nothing as a bare play.
  {
    const s = fresh(seat);
    const c = stage(s, seat, "DROPONLY969", "hand"), by = stage(s, seat, "PLAINEFFECT969", "battle");
    const before = deckSize(s, seat);
    const done = activate(s, by, [c]);
    assert.equal(before - deckSize(done, seat), 1, `${seat}: the hand-to-Drop Auto still answers a discard`);
    const t = fresh(seat), p = stage(t, seat, "PLAYONLY969", "hand");
    const b4 = deckSize(t, seat);
    assert.equal(b4 - deckSize(play(t, p), seat), 1);
  }
  for (const id of ["SDUNREAD969", "CAUSE969", "BATTLEWARP969"]) {
    const s = fresh(seat);
    const c = stage(s, seat, id, "hand");
    const before = deckSize(s, seat);
    assert.equal(before, deckSize(play(s, c), seat), `${seat}/${id}: the unreadable Auto does not fire as a bare play`);
  }
}
console.log("#969 played-or-discarded: reading, stored rows, play from the hand, discard by a skill (effect, price, opponent's), cause on the discard half only, Drop-from-Battle alternative, once per turn, rules/KO/Drop-origin boundaries, both seats passed");
