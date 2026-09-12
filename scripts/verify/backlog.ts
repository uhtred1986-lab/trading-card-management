/**
 * Arena backlog sync — pure-function checks, no database, no network. Run
 * with `tsx` (`scripts/sync-arena-backlog.mts` is the script under test;
 * `scripts/lib/arena-backlog.ts` holds everything here that is pure enough
 * to test without a fake GitHub).
 */
import assert from "node:assert/strict";
import {
  expandChildren,
  findRemoteMatch,
  missingSourcePaths,
  parseIssueFile,
  statusMismatch,
  withIssueNumber,
  type GhIssue,
} from "../lib/arena-backlog";

// ── front-matter parsing, with and without `issue:` ─────────────────────────

const withoutIssue = parseIssueFile(
  "s9-01-example.md",
  [
    "---",
    "title: Arena: example issue",
    "milestone: Arena M9 — Example",
    "labels: backlog, ready-for-agent",
    "stage: 9",
    "---",
    "**Source:** nothing in particular.",
    "",
    "Body text.",
  ].join("\n")
);
assert.equal(withoutIssue.issue, undefined);
assert.equal(withoutIssue.title, "Arena: example issue");
assert.deepEqual(withoutIssue.labels, ["backlog", "ready-for-agent"]);
assert.equal(withoutIssue.body, "**Source:** nothing in particular.\n\nBody text.");

const withIssue = parseIssueFile(
  "s9-02-example.md",
  ["---", "title: Arena: another example", "milestone: Arena M9 — Example", "labels: backlog", "stage: 9", "issue: 42", "---", "Body."].join(
    "\n"
  )
);
assert.equal(withIssue.issue, 42);

assert.throws(() => parseIssueFile("bad.md", "no front matter here"), /missing front matter/);
assert.throws(
  () => parseIssueFile("bad.md", ["---", "title: only a title", "---", "Body"].join("\n")),
  /lacks 'milestone'/
);
assert.throws(
  () => parseIssueFile("bad.md", ["---", "title: bad issue number", "milestone: M", "labels: x", "stage: 1", "issue: not-a-number", "---", "Body"].join("\n")),
  /'issue' is not a number/
);

// `findRemoteMatch`: the `issue:` number wins over a title match when both are present.
const remoteA: GhIssue[] = [
  { number: 42, title: "Arena: another example", state: "OPEN" },
  { number: 7, title: "Arena: example issue", state: "CLOSED" },
];
assert.equal(findRemoteMatch(withIssue, remoteA)?.number, 42);
assert.equal(findRemoteMatch(withoutIssue, remoteA)?.number, 7);
assert.equal(
  findRemoteMatch({ ...withoutIssue, title: "no such title" }, remoteA),
  undefined
);

// ── writing `issue: N` back into a file's front matter ──────────────────────

{
  const before = ["---", "title: T", "milestone: M", "labels: x", "stage: 1", "---", "Body."].join("\n");
  const { text, changed } = withIssueNumber(before, 99);
  assert.equal(changed, true);
  assert.equal(text, ["---", "title: T", "issue: 99", "milestone: M", "labels: x", "stage: 1", "---", "Body."].join("\n"));

  // Re-running against the new text updates the existing line rather than duplicating it.
  const { text: text2, changed: changed2 } = withIssueNumber(text, 100);
  assert.equal(changed2, true);
  assert.ok(text2.includes("issue: 100"));
  assert.equal((text2.match(/^issue:/gm) || []).length, 1);

  // Writing the same number again is a no-op.
  const { changed: changed3 } = withIssueNumber(text2, 100);
  assert.equal(changed3, false);
}

// ── {{children}} expansion ───────────────────────────────────────────────────

const childA = parseIssueFile(
  "s9-01-child-a.md",
  ["---", "title: Child A (renamed)", "milestone: Arena M9 — Example", "labels: backlog", "stage: 9", "issue: 501", "---", "Body A"].join(
    "\n"
  )
);
const childB = parseIssueFile(
  "s9-02-child-b.md",
  ["---", "title: Child B", "milestone: Arena M9 — Example", "labels: backlog", "stage: 9", "---", "Body B"].join("\n")
);
const otherStageChild = parseIssueFile(
  "s8-01-other-stage.md",
  ["---", "title: Other stage child", "milestone: Arena M8", "labels: backlog", "stage: 8", "---", "Body"].join("\n")
);
const tracking = parseIssueFile(
  "s9-00-tracking.md",
  [
    "---",
    "title: Arena Stage 9 tracking",
    "milestone: Arena M9 — Example",
    "labels: epic, backlog",
    "stage: 9",
    "tracking: true",
    "---",
    "Intro paragraph.",
    "",
    "{{children}}",
    "",
    "Trailer paragraph.",
  ].join("\n")
);

