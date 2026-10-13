/** Independent #609 gap proof on the rules VM. All card text below is synthetic. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { replacementChoices } from "../../src/lib/arena/vm/replace";
import { run } from "../../src/lib/arena/vm/flow";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import type { EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Op } from "../../src/lib/arena/vm/script";

const rules = engineFor("rules");
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const dbs = loaded.definition;
const defs = { ...DEFS,
  WATCH609: card("WATCH609", { skill: "[Auto] When a card in your Combo Area is placed in your Drop Area, choose up to 1 Battle Card in your Combo Area and draw 1 card." }),
  WOPT609: card("WOPT609", { skill: "[Auto] When a card in your Combo Area is placed in your Drop Area, choose up to 1 Battle Card in your Combo Area." }),
  END609: card("END609", { skill: "[Auto] At the end of a battle, draw 1 card." }),
  LATE609: card("LATE609", { comboPower: 5000, skill: "[Auto] At the end of the battle after you combo with this card from your hand, draw 1 card." }),
  SUBJECT609: card("SUBJECT609", { comboPower: 5000 }),
  ULT609: card("ULT609", { comboPower: 5000, skill: "[Ultimate]" }),
};
const scripts = rulesFromCompiler(defs);
function auto(id: "WATCH609" | "WOPT609" | "END609" | "LATE609", trigger: "comboToDrop" | "battleEnd" | "comboed", ops: Op[]) {
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
auto("WOPT609", "comboToDrop", [
  { op: "choose", sel: { side: "you", area: "combo", count: 1, upTo: true }, as: "redirected" },
  { op: "replaceLeave", target: { var: "redirected" }, to: "warp", until: "battle" },
  { op: "replaceLeave", target: { var: "redirected" }, to: "hand", until: "battle" },
]);
auto("END609", "battleEnd", [{ op: "draw", n: 1 }]);
auto("LATE609", "comboed", [{ op: "draw", n: 1 }]);
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
function atEnd(s: VmState, attacker: string, guard: string, comboOrigins?: Record<string, "hand" | "other">): void {
  s.battle = { attacker, guard, target: guard, step: "battleEnd", negated: false, blockerOffered: false, counters: [], ...(comboOrigins ? { comboOrigins } : {}) };
  s.phase = "battle";
  s.flow.push({ phase: "battle", index: dbs.phases.battle.steps.indexOf("battleEnd"), repeats: 0 });
  run(ctx, dbs, s, []);
}
// The actual source of the 8-5-10-1 Auto is the substituted subject itself.
// This probe deliberately checks the event order and exact count across a
// deferred move to Drop; a wrong result is a typed/open #609 boundary.
{
  const s = main();
  const source = stage(s, "SUBJECT609", "p1", "battle");
  const ender = stage(s, "END609", "p1", "battle");
  const guard = stage(s, "SUBJECT609", "p2", "battle");
  const subject = stage(s, "LATE609", "p1", "combo");
  const hand = s.sides.p1.zones.hand[0];
  assert.ok(hand);
  addEffect(s, [], { source, master: "p1", target: subject, kind: "replaceLeave",
    value: { optional: true, target: { area: "combo", side: "you" }, ops: [
      { op: "choose", sel: { area: "hand", side: "you", count: 1 }, as: "witness609" },
      { op: "moveTo", target: { sel: { special: "subject" } }, to: "drop" },
    ] }, until: "battle" });
  atEnd(s, source, guard, { [subject]: "hand" });
  const offered = take(s, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(offered.state.prompt.kind, "replaceMove");
  const accepted = take(offered.state, { type: "chooseMode", player: "p1", index: 0 });
  assert.equal(accepted.state.prompt.kind, "chooseCards");
  const after = take(accepted.state, { type: "choose", player: "p1", cards: [hand] });
  assert.equal(after.state.prompt.kind, "orderPending", "both Autos join the 8-5-9 group after the substitute's actual departure");
  assert.equal(after.events.filter((e) => e.type === "move" && e.card === subject && e.from === "combo" && e.to === "drop").length, 1);
  assert.equal(after.events.some((e) => e.type === "skill" && (e.card === subject || e.card === ender)), false);
  assert.equal(after.state.pending.filter((p) => p.kind !== "hook" && p.card === subject && p.trigger === "comboed").length, 1);
  const candidate = after.state.prompt.candidates.find((index) => after.state.pending[index]?.card === ender);
  assert.notEqual(candidate, undefined);
  const ordered = take(after.state, { type: "orderPending", player: "p1", index: candidate! });
  assert.equal(ordered.state.prompt.kind, "main");
  assert.equal(ordered.events.filter((e) => e.type === "skill" && e.card === ender).length, 1);
  assert.equal(ordered.events.filter((e) => e.type === "skill" && e.card === subject).length, 1);
}
// Timed replacements keep the activation's bound variables. Even a
// question-free substitute uses the saved interpreter frame, so its bound
// hand card is moved once rather than an empty variable doing nothing.
{
  const s = main();
  const source = stage(s, "SUBJECT609", "p1", "battle");
  const guard = stage(s, "SUBJECT609", "p2", "battle");
  const subject = stage(s, "SUBJECT609", "p1", "combo");
  const bound = s.sides.p1.zones.hand[0];
  assert.ok(bound);
  addEffect(s, [], { source, master: "p1", target: subject, kind: "replaceLeave",
    value: { optional: true, target: { area: "combo", side: "you" }, vars: { bound609: [bound] },
      ops: [{ op: "moveTo", target: { var: "bound609" }, to: "drop" }] }, until: "battle" });
  atEnd(s, source, guard);
  const offered = take(s, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(offered.state.prompt.kind, "replaceMove");
  const after = take(offered.state, { type: "chooseMode", player: "p1", index: 0 });
  assert.equal(after.state.prompt.kind, "main");
  assert.ok(after.state.sides.p1.zones.combo.includes(subject));
  assert.ok(after.state.sides.p1.zones.drop.includes(bound));
  assert.equal(after.events.filter((e) => e.type === "move" && e.card === bound && e.to === "drop").length, 1);
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

// A pre-existing optional offer also makes the announced destination
// undecidable. It must interrupt before inventing Drop subject information.
{
  const s = main();
  const watcher = stage(s, "WATCH609", "p1", "battle");
  const guard = stage(s, "SUBJECT609", "p2", "battle");
  const subject = stage(s, "SUBJECT609", "p1", "combo");
  addEffect(s, [], { source: watcher, master: "p1", target: subject, kind: "replaceLeave",
    value: { to: "warp", optional: true, target: { area: "combo", side: "you" } }, until: "battle" });
  atEnd(s, watcher, guard);
  const after = take(s, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(after.state.outcome?.privateContext?.issue, "#609");
  assert.ok(after.state.sides.p1.zones.combo.includes(subject));
  assert.equal(after.events.some((e) => e.type === "move" && e.card === subject), false);
}

// Case 2: a legal 8-5-7 choice installs a mandatory redirect after the
// projected Drop information was recorded. The answer survives JSON reload;
// the changed route interrupts before moving the subject or pending battle-
// end effects. A zero-card answer proves ordinary checkpoint order.
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
  if (choose) {
    // The generic Auto resolved at 8-5-7 before any other route existed. The
    // later 8-5-8 event is replaced under 9-10-1; nothing reverses or repeats
    // the resolved Auto, and no Drop arrival is invented.
    assert.ok(after.events.some((e) => e.type === "effect" && e.effect.kind === "replaceLeave" && e.effect.target === subject));
    assert.ok(!after.state.outcome);
    assert.equal(after.state.prompt.kind, "main");
    assert.ok(after.state.sides.p1.zones.warp.includes(subject));
    assert.equal(after.events.filter((e) => e.type === "move" && e.card === subject).length, 1);
    assert.equal(after.events.filter((e) => e.type === "move" && e.card === subject && e.to === "warp").length, 1);
    const departure = after.events.findIndex((e) => e.type === "move" && e.card === subject);
    const battleEnd = after.events.findIndex((e) => e.type === "skill" && e.card === ender);
    assert.ok(departure >= 0 && departure < battleEnd, "8-5-10 battle-end Auto follows the replaced 8-5-8 departure");
    assert.equal(after.events.filter((e) => e.type === "skill" && e.card === ender).length, 1);
  } else {
    assert.ok(!after.state.outcome);
    assert.equal(after.state.prompt.kind, "main");
    assert.ok(after.state.sides.p1.zones.drop.includes(subject));
    const departure = after.events.findIndex((e) => e.type === "move" && e.card === subject && e.from === "combo");
    const battleEnd = after.events.findIndex((e) => e.type === "skill" && e.card === ender);
    assert.ok(departure >= 0 && departure < battleEnd, "8-5-10 battle-end Auto follows the 8-5-8 physical departure");
  }
}

// Case 3: the resolved 8-5-7 Auto installs two competing redirects. The 8-5-8
// event asks the affected subject's master which applies (9-10-2, 9-10-2-1)
// exactly as for a subject with no watcher. The offer survives JSON reload, a
// wrong actor is refused without changing it, neither viewer projection leaks
// internal cleanup progress, and either answer moves the subject once before
// the 8-5-10 battle-end Auto.
for (const warp of [true, false]) {
  const s = main();
  const watcher = stage(s, "WOPT609", "p1", "battle");
  const ender = stage(s, "END609", "p1", "battle");
  const guard = stage(s, "SUBJECT609", "p2", "battle");
  const subject = stage(s, "SUBJECT609", "p1", "combo");
  atEnd(s, watcher, guard);
  const announced = take(s, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(announced.state.prompt.kind, "chooseCards");
  assert.equal(announced.events.filter((e) => e.type === "skill" && e.card === watcher).length, 1);
  const offered = take(announced.state, { type: "choose", player: "p1", cards: [subject] });
  assert.ok(!offered.state.outcome);
  assert.equal(offered.state.prompt.kind, "replaceMove");
  assert.equal(offered.state.prompt.player, "p1");
  assert.equal(offered.state.battle?.endCombo?.stage, "departures");
  assert.equal(offered.state.battle?.endCombo?.awaitingDeparture?.card, subject);
  assert.ok(offered.state.sides.p1.zones.combo.includes(subject));
  assert.equal(offered.events.some((e) => e.type === "move" && e.card === subject), false);
  assert.equal(offered.events.some((e) => e.type === "skill" && e.card === ender), false, "8-5-9 waits for the 8-5-8 answer");
  const frozen = JSON.stringify(offered.state);
  assert.throws(() => rules.apply(ctx, reload(offered.state), { type: "chooseMode", player: "p2", index: 0 }));
  assert.equal(JSON.stringify(offered.state), frozen);
  const legal = rules.legalActions(ctx, reload(offered.state));
  const answers = legal.map((a) => a.action).filter((a) => a.type === "chooseMode");
  assert.ok(answers.length === 2 && answers.every((a) => a.player === "p1"), "only the affected player answers the 8-5-8 question");
  for (const viewer of ["p1", "p2"] as const) {
    const shown = JSON.stringify(buildSnapshot({ id: 609, engine: "rules", mode: "versus", status: "playing", p1Name: "Turn", p2Name: "Other", ctx,
      state: reload(offered.state), legal, log: [], beats: null, spotlight: null,
      spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} }));
    assert.ok(!shown.includes("awaitingDeparture") && !shown.includes("preDropTriggeredSubjects") && !shown.includes("subjectInfo")
      && !shown.includes("cleanupOccurrence"), "internal cleanup progress is not public Snapshot data");
  }
  assert.equal(offered.state.prompt.options.length, 2);
  const after = take(offered.state, { type: "chooseMode", player: "p1", index: warp ? 0 : 1 });
  assert.ok(!after.state.outcome);
  assert.equal(after.state.prompt.kind, "main");
  assert.ok(after.state.sides.p1.zones[warp ? "warp" : "hand"].includes(subject));
  assert.equal(after.events.filter((e) => e.type === "move" && e.card === subject).length, 1);
  assert.equal(after.events.filter((e) => e.type === "skill" && e.card === watcher).length, 0, "the resolved generic Auto is not announced again");
  const departure = after.events.findIndex((e) => e.type === "move" && e.card === subject);
  const battleEnd = after.events.findIndex((e) => e.type === "skill" && e.card === ender);
  assert.ok(departure >= 0 && departure < battleEnd);
  assert.equal(after.events.filter((e) => e.type === "skill" && e.card === ender).length, 1);
}

// A card with no generic watcher still gets its legal optional 9-10 choice
// at native 8-5-8. The prompt and answer survive JSON reload exactly once.
for (const accept of [true, false]) {
  const s = main();
  const watcher = stage(s, "SUBJECT609", "p1", "battle");
  const guard = stage(s, "SUBJECT609", "p2", "battle");
  const subject = stage(s, "SUBJECT609", "p1", "combo");
  addEffect(s, [], { source: watcher, master: "p1", target: subject, kind: "replaceLeave",
    value: { to: "warp", optional: true, target: { area: "combo", side: "you" } }, until: "battle" });
  assert.equal(replacementChoices(ctx, dbs, s, subject, undefined, { requestedTo: "drop" }).length, 1);
  atEnd(s, watcher, guard);
  const offered = take(s, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(offered.state.prompt.kind, "replaceMove");
  assert.equal(offered.state.battle?.endCombo?.stage, "departures");
  assert.equal(offered.state.battle?.endCombo?.awaitingDeparture?.card, subject);
  assert.ok(offered.state.sides.p1.zones.combo.includes(subject));
  const after = take(offered.state, { type: "chooseMode", player: "p1", index: accept ? 0 : 1 });
  assert.equal(after.state.prompt.kind, "main");
  assert.ok(after.state.sides.p1.zones[accept ? "warp" : "drop"].includes(subject));
  assert.equal(after.events.filter((e) => e.type === "move" && e.card === subject).length, 1);
  assert.equal(after.state.battle, null);
}

// One mandatory replacement has no question: the native procedure takes its
// selected route once, while an optional one above is always offered.
{
  const s = main();
  const source = stage(s, "SUBJECT609", "p1", "battle");
  const guard = stage(s, "SUBJECT609", "p2", "battle");
  const subject = stage(s, "SUBJECT609", "p1", "combo");
  addEffect(s, [], { source, master: "p1", target: subject, kind: "replaceLeave",
    value: { to: "warp", target: { area: "combo", side: "you" } }, until: "battle" });
  atEnd(s, source, guard);
  const after = take(s, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(after.state.prompt.kind, "main");
  assert.ok(after.state.sides.p1.zones.warp.includes(subject));
  assert.equal(after.events.filter((e) => e.type === "move" && e.card === subject && e.to === "warp").length, 1);
}

// The native cursor cannot replay the first physical departure when a second
// card's independent offer is answered. A wrong actor or stale option leaves
// the saved first question immutable.
{
  const s = main();
  const source = stage(s, "SUBJECT609", "p1", "battle");
  const guard = stage(s, "SUBJECT609", "p2", "battle");
  const first = stage(s, "SUBJECT609", "p1", "combo");
  const second = stage(s, "SUBJECT609", "p1", "combo");
  addEffect(s, [], { source, master: "p1", target: first, kind: "replaceLeave",
    value: { to: "warp", optional: true, target: { area: "combo", side: "you" } }, until: "battle" });
  atEnd(s, source, guard);
  const firstOffer = take(s, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(firstOffer.state.prompt.kind, "replaceMove");
  assert.equal(firstOffer.state.prompt.card, first);
  const unchanged = JSON.stringify(firstOffer.state);
  assert.throws(() => rules.apply(ctx, reload(firstOffer.state), { type: "chooseMode", player: "p2", index: 0 }));
  assert.throws(() => rules.apply(ctx, reload(firstOffer.state), { type: "chooseMode", player: "p1", index: 2 }));
  assert.equal(JSON.stringify(firstOffer.state), unchanged);
  const accepted = take(firstOffer.state, { type: "chooseMode", player: "p1", index: 0 });
  assert.equal(accepted.state.prompt.kind, "replaceMove");
  assert.equal(accepted.state.prompt.card, second);
  assert.equal(accepted.events.filter((e) => e.type === "move" && e.card === first).length, 1);
  assert.equal(accepted.state.battle?.endCombo?.departureCursor, 1);
  const declined = take(accepted.state, { type: "chooseMode", player: "p1", index: 1 });
  assert.equal(declined.state.prompt.kind, "main");
  assert.equal(declined.events.filter((e) => e.type === "move" && e.card === first).length, 0);
  assert.equal(declined.events.filter((e) => e.type === "move" && e.card === second && e.to === "drop").length, 1);
  assert.ok(declined.state.sides.p1.zones.warp.includes(first));
  assert.ok(declined.state.sides.p1.zones.drop.includes(second));
}

// Two mandatory routes are offered to the affected player, and the chosen
// one remains bound to the same subject across a saved prompt.
{
  const s = main();
  const source = stage(s, "SUBJECT609", "p1", "battle");
  const guard = stage(s, "SUBJECT609", "p2", "battle");
  const subject = stage(s, "SUBJECT609", "p1", "combo");
  for (const to of ["warp", "hand"] as const)
    addEffect(s, [], { source, master: "p1", target: subject, kind: "replaceLeave",
      value: { to, target: { area: "combo", side: "you" } }, until: "battle" });
  atEnd(s, source, guard);
  const offered = take(s, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(offered.state.prompt.kind, "replaceMove");
  assert.equal(offered.state.prompt.options.length, 2);
  const after = take(offered.state, { type: "chooseMode", player: "p1", index: 1 });
  assert.equal(after.state.prompt.kind, "main");
  assert.ok(after.state.sides.p1.zones.hand.includes(subject));
  assert.equal(after.events.filter((e) => e.type === "move" && e.card === subject && e.to === "hand").length, 1);
}

// A substitute keeps the Combo subject and runs through the existing saved
// interpreter frame. Its own question suspends before the 8-5-9 group, and
// answering after JSON reload does not replay the replacement or departure.
{
  const s = main();
  const source = stage(s, "SUBJECT609", "p1", "battle");
  const ender = stage(s, "END609", "p1", "battle");
  const guard = stage(s, "SUBJECT609", "p2", "battle");
  const subject = stage(s, "SUBJECT609", "p1", "combo");
  const hand = s.sides.p1.zones.hand[0];
  assert.ok(hand);
  addEffect(s, [], { source, master: "p1", target: subject, kind: "replaceLeave",
    value: { optional: true, target: { area: "combo", side: "you" }, ops: [
      { op: "choose", sel: { area: "hand", side: "you", count: 1 }, as: "substitute609" },
      { op: "moveTo", target: { var: "substitute609" }, to: "drop" },
    ] }, until: "battle" });
  atEnd(s, source, guard);
  const offered = take(s, { type: "zEnergyFromCombo", player: "p1", card: null });
  assert.equal(offered.state.prompt.kind, "replaceMove");
  const accepted = take(offered.state, { type: "chooseMode", player: "p1", index: 0 });
  assert.equal(accepted.state.prompt.kind, "chooseCards");
  assert.ok(accepted.state.sides.p1.zones.combo.includes(subject));
  assert.equal(accepted.state.battle?.endCombo?.departureCursor, 1);
  assert.equal(accepted.events.some((e) => e.type === "skill" && e.card === ender), false);
  const after = take(accepted.state, { type: "choose", player: "p1", cards: [hand] });
  assert.equal(after.state.prompt.kind, "main");
  assert.ok(after.state.sides.p1.zones.combo.includes(subject));
  assert.ok(after.state.sides.p1.zones.drop.includes(hand));
  assert.equal(after.events.filter((e) => e.type === "move" && e.card === subject).length, 0);
  assert.equal(after.events.filter((e) => e.type === "skill" && e.card === ender).length, 1);
}
console.log("battle-cleanup-replacement-gap-609: current boundaries verified");
