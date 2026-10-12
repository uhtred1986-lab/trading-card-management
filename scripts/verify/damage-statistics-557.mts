/** DB-free #557 proof: damage events, not life movement, supply the end statistic. */
import assert from "node:assert/strict";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GameOver } from "../../src/components/arena/GameOver";
import { damageTaken } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { run } from "../../src/lib/arena/vm/flow";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, GameEvent, Prompt } from "../../src/lib/arena/types";
import { CTX, ENGINE, IMPL, card, findG, leaderOf, rulesFromCompiler, stagedG, zoneOf } from "./harness";

assert.equal(ENGINE, "rules", "run with --engine rules");
const rules = rulesetFor("dbs");
assert.ok(rules.ok);
const game = rules.definition;
const initial = stagedG({ battle: ["V1", "DOUBLE"], oppHand: ["E-LIFE"] }) as VmState;
assert.deepEqual(initial.damageTotals, { p1: 0, p2: 0 }, "a new game starts with a known, genuine zero");

const counter = findG(initial, "p2", "hand", "E-LIFE");
const first = findG(initial, "p1", "battle", "V1");
const strike = findG(initial, "p1", "battle", "DOUBLE");
const lifeBefore = zoneOf(initial, "p2", "life").length;
const actions: Action[] = [];
const events: GameEvent[] = [];
let state = initial;
const take = (action: Action) => {
  actions.push(action);
  const next = IMPL.apply(CTX, state, action);
  state = next.state as VmState;
  events.push(...next.events);
};

// The Counter pays one life to negate this attack. It moves a life card but
// neither emits damage nor changes the known zero total (1-13-2).
take({ type: "attack", player: "p1", attacker: first, target: leaderOf(state, "p2") });
assert.equal(state.prompt.kind, "counter");
take({ type: "counter", player: "p2", card: counter, alt: true });
assert.equal(zoneOf(state, "p2", "life").length, lifeBefore - 1);
assert.equal(events.filter((e) => e.type === "damage").length, 0);
assert.equal(damageTaken(state, "p2"), 0);
assert.equal(state.battle, null, "paying the Counter ended the first attack");

// The second attack's [Double Strike] takes two more life cards in one damage
// event. The event amount, not the three-card life delta, is the statistic.
take({ type: "attack", player: "p1", attacker: strike, target: leaderOf(state, "p2") });
for (let n = 0; n < 4; n++) {
  const prompt = state.prompt as Prompt;
  if (prompt.kind !== "combo") break;
  take({ type: "pass", player: prompt.player });
}
const damageEvents = events.filter((e) => e.type === "damage");
assert.equal(damageEvents.length, 1, "a resumed battle emits one completed damage event");
assert.equal(damageEvents[0].amount, 2);
assert.equal(damageEvents[0].cards.length, 2);
assert.equal(zoneOf(state, "p2", "life").length, lifeBefore - 3);
assert.deepEqual(state.damageTotals, { p1: 0, p2: 2 });
assert.equal(damageTaken(state, "p2"), 2);
assert.equal(damageTaken(state, "p1"), 0);
assert.deepEqual(initial.damageTotals, { p1: 0, p2: 0 }, "apply leaves the prior revision untouched");

// A real optional life replacement pauses the damage loop. No event or count
// is committed until the defender answers, and a JSON-reloaded answer records
// the completed event once. Keep this definition local to this proof.
const revealerId = "STAT-REVEALER";
const defs = {
  ...CTX.defs,
  [revealerId]: card(revealerId, {
    skill: "[Permanent] During your opponent's turn, if you would add a card from your life to your hand or place it in your Drop Area, you may reveal it and add it to your hand instead.",
  }),
};
const localCtx = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const paused = stagedG({ battle: ["CRIT"], oppBattle: ["V-BLUE"] }) as VmState;
paused.cards[findG(paused, "p2", "battle", "V-BLUE")].cardId = revealerId;
const critical = findG(paused, "p1", "battle", "CRIT");
let pauseResult = IMPL.apply(localCtx, paused, { type: "attack", player: "p1", attacker: critical, target: leaderOf(paused, "p2") });
const pauseEvents = [...pauseResult.events];
for (let n = 0; n < 4; n++) {
  const prompt = pauseResult.state.prompt as Prompt;
  if (prompt.kind !== "combo") break;
  pauseResult = IMPL.apply(localCtx, pauseResult.state, { type: "pass", player: prompt.player });
  pauseEvents.push(...pauseResult.events);
}
assert.equal(pauseResult.state.prompt.kind, "replaceMove");
assert.equal(pauseEvents.filter((e) => e.type === "damage").length, 0);
assert.equal(damageTaken(pauseResult.state, "p2"), 0);
const waiting = JSON.parse(JSON.stringify(pauseResult.state)) as VmState;
const answered = IMPL.apply(localCtx, waiting, { type: "chooseMode", player: "p2", index: 0 });
assert.deepEqual(answered.events.filter((e) => e.type === "damage").map((e) => e.amount), [1]);
assert.equal(damageTaken(answered.state, "p2"), 1);
assert.equal(damageTaken(waiting, "p2"), 0, "the suspended saved revision remains untouched");
assert.deepEqual(IMPL.apply(localCtx, waiting, { type: "chooseMode", player: "p2", index: 0 }), answered, "replaying the replacement answer cannot double count");

