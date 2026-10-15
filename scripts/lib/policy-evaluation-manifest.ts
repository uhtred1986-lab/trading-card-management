/** Public evidence projections only. Actual bundles, decisions and traces stay local. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { canonicalJson, type ReplayBundleRecord } from "../../src/lib/arena/replay-core.ts";
import { validateEvaluationManifest, type EvaluationManifest, type ManifestFixture, type ManifestPolicy } from "../../src/lib/arena/testing/run-manifest.ts";

export const evidenceHash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
export function policyPin(key: string, depth?: number): ManifestPolicy {
  const files = ["contract", "observation", "rng", "shortcuts", "main", "combat", "choices", ...(depth ? ["search"] : [])];
  return { key, version: depth ? `resource-search-v2-depth-${depth}` : "heuristic-v1",
    sha256: evidenceHash({ depth: depth ?? null, sources: files.map((file) => readFileSync(`src/lib/arena/policy/${file}.ts`, "utf8")) }) };
}
export function fixturePin(key: string, bundle: ReplayBundleRecord, runtimeRevision: string | null, recipes: {p1: string | null; p2: string | null} = {p1:null,p2:null}): ManifestFixture {
  return { key,sourceId:key,runtimeRevision,bundleSha256:evidenceHash(bundle.payload),rulesSha256:bundle.rulesetHash,
    catalogSha256:bundle.catalogHash,programsSha256:bundle.programsHash,p1DeckSha256:evidenceHash(bundle.decks.p1),p2DeckSha256:evidenceHash(bundle.decks.p2),
    p1RecipeId:recipes.p1,p2RecipeId:recipes.p2 };
}
export function writeEvidenceFile(path: string, contents: string): void {
  writeFileSync(path,contents,{mode:0o600});
  chmodSync(path,0o600);
}
export function assertManifest(manifest: EvaluationManifest): void {
  const result=validateEvaluationManifest(manifest);
  if(!result.ok) throw new Error(`Emitter contract violation: ${result.reason}`);
}
