/**
 * The paired-deal SPRT's statistics (`scripts/lib/sprt.ts`), checked against hand-computed values,
 * its own exact GSPRT, symmetry, degenerate samples and a seeded Monte Carlo of its error rates.
 * Pure arithmetic: no engine, database or network; about two seconds.
 *
 *   npx tsx scripts/verify/arena-sprt-stats.mts
 */
import assert from "node:assert/strict";
import {
  DEFAULT_SPRT, Z95, addPair, eloEstimate, eloOfScore, informativePairs, llr, llrExact, normalCdf, pairCell, pentanomialStats,
  runSprt, scoreOfElo, sprtBounds, sprtExpectation, sprtState, validateConfig, type Pentanomial, type SprtConfig,
} from "../lib/sprt.ts";

const close = (actual: number, expected: number, tolerance: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);
const finite = (x: number, what: string) => assert.ok(Number.isFinite(x), `${what} is not finite (${x})`);
const reversed = (c: Pentanomial): Pentanomial => [c[4], c[3], c[2], c[1], c[0]];
const cfg: SprtConfig = DEFAULT_SPRT;

// ---- Logistic Elo, bounds.
close(scoreOfElo(0), 0.5, 1e-15, "Elo 0 is a 50 % score");
close(scoreOfElo(30), 0.5430664920222119, 1e-15, "Elo 30 is 1/(1+10^(-30/400)) ≈ 54.31 %");
close(scoreOfElo(-30), 1 - scoreOfElo(30), 1e-15, "logistic Elo is symmetric");
for (const elo of [-400, -30, -1, 0, 7.5, 30, 250]) close(eloOfScore(scoreOfElo(elo)), elo, 1e-9, `Elo ${elo} round trip`);
assert.equal(eloOfScore(0), -Infinity);
assert.equal(eloOfScore(1), Infinity);
// α = β = 0.05: ±ln(19) = ±2.944, the "(-2.94,2.94)" every fishtest SPRT page prints.
const b = sprtBounds(cfg);
close(b.upper, Math.log(19), 1e-15, "upper bound ln((1-β)/α)");
close(b.lower, -Math.log(19), 1e-15, "lower bound ln(β/(1-α))");
close(b.upper, 2.9444389791664403, 1e-12, "upper bound value");
const b10 = sprtBounds({ alpha: 0.05, beta: 0.1 });
close(b10.lower, Math.log(0.1 / 0.95), 1e-15, "asymmetric lower bound");
close(b10.upper, Math.log(18), 1e-15, "asymmetric upper bound");
assert.throws(() => validateConfig({ ...cfg, elo1: 0 }), /elo0 < elo1/);
assert.throws(() => validateConfig({ ...cfg, alpha: 0.5 }), /alpha/);
assert.throws(() => validateConfig({ ...cfg, minPairs: 0 }), /minPairs/);

// ---- Pair cells.
assert.deepEqual([0, 0.5, 1, 1.5, 2].map(pairCell), [0, 1, 2, 3, 4]);
assert.throws(() => pairCell(0.25), /pair points/);
assert.throws(() => pairCell(2.5), /pair points/);
assert.deepEqual(addPair([0, 0, 0, 0, 0], 1.5), [0, 0, 0, 1, 0]);
assert.equal(informativePairs([3, 1, 9, 1, 2]), 7, "informative pairs are every pair but the 1-1 splits");

