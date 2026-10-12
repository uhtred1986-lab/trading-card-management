---
title: [P0] Arena: Apply zero-power Battle Card rule processing at checkpoints
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 548
priority: P0
status: closed
touches: src/lib/arena/vm/flow.ts, src/lib/arena/vm/effects.ts, src/lib/arena/vm/zones.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P0. **Delivery:** Rule engine correctness. **Plan key:** R01.

**Depends on:** None; ready for an isolated implementation.

**Build.** Implement rule-processing checkpoints for Battle Card power at or below zero with manual rule 21-6, explicit cause and prevention/replacement interaction. Consult current rule manual for Barrier/Indestructible behavior; keep legacy oracle frozen.

**Files to verify first:** `src/lib/arena/vm/flow.ts`, `src/lib/arena/vm/effects.ts`, `src/lib/arena/vm/zones.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Permanent and temporary reductions reach zero at the correct checkpoint; positive power stays; interacting protection/replacement cases assert zone and event cause.
- [x] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [x] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes the glossary update and reviewed diff. Owner-run: real-deck `arena:fuzz 40` was not run because it requires database deck rows.
- [x] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/vm/flow.ts`, `src/lib/arena/vm/effects.ts`, `src/lib/arena/vm/zones.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