// The independent skill-program path uses ScriptHost.addDamageTaken. Its one
// emitted event raises the same saved total once, including after JSON reload.
const reloaded = JSON.parse(JSON.stringify(state)) as VmState;
assert.equal(damageTaken(reloaded, "p2"), 2);
reloaded.programs.unshift({ ops: [{ op: "damage", n: 1, side: "opponent" }], ip: 0, vars: {}, card: leaderOf(reloaded, "p1"), master: "p1" });
const skillEvents: GameEvent[] = [];
run(CTX, game, reloaded, skillEvents);
assert.deepEqual(skillEvents.filter((e) => e.type === "damage").map((e) => e.amount), [1]);
assert.equal(damageTaken(reloaded, "p2"), 3);
assert.equal(damageTaken(state, "p2"), 2, "a reloaded continuation cannot alter its saved predecessor");

// Replaying the same actions from the staged initial state gives the same
// result; a rejected stale Counter from the old window changes neither state
// nor the event-derived total.
let replay = structuredClone(initial) as VmState;
const replayEvents: GameEvent[] = [];
for (const action of actions) {
  const next = IMPL.apply(CTX, replay, action);
  replay = next.state as VmState;
  replayEvents.push(...next.events);
}
assert.deepEqual(replay, state);
assert.deepEqual(replayEvents, events);
const beforeRefusal = JSON.stringify(state);
assert.throws(() => IMPL.apply(CTX, state, { type: "counter", player: "p2", card: counter, alt: true }));
assert.equal(JSON.stringify(state), beforeRefusal);

// Old VM rows lack the lifetime counter. Never initialize one from a later
// event, because that would present a partial count as the whole match.
let old = structuredClone(initial) as VmState;
delete old.damageTotals;
assert.equal(damageTaken(old, "p2"), null);
for (const action of actions) old = IMPL.apply(CTX, old, action).state as VmState;
assert.equal(damageTaken(old, "p2"), null);
assert.equal(old.damageTotals, undefined);
assert.equal(zoneOf(old, "p2", "life").length, lifeBefore - 3);

const finished = IMPL.apply(CTX, initial, { type: "concede", player: "p1" }).state as VmState;
assert.equal(finished.prompt.kind, "gameOver");
assert.deepEqual(finished.damageTotals, { p1: 0, p2: 0 }, "a completed game with no damage reports real zero");

const overProps: ComponentProps<typeof GameOver> = {
  gameId: 557, outcome: { kind: "concession", winner: "p2", reason: "A player conceded." }, winnerName: "Claude",
  turns: 2, damage: { you: 0 as number | null, them: 0 as number | null },
  spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, review: null, aiEnabled: false,
  deckId: null, versus: false, draftFired: { count: 0, names: [] }, cards: [],
};
const screen = (props: typeof overProps) => renderToStaticMarkup(createElement(GameOver, props));
assert.match(screen(overProps), /0 \/ 0/, "a completed no-damage game visibly says zero");
assert.match(screen({ ...overProps, damage: { you: 0, them: 2 } }), /2 \/ 0/);
assert.match(screen({ ...overProps, damage: { you: null, them: null } }), /Unavailable/, "an old unsupported count is labelled unavailable");
assert.match(screen({ ...overProps, outcome: { kind: "interrupted", winner: null, reason: "Interrupted." }, damage: { you: 0, them: 2 } }), /Unavailable/, "an interrupted game never shows a partial total");

console.log("#557 damage statistics: cost, battle, skill, old save, reload, replay, refusal and end screen passed");
