/** Direct projection of actual corpus attempts; historical packs lack these metrics. */
import { randomUUID } from "node:crypto";
import type { ReplayBundleRecord } from "../../src/lib/arena/replay-core";
import type { ManifestRunner, PolicyEvalManifest } from "../../src/lib/arena/testing/run-manifest";
import type { DuelResult } from "../verify/arena-policy-duel";
import { policyRng } from "../../src/lib/arena/policy/rng";
import { assertManifest, evidenceHash, fixturePin, policyPin } from "./policy-evaluation-manifest";
export interface CorpusAttempt { bundle: ReplayBundleRecord; runtime: string; seed: number; policySeed: number; result: DuelResult | null }
export function corpusManifest(runner: ManifestRunner & { id: "arena-corpus-freeze" }, configuration: { mode: string; pairs: number; maxMoves: number; seedBase: number }) {
  const manifest: PolicyEvalManifest = { version: 1, source: "policy_eval", requestId: randomUUID(), runner,
    protocol: { id: `arena-corpus-${configuration.mode}-v1`, revision: evidenceHash(configuration) }, seedSet: "custom",
    fixtures: [], policies: [policyPin("local-policy")], results: [] };
  const fixtureKeys = new Map<string, string>(); let crashes = 0;
  return {
    record(attempt: CorpusAttempt) {
      if (!attempt.result) { crashes++; return; }
      const signature = evidenceHash({ payload: attempt.bundle.payload, decks: attempt.bundle.decks });
      let key = fixtureKeys.get(signature);
      if (!key) { key = `corpus-fixture-${fixtureKeys.size + 1}`; fixtureKeys.set(signature, key); manifest.fixtures.push(fixturePin(key, attempt.bundle, attempt.runtime)); }
      const r = attempt.result;
      manifest.results.push({ key: `game-${manifest.results.length + 1}`, kind: "policy_game", fixtureKey: key,
        candidatePolicyKey: "local-policy", baselinePolicyKey: "local-policy", seedIndex: null, seed: attempt.seed, candidateSeat: "p1",
        initialPolicyRng: { p1: { mode: "seeded", ...policyRng(attempt.policySeed * 2 + 1) }, p2: { mode: "seeded", ...policyRng(attempt.policySeed * 2 + 2) } },
        outcome: r.winner === "test" ? "win" : r.winner === "baseline" ? "loss" : r.winner === "draw" ? "draw" : r.stopKind === "illegal" ? "illegal" : r.stopKind === "limit" ? "limit" : "interrupted",
        winner: r.winner === "test" ? "p1" : r.winner === "baseline" ? "p2" : null, moves: r.moves, turn: r.turn,
        damageDealt: r.damageDealt, damageTaken: r.damageTaken, guardTrips: r.guards.test + r.guards.baseline,
        stopKind: r.stopKind, reportedCostMicros: null, evidenceSha256: evidenceHash(r) });
    },
    finish() { if (crashes) throw new Error("Corpus manifest cannot invent metrics for crashed attempts; retain the local pack and resolve runner failures."); assertManifest(manifest); return manifest; },
  };
}
