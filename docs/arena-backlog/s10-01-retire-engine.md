---
title: Arena: delete engine/'s rule content, move the generic parts into vm/, drop the adapter and --engine
milestone: Arena M13 — Retire the legacy engine (Stage 10)
labels: enhancement, backlog, area:arena-vm, phase:rules-stage10, model:sonnet-5, blocked
stage: 10
issue: 118
priority: P3
---
**Source:** plan Stage 10; `src/lib/arena/engines.ts`; the cleanup-ledger convention of `docs/arena-rules-workbench-spec.md` §3.8 (every commit carries lines in/out).

**Blocked on** #459, #575, #547 and P0 runtime acceptance (#544/#548/#549); the saved-game ruling and archive implementation #119/#335 are already closed.

**Build.**
1. Move what `vm/` still imports from `engine/` (`stepScript`, `OP_SCHEMA`/`COND_SCHEMA`, `rng`, `filters` adapter, the compiler — which stays, as the drafter of records) into their own homes; delete `engine.ts`, `state.ts`'s DBS content, `triggers.ts`'s name matching.
2. `Engine` interface stays (a second game is a second definition, same interface); `ENGINE_IDS` shrinks or keeps `legacy` as a read-only marker per the decision issue; `--engine` removed from the scripts.
3. Docs: `CLAUDE.md`, `docs/arena-tooling.md`, `games.ts` comment, the worklist's final entry with the ledger.

**Acceptance.** Gate; `src/lib/arena` has fewer lines than before Stage 0 (the ledger says by how much); `arena:fuzz 200` clean; `contract:emit` no change.

## Delivery reconciliation — 11 Oct 2026

**Priority:** P3. **Depends on:** #459, #575, #547, #544, #548, #549

Delete legacy only after fixed expectations #459, capability/skip inventory #575, reproducible old-game/replay handling #547 and the P0 runtime corrections #544/#548/#549 pass. #119 and #335 are already closed; do not re-request their owner's ruling. Remaining unsupported capabilities must have explicit tested behavior before retirement; no deleted oracle tests to make the gate green.

Execution order and hot-file ownership: `docs/arena-delivery-plan.md`. Full review: `docs/arena-playability-review.md`.
