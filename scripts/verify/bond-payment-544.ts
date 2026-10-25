/**
 * #544 (fuzz, 3 of 40 games): XD1-05's "[Auto][Bond 2] ≪Universe 6≫: (…)"
 * was stored with cost `{ text: "≪Universe 6≫", readable: false, program: null }`
 * and interrupted every game it fired in with "the stored skill payment is
 * unreadable". [Bond X] ≪Universe 6≫ names the Battle Cards the keyword counts
 * (22-21-3): a condition `bondIsValid` checks, never a payment. The typed
 * payment record (`compileCostRecord`) now calls a price that is only that
 * descriptor — one bracketed selector, its reminder note, orbs — readable,
 * paying its orbs alone; selector text it cannot prove stays unreadable.
 *
 * Proof on the exact printed text, through stored rows (`skillRecords` →
 * JSON → `rulesFromRows`, the path a match loads), for both seats.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { compileCostRecord } from "../../src/lib/arena/compile/prices";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { bondSelector } from "../../src/lib/arena/text/bond";
import { recordContractGaps, rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

/** XD1-05, as printed. */
const XD1_05 = "[Auto][Bond 2] ≪Universe 6≫: (This skill takes effect when you have 2 or more of the specified Battle Cards in play.) When you play this card, reduce the combo cost of blue and yellow ≪Universe 6≫ cards in your hand by 1 for the duration of the turn.";

const defs: Record<string, CardDef> = { ...DEFS,
  "XD1-05": card("XD1-05", { colors: ["Blue"], energyCost: 0, traits: ["Universe 6"], skill: XD1_05 }),
  U6_544: card("U6_544", { energyCost: 0, traits: ["Universe 6"], skill: null }),
  OTHER_544: card("OTHER_544", { energyCost: 0, traits: ["Saiyan"], skill: null }),
};
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;

// ── the reading ──────────────────────────────────────────────────────────────
{
  const skill = parseSkills(XD1_05)[0];
  assert.equal(skill.kind, "auto");
  assert.equal(skill.bond, 2);
  assert.equal(skill.cost, "≪Universe 6≫");
  const cost = compileCostRecord(skill);
  assert.equal(cost.readable, true, "a Bond descriptor is a readable, empty payment");
  assert.equal(cost.program, null, "the descriptor charges no action");
  assert.equal(cost.condition, null, "the Bond count is the keyword's validity, not a price condition");
  assert.deepEqual(cost.orbs, {}, "no energy");
  const selector = bondSelector(skill);
  assert.ok(selector?.kind === "filter", "the descriptor is a specified-card selector");
  assert.deepEqual(selector.filter.traits, ["Universe 6"], "the Bond counts ≪Universe 6≫ Battle Cards");

  const row = rows.find((r) => r.cardId === "XD1-05")!;
  assert.ok(row);
  assert.deepEqual(recordContractGaps(roundtrip(row)), [], "the stored row needs no rebuild");
  assert.deepEqual(runtimeSupportOfRow(roundtrip(row)).unsupported, [], "the stored row is runnable");

  // Every bracket form of the selector, and one with orbs beside it, is read the same.
  for (const t of [
    "[Auto][Bond 2] <Son Goku>: When you play this card, draw 1 card.",
    "[Auto][Bond 2] {Kami}: When you play this card, draw 1 card.",
    "[Auto][Bond 2] ≪Universe 6≫ {g}: When you play this card, draw 1 card.",
    "[Activate: Battle][Once per turn][Bond 2] ≪Alien≫ (This skill takes effect when you have 2 or more of the specified Battle Cards in play.): Choose up to 1 of your red ≪Alien≫ cards in battle, and it gets +10000 power for the duration of the turn.",
  ]) assert.equal(compileCostRecord(parseSkills(t)[0]).readable, true, `readable: ${t}`);
  // Text the selector reader cannot prove stays unread, never free.
  assert.equal(compileCostRecord({ ...skill, cost: "≪Universe 6≫ draw 1 card" }).readable, false);
  assert.equal(compileCostRecord({ ...skill, cost: "Universe 6 cards" }).readable, false);
}

// ── the VM, both seats ───────────────────────────────────────────────────────
function main(first: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 544, p1: { name: "One", leader: "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = RULES.apply(ctx, s, { type: "chooseFirst", player: s.chooser, first }).state as VmState;
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) {
    s = RULES.apply(ctx, s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state as VmState;
  }
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, first);
  return s;
}
function stage(s: VmState, p: PlayerId, id: string, area: "hand" | "battle"): string {
  const physical = area === "hand" ? s.sides[p].zones.hand[0] : s.sides[p].zones.deck[0];
  assert.ok(physical);
  s.cards[physical].cardId = id;
  if (area === "battle") assert.ok(moveCard(s, game, physical, "battle", { owner: p }).ok);
  return physical;
}
function playWith(p: PlayerId, battle: string[]): { source: string; state: VmState; events: GameEvent[] } {
  const s = main(p);
  for (const id of battle) stage(s, p, id, "battle");
  const source = stage(s, p, "XD1-05", "hand");
  const r = RULES.apply(ctx, s, { type: "play", player: p, card: source } as Action);
  return { source, state: r.state as VmState, events: r.events as GameEvent[] };
}

for (const p of ["p1", "p2"] as PlayerId[]) {
  // One ≪Universe 6≫ Battle Card (XD1-05 itself) beside an unrelated one: Bond 2 does not hold.
  const one = playWith(p, ["OTHER_544"]);
  assert.equal(one.state.outcome, undefined, `${p}: no interruption with 1`);
  assert.equal(one.state.prompt.kind, "main", `${p}: back at main with 1`);
  assert.equal(one.events.some((e) => e.type === "skill" && e.card === one.source), false, `${p}: Bond 2 with 1 ≪Universe 6≫ does not fire`);

  // A second ≪Universe 6≫ Battle Card: Bond 2 holds, the Auto fires with no payment and no interruption.
  const two = playWith(p, ["U6_544"]);
  assert.equal(two.state.outcome, undefined, `${p}: no interruption with 2 (#544)`);
  assert.equal(two.state.prompt.kind, "main", `${p}: no price prompt with 2`);
  assert.equal(two.events.filter((e) => e.type === "skill" && e.card === two.source).length, 1, `${p}: Bond 2 with 2 ≪Universe 6≫ fires once`);
}

console.log("bond-payment-544: XD1-05's Bond descriptor is a readable empty payment; fires with 2 ≪Universe 6≫, not 1, both seats");
