/** O5-02: legal root attacks, hidden-state invariance, deterministic budgets,
 * all emergency exits, live-state/RNG purity and named tactical cases.
 * Synthetic compiler-built cards; no database or provider.
 */
import assert from "node:assert/strict";
import { canonicalJson } from "../../src/lib/arena/replay-core.ts";
import { policyTurn, applyDecision, localStep } from "../../src/lib/arena/policy/boundary.ts";
import { localPolicy } from "../../src/lib/arena/policy/combat.ts";
import { searchDecision, searchPolicy, sampleComboHand, SEARCH_LIMITS } from "../../src/lib/arena/policy/search.ts";
import { localMemory } from "../../src/lib/arena/policy/main.ts";
import { policyRng } from "../../src/lib/arena/policy/rng.ts";
import { mainFixtureBundle, mainPhaseMatch, stage } from "./arena-policy-main-fixture.ts";
import { permutedFor } from "./arena-policy-permute.ts";

const bundle = await mainFixtureBundle();
const opening = await mainPhaseMatch(bundle);
const match = stage(opening, {
  p1: { hand: [], energy: [], battle: [{ cardId: "M-BIG", mode: "active" }, { cardId: "M-R2", mode: "active" }], leaderMode: "rest" },
  p2: { hand: [], energy: [], battle: [{ cardId: "M-BIG", mode: "rest" }], life: 2 },
});
const turn = policyTurn(match, "p1", 0);
const random = policyRng(663);
const before = canonicalJson(match);
const inputBefore = canonicalJson(turn.input);
const rngBefore = canonicalJson(random);
const heuristic = localPolicy()(turn.input, random);
const result = searchDecision(turn.input, random, { depth: 2 });
assert.equal(result.status, "searched");
assert.notEqual(result.answer.id, heuristic.answer.id, "sequence search avoids a distracting Battle Card KO and takes two Leader hits for lethal");
const action = turn.key.menu[result.answer.id];
assert.equal(action.type, "attack");
assert.equal((action as { target: string }).target, match.state.sides.p2.zones.leader[0]);
assert.ok(applyDecision(match, turn.key, result.answer).ok, "the searched root is currently legal");
assert.deepEqual(searchDecision(turn.input, random, { depth: 2 }), result, "node-budget search is deterministic");
assert.deepEqual(searchDecision(JSON.parse(JSON.stringify(turn.input)), JSON.parse(JSON.stringify(random))), result, "JSON reload retains the exact decision and RNG continuation");
const shallow = searchDecision(turn.input, random, { depth: 1 });
assert.equal((turn.key.menu[shallow.answer.id] as { target: string }).target, match.state.sides.p2.zones.battle[0], "one-ply values the distraction; the second attack changes the answer");
const sameTurn = (policy: ReturnType<typeof localPolicy>, initial = match) => {
  let played = initial;
  const memory = { p1: localMemory(policyRng(1)), p2: localMemory(policyRng(2)) };
  for (let n = 0; n < 60 && played.state.phase !== "over" && played.state.turn === initial.state.turn; n++) {
    const actor = (played.state.prompt as { player: "p1" | "p2" }).player;
    const step = localStep(played, actor, n, memory[actor], actor === "p1" ? policy : localPolicy());
    assert.ok(step.ok, "tactical continuation plays legally through actual engine battle windows");
    if (!step.ok) break;
    memory[actor] = step.memory;
    played = step.match;
  }
  return played;
};
assert.equal(sameTurn(searchPolicy()).state.phase, "over", "search's actual two-attack line wins this turn");
assert.notEqual(sameTurn(localPolicy()).state.phase, "over", "frozen heuristic misses the same-turn win");
// Added after the candidate was frozen for O5 holdouts; no search tuning from
// these results. Three attackers require re-planning beyond the two-ply horizon.
const threeHits = stage(opening, {
  p1: { hand: [], energy: [], leaderMode: "rest", battle: Array.from({ length: 3 }, () => ({ cardId: "M-R2", mode: "active" as const })) },
  p2: { hand: [], energy: [], life: 3, battle: [{ cardId: "M-WEAK", mode: "rest" }] },
});
const heldoutThree = sameTurn(searchPolicy(), threeHits);
assert.notEqual(heldoutThree.state.phase, "over", "negative tactical holdout: real Life-to-hand combo resources prevent the predicted three-hit finish");
assert.notEqual(sameTurn(localPolicy(), threeHits).state.phase, "over", "heuristic also fails to finish this holdout");
const blocked = stage(opening, {
  p1: { hand: [], energy: [], leaderMode: "rest", battle: [{ cardId: "M-R2", mode: "active" }] },
  p2: { hand: [], energy: [], life: 1, battle: [{ cardId: "M-BLOCK", mode: "active" }] },
});
assert.notEqual(sameTurn(searchPolicy(), blocked).state.phase, "over", "held-out stronger Blocker survives; a legal attack is not a promised win");

