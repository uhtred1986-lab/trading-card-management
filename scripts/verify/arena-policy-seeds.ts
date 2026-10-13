/**
 * #651: the committed seed sets of the local-policy evaluation.
 *
 * A game is named by (fixture, seed index k). Its engine seed is `base + fixtureSeed * 1000 + k`, so one
 * index is the same deal on every machine; each index is played once from each seat, which shares the deal
 * between the two. Browser-safe (no imports): the Node evaluation and the browser latency worker both use it.
 *
 *   dev      k = 0 .. 999            what the evaluation, the CI check and the doc's tables use. Any change
 *                                    to the policy may be tuned against it.
 *   holdout  k = 0 .. 999 at +10 M   RESERVED for O5. Nothing in the repository tunes against it, the
 *                                    evaluation refuses to run it without `--allow-holdout`, and the doc
 *                                    records no result from it. An O5 improvement claim is judged here, once.
 *
 * The two sets cannot collide: dev seeds stay below `fixtureSeed * 1000 + 1000`, holdout seeds are above
 * 10 000 000 (`verifySeedSets` below, run by every evaluation).
 */
export interface SeedSet {
  name: "dev" | "holdout";
  /** Added to `fixtureSeed * 1000 + k`. */
  base: number;
  /** Exclusive bound on k. */
  size: number;
  /** Not to be used for tuning. */
  reserved: boolean;
}

export const SEED_SETS: Record<SeedSet["name"], SeedSet> = {
  dev: { name: "dev", base: 0, size: 1000, reserved: false },
  holdout: { name: "holdout", base: 10_000_000, size: 1000, reserved: true },
};

export function gameSeed(set: SeedSet, fixtureSeed: number, k: number): number {
  if (!Number.isInteger(k) || k < 0 || k >= set.size) throw new Error(`seed index ${k} is outside the ${set.name} set (0..${set.size - 1})`);
  return set.base + fixtureSeed * 1000 + k;
}

/** Throws when the dev and holdout seeds of any of these fixtures overlap. */
export function verifySeedSets(fixtureSeeds: number[]): void {
  const seen = new Map<number, string>();
  for (const set of Object.values(SEED_SETS)) {
    for (const f of fixtureSeeds) {
      for (const k of [0, set.size - 1]) {
        const s = gameSeed(set, f, k);
        const owner = seen.get(s);
        if (owner && owner.split("/")[0] !== set.name) throw new Error(`seed ${s} is in both ${owner} and ${set.name}/${f}/${k}`);
      }
    }
  }
  const dev = SEED_SETS.dev;
  const hold = SEED_SETS.holdout;
  const devMax = Math.max(...fixtureSeeds) * 1000 + dev.size - 1 + dev.base;
  const holdMin = Math.min(...fixtureSeeds) * 1000 + hold.base;
  if (devMax >= holdMin) throw new Error(`dev seeds reach ${devMax}, into the holdout range starting at ${holdMin}`);
}
