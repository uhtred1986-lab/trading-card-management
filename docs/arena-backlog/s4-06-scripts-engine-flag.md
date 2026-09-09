---
title: Arena: every arena script takes --engine (probe, reprobe, coverage, playthrough, vs) and verify-arena runs on both
milestone: Arena M7 — Rules engine core (Stage 4)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:rules-stage4, model:sonnet-5
stage: 4
---
**Source:** plan Stage 0/4 ("`arena:playthrough`/`arena:fuzz`/`arena:probe` take `--engine legacy|rules`"); today only `scripts/arena-diff.mts`, `arena-fuzz.mts` and `arena-playthrough.mts` read `--engine`; `scripts/arena-probe.mts`, `arena-coverage.mts`, `arena-vs-claude.mts`, `scripts/verify-arena.ts`; `docs/arena-tooling.md` §4.

**Problem.** The rules engine can only be proven by the instruments the legacy engine has, run on it. Half of them cannot be pointed at it.

**Build.**
1. `--engine legacy|rules` on `arena-probe.mts` (and so `arena:reprobe`), `arena-coverage.mts`, `arena-vs-claude.mts`; `src/lib/arena/probe.ts` takes the engine as an argument (it builds its own game with `createGame`, so this is the `engineFor` switch, not a rewrite).
2. `scripts/verify-arena.ts --engine` runs every suite that plays a game (`harness`, `keywords`, `battles`, `workflow`, `probe`, `contract`) on the chosen engine; `npm test` keeps running legacy; add `npm run test:rules` for the other until Stage 9 makes both the default.
3. `docs/arena-tooling.md` §4 documents the flag on each instrument and what "green on rules" means at each stage.

**Out of scope.** Making any suite pass on the rules engine.

**Acceptance.**
- Gate; every script above accepts the flag and refuses an unknown value with a message.
- `npm run test:rules` runs and reports which suites pass, fail, or are skipped with `NotYet`, per suite, rather than stopping at the first.
