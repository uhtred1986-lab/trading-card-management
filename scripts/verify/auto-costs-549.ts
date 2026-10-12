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
import { NotYet } from "../../src/lib/arena/vm/errors";
import { automaticPriceHost, canFinishAutomaticPrice, readableAutomaticPrice } from "../../src/lib/arena/vm/auto-costs";
import { staticsNow } from "../../src/lib/arena/vm/program";
import { stepScript, type ScriptFrame } from "../../src/lib/arena/vm/script";
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
  // Synthetic supported price grammar; no printed card is asserted.
  BUDGET549: card("BUDGET549", { energyCost: 0, skill: "[Auto] Choose 1 of your Battle Cards and switch it to Rest Mode, choose 3 cards in your hand and place them in your Drop Area, then switch this card to Rest Mode: When you play this card, draw 1 card." }),
  DROPWARP549: card("DROPWARP549", { energyCost: 0, skill: "[Auto] Choose 3 cards in your hand and place them in your Drop Area, then choose 3 {Price Target} cards in your Drop Area and send them to their owner's Warp: When you play this card, draw 1 card." }),
  TARGET549: card("TARGET549", { name: "Price Target", skill: null }),
  TARGET_CASE549: card("TARGET_CASE549", { name: "price target", skill: null }),
  TARGET_ALIAS549: card("TARGET_ALIAS549", { name: "Another Name", alsoNames: ["Price Target"], skill: null }),
  TARGET_BACK549: card("TARGET_BACK549", { name: "Front Name", back: { name: "Price Target", power: 10000, skill: null }, skill: null }),
  PERM549: card("PERM549", { energyCost: 0, skill: "[Permanent] This card gets +1000 power." }),
  FACEUP549: card("FACEUP549", { skill: "[Auto] Flip 1 card in your life face up: When you play this card, draw 1 card." }),
  FACEDOWN549: card("FACEDOWN549", { skill: "[Auto] Flip 1 card in your life face down: When you play this card, draw 1 card." }),
  CONDSHUFFLE549: card("CONDSHUFFLE549", { skill: "[Auto] Choose 1 card in your hand and place it in your Drop Area, then if you do, shuffle your deck: When you play this card, draw 1 card." }),
  CONDTHREE549: card("CONDTHREE549", { skill: "[Auto] Choose 3 cards in your hand and place them in your Drop Area, then if you do, shuffle your deck: When you play this card, draw 1 card." }),
  FACEWATCH549: card("FACEWATCH549", { skill: "[Auto] When this card in your life is flipped face up, draw 1 card." }),
  AEGISFACE549: card("AEGISFACE549", { skill: "[Aegis red/blue]" }),
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
function missingHookIdentity(card: string, master: PlayerId): VmState["pending"][number] {
  return { kind: "hook", card, master, skillIndex: undefined, trigger: "afterSkill", frame: { ops: [], ip: 0, vars: {}, card, master, pendingHookSkill: true, pendingHookIdentityMissing: true } };
}
function assertPrivateInterruption(s: VmState) {
  assert.equal(s.outcome?.kind, "interrupted");
  assert.equal(s.outcome.privateContext?.issue, "#602");
  assert.equal(s.winner, null);
  assert.equal(s.prompt.kind, "gameOver");
  assert.equal(s.pendingOrder, undefined);
  for (const viewer of ["p1", "p2"] as const) {
    const publicView = JSON.stringify(snapshot(s, viewer));
    assert.ok(!publicView.includes("privateContext") && !publicView.includes(s.outcome.privateContext?.detail ?? "impossible private detail"), `${viewer} receives only the public interruption`);
  }
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
// An identity-less captured hook inserts an internal #602 guard, not another
// 9-6-3 choice. It interrupts before any Auto of the priority master can draw
// or charge a price, even when an older serialized prompt offered that guard.
{
  const s = main(); const priced = stage(s, "A549"); const free = stage(s, "FREE549");
  const guardSource = stage(s, "FREE549"); const opponent = stage(s, "B549", "battle", "p2");
  const energy = stage(s, "ENERGY549", "energy"); stage(s, "ENERGY549", "energy", "p2");
  s.pending.push({ card: priced, master: "p1", skillIndex: 0, trigger: "played" });
  s.pending.push({ card: opponent, master: "p2", skillIndex: 0, trigger: "played" });
  s.pending.push({ card: free, master: "p1", skillIndex: 0, trigger: "played" });
  s.pending.push(missingHookIdentity(guardSource, "p1"));
  const oldOffer = reload(s);
  oldOffer.pendingOrder = { master: "p1", turnPlayer: "p1", queue: reload(s).pending, candidates: [0, 2, 3] };
  oldOffer.prompt = { kind: "orderPending", player: "p1", candidates: [0, 2, 3] };
  const staleTurn = reload(oldOffer); staleTurn.turnPlayer = "p2";
  const turnBefore = JSON.stringify(staleTurn);
  assert.throws(() => order(staleTurn, 0), IllegalAction);
  assert.equal(JSON.stringify(staleTurn), turnBefore, "a stale turn is rejected before the sentinel preflight");
  const staleQueue = reload(oldOffer); staleQueue.pending[0].subject = guardSource;
  const queueBefore = JSON.stringify(staleQueue);
  assert.throws(() => order(staleQueue, 0), IllegalAction);
  assert.equal(JSON.stringify(staleQueue), queueBefore, "changed provenance is rejected before the sentinel preflight");
  const attempted = order(oldOffer, 0);
  assertPrivateInterruption(attempted.state);
  assert.equal(draws(attempted.events), 0);
  assert.equal(attempted.events.filter((event) => event.type === "skill").length, 0);
  assert.equal(attempted.state.cards[energy].mode, "active", "no Auto price is charged before the guard interrupts");
  const events: GameEvent[] = [];
  run(ctx, dbs, s, events);
  assertPrivateInterruption(s);
  assert.equal(draws(events), 0);
  assert.equal(events.filter((event) => event.type === "skill").length, 0);
  assert.equal(s.cards[energy].mode, "active");
}
// The turn player's real Auto still has priority over an opposing master's
// guard. When that master becomes next, its guard preempts its own pending Auto.
{
  const s = main(); const turnAuto = stage(s, "FREE549"); const otherAuto = stage(s, "B549", "battle", "p2");
  const guardSource = stage(s, "FREE549", "battle", "p2"); const otherEnergy = stage(s, "ENERGY549", "energy", "p2");
  s.pending.push({ card: otherAuto, master: "p2", skillIndex: 0, trigger: "played" });
  s.pending.push({ card: turnAuto, master: "p1", skillIndex: 0, trigger: "played" });
  s.pending.push(missingHookIdentity(guardSource, "p2"));
  const events: GameEvent[] = [];
  run(ctx, dbs, s, events);
  assertPrivateInterruption(s);
  assert.equal(draws(events), 1, "the turn player's Auto resolves before the other master's guard");
  assert.equal(events.filter((event) => event.type === "skill" && event.card === otherAuto).length, 0);
  assert.equal(s.cards[otherEnergy].mode, "active");
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
// A compiler-derived, supported price has a payable later branch. Resting the
// source first makes every three-card discard fail the final self-rest; that
// branch is pruned before it spends the 2,000-state search budget.
{
  const state = main();
  const source = stage(state, "BUDGET549");
  const other = stage(state, "ENERGY549");
  while (state.sides.p1.zones.hand.length < 20) {
    const id = state.sides.p1.zones.deck[0];
    assert.ok(moveCard(state, dbs, id, "hand", { owner: "p1" }).ok);
  }
  const compiled = scripts.BUDGET549.bySkill[0];
  assert.deepEqual(compiled.unsupported, []);
  const ops = compiled.price?.ops;
  assert.ok(ops);
  assert.deepEqual(ops.map((op) => op.op), ["choose", "switchMode", "choose", "moveTo", "switchMode"]);
  const frame: ScriptFrame = { ops, ip: 0, vars: {}, card: source, master: "p1", skillIndex: 0, trigger: "played" };
  const before = JSON.stringify(state);
  const payable = structuredClone(state);
  const payableFrame = structuredClone(frame);
  payable.programs = [];
  assert.equal(stepScript(automaticPriceHost(ctx, dbs, payable, []), payableFrame), "wait");
  assert.equal(payable.prompt.kind, "chooseCards");
  if (payable.prompt.kind === "chooseCards") assert.deepEqual(payable.prompt.choice.candidates, [source, other]);
  payable.lastChoice = [other];
  assert.equal(canFinishAutomaticPrice(ctx, dbs, payable, payableFrame), true, "the later first choice has a complete payable continuation");
  assert.equal(canFinishAutomaticPrice(ctx, dbs, state, frame), true, "the dead source-first branch cannot consume the budget before a payable choice");
  assert.equal(JSON.stringify(state), before, "preflight changes no real game state");
  const sides = JSON.stringify(state.sides);
  const cards = JSON.stringify(state.cards);
  const events = pend(state, source);
  assert.equal(state.prompt.kind, "chooseMode");
  assert.equal(JSON.stringify(state.sides), sides, "planning takes no payment");
  assert.equal(JSON.stringify(state.cards), cards, "no mode or once-use is spent");
  assert.equal(draws(events), 0);
  assert.equal(events.some((event) => event.type === "skill"), false);
  const declined = answer(state, declines(state));
  assert.equal(declined.state.prompt.kind, "main");
  assert.equal(JSON.stringify(declined.state.sides), sides);
  assert.equal(declined.events.some((event) => event.type === "skill"), false);
  const paid = answer(state, 0);
  assert.equal(paid.state.prompt.kind, "chooseCards");
  assert.ok(paid.state.prompt.kind === "chooseCards" && JSON.stringify(paid.state.prompt.choice.candidates) === JSON.stringify([other]), "the impossible source pick is absent from the payment menu");
  let step = choose(reload(paid.state), [other]);
  assert.equal(step.state.prompt.kind, "chooseCards");
  assert.ok(step.state.prompt.kind === "chooseCards" && step.state.prompt.choice.candidates.length === 20);
  const paidCards: string[] = [];
  for (let pick = 0; pick < 3 && step.state.prompt.kind === "chooseCards"; pick++) {
    const id = step.state.prompt.choice.candidates[0]; paidCards.push(id);
    step = choose(reload(step.state), [id]);
  }
  assert.equal(paidCards.length, 3);
  assert.equal(step.state.prompt.kind, "main");
  assert.equal(step.state.cards[source].mode, "rest");
  assert.equal(step.state.cards[other].mode, "rest");
  assert.ok(paidCards.every((id) => step.state.sides.p1.zones.drop.includes(id)));
  assert.ok(step.events.findIndex((event) => event.type === "move" && paidCards.includes(event.card)) < step.events.findIndex((event) => event.type === "skill" && event.card === source), "all selected cards move as cost before the skill fires");
  assert.equal(step.events.filter((event) => event.type === "skill" && event.card === source).length, 1);
  assert.equal(draws(step.events), 1);
  assert.ok(!JSON.stringify(snapshot(state, "p2")).includes("autoCost"), "the other player receives no private price plan");
}
// The lookahead is deliberately limited to hand -> Drop followed by a pure
// self-rest. An intervening mode reset or source move can make rest payable;
// replacements and saved aliases require the ordinary search instead.
{
  const old = scripts.ACTION549.bySkill[0];
  const suffix: Op[] = [
    { op: "choose", sel: { side: "you", area: "hand", count: 3 }, as: "paid" },
    { op: "moveTo", target: { var: "paid" }, to: "drop" },
    { op: "switchMode", target: { sel: { special: "self" } }, mode: "rest" },
  ];
  script("ACTION549", [{ op: "draw", n: 1 }], suffix);
  const a = mainWith("ACTION549"); a.state.cards[a.source].mode = "rest";
  while (a.state.sides.p1.zones.hand.length < 20) {
    const id = a.state.sides.p1.zones.deck[0]; assert.ok(moveCard(a.state, dbs, id, "hand", { owner: "p1" }).ok);
  }
  const frame: ScriptFrame = { ops: suffix, ip: 0, vars: {}, card: a.source, master: "p1", skillIndex: 0, trigger: "played" };
  // A resumed choice can already contain the source even though the source
  // has left the hand. The interpreter still includes that saved pick in the
  // later move, so this shape must use normal search rather than the shortcut.
  const aliasOps: Op[] = [{ op: "choose", sel: { side: "you", area: "hand", count: 3 }, as: "paid" }, suffix[1], suffix[2]];
  const aliasFrame: ScriptFrame = { ...frame, ops: aliasOps, vars: { paid: [a.source] }, awaiting: "paid" };
  const aliased = reload(a.state);
  const resumed = structuredClone(aliasFrame);
  const aliasHost = automaticPriceHost(ctx, dbs, aliased, []);
  const savedPicks = aliased.sides.p1.zones.hand.slice(0, 2);
  for (const id of savedPicks) {
    assert.equal(stepScript(aliasHost, resumed), "wait");
    assert.equal(aliased.prompt.kind, "chooseCards");
    aliased.lastChoice = [id];
  }
  assert.throws(() => stepScript(aliasHost, resumed), IllegalAction);
  assert.ok(aliased.sides.p1.zones.drop.includes(a.source), "ordinary payment moved the saved source alias before final self-rest failed");
  assert.ok(savedPicks.every((id) => aliased.sides.p1.zones.drop.includes(id)));
  assert.equal(canFinishAutomaticPrice(ctx, dbs, a.state, aliasFrame), false, "the saved source alias remains an ordinary unpayable continuation");
  const wideAlias: ScriptFrame = { ...aliasFrame, ops: [{ op: "choose", sel: { side: "you", area: "hand", count: 4 }, as: "paid" }, suffix[1], suffix[2]] };
  const aliasStart = performance.now(); const aliasHeap = process.memoryUsage().heapUsed;
  assert.equal(canFinishAutomaticPrice(ctx, dbs, a.state, wideAlias), false, "dropping the retained source alias cannot pay the later self-rest");
  console.log(`auto-costs-549 saved alias 20-card proven false: ${(performance.now() - aliasStart).toFixed(1)} ms, heap delta ${((process.memoryUsage().heapUsed - aliasHeap) / 1048576).toFixed(1)} MiB`);
  const before = JSON.stringify(a.state.sides);
  assert.equal(canFinishAutomaticPrice(ctx, dbs, a.state, frame), false, "the already-rested source cannot pay this exact suffix");
  const ev = pend(a.state, a.source);
  assert.equal(a.state.prompt.kind, "main"); assert.ok(!a.state.outcome);
  assert.equal(JSON.stringify(a.state.sides), before); assert.equal(a.state.cards[a.source].mode, "rest");
  assert.ok(ev.some((event) => event.type === "note" && /unaffordable/.test(event.text)));
  assert.equal(ev.some((event) => event.type === "skill"), false);

  const reset: Op[] = [suffix[0], suffix[1], { op: "switchMode", target: { sel: { special: "self" } }, mode: "active" }, suffix[2]];
  assert.equal(canFinishAutomaticPrice(ctx, dbs, a.state, { ...frame, ops: reset }), true, "an intervening source mode reset remains payable");
  const moveSource: Op[] = [suffix[0], { op: "moveTo", target: { sel: { special: "self" } }, to: "energy" }, suffix[2]];
  assert.equal(canFinishAutomaticPrice(ctx, dbs, a.state, { ...frame, ops: moveSource }), true, "moving the source to another area can reset its mode");

  const otherChooser: Op[] = [{ op: "choose", sel: { side: "you", area: "hand", count: 3 }, as: "paid", chooser: "opponent" }, suffix[1], suffix[2]];
  assert.equal(canFinishAutomaticPrice(ctx, dbs, a.state, { ...frame, ops: otherChooser }), false, "a different chooser cannot stand the untouched source");
  const fromPool: Op[] = [{ op: "choose", sel: { side: "you", area: "hand", count: 3, fromVar: "pool" }, as: "paid" }, suffix[1], suffix[2]];
  assert.equal(canFinishAutomaticPrice(ctx, dbs, a.state, { ...frame, ops: fromPool, vars: { pool: a.state.sides.p1.zones.hand.slice() } }), false, "a saved pool wholly in Hand cannot restore the source");

  const inHand = reload(a.state);
  assert.ok(moveCard(inHand, dbs, a.source, "hand", { owner: "p1" }).ok);
  inHand.cards[a.source].mode = "rest";
  assert.equal(canFinishAutomaticPrice(ctx, dbs, inHand, frame), false, "neither Hand nor Drop can pay a self-rest");
  const replaced = reload(a.state);
  const target = replaced.sides.p1.zones.hand[0];
  addEffect(replaced, [], { master: "p1", source: a.source, target, kind: "replaceLeave", value: { to: "warp", optional: true }, until: "turn" });
  assert.throws(() => canFinishAutomaticPrice(ctx, dbs, replaced, frame), (err: unknown) => err instanceof NotYet && err.issue === "#549", "cost-move replacement bypasses the shortcut");
  // This synthetic [Permanent] is dormant at 20 hand cards, then becomes a
  // replacement after the first hand departure. Inspecting only current
  // statics would incorrectly prune the entire price before it can activate.
  const oldPermanent = scripts.PERM549.bySkill[0];
  scripts.PERM549.bySkill[0] = { ...oldPermanent, unsupported: [], ops: [{ op: "if", cond: { kind: "count", sel: { side: "you", area: "hand" }, atMost: 19 }, then: [
    { op: "replace", event: "leave", target: { sel: { side: "you", area: "hand" } }, optional: true, with: [{ op: "switchMode", target: { sel: { special: "self" } }, mode: "active" }] },
  ] }] };
  const conditional = reload(a.state);
  stage(conditional, "PERM549");
  const extra = conditional.sides.p1.zones.deck[0];
  assert.ok(moveCard(conditional, dbs, extra, "hand", { owner: "p1" }).ok);
  assert.equal(conditional.sides.p1.zones.hand.length, 20);
  assert.equal(staticsNow(ctx, dbs, conditional).some((effect) => effect.kind === "replaceLeave"), false);
  assert.throws(() => canFinishAutomaticPrice(ctx, dbs, conditional, frame), (err: unknown) => err instanceof NotYet && err.issue === "#549", "dormant conditional replacement bypasses the shortcut");
  assert.ok(moveCard(conditional, dbs, conditional.sides.p1.zones.hand[0], "drop", { owner: "p1" }).ok);
  assert.equal(staticsNow(ctx, dbs, conditional).some((effect) => effect.kind === "replaceLeave"), true);
  scripts.PERM549.bySkill[0] = oldPermanent;
  scripts.ACTION549.bySkill[0] = old;
}
// A different valid compiler-derived price needs the last three hand cards
// to satisfy its later Drop -> Warp choice. The planner proves a path without
// mutating the original state or relying on choice order.
{
  const state = main();
  const source = stage(state, "DROPWARP549");
  while (state.sides.p1.zones.hand.length < 20) {
    const id = state.sides.p1.zones.deck[0]; assert.ok(moveCard(state, dbs, id, "hand", { owner: "p1" }).ok);
  }
  for (const id of state.sides.p1.zones.hand.slice(-3)) state.cards[id].cardId = "TARGET549";
  const price = scripts.DROPWARP549.bySkill[0]?.price?.ops;
  assert.ok(price && price.map((op) => op.op).join(",") === "choose,moveTo,choose,moveTo", "the nested price is compiled from supported grammar");
  const frame: ScriptFrame = { ops: price, ip: 0, vars: {}, card: source, master: "p1", skillIndex: 0, trigger: "played" };
  const before = JSON.stringify(state);
  assert.equal(canFinishAutomaticPrice(ctx, dbs, state, frame), true);
  assert.equal(JSON.stringify(state), before);
}
// The same compiler-derived price is offered and paid in the actual Auto
// flow with a 30-card hand. A selected card is saved through JSON reload;
// later choices can use only the two remaining named cards. With only two
// names in that hand, the entire price is proved unaffordable before payment.
{
  const setup = (named: number) => {
    const state = main(); const source = stage(state, "DROPWARP549");
    while (state.sides.p1.zones.hand.length < 30) {
      const id = state.sides.p1.zones.deck[0];
      assert.ok(moveCard(state, dbs, id, "hand", { owner: "p1" }).ok);
    }
    const targets = named ? state.sides.p1.zones.hand.slice(-named) : [];
    for (const id of targets) state.cards[id].cardId = "TARGET549";
    return { state, source, targets };
  };
  const payable = setup(3);
  const start = performance.now();
  const before = JSON.stringify(payable.state);
  const offerEvents = pend(payable.state, payable.source);
  assert.equal(payable.state.prompt.kind, "chooseMode");
  assert.equal(JSON.stringify(payable.state.sides), JSON.stringify(JSON.parse(before).sides));
  assert.equal(draws(offerEvents), 0);
  let step = answer(payable.state, 0);
  assert.equal(step.state.prompt.kind, "chooseCards");
  for (let i = 0; i < 3; i++) {
    assert.equal(step.state.prompt.kind, "chooseCards");
    assert.deepEqual(step.state.prompt.choice.candidates, payable.targets.slice(i), "only choices that can complete the later named Drop price stay on the menu");
    step = choose(reload(step.state), [payable.targets[i]]);
  }
  assert.equal(step.state.prompt.kind, "main");
  assert.ok(payable.targets.every((id) => step.state.sides.p1.zones.warp.includes(id)));
  assert.ok(payable.targets.every((id) => !step.state.sides.p1.zones.hand.includes(id)));
  assert.equal(step.events.filter((event) => event.type === "skill" && event.card === payable.source).length, 1);
  assert.equal(draws(step.events), 1);
  assert.ok(step.events.findIndex((event) => event.type === "move" && event.card === payable.targets[0]) < step.events.findIndex((event) => event.type === "skill" && event.card === payable.source));
  console.log(`auto-costs-549 named transfer 30-card payable: ${(performance.now() - start).toFixed(1)} ms`);

  const short = setup(2);
  const shortBefore = JSON.stringify(short.state.sides);
  const shortStart = performance.now();
  const noPay = pend(short.state, short.source);
  assert.equal(short.state.prompt.kind, "main");
  assert.equal(JSON.stringify(short.state.sides), shortBefore);
  assert.equal(noPay.some((event) => event.type === "skill"), false);
  assert.ok(noPay.some((event) => event.type === "note" && /unaffordable/.test(event.text)));
  console.log(`auto-costs-549 named transfer 30-card impossible: ${(performance.now() - shortStart).toFixed(1)} ms`);
  const shown = setup(0);
  const visible = shown.state.sides.p1.zones.hand.slice(-3);
  shown.state.cards[visible[0]].cardId = "TARGET_CASE549";
  shown.state.cards[visible[1]].cardId = "TARGET_ALIAS549";
  shown.state.cards[visible[2]].cardId = "TARGET549";
  const shownPrice = scripts.DROPWARP549.bySkill[0]?.price?.ops;
  assert.ok(shownPrice);
  const shownFrame: ScriptFrame = { ops: shownPrice, ip: 0, vars: {}, card: shown.source, master: "p1", skillIndex: 0, trigger: "played" };
  assert.equal(canFinishAutomaticPrice(ctx, dbs, shown.state, shownFrame), true, "the authoritative selector accepts a case-folded name and an additional name");
  const shownOffer = pend(shown.state, shown.source);
  assert.equal(shown.state.prompt.kind, "chooseMode"); assert.equal(draws(shownOffer), 0);
  const shownPaid = answer(shown.state, 0);
  assert.equal(shownPaid.state.prompt.kind, "chooseCards");
  assert.deepEqual(shownPaid.state.prompt.choice.candidates, visible);
  const back = setup(0);
  const backVisible = back.state.sides.p1.zones.hand.slice(-3);
  back.state.cards[backVisible[0]].cardId = "TARGET_CASE549";
  back.state.cards[backVisible[1]].cardId = "TARGET_ALIAS549";
  back.state.cards[backVisible[2]].cardId = "TARGET_BACK549";
  back.state.cards[backVisible[2]].flipped = true;
  const backFrame: ScriptFrame = { ...shownFrame, card: back.source };
  assert.equal(canFinishAutomaticPrice(ctx, dbs, back.state, backFrame), false, "moving the shown back face from hand resets it, so the later Drop choice has only two matching names");
  const price = scripts.DROPWARP549.bySkill[0]?.price?.ops;
  assert.ok(price && price[0].op === "choose");
  const otherChooser: Op[] = [{ ...price[0], chooser: "opponent" }, ...price.slice(1)];
  const outsideProof: ScriptFrame = { ops: otherChooser, ip: 0, vars: {}, card: short.source, master: "p1", skillIndex: 0, trigger: "played" };
  const unknownStart = performance.now(); const unknownHeap = process.memoryUsage().heapUsed;
  assert.equal(canFinishAutomaticPrice(ctx, dbs, short.state, outsideProof), false, "the opponent chooser cannot supply a third missing named card");
  assert.equal(canFinishAutomaticPrice(ctx, dbs, shown.state, { ...outsideProof, card: shown.source }), true, "a different chooser still has a complete payable named transfer");
  console.log(`auto-costs-549 other chooser 30-card decided: ${(performance.now() - unknownStart).toFixed(1)} ms, heap delta ${((process.memoryUsage().heapUsed - unknownHeap) / 1048576).toFixed(1)} MiB`);
}
// A supported price may place its selected card under a named host. The host
// and the actual under-pile membership are part of payment, including after
// a saved card choice. Missing hosts do not turn into a free skill.
{
  const old = scripts.ACTION549.bySkill[0];
  const under: Op[] = [
    { op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "paid" },
    { op: "moveTo", target: { var: "paid" }, to: "under", under: { sel: { special: "self" } } },
  ];
  script("ACTION549", [{ op: "draw", n: 1 }], under);
  const a = mainWith("ACTION549"); const target = a.state.sides.p1.zones.hand[0];
  pend(a.state, a.source);
  assert.equal(a.state.prompt.kind, "chooseMode");
  const paid = answer(a.state, 0);
  assert.equal(paid.state.prompt.kind, "chooseCards");
  const resolved = choose(reload(paid.state), [target]);
  assert.equal(resolved.state.prompt.kind, "main");
  assert.ok(resolved.state.cards[a.source].under.includes(target));
  assert.equal(draws(resolved.events), 1);
  assert.ok(resolved.events.some((event) => event.type === "stack"));
  assert.ok(resolved.events.findIndex((event) => event.type === "stack") < resolved.events.findIndex((event) => event.type === "skill"));
  script("ACTION549", [{ op: "draw", n: 1 }], [{ ...under[0] }, { op: "moveTo", target: { var: "paid" }, to: "under", under: { sel: { special: "subject" } } }]);
  const missing = mainWith("ACTION549"); const before = JSON.stringify(missing.state.sides);
  const events = pend(missing.state, missing.source);
  assert.equal(JSON.stringify(missing.state.sides), before);
  assert.equal(draws(events), 0); assert.ok(events.some((event) => event.type === "note" && /unaffordable/.test(event.text)));
  scripts.ACTION549.bySkill[0] = old;
}
// A conditional price charges the branch selected on the live board. Modal
// prices save the inner option across reload and settle exactly one branch.
{
  const old = scripts.ACTION549.bySkill[0];
  const rest: Op = { op: "switchMode", target: { sel: { special: "self" } }, mode: "rest" };
  const drop: Op = { op: "moveTo", target: { sel: { special: "self" } }, to: "drop" };
  const trueCond = { kind: "all" as const, conds: [] };
  script("ACTION549", [{ op: "draw", n: 1 }], [{ op: "if", cond: trueCond, then: [rest], else: [drop] }]);
  const yes = mainWith("ACTION549"); pend(yes.state, yes.source);
  assert.equal(yes.state.prompt.kind, "chooseMode");
  const yesPaid = answer(yes.state, 0);
  assert.equal(yesPaid.state.cards[yes.source].mode, "rest"); assert.equal(draws(yesPaid.events), 1);
  script("ACTION549", [{ op: "draw", n: 1 }], [{ op: "if", cond: { kind: "not", cond: trueCond }, then: [rest], else: [drop] }]);
  const no = mainWith("ACTION549"); pend(no.state, no.source);
  const noPaid = answer(no.state, 0);
  assert.ok(noPaid.state.sides.p1.zones.drop.includes(no.source)); assert.equal(draws(noPaid.events), 1);
  script("ACTION549", [{ op: "draw", n: 1 }], [{ op: "chooseMode", modes: [{ label: "Rest the source", ops: [rest] }, { label: "Place the source in Drop", ops: [drop] }] }]);
  const modal = mainWith("ACTION549"); pend(modal.state, modal.source);
  const offered = answer(modal.state, 0);
  assert.equal(offered.state.prompt.kind, "chooseMode");
  assert.deepEqual(offered.state.prompt.options, ["Rest the source", "Place the source in Drop"]);
  const chosen = answer(reload(offered.state), 1);
  assert.ok(chosen.state.sides.p1.zones.drop.includes(modal.source));
  assert.equal(draws(chosen.events), 1);
  assert.equal(chosen.events.filter((event) => event.type === "skill").length, 1);
  script("ACTION549", [{ op: "draw", n: 1 }], [{ op: "chooseMode", modes: [{ label: "Free", ops: [] }, { label: "Rest", ops: [rest] }] }]);
  const unsafe = mainWith("ACTION549");
  const refused = pend(unsafe.state, unsafe.source);
  assert.equal(unsafe.state.outcome?.kind, "interrupted");
  assert.equal(unsafe.state.outcome?.privateContext?.issue, "#549");
  assert.equal(draws(refused), 0);
  scripts.ACTION549.bySkill[0] = old;
}
// Revealing a present public target is itself an observable price; an empty
// reveal cannot pay it. A shuffle is an adjunct only after another payment
// and with no later price step depending on the new deck order.
{
  const old = scripts.ACTION549.bySkill[0];
  const reveal: Op = { op: "reveal", sel: { side: "you", area: "hand" }, as: "shown" };
  script("ACTION549", [{ op: "draw", n: 1 }], [reveal]);
  const present = mainWith("ACTION549"); pend(present.state, present.source);
  assert.equal(present.state.prompt.kind, "chooseMode");
  const shown = answer(present.state, 0);
  assert.equal(draws(shown.events), 1);
  assert.ok(shown.events.findIndex((event) => event.type === "note" && /revealed/.test(event.text)) < shown.events.findIndex((event) => event.type === "skill"));
  const absent = mainWith("ACTION549");
  for (const id of [...absent.state.sides.p1.zones.hand]) assert.ok(moveCard(absent.state, dbs, id, "drop", { owner: "p1" }).ok);
  const noReveal = pend(absent.state, absent.source);
  assert.equal(absent.state.prompt.kind, "main"); assert.equal(draws(noReveal), 0);
  assert.ok(noReveal.some((event) => event.type === "note" && /unaffordable/.test(event.text)));
  const drop: Op = { op: "moveTo", target: { sel: { special: "self" } }, to: "drop" };
  script("ACTION549", [{ op: "draw", n: 1 }], [drop, { op: "shuffle" }]);
  const shuffled = mainWith("ACTION549"); pend(shuffled.state, shuffled.source);
  assert.equal(shuffled.state.prompt.kind, "chooseMode");
  const paid = answer(shuffled.state, 0);
  assert.ok(paid.state.sides.p1.zones.drop.includes(shuffled.source)); assert.equal(draws(paid.events), 1);
  assert.ok(paid.events.findIndex((event) => event.type === "note" && /shuffles/.test(event.text)) < paid.events.findIndex((event) => event.type === "skill"));
  for (const invalid of [[{ op: "shuffle" }], [{ op: "shuffle" }, drop]] as Op[][]) {
    script("ACTION549", [{ op: "draw", n: 1 }], invalid);
    const s = mainWith("ACTION549"); pend(s.state, s.source);
    assert.equal(s.state.outcome?.kind, "interrupted"); assert.equal(s.state.outcome?.privateContext?.issue, "#549");
  }
  scripts.ACTION549.bySkill[0] = old;
}
// The compiler's mandatory hand-to-Drop action pays before its optional
// "if you do" shuffle. Completion is still checked against the live move:
// too few cards or a replacement to Warp cannot activate the Auto.
{
  const compiled = scripts.CONDSHUFFLE549.bySkill[0].price?.ops;
  assert.deepEqual(compiled?.map((op) => op.op), ["choose", "moveTo", "if"]);
  assert.equal(compiled?.[2].op, "if");
  assert.equal(compiled?.[2].op === "if" ? compiled[2].then[0]?.op : null, "shuffle");
  assert.ok(compiled);
  readableAutomaticPrice(compiled, "Aegis", "#595");

  const declined = mainWith("CONDSHUFFLE549");
  const declinedBefore = JSON.stringify(declined.state.sides);
  assert.equal(draws(pend(declined.state, declined.source)), 0);
  assert.equal(declined.state.prompt.kind, "chooseMode");
  const no = answer(reload(declined.state), declines(declined.state));
  assert.equal(JSON.stringify(no.state.sides), declinedBefore);
  assert.equal(draws(no.events), 0);
  assert.equal(no.events.some((event) => event.type === "note" && /shuffles/.test(event.text)), false);

  const payable = mainWith("CONDSHUFFLE549"); pend(payable.state, payable.source);
  const selected = payable.state.sides.p1.zones.hand[0];
  assert.ok(selected);
  const opened = answer(reload(payable.state), 0);
  assert.equal(opened.state.prompt.kind, "chooseCards");
  const paid = choose(reload(opened.state), [selected]);
  assert.ok(paid.state.sides.p1.zones.drop.includes(selected));
  assert.equal(draws(paid.events), 1);
  const moved = paid.events.findIndex((event) => event.type === "move" && event.card === selected);
  const shuffled = paid.events.findIndex((event) => event.type === "note" && /shuffles/.test(event.text));
  const activated = paid.events.findIndex((event) => event.type === "skill" && event.card === payable.source);
  assert.ok(moved >= 0 && moved < shuffled && shuffled < activated, "full price, terminal shuffle, then activation");
  assert.equal(paid.state.prompt.kind, "main");

  const falseCond = { kind: "not" as const, cond: { kind: "all" as const, conds: [] } };
  const old = scripts.CONDSHUFFLE549.bySkill[0];
  try {
    scripts.CONDSHUFFLE549.bySkill[0] = { ...old, price: { ...old.price, condition: old.price?.condition ?? null, ops: [compiled[0], compiled[1], { op: "if", cond: falseCond, then: [{ op: "shuffle" }] }] } };
    const falseBranch = mainWith("CONDSHUFFLE549"); pend(falseBranch.state, falseBranch.source);
    const falseSelected = falseBranch.state.sides.p1.zones.hand[0];
    const falseOpened = answer(falseBranch.state, 0);
    const falsePaid = choose(reload(falseOpened.state), [falseSelected]);
    assert.ok(falsePaid.state.sides.p1.zones.drop.includes(falseSelected));
    assert.equal(draws(falsePaid.events), 1);
    assert.equal(falsePaid.events.some((event) => event.type === "note" && /shuffles/.test(event.text)), false);
  } finally { scripts.CONDSHUFFLE549.bySkill[0] = old; }

  try {
    scripts.CONDSHUFFLE549.bySkill[0] = { ...old, price: { ...old.price, condition: old.price?.condition ?? null,
      ops: [compiled[0], compiled[1], { op: "if", cond: { kind: "all", conds: [] }, then: [
        { op: "if", cond: { kind: "all", conds: [] }, then: [{ op: "shuffle" }] },
      ] }] } };
    const nested = mainWith("CONDSHUFFLE549"); pend(nested.state, nested.source);
    const opened = answer(nested.state, 0);
    const paidNested = choose(reload(opened.state), [nested.state.sides.p1.zones.hand[0]]);
    assert.equal(draws(paidNested.events), 1);
    assert.ok(paidNested.events.some((event) => event.type === "note" && /shuffles/.test(event.text)));
  } finally { scripts.CONDSHUFFLE549.bySkill[0] = old; }

  const three = scripts.CONDTHREE549.bySkill[0].price?.ops;
  assert.deepEqual(three?.map((op) => op.op), ["choose", "moveTo", "if"]);
  const impossible = mainWith("CONDTHREE549");
  while (impossible.state.sides.p1.zones.hand.length > 2) {
    const id = impossible.state.sides.p1.zones.hand[0];
    assert.ok(moveCard(impossible.state, dbs, id, "drop", { owner: "p1" }).ok);
  }
  const before = JSON.stringify(impossible.state.sides);
  const failed = pend(impossible.state, impossible.source);
  assert.equal(impossible.state.prompt.kind, "main");
  assert.equal(JSON.stringify(impossible.state.sides), before);
  assert.equal(draws(failed), 0);
  assert.ok(failed.some((event) => event.type === "note" && /unaffordable/.test(event.text)));

  const replaced = mainWith("CONDSHUFFLE549");
  const target = replaced.state.sides.p1.zones.hand[0];
  addEffect(replaced.state, [], { master: "p1", source: target, target, kind: "replaceLeave", value: { to: "warp", optional: true }, until: "turn" });
  pend(replaced.state, replaced.source);
  const replacementOpened = answer(replaced.state, 0);
  const replacementChosen = choose(reload(replacementOpened.state), [target]);
  assert.equal(replacementChosen.state.prompt.kind, "replaceMove");
  const diverted = answer(replacementChosen.state, 0);
  assert.ok(diverted.state.sides.p1.zones.warp.includes(target));
  assert.equal(draws(diverted.events), 0);
  assert.equal(diverted.events.some((event) => event.type === "skill" && event.card === replaced.source), false);
  assert.equal(diverted.events.some((event) => event.type === "note" && /shuffles/.test(event.text)), false);

  const unpaidConditional: Op[] = [{ op: "if", cond: falseCond, then: [{ op: "moveTo", target: { sel: { special: "self" } }, to: "drop" }] }];
  const optionalPrefix: Op[] = [{ op: "choose", sel: { side: "you", area: "hand", count: 1, upTo: true }, as: "chosen" }, { op: "moveTo", target: { var: "chosen" }, to: "drop" }, { op: "if", cond: falseCond, then: [{ op: "shuffle" }] }];
  for (const ops of [unpaidConditional, optionalPrefix, [compiled[0], compiled[1], { op: "if", cond: falseCond, then: [{ op: "shuffle" }] }, { op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "later" }] as Op[]]) {
    assert.throws(() => readableAutomaticPrice(ops), (err: unknown) => err instanceof NotYet && err.issue === "#549");
  }
  // Older action prices need no static positive-resource proof. They still
  // replay through the strict host; the new conditional adjunct simply does
  // not inherit a guaranteed paid prefix from these dynamic shapes.
  const existing: Op[][] = [
    [{ op: "choose", sel: { side: "you", area: "battle", count: 1 }, as: "marked" }, { op: "removeMarker", target: { var: "marked" }, n: 1 }],
    [{ op: "mill", n: { count: { side: "you", area: "hand" } } }],
    [{ op: "discard", n: { x: true } }],
    [{ op: "discard", n: 0 }],
  ];
  for (const ops of existing) {
    assert.doesNotThrow(() => readableAutomaticPrice(ops));
    assert.doesNotThrow(() => readableAutomaticPrice([...ops, { op: "shuffle" }]), "original top-level terminal adjunct remains admitted");
    assert.throws(() => readableAutomaticPrice([...ops, { op: "if", cond: falseCond, then: [{ op: "shuffle" }] }]),
      (err: unknown) => err instanceof NotYet && err.issue === "#549");
  }
  const beforeUnsafe = scripts.ACTION549.bySkill[0];
  try {
    for (const ops of [unpaidConditional, optionalPrefix]) {
      script("ACTION549", [{ op: "draw", n: 1 }], ops);
      const a = mainWith("ACTION549");
      const untouched = JSON.stringify(a.state.sides);
      const events = pend(a.state, a.source);
      assert.equal(a.state.outcome?.kind, "interrupted");
      assert.equal(a.state.outcome?.privateContext?.issue, "#549");
      assert.equal(JSON.stringify(a.state.sides), untouched);
      assert.equal(draws(events), 0);
    }
  } finally { scripts.ACTION549.bySkill[0] = beforeUnsafe; }

  // Existing terminal shuffles after a compulsory variable mode/concealment
  // or a wholly paying modal branch retain their verified path.
  const battlePick: Op = { op: "choose", sel: { side: "you", area: "battle", count: 1 }, as: "picked" };
  for (const transition of [{ op: "switchMode", target: { var: "picked" }, mode: "rest" }, { op: "hidden", target: { var: "picked" }, hidden: true }] as Op[]) {
    const oldAction = scripts.ACTION549.bySkill[0];
    try {
      script("ACTION549", [{ op: "draw", n: 1 }], [battlePick, transition, { op: "shuffle" }]);
      const a = mainWith("ACTION549"); pend(a.state, a.source);
      const offered = answer(a.state, 0);
      const settled = offered.state.prompt.kind === "chooseCards" ? choose(reload(offered.state), [a.source]) : offered;
      assert.equal(draws(settled.events), 1);
      assert.ok(settled.events.some((event) => event.type === "note" && /shuffles/.test(event.text)));
    } finally { scripts.ACTION549.bySkill[0] = oldAction; }
  }
  const modes: Op[] = [{ op: "chooseMode", modes: [
    { label: "Rest source", ops: [{ op: "switchMode", target: { sel: { special: "self" } }, mode: "rest" }] },
    { label: "Drop source", ops: [{ op: "moveTo", target: { sel: { special: "self" } }, to: "drop" }] },
  ] }, { op: "shuffle" }];
  const oldAction = scripts.ACTION549.bySkill[0];
  try {
    script("ACTION549", [{ op: "draw", n: 1 }], modes);
    const a = mainWith("ACTION549"); pend(a.state, a.source);
    const opened = answer(a.state, 0);
    const paidModal = answer(reload(opened.state), 0);
    assert.equal(draws(paidModal.events), 1);
    assert.ok(paidModal.events.some((event) => event.type === "note" && /shuffles/.test(event.text)));
  } finally { scripts.ACTION549.bySkill[0] = oldAction; }
}
// A compiled own-Life face turn pays only when the chosen card actually
// changes from face down to face up. The public turn event precedes the
// priced Auto, and its Life-area watcher answers at the next checkpoint.
{
  assert.deepEqual(scripts.FACEUP549.bySkill[0].price?.ops?.map((op) => op.op), ["choose", "faceUp"]);
  const a = mainWith("FACEUP549");
  const [target, alreadyUp] = a.state.sides.p1.zones.life;
  assert.ok(target && alreadyUp);
  a.state.cards[target].cardId = "FACEWATCH549";
  a.state.cards[alreadyUp].faceUp = true;
  const beforeOther = JSON.stringify(snapshot(a.state, "p2"));
  assert.ok(!beforeOther.includes(target), "a face-down Life card stays secret before payment");
  pend(a.state, a.source);
  assert.equal(a.state.prompt.kind, "chooseMode");
  const declined = answer(a.state, declines(a.state));
  assert.equal(declined.state.cards[target].faceUp, false);
  assert.equal(draws(declined.events), 0);
  const opened = answer(a.state, 0);
  assert.equal(opened.state.prompt.kind, "chooseCards");
  if (opened.state.prompt.kind === "chooseCards") {
    assert.ok(opened.state.prompt.choice.candidates.includes(target));
    assert.ok(!opened.state.prompt.choice.candidates.includes(alreadyUp));
  }
  const saved = JSON.stringify(opened.state);
  assert.throws(() => choose(opened.state, [alreadyUp]), IllegalAction);
  assert.equal(JSON.stringify(opened.state), saved);
  const stale = reload(opened.state); stale.cards[target].faceUp = true;
  const staleBefore = JSON.stringify(stale);
  assert.throws(() => choose(stale, [target]), IllegalAction);
  assert.equal(JSON.stringify(stale), staleBefore);
  const paid = choose(reload(opened.state), [target]);
  assert.equal(paid.state.cards[target].faceUp, true);
  assert.equal(paid.state.prompt.kind, "main");
  assert.equal(draws(paid.events), 2, "the priced Auto and Life-area watcher both resolve once");
  assert.ok(paid.events.findIndex((event) => event.type === "note" && /face up/.test(event.text)) < paid.events.findIndex((event) => event.type === "skill" && event.card === a.source));
  assert.ok(paid.events.some((event) => event.type === "skill" && event.card === target), "the face-up moment reaches the watcher checkpoint");
  assert.ok(snapshot(paid.state, "p2").view.them.lifeFaceUp.some((card) => card.id === target));
  assert.ok(!JSON.stringify(snapshot(paid.state, "p2")).includes("autoCost"));
  const impossible = mainWith("FACEUP549");
  for (const id of impossible.state.sides.p1.zones.life) impossible.state.cards[id].faceUp = true;
  const before = JSON.stringify(impossible.state.sides);
  const denied = pend(impossible.state, impossible.source);
  assert.equal(impossible.state.prompt.kind, "main");
  assert.equal(JSON.stringify(impossible.state.sides), before);
  assert.equal(draws(denied), 0);
  assert.ok(denied.some((event) => event.type === "note" && /unaffordable/.test(event.text)));
  const down = mainWith("FACEDOWN549");
  const downTarget = down.state.sides.p1.zones.life[0]; assert.ok(downTarget);
  down.state.cards[downTarget].faceUp = true;
  const otherDown = down.state.sides.p1.zones.life[1]; assert.ok(otherDown);
  down.state.cards[otherDown].faceUp = true;
  pend(down.state, down.source);
  const downOffer = answer(down.state, 0);
  assert.equal(downOffer.state.prompt.kind, "chooseCards");
  if (downOffer.state.prompt.kind === "chooseCards") assert.deepEqual(downOffer.state.prompt.choice.candidates, [downTarget, otherDown]);
  const turnedDown = choose(reload(downOffer.state), [downTarget]);
  assert.equal(turnedDown.state.cards[downTarget].faceUp, false);
  assert.ok(!JSON.stringify(snapshot(turnedDown.state, "p2")).includes(downTarget), "face-down Life is private again");
  assert.equal(draws(turnedDown.events), 1);
  assert.ok(turnedDown.events.findIndex((event) => event.type === "note" && /face down/.test(event.text)) < turnedDown.events.findIndex((event) => event.type === "skill"));
  for (const owner of ["#549", "#595"] as const) {
    assert.throws(() => readableAutomaticPrice([{ op: "faceUp", target: { sel: { special: "self" } } }], owner === "#549" ? "Auto" : "Aegis", owner),
      (err: unknown) => err instanceof NotYet && err.issue === owner, "an unproved face target stays typed unknown");
  }
}
// Aegis uses the same strict action-price host after its hand-color payment.
// Its compiled face-turn suffix is valid for that host too; colored cards are
// spent before the face-up note, and neither step is confused with activation.
{
  const old = scripts.AEGISFACE549.bySkill[0];
  scripts.AEGISFACE549.bySkill[0] = { ...old, price: { ...old.price!, ops: scripts.FACEUP549.bySkill[0].price!.ops! } };
  let s = main(); const source = stage(s, "AEGISFACE549");
  const energy = stage(s, "ENERGY549", "energy"); s.cards[energy].mode = "rest";
  const [red, blue] = s.sides.p1.zones.hand;
  assert.ok(red && blue);
  s.cards[red].cardId = "ENERGY549"; s.cards[blue].cardId = "V-BLUE";
  const life = s.sides.p1.zones.life[0]; assert.ok(life);
  s = rules.apply(ctx, s, { type: "endMain", player: "p1" }).state as VmState;
  s = rules.apply(ctx, s, { type: "charge", player: "p2", card: null }).state as VmState;
  s = rules.apply(ctx, s, { type: "attack", player: "p2", attacker: s.sides.p2.zones.leader[0], target: s.sides.p1.zones.leader[0] }).state as VmState;
  s = rules.apply(ctx, s, { type: "pass", player: "p2" }).state as VmState;
  assert.equal(s.prompt.kind, "combo");
  const declared = rules.apply(ctx, reload(s), { type: "activate", player: "p1", card: source, skill: 0 }); s = declared.state as VmState;
  assert.equal(s.prompt.kind, "chooseCards");
  assert.equal(declared.events.filter((event) => event.type === "skill" && event.card === source).length, 0);
  const colors = choose(s, [red]); s = colors.state;
  assert.ok(s.sides.p1.zones.drop.includes(red) && s.sides.p1.zones.drop.includes(blue));
  assert.equal(colors.events.filter((event) => event.type === "skill" && event.card === source).length, 0);
  assert.equal(s.cards[life].faceUp, false);
  assert.equal(s.prompt.kind, "chooseCards");
  const saved = JSON.stringify(s);
  assert.throws(() => choose(s, [red]), IllegalAction);
  assert.equal(JSON.stringify(s), saved);
  const paid = choose(reload(s), [life]);
  assert.equal(paid.state.cards[life].faceUp, true);
  assert.ok(paid.events.some((event) => event.type === "note" && /face up/.test(event.text)));
  assert.ok(paid.events.some((event) => event.type === "skill" && event.card === source));
  assert.ok(paid.events.findIndex((event) => event.type === "note" && /face up/.test(event.text)) < paid.events.findIndex((event) => event.type === "skill" && event.card === source));
  scripts.AEGISFACE549.bySkill[0] = old;
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

// Ordinary effects skip Leader departures under 3-1-2. That skip must never
// make an impossible mandatory payment look complete or fire a free Auto.
{
  const a = mainWith("ACTION549");
  const before = JSON.stringify(a.state);
  for (const to of ["drop", "under"] as const) {
    const ops: Op[] = [{ op: "moveTo", target: { sel: { side: "you", area: "leader" } }, to }];
    const frame: ScriptFrame = { ops, ip: 0, vars: {}, card: a.source, master: "p1", skillIndex: 0, trigger: "played" };
    assert.equal(canFinishAutomaticPrice(ctx, dbs, a.state, frame), false, "a skipped Leader move did not pay a cost");
    assert.equal(JSON.stringify(a.state), before, "the rejected preflight left the board unchanged");
  }
}

// An all-area Permanent in Hand can change names only after all three cost
// departures. Looking at one projected departure cannot prove this impossible.
{
  const old = scripts.PERM549.bySkill[0];
  try {
    scripts.PERM549.bySkill[0] = { ...old, ops: [{ op: "if", cond: { kind: "count", sel: { side: "you", area: "drop" }, atLeast: 3 },
      then: [{ op: "gains", names: ["Price Target"], allAreas: true, target: { sel: { side: "you", area: "drop", count: 99 } } }] }] };
    const a = mainWith("DROPWARP549");
    while (a.state.sides.p1.zones.hand.length < 20) {
      assert.ok(moveCard(a.state, dbs, a.state.sides.p1.zones.deck[0], "hand", { owner: "p1" }).ok);
    }
    const targets = a.state.sides.p1.zones.hand.slice(-3);
    a.state.cards[a.state.sides.p1.zones.hand[0]].cardId = "PERM549";
    const ops = scripts.DROPWARP549.bySkill[0].price!.ops!;
    const frame: ScriptFrame = { ops, ip: 0, vars: {}, card: a.source, master: "p1", skillIndex: 0, trigger: "played" };
    const played = reload(a.state); const guided = structuredClone(frame);
    const host = automaticPriceHost(ctx, dbs, played, []);
    for (const id of targets) {
      assert.equal(stepScript(host, guided), "wait"); played.lastChoice = [id];
    }
    assert.equal(stepScript(host, guided), "done", "all three Drop cards now match, so the forced second choice completes");
    assert.ok(targets.every((id) => played.sides.p1.zones.warp.includes(id)), "the guided legal price completed");
    assert.equal(canFinishAutomaticPrice(ctx, dbs, a.state, frame), true,
      "hint-only ordering preserves the all-area source and replays a complete legal payment");
  } finally { scripts.PERM549.bySkill[0] = old; }
}
