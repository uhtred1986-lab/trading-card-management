# Arena backlog — issue bodies

One file per GitHub issue. `scripts/import-arena-backlog.ps1` (PowerShell, needs `gh`) and
`scripts/sync-arena-backlog.mts --push` (Node, `GITHUB_TOKEN`/`GH_TOKEN` or `gh` — see
`docs/arena-backlog.md` §6) both read every `*.md` here (except this one), create the issue when
neither key matches (below), and push the body, labels and milestone of the ones that do. The
front matter is the metadata; everything under the second `---` is the issue body, verbatim.

```
---
title: Arena: …                      exact issue title — the key the scripts match on when no `issue:` is set
milestone: Arena M6 — …              must be one of the milestones in docs/arena-backlog.md
labels: backlog, ready-for-agent, …  comma-separated; the scripts create the ones they know
stage: 3                             programme stage (2–10, "docs", "tooling"), or "ui" for the M2–M5 items
tracking: true                       this file is the stage's tracking issue; its body may hold
                                     {{children}}, replaced by a task list of the stage's issues
issue: 208                           optional — the GitHub issue number, written back by `--push`
                                     the first time it creates or matches one. Once present it is
                                     the match key (a title rename no longer detaches the file);
                                     absent, the title is still the fallback key.
status: closed                       optional — set once the issue is done, so `--check` can catch
                                     the file and the issue drifting apart (`closed_at: …` beside it)
---
```

Write the body for an agent that has read `CLAUDE.md` and nothing else: why, what to build (with
file paths), what is out of scope, and the acceptance checks as commands plus one scenario proof.
Keep the title stable when there is no `issue:` yet — it is the fallback key; change the body
freely and re-run the push with `--push` (or `-UpdateExisting` for the PowerShell script).

## The Node script

`scripts/sync-arena-backlog.mts` needs no GitHub CLI — `GITHUB_TOKEN` or `GH_TOKEN` in the
environment is enough, with `gh api` as the fallback when neither is set (same order
`import-arena-backlog.ps1` uses for `gh`). Three flags, all documented in full in
`docs/arena-backlog.md` §6:

- `--push [file…]` creates or updates issues from the local files (all of them with no arguments).
- `--sync` rebuilds every tracking issue's `{{children}}` list from the current issue numbers and state.
- `--check` reports drift and exits non-zero: a file's `status:` disagreeing with the issue's
  state, and a `**Source:**` citation whose path no longer exists in the tree. Only the `Source`
  line is checked — the `Build` section names paths the issue's own work will create, so a path
  not existing there is the point, not drift. Runs read-only in CI
  (`.github/workflows/checks.yml`, job `backlog`) with no arguments beyond `--check` needed.

`--close`/`--all-closed` (closing issues and posting the acceptance comment) are unchanged from
before this file grew the three flags above.
