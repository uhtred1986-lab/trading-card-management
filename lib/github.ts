import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export interface GitHubIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  body?: string;
  html_url: string;
  labels: Array<{ name: string; color?: string } | string>;
  milestone?: { title: string; number: number } | null;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
}

export interface BacklogItem {
  file: string;
  filePath: string;
  id: string; // e.g., "s2-01", "ui-101"
  title: string;
  milestone: string;
  labels: string[];
  stage: string;
  tracking: boolean;
  status: "open" | "closed" | "in progress" | "ready" | "queued" | string;
  closedAt?: string;
  body: string;
  githubIssueNumber?: number;
  githubUrl?: string;
  githubState?: "open" | "closed";
}

export interface FeedbackItem {
  id: number;
  kind: string;
  note: string;
  status: string;
  cardId?: string | null;
  skillIndex?: number | null;
  gameId?: number | null;
  turn?: number;
  phase?: string | null;
  prompt?: string | null;
  resolution?: string | null;
  reportedBy?: string | null;
  createdAt: Date | string;
  githubIssueNumber?: number;
  githubUrl?: string;
  githubState?: "open" | "closed";
}

export interface SyncResult {
  total: number;
  created: number;
  updated: number;
  closed: number;
  errors: Array<{ id: string | number; error: string }>;
}

export const DEFAULT_REPO = "uhtred1986-lab/trading-card-management";

/**
 * Returns GitHub integration configuration from environment variables.
 */
export function getGitHubConfig() {
  const repo = process.env.GITHUB_REPO || process.env.GH_REPO || DEFAULT_REPO;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
  return {
    repo,
    token,
    baseUrl: "https://api.github.com",
    hasAuth: Boolean(token),
  };
}

/**
 * Builds the canonical web URL for a GitHub repository.
 */
export function getRepoUrl(repo?: string): string {
  const r = repo || getGitHubConfig().repo;
  return `https://github.com/${r}`;
}

/**
 * Builds the canonical web URL for an issue in the repository.
 */
export function getIssueUrl(issueNumber: number, repo?: string): string {
  const r = repo || getGitHubConfig().repo;
  return `https://github.com/${r}/issues/${issueNumber}`;
}

/**
 * Builds a web URL to create a prefilled new issue on GitHub.
 */
export function getNewIssueUrl(
  params: {
    title?: string;
    body?: string;
    labels?: string[];
    milestone?: string;
  },
  repo?: string
): string {
  const r = repo || getGitHubConfig().repo;
  const searchParams = new URLSearchParams();
  if (params.title) searchParams.set("title", params.title);
  if (params.body) searchParams.set("body", params.body);
  if (params.labels && params.labels.length > 0) searchParams.set("labels", params.labels.join(","));
  if (params.milestone) searchParams.set("milestone", params.milestone);
  const q = searchParams.toString();
  return `https://github.com/${r}/issues/new${q ? `?${q}` : ""}`;
}

function hasGhCli(): boolean {
  try {
    execSync("gh --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Core GitHub API fetcher with token support and CLI fallback.
 */
export async function ghFetch<T = unknown>(
  endpoint: string,
  repo?: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const cfg = getGitHubConfig();
  const targetRepo = repo || cfg.repo;
  const method = options.method || "GET";
  const url = endpoint.startsWith("https://")
    ? endpoint
    : `${cfg.baseUrl}/${endpoint.replace(/^\//, "").replace("{repo}", targetRepo)}`;

  if (cfg.token) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "arena-backlog-sync",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`GitHub API ${res.status} (${res.statusText}): ${errText}`);
    }

    if (res.status === 204) {
      return null as T;
    }
    return res.json() as Promise<T>;
  }

  // Fallback to GitHub CLI if available
  if (hasGhCli()) {
    const jsonStr = options.body ? JSON.stringify(options.body) : "";
    const cleanEndpoint = endpoint.replace(/^\//, "").replace("{repo}", targetRepo);
    const escaped = jsonStr ? `--input -` : "";
    const cmd = `gh api ${cleanEndpoint} --method ${method} ${escaped}`;
    const out = execSync(cmd, {
      input: jsonStr || undefined,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return out ? JSON.parse(out) : (null as T);
  }

  // Public unauthenticated fallback for read-only requests
  if (method === "GET") {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "arena-backlog-sync",
      },
    });
    if (res.ok) {
      return res.json() as Promise<T>;
    }
  }

  throw new Error("GitHub authentication required: please set GITHUB_TOKEN or GH_TOKEN.");
}

