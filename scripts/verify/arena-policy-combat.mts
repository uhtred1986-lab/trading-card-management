/**
 * #647 (plan O2-04): the battle policy (`src/lib/arena/policy/combat.ts`) — blocks, counters,
 * offensive and defensive combos and battle activations — and its place in `localPolicy`, proved
 * without a database or a provider.
 *
 *   1. A pure layer. `combat.ts` loads nothing outside `policy/` and names no engine state, seed or
 *      ambient randomness — first shown to catch a deliberately added import. The online opponent
 *      does not load it.
 *   2. Named scenarios, staged on real engine states (`arena-policy-combat-fixture.ts`) and fought
 *      to the battle's end through the boundary (`localStep`), both seats on the local policy:
 *      a lethal attack is blocked; a non-lethal one is not chump-blocked while life allows; a
 *      blocker that survives is used; an attacker that already ties passes (ties go to the
 *      attacker, 8-4-6) while the defender combos the cheapest card that is just enough; an
 *      offensive combo exactly enough to win; no combo spent on a battle that cannot be won, on
 *      either side; [Critical] and [Double Strike] change what a hit is worth and so whether it is
 *      defended; a [Counter] that negates a lethal attack is taken, one against a survivable hit is
 *      not, nor one a [Blocker] makes unnecessary; a readable "+5000 power" battle activation
 *      covers a deficit more cheaply than a combo card. Each checks the cards, energy and life
 *      actually spent on the engine.
 *   3. Termination: every staged battle ends within a handful of decisions; the cycle guard ends a
 *      battle window a looping policy would not (with its decline) and interrupts when nothing ends
 *      it; the cover search stays inside its work bound on a 14-card hand.
 *   4. Every position: at every blocker, counter and combo question of the staged battles above,
 *      the #642 scenarios and the strength games below, for the seat asked, the choice is an open decision that plays, is
 *      the same twice and from a JSON copy, draws no randomness, stays inside the work bound — and
 *      is unchanged in two permuted hidden states (#644's harness). Its Node wall time is held to a
 *      small share of the #643 decision budget.
 *   5. Strength. Seeded games on four fixtures, both seats, against the #646 policy (the same
 *      shortcuts and Main Phase, uniform battle windows) and against shortcuts + uniform: win/loss
 *      and life damage with a Wilson interval. Asserted only to win more than it loses against
 *      shortcuts + uniform in aggregate; the #646 comparison is reported, not asserted. The larger
 *      run is `npm run arena:policy-eval`.
 *
 * Run from the repo root:  npx tsx scripts/verify/arena-policy-combat.mts   (part of `npm test`)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { checkImportGraph, diskRead, policyLayerRule, policyLayerSourceViolations } from "../lib/import-graph.ts";
import { fixtureBundle, FIXTURE_REVISION, FIXTURE_SEED } from "./arena-browser-fixture.ts";
import { runScenario, scenarioIds } from "./arena-scenarios.ts";
import { policyFixtureBundle, POLICY_FIXTURE_REVISION, POLICY_FIXTURE_SEED } from "./arena-policy-fixture.ts";
import { mainFixtureBundle, MAIN_FIXTURE_REVISION } from "./arena-policy-main-fixture.ts";
import { battleAt, combatFixtureBundle, combatMainPhase, p2MainPhase, COMBAT_FIXTURE_REVISION, COMBAT_FIXTURE_SEED } from "./arena-policy-combat-fixture.ts";
import { permutedFor } from "./arena-policy-permute.ts";
import { playDuel, quantile, summarise, wilson, type DuelResult } from "./arena-policy-duel.ts";
import type { PlayerId } from "../../src/lib/arena/types";
import type { PinnedMatch } from "../../src/lib/arena/browser.ts";
import { canonicalJson } from "../../src/lib/arena/replay-core.ts";
import { applyDecision, localStep, policyTurn } from "../../src/lib/arena/policy/boundary.ts";
import { answerFor, uniformPolicy, type Policy, type PolicyInput } from "../../src/lib/arena/policy/contract.ts";
import { policyRng } from "../../src/lib/arena/policy/rng.ts";
import { shortcutThen } from "../../src/lib/arena/policy/shortcuts.ts";
import { guardedDecide, localMemory, mainPolicy, TURN_GUARD } from "../../src/lib/arena/policy/main.ts";
import { combatChoice, localPolicy, COMBAT_LIMITS, COMBAT_WINDOWS, type CombatChoice } from "../../src/lib/arena/policy/combat.ts";

const ROOT = process.cwd();
const started = Date.now();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const LOCAL = localPolicy(uniformPolicy);
const MAIN646 = mainPolicy(uniformPolicy);
const SHORTCUTS = shortcutThen(uniformPolicy);
/** For the named scenarios: any window neither the shortcuts, the Main Phase nor the battle policy answers is declined. */
const DECLINE: Policy = (input, rng) => {
  const open = input.decisions.decisions;
  const no = open.find((d) => d.kind === "menu" && (d.type === "pass" || d.type === "endMain" || ("card" in d.action && d.action.card === null))) ?? open[0];
  return { answer: answerFor(input.decisions, no.id), rng };
};
const SCENARIO_POLICY = localPolicy(DECLINE);

