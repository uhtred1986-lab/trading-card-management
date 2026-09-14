---
title: Arena backlog: retire the 12 Sep code map from every issue body — one live map in arena-next-session-prompt.md
milestone: Arena M15 — Backlog tooling and CI
labels: done, enhancement, area:arena-docs, model:sonnet-5
stage: tooling
issue: 281
status: closed
closed_at: 2026-09-14
---
**Source:** the orchestrator's token review of 13 Sep 2026; `docs/arena-backlog/*.md` (32 files carry a "## Review of 12 Sep 2026 — where the code stands, and the steps in order" section, ~730 words each; 28 of them still say `src/lib/arena/rulesets/`, `src/lib/arena/vm/`, `docs/arena-ruleset-spec.md` and `scripts/verify/rulesets.ts` are "absent from the tree"); `docs/arena-next-session-prompt.md` (the entry point the `arena-work` skill names first); `scripts/sync-arena-backlog.mts --push` (what re-syncs the issue bodies).

**Problem.** The code map pasted into 32 issue bodies on 12 Sep was true that day and is false now: the rulesets, the vm, the spec and their suites all exist, `engineFor("rules")` no longer throws, and the compiler line numbers it cites have moved. Every agent that reads one of those issues pays about a thousand tokens for it and is pointed away from the code it needs. A map that lives in 32 places cannot be kept true; one that lives in the entry-point doc can.

**Build.**
1. Delete the "## Review of 12 Sep 2026" section from every backlog file, open and closed — git history keeps it — and keep only the per-issue "Steps in order" list where it still says something the Build list above it does not; fold anything still true and specific into that Build list.
2. Check `docs/arena-next-session-prompt.md` carries the one live code map (the module list, where the tables are, the gate) and is dated; correct what the deleted blocks said that it does not yet say and is still true.
3. Run `npx tsx scripts/sync-arena-backlog.mts --push` if a token is available (`GITHUB_TOKEN`/`GH_TOKEN`), otherwise say in the PR that the owner runs it once after merge — the files are the source of truth and the issue bodies follow.
4. `_README.md`: one line saying issue bodies carry no code map; the map is the session prompt doc.

**Out of scope.** Rewriting any Build or Acceptance list; touching `CLAUDE.md` (its own issue).

**Acceptance.**
- `grep -l "Review of 12 Sep 2026" docs/arena-backlog/*.md` is empty; `grep -l "Absent from the tree" docs/arena-backlog/*.md` is empty.
- `npm test` (`scripts/verify/backlog.ts`) green; `npx tsx scripts/sync-arena-backlog.mts --check` reports no drift (paths cited in `**Source:**` lines still exist).
- The PR body states the word count removed and whether `--push` was run.
