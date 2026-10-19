/** Official DB2 removal errata, persisted rows and real VM departures (#920). */
import assert from "node:assert/strict";
import corpus from "../fixtures/universe3-920.json";
import { CTX, DEFS, card, fifty, skillRecords } from "./harness";
import { correctSkillText } from "../../src/lib/catalog/errata";
import { compileCard } from "../../src/lib/arena/compile";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { parseRule, printRule, validateRule } from "../../src/lib/arena/lang";
import { RULES } from "../../src/lib/arena/vm";
import { expandMacros, rulesetFor } from "../../src/lib/arena/rulesets";
import { findCard, moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { moved, run } from "../../src/lib/arena/vm/flow";
import { koCard } from "../../src/lib/arena/vm/battle";
import { leaveRoute, replacementChoices, replacementIdentity } from "../../src/lib/arena/vm/replace";
import { vmHost } from "../../src/lib/arena/vm/host";
import { automaticPriceHost, AutoPaymentFailed } from "../../src/lib/arena/vm/auto-costs";
import { describeScript, stepScript, type Op, type ScriptFrame } from "../../src/lib/arena/vm/script";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const defs: Record<string, CardDef> = { ...DEFS };
for (const row of corpus) {
  assert.equal(row.is_banned, true, "the gameplay repair does not lift the catalog's existing ban");
  const skill = correctSkillText(row.id, row.skill); assert.ok(skill);
  assert.match(skill, /removed from a Battle Area or Combo Area/);
  assert.equal(correctSkillText(row.id, skill), skill, "errata ingestion is idempotent");
  assert.equal(correctSkillText("UNRELATED920", row.skill), row.skill);
  const d = card(row.id, { name: row.name, type: "BATTLE", colors: ["Black"], energyCost: Number(row.energy_cost), power: row.power,
    comboCost: row.combo_cost, comboPower: row.combo_power, characters: row.characters, traits: row.traits, skill });
  defs[row.id] = d;
  const before = skillRecords({ ...d, skill: row.skill }).find((r) => r.kind === "permanent");
  const after = skillRecords(d).find((r) => r.kind === "permanent");
  assert.ok(before && after);
  assert.ok(before.unread.length > 0, "obsolete Drop-only source is never silently broadened");
  assert.deepEqual(after.unread, []);
  assert.deepEqual(after.ops, [{ op: "replaceLeave", to: "deck", target: { sel: { special: "self" } }, from: ["battle", "combo"], position: "bottom" }]);
  assert.match(after.reads, /battle or combo/);
  assert.match(after.reads, /bottom/);
  const text = printRule({ kind: "permanent", trigger: [], cost: null, cond: null, ops: after.ops });
  const parsed = parseRule(text); assert.ok(parsed.ok, text);
  assert.equal(validateRule(parsed.value, "permanent"), null);
  assert.deepEqual(parsed.value.ops, after.ops, "area scope and bottom position survive language storage");
  const expanded = expandMacros(after.ops, game);
  assert.equal(expanded[0].op, "replace");
  assert.deepEqual((expanded[0] as Extract<Op, { op: "replace" }>).from, ["battle", "combo"]);
  assert.match(JSON.stringify(expanded), /"position":"bottom"/);
  // The independently printed resurrection skill must not be rewritten.
  const oldActivation = skillRecords({ ...d, skill: row.skill }).find((r) => r.kind === "activate:main/battle");
  const newActivation = skillRecords(d).find((r) => r.kind === "activate:main/battle");
  assert.deepEqual(newActivation, oldActivation);
}
for (const cost of [2, 3, 4, 5]) defs[`COST${cost}-920`] = card(`COST${cost}-920`, { energyCost: cost, colors: ["Black"] });
defs.DROPLIMIT920 = card("DROPLIMIT920", { energyCost: 3, colors: ["Black"], skill: "[Activate: Main][Limit 1] Choose 1 of your black Battle Cards with an energy cost of 3 and send it to its owner's Warp: Play this card from your Drop Area." });
defs.NODROP920 = card("NODROP920", { skill: "[Activate: Main] Draw 1 card." });
defs.KEYWORD920 = card("KEYWORD920", { skill: "[Over Realm 3]" });
defs.WATCH920 = card("WATCH920", { skill: "[Auto] When a card in your Combo Area is placed in your Drop Area, draw 1 card." });
defs.SELFKO920 = card("SELFKO920", { skill: `${defs["DB2-151"].skill}<br>[Auto] When this card is KO'd, draw 1 card.` });

// Persist the compiler drafts as ordinary JSON rows and load through the same
// rulesFromRows seam as a match. No lazy/runtime compiler provides these rules.
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((record, i) => ({ ...record,
  id: `${record.cardId}-${record.side}-${record.skillIndex}-${i}`, status: record.unread.length ? "open" : "draft", source: "compiler", version: 1,
  explanation: null, compilerDiff: null, createdAt: new Date(0), updatedAt: new Date(0) }))) as unknown as RuleRow[];
