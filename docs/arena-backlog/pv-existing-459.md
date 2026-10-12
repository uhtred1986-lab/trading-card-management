---
title: Arena tests: off the legacy oracle — fixed expectations for the seven legacy-fixture suites, contract fixtures and verify/vm.ts
milestone: Arena M13 — Retire the legacy engine (Stage 10)
labels: enhancement, area:arena-vm, phase:rules-stage10, model:opus-5, ready-for-agent
stage: 10
issue: 459
priority: P2
---
**Blocks:** #118. This was found in step 1 (#456).

**Problem.** Several tests build their expectations by running the legacy engine:
- Seven `verify-arena` suites (`setup`, `compiler`, `readings`, `wordings`, `contract`, `language`, `lang`; about 7,500 lines) build legacy game fixtures and skip on the rules engine.
- `contract:emit` writes `contract/fixtures/` from legacy games.
- `verify/vm.ts` (4,857 lines) compares the rules engine with legacy, call for call.
- Two keyword cases (`continuations`, `koCard`) use legacy-only helpers.

**Build.**
- Make each suite engine-neutral, or rules-engine-based, with fixed checked-in expectations.
- Keep `contract/probe-digests.json` as the golden record.
- Emit the contract fixtures from the rules engine. If the bytes differ, explain why.
- Turn `vm.ts`'s legacy comparisons into snapshot expectations.
- Drop no assertion silently; list any that change.

**Acceptance.**
- The gate passes.
- `npm test` passes with the legacy run removed, in a branch that proves it.
- Every former comparison still has an assertion.

## Delivery reconciliation — 11 Oct 2026

**Priority:** P2. **Depends on:** None for its bounded scope.

Retain this issue as the fixed-expected-state migration; do not merge it into deletion #118. First audit which fixture suites still require legacy and which are already migrated. Inventory #575 owns all current named skips/deferred paths; migration can start independently, but legacy deletion must wait for both evidence sets.

Execution order and hot-file ownership: `docs/arena-delivery-plan.md`. Full review: `docs/arena-playability-review.md`.

## Audit reconciliation — 12 Oct 2026

The seven fixture suites named above have moved to the rules engine, and contract snapshots are emitted from rules. The two keyword cases named in the original problem (`continuations` and `koCard`/TAKER2) are also engine-neutral. At this audit point the only remaining oracle exclusion in `verify-arena.ts` was `vm`; `ai-vm` already ran under `--rules-only` with fixed fixtures. The saved legacy-game check in `engine-default` remains #118 scope.

The bounded AI presentation migration is tracked separately as [#601](pv-v02.md) and is complete. Its acceptance covers only `ai-vm`; #459 remains open for the larger `vm.ts` comparison-to-fixed-expectation migration and the remaining gate work.

## VM expectation branch — 12 Oct 2026

The isolated `arena-459-fixed-expectations` branch has migrated the VM gameplay
comparisons to reviewed fixed expectations. The 40-field/98-card filter corpus,
45 payment scenarios, 98 printed card prices, 29 complete script results,
full-turn event/action traces, view objects and focused action/event/refusal
cases are checked in. [Evidence](evidence/459/README.md) maps each former
comparison to its current assertion. Legacy adapter, saved-state, face-reading
and legacy script-host compatibility remain executable under #118 guards.

This is branch progress, not issue closure. The branch now removes `vm` from
the shared `verify-arena.ts` rules-only exclusion after a source audit and a
guarded direct VM run found zero legacy calls. The full suite and local
`npm test` proof with the legacy run removed are still pending the shared
heavy-test slot, followed by root review before a PR or merge.
