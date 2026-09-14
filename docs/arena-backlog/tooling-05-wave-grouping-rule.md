---
title: Arena backlog: the parallel-wave rule — group issues by the files they edit, one session per group, sequential inside it
milestone: Arena M15 — Backlog tooling and CI
labels: done, enhancement, area:arena-docs, model:sonnet-5
stage: tooling
issue: 284
status: closed
closed_at: 2026-09-14
---
**Source:** the orchestrator's token review of 13 Sep 2026 (the wave of five sessions over #255, #269–#279 was grouped by hot file — `src/lib/arena/engine/script-schema.ts`, `src/lib/arena/rulesets/dbs/ops.rules`, `src/lib/arena/rulesets/dbs/actions.rules`, `CLAUDE.md`, `src/db/schema.ts` and the `drizzle/` migrations — with the issues that share one run sequentially in one session); `docs/arena-backlog.md`; `docs/arena-backlog/_README.md`; `scripts/lib/arena-backlog.ts` (the front-matter parser).

**Problem.** Two sessions editing `script-schema.ts` or `ops.rules` at once produce merge conflicts that each costs a re-read of the file and a re-run of the gate; two migrations generated in parallel collide on their number. The rule that avoids it was applied by hand on 13 Sep and lives nowhere.

**Build.**
1. `docs/arena-backlog.md` §7 "Running a wave": group ready issues by the hot files they will edit; one session per group; sequential inside a group, each issue on its own branch and PR, the next branched from the previous when it depends on it; merge `main` before every push; migrations never in parallel; the wave's sessions tagged with one tag so `list_sessions` finds them.
2. An optional `touches:` front-matter line (comma-separated repo paths) parsed by `scripts/lib/arena-backlog.ts` and ignored by the sync, so a wave can be grouped from the files rather than from memory; `scripts/verify/backlog.ts` asserts it parses and that a file without it still parses.
3. Fill `touches:` on the open Stage 5–9 issues' files where the Build list already names the files.

**Out of scope.** Automating the spawning of sessions; changing what `--check` refuses.

**Acceptance.**
- `docs/arena-backlog.md` has the section; `_README.md` documents `touches:`.
- `npm test` green with the new assertion in `scripts/verify/backlog.ts`; `npx tsx scripts/sync-arena-backlog.mts --check` unchanged.
