/** Independent 22-30-3 / 5-8-4 expectations; never derived from the legacy oracle. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { run } from "../../src/lib/arena/vm/flow";
import { emptyFilter } from "../../src/lib/arena/text/filters";
import oldAdditional from "./fixtures/aegis-595-old-additional.json";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const engine = RULES;
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
  GRANT595: card("GRANT595", { skill: "[Permanent] Once per turn you can use a Battle Card as energy for Aegis." }),
  PAYER595: card("PAYER595", { skill: null }),
};
const scripts = rulesFromCompiler(defs);
// The supported conditional-static DSL makes losing two hand cards remove a
// discount. This is a synthetic rule interaction, not a claimed printed card.
scripts.LIVE595.bySkill[10] = { ...scripts.LIVE595.bySkill[10], unsupported: [], ops: [{ op: "if", cond: { kind: "count", sel: { side: "you", area: "hand" }, atLeast: 4 }, then: [{ op: "costModifier", target: { sel: { special: "self" } }, what: "skill", amount: 1 }] }] };
scripts.AUTO595.bySkill[0] = { ...scripts.AUTO595.bySkill[0], unsupported: [], trigger: ["deckOrHandToDrop"], ops: [{ op: "draw", n: 1 }] };
scripts.GRANT595.bySkill[0] = { ...scripts.GRANT595.bySkill[0], unsupported: [], ops: [{ op: "payWith", target: { sel: { side: "you", area: "battle", filter: { ...emptyFilter(), names: ["PAYER595"] } } }, forSkillsOf: { ...emptyFilter(), names: ["A595"] }, oncePerTurn: true, max: 1 }] };
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
// Captured at fccead5 with Aegis source identical to ed44cb0. The owner
// removed legacy-save compatibility on 19 Oct (#907/#1066): this frame has
// no typed payment contract and must require rebuilding, never resume freely.
{
  assert.equal(oldAdditional.source, "ed44cb0");
  assert.equal(oldAdditional.runtimeHead, "fccead5");
  const old = reload(oldAdditional.state as unknown as VmState);
  assert.equal(old.prompt.kind, "chooseMode"); assert.equal(old.programs[0].aegisCost?.stage, "additional");
  assert.ok([oldAdditional.cards[0], oldAdditional.cards[2]].every((id) => old.sides.p1.zones.drop.includes(id)));
  const before = JSON.stringify(old);
  // #1071: the frame also predates the typed usage record, which is read first, so the engine ends such a save as an
  // interrupted game (the convention of absorb-identity-923) instead of throwing mid-move. Either way it never resumes.
  const refused = mode(old, 0);
  assert.equal(refused.state.outcome?.kind, "interrupted", "the obsolete save is interrupted, never resumed");
  assert.equal(refused.state.sides.p1.zones.energy.filter((id) => refused.state.cards[id].mode === "rest").length, old.sides.p1.zones.energy.filter((id) => old.cards[id].mode === "rest").length, "and no energy was charged");
  assert.equal(JSON.stringify(old), before, "rejected obsolete save remains unchanged");
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
// The additional action price begins after the colored hand cards and native
// fee, retains its choice across reload, and binds the chosen card to the cost.
{
  const old = scripts.A595.bySkill[0];
  try {
    scripts.A595.bySkill[0] = { ...old, price: { ...old.price!, ops: [{ op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "additional" }, { op: "moveTo", target: { var: "additional" }, to: "drop" }] } };
    const a = defense(); let s = activate(a.s, a.card).state;
    s = choose(s, a.cards[0]).state;
    const colors = choose(s, a.cards[2]); s = colors.state;
    assert.equal(s.prompt.kind, "chooseMode"); assert.equal(skills(colors.events, a.card).length, 0);
    const native = mode(s, 0); s = native.state;
    assert.equal(s.prompt.kind, "chooseCards"); assert.equal(rests(native.events).length, 1);
    assert.equal(skills(native.events, a.card).length, 0);
    const saved = reload(s); assert.ok(saved.programs[0].aegisCost); assert.equal(saved.programs[0].aegisCost!.stage, "action");
    const paid = choose(saved, a.cards[1]);
    assert.ok(paid.state.sides.p1.zones.drop.includes(a.cards[1]));
    assert.equal(skills(paid.events, a.card).length, 1);
    assert.equal(paid.events.filter((e) => e.type === "mode" && e.mode === "rest").length, 0);
    assert.deepEqual(paid.state.cards[a.card].usedThisTurn, [0]);
    assert.throws(() => choose(s, a.cards[0]), IllegalAction, "a color card already paid cannot be reused as the action price");
    const stale = reload(s); assert.ok(moveCard(stale, game, a.cards[1], "deck", { owner: "p1" }).ok);
    const before = JSON.stringify(stale); assert.throws(() => choose(stale, a.cards[1]), IllegalAction);
    assert.equal(JSON.stringify(stale), before, "a stale action-price answer cannot replay native payment");
  } finally { scripts.A595.bySkill[0] = old; }
}
// An action-price card that disappears with the colored cost leaves the
// additional price known unaffordable. Keep the actual color payment only.
{
  const old = scripts.A595.bySkill[0];
  try {
    scripts.A595.bySkill[0] = { ...old, price: { ...old.price!, ops: [{ op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "additional" }, { op: "moveTo", target: { var: "additional" }, to: "drop" }] } };
    const a = defense("A595", ["RED595", "BLUE595"], ["RED595"]);
    const failed = choose(activate(a.s, a.card).state, a.cards[0]); const s = failed.state;
    assert.equal(s.prompt.kind, "combo"); assert.ok(a.cards.every((id) => s.sides.p1.zones.drop.includes(id)));
    assert.equal(s.cards[a.energy[0]].mode, "active"); assert.equal(skills(failed.events, a.card).length, 0);
    assert.deepEqual(s.cards[a.card].usedThisTurn, []);
  } finally { scripts.A595.bySkill[0] = old; }
}
// An action price with two separate departures suspends between them. Its
// first actual payment and the earlier native fee survive the saved frame;
// finishing the second instruction activates exactly once.
{
  const old = scripts.A595.bySkill[0];
  try {
    scripts.A595.bySkill[0] = { ...old, price: { ...old.price!, ops: [
      { op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "firstExtra" },
      { op: "moveTo", target: { var: "firstExtra" }, to: "drop" },
      { op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "secondExtra" },
      { op: "moveTo", target: { var: "secondExtra" }, to: "drop" },
    ] } };
    const a = defense("A595", ["RED595", "BLUE595", "RED595", "BLUE595", "RED595"], ["RED595"]);
    let s = activate(a.s, a.card).state; s = choose(s, a.cards[0]).state; s = choose(s, a.cards[1]).state;
    assert.equal(s.prompt.kind, "chooseCards");
    const first = choose(s, a.cards[2]); s = first.state;
    assert.equal(s.prompt.kind, "chooseCards"); assert.ok(s.sides.p1.zones.drop.includes(a.cards[2]));
    assert.equal(skills(first.events, a.card).length, 0); assert.deepEqual(s.cards[a.card].usedThisTurn, []);
    const finished = choose(reload(s), a.cards[3]);
    assert.ok(finished.state.sides.p1.zones.drop.includes(a.cards[3]));
    assert.equal(skills(finished.events, a.card).length, 1);
    assert.equal(rests(finished.events).length, 0, "native energy must not be charged again after reload");
    assert.deepEqual(finished.state.cards[a.card].usedThisTurn, [0]);
  } finally { scripts.A595.bySkill[0] = old; }
}
// A synthetic in-play pool prompts its affected owner for an optional route.
// Keeping the requested destination completes payment; choosing Warp performs
// a legal replacement, retains the earlier energy, then fails activation.
{
  for (const replacement of [false, true]) {
    const a = defense("A595", ["MULTI595", "MULTI595"], ["RED595"]); const s = activate(a.s, a.card).state;
    const custom = { ...game, costs: { ...game.costs, pool595: { ...game.costs.burst, name: "pool595", amount: "costOf", do: [{ op: "moveTo" as const, target: { sel: { side: "you" as const, area: "battle" as const } }, to: "drop" as const }] } } };
    s.programs[0].aegisCost!.costs = ["energy", "pool595"];
    addEffect(s, [], { target: a.card, kind: "replaceLeave", value: { to: "warp", optional: true, target: { special: "self" } }, until: "turn", source: a.card, master: "p1" });
    s.lastChoice = [a.cards[0]]; const ev: GameEvent[] = []; run(ctx, custom, s, ev);
    assert.equal(s.prompt.kind, "replaceMove"); assert.equal(s.prompt.player, "p1");
    assert.equal(s.cards[a.energy[0]].mode, "rest"); assert.equal(skills(ev, a.card).length, 0);
    const persisted = reload(s); persisted.lastMode = replacement ? 0 : 1; const next: GameEvent[] = []; run(ctx, custom, persisted, next);
    assert.ok(persisted.sides.p1.zones[replacement ? "warp" : "drop"].includes(a.card));
    assert.equal(skills(next, a.card).length, replacement ? 0 : 1);
    assert.deepEqual(persisted.cards[a.card].usedThisTurn, replacement ? [] : [0]);
    assert.equal(persisted.cards[a.energy[0]].mode, "rest");
  }
}
// Two competing answers to the same native pool departure are put to the
// affected owner. A same-destination route pays; a redirect fails after any
// earlier native payment, and neither route can activate the skill twice.
for (const index of [0, 1]) {
  const a = defense("A595", ["MULTI595", "MULTI595"], ["RED595"]); const s = activate(a.s, a.card).state;
  const custom = { ...game, costs: { ...game.costs, pool595: { ...game.costs.burst, name: "pool595", amount: "costOf", do: [{ op: "moveTo" as const, target: { sel: { side: "you" as const, area: "battle" as const } }, to: "drop" as const }] } } };
  s.programs[0].aegisCost!.costs = ["energy", "pool595"];
  addEffect(s, [], { target: a.card, kind: "replaceLeave", value: { to: "drop", target: { special: "self" } }, until: "turn", source: a.card, master: "p1" });
  addEffect(s, [], { target: a.card, kind: "replaceLeave", value: { to: "warp", target: { special: "self" } }, until: "turn", source: a.card, master: "p1" });
  s.lastChoice = [a.cards[0]]; run(ctx, custom, s, []);
  assert.equal(s.prompt.kind, "replaceMove"); assert.equal(s.prompt.options.length, 2);
  const saved = reload(s); saved.lastMode = index; const ev: GameEvent[] = []; run(ctx, custom, saved, ev);
  assert.ok(saved.sides.p1.zones[index === 0 ? "drop" : "warp"].includes(a.card));
  assert.equal(skills(ev, a.card).length, index === 0 ? 1 : 0);
  assert.equal(saved.cards[a.energy[0]].mode, "rest");
}
// A two-card synthetic native pool suspends on each physical departure. The
// saved cursor never replays the first card. A later card controlled by the
// other player, or no longer in the declared mode, is a stale payment even
// though its area string still reads "battle".
{
  const a = defense("A595", ["MULTI595", "MULTI595"], ["RED595"]);
  const second = stage(a.s, "PAYER595", "battle");
  const s = activate(a.s, a.card).state;
  const custom = { ...game, costs: { ...game.costs, pool595: { ...game.costs.burst, name: "pool595", amount: "costOf", do: [{ op: "moveTo" as const, target: { sel: { side: "you" as const, area: "battle" as const, mode: "active" as const } }, to: "drop" as const }] } } };
  const twoCost = { ...ctx, defs: { ...ctx.defs, A595: card("A595", { energyCost: 2, skill: "[Aegis red/blue][Once per turn] {1}" }) } };
  for (const id of [a.card, second]) addEffect(s, [], { target: id, kind: "replaceLeave", value: { to: "warp", optional: true, target: { special: "self" } }, until: "turn", source: id, master: "p1" });
  s.programs[0].aegisCost!.costs = ["energy", "pool595"];
  s.lastChoice = [a.cards[0]]; run(twoCost, custom, s, []);
  assert.equal(s.prompt.kind, "replaceMove"); assert.equal(s.prompt.card, a.card);
  s.lastMode = 1; run(twoCost, custom, s, []);
  assert.equal(s.prompt.kind, "replaceMove"); assert.equal(s.prompt.card, second);
  assert.ok(s.sides.p1.zones.drop.includes(a.card)); assert.ok(s.sides.p1.zones.battle.includes(second));
  const saved = reload(s);
  const staleSide = reload(saved); staleSide.sides.p1.zones.battle = staleSide.sides.p1.zones.battle.filter((id) => id !== second); staleSide.sides.p2.zones.battle.push(second);
  staleSide.lastMode = 1; const sideEvents: GameEvent[] = [];
  assert.throws(() => run(twoCost, custom, staleSide, sideEvents), IllegalAction);
  assert.equal(sideEvents.length, 0); assert.equal(staleSide.cards[a.energy[0]].mode, "rest");
  const staleMode = reload(saved); staleMode.cards[second].mode = "rest"; staleMode.lastMode = 1; const modeEvents: GameEvent[] = [];
  assert.throws(() => run(twoCost, custom, staleMode, modeEvents), IllegalAction);
  assert.equal(modeEvents.length, 0);
  saved.lastMode = 1; const finalEvents: GameEvent[] = []; run(twoCost, custom, saved, finalEvents);
  assert.ok(saved.sides.p1.zones.drop.includes(second));
  assert.equal(saved.sides.p1.zones.drop.filter((id) => id === a.card).length, 1);
  assert.equal(skills(finalEvents, a.card).length, 1); assert.equal(rests(finalEvents).length, 0);
}
// The declared action-price move uses the same cost replacement host. A
// voluntary redirect is a legal choice whose performed move defeats payment;
// the color cards and earlier native energy remain spent under 5-8-4.
{
  const old = scripts.A595.bySkill[0];
  try {
    scripts.A595.bySkill[0] = { ...old, price: { ...old.price!, ops: [{ op: "moveTo", target: { sel: { special: "self" } }, to: "drop" }] } };
    const a = defense("A595", ["MULTI595", "MULTI595"], ["RED595"]); const s = activate(a.s, a.card).state;
    addEffect(s, [], { target: a.card, kind: "replaceLeave", value: { to: "warp", optional: true, target: { special: "self" } }, until: "turn", source: a.card, master: "p1" });
    const paid = choose(s, a.cards[0]); assert.equal(paid.state.prompt.kind, "replaceMove");
    assert.equal(paid.state.cards[a.energy[0]].mode, "rest"); assert.equal(skills(paid.events, a.card).length, 0);
    const redirected = mode(reload(paid.state), 0);
    assert.ok(redirected.state.sides.p1.zones.warp.includes(a.card)); assert.equal(skills(redirected.events, a.card).length, 0);
    assert.deepEqual(redirected.state.cards[a.card].usedThisTurn, []);
    assert.equal(redirected.state.cards[a.energy[0]].mode, "rest");
  } finally { scripts.A595.bySkill[0] = old; }
}
// A limited scoped payer's performed rest remains spent even if a LATER
// mandatory pooled redirect defeats activation. Aegis's own limit stays free.
for (const failsBeforeEnergy of [false, true]) {
  const a = defense("A595", ["MULTI595", "MULTI595"], []);
  const grant = stage(a.s, "GRANT595", "battle"); const payer = stage(a.s, "PAYER595", "battle");
  const s = activate(a.s, a.card).state;
  const custom = { ...game, costs: { ...game.costs, pool595: { ...game.costs.burst, name: "pool595", amount: "costOf", do: [{ op: "moveTo" as const, target: { sel: { side: "you" as const, area: "battle" as const } }, to: "drop" as const }] } } };
  s.programs[0].aegisCost!.costs = failsBeforeEnergy ? ["pool595", "energy", "payWith"] : ["energy", "payWith", "pool595"];
  addEffect(s, [], { target: a.card, kind: "replaceLeave", value: { to: "warp", target: { special: "self" } }, until: "turn", source: a.card, master: "p1" });
  s.lastChoice = [a.cards[0]]; const ev: GameEvent[] = []; run(ctx, custom, s, ev);
  assert.equal(s.cards[payer].mode, failsBeforeEnergy ? "active" : "rest"); assert.deepEqual(s.cards[grant].usedThisTurn, failsBeforeEnergy ? [] : [0]);
  assert.ok(s.sides.p1.zones.warp.includes(a.card)); assert.deepEqual(s.cards[a.card].usedThisTurn, []); assert.equal(skills(ev, a.card).length, 0);
  // Even if that payer stands again, its once-per-turn permission is used.
  s.cards[payer].mode = "active"; const next = stage(s, "A595", "battle");
  if (failsBeforeEnergy) assert.equal(skills(activate(s, next).events, next).length, 1, "an unperformed energy payment does not spend the grant");
  else assert.throws(() => activate(s, next), IllegalAction);
}
// A substitute can itself rest the payer before the energy-cost stage. That
// effect's mode event is retained, but it is not use of the payment grant.
{
  const a = defense("A595", ["MULTI595", "MULTI595"], []);
  const grant = stage(a.s, "GRANT595", "battle"); const payer = stage(a.s, "PAYER595", "battle");
  const s = activate(a.s, a.card).state;
  const custom = { ...game, costs: { ...game.costs, pool595: { ...game.costs.burst, name: "pool595", amount: "costOf", do: [{ op: "moveTo" as const, target: { sel: { side: "you" as const, area: "battle" as const } }, to: "drop" as const }] } } };
  s.programs[0].aegisCost!.costs = ["pool595", "energy", "payWith"];
  addEffect(s, [], { target: a.card, kind: "replaceLeave", value: { target: { special: "self" }, ops: [{ op: "switchMode", target: { sel: { side: "you", area: "battle", filter: { ...emptyFilter(), names: ["PAYER595"] } } }, mode: "rest" }] }, until: "turn", source: a.card, master: "p1" });
  s.lastChoice = [a.cards[0]]; const ev: GameEvent[] = []; run(ctx, custom, s, ev);
  assert.equal(s.cards[payer].mode, "rest"); assert.deepEqual(s.cards[grant].usedThisTurn, []);
  assert.ok(s.sides.p1.zones.battle.includes(a.card)); assert.deepEqual(s.cards[a.card].usedThisTurn, []); assert.equal(skills(ev, a.card).length, 0);
}
console.log("Aegis #595: color-first cost, live fee, reload, failure, and delayed activation verified");
