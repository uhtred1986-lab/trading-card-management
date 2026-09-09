---
title: Arena: replay every saved legacy game on the rules engine to identical events
milestone: Arena M12 — Parity and the flip (Stage 9)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:rules-stage9, model:opus-5
stage: 9
---
**Source:** `scripts/arena-diff.mts` (`--all`); `arena_games` (seed + action log is the reproducible source); `docs/arena-tooling.md` §4 "the oracle".

**Problem.** The differential runner has been used per stage on scripted games. The final proof is the whole history: every game on the shared database, replayed from seed on the rules engine, landing on the row's state.

**Build.**
1. `npm run arena:diff -- --all --engine rules`; for each divergence, the first differing prompt or refused action, grouped by cause (a keyword, a wording, a ruling).
2. Fix each in `vm/` — or, when the legacy engine is the one that is wrong, record the ruling with `npm run arena:rule` and fix both, noting that the saved game's state will then differ from *both* engines' replay and why that is acceptable.
3. A deck edited since a game was played changes the shuffle; the runner already says so — list those games separately.

**Acceptance.** The run reports 0 unexplained divergences; the worklist entry lists every game id with its outcome.
