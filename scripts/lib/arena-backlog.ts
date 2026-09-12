/**
 * Pure logic for the Arena backlog sync (`scripts/sync-arena-backlog.mts`),
 * split out so `scripts/verify/backlog.ts` can exercise it with no database
 * and no network. Anything that talks to GitHub lives in the script itself,
 * behind the `BacklogGhClient` interface declared here.
 */
import fs from "node:fs";
import path from "node:path";

export interface IssueMeta {
  file: string;
  filePath: string;
  /** Raw `key: value` lines of the front matter, in file order — kept so
   *  `writeIssueNumber` can round-trip a file without reformatting it. */
  frontMatter: Array<{ key: string; value: string }>;
  title: string;
  milestone: string;
  labels: string[];
  stage: string;
  tracking: boolean;
  /** `status: closed` is the only value the front matter ever carries; absent means open. */
  status?: string;
  closedAt?: string;
  /** The `issue: N` front-matter key — optional, absent until a file is first pushed. */
  issue?: number;
  body: string;
}

export interface GhIssue {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
}

export interface GhMilestone {
  number: number;
  title: string;
}

export interface IssuePatch {
  body?: string;
  labels?: string[];
  milestone?: number | null;
  state?: "open" | "closed";
  state_reason?: string;
}

export interface IssueCreate {
  title: string;
  body: string;
  labels: string[];
  milestone?: number;
}

/** Everything the sync script needs from GitHub, so tests can hand it a fake. */
export interface BacklogGhClient {
  listIssues(): Promise<GhIssue[]>;
  listMilestones(): Promise<GhMilestone[]>;
  createMilestone(title: string): Promise<GhMilestone>;
  createIssue(input: IssueCreate): Promise<GhIssue>;
  updateIssue(number: number, patch: IssuePatch): Promise<void>;
  addComment(number: number, body: string): Promise<void>;
}

const FRONT_MATTER_KEYS = ["title", "milestone", "labels", "stage"] as const;

function frontMatterValue(fm: Array<{ key: string; value: string }>, key: string): string | undefined {
  return fm.find((l) => l.key === key)?.value;
}

/** Parses one backlog file's front matter + body. Throws with the file name on malformed input. */
export function parseIssueFile(filePath: string, text: string): IssueMeta {
  const file = path.basename(filePath);
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") throw new Error(`${file}: missing front matter`);

  const frontMatter: Array<{ key: string; value: string }> = [];
  let i = 1;
  while (i < lines.length && lines[i] !== "---") {
    const line = lines[i];
    const idx = line.indexOf(":");
    if (idx < 0) throw new Error(`${file}: bad front matter line '${line}'`);
    frontMatter.push({ key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() });
    i++;
  }
  if (i >= lines.length) throw new Error(`${file}: front matter never closed`);

  for (const key of FRONT_MATTER_KEYS) {
    if (!frontMatterValue(frontMatter, key)) throw new Error(`${file}: front matter lacks '${key}'`);
  }

  const body = lines.slice(i + 1).join("\n").trim();
  const issueRaw = frontMatterValue(frontMatter, "issue");
  const issue = issueRaw ? Number.parseInt(issueRaw, 10) : undefined;
  if (issueRaw && !Number.isFinite(issue)) throw new Error(`${file}: 'issue' is not a number ('${issueRaw}')`);

  return {
    file,
    filePath,
    frontMatter,
    title: frontMatterValue(frontMatter, "title")!,
    milestone: frontMatterValue(frontMatter, "milestone")!,
    labels: (frontMatterValue(frontMatter, "labels") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    stage: frontMatterValue(frontMatter, "stage")!,
    tracking: frontMatterValue(frontMatter, "tracking") === "true",
    status: frontMatterValue(frontMatter, "status"),
    closedAt: frontMatterValue(frontMatter, "closed_at"),
    issue,
    body,
  };
}

export function loadAllIssues(dir: string): IssueMeta[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  return files
    .map((f) => path.join(dir, f))
    .map((p) => parseIssueFile(p, fs.readFileSync(p, "utf-8")));
}

/**
 * Writes `issue: N` into a file's front matter, in place, preserving every
 * other line byte-for-byte. Inserted right after `title` when the key is
 * absent; updated in place when it is already there. No-op when the value
 * would not change.
 */
export function withIssueNumber(text: string, issueNumber: number): { text: string; changed: boolean } {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") throw new Error("missing front matter");
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx < 0) throw new Error("front matter never closed");

  let issueLineIdx = -1;
  let titleLineIdx = -1;
  for (let i = 1; i < closeIdx; i++) {
    const idx = lines[i].indexOf(":");
    const key = idx >= 0 ? lines[i].slice(0, idx).trim() : "";
    if (key === "issue") issueLineIdx = i;
    if (key === "title") titleLineIdx = i;
  }

  if (issueLineIdx >= 0) {
    const newLine = `issue: ${issueNumber}`;
    if (lines[issueLineIdx] === newLine) return { text, changed: false };
    lines[issueLineIdx] = newLine;
    return { text: lines.join("\n"), changed: true };
  }

  const insertAt = titleLineIdx >= 0 ? titleLineIdx + 1 : 1;
  lines.splice(insertAt, 0, `issue: ${issueNumber}`);
  return { text: lines.join("\n"), changed: true };
}

