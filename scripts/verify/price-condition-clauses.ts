/**
 * #961: an [Activate] price that states several things is read whole or not at
 * all. Printed text (Bandai card list, deckplanet feed of 17 Oct 2026) ->
 * compile -> stored-row JSON round-trip -> the real VM.
 *
 *   BT19-145  "[Activate: Battle]{u}/{y}, if your Leader is blue or yellow and 3 or more
 *             blue and/or yellow cards are in your Combo Area: Play this card from your
 *             hand."  Read as the Leader colour alone, the Combo Area count silently lost.
 *   P-441     "[Activate: Main]{u}, if your Leader is blue, has <Gotenks> in its character
 *             name, and you send 1 blue card with <Son Goten> … and 1 blue card with
 *             <Trunks> … from your hand and/or Drop to your Warp: Play this card from your
 *             hand."  Read as "Leader is blue": the Gotenks requirement and the send-to-Warp
 *             price gone, the card played for {u} alone.
 *
 * BT19-145 now reads in full and is offered only with 3 or more qualifying cards in the
 * Combo Area. P-441's two-card send price is an action no price reader can charge yet, so
 * the whole line is left unread (never offered); the Leader property list ("is blue, has
 * <X> in its character name") is read in full and proven on a synthetic line without the
 * send price.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { priceIsUnread } from "../../src/lib/arena/compile/prices";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const BT19_145 = "[Activate: Battle]{u}/{y}, if your Leader is blue or yellow and 3 or more blue and/or yellow cards are in your Combo Area: Play this card from your hand.";
const P_441 = "[Activate: Main]{u}, if your Leader is blue, has <Gotenks> in its character name, and you send 1 blue card with <Son Goten> in its character name and 1 blue card with <Trunks> in its character name from your hand and/or Drop to your Warp: Play this card from your hand.";
/** The Leader property list on its own, with a price the compiler can read: the generic fix, off any card id. */
const LIST = "[Activate: Main]{u}, if your Leader is blue, has <Gotenks> in its character name, and you have 2 or more energy: Play this card from your hand.";

const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const one = (text: string) => parseSkills(text)[0]!;

// ── the reading ──────────────────────────────────────────────────────────────
{
  const read = compileSkill(one(BT19_145));
  assert.deepEqual(read.unsupported, [], "BT19-145 reads whole");
  const cond = (read.ops[0] as { op: string; cond: { kind: string; conds: { kind: string; atLeast?: number; filter?: { colors: string[] }; sel?: { area: string; side: string; filter: { colors: string[] } } }[] } }).cond;
  assert.equal(read.ops[0].op, "if");
  assert.equal(cond.kind, "all", "both requirements gate the skill");
  const [leader, count] = cond.conds;
  assert.equal(leader.kind, "leaderMatches");
  assert.deepEqual(leader.filter!.colors, ["Blue", "Yellow"], "the Leader is blue or yellow");
  assert.equal(count.kind, "count");
  assert.equal(count.atLeast, 3, "3 or more …");
  assert.deepEqual([count.sel!.area, count.sel!.side], ["combo", "you"], "… in your Combo Area");
  assert.deepEqual(count.sel!.filter.colors, ["Blue", "Yellow"], "… blue and/or yellow cards, counted together");

  // #970: the two-card send price is read now (disjoint slots, `scripts/verify/disjoint-send-costs.ts`).
  const gotenks = compileSkill(one(P_441));
  assert.deepEqual(gotenks.unsupported, [], "P-441 reads whole: the Leader list and the two-slot send");
  assert.equal(priceIsUnread(one(P_441)), false);

  const list = compileSkill(one(LIST));
  assert.deepEqual(list.unsupported, [], "the Leader property list reads whole");
  const listCond = (list.ops[0] as { cond: { kind: string; conds: { kind: string; filter: { colors: string[] } }[] } }).cond;
  assert.equal(listCond.kind, "all");
  assert.deepEqual(listCond.conds.map((c) => c.kind), ["leaderMatches", "leaderMatches", "count"]);
  assert.deepEqual(listCond.conds[0].filter.colors, ["Blue"]);
  assert.match(JSON.stringify(listCond.conds[1].filter), /"gotenks"/, "has <Gotenks> in its character name");
}

