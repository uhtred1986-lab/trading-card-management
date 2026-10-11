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
