/** Exact historical #899 comparator. Evaluation tooling only; never imported by production policy. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Policy } from "../../src/lib/arena/policy/contract";
import { localPolicy } from "../fixtures/policy-before-1026/combat";
import manifest from "../fixtures/policy-before-1026/manifest.json";
const root = new URL("../../", import.meta.url);
const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, root)), "utf8");
/** Injectable read boundary lets the focused proof verify refusal without mutating files. */
export function verifyFrozenBaselineSources(readSource: (path: string) => string = read): void {
  for (const source of manifest.sources) {
    const actual = readSource(source.path);
    if (sha256(actual) !== source.sha256) throw new Error(`historical baseline source changed: ${source.path}`);
    let original = actual;
    for (const [oldPath, adaptedPath] of Object.entries(source.rewrites)) original = original.replaceAll(adaptedPath, oldPath);
    if (sha256(original) !== source.originalSha256) throw new Error(`historical baseline import-only reconstruction differs: ${source.path}`);
  }
  for (const dependency of manifest.sharedDependencies) {
    if (sha256(readSource(dependency.path)) !== dependency.sha256) throw new Error(`historical baseline shared dependency changed: ${dependency.path}`);
    if (!dependency.reviewedChange && dependency.originalSha256 !== dependency.sha256) throw new Error(`historical baseline dependency is not unchanged: ${dependency.path}`);
  }
}
export function assertFrozenBaseline(): void { verifyFrozenBaselineSources(); }
export function frozenBaselinePin(): { key: string; version: string; sha256: string } {
  assertFrozenBaseline();
  return { key: manifest.key, version: manifest.version, sha256: sha256(JSON.stringify(manifest)) };
}
export function beforeDefensePolicy(): Policy {
  assertFrozenBaseline();
  return localPolicy();
}