// In-memory cache for remote issues
let issueCache: { data: GitHubIssue[]; timestamp: number; repo: string } | null = null;
const CACHE_TTL_MS = 60 * 1000;

/**
 * Lists all remote issues from GitHub with pagination and memory caching.
 */
export async function listRemoteIssues(
  repo?: string,
  options: { state?: "all" | "open" | "closed"; forceRefresh?: boolean; maxPages?: number } = {}
): Promise<GitHubIssue[]> {
  const targetRepo = repo || getGitHubConfig().repo;
  const maxPages = options.maxPages ?? 4;
  const now = Date.now();

  if (!options.forceRefresh && issueCache && issueCache.repo === targetRepo && now - issueCache.timestamp < CACHE_TTL_MS) {
    if (options.state && options.state !== "all") {
      return issueCache.data.filter((i) => i.state === options.state);
    }
    return issueCache.data;
  }

  try {
    const all: GitHubIssue[] = [];
    let page = 1;
    while (page <= maxPages) {
      const data = await ghFetch<Array<{
        number: number;
        title: string;
        state: string;
        body?: string;
        html_url: string;
        labels?: Array<{ name: string }>;
        milestone?: { title: string; number: number } | null;
        created_at?: string;
        updated_at?: string;
        closed_at?: string | null;
      }>>(`repos/${targetRepo}/issues?state=all&per_page=100&page=${page}`, targetRepo);

      if (!Array.isArray(data) || data.length === 0) break;
      for (const d of data) {
        all.push({
          number: d.number,
          title: d.title,
          state: d.state.toLowerCase() === "closed" ? "closed" : "open",
          body: d.body,
          html_url: d.html_url || getIssueUrl(d.number, targetRepo),
          labels: (d.labels || []).map((l) => l.name),
          milestone: d.milestone ? { title: d.milestone.title, number: d.milestone.number } : null,
          created_at: d.created_at,
          updated_at: d.updated_at,
          closed_at: d.closed_at,
        });
      }
      if (data.length < 100) break;
      page++;
    }

    issueCache = { data: all, timestamp: now, repo: targetRepo };

    if (options.state && options.state !== "all") {
      return all.filter((i) => i.state === options.state);
    }
    return all;
  } catch (err) {
    console.warn("[github] Could not list remote issues from GitHub:", err instanceof Error ? err.message : String(err));
    if (issueCache && issueCache.repo === targetRepo) {
      return issueCache.data;
    }
    return [];
  }
}

/**
 * Creates a new GitHub issue in the repository.
 */
export async function createGitHubIssue(
  data: {
    title: string;
    body: string;
    labels?: string[];
    milestone?: number | string;
  },
  repo?: string
): Promise<GitHubIssue> {
  const targetRepo = repo || getGitHubConfig().repo;
  const created = await ghFetch<{
    number: number;
    title: string;
    state: string;
    body?: string;
    html_url: string;
    labels?: Array<{ name: string }>;
    milestone?: { title: string; number: number } | null;
  }>(`repos/${targetRepo}/issues`, targetRepo, {
    method: "POST",
    body: {
      title: data.title,
      body: data.body,
      labels: data.labels,
      ...(typeof data.milestone === "number" ? { milestone: data.milestone } : {}),
    },
  });

  const issue: GitHubIssue = {
    number: created.number,
    title: created.title,
    state: created.state.toLowerCase() === "closed" ? "closed" : "open",
    body: created.body,
    html_url: created.html_url || getIssueUrl(created.number, targetRepo),
    labels: (created.labels || []).map((l) => l.name),
    milestone: created.milestone,
  };

  // Update in-memory cache
  if (issueCache && issueCache.repo === targetRepo) {
    issueCache.data.unshift(issue);
  }

  return issue;
}

/**
 * Updates an existing GitHub issue.
 */