// ---------------------------------------------------------------------------------------------
// 1. A pure layer.
{
  const entry = "src/lib/arena/policy/combat.ts";
  const real = checkImportGraph(path.join(ROOT, entry), ROOT, diskRead, { forbidFile: policyLayerRule });
  assert.deepEqual(real.violations, [], "combat.ts reaches outside the policy layer");
  assert.ok(real.files.every((f) => f.startsWith("src/lib/arena/policy/")), `combat.ts loads only policy modules (${real.files.join(", ")})`);
  for (const f of real.files) assert.deepEqual(policyLayerSourceViolations(f, fs.readFileSync(path.join(ROOT, f), "utf8")), [], `${f} names engine state or ambient randomness`);
  const file = path.join(ROOT, entry);
  const base = fs.readFileSync(file, "utf8");
  const sabotaged = (extra: string) => (f: string) => (f === file ? `${base}\n${extra}\n` : diskRead(f));
  for (const [extra, expected] of [
    [`import { legalMoves } from "../browser";`, "policy layer reaches outside the policy layer src/lib/arena/browser.ts"],
    [`import { battleView } from "../vm/view";`, "policy layer reaches outside the policy layer src/lib/arena/vm/view.ts"],
  ] as const) {
    const caught = checkImportGraph(file, ROOT, sabotaged(extra), { forbidFile: policyLayerRule });
    assert.ok(caught.violations.some((v) => v.file === entry && v.reason === expected), `adding \`${extra}\` to combat.ts is caught as "${expected}"`);
  }
  assert.ok(policyLayerSourceViolations(entry, `${base}\nexport const r = () => Math.random();\n`).includes("ambient time or randomness: Math.random"), "the source scan catches Math.random in combat.ts");
  const opponent = checkImportGraph(path.join(ROOT, "src/lib/arena/ai/opponent.ts"), ROOT, diskRead, { forbidFile: () => null });
  assert.ok(!opponent.files.includes(entry), "ai/opponent.ts does not load the battle policy");
}

// ---------------------------------------------------------------------------------------------
// Helpers.
const isOver = (m: PinnedMatch) => m.state.phase === "over";
const actorOf = (m: PinnedMatch): PlayerId | null => (isOver(m) ? null : ((m.state.prompt as { player?: PlayerId }).player ?? null));
const zone = (m: PinnedMatch, p: PlayerId, z: string) => (m.state.sides[p].zones as Record<string, string[]>)[z] ?? [];
const cardsIn = (m: PinnedMatch, p: PlayerId, z: string) => zone(m, p, z).map((id) => m.state.cards[id].cardId).sort();
const activeEnergy = (m: PinnedMatch, p: PlayerId) => zone(m, p, "energy").filter((id) => m.state.cards[id].mode === "active").length;
const lifeOf = (m: PinnedMatch, p: PlayerId) => zone(m, p, "life").length;

/** The checks every battle position gets (section 4); the staged scenarios' positions get them too. */
const tally: Record<string, number> & { positions: number; permutations: number; nontrivial: number; maxWork: number; bounded: number } = { positions: 0, permutations: 0, nontrivial: 0, maxWork: 0, bounded: 0 };
const byWindow: Record<string, number> = {};
const chose = new Set<string>();

const choiceTimes: number[] = [];
function decide(input: PolicyInput): CombatChoice | null {
  const t0 = performance.now();
  const c = combatChoice(input);
  choiceTimes.push(performance.now() - t0);
  return c;
}

