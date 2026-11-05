/** R475 typed synthetic mechanisms: no new printed-card admission claim. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { addEffect, endEffects } from "../../src/lib/arena/vm/effects";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { hasKeyword } from "../../src/lib/arena/vm/program";
import { capturedSkillShowing, skillsShowing } from "../../src/lib/arena/vm/triggers";
import { copiedSkillIndex } from "../../src/lib/arena/vm/common";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { stepScript } from "../../src/lib/arena/vm/script";
import { vmHost } from "../../src/lib/arena/vm/host";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const defs: Record<string, CardDef> = {
  F: card("F", { skill: null }), L: card("L", { type: "LEADER", skill: null }),
  COUNTER: card("COUNTER", { energyCost: 0, skill: "[Counter: Play] Play this card." }),
  PRINTED: card("PRINTED", { skill: "[Blocker]" }),
  ACTIVE: card("ACTIVE", { skill: "[Activate: Main] Choose up to 1 Battle Card in your Drop and add it to your hand, then draw 1 card." }),
  WATCHER: card("WATCHER", { skill: "[Auto] When you play a Battle Card, draw 1 card." }),
  ENDER: card("ENDER", { skill: "[Auto] At the end of your turn, draw 1 card." }),
  NEGATOR: card("NEGATOR", { skill: "[Auto] At the end of your turn, choose up to 1 of your Battle Cards and negate its skills for the turn." }),
  PLAY: card("PLAY", { skill: "[Activate: Main] Choose up to 1 Battle Card from your hand and play it." }),
};
const rows = Object.values(defs).flatMap(skillRecords).map((row, id) => ({ ...row, id, source: "compiler", status: "confirmed" }) as unknown as RuleRow);
const ctx: EngineContext = { defs, scripts: rulesFromRows(rows, defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const take = (s: VmState, action: Action): VmState => RULES.apply(ctx, copy(s), action).state as VmState;
function fresh(player: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 475, p1: { name: "One", leader: "L", main: fifty("F") }, p2: { name: "Two", leader: "L", main: fifty("F") } }).state as VmState;
  for (const a of [{ type: "chooseFirst", player: s.chooser, first: player }, { type: "mulligan", player, redraw: false }, { type: "mulligan", player: other(player), redraw: false }, { type: "charge", player, card: null }] as Action[]) s = take(s, a);
  assert.equal(s.prompt.kind, "main"); return s;
}
function stage(s: VmState, owner: PlayerId, definition: string, area: string): string {
  const id = s.sides[owner].zones.deck.at(-1)!; s.cards[id].cardId = definition;
  assert.ok(moveCard(s, game, id, area, { owner }).ok); return id;
}
function grant(s: VmState, owner: PlayerId, target: string, definition: string, until: "game" | "battle" = "game") {
  return addEffect(s, [], { target, master: owner, kind: "copiedSkills", value: 0, until, copied: { cardId: definition, side: "front", skills: [0], from: target } });
}
function activate(s: VmState, player: PlayerId, target: string): VmState {
  const a = RULES.legalActions(ctx, s).find(entry => entry.action.type === "activate" && entry.action.card === target)?.action;
  assert.ok(a); return take(s, a);
}
let cases = 0;
for (const owner of ["p1", "p2"] as const) for (const deleted of [false, true]) {
  const player = other(owner); let s = fresh(player); const target = stage(s, owner, "F", "battle"), source = stage(s, player, "F", "battle");
  addEffect(s, [], { target, master: owner, kind: "keyword", value: { name: "Barrier" }, until: "game" });
  const copied = grant(s, owner, target, "ACTIVE"), index = copiedSkillIndex(copied.id, 0), epoch = s.cards[target].zoneEpoch;
  if (deleted) { addEffect(s, [], { target, master: owner, kind: "negateSkills", value: 0, until: "battle" }); endEffects(s, [], "battle"); }
  assert.equal(stepScript(vmHost(ctx, game, s, []), { ops: [{ op: "control", target: { var: "target" }, to: "you", until: "turn" }], ip: 0, vars: { target: [target] }, card: source, master: player }), "done");
  assert.ok(s.sides[player].zones.battle.includes(target)); assert.equal(s.cards[target].zoneEpoch, epoch);
  assert.equal(hasKeyword(ctx, game, s, target, "Barrier"), !deleted); assert.equal(skillsShowing(ctx, s, target).skills.some(skill => skill.index === index), !deleted);
  s = take(s, { type: "endMain", player });
  assert.ok(s.sides[owner].zones.battle.includes(target)); assert.equal(s.cards[target].zoneEpoch, epoch);
  assert.equal(hasKeyword(ctx, game, s, target, "Barrier"), !deleted); assert.equal(skillsShowing(ctx, s, target).skills.some(skill => skill.index === index), !deleted); assert.ok(!s.outcome); cases++;
}
for (const player of ["p1", "p2"] as const) {
  const s = fresh(player), target = stage(s, player, "PRINTED", "battle");
  addEffect(s, [], { target, master: player, kind: "keyword", value: { name: "Barrier" }, until: "game" });
  assert.ok(hasKeyword(ctx, game, s, target, "Barrier"));
  addEffect(s, [], { target, master: player, kind: "negateSkills", value: 0, until: "turn" });
  endEffects(s, [], "turn");
  assert.ok(hasKeyword(ctx, game, s, target, "Blocker"), "printed skill returns");
  assert.equal(hasKeyword(ctx, game, s, target, "Barrier"), false, "resolved gained text stays deleted");
  const before = JSON.stringify(s); RULES.legalActions(ctx, s); hasKeyword(ctx, game, s, target, "Barrier");
  assert.equal(JSON.stringify(s), before, "queries do not mutate history");
  addEffect(s, [], { target, master: player, kind: "keyword", value: { name: "Barrier" }, until: "game" });
  assert.ok(hasKeyword(ctx, game, s, target, "Barrier"), "new grant is independent"); cases++;
}
for (const player of ["p1", "p2"] as const) for (const fault of ["none", "negate", "expire", "missing", "changed-record", "changed-rule"] as const) {
  let s = fresh(player); const target = stage(s, player, "F", "battle"), picked = stage(s, player, "F", "drop");
  const effect = grant(s, player, target, "ACTIVE", "battle"); const index = copiedSkillIndex(effect.id, 0);
  s = activate(s, player, target); assert.equal(s.prompt.kind, "chooseCards");
  const frame = s.programs.find(frame => frame.skillIndex === index)!; assert.ok(frame.copiedSkillCapture);
  for (const viewer of [player, other(player)]) {
    const view = JSON.stringify(buildSnapshot({ id: 475, revision: 1, mode: "versus", status: "playing", p1Name: "One", p2Name: "Two", ctx, state: s, legal: [], log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} }));
    assert.ok(!view.includes('"copiedSkillCapture"')); assert.ok(!view.includes('"resolvedGrantDeletions"'));
  }
  const before = s.sides[player].zones.hand.length;
  if (fault === "negate") { addEffect(s, [], { target, master: player, kind: "negateSkills", value: 0, until: "turn" }); endEffects(s, [], "turn"); }
  if (fault === "expire") endEffects(s, [], "battle");
  if (fault === "missing") delete frame.copiedSkillCapture;
  if (fault === "changed-record") frame.copiedSkillCapture!.record += " stale";
  const original = ctx.scripts!.ACTIVE.bySkill[0];
  if (fault === "changed-rule") ctx.scripts!.ACTIVE.bySkill[0] = { ...original, ops: [{ op: "draw", n: 9 }] };
  try { s = take(copy(s), { type: "choose", player, cards: [picked] }); }
  finally { ctx.scripts!.ACTIVE.bySkill[0] = original; }
  if (fault === "missing" || fault === "changed-record" || fault === "changed-rule") { assert.equal(s.outcome?.kind, "interrupted"); assert.equal(s.sides[player].zones.hand.length, before); }
  else { assert.equal(s.sides[player].zones.hand.length, before + 2, "already-activated captured body completes"); assert.ok(s.sides[player].zones.hand.includes(picked)); }
  if (fault === "negate") assert.ok(!skillsShowing(ctx, s, target).skills.some(skill => skill.index === index));
  cases++;
}
for (const player of ["p1", "p2"] as const) {
  let s = fresh(player); const watcher = stage(s, player, "F", "battle"), negator = stage(s, player, "NEGATOR", "battle");
  const effect = grant(s, player, watcher, "ENDER"); const index = copiedSkillIndex(effect.id, 0), before = s.sides[player].zones.hand.length;
  s = take(s, { type: "endMain", player }); assert.equal(s.prompt.kind, "orderPending");
  const first = s.pending.findIndex(item => item.card === negator); assert.ok(first >= 0);
  s = take(s, { type: "orderPending", player, index: first }); assert.equal(s.prompt.kind, "chooseCards");
  s = take(s, { type: "choose", player, cards: [watcher] });
  assert.equal(s.sides[player].zones.hand.length, before, "ordinary pending deleted copy is cancelled before activation");
  assert.ok(!s.outcome); assert.ok(!skillsShowing(ctx, s, watcher).skills.some(skill => skill.index === index)); cases++;
}
for (const player of ["p1", "p2"] as const) for (const fault of ["negate", "expire", "depart"] as const) {
  let s = fresh(player); const watcher = stage(s, player, "F", "battle"), source = stage(s, player, "PLAY", "battle"), incoming = stage(s, player, "F", "hand");
  stage(s, other(player), "COUNTER", "hand");
  const effect = grant(s, player, watcher, "WATCHER", "battle"); const index = copiedSkillIndex(effect.id, 0);
  s = activate(s, player, source);
  if (s.prompt.kind === "chooseCards") s = take(s, { type: "choose", player, cards: [incoming] });
  for (let step = 0; step < 12 && !s.pending.some(item => item.skillIndex === index); step++) {
    if (s.prompt.kind === "chooseCards") s = take(s, { type: "choose", player, cards: [incoming] });
    else { assert.equal(s.prompt.kind, "counter"); s = take(s, { type: "counter", player: (s.prompt as { player: PlayerId }).player, card: null }); }
  }
  const pending = s.pending.find(item => item.kind !== "hook" && item.skillIndex === index)!;
  assert.ok(pending && pending.kind !== "hook"); assert.ok(pending.arrivalWitness); assert.ok(pending.copiedSkillCapture);
  if (fault === "negate") { addEffect(s, [], { target: watcher, master: player, kind: "negateSkills", value: 0, until: "turn" }); endEffects(s, [], "turn"); }
  else if (fault === "expire") endEffects(s, [], "battle");
  else { assert.ok(moveCard(s, game, watcher, "drop", { owner: player }).ok); endEffects(s, [], "battle"); }
  assert.ok(capturedSkillShowing(ctx, s, watcher, index, pending.copiedSkillCapture).skill);
  const before = s.sides[player].zones.hand.length;
  for (let step = 0; step < 12 && s.prompt.kind !== "main" && !s.outcome; step++) {
    const a = RULES.legalActions(ctx, s).find(entry => entry.action.type === "counter" && entry.action.card === null)?.action; assert.ok(a); s = take(s, a);
  }
  assert.equal(s.sides[player].zones.hand.length, before + 1, "R422 witnessed arrival survives later grant deletion/expiry/departure"); assert.ok(!s.outcome); cases++;
}
console.log(`resolved grant deletion native: ${cases} cases passed`);
