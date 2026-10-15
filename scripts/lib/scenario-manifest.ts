/** Deliberate projection of private scenario evidence into the portal's small wire format. */
import { randomUUID } from "node:crypto";
import { replayHash, type ReplayBundleRecord } from "../../src/lib/arena/replay-core.ts";
import { validateEvaluationManifest, type ManifestRunner, type ScenarioManifest } from "../../src/lib/arena/testing/run-manifest.ts";
import type { Evidence } from "../verify/arena-scenarios.ts";

export interface ScenarioAttempt {
  id: string;
  seed: number;
  evidence?: Evidence;
  /** Stays local: only its digest is included in the manifest. */
  error?: string;
}

export async function scenarioManifest(input: {
  bundle: ReplayBundleRecord;
  interpreterRevision: string | null;
  runner: ManifestRunner & { id: "arena-scenario" };
  protocolRevision: string;
  attempts: ScenarioAttempt[];
  browser: { agreement: Map<string, { agrees: boolean; differs: string[] }>; error?: string } | null;
  requestId?: string;
}): Promise<ScenarioManifest> {
  const { bundle, browser } = input;
  const manifest: ScenarioManifest = {
    version: 1, source: "scenario", requestId: input.requestId ?? randomUUID(), runner: input.runner,
    protocol: { id: "arena-scenario-v1", revision: input.protocolRevision },
    fixtures: [{
      key: "bundle", sourceId: "arena-scenario-input", runtimeRevision: input.interpreterRevision,
      bundleSha256: bundle.hash, rulesSha256: bundle.rulesetHash, catalogSha256: bundle.catalogHash,
      programsSha256: bundle.programsHash, p1DeckSha256: await replayHash(bundle.decks.p1),
      p2DeckSha256: await replayHash(bundle.decks.p2), p1RecipeId: null, p2RecipeId: null,
    }],
    policies: [],
    results: await Promise.all(input.attempts.map(async (attempt, index) => {
      const e = attempt.evidence;
      const side = browser?.agreement.get(attempt.id);
      const browserError = browser && (!side || browser.error);
      const outcome = attempt.error || !e || browserError ? "error" : !e.pass || side?.agrees === false ? "fail" : "pass";
      return {
        key: `case-${index + 1}`, kind: "scenario_case" as const, fixtureKey: "bundle",
        sourceScenarioId: attempt.id, portalScenarioId: null, seed: attempt.seed, seat: null,
        outcome, steps: e?.checked ?? 0, differenceCount: e ? e.diffs.length + e.omitted : 0,
        browserAgreement: browser ? side?.agrees === true && !browser.error : null,
        evidenceSha256: await replayHash({ attempt, browser: side ?? null, browserError: browser?.error ?? null }),
      };
    })),
  };
  const parsed = validateEvaluationManifest(manifest);
  if (!parsed.ok) throw new Error(`Scenario manifest rejected: ${parsed.reason}`);
  return manifest;
}
