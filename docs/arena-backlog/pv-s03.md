---
title: [P1] Arena: Record concurrent AI usage atomically
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, ready-for-agent, enhancement, area:ai, phase:hud-workflow, model:sonnet-5, performance
stage: ui
issue: 567
priority: P1
touches: src/lib/arena/ai/run.ts, src/db/schema.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Measured speed and gameplan. **Plan key:** S03.

**Depends on:** None; ready for an isolated implementation.

**Build.** Use atomic cumulative usage increments and per-call/revision attribution, including paid calls whose stale moves are rejected. Keep provider/billed semantics from #515; additive migration only if necessary. Separate this from #381 model selection and #518 provider deployment.

**Files to verify first:** `src/lib/arena/ai/run.ts`, `src/db/schema.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Two overlapping mocked paid calls retain both token/cost totals; rejected stale move remains accounted; retry identity never erases or duplicates usage.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/ai/run.ts`, `src/db/schema.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