// ── controls: nothing else widens or narrows ─────────────────────────────────
{
  const unread = (text: string) => compileSkill(one(text)).unsupported.length > 0;
  // A Leader description never swallows what follows it.
  assert.ok(!unread("[Activate: Main]{r}{r}{r}, send 1 <Pilaf> card, 1 <Mai> card, and 1 <Shu> card from your Drop Area to your Warp: Play this card from your hand."), "BT10-025's three-card send price reads since #970 (disjoint choices)");
  assert.ok(unread("[Activate: Main]{r}, if your Leader Card is a black ≪Saiyan≫ card and you send this card and 1 <Goku Black> card from your Combo Area to their owners' Warps: Play this card from your hand."), "a Leader condition does not hide an unread send price");
  // "and/or" across places counts the places together, which one count cannot say.
  assert.ok(unread("[Activate: Battle]{2}, if you have 2 or more blue and/or yellow cards in your Battle Area and/or Combo Area: Play this card from your hand or Warp."), "BT16-087's two places are unread");
  // "A total of N" is N, not the article's one; across a list of places it is unread, never one place's count.
  const total = compileSkill(one("[Activate: Main]{1}, if you have a total of 2 or more green cards in your Combo Area: Play this card from your hand."));
  assert.deepEqual(total.unsupported, []);
  assert.equal((total.ops[0] as { cond: { atLeast: number } }).cond.atLeast, 2, "'a total of 2 or more' asks for 2");
  assert.ok(unread("[Permanent] If you have a total of 7 or more cards in your energy, Z-Energy, Battle Area, and Drop, reduce this card's energy cost in your hand by 2."), "a total across a list of places is unread");
  // A price that is neither a condition nor an action the compiler can charge is no free price.
  assert.ok(unread("[Activate: Main]{u}, send 1 blue card with <Son Goten> in its character name and up to 1 blue card with <Trunks> in its character name from your hand and/or Drop to your Warp: Play this card from your hand."), "a bare unreadable action price leaves the line unread");
  // Readable prices are untouched.
  const priced = compileSkill(one("[Activate: Main]{u}, send 1 blue card from your hand to your Warp: Play this card from your hand."));
  assert.deepEqual(priced.unsupported, [], "a one-card send price still reads");
  const plain = compileSkill(one("[Activate: Main]{u}: Play this card from your hand."));
  assert.deepEqual(plain.unsupported, [], "an orb-only price still reads");
  const x = compileSkill(one("[Activate: Main] Pay X energy: Draw X cards."));
  assert.deepEqual(x.unsupported, [], "an X price still reads");
  // Spirit Boost and Bond name their descriptors before the price; that is not a second price.
  const boost = compileSkill(one("[Activate: Main][Once per turn][Spirit Boost 1] Blue Unison Card with a specified cost of 2 or more: Play 1 Ghost Token with 15000 power."));
  assert.deepEqual(boost.unsupported, [], "a [Spirit Boost] descriptor is not an unread price");
  const bond = compileSkill(one("[Activate: Battle][Once per turn][Bond 2] ≪Alien≫ (This skill takes effect when you have 2 or more of the specified Battle Cards in play.): Choose up to 1 of your red ≪Alien≫ cards in battle, and it gets +10000 power for the duration of the turn."));
  assert.deepEqual(bond.unsupported, [], "a [Bond] descriptor is not an unread price");
}

