/**
 * #646 (plan O2-03): the bounded Main-Phase policy (`src/lib/arena/policy/main.ts`) and its
 * wiring through the boundary (`localStep`), proved without a database or a provider.
 *
 *   1. A pure layer. `main.ts` loads nothing outside `policy/` and names no engine state, seed or
 *      ambient randomness — first shown to catch a deliberately added import and `Math.random`.
 *      The boundary that wires it stays browser-safe.
 *   2. Named scenarios, staged on real engine states (`arena-policy-main-fixture.ts`): a legal
 *      development play (the dearest that pays), plays that keep the colour another card needs
 *      (both the play order and the energy rested for a `payCost`), a favourable attack and never
 *      a losing one, `endMain` when nothing is worth doing, and an unlimited free activation used
 *      once — then the turn ends. The cycle guard ends a turn a looping policy would not, and
 *      interrupts when there is no way to end it.
 *   3. Every position: at every Main-Phase and payment question of #641's game, every #642
 *      scenario, #644's fixture and the strength games below, for the seat asked, the choice is
 *      an open decision that plays, is the same twice and from a JSON copy, draws no randomness,
 *      stays inside the work bound — and is unchanged in two permuted hidden states (#644's
 *      harness: the other hand, both decks and face-down life re-dealt and renamed).
 *   4. Cost. Per-decision wall time in Node for the policy alone and for the whole local step
 *      (input, policy, guard, move), against the #643 worker budgets (`docs/arena-worker-budgets.md`).
 *   5. Strength. Seeded games against `shortcutThen(uniformPolicy)` (the same shortcuts, every
 *      other choice uniform) on three fixtures, both seats: win/loss and life damage, reported
 *      with a Wilson interval; asserted only to be better in aggregate. The larger run is
 *      `npm run arena:policy-eval`.
 *
 * Run from the repo root:  npx tsx scripts/verify/arena-policy-main.mts   (part of `npm test`)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { checkImportGraph, diskRead, legacyEngineRule, policyLayerRule, policyLayerSourceViolations } from "../lib/import-graph.ts";
import { fixtureBundle, FIXTURE_REVISION, FIXTURE_SEED } from "./arena-browser-fixture.ts";
import { pick } from "./arena-browser-scenario.ts";
import { runScenario, scenarioIds } from "./arena-scenarios.ts";
import { policyFixtureBundle, POLICY_FIXTURE_REVISION, POLICY_FIXTURE_SEED } from "./arena-policy-fixture.ts";
import { mainFixtureBundle, mainPhaseMatch, MAIN_FIXTURE_REVISION, stage } from "./arena-policy-main-fixture.ts";
import { permutedFor } from "./arena-policy-permute.ts";
import { playDuel, quantile, summarise, wilson, type DuelResult } from "./arena-policy-duel.ts";
import type { PlayerId } from "../../src/lib/arena/types";
import { applyMove, createPinnedMatch, legalMoves, type PinnedMatch } from "../../src/lib/arena/browser.ts";
import { canonicalJson } from "../../src/lib/arena/replay-core.ts";
import { applyDecision, localStep, policyTurn } from "../../src/lib/arena/policy/boundary.ts";
import { answerFor, resolveAnswer, uniformPolicy, type Policy, type PolicyInput } from "../../src/lib/arena/policy/contract.ts";
import { policyRng } from "../../src/lib/arena/policy/rng.ts";
import { shortcutThen } from "../../src/lib/arena/policy/shortcuts.ts";
import { guardedDecide, localMemory, localPolicy, mainChoice, paymentChoice, MAIN_LIMITS, TURN_GUARD, type MainChoice } from "../../src/lib/arena/policy/main.ts";

const ROOT = process.cwd();
const started = Date.now();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const LOCAL = localPolicy(uniformPolicy);
const BASELINE = shortcutThen(uniformPolicy);
/**
 * For the named scenarios only: outside the Main Phase, decline (pass, no block, no counter) so a
 * scenario about the Main Phase is not decided by a random combo (#647 owns those windows).
 */
const DECLINE: Policy = (input, rng) => {
  const open = input.decisions.decisions;
  const no = open.find((d) => d.kind === "menu" && (d.type === "pass" || ("card" in d.action && d.action.card === null))) ?? open[0];
  return { answer: answerFor(input.decisions, no.id), rng };
};
const SCENARIO_POLICY = localPolicy(DECLINE);

