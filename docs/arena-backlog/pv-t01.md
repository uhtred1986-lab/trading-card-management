---
title: [P0] Arena: Verify deck readiness per printed skill and runtime capability
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-contract, phase:arena-home, model:opus-5
stage: ui
issue: 543
priority: P0
touches: src/lib/arena/readiness.ts, src/lib/arena/rules-store.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P0. **Delivery:** Match integrity and recovery. **Plan key:** T01.

**Depends on:** None; ready for an isolated implementation.

**Build.** Count front/back printed skills and required zones against actual records; distinguish missing, draft, open, confirmed-supported and confirmed-unsupported. Preserve the practice/referee path and existing open-rule blocking. A status alone is not runtime support.

**Files to verify first:** `src/lib/arena/readiness.ts`, `src/lib/arena/rules-store.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] A leader with one missing back skill and an otherwise confirmed deck is incomplete; truly textless cards are plain; a confirmed unsupported skill cannot be reported verified.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/readiness.ts`, `src/lib/arena/rules-store.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
