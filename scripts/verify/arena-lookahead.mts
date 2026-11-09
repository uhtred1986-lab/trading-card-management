/**
 * The lookahead opponent's proofs (`src/lib/arena/lookahead/`, owner's request of 8 Nov 2026:
 * "Normal" and "Hard", with and without the human's decklist). No database, no network.
 *
 *  1. The lean policy board (`previews: false`) gives the very observation the full board gives.
 *  2. A world (`determinize`) keeps everything the seat can see, every zone's size, and — with a
 *     known decklist — exactly the unseen cards as a multiset.
 *  3. Hidden-state twins (`permutedFor`: the cards the seat cannot see swapped, reordered and their
 *     ids permuted) give the identical world, for both difficulties; Normal's world is also the same
 *     when the other seat's unseen cards are different cards altogether (it never reads that
 *     decklist), and Hard's is not (it does).
 *  4. The search answers twins identically, answers the same twice (deterministic), returns the
 *     exact heuristic answer and RNG when the host stops it or the budget is spent, and every answer
 *     is a decision of the real menu that the engine plays.
 *
 *   npx tsx scripts/verify/arena-lookahead.mts
 */
import assert from "node:assert/strict";
import type { PlayerId } from "../../src/lib/arena/types";
import { projectSnapshot, type PinnedMatch } from "../../src/lib/arena/browser";
import { aliasTable, ownDeck, policyTurn, secretAreas, localStep } from "../../src/lib/arena/policy/boundary";
import { aliasIds, buildObservation } from "../../src/lib/arena/policy/observation";
import { stableJson } from "../../src/lib/arena/policy/contract";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { localMemory, guardedDecide } from "../../src/lib/arena/policy/main";
import { policyRng } from "../../src/lib/arena/policy/rng";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { determinize, type Knowledge } from "../../src/lib/arena/lookahead/determinize";
import { lookaheadStep, searchDecision, DIFFICULTIES, type LookaheadOptions } from "../../src/lib/arena/lookahead/step";
import { loadAuditFixtures } from "./arena-policy-fixtures.mts";
import { playDuel } from "./arena-policy-duel.ts";
import { permutedFor } from "./arena-policy-permute.ts";

const t0 = performance.now();
const fixtures = await loadAuditFixtures();
const base = localPolicy();
const dbs = rulesetFor("dbs");
if (!dbs.ok) throw new Error("the dbs ruleset does not load");
const tally = { observations: 0, worlds: 0, twins: 0, normalBlind: 0, hardSees: 0, searched: 0, searchTwins: 0, fallbacks: 0, gameSteps: 0 };

// Positions from two heuristic games (every 3rd decision), with the seat asked.
const positions: { match: PinnedMatch; seat: PlayerId; revision: number }[] = [];
for (const [i, f] of fixtures.slice(0, 2).entries()) {
  await playDuel({
    bundle: f.bundle, interpreterRevision: f.revision, gameSeed: 7100 + i, policySeed: 31 + i, testSeat: "p1", test: base, baseline: base, maxMoves: 3000,
    observe: (match, seat, revision) => { if (revision % 3 === 0) positions.push({ match, seat, revision }); },
  });
}
assert.ok(positions.length > 60, `enough positions (${positions.length})`);

// 1. The lean board's observation is the full board's.
for (const { match, seat, revision } of positions) {
  for (const viewer of ["p1", "p2"] as const) {
    const full = buildObservation(projectSnapshot(match, viewer, { revision }), viewer, ownDeck(match, viewer), aliasTable(match, viewer), secretAreas(dbs.definition, viewer));
    assert.equal(stableJson(policyTurn(match, viewer, revision).input.observation), stableJson(full), `lean observation equals the full one (${seat} asked, viewer ${viewer}, revision ${revision})`);
    tally.observations++;
  }
}

