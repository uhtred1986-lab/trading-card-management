/**
 * #650 (plan O2-05): the constrained-choice handlers (`src/lib/arena/policy/choices.ts`) and the
 * complete local policy (`combat.ts`'s `localPolicy`, whose fallback now interrupts), proved
 * without a database or a provider.
 *
 *   1. A pure layer. `choices.ts` loads nothing outside `policy/` and names no engine state, seed
 *      or ambient randomness — shown to catch a deliberately added import. The online opponent
 *      does not load it.
 *   2. The coverage matrix. `WINDOW_HANDLERS` names a layer for every `DECISION_WINDOWS` kind; each
 *      kind is then answered by that layer (never the fallback) at a named fixture — a real
 *      rules-engine position for the fourteen kinds the rules engine asks, and for the two it never
 *      asks (`optionalCost`, `offering`: legacy-engine prompt kinds; the rules engine asks both as
 *      `chooseMode`) a contract-built input over a real position with the legacy engine's own
 *      answers and words.
 *   3. Named scenarios, staged on real engine states with synthetic cards
 *      (`arena-policy-choices-fixture.ts`) and played through the boundary (`localStep`), both seats
 *      on the strict local policy: an optional pick that takes the best target and one that takes
 *      none; a required two-card pick (played as two engine moves); a required discard of the two
 *      least valuable cards; a priced Auto paid; a printed mode; [Offering] at high and low life;
 *      Auto order; a life replacement (to the hand instead of the Drop) and a KO substitute (discard
 *      instead); [Empower]'s carry; an exact payment that keeps the needed colour. Each checks the
 *      cards actually moved on the engine.
 *   4. Typed interruptions. A question no handler reads, and a referee question, stop with
 *      `interrupted` (no move, no model, no pass); a pick the engine would refuse is refused.
 *   5. Every position. At every decision of the scenarios, the fixture games and the two audited
 *      decks (#649, SD15/SD5, both seats), for the seat asked: the strict policy answers without
 *      its fallback, the answer plays, is the same twice and from a JSON copy, draws no
 *      randomness, stays inside its work bound, and is unchanged in two permuted hidden states.
 *   6. Strength. Seeded games against the #647 policy (`combatPolicy(uniformPolicy)`: the same
 *      shortcuts, Main Phase and battle, uniform constrained choices), both seats, on the fixtures
 *      and the audit decks: reported with a Wilson interval, not asserted. The larger run is
 *      `npm run arena:policy-eval`.
 *
 * Run from the repo root:  npx tsx scripts/verify/arena-policy-choices.mts   (part of `npm test`)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { checkImportGraph, diskRead, policyLayerRule, policyLayerSourceViolations } from "../lib/import-graph.ts";
import { fixtureBundle, FIXTURE_REVISION, FIXTURE_SEED } from "./arena-browser-fixture.ts";
import { policyFixtureBundle, POLICY_FIXTURE_REVISION, POLICY_FIXTURE_SEED } from "./arena-policy-fixture.ts";
import { stage, type Layout } from "./arena-policy-main-fixture.ts";
import { combatFixtureBundle, COMBAT_FIXTURE_REVISION, COMBAT_FIXTURE_SEED } from "./arena-policy-combat-fixture.ts";
import { choicesFixtureBundle, choicesMainPhase, CHOICES_FIXTURE_REVISION, CHOICES_FIXTURE_SEED } from "./arena-policy-choices-fixture.ts";
import { permutedFor } from "./arena-policy-permute.ts";
import { playDuel, quantile, summarise, wilson, type DuelResult } from "./arena-policy-duel.ts";
import { DECKS, deckBundle, loadSnapshot, resolveDeck, RUNTIME as AUDIT_RUNTIME } from "../arena-deck-audit.mts";
import type { PlayerId } from "../../src/lib/arena/types";
import { applyMove, legalMoves, type PinnedMatch } from "../../src/lib/arena/browser.ts";
import { canonicalJson, type ReplayBundleRecord } from "../../src/lib/arena/replay-core.ts";
import { applyDecision, localStep, policyTurn } from "../../src/lib/arena/policy/boundary.ts";
import { answerFor, buildDecisions, DECISION_WINDOWS, interruptingPolicy, uniformPolicy, type DecisionWindow, type PolicyInput } from "../../src/lib/arena/policy/contract.ts";
import { policyRng } from "../../src/lib/arena/policy/rng.ts";
import { shortcutFor } from "../../src/lib/arena/policy/shortcuts.ts";
import { guardedDecide, localMemory, mainChoice, paymentChoice } from "../../src/lib/arena/policy/main.ts";
import { combatChoice, combatPolicy, localPolicy } from "../../src/lib/arena/policy/combat.ts";
import { choiceDecision, CHOICE_LIMITS, WINDOW_HANDLERS, type HandlerLayer } from "../../src/lib/arena/policy/choices.ts";

const ROOT = process.cwd();
const started = Date.now();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** The complete local policy: its fallback interrupts, so any window it cannot answer stops the test. */
const LOCAL = localPolicy();
const COMBAT647 = combatPolicy(uniformPolicy);

