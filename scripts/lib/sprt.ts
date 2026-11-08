/**
 * Sequential probability ratio test on paired deals: pure statistics, no I/O.
 *
 * The arena's strength gate (`scripts/arena-sprt.mts`, `docs/arena-policy-sprt.md`) plays every deal
 * twice, the candidate once in each seat, so the unit of evidence is a PAIR, scored by the candidate's
 * points over its two games: 0, 0.5, 1, 1.5 or 2 (a win is 1, a draw 1/2). The five counts are the
 * pair's PENTANOMIAL. Seat and deal luck cancel inside a pair, and the pentanomial's empirical
 * variance carries the correlation of the two games, which a game-by-game (trinomial) count ignores.
 *
 * The test is fishtest's (Stockfish's): a generalised SPRT (GSPRT) between H0 "logistic Elo = elo0" and
 * H1 "logistic Elo = elo1", with Wald's bounds ln(β/(1−α)) and ln((1−β)/α), and the log-likelihood
 * ratio from the usual normal approximation with the empirical pentanomial variance:
 *
 *     LLR = n · (s1 − s0) · (2·s̄ − s0 − s1) / (2·σ̂²)
 *
 * where s̄ is the mean pair score per game (pair points / 2, in [0, 1]), σ̂² the per-pair variance of
 * that score, n the number of pairs and s_i = 1 / (1 + 10^(−elo_i/400)) (logistic Elo → expected
 * score). See M. Van den Bergh, "A simple approximation of the GSPRT" (fishtest's LLRcalc). The exact
 * constrained-MLE GSPRT is `llrExact`, kept as a cross-check of the approximation.
 *
 * Empty pentanomial cells get fishtest's 1e-3 pseudo-count (`regularize`), so an all-split or all-draw
 * sample has a small positive variance instead of a division by zero (and never a NaN).
 *
 * One addition to fishtest, for this game: the stopping rule is consulted only once `minPairs` pairs
 * AND `minInformativePairs` non-split pairs (any pair but 1 point of 2) are in. In the arena most
 * pairs split (the seat decides: 75 % in #826's holdout, 84 % in #899's), so an early sample is often
 * nearly all splits, its variance estimate near zero and its LLR a large spurious vote for H0. A
 * simulation of fishtest's rule alone at 84 % splits rejected a true +30 Elo 13 % of the time at
 * β = 5 %; with ≥ 20 pairs and ≥ 10 informative ones both error rates stay at or under 5 % from 50 %
 * to 90 % splits (`scripts/verify/arena-sprt-stats.mts` keeps that simulation). A run where the two
 * players never disagree (an A/A test of identical deterministic players) therefore never decides and
 * ends at its cap, with an LLR far below the lower bound: honest, since there is no variance to test.
 */

/** Counts of pairs scoring 0, 0.5, 1, 1.5 and 2 candidate points over the deal's two games. */
export type Pentanomial = [number, number, number, number, number];

export interface SprtConfig {
  /** H0: the candidate's logistic Elo advantage is elo0. */
  elo0: number;
  /** H1: the candidate's logistic Elo advantage is elo1 (> elo0). */
  elo1: number;
  /** Probability of accepting H1 when H0 holds. */
  alpha: number;
  /** Probability of accepting H0 when H1 holds. */
  beta: number;
  /** The stopping rule is consulted only once this many pairs are in (see the header)... */
  minPairs: number;
  /** ...and this many of them are informative (not a split: anything but 1 point of 2). */
  minInformativePairs: number;
}

/** elo0 = 0, elo1 = 30 (≈ 54.3 % expected score), α = β = 0.05; decisions from 20 pairs, 10 of them informative, on. */
export const DEFAULT_SPRT: SprtConfig = { elo0: 0, elo1: 30, alpha: 0.05, beta: 0.05, minPairs: 20, minInformativePairs: 10 };

/** fishtest's pseudo-count for an empty pentanomial cell. */
export const REGULARIZE_EPSILON = 1e-3;
/** Φ⁻¹(0.975). */
export const Z95 = 1.959963984540054;