// ---------------------------------------------------------------------------------------------
// 1. A pure layer.
{
  const entry = "src/lib/arena/policy/main.ts";
  const real = checkImportGraph(path.join(ROOT, entry), ROOT, diskRead, { forbidFile: policyLayerRule });
  assert.deepEqual(real.violations, [], "main.ts reaches outside the policy layer");
  assert.ok(real.files.every((f) => f.startsWith("src/lib/arena/policy/")), `main.ts loads only policy modules (${real.files.join(", ")})`);
  for (const f of real.files) assert.deepEqual(policyLayerSourceViolations(f, fs.readFileSync(path.join(ROOT, f), "utf8")), [], `${f} names engine state or ambient randomness`);
  const file = path.join(ROOT, entry);
  const base = fs.readFileSync(file, "utf8");
  const sabotaged = (extra: string) => (f: string) => (f === file ? `${base}\n${extra}\n` : diskRead(f));
  for (const [extra, expected] of [
    [`import { legalMoves } from "../browser";`, "policy layer reaches outside the policy layer src/lib/arena/browser.ts"],
    [`import { policyTurn } from "./boundary";`, "policy layer reaches outside the policy layer src/lib/arena/policy/boundary.ts"],
    [`import { generateJson } from "@/lib/ai/core";`, "server-only import @/lib/ai/core"],
  ] as const) {
    const caught = checkImportGraph(file, ROOT, sabotaged(extra), { forbidFile: policyLayerRule });
    assert.ok(caught.violations.some((v) => v.file === entry && v.reason === expected), `adding \`${extra}\` to main.ts is caught as "${expected}"`);
  }
  for (const [extra, expected] of [
    [`export const r = () => Math.random();`, "ambient time or randomness: Math.random"],
    [`export const t = () => performance.now();`, "ambient time or randomness: performance"],
  ] as const) assert.ok(policyLayerSourceViolations(entry, `${base}\n${extra}\n`).includes(expected), `the source scan catches "${expected}"`);
  const boundary = checkImportGraph(path.join(ROOT, "src/lib/arena/policy/boundary.ts"), ROOT, diskRead, { forbidFile: legacyEngineRule });
  assert.deepEqual(boundary.violations, [], "the boundary, with main.ts wired in, is browser-safe (#641's rule)");
  assert.ok(boundary.files.includes(entry), "the boundary wires main.ts");
  // The online opponent's provider path does not load the local policy.
  const opponent = checkImportGraph(path.join(ROOT, "src/lib/arena/ai/opponent.ts"), ROOT, diskRead, { forbidFile: () => null });
  assert.ok(!opponent.files.includes(entry), "ai/opponent.ts does not load the Main-Phase policy");
}

// ---------------------------------------------------------------------------------------------
// Helpers.
const choiceTimes: number[] = [];
const isOver = (m: PinnedMatch) => m.state.phase === "over";
const actorOf = (m: PinnedMatch): PlayerId | null => (isOver(m) ? null : ((m.state.prompt as { player?: PlayerId }).player ?? null));

function decide(input: PolicyInput): MainChoice | null {
  const t0 = performance.now();
  const c = mainChoice(input) ?? paymentChoice(input);
  choiceTimes.push(performance.now() - t0);
  return c;
}

/** The engine move the chosen decision plays, for `seat` at `match`. */
function chosenMove(match: PinnedMatch, seat: PlayerId, revision = 0) {
  const turn = policyTurn(match, seat, revision);
  const c = decide(turn.input);
  assert.ok(c, "the policy has a Main-Phase choice here");
  const r = resolveAnswer(turn.key, answerFor(turn.input.decisions, c.id));
  assert.ok(r.ok && r.actions.length === 1, `${c.id} resolves to one engine move`);
  return { choice: c, action: r.actions[0], turn };
}

const cardIdOf = (m: PinnedMatch, id: unknown) => m.state.cards[id as string]?.cardId;
const zone = (m: PinnedMatch, p: PlayerId, z: string) => (m.state.sides[p].zones as Record<string, string[]>)[z] ?? [];

