/**
 * Engine-seed blocks of the arena's strength evaluations: which ranges earlier experiments consumed,
 * and the blocks the SPRT gate (`scripts/arena-sprt.mts`, `docs/arena-policy-sprt.md`) may use.
 *
 * A deal d of an SPRT block is engine seed `base + d` and policy seed `policyBase + d` (each physical
 * seat's policy RNG is `policyRng(2·policySeed + 1)` for p1 and `+ 2` for p2, as every evaluator here
 * has done). Engine and policy seeds come from separate generators; they are kept in separate ranges
 * anyway so that no number means two things.
 *
 * Status:
 *   consumed  Results from these seeds have been seen. Never fresh again: the runner refuses them.
 *   dev       Reusable for development and tuning. Its results are never evidence of strength.
 *   open      Fresh. A gate run consumes the whole block: the change that records the run's evidence
 *             also sets the block to `consumed` here and names the evidence (`consumedBy`).
 */
export type SeedBlockStatus = "consumed" | "dev" | "open";

export interface SeedRange {
  name: string;
  /** First engine seed. */
  base: number;
  /** Seeds in the range: [base, base + size). */
  size: number;
  status: SeedBlockStatus;
  /** What used (or may use) it, and where that is recorded. */
  note: string;
}

export interface SprtSeedBlock extends SeedRange {
  status: "dev" | "open" | "consumed";
  /** First policy seed of the block (deal d uses policyBase + d). */
  policyBase: number;
  /** The evidence that consumed it, once it is consumed. */
  consumedBy?: string;
}

/** Engine-seed ranges earlier experiments used. The SPRT blocks below must not touch any of them. */
export const CONSUMED_RANGES: readonly SeedRange[] = [
  {
    name: "legacy-small", base: 0, size: 1_000_000, status: "consumed",
    note: "every seed below 1,000,000: fixture and scenario seeds (641, 644, ...), the #651 dev set (fixtureSeed·1000 + k, 641,000–652,999, tuned against by every evaluator), the #897 corpus packs (897,000+) and the #901 Claude duel (901,000+)",
  },
  { name: "651-holdout", base: 10_000_000, size: 1_000_000, status: "consumed", note: "#663 search v1 holdout at +10,000,000 (docs/arena-policy-strength.md)" },
  { name: "826-interrupted", base: 20_000_000, size: 1_000_000, status: "consumed", note: "#826 first holdout attempt, interrupted (docs/arena-backlog/evidence/826/interrupted-20m.json)" },
  { name: "826-holdout", base: 30_000_000, size: 1_000_000, status: "consumed", note: "#826 resource search holdout at +30,000,000 (docs/arena-resource-search-826.md)" },
  { name: "899-holdout", base: 40_899_000, size: 101_000, status: "consumed", note: "#899 defensive-policy holdouts, 40,899,000 and 40,899,400 packs (docs/arena-backlog/evidence/899/fresh-holdouts-2026-10-19/)" },
  { name: "claude-campaign", base: 70_000_000, size: 1_000_000, status: "consumed", note: "reserved for the local-policy versus Claude API campaign (#904 pilot, #905): scripts/arena-claude-pilot.mts plays from 70,000,000; never an SPRT block" },
];

/** Policy-seed ranges earlier experiments used (7919 + … in #651/#663/#826; 89,940,000 in #899). */
export const CONSUMED_POLICY_RANGES: readonly SeedRange[] = [
  { name: "legacy-policy", base: 0, size: 1_000_000, status: "consumed", note: "7919 + game / 7919 + 2k + seat (#651, #663, #826)" },
  { name: "899-policy", base: 89_940_000, size: 1_000_000, status: "consumed", note: "#899 policySeedBase 89,940,000" },
  { name: "claude-campaign-policy", base: 570_000_000, size: 1_000_000, status: "consumed", note: "reserved for the Claude API campaign's policy seeds (scripts/arena-claude-pilot.mts)" },
];

const BLOCK = 1_000_000;

