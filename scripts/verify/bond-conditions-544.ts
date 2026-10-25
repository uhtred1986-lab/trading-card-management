/**
 * The two [Bond X] wordings #544 (PR #1156) left unread (owner, 25 Oct 2026).
 *
 * 1. A compound descriptor: "[Blocker][Bond 3] Red ≪Saiyan≫ cards and/or
 *    ≪Bardock's Crew≫ cards." (BT13-006). The Bond counts Battle Cards that
 *    match either alternative (22-21-3-1); the colour belongs to the
 *    alternative it is printed on. On a bare keyword line the descriptor is
 *    not an effect, and the keyword is the card's only while the Bond holds.
 * 2. A Bond followed by a condition and no descriptor: "[Auto][Bond 2] If
 *    your Leader Card is a ≪Slug's Army≫ card:" (BT12-060). `priceText` cut
 *    the whole condition off as if it were a descriptor, so it was lost and
 *    the line unread. Both gates now apply: the Bond's plain count (22-21-3)
 *    and the price's condition (9-1-3). Also with orbs and a compound
 *    condition: "[Bond 2]{g}, if your Leader is green and you have 3 or more
 *    energy:" (BT27-139).
 *
 * Proof on the exact printed texts, through stored rows (`skillRecords` →
 * JSON → `rulesFromRows`, the path a match loads), for both seats.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { compileCostRecord } from "../../src/lib/arena/compile/prices";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { bondSelector } from "../../src/lib/arena/text/bond";
import { recordContractGaps, rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { hasKeyword } from "../../src/lib/arena/vm/program";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

// ── the printed texts ────────────────────────────────────────────────────────
const BT13_006 = "[Blocker][Bond 3] Red ≪Saiyan≫ cards and/or ≪Bardock's Crew≫ cards.";
const BT12_060 = "[Auto][Bond 2] If your Leader Card is a ≪Slug's Army≫ card: When your opponent uses a card in a combo, you may place that card in its owner's Drop Area. If you do, you and your opponent draw 1 card, then negate this skill for the turn.";
const DB3_094 = "[Auto][Bond 2] If your opponent has 4 or more cards in Rest Mode: When this card attacks, your opponent chooses 2 of their cards in Rest Mode; the chosen cards can't be switched to Active Mode until the start of your next turn.";
const BT13_012 = "[Activate: Main][Bond 3][Once per turn] If your opponent has 3 or more energy: This card gets +21000 power until the start of your next Main Phase.";
const BT27_139 = "[Activate: Main][Bond 2]{g}, if your Leader is green and you have 3 or more energy: Play this card from your hand, and this card gains [Barrier] until the end of your opponent's turn.";
const DB3_130 = "[Auto][Bond 3] If your Leader Card is green: When this card attacks, choose one- ・Choose up to 1 card in your opponent's hand and discard it. ・Choose up to 1 of your opponent's Battle Cards in Rest Mode and KO it.";
const BT24_080_B = "[Activate: Main][Once per turn][Bond 5] If you have 3 or more energy: During this turn, the next time you place {Fruit of the Tree of Might, Forbidden Power} in your Battle Area from your Z-Deck, reduce its energy cost by {y}.";

const defs: Record<string, CardDef> = { ...DEFS,
  "BT13-006": card("BT13-006", { colors: ["Red"], energyCost: 0, traits: ["Bardock's Crew"], skill: BT13_006 }),
  "BT12-060": card("BT12-060", { colors: ["Green"], energyCost: 0, traits: ["Slug's Army"], skill: BT12_060 }),
  "DB3-094": card("DB3-094", { colors: ["Green"], energyCost: 0, skill: DB3_094 }),
  "BT13-012": card("BT13-012", { colors: ["Red"], energyCost: 0, skill: BT13_012 }),
  "BT27-139": card("BT27-139", { colors: ["Green"], energyCost: 2, skill: BT27_139 }),
  "DB3-130": card("DB3-130", { colors: ["Green"], energyCost: 0, skill: DB3_130 }),
  "BT24-080": card("BT24-080", { colors: ["Yellow"], energyCost: 0, skill: BT24_080_B }),
  RED_SAIYAN: card("RED_SAIYAN", { colors: ["Red"], energyCost: 0, traits: ["Saiyan"] }),
  BLUE_SAIYAN: card("BLUE_SAIYAN", { colors: ["Blue"], energyCost: 0, traits: ["Saiyan"] }),
  BLUE_CREW: card("BLUE_CREW", { colors: ["Blue"], energyCost: 0, traits: ["Bardock's Crew"] }),
  PLAIN: card("PLAIN", { colors: ["Red"], energyCost: 0 }),
  GREEN_E: card("GREEN_E", { colors: ["Green"], energyCost: 0 }),
  L_GREEN: card("L_GREEN", { type: "LEADER", colors: ["Green"], energyCost: null, comboCost: null, comboPower: null }),
};
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;

// ── the reading ──────────────────────────────────────────────────────────────
const conditional = { "BT12-060": BT12_060, "DB3-094": DB3_094, "BT13-012": BT13_012, "BT27-139": BT27_139, "DB3-130": DB3_130, "BT24-080": BT24_080_B };
for (const [id, text] of Object.entries({ "BT13-006": BT13_006, ...conditional })) {
  const skill = parseSkills(text)[0];
  assert.ok(skill.bond != null, `${id}: the line carries [Bond]`);
  assert.deepEqual(compileSkill(skill).unsupported, [], `${id}: the whole line is read`);
  assert.equal(compileCostRecord(skill).readable, true, `${id}: the payment record is readable`);
  const row = rows.find((r) => r.cardId === id);
  assert.ok(row, `${id}: a stored row`);
  assert.deepEqual(recordContractGaps(roundtrip(row)), [], `${id}: the stored row needs no rebuild`);
  assert.deepEqual(runtimeSupportOfRow(roundtrip(row)).unsupported, [], `${id}: the stored row is runnable`);
}
// A Bond with a condition and no descriptor: the plain count, and the condition is the price's.
for (const [id, text] of Object.entries(conditional)) {
  const skill = parseSkills(text)[0];
  assert.deepEqual(bondSelector(skill), { kind: "any" }, `${id}: no Battle Card is specified`);
  const cost = compileCostRecord(skill);
  assert.ok(cost.condition, `${id}: the condition is kept`);
  assert.equal(cost.program, null, `${id}: and charges no action`);
}
assert.equal(compileCostRecord(parseSkills(BT12_060)[0]).condition?.kind, "leaderMatches");
{
  const both = compileCostRecord(parseSkills(BT27_139)[0]);
  assert.equal(both.condition?.kind, "all", "BT27-139: both conditions");
  assert.deepEqual(both.orbs, { Green: 1 }, "BT27-139: and its {g}");
}
// The compound: either alternative, the colour on the first only.
{
  const sel = bondSelector(parseSkills(BT13_006)[0]);
  assert.ok(sel?.kind === "filter");
  assert.deepEqual(sel.filter.anyOf?.map((f) => [f.colors, f.traits]), [[["Red"], ["Saiyan"]], [[], ["Bardock's Crew"]]]);
  for (const text of [
    "[Auto][Bond 2] ≪Saiyan≫ cards or ≪Bardock's Crew≫ cards: When you play this card, draw 1 card.",
    "[Auto][Bond 2] Red ≪Saiyan≫ cards and/or <Son Goku> cards: When you play this card, draw 1 card.",
  ]) {
    const skill = parseSkills(text)[0];
    assert.equal(bondSelector(skill)?.kind, "filter", `read: ${text}`);
    assert.equal(compileCostRecord(skill).readable, true, `readable: ${text}`);
  }
}
// Anything the reader cannot prove stays unread, never free.
for (const text of [
  "[Blocker][Bond 3] Red ≪Saiyan≫ cards and/or Earthling cards.",
  "[Blocker][Bond 3] Red ≪Saiyan≫ cards with an energy cost of 2 or more and/or ≪Bardock's Crew≫ cards.",
]) assert.notDeepEqual(compileSkill(parseSkills(text)[0]).unsupported, [], `unread: ${text}`);
for (const text of [
  "[Auto][Bond 2] ≪Saiyan≫ cards and/or draw 1 card: When you play this card, draw 1 card.",
  "[Auto][Bond 2] Red ≪Saiyan≫ cards and/or Earthling cards: When you play this card, draw 1 card.",
]) {
  const skill = parseSkills(text)[0];
  assert.equal(bondSelector(skill)?.kind, "unknown", `unknown: ${text}`);
  assert.equal(compileCostRecord(skill).readable, false, `unreadable: ${text}`);
}
// #544's single descriptor is read as before.
assert.equal(compileCostRecord(parseSkills("[Auto][Bond 2] ≪Universe 6≫: When you play this card, draw 1 card.")[0]).readable, true);

// ── the VM, both seats ───────────────────────────────────────────────────────
let events: GameEvent[] = [];
function take(s: VmState, action: Action): VmState {
  const r = RULES.apply(ctx, roundtrip(s), action);
  events = events.concat(r.events as GameEvent[]);
  return r.state as VmState;
}
/** `p` in its second Main Phase (it may attack: 7-3-4-4-1). */
function fresh(p: PlayerId, leader = "L-RED"): VmState {
  const o: PlayerId = p === "p1" ? "p2" : "p1";
  const decks = { [p]: { name: "Me", leader, main: fifty("V1") }, [o]: { name: "Foe", leader: "L-BLUE", main: fifty("V-BLUE") } } as Record<PlayerId, { name: string; leader: string; main: string[] }>;
  let s = RULES.createGame(ctx, { seed: 544, p1: decks.p1, p2: decks.p2 }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: p },
    { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: o, redraw: false },
    { type: "charge", player: p, card: null }, { type: "endMain", player: p }, { type: "charge", player: o, card: null },
    { type: "endMain", player: o }, { type: "charge", player: p, card: null },
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, p);
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string, mode: "active" | "rest" = "active"): string {
  const id = area === "hand" ? s.sides[p].zones.hand[0] : s.sides[p].zones.deck[0];
  s.cards[id].cardId = def;
  if (area !== "hand") assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy") s.cards[id].mode = mode;
  return id;
}
function finish(s: VmState): VmState {
  for (let i = 0; i < 60 && (s.battle || s.prompt.kind !== "main"); i++) {
    const q = s.prompt;
    if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null });
    else if (q.kind === "blocker" || q.kind === "combo") s = take(s, { type: "pass", player: q.player } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, Math.max(q.choice.min, Math.min(q.choice.max ?? 1, q.choice.candidates.length))) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "main") break;
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  assert.equal(s.outcome, undefined, "no interruption");
  assert.equal(s.prompt.kind, "main");
  return s;
}

