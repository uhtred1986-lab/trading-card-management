# Arena backlog — issue bodies

One file per GitHub issue. `scripts/import-arena-backlog.ps1` reads every `*.md` here (except
this one), creates the issue when no open or closed issue has the same title, and with
`-UpdateExisting` rewrites the body, labels and milestone of the ones that do. The front matter
is the metadata; everything under the second `---` is the issue body, verbatim.

```
---
title: Arena: …                      exact issue title — the key the script matches on
milestone: Arena M6 — …              must be one of the milestones in docs/arena-backlog.md
labels: backlog, ready-for-agent, …  comma-separated; the script creates the ones it knows
stage: 3                             programme stage (2–10), "docs", or "ui" for the M2–M5 items
tracking: true                       this file is the stage's tracking issue; its body may hold
                                     {{children}}, replaced by a task list of the stage's issues
---
```

Write the body for an agent that has read `CLAUDE.md` and nothing else: why, what to build (with
file paths), what is out of scope, and the acceptance checks as commands plus one scenario proof.
Keep the title stable — it is the key; change the body freely and re-run the import with
`-UpdateExisting`.
