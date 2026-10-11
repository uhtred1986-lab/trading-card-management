---
title: [P1] Arena: Bind end-of-battle Auto to this card comboed from hand
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, blocked, enhancement, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
issue: 572
priority: P1
touches: src/lib/arena/compile.ts, src/lib/arena/vm/triggers.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`. Original card rulings and exact acceptance: #539.

**Priority:** P1. **Delivery:** Outstanding card readings. **Plan key:** C02.

**Depends on:** #571 (C01)

**Build.** Own #539 BT6-010 and BT2-010 bullets: battleEnd must be bound to that source having comboed from hand, with BT6-010 opponent-turn restriction. Use event/source binding rather than generic battleEnd.

**Files to verify first:** `src/lib/arena/compile.ts`, `src/lib/arena/vm/triggers.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Same battle without this card, combo from another zone and wrong turn do not fire; a legal hand combo fires once at battle end.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/compile.ts`, `src/lib/arena/vm/triggers.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
