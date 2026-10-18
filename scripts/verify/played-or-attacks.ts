/**
 * #962: "When this card is played or attacks" (BT25-128, P-575, BT10-045 …) —
 * printed text -> compile -> stored-row JSON round-trip -> the real VM.
 *
 * Both moments are kept in one skill: the play and the attack. One occurrence
 * pends the Auto once (a play is not an attack, an attack is not a play), a
 * printed [Once per turn] is shared across the two, and a coordinated
 * alternative no trigger reader can place ("or placed in your energy", "or
 * attacks an opponent's Battle Card", "or your opponent attacks") stays an
 * honest unread gap instead of a bare `played`.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { autoTriggerMatches, playedOrUnplacedAlternative } from "../../src/lib/arena/text/triggers";
import type { Action, CardDef, EngineContext, PlayerId, Trigger } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const PRINTED = {
  // The printed shapes, with an effect the VM can observe (a draw).
  PLAIN962: "[Auto] When this card is played or attacks, draw 1 card.",
  ONCE962: "[Auto][Once per turn] When this card is played or attacks, draw 1 card.",
  COND962: "[Auto] If you have 3 or more energy: When this card is played or attacks, draw 1 card.",
  HAND962: "[Auto] When this card is played from your hand or attacks, draw 1 card.",
  YOU962: "[Auto] When you play this card or when it attacks, draw 1 card.",
  // Honest gaps.
  ENERGY962: "[Auto] When this card is played or placed in your energy from your Drop Area, draw 1 card.",
  TARGET962: "[Auto] When this card is played or attacks and opponent's Battle Card, draw 1 card.",
  OPPATK962: "[Auto] When this card is played or your opponent attacks, draw 1 card.",
  USING962: "[Auto] When this card is played using [Union-Potara] or attacks, draw 1 card.",
  REST962: "[Auto] When this card is played or switched to Rest Mode by a skill of an opponent's card, draw 1 card.",
  // Untouched neighbours.
  PLAYONLY962: "[Auto] When this card is played, draw 1 card.",
  ATKONLY962: "[Auto] When this card attacks, draw 1 card.",
  FROMZONE962: "[Auto] When you play this card from your hand or Drop Area, draw 1 card.",
  COMBO962: "[Auto] When this card is played or used in a combo, draw 1 card.",
} as const;
const defs: Record<string, CardDef> = { ...DEFS,
  FOE962: card("FOE962", { colors: ["Blue"], power: 5000, skill: null }),
  ...Object.fromEntries(Object.entries(PRINTED).map(([id, skill]) => [id, card(id, { energyCost: 0, power: 10000, skill })])),
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
for (const id of ["PLAIN962", "ONCE962", "COND962", "YOU962"]) {
  assert.deepEqual(triggersOf(id), ["attacks", "played"], `${id}: both halves are kept`);
  assert.deepEqual(autoRow(id).unread, [], `${id}: and the whole Auto reads`);
  assert.deepEqual(autoRow(id).ops.map((o) => o.op), ["draw"]);
}
assert.deepEqual(triggersOf("HAND962"), ["attacks", "playedFromHand"], "a play from the hand, and the attack");
assert.deepEqual(autoRow("HAND962").unread, []);
assert.deepEqual(triggersOf("PLAYONLY962"), ["played"]);
assert.deepEqual(triggersOf("ATKONLY962"), ["attacks"]);
assert.deepEqual(triggersOf("FROMZONE962"), ["played"], "'from your hand or Drop Area' is one moment with two origins");
assert.deepEqual(autoRow("FROMZONE962").unread, []);
assert.deepEqual(autoRow("COMBO962").unread, [], "'played or used in a combo' keeps its own reader");
for (const id of ["ENERGY962", "TARGET962", "OPPATK962", "USING962", "REST962"]) {
  assert.ok(playedOrUnplacedAlternative(autoSkill(id)), `${id}: an alternative nothing can place is refused`);
  assert.ok(autoRow(id).unread.length > 0, `${id}: an honest unread gap, not a bare played`);
  assert.deepEqual(autoRow(id).ops, [], `${id}: no half-skill`);
}
assert.ok(!autoTriggerMatches(autoSkill("TARGET962"), "attacks" as Trigger), "'attacks <a target>' is not the bare attack");
for (const id of ["PLAIN962", "HAND962", "YOU962", "PLAYONLY962", "COMBO962", "FROMZONE962"])
  assert.ok(!playedOrUnplacedAlternative(autoSkill(id)), `${id}: not refused`);

// ── the VM ───────────────────────────────────────────────────────────────────
function take(s: VmState, action: Action): VmState { return RULES.apply(ctx, roundtrip(s), action).state as VmState; }
function fresh(player: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 962, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
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
/** Answer whatever is asked until the main prompt is back and no battle is open. */
function settle(s: VmState): VmState {
  for (let i = 0; i < 20 && (s.prompt.kind !== "main" || s.battle); i++) {
    const q = s.prompt as { kind: string; player: PlayerId };
    if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null });
    else if (q.kind === "blocker" || q.kind === "combo") s = take(s, { type: "pass", player: q.player } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: [] });
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  assert.equal(s.prompt.kind, "main");
  return s;
}
function play(s: VmState, c: string): VmState {
  const a = RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && l.action.card === c);
  assert.ok(a, "playable");
  return settle(take(s, a.action));
}
function attack(s: VmState, c: string, target: string): VmState {
  const a = RULES.legalActions(ctx, s).find((l) => l.action.type === "attack" && l.action.attacker === c && l.action.target === target);
  assert.ok(a, "can attack");
  return settle(take(s, a.action));
}

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  // 1. The play: one draw, whichever way the skill is worded; the attack is another, once.
  for (const id of ["PLAIN962", "COND962", "HAND962", "YOU962"] as const) {
    let s = fresh(seat);
    if (id === "COND962") for (let i = 0; i < 3; i++) stage(s, seat, "V1", "energy"); // "if you have 3 or more energy"
    const c = stage(s, seat, id, "hand"), target = stage(s, foe, "FOE962", "battle", "rest");
    const before = deckSize(s, seat);
    s = play(s, c);
    assert.equal(before - deckSize(s, seat), 1, `${seat}/${id}: a play pends the Auto once`);
    assert.equal(s.pending.length, 0);
    s.cards[c].mode = "active"; // the card has stood up (a fresh arrival could not attack yet)
    const mid = deckSize(s, seat);
    s = attack(s, c, target);
    assert.equal(mid - deckSize(s, seat), 1, `${seat}/${id}: an attack pends the Auto once`);
    assert.equal(s.pending.length, 0);
  }
  // 2. An attack by a card that was never played this turn: the skill is still there.
  {
    let s = fresh(seat);
    const c = stage(s, seat, "PLAIN962", "battle"), target = stage(s, foe, "FOE962", "battle", "rest");
    const before = deckSize(s, seat);
    s = attack(s, c, target);
    assert.equal(before - deckSize(s, seat), 1, `${seat}: the attack alone is enough`);
  }
  // 3. [Once per turn] is the skill's, so the play uses it and the attack waits for the next turn.
  {
    let s = fresh(seat);
    const c = stage(s, seat, "ONCE962", "hand"), target = stage(s, foe, "FOE962", "battle", "rest");
    const before = deckSize(s, seat);
    s = play(s, c);
    s.cards[c].mode = "active";
    s = attack(s, c, target);
    assert.equal(before - deckSize(s, seat), 1, `${seat}: once per turn spans the play and the attack`);
  }
  {
    let s = fresh(seat);
    const c = stage(s, seat, "ONCE962", "battle"), target = stage(s, foe, "FOE962", "battle", "rest");
    const before = deckSize(s, seat);
    s = attack(s, c, target);
    assert.equal(before - deckSize(s, seat), 1, `${seat}: the attack uses it when no play did`);
  }
  // 4. The neighbours stay what they were: only the play, only the attack.
  {
    let s = fresh(seat);
    const c = stage(s, seat, "PLAYONLY962", "battle"), target = stage(s, foe, "FOE962", "battle", "rest");
    const before = deckSize(s, seat);
    s = attack(s, c, target);
    assert.equal(before, deckSize(s, seat), `${seat}: a play-only Auto does not answer an attack`);
    let t = fresh(seat);
    const a = stage(t, seat, "ATKONLY962", "hand");
    const b4 = deckSize(t, seat);
    t = play(t, a);
    assert.equal(b4, deckSize(t, seat), `${seat}: an attack-only Auto does not answer a play`);
  }
  // 5. A refused alternative does nothing at either moment (an unread gap, not half a skill).
  for (const id of ["ENERGY962", "TARGET962", "OPPATK962", "USING962", "REST962"]) {
    let s = fresh(seat);
    const c = stage(s, seat, id, "hand");
    const before = deckSize(s, seat);
    s = play(s, c);
    assert.equal(before, deckSize(s, seat), `${seat}/${id}: the unreadable Auto does not fire as a bare play`);
  }
}
console.log("#962 played-or-attacks: reading, stored rows, play once, attack once, once per turn across both, neighbours and refused alternatives, both seats passed");
