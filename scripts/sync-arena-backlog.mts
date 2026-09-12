import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  expandChildren,
  findRemoteMatch,
  loadAllIssues,
  missingSourcePaths,
  statusMismatch,
  withIssueNumber,
  type BacklogGhClient,
  type GhIssue,
  type GhMilestone,
  type IssueCreate,
  type IssueMeta,
  type IssuePatch,
} from "./lib/arena-backlog";

const DEFAULT_REPO = "uhtred1986-lab/trading-card-management";

interface Options {
  repo: string;
  dryRun: boolean;
  sync: boolean;
  check: boolean;
  allClosed: boolean;
  push: boolean;
  pushFiles: string[];
  closeIds: string[];
}

function parseArgs(argv: string[]): Options {
  const args = argv.slice(2);
  const opts: Options = {
    repo: DEFAULT_REPO,
    dryRun: false,
    sync: false,
    check: false,
    allClosed: false,
    push: false,
    pushFiles: [],
    closeIds: [],
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--sync") opts.sync = true;
    else if (a === "--check") opts.check = true;
    else if (a === "--all-closed") opts.allClosed = true;
    else if (a === "--push") {
      opts.push = true;
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        opts.pushFiles.push(args[++i]);
      }
    } else if (a === "--repo" && args[i + 1]) {
      opts.repo = args[++i];
    } else if (a === "--close" && args[i + 1]) {
      opts.closeIds.push(...args[++i].split(",").map((s) => s.trim()));
    } else if (!a.startsWith("-")) {
      opts.closeIds.push(a);
    }
  }

  return opts;
}