for (const p of ["p1", "p2"] as PlayerId[]) {
  const o: PlayerId = p === "p1" ? "p2" : "p1";

  // BT13-006: [Blocker] only while 3 red ≪Saiyan≫ and/or ≪Bardock's Crew≫ Battle Cards stand.
  {
    const s = fresh(p);
    const tora = stage(s, p, "BT13-006", "battle");
    stage(s, p, "PLAIN", "battle");
    stage(s, p, "BLUE_SAIYAN", "battle");
    assert.equal(hasKeyword(ctx, game, s, tora, "Blocker"), false, `${p}: 3 Battle Cards but 1 matching: no [Blocker]`);
    stage(s, p, "RED_SAIYAN", "battle");
    assert.equal(hasKeyword(ctx, game, s, tora, "Blocker"), false, `${p}: 2 matching: no [Blocker]`);
    stage(s, p, "BLUE_CREW", "battle");
    assert.equal(hasKeyword(ctx, game, s, tora, "Blocker"), true, `${p}: Tora, a red ≪Saiyan≫ and a blue ≪Bardock's Crew≫: [Blocker]`);
  }

  // DB3-094: fires only when [Bond 2] holds AND the opponent has 4 or more cards in Rest Mode.
  for (const [bond, rest, fires] of [[true, 4, true], [false, 4, false], [true, 3, false]] as const) {
    events = [];
    let s = fresh(p);
    const attacker = stage(s, p, "DB3-094", "battle");
    if (bond) stage(s, p, "PLAIN", "battle");
    const resting = Array.from({ length: rest }, () => stage(s, o, "PLAIN", "battle", "rest"));
    const target = s.sides[o].zones.leader[0];
    const atk = RULES.legalActions(ctx, s).find((l) => l.action.type === "attack" && (l.action as { attacker?: string }).attacker === attacker && (l.action as { target?: string }).target === target);
    assert.ok(atk, `${p}: the attack is offered`);
    s = finish(take(s, atk.action));
    const locked = s.effects.filter((e) => resting.includes(e.target as string)).length;
    assert.equal(locked > 0, fires, `${p}: DB3-094 with Bond ${bond ? "held" : "short"} and ${rest} resting cards ${fires ? "locks" : "does not lock"} them`);
  }

  // BT13-012: offered only when [Bond 3] holds AND the opponent has 3 or more energy.
  for (const [bond, energy, offered] of [[true, 3, true], [false, 3, false], [true, 2, false]] as const) {
    const s = fresh(p);
    const goku = stage(s, p, "BT13-012", "battle");
    stage(s, p, "PLAIN", "battle");
    if (bond) stage(s, p, "PLAIN", "battle");
    for (let i = s.sides[o].zones.energy.length; i < energy; i++) stage(s, o, "PLAIN", "energy");
    assert.equal(s.sides[o].zones.energy.length, energy);
    const act = RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && (l.action as { card?: string }).card === goku);
    assert.equal(!!act, offered, `${p}: BT13-012 with Bond ${bond ? "held" : "short"} and ${energy} opposing energy is ${offered ? "" : "not "}offered`);
    if (act) {
      events = [];
      const after = finish(take(s, act.action));
      assert.ok(events.some((e) => e.type === "skill" && e.card === goku), `${p}: BT13-012 resolves`);
      assert.ok(after.effects.some((e) => e.target === goku && e.kind === "power"), `${p}: +21000 power`);
    }
  }

  // BT27-139: from the hand, only with [Bond 2], a green Leader AND 3 or more energy.
  for (const [bond, leader, energy, offered] of [[true, "L_GREEN", 3, true], [false, "L_GREEN", 3, false], [true, "L-RED", 3, false], [true, "L_GREEN", 2, false]] as const) {
    const s = fresh(p, leader);
    stage(s, p, "PLAIN", "battle");
    if (bond) stage(s, p, "PLAIN", "battle");
    for (const id of [...s.sides[p].zones.energy]) s.cards[id].cardId = "GREEN_E";
    for (let i = s.sides[p].zones.energy.length; i < energy; i++) stage(s, p, "GREEN_E", "energy");
    const goku = stage(s, p, "BT27-139", "hand");
    const act = RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && (l.action as { card?: string }).card === goku);
    assert.equal(!!act, offered, `${p}: BT27-139 with Bond ${bond ? "held" : "short"}, ${leader}, ${energy} energy is ${offered ? "" : "not "}offered`);
  }
}

console.log("bond-conditions-544: compound Bond descriptors and Bond-then-condition prices read; both gates hold, both seats");
