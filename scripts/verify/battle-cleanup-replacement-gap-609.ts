/** Independent #609 gap proof on the rules VM. All card text below is synthetic. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { replacementChoices } from "../../src/lib/arena/vm/replace";
import { run } from "../../src/lib/arena/vm/flow";
import type { EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Op } from "../../src/lib/arena/vm/script";

const rules = engineFor("rules");
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const dbs = loaded.definition;
const defs = { ...DEFS,
  WATCH609: card("WATCH609", { skill: "[Auto] When a card in your Combo Area is placed in your Drop Area, choose up to 1 Battle Card in your Combo Area and draw 1 card." }),
  END609: card("END609", { skill: "[Auto] At the end of a battle, draw 1 card." }),
  SUBJECT609: card("SUBJECT609", { comboPower: 5000 }),
  ULT609: card("ULT609", { comboPower: 5000, skill: "[Ultimate]" }),
};
const scripts = rulesFromCompiler(defs);
function auto(id: "WATCH609" | "END609", trigger: "comboToDrop" | "battleEnd", ops: Op[]) {
  const compiled = scripts[id].bySkill[0];
  assert.ok(compiled);
  scripts[id].bySkill[0] = { ...compiled, trigger: [trigger], unsupported: [], price: undefined, ops };
}
// The target is chosen by a real 8-5-7 Auto prompt. The effect changes its
// later rule departure, while the projected subject information was already
// fixed at 8-5-6. This is a synthetic program, not a printed card ruling.
auto("WATCH609", "comboToDrop", [
  { op: "choose", sel: { side: "you", area: "combo", count: 1, upTo: true }, as: "redirected" },
  { op: "replaceLeave", target: { var: "redirected" }, to: "warp", until: "battle" },
  { op: "draw", n: 1 },
]);
auto("END609", "battleEnd", [{ op: "draw", n: 1 }]);
const ctx: EngineContext = { ...CTX, defs, scripts };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
function main(): VmState {
  let s = rules.createGame(ctx, { seed: 60914, p1: { name: "Turn", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
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
function atEnd(s: VmState, attacker: string, guard: string): void {
  s.battle = { attacker, guard, target: guard, step: "battleEnd", negated: false, blockerOffered: false, counters: [] };
  s.phase = "battle";
  s.flow.push({ phase: "battle", index: dbs.phases.battle.steps.indexOf("battleEnd"), repeats: 0 });
  run(ctx, dbs, s, []);
}
function take(s: VmState, action: Parameters<typeof rules.apply>[2]): { state: VmState; events: GameEvent[] } {
  const result = rules.apply(ctx, reload(s), action);
  return { state: result.state as VmState, events: result.events };
}

// Case 1: a legal [Ultimate] route replaces the pre-announced subject's
// ordinary Drop destination. There is no answerable 9-10 prompt in this
// native cleanup path; current code interrupts during projection at 8-5-6.
{
  const s = main();
  const watcher = stage(s, "WATCH609", "p1", "battle");
  const guard = stage(s, "SUBJECT609", "p2", "battle");
  const subject = stage(s, "ULT609", "p1", "combo");
  atEnd(s, watcher, guard);
  assert.equal(s.prompt.kind, "zEnergyFromCombo");
  const after = take(s, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(after.state.outcome?.kind, "interrupted");
  assert.equal(after.state.outcome?.privateContext?.issue, "#609");
  assert.equal(after.events.some((e) => e.type === "skill" && e.card === watcher), false);
  assert.equal(after.events.some((e) => e.type === "move" && e.card === subject), false);
  assert.ok(after.state.sides.p1.zones.combo.includes(subject));
  assert.ok(after.state.battle, "the unresolved projected route does not complete battle cleanup");
}

// Case 2: a legal 8-5-7 choice installs a mandatory redirect after the
// projected Drop information was recorded. The answer survives JSON reload.
// Current native 8-5-8 ignores a timed replacement on a Combo card, moving it
// to Drop anyway; that is an uncovered failure, not a supported ruling.
// A zero-card choice is the control branch for the ordinary checkpoint order.
for (const choose of [true, false]) {
  const s = main();
  const watcher = stage(s, "WATCH609", "p1", "battle");
  const ender = stage(s, "END609", "p1", "battle");
  const guard = stage(s, "SUBJECT609", "p2", "battle");
  const subject = stage(s, "SUBJECT609", "p1", "combo");
  atEnd(s, watcher, guard);
  assert.equal(s.prompt.kind, "zEnergyFromCombo");
  const offered = take(s, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(offered.state.prompt.kind, "chooseCards");
  assert.equal(offered.state.battle?.endCombo?.stage, "preDropCheckpoint");
  assert.ok(offered.state.sides.p1.zones.combo.includes(subject));
  assert.equal(offered.events.some((e) => e.type === "move" && e.card === subject), false);
  assert.equal(offered.events.filter((e) => e.type === "skill" && e.card === watcher).length, 1);
  const after = take(offered.state, { type: "choose", player: "p1", cards: choose ? [subject] : [] });
  assert.equal(after.events.filter((e) => e.type === "skill" && e.card === watcher).length, 0, "the 8-5-7 Auto must not activate twice across reload");
  assert.equal(after.events.filter((e) => e.type === "draw" && e.player === "p1").length >= 1, true);
  assert.ok(!after.state.outcome);
  assert.equal(after.state.prompt.kind, "main");
  assert.ok(after.state.sides.p1.zones.drop.includes(subject));
  const departure = after.events.findIndex((e) => e.type === "move" && e.card === subject && e.from === "combo");
  const battleEnd = after.events.findIndex((e) => e.type === "skill" && e.card === ender);
  assert.ok(departure >= 0 && departure < battleEnd, "8-5-10 battle-end Auto follows the 8-5-8 physical departure");
  if (choose) {
    const installed = after.events.findIndex((e) => e.type === "effect" && e.effect.kind === "replaceLeave" && e.effect.target === subject);
    assert.ok(installed >= 0 && installed < departure, "the chosen replacement was installed before the native departure");
    assert.equal(after.state.sides.p1.zones.warp.includes(subject), false, "current VM ignores this valid Combo departure replacement");
  } else {
    assert.equal(after.state.sides.p1.zones.warp.includes(subject), false);
  }
}

// The native 8-5-8 mover offers no 9-10 answer even when an optional
// replacement is applicable. A normal scripted move would ask its holder.
{
  const s = main();
  const watcher = stage(s, "WATCH609", "p1", "battle");
  const guard = stage(s, "SUBJECT609", "p2", "battle");
  const subject = stage(s, "SUBJECT609", "p1", "combo");
  addEffect(s, [], { source: watcher, master: "p1", target: subject, kind: "replaceLeave",
    value: { to: "warp", optional: true, target: { area: "combo", side: "you" } }, until: "battle" });
  assert.equal(replacementChoices(ctx, dbs, s, subject, undefined, { requestedTo: "drop" }).length, 1);
  atEnd(s, watcher, guard);
  const offered = take(s, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(offered.state.prompt.kind, "chooseCards");
  const after = take(offered.state, { type: "choose", player: "p1", cards: [] });
  assert.equal(after.state.prompt.kind, "main");
  assert.ok(after.state.sides.p1.zones.drop.includes(subject));
  assert.equal(after.events.some((e) => e.type === "move" && e.card === subject && e.to === "warp"), false);
}
console.log("battle-cleanup-replacement-gap-609: current boundaries verified");