// 2 and 3. Worlds.
const multiset = (m: PinnedMatch, p: PlayerId) => {
  const out = new Map<string, number>();
  for (const c of Object.values(m.state.cards)) if (c.owner === p && m.ctx.defs[c.cardId]?.type !== "TOKEN") out.set(c.cardId, (out.get(c.cardId) ?? 0) + 1);
  return stableJson([...out].sort(([a], [b]) => (a < b ? -1 : 1)));
};
const zoneSizes = (m: PinnedMatch) => stableJson((["p1", "p2"] as const).map((p) => Object.entries(m.state.sides[p].zones).map(([z, ids]) => [z, (ids as string[]).length])));
/** Every unseen card of the other seat replaced by one fixed card of the seat's own deck: a different decklist, the same view. */
function otherCardsFor(match: PinnedMatch, seat: PlayerId): PinnedMatch | null {
  const opp: PlayerId = seat === "p1" ? "p2" : "p1";
  const aliases = aliasTable(match, seat);
  const stand = Object.values(match.state.cards).find((c) => c.owner === seat && match.ctx.defs[c.cardId]?.type === "BATTLE")?.cardId;
  if (!stand) return null;
  const state = structuredClone(match.state);
  let changed = 0;
  for (const id of Object.keys(aliases)) {
    const c = state.cards[id];
    const zone = aliases[id].split(":")[1];
    if (c.owner === opp && ["deck", "hand", "life"].includes(zone) && c.cardId !== stand) { c.cardId = stand; changed++; }
  }
  return changed ? { ...match, state } : null;
}
const worldJson = (m: PinnedMatch) => stableJson({ state: m.state, beats: m.beats });
for (const [k, { match, seat }] of positions.entries()) {
  if (k % 2) continue;
  for (const knowledge of ["deck", "none"] as Knowledge[]) {
    const seed = 1000 + k;
    const world = determinize(match, seat, knowledge, seed).match;
    tally.worlds++;
    assert.equal(zoneSizes(world), zoneSizes(match), "every zone keeps its size");
    const aliases = aliasTable(match, seat);
    for (const [id, card] of Object.entries(match.state.cards)) {
      if (Object.prototype.hasOwnProperty.call(aliases, id)) continue;
      // A readable card may point at a hidden one (`enteredBy`); that id is renamed with the rest, so compare it masked.
      const masked = (v: unknown) => stableJson(aliasIds(v, aliases, "?"));
      assert.equal(masked(world.state.cards[id]), masked(card), `a card the seat can read is untouched (${id})`);
    }
    assert.equal(multiset(world, seat), multiset(match, seat), "the seat's own cards are its decklist");
    if (knowledge === "deck") assert.equal(multiset(world, seat === "p1" ? "p2" : "p1"), multiset(match, seat === "p1" ? "p2" : "p1"), "Hard: the other side's cards are its decklist");
    assert.notEqual(world.state.rngState, match.state.rngState, "the game's randomness is replaced");
    // Twins.
    for (const salt of [1, 2]) {
      const twin = permutedFor(match, seat, salt * 7 + k);
      assert.equal(worldJson(determinize(twin, seat, knowledge, seed).match), worldJson(world), `a hidden-state twin gives the same ${knowledge} world`);
      tally.twins++;
    }
    const other = otherCardsFor(match, seat);
    if (other) {
      const same = worldJson(determinize(other, seat, knowledge, seed).match) === worldJson(world);
      if (knowledge === "none") { assert.ok(same, "Normal never reads the other decklist"); tally.normalBlind++; }
      else { assert.ok(!same, "Hard does read the other decklist"); tally.hardSees++; }
    }
  }
}

// 4. The search.
const quick: LookaheadOptions = { ...DIFFICULTIES.hard, worlds: 2, horizon: "decision" };
const mainPositions = positions.filter(({ match, seat }) => match.state.prompt.kind === "main" && (match.state.prompt as { player?: PlayerId }).player === seat);
assert.ok(mainPositions.length >= 6, "some Main-Phase positions");
for (const [k, { match, seat, revision }] of mainPositions.slice(0, 6).entries()) {
  for (const diff of ["hard", "normal"] as const) {
    const opts = { ...quick, knowledge: DIFFICULTIES[diff].knowledge };
    const memory = localMemory(policyRng(500 + k));
    const a = lookaheadStep(match, seat, revision, memory, opts, base);
    const b = lookaheadStep(match, seat, revision, JSON.parse(JSON.stringify(memory)), opts, base);
    assert.ok(a.ok && b.ok, `the lookahead plays a move (${a.ok ? "" : a.detail})`);
    if (!a.ok || !b.ok) continue;
    assert.equal(a.id, b.id, "deterministic answer");
    assert.equal(stableJson(a.memory), stableJson(b.memory), "deterministic memory");
    if (a.search?.status === "searched") tally.searched++;
    const twin = permutedFor(match, seat, 99 + k);
    const c = lookaheadStep(twin, seat, revision, memory, opts, base);
    assert.ok(c.ok && c.id === a.id, `a hidden-state twin gets the same answer (${diff})`);
    tally.searchTwins++;
    // Stops: the exact heuristic answer and RNG.
    const turn = policyTurn(match, seat, revision);
    const heuristic = base(turn.input, memory.rng);
    for (const stopped of [{ ...opts, stop: () => true }, { ...opts, maxSteps: 2 }]) {
      const s = searchDecision(match, seat, revision, turn.input, heuristic.answer, heuristic.rng, stopped, base);
      if (s.report.status === "skipped") continue;
      assert.equal(s.answer, null, `a stopped search plays the heuristic (${s.report.reason})`);
      assert.equal(s.report.status, "fallback");
      tally.fallbacks++;
    }
    const guarded = guardedDecide(base, turn.input, memory);
    if (a.search?.status !== "searched" || a.search.chosen === a.search.heuristic) assert.ok(guarded.ok && guarded.answer.id === a.id, "no search, or no better option: the heuristic's answer");
  }
}
assert.ok(tally.searched > 0, "the search ran somewhere");
assert.ok(tally.fallbacks > 0, "the stop paths ran");

// One whole game, Hard (decision horizon) against the heuristic: legal to the end.
{
  const f = fixtures[1];
  const { createPinnedMatch } = await import("../../src/lib/arena/browser");
  let { match } = await createPinnedMatch({ bundle: f.bundle, seed: 7300, interpreterRevision: f.revision });
  const mem: Record<PlayerId, ReturnType<typeof localMemory>> = { p1: localMemory(policyRng(1)), p2: localMemory(policyRng(2)) };
  let n = 0;
  for (; n < 3000 && match.state.phase !== "over"; n++) {
    const seat = (match.state.prompt as { player?: PlayerId }).player!;
    const step = seat === "p2" ? lookaheadStep(match, seat, n, mem[seat], quick, base) : localStep(match, seat, n, mem[seat], base);
    assert.ok(step.ok, `every decision is played (${step.ok ? "" : step.reason + ": " + step.detail})`);
    if (!step.ok) break;
    mem[seat] = step.memory;
    match = step.match;
  }
  assert.equal(match.state.phase, "over", "the game ends");
  tally.gameSteps = n;
}

console.log(`arena-lookahead: ok — ${JSON.stringify(tally)} in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
