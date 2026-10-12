/** Fixed expectations from 9-6-4 / 5-8-2 / 20-5, independent of the legacy oracle. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { run } from "../../src/lib/arena/vm/flow";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { Op, Script } from "../../src/lib/arena/vm/script";

const rules = engineFor("rules");
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const dbs = loaded.definition;
const defs = { ...DEFS,
  A549: card("A549", { energyCost: 0, skill: "[Auto] {r}: When you play this card, draw 1 card." }),
  B549: card("B549", { energyCost: 0, skill: "[Auto] {r}: When you play this card, draw 2 cards." }),
  ACTION549: card("ACTION549", { energyCost: 0, skill: "[Auto] Choose 1 card in your hand and place it in its owner's Drop Area: When you play this card, draw 1 card." }),
  X549: card("X549", { energyCost: 0, skill: "[Auto] {X}: When you play this card, draw X cards." }),
  FREE549: card("FREE549", { energyCost: 0, skill: "[Auto] When you play this card, draw 1 card." }),
  MULTI549: card("MULTI549", { energyCost: 0, skill: "[Auto] When you play this card, draw 1 card.\n[Auto] When you play this card, draw 2 cards." }),
  DROP549: card("DROP549", { energyCost: 0, skill: "[Auto] When this card is placed in the Drop Area from the Battle Area, draw 1 card." }),
  MIX549: card("MIX549", { energyCost: 0, skill: "[Auto] {r}: When you play this card, draw 1 card." }),
  BURST549: card("BURST549", { energyCost: 0, skill: "[Auto][Burst 2]: When you play this card, draw 1 card." }),
  SPIRIT549: card("SPIRIT549", { energyCost: 0, skill: "[Auto][Spirit Boost 1]: When you play this card, draw 1 card." }),
  WEAK549: card("WEAK549", { energyCost: 0, power: 0, skill: null }),
  ENERGY549: card("ENERGY549", { colors: ["Red"], energyCost: 0, skill: null }),
};
const scripts = rulesFromCompiler(defs);
function script(id: keyof typeof defs, ops: Op[], priceOps: Op[] | null = null): Script {
  const old = scripts[id].bySkill[0];
  return scripts[id].bySkill[0] = { ...old, unsupported: [], trigger: ["played"], ops, price: { ...old?.price, condition: null, ops: priceOps } };
}
script("A549", [{ op: "draw", n: 1 }]);
script("B549", [{ op: "draw", n: 2 }]);
script("ACTION549", [{ op: "draw", n: 1 }], [{ op: "choose", sel: { area: "hand", side: "you", count: 1 }, as: "paid" }, { op: "moveTo", target: { var: "paid" }, to: "drop" }]);
script("X549", [{ op: "draw", n: { x: true } }]).price!.x = { min: 1, max: 3 };
script("FREE549", [{ op: "draw", n: 1 }]);
assert.ok(scripts.MULTI549.bySkill[0] && scripts.MULTI549.bySkill[10]);
scripts.MULTI549.bySkill[0] = { ...scripts.MULTI549.bySkill[0], unsupported: [], trigger: ["played"], ops: [{ op: "draw", n: 1 }] };
scripts.MULTI549.bySkill[10] = { ...scripts.MULTI549.bySkill[10], unsupported: [], trigger: ["played"], ops: [{ op: "draw", n: 2 }] };
assert.ok(scripts.DROP549.bySkill[0]);
scripts.DROP549.bySkill[0] = { ...scripts.DROP549.bySkill[0], unsupported: [], trigger: ["leftBattleToDrop"], ops: [{ op: "draw", n: 1 }] };
script("MIX549", [{ op: "draw", n: 1 }], [{ op: "choose", sel: { area: "hand", side: "you", count: 1 }, as: "paid" }, { op: "moveTo", target: { var: "paid" }, to: "drop" }]);
script("BURST549", [{ op: "draw", n: 1 }]);
script("SPIRIT549", [{ op: "draw", n: 1 }]);
const ctx: EngineContext = { ...CTX, defs, scripts };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
function main(): VmState {
  let s = rules.createGame(ctx, { seed: 549, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = rules.apply(ctx, s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = rules.apply(ctx, s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(s.prompt.kind, "main");
  return s;
}
function stage(s: VmState, id: string, area: "hand" | "battle" | "energy" | "unison" = "battle", p: PlayerId = "p1"): string {
  const physical = s.sides[p].zones.hand[0];
  assert.ok(physical);
  s.cards[physical].cardId = id;
  if (area !== "hand") assert.ok(moveCard(s, dbs, physical, area, { owner: p }).ok);
  return physical;
}
function pend(s: VmState, source: string, p: PlayerId = "p1", subject?: string): GameEvent[] {
  s.pending.push({ card: source, master: p, skillIndex: 0, trigger: "played", ...(subject ? { subject } : {}) });
  const ev: GameEvent[] = [];
  run(ctx, dbs, s, ev);
  return ev;
}
function answer(s: VmState, index: number, p: PlayerId = "p1") { return rules.apply(ctx, reload(s), { type: "chooseMode", player: p, index }) as { state: VmState; events: GameEvent[] }; }
function order(s: VmState, index: number, p: PlayerId = "p1") { return rules.apply(ctx, reload(s), { type: "orderPending", player: p, index }) as { state: VmState; events: GameEvent[] }; }
function choose(s: VmState, cards: string[]) { return rules.apply(ctx, reload(s), { type: "choose", player: "p1", cards }) as { state: VmState; events: GameEvent[] }; }
function declines(s: VmState): number { assert.equal(s.prompt.kind, "chooseMode"); return s.prompt.kind === "chooseMode" ? s.prompt.options.length - 1 : -1; }
function draws(ev: GameEvent[]) { return ev.filter((e) => e.type === "draw").length; }

function snapshot(current: VmState, viewer: PlayerId = "p1") {
  return buildSnapshot({ id: 549, engine: "rules", mode: "versus", status: "playing", p1Name: "You", p2Name: "Other", ctx, state: current, legal: rules.legalActions(ctx, current), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
}

// A real play moment opens a cost decision without paying or drawing. Decline
// and paid resolution are different actions, and invalid answers are atomic.
{
  let s = main();
  const energy = stage(s, "ENERGY549", "energy");
  const source = stage(s, "A549", "hand");
  const played = rules.apply(ctx, s, { type: "play", player: "p1", card: source });
  s = played.state as VmState;
  assert.equal(s.prompt.kind, "chooseMode");
  assert.equal(s.cards[energy].mode, "active");
  assert.equal(draws(played.events), 0);
  const snapshot = JSON.stringify(s);
  assert.throws(() => answer(s, -1), IllegalAction);
  assert.throws(() => answer(s, 0, "p2"), IllegalAction);
  assert.equal(JSON.stringify(s), snapshot);
  const declined = answer(s, declines(s));
  assert.equal(declined.state.cards[energy].mode, "active");
  assert.equal(draws(declined.events), 0);
  assert.ok(declined.events.some((e) => e.type === "note" && /declined/.test(e.text)));
  const paid = answer(s, 0);
  assert.equal(paid.state.cards[energy].mode, "rest");
  assert.equal(draws(paid.events), 1);
  assert.equal(paid.events.filter((e) => e.type === "skill" && e.card === source).length, 1);
  assert.equal(paid.state.prompt.kind, "main");
  assert.throws(() => answer(paid.state, 0), IllegalAction);
}
// Two compiled lines on one genuinely played card pend from the same moment.
// Their effects wait for the master's order answer; the chosen line resolves
// first and the remaining line follows from its captured source.
{
  const s = main(); const source = stage(s, "MULTI549", "hand");
  const played = rules.apply(ctx, s, { type: "play", player: "p1", card: source });
  const waiting = played.state as VmState;
  assert.equal(waiting.prompt.kind, "orderPending");
  assert.deepEqual(waiting.pending.map((item) => [item.card, item.skillIndex, item.master, item.trigger]), [
    [source, 0, "p1", "played"], [source, 10, "p1", "played"],
  ]);
  assert.equal(draws(played.events), 0);
  const labels = rules.legalActions(ctx, waiting).filter((move) => move.action.type === "orderPending").map((move) => move.label);
  assert.equal(labels.length, 2); assert.notEqual(labels[0], labels[1]);
  const chosen = order(waiting, 1);
  assert.equal(draws(chosen.events), 3);
  assert.deepEqual(chosen.events.filter((e) => e.type === "skill").map((e) => e.type === "skill" ? e.skill : -1), [10, 0]);
  assert.equal(chosen.state.pending.length, 0); assert.equal(chosen.state.prompt.kind, "main");
}
// Real JSONB storage can reorder every object's keys; resource revalidation
// compares values and still pays once on the reloaded continuation.
{
  const a = mainWith("A549"); const energy = stage(a.state, "ENERGY549", "energy"); pend(a.state, a.source);
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => y.localeCompare(x)).map(([key, nested]) => [key, reorder(nested)])) : value;
  const result = answer(reorder(a.state) as VmState, 0);
  assert.equal(result.state.cards[energy].mode, "rest"); assert.equal(draws(result.events), 1);
}
// Unaffordable costs are canceled, with a distinct diagnostic and no skill event.
{
  const s = main(); const source = stage(s, "A549"); const hand = s.sides.p1.zones.hand.length;
  const ev = pend(s, source);
  assert.equal(s.outcome, undefined); assert.equal(s.prompt.kind, "main");
  assert.equal(s.sides.p1.zones.hand.length, hand); assert.equal(draws(ev), 0);
  assert.ok(ev.some((e) => e.type === "note" && /unaffordable/.test(e.text)));
}
// Cost-free and satisfied condition-only Autos are mandatory; false conditions
// are canceled before unsupported effect/price inspection.
{
  const s = main(); const source = stage(s, "FREE549"); const ev = pend(s, source);
  assert.equal(s.prompt.kind, "main"); assert.equal(draws(ev), 1);
  const prior = scripts.FREE549.bySkill[0];
  scripts.FREE549.bySkill[0] = { ...prior, price: { condition: { kind: "all", conds: [] }, ops: null } };
  const conditional = mainWith("FREE549");
  assert.equal(draws(pend(conditional.state, conditional.source)), 1);
  assert.equal(conditional.state.prompt.kind, "main");
  scripts.FREE549.bySkill[0] = prior;
}
function mainWith(id: string) { const state = main(); return { state, source: stage(state, id) }; }
// A false condition takes precedence over an unread price/effect.
{
  const old = scripts.MIX549.bySkill[0];
  scripts.MIX549.bySkill[0] = { ...old, unsupported: ["unread effect"], price: { condition: { kind: "not", cond: { kind: "all", conds: [] } }, ops: [{ op: "draw", n: 1 }] } };
  const a = mainWith("MIX549"); const ev = pend(a.state, a.source);
  assert.equal(a.state.outcome, undefined); assert.equal(draws(ev), 0); assert.equal(a.state.prompt.kind, "main");
  scripts.MIX549.bySkill[0] = old;
}
// Two masters and two sources preserve turn-player priority and captured bindings
// through both the cost decision and a separate action-price decision reload.
{
  const s = main(); const a = stage(s, "A549"); const b = stage(s, "B549", "battle", "p2");
  const ea = stage(s, "ENERGY549", "energy"); const eb = stage(s, "ENERGY549", "energy", "p2");
  s.pending.push({ card: b, master: "p2", skillIndex: 0, trigger: "played", subject: a });
  pend(s, a, "p1", b);
  assert.equal(s.programs[0].card, a); assert.equal(s.programs[0].subject, b);
  const first = answer(s, 0); assert.equal(draws(first.events), 1); assert.equal(first.state.cards[ea].mode, "rest");
  assert.equal(first.state.programs[0].card, b); assert.equal(first.state.programs[0].master, "p2"); assert.equal(first.state.programs[0].subject, a);
  const second = answer(first.state, 0, "p2"); assert.equal(draws(second.events), 2); assert.equal(second.state.cards[eb].mode, "rest");
  assert.equal(second.events.find((e) => e.type === "skill")?.card, b);
  assert.equal(second.state.pending.length, 0);
}
// 9-6-3: when the turn player has two Autos, they choose the source and skill
// before either cost is offered. The chosen record retains its event subject
// through JSON storage, then the remaining Auto is paid and resolved once.
{
  const s = main(); const a = stage(s, "A549"); const b = stage(s, "B549");
  const ea = stage(s, "ENERGY549", "energy"); const eb = stage(s, "ENERGY549", "energy");
  s.pending.push({ card: a, master: "p1", skillIndex: 0, trigger: "played", subject: b });
  s.pending.push({ card: b, master: "p1", skillIndex: 0, trigger: "played", subject: a });
  const events: GameEvent[] = []; run(ctx, dbs, s, events);
  assert.equal(s.prompt.kind, "orderPending");
  assert.deepEqual(s.prompt.kind === "orderPending" ? s.prompt.candidates : [], [0, 1]);
  assert.equal(draws(events), 0); assert.equal(s.cards[ea].mode, "active");
  const view = snapshot(s);
  assert.deepEqual(view.legal.filter((move) => move.action.type === "orderPending").map((move) => move.action), [
    { type: "orderPending", player: "p1", index: 0 }, { type: "orderPending", player: "p1", index: 1 },
  ]);
  assert.equal(snapshot(s, "p2").legal.length, 0);
  const choice = order(s, 1);
  assert.equal(choice.state.programs[0].card, b); assert.equal(choice.state.programs[0].master, "p1");
  assert.equal(choice.state.programs[0].subject, a); assert.equal(choice.state.pending[0].card, a);
  assert.equal(choice.state.prompt.kind, "chooseMode"); assert.equal(draws(choice.events), 0);
  const first = answer(choice.state, 0);
  assert.equal(draws(first.events), 2); assert.equal(first.events.find((e) => e.type === "skill")?.card, b);
  assert.equal(first.state.programs[0].card, a); assert.equal(first.state.programs[0].subject, b);
  const second = answer(first.state, 0);
  assert.equal(draws(second.events), 1); assert.equal(second.events.find((e) => e.type === "skill")?.card, a);
  assert.equal(second.state.cards[ea].mode, "rest"); assert.equal(second.state.cards[eb].mode, "rest");
  assert.equal(second.state.pending.length, 0); assert.equal(second.state.prompt.kind, "main");
}
// The same player's choice takes precedence over an older opposing Auto. A
// stale queue or turn player is rejected atomically, including changed event
// bindings at the same numeric index.
{
  const s = main(); const opponent = stage(s, "B549", "battle", "p2"); const a = stage(s, "A549"); const b = stage(s, "B549");
  stage(s, "ENERGY549", "energy"); stage(s, "ENERGY549", "energy"); stage(s, "ENERGY549", "energy", "p2");
  s.pending.push({ card: opponent, master: "p2", skillIndex: 0, trigger: "played", subject: a });
  s.pending.push({ card: a, master: "p1", skillIndex: 0, trigger: "played", subject: b });
  s.pending.push({ card: b, master: "p1", skillIndex: 0, trigger: "played", subject: a });
  run(ctx, dbs, s, []);
  assert.deepEqual(s.prompt.kind === "orderPending" ? s.prompt.candidates : [], [1, 2]);
  for (const [candidate, player] of [[0, "p1"], [1, "p2"], [-1, "p1"], [3, "p1"], [1.5, "p1"]] as const) {
    const before = JSON.stringify(s);
    assert.throws(() => order(s, candidate, player), IllegalAction);
    assert.equal(JSON.stringify(s), before);
  }
  const changed = reload(s); changed.pending[2].subject = opponent;
  const before = JSON.stringify(changed);
  assert.throws(() => order(changed, 2), IllegalAction); assert.equal(JSON.stringify(changed), before);
  const changedTurn = reload(s); changedTurn.turnPlayer = "p2";
  assert.throws(() => order(changedTurn, 2), IllegalAction);
  const chosen = order(s, 2); assert.equal(chosen.state.programs[0].card, b);
  const paid = answer(chosen.state, 0); assert.equal(draws(paid.events), 2);
  assert.equal(paid.state.programs[0].card, a);
  const next = answer(paid.state, 0); assert.equal(draws(next.events), 1);
  assert.equal(next.state.programs[0].card, opponent); assert.equal(next.state.programs[0].master, "p2");
  assert.equal(answer(next.state, 0, "p2").events.find((e) => e.type === "skill")?.card, opponent);
}
// A hand source is named only in its master's legal choices. The opponent's
// snapshot cannot recover its instance or printed text from the prompt.
{
  const s = main(); const publicSource = stage(s, "B549");
  stage(s, "ENERGY549", "energy"); stage(s, "ENERGY549", "energy"); const hand = stage(s, "A549", "hand");
  s.pending.push({ card: hand, master: "p1", skillIndex: 0, trigger: "played" });
  s.pending.push({ card: publicSource, master: "p1", skillIndex: 0, trigger: "played" });
  run(ctx, dbs, s, []);
  assert.equal(s.prompt.kind, "orderPending");
  assert.ok(snapshot(s).legal.some((move) => move.label.includes(defs.A549.name)));
  const opponent = snapshot(s, "p2");
  assert.equal(opponent.legal.length, 0);
  assert.ok(!JSON.stringify(opponent).includes(hand));
  assert.ok(!JSON.stringify(opponent).includes(defs.A549.skill!));
}
// A chosen skill can pend a fresh Auto while resolving. The checkpoint
// recomputes the current master's choices; it does not reuse an old ordering
// or skip the new event. Each later two-way choice persists across reload.
{
  const original = scripts.B549.bySkill[0];
  script("B549", [{ op: "moveTo", target: { sel: { special: "subject" } }, to: "drop" }]);
  const s = main(); const a = stage(s, "A549"); const b = stage(s, "B549"); const free = stage(s, "FREE549"); const drop = stage(s, "DROP549");
  stage(s, "ENERGY549", "energy"); stage(s, "ENERGY549", "energy");
  s.pending.push({ card: a, master: "p1", skillIndex: 0, trigger: "played" });
  s.pending.push({ card: b, master: "p1", skillIndex: 0, trigger: "played", subject: drop });
  s.pending.push({ card: free, master: "p1", skillIndex: 0, trigger: "played" });
  run(ctx, dbs, s, []);
  assert.deepEqual(s.prompt.kind === "orderPending" ? s.prompt.candidates : [], [0, 1, 2]);
  const selected = order(s, 1); assert.equal(selected.state.programs[0].subject, drop);
  const paid = answer(selected.state, 0);
  assert.ok(paid.state.sides.p1.zones.drop.includes(drop)); assert.equal(draws(paid.events), 0);
  assert.deepEqual(paid.state.prompt.kind === "orderPending" ? paid.state.prompt.candidates : [], [0, 1, 2]);
  assert.deepEqual(paid.state.pending.map((item) => item.card), [a, free, drop]);
  const fresh = order(paid.state, 2);
  assert.equal(draws(fresh.events), 1); assert.equal(fresh.events.find((e) => e.type === "skill")?.card, drop);
  assert.deepEqual(fresh.state.prompt.kind === "orderPending" ? fresh.state.prompt.candidates : [], [0, 1]);
  const freeChosen = order(fresh.state, 1);
  assert.equal(draws(freeChosen.events), 1); assert.equal(freeChosen.events.find((e) => e.type === "skill")?.card, free);
  assert.equal(freeChosen.state.programs[0].card, a);
  assert.equal(draws(answer(freeChosen.state, 0).events), 1);
  scripts.B549.bySkill[0] = original;
}
// Combined orb/action payment is charged once across a suspended cost prompt.
{
  const s = main(); const source = stage(s, "MIX549"); const energy = stage(s, "ENERGY549", "energy");
  pend(s, source); const paid = answer(s, 0);
  assert.equal(paid.state.prompt.kind, "chooseCards"); assert.equal(paid.state.cards[energy].mode, "rest"); assert.equal(draws(paid.events), 0);
  const candidate = paid.state.prompt.kind === "chooseCards" ? paid.state.prompt.choice.candidates[0] : "";
  const completed = choose(paid.state, [candidate]);
  assert.ok(completed.state.sides.p1.zones.drop.includes(candidate)); assert.equal(draws(completed.events), 1);
  assert.equal(completed.events.filter((e) => e.type === "mode" && e.card === energy).length, 0);
  assert.equal(completed.events.filter((e) => e.type === "skill" && e.card === source).length, 1);
}
// Captured action-price targets are used by the effect after reload, never
// substituted with the source or another price's variables.
{
  const old = scripts.ACTION549.bySkill[0];
  script("ACTION549", [{ op: "moveTo", target: { var: "paid" }, to: "hand" }, { op: "draw", n: 1 }], old.price!.ops);
  const a = mainWith("ACTION549"); pend(a.state, a.source); const opened = answer(a.state, 0);
  assert.equal(opened.state.prompt.kind, "chooseCards");
  const id = opened.state.prompt.kind === "chooseCards" ? opened.state.prompt.choice.candidates[0] : "";
  const result = choose(opened.state, [id]);
  assert.ok(result.state.sides.p1.zones.hand.includes(id));
  assert.ok(result.events.some((e) => e.type === "move" && e.card === id && e.to === "drop"));
  assert.ok(result.events.some((e) => e.type === "move" && e.card === id && e.from === "drop" && e.to === "hand"));
  scripts.ACTION549.bySkill[0] = old;
}
// A persisted payment offer whose resource is no longer active is rejected
// before charge, leaving the supplied state byte-for-byte unchanged.
{
  const a = mainWith("A549"); const energy = stage(a.state, "ENERGY549", "energy"); pend(a.state, a.source);
  a.state.cards[energy].mode = "rest"; const snapshot = JSON.stringify(a.state);
  assert.throws(() => answer(a.state, 0), IllegalAction); assert.equal(JSON.stringify(a.state), snapshot);
}
// Chosen energy X survives JSON reload and controls the effect, including floors.
{
  const s = main(); const source = stage(s, "X549"); stage(s, "ENERGY549", "energy"); stage(s, "ENERGY549", "energy");
  pend(s, source); assert.equal(s.prompt.kind, "chooseMode");
  assert.ok(s.prompt.kind === "chooseMode" && s.prompt.options.every((label) => !label.includes("X = 0") && !label.includes("X = 3")));
  const index = s.prompt.kind === "chooseMode" ? s.prompt.options.findIndex((label) => label.includes("X = 2")) : -1;
  const result = answer(s, index); assert.equal(result.state.sides.p1.zones.energy.filter((id) => result.state.cards[id].mode === "rest").length, 2);
  assert.equal(result.events.find((e) => e.type === "draw")?.type, "draw");
  assert.equal(draws(result.events), 2);
}

// A floor above all resources is unaffordable, while a very large printed
// ceiling enumerates only values payable by the finite resource pool.
{
  const old = scripts.X549.bySkill[0];
  scripts.X549.bySkill[0] = { ...old, price: { ...old.price!, x: { min: 100 } } };
  const a = mainWith("X549"); stage(a.state, "ENERGY549", "energy"); const ev = pend(a.state, a.source);
  assert.equal(a.state.outcome, undefined); assert.equal(a.state.prompt.kind, "main");
  assert.ok(ev.some((e) => e.type === "note" && /unaffordable/.test(e.text)));
  scripts.X549.bySkill[0] = { ...old, price: { ...old.price!, x: { min: 1, max: 1000000000 } } };
  const b = mainWith("X549"); stage(b.state, "ENERGY549", "energy"); pend(b.state, b.source);
  assert.ok(b.state.prompt.kind === "chooseMode" && b.state.prompt.options.length === 2);
  scripts.X549.bySkill[0] = old;
}
// Resource tags use the declared planner, never a second free resolution.
{
  const burst = mainWith("BURST549"); const before = burst.state.sides.p1.zones.deck.length;
  pend(burst.state, burst.source); const result = answer(burst.state, 0);
  assert.equal(result.state.sides.p1.zones.deck.length, before - 3, "Burst spends two cards before drawing one");
  assert.equal(result.events.filter((e) => e.type === "move" && e.from === "deck" && e.to === "drop").length, 2);
  const spirit = mainWith("SPIRIT549"); const unison = stage(spirit.state, "UNI2", "unison"); spirit.state.cards[unison].markers = 3;
  pend(spirit.state, spirit.source); const boosted = answer(spirit.state, 0);
  assert.equal(boosted.state.cards[unison].markers, 2); assert.equal(draws(boosted.events), 1);
  assert.equal(boosted.events.filter((e) => e.type === "markers" && e.card === unison).length, 1);
}
// A stale Spirit Boost offer cannot clamp away a missing marker and resolve.
{
  const a = mainWith("SPIRIT549"); const unison = stage(a.state, "UNI2", "unison"); a.state.cards[unison].markers = 1;
  pend(a.state, a.source); a.state.cards[unison].markers = 0;
  const before = JSON.stringify(a.state); assert.throws(() => answer(a.state, 0), IllegalAction);
  assert.equal(JSON.stringify(a.state), before);
}
// Variable and action-chosen X travel in the Auto's own frame. A payment that
// moves its source still resolves as the captured master, about the event subject.
{
  const old = scripts.ACTION549.bySkill[0];
  script("ACTION549", [{ op: "draw", n: { x: true } }, { op: "switchMode", target: { sel: { special: "subject" } }, mode: "rest" }], [
    { op: "choose", sel: { area: "hand", side: "you", count: 2, upTo: true }, as: "paid", bindX: true },
    { op: "moveTo", target: { var: "paid" }, to: "drop" },
    { op: "moveTo", target: { sel: { special: "self" } }, to: "drop" },
  ]);
  const a = mainWith("ACTION549"); const target = stage(a.state, "V1", "battle", "p2");
  pend(a.state, a.source, "p1", target);
  let result = answer(a.state, 0); assert.equal(result.state.prompt.kind, "chooseCards");
  const chosen: string[] = [];
  for (let i = 0; i < 2; i++) {
    assert.equal(result.state.prompt.kind, "chooseCards");
    if (result.state.prompt.kind !== "chooseCards") break;
    const id = result.state.prompt.choice.candidates[0]; chosen.push(id); result = choose(result.state, [id]);
  }
  assert.ok(chosen.every((id) => result.state.sides.p1.zones.drop.includes(id)));
  assert.ok(result.state.sides.p1.zones.drop.includes(a.source));
  assert.equal(result.state.cards[target].mode, "rest"); assert.equal(draws(result.events), 2);
  assert.equal(result.events.find((e) => e.type === "skill")?.master, "p1");
  scripts.ACTION549.bySkill[0] = old;
}
// Full-price planning rejects sequential double-spend and impossible movement.
{
  const old = scripts.ACTION549.bySkill[0];
  script("ACTION549", [{ op: "draw", n: 1 }], [
    { op: "removeMarker", target: { sel: { special: "self" } }, n: 2 },
    { op: "removeMarker", target: { sel: { special: "self" } }, n: 2 },
  ]);
  const a = mainWith("ACTION549"); a.state.cards[a.source].markers = 3;
  const ev = pend(a.state, a.source);
  assert.equal(a.state.cards[a.source].markers, 3); assert.equal(draws(ev), 0);
  assert.ok(ev.some((e) => e.type === "note" && /unaffordable/.test(e.text)));
  script("ACTION549", [{ op: "draw", n: 1 }], [{ op: "switchMode", target: { sel: { special: "self" } }, mode: "rest" }]);
  const b = mainWith("ACTION549"); b.state.cards[b.source].mode = "rest";
  assert.equal(draws(pend(b.state, b.source)), 0); assert.equal(b.state.prompt.kind, "main");
  scripts.ACTION549.bySkill[0] = old;
}
// Mandatory choose-three fails with only two cards, including a price that
// can initially see three physical cards but only two distinct names.
{
  const old = scripts.ACTION549.bySkill[0];
  for (const differentNames of [false, true]) {
    script("ACTION549", [{ op: "draw", n: 1 }], [
      { op: "choose", sel: { area: "hand", side: "you", count: 3, ...(differentNames ? { differentNames: true } : {}) }, as: "paid" },
      { op: "moveTo", target: { var: "paid" }, to: "drop" },
    ]);
    const a = mainWith("ACTION549");
    while (a.state.sides.p1.zones.hand.length > (differentNames ? 3 : 2)) {
      const id = a.state.sides.p1.zones.hand[0]; assert.ok(moveCard(a.state, dbs, id, "deck", { owner: "p1" }).ok);
    }
    const hand = [...a.state.sides.p1.zones.hand]; const ev = pend(a.state, a.source);
    assert.equal(a.state.prompt.kind, "main"); assert.equal(draws(ev), 0); assert.deepEqual(a.state.sides.p1.zones.hand, hand);
  }
  scripts.ACTION549.bySkill[0] = old;
}
// Only one first pick leaves enough resources for the second mandatory rest.
// The projection removes the dead-end source pick before paying any action cost.
{
  const old = scripts.ACTION549.bySkill[0];
  script("ACTION549", [{ op: "draw", n: 1 }], [
    { op: "choose", sel: { area: "battle", side: "you", count: 1 }, as: "first" },
    { op: "switchMode", target: { var: "first" }, mode: "rest" },
    { op: "choose", sel: { special: "self", count: 1 }, as: "second" },
    { op: "switchMode", target: { var: "second" }, mode: "rest" },
  ]);
  const a = mainWith("ACTION549"); const other = stage(a.state, "V1"); pend(a.state, a.source); const opened = answer(a.state, 0);
  assert.equal(opened.state.prompt.kind, "chooseCards");
  assert.ok(opened.state.prompt.kind === "chooseCards" && opened.state.prompt.choice.candidates.length === 1);
  assert.ok(opened.state.prompt.kind === "chooseCards" && opened.state.prompt.choice.candidates[0] === other);
  assert.equal(opened.state.cards[a.source].mode, "active"); assert.equal(opened.state.cards[other].mode, "active");
  const result = choose(opened.state, [other]);
  assert.equal(result.state.cards[a.source].mode, "rest"); assert.equal(result.state.cards[other].mode, "rest"); assert.equal(draws(result.events), 1);
  scripts.ACTION549.bySkill[0] = old;
}
// A 9-10 optional, unqualified replacement can be declined to complete a
// cost movement. A mandatory different destination makes the entire cost
// unpayable before any energy is charged. Effect-only replacements do not
// apply to costs (5-8-2-2, causeMatches).
{
  const old = scripts.MIX549.bySkill[0];
  script("MIX549", [{ op: "draw", n: 1 }], [
    { op: "choose", sel: { area: "battle", side: "opponent", count: 1 }, as: "paid" },
    { op: "moveTo", target: { var: "paid" }, to: "drop" },
  ]);
  for (const mode of ["optional", "mandatory", "effect-only"] as const) {
    const a = mainWith("MIX549"); const energy = stage(a.state, "ENERGY549", "energy"); const target = stage(a.state, "V1", "battle", "p2");
    addEffect(a.state, [], { master: "p2", source: target, target, kind: "replaceLeave", value: { to: "warp", ...(mode === "optional" ? { optional: true } : {}), ...(mode === "effect-only" ? { by: "skill" } : {}) }, until: "turn" });
    const ev = pend(a.state, a.source);
    if (mode === "mandatory") {
      assert.equal(a.state.prompt.kind, "main"); assert.equal(a.state.cards[energy].mode, "active"); assert.ok(a.state.sides.p2.zones.battle.includes(target));
      assert.equal(draws(ev), 0); continue;
    }
    assert.equal(a.state.prompt.kind, "chooseMode");
    let result = answer(a.state, 0);
    if (mode === "optional") {
      assert.equal(result.state.prompt.kind, "replaceMove"); assert.equal(result.state.cards[energy].mode, "rest");
      assert.ok(result.state.sides.p2.zones.battle.includes(target)); assert.equal(draws(result.events), 0);
      assert.ok(result.state.prompt.kind === "replaceMove" && result.state.prompt.options.length === 2, "the affected opponent keeps both legal replacement choices");
      const failed = answer(result.state, 0, "p2");
      assert.ok(failed.state.sides.p2.zones.warp.includes(target));
      assert.equal(failed.state.cards[energy].mode, "rest", "5-8-4 retains the earlier orb payment");
      assert.equal(draws(failed.events), 0); assert.equal(failed.events.some((e) => e.type === "skill" && e.card === a.source), false);
      assert.ok(failed.events.some((e) => e.type === "note" && /payment to fail/.test(e.text)));
      assert.equal(failed.state.prompt.kind, "main");
      const decline = result.state.prompt.kind === "replaceMove" ? result.state.prompt.options.length - 1 : -1;
      result = answer(result.state, decline, "p2");
    }
    assert.ok(result.state.sides.p2.zones.drop.includes(target)); assert.equal(result.state.sides.p2.zones.warp.includes(target), false);
    assert.equal(result.state.cards[energy].mode, "rest"); assert.equal(draws(result.events), 1);
    assert.equal(result.events.filter((e) => e.type === "move" && e.card === target).length, 1);
  }
  scripts.MIX549.bySkill[0] = old;
}
// Failure caused by the opponent's valid replacement resumes the checkpoint
// queue, rather than rolling back their choice or activating the failed Auto.
{
  const old = scripts.MIX549.bySkill[0];
  script("MIX549", [{ op: "draw", n: 1 }], [{ op: "moveTo", target: { sel: { special: "subject" } }, to: "drop" }]);
  const a = mainWith("MIX549"); const b = stage(a.state, "B549"); stage(a.state, "ENERGY549", "energy"); stage(a.state, "ENERGY549", "energy");
  const target = stage(a.state, "V1", "battle", "p2");
  addEffect(a.state, [], { master: "p2", source: target, target, kind: "replaceLeave", value: { to: "warp", optional: true }, until: "turn" });
  a.state.pending.push({ card: a.source, master: "p1", skillIndex: 0, trigger: "played", subject: target }); pend(a.state, b);
  assert.equal(a.state.prompt.kind, "orderPending");
  const chosen = order(a.state, 0);
  const offered = answer(chosen.state, 0); assert.equal(offered.state.prompt.kind, "replaceMove");
  const failed = answer(offered.state, 0, "p2");
  assert.equal(failed.state.prompt.kind, "chooseMode"); assert.equal(failed.state.programs[0].card, b);
  assert.ok(failed.state.sides.p2.zones.warp.includes(target)); assert.equal(draws(failed.events), 0);
  assert.equal(failed.state.cards[a.source].usedThisTurn.length, 0);
  assert.equal(failed.events.some((e) => e.type === "skill" && e.card === a.source), false);
  const completed = answer(failed.state, 0); assert.equal(draws(completed.events), 2);
  assert.equal(completed.state.sides.p1.zones.energy.filter((id) => completed.state.cards[id].mode === "rest").length, 2);
  scripts.MIX549.bySkill[0] = old;
}
// Real paid-Auto / 21-6 interaction: moving the support as a cost ends its
// while-source power. Resolve the paid effect completely, then the checkpoint
// removes the other zero-power Battle Card (never interleave it in the price).
{
  const old = scripts.ACTION549.bySkill[0];
  script("ACTION549", [{ op: "draw", n: 1 }], [
    { op: "choose", sel: { area: "battle", side: "opponent", count: 1 }, as: "paid" },
    { op: "moveTo", target: { var: "paid" }, to: "drop" },
  ]);
  const a = mainWith("ACTION549"); const support = stage(a.state, "V1", "battle", "p2"); const weak = stage(a.state, "WEAK549", "battle", "p2");
  addEffect(a.state, [], { target: weak, kind: "power", value: 5000, until: "whileSourceInPlay", source: support, master: "p2" });
  pend(a.state, a.source); const opened = answer(a.state, 0); assert.equal(opened.state.prompt.kind, "chooseCards");
  const completed = choose(opened.state, [support]);
  assert.ok(completed.state.sides.p2.zones.drop.includes(support)); assert.ok(completed.state.sides.p2.zones.drop.includes(weak));
  assert.equal(draws(completed.events), 1);
  const costMove = completed.events.findIndex((e) => e.type === "move" && e.card === support && e.to === "drop");
  const draw = completed.events.findIndex((e) => e.type === "draw");
  const checkpoint = completed.events.findIndex((e) => e.type === "move" && e.card === weak && e.to === "drop");
  assert.ok(costMove >= 0 && costMove < draw && draw < checkpoint);
  scripts.ACTION549.bySkill[0] = old;
}
// Unsupported instructions remain typed interruptions, not unaffordable no-ops.
{
  const old = scripts.ACTION549.bySkill[0];
  script("ACTION549", [{ op: "draw", n: 1 }], [{ op: "draw", n: 1 }]);
  const a = mainWith("ACTION549"); pend(a.state, a.source);
  assert.equal(a.state.outcome?.kind, "interrupted"); assert.equal(a.state.outcome?.privateContext?.issue, "#549");
  scripts.ACTION549.bySkill[0] = old;
}
// Trace annotations are no-op instrumentation, while an arbitrary note-only
// price still interrupts rather than inventing a free payment.
{
  const old = scripts.ACTION549.bySkill[0];
  script("ACTION549", [{ op: "draw", n: 1 }], [{ op: "note", text: "pretend this cost was paid" }]);
  const a = mainWith("ACTION549"); pend(a.state, a.source);
  assert.equal(a.state.outcome?.kind, "interrupted"); assert.equal(a.state.outcome?.privateContext?.issue, "#549");
  scripts.ACTION549.bySkill[0] = old;
}
// A missing action-price record is an explicit limitation, never a free skill.
{
  const old = scripts.ACTION549.bySkill[0]; scripts.ACTION549.bySkill[0] = { ...old, price: undefined };
  const a = mainWith("ACTION549"); pend(a.state, a.source);
  assert.equal(a.state.outcome?.kind, "interrupted"); assert.equal(a.state.outcome?.privateContext?.issue, "#549");
  scripts.ACTION549.bySkill[0] = old;
}
// One candidate can pay a later mandatory self-rest; resting the source as
// energy cannot. Filtering all full plans prevents charging the wrong first half.
{
  const old = scripts.MIX549.bySkill[0];
  script("MIX549", [{ op: "draw", n: 1 }], [{ op: "switchMode", target: { sel: { special: "self" } }, mode: "rest" }]);
  const a = mainWith("MIX549"); const other = stage(a.state, "ENERGY549", "energy");
  pend(a.state, a.source); const result = answer(a.state, 0);
  assert.equal(result.state.cards[other].mode, "rest"); assert.equal(result.state.cards[a.source].mode, "rest"); assert.equal(draws(result.events), 1);
  scripts.MIX549.bySkill[0] = old;
}
// Crowded hand: preflight and safe-candidate projection stay bounded on a
// 20-card choice; the simulation changes no real hand, limits, events or costs.
{
  const a = mainWith("ACTION549");
  while (a.state.sides.p1.zones.hand.length < 20) {
    const id = a.state.sides.p1.zones.deck[0]; assert.ok(moveCard(a.state, dbs, id, "hand", { owner: "p1" }).ok);
  }
  const before = JSON.stringify(a.state.sides); const started = performance.now();
  pend(a.state, a.source); assert.equal(JSON.stringify(a.state.sides), before);
  const result = answer(a.state, 0);
  assert.equal(result.state.prompt.kind, "chooseCards");
  assert.ok(result.state.prompt.kind === "chooseCards" && result.state.prompt.choice.candidates.length === 20);
  console.log(`auto-costs-549 crowded 20-card price: ${(performance.now() - started).toFixed(1)} ms`);
}
// #558 integration uses actual #549 cost frames, never a synthetic pending
// extension. Public source identities stay pending during both decisions;
// decline, failure and resolution clear that badge without exposing the cursor.
{
  const a = mainWith("A549"); stage(a.state, "ENERGY549", "energy");
  pend(a.state, a.source, "p1", "PRIVATE_549_EVENT_SUBJECT");
  a.state.programs[0].vars.privateCost = ["PRIVATE_549_PRICE_TARGET"];
  for (const viewer of ["p1", "p2"] as const) {
    const view = snapshot(reload(a.state), viewer);
    const side = viewer === "p1" ? view.view.you : view.view.them;
    const ability = side.battle.find((c) => c.id === a.source)?.abilities?.find((row) => row.skillIndex === 0);
    assert.equal(ability?.pending, true); assert.equal(ability?.category, "automatic");
    assert.equal(ability?.costPreview.state, "incomplete", "the public contract does not expose a private plan as a known preview");
    const wire = JSON.stringify(view); assert.ok(!wire.includes("PRIVATE_549_EVENT_SUBJECT")); assert.ok(!wire.includes("PRIVATE_549_PRICE_TARGET")); assert.ok(!wire.includes("autoCost"));
  }
  for (const result of [answer(a.state, declines(a.state)), answer(a.state, 0)]) {
    assert.equal(snapshot(result.state).view.you.battle.find((c) => c.id === a.source)?.abilities?.[0]?.pending, false);
  }
  const mixed = mainWith("MIX549"); stage(mixed.state, "ENERGY549", "energy"); pend(mixed.state, mixed.source);
  const price = answer(mixed.state, 0); assert.equal(price.state.prompt.kind, "chooseCards");
  assert.equal(snapshot(reload(price.state)).view.you.battle.find((c) => c.id === mixed.source)?.abilities?.[0]?.pending, true);
  const chosen = price.state.prompt.kind === "chooseCards" ? price.state.prompt.choice.candidates[0] : "";
  const resolved = choose(price.state, [chosen]);
  assert.equal(snapshot(resolved.state).view.you.battle.find((c) => c.id === mixed.source)?.abilities?.[0]?.pending, false);
}
// Face-up Life is public to both seats; closed hand/life and Hidden Mode do
// not project the front's pending ability or private payment/source bindings.
{
  const a = main(); const source = stage(a, "A549", "hand", "p2");
  assert.ok(moveCard(a, dbs, source, "life", { owner: "p2" }).ok); a.cards[source].faceUp = true;
  stage(a, "ENERGY549", "energy", "p2"); pend(a, source, "p2");
  for (const viewer of ["p1", "p2"] as const) {
    const view = snapshot(a, viewer); const side = viewer === "p2" ? view.view.you : view.view.them;
    assert.equal(side.lifeFaceUp.find((c) => c.id === source)?.abilities?.[0]?.pending, true);
  }
  const secret = main(); stage(secret, "ENERGY549", "energy"); const ownHandSource = stage(secret, "A549", "hand"); pend(secret, ownHandSource);
  assert.equal(snapshot(secret).view.you.hand?.find((c) => c.id === ownHandSource)?.abilities?.[0]?.pending, true);
  const other = snapshot(secret, "p2"); assert.equal(other.view.them.hand, null); assert.ok(!JSON.stringify(other).includes(ownHandSource));
  const lifeSecret = main(); const lifeSource = stage(lifeSecret, "A549", "hand");
  assert.ok(moveCard(lifeSecret, dbs, lifeSource, "life", { owner: "p1" }).ok); stage(lifeSecret, "ENERGY549", "energy"); pend(lifeSecret, lifeSource);
  assert.ok(!JSON.stringify(snapshot(lifeSecret, "p2")).includes(lifeSource));
  const hidden = mainWith("A549"); stage(hidden.state, "ENERGY549", "energy"); pend(hidden.state, hidden.source); hidden.state.cards[hidden.source].hidden = true;
  for (const viewer of ["p1", "p2"] as const) {
    const view = snapshot(hidden.state, viewer); const side = viewer === "p1" ? view.view.you : view.view.them;
    assert.equal(side.battle.find((c) => c.id === hidden.source)?.abilities?.length ?? 0, 0, "a masked hidden source has no projected front ability");
    assert.ok(!JSON.stringify(view).includes(defs.A549.skill!));
  }
}
// A payment failed by the opponent's valid replacement clears pending even
// while the following queued Auto's own cost prompt remains pending.
{
  const old = scripts.MIX549.bySkill[0];
  script("MIX549", [{ op: "draw", n: 1 }], [{ op: "moveTo", target: { sel: { special: "subject" } }, to: "drop" }]);
  const a = mainWith("MIX549"); const next = stage(a.state, "B549"); stage(a.state, "ENERGY549", "energy"); stage(a.state, "ENERGY549", "energy");
  const target = stage(a.state, "V1", "battle", "p2"); addEffect(a.state, [], { master: "p2", source: target, target, kind: "replaceLeave", value: { to: "warp", optional: true }, until: "turn" });
  a.state.pending.push({ card: a.source, master: "p1", skillIndex: 0, trigger: "played", subject: target }); pend(a.state, next);
  const chosen = order(a.state, 0);
  const opened = answer(chosen.state, 0); const failed = answer(opened.state, 0, "p2"); const view = snapshot(failed.state);
  assert.equal(view.view.you.battle.find((c) => c.id === a.source)?.abilities?.[0]?.pending, false);
  assert.equal(view.view.you.battle.find((c) => c.id === next)?.abilities?.[0]?.pending, true);
  scripts.MIX549.bySkill[0] = old;
}
console.log("auto-costs-549: fixed payment, decline, unaffordable, reload, source/order and X scenarios passed");