/** Play `seat`'s turn with `policy` through the boundary until the prompt is no longer that seat's Main Phase (or `cap` steps). */
function playTurn(match: PinnedMatch, seat: PlayerId, policy: Policy, cap = 400) {
  let m = match;
  let memory = localMemory(policyRng(9));
  const ids: string[] = [];
  const guards: string[] = [];
  const startTurn = m.state.turn;
  for (let n = 0; n < cap; n++) {
    if (isOver(m) || m.state.turn !== startTurn) break;
    const actor = actorOf(m);
    if (!actor) break;
    const step = localStep(m, actor, 10_000 + n, actor === seat ? memory : localMemory(policyRng(3)), actor === seat ? policy : BASELINE);
    assert.ok(step.ok, `the local step plays (${JSON.stringify(step).slice(0, 300)})`);
    if (actor === seat) { memory = step.memory; ids.push(step.id); if (step.guard) guards.push(step.guard); }
    m = step.match;
  }
  return { match: m, ids, guards };
}

// ---------------------------------------------------------------------------------------------
// 2. Named scenarios.
const mainBundle = await mainFixtureBundle();
const opening = await mainPhaseMatch(mainBundle);
assert.equal(actorOf(opening), "p1");
assert.equal(opening.state.prompt.kind, "main");
const named: string[] = [];
const EMPTY_P2 = { battle: [] as { cardId: string; mode: "active" | "rest" }[] };

// 2a. Development: the dearest affordable card, not the cheap one, and it plays.
{
  const m = stage(opening, { p1: { hand: ["M-BIG", "M-WEAK"], energy: ["M-R1", "M-R1", "M-R1"], battle: [], leaderMode: "rest", energyMarkers: 0 }, p2: EMPTY_P2 });
  const plays = legalMoves(m).filter((l) => l.action.type === "play").map((l) => cardIdOf(m, (l.action as { card: string }).card)).sort();
  assert.deepEqual(plays, ["M-BIG", "M-WEAK"], "both plays are on offer");
  const { action, choice } = chosenMove(m, "p1");
  assert.equal(action.type, "play");
  assert.equal(cardIdOf(m, (action as { card: string }).card), "M-BIG", `the development play is the 25,000 card, not the 5,000 one (${choice.how})`);
  const after = applyMove(m, action).match;
  assert.ok(zone(after, "p1", "battle").some((id) => cardIdOf(after, id) === "M-BIG"), "…and it is in the Battle Area");
  named.push("develop");
}

// 2b. Colours, play order: with one Red and one Blue energy, the 2-cost Red card would spend both;
//     the two 1-cost cards (one of each colour) are played instead, and the turn plays both.
{
  const m = stage(opening, { p1: { hand: ["M-R2", "M-R1", "M-B1"], energy: ["M-R1", "M-B1"], battle: [], leaderMode: "rest", energyMarkers: 0 }, p2: EMPTY_P2 });
  const plays = legalMoves(m).filter((l) => l.action.type === "play").map((l) => cardIdOf(m, (l.action as { card: string }).card)).sort();
  assert.deepEqual(plays, ["M-B1", "M-R1", "M-R2"], "all three plays are on offer");
  const { action } = chosenMove(m, "p1");
  assert.notEqual(cardIdOf(m, (action as { card: string }).card), "M-R2", "the play that spends both colours is not chosen first");
  const turn = playTurn(m, "p1", SCENARIO_POLICY);
  const battle = zone(turn.match, "p1", "battle").map((id) => cardIdOf(turn.match, id)).sort();
  assert.deepEqual(battle, ["M-B1", "M-R1"], `the turn develops both one-colour cards (${battle.join(", ")})`);
  const playedIds = turn.ids.filter((id) => id.startsWith("m:play:")).map((id) => cardIdOf(m, (JSON.parse(id.slice("m:play:".length)) as { card: string }).card));
  assert.deepEqual(playedIds.sort(), ["M-B1", "M-R1"], `the 2-cost card is not played (${playedIds.join(", ")})`);
  named.push("colours: play order");
}

