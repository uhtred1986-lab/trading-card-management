#!/usr/bin/env node
/**
 * Delete remote branches whose work is already in `main` (CLAUDE.md: "after a PR merges, delete the
 * merged remote branch … never delete a branch that hasn't merged").
 *
 *   npm run branches:prune             # dry run: lists what would be deleted and what is kept, and why
 *   npm run branches:prune -- --apply  # deletes the listed branches on origin
 *
 * Needs `git` and the GitHub CLI (`gh auth login`); it uses only the REST API (`gh api`). Works the same in
 * PowerShell and bash. Set GH_REPO=owner/repo if the clone's remote is not the GitHub repo.
 *
 * Squash merges leave no merge commit, so `git branch -r --merged main` misses most merged branches.
 * A branch is deleted only when one of these holds:
 *   - its tip is already an ancestor of origin/main (a merge commit or a fast-forward), or
 *   - a MERGED pull request has exactly this branch as its head AND exactly this tip as its head
 *     commit (nothing was pushed to the branch after the merge).
 * Never deleted: main, the default branch, a branch with an OPEN pull request, and anything else
 * (unmerged work, or commits pushed after the merge), which is listed as kept with the reason.
 */
import { execFileSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const PROTECTED = new Set(["main", "master", "HEAD"]);

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryRun = (cmd, args) => {
  try { run(cmd, args); return true; } catch { return false; }
};

/**
 * Pull requests through the REST API (`gh api`; `{owner}/{repo}` is this clone's GitHub repo, or GH_REPO).
 * Paged by number rather than `--paginate`, whose next-page links some proxies refuse.
 */
function prs(state) {
  const all = [];
  for (let page = 1; ; page++) {
    const out = run("gh", ["api", `repos/{owner}/{repo}/pulls?state=${state}&per_page=100&page=${page}`,
      "--jq", ".[] | {number, merged: (.merged_at != null), headRefName: .head.ref, headRefOid: .head.sha}"]);
    const rows = out.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    all.push(...rows);
    if (rows.length < 100) return all;
  }
}

run("git", ["fetch", "--prune", "origin"]);
const defaultBranch = run("gh", ["api", "repos/{owner}/{repo}", "--jq", ".default_branch"]);
PROTECTED.add(defaultBranch);

const branches = run("git", ["for-each-ref", "refs/remotes/origin", "--format=%(refname:lstrip=3) %(objectname)"])
  .split("\n").filter(Boolean)
  .map((line) => { const [name, sha] = line.split(" "); return { name, sha }; })
  .filter((b) => !PROTECTED.has(b.name));

const open = new Set(prs("open").map((p) => p.headRefName));
const merged = new Map();
for (const p of prs("closed").filter((x) => x.merged)) {
  const list = merged.get(p.headRefName) ?? [];
  list.push(p);
  merged.set(p.headRefName, list);
}

const remove = [];
const keep = [];
for (const b of branches) {
  if (open.has(b.name)) { keep.push({ ...b, why: "has an open pull request" }); continue; }
  if (tryRun("git", ["merge-base", "--is-ancestor", b.sha, `origin/${defaultBranch}`])) {
    remove.push({ ...b, why: `tip is in ${defaultBranch}` });
    continue;
  }
  const pr = (merged.get(b.name) ?? []).find((p) => p.headRefOid === b.sha);
  if (pr) { remove.push({ ...b, why: `merged as #${pr.number}` }); continue; }
  const later = merged.get(b.name);
  keep.push({ ...b, why: later ? `commits after its merged PR #${later.map((p) => p.number).join(", #")}` : "not merged" });
}

const short = (sha) => sha.slice(0, 8);
console.log(`${remove.length} merged branch(es) to delete:`);
for (const b of remove) console.log(`  - ${b.name}  ${short(b.sha)}  (${b.why})`);
console.log(`\n${keep.length} branch(es) kept:`);
for (const b of keep) console.log(`  = ${b.name}  ${short(b.sha)}  (${b.why})`);

if (!APPLY) {
  console.log(`\nDry run: nothing deleted. Run again with --apply to delete the ${remove.length} branch(es) above.`);
  process.exit(0);
}

let failed = 0;
for (let i = 0; i < remove.length; i += 20) {
  const batch = remove.slice(i, i + 20);
  // --force-with-lease per ref: the delete is refused if the branch moved since this listing.
  const leases = batch.map((b) => `--force-with-lease=refs/heads/${b.name}:${b.sha}`);
  try {
    run("git", ["push", "origin", ...leases, "--delete", ...batch.map((b) => b.name)]);
    for (const b of batch) console.log(`deleted ${b.name}`);
  } catch (e) {
    failed += batch.length;
    console.error(`could not delete ${batch.map((b) => b.name).join(", ")}: ${String(e.stderr ?? e.message).trim()}`);
  }
}
console.log(`\n${remove.length - failed} deleted, ${failed} failed.`);
process.exit(failed ? 1 : 0);
