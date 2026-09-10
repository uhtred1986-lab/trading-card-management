// Cross-checks a PR's `Closes #N` / `Fixes #N` / `Resolves #N` claims against
// what the diff actually delivers, and posts (or updates) one summary comment.
//
// BugBot (bugbot.yml) reviews the diff in isolation for bugs. This is a
// different failure mode: the diff can be bug-free and still not implement
// what the PR claims to close — and GitHub auto-closes every referenced
// issue the moment such a PR merges, whether or not the work is really done.
// See PR #182 for a real example this would have caught.
//
// Requires: gh CLI authenticated (GH_TOKEN), and the Claude Code CLI on PATH
// with CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY set (see workflow).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MARKER = "<!-- ac-check-comment -->";

function gh(args, input) {
  return execFileSync("gh", args, {
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
    input,
  });
}

function eventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH not set — must run inside a GitHub Action.");
  const event = JSON.parse(readFileSync(eventPath, "utf-8"));
  const pr = event.pull_request;
  if (!pr) throw new Error("No pull_request in the event payload.");
  return pr;
}

function extractClosingRefs(body) {
  if (!body) return [];
  const re = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)/gi;
  const seen = new Set();
  const refs = [];
  let m;
  while ((m = re.exec(body))) {
    const n = Number(m[2]);
    if (!seen.has(n)) {
      seen.add(n);
      refs.push(n);
    }
  }
  return refs;
}

function main() {
  const pr = eventPayload();
  const prNumber = pr.number;
  const repo = process.env.GITHUB_REPOSITORY;

  const refs = extractClosingRefs(pr.body || "");
  if (refs.length === 0) {
    console.log("No Closes/Fixes/Resolves references in the PR body — nothing to check.");
    return;
  }

  const diffFiles = JSON.parse(gh(["pr", "view", String(prNumber), "--repo", repo, "--json", "files", "-q", ".files"]));
  const changedPaths = diffFiles.map((f) => f.path);
  const diff = gh(["pr", "diff", String(prNumber), "--repo", repo]);
  // Large diffs cost a lot to reason over well; cap it, same ceiling BugBot uses.
  const cappedDiff = diff.length > 200_000 ? `${diff.slice(0, 200_000)}\n\n...[diff truncated at 200KB]` : diff;

  const issues = refs.map((n) => {
    try {
      const raw = gh(["issue", "view", String(n), "--repo", repo, "--json", "number,title,body,state"]);
      return JSON.parse(raw);
    } catch (err) {
      return { number: n, title: "(could not fetch)", body: "", state: "unknown", error: String(err) };
    }
  });

  const issuesBlock = issues
    .map(
      (i) =>
        `### Issue #${i.number} — ${i.title} (currently: ${i.state})\n${i.body ? i.body.slice(0, 3000) : "(no body)"}`
    )
    .join("\n\n---\n\n");

  const prompt = `You are checking whether a pull request's diff actually implements what it claims to close.

The PR body references these issues via "Closes #N" / "Fixes #N" / "Resolves #N":
${refs.map((n) => `#${n}`).join(", ")}

Files changed in this PR:
${changedPaths.map((p) => `- ${p}`).join("\n")}

Issue details (title, body — which may include acceptance criteria):
${issuesBlock}

The diff:
${cappedDiff}

For EACH referenced issue, decide one of:
- DELIVERED: the diff contains code (not just tests, not just docs) that plausibly implements the issue's described behavior/acceptance criteria.
- PARTIAL: the diff touches related code but doesn't clearly satisfy the issue's stated acceptance criteria, or only adds tests/docs without a source fix.
- NOT DELIVERED: nothing in the changed files relates to the issue's scope at all.
- ALREADY CLOSED: the issue's state is already "closed" — merging this PR re-closing it is redundant, not a delivery claim worth verifying.

Be skeptical: a PR claiming to close an issue with no related file changes is NOT DELIVERED, full stop. Do not give benefit of the doubt to vague or superficial changes.

Output ONLY a markdown table with columns: Issue | Verdict | Why (one sentence). Then, if any issue is NOT DELIVERED or PARTIAL, add a short "## Risk" section below the table explaining that merging this PR will auto-close those issues on GitHub regardless of whether the work is done, since the PR body references them. Keep the whole response under 400 words. No preamble, no other sections.`;

  console.log(`Running Claude Code over ${refs.length} referenced issue(s)...`);
  const verdict = execFileSync("claude", ["-p", prompt, "--output-format", "text"], {
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
  }).trim();

  const commentBody = `${MARKER}\n## Acceptance-criteria check\n\nAutomated cross-check of this PR's \`Closes #N\` claims against its actual diff.\n\n${verdict}\n\n<sub>This is a heuristic LLM read, not a substitute for human review — it can miss context the issue doesn't spell out.</sub>`;

  const existing = JSON.parse(gh(["pr", "view", String(prNumber), "--repo", repo, "--json", "comments", "-q", ".comments"]));
  const prior = existing.find((c) => typeof c.body === "string" && c.body.includes(MARKER));

  if (prior) {
    gh(["api", `repos/${repo}/issues/comments/${prior.id}`, "-X", "PATCH", "-f", `body=${commentBody}`]);
    console.log("Updated existing acceptance-criteria comment.");
  } else {
    gh(["pr", "comment", String(prNumber), "--repo", repo, "--body", commentBody]);
    console.log("Posted new acceptance-criteria comment.");
  }
}

main();
