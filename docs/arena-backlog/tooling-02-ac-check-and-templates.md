---
title: Arena backlog: PR template with a Closes line, and an ac-check that reads the issue's acceptance section only
milestone: Arena M15 — Backlog tooling and CI
labels: backlog, ready-for-agent, enhancement, area:arena-docs, model:sonnet-5
stage: tooling
---
**Source:** `.github/workflows/ac-check.yml`, `scripts/ci/check-acceptance-criteria.mjs`, `.github/ISSUE_TEMPLATE/arena_backlog_item.yml`; review of 12 Sep 2026; PR #182 (the case that motivated the check).

**Problem.** Two small gaps in the GitHub-side tooling that an agent working the backlog hits every time.
1. **No PR template.** There is no `.github/pull_request_template.md`, so agent-authored PRs (Copilot's #201–#207, this repo's Claude sessions) decide their own shape; the ac-check only fires on `Closes #N` / `Fixes #N` / `Resolves #N` (`extractClosingRefs`, `check-acceptance-criteria.mjs` line 37), and a PR that names its issue as "for #131" is never checked and never auto-closes anything.
2. **The ac-check sends the whole issue body**, capped at 3,000 characters (`i.body.slice(0, 3000)`, line ~90). After this review the backlog bodies are 6–10 k characters and the **Acceptance** section is at the end, so the model grading a PR never sees the acceptance checks it is supposed to grade against.

**Build.**
1. `.github/pull_request_template.md` with three headings — *What*, *Closes* (one `Closes #N` per line, or `Refs #N` when the PR is partial), *Checks run* (the gate commands as a checklist: typecheck, lint, test, build, fuzz 40, contract:emit reviewed, readings/tally diff signed off for compiler work) — and the note that a `Closes` line is a claim the ac-check grades.
2. `check-acceptance-criteria.mjs`: for each referenced issue, extract the text from the first line matching `/^\*\*Acceptance\.?\*\*|^## Acceptance|^\*\*Done when\*\*/m` to the next `^## ` or `^---$`, and send `title + Problem paragraph (first 600 chars) + Acceptance section` instead of the first 3,000 characters; fall back to the old slice when no such heading exists. Keep the 200 KB diff cap.
3. Treat `Refs #N` as "partial, do not grade as a closure claim": list it in the comment as *referenced, not closing*, so the auto-close warning is not raised for it.

**Out of scope.** Replacing the `claude` CLI in CI; the quota fallback (already handled, commit `4615807`).

**Acceptance.**
- Open a draft PR from a branch with `Closes #131` in the template's *Closes* section: the ac-check comment shows a verdict row for #131 and its *Why* quotes an acceptance line from the issue (proof the section reached the prompt).
- A PR with only `Refs #131` gets the *referenced, not closing* line and no Risk section.
- `node --check scripts/ci/check-acceptance-criteria.mjs` and `npm run lint` pass.
