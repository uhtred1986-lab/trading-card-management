/** #907: the four frozen BT6 Autos execute stored combo facts through reload and replay.
 * Focused scenarios, not pair/deck qualification. No network or application database. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalizeRows } from "../arena-corpus-provenance.mts";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { deepEqual, parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { blocksOf, ruleFromBlocks } from "../../src/lib/arena/lang/blocks";
import { comboQualificationProblem, type ComboQualification } from "../../src/lib/arena/vm/combo-qualification";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { fire } from "../../src/lib/arena/vm/events";
import { run } from "../../src/lib/arena/vm/flow";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { CTX, DEFS, card, fifty } from "./harness";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const root = "docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/";
const catalog = JSON.parse(readFileSync(root + "catalog.json", "utf8")).cards;
const physical = JSON.parse(readFileSync(root + "stored-rules.json", "utf8"));
const targets = [["BT6-006", 10], ["BT6-010", 0], ["BT6-066", 0], ["BT6-070", 0]] as const;
const defs: Record<string, CardDef> = { ...DEFS,
  GREEN907: card("GREEN907", { type: "LEADER", colors: ["Green"], power: 10000 }),
  BROLY907: card("BROLY907", { characters: ["Broly: Br"], power: 15000 }),
  OTHER907: card("OTHER907", { characters: ["Broly"], power: 15000 }),
};
for (const [id] of targets) defs[id] = cardDefFrom(catalog.find((c: CardDef) => c.id === id));
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r) => ({ ...r, status: "draft", source: "compiler" } as RuleRow)));
const actualPathIndex = process.argv.indexOf("--stored-rules");
const actualPath = actualPathIndex < 0 ? null : process.argv[actualPathIndex + 1];
if (actualPathIndex >= 0) assert.ok(actualPath && !actualPath.startsWith("--"), "--stored-rules requires an export path");
if (actualPath) {
  const exported = JSON.parse(readFileSync(actualPath, "utf8"));
  const matching = exported.filter((r: Record<string, unknown>) => targets.some(([id, index]) => (r.cardId ?? r.card_id) === id && r.side === "front" && (r.skillIndex ?? r.skill_index) === index));
  assert.equal(matching.length, targets.length, "actual export has exactly the four target rows");
  const keys = matching.map((r: Record<string, unknown>) => `${r.cardId ?? r.card_id}/${r.side}/${r.skillIndex ?? r.skill_index}`).sort();
  assert.deepEqual(keys, targets.map(([id, index]) => `${id}/front/${index}`).sort(), "actual export covers every exact target once");
  const actual = normalizeRows(matching); assert.deepEqual(actual.malformed, []);
  for (const replacement of actual.rows) {
    assert.equal(comboQualificationProblem(replacement.combo), null, "actual row has executable typed qualification");
    const at = rows.findIndex((r) => r.cardId === replacement.cardId && r.side === replacement.side && r.skillIndex === replacement.skillIndex);
    rows[at] = replacement;
  }
}
const rowOf = (id: string, index = id === "BT6-006" ? 10 : 0) => rows.find((r) => r.cardId === id && r.skillIndex === index)!;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
function context(edit?: (saved: RuleRow[]) => void): EngineContext {
  const saved = clone(rows); edit?.(saved);
  return clone({ ...CTX, defs, scripts: rulesFromRows(saved, defs) });
}
interface Saved { ctx: EngineContext; state: VmState }
function take(saved: Saved, action: Action): { saved: Saved; events: GameEvent[] } {
  const a = clone(saved); const b = clone(saved);
  const one = RULES.apply(a.ctx, a.state, clone(action));
  const two = RULES.apply(b.ctx, b.state, clone(action));
  assert.deepEqual(one, two, "each action deterministically replays from the persisted context and continuation");
  return { saved: clone({ ctx: a.ctx, state: one.state as VmState }), events: one.events };
}
function fresh(owner: PlayerId, turn: PlayerId, color: "Red" | "Green" | "Blue", ctx = context()): Saved {
  const leader = color === "Green" ? "GREEN907" : color === "Red" ? "L-RED" : "L-BLUE";
  let saved: Saved = { ctx, state: RULES.createGame(ctx, { seed: 907, p1: { name: "One", leader: owner === "p1" ? leader : "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: owner === "p2" ? leader : "L-RED", main: fifty("V1") } }).state as VmState };
  const actions: Action[] = [{ type: "chooseFirst", player: saved.state.chooser, first: turn },
    { type: "mulligan", player: turn, redraw: false }, { type: "mulligan", player: turn === "p1" ? "p2" : "p1", redraw: false }, { type: "charge", player: turn, card: null },
    { type: "endMain", player: turn }, { type: "charge", player: turn === "p1" ? "p2" : "p1", card: null },
    { type: "endMain", player: turn === "p1" ? "p2" : "p1" }, { type: "charge", player: turn, card: null }];
  for (const action of actions) saved = take(saved, action).saved;
  assert.equal(saved.state.prompt.kind, "main");
  for (const seat of ["p1", "p2"] as const) for (let n = 0; n < 3; n++) {
    const iid = saved.state.sides[seat].zones.deck[0];
    assert.ok(moveCard(saved.state, game, iid, "energy", { owner: seat }).ok);
    saved.state.cards[iid].mode = "active";
  }
  return saved;
}
function stage(saved: Saved, owner: PlayerId, id: string, area: "hand" | "battle" = "hand"): string {
  const iid = saved.state.sides[owner].zones.deck[0]; assert.ok(iid);
  saved.state.cards[iid].cardId = id;
  assert.ok(moveCard(saved.state, game, iid, area, { owner }).ok);
  saved.state.cards[iid].mode = "active";
  return iid;
}
function enter(saved: Saved, owner: PlayerId, iid: string): { saved: Saved; events: GameEvent[] } {
  const turn = saved.state.turnPlayer; const opponent = turn === "p1" ? "p2" : "p1";
  const attack = RULES.legalActions(saved.ctx, saved.state).find((r) => r.action.type === "attack" && r.action.target === saved.state.sides[opponent].zones.leader[0]);
  assert.ok(attack, "staged board offers an attack");
  saved = take(saved, attack.action).saved;
  assert.equal(saved.state.prompt.kind, "combo");
  if (owner !== turn) saved = take(saved, { type: "pass", player: turn }).saved;
  let result = take(saved, { type: "combo", player: owner, card: iid });
  const events = [...result.events];
  while (result.saved.state.prompt.kind === "payCost") {
    result = take(result.saved, { type: "payCost", player: owner, option: 0 }); events.push(...result.events);
  }
  return { saved: result.saved, events };
}
function finish(saved: Saved): { saved: Saved; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let n = 0; n < 24 && saved.state.prompt.kind !== "main" && saved.state.prompt.kind !== "gameOver"; n++) {
    const q = saved.state.prompt;
    const action: Action = q.kind === "combo" ? { type: "pass", player: q.player }
      : q.kind === "zEnergyFromCombo" ? { type: "zEnergyFromCombo", player: q.player, card: null }
      : q.kind === "chooseCards" ? { type: "choose", player: q.player, cards: [] }
      : q.kind === "orderPending" ? { type: "orderPending", player: q.player, index: 0 }
      : (() => { throw Error(`unexpected ${q.kind}`); })();
    const next = take(saved, action); saved = next.saved; events.push(...next.events);
  }
  return { saved, events };
}
const fired = (events: GameEvent[], iid: string, index = 0) => events.filter((e) => e.type === "skill" && e.card === iid && e.skill === index).length;
const checks: string[] = [];

for (const [id, index] of targets) {
  const r = rowOf(id, index); assert.ok(r.combo); assert.deepEqual(r.unread, []);
  const rule: Rule = { kind: r.kind, trigger: r.trigger as Rule["trigger"], combo: r.combo as ComboQualification, cost: r.cost as Rule["cost"], cond: r.cond as Rule["cond"], ops: r.ops as Rule["ops"] };
  assert.equal(validateRule(rule, "auto"), null);
  const parsed = parseRule(printRule(rule)); assert.ok(parsed.ok); assert.ok(deepEqual(parsed.value, rule));
  assert.ok(deepEqual(ruleFromBlocks(blocksOf(rule)), rule));
  const old = physical.find((p: { card_id: string; skill_index: number; side: string }) => p.card_id === id && p.skill_index === index && p.side === "front"); assert.ok(old);
  assert.ok(runtimeSupportOfRow({ ...r, combo: null }).unsupported.some((s) => s.includes("typed combo")), "old physical rows need explicit migration");
}
for (const invalid of [null, {}, { ...rowOf("BT6-070").combo as object, turn: ["controller"] }, { ...rowOf("BT6-070").combo as object, timing: ["entry"] }, { ...rowOf("BT6-010").combo as object, viaSkillOf: "unsupported" }, { ...rowOf("BT6-070").combo as object, subject: "other" }, { ...rowOf("BT6-070").combo as object, future: true }]) {
  assert.ok(comboQualificationProblem(invalid));
  assert.ok(runtimeSupportOfRow({ ...rowOf("BT6-070"), combo: invalid }).unsupported.some((s) => s.includes("typed combo")), "malformed contracts block stored admission");
}
assert.ok(runtimeSupportOfRow({ ...rowOf("BT6-070"), trigger: ["battleEnd"] }).unsupported.some((s) => s.includes("typed combo timing")), "unimplemented timing/WHEN combinations block admission");

for (const owner of ["p1", "p2"] as const) {
  const other = owner === "p1" ? "p2" : "p1";
  // Red Leader + <=4 life: draw only for this copy's combo, either entry area.
  for (const [color, life, area, draw] of [["Red", 4, "hand", 1], ["Red", 5, "hand", 0], ["Blue", 4, "hand", 0], ["Red", 4, "battle", 1]] as const) {
    let saved = fresh(owner, owner, color);
    while (saved.state.sides[owner].zones.life.length > life) assert.ok(moveCard(saved.state, game, saved.state.sides[owner].zones.life[0], "deck", { owner }).ok);
    const iid = stage(saved, owner, "BT6-006", area); const decoy = stage(saved, owner, "BT6-006");
    const before = saved.state.sides[owner].zones.hand.length;
    const result = enter(saved, owner, iid); saved = result.saved;
    assert.equal(saved.state.sides[owner].zones.hand.length, before - Number(area === "hand") + draw);
    assert.equal(fired(result.events, decoy, 10), 0, "other physical copy's combo cannot trigger this copy");
    checks.push(`${owner} BT6-006 ${color} life=${life} ${area}`);
  }
  // Trunks: only hand, opponent's turn, red Leader; cleanup plays in Rest Mode.
  for (const [turn, area, color, bounce, plays] of [[other, "hand", "Red", false, true], [owner, "hand", "Red", false, false], [other, "battle", "Red", false, false], [other, "hand", "Blue", false, false], [other, "hand", "Red", true, false]] as const) {
    let saved = fresh(owner, turn, color); const iid = stage(saved, owner, "BT6-010", area);
    saved = enter(saved, owner, iid).saved;
    if (bounce) assert.ok(moveCard(saved.state, game, iid, "hand", { owner }).ok); // official BT6-010 Q2 Jaco case
    const ended = finish(saved); saved = ended.saved;
    assert.equal(saved.state.sides[owner].zones.battle.includes(iid), plays);
    if (plays) {
      assert.equal(saved.state.cards[iid].mode, "rest"); assert.equal(fired(ended.events, iid), 1);
      saved.state.cards[iid].mode = "active";
      stage(saved, turn, "V1", "battle");
      saved = enter(saved, owner, iid).saved;
      const second = finish(saved); saved = second.saved;
      assert.ok(saved.state.sides[owner].zones.drop.includes(iid), "earlier battle's hand origin cannot qualify this battle's Battle Area combo");
      assert.equal(fired(second.events, iid), 0);
    }
    checks.push(`${owner} BT6-010 ${turn} ${area} ${color} bounce=${bounce}`);
  }
  // Optional exact-two hand shuffle and draw; never accept a single-card payment.
  for (const [color, pay] of [["Green", true], ["Green", false], ["Red", true]] as const) {
    let saved = fresh(owner, owner, color); const iid = stage(saved, owner, "BT6-066");
    saved = enter(saved, owner, iid).saved;
    const before = saved.state.sides[owner].zones.hand.length;
    if (color === "Green") {
      assert.equal(saved.state.prompt.kind, "chooseMode");
      const beforeDecisionRng = saved.state.rngState;
      const decision = take(saved, { type: "chooseMode", player: owner, index: pay ? 0 : 1 }); saved = decision.saved;
      if (!pay) { assert.equal(saved.state.rngState, beforeDecisionRng, "declining Angila's optional payment must not shuffle"); assert.equal(saved.state.sides[owner].zones.hand.length, before); checks.push(`${owner} BT6-066 ${color} decline`); continue; }
      const q = saved.state.prompt; assert.ok(q.kind === "chooseCards");
      assert.equal(q.choice.max, 1, "exact selection collects one card per answer");
      const rngBefore = saved.state.rngState;
      const chosen = q.choice.candidates.slice(0, 2); assert.equal(chosen.length, 2);
      assert.throws(() => take(saved, { type: "choose", player: owner, cards: [] }));
      const partial = take(saved, { type: "choose", player: owner, cards: [chosen[0]] }); saved = partial.saved;
      assert.equal(saved.state.prompt.kind, "chooseCards");
      assert.throws(() => take(saved, { type: "choose", player: owner, cards: [] }), "a saved single pick cannot finish the exact-two choice");
      assert.ok(!partial.events.some((e) => e.type === "draw"), "no partial payment payoff");
      const result = take(saved, { type: "choose", player: owner, cards: [chosen[1]] }); saved = result.saved;
      assert.equal(result.events.filter((e) => e.type === "draw" && e.player === owner).length > 0, pay);
      assert.equal(saved.state.sides[owner].zones.hand.length, before);
      if (pay) assert.notEqual(saved.state.rngState, rngBefore, "the payment shuffles the deck with seeded randomness");
    } else assert.equal(saved.state.prompt.kind, "combo");
    checks.push(`${owner} BT6-066 ${color} pay=${pay}`);
  }
  // Angila also qualifies from the Battle Area on the opponent's turn.
  {
    let saved = fresh(owner, other, "Green"); const iid = stage(saved, owner, "BT6-066", "battle");
    saved = enter(saved, owner, iid).saved;
    assert.equal(saved.state.prompt.kind, "chooseMode");
    saved = take(saved, { type: "chooseMode", player: owner, index: 1 }).saved;
    assert.equal(saved.state.prompt.kind, "combo");
    checks.push(`${owner} BT6-066 Battle Area opponent turn`);
  }
  // Angila's already-pending Auto survives Jaco's hand return (official Q1).
  {
    let saved = fresh(owner, owner, "Green"); const iid = stage(saved, owner, "BT6-066");
    assert.ok(moveCard(saved.state, game, iid, "combo", { owner }).ok);
    fire(saved.ctx, game, saved.state, { event: "comboUsed", card: iid, controller: owner, args: { to: "combo" } });
    assert.equal(saved.state.pending.length, 1);
    assert.ok(moveCard(saved.state, game, iid, "hand", { owner }).ok);
    const events: GameEvent[] = []; run(saved.ctx, game, saved.state, events);
    if (saved.state.prompt.kind === "orderPending") saved = take(saved, { type: "orderPending", player: owner, index: saved.state.prompt.candidates[0] }).saved;
    assert.equal(saved.state.prompt.kind, "chooseMode");
    const offered = take(saved, { type: "chooseMode", player: owner, index: 0 }).saved;
    const q = offered.state.prompt; assert.ok(q.kind === "chooseCards");
    assert.ok(q.choice.candidates.includes(iid), "returned Angila can itself be chosen among hand payment");
    const selected = q.choice.candidates.slice(0, 2);
    const partial = take(clone(offered), { type: "choose", player: owner, cards: [selected[0]] });
    const result = take(partial.saved, { type: "choose", player: owner, cards: [selected[1]] });
    assert.ok(result.events.some((e) => e.type === "draw"));
    checks.push(`${owner} BT6-066 already-pending after hand return`);
  }
  // Broly: Br target, controller turn, +5000 until this turn ends.
  for (const [turn, area] of [[owner, "hand"], [owner, "battle"], [other, "hand"]] as const) {
    let saved = fresh(owner, turn, "Green"); const iid = stage(saved, owner, "BT6-070", area);
    const broly = stage(saved, owner, "BROLY907", "battle"); const wrong = stage(saved, owner, "OTHER907", "battle");
    saved = enter(saved, owner, iid).saved;
    if (turn === owner) {
      const q = saved.state.prompt; assert.ok(q.kind === "chooseCards");
      assert.ok(q.choice.candidates.includes(broly)); assert.ok(!q.choice.candidates.includes(wrong));
      saved = take(saved, { type: "choose", player: owner, cards: [broly] }).saved;
      assert.equal(attrsNow(saved.ctx, game, saved.state, broly).power, 20000);
      saved = finish(saved).saved;
      saved = take(saved, { type: "endMain", player: turn }).saved;
      assert.equal(attrsNow(saved.ctx, game, saved.state, broly).power, 15000);
    } else { assert.equal(saved.state.prompt.kind, "combo"); assert.equal(attrsNow(saved.ctx, game, saved.state, broly).power, 15000); }
    checks.push(`${owner} BT6-070 ${turn} ${area}`);
  }
  // Actual stored qualification mutation controls execution with unchanged display.
  {
    const ctx = context((saved) => { const row = saved.find((r) => r.cardId === "BT6-010" && r.skillIndex === 0)!; (row.combo as ComboQualification).origins = ["battle"]; });
    let saved = fresh(owner, other, "Red", ctx); const iid = stage(saved, owner, "BT6-010", "battle");
    saved = enter(saved, owner, iid).saved; saved = finish(saved).saved;
    assert.ok(saved.state.sides[owner].zones.battle.includes(iid), "stored battle origin overrides unchanged printed from-hand wording");
    checks.push(`${owner} stored qualification mutation`);
  }
}

// Old saved contexts and pending/resolving continuations cannot bypass migration.
for (const mode of ["event", "pending", "frame", "missingWhen", "pendingMissingWhen", "frameMissingWhen", "frameMissingOccurrence"] as const) {
  const saved = fresh("p1", "p1", "Green"); const iid = stage(saved, "p1", "BT6-066");
  const script = saved.ctx.scripts!["BT6-066"].bySkill[0]; if (!mode.endsWith("When") && mode !== "frameMissingOccurrence") delete script.combo;
  if (mode !== "frameMissingOccurrence") delete script.trigger;
  if (mode === "event" || mode === "missingWhen") {
    assert.ok(moveCard(saved.state, game, iid, "combo", { owner: "p1" }).ok);
    assert.throws(() => fire(saved.ctx, game, saved.state, { event: "comboUsed", card: iid, controller: "p1", args: { to: "combo" } }), /typed combo/);
  } else {
    if (mode === "pending" || mode === "pendingMissingWhen") saved.state.pending.push({ card: iid, skillIndex: 0, master: "p1", trigger: "comboUsed" });
    else saved.state.programs.push({ card: iid, skillIndex: 0, master: "p1", ...(mode === "frameMissingOccurrence" ? {} : { trigger: "comboUsed" as const }), ops: script.ops, ip: 0, vars: {} });
    run(saved.ctx, game, saved.state, []);
    if (saved.state.prompt.kind === "orderPending") {
      const next = take(saved, { type: "orderPending", player: "p1", index: saved.state.prompt.candidates[0] }); saved.state = next.saved.state;
    }
    assert.equal(saved.state.outcome?.kind, "interrupted"); assert.equal(saved.state.outcome?.privateContext?.issue, "#907");
  }
}
const receipt = { targets: targets.map(([id, skillIndex]) => {
  const before = physical.find((r: { card_id: string; side: string; skill_index: number }) => r.card_id === id && r.side === "front" && r.skill_index === skillIndex);
  const rebuilt = rowOf(id, skillIndex);
  return { cardId: id, side: "front", skillIndex, old: { id: before.id, version: before.version, source: before.source, status: before.status, rowHash: hash(before), printedHash: hash(before.printed) }, rebuilt: { ...rebuilt, programHash: hash(rulesFromRows([rebuilt], defs)[id].bySkill[skillIndex]) }, appliedToDatabase: false, humanReviewed: false };
}), inputHashes: { catalog: createHash("sha256").update(readFileSync(root + "catalog.json")).digest("hex"), physicalExport: createHash("sha256").update(readFileSync(root + "stored-rules.json")).digest("hex"), actualExport: actualPath ? createHash("sha256").update(readFileSync(actualPath)).digest("hex") : null }, recordMode: actualPath ? "actual-stored-readback" : "offline-rebuilt-fixture", scenarios: checks, scenarioCount: checks.length, replay: "every action repeated from saved context/state and compared", pairQualified: false };
const outIndex = process.argv.indexOf("--out"); if (outIndex >= 0) writeFileSync(process.argv[outIndex + 1], JSON.stringify(receipt, null, 2) + "\n");
console.log(`#907 typed combo: ${checks.length} frozen-card seat/scenario cases, stored mutation, language/blocks, old-save blockers and deterministic saved continuations passed`);
