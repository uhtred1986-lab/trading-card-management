---
title: Arena: verify/battles.ts and the battle fixtures run on both engines
milestone: Arena M9 — Rules engine battle (Stage 6)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:rules-stage6, model:sonnet-5
stage: 6
---
**Source:** `scripts/verify/battles.ts` (466 lines), `harness.ts`, `workflow.ts`; the `--engine` flag on `verify-arena.ts` from Stage 4; `docs/arena-tooling.md` §2.

**Problem.** The battle suites stage boards with the legacy engine's helpers. They must run unchanged in intent on the rules engine, and any staging helper that reaches into `GameState` must go through the shared state interface instead.

**Build.**
1. Port the staging helpers (`stage`, `put`, `rest`, …) to the state interface; a suite is parameterised by engine, never duplicated.
2. `npm run test:rules` runs `battles`, `harness`, `workflow` green; the remaining `NotYet`s are listed per suite and each names its Stage 7 issue.
3. `docs/arena-tooling.md` §2 says what each suite proves on the rules engine.

**Acceptance.** Gate; `npm run test:rules` green for the three suites; the skipped cases are all keyword cases.
