---
title: [P1] Arena: Make reconnection visible and cancel abandoned polling
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, enhancement, area:arena-contract, phase:arena-home, model:opus-5
stage: ui
issue: 546
priority: P1
touches: src/components/arena/stage/useLiveGame.ts, src/components/arena/stage/ArenaStage.tsx
status: closed
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Match integrity and recovery. **Plan key:** T04.

**Depends on:** #545 (T03)

**Build.** Add explicit connection states, persistent reconnect/retry affordance, bounded lifecycle-aware backoff, AbortController and timer cleanup. Foreground/online events re-read immediately. Distinguish connection errors, AI failures and an opponent thinking.

**Files to verify first:** `src/components/arena/stage/useLiveGame.ts`, `src/components/arena/stage/ArenaStage.tsx`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Offline then foreground converges to latest terminal revision; unmount aborts requests and timers; repeated failures leave a working Retry button. **Evidence:** `scripts/verify/arena-live-polling.mts` covers offline/foreground terminal refresh, cancellation and late abort-ignoring responses, unmount cleanup, a 25s deadline for a stalled request, deadline abort and bounded retry, stale terminal rejection, cross-game rejection, capped backoff, and manual retry. `scripts/verify/arena-live-browser.mts` intercepts polling with a transient failure then a higher-revision terminal snapshot and verifies the persistent offline/reconnecting state, Retry recovery, Victory view and cleared badge.
- [x] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/event assertions. **Evidence:** deterministic controller assertions cover old-generation callbacks not changing cursors or terminal state, rejection of lower revisions before status/waiting checks, invalid and wrong-game responses, lifecycle wakeups, retry and cleanup. Browser proof checks loaded local card artwork, topbar fit at both target viewports, and a Retry target at least 44×44 CSS px. Screenshots for before/offline/reconnecting/recovered states at 390×844 and 1440×900 in both skins are committed in `docs/arena-backlog/evidence/546/`; the README records the artwork and controlled fixture methodology.
- [x] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable. **Evidence:** `DATABASE_URL='' npm run typecheck`, `DATABASE_URL='' npm run lint` (five existing warnings, zero errors), `DATABASE_URL='' npm test`, `DATABASE_URL='' ARENA_BASE=http://localhost:3001 npx tsx scripts/verify/arena-live-browser.mts`, and `DATABASE_URL='' npm run build` passed locally. No VM/compiler files changed, so glossary and fuzz checks do not apply.
- [x] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed. **Evidence:** the change is limited to live polling, its UI, focused verification and evidence. No live database, paid AI, or production checks were run; those remain owner-run.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/components/arena/stage/useLiveGame.ts`, `src/components/arena/stage/ArenaStage.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
