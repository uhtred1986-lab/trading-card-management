/**
 * #644 (plan O2-01): the restricted policy observation and the legal-decision contract
 * (`src/lib/arena/policy/`), proved without a database.
 *
 *   1. Import guards. The policy layer (`contract.ts`, `observation.ts`, `rng.ts`, `shortcuts.ts`,
 *      `main.ts`) loads
 *      nothing outside `policy/` — no engine, no game RNG, no provider, no database — and its
 *      source names no engine state, seed or ambient randomness. The boundary (`boundary.ts`)
 *      passes #641's browser rule. Each rule is first shown to catch a deliberately added import.
 *   2. Positions. Every position of #641's fixed-seed game, of every #642 scenario, and of two
 *      games on a fixture that reaches compound choices (played by the reference policy through
 *      the contract itself), for both seats:
 *        - no hidden information: no instance id the seat may not read appears in its observation
 *          or decisions, and no private reveal epoch, seed or RNG state does;
 *        - permutation invariance: permuting the identities, order and instance ids of every card
 *          the seat cannot see (the other hand, both decks, face-down life) leaves its observation,
 *          its decisions, its decision ids and the reference policy's answer for the same policy
 *          RNG identical;
 *        - round trip: every legal move is exactly one decision, and playing the decision equals
 *          playing the engine's move (state and events); compound picks likewise;
 *        - refusals: an answer to the previous position is stale, another seat's is foreign, a
 *          seat that is not asked has nothing to answer, and malformed answers are refused.
 *   3. Policy RNG. The reference policy is deterministic in its own RNG, never mutates the match,
 *      and a policy-played game replays from its moves alone — the game's RNG was never drawn on.
 *
 * Run from the repo root:  npx tsx scripts/verify/arena-policy-contract.mts   (part of `npm test`)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { checkImportGraph, diskRead, legacyEngineRule, policyLayerRule, policyLayerSourceViolations } from "../lib/import-graph.ts";
import { fixtureBundle, FIXTURE_REVISION, FIXTURE_SEED } from "./arena-browser-fixture.ts";
import { pick } from "./arena-browser-scenario.ts";
import { hiddenFrom, permutedFor, shuffled, strings, testRandom } from "./arena-policy-permute.ts";
import { runScenario, scenarioIds } from "./arena-scenarios.ts";
import { policyFixtureBundle, POLICY_FIXTURE_REVISION, POLICY_FIXTURE_SEED } from "./arena-policy-fixture.ts";
import type { Action, LegalAction, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { applyMove, createPinnedMatch, legalMoves, projectSnapshot, replayWith, RULES_ENGINE, type PinnedMatch } from "../../src/lib/arena/browser.ts";
import { canonicalJson } from "../../src/lib/arena/replay-core.ts";
import { applyDecision, ownDeck, policyTurn, type PolicyTurn } from "../../src/lib/arena/policy/boundary.ts";
import { buildObservation } from "../../src/lib/arena/policy/observation.ts";
import { answerFor, resolveAnswer, uniformPolicy, PICK_ID, type PolicyAnswer } from "../../src/lib/arena/policy/contract.ts";
import { nextRandom, policyRng, type PolicyRng } from "../../src/lib/arena/policy/rng.ts";

const ROOT = process.cwd();
const SEATS: PlayerId[] = ["p1", "p2"];
const LAYER = ["src/lib/arena/policy/contract.ts", "src/lib/arena/policy/main.ts", "src/lib/arena/policy/observation.ts", "src/lib/arena/policy/rng.ts", "src/lib/arena/policy/shortcuts.ts"];
const BOUNDARY = "src/lib/arena/policy/boundary.ts";
const started = Date.now();

// ---------------------------------------------------------------------------------------------
// 1. Import guards.
{
  const walked = new Set<string>();
  for (const entry of LAYER) {
    const real = checkImportGraph(path.join(ROOT, entry), ROOT, diskRead, { forbidFile: policyLayerRule });
    for (const v of real.violations) console.error(`  forbidden from ${entry}: ${v.file}: ${v.reason}`);
    assert.equal(real.violations.length, 0, `${entry} reaches outside the policy layer`);
    for (const f of real.files) walked.add(f);
  }
  for (const f of walked) {
    const found = policyLayerSourceViolations(f, fs.readFileSync(path.join(ROOT, f), "utf8"));
    assert.deepEqual(found, [], `${f} names engine state or ambient randomness: ${found.join("; ")}`);
  }
  assert.deepEqual([...walked].sort(), [...LAYER].sort(), "the policy layer is exactly its five modules");

  const contractPath = path.join(ROOT, "src/lib/arena/policy/contract.ts");
  const sabotaged = (extra: string) => (file: string) => (file === contractPath ? `${fs.readFileSync(contractPath, "utf8")}\n${extra}\n` : diskRead(file));
  for (const [extra, expected] of [
    [`import { RULES } from "../vm";`, "policy layer reaches outside the policy layer src/lib/arena/vm/index.ts"],
    [`import { nextFloat } from "../vm/rng";`, "policy layer reaches outside the policy layer src/lib/arena/vm/rng.ts"],
    [`import { projectSnapshot } from "../browser";`, "policy layer reaches outside the policy layer src/lib/arena/browser.ts"],
    [`import { policyTurn } from "./boundary";`, "policy layer reaches outside the policy layer src/lib/arena/policy/boundary.ts"],
    [`import { generateJson } from "@/lib/ai/core";`, "server-only import @/lib/ai/core"],
    [`import { db } from "@/db";`, "server-only import @/db"],
    [`import Anthropic from "@anthropic-ai/sdk";`, "package or builtin import @anthropic-ai/sdk"],
  ] as const) {
    const caught = checkImportGraph(contractPath, ROOT, sabotaged(extra), { forbidFile: policyLayerRule });
    assert.ok(caught.violations.some((v) => v.file === "src/lib/arena/policy/contract.ts" && v.reason === expected), `adding \`${extra}\` to contract.ts is caught as "${expected}" (got ${JSON.stringify(caught.violations)})`);
  }
  const base = fs.readFileSync(contractPath, "utf8");
  for (const [extra, expected] of [
    [`import type { VmState } from "../vm/state";\nexport type Peek = VmState["rngState"];`, "engine state or seed named: VmState"],
    [`import type { EngineState } from "../engines";\nexport type Peek2 = EngineState;`, "engine state or seed named: EngineState"],
    [`export const roll = () => Math.random();`, "ambient time or randomness: Math.random"],
    [`export const now = () => Date.now();`, "ambient time or randomness: Date"],
    [`export const s = (o: { seed: number }) => o.seed;`, "engine state or seed named: seed"],
  ] as const) {
    assert.ok(policyLayerSourceViolations("src/lib/arena/policy/contract.ts", `${base}\n${extra}\n`).includes(expected), `the source scan catches "${expected}"`);
  }
  const boundary = checkImportGraph(path.join(ROOT, BOUNDARY), ROOT, diskRead, { forbidFile: legacyEngineRule });
  assert.deepEqual(boundary.violations, [], "the boundary is browser-safe (#641's rule)");
}

// ---------------------------------------------------------------------------------------------
// Helpers.
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const FORBIDDEN_KEYS = new Set(["revealEpoch", "rngState", "seed", "imageUrl"]);

const isOver = (m: PinnedMatch) => m.state.phase === "over";
const actorOf = (m: PinnedMatch): PlayerId | null => (isOver(m) ? null : ((m.state.prompt as { player?: PlayerId }).player ?? null));
const outcome = (r: { match: PinnedMatch; events: unknown }) => canonicalJson({ state: r.match.state, events: r.events, beats: r.match.beats });

const tally = { positions: 0, seatViews: 0, permutations: 0, permutationsNontrivial: 0, negativeControls: 0, menuRoundTrips: 0, pickRoundTrips: 0, multiCardPicks: 0, pickRefusedByEngine: 0, stale: 0, foreign: 0, malformed: 0 };
const windows = new Set<string>();
const MALFORMED: unknown[] = [null, 7, "m:endMain:{}", [], {}, { v: 2 }];

let previous: { seat: PlayerId; answer: PolicyAnswer }[] = [];

/** Every check for one position. `revision` is the session's move count. */
function checkPosition(label: string, match: PinnedMatch, revision: number): void {
  tally.positions++;
  const before = canonicalJson(match);
  const turns: Partial<Record<PlayerId, PolicyTurn>> = {};
  const nextPrevious: typeof previous = [];
  for (const seat of SEATS) {
    tally.seatViews++;
    const turn = policyTurn(match, seat, revision);
    turns[seat] = turn;
    const where = `${label} r${revision} ${seat}`;
    // A JSON round trip (a worker message) loses nothing.
    assert.deepEqual(clone(turn.input), turn.input, `${where}: the policy input is plain JSON`);
    assert.deepEqual(clone(turn.key), turn.key, `${where}: the decision key is plain JSON`);

    // No hidden information.
    const hidden = hiddenFrom(match.state, seat);
    const seen = strings(turn.input);
    const leaked = [...hidden].filter((id) => seen.values.has(id));
    assert.deepEqual(leaked, [], `${where}: the observation names cards ${seat} may not read`);
    for (const k of FORBIDDEN_KEYS) assert.ok(!seen.keys.has(k), `${where}: the policy input carries "${k}"`);
    const obs = turn.input.observation;
    assert.equal(obs.them.hand, null, `${where}: the other hand is withheld`);
    assert.equal(obs.seat, seat);

    // Who is asked.
    const actor = actorOf(match);
    const decisions = turn.input.decisions;
    if (actor !== seat) {
      assert.equal(decisions.decisions.length, 0, `${where}: a seat that is not asked has no decisions`);
      assert.equal(obs.prompt.mine, false, `${where}: the other seat's question is withheld`);
      assert.deepEqual(Object.keys(obs.prompt).sort(), ["actor", "kind", "mine"], `${where}: only the other question's kind and actor`);
      const probe = answerFor(decisions, "m:pass:{}");
      const r = resolveAnswer(turn.key, probe);
      assert.ok(!r.ok && r.reason === "foreign", `${where}: an answer from a seat not asked is foreign`);
      tally.foreign++;
    } else {
      windows.add(decisions.window);
      // Round trip: every legal move is exactly one decision, and the decision plays as the move.
      const legal: LegalAction[] = legalMoves(match).filter((l) => l.action.type !== "concede" && l.action.type !== "refereeRuling");
      const menu = decisions.decisions.filter((d) => d.kind === "menu");
      assert.equal(menu.length, new Set(legal.map((l) => canonicalJson(l.action))).size, `${where}: one menu decision per legal move`);
      assert.equal(new Set(decisions.decisions.map((d) => d.id)).size, decisions.decisions.length, `${where}: decision ids are unique`);
      for (const l of legal) {
        const found = menu.filter((d) => { const r = resolveAnswer(turn.key, answerFor(decisions, d.id)); return r.ok && r.actions.length === 1 && canonicalJson(r.actions[0]) === canonicalJson(l.action); });
        assert.equal(found.length, 1, `${where}: ${l.label} is exactly one decision`);
        const answer = clone(answerFor(decisions, found[0].id));
        const viaDecision = applyDecision(match, clone(turn.key), answer);
        assert.ok(viaDecision.ok, `${where}: ${found[0].id} plays`);
        assert.equal(outcome(viaDecision as { match: PinnedMatch; events: unknown }), outcome(applyMove(match, l.action)), `${where}: ${found[0].id} plays exactly as the engine's move`);
        tally.menuRoundTrips++;
      }
      const pickDecision = decisions.decisions.find((d) => d.kind === "pick");
      if (pickDecision && pickDecision.kind === "pick") {
        windows.add("chooseCards (compound pick)");
        const rand = testRandom(revision * 31 + (seat === "p1" ? 1 : 2));
        const pr = match.state.prompt as Extract<VmState["prompt"], { kind: "chooseCards" }>;
        const sameQuestion = (m: PinnedMatch) => !isOver(m) && m.state.prompt.kind === "chooseCards" && m.state.prompt.player === seat && m.state.prompt.choice.continuation === pr.choice.continuation;
        const most = Math.min(pickDecision.remaining ?? pickDecision.candidates.length, pickDecision.candidates.length);
        for (let k = 0; k < 4; k++) {
          const size = pickDecision.upTo ? rand(most + 1) : pickDecision.remaining === null ? 1 + rand(most) : most;
          const cards = shuffled(pickDecision.candidates, rand).slice(0, size);
          if (size > 1) tally.multiCardPicks++;
          const viaDecision = applyDecision(match, clone(turn.key), clone(answerFor(decisions, PICK_ID, cards)));
          // The same picks as the engine's own one-card answers, by hand: each card while the
          // question is open and offers it, then "Choose none" if an "up to" is still open.
          let direct: string | "refused" = "refused";
          try {
            let m = match;
            const events: unknown[] = [];
            let ok = true;
            for (const c of cards) {
              const real = turn.key.pick!.candidates[c];
              if (!sameQuestion(m) || !(m.state.prompt as typeof pr).choice.candidates.includes(real)) { ok = false; break; }
              const r = applyMove(m, { type: "choose", player: seat, cards: [real] });
              m = r.match;
              events.push(...r.events);
            }
            if (ok && pickDecision.upTo && sameQuestion(m)) { const r = applyMove(m, { type: "choose", player: seat, cards: [] }); m = r.match; events.push(...r.events); }
            if (ok) direct = outcome({ match: m, events });
          } catch { direct = "refused"; }
          if (direct === "refused") {
            assert.ok(!viaDecision.ok && viaDecision.reason === "refused", `${where}: an engine-refused pick is refused, not played (${JSON.stringify(viaDecision).slice(0, 200)})`);
            tally.pickRefusedByEngine++;
          } else {
            assert.ok(viaDecision.ok, `${where}: a pick of ${cards.length} within the constraints plays (${JSON.stringify(viaDecision).slice(0, 200)})`);
            assert.equal(outcome(viaDecision), direct, `${where}: a compound pick plays exactly as the engine's one-card answers`);
            tally.pickRoundTrips++;
          }
        }
        const c = pickDecision.candidates;
        const bad: [string[], string][] = [
          [[c[0], c[0]], "a card picked twice"],
          [["?nowhere:0"], "not a candidate"],
        ];
        if (pickDecision.remaining !== null && c.length > pickDecision.remaining) bad.push([c.slice(0, pickDecision.remaining + 1), "too many"]);
        if (!pickDecision.upTo) bad.push([[], "an exact choice declined"]);
        for (const [cards, why] of bad) {
          const r = resolveAnswer(turn.key, answerFor(decisions, PICK_ID, cards));
          assert.ok(!r.ok && (r.reason === "invalid"), `${where}: an invalid pick (${why}) is refused (got ${JSON.stringify(r)})`);
        }
      }
      // Malformed answers.
      for (const m of [...MALFORMED, { ...answerFor(decisions, menu[0]?.id ?? "x"), v: 2 }, { ...answerFor(decisions, menu[0]?.id ?? "x"), cards: [1] }]) {
        const r = resolveAnswer(turn.key, m);
        assert.ok(!r.ok && r.reason === "malformed", `${where}: ${JSON.stringify(m)} is malformed`);
        tally.malformed++;
      }
      const unknown = resolveAnswer(turn.key, answerFor(decisions, "m:nothing:{}"));
      assert.ok(!unknown.ok && unknown.reason === "unknown", `${where}: an unknown decision id is refused`);
      if (menu[0]) {
        const withCards = resolveAnswer(turn.key, answerFor(decisions, menu[0].id, []));
        assert.ok(!withCards.ok && withCards.reason === "invalid", `${where}: a menu decision with cards is refused`);
      }
      // Stale: the previous position's answer for this seat.
      for (const p of previous.filter((x) => x.seat === seat)) {
        const r = resolveAnswer(turn.key, p.answer);
        assert.ok(!r.ok && r.reason === "stale", `${where}: an answer to the previous position is stale (got ${JSON.stringify(r)})`);
        tally.stale++;
      }
      // Foreign: the same answer presented as the other seat's.
      const other = seat === "p1" ? "p2" : "p1";
      if (menu[0]) {
        const r = resolveAnswer(turn.key, { ...answerFor(decisions, menu[0].id), seat: other });
        assert.ok(!r.ok && r.reason === "foreign", `${where}: another seat's answer is foreign`);
        tally.foreign++;
      }
      if (decisions.decisions.length) nextPrevious.push({ seat, answer: uniformPolicy(turn.input, policyRng(revision)).answer });
    }

    // Permutation invariance: equivalent information sets for this seat (a second one every fourth position).
    for (const salt of revision % 4 === 0 ? [1, 2] : [1]) {
      const twin = permutedFor(match, seat, revision * 7 + salt);
      if (hidden.size > 1 && canonicalJson(twin.state) !== canonicalJson(match.state)) tally.permutationsNontrivial++;
      const twinTurn = policyTurn(twin, seat, revision);
      // Negative control: without the alias table the same twin is told apart (instance ids in the beats).
      if (revision === 30 && label === "641") {
        const raw = (m: PinnedMatch) => canonicalJson(buildObservation(projectSnapshot(m, seat, { revision }), seat, ownDeck(m, seat), {}, { p1: [], p2: [] }));
        assert.notEqual(raw(twin), raw(match), `${where}: an observation that skips the alias table does see the permutation (the check is not vacuous)`);
        tally.negativeControls++;
      }
      if (canonicalJson(twinTurn.input) !== canonicalJson(turn.input)) {
        const a = canonicalJson(turn.input);
        const b = canonicalJson(twinTurn.input);
        let i = 0;
        while (a[i] === b[i]) i++;
        assert.fail(`${where}: a permuted hidden state changes ${seat}'s policy input near …${a.slice(Math.max(0, i - 120), i + 60)}… vs …${b.slice(Math.max(0, i - 120), i + 60)}…`);
      }
      if (turn.input.decisions.decisions.length) {
        const rng = policyRng(revision * 13 + salt);
        const a = uniformPolicy(turn.input, rng);
        const b = uniformPolicy(twinTurn.input, rng);
        assert.deepEqual(b, a, `${where}: the same policy RNG answers a permuted position the same`);
        assert.ok(resolveAnswer(twinTurn.key, a.answer).ok, `${where}: the answer resolves in the permuted position too`);
      }
      tally.permutations++;
    }
  }
  assert.equal(canonicalJson(match), before, `${label} r${revision}: building the policy input never touches the match`);
  previous = nextPrevious;
}