// ---------------------------------------------------------------------------------------------
// 1. A pure layer.
{
  const entry = "src/lib/arena/policy/choices.ts";
  const real = checkImportGraph(path.join(ROOT, entry), ROOT, diskRead, { forbidFile: policyLayerRule });
  assert.deepEqual(real.violations, [], "choices.ts reaches outside the policy layer");
  assert.ok(real.files.every((f) => f.startsWith("src/lib/arena/policy/")), `choices.ts loads only policy modules (${real.files.join(", ")})`);
  for (const f of real.files) assert.deepEqual(policyLayerSourceViolations(f, fs.readFileSync(path.join(ROOT, f), "utf8")), [], `${f} names engine state or ambient randomness`);
  const file = path.join(ROOT, entry);
  const base = fs.readFileSync(file, "utf8");
  const sabotaged = (extra: string) => (f: string) => (f === file ? `${base}\n${extra}\n` : diskRead(f));
  const caught = checkImportGraph(file, ROOT, sabotaged(`import { legalMoves } from "../browser";`), { forbidFile: policyLayerRule });
  assert.ok(caught.violations.some((v) => v.file === entry && v.reason === "policy layer reaches outside the policy layer src/lib/arena/browser.ts"), "adding a browser import to choices.ts is caught");
  assert.ok(policyLayerSourceViolations(entry, `${base}\nexport const r = () => Math.random();\n`).includes("ambient time or randomness: Math.random"), "the source scan catches Math.random in choices.ts");
  const opponent = checkImportGraph(path.join(ROOT, "src/lib/arena/ai/opponent.ts"), ROOT, diskRead, { forbidFile: () => null });
  assert.ok(!opponent.files.includes(entry), "ai/opponent.ts does not load the choice policy");
}

// ---------------------------------------------------------------------------------------------
// Helpers.
const isOver = (m: PinnedMatch) => m.state.phase === "over";
const actorOf = (m: PinnedMatch): PlayerId | null => (isOver(m) ? null : ((m.state.prompt as { player?: PlayerId }).player ?? null));
const zone = (m: PinnedMatch, p: PlayerId, z: string) => (m.state.sides[p].zones as Record<string, string[]>)[z] ?? [];
const cardsIn = (m: PinnedMatch, p: PlayerId, z: string) => zone(m, p, z).map((id) => m.state.cards[id].cardId).sort();
const lifeOf = (m: PinnedMatch, p: PlayerId) => zone(m, p, "life").length;

/** Which layer of the local policy answers this input — the order `localPolicy` asks them in. */
function layerOf(input: PolicyInput): HandlerLayer | "fallback" {
  if (shortcutFor(input)) return "shortcuts";
  if (mainChoice(input) ?? paymentChoice(input)) return "main";
  if (combatChoice(input)) return "combat";
  if (choiceDecision(input)) return "choices";
  return "fallback";
}

/** Every window answered, where, by which layer: the coverage matrix's evidence. */
const coverage = new Map<string, { layer: string; fixtures: Set<string>; count: number }>();
const note = (window: string, layer: string, fixture: string) => {
  const k = `${window}|${layer}`;
  const row = coverage.get(k) ?? { layer, fixtures: new Set<string>(), count: 0 };
  row.fixtures.add(fixture);
  row.count++;
  coverage.set(k, row);
};
const tally = { positions: 0, permutations: 0, nontrivial: 0, maxChoiceWork: 0, picks: 0, multiPicks: 0, emptyPicks: 0 };
const times: number[] = [];