function checkPosition(label: string, match: PinnedMatch, revision: number): void {
  const seat = actorOf(match);
  if (!seat) return;
  const turn = policyTurn(match, seat, revision);
  const w = turn.input.decisions.window;
  if (!(COMBAT_WINDOWS as readonly string[]).includes(w)) return;
  const c = decide(turn.input);
  const where = `${label} r${revision} ${seat} ${w}`;
  assert.ok(c, `${where}: the policy chooses`);
  tally.positions++;
  byWindow[`${w}:${seat}`] = (byWindow[`${w}:${seat}`] ?? 0) + 1;
  tally.maxWork = Math.max(tally.maxWork, c.work);
  if (c.bounded) tally.bounded++;
  assert.ok(c.work <= COMBAT_LIMITS.work && c.considered <= COMBAT_LIMITS.decisions, `${where}: within the work bound`);
  const played = applyDecision(match, turn.key, answerFor(turn.input.decisions, c.id));
  assert.ok(played.ok, `${where}: ${c.id} plays (${JSON.stringify(played).slice(0, 200)})`);
  chose.add(`${w}:${c.id.split(":")[1]}${/"card":null/.test(c.id) ? "-decline" : ""}`);
  assert.deepEqual(decide(clone(turn.input)), c, `${where}: the same choice from a JSON copy`);
  const rng = policyRng(revision + 1);
  const out = LOCAL(turn.input, rng);
  // One open decision is the shortcut's ("only one legal move"); otherwise the battle policy answers.
  if (turn.input.decisions.decisions.length > 1) assert.equal(out.answer.id, c.id, `${where}: the local policy answers the battle choice`);
  assert.deepEqual(out.rng, rng, `${where}: and draws no randomness`);
  for (const salt of [1, 2]) {
    const twin = permutedFor(match, seat, revision * 13 + salt);
    if (canonicalJson(twin.state) !== canonicalJson(match.state)) tally.nontrivial++;
    const twinTurn = policyTurn(twin, seat, revision);
    assert.deepEqual(decide(twinTurn.input), c, `${where}: a permuted hidden state gives the same choice`);
    assert.ok(applyDecision(twin, twinTurn.key, answerFor(twinTurn.input.decisions, c.id)).ok, `${where}: which plays there too`);
    tally.permutations++;
  }
}

interface Step { seat: PlayerId; window: string; id: string; how: string }

/** Fight the open battle to its end through `localStep`, both seats on `policy`: until the turn player is back in its Main Phase (or the game ends). */
function fight(match: PinnedMatch, policy: Policy = SCENARIO_POLICY, cap = 40) {
  let m = match;
  const turnPlayer = match.state.turnPlayer;
  const memory: Record<PlayerId, ReturnType<typeof localMemory>> = { p1: localMemory(policyRng(1)), p2: localMemory(policyRng(2)) };
  const steps: Step[] = [];
  for (let n = 0; n < cap; n++) {
    if (isOver(m) || (m.state.prompt.kind === "main" && !m.state.battle && m.state.turnPlayer === turnPlayer)) return { match: m, steps };
    const seat = actorOf(m);
    assert.ok(seat, `a seat is asked (${m.state.prompt.kind})`);
    checkPosition("staged", m, 50_000 + n);
    const turn = policyTurn(m, seat, 50_000 + n);
    const c = combatChoice(turn.input);
    if (c) assert.ok(c.work <= COMBAT_LIMITS.work, "within the work bound");
    const step = localStep(m, seat, 50_000 + n, memory[seat], policy);
    assert.ok(step.ok, `the local step plays (${JSON.stringify(step).slice(0, 300)})`);
    assert.equal(step.guard, null, "no cycle guard is needed");
    memory[seat] = step.memory;
    steps.push({ seat, window: turn.input.decisions.window, id: step.id, how: c?.how ?? "" });
    m = step.match;
  }
  assert.fail(`the battle did not end within ${cap} decisions`);
}
const chosen = (steps: Step[], window: string, seat?: PlayerId) => steps.filter((s) => s.window === window && (!seat || s.seat === seat));
const said = (steps: Step[]) => steps.map((s) => `${s.seat} ${s.window}: ${s.id} (${s.how})`).join("\n    ");

// ---------------------------------------------------------------------------------------------
// 2. Named scenarios.
const combatBundle = await combatFixtureBundle();
const opening = await combatMainPhase(combatBundle);
const named: string[] = [];
const battleLengths: number[] = [];
const ATTACKER = (hand: string[], battle: string, energy = 2) => ({ hand, energy: Array.from({ length: energy }, () => "C-V5"), battle: [{ cardId: battle, mode: "active" as const }], leaderMode: "rest" as const, energyMarkers: 0 });
const DEFENDER = (hand: string[], life: number, battle: { cardId: string; mode: "active" | "rest" }[] = [], energy = 2) => ({ hand, energy: Array.from({ length: energy }, () => "C-V5"), battle, life, energyMarkers: 0 });

function scenario(name: string, run: () => void) {
  run();
  named.push(name);
}

// 2a. A lethal attack is blocked — with the 5,000 blocker that dies, since nothing else saves the last life.
scenario("block a lethal attack", () => {
  const m = battleAt(opening, { p1: ATTACKER([], "C-V10"), p2: DEFENDER([], 1, [{ cardId: "C-CHUMP", mode: "active" }]) }, "C-V10");
  assert.equal(m.state.prompt.kind, "blocker", "the defender is asked to block");
  const { match: after, steps } = fight(m);
  battleLengths.push(steps.length);
  const block = chosen(steps, "blocker", "p2")[0];
  assert.ok(block && !block.id.includes("null"), `p2 blocks (${said(steps)})`);
  assert.equal(lifeOf(after, "p2"), 1, "the last life is kept");
  assert.deepEqual(cardsIn(after, "p2", "battle"), [], "the blocker was KO'd for it");
  assert.ok(!isOver(after), "and the game goes on");
});

