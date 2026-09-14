---
title: Arena tooling: a SessionStart hook that installs dependencies so a fresh web session can run the tests
milestone: Arena M15 — Backlog tooling and CI
labels: backlog, ready-for-agent, enhancement, area:arena-docs, model:sonnet-5
stage: tooling
issue: 283
status: closed
closed_at: 2026-09-14
---
**Source:** the orchestrator's token review of 13 Sep 2026 (a fresh Claude Code on the web container had no `node_modules`; `npx tsx scripts/verify-arena.ts` failed with "Cannot find module 'drizzle-orm'" in 1.4 s, which reads like a fast green run until the exit code is checked); `.claude/` (skills only, no `settings.json` today); the `session-start-hook` skill available in Claude Code on the web; `package.json` scripts; `CLAUDE.md` "Working efficiently in this repo".

**Problem.** Every child session pays a cold `npm ci` before its first test, and a session that forgets pays worse: the verify scripts exit non-zero with a module error that is easy to mistake for a broken suite. The install belongs in a SessionStart hook so it happens once, before the agent's first turn, and the agent's first test run is real.

**Build.**
1. `.claude/settings.json` with a `SessionStart` hook (use the `session-start-hook` skill's shape) that runs `npm ci --prefer-offline --no-audit --no-fund` when `node_modules` is missing or older than `package-lock.json`, and prints one line either way. It must be safe on a developer's machine (skip when `node_modules` is current) and on Windows (the owner's machine runs PowerShell — use `node` for the check, not a shell one-liner).
2. Warm the `tsx` cache with `npx tsx --version` so the first `verify-rules` run is not the install.
3. A note in `CLAUDE.md`'s "Working efficiently" paragraph: what the hook does, and that a missing-module error means it did not run.

**Out of scope.** Playwright/Chromium setup; the Android/Docker toolchain; anything network-dependent beyond the npm registry.

**Acceptance.**
- In a fresh clone with no `node_modules`, starting a session runs the hook and `npx tsx scripts/verify-rules.ts` passes on the first try; with `node_modules` current, the hook is a no-op in under a second.
- `npm run typecheck && npm run lint && npm test` green; the hook's script is under `scripts/` and covered by a one-line check in `scripts/verify-rules.ts` if it has any logic worth asserting.
