---
title: [P1] Arena: Carry chosen cost values and targets into skill effects
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, blocked, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 550
priority: P1
status: closed
touches: src/lib/arena/vm/costs.ts, src/lib/arena/vm/script.ts, src/lib/arena/vm/activate.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Rule engine correctness. **Plan key:** R03.

**Depends on:** #549 (R02)

**Build.** Specify and implement payment-established X/selection scope for Auto, Activate and Counter, including alternative action costs. Preserve binding identity across prompts and nested effects; coordinate #542 for its card-specific c0 name filter instead of duplicating that filter.

**Files to verify first:** `src/lib/arena/vm/costs.ts`, `src/lib/arena/vm/script.ts`, `src/lib/arena/vm/activate.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Pay an X cost and assert the effect uses the paid X, not zero/default; chosen targets survive reload; an alternative Counter action price is legal only under its stated condition.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/vm/costs.ts`, `src/lib/arena/vm/script.ts`, `src/lib/arena/vm/activate.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