export async function updateGitHubIssue(
  issueNumber: number,
  data: {
    title?: string;
    body?: string;
    state?: "open" | "closed";
    state_reason?: "completed" | "not_planned" | "reopened";
    labels?: string[];
    milestone?: number | null;
  },
  repo?: string
): Promise<GitHubIssue> {
  const targetRepo = repo || getGitHubConfig().repo;
  const updated = await ghFetch<{
    number: number;
    title: string;
    state: string;
    body?: string;
    html_url: string;
    labels?: Array<{ name: string }>;
    milestone?: { title: string; number: number } | null;
  }>(`repos/${targetRepo}/issues/${issueNumber}`, targetRepo, {
    method: "PATCH",
    body: data,
  });

  const issue: GitHubIssue = {
    number: updated.number,
    title: updated.title,
    state: updated.state.toLowerCase() === "closed" ? "closed" : "open",
    body: updated.body,
    html_url: updated.html_url || getIssueUrl(updated.number, targetRepo),
    labels: (updated.labels || []).map((l) => l.name),
    milestone: updated.milestone,
  };

  if (issueCache && issueCache.repo === targetRepo) {
    const idx = issueCache.data.findIndex((i) => i.number === issueNumber);
    if (idx >= 0) {
      issueCache.data[idx] = issue;
    }
  }

  return issue;
}

/**
 * Posts a comment on an issue and optionally marks it as closed.
 */
export async function closeGitHubIssue(
  issueNumber: number,
  closingComment?: string,
  repo?: string
): Promise<void> {
  const targetRepo = repo || getGitHubConfig().repo;
  if (closingComment) {
    await postIssueComment(issueNumber, closingComment, targetRepo);
  }
  await updateGitHubIssue(issueNumber, { state: "closed", state_reason: "completed" }, targetRepo);
}

/**
 * Posts a comment to a GitHub issue.
 */
export async function postIssueComment(
  issueNumber: number,
  comment: string,
  repo?: string
): Promise<void> {
  const targetRepo = repo || getGitHubConfig().repo;
  await ghFetch(`repos/${targetRepo}/issues/${issueNumber}/comments`, targetRepo, {
    method: "POST",
    body: { body: comment },
  });
}

/**
 * Reads and parses an arena backlog markdown file with YAML front matter.
 */
