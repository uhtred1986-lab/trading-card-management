---
title: Arena Stage 9 tracking — parity and the flip
milestone: Arena M12 — Parity and the flip (Stage 9)
labels: epic, backlog, area:arena-vm, phase:rules-stage9
stage: 9
tracking: true
---
Stage 9 of the rules-language programme (Opus 5 review, size M). The rules engine is proven against the oracle on everything the app has ever recorded, and becomes the default.

**Exit criterion:** every saved `legacy` game replays on the rules engine to identical events; `arena:reprobe --engine rules` = 0 moved; `arena:fuzz 200 --engine rules` clean; `verify-arena` runs its suites on both engines in `npm test`; the `arena.engine` default is `rules`, the badge is gone, Legacy stays selectable. A `/code-review` pass on Opus 5 before the flip merges.

Child issues:

{{children}}
