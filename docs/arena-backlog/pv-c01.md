---
title: [P1] Arena: Fix missing and over-broad card Auto trigger readings
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
issue: 571
priority: P1
touches: src/lib/arena/compile.ts, src/lib/arena/compile/clauses.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`. Original card rulings and exact acceptance: #539.

**Priority:** P1. **Delivery:** Outstanding card readings. **Plan key:** C01.

**Depends on:** None; ready for an isolated implementation.

**Build.** Own #539 trigger bullets: BT7-003/SD8-09 active-energy non-Awaken; XD1-01 colour/trait play; BT31-116 white Cell/Cell Jr. cost threshold and free Extra ruling; SD15-01 attack-on-red-Unison restriction. Verify current parser paths before editing; re-draft locally, no Neon writes.

**Files to verify first:** `src/lib/arena/compile.ts`, `src/lib/arena/compile/clauses.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Each listed card has an exact trigger and positive plus negative opponent/colour/trait/cost/target examples; absence of trigger cannot silently pass.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/compile.ts`, `src/lib/arena/compile/clauses.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