// 2c. Colours, payment: Red, Red, Blue energy; the 2-cost Red card can be paid Red+Red or Red+Blue.
//     The payment keeps the Blue for the Blue card, and the turn then plays that too.
{
  const m = stage(opening, { p1: { hand: ["M-R2", "M-B1"], energy: ["M-R1", "M-R1", "M-B1"], battle: [], leaderMode: "rest", energyMarkers: 0 }, p2: EMPTY_P2 });
  const r2 = legalMoves(m).find((l) => l.action.type === "play" && cardIdOf(m, (l.action as { card: string }).card) === "M-R2");
  assert.ok(r2, "the 2-cost play is offered");
  const asked = applyMove(m, r2.action).match;
  assert.equal(asked.state.prompt.kind, "payCost", "the engine asks which energy to rest");
  const { action, choice } = chosenMove(asked, "p1");
  assert.equal(action.type, "payCost");
  const paid = applyMove(asked, action).match;
  const activeBlue = zone(paid, "p1", "energy").filter((id) => cardIdOf(paid, id) === "M-B1" && paid.state.cards[id].mode === "active");
  assert.equal(activeBlue.length, 1, `the payment leaves the Blue energy active (${choice.how})`);
  const turn = playTurn(m, "p1", SCENARIO_POLICY);
  const playedIds = turn.ids.filter((id) => id.startsWith("m:play:")).map((id) => cardIdOf(m, (JSON.parse(id.slice("m:play:".length)) as { card: string }).card));
  assert.deepEqual(playedIds.sort(), ["M-B1", "M-R2"], `the turn plays both cards (${turn.ids.join(" | ")})`);
  named.push("colours: payment");
}

// 2d. A favourable attack: KO a rested Battle Card the attacker beats; never attack the rested card that wins.
{
  const m = stage(opening, {
    p1: { hand: [], energy: [], battle: [{ cardId: "M-R2", mode: "active" }], leaderMode: "active", energyMarkers: 0 },
    p2: { battle: [{ cardId: "M-R1", mode: "rest" }, { cardId: "M-BLOCK", mode: "rest" }], life: 6 },
  });
  const attacks = legalMoves(m).filter((l) => l.action.type === "attack");
  assert.ok(attacks.length >= 6, `attacks on the Leader and both rested cards are offered (${attacks.length})`);
  const { action, choice } = chosenMove(m, "p1");
  assert.equal(action.type, "attack");
  const a = action as { attacker: string; target: string };
  assert.equal(cardIdOf(m, a.target), "M-R1", `the attack KOs the 10,000 rested card (${choice.how})`);
  const turn = playTurn(m, "p1", SCENARIO_POLICY);
  const attacked = turn.ids.filter((id) => id.startsWith("m:attack:")).map((id) => JSON.parse(id.slice("m:attack:".length)) as { target: string });
  assert.ok(attacked.length >= 2, `both attackers swing during the turn (${turn.ids.join(" | ")})`);
  assert.ok(!attacked.some((x) => cardIdOf(m, x.target) === "M-BLOCK"), "no attack goes into the 20,000 card it cannot beat");
  named.push("favourable attack");
}

// 2e. Pass when appropriate: the only attack loses and would leave the attacker exposed — end the turn.
{
  const m = stage(opening, {
    p1: { hand: ["M-BIG"], energy: ["M-R1"], battle: [{ cardId: "M-WEAK", mode: "active" }], leaderMode: "rest", energyMarkers: 0 },
    p2: { battle: [{ cardId: "M-B1", mode: "active" }] },
  });
  const types = new Set(legalMoves(m).map((l) => l.action.type));
  assert.ok(types.has("attack") && types.has("endMain") && !types.has("play"), `an attack and endMain are open, no affordable play (${[...types].join(", ")})`);
  const { action, choice } = chosenMove(m, "p1");
  assert.equal(action.type, "endMain", `the turn ends (${choice.how})`);
  named.push("pass");
}

