---
title: [P1] Arena: Fix phase durations and Desire hand activation readings
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, blocked, enhancement, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
issue: 574
priority: P1
touches: src/lib/arena/compile.ts, src/lib/arena/compile/effects.ts, src/lib/arena/vm/activate.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`. Original card rulings and exact acceptance: #539.

**Priority:** P1. **Delivery:** Outstanding card readings. **Plan key:** C04.

**Depends on:** #573 (C03)

**Build.** Own remaining #539 bullets: BT3-085/BT3-101 next Charge Phase-only untap restriction; BT2-004 beginning of next turn duration; SD7-01 Desire Activate Main from hand with energy bound and required deck/life shuffle. Keep duration parser distinct from hand activation if a primitive needs its own follow-up.

**Files to verify first:** `src/lib/arena/compile.ts`, `src/lib/arena/compile/effects.ts`, `src/lib/arena/vm/activate.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Restrictions expire at exact declared moment and allow later skill untap; eligible Desire skill is invoked from hand only within cost bound; searched/inspected zones shuffle as printed.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/compile.ts`, `src/lib/arena/compile/effects.ts`, `src/lib/arena/vm/activate.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