// ── the VM ───────────────────────────────────────────────────────────────────
const blue = (id: string, extra: Partial<CardDef> = {}) => card(id, { colors: ["Blue"], energyCost: 0, power: 5000, skill: null, ...extra });
const defs: Record<string, CardDef> = {
  ...DEFS,
  "BT19-145": card("BT19-145", { colors: ["Blue"], energyCost: 5, power: 15000, comboCost: 0, comboPower: 5000, skill: BT19_145 }),
  "P-441": card("P-441", { colors: ["Blue"], energyCost: 5, power: 15000, comboCost: 0, comboPower: 5000, skill: P_441 }),
  LIST961: card("LIST961", { colors: ["Blue"], energyCost: 5, power: 15000, comboCost: 0, comboPower: 5000, skill: LIST }),
  // Leaders: blue, yellow, red, and a blue <Gotenks> one.
  "L961-BLUE": card("L961-BLUE", { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null, power: 10000, skill: null }),
  "L961-YELLOW": card("L961-YELLOW", { type: "LEADER", colors: ["Yellow"], energyCost: null, comboCost: null, comboPower: null, power: 10000, skill: null }),
  "L961-RED": card("L961-RED", { type: "LEADER", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, power: 10000, skill: null }),
  "L961-GOTENKS": card("L961-GOTENKS", { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null, power: 10000, characters: ["Gotenks"], skill: null }),
  "L961-GOTEN": card("L961-GOTEN", { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null, power: 10000, characters: ["Son Goten"], skill: null }),
  B961: blue("B961"),
  Y961: card("Y961", { colors: ["Yellow"], energyCost: 0, power: 5000, skill: null }),
  R961: card("R961", { colors: ["Red"], energyCost: 0, power: 5000, skill: null }),
  GOTEN961: blue("GOTEN961", { characters: ["Son Goten"] }),
  TRUNKS961: blue("TRUNKS961", { characters: ["Trunks"] }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "confirmed" } as unknown as RuleRow)));
const stored = roundtrip(rows);
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(stored, defs) };
const game = (() => {
  const loaded = rulesetFor("dbs");
  assert.ok(loaded.ok);
  return loaded.definition;
})();

// The stored rows carry what the compiler read.
{
  const rec = (id: string) => skillRecords(defs[id]).find((r) => r.kind.startsWith("activate"))!;
  assert.deepEqual(rec("BT19-145").unread, []);
  const price = roundtrip(rec("BT19-145").cost) as { condition?: { kind: string } } | null;
  assert.equal(price?.condition?.kind, "all", "BT19-145's stored price condition holds both requirements");
  assert.deepEqual(rec("P-441").unread, [], "P-441's stored record is read (#970)");
}