// ── GitHub access: GITHUB_TOKEN/GH_TOKEN over the REST API, `gh api` as the fallback ──

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
  options: { method?: string; body?: unknown } = {}
): Promise<unknown> {
  const token = getAuthToken();
  const method = options.method || "GET";

  if (token) {
    const url = endpoint.startsWith("https://") ? endpoint : `https://api.github.com/${endpoint.replace(/^\//, "")}`;
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
    return res.status === 204 ? null : res.json();
  }

  if (hasGhCli()) {
    const jsonStr = options.body ? JSON.stringify(options.body) : "";
    const out = execSync(`gh api ${endpoint} --method ${method} ${jsonStr ? "--input -" : ""}`, {
      input: jsonStr || undefined,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return out ? JSON.parse(out) : null;
  }

  throw new Error(
    "Authentication required: set GITHUB_TOKEN or GH_TOKEN, or run 'gh auth login' with the GitHub CLI."
  );
}

/** The real `BacklogGhClient`, talking to `repo` over `ghFetch`. */
function createRealGhClient(repo: string): BacklogGhClient {
  return {
    async listIssues(): Promise<GhIssue[]> {
      const all: GhIssue[] = [];
      for (let page = 1; page <= 10; page++) {
        const data = await ghFetch(`repos/${repo}/issues?state=all&per_page=100&page=${page}`);
        if (!Array.isArray(data) || data.length === 0) break;
        for (const d of data) {
          // The issues endpoint also returns PRs; a PR carries `pull_request`.
          if (d.pull_request) continue;
          all.push({ number: d.number, title: d.title, state: d.state === "closed" ? "CLOSED" : "OPEN" });
        }
        if (data.length < 100) break;
      }
      return all;
    },

    async listMilestones(): Promise<GhMilestone[]> {
      const data = await ghFetch(`repos/${repo}/milestones?state=all&per_page=100`);
      if (!Array.isArray(data)) return [];
      return data.map((m) => ({ number: m.number, title: m.title }));
    },

    async createMilestone(title: string): Promise<GhMilestone> {
      const created = (await ghFetch(`repos/${repo}/milestones`, {
        method: "POST",
        body: { title, state: "open" },
      })) as { number: number; title: string };
      return { number: created.number, title: created.title };
    },

    async createIssue(input: IssueCreate): Promise<GhIssue> {
      const created = (await ghFetch(`repos/${repo}/issues`, {
        method: "POST",
        body: { title: input.title, body: input.body, labels: input.labels, milestone: input.milestone },
      })) as { number: number; title: string; state: string };
      return { number: created.number, title: created.title, state: created.state === "closed" ? "CLOSED" : "OPEN" };
    },

    async updateIssue(number: number, patch: IssuePatch): Promise<void> {
      await ghFetch(`repos/${repo}/issues/${number}`, { method: "PATCH", body: patch });
    },

    async addComment(number: number, body: string): Promise<void> {
      await ghFetch(`repos/${repo}/issues/${number}/comments`, { method: "POST", body: { body } });
    },
  };
}

// ── shared helpers ──────────────────────────────────────────────────────────

async function resolveMilestoneNumber(
  client: BacklogGhClient,
  title: string,
  cache: Map<string, number>,
  dryRun: boolean
): Promise<number | undefined> {
  if (cache.has(title)) return cache.get(title);
  if (cache.size === 0) {
    for (const m of await client.listMilestones()) cache.set(m.title, m.number);
  }
  if (cache.has(title)) return cache.get(title);
  if (dryRun) {
    console.log(`  [dry] would create milestone: ${title}`);
    return undefined;
  }
  const created = await client.createMilestone(title);
  cache.set(title, created.number);
  console.log(`  milestone created: ${title}`);
  return created.number;
}

function writeIssueNumberBack(meta: IssueMeta, issueNumber: number, dryRun: boolean) {
  if (meta.issue === issueNumber) return;
  if (dryRun) {
    console.log(`  [dry] would write 'issue: ${issueNumber}' into ${meta.file}`);
    return;
  }
  const text = fs.readFileSync(meta.filePath, "utf-8");
  const { text: next, changed } = withIssueNumber(text, issueNumber);
  if (changed) {
    fs.writeFileSync(meta.filePath, next, "utf-8");
    console.log(`  wrote 'issue: ${issueNumber}' into ${meta.file}`);
  }
}

// ── --push: local file → GitHub issue ───────────────────────────────────────

async function pushOne(
  meta: IssueMeta,
  client: BacklogGhClient,
  remote: GhIssue[],
  milestoneCache: Map<string, number>,
  dryRun: boolean
): Promise<void> {
  const milestoneNumber = await resolveMilestoneNumber(client, meta.milestone, milestoneCache, dryRun);
  const match = findRemoteMatch(meta, remote);

  if (!match) {
    if (dryRun) {
      console.log(`  [dry] would create: ${meta.title}  [${meta.labels.join(",")}] {${meta.milestone}}`);
      return;
    }
    const created = await client.createIssue({
      title: meta.title,
      body: meta.body,
      labels: meta.labels,
      milestone: milestoneNumber,
    });
    remote.push(created);
    console.log(`  created #${created.number}: ${meta.title}`);
    writeIssueNumberBack(meta, created.number, dryRun);
    return;
  }

  const patch: IssuePatch = { body: meta.body, labels: meta.labels, milestone: milestoneNumber ?? null };
  if (dryRun) {
    console.log(`  [dry] would PATCH #${match.number}: ${JSON.stringify(patch).slice(0, 200)}...`);
    return;
  }
  await client.updateIssue(match.number, patch);
  console.log(`  updated #${match.number}: ${meta.title}`);
  writeIssueNumberBack(meta, match.number, dryRun);
}

async function runPush(
  issues: IssueMeta[],
  files: string[],
  client: BacklogGhClient,
  dryRun: boolean
): Promise<void> {
  const targets =
    files.length === 0
      ? issues
      : issues.filter((i) => files.some((f) => i.file === path.basename(f) || i.filePath === path.resolve(f)));
  if (files.length > 0 && targets.length !== files.length) {
    const found = new Set(targets.map((t) => t.file));
    for (const f of files) {
      if (!found.has(path.basename(f))) console.warn(`[warn] no local issue file matching '${f}'`);
    }
  }

  console.log(`\nPushing ${targets.length} issue file(s)...`);
  const remote = await client.listIssues();
  const milestoneCache = new Map<string, number>();
  for (const meta of targets.filter((i) => !i.tracking)) {
    await pushOne(meta, client, remote, milestoneCache, dryRun);
  }
  // Tracking issues push last and with `{{children}}` expanded, same order as --sync.
  for (const meta of targets.filter((i) => i.tracking)) {
    const numbers = new Map(remote.map((r) => [r.title, r.number] as const));
    const body = expandChildren(meta, issues, numbers, remote);
    await pushOne({ ...meta, body }, client, remote, milestoneCache, dryRun);
  }
}

// ── --sync: rebuild every tracking issue's {{children}} from live state ────

async function runSync(issues: IssueMeta[], client: BacklogGhClient, dryRun: boolean): Promise<void> {
  console.log(`\nRe-evaluating tracking issues...`);
  const remote = await client.listIssues();
  const numbers = new Map(remote.map((r) => [r.title, r.number] as const));

  for (const tracking of issues.filter((i) => i.tracking)) {
    const match = findRemoteMatch(tracking, remote);
    const body = expandChildren(tracking, issues, numbers, remote);
    if (!match) {
      console.warn(`[warn] tracking issue not found on GitHub: "${tracking.title}"`);
      continue;
    }
    if (dryRun) {
      console.log(`  [dry] would update #${match.number}: "${tracking.title}"`);
      continue;
    }
    await client.updateIssue(match.number, { body });
    console.log(`  updated #${match.number}: "${tracking.title}"`);
  }
}

// ── --check: front-matter status vs GitHub state, and cited paths that don't exist ──

async function runCheck(issues: IssueMeta[], client: BacklogGhClient | null, root: string): Promise<boolean> {
  console.log(`\nChecking ${issues.length} backlog file(s)...`);
  let problems = 0;

  for (const meta of issues) {
    for (const { written, missing } of missingSourcePaths(meta.body, root)) {
      problems++;
      console.error(`  [path] ${meta.file}: cites \`${written}\` but '${missing}' does not exist in the tree`);
    }
  }

  let remote: GhIssue[] | null = null;
  if (client) {
    try {
      remote = await client.listIssues();
    } catch (err) {
      console.warn(
        `  [warn] could not reach the GitHub API (${err instanceof Error ? err.message : err}) — skipped status: vs issue-state comparison`
      );
    }
  } else {
    console.log(`  [info] no GitHub auth available — skipped status: vs issue-state comparison`);
  }

  if (remote) {
    for (const meta of issues) {
      const match = findRemoteMatch(meta, remote);
      if (!match) continue;
      const mismatch = statusMismatch(meta, match.state);
      if (mismatch) {
        problems++;
        console.error(`  [status] ${meta.file} (#${match.number}): ${mismatch}`);
      }
    }
  }

  if (problems === 0) {
    console.log(`  clean.`);
    return true;
  }
  console.error(`\n${problems} problem(s) found.`);
  return false;
}

// ── --close / --all-closed: unchanged behaviour, ported onto the new client ─

async function closeIssue(issue: IssueMeta, remoteIssue: GhIssue | undefined, client: BacklogGhClient, dryRun: boolean) {
  console.log(`\nClosing issue: ${issue.file}`);
  console.log(`  Title: "${issue.title}"`);
  if (remoteIssue) {
    console.log(`  Matched GitHub issue #${remoteIssue.number} (${remoteIssue.state})`);
  } else {
    console.log(`  Warning: No matching remote issue found by title.`);
  }

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
    console.log(`  [dry-run] Would close #${remoteIssue?.number ?? "?"}`);
    console.log(`  [dry-run] Closing comment preview:\n${closingComment.slice(0, 300)}...`);
    return;
  }

  if (remoteIssue) {
    console.log(`  Posting acceptance comment to #${remoteIssue.number}...`);
    await client.addComment(remoteIssue.number, closingComment);
    console.log(`  Closing #${remoteIssue.number}...`);
    await client.updateIssue(remoteIssue.number, { state: "closed", state_reason: "completed" });
    console.log(`  Issue #${remoteIssue.number} successfully closed.`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);
  const issueDir = path.resolve(process.cwd(), "docs/arena-backlog");
  const root = process.cwd();

  console.log(`========================================`);
  console.log(`Arena Backlog Sync Tool`);
  console.log(`Repository: ${opts.repo}`);
  console.log(`Dry Run:    ${opts.dryRun}`);
  console.log(`========================================`);

  const issues = loadAllIssues(issueDir);
  console.log(`Found ${issues.length} local backlog issue files.`);

  const token = getAuthToken();
  const ghAvailable = hasGhCli();
  const authed = Boolean(token || ghAvailable);
  const client = authed ? createRealGhClient(opts.repo) : null;

  if (opts.check) {
    const clean = await runCheck(issues, client, root);
    if (!clean) process.exitCode = 1;
  }

  if (opts.push) {
    if (!client) throw new Error("--push needs GITHUB_TOKEN, GH_TOKEN, or an authenticated 'gh' CLI.");
    await runPush(issues, opts.pushFiles, client, opts.dryRun);
  }

  const targetsToClose: IssueMeta[] = [];
  if (opts.allClosed) {
    for (const issue of issues) {
      if (issue.status === "closed" || issue.labels.includes("done")) targetsToClose.push(issue);
    }
  } else if (opts.closeIds.length > 0) {
    for (const id of opts.closeIds) {
      const match = issues.find(
        (i) => i.file.startsWith(id) || i.file === id || i.title.toLowerCase().includes(id.toLowerCase())
      );
      if (match) targetsToClose.push(match);
      else console.warn(`[warn] No local issue file matching "${id}" found.`);
    }
  }

  if (targetsToClose.length > 0) {
    if (!client) throw new Error("closing issues needs GITHUB_TOKEN, GH_TOKEN, or an authenticated 'gh' CLI.");
    console.log(`\nProcessing ${targetsToClose.length} issue(s) to mark as done:`);
    const remote = await client.listIssues();
    for (const issue of targetsToClose) {
      await closeIssue(issue, findRemoteMatch(issue, remote), client, opts.dryRun);
    }
  }

  if (opts.sync) {
    if (!client) throw new Error("--sync needs GITHUB_TOKEN, GH_TOKEN, or an authenticated 'gh' CLI.");
    await runSync(issues, client, opts.dryRun);
  }

  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error(`\nError:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