const allIssues = [childA, childB, otherStageChild, tracking];

// Child A is matched by its `issue:` number even though the remote issue's
// title is still the *old* title — the rename `expandChildren` must survive
// (a title-only lookup, as GitHub sees the rename, would miss it and print
// "not created yet" for an issue that plainly exists). Child B has no number
// yet ("not created"); the other-stage child must not appear at all.
const remoteB: GhIssue[] = [{ number: 501, title: "Child A (old title on GitHub)", state: "CLOSED" }];
const expanded = expandChildren(tracking, allIssues, remoteB);

assert.ok(expanded.includes("Intro paragraph."));
assert.ok(expanded.includes("Trailer paragraph."));
assert.ok(expanded.includes("- [x] #501 Child A (renamed)"), expanded);
assert.ok(expanded.includes("- [ ] Child B (not created yet)"), expanded);
assert.ok(!expanded.includes("Other stage child"), expanded);
assert.ok(!expanded.includes("{{children}}"));

// ── --check: a bad cited path ────────────────────────────────────────────────

{
  const exists = new Set(["src/lib/arena/engine/cards.ts", "docs/arena-tooling.md"]);
  const existsFn = (p: string) => exists.has(p.replace(/^\/+/, ""));

  const clean = parseIssueFile(
    "check-clean.md",
    ["---", "title: Clean", "milestone: M", "labels: x", "stage: 1", "---", "**Source:** `docs/arena-tooling.md` and `src/lib/arena/engine/cards.ts`."].join("\n")
  );
  assert.deepEqual(missingSourcePaths(clean.body, "", existsFn), []);

  const bad = parseIssueFile(
    "check-bad.md",
    ["---", "title: Bad", "milestone: M", "labels: x", "stage: 1", "---", "**Source:** `src/lib/does/not-exist.ts` for the wiring."].join("\n")
  );
  const missing = missingSourcePaths(bad.body, "", existsFn);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].missing, "src/lib/does/not-exist.ts");

  // A brace group reports only the alternative(s) that are actually missing.
  const braced = parseIssueFile(
    "check-braced.md",
    ["---", "title: Braced", "milestone: M", "labels: x", "stage: 1", "---", "**Source:** `src/lib/arena/engine/{cards,missing}.ts`."].join("\n")
  );
  const bracedMissing = missingSourcePaths(braced.body, "", existsFn);
  assert.equal(bracedMissing.length, 1);
  assert.equal(bracedMissing[0].missing, "src/lib/arena/engine/missing.ts");

  // A citation flagged in its own sentence as forthcoming is not drift.
  const forthcoming = parseIssueFile(
    "check-forthcoming.md",
    ["---", "title: Forthcoming", "milestone: M", "labels: x", "stage: 1", "---", '**Source:** `CLAUDE.md` already points at `docs/arena-ruleset-spec.md` as "to come".'].join("\n")
  );
  assert.deepEqual(missingSourcePaths(forthcoming.body, "", existsFn), []);

  // Only the `**Source:**` line is checked — a path named in the Build section
  // is what the issue will create, not a citation of something that exists now.
  const buildSection = parseIssueFile(
    "check-build.md",
    [
      "---",
      "title: Build section",
      "milestone: M",
      "labels: x",
      "stage: 1",
      "---",
      "**Source:** `docs/arena-tooling.md`.",
      "",
      "**Build.** Create `src/lib/arena/rulesets/load.ts`.",
    ].join("\n")
  );
  assert.deepEqual(missingSourcePaths(buildSection.body, "", existsFn), []);
}

// ── --check: a status mismatch ───────────────────────────────────────────────

{
  const closedFile = parseIssueFile(
    "status-closed.md",
    ["---", "title: Closed in front matter", "milestone: M", "labels: done", "stage: 1", "status: closed", "---", "Body."].join("\n")
  );
  const openFile = parseIssueFile(
    "status-open.md",
    ["---", "title: Open in front matter", "milestone: M", "labels: ready-for-agent", "stage: 1", "---", "Body."].join("\n")
  );

  assert.equal(statusMismatch(closedFile, "OPEN"), "front matter says status: closed, GitHub issue is OPEN");
  assert.equal(statusMismatch(closedFile, "CLOSED"), null);
  assert.equal(statusMismatch(openFile, "CLOSED"), "GitHub issue is CLOSED, front matter has no status: closed");
  assert.equal(statusMismatch(openFile, "OPEN"), null);
  // No remote match at all (undefined state) is not a mismatch — there is nothing to compare against.
  assert.equal(statusMismatch(openFile, undefined), null);
}

console.log("verify/backlog: all checks passed");