/** The checks every position gets (section 5). `fixture` names where it was met. */
function checkPosition(fixture: string, match: PinnedMatch, revision: number, permute = true): void {
  const seat = actorOf(match);
  if (!seat) return;
  const turn = policyTurn(match, seat, revision);
  const { decisions } = turn.input;
  if (decisions.actor !== seat || !decisions.decisions.length) return;
  const where = `${fixture} r${revision} ${seat} ${decisions.window}`;
  const t0 = performance.now();
  const layer = layerOf(turn.input);
  const rng = policyRng(revision + 7);
  const out = LOCAL(turn.input, rng);
  times.push(performance.now() - t0);
  assert.notEqual(layer, "fallback", `${where}: a handler answers (${decisions.decisions.map((d) => d.id).join(", ").slice(0, 300)})`);
  note(decisions.window, layer, fixture);
  tally.positions++;
  assert.deepEqual(out.rng, rng, `${where}: no randomness is drawn`);
  if (layer === "choices") {
    const c = choiceDecision(turn.input)!;
    assert.ok(c.work <= CHOICE_LIMITS.work && c.considered <= Math.max(CHOICE_LIMITS.candidates, CHOICE_LIMITS.options), `${where}: within the work bound`);
    tally.maxChoiceWork = Math.max(tally.maxChoiceWork, c.work);
    if (c.cards) { tally.picks++; if (c.cards.length > 1) tally.multiPicks++; if (!c.cards.length) tally.emptyPicks++; }
  }
  const played = applyDecision(match, turn.key, out.answer);
  assert.ok(played.ok, `${where}: ${out.answer.id} ${JSON.stringify(out.answer.cards ?? [])} plays (${JSON.stringify(played).slice(0, 300)})`);
  assert.deepEqual(LOCAL(clone(turn.input), rng).answer, out.answer, `${where}: the same answer from a JSON copy`);
  if (!permute) return;
  for (const salt of [1, 2]) {
    const twin = permutedFor(match, seat, revision * 17 + salt);
    if (canonicalJson(twin.state) !== canonicalJson(match.state)) tally.nontrivial++;
    const twinTurn = policyTurn(twin, seat, revision);
    const t = LOCAL(twinTurn.input, rng).answer;
    assert.deepEqual({ id: t.id, cards: t.cards }, { id: out.answer.id, cards: out.answer.cards }, `${where}: a permuted hidden state gives the same answer`);
    assert.ok(applyDecision(twin, twinTurn.key, t).ok, `${where}: which plays there too`);
    tally.permutations++;
  }
}

interface Step { seat: PlayerId; window: string; id: string; cards?: string[] }

/** Play on through `localStep`, both seats on the strict local policy, until `done` (or the game ends). */
function playOn(fixture: string, match: PinnedMatch, done: (m: PinnedMatch, steps: Step[]) => boolean, cap = 40) {
  let m = match;
  const memory: Record<PlayerId, ReturnType<typeof localMemory>> = { p1: localMemory(policyRng(1)), p2: localMemory(policyRng(2)) };
  const steps: Step[] = [];
  for (let n = 0; n < cap; n++) {
    if (isOver(m) || (steps.length && done(m, steps))) return { match: m, steps };
    const seat = actorOf(m);
    assert.ok(seat, `a seat is asked (${m.state.prompt.kind})`);
    checkPosition(fixture, m, 60_000 + n);
    const turn = policyTurn(m, seat, 60_000 + n);
    const step = localStep(m, seat, 60_000 + n, memory[seat], LOCAL);
    assert.ok(step.ok, `${fixture}: the local step plays (${JSON.stringify(step).slice(0, 300)})`);
    assert.equal(step.guard, null, "no cycle guard is needed");
    memory[seat] = step.memory;
    const answered = LOCAL(turn.input, memory[seat].rng).answer;
    steps.push({ seat, window: turn.input.decisions.window, id: step.id, ...(answered.cards ? { cards: answered.cards } : {}) });
    m = step.match;
  }
  assert.fail(`${fixture}: did not finish within ${cap} decisions`);
}
const said = (steps: Step[]) => steps.map((s) => `${s.seat} ${s.window}: ${s.id}${s.cards ? ` ${JSON.stringify(s.cards)}` : ""}`).join("\n    ");
const backToMain = (p: PlayerId) => (m: PinnedMatch) => m.state.prompt.kind === "main" && (m.state.prompt as { player: PlayerId }).player === p && !m.state.battle && !m.state.programs.length;
const of = (steps: Step[], window: string, seat?: PlayerId) => steps.filter((s) => s.window === window && (!seat || s.seat === seat));

// ---------------------------------------------------------------------------------------------
// 3. Named scenarios.
const choicesBundle = await choicesFixtureBundle();
const opening = await choicesMainPhase(choicesBundle);
const named: string[] = [];
const ENERGY = (n: number, card = "Q-V") => Array.from({ length: n }, () => card);
function scenario(name: string, run: () => void) {
  run();
  named.push(name);
}
/** Play `cardId` from p1's hand on a staged copy of the opening, then let both seats answer until p1 is back in its Main Phase. */
function playFromHand(name: string, layouts: Partial<Record<PlayerId, Layout>>, cardId: string, type: "play" | "playUnison" = "play") {
  const m = stage(opening, layouts);
  const inst = zone(m, "p1", "hand").find((id) => m.state.cards[id].cardId === cardId)!;
  const move = legalMoves(m).filter((l) => l.action.type === type && (l.action as { card: string }).card === inst).at(-1);
  assert.ok(move, `${name}: ${cardId} can be played (${legalMoves(m).map((l) => l.label).join("; ")})`);
  return playOn(name, applyMove(m, move.action).match, backToMain("p1"));
}

scenario("optional pick takes the most valuable target", () => {
  const { match, steps } = playFromHand("pick-up-to", { p1: { hand: ["Q-KILL1"], energy: ENERGY(3) }, p2: { battle: [{ cardId: "Q-V", mode: "active" }, { cardId: "Q-BIG", mode: "active" }] } }, "Q-KILL1");
  const pick = of(steps, "chooseCards", "p1")[0];
  assert.ok(pick && pick.id === "pick" && pick.cards?.length === 1, `p1 picks one (${said(steps)})`);
  assert.deepEqual(cardsIn(match, "p2", "battle"), ["Q-V"], "the 25,000 card was KO'd, the 10,000 one kept");
});