export function validateConfig(c: SprtConfig): void {
  const finite = [c.elo0, c.elo1, c.alpha, c.beta].every(Number.isFinite);
  if (!finite || !(c.elo1 > c.elo0)) throw new Error(`SPRT needs finite elo0 < elo1 (got ${c.elo0}, ${c.elo1})`);
  if (!(c.alpha > 0 && c.alpha < 0.5) || !(c.beta > 0 && c.beta < 0.5)) throw new Error(`SPRT needs 0 < alpha, beta < 0.5 (got ${c.alpha}, ${c.beta})`);
  if (!Number.isInteger(c.minPairs) || c.minPairs < 1) throw new Error(`minPairs must be a positive integer (got ${c.minPairs})`);
  if (!Number.isInteger(c.minInformativePairs) || c.minInformativePairs < 0) throw new Error(`minInformativePairs must be a non-negative integer (got ${c.minInformativePairs})`);
}

/** Expected score of logistic Elo `elo`. */
export const scoreOfElo = (elo: number): number => 1 / (1 + 10 ** (-elo / 400));

/** Logistic Elo of expected score `s`; ±Infinity at 0 and 1. */
export function eloOfScore(s: number): number {
  if (s <= 0) return -Infinity;
  if (s >= 1) return Infinity;
  return -400 * Math.log10(1 / s - 1);
}

/** Wald's bounds: accept H0 at LLR ≤ lower, H1 at LLR ≥ upper. */
export function sprtBounds(c: Pick<SprtConfig, "alpha" | "beta">): { lower: number; upper: number } {
  return { lower: Math.log(c.beta / (1 - c.alpha)), upper: Math.log((1 - c.beta) / c.alpha) };
}

/** The pentanomial cell of a pair from the candidate's two game points (each 0, 0.5 or 1). */
export function pairCell(points: number): 0 | 1 | 2 | 3 | 4 {
  const cell = points * 2;
  if (!Number.isInteger(cell) || cell < 0 || cell > 4) throw new Error(`pair points must be 0, 0.5, 1, 1.5 or 2 (got ${points})`);
  return cell as 0 | 1 | 2 | 3 | 4;
}

export function addPair(counts: Pentanomial, points: number): Pentanomial {
  const next = [...counts] as Pentanomial;
  next[pairCell(points)]++;
  return next;
}

export const pairsIn = (counts: Pentanomial): number => counts.reduce((a, b) => a + b, 0);
/** Pairs that did not split 1–1: the ones that carry the variance. */
export const informativePairs = (counts: Pentanomial): number => pairsIn(counts) - counts[2];

function checkCounts(counts: Pentanomial): void {
  if (counts.length !== 5 || counts.some((x) => !Number.isFinite(x) || x < 0)) throw new Error(`a pentanomial is five non-negative counts (got ${JSON.stringify(counts)})`);
}

/**
 * The regularised empirical distribution of the per-game pair score (pair points / 2): five
 * (value, probability) cells and the regularised total `n`. Zero cells get `REGULARIZE_EPSILON`
 * (fishtest's `regularize`), but only when there is data at all.
 */
export function pentanomialPdf(counts: Pentanomial): { n: number; pdf: [number, number][] } {
  checkCounts(counts);
  if (pairsIn(counts) === 0) return { n: 0, pdf: [] };
  const regular = counts.map((x) => (x === 0 ? REGULARIZE_EPSILON : x));
  const n = regular.reduce((a, b) => a + b, 0);
  return { n, pdf: regular.map((x, i) => [i / 4, x / n] as [number, number]) };
}

export interface PentanomialStats {
  /** Real pairs (not the regularised total). */
  pairs: number;
  /** Regularised total, the n of the LLR. */
  n: number;
  /** Mean score per game, in [0, 1]. */
  mean: number;
  /** Variance of the per-game pair score (pair points / 2) across pairs. */
  variance: number;
}

export function pentanomialStats(counts: Pentanomial): PentanomialStats | null {
  const { n, pdf } = pentanomialPdf(counts);
  if (!n) return null;
  const mean = pdf.reduce((s, [v, p]) => s + v * p, 0);
  const variance = pdf.reduce((s, [v, p]) => s + p * (v - mean) ** 2, 0);
  return { pairs: pairsIn(counts), n, mean, variance };
}

