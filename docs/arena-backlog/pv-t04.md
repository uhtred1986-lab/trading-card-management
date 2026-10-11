---
title: [P1] Arena: Make reconnection visible and cancel abandoned polling
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, blocked, enhancement, area:arena-contract, phase:arena-home, model:opus-5
stage: ui
issue: 546
priority: P1
touches: src/components/arena/stage/useLiveGame.ts, src/components/arena/stage/ArenaStage.tsx
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Match integrity and recovery. **Plan key:** T04.

**Depends on:** #545 (T03)

**Build.** Add explicit connection states, persistent reconnect/retry affordance, bounded lifecycle-aware backoff, AbortController and timer cleanup. Foreground/online events re-read immediately. Distinguish connection errors, AI failures and an opponent thinking.

**Files to verify first:** `src/components/arena/stage/useLiveGame.ts`, `src/components/arena/stage/ArenaStage.tsx`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Offline then foreground converges to latest terminal revision; unmount aborts requests and timers; repeated failures leave a working Retry button.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/components/arena/stage/useLiveGame.ts`, `src/components/arena/stage/ArenaStage.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