scenario("optional zero selection: no Life card at low life", () => {
  const low = playFromHand("pick-none", { p1: { hand: ["Q-LIFE"], energy: ENERGY(3), life: 3 } }, "Q-LIFE");
  const pick = of(low.steps, "chooseCards", "p1")[0];
  assert.ok(pick && pick.id === "pick" && pick.cards?.length === 0, `an empty pick declines (${said(low.steps)})`);
  assert.equal(lifeOf(low.match, "p1"), 3, "life is kept");
  const high = playFromHand("pick-life", { p1: { hand: ["Q-LIFE"], energy: ENERGY(3), life: 7 } }, "Q-LIFE");
  assert.equal(of(high.steps, "chooseCards", "p1")[0]?.cards?.length, 1, `at 7 life one Life card is taken (${said(high.steps)})`);
  assert.equal(lifeOf(high.match, "p1"), 6);
});

scenario("required multi-selection: exactly two, the two most valuable", () => {
  const { match, steps } = playFromHand("pick-exact-2", { p1: { hand: ["Q-KILL2"], energy: ENERGY(3) }, p2: { battle: [{ cardId: "Q-SMALL", mode: "active" }, { cardId: "Q-V", mode: "active" }, { cardId: "Q-BIG", mode: "active" }] } }, "Q-KILL2");
  const picks = of(steps, "chooseCards", "p1");
  assert.equal(picks.length, 1, `one compound decision answers both cards (${said(steps)})`);
  assert.equal(picks[0].cards?.length, 2);
  assert.deepEqual(cardsIn(match, "p2", "battle"), ["Q-SMALL"], "the 25,000 and the 10,000 card were KO'd");
});

scenario("required discard: the two least valuable", () => {
  const { match, steps } = playFromHand("discard-2", { p1: { hand: ["Q-DISCARD", "Q-BIG", "Q-V2", "Q-SMALL", "Q-SMALL"], energy: ENERGY(3) } }, "Q-DISCARD");
  assert.equal(of(steps, "chooseCards", "p1")[0]?.cards?.length, 2, `two cards in one pick (${said(steps)})`);
  const dropped = cardsIn(match, "p1", "drop");
  assert.ok(!dropped.includes("Q-BIG") && !dropped.includes("Q-V2"), `the valuable cards are kept (dropped: ${dropped.join(", ")})`);
});

scenario("priced Auto: the price is paid", () => {
  const { match, steps } = playFromHand("auto-price", { p1: { hand: ["Q-PRICED", "Q-SMALL"], energy: ENERGY(3) } }, "Q-PRICED");
  const mode = of(steps, "chooseMode", "p1")[0];
  assert.ok(mode && /"index":0/.test(mode.id), `p1 pays (${said(steps)})`);
  assert.ok(cardsIn(match, "p1", "drop").includes("Q-SMALL"), "the hand card was paid");
  assert.equal(zone(match, "p1", "hand").length, 2, "and two cards drawn");
});

scenario("printed mode: the KO over the draw", () => {
  const { match, steps } = playFromHand("modes", { p1: { hand: ["Q-MODES"], energy: ENERGY(3) }, p2: { battle: [{ cardId: "Q-BIG", mode: "active" }] } }, "Q-MODES");
  const mode = of(steps, "chooseMode", "p1")[0];
  assert.ok(mode && /"index":1/.test(mode.id), `the KO mode (${said(steps)})`);
  assert.deepEqual(cardsIn(match, "p2", "battle"), [], "and the card is KO'd");
});

scenario("[Offering] as chooseMode: drop a life at 7, keep it at 3", () => {
  const high = playFromHand("offering-7", { p1: { hand: ["Q-OFFER"], energy: ENERGY(3) }, p2: { life: 7 } }, "Q-OFFER");
  assert.ok(/"index":0/.test(of(high.steps, "chooseMode", "p2")[0]?.id ?? ""), `p2 drops a life (${said(high.steps)})`);
  assert.equal(lifeOf(high.match, "p2"), 6);
  const low = playFromHand("offering-3", { p1: { hand: ["Q-OFFER"], energy: ENERGY(3) }, p2: { life: 3 } }, "Q-OFFER");
  assert.ok(/"index":1/.test(of(low.steps, "chooseMode", "p2")[0]?.id ?? ""), `p2 keeps its life (${said(low.steps)})`);
  assert.equal(lifeOf(low.match, "p2"), 3);
});