for (const [name, options, expected] of [
  ["node cap", { nodes: 1 }, "nodes"],
  ["zero nodes", { nodes: 0 }, "nodes"],
  ["reservation cap", { bytes: 1 }, "memory"],
  ["deadline", { stop: () => "deadline" as const }, "deadline"],
  ["cancellation", { stop: () => "cancelled" as const }, "cancelled"],
  ["memory pressure", { stop: () => "memory" as const }, "memory"],
] as const) {
  const stopped = searchDecision(turn.input, random, options);
  assert.equal(stopped.status, expected, name);
  assert.deepEqual({ answer: stopped.answer, rng: stopped.rng }, heuristic, `${name} discards partial results and sample randomness`);
  assert.ok(applyDecision(match, turn.key, stopped.answer).ok, `${name} fallback plays`);
  assert.ok(stopped.nodes <= SEARCH_LIMITS.nodes);
}
for (const reason of ["deadline", "cancelled", "memory"] as const) {
  let polls = 0;
  const stopped = searchDecision(turn.input, random, { stop: () => ++polls > 12 ? reason : null });
  assert.equal(stopped.status, reason, `mid-search ${reason}`);
  assert.ok(stopped.nodes > 0, "the stop occurred during the tree, not before it");
  assert.deepEqual({ answer: stopped.answer, rng: stopped.rng }, heuristic);
}

let changed = 0;
for (let salt = 1; salt <= 12; salt++) {
  const twin = permutedFor(match, "p1", salt);
  if (canonicalJson(twin.state) !== canonicalJson(match.state)) changed++;
  const shown = policyTurn(twin, "p1", 0);
  assert.deepEqual(shown.input, turn.input);
  assert.deepEqual(searchDecision(shown.input, random, { depth: 2 }), result);
  assert.deepEqual(sampleComboHand(shown.input.observation.them.handCount, random), sampleComboHand(turn.input.observation.them.handCount, random));
  assert.ok(applyDecision(twin, shown.key, result.answer).ok);
}
assert.equal(changed, 12, "hidden permutations really changed state");
const hiddenHand = stage(match, { p2: { hand: ["M-R1", "M-R2", "M-B1", "M-BIG"] } });
const hiddenTurn = policyTurn(hiddenHand, "p1", 0);
const sampled = searchDecision(hiddenTurn.input, random);
assert.equal(sampled.status, "searched");
assert.ok(sampled.rng.n > random.n, "nonempty hidden hand actually draws policy samples");
for (let salt = 1; salt <= 12; salt++) {
  const twin = permutedFor(hiddenHand, "p1", salt);
  assert.notEqual(canonicalJson(twin.state), canonicalJson(hiddenHand.state), "nonempty-hand permutation is nontrivial");
  const twinTurn = policyTurn(twin, "p1", 0);
  assert.deepEqual(searchDecision(twinTurn.input, random), sampled, "changing actual hidden hand identities/order cannot alter nonempty abstract samples");
  assert.ok(applyDecision(twin, twinTurn.key, sampled.answer).ok);
}
assert.equal(canonicalJson(match), before, "no live state or game RNG mutation");
assert.equal(canonicalJson(turn.input), inputBefore, "no input mutation");
assert.equal(canonicalJson(random), rngBefore, "no policy RNG mutation");
// Missing/hidden facts cannot be simulated. Skills are explicitly approximate
// and are executed only by the engine, so they do not forbid real-deck search.
const unsupported = structuredClone(turn.input);
unsupported.observation.you.battle[0].hidden = true;
assert.equal(searchDecision(unsupported, random).status, "unsupported");
const samples = Array.from({ length: 200 }, (_, i) => {
  const start = performance.now();
  searchDecision(turn.input, policyRng(i), { depth: 2 });
  return performance.now() - start;
}).sort((a, b) => a - b);
console.log(`arena-policy-search: actual two-attack win; two frozen tactical holdouts (three-hit prediction fails, stronger Blocker survives); 24 hidden twins; six budget exits and three mid-search exits legal/pure; ${result.nodes} nodes, ${result.reservedBytes} structural bytes; Node p95 ${samples[189].toFixed(3)}ms, max ${samples[199].toFixed(3)}ms`);