// ---------------------------------------------------------------------------------------------
// 2a. #641's fixed-seed game.
const bundle641 = await fixtureBundle();
{
  previous = [];
  let { match } = await createPinnedMatch({ bundle: bundle641, seed: FIXTURE_SEED, interpreterRevision: FIXTURE_REVISION });
  checkPosition("641", match, 0);
  for (let n = 1; n <= 120 && !isOver(match); n++) {
    const action = pick(n, legalMoves(match));
    if (!action) break;
    match = applyMove(match, action).match;
    checkPosition("641", match, n);
  }
}

// 2b. #642's scenarios, at every position they reach.
for (const id of scenarioIds()) {
  previous = [];
  let revision = 0;
  const evidence = await runScenario(id, { bundle: bundle641, interpreterRevision: FIXTURE_REVISION, observe: (match) => checkPosition(`642:${id}`, match, revision++) });
  assert.ok(evidence.pass, `scenario ${id} still passes with the observer attached`);
}

// 2c + 3. The compound-choice fixture, played by the reference policy through the contract.
const bundle644 = await policyFixtureBundle();
const policyGames: { seed: number; moves: number; turn: number; phase: string }[] = [];
for (const policySeed of [1, 2]) {
  previous = [];
  const created = await createPinnedMatch({ bundle: bundle644, seed: POLICY_FIXTURE_SEED, interpreterRevision: POLICY_FIXTURE_REVISION });
  let match = created.match;
  const rngs: Record<PlayerId, PolicyRng> = { p1: policyRng(policySeed * 100 + 1), p2: policyRng(policySeed * 100 + 2) };
  const actions: Action[] = [];
  checkPosition(`644/${policySeed}`, match, 0);
  for (let n = 1; n <= 140 && !isOver(match); n++) {
    const actor = actorOf(match);
    if (!actor) break;
    const turn = policyTurn(match, actor, n - 1);
    if (!turn.input.decisions.decisions.length) break;
    const rngBefore = clone(rngs[actor]);
    const stateBefore = canonicalJson(match.state);
    const chosen = uniformPolicy(turn.input, rngs[actor]);
    assert.deepEqual(rngs[actor], rngBefore, "the policy does not mutate the RNG state it was given");
    assert.deepEqual(uniformPolicy(turn.input, rngBefore), chosen, "the same policy RNG gives the same answer");
    assert.ok(chosen.rng.n > rngBefore.n, "the policy RNG advanced");
    const played = applyDecision(match, turn.key, chosen.answer);
    assert.ok(played.ok, `644/${policySeed} step ${n}: the reference policy's answer plays (${JSON.stringify(played)})`);
    assert.equal(canonicalJson(match.state), stateBefore, "choosing never touches the match");
    rngs[actor] = chosen.rng;
    if (!played.ok) break;
    // The engine moves the decision played, as the engine logged them.
    for (const e of played.events) if (e.type === "action") actions.push(e.action);
    match = played.match;
    checkPosition(`644/${policySeed}`, match, n);
  }
  // The game's RNG was never drawn on by the policy: its moves alone replay the same game.
  const replayed = await replayWith(RULES_ENGINE, { bundle: bundle644, seed: POLICY_FIXTURE_SEED, actions, interpreterRevision: POLICY_FIXTURE_REVISION });
  assert.equal(canonicalJson(replayed.state), canonicalJson(match.state), `644/${policySeed}: the policy-played game replays from its moves alone`);
  policyGames.push({ seed: policySeed, moves: actions.length, turn: match.state.turn, phase: match.state.phase });
}

