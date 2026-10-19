/** #907: actual frozen Paragus locks; no application database or pair qualification. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalizeRows } from "../arena-corpus-provenance.mts";
import { deepEqual, parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { blocksOf, ruleFromBlocks } from "../../src/lib/arena/lang/blocks";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { moved, run } from "../../src/lib/arena/vm/flow";
import { forbids } from "../../src/lib/arena/vm/program";
import { CTX, DEFS, card, fifty } from "./harness";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";

const frozen = JSON.parse(readFileSync("docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/catalog.json", "utf8")).cards;
const defs: Record<string, CardDef> = { ...DEFS,
  UPGRADE907: card("UPGRADE907", { characters: ["Broly: Br"], colors: ["Green"], energyCost: 4 }),
  DEALER907: card("DEALER907", { power: 50000, skill: "[Auto] When this card deals damage, draw 1 card." }),
  PRICE907: card("PRICE907", { skill: "[Activate: Main] {r}, choose 1 card from your life and add it to your hand: Draw 1 card." }),
  CRIT907: card("CRIT907", { power: 50000, skill: "[Critical]" }),
};
for (const id of ["BT6-053", "BT6-063"]) defs[id] = cardDefFrom(frozen.find((c: CardDef) => c.id === id));
const rows = Object.values(defs).flatMap(d => skillRecords(d).map(r => ({ ...r, status: r.unread.length ? "open" : "draft", source: "compiler" } as RuleRow)));
const actualFlag = process.argv.indexOf("--stored-rules"), actualPath = actualFlag < 0 ? null : process.argv[actualFlag + 1];
if (actualFlag >= 0) assert.ok(actualPath && !actualPath.startsWith("--"));
if (actualPath) {
  const exported = JSON.parse(readFileSync(actualPath, "utf8"));
  const actual = normalizeRows(exported.filter((r: Record<string, unknown>) => (r.cardId ?? r.card_id) === "BT6-053" && (r.side === "front" && (r.skillIndex ?? r.skill_index) === 10 || r.side === "back" && (r.skillIndex ?? r.skill_index) === 0)));
  assert.deepEqual(actual.malformed, []); assert.equal(actual.rows.length, 2);
  assert.deepEqual(actual.rows.map(r => `${r.side}/${r.skillIndex}`).sort(), ["back/0", "front/10"]);
  for (const row of actual.rows) rows[rows.findIndex(r => r.cardId === row.cardId && r.side === row.side && r.skillIndex === row.skillIndex)] = row;
}
const front = rows.find(r => r.cardId === "BT6-053" && r.side === "front" && r.skillIndex === 10)!;
const back = rows.find(r => r.cardId === "BT6-053" && r.side === "back" && r.skillIndex === 0)!;
assert.deepEqual(front.unread, []); assert.deepEqual(back.unread, []);
assert.deepEqual(front.ops, [{ op: "forbid", what: "addLifeToHand", side: "you", until: "turn" }]);
assert.deepEqual(back.cond, { kind: "isTurnPlayer" });
for (const r of [front, back]) {
  const rule: Rule = { kind: r.kind, trigger: r.trigger as Rule["trigger"], usage: r.usage as Rule["usage"], validity: r.validity as Rule["validity"], cost: r.cost as Rule["cost"], cond: r.cond as Rule["cond"], ops: r.ops as Rule["ops"] };
  assert.equal(rule.cost?.version, 1);
  const parsed = parseRule(printRule(rule)); assert.ok(parsed.ok); assert.ok(deepEqual(parsed.value, rule));
  assert.ok(deepEqual(ruleFromBlocks(blocksOf(rule)), rule)); assert.equal(validateRule(rule, r.kind), null);
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = clone({ ...CTX, defs, scripts: rulesFromRows(rows, defs) });
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
interface Saved { state: VmState; ctx: EngineContext }
function take(saved: Saved, action: Action) {
  const a = clone(saved), b = clone(saved);
  const one = RULES.apply(a.ctx, a.state, clone(action)), two = RULES.apply(b.ctx, b.state, clone(action));
  assert.deepEqual(one, two, "each saved action deterministically replays");
  return { saved: clone({ ctx: a.ctx, state: one.state as VmState }), events: one.events };
}
function fresh(owner: PlayerId): Saved {
  let saved: Saved = { ctx: clone(ctx), state: RULES.createGame(ctx, { seed: 907, p1: { name: "One", leader: owner === "p1" ? "BT6-053" : "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: owner === "p2" ? "BT6-053" : "L-RED", main: fifty("V1") } }).state as VmState };
  const other = owner === "p1" ? "p2" : "p1";
  for (const action of [{ type: "chooseFirst", player: saved.state.chooser, first: owner }, { type: "mulligan", player: owner, redraw: false }, { type: "mulligan", player: other, redraw: false }, { type: "charge", player: owner, card: null }] as Action[]) saved = take(saved, action).saved;
  return saved;
}
function stage(saved: Saved, owner: PlayerId, id: string, area: string) {
  const iid = saved.state.sides[owner].zones.deck[0]; saved.state.cards[iid].cardId = id;
  assert.ok(moveCard(saved.state, game, iid, area, { owner }).ok); saved.state.cards[iid].mode = "active"; return iid;
}
function settle(start: Saved, terminal: "main" | "combo" = "main", wanted?: string) {
  let saved = clone(start); const events: GameEvent[] = [];
  for (let n = 0; n < 40 && saved.state.prompt.kind !== terminal && saved.state.prompt.kind !== "gameOver"; n++) {
    const q = saved.state.prompt;
    const action: Action = q.kind === "chooseCards" ? { type: "choose", player: q.player, cards: wanted && q.choice.candidates.includes(wanted) ? [wanted] : q.choice.candidates.slice(0, q.choice.min) }
      : q.kind === "chooseMode" ? { type: "chooseMode", player: q.player, index: 0 }
      : q.kind === "combo" ? { type: "pass", player: q.player }
      : q.kind === "zEnergyFromCombo" ? { type: "zEnergyFromCombo", player: q.player, card: null }
      : q.kind === "counter" ? { type: "counter", player: q.player, card: null }
      : q.kind === "orderPending" ? { type: "orderPending", player: q.player, index: q.candidates[0] }
      : (() => { throw Error(`unexpected ${q.kind}`); })();
    const next = take(saved, action); saved = next.saved; events.push(...next.events);
  }
  assert.ok(saved.state.prompt.kind === terminal || saved.state.prompt.kind === "gameOver", "scenario finishes");
  return { saved, events };
}
function effect(start: Saved, master: PlayerId, source: string, ops: Op[]) {
  const apply = (saved: Saved) => { saved.state.programs.unshift({ card: source, master, ops: clone(ops), ip: 0, vars: {} }); const events: GameEvent[] = []; run(saved.ctx, game, saved.state, events); return { saved, events }; };
  const one = apply(clone(start)), two = apply(clone(start)); assert.deepEqual(one, two, "rule-level effect deterministically replays"); return one;
}
const offer = (s: Saved, iid: string) => RULES.legalActions(s.ctx, s.state).find(a => a.action.type === "activate" && a.action.card === iid && a.action.skill === 10);
const checks: string[] = [];
for (const owner of ["p1", "p2"] as const) {
  const other = owner === "p1" ? "p2" : "p1";
  let saved = fresh(owner); const leader = saved.state.sides[owner].zones.leader[0];
  const lifeBefore = saved.state.sides[owner].zones.life.length, handBefore = saved.state.sides[owner].zones.hand.length;
  assert.ok(offer(saved, leader)); const activated = take(saved, offer(saved, leader)!.action); const completed = settle(activated.saved); saved = completed.saved;
  assert.equal(saved.state.sides[owner].zones.life.length, lifeBefore - 1); assert.equal(saved.state.sides[owner].zones.hand.length, handBefore + 1);
  assert.equal(forbids(saved.ctx, game, saved.state, "addLifeToHand", { player: owner }), true);
  assert.equal(offer(saved, leader), undefined, "another activation cannot pay the locked Life-to-hand cost");
  checks.push(`${owner} real front cost before lock and repeat refusal`);
  {
    const price = stage(saved, owner, "PRICE907", "battle"); stage(saved, owner, "V1", "energy");
    const before = clone(saved.state);
    const action: Action = { type: "activate", player: owner, card: price, skill: 0 };
    assert.ok(!RULES.legalActions(saved.ctx, saved.state).some(a => a.action.type === "activate" && a.action.card === price));
    const attempted = clone(saved); assert.throws(() => RULES.apply(attempted.ctx, attempted.state, action), /refused/); assert.deepEqual(attempted.state, before, "forged activation refused before energy or Life charge");
    checks.push(`${owner} combined energy/Life price refused before charge`);
  }
  {
    const isolated = fresh(owner), iid = isolated.state.sides[owner].zones.leader[0]; isolated.state.cards[iid].flipped = true;
    assert.equal(forbids(isolated.ctx, game, isolated.state, "addLifeToHand", { player: owner }), true, "back lock requires no front activation");
    assert.equal(forbids(isolated.ctx, game, isolated.state, "addLifeToHand", { player: other }), false, "lock does not affect the other player");
    const life = isolated.state.sides[owner].zones.life[0], ev: GameEvent[] = [];
    moved(isolated.ctx, game, isolated.state, ev, life, "hand", { owner, replaced: { to: "drop" } });
    assert.ok(isolated.state.sides[owner].zones.drop.includes(life), "replacement destination Drop remains allowed");
    const another = isolated.state.sides[owner].zones.life[0]; moved(isolated.ctx, game, isolated.state, ev, another, "drop", { owner, replaced: { to: "hand" } });
    assert.ok(isolated.state.sides[owner].zones.life.includes(another), "replacement destination hand remains prohibited");
    checks.push(`${owner} isolated back lock, player scope and routed destination`);
  }
  // Frozen Broly's optional upgrade survives its impossible Life-add effect (official Q7).
  {
    const broly = stage(saved, owner, "BT6-063", "battle"), upgrade = stage(saved, owner, "UPGRADE907", "hand");
    const before = saved.state.sides[owner].zones.life.length;
    const ev: GameEvent[] = []; moved(saved.ctx, game, saved.state, ev, broly, "drop", { owner, reason: "effect", actor: owner, by: "skill" }); run(saved.ctx, game, saved.state, ev);
    const upgraded = settle(saved, "main", upgrade); saved = upgraded.saved;
    assert.ok(saved.state.sides[owner].zones.battle.includes(upgrade), "official BT6-063 Q7 upgrade still resolves");
    assert.equal(saved.state.sides[owner].zones.life.length, before);
    checks.push(`${owner} frozen Broly blocked Life addition still upgrades`);
  }
  // Awakening does not end the already-activated front lock.
  saved.state.cards[leader].flipped = true;
  assert.equal(forbids(saved.ctx, game, saved.state, "addLifeToHand", { player: owner }), true);
  {
    const dealer = stage(saved, other, "DEALER907", "battle"), before = saved.state.sides[owner].zones.life.slice();
    const hit = effect(saved, other, dealer, [{ op: "damage", n: 2, side: "opponent" }]); saved = hit.saved;
    assert.deepEqual(saved.state.sides[owner].zones.life, before);
    assert.ok(!hit.events.some(e => e.type === "damage" || e.type === "draw" || e.type === "move" && e.from === "life"));
    assert.ok(!saved.state.pending.length, "no actual damage Auto from a blocked attempt");
    const down = effect(saved, owner, leader, [{ op: "lifeDownTo", n: 1 }]); saved = down.saved;
    assert.deepEqual(saved.state.sides[owner].zones.life, before, "Life-down loop terminates under prohibition");
    checks.push(`${owner} blocked skill damage has no actual events and Life-down terminates`);
  }
  saved = take(saved, { type: "endMain", player: owner }).saved; saved = take(saved, { type: "charge", player: other, card: null }).saved;
  assert.equal(forbids(saved.ctx, game, saved.state, "addLifeToHand", { player: owner }), false, "front expires and back is inactive in opponent turn");
  {
    const before = saved.state.sides[owner].zones.life.length;
    const hit = effect(saved, other, saved.state.sides[other].zones.leader[0], [{ op: "damage", n: 1, side: "opponent" }]); saved = hit.saved;
    assert.equal(saved.state.sides[owner].zones.life.length, before - 1); assert.ok(hit.events.some(e => e.type === "damage"));
    checks.push(`${owner} expiry and opponent-turn Life movement allowed`);
  }
  // Native battle path: synthetic installation of the exact front effect isolates movement
  // from its normal Main timing; the real front activation is proved above.
  for (const critical of [false, true]) {
    let s = fresh(owner); const guard = s.state.sides[owner].zones.leader[0];
    s = take(s, { type: "endMain", player: owner }).saved; s = take(s, { type: "charge", player: other, card: null }).saved;
    s = effect(s, owner, guard, front.ops as Op[]).saved;
    const attacker = stage(s, other, critical ? "CRIT907" : "DEALER907", "battle");
    const before = s.state.sides[owner].zones.life.length;
    const declared = take(s, { type: "attack", player: other, attacker, target: guard }); const ended = settle(declared.saved); s = ended.saved;
    assert.equal(s.state.sides[owner].zones.life.length, before - Number(critical));
    assert.equal(ended.events.some(e => e.type === "damage"), critical);
    assert.equal(ended.events.some(e => e.type === "draw"), false, "blocked damage does not fire dealer's Auto");
    if (critical) assert.ok(ended.events.some(e => e.type === "move" && e.from === "life" && e.to === "drop"));
    checks.push(`${owner} native battle critical=${critical} actual accounting`);
  }
}
const receipt = { recordMode: actualPath ? "actual-stored-readback" : "offline-rebuilt-fixture", actualExportHash: actualPath ? createHash("sha256").update(readFileSync(actualPath)).digest("hex") : null, scenarios: checks, count: checks.length, targets: ["BT6-053/front/10", "BT6-053/back/0"], parsed: 2, executable: 2, humanReviewed: false, appliedToDatabase: false, qualified: false, pairGames: 0, residual: "Existing pre-damage announcement checkpoint remains separate; actual damage events require actual Life removal." };
const out = process.argv.indexOf("--out"); if (out >= 0) writeFileSync(process.argv[out + 1], JSON.stringify(receipt, null, 2) + "\n");
console.log(`life-lock-907: ${checks.length} both-seat frozen-lock, Broly continuation, actual damage and saved-replay scenarios passed`);