/** The SPRT gate's blocks. Add `sprt-gate-6`… after the last open block (+1,000,000 each, below 60,000,000). */
export const SPRT_SEED_BLOCKS: readonly SprtSeedBlock[] = [
  { name: "sprt-dev", base: 60_000_000, size: BLOCK, policyBase: 560_000_000, status: "dev", note: "development and tuning of SPRT candidates; the harness's own A/A and vs-uniform measurements (2026-11-08)" },
  { name: "sprt-gate-1", base: 50_000_000, size: BLOCK, policyBase: 550_000_000, status: "consumed", note: "first gate run: lookahead-hard v1 (turn horizon) vs heuristic, 8 Nov 2026 — H0 accepted at 334 games, Elo -10.4 [-41.9, +20.9]", consumedBy: "docs/arena-backlog/evidence/sprt/gate1-lookahead-hard.json" },
  { name: "sprt-gate-2", base: 51_000_000, size: BLOCK, policyBase: 551_000_000, status: "consumed", note: "lookahead-hard v2 (fitted win probability) vs heuristic, 8 Nov 2026 — PASS: H1 accepted at 120 games, Elo +101.2 [+42.8, +165.8]", consumedBy: "docs/arena-backlog/evidence/sprt/gate2-lookahead-hard.json" },
  { name: "sprt-gate-3", base: 52_000_000, size: BLOCK, policyBase: 552_000_000, status: "consumed", note: "lookahead-normal v2 (fitted win probability) vs heuristic, 8 Nov 2026 — PASS: H1 accepted at 90 games, Elo +129.2 [+59.3, +210.8]", consumedBy: "docs/arena-backlog/evidence/sprt/gate3-lookahead-normal.json" },
  { name: "sprt-gate-4", base: 53_000_000, size: BLOCK, policyBase: 553_000_000, status: "consumed", note: "lookahead-hard v3 vs heuristic, 8 Nov 2026 — PASS: H1 accepted at 92 games, Elo +126.1 [+57.8, +205.4]", consumedBy: "docs/arena-backlog/evidence/sprt/gate4-lookahead-hard-v3.json" },
  { name: "sprt-gate-5", base: 54_000_000, size: BLOCK, policyBase: 554_000_000, status: "consumed", note: "lookahead-normal v3 vs heuristic, 8 Nov 2026 — PASS: H1 accepted at 80 games, Elo +147.2 [+72.8, +237.3]", consumedBy: "docs/arena-backlog/evidence/sprt/gate5-lookahead-normal-v3.json" },
  { name: "sprt-gate-6", base: 55_000_000, size: BLOCK, policyBase: 555_000_000, status: "consumed", note: "lookahead-hard v4 (margin 3, sure wins) vs heuristic, 9 Nov 2026 — PASS: H1 accepted at 96 games, Elo +104.4 [+45.0, +170.4]", consumedBy: "docs/arena-backlog/evidence/sprt/gate6-lookahead-hard-v4.json" },
  { name: "sprt-gate-7", base: 56_000_000, size: BLOCK, policyBase: 556_000_000, status: "consumed", note: "lookahead-normal v4 vs heuristic, 9 Nov 2026 — PASS: H1 accepted at 128 games, Elo +77.2 [+27.4, +130.5]", consumedBy: "docs/arena-backlog/evidence/sprt/gate7-lookahead-normal-v4.json" },
  { name: "sprt-gate-8", base: 57_000_000, size: BLOCK, policyBase: 557_000_000, status: "open", note: "next gate run" },
  { name: "sprt-gate-9", base: 58_000_000, size: BLOCK, policyBase: 558_000_000, status: "open", note: "next gate run" },
];

const overlaps = (a: { base: number; size: number }, b: { base: number; size: number }) => a.base < b.base + b.size && b.base < a.base + a.size;

/**
 * Throws when a block's engine or policy range shares a number with any consumed range (engine or
 * policy) or with any range of another block, or when a block is malformed.
 */
export function assertSeedRegistry(blocks: readonly SprtSeedBlock[] = SPRT_SEED_BLOCKS): void {
  const consumed = [...CONSUMED_RANGES, ...CONSUMED_POLICY_RANGES].map((r) => ({ label: `consumed ${r.name}`, base: r.base, size: r.size }));
  const ranges = blocks.flatMap((b) => [{ label: `${b.name} engine seeds`, block: b.name, base: b.base, size: b.size }, { label: `${b.name} policy seeds`, block: b.name, base: b.policyBase, size: b.size }]);
  const names = new Set<string>();
  for (const b of blocks) {
    if (names.has(b.name)) throw new Error(`two seed blocks are called ${b.name}`);
    names.add(b.name);
    if (![b.base, b.size, b.policyBase].every(Number.isSafeInteger) || b.size < 1 || b.base < 0 || b.policyBase < 0) throw new Error(`seed block ${b.name}: base, policyBase and size must be non-negative integers`);
    // Each physical seat's RNG seed is at most 2·policySeed + 2: it must stay an unsigned 32-bit seed.
    if (2 * (b.policyBase + b.size) + 2 > 0xffffffff) throw new Error(`seed block ${b.name}: policy seeds overflow 32 bits`);
    if (b.status === "consumed" && !b.consumedBy) throw new Error(`seed block ${b.name} is consumed but does not name the evidence that consumed it`);
  }
  for (const [i, a] of ranges.entries()) {
    for (const r of consumed) if (overlaps(a, r)) throw new Error(`${a.label} overlap ${r.label}`);
    for (const b of ranges.slice(i + 1)) if (overlaps(a, b)) throw new Error(`${a.label} overlap ${b.label}`);
  }
}

/** The block a run may use, by name; refuses unknown and consumed blocks. */
export function sprtSeedBlock(name: string, blocks: readonly SprtSeedBlock[] = SPRT_SEED_BLOCKS): SprtSeedBlock {
  assertSeedRegistry(blocks);
  const block = blocks.find((b) => b.name === name);
  if (!block) throw new Error(`unknown seed block ${name} (known: ${blocks.map((b) => `${b.name} [${b.status}]`).join(", ")})`);
  if (block.status === "consumed") throw new Error(`seed block ${name} is consumed (${block.consumedBy}); its seeds are never fresh again. Use the next open sprt-gate block.`);
  return block;
}

/** Engine and policy seed of deal `deal` of a block. */
export function dealSeeds(block: SprtSeedBlock, deal: number): { engineSeed: number; policySeed: number } {
  if (!Number.isInteger(deal) || deal < 0 || deal >= block.size) throw new Error(`deal ${deal} is outside seed block ${block.name} (0..${block.size - 1})`);
  return { engineSeed: block.base + deal, policySeed: block.policyBase + deal };
}