scenario("Auto order: the earliest-triggered first", () => {
  const { steps } = playFromHand("order", { p1: { hand: ["Q-DRAW"], energy: ENERGY(3), battle: [{ cardId: "Q-WATCH", mode: "active" }] } }, "Q-DRAW");
  const order = of(steps, "orderPending", "p1")[0];
  assert.ok(order && /"index":\d+/.test(order.id) && !/decline/.test(order.id), `resolves, never withholds (${said(steps)})`);
});

scenario("[Empower] carries the maximum", () => {
  let m = stage(opening, { p1: { hand: ["Q-UNI", "Q-EMP"], energy: ENERGY(6) } });
  const uni = zone(m, "p1", "hand").find((id) => m.state.cards[id].cardId === "Q-UNI")!;
  const x2 = legalMoves(m).find((l) => l.action.type === "playUnison" && (l.action as { card: string }).card === uni && (l.action as { x?: number }).x === 2);
  assert.ok(x2, "Q-UNI can be played with X = 2");
  m = applyMove(m, x2.action).match;
  const emp = zone(m, "p1", "hand").find((id) => m.state.cards[id].cardId === "Q-EMP")!;
  const x1 = legalMoves(m).find((l) => l.action.type === "playUnison" && (l.action as { card: string }).card === emp && (l.action as { x?: number }).x === 1);
  assert.ok(x1, "Q-EMP can be played over it");
  m = applyMove(m, x1.action).match;
  assert.equal(m.state.prompt.kind, "empowerCarry", "the carry is asked");
  const { match, steps } = playOn("empower", m, backToMain("p1"));
  assert.ok(/"amount":2/.test(of(steps, "empowerCarry", "p1")[0]?.id ?? ""), `carries 2 (${said(steps)})`);
  assert.equal(match.state.cards[zone(match, "p1", "unison")[0]].markers, 3, "1 paid + 2 carried");
});

scenario("exact payment keeps the colour the hand needs", () => {
  const { match, steps } = playFromHand("pay-exact", { p1: { hand: ["Q-V2", "Q-B"], energy: ["Q-V", "Q-V", "Q-B"] } }, "Q-V2");
  const pay = of(steps, "payCost", "p1")[0];
  assert.ok(pay, `the payment is asked (${said(steps)})`);
  const blueActive = zone(match, "p1", "energy").filter((id) => match.state.cards[id].cardId === "Q-B" && match.state.cards[id].mode === "active").length;
  assert.equal(blueActive, 1, "the blue energy stays active for the blue card in hand");
});

/** p2's turn after p1's opening Main Phase ends, everything else declined by the strict local policy. */
function p2Turn(layouts: Partial<Record<PlayerId, Layout>>) {
  let m = applyMove(stage(opening, layouts), { type: "endMain", player: "p1" }).match;
  for (let n = 0; n < 40 && !(m.state.prompt.kind === "main" && (m.state.prompt as { player: PlayerId }).player === "p2"); n++) {
    const legal = legalMoves(m).map((l) => l.action);
    m = applyMove(m, legal.find((a) => a.type === "charge" && a.card === null) ?? legal.find((a) => a.type === "pass" || ("card" in a && a.card === null)) ?? legal[0]).match;
  }
  // The re-staged layouts, now on p2's turn (the draw and charge changed p2's hand).
  return stage(m, layouts);
}

scenario("replaceMove: a Life card to the hand instead of the Drop", () => {
  // p2's [Critical] attack on p1, whose Q-REVEAL offers the hand instead of the Drop (9-10, BT10-031's shape).
  const m0 = p2Turn({ p1: { hand: [], battle: [{ cardId: "Q-REVEAL", mode: "active" }], life: 5, energy: ENERGY(1) }, p2: { hand: [], battle: [{ cardId: "Q-CRIT", mode: "active" }], energy: ENERGY(2), leaderMode: "rest" } });
  const crit = zone(m0, "p2", "battle")[0];
  const attack = legalMoves(m0).find((l) => l.action.type === "attack" && (l.action as { attacker: string }).attacker === crit && (l.action as { target: string }).target === zone(m0, "p1", "leader")[0]);
  assert.ok(attack, "the [Critical] attack is offered");
  const { match, steps } = playOn("replace-life", applyMove(m0, attack.action).match, backToMain("p2"));
  const replace = of(steps, "replaceMove", "p1")[0];
  assert.ok(replace && /"index":0/.test(replace.id), `p1 takes the replacement (${said(steps)})`);
  assert.equal(lifeOf(match, "p1"), 4, "one life is lost");
  assert.equal(zone(match, "p1", "hand").length, 1, "to the hand, not the Drop");
});