// 2b. The same attack with six life is not chump-blocked: a life card (to the hand) costs less than the blocker.
scenario("no chump block while life allows", () => {
  const m = battleAt(opening, { p1: ATTACKER([], "C-V10"), p2: DEFENDER([], 6, [{ cardId: "C-CHUMP", mode: "active" }]) }, "C-V10");
  const { match: after, steps } = fight(m);
  battleLengths.push(steps.length);
  assert.ok(chosen(steps, "blocker", "p2")[0]?.id.includes("null"), `p2 does not block (${said(steps)})`);
  assert.equal(lifeOf(after, "p2"), 5, "one life is taken");
  assert.deepEqual(cardsIn(after, "p2", "battle"), ["C-CHUMP"], "the blocker is still there");
});

// 2c. A blocker the attack cannot beat is used, even when the hit would not be lethal: it costs only a rest.
scenario("a surviving blocker is used", () => {
  const m = battleAt(opening, { p1: ATTACKER([], "C-V10"), p2: DEFENDER([], 6, [{ cardId: "C-BLOCK", mode: "active" }, { cardId: "C-CHUMP", mode: "active" }]) }, "C-V10");
  const { match: after, steps } = fight(m);
  battleLengths.push(steps.length);
  const block = chosen(steps, "blocker", "p2")[0];
  assert.ok(block && after.state.cards[JSON.parse(block.id.slice("m:block:".length)).card].cardId === "C-BLOCK", `p2 blocks with the 20,000 blocker (${said(steps)})`);
  assert.equal(lifeOf(after, "p2"), 6, "no life is lost");
  assert.deepEqual(cardsIn(after, "p2", "battle"), ["C-BLOCK", "C-CHUMP"], "both blockers survive");
});

// 2d. Attacker ties: 15,000 into a rested 15,000 Battle Card already wins (8-4-6), so the attacker spends nothing;
//     the defender needs one power and combos the cheapest card that is enough (the free 5,000, not the 10,000).
scenario("attacker ties + minimum sufficient defence", () => {
  const m = battleAt(opening, { p1: ATTACKER(["C-V5", "C-V10"], "C-V10"), p2: DEFENDER(["C-V5", "C-V10"], 6, [{ cardId: "C-V10", mode: "rest" }]) }, "C-V10", "C-V10");
  const { match: after, steps } = fight(m);
  battleLengths.push(steps.length);
  assert.ok(chosen(steps, "combo", "p1").every((s) => s.id.startsWith("m:pass:")), `the tied attacker passes (${said(steps)})`);
  assert.ok(/ties go to the attacker/.test(chosen(steps, "combo", "p1")[0].how), "because the attacker wins ties");
  const defence = chosen(steps, "combo", "p2").filter((s) => s.id.startsWith("m:combo:"));
  assert.equal(defence.length, 1, `the defender combos exactly one card (${said(steps)})`);
  assert.deepEqual(cardsIn(after, "p2", "hand"), ["C-V10"], "the free 5,000 combo, keeping the 10,000 one");
  assert.deepEqual(cardsIn(after, "p1", "hand"), ["C-V10", "C-V5"], "the attacker's hand is untouched");
  assert.deepEqual(cardsIn(after, "p2", "battle"), ["C-V10"], "the guard survives");
  assert.equal(activeEnergy(after, "p2"), 2, "no energy was spent on the free combo");
});

// 2e. Offence, exactly enough: 15,000 into a rested 25,000 needs 10,000 — one 10,000 card for one energy beats two
//     free 5,000s (two cards), and nothing more is added.
scenario("offensive combo exactly enough", () => {
  const m = battleAt(opening, { p1: ATTACKER(["C-V5", "C-V5", "C-V10"], "C-V10"), p2: DEFENDER([], 6, [{ cardId: "C-BIG", mode: "rest" }]) }, "C-V10", "C-BIG");
  const { match: after, steps } = fight(m);
  battleLengths.push(steps.length);
  const offence = chosen(steps, "combo", "p1").filter((s) => s.id.startsWith("m:combo:"));
  assert.equal(offence.length, 1, `one combo card (${said(steps)})`);
  assert.deepEqual(cardsIn(after, "p1", "hand"), ["C-V5", "C-V5"], "the 10,000 combo was used, the two 5,000s kept");
  assert.equal(activeEnergy(after, "p1"), 1, "for one energy");
  assert.deepEqual(cardsIn(after, "p2", "battle"), [], "and the 25,000 card is KO'd");
});

