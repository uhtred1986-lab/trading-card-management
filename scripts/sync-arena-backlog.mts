import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

interface IssueMeta {
  file: string;
  filePath: string;
  title: string;
  milestone: string;
  labels: string[];
  stage: string;
  tracking: boolean;
  status?: string;
  closedAt?: string;
  body: string;
}

interface GhIssue {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
}

const DEFAULT_REPO = "uhtred1986-lab/trading-card-management";

function parseArgs() {
  const args = process.argv.slice(2);
  let repo = DEFAULT_REPO;
  let dryRun = false;
  let sync = false;
  let allClosed = false;
  const closeIds: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--sync") sync = true;
    else if (a === "--all-closed") allClosed = true;
    else if (a === "--repo" && args[i + 1]) {
      repo = args[++i];
    } else if (a === "--close" && args[i + 1]) {
      closeIds.push(...args[++i].split(",").map((s) => s.trim()));
    } else if (!a.startsWith("-")) {
      closeIds.push(a);
    }
  }

  return { repo, dryRun, sync, allClosed, closeIds };
}

function getAuthToken(): string | null {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

function hasGhCli(): boolean {
  try {
    execSync("gh --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function ghFetch(
  endpoint: string,
  repo: string,
  options: { method?: string; body?: any } = {}
) {
  const token = getAuthToken();
  const method = options.method || "GET";

  if (token) {
    const url = endpoint.startsWith("https://")
      ? endpoint
      : `https://api.github.com/${endpoint.replace(/^\//, "")}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "arena-backlog-sync",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`GitHub API error (${res.status} ${res.statusText}): ${errText}`);
    }
    return res.json();
  }

  if (hasGhCli()) {
    const jsonStr = options.body ? JSON.stringify(options.body) : "";
    const escaped = jsonStr ? `--input -` : "";
    const cmd = `gh api ${endpoint} --method ${method} ${escaped}`;
    const out = execSync(cmd, {
      input: jsonStr || undefined,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return out ? JSON.parse(out) : null;
  }

  throw new Error(
    "Authentication required: Please set GITHUB_TOKEN or GH_TOKEN, or run 'gh auth login' with GitHub CLI."
  );
}

function readIssueFile(filePath: string): IssueMeta {
  const text = fs.readFileSync(filePath, "utf-8");
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") throw new Error(`${filePath}: missing front matter`);

  const meta: Record<string, string> = {};
  let i = 1;
  while (i < lines.length && lines[i] !== "---") {
    const line = lines[i];
    const idx = line.indexOf(":");
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    i++;
  }
  if (i >= lines.length) throw new Error(`${filePath}: front matter never closed`);

  const body = lines.slice(i + 1).join("\n").trim();
  const file = path.basename(filePath);

  return {
    file,
    filePath,
    title: meta.title || "",
    milestone: meta.milestone || "",
    labels: (meta.labels || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    stage: meta.stage || "",
    tracking: meta.tracking === "true",
    status: meta.status,
    closedAt: meta.closed_at,
    body,
  };
}

function loadAllIssues(dir: string): IssueMeta[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  return files.map((f) => readIssueFile(path.join(dir, f)));
}

async function listRemoteIssues(repo: string): Promise<GhIssue[]> {
  try {
    const data = await ghFetch(`repos/${repo}/issues?state=all&per_page=100`, repo);
    return (data as any[]).map((d) => ({
      number: d.number,
      title: d.title,
      state: d.state === "closed" ? "CLOSED" : "OPEN",
    }));
  } catch (err: any) {
    console.warn(`[warn] Could not list remote issues directly: ${err.message}`);
    return [];
  }
}

async function closeIssue(
  issue: IssueMeta,
  remoteIssue: GhIssue | undefined,
  repo: string,
  dryRun: boolean
) {
  console.log(`\nClosing issue: ${issue.file}`);
  console.log(`  Title: "${issue.title}"`);
  if (remoteIssue) {
    console.log(`  Matched GitHub issue #${remoteIssue.number} (${remoteIssue.state})`);
  } else {
    console.log(`  Warning: No matching remote issue found by title.`);
  }

  // Extract closing commentary or verification checklist from the file body
  const closingLines = issue.body
    .split(/\r?\n/)
    .filter((l) => l.startsWith("- [x]") || l.includes("Acceptance.") || l.includes("Verification Checklist"));
  const closingComment = [
    `### Verified and Completed`,
    `Completed and verified in the codebase repository.`,
    ``,
    `**Acceptance / Verification details:**`,
    closingLines.length > 0 ? closingLines.join("\n") : issue.body.slice(-500),
  ].join("\n");

  if (dryRun) {
    console.log(`  [dry-run] Would close #${remoteIssue?.number ?? "?"} on ${repo}`);
    console.log(`  [dry-run] Closing comment preview:\n${closingComment.slice(0, 300)}...`);
    return;
  }

  if (remoteIssue) {
    // 1. Post completion comment
    console.log(`  Posting acceptance comment to #${remoteIssue.number}...`);
    await ghFetch(`repos/${repo}/issues/${remoteIssue.number}/comments`, repo, {
      method: "POST",
      body: { body: closingComment },
    });

    // 2. Close the issue
    console.log(`  Closing #${remoteIssue.number}...`);
    await ghFetch(`repos/${repo}/issues/${remoteIssue.number}`, repo, {
      method: "PATCH",
      body: { state: "closed", state_reason: "completed" },
    });
    console.log(`  Issue #${remoteIssue.number} successfully closed.`);
  }
}

async function main() {
  const { repo, dryRun, sync, allClosed, closeIds } = parseArgs();
  const issueDir = path.resolve(process.cwd(), "docs/arena-backlog");

  console.log(`========================================`);
  console.log(`Arena Backlog Sync & Issue Closure Tool`);
  console.log(`Repository: ${repo}`);
  console.log(`Dry Run:    ${dryRun}`);
  console.log(`========================================`);

  const issues = loadAllIssues(issueDir);
  console.log(`Found ${issues.length} local backlog issue files.`);

  let remoteIssues: GhIssue[] = [];
  const token = getAuthToken();
  const ghAvailable = hasGhCli();

  if (token || ghAvailable) {
    console.log(`Authenticating via ${token ? "GITHUB_TOKEN" : "gh CLI"}...`);
    remoteIssues = await listRemoteIssues(repo);
    console.log(`Found ${remoteIssues.length} remote issues on GitHub.`);
  } else {
    console.log(`[info] No GITHUB_TOKEN or gh CLI found. Running in offline / reporting mode.`);
  }

  // Determine which issues to close
  const targetsToClose: IssueMeta[] = [];

  if (allClosed) {
    for (const issue of issues) {
      if (issue.status === "closed" || issue.labels.includes("done")) {
        targetsToClose.push(issue);
      }
    }
  } else if (closeIds.length > 0) {
    for (const id of closeIds) {
      const match = issues.find(
        (i) =>
          i.file.startsWith(id) ||
          i.file === id ||
          i.title.toLowerCase().includes(id.toLowerCase())
      );
      if (match) {
        targetsToClose.push(match);
      } else {
        console.warn(`[warn] No local issue file matching "${id}" found.`);
      }
    }
  }

  if (targetsToClose.length > 0) {
    console.log(`\nProcessing ${targetsToClose.length} issues to mark as done:`);
    for (const issue of targetsToClose) {
      const remote = remoteIssues.find((r) => r.title.trim() === issue.title.trim());
      await closeIssue(issue, remote, repo, dryRun);
    }
  }

  if (sync && (token || ghAvailable)) {
    console.log(`\nRe-evaluating tracking issues...`);
    // Find tracking issues and update them
    for (const trackingIssue of issues.filter((i) => i.tracking)) {
      const remote = remoteIssues.find((r) => r.title.trim() === trackingIssue.title.trim());
      if (remote) {
        console.log(`  Updating tracking issue #${remote.number}: "${trackingIssue.title}"`);
      }
    }
  }

  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error(`\nError:`, err.message);
  process.exit(1);
});
