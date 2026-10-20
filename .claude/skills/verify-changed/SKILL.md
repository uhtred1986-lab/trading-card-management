---
name: verify-changed
description: Use before committing, before pushing, or whenever you need to check a change in this repo. Runs only the typecheck, lint and test scripts a change can affect.
---

# Checking a change

`npm run checks` plans the work from what you changed, so you do not pick scripts by hand.

- **After each commit:** `npm run checks`. It takes the files changed since `origin/main` plus
  uncommitted ones, typechecks, lints those files, and runs only the `test`-chain scripts that import
  them (or read them), plus the rule table for what imports cannot show (Server Function files run
  `verify/guards.ts`, schema and migrations run the db checks). A path nothing claims runs the
  cheap fallback: `verify-rules`, `verify-arena`, `verify/guards`.
- **Once on the final combined head, before merge (the coordinator):** `npm run checks -- full`:
  typecheck, lint, every entry of `npm test`, and the build only when a build-sensitive path
  changed (`--build` forces it). Policy and when to run what: `docs/agent-brief.md` → "Checking a change".
- `npm run checks -- quick` is typecheck plus lint of the changed files only. `npm run checks -- <paths>`
  checks exactly those paths.

## Reading the output

Only failures are printed: the step name and the first ~40 relevant lines, then
`FAILED: N passed, M failed in Xs (slowest: ...)`. The exit code is non-zero on any failure. Fix and rerun
the same command; a rerun is as cheap as the failing part.

- `no rule for N path(s)`: those paths ran the fallback; fine for assets and config.
- `N further importing script(s) not run`: a file everything imports (a glossary, a types module) reaches
  more than 12 scripts, and only the nearest 12 ran. Run `full` once before merge.
- A step that never prints is slow, not hung (`verify-arena` and the policy proofs take minutes).

Run it in the foreground, without `| tail` (more habits: the brief).
