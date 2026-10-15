/** Node-only source provenance. Only digests leave this process, never source or paths. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { ManifestRunner, RunnerId } from "../../src/lib/arena/testing/run-manifest.ts";

export function evaluationRunnerPin<T extends RunnerId>(id: T, version: string, cwd = process.cwd()): ManifestRunner & { id: T } {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  const gitCommit = git("rev-parse", "HEAD").toString().trim();
  if (!/^[a-f0-9]{40}$/.test(gitCommit)) throw new Error("Evidence export needs an exact Git commit.");
  const diff = git("diff", "--binary", "HEAD", "--");
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").toString().split("\0").filter(Boolean).sort();
  let dirtyTreeSha256: string | null = null;
  if (diff.length || untracked.length) {
    const hash = createHash("sha256");
    hash.update("arena-working-tree-v1\0").update(diff);
    for (const name of untracked) {
      const file = resolve(cwd, name);
      const stat = lstatSync(file);
      const contents = stat.isSymbolicLink() ? Buffer.from(readlinkSync(file)) : readFileSync(file);
      hash.update("\0").update(name).update("\0").update(String(stat.mode)).update("\0");
      hash.update(createHash("sha256").update(contents).digest());
    }
    dirtyTreeSha256 = hash.digest("hex");
  }
  return { id, version, gitCommit, dirtyTreeSha256 };
}
