/**
 * The SPRT gate's machinery below the statistics (`scripts/arena-sprt.mts`): the seed-block registry
 * refuses consumed and overlapping ranges, the player registry, and real paired deals on the audited
 * SD15/SD5 decks: both games finish with no integrity failure, a deal replays identically, an A/A
 * deal is exactly the same game twice (so a harness asymmetry would show as a non-split pair), and a
 * player that peeks at hidden cards is caught by the hidden-twin check. No database or network;
 * about 15 seconds.
 *
 *   npx tsx scripts/verify/arena-sprt-runner.mts
 */
import assert from "node:assert/strict";
import type { PlayerId } from "../../src/lib/arena/types";
import { answerFor, uniformPolicy, type Policy } from "../../src/lib/arena/policy/contract";
import { assertSeedRegistry, dealSeeds, sprtSeedBlock, SPRT_SEED_BLOCKS, type SprtSeedBlock } from "../lib/arena-seed-blocks";
import { LADDER, playerFactory, playerNames, registerPlayer } from "../lib/arena-sprt-players";
import { answeringStep, type SeatPlayer } from "../lib/arena-seat-duel";
import { playDeal, type DealSpec } from "../lib/arena-sprt-deal";
import { loadSprtFixtures } from "../lib/arena-sprt-worker.mts";

// ---- Seed blocks.
assertSeedRegistry();
const dev = sprtSeedBlock("sprt-dev");
assert.equal(dev.status, "dev");
assert.deepEqual(dealSeeds(dev, 7), { engineSeed: 60_000_007, policySeed: 560_000_007 });
assert.throws(() => dealSeeds(dev, dev.size), /outside seed block/);
assert.ok(SPRT_SEED_BLOCKS.some((b) => b.status === "open"), "a fresh gate block is available");
// A hypothetical block in a range nothing uses (70,000,000 / 570,000,000 are reserved for the Claude campaign).
const block = (over: Partial<SprtSeedBlock>): SprtSeedBlock => ({ name: "x", base: 80_000_000, size: 1_000_000, policyBase: 580_000_000, status: "open", note: "", ...over });
assert.throws(() => assertSeedRegistry([block({ base: 30_500_000 })]), /overlap consumed 826-holdout/, "the #826 +30M range is refused");
assert.throws(() => assertSeedRegistry([block({ base: 10_000_000 })]), /overlap consumed 651-holdout/, "the #663 +10M range is refused");
assert.throws(() => assertSeedRegistry([block({ base: 40_899_500, size: 10 })]), /overlap consumed 899-holdout/, "the #899 40,899,000 range is refused");
assert.throws(() => assertSeedRegistry([block({ base: 650_000, size: 10 })]), /overlap consumed legacy-small/, "the #651 dev seeds are refused");
assert.throws(() => assertSeedRegistry([block({ policyBase: 89_940_100 })]), /overlap consumed 899-policy/, "#899's policy seeds are refused");
assert.throws(() => assertSeedRegistry([block({}), block({ name: "y", base: 80_500_000, policyBase: 590_000_000 })]), /x engine seeds overlap y engine seeds/, "two blocks may not share seeds");
assert.throws(() => assertSeedRegistry([block({}), block({ name: "y", base: 580_000_000, policyBase: 590_000_000 })]), /overlap/, "an engine range may not reuse another block's policy seeds");
assert.throws(() => assertSeedRegistry([block({ status: "consumed" })]), /does not name the evidence/);
assert.throws(() => sprtSeedBlock("x", [block({ status: "consumed", consumedBy: "docs/x.json" })]), /consumed/, "a consumed block is refused");
assert.throws(() => sprtSeedBlock("nope"), /unknown seed block/);

// ---- Players.
for (const name of [...LADDER, "heuristic"]) assert.ok(playerNames().includes(name), `${name} is registered`);
assert.throws(() => registerPlayer("heuristic", () => playerFactory("uniform")()), /already registered/);
assert.throws(() => registerPlayer("Bad Name", () => playerFactory("uniform")()), /lower-case/);
assert.throws(() => playerFactory("nobody"), /unknown player/);

