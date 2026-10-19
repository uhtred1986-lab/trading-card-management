/** #907: frozen selected-pair use ceilings carried by executable records.
 * Ten compiler-owned target skills are exercised; BT6-001/back/10 stays protected/unread.
 * No database/network. --stored-rules verifies the ten exact actual readback rows.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalizeRows } from "../arena-corpus-provenance.mts";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { deepEqual, parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { blocksOf, ruleFromBlocks } from "../../src/lib/arena/lang/blocks";
import { usageProblem, type UsageRecord } from "../../src/lib/arena/vm/usage";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { run } from "../../src/lib/arena/vm/flow";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { skillsShowing } from "../../src/lib/arena/vm/triggers";
import { usesLeft } from "../../src/lib/arena/vm/limits";
import { CTX, DEFS, card, fifty } from "./harness";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const root = "docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/";
const catalogPath = root + "catalog.json", physicalPath = root + "stored-rules.json";
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")).cards;
const physical: Record<string, unknown>[] = JSON.parse(readFileSync(physicalPath, "utf8"));
const targets = [["BT6-001", "front", 0], ["BT6-003", "front", 10], ["BT6-004", "front", 10], ["BT6-007", "front", 10], ["BT6-008", "front", 10], ["BT6-015", "front", 30], ["BT6-053", "back", 20], ["BT6-060", "front", 20], ["BT6-061", "front", 20], ["BT6-062", "front", 0]] as const;
const key = (r: { cardId: string; side: string; skillIndex: number }) => `${r.cardId}/${r.side}/${r.skillIndex}`;
const targetKeys = targets.map(([cardId, side, skillIndex]) => key({ cardId, side, skillIndex }));
const defs: Record<string, CardDef> = { ...DEFS,
  GOKU907: card("GOKU907", { characters: ["Son Goku: Br"], colors: ["Red"] }),
  BROLY907: card("BROLY907", { characters: ["Broly: Br"], power: 15000 }),
  TARGET907: card("TARGET907", { energyCost: 1, power: 20000 }),
  PRICE907: card("PRICE907", { energyCost: 0, skill: "[Auto][Once per turn] Choose 1 card from your hand and place it in your Drop Area: When this card is played, draw 1 card." }),
  OPTIONAL907: card("OPTIONAL907", { energyCost: 0, skill: "[Auto][Once per turn] When this card is played, you may draw 1 card." }),
  FALSE907: card("FALSE907", { skill: "[Activate: Main][Once per turn] Choose 1 card from your hand and place it in your Drop Area: If your Leader Card is blue, draw 1 card." }),
};
for (const [id] of targets) defs[id] = cardDefFrom(catalog.find((c: CardDef) => c.id === id));
const rows = Object.values(defs).flatMap((def) => skillRecords(def).map((r) => ({ ...r, source: "compiler", status: r.unread.length ? "open" : "draft" } as RuleRow)));
// Keep all owner corrections on these cards unchanged, including the blocked target on BT6-001's back.
const protectedRows = physical.filter((r) => r.source === "user" && defs[String(r.card_id)]).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v])) as RuleRow);
for (const protectedRow of protectedRows) rows[rows.findIndex((r) => key(r) === key(protectedRow))] = protectedRow;
const actualFlag = process.argv.indexOf("--stored-rules");
const actualPath = actualFlag < 0 ? null : process.argv[actualFlag + 1];
if (actualFlag >= 0) assert.ok(actualPath && !actualPath.startsWith("--"), "--stored-rules requires an actual export path");
if (actualPath) {
  const exported = JSON.parse(readFileSync(actualPath, "utf8"));
  const matching = exported.filter((r: Record<string, unknown>) => targetKeys.includes(`${r.cardId ?? r.card_id}/${r.side}/${r.skillIndex ?? r.skill_index}`));
  const actual = normalizeRows(matching); assert.deepEqual(actual.malformed, []);
  assert.deepEqual(actual.rows.map(key).sort(), [...targetKeys].sort(), "every target occurs exactly once");
  for (const row of actual.rows) { assert.equal(usageProblem(row.usage), null); rows[rows.findIndex((r) => key(r) === key(row))] = row; }
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const rowOf = (id: string, side = "front", index = 10) => rows.find((r) => r.cardId === id && r.side === side && r.skillIndex === index)!;
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
function context(edit?: (rows: RuleRow[]) => void): EngineContext {
  const saved = clone(rows); edit?.(saved);
  return clone({ ...CTX, defs, scripts: rulesFromRows(saved, defs) });
}
interface Saved { ctx: EngineContext; state: VmState }
function take(saved: Saved, action: Action): { saved: Saved; events: GameEvent[] } {
  const a = clone(saved), b = clone(saved);
  const one = RULES.apply(a.ctx, a.state, clone(action)), two = RULES.apply(b.ctx, b.state, clone(action));
  assert.deepEqual(one, two, "deterministic replay of each saved action and executable context");
  return { saved: clone({ ctx: a.ctx, state: one.state as VmState }), events: one.events };
}
function fresh(owner: PlayerId, leader = "L-RED", ctx = context()): Saved {
  let saved: Saved = { ctx, state: RULES.createGame(ctx, { seed: 907, p1: { name: "One", leader: owner === "p1" ? leader : "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: owner === "p2" ? leader : "L-RED", main: fifty("V1") } }).state as VmState };
  const other = owner === "p1" ? "p2" : "p1";
  const actions: Action[] = [{ type: "chooseFirst", player: saved.state.chooser, first: owner }, { type: "mulligan", player: owner, redraw: false }, { type: "mulligan", player: other, redraw: false }, { type: "charge", player: owner, card: null }, { type: "endMain", player: owner }, { type: "charge", player: other, card: null }, { type: "endMain", player: other }, { type: "charge", player: owner, card: null }];
  for (const action of actions) saved = take(saved, action).saved;
  assert.equal(saved.state.prompt.kind, "main");
  return saved;
}
function stage(saved: Saved, owner: PlayerId, id: string, area = "battle"): string {
  const iid = saved.state.sides[owner].zones.deck[0]; assert.ok(iid);
  saved.state.cards[iid].cardId = id; assert.ok(moveCard(saved.state, game, iid, area, { owner }).ok); saved.state.cards[iid].mode = "active";
  return iid;
}
function settle(saved: Saved, terminal: "main" | "combo", pick = true): { saved: Saved; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let n = 0; n < 30 && saved.state.prompt.kind !== terminal && saved.state.prompt.kind !== "gameOver"; n++) {
    const q = saved.state.prompt;
    const action: Action = q.kind === "chooseCards" ? { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, Math.max(q.choice.min, pick ? 1 : 0)) }
      : q.kind === "chooseMode" ? { type: "chooseMode", player: q.player, index: 0 }
      : q.kind === "orderPending" ? { type: "orderPending", player: q.player, index: q.candidates[0] }
      : q.kind === "combo" ? { type: "pass", player: q.player }
      : q.kind === "zEnergyFromCombo" ? { type: "zEnergyFromCombo", player: q.player, card: null }
      : q.kind === "payCost" ? { type: "payCost", player: q.player, option: 0 }
      : (() => { throw Error(`unexpected ${q.kind}`); })();
    const next = take(saved, action); saved = next.saved; events.push(...next.events);
  }
  return { saved, events };
}
const offer = (saved: Saved, iid: string, index: number) => RULES.legalActions(saved.ctx, saved.state).find((r) => r.action.type === "activate" && r.action.card === iid && r.action.skill === index);
function activate(saved: Saved, iid: string, index: number): { saved: Saved; events: GameEvent[] } {
  const action = offer(saved, iid, index); assert.ok(action, `${saved.state.cards[iid].cardId}#${index} offered at ${saved.state.prompt.kind}`);
  const terminal = saved.state.prompt.kind; assert.ok(terminal === "main" || terminal === "combo");
  const first = take(saved, action.action); const rest = settle(first.saved, terminal);
  return { saved: rest.saved, events: [...first.events, ...rest.events] };
}
function attack(saved: Saved, owner: PlayerId, attacker?: string, target?: string): { saved: Saved; events: GameEvent[] } {
  const action = RULES.legalActions(saved.ctx, saved.state).find((r) => r.action.type === "attack" && (!attacker || r.action.attacker === attacker) && (!target || r.action.target === target));
  assert.ok(action, "staged attack is legal");
  const first = take(saved, action.action), rest = settle(first.saved, "combo");
  return { saved: rest.saved, events: [...first.events, ...rest.events] };
}
const checks: string[] = [];
for (const [id, side, index] of targets) {
  const r = rowOf(id, side, index); assert.deepEqual(r.unread, []); assert.deepEqual(r.usage, { version: 1, oncePerTurn: true, limit: null });
  const rule: Rule = { kind: r.kind, trigger: r.trigger as Rule["trigger"], usage: r.usage as UsageRecord, ...(r.combo ? { combo: r.combo as Rule["combo"] } : {}), cost: r.cost as Rule["cost"], cond: r.cond as Rule["cond"], ops: r.ops as Rule["ops"] };
  const parsed = parseRule(printRule(rule)); assert.ok(parsed.ok); assert.ok(deepEqual(parsed.value, rule)); assert.ok(deepEqual(ruleFromBlocks(blocksOf(rule)), rule)); assert.equal(validateRule(rule, r.kind), null);
}
const protectedTarget = rowOf("BT6-001", "back", 10); assert.equal(protectedTarget.source, "user"); assert.equal(protectedTarget.status, "corrected");
assert.ok(context().scripts!["BT6-001#back"].bySkill[10].unsupported.length, "protected unread back remains blocked");
assert.deepEqual(protectedTarget.ops, protectedRows.find((r) => key(r) === "BT6-001/back/10")!.ops, "usage delivery never replaces a protected program with a compiler draft");
for (const invalid of [undefined, null, {}, { version: 2, oncePerTurn: true, limit: null }, { version: 1, oncePerTurn: [true], limit: null }, { version: 1, oncePerTurn: false, limit: 0 }, { version: 1, oncePerTurn: false, limit: 1.5 }, { version: 1, oncePerTurn: true, limit: 1 }, { version: 1, oncePerTurn: false, limit: null, future: true }]) {
  assert.ok(usageProblem(invalid));
  assert.ok(runtimeSupportOfRow({ ...rowOf("BT6-003"), usage: invalid }).unsupported.some((s) => /usage|ceilings/.test(s)), "missing/malformed/unsupported usage blocks admission");
}

for (const owner of ["p1", "p2"] as const) {
  const other = owner === "p1" ? "p2" : "p1";
  for (const [id, side, index] of targets) {
    let saved = fresh(owner, id === "BT6-001" || id === "BT6-053" ? id : "L-RED");
    const source = id === "BT6-001" || id === "BT6-053" ? saved.state.sides[owner].zones.leader[0] : stage(saved, owner, id);
    if (side === "back") saved.state.cards[source].flipped = true;
    stage(saved, owner, "GOKU907", "hand"); const broly = stage(saved, owner, "BROLY907");
    const target = stage(saved, other, "TARGET907"); saved.state.cards[target].mode = "rest";
    const before = attrsNow(saved.ctx, game, saved.state, source).power;
    const row = rowOf(id, side, index);
    let result: { saved: Saved; events: GameEvent[] };
    if (row.kind === "auto") {
      result = attack(saved, owner, source, target); saved = result.saved;
      assert.equal(saved.state.cards[source].mode, "active", "once Auto readies its own attacker");
    } else {
      if (row.kind === "activate:battle") { const attacker = stage(saved, owner, "V1"); saved = attack(saved, owner, attacker, saved.state.sides[other].zones.leader[0]).saved; }
      result = activate(saved, source, index); saved = result.saved;
      if (id === "BT6-001") assert.equal(result.events.filter((e) => e.type === "draw" && e.player === owner).length, 2, "leader's paid draw stays exact");
      if (id === "BT6-003") assert.equal(attrsNow(saved.ctx, game, saved.state, source).power, Number(before) + 10000);
      if (id === "BT6-004") assert.equal(attrsNow(saved.ctx, game, saved.state, source).power, Number(before) + 5000);
      if (id === "BT6-007") assert.equal(attrsNow(saved.ctx, game, saved.state, target).power, 10000);
      if (id === "BT6-008") assert.equal(attrsNow(saved.ctx, game, saved.state, target).power, 15000);
      if (id === "BT6-053") assert.equal(attrsNow(saved.ctx, game, saved.state, broly).power, 20000);
      if (["BT6-060", "BT6-061", "BT6-062"].includes(id)) assert.ok(saved.state.sides[other].zones.drop.includes(target), "paid KO keeps its actual target");
      assert.equal(offer(saved, source, index), undefined, "same copy's second use is refused");
    }
    assert.ok(saved.state.cards[source].usedThisTurn.includes(index), "successful activation spends exactly this line");
    if (row.kind === "auto") {
      saved = settle(saved, "main").saved;
      const secondTarget = stage(saved, other, "TARGET907"); saved.state.cards[secondTarget].mode = "rest";
      const second = attack(saved, owner, source, secondTarget); saved = second.saved;
      assert.equal(saved.state.cards[source].mode, "rest", "spent attack Auto cannot ready the same copy again");
      assert.ok(!second.events.some((e) => e.type === "skill" && e.card === source && e.skill === index));
    }
    checks.push(`${owner} ${id}/${side}/${index} full payoff, spend and reuse refusal`);
  }
  // A copied Once-per-turn effect stays independent after the copy source vanishes.
  {
    let saved = fresh(owner); const source = stage(saved, owner, "BT6-007", "hand"), target = stage(saved, owner, "V1"), victim = stage(saved, other, "TARGET907");
    const effect = addEffect(saved.state, [], { master: owner, source, target, kind: "copiedSkills", value: 0,
      copied: { cardId: "BT6-007", side: "front", skills: [10], from: source, name: "Copied Son Goku" }, until: "game" });
    const copySkill = skillsShowing(saved.ctx, saved.state, target).skills.find((sk) => sk.index !== 0 && sk.oncePerTurn)!; assert.ok(copySkill);
    const offered = offer(saved, target, copySkill.index); assert.ok(offered);
    saved = take(saved, offered.action).saved; assert.equal(saved.state.prompt.kind, "chooseCards");
    saved.state.effects = saved.state.effects.filter((e) => e.id !== effect.id);
    saved = take(saved, { type: "choose", player: owner, cards: [victim] }).saved;
    assert.ok(!saved.state.outcome);
    assert.equal(attrsNow(saved.ctx, game, saved.state, victim).power, 10000, "activated copied effect survives loss of its granting effect");
    checks.push(`${owner} captured copied Once-per-turn survives source disappearance`);
  }
  // Skill-cost decline does not activate; effect-choice decline still consumes a free Auto.
  for (const pay of [false, true]) {
    let saved = fresh(owner); const source = stage(saved, owner, "PRICE907", "hand");
    saved = take(saved, { type: "play", player: owner, card: source }).saved;
    assert.equal(saved.state.prompt.kind, "chooseMode");
    const decision = take(saved, { type: "chooseMode", player: owner, index: pay ? 0 : 1 });
    const resolved = settle(decision.saved, "main"); saved = resolved.saved;
    assert.equal(saved.state.cards[source].usedThisTurn.includes(0), pay, "only a paid Auto activates/spends a use");
    assert.equal([...decision.events, ...resolved.events].filter((e) => e.type === "draw").length, Number(pay));
    checks.push(`${owner} optional Auto skill cost paid=${pay}`);
  }
  {
    let saved = fresh(owner); const source = stage(saved, owner, "OPTIONAL907", "hand");
    saved = take(saved, { type: "play", player: owner, card: source }).saved;
    assert.equal(saved.state.prompt.kind, "chooseMode");
    saved = take(saved, { type: "chooseMode", player: owner, index: 1 }).saved;
    assert.ok(saved.state.cards[source].usedThisTurn.includes(0), "declining an activated optional effect still consumes Once-per-turn");
    const actor = stage(saved, owner, "FALSE907"); const result = activate(saved, actor, 0); saved = result.saved;
    assert.ok(saved.state.cards[actor].usedThisTurn.includes(0), "paid activation with false effect condition still consumes its use");
    assert.ok(!result.events.some((e) => e.type === "draw"));
    checks.push(`${owner} optional/false effect consumes activated use`);
  }
  // Actual stored metadata can lift or change a ceiling while display tags stay unchanged.
  {
    const ctx = context((saved) => { (saved.find((r) => key(r) === "BT6-003/front/10")!.usage as UsageRecord).oncePerTurn = false; });
    let saved = fresh(owner, "L-RED", ctx); const source = stage(saved, owner, "BT6-003"); const before = attrsNow(ctx, game, saved.state, source).power;
    saved = activate(saved, source, 10).saved; saved = activate(saved, source, 10).saved;
    assert.equal(attrsNow(ctx, game, saved.state, source).power, Number(before) + 20000, "stored unlimited overrides printed Once-per-turn");
    checks.push(`${owner} stored unlimited mutation`);
  }
  {
    const ctx = context((saved) => { saved.find((r) => key(r) === "BT6-003/front/10")!.usage = { version: 1, oncePerTurn: false, limit: 2 }; });
    let saved = fresh(owner, "L-RED", ctx); const a = stage(saved, owner, "BT6-003"), b = stage(saved, owner, "BT6-003"), theirs = stage(saved, other, "BT6-003");
    saved = activate(saved, a, 10).saved; saved = activate(saved, b, 10).saved;
    assert.equal(offer(saved, a, 10), undefined); assert.equal(offer(saved, b, 10), undefined, "typed Limit2 is shared across copies");
    const skill = skillsShowing(ctx, saved.state, theirs).skills.find((sk) => sk.index === 10)!;
    assert.equal(usesLeft(saved.state, other, theirs, skill), 2, "opponent master has a separate shared count");
    checks.push(`${owner} stored Limit2 mutation and master/copy boundaries`);
  }
}
// Obsolete pending and suspended effect frames explicitly interrupt before executing.
for (const mode of ["pending", "frame"] as const) {
  const saved = fresh("p1"); const source = stage(saved, "p1", "BT6-015");
  const script = saved.ctx.scripts!["BT6-015"].bySkill[30]; delete script.usage;
  if (mode === "pending") saved.state.pending.push({ card: source, skillIndex: 30, master: "p1", trigger: "attacks" });
  else saved.state.programs.push({ card: source, skillIndex: 30, master: "p1", trigger: "attacks", ops: script.ops, ip: 0, vars: {} });
  run(saved.ctx, game, saved.state, []);
  assert.equal(saved.state.outcome?.kind, "interrupted"); assert.equal(saved.state.outcome?.privateContext?.issue, "#907");
}
// A real saved Auto-cost choice also retains and validates its captured usage.
{
  let saved = fresh("p1"); const source = stage(saved, "p1", "PRICE907", "hand");
  saved = take(saved, { type: "play", player: "p1", card: source }).saved;
  assert.equal(saved.state.prompt.kind, "chooseMode");
  const cost = saved.state.programs.find((f) => f.autoCost)?.autoCost; assert.ok(cost);
  delete cost.skill.usage;
  const before = saved.state.sides.p1.zones.hand.slice();
  saved = take(saved, { type: "chooseMode", player: "p1", index: 0 }).saved;
  assert.equal(saved.state.outcome?.kind, "interrupted"); assert.equal(saved.state.outcome?.privateContext?.issue, "#907");
  assert.deepEqual(saved.state.sides.p1.zones.hand, before, "obsolete captured usage is rejected before hand payment");
}
const receipt = { recordMode: actualPath ? "actual-stored-readback" : "offline-rebuilt-fixture", inputHashes: { catalog: createHash("sha256").update(readFileSync(catalogPath)).digest("hex"), physical: createHash("sha256").update(readFileSync(physicalPath)).digest("hex"), actualExport: actualPath ? createHash("sha256").update(readFileSync(actualPath)).digest("hex") : null }, parsedTargets: 11, executableFreshTargets: 10, protectedUnread: "BT6-001/back/10", reviewed: false, verifiedScenarios: checks, exercisedTargets: targetKeys, pairQualified: false, targets: targets.map(([id, side, index]) => { const before = physical.find((r) => r.card_id === id && r.side === side && r.skill_index === index)!; const rebuilt = rowOf(id, side, index); return { key: key(rebuilt), old: { id: before.id, version: before.version, source: before.source, status: before.status, rowHash: sha(before), printedHash: sha(before.printed) }, rebuilt, appliedToDatabase: false }; }) };
const outFlag = process.argv.indexOf("--out"); if (outFlag >= 0) writeFileSync(process.argv[outFlag + 1], JSON.stringify(receipt, null, 2) + "\n");
console.log(`#907 typed usage: ${checks.length} both-seat scenarios covering ten frozen target skills and synthetic preservation controls, stored unlimited/Limit2 mutation, language/blocks and obsolete-save blockers passed; protected unread row remains blocked`);
