/**
 * #552 (9-7-2, 9-7-3, 22-10-3-4, 22-10-4, 22-10-7, 22-10-8): counter motion
 * chains on the rules engine.
 *
 * The reading, from the Rule Manual only (no official Q&A on chained
 * counters is in the repo):
 *
 *   * Activating a [Counter] makes a counter motion (9-7-2, 22-10-4) and a
 *     counter timing follows before it resolves (9-7-3-3, 4-3-2-3).
 *   * Only a [Counter: Counter] is pending then, and only for the opponent of
 *     the player who activated the [Counter] (22-10-3-4) — so the answers
 *     alternate between the players, one motion per window (9-7-3-4-1).
 *   * Doing nothing ends that timing (9-7-3-4, 9-7-2-3) and the motions are
 *     processed in descending order (9-7-3-5); no checkpoint runs in between
 *     (9-7-3-5-2).
 *   * "Negate [Counter]" eliminates the motion it answers, whose effects fail
 *     to resolve (22-10-8, 22-10-8-1); the card still goes to the Drop
 *     (22-10-7-1) and its costs, paid on activation (22-10-4), stay paid.
 *
 * The manual says nothing on what a window offers a holder who cannot pay:
 * read literally, 22-10-4 lets a pending [Counter] be activated "by paying"
 * its costs, so an unaffordable one is not offered, and a window with nothing
 * to offer is not put (the attack and play windows already behave so).
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { buildObservation } from "../../src/lib/arena/policy/observation";
import { buildDecisions } from "../../src/lib/arena/policy/contract";
import { combatChoice } from "../../src/lib/arena/policy/combat";
import { secretAreas } from "../../src/lib/arena/policy/boundary";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId, Prompt } from "../../src/lib/arena/types";

const engine = RULES;
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;

const extra = (id: string, skill: string, energyCost = 1): CardDef => card(id, { type: "EXTRA", energyCost, power: null, comboCost: null, comboPower: null, skill });
const defs: Record<string, CardDef> = { ...DEFS,
  NEG552: extra("NEG552", "[Counter: Attack] Negate the attack."),
  NEGB552: extra("NEGB552", "[Counter: Attack] Negate the attack."),
  STOPA552: extra("STOPA552", "[Counter: Counter] Negate the [Counter]."),
  STOPB552: extra("STOPB552", "[Counter: Counter] Negate the [Counter]."),
  STOPX552: extra("STOPX552", "[Counter: Counter] Negate the [Counter].", 5),
  STOP2552: extra("STOP2552", "[Counter: Counter] Negate the [Counter].", 2),
  CPSTOP552: extra("CPSTOP552", "[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played."),
  BC552: card("BC552", { energyCost: 1, skill: null }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };

// #809: run every chain scenario below through hand-authored stored Counter:
// Counter records. The compiler-only route bypasses the readiness gate and
// therefore could not detect its obsolete blanket refusal.
for (const id of ["STOPA552", "STOPB552", "STOPX552", "STOP2552"]) {
  const row = { cardId: id, side: "front", skillIndex: 0,
    printed: defs[id].skill!, kind: "counter:counter", status: "confirmed",
    source: "user", trigger: [], cost: null, cond: null,
    ops: [{ op: "negate", what: "counter" }], unread: [],
  } as unknown as RuleRow;
  assert.deepEqual(runtimeSupportOfRow(row), { unsupported: [], unknown: [] });
  const loaded = rulesFromRows([row], { [id]: defs[id] })[id];
  assert.equal(loaded.complete, true, "stored counter is ready");
  assert.deepEqual(loaded.bySkill[0].unsupported, []);
  ctx.scripts![id] = loaded;
  assert.deepEqual(runtimeSupportOfRow({ ...row, unread: ["unread clause"] }).unsupported,
    ["unread clause"], "independent unread clauses still refuse readiness");
  assert.equal(rulesFromRows([{ ...row, unread: ["unread clause"] }], { [id]: defs[id] })[id].complete, false);
  assert.ok(runtimeSupportOfRow({ ...row, ops: [{ op: "play", target: { sel: { special: "self" } } }] }).unknown.length,
    "a counter that plays a card keeps its board-dependent uncertainty");
}

const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
function apply(s: VmState, action: Action) { return engine.apply(ctx, reload(s), action) as { state: VmState; events: GameEvent[] }; }
const legal = (s: VmState) => engine.legalActions(ctx, s);
function stage(s: VmState, p: PlayerId, id: string, area: "battle" | "energy" | "hand" | "drop"): string {
  const physical = s.sides[p].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok);
  return physical;
}
const rested = (s: VmState, p: PlayerId) => s.sides[p].zones.energy.filter((id) => s.cards[id].mode === "rest").length;
const counterPrompt = (s: VmState) => {
  assert.equal(s.prompt.kind, "counter");
  return s.prompt as Extract<Prompt, { kind: "counter" }>;
};
const skills = (ev: GameEvent[], id: string) => ev.filter((e) => e.type === "skill" && e.card === id).length;
const snapshot = (s: VmState, viewer: PlayerId) => buildSnapshot({ id: 552, revision: 1, mode: "versus", status: "playing",
  p1Name: "Player 1", p2Name: "Player 2", ctx, state: s, legal: [], log: [], beats: null, spotlight: null,
  spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
const refused = (s: VmState, action: Action, why: string) => {
  const before = JSON.stringify(s);
  assert.throws(() => apply(s, action), IllegalAction, why);
  assert.equal(JSON.stringify(s), before, `${why}: nothing changed`);
};

/** p2's Main Phase (p1 went first), both hands and energy emptied, then each side's energy staged. */
function board(seed: number, energy: { p1: string[]; p2: string[] }): VmState {
  let s = engine.createGame(ctx, { seed, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const step = (a: Action) => { s = apply(s, a).state; };
  step({ type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) step({ type: "pass", player: (s.prompt as { player: PlayerId }).player });
  step({ type: "endMain", player: "p1" }); step({ type: "charge", player: "p2", card: null });
  assert.equal(s.prompt.kind, "main"); assert.equal(s.turnPlayer, "p2");
  for (const p of ["p1", "p2"] as const) for (const id of [...s.sides[p].zones.hand, ...s.sides[p].zones.energy]) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  for (const p of ["p1", "p2"] as const) for (const id of energy[p]) stage(s, p, id, "energy");
  return s;
}
const attack = (s: VmState) => apply(s, { type: "attack", player: "p2", attacker: s.sides.p2.zones.leader[0], target: s.sides.p1.zones.leader[0] });
const counter = (player: PlayerId, card: string | null): Action => ({ type: "counter", player, card });

// ── who may answer what (22-10-3-4) ────────────────────────────────────────
{
  // A [Counter: Counter] answers nothing but a counter: held alone against an
  // attack, no window opens.
  const s = board(5520, { p1: ["V1"], p2: [] });
  stage(s, "p1", "STOPA552", "hand");
  assert.notEqual(attack(s).state.prompt.kind, "counter", "no [Counter: Attack] in hand: no attack window, [Counter: Counter] or not");
}

// ── an answered counter, and a declined window (9-7-3-3, 9-7-3-4) ─────────
{
  const s = board(5521, { p1: ["V1"], p2: ["V1"] });
  const neg = stage(s, "p1", "NEG552", "hand");
  const stopB = stage(s, "p2", "STOPB552", "hand");
  const negB = stage(s, "p2", "NEGB552", "hand");
  const a = attack(s).state;
  assert.equal(counterPrompt(a).window, "attack");
  assert.deepEqual(counterPrompt(a).candidates, [neg]);

  const declared = apply(a, counter("p1", neg));
  const d = declared.state;
  const w = counterPrompt(d);
  assert.equal(w.window, "counter", "9-7-3-3: a counter timing follows the activation");
  assert.equal(w.player, "p2", "22-10-3-4: the opponent of the counter's player is asked");
  assert.deepEqual(w.candidates, [stopB], "only a [Counter: Counter] is pending — not p2's [Counter: Attack]");
  assert.ok(d.sides.p1.zones.drop.includes(neg), "22-10-7: the activated [Counter] is in the Drop");
  assert.equal(rested(d, "p1"), 1, "22-10-4: its cost was paid on activation");
  assert.equal(skills(declared.events, neg), 1, "activated once");
  assert.ok(!declared.events.some((e) => e.type === "attackNegated"), "and it has not resolved yet");
  assert.equal(d.battle?.negated, false);
  assert.ok(d.programs[0]?.counterMotion?.asking, "the motion waits at the front of the queue");
  assert.ok(legal(d).some((l) => l.action.type === "counter" && l.action.card === null), "9-7-2-3: doing nothing is offered");
  assert.ok(legal(d).some((l) => l.action.type === "counter" && l.action.card === stopB));

  // Wrong actor, a card not pending here, a card that has left the hand: refused, nothing changed.
  refused(d, counter("p1", null), "p1 is not asked");
  refused(d, counter("p1", neg), "p1 is not asked");
  refused(d, counter("p2", negB), "a [Counter: Attack] does not answer a counter");
  const stale = reload(d); assert.ok(moveCard(stale, game, stopB, "drop", { owner: "p2" }).ok);
  refused(stale, counter("p2", stopB), "22-10-5: only from the hand");

  // Both viewers: the same question, and only its actor's hand is readable.
  for (const viewer of ["p1", "p2"] as const) {
    const v = snapshot(d, viewer);
    assert.equal(v.view.prompt.kind, "counter"); assert.equal(v.view.prompt.player, "p2");
  }
  assert.ok(!JSON.stringify(snapshot(d, "p1")).includes("STOPB552"), "p1 does not learn what p2 could answer with");
  assert.ok(JSON.stringify(snapshot(d, "p2")).includes("STOPB552"), "p2 sees their own hand");
  assert.ok(JSON.stringify(snapshot(d, "p1")).includes("NEG552"), "the activated [Counter] is public in the Drop");

  // The local policy answers the window — explicitly declining.
  const observation = buildObservation(snapshot(d, "p2"), "p2", [], {}, secretAreas(game, "p2"));
  const { decisions } = buildDecisions({ seat: "p2", revision: 1, observation, window: "counter", actor: "p2", legal: legal(d), choice: null, aliases: {} });
  const pick = combatChoice({ observation, decisions });
  assert.ok(pick, "the battle policy answers a [Counter: Counter] window");
  const chosen = decisions.decisions.find((x) => x.id === pick.id);
  assert.ok(chosen && chosen.kind === "menu" && chosen.type === "counter" && chosen.action.card === null, "by declining");
  assert.match(pick.how, /Counter: Counter/);

  // Declined (after a reload): the motion under it resolves (9-7-3-5).
  const declined = apply(reload(d), counter("p2", null));
  const t = declined.state;
  assert.ok(declined.events.some((e) => e.type === "attackNegated"), "the [Counter: Attack] resolved");
  assert.notEqual(t.prompt.kind, "counter", "and no window was put twice");
  assert.ok(t.sides.p2.zones.hand.includes(stopB), "nothing of p2's was spent");
  assert.equal(rested(t, "p2"), 0);
  assert.equal(rested(t, "p1"), 1, "p1's cost was not charged again");
  assert.equal(skills(declined.events, neg), 0, "nor announced again");
  assert.ok(!t.programs.some((f) => f.counterMotion), "no motion left on the queue");
  refused(t, counter("p2", null), "the window is closed: a stale answer");
}

// ── negation, two and three motions deep (9-7-3-5, 22-10-8) ───────────────
{
  // Two: p2's [Counter: Counter] negates p1's [Counter: Attack]; the attack goes on.
  const s = board(5522, { p1: ["V1"], p2: ["V1"] });
  const neg = stage(s, "p1", "NEG552", "hand");
  const stopB = stage(s, "p2", "STOPB552", "hand");
  const d = apply(attack(s).state, counter("p1", neg)).state;
  const answered = apply(d, counter("p2", stopB));
  const t = answered.state;
  assert.ok(!answered.events.some((e) => e.type === "attackNegated"), "22-10-8-1: the negated [Counter] did nothing");
  assert.ok(t.sides.p1.zones.life.length < d.sides.p1.zones.life.length, "the attack goes on and hits");
  assert.notEqual(t.prompt.kind, "counter", "p1 has nothing left to answer with: no window");
  assert.ok(t.sides.p1.zones.drop.includes(neg), "22-10-7-1: the negated card is still in the Drop");
  assert.ok(t.sides.p2.zones.drop.includes(stopB));
  assert.equal(rested(t, "p1"), 1, "its cost stays paid");
  assert.equal(rested(t, "p2"), 1, "and the answer's was paid once");
  assert.equal(skills(answered.events, stopB), 1);
  assert.ok(answered.events.some((e) => e.type === "note" && /NEG552 is countered/.test(e.text)));
  assert.ok(!t.programs.some((f) => f.counterMotion));
}
{
  // Three: p1 answers p2's answer; the last motion resolves first and negates
  // the one under it, so p1's [Counter: Attack] resolves after all.
  const s = board(5523, { p1: ["V1", "V1"], p2: ["V1"] });
  const neg = stage(s, "p1", "NEG552", "hand");
  const stopA = stage(s, "p1", "STOPA552", "hand");
  const stopB = stage(s, "p2", "STOPB552", "hand");
  const a = attack(s).state;
  assert.deepEqual(counterPrompt(a).candidates, [neg], "the attack window offers no [Counter: Counter]");
  const d1 = apply(a, counter("p1", neg)).state;
  const two = apply(d1, counter("p2", stopB));
  const d2 = two.state;
  const w = counterPrompt(d2);
  assert.equal(w.window, "counter"); assert.equal(w.player, "p1", "9-7-3-4-1: back to the timing, the other player asked");
  assert.deepEqual(w.candidates, [stopA]);
  assert.equal(d2.programs.filter((f) => f.counterMotion).map((f) => f.card).join(), [stopB, neg].join(), "motion 2 is in front of motion 1");
  assert.ok(!two.events.some((e) => e.type === "attackNegated" || (e.type === "note" && /countered/.test(e.text))), "nothing resolved while the chain is open");
  // A reload mid-chain resolves identically.
  const three = apply(reload(d2), counter("p1", stopA));
  const again = apply(reload(d2), counter("p1", stopA));
  assert.equal(JSON.stringify(again.state), JSON.stringify(three.state), "a reload mid-chain resolves the same");
  const t = three.state;
  assert.ok(three.events.some((e) => e.type === "note" && /STOPB552 is countered/.test(e.text)), "motion 3 negated motion 2");
  assert.ok(three.events.some((e) => e.type === "attackNegated"), "so motion 1 resolved");
  const order = three.events.findIndex((e) => e.type === "note" && /countered/.test(e.text));
  assert.ok(order >= 0 && order < three.events.findIndex((e) => e.type === "attackNegated"), "in descending order");
  assert.equal(rested(t, "p1"), 2, "each of p1's counters paid once");
  assert.equal(rested(t, "p2"), 1, "p2's once");
  for (const [p, id] of [["p1", neg], ["p1", stopA], ["p2", stopB]] as const) assert.ok(t.sides[p].zones.drop.includes(id));
  assert.equal(skills(three.events, stopA), 1);
  assert.equal(skills(three.events, neg) + skills(three.events, stopB), 0, "nothing announced twice");
  assert.ok(!t.programs.some((f) => f.counterMotion));
}

// ── an answer that cannot be paid is not offered (22-10-4) ────────────────
{
  const noEnergy = board(5524, { p1: ["V1"], p2: [] });
  const neg = stage(noEnergy, "p1", "NEG552", "hand");
  stage(noEnergy, "p2", "STOPB552", "hand");
  const r = apply(attack(noEnergy).state, counter("p1", neg));
  assert.notEqual(r.state.prompt.kind, "counter", "no energy: no window");
  assert.ok(r.events.some((e) => e.type === "attackNegated"), "and the counter resolved");

  const tooDear = board(5525, { p1: ["V1"], p2: ["V1"] });
  const neg2 = stage(tooDear, "p1", "NEG552", "hand");
  stage(tooDear, "p2", "STOPX552", "hand");
  const r2 = apply(attack(tooDear).state, counter("p1", neg2));
  assert.notEqual(r2.state.prompt.kind, "counter", "a 5-cost answer on 1 energy: no window");
  assert.ok(r2.events.some((e) => e.type === "attackNegated"));
}

// ── the play window: a [Counter: Play] answered in turn (9-6, 9-7-3) ──────
{
  const play = (seed: number) => {
    const s = board(seed, { p1: ["V1"], p2: ["V1", "V1"] });
    const cp = stage(s, "p1", "CPSTOP552", "hand");
    const stopB = stage(s, "p2", "STOPB552", "hand");
    const bc = stage(s, "p2", "BC552", "hand");
    let t = apply(s, { type: "play", player: "p2", card: bc }).state;
    if (t.prompt.kind === "payCost") t = apply(t, legal(t)[0].action).state;
    assert.equal(counterPrompt(t).window, "play");
    t = apply(t, counter("p1", cp)).state;
    const w = counterPrompt(t);
    assert.equal(w.window, "counter"); assert.equal(w.player, "p2"); assert.deepEqual(w.candidates, [stopB]);
    return { t, bc, stopB };
  };
  const negated = play(5526);
  const n = apply(negated.t, counter("p2", negated.stopB)).state;
  assert.ok(n.sides.p2.zones.battle.includes(negated.bc), "the [Counter: Play] was negated, so the card was played");
  assert.equal(n.prompt.kind, "main");
  const declined = play(5527);
  const dd = apply(declined.t, counter("p2", null)).state;
  assert.ok(dd.sides.p2.zones.drop.includes(declined.bc), "declined: the [Counter: Play] put the card in the Drop instead");
  assert.equal(dd.prompt.kind, "main");
}

// ── a 3-8-2 payment asked at the [Counter: Counter] window (restoreNativePrompt) ──
{
  const s = board(5528, { p1: ["V1"], p2: ["V1", "V1", "V-BLUE"] });
  const neg = stage(s, "p1", "NEG552", "hand");
  const stopB = stage(s, "p2", "STOP2552", "hand");
  const d = apply(attack(s).state, counter("p1", neg)).state;
  const asked = apply(d, counter("p2", stopB)).state;
  assert.equal(asked.prompt.kind, "payCost", "two different ways to pay 2: which is asked");
  assert.ok(asked.programs[0]?.counterMotion?.asking, "the window is still the one being answered");
  const paidWith = apply(reload(asked), { type: "payCost", player: "p2", option: 0 } as Action);
  const t = paidWith.state;
  assert.ok(t.sides.p2.zones.drop.includes(stopB), "the answer was activated at the restored window");
  assert.equal(rested(t, "p2"), 2, "paid once, with the energy chosen");
  assert.ok(!paidWith.events.some((e) => e.type === "attackNegated"), "and it negated p1's counter");
  assert.ok(t.sides.p1.zones.life.length < d.sides.p1.zones.life.length, "so the attack hit");
}

console.log("  ok  #552 counter chains: [Counter: Counter] windows, decline, negation, costs once, reload, refusals, projections, policy");
