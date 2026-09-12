import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractIssueRefs,
  extractAcceptanceSection,
  extractProblemParagraph,
  buildIssueExcerpt,
} from "./check-acceptance-criteria.mjs";

test("extractAcceptanceSection reads a **Acceptance.** heading up to the next ## heading", () => {
  const body = `**Source:** somewhere

**Problem.** Something is broken.

**Build.**
1. Do the thing.

**Acceptance.**
- First check.
- Second check.

## Out of scope
Not this.`;
  const section = extractAcceptanceSection(body);
  assert.ok(section.startsWith("**Acceptance.**"));
  assert.match(section, /First check\./);
  assert.match(section, /Second check\./);
  assert.doesNotMatch(section, /Out of scope/);
});

test("extractAcceptanceSection reads a ## Acceptance heading up to a --- rule", () => {
  const body = `## Problem
Body text.

## Acceptance
- Check one.
- Check two.

---
Footer notes.`;
  const section = extractAcceptanceSection(body);
  assert.ok(section.startsWith("## Acceptance"));
  assert.match(section, /Check one\./);
  assert.match(section, /Check two\./);
  assert.doesNotMatch(section, /Footer notes/);
});

test("extractAcceptanceSection reads a **Done when** heading to the end when there is no next boundary", () => {
  const body = `Some intro text.

**Done when**
- The button renders.
- The test passes.`;
  const section = extractAcceptanceSection(body);
  assert.ok(section.startsWith("**Done when**"));
  assert.match(section, /The button renders\./);
  assert.match(section, /The test passes\./);
});

test("extractAcceptanceSection returns null when no acceptance heading exists, so callers fall back", () => {
  const body = `Just a plain issue body with no recognised heading at all, describing
some work that needs doing, with no structured sections whatsoever.`;
  assert.equal(extractAcceptanceSection(body), null);
});

test("buildIssueExcerpt falls back to the old 3000-character slice when no acceptance heading exists", () => {
  const longBody = "x".repeat(4000);
  const issue = { number: 1, title: "No structure here", body: longBody };
  const excerpt = buildIssueExcerpt(issue);
  assert.equal(excerpt, longBody.slice(0, 3000));
  assert.equal(excerpt.length, 3000);
});

test("buildIssueExcerpt includes title, Problem paragraph, and the Acceptance section when present", () => {
  const body = `**Source:** somewhere

**Problem.** ${"p".repeat(800)}

**Build.**
1. Do the thing.

**Acceptance.**
- The acceptance line the check should quote.`;
  const issue = { number: 42, title: "A backlog item", body };
  const excerpt = buildIssueExcerpt(issue);
  assert.match(excerpt, /^Title: A backlog item/);
  assert.match(excerpt, /Problem: \*\*Problem\.\*\*/);
  assert.match(excerpt, /The acceptance line the check should quote\./);
  // The Problem paragraph is capped at 600 chars, well under the 800 p's in the body.
  const problemLine = excerpt.split("\n\n").find((p) => p.startsWith("Problem:"));
  assert.ok(problemLine.length <= 600 + "Problem: ".length);
});

test("extractProblemParagraph caps at the given limit and stops at a blank line", () => {
  const body = `**Problem.** short paragraph.

Next paragraph should not be included.`;
  const problem = extractProblemParagraph(body, 600);
  assert.equal(problem, "**Problem.** short paragraph.");
});

test("extractIssueRefs separates Closes claims from Refs mentions in a PR body", () => {
  const body = `## What
Adds the thing.

## Closes
Closes #1

## Refs
Refs #2

Also mentions Fixes #1 again and References #3.`;
  const { closing, referencing } = extractIssueRefs(body);
  assert.deepEqual(closing, [1]);
  assert.deepEqual(referencing, [2, 3]);
});

test("extractIssueRefs treats a number claimed both ways as closing only", () => {
  const body = "Closes #5\nRefs #5\n";
  const { closing, referencing } = extractIssueRefs(body);
  assert.deepEqual(closing, [5]);
  assert.deepEqual(referencing, []);
});

test("extractIssueRefs returns empty arrays for a body with no references", () => {
  const { closing, referencing } = extractIssueRefs("Just a description, no issue links.");
  assert.deepEqual(closing, []);
  assert.deepEqual(referencing, []);
});
