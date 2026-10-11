---
title: [P1] Arena: Fix grouped counts shared conditions and mixed target readings
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, blocked, enhancement, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
issue: 573
priority: P1
touches: src/lib/arena/compile.ts, src/lib/arena/compile/targets.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`. Original card rulings and exact acceptance: #539.

**Priority:** P1. **Delivery:** Outstanding card readings. **Plan key:** C03.

**Depends on:** #572 (C02)

**Build.** Own #539 BT3-043 shared condition; BT2-001 total Son Goku/Vegeta; BT2-012 per matching card; BT2-009 fill-under-until-five; BT3-084 Battle Cards AND energy; BT31-090 combined sum bound (check #508 already solved before changes). Preserve distinctions among OR, AND and exact count.

**Files to verify first:** `src/lib/arena/compile.ts`, `src/lib/arena/compile/targets.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Every owned bullet gets expected program and behavior, including nonmatching cards, totals at threshold, partial capacity, and both selected zones; report already-correct redrafts.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/compile.ts`, `src/lib/arena/compile/targets.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
