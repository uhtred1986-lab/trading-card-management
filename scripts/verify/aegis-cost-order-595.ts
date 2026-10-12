/** Independent 22-30-3 / 5-8-4 expectations; never derived from the legacy oracle. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { run } from "../../src/lib/arena/vm/flow";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const engine = engineFor("rules");
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;
const defs = { ...DEFS,
  A595: card("A595", { skill: "[Aegis red/blue][Once per turn] {1}" }),
  FREE595: card("FREE595", { skill: "[Aegis red/blue]" }),
  LIVE595: card("LIVE595", { skill: "[Aegis red/blue][Once per turn] {2}<br>[Permanent] Reduce the skill cost of this card by 1." }),
  NORMAL595: card("NORMAL595", { skill: "[Activate: Battle][Once per turn] {1}: Draw 1 card." }),
  BURST595: card("BURST595", { skill: "[Aegis red/blue][Burst 1] {1}" }),
  MULTI595: card("MULTI595", { colors: ["Red", "Blue"], skill: null }),
  RED595: card("RED595", { colors: ["Red"], skill: null }),
  BLUE595: card("BLUE595", { colors: ["Blue"], skill: null }),
  AUTO595: card("AUTO595", { colors: ["Blue"], skill: "[Auto] When this card is placed in your Drop Area from your hand or deck, draw 1 card." }),
};
const scripts = rulesFromCompiler(defs);
// The supported conditional-static DSL makes losing two hand cards remove a
// discount. This is a synthetic rule interaction, not a claimed printed card.
scripts.LIVE595.bySkill[10] = { ...scripts.LIVE595.bySkill[10], unsupported: [], ops: [{ op: "if", cond: { kind: "count", sel: { side: "you", area: "hand" }, atLeast: 4 }, then: [{ op: "costModifier", target: { sel: { special: "self" } }, what: "skill", amount: 1 }] }] };
scripts.AUTO595.bySkill[0] = { ...scripts.AUTO595.bySkill[0], unsupported: [], trigger: ["deckOrHandToDrop"], ops: [{ op: "draw", n: 1 }] };
const ctx: EngineContext = { ...CTX, defs, scripts };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
function apply(s: VmState, action: Action) { return engine.apply(ctx, reload(s), action) as { state: VmState; events: GameEvent[] }; }
function play(s: VmState, ...actions: Action[]): VmState { for (const action of actions) s = apply(s, action).state; return s; }
function stage(s: VmState, id: string, area: "battle" | "energy" | "hand"): string {
  const physical = s.sides.p1.zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: "p1" }).ok);
  return physical;
}
function defense(source = "A595", hand = ["RED595", "RED595", "BLUE595", "BLUE595"], active = ["RED595", "BLUE595"], rested = 2) {
  let s = engine.createGame(ctx, { seed: 595, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = play(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = play(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  assert.equal(s.prompt.kind, "main");
  for (const id of s.sides.p1.zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
  const card = stage(s, source, "battle");
  const cards = hand.map((id) => stage(s, id, "hand"));
  const energy = [...active, ...Array.from({ length: rested }, () => "RED595")].map((id) => stage(s, id, "energy"));
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  energy.slice(active.length).forEach((id) => { s.cards[id].mode = "rest"; });
  s = play(s, { type: "attack", player: "p2", attacker: s.sides.p2.zones.leader[0], target: s.sides.p1.zones.leader[0] }, { type: "pass", player: "p2" });
  assert.equal(s.prompt.kind, "combo");
  return { s, card, cards, energy };
}
function activate(s: VmState, card: string) { return apply(s, { type: "activate", player: "p1", card, skill: 0 }); }
function choose(s: VmState, id: string) { return apply(s, { type: "choose", player: "p1", cards: [id] }); }
function mode(s: VmState, index: number, player: PlayerId = "p1") { return apply(s, { type: "chooseMode", player, index }); }
function skills(ev: GameEvent[], card: string) { return ev.filter((e) => e.type === "skill" && e.card === card); }
function rests(ev: GameEvent[]) { return ev.filter((e) => e.type === "mode" && e.mode === "rest"); }
function declineEffect(s: VmState): VmState { assert.equal(s.prompt.kind, "chooseCards"); return apply(s, { type: "choose", player: "p1", cards: [] }).state; }

// 22-30-3: two mono-color cards precede fee determination/payment; declaring
// does not consume the limit, announce activation, or touch energy. Both hand
// picks and the distinct additional-payment menu survive reload.
{
  const a = defense(); const initialModes = a.energy.map((id) => a.s.cards[id].mode);
  const declared = activate(a.s, a.card); let s = declared.state;
  assert.equal(s.prompt.kind, "chooseCards"); assert.deepEqual(a.energy.map((id) => s.cards[id].mode), initialModes);
  assert.equal(skills(declared.events, a.card).length, 0); assert.deepEqual(s.cards[a.card].usedThisTurn, []);
  const invalidBefore = JSON.stringify(s);
  assert.throws(() => apply(s, { type: "choose", player: "p2", cards: [a.cards[0]] }), IllegalAction);
  assert.throws(() => apply(s, { type: "choose", player: "p1", cards: [] }), IllegalAction);
  assert.equal(JSON.stringify(s), invalidBefore);
  s = choose(s, a.cards[0]).state;
  assert.equal(s.prompt.kind, "chooseCards"); assert.ok(s.sides.p1.zones.hand.includes(a.cards[0]));
  assert.throws(() => choose(s, a.cards[0]), IllegalAction);
  const colorPaid = choose(s, a.cards[2]); s = colorPaid.state;
  assert.equal(s.prompt.kind, "chooseMode"); assert.ok(a.cards.filter((_, i) => i === 0 || i === 2).every((id) => s.sides.p1.zones.drop.includes(id)));
  assert.equal(colorPaid.events.filter((e) => e.type === "move" && e.from === "hand" && e.to === "drop").length, 2);
  assert.equal(rests(colorPaid.events).length, 0); assert.equal(skills(colorPaid.events, a.card).length, 0); assert.deepEqual(s.cards[a.card].usedThisTurn, []);
  const before = JSON.stringify(s);
  assert.throws(() => mode(s, -1), IllegalAction); assert.throws(() => mode(s, 0, "p2"), IllegalAction); assert.equal(JSON.stringify(s), before);
  const reorder = (x: unknown): unknown => Array.isArray(x) ? x.map(reorder) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).reverse().map(([k, v]) => [k, reorder(v)])) : x;
  const paid = mode(reorder(s) as VmState, 0); s = paid.state;
  assert.equal(rests(paid.events).length, 1); assert.equal(skills(paid.events, a.card).length, 1); assert.deepEqual(s.cards[a.card].usedThisTurn, [0]);
  assert.ok(paid.events.findIndex((e) => e.type === "mode" && e.mode === "rest") < paid.events.findIndex((e) => e.type === "skill" && e.card === a.card));
  const after = declineEffect(s); assert.equal(after.prompt.kind, "combo");
  assert.throws(() => mode(after, 0), IllegalAction);
  // A stale resource at the saved fee prompt cannot charge another energy.
  const stale = reload(colorPaid.state); const payer = stale.programs[0].aegisCost!.choices![0].payment.rest[0]; stale.cards[payer].mode = "rest";
  const staleBefore = JSON.stringify(stale); assert.throws(() => mode(stale, 0), IllegalAction); assert.equal(JSON.stringify(stale), staleBefore);
}
// One multicolor card pays only one hand card; fee remains strictly after it.
{
  const a = defense("A595", ["MULTI595", "MULTI595"], ["RED595"]);
  const first = activate(a.s, a.card); assert.equal(skills(first.events, a.card).length, 0);
  const paid = choose(first.state, a.cards[0]);
  assert.equal(paid.state.sides.p1.zones.drop.includes(a.cards[0]), true); assert.ok(paid.state.sides.p1.zones.hand.includes(a.cards[1]));
  const move = paid.events.findIndex((e) => e.type === "move" && e.card === a.cards[0]);
  const rest = paid.events.findIndex((e) => e.type === "mode" && e.mode === "rest");
  const skill = paid.events.findIndex((e) => e.type === "skill" && e.card === a.card);
  assert.ok(move >= 0 && move < rest && rest < skill);
}
// Live after-color determination: four hand cards grant a one-energy discount;
// dropping the pair removes it, so the additional cost is TWO, not the old ONE.
{
  const a = defense("LIVE595", undefined, ["RED595", "RED595"]);
  let s = activate(a.s, a.card).state; s = choose(s, a.cards[0]).state;
  const paid = choose(s, a.cards[2]);
  assert.equal(rests(paid.events).length, 2, "live hand count removes the initial discount");
  assert.equal(skills(paid.events, a.card).length, 1); assert.deepEqual(paid.state.cards[a.card].usedThisTurn, [0]);
}
// 5-8-4: an initially payable discounted fee becomes unaffordable AFTER the
// hand cost. Keep both hand moves; no orb, effect, activation, or limit is used.
{
  const a = defense("LIVE595", undefined, ["RED595"]);
  let s = activate(a.s, a.card).state; s = choose(s, a.cards[0]).state;
  const failed = choose(s, a.cards[2]);
  assert.equal(failed.state.prompt.kind, "combo"); assert.ok([a.cards[0], a.cards[2]].every((id) => failed.state.sides.p1.zones.drop.includes(id)));
  assert.equal(failed.state.cards[a.energy[0]].mode, "active"); assert.equal(rests(failed.events).length, 0);
  assert.equal(skills(failed.events, a.card).length, 0); assert.deepEqual(failed.state.cards[a.card].usedThisTurn, []);
  assert.ok(failed.events.some((e) => e.type === "note" && /Aegis activation failed/.test(e.text)));
}
// A stale color pick must not move a card now outside hand, including the
// previously picked Red that is only moved after the later Blue answer.
{
  const a = defense(); let s = activate(a.s, a.card).state; s = choose(s, a.cards[0]).state;
  assert.ok(moveCard(s, game, a.cards[0], "deck", { owner: "p1" }).ok);
  const before = JSON.stringify(s); assert.throws(() => choose(s, a.cards[2]), IllegalAction); assert.equal(JSON.stringify(s), before);
}
// Unpriced Aegis still pays colors and proceeds directly to its normal effect.
{
  const a = defense("FREE595", ["MULTI595", "MULTI595"], []);
  const paid = choose(activate(a.s, a.card).state, a.cards[0]);
  assert.equal(rests(paid.events).length, 0); assert.equal(skills(paid.events, a.card).length, 1);
  const picked = choose(paid.state, a.energy[0]); const stood = apply(picked.state, { type: "choose", player: "p1", cards: [] }); assert.equal(stood.state.cards[a.energy[0]].mode, "active");
}
// Normal Activate: Battle still charges immediately and draws once.
{
  const a = defense("NORMAL595", [], ["RED595"]); const paid = activate(a.s, a.card);
  assert.equal(paid.state.cards[a.energy[0]].mode, "rest"); assert.equal(paid.events.filter((e) => e.type === "draw").length, 1);
  assert.equal(skills(paid.events, a.card).length, 1); assert.deepEqual(paid.state.cards[a.card].usedThisTurn, [0]);
}
// Actual cost-move Autos are pended until the color AND additional stages
// finish. The effect also finishes before the checkpoint runs the pending Auto.
{
  const a = defense("A595", ["RED595", "RED595", "AUTO595", "BLUE595"]);
  let s = activate(a.s, a.card).state; s = choose(s, a.cards[0]).state;
  const colors = choose(s, a.cards[2]); s = colors.state;
  assert.equal(s.pending.length, 1); assert.equal(colors.events.filter((e) => e.type === "draw").length, 0);
  const fee = mode(s, 0); assert.equal(fee.state.pending.length, 1); assert.equal(fee.events.filter((e) => e.type === "draw").length, 0);
  const done = apply(fee.state, { type: "choose", player: "p1", cards: [] });
  assert.equal(done.events.filter((e) => e.type === "draw").length, 1); assert.equal(done.state.pending.length, 0);
}
// A native Burst is paid after colors and before activation; the pool moves
// from deck to Drop exactly once, with the hidden payment revealed.
{
  const a = defense("BURST595", ["MULTI595", "MULTI595"], ["RED595"]);
  const top = a.s.sides.p1.zones.deck[0];
  const paid = choose(activate(a.s, a.card).state, a.cards[0]);
  assert.equal(paid.state.sides.p1.zones.drop.includes(top), true);
  assert.equal(paid.state.cards[a.energy[0]].mode, "rest");
  assert.equal(skills(paid.events, a.card).length, 1);
  const moves = paid.events.filter((e) => e.type === "move");
  assert.deepEqual(moves.map((e) => [e.from, e.to]), [["hand", "drop"], ["deck", "drop"]]);
  assert.equal(moves[1].reveal, true);
}
// A synthetic declared in-play pool exercises the native cost adapter. It is
// not a printed DBS cost. The strict adapter excludes effect-only routes and
// preserves a mandatory legal redirect + earlier energy payment on failure.
for (const by of ["skill", undefined] as const) {
  const a = defense("A595", ["MULTI595", "MULTI595"], ["RED595"]);
  const declared = activate(a.s, a.card); const s = declared.state;
  const custom = { ...game, costs: { ...game.costs, pool595: { ...game.costs.burst, name: "pool595", amount: "costOf", do: [{ op: "moveTo" as const, target: { sel: { side: "you" as const, area: "battle" as const } }, to: "drop" as const }] } } };
  s.programs[0].aegisCost!.costs = ["energy", "pool595"];
  addEffect(s, [], { target: a.card, kind: "replaceLeave", value: { to: "warp", ...(by ? { by } : {}), target: { special: "self" } }, until: "turn", source: a.card, master: "p1" });
  s.lastChoice = [a.cards[0]]; const ev: GameEvent[] = []; run(ctx, custom, s, ev);
  assert.ok(s.sides.p1.zones[by ? "drop" : "warp"].includes(a.card)); assert.equal(s.cards[a.energy[0]].mode, "rest");
  assert.equal(skills(ev, a.card).length, by ? 1 : 0);
  assert.equal(s.prompt.kind, by ? "chooseCards" : "combo");
}
// Known unsupported additional action prices interrupt before taking colors,
// energy, uses, or activating. The private issue/detail stay out of events.
{
  const old = scripts.A595.bySkill[0];
  try {
    scripts.A595.bySkill[0] = { ...old, price: { ...old.price!, ops: [{ op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "additional" }, { op: "moveTo", target: { var: "additional" }, to: "drop" }] } };
    const a = defense(); const interrupted = activate(a.s, a.card);
    assert.equal(interrupted.state.outcome?.kind, "interrupted"); assert.equal(interrupted.state.outcome?.privateContext?.issue, "#595");
    assert.equal(interrupted.events.filter((e) => e.type === "move" || e.type === "mode" || e.type === "skill").length, 0);
    assert.deepEqual(interrupted.state.cards[a.card].usedThisTurn, []);
    assert.ok(a.cards.every((id) => interrupted.state.sides.p1.zones.hand.includes(id)));
    assert.ok(!JSON.stringify(interrupted.events).includes("additional Aegis action price"));
  } finally { scripts.A595.bySkill[0] = old; }
}
// An affected owner's optional native-pool replacement requires a question;
// this remaining boundary interrupts explicitly rather than declining it.
{
  const a = defense("A595", ["MULTI595", "MULTI595"], ["RED595"]); const s = activate(a.s, a.card).state;
  const custom = { ...game, costs: { ...game.costs, pool595: { ...game.costs.burst, name: "pool595", amount: "costOf", do: [{ op: "moveTo" as const, target: { sel: { side: "you" as const, area: "battle" as const } }, to: "drop" as const }] } } };
  s.programs[0].aegisCost!.costs = ["energy", "pool595"];
  addEffect(s, [], { target: a.card, kind: "replaceLeave", value: { to: "warp", optional: true, target: { special: "self" } }, until: "turn", source: a.card, master: "p1" });
  s.lastChoice = [a.cards[0]]; const ev: GameEvent[] = []; run(ctx, custom, s, ev);
  assert.equal(s.outcome?.kind, "interrupted"); assert.equal(s.outcome?.privateContext?.issue, "#595");
  assert.ok(s.sides.p1.zones.battle.includes(a.card)); assert.ok(s.sides.p1.zones.drop.includes(a.cards[0]));
  assert.equal(skills(ev, a.card).length, 0); assert.deepEqual(s.cards[a.card].usedThisTurn, []);
}
console.log("Aegis #595: color-first cost, live fee, reload, failure, and delayed activation verified");