/** The GSPRT log-likelihood ratio of H1 against H0 (the normal approximation in the header). 0 with no data. */
export function llr(counts: Pentanomial, c: Pick<SprtConfig, "elo0" | "elo1">): number {
  const st = pentanomialStats(counts);
  if (!st) return 0;
  const s0 = scoreOfElo(c.elo0), s1 = scoreOfElo(c.elo1);
  return (st.n * (s1 - s0) * (2 * st.mean - s0 - s1)) / (2 * st.variance);
}

/**
 * The maximum log-likelihood (per pair) of the regularised empirical distribution constrained to
 * mean `s`: q_i = p_i / (1 + θ(v_i − s)) with θ the root of Σ p_i (v_i − s) / (1 + θ(v_i − s)) = 0.
 */
function constrainedLogLikelihood(pdf: [number, number][], s: number): number {
  const d = pdf.map(([v]) => v - s);
  const hi = Math.max(...d), lo = Math.min(...d);
  if (!(hi > 0 && lo < 0)) throw new Error(`mean ${s} is outside the support`);
  // 1 + θ d_i > 0 for every cell: θ ∈ (−1/hi, −1/lo). g(θ) falls from +∞ to −∞ across it.
  let a = -1 / hi, b = -1 / lo;
  const g = (t: number) => pdf.reduce((sum, [, p], i) => sum + (p * d[i]) / (1 + t * d[i]), 0);
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2;
    if (g(m) > 0) a = m; else b = m;
  }
  const theta = (a + b) / 2;
  return pdf.reduce((sum, [, p], i) => sum + p * Math.log(p / (1 + theta * d[i])), 0);
}

/** The exact GSPRT log-likelihood ratio (constrained maximum likelihood); cross-check of `llr`. */
export function llrExact(counts: Pentanomial, c: Pick<SprtConfig, "elo0" | "elo1">): number {
  const { n, pdf } = pentanomialPdf(counts);
  if (!n) return 0;
  return n * (constrainedLogLikelihood(pdf, scoreOfElo(c.elo1)) - constrainedLogLikelihood(pdf, scoreOfElo(c.elo0)));
}

export type SprtVerdict = "H0" | "H1" | null;

export interface SprtState {
  pairs: number;
  informative: number;
  llr: number;
  lower: number;
  upper: number;
  /** H0 or H1 once accepted (never before `minPairs` pairs and `minInformativePairs` informative ones), else null. */
  decision: SprtVerdict;
}

export function sprtState(counts: Pentanomial, c: SprtConfig): SprtState {
  validateConfig(c);
  const { lower, upper } = sprtBounds(c);
  const value = llr(counts, c);
  const pairs = pairsIn(counts), informative = informativePairs(counts);
  const ready = pairs >= c.minPairs && informative >= c.minInformativePairs;
  const decision: SprtVerdict = !ready ? null : value >= upper ? "H1" : value <= lower ? "H0" : null;
  return { pairs, informative, llr: value, lower, upper, decision };
}

/**
 * Feed pair points in order and stop at the first decision: the SPRT over the deal-ordered prefix.
 * Returns the state at the stop (or after the last pair) and how many pairs it used.
 */
export function runSprt(pairPoints: Iterable<number>, c: SprtConfig): SprtState & { counts: Pentanomial } {
  let counts: Pentanomial = [0, 0, 0, 0, 0];
  let state = sprtState(counts, c);
  for (const points of pairPoints) {
    counts = addPair(counts, points);
    state = sprtState(counts, c);
    if (state.decision) break;
  }
  return { ...state, counts };
}

/** Standard normal CDF, through `erfc` below (relative error under 1.2e-7: plenty for a reported LOS). */
export function normalCdf(x: number): number {
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  return 0.5 * erfc(-x / Math.SQRT2);
}