scenario("replaceMove: a KO substitute (discard instead), paying with the least valuable", () => {
  const m0 = p2Turn({ p1: { hand: ["Q-V2", "Q-SMALL"], battle: [{ cardId: "Q-PILEOFF", mode: "active" }], energy: ENERGY(1) }, p2: { hand: ["Q-KILL1"], energy: ENERGY(2) } });
  const kill = zone(m0, "p2", "hand").find((id) => m0.state.cards[id].cardId === "Q-KILL1")!;
  const play = legalMoves(m0).find((l) => l.action.type === "play" && (l.action as { card: string }).card === kill);
  assert.ok(play, "Q-KILL1 is offered");
  const { match, steps } = playOn("replace-substitute", applyMove(m0, play.action).match, backToMain("p2"));
  const replace = of(steps, "replaceMove", "p1")[0];
  assert.ok(replace && /"index":0/.test(replace.id), `p1 takes the substitute (${said(steps)})`);
  assert.deepEqual(cardsIn(match, "p1", "battle"), ["Q-PILEOFF"], "the card stays");
  assert.deepEqual(cardsIn(match, "p1", "hand"), ["Q-V2"], `the 5,000 card was discarded, the 15,000 one kept (${said(steps)})`);
});

// ---------------------------------------------------------------------------------------------
// 2. The coverage matrix: the two legacy-only kinds, over a real position's observation.
{
  assert.deepEqual(Object.keys(WINDOW_HANDLERS).sort(), [...DECISION_WINDOWS].sort(), "WINDOW_HANDLERS names every DECISION_WINDOWS kind");
  // A real rules-engine position (p2 asked [Offering]'s chooseMode), its question re-asked with the legacy engine's own answers.
  const at = stage(opening, { p1: { hand: ["Q-OFFER"], energy: ENERGY(3) }, p2: { life: 7 } });
  const inst = zone(at, "p1", "hand").find((id) => at.state.cards[id].cardId === "Q-OFFER")!;
  let m = applyMove(at, legalMoves(at).find((l) => l.action.type === "play" && (l.action as { card: string }).card === inst)!.action).match;
  for (let n = 0; n < 10 && m.state.prompt.kind !== "chooseMode"; n++) m = applyMove(m, legalMoves(m)[0].action).match;
  assert.equal(m.state.prompt.kind, "chooseMode", "the rules engine asks [Offering] as chooseMode");
  const legacy = (window: DecisionWindow, life: number, legal: { action: Record<string, unknown>; label: string }[], cost?: string): PolicyInput => {
    const turn = policyTurn(m, "p2", 1);
    const observation = clone(turn.input.observation);
    observation.you.life = life;
    if (cost && observation.prompt.mine) observation.prompt.cost = cost;
    const { decisions } = buildDecisions({ seat: "p2", revision: 1, observation, window, actor: "p2", legal: legal.map((l) => ({ action: { ...l.action, player: "p2" } as never, label: l.label })), choice: null, aliases: {} });
    return { observation, decisions };
  };
  // engine/engine.ts's own answers and words for the two kinds.
  const offering = [{ action: { type: "offering", dropLife: true }, label: "Drop 1 life (deny the draw)" }, { action: { type: "offering", dropLife: false }, label: "Keep life (opponent draws 2)" }];
  const optional = [{ action: { type: "optionalCost", pay: true }, label: "Pay: {r}" }, { action: { type: "optionalCost", pay: false }, label: "Don't pay (the skill does not resolve)" }];
  for (const [window, life, legal, cost, expect] of [
    ["offering", 7, offering, undefined, /dropLife":true/],
    ["offering", 3, offering, undefined, /dropLife":false/],
    ["optionalCost", 7, optional, "{r}", /pay":true/],
    ["optionalCost", 7, [{ ...optional[0], label: "Pay: choose 3 cards from your hand and place them in your Drop Area" }, optional[1]], "choose 3 cards from your hand and place them in your Drop Area", /pay":false/],
  ] as const) {
    const input = legacy(window, life, [...legal], cost);
    assert.equal(layerOf(input), "choices", `${window}: the choices layer answers`);
    const out = LOCAL(input, policyRng(1));
    assert.match(out.answer.id, expect, `${window} at life ${life}${cost ? `, price "${cost}"` : ""}: ${out.answer.id}`);
    note(window, "choices", `contract:${window}-life${life}${cost && cost.length > 4 ? "-dear" : ""}`);
  }
}

// ---------------------------------------------------------------------------------------------
// 4. Typed interruptions.
{
  // A question no layer reads: the strict policy interrupts through the guard; nothing is played.
  const base = policyTurn(stage(opening, { p1: { hand: ["Q-V"], energy: ENERGY(1) } }), "p1", 0).input;
  const mystery: PolicyInput = { ...base, decisions: { ...base.decisions, window: "mystery" } };
  assert.ok(mystery.decisions.decisions.length > 1, "several decisions are open (so no only-move shortcut applies)");
  const out = guardedDecide(localPolicy(), mystery, localMemory(policyRng(1)));
  assert.ok(!out.ok && /^unsupported decision: mystery: no local handler/.test(out.interrupted), `an unreadable question interrupts (${JSON.stringify(out).slice(0, 200)})`);
  assert.throws(() => interruptingPolicy(mystery, policyRng(1)), /no local handler answers/, "the default fallback throws a PolicyInterruption, never a guess");
  // A referee question (a skill the compiler could not read): the session is interrupted, not asked.
  const ref = clone(opening);
  const leader = zone(ref, "p1", "leader")[0];
  ref.state.prompt = { kind: "referee", player: "p1", request: { card: leader, cardId: ref.state.cards[leader].cardId, cardName: "Q-L", skillIndex: 0, text: "Bend the fabric of reality.", unsupported: ["bend the fabric of reality"], master: "p1" } };
  const step = localStep(ref, "p1", 0, localMemory(policyRng(1)), LOCAL);
  assert.ok(!step.ok && step.reason === "interrupted" && /unsupported decision/.test(step.detail), `a referee question interrupts (${JSON.stringify(step).slice(0, 200)})`);
  // A pick the contract refuses (two cards for "up to 1"), resolved through the boundary: refused, the match unchanged.
  const pm = stage(opening, { p1: { hand: ["Q-KILL1"], energy: ENERGY(3) }, p2: { battle: [{ cardId: "Q-V", mode: "active" }, { cardId: "Q-BIG", mode: "active" }] } });
  const ki = zone(pm, "p1", "hand").find((id) => pm.state.cards[id].cardId === "Q-KILL1")!;
  let q = applyMove(pm, legalMoves(pm).find((l) => l.action.type === "play" && (l.action as { card: string }).card === ki)!.action).match;
  for (let n = 0; n < 5 && q.state.prompt.kind !== "chooseCards"; n++) q = applyMove(q, legalMoves(q)[0].action).match;
  const t = policyTurn(q, "p1", 3);
  const pick = t.input.decisions.decisions.find((d) => d.kind === "pick");
  assert.ok(pick && pick.kind === "pick");
  const refused = applyDecision(q, t.key, answerFor(t.input.decisions, "pick", pick.candidates));
  assert.ok(!refused.ok && refused.reason === "invalid", `an over-long pick is refused (${JSON.stringify(refused)})`);
  named.push("typed interruptions (unreadable question, referee, refused pick)");
}

// ---------------------------------------------------------------------------------------------
// 5 + 6. Every position of the fixture games and the audited decks, and the strength comparison.
const auditCatalog = loadSnapshot().cards;
const auditCards = [...new Map(DECKS.flatMap((d) => resolveDeck(d, auditCatalog).rows.map((r) => [r.card.id, r.card] as const))).values()];
interface Fixture { name: string; bundle: ReplayBundleRecord; revision: string; seed: number; games: number; permute: boolean }
const FIXTURES: Fixture[] = [
  { name: "641", bundle: await fixtureBundle(), revision: FIXTURE_REVISION, seed: FIXTURE_SEED, games: 2, permute: true },
  { name: "644", bundle: await policyFixtureBundle(), revision: POLICY_FIXTURE_REVISION, seed: POLICY_FIXTURE_SEED, games: 2, permute: true },
  { name: "647", bundle: await combatFixtureBundle(), revision: COMBAT_FIXTURE_REVISION, seed: COMBAT_FIXTURE_SEED, games: 2, permute: true },
  { name: "650", bundle: choicesBundle, revision: CHOICES_FIXTURE_REVISION, seed: CHOICES_FIXTURE_SEED, games: 4, permute: true },
];
// The audited decks: every ordered matchup once, the local policy in p1's seat for two and p2's for two.
// One bundle (both decks' cards compiled once), its decklists swapped per matchup.
const auditBase = (await deckBundle(auditCards, { p1: DECKS[0], p2: DECKS[1] }, auditCatalog)) as ReplayBundleRecord & { decks: Record<PlayerId, unknown> };
const deckOf = { [DECKS[0].key]: auditBase.decks.p1, [DECKS[1].key]: auditBase.decks.p2 };
for (const [i, [p1, p2]] of [[DECKS[0], DECKS[0]], [DECKS[0], DECKS[1]], [DECKS[1], DECKS[0]], [DECKS[1], DECKS[1]]].entries()) {
  FIXTURES.push({ name: `audit ${p1.key}v${p2.key}`, bundle: { ...auditBase, decks: { p1: deckOf[p1.key], p2: deckOf[p2.key] } } as ReplayBundleRecord, revision: AUDIT_RUNTIME, seed: 649 + i, games: 1, permute: false });
}
const results: { fixture: string; seat: PlayerId; r: DuelResult }[] = [];
let guardTrips = 0;
for (const [fi, f] of FIXTURES.entries()) {
  for (let g = 0; g < f.games; g++) {
    const testSeat: PlayerId = (g + (f.games === 1 ? fi : 0)) % 2 === 0 ? "p1" : "p2";
    const fixture = f.name.startsWith("audit") ? `${f.name} (SD15/SD5)` : `fixture ${f.name}`;
    const r = await playDuel({
      bundle: f.bundle,
      interpreterRevision: f.revision,
      gameSeed: f.seed * 100 + 50 + Math.floor(g / 2),
      policySeed: g + 21,
      testSeat,
      test: LOCAL,
      baseline: COMBAT647,
      maxMoves: 3000,
      // Every decision of either seat is checked against the local policy (the baseline seat's positions are
      // positions too); the permuted twins on every third test-seat decision of the synthetic fixtures and
      // every fifth of the audit decks (each costs two more boundary projections).
      observe: (match, seat, n) => checkPosition(fixture, match, n, seat === testSeat && n % (f.permute ? 3 : 5) === 0),
    });
    assert.equal(r.stopped, null, `${f.name}/${g}: the game finished (${r.stopped})`);
    guardTrips += r.guards.test;
    results.push({ fixture: f.name, seat: testSeat, r });
  }
}
assert.equal(guardTrips, 0, "the local policy never needed the cycle guard");

// The matrix: every kind answered by its declared layer, at a named fixture.
const matrix: string[] = [];
for (const w of DECISION_WINDOWS) {
  const declared = WINDOW_HANDLERS[w];
  const rows = [...coverage.entries()].filter(([k]) => k.startsWith(`${w}|`)).map(([, v]) => v);
  assert.ok(rows.length, `${w}: answered at some fixture (${[...coverage.keys()].join(", ")})`);
  for (const r of rows) assert.ok(r.layer === declared.layer || (w === "payCost" && r.layer === "choices") || r.layer === "shortcuts", `${w}: answered by ${r.layer}, declared ${declared.layer}`);
  assert.ok(rows.some((r) => r.layer === declared.layer), `${w}: its declared layer (${declared.layer}) answers at least once`);
  const fixtures = [...new Set(rows.flatMap((r) => [...r.fixtures]))].sort();
  matrix.push(`| ${w} | ${declared.layer} | ${declared.rule} | ${rows.reduce((n, r) => n + r.count, 0)} | ${fixtures.slice(0, 4).join(", ")}${fixtures.length > 4 ? ", …" : ""} |`);
}
for (const k of DECISION_WINDOWS.filter((w) => WINDOW_HANDLERS[w].rulesEngine)) {
  assert.ok([...coverage.entries()].some(([key, v]) => key.startsWith(`${k}|`) && [...v.fixtures].some((f) => !f.startsWith("contract:"))), `${k}: met on a real rules-engine position`);
}
assert.ok(tally.multiPicks > 0 && tally.emptyPicks > 0, `multi-card and empty picks were played (${tally.multiPicks}, ${tally.emptyPicks})`);
assert.ok(tally.nontrivial > tally.permutations / 2, `most permuted states really differ (${tally.nontrivial} of ${tally.permutations})`);
const cost = { p50: quantile(times, 0.5), p95: quantile(times, 0.95), max: Math.max(...times) };
if (process.argv.includes("--record-performance")) {
  console.log(`PERFORMANCE RECORDED ONLY: choice policy p95 ${cost.p95.toFixed(2)} ms (limit 10), max ${cost.max.toFixed(1)} ms (limit 200)`);
} else {
  assert.ok(cost.p95 <= 10, `local policy p95 ${cost.p95.toFixed(2)} ms is within 10 ms`);
  assert.ok(cost.max <= 200, `local policy max ${cost.max.toFixed(1)} ms is within 200 ms`);
}

const strength = (filter: (f: string) => boolean) => {
  const s = summarise(results.filter((x) => filter(x.fixture)));
  const [lo, hi] = wilson(s.wins, s.wins + s.losses);
  return `${s.wins}-${s.losses}${s.draws ? `-${s.draws}d` : ""} of ${s.games} (95 % CI ${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)} %), life ${s.damageDealt} dealt / ${s.damageTaken} taken`;
};

console.log(`arena-policy-choices: named scenarios ok — ${named.join("; ")}`);
console.log(`  coverage (window | layer | rule | decisions | fixtures):\n  ${matrix.join("\n  ")}`);
console.log(`  ${tally.positions} positions, all answered without the fallback, legal, deterministic and RNG-free; ${tally.picks} compound picks (${tally.multiPicks} multi-card, ${tally.emptyPicks} empty); ${tally.permutations} permuted hidden states (${tally.nontrivial} differing) with identical answers; max choice work ${tally.maxChoiceWork}/${CHOICE_LIMITS.work}`);
console.log(`  cost (Node): local policy p50 ${cost.p50.toFixed(2)} / p95 ${cost.p95.toFixed(2)} / max ${cost.max.toFixed(1)} ms per decision`);
console.log(`  strength vs the #647 policy (uniform constrained choices), seeded, both seats: synthetic fixtures ${strength((f) => !f.startsWith("audit"))}; audit decks ${strength((f) => f.startsWith("audit"))}`);
console.log(`  ${((Date.now() - started) / 1000).toFixed(1)} s`);