// 2f. No loop on an optional ability: an unlimited free [Activate: Main] is used once, then the
//     turn goes on and ends; the engine would have taken it again.
{
  const m = stage(opening, { p1: { hand: [], energy: [], battle: [{ cardId: "M-PUMP", mode: "active" }], leaderMode: "rest", energyMarkers: 0 }, p2: EMPTY_P2 });
  const activate = legalMoves(m).find((l) => l.action.type === "activate");
  assert.ok(activate, "the activation is offered");
  const once = applyMove(m, activate.action).match;
  assert.ok(legalMoves(once).some((l) => l.action.type === "activate"), "the engine offers the activation again after one use (the check is not vacuous)");
  const turn = playTurn(m, "p1", SCENARIO_POLICY);
  const used = turn.ids.filter((id) => id.startsWith("m:activate:")).length;
  assert.equal(used, 1, `the activation is used once (${used})`);
  assert.ok(turn.ids.includes("m:endMain:{\"type\":\"endMain\"}"), "the turn ends by the policy's own endMain");
  assert.equal(turn.guards.length, 0, "without needing the cycle guard");
  assert.notEqual(turn.match.state.turn, m.state.turn, "the turn is over");

  // A policy that activates whenever it can would loop; the guard ends that turn with a legal endMain.
  const greedy: Policy = (input, rng) => {
    const act = input.decisions.decisions.find((d) => d.kind === "menu" && d.type === "activate");
    return act ? { answer: answerFor(input.decisions, act.id), rng } : SCENARIO_POLICY(input, rng);
  };
  const looped = playTurn(m, "p1", greedy, TURN_GUARD.decisions + 20);
  assert.equal(looped.ids.filter((id) => id.startsWith("m:activate:")).length, TURN_GUARD.decisions, "the looping policy activates until the guard's decision limit");
  assert.equal(looped.guards.length, 1, `the guard takes over once (${looped.guards.join("; ")})`);
  assert.ok(/cycle guard: 151 decisions this turn — endMain/.test(looped.guards[0]), looped.guards[0]);
  assert.notEqual(looped.match.state.turn, m.state.turn, "and the turn ends");

  // The same position coming round: the fourth time, the guard ends the turn.
  const turnInput = policyTurn(m, "p1", 0).input;
  const stubborn: Policy = (input, rng) => ({ answer: answerFor(input.decisions, input.decisions.decisions.find((d) => d.kind === "menu" && d.type === "activate")!.id), rng });
  let memory = localMemory(policyRng(1));
  const seen: string[] = [];
  for (let k = 0; k < TURN_GUARD.repeats + 1; k++) {
    const g = guardedDecide(stubborn, turnInput, memory);
    assert.ok(g.ok);
    memory = g.memory;
    seen.push(g.guard ?? g.answer.id);
  }
  assert.ok(seen.slice(0, TURN_GUARD.repeats).every((x) => x.startsWith("m:activate:")), "the first visits are the policy's");
  assert.match(seen[TURN_GUARD.repeats], /^cycle guard: the same position 4 times this turn — endMain$/);
  // No way to end the turn: an interruption, not an invented move.
  const noExit: PolicyInput = { ...turnInput, decisions: { ...turnInput.decisions, decisions: turnInput.decisions.decisions.filter((d) => d.kind !== "menu" || (d.type !== "endMain" && d.type !== "pass")) } };
  const stuck = guardedDecide(stubborn, noExit, { ...localMemory(policyRng(1)), turn: noExit.observation.turn, decisions: TURN_GUARD.decisions });
  assert.ok(!stuck.ok && /neither endMain nor pass/.test(stuck.interrupted), "with no endMain or pass the guard interrupts");
  const viaBoundary = localStep(m, "p1", 0, { ...localMemory(policyRng(1)), turn: m.state.turn, decisions: TURN_GUARD.decisions }, stubborn);
  assert.ok(viaBoundary.ok && viaBoundary.guard, "through the boundary the tripped guard plays endMain");
  named.push("no loop (+ guard, + interruption)");
}

// 2g. The work bound: a decision whose scoring would exceed it stops, says so, and is still legal.
{
  const m = stage(opening, { p1: { hand: Array.from({ length: 20 }, (_, i) => (i % 2 ? "M-R1" : "M-B1")), energy: ["M-R1", "M-B1", "M-R1", "M-B1", "M-R1", "M-B1"], battle: [], leaderMode: "active", energyMarkers: 0 }, p2: EMPTY_P2 });
  const c = mainChoice(policyTurn(m, "p1", 0).input)!;
  assert.ok(c.work <= MAIN_LIMITS.work, `work ${c.work} is within ${MAIN_LIMITS.work}`);
  assert.ok(c.work > 100, `a 20-card hand makes real work (${c.work})`);
  named.push(`work bound (${c.work} steps for a 20-card hand)`);
}

// ---------------------------------------------------------------------------------------------
// 3. Every position.
const tally = { positions: 0, main: 0, payCost: 0, permutations: 0, nontrivial: 0, maxWork: 0, bounded: 0, guardTrips: 0 };
const seenTypes = new Set<string>();

