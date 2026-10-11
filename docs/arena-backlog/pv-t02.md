---
title: [P0] Arena: Stop unsupported resolution with a typed interrupted outcome
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-contract, phase:arena-home, model:opus-5
stage: ui
issue: 544
priority: P0
touches: src/lib/arena/vm/flow.ts, src/lib/arena/engines.ts, src/components/arena/stage/GameEnd.tsx, src/components/arena/GameOver.tsx, src/app/arena/[id]/page.tsx
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P0. **Delivery:** Match integrity and recovery. **Plan key:** T02.

**Depends on:** None; ready for an isolated implementation.

**Build.** Use one explicit outcome for unsupported execution, preserving win/draw/concession/abandonment distinctions. Replace unread-program note/no-op escape paths with explainable interruption and mechanic/report context. Propagate to snapshots, history and coaching exclusions; do not label null-winner engine stops Draw.

**Files to verify first:** `src/lib/arena/vm/flow.ts`, `src/lib/arena/engines.ts`, `src/components/arena/stage/GameEnd.tsx`, `src/components/arena/GameOver.tsx`, `src/app/arena/[id]/page.tsx`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] The same fixture distinguishes false condition, optional decline, paid resolution and unsupported resolution; only the last interrupts, and neither browser nor match history reports a draw.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/vm/flow.ts`, `src/lib/arena/engines.ts`, `src/components/arena/stage/GameEnd.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
