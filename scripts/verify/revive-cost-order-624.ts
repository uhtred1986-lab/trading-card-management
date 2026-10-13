/** Independent manual 22-34-3 / 5-8-4 expectations; synthetic rules, no catalog claim. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect, skillNegated } from "../../src/lib/arena/vm/effects";
import { run } from "../../src/lib/arena/vm/flow";
import { keywordProgram, revivePrograms } from "../../src/lib/arena/vm/keyword-do";
import { prepareAutomaticCost } from "../../src/lib/arena/vm/auto-costs";
import { skillsShowing } from "../../src/lib/arena/vm/triggers";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { RulesetBroken } from "../../src/lib/arena/vm/errors";
import { emptyFilter } from "../../src/lib/arena/text/filters";
import type { Action, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { ScriptFrame } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";

const engine = engineFor("rules");
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;
const defs = { ...DEFS,
  REV624: card("REV624", { skill: "[Revive red/blue][Once per turn] {r}" }),
  FREE624: card("FREE624", { skill: "[Revive red/blue]" }),
  TWO624: card("TWO624", { skill: "[Revive red/blue][Once per turn] {2}" }),
  ACTION624: card("ACTION624", { skill: "[Revive red/blue] {r}" }),
  RED624: card("RED624", { colors: ["Red"], skill: null }),
  BLUE624: card("BLUE624", { colors: ["Blue"], skill: null }),
  MULTI624: card("MULTI624", { colors: ["Red", "Blue"], skill: null }),
  GREEN624: card("GREEN624", { colors: ["Green"], skill: null }),
  AUTO624: card("AUTO624", { colors: ["Red"], skill: "[Auto] {r}: When this card is placed in your Drop Area from your hand, draw 1 card." }),
  GENERIC624: card("GENERIC624", { skill: "[Auto] {r}: When you play this card, draw 1 card." }),
  DISCOUNT624: card("DISCOUNT624", { skill: "[Permanent] Reduce the skill cost of your cards by 1." }),
  COUNTER624: card("COUNTER624", { type: "EXTRA", energyCost: 0, skill: "[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played." }),
};
const scripts = rulesFromCompiler(defs);
// Explicit synthetic records exercise already-supported prices and static
// modifiers. They are not asserted as compiler or real-card coverage.
scripts.ACTION624.bySkill[0].price!.ops = [
  { op: "choose", sel: { side: "opponent", area: "battle", count: 1 }, as: "extra624" },
  { op: "moveTo", target: { var: "extra624" }, to: "drop", cause: "cost" },
];
scripts.DISCOUNT624.bySkill[0] = { unsupported: [], ops: [{ op: "if", cond: { kind: "count", sel: { side: "you", area: "hand" }, atLeast: 2 }, then: [{ op: "costModifier", target: { sel: { side: "you", areas: ["drop"], filter: { ...emptyFilter(), names: ["TWO624"] } } }, what: "skill", amount: 1 }] }] };
scripts.AUTO624.bySkill[0] = { ...scripts.AUTO624.bySkill[0], unsupported: [], trigger: ["droppedFromHand"], ops: [{ op: "draw", n: 1 }] };
scripts.GENERIC624.bySkill[0] = { ...scripts.GENERIC624.bySkill[0], unsupported: [], trigger: ["played"], ops: [{ op: "draw", n: 1 }], price: { ...scripts.GENERIC624.bySkill[0].price, condition: null, ops: [
  { op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "generic624" },
  { op: "moveTo", target: { var: "generic624" }, to: "drop", cause: "cost" },
] } };
const ctx: EngineContext = { ...CTX, defs, scripts };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
function apply(s: VmState, action: Action) { return engine.apply(ctx, reload(s), action) as { state: VmState; events: GameEvent[] }; }
function stage(s: VmState, cardId: string, area: string, p: PlayerId = "p1"): string {
  const id = s.sides[p].zones.deck[0]; assert.ok(id);
  s.cards[id].cardId = cardId;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  return id;
}
function fixture(source = "REV624", hand = ["RED624", "BLUE624"], energies = 2) {
  let s = engine.createGame(ctx, { seed: 624, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state;
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = apply(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state;
  assert.equal(s.prompt.kind, "main"); s.turn = 2;
  for (const id of [...s.sides.p1.zones.hand]) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
  const rev = stage(s, source, "battle");
  const cards = hand.map((id) => stage(s, id, "hand"));
  const energy = Array.from({ length: energies }, () => stage(s, "RED624", "energy"));
  return { s, rev, cards, energy };
}
function ko(a: ReturnType<typeof fixture>) {
  let s = a.s; s.cards[a.rev].mode = "rest";
  for (const action of [
    { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    { type: "attack", player: "p2", attacker: s.sides.p2.zones.leader[0], target: a.rev },
    { type: "pass", player: "p2" }, { type: "pass", player: "p1" },
  ] as Action[]) s = apply(s, action).state;
  return s;
}
const choose = (s: VmState, cards: string[]) => apply(s, { type: "choose", player: "p1", cards });
const mode = (s: VmState, index: number, player: PlayerId = "p1") => apply(s, { type: "chooseMode", player, index });
const skillEvents = (ev: GameEvent[], rev: string) => ev.filter((e) => e.type === "skill" && e.card === rev);
const rests = (s: VmState) => s.sides.p1.zones.energy.filter((id) => s.cards[id].mode === "rest").length;
// A declaration change at the cost/effect boundary must fail loudly rather
// than silently moving a new operation across the additional-price step.
{
  const a = fixture();
  const skill = skillsShowing(ctx, a.s, a.rev).skills.find((sk) => sk.index === 0)!;
  const changed = structuredClone(game.keywords.Revive);
  changed.do!.push({ op: "note", text: "new operation after payment" });
  assert.throws(() => revivePrograms(game, changed, skill), RulesetBroken);
  const reordered = structuredClone(game.keywords.Revive);
  const reorderedGate = reordered.do![0];
  if (reorderedGate.op !== "if" || reorderedGate.cond.kind !== "all"
    || reorderedGate.cond.conds[0]?.kind !== "count") throw new Error("Revive declaration shape changed");
  reorderedGate.cond.conds[0].sel = { area: "drop", side: "you", special: "self" };
  assert.equal(revivePrograms(game, reordered, skill).variable, "cost", "JSONB key order cannot break the declared boundary");
  const wrongCoverage = structuredClone(game.keywords.Revive);
  const gate = wrongCoverage.do![0];
  if (gate.op !== "if" || gate.then[1]?.op !== "if" || gate.then[1].then[0]?.op !== "if"
    || gate.then[1].then[0].cond.kind !== "all" || gate.then[1].then[0].cond.conds[0]?.kind !== "covers") throw new Error("Revive declaration shape changed");
  gate.then[1].then[0].cond.conds[0].colors = ["Green"];
  assert.throws(() => revivePrograms(game, wrongCoverage, skill), RulesetBroken);
  const wrongBinding = structuredClone(game.keywords.Revive);
  const gate2 = wrongBinding.do![0];
  if (gate2.op !== "if" || gate2.then[1]?.op !== "if" || gate2.then[1].then[0]?.op !== "if"
    || gate2.then[1].then[0].then[2]?.op !== "play") throw new Error("Revive declaration shape changed");
  gate2.then[1].then[0].then[2].target = { var: "cost" };
  assert.throws(() => revivePrograms(game, wrongBinding, skill), RulesetBroken);
}
function noActivation(s: VmState, ev: GameEvent[], rev: string): void {
  assert.equal(skillEvents(ev, rev).length, 0);
  assert.deepEqual(s.cards[rev].usedThisTurn, []);
  assert.ok(s.sides.p1.zones.drop.includes(rev));
  assert.equal(skillNegated(s, rev, 0, "keyword"), false);
}
function privacy(s: VmState): void {
  for (const viewer of ["p1", "p2"] as const) {
    const snap = buildSnapshot({ id: 624, engine: "rules", mode: "versus", status: "playing", p1Name: "You", p2Name: "Other", ctx, state: s, legal: engine.legalActions(ctx, s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
    assert.equal(snap.view.them.hand, null);
    const wire = JSON.stringify(snap);
    assert.ok(!wire.includes("PRIVATE_624_FRAME_BINDING"));
    assert.ok(!wire.includes('"reviveCost"') && !wire.includes('"autoCost"') && !wire.includes('"programs"'));
    for (const p of ["p1", "p2"] as const) for (const id of [...s.sides[p].zones.life, ...s.sides[p].zones.deck, ...(p !== viewer ? s.sides[p].zones.hand : [])]) {
      assert.ok(!wire.includes(`"id":"${id}"`), `${viewer} received hidden card ${id}`);
    }
    if (s.prompt.kind === "chooseCards" || s.prompt.kind === "chooseMode") assert.equal(snap.legal.length > 0, viewer === s.prompt.player);
  }
}

// An actual battle KO asks original-colour cards first. Reload at both
// colour picks and extra-fee offer; movement precedes energy and activation.
for (const hand of [["RED624", "BLUE624", "GREEN624"], ["MULTI624", "GREEN624"]]) {
  const a = fixture("REV624", hand); let s = ko(a);
  assert.equal(s.prompt.kind, "chooseCards"); assert.equal(rests(s), 0); privacy(s);
  const beforeFrame = s.programs[0];
  const identity = [beforeFrame.card, beforeFrame.master, beforeFrame.trigger, beforeFrame.subject, beforeFrame.skillIndex];
  beforeFrame.vars.private624 = ["PRIVATE_624_FRAME_BINDING"];
  assert.ok(s.prompt.kind === "chooseCards" && !s.prompt.choice.candidates.includes(a.cards.at(-1)!));
  const events: GameEvent[] = [];
  for (const id of a.cards.slice(0, -1)) { const r = choose(s, [id]); s = r.state; events.push(...r.events); }
  if (s.prompt.kind === "chooseCards") { const r = choose(s, []); s = r.state; events.push(...r.events); }
  assert.equal(s.prompt.kind, "chooseMode"); assert.equal(rests(s), 0); noActivation(s, events, a.rev); privacy(s);
  const afterFrame = s.programs[0];
  assert.deepEqual([afterFrame.card, afterFrame.master, afterFrame.trigger, afterFrame.subject, afterFrame.skillIndex], identity);
  assert.deepEqual(afterFrame.vars.cost, a.cards.slice(0, -1));
  assert.deepEqual(afterFrame.vars.private624, ["PRIVATE_624_FRAME_BINDING"]);
  assert.ok(a.cards.slice(0, -1).every((id) => s.sides.p1.zones.drop.includes(id)));
  const paid = mode(s, 0); s = paid.state; events.push(...paid.events);
  assert.equal(rests(s), 1); assert.ok(s.sides.p1.zones.battle.includes(a.rev));
  assert.equal(skillEvents(events, a.rev).length, 1); assert.deepEqual(s.cards[a.rev].usedThisTurn, [0]);
  const colorEnd = events.findLastIndex((e) => e.type === "move" && a.cards.includes(e.card));
  const energyAt = events.findIndex((e) => e.type === "mode" && e.mode === "rest");
  const activateAt = events.findIndex((e) => e.type === "skill" && e.card === a.rev);
  assert.ok(colorEnd >= 0 && colorEnd < energyAt && energyAt < activateAt);
}

// Additional recorded conditions are evaluated on the resulting hand too:
// an initially false condition can become payable, and the reverse fails
// without undoing the declared colour cost or announcing the skill.
for (const afterHand of [true, false]) {
  const old = scripts.REV624.bySkill[0].price!.condition;
  scripts.REV624.bySkill[0].price!.condition = { kind: "count", sel: { side: "you", area: "hand" }, ...(afterHand ? { atMost: 0 } : { atLeast: 2 }) };
  const a = fixture(); let s = ko(a); assert.equal(s.prompt.kind, "chooseCards");
  s = choose(s, [a.cards[0]]).state; const r = choose(s, [a.cards[1]]); s = r.state;
  assert.equal(rests(s), 0); assert.ok(a.cards.every((id) => s.sides.p1.zones.drop.includes(id)));
  if (afterHand) { assert.equal(s.prompt.kind, "chooseMode"); const paid = mode(s, 0); assert.ok(paid.state.sides.p1.zones.battle.includes(a.rev)); }
  else { assert.equal(s.prompt.kind, "main"); noActivation(s, r.events, a.rev); }
  scripts.REV624.bySkill[0].price!.condition = old;
}
// Declines and incomplete original coverage are atomic and consume no fee.
for (const pick of ["empty", "partial", "wrong-colours"] as const) {
  const a = fixture("REV624", ["RED624", "RED624", "BLUE624"]); let s = ko(a); const events: GameEvent[] = [];
  if (pick !== "empty") { const r = choose(s, [a.cards[0]]); s = r.state; events.push(...r.events); }
  const r = choose(s, pick === "wrong-colours" ? [a.cards[1]] : []); s = r.state; events.push(...r.events);
  assert.equal(s.prompt.kind, "main"); assert.equal(rests(s), 0); assert.deepEqual(s.sides.p1.zones.hand, a.cards); noActivation(s, events, a.rev);
}
// A decline of the subsequent fee retains the already-performed hand cost.
{
  const a = fixture(); let s = ko(a); s = choose(s, [a.cards[0]]).state; s = choose(s, [a.cards[1]]).state;
  assert.equal(s.prompt.kind, "chooseMode"); const r = mode(s, s.prompt.kind === "chooseMode" ? s.prompt.options.length - 1 : -1);
  assert.equal(rests(r.state), 0); assert.ok(a.cards.every((id) => r.state.sides.p1.zones.drop.includes(id))); noActivation(r.state, r.events, a.rev);
}
// Invalid answers and stale saved candidates cannot move a card from another
// zone; a previously selected card is checked as well as the next answer.
{
  const a = fixture("REV624", ["RED624", "BLUE624", "GREEN624"]); let s = ko(a); const before = JSON.stringify(s);
  assert.throws(() => choose(s, [a.cards[2]]), IllegalAction); assert.throws(() => mode(s, 0), IllegalAction); assert.equal(JSON.stringify(s), before);
  for (const earlier of [false, true]) {
    const stale = earlier ? choose(s, [a.cards[0]]).state : reload(s);
    assert.ok(moveCard(stale, game, a.cards[0], "deck", { owner: "p1" }).ok); const unchanged = JSON.stringify(stale);
    assert.throws(() => choose(stale, [a.cards[earlier ? 1 : 0]]), /no longer available/); assert.equal(JSON.stringify(stale), unchanged);
  }
  s = choose(s, [a.cards[0]]).state; s = choose(s, [a.cards[1]]).state;
  const payer = s.programs[0].autoCost!.choices[0].payment.rest[0]; s.cards[payer].mode = "rest";
  const unchanged = JSON.stringify(s); assert.throws(() => mode(s, 0), /no longer payable/); assert.equal(JSON.stringify(s), unchanged);
}
// A live hand-count discount ends when the colours leave. Planning happens
// after those departures; late unaffordability retains them without use.
for (const energies of [1, 2]) {
  const a = fixture("TWO624", undefined, energies); stage(a.s, "DISCOUNT624", "battle"); let s = ko(a);
  s = choose(s, [a.cards[0]]).state; const colors = choose(s, [a.cards[1]]); s = colors.state;
  assert.ok(a.cards.every((id) => s.sides.p1.zones.drop.includes(id))); assert.equal(rests(s), 0);
  if (energies === 1) { assert.equal(s.prompt.kind, "main"); noActivation(s, colors.events, a.rev); assert.ok(colors.events.some((e) => e.type === "note" && /unaffordable/.test(e.text))); }
  else { assert.equal(s.prompt.kind, "chooseMode"); const paid = mode(s, 0); assert.equal(rests(paid.state), 2); assert.equal(skillEvents(paid.events, a.rev).length, 1); }
}

// Supported additional action prices retain the affected opponent's optional
// replacement question. Refusal keeps hand costs and paid energy but never
// activates Revive; a mandatory known failure leaves only the hand costs.
// The selected hand-cost replacement is honoured before the additional
// price. A redirected card cannot count as the declared Drop payment.
{
  const a = fixture();
  addEffect(a.s, [], { source: a.cards[0], master: "p1", target: a.cards[0], kind: "replaceLeave", value: { to: "warp", optional: true }, until: "game" });
  let s = ko(a); s = choose(s, [a.cards[0]]).state; s = choose(s, [a.cards[1]]).state;
  assert.equal(s.prompt.kind, "replaceMove");
  assert.ok(s.prompt.kind === "replaceMove" && s.prompt.player === "p1");
  assert.equal(rests(s), 0); privacy(s);
  const atChoice = s;
  const redirected = mode(atChoice, 0); s = redirected.state;
  assert.ok(s.sides.p1.zones.warp.includes(a.cards[0]), "accepted hand-cost replacement must move its card to Warp");
  assert.equal(rests(s), 0); noActivation(s, redirected.events, a.rev);
  assert.equal(s.prompt.kind, "main");
  const allowed = mode(atChoice, 1); s = allowed.state;
  assert.equal(s.prompt.kind, "chooseMode");
  assert.ok(s.sides.p1.zones.drop.includes(a.cards[0]) && s.sides.p1.zones.drop.includes(a.cards[1]));
  assert.equal(rests(s), 0); noActivation(s, allowed.events, a.rev);
  const paid = mode(s, 0); assert.equal(rests(paid.state), 1);
  assert.equal(skillEvents(paid.events, a.rev).length, 1);
}
for (const optional of [true, false]) {
  const a = fixture();
  addEffect(a.s, [], { source: a.cards[1], master: "p1", target: a.cards[1], kind: "replaceLeave", value: { to: "warp", ...(optional ? { optional: true } : {}) }, until: "game" });
  let s = ko(a); s = choose(s, [a.cards[0]]).state;
  const answered = choose(s, [a.cards[1]]); s = answered.state;
  if (optional) { assert.equal(s.prompt.kind, "replaceMove"); s = mode(s, 0).state; }
  assert.ok(s.sides.p1.zones.drop.includes(a.cards[0]), "an earlier color cost remains paid");
  assert.ok(s.sides.p1.zones.warp.includes(a.cards[1]));
  assert.equal(rests(s), 0); assert.equal(s.prompt.kind, "main");
  noActivation(s, answered.events, a.rev);
}
{
  const a = fixture();
  addEffect(a.s, [], { source: a.cards[0], master: "p1", target: a.cards[0], kind: "replaceLeave", value: { optional: true, ops: [
    { op: "choose", sel: { side: "you", area: "hand", count: 1, upTo: true }, as: "handSub624" },
  ] }, until: "game" });
  let s = ko(a); s = choose(s, [a.cards[0]]).state; s = choose(s, [a.cards[1]]).state;
  assert.equal(s.prompt.kind, "replaceMove");
  const substituted = mode(s, 0); s = substituted.state;
  assert.equal(s.prompt.kind, "chooseCards");
  assert.ok(s.prompt.kind === "chooseCards" && s.prompt.player === "p1");
  assert.deepEqual(s.sides.p1.zones.hand, a.cards);
  assert.equal(rests(s), 0); noActivation(s, substituted.events, a.rev);
  assert.ok(!s.programs.some((f) => f.reviveCost || f.autoCost));
  // #720: a taken voluntary substitute owes its choice in full (9-10-3-1).
  assert.throws(() => choose(s, []), IllegalAction);
  s = choose(s, [a.cards[1]]).state; assert.equal(s.prompt.kind, "main");
}
// The shared Auto action-price runner must also honour a selected hand route.
// Here a generic played Auto's hand discard is redirected after its Red energy
// is spent; the attempted price fails, so its draw never runs.
{
  const a = fixture("FREE624", ["GREEN624"], 1);
  const source = stage(a.s, "GENERIC624", "battle");
  addEffect(a.s, [], { source: a.cards[0], master: "p1", target: a.cards[0], kind: "replaceLeave", value: { to: "warp", optional: true }, until: "game" });
  a.s.pending.push({ card: source, master: "p1", skillIndex: 0, trigger: "played" });
  run(ctx, game, a.s, []);
  assert.equal(a.s.prompt.kind, "chooseMode");
  const offered = mode(a.s, 0); let s = offered.state;
  assert.equal(s.prompt.kind, "replaceMove"); assert.equal(rests(s), 1);
  const redirected = mode(s, 0); s = redirected.state;
  assert.ok(s.sides.p1.zones.warp.includes(a.cards[0])); assert.equal(rests(s), 1);
  assert.equal(redirected.events.some((e) => e.type === "draw"), false);
  assert.equal(skillEvents(redirected.events, source).length, 0);
}
for (const replacement of ["optional", "mandatory", "effect-only"] as const) {
  const a = fixture("ACTION624"); const target = stage(a.s, "V1", "battle", "p2");
  addEffect(a.s, [], { source: target, master: "p2", target, kind: "replaceLeave", value: { to: "warp", ...(replacement === "optional" ? { optional: true } : {}), ...(replacement === "effect-only" ? { by: "skill" } : {}) }, until: "game" });
  let s = ko(a); s = choose(s, [a.cards[0]]).state; const colorPaid = choose(s, [a.cards[1]]); s = colorPaid.state;
  assert.ok(a.cards.every((id) => s.sides.p1.zones.drop.includes(id))); assert.equal(rests(s), 0);
  if (replacement === "mandatory") {
    assert.equal(s.prompt.kind, "main"); noActivation(s, colorPaid.events, a.rev); assert.ok(s.sides.p2.zones.battle.includes(target)); continue;
  }
  const opened = mode(s, 0); s = opened.state;
  assert.equal(rests(s), 1);
  if (replacement === "optional") {
    assert.equal(s.prompt.kind, "replaceMove"); assert.ok(s.prompt.kind === "replaceMove" && s.prompt.player === "p2");
    noActivation(s, opened.events, a.rev); privacy(s);
    const failed = mode(s, 0, "p2");
    assert.ok(failed.state.sides.p2.zones.warp.includes(target)); assert.equal(rests(failed.state), 1); noActivation(failed.state, failed.events, a.rev);
    assert.equal(failed.state.prompt.kind, "main"); assert.ok(failed.events.some((e) => e.type === "note" && /payment to fail/.test(e.text)));
    const completed = mode(s, s.prompt.kind === "replaceMove" ? s.prompt.options.length - 1 : -1, "p2");
    assert.ok(completed.state.sides.p1.zones.battle.includes(a.rev)); assert.ok(completed.state.sides.p2.zones.drop.includes(target)); assert.equal(skillEvents(completed.events, a.rev).length, 1);
  } else { assert.ok(s.sides.p2.zones.drop.includes(target)); assert.ok(s.sides.p1.zones.battle.includes(a.rev)); }
}
// Failure on a later additional action instruction preserves an earlier
// action payment too. The multi-target movement cursor survives reload.
{
  const old = scripts.ACTION624.bySkill[0].price!.ops;
  scripts.ACTION624.bySkill[0].price!.ops = [
    { op: "choose", sel: { side: "opponent", area: "battle", count: 2 }, as: "extra624" },
    { op: "moveTo", target: { var: "extra624" }, to: "drop", cause: "cost" },
  ];
  const a = fixture("ACTION624"); const first = stage(a.s, "V1", "battle", "p2"), second = stage(a.s, "V1", "battle", "p2");
  addEffect(a.s, [], { source: second, master: "p2", target: second, kind: "replaceLeave", value: { to: "warp", optional: true }, until: "game" });
  let s = ko(a); s = choose(s, [a.cards[0]]).state; s = choose(s, [a.cards[1]]).state; const opened = mode(s, 0); s = opened.state;
  assert.equal(s.prompt.kind, "replaceMove"); assert.ok(s.sides.p2.zones.drop.includes(first)); assert.equal(rests(s), 1); noActivation(s, opened.events, a.rev);
  const failed = mode(s, 0, "p2"); assert.ok(failed.state.sides.p2.zones.drop.includes(first)); assert.ok(failed.state.sides.p2.zones.warp.includes(second));
  assert.equal(rests(failed.state), 1); noActivation(failed.state, failed.events, a.rev);
  scripts.ACTION624.bySkill[0].price!.ops = old;
}
// A valid replacement substitute still runs its deferred question after
// canceling activation. There is no abandoned cost frame to resurrect from.
{
  const a = fixture("ACTION624"); const target = stage(a.s, "V1", "battle", "p2");
  addEffect(a.s, [], { source: target, master: "p2", target, kind: "replaceLeave", value: { optional: true, ops: [{ op: "choose", sel: { side: "you", area: "hand", count: 1, upTo: true }, as: "sub624" }] }, until: "game" });
  let s = ko(a); s = choose(s, [a.cards[0]]).state; s = choose(s, [a.cards[1]]).state; s = mode(s, 0).state;
  assert.equal(s.prompt.kind, "replaceMove"); const failed = mode(s, 0, "p2"); s = failed.state;
  assert.equal(s.prompt.kind, "chooseCards"); assert.ok(s.prompt.kind === "chooseCards" && s.prompt.player === "p2");
  assert.ok(s.sides.p2.zones.battle.includes(target)); noActivation(s, failed.events, a.rev);
  assert.ok(!s.programs.some((f) => f.reviveCost || f.autoCost));
  // #720: a taken voluntary substitute owes its choice in full (9-10-3-1).
  const owed = s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates.slice(0, 1) : [];
  assert.equal(owed.length, 1); assert.throws(() => apply(s, { type: "choose", player: "p2", cards: [] }), IllegalAction);
  s = apply(s, { type: "choose", player: "p2", cards: owed }).state; assert.equal(s.prompt.kind, "main"); assert.ok(s.sides.p1.zones.drop.includes(a.rev));
}
// Cost-triggered Autos remain pending through the additional cost prompt,
// resolve only after this continuation pays or fails, and pay independently.
for (const payRevive of [true, false]) {
  const a = fixture("REV624", ["AUTO624", "BLUE624"]); let s = ko(a);
  s = choose(s, [a.cards[0]]).state; const colors = choose(s, [a.cards[1]]); s = colors.state;
  assert.equal(s.prompt.kind, "chooseMode"); assert.ok(s.pending.some((p) => p.card === a.cards[0]));
  assert.equal(colors.events.some((e) => e.type === "draw"), false); assert.equal(s.programs[0].card, a.rev); privacy(s);
  const answer = mode(s, payRevive ? 0 : s.prompt.kind === "chooseMode" ? s.prompt.options.length - 1 : -1); s = answer.state;
  assert.equal(s.prompt.kind, "chooseMode"); assert.equal(s.programs[0].card, a.cards[0]);
  assert.equal(answer.events.some((e) => e.type === "draw"), false); assert.equal(skillEvents(answer.events, a.rev).length, payRevive ? 1 : 0);
  const costAuto = mode(s, 0); assert.equal(costAuto.events.filter((e) => e.type === "draw").length, 1); assert.equal(rests(costAuto.state), payRevive ? 2 : 1);
}
// Revive's negation and Counter: Play effect occur only after completed costs.
// The counter may replace the paid play; rejecting its window lets it land.
for (const counter of [true, false]) {
  const a = fixture(); const stop = stage(a.s, "COUNTER624", "hand", "p2"); let s = ko(a);
  s = choose(s, [a.cards[0]]).state; s = choose(s, [a.cards[1]]).state; assert.equal(skillNegated(s, a.rev, 0, "keyword"), false);
  const paid = mode(s, 0); s = paid.state; assert.equal(s.prompt.kind, "counter"); assert.ok(s.prompt.kind === "counter" && s.prompt.window === "play");
  assert.equal(rests(s), 1); assert.equal(skillEvents(paid.events, a.rev).length, 1); assert.equal(skillNegated(s, a.rev, 0, "keyword"), true);
  assert.ok(s.sides.p1.zones.drop.includes(a.rev)); privacy(s);
  const answered = apply(s, { type: "counter", player: "p2", card: counter ? stop : null, ...(counter ? { skill: 0 } : {}) }); s = answered.state;
  assert.equal(rests(s), 1); assert.equal(skillEvents(answered.events, a.rev).length, 0);
  assert.ok(s.sides.p1.zones[counter ? "drop" : "battle"].includes(a.rev));
}
// Initial negation suppresses the KO trigger; successful unpriced Revive's
// individual negation prevents another hand payment on the same turn's KO.
{
  const a = fixture("FREE624", ["RED624", "BLUE624", "RED624", "BLUE624"]);
  addEffect(a.s, [], { source: a.rev, target: a.rev, kind: "negateSkill", value: 0, until: "game" });
  const suppressed = ko(a); assert.equal(suppressed.prompt.kind, "main"); assert.deepEqual(suppressed.sides.p1.zones.hand, a.cards); assert.equal(rests(suppressed), 0);
  const b = fixture("FREE624", ["RED624", "BLUE624", "RED624", "BLUE624"]); let s = ko(b);
  s = choose(s, [b.cards[0]]).state; const paid = choose(s, [b.cards[1]]); s = paid.state;
  assert.equal(skillEvents(paid.events, b.rev).length, 1); assert.equal(rests(s), 0); assert.equal(skillNegated(s, b.rev, 0, "keyword"), true);
  s.cards[b.rev].mode = "rest"; const attacker = stage(s, "V1", "battle", "p2"); const hand = [...s.sides.p1.zones.hand];
  s = apply(s, { type: "attack", player: "p2", attacker, target: b.rev }).state;
  s = apply(s, { type: "pass", player: "p2" }).state; const second = apply(s, { type: "pass", player: "p1" });
  assert.equal(second.state.prompt.kind, "main"); assert.deepEqual(second.state.sides.p1.zones.hand, hand); assert.equal(skillEvents(second.events, b.rev).length, 0);
}
// Unsupported extra instruction shapes interrupt explicitly after the hand
// cost, before energy or activation. The generic #549 boundary stays honest.
{
  const old = scripts.ACTION624.bySkill[0].price!.ops; scripts.ACTION624.bySkill[0].price!.ops = [{ op: "draw", n: 1 }];
  const a = fixture("ACTION624"); let s = ko(a); s = choose(s, [a.cards[0]]).state; const r = choose(s, [a.cards[1]]); s = r.state;
  assert.equal(s.prompt.kind, "gameOver"); assert.equal(s.outcome?.kind, "interrupted"); assert.equal(s.outcome?.privateContext?.issue, "#549");
  assert.equal(rests(s), 0); assert.ok(a.cards.every((id) => s.sides.p1.zones.drop.includes(id))); noActivation(s, r.events, a.rev);
  assert.equal(r.events.some((e) => e.type === "draw"), false); scripts.ACTION624.bySkill[0].price!.ops = old;
}
// Compatibility: version-10 states with an already-paid generic Revive
// frame retain that exact stored program/history. No migration can reorder
// a committed resource payment or charge it again after the hand choice.
{
  const a = fixture(); assert.ok(moveCard(a.s, game, a.rev, "drop", { owner: "p1" }).ok);
  const showing = skillsShowing(ctx, a.s, a.rev); const skill = showing.skills.find((sk) => sk.index === 0)!; const script = showing.scripts.bySkill[0];
  const frame: ScriptFrame = { ops: keywordProgram(game, game.keywords.Revive, skill), ip: 0, vars: { legacyBinding624: [a.cards[0]] }, card: a.rev, master: "p1", trigger: "koed", subject: a.rev, skillIndex: 0 };
  const autoCost = prepareAutomaticCost(ctx, game, a.s, frame, skill, script);
  a.s.programs.unshift({ ...frame, ops: script.price?.ops ?? [], autoCost }); run(ctx, game, a.s, []);
  const opened = mode(a.s, 0); let s = opened.state; assert.equal(rests(s), 1); assert.equal(s.prompt.kind, "chooseCards");
  assert.ok(!s.programs[0].reviveCost); assert.deepEqual(s.programs[0].vars.legacyBinding624, [a.cards[0]]); assert.equal(s.version, 10);
  s = choose(s, [a.cards[0]]).state; const finished = choose(s, [a.cards[1]]); assert.equal(rests(finished.state), 1);
  assert.ok(finished.state.sides.p1.zones.battle.includes(a.rev)); assert.equal(skillEvents(finished.events, a.rev).length, 0, "legacy frame was already announced at its paid boundary");
}
console.log("Revive #624: colour-first live fee; declines/stale/reload/privacy; replacements, pending Autos, negation/counters and old-frame history verified");