function take(s: VmState, action: Action): VmState {
  return RULES.apply(ctx, roundtrip(s), action).state as VmState;
}
function main(leader: string): VmState {
  let s = RULES.createGame(ctx, { seed: 961, p1: { name: "You", leader, main: fifty("V1") }, p2: { name: "Other", leader: "L-RED", main: fifty("V-BLUE") } }).state as VmState;
  s = take(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = take(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  s = take(s, { type: "endMain", player: "p1" });
  for (let i = 0; i < 40 && !(s.prompt.kind === "main" && s.turnPlayer === "p1"); i++) {
    const p = (s.prompt as { player: PlayerId }).player;
    s = take(s, s.prompt.kind === "main" ? { type: "endMain", player: p } : s.prompt.kind === "charge" ? { type: "charge", player: p, card: null } : { type: "pass", player: p });
  }
  assert.equal(s.prompt.kind, "main");
  assert.equal(s.turnPlayer, "p1");
  return s;
}
function stage(s: VmState, def: string, area: string, mode: "active" | "rest" = "active"): string {
  const id = s.sides.p1.zones.deck[0];
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: "p1" }).ok);
  if (area === "energy" || area === "battle") s.cards[id].mode = mode;
  return id;
}
/** p1's hand and energy emptied of the deal, so the board holds exactly what a case names. */
function clear(s: VmState): void {
  for (const area of ["hand", "energy"]) for (const id of s.sides.p1.zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p1", position: "bottom" }).ok);
}
const activates = (s: VmState, id: string) => RULES.legalActions(ctx, s).filter((l) => l.action.type === "activate" && (l.action as { card?: string }).card === id);

/** p1 attacks p2's Leader and reaches its own combo prompt, where [Activate: Battle] is offered. */
function toCombo(s: VmState): VmState {
  s = take(s, { type: "attack", player: "p1", attacker: s.sides.p1.zones.leader[0], target: s.sides.p2.zones.leader[0] });
  for (let i = 0; i < 12 && !(s.prompt.kind === "combo" && (s.prompt as { player: PlayerId }).player === "p1"); i++) {
    const p = s.prompt as { kind: string; player: PlayerId };
    assert.equal(p.player, "p2", `the battle waits on p2, not ${p.kind}`);
    const pass = RULES.legalActions(ctx, s).find((l) => l.action.type === "pass" || (l.action.type === "block" && (l.action as { card: unknown }).card === null));
    assert.ok(pass, `p2 can pass at ${p.kind}`);
    s = take(s, pass.action);
  }
  assert.equal(s.prompt.kind, "combo");
  return s;
}

// BT19-145: the Combo Area count gates the offer, whichever colour qualifies.
const COUNTS: [string, string[], boolean][] = [
  ["no combo cards", [], false],
  ["two blue combo cards", ["B961", "B961"], false],
  ["three blue combo cards", ["B961", "B961", "B961"], true],
  ["blue and yellow count together", ["B961", "Y961", "B961"], true],
  ["two blue and a red one", ["B961", "B961", "R961"], false],
];
for (const leader of ["L961-BLUE", "L961-YELLOW"]) {
  for (const [name, combo, offered] of COUNTS) {
    const s = main(leader);
    clear(s);
    const card145 = stage(s, "BT19-145", "hand");
    stage(s, "B961", "energy");
    let c = toCombo(s);
    for (const def of combo) stage(c, def, "combo");
    const rows = activates(c, card145);
    assert.equal(rows.length > 0, offered, `${leader}, ${name}: BT19-145 ${offered ? "is" : "is not"} offered (${JSON.stringify(rows.map((r) => r.label))})`);
    if (offered) {
      c = take(c, rows[0].action);
      assert.ok(c.sides.p1.zones.battle.includes(card145), `${leader}, ${name}: and the activation plays the card`);
    }
  }
}
// The Leader half of the condition still gates it: a red Leader never qualifies, with three blue cards waiting.
{
  const s = main("L961-RED");
  clear(s);
  const card145 = stage(s, "BT19-145", "hand");
  stage(s, "B961", "energy");
  const c = toCombo(s);
  for (const def of ["B961", "B961", "B961"]) stage(c, def, "combo");
  assert.equal(activates(c, card145).length, 0, "a red Leader: not offered");
}

// P-441 (#970): the Leader list gates it, and the price needs a Goten and a Trunks card of its own.
for (const [leader, cards, offered] of [
  ["L961-GOTENKS", ["GOTEN961", "TRUNKS961"], true],
  ["L961-GOTENKS", ["GOTEN961"], false],
  ["L961-GOTENKS", [], false],
  ["L961-BLUE", ["GOTEN961", "TRUNKS961"], false],
] as [string, string[], boolean][]) {
  const s = main(leader);
  clear(s);
  const card441 = stage(s, "P-441", "hand");
  stage(s, "B961", "energy");
  for (const c of cards) stage(s, c, "hand");
  assert.equal(activates(s, card441).length > 0, offered, `${leader} with ${cards.join("+") || "nothing"}: P-441 ${offered ? "is" : "is not"} offered`);
}

// The Leader property list (no send price) is read in full: only a blue <Gotenks> Leader with the energy qualifies.
for (const [leader, energy, offered] of [
  ["L961-GOTENKS", 2, true],
  ["L961-GOTENKS", 1, false],
  ["L961-BLUE", 2, false],
  ["L961-GOTEN", 2, false],
  ["L961-RED", 2, false],
] as [string, number, boolean][]) {
  const s = main(leader);
  clear(s);
  const id = stage(s, "LIST961", "hand");
  for (let i = 0; i < energy; i++) stage(s, "B961", "energy");
  assert.equal(activates(s, id).length > 0, offered, `${leader}, ${energy} energy: the property list ${offered ? "holds" : "does not hold"}`);
}

console.log("  #961: BT19-145 read whole and gated by its Combo Area count; P-441 read with its two-slot send (#970); Leader property list read, controls kept");