export function readBacklogFile(filePath: string): BacklogItem {
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
  const id = file.replace(/\.md$/, "").replace(/-(.*)$/, "");

  return {
    file,
    filePath,
    id,
    title: meta.title || "",
    milestone: meta.milestone || "",
    labels: (meta.labels || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    stage: meta.stage || "",
    tracking: meta.tracking === "true",
    status: meta.status || "open",
    closedAt: meta.closed_at,
    body,
  };
}

/**
 * Loads all local backlog items from docs/arena-backlog.
 */
export function loadAllBacklogItems(backlogDir?: string): BacklogItem[] {
  const dir = backlogDir || path.resolve(process.cwd(), "docs/arena-backlog");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  return files.map((f) => readBacklogFile(path.join(dir, f)));
}

/**
 * Loads all backlog items and enriches them with linked GitHub issue numbers and URLs.
 */
export async function getBacklogItemsWithGitHub(
  options: { repo?: string; remoteIssues?: GitHubIssue[]; fetchRemote?: boolean } = {}
): Promise<BacklogItem[]> {
  const repo = options.repo || getGitHubConfig().repo;
  const items = loadAllBacklogItems();
  const remote = options.remoteIssues || (options.fetchRemote !== false ? await listRemoteIssues(repo) : []);

  return items.map((item) => {
    // 1. Direct match by exact title
    const match = remote.find((r) => r.title.trim().toLowerCase() === item.title.trim().toLowerCase());
    if (match) {
      return {
        ...item,
        githubIssueNumber: match.number,
        githubUrl: match.html_url || getIssueUrl(match.number, repo),
        githubState: match.state,
      };
    }

    // 2. Match by file prefix number if encoded in filename (e.g. ui-101 -> #101)
    const numMatch = item.file.match(/^(?:ui|s\d+)-(\d+)/);
    if (numMatch) {
      const candidateNum = parseInt(numMatch[1], 10);
      const numMatched = remote.find((r) => r.number === candidateNum);
      if (numMatched) {
        return {
          ...item,
          githubIssueNumber: numMatched.number,
          githubUrl: numMatched.html_url || getIssueUrl(numMatched.number, repo),
          githubState: numMatched.state,
        };
      }
    }

    return item;
  });
}

/**
 * Formats a title for a feedback item synced to GitHub.
 */
export function formatFeedbackIssueTitle(feedback: { id: number; kind: string; note: string }): string {
  const cleanNote = feedback.note.replace(/\r?\n/g, " ").trim();
  const snippet = cleanNote.length > 70 ? `${cleanNote.slice(0, 67)}...` : cleanNote;
  return `[Feedback #${feedback.id}] (${feedback.kind}): ${snippet}`;
}

/**
 * Formats a GitHub issue markdown body for a feedback item.
 */
export function formatFeedbackIssueBody(feedback: FeedbackItem, repo?: string): string {
  const r = repo || getGitHubConfig().repo;
  let reportedDateStr = "N/A";
  if (feedback.createdAt) {
    try {
      const d = new Date(feedback.createdAt);
      if (!isNaN(d.getTime())) {
        reportedDateStr = `${d.toISOString().replace("T", " ").slice(0, 16)} UTC`;
      }
    } catch {
      reportedDateStr = String(feedback.createdAt);
    }
  }

  const lines: string[] = [
    `### Arena Feedback #${feedback.id}`,
    ``,
    `**Kind:** \`${feedback.kind}\`  `,
    `**Status:** \`${feedback.status}\`  `,
    `**Reported:** ${reportedDateStr}  `,
    feedback.reportedBy ? `**Reported by:** ${feedback.reportedBy}  ` : ``,
    feedback.cardId ? `**Card:** [${feedback.cardId}](https://github.com/${r})  ` : ``,
    feedback.gameId ? `**Game:** #${feedback.gameId} (turn ${feedback.turn ?? 0}${feedback.phase ? `, ${feedback.phase}` : ""})  ` : ``,
    feedback.prompt ? `**Prompt Waiting:** ${feedback.prompt}  ` : ``,
    ``,
    `#### User Note`,
    `> ${feedback.note.replace(/\n/g, "\n> ")}`,
    ``,
  ];

  if (feedback.resolution) {
    lines.push(`#### Resolution`, `${feedback.resolution}`, ``);
  }

  lines.push(`---`, `*Synced automatically from Arena Feedback table.*`);
  return lines.filter(Boolean).join("\n");
}

/**
 * Looks for an existing GitHub issue matching a feedback item.
 */
export function matchFeedbackToGitHubIssue(
  feedback: { id: number },
  remoteIssues: GitHubIssue[]
): GitHubIssue | undefined {
  const prefix = `[Feedback #${feedback.id}]`;
  const altPrefix = `Feedback #${feedback.id}`;
  return remoteIssues.find((issue) => issue.title.includes(prefix) || issue.title.includes(altPrefix));
}

/**
 * Returns the GitHub URL and status for a feedback item.
 * If an existing issue is found, returns the direct issue link.
 * If not, returns a pre-filled GitHub new issue creation link.
 */
export function getFeedbackGitHubLink(
  feedback: FeedbackItem,
  remoteIssues: GitHubIssue[] = [],
  repo?: string
): {
  url: string;
  issueNumber?: number;
  isExisting: boolean;
  state?: "open" | "closed";
} {
  const targetRepo = repo || getGitHubConfig().repo;
  const match = matchFeedbackToGitHubIssue(feedback, remoteIssues);

  if (match) {
    return {
      url: match.html_url || getIssueUrl(match.number, targetRepo),
      issueNumber: match.number,
      isExisting: true,
      state: match.state,
    };
  }

  // Pre-filled new issue URL fallback
  const title = formatFeedbackIssueTitle(feedback);
  const body = formatFeedbackIssueBody(feedback, targetRepo);
  const labels = ["feedback", "area:arena-ui", feedback.kind === "bug" ? "bug" : "enhancement"];

  return {
    url: getNewIssueUrl({ title, body, labels }, targetRepo),
    isExisting: false,
  };
}

/**
 * Syncs a single feedback item to GitHub: creates it if missing, or updates its status (closed/reopened).
 */
export async function syncFeedbackItem(
  feedback: FeedbackItem,
  repo?: string
): Promise<{ issue: GitHubIssue; action: "created" | "updated" | "closed" | "noop" }> {
  const targetRepo = repo || getGitHubConfig().repo;
  const remote = await listRemoteIssues(targetRepo, { forceRefresh: true });
  const existing = matchFeedbackToGitHubIssue(feedback, remote);

  const desiredState = feedback.status === "fixed" ? "closed" : "open";
  const title = formatFeedbackIssueTitle(feedback);
  const body = formatFeedbackIssueBody(feedback, targetRepo);
  const labels = ["feedback", "area:arena-ui", feedback.kind === "bug" ? "bug" : "enhancement"];

  if (!existing) {
    const created = await createGitHubIssue(
      {
        title,
        body,
        labels,
      },
      targetRepo
    );

    if (desiredState === "closed") {
      await updateGitHubIssue(created.number, { state: "closed", state_reason: "completed" }, targetRepo);
      created.state = "closed";
    }

    return { issue: created, action: "created" };
  }

  // If issue exists, check if state needs sync
  if (existing.state !== desiredState) {
    const updated = await updateGitHubIssue(
      existing.number,
      {
        state: desiredState,
        state_reason: desiredState === "closed" ? "completed" : "reopened",
      },
      targetRepo
    );
    return { issue: updated, action: desiredState === "closed" ? "closed" : "updated" };
  }

  return { issue: existing, action: "noop" };
}

/**
 * Syncs multiple feedback items to GitHub issues.
 */
export async function syncAllFeedbackItems(
  feedbackList: FeedbackItem[],
  repo?: string
): Promise<SyncResult> {
  const targetRepo = repo || getGitHubConfig().repo;
  let created = 0;
  let updated = 0;
  let closed = 0;
  const errors: Array<{ id: number; error: string }> = [];

  for (const item of feedbackList) {
    try {
      const res = await syncFeedbackItem(item, targetRepo);
      if (res.action === "created") created++;
      else if (res.action === "updated") updated++;
      else if (res.action === "closed") closed++;
    } catch (err) {
      errors.push({ id: item.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    total: feedbackList.length,
    created,
    updated,
    closed,
    errors,
  };
}

/**
 * Synchronizes local backlog issue files with GitHub issues.
 * Closes remote issues for completed backlog items and updates tracking issues.
 */
export async function syncBacklogIssues(
  options: {
    repo?: string;
    dryRun?: boolean;
    allClosed?: boolean;
    closeIds?: string[];
  } = {}
): Promise<{ closed: number; updated: number; total: number }> {
  const targetRepo = options.repo || getGitHubConfig().repo;
  const remoteIssues = await listRemoteIssues(targetRepo, { forceRefresh: true });
  const backlogItems = loadAllBacklogItems();

  let closedCount = 0;
  const updatedCount = 0;

  const targetsToClose: BacklogItem[] = [];

  if (options.allClosed) {
    for (const item of backlogItems) {
      if (item.status === "closed" || item.labels.includes("done")) {
        targetsToClose.push(item);
      }
    }
  } else if (options.closeIds && options.closeIds.length > 0) {
    for (const id of options.closeIds) {
      const match = backlogItems.find(
        (i) => i.file.startsWith(id) || i.id === id || i.title.toLowerCase().includes(id.toLowerCase())
      );
      if (match) targetsToClose.push(match);
    }
  }

  for (const item of targetsToClose) {
    const remote = remoteIssues.find((r) => r.title.trim() === item.title.trim());
    if (remote && remote.state === "open") {
      if (!options.dryRun) {
        const closingComment = `### Verified and Completed\nCompleted and verified in the codebase repository.\n\n${item.body.slice(-400)}`;
        await closeGitHubIssue(remote.number, closingComment, targetRepo);
      }
      closedCount++;
    }
  }

  return {
    total: backlogItems.length,
    closed: closedCount,
    updated: updatedCount,
  };
}
