/** #907: existing kind + valid Fusion price own identity, never displayed tags. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalizeRows } from "../arena-corpus-provenance.mts";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, saveRule, type RuleRow } from "../../src/lib/arena/rules-store";
import { validateRule, parseRule, printRule, type Rule } from "../../src/lib/arena/lang";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow, forbids, hasKeyword, keywordsInForce } from "../../src/lib/arena/vm/program";
import { skillsShowing } from "../../src/lib/arena/vm/triggers";
import { fusionIdentityProblem } from "../../src/lib/arena/vm/skill-identity";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { buildSnapshot } from "../../src/lib/arena/snapshot-core";
import { CTX, DEFS, card, fifty } from "./harness";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { CostRecord } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
const catalogPath = "docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/catalog.json";
const input = readFileSync(catalogPath), catalog = JSON.parse(input.toString()).cards;
const targets = [{ cardId: "BT6-012", skillIndex: 0, energy: 0 }, { cardId: "BT6-013", skillIndex: 0, energy: 0 }, { cardId: "BT6-015", skillIndex: 10, energy: 4 }];
const defs: Record<string, CardDef> = { ...DEFS,
  LF907: card("LF907", { type: "LEADER", colors: ["Red"], traits: ["Saiyan"] }),
  GF907: card("GF907", { characters: ["Son Goku: Br"], power: 10000 }),
  VF907: card("VF907", { characters: ["Vegeta: Br"], power: 10000 }),
  AF907: card("AF907", { characters: ["Alternate Goku"], colors: ["Blue"], power: 15000 }),
  BF907: card("BF907", { characters: ["Alternate Vegeta"], colors: ["Blue"], power: 15000 }),
};
for (const t of targets) defs[t.cardId] = cardDefFrom(catalog.find((d: CardDef) => d.id === t.cardId));
const rows = Object.values(defs).flatMap(d => skillRecords(d).map(r => ({ ...r, source: "compiler", status: "draft" } as RuleRow)));
const actualFlag = process.argv.indexOf("--stored-rules"), actualPath = actualFlag < 0 ? null : process.argv[actualFlag + 1];
if (actualFlag >= 0) assert.ok(actualPath && !actualPath.startsWith("--"), "--stored-rules needs an actual export path");
if (actualPath) {
  const exported = JSON.parse(readFileSync(actualPath, "utf8")); assert.ok(Array.isArray(exported));
  const selected = exported.filter((r: Record<string, unknown>) => targets.some(t => (r.cardId ?? r.card_id) === t.cardId && r.side === "front" && (r.skillIndex ?? r.skill_index) === t.skillIndex));
  const actual = normalizeRows(selected); assert.deepEqual(actual.malformed, []);
  assert.deepEqual(actual.rows.map(r => `${r.cardId}/${r.skillIndex}`).sort(), targets.map(t => `${t.cardId}/${t.skillIndex}`).sort(), "exactly one of each target");
  for (const r of actual.rows) { const at = rows.findIndex(b => b.cardId === r.cardId && b.side === "front" && b.skillIndex === r.skillIndex); assert.equal(r.printed, rows[at].printed, "fresh frozen source"); rows[at] = r; }
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const record = (rs: RuleRow[], t = targets[0]) => rs.find(r => r.cardId === t.cardId && r.side === "front" && r.skillIndex === t.skillIndex)!;
function context(edit?: (rs: RuleRow[]) => void): EngineContext { const rs = clone(rows); edit?.(rs); return clone({ ...CTX, defs, scripts: rulesFromRows(rs, defs) }); }
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
interface Saved { ctx: EngineContext; state: VmState }
function take(saved: Saved, action: Action): { saved: Saved; events: GameEvent[] } {
  const a = clone(saved), b = clone(saved), one = RULES.apply(a.ctx, a.state, clone(action)), two = RULES.apply(b.ctx, b.state, clone(action));
  assert.deepEqual(one, two, "saved executable context and action replay identically"); return { saved: clone({ ctx: a.ctx, state: one.state as VmState }), events: one.events };
}
function fresh(owner: PlayerId, ctx = context()): Saved {
  const other = owner === "p1" ? "p2" : "p1";
  let s: Saved = { ctx, state: RULES.createGame(ctx, { seed: 907, p1: { name: "One", leader: "LF907", main: fifty("V1") }, p2: { name: "Two", leader: "LF907", main: fifty("V1") } }).state as VmState };
  for (const a of [{ type: "chooseFirst", player: s.state.chooser, first: owner }, { type: "mulligan", player: owner, redraw: false }, { type: "mulligan", player: other, redraw: false }, { type: "charge", player: owner, card: null }] as Action[]) s = take(s, a).saved;
  for (const id of s.state.sides[owner].zones.hand.slice()) assert.ok(moveCard(s.state, game, id, "deck", { owner }).ok);
  return s;
}
function stage(s: Saved, owner: PlayerId, cardId: string, area: string): string { const id = s.state.sides[owner].zones.deck.find(i => s.state.cards[i].cardId === "V1"); assert.ok(id); s.state.cards[id].cardId = cardId; assert.ok(moveCard(s.state, game, id, area, { owner }).ok); return id; }
function board(owner: PlayerId, t = targets[0], ctx = context()) { const saved = fresh(owner, ctx), source = stage(saved, owner, t.cardId, "hand"), goku = stage(saved, owner, "GF907", "hand"), vegeta = stage(saved, owner, "VF907", "hand"); for (let n = 0; n < t.energy; n++) stage(saved, owner, "V1", "energy"); return { saved, source, goku, vegeta }; }
const offer = (s: Saved, source: string, index: number) => RULES.legalActions(s.ctx, clone(s.state)).find(l => l.action.type === "activate" && l.action.card === source && l.action.skill === index);
function next(s: Saved): Action { const p = s.state.prompt; if (p.kind === "chooseCards") return { type: "choose", player: p.player, cards: p.choice.candidates.slice(0, p.choice.min) }; if (p.kind === "payCost") return { type: "payCost", player: p.player, option: 0 }; if (p.kind === "orderPending") return { type: "orderPending", player: p.player, index: p.candidates[0] }; return { type: "pass", player: (p as { player: PlayerId }).player }; }
function finish(s: Saved, first?: Action): Saved { if (first) s = take(s, first).saved; for (let n = 0; n < 40 && s.state.prompt.kind !== "main"; n++) s = take(s, next(s)).saved; assert.equal(s.state.prompt.kind, "main"); return s; }
const checks: string[] = [];
for (const owner of ["p1", "p2"] as const) {
  for (const t of targets) {
    const b = board(owner, t), originalHand = b.saved.state.sides[owner].zones.hand.length;
    const row = record(rows, t), script = b.saved.ctx.scripts![t.cardId].bySkill[t.skillIndex];
    assert.equal(script.kind, "keyword"); assert.equal(fusionIdentityProblem(script), null); assert.deepEqual(row.unread, []);
    const action = offer(b.saved, b.source, t.skillIndex); assert.ok(action, "real frozen Fusion is offered");
    const end = finish(b.saved, action.action);
    assert.ok(end.state.sides[owner].zones.battle.includes(b.source), `${owner}/${t.cardId}: ${JSON.stringify({source: end.state.cards[b.source], zones:end.state.sides[owner].zones, outcome:end.state.outcome})}`);
    for (const material of [b.goku, b.vegeta]) assert.ok(end.state.sides[owner].zones.drop.includes(material));
    assert.equal(end.state.sides[owner].zones.energy.filter(i => end.state.cards[i].mode === "rest").length, t.energy);
    assert.equal(end.state.sides[owner].zones.hand.length, originalHand - 3 + (t.cardId === "BT6-015" ? 2 : 0), "printed draw-cost payoff retained");
    if (t.cardId !== "BT6-015") { const copy = stage(end, owner, t.cardId, "hand"); assert.equal(forbids(end.ctx, game, end.state, "play", { player: owner, card: copy }), true, "actual on-play same-name restriction retained"); }
    checks.push(`${owner}/${t.cardId}/frozen-materials-resources-draw-and-play`);
    const display = board(owner, t); display.saved.ctx.defs[t.cardId].skill = display.saved.ctx.defs[t.cardId].skill!.replace(/\[union-fusion\]/i, "[Triple Strike]");
    const shown = skillsShowing(display.saved.ctx, display.saved.state, display.source).skills.find(sk => sk.index === t.skillIndex)!;
    assert.deepEqual(shown.keyword, { name: "Union", variant: "Fusion" });
    assert.equal(hasKeyword(display.saved.ctx, game, display.saved.state, display.source, "Strike"), t.cardId === "BT6-015", "only its independent Double Strike survives");
    assert.ok(keywordsInForce(display.saved.ctx, game, display.saved.state, display.source).every(k => k.name !== "Strike" || k.x === 2), "display cannot grant Triple Strike hooks");
    assert.equal(((attrsNow(display.saved.ctx, game, display.saved.state, display.source).keywords ?? []) as string[]).includes("Strike"), t.cardId === "BT6-015", "display cannot leak into keyword filters");
    assert.ok(finish(display.saved, offer(display.saved, display.source, t.skillIndex)!.action).state.sides[owner].zones.battle.includes(display.source));
    checks.push(`${owner}/${t.cardId}/display-Strike-does-not-change-identity`);
  }
  const t = targets[0];
  for (const status of ["draft", "open", "confirmed", "corrected"] as const) {
    const blocked = board(owner, t, context(rs => {
      const row = record(rs); row.status = status;
      (row.cost as CostRecord).readable = false;
    }));
    // A display-only tag cannot grant hooks or hide a stored unread Fusion.
    blocked.saved.ctx.defs[t.cardId].skill = blocked.saved.ctx.defs[t.cardId].skill!.replace(/\[union-fusion\]/i, "[Triple Strike]");
    const s = clone(blocked.saved), before = clone(s);
    const legal = RULES.legalActions(s.ctx, s.state);
    const isTarget = (a: Action) => a.type === "activate" && a.card === blocked.source && a.skill === t.skillIndex;
    assert.ok(!legal.some(l => isTarget(l.action)), `${status}: blocked Fusion never offered`);
    const rejected = RULES.rejectedActions(s.ctx, s.state, legal).filter(r => isTarget(r.action));
    assert.equal(rejected.length, 1, `${status}: stored identity retains one rejected candidate`);
    assert.ok(rejected[0].why.some(r => r.kind === "unread"), `${status}: unread reason retained`);
    assert.equal(skillsShowing(s.ctx, s.state, blocked.source).skills.find(sk => sk.index === t.skillIndex)!.keyword, null);
    assert.equal(hasKeyword(s.ctx, game, s.state, blocked.source, "Union"), false);
    assert.equal(hasKeyword(s.ctx, game, s.state, blocked.source, "Strike"), false);
    assert.throws(() => RULES.apply(s.ctx, s.state, { type: "activate", player: owner, card: blocked.source, skill: t.skillIndex }), IllegalAction);
    assert.deepEqual(s, before, "diagnostics and forged activation do not mutate saved state");
    const foe: PlayerId = owner === "p1" ? "p2" : "p1";
    const snapshot = (saved: Saved) => buildSnapshot({ id: 907, revision: 1, mode: "versus", status: "playing",
      p1Name: "One", p2Name: "Two", ctx: saved.ctx, state: saved.state, legal, log: [], beats: null, spotlight: null,
      spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer: foe, images: {} });
    const withoutCandidate = clone(s);
    delete withoutCandidate.ctx.scripts![t.cardId].bySkill[t.skillIndex].price!.fusion;
    assert.deepEqual(snapshot(s), snapshot(withoutCandidate), "opponent snapshot cannot reveal the private unread candidate");
    const hidden = clone(s); hidden.state.cards[blocked.source].hidden = true;
    const hiddenLegal = RULES.legalActions(hidden.ctx, hidden.state);
    assert.ok(!RULES.rejectedActions(hidden.ctx, hidden.state, hiddenLegal).some(r => isTarget(r.action)), "Hidden Mode exposes no diagnostic candidate");
    checks.push(`${owner}/blocked-${status}-stored-Fusion-unread-without-native-hooks`);
  }
  const changed = context(rs => { const f = (record(rs).cost as CostRecord).fusion!; f.needs[0] = { name: "Alternate Goku", filter: { ...f.needs[0].filter, colors: ["Blue"] } }; f.needs[1] = { name: "Alternate Vegeta", filter: { ...f.needs[1].filter, colors: ["Blue"] } }; });
  const alt = board(owner, t, changed); assert.equal(offer(alt.saved, alt.source, t.skillIndex), undefined); const a = stage(alt.saved, owner, "AF907", "hand"), b = stage(alt.saved, owner, "BF907", "hand");
  const altered = finish(alt.saved, offer(alt.saved, alt.source, t.skillIndex)!.action); for (const id of [a, b]) assert.ok(altered.state.sides[owner].zones.drop.includes(id)); for (const id of [alt.goku, alt.vegeta]) assert.ok(altered.state.sides[owner].zones.hand.includes(id));
  checks.push(`${owner}/stored-material-mutation-retains-Fusion-identity`);
  for (const kind of [undefined, "auto"] as const) {
    const bad = board(owner); bad.saved.ctx.scripts![t.cardId].bySkill[t.skillIndex].kind = kind;
    assert.throws(() => offer(bad.saved, bad.source, t.skillIndex), /Union-Fusion identity/); checks.push(`${owner}/obsolete-context-kind-${String(kind)}`);
  }
  for (const missing of [true, false]) {
    const blocked = context(rs => { const row = record(rs); if (missing) delete (row.cost as CostRecord).fusion; else row.kind = "auto"; assert.ok(runtimeSupportOfRow(row).unsupported.some(s => /Fusion/.test(s))); });
    const bad = board(owner, t, blocked); bad.saved.ctx.defs[t.cardId].skill = bad.saved.ctx.defs[t.cardId].skill!.replace(/\[union-fusion\]/i, "[Triple Strike]");
    assert.equal(offer(bad.saved, bad.source, t.skillIndex), undefined); assert.equal(hasKeyword(bad.saved.ctx, game, bad.saved.state, bad.source, "Strike"), false);
    assert.ok(!((attrsNow(bad.saved.ctx, game, bad.saved.state, bad.source).keywords ?? []) as string[]).includes("Strike"));
    const legal = RULES.legalActions(bad.saved.ctx, bad.saved.state);
    assert.ok(!RULES.rejectedActions(bad.saved.ctx, bad.saved.state, legal).some(r => r.action.type === "activate" && r.action.card === bad.source && r.action.skill === t.skillIndex), "missing or contradictory identity cannot recover a candidate from display text");
    checks.push(`${owner}/blocked-record-display-Strike-${missing ? "missing-material" : "wrong-kind"}`);
  }
  const base = board(owner), pending = take(base.saved, offer(base.saved, base.source, t.skillIndex)!.action).saved;
  assert.equal(pending.state.prompt.kind, "chooseCards");
  for (const mode of ["scriptKind", "skillKind", "skillVariant", "declaration", "frameKind", "frameMissing"] as const) {
    const bad = clone(pending), frame = bad.state.programs.find(f => f.keywordPrice)!; const line = frame.keywordPrice!.line;
    if (mode === "scriptKind") delete line.script!.kind;
    if (mode === "skillKind") line.skill.kind = "auto";
    if (mode === "skillVariant" && line.skill.keyword?.name === "Union") line.skill.keyword.variant = "Potara";
    if (mode === "declaration") line.keyword!.name = "Strike";
    if (mode === "frameKind") frame.fusionIdentity!.kind = "auto";
    if (mode === "frameMissing") delete frame.fusionIdentity;
    const zones = clone(bad.state.sides[owner].zones), end = take(bad, next(bad)).saved;
    assert.equal(end.state.outcome?.kind, "interrupted", `saved ${mode} explicitly requires rebuild`); assert.deepEqual(end.state.sides[owner].zones, zones);
    checks.push(`${owner}/saved-${mode}-rebuild`);
  }
}
for (const t of targets) {
  const r = record(rows, t), rule: Rule = { kind: r.kind, trigger: r.trigger as Rule["trigger"], usage: r.usage as Rule["usage"], validity: r.validity as Rule["validity"], cost: r.cost as CostRecord, cond: r.cond as Rule["cond"], ops: r.ops as Rule["ops"] };
  assert.equal(validateRule(rule, r.kind), null);
  const parsed = parseRule(printRule(rule)); assert.ok(parsed.ok); assert.deepEqual(parsed.value, rule);
  assert.equal(validateRule({ ...rule, kind: "auto" }, "auto")?.field, "kind", "authoring refuses a Fusion price on a contradictory kind");
}
void (async () => {
  const wrong = { ...record(rows), kind: "auto" }; let wrote = false;
  const db = { query: { cardRules: { findFirst: async () => wrong } }, update: () => { wrote = true; throw new Error("unexpected write"); } };
  await assert.rejects(() => saveRule(db as unknown as Parameters<typeof saveRule>[0], { cardId: wrong.cardId, side: "front", skillIndex: wrong.skillIndex, source: "user", status: "corrected", ops: wrong.ops as Rule["ops"], cost: wrong.cost }), /Union-Fusion identity/);
  assert.equal(wrote, false);
})();
const outFlag = process.argv.indexOf("--out"), outPath = outFlag < 0 ? null : process.argv[outFlag + 1]; if (outFlag >= 0) assert.ok(outPath && !outPath.startsWith("--"));
if (outPath) writeFileSync(outPath, JSON.stringify({ mode: actualPath ? "provided actual rows; targeted scenarios" : "offline rebuilt rows; targeted scenarios", catalogPath, catalogSHA256: createHash("sha256").update(input).digest("hex"), actualPath, targets: targets.map(t => record(rows, t)), checks, reviewed: false, qualified: false, pairGames: 0 }, null, 2) + "\n");
console.log(`#907 Fusion identity: ${checks.length} both-seat frozen payoffs, stored/display mutation, blocked keyword/filter and saved identity scenarios passed`);
