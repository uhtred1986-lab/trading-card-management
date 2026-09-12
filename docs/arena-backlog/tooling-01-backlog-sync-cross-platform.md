---
title: Arena backlog: make the issue sync work without PowerShell — body updates, tracking refresh and an issue number in the front matter
milestone: Arena M15 — Backlog tooling and CI
labels: done, enhancement, area:arena-docs, model:sonnet-5
stage: tooling
status: closed
closed_at: 2026-09-12
---
**Source:** `scripts/sync-arena-backlog.mts`, `scripts/import-arena-backlog.ps1`, `scripts/close-arena-backlog.ps1`, `docs/arena-backlog/_README.md`, `docs/arena-backlog.md` §6; review of 12 Sep 2026.

**Problem.** The backlog is "one file per issue, the file is the reviewed copy", but only the PowerShell script can push a file's body, labels and milestone to GitHub, and only the GitHub CLI (`gh`) authenticates it. Three consequences, all seen on 12 Sep 2026:
1. **Bodies drift.** Every Stage 2–4 and docs issue body on GitHub cited `src/lib/arena/engine/compile.ts` and `script.ts` line numbers that PRs #201 and #203 moved (the compiler is `engine/compile/*` now, `OP_SCHEMA` is in `script-schema.ts`). The files were fixed in this review by hand, and had to be pushed to GitHub by hand as well, because there is no Linux/CI path.
2. **`--sync` does nothing.** `scripts/sync-arena-backlog.mts` line ~300: the `if (sync …)` block logs `Updating tracking issue #N` and never calls the API. Tracking issue #169 still showed #120, #121, #129, #94, #95, #97 unchecked after they were closed — and PR #182 (body: "Closes #100") auto-closed #93, #96, #107, #110 and the docs tracking issue #167 with none of their work in the diff, which nothing noticed for two days.
3. **State drifts the other way.** Three Stage 2 files (`s2-02`, `s2-10`, `s2-97`) still said `ready-for-agent` while their GitHub issues were closed; nothing compares the two.

Titles are also the only key: an issue renamed on GitHub silently detaches from its file.

**Build — in `scripts/sync-arena-backlog.mts` (Node, `GITHUB_TOKEN` or `gh`, already the fallback chain there).**
1. `--push [file…]`: for each file, find the issue by `issue:` front-matter number first, by exact title second; `PATCH /repos/{repo}/issues/{n}` with `body`, `labels`, and `milestone` (look the number up from `GET /repos/{repo}/milestones?state=all`, create it when absent — `import-arena-backlog.ps1`'s `Ensure-Milestone` is the reference). Create the issue when neither key matches, then write `issue: N` back into the file's front matter.
2. `--sync` actually rebuilds every `tracking: true` body: replace `{{children}}` with `- [x]/[ ] #N title` for every non-tracking file of the same `stage`, state from the API (port `Expand-Children` from the `.ps1`), and PATCH it.
3. `--check`: exit non-zero and list every mismatch between a file's `status:` and the issue's state, and every file body that cites a path (`src/…`, `scripts/…`, `docs/…`) that does not exist in the tree — the drift that caused finding 1. Wire `--check` into `.github/workflows/checks.yml` as a third job (needs only `GITHUB_TOKEN`, read-only).
4. `_README.md` documents `issue:` as an optional front-matter key and the three flags; `docs/arena-backlog.md` §6 lists the Node commands beside the PowerShell ones. Keep the `.ps1` scripts working (they can stay as thin wrappers, as `close-arena-backlog.ps1` already is).

**Out of scope.** Changing the issue template; any change to `ac-check.yml` (separate issue).

**Acceptance.**
- `npx tsx scripts/sync-arena-backlog.mts --check` on `main` reports nothing after the fixes; introducing a fake path in one file makes it fail naming the file and the path.
- `--push docs/arena-backlog/s3-01-define-grammar.md --dry-run` prints the PATCH it would send; without `--dry-run` the GitHub body equals the file body (verify with `gh issue view N --json body`).
- `--sync` leaves every tracking issue's checklist equal to the API state (spot-check #169 against `gh issue list --state closed`).
- `npm run typecheck && npm run lint` (the script is under `scripts/`, so ESLint covers it).
