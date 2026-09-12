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
const stripNullBytes = (s) => s.replace(/\u0000/g, "");
const CLAUDE_LIMIT_RE = /\b(weekly limit|rate limit|quota)\b/i;

// Matches the first line of an issue's acceptance section, however it was headed.
const ACCEPTANCE_HEADING_RE = /^\*\*Acceptance\.?\*\*|^## Acceptance|^\*\*Done when\*\*/m;
// The next section boundary after an acceptance heading: another `## ` heading, or a `---` rule.
const SECTION_END_RE = /^## |^---\s*$/m;
const PROBLEM_HEADING_RE = /^\*\*Problem\.?\*\*/m;
const CLOSING_REF_RE = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)/gi;
const REFERENCING_REF_RE = /\b(refs?|references?)\s*:?\s*#(\d+)/gi;

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

function matchRefNumbers(body, re) {
  re.lastIndex = 0;
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

// `Closes #N` / `Fixes #N` / `Resolves #N` are closure claims the ac-check grades against the
// issue's own acceptance criteria. `Refs #N` / `References #N` are not — they're listed in the
// comment as "referenced, not closing" and never graded, never raise the auto-close Risk warning.
// A number claimed both ways (unusual, but not impossible) counts as closing only.
export function extractIssueRefs(body) {
  if (!body) return { closing: [], referencing: [] };
  const closing = matchRefNumbers(body, CLOSING_REF_RE);
  const referencing = matchRefNumbers(body, REFERENCING_REF_RE).filter((n) => !closing.includes(n));
  return { closing, referencing };
}

// Extracts title + Problem paragraph (capped) + Acceptance section from an issue body, so the
// model grading a PR's Closes claim actually sees what it's grading against — the acceptance
// section on a backlog issue can sit 6-10k characters in, well past a flat character cap.
// Falls back to the old flat slice when the body has no recognisable acceptance heading.
export function extractAcceptanceSection(body) {
  if (!body) return null;
  const headingMatch = ACCEPTANCE_HEADING_RE.exec(body);
  if (!headingMatch) return null;
  const sectionStart = headingMatch.index;
  const searchFrom = sectionStart + headingMatch[0].length;
  const rest = body.slice(searchFrom);
  const endMatch = SECTION_END_RE.exec(rest);
  const sectionEnd = endMatch ? searchFrom + endMatch.index : body.length;
  return body.slice(sectionStart, sectionEnd).trim();
}

export function extractProblemParagraph(body, limit = 600) {
  if (!body) return "";
  const headingMatch = PROBLEM_HEADING_RE.exec(body);
  if (!headingMatch) return "";
  const rest = body.slice(headingMatch.index);
  const paraBreak = rest.search(/\n\s*\n/);
  const paragraph = paraBreak === -1 ? rest : rest.slice(0, paraBreak);
  return paragraph.slice(0, limit).trim();
}

export function buildIssueExcerpt(issue) {
  const body = issue.body || "";
  const acceptance = extractAcceptanceSection(body);
  if (!acceptance) {
    return body ? body.slice(0, 3000) : "(no body)";
  }
  const parts = [`Title: ${issue.title}`];
  const problem = extractProblemParagraph(body, 600);
  if (problem) parts.push(`Problem: ${problem}`);
  parts.push(`Acceptance:\n${acceptance}`);
  return parts.join("\n\n");
}

function runClaude(prompt) {
  try {
    return execFileSync("claude", ["-p", "--output-format", "text"], {
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
      input: prompt,
    }).trim();
  } catch (err) {
    const output = `${err?.stdout ?? ""}\n${err?.stderr ?? ""}\n${err?.message ?? ""}`;
    if (CLAUDE_LIMIT_RE.test(output)) {
      console.warn("Claude check skipped: quota/limit reached.");
      return `| Issue | Verdict | Why (one sentence) |\n| --- | --- | --- |\n| (all referenced issues) | PARTIAL | Automated acceptance-criteria check was skipped because the Claude CI quota/limit was reached; please verify issue-closure claims manually before merge. |\n\n## Risk\nMerging this PR can still auto-close referenced issues on GitHub even if the work is incomplete, so a manual check is required for this run.`;
    }
    throw err;
  }
}

function main() {
  const pr = eventPayload();
  const prNumber = pr.number;
  const repo = process.env.GITHUB_REPOSITORY;

  const { closing, referencing } = extractIssueRefs(pr.body || "");
  if (closing.length === 0 && referencing.length === 0) {
    console.log("No Closes/Fixes/Resolves/Refs references in the PR body — nothing to check.");
    return;
  }

  // `Refs #N` is a claim of relevance, not of closure: list it plainly, grade nothing, and never
  // raise the auto-close Risk warning for it.
  const referencingSection =
    referencing.length > 0
      ? `\n\n### Referenced (not closing)\n${referencing
          .map((n) => `- #${n} — referenced, not closing`)
          .join("\n")}`
      : "";

  let verdictSection = "This PR references issues but makes no `Closes #N` / `Fixes #N` / `Resolves #N` claim, so there is nothing to grade.";

  if (closing.length > 0) {
    const diffFiles = JSON.parse(gh(["pr", "view", String(prNumber), "--repo", repo, "--json", "files", "-q", ".files"]));
    const changedPaths = diffFiles.map((f) => f.path);
    const diff = gh(["pr", "diff", String(prNumber), "--repo", repo]);
    // Large diffs cost a lot to reason over well; cap it, same ceiling BugBot uses.
    const cappedDiff = diff.length > 200_000 ? `${diff.slice(0, 200_000)}\n\n...[diff truncated at 200KB]` : diff;

    const issues = closing.map((n) => {
      try {
        const raw = gh(["issue", "view", String(n), "--repo", repo, "--json", "number,title,body,state"]);
        return JSON.parse(raw);
      } catch (err) {
        return { number: n, title: "(could not fetch)", body: "", state: "unknown", error: String(err) };
      }
    });

    const issuesBlock = issues
      .map((i) => `### Issue #${i.number} — ${i.title} (currently: ${i.state})\n${buildIssueExcerpt(i)}`)
      .join("\n\n---\n\n");

    const prompt = stripNullBytes(`You are checking whether a pull request's diff actually implements what it claims to close.

The PR body references these issues via "Closes #N" / "Fixes #N" / "Resolves #N":
${closing.map((n) => `#${n}`).join(", ")}

Files changed in this PR:
${changedPaths.map((p) => `- ${p}`).join("\n")}

Issue details (title, and either the Problem paragraph + Acceptance section, or the full body):
${issuesBlock}

The diff:
${cappedDiff}

For EACH referenced issue, decide one of:
- DELIVERED: the diff contains code (not just tests, not just docs) that plausibly implements the issue's described behavior/acceptance criteria.
- PARTIAL: the diff touches related code but doesn't clearly satisfy the issue's stated acceptance criteria, or only adds tests/docs without a source fix.
- NOT DELIVERED: nothing in the changed files relates to the issue's scope at all.
- ALREADY CLOSED: the issue's state is already "closed" — merging this PR re-closing it is redundant, not a delivery claim worth verifying.

Be skeptical: a PR claiming to close an issue with no related file changes is NOT DELIVERED, full stop. Do not give benefit of the doubt to vague or superficial changes.

Output ONLY a markdown table with columns: Issue | Verdict | Why (one sentence). Then, if any issue is NOT DELIVERED or PARTIAL, add a short "## Risk" section below the table explaining that merging this PR will auto-close those issues on GitHub regardless of whether the work is done, since the PR body references them. Keep the whole response under 400 words. No preamble, no other sections.`);

    console.log(`Running Claude Code over ${closing.length} referenced issue(s)...`);
    verdictSection = execFileSync("claude", ["-p", "--output-format", "text"], {
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
      input: prompt,
    }).trim();
  }

  const commentBody = `${MARKER}\n## Acceptance-criteria check\n\n${closing.length > 0 ? "Automated cross-check of this PR's `Closes #N` claims against its actual diff.\n\n" : ""}${verdictSection}${referencingSection}\n\n<sub>This is a heuristic LLM read, not a substitute for human review — it can miss context the issue doesn't spell out.</sub>`;

  // `gh pr view --json comments` returns each comment's GraphQL node id (e.g. "IC_kwD..."),
  // which the REST comment-update endpoint below 404s on — it needs the plain numeric id. List
  // via the REST API directly instead, so `prior.id` is already in the shape the PATCH needs.
  const existing = JSON.parse(gh(["api", `repos/${repo}/issues/${prNumber}/comments`, "-f", "per_page=100"]));
  const prior = existing.find((c) => typeof c.body === "string" && c.body.includes(MARKER));

  if (prior) {
    gh(
      [
        "api",
        `repos/${repo}/issues/comments/${prior.id}`,
        "-X",
        "PATCH",
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        "Content-Type: application/json",
        "--input",
        "-",
      ],
      JSON.stringify({ body: commentBody })
    );
    console.log("Updated existing acceptance-criteria comment.");
  } else {
    gh(["pr", "comment", String(prNumber), "--repo", repo, "--body", commentBody]);
    console.log("Posted new acceptance-criteria comment.");
  }
}

// Guarded so the test file can import the exported functions without running main() (which
// requires GITHUB_EVENT_PATH and the gh/claude CLIs) as a side effect of the import.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