// ---- Hand-computed LLRs (no empty cell, so no regularisation).
// [1,2,4,2,1]: mean 0.5, per-pair variance (2·0.25 + 4·0.0625)/10 = 0.075, n = 10:
// LLR = 10 · (s1 − 0.5) · (1 − 0.5 − s1) / (2 · 0.075) = −10 (s1 − 0.5)² / 0.15.
const s1 = scoreOfElo(30);
const sym: Pentanomial = [1, 2, 4, 2, 1];
const symStats = pentanomialStats(sym)!;
close(symStats.mean, 0.5, 1e-15, "symmetric mean");
close(symStats.variance, 0.075, 1e-15, "symmetric variance");
close(llr(sym, cfg), (-10 * (s1 - 0.5) ** 2) / 0.15, 1e-12, "symmetric LLR by hand");
close(llr(sym, cfg), -0.12364818233994948, 1e-12, "symmetric LLR value");
// [1,1,4,2,2]: mean (0.25 + 4·0.5 + 2·0.75 + 2·1)/10 = 0.575;
// variance (0.575² + 0.325² + 4·0.075² + 2·0.175² + 2·0.425²)/10 = 0.88125/10 = 0.088125.
const asym: Pentanomial = [1, 1, 4, 2, 2];
close(pentanomialStats(asym)!.mean, 0.575, 1e-15, "asymmetric mean");
close(pentanomialStats(asym)!.variance, 0.088125, 1e-15, "asymmetric variance");
close(llr(asym, cfg), (10 * (s1 - 0.5) * (2 * 0.575 - 0.5 - s1)) / (2 * 0.088125), 1e-12, "asymmetric LLR by hand");
close(llr(asym, cfg), 0.26129084075078246, 1e-12, "asymmetric LLR value");

// ---- The approximation against the exact (constrained-MLE) GSPRT: same sign, within 15 %, closer near zero.
for (const c of [sym, asym, [10, 20, 140, 25, 15], [11, 0, 120, 0, 29], [12, 0, 134, 0, 14], [2, 0, 35, 0, 3], [100, 200, 1400, 250, 150]] as Pentanomial[]) {
  const a = llr(c, cfg), e = llrExact(c, cfg);
  assert.equal(Math.sign(a), Math.sign(e), `approximate and exact LLR agree in sign on ${c}`);
  assert.ok(Math.abs(a - e) <= 0.15 * Math.max(1, Math.abs(e)), `approximate LLR ${a} within 15 % of exact ${e} on ${c}`);
}
close(llr(sym, cfg), llrExact(sym, cfg), 0.002, "near LLR 0 the approximation is almost exact");
// LLR scales with n for a fixed distribution (both forms).
close(llr([100, 200, 1400, 250, 150], cfg), 10 * llr([10, 20, 140, 25, 15], cfg), 1e-9, "LLR is linear in n");
close(llrExact([100, 200, 1400, 250, 150], cfg), 10 * llrExact([10, 20, 140, 25, 15], cfg), 1e-7, "exact LLR is linear in n");

// ---- Symmetry: mirrored counts under mirrored hypotheses flip the LLR; mirrored counts flip the Elo.
for (const c of [asym, [10, 20, 140, 25, 15], [11, 0, 120, 0, 29], [0, 0, 7, 0, 1]] as Pentanomial[]) {
  const mirror = { elo0: -15, elo1: 15 };
  close(llr(reversed(c), mirror), -llr(c, mirror), 1e-9, `LLR antisymmetry on ${c}`);
  close(llrExact(reversed(c), mirror), -llrExact(c, mirror), 1e-7, `exact LLR antisymmetry on ${c}`);
  const e = eloEstimate(c)!, r = eloEstimate(reversed(c))!;
  close(r.elo, -e.elo, 1e-9, `Elo antisymmetry on ${c}`);
  close(r.eloCi95[0], -e.eloCi95[1], 1e-9, `Elo interval antisymmetry on ${c}`);
  close(r.los, 1 - e.los, 1e-7, `LOS antisymmetry on ${c}`);
}

// ---- Elo estimate: the interval is the score interval mapped through logistic Elo.
const h826: Pentanomial = [29, 0, 120, 0, 11]; // #826's +30M holdout: 29 lost-both, 120 split, 11 won-both
const e826 = eloEstimate(h826)!;
close(e826.score, 0.44375, 1e-4, "#826 holdout mean score (1e-3 pseudo-counts in the two empty cells)");
close(e826.elo, eloOfScore(e826.score), 1e-12, "Elo of the mean score");
close(e826.scoreCi95[1] - e826.score, Z95 * Math.sqrt(e826.variance / (160 + 0.002)), 1e-12, "score interval half-width");
close(e826.elo, -39.25216833243622, 1e-6, "#826 holdout Elo");
assert.ok(e826.eloCi95[1] < 0, "#826's whole Elo interval is below zero, as its paired Wilson interval was below 50 %");
assert.equal(sprtState(h826, cfg).decision, "H0", "#826's 160 pairs, read as one SPRT look, accept H0");
close(normalCdf(0), 0.5, 1e-7, "Φ(0)");
close(normalCdf(1.959963984540054), 0.975, 2e-7, "Φ(1.96)");
close(normalCdf(-1), 0.15865525393145707, 2e-7, "Φ(-1)");