/** Finds the GitHub issue matching a file: by `issue:` number first, exact title second. */
export function findRemoteMatch(meta: IssueMeta, remote: GhIssue[]): GhIssue | undefined {
  if (meta.issue != null) {
    const byNumber = remote.find((r) => r.number === meta.issue);
    if (byNumber) return byNumber;
  }
  return remote.find((r) => r.title.trim() === meta.title.trim());
}

/**
 * Rebuilds a tracking issue's `{{children}}` list from the current issue
 * numbers and remote state — the Node port of `import-arena-backlog.ps1`'s
 * `Expand-Children`. `numbers` maps a child's title to its GitHub issue
 * number; children with no known number print as "not created yet".
 */
export function expandChildren(
  tracking: IssueMeta,
  allIssues: IssueMeta[],
  numbers: Map<string, number>,
  remote: GhIssue[]
): string {
  const children = allIssues
    .filter((i) => !i.tracking && i.stage === tracking.stage)
    .sort((a, b) => a.file.localeCompare(b.file));

  const rows = children.map((child) => {
    const n = numbers.get(child.title);
    if (!n) return `- [ ] ${child.title} (not created yet)`;
    const state = remote.find((r) => r.number === n)?.state;
    const box = state === "CLOSED" ? "[x]" : "[ ]";
    return `- ${box} #${n} ${child.title}`;
  });

  return tracking.body.replace("{{children}}", rows.join("\n"));
}

/**
 * The paths this repo's backlog convention promises are real right now: the
 * `**Source:**` line (`docs/arena-backlog.md` §5.2, "link the exact source of
 * truth"). The `Build` section names files an issue's own work will create,
 * so it is not checked — a path there not existing yet is the point, not
 * drift. A citation whose sentence flags itself as forthcoming ("to come",
 * "not yet", "not built", "does not exist") is skipped for the same reason;
 * on the tree at the time this check was written, exactly one Source line
 * needs that (`docs/arena-ruleset-spec.md`, "`CLAUDE.md` already points at
 * ... as 'to come'").
 */
const FORTHCOMING_MARKERS = ["to come", "not yet", "not built", "does not exist", "doesn't exist"];

const PATH_RE = /`([a-zA-Z0-9_.,{}/-]*(?:src|scripts|docs)\/[a-zA-Z0-9_.,{}/-]*)`/g;

/** Expands one `{a,b,c}` brace group in a path into its alternatives (no nesting — the catalog never needs it). */
function expandBraces(p: string): string[] {
  const open = p.indexOf("{");
  if (open < 0) return [p];
  const close = p.indexOf("}", open);
  if (close < 0) return [p];
  const pre = p.slice(0, open);
  const post = p.slice(close + 1);
  const options = p.slice(open + 1, close).split(",");
  return options.map((o) => `${pre}${o}${post}`);
}

export interface CitedPath {
  /** The literal text between backticks, as written (may be a brace group). */
  written: string;
  /** Each concrete path it expands to. */
  expanded: string[];
}

/** Every path cited in a file's `**Source:**` line, minus the ones flagged as forthcoming. */
export function citedSourcePaths(body: string): CitedPath[] {
  const sourceLine = body.split(/\r?\n/).find((l) => l.startsWith("**Source:**"));
  if (!sourceLine) return [];

  const results: CitedPath[] = [];
  for (const m of sourceLine.matchAll(PATH_RE)) {
    const written = m[1];
    const start = Math.max(0, m.index! - 40);
    const end = Math.min(sourceLine.length, m.index! + m[0].length + 40);
    const context = sourceLine.slice(start, end).toLowerCase();
    if (FORTHCOMING_MARKERS.some((marker) => context.includes(marker))) continue;
    results.push({ written, expanded: expandBraces(written).map((p) => p.replace(/\/$/, "")) });
  }
  return results;
}

/** Cited paths that do not exist under `root`, one entry per missing concrete path. */
export function missingSourcePaths(
  body: string,
  root: string,
  exists: (p: string) => boolean = (p) => fs.existsSync(p)
): Array<{ written: string; missing: string }> {
  const out: Array<{ written: string; missing: string }> = [];
  for (const cited of citedSourcePaths(body)) {
    for (const candidate of cited.expanded) {
      if (!exists(path.join(root, candidate))) out.push({ written: cited.written, missing: candidate });
    }
  }
  return out;
}

/** null when the file's `status:` agrees with the issue's state (or there is nothing to compare); else an explanation. */
export function statusMismatch(meta: IssueMeta, remoteState: "OPEN" | "CLOSED" | undefined): string | null {
  if (!remoteState) return null;
  const fileClosed = meta.status === "closed";
  const remoteClosed = remoteState === "CLOSED";
  if (fileClosed === remoteClosed) return null;
  return fileClosed
    ? `front matter says status: closed, GitHub issue is ${remoteState}`
    : `GitHub issue is ${remoteState}, front matter has no status: closed`;
}
