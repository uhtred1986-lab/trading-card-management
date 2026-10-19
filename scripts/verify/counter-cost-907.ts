/** #907: frozen Broly Counter restrictions use current card energy, not skill or paid costs. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeRows } from "../arena-corpus-provenance.mts";
import { createHash } from "node:crypto";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { describeScript, type Cond, type Op } from "../../src/lib/arena/vm/script";
import { attrsNow, forbids } from "../../src/lib/arena/vm/program";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { CTX, DEFS, card, fifty } from "./harness";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const catalogPath = "docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/catalog.json";
const bytes = readFileSync(catalogPath), catalog = JSON.parse(bytes.toString()).cards;
const targets = ["BT6-060", "BT6-061"];
const counter = (id: string, energyCost: number, skill = "[Counter: Attack] Negate the attack.", specifiedCost = {}): CardDef => card(id, { type: "EXTRA", energyCost, specifiedCost, power: null, comboCost: null, comboPower: null, skill });
const defs: Record<string, CardDef> = { ...DEFS,
  C1907: counter("C1907", 1), C2907: counter("C2907", 2), C3907: counter("C3907", 3),
  SENTINEL907: counter("SENTINEL907", 0),
  SKILL3907: counter("SKILL3907", 1, "[Counter: Attack] {3}: Negate the attack."),
  FREE2907: counter("FREE2907", 2, "[Counter: Attack] Negate the attack.<br>[Permanent] You can activate this card's [Counter] skill from your hand without paying its energy cost."),
  FLOOR907: counter("FLOOR907", 2, undefined, { Red: 2 }),
  FLOORDISC907: counter("FLOORDISC907", 3, undefined, { Red: 2 }),
};
for (const id of targets) defs[id] = cardDefFrom(catalog.find((c: CardDef) => c.id === id));
const rows = Object.values(defs).flatMap(d => skillRecords(d).map(r => ({ ...r, status: "draft", source: "compiler" } as RuleRow)));
const actualFlag = process.argv.indexOf("--stored-rules"), actualPath = actualFlag < 0 ? null : process.argv[actualFlag + 1];
if (actualFlag >= 0) assert.ok(actualPath && !actualPath.startsWith("--"), "--stored-rules requires an actual readback path");
if (actualPath) {
  const input = JSON.parse(readFileSync(actualPath, "utf8")); assert.ok(Array.isArray(input));
  const selected = input.filter((r: Record<string, unknown>) => targets.includes(String(r.cardId ?? r.card_id)) && r.side === "front" && (r.skillIndex ?? r.skill_index) === 10);
  const actual = normalizeRows(selected); assert.deepEqual(actual.malformed, []);
  assert.deepEqual(actual.rows.map(r => r.cardId).sort(), [...targets].sort(), "exactly one readback per target, no duplicates or omissions");
  for (const row of actual.rows) {
    const at = rows.findIndex(r => r.cardId === row.cardId && r.side === "front" && r.skillIndex === 10);
    assert.equal(row.printed, rows[at].printed, "actual row must be fresh for the frozen printed skill");
    rows[at] = row;
  }
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = clone({ ...CTX, defs, scripts: rulesFromRows(rows, defs) });
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
function take(s: VmState, action: Action): VmState {
  const a = RULES.apply(clone(ctx), clone(s), clone(action)), b = RULES.apply(clone(ctx), clone(s), clone(action));
  assert.deepEqual(a, b, "saved-context action replay stays deterministic"); return a.state as VmState;
}
function fresh(attacker: PlayerId): VmState {
  const defender: PlayerId = attacker === "p1" ? "p2" : "p1";
  let s = RULES.createGame(ctx, { seed: 907, p1: { name: "One", leader: "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: "L-RED", main: fifty("V1") } }).state as VmState;
  s = take(s, { type: "chooseFirst", player: s.chooser, first: defender });
  for (const player of [defender, attacker]) s = take(s, { type: "mulligan", player, redraw: false });
  s = take(s, { type: "charge", player: defender, card: null });
  s = take(s, { type: "endMain", player: defender });
  s = take(s, { type: "charge", player: attacker, card: null });
  assert.equal(s.prompt.kind, "main"); assert.equal(s.turnPlayer, attacker); return s;
}
function stage(s: VmState, owner: PlayerId, cardId: string, area: string): string {
  const id = s.sides[owner].zones.deck.find(i => s.cards[i].cardId === "V1"); assert.ok(id);
  s.cards[id].cardId = cardId; assert.ok(moveCard(s, game, id, area, { owner }).ok); s.cards[id].mode = "active"; return id;
}
const cases = [
  { card: "C1907", current: 1 }, { card: "C2907", current: 2 }, { card: "C3907", current: 3 },
  { card: "C3907", reduction: 2, current: 1 }, { card: "C1907", reduction: -1, current: 2 },
  { card: "SKILL3907", current: 1 }, { card: "FREE2907", current: 2 },
  { card: "FLOOR907", reduction: 1, current: 2 }, { card: "FLOORDISC907", reduction: 2, current: 2 },
];
const checks: string[] = [];
for (const owner of ["p1", "p2"] as const) for (const sourceCard of targets) for (const attacking of [true, false]) for (const scenario of cases) {
  const defender = owner === "p1" ? "p2" : "p1"; let s = fresh(owner);
  const source = stage(s, owner, sourceCard, "battle"), candidate = stage(s, defender, scenario.card, "hand");
  stage(s, defender, "SENTINEL907", "hand");
  for (let n = 0; n < 6; n++) stage(s, defender, "V1", "energy");
  if (scenario.reduction !== undefined) addEffect(s, [], { target: candidate, kind: "cost", value: scenario.reduction, until: "turn", master: defender });
  const info = attrsNow(ctx, game, s, candidate);
  assert.equal(Math.max(Number(info.costOf ?? 0), Array.isArray(info.specifiedCost) ? info.specifiedCost.length : 0), scenario.current, "1-2-5: current card cost includes modifications and specified-cost floor");
  const attack: Action = { type: "attack", player: owner, attacker: attacking ? source : s.sides[owner].zones.leader[0], target: s.sides[defender].zones.leader[0] };
  const beforeAttack = clone(s);
  s = take(s, attack);
  const denied = attacking && scenario.current >= 2;
  assert.equal(forbids(ctx, game, clone(s), "activateCounter", { player: defender, card: candidate, skillKind: "counter:attack" }), denied);
  assert.equal(s.prompt.kind, "counter", "zero-cost sentinel keeps an honest Counter window open");
  assert.equal(RULES.legalActions(ctx, clone(s)).some(l => l.action.type === "counter" && l.action.card === candidate), !denied, `${owner}/${sourceCard}/${attacking}/${scenario.card}/${scenario.reduction ?? 0}: offer agrees with current-card cost restriction: ${JSON.stringify(RULES.rejectedActions(ctx, clone(s), RULES.legalActions(ctx, clone(s))).filter(r => r.action.type === "counter" && r.action.card === candidate))}`);
  const action: Action = { type: "counter", player: defender, card: candidate };
  if (denied) {
    const forged = clone(s); if (forged.prompt.kind === "counter") forged.prompt.candidates.push(candidate);
    const before = JSON.stringify(forged);
    assert.throws(() => RULES.apply(ctx, forged, action), IllegalAction, "forged candidate cannot bypass the live typed prohibition");
    assert.equal(JSON.stringify(forged), before, "refused counter spends neither energy nor card");
  } else {
    const result = take(s, action);
    assert.ok(result.sides[defender].zones.drop.includes(candidate), "legal Counter really activates");
  }
  if (attacking && scenario.card === "C2907") {
    const changed = clone(ctx);
    const mutate = (ops: Op[]): void => { for (const op of ops) { if (op.op === "forbid" && op.what === "activateCounter" && op.filter) op.filter.costMin = 3; if (op.op === "if") { mutate(op.then); if (op.else) mutate(op.else); } } };
    mutate(changed.scripts![sourceCard].bySkill[10].ops);
    assert.equal(forbids(changed, game, clone(s), "activateCounter", { player: defender, card: candidate, skillKind: "counter:attack" }), false, "stored threshold3 governs without display threshold2 override");
    const changedWindow = RULES.apply(changed, beforeAttack, attack).state as VmState;
    assert.ok(RULES.legalActions(changed, clone(changedWindow)).some(l => l.action.type === "counter" && l.action.card === candidate));
    const result = RULES.apply(changed, clone(changedWindow), action).state as VmState;
    assert.ok(result.sides[defender].zones.drop.includes(candidate));
    checks.push(`${owner}/${sourceCard}/stored-threshold3-overrides-display2`);
  }
  checks.push(`${owner}/${sourceCard}/${attacking ? "source-attacking" : "leader-attacking"}/${scenario.card}/cost${scenario.current}/delta${scenario.reduction ?? 0}`);
}
for (const id of targets) {
  const row = rows.find(r => r.cardId === id && r.skillIndex === 10)!;
  assert.deepEqual(row.unread, []); assert.equal((row.cond as Cond | null)?.kind, "inBattle");
  assert.match(row.reads ?? "", /energy cost.{0,20}2/, "human reading exposes the bound rather than claiming every Counter");
  const op = (row.ops as Op[])[0]; assert.equal(op.op, "forbid"); if (op.op === "forbid") assert.equal(op.filter?.costMin, 2);
}
for (const id of targets) {
  const qualified = { ...defs[id], skill: defs[id].skill!.replace("with energy costs of 2 or more", "with an unimplemented qualification") };
  assert.ok(skillRecords(qualified).find(r => r.skillIndex === 10)!.unread.length, "unimplemented trailing Counter qualification cannot become a blanket ban");
}
const sourceForReading = (rows.find(r => r.cardId === targets[0] && r.skillIndex === 10)!.ops as Op[])[0];
assert.equal(sourceForReading.op, "forbid");
if (sourceForReading.op === "forbid") {
  const reading = describeScript([{ ...sourceForReading, counterKind: "play", otherCards: true, unless: { kind: "life", side: "you", atMost: 2 } }]);
  for (const word of ["Counter: Play", "energy cost", "2", "other cards", "unless"]) assert.ok(reading.includes(word), `Counter reading preserves ${word}`);
}
const outIndex = process.argv.indexOf("--out"), out = outIndex < 0 ? null : process.argv[outIndex + 1];
if (outIndex >= 0) assert.ok(out && !out.startsWith("--"), "--out requires a receipt path");
if (out) writeFileSync(out, JSON.stringify({ catalogPath, catalogSHA256: createHash("sha256").update(bytes).digest("hex"), mode: actualPath ? "actual readback rows; synthetic Counter controls" : "offline rebuilt records; synthetic Counter controls", actualPath, targets: targets.map(cardId => rows.find(r => r.cardId === cardId && r.skillIndex === 10)), checks, reviewed: false, qualified: false, pairGames: 0 }, null, 2) + "\n");
console.log(`#907 Counter cost: ${checks.length} both-seat frozen Broly scenarios, current-card costs, independent skill price, offers and forged declarations passed`);
