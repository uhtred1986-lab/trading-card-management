---
title: [P1] Arena: Emit face-up life trigger events
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 556
priority: P1
touches: src/lib/arena/vm/zones.ts, src/lib/arena/vm/events.ts, src/lib/arena/vm/triggers.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Rule engine correctness. **Plan key:** R09.

**Depends on:** None; ready for an isolated implementation.

**Build.** Emit face-up life moments with correct source, audience and event binding per 3-9-2-1. Evaluate downstream Autos using the same event path as ordinary life transitions.

**Files to verify first:** `src/lib/arena/vm/zones.ts`, `src/lib/arena/vm/events.ts`, `src/lib/arena/vm/triggers.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Face-up transition fires the intended Auto once; already face-up or unrelated movement does not; opponent views never reveal face-down life.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/vm/zones.ts`, `src/lib/arena/vm/events.ts`, `src/lib/arena/vm/triggers.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