function checkPosition(label: string, match: PinnedMatch, revision: number): void {
  const seat = actorOf(match);
  if (!seat) return;
  const turn = policyTurn(match, seat, revision);
  const w = turn.input.decisions.window;
  if (w !== "main" && w !== "payCost") return;
  const c = decide(turn.input);
  if (w === "payCost" && !c) return; // a payment question that names no payments is not this policy's
  const where = `${label} r${revision} ${seat} ${w}`;
  assert.ok(c, `${where}: the policy chooses`);
  tally.positions++;
  if (w === "main") tally.main++; else tally.payCost++;
  tally.maxWork = Math.max(tally.maxWork, c.work);
  if (c.bounded) tally.bounded++;
  assert.ok(c.work <= MAIN_LIMITS.work && c.considered <= MAIN_LIMITS.decisions, `${where}: within the work bound`);
  // Legal: an open decision, which plays.
  const answer = answerFor(turn.input.decisions, c.id);
  const played = applyDecision(match, turn.key, answer);
  assert.ok(played.ok, `${where}: ${c.id} plays (${JSON.stringify(played).slice(0, 200)})`);
  seenTypes.add(c.id.split(":")[1]);
  // Deterministic, from a JSON copy too, and no randomness drawn.
  assert.deepEqual(decide(clone(turn.input)), c, `${where}: the same choice from a JSON copy`);
  const rng = policyRng(revision + 1);
  const out = LOCAL(turn.input, rng);
  assert.equal(out.answer.id, c.id, `${where}: the local policy answers the Main-Phase choice`);
  assert.deepEqual(out.rng, rng, `${where}: and draws no randomness`);
  // Hidden information: two equivalent information sets give the same choice.
  for (const salt of [1, 2]) {
    const twin = permutedFor(match, seat, revision * 11 + salt);
    if (canonicalJson(twin.state) !== canonicalJson(match.state)) tally.nontrivial++;
    const twinTurn = policyTurn(twin, seat, revision);
    assert.deepEqual(decide(twinTurn.input), c, `${where}: a permuted hidden state gives the same choice`);
    assert.ok(applyDecision(twin, twinTurn.key, answerFor(twinTurn.input.decisions, c.id)).ok, `${where}: which plays there too`);
    tally.permutations++;
  }
}

// 3a. #641's game, its pick() moves.
const bundle641 = await fixtureBundle();
{
  let { match } = await createPinnedMatch({ bundle: bundle641, seed: FIXTURE_SEED, interpreterRevision: FIXTURE_REVISION });
  for (let n = 0; n <= 120 && !isOver(match); n++) {
    checkPosition("641", match, n);
    const action = pick(n + 1, legalMoves(match));
    if (!action) break;
    match = applyMove(match, action).match;
  }
}
// 3b. #642's scenarios.
for (const id of scenarioIds()) {
  let revision = 0;
  const evidence = await runScenario(id, { bundle: bundle641, interpreterRevision: FIXTURE_REVISION, observe: (match) => checkPosition(`642:${id}`, match, revision++) });
  assert.ok(evidence.pass, `scenario ${id} still passes with the observer attached`);
}

// 3c + 5. Strength games, every position of them checked: both seats, three fixtures.
const bundle644 = await policyFixtureBundle();
const FIXTURES = [
  { name: "641", bundle: bundle641, revision: FIXTURE_REVISION, seed: FIXTURE_SEED },
  { name: "644", bundle: bundle644, revision: POLICY_FIXTURE_REVISION, seed: POLICY_FIXTURE_SEED },
  { name: "646", bundle: mainBundle, revision: MAIN_FIXTURE_REVISION, seed: 646 },
];
const GAMES_PER_FIXTURE = 6;
const results: { fixture: string; seat: PlayerId; r: DuelResult }[] = [];
for (const f of FIXTURES) {
  for (let g = 0; g < GAMES_PER_FIXTURE; g++) {
    const testSeat: PlayerId = g % 2 === 0 ? "p1" : "p2";
    const r = await playDuel({
      bundle: f.bundle,
      interpreterRevision: f.revision,
      gameSeed: f.seed * 100 + Math.floor(g / 2),
      policySeed: g + 1,
      testSeat,
      test: LOCAL,
      baseline: BASELINE,
      maxMoves: 1500,
      observe: (match, seat, n) => { if (seat === testSeat && n % 2 === 0) checkPosition(`duel ${f.name}/${g}`, match, n); },
    });
    assert.equal(r.stopped?.includes("refused") ?? false, false, `duel ${f.name}/${g}: no decision was refused (${r.stopped})`);
    tally.guardTrips += r.guards.test;
    results.push({ fixture: f.name, seat: testSeat, r });
  }
}