const scripts = rulesFromRows(JSON.parse(JSON.stringify(rows)), defs);
const ctx: EngineContext = { ...CTX, defs, scripts };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
function apply(s: VmState, a: Action) { return RULES.apply(ctx, reload(s), a) as { state: VmState; events: GameEvent[] }; }
function main(): VmState {
  let s = RULES.createGame(ctx, { seed: 920, p1: { name: "P1", leader: "L-RED", main: fifty("V1") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state;
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = apply(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state;
  assert.equal(s.prompt.kind, "main"); return s;
}
function stage(s: VmState, id: string, area: string, owner: PlayerId = "p1", holder = owner): string {
  const physical = s.sides[owner].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: holder }).ok);
  return physical;
}
function snapshot(s: VmState, viewer: PlayerId) {
  return buildSnapshot({ id: 920, mode: "versus", status: "playing", p1Name: "P1", p2Name: "P2", ctx, state: s,
    legal: RULES.legalActions(ctx, s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
}
for (const row of corpus) for (const owner of ["p1", "p2"] as const) for (const from of ["battle", "combo"]) for (const to of ["drop", "hand", "warp", "deck", ...(from === "battle" ? ["combo"] : [])]) {
  const s = main(); const id = stage(s, row.id, from, owner); const before = [...s.sides[owner].zones.deck];
  const ev: GameEvent[] = [];
  moved(ctx, game, s, ev, id, to, { owner, reason: "effect", by: "skill" });
  assert.equal(findCard(s, id)?.zone, "deck", `${row.id}: ${from}->${to}`);
  assert.deepEqual(s.sides[owner].zones.deck, [...before, id], "existing ordered deck is preserved with one bottom insertion");
  assert.deepEqual(ev.filter((e) => e.type === "move" && e.card === id).map((e) => e.type === "move" ? [e.from, e.to] : []), [[from, "deck"]]);
  assert.ok(!s.pending.some((p) => p.kind !== "hook" && ["comboToDrop", "leftBattleToDrop", "droppedFromBattle"].includes(p.trigger)), "no false Drop arrival");
  const roundtrip = reload(s); assert.equal(roundtrip.sides[owner].zones.deck.at(-1), id);
  const other = owner === "p1" ? "p2" : "p1";
  assert.ok(!JSON.stringify(snapshot(roundtrip, other)).includes(row.name), "a returned deck card is not revealed through the opponent snapshot");
}
for (const from of ["hand", "energy", "deck", "warp"]) {
  const s = main(); const id = stage(s, "DB2-151", from);
  moved(ctx, game, s, [], id, "drop", { owner: "p1", reason: "effect" });
  assert.equal(findCard(s, id)?.zone, "drop", `${from} is not a valid origin`);
}
for (const area of ["battle", "combo"]) for (const kind of ["negateSkills", "negateSkill"] as const) {
  const s = main(); const id = stage(s, "DB2-151", area);
  addEffect(s, [], { source: id, target: id, kind, value: kind === "negateSkill" ? 0 : 0, until: "turn" });
  moved(ctx, game, s, [], id, "drop", { owner: "p1", reason: "effect" });
  assert.equal(findCard(s, id)?.zone, "drop", "a negated Permanent supplies no replacement");
}
{
  const s = main(); const id = stage(s, "DB2-151", "battle", "p1", "p2");
  assert.ok(s.sides.p2.zones.battle.includes(id));
  moved(ctx, game, s, [], id, "hand", { owner: "p2", reason: "effect" });
  assert.equal(s.sides.p1.zones.deck.at(-1), id, "the owner deck wins over temporary control");
  assert.ok(!s.sides.p2.zones.deck.includes(id));
}
// 5-12-3 preserves the distinct KO occurrence, even though no Drop entry occurs.
{
  const s = main(); const id = stage(s, "SELFKO920", "battle"); const ev: GameEvent[] = [];
  koCard(ctx, game, s, ev, id);
  assert.equal(s.sides.p1.zones.deck.at(-1), id);
  assert.ok(s.pending.some((p) => p.kind !== "hook" && p.card === id && p.trigger === "koed"));
  assert.ok(!ev.some((e) => e.type === "move" && e.card === id && e.to === "drop"));
}
// 5-8-2-2-1-1: actual movement to a different area is not a paid action price.
for (const op of ["moveTo", "ko"] as const) {
  const s = main(); const id = stage(s, "DB2-151", "battle"); const ev: GameEvent[] = [];
  const ops: Op[] = op === "ko" ? [{ op: "ko", target: { sel: { special: "self" } } }] : [{ op: "moveTo", target: { sel: { special: "self" } }, to: "warp" }];
  const f: ScriptFrame = { card: id, master: "p1", ops, ip: 0, vars: {} };
  assert.throws(() => stepScript(automaticPriceHost(ctx, game, s, ev), f), AutoPaymentFailed);
  assert.equal(s.sides.p1.zones.deck.at(-1), id, "performed replacement remains when payment fails");
}
// 21-6: zero-power rule processing also retains the replacement's bottom.
{
  const s = main(); const id = stage(s, "DB2-151", "battle");
  const before = [...s.sides.p1.zones.deck];
  addEffect(s, [], { source: id, target: id, kind: "power", value: -30000, until: "turn" });
  run(ctx, game, s, []);
  assert.deepEqual(s.sides.p1.zones.deck, [...before, id]);
}
// The printed FROM Drop activation has an independent source-area permission.
for (const row of corpus) {
  const s = main(); const source = stage(s, row.id, "drop"); const base = stage(s, `COST${row.energy_cost}-920`, "battle");
  const action = RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === source);
  assert.ok(action, `${row.id}: resurrection from a genuine Drop entry remains available`);
  // An ordinary matching Battle Card can pay the separate Warp price.
  const ev = apply(s, action.action);
  assert.ok(ev.state.sides.p1.zones.warp.includes(base));
  assert.ok(ev.state.sides.p1.zones.battle.includes(source));
  assert.ok(ev.events.some((e) => e.type === "skill" && e.card === source));
}
// Drop enumeration grants no generic permission and retains payment/negation.
{
  const s = main(); const unrelated = stage(s, "NODROP920", "drop"); const keyword = stage(s, "KEYWORD920", "drop");
  const own = stage(s, "DB2-151", "drop"); const foreign = stage(s, "DB2-151", "drop", "p2");
  const base = stage(s, "COST3-920", "battle");
  const offers = (state: VmState, id: string) => RULES.legalActions(ctx, state).some((l) => l.action.type === "activate" && l.action.card === id);
  assert.equal(offers(s, unrelated), false); assert.equal(offers(s, keyword), false);
  assert.equal(offers(s, foreign), false, "one player cannot activate the other's Drop copy");
  assert.equal(offers(s, own), true);
  addEffect(s, [], { source: own, target: own, kind: "negateSkill", value: 10, until: "turn" });
  assert.equal(offers(s, own), false, "the original skill-negation refusal remains authoritative");
  s.effects = [];
  assert.ok(moveCard(s, game, base, "warp").ok);
  assert.equal(offers(s, own), false, "the Warp price still requires a matching Battle Card");
  const redirected = stage(s, "DB2-151", "battle");
  assert.equal(offers(s, own), false, "a required Warp movement redirected elsewhere cannot pay the activation");
  assert.ok(s.sides.p1.zones.battle.includes(redirected), "the affordability simulation does not mutate the board");
  const stored = scripts["DB2-151"].bySkill[10];
  delete scripts["DB2-151"].bySkill[10];
  // #1066: a skill with no stored price record is obsolete data, not a free skill and not a Drop permission read
  // from its text — the legal-action reader refuses it by name instead of answering "not offered".
  assert.throws(() => offers(s, own), /missing or unsupported typed skill payment v1/, "a missing persisted program cannot infer Drop permission from text");
  scripts["DB2-151"].bySkill[10] = stored;
}
// A saved Drop-price choice pays once, owns its choices, and spends Limit
// only at successful activation. The printed effect inherits cost bindings.
{
  const s = main(); const first = stage(s, "DROPLIMIT920", "drop"); const second = stage(s, "DROPLIMIT920", "drop");
  const a = stage(s, "COST3-920", "battle"); const b = stage(s, "COST3-920", "battle");
  const foreign = stage(s, "COST3-920", "battle", "p2");
  const action = RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === first); assert.ok(action);
  const waiting = apply(s, action.action);
  assert.equal(waiting.state.prompt.kind, "chooseCards");
  assert.ok(waiting.state.programs.some((f) => f.dropCost), "the strict price continuation is stored, not an already-activated effect");
  assert.ok(!waiting.events.some((e) => e.type === "skill" && e.card === first));
  assert.throws(() => apply(waiting.state, { type: "choose", player: "p1", cards: [foreign] }));
  assert.throws(() => apply(waiting.state, { type: "choose", player: "p2", cards: [a] }));
  const done = apply(waiting.state, { type: "choose", player: "p1", cards: [a] });
  assert.ok(done.state.sides.p1.zones.warp.includes(a)); assert.ok(done.state.sides.p1.zones.battle.includes(b));
  assert.ok(done.state.sides.p1.zones.battle.includes(first));
  assert.equal(done.events.filter((e) => e.type === "skill" && e.card === first).length, 1);
  assert.equal(RULES.legalActions(ctx, done.state).some((l) => l.action.type === "activate" && l.action.card === second), false, "Limit survives the source moving into play and applies to another copy");
}
// A voluntary replacement may be accepted during an otherwise payable price.
// It diverts the required movement, cancels activation and spends no Limit.
{
  const s = main(); const source = stage(s, "DROPLIMIT920", "drop"); const base = stage(s, "COST3-920", "battle");
  addEffect(s, [], { source: base, master: "p1", target: base, kind: "replaceLeave", value: { to: "deck", position: "bottom", optional: true }, until: "battle" });
  const action = RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === source); assert.ok(action);
  const waiting = apply(s, action.action); assert.equal(waiting.state.prompt.kind, "replaceMove");
  const failed = apply(waiting.state, { type: "chooseMode", player: "p1", index: 0 });
  assert.equal(failed.state.sides.p1.zones.deck.at(-1), base);
  assert.ok(failed.state.sides.p1.zones.drop.includes(source));
  assert.ok(!failed.events.some((e) => e.type === "skill" && e.card === source));
  const other = stage(failed.state, "COST3-920", "battle");
  assert.ok(RULES.legalActions(ctx, failed.state).some((l) => l.action.type === "activate" && l.action.card === source), "failed cost did not spend Limit");
  assert.ok(failed.state.sides.p1.zones.battle.includes(other));
}
// Suspendable competing routes remain the affected player's choice after reload.
{
  const s = main(); const id = stage(s, "DB2-151", "combo");
  addEffect(s, [], { source: id, master: "p1", target: id, kind: "replaceLeave", value: { from: ["combo"], to: "warp", target: { special: "self" } }, until: "battle" });
  const frame: ScriptFrame = { card: id, master: "p1", ops: [{ op: "moveTo", target: { sel: { special: "self" } }, to: "drop" }], ip: 0, vars: {} };
  assert.equal(stepScript(vmHost(ctx, game, s, []), frame), "wait");
  assert.equal(s.prompt.kind, "replaceMove");
  const choices = replacementChoices(ctx, game, s, id, "effect", { requestedTo: "drop" });
  const pick = choices.findIndex((c) => c.to === "deck"); assert.ok(pick >= 0);
  const done = apply(s, { type: "chooseMode", player: "p1", index: pick });
  assert.equal(done.state.sides.p1.zones.deck.at(-1), id);
}
// Ordinary timed replacements retain the historical cleanup-only Combo
// exception, and cannot acquire the new explicit source-area permission.
{
  const s = main(); const id = stage(s, "V1", "combo");
  addEffect(s, [], { source: id, master: "p1", target: id, kind: "replaceLeave", value: { to: "warp" }, until: "battle" });
  assert.equal(replacementChoices(ctx, game, s, id, "effect", { requestedTo: "drop" }).length, 0);
  assert.equal(replacementChoices(ctx, game, s, id, undefined, { requestedTo: "drop", comboCleanup: true }).length, 1);
  assert.ok(moveCard(s, game, id, "battle").ok);
  assert.equal(replacementChoices(ctx, game, s, id, "effect", { requestedTo: "combo" }).length, 0);
}
// A replacement already applied for this subject event is not applied again.
{
  const s = main(); const id = stage(s, "DB2-151", "battle"); const event = "920-one-event";
  const used = new Set([replacementIdentity(id, 0, event, id)]);
  const route = leaveRoute(ctx, game, s, [], id, "battle", "drop", { event, usedReplacements: used });
  assert.deepEqual(route, { stays: false, to: "drop" });
}
// Native 8-5 cleanup: both seats, saved choice, and a generic Drop watcher.
for (const owner of ["p1", "p2"] as const) {
  const s = main(); const a = stage(s, "V1", "battle"); const g = stage(s, "V-BLUE", "battle", "p2");
  const id = stage(s, "DB2-151", "combo", owner); const watcher = stage(s, "WATCH920", "battle", owner);
  s.battle = { attacker: a, guard: g, target: g, step: "battleEnd", negated: false, blockerOffered: false, counters: [] };
  s.phase = "battle"; s.flow.push({ phase: "battle", index: game.phases.battle.steps.indexOf("battleEnd"), repeats: 0 });
  run(ctx, game, s, []);
  assert.equal(s.prompt.kind, "zEnergyFromCombo");
  const done = apply(s, { type: "zEnergyFromCombo", player: owner, card: null });
  assert.equal(done.state.prompt.kind, "main");
  assert.equal(done.state.sides[owner].zones.deck.at(-1), id);
  assert.ok(!done.events.some((e) => e.type === "skill" && e.card === watcher), "replacement prevents the generic Drop Auto");
  assert.ok(!done.events.some((e) => e.type === "move" && e.card === id && e.to === "drop"));
}
assert.ok(compileCard(defs["DB2-151"]).complete);
assert.match(describeScript(scripts["DB2-151"].bySkill[0].ops), /battle or combo/);
console.log("universe3-removal-920: official errata, persisted rules, both origin areas, costs, KO and cleanup passed");
