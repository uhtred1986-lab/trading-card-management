---
title: Arena Stage 10 tracking — retire the legacy engine
milestone: Arena M13 — Retire the legacy engine (Stage 10)
labels: epic, backlog, area:arena-vm, phase:rules-stage10
stage: 10
tracking: true
---
Stage 10 of the rules-language programme (Sonnet 5, size S). The legacy engine's rule content is deleted, the generic parts move into `vm/`, the adapter and `--engine` go, and the saved legacy games are handled the way the owner decides.

**Exit criterion:** `src/lib/arena/engine/` no longer exists as a playable engine; `npm test` runs one engine; every doc and `CLAUDE.md` describe one engine; old games still open.

Child issues:

{{children}}
