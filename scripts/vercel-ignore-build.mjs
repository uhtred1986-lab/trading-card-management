// Vercel's "ignored build step": exit 0 skips the deploy, exit 1 builds it.
// A production deploy builds unless the commit range is provably docs-only (below). A preview of a branch an agent pushed
// (`feat/*`, `arena-*`, `backlog/*`, `claude/*`, `copilot/*`, `ops/*`) is skipped:
// nobody opens those previews (deployment protection plus Basic Auth) and each
// one cost a Neon wake-up and a Vercel build. A branch the owner pushes by hand
// under any other name still gets its preview.
import { execFileSync } from "node:child_process";

export const BOT_BRANCH = /^(feat|arena|backlog|claude|copilot|ops)[\/-]/;

// A production deploy is a full build plus a migration that wakes Neon, so a push to
// `main` that touches only docs, CI config or agent config is skipped. The rule is
// deliberately narrow: every changed path must be under `docs/`, `.github/` or `.claude/`,
// or be a root-level `*.md`. An empty list builds (nothing known, so don't guess).
export function isDocsOnlyChange(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return false;
  return paths.every((raw) => {
    const p = String(raw).trim().replace(/\\/g, "/");
    if (!p) return false;
    return /^(docs|\.github|\.claude)\//.test(p) || /^[^/]+\.md$/.test(p);
  });
}

// The files changed between the previous production deploy's commit and this one, or
// null when that cannot be known (either SHA unset, SHA absent from a shallow clone, git
// failing). `--no-renames` lists both sides of a move so a file moved out of `src/` counts.
export function changedFiles(env, run = execFileSync) {
  const prev = env.VERCEL_GIT_PREVIOUS_SHA;
  const curr = env.VERCEL_GIT_COMMIT_SHA;
  if (!prev || !curr) return null;
  try {
    const out = run("git", ["diff", "--name-only", "--no-renames", prev, curr], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return String(out).split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

export function shouldSkipBuild(env, files = () => changedFiles(env)) {
  if (env.VERCEL_ENV === "production") {
    try {
      return isDocsOnlyChange(files());
    } catch {
      return false;
    }
  }
  const branch = env.VERCEL_GIT_COMMIT_REF ?? "";
  return BOT_BRANCH.test(branch);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const skip = shouldSkipBuild(process.env);
  console.log(`vercel-ignore-build: ${process.env.VERCEL_ENV ?? "unknown"} deploy of ${process.env.VERCEL_GIT_COMMIT_REF ?? "?"} — ${skip ? "skipped" : "building"}`);
  process.exit(skip ? 0 : 1);
}