// A player that reads what its seat cannot see: the opponent's hand and its own next draw.
const peeking: SeatPlayer = (match, seat, revision, memory) => {
  const other: PlayerId = seat === "p1" ? "p2" : "p1";
  const zones = (p: PlayerId) => match.state.sides[p].zones as Record<string, string[] | undefined>;
  const secret = [...(zones(other).hand ?? []), ...(zones(seat).deck ?? []).slice(0, 1)].map((id) => match.state.cards[id].cardId).join("|");
  let h = 0;
  for (const ch of secret) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  const policy: Policy = (input, rng) => {
    const menu = input.decisions.decisions.filter((d) => d.kind === "menu");
    return menu.length ? { answer: answerFor(input.decisions, menu[h % menu.length].id), rng } : uniformPolicy(input, rng);
  };
  return answeringStep(policy)(match, seat, revision, memory);
};
registerPlayer("test-peeking", () => peeking, "verify only: reads hidden cards");

// ---- Real deals.
const fixtures = await loadSprtFixtures(["AvA", "AvB"]);
const spec = (deal: number, fixture: string, candidate: string, baseline: string): DealSpec => ({ deal, fixture, ...dealSeeds(dev, deal), candidate, baseline });
/** A deal's outcome without its wall times. */
const strip = (o: Awaited<ReturnType<typeof playDeal>>) => JSON.stringify(o, (key, value) => (key === "ms" ? undefined : value));

const real = await playDeal(spec(1, "AvB", "heuristic", "uniform"), fixtures.get("AvB")!, { maxMoves: 3000, privacyEvery: 10 });
for (const g of real.games) {
  assert.deepEqual(g.integrity, [], `heuristic vs uniform, candidate ${g.candidateSeat}: no integrity failure`);
  assert.ok(g.winner === "candidate" || g.winner === "baseline", "the game finished with a winner");
  assert.ok(g.privacy.checks > 0 && g.privacy.nontrivial > 0, "the hidden-twin check ran on twins that really differ");
}
assert.equal(real.points, real.games[0].points + real.games[1].points);
assert.deepEqual(real.games.map((g) => g.candidateSeat), ["p1", "p2"], "the candidate plays p1, then p2");

// An A/A deal is one game played twice: same physical seats, same engine seed, same per-seat RNG.
const aa = await playDeal(spec(2, "AvA", "uniform", "uniform"), fixtures.get("AvA")!, { maxMoves: 3000, privacyEvery: 10 });
assert.equal(aa.games[0].trace, aa.games[1].trace, "an A/A deal is the same game from both seats");
assert.equal(aa.points, 1, "so it splits");
assert.equal(strip(await playDeal(spec(2, "AvA", "uniform", "uniform"), fixtures.get("AvA")!, { maxMoves: 3000, privacyEvery: 10 })), strip(aa), "a deal replays identically");

// The cheat is caught; a move cap is an integrity failure, not a result.
const cheat = await playDeal(spec(3, "AvA", "test-peeking", "uniform"), fixtures.get("AvA")!, { maxMoves: 40, privacyEvery: 1 });
assert.ok(cheat.games.some((g) => g.privacy.failures > 0 && g.integrity.some((x) => x.startsWith("hidden-twin privacy"))), "a player that reads hidden cards fails the twin check");
assert.ok(cheat.games.every((g) => g.integrity.some((x) => x.startsWith("limit"))), "a game stopped by the move cap is an integrity failure");
assert.ok(cheat.games.every((g) => g.points === 0), "an unfinished game scores nothing for the candidate");

console.log(`arena-sprt-runner: ok (deal 1 ${real.points}/2 for heuristic vs uniform, ${real.games.reduce((n, g) => n + g.privacy.checks, 0)} twin checks; the peeking player failed ${cheat.games.reduce((n, g) => n + g.privacy.failures, 0)} of ${cheat.games.reduce((n, g) => n + g.privacy.checks, 0)})`);