// 2f. No combo on a battle that cannot be won — attacker and defender alike.
scenario("no combos on a lost battle", () => {
  const m = battleAt(opening, { p1: ATTACKER(["C-V5"], "C-V5"), p2: DEFENDER([], 6, [{ cardId: "C-BIG", mode: "rest" }]) }, "C-V5", "C-BIG");
  const { match: after, steps } = fight(m);
  battleLengths.push(steps.length);
  assert.ok(chosen(steps, "combo", "p1").every((s) => s.id.startsWith("m:pass:")), `the attacker passes (${said(steps)})`);
  assert.ok(/out of reach/.test(chosen(steps, "combo", "p1")[0].how), "because 15,001 more power is out of reach");
  assert.deepEqual(cardsIn(after, "p1", "hand"), ["C-V5"], "the hand is kept");
  const d = battleAt(opening, { p1: ATTACKER([], "C-BIG"), p2: DEFENDER(["C-V5"], 6) }, "C-BIG");
  const def = fight(d);
  battleLengths.push(def.steps.length);
  assert.ok(chosen(def.steps, "combo", "p2").every((s) => s.id.startsWith("m:pass:")), `the defender passes a 25,000 attack it cannot hold (${said(def.steps)})`);
  assert.deepEqual(cardsIn(def.match, "p2", "hand").filter((c) => c === "C-V5").length, 1, "and keeps its combo card");
});

// 2g. [Critical] and [Double Strike]: the same 15,000 attack and the same two free 5,000 combos in hand. A plain hit
//     at 4 life is taken (1 life to the hand costs less than two cards); a [Critical] hit — the life goes to the Drop
//     (22-6) — and a [Double Strike] hit at 3 life — two life (22-7) — are defended with both. (p2's Leader is the
//     plain one here, so its battle activation does not cover the deficit for less.)
scenario("Critical and Double Strike change the defence", () => {
  const run = (attacker: string, life: number) => {
    const m = battleAt(opening, { p1: ATTACKER([], attacker), p2: DEFENDER(["C-V5", "C-V5"], life) }, attacker, "leader", { p2: "C-L-RED" });
    const r = fight(m);
    battleLengths.push(r.steps.length);
    return { ...r, combos: chosen(r.steps, "combo", "p2").filter((s) => s.id.startsWith("m:combo:")).length };
  };
  const plain = run("C-V10", 4);
  assert.equal(plain.combos, 0, `a plain hit at 4 life is taken (${said(plain.steps)})`);
  assert.equal(lifeOf(plain.match, "p2"), 3);
  const crit = run("C-CRIT", 4);
  assert.equal(crit.combos, 2, `a [Critical] hit at 4 life is defended with both combos (${said(crit.steps)})`);
  assert.equal(lifeOf(crit.match, "p2"), 4);
  const plain3 = run("C-V10", 3);
  assert.equal(plain3.combos, 0, `a plain hit at 3 life is taken (${said(plain3.steps)})`);
  const ds = run("C-DS", 3);
  assert.equal(ds.combos, 2, `a [Double Strike] hit at 3 life is defended (${said(ds.steps)})`);
  assert.equal(lifeOf(ds.match, "p2"), 3);
});

// 2h. Counters. Lethal and no blocker: the negating [Counter: Attack] is taken and paid. Survivable: kept in hand.
//     Lethal but a 20,000 [Blocker] still to be asked: the counter is kept and the blocker used.
scenario("counter when legal and worth it", () => {
  const lethal = battleAt(opening, { p1: ATTACKER([], "C-V10"), p2: DEFENDER(["C-NEG"], 1) }, "C-V10");
  assert.equal(lethal.state.prompt.kind, "counter", "the counter timing opens");
  const a = fight(lethal);
  battleLengths.push(a.steps.length);
  const counter = chosen(a.steps, "counter", "p2")[0];
  assert.ok(counter && !counter.id.includes("null"), `p2 counters a lethal attack (${said(a.steps)})`);
  assert.equal(lifeOf(a.match, "p2"), 1, "the attack is negated");
  assert.ok(cardsIn(a.match, "p2", "drop").includes("C-NEG") && !cardsIn(a.match, "p2", "hand").includes("C-NEG"), "the counter card is spent");
  assert.equal(activeEnergy(a.match, "p2"), 1, "and its one energy paid");

  const safe = battleAt(opening, { p1: ATTACKER([], "C-V10"), p2: DEFENDER(["C-NEG"], 6) }, "C-V10");
  const b = fight(safe);
  battleLengths.push(b.steps.length);
  assert.ok(chosen(b.steps, "counter", "p2")[0]?.id.includes("null"), `p2 keeps the counter against a survivable hit (${said(b.steps)})`);
  assert.equal(lifeOf(b.match, "p2"), 5);
  assert.ok(cardsIn(b.match, "p2", "hand").includes("C-NEG"));

  const blocked = battleAt(opening, { p1: ATTACKER([], "C-V10"), p2: DEFENDER(["C-NEG"], 1, [{ cardId: "C-BLOCK", mode: "active" }]) }, "C-V10");
  const c = fight(blocked);
  battleLengths.push(c.steps.length);
  assert.ok(chosen(c.steps, "counter", "p2")[0]?.id.includes("null"), `with a surviving blocker to come, the counter is kept (${said(c.steps)})`);
  assert.ok(chosen(c.steps, "blocker", "p2")[0] && !chosen(c.steps, "blocker", "p2")[0].id.includes("null"), "and the blocker blocks");
  assert.equal(lifeOf(c.match, "p2"), 1);
  assert.ok(cardsIn(c.match, "p2", "hand").includes("C-NEG"));
});

