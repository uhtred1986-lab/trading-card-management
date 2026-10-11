---
title: [P1] Arena: Offer eligible spent combo cards as Z-Energy
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 551
priority: P1
touches: src/lib/arena/vm/battle.ts, src/lib/arena/vm/flow.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Rule engine correctness. **Plan key:** R04.

**Depends on:** None; ready for an isolated implementation.

**Build.** Implement optional combo-to-Z-Energy at battle cleanup per 8-5-2, eligibility, ordering and decline; model player choices and their public beats without changing hidden-card visibility.

**Files to verify first:** `src/lib/arena/vm/battle.ts`, `src/lib/arena/vm/flow.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Eligible spent combo may become Z-Energy once; declined/ineligible cards follow normal cleanup; both players' choices resume correctly.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/vm/battle.ts`, `src/lib/arena/vm/flow.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
