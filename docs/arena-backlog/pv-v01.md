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
- [ ] Every named skip and unsupported branch has a stable ID and owner issue; a completed historical stage cannot imply an unimplemented mechanic works; matrix generation is DB-free and matches current tests.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/glossary.ts`, `scripts/verify-rules.ts`, `docs/arena-CURRENT.md` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