// 2i. A battle activation: the defender's Leader reads "[Activate: Battle] Your Leader gets +5000 power for the turn."
//     A tie at 10,000 needs one power; the free activation covers it more cheaply than the combo card in hand.
scenario("battle activation covers a deficit", () => {
  const m = battleAt(opening, { p1: ATTACKER([], "C-V5"), p2: DEFENDER(["C-V5"], 3) }, "C-V5");
  const r = fight(m);
  battleLengths.push(r.steps.length);
  const def = chosen(r.steps, "combo", "p2");
  assert.ok(def[0]?.id.startsWith("m:activate:"), `the Leader's pump is used (${said(r.steps)})`);
  assert.equal(def.filter((s) => s.id.startsWith("m:activate:")).length, 1, "once");
  assert.equal(lifeOf(r.match, "p2"), 3, "the attack is held");
  assert.deepEqual(cardsIn(r.match, "p2", "hand"), ["C-V5"], "with the combo card kept");
});

// 2j. The same decisions from the other chair: p2 attacks, p1 defends. A lethal hit is blocked with the blocker that
//     survives it, and the counter in hand is kept; a survivable hit with only a chump blocker is taken.
scenario("p1 defends: block and keep the counter, or take the hit", () => {
  const p2Main = p2MainPhase(opening);
  const m = battleAt(p2Main, { p2: ATTACKER([], "C-V10"), p1: DEFENDER(["C-NEG"], 1, [{ cardId: "C-BLOCK", mode: "active" }]) }, "C-V10");
  const r = fight(m);
  battleLengths.push(r.steps.length);
  assert.ok(chosen(r.steps, "counter", "p1")[0]?.id.includes("null"), `p1 keeps its counter (${said(r.steps)})`);
  const block = chosen(r.steps, "blocker", "p1")[0];
  assert.ok(block && !block.id.includes("null"), "p1 blocks");
  assert.equal(lifeOf(r.match, "p1"), 1);
  assert.ok(cardsIn(r.match, "p1", "hand").includes("C-NEG"));
  const s2 = battleAt(p2Main, { p2: ATTACKER([], "C-V10"), p1: DEFENDER(["C-NEG"], 6, [{ cardId: "C-CHUMP", mode: "active" }]) }, "C-V10");
  const r2 = fight(s2);
  battleLengths.push(r2.steps.length);
  assert.ok(chosen(r2.steps, "blocker", "p1")[0]?.id.includes("null") && chosen(r2.steps, "counter", "p1")[0]?.id.includes("null"), `p1 takes the hit (${said(r2.steps)})`);
  assert.equal(lifeOf(r2.match, "p1"), 5);
});