assert.ok(tally.main > 200 && tally.payCost > 0, `the walk reaches Main-Phase (${tally.main}) and payment (${tally.payCost}) questions`);
for (const t of ["play", "attack", "endMain", "activate", "payCost"]) assert.ok(seenTypes.has(t), `the walk chooses a ${t} (chose: ${[...seenTypes].join(", ")})`);
assert.ok(tally.nontrivial > tally.permutations / 2, `most permuted states really differ (${tally.nontrivial} of ${tally.permutations})`);
assert.equal(tally.guardTrips, 0, "the local policy never needed the cycle guard in the strength games");

// ---------------------------------------------------------------------------------------------
// 4. Cost, against the #643 worker budgets (decisionMs.p95 <= 30 ms, decisionMs.max <= 300 ms).
const stepTimes = results.flatMap((x) => x.r.stepMs);
const cost = {
  policyP50: quantile(choiceTimes, 0.5), policyP95: quantile(choiceTimes, 0.95), policyMax: Math.max(...choiceTimes),
  stepP50: quantile(stepTimes, 0.5), stepP95: quantile(stepTimes, 0.95), stepMax: Math.max(...stepTimes),
};
// The policy's own share must be small beside the engine's: generous ceilings, so a busy machine does not fail the
// suite; the deterministic bound is the work counter above.
assert.ok(cost.policyP95 <= 5, `policy p95 ${cost.policyP95.toFixed(2)} ms is within 5 ms (a sixth of the 30 ms decision budget)`);
assert.ok(cost.policyMax <= 100, `policy max ${cost.policyMax.toFixed(1)} ms is within 100 ms`);

// ---------------------------------------------------------------------------------------------
// 5. Strength.
const all = summarise(results);
const lines = FIXTURES.map((f) => {
  const s = summarise(results.filter((x) => x.fixture === f.name));
  return `${f.name}: ${s.wins}-${s.losses}${s.draws ? `-${s.draws}d` : ""}${s.unfinished ? ` (${s.unfinished} unfinished)` : ""}, life damage ${s.damageDealt} dealt / ${s.damageTaken} taken`;
});
const [lo, hi] = wilson(all.wins, all.wins + all.losses);
assert.equal(all.unfinished, 0, "every strength game finished");
assert.ok(all.wins > all.losses, `the Main-Phase policy wins more than it loses against the same shortcuts with uniform choices (${all.wins}-${all.losses})`);
assert.ok(all.damageDealt > all.damageTaken, `and deals more life damage than it takes (${all.damageDealt} vs ${all.damageTaken})`);

console.log(`arena-policy-main: named scenarios ok — ${named.join("; ")}`);
console.log(`  ${tally.positions} positions (${tally.main} main, ${tally.payCost} payment), all legal, deterministic and RNG-free; ${tally.permutations} permuted hidden states (${tally.nontrivial} differing) with identical choices; max work ${tally.maxWork}/${MAIN_LIMITS.work} (${tally.bounded} bounded); chose ${[...seenTypes].sort().join(", ")}`);
console.log(`  cost (Node): policy p50 ${cost.policyP50.toFixed(2)} / p95 ${cost.policyP95.toFixed(2)} / max ${cost.policyMax.toFixed(1)} ms; whole local step p50 ${cost.stepP50.toFixed(1)} / p95 ${cost.stepP95.toFixed(1)} / max ${cost.stepMax.toFixed(1)} ms (worker budget: decision p95 30, max 300)`);
console.log(`  strength vs shortcuts+uniform, ${all.games} seeded games: ${all.wins}-${all.losses} (win rate ${(all.wins / Math.max(1, all.wins + all.losses) * 100).toFixed(0)} %, 95 % CI ${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)} %), p1 ${all.bySeat.p1.wins}-${all.bySeat.p1.losses}, p2 ${all.bySeat.p2.wins}-${all.bySeat.p2.losses}; ${lines.join("; ")}`);
console.log(`  ${((Date.now() - started) / 1000).toFixed(1)} s`);