// ---- Degenerate samples: no NaN anywhere.
assert.equal(llr([0, 0, 0, 0, 0], cfg), 0, "no data, LLR 0");
assert.equal(llrExact([0, 0, 0, 0, 0], cfg), 0, "no data, exact LLR 0");
assert.equal(eloEstimate([0, 0, 0, 0, 0]), null, "no data, no Elo");
assert.equal(sprtState([0, 0, 0, 0, 0], cfg).decision, null, "no data, no decision");
for (const c of [[0, 0, 40, 0, 0], [0, 0, 0, 0, 40], [40, 0, 0, 0, 0], [0, 40, 0, 0, 0], [0, 0, 1, 0, 0]] as Pentanomial[]) {
  finite(llr(c, cfg), `LLR of ${c}`);
  finite(llrExact(c, cfg), `exact LLR of ${c}`);
  const e = eloEstimate(c)!;
  for (const [k, v] of Object.entries({ score: e.score, elo: e.elo, lo: e.eloCi95[0], hi: e.eloCi95[1], los: e.los, variance: e.variance })) finite(v, `${k} of ${c}`);
  assert.ok(e.variance > 0, `regularised variance of ${c} is positive`);
}
// All splits (= all draws, for pairs): the mean is exactly 1/2, so the LLR votes H0, the Elo is 0.
close(pentanomialStats([0, 0, 40, 0, 0])!.mean, 0.5, 1e-15, "all-split mean");
assert.ok(llr([0, 0, 40, 0, 0], cfg) < sprtBounds(cfg).lower, "all-split LLR is below the lower bound...");
assert.equal(sprtState([0, 0, 40, 0, 0], cfg).decision, null, "...but with no informative pair the test does not decide");
close(eloEstimate([0, 0, 40, 0, 0])!.elo, 0, 1e-9, "all-split Elo is 0");
assert.ok(llr([0, 0, 0, 0, 40], cfg) > sprtBounds(cfg).upper, "all won-both votes H1");

// ---- The stopping rule.
assert.equal(sprtState([0, 0, 0, 0, 19], cfg).decision, null, "19 won-both pairs: below minPairs, no decision");
assert.equal(sprtState([0, 0, 0, 0, 20], cfg).decision, "H1", "20 won-both pairs accept H1");
assert.equal(sprtState([20, 0, 0, 0, 0], cfg).decision, "H0", "20 lost-both pairs accept H0");
assert.equal(sprtState([0, 0, 15, 0, 9], cfg).decision, null, "9 informative pairs: no decision");
assert.equal(sprtState([0, 0, 15, 0, 10], cfg).decision, "H1", "10 informative of 25 pairs: decides");
assert.equal(sprtState([0, 0, 15, 0, 10], { ...cfg, minInformativePairs: 11 }).decision, null, "minInformativePairs is configurable");
const stop = runSprt([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0], cfg);
assert.equal(stop.decision, "H1");
assert.equal(stop.pairs, 20, "runSprt stops at the first decision, ignoring later pairs");
assert.deepEqual(stop.counts, [0, 0, 0, 0, 20]);
const capped = runSprt([1, 1, 1], cfg);
assert.equal(capped.decision, null);
assert.equal(capped.pairs, 3, "a sample that runs out leaves the test undecided");