// ---------------------------------------------------------------------------------------------
// 3. Termination.
assert.ok(Math.max(...battleLengths) <= 12, `every staged battle ends within 12 decisions (${battleLengths.join(", ")})`);
{
  // The guard ends a blocker window a stubborn policy would not end: with "Don't block".
  const m = battleAt(opening, { p1: ATTACKER([], "C-V10"), p2: DEFENDER([], 6, [{ cardId: "C-CHUMP", mode: "active" }]) }, "C-V10");
  const input = policyTurn(m, "p2", 0).input;
  const stubborn: Policy = (inp, rng) => ({ answer: answerFor(inp.decisions, inp.decisions.decisions.find((d) => d.kind === "menu" && d.type === "block" && d.action.card !== null)!.id), rng });
  let memory = localMemory(policyRng(1));
  const seen: string[] = [];
  for (let k = 0; k < TURN_GUARD.repeats + 1; k++) {
    const g = guardedDecide(stubborn, input, memory);
    assert.ok(g.ok);
    memory = g.memory;
    seen.push(g.guard ?? g.answer.id);
  }
  assert.match(seen[TURN_GUARD.repeats], /^cycle guard: the same position 4 times this turn — block$/, "the fourth visit is ended by the guard");
  const exit = guardedDecide(stubborn, input, { ...localMemory(policyRng(1)), turn: input.observation.turn, decisions: TURN_GUARD.decisions });
  assert.ok(exit.ok && exit.guard && exit.answer.id === 'm:block:{"card":null,"type":"block"}', `the guard's exit is "Don't block" (${exit.ok ? exit.answer.id : ""})`);
  const noExit: PolicyInput = { ...input, decisions: { ...input.decisions, decisions: input.decisions.decisions.filter((d) => d.kind !== "menu" || d.action.card !== null) } };
  const stuck = guardedDecide(stubborn, noExit, { ...localMemory(policyRng(1)), turn: noExit.observation.turn, decisions: TURN_GUARD.decisions });
  assert.ok(!stuck.ok && /no endMain, pass or decline/.test(stuck.interrupted), "with no decline open the guard interrupts");
  // The counter window's decline is an exit too.
  const cm = battleAt(opening, { p1: ATTACKER([], "C-V10"), p2: DEFENDER(["C-NEG"], 6) }, "C-V10");
  const cin = policyTurn(cm, "p2", 0).input;
  const cexit = guardedDecide(stubborn, cin, { ...localMemory(policyRng(1)), turn: cin.observation.turn, decisions: TURN_GUARD.decisions });
  assert.ok(cexit.ok && cexit.answer.id === 'm:counter:{"card":null,"type":"counter"}', "the guard's exit at the counter timing is \"Don't counter\"");
}
let boundedWork = 0;
{
  // A 14-card hand of combo cards against a 25,000 attack: the cover search does real work, inside the bound.
  const m = battleAt(opening, { p1: ATTACKER([], "C-BIG"), p2: DEFENDER(Array.from({ length: 14 }, (_, i) => (i % 2 ? "C-V5" : "C-V10")), 2, [], 3) }, "C-BIG");
  const r = fight(m);
  battleLengths.push(r.steps.length);
  for (const s of chosen(r.steps, "combo", "p2")) assert.ok(s.how.length > 0);
  const combos = chosen(r.steps, "combo", "p2").filter((s) => s.id.startsWith("m:combo:")).length;
  assert.ok(combos >= 2 && combos <= 3, `two or three combos hold 25,000 at 2 life (${said(r.steps)})`);
  assert.equal(lifeOf(r.match, "p2"), 2, "and they do");
  const first = policyTurn(battleAt(opening, { p1: ATTACKER([], "C-BIG"), p2: DEFENDER(Array.from({ length: 14 }, (_, i) => (i % 2 ? "C-V5" : "C-V10")), 2, [], 3) }, "C-BIG"), "p2", 0);
  boundedWork = combatChoice(first.input)?.work ?? 0;
  named.push(`work bound (${boundedWork} steps at a 14-card hand's first question)`);
}

// ---------------------------------------------------------------------------------------------
// 4. Every position.
// 4a. #642's scenarios.
const bundle641 = await fixtureBundle();
for (const id of scenarioIds()) {
  let revision = 0;
  const evidence = await runScenario(id, { bundle: bundle641, interpreterRevision: FIXTURE_REVISION, observe: (match) => checkPosition(`642:${id}`, match, revision++) });
  assert.ok(evidence.pass, `scenario ${id} still passes with the observer attached`);
}

// 4b + 5. Strength games, every battle position of the test seat checked.
const FIXTURES = [
  { name: "641", bundle: bundle641, revision: FIXTURE_REVISION, seed: FIXTURE_SEED },
  { name: "644", bundle: await policyFixtureBundle(), revision: POLICY_FIXTURE_REVISION, seed: POLICY_FIXTURE_SEED },
  { name: "646", bundle: await mainFixtureBundle(), revision: MAIN_FIXTURE_REVISION, seed: 646 },
  { name: "647", bundle: combatBundle, revision: COMBAT_FIXTURE_REVISION, seed: COMBAT_FIXTURE_SEED },
];
const GAMES_PER_FIXTURE = 4;
const results: Record<"main646" | "shortcuts", { fixture: string; seat: PlayerId; r: DuelResult }[]> = { main646: [], shortcuts: [] };
let guardTrips = 0;
for (const [name, baseline] of [["main646", MAIN646], ["shortcuts", SHORTCUTS]] as const) {
  for (const f of FIXTURES) {
    for (let g = 0; g < GAMES_PER_FIXTURE; g++) {
      const testSeat: PlayerId = g % 2 === 0 ? "p1" : "p2";
      const r = await playDuel({
        bundle: f.bundle,
        interpreterRevision: f.revision,
        gameSeed: f.seed * 100 + 47 + Math.floor(g / 2),
        policySeed: g + 11,
        testSeat,
        test: LOCAL,
        baseline,
        maxMoves: 1500,
        observe: (match, seat, n) => { if (name === "main646" && seat === testSeat) checkPosition(`duel ${f.name}/${g}`, match, n); },
      });
      assert.equal(r.stopped?.includes("refused") ?? false, false, `duel ${name} ${f.name}/${g}: no decision was refused (${r.stopped})`);
      guardTrips += r.guards.test;
      results[name].push({ fixture: f.name, seat: testSeat, r });
    }
  }
}

