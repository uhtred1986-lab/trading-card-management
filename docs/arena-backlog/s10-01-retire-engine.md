---
title: Arena: delete engine/'s rule content, move the generic parts into vm/, drop the adapter and --engine
milestone: Arena M13 — Retire the legacy engine (Stage 10)
labels: backlog, enhancement, area:arena-vm, phase:rules-stage10, model:sonnet-5
stage: 10
---
**Source:** plan Stage 10; `src/lib/arena/engines.ts`; the cleanup-ledger convention of `docs/arena-rules-workbench-spec.md` §3.8 (every commit carries lines in/out).

**Blocked on** Stage 9 and on the saved-games decision issue.

**Build.**
1. Move what `vm/` still imports from `engine/` (`stepScript`, `OP_SCHEMA`/`COND_SCHEMA`, `rng`, `filters` adapter, the compiler — which stays, as the drafter of records) into their own homes; delete `engine.ts`, `state.ts`'s DBS content, `triggers.ts`'s name matching.
2. `Engine` interface stays (a second game is a second definition, same interface); `ENGINE_IDS` shrinks or keeps `legacy` as a read-only marker per the decision issue; `--engine` removed from the scripts.
3. Docs: `CLAUDE.md`, `docs/arena-tooling.md`, `games.ts` comment, the history archive's final entry with the ledger.

**Acceptance.** Gate; `src/lib/arena` has fewer lines than before Stage 0 (the ledger says by how much); `arena:fuzz 200` clean; `contract:emit` no change.