// ---- Wald's operating characteristic and average sample size (Brownian approximation).
const v = 0.0593;
close(sprtExpectation({ elo: 30, variance: v, ...cfg }).pAcceptH1, 1 - cfg.beta, 1e-12, "P(H1) at elo1 is 1 − β");
close(sprtExpectation({ elo: 0, variance: v, ...cfg }).pAcceptH1, cfg.alpha, 1e-12, "P(H1) at elo0 is α");
const mid = eloOfScore((scoreOfElo(0) + scoreOfElo(30)) / 2);
const atMid = sprtExpectation({ elo: mid, variance: v, ...cfg });
close(atMid.pAcceptH1, 0.5, 1e-6, "P(H1) halfway between the hypotheses' scores is 1/2 (symmetric bounds)");
close(atMid.expectedPairs, (b.upper ** 2 * v) / (s1 - 0.5) ** 2, 1e-3 * atMid.expectedPairs, "E[N] at zero drift is −A·B/σ²");
const at30 = sprtExpectation({ elo: 30, variance: v, ...cfg });
close(at30.expectedPairs, ((0.95 * b.upper + 0.05 * b.lower) * 2 * v) / (s1 - 0.5) ** 2, 1e-9, "E[N] at elo1 by hand");
close(sprtExpectation({ elo: 30, variance: 2 * v, ...cfg }).expectedPairs, 2 * at30.expectedPairs, 1e-9, "E[N] is proportional to the variance");
for (const elo of [-2000, -400, 400, 2000]) {
  const x = sprtExpectation({ elo, variance: v, ...cfg });
  finite(x.pAcceptH1, `P(H1) at Elo ${elo}`);
  finite(x.expectedPairs, `E[N] at Elo ${elo}`);
}
assert.throws(() => sprtExpectation({ elo: 0, variance: 0, ...cfg }), /variance/);

// ---- Seeded Monte Carlo: the error rates and sample sizes hold in this game's regime (most pairs split).
// A pair splits with probability `split`; the rest are won-both or lost-both, set to the true Elo's score.
let state = 0x5eed;
const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
function sampler(elo: number, split: number): () => number {
  const won = scoreOfElo(elo) - split / 2, lost = 1 - split - won;
  assert.ok(won > 0 && lost > 0, `a ${split} split rate admits Elo ${elo}`);
  return () => { const u = random(); return u < lost ? 0 : u < lost + split ? 1 : 2; };
}
const RUNS = 400;
for (const split of [0.5, 0.75, 0.84]) {
  for (const elo of [0, 30]) {
    const draw = sampler(elo, split);
    let h1 = 0, pairs = 0;
    for (let r = 0; r < RUNS; r++) {
      const result = runSprt({ *[Symbol.iterator]() { for (let i = 0; i < 100_000; i++) yield draw(); } }, cfg);
      assert.ok(result.decision, "every simulated run decides well before 100,000 pairs");
      if (result.decision === "H1") h1++;
      pairs += result.pairs;
    }
    // Wilson-free 3σ allowance on 400 runs: σ = √(0.05·0.95/400) ≈ 0.011.
    const wrong = elo === 0 ? h1 / RUNS : 1 - h1 / RUNS;
    assert.ok(wrong <= 0.05 + 3 * 0.011, `split ${split}, Elo ${elo}: error rate ${wrong} exceeds 5 % + 3σ`);
    const variance = pentanomialStats([1e6 * (1 - split - (scoreOfElo(elo) - split / 2)), 0, 1e6 * split, 0, 1e6 * (scoreOfElo(elo) - split / 2)])!.variance;
    const wald = sprtExpectation({ elo, variance, ...cfg }).expectedPairs;
    const mean = pairs / RUNS;
    assert.ok(mean > 0.75 * wald && mean < 1.35 * wald, `split ${split}, Elo ${elo}: mean ${mean.toFixed(0)} pairs is far from Wald's ${wald.toFixed(0)}`);
    console.log(`  simulated: split ${split}, true Elo ${elo}: wrong decision ${(100 * wrong).toFixed(1)} %, ${mean.toFixed(0)} pairs on average (Wald ${wald.toFixed(0)})`);
  }
}

console.log("arena-sprt-stats: ok");
