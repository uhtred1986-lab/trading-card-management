/**
 * The policy's own randomness (#644, plan O2-01).
 *
 * A policy never touches the game's RNG (`VmState.rngState`, `vm/rng.ts`): a
 * shuffle or a coin flip is the engine's, and a policy that drew from it would
 * change the game it is only meant to choose a move in. Nor does it read
 * `Math.random` or a clock, so a local match, a saved one reloaded, and a
 * replay in a test all make the same choices.
 *
 * The state is two plain numbers — the seed and how many numbers have been
 * drawn — so it serialises with the match (O3's IndexedDB record) and a
 * reloaded match continues the same stream. Each draw is a pure function of
 * `(seed, n)` (SplitMix32 of the pair), which also makes it trivially
 * independent of the game's seed.
 *
 * Policy layer: value imports only from `src/lib/arena/policy/` (checked by
 * `scripts/verify/arena-policy-contract.mts`).
 */

export interface PolicyRng {
  v: 1;
  /** An unsigned 32-bit seed chosen by the session (not the game's seed). */
  seed: number;
  /** Numbers drawn so far. */
  n: number;
}

export function policyRng(seed: number): PolicyRng {
  if (!Number.isFinite(seed)) throw new Error("a policy seed must be a finite number");
  return { v: 1, seed: seed >>> 0, n: 0 };
}

/** SplitMix32 finaliser. */
function mix(x: number): number {
  let z = (x + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

/** One number in [0, 1) and the advanced state. The state passed in is not changed. */
export function nextRandom(rng: PolicyRng): { value: number; rng: PolicyRng } {
  const word = mix((mix(rng.seed) ^ Math.imul(rng.n + 1, 0x632be5ab)) >>> 0);
  return { value: word / 0x1_0000_0000, rng: { v: 1, seed: rng.seed, n: rng.n + 1 } };
}

/** An integer in [0, bound), and the advanced state. */
export function nextInt(rng: PolicyRng, bound: number): { value: number; rng: PolicyRng } {
  if (!Number.isInteger(bound) || bound <= 0) throw new Error(`nextInt needs a positive integer bound (got ${bound})`);
  const drawn = nextRandom(rng);
  return { value: Math.floor(drawn.value * bound), rng: drawn.rng };
}