for (const w of COMBAT_WINDOWS) assert.ok(Object.keys(byWindow).some((k) => k.startsWith(`${w}:`)), `the walk reaches ${w} questions (${JSON.stringify(byWindow)})`);
for (const w of COMBAT_WINDOWS) for (const p of ["p1", "p2"]) assert.ok(byWindow[`${w}:${p}`], `the walk reaches ${w} questions for ${p} (${JSON.stringify(byWindow)})`);
for (const c of ["combo:combo", "combo:pass", "blocker:block", "blocker:block-decline", "counter:counter-decline"]) assert.ok(chose.has(c), `the walk chooses ${c} (chose: ${[...chose].sort().join(", ")})`);
assert.ok(tally.nontrivial > tally.permutations / 2, `most permuted states really differ (${tally.nontrivial} of ${tally.permutations})`);
assert.equal(guardTrips, 0, "the local policy never needed the cycle guard in the strength games");

// Cost: the policy's own share of the #643 decision budget (p95 30 ms, max 300 ms) — generous ceilings so a busy
// machine does not fail the suite; the deterministic bound is the work counter.
const cost = { p50: quantile(choiceTimes, 0.5), p95: quantile(choiceTimes, 0.95), max: Math.max(...choiceTimes) };
if (process.argv.includes("--record-performance")) {
  // Explicit observational run on a host whose timing is not an acceptance gate.
  // The normal npm test command keeps both ceilings; no functional assertion is skipped.
  console.log(`PERFORMANCE RECORDED ONLY: battle policy p95 ${cost.p95.toFixed(2)} ms (limit 5), max ${cost.max.toFixed(1)} ms (limit 100)`);
} else {
  assert.ok(cost.p95 <= 5, `battle policy p95 ${cost.p95.toFixed(2)} ms is within 5 ms`);
  assert.ok(cost.max <= 100, `battle policy max ${cost.max.toFixed(1)} ms is within 100 ms`);
}

// ---------------------------------------------------------------------------------------------
// 5. Strength.
const report = (name: "main646" | "shortcuts") => {
  const all = summarise(results[name]);
  const [lo, hi] = wilson(all.wins, all.wins + all.losses);
  const per = FIXTURES.map((f) => { const s = summarise(results[name].filter((x) => x.fixture === f.name)); return `${f.name} ${s.wins}-${s.losses}${s.draws ? `-${s.draws}d` : ""}${s.unfinished ? ` (${s.unfinished} unfinished)` : ""}`; }).join(", ");
  return { all, line: `vs ${name}: ${all.wins}-${all.losses} of ${all.games} (win rate ${(all.wins / Math.max(1, all.wins + all.losses) * 100).toFixed(0)} %, 95 % CI ${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)} %), life damage ${all.damageDealt} dealt / ${all.damageTaken} taken; ${per}` };
};
const vsMain = report("main646");
const vsShortcuts = report("shortcuts");
assert.equal(vsMain.all.unfinished + vsShortcuts.all.unfinished, 0, "every strength game finished");
assert.ok(vsShortcuts.all.wins > vsShortcuts.all.losses, `the local policy wins more than it loses against shortcuts + uniform (${vsShortcuts.all.wins}-${vsShortcuts.all.losses})`);

console.log(`arena-policy-combat: named scenarios ok — ${named.join("; ")}`);
console.log(`  staged battles end in ${Math.min(...battleLengths)}-${Math.max(...battleLengths)} decisions; ${tally.positions} battle positions (${Object.entries(byWindow).sort().map(([k, v]) => `${k} ${v}`).join(", ")}), all legal, deterministic and RNG-free; ${tally.permutations} permuted hidden states (${tally.nontrivial} differing) with identical choices; max work ${tally.maxWork}/${COMBAT_LIMITS.work} (${tally.bounded} bounded); chose ${[...chose].sort().join(", ")}`);
console.log(`  cost (Node): battle policy p50 ${cost.p50.toFixed(2)} / p95 ${cost.p95.toFixed(2)} / max ${cost.max.toFixed(1)} ms per decision`);
console.log(`  strength, seeded games (synthetic fixtures; ${GAMES_PER_FIXTURE} per fixture and baseline): ${vsMain.line}`);
console.log(`  ${vsShortcuts.line}`);
console.log(`  ${((Date.now() - started) / 1000).toFixed(1)} s`);
