/** #923/#907: exact stored Absorb authority, existing shared procedure and saved occurrences. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalJson } from "../../src/lib/arena/replay-core";
import { normalizeRows, programProvenance } from "../arena-corpus-provenance.mts";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, saveRule, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { moved } from "../../src/lib/arena/vm/flow";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { attrsNow, hasKeyword } from "../../src/lib/arena/vm/program";
import { skillsShowing } from "../../src/lib/arena/vm/triggers";
import { priceFromCostRecord } from "../../src/lib/arena/vm/skill-payment";
import { validateRule, parseRule, printRule, type Rule } from "../../src/lib/arena/lang";
import { CTX, DEFS, card, fifty } from "./harness";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { CostRecord } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const folder = "docs/arena-backlog/evidence/923/metadata-2026-10-19";
const catalog: CardDef[] = JSON.parse(readFileSync(`${folder}/cards.json`, "utf8"));
const defs: Record<string, CardDef> = { ...DEFS, ...Object.fromEntries(catalog.map(c => [c.id, c])),
  A14923: card("A14923", { characters: ["Android 14"] }), A15923: card("A15923", { characters: ["Android 15"] }), A16923: card("A16923", { characters: ["Android 16"] }),
  TOP923: card("TOP923", { characters: ["Android 13"], energyCost: 7 }), SIX923: card("SIX923", { characters: ["Android 13"], energyCost: 6 }), G923: card("G923", { colors: ["Green"] }),
};
const rows = Object.values(defs).flatMap(d => skillRecords(d).map(r => ({ ...r, source: "compiler", status: "draft" } as RuleRow)));
const target = (rs: RuleRow[]) => rs.find(r => r.cardId === "BT3-070" && r.side === "front" && r.skillIndex === 0)!;
const historical = normalizeRows(JSON.parse(readFileSync(`${folder}/actual-stored-export.json`, "utf8"))).rows.find(r => r.cardId === "BT3-070" && r.skillIndex === 0)!;
const marker = (target(rows).cost as CostRecord).absorb; assert.deepEqual(marker, { version: 1, variant: "Absorb", area: "battle" });
const freshCost = copy(target(rows).cost as CostRecord); delete freshCost.absorb;
assert.equal(canonicalJson(freshCost), canonicalJson(historical.cost), "only the optional marker is added to the applied v9 price");
let reference: RuleRow = { ...copy(historical), cost: { ...(copy(historical.cost) as CostRecord), absorb: marker }, version: historical.version + 1 };
const storedAt = process.argv.indexOf("--stored-records");
if (storedAt >= 0) {
  const path = process.argv[storedAt + 1]; assert.ok(path && !path.startsWith("--"));
  const raw = JSON.parse(readFileSync(path, "utf8")); assert.ok(Array.isArray(raw));
  const matching = raw.filter(r => (r.cardId ?? r.card_id) === "BT3-070" && r.side === "front" && (r.skillIndex ?? r.skill_index) === 0);
  assert.equal(matching.length, 1, "one exact actual target required; no compiler fallback");
  const normalized = normalizeRows(matching); assert.deepEqual(normalized.malformed, []); reference = normalized.rows[0];
  assert.equal(reference.id, 6416); assert.equal(reference.source, "compiler"); assert.equal(reference.status, "draft"); assert.equal(reference.printed, historical.printed);
}
rows[rows.indexOf(target(rows))] = reference;
assert.deepEqual(runtimeSupportOfRow(reference).unsupported, [], "provided target must already carry its executable contract");
const strict = programProvenance({ "BT3-070": defs["BT3-070"] }, "stored", rows).manifest.find(m => m.cardId === "BT3-070" && m.skillIndex === 0)!;
assert.equal(strict.executable, true); assert.equal(strict.freshness, "current"); assert.equal(strict.humanReview?.confirmed, false);
for (const invalid of [undefined, { version: 1, variant: "Absorb", area: "hand" }]) {
  const rs = copy(rows); (target(rs).cost as unknown as {absorb: unknown}).absorb = invalid;
  assert.equal(programProvenance({ "BT3-070": defs["BT3-070"] }, "stored", rs).manifest.find(m => m.skillIndex === 0)!.executable, false);
}
const potara = card("POT923", { skill: "[Union-Potara] <Son Goku> and <Vegeta>." });
assert.equal(programProvenance({ POT923: potara }, "stored", skillRecords(potara).map(r => ({...r, source: "compiler", status: "draft"}))).manifest[0].executable, false, "native Potara remains its named authority residual");

function context(edit?: (r: RuleRow) => void): EngineContext { const rs = copy(rows); edit?.(target(rs)); return copy({ ...CTX, defs, scripts: rulesFromRows(rs, defs) }); }
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
interface Saved { ctx: EngineContext; state: VmState }
function take(s: Saved, action: Action): Saved {
  const a = copy(s), b = copy(s), one = RULES.apply(a.ctx, a.state, copy(action)), two = RULES.apply(b.ctx, b.state, copy(action));
  assert.deepEqual(one, two, "JSON context/state/action replay is deterministic"); return copy({ ctx: a.ctx, state: one.state as VmState });
}
function stage(s: Saved, p: PlayerId, def: string, area: string): string { const id = s.state.sides[p].zones.deck.find(id => s.state.cards[id].cardId === "V1")!; assert.ok(id, "unused generic fixture copy"); s.state.cards[id].cardId = def; assert.ok(moveCard(s.state, game, id, area, { owner: p }).ok); return id; }
function board(p: PlayerId, ctx = context()) {
  let s: Saved = { ctx, state: RULES.createGame(ctx, { seed: 923, p1: { name: "P1", leader: "L-RED", main: fifty("V1") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V1") } }).state as VmState };
  const foe = p === "p1" ? "p2" : "p1";
  for (const a of [{ type: "chooseFirst", player: s.state.chooser, first: p }, { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: foe, redraw: false }, { type: "charge", player: p, card: null }] as Action[]) s = take(s, a);
  for (const who of [p, foe]) for (const area of ["hand", "energy"]) for (const id of [...s.state.sides[who].zones[area]]) moveCard(s.state, game, id, "deck", { owner: who });
  const source = stage(s, p, "BT3-070", "battle"), a = stage(s, p, "A14923", "drop"), b = stage(s, p, "A15923", "drop"), energy = stage(s, p, "G923", "energy");
  const top = stage(s, p, "TOP923", "hand"); moveCard(s.state, game, top, "deck", { owner: p });
  return { s, source, a, b, energy, top, p };
}
const offer = (s: Saved, source: string) => RULES.legalActions(s.ctx, s.state).find(l => l.action.type === "activate" && l.action.card === source && l.action.skill === 0);
function next(s: Saved, decline = false): Action {
  const q = s.state.prompt;
  if (q.kind === "chooseCards") return { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, decline && q.choice.min === 0 ? 0 : Math.max(q.choice.min, 1)) };
  if (q.kind === "payCost") return { type: "payCost", player: q.player, option: 0 };
  if (q.kind === "counter") return { type: "counter", player: q.player, card: null };
  if (q.kind === "orderPending") return { type: "orderPending", player: q.player, index: 0 };
  throw Error(`unexpected Absorb continuation ${q.kind}`);
}
function finish(s: Saved, decline = false) { for (let i = 0; i < 30 && s.state.prompt.kind !== "main"; i++) s = take(s, next(s, decline)); assert.equal(s.state.prompt.kind, "main"); return s; }
const cases: string[] = [];
for (const p of ["p1", "p2"] as const) {
  for (const display of [null, "[Union-Fusion]", "[Union-Potara]", "[Triple Strike]"]) {
    const b = board(p); b.s.state.cards[b.source].mode = "rest"; addEffect(b.s.state, [], { target: b.source, source: b.source, kind: "power", value: 5000, until: "turn" });
    if (display) b.s.ctx.defs["BT3-070"].skill = b.s.ctx.defs["BT3-070"].skill!.replace(/\[union absorb\]/i, display);
    assert.equal(skillsShowing(b.s.ctx, b.s.state, b.source).skills[0].keyword?.name, "Union"); assert.equal(hasKeyword(b.s.ctx, game, b.s.state, b.source, "Strike"), false);
    const action = offer(b.s, b.source); assert.ok(action); let s = take(b.s, action.action);
    while (s.state.prompt.kind === "chooseCards" && s.state.prompt.choice.min === 1) s = take(s, next(s));
    assert.deepEqual(s.state.cards[b.source].under.slice().sort(), [b.a, b.b].sort(), "both mandatory costs precede optional deck choice"); assert.equal(s.state.cards[b.energy].mode, "rest");
    const end = finish(s); assert.ok(end.state.sides[p].zones.battle.includes(b.top)); assert.equal(end.state.cards[b.top].mode, "rest"); assert.ok(end.state.cards[b.top].under.includes(b.source));
    assert.equal(Number(attrsNow(end.ctx, game, end.state, b.top).power), Number(defs.TOP923.power) + 5000); cases.push(`${p}/real-price-stack-${display}`);
  }
  for (const bad of ["handSource", "dropSource", "missing14", "wrongArea", "wrongController", "wrongEnergy", "battleTiming"] as const) {
    const b = board(p);
    if (bad === "handSource" || bad === "dropSource") moveCard(b.s.state, game, b.source, bad === "handSource" ? "hand" : "drop", { owner: p });
    if (bad === "missing14") b.s.state.cards[b.a].cardId = "A15923";
    if (bad === "wrongArea") moveCard(b.s.state, game, b.a, "hand", { owner: p });
    if (bad === "wrongController") { moveCard(b.s.state, game, b.a, "hand", { owner: p }); stage(b.s, p === "p1" ? "p2" : "p1", "A14923", "drop"); }
    if (bad === "wrongEnergy") b.s.state.cards[b.energy].cardId = "V1";
    if (bad === "battleTiming") {
      const foe = p === "p1" ? "p2" : "p1";
      for (const a of [{ type: "endMain", player: p }, { type: "charge", player: foe, card: null }, { type: "endMain", player: foe }, { type: "charge", player: p, card: null }] as Action[]) b.s = take(b.s, a);
      b.s = take(b.s, { type: "attack", player: p, attacker: b.s.state.sides[p].zones.leader[0], target: b.s.state.sides[foe].zones.leader[0] });
    }
    assert.equal(offer(b.s, b.source), undefined, bad); cases.push(`${p}/refuse-${bad}`);
  }
  const changed = board(p, context(r => { const c = r.cost as CostRecord; c.orbs = { Blue: 1 }; const op = c.program![0]; assert.equal(op.op, "choose"); if (op.op === "choose") op.sel.filter!.characters = ["Android 16"]; }));
  assert.equal(offer(changed.s, changed.source), undefined); changed.s.state.cards[changed.a].cardId = "A16923"; changed.s.state.cards[changed.energy].cardId = "V-BLUE";
  assert.ok(offer(changed.s, changed.source), "stored selector/orb mutation governs independently of printed14/green"); assert.ok(finish(take(changed.s, offer(changed.s, changed.source)!.action)).state.sides[p].zones.battle.includes(changed.top)); cases.push(`${p}/stored-material-price`);
  const altered = board(p, context(r => { const op = (r.ops as import("../../src/lib/arena/vm/script").Op[])[0]; assert.equal(op.op, "choose"); if (op.op === "choose") { op.sel.filter!.costMin = 6; op.sel.filter!.costMax = 6; } }));
  const six = stage(altered.s, p, "SIX923", "hand"); moveCard(altered.s.state, game, six, "deck", { owner: p });
  const changedArrival = finish(take(altered.s, offer(altered.s, altered.source)!.action)); assert.ok(changedArrival.state.sides[p].zones.battle.includes(six)); assert.ok(changedArrival.state.sides[p].zones.deck.includes(altered.top)); cases.push(`${p}/stored-arrival-selector`);
  const decline = board(p), rng = decline.s.state.rngState; const declined = finish(take(decline.s, offer(decline.s, decline.source)!.action), true);
  assert.ok(declined.state.cards[decline.source].under.includes(decline.a)); assert.ok(declined.state.sides[p].zones.deck.includes(decline.top)); assert.notDeepEqual(declined.state.rngState, rng, "declining arrival keeps paid material costs and printed shuffle"); cases.push(`${p}/optional-decline`);
  for (const bad of ["missing", "kind", "area", "incompatiblePlay", "unknownPrice"] as const) {
    const ctx = context(r => { const c = r.cost as CostRecord; if (bad === "missing") delete c.absorb; if (bad === "kind") r.kind = "auto"; if (bad === "area") (c.absorb as unknown as {area:string}).area = "hand"; if (bad === "incompatiblePlay") r.ops = [{ op: "draw", n: 1 }]; if (bad === "unknownPrice") c.program = [{ op: "unknown" } as never]; });
    const b = board(p, ctx); b.s.ctx.defs["BT3-070"].skill = "[Triple Strike]"; assert.equal(offer(b.s, b.source), undefined); assert.equal(hasKeyword(b.s.ctx, game, b.s.state, b.source, "Strike"), false); cases.push(`${p}/blocked-${bad}`);
  }
  const base = board(p); stage(base.s, p, "A14923", "drop"); const pending = take(base.s, offer(base.s, base.source)!.action);
  for (const bad of ["frame", "epoch", "kind", "contract", "lineVariant", "linePrice"] as const) {
    const s = copy(pending), frame = s.state.programs.find(f => f.keywordCost)!; assert.ok(frame);
    if (bad === "frame") delete frame.absorbIdentity; if (bad === "epoch") delete frame.absorbSourceEpoch; if (bad === "kind") frame.absorbIdentity!.kind = "auto"; if (bad === "contract") delete frame.absorbIdentity!.price!.absorb;
    if (bad === "lineVariant") frame.keywordCost!.line.skill.keyword = { name: "Union", variant: "Fusion" };
    if (bad === "linePrice") frame.keywordCost!.line.script!.price!.payment.orbs = { Blue: 1 };
    const end = take(s, next(s)); assert.equal(end.state.outcome?.kind, "interrupted", `saved ${bad} refuses rebuild`); cases.push(`${p}/saved-${bad}`);
  }
  const costLeft = board(p); stage(costLeft.s, p, "A14923", "drop"); let costSaved = take(costLeft.s, offer(costLeft.s, costLeft.source)!.action);
  assert.ok(costSaved.state.programs.some(f => f.keywordCost)); const movement: GameEvent[] = [];
  moved(costSaved.ctx, game, costSaved.state, movement, costLeft.source, "hand"); moved(costSaved.ctx, game, costSaved.state, movement, costLeft.source, "battle");
  costSaved = finish(take(costSaved, next(costSaved))); assert.equal(costSaved.state.cards[costLeft.source].under.length, 0); assert.ok(costSaved.state.sides[p].zones.deck.includes(costLeft.top)); assert.equal(costSaved.state.cards[costLeft.energy].mode, "rest"); cases.push(`${p}/departed-cost-source`);
  const old = board(p); let obsolete = take(old.s, offer(old.s, old.source)!.action);
  while (obsolete.state.prompt.kind === "chooseCards" && obsolete.state.prompt.choice.min === 1) obsolete = take(obsolete, next(obsolete));
  assert.equal(obsolete.state.prompt.kind, "chooseCards");
  delete obsolete.ctx.scripts!["BT3-070"].bySkill[0].price!.absorb;
  obsolete.ctx.defs["BT3-070"].skill = obsolete.ctx.defs["BT3-070"].skill!.replace(/\[union absorb\]/i, "[Triple Strike]");
  for (const f of obsolete.state.programs) { delete f.absorbIdentity; delete f.absorbSourceEpoch; }
  const refused = take(obsolete, next(obsolete)); assert.equal(refused.state.outcome?.kind, "interrupted", "old postpayment frame and old context cannot resume through display identity"); assert.ok(refused.state.sides[p].zones.deck.includes(old.top)); cases.push(`${p}/obsolete-postpayment-frame-context`);
  const departed = board(p); let s = take(departed.s, offer(departed.s, departed.source)!.action);
  while (s.state.prompt.kind === "chooseCards" && s.state.prompt.choice.min === 1) s = take(s, next(s));
  const events: GameEvent[] = []; moved(s.ctx, game, s.state, events, departed.source, "hand"); moved(s.ctx, game, s.state, events, departed.source, "battle");
  s = finish(s); assert.ok(!s.state.sides[p].zones.battle.includes(departed.top)); assert.ok(s.state.sides[p].zones.drop.includes(departed.top), "left/returned source cannot host this old activated occurrence"); cases.push(`${p}/departed-source`);
}
const c = reference.cost as CostRecord, rule = { kind: "keyword", trigger: reference.trigger, cost: c, ops: reference.ops, cond: reference.cond, usage: reference.usage, validity: reference.validity } as Rule;
assert.equal(validateRule(rule, "keyword"), null); const parsed = parseRule(printRule(rule)); assert.ok(parsed.ok);
// The existing selector language canonically omits explicit upTo:false.
// Normalize only that redundant default; preserve every material filter/count.
const canonicalSelectors = (v: unknown): unknown => Array.isArray(v) ? v.map(canonicalSelectors) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k, x]) => !(k === "upTo" && x === false)).map(([k, x]) => [k, canonicalSelectors(x)])) : v;
assert.deepEqual(canonicalSelectors(parsed.value.cost), canonicalSelectors(c)); assert.deepEqual(parsed.value.cost!.absorb, marker); assert.deepEqual(priceFromCostRecord(c).absorb, marker);
assert.equal(validateRule({...rule, kind: "auto"}, "auto")?.field, "kind");

void (async () => {
  for (const bad of ["kind", "contract"] as const) {
    const existing = copy(reference); if (bad === "kind") existing.kind = "auto"; else delete (existing.cost as CostRecord).absorb;
    let wrote = false;
    const db = { query: { cardRules: { findFirst: async () => existing } }, update: () => { wrote = true; throw Error("unexpected write"); } };
    await assert.rejects(() => saveRule(db as unknown as Parameters<typeof saveRule>[0], { cardId: existing.cardId, side: existing.side, skillIndex: existing.skillIndex, source: "user", status: "corrected", ops: existing.ops as Rule["ops"], cost: existing.cost }), /Union-Absorb/);
    assert.equal(wrote, false);
  }
const outAt = process.argv.indexOf("--out"); if (outAt >= 0) { assert.ok(process.argv[outAt + 1]); writeFileSync(process.argv[outAt + 1], JSON.stringify({ format: "absorb-identity-923-v1", target: "BT3-070/front/0", input: storedAt >= 0 ? "provided stored target" : "offline proposed exact v9 body plus marker", cases, support: "compiled public companion fixtures", passed: true }, null, 2) + "\n"); }
console.log(`absorb-identity-923: ${cases.length} both-seat exact-target authority, cost/stack, mutation, refusal and saved-occurrence cases PASS`);
})();