// 3. The policy RNG is its own stream: a pure function of (seed, n), unaffected by any game.
{
  const a = policyRng(42);
  const first = nextRandom(a);
  assert.deepEqual(nextRandom(a), first, "drawing is pure");
  assert.deepEqual(a, { v: 1, seed: 42, n: 0 }, "drawing does not mutate the state");
  assert.equal(first.rng.n, 1);
  const values = new Set<number>();
  let r = policyRng(7);
  for (let i = 0; i < 1000; i++) { const d = nextRandom(r); assert.ok(d.value >= 0 && d.value < 1); values.add(d.value); r = d.rng; }
  assert.ok(values.size > 990, "the stream does not repeat early");
}

// Coverage: the decision windows the positions above reached on the seat being asked.
for (const w of ["chooseFirst", "mulligan", "charge", "main", "combo", "payCost", "zEnergyFromCombo", "chooseCards", "chooseCards (compound pick)", "chooseMode"]) {
  assert.ok(windows.has(w), `the fixtures reach a ${w} decision (reached: ${[...windows].sort().join(", ")})`);
}
assert.ok(tally.pickRoundTrips > 0 && tally.multiCardPicks > 0, "compound picks of more than one card were played");
assert.ok(tally.stale > 0 && tally.foreign > 0 && tally.malformed > 0, "every refusal was exercised");
assert.ok(tally.negativeControls === 2, "the negative control ran for both seats");
assert.ok(tally.permutationsNontrivial > tally.permutations / 2, `most permuted states really differ (${tally.permutationsNontrivial} of ${tally.permutations})`);

console.log(`arena-policy-contract: policy layer ${LAYER.length} modules, no engine/provider/database/game-RNG reach; ${tally.positions} positions × 2 seats`);
console.log(`  ${tally.permutations} permuted hidden states (${tally.permutationsNontrivial} differing from the real one) with identical inputs and answers; negative control caught; ${tally.menuRoundTrips} menu and ${tally.pickRoundTrips} compound round trips (${tally.pickRefusedByEngine} picks the engine refused, refused as such)`);
console.log(`  refusals: ${tally.stale} stale, ${tally.foreign} foreign, ${tally.malformed} malformed; windows: ${[...windows].sort().join(", ")}`);
console.log(`  policy-played games: ${policyGames.map((g) => `seed ${g.seed} ${g.moves} moves to turn ${g.turn} (${g.phase})`).join("; ")}; ${((Date.now() - started) / 1000).toFixed(1)} s`);