/** Complementary error function, |relative error| < 1.2e-7 everywhere (Numerical Recipes `erfcc`, Chebyshev). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

export interface EloEstimate {
  pairs: number;
  /** Mean score per game and its 95 % interval. */
  score: number;
  scoreCi95: [number, number];
  /** Logistic Elo and its 95 % interval (from the score interval). */
  elo: number;
  eloCi95: [number, number];
  /** Likelihood of superiority: P(true score > 0.5) under the normal approximation. */
  los: number;
  /** Per-pair variance of the per-game score. */
  variance: number;
}

/** Logistic Elo with a 95 % interval from the pentanomial (fishtest's `get_elo` for pairs). null without data. */
export function eloEstimate(counts: Pentanomial): EloEstimate | null {
  const st = pentanomialStats(counts);
  if (!st) return null;
  const se = Math.sqrt(st.variance / st.n);
  const clamp = (s: number) => Math.min(1 - 1e-9, Math.max(1e-9, s));
  const lo = clamp(st.mean - Z95 * se), hi = clamp(st.mean + Z95 * se);
  return {
    pairs: st.pairs,
    score: st.mean,
    scoreCi95: [lo, hi],
    elo: eloOfScore(clamp(st.mean)),
    eloCi95: [eloOfScore(lo), eloOfScore(hi)],
    los: normalCdf((st.mean - 0.5) / se),
    variance: st.variance,
  };
}

export interface SprtExpectation {
  /** True logistic Elo assumed. */
  elo: number;
  /** Per-pair variance of the per-game score assumed. */
  variance: number;
  /** Mean and variance of one pair's LLR increment. */
  drift: number;
  llrVariance: number;
  /** Probability the test accepts H1 (Wald, Brownian approximation; no truncation, no overshoot). */
  pAcceptH1: number;
  /** Expected pairs (and games = 2 × pairs) to a decision, ignoring the minimum-sample rule and any cap. */
  expectedPairs: number;
  expectedGames: number;
}

/**
 * Operating characteristic and average sample size of the test for a true Elo and per-pair variance,
 * in the Brownian approximation of the LLR walk (Wald): drift μ = (s1−s0)(2s−s0−s1)/(2v) and variance
 * σ² = (s1−s0)²/v per pair, absorbed at the bounds A < 0 < B. With γ = 2μ/σ² = (2s−s0−s1)/(s1−s0),
 * P(H1) = (1 − e^{−γA}) / (e^{−γB} − e^{−γA}) and E[N] = (P·B + (1−P)·A)/μ (E[N] = −A·B/σ² at μ = 0).
 * The approximation ignores overshoot, so real runs stop a little later and err a little less often.
 */
export function sprtExpectation(args: { elo: number; variance: number } & Pick<SprtConfig, "elo0" | "elo1" | "alpha" | "beta">): SprtExpectation {
  const { elo, variance } = args;
  if (!(variance > 0)) throw new Error(`the per-pair variance must be positive (got ${variance})`);
  const s = scoreOfElo(elo), s0 = scoreOfElo(args.elo0), s1 = scoreOfElo(args.elo1);
  const { lower: A, upper: B } = sprtBounds(args);
  const drift = ((s1 - s0) * (2 * s - s0 - s1)) / (2 * variance);
  const llrVariance = (s1 - s0) ** 2 / variance;
  const gamma = (2 * s - s0 - s1) / (s1 - s0);
  let pAcceptH1: number;
  if (Math.abs(gamma) < 1e-9) pAcceptH1 = -A / (B - A);
  // Rewritten per sign so that no exponential overflows.
  else if (gamma > 0) pAcceptH1 = (1 - Math.exp(gamma * A)) / (1 - Math.exp(gamma * (A - B)));
  else pAcceptH1 = (Math.exp(gamma * B) - Math.exp(gamma * (B - A))) / (1 - Math.exp(gamma * (B - A)));
  const expectedPairs = Math.abs(gamma) < 1e-9 ? (-A * B) / llrVariance : (pAcceptH1 * B + (1 - pAcceptH1) * A) / drift;
  return { elo, variance, drift, llrVariance, pAcceptH1, expectedPairs, expectedGames: 2 * expectedPairs };
}
