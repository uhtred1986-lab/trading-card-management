/** Offline #899 exact-pre-fix comparison. Protocol is committed before fresh seeds are consumed. */
import type { DuelResult } from "../verify/arena-policy-duel";
import type { ManifestFixture, ManifestPolicy, ManifestRunner } from "../../src/lib/arena/testing/run-manifest";
import type { PolicyRng } from "../../src/lib/arena/policy/rng";
export interface DefenseProtocol {
  format: "arena-defense-protocol-v1";
  id: string;
  /** Current engine source revision; documentation-only freeze commits may follow. */
  runtimeRevision: string;
  /** Two exact two-deck packs: four ordered fixtures each. Paths stay private. */
  corpora: { key: string; path: string; sha256: string; mode: "compiler" | "stored"; decks: [string, string]; seedBase: number }[];
  deals: 20;
  maxMoves: 3000;
  /** Physical-seat RNG is identical for both candidate assignments of a deal. */
  policySeedBase: number;
  privacyEvery: number;
  baseline: { key: string; version: string; sha256: string };
  gate: { pairs: 160; decisivePairs: 20; pairWinCiLowGreaterThan: 0.5; perFixturePairCiUpperAtLeast: 0.5; completionRate: 1; illegal: 0; privacyFailures: 0; guardTrips: 0 };
}
export interface DefenseJob {
  index: number; key: string; fixture: string; corpus: string; p1: string; p2: string; k: number; candidateSeat: "p1" | "p2";
  seed: number; policySeed: number; initialPolicyRng: { p1: PolicyRng; p2: PolicyRng };
}
export interface DefenseFreeze {
  format: "arena-defense-freeze-v1";
  protocolSha256: string;
  /** Content pins survive a documentation-only commit of this freeze. */
  sourceSha256: string;
  fixtures: ManifestFixture[];
  policies: ManifestPolicy[];
  jobs: DefenseJob[];
  /** Exact public specification. No pack paths, card lists or states. */
  protocol: Omit<DefenseProtocol, "corpora"> & { corpora: Omit<DefenseProtocol["corpora"][number], "path">[] };
  sha256: string;
}
export interface DefenseChecks { sampled: number; nontrivial: number; failures: number; candidateSamples: number; baselineSamples: number }
export interface DefenseRecord {
  job: DefenseJob;
  classification: "completed" | "draw" | "illegal" | "interrupted" | "limited" | "crashed" | "other";
  /** A crash has no invented result, move count, trace or timings. */
  result: DuelResult | null;
  errorSha256: string | null;
  checks: DefenseChecks | null;
}
export interface DefenseJournal {
  format: "arena-defense-journal-v1"; requestId: string; freezeSha256: string; runner: ManifestRunner;
  shard: { index: number; count: number }; records: DefenseRecord[];
  /** Durable BEGIN: an uncompleted attempt is consumed and converted to a crash on resume. */
  inflight: { job: DefenseJob; startedAt: string } | null; sha256: string;
}
