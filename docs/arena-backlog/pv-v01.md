---
title: [P1] Arena: Generate a capability and named test-gap inventory
milestone: Arena M13 — Retire the legacy engine (Stage 10)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:rules-stage10, model:opus-5
stage: 10
issue: 575
priority: P1
touches: src/lib/arena/glossary.ts, scripts/verify-rules.ts, docs/arena-CURRENT.md
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Independent coverage and retirement. **Plan key:** V01.

**Depends on:** None; ready for an isolated implementation.

**Build.** Generate an explicit supported/unsupported/untested capability matrix, named skips and deferred statics from structured metadata. Link each gap to a live issue and rule citation; distinguish declaration/hook contract completion from verified runtime support. Include documented native mill macro exception and #170 closure evidence. Keep #459's fixed expected-state migration a separate task.

**Files to verify first:** `src/lib/arena/glossary.ts`, `scripts/verify-rules.ts`, `docs/arena-CURRENT.md`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Every active `rulesGap` and `legacyOnly` skip has a stable ID and owner; a TypeScript AST audit records every `NotYet` source site plus named VM note/no-op exits, and verifies source drift without a database. It separates current runtime gaps and live owners from validated guards, referee boundaries, and historical issue references. The matrix keeps #170 declarations separate from runtime proof.
- [x] ALTC's positive multi-choice payment, prompt/player, cost/zone changes, attack resolution and unaffordable alternative are asserted on the rules engine; the obsolete skip is removed. Mill's runtime back-reference fixture and native-macro exception are recorded.
- [x] Typecheck, lint, rules and full `npm test`, and build pass. Glossary runtime evidence links the Heroic/Aegis gaps. Fuzz-40 requires DB-backed deck fixtures, so remains owner-run; no VM/compiler implementation changed.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Evidence:** Generated matrix and source drift verifier are in `docs/arena-capability-inventory.md` and `scripts/verify/capabilities.mts`. Current-base evidence was run with `DATABASE_URL=''`; the #548 row remains unsupported while PR #587 is pending. `--rules-only` still reports the two #459 oracle suites separately.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/glossary.ts`, `scripts/verify-rules.ts`, `docs/arena-CURRENT.md` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
