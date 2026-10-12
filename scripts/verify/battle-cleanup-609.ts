/** Fixed §8-5 cleanup expectations on the rules engine; synthetic wording is intentional. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty, rulesFromCompiler, skillRecords } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { autoTriggerMatches } from "../../src/lib/arena/text/triggers";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { parseFilter } from "../../src/lib/arena/text/filters";
import { moveCard, newCard } from "../../src/lib/arena/vm/zones";
import { tokenCardId } from "../../src/lib/arena/vm/common";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { run } from "../../src/lib/arena/vm/flow";
import type { EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Op } from "../../src/lib/arena/vm/script";

const rules = engineFor("rules");
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const dbs = loaded.definition;
const generic = "[Auto] When a card in your Combo Area is placed in your Drop Area, choose 1 Battle Card in your Combo Area and draw 1 card.";
assert.equal(autoTriggerMatches(parseSkills(generic)[0], "comboToDrop"), true);
assert.equal(autoTriggerMatches(parseSkills(generic)[0], "comboed"), false);
const defs = { ...DEFS,
  PRE609: card("PRE609", { skill: generic }),
  OTHER609: card("OTHER609", { skill: "[Auto] When a card in your Combo Area is placed in your Drop Area, draw 1 card." }),
  END609: card("END609", { skill: "[Auto] At the end of a battle, choose 1 card in your Drop Area and draw 1 card." }),
  LATE609: card("LATE609", { skill: "[Auto] At the end of the battle after you combo with this card from your hand, draw 1 card." }),
  SPENT609: card("SPENT609", { comboPower: 5000 }),
  ULT609: card("ULT609", { comboPower: 5000, skill: "[Ultimate]" }),
};
const scripts = rulesFromCompiler(defs);
assert.ok(skillRecords(defs.PRE609)[0]?.trigger.includes("comboToDrop"), "the draft's synthetic generic reading names the new checkpoint trigger");
assert.ok(skillRecords(defs.OTHER609)[0]?.trigger.includes("comboToDrop"));
function setAuto(id: "PRE609" | "OTHER609" | "END609" | "LATE609", trigger: "comboToDrop" | "battleEnd" | "comboed", ops: Op[]) {
  const old = scripts[id].bySkill[0];
  assert.ok(old);
  scripts[id].bySkill[0] = { ...old, trigger: [trigger], unsupported: [], ops, price: undefined };
}
const faceUp = parseFilter("face-up Battle Card");
assert.equal(faceUp.faceUp, true);
setAuto("PRE609", "comboToDrop", [{ op: "choose", sel: { area: "combo", side: "both", count: 1 }, as: "picked" },
  { op: "if", cond: { kind: "count", sel: { special: "subject", filter: faceUp }, atLeast: 1 }, then: [{ op: "draw", n: 3 }] },
  { op: "draw", n: 1 }]);
setAuto("OTHER609", "comboToDrop", [{ op: "draw", n: 1 }]);
setAuto("END609", "battleEnd", [{ op: "choose", sel: { area: "drop", side: "both", count: 1 }, as: "picked" }, { op: "draw", n: 1 }]);
setAuto("LATE609", "comboed", [{ op: "draw", n: 1 }]);
const ctx: EngineContext = { ...CTX, defs, scripts };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
// This JSON was emitted by untouched 2f04b7e `origin/main` while its grouped
// cleanup was paused inside END609's choice. Those moves already happened.
{
  const fixture = JSON.parse(readFileSync(new URL("../../docs/arena-backlog/evidence/609/old-main-cleanup-pause.json", import.meta.url), "utf8")) as
    { state: VmState; spent1: string; spent2: string; attacker: string };
  const old = fixture.state;
  assert.equal(old.battle?.endCombo?.stage, "cleanup");
  assert.equal(old.prompt.kind, "chooseCards");
  assert.ok(old.sides.p1.zones.drop.includes(fixture.spent1));
  assert.ok(old.sides.p2.zones.drop.includes(fixture.spent2));
  const resumed = rules.apply(ctx, reload(old), { type: "choose", player: "p1", cards: [fixture.spent1] });
  assert.equal(resumed.state.prompt.kind, "main");
  assert.equal(resumed.events.filter((e) => e.type === "move" && e.from === "combo").length, 0);
  assert.equal(resumed.events.filter((e) => e.type === "draw" && e.player === "p1").length, 1);
  assert.equal(resumed.events.filter((e) => e.type === "skill" && e.card === fixture.attacker).length, 0);
}
function snapshot(current: VmState, viewer: PlayerId) {
  return buildSnapshot({ id: 609, engine: "rules", mode: "versus", status: "playing", p1Name: "Turn", p2Name: "Other", ctx, state: current,
    legal: rules.legalActions(ctx, current), log: [], beats: null, spotlight: null,
    spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
}

function main(): VmState {
  let s = rules.createGame(ctx, { seed: 609, p1: { name: "Turn", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = rules.apply(ctx, s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 40 && !(s.prompt.kind === "main" && s.prompt.player === "p1"); i++)
    s = rules.apply(ctx, s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(s.prompt.kind, "main");
  return s;
}
function stage(s: VmState, id: keyof typeof defs, p: PlayerId, zone: "battle" | "combo"): string {
  const physical = s.sides[p].zones.hand[0];
  assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, dbs, physical, zone, { owner: p }).ok);
  return physical;
}
function atEnd(s: VmState, attacker: string, guard: string, comboOrigins?: Record<string, "hand" | "other">): GameEvent[] {
  s.battle = { attacker, guard, target: guard, step: "battleEnd", negated: false, blockerOffered: false, counters: [], ...(comboOrigins ? { comboOrigins } : {}) };
  s.phase = "battle";
  s.flow.push({ phase: "battle", index: dbs.phases.battle.steps.indexOf("battleEnd"), repeats: 0 });
  const ev: GameEvent[] = [];
  run(ctx, dbs, s, ev);
  return ev;
}
function take(s: VmState, action: Parameters<typeof rules.apply>[2]): { state: VmState; events: GameEvent[] } {
  const r = rules.apply(ctx, reload(s), action);
  return { state: r.state as VmState, events: r.events };
}

let s = main();
const attacker = stage(s, "PRE609", "p1", "battle");
const guard = stage(s, "OTHER609", "p2", "battle");
stage(s, "END609", "p1", "battle");
const zChoice = stage(s, "SPENT609", "p1", "combo");
const turnSpent = stage(s, "SPENT609", "p1", "combo");
s.cards[turnSpent].faceUp = true; // information changes on the projected new card in Drop.
const otherSpent = stage(s, "SPENT609", "p2", "combo");
atEnd(s, attacker, guard);
assert.equal(s.prompt.kind, "zEnergyFromCombo");
s = take(s, { type: "zEnergyFromCombo", player: "p1", card: zChoice }).state;
assert.equal(s.prompt.kind, "zEnergyFromCombo");
let result = take(s, { type: "zEnergyFromCombo", player: "p2", card: null });
s = result.state;
assert.equal(s.prompt.kind, "chooseCards", "8-5-7 turn-player Auto pauses before departures");
assert.equal(s.battle?.endCombo?.stage, "preDropCheckpoint");
assert.equal(s.battle?.endCombo?.captureCursor, 2);
assert.ok(s.sides.p1.zones.combo.includes(turnSpent));
assert.ok(s.sides.p2.zones.combo.includes(otherSpent));
assert.ok(s.sides.p1.zones.zEnergy.includes(zChoice));
assert.ok(!s.pending.some((p) => p.kind !== "hook" && p.subject === zChoice));
assert.equal(s.programs[0]?.subject, turnSpent);
assert.ok(s.programs[0]?.subjectInfo, "the new-area movement information survives the pending-to-frame handoff");
for (const viewer of ["p1", "p2"] as const) {
  const shown = JSON.stringify(snapshot(s, viewer));
  assert.ok(!shown.includes("cleanupOccurrence") && !shown.includes("subjectInfo"), "internal cleanup progress is not public Snapshot data");
}
assert.equal(s.cards[turnSpent].faceUp, true);
assert.equal(s.programs[0].subjectInfo?.faceUp, false, "9-6-9-1-3 uses Drop information without changing live Combo information");
assert.equal(s.sides.p1.zones.drop.includes(turnSpent), false, "projected information did not move the live card");
assert.ok(!result.events.some((e) => e.type === "move" && e.card === turnSpent && e.to === "drop"));

// If an 8-5-7 effect changes the later route, the already-resolved generic
// occurrence cannot be retroactively assigned a new destination. This saved
// state mutation stands in for that unresolved combination at the boundary.
{
  const changed = reload(s);
  changed.cards[turnSpent].cardId = "ULT609";
  const after = take(changed, { type: "choose", player: "p1", cards: [turnSpent] });
  assert.equal(after.state.outcome?.kind, "interrupted");
  assert.equal(after.state.outcome?.privateContext?.issue, "#609");
}

// §9-6-11: once this Auto activated, a later source departure while its
// question is outstanding does not cancel the suspended effect.
{
  const departed = reload(s);
  assert.ok(moveCard(departed, dbs, attacker, "drop", { owner: "p1" }).ok);
  const after = take(departed, { type: "choose", player: "p1", cards: [turnSpent] });
  assert.equal(after.events.filter((e) => e.type === "draw" && e.player === "p1").length, 1);
}

result = take(s, { type: "choose", player: "p1", cards: [turnSpent] });
s = result.state;
assert.equal(result.events.filter((e) => e.type === "draw" && e.player === "p1").length, 1, "subject information uses projected Drop data, but live Combo selectors still chose the card");
assert.equal(s.prompt.kind, "chooseCards", "8-5-10 Auto pauses after both physical departures");
assert.equal(s.battle?.endCombo?.stage, "battleEndCheckpoint");
assert.ok(s.sides.p1.zones.drop.includes(turnSpent));
assert.ok(s.sides.p2.zones.drop.includes(otherSpent));
assert.equal(s.sides.p1.zones.combo.length, 0);
assert.equal(s.sides.p2.zones.combo.length, 0);
assert.equal(result.events.filter((e) => e.type === "move" && e.card === turnSpent && e.to === "drop").length, 1);
assert.equal(result.events.filter((e) => e.type === "move" && e.card === otherSpent && e.to === "drop").length, 1);
assert.equal(result.events.filter((e) => e.type === "skill" && e.card === guard).length, 1, "non-turn player's generic Auto resolves before 8-5-9");
assert.equal(result.events.filter((e) => e.type === "skill" && e.card === attacker).length, 0, "turn player's generic Auto already resolved before this continuation");

result = take(s, { type: "choose", player: "p1", cards: [turnSpent] });
s = result.state;
assert.equal(s.battle, null);
assert.equal(s.prompt.kind, "main");
assert.equal(result.events.filter((e) => e.type === "skill" && e.card !== guard).length, 0, "no cleanup Auto was replayed on second checkpoint resume");

// 8-5-10-1 joins the battle-end pending group only after the 8-5-8 physical
// departure. The original hand source survives that move and a JSON pause.
{
  const late = main();
  const source = stage(late, "END609", "p1", "battle");
  const defender = stage(late, "SPENT609", "p2", "battle");
  const subject = stage(late, "LATE609", "p2", "combo");
  for (let i = 0; i < 2; i++) {
    const existing = stage(late, "SPENT609", "p1", "battle");
    assert.ok(moveCard(late, dbs, existing, "drop", { owner: "p1" }).ok);
  }
  atEnd(late, source, defender, { [subject]: "hand" });
  const paused = take(late, { type: "zEnergyFromCombo", player: "p2", card: null });
  assert.equal(paused.state.prompt.kind, "chooseCards", JSON.stringify({ outcome: paused.state.outcome, pending: paused.state.pending, events: paused.events }));
  assert.equal(paused.state.battle?.endCombo?.stage, "battleEndCheckpoint");
  assert.deepEqual(paused.state.battle?.endCombo?.specialSubjects?.map((s) => s.card), [subject]);
  assert.equal(paused.state.battle?.endCombo?.specialCursor, 1);
  assert.equal(paused.state.pending.filter((p) => p.kind !== "hook" && p.card === subject && p.trigger === "comboed").length, 1);
  assert.equal(paused.events.filter((e) => e.type === "skill" && e.card === subject).length, 0);
  assert.equal(paused.events.filter((e) => e.type === "move" && e.card === subject && e.to === "drop").length, 1);
  const resumed = take(paused.state, { type: "choose", player: "p1", cards: [subject] });
  assert.equal(resumed.events.filter((e) => e.type === "skill" && e.card === subject).length, 1);
  assert.equal(resumed.events.filter((e) => e.type === "draw" && e.player === "p2").length, 1);
  assert.equal(resumed.state.prompt.kind, "main");
}

// §9-6-9-2: a source negated in its original Battle Area is not made pending
// merely because a Combo card is scheduled to leave.
{
  const negated = main();
  const source = stage(negated, "PRE609", "p1", "battle");
  const defender = stage(negated, "SPENT609", "p2", "battle");
  const spent = stage(negated, "SPENT609", "p1", "combo");
  addEffect(negated, [], { target: source, kind: "negateSkills", value: 0, until: "game", source: defender });
  atEnd(negated, source, defender);
  assert.equal(negated.prompt.kind, "zEnergyFromCombo");
  const after = take(negated, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(after.state.prompt.kind, "main");
  assert.equal(after.events.some((e) => e.type === "skill" && e.card === source), false);
  assert.equal(after.state.sides.p1.zones.drop.includes(spent), true);
}

// §9-6-2-1-1: two simultaneous qualifying departures make two occurrences
// of the same watcher, selected in the normal Auto ordering prompt.
{
  const simultaneous = main();
  const source = stage(simultaneous, "OTHER609", "p1", "battle");
  const defender = stage(simultaneous, "SPENT609", "p2", "battle");
  const first = stage(simultaneous, "SPENT609", "p1", "combo");
  const second = stage(simultaneous, "SPENT609", "p1", "combo");
  atEnd(simultaneous, source, defender);
  let after = take(simultaneous, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(after.state.prompt.kind, "orderPending");
  assert.equal(after.state.battle?.endCombo?.stage, "preDropCheckpoint");
  assert.deepEqual(after.state.pending.map((p) => p.kind === "hook" ? null : p.subject), [first, second]);
  assert.equal(new Set(after.state.pending.map((p) => p.kind === "hook" ? "" : p.cleanupOccurrence)).size, 2);
  assert.equal(after.state.sides.p1.zones.combo.length, 2);
  const chosen = (after.state.prompt as Extract<typeof after.state.prompt, { kind: "orderPending" }>).candidates[1];
  after = take(after.state, { type: "orderPending", player: "p1", index: chosen });
  assert.equal(after.state.prompt.kind, "main");
  assert.equal(after.events.filter((e) => e.type === "skill" && e.card === source).length, 2);
  assert.equal(after.events.filter((e) => e.type === "draw" && e.player === "p1").length, 2);
  assert.equal(after.events.filter((e) => e.type === "move" && e.from === "combo" && e.to === "drop").length, 2);
  assert.equal(after.state.battle, null);
}

// A replacement on a Combo card still works when no generic Auto asks for
// information about its departure; [Ultimate] leaves for Removed as before.
{
  const replaced = main();
  const source = stage(replaced, "SPENT609", "p1", "battle");
  const defender = stage(replaced, "SPENT609", "p2", "battle");
  const ultimate = stage(replaced, "ULT609", "p1", "combo");
  atEnd(replaced, source, defender);
  const after = take(replaced, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(after.state.prompt.kind, "main");
  assert.equal(after.state.sides.p1.zones.removed.includes(ultimate), true);
}

// The manual pre-announces the generic Auto, but does not tell this engine
// what new-area subject information to invent if [Ultimate] redirects that
// very departure. Keep the unresolved combination visible and typed.
{
  const replaced = main();
  const source = stage(replaced, "OTHER609", "p1", "battle");
  const defender = stage(replaced, "SPENT609", "p2", "battle");
  stage(replaced, "ULT609", "p1", "combo");
  atEnd(replaced, source, defender);
  const after = take(replaced, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(after.state.outcome?.kind, "interrupted");
  assert.equal(after.state.outcome?.privateContext?.issue, "#609");
  assert.equal(after.state.winner, null);
}

// A controlled card can be in one player's Combo Area but go to its owner's
// Drop. Neither player's printed "your Combo ... your Drop" is fulfilled.
{
  const split = main();
  const attacker = stage(split, "OTHER609", "p1", "battle");
  const guard = stage(split, "OTHER609", "p2", "battle");
  const foreign = stage(split, "SPENT609", "p2", "combo");
  assert.ok(moveCard(split, dbs, foreign, "combo", { owner: "p1" }).ok);
  atEnd(split, attacker, guard);
  const after = take(split, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(after.state.prompt.kind, "main");
  assert.equal(after.state.sides.p2.zones.drop.includes(foreign), true);
  assert.equal(after.events.filter((e) => e.type === "skill" && (e.card === attacker || e.card === guard)).length, 0);
}

// A token in Combo is removed by 19-1-7, so it never fulfills the printed
// destination of this generic Drop watcher.
{
  const tokens = main();
  const source = stage(tokens, "OTHER609", "p1", "battle");
  const defender = stage(tokens, "SPENT609", "p2", "battle");
  const id = "p1#token609";
  tokens.cards[id] = newCard(id, tokenCardId("Cleanup Token", 10000, 0, 5000, ["Red"]), "p1");
  assert.ok(moveCard(tokens, dbs, id, "combo", { owner: "p1" }).ok);
  atEnd(tokens, source, defender);
  const after = take(tokens, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(after.state.prompt.kind, "main");
  assert.equal(after.state.sides.p1.zones.removed.includes(id), true);
  assert.equal(after.events.filter((e) => e.type === "skill" && e.card === source).length, 0);
}
